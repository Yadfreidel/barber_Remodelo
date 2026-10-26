// ==========================================
// PANEL: RESUMEN FINANCIERO Y REPORTES
// Ventas, cobros, flujo de efectivo y margen estimado se muestran por separado.
// Nada se llama "ganancia neta": el margen estimado usa el costo de lo vendido
// (costo promedio ponderado) y se marca incompleto si faltan costos.
// ==========================================

import { api, esc, dinero, fechaHora, hoyLocal, vacio, descargarCSV } from './comun.js';
import { METODOS_PAGO, CATEGORIAS_GASTO, cantidad, rangoPeriodo, filtrosPeriodo, conectarPeriodo, turnoDe } from './finanzas-comun.js';
import { abrirCobro } from './ventas.js';

const periodo = { tipo: 'mes' };
let barbero = '';
const n = Number;

function indicadores(r) {
    const ventasBrutas = n(r.ventas_servicios) + n(r.ventas_productos);
    const ventasNetas = ventasBrutas - n(r.devoluciones);
    const cobradoNeto = n(r.cobros) - n(r.reembolsos);
    const costoVendido = n(r.costo_productos_vendidos.importe) + n(r.costo_consumos.importe);
    const incompleto = n(r.costo_productos_vendidos.movimientos_sin_costo) + n(r.costo_consumos.movimientos_sin_costo);
    return { ventasBrutas, ventasNetas, cobradoNeto, costoVendido, incompleto, margen: ventasNetas - costoVendido,
             flujo: cobradoNeto - n(r.gastos_total) - n(r.pagos_compras) };
}

function tarjeta(titulo, valor, explicacion, { icono = 'chart-simple', clase = '', nota = '' } = {}) {
    return `<article class="resumen-tarjeta ${clase}"><i class="fas fa-${icono}"></i><div><span>${esc(titulo)}</span><strong>${valor}</strong>
        ${nota ? `<small>${nota}</small>` : ''}<details class="fin-explica"><summary>¿Cómo se calcula?</summary><p>${esc(explicacion)}</p></details></div></article>`;
}

// ---------- Resumen ----------
export async function renderFinResumen(cont, ctx) {
    const vigente = turnoDe(cont);
    cont.innerHTML = '<p class="panel-cargando">Cargando resumen…</p>';
    const hoy = hoyLocal();
    let r, caja;
    try { [r, caja] = await Promise.all([api('panel_finanzas', { p_desde: hoy, p_hasta: hoy, p_barbero: null }), api('panel_caja_estado')]); }
    catch (e) { if (vigente()) cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const i = indicadores(r);
    const s = caja.abierta;
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Resumen financiero de hoy</h2>
            <p class="panel-sub">Ventas = lo vendido; cobros = el dinero recibido. No son lo mismo: puede haber saldos pendientes o anticipos.</p></div>
            <button type="button" class="panel-btn panel-btn-principal" data-cobrar><i class="fas fa-cash-register"></i> Nuevo cobro</button></div>
        <div class="resumen-tarjetas">
            ${tarjeta('Caja', s ? `Abierta · ${dinero(s.resumen.efectivo_esperado)}` : 'Cerrada', 'Efectivo esperado = fondo inicial + cobros en efectivo − reembolsos en efectivo + entradas − retiros − gastos pagados con la caja.',
                { icono: s ? 'lock-open' : 'lock', clase: s ? '' : 'resumen-alerta', nota: s ? `Caja #${s.numero} desde ${esc(fechaHora(s.abierta_en))}` : 'Ábrela para cobrar en efectivo' })}
            ${tarjeta('Vendido hoy', dinero(i.ventasBrutas), 'Servicios y productos de las ventas confirmadas hoy, después de descuentos y sin las anuladas.',
                { icono: 'receipt', nota: `Servicios ${dinero(r.ventas_servicios)} · Productos ${dinero(r.ventas_productos)}` })}
            ${tarjeta('Cobrado hoy', dinero(i.cobradoNeto), 'Pagos recibidos hoy (importe aplicado, sin el cambio entregado) menos reembolsos de hoy.',
                { icono: 'hand-holding-dollar', clase: 'resumen-dinero', nota: Object.entries(r.por_medio).map(([k, v]) => `${esc(METODOS_PAGO[k] || k)} ${dinero(v.cobros)}`).join(' · ') })}
            ${tarjeta('Saldos pendientes', dinero(r.saldos_pendientes.importe), 'Lo que falta por cobrar de todas las ventas confirmadas (no solo de hoy).',
                { icono: 'hourglass-half', clase: n(r.saldos_pendientes.importe) > 0 ? 'resumen-estimado' : '',
                  nota: `${r.saldos_pendientes.ventas} venta(s)${n(r.saldos_pendientes.citas_completadas_sin_venta) ? ` · ${r.saldos_pendientes.citas_completadas_sin_venta} cita(s) completada(s) sin cobro registrado` : ''}` })}
        </div>
        <section class="panel-caja ${r.existencias_bajas.length ? 'panel-aviso' : ''}"><h3>Existencias bajas y agotadas</h3>
            ${r.existencias_bajas.length ? `<ul class="panel-lista">${r.existencias_bajas.slice(0, 8).map(p => `<li><strong>${esc(p.nombre)}</strong> · ${p.agotado ? 'agotado' : `quedan ${esc(cantidad(p.existencia, p.unidad))} (mínimo ${esc(cantidad(p.minimo, p.unidad))})`}</li>`).join('')}</ul>
                <button type="button" class="panel-btn panel-btn-mini" data-ir="inventario">Ver inventario</button>` : '<p class="panel-sub">Todo en orden.</p>'}</section>
        <div class="panel-acciones panel-acciones-izq">
            <button type="button" class="panel-btn" data-ir="caja"><i class="fas fa-cash-register"></i> Caja</button>
            <button type="button" class="panel-btn" data-ir="gastos"><i class="fas fa-file-invoice-dollar"></i> Gastos</button>
            <button type="button" class="panel-btn" data-ir="fin-reportes"><i class="fas fa-chart-line"></i> Reportes</button></div>`;
    cont.querySelector('[data-cobrar]').addEventListener('click', () => abrirCobro({ ctx, alTerminar: () => renderFinResumen(cont, ctx) }));
    cont.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ctx.irA(b.dataset.ir)));
}

// ---------- Reportes ----------
export async function renderFinReportes(cont, ctx) {
    const [desde, hasta] = rangoPeriodo(periodo);
    const vigente = turnoDe(cont);
    cont.innerHTML = '<p class="panel-cargando">Calculando…</p>'; // nunca se ven cifras de otro periodo mientras carga
    let barberos = [];
    try { barberos = (await api('panel_venta_catalogo')).barberos; } catch { /* el filtro queda vacío */ }
    if (!vigente()) return;
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Reportes financieros</h2>
            <p class="panel-sub">Ventas, cobros, flujo de efectivo y margen estimado son indicadores distintos. Ninguno es la ganancia neta.</p></div></div>
        <div class="agenda-filtros">${filtrosPeriodo(periodo, [desde, hasta])}
            <select data-barbero aria-label="Barbero"><option value="">Todos los barberos</option>${barberos.map(b => `<option value="${esc(b.id)}" ${b.id === barbero ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select>
            <button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> Exportar CSV</button></div>
        <div data-cuerpo><p class="panel-cargando">Calculando…</p></div>`;
    const recargar = () => renderFinReportes(cont, ctx);
    conectarPeriodo(cont, periodo, recargar);
    cont.querySelector('[data-barbero]').addEventListener('change', e => { barbero = e.target.value; recargar(); });
    let r;
    try { r = await api('panel_finanzas', { p_desde: desde, p_hasta: hasta, p_barbero: barbero || null }); }
    catch (e) { if (vigente()) cont.querySelector('[data-cuerpo]').innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const i = indicadores(r);
    const tabla = (titulo, filas, columnas, explicacion = '') => `<section class="panel-caja"><h3>${titulo}</h3>${explicacion ? `<p class="panel-sub">${esc(explicacion)}</p>` : ''}${filas.length ? `
        <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr>${columnas.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${columnas.map(c => `<td data-titulo="${c[0]}">${c[1](f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : vacio('Sin datos en el periodo.', 'chart-simple')}</section>`;
    const filtroBarbero = barbero ? '<p class="panel-aviso">Filtrado por barbero: las ventas y servicios son solo los suyos. Los productos, gastos, caja e inventario no se atribuyen a un barbero.</p>' : '';
    cont.querySelector('[data-cuerpo]').innerHTML = `${filtroBarbero}
        <div class="resumen-tarjetas">
            ${tarjeta('Ventas de servicios', dinero(r.ventas_servicios), 'Importe de los servicios en ventas confirmadas del periodo (precio × cantidad − descuento). Las ventas anuladas no cuentan.', { icono: 'scissors' })}
            ${tarjeta('Ventas de productos', dinero(r.ventas_productos), 'Importe de los productos vendidos en el periodo, después de descuentos.', { icono: 'pump-soap' })}
            ${tarjeta('Descuentos', dinero(r.descuentos), 'Descuentos aplicados en las líneas vendidas del periodo (ya restados de las ventas).', { icono: 'tag' })}
            ${tarjeta('Devoluciones', dinero(r.devoluciones), 'Valor de servicios y productos devueltos en el periodo.', { icono: 'rotate-left' })}
            ${tarjeta('Cobrado (neto)', dinero(i.cobradoNeto), 'Dinero recibido en el periodo (importe aplicado; el cambio entregado no cuenta) menos reembolsos del periodo. Un anticipo cuenta una sola vez, cuando se recibe.',
                { icono: 'hand-holding-dollar', clase: 'resumen-dinero', nota: `Cobros ${dinero(r.cobros)} · Reembolsos ${dinero(r.reembolsos)}${n(r.anticipos) ? ` · incluye anticipos ${dinero(r.anticipos)}` : ''}` })}
            ${tarjeta('Saldos pendientes', dinero(r.saldos_pendientes.importe), 'Lo que falta por cobrar hoy de todas las ventas confirmadas (no depende del periodo).',
                { icono: 'hourglass-half', clase: 'resumen-estimado', nota: `${r.saldos_pendientes.ventas} venta(s) · ${r.saldos_pendientes.citas_completadas_sin_venta} cita(s) completada(s) sin cobro` })}
            ${tarjeta('Gastos', dinero(r.gastos_total), 'Gastos registrados en el periodo, sin los anulados ni los pagos de compras de mercancía.', { icono: 'file-invoice-dollar' })}
            ${tarjeta('Pagos de compras', dinero(r.pagos_compras), 'Pagos a proveedores por mercancía. Recibir mercancía no es pagarla: la mercancía recibida se muestra aparte.',
                { icono: 'truck', nota: `Mercancía recibida: ${dinero(r.compras_recibidas)}` })}
            ${tarjeta('Flujo de efectivo', dinero(i.flujo), 'Cobrado neto − gastos − pagos de compras del periodo, en todos los medios de pago. Muestra el movimiento de dinero, no la ganancia.',
                { icono: 'money-bill-transfer', clase: i.flujo < 0 ? 'resumen-alerta' : '' })}
            ${tarjeta('Margen estimado', dinero(i.margen), 'Ventas netas (ventas − devoluciones) − costo de los productos vendidos − costo de los insumos consumidos, valorados al costo promedio ponderado de cada movimiento. No incluye gastos: no es la ganancia neta.',
                { icono: 'scale-balanced', clase: i.incompleto ? 'resumen-alerta' : '',
                  nota: i.incompleto ? `<strong>Incompleto:</strong> ${i.incompleto} movimiento(s) sin costo registrado` : `Costo de lo vendido y consumido: ${dinero(i.costoVendido)}` })}
            ${tarjeta('Valor del inventario', dinero(r.inventario.valor_al_costo), 'Existencia actual × costo promedio ponderado de cada artículo (no depende del periodo).',
                { icono: 'warehouse', nota: n(r.inventario.articulos_sin_costo) ? `<strong>Incompleto:</strong> ${r.inventario.articulos_sin_costo} artículo(s) sin costo` : '' })}
        </div>
        <div class="reportes-rejilla">
            ${tabla('Cobros por medio de pago', Object.entries(r.por_medio).map(([k, v]) => ({ k, ...v })), [['Medio', f => esc(METODOS_PAGO[f.k] || f.k)], ['Cobros', f => dinero(f.cobros)], ['Reembolsos', f => dinero(f.reembolsos)], ['Neto', f => dinero(n(f.cobros) - n(f.reembolsos))]],
                'Tarjeta y transferencia no forman parte del efectivo de la caja.')}
            ${tabla('Gastos por categoría', Object.entries(r.gastos).map(([k, v]) => ({ k, v })), [['Categoría', f => esc(CATEGORIAS_GASTO[f.k] || f.k)], ['Importe', f => dinero(f.v)]])}
            ${tabla('Servicios por barbero', r.servicios_por_barbero, [['Barbero', f => esc(f.barbero)], ['Servicios vendidos', f => esc(cantidad(f.servicios_vendidos))], ['Importe', f => dinero(f.importe)], ['Citas completadas', f => esc(f.citas_completadas)]],
                'Servicios en ventas del periodo y citas completadas en el periodo. No hay comisiones configuradas en el sistema.')}
            ${tabla('Productos más vendidos', r.productos_mas_vendidos, [['Producto', f => esc(f.producto)], ['Cantidad', f => esc(cantidad(f.cantidad))], ['Importe', f => dinero(f.importe)]], 'Netos de devoluciones.')}
        </div>
        ${tabla('Existencias bajas y agotadas', r.existencias_bajas, [['Artículo', f => `${esc(f.nombre)}<br><small>${esc(f.codigo)}</small>`], ['Existencia', f => esc(cantidad(f.existencia, f.unidad))], ['Mínimo', f => esc(cantidad(f.minimo, f.unidad))], ['Estado', f => f.agotado ? 'Agotado' : 'Bajo']])}
        ${tabla('Cierres de caja', r.cierres, [['Caja', f => `#${esc(f.numero)}`], ['Cierre', f => esc(fechaHora(f.cerrada_en))], ['Esperado', f => dinero(f.esperado)], ['Contado', f => dinero(f.contado)],
            ['Diferencia', f => dinero(f.diferencia)], ['Observación', f => `${esc(f.observacion || '—')}${f.corregido ? '<br><small>Con corrección registrada</small>' : ''}`]])}
        <p class="panel-sub">Historial de movimientos de inventario: Inventario › Movimientos. Comprobantes internos: no son comprobantes fiscales; el negocio no tiene impuestos configurados.</p>`;
    cont.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`finanzas-${desde}_${hasta}${barbero ? '-barbero' : ''}.csv`, [
        ['Indicador', 'Valor (RD$)', 'Cómo se calcula'],
        ['Periodo', `${desde} a ${hasta}`, barbero ? 'Filtrado por barbero (solo sus servicios)' : 'Todos'],
        ['Ventas de servicios', r.ventas_servicios, 'Servicios en ventas confirmadas, después de descuentos'],
        ['Ventas de productos', r.ventas_productos, 'Productos en ventas confirmadas, después de descuentos'],
        ['Descuentos', r.descuentos, 'Descuentos aplicados en las líneas'],
        ['Devoluciones', r.devoluciones, 'Valor devuelto en el periodo'],
        ['Cobros', r.cobros, 'Importe aplicado de los pagos (sin el cambio)'],
        ['Reembolsos', r.reembolsos, 'Dinero devuelto'],
        ['Cobrado neto', i.cobradoNeto, 'Cobros − reembolsos'],
        ['Anticipos (incluidos en cobros)', r.anticipos, 'Pagos recibidos antes de completar el servicio'],
        ['Saldos pendientes (actual)', r.saldos_pendientes.importe, 'Por cobrar de todas las ventas'],
        ['Gastos', r.gastos_total, 'Sin anulados ni pagos de compras'],
        ['Pagos de compras', r.pagos_compras, 'Pagos a proveedores por mercancía'],
        ['Mercancía recibida', r.compras_recibidas, 'Recepciones del periodo (no son pagos)'],
        ['Flujo de efectivo', i.flujo, 'Cobrado neto − gastos − pagos de compras'],
        ['Costo de productos vendidos', r.costo_productos_vendidos.importe, 'Costo promedio ponderado de cada salida por venta'],
        ['Costo de insumos consumidos', r.costo_consumos.importe, 'Costo promedio ponderado de cada consumo'],
        ['Margen estimado', i.margen, i.incompleto ? `INCOMPLETO: ${i.incompleto} movimiento(s) sin costo` : 'Ventas netas − costo de lo vendido y consumido (no es ganancia neta)'],
        ['Valor del inventario al costo (actual)', r.inventario.valor_al_costo, n(r.inventario.articulos_sin_costo) ? `INCOMPLETO: ${r.inventario.articulos_sin_costo} artículo(s) sin costo` : 'Existencia × costo promedio'],
        [],
        ['Medio de pago', 'Cobros (RD$)', 'Reembolsos (RD$)'], ...Object.entries(r.por_medio).map(([k, v]) => [METODOS_PAGO[k] || k, v.cobros, v.reembolsos]), [],
        ['Categoría de gasto', 'Importe (RD$)'], ...Object.entries(r.gastos).map(([k, v]) => [CATEGORIAS_GASTO[k] || k, v]), [],
        ['Barbero', 'Servicios vendidos', 'Importe (RD$)', 'Citas completadas'], ...r.servicios_por_barbero.map(f => [f.barbero, f.servicios_vendidos, f.importe, f.citas_completadas]), [],
        ['Producto', 'Cantidad', 'Importe (RD$)'], ...r.productos_mas_vendidos.map(f => [f.producto, f.cantidad, f.importe]), [],
        ['Artículo con existencia baja', 'Código', 'Existencia', 'Mínimo', 'Unidad'], ...r.existencias_bajas.map(f => [f.nombre, f.codigo, f.existencia, f.minimo, f.unidad]), [],
        ['Caja', 'Cierre', 'Esperado (RD$)', 'Contado (RD$)', 'Diferencia (RD$)', 'Observación', 'Corregido'],
        ...r.cierres.map(f => [f.numero, fechaHora(f.cerrada_en), f.esperado, f.contado, f.diferencia, f.observacion || '', f.corregido ? 'Sí' : 'No'])]));
}
