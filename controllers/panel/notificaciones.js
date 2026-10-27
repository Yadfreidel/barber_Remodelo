// ==========================================
// PANEL: NOTIFICACIONES (centro de avisos y preferencias)
// Un aviso solo informa: no confirma, cobra ni cancela la cita.
// ==========================================

import { api, esc, fechaHora, vacio } from './comun.js';
import { desbloquearSonido, reproducirSonido, sonidoBloqueado, fijarPreferencias, preferenciasActuales, estadoPush,
    activarPush, desactivarPushDispositivo, comprobarDispositivo, consultarAhora } from './avisos.js';

const ICONOS = { cita_nueva: 'calendar-plus', cita_cancelada: 'calendar-xmark', cita_reprogramada: 'calendar-days', cita_asignada: 'user-check',
    cita_reasignada: 'arrow-right-arrow-left', disponibilidad: 'clock', solicitud_acceso: 'user-plus', sistema: 'bell' };

// Destino de un aviso dentro del panel (la sección vuelve a comprobar permisos en el servidor)
export function abrirAviso(ctx, n) {
    const d = n.datos || {};
    // Una reserva abre su detalle en la agenda (el servidor comprueba que la cita sea de esta cuenta)
    if (d.seccion) ctx.irA(d.seccion, d.fecha ? { fecha: d.fecha, vista: 'dia', ...(d.cita ? { abrirCita: String(d.cita) } : {}) } : {});
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

const esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalada = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const TEXTO_PERMISO = { granted: 'concedido', denied: 'bloqueado', default: 'sin decidir' };
const TEXTO_DISPOSITIVO = {
    activa: 'Registrado: este dispositivo recibe avisos con la app cerrada.',
    inactiva: 'La suscripción de este dispositivo caducó o se desactivó. Vuelve a pulsar «Activar avisos y sonido».',
    sin_suscripcion: 'Este dispositivo no está registrado para avisos con la app cerrada.',
    otra_cuenta: 'Este dispositivo estaba registrado con otra cuenta: se anuló. Actívalo de nuevo con la tuya.'
};

function instruccionesInstalacion() {
    if (instalada) return '';
    return esIOS
        ? '<p class="panel-aviso"><strong>iPhone/iPad:</strong> los avisos con la app cerrada solo funcionan con iOS 16.4 o posterior y con la app instalada. En Safari toca <strong>Compartir</strong> › <strong>Agregar a inicio</strong>, abre la barbería desde ese ícono, entra al panel y pulsa «Activar avisos y sonido».</p>'
        : '<p class="panel-sub"><strong>Android:</strong> funciona en Chrome sin instalar nada. Para tenerla como app, en Chrome toca ⋮ › <strong>Instalar app</strong> (o «Agregar a la pantalla principal»).</p>';
}

async function pintarPreferencias(caja, ctx) {
    const p = preferenciasActuales();
    const push = estadoPush();
    const servidor = await comprobarDispositivo();
    const permiso = 'Notification' in window ? Notification.permission : 'no disponible';
    const prueba = servidor?.ultima_prueba;
    const resultadoPrueba = prueba && prueba.envios.length
        ? (prueba.envios.includes('enviado') ? 'la última prueba se entregó al servicio push.'
            : prueba.envios.some(e => e === 'fallido' || e === 'vencido') ? 'la última prueba falló al enviarse.'
            : 'la última prueba está en cola: el servidor aún no la ha enviado (envío push sin configurar o pendiente).')
        : '';
    caja.innerHTML = `<h3>Avisos y sonido</h3>
        <div class="avisos-preferencias">
            <button type="button" class="panel-btn panel-btn-principal" data-activar><i class="fas fa-bell"></i> Activar avisos y sonido</button>
            <button type="button" class="panel-btn" data-probar-sonido><i class="fas fa-volume-high"></i> Probar sonido</button>
            <button type="button" class="panel-btn" data-probar-aviso><i class="fas fa-paper-plane"></i> Probar notificación</button>
            <label class="panel-check"><input type="checkbox" data-sonido ${p.sonido ? 'checked' : ''}> Sonido al llegar un aviso</label>
            <label class="avisos-volumen">Volumen dentro de la app <input type="range" min="0" max="100" step="5" value="${esc(p.volumen)}" data-volumen aria-label="Volumen"></label>
        </div>
        <dl class="avisos-estado">
            <div><dt>Sonido en esta pestaña</dt><dd data-estado-sonido></dd></div>
            <div><dt>Permiso de notificaciones</dt><dd>${esc(TEXTO_PERMISO[permiso] || permiso)}</dd></div>
            <div><dt>Avisos con la app cerrada</dt><dd>${push.disponible ? esc(TEXTO_DISPOSITIVO[servidor?.dispositivo] || 'No se pudo comprobar el estado.') : esc(push.motivo)}
                ${servidor?.dispositivos_activos ? ` (${servidor.dispositivos_activos} dispositivo(s) de tu cuenta)` : ''}</dd></div>
            ${servidor?.ultimo_envio ? `<div><dt>Último aviso entregado al servicio push</dt><dd>${esc(fechaHora(servidor.ultimo_envio))}</dd></div>` : ''}
            ${servidor?.ultimo_error ? `<div><dt>Último fallo de envío</dt><dd>${esc(servidor.ultimo_error)}</dd></div>` : ''}
            ${resultadoPrueba ? `<div><dt>Prueba</dt><dd>${esc(resultadoPrueba)}</dd></div>` : ''}
        </dl>
        ${push.denegado ? '' : instruccionesInstalacion()}
        ${servidor?.dispositivo === 'activa' ? '<button type="button" class="panel-btn panel-btn-mini" data-desactivar-push>Desactivar en este dispositivo</button>' : ''}
        <p class="panel-sub">Con la app abierta verás el aviso y oirás el sonido. Con la app cerrada o el teléfono bloqueado, el aviso lo muestra el sistema
            con su propio sonido: si el teléfono está en silencio o en «No molestar», puede no sonar. La entrega depende del teléfono y la conexión.</p>`;
    const estadoSonido = caja.querySelector('[data-estado-sonido]');
    const mostrarEstado = () => {
        estadoSonido.textContent = sonidoBloqueado()
            ? 'bloqueado por el navegador hasta que pulses «Activar avisos y sonido» (verás los avisos en pantalla).'
            : (preferenciasActuales().sonido ? 'activado.' : 'silenciado.');
    };
    mostrarEstado();
    const guardar = async datos => {
        try { fijarPreferencias(await api('panel_notif_preferencias_guardar', { p_datos: datos })); }
        catch (e) { ctx.notificar(e.message, 'error'); }
    };
    caja.querySelector('[data-activar]').addEventListener('click', async e => {
        const boton = e.currentTarget;
        boton.disabled = true;
        // El permiso se pide primero, directamente con el toque (Safari en iPhone lo exige)
        const pidePush = estadoPush().disponible ? activarPush().then(() => null, err => err) : Promise.resolve(new Error(estadoPush().motivo));
        await desbloquearSonido();
        const fallo = await pidePush;
        await guardar({ sonido: true });
        ctx.notificar(fallo ? `Sonido activado en esta pestaña. ${fallo.message}` : 'Avisos activados: este dispositivo quedó registrado.', fallo ? 'info' : 'success');
        boton.disabled = false;
        pintarPreferencias(caja, ctx);
    });
    caja.querySelector('[data-probar-sonido]').addEventListener('click', async () => {
        await desbloquearSonido();
        mostrarEstado();
        if (!reproducirSonido(Number(caja.querySelector('[data-volumen]').value))) ctx.notificar('El navegador no permite reproducir sonido aquí.', 'error');
    });
    caja.querySelector('[data-probar-aviso]').addEventListener('click', async e => {
        const boton = e.currentTarget;
        boton.disabled = true;
        try {
            const r = await api('panel_notificacion_prueba');
            consultarAhora();
            ctx.notificar(r.push_encolados
                ? `Prueba enviada: aparecerá aquí y en ${r.push_encolados} dispositivo(s) registrado(s) en cuanto el servidor la envíe.`
                : 'Prueba creada: aparecerá aquí. Ningún dispositivo está registrado para avisos con la app cerrada.', 'info');
            setTimeout(() => { if (caja.isConnected) pintarPreferencias(caja, ctx); }, 8000);
        } catch (err) { ctx.notificar(/espera_prueba/.test(err.message) ? 'Espera unos segundos antes de otra prueba.' : err.message, 'error'); }
        finally { boton.disabled = false; }
    });
    caja.querySelector('[data-sonido]').addEventListener('change', async e => { await guardar({ sonido: e.target.checked }); mostrarEstado(); });
    caja.querySelector('[data-volumen]').addEventListener('change', e => guardar({ volumen: Number(e.target.value) }));
    caja.querySelector('[data-desactivar-push]')?.addEventListener('click', async () => {
        await desactivarPushDispositivo();
        ctx.notificar('Este dispositivo ya no recibirá avisos con la app cerrada', 'info');
        pintarPreferencias(caja, ctx);
    });
}
