/* Pruebas del carrito (web/js/store.js) — 6 pruebas
   Casos CP-U05 a CP-U07 del Plan de Pruebas. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar, crearLocalStorage } = require("../helpers/cargar");

const bidon = { variante_id: 1, producto_id: 1, nombre: "Recarga bidón", variante: "20 L", precio: 2500 };
const dispensador = { variante_id: 7, producto_id: 3, nombre: "Dispensador", variante: "Manual", precio: 4990 };
const carritoNuevo = (ls) => cargar(["store.js"], { localStorage: ls || crearLocalStorage() }).Store;

test("CP-U05a agregar: la misma variante suma cantidades y otra variante va en línea aparte", () => {
  const Store = carritoNuevo();
  Store.add(bidon, 2);
  Store.add(bidon, 1);
  Store.add(dispensador);
  assert.equal(Store.items().length, 2);
  assert.equal(Store.items().find((i) => i.variante_id === 1).cantidad, 3);
});

test("CP-U05b total en pesos y conteo de unidades", () => {
  const Store = carritoNuevo();
  Store.add(bidon, 3);
  Store.add(dispensador, 1);
  assert.equal(Store.count(), 4);
  assert.equal(Store.total(), 3 * 2500 + 4990);
});

test("CP-U06 cantidad 0 o negativa elimina el ítem", () => {
  const Store = carritoNuevo();
  Store.add(bidon, 2);
  Store.add(dispensador, 1);
  Store.setQty(1, 0);
  assert.equal(Store.items().some((i) => i.variante_id === 1), false);
  Store.setQty(7, -3);
  assert.equal(Store.items().length, 0);
});

test("CP-U07a persistencia: el carrito se guarda en localStorage y se recupera al recargar", () => {
  const ls = crearLocalStorage();
  carritoNuevo(ls).add(bidon, 3);
  assert.equal(JSON.parse(ls.getItem("befine_cart"))[0].cantidad, 3);
  assert.equal(carritoNuevo(ls).count(), 3);                       // "recarga" de la página
  assert.equal(carritoNuevo(crearLocalStorage({ befine_cart: "{dañado" })).count(), 0);  // dato dañado no rompe
});

test("CP-U07b suscriptores: se avisa al suscribirse y en cada cambio", () => {
  const Store = carritoNuevo();
  const avisos = [];
  Store.subscribe((items) => avisos.push(items.length));
  Store.add(bidon);
  Store.remove(1);
  assert.deepEqual(avisos, [0, 1, 0]);
});

test("CP-U07c items() entrega una copia: modificarla no altera el carrito", () => {
  const Store = carritoNuevo();
  Store.add(bidon, 1);
  const copia = Store.items();
  copia.push({ ...dispensador, cantidad: 5 });
  assert.equal(Store.items().length, 1);
});
