/* =====================================================================
   rpc.js — Funciones del servidor (equivalentes a las funciones SQL de
   Supabase): crear_pedido(), revisar_cupon(), _evaluar_cupon() y
   confirmar_pago().
   ---------------------------------------------------------------------
   Reglas de negocio idénticas a las migraciones 01 y 04 del proyecto
   original: los precios, el despacho y los cupones se toman SIEMPRE de la
   base de datos; el navegador no decide montos. Cada función corre dentro
   de una transacción: si algo falla, no queda nada a medias.
   ===================================================================== */
const { uuid } = require("./auth");

class ErrorRPC extends Error {
  constructor(mensaje, code = "P0001") { super(mensaje); this.code = code; }
}

/* ---------- Utilidades ---------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADOS_PAGADOS = ["pagado", "en_preparacion", "en_ruta", "entregado"];

/* Fecha de hoy en Chile (AAAA-MM-DD). `ahora` se puede reemplazar en las pruebas. */
function hoyChile(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}
const sumarDias = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
const diaSemanaISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7; };

/* Teléfono chileno → 569XXXXXXXX (null si no es válido) */
function normalizarTelefono(p) {
  const d = String(p == null ? "" : p).replace(/[^0-9]/g, "");
  if (/^569[0-9]{8}$/.test(d)) return d;
  if (/^9[0-9]{8}$/.test(d)) return "56" + d;
  if (/^[0-9]{8}$/.test(d)) return "569" + d;
  return null;
}

/* RUT chileno (módulo 11) */
function esRutValido(rut) {
  const r = String(rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (r.length < 2) return false;
  const cuerpo = r.slice(0, -1);
  if (!/^[0-9]+$/.test(cuerpo)) return false;
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const resto = 11 - (suma % 11);
  return r.slice(-1) === (resto === 11 ? "0" : resto === 10 ? "K" : String(resto));
}
const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const recortar = (v, n) => { const s = String(v == null ? "" : v).trim(); return s ? s.slice(0, n) : null; };

/* ---------- Cupones: ÚNICA lógica (la usan crear_pedido y revisar_cupon) ---------- */
function evaluarCupon(db, { codigo, uid, email, tel, lineas, hoy }) {
  const c = db.prepare(`SELECT * FROM cupones WHERE codigo = ? COLLATE NOCASE AND activo = 1
                          AND (perfil_id IS NULL OR perfil_id = ?)
                          AND (vigente_desde IS NULL OR vigente_desde <= ?)
                          AND (vigente_hasta IS NULL OR vigente_hasta >= ?)`).get(String(codigo || "").trim(), uid, hoy, hoy);
  if (!c) throw new ErrorRPC("El cupón no es válido o ya venció.");
  const sub = lineas.reduce((n, l) => n + l.subtotal, 0);
  if (c.usos_maximos != null && c.usos_actuales >= c.usos_maximos) throw new ErrorRPC("El cupón ya alcanzó su límite de usos.");
  if (sub < c.compra_minima) throw new ErrorRPC(`El cupón requiere una compra mínima de $${miles(c.compra_minima)}.`);

  if (c.requiere_cuenta) {
    const u = uid ? db.prepare("SELECT is_anonymous FROM auth_users WHERE id = ?").get(uid) : null;
    if (!u || u.is_anonymous) throw new ErrorRPC("Este cupón es para clientes con cuenta. Crea tu cuenta gratis para usarlo.");
  }
  const em = String(email || "").trim().toLowerCase() || null, tl = normalizarTelefono(tel);
  const mismoCliente = "(p.perfil_id = @uid OR (@em IS NOT NULL AND lower(p.contacto_email) = @em) OR (@tl IS NOT NULL AND p.contacto_telefono = @tl))";
  const par = { uid: uid || "", em, tl };

  if (c.solo_primera_compra) {
    const compro = db.prepare(`SELECT 1 FROM pedidos p WHERE p.estado IN ('pagado','en_preparacion','en_ruta','entregado') AND ${mismoCliente} LIMIT 1`).get(par);
    if (compro) throw new ErrorRPC("Este cupón es solo para tu primera compra.");
  }
  const limite = c.solo_primera_compra ? 1 : c.usos_por_cliente;
  if (limite != null) {
    const usos = db.prepare(`SELECT COUNT(*) AS n FROM pedidos p WHERE p.cupon_id = @cid AND p.estado <> 'cancelado' AND ${mismoCliente}`).get({ ...par, cid: c.id }).n;
    if (usos >= limite) {
      if (c.solo_primera_compra) throw new ErrorRPC("Ya tienes un pedido con este cupón. Si no lo vas a pagar, cancélalo para usarlo de nuevo.");
      throw new ErrorRPC("Ya usaste este cupón el máximo de veces permitido.");
    }
  }
  const limitadoA = db.prepare("SELECT variante_id FROM cupon_variantes WHERE cupon_id = ?").all(c.id).map((x) => x.variante_id);
  const base = limitadoA.length ? lineas.filter((l) => limitadoA.includes(l.variante_id)).reduce((n, l) => n + l.subtotal, 0) : sub;
  if (base <= 0) throw new ErrorRPC("El cupón no aplica a los productos de tu carrito.");
  const descuento = c.tipo === "porcentaje" ? Math.round(base * Math.min(c.valor, 100) / 100) : Math.min(c.valor, base);
  return { cupon_id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor, descuento };
}

/* ---------- revisar_cupon(p_codigo, p_items): solo lee, no gasta usos ---------- */
function revisarCupon(ctx, { p_codigo, p_items }, ahora) {
  const db = ctx.db;
  if (!String(p_codigo || "").trim()) return { valido: false, mensaje: "Escribe un código." };
  if (!Array.isArray(p_items) || !p_items.length || p_items.length > 50) return { valido: false, mensaje: "Tu carrito está vacío." };
  if (p_items.some((i) => !i || !UUID_RE.test(String(i.variante_id || ""))))
    return { valido: false, mensaje: "Tu carrito tiene un producto que ya no existe." };
  const nivel = (ctx.perfil && ctx.perfil.nivel_precio_id) || 1;
  const cant = new Map();
  p_items.forEach((i) => cant.set(i.variante_id, (cant.get(i.variante_id) || 0) + (parseInt(i.cantidad, 10) || 0)));
  const lineas = [];
  for (const [vid, c] of cant) {
    const v = db.prepare(`SELECT vp.id, pv.precio FROM variantes_producto vp JOIN productos p ON p.id = vp.producto_id AND p.activo = 1
                            JOIN precios_variante pv ON pv.variante_id = vp.id AND pv.nivel_precio_id = ?
                           WHERE vp.id = ? AND vp.activo = 1`).get(nivel, vid);
    if (v) lineas.push({ variante_id: v.id, subtotal: v.precio * Math.min(Math.max(c, 1), 200) });
  }
  const u = ctx.uid ? db.prepare("SELECT email, is_anonymous FROM auth_users WHERE id = ?").get(ctx.uid) : null;
  try {
    const r = evaluarCupon(db, { codigo: p_codigo, uid: ctx.uid, email: u && !u.is_anonymous ? u.email : null, tel: ctx.perfil && ctx.perfil.telefono, lineas, hoy: hoyChile(ahora) });
    return { valido: true, ...r };
  } catch (e) {
    if (e instanceof ErrorRPC) return { valido: false, mensaje: e.message };
    throw e;
  }
}

/* ---------- crear_pedido(...) ---------- */
function crearPedido(ctx, args, ahora) {
  const db = ctx.db;
  return db.transaction(() => {
    const { p_items, p_direccion, p_contacto, p_entrega, p_documento, p_cupon_codigo, p_notas } = args || {};
    const uid = ctx.uid, hoy = hoyChile(ahora);
    if (!uid) throw new ErrorRPC("Debes iniciar sesión o continuar como invitado para comprar.", "28000");
    const perfil = ctx.perfil;
    if (!perfil || !perfil.activo) throw new ErrorRPC("Tu cuenta no está habilitada para comprar.");

    if (!Array.isArray(p_items) || !p_items.length) throw new ErrorRPC("El carrito está vacío.");
    if (p_items.length > 50) throw new ErrorRPC("Demasiados productos en un solo pedido.");

    const c = p_contacto || {};
    const nombre = recortar(c.nombre, 80), tel = normalizarTelefono(c.telefono), email = (recortar(c.email, 120) || "").toLowerCase() || null;
    if (!nombre) throw new ErrorRPC("Ingresa tu nombre.");
    if (!tel) throw new ErrorRPC("Ingresa un celular válido (ej: 9 1234 5678).");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorRPC("Ingresa un correo válido.");

    /* Fecha de entrega: día hábil (lun-vie), desde mañana y hasta 45 días */
    let fecha;
    const pedidaF = p_entrega && String(p_entrega.fecha || "").trim();
    if (pedidaF) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pedidaF) || isNaN(Date.parse(pedidaF + "T00:00:00Z"))) throw new ErrorRPC("La fecha de entrega no es válida.");
      fecha = pedidaF;
      if (fecha <= hoy || fecha > sumarDias(hoy, 45) || diaSemanaISO(fecha) > 5) throw new ErrorRPC("La fecha de entrega debe ser un día hábil a partir de mañana.");
    } else {
      fecha = sumarDias(hoy, 1);
      while (diaSemanaISO(fecha) > 5) fecha = sumarDias(fecha, 1);
    }

    /* Documento tributario */
    let tipoDoc = "boleta", rut = null, razon = null, giro = null;
    if (String((p_documento && p_documento.tipo) || "boleta").toLowerCase() === "factura") {
      tipoDoc = "factura";
      rut = String(p_documento.rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
      razon = recortar(p_documento.razon_social, 120); giro = recortar(p_documento.giro, 120);
      if (!esRutValido(rut)) throw new ErrorRPC("El RUT para la factura no es válido.");
      if (!razon || !giro) throw new ErrorRPC("Para factura indica razón social y giro.");
      rut = rut.slice(0, -1) + "-" + rut.slice(-1);
    }

    /* Dirección y zona de despacho */
    const d = p_direccion || {};
    const cob = db.prepare(`SELECT c.comuna, z.id AS zona_id, z.costo_despacho FROM comunas_cobertura c
                              JOIN zonas_despacho z ON z.id = c.zona_id
                             WHERE lower(c.comuna) = lower(?) AND c.activo = 1 AND z.activo = 1`).get(String(d.comuna || "").trim());
    if (!cob) throw new ErrorRPC("No tenemos despacho a la comuna indicada.");
    const calle = String(d.calle || "").trim(), numero = String(d.numero || "").trim();
    if (!calle || !numero) throw new ErrorRPC("Falta la calle o el número de la dirección.");
    const depto = String(d.depto || "").trim();
    let dir = db.prepare(`SELECT id FROM direcciones WHERE perfil_id = ? AND lower(calle) = lower(?) AND numero = ? AND COALESCE(depto,'') = ? AND comuna = ? LIMIT 1`)
      .get(uid, calle, numero, depto, cob.comuna);
    let dirId = dir && dir.id;
    if (!dirId) {
      dirId = uuid();
      db.prepare("INSERT INTO direcciones (id, perfil_id, zona_id, calle, numero, depto, comuna, referencia) VALUES (?,?,?,?,?,?,?,?)")
        .run(dirId, uid, cob.zona_id, calle.slice(0, 120), numero.slice(0, 20), recortar(depto, 40), cob.comuna, recortar(d.referencia, 200));
    }

    /* Completa el perfil si faltan datos (invitados) */
    db.prepare("UPDATE perfiles SET telefono = COALESCE(telefono, ?), nombre = CASE WHEN nombre = 'Invitado' THEN ? ELSE nombre END WHERE id = ?").run(tel, nombre, uid);

    /* Pedido (los montos se completan abajo) */
    const pedidoId = uuid();
    const numeroPedido = (db.prepare("SELECT COALESCE(MAX(numero), 1000) AS n FROM pedidos").get().n) + 1;
    db.prepare(`INSERT INTO pedidos (id, numero, perfil_id, direccion_id, zona_id, nivel_precio_id, notas, contacto_nombre, contacto_telefono, contacto_email,
                  fecha_entrega, tipo_documento, doc_rut, doc_razon_social, doc_giro)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(pedidoId, numeroPedido, uid, dirId, cob.zona_id, perfil.nivel_precio_id, recortar(p_notas, 500), nombre, tel, email, fecha, tipoDoc, rut, razon, giro);

    /* Detalle: el precio SIEMPRE sale de la base, según el nivel del cliente */
    const cant = new Map();
    for (const i of p_items) {
      if (!i || !UUID_RE.test(String(i.variante_id || ""))) throw new ErrorRPC("Un producto del carrito ya no está disponible.");
      cant.set(i.variante_id, (cant.get(i.variante_id) || 0) + (parseInt(i.cantidad, 10) || 0));
    }
    let subtotal = 0;
    for (const [vid, cantidad] of cant) {
      if (!cantidad || cantidad < 1 || cantidad > 200) throw new ErrorRPC("Cantidad inválida en el carrito.");
      const v = db.prepare(`SELECT vp.id, vp.nombre, vp.stock, vp.controla_stock, pv.precio FROM variantes_producto vp
                              JOIN productos p ON p.id = vp.producto_id
                              LEFT JOIN precios_variante pv ON pv.variante_id = vp.id AND pv.nivel_precio_id = ?
                             WHERE vp.id = ? AND vp.activo = 1 AND p.activo = 1`).get(perfil.nivel_precio_id, vid);
      if (!v) throw new ErrorRPC("Un producto del carrito ya no está disponible.");
      if (v.precio == null) throw new ErrorRPC(`El producto ${v.nombre} no tiene precio configurado.`);
      if (v.controla_stock && v.stock < cantidad) throw new ErrorRPC(`No hay stock suficiente de ${v.nombre}.`);
      db.prepare("INSERT INTO detalle_pedido (id, pedido_id, variante_id, cantidad, precio_unitario, subtotal) VALUES (?,?,?,?,?,?)")
        .run(uuid(), pedidoId, v.id, cantidad, v.precio, v.precio * cantidad);
      subtotal += v.precio * cantidad;
    }

    /* Cupón: todas las reglas en evaluarCupon() */
    let cuponId = null, descuento = 0;
    if (recortar(p_cupon_codigo, 50)) {
      const lineas = db.prepare("SELECT variante_id, subtotal FROM detalle_pedido WHERE pedido_id = ?").all(pedidoId);
      const r = evaluarCupon(db, { codigo: p_cupon_codigo, uid, email, tel, lineas, hoy });
      cuponId = r.cupon_id; descuento = r.descuento;
      db.prepare("UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id = ?").run(cuponId);
    }

    /* Despacho: gratis sobre el mínimo en zonas con costo */
    const par = (k) => { const x = db.prepare("SELECT valor FROM parametros WHERE clave = ?").get(k); return x && x.valor !== "" && x.valor != null ? parseInt(x.valor, 10) : null; };
    let despacho = cob.costo_despacho;
    const gratis = par("envio_gratis_minimo");
    if (despacho > 0 && gratis != null && subtotal >= gratis) despacho = 0;
    const total = Math.max(subtotal - descuento, 0) + despacho;
    const clpPunto = par("clp_por_punto");
    const puntos = clpPunto > 0 ? Math.floor(Math.max(subtotal - descuento, 0) / clpPunto) : 0;

    db.prepare("UPDATE pedidos SET subtotal = ?, costo_despacho = ?, descuento_cupon = ?, cupon_id = ?, total = ?, puntos_ganados = ? WHERE id = ?")
      .run(subtotal, despacho, descuento, cuponId, total, puntos, pedidoId);

    return { id: pedidoId, numero: numeroPedido, estado: "pendiente_pago", subtotal, costo_despacho: despacho,
             descuento_cupon: descuento, total, puntos_ganados: puntos, fecha_entrega: fecha };
  })();
}

/* ---------- confirmar_pago: SOLO la usa el servidor (pago local simulado) ---------- */
function confirmarPago(db, { pedidoId, paymentId, monto, raw, preferenceId }) {
  return db.transaction(() => {
    if (!String(paymentId || "").trim()) throw new ErrorRPC("Falta el id de pago.");
    if (db.prepare("SELECT 1 FROM pagos WHERE mp_payment_id = ?").get(paymentId)) return { ok: true, repetido: true };
    const p = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(pedidoId);
    if (!p) throw new ErrorRPC("Pedido no encontrado.");
    const registrar = (estado, m) => db.prepare("INSERT INTO pagos (pedido_id, estado, monto, mp_payment_id, mp_preference_id, raw_response, fecha_pago) VALUES (?,?,?,?,?,?,?)")
      .run(pedidoId, estado, m, paymentId, preferenceId || null, raw ? JSON.stringify(raw) : null, new Date().toISOString());
    if (p.estado !== "pendiente_pago") { registrar("aprobado", monto); return { ok: false, motivo: "pedido_no_pendiente", estado: p.estado }; }
    if (monto !== p.total) { registrar("rechazado", monto || 0); return { ok: false, motivo: "monto_no_coincide", esperado: p.total, recibido: monto }; }
    registrar("aprobado", monto);
    const hist = db.prepare("INSERT INTO historial_pedido (pedido_id, estado_anterior, estado_nuevo, nota) VALUES (?,?,?,?)");
    db.prepare("UPDATE pedidos SET estado = 'en_preparacion' WHERE id = ?").run(pedidoId);
    hist.run(pedidoId, "pendiente_pago", "pagado", `Pago confirmado (${paymentId})`);
    hist.run(pedidoId, "pagado", "en_preparacion", "Automático al confirmar el pago");
    for (const d of db.prepare("SELECT variante_id, cantidad FROM detalle_pedido WHERE pedido_id = ?").all(pedidoId))
      db.prepare("UPDATE variantes_producto SET stock = MAX(stock - ?, 0) WHERE id = ? AND controla_stock = 1").run(d.cantidad, d.variante_id);
    if (p.puntos_ganados > 0) {
      const saldo = db.prepare("SELECT puntos_saldo FROM perfiles WHERE id = ?").get(p.perfil_id).puntos_saldo || 0;
      db.prepare("INSERT INTO movimientos_puntos (perfil_id, pedido_id, tipo, puntos, saldo_posterior, descripcion) VALUES (?,?,?,?,?,?)")
        .run(p.perfil_id, pedidoId, "acumulacion", p.puntos_ganados, saldo + p.puntos_ganados, `Compra pedido #${p.numero}`);
      db.prepare("UPDATE perfiles SET puntos_saldo = ? WHERE id = ?").run(saldo + p.puntos_ganados, p.perfil_id);
    }
    return { ok: true, estado: "en_preparacion", numero: p.numero, puntos_sumados: p.puntos_ganados };
  })();
}

const RPC = { crear_pedido: crearPedido, revisar_cupon: revisarCupon };

module.exports = { RPC, ErrorRPC, crearPedido, revisarCupon, confirmarPago, evaluarCupon, normalizarTelefono, esRutValido, hoyChile, ESTADOS_PAGADOS, UUID_RE };
