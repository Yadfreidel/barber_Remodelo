// ==========================================
// CHAT: vista de una conversación (cliente y panel)
// - Historial paginado (los anteriores se cargan al subir) y botón «Nuevos mensajes» si se está leyendo arriba.
// - Novedades cada pocos segundos mientras la vista está abierta y visible; se pausa en segundo plano.
// - Cada envío tiene una clave propia: el reintento (manual o al volver la conexión) no duplica nada, y si la
//   respuesta se perdió, el mensaje guardado sustituye al pendiente al llegar con las novedades.
// - Fotos (cámara o galería) con vista previa y progreso de subida; notas de voz con temporizador, escucha
//   previa y descarte; reproducción con 1×, 1,5× y 2×.
// - El servidor decide los permisos: si se pierde el acceso (p. ej. reasignación) la vista lo indica.
// ==========================================

import { ZONA, fechaLarga, rango12h } from '../horario-utils.js';
import { prepararFoto, compatibilidadAudio, iniciarGrabacion, audioADataURL, dataURLaObjeto, rpcConProgreso, MAX_AUDIO_MS, MENSAJES_MICROFONO } from './chat-medios.js';

const ERRORES = {
    no_autorizado: 'Ya no tienes acceso a esta conversación.',
    cambio_clave_requerido: 'Cambia tu contraseña temporal para continuar.',
    demasiados_mensajes: 'Estás enviando muy rápido. Espera unos segundos.',
    demasiados_adjuntos: 'Alcanzaste el límite de fotos y audios por hora. Inténtalo más tarde.',
    adjunto_invalido: 'El archivo no es válido (foto JPG, PNG o WebP de hasta ~1 MB; nota de voz de hasta 3 minutos).',
    mensaje_invalido: 'El mensaje no es válido (máximo 2000 caracteres).',
    cita_no_encontrada: 'No encontramos esa cita en tu cuenta.',
    cita_no_proxima: 'Solo puedes usar una cita próxima (no cancelada ni completada).',
    datos_invalidos: 'Revisa los datos.',
    JWT: 'Tu sesión expiró. Vuelve a iniciar sesión.'
};
const esRed = e => e?.red || /Failed to fetch|NetworkError|Load failed|network|HTTP 5\d\d|HTTP 0/i.test(e?.message || '');
export function mensajeChat(e) {
    const texto = e?.message || String(e || '');
    const clave = Object.keys(ERRORES).find(k => texto.includes(k));
    if (clave) return ERRORES[clave];
    return esRed(e) ? 'Sin conexión. Se enviará al volver la conexión.' : 'No se pudo completar. Inténtalo de nuevo.';
}

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function nuevaClave() {
    if (globalThis.crypto?.randomUUID) { try { return crypto.randomUUID(); } catch { /* contexto no seguro */ } }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const fmtHora = new Intl.DateTimeFormat('es-DO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const diaDe = iso => fmtDia.format(new Date(iso));
function etiquetaDia(dia) {
    const hoy = fmtDia.format(new Date());
    const ayer = fmtDia.format(new Date(Date.now() - 864e5));
    return dia === hoy ? 'Hoy' : dia === ayer ? 'Ayer' : fechaLarga(dia);
}
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function estadoCita(c) {
    if (c.estado === 'cancelada') return ['Cancelada', 'cancelada'];
    if (c.no_asistio) return ['No asistió', 'cancelada'];
    if (c.completada) return ['Completada', 'confirmada'];
    if (c.estado === 'confirmada') return ['Confirmada', 'confirmada'];
    return ['Pendiente de confirmación', 'pendiente'];
}
const citaActiva = c => c?.disponible && c.estado !== 'cancelada' && !c.completada && !c.no_asistio;

// Con el teclado del móvil abierto, el elemento ocupa solo la parte visible (el campo de texto queda a la vista).
// Devuelve la función que deja de seguirlo.
export function seguirTeclado(elemento) {
    const vv = window.visualViewport;
    if (!vv || !elemento) return () => {};
    const ajustar = () => {
        elemento.style.setProperty('--chat-alto', `${vv.height}px`);
        elemento.style.setProperty('--chat-arriba', `${vv.offsetTop}px`);
    };
    ajustar();
    vv.addEventListener('resize', ajustar);
    vv.addEventListener('scroll', ajustar);
    return () => { vv.removeEventListener('resize', ajustar); vv.removeEventListener('scroll', ajustar); };
}

const ESTADOS_ENVIO = { enviando: 'Enviando…', error: 'No enviado', rechazado: 'No se pudo enviar' };

export function crearChat(raiz, opciones) {
    const { cliente, rolVista } = opciones;          // rolVista: 'cliente' | 'personal'
    const st = {
        conv: opciones.conversacion || null, rol: null, mensajes: new Map(), pendientes: new Map(),
        ultimoId: 0, primerId: null, hayMas: false, leidoPorOtro: 0, leidoHasta: 0, cargando: false,
        activo: true, sondeo: null, fallos: 0, nuevos: 0, objetos: new Set(), audios: new Map(), sinAcceso: false
    };
    const comp = compatibilidadAudio();
    raiz.classList.add('chat');
    raiz.dataset.vista = rolVista;
    raiz.innerHTML = `
        <header class="chat-cabecera">
            ${opciones.alVolver ? '<button type="button" class="chat-btn-icono chat-volver" data-volver aria-label="Volver"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>' : ''}
            <span class="chat-avatar" aria-hidden="true"><i class="fas fa-${rolVista === 'cliente' ? 'store' : 'user'}"></i></span>
            <div class="chat-cabecera-texto"><strong class="chat-titulo"></strong><span class="chat-subtitulo"></span></div>
            <div class="chat-cabecera-extra"></div>
        </header>
        <p class="chat-red" role="status" hidden><i class="fas fa-wifi" aria-hidden="true"></i> Sin conexión. Los mensajes pendientes se enviarán al volver la conexión.</p>
        <div class="chat-hilo" tabindex="0" role="log" aria-label="Mensajes de la conversación">
            <div class="chat-arriba" aria-hidden="true"></div>
            <div class="chat-estado-hilo"></div>
            <ol class="chat-lista"></ol>
        </div>
        <button type="button" class="chat-nuevos" data-nuevos hidden><i class="fas fa-arrow-down" aria-hidden="true"></i> <span>Nuevos mensajes</span></button>
        <div class="chat-chips" role="toolbar" aria-label="Acciones rápidas" hidden></div>
        <div class="chat-pie">
            <form class="chat-composer" novalidate>
                <div class="chat-adjuntar">
                    <button type="button" class="chat-btn-icono" data-adjuntar aria-haspopup="true" aria-expanded="false" aria-label="Adjuntar foto"><i class="fas fa-camera" aria-hidden="true"></i></button>
                    <div class="chat-menu" hidden>
                        <button type="button" data-camara><i class="fas fa-camera" aria-hidden="true"></i> Tomar foto</button>
                        <button type="button" data-galeria><i class="fa-regular fa-image" aria-hidden="true"></i> Elegir de la galería</button>
                    </div>
                </div>
                <textarea class="chat-texto" rows="1" maxlength="2000" placeholder="Escribe un mensaje…" aria-label="Mensaje" enterkeyhint="send"></textarea>
                <button type="button" class="chat-btn-icono chat-mic" data-microfono aria-label="Grabar nota de voz"><i class="fas fa-microphone" aria-hidden="true"></i></button>
                <button type="submit" class="chat-btn-enviar" aria-label="Enviar mensaje" hidden><i class="fas fa-paper-plane" aria-hidden="true"></i></button>
                <input type="file" accept="image/*" capture="environment" data-input-camara hidden>
                <input type="file" accept="image/*" data-input-galeria hidden>
            </form>
            <div class="chat-grabacion" hidden>
                <button type="button" class="chat-btn-icono" data-descartar-audio aria-label="Descartar nota de voz"><i class="fas fa-trash" aria-hidden="true"></i></button>
                <span class="chat-grabando"><span class="chat-punto" aria-hidden="true"></span><span data-tiempo>0:00</span><span class="chat-max">/ ${mmss(MAX_AUDIO_MS)}</span></span>
                <span class="sr-only" role="status" data-estado-grabacion></span>
                <button type="button" class="chat-btn-enviar chat-detener" data-detener aria-label="Detener y escuchar"><i class="fas fa-stop" aria-hidden="true"></i></button>
            </div>
            <div class="chat-revision" hidden>
                <button type="button" class="chat-btn-icono" data-descartar-audio aria-label="Descartar nota de voz"><i class="fas fa-trash" aria-hidden="true"></i></button>
                <div class="chat-revision-audio"></div>
                <button type="button" class="chat-btn-enviar" data-enviar-audio aria-label="Enviar nota de voz"><i class="fas fa-paper-plane" aria-hidden="true"></i></button>
            </div>
            <p class="chat-error-pie" role="alert" hidden></p>
        </div>`;

    const $ = s => raiz.querySelector(s);
    const hilo = $('.chat-hilo');
    const lista = $('.chat-lista');
    const texto = $('.chat-texto');
    const form = $('.chat-composer');
    const botonEnviar = $('.chat-btn-enviar');
    const botonMic = $('[data-microfono]');
    const avisoNuevos = $('[data-nuevos]');
    const errorPie = $('.chat-error-pie');
    const reproductor = new Audio();
    reproductor.preload = 'auto';
    let actual = null;      // { nodo, id } del audio que suena

    // ---------- Cabecera y acciones rápidas ----------
    function cabecera({ titulo, subtitulo, extra } = {}) {
        if (titulo !== undefined) $('.chat-titulo').textContent = titulo;
        if (subtitulo !== undefined) $('.chat-subtitulo').textContent = subtitulo || '';
        if (extra !== undefined) { const c = $('.chat-cabecera-extra'); c.innerHTML = ''; if (extra) c.append(extra); }
    }
    cabecera(opciones.cabecera || {});
    function chips(lista_) {
        const caja = $('.chat-chips');
        caja.hidden = !lista_?.length;
        caja.innerHTML = (lista_ || []).map((c, i) => `<button type="button" class="chat-chip" data-chip="${i}">${c.icono ? `<i class="fas fa-${esc(c.icono)}" aria-hidden="true"></i>` : ''}<span>${esc(c.etiqueta)}</span></button>`).join('');
        caja.onclick = e => { const b = e.target.closest('[data-chip]'); if (b) lista_[Number(b.dataset.chip)].accion(api, b); };
    }
    chips(opciones.chips);

    // ---------- Pintado de mensajes ----------
    function tarjetaCita(c) {
        if (!c) return '';
        if (!c.disponible) return '<div class="chat-cita chat-cita-no">La cita ya no está disponible.</div>';
        const [estado, clase] = estadoCita(c);
        let acciones = '';
        if (rolVista === 'cliente' && c.token) {
            acciones = `<a class="chat-cita-boton" href="?cita=${encodeURIComponent(c.token)}#contacto">Ver cita</a>`
                + (citaActiva(c) ? `<button type="button" class="chat-cita-boton secundario" data-solicitar-cambio="${esc(c.token)}" data-modificable="${c.modificable ? '1' : ''}">Solicitar cambio</button>` : '');
        } else if (rolVista === 'personal' && c.id && (st.rol === 'admin' || c.propia)) {
            acciones = `<button type="button" class="chat-cita-boton" data-ver-agenda="${esc(c.id)}" data-fecha="${esc(c.fecha)}">Ver en agenda</button>`;
        }
        return `<div class="chat-cita" data-estado="${clase}">
            <div class="chat-cita-cab"><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>Cita</span><span class="chat-estado ${clase}">${esc(estado)}</span></div>
            <strong class="chat-cita-servicio">${esc(c.servicio || 'Servicio')}</strong>
            <dl class="chat-cita-datos">
                <div><dt>Barbero</dt><dd>${esc(c.barbero || '—')}</dd></div>
                <div><dt>Fecha</dt><dd>${esc(fechaLarga(c.fecha))}</dd></div>
                <div><dt>Hora</dt><dd>${esc(rango12h(c.hora, c.hora_fin))}</dd></div>
            </dl>
            ${acciones ? `<div class="chat-cita-acciones">${acciones}</div>` : ''}</div>`;
    }
    function lineaReferencia(r) {
        if (!r) return '';
        if (!r.disponible) return '<p class="chat-ref"><i class="fas fa-bookmark" aria-hidden="true"></i> Referencia de una cita que ya no está disponible</p>';
        if (!r.fecha) return `<p class="chat-ref"><i class="fas fa-bookmark" aria-hidden="true"></i> Referencia para ${rolVista === 'cliente' ? 'tu corte' : 'el corte'}${r.etiqueta ? ` · ${esc(r.etiqueta)}` : ''}</p>`;
        return `<p class="chat-ref"><i class="fas fa-bookmark" aria-hidden="true"></i> Referencia para ${rolVista === 'cliente' ? 'tu' : 'la'} cita del ${esc(fechaLarga(r.fecha))} · ${esc(rango12h(r.hora, r.hora_fin))}</p>`;
    }
    function contenido(m) {
        const a = m.adjunto;
        const leyenda = m.texto ? `<p class="chat-texto-msg">${esc(m.texto)}</p>` : '';
        switch (m.tipo) {
            case 'foto': {
                const src = m.local?.vista || a?.miniatura || '';
                const proporcion = a?.ancho && a?.alto ? `${a.ancho} / ${a.alto}` : '4 / 5';
                return `<button type="button" class="chat-foto" data-ver-foto="${esc(a?.id || '')}" style="aspect-ratio:${proporcion}" aria-label="Ver foto ampliada${m.texto ? `: ${esc(m.texto)}` : ''}">
                    ${src ? `<img src="${esc(src)}" alt="" decoding="async">` : ''}</button>${leyenda}<div data-ref>${lineaReferencia(a?.referencia)}</div>`;
            }
            case 'audio':
                return `<div class="chat-audio" data-audio="${esc(a?.id || '')}" data-duracion="${Number(a?.duracion_ms || m.local?.duracion_ms || 0)}">
                    <button type="button" class="chat-audio-play" aria-label="Reproducir nota de voz"><i class="fas fa-play" aria-hidden="true"></i></button>
                    <input type="range" class="chat-audio-barra" min="0" max="1000" value="0" step="1" aria-label="Posición de la nota de voz">
                    <span class="chat-audio-tiempo">${mmss(a?.duracion_ms || m.local?.duracion_ms || 0)}</span>
                    <button type="button" class="chat-audio-vel" aria-label="Velocidad de reproducción: 1×">1×</button></div>`;
            case 'cita':
                return `${leyenda}<div data-tarjeta>${tarjetaCita(m.cita)}</div>`;
            case 'solicitud_cambio':
                return `<p class="chat-solicitud-titulo"><i class="fas fa-arrows-rotate" aria-hidden="true"></i> Solicitud de cambio</p>${leyenda}<div data-tarjeta>${tarjetaCita(m.cita)}</div>`;
            default:
                return leyenda;
        }
    }
    const lado = m => (m.autor_rol === 'cliente') === (rolVista === 'cliente') ? 'mio' : 'suyo';
    function nodoMensaje(m) {
        const li = document.createElement('li');
        if (m.tipo === 'asignacion') {
            li.className = 'chat-sistema';
            li.innerHTML = `<span>${esc(m.texto)}</span>`;
        } else {
            li.className = `chat-msg ${lado(m)} tipo-${m.tipo}`;
            const autor = lado(m) === 'suyo' || rolVista === 'personal' ? `<span class="chat-autor">${esc(m.propio ? 'Tú' : m.autor || '')}</span>` : '';
            li.innerHTML = `<div class="chat-burbuja">${autor}${contenido(m)}
                <span class="chat-meta"><time datetime="${esc(m.creado_en || '')}">${m.creado_en ? esc(fmtHora.format(new Date(m.creado_en))) : ''}</time><span class="chat-estado-envio"></span></span></div>`;
        }
        li.dataset.dia = m.creado_en ? diaDe(m.creado_en) : 'pendiente';
        if (m.id) li.dataset.id = m.id;
        if (m.clave) li.dataset.clave = m.clave;
        li._m = m;
        return li;
    }
    function separadores() {
        lista.querySelectorAll('.chat-dia').forEach(n => n.remove());
        let anterior = null;
        for (const li of [...lista.children]) {
            const dia = li.dataset.dia;
            if (dia && dia !== 'pendiente' && dia !== anterior) {
                const sep = document.createElement('li');
                sep.className = 'chat-dia';
                sep.innerHTML = `<span>${esc(etiquetaDia(dia))}</span>`;
                li.before(sep);
                anterior = dia;
            }
        }
    }
    function marcarVistos() {
        lista.querySelectorAll('.chat-msg.mio[data-id]').forEach(li => {
            const visto = Number(li.dataset.id) <= st.leidoPorOtro;
            li.classList.toggle('visto', visto);
            const e = li.querySelector('.chat-estado-envio');
            if (e && !li.dataset.clavePendiente) e.innerHTML = `<i class="fas fa-check${visto ? '-double' : ''}" aria-hidden="true"></i><span class="sr-only">${visto ? 'Visto' : 'Enviado'}</span>`;
        });
    }
    const primerPendiente = () => lista.querySelector('[data-clave-pendiente]');
    // Inserta mensajes del servidor (en orden), sustituyendo pendientes con la misma clave
    function agregar(mensajes, { arriba = false } = {}) {
        const nuevos = [];
        const ancla = arriba ? lista.firstElementChild : null;
        for (const m of mensajes) {
            if (st.mensajes.has(m.id)) continue;
            st.mensajes.set(m.id, m);
            const nodo = nodoMensaje(m);
            const pendiente = m.clave && st.pendientes.get(m.clave);
            if (pendiente) {
                pendiente.nodo.replaceWith(nodo);
                limpiarPendiente(m.clave);
            } else if (arriba) lista.insertBefore(nodo, ancla);
            else lista.insertBefore(nodo, primerPendiente());
            st.ultimoId = Math.max(st.ultimoId, m.id);
            st.primerId = st.primerId === null ? m.id : Math.min(st.primerId, m.id);
            if (!arriba && !m.propio) nuevos.push(m);
        }
        separadores();
        marcarVistos();
        $('.chat-estado-hilo').innerHTML = '';
        if (!lista.querySelector('.chat-msg, .chat-sistema')) vacio();
        return nuevos;
    }
    function actualizarTarjetas(tarjetas) {
        for (const t of tarjetas || []) {
            const li = lista.querySelector(`[data-id="${t.id}"]`);
            const m = st.mensajes.get(t.id);
            if (!li || !m) continue;
            if (t.cita && JSON.stringify(t.cita) !== JSON.stringify(m.cita)) {
                m.cita = t.cita;
                const caja = li.querySelector('[data-tarjeta]');
                if (caja) caja.innerHTML = tarjetaCita(t.cita);
            }
            if (m.adjunto && JSON.stringify(t.referencia ?? null) !== JSON.stringify(m.adjunto.referencia ?? null)) {
                m.adjunto.referencia = t.referencia;
                const caja = li.querySelector('[data-ref]');
                if (caja) caja.innerHTML = lineaReferencia(t.referencia);
            }
        }
    }
    function vacio() {
        $('.chat-estado-hilo').innerHTML = `<div class="chat-vacio"><i class="fa-regular fa-comments" aria-hidden="true"></i>
            <p>${esc(opciones.textoVacio || 'Aún no hay mensajes.')}</p></div>`;
    }

    // ---------- Desplazamiento ----------
    const cercaDelFinal = () => hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 120;
    const alFinal = (suave = false) => { hilo.scrollTo({ top: hilo.scrollHeight, behavior: suave ? 'smooth' : 'auto' }); };
    function avisarNuevos(n) {
        st.nuevos += n;
        avisoNuevos.hidden = false;
        avisoNuevos.querySelector('span').textContent = st.nuevos === 1 ? '1 mensaje nuevo' : `${st.nuevos} mensajes nuevos`;
    }
    hilo.addEventListener('scroll', () => {
        if (cercaDelFinal()) { st.nuevos = 0; avisoNuevos.hidden = true; leer(); }
        if (hilo.scrollTop < 80) cargarAnteriores();
    }, { passive: true });
    avisoNuevos.addEventListener('click', () => { alFinal(true); st.nuevos = 0; avisoNuevos.hidden = true; texto.focus({ preventScroll: true }); });

    // ---------- Servidor ----------
    const rpc = async (fn, args) => {
        const { data, error } = await cliente.rpc(fn, args);
        if (error) throw error;
        return data;
    };
    function perderAcceso() {
        st.sinAcceso = true;
        detenerSondeo();
        raiz.classList.add('chat-sin-acceso');
        $('.chat-estado-hilo').innerHTML = `<div class="chat-vacio chat-error"><i class="fas fa-lock" aria-hidden="true"></i>
            <p>${esc(opciones.textoSinAcceso || 'Ya no tienes acceso a esta conversación.')}</p></div>`;
        lista.innerHTML = '';
        form.querySelectorAll('button, textarea').forEach(b => { b.disabled = true; });
        $('.chat-chips').hidden = true;
        opciones.alPerderAcceso?.();
    }
    const esNoAutorizado = e => /no_autorizado|cambio_clave_requerido/.test(e?.message || '');

    async function cargarInicio() {
        if (!st.conv) { st.rol = 'cliente'; vacio(); return; }
        $('.chat-estado-hilo').innerHTML = `<div class="chat-cargando" aria-label="Cargando mensajes">${'<span class="chat-esqueleto"></span>'.repeat(4)}</div>`;
        try {
            const r = await rpc('chat_mensajes', { p_conversacion: st.conv, p_antes: null, p_limite: 30 });
            st.rol = r.rol;
            st.hayMas = r.hay_mas;
            st.leidoPorOtro = Number(r.leido_por_otro || 0);
            opciones.alInfo?.(r);
            agregar(r.mensajes);
            if (!r.mensajes.length) vacio();
            alFinal();
            leer(true);
            iniciarSondeo();
            // Historial corto que no llena la vista: no habrá desplazamiento para pedir más
            if (st.hayMas && hilo.scrollHeight <= hilo.clientHeight + 10) cargarAnteriores();
        } catch (e) {
            if (esNoAutorizado(e)) return perderAcceso();
            $('.chat-estado-hilo').innerHTML = `<div class="chat-vacio chat-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                <p>No pudimos cargar la conversación. ${esRed(e) ? 'Revisa tu conexión.' : ''}</p><button type="button" class="chat-cita-boton" data-reintentar-carga>Reintentar</button></div>`;
        }
    }
    raiz.addEventListener('click', e => { if (e.target.closest('[data-reintentar-carga]')) cargarInicio(); });

    async function cargarAnteriores() {
        if (!st.conv || !st.hayMas || st.cargando || st.primerId === null) return;
        st.cargando = true;
        const marca = document.createElement('li');
        marca.className = 'chat-cargando-mas';
        marca.textContent = 'Cargando mensajes anteriores…';
        lista.prepend(marca);
        const alto = hilo.scrollHeight;
        try {
            const r = await rpc('chat_mensajes', { p_conversacion: st.conv, p_antes: st.primerId, p_limite: 30 });
            marca.remove();
            st.hayMas = r.hay_mas;
            agregar(r.mensajes, { arriba: true });
            hilo.scrollTop += hilo.scrollHeight - alto;
        } catch (e) {
            marca.remove();
            if (esNoAutorizado(e)) perderAcceso();
        } finally { st.cargando = false; }
    }

    // Novedades: cada 3 s con la vista visible; con fallos, espera creciente
    function detenerSondeo() { clearTimeout(st.sondeo); st.sondeo = null; }
    function iniciarSondeo(demora = 3000) {
        detenerSondeo();
        if (!st.activo || st.sinAcceso || !st.conv || document.visibilityState === 'hidden') return;
        st.sondeo = setTimeout(sondear, demora);
    }
    async function sondear() {
        if (!st.activo || !st.conv || !raiz.isConnected) return;
        try {
            const r = await rpc('chat_novedades', { p_conversacion: st.conv, p_despues: st.ultimoId });
            st.fallos = 0;
            const estabaAbajo = cercaDelFinal();
            st.rol = r.rol;
            opciones.alInfo?.(r);
            const nuevos = agregar(r.mensajes);
            actualizarTarjetas(r.tarjetas);
            if (Number(r.leido_por_otro || 0) !== st.leidoPorOtro) { st.leidoPorOtro = Number(r.leido_por_otro || 0); marcarVistos(); }
            if (nuevos.length) {
                if (estabaAbajo) { alFinal(true); leer(); }
                else avisarNuevos(nuevos.length);
            }
            opciones.alNoLeidos?.(r.no_leidos);
        } catch (e) {
            if (esNoAutorizado(e)) return perderAcceso();
            st.fallos++;
        }
        iniciarSondeo(st.fallos ? Math.min(30000, 3000 * 2 ** st.fallos) : 3000);
    }
    const alVisibilidad = () => { if (document.visibilityState === 'visible') { sondear(); } else detenerSondeo(); };
    document.addEventListener('visibilitychange', alVisibilidad);

    // Leído: hasta el último mensaje visible (solo con la pestaña visible y al final del hilo)
    let temporizadorLeer = null;
    function leer(forzar = false) {
        if (!st.conv || st.sinAcceso || document.visibilityState === 'hidden' || (!forzar && !cercaDelFinal())) return;
        if (st.ultimoId <= st.leidoHasta) return;
        clearTimeout(temporizadorLeer);
        temporizadorLeer = setTimeout(async () => {
            const hasta = st.ultimoId;
            try {
                const r = await rpc('chat_leer', { p_conversacion: st.conv, p_hasta: hasta });
                st.leidoHasta = Math.max(st.leidoHasta, hasta);
                opciones.alNoLeidos?.(r.no_leidos);
            } catch { /* se reintenta con la próxima novedad */ }
        }, 400);
    }

    // ---------- Red ----------
    const red = $('.chat-red');
    const alRed = () => {
        red.hidden = navigator.onLine !== false;
        if (navigator.onLine !== false) { reintentarPendientes(); sondear(); }
    };
    window.addEventListener('online', alRed);
    window.addEventListener('offline', alRed);
    red.hidden = navigator.onLine !== false;

    // ---------- Envío ----------
    function limpiarPendiente(clave) {
        const p = st.pendientes.get(clave);
        if (!p) return;
        if (p.local?.objeto) { URL.revokeObjectURL(p.local.objeto); st.objetos.delete(p.local.objeto); }
        st.pendientes.delete(clave);
    }
    function pintarPendiente(p) {
        const e = p.nodo.querySelector('.chat-estado-envio');
        p.nodo.classList.toggle('con-error', p.estado !== 'enviando');
        let html = p.estado === 'enviando' ? '<i class="fa-regular fa-clock" aria-hidden="true"></i>' : '<i class="fas fa-circle-exclamation" aria-hidden="true"></i>';
        html += `<span class="${p.estado === 'enviando' ? 'sr-only' : ''}">${esc(ESTADOS_ENVIO[p.estado])}</span>`;
        e.innerHTML = html;
        let pie = p.nodo.querySelector('.chat-pendiente');
        if (!pie) { pie = document.createElement('div'); pie.className = 'chat-pendiente'; p.nodo.querySelector('.chat-burbuja').append(pie); }
        if (p.estado === 'enviando') {
            pie.innerHTML = p.args.p_adjunto ? `<span class="chat-progreso" role="progressbar" aria-label="Subiendo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.progreso * 100)}"><span style="width:${Math.round(p.progreso * 100)}%"></span></span>` : '';
        } else {
            pie.innerHTML = `<span class="chat-pendiente-texto">${esc(p.mensaje || '')}</span>
                ${p.estado === 'error' ? `<button type="button" data-reintentar="${esc(p.args.p_clave)}">Reintentar</button>` : ''}
                <button type="button" data-descartar="${esc(p.args.p_clave)}">Descartar</button>`;
        }
    }
    async function despachar(p) {
        p.estado = 'enviando';
        p.progreso = 0;
        pintarPendiente(p);
        try {
            const m = p.args.p_adjunto
                ? await rpcConProgreso(cliente, 'chat_enviar', p.args, f => { p.progreso = f; pintarPendiente(p); })
                : await rpc('chat_enviar', p.args);
            if (!st.conv && m?.conversacion) {
                st.conv = m.conversacion;
                opciones.alCrearConversacion?.(st.conv);
                st.rol = 'cliente';
            }
            if (st.pendientes.has(p.args.p_clave)) agregar([m]);
            if (st.hayMas && hilo.scrollHeight <= hilo.clientHeight + 10) cargarAnteriores();
            if (cercaDelFinal()) alFinal(true);
            iniciarSondeo(1500);
        } catch (e) {
            if (!st.pendientes.has(p.args.p_clave)) return;     // ya llegó con las novedades
            if (esNoAutorizado(e)) return perderAcceso();
            p.estado = esRed(e) ? 'error' : 'rechazado';
            p.mensaje = mensajeChat(e);
            pintarPendiente(p);
        }
    }
    function reintentarPendientes() {
        for (const p of st.pendientes.values()) if (p.estado === 'error') despachar(p);
    }
    function encolar(tipo, { texto: t = null, adjunto = null, cita = null, local = null } = {}) {
        if (st.sinAcceso) return;
        const clave = nuevaClave();
        const m = { clave, tipo, texto: t, propio: true, autor_rol: rolVista === 'cliente' ? 'cliente' : 'equipo', autor: 'Tú',
            creado_en: null, adjunto: adjunto ? { tipo, ancho: adjunto.ancho, alto: adjunto.alto, duracion_ms: adjunto.duracion_ms, referencia: local?.referencia || null } : null,
            cita: local?.cita || null, local };
        const nodo = nodoMensaje(m);
        nodo.dataset.clavePendiente = clave;
        lista.append(nodo);
        $('.chat-estado-hilo').innerHTML = '';
        const p = { nodo, local, estado: 'enviando', progreso: 0,
            args: { p_conversacion: st.conv, p_clave: clave, p_tipo: tipo, p_texto: t, p_adjunto: adjunto, p_cita: cita } };
        st.pendientes.set(clave, p);
        alFinal(true);
        // La primera vez (cliente sin conversación) el servidor la crea; los envíos siguientes ya llevan su id
        if (!st.conv && [...st.pendientes.values()].some(x => x !== p && x.estado === 'enviando')) {
            const esperar = setInterval(() => { if (st.conv || ![...st.pendientes.values()].some(x => x !== p && x.estado === 'enviando')) { clearInterval(esperar); p.args.p_conversacion = st.conv; despachar(p); } }, 200);
        } else despachar(p);
    }
    lista.addEventListener('click', e => {
        const r = e.target.closest('[data-reintentar]');
        if (r) { const p = st.pendientes.get(r.dataset.reintentar); if (p) { p.args.p_conversacion ??= st.conv; despachar(p); } return; }
        const d = e.target.closest('[data-descartar]');
        if (d) { const p = st.pendientes.get(d.dataset.descartar); if (p) { p.nodo.remove(); limpiarPendiente(d.dataset.descartar); if (!lista.children.length) vacio(); } return; }
        const foto = e.target.closest('[data-ver-foto]');
        if (foto) { const li = foto.closest('li'); return abrirVisor(li._m, foto); }
        const cambio = e.target.closest('[data-solicitar-cambio]');
        if (cambio) return opciones.alSolicitarCambio?.({ token: cambio.dataset.solicitarCambio, modificable: Boolean(cambio.dataset.modificable) }, api);
        const agenda = e.target.closest('[data-ver-agenda]');
        if (agenda) return opciones.alVerCita?.({ id: agenda.dataset.verAgenda, fecha: agenda.dataset.fecha });
        const play = e.target.closest('.chat-audio-play');
        if (play) return alternarAudio(play.closest('.chat-audio'));
        const vel = e.target.closest('.chat-audio-vel');
        if (vel) return cambiarVelocidad(vel);
    });
    lista.addEventListener('input', e => {
        if (!e.target.matches('.chat-audio-barra')) return;
        const caja = e.target.closest('.chat-audio');
        if (actual?.caja === caja && reproductor.duration) reproductor.currentTime = (e.target.value / 1000) * reproductor.duration;
    });

    // Texto
    const ajustarAltura = () => { texto.style.height = 'auto'; texto.style.height = `${Math.min(texto.scrollHeight, 140)}px`; };
    const alternarBotones = () => { const hay = Boolean(texto.value.trim()); botonEnviar.hidden = !hay; botonMic.hidden = hay; };
    texto.addEventListener('input', () => { ajustarAltura(); alternarBotones(); errorPie.hidden = true; });
    const tactil = window.matchMedia?.('(pointer: coarse)').matches;
    texto.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !tactil && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', e => {
        e.preventDefault();
        const t = texto.value.trim();
        if (!t) return;
        if (t.length > 2000) { mostrarError('El mensaje admite hasta 2000 caracteres.'); return; }
        texto.value = '';
        ajustarAltura();
        alternarBotones();
        encolar('texto', { texto: t });
        texto.focus({ preventScroll: true });
    });
    function mostrarError(t) { errorPie.textContent = t; errorPie.hidden = false; }

    // ---------- Fotos ----------
    const menu = $('.chat-menu');
    const botonAdjuntar = $('[data-adjuntar]');
    const cerrarMenu = () => { menu.hidden = true; botonAdjuntar.setAttribute('aria-expanded', 'false'); };
    botonAdjuntar.addEventListener('click', () => {
        const abrir = menu.hidden;
        menu.hidden = !abrir;
        botonAdjuntar.setAttribute('aria-expanded', String(abrir));
        if (abrir) menu.querySelector('button').focus();
    });
    menu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); cerrarMenu(); botonAdjuntar.focus(); } });
    const fueraDelMenu = e => { if (!e.target.closest?.('.chat-adjuntar')) cerrarMenu(); };
    document.addEventListener('click', fueraDelMenu);
    let referenciaInicial = false;
    menu.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        cerrarMenu();
        $(b.matches('[data-camara]') ? '[data-input-camara]' : '[data-input-galeria]').click();
    });
    for (const input of raiz.querySelectorAll('input[type=file]')) {
        input.addEventListener('change', async () => {
            const archivo = input.files?.[0];
            input.value = '';
            if (archivo) await previsualizarFoto(archivo);
        });
    }
    function seleccionarFoto({ referencia = false } = {}) {
        referenciaInicial = referencia;
        menu.hidden = false;
        botonAdjuntar.setAttribute('aria-expanded', 'true');
        menu.querySelector('button').focus();
    }

    function dialogo(clase, html) {
        const d = document.createElement('dialog');
        d.className = `chat-dialogo ${clase}`;
        d.innerHTML = html;
        document.body.append(d);
        d.addEventListener('close', () => d.remove());
        d.addEventListener('click', e => { if (e.target === d) d.close(); });
        d.showModal();
        return d;
    }

    async function previsualizarFoto(archivo) {
        let foto;
        const d = dialogo('chat-previa', `<form method="dialog" class="chat-previa-cuerpo">
            <h2 class="chat-dialogo-titulo">Enviar foto</h2>
            <div class="chat-previa-imagen"><p class="chat-cargando-texto">Preparando la foto…</p></div>
            <label class="chat-campo">Comentario (opcional)<input type="text" name="leyenda" maxlength="500" placeholder="Ej.: así lo quiero, más corto a los lados"></label>
            ${rolVista === 'cliente' ? `<fieldset class="chat-referencia-campo"><label class="chat-check"><input type="checkbox" name="referencia"> <span><strong>Referencia para mi corte</strong><small>Tu barbero la verá en el detalle de tu cita.</small></span></label>
                <label class="chat-campo" data-cita-campo hidden>Cita<select name="cita"></select></label><p class="chat-nota" data-sin-citas hidden>Necesitas una cita próxima para usarla como referencia. Puedes enviarla igualmente.</p></fieldset>` : ''}
            <p class="chat-error-pie" role="alert" hidden></p>
            <div class="chat-dialogo-acciones"><button type="button" class="chat-cita-boton secundario" data-cancelar>Cancelar</button>
                <button type="submit" class="chat-cita-boton" data-enviar disabled>Enviar foto</button></div></form>`);
        const enviar = d.querySelector('[data-enviar]');
        d.querySelector('[data-cancelar]').addEventListener('click', () => d.close());
        const check = d.querySelector('[name=referencia]');
        if (check) {
            const campo = d.querySelector('[data-cita-campo]');
            const select = d.querySelector('[name=cita]');
            let citas = [];
            try { citas = (await opciones.citasProximas?.()) || []; } catch { citas = []; }
            if (!d.open) return;
            select.innerHTML = citas.map(c => `<option value="${esc(c.token)}">${esc(c.etiqueta)}</option>`).join('');
            if (!citas.length) { check.disabled = true; d.querySelector('[data-sin-citas]').hidden = false; }
            check.checked = referenciaInicial && citas.length > 0;
            campo.hidden = !check.checked;
            check.addEventListener('change', () => { campo.hidden = !check.checked; });
        }
        referenciaInicial = false;
        try {
            foto = await prepararFoto(archivo);
        } catch (e) {
            const err = d.querySelector('.chat-error-pie');
            err.textContent = e.message;
            err.hidden = false;
            d.querySelector('.chat-previa-imagen').innerHTML = '';
            return;
        }
        if (!d.open) return;
        d.querySelector('.chat-previa-imagen').innerHTML = `<img src="${foto.datos}" alt="Vista previa de la foto">`;
        enviar.disabled = false;
        enviar.focus();
        d.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const leyenda = d.querySelector('[name=leyenda]').value.trim() || null;
            const cita = check?.checked ? d.querySelector('[name=cita]').value : null;
            const etiqueta = check?.checked ? d.querySelector('[name=cita]').selectedOptions[0]?.textContent : null;
            d.close();
            encolar('foto', { texto: leyenda, adjunto: foto, cita,
                local: { vista: foto.miniatura, referencia: cita ? { disponible: true, ...(opciones.citaPorToken?.(cita) || {}), etiqueta } : null } });
        });
    }

    // Visor: foto completa (se pide al servidor, que comprueba el permiso)
    const cacheFotos = new Map();
    async function abrirVisor(m, origen) {
        const a = m.adjunto;
        const esPropiaCliente = rolVista === 'cliente' && m.propio && a?.id;
        const d = dialogo('chat-visor', `<div class="chat-visor-cuerpo">
            <button type="button" class="chat-btn-icono chat-visor-cerrar" aria-label="Cerrar"><i class="fas fa-times" aria-hidden="true"></i></button>
            <div class="chat-visor-imagen"><img alt="${esc(m.texto || 'Foto enviada en la conversación')}" src="${esc(m.local?.vista || a?.miniatura || '')}"><span class="chat-visor-cargando">Cargando…</span></div>
            ${m.texto ? `<p class="chat-visor-texto">${esc(m.texto)}</p>` : ''}
            ${esPropiaCliente ? '<div class="chat-visor-ref"></div>' : ''}</div>`);
        d.addEventListener('close', () => origen?.focus?.({ preventScroll: true }));
        d.querySelector('.chat-visor-cerrar').addEventListener('click', () => d.close());
        d.querySelector('.chat-visor-cerrar').focus();
        const img = d.querySelector('img');
        const marca = d.querySelector('.chat-visor-cargando');
        if (a?.id) {
            try {
                let url = cacheFotos.get(a.id);
                if (!url) {
                    const r = await rpc('chat_adjunto', { p_id: a.id, p_variante: 'completa' });
                    url = await dataURLaObjeto(r.datos);
                    cacheFotos.set(a.id, url);
                    st.objetos.add(url);
                }
                if (d.open) img.src = url;
                marca.remove();
            } catch (e) { marca.textContent = esNoAutorizado(e) ? 'No tienes acceso a esta foto.' : 'No se pudo cargar la foto completa.'; }
        } else marca.remove();
        if (esPropiaCliente) pintarReferenciaVisor(d.querySelector('.chat-visor-ref'), m);
    }
    async function pintarReferenciaVisor(caja, m) {
        const ref = m.adjunto.referencia;
        if (ref?.disponible) {
            caja.innerHTML = `${lineaReferencia(ref)}<button type="button" class="chat-cita-boton secundario" data-quitar-ref>Quitar referencia</button>`;
        } else {
            let citas = [];
            try { citas = (await opciones.citasProximas?.()) || []; } catch { /* sin citas */ }
            if (!citas.length) { caja.innerHTML = '<p class="chat-nota">Cuando tengas una cita próxima podrás usar esta foto como referencia para tu corte.</p>'; return; }
            caja.innerHTML = `<label class="chat-campo">Usar como referencia para<select>${citas.map(c => `<option value="${esc(c.token)}">${esc(c.etiqueta)}</option>`).join('')}</select></label>
                <button type="button" class="chat-cita-boton" data-poner-ref>Referencia para mi corte</button>`;
        }
        caja.onclick = async e => {
            const b = e.target.closest('[data-quitar-ref], [data-poner-ref]');
            if (!b) return;
            b.disabled = true;
            try {
                const r = await rpc('chat_referencia', { p_adjunto: m.adjunto.id, p_cita: b.matches('[data-poner-ref]') ? caja.querySelector('select').value : null });
                actualizarTarjetas([{ id: m.id, cita: m.cita, referencia: r.referencia }]);
                pintarReferenciaVisor(caja, m);
            } catch (err) {
                b.disabled = false;
                caja.insertAdjacentHTML('beforeend', `<p class="chat-error-pie" role="alert">${esc(mensajeChat(err))}</p>`);
            }
        };
    }

    // ---------- Notas de voz ----------
    let grabacion = null;
    let revision = null;      // { blob, duracion_ms, tipo, url }
    const zonaGrabacion = $('.chat-grabacion');
    const zonaRevision = $('.chat-revision');
    function modo(nombre) {
        form.hidden = nombre !== 'texto';
        zonaGrabacion.hidden = nombre !== 'grabando';
        zonaRevision.hidden = nombre !== 'revision';
    }
    botonMic.addEventListener('click', async () => {
        errorPie.hidden = true;
        if (!comp.grabar) { mostrarError(MENSAJES_MICROFONO[comp.motivo]); return; }
        botonMic.disabled = true;
        try {
            grabacion = await iniciarGrabacion({
                alTick: ms => { zonaGrabacion.querySelector('[data-tiempo]').textContent = mmss(ms); },
                alLimite: () => detenerGrabacion()
            });
            modo('grabando');
            zonaGrabacion.querySelector('[data-estado-grabacion]').textContent = 'Grabando nota de voz';
            zonaGrabacion.querySelector('[data-detener]').focus();
        } catch (e) { mostrarError(e.message); }
        finally { botonMic.disabled = false; }
    });
    async function detenerGrabacion() {
        if (!grabacion) return;
        const g = grabacion;
        grabacion = null;
        try {
            const r = await g.detener();
            revision = { ...r, url: URL.createObjectURL(r.blob) };
            st.objetos.add(revision.url);
            const caja = zonaRevision.querySelector('.chat-revision-audio');
            caja.innerHTML = `<div class="chat-audio" data-local="1" data-duracion="${r.duracion_ms}">
                <button type="button" class="chat-audio-play" aria-label="Escuchar antes de enviar"><i class="fas fa-play" aria-hidden="true"></i></button>
                <input type="range" class="chat-audio-barra" min="0" max="1000" value="0" aria-label="Posición">
                <span class="chat-audio-tiempo">${mmss(r.duracion_ms)}</span>
                <button type="button" class="chat-audio-vel" aria-label="Velocidad de reproducción: 1×">1×</button></div>`;
            caja.onclick = e => {
                if (e.target.closest('.chat-audio-play')) alternarAudio(caja.querySelector('.chat-audio'), revision.url);
                if (e.target.closest('.chat-audio-vel')) cambiarVelocidad(e.target.closest('.chat-audio-vel'));
            };
            caja.oninput = e => { if (e.target.matches('.chat-audio-barra') && actual?.caja?.dataset.local && reproductor.duration) reproductor.currentTime = (e.target.value / 1000) * reproductor.duration; };
            modo('revision');
            zonaRevision.querySelector('[data-enviar-audio]').focus();
        } catch (e) {
            modo('texto');
            mostrarError(e.message);
        }
    }
    zonaGrabacion.querySelector('[data-detener]').addEventListener('click', detenerGrabacion);
    raiz.querySelectorAll('[data-descartar-audio]').forEach(b => b.addEventListener('click', () => {
        grabacion?.cancelar();
        grabacion = null;
        if (actual?.caja?.dataset.local) pararAudio();
        if (revision) { URL.revokeObjectURL(revision.url); st.objetos.delete(revision.url); revision = null; }
        modo('texto');
        botonMic.focus();
    }));
    zonaRevision.querySelector('[data-enviar-audio]').addEventListener('click', async () => {
        if (!revision) return;
        const r = revision;
        revision = null;
        if (actual?.caja?.dataset.local) pararAudio();
        modo('texto');
        const datos = await audioADataURL(r.blob, r.tipo);
        encolar('audio', { adjunto: { datos, duracion_ms: r.duracion_ms }, local: { objeto: r.url, duracion_ms: r.duracion_ms } });
        botonMic.focus();
    });

    // Reproducción: un solo reproductor; tocar otra nota pausa la anterior
    const VELOCIDADES = [1, 1.5, 2];
    let velocidad = 1;
    function pintarAudio(caja, sonando) {
        if (!caja) return;
        const b = caja.querySelector('.chat-audio-play');
        b.innerHTML = `<i class="fas fa-${sonando ? 'pause' : 'play'}" aria-hidden="true"></i>`;
        b.setAttribute('aria-label', sonando ? 'Pausar nota de voz' : 'Reproducir nota de voz');
        caja.classList.toggle('sonando', sonando);
    }
    function pararAudio() { reproductor.pause(); pintarAudio(actual?.caja, false); actual = null; }
    async function fuenteAudio(caja, local) {
        if (local) return local;
        const li = caja.closest('li');
        const m = li?._m;
        if (m?.local?.objeto) return m.local.objeto;
        const id = caja.dataset.audio;
        if (st.audios.has(id)) return st.audios.get(id);
        const r = await rpc('chat_adjunto', { p_id: id, p_variante: 'completa' });
        const url = await dataURLaObjeto(r.datos);
        st.audios.set(id, url);
        st.objetos.add(url);
        return url;
    }
    async function alternarAudio(caja, local = null) {
        if (actual?.caja === caja) {
            if (reproductor.paused) { await reproductor.play().catch(() => {}); pintarAudio(caja, !reproductor.paused); }
            else { reproductor.pause(); pintarAudio(caja, false); }
            return;
        }
        pararAudio();
        actual = { caja };
        caja.classList.add('cargando');
        try {
            const url = await fuenteAudio(caja, local);
            if (actual?.caja !== caja) return;
            reproductor.src = url;
            reproductor.playbackRate = velocidad;
            await reproductor.play();
            pintarAudio(caja, true);
        } catch (e) {
            caja.querySelector('.chat-audio-tiempo').textContent = esNoAutorizado(e) ? 'Sin acceso' : 'No se puede reproducir';
            caja.classList.add('con-error');
            actual = null;
        } finally { caja.classList.remove('cargando'); }
    }
    function cambiarVelocidad(b) {
        velocidad = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
        reproductor.playbackRate = velocidad;
        const texto_ = `${String(velocidad).replace('.', ',')}×`;
        raiz.querySelectorAll('.chat-audio-vel').forEach(x => { x.textContent = texto_; x.setAttribute('aria-label', `Velocidad de reproducción: ${texto_}`); });
        b.focus();
    }
    reproductor.addEventListener('timeupdate', () => {
        if (!actual?.caja) return;
        const d = reproductor.duration && Number.isFinite(reproductor.duration) ? reproductor.duration : Number(actual.caja.dataset.duracion) / 1000;
        actual.caja.querySelector('.chat-audio-barra').value = d ? Math.round((reproductor.currentTime / d) * 1000) : 0;
        actual.caja.querySelector('.chat-audio-tiempo').textContent = mmss(reproductor.currentTime * 1000);
    });
    reproductor.addEventListener('ended', () => {
        if (!actual?.caja) return;
        const caja = actual.caja;
        pintarAudio(caja, false);
        caja.querySelector('.chat-audio-barra').value = 0;
        caja.querySelector('.chat-audio-tiempo').textContent = mmss(Number(caja.dataset.duracion));
        actual = null;
    });
    reproductor.addEventListener('error', () => {
        if (!actual?.caja) return;
        actual.caja.querySelector('.chat-audio-tiempo').textContent = 'Formato no compatible con este dispositivo';
        actual.caja.classList.add('con-error');
        pintarAudio(actual.caja, false);
        actual = null;
    });

    // ---------- API pública ----------
    const api = {
        get conversacion() { return st.conv; },
        get rol() { return st.rol; },
        cabecera, chips,
        insertarTexto(t) { texto.value = t; ajustarAltura(); alternarBotones(); texto.focus(); texto.setSelectionRange(t.length, t.length); },
        enviarCita(ref, { texto: t = null, cita = null } = {}) { encolar('cita', { texto: t, cita: ref, local: { cita } }); },
        enviarSolicitudCambio(ref, t, cita = null) { encolar('solicitud_cambio', { texto: t, cita: ref, local: { cita } }); },
        seleccionarFoto,
        dialogo,
        enfocar() { texto.focus({ preventScroll: true }); },
        actualizar() { sondear(); },
        destruir() {
            st.activo = false;
            detenerSondeo();
            grabacion?.cancelar();
            reproductor.pause();
            reproductor.removeAttribute('src');
            document.removeEventListener('visibilitychange', alVisibilidad);
            document.removeEventListener('click', fueraDelMenu);
            window.removeEventListener('online', alRed);
            window.removeEventListener('offline', alRed);
            for (const url of st.objetos) URL.revokeObjectURL(url);
            st.objetos.clear();
        }
    };
    cargarInicio();
    return api;
}
