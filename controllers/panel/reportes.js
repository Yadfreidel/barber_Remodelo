// ==========================================
// PANEL: COBROS Y REPORTES
// "Cobrado" = importes registrados como pagados. "Estimado" = valor de citas
// pendientes o confirmadas, que todavía no es ingreso.
// ==========================================

import { api, esc, dinero, hoyLocal, sumarDias, inicioSemana, inicioMes, finMes, fechaCorta, ESTADOS, etiquetaEstado, descargarCSV, vacio } from './comun.js';
import { exportarCitasCSV } from './agenda.js';
import { abrirCobroDeCita } from './ventas.js';

const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro', mixto: 'Mixto' };
let periodo = { tipo: 'mes', desde: null, hasta: null };

function calcularPeriodo() {
    const hoy = hoyLocal();
    if (periodo.tipo === 'hoy') return [hoy, hoy];
    if (periodo.tipo === 'semana') return [inicioSemana(hoy), sumarDias(inicioSemana(hoy), 6)];
    if (periodo.tipo === 'mes') return [inicioMes(hoy), finMes(hoy)];
    if (periodo.tipo === 'mes_anterior') { const ant = sumarDias(inicioMes(hoy), -1); return [inicioMes(ant), finMes(ant)]; }
    return [periodo.desde || inicioMes(hoy), periodo.hasta || hoy];
}

export async function renderReportes(cont, ctx) {
    const [desde, hasta] = calcularPeriodo();
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Reportes de citas</h2>
            <p class="panel-sub">Una cita completada no cuenta como cobrada hasta registrar su pago. Ventas de productos, caja y gastos: Reportes financieros.</p></div></div>
        <div class="agenda-filtros">
            <select data-periodo aria-label="Periodo">
                ${Object.entries({ hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', mes_anterior: 'Mes anterior', personalizado: 'Personalizado' })
                    .map(([k, v]) => `<option value="${k}" ${periodo.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <input type="date" data-desde value="${desde}" ${periodo.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Desde">
            <input type="date" data-hasta value="${hasta}" ${periodo.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Hasta">
            <button type="button" class="panel-btn" data-csv="citas"><i class="fas fa-file-csv"></i> Citas</button>
            <button type="button" class="panel-btn" data-csv="reporte"><i class="fas fa-file-csv"></i> Reporte</button>
        </div>
        <div data-cuerpo><p class="panel-cargando">Calculando…</p></div>`;

    cont.querySelector('[data-periodo]').addEventListener('change', e => { periodo.tipo = e.target.value; renderReportes(cont, ctx); });
    ['desde', 'hasta'].forEach(k => cont.querySelector(`[data-${k}]`).addEventListener('change', e => { periodo[k] = e.target.value; renderReportes(cont, ctx); }));

    const cuerpo = cont.querySelector('[data-cuerpo]');
    let r, citas;
    try {
        [r, citas] = await Promise.all([api('panel_reporte', { p_desde: desde, p_hasta: hasta }),
            api('panel_citas', { p_desde: desde, p_hasta: hasta, p_barbero: null, p_estado: null, p_busqueda: null })]);
    } catch (e) { cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    const t = r.totales;
    const sinCobrar = citas.filter(c => c.estado_visual === 'completada' && !c.pagada);
    const tabla = (titulo, filas, columnas) => `<section class="panel-caja"><h3>${titulo}</h3>${filas.length ? `
        <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr>${columnas.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${columnas.map(c => `<td data-titulo="${c[0]}">${c[1](f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : vacio('Sin datos en el periodo.', 'chart-simple')}</section>`;

    cuerpo.innerHTML = `
        <div class="resumen-tarjetas">
            <article class="resumen-tarjeta resumen-dinero"><i class="fas fa-cash-register"></i><div><span>Cobrado</span><strong>${dinero(t.cobrado)}</strong><small>${t.pagadas} cita(s) pagada(s)</small></div></article>
            <article class="resumen-tarjeta resumen-estimado"><i class="fas fa-hourglass-half"></i><div><span>Estimado pendiente</span><strong>${dinero(t.estimado)}</strong><small>Citas pendientes o confirmadas</small></div></article>
            <article class="resumen-tarjeta"><i class="fas fa-check-double"></i><div><span>Completadas</span><strong>${t.completadas}</strong><small>de ${t.citas} cita(s)</small></div></article>
            <article class="resumen-tarjeta ${t.completadas_sin_cobrar ? 'resumen-alerta' : ''}"><i class="fas fa-triangle-exclamation"></i><div><span>Completadas sin cobrar</span><strong>${t.completadas_sin_cobrar}</strong></div></article>
            <article class="resumen-tarjeta"><i class="fas fa-ban"></i><div><span>Cancelaciones</span><strong>${t.canceladas}</strong></div></article>
            <article class="resumen-tarjeta"><i class="fas fa-user-xmark"></i><div><span>Ausencias</span><strong>${t.no_asistio}</strong></div></article>
        </div>
        ${sinCobrar.length ? `<section class="panel-caja panel-aviso"><h3>Pendientes de cobro</h3><ul class="panel-lista">${sinCobrar.map(c => `
            <li>${esc(fechaCorta(c.fecha))} ${esc(c.hora)} · ${esc(c.cliente)} · ${esc(c.servicio)} · ${dinero(c.precio)}
                <button type="button" class="panel-btn panel-btn-mini" data-cita="${esc(c.id)}">Registrar cobro</button></li>`).join('')}</ul></section>` : ''}
        <div class="reportes-rejilla">
            ${tabla('Por barbero', r.por_barbero, [['Barbero', f => esc(f.barbero || '—')], ['Citas', f => f.citas], ['Completadas', f => f.completadas],
                ['Canceladas', f => f.canceladas], ['Ausencias', f => f.no_asistio], ['Cobrado', f => dinero(f.cobrado)]])}
            ${tabla('Por servicio', r.por_servicio, [['Servicio', f => esc(f.servicio || '—')], ['Citas', f => f.citas], ['Completadas', f => f.completadas], ['Cobrado', f => dinero(f.cobrado)]])}
            ${tabla('Por día', r.por_dia, [['Fecha', f => esc(fechaCorta(f.fecha))], ['Citas', f => f.citas], ['Completadas', f => f.completadas],
                ['Canceladas', f => f.canceladas], ['Ausencias', f => f.no_asistio], ['Cobrado', f => dinero(f.cobrado)]])}
            ${tabla('Por método de pago', Object.entries(r.por_metodo).map(([k, v]) => ({ k, v })), [['Método', f => esc(METODOS[f.k] || f.k)], ['Cobrado', f => dinero(f.v)]])}
        </div>
        ${tabla('Cancelaciones y ausencias', r.incidencias, [['Fecha', f => `${esc(fechaCorta(f.fecha))} ${esc(f.hora)}`], ['Cliente', f => `${esc(f.cliente)}<br><small>${esc(f.telefono)}</small>`],
            ['Servicio', f => esc(f.servicio || '')], ['Barbero', f => esc(f.barbero || '')], ['Tipo', f => etiquetaEstado({ estado_visual: f.tipo })], ['Motivo', f => esc(f.motivo || '—')]])}`;

    cuerpo.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrirCobroDeCita(b.dataset.cita, ctx, () => renderReportes(cont, ctx))));
    cont.querySelector('[data-csv="citas"]').addEventListener('click', () => exportarCitasCSV(citas, `citas-${desde}_${hasta}.csv`));
    cont.querySelector('[data-csv="reporte"]').addEventListener('click', () => descargarCSV(`reporte-${desde}_${hasta}.csv`, [
        ['Resumen', 'Valor'], ['Periodo', `${desde} a ${hasta}`], ['Citas', t.citas], ['Completadas', t.completadas], ['Canceladas', t.canceladas],
        ['Ausencias', t.no_asistio], ['Pagadas', t.pagadas], ['Completadas sin cobrar', t.completadas_sin_cobrar],
        ['Cobrado (RD$)', t.cobrado], ['Estimado pendiente (RD$)', t.estimado], [],
        ['Barbero', 'Citas', 'Completadas', 'Canceladas', 'Ausencias', 'Cobrado (RD$)'],
        ...r.por_barbero.map(f => [f.barbero, f.citas, f.completadas, f.canceladas, f.no_asistio, f.cobrado]), [],
        ['Servicio', 'Citas', 'Completadas', 'Cobrado (RD$)'], ...r.por_servicio.map(f => [f.servicio, f.citas, f.completadas, f.cobrado]), [],
        ['Fecha', 'Citas', 'Completadas', 'Canceladas', 'Ausencias', 'Cobrado (RD$)'], ...r.por_dia.map(f => [f.fecha, f.citas, f.completadas, f.canceladas, f.no_asistio, f.cobrado]), [],
        ['Método de pago', 'Cobrado (RD$)'], ...Object.entries(r.por_metodo).map(([k, v]) => [METODOS[k] || k, v]), [],
        ['Incidencia', 'Fecha', 'Hora', 'Cliente', 'Teléfono', 'Servicio', 'Barbero', 'Motivo'],
        ...r.incidencias.map(f => [ESTADOS[f.tipo], f.fecha, f.hora, f.cliente, f.telefono, f.servicio, f.barbero, f.motivo || ''])
    ]));
}
