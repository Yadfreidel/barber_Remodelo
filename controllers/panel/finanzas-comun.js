// ==========================================
// PANEL: utilidades de Inventario, Ventas y Caja
// Las operaciones financieras llevan una clave única: si se reintenta (doble clic,
// conexión caída, recarga) el servidor devuelve el resultado ya guardado.
// Nada se da por confirmado sin respuesta del servidor.
// ==========================================

import { esc, hoyLocal, sumarDias, inicioSemana, inicioMes, finMes } from './comun.js';

export const METODOS_PAGO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro (no efectivo)', mixto: 'Mixto' };
export const CATEGORIAS_GASTO = {
    compra_mercancia: 'Pago de compras de mercancía', alquiler: 'Alquiler', servicios: 'Servicios (luz, agua, internet)',
    nomina: 'Nómina y pagos al personal', mantenimiento: 'Mantenimiento', limpieza: 'Limpieza', publicidad: 'Publicidad',
    impuestos_tasas: 'Impuestos y tasas', otros: 'Otros'
};
export const MEDIOS_GASTO = { efectivo_caja: 'Efectivo de la caja', efectivo_externo: 'Efectivo fuera de caja', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
export const UNIDADES = { unidad: 'unidad', par: 'par', ml: 'ml', l: 'litro', g: 'g', kg: 'kg' };
export const TIPOS_MOVIMIENTO = {
    inicial: 'Existencia inicial', compra: 'Compra recibida', venta: 'Venta', consumo: 'Consumo interno', devolucion: 'Devolución',
    perdida: 'Pérdida o daño', ajuste: 'Ajuste por conteo', reserva: 'Reserva web', reserva_liberada: 'Reserva liberada', anulacion: 'Anulación'
};
export const ESTADOS_PAGO = { pendiente: 'Pago pendiente', parcial: 'Pago parcial', pagada: 'Pagada', reembolsada: 'Reembolsada', anulada: 'Anulada' };

export function nuevaClave() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Redondeo a centavos (mismo criterio que el servidor: medio centavo hacia arriba)
export function centavos(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const PLURALES = { unidad: 'unidades', par: 'pares', l: 'litros' };

export function cantidad(n, unidad) {
    const valor = Number(n || 0).toLocaleString('es-DO', { maximumFractionDigits: 3 });
    if (!unidad) return valor;
    return `${valor} ${Math.abs(Number(n)) !== 1 && PLURALES[unidad] ? PLURALES[unidad] : UNIDADES[unidad] || unidad}`;
}

// Las operaciones con dinero requieren conexión: nunca se guardan solo en el teléfono
export function exigirConexion() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Sin conexión: esta operación necesita conexión y NO se ha registrado.');
    }
}

export function chipPago(estado) {
    const clase = { pagada: 'estado-confirmada', parcial: 'estado-pendiente', pendiente: 'estado-pendiente', reembolsada: 'estado-cancelada', anulada: 'estado-cancelada' }[estado] || '';
    return `<span class="estado-chip ${clase}">${esc(ESTADOS_PAGO[estado] || estado)}</span>`;
}

// ---------- Periodos de los reportes ----------
export const PERIODOS = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', mes_anterior: 'Mes anterior', personalizado: 'Rango de fechas' };

export function rangoPeriodo(periodo) {
    const hoy = hoyLocal();
    if (periodo.tipo === 'hoy') return [hoy, hoy];
    if (periodo.tipo === 'semana') return [inicioSemana(hoy), sumarDias(inicioSemana(hoy), 6)];
    if (periodo.tipo === 'mes') return [inicioMes(hoy), finMes(hoy)];
    if (periodo.tipo === 'mes_anterior') { const ant = sumarDias(inicioMes(hoy), -1); return [inicioMes(ant), finMes(ant)]; }
    return [periodo.desde || inicioMes(hoy), periodo.hasta || hoy];
}

export function filtrosPeriodo(periodo, [desde, hasta]) {
    return `<select data-periodo aria-label="Periodo">${Object.entries(PERIODOS)
            .map(([k, v]) => `<option value="${k}" ${periodo.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input type="date" data-desde value="${desde}" ${periodo.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Desde">
        <input type="date" data-hasta value="${hasta}" ${periodo.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Hasta">`;
}

export function conectarPeriodo(cont, periodo, alCambiar) {
    cont.querySelector('[data-periodo]').addEventListener('change', e => { periodo.tipo = e.target.value; alCambiar(); });
    ['desde', 'hasta'].forEach(k => cont.querySelector(`[data-${k}]`).addEventListener('change', e => { periodo[k] = e.target.value; alCambiar(); }));
}

// Solo la carga más reciente de una sección pinta su resultado (cambiar de periodo o de sección a mitad de una carga)
export function turnoDe(cont) {
    const turno = String(Math.random());
    cont.dataset.turno = turno;
    return () => cont.dataset.turno === turno && cont.isConnected;
}

// Lee un número de un campo; vacío = null
export function numero(campo) {
    const texto = String(campo?.value ?? '').trim().replace(',', '.');
    return texto === '' ? null : Number(texto);
}
