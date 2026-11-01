/* Pruebas de validaciones de formularios (web/js/forms.js) — 11 pruebas
   Casos CP-U01 a CP-U04 y CP-U13 (política de contraseñas) del Plan de Pruebas. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargar } = require("../helpers/cargar");

const { Val } = cargar(["forms.js"]).BefineForms;

test("CP-U01a RUT válido con y sin puntos ni guion (módulo 11)", () => {
  assert.equal(Val.rut("12.345.678-5"), true);
  assert.equal(Val.rut("123456785"), true);
  assert.equal(Val.rut("11.111.111-1"), true);
});

test("CP-U01b RUT con dígito verificador K (mayúscula o minúscula)", () => {
  assert.equal(Val.rut("10.000.013-k"), true);
  assert.equal(Val.rut("10000013K"), true);
});

test("CP-U02a RUT con dígito verificador incorrecto se rechaza", () => {
  assert.equal(Val.rut("12.345.678-9"), false);
  assert.equal(Val.rut("10.000.013-1"), false);
});

test("CP-U02b RUT corto, vacío o nulo se rechaza", () => {
  assert.equal(Val.rut("1-9"), false);
  assert.equal(Val.rut(""), false);
  assert.equal(Val.rut(null), false);
});

test("CP-U02c formato de RUT con puntos y guion", () => {
  assert.equal(Val.formatoRut("123456785"), "12.345.678-5");
  assert.equal(Val.formatoRut("10000013k"), "10.000.013-K");
});

test("CP-U03a celular chileno válido con +56, espacios o guiones", () => {
  assert.equal(Val.telefono("+56 9 1234 5678"), true);
  assert.equal(Val.telefono("912345678"), true);
  assert.equal(Val.telefono("9-1234-5678"), true);
  assert.equal(Val.telefono("56912345678"), true);
});

test("CP-U03b teléfono fijo o de largo incorrecto se rechaza; formato 9 XXXX XXXX", () => {
  assert.equal(Val.telefono("221234567"), false);
  assert.equal(Val.telefono("91234567"), false);
  assert.equal(Val.formatoTel("+56912345678"), "9 1234 5678");
});

test("CP-U04a formato de correo electrónico", () => {
  assert.equal(Val.email("cliente@aguabefine.cl"), true);
  assert.equal(Val.email("  cliente@aguabefine.cl  "), true);
  assert.equal(Val.email("cliente@aguabefine"), false);
  assert.equal(Val.email("cliente aguabefine.cl"), false);
  assert.equal(Val.email(""), false);
});

test("CP-U04b fuerza de contraseña de 0 a 4", () => {
  assert.equal(Val.fuerza(""), 0);
  assert.equal(Val.fuerza("abcdefgh"), 1);
  assert.equal(Val.fuerza("Abcdefgh"), 2);
  assert.equal(Val.fuerza("Abcdefgh1!"), 3);
  assert.equal(Val.fuerza("Abcdefghijk1!"), 4);
});

test("CP-U13a contraseña que cumple la política de Supabase Auth", () => {
  assert.deepEqual(Array.from(Val.claveFaltante("Befine.2026")), []);
  assert.ok(Val.reqsClave("Agua#Pura9").every((r) => r.ok));
});

test("CP-U13b contraseña débil informa exactamente lo que falta", () => {
  assert.deepEqual(Array.from(Val.claveFaltante("befine")),
    ["8 o más caracteres", "una mayúscula", "un número", "un símbolo (. @ # ! …)"]);
  assert.deepEqual(Array.from(Val.claveFaltante("BEFINE2026!")), ["una minúscula"]);
  assert.equal(Val.claveFaltante("").length, 5);
});
