// ==========================================
// PANEL: CONVERSACIONES (bandeja de la administración y «Mis conversaciones» del barbero)
// PC: bandeja a la izquierda y conversación a la derecha. Móvil: bandeja o conversación a pantalla completa.
// La administración ve todas, filtra, busca por cliente y asigna; el barbero solo ve las asignadas a él
// (el servidor lo comprueba en cada consulta: al reasignar pierde el acceso al instante).
// ==========================================

import { api, esc, dialogo, vacio, fechaCorta } from './comun.js';
import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';
import { crearChat, mensajeChat, seguirTeclado } from '../../assets/chat/chat-conversacion.js';
import { fechaLarga, formato12h } from '../../assets/horario-utils.js';

const INTERVALO_BANDEJA = 10000;
const FILTROS = { admin: [['todas', 'Todas'], ['sin_responder', 'Sin responder'], ['asignadas', 'Asignadas'], ['sin_asignar', 'Sin asignar']],
    barbero: [['todas', 'Todas'], ['sin_responder', 'Sin responder']] };
const fmtHora = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', hour: 'numeric', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit' });
function cuando(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return fmtDia.format(d) === fmtDia.format(new Date()) ? fmtHora.format(d) : fechaCorta(fmtDia.format(d));
}
const inicial = n => (String(n || '?').trim()[0] || '?').toUpperCase();

// Contador del menú: conversaciones con mensajes del cliente sin leer
export async function contarConversaciones(contenedor) {
    let n = 0;
    try { n = await api('panel_chat_no_leidos'); } catch { return; }
    const boton = contenedor.querySelector('[data-seccion="conversaciones"]');
    if (!boton) return;
    boton.querySelector('.panel-aviso-numero')?.remove();
    if (n > 0) boton.insertAdjacentHTML('beforeend', `<span class="panel-aviso-numero" aria-label="${n} con mensajes sin leer">${n > 99 ? '99+' : n}</span>`);
}

export async function renderConversaciones(cont, ctx, opciones = {}) {
    const admin = ctx.rol === 'admin';
    const st = { filtro: 'todas', buscar: '', items: [], abierta: null, chat: null, temporizador: null, turno: 0, respuestas: [], info: null };
    cont.innerHTML = `
        <div class="conv" data-vista="lista">
            <aside class="conv-bandeja" aria-label="Bandeja de conversaciones">
                <div class="conv-bandeja-cab">
                    <div><h2>${admin ? 'Conversaciones' : 'Mis conversaciones'}</h2>
                        <p class="panel-sub">${admin ? 'Responde y asigna cada chat al barbero adecuado.' : 'Chats que la administración te asignó.'}</p></div>
                    ${admin ? '<button type="button" class="panel-btn panel-btn-mini" data-respuestas><i class="fas fa-bolt" aria-hidden="true"></i> Respuestas rápidas</button>' : ''}
                </div>
                <label class="conv-buscar"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Buscar por cliente</span>
                    <input type="search" placeholder="Buscar por cliente${admin ? ' o correo' : ''}…" data-buscar autocomplete="off"></label>
                <div class="conv-filtros" role="group" aria-label="Filtrar conversaciones">${FILTROS[admin ? 'admin' : 'barbero'].map(([id, t]) =>
                    `<button type="button" class="conv-filtro" data-filtro="${id}" aria-pressed="${id === 'todas'}">${t}</button>`).join('')}</div>
                <div class="conv-lista-caja" aria-live="polite"><p class="panel-cargando">Cargando conversaciones…</p></div>
            </aside>
            <section class="conv-chat" aria-label="Conversación"><div class="conv-chat-vacio">${vacio('Elige una conversación de la bandeja para leerla y responder.', 'comments')}</div></section>
        </div>`;
    const raiz = cont.querySelector('.conv');
    const listaCaja = cont.querySelector('.conv-lista-caja');
    const zonaChat = cont.querySelector('.conv-chat');
    const vivo = () => raiz.isConnected;

    // ---------- Bandeja ----------
    function itemHTML(i) {
        const activa = i.id === st.abierta;
        const noLeidos = Number(i.no_leidos || 0);
        return `<li><button type="button" class="conv-item${activa ? ' activa' : ''}${noLeidos ? ' no-leida' : ''}" data-conv="${esc(i.id)}" ${activa ? 'aria-current="true"' : ''}>
            <span class="conv-avatar" aria-hidden="true">${esc(inicial(i.cliente))}</span>
            <span class="conv-item-texto">
                <span class="conv-item-fila"><strong>${esc(i.cliente)}</strong><time>${esc(cuando(i.ultimo_en))}</time></span>
                <span class="conv-item-fila"><span class="conv-vista">${i.ultimo_autor === 'equipo' ? '<i class="fas fa-reply" aria-label="Respondido"></i> ' : ''}${esc(i.vista_previa || '')}</span>
                    ${noLeidos ? `<span class="conv-numero" aria-label="${noLeidos} sin leer">${noLeidos > 99 ? '99+' : noLeidos}</span>` : ''}</span>
                <span class="conv-etiquetas">
                    ${i.ultimo_autor === 'cliente' ? '<span class="conv-etiqueta pendiente">Sin responder</span>' : ''}
                    ${admin ? (i.barbero ? `<span class="conv-etiqueta"><i class="fas fa-user-check" aria-hidden="true"></i> ${esc(i.barbero)}</span>` : '<span class="conv-etiqueta tenue">Sin asignar</span>') : ''}
                    ${i.proxima_cita ? `<span class="conv-etiqueta tenue"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${esc(fechaCorta(i.proxima_cita.fecha))} ${esc(formato12h(i.proxima_cita.hora))}</span>` : ''}
                </span>
            </span></button></li>`;
    }
    function pintarLista() {
        if (!st.items.length) {
            listaCaja.innerHTML = vacio(st.buscar ? 'No hay conversaciones que coincidan con la búsqueda.'
                : st.filtro === 'sin_responder' ? 'No hay conversaciones esperando respuesta.'
                : admin ? 'Aún no hay conversaciones. Aparecerán cuando un cliente escriba desde «Mis citas».' : 'No tienes conversaciones asignadas.', 'comments');
            return;
        }
        listaCaja.innerHTML = `<ul class="conv-lista">${st.items.map(itemHTML).join('')}</ul>`;
    }
    async function cargarBandeja({ silencioso = false } = {}) {
        const miTurno = ++st.turno;
        if (!silencioso) listaCaja.innerHTML = '<p class="panel-cargando">Cargando conversaciones…</p>';
        try {
            const r = await api('panel_chat_bandeja', { p_filtro: st.filtro, p_buscar: st.buscar || null, p_limite: 50, p_antes: null });
            if (miTurno !== st.turno || !vivo()) return;
            st.items = r.items;
            pintarLista();
        } catch (e) {
            if (miTurno !== st.turno || !vivo()) return;
            if (!silencioso || !st.items.length) listaCaja.innerHTML = `<p class="panel-error">${esc(e.message)}</p><button type="button" class="panel-btn" data-recargar>Reintentar</button>`;
        }
        contarConversaciones(document);
    }
    function programar() {
        clearTimeout(st.temporizador);
        if (!vivo()) return;
        st.temporizador = setTimeout(async () => {
            if (!vivo()) return;
            if (document.visibilityState === 'visible') await cargarBandeja({ silencioso: true });
            programar();
        }, INTERVALO_BANDEJA);
    }

    listaCaja.addEventListener('click', e => {
        if (e.target.closest('[data-recargar]')) return cargarBandeja();
        const b = e.target.closest('[data-conv]');
        if (b) abrir(b.dataset.conv);
    });
    cont.querySelector('.conv-filtros').addEventListener('click', e => {
        const b = e.target.closest('[data-filtro]');
        if (!b) return;
        st.filtro = b.dataset.filtro;
        cont.querySelectorAll('[data-filtro]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        cargarBandeja();
    });
    let espera = null;
    cont.querySelector('[data-buscar]').addEventListener('input', e => {
        clearTimeout(espera);
        espera = setTimeout(() => { st.buscar = e.target.value.trim(); cargarBandeja(); }, 300);
    });
    cont.querySelector('[data-respuestas]')?.addEventListener('click', () => editarRespuestas());

    // ---------- Conversación ----------
    async function cargarRespuestas() {
        try { st.respuestas = await api('panel_chat_respuestas'); } catch { st.respuestas = []; }
    }
    function chipsChat() {
        return [
            { etiqueta: 'Compartir cita', icono: 'calendar-plus', accion: c => compartirCita(c) },
            ...st.respuestas.map(r => ({ etiqueta: r.texto.length > 46 ? `${r.texto.slice(0, 44)}…` : r.texto, accion: c => c.insertarTexto(r.texto) }))
        ];
    }
    function cabeceraExtra(info) {
        const caja = document.createElement('div');
        caja.className = 'conv-asignacion';
        if (admin) {
            caja.innerHTML = `<label><span>Asignada a</span><select data-asignar aria-label="Asignar conversación">
                <option value="">Sin asignar</option>${(info.barberos || []).map(b => `<option value="${esc(b.id)}" ${b.id === info.barbero_id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select></label>`;
            caja.querySelector('[data-asignar]').addEventListener('change', async e => {
                const sel = e.currentTarget;
                sel.disabled = true;
                try {
                    const r = await api('panel_chat_asignar', { p_conversacion: info.id, p_barbero: sel.value || null });
                    info.barbero_id = r.barbero_id;
                    ctx.notificar(r.barbero ? `Conversación asignada a ${r.barbero}.` : 'La conversación quedó sin asignar.', 'success');
                    st.chat?.actualizar();
                    cargarBandeja({ silencioso: true });
                } catch (err) {
                    sel.value = info.barbero_id || '';
                    ctx.notificar(err.message, 'error');
                } finally { sel.disabled = false; }
            });
        } else {
            caja.innerHTML = '<span class="conv-etiqueta"><i class="fas fa-user-check" aria-hidden="true"></i> Asignada a ti</span>';
        }
        return caja;
    }
    async function abrir(id) {
        st.chat?.destruir();
        st.chat = null;
        st.soltarTeclado?.();
        st.soltarTeclado = seguirTeclado(raiz);
        st.abierta = id;
        st.info = null;
        raiz.dataset.vista = 'chat';
        pintarLista();
        zonaChat.innerHTML = '<div class="conv-chat-caja"></div>';
        const caja = zonaChat.querySelector('.conv-chat-caja');
        const item = st.items.find(i => i.id === id);
        st.chat = crearChat(caja, {
            cliente: obtenerClienteAdmin(),
            rolVista: 'personal',
            conversacion: id,
            cabecera: { titulo: item?.cliente || 'Cliente', subtitulo: item?.correo || '' },
            alVolver: true,
            textoVacio: 'Sin mensajes todavía.',
            textoSinAcceso: 'Esta conversación ya no está asignada a ti.',
            chips: chipsChat(),
            alVerCita: c => ctx.irA('agenda', { fecha: c.fecha, vista: 'dia', abrirCita: String(c.id) }),
            alNoLeidos: () => { cargarBandeja({ silencioso: true }); },
            alPerderAcceso: () => { ctx.notificar('La conversación se asignó a otro profesional.', 'aviso'); cargarBandeja({ silencioso: true }); }
        });
        caja.querySelector('[data-volver]').addEventListener('click', volverABandeja);
        try {
            const info = await api('panel_chat_conversacion', { p_conversacion: id });
            if (st.abierta !== id || !st.chat) return;
            st.info = info;
            const proxima = info.citas[0];
            st.chat.cabecera({ titulo: info.cliente,
                subtitulo: [info.correo, proxima ? `Próxima cita: ${fechaCorta(proxima.fecha)} ${formato12h(proxima.hora)}` : null].filter(Boolean).join(' · '),
                extra: cabeceraExtra(info) });
        } catch { /* la vista del chat ya muestra la falta de acceso */ }
        // Foco al campo de texto en PC; en el móvil se evita abrir el teclado sin pedirlo
        if (window.matchMedia('(min-width: 900px)').matches) st.chat?.enfocar();
    }
    function volverABandeja() {
        st.chat?.destruir();
        st.chat = null;
        st.soltarTeclado?.();
        st.soltarTeclado = null;
        st.abierta = null;
        raiz.dataset.vista = 'lista';
        zonaChat.innerHTML = `<div class="conv-chat-vacio">${vacio('Elige una conversación de la bandeja para leerla y responder.', 'comments')}</div>`;
        pintarLista();
        cargarBandeja({ silencioso: true });
        listaCaja.querySelector('.conv-item')?.focus();
    }

    function compartirCita(c) {
        const citas = st.info?.citas || [];
        const d = c.dialogo('chat-selector', `<div class="chat-previa-cuerpo">
            <h2 class="chat-dialogo-titulo">Compartir una cita del cliente</h2>
            ${citas.length ? `<ul class="chat-opciones">${citas.map(x => `<li class="chat-opcion">
                <div><strong>${esc(x.servicio || 'Servicio')}</strong><span>${esc(fechaLarga(x.fecha))} · ${esc(formato12h(x.hora))} · ${esc(x.barbero || '')}</span></div>
                <div class="chat-opcion-acciones"><button type="button" class="chat-cita-boton" data-compartir="${esc(x.id)}">Compartir</button></div></li>`).join('')}</ul>`
                : '<p class="chat-nota">Este cliente no tiene citas próximas en su cuenta.</p>'}
            <div class="chat-dialogo-acciones"><button type="button" class="chat-cita-boton secundario" data-cerrar>Cerrar</button></div></div>`);
        d.querySelector('[data-cerrar]').addEventListener('click', () => d.close());
        d.addEventListener('click', e => {
            const b = e.target.closest('[data-compartir]');
            if (!b) return;
            d.close();
            c.enviarCita(b.dataset.compartir);
        });
    }

    // ---------- Respuestas rápidas (administración) ----------
    async function editarRespuestas() {
        await cargarRespuestas();
        const filas = r => `<li class="conv-respuesta"><textarea rows="2" maxlength="500" aria-label="Respuesta rápida">${esc(r)}</textarea>
            <button type="button" class="panel-icono" data-quitar aria-label="Quitar respuesta"><i class="fas fa-trash" aria-hidden="true"></i></button></li>`;
        const { cuerpo, cerrar } = dialogo({ titulo: 'Respuestas rápidas', ancho: 'md', html: `
            <p class="panel-sub">El equipo las inserta en el chat con un toque y puede editarlas antes de enviar. Hasta 20.</p>
            <ol class="conv-respuestas">${st.respuestas.map(r => filas(r.texto)).join('')}</ol>
            <button type="button" class="panel-btn" data-agregar><i class="fas fa-plus" aria-hidden="true"></i> Añadir respuesta</button>
            <p class="panel-error" role="alert" hidden></p>
            <div class="panel-dialogo-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="button" class="panel-btn panel-btn-principal" data-guardar>Guardar</button></div>` });
        const listaR = cuerpo.querySelector('.conv-respuestas');
        cuerpo.addEventListener('click', async e => {
            if (e.target.closest('[data-quitar]')) e.target.closest('li').remove();
            if (e.target.closest('[data-agregar]')) {
                if (listaR.children.length >= 20) return;
                listaR.insertAdjacentHTML('beforeend', filas(''));
                listaR.lastElementChild.querySelector('textarea').focus();
            }
            const guardar = e.target.closest('[data-guardar]');
            if (guardar) {
                guardar.disabled = true;
                try {
                    st.respuestas = await api('panel_chat_respuestas_guardar', { p_textos: [...listaR.querySelectorAll('textarea')].map(t => t.value) });
                    st.chat?.chips(chipsChat());
                    ctx.notificar('Respuestas rápidas guardadas.');
                    cerrar();
                } catch (err) {
                    const error = cuerpo.querySelector('.panel-error');
                    error.textContent = /respuestas_invalidas/.test(err.message) ? 'Máximo 20 respuestas de hasta 500 caracteres.' : err.message;
                    error.hidden = false;
                    guardar.disabled = false;
                }
            }
        });
    }

    await cargarRespuestas();
    await cargarBandeja();
    programar();
    if (opciones.conversacion) abrir(String(opciones.conversacion));
}

// Fotos de referencia del chat en el detalle de una cita (mismos permisos que la cita)
export async function pintarReferenciasChat(caja, citaId) {
    if (!caja) return;
    let fotos = [];
    try { fotos = await api('panel_cita_chat_referencias', { p_cita: String(citaId) }); } catch { caja.hidden = true; return; }
    if (!fotos.length || !caja.isConnected) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.innerHTML = `<p class="inspiracion-eyebrow">Fotos de referencia del cliente</p>
        <div class="conv-refs">${fotos.map(f => `<button type="button" class="conv-ref" data-ref="${esc(f.id)}" aria-label="Ver foto de referencia${f.texto ? `: ${esc(f.texto)}` : ''}">
            ${f.miniatura ? `<img src="${esc(f.miniatura)}" alt="">` : ''}</button>`).join('')}</div>`;
    caja.addEventListener('click', async e => {
        const b = e.target.closest('[data-ref]');
        if (!b) return;
        const f = fotos.find(x => x.id === b.dataset.ref);
        const d = document.createElement('dialog');
        d.className = 'chat-dialogo chat-visor';
        d.innerHTML = `<div class="chat-visor-cuerpo"><button type="button" class="chat-btn-icono chat-visor-cerrar" aria-label="Cerrar"><i class="fas fa-times" aria-hidden="true"></i></button>
            <div class="chat-visor-imagen"><img alt="Foto de referencia del cliente" src="${esc(f.miniatura || '')}"><span class="chat-visor-cargando">Cargando…</span></div>
            ${f.texto ? `<p class="chat-visor-texto">${esc(f.texto)}</p>` : ''}</div>`;
        document.body.append(d);
        d.addEventListener('close', () => { d.remove(); b.focus(); });
        d.addEventListener('click', ev => { if (ev.target === d || ev.target.closest('.chat-visor-cerrar')) d.close(); });
        d.showModal();
        try {
            const r = await api('chat_adjunto', { p_id: f.id, p_variante: 'completa' });
            d.querySelector('img').src = r.datos;
            d.querySelector('.chat-visor-cargando').remove();
        } catch (err) { d.querySelector('.chat-visor-cargando').textContent = mensajeChat(err); }
    });
}

