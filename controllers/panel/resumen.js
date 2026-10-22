// ==========================================
// PANEL: RESUMEN GENERAL
// ==========================================

import { api, esc, dinero, fechaLarga, fechaCorta, etiquetaEstado, vacio } from './comun.js';
import { abrirDetalle } from './agenda.js';

export async function renderResumen(cont, ctx) {
    cont.innerHTML = '<p class="panel-cargando">Cargando resumen…</p>';
    let r;
    try { r = await api('panel_resumen'); } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    const esAdmin = r.rol === 'admin';
    const tarjeta = (titulo, valor, icono, detalle = '', clase = '') =>
        `<article class="resumen-tarjeta ${clase}"><i class="fas fa-${icono}"></i><div><span>${esc(titulo)}</span><strong>${valor}</strong>${detalle ? `<small>${detalle}</small>` : ''}</div></article>`;
    const fila = c => `<button type="button" class="resumen-cita" data-cita="${esc(c.id)}">
        <span class="resumen-cita-hora">${esc(c.fecha === r.hoy ? c.hora : `${fechaCorta(c.fecha)} ${c.hora}`)}</span>
        <span><strong>${esc(c.cliente)}</strong><small>${esc(c.servicio || '')} · ${esc(c.barbero || '')}</small></span>
        ${etiquetaEstado(c)}</button>`;

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Resumen</h2><p class="panel-sub">${esc(fechaLarga(r.hoy))} · ${esc(r.ahora)} (hora de Santo Domingo)</p></div>
        </div>
        ${esAdmin ? `<div class="resumen-rapidos">
            <button type="button" class="panel-btn panel-btn-principal" data-ir="agenda" data-nueva><i class="fas fa-plus"></i> Nueva cita</button>
            <button type="button" class="panel-btn" data-ir="horarios" data-bloquear><i class="fas fa-lock"></i> Bloquear horario</button>
            <button type="button" class="panel-btn" data-ir="servicios" data-agregar><i class="fas fa-scissors"></i> Agregar servicio</button>
        </div>` : ''}
        <div class="resumen-tarjetas">
            ${tarjeta('Citas de hoy', r.citas_hoy, 'calendar-day', r.pendientes_hoy ? `${r.pendientes_hoy} por confirmar` : '')}
            ${tarjeta('Próximos 7 días', r.proximas, 'calendar-week')}
            ${tarjeta('Completadas', r.completadas_hoy, 'check-double', `${r.completadas_mes} este mes`)}
            ${tarjeta('Canceladas', r.canceladas_hoy, 'ban', `${r.canceladas_semana} en 7 días · ${r.no_asistio_mes} ausencias este mes`)}
            ${esAdmin ? tarjeta('Cobrado hoy', dinero(r.cobrado_hoy), 'cash-register', `${dinero(r.cobrado_mes)} este mes`, 'resumen-dinero') : ''}
            ${esAdmin ? tarjeta('Valor estimado de reservas', dinero(r.estimado_reservas), 'hourglass-half', 'Citas futuras aún no cobradas (no es ingreso)', 'resumen-estimado') : ''}
            ${esAdmin && r.completadas_sin_cobrar ? tarjeta('Completadas sin cobrar', r.completadas_sin_cobrar, 'triangle-exclamation', 'Registra el cobro en cada cita', 'resumen-alerta') : ''}
        </div>
        <div class="resumen-columnas">
            <section class="panel-caja">
                <h3>Agenda de hoy</h3>
                ${r.agenda_hoy.length ? r.agenda_hoy.map(fila).join('') : vacio('No hay citas hoy.', 'mug-hot')}
            </section>
            <section class="panel-caja">
                <h3>Próximas citas</h3>
                ${r.siguientes.length ? r.siguientes.map(fila).join('') : vacio('No hay próximas citas.', 'calendar')}
            </section>
        </div>`;

    cont.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrirDetalle(b.dataset.cita, ctx, () => renderResumen(cont, ctx))));
    cont.querySelector('[data-nueva]')?.addEventListener('click', () => ctx.irA('agenda', { abrirNueva: true }));
    cont.querySelector('[data-bloquear]')?.addEventListener('click', () => ctx.irA('horarios', { nuevoBloqueo: true }));
    cont.querySelector('[data-agregar]')?.addEventListener('click', () => ctx.irA('servicios', { nuevo: true }));
}
