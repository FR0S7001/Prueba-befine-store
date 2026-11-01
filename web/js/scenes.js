/* =====================================================================
   scenes.js — (1) Cordillera por horario SOLO en el recibimiento (loader)
                (2) Fondo de la web = fotos de "situaciones Befine" rotando
   ---------------------------------------------------------------------
   (1) La pantalla de bienvenida (loader del inicio) usa como fondo la
       cordillera de la banda horaria actual (madrugada/día/tarde/noche),
       oscurecida para que el logo y el saludo se lean.
   (2) El fondo de todas las páginas rota entre fotos de uso real (familia,
       oficina…) cada 6 s con fundido, RESPONSIVE: usa las de escritorio en
       pantallas anchas y las de móvil en angostas. Se apaga en modo ligero
       (body.fx-off) y respeta reduce-motion.
   Para sumar más escenas: agrégalas a FONDO.desktop / FONDO.movil.
   ===================================================================== */
(function () {
  /* ---------- Banda horaria (igual que bands.js) ---------- */
  function banda() {
    var h = new Date().getHours();
    if (h >= 1 && h <= 7) return "madrugada";
    if (h >= 8 && h <= 17) return "mediodia";
    if (h >= 18 && h <= 20) return "tarde";
    return "noche";
  }
  var CORD = {
    madrugada: "assets/escena-madrugada.webp",
    mediodia:  "assets/escena-mediodia.webp",
    tarde:     "assets/escena-tarde.webp",
    noche:     "assets/escena-noche.webp"
  };

  /* ---------- (1) Cordillera en el recibimiento (solo hay loader en el inicio) ---------- */
  var loader = document.getElementById("loader");
  if (loader) {
    loader.style.backgroundImage =
      'linear-gradient(180deg, rgba(6,18,32,.5), rgba(3,10,20,.82)), url("' + CORD[banda()] + '")';
    loader.style.backgroundSize = "cover";
    loader.style.backgroundPosition = "center";
  }

  /* ---------- (2) Fondo de la web: fotos rotando (responsive) ---------- */
  var FONDO = {
    desktop: ["assets/fondo-familia-desktop.webp", "assets/fondo-oficina-desktop.webp"],
    movil:   ["assets/fondo-familia-movil.webp",   "assets/fondo-oficina-movil.webp"]
  };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mqMovil = window.matchMedia("(max-width: 720px)");
  function setActual() { return mqMovil.matches ? FONDO.movil : FONDO.desktop; }

  var layer = document.createElement("div");
  layer.className = "scenes-bg"; layer.setAttribute("aria-hidden", "true");
  var a = document.createElement("div"); a.className = "scene";
  var b = document.createElement("div"); b.className = "scene";
  layer.appendChild(a); layer.appendChild(b);
  var canvas = document.getElementById("water");
  if (canvas && canvas.parentNode) canvas.insertAdjacentElement("afterend", layer);
  else document.body.insertBefore(layer, document.body.firstChild);

  function setBg(el, src) { el.style.backgroundImage = 'url("' + src + '")'; }

  var lista = setActual(), i = 0, front = a;
  setBg(a, lista[0]); a.classList.add("show");

  // Al cambiar tamaño/orientación: cambia de set (escritorio/móvil) y refresca la imagen actual
  var onChange = function () { lista = setActual(); i = i % lista.length; setBg(front, lista[i]); };
  if (mqMovil.addEventListener) mqMovil.addEventListener("change", onChange);
  else if (mqMovil.addListener) mqMovil.addListener(onChange);

  if (reduce) return;
  setInterval(function () {
    if (document.hidden) return;
    if (document.body.classList.contains("fx-off")) return; // modo ligero
    lista = setActual();
    if (lista.length < 2) return;
    i = (i + 1) % lista.length;
    var next = (front === a) ? b : a;
    setBg(next, lista[i]);
    next.classList.add("show"); front.classList.remove("show"); front = next;
  }, 6000);
})();
