// ==========================================
// PANEL: SOLICITUDES (administrador)
// Acceso profesional: aprobar vincula la cuenta con un perfil (existente o nuevo) sin tocar su contraseña.
// Disponibilidad: aprobar crea el bloqueo o descanso; las citas afectadas NO se cancelan.
// ==========================================

import { api, esc, fechaHora, vacio, dialogo, confirmar } from './comun.js';
import { invalidarCatalogosAgenda } from './agenda.js';
import { TIPOS_DISPONIBILIDAD, describirSolicitud, chipSolicitud } from './disponibilidad.js';

let sub = 'accesos';

export async function renderSolicitudes(cont, ctx) {
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Solicitudes</h2>
            <p class="panel-sub">Accesos profesionales y cambios de disponibilidad pedidos por los barberos.</p></div></div>
        <div class="panel-segmentos" role="tablist">
            <button type="button" role="tab" data-sub="accesos" aria-selected="${sub === 'accesos'}">Acceso profesional</button>
            <button type="button" role="tab" data-sub="disponibilidad" aria-selected="${sub === 'disponibilidad'}">Disponibilidad</button></div>
        <div data-cuerpo><p class="panel-cargando">Cargando…</p></div>`;
    cont.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { sub = b.dataset.sub; renderSolicitudes(cont, ctx); }));
    const cuerpo = cont.querySelector('[data-cuerpo]');
    const recargar = () => renderSolicitudes(cont, ctx);
    try {
        if (sub === 'accesos') await accesos(cuerpo, ctx, recargar);
        else await disponibilidad(cuerpo, ctx, recargar);
    } catch (e) { cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; }
}

async function accesos(cuerpo, ctx, recargar) {
    const [lista, barberos, cuentas] = await Promise.all([api('panel_solicitudes_profesionales', { p_estado: '' }), api('panel_barberos'),
        api('panel_cuentas_barberos')]);
    const libres = barberos.filter(b => !cuentas.some(c => c.barbero_id === String(b.id)));
    cuerpo.innerHTML = lista.length ? `<ul class="disp-lista">${lista.map(s => `<li>
        <span><strong>${esc(s.nombre)}</strong> · ${esc(s.email)} ${s.verificado ? '<span class="estado-chip estado-confirmada">Correo verificado</span>' : '<span class="estado-chip estado-pendiente">Correo sin verificar</span>'}
            ${s.telefono ? `<small>${esc(s.telefono)}</small>` : ''}${s.mensaje ? `<small>«${esc(s.mensaje)}»</small>` : ''}
            <small>${esc(fechaHora(s.creado_en))}${s.barbero ? ` · Vinculada con ${esc(s.barbero)}` : ''}${s.respuesta ? ` · ${esc(s.respuesta)}` : ''}</small></span>
        <span>${chipSolicitud(s.estado)}
            ${s.estado === 'pendiente' ? `<button type="button" class="panel-btn panel-btn-mini panel-btn-principal" data-aprobar="${esc(s.id)}">Aprobar</button>
                <button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-rechazar="${esc(s.id)}">Rechazar</button>` : ''}</span></li>`).join('')}</ul>`
        : vacio('No hay solicitudes de acceso profesional.', 'user-plus');
    cuerpo.querySelectorAll('[data-rechazar]').forEach(b => b.addEventListener('click', async () => {
        const respuesta = window.prompt('Motivo del rechazo (la persona lo verá):', '');
        if (respuesta === null) return;
        b.disabled = true;
        try { await api('panel_solicitud_resolver', { p_id: b.dataset.rechazar, p_datos: { accion: 'rechazar', respuesta } }); ctx.notificar('Solicitud rechazada'); recargar(); }
        catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
    cuerpo.querySelectorAll('[data-aprobar]').forEach(b => b.addEventListener('click', () => {
        const s = lista.find(x => x.id === b.dataset.aprobar);
        const { cuerpo: d, cerrar } = dialogo({ titulo: `Aprobar a ${s.nombre}`, ancho: 'md', html: `
            <form class="panel-form" novalidate>
                <p class="panel-sub">Vincula la cuenta ${esc(s.email)} con un perfil. Su contraseña no cambia.</p>
                <label>Perfil<select name="barbero"><option value="">Elige un perfil sin cuenta…</option>
                    ${libres.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}${x.activo ? '' : ' (inactivo)'}</option>`).join('')}
                    <option value="__nuevo">Crear perfil nuevo «${esc(s.nombre)}»</option></select></label>
                <label class="panel-check"><input type="checkbox" name="cajero"> Permiso adicional de cajero (cobrar y caja del día)</label>
                <label>Mensaje (opcional)<input name="respuesta" maxlength="300"></label>
                <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Aprobar</button></div>
            </form>` });
        d.querySelector('form').addEventListener('submit', async e => {
            e.preventDefault();
            const f = e.target.elements;
            if (!f.barbero.value) { ctx.notificar('Elige el perfil.', 'error'); return; }
            e.submitter.disabled = true;
            try {
                let barbero = f.barbero.value;
                if (barbero === '__nuevo') {
                    // Perfil nuevo con los servicios activos; luego se ajusta en Barberos
                    const servicios = (await api('panel_servicios')).filter(x => x.activo).map(x => x.id);
                    barbero = (await api('panel_guardar_barbero', { p_id: null, p_datos: { nombre: s.nombre, especialidad: '', foto_url: '', activo: true, servicios } })).id;
                    invalidarCatalogosAgenda();
                }
                await api('panel_solicitud_resolver', { p_id: s.id, p_datos: { accion: 'aprobar', barbero_id: String(barbero), respuesta: f.respuesta.value.trim(),
                    permisos: f.cajero.checked ? ['cajero'] : [] } });
                ctx.notificar('Acceso aprobado');
                cerrar();
                recargar();
            } catch (err) { ctx.notificar(err.message, 'error'); e.submitter.disabled = false; }
        });
    }));
}

async function disponibilidad(cuerpo, ctx, recargar) {
    const lista = await api('panel_disponibilidad_solicitudes', { p_estado: '' });
    cuerpo.innerHTML = lista.length ? `<ul class="disp-lista">${lista.map(s => `<li>
        <span><strong>${esc(s.barbero)}</strong> · ${esc(TIPOS_DISPONIBILIDAD[s.tipo])}: ${esc(describirSolicitud(s))}
            ${s.motivo ? `<small>${esc(s.motivo)}</small>` : ''}${s.respuesta ? `<small>Respuesta: ${esc(s.respuesta)}</small>` : ''}
            ${s.citas_afectadas ? `<small class="texto-negativo">${s.citas_afectadas} cita(s) activa(s) caen en ese tiempo. Aprobar no las cancela: reprográmalas desde la Agenda.</small>` : ''}
            <small>${esc(fechaHora(s.creado_en))}</small></span>
        <span>${chipSolicitud(s.estado)}
            ${s.estado === 'pendiente' ? `${s.citas_afectadas && s.fecha_desde ? `<button type="button" class="panel-btn panel-btn-mini" data-agenda="${esc(s.fecha_desde)}" data-barbero="${esc(s.barbero_id)}">Ver agenda</button>` : ''}
                <button type="button" class="panel-btn panel-btn-mini panel-btn-principal" data-resolver="${esc(s.id)}" data-aprobar="1">Aprobar</button>
                <button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-resolver="${esc(s.id)}">Rechazar</button>` : ''}</span></li>`).join('')}</ul>`
        : vacio('No hay solicitudes de disponibilidad.', 'clock');
    cuerpo.querySelectorAll('[data-agenda]').forEach(b => b.addEventListener('click', () => ctx.irA('agenda', { fecha: b.dataset.agenda, barbero: b.dataset.barbero, vista: 'dia' })));
    cuerpo.querySelectorAll('[data-resolver]').forEach(b => b.addEventListener('click', async () => {
        const aprobar = Boolean(b.dataset.aprobar);
        const s = lista.find(x => x.id === b.dataset.resolver);
        if (aprobar && !await confirmar(`¿Aprobar? Se aplicará en la agenda de ${s.barbero}.${s.citas_afectadas ? ` ${s.citas_afectadas} cita(s) quedan dentro: no se cancelan.` : ''}`, { textoOk: 'Aprobar' })) return;
        const respuesta = window.prompt(aprobar ? 'Mensaje para el barbero (opcional):' : 'Motivo del rechazo:', '');
        if (respuesta === null) return;
        b.disabled = true;
        try {
            const r = await api('panel_disponibilidad_resolver', { p_id: s.id, p_aprobar: aprobar, p_respuesta: respuesta });
            ctx.notificar(aprobar ? `Aprobada${r.citas_afectadas ? `: revisa ${r.citas_afectadas} cita(s) en la Agenda` : ''}` : 'Rechazada');
            recargar();
        } catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
}
