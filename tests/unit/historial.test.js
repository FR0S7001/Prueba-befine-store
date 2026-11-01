/* Pruebas del historial de pedidos del cliente (web/js/data.js) — 6 pruebas
   Casos CP-U22 del Plan de Pruebas (HU-18, RF-10). Supabase se simula: se prueba cómo la tienda
   arma el detalle de un pedido y qué agrega al carrito con "Volver a pedir". */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

const plano = (x) => JSON.parse(JSON.stringify(x));   // objetos creados en el contexto aislado → comparables
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";

function befine(cliente = {}) { return cargar(["data.js"], { cliente }).Befine; }

/* Variante como la devuelve la consulta de volverAPedir() */
const variante = (id, extra = {}) => ({
  id, nombre: "Con bidón Befine", stock: 50, controla_stock: true, activo: true,
  precios_variante: [{ nivel_precio_id: 1, precio: 3500 }, { nivel_precio_id: 2, precio: 3000 }],
  productos: { id: "p-" + id, nombre: "Recarga 20 L", activo: true, categorias: { slug: "recargas" } },
  ...extra,
});

test("CP-U22a detalle del pedido: productos, montos, dirección y documento", () => {
  const d = befine().armarDetalle({
    id: V1, numero: 19, estado: "pagado", created_at: "2026-10-25T20:48:00Z", fecha_entrega: "2026-10-26",
    subtotal: 10000, costo_despacho: 0, descuento_cupon: 1000, total: 9000, tipo_documento: "boleta",
    direccion: { calle: "Los Olmos", numero: "123", depto: null, comuna: "Quilicura" },
    detalle_pedido: [{ variante_id: V2, cantidad: 4, precio_unitario: 2500, subtotal: 10000,
      variante: { nombre: "Con bidón Befine", producto: { nombre: "Recarga 20 L" } } }],
    documentos_tributarios: [],
  });
  assert.equal(d.numero, 19); assert.equal(d.total, 9000); assert.equal(d.descuento, 1000); assert.equal(d.despacho, 0);
  assert.equal(d.direccion.comuna, "Quilicura");
  assert.deepEqual(plano(d.items), [{ variante_id: V2, nombre: "Recarga 20 L", variante: "Con bidón Befine", cantidad: 4, precio_unitario: 2500, subtotal: 10000 }]);
  assert.equal(d.boleta, null);   // aún sin boleta emitida
});

test("CP-U22b el enlace de la boleta solo aparece si fue emitida y la URL es https (caso de error)", () => {
  const B = befine();
  const base = { id: V1, numero: 1, estado: "pagado", detalle_pedido: [] };
  const conDte = (dte) => B.armarDetalle({ ...base, documentos_tributarios: [dte] }).boleta;
  assert.deepEqual(plano(conDte({ tipo: "boleta", estado: "emitido", folio: 345, url_pdf: "https://openfactura.cl/dte/345.pdf" })),
    { tipo: "boleta", folio: 345, url: "https://openfactura.cl/dte/345.pdf" });
  assert.equal(conDte({ tipo: "boleta", estado: "pendiente", url_pdf: "https://openfactura.cl/x.pdf" }), null);
  assert.equal(conDte({ tipo: "boleta", estado: "emitido", url_pdf: "javascript:alert(1)" }), null);
});

test("CP-U22c volver a pedir: usa el precio VIGENTE del nivel retail, no el de la compra original", () => {
  const r = befine().armarRepeticion([{ variante_id: V1, cantidad: 4, precio_unitario: 2500 }], [variante(V1)], 1);
  assert.equal(r.agregar.length, 1);
  assert.equal(r.agregar[0].item.precio, 3500);
  assert.equal(r.agregar[0].cantidad, 4);
  assert.equal(r.agregar[0].categoria_slug, "recargas");
  assert.equal(r.noDisponibles.length, 0);
});

test("CP-U22d volver a pedir: agrega los disponibles y avisa los inactivos, sin precio o sin stock (caso de error)", () => {
  const items = [{ variante_id: V1, cantidad: 2 }, { variante_id: V2, cantidad: 1, nombre: "Dispensador" }, { variante_id: V3, cantidad: 3 }];
  const r = befine().armarRepeticion(items, [
    variante(V1),
    variante(V3, { stock: 0, productos: { id: "p3", nombre: "Bidón 12 L", activo: true } }),
  ], 1);   // V2 ya no existe en el catálogo (inactiva → el RLS no la devuelve)
  assert.deepEqual(plano(r.agregar.map((a) => a.item.variante_id)), [V1]);
  assert.deepEqual(plano(r.noDisponibles), ["Dispensador", "Bidón 12 L"]);
});

test("CP-U22e volver a pedir: con menos stock que lo pedido agrega lo disponible; sin control de stock agrega todo", () => {
  const B = befine();
  let r = B.armarRepeticion([{ variante_id: V1, cantidad: 5 }], [variante(V1, { stock: 2 })], 1);
  assert.equal(r.agregar[0].cantidad, 2);
  assert.deepEqual(plano(r.ajustados), [{ nombre: "Recarga 20 L", cantidad: 2 }]);
  r = B.armarRepeticion([{ variante_id: V1, cantidad: 5 }], [variante(V1, { stock: 0, controla_stock: false })], 1);
  assert.equal(r.agregar[0].cantidad, 5);
});

test("CP-U22f detalle y volver a pedir no consultan la base con ids inválidos (caso de error)", async () => {
  let consultas = 0;
  const B = befine({ from: () => { consultas++; throw new Error("no debe consultar"); } });
  assert.equal(await B.detallePedido("1 or 1=1"), null);
  const r = await B.volverAPedir([{ variante_id: "abc", cantidad: 1 }]);
  assert.equal(r.ok, false);
  assert.equal(consultas, 0);
});
