/* =====================================================================
   theme.js — Tema CLARO por defecto (24h) / OSCURO opcional (colores por hora)
   ---------------------------------------------------------------------
   - Arranca en claro para todos; recuerda la elección del usuario.
   - Toggle sol/luna junto al botón inferior izquierdo (modo ligero).
   - En oscuro, los colores del agua van por banda horaria (bands.js).
   - En claro, agua celeste marcada (aguaClara).
   - De noche, si sigue en claro y no eligió, un aviso breve SEÑALA el botón.
   El logo cambia por tema (swapLogo): claro = logo celeste (logo-befine.png);
   oscuro = logo blanco (logo-befine-noche.png). Aplica a la barra y al loader.
   ===================================================================== */
(function () {
  var KEY = "befine_tema", HINT = "befine_tema_hint";
  function get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function setP(k,v){ try { localStorage.setItem(k,v); } catch(e){} }

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  var claro = true, btn = null;

  // Logo por tema: claro = logo celeste actual; oscuro = logo blanco.
  var LOGO = { claro: "assets/logo-befine.png", oscuro: "assets/logo-befine-noche.png" };
  function swapLogo(){
    var src = claro ? LOGO.claro : LOGO.oscuro;
    var logos = document.querySelectorAll(".brand img, .l-logo");
    for (var i=0;i<logos.length;i++){ if (logos[i].getAttribute("src") !== src) logos[i].src = src; }
  }

  function aguaClara(){
    if (window.Bands) window.Bands.apply();   // en claro fija la paleta de DÍA (no cambia por hora)
    if (window.BefineWater){
      if (window.BefineWater.setColors) window.BefineWater.setColors({ deep:[224,238,248], mid:[238,247,253], foam:[255,255,255] });
      if (window.BefineWater.setRipple) window.BefineWater.setRipple(2.4);
    }
  }
  function aguaBanda(){
    if (window.Bands) window.Bands.apply();
    if (window.BefineWater && window.BefineWater.setRipple) window.BefineWater.setRipple(1);
  }
  function paint(){
    if (!btn) return;
    btn.innerHTML = claro ? MOON : SUN;               // en claro ofrece pasar a oscuro (luna)
    var lbl = claro ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
    btn.setAttribute("aria-label", lbl); btn.setAttribute("title", lbl);
  }
  function apply(c, persist){
    claro = c;
    document.body.classList.toggle("tema-claro", c);
    if (c) aguaClara(); else aguaBanda();
    swapLogo();
    paint();
    if (persist) setP(KEY, c ? "claro" : "oscuro");
  }

  window.BefineTheme = { isClaro: function(){ return claro; }, aguaClara: aguaClara, set: function(c){ apply(c, true); } };

  document.addEventListener("DOMContentLoaded", function(){
    btn = document.createElement("button");
    btn.className = "theme-btn";
    document.body.appendChild(btn);

    var saved = get(KEY);
    apply(saved ? (saved === "claro") : true, false);   // por defecto: claro 24h
    btn.addEventListener("click", function(){ apply(!claro, true); hideHint(); });

    // Aviso de noche que apunta al botón (solo si sigue claro, no eligió y no lo descartó)
    var h = new Date().getHours();
    var esNoche = (h >= 21 || h <= 7);
    if (claro && esNoche && !saved && !get(HINT)) showHint();
  });

  var hintEl = null;
  function showHint(){
    hintEl = document.createElement("div");
    hintEl.className = "theme-hint";
    hintEl.innerHTML = '¿De noche? Prueba el <b>modo oscuro</b> →';
    document.body.appendChild(hintEl);
    setTimeout(function(){ if (hintEl) hintEl.classList.add("show"); }, 1600);
    setTimeout(hideHint, 12000);
    hintEl.addEventListener("click", function(){ if (btn) btn.click(); });
  }
  function hideHint(){
    setP(HINT, "1");
    if (!hintEl) return;
    hintEl.classList.remove("show");
    var t = hintEl; hintEl = null;
    setTimeout(function(){ if (t) t.remove(); }, 350);
  }
})();
