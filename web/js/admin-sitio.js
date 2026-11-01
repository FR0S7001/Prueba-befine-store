/* =====================================================================
   admin-sitio.js — Sección "Banner y eslogan" del panel
   ---------------------------------------------------------------------
   Permite al dueño cambiar, sin tocar código:
     · el BANNER de la portada: imagen para pantallas anchas, imagen para
       celulares (opcional), texto alternativo y cuánto se oscurece;
     · el ESLOGAN: texto pequeño, título (con una frase destacada entre
       llaves { }), subtítulo y la frase del pie de página.
   Muestra una vista previa en vivo (escritorio / celular). Nada se publica
   hasta presionar "Guardar cambios". Permiso: config.gestionar.
   Los valores viven en parametros.sitio_* (ver Befine.getSitio en data.js).
   ===================================================================== */
(function () {
  const L = window.AdminLogic;
  const { esc, ICONOS, UI } = window.AdminApp;
  const A = () => Befine.admin;

  const TEXTOS = ["eyebrow", "titulo", "subtitulo", "pie", "banner_alt"];
  let el, guardado = null, estado = null, vista = "desktop";

  const q = (s) => el.querySelector(s);
  const aForm = (s) => ({ ...s, banner_oscuridad: String(s.banner_oscuridad) });
  const sucio = () => !!guardado && JSON.stringify(estado) !== JSON.stringify(guardado);

  function montar(seccion) {
    el = seccion;
    el.innerHTML = `
      <div class="ad-head">
        <div><h1>Banner y eslogan</h1><p>Cambia la imagen y los textos de la portada de la tienda. Se publican al guardar.</p></div>
        <div class="acciones">
          <a class="ad-btn ghost" href="index.html" target="_blank" rel="noopener">Ver la tienda</a>
          <button class="ad-btn" type="button" id="stGuardar" disabled>Guardar cambios</button>
        </div>
      </div>
      <p class="st-aviso" id="stAviso" hidden>Tienes cambios sin guardar.</p>
      <div class="st-grid" id="stCuerpo"><div class="ad-vacio"><span class="ad-spin"></span></div></div>`;
    q("#stGuardar").addEventListener("click", (e) => guardar(e.currentTarget));
    // Eventos (delegados sobre el contenedor, que no se reemplaza)
    const cuerpo = q("#stCuerpo");
    cuerpo.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      estado[k] = e.target.value; limpiarError(k); pintarVista(); marcarCambios();
    });
    cuerpo.addEventListener("change", (e) => { if (e.target.matches("[data-subir]")) subir(e.target); });
    cuerpo.addEventListener("click", (e) => {
      const quitar = e.target.closest("[data-quitar]");
      if (quitar) { estado[quitar.dataset.quitar] = ""; pintarVista(); marcarCambios(); return; }
      const tab = e.target.closest("[data-vista]");
      if (tab) { vista = tab.dataset.vista; cuerpo.querySelectorAll("[data-vista]").forEach((b) => b.setAttribute("aria-selected", String(b === tab))); pintarVista(); return; }
      if (e.target.closest("#stOriginales")) {
        const d = Befine.sitio.DEFECTO;
        ["eyebrow", "titulo", "subtitulo", "pie"].forEach((k) => { estado[k] = d[k]; q(`#st_${k}`).value = d[k]; limpiarError(k); });
        pintarVista(); marcarCambios(); UI.toast("Se cargaron los textos originales. Presiona Guardar para publicarlos.");
      }
    });

    window.addEventListener("beforeunload", (e) => { if (sucio()) { e.preventDefault(); e.returnValue = ""; } });
  }

  async function mostrar() { if (!guardado) await cargar(); }

  async function cargar() {
    try {
      guardado = aForm(await A().getSitio()); estado = { ...guardado };
      pintarFormulario(); pintarVista(); marcarCambios();
    } catch (e) {
      q("#stCuerpo").innerHTML = `<div class="ad-vacio">No pudimos cargar la configuración. ${esc(A().msg(e))}</div>`;
    }
  }

  /* ---------- Formulario ---------- */
  function campoTexto(id, etiqueta, ayuda, tipo, filas) {
    const max = L.SITIO_LIMITES[id];
    const ctl = tipo === "area"
      ? `<textarea class="ad-inp" id="st_${id}" data-k="${id}" rows="${filas || 3}" maxlength="${max + 40}"></textarea>`
      : `<input class="ad-inp" id="st_${id}" data-k="${id}" maxlength="${max + 40}" autocomplete="off">`;
    return `<label class="full">${etiqueta}${ayuda ? ` <small>${ayuda}</small>` : ""}${ctl}
      <span class="st-cont"><span class="err" data-err="${id}"></span><span data-cont="${id}"></span></span></label>`;
  }

  function campoImagen(id, titulo, ayuda) {
    return `<div class="st-img" data-img="${id}">
      <div class="st-img-top"><b>${titulo}</b><small>${ayuda}</small></div>
      <div class="st-thumb" data-thumb="${id}"><span>Sin imagen</span></div>
      <div class="st-img-acc">
        <label class="ad-btn sm ghost st-subir">${ICONOS.mas}<span>Subir imagen</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-subir="${id}" hidden></label>
        <button class="ad-btn sm peligro" type="button" data-quitar="${id}" hidden>Quitar</button>
      </div>
      <span class="err" data-err="${id}"></span>
    </div>`;
  }

  function pintarFormulario() {
    q("#stCuerpo").innerHTML = `
      <div class="st-col">
        <section class="ad-card st-bloque">
          <h2>Banner</h2>
          <p class="st-nota">Imagen de fondo de la portada. Recomendado: horizontal, de al menos 1600 px de ancho, JPG o WebP de hasta 5 MB. Si no subes ninguna, la portada se ve como siempre.</p>
          <div class="st-imgs">
            ${campoImagen("banner_desktop", "Pantallas anchas", "Computador y tablet")}
            ${campoImagen("banner_movil", "Celulares", "Opcional · vertical o cuadrada. Si no la subes, se usa la de pantallas anchas")}
          </div>
          <div class="ad-form st-form">
            ${campoTexto("banner_alt", "Descripción de la imagen", "(para lectores de pantalla; opcional)")}
            <label class="full">Oscurecer la imagen <small>(para que el texto se lea bien)</small>
              <span class="st-rango"><input type="range" id="st_osc" data-k="banner_oscuridad" min="${L.SITIO_OSCURIDAD.min}" max="${L.SITIO_OSCURIDAD.max}" step="5"><output id="st_osc_v"></output></span>
              <span class="err" data-err="banner_oscuridad"></span>
            </label>
          </div>
        </section>
        <section class="ad-card st-bloque">
          <h2>Eslogan</h2>
          <div class="ad-form st-form">
            ${campoTexto("eyebrow", "Texto pequeño sobre el título", "(opcional)")}
            ${campoTexto("titulo", "Título principal", "· Encierra entre llaves la frase destacada: Recarga de agua {a domicilio} en Quilicura")}
            ${campoTexto("subtitulo", "Subtítulo", "(opcional)", "area", 4)}
            ${campoTexto("pie", "Frase del pie de página", "(opcional)", "area", 2)}
          </div>
          <button class="ad-link sm" type="button" id="stOriginales">Volver a los textos originales</button>
        </section>
      </div>
      <aside class="st-col st-lado">
        <section class="ad-card st-bloque">
          <div class="st-vista-top"><h2>Vista previa</h2>
            <div class="st-tabs" role="tablist" aria-label="Tamaño de pantalla">
              <button type="button" role="tab" data-vista="desktop" aria-selected="true">Escritorio</button>
              <button type="button" role="tab" data-vista="movil" aria-selected="false">Celular</button>
            </div></div>
          <div class="st-vista" id="stVista"></div>
          <p class="st-nota">Así se verá la portada. El pie de página se muestra aparte:</p>
          <p class="st-pie-prev" id="stPiePrev"></p>
        </section>
      </aside>`;

    // Valores actuales
    TEXTOS.forEach((k) => { const c = q(`#st_${k}`); if (c) c.value = estado[k]; });
    q("#st_osc").value = estado.banner_oscuridad;
  }

  const limpiarError = (k) => { const s = q(`[data-err="${k}"]`); if (s) s.textContent = ""; const c = q(`[data-k="${k}"]`); if (c) c.classList.remove("mal"); };
  function mostrarErrores(errores) {
    Object.entries(errores).forEach(([k, m]) => { const s = q(`[data-err="${k}"]`); if (s) s.textContent = m; const c = q(`[data-k="${k}"]`); if (c) c.classList.add("mal"); });
    const primero = Object.keys(errores)[0], c = primero && (q(`[data-k="${primero}"]`) || q(`[data-img="${primero}"]`));
    if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ---------- Vista previa ---------- */
  function pintarVista() {
    const d = estado.banner_desktop, m = estado.banner_movil;
    const url = Befine.sitio.urlImagenSegura(vista === "movil" ? (m || d) : (d || m));
    const osc = Math.min(80, Math.max(0, parseInt(estado.banner_oscuridad, 10) || 0)) / 100;
    const caja = q("#stVista");
    caja.className = "st-vista " + vista + (url ? " con-banner" : "");
    caja.innerHTML = (url ? `<img src="${esc(url)}" alt=""><span class="velo" style="--osc:${osc}"></span>` : "") +
      `<div class="st-txt">
        ${estado.eyebrow ? `<p class="eb">${esc(estado.eyebrow)}</p>` : ""}
        <h3>${Befine.sitio.tituloHTML(estado.titulo)}</h3>
        ${estado.subtitulo ? `<p class="sb">${esc(estado.subtitulo)}</p>` : ""}
      </div>`;
    q("#stPiePrev").textContent = estado.pie || "(sin frase en el pie de página)";
    // Miniaturas y botones "Quitar"
    ["banner_desktop", "banner_movil"].forEach((k) => {
      const u = Befine.sitio.urlImagenSegura(estado[k]), t = q(`[data-thumb="${k}"]`);
      t.innerHTML = u ? `<img src="${esc(u)}" alt="">` : "<span>Sin imagen</span>";
      q(`[data-quitar="${k}"]`).hidden = !estado[k];
    });
    q("#st_osc_v").textContent = Math.round(osc * 100) + " %";
    TEXTOS.forEach((k) => {
      const c = q(`[data-cont="${k}"]`); if (!c) return;
      const n = String(estado[k] || "").length, max = L.SITIO_LIMITES[k];
      c.textContent = `${n}/${max}`; c.classList.toggle("pasado", n > max);
    });
  }

  function marcarCambios() {
    const s = sucio();
    q("#stGuardar").disabled = !s;
    q("#stAviso").hidden = !s;
  }

  /* ---------- Subir imagen ---------- */
  async function subir(input) {
    const k = input.dataset.subir, archivo = input.files && input.files[0];
    input.value = "";                                  // permite volver a elegir el mismo archivo
    if (!archivo) return;
    limpiarError(k);
    const caja = q(`[data-thumb="${k}"]`); caja.innerHTML = '<span class="ad-spin"></span>';
    const r = await A().subirImagen(archivo);
    if (!r.ok) { pintarVista(); mostrarErrores({ [k]: r.error }); return UI.toast(r.error, "mal"); }
    estado[k] = r.url; pintarVista(); marcarCambios();
    UI.toast("Imagen subida. Presiona Guardar cambios para publicarla.");
  }

  /* ---------- Guardar ---------- */
  async function guardar(btn) {
    const v = L.validarSitio(estado);
    TEXTOS.concat(["banner_desktop", "banner_movil", "banner_oscuridad"]).forEach(limpiarError);
    if (v.fila === null) { mostrarErrores(v.errores); return UI.toast("Revisa los campos marcados.", "mal"); }
    const r = await UI.conCarga(btn, () => A().guardarSitio(v.fila));
    if (!r.ok) return UI.toast(r.error, "mal");
    guardado = { ...estado,
      eyebrow: v.fila.sitio_eyebrow, titulo: v.fila.sitio_titulo, subtitulo: v.fila.sitio_subtitulo, pie: v.fila.sitio_pie,
      banner_alt: v.fila.sitio_banner_alt, banner_oscuridad: v.fila.sitio_banner_oscuridad };
    estado = { ...guardado };
    TEXTOS.forEach((k) => { q(`#st_${k}`).value = estado[k]; });
    pintarVista(); marcarCambios();
    UI.toast("Cambios publicados: ya se ven en la tienda.");
  }

  window.AdminApp.SECCIONES.sitio = { montar, mostrar, recargar: cargar };
})();
