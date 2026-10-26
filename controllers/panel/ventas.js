// ==========================================
// PANEL: VENTAS Y COBROS
// Cobro rápido (servicios, productos o una cita), pagos mixtos con cambio,
// saldos, devoluciones y anulaciones. Estado de la cita, del servicio y del
// pago se muestran por separado: confirmar o completar no es cobrar.
// ==========================================

import { api, esc, dinero, dialogo, confirmar, fechaHora, fechaLarga, hoyLocal, vacio, descargarCSV } from './comun.js';
import { METODOS_PAGO, nuevaClave, centavos, cantidad, exigirConexion, chipPago, rangoPeriodo, filtrosPeriodo, conectarPeriodo, numero, turnoDe } from './finanzas-comun.js';

const periodo = { tipo: 'hoy' };
let busqueda = '';
const ESTADO_CITA = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada' };

export async function renderVentas(cont, ctx) {
    const [desde, hasta] = rangoPeriodo(periodo);
    const vigente = turnoDe(cont);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Ventas y cobros</h2>
            <p class="panel-sub">Confirmar o completar una cita no la cobra: el cobro se registra aquí y queda en la caja.</p></div>
            <button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-cash-register"></i> Nuevo cobro</button></div>
        <section class="panel-caja" data-por-cobrar><h3>Citas de hoy por cobrar</h3><p class="panel-cargando">Cargando…</p></section>
        <div class="agenda-filtros">${filtrosPeriodo(periodo, [desde, hasta])}
            <input type="search" data-buscar placeholder="N.º, cliente o artículo" value="${esc(busqueda)}" aria-label="Buscar ventas">
            <button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> CSV</button></div>
        <div data-lista><p class="panel-cargando">Cargando ventas…</p></div>`;
    const recargar = () => renderVentas(cont, ctx);
    conectarPeriodo(cont, periodo, recargar);
    cont.querySelector('[data-nuevo]').addEventListener('click', () => abrirCobro({ ctx, alTerminar: recargar }));
    let temporizador;
    cont.querySelector('[data-buscar]').addEventListener('input', e => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => { busqueda = e.target.value; cargarLista(); }, 350);
    });

    const hoy = hoyLocal();
    api('panel_citas', { p_desde: hoy, p_hasta: hoy, p_barbero: null, p_estado: null, p_busqueda: null }).then(citas => {
        if (!vigente()) return;
        const pendientes = citas.filter(c => c.estado !== 'cancelada' && !c.pagada && c.estado_visual !== 'no_asistio');
        cont.querySelector('[data-por-cobrar]').innerHTML = `<h3>Citas de hoy por cobrar</h3>${pendientes.length ? `<ul class="panel-lista">${pendientes.map(c => `
            <li><span><strong>${esc(c.hora)}</strong> ${esc(c.cliente)} · ${esc(c.servicio)} · ${esc(c.barbero)}
                <small>(${esc(c.estado_visual === 'completada' ? 'servicio completado' : ESTADO_CITA[c.estado] || c.estado)}${Number(c.monto_cobrado) > 0 ? ` · cobrado ${dinero(c.monto_cobrado)}` : ''})</small></span>
                <button type="button" class="panel-btn panel-btn-mini" data-cita="${esc(c.id)}">Cobrar ${dinero(c.precio)}</button></li>`).join('')}</ul>`
            : '<p class="panel-sub">No hay citas de hoy pendientes de cobro.</p>'}`;
        cont.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrirCobro({ ctx, citaId: b.dataset.cita, alTerminar: recargar })));
    }).catch(e => { if (vigente()) cont.querySelector('[data-por-cobrar]').innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; });

    let ventas = [];
    async function cargarLista() {
        const lista = cont.querySelector('[data-lista]');
        try {
            ventas = await api('panel_ventas', { p_desde: desde, p_hasta: hasta, p_busqueda: busqueda || null });
            if (!vigente()) return;
        } catch (e) {
            if (!vigente()) return;
            lista.innerHTML = `<p class="panel-error">${esc(e.message)} <button type="button" class="panel-btn panel-btn-mini" data-reintentar>Reintentar</button></p>`; lista.querySelector('[data-reintentar]').addEventListener('click', cargarLista); return; }
        lista.innerHTML = ventas.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas">
            <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Detalle</th><th>Total</th><th>Cobrado</th><th>Saldo</th><th>Pago</th></tr></thead>
            <tbody>${ventas.map(v => `<tr data-venta="${esc(v.id)}" tabindex="0" class="fila-clic">
                <td data-titulo="N.º">#${esc(v.numero)}</td><td data-titulo="Fecha">${esc(fechaHora(v.creado_en))}</td>
                <td data-titulo="Cliente">${esc(v.cliente)}${v.cita_id ? ' <small>(cita)</small>' : ''}</td>
                <td data-titulo="Detalle">${esc(v.resumen || '')}</td><td data-titulo="Total">${dinero(v.total)}</td>
                <td data-titulo="Cobrado">${dinero(v.cobrado_neto)}</td><td data-titulo="Saldo">${Number(v.saldo) > 0 ? `<strong>${dinero(v.saldo)}</strong>` : '—'}</td>
                <td data-titulo="Pago">${v.estado === 'anulada' ? chipPago('anulada') : chipPago(Number(v.saldo) > 0 ? (Number(v.cobrado_neto) > 0 ? 'parcial' : 'pendiente') : 'pagada')}</td></tr>`).join('')}</tbody>
            </table></div>` : vacio('No hay ventas en el periodo.', 'receipt');
        lista.querySelectorAll('[data-venta]').forEach(f => {
            const abrir = () => abrirVenta(f.dataset.venta, ctx, cargarLista);
            f.addEventListener('click', abrir);
            f.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(); });
        });
    }
    cont.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`ventas-${desde}_${hasta}.csv`, [
        ['Número', 'Fecha', 'Estado', 'Cliente', 'Detalle', 'Total (RD$)', 'Cobrado neto (RD$)', 'Devuelto (RD$)', 'Saldo (RD$)'],
        ...ventas.map(v => [v.numero, fechaHora(v.creado_en), v.estado, v.cliente, v.resumen, v.total, v.cobrado_neto, v.devuelto, v.saldo])]));
    cargarLista();
}

// ---------- Cobro ----------
function lineaNueva(item, tipo, barberoPorDefecto) {
    return { tipo, id: item.id, descripcion: item.nombre, precio: Number(item.precio), cantidad: 1, descuento: 0,
             unidad: item.unidad || null, existencia: item.existencia, barbero_id: tipo === 'servicio' ? (barberoPorDefecto || '') : null };
}

export async function abrirCobro({ ctx, citaId = null, ventaId = null, alTerminar }) {
    let catalogo, base;
    try {
        [catalogo, base] = await Promise.all([api('panel_venta_catalogo'),
            citaId ? api('panel_venta_de_cita', { p_cita: citaId }) : ventaId ? api('panel_venta', { p_id: ventaId }).then(v => ({ venta: v })) : null]);
    } catch (e) { ctx.notificar(e.message, 'error'); return; }
    const cita = base?.cita || null;
    const venta = base?.venta || null;
    const previsto = base?.previsto || null;
    const carrito = [];
    const pagos = [{ metodo: 'efectivo', monto: null, recibido: null, referencia: '' }];
    let clave = nuevaClave();
    let enviando = false;
    const barberoCita = cita?.barbero_id || '';

    const { cuerpo, cerrar } = dialogo({ titulo: venta ? `Cobrar venta #${venta.numero}` : cita ? `Cobrar cita de ${cita.cliente}` : 'Nuevo cobro', ancho: 'lg', html: `
        <div class="cobro">
            ${cita ? `<div class="cobro-estados">
                <span>Cita: <strong>${esc(ESTADO_CITA[cita.estado] || cita.estado)}</strong></span>
                <span>Servicio: <strong>${cita.estado_visual === 'completada' ? 'Completado' : cita.estado_visual === 'no_asistio' ? 'No asistió' : 'Sin completar'}</strong></span>
                <span>Pago: ${chipPago(venta ? venta.estado_pago : 'pendiente')}</span>
                <span>${esc(fechaLarga(cita.fecha))} ${esc(cita.hora)} · ${esc(cita.barbero || '')}</span></div>` : ''}
            ${!catalogo.caja_abierta ? '<p class="panel-aviso cobro-aviso"><i class="fas fa-lock"></i> La caja está cerrada: puedes cobrar con tarjeta o transferencia; para efectivo, abre la caja.</p>' : ''}
            <label class="cobro-buscar"><span class="sr-only">Buscar servicio o producto</span>
                <input type="search" data-buscar placeholder="Buscar servicio o producto (nombre o código)" autocomplete="off"></label>
            <div class="cobro-resultados" data-resultados role="list"></div>
            <div data-carrito></div>
            <label data-motivo-descuento hidden>Motivo del descuento (obligatorio)<input name="descuento_motivo" maxlength="300" placeholder="Ej.: cliente frecuente"></label>
            ${!cita && !venta ? `<details class="cobro-cliente"><summary>Cliente (opcional)</summary><div class="panel-rejilla">
                <label>Nombre<input data-cliente-nombre maxlength="120" autocomplete="off"></label>
                <label>Teléfono<input data-cliente-telefono inputmode="tel" maxlength="20" autocomplete="off"></label></div>
                <p class="panel-sub">Sin teléfono la venta debe pagarse completa.</p></details>` : ''}
            <div class="cobro-totales" data-totales aria-live="polite"></div>
            <fieldset class="panel-fieldset cobro-pagos"><legend>Pago</legend>
                <div class="cobro-rapidos">${['efectivo', 'tarjeta', 'transferencia'].map(m => `<button type="button" class="panel-btn panel-btn-mini" data-todo="${m}">Todo en ${METODOS_PAGO[m].toLowerCase()}</button>`).join('')}</div>
                <div data-pagos></div>
                <button type="button" class="panel-btn panel-btn-mini" data-otro-pago><i class="fas fa-plus"></i> Otro medio de pago</button>
            </fieldset>
            <p class="panel-error" data-error role="alert" hidden></p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="button" class="panel-btn panel-btn-principal cobro-confirmar" data-confirmar>Confirmar cobro</button></div>
        </div>` });

    const $ = s => cuerpo.querySelector(s);
    const saldoBase = () => venta ? Number(venta.saldo)
        : (previsto?.lineas || []).reduce((s, l) => s + centavos(l.cantidad * l.precio_unitario) - Number(l.descuento || 0), 0);
    const totalNuevas = () => carrito.reduce((s, l) => s + centavos(l.cantidad * l.precio) - centavos(l.descuento || 0), 0);
    const aPagar = () => centavos(saldoBase() + totalNuevas());
    const cobradoAhora = () => centavos(pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0));
    const cambio = () => centavos(pagos.reduce((s, p) => s + (p.metodo === 'efectivo' && Number(p.recibido) > Number(p.monto) ? Number(p.recibido) - Number(p.monto) : 0), 0));

    function pintarResultados() {
        const texto = $('[data-buscar]').value.trim().toLowerCase();
        const coincide = x => !texto || x.nombre.toLowerCase().includes(texto) || (x.codigo || '').toLowerCase().includes(texto);
        const servicios = catalogo.servicios.filter(coincide).slice(0, texto ? 12 : 6);
        const productos = catalogo.productos.filter(coincide).slice(0, texto ? 12 : 6);
        $('[data-resultados]').innerHTML = [...servicios.map(s => ['servicio', s]), ...productos.map(p => ['producto', p])].map(([tipo, x]) => `
            <button type="button" class="cobro-item" data-agregar="${tipo}:${esc(x.id)}" ${tipo === 'producto' && Number(x.existencia) <= 0 ? 'disabled' : ''} role="listitem">
                <i class="fas fa-${tipo === 'servicio' ? 'scissors' : 'pump-soap'}" aria-hidden="true"></i>
                <span>${esc(x.nombre)}<small>${tipo === 'producto' ? `${esc(x.codigo)} · ${Number(x.existencia) > 0 ? `quedan ${esc(cantidad(x.existencia, x.unidad))}` : 'agotado'}` : 'Servicio'}</small></span>
                <strong>${dinero(x.precio)}</strong></button>`).join('') || '<p class="panel-sub">Sin resultados.</p>';
    }

    function pintarCarrito() {
        const existentes = venta ? venta.lineas : previsto?.lineas || [];
        const barberos = catalogo.barberos;
        $('[data-carrito]').innerHTML = `<div class="cobro-carrito">
            ${existentes.map(l => `<div class="cobro-linea cobro-linea-fija"><span>${esc(l.descripcion)}<small>${esc(cantidad(l.cantidad, l.unidad))} × ${dinero(l.precio_unitario)}${Number(l.descuento) > 0 ? ` · desc. ${dinero(l.descuento)}` : ''}${venta ? ' · ya registrado' : ''}</small></span>
                <strong>${dinero(centavos(l.cantidad * l.precio_unitario) - Number(l.descuento || 0))}</strong></div>`).join('')}
            ${carrito.map((l, i) => `<div class="cobro-linea" data-i="${i}">
                <span class="cobro-linea-nombre">${esc(l.descripcion)}<small>${dinero(l.precio)} c/u${l.tipo === 'producto' ? ` · quedan ${esc(cantidad(l.existencia, l.unidad))}` : ''}</small></span>
                <label>Cant.<input type="number" data-campo="cantidad" min="0" step="${l.tipo === 'servicio' || ['unidad', 'par'].includes(l.unidad) ? 1 : 0.001}" value="${l.cantidad}" inputmode="decimal"></label>
                <label>Desc. RD$<input type="number" data-campo="descuento" min="0" step="0.01" value="${l.descuento || ''}" inputmode="decimal"></label>
                ${l.tipo === 'servicio' ? `<label>Barbero<select data-campo="barbero_id"><option value="">Elige…</option>${barberos.map(b => `<option value="${esc(b.id)}" ${b.id === l.barbero_id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select></label>` : ''}
                <button type="button" class="panel-icono" data-quitar aria-label="Quitar ${esc(l.descripcion)}"><i class="fas fa-trash"></i></button></div>`).join('')}
            ${!existentes.length && !carrito.length ? '<p class="panel-sub">Busca y toca un servicio o producto para agregarlo.</p>' : ''}</div>`;
        actualizar();
    }

    function pintarPagos() {
        $('[data-pagos]').innerHTML = pagos.map((p, i) => `<div class="cobro-pago" data-p="${i}">
            <label>Medio<select data-pago="metodo">${['efectivo', 'tarjeta', 'transferencia', 'otro'].map(m => `<option value="${m}" ${p.metodo === m ? 'selected' : ''}>${METODOS_PAGO[m]}</option>`).join('')}</select></label>
            <label>Importe RD$<input type="number" data-pago="monto" min="0" step="0.01" value="${p.monto ?? ''}" inputmode="decimal"></label>
            ${p.metodo === 'efectivo' ? `<label>Recibido RD$<input type="number" data-pago="recibido" min="0" step="0.01" value="${p.recibido ?? ''}" inputmode="decimal" placeholder="Igual al importe"></label>`
                : `<label>Referencia<input data-pago="referencia" maxlength="80" value="${esc(p.referencia)}" placeholder="Opcional"></label>`}
            ${pagos.length > 1 ? `<button type="button" class="panel-icono" data-quitar-pago aria-label="Quitar este pago"><i class="fas fa-trash"></i></button>` : ''}</div>`).join('');
        actualizar();
    }

    function actualizar() {
        const total = aPagar();
        const ahora = cobradoAhora();
        const hayDescuento = carrito.some(l => Number(l.descuento) > 0);
        $('[data-motivo-descuento]').hidden = !hayDescuento;
        $('[data-totales]').innerHTML = `
            ${venta ? `<div><span>Total de la venta</span><strong>${dinero(venta.total)}</strong></div><div><span>Ya cobrado</span><span>${dinero(venta.cobrado_neto)}</span></div>` : ''}
            ${carrito.length && venta ? `<div><span>Agregado ahora</span><span>${dinero(totalNuevas())}</span></div>` : ''}
            <div class="cobro-total"><span>A pagar</span><strong>${dinero(total)}</strong></div>
            <div><span>Cobrado en esta operación</span><span>${dinero(ahora)}</span></div>
            ${cambio() > 0 ? `<div class="cobro-cambio"><span>Cambio a entregar</span><strong>${dinero(cambio())}</strong></div>` : ''}
            ${total - ahora > 0.004 ? `<div class="cobro-saldo"><span>Quedará pendiente</span><strong>${dinero(total - ahora)}</strong></div>` : ''}
            ${ahora - total > 0.004 ? '<div class="panel-error"><span>El pago supera lo que se debe.</span></div>' : ''}`;
        $('[data-confirmar]').textContent = ahora > 0 ? `Confirmar cobro de ${dinero(ahora)}` : 'Registrar sin cobrar ahora';
    }

    cuerpo.addEventListener('input', e => {
        const linea = e.target.closest('[data-i]');
        const pago = e.target.closest('[data-p]');
        if (linea && e.target.dataset.campo) {
            const l = carrito[Number(linea.dataset.i)];
            l[e.target.dataset.campo] = e.target.dataset.campo === 'barbero_id' ? e.target.value : (numero(e.target) ?? 0);
            actualizar();
        } else if (pago && e.target.dataset.pago) {
            const p = pagos[Number(pago.dataset.p)];
            const campo = e.target.dataset.pago;
            p[campo] = campo === 'referencia' || campo === 'metodo' ? e.target.value : numero(e.target);
            if (campo === 'metodo') pintarPagos(); else actualizar();
        } else if (e.target.matches('[data-buscar]')) pintarResultados();
    });
    cuerpo.addEventListener('change', e => { if (e.target.matches('select[data-campo], select[data-pago]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    cuerpo.addEventListener('click', e => {
        const agregar = e.target.closest('[data-agregar]');
        if (agregar) {
            const [tipo, id] = agregar.dataset.agregar.split(':');
            const item = (tipo === 'servicio' ? catalogo.servicios : catalogo.productos).find(x => String(x.id) === id);
            const existente = carrito.find(l => l.tipo === tipo && String(l.id) === id && tipo === 'producto');
            if (existente) existente.cantidad += 1; else carrito.push(lineaNueva(item, tipo, barberoCita));
            pintarCarrito();
            return;
        }
        if (e.target.closest('[data-quitar]')) { carrito.splice(Number(e.target.closest('[data-i]').dataset.i), 1); pintarCarrito(); return; }
        if (e.target.closest('[data-quitar-pago]')) { pagos.splice(Number(e.target.closest('[data-p]').dataset.p), 1); pintarPagos(); return; }
        if (e.target.closest('[data-otro-pago]')) {
            const resto = centavos(aPagar() - cobradoAhora());
            pagos.push({ metodo: 'tarjeta', monto: resto > 0 ? resto : null, recibido: null, referencia: '' });
            pintarPagos();
            return;
        }
        const todo = e.target.closest('[data-todo]');
        if (todo) {
            pagos.splice(0, pagos.length, { metodo: todo.dataset.todo, monto: aPagar(), recibido: null, referencia: '' });
            pintarPagos();
            cuerpo.querySelector(todo.dataset.todo === 'efectivo' ? '[data-pago="recibido"]' : '[data-pago="monto"]')?.focus();
        }
    });

    $('[data-confirmar]').addEventListener('click', async e => {
        if (enviando) return;
        const error = $('[data-error]');
        error.hidden = true;
        const pagosValidos = pagos.filter(p => Number(p.monto) > 0);
        const problema = !venta && !previsto && !carrito.length ? 'Agrega al menos un servicio o producto.'
            : carrito.some(l => !(l.cantidad > 0)) ? 'Revisa las cantidades.'
            : carrito.some(l => l.tipo === 'servicio' && !l.barbero_id) ? 'Elige el barbero de cada servicio.'
            : carrito.some(l => Number(l.descuento) > 0) && $('[name="descuento_motivo"]').value.trim().length < 3 ? 'Escribe el motivo del descuento.'
            : pagosValidos.some(p => p.metodo === 'efectivo' && p.recibido !== null && Number(p.recibido) < Number(p.monto)) ? 'El efectivo recibido es menor que el importe.'
            : cobradoAhora() - aPagar() > 0.004 ? 'El pago supera lo que se debe.'
            : !venta && !cita && !carrito.length ? 'Agrega al menos un servicio o producto.' : null;
        if (problema) { error.textContent = problema; error.hidden = false; return; }
        if (cobradoAhora() === 0 && !await confirmar('Se registrará la venta sin cobrar nada ahora: quedará como saldo pendiente. ¿Continuar?', { textoOk: 'Registrar' })) return;
        const boton = e.currentTarget;
        enviando = true;
        boton.disabled = true;
        boton.setAttribute('aria-busy', 'true');
        try {
            exigirConexion();
            const nombre = $('[data-cliente-nombre]')?.value.trim();
            const telefono = $('[data-cliente-telefono]')?.value.trim();
            const resultado = await api('panel_venta_cobrar', { p_datos: {
                clave, venta_id: venta?.id || null, cita_id: venta ? null : citaId,
                cliente: nombre || telefono ? { nombre, telefono } : null,
                lineas: carrito.map(l => ({ tipo: l.tipo, [l.tipo === 'servicio' ? 'servicio_id' : 'producto_id']: l.id, cantidad: l.cantidad,
                                            descuento: centavos(l.descuento || 0), barbero_id: l.barbero_id })),
                descuento_motivo: $('[name="descuento_motivo"]').value.trim() || null,
                pagos: pagosValidos.map(p => ({ metodo: p.metodo, monto: centavos(p.monto), recibido: p.metodo === 'efectivo' && p.recibido !== null ? centavos(p.recibido) : null,
                                                referencia: p.referencia || null }))
            } });
            mostrarRecibo(cuerpo, resultado, { cerrar, nuevo: () => { cerrar(); abrirCobro({ ctx, alTerminar }); } });
            ctx.notificar(resultado.repetida ? 'Esta operación ya estaba registrada: no se cobró dos veces.' : 'Cobro confirmado');
            alTerminar?.();
        } catch (fallo) {
            // La clave se conserva: reintentar no duplica la operación
            error.textContent = fallo.message;
            error.hidden = false;
            enviando = false;
            boton.disabled = false;
            boton.removeAttribute('aria-busy');
        }
    });

    pintarResultados();
    pintarCarrito();
    pintarPagos();
    $('[data-buscar]').focus();
}

function htmlComprobante(v) {
    return `<div class="comprobante">
        <header><strong>Comprobante interno #${esc(v.numero)}</strong><span>${esc(fechaHora(v.creado_en))}</span></header>
        ${v.cliente_nombre ? `<p>Cliente: ${esc(v.cliente_nombre)}</p>` : ''}
        <table class="panel-tabla"><tbody>${v.lineas.map(l => `<tr><td>${esc(l.descripcion)}${l.barbero ? `<br><small>${esc(l.barbero)}</small>` : ''}</td>
            <td>${esc(cantidad(l.cantidad, l.unidad))} × ${dinero(l.precio_unitario)}${Number(l.descuento) > 0 ? `<br><small>Desc. ${dinero(l.descuento)}</small>` : ''}</td>
            <td>${dinero(l.total)}${Number(l.importe_devuelto) > 0 ? `<br><small>Devuelto ${dinero(l.importe_devuelto)}</small>` : ''}</td></tr>`).join('')}</tbody></table>
        <dl class="comprobante-totales"><div><dt>Total</dt><dd>${dinero(v.total)}</dd></div>
            ${Number(v.devuelto) > 0 ? `<div><dt>Devuelto</dt><dd>${dinero(v.devuelto)}</dd></div>` : ''}
            ${v.pagos.map(p => `<div><dt>${p.tipo === 'reembolso' ? 'Reembolso' : 'Pago'} · ${esc(METODOS_PAGO[p.metodo] || p.metodo)}${p.es_anticipo ? ' (anticipo)' : ''}</dt>
                <dd>${p.tipo === 'reembolso' ? '−' : ''}${dinero(p.monto)}${Number(p.cambio) > 0 ? ` · recibido ${dinero(p.recibido)}, cambio ${dinero(p.cambio)}` : ''}</dd></div>`).join('')}
            <div><dt>Saldo pendiente</dt><dd>${dinero(v.saldo)}</dd></div></dl>
        <p class="panel-sub">${esc(v.comprobante)} Sin impuestos aplicados: el negocio no tiene impuestos configurados.</p></div>`;
}

function imprimir(v) {
    const w = window.open('', '_blank', 'noopener=no,width=420,height=640');
    if (!w) return;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante #${esc(v.numero)}</title>
        <style>body{font:13px system-ui,sans-serif;margin:16px}table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px dashed #ccc;vertical-align:top}
        td:last-child{text-align:right}dl div{display:flex;justify-content:space-between}dt,dd{margin:2px 0}header{display:flex;justify-content:space-between}</style></head>
        <body>${htmlComprobante(v)}<script>window.print()<\/script></body></html>`);
    w.document.close();
}

function mostrarRecibo(cuerpo, v, { cerrar, nuevo }) {
    cuerpo.innerHTML = `<div class="cobro-ok" role="status"><i class="fas fa-circle-check"></i>
            <h4>${v.repetida ? 'Operación ya registrada' : 'Cobro confirmado'}</h4>
            <p>${v.repetida ? 'Esta operación ya estaba guardada; no se cobró dos veces.' : `Cobrado ahora: <strong>${dinero(v.cobrado_ahora)}</strong>`}
               ${Number(v.cambio) > 0 ? ` · Cambio: <strong>${dinero(v.cambio)}</strong>` : ''}</p></div>
        ${htmlComprobante(v)}
        <div class="panel-acciones"><button type="button" class="panel-btn" data-imprimir><i class="fas fa-print"></i> Imprimir</button>
            <button type="button" class="panel-btn" data-nuevo-cobro><i class="fas fa-plus"></i> Nuevo cobro</button>
            <button type="button" class="panel-btn panel-btn-principal" data-listo>Listo</button></div>`;
    cuerpo.querySelector('[data-imprimir]').addEventListener('click', () => imprimir(v));
    cuerpo.querySelector('[data-nuevo-cobro]').addEventListener('click', nuevo);
    cuerpo.querySelector('[data-listo]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-listo]').focus();
}

// ---------- Detalle de una venta: saldo, devolución, anulación ----------
export async function abrirVenta(id, ctx, alCambiar) {
    let v;
    try { v = await api('panel_venta', { p_id: id }); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    const neto = Number(v.cobrado_neto);
    const devolvibles = v.lineas.filter(l => Number(l.total) > Number(l.importe_devuelto));
    const { cuerpo, cerrar } = dialogo({ titulo: `Venta #${v.numero}`, ancho: 'lg', html: `
        <div class="cobro-estados"><span>Pago: ${chipPago(v.estado_pago)}</span>
            ${v.cita ? `<span>Cita: <strong>${esc(ESTADO_CITA[v.cita.estado] || v.cita.estado)}</strong> · ${esc(fechaLarga(v.cita.fecha))} ${esc(v.cita.hora)}</span>
            <span>Servicio: <strong>${v.cita.completada ? 'Completado' : v.cita.no_asistio ? 'No asistió' : 'Sin completar'}</strong></span>` : ''}
            <span>Registró: ${esc(v.creado_por || 'sistema')}</span>
            ${v.origen === 'historico' ? '<span>Cobro anterior al módulo de ventas</span>' : ''}</div>
        ${v.estado === 'anulada' ? `<p class="panel-aviso">Anulada el ${esc(fechaHora(v.anulada_en))} por ${esc(v.anulada_por || '')}: ${esc(v.motivo_anulacion)}</p>` : ''}
        ${v.descuento_motivo ? `<p class="panel-sub">Motivo del descuento: ${esc(v.descuento_motivo)}</p>` : ''}
        ${htmlComprobante(v)}
        ${v.devoluciones.length ? `<details class="detalle-bloque"><summary>Devoluciones (${v.devoluciones.length})</summary><ul class="panel-lista">${v.devoluciones.map(d => `
            <li>${esc(fechaHora(d.creado_en))} · ${dinero(d.importe)}${Number(d.cantidad) > 0 ? ` · ${esc(cantidad(d.cantidad))} u.` : ''} · ${d.repuesto ? 'repuesto al inventario' : 'no repuesto'} · ${esc(d.motivo)} <small>(${esc(d.usuario || '')})</small></li>`).join('')}</ul></details>` : ''}
        <div class="panel-acciones panel-acciones-izq">
            ${v.estado !== 'anulada' && Number(v.saldo) > 0 ? '<button type="button" class="panel-btn panel-btn-principal" data-saldo><i class="fas fa-cash-register"></i> Cobrar saldo</button>' : ''}
            ${ctx.rol === 'admin' && v.estado !== 'anulada' && (neto > 0 || devolvibles.length) ? '<button type="button" class="panel-btn" data-mostrar-devolucion><i class="fas fa-rotate-left"></i> Devolución o reembolso</button>' : ''}
            ${ctx.rol === 'admin' && v.estado !== 'anulada' && neto === 0 ? '<button type="button" class="panel-btn panel-btn-peligro" data-anular><i class="fas fa-ban"></i> Anular venta</button>' : ''}
            <button type="button" class="panel-btn" data-imprimir><i class="fas fa-print"></i> Imprimir</button></div>
        <form class="panel-form detalle-sub" data-devolucion hidden novalidate>
            <p class="panel-sub">Indica lo que se devuelve. Marca "reponer" solo si el producto regresó y está apto para venderse.</p>
            ${devolvibles.map(l => `<div class="cobro-linea" data-detalle="${esc(l.id)}">
                <span class="cobro-linea-nombre">${esc(l.descripcion)}<small>${dinero(Number(l.total) - Number(l.importe_devuelto))} sin devolver</small></span>
                ${l.tipo === 'producto' ? `<label>Cantidad<input type="number" name="cantidad" min="0" max="${Number(l.cantidad) - Number(l.cantidad_devuelta)}" step="${['unidad', 'par'].includes(l.unidad) ? 1 : 0.001}" value="0"></label>
                    <label class="panel-check"><input type="checkbox" name="reponer"> Reponer</label>` : ''}
                <label>Importe RD$<input type="number" name="importe" min="0" step="0.01" max="${Number(l.total) - Number(l.importe_devuelto)}" placeholder="0"></label></div>`).join('')}
            <div class="panel-rejilla">
                <label>Devolver dinero por<select name="metodo">${['efectivo', 'tarjeta', 'transferencia', 'otro'].map(m => `<option value="${m}">${METODOS_PAGO[m]}</option>`).join('')}</select></label>
                <label>Dinero a devolver RD$<input type="number" name="reembolso" min="0" max="${neto}" step="0.01" value="0"></label></div>
            <label>Motivo (obligatorio)<input name="motivo" maxlength="300" required></label>
            <p class="panel-sub">Cobrado neto: ${dinero(neto)}. No se puede devolver más dinero del cobrado.</p>
            <button type="submit" class="panel-btn panel-btn-principal">Registrar devolución</button>
        </form>` });

    const refrescar = () => { cerrar(); alCambiar?.(); abrirVenta(id, ctx, alCambiar); };
    cuerpo.querySelector('[data-imprimir]').addEventListener('click', () => imprimir(v));
    cuerpo.querySelector('[data-saldo]')?.addEventListener('click', () => { cerrar(); abrirCobro({ ctx, ventaId: v.id, alTerminar: alCambiar }); });
    cuerpo.querySelector('[data-mostrar-devolucion]')?.addEventListener('click', () => {
        const f = cuerpo.querySelector('[data-devolucion]');
        f.hidden = !f.hidden;
        f.querySelector('input')?.focus();
    });
    const form = cuerpo.querySelector('[data-devolucion]');
    // El dinero a devolver sigue por defecto la suma de los importes indicados
    form.addEventListener('input', e => {
        if (e.target.name !== 'importe' && e.target.name !== 'cantidad') return;
        const fila = e.target.closest('[data-detalle]');
        const linea = v.lineas.find(l => String(l.id) === fila.dataset.detalle);
        if (e.target.name === 'cantidad' && linea.tipo === 'producto') {
            fila.querySelector('[name="importe"]').value = centavos(Number(linea.total) * (numero(e.target) || 0) / Number(linea.cantidad)) || '';
        }
        const suma = [...form.querySelectorAll('[name="importe"]')].reduce((s, i) => s + (numero(i) || 0), 0);
        form.elements.reembolso.value = centavos(Math.min(suma, neto));
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const lineas = [...form.querySelectorAll('[data-detalle]')].map(f => ({ detalle_id: Number(f.dataset.detalle), cantidad: numero(f.querySelector('[name="cantidad"]')) || 0,
            importe: numero(f.querySelector('[name="importe"]')) || 0, reponer: Boolean(f.querySelector('[name="reponer"]')?.checked) }))
            .filter(l => l.importe > 0 || l.cantidad > 0);
        const reembolso = numero(form.elements.reembolso) || 0;
        const motivo = form.elements.motivo.value.trim();
        if (motivo.length < 3) { ctx.notificar('Escribe el motivo de la devolución.', 'error'); return; }
        if (!lineas.length && reembolso <= 0) { ctx.notificar('Indica qué se devuelve o el dinero a reembolsar.', 'error'); return; }
        if (!await confirmar(`¿Registrar la devolución${reembolso > 0 ? ` y devolver ${dinero(reembolso)} por ${METODOS_PAGO[form.elements.metodo.value].toLowerCase()}` : ''}? Quedará en el historial.`,
            { textoOk: 'Registrar devolución', peligro: true })) return;
        const boton = e.submitter;
        boton.disabled = true;
        try {
            exigirConexion();
            await api('panel_venta_reembolsar', { p_datos: { clave: form.dataset.clave || (form.dataset.clave = nuevaClave()), venta_id: v.id, motivo, lineas,
                reembolsos: reembolso > 0 ? [{ metodo: form.elements.metodo.value, monto: centavos(reembolso) }] : [] } });
            ctx.notificar('Devolución registrada');
            refrescar();
        } catch (fallo) { ctx.notificar(fallo.message, 'error'); boton.disabled = false; }
    });
    cuerpo.querySelector('[data-anular]')?.addEventListener('click', async e => {
        const motivo = window.prompt('Motivo de la anulación (queda en el historial):', '');
        if (motivo === null) return;
        if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo de la anulación.', 'error'); return; }
        if (!await confirmar(`¿Anular la venta #${v.numero}? Los productos no devueltos volverán al inventario.`, { textoOk: 'Anular venta', peligro: true })) return;
        const boton = e.currentTarget;
        boton.disabled = true;
        try {
            exigirConexion();
            await api('panel_venta_anular', { p_datos: { clave: boton.dataset.clave || (boton.dataset.clave = nuevaClave()), venta_id: v.id, motivo: motivo.trim() } });
            ctx.notificar('Venta anulada');
            refrescar();
        } catch (fallo) { ctx.notificar(fallo.message, 'error'); boton.disabled = false; }
    });
}

// Desde la agenda: cobrar la cita o ver su venta
export async function abrirCobroDeCita(citaId, ctx, alTerminar) {
    let info;
    try { info = await api('panel_venta_de_cita', { p_cita: citaId }); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    if (info.venta && Number(info.venta.saldo) <= 0) abrirVenta(info.venta.id, ctx, alTerminar);
    else abrirCobro({ ctx, citaId, alTerminar });
}
