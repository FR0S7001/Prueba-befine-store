/* Pruebas de las reglas del panel de administración (web/js/admin-logic.js)
   Casos CP-U14 (acceso por rol), CP-U15 (pedidos), CP-U16 (catálogo), CP-U17 (inventario), CP-U18 (cupones) y CP-U20 (pedidos por fecha de entrega) del Plan de Pruebas. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

const { AdminLogic: L } = cargar(["admin-logic.js"]);
const arr = (x) => Array.from(x);   // los arreglos vienen del contexto aislado

test("CP-U14a el admin tiene todos los permisos y el cliente ninguno", () => {
  assert.equal(L.permisosDe("admin", []).length, 12);
  assert.deepEqual(arr(L.permisosDe("cliente", [{ rol_id: "cliente", permiso: "pedidos.ver" }])), []);
  assert.deepEqual(arr(L.permisosDe(null, [])), []);
});

test("CP-U14b un rol del equipo solo tiene los permisos que el admin le asignó", () => {
  const filas = [
    { rol_id: "chofer", permiso: "pedidos.ver" },
    { rol_id: "chofer", permiso: "pedidos.ver" },          // duplicado: se cuenta una vez
    { rol_id: "bodega", permiso: "catalogo.gestionar" },   // otro rol: no aplica
  ];
  assert.deepEqual(arr(L.permisosDe("chofer", filas)), ["pedidos.ver"]);
});

test("CP-U14c el panel muestra solo las secciones permitidas", () => {
  const ids = (p) => arr(L.seccionesVisibles(p)).map((s) => s.id);
  assert.deepEqual(ids(L.permisosDe("admin", [])), ["pedidos", "catalogo", "inventario", "cupones", "sitio"]);
  assert.deepEqual(ids(["config.gestionar"]), ["sitio"]);               // banner y eslogan: solo con permiso de configuración
  assert.deepEqual(ids(["promociones.gestionar"]), ["cupones"]);
  assert.deepEqual(ids(["pedidos.ver"]), ["pedidos"]);
  assert.deepEqual(ids(["precios.gestionar"]), ["catalogo"]);   // solo precios: entra al catálogo
  assert.deepEqual(ids([]), []);                       // cliente: sin acceso al panel
});

/* ---------- Pedidos (RF-16) — CP-U15 ---------- */
const pedidos = [
  { id: "a", numero: 101, estado: "pendiente_pago", total: 5000, created_at: "2026-10-19T10:00:00", fecha_entrega: "2026-10-20", contacto_nombre: "María José Pérez", contacto_telefono: "56991234567", direccion: { comuna: "Quilicura" } },
  { id: "b", numero: 102, estado: "pagado",         total: 8000, created_at: "2026-10-19T11:00:00", fecha_entrega: "2026-10-19", contacto_nombre: "Juan Soto",         contacto_telefono: "56987654321", direccion: { comuna: "Huechuraba" } },
  { id: "c", numero: 103, estado: "en_ruta",        total: 3000, created_at: "2026-10-18T09:00:00", fecha_entrega: "2026-10-19", contacto_nombre: "Ana Fuentes",       contacto_telefono: "56911112222", direccion: { comuna: "Recoleta" } },
  { id: "d", numero: 104, estado: "entregado",      total: 6000, created_at: "2026-09-30T09:00:00", fecha_entrega: "2026-10-01", contacto_nombre: "Luis Araya",        contacto_telefono: "56933334444", direccion: { comuna: "Quilicura" } },
  { id: "e", numero: 105, estado: "cancelado",      total: 9000, created_at: "2026-10-19T08:00:00", fecha_entrega: "2026-10-20", contacto_nombre: "Rosa Muñoz",        contacto_telefono: "56955556666", direccion: { comuna: "Quilicura" } },
];
const nums = (l) => arr(l).map((p) => p.numero);

test("CP-U15a el panel no puede marcar 'pagado' (solo Mercado Pago) y los estados finales no cambian", () => {
  assert.deepEqual(arr(L.siguientesEstados("pendiente_pago")), ["cancelado"]);
  assert.equal(L.puedeCambiar("pendiente_pago", "pagado"), false);
  assert.equal(L.puedeCambiar("pagado", "en_preparacion"), true);
  assert.equal(L.puedeCambiar("en_preparacion", "en_ruta"), true);
  assert.equal(L.puedeCambiar("en_ruta", "entregado"), true);
  assert.equal(L.puedeCambiar("en_ruta", "cancelado"), false);   // ya salió a reparto
  assert.deepEqual(arr(L.siguientesEstados("entregado")), []);
  assert.deepEqual(arr(L.siguientesEstados("cancelado")), []);
  assert.deepEqual(arr(L.siguientesEstados("inventado")), []);
});

test("CP-U15b filtros por estado: 'para gestionar' son los pagados aún no entregados", () => {
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { estado: "activos" })), [102, 103]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { estado: "todos" })), [101, 102, 103, 104, 105]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { estado: "cancelado" })), [105]);
  const c = L.contarPorEstado(pedidos);
  assert.equal(c.todos, 5); assert.equal(c.activos, 2); assert.equal(c.pagado, 1); assert.equal(c.en_preparacion, 0);
});

test("CP-U15c búsqueda por número, nombre sin acentos, teléfono o comuna", () => {
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { q: "#103" })), [103]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { q: "maria jose" })), [101]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { q: "8765 4321" })), [102]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { q: "huechuraba" })), [102]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { q: "munoz", estado: "activos" })), []);
});

test("CP-U15d indicadores: pedidos de hoy, por preparar y ventas del mes (solo pagados)", () => {
  const r = L.resumenPedidos(pedidos, new Date(2026, 9, 19, 15));
  assert.equal(r.hoy, 2);            // 101 y 102 (el cancelado no cuenta)
  assert.equal(r.porPreparar, 1);    // 102
  assert.equal(r.enRuta, 1);
  assert.equal(r.pendientesPago, 1);
  assert.equal(r.entregaHoy, 2);     // 102 y 103 se entregan el 19
  assert.equal(r.ventasMes, 11000);  // 102 + 103 (104 es de septiembre; 101 sin pagar; 105 cancelado)
  assert.equal(r.pedidosMes, 2);
});

test("CP-U15e enlace de WhatsApp solo con celular chileno válido", () => {
  assert.equal(L.linkWhatsApp("56991234567", "Hola #1"), "https://wa.me/56991234567?text=Hola%20%231");
  assert.equal(L.linkWhatsApp("+56 9 9123 4567"), "https://wa.me/56991234567");
  assert.equal(L.linkWhatsApp("221234567"), null);
  assert.equal(L.linkWhatsApp(null), null);
  assert.equal(L.telefonoVisible("56991234567"), "+56 9 9123 4567");
});

/* ---------- Catálogo y precios (RF-17) — CP-U16 ---------- */
test("CP-U16a precio en pesos: acepta $3.000 / 3000 y rechaza decimales, negativos y texto", () => {
  assert.equal(L.parsePrecio("3000"), 3000);
  assert.equal(L.parsePrecio("$3.000"), 3000);
  assert.equal(L.parsePrecio("$ 159.990"), 159990);
  assert.equal(L.parsePrecio(0), 0);
  assert.equal(L.parsePrecio("3,5"), null);
  assert.equal(L.parsePrecio("-100"), null);
  assert.equal(L.parsePrecio("gratis"), null);
  assert.equal(L.parsePrecio(""), null);
  assert.equal(L.parsePrecio("10000000"), null);   // sobre $9.999.999: probable error de tipeo
});

test("CP-U16b SKU normalizado y único entre todas las variantes", () => {
  assert.equal(L.normalizarSku(" bef rec 20 "), "BEF-REC-20");
  assert.equal(L.normalizarSku("bef-bidón-12"), "BEF-BIDON-12");
  const existentes = [{ id: "v1", sku: "BEF-REC-20-BEFINE" }];
  assert.ok(L.validarVariante({ sku: "bef-rec-20-befine", nombre: "Otra" }, existentes, null).sku);
  assert.deepEqual(Object.keys(L.validarVariante({ sku: "BEF-REC-20-BEFINE", nombre: "Misma" }, existentes, "v1")), []); // editar la propia
  assert.ok(L.validarVariante({ sku: "AB", nombre: "x" }, [], null).sku);
  assert.ok(L.validarVariante({ sku: "BEF-NUEVO", nombre: "" }, [], null).nombre);
  assert.ok(L.validarVariante({ sku: "BEF-NUEVO", nombre: "Estándar", precio: "abc" }, [], null).precio);
});

test("CP-U16c producto: nombre, categoría e imagen https obligatoria si se informa", () => {
  assert.deepEqual(Object.keys(L.validarProducto({ nombre: "Recarga 20 L", categoria_id: 4 })), []);
  const e = L.validarProducto({ nombre: "ab", categoria_id: "", imagen_url: "http://sitio.cl/a.png" });
  assert.ok(e.nombre && e.categoria_id && e.imagen_url);
  assert.deepEqual(Object.keys(L.validarProducto({ nombre: "Pack", categoria_id: 1, imagen_url: "https://x.supabase.co/a.webp" })), []);
});

test("CP-U16d filtro del catálogo por categoría, visibilidad y SKU", () => {
  const cat = [
    { id: "p1", nombre: "Recarga Bidón 20 Litros", categoria_id: 4, activo: true, variantes: [{ sku: "BEF-REC-20-BEFINE", nombre: "Con bidón Befine" }] },
    { id: "p2", nombre: "Dispensador USB", categoria_id: 2, activo: false, variantes: [{ sku: "BEF-DISP-USB", nombre: "Estándar" }] },
  ];
  const ids = (l) => arr(l).map((p) => p.id);
  assert.deepEqual(ids(L.filtrarCatalogo(cat, { categoria: "4" })), ["p1"]);
  assert.deepEqual(ids(L.filtrarCatalogo(cat, { estado: "ocultos" })), ["p2"]);
  assert.deepEqual(ids(L.filtrarCatalogo(cat, { q: "disp-usb" })), ["p2"]);
  assert.deepEqual(ids(L.filtrarCatalogo(cat, { q: "bidon" })), ["p1"]);
});

/* ---------- Inventario (RF-18) — CP-U17 ---------- */
test("CP-U17a nivel de stock según el umbral (igual o menos = stock bajo)", () => {
  assert.equal(L.nivelStock({ stock: 0, controla_stock: true }, 10), "agotado");
  assert.equal(L.nivelStock({ stock: 10, controla_stock: true }, 10), "bajo");
  assert.equal(L.nivelStock({ stock: 11, controla_stock: true }, 10), "ok");
  assert.equal(L.nivelStock({ stock: 0, controla_stock: false }, 10), "sin_control");
});

test("CP-U17b umbral desde parámetros con respaldo de 10 unidades", () => {
  assert.equal(L.umbralStock("5"), 5);
  assert.equal(L.umbralStock(null), 10);
  assert.equal(L.umbralStock("abc"), 10);
  assert.equal(L.umbralStock("-3"), 10);
});

test("CP-U17c cantidades de stock válidas y ajuste sin bajar de cero", () => {
  assert.equal(L.parseStock("120"), 120);
  assert.equal(L.parseStock("1.200"), 1200);
  assert.equal(L.parseStock("-1"), null);
  assert.equal(L.parseStock("2,5"), null);
  assert.equal(L.parseStock("100001"), null);
  assert.equal(L.sumarStock(0, -1), 0);
  assert.equal(L.sumarStock(9, 1), 10);
});

test("CP-U17d resumen y lista ordenada por urgencia; 'alerta' = agotados + stock bajo", () => {
  const vs = [
    { id: "a", producto: "Recarga 20 L", nombre: "Befine", sku: "BEF-REC-20-BEFINE", stock: 64, controla_stock: true },
    { id: "b", producto: "Recarga 20 L", nombre: "Otra marca", sku: "BEF-REC-20-OTRA", stock: 7, controla_stock: true },
    { id: "c", producto: "Dispensador USB", nombre: "Estándar", sku: "BEF-DISP-USB", stock: 0, controla_stock: true },
    { id: "d", producto: "Recarga 12 L", nombre: "Estándar", sku: "BEF-REC-12", stock: 0, controla_stock: false },
  ];
  const r = L.resumenStock(vs, 10);
  assert.deepEqual([r.agotado, r.bajo, r.ok, r.sin_control, r.total], [1, 1, 1, 1, 4]);
  const ids = (l) => arr(l).map((v) => v.id);
  assert.deepEqual(ids(L.filtrarInventario(vs, { nivel: "todos" }, 10)), ["c", "b", "a", "d"]);
  assert.deepEqual(ids(L.filtrarInventario(vs, { nivel: "alerta" }, 10)), ["c", "b"]);
  assert.deepEqual(ids(L.filtrarInventario(vs, { q: "otra" }, 10)), ["b"]);
});

/* ---------- Cupones (RF-20) — CP-U18 ---------- */
test("CP-U18a estado del cupón según fecha, usos y pausa", () => {
  const base = { activo: true, usos_actuales: 0, usos_maximos: null, vigente_desde: null, vigente_hasta: null };
  const hoy = "2026-10-19";
  assert.equal(L.estadoCupon(base, hoy), "activo");
  assert.equal(L.estadoCupon({ ...base, activo: false }, hoy), "pausado");
  assert.equal(L.estadoCupon({ ...base, vigente_desde: "2026-11-01" }, hoy), "programado");
  assert.equal(L.estadoCupon({ ...base, vigente_hasta: "2026-10-18" }, hoy), "vencido");
  assert.equal(L.estadoCupon({ ...base, vigente_hasta: "2026-10-19" }, hoy), "activo");   // vence al final del día
  assert.equal(L.estadoCupon({ ...base, usos_maximos: 50, usos_actuales: 50 }, hoy), "agotado");
});

test("CP-U18b validación: código único, porcentaje 1-100, fechas en orden y límites opcionales", () => {
  const existentes = [{ id: "c1", codigo: "CYBER10" }];
  const ok = { codigo: "navidad 26", tipo: "porcentaje", valor: "12", compra_minima: "15.000", usos_maximos: "", usos_por_cliente: "2", vigente_desde: "2026-12-15", vigente_hasta: "2026-12-24" };
  assert.deepEqual(Object.keys(L.validarCupon(ok, existentes, null)), []);
  assert.ok(L.validarCupon({ ...ok, codigo: "cyber10" }, existentes, null).codigo);
  assert.deepEqual(Object.keys(L.validarCupon({ ...ok, codigo: "CYBER10" }, existentes, "c1")), []);  // editar el propio
  assert.ok(L.validarCupon({ ...ok, valor: "150" }, [], null).valor);
  assert.ok(L.validarCupon({ ...ok, valor: "0" }, [], null).valor);
  assert.ok(L.validarCupon({ ...ok, tipo: "monto_fijo", valor: "abc" }, [], null).valor);
  assert.ok(L.validarCupon({ ...ok, vigente_hasta: "2026-12-01" }, [], null).vigente_hasta);
  assert.ok(L.validarCupon({ ...ok, usos_maximos: "0" }, [], null).usos_maximos);
  assert.ok(L.validarCupon({ ...ok, usos_por_cliente: "dos" }, [], null).usos_por_cliente);
});

test("CP-U18c el cupón de bienvenida siempre exige cuenta y se usa una vez por cliente", () => {
  const f = L.filaCupon({ codigo: "bienvenida", tipo: "porcentaje", valor: "15", compra_minima: "", usos_maximos: "", usos_por_cliente: "5",
    requiere_cuenta: false, solo_primera_compra: true, activo: true });
  assert.equal(f.codigo, "BIENVENIDA");
  assert.equal(f.requiere_cuenta, true);
  assert.equal(f.usos_por_cliente, 1);
  assert.equal(f.compra_minima, 0);
  assert.equal(f.usos_maximos, null);
  const g = L.filaCupon({ codigo: "VERANO", tipo: "monto_fijo", valor: "$2.000", compra_minima: "10.000", usos_maximos: "100", usos_por_cliente: "",
    requiere_cuenta: false, solo_primera_compra: false, activo: false, vigente_hasta: "2027-02-28" });
  assert.equal(g.valor, 2000); assert.equal(g.compra_minima, 10000); assert.equal(g.usos_maximos, 100);
  assert.equal(g.usos_por_cliente, null); assert.equal(g.requiere_cuenta, false); assert.equal(g.vigente_desde, null);
});

test("CP-U18d texto del descuento y condiciones visibles en la lista", () => {
  assert.equal(L.textoDescuento({ tipo: "porcentaje", valor: 15 }), "15%");
  assert.equal(L.textoDescuento({ tipo: "monto_fijo", valor: 2000 }), "$2.000");
  assert.deepEqual(arr(L.condicionesCupon({ solo_primera_compra: true, requiere_cuenta: true, usos_por_cliente: 1, compra_minima: 0 })), ["solo 1ª compra"]);
  assert.deepEqual(arr(L.condicionesCupon({ compra_minima: 10000, usos_por_cliente: 1, variantes: ["v1", "v2"] })),
    ["mín. $10.000", "1 vez por cliente", "2 productos"]);
});

/* ---------- Pedidos por fecha de entrega (HU-07, RF-16) — CP-U20 ---------- */
const jueves = new Date(2026, 9, 22, 15, 0);   // jueves 22-oct-2026
const viernes = new Date(2026, 9, 23, 9, 0);   // viernes 23-oct-2026

test("CP-U20a atajos de entrega: hoy, siguiente día hábil y esta semana", () => {
  assert.deepEqual({ ...L.rangoEntrega("hoy", jueves) }, { desde: "2026-10-22", hasta: "2026-10-22" });
  assert.deepEqual({ ...L.rangoEntrega("siguiente", jueves) }, { desde: "2026-10-23", hasta: "2026-10-23" });
  // un viernes, la siguiente entrega es el lunes (no hay reparto el fin de semana)
  assert.deepEqual({ ...L.rangoEntrega("siguiente", viernes) }, { desde: "2026-10-26", hasta: "2026-10-26" });
  // la semana va de lunes a domingo: incluye entregas atrasadas de días anteriores
  assert.deepEqual({ ...L.rangoEntrega("semana", jueves) }, { desde: "2026-10-19", hasta: "2026-10-25" });
  assert.equal(L.rangoEntrega("todas", jueves), null);
});

test("CP-U20b rango elegido: fechas invertidas se ordenan, un extremo vacío es abierto y sin fechas no filtra", () => {
  assert.deepEqual({ ...L.rangoEntrega("rango", jueves, "2026-10-30", "2026-10-26") }, { desde: "2026-10-26", hasta: "2026-10-30" });
  assert.deepEqual({ ...L.rangoEntrega("rango", jueves, "2026-10-26", "") }, { desde: "2026-10-26", hasta: "" });
  assert.equal(L.rangoEntrega("rango", jueves, "", ""), null);
  assert.equal(L.rangoEntrega("rango", jueves, "26/10/2026", "x"), null);   // formato inválido se ignora
});

test("CP-U20c filtrar pedidos por fecha de entrega, combinado con estado y búsqueda", () => {
  const dia = { desde: "2026-10-20", hasta: "2026-10-20" };
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { entrega: dia })), [101, 105]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { entrega: dia, estado: "pendiente_pago" })), [101]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { entrega: { desde: "2026-10-19", hasta: "2026-10-19" }, estado: "activos" })), [102, 103]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { entrega: { desde: "2026-10-19", hasta: "" }, q: "quilicura" })), [101, 105]);
  assert.deepEqual(nums(L.filtrarPedidos(pedidos, { entrega: { desde: "", hasta: "2026-10-01" } })), [104]);
  // un pedido sin fecha de entrega no aparece cuando se filtra por fecha
  assert.deepEqual(nums(L.filtrarPedidos([{ numero: 1, estado: "pagado" }], { entrega: dia })), []);
  assert.equal(L.filtrarPedidos(pedidos, { entrega: null }).length, pedidos.length);
});

test("CP-U20d texto del rango que acompaña al filtro", () => {
  assert.equal(L.textoRango(null), "");
  assert.match(L.textoRango({ desde: "2026-10-26", hasta: "2026-10-26" }), /lunes.*26/);
  assert.match(L.textoRango({ desde: "2026-10-26", hasta: "2026-10-30" }), /26.*–.*30/);
  assert.match(L.textoRango({ desde: "2026-10-26", hasta: "" }), /^desde el 26/);
});
