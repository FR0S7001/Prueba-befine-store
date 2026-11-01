/* =====================================================================
   store.js — Estado del CARRITO, compartido entre todas las páginas
   ---------------------------------------------------------------------
   Guarda el carrito en localStorage para que persista al navegar entre
   páginas (inicio -> catálogo -> ficha) y al recargar.
   La UI se suscribe con Store.subscribe(fn) y se redibuja sola en cada cambio.

   Nota: en producción el carrito del usuario autenticado vivirá también en
   Supabase (tablas carritos / items_carrito). localStorage sirve para el
   invitado y como respaldo; la forma del item ya es compatible.
   ===================================================================== */
(function () {
  const KEY = "befine_cart";
  let items = load();
  const subs = [];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }   // modo privado / storage bloqueado
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    subs.forEach((fn) => fn(items));
  }

  const Store = {
    /* item esperado: {variante_id, producto_id, nombre, variante, precio, grad} */
    add(item, cantidad = 1) {
      const found = items.find((i) => i.variante_id === item.variante_id);
      if (found) found.cantidad += cantidad;
      else items.push({ ...item, cantidad });
      save();
    },
    setQty(variante_id, cantidad) {
      const it = items.find((i) => i.variante_id === variante_id);
      if (!it) return;
      it.cantidad = Math.max(0, cantidad);
      if (it.cantidad === 0) this.remove(variante_id); else save();
    },
    remove(variante_id) { items = items.filter((i) => i.variante_id !== variante_id); save(); },
    clear() { items = []; save(); },

    items() { return items.slice(); },
    count() { return items.reduce((n, i) => n + i.cantidad, 0); },
    total() { return items.reduce((n, i) => n + i.precio * i.cantidad, 0); },

    /* Suscribirse a cambios (para actualizar el contador y el drawer) */
    subscribe(fn) { subs.push(fn); fn(items); },
  };

  window.Store = Store;
})();
