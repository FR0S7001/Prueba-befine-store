/* =====================================================================
   cuenta.js — Ingresar, crear cuenta, recuperar contraseña y panel del cliente
   Autenticación REAL con Supabase Auth a través de Befine.auth (data.js).
   Parámetros de URL:
     ?modo=registro|recuperar|nueva   abre esa vista
     ?volver=checkout.html            al ingresar, vuelve a esa página
   ===================================================================== */
(function () {
  const { Val, setError, clearError, autoLimpiar, cargando, GOOGLE_SVG } = window.BefineForms;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const url = new URLSearchParams(location.search);
  // Solo se permite volver a páginas propias (evita redirecciones a otros sitios)
  const volver = /^[\w-]+\.html$/.test(url.get("volver") || "") ? url.get("volver") : null;
  const VISTAS = ["fIngresar", "fRegistro", "fRecuperar", "fNueva", "vRevisa"];
  // Estado del pedido como lo ve el cliente (mismo enum estado_pedido de la base)
  const ESTADO_TXT = { pendiente_pago: "Pendiente de pago", pagado: "Pagado", en_preparacion: "En preparación",
    en_ruta: "En camino", entregado: "Entregado", cancelado: "Cancelado" };

  document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll("[data-google]").forEach((b) => { b.innerHTML = GOOGLE_SVG + b.textContent; });
    ["fIngresar", "fRegistro", "fRecuperar", "fNueva"].forEach((id) => autoLimpiar($(id)));

    // Evento de Supabase al abrir el enlace de recuperación → pedir nueva contraseña
    Befine.auth.onCambio((ev) => { if (ev === "PASSWORD_RECOVERY") mostrarAuth("fNueva"); });

    const sesion = await Befine.auth.sesion();
    $("vCarga").hidden = true;
    const modo = url.get("modo");
    if (modo === "nueva") return mostrarAuth("fNueva");
    if (sesion) { if (volver) return location.replace(volver); return pintarPanel(sesion); }
    mostrarAuth(modo === "registro" ? "fRegistro" : modo === "recuperar" ? "fRecuperar" : "fIngresar");
  });

  /* ================= Vistas ================= */
  function mostrarAuth(id) {
    $("vPanel").hidden = true; $("vAuth").hidden = false;
    VISTAS.forEach((v) => { $(v).hidden = v !== id; });
    const tabs = id === "fIngresar" || id === "fRegistro";
    $("accTabs").hidden = !tabs;
    document.querySelector(".acc-google").hidden = !tabs;
    $("tabIn").setAttribute("aria-selected", String(id === "fIngresar"));
    $("tabReg").setAttribute("aria-selected", String(id === "fRegistro"));
    const primero = $(id).querySelector("input"); if (primero && matchMedia("(hover:hover)").matches) setTimeout(() => primero.focus(), 60);
  }
  $("tabIn").addEventListener("click", () => mostrarAuth("fIngresar"));
  $("tabReg").addEventListener("click", () => mostrarAuth("fRegistro"));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-ir]"); if (!a) return;
    e.preventDefault(); mostrarAuth(a.dataset.ir === "recuperar" ? "fRecuperar" : "fIngresar");
    if (a.dataset.ir === "recuperar" && $("inEmail").value) $("recEmail").value = $("inEmail").value;
  });
  document.querySelectorAll("[data-google]").forEach((b) => b.addEventListener("click", async () => {
    const r = await Befine.auth.google(volver || "cuenta.html");
    if (!r.ok) window.toast(r.error);
  }));
  const msg = (el, texto, tipo) => { el.className = "aviso " + (tipo || ""); el.textContent = texto; el.hidden = !texto; };
  const alEntrar = async () => {
    if (volver) return location.replace(volver);
    const s = await Befine.auth.sesion();
    if (s) { pintarPanel(s); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  /* ================= Ingresar ================= */
  $("fIngresar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const em = $("inEmail"), cl = $("inClave"); let ok = true;
    if (!Val.email(em.value)) { setError(em, "Escribe un correo válido."); ok = false; }
    if (!cl.value) { setError(cl, "Escribe tu contraseña."); ok = false; }
    if (!ok) return;
    cargando($("inBtn"), true, "Ingresando…"); msg($("inMsg"), "");
    const r = await Befine.auth.ingresar(em.value.trim(), cl.value);
    cargando($("inBtn"), false);
    if (!r.ok) return msg($("inMsg"), r.error, "mal");
    alEntrar();
  });

  /* ================= Crear cuenta ================= */
  $("regTel").addEventListener("input", (e) => { e.target.value = Val.formatoTel(e.target.value); });
  /* Lista de requisitos de la contraseña, marcados en vivo */
  const pintarReqs = (input, lista) => {
    lista.innerHTML = Val.reqsClave(input.value).map((r) =>
      `<li class="${r.ok ? "ok" : ""}"><span aria-hidden="true">${r.ok ? "✓" : "•"}</span>${r.txt}</li>`).join("");
  };
  const errorClave = (input) => {
    const falta = Val.claveFaltante(input.value);
    if (falta.length) { setError(input, "Tu contraseña necesita: " + falta.join(", ") + "."); return false; }
    return true;
  };
  [["regClave", "regReqs"], ["nvClave", "nvReqs"]].forEach(([i, l]) => {
    pintarReqs($(i), $(l));
    $(i).addEventListener("input", () => pintarReqs($(i), $(l)));
  });
  $("regClave").addEventListener("input", (e) => {
    const n = e.target.value ? Math.max(1, Val.fuerza(e.target.value)) : 0;
    document.querySelector(".fuerza").dataset.n = n;
  });
  $("fRegistro").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = $("regNombre"), em = $("regEmail"), tel = $("regTel"), cl = $("regClave"), ac = $("regAcepto"); let ok = true;
    if (n.value.trim().length < 3) { setError(n, "Escribe tu nombre y apellido."); ok = false; }
    if (!Val.email(em.value)) { setError(em, "Escribe un correo válido."); ok = false; }
    if (tel.value && !Val.telefono(tel.value)) { setError(tel, "Celular de 9 dígitos que empiece con 9."); ok = false; }
    if (!errorClave(cl)) ok = false;
    if (!ac.checked) { msg($("regMsg"), "Para crear tu cuenta debes aceptar los términos y la política de privacidad.", "mal"); ok = false; }
    if (!ok) return;
    cargando($("regBtn"), true, "Creando cuenta…"); msg($("regMsg"), "");
    const r = await Befine.auth.registrar({ nombre: n.value.trim(), email: em.value.trim().toLowerCase(), password: cl.value,
      telefono: tel.value ? "+56" + Val.limpiarTel(tel.value) : null });
    cargando($("regBtn"), false);
    if (!r.ok) return msg($("regMsg"), r.error, "mal");
    if (r.confirmar) { $("revisaTxt").innerHTML = `Te enviamos un enlace a <b>${esc(em.value.trim())}</b> para activar tu cuenta.`; return mostrarAuth("vRevisa"); }
    alEntrar();
  });

  /* ================= Recuperar / nueva contraseña ================= */
  $("fRecuperar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const em = $("recEmail");
    if (!Val.email(em.value)) return setError(em, "Escribe un correo válido.");
    cargando($("recBtn"), true, "Enviando…");
    const r = await Befine.auth.recuperar(em.value.trim());
    cargando($("recBtn"), false);
    // Por seguridad no revelamos si el correo existe
    msg($("recMsg"), r.ok ? "Si el correo está registrado, te llegará un enlace en unos minutos. Revisa también spam." : r.error, r.ok ? "ok" : "mal");
  });
  $("fNueva").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cl = $("nvClave");
    if (!errorClave(cl)) return;
    cargando($("nvBtn"), true, "Guardando…");
    const r = await Befine.auth.nuevaClave(cl.value);
    cargando($("nvBtn"), false);
    if (!r.ok) return msg($("nvMsg"), r.error, "mal");
    msg($("nvMsg"), "¡Contraseña actualizada!", "ok");
    setTimeout(alEntrar, 900);
  });

  /* ================= Panel del cliente ================= */
  async function pintarPanel(s) {
    $("vAuth").hidden = true; $("vPanel").hidden = false;
    $("pcAvatar").textContent = (s.nombre || "?")[0].toUpperCase();
    $("pcHola").textContent = "Hola, " + (s.nombre || "").split(" ")[0];
    $("pcEmail").textContent = s.email;
    // Equipo de Befine (cualquier rol distinto de cliente): acceso al panel. El panel vuelve a
    // verificar los permisos y el RLS de Supabase bloquea cualquier acción no permitida.
    $("pcAdmin").hidden = !s.rol || s.rol === "cliente";
    $("pcPuntos").textContent = (s.puntos || 0).toLocaleString("es-CL");
    const fila = (k, v) => `<div><dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">—</span>'}</dd></div>`;
    $("pcDatos").innerHTML = fila("Nombre", [s.nombre, s.apellido].filter(Boolean).join(" ")) + fila("Correo", s.email) + fila("Celular", s.telefono) +
      (s.es_empresa ? fila("Empresa", s.razon_social) + fila("RUT", s.rut) : "");
    pintarPedidos(await Befine.misPedidos());
  }

  /* ================= Mis pedidos (HU-18) =================
     Lista → al abrir un pedido se carga su detalle desde el servidor (RLS) → "Volver a pedir"
     agrega los productos al carrito con el precio vigente. */
  const fmtFecha = (iso, op) => new Date(iso).toLocaleDateString("es-CL", op || { day: "numeric", month: "short", year: "numeric" });
  const detalles = new Map();   // detalle ya cargado por pedido (evita repetir consultas)

  function pintarPedidos(peds) {
    const box = $("pcPedidos");
    if (!peds.length) {
      box.innerHTML = `<div class="vacio-p">Aún no tienes pedidos.<br><a class="btn btn-primary" href="catalogo.html">Hacer mi primer pedido</a></div>`;
      return;
    }
    box.innerHTML = peds.map((p) => `
      <div class="ped">
        <button type="button" class="ped-cab" data-ped="${esc(p.id)}" aria-expanded="false" aria-controls="pd-${esc(p.id)}">
          <span class="num">#${p.numero}</span>
          <span class="fe">${fmtFecha(p.created_at)} · ${p.items.reduce((n, i) => n + i.cantidad, 0)} producto(s)</span>
          <span class="tot">${Befine.clp(p.total)}</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          <span class="est ${esc(p.estado)}">${ESTADO_TXT[p.estado] || "Pendiente de pago"}</span>
        </button>
        <div class="ped-det" id="pd-${esc(p.id)}" hidden></div>
      </div>`).join("");
    box.onclick = (e) => {
      const cab = e.target.closest(".ped-cab");
      if (cab) return alternarPedido(cab);
      const rep = e.target.closest("[data-repetir]");
      if (rep) repetirPedido(rep);
    };
  }

  async function alternarPedido(cab) {
    const id = cab.dataset.ped, panel = $("pd-" + id);
    const abrir = cab.getAttribute("aria-expanded") !== "true";
    cab.setAttribute("aria-expanded", String(abrir));
    panel.hidden = !abrir;
    if (!abrir || detalles.has(id)) return;
    panel.innerHTML = `<p class="pd-carga"><span class="spin" aria-hidden="true"></span>Cargando el detalle…</p>`;
    const d = await Befine.detallePedido(id);
    if (!d) { panel.innerHTML = `<div class="aviso mal">No pudimos cargar este pedido. Inténtalo de nuevo.</div>`; return; }
    detalles.set(id, d);
    panel.innerHTML = htmlDetalle(d);
  }

  function htmlDetalle(d) {
    const fila = (k, v, cls) => `<div${cls ? ` class="${cls}"` : ""}><dt>${k}</dt><dd>${v}</dd></div>`;
    const dir = d.direccion;
    const doc = d.documento === "factura" ? "Factura electrónica" : "Boleta electrónica";
    const enlace = d.boleta ? ` · <a href="${esc(d.boleta.url)}" target="_blank" rel="noopener">Descargar${d.boleta.folio ? " N° " + esc(d.boleta.folio) : ""}</a>` : "";
    return `
      <ul class="pd-items">${d.items.map((i) => `
        <li><span class="nm">${i.cantidad} × ${esc(i.nombre)}${i.variante && i.variante !== "Estándar" ? ` <small>${esc(i.variante)}</small>` : ""}</span>
          <span class="pr">${Befine.clp(i.subtotal)}</span></li>`).join("")}
      </ul>
      <dl class="pd-tot">
        ${fila("Subtotal", Befine.clp(d.subtotal))}
        ${fila("Despacho", d.despacho ? Befine.clp(d.despacho) : "Gratis")}
        ${d.descuento ? fila("Descuento", "−" + Befine.clp(d.descuento)) : ""}
        ${fila("Total", Befine.clp(d.total), "t")}
      </dl>
      <dl class="pd-info">
        ${d.fecha_entrega ? fila("Entrega", fmtFecha(d.fecha_entrega + "T12:00:00", { weekday: "long", day: "numeric", month: "long" })) : ""}
        ${dir ? fila("Dirección", `${esc(dir.calle)} ${esc(dir.numero || "")}${dir.depto ? ", " + esc(dir.depto) : ""}, ${esc(dir.comuna)}`) : ""}
        ${fila("Documento", doc + enlace)}
      </dl>
      <div class="pd-acc">
        <button type="button" class="btn btn-primary" data-repetir="${esc(d.id)}">Volver a pedir</button>
        <div class="pd-msg" role="status" aria-live="polite"></div>
      </div>`;
  }

  async function repetirPedido(btn) {
    const d = detalles.get(btn.dataset.repetir);
    const msgBox = btn.parentElement.querySelector(".pd-msg");
    if (!d) return;
    cargando(btn, true, "Revisando productos…");
    const r = await Befine.volverAPedir(d.items);
    cargando(btn, false);
    if (!r.ok) { msgBox.innerHTML = `<div class="aviso mal">${esc(r.error)}</div>`; return; }
    const antes = Store.count();   // "Volver a pedir" SUMA al carrito actual (no lo reemplaza): se le informa al cliente
    r.agregar.forEach((a) => Store.add({ ...a.item, grad: window.catGrad(a.categoria_slug) }, a.cantidad));
    if (!r.agregar.length) {
      msgBox.innerHTML = `<div class="aviso mal">Ninguno de estos productos está disponible por ahora.</div>`;
      return;
    }
    const partes = [`Agregamos ${r.agregar.reduce((n, a) => n + a.cantidad, 0)} producto(s) al carrito con el precio de hoy.`];
    if (antes) partes.push(`Tu carrito ya tenía ${antes} producto(s): ahora tiene ${Store.count()}.`);
    if (r.ajustados.length) partes.push("Con menos unidades por stock: " + r.ajustados.map((a) => `${esc(a.nombre)} (${a.cantidad})`).join(", ") + ".");
    if (r.noDisponibles.length) partes.push("No disponibles: " + r.noDisponibles.map(esc).join(", ") + ".");
    msgBox.innerHTML = `<div class="aviso ${r.noDisponibles.length || r.ajustados.length ? "" : "ok"}">
      <span>${partes.join(" ")} <a href="checkout.html">Ir a pagar →</a></span></div>`;
  }
  $("pcSalir").addEventListener("click", async () => { await Befine.auth.salir(); location.href = "index.html"; });
})();
