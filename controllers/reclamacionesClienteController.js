// Reclamaciones del cliente: se abren desde una cita propia (con su token secreto) y se consultan con el
// token privado del caso. Nunca por teléfono ni por número de caso. Este navegador recuerda los tokens.
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { imagenADataURL } from './panel/comun.js';
import { escapar as esc } from '../assets/catalogue-ui.js';
import { fechaLarga, formato12h } from '../assets/horario-utils.js';
import { nuevaClave } from '../assets/mis-citas-store.js';

const CLAVE = 'barberia-mis-reclamaciones';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ESTADOS_RECLAMACION = { recibida: 'Recibida', en_revision: 'En revisión', esperando_cliente: 'Esperando tu respuesta', resuelta: 'Resuelta', cerrada: 'Cerrada' };
const MENSAJES = {
    cita_no_encontrada: 'No encontramos la cita de este enlace.',
    categoria_invalida: 'Elige una categoría.',
    descripcion_invalida: 'Describe lo ocurrido (entre 10 y 2000 caracteres).',
    limite_reclamaciones: 'Esta cita ya tiene reclamaciones abiertas. Puedes seguirlas en «Mis citas».',
    imagen_invalida: 'Una de las imágenes no es válida. Usa JPG, PNG o WebP.',
    adjuntos_invalidos: 'Puedes adjuntar hasta 3 imágenes.',
    respuesta_no_solicitada: 'La barbería no está esperando una respuesta en este momento.',
    reclamacion_no_encontrada: 'No encontramos esta reclamación.'
};

function mensajeError(error) {
    const texto = error?.message || String(error || '');
    const clave = Object.keys(MENSAJES).find(k => texto.includes(k));
    if (clave) return MENSAJES[clave];
    return /fetch|network|load failed/i.test(texto)
        ? 'Sin conexión: no se envió. Revisa la conexión e inténtalo de nuevo (no se duplicará).'
        : 'No se pudo completar. Inténtalo de nuevo.';
}

// ---------- Tokens en este navegador ----------
function leer() {
    try { const v = JSON.parse(localStorage.getItem(CLAVE) || '{}'); return Array.isArray(v.tokens) ? v.tokens.filter(t => UUID.test(t)) : []; } catch { return []; }
}
export function tokensReclamaciones() { return leer(); }
export function recordarReclamacion(token) {
    if (!UUID.test(String(token))) return;
    try { localStorage.setItem(CLAVE, JSON.stringify({ tokens: [token, ...leer().filter(t => t !== token)].slice(0, 50) })); } catch { /* sin almacenamiento */ }
}
export function olvidarReclamaciones() {
    try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}

async function imagenes(input) {
    const archivos = [...(input?.files || [])];
    if (archivos.length > 3) throw new Error('adjuntos_invalidos');
    if (archivos.some(a => a.size > 10 * 1024 * 1024)) throw new Error('Cada imagen debe pesar menos de 10 MB.');
    // Se reduce y se vuelve a codificar en el navegador: así también se eliminan sus metadatos (ubicación, cámara)
    return Promise.all(archivos.map(a => imagenADataURL(a, 1400)));
}

// ---------- Formulario ----------
export async function abrirFormularioReclamacion({ tokenCita, descripcionCita = '' }) {
    if (!estaSupabaseListo()) return;
    const d = document.createElement('dialog');
    d.className = 'detalle-corte reclamacion-dialogo';
    d.setAttribute('aria-labelledby', 'reclamacion-titulo');
    d.innerHTML = `<div class="detalle-barra"><span>REPORTAR UN INCONVENIENTE</span><button type="button" data-cerrar aria-label="Cerrar">Cerrar <span aria-hidden="true">&times;</span></button></div>
        <form class="reclamacion-form" novalidate>
            <h2 id="reclamacion-titulo">Cuéntanos qué pasó</h2>
            ${descripcionCita ? `<p class="reclamacion-sub">${esc(descripcionCita)}</p>` : ''}
            <label>Categoría<select name="categoria" required><option value="">Cargando…</option></select></label>
            <label>¿Qué ocurrió?<textarea name="descripcion" rows="5" maxlength="2000" required placeholder="Describe lo ocurrido con el mayor detalle posible"></textarea></label>
            <label>Imágenes (opcional, hasta 3)<input type="file" name="imagenes" accept="image/png,image/jpeg,image/webp" multiple></label>
            <p class="reclamacion-sub">Solo el equipo de la barbería verá tu reclamación. Registrarla no cancela tu cita ni genera cobros o reembolsos.</p>
            <p class="reclamacion-error" role="alert" hidden></p>
            <button type="submit" class="btn-primary">Enviar reclamación</button>
        </form>`;
    document.body.append(d);
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) d.close(); });
    d.addEventListener('close', () => d.remove());
    d.showModal();
    const form = d.querySelector('form');
    const error = form.querySelector('.reclamacion-error');
    const clave = nuevaClave(); // misma clave en los reintentos: no se crean dos casos
    try {
        const { data, error: e } = await supabase.rpc('reclamacion_categorias_publicas');
        if (e) throw e;
        form.elements.categoria.innerHTML = `<option value="">Elige una categoría</option>${data.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}`;
    } catch (e) { error.textContent = mensajeError(e); error.hidden = false; }
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const boton = form.querySelector('[type=submit]');
        if (boton.disabled) return;
        error.hidden = true;
        const descripcion = form.elements.descripcion.value.trim();
        if (!form.elements.categoria.value) { error.textContent = MENSAJES.categoria_invalida; error.hidden = false; return; }
        if (descripcion.length < 10) { error.textContent = MENSAJES.descripcion_invalida; error.hidden = false; return; }
        boton.disabled = true;
        boton.textContent = 'Enviando…';
        try {
            const adjuntos = await imagenes(form.elements.imagenes);
            const { data, error: fallo } = await supabase.rpc('reclamacion_crear', { p_datos: { clave, token_cita: tokenCita, categoria_id: Number(form.elements.categoria.value), descripcion, adjuntos } });
            if (fallo) throw fallo;
            recordarReclamacion(data.token);
            form.outerHTML = `<div class="reclamacion-form" role="status"><h2>Recibimos tu reclamación</h2>
                <p>Número de seguimiento: <strong class="reclamacion-codigo">${esc(data.codigo)}</strong></p>
                <p class="reclamacion-sub">Puedes seguirla en «Mis citas» o con tu enlace privado. Guárdalo: quien lo tenga puede ver el caso.</p>
                <a class="btn-primary" href="?reclamacion=${encodeURIComponent(data.token)}#contacto">Ver mi reclamación</a></div>`;
            window.dispatchEvent(new Event('reclamaciones-cambiaron'));
        } catch (fallo) {
            error.textContent = fallo?.message && !fallo.code && !/fetch/i.test(fallo.message) && !MENSAJES[fallo.message] ? fallo.message : mensajeError(fallo);
            error.hidden = false;
            boton.disabled = false;
            boton.textContent = 'Enviar reclamación';
        }
    });
}

// ---------- Página privada del caso (?reclamacion=token) ----------
export async function renderReclamacion(panel, token) {
    const { data: r, error } = await supabase.rpc('reclamacion_consultar', { p_token: token });
    if (error) {
        panel.innerHTML = `<div class="panel-gestion"><p class="resumen-alerta">${esc(mensajeError(error))}</p></div>`;
        return;
    }
    recordarReclamacion(token);
    panel.innerHTML = `<div class="panel-gestion reclamacion-caso">
        <div class="tracking-header"><h3>Reclamación ${esc(r.codigo)}</h3>
            <span class="badge-estado ${r.estado === 'resuelta' || r.estado === 'cerrada' ? 'badge-confirmada' : 'badge-pendiente'}">${esc(ESTADOS_RECLAMACION[r.estado] || r.estado)}</span></div>
        <div class="resumen-ticket"><div>${esc(r.categoria)}</div>
            ${r.cita ? `<div>Cita: ${esc(r.cita.servicio || '')} · ${esc(fechaLarga(r.cita.fecha))} · ${esc(formato12h(r.cita.hora))}</div>` : ''}
            <div>Enviada: ${esc(new Date(r.creado_en).toLocaleString('es-DO'))}</div></div>
        <p class="reclamacion-texto">${esc(r.descripcion)}</p>
        ${r.adjuntos.length ? `<div class="reclamacion-adjuntos">${r.adjuntos.map(id => `<button type="button" class="perfil-mas" data-adjunto="${esc(id)}">Ver imagen</button>`).join('')}</div>` : ''}
        ${r.solucion ? `<div class="resumen-precio"><strong>Solución</strong><p>${esc(r.solucion)}</p></div>` : ''}
        <h4>Conversación</h4>
        ${r.mensajes.length ? `<ol class="reclamacion-mensajes">${r.mensajes.map(m => `<li class="${m.autor === 'cliente' ? 'del-cliente' : 'del-equipo'}">
            <strong>${m.autor === 'cliente' ? 'Tú' : 'Barbería'}</strong><small>${esc(new Date(m.creado_en).toLocaleString('es-DO'))}</small><p>${esc(m.cuerpo)}</p></li>`).join('')}</ol>`
            : '<p class="nota-espera">Aún no hay respuestas. La barbería te contestará aquí.</p>'}
        ${r.puede_responder ? `<form class="reclamacion-form" data-responder novalidate><label>Tu respuesta<textarea name="cuerpo" rows="4" maxlength="2000" required></textarea></label>
            <label>Imágenes (opcional, hasta 3)<input type="file" name="imagenes" accept="image/png,image/jpeg,image/webp" multiple></label>
            <p class="reclamacion-error" role="alert" hidden></p><button type="submit" class="btn-primary">Enviar respuesta</button></form>` : ''}
        <a class="btn-regresar-form enlace-gestion" href="${esc(location.pathname)}#mis-citas">Ir a Mis citas</a></div>`;
    panel.querySelectorAll('[data-adjunto]').forEach(b => b.addEventListener('click', async () => {
        const { data } = await supabase.rpc('reclamacion_adjunto', { p_token: token, p_adjunto: Number(b.dataset.adjunto) });
        if (data) b.outerHTML = `<img class="reclamacion-imagen" src="${esc(data)}" alt="Imagen adjunta a la reclamación">`;
    }));
    const form = panel.querySelector('[data-responder]');
    if (form) {
        const clave = nuevaClave();
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const boton = form.querySelector('[type=submit]');
            const error = form.querySelector('.reclamacion-error');
            if (boton.disabled) return;
            if (!form.elements.cuerpo.value.trim()) { error.textContent = 'Escribe tu respuesta.'; error.hidden = false; return; }
            boton.disabled = true;
            try {
                const adjuntos = await imagenes(form.elements.imagenes);
                const { error: fallo } = await supabase.rpc('reclamacion_responder', { p_datos: { clave, token, cuerpo: form.elements.cuerpo.value.trim(), adjuntos } });
                if (fallo) throw fallo;
                renderReclamacion(panel, token);
            } catch (fallo) { error.textContent = mensajeError(fallo); error.hidden = false; boton.disabled = false; }
        });
    }
}

// ---------- Lista para «Mis citas» ----------
export async function cargarMisReclamaciones() {
    const tokens = leer();
    const porToken = new Map();
    if (tokens.length) {
        const { data, error } = await supabase.rpc('mis_reclamaciones_por_tokens', { p_tokens: tokens });
        if (error) throw error;
        data.forEach(r => porToken.set(r.token, r));
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        const { data, error } = await supabase.rpc('mis_reclamaciones');
        if (error) throw error;
        data.forEach(r => porToken.set(r.token, r));
    }
    return [...porToken.values()].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));
}

export function htmlMisReclamaciones(lista) {
    return lista.map(r => `<a class="mc-reclamacion" href="?reclamacion=${encodeURIComponent(r.token)}#contacto">
        <span><strong>${esc(r.codigo)}</strong> · ${esc(r.categoria)}<small>${esc(new Date(r.creado_en).toLocaleDateString('es-DO'))}</small></span>
        <span class="badge-estado ${r.estado === 'resuelta' || r.estado === 'cerrada' ? 'badge-confirmada' : 'badge-pendiente'}">${esc(ESTADOS_RECLAMACION[r.estado] || r.estado)}</span></a>`).join('');
}
