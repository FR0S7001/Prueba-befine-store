/* =====================================================================
   water.js — Fondo de agua reactivo (base: demo de Carlos) + fix de rendimiento
   ---------------------------------------------------------------------
   Simulación de olas 2D en <canvas> que reacciona al mouse/dedo, salpica al
   hacer clic y tiene movimiento ambiental constante. Los COLORES los define
   bands.js según la hora (paleta Befine) vía BefineWater.setColors().

   FIX DE RENDIMIENTO conservado del refactor anterior:
     1) se detiene si la pestaña se oculta (visibilitychange),
     2) baja resolución en móvil,
     3) respeta prefers-reduced-motion (fondo estático).
   ===================================================================== */
(function () {
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Colores del agua (RGB). bands.js los actualiza con setColors().
  let COLORS = { deep: [8, 40, 96], mid: [30, 110, 210], foam: [225, 238, 255] };
  let GAIN = 1; // intensidad del rizo del mouse (1 = normal; mayor = más marcado)

  let _canvas = null; // referencia para el fallback estático

  function setColors(c) {
    if (c && c.deep && c.mid && c.foam) COLORS = c;
    if (prefersReduce && _canvas) {
      const [dr, dg, db] = COLORS.deep, [mr, mg, mb] = COLORS.mid;
      _canvas.style.background = `linear-gradient(180deg,rgb(${mr},${mg},${mb}),rgb(${dr},${dg},${db}))`;
    }
  }

  function init(opts = {}) {
    const canvas = document.querySelector(opts.selector || "#water");
    if (!canvas) return;
    _canvas = canvas;

    if (prefersReduce) { setColors(COLORS); return; } // sin animación

    const ctx = canvas.getContext("2d", { alpha: false });
    const ambient = opts.ambient !== false;

    let COLS, ROWS, W, H, prev, cur, buf, bufCtx, img;
    let raf = null, running = false, energy = 0, lastInput = 0, ambientTimer = null;
    let active = true; // false en modo ligero: el puntero NO vuelve a despertar el agua (ahorra CPU)
    const DAMPING = 0.958, IDLE_MS = 1200, ENERGY_EPS = 0.6;

    function build() {
      W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
      COLS = W < 680 ? 140 : 190; ROWS = Math.max(70, Math.round(COLS * H / W));
      canvas.width = W; canvas.height = H;
      prev = new Float32Array(COLS * ROWS); cur = new Float32Array(COLS * ROWS);
      buf = document.createElement("canvas"); buf.width = COLS; buf.height = ROWS;
      bufCtx = buf.getContext("2d"); img = bufCtx.createImageData(COLS, ROWS);
      const d = img.data; for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }
    function disturb(x, y, amp, rad) {
      rad = rad || 1;
      const col = Math.floor(x / W * COLS), row = Math.floor(y / H * ROWS);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const c = col + dx, r = row + dy;
        if (c > 0 && c < COLS - 1 && r > 0 && r < ROWS - 1) prev[r * COLS + c] += amp;
      }
      energy += Math.abs(amp); lastInput = performance.now(); wake();
    }
    function stepPhysics() {
      for (let y = 1; y < ROWS - 1; y++) { const o = y * COLS;
        for (let x = 1; x < COLS - 1; x++) { const i = o + x;
          cur[i] = ((prev[i - 1] + prev[i + 1] + prev[i - COLS] + prev[i + COLS]) * 0.5 - cur[i]) * DAMPING; } }
      const t = prev; prev = cur; cur = t; energy *= 0.96;
    }
    function render() {
      const d = img.data, D = COLORS.deep, M = COLORS.mid, Fm = COLORS.foam;
      for (let y = 0; y < ROWS; y++) { const o = y * COLS, vt = y / ROWS, g = (1 - vt) * 0.5;
        for (let x = 0; x < COLS; x++) { const i = o + x; let xd = 0, yd = 0;
          if (x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1) { xd = prev[i - 1] - prev[i + 1]; yd = prev[i - COLS] - prev[i + COLS]; }
          const s = (xd * 0.85 + yd * 0.5 + prev[i] * 0.12) * GAIN;
          let r = D[0] + (M[0] - D[0]) * g + s * 20, gr = D[1] + (M[1] - D[1]) * g + s * 27, b = D[2] + (M[2] - D[2]) * g + s * 31;
          const sp = s - 1.25; if (sp > 0) { const k = Math.min(1, sp * 0.32); r += (Fm[0] - r) * k; gr += (Fm[1] - gr) * k; b += (Fm[2] - b) * k; }
          const p = i * 4;
          d[p] = r < 0 ? 0 : r > 255 ? 255 : r; d[p + 1] = gr < 0 ? 0 : gr > 255 ? 255 : gr; d[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b; } }
      bufCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(buf, 0, 0, COLS, ROWS, 0, 0, W, H);
    }
    function loop() {
      stepPhysics(); render();
      const quieto = energy < ENERGY_EPS && (performance.now() - lastInput) > IDLE_MS;
      if (quieto && !ambient) { running = false; raf = null; return; }
      raf = requestAnimationFrame(loop);
    }
    function wake() { if (active && !running && document.visibilityState === "visible") { running = true; raf = requestAnimationFrame(loop); } }
    function sleep() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; } }
    function ambientPulse() {
      if (document.visibilityState === "visible") disturb(Math.random() * W, Math.random() * H * 0.92, W < 680 ? 1.1 : 1.5, 1);
      ambientTimer = setTimeout(ambientPulse, (W < 680 ? 2200 : 1500) + Math.random() * 1600);
    }

    let lastPos = null;
    window.addEventListener("pointermove", (e) => {
      const x = e.clientX, y = e.clientY;
      if (x < 0 || y < 0 || x > W || y > H) { lastPos = null; return; }
      if (lastPos) { const n = Math.max(1, Math.floor(Math.hypot(x - lastPos.x, y - lastPos.y) / 6));
        for (let k = 1; k <= n; k++) disturb(lastPos.x + (x - lastPos.x) * k / n, lastPos.y + (y - lastPos.y) * k / n, 1.05);
      } else disturb(x, y, 1.3);
      lastPos = { x, y };
    }, { passive: true });
    window.addEventListener("pointerdown", (e) => { lastPos = null; disturb(e.clientX, e.clientY, 4.2, 2); }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") sleep();
      else { if (ambient && !ambientTimer) ambientPulse(); wake(); }
    });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { sleep(); build(); disturb(W * 0.5, H * 0.5, 3, 2); if (ambient) ambientPulse(); wake(); }, 200); });

    build(); disturb(W * 0.5, H * 0.5, 4, 2); if (ambient) ambientPulse(); wake();

    // Controles públicos para encender/apagar desde el botón del hero
    window.BefineWater.pause = () => { active = false; sleep(); };
    window.BefineWater.resume = () => { active = true; if (ambient && !ambientTimer) ambientPulse(); wake(); };
  }

  function setRipple(g) { GAIN = (typeof g === "number" && g > 0) ? g : 1; }

  window.BefineWater = { init, setColors, setRipple };
})();
