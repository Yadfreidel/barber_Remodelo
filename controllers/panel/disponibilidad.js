// ==========================================
// PANEL: MI DISPONIBILIDAD (barbero)
// Ve su horario y pide bloqueos, vacaciones o descansos. Nada cambia en la agenda hasta que
// el administrador lo aprueba, y aprobar no cancela citas: se gestionan aparte.
// ==========================================

import { api, esc, hoyLocal, fechaCorta, DIAS, vacio, confirmar } from './comun.js';
import { turnoDe } from './finanzas-comun.js';

export const TIPOS_DISPONIBILIDAD = { bloqueo: 'Bloqueo (día u horas)', vacaciones: 'Vacaciones (varios días)', descanso: 'Descanso semanal' };
const ESTADOS = { pendiente: ['Pendiente', 'estado-pendiente'], aprobada: ['Aprobada', 'estado-confirmada'], rechazada: ['Rechazada', 'estado-cancelada'], cancelada: ['Cancelada', ''] };

export function describirSolicitud(s) {
    const horas = s.hora_desde ? ` de ${s.hora_desde} a ${s.hora_hasta}` : ' (día completo)';
    if (s.tipo === 'descanso') return `Cada ${DIAS[s.dia].toLowerCase()} de ${s.hora_desde} a ${s.hora_hasta}`;
    return s.fecha_desde === s.fecha_hasta ? `${fechaCorta(s.fecha_desde)}${horas}` : `${fechaCorta(s.fecha_desde)} – ${fechaCorta(s.fecha_hasta)}${horas}`;
}
export const chipSolicitud = e => `<span class="estado-chip ${ESTADOS[e][1]}">${ESTADOS[e][0]}</span>`;

export async function renderDisponibilidad(cont, ctx) {
    const vigente = turnoDe(cont);
    cont.innerHTML = '<p class="panel-cargando">Cargando tu disponibilidad…</p>';
    let d;
    try { d = await api('panel_disponibilidad_mia'); }
    catch (e) { if (vigente()) cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const recargar = () => renderDisponibilidad(cont, ctx);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Mi disponibilidad</h2>
            <p class="panel-sub">Tu horario lo define la barbería. Pide aquí bloqueos, vacaciones o descansos: se aplican cuando el administrador los aprueba.</p></div></div>
        <div class="panel-caja"><h3>Horario semanal</h3>
            <div class="panel-tabla-envoltura"><table class="panel-tabla"><tbody>${[1, 2, 3, 4, 5, 6, 0].map(dia => {
                const h = d.horario.find(x => x.dia === dia);
                const descansos = d.descansos.filter(x => x.dia === dia).map(x => `${x.desde}–${x.hasta}`).join(', ');
                return `<tr><th scope="row">${DIAS[dia]}</th><td>${h?.abre ? `${esc(h.abre)} – ${esc(h.cierra)}` : 'Libre'}</td><td>${descansos ? `Descanso ${esc(descansos)}` : ''}</td></tr>`;
            }).join('')}</tbody></table></div>
            ${d.bloqueos.length ? `<p class="panel-sub">Próximos bloqueos: ${d.bloqueos.map(b => esc(describirSolicitud(b)) + (b.general ? ' (todo el negocio)' : '')).join(' · ')}</p>` : ''}
        </div>
        <div class="panel-caja"><h3>Solicitar un cambio</h3>
            <form class="panel-form" novalidate>
                <div class="panel-rejilla">
                    <label>Tipo<select name="tipo">${Object.entries(TIPOS_DISPONIBILIDAD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                    <label data-campo="fechas">Desde<input type="date" name="fecha_desde" min="${hoyLocal()}" value="${hoyLocal()}"></label>
                    <label data-campo="fechas">Hasta<input type="date" name="fecha_hasta" min="${hoyLocal()}" value="${hoyLocal()}"></label>
                    <label data-campo="dia" hidden>Día<select name="dia">${[1, 2, 3, 4, 5, 6, 0].map(x => `<option value="${x}">${DIAS[x]}</option>`).join('')}</select></label>
                    <label>Hora desde (vacío = día completo)<input type="time" name="hora_desde" step="1800"></label>
                    <label>Hora hasta<input type="time" name="hora_hasta" step="1800"></label>
                </div>
                <label>Motivo<input name="motivo" maxlength="300" placeholder="Ej.: cita médica"></label>
                <button type="submit" class="panel-btn panel-btn-principal">Enviar solicitud</button>
            </form></div>
        <div class="panel-caja"><h3>Mis solicitudes</h3>
            ${d.solicitudes.length ? `<ul class="disp-lista">${d.solicitudes.map(s => `<li>
                <span><strong>${esc(TIPOS_DISPONIBILIDAD[s.tipo])}</strong> · ${esc(describirSolicitud(s))}${s.motivo ? `<small>${esc(s.motivo)}</small>` : ''}
                    ${s.respuesta ? `<small>Respuesta: ${esc(s.respuesta)}</small>` : ''}
                    ${s.citas_afectadas ? `<small class="texto-negativo">${s.citas_afectadas} cita(s) tuya(s) caen en ese tiempo: la barbería las gestionará.</small>` : ''}</span>
                <span>${chipSolicitud(s.estado)} ${s.estado === 'pendiente' ? `<button type="button" class="panel-btn panel-btn-mini" data-cancelar="${esc(s.id)}">Retirar</button>` : ''}</span></li>`).join('')}</ul>`
                : vacio('No has enviado solicitudes.', 'clock')}</div>`;
    const form = cont.querySelector('form');
    const tipo = form.elements.tipo;
    const ajustar = () => {
        form.querySelectorAll('[data-campo="fechas"]').forEach(x => { x.hidden = tipo.value === 'descanso'; });
        form.querySelector('[data-campo="dia"]').hidden = tipo.value !== 'descanso';
    };
    tipo.addEventListener('change', ajustar);
    ajustar();
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        if (!!f.hora_desde.value !== !!f.hora_hasta.value || (f.hora_desde.value && f.hora_hasta.value <= f.hora_desde.value)) {
            ctx.notificar('Indica ambas horas, con la final después de la inicial.', 'error'); return;
        }
        if (tipo.value === 'descanso' && !f.hora_desde.value) { ctx.notificar('Un descanso necesita horas.', 'error'); return; }
        const datos = { tipo: tipo.value, motivo: f.motivo.value.trim(), hora_desde: f.hora_desde.value, hora_hasta: f.hora_hasta.value,
            ...(tipo.value === 'descanso' ? { dia: f.dia.value } : { fecha_desde: f.fecha_desde.value, fecha_hasta: tipo.value === 'bloqueo' ? f.fecha_desde.value : f.fecha_hasta.value }) };
        e.submitter.disabled = true;
        try {
            const r = await api('panel_disponibilidad_solicitar', { p_datos: datos });
            ctx.notificar(r.citas_afectadas ? `Solicitud enviada. Ojo: ${r.citas_afectadas} cita(s) caen en ese tiempo.` : 'Solicitud enviada');
            recargar();
        } catch (err) { ctx.notificar(err.message, 'error'); e.submitter.disabled = false; }
    });
    cont.querySelectorAll('[data-cancelar]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmar('¿Retirar esta solicitud?', { textoOk: 'Retirar' })) return;
        b.disabled = true;
        try { await api('panel_disponibilidad_cancelar', { p_id: b.dataset.cancelar }); recargar(); }
        catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
}
