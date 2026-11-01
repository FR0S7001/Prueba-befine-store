/* =====================================================================
   bands.js — Horarios y colores según la hora (paleta desde las fotos)
   ---------------------------------------------------------------------
   4 bandas (sin "Mañana"), colores derivados de las imágenes reales de la
   cordillera de cada momento. El día es luminoso (celeste cielo despejado
   de Santiago #0A84E8, agua/espuma claras); tarde cálida; madrugada/noche
   azul profundo. Cambia el color del agua/acento/veil y el saludo.

   Horarios:
     madrugada 01:00–07:59 · día/mediodía 08:00–17:59 ·
     tarde 18:00–20:59 · noche 21:00–00:59
   ===================================================================== */
(function () {
  const BANDS = {
    madrugada: {
      // Cielo pre-amanecer azul profundo con estrellas
      hi: "Buenas madrugadas", accent: "#A99FE6", soft: "#CFC8F4",
      foam: [222, 218, 246], deep: [20, 18, 44], mid: [60, 54, 112],
      veil: "linear-gradient(180deg,rgba(20,18,44,.9),rgba(9,8,24,.95))",
      nuevo: ["Bienvenido a Befine, disponibles a toda hora.", "Realice su pedido cuando lo necesite.", "Su agua purificada, a un clic de distancia."],
      vuelta: ["Nos alegra tenerlo de vuelta a esta hora.", "Estamos disponibles cuando lo necesite."],
    },
    mediodia: {
      // Día despejado: celeste cielo de Santiago, agua y espuma bien claras
      hi: "Buenos días", accent: "#0A84E8", soft: "#7FC0F5",
      foam: [232, 244, 253], deep: [24, 110, 186], mid: [46, 150, 226],
      veil: "linear-gradient(180deg,rgba(150,205,240,.30),rgba(70,140,200,.55))",
      nuevo: ["Le damos la bienvenida a Befine.", "Manténgase hidratado durante el día.", "Agua purificada con entrega a domicilio."],
      vuelta: ["Nos alegra verlo nuevamente.", "¿Desea repetir su pedido habitual?"],
    },
    tarde: {
      // Atardecer: ámbar/naranjo cálido sobre agua templada
      hi: "Buenas tardes", accent: "#F2A63C", soft: "#FFD98A",
      foam: [255, 238, 214], deep: [40, 26, 30], mid: [120, 70, 80],
      veil: "linear-gradient(180deg,rgba(70,40,26,.66),rgba(24,16,22,.9))",
      nuevo: ["Buenas tardes. Reciba su agua a domicilio.", "Le damos la bienvenida a Befine.", "Reponga su bidón de forma simple y segura."],
      vuelta: ["Nos alegra tenerlo de vuelta.", "Gracias por preferirnos nuevamente."],
    },
    noche: {
      // Noche de luna: azul profundo y sereno
      hi: "Buenas noches", accent: "#4F93C9", soft: "#9FC8E8",
      foam: [210, 228, 246], deep: [7, 18, 40], mid: [24, 66, 110],
      veil: "linear-gradient(180deg,rgba(7,18,40,.86),rgba(3,10,22,.95))",
      nuevo: ["Deje su pedido programado para el día siguiente.", "Gracias por su preferencia. Estamos para servirle.", "Su agua purificada, lista cuando la necesite."],
      vuelta: ["Gracias por visitarnos a esta hora.", "¿Programamos su entrega para mañana?"],
    },
  };

  let override = null;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Horarios definitivos (madrugada 1–7 · día 8–17 · tarde 18–20 · noche 21–0)
  function byHour() {
    const h = new Date().getHours();
    if (h >= 1 && h <= 7) return "madrugada";
    if (h >= 8 && h <= 17) return "mediodia";
    if (h >= 18 && h <= 20) return "tarde";   // incluye 20:00–20:59
    return "noche";                            // 21, 22, 23 y 00
  }
  function current() { return override || byHour(); }

  function apply(key) {
    if (key) override = (key === "auto" ? null : key);
    // En tema CLARO los colores NO cambian por hora: siempre paleta de DÍA (mediodia).
    // Solo en oscuro varían por banda. (El saludo sí sigue la hora real, aparte.)
    var claro = document.body && document.body.classList.contains("tema-claro");
    const b = BANDS[claro ? "mediodia" : current()] || BANDS.noche;
    const r = document.documentElement.style;
    r.setProperty("--accent", b.accent);
    r.setProperty("--accent-soft", b.soft);
    r.setProperty("--veil", b.veil);
    // El agua por banda solo en oscuro; en claro la fija theme.js (aguaClara).
    if (!claro && window.BefineWater && window.BefineWater.setColors)
      window.BefineWater.setColors({ deep: b.deep, mid: b.mid, foam: b.foam });
  }

  function greeting(name) {
    const b = BANDS[current()] || BANDS.noche;
    return { hi: b.hi, msg: name ? pick(b.vuelta) : pick(b.nuevo) };
  }

  window.Bands = { apply, current, greeting, BANDS };
})();
