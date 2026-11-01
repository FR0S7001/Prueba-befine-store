/* Pruebas del pago con Mercado Pago en la tienda (web/js/data.js) — 6 pruebas
   Casos CP-U21 del Plan de Pruebas (HU-08 / HU-09). Supabase se simula: se prueba cómo la tienda
   llama a la Edge Function crear-pago, cómo interpreta su respuesta y la vuelta desde Mercado Pago.
   El estado 'pagado' lo pone solo el servidor (mp-webhook → confirmar_pago); aquí no se decide. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

const PEDIDO = "8f1c2d3e-4b5a-4c6d-8e7f-901234567890";

/* Cliente Supabase simulado: functions.invoke() responde lo que indique cada prueba y guarda la llamada */
function conFuncion(respuesta) {
  const llamadas = [];
  const cliente = {
    functions: { invoke: async (fn, opciones) => { llamadas.push({ fn, opciones }); return typeof respuesta === "function" ? respuesta() : respuesta; } },
    from: () => { throw new Error("no debe consultar la base"); },
  };
  const { Befine } = cargar(["data.js"], { cliente });
  return { Befine, llamadas };
}

test("CP-U21a pagar: llama a crear-pago solo con el id del pedido y devuelve la URL de Mercado Pago", async () => {
  const url = "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc";
  const { Befine, llamadas } = conFuncion({ data: { init_point: url, preference_id: "123-abc", numero: 15, total: 9000 }, error: null });
  const r = await Befine.pagar({ id: PEDIDO, numero: 15, total: 1 });   // el total del navegador no viaja
  assert.equal(r.ok, true);
  assert.equal(r.url, url);
  assert.equal(llamadas[0].fn, "crear-pago");
  assert.deepEqual(JSON.parse(JSON.stringify(llamadas[0].opciones.body)), { pedido_id: PEDIDO });
});

test("CP-U21b pagar: no redirige a una URL que no sea de Mercado Pago (caso de error)", async () => {
  const { Befine } = conFuncion({ data: { init_point: "https://sitio-falso.com/pago" }, error: null });
  const r = await Befine.pagar(PEDIDO);
  assert.equal(r.ok, false);
  assert.equal(Befine.urlPagoSegura("http://www.mercadopago.cl/checkout"), false);   // sin https tampoco
  assert.equal(Befine.urlPagoSegura("https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=1"), true);
});

test("CP-U21c pagar: muestra el motivo del servidor y oculta los mensajes técnicos (caso de error)", async () => {
  const error409 = { message: "Edge Function returned a non-2xx status code",
    context: { json: async () => ({ error: "Este pedido ya no está pendiente de pago." }) } };
  let r = await conFuncion({ data: null, error: error409 }).Befine.pagar(PEDIDO);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Este pedido ya no está pendiente de pago.");

  const errorTecnico = { message: "Edge Function returned a non-2xx status code",
    context: { json: async () => ({ error: "Falta el secreto MP_ACCESS_TOKEN" }) } };
  r = await conFuncion({ data: null, error: errorTecnico }).Befine.pagar(PEDIDO);
  assert.equal(r.error, "No pudimos conectar con Mercado Pago. Inténtalo de nuevo.");
});

test("CP-U21d pagar: rechaza un id de pedido inválido sin llamar al servidor (caso de error)", async () => {
  const { Befine, llamadas } = conFuncion({ data: null, error: null });
  const r = await Befine.pagar("123; drop table pedidos");
  assert.equal(r.ok, false);
  assert.equal(llamadas.length, 0);
});

test("CP-U21e vuelta desde Mercado Pago: acepta solo estados conocidos y un id de pedido válido", () => {
  const { Befine } = conFuncion({ data: null, error: null });
  assert.deepEqual({ ...Befine.vueltaPago(`?pago=ok&pedido=${PEDIDO}`) }, { estado: "ok", pedido: PEDIDO });
  assert.deepEqual({ ...Befine.vueltaPago(`?pago=error&pedido=${PEDIDO}`) }, { estado: "error", pedido: PEDIDO });
  assert.equal(Befine.vueltaPago(`?pago=aprobado&pedido=${PEDIDO}`), null);
  assert.equal(Befine.vueltaPago("?pago=ok&pedido=abc"), null);
  assert.equal(Befine.vueltaPago(""), null);
});

test("CP-U21f solo los estados confirmados por el servidor cuentan como pagados", () => {
  const { Befine } = conFuncion({ data: null, error: null });
  for (const e of ["pagado", "en_preparacion", "en_ruta", "entregado"]) assert.equal(Befine.pedidoPagado(e), true, e);
  for (const e of ["pendiente_pago", "cancelado", undefined]) assert.equal(Befine.pedidoPagado(e), false, String(e));
});
