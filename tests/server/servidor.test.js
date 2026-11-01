/* Servidor local: base SQLite en memoria + API HTTP real (sin red externa) */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { abrir } = require("../../server/db");
const { sembrar } = require("../../server/seed");
const { crearManejador } = require("../../server/index");

const db = abrir(":memory:"); sembrar(db);
const subidas = fs.mkdtempSync(path.join(os.tmpdir(), "befine-up-"));
const srv = http.createServer(crearManejador(db, { dirSubidas: subidas }));
let base;
test.after(() => { srv.close(); fs.rmSync(subidas, { recursive: true, force: true }); });

async function api(ruta, cuerpo, token, metodo) {
  const r = await fetch(base + "/api/" + ruta, { method: metodo || (cuerpo === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return { estado: r.status, ...(await r.json()) };
}
const rest = (q, t) => api("rest", { filters: [], order: [], ...q }, t);
const rpc = (n, a, t) => api("rpc/" + n, a, t);
const entrar = async (email, password) => (await api("auth/signin", { email, password })).data.session.access_token;

let admin, chofer, cliente;
test.before(async () => {
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  base = "http://127.0.0.1:" + srv.address().port;
  admin = await entrar("admin@befine.local", "Admin123!"); chofer = await entrar("chofer@befine.local", "Chofer123!"); cliente = await entrar("cliente@befine.local", "Cliente123!"); });

const varianteId = (sku) => db.prepare("SELECT id FROM variantes_producto WHERE sku=?").get(sku).id;
const direccion = { calle: "Los Aromos", numero: "55", comuna: "quilicura" };
const contacto = { nombre: "Pedro Soto", telefono: "9 5555 4444", email: "pedro@ejemplo.cl" };

test("S01 el visitante ve el catálogo activo con relaciones, pero no pedidos ni cupones", async () => {
  const r = await rest({ table: "productos", method: "select", select: "id,nombre,categorias(slug),variantes_producto(sku,precios_variante(precio))" });
  assert.equal(r.data.length, 8);
  assert.ok(r.data[0].categorias.slug && r.data[0].variantes_producto[0].precios_variante[0].precio > 0);
  assert.equal((await rest({ table: "pedidos", method: "select", select: "*" })).data.length, 0);
  assert.equal((await rest({ table: "cupones", method: "select", select: "*" })).data.length, 0);
});

test("S02 las cuentas: contraseña débil, correo repetido, ingreso incorrecto y sesión", async () => {
  assert.match((await api("auth/signup", { email: "a@b.cl", password: "abc" })).error.message, /Password should contain/);
  assert.match((await api("auth/signup", { email: "cliente@befine.local", password: "Abcdef1!" })).error.message, /already registered/);
  assert.match((await api("auth/signin", { email: "admin@befine.local", password: "mala" })).error.message, /Invalid login/);
  assert.equal((await api("auth/session", undefined, cliente)).data.session.user.email, "cliente@befine.local");
  assert.equal((await api("auth/session", undefined, "0".repeat(64))).data.session, null);
});

test("S03 cada rol ve lo suyo: el cliente solo sus pedidos; el chofer pedidos pero no cupones", async () => {
  assert.equal((await rest({ table: "pedidos", method: "select", select: "numero" }, cliente)).data.length, 6);
  assert.equal((await rest({ table: "pedidos", method: "select", select: "numero" }, chofer)).data.length, 6);
  assert.equal((await rest({ table: "cupones", method: "select", select: "*" }, chofer)).data.length, 0);
  assert.equal((await rest({ table: "cupones", method: "select", select: "codigo" }, admin)).data.length, 2);
});

test("S04 el cliente no puede cambiar estados, precios, parámetros ni su rol", async () => {
  const ped = db.prepare("SELECT id FROM pedidos WHERE estado='pagado'").get().id;
  assert.equal((await rest({ table: "pedidos", method: "update", values: { estado: "entregado" }, filters: [{ col: "id", op: "eq", val: ped }], select: "id" }, cliente)).data.length, 0);
  assert.equal((await rest({ table: "parametros", method: "upsert", onConflict: "clave", values: { clave: "stock_alerta", valor: "99" }, select: "clave" }, cliente)).data.length, 0);
  assert.equal(db.prepare("SELECT valor FROM parametros WHERE clave='stock_alerta'").get().valor, "10");
  assert.equal((await rest({ table: "precios_variante", method: "update", values: { precio: 1 }, filters: [], select: "precio" }, cliente)).data.length, 0);
  const me = db.prepare("SELECT id FROM perfiles WHERE rol='cliente'").get().id;
  await rest({ table: "perfiles", method: "update", values: { rol: "admin", puntos_saldo: 9999, nombre: "Camila F." }, filters: [{ col: "id", op: "eq", val: me }], select: "id" }, cliente);
  const pf = db.prepare("SELECT rol, puntos_saldo, nombre FROM perfiles WHERE id=?").get(me);
  assert.deepEqual({ ...pf }, { rol: "cliente", puntos_saldo: 0, nombre: "Camila F." });
});

test("S05 el admin cambia estados con el flujo permitido y queda en el historial; «pagado» no se puede marcar", async () => {
  const ped = db.prepare("SELECT id FROM pedidos WHERE estado='pendiente_pago'").get().id;
  const f = [{ col: "id", op: "eq", val: ped }];
  const r1 = await rest({ table: "pedidos", method: "update", values: { estado: "pagado" }, filters: f, select: "id" }, admin);
  assert.ok(r1.error);
  const r2 = await rest({ table: "pedidos", method: "update", values: { estado: "cancelado" }, filters: [...f, { col: "estado", op: "eq", val: "pendiente_pago" }], select: "id,estado" }, admin);
  assert.equal(r2.data[0].estado, "cancelado");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM historial_pedido WHERE pedido_id=? AND estado_nuevo='cancelado'").get(ped).n, 1);
});

test("S06 crear_pedido: invitado compra, el servidor calcula precios y despacho; sin sesión no se puede", async () => {
  const sinSesion = await rpc("crear_pedido", { p_items: [], p_direccion: {}, p_contacto: {} });
  assert.match(sinSesion.error.message, /iniciar sesión/);
  const anon = (await api("auth/anonymous", {})).data.session.access_token;
  const item = { variante_id: varianteId("BEF-REC-20-BEFINE"), cantidad: 1, precio_unitario: 1 };   // el precio que mande el navegador se ignora
  const r = await rpc("crear_pedido", { p_items: [item], p_direccion: { ...direccion, comuna: "Huechuraba" }, p_contacto: contacto }, anon);
  assert.equal(r.data.subtotal, 3000);
  assert.equal(r.data.costo_despacho, 2500);       // zona Sector Norte, bajo el mínimo de envío gratis
  assert.equal(r.data.total, 5500);
  const gr = await rpc("crear_pedido", { p_items: [{ ...item, cantidad: 3 }], p_direccion: { ...direccion, comuna: "Huechuraba" }, p_contacto: contacto }, anon);
  assert.equal(gr.data.costo_despacho, 0);         // 9.000 ≥ 7.000 → envío gratis
  assert.ok(gr.data.numero > r.data.numero);
});

test("S07 crear_pedido valida teléfono, comuna, RUT, fecha (sábado) y stock", async () => {
  const anon = (await api("auth/anonymous", {})).data.session.access_token;
  const it = [{ variante_id: varianteId("BEF-REC-12"), cantidad: 1 }];
  const err = async (extra) => (await rpc("crear_pedido", { p_items: it, p_direccion: direccion, p_contacto: contacto, ...extra }, anon)).error.message;
  assert.match(await err({ p_contacto: { ...contacto, telefono: "123" } }), /celular válido/);
  assert.match(await err({ p_direccion: { ...direccion, comuna: "Santiago" } }), /despacho a la comuna/);
  assert.match(await err({ p_documento: { tipo: "factura", rut: "11.111.111-2", razon_social: "X", giro: "Y" } }), /RUT/);
  assert.match(await err({ p_entrega: { fecha: "2020-01-01" } }), /día hábil/);
  const dispPedestal = [{ variante_id: varianteId("BEF-DISP-SINOCULTO"), cantidad: 4 }];   // stock de ejemplo: 3
  assert.match((await rpc("crear_pedido", { p_items: dispPedestal, p_direccion: direccion, p_contacto: contacto }, anon)).error.message, /stock suficiente/);
  // un pedido que falla a mitad de camino (stock) no deja nada a medias
  const antes = db.prepare("SELECT COUNT(*) n FROM pedidos").get().n, dirs = db.prepare("SELECT COUNT(*) n FROM direcciones").get().n;
  await rpc("crear_pedido", { p_items: dispPedestal, p_direccion: direccion, p_contacto: contacto }, anon);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pedidos").get().n, antes);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM direcciones").get().n, dirs);
});

test("S08 cupones: bienvenida exige cuenta; AHORRO2000 pide compra mínima; el descuento lo calcula el servidor", async () => {
  const anon = (await api("auth/anonymous", {})).data.session.access_token;
  const un = [{ variante_id: varianteId("BEF-REC-20-BEFINE"), cantidad: 1 }];
  assert.match((await rpc("revisar_cupon", { p_codigo: "bienvenida10", p_items: un }, anon)).data.mensaje, /con cuenta/);
  assert.match((await rpc("revisar_cupon", { p_codigo: "AHORRO2000", p_items: un }, anon)).data.mensaje, /compra mínima de \$10\.000/);
  const cuatro = [{ variante_id: varianteId("BEF-BID-20"), cantidad: 2 }];                 // 11.800
  const r = await rpc("revisar_cupon", { p_codigo: "ahorro2000", p_items: cuatro }, anon);
  assert.deepEqual({ valido: r.data.valido, descuento: r.data.descuento }, { valido: true, descuento: 2000 });
  const nuevo = (await api("auth/signup", { email: "nuevo@ejemplo.cl", password: "Nuevo123!", data: { nombre: "Nuevo" } })).data.session.access_token;
  const p = await rpc("crear_pedido", { p_items: un, p_direccion: direccion, p_contacto: contacto, p_cupon_codigo: "BIENVENIDA10" }, nuevo);
  assert.equal(p.data.descuento_cupon, 300);
  assert.match((await rpc("crear_pedido", { p_items: un, p_direccion: direccion, p_contacto: contacto, p_cupon_codigo: "BIENVENIDA10" }, nuevo)).error.message, /Ya tienes un pedido con este cupón/);
  // cancelar el pedido devuelve el uso del cupón
  const usos = () => db.prepare("SELECT usos_actuales n FROM cupones WHERE codigo='BIENVENIDA10'").get().n;
  assert.equal(usos(), 1);
  await rest({ table: "pedidos", method: "update", values: { estado: "cancelado" }, filters: [{ col: "id", op: "eq", val: p.data.id }], select: "id" }, admin);
  assert.equal(usos(), 0);
});

test("S09 pago simulado: solo el dueño del pedido; aprobar deja 'en preparación', descuenta stock y suma puntos", async () => {
  const anon = (await api("auth/anonymous", {})).data.session.access_token;
  const v = varianteId("BEF-BID-20"), stock0 = db.prepare("SELECT stock FROM variantes_producto WHERE id=?").get(v).stock;
  const p = (await rpc("crear_pedido", { p_items: [{ variante_id: v, cantidad: 2 }], p_direccion: direccion, p_contacto: contacto }, anon)).data;
  const pago = await api("functions/crear-pago", { pedido_id: p.id }, anon);
  assert.match(pago.data.init_point, /^pago-simulado\.html\?pedido=[0-9a-f-]{36}$/);
  assert.equal((await api("functions/crear-pago", { pedido_id: p.id }, cliente)).error.message, "Pedido no encontrado.");
  assert.equal((await api("functions/pago-simulado", { pedido_id: p.id, resultado: "aprobado" }, anon)).data.vuelta, "ok");
  const fila = db.prepare("SELECT estado FROM pedidos WHERE id=?").get(p.id);
  assert.equal(fila.estado, "en_preparacion");
  assert.equal(db.prepare("SELECT stock FROM variantes_producto WHERE id=?").get(v).stock, stock0 - 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_puntos WHERE pedido_id=?").get(p.id).n, 1);
  assert.match((await api("functions/crear-pago", { pedido_id: p.id }, anon)).error.message, /ya no está pendiente/);
});

test("S10 banner y eslogan: lectura pública, edición solo con config.gestionar", async () => {
  const claves = ["sitio_titulo", "sitio_banner_desktop"];
  const lee = (t) => rest({ table: "parametros", method: "select", select: "clave,valor", filters: [{ col: "clave", op: "in", val: claves }] }, t);
  assert.equal((await lee()).data.length, 2);                                        // visitante
  const fila = { clave: "sitio_titulo", valor: "Agua {pura} para ti" };
  const up = (t) => rest({ table: "parametros", method: "upsert", onConflict: "clave", values: [fila], select: "clave" }, t);
  assert.equal((await up(chofer)).data.length, 0);                                   // chofer: sin permiso
  assert.equal((await up(cliente)).data.length, 0);
  assert.equal((await up(admin)).data.length, 1);
  assert.equal((await lee()).data.find((x) => x.clave === "sitio_titulo").valor, "Agua {pura} para ti");
});

test("S11 subida de banner: solo el admin, solo imágenes reales, se sirve desde /uploads", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const subir = (t, cuerpo) => fetch(base + "/api/upload", { method: "POST", headers: t ? { Authorization: "Bearer " + t } : {}, body: cuerpo });
  assert.equal((await subir(cliente, png)).status, 403);
  assert.equal((await subir(null, png)).status, 403);
  assert.equal((await subir(admin, Buffer.from("<svg onload=alert(1)></svg>"))).status, 415);
  assert.equal((await subir(admin, Buffer.from("MZ ejecutable"))).status, 415);
  const ok = await subir(admin, png); const { url } = await ok.json();
  assert.equal(ok.status, 200); assert.match(url, /^\/uploads\/banner-[0-9a-f-]{36}\.png$/);
  const get = await fetch(base + url);
  assert.equal(get.status, 200); assert.equal(get.headers.get("content-type"), "image/png");
  assert.equal((await subir(admin, Buffer.alloc(5 * 1024 * 1024 + 10, 1))).status, 413);
});

test("S12 el servidor no sale de su carpeta ni expone la base de datos", async () => {
  for (const ruta of ["/../package.json", "/%2e%2e/package.json", "/data/befine.db", "/uploads/../../package.json"]) {
    const r = await fetch(base + ruta); assert.equal(r.status, 404, ruta);
  }
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/catalogo")).status, 200);          // /catalogo → catalogo.html
  assert.equal((await rest({ table: "auth_users", method: "select", select: "*" }, admin)).error.code, "PGRST205");
});
