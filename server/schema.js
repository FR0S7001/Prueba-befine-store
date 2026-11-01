/* =====================================================================
   schema.js — Esquema de la base local (SQLite)
   ---------------------------------------------------------------------
   Reproduce las tablas que usa la tienda en Supabase (mismos nombres de
   tabla y de columna) para que la interfaz no cambie. Diferencias de
   tipo: uuid → TEXT, boolean → INTEGER 0/1, jsonb → TEXT (JSON),
   timestamptz → TEXT ISO-8601 (UTC).
   ===================================================================== */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const DDL = `
CREATE TABLE IF NOT EXISTS auth_users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  is_anonymous  INTEGER NOT NULL DEFAULT 0,
  meta          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL DEFAULT 'sesion',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY CHECK (id GLOB '[a-z]*'),
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  es_sistema  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS permisos (
  codigo      TEXT PRIMARY KEY,
  modulo      TEXT NOT NULL,
  descripcion TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rol_permisos (
  rol_id  TEXT NOT NULL REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  permiso TEXT NOT NULL REFERENCES permisos(codigo) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso)
);

CREATE TABLE IF NOT EXISTS niveles_precio (
  id     INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS perfiles (
  id              TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL DEFAULT 'Invitado',
  apellido        TEXT,
  telefono        TEXT,
  rut             TEXT,
  razon_social    TEXT,
  giro            TEXT,
  es_empresa      INTEGER NOT NULL DEFAULT 0,
  puntos_saldo    INTEGER NOT NULL DEFAULT 0,
  rol             TEXT NOT NULL DEFAULT 'cliente' REFERENCES roles(id) ON UPDATE CASCADE,
  nivel_precio_id INTEGER NOT NULL DEFAULT 1 REFERENCES niveles_precio(id),
  activo          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (${NOW}),
  updated_at      TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS categorias (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug   TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS productos (
  id           TEXT PRIMARY KEY,
  categoria_id INTEGER REFERENCES categorias(id),
  nombre       TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  descripcion  TEXT,
  imagen_url   TEXT,
  activo       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS variantes_producto (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL UNIQUE CHECK (length(trim(sku)) > 0),
  nombre         TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  atributos      TEXT NOT NULL DEFAULT '{}',
  stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  controla_stock INTEGER NOT NULL DEFAULT 1,
  activo         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS precios_variante (
  variante_id     TEXT NOT NULL REFERENCES variantes_producto(id) ON DELETE CASCADE,
  nivel_precio_id INTEGER NOT NULL REFERENCES niveles_precio(id),
  precio          INTEGER NOT NULL CHECK (precio >= 0),
  PRIMARY KEY (variante_id, nivel_precio_id)
);

CREATE TABLE IF NOT EXISTS zonas_despacho (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  costo_despacho INTEGER NOT NULL DEFAULT 0 CHECK (costo_despacho >= 0),
  activo         INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS comunas_cobertura (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  comuna  TEXT NOT NULL UNIQUE,
  zona_id INTEGER NOT NULL REFERENCES zonas_despacho(id),
  activo  INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS parametros (
  clave       TEXT PRIMARY KEY,
  valor       TEXT,
  descripcion TEXT
);
CREATE TABLE IF NOT EXISTS direcciones (
  id         TEXT PRIMARY KEY,
  perfil_id  TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  zona_id    INTEGER REFERENCES zonas_despacho(id),
  calle      TEXT NOT NULL,
  numero     TEXT NOT NULL,
  depto      TEXT,
  comuna     TEXT NOT NULL,
  referencia TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS cupones (
  id                  TEXT PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(codigo)) > 0),
  tipo                TEXT NOT NULL CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor               INTEGER NOT NULL CHECK (valor > 0),
  compra_minima       INTEGER NOT NULL DEFAULT 0 CHECK (compra_minima >= 0),
  usos_maximos        INTEGER CHECK (usos_maximos IS NULL OR usos_maximos > 0),
  usos_actuales       INTEGER NOT NULL DEFAULT 0,
  vigente_desde       TEXT,
  vigente_hasta       TEXT,
  activo              INTEGER NOT NULL DEFAULT 1,
  perfil_id           TEXT REFERENCES perfiles(id) ON DELETE CASCADE,
  requiere_cuenta     INTEGER NOT NULL DEFAULT 0,
  solo_primera_compra INTEGER NOT NULL DEFAULT 0,
  usos_por_cliente    INTEGER CHECK (usos_por_cliente IS NULL OR usos_por_cliente > 0),
  descripcion         TEXT CHECK (descripcion IS NULL OR length(descripcion) <= 200),
  created_at          TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (NOT solo_primera_compra OR requiere_cuenta)
);
CREATE TABLE IF NOT EXISTS cupon_variantes (
  cupon_id    TEXT NOT NULL REFERENCES cupones(id) ON DELETE CASCADE,
  variante_id TEXT NOT NULL REFERENCES variantes_producto(id) ON DELETE CASCADE,
  PRIMARY KEY (cupon_id, variante_id)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                TEXT PRIMARY KEY,
  numero            INTEGER NOT NULL UNIQUE,
  perfil_id         TEXT NOT NULL REFERENCES perfiles(id),
  direccion_id      TEXT REFERENCES direcciones(id),
  zona_id           INTEGER REFERENCES zonas_despacho(id),
  nivel_precio_id   INTEGER,
  notas             TEXT,
  contacto_nombre   TEXT,
  contacto_telefono TEXT,
  contacto_email    TEXT,
  fecha_entrega     TEXT,
  tipo_documento    TEXT NOT NULL DEFAULT 'boleta' CHECK (tipo_documento IN ('boleta','factura')),
  doc_rut           TEXT,
  doc_razon_social  TEXT,
  doc_giro          TEXT,
  subtotal          INTEGER NOT NULL DEFAULT 0,
  costo_despacho    INTEGER NOT NULL DEFAULT 0,
  descuento_cupon   INTEGER NOT NULL DEFAULT 0,
  cupon_id          TEXT REFERENCES cupones(id),
  total             INTEGER NOT NULL DEFAULT 0,
  puntos_ganados    INTEGER NOT NULL DEFAULT 0,
  estado            TEXT NOT NULL DEFAULT 'pendiente_pago'
                    CHECK (estado IN ('pendiente_pago','pagado','en_preparacion','en_ruta','entregado','cancelado')),
  created_at        TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_pedidos_perfil ON pedidos(perfil_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cupon  ON pedidos(cupon_id) WHERE cupon_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS detalle_pedido (
  id              TEXT PRIMARY KEY,
  pedido_id       TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  variante_id     TEXT NOT NULL REFERENCES variantes_producto(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL,
  subtotal        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS historial_pedido (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id       TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  nota            TEXT,
  cambiado_por    TEXT,
  created_at      TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS pagos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id        TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado           TEXT NOT NULL,
  monto            INTEGER NOT NULL,
  mp_payment_id    TEXT UNIQUE,
  mp_preference_id TEXT,
  raw_response     TEXT,
  fecha_pago       TEXT
);
CREATE TABLE IF NOT EXISTS movimientos_puntos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id       TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  pedido_id       TEXT REFERENCES pedidos(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL,
  puntos          INTEGER NOT NULL,
  saldo_posterior INTEGER NOT NULL,
  descripcion     TEXT,
  created_at      TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS documentos_tributarios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'pendiente',
  folio     TEXT,
  url_pdf   TEXT
);
`;

/* Columnas que la interfaz espera como true/false (SQLite las guarda como 0/1) */
const BOOLEANAS = {
  auth_users: ["is_anonymous"], roles: ["es_sistema"],
  perfiles: ["es_empresa", "activo"], productos: ["activo"],
  variantes_producto: ["controla_stock", "activo"], zonas_despacho: ["activo"],
  comunas_cobertura: ["activo"],
  cupones: ["activo", "requiere_cuenta", "solo_primera_compra"],
};
/* Columnas JSON (texto en SQLite, objeto en la interfaz) */
const JSONES = { variantes_producto: ["atributos"], pagos: ["raw_response"] };

/* Relaciones "embebidas" (select=...,tabla(columnas)). Clave: "padre>hija" */
const RELACIONES = {
  "productos>categorias":               { tipo: "uno",   fk: "categoria_id" },
  "productos>variantes_producto":       { tipo: "varios", fk: "producto_id" },
  "variantes_producto>precios_variante": { tipo: "varios", fk: "variante_id" },
  "variantes_producto>productos":       { tipo: "uno",   fk: "producto_id" },
  "pedidos>direcciones":                { tipo: "uno",   fk: "direccion_id" },
  "pedidos>detalle_pedido":             { tipo: "varios", fk: "pedido_id" },
  "pedidos>zonas_despacho":             { tipo: "uno",   fk: "zona_id" },
  "pedidos>cupones":                    { tipo: "uno",   fk: "cupon_id" },
  "pedidos>historial_pedido":           { tipo: "varios", fk: "pedido_id" },
  "pedidos>documentos_tributarios":     { tipo: "varios", fk: "pedido_id" },
  "detalle_pedido>variantes_producto":  { tipo: "uno",   fk: "variante_id" },
  "comunas_cobertura>zonas_despacho":   { tipo: "uno",   fk: "zona_id" },
  "cupones>cupon_variantes":            { tipo: "varios", fk: "cupon_id" },
};

module.exports = { DDL, NOW, BOOLEANAS, JSONES, RELACIONES };
