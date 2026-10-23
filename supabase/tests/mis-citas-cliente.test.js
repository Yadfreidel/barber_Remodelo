// Lógica del navegador para «Mis citas» y las horas: formato 12 h, franjas, zona de República Dominicana,
// almacenamiento local (borrador, tokens, copia) y clasificación próximas/historial.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { formato12h as f12, rango12h as r12, franja, cuadricula, hoyRD, horaRD, sumarMinutos, fechaLarga } from '../../assets/horario-utils.js';

// Las horas usan espacios no separables; se comparan como espacios normales
const sinNbsp = t => t.replace(/\u00a0/g, ' ');
const formato12h = h => sinNbsp(f12(h));
const rango12h = (a, b) => sinNbsp(r12(a, b));

class Almacen {
    constructor() { this.datos = new Map(); }
    getItem(k) { return this.datos.has(k) ? this.datos.get(k) : null; }
    setItem(k, v) { this.datos.set(k, String(v)); }
    removeItem(k) { this.datos.delete(k); }
}
globalThis.localStorage = new Almacen();
const store = await import('../../assets/mis-citas-store.js');
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { globalThis.localStorage = new Almacen(); });

test('formato de 12 horas con a. m./p. m. y franjas', () => {
    assert.ok(f12('08:00').includes('\u00a0'), 'no se parte en dos líneas');
    assert.equal(formato12h('08:00'), '8:00 a. m.');
    assert.equal(formato12h('12:00'), '12:00 p. m.');
    assert.equal(formato12h('13:30'), '1:30 p. m.');
    assert.equal(formato12h('21:30'), '9:30 p. m.');
    assert.equal(formato12h('00:15'), '12:15 a. m.');
    assert.equal(rango12h('08:00', '08:30'), '8:00 a. m. – 8:30 a. m.');
    assert.equal(sumarMinutos('21:30', 30), '22:00');
    assert.deepEqual(['08:00', '11:30', '12:00', '17:30', '18:00', '21:30'].map(franja), ['manana', 'manana', 'tarde', 'tarde', 'noche', 'noche']);
});

test('cuadrícula sin servidor: 08:00–22:00 cada 30 min, sin pasar del cierre', () => {
    const fecha = '2030-01-07';
    const corta = cuadricula({ abre: '08:00', cierra: '22:00', intervalo: 30, duracion: 30, fecha });
    assert.equal(corta.length, 28);
    assert.deepEqual(corta[0], { inicio: '08:00', fin: '08:30', estado: 'libre' });
    assert.deepEqual(corta.at(-1), { inicio: '21:30', fin: '22:00', estado: 'libre' });
    assert.equal(cuadricula({ duracion: 60, fecha }).at(-1).inicio, '21:00');
});

test('zona horaria de República Dominicana y horas pasadas', () => {
    // 01:30 UTC del 8 de enero = 21:30 del 7 de enero en Santo Domingo (UTC-4)
    const ahora = new Date('2030-01-08T01:30:00Z');
    assert.equal(hoyRD(ahora), '2030-01-07');
    assert.equal(horaRD(ahora), '21:30');
    const hoy = cuadricula({ duracion: 30, fecha: '2030-01-07', ahora });
    assert.equal(hoy.filter(h => h.estado === 'libre').length, 0, 'a las 21:30 ya no queda ninguna hora de inicio');
    const media = cuadricula({ duracion: 30, fecha: '2030-01-07', ahora: new Date('2030-01-07T16:10:00Z') }); // 12:10 en RD
    assert.equal(media.find(h => h.inicio === '12:00').estado, 'pasada');
    assert.equal(media.find(h => h.inicio === '12:30').estado, 'libre');
    assert.match(fechaLarga('2030-01-07'), /7/);
});

test('borrador: se conserva tras recargar y su clave solo cambia si cambia la selección', () => {
    const a = store.guardarBorrador({ servicio: 'Corte', barbero: 'Ana', fecha: '2030-01-07', hora: '10:00' });
    assert.deepEqual(store.leerBorrador().servicio, 'Corte');
    const b = store.guardarBorrador({ servicio: 'Corte', barbero: 'Ana', fecha: '2030-01-07', hora: '10:00' });
    assert.equal(b.clave, a.clave, 'mismo intento: misma clave (sin duplicados al reintentar)');
    const c = store.guardarBorrador({ servicio: 'Corte', barbero: 'Ana', fecha: '2030-01-07', hora: '10:30' });
    assert.notEqual(c.clave, a.clave);
    assert.ok(!('telefono' in c) && !('nombre' in c), 'no guarda datos personales');
    store.borrarBorrador();
    assert.equal(store.leerBorrador(), null);
});

test('tokens: se guardan sin duplicar, se validan y se olvidan si ya no existen', () => {
    assert.equal(store.guardarToken('no-es-un-token'), false);
    store.guardarToken(T1);
    store.guardarToken(T2);
    store.guardarToken(T1);
    assert.deepEqual(store.tokensGuardados(), [T1, T2]);
    store.sincronizar([{ token: T1, fecha: '2030-01-07', hora: '10:00', estado: 'pendiente' }], { tokensConsultados: [T1, T2] });
    assert.deepEqual(store.tokensGuardados(), [T1]);
    assert.equal(store.citasEnCache().citas.length, 1);
});

test('solicitud sin respuesta: la clave se busca hasta que aparece la cita', () => {
    store.guardarClavePendiente(T2);
    assert.deepEqual(store.clavesPendientes(), [T2]);
    store.sincronizar([], { tokensConsultados: [] });
    assert.deepEqual(store.clavesPendientes(), [T2], 'sin cita todavía: se sigue buscando');
    store.sincronizar([{ token: T1, clave_solicitud: T2, fecha: '2030-01-07', hora: '10:00', estado: 'pendiente' }]);
    assert.deepEqual(store.clavesPendientes(), []);
    assert.deepEqual(store.tokensGuardados(), [T1]);
    assert.ok(!('clave_solicitud' in store.citasEnCache().citas[0]));
});

test('almacenamiento corrupto o bloqueado no rompe la app', () => {
    globalThis.localStorage.setItem('barberia-mis-citas', '{no es json');
    assert.deepEqual(store.tokensGuardados(), []);
    globalThis.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
    assert.deepEqual(store.tokensGuardados(), []);
    assert.equal(store.guardarToken(T1), false);
    assert.equal(store.leerBorrador(), null);
    store.borrarBorrador();
});

test('próximas e historial', () => {
    const ahora = new Date('2030-01-07T14:00:00Z'); // 10:00 en RD
    const base = { servicio: 'Corte', barbero: 'Ana' };
    const { proximas, historial } = store.clasificar([
        { ...base, token: 'a', fecha: '2030-01-07', hora: '09:30', hora_fin: '10:30', estado: 'confirmada' }, // en curso
        { ...base, token: 'b', fecha: '2030-01-08', hora: '08:00', hora_fin: '08:30', estado: 'pendiente' },
        { ...base, token: 'c', fecha: '2030-01-09', hora: '08:00', hora_fin: '08:30', estado: 'cancelada' },
        { ...base, token: 'd', fecha: '2030-01-06', hora: '08:00', hora_fin: '08:30', estado: 'confirmada' },
        { ...base, token: 'e', fecha: '2030-01-07', hora: '08:00', hora_fin: '08:30', estado: 'confirmada', completada: true }
    ], ahora);
    assert.deepEqual(proximas.map(c => c.token), ['a', 'b']);
    assert.deepEqual(historial.map(c => c.token), ['c', 'e', 'd']);
});
