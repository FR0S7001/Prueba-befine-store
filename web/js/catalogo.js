/* =====================================================================
   catalogo.js — Lógica de la página de Catálogo (catalogo.html)
   Filtros por categoría, búsqueda y orden sobre una grilla de productos.
   (El antiguo "Modo Cine" se eliminó: solo queda la grilla.)
   ===================================================================== */
(function () {
  let estado = { categoria: null, q: "", orden: "relevancia" };

  document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById("grid");
    const filtros = document.getElementById("filtros");
    const search = document.getElementById("catSearch");
    const orden = document.getElementById("catOrden");

    // Botones de categoría (a partir de las categorías reales)
    const cats = await Befine.listCategorias();
    filtros.innerHTML =
      `<button class="active" data-cat="">Todos</button>` +
      cats.map((c) => `<button data-cat="${c.slug}">${c.nombre}</button>`).join("");
    filtros.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-cat]"); if (!b) return;
      filtros.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      estado.categoria = b.dataset.cat || null;
      pintar();
    });

    if (search) search.addEventListener("input", () => { estado.q = search.value; pintar(); });
    if (orden) orden.addEventListener("change", () => { estado.orden = orden.value; pintar(); });

    // Parámetros en la URL (?cat= y ?q=)
    const url = new URLSearchParams(location.search);
    if (url.get("cat")) {
      estado.categoria = url.get("cat");
      const b = filtros.querySelector(`button[data-cat="${estado.categoria}"]`);
      if (b) { filtros.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); }
    }
    if (url.get("q")) { estado.q = url.get("q"); if (search) search.value = estado.q; }

    async function pintar() {
      let items = await Befine.listProductos({ categoria: estado.categoria, q: estado.q });
      if (estado.orden === "precio_asc") items.sort((a, b) => a.desde_precio - b.desde_precio);
      if (estado.orden === "precio_desc") items.sort((a, b) => b.desde_precio - a.desde_precio);
      if (!items.length) { grid.innerHTML = `<p class="empty-state">No encontramos productos con ese criterio.</p>`; return; }
      grid.innerHTML = items.map(productCardHTML).join("");
      grid.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    }

    pintar();
  });
})();
