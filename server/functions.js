/* =====================================================================
   functions.js — Reemplazo LOCAL de las Edge Functions de Supabase
   ---------------------------------------------------------------------
   - resenas-google : reseñas de EJEMPLO (no llama a Google).
   - crear-pago     : en vez de Mercado Pago, devuelve el enlace a la página
                      de pago simulado (pago-simulado.html).
   - pago-simulado  : "aprueba", "rechaza" o deja "pendiente" el pago de un
                      pedido propio. Hace lo mismo que el webhook real:
                      confirmar_pago() (estado, stock y puntos).
   ===================================================================== */
const { confirmarPago, UUID_RE } = require("./rpc");

class ErrorFuncion extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; }
}

const RESENAS = {
  fuente: "Google (reseñas de ejemplo · modo local)",
  promedio: 4.9,
  total: 128,
  url_resenas: "https://www.google.com/maps",
  url_escribir: "https://www.google.com/maps",
  items: [
    { autor: "María José P.", estrellas: 5, fecha: "hace 2 semanas", texto: "Siempre puntuales y el agua es excelente. Pido todas las semanas.", url: null, foto: null },
    { autor: "Juan S.", estrellas: 5, fecha: "hace un mes", texto: "Muy buen servicio, el repartidor es amable y llega el día acordado.", url: null, foto: null },
    { autor: "Ana F.", estrellas: 5, fecha: "hace 2 meses", texto: "Compré el dispensador y la recarga. Todo perfecto, recomendado.", url: null, foto: null },
    { autor: "Luis A.", estrellas: 4, fecha: "hace 3 meses", texto: "Buen precio y despacho rápido en Quilicura.", url: null, foto: null },
    { autor: "Rosa M.", estrellas: 5, fecha: "hace 4 meses", texto: "Llevamos años con ellos en la oficina. Cero problemas.", url: null, foto: null },
  ],
};

function pedidoPropio(ctx, id) {
  if (!ctx.uid) throw new ErrorFuncion("Debes iniciar sesión para pagar.", 401);
  if (!UUID_RE.test(String(id || ""))) throw new ErrorFuncion("Pedido no válido.");
  const p = ctx.db.prepare("SELECT * FROM pedidos WHERE id = ?").get(id);
  if (!p || p.perfil_id !== ctx.uid) throw new ErrorFuncion("Pedido no encontrado.", 404);
  return p;
}

const FUNCIONES = {
  "resenas-google": () => RESENAS,

  "crear-pago": (ctx, body) => {
    const p = pedidoPropio(ctx, body && body.pedido_id);
    if (p.estado !== "pendiente_pago") throw new ErrorFuncion("Este pedido ya no está pendiente de pago.");
    if (!(p.total > 0)) throw new ErrorFuncion("El pedido no tiene un monto a pagar.");
    return { init_point: `pago-simulado.html?pedido=${p.id}`, preference_id: "LOCAL-PREF-" + p.numero };
  },

  "pago-simulado": (ctx, body) => {
    const p = pedidoPropio(ctx, body && body.pedido_id);
    const resultado = body && body.resultado;
    if (!["aprobado", "rechazado", "pendiente"].includes(resultado)) throw new ErrorFuncion("Resultado no válido.");
    if (resultado === "aprobado") {
      const r = confirmarPago(ctx.db, { pedidoId: p.id, paymentId: "LOCAL-" + p.numero + "-" + Date.now(), monto: p.total, raw: { simulado: true } });
      return { ...r, vuelta: "ok" };
    }
    if (resultado === "rechazado") {
      ctx.db.prepare("INSERT INTO pagos (pedido_id, estado, monto, mp_payment_id, raw_response, fecha_pago) VALUES (?,?,?,?,?,?)")
        .run(p.id, "rechazado", p.total, "LOCAL-RECH-" + p.numero + "-" + Date.now(), JSON.stringify({ simulado: true }), new Date().toISOString());
    }
    return { ok: true, vuelta: resultado === "rechazado" ? "error" : "pendiente" };
  },
};

function ejecutarFuncion(nombre, ctx, body) {
  const f = FUNCIONES[nombre];
  if (!f) throw new ErrorFuncion("Función no encontrada.", 404);
  return f(ctx, body);
}

module.exports = { ejecutarFuncion, ErrorFuncion };
