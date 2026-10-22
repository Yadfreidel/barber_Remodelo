// ==========================================
// PANEL: HORARIOS Y DISPONIBILIDAD
// ==========================================

import { api, esc, DIAS, hoyLocal, fechaCorta, dialogo, confirmar, ejecutar, vacio } from './comun.js';

const TIPOS = { bloqueo: 'Bloqueo', vacaciones: 'Vacaciones', feriado: 'Feriado', cierre: 'Cierre especial' };
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
let alcance = '*';

export async function renderHorarios(cont, ctx, opciones = {}) {
    cont.innerHTML = '<p class="panel-cargando">Cargando horarios…</p>';
    let datos, barberos;
    try {
        [datos, barberos] = await Promise.all([api('panel_horarios'), api('panel_barberos')]);
    } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (opciones.barbero) alcance = opciones.barbero;
    const nombreBarbero = id => barberos.find(b => b.id === id)?.nombre || 'Barbero';
    const r = datos.reglas;

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Horarios y disponibilidad</h2><p class="panel-sub">Zona horaria: ${esc(r.zona_horaria)}. La web solo ofrece horas que cumplen todas estas reglas según la duración del servicio.</p></div>
            <button type="button" class="panel-btn panel-btn-principal" data-nuevo-bloqueo><i class="fas fa-lock"></i> Bloquear horario</button>
        </div>

        <section class="panel-caja">
            <h3>Reglas de reserva</h3>
            <form class="panel-form" data-reglas novalidate>
                <div class="panel-rejilla panel-rejilla-4">
                    <label>Apertura general<input type="time" name="hora_apertura" value="${esc(r.hora_apertura)}"></label>
                    <label>Cierre general<input type="time" name="hora_cierre" value="${esc(r.hora_cierre)}"></label>
                    <label>Intervalo entre horas ofrecidas (min)<input type="number" name="intervalo_minutos" min="5" max="240" value="${esc(r.intervalo_minutos)}"></label>
                    <label>Tiempo entre citas (min)<input type="number" name="minutos_entre_citas" min="0" max="120" value="${esc(r.minutos_entre_citas ?? 0)}"></label>
                    <label>Anticipación mínima (min)<input type="number" name="anticipacion_minima_minutos" min="0" max="20160" value="${esc(r.anticipacion_minima_minutos ?? 0)}"></label>
                    <label>Reservar hasta (días, 0 = sin límite)<input type="number" name="max_dias_reserva" min="0" max="365" value="${esc(r.max_dias_reserva ?? 0)}"></label>
                    <label>Cambios del cliente hasta (horas antes)<input type="number" name="horas_minimas_cambio" min="0" max="168" value="${esc(r.horas_minimas_cambio ?? 1)}"></label>
                </div>
                <p class="panel-sub">La apertura y el cierre generales se usan los días sin horario semanal configurado. La anticipación y el límite de días solo aplican a reservas de clientes; desde administración puedes agendar en cualquier momento libre.</p>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar reglas</button>
            </form>
        </section>

        <section class="panel-caja">
            <div class="panel-encabezado-caja">
                <h3>Horario semanal</h3>
                <select data-alcance aria-label="Horario de">
                    <option value="*">General del negocio</option>
                    ${barberos.map(b => `<option value="${esc(b.id)}" ${alcance === b.id ? 'selected' : ''}>${esc(b.nombre)}${b.activo ? '' : ' (inactivo)'}</option>`).join('')}
                </select>
            </div>
            <form class="panel-form" data-semana novalidate></form>
        </section>

        <section class="panel-caja">
            <h3>Vacaciones, feriados, cierres y bloqueos</h3>
            ${datos.bloqueos.length ? `<ul class="panel-lista">${datos.bloqueos.map(b => `
                <li>
                    <span class="estado-chip estado-${b.tipo === 'bloqueo' ? 'pendiente' : 'cancelada'}">${esc(TIPOS[b.tipo])}</span>
                    <strong>${b.fecha_desde === b.fecha_hasta ? esc(fechaCorta(b.fecha_desde)) : `${esc(fechaCorta(b.fecha_desde))} – ${esc(fechaCorta(b.fecha_hasta))}`}</strong>
                    ${b.hora_desde ? `${esc(b.hora_desde)}–${esc(b.hora_hasta)}` : 'día completo'}
                    · ${b.barbero_id ? esc(nombreBarbero(b.barbero_id)) : 'Todo el negocio'}
                    ${b.motivo ? `<small>· ${esc(b.motivo)}</small>` : ''}
                    <button type="button" class="panel-btn panel-btn-peligro" data-quitar="${esc(b.id)}">Quitar</button>
                </li>`).join('')}</ul>` : vacio('No hay bloqueos activos.', 'lock-open')}
        </section>`;

    const recargar = () => renderHorarios(cont, ctx);

    cont.querySelector('[data-reglas]').addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const datosReglas = { hora_apertura: d.hora_apertura, hora_cierre: d.hora_cierre };
        for (const k of ['intervalo_minutos', 'minutos_entre_citas', 'anticipacion_minima_minutos', 'max_dias_reserva', 'horas_minimas_cambio']) datosReglas[k] = Number(d[k]);
        if (await ejecutar(e.submitter, () => api('panel_guardar_reglas', { p_datos: datosReglas }), ctx.notificar, 'Reglas guardadas')) recargar();
    });

    const formSemana = cont.querySelector('[data-semana]');
    const pintarSemana = () => {
        const propias = datos.semana.filter(s => s.barbero_id === alcance);
        const generales = datos.semana.filter(s => s.barbero_id === '*');
        const usaGeneral = alcance !== '*' && !propias.length;
        const base = propias.length ? propias : generales;
        const descansos = datos.descansos.filter(d => (d.barbero_id || '*') === (propias.length || alcance === '*' ? alcance : '*'));
        formSemana.innerHTML = `
            ${alcance === '*' && !generales.length ? `<p class="panel-sub">Sin horario semanal: todos los días se usa ${esc(r.hora_apertura)}–${esc(r.hora_cierre)}. Configúralo para cerrar días o variar horas.</p>` : ''}
            ${usaGeneral ? '<p class="panel-sub">Este barbero usa el horario general. Edita y guarda para darle un horario propio.</p>' : ''}
            <div class="horario-dias">${ORDEN_DIAS.map(dia => {
                const fila = base.find(s => s.dia === dia);
                const abierto = fila ? fila.activo : true;
                return `<fieldset class="horario-dia" data-dia="${dia}">
                    <legend>${DIAS[dia]}</legend>
                    <label class="panel-check"><input type="checkbox" name="activo" ${abierto ? 'checked' : ''}> Abierto</label>
                    <label>Abre<input type="time" name="abre" value="${esc(fila?.abre || r.hora_apertura)}"></label>
                    <label>Cierra<input type="time" name="cierra" value="${esc(fila?.cierra || r.hora_cierre)}"></label>
                    <div class="horario-descansos">${descansos.filter(d => d.dia === dia).map(d => filaDescanso(d.desde, d.hasta)).join('')}</div>
                    <button type="button" class="panel-btn panel-btn-mini" data-agregar-descanso><i class="fas fa-mug-hot"></i> Descanso</button>
                </fieldset>`;
            }).join('')}</div>
            <div class="panel-acciones panel-acciones-izq">
                <button type="submit" class="panel-btn panel-btn-principal">Guardar horario ${alcance === '*' ? 'general' : `de ${esc(nombreBarbero(alcance))}`}</button>
                ${alcance !== '*' && propias.length ? '<button type="button" class="panel-btn" data-restablecer>Usar horario general</button>' : ''}
                ${alcance === '*' && generales.length ? '<button type="button" class="panel-btn" data-restablecer>Quitar horario semanal</button>' : ''}
            </div>`;
        formSemana.querySelectorAll('[data-agregar-descanso]').forEach(b => b.addEventListener('click', () => {
            b.previousElementSibling.insertAdjacentHTML('beforeend', filaDescanso('13:00', '14:00'));
        }));
        formSemana.querySelector('[data-restablecer]')?.addEventListener('click', async e => {
            if (!await confirmar('Se quitará este horario semanal y se usará el general. ¿Continuar?', { textoOk: 'Restablecer' })) return;
            if (await ejecutar(e.currentTarget, () => api('panel_guardar_semana', { p_barbero: alcance, p_dias: null }), ctx.notificar, 'Horario restablecido')) recargar();
        });
    };
    formSemana.addEventListener('click', e => { if (e.target.closest('[data-quitar-descanso]')) e.target.closest('.horario-descanso').remove(); });
    formSemana.addEventListener('submit', async e => {
        e.preventDefault();
        const dias = [...formSemana.querySelectorAll('.horario-dia')].map(f => ({
            dia: Number(f.dataset.dia),
            activo: f.querySelector('[name="activo"]').checked,
            abre: f.querySelector('[name="abre"]').value,
            cierra: f.querySelector('[name="cierra"]').value,
            descansos: [...f.querySelectorAll('.horario-descanso')].map(d => ({ desde: d.querySelector('[name="desde"]').value, hasta: d.querySelector('[name="hasta"]').value }))
        }));
        const malo = dias.find(d => d.activo && (!d.abre || !d.cierra || d.cierra <= d.abre));
        if (malo) { ctx.notificar(`${DIAS[malo.dia]}: el cierre debe ser posterior a la apertura.`, 'error'); return; }
        if (await ejecutar(e.submitter, () => api('panel_guardar_semana', { p_barbero: alcance, p_dias: dias }), ctx.notificar, 'Horario semanal guardado')) recargar();
    });
    cont.querySelector('[data-alcance]').addEventListener('change', e => { alcance = e.target.value; pintarSemana(); });
    pintarSemana();

    cont.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmar('¿Quitar este bloqueo? Esas horas volverán a estar disponibles.', { textoOk: 'Quitar bloqueo', peligro: true })) return;
        if (await ejecutar(b, () => api('panel_desactivar_bloqueo', { p_id: b.dataset.quitar }), ctx.notificar, 'Bloqueo quitado')) recargar();
    }));
    cont.querySelector('[data-nuevo-bloqueo]').addEventListener('click', () => abrirBloqueo(ctx, barberos, recargar));
    if (opciones.nuevoBloqueo) abrirBloqueo(ctx, barberos, recargar);
}

function filaDescanso(desde, hasta) {
    return `<div class="horario-descanso"><input type="time" name="desde" value="${esc(desde)}" aria-label="Descanso desde">
        <span>a</span><input type="time" name="hasta" value="${esc(hasta)}" aria-label="Descanso hasta">
        <button type="button" class="panel-icono" data-quitar-descanso aria-label="Quitar descanso"><i class="fas fa-times"></i></button></div>`;
}

function abrirBloqueo(ctx, barberos, recargar) {
    const hoy = hoyLocal();
    const { cuerpo, cerrar } = dialogo({ titulo: 'Bloquear horario', html: `
        <form class="panel-form" novalidate>
            <div class="panel-rejilla">
                <label>Tipo<select name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                <label>Aplica a<select name="barbero_id"><option value="">Todo el negocio</option>
                    ${barberos.filter(b => b.activo).map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('')}</select></label>
                <label>Desde<input type="date" name="fecha_desde" value="${hoy}" min="${hoy}" required></label>
                <label>Hasta<input type="date" name="fecha_hasta" value="${hoy}" min="${hoy}" required></label>
            </div>
            <label class="panel-check"><input type="checkbox" name="dia_completo" checked> Día(s) completo(s)</label>
            <div class="panel-rejilla" data-horas hidden>
                <label>Hora inicio<input type="time" name="hora_desde" value="12:00"></label>
                <label>Hora fin<input type="time" name="hora_hasta" value="13:00"></label>
            </div>
            <label>Motivo (opcional)<input name="motivo" maxlength="200" placeholder="Ej.: Día de la Independencia"></label>
            <p class="panel-sub">Las citas ya reservadas en ese periodo no se cancelan solas: se mostrarán para que decidas.</p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar bloqueo</button></div>
            <div data-afectadas></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    form.elements.dia_completo.addEventListener('change', e => { form.querySelector('[data-horas]').hidden = e.target.checked; });
    form.elements.fecha_desde.addEventListener('change', e => { if (form.elements.fecha_hasta.value < e.target.value) form.elements.fecha_hasta.value = e.target.value; });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        if (!d.fecha_desde || !d.fecha_hasta || d.fecha_hasta < d.fecha_desde) { ctx.notificar('Revisa las fechas.', 'error'); return; }
        const completo = form.elements.dia_completo.checked;
        if (!completo && (!d.hora_desde || !d.hora_hasta || d.hora_hasta <= d.hora_desde)) { ctx.notificar('La hora fin debe ser posterior a la de inicio.', 'error'); return; }
        const r = await ejecutar(e.submitter, () => api('panel_guardar_bloqueo', { p_datos: {
            tipo: d.tipo, barbero_id: d.barbero_id || null, fecha_desde: d.fecha_desde, fecha_hasta: d.fecha_hasta,
            hora_desde: completo ? null : d.hora_desde, hora_hasta: completo ? null : d.hora_hasta, motivo: d.motivo } }), ctx.notificar, 'Bloqueo guardado');
        if (!r) return;
        if (!r.citas_afectadas.length) { cerrar(); recargar(); return; }
        form.querySelector('[type="submit"]').disabled = true;
        form.querySelector('[data-afectadas]').innerHTML = `
            <div class="panel-aviso"><strong>${r.citas_afectadas.length} cita(s) ya reservada(s) dentro del bloqueo.</strong>
            Siguen activas: reprográmalas o cancélalas desde la Agenda.
            <ul>${r.citas_afectadas.map(c => `<li>${esc(fechaCorta(c.fecha))} ${esc(c.hora)} · ${esc(c.cliente)} · ${esc(c.barbero)}
                <button type="button" class="panel-btn panel-btn-mini" data-ver="${esc(c.id)}">Abrir</button></li>`).join('')}</ul></div>`;
        form.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => { cerrar(); ctx.irA('agenda', { abrirCita: b.dataset.ver, fecha: r.citas_afectadas.find(c => c.id === b.dataset.ver).fecha }); }));
        recargar();
    });
}
