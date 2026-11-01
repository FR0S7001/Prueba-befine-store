/* =====================================================================
   admin-cupones.js — Sección "Cupones" del panel (RF-20)
   ---------------------------------------------------------------------
   - Lista de cupones con estado (activo, programado, pausado, vencido,
     agotado), condiciones y usos; filtros y búsqueda.
   - Crear y editar: campaña (fechas, usos totales, usos por cliente,
     compra mínima, productos) o bienvenida (solo 1ª compra, con cuenta).
   - Pausar / reactivar. Los cupones no se borran: quedan en los pedidos.
   Todas las reglas se validan en el servidor (crear_pedido, migración 04).
   Permiso: promociones.gestionar.
   ===================================================================== */
(function () {
  const L = window.AdminLogic;
  const { esc, ICONOS, UI, fecha } = window.AdminApp;
  const A = () => Befine.admin;
  const $m = (sel) => document.querySelector("#adModalIn " + sel);

  let el, cupones = [], productos = [], conReglas = true, filtro = { estado: "todos", q: "" };

  function montar(seccion) {
    el = seccion;
    el.innerHTML = `
      <div class="ad-head">
        <div><h1>Cupones</h1><p>Campañas y cupón de bienvenida. Las reglas se validan al comprar: no se pueden saltar desde el navegador.</p></div>
        <div class="acciones"><button class="ad-btn" type="button" id="cuNuevo">${ICONOS.mas}Nuevo cupón</button></div>
      </div>
      <div class="ad-aviso" id="cuAviso" hidden></div>
      <div class="ad-filtros">
        <label class="ad-buscar">${ICONOS.buscar}<input class="ad-inp" id="cuBuscar" type="search" placeholder="Código o descripción" aria-label="Buscar cupones"></label>
      </div>
      <div class="ad-chips" id="cuChips" role="tablist" aria-label="Filtrar por estado"></div>
      <div class="ad-card ad-lista" id="cuLista"><div class="ad-vacio"><span class="ad-spin"></span></div></div>`;

    let t;
    el.querySelector("#cuBuscar").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; pintar(); }, 150); });
    el.querySelector("#cuNuevo").addEventListener("click", () => formCupon(null));
    el.querySelector("#cuChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return; filtro.estado = b.dataset.f; pintar();
    });
    el.querySelector("#cuLista").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-acc]"); if (!b) return;
      const c = cupones.find((x) => x.id === b.dataset.id); if (!c) return;
      if (b.dataset.acc === "editar") formCupon(c);
      if (b.dataset.acc === "activar") await alternar(b, c);
      if (b.dataset.acc === "copiar") { try { await navigator.clipboard.writeText(c.codigo); UI.toast(`Código ${c.codigo} copiado.`); } catch (er) { UI.toast(c.codigo); } }
    });
  }

  async function mostrar() { await cargar(); }

  async function cargar() {
    try {
      [cupones, conReglas] = await Promise.all([A().listCupones(), A().reglasCupones()]);
      const aviso = el.querySelector("#cuAviso");
      aviso.hidden = conReglas;
      aviso.innerHTML = conReglas ? "" : `<b>Reglas de bienvenida no disponibles todavía.</b> Falta aplicar en Supabase la migración 04 (RF-20). Mientras tanto puedes crear cupones de campaña con fechas, usos totales, compra mínima y productos.`;
      pintar();
    } catch (e) {
      el.querySelector("#cuLista").innerHTML = `<div class="ad-vacio">No pudimos cargar los cupones. ${esc(A().msg(e))}</div>`;
    }
  }

  function pintar() {
    const hoy = L.diaLocal(new Date());
    const cuenta = { todos: cupones.length };
    Object.keys(L.ESTADOS_CUPON).forEach((k) => { cuenta[k] = cupones.filter((c) => L.estadoCupon(c, hoy) === k).length; });
    el.querySelector("#cuChips").innerHTML = [["todos", "Todos"], ...Object.entries(L.ESTADOS_CUPON).map(([k, v]) => [k, v.txt])]
      .map(([k, t]) => `<button type="button" role="tab" data-f="${k}" aria-selected="${filtro.estado === k}">${esc(t)} <span>${cuenta[k] || 0}</span></button>`).join("");

    const items = L.filtrarCupones(cupones, filtro, hoy);
    const box = el.querySelector("#cuLista");
    if (!items.length) {
      box.innerHTML = `<div class="ad-vacio">${cupones.length ? "Ningún cupón coincide con el filtro." : "Aún no hay cupones. Crea el primero con «Nuevo cupón»."}</div>`;
      return;
    }
    const vig = (c) => !c.vigente_desde && !c.vigente_hasta ? "Siempre"
      : c.vigente_desde && c.vigente_hasta ? `${fecha(c.vigente_desde)} al ${fecha(c.vigente_hasta)}`
      : c.vigente_desde ? `Desde ${fecha(c.vigente_desde)}` : `Hasta ${fecha(c.vigente_hasta)}`;
    box.innerHTML = `
      <table class="ad-tabla ad-cup">
        <thead><tr><th>Código</th><th>Descuento</th><th>Vigencia</th><th>Usos</th><th>Estado</th><th></th></tr></thead>
        <tbody>${items.map((c) => {
          const est = L.ESTADOS_CUPON[L.estadoCupon(c, hoy)];
          const pct = c.usos_maximos ? Math.min(100, Math.round((c.usos_actuales / c.usos_maximos) * 100)) : 0;
          return `<tr>
            <td data-l="Código"><button type="button" class="ad-codigo" data-acc="copiar" data-id="${esc(c.id)}" title="Copiar código">${esc(c.codigo)}</button>${c.descripcion ? `<small>${esc(c.descripcion)}</small>` : ""}</td>
            <td data-l="Descuento"><b>${esc(L.textoDescuento(c))}</b><small>${esc(L.condicionesCupon(c).join(" · ") || "sin condiciones")}</small></td>
            <td data-l="Vigencia">${vig(c)}</td>
            <td data-l="Usos">${c.usos_actuales}${c.usos_maximos ? ` de ${c.usos_maximos}<span class="ad-barra"><span style="width:${pct}%"></span></span>` : ""}</td>
            <td data-l="Estado"><span class="ad-est ${est.tono}">${est.txt}</span></td>
            <td class="num"><div class="ad-fila-acc">
              <button class="ad-btn sm ghost" type="button" data-acc="activar" data-id="${esc(c.id)}">${c.activo ? "Pausar" : "Activar"}</button>
              <button class="ad-btn sm ghost" type="button" data-acc="editar" data-id="${esc(c.id)}">Editar</button></div></td>
          </tr>`; }).join("")}</tbody>
      </table>`;
  }

  async function alternar(btn, c) {
    if (c.activo) {
      const ok = await UI.confirmar(`¿Pausar ${c.codigo}?`, "Deja de funcionar en la tienda hasta que lo reactives. Los pedidos que ya lo usaron no cambian.", "Pausar");
      if (!ok) return;
    }
    const r = await UI.conCarga(btn, () => A().activarCupon(c.id, !c.activo));
    if (!r.ok) return UI.toast(r.error, "mal");
    c.activo = !c.activo; pintar();
    UI.toast(c.activo ? `${c.codigo} activo.` : `${c.codigo} pausado.`);
  }

  /* ---------- Formulario ---------- */
  const campoErr = (id, msg) => {
    const i = $m("#" + id), e = $m(`[data-err="${id}"]`);
    if (i) i.classList.toggle("mal", !!msg); if (e) e.textContent = msg || "";
  };

  async function formCupon(c) {
    const nuevo = !c;
    if (!productos.length) { try { productos = await A().listCatalogo(); } catch (e) { productos = []; } }
    const v = c || { tipo: "porcentaje", activo: true, compra_minima: 0 };
    const bienvenida = !!v.solo_primera_compra;
    const sel = new Set(v.variantes || []);
    const listaProd = productos.map((p) => p.variantes.map((x) =>
      `<label class="chk"><input type="checkbox" value="${esc(x.id)}" ${sel.has(x.id) ? "checked" : ""}>${esc(p.nombre)}${x.nombre !== "Estándar" ? ` · ${esc(x.nombre)}` : ""}</label>`).join("")).join("");

    UI.abrirModal(`
      <h2>${nuevo ? "Nuevo cupón" : "Editar cupón " + esc(v.codigo)}</h2>
      <form class="ad-form" id="fCup" novalidate>
        ${conReglas ? `<div class="full ad-seg" role="radiogroup" aria-label="Tipo de cupón">
          <label><input type="radio" name="clase" value="campana" ${bienvenida ? "" : "checked"}><span><b>Campaña</b><small>Para todos, con fechas y límites</small></span></label>
          <label><input type="radio" name="clase" value="bienvenida" ${bienvenida ? "checked" : ""}><span><b>Bienvenida</b><small>Solo 1ª compra, con cuenta</small></span></label>
        </div>` : ""}
        <label>Código<input class="ad-inp" id="cCodigo" maxlength="30" value="${esc(v.codigo || "")}" placeholder="Ej: CYBER10" autocapitalize="characters"><span class="err" data-err="cCodigo"></span></label>
        <label>Tipo<select class="ad-inp" id="cTipo">
          <option value="porcentaje" ${v.tipo === "porcentaje" ? "selected" : ""}>Porcentaje (%)</option>
          <option value="monto_fijo" ${v.tipo === "monto_fijo" ? "selected" : ""}>Monto fijo ($)</option></select></label>
        <label>Descuento<input class="ad-inp" id="cValor" inputmode="numeric" value="${v.valor != null ? esc(v.valor) : ""}" placeholder="Ej: 10"><span class="err" data-err="cValor"></span></label>
        <label>Compra mínima <small>($; vacío = sin mínimo)</small><input class="ad-inp" id="cMin" inputmode="numeric" value="${v.compra_minima ? esc(v.compra_minima) : ""}" placeholder="Ej: 10.000"><span class="err" data-err="cMin"></span></label>
        <label>Desde <small>(opcional)</small><input class="ad-inp" id="cDesde" type="date" value="${esc(v.vigente_desde || "")}"></label>
        <label>Hasta <small>(opcional)</small><input class="ad-inp" id="cHasta" type="date" value="${esc(v.vigente_hasta || "")}"><span class="err" data-err="cHasta"></span></label>
        <label>Usos totales <small>(vacío = sin límite)</small><input class="ad-inp" id="cUsos" inputmode="numeric" value="${v.usos_maximos != null ? esc(v.usos_maximos) : ""}" placeholder="Ej: 100"><span class="err" data-err="cUsos"></span></label>
        ${conReglas ? `<label class="solo-campana">Usos por cliente <small>(vacío = sin límite)</small><input class="ad-inp" id="cPorCliente" inputmode="numeric" value="${v.usos_por_cliente != null && !bienvenida ? esc(v.usos_por_cliente) : ""}" placeholder="Ej: 1"><span class="err" data-err="cPorCliente"></span></label>
        <label class="chk solo-campana"><input type="checkbox" id="cCuenta" ${v.requiere_cuenta && !bienvenida ? "checked" : ""}>Solo clientes con cuenta</label>
        <p class="full ad-nota solo-bienvenida">Se aplica una sola vez por cliente y solo si la cuenta, el correo y el teléfono no tienen compras anteriores. Un invitado debe crear su cuenta para usarlo.</p>
        <label class="full">Nota interna <small>(opcional; el cliente no la ve)</small><input class="ad-inp" id="cDesc" maxlength="200" value="${esc(v.descripcion || "")}" placeholder="Ej: Campaña Cyber noviembre"></label>` : ""}
        <details class="full ad-prods" ${sel.size ? "open" : ""}>
          <summary>Aplica a: <b id="cAplica">${sel.size ? `${sel.size} producto${sel.size === 1 ? "" : "s"}` : "todo el carrito"}</b></summary>
          <p class="ad-nota">Marca productos solo si el descuento es para ellos. Sin marcar, aplica a todo el carrito.</p>
          <div class="ad-prods-lista" id="cProds">${listaProd || '<p class="ad-nota">No se pudo cargar el catálogo.</p>'}</div>
        </details>
        <label class="chk full"><input type="checkbox" id="cActivo" ${v.activo ? "checked" : ""}>Activo</label>
        <div class="ad-form-acc"><button class="ad-btn ghost" type="button" data-x>Cancelar</button><button class="ad-btn" type="submit" id="cOk">${nuevo ? "Crear cupón" : "Guardar"}</button></div>
      </form>`);

    const form = $m("#fCup");
    const claseActual = () => (form.querySelector('input[name="clase"]:checked') || {}).value || "campana";
    const sincClase = () => form.classList.toggle("es-bienvenida", claseActual() === "bienvenida");
    form.querySelectorAll('input[name="clase"]').forEach((r) => r.addEventListener("change", () => {
      sincClase();
      if (claseActual() === "bienvenida" && !$m("#cCodigo").value) $m("#cCodigo").value = "BIENVENIDA";
    }));
    sincClase();
    $m("#cProds").addEventListener("change", () => {
      const n = $m("#cProds").querySelectorAll("input:checked").length;
      $m("#cAplica").textContent = n ? `${n} producto${n === 1 ? "" : "s"}` : "todo el carrito";
    });
    $m("[data-x]").addEventListener("click", UI.cerrarModal);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const bien = conReglas && claseActual() === "bienvenida";
      const datos = {
        codigo: $m("#cCodigo").value, tipo: $m("#cTipo").value, valor: $m("#cValor").value, compra_minima: $m("#cMin").value,
        vigente_desde: $m("#cDesde").value, vigente_hasta: $m("#cHasta").value, usos_maximos: $m("#cUsos").value,
        usos_por_cliente: conReglas && !bien ? $m("#cPorCliente").value : "",
        requiere_cuenta: conReglas && !bien && $m("#cCuenta").checked, solo_primera_compra: bien,
        descripcion: conReglas ? $m("#cDesc").value : "", activo: $m("#cActivo").checked,
      };
      const er = L.validarCupon(datos, cupones, c && c.id);
      campoErr("cCodigo", er.codigo); campoErr("cValor", er.valor); campoErr("cMin", er.compra_minima);
      campoErr("cHasta", er.vigente_hasta); campoErr("cUsos", er.usos_maximos); campoErr("cPorCliente", er.usos_por_cliente);
      if (Object.keys(er).length) return;
      const vars = Array.from($m("#cProds").querySelectorAll("input:checked")).map((i) => i.value);
      const r = await UI.conCarga($m("#cOk"), () => A().guardarCupon(c && c.id, L.filaCupon(datos), vars, conReglas));
      if (!r.ok) { UI.toast(r.error, "mal"); if (r.id) { UI.cerrarModal(); await cargar(); } return; }
      UI.cerrarModal(); await cargar();
      UI.toast(nuevo ? `Cupón ${L.normalizarCodigo(datos.codigo)} creado.` : "Cambios guardados.");
    });
  }

  window.AdminApp.SECCIONES.cupones = { montar, mostrar, recargar: cargar };
})();
