/* Pruebas del cupón en el checkout (Befine.revisarCupon en web/js/data.js) — 4 pruebas
   Casos CP-U19 del Plan de Pruebas. Supabase se simula: se prueba cómo la tienda
   interpreta la respuesta de revisar_cupon() (migración 04). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

/* Cliente Supabase simulado: rpc() responde lo que indique cada prueba y guarda la llamada */
function conRespuesta(respuesta) {
  const llamadas = [];
  const cliente = { rpc: async (fn, args) => { llamadas.push({ fn, args }); return typeof respuesta === "function" ? respuesta() : respuesta; } };
  const { Befine } = cargar(["data.js"], { cliente });
  return { Befine, llamadas };
}
const items = [{ variante_id: "v1", cantidad: 4, precio: 3000, nombre: "Recarga" }];

test("CP-U19a cupón válido: muestra el descuento calculado por el servidor y envía solo id y cantidad", async () => {
  const { Befine, llamadas } = conRespuesta({ data: { valido: true, codigo: "CYBER10", descuento: 1200, tipo: "porcentaje", valor: 10 }, error: null });
  const r = await Befine.revisarCupon(" cyber10 ", items);
  assert.equal(r.valido, true); assert.equal(r.codigo, "CYBER10"); assert.equal(r.descuento, 1200);
  assert.equal(llamadas[0].fn, "revisar_cupon");
  assert.equal(llamadas[0].args.p_codigo, "cyber10");
  assert.deepEqual(JSON.parse(JSON.stringify(llamadas[0].args.p_items)), [{ variante_id: "v1", cantidad: 4 }]);   // el precio no viaja: lo pone el servidor
});

test("CP-U19b cupón rechazado: muestra el motivo que da el servidor", async () => {
  const { Befine } = conRespuesta({ data: { valido: false, mensaje: "Este cupón es solo para tu primera compra." }, error: null });
  const r = await Befine.revisarCupon("BIENVENIDA", items);
  assert.equal(r.valido, false);
  assert.equal(r.mensaje, "Este cupón es solo para tu primera compra.");
});

test("CP-U19c sin la migración 04 aplicada, avisa que los cupones vienen pronto", async () => {
  const { Befine } = conRespuesta({ data: null, error: { code: "PGRST202", message: "Could not find the function public.revisar_cupon" } });
  const r = await Befine.revisarCupon("CYBER10", items);
  assert.equal(r.valido, false);
  assert.match(r.mensaje, /muy pronto/);
});

test("CP-U19d sin conexión: mensaje claro, sin romper el checkout", async () => {
  const { Befine } = conRespuesta(() => { throw new TypeError("Failed to fetch"); });
  const r = await Befine.revisarCupon("CYBER10", items);
  assert.equal(r.valido, false);
  assert.match(r.mensaje, /Inténtalo de nuevo/);
});
