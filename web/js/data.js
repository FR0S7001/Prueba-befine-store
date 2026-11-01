/* =====================================================================
   data.js — API de Befine Store conectada a la BASE LOCAL (SQLite)
   ---------------------------------------------------------------------
   La interfaz (home, catálogo, ficha, checkout, cuenta) habla SOLO con
   `window.Befine`, con los mismos métodos y el mismo formato de salida
   que la versión con Supabase. Lo único que cambió es de dónde vienen
   los datos: ahora de la base local (data/befine.db) a través del
   servidor de server/index.js.

   Requisito: cargar js/local-client.js ANTES que este archivo. Ese archivo
   define window.supabase.createClient con la misma forma que supabase-js,
   pero apuntando a la API local (/api).

   Para volver a Supabase: cargar supabase-js desde su CDN en lugar de
   local-client.js y poner de nuevo la URL y la clave públicas del proyecto.
   ===================================================================== */

/* ---------- Conexión (API local del servidor de Befine) ---------- */
const SUPABASE_URL = "/api";
const SUPABASE_ANON_KEY = "local";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Ofertas (precio "habitual" tachado) ----------
   El schema hoy guarda SOLO `precio`, no `precio_comparacion`. Para no
   tocar la base en producción, el precio tachado (marketing) vive aquí,
   mapeado por SKU (estable). Si mañana agregan la columna a la tabla
   precios_variante, se borra este bloque y se lee de la BD. */
const OFERTAS = {
  "BEF-DISP-MESA":      90990,
  "BEF-DISP-SINOCULTO": 139990,
  "BEF-BID-12":         5490,
  "BEF-BID-20":         6500,
  "BEF-REC-12":         2400,
  "BEF-REC-20-BEFINE":  3500,
  "BEF-REC-20-OTRA":    3500,
};

/* ---------- Reseñas ----------
   Se leen desde la función `resenas-google`. En modo local devuelve reseñas
   de EJEMPLO (server/functions.js); no se llama a Google. */
const RESENAS_FN = "resenas-google";

/* ---------- Aviso destacado para recargas ----------
   Mensaje visible en la tarjeta de recarga. Se aplica a los productos cuyos
   SKU empiezan con "BEF-REC-". Texto editable (pendiente migrar al Admin). */
const AVISO_RECARGA = "Aceptamos envases de otras marcas"; // se muestra en MAYÚSCULAS por CSS

/* ---------- Selección de productos por SKU (estable entre entornos) ----------
   Los UUID cambian entre bases; el SKU no. Por eso los "destacados" y el
   producto protagonista del hero se eligen por SKU, no por id. */
const DESTACADOS_SKU = ["BEF-PACK-4REC12", "BEF-DISP-USB", "BEF-BID-20", "BEF-REC-12"]; // sin la Recarga 20L (ya es protagonista del inicio)
const HERO_SKU = "BEF-REC-20-BEFINE"; // Recarga Bidón 20 L (protagonista del inicio)

/* ---------- Consulta base: producto + categoría + variantes + precios ---------- */
const SELECT_PRODUCTO =
  "id,categoria_id,nombre,descripcion,imagen_url,activo," +
  "categorias(nombre,slug)," +
  "variantes_producto(id,producto_id,sku,nombre,atributos,stock,activo," +
  "precios_variante(nivel_precio_id,precio))";

/* Resuelve el id del nivel de precio "retail" una sola vez (no lo quema). */
let _retailId = null;
async function _nivelRetail() {
  if (_retailId != null) return _retailId;
  const { data } = await sb.from("niveles_precio").select("id,codigo").order("id");
  const r = (data || []).find((n) => /retail/i.test(n.codigo || "")) || (data || [])[0];
  _retailId = r ? r.id : 1;
  return _retailId;
}

/* Convierte una fila de Supabase al MISMO view-model que usaba la maqueta,
   para que cards.js / home.js / catalogo.js / producto.js no cambien. */
function _armarProducto(p, nivel) {
  const variantes = (p.variantes_producto || [])
    .filter((v) => v.activo)
    .sort((a, b) => (a.sku || "").localeCompare(b.sku || "")) // orden estable (Befine antes que Otra)
    .map((v) => {
      const pr =
        (v.precios_variante || []).find((x) => x.nivel_precio_id === nivel) ||
        (v.precios_variante || [])[0];
      return {
        id: v.id,
        producto_id: v.producto_id,
        sku: v.sku,
        nombre: v.nombre,
        atributos: v.atributos || {},
        stock: v.stock,
        activo: v.activo,
        precio: pr ? pr.precio : null,
        precio_comparacion: OFERTAS[v.sku] || null,
      };
    });
  const precios = variantes.map((v) => v.precio).filter((n) => n != null);
  const desde = precios.length ? Math.min(...precios) : null;
  const varMin = variantes.find((v) => v.precio === desde);
  const cat = p.categorias || {};
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    imagen_url: p.imagen_url,
    activo: p.activo,
    categoria: cat.nombre || null,
    categoria_slug: cat.slug || null,
    variantes,
    desde_precio: desde,
    desde_comparacion: varMin ? varMin.precio_comparacion : null,
    aviso: variantes.some((v) => (v.sku || "").startsWith("BEF-REC-")) ? AVISO_RECARGA : null,
  };
}

/* =====================================================================
   Befine — la "API". La interfaz SOLO habla con esto (igual que antes).
   Todos los métodos devuelven Promesas (ahora reales, contra la base local).
   ===================================================================== */
/* Normaliza texto para buscar sin distinguir acentos ni mayúsculas:
   "Bidón" -> "bidon", así "bidon" también encuentra "Bidón". */
function _norm(str) {
  return (str || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const Befine = {
  /* Formatea CLP: 2500 -> "$2.500" */
  clp(n) {
    return "$" + Number(n).toLocaleString("es-CL");
  },

  /* Categorías para los filtros del catálogo */
  async listCategorias() {
    const { data, error } = await sb.from("categorias").select("*").order("id");
    if (error) { console.error("listCategorias:", error.message); return []; }
    return data || [];
  },

  /* Lista de productos activos, con filtro opcional por categoría (slug) y búsqueda (q). */
  async listProductos({ categoria = null, q = null } = {}) {
    const nivel = await _nivelRetail();
    const { data, error } = await sb
      .from("productos")
      .select(SELECT_PRODUCTO)
      .eq("activo", true)
      .order("created_at", { ascending: true });
    if (error) { console.error("listProductos:", error.message); return []; }
    let items = (data || []).map((p) => _armarProducto(p, nivel));
    if (categoria) items = items.filter((p) => p.categoria_slug === categoria);
    if (q) {
      const t = _norm(q);
      items = items.filter((p) =>
        _norm((p.nombre || "") + " " + (p.descripcion || "") + " " + (p.categoria || "")).includes(t)
      );
    }
    return items;
  },

  /* Un producto por id (UUID real), con variantes y precios (para la ficha) */
  async getProducto(id) {
    const nivel = await _nivelRetail();
    const { data, error } = await sb
      .from("productos")
      .select(SELECT_PRODUCTO)
      .eq("id", id)
      .eq("activo", true)
      .maybeSingle();
    if (error) { console.error("getProducto:", error.message); return null; }
    return data ? _armarProducto(data, nivel) : null;
  },

  /* Producto protagonista del hero (Recarga 20 L), elegido por SKU estable */
  async getHero() {
    const nivel = await _nivelRetail();
    // Busca la variante por SKU y de ahí sube al producto completo.
    const { data: v } = await sb
      .from("variantes_producto")
      .select("producto_id")
      .eq("sku", HERO_SKU)
      .maybeSingle();
    if (!v) return null;
    const { data, error } = await sb
      .from("productos")
      .select(SELECT_PRODUCTO)
      .eq("id", v.producto_id)
      .maybeSingle();
    if (error) { console.error("getHero:", error.message); return null; }
    return data ? _armarProducto(data, nivel) : null;
  },

  /* Destacados para la home ("Lo más pedido"), elegidos por SKU y en orden */
  async getDestacados() {
    const items = await this.listProductos();
    const bySku = (sku) => items.find((p) => (p.variantes || []).some((v) => v.sku === sku));
    return DESTACADOS_SKU.map(bySku).filter(Boolean);
  },

  /* Reseñas reales para la home. Devuelve
     { fuente, promedio, total, url_resenas, url_escribir, items[] } o null si falla
     (la home oculta la sección en ese caso, sin romper la página). */
  async getResenas() {
    // Costo cero: cada visitante reutiliza su copia por 1 hora (no vuelve a llamar).
    const K = "befine_resenas", TTL = 60 * 60 * 1000;
    try { const c = JSON.parse(localStorage.getItem(K) || "null"); if (c && Date.now() - c.t < TTL) return c.data; } catch (e) {}
    try {
      const { data, error } = await sb.functions.invoke(RESENAS_FN, { method: "GET" });
      if (error || !data || data.error) { console.error("getResenas:", error?.message || data?.error); return null; }
      try { localStorage.setItem(K, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
      return data;
    } catch (e) { console.error("getResenas:", e); return null; }
  },

  /* Zonas de despacho (para el checkout). Lectura pública por RLS. */
  async listZonas() {
    const { data, error } = await sb
      .from("zonas_despacho")
      .select("*")
      .eq("activo", true)
      .order("id");
    if (error) { console.error("listZonas:", error.message); return []; }
    return data || [];
  },

  /* Perfil del usuario autenticado (o null si es visitante). */
  async getPerfil() {
    return this.auth.sesion();
  },
};

/* =====================================================================
   CUENTA — cuentas LOCALES (server/auth.js). Correo+contraseña y recuperación.
   Modo local: no hay correos de confirmación ni ingreso con Google. La
   recuperación de contraseña imprime el enlace en la consola del servidor.
   ===================================================================== */
// URL base del sitio (para los enlaces de correo y el regreso desde Google). En file:// no aplica.
const APP_URL = /^https?:/.test(location.protocol) ? location.href.replace(/[^/]*([?#].*)?$/, "") : null;

// Mensajes de Supabase → español claro para el cliente
function _msgAuth(e) {
  const m = ((e && (e.message || e.error_description)) || String(e || "")).toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ya existe una cuenta con ese correo. Ingresa o recupera tu contraseña.";
  if (m.includes("email not confirmed")) return "Confirma tu correo: te enviamos un enlace al registrarte.";
  if (m.includes("password") && (m.includes("should contain") || m.includes("weak") || m.includes("at least") || m.includes("characters")))
    return "La contraseña debe tener al menos 8 caracteres, con mayúscula, minúscula, número y símbolo (. @ # ! …).";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Espera un minuto e inténtalo de nuevo.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "El ingreso con Google aún no está activado.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  return "No pudimos completar la acción. Inténtalo nuevamente.";
}

Befine.auth = {
  /* Sesión actual + datos de public.perfiles → { id, email, nombre, telefono, rut, razon_social, giro, es_empresa, puntos, rol } | null */
  async sesion() {
    try {
      const { data } = await sb.auth.getSession();
      const u = data && data.session && data.session.user;
      if (!u || u.is_anonymous) return null;
      const { data: pf } = await sb.from("perfiles")
        .select("nombre,apellido,telefono,rut,razon_social,giro,es_empresa,puntos_saldo,rol")
        .eq("id", u.id).maybeSingle();
      const meta = u.user_metadata || {};
      return {
        id: u.id, email: u.email,
        nombre: (pf && pf.nombre) || meta.nombre || meta.full_name || (u.email || "").split("@")[0],
        apellido: pf && pf.apellido, telefono: (pf && pf.telefono) || meta.telefono || "",
        rut: pf && pf.rut, razon_social: pf && pf.razon_social, giro: pf && pf.giro,
        es_empresa: !!(pf && pf.es_empresa), puntos: (pf && pf.puntos_saldo) || 0,
        rol: (pf && pf.rol) || "cliente", // "cliente" o un rol del equipo (admin, chofer…)
      };
    } catch (e) { return null; }
  },
  async ingresar(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { ok: false, error: _msgAuth(error) } : { ok: true };
  },
  /* Registro: el trigger handle_new_user crea la fila en perfiles con el nombre enviado */
  async registrar({ nombre, email, password, telefono }) {
    // Si compró como invitado (sesión anónima), se convierte ESE usuario en cuenta para que
    // conserve sus pedidos. En modo local no se confirma el correo:
    // se intenta guardarla de inmediato y, si aún no se puede, el enlace del correo abre
    // cuenta.html?modo=nueva para elegirla.
    const { data: ses } = await sb.auth.getSession();
    const actual = ses && ses.session && ses.session.user;
    if (actual && actual.is_anonymous) {
      const { error: e1 } = await sb.auth.updateUser({ email, data: { nombre, telefono } },
        { emailRedirectTo: APP_URL ? APP_URL + "cuenta.html?modo=nueva" : undefined });
      if (e1) return { ok: false, error: _msgAuth(e1) };
      const { error: e2 } = await sb.auth.updateUser({ password });
      if (e2) return { ok: false, error: _msgAuth(e2) };
      return { ok: true, confirmar: false };   // modo local: no hay correo de confirmación
    }
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { nombre, telefono }, emailRedirectTo: APP_URL ? APP_URL + "cuenta.html" : undefined },
    });
    if (error) return { ok: false, error: _msgAuth(error) };
    // Si el proyecto exige confirmar correo, no hay sesión todavía
    return { ok: true, confirmar: !(data && data.session) };
  },
  async google(volver) {
    if (!APP_URL) return { ok: false, error: "Google funciona al abrir el sitio desde un servidor (http/https), no como archivo local." };
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: APP_URL + (volver || "cuenta.html") } });
    return error ? { ok: false, error: _msgAuth(error) } : { ok: true };
  },
  async recuperar(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL ? APP_URL + "cuenta.html?modo=nueva" : undefined });
    return error ? { ok: false, error: _msgAuth(error) } : { ok: true };
  },
  async nuevaClave(password) {
    const { error } = await sb.auth.updateUser({ password });
    return error ? { ok: false, error: _msgAuth(error) } : { ok: true };
  },
  async salir() { await sb.auth.signOut(); },
  onCambio(cb) { return sb.auth.onAuthStateChange((evento) => cb(evento)); },
};

/* =====================================================================
   CHECKOUT — cobertura, despacho, días de entrega, pedido y pago.
   Lectura de cobertura: REAL (tablas comunas_cobertura / zonas_despacho /
   parametros, lectura pública). Crear pedido: REAL con crear_pedido() (SC-03), como
   invitado (sesión anónima) o con cuenta. Pago: Mercado Pago Checkout Pro vía Edge Function
   crear-pago; el pago lo confirma solo el servidor (mp-webhook → confirmar_pago).
   ===================================================================== */
// Contacto del negocio (pendiente migrar a parametros / Admin)
const CONTACTO = { whatsapp: "56958549641" };
// Regla de entrega: lunes a viernes, sin feriados; el pedido estándar llega el siguiente día hábil.
// FERIADOS (mejora M-01): feriados legales de Chile en "AAAA-MM-DD". Esta lista es el respaldo;
// si existe el parámetro "feriados" en la tabla parametros (editable desde el Admin), se usa ese.
// Mantener al día cada año (cubre la ventana de 20 días hábiles agendables).
const FERIADOS_CL = [
  "2026-10-12", // Encuentro de Dos Mundos
  "2026-10-31", // Día de las Iglesias Evangélicas y Protestantes
  "2026-11-01", // Día de Todos los Santos
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
  "2027-01-01", // Año Nuevo
];
const ENTREGA = { diasHabiles: [1, 2, 3, 4, 5], diasAgendables: 20, feriados: FERIADOS_CL.slice() };

/* Feriados guardados en parametros.valor: arreglo JSON ["AAAA-MM-DD", ...] o texto separado por comas.
   Devuelve solo fechas con formato válido; null si no hay ninguna (se mantiene el respaldo local). */
function _parseFeriados(valor) {
  if (!valor) return null;
  let lista;
  try { lista = JSON.parse(valor); } catch (e) { lista = String(valor).split(","); }
  if (!Array.isArray(lista)) return null;
  const ok = lista.map((x) => String(x).trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return ok.length ? ok : null;
}
// Respaldo si la BD no responde (mismos datos del schema)
const COBERTURA_RESPALDO = {
  envioGratisDesde: 7000,
  comunas: [
    { comuna: "Quilicura", zona: "Quilicura", costo: 0 },
    { comuna: "Huechuraba", zona: "Sector Norte", costo: 2500 },
    { comuna: "Recoleta", zona: "Sector Norte", costo: 2500 },
    { comuna: "Valle Grande", zona: "Sector Norte", costo: 2500 },
    { comuna: "Valle Lo Campino", zona: "Sector Norte", costo: 2500 },
  ],
};
const _iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const _esHabil = (d) => ENTREGA.diasHabiles.includes(d.getDay()) && !ENTREGA.feriados.includes(_iso(d));

Befine.contacto = CONTACTO;

/* Comunas con cobertura y su costo → { envioGratisDesde, comunas:[{comuna, zona, zona_id, costo}] } */
Befine.getCobertura = async function () {
  try {
    const [{ data: com, error: e1 }, { data: pars }] = await Promise.all([
      sb.from("comunas_cobertura").select("comuna,zona_id,zonas_despacho(nombre,costo_despacho,activo)").eq("activo", true).order("comuna"),
      sb.from("parametros").select("clave,valor").in("clave", ["envio_gratis_minimo", "feriados"]),
    ]);
    const par = (k) => (pars || []).find((x) => x.clave === k);
    const fer = _parseFeriados(par("feriados") && par("feriados").valor);
    if (fer) ENTREGA.feriados = fer;
    if (e1 || !com || !com.length) throw e1 || new Error("sin comunas");
    return {
      envioGratisDesde: par("envio_gratis_minimo") ? Number(par("envio_gratis_minimo").valor) : COBERTURA_RESPALDO.envioGratisDesde,
      comunas: com.filter((c) => !c.zonas_despacho || c.zonas_despacho.activo !== false).map((c) => ({
        comuna: c.comuna, zona_id: c.zona_id, zona: c.zonas_despacho ? c.zonas_despacho.nombre : "",
        costo: c.zonas_despacho ? c.zonas_despacho.costo_despacho : 0,
      })),
    };
  } catch (e) { return COBERTURA_RESPALDO; }
};

/* Costo de despacho que VE el cliente (el backend lo recalcula al crear el pedido) */
Befine.costoDespacho = function (cobertura, comuna, subtotal) {
  const c = cobertura && cobertura.comunas.find((x) => x.comuna === comuna);
  if (!c) return null;
  if (c.costo > 0 && subtotal >= cobertura.envioGratisDesde) return 0;
  return c.costo;
};

/* Días de entrega: { estandar: Date (siguiente día hábil), agendables: [Date...] } */
Befine.diasEntrega = function (desde = new Date()) {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const sig = () => { do { d.setDate(d.getDate() + 1); } while (!_esHabil(d)); return new Date(d); };
  const estandar = sig(), agendables = [estandar];
  while (agendables.length < ENTREGA.diasAgendables) agendables.push(sig());
  return { estandar, agendables };
};
Befine.isoFecha = _iso;

/* Mensajes de crear_pedido() → español claro. Las validaciones del servidor ya vienen en
   español (raise exception); los errores técnicos se traducen a un mensaje genérico. */
function _msgPedido(e) {
  const m = (e && e.message) || "";
  const low = m.toLowerCase();
  if (low.includes("anonymous sign-ins are disabled")) return "La compra como invitado aún no está activada. Ingresa con tu cuenta para comprar.";
  if (low.includes("failed to fetch") || low.includes("network")) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  if (low.includes("rate limit") || low.includes("too many")) return "Demasiados intentos. Espera un minuto e inténtalo de nuevo.";
  // Mensajes propios de la función (validaciones de negocio en español)
  if (m && !/permission|jwt|function|relation|column|syntax|violates|null value|pgrst/i.test(m)) return m;
  return "No pudimos crear el pedido. Inténtalo de nuevo.";
}

/* Asegura una sesión para comprar: si no hay, crea una sesión anónima de invitado
   (Supabase Anonymous Sign-Ins). Así el pedido queda con perfil_id = auth.uid() y el RLS aplica. */
async function _sesionCompra() {
  const { data } = await sb.auth.getSession();
  if (data && data.session) return data.session.user;
  const { data: d2, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return d2.user;
}

/* Crear pedido (SC-03): ÚNICA vía = función crear_pedido() en el servidor, que toma precios,
   despacho y cupones desde la base y recalcula el total (el navegador no decide montos).
   payload = { contacto:{nombre,email,telefono}, direccion:{calle,numero,depto,comuna,region,referencia},
     entrega:{tipo:'estandar'|'agendada', fecha:'AAAA-MM-DD'}, documento:{tipo:'boleta'|'factura',rut,razon_social,giro},
     items:[{variante_id,nombre,variante,cantidad,precio_unitario}], cupon? }
   Devuelve { ok, pedido } con id, numero, estado y montos DEL SERVIDOR, o { ok:false, error }. */
Befine.crearPedido = async function (payload) {
  try {
    await _sesionCompra();
    const d = payload.direccion || {}, c = payload.contacto || {};
    const { data, error } = await sb.rpc("crear_pedido", {
      p_items: (payload.items || []).map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
      p_direccion: { calle: d.calle, numero: d.numero, depto: d.depto || null, comuna: d.comuna, referencia: d.referencia || null },
      p_contacto: { nombre: c.nombre, telefono: c.telefono, email: c.email },
      p_entrega: payload.entrega || null,
      p_documento: payload.documento || { tipo: "boleta" },
      p_cupon_codigo: payload.cupon || null,
      p_notas: payload.notas || null,
    });
    if (error) return { ok: false, error: _msgPedido(error) };
    const pedido = {
      ...payload,
      id: data.id, numero: data.numero, estado: data.estado,
      subtotal: data.subtotal, costo_despacho: data.costo_despacho, descuento_cupon: data.descuento_cupon,
      total: data.total, puntos_ganados: data.puntos_ganados,
      entrega: { ...(payload.entrega || {}), fecha: data.fecha_entrega || (payload.entrega && payload.entrega.fecha) },
      created_at: new Date().toISOString(),
    };
    return { ok: true, pedido };
  } catch (e) { return { ok: false, error: _msgPedido(e) }; }
};

/* Revisar un cupón ANTES de pagar (migración 04: revisar_cupon). Solo informa: no gasta usos.
   El servidor vuelve a validar todo al crear el pedido (crear_pedido).
   items = [{variante_id, cantidad}] → { valido, codigo, descuento } o { valido:false, mensaje } */
Befine.revisarCupon = async function (codigo, items) {
  try {
    const { data, error } = await sb.rpc("revisar_cupon", {
      p_codigo: String(codigo || "").trim(),
      p_items: (items || []).map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
    });
    if (error) {
      const m = (error.message || "").toLowerCase();
      if (error.code === "PGRST202" || m.includes("could not find the function")) return { valido: false, mensaje: "Los cupones estarán disponibles muy pronto." };
      if (m.includes("failed to fetch") || m.includes("network")) return { valido: false, mensaje: "Sin conexión. Revisa tu internet e inténtalo de nuevo." };
      return { valido: false, mensaje: "No pudimos revisar el cupón. Inténtalo de nuevo." };
    }
    return data && data.valido
      ? { valido: true, codigo: data.codigo, descuento: Number(data.descuento) || 0, tipo: data.tipo, valor: data.valor }
      : { valido: false, mensaje: (data && data.mensaje) || "El cupón no es válido o ya venció." };
  } catch (e) { return { valido: false, mensaje: "No pudimos revisar el cupón. Inténtalo de nuevo." }; }
};

/* ---------- Pago con Mercado Pago Checkout Pro (HU-08 / HU-09) ----------
   1. crear_pedido() deja el pedido en 'pendiente_pago' con el total calculado por el servidor.
   2. Befine.pagar() pide a la Edge Function `crear-pago` una preferencia de pago (el monto lo lee
      el servidor desde la base; el navegador solo envía el id del pedido) y devuelve su init_point.
   3. El cliente paga en Mercado Pago y vuelve a checkout.html?pago=ok|pendiente|error&pedido=<id>.
   4. El estado 'pagado' lo pone SOLO el servidor (webhook `mp-webhook` → confirmar_pago());
      la tienda solo lo consulta con Befine.estadoPedido(). */
const PAGO_FN = "crear-pago";
const PAGO_VUELTAS = ["ok", "pendiente", "error"];
const PAGO_HOSTS = /^https:\/\/([a-z0-9-]+\.)*mercadopago\.(cl|com)\//i;   // solo se redirige a Mercado Pago
const PAGO_LOCAL = /^pago-simulado\.html\?pedido=[0-9a-f-]{36}$/i;                // modo local: página de pago simulado (mismo sitio)
const ESTADOS_PAGADOS = ["pagado", "en_preparacion", "en_ruta", "entregado"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Error de la Edge Function → mensaje para el cliente. Los mensajes propios de crear-pago ya vienen
   en español; los técnicos (secretos, JWT, red) se cambian por uno genérico. */
async function _msgPago(error) {
  try {
    const cuerpo = error && error.context && typeof error.context.json === "function" ? await error.context.json() : null;
    const m = cuerpo && cuerpo.error;
    if (m && !/secreto|token|jwt|mp_|supabase/i.test(m)) return m;
  } catch (e) { /* respuesta sin JSON */ }
  const low = ((error && error.message) || "").toLowerCase();
  if (low.includes("failed to fetch") || low.includes("failed to send") || low.includes("network")) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  return "No pudimos conectar con Mercado Pago. Inténtalo de nuevo.";
}

/* ¿La URL es una página de pago de Mercado Pago (o la página de pago simulado local)? Evita redirigir al cliente a otro sitio. */
Befine.urlPagoSegura = (url) => typeof url === "string" && (PAGO_HOSTS.test(url) || PAGO_LOCAL.test(url));

/* ¿El estado indica que el pago ya fue confirmado por el servidor? */
Befine.pedidoPagado = (estado) => ESTADOS_PAGADOS.includes(estado);

/* Crea el pago del pedido (acepta el pedido o su id). Devuelve { ok, url } para redirigir a
   Mercado Pago, o { ok:false, error }. No cambia nada en la base. */
Befine.pagar = async function (pedido) {
  const id = String((pedido && pedido.id) || pedido || "");
  if (!UUID_RE.test(id)) return { ok: false, error: "Pedido no válido." };
  try {
    const { data, error } = await sb.functions.invoke(PAGO_FN, { body: { pedido_id: id } });
    if (error) { console.error("pagar:", error.message || error); return { ok: false, error: await _msgPago(error) }; }
    if (!data || !Befine.urlPagoSegura(data.init_point)) {
      console.error("pagar: la respuesta no trae una URL de Mercado Pago válida");
      return { ok: false, error: "No pudimos conectar con Mercado Pago. Inténtalo de nuevo." };
    }
    return { ok: true, url: data.init_point, preferencia: data.preference_id || null };
  } catch (e) {
    console.error("pagar:", e);
    return { ok: false, error: "Sin conexión. Revisa tu internet e inténtalo de nuevo." };
  }
};

/* Lee la vuelta desde Mercado Pago (?pago=ok|pendiente|error&pedido=<uuid>).
   Devuelve { estado, pedido } o null si los parámetros no son válidos. */
Befine.vueltaPago = function (search) {
  const q = new URLSearchParams(search || "");
  const estado = q.get("pago"), pedido = q.get("pedido") || "";
  return PAGO_VUELTAS.includes(estado) && UUID_RE.test(pedido) ? { estado, pedido } : null;
};

/* Estado actual de un pedido del cliente (RLS: solo los propios). Devuelve el pedido o null. */
Befine.estadoPedido = async function (id) {
  if (!UUID_RE.test(String(id || ""))) return null;
  try {
    const { data, error } = await sb.from("pedidos")
      .select("id,numero,estado,total,descuento_cupon,fecha_entrega,contacto_nombre,contacto_email,tipo_documento")
      .eq("id", id)
      .maybeSingle();
    if (error) { console.error("estadoPedido:", error.message); return null; }
    return data || null;
  } catch (e) { console.error("estadoPedido:", e); return null; }
};

/* Pedidos del cliente con sesión (RLS: solo los propios). Formato que usa cuenta.js:
   [{ id, numero, estado, total, created_at, items:[{cantidad}] }] */
Befine.misPedidos = async function () {
  try {
    const { data: ses } = await sb.auth.getSession();
    const uid = ses && ses.session && ses.session.user && ses.session.user.id;
    if (!uid) return [];
    const { data, error } = await sb.from("pedidos")
      .select("id,numero,estado,total,created_at,detalle_pedido(cantidad)")
      .eq("perfil_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error || !data) return [];
    return data.map((p) => ({ ...p, items: p.detalle_pedido || [] }));
  } catch (e) { return []; }
};

/* ---------- Historial del cliente (HU-18, RF-10) ---------- */
/* Pasa una fila de pedidos (con sus relaciones) al formato que usa "Mis pedidos".
   El enlace de la boleta/factura solo se muestra si el documento fue emitido y la URL es https. */
Befine.armarDetalle = function (p) {
  const dte = (p.documentos_tributarios || []).find((d) => d.estado === "emitido" && /^https:\/\//i.test(d.url_pdf || ""));
  return {
    id: p.id, numero: p.numero, estado: p.estado, creado: p.created_at, fecha_entrega: p.fecha_entrega || null,
    subtotal: p.subtotal || 0, despacho: p.costo_despacho || 0, descuento: p.descuento_cupon || 0, total: p.total || 0,
    documento: p.tipo_documento || "boleta",
    direccion: p.direccion || null,
    items: (p.detalle_pedido || []).map((d) => {
      const v = d.variante || null, prod = v && v.producto;
      return { variante_id: d.variante_id, nombre: (prod && prod.nombre) || "Producto no disponible", variante: (v && v.nombre) || "",
        cantidad: d.cantidad, precio_unitario: d.precio_unitario, subtotal: d.subtotal };
    }),
    boleta: dte ? { tipo: dte.tipo, folio: dte.folio, url: dte.url_pdf } : null,
  };
};

/* Detalle de un pedido propio (RLS: el cliente solo obtiene SUS pedidos). Devuelve el detalle o null. */
Befine.detallePedido = async function (id) {
  if (!UUID_RE.test(String(id || ""))) return null;
  try {
    const { data, error } = await sb.from("pedidos")
      .select("id,numero,estado,created_at,fecha_entrega,subtotal,costo_despacho,descuento_cupon,total,tipo_documento," +
              "direccion:direcciones(calle,numero,depto,comuna,referencia)," +
              "detalle_pedido(variante_id,cantidad,precio_unitario,subtotal,variante:variantes_producto(nombre,producto:productos(nombre)))," +
              "documentos_tributarios(tipo,estado,folio,url_pdf)")
      .eq("id", id)
      .maybeSingle();
    if (error) { console.error("detallePedido:", error.message); return null; }
    return data ? Befine.armarDetalle(data) : null;
  } catch (e) { console.error("detallePedido:", e); return null; }
};

/* "Volver a pedir": arma los ítems del carrito con el precio VIGENTE (no el de la compra original).
   No se agregan productos inactivos, sin precio o sin stock; si hay menos stock que lo pedido, se
   agrega lo disponible. crear_pedido() vuelve a validar precios y stock al pagar.
   Devuelve { agregar:[{item, cantidad, categoria_slug}], noDisponibles:[nombre], ajustados:[{nombre, cantidad}] }. */
Befine.armarRepeticion = function (items, variantes, nivel) {
  const porId = new Map((variantes || []).map((v) => [v.id, v]));
  const agregar = [], noDisponibles = [], ajustados = [];
  for (const it of items || []) {
    const v = porId.get(it.variante_id), prod = v && v.productos;
    const precios = (v && v.precios_variante) || [];
    const pr = precios.find((x) => x.nivel_precio_id === nivel) || precios[0];
    const nombre = (prod && prod.nombre) || it.nombre || "Producto";
    if (!v || !v.activo || !prod || !prod.activo || !pr) { noDisponibles.push(nombre); continue; }
    const cantidad = v.controla_stock ? Math.min(it.cantidad, Math.max(0, v.stock || 0)) : it.cantidad;
    if (cantidad <= 0) { noDisponibles.push(nombre); continue; }
    if (cantidad < it.cantidad) ajustados.push({ nombre, cantidad });
    agregar.push({
      item: { variante_id: v.id, producto_id: prod.id, nombre: prod.nombre, variante: v.nombre, precio: pr.precio },
      cantidad,
      categoria_slug: (prod.categorias && prod.categorias.slug) || null,
    });
  }
  return { agregar, noDisponibles, ajustados };
};

/* Consulta el catálogo actual para repetir un pedido. Devuelve { ok, agregar, noDisponibles, ajustados } o { ok:false, error }. */
Befine.volverAPedir = async function (items) {
  const ids = [...new Set((items || []).map((i) => String(i.variante_id || "")).filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return { ok: false, error: "Este pedido no tiene productos para repetir." };
  try {
    const nivel = await _nivelRetail();
    const { data, error } = await sb.from("variantes_producto")
      .select("id,nombre,stock,controla_stock,activo,precios_variante(nivel_precio_id,precio),productos(id,nombre,activo,categorias(slug))")
      .in("id", ids);
    if (error) { console.error("volverAPedir:", error.message); return { ok: false, error: "No pudimos revisar los productos. Inténtalo de nuevo." }; }
    return { ok: true, ...Befine.armarRepeticion(items, data, nivel) };
  } catch (e) {
    console.error("volverAPedir:", e);
    return { ok: false, error: "Sin conexión. Revisa tu internet e inténtalo de nuevo." };
  }
};

/* =====================================================================
   SITIO — Banner y eslogan de la página (editables desde el panel)
   ---------------------------------------------------------------------
   Se guardan en la tabla `parametros` (claves sitio_*), de lectura pública.
   Si no hay datos (o falla la base) se usan los textos de SITIO_DEFECTO,
   que son los originales de la tienda. Solo se editan desde el panel
   (sección "Banner y eslogan", permiso config.gestionar).
   ===================================================================== */
const SITIO_CLAVES = [
  "sitio_eyebrow", "sitio_titulo", "sitio_subtitulo", "sitio_pie",
  "sitio_banner_desktop", "sitio_banner_movil", "sitio_banner_alt", "sitio_banner_oscuridad",
];
const SITIO_DEFECTO = {
  eyebrow: "Agua purificada a domicilio · Quilicura y sector norte",
  titulo: "Recarga de agua purificada {a domicilio} en Quilicura",
  subtitulo: "Bidones y recargas de agua purificada de 20 L y 12 L, dispensadores frío/calor y despacho a domicilio en Quilicura, Huechuraba, Recoleta, Valle Grande y Valle Lo Campino. Envío gratis desde $7.000 y entrega en 24 horas hábiles.",
  pie: "Agua purificada a domicilio en el sector norte de Santiago. 5 años de operación.",
  banner_desktop: "", banner_movil: "", banner_alt: "", banner_oscuridad: 45,
};
const SITIO_CACHE = "befine_sitio";

const _escHTML = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Solo se muestran imágenes del propio sitio (/uploads/…, assets/…) o https. Nada de javascript: ni data:. */
function _urlImagenSegura(url) {
  const u = String(url || "").trim();
  if (/^\/uploads\/[\w.-]+$/.test(u) || /^assets\/[\w./-]+$/.test(u)) return u;
  if (/^https:\/\/[^\s"'<>()]+$/i.test(u)) return u;
  return "";
}

/* Filas de parametros [{clave, valor}] → { eyebrow, titulo, subtitulo, pie, banner_desktop, banner_movil, banner_alt, banner_oscuridad } */
function _normalizarSitio(filas) {
  const m = {};
  (filas || []).forEach((f) => { if (f && SITIO_CLAVES.includes(f.clave)) m[f.clave.slice(6)] = f.valor; });
  const texto = (k) => (m[k] == null ? SITIO_DEFECTO[k] : String(m[k]));
  const osc = parseInt(m.banner_oscuridad, 10);
  return {
    eyebrow: texto("eyebrow"),
    titulo: String(m.titulo == null ? "" : m.titulo).trim() ? String(m.titulo) : SITIO_DEFECTO.titulo,   // el título nunca queda vacío
    subtitulo: texto("subtitulo"),
    pie: texto("pie"),
    banner_desktop: _urlImagenSegura(m.banner_desktop),
    banner_movil: _urlImagenSegura(m.banner_movil),
    banner_alt: String(m.banner_alt == null ? "" : m.banner_alt).slice(0, 140),
    banner_oscuridad: Number.isFinite(osc) ? Math.min(80, Math.max(0, osc)) : SITIO_DEFECTO.banner_oscuridad,
  };
}

/* Título con parte destacada: "Recarga de agua {a domicilio} en Quilicura" → HTML seguro con <span class="serif">. */
function _tituloHTML(texto) {
  return String(texto == null ? "" : texto).split(/(\{[^{}]*\})/).map((p) =>
    /^\{[^{}]*\}$/.test(p) ? (p.length > 2 ? `<span class="serif">${_escHTML(p.slice(1, -1))}</span>` : "") : _escHTML(p)).join("");
}
/* El mismo título en texto plano (sin las llaves) para <title>, lectores de pantalla, etc. */
const _tituloPlano = (texto) => String(texto == null ? "" : texto).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

Befine.sitio = { CLAVES: SITIO_CLAVES, DEFECTO: SITIO_DEFECTO, normalizar: _normalizarSitio, tituloHTML: _tituloHTML, tituloPlano: _tituloPlano, urlImagenSegura: _urlImagenSegura, esc: _escHTML };

/* Última configuración vista en este navegador: la home la pinta al instante (sin parpadeo) mientras llega la de la base. */
Befine.getSitioCache = function () {
  try { const c = JSON.parse(localStorage.getItem(SITIO_CACHE) || "null"); if (c && typeof c === "object") return _normalizarSitio(Object.entries(c).map(([k, v]) => ({ clave: "sitio_" + k, valor: v }))); } catch (e) { /* sin caché */ }
  return null;
};

/* Banner y eslogan vigentes (lectura pública). Si la base no responde, devuelve la copia guardada o los textos originales. */
let _sitioPromesa = null;
Befine.getSitio = function () {
  if (!_sitioPromesa) _sitioPromesa = _leerSitio();   // una sola consulta por página (home.js y shell.js comparten el resultado)
  return _sitioPromesa;
};
async function _leerSitio() {
  try {
    const { data, error } = await sb.from("parametros").select("clave,valor").in("clave", SITIO_CLAVES);
    if (error) throw error;
    const s = _normalizarSitio(data);
    try { localStorage.setItem(SITIO_CACHE, JSON.stringify(s)); } catch (e) { /* storage bloqueado */ }
    return s;
  } catch (e) {
    console.error("getSitio:", (e && e.message) || e);
    return Befine.getSitioCache() || _normalizarSitio([]);
  }
}

/* Pinta el eslogan del pie (todas las páginas): elementos con data-sitio="pie" */
Befine.aplicarSitioPie = function (s) {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  document.querySelectorAll("[data-sitio='pie']").forEach((el) => { el.textContent = s.pie; });
};

// Exponer en window para que las páginas lo usen sin bundler (igual que antes).
window.Befine = Befine;
