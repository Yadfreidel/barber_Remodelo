// Horas de la barbería: siempre en America/Santo_Domingo, sin depender de la zona del dispositivo.
export const ZONA = 'America/Santo_Domingo';

function partes(fecha = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(fecha).map(x => [x.type, x.value]));
    return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

// 'YYYY-MM-DD' y 'HH:MM' actuales en República Dominicana
export function hoyRD(ahora) { return partes(ahora).fecha; }
export function horaRD(ahora) { return partes(ahora).hora; }

function minutos(hhmm) {
    const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
}
function hhmm(total) {
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// '08:00' -> '8:00 a. m.'; '13:30' -> '1:30 p. m.' (espacios no separables: la hora no se parte en dos líneas)
export function formato12h(hora) {
    const total = minutos(hora);
    const h = Math.floor(total / 60) % 24;
    return `${h % 12 || 12}:${String(total % 60).padStart(2, '0')}\u00a0${h < 12 ? 'a.\u00a0m.' : 'p.\u00a0m.'}`;
}

export function rango12h(inicio, fin) {
    return fin ? `${formato12h(inicio)} – ${formato12h(fin)}` : formato12h(inicio);
}

export function sumarMinutos(hora, duracion) {
    return hhmm(minutos(hora) + Number(duracion || 0));
}

// Mañana: antes de 12:00; tarde: 12:00–17:59; noche: desde 18:00
export function franja(hora) {
    const total = minutos(hora);
    return total < 12 * 60 ? 'manana' : total < 18 * 60 ? 'tarde' : 'noche';
}

export const FRANJAS = [['manana', 'Mañana'], ['tarde', 'Tarde'], ['noche', 'Noche']];

// Cuadrícula sin servidor (solo modo solicitud): inicios cada `intervalo` que terminan antes del cierre
export function cuadricula({ abre = '08:00', cierra = '22:00', intervalo = 30, duracion = 30, fecha, ahora = new Date() }) {
    const pasado = fecha === hoyRD(ahora) ? horaRD(ahora) : null;
    const lista = [];
    for (let t = minutos(abre); t + Number(duracion) <= minutos(cierra); t += Number(intervalo)) {
        const inicio = hhmm(t);
        lista.push({ inicio, fin: hhmm(t + Number(duracion)), estado: pasado && inicio <= pasado ? 'pasada' : 'libre' });
    }
    return lista;
}

// 'YYYY-MM-DD' -> 'sáb, 25 oct 2026' (la fecha es del calendario local de la barbería)
export function fechaLarga(fecha) {
    const [a, m, d] = String(fecha).split('-').map(Number);
    return new Intl.DateTimeFormat('es-DO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(a, m - 1, d)));
}
