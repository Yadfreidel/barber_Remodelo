// ==========================================
// DEL RESULTADO A LA RESERVA
// «Quiero este estilo con [barbero]» lleva una publicación de «Estilos de la casa» al formulario de
// reserva de siempre: preselecciona al barbero autor (si sigue disponible) y el servicio relacionado
// (si ese barbero lo ofrece hoy), y muestra la publicación como inspiración. No crea ni confirma nada:
// servicio, fecha y hora se eligen en los pasos habituales y el servidor lo valida todo al reservar.
// La referencia se guarda en este navegador (solo su id) y, tras reservar, con la cita.
// ==========================================

import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { obtenerBarberos } from '../models/barberModel.js';
import { obtenerServicios } from '../models/serviceModel.js';
import { escapar as esc } from '../assets/catalogue-ui.js';
import { leerReferencia, guardarReferencia, borrarReferencia } from '../assets/mis-citas-store.js';
import { abrirDetalleEstilo, pedirFoto } from './estilosController.js';

let actual = null;   // publicación vigente (datos de estilo_publico) o { no_disponible: true }
let turno = 0;
const primerNombre = n => String(n || '').split(' ')[0];
const barberoActivo = id => obtenerBarberos().find(b => b.barbero_id && String(b.barbero_id) === String(id));
// Servicio relacionado válido hoy: existe en el catálogo actual y el barbero lo ofrece (misma regla que el servidor)
function servicioValido(t, barberoId) {
    if (!t?.servicio) return null;
    const s = obtenerServicios().find(x => String(x.servicio_id) === String(t.servicio.id));
    if (!s) return null;
    return !Array.isArray(s.barberos) || !s.barberos.length || s.barberos.map(String).includes(String(barberoId)) ? s : null;
}

export function referenciaActual() {
    return actual && !actual.no_disponible ? actual.id : null;
}

// ---------- Desde el detalle de la publicación ----------
// Solo en el navegador (las pruebas importan el formulario con una ventana simulada)
const enNavegador = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
if (enNavegador) window.addEventListener('estilo-como-referencia', e => elegirEstilo(e.detail));

function elegirEstilo(t) {
    if (!t?.id) return;
    guardarReferencia(t.id);
    actual = t;
    const select = document.getElementById('servicio-select');
    const autor = barberoActivo(t.barbero_id);
    // Servicio relacionado solo si el autor lo ofrece hoy; si no, el cliente elige uno en el paso de servicio
    const servicio = autor ? servicioValido(t, t.barbero_id) : null;
    if (servicio && select && select.value !== servicio.nombre) {
        select.value = servicio.nombre;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    pintar();
    if (autor) {
        // Mismo mecanismo que «Reservar con…»: selecciona su tarjeta, revisa el servicio y retoma la reserva
        window.dispatchEvent(new CustomEvent('reservar-con-barbero', { detail: { nombre: autor.nombre } }));
    } else {
        // El autor ya no acepta reservas: no se sustituye en silencio; el cliente elige otro barbero
        location.hash = 'contacto';
        window.dispatchEvent(new CustomEvent('ir-paso-reserva', { detail: select?.value ? 1 : 0 }));
    }
    anunciar(`Inspiración añadida: ${t.titulo}.`);
}

// ---------- Recuperación al recargar ----------
export async function iniciarReferencia() {
    const id = leerReferencia();
    if (!id || !estaSupabaseListo()) return;
    const consulta = ++turno;
    let t;
    try {
        const { data, error } = await supabase.rpc('estilo_publico', { p_id: id });
        if (error) throw error;
        t = data;
    } catch { return; } // sin conexión: se intentará en la próxima carga; la reserva funciona igual
    if (consulta !== turno) return;
    actual = t || { no_disponible: true };
    if (!t) borrarReferencia();
    pintar();
}

// ---------- Bloque «Tu inspiración» dentro del formulario ----------
function contenedor() {
    let caja = document.getElementById('inspiracion-reserva');
    if (!caja) {
        const form = document.getElementById('form-reservas');
        if (!form) return null;
        caja = document.createElement('section');
        caja.id = 'inspiracion-reserva';
        caja.className = 'inspiracion-reserva';
        caja.setAttribute('aria-labelledby', 'inspiracion-titulo');
        (form.querySelector('.pasos-reserva') || form.firstElementChild).after(caja);
        caja.addEventListener('click', e => {
            if (e.target.closest('[data-quitar-referencia]')) quitar();
            if (e.target.closest('[data-ver-referencia]') && actual?.id) abrirDetalleEstilo(actual.id, { origen: e.target.closest('button'), soloConsulta: true });
        });
    }
    return caja;
}

function pintar() {
    const caja = contenedor();
    if (!caja) return;
    if (!actual) { caja.hidden = true; caja.innerHTML = ''; return; }
    caja.hidden = false;
    if (actual.no_disponible) {
        caja.innerHTML = `<p class="inspiracion-eyebrow" id="inspiracion-titulo">Tu inspiración</p>
            <p class="inspiracion-aviso">La publicación que elegiste como referencia ya no está disponible. Puedes continuar con tu reserva normalmente.</p>
            <button type="button" class="inspiracion-accion" data-quitar-referencia>Entendido</button>`;
        return;
    }
    const t = actual;
    const elegido = document.getElementById('barbero-seleccionado')?.value || '';
    const autor = barberoActivo(t.barbero_id);
    const aviso = !autor
        ? `<p class="inspiracion-aviso">${esc(primerNombre(t.barbero))} no tiene reservas disponibles en este momento. Elige otro barbero; puedes conservar esta referencia como inspiración.</p>`
        : elegido && elegido !== autor.nombre
            ? `<p class="inspiracion-aviso">Tu cita será con ${esc(elegido)}. El trabajo de referencia es de ${esc(t.barbero)}.</p>`
            : !servicioValido(t, t.barbero_id) && !document.getElementById('servicio-select')?.value
                ? `<p class="inspiracion-aviso">Elige uno de los servicios que ofrece ${esc(primerNombre(t.barbero))} para continuar.</p>` : '';
    const portada = t.fotos?.[0];
    caja.innerHTML = `
        <div class="inspiracion-media">${portada ? `<img alt="${esc(t.texto_alternativo || t.titulo)}" width="${Number(portada.ancho)}" height="${Number(portada.alto)}"
            style="object-position:${Number(portada.foco_x)}% ${Number(portada.foco_y)}%" data-foto="${esc(portada.id)}" decoding="async">` : ''}</div>
        <div class="inspiracion-texto">
            <p class="inspiracion-eyebrow" id="inspiracion-titulo">Tu inspiración</p>
            <strong class="inspiracion-nombre">${esc(t.titulo)}</strong>
            <span class="inspiracion-autor">Realizado por ${esc(t.barbero)}</span>
            <div class="inspiracion-acciones">
                <button type="button" class="inspiracion-accion" data-ver-referencia>Ver trabajo</button>
                <button type="button" class="inspiracion-accion secundaria" data-quitar-referencia>Quitar referencia</button>
            </div>
        </div>
        ${aviso}
        <p class="inspiracion-nota">El resultado se adapta a tu tipo y largo de cabello durante la consulta con el barbero.</p>`;
    const img = caja.querySelector('img[data-foto]');
    if (img) pedirFoto(img.dataset.foto, 'miniatura').then(url => { if (img.isConnected) { img.src = url; img.closest('.inspiracion-media').classList.add('cargada'); } }).catch(() => {});
}

// Quitar la referencia no toca el resto del formulario
function quitar() {
    actual = null;
    borrarReferencia();
    pintar();
    anunciar('Referencia quitada. Tus demás datos se conservan.');
    document.querySelector('#form-reservas .form-titulo')?.focus({ preventScroll: true });
}

// Tras guardar la cita (o descartarla), la inspiración ya no se arrastra a la siguiente reserva
export function terminarReferencia() {
    actual = null;
    borrarReferencia();
    pintar();
}

function anunciar(texto) {
    const region = document.getElementById('horas-anuncio');
    if (region) { region.textContent = ''; setTimeout(() => { region.textContent = texto; }, 50); }
}

// Cambios de barbero o servicio: el aviso del bloque se actualiza (el autor original siempre se identifica)
if (enNavegador) {
    window.addEventListener('barbero-cambiado', () => { if (actual) pintar(); });
    document.addEventListener('change', e => { if (actual && e.target?.id === 'servicio-select') pintar(); });
    window.addEventListener('borrador-descartado', terminarReferencia);
}

// ---------- Referencia guardada con una cita (cliente con su token, o personal autorizado en el panel) ----------
// obtener: consulta que respeta los permisos de quien mira (cita_referencia o panel_cita_referencia)
export async function pintarReferenciaCita(caja, obtener, { titulo = 'Tu inspiración', nota = true } = {}) {
    if (!caja) return;
    let r;
    try { r = await obtener(); } catch { caja.hidden = true; return; }
    if (!r || !caja.isConnected) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.classList.add('inspiracion-reserva', 'inspiracion-cita');
    if (!r.disponible) {
        caja.innerHTML = `<p class="inspiracion-eyebrow">${esc(titulo)}</p>
            <p class="inspiracion-aviso">La publicación de referencia ya no está disponible.</p>`;
        return;
    }
    caja.innerHTML = `
        <div class="inspiracion-media">${r.portada_id ? `<img alt="${esc(r.texto_alternativo || r.titulo)}" data-foto="${esc(r.portada_id)}" decoding="async">` : ''}</div>
        <div class="inspiracion-texto">
            <p class="inspiracion-eyebrow">${esc(titulo)}</p>
            <strong class="inspiracion-nombre">${esc(r.titulo)}</strong>
            <span class="inspiracion-autor">Realizado por ${esc(r.barbero)}</span>
            <div class="inspiracion-acciones"><button type="button" class="inspiracion-accion" data-ver-referencia>Ver trabajo</button></div>
        </div>
        ${nota ? '<p class="inspiracion-nota">El resultado se adapta a tu tipo y largo de cabello durante la consulta con el barbero.</p>' : ''}`;
    caja.querySelector('[data-ver-referencia]').addEventListener('click', e => abrirDetalleEstilo(r.trabajo_id, { origen: e.currentTarget, soloConsulta: true }));
    const img = caja.querySelector('img[data-foto]');
    if (img) pedirFoto(img.dataset.foto, 'miniatura').then(url => { if (img.isConnected) { img.src = url; img.closest('.inspiracion-media').classList.add('cargada'); } }).catch(() => {});
}
