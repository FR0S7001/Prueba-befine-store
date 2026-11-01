/* =====================================================================
   forms.js — Utilidades de formularios compartidas (checkout y cuenta)
   Validación chilena (RUT, celular), errores en línea accesibles,
   mostrar/ocultar contraseña, fuerza de contraseña y botón "cargando".
   ===================================================================== */
(function () {
  const Val = {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v || "").trim()),
    /* Celular chileno: 9 dígitos que empiezan con 9 (acepta +56, espacios y guiones) */
    limpiarTel: (v) => (v || "").replace(/\D/g, "").replace(/^56(?=9\d{8}$)/, ""),
    telefono: (v) => /^9\d{8}$/.test(Val.limpiarTel(v)),
    formatoTel: (v) => { const d = Val.limpiarTel(v).slice(0, 9); return d.replace(/^(\d)(\d{0,4})(\d{0,4}).*/, (m, a, b, c) => [a, b, c].filter(Boolean).join(" ")); },
    /* RUT: módulo 11 */
    limpiarRut: (v) => (v || "").replace(/[^0-9kK]/g, "").toUpperCase(),
    rut: (v) => {
      const r = Val.limpiarRut(v); if (r.length < 8) return false;
      const cuerpo = r.slice(0, -1), dv = r.slice(-1); let s = 0, m = 2;
      for (let i = cuerpo.length - 1; i >= 0; i--) { s += +cuerpo[i] * m; m = m === 7 ? 2 : m + 1; }
      const e = 11 - (s % 11), dvOk = e === 11 ? "0" : e === 10 ? "K" : String(e);
      return dv === dvOk;
    },
    formatoRut: (v) => { const r = Val.limpiarRut(v); if (r.length < 2) return r;
      return r.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + r.slice(-1); },
    /* Requisitos de contraseña — iguales a los configurados en Supabase Auth
       (mín. 8, minúscula, mayúscula, número y símbolo). Devuelve lo que falta. */
    SIMBOLOS: "!@#$%^&*()_+-=[]{};':\"|<>?,./`~\\",
    reqsClave: (p) => {
      p = p || "";
      return [
        { id: "largo", txt: "8 o más caracteres", ok: p.length >= 8 },
        { id: "may", txt: "una mayúscula", ok: /[A-Z]/.test(p) },
        { id: "min", txt: "una minúscula", ok: /[a-z]/.test(p) },
        { id: "num", txt: "un número", ok: /\d/.test(p) },
        { id: "sim", txt: "un símbolo (. @ # ! …)", ok: [...p].some((c) => Val.SIMBOLOS.includes(c)) },
      ];
    },
    claveFaltante: (p) => Val.reqsClave(p).filter((r) => !r.ok).map((r) => r.txt),
    /* Fuerza de contraseña 0–4 */
    fuerza: (p) => { p = p || ""; let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++; else if (/\d/.test(p)) s += 0.5; return Math.min(4, Math.floor(s)); },
  };

  /* Error en línea: marca el campo, muestra el mensaje y lo anuncia a lectores de pantalla */
  function setError(input, msg) {
    const fld = input.closest(".fld") || input.parentElement;
    let el = fld.querySelector(".fld-err");
    if (!el) { el = document.createElement("small"); el.className = "fld-err"; el.id = (input.id || "f" + Math.random().toString(36).slice(2)) + "-err"; fld.appendChild(el); }
    el.textContent = msg; fld.classList.add("err");
    input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", el.id);
  }
  function clearError(input) {
    const fld = input.closest(".fld") || input.parentElement;
    fld.classList.remove("err"); input.removeAttribute("aria-invalid");
    const el = fld.querySelector(".fld-err"); if (el) el.textContent = "";
  }
  /* Limpia el error apenas el usuario corrige */
  function autoLimpiar(form) {
    form.addEventListener("input", (e) => { if (e.target.matches("input,select,textarea")) clearError(e.target); });
  }

  /* Ojo para mostrar/ocultar contraseña: <button data-ver-clave="idInput"> */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver-clave]"); if (!b) return;
    const inp = document.getElementById(b.dataset.verClave); if (!inp) return;
    const ver = inp.type === "password"; inp.type = ver ? "text" : "password";
    b.setAttribute("aria-pressed", String(ver)); b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
  });

  /* Botón en estado "cargando" (spinner + texto) */
  function cargando(btn, on, texto) {
    if (on) { btn.dataset.txt = btn.innerHTML; btn.disabled = true; btn.classList.add("is-loading"); btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${texto || "Procesando…"}`; }
    else { btn.disabled = false; btn.classList.remove("is-loading"); if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt; }
  }

  /* Ícono genérico para "Continuar con Google". Para producción, reemplazar por el botón
     oficial que Google entrega en su guía de marca (developers.google.com/identity/branding-guidelines). */
  const GOOGLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16.6" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="13" fill="currentColor">G</text></svg>';

  window.BefineForms = { Val, setError, clearError, autoLimpiar, cargando, GOOGLE_SVG };
})();
