/* Banner y eslogan: reglas de la tienda (data.js) y del panel (admin-logic.js) */
const test = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");
const { SITIO_DEFECTO } = require("../../server/seed");

const w = cargar(["data.js"]);
const S = w.Befine.sitio;
const L = cargar(["admin-logic.js"]).AdminLogic;
const arr = (x) => JSON.parse(JSON.stringify(x));
const filas = (o) => Object.entries(o).map(([k, v]) => ({ clave: "sitio_" + k, valor: v }));

test("CP-S01 sin datos se usan los textos originales de la tienda", () => {
  const s = S.normalizar([]);
  assert.equal(s.titulo, S.DEFECTO.titulo);
  assert.equal(s.banner_desktop, "");
  assert.equal(s.banner_oscuridad, 45);
});

test("CP-S02 los textos de ejemplo de la base coinciden con los de respaldo de la tienda", () => {
  const sembrados = Object.fromEntries(Object.entries(SITIO_DEFECTO).map(([k, v]) => [k.slice(6), v]));
  const norm = arr(S.normalizar(filas(sembrados)));
  assert.deepEqual({ ...norm }, arr(S.DEFECTO));
});

test("CP-S03 el título destacado se escapa y solo {…} se vuelve destacado", () => {
  assert.equal(S.tituloHTML("Agua {pura} hoy"), 'Agua <span class="serif">pura</span> hoy');
  assert.equal(S.tituloHTML('<img src=x onerror=alert(1)> {<b>}'), '&lt;img src=x onerror=alert(1)&gt; <span class="serif">&lt;b&gt;</span>');
  assert.equal(S.tituloPlano("Agua {pura}  hoy"), "Agua pura hoy");
});

test("CP-S04 solo se aceptan imágenes del sitio o https (nada de javascript: ni data:)", () => {
  assert.equal(S.urlImagenSegura("/uploads/banner-abc.webp"), "/uploads/banner-abc.webp");
  assert.equal(S.urlImagenSegura("assets/escena-noche.webp"), "assets/escena-noche.webp");
  assert.equal(S.urlImagenSegura("https://ejemplo.cl/a.jpg"), "https://ejemplo.cl/a.jpg");
  for (const mala of ["javascript:alert(1)", "data:image/png;base64,AAA", "http://x.cl/a.jpg", "/uploads/../secreto", "//evil.com/a.png"])
    assert.equal(S.urlImagenSegura(mala), "", mala);
});

test("CP-S05 el título nunca queda vacío y la oscuridad se acota entre 0 y 80", () => {
  assert.equal(S.normalizar(filas({ titulo: "   " })).titulo, S.DEFECTO.titulo);
  assert.equal(S.normalizar(filas({ banner_oscuridad: "500" })).banner_oscuridad, 80);
  assert.equal(S.normalizar(filas({ banner_oscuridad: "-5" })).banner_oscuridad, 0);
  assert.equal(S.normalizar(filas({ eyebrow: "" })).eyebrow, "");   // el texto pequeño sí puede quedar vacío
});

const ok = { eyebrow: "Hola", titulo: "Agua {pura}", subtitulo: "Texto", pie: "Pie", banner_desktop: "/uploads/banner-1.png", banner_movil: "", banner_alt: "Foto", banner_oscuridad: "40" };

test("CP-S06 validarSitio acepta un formulario correcto y arma las claves sitio_*", () => {
  const v = L.validarSitio(ok);
  assert.equal(v.fila.sitio_titulo, "Agua {pura}");
  assert.equal(v.fila.sitio_banner_oscuridad, "40");
  assert.deepEqual(arr(v.errores), {});
});

test("CP-S07 validarSitio rechaza título vacío, llaves mal puestas, textos largos, oscuridad y rutas inválidas", () => {
  assert.ok(L.validarSitio({ ...ok, titulo: "  " }).errores.titulo);
  assert.ok(L.validarSitio({ ...ok, titulo: "Agua {pura" }).errores.titulo);
  assert.ok(L.validarSitio({ ...ok, titulo: "Agua {} pura" }).errores.titulo);
  assert.ok(!L.validarSitio({ ...ok, titulo: "A {b} y {c}" }).errores.titulo);
  assert.ok(L.validarSitio({ ...ok, subtitulo: "x".repeat(321) }).errores.subtitulo);
  assert.ok(L.validarSitio({ ...ok, banner_oscuridad: "95" }).errores.banner_oscuridad);
  assert.ok(L.validarSitio({ ...ok, banner_oscuridad: "abc" }).errores.banner_oscuridad);
  assert.ok(L.validarSitio({ ...ok, banner_desktop: "javascript:alert(1)" }).errores.banner_desktop);
  assert.equal(L.validarSitio({ ...ok, titulo: "" }).fila, null);
});

test("CP-S08 validarImagen: solo JPG/PNG/WebP/GIF de hasta 5 MB", () => {
  assert.equal(L.validarImagen({ type: "image/webp", size: 1000 }), null);
  assert.ok(L.validarImagen({ type: "image/svg+xml", size: 1000 }));
  assert.ok(L.validarImagen({ type: "application/pdf", size: 1000 }));
  assert.ok(L.validarImagen({ type: "image/png", size: 6 * 1024 * 1024 }));
  assert.ok(L.validarImagen(null));
});
