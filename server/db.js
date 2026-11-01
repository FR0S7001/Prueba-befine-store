/* db.js — Abre la base SQLite local y crea el esquema (y los datos de ejemplo la primera vez) */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");   // SQLite incluido en Node 22.13+ (sin instalar ni compilar nada)
const { DDL } = require("./schema");

const RAIZ = path.join(__dirname, "..");
const DIR_DATOS = process.env.BEFINE_DATA_DIR || path.join(RAIZ, "data");

/* Envoltorio mínimo sobre node:sqlite: agrega transaction() (con anidación) y pragma() */
function envolver(raw) {
  let nivel = 0;
  return {
    raw,
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => raw.prepare(sql),
    pragma: (txt) => raw.exec("PRAGMA " + txt),
    /* db.transaction(fn) devuelve una función que ejecuta fn dentro de BEGIN/COMMIT (ROLLBACK si falla) */
    transaction: (fn) => (...args) => {
      const sp = "sp" + nivel;
      raw.exec(nivel === 0 ? "BEGIN" : "SAVEPOINT " + sp);
      nivel++;
      try {
        const r = fn(...args);
        nivel--; raw.exec(nivel === 0 ? "COMMIT" : "RELEASE " + sp);
        return r;
      } catch (e) {
        nivel--; raw.exec(nivel === 0 ? "ROLLBACK" : "ROLLBACK TO " + sp + "; RELEASE " + sp);
        throw e;
      }
    },
  };
}

/* Abre la base. archivo = ":memory:" para pruebas automatizadas. */
function abrir(archivo) {
  const destino = archivo || process.env.BEFINE_DB || path.join(DIR_DATOS, "befine.db");
  if (destino !== ":memory:") fs.mkdirSync(path.dirname(destino), { recursive: true });
  const db = envolver(new DatabaseSync(destino));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);
  return db;
}

/* Borra todo y vuelve a crear los datos de ejemplo */
function reiniciar(db) {
  db.pragma("foreign_keys = OFF");
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const t of tablas) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.pragma("foreign_keys = ON");
  db.exec(DDL);
  require("./seed").sembrar(db);
}

module.exports = { abrir, reiniciar, DIR_DATOS, RAIZ };
