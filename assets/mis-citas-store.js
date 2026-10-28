// Datos de «Mis citas» que se guardan en este navegador. Solo lo necesario para recuperar las reservas:
// los tokens secretos de gestión (y claves de solicitudes cuya respuesta no llegó), una copia del
// último listado para mostrarlo sin conexión y el borrador de la reserva. Nunca nombre ni teléfono.
import { hoyRD, horaRD } from './horario-utils.js';

const CLAVE = 'barberia-mis-citas';
const CLAVE_BORRADOR = 'barberia-borrador';
const MAX = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function almacen() {
    try { return globalThis.localStorage || null; } catch { return null; }
}
function leer(clave, vacio) {
    try {
        const valor = JSON.parse(almacen()?.getItem(clave) || 'null');
        return valor && typeof valor === 'object' ? valor : vacio;
    } catch { return vacio; }
}
function escribir(clave, valor) {
    try { almacen()?.setItem(clave, JSON.stringify(valor)); return true; } catch { return false; }
}

function estado() {
    const e = leer(CLAVE, {});
    return {
        tokens: Array.isArray(e.tokens) ? e.tokens.filter(t => UUID.test(t)) : [],
        // Solicitudes sin respuesta: se buscan durante 2 días
        claves: Array.isArray(e.claves) ? e.claves.filter(c => UUID.test(c?.clave) && Date.now() - Date.parse(c.en) < 2 * 864e5) : [],
        cache: Array.isArray(e.cache) ? e.cache : null,
        cache_en: e.cache_en || null
    };
}

export function nuevaClave() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function tokensGuardados() { return estado().tokens; }
export function clavesPendientes() { return estado().claves.map(c => c.clave); }

export function guardarToken(token) {
    if (!UUID.test(String(token))) return false;
    const e = estado();
    e.tokens = [token, ...e.tokens.filter(t => t !== token)].slice(0, MAX);
    return escribir(CLAVE, e);
}

// Solicitud enviada sin respuesta (p. ej. se cortó la conexión): se comprueba al abrir «Mis citas»
export function guardarClavePendiente(clave) {
    if (!UUID.test(String(clave))) return false;
    const e = estado();
    e.claves = [{ clave, en: new Date().toISOString() }, ...e.claves.filter(c => c.clave !== clave)].slice(0, 10);
    return escribir(CLAVE, e);
}

// Tras una consulta correcta: guarda los tokens encontrados y olvida los que ya no existen
export function sincronizar(citas, { tokensConsultados = [] } = {}) {
    const e = estado();
    const encontrados = new Set(citas.map(c => c.token));
    const resueltas = new Set(citas.map(c => c.clave_solicitud).filter(Boolean));
    const consultados = new Set(tokensConsultados);
    e.tokens = [...new Set([...citas.map(c => c.token), ...e.tokens.filter(t => !consultados.has(t) || encontrados.has(t))])]
        .filter(t => UUID.test(String(t))).slice(0, MAX);
    e.claves = e.claves.filter(c => !resueltas.has(c.clave));
    e.cache = citas.map(({ clave_solicitud, ...c }) => c);
    e.cache_en = new Date().toISOString();
    escribir(CLAVE, e);
}

export function citasEnCache() {
    const e = estado();
    return e.cache ? { citas: e.cache, actualizado: e.cache_en } : null;
}

// Añade o reemplaza una cita en la copia local (se muestra al instante tras reservar)
export function guardarEnCache(cita) {
    if (!cita?.token) return;
    const e = estado();
    e.cache = [cita, ...(e.cache || []).filter(c => c.token !== cita.token)];
    escribir(CLAVE, e);
}

export function olvidarTodo() {
    try { almacen()?.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
}

// Próximas: aún no terminan y siguen activas. Historial: el resto (pasadas, canceladas, completadas).
export function clasificar(citas, ahora = new Date()) {
    const hoy = hoyRD(ahora);
    const hora = horaRD(ahora);
    const activa = c => c.estado !== 'cancelada' && !c.completada && !c.no_asistio
        && (c.fecha > hoy || (c.fecha === hoy && (c.hora_fin || c.hora) > hora));
    const orden = (a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`);
    return {
        proximas: citas.filter(activa).sort(orden),
        historial: citas.filter(c => !activa(c)).sort((a, b) => orden(b, a))
    };
}

// ==========================================
// BORRADOR (selección sin reservar)
// ==========================================
export function leerBorrador() {
    const b = leer(CLAVE_BORRADOR, null);
    return b && b.servicio ? b : null;
}

// La clave de solicitud cambia cuando cambia la selección: un reintento de la MISMA selección no duplica
export function guardarBorrador(seleccion) {
    const anterior = leerBorrador();
    const mismo = anterior && ['servicio', 'barbero', 'fecha', 'hora'].every(k => (anterior[k] || '') === (seleccion[k] || ''));
    const borrador = { ...seleccion, clave: mismo && UUID.test(anterior.clave) ? anterior.clave : nuevaClave(), actualizado: new Date().toISOString() };
    if (!borrador.servicio) { borrarBorrador(); return null; }
    escribir(CLAVE_BORRADOR, borrador);
    return borrador;
}

export function borrarBorrador() {
    try { almacen()?.removeItem(CLAVE_BORRADOR); } catch { /* sin almacenamiento */ }
}

// ==========================================
// REFERENCIA DE ESTILO (publicación elegida como inspiración para la próxima reserva)
// Solo el identificador público de la publicación: sin datos personales ni tokens, y fuera de la URL.
// Se valida de nuevo en el servidor al mostrarla y al guardarla con la cita.
// ==========================================
const CLAVE_REFERENCIA = 'barberia-referencia-estilo';
export function leerReferencia() {
    const r = leer(CLAVE_REFERENCIA, null);
    // Una inspiración de hace más de 30 días ya no se recupera
    return r && UUID.test(r.trabajo_id) && Date.now() - Date.parse(r.guardada) < 30 * 864e5 ? r.trabajo_id : null;
}
export function guardarReferencia(trabajoId) {
    if (!UUID.test(trabajoId)) return false;
    return escribir(CLAVE_REFERENCIA, { trabajo_id: trabajoId, guardada: new Date().toISOString() });
}
export function borrarReferencia() {
    try { almacen()?.removeItem(CLAVE_REFERENCIA); } catch { /* sin almacenamiento */ }
}
