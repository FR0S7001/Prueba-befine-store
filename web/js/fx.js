/* =====================================================================
   fx.js — Efectos compartidos por TODAS las páginas (inicio, catálogo, ficha)
   Agua reactiva + color por banda horaria + burbujas + cursor + sonido
   (plip/ambiente/bajo el agua) + oscurecer al bajar. Cada efecto solo se
   activa si su elemento existe en la página. La página de inicio (home.js)
   ya NO los duplica: los toma de aquí.
   ===================================================================== */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover:hover) and (pointer:fine)").matches;

  /* Preferencias persistentes (sonido / animación), compartidas entre páginas */
  function _pref(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch (e) { return d; } }
  function _setPref(k, on) { try { localStorage.setItem(k, on ? "1" : "0"); } catch (e) {} }

  document.addEventListener("DOMContentLoaded", () => {

    /* ---------- Agua + banda horaria ---------- */
    if (document.getElementById("water") && window.BefineWater)
      window.BefineWater.init({ selector: "#water", ambient: true });
    if (window.Bands) window.Bands.apply();

    /* ---------- Animación on/off (persistente entre páginas) ----------
       Lee la preferencia guardada y la aplica en TODAS las páginas. El botón
       "Apagar animación" (solo en el inicio) usa window.BefineFx.set(). */
    (function () {
      let fxOn = _pref("befine_fx", true);
      function applyFxState() {
        document.body.classList.toggle("fx-off", !fxOn);
        if (window.BefineWater) {
          if (fxOn) { if (BefineWater.resume) BefineWater.resume(); }
          else { if (BefineWater.pause) BefineWater.pause(); }
        }
        if (fine && !reduce) document.documentElement.style.cursor = fxOn ? "none" : "";
      }
      window.BefineFx = { isOn: () => fxOn, set(on, persist) { fxOn = on; if (persist !== false) _setPref("befine_fx", on); applyFxState(); } };
      applyFxState();
    })();

    /* ---------- Burbujas de fondo ---------- */
    (function () {
      const box = document.getElementById("bubbles");
      if (!box || reduce) return;
      const N = window.innerWidth < 680 ? 5 : 8;
      for (let i = 0; i < N; i++) {
        const b = document.createElement("i");
        const sz = 6 + Math.random() * 20;
        b.style.width = b.style.height = sz + "px";
        b.style.left = (Math.random() * 100) + "%";
        b.style.animationDuration = (14 + Math.random() * 16) + "s";
        b.style.animationDelay = (-Math.random() * 20) + "s";
        box.appendChild(b);
      }
    })();

    /* ---------- Cursor personalizado ---------- */
    (function () {
      const dot = document.getElementById("curDot"), ring = document.getElementById("curRing");
      if (!dot || !ring || !fine || reduce) return;
      if (window.BefineFx && !window.BefineFx.isOn()) return; // animación apagada: cursor normal
      document.documentElement.style.cursor = "none";
      let rx = 0, ry = 0, tx = 0, ty = 0;
      window.addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY;
        dot.style.transform = `translate(${tx}px,${ty}px) translate(-50%,-50%)`; }, { passive: true });
      (function follow() { rx += (tx - rx) * .18; ry += (ty - ry) * .18;
        ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`; requestAnimationFrame(follow); })();
      document.addEventListener("pointerover", (e) => { if (e.target.closest("button,a,.card,input,.float,.opt")) ring.classList.add("big"); });
      document.addEventListener("pointerout", (e) => { if (e.target.closest("button,a,.card,input,.float,.opt")) ring.classList.remove("big"); });
    })();

    /* ---------- Sonido: "plip" al tocar + MÚSICA AMBIENTAL relajada ----------
       La música es un "pad" generado con Web Audio (sin archivos externos),
       tipo unseen. Empieza en el primer clic del usuario (regla de autoplay).
       Expone window.BefineSound para que el botón "apagar animación" también
       pueda silenciar todo. */
    (function () {
      let actx = null, soundOn = _pref("befine_sound", true), ambient = null, started = false;
      let uwFilter = null, ambDepth = null, submerged = false; // efecto "bajo el agua"
      const AMB_VOL = 0.08; // volumen de la música (súbelo/bájalo aquí)
      const ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M18.6 6.4a7 7 0 0 1 0 11.2"/></svg>';
      const OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9.5l4.5 5M21.5 9.5l-4.5 5"/></svg>';
      // El botón inferior izquierdo ahora es el "modo ligero" (js/perf.js). Aquí solo vive el motor de audio (window.BefineSound).
      function ctx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === "suspended") actx.resume(); return actx; }

      // Gotita de agua al tocar
      function plip(v) { if (!soundOn) return; const a = ctx(); if (!a) return; const t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain(); const f0 = 540 + Math.random() * 280;
        o.type = "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.34, t + 0.09);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.14, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
        o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.2); }

      // Construye el pad ambiental (acorde suave + filtro que "respira")
      function buildAmbient(a) {
        const master = a.createGain(); master.gain.value = 0;
        // Cadena "bajo el agua": master -> filtro (se cierra al bajar) -> volumen -> salida
        uwFilter = a.createBiquadFilter(); uwFilter.type = "lowpass"; uwFilter.frequency.value = 20000; uwFilter.Q.value = 0.7;
        ambDepth = a.createGain(); ambDepth.gain.value = 1;
        master.connect(uwFilter); uwFilter.connect(ambDepth); ambDepth.connect(a.destination);
        const filt = a.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 850; filt.Q.value = 0.4; filt.connect(master);
        // Acorde cálido y consonante (Do mayor, voicing abierto y grave) — más relajado
        const freqs = [130.81, 196.00, 261.63, 392.00]; // C3, G3, C4, G4
        freqs.forEach((f, i) => {
          const o = a.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = (i - 1) * 2;
          const g = a.createGain(); g.gain.value = 0.10 / (1 + i * 0.35); o.connect(g).connect(filt); o.start();
          const lfo = a.createOscillator(); lfo.frequency.value = 0.018 + 0.01 * i; const lg = a.createGain(); lg.gain.value = 0.035;
          lfo.connect(lg).connect(g.gain); lfo.start(); // swell muy lento por voz
        });
        const flfo = a.createOscillator(); flfo.frequency.value = 0.022; const fg = a.createGain(); fg.gain.value = 220;
        flfo.connect(fg).connect(filt.frequency); flfo.start(); // brillo que respira, sutil
        return master;
      }
      function fadeAmbient(on) { const a = ctx(); if (!a) return; if (!ambient) ambient = buildAmbient(a);
        const t = a.currentTime; ambient.gain.cancelScheduledValues(t);
        ambient.gain.linearRampToValueAtTime(on ? AMB_VOL : 0, t + (on ? 2.5 : 1.2)); }

      // Campanitas suaves en escala pentatónica: "gotas" musicales de agua limpia.
      // Aparecen espaciadas y al azar; van al mismo bus que la música (se apagan/
      // amortiguan con ella). Cambia SCALE o los tiempos para otro carácter.
      const SCALE = [392.00, 440.00, 523.25, 587.33, 659.25]; // pentatónica más grave y dulce
      let chimeTimer = null;
      function chime() {
        const a = ctx(); if (!a || !ambient) return; const t = a.currentTime;
        const base = SCALE[Math.floor(Math.random() * SCALE.length)] * (Math.random() < 0.5 ? 0.5 : 1);
        [1, 2].forEach((mult, k) => { // fundamental + octava = timbre de campana/gota
          const o = a.createOscillator(), g = a.createGain(); o.type = "sine"; o.frequency.value = base * mult;
          const vol = (k === 0 ? 0.4 : 0.13) * (0.7 + Math.random() * 0.3);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8 + Math.random() * 1.2);
          o.connect(g).connect(ambient); o.start(t); o.stop(t + 3.4);
        });
      }
      function scheduleChime() {
        clearTimeout(chimeTimer);
        chimeTimer = setTimeout(() => {
          if (soundOn && started && document.visibilityState === "visible") chime();
          scheduleChime();
        }, 4800 + Math.random() * 6000); // cada ~4.8–10.8 s (más espaciado y relajado)
      }

      // Sumergirse: un "whoomp" grave, suave y breve. Relajante, no molesto.
      function submerge() {
        if (!soundOn) return; const a = ctx(); if (!a) return; const t = a.currentTime, dur = 1.1;
        const o = a.createOscillator(), g = a.createGain(); o.type = "sine";
        o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(80, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
      }

      // Profundidad 0..1: amortigua la música (pasa-bajos) y baja un poco el
      // volumen, como estar bajo el agua. Lo llama el scroll (js/home.js).
      function setDepth(t) {
        t = Math.min(Math.max(t, 0), 1);
        // (sin sonido al bajar; la música solo se amortigua como "bajo el agua")
        const a = ctx(); if (!a || !uwFilter) return; const now = a.currentTime;
        // la música se amortigua (pasa-bajos) y baja de volumen = sensación bajo el agua
        const cut = 420 * Math.pow(42, 1 - t);          // ~17600 Hz en superficie → 420 Hz profundo
        uwFilter.frequency.setTargetAtTime(cut, now, 0.2);
        ambDepth.gain.setTargetAtTime(1 - 0.6 * t, now, 0.2);
      }

      // La música arranca en el primer gesto (autoplay bloquea antes de eso)
      function firstGesture() { if (started) return; started = true; if (soundOn) fadeAmbient(true); scheduleChime(); }
      window.addEventListener("pointerdown", () => { firstGesture(); plip(0.14); }, { passive: true });

      function setSound(on, persist) {
        soundOn = on; if (persist !== false) _setPref("befine_sound", on);
        if (started) fadeAmbient(on);
        if (on) plip(0.14);
      }
      window.BefineSound = { setEnabled: setSound, isOn: () => soundOn, setDepth: setDepth };
    })();


    /* ---------- Navbar: se oculta al bajar y reaparece AL INSTANTE al subir ----------
       Patrón robusto: rAF + umbral anti-jitter. Aparece ante cualquier gesto
       hacia arriba y cerca del tope; se oculta solo al bajar pasado HIDE_AFTER. */
    (function () {
      const bar = document.querySelector(".topbar");
      if (!bar) return;
      const HIDE_AFTER = 120, DELTA = 5;
      let lastY = Math.max(0, window.scrollY), ticking = false;
      function onScroll() {
        const y = Math.max(0, window.scrollY), diff = y - lastY;
        if (y < HIDE_AFTER || diff < -DELTA) bar.classList.remove("nav-hidden");
        else if (diff > DELTA) bar.classList.add("nav-hidden");
        if (Math.abs(diff) > DELTA) lastY = y;
        ticking = false;
      }
      window.addEventListener("scroll", () => {
        if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
      }, { passive: true });
    })();

    /* ---------- Descenso: oscurecer al bajar (efecto "hundirse") ----------
       Cuanto más scroll, más opaca la capa #depth (de 0 en la superficie a
       ~0.82 en lo profundo). Ajusta 'max' y el 0.82 para más/menos oscuridad. */
    const depth = document.getElementById("depth");
    if (depth) {
      const onScroll = () => {
        const max = window.innerHeight * 1.4;              // a qué profundidad llega al máximo
        const t = Math.min(window.scrollY / max, 1);       // 0 superficie → 1 profundo
        depth.style.opacity = (t * 0.82).toFixed(3);       // oscurecer visual
        if (window.BefineSound && window.BefineSound.setDepth) window.BefineSound.setDepth(t); // amortiguar audio
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }


  });
})();
