// ==========================================
// CONSULTA RÁPIDA DE ESTILO: «¿Cómo quieres tu corte?»
// Sección opcional y plegable del paso «Tus datos». El cliente puede adjuntar una foto de referencia y una
// nota breve. La foto se prepara en el dispositivo (JPEG reducido + miniatura, igual que el chat) y solo se
// envía DESPUÉS de guardar la cita, con el token secreto de esa cita (cita_estilo_guardar). El servidor
// vuelve a validar formato real y tamaño, y guarda una sola consulta por cita: reintentar no duplica nada.
// Si el envío falla, la cita ya está guardada: se ofrece reintentar o continuar sin la foto.
// ==========================================

import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { prepararFoto } from '../assets/chat/chat-medios.js';
import { escapar as esc } from '../assets/catalogue-ui.js';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_ARCHIVO = 15 * 1024 * 1024;
const MAX_NOTA = 300;

let foto = null;          // { datos, miniatura, ancho, alto } lista para enviar
let archivoFallido = null; // última imagen que no se pudo preparar (para «Reintentar»)
let preparando = 0;

const $ = sel => document.querySelector(sel);
// Solo imágenes en data URL (lo que guarda y valida el servidor): nada más llega a un atributo src
const imagen = v => (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v || '') ? v : '');

// ---------- Sección en el formulario ----------
export function iniciarConsultaEstilo() {
    const notas = document.getElementById('booking-notes');
    if (!notas || document.getElementById('consulta-estilo')) return;
    const caja = document.createElement('details');
    caja.id = 'consulta-estilo';
    caja.className = 'consulta-estilo';
    caja.innerHTML = `
        <summary><span><i class="fas fa-scissors" aria-hidden="true"></i> ¿Cómo quieres tu corte?</span> <small>Opcional</small></summary>
        <div class="consulta-estilo-cuerpo">
            <p class="consulta-estilo-ayuda">Muéstrale a tu barbero lo que buscas. Solo lo verán tu barbero y la administración.</p>
            <div class="consulta-estilo-foto" data-foto-zona>
                <input type="file" id="consulta-estilo-archivo" accept="image/jpeg,image/png,image/webp" hidden>
                <button type="button" class="consulta-estilo-anadir" data-elegir>
                    <i class="fas fa-camera" aria-hidden="true"></i> Añadir foto de referencia
                    <small>JPG, PNG o WebP · hasta 15 MB</small></button>
            </div>
            <p class="consulta-estilo-error" role="alert" hidden></p>
            <label class="label-fijo" for="consulta-estilo-nota">Nota para tu barbero</label>
            <textarea id="consulta-estilo-nota" rows="2" maxlength="${MAX_NOTA}" placeholder="Déjame el largo arriba y hazme un degradado bajo"></textarea>
            <small class="consulta-estilo-contador" aria-live="polite"><span data-contador>0</span>/${MAX_NOTA}</small>
        </div>`;
    notas.before(caja);
    const archivo = caja.querySelector('#consulta-estilo-archivo');
    caja.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.matches('[data-elegir], [data-cambiar]')) { archivo.value = ''; archivo.click(); }
        if (b.matches('[data-quitar]')) quitarFoto();
        if (b.matches('[data-reintentar]') && archivoFallido) cargar(archivoFallido);
    });
    archivo.addEventListener('change', () => { if (archivo.files[0]) cargar(archivo.files[0]); });
    const nota = caja.querySelector('#consulta-estilo-nota');
    nota.addEventListener('input', () => { caja.querySelector('[data-contador]').textContent = nota.value.length; });
    pintarFoto();
}

function error(texto, { reintentar = false } = {}) {
    const p = $('#consulta-estilo .consulta-estilo-error');
    if (!p) return;
    p.hidden = !texto;
    p.innerHTML = texto ? `${esc(texto)}${reintentar ? ' <button type="button" class="consulta-estilo-enlace" data-reintentar>Reintentar</button> <button type="button" class="consulta-estilo-enlace" data-quitar>Quitar foto</button>' : ''}` : '';
}

async function cargar(archivo) {
    error('');
    if (!TIPOS.includes(archivo.type)) { archivoFallido = null; error('Formato no admitido. Elige una foto JPG, PNG o WebP.'); return; }
    if (archivo.size > MAX_ARCHIVO) { archivoFallido = null; error('La foto pesa más de 15 MB. Elige otra o recórtala.'); return; }
    const turno = ++preparando;
    pintarFoto({ cargando: true });
    try {
        const lista = await prepararFoto(archivo);
        if (turno !== preparando) return;
        foto = lista;
        archivoFallido = null;
    } catch (e) {
        if (turno !== preparando) return;
        archivoFallido = archivo;
        error(e?.message || 'No pudimos cargar la foto.', { reintentar: true });
    }
    pintarFoto();
}

function quitarFoto() {
    preparando++;
    foto = null;
    archivoFallido = null;
    error('');
    pintarFoto();
    $('#consulta-estilo [data-elegir]')?.focus();
}

function pintarFoto({ cargando = false } = {}) {
    const zona = $('#consulta-estilo [data-foto-zona]');
    if (!zona) return;
    const input = zona.querySelector('input');
    zona.querySelectorAll(':scope > :not(input)').forEach(n => n.remove());
    if (cargando) {
        zona.insertAdjacentHTML('beforeend', '<p class="consulta-estilo-cargando"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Preparando la foto…</p>');
    } else if (foto) {
        zona.insertAdjacentHTML('beforeend', `<figure class="consulta-estilo-vista">
            <img src="${foto.miniatura}" alt="Vista previa de tu foto de referencia" width="${foto.ancho}" height="${foto.alto}">
            <figcaption><button type="button" class="consulta-estilo-enlace" data-cambiar><i class="fas fa-rotate" aria-hidden="true"></i> Cambiar foto</button>
                <button type="button" class="consulta-estilo-enlace" data-quitar><i class="fas fa-trash" aria-hidden="true"></i> Quitar foto</button></figcaption></figure>`);
    } else {
        zona.insertAdjacentHTML('beforeend', `<button type="button" class="consulta-estilo-anadir" data-elegir>
            <i class="fas fa-camera" aria-hidden="true"></i> Añadir foto de referencia <small>JPG, PNG o WebP · hasta 15 MB</small></button>`);
    }
    zona.prepend(input);
}

// Lo que se enviará con la cita (null si la sección quedó vacía)
export function consultaEstiloActual() {
    const nota = ($('#consulta-estilo-nota')?.value || '').trim().slice(0, MAX_NOTA);
    return nota || foto ? { nota, foto } : null;
}

// ¿Hay una foto preparándose? (se espera antes de confirmar)
export function consultaEstiloOcupada() { return Boolean($('#consulta-estilo .consulta-estilo-cargando')); }

// Tras reservar: vacía la sección para la próxima reserva
export function limpiarConsultaEstilo() {
    foto = null;
    archivoFallido = null;
    preparando++;
    const caja = $('#consulta-estilo');
    if (!caja) return;
    caja.open = false;
    const nota = caja.querySelector('#consulta-estilo-nota');
    nota.value = '';
    caja.querySelector('[data-contador]').textContent = '0';
    error('');
    pintarFoto();
}

// ---------- Envío (después de guardar la cita) ----------
async function enviar(token, consulta) {
    const args = { p_token: token, p_nota: consulta.nota || null, p_foto: consulta.foto?.datos || null,
        p_miniatura: consulta.foto?.miniatura || null, p_ancho: consulta.foto?.ancho || null, p_alto: consulta.foto?.alto || null };
    let ultimo;
    for (let intento = 0; intento < 3; intento++) {
        try {
            const { error: e } = await supabase.rpc('cita_estilo_guardar', args);
            if (!e) return { ok: true };
            ultimo = e;
            if (/foto_invalida|nota_muy_larga|cita_cerrada|cita_no_encontrada/.test(e.message || '')) break; // reintentar no lo arregla
        } catch (e) { ultimo = e; }
        await new Promise(r => setTimeout(r, 1200 * (intento + 1)));
    }
    return { ok: false, error: ultimo };
}

// Envía la consulta; si falla, muestra junto al comprobante «Reintentar» y «Continuar sin la foto».
export async function guardarConsultaEstilo(token, consulta) {
    if (!token || !consulta || !estaSupabaseListo()) return true;
    const r = await enviar(token, consulta);
    if (r.ok) return true;
    avisoFallo(token, consulta, r.error);
    return false;
}

function avisoFallo(token, consulta, e) {
    const seguimiento = document.getElementById('pantalla-seguimiento');
    if (!seguimiento) return;
    document.getElementById('consulta-estilo-envio')?.remove();
    const caja = document.createElement('div');
    caja.id = 'consulta-estilo-envio';
    caja.className = 'consulta-estilo-envio';
    caja.setAttribute('role', 'alert');
    const invalida = /foto_invalida/.test(e?.message || '');
    caja.innerHTML = `<p><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Tu cita quedó guardada, pero no pudimos adjuntar
        ${consulta.foto ? 'tu foto de referencia' : 'tu nota de estilo'}${invalida ? ' (el archivo no es una imagen válida)' : ''}.</p>
        <div>${invalida ? '' : '<button type="button" class="consulta-estilo-enlace" data-reenviar>Reintentar</button>'}
        ${consulta.foto && consulta.nota ? '<button type="button" class="consulta-estilo-enlace" data-sin-foto>Enviar solo la nota</button>' : ''}
        <button type="button" class="consulta-estilo-enlace" data-continuar>Continuar sin ${consulta.foto ? 'la foto' : 'la nota'}</button></div>`;
    seguimiento.before(caja);
    caja.addEventListener('click', async ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.matches('[data-continuar]')) { caja.remove(); return; }
        const datos = b.matches('[data-sin-foto]') ? { nota: consulta.nota, foto: null } : consulta;
        caja.querySelectorAll('button').forEach(x => { x.disabled = true; });
        b.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Enviando…';
        const r = await enviar(token, datos);
        if (r.ok) {
            caja.className = 'consulta-estilo-envio ok';
            caja.innerHTML = '<p><i class="fas fa-check" aria-hidden="true"></i> Listo: tu barbero ya puede ver tu referencia.</p>';
            setTimeout(() => caja.remove(), 6000);
        } else avisoFallo(token, datos, r.error);
    });
    // Al volver al formulario el aviso desaparece
    document.getElementById('btn-regresar-formulario')?.addEventListener('click', () => caja.remove(), { once: true });
}

// ---------- Ver la consulta guardada (cliente con su token, o personal autorizado) ----------
// obtener(completa) devuelve { nota, tiene_foto, miniatura, ancho, alto, foto? } o null; respeta los permisos de quien mira.
export async function pintarConsultaEstilo(caja, obtener, { titulo = 'Cómo quieres tu corte' } = {}) {
    if (!caja) return;
    let e;
    try { e = await obtener(false); } catch { caja.hidden = true; return; }
    if (!e || !caja.isConnected) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.classList.add('consulta-estilo-guardada');
    caja.innerHTML = `
        ${e.tiene_foto && imagen(e.miniatura) ? `<button type="button" class="consulta-estilo-miniatura" data-ampliar aria-label="Ampliar la foto de referencia">
            <img src="${imagen(e.miniatura)}" alt="Foto de referencia del cliente" width="${Number(e.ancho) || 120}" height="${Number(e.alto) || 120}"></button>` : ''}
        <div class="consulta-estilo-texto">
            <p class="inspiracion-eyebrow">${esc(titulo)}</p>
            ${e.nota ? `<p class="consulta-estilo-nota-guardada">«${esc(e.nota)}»</p>` : '<p class="consulta-estilo-nota-guardada tenue">Sin nota: solo foto de referencia.</p>'}
        </div>`;
    caja.querySelector('[data-ampliar]')?.addEventListener('click', async ev => {
        const boton = ev.currentTarget;
        boton.disabled = true;
        try {
            const completa = await obtener(true);
            if (imagen(completa?.foto)) ampliar(imagen(completa.foto), boton);
        } catch { /* sin conexión: se queda la miniatura */ }
        boton.disabled = false;
    });
}

function ampliar(src, origen) {
    const d = document.createElement('dialog');
    d.className = 'consulta-estilo-visor';
    d.innerHTML = `<form method="dialog"><button class="consulta-estilo-cerrar" aria-label="Cerrar"><i class="fas fa-times" aria-hidden="true"></i></button></form>
        <img src="${src}" alt="Foto de referencia del cliente">`;
    document.body.append(d);
    d.addEventListener('close', () => { d.remove(); origen?.focus?.(); });
    d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
    d.showModal();
}
