/* =====================================================================
   auth.js — Cuentas y sesiones LOCALES (reemplazo de Supabase Auth)
   ---------------------------------------------------------------------
   - Contraseñas con scrypt (módulo crypto de Node, sin dependencias).
   - Sesión = token aleatorio guardado en la tabla `sesiones`; el
     navegador lo envía en la cabecera Authorization: Bearer <token>.
   - Invitados = usuarios anónimos (is_anonymous = 1), igual que en Supabase.
   - Sin correos reales: no hay confirmación de correo. La recuperación de
     contraseña imprime el enlace en la consola del servidor.
   ===================================================================== */
const crypto = require("node:crypto");

const uuid = () => crypto.randomUUID();

function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString("hex");
  return sal + ":" + crypto.scryptSync(clave, sal, 32).toString("hex");
}
function claveOk(clave, guardado) {
  if (!guardado) return false;
  const [sal, h] = guardado.split(":");
  const calc = crypto.scryptSync(clave, sal, 32);
  const real = Buffer.from(h, "hex");
  return real.length === calc.length && crypto.timingSafeEqual(real, calc);
}

/* Misma política que Supabase configurado en producción: 8+ caracteres con mayúscula,
   minúscula, número y símbolo. */
function validarClave(clave) {
  const c = String(clave || "");
  if (c.length >= 8 && /[a-z]/.test(c) && /[A-Z]/.test(c) && /[0-9]/.test(c) && /[^A-Za-z0-9]/.test(c)) return null;
  return "Password should contain at least 8 characters, with lowercase, uppercase, digits and symbols";
}

class ErrorAuth extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; }
}

const jsonSeguro = (t) => { try { return JSON.parse(t || "{}"); } catch (e) { return {}; } };

function usuarioPublico(u) {
  return u && { id: u.id, email: u.email || null, is_anonymous: !!u.is_anonymous, user_metadata: jsonSeguro(u.meta), created_at: u.created_at };
}

function crearAuth(db) {
  const qPorId = db.prepare("SELECT * FROM auth_users WHERE id = ?");
  const qPorEmail = db.prepare("SELECT * FROM auth_users WHERE email = ? COLLATE NOCASE");
  const qSesion = db.prepare("SELECT u.* FROM sesiones s JOIN auth_users u ON u.id = s.user_id WHERE s.token = ?");

  /* Trigger handle_new_user: toda cuenta nueva tiene su fila en perfiles */
  function crearPerfil(u) {
    const m = jsonSeguro(u.meta);
    const nombre = String(m.nombre || m.full_name || (u.email || "").split("@")[0] || "Invitado").trim().slice(0, 80) || "Invitado";
    const tel = String(m.telefono || "").replace(/[^0-9+]/g, "").slice(0, 20) || null;
    db.prepare("INSERT OR IGNORE INTO perfiles (id, nombre, telefono) VALUES (?,?,?)").run(u.id, nombre, tel);
  }

  function nuevaSesion(userId, tipo = "sesion") {
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sesiones (token, user_id, tipo) VALUES (?,?,?)").run(token, userId, tipo);
    return token;
  }
  const respuestaSesion = (u, token) => ({ access_token: token, token_type: "bearer", user: usuarioPublico(u) });

  return {
    usuarioDeToken(token) { return token ? qSesion.get(token) || null : null; },

    registrar({ email, password, data }) {
      email = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorAuth("Unable to validate email address: invalid format");
      const e = validarClave(password); if (e) throw new ErrorAuth(e, 422);
      if (qPorEmail.get(email)) throw new ErrorAuth("User already registered", 422);
      const u = { id: uuid(), email, is_anonymous: 0, meta: JSON.stringify(data || {}) };
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO auth_users (id, email, password_hash, is_anonymous, meta) VALUES (?,?,?,0,?)").run(u.id, email, hashClave(password), u.meta);
        crearPerfil(u);
      });
      tx();
      return respuestaSesion(qPorId.get(u.id), nuevaSesion(u.id));
    },

    ingresar({ email, password }) {
      const u = qPorEmail.get(String(email || "").trim());
      if (!u || u.is_anonymous || !claveOk(String(password || ""), u.password_hash)) throw new ErrorAuth("Invalid login credentials", 400);
      return respuestaSesion(u, nuevaSesion(u.id));
    },

    anonimo() {
      const id = uuid();
      db.transaction(() => {
        db.prepare("INSERT INTO auth_users (id, is_anonymous, meta) VALUES (?,1,'{}')").run(id);
        crearPerfil({ id, email: null, meta: "{}" });
      })();
      return respuestaSesion(qPorId.get(id), nuevaSesion(id));
    },

    /* updateUser: cambia correo/contraseña/metadatos. Un invitado que pone correo pasa a ser cuenta
       (trigger handle_user_upgrade: el perfil toma el nombre y el teléfono). */
    actualizar(u, { email, password, data }) {
      const meta = { ...jsonSeguro(u.meta), ...(data || {}) };
      if (password !== undefined) { const e = validarClave(password); if (e) throw new ErrorAuth(e, 422); }
      if (email) {
        email = String(email).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorAuth("Unable to validate email address: invalid format");
        const otro = qPorEmail.get(email);
        if (otro && otro.id !== u.id) throw new ErrorAuth("A user with this email address has already been registered", 422);
      }
      db.transaction(() => {
        db.prepare("UPDATE auth_users SET meta = ? WHERE id = ?").run(JSON.stringify(meta), u.id);
        if (email) db.prepare("UPDATE auth_users SET email = ?, is_anonymous = 0 WHERE id = ?").run(email, u.id);
        if (password !== undefined) db.prepare("UPDATE auth_users SET password_hash = ? WHERE id = ?").run(hashClave(password), u.id);
        if (email && u.is_anonymous) {
          const nombre = String(meta.nombre || meta.full_name || "").trim().slice(0, 80);
          const tel = String(meta.telefono || "").replace(/[^0-9+]/g, "").slice(0, 20);
          db.prepare("UPDATE perfiles SET nombre = COALESCE(NULLIF(?, ''), nombre), telefono = COALESCE(NULLIF(?, ''), telefono) WHERE id = ?").run(nombre, tel, u.id);
        }
      })();
      return usuarioPublico(qPorId.get(u.id));
    },

    salir(token) { db.prepare("DELETE FROM sesiones WHERE token = ?").run(token); },

    /* Recuperación: no se envía correo. Devuelve el enlace para mostrarlo en la consola del servidor. */
    recuperar(email) {
      const u = qPorEmail.get(String(email || "").trim());
      if (!u || u.is_anonymous) return null;
      return nuevaSesion(u.id, "recuperacion");
    },

    sesionDeRecuperacion(token) {
      const s = db.prepare("SELECT s.token, u.* FROM sesiones s JOIN auth_users u ON u.id = s.user_id WHERE s.token = ? AND s.tipo = 'recuperacion'").get(token);
      return s ? respuestaSesion(s, token) : null;
    },
    usuarioPublico,
  };
}

module.exports = { crearAuth, ErrorAuth, uuid, validarClave, hashClave, claveOk };
