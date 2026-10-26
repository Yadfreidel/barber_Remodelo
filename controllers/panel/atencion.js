// ==========================================
// PANEL: ATENCIÓN (iniciar y terminar servicios del día)
// Terminar usa el mismo «completar» de la agenda: no registra ningún pago.
// ==========================================

import { api, esc, hoyLocal, fechaLarga, confirmar, vacio, fechaHora } from './comun.js';
import { turnoDe } from './finanzas-comun.js';

const estado = { fecha: null, barbero: '' };
const minutos = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000));

export async function renderAtencion(cont, ctx) {
    const esAdmin = ctx.rol === 'admin';
    estado.fecha = estado.fecha || hoyLocal();
    const vigente = turnoDe(cont);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Atención</h2>
            <p class="panel-sub">Inicia y termina tus servicios. Terminar no registra el pago: el cobro se hace en caja.</p></div></div>
        <div class="agenda-filtros">
            <input type="date" data-fecha value="${esc(estado.fecha)}" aria-label="Fecha">
            ${esAdmin ? '<select data-barbero aria-label="Barbero"><option value="">Todos los barberos</option></select>' : ''}
        </div>
        <div data-lista><p class="panel-cargando">Cargando citas…</p></div>`;
    const recargar = () => renderAtencion(cont, ctx);
    cont.querySelector('[data-fecha]').addEventListener('change', e => { estado.fecha = e.target.value || hoyLocal(); recargar(); });
    let citas;
    try {
        const [lista, barberos] = await Promise.all([api('panel_atencion', { p_fecha: estado.fecha, p_barbero: estado.barbero || null }),
            esAdmin ? api('panel_barberos') : []]);
        citas = lista;
        const sel = cont.querySelector('[data-barbero]');
        if (sel) {
            sel.innerHTML += barberos.filter(b => b.activo).map(b => `<option value="${esc(b.id)}" ${String(b.id) === estado.barbero ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
            sel.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });
        }
    } catch (e) { if (vigente()) cont.querySelector('[data-lista]').innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const esHoy = estado.fecha === hoyLocal();
    cont.querySelector('[data-lista]').innerHTML = `<h3 class="atencion-dia">${esc(fechaLarga(estado.fecha))}</h3>` + (citas.length ? `<div class="atencion-lista">${citas.map(c => {
        const fase = c.no_asistio_en ? ['No asistió', 'estado-cancelada'] : c.completada_en ? ['Terminado', 'estado-confirmada']
            : c.iniciada_en ? ['En atención', 'estado-pendiente'] : ['Por atender', ''];
        return `<article class="atencion-cita">
            <div class="atencion-hora"><strong>${esc(c.hora)}</strong><small>${esc(c.duracion)} min</small></div>
            <div class="atencion-info"><strong>${esc(c.cliente)}</strong><span>${esc(c.servicio || '')}${esAdmin ? ` · ${esc(c.barbero || '')}` : ''}</span>
                ${c.notas ? `<small><i class="fas fa-note-sticky"></i> ${esc(c.notas)}</small>` : ''}
                <small><span class="estado-chip ${fase[1]}">${fase[0]}</span>
                ${c.iniciada_en ? ` Inicio ${esc(fechaHora(c.iniciada_en).split(' ').pop())}` : ''}
                ${c.iniciada_en && c.completada_en ? ` · Duración real ${minutos(c.iniciada_en, c.completada_en)} min` : ''}</small></div>
            <div class="atencion-acciones">
                ${esHoy && !c.iniciada_en && !c.completada_en && !c.no_asistio_en ? `<button type="button" class="panel-btn panel-btn-principal" data-iniciar="${esc(c.id)}"><i class="fas fa-play"></i> Iniciar</button>` : ''}
                ${!c.completada_en && !c.no_asistio_en ? `<button type="button" class="panel-btn" data-terminar="${esc(c.id)}"><i class="fas fa-flag-checkered"></i> Terminar</button>` : ''}
            </div></article>`;
    }).join('')}</div>` : vacio('No hay citas para atender este día.', 'mug-hot'));
    cont.querySelectorAll('[data-iniciar]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api('panel_cita_iniciar', { p_cita: b.dataset.iniciar }); ctx.notificar('Servicio iniciado'); recargar(); }
        catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
    cont.querySelectorAll('[data-terminar]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmar('¿Terminar el servicio? Queda como completado; el pago se registra aparte en caja.', { textoOk: 'Terminar' })) return;
        b.disabled = true;
        try { await api('panel_actualizar_cita', { p_cita: b.dataset.terminar, p_accion: 'completar', p_datos: {} }); ctx.notificar('Servicio terminado'); recargar(); }
        catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
}
