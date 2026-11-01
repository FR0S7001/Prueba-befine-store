/* =====================================================================
   local-client.js — Cliente de la base LOCAL (reemplaza a supabase-js)
   ---------------------------------------------------------------------
   Expone window.supabase.createClient(url, clave) con la MISMA forma que
   supabase-js (from().select().eq()…, rpc, auth, functions.invoke), pero
   habla con el servidor local de Befine (server/index.js, ruta /api).
   Así data.js y admin-data.js funcionan sin cambios de fondo.

   La sesión se guarda en localStorage (clave befine_local_session).
   Debe cargarse ANTES que data.js.
   ===================================================================== */
(function () {
  const LS = "befine_local_session";

  function crearCliente(base) {
    base = String(base || "/api").replace(/\/$/, "");
    const oyentes = [];
    let sesion = null, validada = null;

    try { sesion = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { sesion = null; }

    function guardar(s, evento) {
      sesion = s || null;
      try { if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS); } catch (e) { /* storage bloqueado */ }
      if (evento) oyentes.slice().forEach((cb) => { try { cb(evento, sesion); } catch (e) { console.error(e); } });
    }

    async function llamar(ruta, { metodo = "POST", cuerpo, bytes, tipo } = {}) {
      const cab = {};
      if (sesion && sesion.access_token) cab.Authorization = "Bearer " + sesion.access_token;
      let body;
      if (bytes) { body = bytes; if (tipo) cab["Content-Type"] = tipo; }
      else if (cuerpo !== undefined && metodo !== "GET") { body = JSON.stringify(cuerpo); cab["Content-Type"] = "application/json"; }
      let r;
      try { r = await fetch(base + "/" + ruta, { method: metodo, headers: cab, body }); }
      catch (e) { return { estado: 0, json: { error: { message: "Failed to fetch" } } }; }
      /* La sesión guardada ya no existe en el servidor (p. ej. base reiniciada): se descarta */
      if (r.headers.get("X-Sesion") === "invalida" && sesion) guardar(null, "SIGNED_OUT");
      let json = null; try { json = await r.json(); } catch (e) { json = {}; }
      return { estado: r.status, json };
    }

    /* Valida UNA vez por página que la sesión guardada siga vigente en el servidor */
    function validar() {
      if (!validada) validada = (async () => {
        if (!sesion) return;
        const { json } = await llamar("auth/session", { metodo: "GET" });
        const s = json && json.data && json.data.session;
        if (!s) guardar(null, "SIGNED_OUT"); else if (s.user) { sesion = { ...sesion, user: s.user }; guardar(sesion); }
      })();
      return validada;
    }

    /* Enlace de recuperación impreso por el servidor: ?local_token=… */
    const listo = (async () => {
      try {
        const q = new URLSearchParams(location.search), t = q.get("local_token");
        if (!t) return;
        const { json } = await llamar("auth/exchange", { cuerpo: { token: t } });
        const s = json && json.data && json.data.session;
        q.delete("local_token");
        history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
        if (s) { validada = Promise.resolve(); guardar(s, "PASSWORD_RECOVERY"); }
      } catch (e) { /* sin enlace */ }
    })();

    /* ---------- Constructor de consultas (from) ---------- */
    class Consulta {
      constructor(tabla) { this.q = { table: tabla, method: "select", select: "*", filters: [], order: [], limit: null, single: null, values: null, onConflict: null }; }
      select(cols) { if (this.q.method !== "select") { this.q.select = cols || "*"; this._devuelve = true; } else this.q.select = cols || "*"; return this; }
      insert(v) { this.q.method = "insert"; this.q.values = v; this.q.select = null; return this; }
      update(v) { this.q.method = "update"; this.q.values = v; this.q.select = null; return this; }
      upsert(v, o) { this.q.method = "upsert"; this.q.values = v; this.q.onConflict = (o && o.onConflict) || null; this.q.select = null; return this; }
      delete() { this.q.method = "delete"; this.q.select = null; return this; }
      _f(op, col, val) { this.q.filters.push({ col, op, val }); return this; }
      eq(c, v) { return this._f("eq", c, v); }
      neq(c, v) { return this._f("neq", c, v); }
      gt(c, v) { return this._f("gt", c, v); }
      gte(c, v) { return this._f("gte", c, v); }
      lt(c, v) { return this._f("lt", c, v); }
      lte(c, v) { return this._f("lte", c, v); }
      in(c, v) { return this._f("in", c, v); }
      is(c, v) { return this._f("is", c, v); }
      order(col, o) { this.q.order.push({ col, asc: !(o && o.ascending === false) }); return this; }
      limit(n) { this.q.limit = n; return this; }
      maybeSingle() { this.q.single = "maybe"; return this; }
      single() { this.q.single = "uno"; return this; }
      async _ejecutar() {
        await listo; await validar();
        const { estado, json } = await llamar("rest", { cuerpo: this.q });
        if (estado === 0) return { data: null, error: { message: "Failed to fetch" } };
        return json && "error" in json ? json : { data: null, error: { message: (json && json.error && json.error.message) || "Error del servidor" } };
      }
      then(ok, mal) { return this._ejecutar().then(ok, mal); }
    }

    /* ---------- Auth ---------- */
    const usuarioActual = () => (sesion && sesion.user) || null;
    const respuestaAuth = (json, estado) => {
      if (estado === 0) return { data: { session: null, user: null }, error: { message: "Failed to fetch" } };
      if (json && json.error) return { data: { session: null, user: null }, error: json.error };
      return null;
    };
    const auth = {
      async getSession() { await listo; await validar(); return { data: { session: sesion }, error: null }; },
      async getUser() { await listo; await validar(); return { data: { user: usuarioActual() }, error: null }; },
      async signInWithPassword({ email, password }) {
        const { estado, json } = await llamar("auth/signin", { cuerpo: { email, password } });
        const e = respuestaAuth(json, estado); if (e) return e;
        guardar(json.data.session, "SIGNED_IN");
        return { data: { session: sesion, user: sesion.user }, error: null };
      },
      async signUp({ email, password, options }) {
        const { estado, json } = await llamar("auth/signup", { cuerpo: { email, password, data: options && options.data } });
        const e = respuestaAuth(json, estado); if (e) return e;
        guardar(json.data.session, "SIGNED_IN");     // en modo local no hay correo de confirmación
        return { data: { session: sesion, user: sesion.user }, error: null };
      },
      async signInAnonymously() {
        const { estado, json } = await llamar("auth/anonymous", { cuerpo: {} });
        const e = respuestaAuth(json, estado); if (e) return e;
        guardar(json.data.session, "SIGNED_IN");
        return { data: { session: sesion, user: sesion.user }, error: null };
      },
      async updateUser(cambios) {
        await listo;
        const { estado, json } = await llamar("auth/update", { cuerpo: { email: cambios.email, password: cambios.password, data: cambios.data } });
        if (estado === 0) return { data: { user: null }, error: { message: "Failed to fetch" } };
        if (json && json.error) return { data: { user: null }, error: json.error };
        guardar({ ...sesion, user: json.data.user }, "USER_UPDATED");
        return { data: { user: json.data.user }, error: null };
      },
      async signOut() {
        await llamar("auth/logout", { cuerpo: {} });
        guardar(null, "SIGNED_OUT");
        return { error: null };
      },
      async resetPasswordForEmail(email, opciones) {
        const { estado, json } = await llamar("auth/recover", { cuerpo: { email, redirectTo: opciones && opciones.redirectTo } });
        if (estado === 0) return { data: null, error: { message: "Failed to fetch" } };
        return { data: {}, error: (json && json.error) || null };
      },
      /* El ingreso con Google no existe en modo local */
      async signInWithOAuth() { return { data: null, error: { message: "provider is not enabled" } }; },
      onAuthStateChange(cb) {
        oyentes.push(cb);
        return { data: { subscription: { unsubscribe() { const i = oyentes.indexOf(cb); if (i >= 0) oyentes.splice(i, 1); } } } };
      },
    };

    /* ---------- Funciones (reseñas, pago) ---------- */
    const functions = {
      async invoke(nombre, opciones) {
        await listo; await validar();
        const metodo = (opciones && opciones.method) || "POST";
        const { estado, json } = await llamar("functions/" + nombre, { metodo, cuerpo: (opciones && opciones.body) || {} });
        if (estado === 0) return { data: null, error: { message: "Failed to send a request to the Edge Function" } };
        if (json && json.error) return { data: null, error: { message: json.error.message, context: { json: async () => ({ error: json.error.message }) } } };
        return { data: json.data, error: null };
      },
    };

    return {
      from: (tabla) => new Consulta(tabla),
      async rpc(nombre, args) {
        await listo; await validar();
        const { estado, json } = await llamar("rpc/" + nombre, { cuerpo: args || {} });
        if (estado === 0) return { data: null, error: { message: "Failed to fetch" } };
        return json && "error" in json ? json : { data: null, error: { message: "Error del servidor" } };
      },
      auth, functions,
      /* Subida de imágenes del panel (banner). Devuelve { url } o { error }. */
      async subirImagen(archivo) {
        await listo; await validar();
        const { estado, json } = await llamar("upload", { bytes: archivo, tipo: archivo.type || "application/octet-stream" });
        if (estado === 0) return { error: { message: "Failed to fetch" } };
        return json && json.url ? { url: json.url, error: null } : { url: null, error: (json && json.error) || { message: "No se pudo subir la imagen." } };
      },
    };
  }

  window.supabase = { createClient: (url) => crearCliente(url) };
})();
