/* =====================================================================
   transitions.js — Transición entre páginas: INMERSIÓN (sin dependencias)
   ---------------------------------------------------------------------
   Al hacer clic en un enlace interno, la vista se "sumerge" (la anima el
   CSS: body.is-leaving) y luego navega. Al cargar la nueva página, el CSS
   la hace "emerger". Inyecta el velo azul y arregla el gesto/boton ATRÁS
   (bfcache) para que también emerja y no quede a medio sumergir.
   Funciona en file:// y en http por igual. No usa APIs especiales.
   ===================================================================== */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Velo azul de inmersión (una sola capa, compartida)
  var veil = document.createElement("div");
  veil.className = "dip-veil";
  veil.setAttribute("aria-hidden", "true");
  document.body.appendChild(veil);

  // SALIR: sumergirse antes de navegar
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (document.body.classList.contains("lite")) return; // modo ligero: navegación directa
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      try { if (new URL(a.href).origin !== location.origin) return; } catch (err) { return; }
    }
    e.preventDefault();
    document.body.classList.add("is-leaving");
    setTimeout(function () { location.href = a.href; }, 400);
  });

  // VOLVER ATRÁS / ADELANTE: limpiar estado y re-lanzar el "emerger"
  window.addEventListener("pageshow", function (e) {
    document.body.classList.remove("is-leaving");
    if (e.persisted) { // restaurado desde bfcache: las animaciones de carga no corren solas
      var app = document.querySelector(".app");
      [app, veil].forEach(function (el) {
        if (!el) return;
        el.style.animation = "none";
        void el.offsetWidth;   // forzar reflow
        el.style.animation = "";
      });
    }
  });
})();
