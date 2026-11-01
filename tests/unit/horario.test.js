/* Pruebas de franjas horarias y saludo dinámico (web/js/bands.js) — 9 pruebas
   Caso CP-U12 del Plan de Pruebas (innovación: experiencia según la hora). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

const enHora = (hhmm) => cargar(["bands.js"], { fecha: `2026-10-09T${hhmm}:00` }).Bands;

test("CP-U12a madrugada de 01:00 a 07:59", () => {
  assert.equal(enHora("01:00").current(), "madrugada");
  assert.equal(enHora("07:59").current(), "madrugada");
});

test("CP-U12b día de 08:00 a 17:59", () => {
  assert.equal(enHora("08:00").current(), "mediodia");
  assert.equal(enHora("17:59").current(), "mediodia");
});

test("CP-U12c tarde de 18:00 a 20:59", () => {
  assert.equal(enHora("18:00").current(), "tarde");
  assert.equal(enHora("20:59").current(), "tarde");
});

test("CP-U12d noche de 21:00 a 00:59", () => {
  assert.equal(enHora("21:00").current(), "noche");
  assert.equal(enHora("00:59").current(), "noche");
});

test("CP-U12e saludo de día: Buenos días", () => {
  assert.equal(enHora("09:00").greeting().hi, "Buenos días");
});

test("CP-U12f saludo de tarde: Buenas tardes", () => {
  assert.equal(enHora("19:00").greeting().hi, "Buenas tardes");
});

test("CP-U12g saludo de noche y de madrugada", () => {
  assert.equal(enHora("23:00").greeting().hi, "Buenas noches");
  assert.equal(enHora("03:00").greeting().hi, "Buenas madrugadas");
});

test("CP-U12h cliente registrado recibe un mensaje de 'vuelta'", () => {
  const Bands = enHora("10:00");
  for (let i = 0; i < 10; i++) assert.ok(Bands.BANDS.mediodia.vuelta.includes(Bands.greeting("Iván").msg));
});

test("CP-U12i visitante sin cuenta recibe un mensaje de bienvenida", () => {
  const Bands = enHora("10:00");
  for (let i = 0; i < 10; i++) assert.ok(Bands.BANDS.mediodia.nuevo.includes(Bands.greeting().msg));
});
