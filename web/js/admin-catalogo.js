/* =====================================================================
   admin-catalogo.js — Sección "Catálogo y precios" del panel (RF-17)
   ---------------------------------------------------------------------
   - Lista de productos (también los ocultos) con sus variantes y precio.
   - Crear y editar productos y variantes; mostrar u ocultar en la tienda.
   - Editar precios en la misma lista (Enter o salir del campo guarda).
   Permisos: catalogo.gestionar (productos y variantes) y
   precios.gestionar (precios). Cada uno habilita solo su parte.
   ===================================================================== */
(function () {
  const L = window.AdminLogic;
  const { esc, ICONOS, UI } = window.AdminApp;
  const A = () => Befine.admin;
  const $m = (sel) => document.querySelector("#adModalIn " + sel);

  let el, app, productos = [], categorias = [], filtro = { categoria: "", q: "", estado: "todos" };
  const puedeCat = () => app.puede("catalogo.gestionar");
  const puedePre = () => app.puede("precios.gestionar");
  const todasVariantes = () => productos.flatMap((p) => p.variantes);

  function montar(seccion, appCtx) {
    el = seccion; app = appCtx;
    el.innerHTML = `
      <div class="ad-head">
        <div><h1>Catálogo y precios</h1><p>Lo que ves aquí es lo que se publica en la tienda. Los precios rigen desde el próximo pedido.</p></div>
        <div class="acciones">${puedeCat() ? `<button class="ad-btn" type="button" id="ctNuevo">${ICONOS.mas}Nuevo producto</button>` : ""}</div>
      </div>
      <div class="ad-filtros">
        <label class="ad-buscar">${ICONOS.buscar}<input class="ad-inp" id="ctBuscar" type="search" placeholder="Nombre, variante o SKU" aria-label="Buscar en el catálogo"></label>
        <select class="ad-inp ad-sel" id="ctCat" aria-label="Categoría"><option value="">Todas las categorías</option></select>
        <select class="ad-inp ad-sel" id="ctEst" aria-label="Visibilidad">
          <option value="todos">Visibles y ocultos</option><option value="visibles">Solo visibles</option><option value="ocultos">Solo ocultos</option>
        </select>
      </div>
      <div id="ctLista"><div class="ad-vacio"><span class="ad-spin"></span></div></div>`;

    let t;
    el.querySelector("#ctBuscar").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; pintar(); }, 150); });
    el.querySelector("#ctCat").addEventListener("change", (e) => { filtro.categoria = e.target.value; pintar(); });
    el.querySelector("#ctEst").addEventListener("change", (e) => { filtro.estado = e.target.value; pintar(); });
    const nuevo = el.querySelector("#ctNuevo"); if (nuevo) nuevo.addEventListener("click", () => formProducto(null));

    const lista = el.querySelector("#ctLista");
    lista.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-acc]"); if (!b) return;
      const p = productos.find((x) => x.id === b.dataset.p);
      const v = p && p.variantes.find((x) => x.id === b.dataset.v);
      if (b.dataset.acc === "editar") formProducto(p);
      if (b.dataset.acc === "variante") formVariante(p, v || null);
      if (b.dataset.acc === "visible") await alternarVisible(b, p);
    });
    // Precio: guarda con Enter o al salir del campo, solo si cambió
    lista.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-precio]")) e.target.blur(); });
    lista.addEventListener("focusout", (e) => { if (e.target.matches("[data-precio]")) guardarPrecio(e.target); });
  }

  async function mostrar() { await cargar(); }   // siempre fresco: el stock pudo cambiar en Inventario

  async function cargar() {
    try {
      [productos, categorias] = await Promise.all([A().listCatalogo(), A().listCategorias()]);
      const sel = el.querySelector("#ctCat");
      sel.innerHTML = `<option value="">Todas las categorías</option>` +
        categorias.map((c) => `<option value="${c.id}"${String(c.id) === filtro.categoria ? " selected" : ""}>${esc(c.nombre)}</option>`).join("");
      pintar();
    } catch (e) {
      el.querySelector("#ctLista").innerHTML = `<div class="ad-vacio">No pudimos cargar el catálogo. ${esc(A().msg(e))}</div>`;
    }
  }

  function pintar() {
    const items = L.filtrarCatalogo(productos, filtro);
    const box = el.querySelector("#ctLista");
    if (!items.length) { box.innerHTML = `<div class="ad-card ad-vacio">${productos.length ? "Ningún producto coincide con el filtro." : "Aún no hay productos."}</div>`; return; }
    box.innerHTML = items.map((p) => `
      <article class="ad-card ad-prod${p.activo ? "" : " oculto"}">
        <header>
          <div class="ad-prod-img">${p.imagen_url ? `<img src="${esc(p.imagen_url)}" alt="" loading="lazy">` : ICONOS.inventario}</div>
          <div class="ad-prod-t"><h2>${esc(p.nombre)}</h2><small>${esc(p.categoria)} · ${p.variantes.length} variante${p.variantes.length === 1 ? "" : "s"}</small></div>
          <span class="ad-est ${p.activo ? "ok" : "fin"}">${p.activo ? "Visible en tienda" : "Oculto"}</span>
          ${puedeCat() ? `<div class="ad-prod-acc">
            <button class="ad-btn sm ghost" type="button" data-acc="visible" data-p="${esc(p.id)}">${p.activo ? "Ocultar" : "Publicar"}</button>
            <button class="ad-btn sm ghost" type="button" data-acc="editar" data-p="${esc(p.id)}">Editar</button></div>` : ""}
        </header>
        <table class="ad-var">
          <thead><tr><th>Variante</th><th>SKU</th><th class="num">Precio venta</th><th class="num">Stock</th><th></th></tr></thead>
          <tbody>${p.variantes.map((v) => `
            <tr class="${v.activo ? "" : "oculto"}">
              <td data-l="Variante"><b>${esc(v.nombre)}</b>${v.activo ? "" : ' <span class="ad-est fin">Oculta</span>'}</td>
              <td data-l="SKU"><code>${esc(v.sku)}</code></td>
              <td data-l="Precio" class="num">${puedePre()
                ? `<label class="ad-precio"><span>$</span><input class="ad-inp" inputmode="numeric" data-precio data-v="${esc(v.id)}" data-orig="${v.precio == null ? "" : v.precio}"
                    value="${v.precio == null ? "" : v.precio.toLocaleString("es-CL")}" placeholder="Sin precio" aria-label="Precio de ${esc(p.nombre)} ${esc(v.nombre)}"></label>`
                : (v.precio == null ? '<span class="ad-falta">Sin precio</span>' : Befine.clp(v.precio))}</td>
              <td data-l="Stock" class="num">${v.controla_stock ? v.stock : '<span class="muted">No controla</span>'}</td>
              <td class="num">${puedeCat() ? `<button class="ad-btn sm ghost" type="button" data-acc="variante" data-p="${esc(p.id)}" data-v="${esc(v.id)}">Editar</button>` : ""}</td>
            </tr>`).join("") || `<tr><td colspan="5" class="ad-falta">Sin variantes: el producto no se puede comprar.</td></tr>`}
          </tbody>
        </table>
        ${puedeCat() ? `<button class="ad-btn sm ghost ad-addvar" type="button" data-acc="variante" data-p="${esc(p.id)}">${ICONOS.mas}Agregar variante</button>` : ""}
      </article>`).join("");
  }

  /* ---------- Precio en línea ---------- */
  async function guardarPrecio(inp) {
    const orig = inp.dataset.orig, val = inp.value.trim();
    const n = L.parsePrecio(val);
    if (val === "" && orig === "") return;
    if (n !== null && String(n) === orig) { inp.value = n.toLocaleString("es-CL"); return; }
    if (n === null) { inp.classList.add("mal"); return UI.toast("Escribe un precio válido en pesos, sin decimales.", "mal"); }
    inp.classList.remove("mal"); inp.disabled = true;
    const r = await A().guardarPrecio(inp.dataset.v, n);
    inp.disabled = false;
    if (!r.ok) { inp.classList.add("mal"); return UI.toast(r.error, "mal"); }
    inp.dataset.orig = String(n); inp.value = n.toLocaleString("es-CL");
    const v = todasVariantes().find((x) => x.id === inp.dataset.v); if (v) v.precio = n;
    inp.classList.add("guardado"); setTimeout(() => inp.classList.remove("guardado"), 1200);
    UI.toast(`Precio actualizado: ${Befine.clp(n)}.`);
  }

  async function alternarVisible(btn, p) {
    if (p.activo) {
      const ok = await UI.confirmar(`¿Ocultar "${p.nombre}"?`, "Deja de mostrarse en la tienda y no se puede comprar. Los pedidos existentes no cambian.", "Ocultar");
      if (!ok) return;
    } else if (!p.variantes.some((v) => v.activo && v.precio != null)) {
      return UI.toast("Antes de publicarlo agrega una variante activa con precio.", "mal");
    }
    const r = await UI.conCarga(btn, () => A().guardarProducto({ ...p, activo: !p.activo }));
    if (!r.ok) return UI.toast(r.error, "mal");
    p.activo = !p.activo; pintar();
    UI.toast(p.activo ? "Producto publicado en la tienda." : "Producto oculto.");
  }

  /* ---------- Formularios ---------- */
  const campoErr = (id, msg) => {
    const i = $m("#" + id), e = $m(`[data-err="${id}"]`);
    if (i) i.classList.toggle("mal", !!msg); if (e) e.textContent = msg || "";
  };
  const opcionesCat = (sel) => categorias.map((c) => `<option value="${c.id}"${String(c.id) === String(sel) ? " selected" : ""}>${esc(c.nombre)}</option>`).join("");

  function formProducto(p) {
    const nuevo = !p;
    UI.abrirModal(`
      <h2>${nuevo ? "Nuevo producto" : "Editar producto"}</h2>
      <form class="ad-form" id="fProd" novalidate>
        <label class="full">Nombre<input class="ad-inp" id="fpNombre" maxlength="120" value="${esc(p ? p.nombre : "")}" placeholder="Ej: Recarga Bidón 20 Litros"><span class="err" data-err="fpNombre"></span></label>
        <label>Categoría<select class="ad-inp" id="fpCat"><option value="">Elegir…</option>${opcionesCat(p && p.categoria_id)}</select><span class="err" data-err="fpCat"></span></label>
        <label class="chk" style="align-self:end"><input type="checkbox" id="fpActivo" ${!p || p.activo ? "checked" : ""}>Visible en la tienda</label>
        <label class="full">Descripción <small>(opcional)</small><textarea class="ad-inp" id="fpDesc" rows="3" maxlength="1000">${esc(p ? p.descripcion : "")}</textarea><span class="err" data-err="fpDesc"></span></label>
        <label class="full">Imagen <small>(enlace https; opcional)</small><input class="ad-inp" id="fpImg" value="${esc(p ? p.imagen_url : "")}" placeholder="https://…"><span class="err" data-err="fpImg"></span></label>
        ${nuevo ? `
        <p class="full ad-sub">Primera variante <small>(puedes agregar más después)</small></p>
        <label>Variante<input class="ad-inp" id="fvNombre" value="Estándar" maxlength="60"><span class="err" data-err="fvNombre"></span></label>
        <label>SKU<input class="ad-inp" id="fvSku" placeholder="BEF-…" maxlength="40" autocapitalize="characters"><span class="err" data-err="fvSku"></span></label>
        <label>Precio de venta<input class="ad-inp" id="fvPrecio" inputmode="numeric" placeholder="Ej: 3.000"><span class="err" data-err="fvPrecio"></span></label>
        <label>Stock inicial<input class="ad-inp" id="fvStock" type="number" min="0" step="1" value="0"></label>` : ""}
        <div class="ad-form-acc"><button class="ad-btn ghost" type="button" data-x>Cancelar</button><button class="ad-btn" type="submit" id="fpOk">${nuevo ? "Crear producto" : "Guardar"}</button></div>
      </form>`);
    $m("[data-x]").addEventListener("click", UI.cerrarModal);
    $m("#fProd").addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = { id: p && p.id, nombre: $m("#fpNombre").value, categoria_id: $m("#fpCat").value, activo: $m("#fpActivo").checked,
        descripcion: $m("#fpDesc").value, imagen_url: $m("#fpImg").value };
      const ep = L.validarProducto(datos);
      campoErr("fpNombre", ep.nombre); campoErr("fpCat", ep.categoria_id); campoErr("fpDesc", ep.descripcion); campoErr("fpImg", ep.imagen_url);
      let ev = {}, varDatos = null;
      if (nuevo) {
        varDatos = { nombre: $m("#fvNombre").value, sku: $m("#fvSku").value, precio: $m("#fvPrecio").value, stock: $m("#fvStock").value, controla_stock: true };
        ev = L.validarVariante(varDatos, todasVariantes(), null);
        campoErr("fvNombre", ev.nombre); campoErr("fvSku", ev.sku); campoErr("fvPrecio", ev.precio);
      }
      if (Object.keys(ep).length || Object.keys(ev).length) return;
      const r = await UI.conCarga($m("#fpOk"), () => nuevo ? A().crearProductoCompleto(datos, varDatos) : A().guardarProducto(datos));
      if (!r.ok) { UI.toast(r.error, "mal"); if (r.id) { UI.cerrarModal(); await cargar(); } return; }
      UI.cerrarModal(); await cargar();
      UI.toast(nuevo ? "Producto creado." : "Cambios guardados.");
    });
  }

  function formVariante(p, v) {
    const nueva = !v;
    UI.abrirModal(`
      <h2>${nueva ? "Agregar variante" : "Editar variante"}</h2>
      <p class="ad-sub" style="margin:-8px 0 14px">${esc(p.nombre)}</p>
      <form class="ad-form" id="fVar" novalidate>
        <label>Nombre<input class="ad-inp" id="fvNombre" maxlength="60" value="${esc(v ? v.nombre : "")}" placeholder="Ej: Con bidón Befine"><span class="err" data-err="fvNombre"></span></label>
        <label>SKU<input class="ad-inp" id="fvSku" maxlength="40" value="${esc(v ? v.sku : "")}" placeholder="BEF-…" autocapitalize="characters"><span class="err" data-err="fvSku"></span></label>
        ${nueva ? `
        <label>Precio de venta<input class="ad-inp" id="fvPrecio" inputmode="numeric" placeholder="Ej: 3.000"><span class="err" data-err="fvPrecio"></span></label>
        <label>Stock inicial<input class="ad-inp" id="fvStock" type="number" min="0" step="1" value="0"></label>` : ""}
        <label class="chk"><input type="checkbox" id="fvActivo" ${!v || v.activo ? "checked" : ""}>Disponible para comprar</label>
        <label class="chk"><input type="checkbox" id="fvCtrl" ${!v || v.controla_stock ? "checked" : ""}>Controlar stock</label>
        ${nueva ? "" : `<p class="full ad-sub">El precio se edita en la lista y el stock en Inventario.</p>`}
        <div class="ad-form-acc"><button class="ad-btn ghost" type="button" data-x>Cancelar</button><button class="ad-btn" type="submit" id="fvOk">${nueva ? "Agregar" : "Guardar"}</button></div>
      </form>`);
    $m("[data-x]").addEventListener("click", UI.cerrarModal);
    $m("#fVar").addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = { id: v && v.id, producto_id: p.id, nombre: $m("#fvNombre").value, sku: $m("#fvSku").value,
        activo: $m("#fvActivo").checked, controla_stock: $m("#fvCtrl").checked };
      if (nueva) { datos.precio = $m("#fvPrecio").value; datos.stock = $m("#fvStock").value; }
      const ev = L.validarVariante(datos, todasVariantes(), v && v.id);
      campoErr("fvNombre", ev.nombre); campoErr("fvSku", ev.sku); campoErr("fvPrecio", ev.precio);
      if (Object.keys(ev).length) return;
      const r = await UI.conCarga($m("#fvOk"), async () => {
        const r1 = await A().guardarVariante(datos);
        if (!r1.ok || !nueva) return r1;
        const r2 = await A().guardarPrecio(r1.id, datos.precio);
        return r2.ok ? r1 : { ...r2, creada: true, error: r2.error + " La variante se creó sin precio: escríbelo en la lista." };
      });
      if (!r.ok) { UI.toast(r.error, "mal"); if (r.creada) { UI.cerrarModal(); await cargar(); } return; }
      UI.cerrarModal(); await cargar();
      UI.toast(nueva ? "Variante agregada." : "Cambios guardados.");
    });
  }

  window.AdminApp.SECCIONES.catalogo = { montar, mostrar, recargar: cargar };
})();
