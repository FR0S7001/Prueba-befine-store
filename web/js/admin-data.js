/* =====================================================================
   admin-data.js — Datos del panel de administración (Supabase)
   ---------------------------------------------------------------------
   Extiende el "puente" de data.js con Befine.admin. La interfaz del panel
   (admin.js) solo habla con estos métodos, igual que la tienda con Befine.
   Requiere: local-client.js → data.js → admin-logic.js → este archivo.

   Seguridad: usa la misma clave pública que la tienda. Lo que un usuario
   puede leer o modificar lo decide el RLS de Supabase según su rol y
   permisos (tiene_permiso(), migración 01). Si alguien abre admin.html sin
   permisos, la interfaz no muestra nada y la base rechaza cualquier cambio.
   ===================================================================== */
(function () {
  const L = window.AdminLogic;

  /* Errores de Supabase/PostgREST → mensaje claro para el dueño */
  function msgAdmin(e) {
    const m = String((e && (e.message || e.details)) || e || "");
    const low = m.toLowerCase();
    if (e && e.code === "42501" || low.includes("row-level security") || low.includes("permission denied"))
      return "No tienes permiso para hacer este cambio.";
    if (e && e.code === "23505" || low.includes("duplicate key")) return "Ya existe un registro con ese valor (revisa el SKU o el nombre).";
    if (e && e.code === "23514" || low.includes("check constraint")) return "Algún valor no es válido (revisa números negativos o vacíos).";
    if (low.includes("failed to fetch") || low.includes("network")) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
    if (low.includes("jwt") && low.includes("expired")) return "Tu sesión expiró. Vuelve a ingresar.";
    return "No pudimos guardar el cambio. Inténtalo de nuevo.";
  }

  Befine.admin = {
    msg: msgAdmin,

    /* Quién está usando el panel → { usuario, perfil:{id,nombre,rol,activo}, permisos[] }
       usuario = null si no hay sesión (o es un invitado anónimo). */
    async contexto() {
      const { data } = await sb.auth.getSession();
      const u = data && data.session && data.session.user;
      if (!u || u.is_anonymous) return { usuario: null, perfil: null, permisos: [] };
      const { data: pf } = await sb.from("perfiles").select("id,nombre,apellido,rol,activo").eq("id", u.id).maybeSingle();
      if (!pf || !pf.activo) return { usuario: u, perfil: pf || null, permisos: [] };
      let filas = [];
      if (pf.rol !== "admin" && pf.rol !== "cliente") {
        const { data: rp } = await sb.from("rol_permisos").select("rol_id,permiso").eq("rol_id", pf.rol);
        filas = rp || [];
      }
      return { usuario: u, perfil: pf, permisos: L.permisosDe(pf.rol, filas) };
    },

    /* Nombre visible del rol (tabla roles) */
    async nombreRol(rol) {
      const { data } = await sb.from("roles").select("nombre").eq("id", rol).maybeSingle();
      return (data && data.nombre) || rol;
    },

    /* ================= PEDIDOS (RF-16) ================= */
    /* Pedidos de los últimos `dias` (RLS: requiere pedidos.ver). La dirección llega por la
       política direcciones_reparto. Se limita a 500 para que el panel cargue rápido. */
    async listPedidos({ dias = 90 } = {}) {
      const desde = new Date(Date.now() - dias * 864e5).toISOString();
      const { data, error } = await sb.from("pedidos")
        .select("id,numero,estado,total,subtotal,costo_despacho,descuento_cupon,created_at,fecha_entrega," +
                "contacto_nombre,contacto_telefono,contacto_email,tipo_documento," +
                "direccion:direcciones(calle,numero,depto,comuna,referencia),detalle_pedido(cantidad)")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []).map((p) => ({
        ...p,
        unidades: (p.detalle_pedido || []).reduce((n, d) => n + (d.cantidad || 0), 0),
      }));
    },

    /* Detalle completo de un pedido: productos, historial de estados y cupón */
    async getPedido(id) {
      const { data, error } = await sb.from("pedidos")
        .select("*,direccion:direcciones(calle,numero,depto,comuna,referencia)," +
                "zona:zonas_despacho(nombre),cupon:cupones(codigo)," +
                "detalle_pedido(cantidad,precio_unitario,subtotal,variante:variantes_producto(sku,nombre,producto:productos(nombre)))," +
                "historial_pedido(estado_anterior,estado_nuevo,nota,created_at)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (data && data.historial_pedido) data.historial_pedido.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return data;
    },

    /* Cambia el estado si el flujo lo permite. Se exige que el pedido siga en el estado
       que vio el usuario (.eq estado actual): si otra persona lo cambió antes, no se pisa.
       El trigger de la base registra el cambio en historial_pedido con quién y cuándo. */
    async cambiarEstado(id, actual, nuevo) {
      if (!L.puedeCambiar(actual, nuevo)) return { ok: false, error: "Ese cambio de estado no está permitido." };
      const { data, error } = await sb.from("pedidos")
        .update({ estado: nuevo }).eq("id", id).eq("estado", actual).select("id,estado");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se aplicó: el pedido cambió mientras lo revisabas o no tienes permiso. Se recargó con su estado actual.", recargar: true };
      return { ok: true, estado: data[0].estado };
    },

    /* ================= CATÁLOGO Y PRECIOS (RF-17) ================= */
    async listCategorias() {
      const { data, error } = await sb.from("categorias").select("id,nombre,slug").order("id");
      if (error) throw error;
      return data || [];
    },

    /* Todos los productos, también los ocultos (RLS: los inactivos solo los ve quien tiene
       catalogo.gestionar). Cada variante trae su precio de venta (nivel retail). */
    async listCatalogo() {
      const nivel = await _nivelRetail();
      const { data, error } = await sb.from("productos")
        .select("id,categoria_id,nombre,descripcion,imagen_url,activo,created_at,categorias(nombre)," +
                "variantes_producto(id,producto_id,sku,nombre,stock,controla_stock,activo,precios_variante(nivel_precio_id,precio))")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((p) => ({
        id: p.id, categoria_id: p.categoria_id, categoria: (p.categorias && p.categorias.nombre) || "Sin categoría",
        nombre: p.nombre, descripcion: p.descripcion, imagen_url: p.imagen_url, activo: p.activo,
        variantes: (p.variantes_producto || [])
          .sort((a, b) => (a.sku || "").localeCompare(b.sku || ""))
          .map((v) => {
            const pr = (v.precios_variante || []).find((x) => x.nivel_precio_id === nivel);
            return { id: v.id, producto_id: v.producto_id, sku: v.sku, nombre: v.nombre, stock: v.stock,
              controla_stock: v.controla_stock, activo: v.activo, precio: pr ? pr.precio : null };
          }),
      }));
    },

    /* Crea o edita un producto. Solo se envían columnas propias de la tabla. */
    async guardarProducto(p) {
      const fila = {
        nombre: String(p.nombre || "").trim(),
        descripcion: String(p.descripcion || "").trim() || null,
        categoria_id: Number(p.categoria_id) || null,
        imagen_url: String(p.imagen_url || "").trim() || null,
        activo: !!p.activo,
      };
      const q = p.id
        ? sb.from("productos").update(fila).eq("id", p.id).select("id")
        : sb.from("productos").insert(fila).select("id");
      const { data, error } = await q;
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: revisa que tengas permiso para editar el catálogo." };
      return { ok: true, id: data[0].id };
    },

    /* Crea o edita una variante. El stock inicial solo se fija al crearla
       (después se ajusta desde Inventario). */
    async guardarVariante(v) {
      const fila = {
        sku: L.normalizarSku(v.sku),
        nombre: String(v.nombre || "").trim(),
        activo: !!v.activo,
        controla_stock: !!v.controla_stock,
      };
      let q;
      if (v.id) q = sb.from("variantes_producto").update(fila).eq("id", v.id).select("id");
      else q = sb.from("variantes_producto").insert({ ...fila, producto_id: v.producto_id, stock: Math.max(0, parseInt(v.stock, 10) || 0) }).select("id");
      const { data, error } = await q;
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: revisa que tengas permiso para editar el catálogo." };
      return { ok: true, id: data[0].id };
    },

    /* Precio de venta (nivel retail) de una variante: crea o reemplaza (RLS: precios.gestionar).
       crear_pedido() toma el precio desde aquí, así que el cambio rige desde el próximo pedido. */
    async guardarPrecio(varianteId, precio) {
      const n = L.parsePrecio(precio);
      if (n === null) return { ok: false, error: "Escribe un precio válido en pesos, sin decimales." };
      const nivel = await _nivelRetail();
      const { data, error } = await sb.from("precios_variante")
        .upsert({ variante_id: varianteId, nivel_precio_id: nivel, precio: n }, { onConflict: "variante_id,nivel_precio_id" })
        .select("precio");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: revisa que tengas permiso para editar precios." };
      return { ok: true, precio: n };
    },

    /* Producto nuevo con su primera variante y precio. Se crea OCULTO y se publica al final,
       para que la tienda nunca muestre un producto a medio crear (sin variante o sin precio). */
    async crearProductoCompleto(p, v) {
      const r1 = await this.guardarProducto({ ...p, activo: false });
      if (!r1.ok) return r1;
      const r2 = await this.guardarVariante({ ...v, producto_id: r1.id, activo: true });
      if (!r2.ok) return { ...r2, error: r2.error + " El producto quedó oculto: complétalo desde Editar.", id: r1.id };
      const r3 = await this.guardarPrecio(r2.id, v.precio);
      if (!r3.ok) return { ...r3, error: r3.error + " El producto quedó oculto: revisa el precio.", id: r1.id };
      if (p.activo) {
        const r4 = await this.guardarProducto({ ...p, id: r1.id, activo: true });
        if (!r4.ok) return r4;
      }
      return { ok: true, id: r1.id };
    },

    /* ================= INVENTARIO (RF-18) ================= */
    /* Variantes con su producto (incluye ocultas: el dueño también repone lo que no se vende aún) */
    async listInventario() {
      const { data, error } = await sb.from("variantes_producto")
        .select("id,producto_id,sku,nombre,stock,controla_stock,activo,producto:productos(nombre,activo)")
        .order("sku");
      if (error) throw error;
      return (data || []).map((v) => ({
        id: v.id, producto_id: v.producto_id, sku: v.sku, nombre: v.nombre, stock: v.stock,
        controla_stock: v.controla_stock, activo: v.activo,
        producto: (v.producto && v.producto.nombre) || "—",
        visible: !!(v.activo && v.producto && v.producto.activo),
      }));
    },

    /* Umbral de stock bajo (parametros.stock_alerta; lectura pública) */
    async umbralStock() {
      const { data } = await sb.from("parametros").select("valor").eq("clave", "stock_alerta").maybeSingle();
      return L.umbralStock(data && data.valor);
    },
    async guardarUmbral(n) {
      const v = L.parseStock(n);
      if (v === null) return { ok: false, error: "Escribe un número entero desde 0." };
      const { data, error } = await sb.from("parametros")
        .upsert({ clave: "stock_alerta", valor: String(v), descripcion: "Unidades bajo las cuales el panel avisa stock bajo" }, { onConflict: "clave" })
        .select("valor");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: requiere permiso de configuración." };
      return { ok: true, valor: v };
    },

    /* Fija el stock de una variante. Se exige que el stock siga siendo el que vio el usuario:
       si cambió (otra persona o una venta), no se pisa y se avisa para recargar. */
    async fijarStock(id, actual, nuevo) {
      const n = L.parseStock(nuevo);
      if (n === null) return { ok: false, error: "Escribe una cantidad entera entre 0 y 100.000." };
      const { data, error } = await sb.from("variantes_producto")
        .update({ stock: n }).eq("id", id).eq("stock", actual).select("id,stock");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, recargar: true, error: "El stock cambió mientras lo editabas (o no tienes permiso). Se recargó el valor actual." };
      return { ok: true, stock: data[0].stock };
    },

    /* ================= CUPONES (RF-20) ================= */
    /* ¿Está aplicada la migración 04 (reglas de bienvenida y usos por cliente)? */
    async reglasCupones() {
      const { error } = await sb.from("cupones").select("solo_primera_compra").limit(1);
      return !error;
    },

    /* Todos los cupones con los productos a los que aplican (RLS: promociones.gestionar) */
    async listCupones() {
      const { data, error } = await sb.from("cupones")
        .select("*,cupon_variantes(variante_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((c) => ({
        ...c,
        usos_actuales: c.usos_actuales || 0,
        requiere_cuenta: !!c.requiere_cuenta, solo_primera_compra: !!c.solo_primera_compra,
        usos_por_cliente: c.usos_por_cliente == null ? null : c.usos_por_cliente,
        variantes: (c.cupon_variantes || []).map((x) => x.variante_id),
      }));
    },

    /* Crea o edita un cupón y sus productos (vacío = aplica a todo el carrito).
       Sin la migración 04 solo se envían las columnas originales. */
    async guardarCupon(id, fila, variantes, conReglas) {
      const datos = { ...fila };
      if (!conReglas) ["solo_primera_compra", "requiere_cuenta", "usos_por_cliente", "descripcion"].forEach((k) => delete datos[k]);
      const q = id
        ? sb.from("cupones").update(datos).eq("id", id).select("id")
        : sb.from("cupones").insert(datos).select("id");
      const { data, error } = await q;
      if (error) return { ok: false, error: error.code === "23505" ? "Ya existe un cupón con ese código." : msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: revisa que tengas permiso para gestionar promociones." };
      const cid = data[0].id;
      // Productos: se reemplaza la lista completa
      const { error: e1 } = await sb.from("cupon_variantes").delete().eq("cupon_id", cid);
      if (e1) return { ok: false, id: cid, error: "El cupón se guardó, pero no sus productos. " + msgAdmin(e1) };
      if (variantes && variantes.length) {
        const { error: e2 } = await sb.from("cupon_variantes").insert(variantes.map((v) => ({ cupon_id: cid, variante_id: v })));
        if (e2) return { ok: false, id: cid, error: "El cupón se guardó, pero no sus productos. " + msgAdmin(e2) };
      }
      return { ok: true, id: cid };
    },

    /* ================= BANNER Y ESLOGAN (parametros.sitio_*, permiso config.gestionar) ================= */
    /* Valores actuales → mismo formato que la tienda ({eyebrow, titulo, subtitulo, pie, banner_*}) */
    async getSitio() {
      const { data, error } = await sb.from("parametros").select("clave,valor").in("clave", Befine.sitio.CLAVES);
      if (error) throw error;
      return Befine.sitio.normalizar(data);
    },

    /* Guarda todas las claves de una vez. `fila` viene de AdminLogic.validarSitio (ya validada). */
    async guardarSitio(fila) {
      const filas = Object.entries(fila).map(([clave, valor]) => ({ clave, valor: String(valor) }));
      const { data, error } = await sb.from("parametros").upsert(filas, { onConflict: "clave" }).select("clave");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || data.length !== filas.length) return { ok: false, error: "No se guardó: requiere permiso de configuración." };
      try { localStorage.removeItem("befine_sitio"); } catch (e) { /* storage bloqueado */ }
      return { ok: true };
    },

    /* Sube una imagen del banner al servidor → { ok, url } o { ok:false, error } */
    async subirImagen(archivo) {
      const malo = L.validarImagen(archivo);
      if (malo) return { ok: false, error: malo };
      const r = await sb.subirImagen(archivo);
      if (r.error || !r.url) return { ok: false, error: (r.error && r.error.message) === "Failed to fetch" ? "Sin conexión. Revisa tu internet e inténtalo de nuevo." : ((r.error && r.error.message) || "No pudimos subir la imagen.") };
      return { ok: true, url: r.url };
    },

    /* Pausar o reactivar (los cupones usados no se borran: quedan en el historial de pedidos) */
    async activarCupon(id, activo) {
      const { data, error } = await sb.from("cupones").update({ activo }).eq("id", id).select("id,activo");
      if (error) return { ok: false, error: msgAdmin(error) };
      if (!data || !data.length) return { ok: false, error: "No se guardó: revisa tus permisos." };
      return { ok: true };
    },
  };
})();
