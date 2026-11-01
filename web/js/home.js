/* =====================================================================
   home.js — Home fiel al demo de Carlos (orquesta todas las animaciones)
   ---------------------------------------------------------------------
   Coordina: burbujas, cursor custom, intro/loader, agua reactiva (con
   color por banda horaria), carrusel de destacados con brillo/parallax,
   catálogo "cine" flotante en 3D, sonido y el selector de horario (demo).
   Los datos salen de la API falsa (data.js); las tarjetas, de cards.js.
   ===================================================================== */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover:hover) and (pointer:fine)").matches;

  document.addEventListener("DOMContentLoaded", async () => {

    /* ---------- Saludo (loader + barra), según la hora ---------- */
    const loader = document.getElementById("loader");
    const loaderGreet = document.getElementById("loaderGreet");
    const loaderMsg = document.getElementById("loaderMsg");
    const barGreet = document.getElementById("barGreet");
    function renderGreeting() {
      const g = Bands.greeting(null);
      loaderGreet.textContent = g.hi;
      loaderMsg.textContent = g.msg;
      if (barGreet) barGreet.textContent = g.hi + " · bienvenido a Befine";
    }

    /* ---------- Intro / loader ---------- */
    let loaderTimer;
    function showLoader() { Bands.apply(); renderGreeting(); loader.classList.remove("hide");
      clearTimeout(loaderTimer); loaderTimer = setTimeout(hideLoader, reduce ? 500 : 700); } // 0,7 s visible + 0,3 s de salida = máx. 1 s
    function hideLoader() { clearTimeout(loaderTimer); loader.classList.add("hide"); }
    loader.addEventListener("pointerdown", hideLoader);
    const verIntro = document.getElementById("verIntro");
    if (verIntro) verIntro.addEventListener("click", showLoader);
    // La bienvenida sale UNA vez por visita: se recuerda en sessionStorage (se borra al cerrar la pestaña/navegador).
    renderGreeting();
    let vista = false; try { vista = sessionStorage.getItem("befine_intro") === "1"; } catch (e) {}
    if (!vista) { showLoader(); try { sessionStorage.setItem("befine_intro", "1"); } catch (e) {} }
    else { Bands.apply(); hideLoader(); }
    // Para que el selector de horario (footer, en shell.js) actualice el saludo.
    window.onBandChange = renderGreeting;

    /* ---------- BANNER Y ESLOGAN del hero (editables desde el panel) ----------
       Se pinta primero la última copia guardada en este navegador (sin parpadeo) y luego la vigente de la base. */
    function aplicarSitio(s) {
      const $ = (id) => document.getElementById(id);
      const eb = $("heroEyebrow"), h1 = $("heroTitulo"), sub = $("heroSub"), hero = $("hero"), ban = $("heroBanner");
      if (eb) { eb.textContent = s.eyebrow; eb.hidden = !s.eyebrow; }
      if (h1) h1.innerHTML = Befine.sitio.tituloHTML(s.titulo);       // texto escapado; solo {…} se vuelve destacado
      if (sub) { sub.textContent = s.subtitulo; sub.hidden = !s.subtitulo; }
      if (!ban || !hero) return;
      const grande = s.banner_desktop || s.banner_movil, chico = s.banner_movil || s.banner_desktop;
      if (!grande) { ban.hidden = true; ban.innerHTML = ""; hero.classList.remove("con-banner"); return; }
      const esc = Befine.sitio.esc;
      ban.innerHTML = `<picture>${chico !== grande ? `<source media="(max-width: 720px)" srcset="${esc(chico)}">` : ""}` +
        `<img src="${esc(grande)}" alt="${esc(s.banner_alt)}" decoding="async" fetchpriority="high"></picture><span class="velo"></span>`;
      ban.style.setProperty("--osc", String(s.banner_oscuridad / 100));
      ban.hidden = false; hero.classList.add("con-banner");
    }
    const sitioCache = Befine.getSitioCache();
    if (sitioCache) aplicarSitio(sitioCache);
    Befine.getSitio().then(aplicarSitio);

    /* ---------- PEDIDO RÁPIDO: Recarga 20 L protagonista en el hero ----------
       Variantes (envase), precio (oferta + habitual), Agregar y Comprar ahora,
       y enlace "Ver más detalles" a la página propia del producto. */
    const qbox = document.getElementById("qorder");
    if (qbox) {
      const prod = await Befine.getHero(); // Recarga Bidón 20 L
      const grad = window.catGrad(prod.categoria_slug);
      let vSel = prod.variantes[0];
      const precioHTML = (v) => `${v.precio_comparacion ? `<span class="oferta">Oferta</span> ` : ""}<span class="now">${Befine.clp(v.precio)}</span>${v.precio_comparacion ? ` <s>${Befine.clp(v.precio_comparacion)}</s>` : ""}`;

      qbox.innerHTML = `
        <span class="badge">★ Lo más pedido</span>
        <div class="media" style="--v-grad:${grad}"></div>
        <h3>${prod.nombre}</h3>
        <div class="price" id="qPrice">${precioHTML(vSel)}</div>
        ${prod.aviso ? `<div class="aviso-recarga"><span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/></svg></span>${prod.aviso}</div>` : ""}
        <div class="lbl">1 · Elige tu envase</div>
        <div class="opts" id="qOpts">
          ${prod.variantes.map((v, i) => `<button class="opt ${i === 0 ? "active" : ""}" data-v="${v.id}">${v.nombre}</button>`).join("")}
        </div>
        <div class="lbl">2 · Cantidad</div>
        <div class="stepper"><button id="qMenos" aria-label="Menos">−</button><input id="qCant" value="1" readonly><button id="qMas" aria-label="Más">+</button></div>
        <div class="actions">
          <button class="btn btn-ghost" id="qAdd">Agregar al carrito</button>
          <button class="btn btn-primary" id="qBuy">Comprar ahora</button>
        </div>
        <a class="verdet" href="producto.html?id=${prod.id}">Ver más detalles →</a>`;

      const qPrice = qbox.querySelector("#qPrice");
      const qCant = qbox.querySelector("#qCant");
      qbox.querySelector("#qOpts").addEventListener("click", (e) => {
        const b = e.target.closest(".opt"); if (!b) return;
        qbox.querySelectorAll(".opt").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        vSel = prod.variantes.find((v) => v.id === b.dataset.v);
        qPrice.innerHTML = precioHTML(vSel);
      });
      qbox.querySelector("#qMas").onclick = () => qCant.value = (+qCant.value + 1);
      qbox.querySelector("#qMenos").onclick = () => qCant.value = Math.max(1, +qCant.value - 1);
      const itemDe = () => ({ variante_id: vSel.id, producto_id: prod.id, nombre: prod.nombre, variante: vSel.nombre, precio: vSel.precio, grad });
      qbox.querySelector("#qAdd").onclick = () => { Store.add(itemDe(), +qCant.value); window.toast("Agregado al carrito: " + prod.nombre); };
      qbox.querySelector("#qBuy").onclick = () => { Store.add(itemDe(), +qCant.value); window.openCheckout(); };
    }

    /* ---------- Destacados: carrusel con brillo + parallax de la vasija ---------- */
    const track = document.getElementById("destacados");
    if (track) {
      const items = await Befine.getDestacados();
      track.innerHTML = items.map(productCardHTML).join("");
      // IMPORTANTE: las tarjetas se agregan por JS, así que hay que marcarlas
      // como visibles (si no, la animación de aparición las deja en opacidad 0).
      track.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      // arrastrar para desplazar
      let down = false, sx = 0, ss = 0, moved = 0;
      track.addEventListener("pointerdown", (e) => { down = true; moved = 0; sx = e.clientX; ss = track.scrollLeft; track.classList.remove("dragged"); track.classList.add("grabbing"); });
      track.addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx)); track.scrollLeft = ss - dx; });
      const up = () => { if (!down) return; down = false; track.classList.remove("grabbing"); if (moved > 6) track.classList.add("dragged"); };
      track.addEventListener("pointerup", up); track.addEventListener("pointercancel", up); track.addEventListener("pointerleave", up);
      // parallax de cada vasija según el scroll
      function px() { const mid = track.scrollLeft + track.clientWidth / 2;
        track.querySelectorAll(".card").forEach((c) => { const cc = c.offsetLeft + c.offsetWidth / 2; const off = (cc - mid) / track.clientWidth;
          const v = c.querySelector(".vessel"); if (v) v.style.setProperty("--pv", (off * -18) + "px"); }); }
      track.addEventListener("scroll", () => requestAnimationFrame(px), { passive: true });
      requestAnimationFrame(px);
      // si el arrastre movió el carrusel, no dispares el "comprar" al soltar
      track.addEventListener("click", (e) => { if (track.classList.contains("dragged")) { e.stopPropagation(); e.preventDefault(); track.classList.remove("dragged"); } }, true);
    }

    /* ---------- Reseñas (prueba social) — datos desde Befine.getResenas() ---------- */
    const revSec = document.getElementById("reviews");
    const revGrid = document.getElementById("revGrid");
    const revSummary = document.getElementById("revSummary");
    if (revSec && revGrid && revSummary) {
      const r = await Befine.getResenas();
      const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const stars = (n) => `<span class="stars" style="--fill:${Math.max(0, Math.min(5, n)) / 5 * 100}%" role="img" aria-label="${n} de 5 estrellas"></span>`;
      const safeUrl = (u) => (/^https:\/\//i.test(u || "") ? esc(u) : "");
      if (!r || !(r.items || []).length) {
        revSec.hidden = true;
      } else {
        const todas = safeUrl(r.url_resenas), escribir = safeUrl(r.url_escribir);
        revSummary.innerHTML = `
          <span class="avg">${Number(r.promedio).toFixed(1).replace(".", ",")}</span>
          <div class="avg-side">${stars(r.promedio)}<span class="count">${Number(r.total).toLocaleString("es-CL")} reseñas en Google</span></div>
          <div class="rev-actions">
            ${todas ? `<a class="btn btn-ghost" href="${todas}" target="_blank" rel="noopener">Ver todas</a>` : ""}
            ${escribir ? `<a class="btn btn-primary" href="${escribir}" target="_blank" rel="noopener">★ Escribe tu reseña</a>` : ""}
          </div>`;
        // Orden aleatorio en cada visita (Fisher-Yates): cada reseña aparece una sola vez, sin repetir.
        const items = [...r.items];
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
        revGrid.innerHTML = items.map((it) => {
          const href = safeUrl(it.url) || todas;
          const foto = safeUrl(it.foto);
          const ini = esc((it.autor || "?").trim().charAt(0).toUpperCase());
          return `
          <a class="rev-card" ${href ? `href="${href}" target="_blank" rel="noopener"` : ""} aria-label="Ver reseña de ${esc(it.autor)} en Google">
            ${stars(it.estrellas)}
            <p class="quote">“${esc(it.texto)}”</p>
            <div class="who">
              ${foto ? `<img class="avatar" src="${foto}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true">${ini}</span>`}
              <div><div class="name">${esc(it.autor)}</div><div class="date">${esc(it.fecha)} · Google</div></div>
            </div>
          </a>`;
        }).join("");
        revSec.classList.add("in");
        initRevCarousel();
      }
    }

    /* Carrusel de reseñas: flechas, puntos, deslizar (nativo) y rotación automática. */
    function initRevCarousel() {
      const box = document.getElementById("revCarousel");
      const track = document.getElementById("revGrid");
      const dotsBox = document.getElementById("revDots");
      const cards = [...track.children];
      if (!box || !cards.length) return;
      const step = () => { const c = cards[0].getBoundingClientRect().width; const gap = parseFloat(getComputedStyle(track).columnGap) || 16; return c + gap; };
      const perView = () => Math.max(1, Math.round((track.clientWidth + 16) / step()));
      const maxIdx = () => Math.max(0, cards.length - perView());
      const cur = () => Math.min(maxIdx(), Math.round(track.scrollLeft / step()));
      const go = (i) => { const m = maxIdx(); i = i > m ? 0 : i < 0 ? m : i; track.scrollTo({ left: i * step(), behavior: reduce ? "auto" : "smooth" }); };
      function renderDots() {
        const n = maxIdx() + 1;
        box.classList.toggle("static", n <= 1);
        dotsBox.hidden = n <= 1;
        dotsBox.innerHTML = Array.from({ length: n }, (_, i) => `<button type="button" role="tab" aria-label="Ir a la reseña ${i + 1}"></button>`).join("");
        syncDots();
      }
      function syncDots() { const i = cur(); [...dotsBox.children].forEach((d, k) => { d.classList.toggle("on", k === i); d.setAttribute("aria-selected", String(k === i)); }); }
      box.querySelector(".prev").onclick = () => { go(cur() - 1); restart(); };
      box.querySelector(".next").onclick = () => { go(cur() + 1); restart(); };
      dotsBox.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; go([...dotsBox.children].indexOf(b)); restart(); });
      track.addEventListener("scroll", () => requestAnimationFrame(syncDots), { passive: true });
      let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderDots, 150); });
      // Rotación automática cada 6 s (se pausa al pasar el mouse, tocar o enfocar; no corre con "reducir movimiento").
      let timer = null, paused = false;
      const start = () => { if (reduce || timer) return; timer = setInterval(() => { if (!paused && !document.hidden && maxIdx() > 0) go(cur() + 1); }, 6000); };
      const restart = () => { clearInterval(timer); timer = null; start(); };
      box.addEventListener("pointerenter", () => paused = true);
      box.addEventListener("pointerleave", () => paused = false);
      box.addEventListener("focusin", () => paused = true);
      box.addEventListener("focusout", () => paused = false);
      track.addEventListener("touchstart", () => { paused = true; }, { passive: true });
      track.addEventListener("touchend", () => { setTimeout(() => paused = false, 4000); }, { passive: true });
      renderDots(); start();
    }

  });
})();
