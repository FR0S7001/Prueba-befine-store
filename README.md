# Befine Store · versión con base de datos local

Misma tienda y mismo panel de administración del proyecto original, pero **sin Supabase**: los datos viven en una base **SQLite local** (`data/befine.db`) y un pequeño servidor Node la expone al sitio. Sirve para probar todo (compras, cupones, pagos, panel) sin tocar producción.

Además, el panel tiene una sección nueva: **Banner y eslogan**.

## Cómo ejecutarlo

Requisito: [Node.js](https://nodejs.org) 22.13 o superior (la base SQLite viene incluida en Node; no se instala ni compila nada).

```bash
npm start          # → http://localhost:8080
```

La primera vez se crea `data/befine.db` con datos de ejemplo. Para volver a empezar de cero: `npm run db:reset`.

Con Docker: `docker compose up --build` (la base y los banners quedan en un volumen).

## Cuentas de prueba

| Rol | Correo | Contraseña | Qué puede |
|---|---|---|---|
| Administrador | `admin@befine.local` | `Admin123!` | Todo el panel (`/admin.html`) |
| Chofer | `chofer@befine.local` | `Chofer123!` | Solo ver pedidos |
| Cliente | `cliente@befine.local` | `Cliente123!` | Comprar y ver su historial (tiene 6 pedidos de ejemplo) |

También se puede comprar como invitado o crear una cuenta nueva (la contraseña pide 8+ caracteres con mayúscula, minúscula, número y símbolo).

## Banner y eslogan (nuevo)

Panel → **Banner y eslogan** (permiso `config.gestionar`; el admin lo tiene):

- **Banner:** sube una imagen para pantallas anchas y, opcional, otra para celulares; define el texto alternativo y cuánto se oscurece la imagen para que el texto se lea. Sin imagen, la portada se ve como siempre.
- **Eslogan:** texto pequeño, título, subtítulo y frase del pie de página. En el título, lo que va entre llaves sale destacado: `Recarga de agua {a domicilio} en Quilicura`.
- Vista previa en vivo (escritorio / celular). Nada se publica hasta presionar **Guardar cambios**; "Volver a los textos originales" restaura los textos de fábrica.

Se guarda en la tabla `parametros` (claves `sitio_*`); las imágenes quedan en `data/uploads/`. Aceptadas: JPG, PNG, WebP o GIF de hasta 5 MB (SVG no, por seguridad).

## Qué cambió respecto al original

| Original | Aquí |
|---|---|
| Supabase (PostgreSQL + RLS + Auth) | SQLite + servidor Node (`server/`) con las mismas tablas, permisos por rol y cuentas locales |
| `crear_pedido()`, `revisar_cupon()` en SQL | Misma lógica en `server/rpc.js` (precios, despacho y cupones los decide el servidor) |
| Mercado Pago | Página de **pago simulado** (`pago-simulado.html`): apruebas, rechazas o dejas pendiente; el pedido, el stock y los puntos reaccionan igual |
| Reseñas de Google | Reseñas de **ejemplo** |
| Correos y Google login | No hay correos ni ingreso con Google. "Olvidé mi contraseña" imprime el enlace en la consola del servidor |

`js/local-client.js` imita a supabase-js, por eso `data.js`, `admin-data.js` y el resto de la interfaz casi no cambiaron. Los precios, el stock y los pedidos de ejemplo son **valores inventados** para probar.

## Estructura

```
server/   Servidor local: index.js (HTTP), schema.js, seed.js, rest.js (consultas + permisos), rpc.js (pedidos, cupones, pago), auth.js
web/      Sitio y panel (HTML/CSS/JS sin framework); js/local-client.js es el cliente de la base local
data/     Base SQLite e imágenes subidas (se crea sola; no se sube a git)
tests/    Pruebas automáticas (npm test): 94
```

## Pruebas

```bash
npm test
```

Incluye las 74 del proyecto original, las del banner/eslogan y las del servidor (permisos por rol, pedidos, cupones, pago simulado, subida de imágenes, protección de rutas).

## Notas

- Es para **pruebas locales**, no para producción: sin HTTPS, sin límites de intentos ni correos reales. Por defecto solo escucha en `127.0.0.1`.
- Los permisos del servidor (`server/rest.js`) replican el RLS del original; si agregas una tabla, agrégala también ahí.
- Licencia MIT (ver `LICENSE`). Proyecto original: Capstone Duoc UC, Grupo N3 (Plaxi Solutions).
