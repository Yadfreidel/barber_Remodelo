// ==========================================
// WEB PÚBLICA: datos administrados desde el panel
// Barberos activos y configuración del negocio publicada. Si el servidor no
// responde o aún no hay nada publicado, la página conserva su contenido original.
// ==========================================

import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { sincronizarBarberosServidor } from '../models/barberModel.js';

export async function cargarBarberosServidor() {
    if (!estaSupabaseListo()) return false;
    try {
        const { data, error } = await supabase.rpc('barberos_publicos');
        if (error || !Array.isArray(data) || !data.length) return false;
        sincronizarBarberosServidor(data);
        return true;
    } catch { return false; }
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONOS_REDES = { instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok', youtube: 'youtube' };

export async function aplicarNegocioPublico() {
    if (!estaSupabaseListo()) return;
    let n;
    try {
        const { data, error } = await supabase.rpc('negocio_publico');
        if (error || !data) return;
        n = data;
    } catch { return; }

    if (n.nombre) {
        document.querySelectorAll('.logo-text').forEach(el => { el.textContent = n.nombre; });
        document.title = `${n.nombre} | Reserva tu cita`;
    }
    if (n.logo_url) {
        document.querySelectorAll('.logo-emblem').forEach(el => { el.innerHTML = `<img src="${esc(n.logo_url)}" alt="" class="logo-imagen">`; });
    }
    if (n.descripcion) document.querySelectorAll('.hero-description').forEach(el => { el.textContent = n.descripcion; });
    if (n.portada_url) document.querySelectorAll('.hero-portrait img').forEach(img => { img.src = n.portada_url; img.removeAttribute('srcset'); });

    const whatsapp = String(n.whatsapp || '').replace(/\D/g, '');
    if (whatsapp) {
        const numero = whatsapp.length === 10 ? `1${whatsapp}` : whatsapp;
        document.querySelectorAll('a[href*="wa.me/"]').forEach(a => { a.href = a.href.replace(/wa\.me\/\d+/, `wa.me/${numero}`); });
    }
    const telefono = String(n.telefono || '').replace(/[^\d+]/g, '');
    if (telefono) {
        document.querySelectorAll('a[href^="tel:"]').forEach(a => {
            a.href = `tel:${telefono.startsWith('+') || telefono.length !== 10 ? telefono : `+1${telefono}`}`;
            const pequeno = a.querySelector('small');
            if (pequeno) pequeno.textContent = n.telefono;
        });
    }
    if (Array.isArray(n.horarios_publicos) && n.horarios_publicos.length) {
        const info = document.querySelector('.footer-info');
        if (info) {
            info.querySelectorAll('p').forEach(p => p.remove());
            info.insertAdjacentHTML('beforeend', n.horarios_publicos.map(h => `<p><i class="fas fa-clock"></i> ${esc(h)}</p>`).join(''));
        }
    }
    const redes = Object.entries(n.redes || {}).filter(([k, v]) => ICONOS_REDES[k] && /^https:\/\//.test(v || ''));
    if (redes.length) {
        const enlaces = redes.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(k)}"><i class="fab fa-${ICONOS_REDES[k]}"></i></a>`).join('');
        document.querySelector('.footer-contacto')?.insertAdjacentHTML('beforeend', `<p class="redes-sociales">${enlaces}</p>`);
        document.querySelector('.contact-card')?.insertAdjacentHTML('beforeend', `<p class="redes-sociales">${enlaces}</p>`);
    }
    if (Array.isArray(n.faq) && n.faq.length) {
        const faq = document.querySelector('.faq-card');
        if (faq) {
            faq.querySelectorAll('details').forEach(d => d.remove());
            faq.insertAdjacentHTML('beforeend', n.faq.map(f => `<details><summary>${esc(f.pregunta)}</summary><p>${esc(f.respuesta)}</p></details>`).join(''));
        }
    }
}
