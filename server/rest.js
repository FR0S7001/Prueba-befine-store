/* =====================================================================
   rest.js — Motor de consultas estilo PostgREST sobre SQLite
   ---------------------------------------------------------------------
   Entiende lo que envía el cliente local (js/local-client.js), que imita
   a supabase-js:  select con relaciones embebidas ("alias:tabla(cols)"),
   filtros (eq, neq, gt, gte, lt, lte, in, is), orden, límite, insert,
   update, upsert y delete.

   Seguridad: cada tabla tiene sus POLÍTICAS (equivalente al RLS de
   Supabase). Lo que el usuario no puede leer no aparece; lo que no puede
   modificar simplemente no se modifica (0 filas), igual que en producción.
   ===================================================================== */
const { BOOLEANAS, JSONES, RELACIONES } = require("./schema");
const { uuid } = require("./auth");
const { PERMISOS } = require("./seed");

class ErrorDB extends Error {
  constructor(mensaje, code = "400", estado = 400) { super(mensaje); this.code = code; this.estado = estado; }
}

/* ---------- Contexto del usuario (quién consulta y qué puede) ---------- */
function crearContexto(db, user) {
  const ctx = { db, uid: null, anonimo: true, perfil: null, permisos: new Set(), esAdmin: false, cache: new Map() };
  if (!user) return ctx;
  ctx.uid = user.id; ctx.anonimo = !!user.is_anonymous; ctx.email = user.email || null;
  const pf = db.prepare("SELECT * FROM perfiles WHERE id = ?").get(user.id);
  ctx.perfil = pf || null;
  if (pf && pf.activo) {
    if (pf.rol === "admin") { ctx.esAdmin = true; PERMISOS.forEach((p) => ctx.permisos.add(p[0])); }
    else if (pf.rol !== "cliente") db.prepare("SELECT permiso FROM rol_permisos WHERE rol_id = ?").all(pf.rol).forEach((r) => ctx.permisos.add(r.permiso));
  }
  return ctx;
}
const puede = (ctx, p) => ctx.permisos.has(p);
const puedeAlguno = (ctx, ...ps) => ps.some((p) => puede(ctx, p));

/* ---------- Políticas (RLS) ---------- */
const publica = () => true;
const sinAcceso = () => false;
const con = (...permisos) => (ctx) => puedeAlguno(ctx, ...permisos);

/* Pedido al que pertenece una fila (con caché por consulta) */
function pedidoDe(ctx, id) {
  const k = "p:" + id;
  if (!ctx.cache.has(k)) ctx.cache.set(k, ctx.db.prepare("SELECT id, perfil_id FROM pedidos WHERE id = ?").get(id) || null);
  return ctx.cache.get(k);
}
const verPedidos = (ctx) => puedeAlguno(ctx, "pedidos.ver", "pedidos.gestionar");
const pedidoVisible = (ctx, pedidoId) => {
  if (verPedidos(ctx)) return true;
  const p = pedidoDe(ctx, pedidoId);
  return !!(p && ctx.uid && p.perfil_id === ctx.uid);
};

const POLITICAS = {
  categorias:         { read: publica, write: con("catalogo.gestionar") },
  productos:          { read: (c, r) => !!r.activo || puede(c, "catalogo.gestionar"), write: con("catalogo.gestionar") },
  variantes_producto: { read: (c, r) => !!r.activo || puede(c, "catalogo.gestionar"), write: con("catalogo.gestionar") },
  precios_variante:   { read: publica, write: con("precios.gestionar") },
  niveles_precio:     { read: publica, write: sinAcceso },
  zonas_despacho:     { read: (c, r) => !!r.activo || puede(c, "despacho.gestionar"), write: con("despacho.gestionar") },
  comunas_cobertura:  { read: (c, r) => !!r.activo || puede(c, "despacho.gestionar"), write: con("despacho.gestionar") },
  parametros:         { read: publica, write: con("config.gestionar") },
  roles:              { read: publica, write: (c) => c.esAdmin },
  permisos:           { read: publica, write: sinAcceso },
  rol_permisos:       { read: publica, write: (c) => c.esAdmin },
  perfiles: {
    read: (c, r) => r.id === c.uid || puedeAlguno(c, "clientes.ver", "clientes.gestionar") || c.esAdmin,
    insert: sinAcceso, delete: sinAcceso,
    update: (c, r) => r.id === c.uid || puede(c, "clientes.gestionar") || c.esAdmin,
  },
  direcciones: { read: (c, r) => r.perfil_id === c.uid || verPedidos(c), write: sinAcceso },
  pedidos:     { read: (c, r) => r.perfil_id === c.uid || verPedidos(c), insert: sinAcceso, delete: sinAcceso, update: con("pedidos.gestionar") },
  detalle_pedido:         { read: (c, r) => pedidoVisible(c, r.pedido_id), write: sinAcceso },
  historial_pedido:       { read: (c, r) => pedidoVisible(c, r.pedido_id), write: sinAcceso },
  documentos_tributarios: { read: (c, r) => pedidoVisible(c, r.pedido_id), write: con("documentos.gestionar") },
  pagos:                  { read: (c, r) => pedidoVisible(c, r.pedido_id) && (puede(c, "pagos.gestionar") || (pedidoDe(c, r.pedido_id) || {}).perfil_id === c.uid), write: sinAcceso },
  movimientos_puntos:     { read: (c, r) => r.perfil_id === c.uid || puede(c, "puntos.gestionar"), write: sinAcceso },
  cupones:         { read: con("promociones.gestionar"), write: con("promociones.gestionar") },
  cupon_variantes: { read: con("promociones.gestionar"), write: con("promociones.gestionar") },
};
const politica = (tabla, op) => {
  const p = POLITICAS[tabla];
  if (!p) throw new ErrorDB(`Could not find the table 'public.${tabla}'`, "PGRST205", 404);
  return p[op] || (op === "read" ? p.read : p.write);
};

/* ---------- Metadatos de tablas ---------- */
const metaCache = new WeakMap();
function columnas(db, tabla) {
  if (!metaCache.has(db)) metaCache.set(db, new Map());
  const m = metaCache.get(db);
  if (!m.has(tabla)) {
    const cols = db.prepare(`PRAGMA table_info("${tabla.replace(/"/g, "")}")`).all();
    if (!cols.length) throw new ErrorDB(`Could not find the table 'public.${tabla}'`, "PGRST205", 404);
    m.set(tabla, cols.map((c) => c.name));
  }
  return m.get(tabla);
}
const TABLAS_OCULTAS = new Set(["auth_users", "sesiones"]);
function validarTabla(db, tabla) {
  if (TABLAS_OCULTAS.has(tabla) || !POLITICAS[tabla]) throw new ErrorDB(`Could not find the table 'public.${tabla}'`, "PGRST205", 404);
  return columnas(db, tabla);
}
function validarColumna(db, tabla, col) {
  if (!columnas(db, tabla).includes(col)) throw new ErrorDB(`column ${tabla}.${col} does not exist`, "42703");
  return col;
}

/* ---------- Conversión de valores (SQLite ⇄ interfaz) ---------- */
function aFila(tabla, r) {
  const o = { ...r };
  for (const c of BOOLEANAS[tabla] || []) if (c in o) o[c] = !!o[c];
  for (const c of JSONES[tabla] || []) if (c in o && typeof o[c] === "string") { try { o[c] = JSON.parse(o[c]); } catch (e) { /* queda texto */ } }
  return o;
}
function aSQL(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === undefined) return null;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

/* ---------- Select: "id,nombre,alias:tabla(col,otra(x))" ---------- */
function partirNivel(str) {
  const partes = []; let prof = 0, ini = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") prof++;
    else if (ch === ")") prof--;
    else if (ch === "," && prof === 0) { partes.push(str.slice(ini, i)); ini = i + 1; }
  }
  partes.push(str.slice(ini));
  return partes.map((s) => s.trim()).filter(Boolean);
}
function parseSelect(str) {
  const nodos = [];
  for (const p of partirNivel(str || "*")) {
    const i = p.indexOf("(");
    if (i < 0) { nodos.push(p === "*" ? { tipo: "todo" } : { tipo: "col", nombre: p }); continue; }
    if (!p.endsWith(")")) throw new ErrorDB("select mal formado", "PGRST100");
    let cabeza = p.slice(0, i).trim().replace(/!inner$/, "");
    let alias = null, tabla = cabeza;
    if (cabeza.includes(":")) [alias, tabla] = cabeza.split(":").map((s) => s.trim());
    nodos.push({ tipo: "rel", alias: alias || tabla, tabla, hijos: parseSelect(p.slice(i + 1, -1)) });
  }
  return nodos;
}

/* ---------- Lectura ---------- */
const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
function construirWhere(db, tabla, filtros) {
  const sql = [], args = [];
  for (const f of filtros || []) {
    const col = `"${validarColumna(db, tabla, f.col)}"`;
    if (f.op === "in") {
      const vals = Array.isArray(f.val) ? f.val : [];
      if (!vals.length) { sql.push("0"); continue; }
      sql.push(`${col} IN (${vals.map(() => "?").join(",")})`); vals.forEach((v) => args.push(aSQL(v)));
    } else if (f.op === "is") {
      sql.push(f.val === null ? `${col} IS NULL` : `${col} IS NOT NULL`);
    } else if (OPS[f.op]) {
      if (f.val === null) { sql.push(f.op === "neq" ? `${col} IS NOT NULL` : `${col} IS NULL`); continue; }
      sql.push(`${col} ${OPS[f.op]} ?`); args.push(aSQL(f.val));
    } else throw new ErrorDB(`operador no soportado: ${f.op}`, "PGRST100");
  }
  return { where: sql.length ? " WHERE " + sql.join(" AND ") : "", args };
}

function filasVisibles(ctx, tabla, filtros, orden) {
  validarTabla(ctx.db, tabla);
  const { where, args } = construirWhere(ctx.db, tabla, filtros);
  const ord = (orden || []).map((o) => `"${validarColumna(ctx.db, tabla, o.col)}" ${o.asc === false ? "DESC" : "ASC"}`);
  const sql = `SELECT rowid AS _rowid_, * FROM "${tabla}"${where}${ord.length ? " ORDER BY " + ord.join(", ") : ""}`;
  const leer = politica(tabla, "read");
  return ctx.db.prepare(sql).all(...args).map((r) => aFila(tabla, r)).filter((r) => leer(ctx, r));
}

function proyectar(ctx, tabla, filas, nodos) {
  const hayTodo = nodos.some((n) => n.tipo === "todo");
  const cols = nodos.filter((n) => n.tipo === "col").map((n) => n.nombre);
  cols.forEach((c) => validarColumna(ctx.db, tabla, c));
  const embebidos = nodos.filter((n) => n.tipo === "rel").map((n) => ({ n, datos: embeber(ctx, tabla, filas, n) }));
  return filas.map((f, i) => {
    const o = {};
    if (hayTodo) Object.keys(f).forEach((k) => { if (k !== "_rowid_") o[k] = f[k]; });
    cols.forEach((c) => { o[c] = f[c]; });
    embebidos.forEach(({ n, datos }) => { o[n.alias] = datos[i]; });
    return o;
  });
}

function embeber(ctx, padre, filasPadre, nodo) {
  const rel = RELACIONES[`${padre}>${nodo.tabla}`];
  if (!rel) throw new ErrorDB(`Could not find a relationship between '${padre}' and '${nodo.tabla}'`, "PGRST200");
  const leer = politica(nodo.tabla, "read");
  if (rel.tipo === "uno") {
    const ids = [...new Set(filasPadre.map((f) => f[rel.fk]).filter((v) => v != null))];
    const hijas = ids.length
      ? ctx.db.prepare(`SELECT * FROM "${nodo.tabla}" WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids).map((r) => aFila(nodo.tabla, r)).filter((r) => leer(ctx, r))
      : [];
    const proy = proyectar(ctx, nodo.tabla, hijas, nodo.hijos);
    const porId = new Map(hijas.map((h, i) => [h.id, proy[i]]));
    return filasPadre.map((f) => (f[rel.fk] != null && porId.get(f[rel.fk])) || null);
  }
  const ids = filasPadre.map((f) => f.id);
  if (!ids.length) return [];
  const hijas = ctx.db.prepare(`SELECT * FROM "${nodo.tabla}" WHERE "${rel.fk}" IN (${ids.map(() => "?").join(",")})`).all(...ids)
    .map((r) => aFila(nodo.tabla, r)).filter((r) => leer(ctx, r));
  const proy = proyectar(ctx, nodo.tabla, hijas, nodo.hijos);
  const grupos = new Map();
  hijas.forEach((h, i) => { const k = h[rel.fk]; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(proy[i]); });
  return filasPadre.map((f) => grupos.get(f.id) || []);
}

function ejecutarSelect(ctx, q) {
  let filas = filasVisibles(ctx, q.table, q.filters, q.order);
  if (q.limit != null) filas = filas.slice(0, Math.max(0, Number(q.limit) | 0));
  return proyectar(ctx, q.table, filas, parseSelect(q.select));
}

/* ---------- Escritura ---------- */
const TRANSICIONES = {
  pendiente_pago: ["cancelado"], pagado: ["en_preparacion", "cancelado"],
  en_preparacion: ["en_ruta", "cancelado"], en_ruta: ["entregado"], entregado: [], cancelado: [],
};
const COLUMNAS_EDITABLES = { pedidos: ["estado", "notas"] };

function columnasPermitidas(ctx, tabla) {
  if (tabla === "perfiles") {
    let c = ["nombre", "apellido", "telefono", "rut", "razon_social", "giro", "es_empresa"];
    if (ctx.esAdmin) c = c.concat(["rol", "puntos_saldo", "nivel_precio_id", "activo"]);
    else if (puede(ctx, "clientes.gestionar")) c = c.concat(["nivel_precio_id", "activo"]);
    return c;
  }
  return COLUMNAS_EDITABLES[tabla] || null;   // null = todas las columnas de la tabla
}

function limpiarValores(ctx, tabla, valores, soloPermitidas) {
  const cols = columnas(ctx.db, tabla), permitidas = soloPermitidas ? columnasPermitidas(ctx, tabla) : null;
  const o = {};
  for (const [k, v] of Object.entries(valores || {})) {
    if (!cols.includes(k)) throw new ErrorDB(`Could not find the '${k}' column of '${tabla}' in the schema cache`, "PGRST204");
    if (permitidas && !permitidas.includes(k)) continue;
    o[k] = aSQL(v);
  }
  return o;
}

/* Traduce errores de SQLite a códigos de Postgres que entiende el panel */
function traducir(e) {
  if (e instanceof ErrorDB) return e;
  const m = String(e && e.message || e);
  if (/UNIQUE constraint failed/i.test(m)) return new ErrorDB("duplicate key value violates unique constraint", "23505", 409);
  if (/CHECK constraint failed/i.test(m)) return new ErrorDB("new row violates check constraint", "23514", 400);
  if (/NOT NULL constraint failed/i.test(m)) return new ErrorDB("null value in column violates not-null constraint", "23502", 400);
  if (/FOREIGN KEY constraint failed/i.test(m)) return new ErrorDB("violates foreign key constraint", "23503", 409);
  return e;
}

function insertarFila(ctx, tabla, valores) {
  const fila = limpiarValores(ctx, tabla, valores, false);
  const cols = columnas(ctx.db, tabla);
  if (cols.includes("id") && fila.id == null && !["categorias", "zonas_despacho", "comunas_cobertura", "niveles_precio", "historial_pedido", "pagos", "movimientos_puntos", "documentos_tributarios"].includes(tabla)) fila.id = uuid();
  const probe = aFila(tabla, fila);
  if (!politica(tabla, "insert")(ctx, probe)) throw new ErrorDB(`new row violates row-level security policy for table "${tabla}"`, "42501", 403);
  const ks = Object.keys(fila);
  const r = ctx.db.prepare(`INSERT INTO "${tabla}" (${ks.map((k) => `"${k}"`).join(",")}) VALUES (${ks.map(() => "?").join(",")})`).run(...ks.map((k) => fila[k]));
  return aFila(tabla, ctx.db.prepare(`SELECT rowid AS _rowid_, * FROM "${tabla}" WHERE rowid = ?`).get(r.lastInsertRowid));
}

/* Triggers de pedidos: historial de estados y devolución del uso del cupón al cancelar */
function alCambiarEstado(ctx, antes, despues) {
  ctx.db.prepare("INSERT INTO historial_pedido (pedido_id, estado_anterior, estado_nuevo, cambiado_por) VALUES (?,?,?,?)").run(antes.id, antes.estado, despues, ctx.uid);
  if (despues === "cancelado" && antes.cupon_id)
    ctx.db.prepare("UPDATE cupones SET usos_actuales = MAX(usos_actuales - 1, 0) WHERE id = ?").run(antes.cupon_id);
}

function actualizarFila(ctx, tabla, fila, valores) {
  const nuevos = limpiarValores(ctx, tabla, valores, true);
  if (tabla === "pedidos" && nuevos.estado !== undefined && nuevos.estado !== fila.estado) {
    if (!(TRANSICIONES[fila.estado] || []).includes(nuevos.estado))
      throw new ErrorDB("Cambio de estado no permitido: el estado «pagado» lo confirma solo el pago.", "P0001", 400);
  }
  const ks = Object.keys(nuevos);
  if (tabla === "perfiles") { ks.push("updated_at"); nuevos.updated_at = new Date().toISOString(); }
  if (!ks.length) return fila;
  ctx.db.prepare(`UPDATE "${tabla}" SET ${ks.map((k) => `"${k}" = ?`).join(", ")} WHERE rowid = ?`).run(...ks.map((k) => nuevos[k]), fila._rowid_);
  if (tabla === "pedidos" && nuevos.estado !== undefined && nuevos.estado !== fila.estado) alCambiarEstado(ctx, fila, nuevos.estado);
  return aFila(tabla, ctx.db.prepare(`SELECT rowid AS _rowid_, * FROM "${tabla}" WHERE rowid = ?`).get(fila._rowid_));
}

/* Filas que el usuario puede ver Y modificar */
function filasModificables(ctx, tabla, filtros) {
  const permiso = politica(tabla, "update");
  return filasVisibles(ctx, tabla, filtros).filter((r) => permiso(ctx, r));
}

function ejecutar(ctx, q) {
  const tabla = q.table;
  validarTabla(ctx.db, tabla);
  const hacer = () => {
    let resultado = [];
    switch (q.method) {
      case "select": return ejecutarSelect(ctx, q);
      case "insert": {
        const lista = Array.isArray(q.values) ? q.values : [q.values];
        resultado = lista.map((v) => insertarFila(ctx, tabla, v));
        break;
      }
      case "update": {
        resultado = filasModificables(ctx, tabla, q.filters).map((f) => actualizarFila(ctx, tabla, f, q.values));
        break;
      }
      case "upsert": {
        const claves = String(q.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        const lista = Array.isArray(q.values) ? q.values : [q.values];
        for (const v of lista) {
          const filtros = claves.map((c) => ({ col: c, op: "eq", val: v[c] }));
          const existentes = claves.length ? filasModificables(ctx, tabla, filtros) : [];
          if (existentes.length) resultado.push(actualizarFila(ctx, tabla, existentes[0], v));
          else if (claves.length && ctx.db.prepare(`SELECT 1 FROM "${tabla}"${construirWhere(ctx.db, tabla, filtros).where}`).get(...construirWhere(ctx.db, tabla, filtros).args)) { /* existe pero no puede modificarlo */ }
          else resultado.push(insertarFila(ctx, tabla, v));
        }
        break;
      }
      case "delete": {
        const permiso = politica(tabla, "delete");
        resultado = filasVisibles(ctx, tabla, q.filters).filter((r) => permiso(ctx, r));
        for (const f of resultado) ctx.db.prepare(`DELETE FROM "${tabla}" WHERE rowid = ?`).run(f._rowid_);
        break;
      }
      default: throw new ErrorDB("método no soportado", "PGRST100");
    }
    return q.select ? proyectar(ctx, tabla, resultado, parseSelect(q.select)) : null;
  };
  return ctx.db.transaction(hacer)();
}

/* Punto de entrada: devuelve { data, error } como supabase-js */
function consultar(ctx, q) {
  try {
    let data = ejecutar(ctx, q);
    if (q.single && Array.isArray(data)) {
      if (data.length > 1 || (q.single === "uno" && data.length === 0))
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      data = data[0] || null;
    }
    return { data, error: null };
  } catch (e) {
    const t = traducir(e);
    if (!(t instanceof ErrorDB)) { console.error("[rest]", e); return { data: null, error: { message: String(e.message || e), code: "XX000" } }; }
    return { data: null, error: { message: t.message, code: t.code } };
  }
}

module.exports = { consultar, crearContexto, puede, ErrorDB, parseSelect, TRANSICIONES };
