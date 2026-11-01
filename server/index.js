/* =====================================================================
   index.js — Servidor LOCAL de Befine Store
   ---------------------------------------------------------------------
   Un solo proceso de Node que:
     1. sirve el sitio (carpeta web/) y las imágenes subidas (/uploads),
     2. ofrece la API local que usa js/local-client.js (/api/...), con la
        base de datos SQLite en data/befine.db.
   Uso:  npm start   →   http://localhost:8080
   ===================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { abrir, DIR_DATOS, RAIZ, reiniciar } = require("./db");
const { sembrarSiVacia } = require("./seed");
const { crearAuth, ErrorAuth } = require("./auth");
const { consultar, crearContexto, puede } = require("./rest");
const { RPC, ErrorRPC } = require("./rpc");
const { ejecutarFuncion, ErrorFuncion } = require("./functions");

const WEB = path.join(RAIZ, "web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};
const MAX_JSON = 1024 * 1024;
const MAX_IMAGEN = 5 * 1024 * 1024;

/* Tipo real de una imagen según sus primeros bytes (no se confía en el nombre ni en Content-Type).
   SVG no se acepta: puede traer scripts. */
function tipoImagen(buf) {
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ".webp";
  if (buf.length > 6 && buf.slice(0, 4).toString() === "GIF8") return ".gif";
  return null;
}

function leerCuerpo(req, limite) {
  return new Promise((ok, mal) => {
    const partes = []; let n = 0, excedido = false;
    /* Si se pasa del límite se deja de guardar, pero se termina de leer para poder responder 413 sin cortar la conexión */
    req.on("data", (c) => { n += c.length; if (n > limite) { excedido = true; partes.length = 0; } else if (!excedido) partes.push(c); });
    req.on("end", () => (excedido ? mal(Object.assign(new Error("El archivo es demasiado grande."), { estado: 413 })) : ok(Buffer.concat(partes))));
    req.on("error", mal);
  });
}
const leerJSON = async (req) => {
  const b = await leerCuerpo(req, MAX_JSON);
  if (!b.length) return {};
  try { return JSON.parse(b.toString("utf8")); } catch (e) { throw Object.assign(new Error("JSON no válido."), { estado: 400 }); }
};

function responder(res, estado, cuerpo, cabeceras = {}) {
  const esBuf = Buffer.isBuffer(cuerpo);
  res.writeHead(estado, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(esBuf ? {} : { "Content-Type": "application/json; charset=utf-8" }), ...cabeceras });
  res.end(esBuf ? cuerpo : JSON.stringify(cuerpo));
}

/* Crea el manejador HTTP. `db` y `dirSubidas` se pueden reemplazar (pruebas). */
function crearManejador(db, { dirSubidas = path.join(DIR_DATOS, "uploads"), ahora } = {}) {
  const auth = crearAuth(db);
  const tokenDe = (req) => { const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || ""); return m ? m[1] : null; };

  async function api(req, res, url) {
    const ruta = url.pathname.replace(/^\/api\//, "");
    const token = tokenDe(req);
    const user = auth.usuarioDeToken(token);
    const ctx = crearContexto(db, user);
    /* Si el navegador guardó una sesión que ya no existe (p. ej. base reiniciada), se le avisa */
    const extra = token && !user ? { "X-Sesion": "invalida" } : {};
    const ok = (cuerpo, estado = 200) => responder(res, estado, cuerpo, extra);

    if (ruta === "rest" && req.method === "POST") return ok(consultar(ctx, await leerJSON(req)));

    if (ruta.startsWith("rpc/") && req.method === "POST") {
      const f = RPC[ruta.slice(4)];
      if (!f) return ok({ data: null, error: { message: "Could not find the function public." + ruta.slice(4), code: "PGRST202" } });
      try { return ok({ data: f(ctx, await leerJSON(req), ahora && ahora()), error: null }); }
      catch (e) {
        if (e instanceof ErrorRPC) return ok({ data: null, error: { message: e.message, code: e.code } });
        throw e;
      }
    }

    if (ruta.startsWith("functions/")) {
      try { return ok({ data: ejecutarFuncion(ruta.slice(10), ctx, req.method === "POST" ? await leerJSON(req) : {}), error: null }); }
      catch (e) {
        if (e instanceof ErrorFuncion || e instanceof ErrorRPC) return ok({ data: null, error: { message: e.message } }, e.estado || 400);
        throw e;
      }
    }

    if (ruta.startsWith("auth/")) {
      const accion = ruta.slice(5);
      try {
        if (accion === "session" && req.method === "GET") return ok({ data: { session: user ? { access_token: token, user: auth.usuarioPublico(user) } : null }, error: null });
        const body = req.method === "POST" ? await leerJSON(req) : {};
        if (accion === "signup") return ok({ data: { session: auth.registrar(body) }, error: null });
        if (accion === "signin") return ok({ data: { session: auth.ingresar(body) }, error: null });
        if (accion === "anonymous") return ok({ data: { session: auth.anonimo() }, error: null });
        if (accion === "logout") { if (token) auth.salir(token); return ok({ error: null }); }
        if (accion === "update") {
          if (!user) throw new ErrorAuth("Auth session missing!", 401);
          return ok({ data: { user: auth.actualizar(user, body) }, error: null });
        }
        if (accion === "recover") {
          const t = auth.recuperar(body.email);
          if (t) console.log(`\n[recuperación de contraseña] ${body.email}\n  Abre este enlace: ${body.redirectTo || "http://localhost:8080/cuenta.html?modo=nueva"}${(body.redirectTo || "").includes("?") ? "&" : "?"}local_token=${t}\n`);
          return ok({ data: {}, error: null });   // igual que Supabase: no revela si el correo existe
        }
        if (accion === "exchange") {
          const s = auth.sesionDeRecuperacion(String(body.token || ""));
          return ok(s ? { data: { session: s }, error: null } : { data: { session: null }, error: { message: "Enlace no válido o vencido" } });
        }
      } catch (e) {
        if (e instanceof ErrorAuth) return ok({ data: null, error: { message: e.message } }, e.estado);
        throw e;
      }
    }

    /* Subida de imágenes (banner): cuerpo = bytes de la imagen. Requiere config.gestionar. */
    if (ruta === "upload" && req.method === "POST") {
      if (!puede(ctx, "config.gestionar")) return ok({ error: { message: "No tienes permiso para subir imágenes." } }, 403);
      const buf = await leerCuerpo(req, MAX_IMAGEN);
      const ext = tipoImagen(buf);
      if (!ext) return ok({ error: { message: "Solo se aceptan imágenes JPG, PNG, WebP o GIF." } }, 415);
      fs.mkdirSync(dirSubidas, { recursive: true });
      const nombre = `banner-${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(dirSubidas, nombre), buf);
      return ok({ url: "/uploads/" + nombre });
    }

    return ok({ error: { message: "Ruta no encontrada." } }, 404);
  }

  function estatico(req, res, url) {
    let ruta;
    try { ruta = decodeURIComponent(url.pathname); } catch (e) { return responder(res, 400, Buffer.from("Solicitud no válida")); }
    let base = WEB;
    if (ruta.startsWith("/uploads/")) { base = dirSubidas; ruta = ruta.slice("/uploads".length); }
    if (ruta.endsWith("/")) ruta += "index.html";
    const candidatos = [ruta, ruta + ".html"];
    for (const c of candidatos) {
      const archivo = path.normalize(path.join(base, c));
      if (archivo !== base && !archivo.startsWith(base + path.sep)) continue;           // sin salir de la carpeta
      let st; try { st = fs.statSync(archivo); } catch (e) { continue; }
      if (!st.isFile()) continue;
      const tipo = MIME[path.extname(archivo).toLowerCase()] || "application/octet-stream";
      return responder(res, 200, fs.readFileSync(archivo), { "Content-Type": tipo, "Cache-Control": "no-cache" });
    }
    responder(res, 404, Buffer.from("No encontrado"), { "Content-Type": "text/plain; charset=utf-8" });
  }

  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") return responder(res, 405, { error: { message: "Método no permitido." } });
      return estatico(req, res, url);
    } catch (e) {
      const estado = e.estado || 500;
      if (estado >= 500) console.error(e);
      if (!res.headersSent) responder(res, estado, { error: { message: estado >= 500 ? "Error interno del servidor." : e.message } });
    }
  };
}

function iniciar() {
  const db = abrir();
  if (sembrarSiVacia(db)) console.log("Base de datos nueva: se cargaron los datos de ejemplo.");
  const puerto = Number(process.env.PORT || process.env.WEB_PORT || 8080);
  const host = process.env.HOST || "127.0.0.1";
  const srv = http.createServer(crearManejador(db));
  srv.listen(puerto, host, () => {
    console.log(`\nBefine Store (modo local) → http://localhost:${puerto}`);
    console.log("Panel admin: http://localhost:" + puerto + "/admin.html   (admin@befine.local / Admin123!)\n");
  });
  return srv;
}

if (require.main === module) {
  if (process.argv.includes("--reset")) {
    const db = abrir(); reiniciar(db); console.log("Base de datos reiniciada con los datos de ejemplo."); process.exit(0);
  }
  iniciar();
}

module.exports = { crearManejador, iniciar, tipoImagen };
