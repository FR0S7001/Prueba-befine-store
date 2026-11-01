/* =====================================================================
   cargar.js — Carga los MISMOS archivos JS que usa el sitio (web/js/)
   en un contexto aislado de Node, simulando lo mínimo del navegador
   (window, localStorage, document y supabase-js).
   Así las pruebas no copian código: si el sitio cambia, la prueba lo nota.
   ===================================================================== */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WEB_JS = path.join(__dirname, "..", "..", "web", "js");

/* localStorage en memoria */
function crearLocalStorage(inicial = {}) {
  const datos = { ...inicial };
  return {
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v); },
    removeItem: (k) => { delete datos[k]; },
    clear: () => { for (const k of Object.keys(datos)) delete datos[k]; },
    _datos: datos,
  };
}

/* Date con hora fija (para probar saludos y franjas horarias) */
function dateFija(iso) {
  const RealDate = Date;
  const fija = new RealDate(iso);
  return class extends RealDate {
    constructor(...args) { if (args.length === 0) super(fija.getTime()); else super(...args); }
    static now() { return fija.getTime(); }
  };
}

/**
 * Carga uno o más archivos de web/js en un mismo contexto.
 * @param {string[]} archivos  p. ej. ["forms.js"]
 * @param {object}   opciones  { localStorage, fecha: "2026-10-09T10:00:00", cliente: Supabase simulado }
 * @returns el objeto window del contexto (con Store, Bands, BefineForms, Befine…)
 */
function cargar(archivos, opciones = {}) {
  const window = {};
  window.window = window;
  window.localStorage = opciones.localStorage || crearLocalStorage();
  window.document = { addEventListener() {}, documentElement: { style: { setProperty() {} } }, body: null };
  window.supabase = { createClient: () => opciones.cliente || {} };   // data.js crea el cliente al cargar (opciones.cliente = Supabase simulado)
  window.console = console;
  window.URLSearchParams = URLSearchParams;   // API del navegador que usa data.js (vuelta desde Mercado Pago)
  window.location = { protocol: "http:", href: "http://localhost:8080/index.html" };
  if (opciones.fecha) window.Date = dateFija(opciones.fecha);

  const ctx = vm.createContext(window);
  for (const nombre of archivos) {
    let codigo = fs.readFileSync(path.join(WEB_JS, nombre), "utf8");
    // data.js declara `const Befine` (variable global del script): la exponemos en window
    if (nombre === "data.js") codigo += "\n;window.Befine = Befine;";
    vm.runInContext(codigo, ctx, { filename: nombre });
  }
  return window;
}

module.exports = { cargar, crearLocalStorage };
