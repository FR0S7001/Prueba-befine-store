# Befine Store — Maqueta de frontend (esqueleto)

Maqueta navegable de la tienda Befine Store hecha con **HTML + CSS + JavaScript puro** (sin librerías), lista para servir de "esqueleto" sobre el cual construir el backend con Supabase.

Objetivo: validar la **experiencia** (agua reactiva, sensación de "habitación", compra en pocos clicks) con datos **falsos pero con la misma forma que el esquema real** de Supabase, de modo que conectar el backend después sea casi solo "cambiar de dónde vienen los datos".

---

## 1. Cómo correrlo

No la abras con doble clic (`file://`): usa un servidor estático simple para que todo funcione bien.

**Opción A — VS Code:** instala la extensión *Live Server* → clic derecho en `index.html` → "Open with Live Server".

**Opción B — terminal (Python):**
```bash
cd befine-store-maqueta
python -m http.server 5500
# abre http://localhost:5500
```

---

## 2. Estructura de carpetas

```
befine-store-maqueta/
├── index.html          # INICIO (hero/escena, cómo funciona, recompra, destacados, reseñas)
├── catalogo.html       # CATÁLOGO (página propia: grilla + filtros + búsqueda + orden)
├── producto.html       # FICHA de producto (?id=prod-XX: variantes + cantidad)
│
├── css/                # Estilos POR CAPAS (se cargan en ese orden)
│   ├── tokens.css      #   variables de marca (colores, fuentes) ← cambia la marca AQUÍ
│   ├── base.css        #   reset, tipografía base, utilidades, reveals
│   ├── shell.css       #   cascarón: barra, navegación, carrito (drawer), pie, fondo agua
│   ├── components.css  #   piezas: botones, tarjetas, formularios, modal, toast
│   ├── home.css        #   estilos solo del inicio
│   ├── catalogo.css    #   estilos solo del catálogo
│   └── producto.css    #   estilos solo de la ficha
│
└── js/                 # Lógica POR RESPONSABILIDAD
    ├── data.js         #   "API FALSA" + datos con la forma del schema de Supabase
    ├── store.js        #   estado del carrito (localStorage, compartido entre páginas)
    ├── ui.js           #   cascarón: carrito (drawer), checkout demo, toast, reveals, menú
    ├── cards.js        #   render de la tarjeta de producto (home + catálogo) y "agregar"
    ├── water.js        #   fondo de agua reactivo REUTILIZABLE (con fix de rendimiento)
    ├── home.js         #   lógica del inicio (agua, parallax, destacados, recompra)
    ├── catalogo.js     #   lógica del catálogo (filtros, búsqueda, orden)
    └── producto.js     #   lógica de la ficha (variantes, cantidad)
```

**Cómo se carga una página:** primero la base común (`data → store → ui → cards`), y al final el JS propio de esa página. El inicio además carga `water.js` antes de `home.js`.

---

## 3. El puente al backend (lo más importante)

La interfaz **nunca** inventa datos: siempre se los pide a `window.Befine` (definido en `js/data.js`). Y los nombres de campo son los **mismos** que las tablas de Supabase (`befine_store_schema_DEFINITIVO.sql`):

| Maqueta (`data.js`)        | Tabla en Supabase        |
|----------------------------|--------------------------|
| `productos`                | `public.productos`       |
| `variantes_producto`       | `public.variantes_producto` |
| `precios_variante`         | `public.precios_variante`|
| `categorias`               | `public.categorias`      |
| `zonas_despacho`           | `public.zonas_despacho`  |

Los datos de catálogo y precios son los **reales** de Befine (nivel retail).

**Para pasar a Supabase después:** solo se reemplaza el CUERPO de los métodos de `Befine` por llamadas al SDK. La interfaz no cambia. Ejemplo:

```js
// HOY (falso):
async listProductos() { return _delay(productos.map(_armarProducto)); }

// MAÑANA (real, con supabase-js):
async listProductos() {
  const { data } = await supabase
    .from('productos')
    .select('*, variantes_producto(*, precios_variante(*))')
    .eq('activo', true);
  return data;
}
```

Como los métodos ya devuelven Promesas (`async`), el cambio es transparente para `home.js`, `catalogo.js` y `producto.js`.

---

## 4. El fondo de agua y su "fix de rendimiento" (`js/water.js`)

Es una simulación de olas 2D en `<canvas>` que reacciona al mouse y se mueve suave de forma constante. A diferencia de un demo típico, aquí:

1. **Se detiene si la pestaña se oculta** (`visibilitychange`).
2. **"Duerme" cuando el agua está quieta** y no hay interacción (deja de renderizar).
3. **Baja resolución en móvil** y respeta `prefers-reduced-motion` (fondo estático).

Visualmente no cambia nada; solo deja de gastar CPU/batería cuando no hay nada que mostrar. Esto protege el KPI del Plan de Calidad (Lighthouse ≥ 90, LCP ≤ 2,5 s).

El agua es **fuerte solo en el inicio**. El catálogo y la ficha no la usan, para priorizar velocidad y claridad (la atmósfera vive en el hero; la tienda vende rápido).

---

## 5. Qué ya funciona en la maqueta

- Navegación entre inicio ↔ catálogo ↔ ficha.
- Carrito real (drawer) que persiste entre páginas y al recargar.
- Filtros por categoría, búsqueda en vivo y orden por precio.
- Ficha con selección de variante (ej. Recarga 20 L: bidón Befine / otra marca) y cantidad.
- "Vuelve a pedir lo de siempre" (recompra en 1 clic).
- Checkout de demostración (nombre + términos) — aquí se conectará Mercado Pago.

## 6. Qué falta (próximos pasos, ya con backend)

- Login / registro (Supabase Auth) — HU-01.
- Catálogo y precios desde Supabase — HU-02/03.
- Carrito y pedido en base de datos, checkout con dirección/zona — HU-04–07.
- Pago real (Mercado Pago) y facturación (OpenFactura) — HU-08–10.
- Fidelización por puntos y panel de administración — HU-11–13.

> Nota: colores e imágenes son **placeholder** (tema agua). Reemplaza los tokens de `css/tokens.css` y agrega fotos reales en `assets/` cuando definan la identidad visual de Befine.
