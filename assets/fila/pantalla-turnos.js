// ==========================================
// PANTALLA DE TURNOS PARA LA TV DEL LOCAL (solo lectura, sin sesión)
// Consulta fila_pantalla(): SOLO código de turno, silla y estado de los llamados vigentes (el mismo estado
// «llamado» que ve el celular del cliente). No recibe nombres, teléfonos, fotos, notas ni datos de citas.
//   - Cada pocos segundos (y al volver a la pestaña). Si falla: «Reconectando…» y al volver, el estado actual.
//   - Sonido: los navegadores exigen un toque; «Activar sonido» lo habilita. Suena una vez por llamado nuevo:
//     las claves de los llamados ya anunciados se guardan en este navegador, así que reconectar o recargar
//     no repite el aviso.
//   - Un llamado desaparece cuando el barbero inicia el servicio, lo cierra o vence la cortesía.
// ==========================================

import { supabase, estaSupabaseListo } from '../supabaseClient.js';
import { aplicarColoresPortal } from '../identidad-colores.js';

const INTERVALO = 3000;
const CLAVE_VISTOS = 'barberia-tv-llamados';
const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlFila = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}fila.html`;

let temporizador = null;
let fallos = 0;
let audio = null;
let ultimaFirma = '';
let urlQR = '';
let vistos = leerVistos();

function leerVistos() {
    try { return new Set(JSON.parse(localStorage.getItem(CLAVE_VISTOS) || '[]')); } catch { return new Set(); }
}
function guardarVistos() {
    try { localStorage.setItem(CLAVE_VISTOS, JSON.stringify([...vistos].slice(-60))); } catch { /* sin almacenamiento */ }
}

// ---------- Sonido ----------
function sonidoActivo() { return audio?.state === 'running'; }
async function activarSonido() {
    try {
        const A = window.AudioContext || window.webkitAudioContext;
        audio = audio || new A();
        await audio.resume();
    } catch { audio = null; }
    pintarBotonSonido();
    if (sonidoActivo()) campana();
}
function pintarBotonSonido() {
    const b = $('[data-sonido]');
    const activo = sonidoActivo();
    b.classList.toggle('activo', activo);
    b.setAttribute('aria-pressed', String(activo));
    b.innerHTML = activo ? '<i class="fas fa-volume-high" aria-hidden="true"></i> Sonido activado'
        : '<i class="fas fa-volume-xmark" aria-hidden="true"></i> Activar sonido';
}
// Dos notas suaves (sin archivos externos)
function campana() {
    if (!sonidoActivo()) return;
    const t = audio.currentTime;
    [[659.25, 0], [880, 0.28]].forEach(([f, d]) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
        o.connect(g); g.connect(audio.destination);
        o.start(t + d); o.stop(t + d + 1);
    });
}

// ---------- Pintado ----------
function texto(l) {
    return l.silla ? `Pasa a la silla ${l.silla}` : 'Pasa a recepción';
}

function pintar(d) {
    const firma = JSON.stringify([d.llamados, d.en_espera, d.recepcion_abierta]);
    const nuevos = d.llamados.filter(l => !vistos.has(l.clave));
    if (firma !== ultimaFirma) {
        ultimaFirma = firma;
        const caja = $('[data-llamados]');
        caja.innerHTML = d.llamados.length ? d.llamados.map((l, i) => `
            <article class="tv-llamado ${i === 0 ? 'principal' : ''} ${nuevos.some(n => n.clave === l.clave) ? 'nuevo' : ''}">
                <span class="tv-codigo">${esc(l.codigo)}</span>
                <span class="tv-separador" aria-hidden="true">·</span>
                <span class="tv-destino">${esc(texto(l))}</span>
            </article>`).join('')
            : '<p class="tv-vacio"><i class="fa-regular fa-clock" aria-hidden="true"></i> Esperando el próximo turno</p>';
        $('[data-espera]').textContent = d.recepcion_abierta
            ? (d.en_espera ? `${d.en_espera} ${d.en_espera === 1 ? 'turno' : 'turnos'} en espera` : 'Nadie en espera')
            : 'La fila no recibe turnos nuevos en este momento';
        $('[data-qr-texto]').hidden = !d.recepcion_abierta;
        $('[data-qr]').classList.toggle('pausa', !d.recepcion_abierta);
    }
    if (nuevos.length) {
        campana();
        nuevos.forEach(n => vistos.add(n.clave));
        guardarVistos();
    }
    const url = d.url_publica || urlFila();
    if (url !== urlQR) pintarQR(url);
}

function pintarQR(url) {
    const caja = $('[data-qr]');
    if (typeof window.QRCode !== 'function') return;
    urlQR = url;
    caja.innerHTML = '';
    new window.QRCode(caja, { text: url, width: 220, height: 220, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
}

function reloj() {
    $('[data-reloj]').textContent = new Date().toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Santo_Domingo' });
}

// ---------- Ciclo ----------
async function actualizar() {
    clearTimeout(temporizador);
    try {
        const { data, error } = await supabase.rpc('fila_pantalla');
        if (error) throw error;
        fallos = 0;
        $('[data-conexion]').hidden = true;
        document.body.classList.remove('sin-conexion');
        pintar(data);
    } catch {
        fallos++;
        $('[data-conexion]').hidden = false;
        document.body.classList.add('sin-conexion');
    }
    // Reintento rápido al principio, luego más espaciado mientras no haya conexión
    temporizador = setTimeout(actualizar, fallos ? Math.min(INTERVALO * 2 ** Math.min(fallos - 1, 3), 20000) : INTERVALO);
}

async function identidad() {
    try {
        const { data: n } = await supabase.rpc('negocio_publico');
        if (!n) return;
        aplicarColoresPortal({ principal: n.color_principal, acento: n.color_acento });
        if (n.nombre) { $('[data-negocio]').textContent = n.nombre; document.title = `Pantalla de turnos | ${n.nombre}`; }
        if (/^(https:\/\/|data:image\/(png|jpeg|webp|svg\+xml);base64,|assets\/)/.test(n.logo_url || '')) {
            $('[data-logo]').innerHTML = `<img src="${esc(n.logo_url)}" alt="">`;
        }
    } catch { /* se conserva el diseño base */ }
}

// ---------- Controles ----------
$('[data-sonido]').addEventListener('click', activarSonido);
$('[data-completa]').addEventListener('click', async () => {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* el navegador no lo permite */ }
});
document.addEventListener('fullscreenchange', () => {
    const b = $('[data-completa]');
    b.innerHTML = document.fullscreenElement ? '<i class="fas fa-compress" aria-hidden="true"></i> Salir de pantalla completa'
        : '<i class="fas fa-expand" aria-hidden="true"></i> Pantalla completa';
    document.body.classList.toggle('en-completa', Boolean(document.fullscreenElement));
});
if (!document.fullscreenEnabled) $('[data-completa]').hidden = true;
// Los controles se ocultan solos tras unos segundos sin mover el ratón (la TV queda limpia)
let ocultar = null;
const mostrarControles = () => {
    document.body.classList.remove('controles-ocultos');
    clearTimeout(ocultar);
    ocultar = setTimeout(() => { if (sonidoActivo()) document.body.classList.add('controles-ocultos'); }, 6000);
};
['mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, mostrarControles, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') actualizar(); });
window.addEventListener('online', actualizar);

pintarBotonSonido();
reloj();
setInterval(reloj, 15000);
if (!estaSupabaseListo()) {
    $('[data-llamados]').innerHTML = '<p class="tv-vacio">Falta la configuración del servidor.</p>';
} else {
    identidad();
    actualizar();
}
