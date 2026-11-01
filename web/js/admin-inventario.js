/* =====================================================================
   admin-inventario.js — Sección "Inventario" del panel (RF-18)
   ---------------------------------------------------------------------
   - Resumen: agotados, stock bajo, disponibles y sin control de stock.
   - Lista ordenada por urgencia, con búsqueda y filtro por nivel.
   - Ajuste rápido (− / + o escribir la cantidad) y Guardar por fila.
   - Umbral de "stock bajo" editable (parámetro stock_alerta), si el rol
     tiene config.gestionar; si no, se usa el valor guardado o 10.
   crear_pedido() ya rechaza pedidos sin stock suficiente (migración 01).
   ===================================================================== */
(function () {
  const L = window.AdminLogic;
  const { esc, ICONOS, UI } = window.AdminApp;
  const A = () => Befine.admin;

  let el, app, items = [], umbral = L.UMBRAL_DEFECTO, filtro = { nivel: "alerta", q: "" };

  function montar(seccion, appCtx) {
    el = seccion; app = appCtx;
    el.innerHTML = `
      <div class="ad-head">
        <div><h1>Inventario</h1><p>Stock por variante. Los pedidos sin stock suficiente se rechazan al comprar.</p></div>
        <div class="acciones">
          <label class="ad-buscar">${ICONOS.buscar}<input class="ad-inp" id="inBuscar" type="search" placeholder="Producto, variante o SKU" aria-label="Buscar en inventario"></label>
          <button class="ad-btn ghost" type="button" id="inRecargar">${ICONOS.recargar}<span>Actualizar</span></button>
        </div>
      </div>
      <div class="ad-kpis ad-kpis-4" id="inResumen"></div>
      <p class="ad-umbral" id="inUmbral"></p>
      <div class="ad-card ad-lista" id="inLista"><div class="ad-vacio"><span class="ad-spin"></span></div></div>`;

    let t;
    el.querySelector("#inBuscar").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; pintarLista(); }, 150); });
    el.querySelector("#inRecargar").addEventListener("click", (e) => UI.conCarga(e.currentTarget, cargar));
    el.querySelector("#inResumen").addEventListener("click", (e) => {
      const b = e.target.closest("[data-n]"); if (!b) return;
      filtro.nivel = filtro.nivel === b.dataset.n ? "todos" : b.dataset.n; pintarResumen(); pintarLista();
    });
    el.querySelector("#inUmbral").addEventListener("click", (e) => { if (e.target.closest("#inUmbralEd")) editarUmbral(); });

    const lista = el.querySelector("#inLista");
    lista.addEventListener("click", (e) => {
      const b = e.target.closest("[data-d], [data-guardar]"); if (!b) return;
      const fila = b.closest("tr"), inp = fila.querySelector("[data-stock]");
      if (b.dataset.d) { const n = L.parseStock(inp.value); inp.value = L.sumarStock(n === null ? inp.dataset.orig : n, Number(b.dataset.d)); marcar(fila); }
      if (b.hasAttribute("data-guardar")) guardar(fila);
    });
    lista.addEventListener("input", (e) => { if (e.target.matches("[data-stock]")) marcar(e.target.closest("tr")); });
    lista.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-stock]")) { e.preventDefault(); guardar(e.target.closest("tr")); } });
  }

  async function mostrar() { await cargar(); }   // siempre fresco: el catálogo pudo agregar variantes

  async function cargar() {
    try {
      [items, umbral] = await Promise.all([A().listInventario(), A().umbralStock()]);
      pintarResumen(); pintarUmbral(); pintarLista();
    } catch (e) {
      el.querySelector("#inLista").innerHTML = `<div class="ad-vacio">No pudimos cargar el inventario. ${esc(A().msg(e))}</div>`;
    }
  }

  function pintarResumen() {
    const r = L.resumenStock(items, umbral);
    const kpi = (n, txt, val, sub, tono) => `<button type="button" class="ad-kpi ${tono}" data-n="${n}" aria-pressed="${filtro.nivel === n}">
      <span>${txt}</span><b>${val}</b><small>${sub}</small></button>`;
    el.querySelector("#inResumen").innerHTML =
      kpi("alerta", "Requieren reposición", r.agotado + r.bajo, `${r.agotado} agotada${r.agotado === 1 ? "" : "s"} · ${r.bajo} con stock bajo`, r.agotado + r.bajo ? "alerta" : "") +
      kpi("ok", "Disponibles", r.ok, `sobre ${umbral} unidades`, "") +
      kpi("sin_control", "No controlan stock", r.sin_control, "siempre disponibles", "") +
      kpi("todos", "Total variantes", r.total, "ver todas", "");
    const cnt = document.getElementById("cnt-inventario");
    if (cnt) { cnt.textContent = r.agotado + r.bajo; cnt.hidden = !(r.agotado + r.bajo); }
  }

  function pintarUmbral() {
    el.querySelector("#inUmbral").innerHTML = `Se considera <b>stock bajo</b> con ${umbral} unidades o menos.` +
      (app.puede("config.gestionar") ? ` <button type="button" class="ad-link sm" id="inUmbralEd">Cambiar</button>` : "");
  }

  function pintarLista() {
    const vs = L.filtrarInventario(items, filtro, umbral);
    const box = el.querySelector("#inLista");
    if (!vs.length) {
      box.innerHTML = `<div class="ad-vacio">${filtro.nivel === "alerta" && !filtro.q ? "Todo en orden: no hay variantes agotadas ni con stock bajo." : "Nada coincide con el filtro."}</div>`;
      return;
    }
    box.innerHTML = `
      <table class="ad-tabla ad-inv">
        <thead><tr><th>Producto</th><th>SKU</th><th>Estado</th><th class="num">Stock</th></tr></thead>
        <tbody>${vs.map((v) => {
          const n = L.nivelStock(v, umbral), nv = L.NIVELES_STOCK[n];
          return `<tr data-id="${esc(v.id)}">
            <td data-l="Producto"><b>${esc(v.producto)}</b><small>${esc(v.nombre)}${v.visible ? "" : " · oculto en tienda"}</small></td>
            <td data-l="SKU"><code>${esc(v.sku)}</code></td>
            <td data-l="Estado"><span class="ad-est ${nv.tono}">${nv.txt}</span></td>
            <td data-l="Stock" class="num">${v.controla_stock
              ? `<div class="ad-stock">
                  <button type="button" class="ad-btn sm ghost" data-d="-1" aria-label="Restar 1">−</button>
                  <input class="ad-inp" data-stock inputmode="numeric" value="${v.stock}" data-orig="${v.stock}" aria-label="Stock de ${esc(v.producto)} ${esc(v.nombre)}">
                  <button type="button" class="ad-btn sm ghost" data-d="1" aria-label="Sumar 1">+</button>
                  <button type="button" class="ad-btn sm" data-guardar hidden>Guardar</button>
                </div>`
              : `<span class="muted">—</span>`}</td>
          </tr>`; }).join("")}</tbody>
      </table>`;
  }

  /* Muestra "Guardar" solo si la cantidad cambió */
  function marcar(fila) {
    const inp = fila.querySelector("[data-stock]"), n = L.parseStock(inp.value);
    inp.classList.toggle("mal", n === null);
    fila.querySelector("[data-guardar]").hidden = n === null || String(n) === inp.dataset.orig;
  }

  async function guardar(fila) {
    const inp = fila.querySelector("[data-stock]"), btn = fila.querySelector("[data-guardar]");
    const n = L.parseStock(inp.value);
    if (n === null) return UI.toast("Escribe una cantidad entera entre 0 y 100.000.", "mal");
    if (String(n) === inp.dataset.orig) return;
    const v = items.find((x) => x.id === fila.dataset.id);
    const r = await UI.conCarga(btn, () => A().fijarStock(v.id, v.stock, n));
    if (!r.ok) { UI.toast(r.error, "mal"); if (r.recargar) await cargar(); return; }
    const antes = v.stock; v.stock = r.stock;
    UI.toast(`${v.producto} · ${v.nombre}: ${antes} → ${r.stock} unidades.`);
    pintarResumen(); pintarLista();
  }

  function editarUmbral() {
    UI.abrirModal(`
      <h2>Aviso de stock bajo</h2>
      <form class="ad-form" id="fUmbral" novalidate>
        <label class="full">Avisar cuando queden estas unidades o menos<input class="ad-inp" id="fuValor" inputmode="numeric" value="${umbral}"></label>
        <div class="ad-form-acc"><button class="ad-btn ghost" type="button" data-x>Cancelar</button><button class="ad-btn" type="submit" id="fuOk">Guardar</button></div>
      </form>`);
    document.querySelector("#adModalIn [data-x]").addEventListener("click", UI.cerrarModal);
    document.getElementById("fUmbral").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await UI.conCarga(document.getElementById("fuOk"), () => A().guardarUmbral(document.getElementById("fuValor").value));
      if (!r.ok) return UI.toast(r.error, "mal");
      umbral = r.valor; UI.cerrarModal(); pintarResumen(); pintarUmbral(); pintarLista();
      UI.toast(`Aviso de stock bajo: ${umbral} unidades o menos.`);
    });
  }

  window.AdminApp.SECCIONES.inventario = { montar, mostrar, recargar: cargar };
})();
