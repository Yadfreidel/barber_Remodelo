// ==========================================
// PANEL: NOTIFICACIONES (centro de avisos y preferencias)
// Un aviso solo informa: no confirma, cobra ni cancela la cita.
// ==========================================

import { api, esc, fechaHora, vacio } from './comun.js';
import { desbloquearSonido, reproducirSonido, sonidoBloqueado, fijarPreferencias, preferenciasActuales, estadoPush,
    activarPush, desactivarPushDispositivo, pushActivoEnEsteDispositivo, consultarAhora } from './avisos.js';

const ICONOS = { cita_nueva: 'calendar-plus', cita_cancelada: 'calendar-xmark', cita_reprogramada: 'calendar-days', cita_asignada: 'user-check',
    cita_reasignada: 'arrow-right-arrow-left', disponibilidad: 'clock', solicitud_acceso: 'user-plus', sistema: 'bell' };

// Destino de un aviso dentro del panel (la sección vuelve a comprobar permisos en el servidor)
export function abrirAviso(ctx, n) {
    const d = n.datos || {};
    if (d.seccion) ctx.irA(d.seccion, d.fecha ? { fecha: d.fecha, vista: 'dia' } : {});
}

export async function renderNotificaciones(cont, ctx) {
    cont.innerHTML = '<p class="panel-cargando">Cargando avisos…</p>';
    let datos;
    try { datos = await api('panel_notificaciones', { p_limite: 30, p_antes: null }); }
    catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    fijarPreferencias(datos.preferencias);
    const items = [...datos.items];
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Notificaciones</h2>
            <p class="panel-sub">Avisos de tus citas y solicitudes. Un aviso no confirma, cobra ni cancela nada.</p></div>
            <button type="button" class="panel-btn" data-todas ${datos.no_leidas ? '' : 'disabled'}><i class="fas fa-check-double"></i> Marcar todas como leídas</button></div>
        <div class="panel-caja" data-preferencias></div>
        <div class="avisos-lista" data-lista></div>
        <button type="button" class="panel-btn" data-mas hidden>Ver anteriores</button>`;
    const lista = cont.querySelector('[data-lista]');
    const mas = cont.querySelector('[data-mas]');
    const pintar = () => {
        lista.innerHTML = items.length ? items.map(n => `<button type="button" class="aviso-item ${n.leida ? '' : 'no-leido'}" data-aviso="${esc(n.id)}">
                <i class="fas fa-${ICONOS[n.tipo] || 'bell'}" aria-hidden="true"></i>
                <span><strong>${esc(n.titulo)}</strong>${n.cuerpo ? `<span>${esc(n.cuerpo)}</span>` : ''}<small>${esc(fechaHora(n.creado_en))}</small></span>
                ${n.leida ? '' : '<span class="aviso-punto" aria-label="No leído"></span>'}</button>`).join('')
            : vacio('Aún no tienes avisos. Aquí verás las citas nuevas, cancelaciones y cambios.', 'bell');
        mas.hidden = items.length < 30 || items.length % 30 !== 0;
    };
    pintar();
    lista.addEventListener('click', async e => {
        const b = e.target.closest('[data-aviso]');
        if (!b) return;
        const n = items.find(x => String(x.id) === b.dataset.aviso);
        if (!n.leida) {
            try { await api('panel_notificaciones_leer', { p_ids: [n.id] }); n.leida = true; consultarAhora(); } catch { /* se marca después */ }
        }
        if (n.datos?.seccion) abrirAviso(ctx, n); else pintar();
    });
    mas.addEventListener('click', async () => {
        mas.disabled = true;
        try { const r = await api('panel_notificaciones', { p_limite: 30, p_antes: items.at(-1).id }); items.push(...r.items); pintar(); }
        catch (e) { ctx.notificar(e.message, 'error'); }
        finally { mas.disabled = false; }
    });
    cont.querySelector('[data-todas]').addEventListener('click', async e => {
        e.currentTarget.disabled = true;
        try { await api('panel_notificaciones_leer', { p_ids: null }); items.forEach(n => { n.leida = true; }); pintar(); consultarAhora(); }
        catch (err) { ctx.notificar(err.message, 'error'); }
    });
    await pintarPreferencias(cont.querySelector('[data-preferencias]'), ctx);
}

async function pintarPreferencias(caja, ctx) {
    const p = preferenciasActuales();
    const push = estadoPush();
    const pushActivo = push.disponible && await pushActivoEnEsteDispositivo();
    caja.innerHTML = `<h3>Avisos y sonido</h3>
        <div class="avisos-preferencias">
            <button type="button" class="panel-btn panel-btn-principal" data-activar><i class="fas fa-bell"></i> Activar notificaciones y sonido</button>
            <button type="button" class="panel-btn" data-probar><i class="fas fa-volume-high"></i> Sonido de prueba</button>
            <label class="panel-check"><input type="checkbox" data-sonido ${p.sonido ? 'checked' : ''}> Sonido al llegar un aviso</label>
            <label class="avisos-volumen">Volumen dentro de la app <input type="range" min="0" max="100" step="5" value="${esc(p.volumen)}" data-volumen aria-label="Volumen"></label>
        </div>
        <p class="panel-sub" data-estado-sonido></p>
        <p class="panel-sub">Con la app cerrada: ${push.disponible ? (pushActivo ? '<strong>activo en este dispositivo.</strong> <button type="button" class="panel-btn panel-btn-mini" data-desactivar-push>Desactivar en este dispositivo</button>'
            : 'desactivado en este dispositivo (se activa con el botón de arriba).') : esc(push.motivo)}
            El sonido y la entrega con la app cerrada dependen del teléfono, sus permisos y la conexión: no se pueden garantizar.</p>`;
    const estadoSonido = caja.querySelector('[data-estado-sonido]');
    const mostrarEstado = () => {
        estadoSonido.textContent = sonidoBloqueado()
            ? 'El navegador mantiene el sonido bloqueado hasta que pulses «Activar notificaciones y sonido». Mientras tanto verás los avisos en pantalla.'
            : 'Sonido activado en esta pestaña.';
    };
    mostrarEstado();
    const guardar = async datos => {
        try { fijarPreferencias(await api('panel_notif_preferencias_guardar', { p_datos: datos })); }
        catch (e) { ctx.notificar(e.message, 'error'); }
    };
    caja.querySelector('[data-activar]').addEventListener('click', async e => {
        const boton = e.currentTarget;
        boton.disabled = true;
        await desbloquearSonido();
        mostrarEstado();
        await guardar({ sonido: true });
        caja.querySelector('[data-sonido]').checked = true;
        if (estadoPush().disponible) {
            try { await activarPush(); ctx.notificar('Avisos activados en este dispositivo'); }
            catch (err) { ctx.notificar(err.message, 'info'); }
        } else ctx.notificar('Sonido activado. ' + estadoPush().motivo, 'info');
        boton.disabled = false;
        pintarPreferencias(caja, ctx);
    });
    caja.querySelector('[data-probar]').addEventListener('click', async () => {
        await desbloquearSonido();
        mostrarEstado();
        if (!reproducirSonido(Number(caja.querySelector('[data-volumen]').value))) ctx.notificar('El navegador no permite reproducir sonido aquí.', 'error');
    });
    caja.querySelector('[data-sonido]').addEventListener('change', e => guardar({ sonido: e.target.checked }));
    caja.querySelector('[data-volumen]').addEventListener('change', e => guardar({ volumen: Number(e.target.value) }));
    caja.querySelector('[data-desactivar-push]')?.addEventListener('click', async () => {
        await desactivarPushDispositivo();
        ctx.notificar('Este dispositivo ya no recibirá avisos con la app cerrada', 'info');
        pintarPreferencias(caja, ctx);
    });
}
