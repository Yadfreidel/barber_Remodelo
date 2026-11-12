// ==========================================
// FILA VIRTUAL: página pública (se abre desde el QR del local)
// Sin cuenta: el turno se recupera con un token privado (enlace #t=… y almacenamiento de este navegador).
// El código visible (A-07) solo sirve para que el equipo llame al cliente. La página consulta el estado
// cada pocos segundos mientras está a la vista y al reconectar; con la página cerrada avisa el Web Push
// existente si el dispositivo lo permite.
// ==========================================

import { supabase, estaSupabaseListo } from '../supabaseClient.js';
import { VAPID_PUBLIC_KEY } from '../config.js';
import { aplicarColoresPortal } from '../identidad-colores.js';

const CLAVE_TURNO = 'barberia-fila-turno';
const CLAVE_SOLICITUD = 'barberia-fila-solicitud';
const INTERVALO = 7000;
const raiz = document.getElementById('fila');
const red = document.querySelector('.fila-red');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = n => (n == null ? '' : `RD$ ${Number(n).toLocaleString('es-DO', { maximumFractionDigits: 2 })}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let estado = { token: null, turno: null, publica: null, servicio: null, barbero: null, enviando: false };
let temporizador = null;
let reloj = null;
let ultimoEstado = null;

// ---------- Almacenamiento (solo este navegador) ----------
const leer = (clave, almacen = localStorage) => { try { return JSON.parse(almacen.getItem(clave) || 'null'); } catch { return null; } };
const guardar = (clave, valor, almacen = localStorage) => { try { valor == null ? almacen.removeItem(clave) : almacen.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } };
function nuevaClave() {
    if (crypto.randomUUID) { try { return crypto.randomUUID(); } catch { /* contexto no seguro */ } }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function fijarToken(token) {
    estado.token = token;
    guardar(CLAVE_TURNO, token ? { token, guardado: Date.now() } : null);
    // El enlace privado queda en la barra de direcciones (fragmento: no se envía a ningún servidor)
    history.replaceState(null, '', token ? `${location.pathname}#t=${token}` : location.pathname);
}
function tokenInicial() {
    const deEnlace = new URLSearchParams(location.hash.slice(1)).get('t');
    if (UUID.test(deEnlace || '')) return deEnlace;
    const g = leer(CLAVE_TURNO);
    // Un turno es del día: lo guardado hace más de 18 h ya no se intenta recuperar
    return g && UUID.test(g.token) && Date.now() - g.guardado < 18 * 3600e3 ? g.token : null;
}

// ---------- Servidor ----------
async function rpc(fn, args = {}) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
}
const ERRORES = {
    fila_cerrada: 'La fila no está recibiendo turnos en este momento.',
    fila_llena: 'La fila está completa por ahora. Inténtalo más tarde o reserva una cita.',
    demasiados_turnos: 'Ya hay varios turnos activos desde esta conexión.',
    servicio_no_disponible: 'Ese servicio ya no está disponible. Elige otro.',
    barbero_no_disponible: 'Ese barbero no está atendiendo hoy. Elige otro o «Primero disponible».',
    sin_barberos: 'Hoy nadie del equipo realiza ese servicio. Elige otro.',
    transicion_invalida: 'Tu turno ya cambió de estado.',
    turno_no_encontrado: 'No encontramos ese turno.'
};
const esRed = e => /Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || '');
const mensaje = e => ERRORES[Object.keys(ERRORES).find(k => (e?.message || '').includes(k))]
    || (esRed(e) ? 'Sin conexión. Revisa tu internet e inténtalo de nuevo.' : 'No se pudo completar. Inténtalo de nuevo.');

// ---------- Identidad del negocio (colores, nombre) ----------
async function identidad() {
    try {
        const n = await rpc('negocio_publico');
        if (!n) return;
        aplicarColoresPortal({ principal: n.color_principal, acento: n.color_acento });
        if (n.nombre) { document.querySelector('[data-negocio]').textContent = n.nombre; document.title = `Fila virtual | ${n.nombre}`; }
    } catch { /* se conserva el diseño original */ }
}

// ---------- Pantallas ----------
function pintarError(texto, reintentar = true) {
    raiz.innerHTML = `<section class="fila-tarjeta fila-centro">
        <i class="fas fa-triangle-exclamation fila-icono-grande aviso" aria-hidden="true"></i>
        <p>${esc(texto)}</p>
        ${reintentar ? '<button type="button" class="fila-boton" data-reintentar>Reintentar</button>' : ''}</section>`;
}

function pintarCerrada() {
    raiz.innerHTML = `<section class="fila-tarjeta fila-centro">
        <i class="fa-regular fa-clock fila-icono-grande" aria-hidden="true"></i>
        <h1 class="fila-titulo">La fila está en pausa</h1>
        <p class="fila-texto">Ahora mismo no estamos recibiendo turnos sin cita. Puedes reservar una cita con la disponibilidad real.</p>
        <a class="fila-boton" href="./#contacto">Reservar una cita</a>
        <button type="button" class="fila-boton secundario" data-reintentar>Volver a comprobar</button></section>`;
}

function pintarEleccion() {
    const p = estado.publica;
    const servicios = p.servicios.filter(s => s.barberos.length);
    if (!servicios.length) {
        raiz.innerHTML = `<section class="fila-tarjeta fila-centro"><i class="fa-regular fa-calendar-xmark fila-icono-grande" aria-hidden="true"></i>
            <h1 class="fila-titulo">Hoy no hay barberos disponibles en la fila</h1>
            <p class="fila-texto">Reserva una cita para otro día.</p><a class="fila-boton" href="./#contacto">Reservar una cita</a></section>`;
        return;
    }
    const s = servicios.find(x => x.id === estado.servicio?.id) || null;
    estado.servicio = s;
    const nombres = new Map(p.barberos.map(b => [b.id, b.nombre]));
    raiz.innerHTML = `
        <section class="fila-intro">
            <h1 class="fila-titulo">Toma tu turno</h1>
            <p class="fila-texto">Elige el servicio y con quién. Te avisamos aquí cuando te toque; no necesitas cuenta.
                ${p.en_espera ? `<strong>${p.en_espera} ${p.en_espera === 1 ? 'persona espera' : 'personas esperan'} ahora.</strong>` : ''}</p>
        </section>
        <section class="fila-paso" aria-labelledby="paso-servicio">
            <h2 id="paso-servicio" class="fila-subtitulo"><span>1</span> Servicio</h2>
            <div class="fila-opciones" role="radiogroup" aria-labelledby="paso-servicio">${servicios.map(x => `
                <button type="button" role="radio" class="fila-opcion" data-servicio="${esc(x.id)}" aria-checked="${x.id === s?.id}">
                    <span class="fila-opcion-nombre">${esc(x.nombre)}</span>
                    <span class="fila-opcion-datos">${x.duracion ? `${Number(x.duracion)} min` : ''}${x.precio != null ? ` · ${esc(dinero(x.precio))}` : ''}</span>
                </button>`).join('')}</div>
        </section>
        ${s ? `<section class="fila-paso" aria-labelledby="paso-barbero">
            <h2 id="paso-barbero" class="fila-subtitulo"><span>2</span> ¿Con quién?</h2>
            <div class="fila-chips" role="radiogroup" aria-labelledby="paso-barbero">
                <button type="button" role="radio" class="fila-chip" data-barbero="" aria-checked="${!estado.barbero}"><i class="fas fa-bolt" aria-hidden="true"></i> Primero disponible</button>
                ${s.barberos.map(id => `<button type="button" role="radio" class="fila-chip" data-barbero="${esc(id)}" aria-checked="${estado.barbero === id}">${esc(nombres.get(id) || 'Barbero')}</button>`).join('')}
            </div>
            <p class="fila-nota">«Primero disponible» suele ser más rápido. Si eliges a alguien, esperas por esa persona.</p>
        </section>
        <div class="fila-accion-fija">
            <p class="fila-error" role="alert" hidden></p>
            <button type="button" class="fila-boton fila-boton-grande" data-tomar>Tomar turno · ${esc(s.nombre)}</button>
        </div>` : ''}`;
}

const ETIQUETAS = { en_espera: 'En espera', llamado: '¡Es tu turno!', en_servicio: 'En servicio', finalizado: 'Atendido',
    salio: 'Saliste de la fila', no_se_presento: 'Turno vencido' };

function textoEspera(t) {
    if (!t.espera) return '<span class="fila-espera-valor sin">Sin estimación por ahora</span><span class="fila-espera-nota">Depende de las citas y de quién termine antes. Sigue esta página: se actualiza sola.</span>';
    const { min, max } = t.espera;
    if (max <= 5) return '<span class="fila-espera-valor">En breve</span>';
    return `<span class="fila-espera-valor">${min}–${max} <small>min</small></span><span class="fila-espera-nota">Estimación con la duración de los servicios y las citas del equipo.</span>`;
}

function pintarTurno() {
    const t = estado.turno;
    const activo = ['en_espera', 'llamado'].includes(t.estado);
    const clase = t.estado === 'llamado' ? 'llamado' : t.cerca ? 'cerca' : t.estado;
    let centro = '';
    if (t.estado === 'en_espera') {
        centro = `${t.cerca ? '<p class="fila-cerca"><i class="fas fa-bell" aria-hidden="true"></i> Ya casi te toca. Acércate al local.</p>' : ''}
            <dl class="fila-cifras">
                <div><dt>Por delante</dt><dd>${Number(t.delante)}</dd></div>
                <div class="fila-espera"><dt>Espera estimada</dt><dd>${textoEspera(t)}</dd></div>
            </dl>`;
    } else if (t.estado === 'llamado') {
        centro = `<p class="fila-llamado-texto">Pasa con <strong>${esc(t.barbero || 'tu barbero')}</strong>${t.silla ? ` · <strong>silla&nbsp;${Number(t.silla)}</strong>` : ''}</p>
            <p class="fila-cortesia" data-cortesia data-hasta="${esc(t.llamado_hasta)}" data-ahora="${esc(t.ahora)}"></p>`;
    } else if (t.estado === 'en_servicio') {
        centro = `<p class="fila-llamado-texto">Te atiende <strong>${esc(t.barbero || '')}</strong>${t.silla ? ` en la silla&nbsp;${Number(t.silla)}` : ''}</p>`;
    } else {
        const textos = { finalizado: '¡Gracias por visitarnos!', salio: 'Saliste de la fila. Tu turno quedó libre para otra persona.',
            no_se_presento: 'Te llamamos y no llegaste a tiempo, así que el turno se cerró.' };
        centro = `<p class="fila-texto">${textos[t.estado]}</p>`;
    }
    raiz.innerHTML = `
        <section class="fila-tarjeta fila-turno ${clase}" aria-labelledby="fila-codigo">
            <p class="fila-estado"><span class="fila-punto" aria-hidden="true"></span>${esc(ETIQUETAS[t.estado])}</p>
            <p class="fila-codigo-etiqueta">Tu turno</p>
            <h1 class="fila-codigo" id="fila-codigo">${esc(t.codigo)}</h1>
            <p class="fila-servicio">${esc(t.servicio || '')}${t.preferencia ? ` · con ${esc(t.preferencia)}` : ' · primero disponible'}</p>
            ${centro}
        </section>
        ${activo ? `<section class="fila-tarjeta fila-avisos" data-avisos hidden></section>` : ''}
        ${activo && t.recepcion_abierta === false ? '<p class="fila-nota fila-centro">La fila está en pausa para turnos nuevos; el tuyo sigue en pie.</p>' : ''}
        <div class="fila-acciones">
            ${activo ? '<button type="button" class="fila-boton secundario peligro" data-salir>Salir de la fila</button>'
                     : '<button type="button" class="fila-boton" data-nuevo>Tomar otro turno</button>'}
        </div>
        <p class="fila-nota fila-centro">Guarda esta página: con este enlace privado vuelves a tu turno. No lo compartas.</p>`;
    if (activo) pintarAvisos();
    actualizarCortesia();
}

function actualizarCortesia() {
    clearInterval(reloj);
    const caja = raiz.querySelector('[data-cortesia]');
    if (!caja) return;
    // Diferencia entre la hora del servidor y la de este teléfono (el plazo se muestra con la hora del servidor)
    const desfase = Date.parse(caja.dataset.ahora) - Date.now();
    const pintar = () => {
        const resta = Math.round((Date.parse(caja.dataset.hasta) - (Date.now() + desfase)) / 1000);
        caja.textContent = resta > 0 ? `Tienes ${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, '0')} para presentarte.` : 'Preséntate ya: el plazo está por vencer.';
    };
    pintar();
    reloj = setInterval(pintar, 1000);
}

// ---------- Avisos con la página cerrada (Web Push existente) ----------
function base64AUint8(b64) {
    const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function pintarAvisos() {
    const caja = raiz.querySelector('[data-avisos]');
    if (!caja) return;
    const compatible = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && VAPID_PUBLIC_KEY && window.isSecureContext;
    if (!compatible) {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        caja.hidden = false;
        caja.innerHTML = `<p class="fila-nota"><i class="fa-regular fa-bell-slash" aria-hidden="true"></i> ${ios
            ? 'En iPhone los avisos con la página cerrada requieren añadir esta web a la pantalla de inicio. Mientras tanto, mantén esta página abierta.'
            : 'Este navegador no permite avisos con la página cerrada. Mantén esta página abierta: se actualiza sola.'}</p>`;
        return;
    }
    if (Notification.permission === 'denied') {
        caja.hidden = false;
        caja.innerHTML = '<p class="fila-nota"><i class="fa-regular fa-bell-slash" aria-hidden="true"></i> Bloqueaste las notificaciones de esta web. Mantén esta página abierta para ver tu turno.</p>';
        return;
    }
    const activos = leer(`barberia-fila-push:${estado.token}`, sessionStorage) || leer(`barberia-fila-push:${estado.token}`);
    caja.hidden = false;
    caja.innerHTML = activos
        ? '<p class="fila-nota ok"><i class="fas fa-bell" aria-hidden="true"></i> Te avisaremos en este teléfono aunque cierres la página.</p>'
        : `<button type="button" class="fila-boton secundario" data-push><i class="fas fa-bell" aria-hidden="true"></i> Avisarme aunque cierre la página</button>`;
}
async function activarPush(boton) {
    boton.disabled = true;
    try {
        if (await Notification.requestPermission() !== 'granted') throw new Error('permiso');
        const reg = await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription()
            || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(VAPID_PUBLIC_KEY) });
        const j = sub.toJSON();
        const r = await rpc('fila_push_suscribir', { p_token: estado.token, p_datos: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo: navigator.userAgent.slice(0, 200) } });
        if (!r?.ok) throw new Error(r?.motivo || 'no');
        guardar(`barberia-fila-push:${estado.token}`, true);
        pintarAvisos();
    } catch (e) {
        boton.disabled = false;
        const caja = raiz.querySelector('[data-avisos]');
        caja.insertAdjacentHTML('beforeend', `<p class="fila-nota">${e.message === 'permiso' ? 'Sin permiso de notificaciones: mantén esta página abierta.'
            : e.message === 'dispositivo_en_uso' ? 'Este dispositivo recibe avisos de otra cuenta del equipo: mantén esta página abierta.'
            : 'No se pudieron activar los avisos. Mantén esta página abierta.'}</p>`);
    }
}

// ---------- Ciclo ----------
function alerta(nuevo) {
    // Al ser llamado con la página abierta: vibración y un tono breve
    if (ultimoEstado && ultimoEstado !== nuevo && nuevo === 'llamado') {
        navigator.vibrate?.([300, 120, 300]);
        try {
            const A = window.AudioContext || window.webkitAudioContext;
            const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain();
            o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.4);
        } catch { /* sin audio */ }
    }
    ultimoEstado = nuevo;
}

async function actualizar() {
    clearTimeout(temporizador);
    try {
        if (estado.token) {
            const t = await rpc('fila_turno', { p_token: estado.token });
            if (!t) { fijarToken(null); estado.turno = null; return actualizar(); }
            alerta(t.estado);
            const cambio = JSON.stringify(t) !== JSON.stringify(estado.turno);
            estado.turno = t;
            if (cambio && !raiz.contains(document.activeElement)) pintarTurno();
            else if (cambio) { const foco = document.activeElement?.dataset; pintarTurno(); if (foco?.salir !== undefined) raiz.querySelector('[data-salir]')?.focus(); }
            if (['finalizado', 'salio', 'no_se_presento'].includes(t.estado)) return; // terminado: sin más consultas
        } else {
            const p = await rpc('fila_publica');
            const antes = JSON.stringify(estado.publica);
            estado.publica = p;
            if (!p.recepcion_abierta) pintarCerrada();
            else if (antes !== JSON.stringify(p) || !raiz.querySelector('.fila-paso')) pintarEleccion();
            if (!p.recepcion_abierta || !estado.token) { /* elección: se refresca con menos frecuencia */ }
        }
        red.hidden = true;
    } catch (e) {
        if (!estado.turno && !estado.publica) pintarError(mensaje(e));
        red.hidden = navigator.onLine !== false && !esRed(e);
    }
    if (document.visibilityState === 'visible') temporizador = setTimeout(actualizar, estado.token ? INTERVALO : INTERVALO * 3);
}

async function tomarTurno(boton) {
    if (estado.enviando || !estado.servicio) return;
    estado.enviando = true;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Tomando turno…';
    const error = raiz.querySelector('.fila-error');
    error.hidden = true;
    // La misma elección conserva su clave: un reintento (o un doble toque) no crea otro turno
    const firma = `${estado.servicio.id}|${estado.barbero || ''}`;
    let pendiente = leer(CLAVE_SOLICITUD, sessionStorage);
    if (!pendiente || pendiente.firma !== firma) { pendiente = { firma, clave: nuevaClave() }; guardar(CLAVE_SOLICITUD, pendiente, sessionStorage); }
    try {
        const r = await rpc('fila_tomar_turno', { p_servicio: estado.servicio.id, p_barbero: estado.barbero || null, p_clave: pendiente.clave });
        guardar(CLAVE_SOLICITUD, null, sessionStorage);
        fijarToken(r.token);
        delete r.token;
        estado.turno = r;
        ultimoEstado = r.estado;
        pintarTurno();
        raiz.querySelector('.fila-codigo')?.focus?.();
        actualizar();
    } catch (e) {
        error.textContent = mensaje(e);
        error.hidden = false;
        boton.disabled = false;
        boton.textContent = `Tomar turno · ${estado.servicio.nombre}`;
        if (/fila_cerrada/.test(e?.message || '')) { estado.publica = null; actualizar(); }
    } finally { estado.enviando = false; }
}

raiz.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.servicio !== undefined) {
        estado.servicio = estado.publica.servicios.find(s => s.id === b.dataset.servicio);
        if (estado.barbero && !estado.servicio.barberos.includes(estado.barbero)) estado.barbero = null;
        pintarEleccion();
        raiz.querySelector('#paso-barbero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        raiz.querySelector(`[data-servicio="${CSS.escape(estado.servicio.id)}"]`)?.focus({ preventScroll: true });
    } else if (b.dataset.barbero !== undefined) {
        estado.barbero = b.dataset.barbero || null;
        raiz.querySelectorAll('[data-barbero]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    } else if (b.matches('[data-tomar]')) tomarTurno(b);
    else if (b.matches('[data-reintentar]')) { raiz.innerHTML = '<div class="fila-cargando"><span class="fila-esqueleto"></span></div>'; actualizar(); }
    else if (b.matches('[data-push]')) activarPush(b);
    else if (b.matches('[data-nuevo]')) { fijarToken(null); estado.turno = null; estado.publica = null; ultimoEstado = null; actualizar(); }
    else if (b.matches('[data-salir]')) {
        if (!confirm(`¿Salir de la fila? Tu turno ${estado.turno.codigo} quedará libre y no podrás recuperarlo.`)) return;
        b.disabled = true;
        try { estado.turno = await rpc('fila_salir', { p_token: estado.token }); ultimoEstado = estado.turno.estado; pintarTurno(); }
        catch (err) { b.disabled = false; alert(mensaje(err)); actualizar(); }
    }
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') actualizar(); });
window.addEventListener('online', () => { red.hidden = true; actualizar(); });
window.addEventListener('offline', () => { red.hidden = false; });
window.addEventListener('hashchange', () => { const t = tokenInicial(); if (t && t !== estado.token) { fijarToken(t); estado.turno = null; actualizar(); } });

if (!estaSupabaseListo()) {
    pintarError('La fila virtual no está disponible en este momento. Puedes reservar una cita.', false);
} else {
    const t = tokenInicial();
    if (t) fijarToken(t);
    identidad();
    actualizar();
}
