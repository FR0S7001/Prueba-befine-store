/* =====================================================================
   cards.js — Render de la TARJETA de producto (compartida)
   La usan la home (destacados) y el catálogo, para no repetir el HTML.
   También centraliza el "agregar al carrito" desde cualquier tarjeta.
   ===================================================================== */
(function () {
  /* Devuelve el HTML de una tarjeta a partir del "view-model" de un producto
     (el que arma Befine.listProductos / getDestacados). */
  window.productCardHTML = function (p) {
    const grad = window.catGrad(p.categoria_slug);
    const v = p.variantes[0]; // variante por defecto (para el botón rápido)
    const desde = p.variantes.length > 1;
    return `
      <article class="card reveal">
        <a class="vessel" style="--v-grad:${grad}" href="producto.html?id=${p.id}" aria-label="${p.nombre}">
          <span class="tag">${p.categoria}</span>${p.desde_comparacion ? `<span class="oferta">Oferta</span>` : ""}
        </a>
        <div class="body">
          <a href="producto.html?id=${p.id}"><h3>${p.nombre}</h3></a>
          <span class="cat">${p.categoria}</span>
          <div class="price-row">
            <span class="price">${desde ? "<small>desde </small>" : ""}${Befine.clp(p.desde_precio)}${p.desde_comparacion ? ` <s>${Befine.clp(p.desde_comparacion)}</s>` : ""}</span>
            <button class="btn btn-primary"
              data-add="${v.id}" data-prod="${p.id}" data-nombre="${p.nombre.replace(/"/g, "&quot;")}"
              data-variante="${v.nombre}" data-precio="${v.precio}" data-grad="${grad}">
              ${desde ? "Elegir" : "Comprar"}
            </button>
          </div>
        </div>
      </article>`;
  };

  /* Un solo manejador para TODOS los botones "Comprar" de tarjetas.
     Si el producto tiene varias variantes ("Elegir"), lleva a la ficha. */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    if (btn.textContent.trim() === "Elegir") { window.location.href = "producto.html?id=" + btn.dataset.prod; return; }
    Store.add({
      variante_id: btn.dataset.add,
      producto_id: btn.dataset.prod,
      nombre: btn.dataset.nombre,
      variante: btn.dataset.variante,
      precio: Number(btn.dataset.precio),
      grad: btn.dataset.grad,
    }, 1);
    window.toast("Agregado al carrito: " + btn.dataset.nombre);
  });
})();
