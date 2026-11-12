// ==========================================
// PANTALLA DE TURNOS PARA LA TV DEL LOCAL (solo lectura, sin sesión)
// Consulta fila_pantalla(): SOLO datos públicos. Llamados vigentes (código, silla y estado: el mismo «llamado»
// que ve el celular del cliente), fila sin cita (código, estado, turnos delante y minutos estimados con los
// cálculos de la Fila virtual) y citas confirmadas de hoy (código del comprobante, hora reservada, estado y
// silla si está en atención). No recibe nombres, teléfonos, fotos, notas, identificadores internos ni tokens.
//   - Las listas se reparten en páginas que caben en pantalla y rotan solas («1 de 3»): nunca hay desplazamiento.
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
const destino = l => (l.silla ? `Silla ${l.silla}` : 'Recepción');
const textoLlamado = l => (l.silla ? `${l.codigo}, pasa a la silla ${l.silla}` : `${l.codigo}, pasa a recepción`);

function pintar(d) {
    const firma = JSON.stringify([d.llamados, d.en_espera, d.recepcion_abierta]);
    const nuevos = d.llamados.filter(l => !vistos.has(l.clave));
    if (firma !== ultimaFirma) {
        ultimaFirma = firma;
        const caja = $('[data-llamados]');
        // El primero (el más reciente) es el bloque grande; los demás llamados vigentes, debajo y más pequeños
        caja.innerHTML = d.llamados.length ? d.llamados.map((l, i) => `
            <article class="tv-llamado ${i === 0 ? 'principal' : ''} ${nuevos.some(n => n.clave === l.clave) ? 'nuevo' : ''}" aria-label="${esc(textoLlamado(l))}">
                <span class="tv-codigo" aria-hidden="true">${esc(l.codigo)}</span>
                <span class="tv-flecha" aria-hidden="true">→</span>
                <span class="tv-destino" aria-hidden="true">${esc(destino(l))}</span>
            </article>`).join('')
            : '<p class="tv-vacio"><i class="fa-regular fa-clock" aria-hidden="true"></i> Nadie en llamado ahora. Atento a tu código.</p>';
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
    // Las listas llegan desde la migración 20261108 (pantalla_tv_listas); sin ellas, la TV sigue como antes
    const conListas = Array.isArray(d.espera) && Array.isArray(d.citas);
    $('.tv-listas').hidden = !conListas;
    if (!conListas) return;
    if (d.fecha && d.fecha !== fechaDatos) {      // cambio de día en la zona del negocio: se empieza de cero
        fechaDatos = d.fecha;
        Object.values(bloques).forEach(b => { b.pagina = 0; });
    }
    bloques.espera.filas = d.espera.map(filaEspera);
    bloques.citas.filas = d.citas.map(filaCita);
    bloques.espera.vacio = d.recepcion_abierta ? 'Nadie espera. Escanea el QR para tomar turno.' : 'Nadie espera.';
    bloques.citas.vacio = 'No quedan citas por hoy.';
    Object.values(bloques).forEach(pintarBloque);
}

// ---------- Fila sin cita y citas de hoy (paginadas, sin desplazamiento) ----------
const ESTADO_CITA = { reservada: 'Reservada', llego: 'Llegó', en_atencion: 'En atención' };
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
function filaEspera(e) {
    const datos = [];
    if (Number.isInteger(e.delante)) datos.push(e.delante === 0 ? 'Es el siguiente' : `${plural(e.delante, 'turno', 'turnos')} delante`);
    if (Number.isInteger(e.minutos)) datos.push(e.minutos <= 1 ? 'En breve' : `~${e.minutos} min`);
    // Sin posición ni estimación: «En espera» y lo que haya
    return `<li class="tv-fila en_espera"><span class="tv-fila-codigo">${esc(e.codigo)}</span>
        <span class="tv-fila-texto"><span class="tv-fila-dato">${esc(datos.join(' · ') || 'En espera')}</span>
        ${datos.length ? '<span class="tv-fila-estado">En espera</span>' : ''}</span></li>`;
}
function filaCita(c) {
    const estado = ESTADO_CITA[c.estado] || 'Reservada';
    return `<li class="tv-fila ${esc(c.estado)}"><span class="tv-fila-codigo">${esc(c.codigo)}</span>
        <span class="tv-fila-texto"><span class="tv-fila-dato">${esc(hora12(c.hora))}</span>
        <span class="tv-fila-estado">${esc(estado)}${c.silla ? ` · silla&nbsp;${Number(c.silla)}` : ''}</span></span></li>`;
}
// «16:00» (hora reservada, fija) -> «4:00 p. m.»
function hora12(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (!Number.isFinite(h)) return '';
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

const ROTACION = 8000;
let fechaDatos = '';
const bloques = Object.fromEntries(['espera', 'citas'].map(nombre => {
    const raiz = document.querySelector(`[data-bloque="${nombre}"]`);
    return [nombre, { nombre, raiz, lista: raiz.querySelector('[data-filas]'), indicador: raiz.querySelector('[data-pagina]'), filas: [], pagina: 0, vacio: '', html: '' }];
}));

// Cuántas filas caben en el alto disponible del bloque (en móvil la página crece: se usan 6)
function capacidad(b) {
    if (window.matchMedia('(max-width: 760px)').matches) return 6;
    const muestra = b.lista.querySelector('.tv-fila');
    const alto = b.lista.clientHeight;
    if (!muestra || !alto) return 6;
    const gap = parseFloat(getComputedStyle(b.lista).rowGap) || 0;
    return Math.max(1, Math.floor((alto + gap) / (muestra.offsetHeight + gap)));
}

function pintarBloque(b) {
    if (!b.filas.length) {
        poner(b, `<li class="tv-fila-vacia">${esc(b.vacio)}</li>`);
        b.indicador.hidden = true;
        return;
    }
    // Se mide con una fila real antes de repartir en páginas
    if (!b.lista.querySelector('.tv-fila')) poner(b, b.filas[0]);
    const porPagina = capacidad(b);
    const paginas = Math.ceil(b.filas.length / porPagina);
    b.pagina = Math.min(b.pagina, paginas - 1);
    poner(b, b.filas.slice(b.pagina * porPagina, (b.pagina + 1) * porPagina).join(''));
    b.indicador.hidden = paginas < 2;
    b.indicador.textContent = `${b.pagina + 1} de ${paginas}`;
}
function poner(b, html) {
    if (b.html === html) return;
    b.html = html;
    b.lista.innerHTML = html;
}
setInterval(() => Object.values(bloques).forEach(b => {
    if (b.filas.length < 2) return;
    const paginas = Math.ceil(b.filas.length / capacidad(b));
    if (paginas < 2) return;
    b.pagina = (b.pagina + 1) % paginas;
    pintarBloque(b);
}), ROTACION);
let redimension = null;
window.addEventListener('resize', () => { clearTimeout(redimension); redimension = setTimeout(() => Object.values(bloques).forEach(b => { b.html = ''; pintarBloque(b); }), 200); });

function pintarQR(url) {
    const caja = $('[data-qr]');
    if (typeof window.QRCode !== 'function') return;
    urlQR = url;
    caja.innerHTML = '';
    new window.QRCode(caja, { text: url, width: 220, height: 220, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
}

// «Jueves 12 de noviembre · 3:36 p. m.» en la hora del negocio (America/Santo_Domingo)
const ZONA = 'America/Santo_Domingo';
function reloj() {
    const ahora = new Date();
    const p = Object.fromEntries(new Intl.DateTimeFormat('es-DO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA })
        .formatToParts(ahora).map(x => [x.type, x.value]));
    const dia = `${p.weekday.charAt(0).toLocaleUpperCase('es') + p.weekday.slice(1)} ${p.day} de ${p.month}`;
    const hora = ahora.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA });
    $('[data-reloj]').innerHTML = `<span class="tv-fecha">${esc(dia)}</span><span class="tv-reloj-sep" aria-hidden="true"> · </span><span>${esc(hora)}</span>`;
    // Al cambiar el día en la zona del negocio se pide el estado nuevo enseguida
    if (diaReloj && diaReloj !== dia) actualizar();
    diaReloj = dia;
}
let diaReloj = '';

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
