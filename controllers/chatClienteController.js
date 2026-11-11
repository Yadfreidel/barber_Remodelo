// ==========================================
// «HABLAR CON LA BARBERÍA» (cliente con cuenta en «Mis citas»)
// Una conversación privada por cuenta. El servidor solo deja ver y escribir en la propia conversación.
// Acciones rápidas con datos reales: referencia para el corte, citas de la cuenta, precios del catálogo y
// solicitud de cambio (el flujo de cambio de siempre si la cita aún lo admite; si no, queda registrada en el chat).
// ==========================================

import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { crearChat, esc, seguirTeclado } from '../assets/chat/chat-conversacion.js';
import { clasificar } from '../assets/mis-citas-store.js';
import { fechaLarga, formato12h, rango12h } from '../assets/horario-utils.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';

const INTERVALO_CONTADOR = 45000;
let caja = null;
let hoja = null;
let chat = null;
let estado = { sesion: null, conversacion: null, noLeidos: 0, asignado: null };
let citasCache = null;
let temporizador = null;
let turno = 0;
let soltarTeclado = null;

// ---------- Acceso en «Mis citas» y contador ----------
export function montarAccesoChat(vista) {
    if (caja || !vista) return;
    caja = document.createElement('section');
    caja.className = 'mc-chat';
    caja.id = 'mc-chat';
    caja.setAttribute('aria-label', 'Hablar con la barbería');
    vista.querySelector('.view-heading')?.after(caja);
    caja.addEventListener('click', e => {
        if (e.target.closest('[data-abrir-chat]')) abrirChat();
        if (e.target.closest('[data-iniciar-sesion]')) {
            const detalles = vista.querySelector('#mc-cuenta details');
            if (detalles) { detalles.open = true; detalles.scrollIntoView({ block: 'center', behavior: 'smooth' }); detalles.querySelector('input')?.focus({ preventScroll: true }); }
        }
    });
    supabase?.auth.onAuthStateChange(evento => {
        if (['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION'].includes(evento)) setTimeout(() => {
            if (evento === 'SIGNED_OUT') { cerrarChat(); citasCache = null; estado = { sesion: null, conversacion: null, noLeidos: 0, asignado: null }; }
            actualizarAccesoChat();
        }, 0);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') actualizarAccesoChat(); });
    window.addEventListener('mis-citas-actualizadas', () => { citasCache = null; });
    actualizarAccesoChat();
}

export async function actualizarAccesoChat() {
    if (!caja) return;
    const miTurno = ++turno;
    if (!estaSupabaseListo()) { caja.hidden = true; return; }
    let sesion = null;
    try { sesion = (await supabase.auth.getSession()).data.session; } catch { sesion = null; }
    if (miTurno !== turno) return;
    estado.sesion = sesion;
    if (!sesion) { pintarAcceso(); programarContador(); return; }
    try {
        const r = await rpcCliente('chat_mi_conversacion');
        if (miTurno !== turno) return;
        estado.conversacion = r.conversacion;
        estado.noLeidos = Number(r.no_leidos || 0);
        estado.asignado = r.asignado || null;
    } catch { /* sin conexión: se mantiene el último contador */ }
    pintarAcceso();
    programarContador();
}

function programarContador() {
    clearTimeout(temporizador);
    if (!estado.sesion || document.visibilityState === 'hidden') return;
    temporizador = setTimeout(actualizarAccesoChat, INTERVALO_CONTADOR);
}

function pintarAcceso() {
    caja.hidden = false;
    const n = estado.noLeidos;
    caja.innerHTML = estado.sesion
        ? `<button type="button" class="mc-chat-boton" data-abrir-chat>
              <span class="mc-chat-icono" aria-hidden="true"><i class="fa-regular fa-comments"></i></span>
              <span class="mc-chat-texto"><strong>Hablar con la barbería</strong>
                <span>${n ? `${n === 1 ? 'Tienes 1 mensaje nuevo' : `Tienes ${n} mensajes nuevos`}` : estado.asignado ? `Te atiende ${esc(estado.asignado)}` : 'Fotos de tu corte, notas de voz y dudas sobre tu cita'}</span></span>
              ${n ? `<span class="mc-chat-numero" aria-label="${n} sin leer">${n > 99 ? '99+' : n}</span>` : '<i class="fas fa-chevron-right" aria-hidden="true"></i>'}
           </button>`
        : `<div class="mc-chat-boton mc-chat-sin-sesion">
              <span class="mc-chat-icono" aria-hidden="true"><i class="fa-regular fa-comments"></i></span>
              <span class="mc-chat-texto"><strong>Hablar con la barbería</strong><span>Inicia sesión para escribirnos de forma privada desde la app.</span></span>
              <button type="button" class="mc-boton mc-secundario" data-iniciar-sesion>Iniciar sesión</button>
           </div>`;
    // Insignia en la barra inferior («Mis citas»)
    const enlace = document.querySelector('.bottom-nav [data-view="mis-citas"]');
    if (enlace) {
        enlace.querySelector('.nav-insignia')?.remove();
        if (n) enlace.insertAdjacentHTML('beforeend', `<span class="nav-insignia" aria-label="${n} mensaje(s) sin leer">${n > 9 ? '9+' : n}</span>`);
    }
}

async function rpcCliente(fn, args = {}) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
}

// ---------- Citas de la cuenta ----------
async function citasProximas() {
    if (!citasCache) {
        const todas = await rpcCliente('mis_citas');
        citasCache = clasificar(todas).proximas.filter(c => c.estado !== 'cancelada' && !c.completada && !c.no_asistio);
    }
    return citasCache;
}
const etiquetaCita = c => `${c.servicio || 'Servicio'} · ${fechaLarga(c.fecha)} · ${formato12h(c.hora)}`;
const citaPorToken = token => (citasCache || []).find(c => c.token === token) || null;

// ---------- Hoja del chat ----------

export async function abrirChat({ enfocar = true } = {}) {
    if (hoja || !estado.sesion) return;
    const origen = document.activeElement;
    hoja = document.createElement('div');
    hoja.className = 'chat-hoja';
    hoja.setAttribute('role', 'dialog');
    hoja.setAttribute('aria-modal', 'true');
    hoja.setAttribute('aria-label', 'Conversación con la barbería');
    hoja.innerHTML = '<div class="chat-hoja-panel"></div>';
    document.body.append(hoja);
    document.documentElement.classList.add('chat-abierto');
    soltarTeclado = seguirTeclado(hoja);
    // El botón «atrás» del móvil cierra el chat sin salir de la app
    history.pushState({ ...(history.state || {}), chatAbierto: true }, '');
    window.addEventListener('popstate', alAtras);
    hoja.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); cerrarChat(); }
    });
    hoja._origen = origen;

    chat = crearChat(hoja.querySelector('.chat-hoja-panel'), {
        cliente: supabase,
        rolVista: 'cliente',
        conversacion: estado.conversacion,
        cabecera: { titulo: 'La barbería', subtitulo: subtitulo() },
        alVolver: true,
        textoVacio: 'Escríbenos tu duda, envía una foto del corte que buscas o una nota de voz. Te responderemos lo antes posible.',
        textoSinAcceso: 'No pudimos abrir tu conversación. Vuelve a iniciar sesión.',
        chips: [
            { etiqueta: 'Enviar referencia', icono: 'camera', accion: c => c.seleccionarFoto({ referencia: true }) },
            { etiqueta: 'Ver mi cita', icono: 'calendar-check', accion: c => elegirCita(c, 'ver') },
            { etiqueta: 'Consultar precios', icono: 'tag', accion: c => mostrarPrecios(c) },
            { etiqueta: 'Solicitar cambio', icono: 'arrows-rotate', accion: c => elegirCita(c, 'cambio') }
        ],
        citasProximas: async () => (await citasProximas()).map(c => ({ token: c.token, etiqueta: etiquetaCita(c) })),
        citaPorToken,
        alSolicitarCambio: (cita, c) => solicitarCambio(c, cita.token),
        alCrearConversacion: id => { estado.conversacion = id; },
        alInfo: r => { estado.asignado = r.asignado || null; chat?.cabecera({ subtitulo: subtitulo() }); },
        alNoLeidos: n => { estado.noLeidos = Number(n || 0); pintarAcceso(); }
    });
    hoja.querySelector('[data-volver]').addEventListener('click', () => cerrarChat());
    if (enfocar) setTimeout(() => chat?.enfocar(), 50);
}
const subtitulo = () => estado.asignado ? `Te atiende ${estado.asignado}` : 'Te responderemos lo antes posible';

function alAtras() { if (hoja) cerrarChat({ desdeHistorial: true }); }

export function cerrarChat({ desdeHistorial = false } = {}) {
    if (!hoja) return;
    chat?.destruir();
    chat = null;
    const origen = hoja._origen;
    hoja.remove();
    hoja = null;
    document.documentElement.classList.remove('chat-abierto');
    soltarTeclado?.();
    soltarTeclado = null;
    window.removeEventListener('popstate', alAtras);
    if (!desdeHistorial && history.state?.chatAbierto) history.back();
    origen?.focus?.({ preventScroll: true });
    actualizarAccesoChat();
}

// ---------- Acciones rápidas ----------
function listaCitasHTML(citas, accion) {
    return citas.map(c => `<li class="chat-opcion">
        <div><strong>${esc(c.servicio || 'Servicio')}</strong><span>${esc(fechaLarga(c.fecha))} · ${esc(rango12h(c.hora, c.hora_fin))} · ${esc(c.barbero || '')}</span></div>
        <div class="chat-opcion-acciones">${accion === 'ver'
            ? `<button type="button" class="chat-cita-boton" data-compartir="${esc(c.token)}">Compartir en el chat</button><a class="chat-cita-boton secundario" href="?cita=${encodeURIComponent(c.token)}#contacto">Abrir</a>`
            : `<button type="button" class="chat-cita-boton" data-cambiar="${esc(c.token)}">Elegir</button>`}</div></li>`).join('');
}

async function elegirCita(c, accion) {
    const d = c.dialogo('chat-selector', `<div class="chat-previa-cuerpo">
        <h2 class="chat-dialogo-titulo">${accion === 'ver' ? 'Tus próximas citas' : '¿Qué cita quieres cambiar?'}</h2>
        <div data-contenido><p class="chat-cargando-texto">Cargando tus citas…</p></div>
        <div class="chat-dialogo-acciones"><button type="button" class="chat-cita-boton secundario" data-cerrar>Cerrar</button></div></div>`);
    d.querySelector('[data-cerrar]').addEventListener('click', () => d.close());
    const contenido = d.querySelector('[data-contenido]');
    let citas;
    try { citas = await citasProximas(); }
    catch { contenido.innerHTML = '<p class="chat-error-pie" role="alert">No pudimos cargar tus citas. Revisa tu conexión.</p>'; return; }
    if (!d.open) return;
    if (!citas.length) {
        contenido.innerHTML = `<p class="chat-nota">No tienes citas próximas en tu cuenta.</p>
            <a class="chat-cita-boton" href="#contacto" data-reservar>Reservar una cita</a>`;
        contenido.querySelector('[data-reservar]').addEventListener('click', () => { d.close(); cerrarChat(); });
        return;
    }
    contenido.innerHTML = `<ul class="chat-opciones">${listaCitasHTML(citas, accion)}</ul>`;
    contenido.addEventListener('click', e => {
        const compartir = e.target.closest('[data-compartir]');
        if (compartir) { d.close(); const cita = citaPorToken(compartir.dataset.compartir); c.enviarCita(compartir.dataset.compartir, { cita: cita && { disponible: true, ...cita } }); }
        const cambiar = e.target.closest('[data-cambiar]');
        if (cambiar) { d.close(); solicitarCambio(c, cambiar.dataset.cambiar); }
        if (e.target.closest('a[href^="?cita="]')) cerrarChat();
    });
}

// Si la cita aún admite cambios desde la web, se usa el flujo de siempre (fecha y hora con disponibilidad real);
// si ya no, la solicitud queda registrada en el chat para que la barbería la gestione.
async function solicitarCambio(c, token) {
    let cita = citaPorToken(token);
    if (!cita) { try { await citasProximas(); cita = citaPorToken(token); } catch { /* se usa el registro en el chat */ } }
    if (cita?.modificable) {
        const d = c.dialogo('chat-selector', `<div class="chat-previa-cuerpo">
            <h2 class="chat-dialogo-titulo">Cambiar tu cita</h2>
            <p>${esc(etiquetaCita(cita))}</p>
            <p class="chat-nota">Puedes elegir otra fecha u hora con la disponibilidad real desde tu cita. Si prefieres, escríbenos aquí.</p>
            <div class="chat-dialogo-acciones">
                <button type="button" class="chat-cita-boton secundario" data-en-chat>Pedirlo por el chat</button>
                <a class="chat-cita-boton" href="?cita=${encodeURIComponent(token)}#contacto" data-flujo>Cambiar fecha u hora</a></div></div>`);
        d.querySelector('[data-flujo]').addEventListener('click', () => { d.close(); cerrarChat(); });
        d.querySelector('[data-en-chat]').addEventListener('click', () => { d.close(); formularioSolicitud(c, token, cita); });
        return;
    }
    formularioSolicitud(c, token, cita);
}

function formularioSolicitud(c, token, cita) {
    const d = c.dialogo('chat-selector', `<form class="chat-previa-cuerpo" novalidate>
        <h2 class="chat-dialogo-titulo">Solicitar un cambio</h2>
        ${cita ? `<p>${esc(etiquetaCita(cita))}</p>` : ''}
        ${cita && !cita.modificable ? '<p class="chat-nota">Esta cita ya no se puede cambiar desde la web. Tu solicitud queda registrada en el chat y la barbería te responderá.</p>' : ''}
        <label class="chat-campo">¿Qué cambio necesitas?<textarea name="detalle" rows="3" maxlength="1000" required placeholder="Ej.: ¿Puedo pasarla a las 4:00 p. m. o a mañana?"></textarea></label>
        <p class="chat-error-pie" role="alert" hidden></p>
        <div class="chat-dialogo-acciones"><button type="button" class="chat-cita-boton secundario" data-cerrar>Cancelar</button>
            <button type="submit" class="chat-cita-boton">Enviar solicitud</button></div></form>`);
    d.querySelector('[data-cerrar]').addEventListener('click', () => d.close());
    d.querySelector('textarea').focus();
    d.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const detalle = d.querySelector('textarea').value.trim();
        if (detalle.length < 3) { const err = d.querySelector('.chat-error-pie'); err.textContent = 'Cuéntanos qué cambio necesitas.'; err.hidden = false; return; }
        d.close();
        c.enviarSolicitudCambio(token, detalle, cita && { disponible: true, ...cita });
    });
}

function mostrarPrecios(c) {
    const servicios = obtenerServicios().filter(s => s.nombre);
    const d = c.dialogo('chat-selector', `<div class="chat-previa-cuerpo">
        <h2 class="chat-dialogo-titulo">Precios</h2>
        ${servicios.length ? `<ul class="chat-opciones chat-precios">${servicios.map((s, i) => `<li class="chat-opcion">
            <div><strong>${esc(s.nombre)}</strong><span>${esc(formatoPrecioServicio(s.precio))}${s.duracion_minutos ? ` · ${Number(s.duracion_minutos)} min` : ''}</span></div>
            <div class="chat-opcion-acciones"><button type="button" class="chat-cita-boton secundario" data-preguntar="${i}">Preguntar</button></div></li>`).join('')}</ul>
            <p class="chat-nota">Precios del catálogo actual. El precio final se confirma al reservar.</p>`
            : '<p class="chat-nota">El catálogo no está disponible en este momento. Escríbenos y te informamos.</p>'}
        <div class="chat-dialogo-acciones"><button type="button" class="chat-cita-boton secundario" data-cerrar>Cerrar</button></div></div>`);
    d.querySelector('[data-cerrar]').addEventListener('click', () => d.close());
    d.addEventListener('click', e => {
        const b = e.target.closest('[data-preguntar]');
        if (!b) return;
        const s = servicios[Number(b.dataset.preguntar)];
        d.close();
        c.insertarTexto(`Hola, quería consultar por «${s.nombre}» (${formatoPrecioServicio(s.precio)}). `);
    });
}
