// ==========================================
// PANEL: FILA VIRTUAL (clientes sin cita)
// Barbero: su turno en curso, «Llamar siguiente», «Iniciar servicio», «Finalizar» y «No se presentó», y los
// turnos que puede atender. Administración: la fila completa, llamar en nombre de un barbero, registrar a
// quien llega sin teléfono, asignar/reasignar, abrir o pausar la recepción, cortesía y QR imprimible.
// Toda regla (permisos, huecos, citas, concurrencia) la decide el servidor.
// ==========================================

import { api, esc, dialogo, vacio, confirmar } from './comun.js';
import { formato12h } from '../../assets/horario-utils.js';

const INTERVALO = 5000;
const ESTADOS = { en_espera: ['En espera', 'pendiente'], llamado: ['Llamado', 'aviso'], en_servicio: ['En servicio', 'exito'],
    finalizado: ['Finalizado', 'tenue'], salio: ['Salió de la fila', 'tenue'], no_se_presento: ['No se presentó', 'tenue'] };
const MOTIVOS = {
    sin_turnos: 'No hay turnos en espera que puedas atender.',
    sin_hueco: 'Hay turnos esperando, pero ninguno cabe completo antes de tu próxima cita, bloqueo o cierre.'
};
const ERRORES = {
    ya_tiene_turno: 'Ese barbero ya tiene un turno llamado o en servicio: termínalo antes de llamar al siguiente.',
    atencion_en_curso: 'Ese barbero tiene una cita en atención: márcala como terminada antes de llamar a la fila.',
    hueco_no_disponible: 'Ese hueco ya no está libre (una cita o un bloqueo lo ocupa). Marca «No se presentó» o vuelve a llamar.',
    transicion_invalida: 'El turno ya cambió de estado. Se actualizó la lista.',
    turno_no_encontrado: 'Ese turno ya no está a tu cargo.',
    barbero_no_elegible: 'Ese barbero no realiza el servicio o no trabaja hoy.',
    barbero_requerido: 'Elige el barbero que atenderá.',
    configuracion_invalida: 'Revisa los valores: cortesía de 1 a 30 min, aviso de 1 a 10 turnos, límite de 1 a 200, sillas del 1 al 99 y una URL que empiece por https://.',
    servicio_no_disponible: 'Ese servicio ya no está disponible.',
    sin_barberos: 'Ningún barbero que trabaje hoy realiza ese servicio.',
    fila_cerrada: 'La recepción está en pausa: ábrela para dar turnos.',
    fila_llena: 'La fila llegó al máximo de turnos en espera (ajústalo en «Ajustes»).',
    demasiados_turnos: 'Demasiados turnos seguidos desde este dispositivo. Espera un momento.'
};
// api() conserva el código del servidor en e.codigo; e.message ya trae el texto general traducido
const traducir = e => {
    const codigo = `${e?.codigo || ''} ${e?.message || ''}`;
    return ERRORES[Object.keys(ERRORES).find(k => codigo.includes(k))] || e?.message || 'No se pudo completar.';
};
const hora = ts => (ts ? formato12h(String(ts).slice(11, 16)) : '');
const minutosDesde = (iso, ahora) => Math.max(0, Math.round((Date.parse(ahora) - Date.parse(iso)) / 60000));
function nuevaClave() {
    if (crypto.randomUUID) { try { return crypto.randomUUID(); } catch { /* contexto no seguro */ } }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function urlFilaPorDefecto() {
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}fila.html`;
}

// Compartido con «Atención»: mismos textos y mismas acciones del servidor
export { ESTADOS as ESTADOS_FILA, MOTIVOS as MOTIVOS_FILA, traducir as traducirFila };

// Pantalla de turnos para la TV del local (misma carpeta publicada: funciona bajo /barber_Remodelo/)
export function urlPantallaTurnos() {
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}pantalla-turnos.html`;
}
export function abrirPantallaTurnos() {
    window.open(urlPantallaTurnos(), 'pantalla-turnos', 'noopener');
}

export async function renderFila(cont, ctx) {
    const admin = ctx.rol === 'admin';
    const st = { datos: null, temporizador: null, reloj: null, motivo: null, llamando: false, barberoAdmin: '' };
    cont.innerHTML = `<div class="fila-panel">
        <div class="panel-encabezado"><div><h2>Fila virtual</h2>
            <p class="panel-sub">${admin ? 'Clientes sin cita que tomaron turno con el QR del local o en el mostrador.' : 'Llama y atiende a los clientes sin cita que puedes atender ahora.'}</p></div>
            <div class="fila-panel-acciones" data-acciones></div></div>
        <div data-cuerpo><p class="panel-cargando">Cargando la fila…</p></div></div>`;
    // Los eventos se escuchan en el elemento propio de la sección (el contenedor del panel se reutiliza entre secciones)
    const raiz = cont.querySelector('.fila-panel');
    const cuerpo = raiz.querySelector('[data-cuerpo]');
    const vivo = () => raiz.isConnected;

    async function cargar({ silencioso = false } = {}) {
        clearTimeout(st.temporizador);
        try {
            st.datos = await api('panel_fila', { p_barbero: null });
            if (!vivo()) return;
            pintar();
        } catch (e) {
            if (!vivo()) return;
            if (!silencioso || !st.datos) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p><button type="button" class="panel-btn" data-recargar>Reintentar</button>`;
        }
        if (vivo()) st.temporizador = setTimeout(() => { if (document.visibilityState === 'visible') cargar({ silencioso: true }); }, INTERVALO);
    }
    const alVolver = () => {
        if (!vivo()) return document.removeEventListener('visibilitychange', alVolver);
        if (document.visibilityState === 'visible') cargar({ silencioso: true });
    };
    document.addEventListener('visibilitychange', alVolver);

    // ---------- Pintado ----------
    function pintarAcciones() {
        const c = st.datos.config;
        const caja = cont.querySelector('[data-acciones]');
        if (!admin) { caja.innerHTML = `<span class="fila-recepcion ${c.recepcion_abierta ? 'abierta' : ''}">${c.recepcion_abierta ? 'Recepción abierta' : 'Recepción en pausa'}</span>`; return; }
        caja.innerHTML = `
            <button type="button" class="fila-interruptor" role="switch" aria-checked="${c.recepcion_abierta}" data-recepcion>
                <span class="fila-interruptor-pista" aria-hidden="true"><span></span></span>
                <span>${c.recepcion_abierta ? 'Recepción abierta' : 'Recepción en pausa'}</span></button>
            <button type="button" class="panel-btn panel-btn-mini" data-registrar><i class="fas fa-user-plus" aria-hidden="true"></i> Registrar llegada</button>
            <button type="button" class="panel-btn panel-btn-mini" data-qr><i class="fas fa-qrcode" aria-hidden="true"></i> QR del local</button>
            <button type="button" class="panel-btn panel-btn-mini" data-pantalla><i class="fas fa-tv" aria-hidden="true"></i> Abrir pantalla de turnos</button>
            <button type="button" class="panel-btn panel-btn-mini" data-ajustes><i class="fas fa-sliders" aria-hidden="true"></i> Ajustes</button>`;
    }

    function tarjetaActiva(t) {
        const [texto, clase] = ESTADOS[t.estado];
        const quien = t.atiende ? ` · ${esc(t.atiende)}` : '';
        return `<article class="fila-activa ${t.estado}" data-turno="${esc(t.id)}">
            <div class="fila-activa-cabecera"><span class="fila-codigo-panel">${esc(t.codigo)}</span>
                <span class="fila-pill ${clase}">${texto}</span></div>
            <p class="fila-activa-servicio">${esc(t.servicio)} · ${Number(t.duracion)} min${quien}${t.nombre ? ` · <strong>${esc(t.nombre)}</strong>` : ''}</p>
            ${t.estado === 'llamado' ? `<p class="fila-activa-plazo" data-plazo="${esc(t.llamado_hasta)}">Cortesía hasta las ${esc(hora(t.llamado_hasta))}</p>` : ''}
            ${t.estado === 'en_servicio' ? `<p class="fila-activa-plazo">En servicio desde las ${esc(new Date(t.iniciado_en).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Santo_Domingo' }))}</p>` : ''}
            <div class="fila-activa-botones">${t.estado === 'llamado'
                ? `<button type="button" class="panel-btn panel-btn-principal" data-accion="iniciar"><i class="fas fa-play" aria-hidden="true"></i> Iniciar servicio</button>
                   <button type="button" class="panel-btn" data-accion="no_se_presento"><i class="fas fa-user-slash" aria-hidden="true"></i> No se presentó</button>`
                : `<button type="button" class="panel-btn panel-btn-principal" data-accion="finalizar"><i class="fas fa-check" aria-hidden="true"></i> Finalizar</button>`}</div>
        </article>`;
    }

    function filaEspera(t, ahora) {
        const espera = minutosDesde(t.creado_en, ahora);
        const quien = t.barbero ? `Para ${esc(t.barbero)}` : 'Primero disponible';
        const est = t.inicio_estimado ? `≈ ${esc(hora(t.inicio_estimado))}${t.barbero_estimado && admin ? ` · ${esc(nombreBarbero(t.barbero_estimado))}` : ''}` : 'Sin hueco hoy por ahora';
        return `<li class="fila-item" data-turno="${esc(t.id)}">
            <span class="fila-codigo-panel">${esc(t.codigo)}</span>
            <span class="fila-item-texto"><strong>${esc(t.servicio)}</strong> <span class="fila-tenue">· ${Number(t.duracion)} min</span>
                ${t.nombre ? `<span class="fila-nombre-manual">${esc(t.nombre)}</span>` : ''}
                <span class="fila-tenue">${quien} · espera ${espera} min · ${est}</span></span>
            ${admin ? `<span class="fila-item-acciones">
                <label class="sr-only" for="asig-${esc(t.id)}">Asignar ${esc(t.codigo)}</label>
                <select id="asig-${esc(t.id)}" data-asignar><option value="">Primero disponible</option>${(st.datos.barberos || []).filter(b => b.trabaja_hoy)
                    .map(b => `<option value="${esc(b.id)}" ${b.id === t.barbero_id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select>
                <button type="button" class="panel-icono" data-accion="salio" aria-label="Marcar ${esc(t.codigo)} como «salió de la fila»" title="Salió de la fila"><i class="fas fa-door-open" aria-hidden="true"></i></button>
            </span>` : ''}</li>`;
    }
    const nombreBarbero = id => (st.datos.barberos || []).find(b => b.id === id)?.nombre || '';

    function pintar() {
        const d = st.datos;
        pintarAcciones();
        const activos = d.turnos.filter(t => ['llamado', 'en_servicio'].includes(t.estado));
        const espera = d.turnos.filter(t => t.estado === 'en_espera');
        const cerrados = d.turnos.filter(t => ['finalizado', 'salio', 'no_se_presento'].includes(t.estado));
        const mio = !admin && activos.find(t => t.barbero_atiende === d.barbero_id);
        let zonaLlamar;
        if (admin) {
            zonaLlamar = `<div class="fila-llamar-admin"><label>Llamar siguiente para
                <select data-barbero-admin><option value="">Elige un barbero</option>${(d.barberos || []).filter(b => b.trabaja_hoy)
                    .map(b => `<option value="${esc(b.id)}" ${b.id === st.barberoAdmin ? 'selected' : ''} ${b.ocupado ? 'disabled' : ''}>${esc(b.nombre)}${b.ocupado ? ' (atendiendo)' : ''}</option>`).join('')}</select></label>
                <button type="button" class="panel-btn panel-btn-principal" data-llamar ${st.llamando ? 'disabled' : ''}><i class="fas fa-bullhorn" aria-hidden="true"></i> Llamar siguiente</button></div>`;
        } else if (!mio) {
            zonaLlamar = `<div class="fila-llamar">
                <button type="button" class="fila-boton-llamar" data-llamar ${st.llamando || d.ocupado_por_cita ? 'disabled' : ''}><i class="fas fa-bullhorn" aria-hidden="true"></i> Llamar siguiente</button>
                <p class="fila-tenue">${d.ocupado_por_cita ? 'Tienes una cita en atención: complétala para llamar a la fila.'
                    : d.proxima_cita ? `Tu próxima cita: ${esc(formato12h(d.proxima_cita.hora))}${d.proxima_cita.servicio ? ` (${esc(d.proxima_cita.servicio)})` : ''}. Solo se llama un turno que termina antes.`
                    : 'Se llama el turno más antiguo que puedes atender y que cabe completo en tu horario.'}</p></div>`;
        }
        cuerpo.innerHTML = `
            ${st.motivo ? `<p class="panel-aviso fila-motivo" role="status">${esc(st.motivo)}</p>` : ''}
            ${mio ? `<section class="fila-seccion" aria-label="Tu turno en curso"><h3>Tu turno</h3>${tarjetaActiva(mio)}</section>` : ''}
            ${zonaLlamar || ''}
            ${admin && activos.length ? `<section class="fila-seccion"><h3>Llamados y en servicio</h3><div class="fila-activas">${activos.map(tarjetaActiva).join('')}</div></section>` : ''}
            <section class="fila-seccion"><h3>En espera <span class="fila-contador">${espera.length}</span></h3>
                ${espera.length ? `<ol class="fila-lista">${espera.map(t => filaEspera(t, d.ahora)).join('')}</ol>`
                    : vacio(admin ? 'Nadie espera. Los turnos del QR y del mostrador aparecerán aquí.' : 'No hay turnos que puedas atender ahora.', 'people-line')}
            </section>
            ${cerrados.length ? `<details class="fila-seccion fila-historial"><summary>Atendidos y cerrados hoy (${cerrados.length})</summary>
                <ul class="fila-lista">${cerrados.map(t => `<li class="fila-item"><span class="fila-codigo-panel">${esc(t.codigo)}</span>
                    <span class="fila-item-texto">${esc(t.servicio)} <span class="fila-tenue">· ${esc(ESTADOS[t.estado][0])}${t.atiende ? ` · ${esc(t.atiende)}` : ''}${t.cierre_motivo === 'cortesia_vencida' ? ' (venció la cortesía)' : ''}</span></span></li>`).join('')}</ul></details>` : ''}`;
        actualizarPlazos();
    }

    // Cuenta atrás de la cortesía con la hora del servidor
    function actualizarPlazos() {
        clearInterval(st.reloj);
        const desfase = Date.parse(st.datos.ahora) - Date.now();
        const tick = () => cuerpo.querySelectorAll('[data-plazo]').forEach(p => {
            const resta = Math.round((Date.parse(p.dataset.plazo) - (Date.now() + desfase)) / 1000);
            p.textContent = resta > 0 ? `Cortesía: quedan ${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, '0')}` : 'La cortesía venció: se cerrará como «no se presentó».';
        });
        tick();
        st.reloj = setInterval(() => { if (!vivo()) return clearInterval(st.reloj); tick(); }, 1000);
    }

    // ---------- Acciones ----------
    async function llamar(boton) {
        const p = admin ? cont.querySelector('[data-barbero-admin]')?.value : null;
        if (admin && !p) { ctx.notificar('Elige el barbero que atenderá.', 'error'); return; }
        st.llamando = true;
        boton.disabled = true;
        try {
            const r = await api('panel_fila_llamar', { p_barbero: p || null });
            st.motivo = r.turno ? null : MOTIVOS[r.motivo];
            if (r.turno) ctx.notificar(`Llamado ${r.turno.codigo}${r.turno.nombre ? ` (${r.turno.nombre})` : ''}: ${r.turno.servicio}.`);
        } catch (e) { ctx.notificar(traducir(e), 'error'); }
        finally { st.llamando = false; await cargar(); }
    }
    async function accion(id, nombre, boton) {
        if (nombre === 'no_se_presento' && !await confirmar('¿Marcar que no se presentó? El turno se cerrará y el hueco quedará libre.', { textoOk: 'No se presentó' })) return;
        if (nombre === 'salio' && !await confirmar('¿Marcar que salió de la fila? El turno se cerrará.', { textoOk: 'Salió de la fila' })) return;
        boton.disabled = true;
        try {
            if (nombre === 'iniciar') await api('panel_fila_iniciar', { p_turno: id });
            else await api('panel_fila_cerrar', { p_turno: id, p_accion: nombre });
            st.motivo = null;
        } catch (e) { ctx.notificar(traducir(e), 'error'); }
        await cargar();
    }

    raiz.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.matches('[data-recargar]')) return cargar();
        if (b.matches('[data-llamar]')) return llamar(b);
        if (b.dataset.accion) return accion(b.closest('[data-turno]').dataset.turno, b.dataset.accion, b);
        if (b.matches('[data-recepcion]')) {
            const abrir = b.getAttribute('aria-checked') !== 'true';
            if (!abrir && !await confirmar('¿Pausar la recepción? No entrarán turnos nuevos desde el QR; los que ya esperan se siguen atendiendo.', { textoOk: 'Pausar' })) return;
            b.disabled = true;
            try { await api('panel_fila_config', { p_datos: { recepcion_abierta: abrir } }); ctx.notificar(abrir ? 'Recepción abierta: el QR ya emite turnos.' : 'Recepción en pausa.'); }
            catch (err) { ctx.notificar(traducir(err), 'error'); }
            return cargar();
        }
        if (b.matches('[data-registrar]')) return registrar();
        if (b.matches('[data-qr]')) return mostrarQR(st.datos.config.url_publica || urlFilaPorDefecto(), !st.datos.config.url_publica);
        if (b.matches('[data-ajustes]')) return ajustes();
        if (b.matches('[data-pantalla]')) return abrirPantallaTurnos();
    });
    raiz.addEventListener('change', async e => {
        if (e.target.matches('[data-barbero-admin]')) { st.barberoAdmin = e.target.value; return; }
        if (!e.target.matches('[data-asignar]')) return;
        const id = e.target.closest('[data-turno]').dataset.turno;
        e.target.disabled = true;
        try { const r = await api('panel_fila_asignar', { p_turno: id, p_barbero: e.target.value || null }); ctx.notificar(`${r.turno.codigo}: ${r.turno.barbero ? `asignado a ${r.turno.barbero}` : 'primero disponible'}.`); }
        catch (err) { ctx.notificar(traducir(err), 'error'); }
        cargar();
    });

    // Registro manual (mostrador)
    function registrar() {
        const d = st.datos;
        const { cuerpo: c, cerrar } = dialogo({ titulo: 'Registrar llegada sin teléfono', html: `
            <form class="fila-form" novalidate>
                <label>Servicio<select name="servicio" required><option value="">Elige un servicio</option>${(d.servicios || []).map(s => `<option value="${esc(s.id)}">${esc(s.nombre)} · ${Number(s.duracion)} min</option>`).join('')}</select></label>
                <label>Barbero<select name="barbero"><option value="">Primero disponible</option>${(d.barberos || []).filter(b => b.trabaja_hoy).map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('')}</select></label>
                <label>Nombre o apodo (opcional, solo lo ve el equipo)<input name="nombre" maxlength="40" autocomplete="off"></label>
                <p class="panel-error" role="alert" hidden></p>
                <div class="panel-dialogo-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                    <button type="submit" class="panel-btn panel-btn-principal">Dar turno</button></div></form>` });
        const form = c.querySelector('form');
        const clave = nuevaClave();   // un doble clic no crea dos turnos
        form.addEventListener('submit', async ev => {
            ev.preventDefault();
            const err = form.querySelector('.panel-error');
            if (!form.servicio.value) { err.textContent = 'Elige el servicio.'; err.hidden = false; return; }
            const boton = form.querySelector('[type=submit]');
            boton.disabled = true;
            try {
                const r = await api('panel_fila_registrar', { p_servicio: form.servicio.value, p_barbero: form.barbero.value || null, p_nombre: form.nombre.value, p_clave: clave });
                cerrar();
                ctx.notificar(`Turno ${r.turno.codigo} registrado. Díselo al cliente: lo llamaremos por ese código.`);
                cargar();
            } catch (e) { err.textContent = traducir(e); err.hidden = false; boton.disabled = false; }
        });
    }

    // Ajustes de la fila
    function ajustes() {
        const c = st.datos.config;
        const { cuerpo: caja, cerrar } = dialogo({ titulo: 'Ajustes de la fila virtual', html: `
            <form class="fila-form" novalidate>
                <label>Plazo de cortesía tras el llamado (minutos)<input type="number" name="cortesia" min="1" max="30" value="${Number(c.cortesia_minutos)}" required></label>
                <label>«Ya casi te toca» con (turnos por delante o menos)<input type="number" name="cerca" min="1" max="10" value="${Number(c.aviso_cerca)}" required></label>
                <label>Máximo de turnos en espera<input type="number" name="limite" min="1" max="200" value="${Number(c.limite_espera)}" required></label>
                <label>URL pública de la fila (la que abre el QR)<input type="url" name="url" value="${esc(c.url_publica || '')}" placeholder="${esc(urlFilaPorDefecto())}"></label>
                <p class="panel-sub">Déjala vacía para usar la dirección de esta web. Debe abrir <code>fila.html</code> del sitio publicado.</p>
                <fieldset class="fila-sillas" data-sillas><legend>Silla de cada barbero (pantalla de turnos)</legend>
                    <p class="panel-sub">Al llamar un turno, la TV muestra «Pasa a la silla N». Sin silla, muestra «Pasa a recepción».</p>
                    <p class="panel-cargando">Cargando sillas…</p></fieldset>
                <p class="panel-error" role="alert" hidden></p>
                <div class="panel-dialogo-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                    <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div></form>` });
        const form = caja.querySelector('form');
        const zonaSillas = form.querySelector('[data-sillas]');
        let sillasCargadas = false;
        api('panel_fila_sillas').then(lista => {
            zonaSillas.querySelector('.panel-cargando').remove();
            zonaSillas.insertAdjacentHTML('beforeend', `<div class="fila-sillas-rejilla">${lista.map(b => `<label>${esc(b.nombre)}
                <input type="number" min="1" max="99" inputmode="numeric" data-silla="${esc(b.id)}" value="${b.silla ?? ''}" placeholder="Sin silla"></label>`).join('')}</div>`);
            sillasCargadas = true;
        }).catch(e => { zonaSillas.querySelector('.panel-cargando').textContent = `No se pudieron cargar las sillas: ${traducir(e)}`; });
        form.addEventListener('submit', async ev => {
            ev.preventDefault();
            const err = form.querySelector('.panel-error');
            try {
                if (sillasCargadas) {
                    await api('panel_fila_sillas_guardar', { p_sillas: Object.fromEntries([...form.querySelectorAll('[data-silla]')]
                        .map(i => [i.dataset.silla, i.value.trim() === '' ? null : Number(i.value)])) });
                }
                await api('panel_fila_config', { p_datos: { cortesia_minutos: Number(form.cortesia.value), aviso_cerca: Number(form.cerca.value),
                    limite_espera: Number(form.limite.value), url_publica: form.url.value.trim() } });
                cerrar();
                ctx.notificar('Ajustes de la fila guardados.');
                cargar();
            } catch (e) { err.textContent = traducir(e); err.hidden = false; }
        });
    }

    await cargar();
}

// ---------- QR imprimible ----------
export function mostrarQR(url, porDefecto = false) {
    const local = /\/\/(localhost|127\.|192\.168\.|10\.)/.test(url);
    const { cuerpo } = dialogo({ titulo: 'QR de la fila virtual', html: `
        <div class="fila-qr">
            <div class="fila-qr-imagen" data-qr></div>
            <p class="fila-qr-url"><code>${esc(url)}</code></p>
            ${local ? '<p class="panel-aviso">Esta dirección es de tu red local: para el local, configura en «Ajustes» la URL del sitio publicado.</p>'
                    : porDefecto ? '<p class="panel-sub">Se usa la dirección de esta web. Puedes fijar otra en «Ajustes».</p>' : ''}
            <div class="panel-dialogo-acciones"><button type="button" class="panel-btn" data-imprimir><i class="fas fa-print" aria-hidden="true"></i> Imprimir</button>
                <button type="button" class="panel-btn panel-btn-principal" data-descargar><i class="fas fa-download" aria-hidden="true"></i> Descargar PNG</button></div>
        </div>` });
    const caja = cuerpo.querySelector('[data-qr]');
    if (typeof window.QRCode !== 'function') { caja.innerHTML = '<p class="panel-error">No se pudo cargar el generador de QR. Revisa tu conexión.</p>'; return; }
    new window.QRCode(caja, { text: url, width: 260, height: 260, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    const cartel = () => {
        const qr = caja.querySelector('canvas') || caja.querySelector('img');
        const lienzo = document.createElement('canvas');
        lienzo.width = 1240; lienzo.height = 1754;          // A4 a 150 ppp
        const g = lienzo.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, lienzo.width, lienzo.height);
        g.fillStyle = '#111111'; g.textAlign = 'center';
        g.font = 'bold 92px Inter, Arial, sans-serif'; g.fillText('Fila virtual', 620, 230);
        g.font = '48px Inter, Arial, sans-serif'; g.fillText('¿Llegaste sin cita? Escanea y toma tu turno', 620, 330);
        g.imageSmoothingEnabled = false;
        g.drawImage(qr, 220, 420, 800, 800);
        g.font = '40px Inter, Arial, sans-serif'; g.fillStyle = '#333333';
        g.fillText('Sin descargar nada. Te avisamos cuando te toque.', 620, 1330);
        g.font = '30px monospace'; g.fillText(url.length > 70 ? `${url.slice(0, 67)}…` : url, 620, 1420);
        return lienzo.toDataURL('image/png');
    };
    cuerpo.querySelector('[data-descargar]').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = cartel(); a.download = 'qr-fila-virtual.png';
        document.body.append(a); a.click(); a.remove();
    });
    cuerpo.querySelector('[data-imprimir]').addEventListener('click', () => {
        const v = window.open('', '_blank');
        if (!v) return;
        v.document.write(`<!doctype html><title>QR fila virtual</title><style>@page{size:A4;margin:0}body{margin:0}img{width:100%;}</style><img src="${cartel()}" onload="setTimeout(()=>print(),200)">`);
        v.document.close();
    });
}
