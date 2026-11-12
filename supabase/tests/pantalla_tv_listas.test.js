// Pantalla de turnos ampliada (fila sin cita y citas de hoy), contra PostgreSQL real:
// mismos cálculos que la Fila virtual, código de cita igual al del comprobante y del detalle del cliente,
// estados reales de «Atención», retiro de canceladas y terminadas, cambio de día y nada de datos personales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ISAAC = '55555555-5555-5555-5555-555555555555';
let db, A, anon, anon2, admin, isaac, ids, F, F2;
const conexiones = [];

const reservar = (hora, barbero, nombre, tel) =>
    rpc(anon, 'reservar_cita', nombre, null, tel, 'Corte 30', barbero, F, hora, '[]', null, false, null, randomUUID());
const citaId = async token => (await A.query('select cita_id from cita_tokens where token = $1', [token])).rows[0].cita_id;
async function reloj(fecha, hora) {
    for (const c of conexiones) await c.query(`select set_config('barberia.fila_reloj', $1, false)`, [`${fecha} ${hora}`]);
}

before(async () => {
    db = await iniciarBase(54364);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Isaac'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30)`);
    await db.migrar();
    await A.query(`update servicios set en_catalogo = true, activo = true`);
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'isaac@x.com')`, [ADMIN, ISAAC]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    admin = await db.conexion('authenticated', ADMIN);
    isaac = await db.conexion('authenticated', ISAAC);
    anon = await db.conexion('anon');
    anon2 = await db.conexion('anon');
    conexiones.push(A, admin, isaac, anon, anon2);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Isaac') isaac, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from servicios where nombre = 'Corte 30') corte`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.isaac, 'isaac@x.com');
    await rpc(admin, 'panel_fila_sillas_guardar', JSON.stringify({ [ids.isaac]: 2 }));
    await rpc(admin, 'panel_fila_config', JSON.stringify({ recepcion_abierta: true }));
    F = await fechaLocal(A, 2);
    F2 = await fechaLocal(A, 3);
});

after(() => db?.cerrar());

test('fila sin cita: orden de llegada, turnos delante y espera de la Fila virtual; se actualiza en cada cambio', async () => {
    await reloj(F, '09:00');
    const vacia = await rpc(anon, 'fila_pantalla');
    assert.deepEqual([vacia.espera, vacia.citas, vacia.fecha], [[], [], F]);

    const t1 = await rpc(anon, 'fila_tomar_turno', ids.corte, ids.isaac, randomUUID());   // espera por Isaac
    const t2 = await rpc(anon2, 'fila_tomar_turno', ids.corte, null, randomUUID());       // primero disponible
    const t3 = await rpc(anon, 'fila_tomar_turno', ids.corte, ids.isaac, randomUUID());   // detrás de t1 por Isaac
    const tv = await rpc(anon2, 'fila_pantalla');
    assert.deepEqual(tv.espera.map(e => e.codigo), [t1.codigo, t2.codigo, t3.codigo]);
    for (const e of tv.espera) assert.deepEqual(Object.keys(e).sort(), ['codigo', 'delante', 'estado', 'minutos']);
    // Lo mismo que ve cada cliente en su celular (posición y espera mínima)
    for (const t of [t1, t2, t3]) {
        const cel = await rpc(anon, 'fila_turno', t.token);
        const fila = tv.espera.find(e => e.codigo === t.codigo);
        assert.equal(fila.delante, cel.delante, `delante de ${t.codigo}`);
        assert.equal(fila.minutos, cel.espera?.min ?? null, `minutos de ${t.codigo}`);
        assert.equal(fila.estado, 'en_espera');
    }
    assert.equal(tv.espera[0].delante, 0);
    assert.equal(tv.espera[2].delante, 2, 't3 compite por Isaac con t1 y con t2 (primero disponible)');
    assert.ok(tv.espera[2].minutos > tv.espera[0].minutos, 'el que espera por Isaac detrás de t1 tarda más');
    assert.equal(tv.en_espera, 3);

    // Llamar: sale de la espera y aparece como llamado (silla 2); los demás avanzan
    await rpc(isaac, 'panel_fila_llamar', null);
    const llam = await rpc(anon, 'fila_pantalla');
    assert.deepEqual(llam.llamados.map(l => [l.codigo, l.silla]), [[t1.codigo, 2]]);
    assert.deepEqual(llam.espera.map(e => e.codigo), [t2.codigo, t3.codigo]);
    assert.equal(llam.espera.find(e => e.codigo === t3.codigo).delante, 1);

    // En servicio, finalizar y salir de la fila: ninguno vuelve a la lista de espera
    const id1 = (await A.query('select id from fila_turnos where token = $1', [t1.token])).rows[0].id;
    await rpc(isaac, 'panel_fila_iniciar', id1);
    const id2 = (await A.query('select id from fila_turnos where token = $1', [t2.token])).rows[0].id;
    await rpc(admin, 'panel_fila_cerrar', id2, 'salio');
    const tras = await rpc(anon, 'fila_pantalla');
    assert.deepEqual([tras.llamados, tras.espera.map(e => e.codigo)], [[], [t3.codigo]]);
    assert.ok(tras.espera[0].minutos >= 25, 'Isaac está ocupado con el servicio en curso: la espera lo refleja');
    await rpc(isaac, 'panel_fila_cerrar', id1, 'finalizar');
    await rpc(anon, 'fila_salir', t3.token);
    assert.deepEqual((await rpc(anon, 'fila_pantalla')).espera, []);
});

test('citas de hoy: confirmadas por hora con el código del comprobante; llegó, en atención y retiro de canceladas y terminadas', async () => {
    await reloj(F, '09:00');
    const r1 = await reservar('15:00', 'Isaac', 'Ana Privada', '8095550801');
    const r2 = await reservar('11:00', 'Beto', 'Luis Privado', '8095550802');
    const r3 = await reservar('12:00', 'Isaac', 'Marta Privada', '8095550803');
    const r4 = await reservar('13:00', 'Beto', 'Pendiente Privada', '8095550804');   // queda pendiente: no se muestra
    const [c1, c2, c3] = [await citaId(r1.token), await citaId(r2.token), await citaId(r3.token)];
    for (const c of [c1, c2, c3]) await rpc(admin, 'panel_actualizar_cita', c, 'confirmar', '{}');

    let tv = await rpc(anon, 'fila_pantalla');
    assert.deepEqual(tv.citas.map(c => [c.hora, c.estado]), [['11:00', 'reservada'], ['12:00', 'reservada'], ['15:00', 'reservada']]);
    for (const c of tv.citas) assert.deepEqual(Object.keys(c).sort(), ['codigo', 'estado', 'hora', 'silla']);

    // El código coincide con la confirmación (reservar_cita) y el detalle del cliente (consultar_cita)
    const det = await rpc(anon2, 'consultar_cita', r1.token);
    assert.match(det.referencia, /^C-\d{5}$/);
    assert.equal(det.referencia, r1.cita.referencia);
    assert.equal(tv.citas[2].codigo, det.referencia);
    assert.equal(tv.citas[0].codigo, (await rpc(anon2, 'consultar_cita', r2.token)).referencia);

    // Llegó y en atención (con la silla del barbero); terminada y cancelada salen de la lista
    await A.query('update citas set llegada_en = now() where id::text = $1', [c3]);
    await A.query('update citas set llegada_en = now(), iniciada_en = now() where id::text = $1', [c1]);
    tv = await rpc(anon, 'fila_pantalla');
    assert.deepEqual(tv.citas.map(c => [c.hora, c.estado, c.silla]), [['11:00', 'reservada', null], ['12:00', 'llego', null], ['15:00', 'en_atencion', 2]]);
    await A.query('update citas set completada_en = now() where id::text = $1', [c1]);
    await rpc(anon, 'cancelar_cita', r2.token);
    tv = await rpc(anon, 'fila_pantalla');
    assert.deepEqual(tv.citas.map(c => [c.hora, c.estado]), [['12:00', 'llego']]);

    // Privacidad: nada de nombres, teléfonos, tokens, ids internos, notas ni fotos
    const texto = JSON.stringify(tv);
    const id4 = await citaId(r4.token);
    for (const prohibido of ['Privad', '809555', r1.token, r3.token, 'token', 'nombre', 'telefono', 'nota', 'foto', 'barbero', `"${c3}"`, `"${id4}"`]) {
        assert.ok(!texto.includes(prohibido), prohibido);
    }

    // Cambio de día en la zona del negocio: la TV muestra solo lo del día nuevo
    await reloj(F2, '08:00');
    const manana = await rpc(anon, 'fila_pantalla');
    assert.deepEqual([manana.fecha, manana.citas, manana.espera, manana.en_espera], [F2, [], [], 0]);
});

test('la TV no gana permisos: las funciones internas no se pueden llamar y el código no abre la cita', async () => {
    for (const fn of ['_cita_codigo', '_pantalla_espera', '_pantalla_citas']) {
        assert.match(await errorDe(anon.query(`select private.${fn}(null)`)), /permission denied|does not exist/);
    }
    // consultar_cita exige el token; un código C-xxxxx no sirve
    assert.ok(await errorDe(rpc(anon, 'consultar_cita', 'C-00001')));
    // Una cita antigua (sin datos nuevos) se lee igual que antes y recibe su código
    const antigua = (await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado)
        values ('Antigua', '8095550899', $1, $2, $3, '10:00', 'confirmada') returning id::text`, [ids.beto, ids.corte, F])).rows[0].id;
    await reloj(F, '09:00');
    const tv = await rpc(anon, 'fila_pantalla');
    assert.ok(tv.citas.some(c => c.codigo === `C-${antigua.padStart(5, '0')}` && c.hora === '10:00' && c.estado === 'reservada'));
});
