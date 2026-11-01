/* =====================================================================
   shell.js — Cascarón COMPARTIDO: navbar + footer en un solo lugar
   ---------------------------------------------------------------------
   En vez de repetir el <header> y el <footer> en cada página, cada HTML
   solo pone dos marcadores:
       <div id="app-header"></div>   y   <div id="app-footer"></div>
   Este archivo los reemplaza por el navbar y el footer reales. Así hay
   UN solo formato para todas las páginas (no se replica código).
   Se carga ANTES que ui.js/fx.js para que encuentren la barra ya puesta.
   ===================================================================== */
(function () {
  // Página actual (para marcar el enlace activo del menú)
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const NAV = [
    ["index.html", "Inicio"],
    ["catalogo.html", "Catálogo"],
    ["index.html#como", "Cómo funciona"],
  ];
  const isActive = (href) => !href.includes("#") && href === page ? ' aria-current="page"' : ""; // los anclas (#como) no se marcan

  /* Submenú del Catálogo: cada opción abre el catálogo ya filtrado (?cat=slug).
     Los slugs son los de la tabla `categorias` de Supabase. */
  const ICO = {
    gota: '<path d="M12 2.7s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z"/>',
    dispensador: '<path d="M9 2h6v5H9z"/><rect x="6" y="9" width="12" height="13" rx="2"/><path d="M10 13h4M12 13v3"/>',
    pack: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    bidon: '<path d="M10 2h4v3h-4z"/><path d="M8 5h8l1 3v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8z"/><path d="M7 12h10"/>',
  };
  const CAT_MENU = [
    ["recargas", "Recargas", "gota"],
    ["dispensadores", "Dispensadores", "dispensador"],
    ["packs", "Packs", "pack"],
    ["bidones", "Envase y recarga", "bidon"],
  ];
  const catActual = page === "catalogo.html" ? new URLSearchParams(location.search).get("cat") : null;
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;
  const SUBMENU = `
        <div class="submenu" role="menu" aria-label="Categorías del catálogo">
          ${CAT_MENU.map(([slug, t, ic]) => `<a role="menuitem" href="catalogo.html?cat=${slug}"${slug === catActual ? ' aria-current="true"' : ""}><span class="si" aria-hidden="true">${svg(ic)}</span>${t}</a>`).join("")}
        </div>`;
  const navLink = ([h, t]) => h === "catalogo.html"
    ? `<div class="nav-item has-sub"><a href="${h}"${isActive(h)}>${t}</a><button class="sub-toggle" type="button" aria-expanded="false" aria-label="Ver categorías"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${SUBMENU}</div>`
    : `<a href="${h}"${isActive(h)}>${t}</a>`;

  const HEADER = `
  <header class="topbar" id="topbar">
    <div class="wrap row">
      <a class="brand" href="index.html"><img src="assets/logo-befine.png" alt="Befine"></a>
      <nav class="nav">
        ${NAV.map(navLink).join("")}
        <a class="nav-cuenta" href="cuenta.html"${isActive("cuenta.html")}>Mi cuenta · Ingresar</a>
      </nav>
      <span class="spacer"></span>
      <form class="search" action="catalogo.html" method="get" role="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" name="q" placeholder="Buscar…" aria-label="Buscar">
      </form>
      <a class="acct-btn" href="cuenta.html" aria-label="Mi cuenta" title="Mi cuenta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
        <span class="acct-ini" hidden></span>
      </a>
      <button class="cart-btn" aria-label="Ver carrito">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
        <span class="cart-count">0</span>
      </button>
      <button class="menu-btn" aria-label="Menú">☰</button>
    </div>
  </header>`;

  const FOOTER = `
  <footer class="site">
    <div class="wrap cols">
      <div><h5>Befine</h5><p class="muted" style="max-width:26ch" data-sitio="pie">Agua purificada a domicilio en el sector norte de Santiago. 5 años de operación.</p></div>
      <div><h5>Tienda</h5><a href="catalogo.html?cat=recargas">Recargas</a><a href="catalogo.html?cat=bidones">Envase y recarga</a><a href="catalogo.html?cat=dispensadores">Dispensadores</a><a href="catalogo.html?cat=packs">Packs</a></div>
      <div><h5>Contacto</h5><a href="#">WhatsApp</a><a href="#">Cobertura de zonas</a><a href="#">Preguntas frecuentes</a></div>
    </div>
    <div class="wrap legal">Befine Store · Maqueta de experiencia (datos y colores de demostración).</div>
  </footer>`;

  const h = document.getElementById("app-header"); if (h) h.outerHTML = HEADER;
  const f = document.getElementById("app-footer"); if (f) f.outerHTML = FOOTER;
  // Eslogan del pie: editable desde el panel (Banner y eslogan). Se pinta primero la última copia guardada y luego la vigente.
  if (window.Befine && Befine.getSitio) {
    const c0 = Befine.getSitioCache(); if (c0) Befine.aplicarSitioPie(c0);
    Befine.getSitio().then((s) => Befine.aplicarSitioPie(s));
  }

  // Cuenta: si hay sesión, el ícono muestra la inicial del cliente y el menú dice "Mi cuenta"
  async function pintarCuenta() {
    if (!window.Befine || !Befine.auth) return;
    const s = await Befine.auth.sesion();
    document.querySelectorAll(".acct-btn").forEach((a) => {
      const ini = a.querySelector(".acct-ini");
      a.classList.toggle("logged", !!s);
      if (ini) { ini.hidden = !s; ini.textContent = s ? (s.nombre || "?")[0].toUpperCase() : ""; }
      a.setAttribute("aria-label", s ? "Mi cuenta (" + s.nombre + ")" : "Ingresar o crear cuenta");
    });
    document.querySelectorAll(".nav-cuenta").forEach((a) => { a.textContent = s ? "Mi cuenta · " + (s.nombre || "").split(" ")[0] : "Ingresar · Crear cuenta"; });
  }
  pintarCuenta();
  if (window.Befine && Befine.auth) Befine.auth.onCambio(() => pintarCuenta());

  // Submenú: la flecha lo abre/cierra (PC, celular y teclado). En PC también abre al pasar el mouse (CSS);
  // si lo cierras con la flecha estando encima, la clase .closed anula el hover hasta que saques el mouse.
  document.querySelectorAll(".has-sub").forEach((it) => {
    const b = it.querySelector(".sub-toggle"), sub = it.querySelector(".submenu");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const visible = getComputedStyle(sub).visibility === "visible" && getComputedStyle(sub).display !== "none";
      it.classList.toggle("open", !visible);
      it.classList.toggle("closed", visible);
      b.setAttribute("aria-expanded", String(!visible));
    });
    it.addEventListener("mouseleave", () => it.classList.remove("closed"));
  });
  const cerrar = () => document.querySelectorAll(".has-sub.open").forEach((it) => { it.classList.remove("open"); it.querySelector(".sub-toggle").setAttribute("aria-expanded", "false"); if (document.activeElement && it.contains(document.activeElement)) document.activeElement.blur(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".has-sub")) cerrar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrar(); cerrarMenuMovil(); } });

  // Cierra todo (submenú y menú del celular) apenas hay scroll o el mouse sale de la barra.
  const cerrarMenuMovil = () => { const nav = document.querySelector(".nav"); if (nav && nav.style.display === "flex") nav.style.display = ""; };
  const cerrarTodo = () => {
    document.querySelectorAll(".has-sub").forEach((it) => { if (it.matches(":hover")) it.classList.add("closed"); }); // si el mouse está encima, anula el hover hasta que salga
    cerrar(); cerrarMenuMovil();
  };
  window.addEventListener("scroll", cerrarTodo, { passive: true });
  const bar = document.getElementById("topbar");
  if (bar) bar.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { cerrar(); document.querySelectorAll(".has-sub").forEach((it) => it.classList.remove("closed")); } });
  // Tocar/clic fuera de la barra cierra el menú del celular
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".topbar")) { cerrar(); cerrarMenuMovil(); } });
  // El selector de horario del footer lo maneja fx.js (compartido en todas las páginas).
})();
