/* =====================================================================
   admin-pedidos.js — Sección "Pedidos" del panel (RF-16)
   ---------------------------------------------------------------------
   - Indicadores del día y del mes, filtros por estado, por fecha de
     entrega (hoy, siguiente día hábil, esta semana o rango) y búsqueda.
   - Detalle del pedido en panel lateral: cliente (WhatsApp/llamar),
     dirección, productos, montos, documento e historial de estados.
   - Cambios de estado según el flujo (AdminLogic.TRANSICIONES), solo si
     el rol tiene pedidos.gestionar. El chofer (pedidos.ver) solo consulta.
   ===================================================================== */
(function () {
  const L = window.AdminLogic;
  const { esc, fecha, ICONOS, UI } = window.AdminApp;
  const A = () => Befine.admin;
  const clp = (n) => Befine.clp(n || 0);

  let el, app, lista = [], filtro = { estado: "activos", q: "", entrega: "todas", desde: "", hasta: "" }, cargado = false, timer = null;

  const badge = (e) => `<span class="ad-est ${(L.ESTADOS[e] || {}).tono || ""}">${esc(L.etiquetaEstado(e))}</span>`;
  const dir = (d) => d ? `${esc(d.calle)} ${esc(d.numero)}${d.depto ? ", depto " + esc(d.depto) : ""}` : "—";

  function montar(seccion, appCtx) {
    el = seccion; app = appCtx;
    el.innerHTML = `
      <div class="ad-head">
        <div><h1>Pedidos</h1><p>Últimos 90 días · se actualiza cada 2 minutos</p></div>
        <div class="acciones">
          <label class="ad-buscar">${ICONOS.buscar}<input class="ad-inp" id="pqBuscar" type="search" placeholder="N°, cliente, teléfono o comuna" aria-label="Buscar pedidos"></label>
          <button class="ad-btn ghost" type="button" id="pqRecargar" title="Actualizar">${ICONOS.recargar}<span>Actualizar</span></button>
        </div>
      </div>
      <div class="ad-kpis" id="pqKpis"></div>
      <div class="ad-chips" id="pqChips" role="tablist" aria-label="Filtrar por estado"></div>
      <div class="ad-entrega">
        <span class="ad-entrega-tit">Entrega</span>
        <div class="ad-chips sm" id="pqEntrega" role="tablist" aria-label="Filtrar por fecha de entrega"></div>
        <div class="ad-rango" id="pqRango" hidden>
          <label>Desde <input class="ad-inp" type="date" id="pqDesde"></label>
          <label>Hasta <input class="ad-inp" type="date" id="pqHasta"></label>
        </div>
        <small class="ad-rango-txt" id="pqRangoTxt" aria-live="polite"></small>
      </div>
      <div class="ad-card ad-lista" id="pqLista"><div class="ad-vacio"><span class="ad-spin"></span></div></div>`;

    let t;
    el.querySelector("#pqBuscar").addEventListener("input", (e) => {
      clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; pintarLista(); }, 150);
    });
    el.querySelector("#pqRecargar").addEventListener("click", (e) => UI.conCarga(e.currentTarget, cargar));
    el.querySelector("#pqChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      filtro.estado = b.dataset.f; pintarChips(); pintarLista();
    });
    el.querySelector("#pqEntrega").addEventListener("click", (e) => {
      const b = e.target.closest("[data-e]"); if (!b) return;
      filtro.entrega = b.dataset.e;
      el.querySelector("#pqRango").hidden = filtro.entrega !== "rango";
      if (filtro.entrega === "rango" && !filtro.desde && !filtro.hasta) el.querySelector("#pqDesde").focus();
      pintarChips(); pintarLista();
    });
    ["#pqDesde", "#pqHasta"].forEach((id) => el.querySelector(id).addEventListener("change", () => {
      filtro.desde = el.querySelector("#pqDesde").value; filtro.hasta = el.querySelector("#pqHasta").value;
      pintarChips(); pintarLista();
    }));
    el.querySelector("#pqLista").addEventListener("click", (e) => {
      const fila = e.target.closest("[data-id]"); if (fila) abrir(fila.dataset.id);
    });
    // Acciones dentro del panel lateral (cambiar estado)
    document.getElementById("adDrawerIn").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-estado]"); if (!b) return;
      await cambiar(b, b.dataset.id, b.dataset.de, b.dataset.estado);
    });
  }

  async function mostrar() {
    if (!cargado) await cargar();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && !el.hidden) cargar(true); }, 120000);
  }

  async function cargar(silencioso) {
    try {
      lista = await A().listPedidos();
      cargado = true;
      pintarKpis(); pintarChips(); pintarLista();
    } catch (e) {
      if (!silencioso) {
        el.querySelector("#pqLista").innerHTML = `<div class="ad-vacio">No pudimos cargar los pedidos. ${esc(A().msg(e))}</div>`;
        UI.toast(A().msg(e), "mal");
      }
    }
  }

  function pintarKpis() {
    const r = L.resumenPedidos(lista);
    const kpi = (txt, val, sub, tono) => `<div class="ad-kpi ${tono || ""}"><span>${txt}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    el.querySelector("#pqKpis").innerHTML =
      kpi("Pedidos de hoy", r.hoy) +
      kpi("Por preparar", r.porPreparar, r.entregaHoy ? `${r.entregaHoy} se entregan hoy` : "pagados sin despachar", r.porPreparar ? "alerta" : "") +
      kpi("En camino", r.enRuta) +
      kpi("Ventas del mes", clp(r.ventasMes), `${r.pedidosMes} pedido${r.pedidosMes === 1 ? "" : "s"} pagado${r.pedidosMes === 1 ? "" : "s"}`) +
      kpi("Esperando pago", r.pendientesPago, "Mercado Pago confirma solo");
    const cnt = document.getElementById("cnt-pedidos");
    if (cnt) { cnt.textContent = r.porPreparar; cnt.hidden = !r.porPreparar; }
  }

  const rango = () => L.rangoEntrega(filtro.entrega, new Date(), filtro.desde, filtro.hasta);

  function pintarChips() {
    const r = rango();
    // Los contadores por estado consideran el filtro de entrega elegido
    const c = L.contarPorEstado(L.filtrarPedidos(lista, { entrega: r }));
    const ops = [["activos", "Para gestionar"], ["todos", "Todos"], ...L.ORDEN_ESTADOS.map((e) => [e, L.etiquetaEstado(e)])];
    el.querySelector("#pqChips").innerHTML = ops.map(([k, t]) =>
      `<button type="button" role="tab" data-f="${k}" aria-selected="${filtro.estado === k}">${esc(t)} <span>${c[k] || 0}</span></button>`).join("");
    el.querySelector("#pqEntrega").innerHTML = Object.entries(L.OPCIONES_ENTREGA).map(([k, t]) =>
      `<button type="button" role="tab" data-e="${k}" aria-selected="${filtro.entrega === k}">${esc(t)}</button>`).join("");
    el.querySelector("#pqRangoTxt").textContent = r ? L.textoRango(r) : "";
  }

  function pintarLista() {
    const r = rango();
    const items = L.filtrarPedidos(lista, { estado: filtro.estado, q: filtro.q, entrega: r });
    // Con un filtro de entrega, la lista se ordena por fecha de entrega (para planificar el reparto)
    if (r) items.sort((a, b) => String(a.fecha_entrega).localeCompare(String(b.fecha_entrega)) || a.numero - b.numero);
    const box = el.querySelector("#pqLista");
    if (!items.length) {
      box.innerHTML = `<div class="ad-vacio">${lista.length ? "No hay pedidos con este filtro." : "Aún no hay pedidos en los últimos 90 días."}</div>`;
      return;
    }
    box.innerHTML = `
      <table class="ad-tabla ad-ped">
        <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Comuna</th><th>Entrega</th><th class="num">Total</th><th>Estado</th></tr></thead>
        <tbody>${items.map((p) => `
          <tr data-id="${esc(p.id)}" tabindex="0">
            <td data-l="N°"><button type="button" class="ad-link">#${esc(p.numero)}</button></td>
            <td data-l="Fecha">${fecha(p.created_at, true)}</td>
            <td data-l="Cliente"><b>${esc(p.contacto_nombre || "—")}</b><small>${p.unidades} producto${p.unidades === 1 ? "" : "s"}${p.tipo_documento === "factura" ? " · factura" : ""}</small></td>
            <td data-l="Comuna">${esc((p.direccion && p.direccion.comuna) || "—")}</td>
            <td data-l="Entrega">${fecha(p.fecha_entrega)}</td>
            <td data-l="Total" class="num">${clp(p.total)}</td>
            <td data-l="Estado">${badge(p.estado)}</td>
          </tr>`).join("")}</tbody>
      </table>`;
    box.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(tr.dataset.id); }));
  }

  /* ---------- Detalle ---------- */
  async function abrir(id) {
    UI.abrirDetalle(`<div class="ad-vacio"><span class="ad-spin"></span></div>`);
    let p;
    try { p = await A().getPedido(id); } catch (e) { return UI.abrirDetalle(`<div class="ad-vacio">${esc(A().msg(e))}</div>`); }
    if (!p) return UI.abrirDetalle(`<div class="ad-vacio">No encontramos el pedido.</div>`);

    const nom = (p.contacto_nombre || "").split(" ")[0] || "";
    const wa = L.linkWhatsApp(p.contacto_telefono, `Hola ${nom}, te escribimos de Befine por tu pedido #${p.numero}.`);
    const items = (p.detalle_pedido || []).map((d) => {
      const v = d.variante || {}, pr = v.producto || {};
      return `<li><span class="q">${d.cantidad}×</span><span class="n">${esc(pr.nombre || "Producto")}${v.nombre && v.nombre !== "Estándar" ? ` <small>${esc(v.nombre)}</small>` : ""}<small>${esc(v.sku || "")} · ${clp(d.precio_unitario)} c/u</small></span><b>${clp(d.subtotal)}</b></li>`;
    }).join("");
    const hist = (p.historial_pedido || []).map((h) =>
      `<li><b>${esc(L.etiquetaEstado(h.estado_nuevo))}</b><span>${fecha(h.created_at, true)}</span>${h.nota ? `<small>${esc(h.nota)}</small>` : ""}</li>`).join("");

    const gestiona = app.puede("pedidos.gestionar");
    const sig = gestiona ? L.siguientesEstados(p.estado) : [];
    const acciones = sig.map((e) => `<button type="button" class="ad-btn ${e === "cancelado" ? "peligro" : e === "entregado" ? "ok" : ""}"
        data-id="${esc(p.id)}" data-de="${esc(p.estado)}" data-estado="${e}">${esc(L.ACCION_ESTADO[e] || L.etiquetaEstado(e))}</button>`).join("");
    const nota = p.estado === "pendiente_pago"
      ? `<p class="ad-nota">El pedido pasa a <b>Pagado</b> automáticamente cuando Mercado Pago confirma el pago. Un pedido sin pagar no sale a reparto.</p>` : "";

    UI.abrirDetalle(`
      <div class="ad-det-head"><h2>Pedido #${esc(p.numero)}</h2>${badge(p.estado)}<small>Creado el ${fecha(p.created_at, true)}</small></div>
      ${acciones || nota ? `<div class="ad-det-acc">${acciones}${nota}</div>` : ""}

      <section class="ad-det"><h3>Cliente</h3>
        <p><b>${esc(p.contacto_nombre || "—")}</b><br>${esc(L.telefonoVisible(p.contacto_telefono))} · ${esc(p.contacto_email || "—")}</p>
        <div class="ad-det-bot">
          ${wa ? `<a class="ad-btn sm ok" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.whatsapp}WhatsApp</a>` : ""}
          ${p.contacto_telefono ? `<a class="ad-btn sm ghost" href="tel:+${esc(String(p.contacto_telefono).replace(/\D/g, ""))}">Llamar</a>` : ""}
        </div>
      </section>

      <section class="ad-det"><h3>Entrega</h3>
        <p>${dir(p.direccion)}<br>${esc((p.direccion && p.direccion.comuna) || "")}${p.zona && p.zona.nombre !== (p.direccion && p.direccion.comuna) ? ` · zona ${esc(p.zona.nombre)}` : ""}</p>
        ${p.direccion && p.direccion.referencia ? `<p class="ad-ref">Referencia: ${esc(p.direccion.referencia)}</p>` : ""}
        <p>Fecha de entrega: <b>${fecha(p.fecha_entrega)}</b></p>
        ${p.notas ? `<p class="ad-ref">Nota del cliente: ${esc(p.notas)}</p>` : ""}
      </section>

      <section class="ad-det"><h3>Productos</h3>
        <ul class="ad-items">${items || "<li>Sin productos</li>"}</ul>
        <dl class="ad-tot">
          <div><dt>Subtotal</dt><dd>${clp(p.subtotal)}</dd></div>
          <div><dt>Despacho</dt><dd>${p.costo_despacho ? clp(p.costo_despacho) : "Gratis"}</dd></div>
          ${p.descuento_cupon ? `<div><dt>Cupón ${p.cupon ? esc(p.cupon.codigo) : ""}</dt><dd>−${clp(p.descuento_cupon)}</dd></div>` : ""}
          <div class="t"><dt>Total</dt><dd>${clp(p.total)}</dd></div>
        </dl>
      </section>

      <section class="ad-det"><h3>Documento</h3>
        <p>${p.tipo_documento === "factura"
          ? `Factura · RUT ${esc(p.doc_rut)}<br>${esc(p.doc_razon_social)} · ${esc(p.doc_giro)}`
          : "Boleta electrónica"}</p>
      </section>

      <section class="ad-det"><h3>Historial</h3><ol class="ad-hist">${hist || "<li>Sin movimientos</li>"}</ol></section>`);
  }

  async function cambiar(btn, id, de, a) {
    if (a === "cancelado") {
      const p = lista.find((x) => x.id === id) || {};
      const ok = await UI.confirmar(`¿Cancelar el pedido #${p.numero || ""}?`,
        "El pedido queda cerrado y no se podrá reactivar. Si usó un cupón, ese uso se libera para el cliente.",
        "Sí, cancelar", true);
      if (!ok) return;
    }
    const r = await UI.conCarga(btn, () => A().cambiarEstado(id, de, a));
    if (!r.ok) UI.toast(r.error, "mal"); else UI.toast(`Pedido actualizado: ${L.etiquetaEstado(a)}.`);
    await cargar(true);
    if (r.ok || r.recargar) abrir(id);
  }

  window.AdminApp.SECCIONES.pedidos = { montar, mostrar };
})();
