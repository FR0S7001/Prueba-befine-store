/* =====================================================================
   perf.js — "Modo ligero" automático + botón único (esquina inf. izq.)
   ---------------------------------------------------------------------
   - Detecta la capacidad del equipo (memoria, núcleos, ahorro de datos,
     reduce-motion) y mide los FPS reales al cargar. Si el equipo va lento
     (típico celular básico), entra en MODO LIGERO: sin agua, sin efectos,
     sin sonido y sin transición de inmersión. La tienda funciona igual.
   - Reutiliza el botón de la esquina inferior izquierda como ÚNICO control:
     quita/activa animaciones + sonido a la vez.
   - Muestra un mensajito la primera vez: "si va lento, usa este botón".
   No detecta el "modelo" del celular (los navegadores no lo exponen de
   forma confiable): mide la experiencia real, que es más certero.
   ===================================================================== */
(function () {
  var LITE_KEY = "befine_lite", HINT_KEY = "befine_hint_seen";
  function getPref(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function setP(k,v){ try { localStorage.setItem(k,v); } catch(e){} }

  var ICON_FULL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/></svg>';
  var ICON_LITE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3.5 3.5l17 17"/></svg>';

  function autoLite(){
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    var m = navigator.deviceMemory, c = navigator.hardwareConcurrency, n = navigator.connection;
    if (m && m <= 3) return true;                      // poca RAM
    if (c && c <= 4 && m && m <= 4) return true;        // pocos núcleos + poca RAM
    if (n && (n.saveData || /2g/.test(n.effectiveType || ""))) return true; // red lenta/ahorro
    return false;
  }
  function measureFPS(cb){
    var f = 0, start = performance.now();
    function tick(now){ f++; if (now - start < 1200) requestAnimationFrame(tick); else cb(f / ((now - start) / 1000)); }
    requestAnimationFrame(tick);
  }

  document.addEventListener("DOMContentLoaded", function(){
    var btn = document.getElementById("soundBtn");
    var lite = false;
    var explicit = getPref(LITE_KEY); // "on" | "off" | null

    function apply(on, persist){
      lite = on;
      document.body.classList.toggle("lite", on);
      if (window.BefineFx) window.BefineFx.set(!on, false);          // animaciones
      if (window.BefineSound) window.BefineSound.setEnabled(!on, false); // sonido
      if (btn){
        btn.classList.toggle("lite-on", on);
        btn.innerHTML = on ? ICON_LITE : ICON_FULL;
        var lbl = on ? "Activar animaciones y sonido" : "Quitar animaciones y sonido (mejor fluidez)";
        btn.setAttribute("aria-label", lbl); btn.setAttribute("title", lbl);
      }
      if (persist) setP(LITE_KEY, on ? "on" : "off");
    }

    // Estado inicial. El mensajito se muestra SOLO si el sitio entra con
    // efectos (con animaciones/sonido); en modo ligero no aparece.
    if (explicit === "on" || explicit === "off"){
      apply(explicit === "on", false);                 // el usuario ya eligió: se respeta
      if (!lite) showTipOnce(btn);
    } else {
      apply(autoLite(), false);                        // decisión por capacidades
      if (!lite) {
        measureFPS(function(fps){                       // afinar con FPS reales
          if (fps < 45 && getPref(LITE_KEY) === null) apply(true, false);
          if (!lite) showTipOnce(btn);                  // quedó en modo completo
        });
      }
      // si entró ligero por capacidades, no se muestra el mensajito
    }

    // Botón único: alterna y RECUERDA la elección del usuario
    if (btn) btn.addEventListener("click", function(){ apply(!lite, true); hideTip(); });
  });

  var tipEl = null;
  function showTipOnce(btn){
    if (!btn) return;
    if (getPref("befine_hint_seen")) return;
    tipEl = document.createElement("div");
    tipEl.className = "lite-tip";
    tipEl.innerHTML = "¿Se ve lento en tu celular? Toca aquí para quitar animaciones y sonido.";
    document.body.appendChild(tipEl);
    setTimeout(function(){ if (tipEl) tipEl.classList.add("show"); }, 1400);
    setTimeout(hideTip, 9000);
    tipEl.addEventListener("click", function(){ btn.click(); });
  }
  function hideTip(){
    if (!tipEl) return;
    tipEl.classList.remove("show");
    setP("befine_hint_seen", "1");
    var t = tipEl; tipEl = null;
    setTimeout(function(){ if (t) t.remove(); }, 400);
  }
})();
