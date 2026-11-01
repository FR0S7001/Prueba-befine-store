/* =====================================================================
   checkout.js — Pago en una sola página (compra como invitado o con cuenta)
   Objetivo: comprar en menos de 1 minuto. Autocompleta con la cuenta o con
   los datos recordados, calcula despacho por comuna, agenda días hábiles,
   valida en línea (RUT, celular, correo) y al final ofrece crear cuenta.
   Todo pasa por el puente window.Befine (data.js): la UI no toca la BD.
   ===================================================================== */
(function () {
  const { Val, setError, clearError, autoLimpiar, cargando, GOOGLE_SVG } = window.BefineForms;
  const $ = (id) => document.getElementById(id);
  const clp = (n) => Befine.clp(n);
  const KEY_DATOS = "befine_datos";            // datos recordados (solo en este dispositivo)
  const KEY_PAGO = "befine_pago";              // pedido en pago (solo esta pestaña): para la confirmación al volver de Mercado Pago
  const ESPERAS_MS = [1500, 2500, 4000, 6000, 8000, 10000];   // reintentos (~32 s) mientras el webhook confirma el pago
  const fmtDia = (d, op) => d.toLocaleDateString("es-CL", op || { weekday: "long", day: "numeric", month: "long" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let sesion = null, cobertura = null, dias = null, doc = "boleta", fechaAgendada = null, enviando = false;
  let cupon = null;          // { codigo, descuento } revisado por el servidor (revisar_cupon)
  let reintento = null;      // { firma, pedido }: si Mercado Pago falla, se reintenta con el MISMO pedido (no se duplica)

  document.addEventListener("DOMContentLoaded", async () => {
    const form = $("coForm");
    autoLimpiar(form);

    [sesion, cobertura] = await Promise.all([Befine.auth.sesion(), Befine.getCobertura()]);
    dias = Befine.diasEntrega();

    pintarSesion();
    pintarComunas();
    pintarEntrega();
    precargar();
    const vuelta = Befine.vueltaPago(location.search);
    if (vuelta) mostrarVuelta(vuelta);          // volvió desde Mercado Pago: se muestra el resultado del pago
    Store.subscribe((items) => { pintarResumen(items); revisarCuponDeNuevo(); });   // el resumen se actualiza solo al cambiar cantidades

    /* ---------- Formato en vivo ---------- */
    $("coTel").addEventListener("input", (e) => { e.target.value = Val.formatoTel(e.target.value); });
    $("coRut").addEventListener("input", (e) => { e.target.value = Val.formatoRut(e.target.value); });
    $("coComuna").addEventListener("change", () => { pintarResumen(Store.items()); pintarHintComuna(); });

    /* ---------- Boleta / factura ---------- */
    document.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => {
      doc = b.dataset.doc;
      document.querySelectorAll("[data-doc]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $("coFactura").hidden = doc !== "factura";
      if (doc === "factura") setTimeout(() => $("coRut").focus(), 50);
    }));

    /* ---------- Tipo de entrega ---------- */
    form.querySelectorAll('input[name="entrega"]').forEach((r) => r.addEventListener("change", () => {
      const ag = form.entrega.value === "agendada";
      $("coDias").hidden = !ag;
      if (ag) $("coDias").classList.add("despliega");
    }));

    /* ---------- Cupón de descuento ---------- */
    $("coCuponAbrir").addEventListener("click", () => {
      $("coCuponAbrir").hidden = true; $("coCuponAbrir").setAttribute("aria-expanded", "true");
      $("coCuponForm").hidden = false; $("coCuponInp").focus();
    });
    $("coCuponBtn").addEventListener("click", () => aplicarCupon($("coCuponInp").value));
    $("coCuponInp").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); aplicarCupon(e.target.value); } });
    $("coCuponInp").addEventListener("input", () => { $("coCuponMsg").hidden = true; });
    $("coCuponQuitar").addEventListener("click", () => quitarCupon());

    form.addEventListener("submit", (e) => { e.preventDefault(); pagar(); });
  });

  /* ================= Pintado ================= */
  function pintarSesion() {
    const box = $("coSesion");
    if (sesion) {
      box.innerHTML = `<div class="aviso ok"><span class="avatar">${esc((sesion.nombre || "?")[0].toUpperCase())}</span>
        <span class="t">Comprando como <b>${esc(sesion.nombre)}</b> · ${esc(sesion.email)}</span></div>`;
    } else {
      box.innerHTML = `<div class="aviso"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
        <span class="t">Compra como invitado, <b>sin crear cuenta</b>. ¿Ya tienes una? Ingresa y completamos tus datos.</span>
        <a class="link" href="cuenta.html?volver=checkout.html">Ingresar →</a></div>`;
    }
  }

  function pintarComunas() {
    const sel = $("coComuna");
    sel.innerHTML = `<option value="">Elige tu comuna…</option>` + cobertura.comunas.map((c) =>
      `<option value="${esc(c.comuna)}">${esc(c.comuna)} — ${c.costo === 0 ? "envío gratis" : clp(c.costo)}</option>`).join("");
    pintarHintComuna();
  }
  function pintarHintComuna() {
    const c = cobertura.comunas.find((x) => x.comuna === $("coComuna").value);
    const wa = `https://wa.me/${Befine.contacto.whatsapp}?text=${encodeURIComponent("Hola Befine, ¿llegan a mi comuna?")}`;
    $("coComunaHint").innerHTML = c
      ? (c.costo === 0 ? "Despacho gratis en tu comuna." : `Despacho ${clp(c.costo)} · gratis desde ${clp(cobertura.envioGratisDesde)}.`)
      : `¿No aparece tu comuna? <a href="${wa}" target="_blank" rel="noopener" style="text-decoration:underline">Escríbenos por WhatsApp</a>.`;
  }

  function pintarEntrega() {
    $("coFechaStd").textContent = "Llega el " + fmtDia(dias.estandar);
    fechaAgendada = dias.agendables[0];
    const box = $("coDias");
    box.innerHTML = dias.agendables.map((d, i) => `<button type="button" class="dia" data-i="${i}" aria-pressed="${i === 0}"
      aria-label="${fmtDia(d)}"><span class="dw">${fmtDia(d, { weekday: "short" }).replace(".", "")}</span><span class="dd">${d.getDate()}</span><span class="dm">${fmtDia(d, { month: "short" }).replace(".", "")}</span></button>`).join("");
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".dia"); if (!b) return;
      box.querySelectorAll(".dia").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      fechaAgendada = dias.agendables[+b.dataset.i];
    });
  }

  function totales(items) {
    const sub = items.reduce((n, i) => n + i.precio * i.cantidad, 0);
    const envio = Befine.costoDespacho(cobertura, $("coComuna").value, sub);   // envío gratis según el subtotal (igual que el servidor)
    const desc = cupon ? Math.min(cupon.descuento, sub) : 0;
    return { sub, envio, desc, total: Math.max(sub - desc, 0) + (envio || 0) };
  }

  /* ================= Cupón ================= */
  // El servidor calcula el descuento con sus precios y reglas; aquí solo se muestra.
  async function aplicarCupon(codigo, silencioso) {
    const cod = String(codigo || "").trim().toUpperCase();
    const msg = $("coCuponMsg");
    if (!cod) { msg.textContent = "Escribe el código del cupón."; msg.hidden = false; return; }
    const btn = $("coCuponBtn");
    if (!silencioso) cargando(btn, true, "Revisando…");
    const r = await Befine.revisarCupon(cod, Store.items());
    if (!silencioso) cargando(btn, false);
    if (!r.valido) {
      cupon = null; pintarCupon();
      mostrarMsgCupon(silencioso ? `Quitamos el cupón ${cod}: ${r.mensaje}` : r.mensaje);
      pintarResumen(Store.items());
      return;
    }
    cupon = { codigo: r.codigo || cod, descuento: r.descuento };
    msg.hidden = true; pintarCupon(); pintarResumen(Store.items());
    if (!silencioso) window.toast(`Cupón ${cupon.codigo} aplicado: −${clp(cupon.descuento)}`);
  }
  function mostrarMsgCupon(texto) {
    const msg = $("coCuponMsg");
    msg.textContent = texto;
    // Cupón para clientes con cuenta: ofrecer crearla o ingresar sin perder el carrito
    if (!sesion && /con cuenta/i.test(texto)) {
      msg.insertAdjacentHTML("beforeend", ` <a href="cuenta.html?modo=registro&volver=checkout.html">Crear cuenta</a> · <a href="cuenta.html?volver=checkout.html">Ingresar</a>`);
    }
    msg.hidden = false;
    $("coCuponAbrir").hidden = true; $("coCuponForm").hidden = false;
  }
  function quitarCupon() {
    cupon = null; pintarCupon(); pintarResumen(Store.items());
    $("coCuponInp").value = ""; $("coCuponForm").hidden = false; $("coCuponInp").focus();
  }
  function pintarCupon() {
    $("coCuponOk").hidden = !cupon;
    if (cupon) { $("coCuponCod").textContent = cupon.codigo; $("coCuponForm").hidden = true; $("coCuponAbrir").hidden = true; }
  }
  // Si cambia el carrito, el descuento puede cambiar (mínimos, productos): se vuelve a revisar
  let tRevisar;
  function revisarCuponDeNuevo() {
    if (!cupon) return;
    clearTimeout(tRevisar);
    tRevisar = setTimeout(() => { if (cupon && Store.items().length) aplicarCupon(cupon.codigo, true); }, 400);
  }

  function pintarResumen(items) {
    const vacio = !items.length, enResultado = !$("coOk").hidden;   // con el resultado del pago a la vista, el formulario no se muestra
    $("coVacio").hidden = !vacio || enResultado;
    $("coForm").hidden = vacio || enResultado;
    $("coBar").hidden = vacio || enResultado;
    if (vacio) return;

    $("coItems").innerHTML = items.map((i) => `
      <div class="r-item">
        <div class="th" style="background:${i.grad || window.catGrad()}"></div>
        <div><div class="nm">${esc(i.nombre)}</div>${i.variante && i.variante !== "Estándar" ? `<div class="vr">${esc(i.variante)}</div>` : ""}
          <div class="qty" role="group" aria-label="Cantidad de ${esc(i.nombre)}"><button type="button" data-dec="${i.variante_id}" aria-label="Quitar uno">−</button><span>${i.cantidad}</span><button type="button" data-inc="${i.variante_id}" aria-label="Agregar uno">+</button></div></div>
        <div class="pr">${clp(i.precio * i.cantidad)}<button type="button" data-del="${i.variante_id}">Quitar</button></div>
      </div>`).join("");
    $("coItems").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const it = Store.items().find((x) => x.variante_id === (b.dataset.inc || b.dataset.dec || b.dataset.del)); if (!it) return;
      if (b.dataset.inc) Store.setQty(it.variante_id, it.cantidad + 1);
      if (b.dataset.dec) Store.setQty(it.variante_id, it.cantidad - 1);
      if (b.dataset.del) Store.remove(it.variante_id);
    };

    const t = totales(items);
    $("coSub").textContent = clp(t.sub);
    $("coDescFila").hidden = !t.desc;
    $("coDesc").textContent = "−" + clp(t.desc);
    const env = $("coEnvio");
    env.classList.toggle("gratis", t.envio === 0);
    env.textContent = t.envio === null ? "Elige tu comuna" : t.envio === 0 ? "Gratis" : clp(t.envio);
    $("coTotal").textContent = clp(t.total);
    $("coBarTotal").textContent = clp(t.total);
    const txtPagar = `Pagar ${clp(t.total)}`;
    if (!enviando) { $("coPagar").textContent = txtPagar; $("coBarPagar").textContent = txtPagar; }

    // Meta de envío gratis: solo si la comuna tiene costo
    const c = cobertura.comunas.find((x) => x.comuna === $("coComuna").value);
    const meta = $("coEnvioMeta");
    if (c && c.costo > 0) {
      const falta = Math.max(0, cobertura.envioGratisDesde - t.sub);
      meta.hidden = false;
      $("coEnvioBar").style.width = Math.min(100, (t.sub / cobertura.envioGratisDesde) * 100) + "%";
      $("coEnvioTxt").textContent = falta > 0 ? `Te faltan ${clp(falta)} para envío gratis` : "¡Tienes envío gratis!";
    } else meta.hidden = true;
  }

  /* ================= Datos ================= */
  function precargar() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(KEY_DATOS) || "{}"); } catch (e) {}
    const f = $("coForm");
    const set = (name, v) => { if (v && !f[name].value) f[name].value = v; };
    if (sesion) { set("nombre", [sesion.nombre, sesion.apellido].filter(Boolean).join(" ")); set("email", sesion.email); set("telefono", Val.formatoTel(sesion.telefono || "")); }
    set("nombre", d.nombre); set("email", d.email); set("telefono", d.telefono);
    set("calle", d.calle); set("numero", d.numero); set("depto", d.depto); set("referencia", d.referencia);
    if (d.comuna && cobertura.comunas.some((c) => c.comuna === d.comuna)) f.comuna.value = d.comuna;
    if (sesion && sesion.es_empresa) { document.querySelector('[data-doc="factura"]').click(); set("rut", sesion.rut); set("razon_social", sesion.razon_social); set("giro", sesion.giro); }
    pintarHintComuna();
  }

  function validar() {
    const f = $("coForm"); const errs = [];
    const req = (el, ok, msg) => { if (!ok) { setError(el, msg); errs.push(el); } else clearError(el); };
    req(f.nombre, f.nombre.value.trim().length >= 3, "Escribe tu nombre y apellido.");
    req(f.telefono, Val.telefono(f.telefono.value), "Ingresa un celular válido: 9 dígitos que empiezan con 9.");
    req(f.email, Val.email(f.email.value), "Revisa tu correo (ej: nombre@correo.cl).");
    req(f.comuna, !!f.comuna.value, "Elige tu comuna.");
    req(f.calle, f.calle.value.trim().length >= 2, "Escribe la calle.");
    req(f.numero, f.numero.value.trim().length >= 1, "Falta el número.");
    if (doc === "factura") {
      req(f.rut, Val.rut(f.rut.value), "RUT no válido. Revisa el dígito verificador.");
      req(f.razon_social, f.razon_social.value.trim().length >= 2, "Escribe la razón social.");
      req(f.giro, f.giro.value.trim().length >= 2, "Escribe el giro.");
    }
    if (errs.length) { errs[0].focus({ preventScroll: true }); errs[0].scrollIntoView({ behavior: "smooth", block: "center" }); }
    return !errs.length;
  }

  async function pagar() {
    if (enviando || !validar()) return;
    const f = $("coForm"), items = Store.items(), t = totales(items);
    const agendada = f.entrega.value === "agendada";
    const payload = {
      contacto: { nombre: f.nombre.value.trim(), email: f.email.value.trim().toLowerCase(), telefono: "+56" + Val.limpiarTel(f.telefono.value) },
      direccion: { calle: f.calle.value.trim(), numero: f.numero.value.trim(), depto: f.depto.value.trim() || null, comuna: f.comuna.value,
        region: "Región Metropolitana", referencia: f.referencia.value.trim() || null },
      entrega: { tipo: agendada ? "agendada" : "estandar", fecha: Befine.isoFecha(agendada ? fechaAgendada : dias.estandar) },
      documento: doc === "factura" ? { tipo: "factura", rut: Val.formatoRut(f.rut.value), razon_social: f.razon_social.value.trim(), giro: f.giro.value.trim() } : { tipo: "boleta" },
      items: items.map((i) => ({ variante_id: i.variante_id, nombre: i.nombre, variante: i.variante, cantidad: i.cantidad, precio_unitario: i.precio })),
      subtotal: t.sub, costo_despacho: t.envio || 0, total: t.total, perfil_id: sesion ? sesion.id : null,
      cupon: cupon ? cupon.codigo : null,
    };

    // Recordar datos (solo en este dispositivo) para que la próxima compra sea aún más rápida
    try {
      if ($("coRecordar").checked) localStorage.setItem(KEY_DATOS, JSON.stringify({ nombre: payload.contacto.nombre, email: payload.contacto.email,
        telefono: f.telefono.value, comuna: f.comuna.value, calle: f.calle.value, numero: f.numero.value, depto: f.depto.value, referencia: f.referencia.value }));
      else localStorage.removeItem(KEY_DATOS);
    } catch (e) {}

    enviando = true;
    const btns = [$("coPagar"), $("coBarPagar")];
    // Si Mercado Pago falló y el cliente no cambió nada, se reintenta con el MISMO pedido (no se duplica).
    const firma = JSON.stringify(payload);
    const pedido = reintento && reintento.firma === firma ? reintento.pedido : await crearPedido(payload, btns);
    if (!pedido) return;
    reintento = { firma, pedido };
    btns.forEach((b) => textoCargando(b, "Conectando con Mercado Pago…"));
    const p = await Befine.pagar(pedido);
    if (!p.ok) {
      btns.forEach((b) => cargando(b, false)); enviando = false;
      window.toast(`${p.error} Tu pedido #${pedido.numero} quedó guardado: presiona Pagar para reintentar.`);
      return;
    }
    guardarPagoEnCurso(pedido);
    window.location.assign(p.url);              // los botones siguen "cargando" mientras se abre Mercado Pago
  }

  // Muestra "cargando" en el botón, o solo cambia el texto si ya está cargando (conserva el texto original).
  function textoCargando(btn, texto) {
    if (btn.classList.contains("is-loading")) btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${texto}`;
    else cargando(btn, true, texto);
  }

  // Crea el pedido en el servidor (crear_pedido). Devuelve el pedido o null si no se pudo.
  async function crearPedido(payload, btns) {
    btns.forEach((b) => cargando(b, true, "Creando pedido…"));
    const r = await Befine.crearPedido(payload);
    if (r.ok) return r.pedido;
    btns.forEach((b) => cargando(b, false)); enviando = false;
    // Si el servidor rechazó el cupón (ej: el correo o teléfono ya compraron), se quita y el cliente
    // puede pagar sin descuento: no perdemos la venta.
    if (cupon && /cup[oó]n/i.test(r.error || "")) {
      const cod = cupon.codigo; cupon = null; pintarCupon(); pintarResumen(Store.items());
      mostrarMsgCupon(`Quitamos el cupón ${cod}: ${r.error}`);
      $("coCupon").scrollIntoView({ behavior: "smooth", block: "center" });
      window.toast("Revisa el nuevo total y vuelve a pagar.");
      return null;
    }
    window.toast(r.error || "No pudimos crear el pedido. Inténtalo de nuevo.");
    return null;
  }

  /* ================= Vuelta desde Mercado Pago ================= */
  // Se guarda lo necesario para mostrar la confirmación al volver (solo en esta pestaña).
  // Los montos y el estado se vuelven a leer desde el servidor: esto es solo para mostrar.
  function guardarPagoEnCurso(p) {
    try {
      sessionStorage.setItem(KEY_PAGO, JSON.stringify({ id: p.id, numero: p.numero, contacto: p.contacto,
        direccion: p.direccion, documento: p.documento, entrega: p.entrega }));
    } catch (e) {}
  }
  function leerPagoEnCurso(id) {
    try { const p = JSON.parse(sessionStorage.getItem(KEY_PAGO) || "null"); return p && p.id === id ? p : null; }
    catch (e) { return null; }
  }

  // Une el pedido del servidor (estado y montos reales) con los datos guardados de la compra.
  function armarPedido(srv, g) {
    g = g || {};
    return {
      id: srv.id, numero: srv.numero, total: srv.total, descuento_cupon: srv.descuento_cupon,
      contacto: g.contacto || { nombre: srv.contacto_nombre || "", email: srv.contacto_email || "" },
      direccion: g.direccion || null,
      documento: g.documento || { tipo: srv.tipo_documento || "boleta" },
      entrega: { ...(g.entrega || {}), fecha: srv.fecha_entrega || (g.entrega && g.entrega.fecha) || null },
    };
  }

  // El webhook de Mercado Pago confirma el pago en el servidor; aquí solo se consulta el estado.
  async function esperarConfirmacion(id) {
    let p = await Befine.estadoPedido(id);
    for (const ms of ESPERAS_MS) {
      if (!p || p.estado !== "pendiente_pago") break;
      await new Promise((r) => setTimeout(r, ms));
      p = await Befine.estadoPedido(id);
    }
    return p;
  }

  async function mostrarVuelta(v) {
    const guardado = leerPagoEnCurso(v.pedido);
    const ok = $("coOk");
    $("coForm").hidden = true; $("coBar").hidden = true; $("coVacio").hidden = true;
    document.querySelector(".co-head .trust").hidden = true;
    ok.hidden = false;
    if (v.estado === "error") { pintarPagoFallido(v.pedido, guardado); return; }

    // Pago aprobado o en proceso: el pedido ya existe, el carrito no se necesita.
    Store.clear();
    document.querySelector(".co-head h1").textContent = "Confirmando tu pago";
    ok.innerHTML = `<div class="sheet co-espera"><span class="spin" aria-hidden="true"></span>
      <h2>Confirmando tu pago…</h2>
      <p class="lead">${guardado ? `Pedido #${guardado.numero}. ` : ""}Esto toma solo unos segundos; no cierres esta página.</p></div>`;

    const srv = await esperarConfirmacion(v.pedido);
    if (!srv) {
      document.querySelector(".co-head h1").textContent = "Volviste desde Mercado Pago";
      ok.innerHTML = `<div class="sheet"><h2>No pudimos revisar tu pedido</h2>
        <p class="lead">Desde este navegador no tenemos acceso al pedido${guardado ? ` #${guardado.numero}` : ""}. Si pagaste, el pago queda registrado igual.</p>
        <div class="acciones">${botonWhatsApp(guardado && guardado.numero)}</div></div>`;
      return;
    }
    if (srv.estado === "cancelado") {
      document.querySelector(".co-head h1").textContent = "Pedido cancelado";
      ok.innerHTML = `<div class="sheet"><h2>El pedido #${srv.numero} fue cancelado</h2>
        <p class="lead">Si tienes dudas sobre un cobro, escríbenos y lo revisamos.</p>
        <div class="acciones"><a class="btn btn-primary" href="catalogo.html">Ver productos</a>${botonWhatsApp(srv.numero)}</div></div>`;
      return;
    }
    const pagado = Befine.pedidoPagado(srv.estado);
    const aviso = v.estado === "pendiente"
      ? "Mercado Pago está procesando tu pago. Tu pedido se confirmará apenas se apruebe."
      : "Recibimos tu pago y lo estamos confirmando con Mercado Pago. Puede tardar unos minutos.";
    confirmar(armarPedido(srv, guardado), pagado, aviso);
  }

  function pintarPagoFallido(id, g) {
    document.querySelector(".co-head h1").textContent = "El pago no se completó";
    $("coOk").innerHTML = `<div class="sheet">
        <h2>Mercado Pago no aprobó el pago</h2>
        <p class="lead">Tu pedido${g ? ` #${g.numero}` : ""} quedó guardado. Puedes intentarlo de nuevo con otro medio de pago.</p>
        <div class="acciones">
          <button type="button" class="btn btn-primary" id="coReintentar">Reintentar pago</button>
          ${botonWhatsApp(g && g.numero)}
        </div>
      </div>`;
    $("coReintentar").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      cargando(btn, true, "Conectando con Mercado Pago…");
      const p = await Befine.pagar(id);
      if (!p.ok) { cargando(btn, false); window.toast(p.error); return; }
      window.location.assign(p.url);
    });
  }

  function botonWhatsApp(numero) {
    const txt = numero ? "Hola Befine, consulta por mi pedido #" + numero : "Hola Befine, tengo una consulta por mi pago";
    return `<a class="btn btn-ghost" href="https://wa.me/${Befine.contacto.whatsapp}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">¿Dudas? WhatsApp</a>`;
  }

  /* ================= Confirmación ================= */
  // pagado: el servidor ya confirmó el pago · aviso: texto mientras el pago se confirma
  function confirmar(pedido, pagado, aviso) {
    const fecha = pedido.entrega && pedido.entrega.fecha ? new Date(pedido.entrega.fecha + "T12:00:00") : null;
    const d = pedido.direccion;
    const nombre = esc(((pedido.contacto && pedido.contacto.nombre) || "").split(" ")[0]);
    const doc = pedido.documento || { tipo: "boleta" };
    $("coForm").hidden = true; $("coBar").hidden = true;
    document.querySelector(".co-head h1").textContent = pagado ? "¡Gracias por tu compra!" : "Estamos confirmando tu pago";
    document.querySelector(".co-head .trust").hidden = true;
    const ok = $("coOk");
    ok.hidden = false;
    ok.innerHTML = `
      <div class="sheet">
        ${pagado
          ? `<svg class="okmark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg>`
          : `<svg class="okmark espera" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M26 13v14l9 5"/></svg>`}
        <h2>${pagado ? `¡Pedido #${pedido.numero} confirmado!` : `Pedido #${pedido.numero} recibido`}</h2>
        <p class="lead">${pagado
          ? `Gracias${nombre ? ", " + nombre : ""}. Tu pago fue aprobado y ya estamos preparando tu pedido.`
          : esc(aviso || "Estamos confirmando tu pago.")}</p>
        <dl class="det">
          ${fecha ? `<div><dt>Entrega</dt><dd>${fmtDia(fecha)}${pedido.entrega.tipo === "agendada" ? " (agendada)" : ""}</dd></div>` : ""}
          ${d ? `<div><dt>Dirección</dt><dd>${esc(d.calle)} ${esc(d.numero)}${d.depto ? ", " + esc(d.depto) : ""}, ${esc(d.comuna)}</dd></div>` : ""}
          <div><dt>Documento</dt><dd>${doc.tipo === "factura" ? "Factura" + (doc.razon_social ? " · " + esc(doc.razon_social) : "") : "Boleta electrónica"}</dd></div>
          ${pedido.descuento_cupon ? `<div><dt>Descuento</dt><dd>−${clp(pedido.descuento_cupon)}</dd></div>` : ""}
          <div><dt>${pagado ? "Total pagado" : "Total"}</dt><dd>${clp(pedido.total)}</dd></div>
        </dl>
        <div class="acciones">
          <a class="btn btn-primary" href="catalogo.html">Seguir comprando</a>
          ${botonWhatsApp(pedido.numero)}
        </div>
      </div>
      ${sesion || !pedido.contacto.email ? "" : `
      <div class="sheet crear" id="coCrear">
        <h3>Guarda tus datos en 1 paso</h3>
        <p class="hint">Crea tu cuenta con los datos de esta compra: solo elige una contraseña.</p>
        <ul class="beneficios"><li>Tu próxima compra en segundos</li><li>Acumula puntos y canjéalos por recargas</li><li>Sigue tus pedidos y descarga tus boletas</li></ul>
        <form class="fila" id="coCrearForm" novalidate>
          <div class="fld"><label for="coClave">Contraseña</label>
            <div class="inp-wrap"><input class="inp" id="coClave" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" minlength="8">
            <button type="button" class="eye" data-ver-clave="coClave" aria-label="Mostrar contraseña" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>
          <button class="btn btn-primary btn-lg" id="coCrearBtn">Crear mi cuenta</button>
        </form>
        <div class="divider">o</div>
        <button type="button" class="btn-google" id="coGoogle">${GOOGLE_SVG}Continuar con Google</button>
        <p class="hint" style="margin-top:10px">Al crear tu cuenta aceptas la <a href="#" style="text-decoration:underline">Política de privacidad</a>.</p>
      </div>`}`;
    Store.clear();
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (!sesion && $("coCrearForm")) {
      $("coCrearForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const inp = $("coClave"), btn = $("coCrearBtn");
        if ((inp.value || "").length < 8) { setError(inp, "Usa al menos 8 caracteres."); inp.focus(); return; }
        clearError(inp); cargando(btn, true, "Creando…");
        const r = await Befine.auth.registrar({ nombre: pedido.contacto.nombre, email: pedido.contacto.email, password: inp.value, telefono: pedido.contacto.telefono || "" });
        cargando(btn, false);
        const box = $("coCrear");
        if (!r.ok) { setError(inp, r.error); return; }
        box.innerHTML = `<div class="aviso ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
          <span>${r.confirmar ? `¡Listo! Te enviamos un correo a <b>${esc(pedido.contacto.email)}</b> para activar tu cuenta.` : "¡Cuenta creada! Tu próxima compra será en segundos."}</span></div>`;
      });
      $("coGoogle").addEventListener("click", async () => {
        const r = await Befine.auth.google("cuenta.html");
        if (!r.ok) window.toast(r.error);
      });
    }
  }
})();
