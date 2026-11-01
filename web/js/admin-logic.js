/* =====================================================================
   admin-logic.js — Reglas del panel de administración (SIN acceso a red)
   ---------------------------------------------------------------------
   Funciones puras: reciben datos y devuelven resultados. No tocan el DOM
   ni Supabase, por eso se prueban con node:test (tests/unit/admin.test.js).
   La seguridad real la da el RLS de Supabase (migración 01); estas reglas
   solo deciden qué MUESTRA la interfaz a cada rol (segunda capa).
   ===================================================================== */
(function (root) {
  /* ---------- Permisos (mismo catálogo que public.permisos, migración 01) ---------- */
  const PERMISOS = [
    "pedidos.ver", "pedidos.gestionar", "catalogo.gestionar", "precios.gestionar",
    "promociones.gestionar", "despacho.gestionar", "clientes.ver", "clientes.gestionar",
    "pagos.gestionar", "documentos.gestionar", "puntos.gestionar", "config.gestionar",
  ];

  /* Permisos efectivos de un rol. El admin tiene todos (igual que tiene_permiso() en la BD);
     el cliente ninguno; los demás roles, los que el admin les asignó en rol_permisos. */
  function permisosDe(rol, filasRolPermisos) {
    if (!rol || rol === "cliente") return [];
    if (rol === "admin") return PERMISOS.slice();
    return (filasRolPermisos || [])
      .filter((f) => f && f.rol_id === rol && typeof f.permiso === "string")
      .map((f) => f.permiso)
      .filter((p, i, a) => a.indexOf(p) === i);
  }

  const puede = (permisos, p) => Array.isArray(permisos) && permisos.includes(p);

  /* Secciones del panel y el permiso que habilita cada una (basta con uno de la lista) */
  const SECCIONES = [
    { id: "pedidos", txt: "Pedidos", requiere: ["pedidos.ver", "pedidos.gestionar"] },
    { id: "catalogo", txt: "Catálogo y precios", requiere: ["catalogo.gestionar", "precios.gestionar"] },
    { id: "inventario", txt: "Inventario", requiere: ["catalogo.gestionar"] },
    { id: "cupones", txt: "Cupones", requiere: ["promociones.gestionar"] },
    { id: "sitio", txt: "Banner y eslogan", requiere: ["config.gestionar"] },
  ];
  const seccionesVisibles = (permisos) =>
    SECCIONES.filter((s) => s.requiere.some((p) => puede(permisos, p)));

  /* ---------- Estados del pedido (enum public.estado_pedido) ---------- */
  const ESTADOS = {
    pendiente_pago: { txt: "Pendiente de pago", tono: "espera" },
    pagado:         { txt: "Pagado",            tono: "ok" },
    en_preparacion: { txt: "En preparación",    tono: "info" },
    en_ruta:        { txt: "En camino",         tono: "ruta" },
    entregado:      { txt: "Entregado",         tono: "fin" },
    cancelado:      { txt: "Cancelado",         tono: "mal" },
  };
  const ORDEN_ESTADOS = Object.keys(ESTADOS);
  const etiquetaEstado = (e) => (ESTADOS[e] ? ESTADOS[e].txt : String(e || "—"));

  /* Texto sin acentos ni mayúsculas (mismo criterio que el buscador de la tienda) */
  const norm = (s) => String(s == null ? "" : s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  /* ---------- Flujo de estados que puede aplicar el panel (pedidos.gestionar) ----------
     - "pagado" lo marca SOLO el servidor al confirmar Mercado Pago (migración 03):
       un pedido sin pagar nunca sale a reparto. Desde el panel solo se cancela.
     - "En camino" y "Entregado" también los marca el chofer (migración 02).
     - Entregado y cancelado cierran el ciclo. */
  const TRANSICIONES = {
    pendiente_pago: ["cancelado"],
    pagado:         ["en_preparacion", "cancelado"],
    en_preparacion: ["en_ruta", "cancelado"],
    en_ruta:        ["entregado"],
    entregado:      [],
    cancelado:      [],
  };
  const siguientesEstados = (estado) => (TRANSICIONES[estado] || []).slice();
  const puedeCambiar = (de, a) => siguientesEstados(de).includes(a);

  /* Texto del botón para cada cambio */
  const ACCION_ESTADO = {
    en_preparacion: "Pasar a preparación",
    en_ruta: "Marcar en camino",
    entregado: "Marcar entregado",
    cancelado: "Cancelar pedido",
  };

  /* Filtro de la lista: estado ("todos" | "activos" | un estado) y búsqueda por
     número (#123 o 123), nombre, teléfono o comuna. */
  const ACTIVOS = ["pagado", "en_preparacion", "en_ruta"];
  function filtrarPedidos(lista, { estado = "todos", q = "", entrega = null } = {}) {
    const t = norm(q).replace(/^#/, "");
    const tel = t.replace(/\D/g, "");
    return (lista || []).filter((p) => {
      if (!enRangoEntrega(p, entrega)) return false;
      if (estado === "activos" && !ACTIVOS.includes(p.estado)) return false;
      if (estado !== "todos" && estado !== "activos" && p.estado !== estado) return false;
      if (!t) return true;
      if (/^\d+$/.test(t) && String(p.numero) === t) return true;
      const dir = p.direccion || {};
      const texto = norm([p.contacto_nombre, p.contacto_email, dir.comuna, dir.calle].join(" "));
      return texto.includes(t) || (tel.length >= 4 && String(p.contacto_telefono || "").includes(tel));
    });
  }

  /* Cantidad de pedidos por estado (para los filtros) */
  function contarPorEstado(lista) {
    const c = { todos: 0, activos: 0 };
    ORDEN_ESTADOS.forEach((e) => { c[e] = 0; });
    (lista || []).forEach((p) => {
      c.todos++; if (c[p.estado] != null) c[p.estado]++;
      if (ACTIVOS.includes(p.estado)) c.activos++;
    });
    return c;
  }

  /* Fecha local AAAA-MM-DD (para comparar "hoy" sin problemas de zona horaria) */
  const diaLocal = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  };

  /* ---------- Filtro por fecha de entrega (HU-07) ----------
     Las fechas se manejan como texto AAAA-MM-DD (igual que la columna
     pedidos.fecha_entrega, tipo date), así se comparan sin desfases de zona horaria. */
  const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
  const aFecha = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const sumarDias = (iso, n) => { const x = aFecha(iso); x.setDate(x.getDate() + n); return diaLocal(x); };
  const diaSemana = (iso) => aFecha(iso).getDay() || 7;            // 1 = lunes … 7 = domingo
  function siguienteHabil(iso) {
    let x = sumarDias(iso, 1);
    while (diaSemana(x) > 5) x = sumarDias(x, 1);
    return x;
  }

  /* Opciones del filtro de entrega. "Siguiente día hábil" porque el despacho
     es de lunes a viernes: un viernes, la siguiente entrega es el lunes. */
  const OPCIONES_ENTREGA = { todas: "Cualquier fecha", hoy: "Hoy", siguiente: "Siguiente día hábil", semana: "Esta semana", rango: "Elegir fechas" };

  /* Convierte la opción elegida en un rango { desde, hasta } (inclusive) o null
     si no hay que filtrar. "Esta semana" va de lunes a domingo de la semana en curso,
     así también aparecen los pedidos atrasados de días anteriores. */
  function rangoEntrega(opcion, hoy = new Date(), desde = "", hasta = "") {
    const d = diaLocal(hoy);
    switch (opcion) {
      case "hoy": return { desde: d, hasta: d };
      case "siguiente": { const s = siguienteHabil(d); return { desde: s, hasta: s }; }
      case "semana": { const lun = sumarDias(d, 1 - diaSemana(d)); return { desde: lun, hasta: sumarDias(lun, 6) }; }
      case "rango": {
        let a = ES_DIA.test(desde || "") ? desde : "", b = ES_DIA.test(hasta || "") ? hasta : "";
        if (!a && !b) return null;
        if (a && b && a > b) [a, b] = [b, a];
        return { desde: a, hasta: b };
      }
      default: return null;
    }
  }

  function enRangoEntrega(p, r) {
    if (!r) return true;
    const f = p && p.fecha_entrega;
    if (!f || !ES_DIA.test(f)) return false;
    return (!r.desde || f >= r.desde) && (!r.hasta || f <= r.hasta);
  }

  /* Texto corto del rango para mostrar junto al filtro: "jueves 22 oct", "26 – 30 oct" */
  function textoRango(r) {
    if (!r) return "";
    const f = (iso, conDia) => aFecha(iso).toLocaleDateString("es-CL", { ...(conDia ? { weekday: "long" } : {}), day: "numeric", month: "short" }).replace(/\.$/, "");
    if (r.desde && r.hasta) return r.desde === r.hasta ? f(r.desde, true) : f(r.desde) + " – " + f(r.hasta);
    return r.desde ? "desde el " + f(r.desde) : "hasta el " + f(r.hasta);
  }

  /* Indicadores del inicio de Pedidos. Ventas = pedidos pagados (en cualquier etapa
     posterior al pago) creados en el mes en curso. */
  const VENDIDOS = ["pagado", "en_preparacion", "en_ruta", "entregado"];
  function resumenPedidos(lista, hoy = new Date()) {
    const dHoy = diaLocal(hoy), mes = dHoy.slice(0, 7);
    const r = { hoy: 0, porPreparar: 0, enRuta: 0, pendientesPago: 0, ventasMes: 0, pedidosMes: 0, entregaHoy: 0 };
    (lista || []).forEach((p) => {
      const dia = p.created_at ? diaLocal(p.created_at) : "";
      if (dia === dHoy && p.estado !== "cancelado") r.hoy++;
      if (p.estado === "pagado" || p.estado === "en_preparacion") r.porPreparar++;
      if (p.estado === "en_ruta") r.enRuta++;
      if (p.estado === "pendiente_pago") r.pendientesPago++;
      if (p.fecha_entrega === dHoy && ACTIVOS.includes(p.estado)) r.entregaHoy++;
      if (VENDIDOS.includes(p.estado) && dia.slice(0, 7) === mes) { r.ventasMes += Number(p.total) || 0; r.pedidosMes++; }
    });
    return r;
  }

  /* Enlace de WhatsApp al cliente (teléfono guardado como 569XXXXXXXX por crear_pedido) */
  function linkWhatsApp(telefono, texto) {
    const d = String(telefono || "").replace(/\D/g, "");
    if (!/^569\d{8}$/.test(d)) return null;
    return "https://wa.me/" + d + (texto ? "?text=" + encodeURIComponent(texto) : "");
  }
  const telefonoVisible = (t) => {
    const d = String(t || "").replace(/\D/g, "");
    return /^569\d{8}$/.test(d) ? "+56 9 " + d.slice(3, 7) + " " + d.slice(7) : (t || "—");
  };

  /* ---------- Catálogo y precios (RF-17) ---------- */
  /* Precio en CLP desde lo que escribe el dueño: "3000", "3.000", "$3.000" → 3000.
     Devuelve null si no es un entero válido entre 0 y 9.999.999. */
  function parsePrecio(v) {
    if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 9999999 ? v : null;
    const t = String(v == null ? "" : v).trim().replace(/^\$\s*/, "").replace(/\./g, "");
    if (!/^\d{1,7}$/.test(t)) return null;
    return Number(t);
  }

  /* SKU: mayúsculas, sin espacios ni acentos (BEF-REC-20) */
  const normalizarSku = (v) => norm(v).toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");

  /* Validaciones → objeto { campo: "mensaje" } (vacío = válido) */
  function validarProducto(p) {
    const e = {};
    const nombre = String((p && p.nombre) || "").trim();
    if (nombre.length < 3) e.nombre = "Escribe el nombre del producto (mínimo 3 caracteres).";
    else if (nombre.length > 120) e.nombre = "El nombre es muy largo (máximo 120 caracteres).";
    if (!p || !p.categoria_id) e.categoria_id = "Elige una categoría.";
    if (p && p.descripcion && String(p.descripcion).length > 1000) e.descripcion = "La descripción es muy larga (máximo 1.000 caracteres).";
    if (p && p.imagen_url && !/^https:\/\/\S+$/i.test(String(p.imagen_url).trim())) e.imagen_url = "La imagen debe ser un enlace https://";
    return e;
  }

  function validarVariante(v, skusExistentes, idActual) {
    const e = {};
    const sku = normalizarSku(v && v.sku);
    if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(sku)) e.sku = "El SKU debe tener entre 3 y 40 caracteres (letras, números y guiones).";
    else if ((skusExistentes || []).some((x) => x && x.sku === sku && x.id !== idActual)) e.sku = "Ese SKU ya existe en otro producto.";
    const nombre = String((v && v.nombre) || "").trim();
    if (!nombre) e.nombre = "Escribe el nombre de la variante (ej: Estándar, Con bidón Befine).";
    else if (nombre.length > 60) e.nombre = "Máximo 60 caracteres.";
    if (v && "precio" in v && parsePrecio(v.precio) === null) e.precio = "Escribe un precio válido en pesos, sin decimales.";
    return e;
  }

  /* Filtro del catálogo: categoría (id), visibilidad y texto (nombre, SKU o variante) */
  function filtrarCatalogo(productos, { categoria = "", q = "", estado = "todos" } = {}) {
    const t = norm(q);
    return (productos || []).filter((p) => {
      if (categoria && String(p.categoria_id) !== String(categoria)) return false;
      if (estado === "visibles" && !p.activo) return false;
      if (estado === "ocultos" && p.activo) return false;
      if (!t) return true;
      const vs = (p.variantes || []).map((v) => v.sku + " " + v.nombre).join(" ");
      return norm(p.nombre + " " + vs).includes(t);
    });
  }

  /* ---------- Inventario (RF-18) ---------- */
  /* Umbral de "stock bajo": parámetro stock_alerta (editable); 10 si no existe o es inválido */
  const UMBRAL_DEFECTO = 10;
  function umbralStock(valor) {
    const n = parseInt(String(valor == null ? "" : valor).trim(), 10);
    return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : UMBRAL_DEFECTO;
  }

  /* Nivel de una variante: sin_control (no lleva stock) | agotado | bajo | ok */
  function nivelStock(v, umbral = UMBRAL_DEFECTO) {
    if (!v || v.controla_stock === false) return "sin_control";
    const s = Number(v.stock) || 0;
    if (s <= 0) return "agotado";
    if (s <= umbral) return "bajo";
    return "ok";
  }
  const NIVELES_STOCK = {
    agotado:     { txt: "Agotado",     tono: "mal" },
    bajo:        { txt: "Stock bajo",  tono: "espera" },
    ok:          { txt: "Disponible",  tono: "ok" },
    sin_control: { txt: "No controla", tono: "fin" },
  };

  /* Cantidad válida de stock: entero entre 0 y 100.000 (null si no es válida) */
  function parseStock(v) {
    const t = String(v == null ? "" : v).trim().replace(/\./g, "");
    if (!/^\d{1,6}$/.test(t)) return null;
    const n = Number(t);
    return n <= 100000 ? n : null;
  }
  /* Suma o resta unidades sin bajar de 0 */
  const sumarStock = (actual, delta) => Math.max(0, (Number(actual) || 0) + (Number(delta) || 0));

  function resumenStock(variantes, umbral) {
    const r = { agotado: 0, bajo: 0, ok: 0, sin_control: 0, total: 0 };
    (variantes || []).forEach((v) => { r[nivelStock(v, umbral)]++; r.total++; });
    return r;
  }

  /* Filtro: nivel ("todos" | "alerta" = agotado + bajo | un nivel) y texto (producto, variante o SKU).
     Orden: lo más urgente primero (agotado, bajo, ok, sin control) y luego por nombre. */
  const PRIORIDAD = { agotado: 0, bajo: 1, ok: 2, sin_control: 3 };
  function filtrarInventario(variantes, { nivel = "todos", q = "" } = {}, umbral) {
    const t = norm(q);
    return (variantes || [])
      .map((v) => ({ v, n: nivelStock(v, umbral) }))
      .filter(({ v, n }) => {
        if (nivel === "alerta" && n !== "agotado" && n !== "bajo") return false;
        if (nivel !== "todos" && nivel !== "alerta" && n !== nivel) return false;
        return !t || norm([v.producto, v.nombre, v.sku].join(" ")).includes(t);
      })
      .sort((a, b) => PRIORIDAD[a.n] - PRIORIDAD[b.n] || String(a.v.producto).localeCompare(String(b.v.producto)) || String(a.v.sku).localeCompare(String(b.v.sku)))
      .map(({ v }) => v);
  }

  /* ---------- Cupones (RF-20) ---------- */
  /* Código: mayúsculas, sin espacios ni acentos (CYBER10, BIENVENIDA) */
  const normalizarCodigo = (v) => norm(v).toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "");

  /* Entero positivo opcional: "" → null (sin límite); inválido → NaN */
  function enteroOpcional(v) {
    const t = String(v == null ? "" : v).trim().replace(/\./g, "");
    if (t === "") return null;
    return /^\d{1,7}$/.test(t) ? Number(t) : NaN;
  }

  /* Estado visible de un cupón en una fecha (AAAA-MM-DD) */
  function estadoCupon(c, hoy) {
    const d = hoy || diaLocal(new Date());
    if (!c.activo) return "pausado";
    if (c.vigente_hasta && c.vigente_hasta < d) return "vencido";
    if (c.vigente_desde && c.vigente_desde > d) return "programado";
    if (c.usos_maximos != null && c.usos_actuales >= c.usos_maximos) return "agotado";
    return "activo";
  }
  const ESTADOS_CUPON = {
    activo:     { txt: "Activo",     tono: "ok" },
    programado: { txt: "Programado", tono: "info" },
    pausado:    { txt: "Pausado",    tono: "fin" },
    vencido:    { txt: "Vencido",    tono: "mal" },
    agotado:    { txt: "Agotado",    tono: "espera" },
  };

  /* "15%" o "$2.000" */
  const textoDescuento = (c) => c.tipo === "porcentaje"
    ? `${c.valor}%` : "$" + Number(c.valor || 0).toLocaleString("es-CL");

  /* Condiciones legibles para la lista del panel */
  function condicionesCupon(c) {
    const r = [];
    if (c.solo_primera_compra) r.push("solo 1ª compra");
    else if (c.requiere_cuenta) r.push("requiere cuenta");
    if (c.compra_minima > 0) r.push("mín. $" + Number(c.compra_minima).toLocaleString("es-CL"));
    if (c.usos_por_cliente && !c.solo_primera_compra) r.push(c.usos_por_cliente === 1 ? "1 vez por cliente" : `${c.usos_por_cliente} veces por cliente`);
    if (c.variantes && c.variantes.length) r.push(`${c.variantes.length} producto${c.variantes.length === 1 ? "" : "s"}`);
    if (c.perfil_id) r.push("personal");
    return r;
  }

  /* Validación del formulario → { campo: "mensaje" }. c.* llega como texto del formulario. */
  function validarCupon(c, existentes, idActual) {
    const e = {};
    const codigo = normalizarCodigo(c.codigo);
    if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(codigo)) e.codigo = "Usa entre 3 y 30 letras, números o guiones (ej: CYBER10).";
    else if ((existentes || []).some((x) => x && normalizarCodigo(x.codigo) === codigo && x.id !== idActual)) e.codigo = "Ya existe un cupón con ese código.";
    if (c.tipo !== "porcentaje" && c.tipo !== "monto_fijo") e.tipo = "Elige el tipo de descuento.";
    const valor = c.tipo === "porcentaje" ? enteroOpcional(c.valor) : parsePrecio(c.valor);
    if (valor == null || Number.isNaN(valor) || valor <= 0) e.valor = c.tipo === "porcentaje" ? "Escribe un porcentaje entre 1 y 100." : "Escribe un monto en pesos mayor a 0.";
    else if (c.tipo === "porcentaje" && valor > 100) e.valor = "El porcentaje no puede superar 100.";
    const min = String(c.compra_minima == null ? "" : c.compra_minima).trim() === "" ? 0 : parsePrecio(c.compra_minima);
    if (min === null) e.compra_minima = "Escribe un monto en pesos (o déjalo vacío).";
    const um = enteroOpcional(c.usos_maximos), uc = enteroOpcional(c.usos_por_cliente);
    if (Number.isNaN(um) || um === 0) e.usos_maximos = "Escribe un número mayor a 0, o déjalo vacío (sin límite).";
    if (Number.isNaN(uc) || uc === 0) e.usos_por_cliente = "Escribe un número mayor a 0, o déjalo vacío (sin límite).";
    if (c.vigente_desde && c.vigente_hasta && c.vigente_desde > c.vigente_hasta) e.vigente_hasta = "La fecha de término es anterior a la de inicio.";
    if (c.descripcion && String(c.descripcion).length > 200) e.descripcion = "Máximo 200 caracteres.";
    return e;
  }

  /* Fila lista para guardar en public.cupones (a partir de un formulario válido).
     El cupón de bienvenida siempre exige cuenta y se usa una vez por cliente. */
  function filaCupon(c) {
    const primera = !!c.solo_primera_compra;
    const fila = {
      codigo: normalizarCodigo(c.codigo),
      tipo: c.tipo,
      valor: c.tipo === "porcentaje" ? enteroOpcional(c.valor) : parsePrecio(c.valor),
      compra_minima: String(c.compra_minima == null ? "" : c.compra_minima).trim() === "" ? 0 : parsePrecio(c.compra_minima),
      usos_maximos: enteroOpcional(c.usos_maximos),
      vigente_desde: c.vigente_desde || null,
      vigente_hasta: c.vigente_hasta || null,
      activo: !!c.activo,
      solo_primera_compra: primera,
      requiere_cuenta: primera || !!c.requiere_cuenta,
      usos_por_cliente: primera ? 1 : enteroOpcional(c.usos_por_cliente),
      descripcion: String(c.descripcion || "").trim() || null,
    };
    return fila;
  }

  function filtrarCupones(cupones, { estado = "todos", q = "" } = {}, hoy) {
    const t = norm(q);
    return (cupones || []).filter((c) => {
      if (estado !== "todos" && estadoCupon(c, hoy) !== estado) return false;
      return !t || norm(c.codigo + " " + (c.descripcion || "")).includes(t);
    });
  }

  /* ---------- Banner y eslogan de la página (parametros.sitio_*) ----------
     Límites de largo para que el hero no se desarme y la base no reciba textos enormes. */
  const SITIO_LIMITES = { eyebrow: 90, titulo: 110, subtitulo: 320, pie: 160, banner_alt: 140 };
  const SITIO_OSCURIDAD = { min: 0, max: 80, defecto: 45 };
  /* Imágenes aceptadas por el servidor: JPG, PNG, WebP o GIF de hasta 5 MB (SVG no: puede traer scripts) */
  const IMAGEN_TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const IMAGEN_MAX_BYTES = 5 * 1024 * 1024;

  function validarImagen(archivo) {
    if (!archivo) return "Elige una imagen.";
    if (!IMAGEN_TIPOS.includes(archivo.type)) return "Usa una imagen JPG, PNG, WebP o GIF.";
    if (!(archivo.size > 0)) return "El archivo está vacío.";
    if (archivo.size > IMAGEN_MAX_BYTES) return "La imagen pesa más de 5 MB. Comprímela (por ejemplo en formato WebP) e inténtalo de nuevo.";
    return null;
  }

  /* Oscurecimiento del banner: entero entre 0 y 80 (null si no es válido) */
  function parseOscuridad(v) {
    const t = String(v == null ? "" : v).trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = parseInt(t, 10);
    return n >= SITIO_OSCURIDAD.min && n <= SITIO_OSCURIDAD.max ? n : null;
  }

  /* Valida el formulario → { errores:{campo:mensaje}, fila:{sitio_*: texto} } (fila solo si no hay errores) */
  function validarSitio(f) {
    const e = {}, v = (k) => String(f[k] == null ? "" : f[k]).replace(/\s+/g, " ").trim();
    const eyebrow = v("eyebrow"), titulo = v("titulo"), subtitulo = v("subtitulo"), pie = v("pie"), alt = v("banner_alt");
    if (!titulo) e.titulo = "El título no puede quedar vacío.";
    else if (titulo.length > SITIO_LIMITES.titulo) e.titulo = `Máximo ${SITIO_LIMITES.titulo} caracteres (llevas ${titulo.length}).`;
    else if (/[{}]/.test(titulo.replace(/\{[^{}]+\}/g, ""))) e.titulo = "Revisa las llaves { }: cada una debe abrir y cerrar una sola frase destacada.";
    if (eyebrow.length > SITIO_LIMITES.eyebrow) e.eyebrow = `Máximo ${SITIO_LIMITES.eyebrow} caracteres (llevas ${eyebrow.length}).`;
    if (subtitulo.length > SITIO_LIMITES.subtitulo) e.subtitulo = `Máximo ${SITIO_LIMITES.subtitulo} caracteres (llevas ${subtitulo.length}).`;
    if (pie.length > SITIO_LIMITES.pie) e.pie = `Máximo ${SITIO_LIMITES.pie} caracteres (llevas ${pie.length}).`;
    if (alt.length > SITIO_LIMITES.banner_alt) e.banner_alt = `Máximo ${SITIO_LIMITES.banner_alt} caracteres.`;
    const osc = parseOscuridad(f.banner_oscuridad);
    if (osc === null) e.banner_oscuridad = `Escribe un número entre ${SITIO_OSCURIDAD.min} y ${SITIO_OSCURIDAD.max}.`;
    const url = (k) => String(f[k] == null ? "" : f[k]).trim();
    for (const k of ["banner_desktop", "banner_movil"]) {
      const u = url(k);
      if (u && !(/^\/uploads\/[\w.-]+$/.test(u) || /^assets\/[\w./-]+$/.test(u) || /^https:\/\/[^\s"'<>()]+$/i.test(u))) e[k] = "La imagen no es válida: súbela de nuevo.";
    }
    if (Object.keys(e).length) return { errores: e, fila: null };
    return { errores: e, fila: {
      sitio_eyebrow: eyebrow, sitio_titulo: titulo, sitio_subtitulo: subtitulo, sitio_pie: pie,
      sitio_banner_desktop: url("banner_desktop"), sitio_banner_movil: url("banner_movil"),
      sitio_banner_alt: alt, sitio_banner_oscuridad: String(osc),
    } };
  }

  root.AdminLogic = {
    PERMISOS, permisosDe, puede, SECCIONES, seccionesVisibles,
    ESTADOS, ORDEN_ESTADOS, etiquetaEstado, norm,
    TRANSICIONES, siguientesEstados, puedeCambiar, ACCION_ESTADO,
    filtrarPedidos, contarPorEstado, resumenPedidos, diaLocal, OPCIONES_ENTREGA, rangoEntrega, enRangoEntrega, siguienteHabil, textoRango, linkWhatsApp, telefonoVisible,
    parsePrecio, normalizarSku, validarProducto, validarVariante, filtrarCatalogo,
    UMBRAL_DEFECTO, umbralStock, nivelStock, NIVELES_STOCK, parseStock, sumarStock, resumenStock, filtrarInventario,
    normalizarCodigo, enteroOpcional, estadoCupon, ESTADOS_CUPON, textoDescuento, condicionesCupon, validarCupon, filaCupon, filtrarCupones,
    SITIO_LIMITES, SITIO_OSCURIDAD, IMAGEN_TIPOS, IMAGEN_MAX_BYTES, validarImagen, parseOscuridad, validarSitio,
  };
})(typeof window !== "undefined" ? window : globalThis);
