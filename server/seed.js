/* =====================================================================
   seed.js — Datos de ejemplo para pruebas locales
   ---------------------------------------------------------------------
   OJO: los precios, el stock y los pedidos son VALORES DE EJEMPLO para
   probar; no son los de producción. Se pueden editar desde el panel.
   Cuentas de prueba (solo locales):
     admin@befine.local    / Admin123!     (rol admin: todo el panel)
     chofer@befine.local   / Chofer123!    (rol chofer: solo ver pedidos)
     cliente@befine.local  / Cliente123!   (rol cliente: compra y ve su historial)
   ===================================================================== */
const { uuid, hashClave } = require("./auth");

const SITIO_DEFECTO = {
  sitio_eyebrow: "Agua purificada a domicilio · Quilicura y sector norte",
  sitio_titulo: "Recarga de agua purificada {a domicilio} en Quilicura",
  sitio_subtitulo: "Bidones y recargas de agua purificada de 20 L y 12 L, dispensadores frío/calor y despacho a domicilio en Quilicura, Huechuraba, Recoleta, Valle Grande y Valle Lo Campino. Envío gratis desde $7.000 y entrega en 24 horas hábiles.",
  sitio_pie: "Agua purificada a domicilio en el sector norte de Santiago. 5 años de operación.",
  sitio_banner_desktop: "",
  sitio_banner_movil: "",
  sitio_banner_alt: "",
  sitio_banner_oscuridad: "45",
};

const PERMISOS = [
  ["pedidos.ver", "Pedidos", "Ver pedidos, su detalle y datos de entrega"],
  ["pedidos.gestionar", "Pedidos", "Crear, editar y cambiar el estado de pedidos"],
  ["catalogo.gestionar", "Catálogo", "Crear y editar categorías, productos y variantes"],
  ["precios.gestionar", "Catálogo", "Editar precios y niveles de precio"],
  ["promociones.gestionar", "Promociones", "Crear y editar cupones y recompensas"],
  ["despacho.gestionar", "Despacho", "Editar zonas y comunas de despacho"],
  ["clientes.ver", "Clientes", "Ver datos de clientes"],
  ["clientes.gestionar", "Clientes", "Editar clientes (nivel de precio, activo)"],
  ["pagos.gestionar", "Pagos", "Ver y gestionar pagos"],
  ["documentos.gestionar", "Pagos", "Gestionar boletas y facturas"],
  ["puntos.gestionar", "Fidelización", "Ajustar puntos de clientes"],
  ["config.gestionar", "Sistema", "Editar parámetros del sistema (incluye banner y eslogan)"],
];

/* [categoría, nombre, descripción, [[sku, variante, precio, stock, controla_stock]...]] */
const CATALOGO = [
  ["recargas", "Recarga Bidón 20 L", "Recarga de agua purificada en bidón de 20 litros, con despacho a domicilio.",
    [["BEF-REC-20-BEFINE", "Bidón Befine", 3000, 0, 0], ["BEF-REC-20-OTRA", "Bidón de otra marca", 3000, 0, 0]]],
  ["recargas", "Recarga Bidón 12 L", "Recarga de agua purificada en bidón de 12 litros.",
    [["BEF-REC-12", "Bidón 12 L", 2000, 0, 0]]],
  ["packs", "Pack 4 recargas 12 L", "Cuatro recargas de 12 litros a precio pack.",
    [["BEF-PACK-4REC12", "Pack x4", 7500, 0, 0]]],
  ["bidones", "Bidón 20 L", "Bidón retornable de 20 litros con agua purificada.",
    [["BEF-BID-20", "Bidón 20 L", 5900, 40, 1]]],
  ["bidones", "Bidón 12 L", "Bidón retornable de 12 litros con agua purificada.",
    [["BEF-BID-12", "Bidón 12 L", 4990, 4, 1]]],
  ["dispensadores", "Dispensador USB", "Dispensador portátil recargable por USB para bidones.",
    [["BEF-DISP-USB", "USB", 24990, 15, 1]]],
  ["dispensadores", "Dispensador de mesa frío/calor", "Dispensador de mesa con agua fría y caliente.",
    [["BEF-DISP-MESA", "Mesa", 79990, 8, 1]]],
  ["dispensadores", "Dispensador de pedestal", "Dispensador de pedestal con agua fría y caliente.",
    [["BEF-DISP-SINOCULTO", "Pedestal", 119990, 3, 1]]],
];

function sembrar(db) {
  const tx = db.transaction(() => {
    /* Roles y permisos */
    const roles = db.prepare("INSERT INTO roles (id, nombre, descripcion, es_sistema) VALUES (?,?,?,1)");
    roles.run("cliente", "Cliente", "Compra en la tienda");
    roles.run("admin", "Administrador", "Dueño: acceso total, gestiona roles");
    roles.run("chofer", "Chofer", "Ve los pedidos y datos de entrega");
    const pm = db.prepare("INSERT INTO permisos (codigo, modulo, descripcion) VALUES (?,?,?)");
    PERMISOS.forEach((p) => pm.run(...p));
    db.prepare("INSERT INTO rol_permisos (rol_id, permiso) VALUES ('chofer','pedidos.ver')").run();

    /* Precios, catálogo y cobertura */
    db.prepare("INSERT INTO niveles_precio (id, codigo, nombre) VALUES (1,'retail','Retail'),(2,'mayorista','Mayorista')").run();
    const cats = { recargas: "Recargas", bidones: "Bidones", dispensadores: "Dispensadores", packs: "Packs" };
    const catId = {};
    for (const [slug, nombre] of Object.entries(cats)) catId[slug] = db.prepare("INSERT INTO categorias (nombre, slug) VALUES (?,?)").run(nombre, slug).lastInsertRowid;

    const t0 = Date.now() - CATALOGO.length * 1000;   // created_at ascendente = orden del catálogo
    CATALOGO.forEach(([cat, nombre, desc, vars], i) => {
      const pid = uuid();
      db.prepare("INSERT INTO productos (id, categoria_id, nombre, descripcion, activo, created_at) VALUES (?,?,?,?,1,?)")
        .run(pid, catId[cat], nombre, desc, new Date(t0 + i * 1000).toISOString());
      for (const [sku, vnombre, precio, stock, controla] of vars) {
        const vid = uuid();
        db.prepare("INSERT INTO variantes_producto (id, producto_id, sku, nombre, stock, controla_stock, activo) VALUES (?,?,?,?,?,?,1)")
          .run(vid, pid, sku, vnombre, stock, controla);
        db.prepare("INSERT INTO precios_variante (variante_id, nivel_precio_id, precio) VALUES (?,?,?)").run(vid, 1, precio);
      }
    });

    const zq = db.prepare("INSERT INTO zonas_despacho (nombre, costo_despacho) VALUES (?,?)");
    const zQuil = zq.run("Quilicura", 0).lastInsertRowid, zNorte = zq.run("Sector Norte", 2500).lastInsertRowid;
    const cq = db.prepare("INSERT INTO comunas_cobertura (comuna, zona_id) VALUES (?,?)");
    cq.run("Quilicura", zQuil);
    ["Huechuraba", "Recoleta", "Valle Grande", "Valle Lo Campino"].forEach((c) => cq.run(c, zNorte));

    const par = db.prepare("INSERT INTO parametros (clave, valor, descripcion) VALUES (?,?,?)");
    par.run("envio_gratis_minimo", "7000", "Compra desde la cual el despacho es gratis en zonas con costo");
    par.run("stock_alerta", "10", "Unidades bajo las cuales el panel avisa stock bajo");
    par.run("clp_por_punto", "1000", "Pesos de compra por cada punto de fidelización");
    const desc = {
      sitio_eyebrow: "Banner: texto pequeño sobre el título", sitio_titulo: "Banner: título principal ({...} = parte destacada)",
      sitio_subtitulo: "Banner: párrafo bajo el título", sitio_pie: "Eslogan del pie de página",
      sitio_banner_desktop: "Banner: imagen para pantallas anchas", sitio_banner_movil: "Banner: imagen para celulares",
      sitio_banner_alt: "Banner: texto alternativo de la imagen", sitio_banner_oscuridad: "Banner: oscurecimiento de la imagen (0 a 80)",
    };
    for (const [k, v] of Object.entries(SITIO_DEFECTO)) par.run(k, v, desc[k]);

    /* Cuentas de prueba */
    const cuenta = (email, clave, nombre, rol, tel) => {
      const id = uuid();
      db.prepare("INSERT INTO auth_users (id, email, password_hash, is_anonymous, meta) VALUES (?,?,?,0,?)")
        .run(id, email, hashClave(clave), JSON.stringify({ nombre, telefono: tel }));
      db.prepare("INSERT INTO perfiles (id, nombre, telefono, rol) VALUES (?,?,?,?)").run(id, nombre, tel, rol);
      return id;
    };
    cuenta("admin@befine.local", "Admin123!", "Dueño Befine", "admin", "56911111111");
    cuenta("chofer@befine.local", "Chofer123!", "Chofer Prueba", "chofer", "56922222222");
    const cli = cuenta("cliente@befine.local", "Cliente123!", "Camila Fuentes", "cliente", "56987654321");

    /* Cupones de ejemplo */
    db.prepare(`INSERT INTO cupones (id, codigo, tipo, valor, requiere_cuenta, solo_primera_compra, descripcion)
                VALUES (?, 'BIENVENIDA10', 'porcentaje', 10, 1, 1, 'Cupón de bienvenida (solo 1ª compra, con cuenta)')`).run(uuid());
    db.prepare(`INSERT INTO cupones (id, codigo, tipo, valor, compra_minima, usos_maximos, descripcion)
                VALUES (?, 'AHORRO2000', 'monto_fijo', 2000, 10000, 50, 'Campaña de prueba')`).run(uuid());

    /* Pedidos de ejemplo para ver el panel con datos */
    const dir = uuid();
    db.prepare("INSERT INTO direcciones (id, perfil_id, zona_id, calle, numero, comuna, referencia) VALUES (?,?,?,?,?,?,?)")
      .run(dir, cli, zQuil, "Av. Los Aromos", "1234", "Quilicura", "Casa blanca, portón negro");
    const vid = (sku) => db.prepare("SELECT id FROM variantes_producto WHERE sku = ?").get(sku).id;
    const precio = (sku) => db.prepare("SELECT precio FROM precios_variante WHERE variante_id = ?").get(vid(sku)).precio;
    const habil = (d) => { const x = new Date(d); do { x.setDate(x.getDate() + 1); } while ([0, 6].includes(x.getDay())); return x.toISOString().slice(0, 10); };
    const EJ = [
      ["pendiente_pago", 0, [["BEF-REC-20-BEFINE", 2]]],
      ["pagado", 0, [["BEF-REC-20-BEFINE", 3], ["BEF-REC-12", 2]]],
      ["en_preparacion", 1, [["BEF-BID-20", 1], ["BEF-REC-20-BEFINE", 1]]],
      ["en_ruta", 2, [["BEF-PACK-4REC12", 1]]],
      ["entregado", 6, [["BEF-DISP-USB", 1], ["BEF-REC-20-BEFINE", 2]]],
      ["cancelado", 4, [["BEF-REC-12", 1]]],
    ];
    EJ.forEach(([estado, diasAtras, lineas], i) => {
      const id = uuid(), creado = new Date(Date.now() - diasAtras * 864e5 - i * 36e5);
      const sub = lineas.reduce((n, [s, c]) => n + precio(s) * c, 0), desp = 0;
      db.prepare(`INSERT INTO pedidos (id, numero, perfil_id, direccion_id, zona_id, nivel_precio_id, contacto_nombre, contacto_telefono, contacto_email,
                    fecha_entrega, subtotal, costo_despacho, total, estado, created_at)
                  VALUES (?,?,?,?,?,1,'Camila Fuentes','56987654321','cliente@befine.local',?,?,?,?,?,?)`)
        .run(id, 1001 + i, cli, dir, zQuil, habil(creado), sub, desp, sub + desp, estado, creado.toISOString());
      lineas.forEach(([s, c]) => db.prepare("INSERT INTO detalle_pedido (id, pedido_id, variante_id, cantidad, precio_unitario, subtotal) VALUES (?,?,?,?,?,?)")
        .run(uuid(), id, vid(s), c, precio(s), precio(s) * c));
      const flujo = ["pendiente_pago", "pagado", "en_preparacion", "en_ruta", "entregado"];
      const hasta = estado === "cancelado" ? ["pendiente_pago", "cancelado"] : flujo.slice(0, flujo.indexOf(estado) + 1);
      hasta.slice(1).forEach((e, k) => db.prepare("INSERT INTO historial_pedido (pedido_id, estado_anterior, estado_nuevo, nota, created_at) VALUES (?,?,?,?,?)")
        .run(id, hasta[k], e, e === "pagado" ? "Pago de ejemplo" : null, new Date(creado.getTime() + (k + 1) * 6e5).toISOString()));
    });
  });
  tx();
}

/* Siembra solo si la base está vacía */
function sembrarSiVacia(db) {
  const hay = db.prepare("SELECT COUNT(*) AS n FROM roles").get().n;
  if (!hay) { sembrar(db); return true; }
  return false;
}

module.exports = { sembrar, sembrarSiVacia, SITIO_DEFECTO, PERMISOS };
