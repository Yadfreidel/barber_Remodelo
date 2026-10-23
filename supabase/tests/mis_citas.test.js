// «Mis citas» y horarios cada 30 minutos contra PostgreSQL real: horario 08:00–22:00, duración frente a
// intervalo, solapamientos por barbero, cierre, concurrencia, cancelaciones, idempotencia y privacidad.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRACIONES = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const NUEVA = '20261024000000_mis_citas_horarios_30.sql';
const ADMIN = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const OTRO = '33333333-3333-3333-3333-333333333333';
let db, A, anon, admin, cliente, otro, f, legado;

const reservar = (cli, servicio, barbero, fecha, hora, clave = null, tel = '8095550100') =>
    rpc(cli, 'reservar_cita', 'Cliente Web', null, tel, servicio, barbero, fecha, hora, '[]', null, false, null, clave);
const horas = async (servicio, barbero, fecha) => (await rpc(anon, 'horarios_dia_publico', servicio, barbero, fecha));
const libres = async (...a) => (await horas(...a)).horas.filter(h => h.estado === 'libre').map(h => h.inicio);
const porTokens = (cli, tokens, claves = []) => rpc(cli, 'mis_citas_por_tokens', tokens, claves);
const panel = (id, accion, datos = {}) => rpc(admin, 'panel_actualizar_cita', id, accion, JSON.stringify(datos));

before(async () => {
    db = await iniciarBase(54340);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30), ('Corte 60', 700, 60), ('Combo 90', 1200, 90)`);
    // Instalación anterior (sin esta migración) con datos que la migración debe respetar
    for (const m of MIGRACIONES.filter(m => m < NUEVA)) await A.query(fs.readFileSync(path.join(DIR, m), 'utf8'));
    const fecha = await fechaLocal(A, 9);
    const { rows: [c] } = await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora)
        select 'Antigua', '8095550000', b.id, s.id, $1, '10:00' from barberos b, servicios s where b.nombre = 'Ana' and s.nombre = 'Corte 60'
        returning id`, [fecha]);
    await A.query('alter table citas disable trigger user');
    await A.query('update citas set duracion_reservada = null where id = $1', [c.id]);
    await A.query('alter table citas enable trigger user');
    await A.query(`insert into horarios_semana (barbero_id, dia, activo, abre, cierra) values
        ('*', 1, true, '09:00', '20:00'), ('*', 0, false, '09:00', '20:00'), ('*', 6, true, '10:00', '14:00'),
        ((select id::text from barberos where nombre = 'Beto'), 1, true, '09:00', '20:00')`);
    legado = { id: String(c.id), fecha };
    await A.query(fs.readFileSync(path.join(DIR, NUEVA), 'utf8'));

    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'cliente@x.com'), ($3, 'otro@x.com')`, [ADMIN, CLIENTE, OTRO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    cliente = await db.conexion('authenticated', CLIENTE);
    otro = await db.conexion('authenticated', OTRO);
});

after(() => db?.cerrar());

beforeEach(async () => {
    await A.query('delete from cita_tokens where cita_id <> $1', [legado.id]);
    await A.query('delete from citas where id::text <> $1', [legado.id]);
    await A.query('delete from horarios_semana; delete from descansos; delete from bloqueos');
    f = await fechaLocal(A, 3);
});

test('migración: horario 08:00–22:00 cada 30 min, citas antiguas con fin y horarios especiales intactos', async () => {
    const { rows: [g] } = await A.query(`select ajustes from modulos_config where modulo = 'general'`);
    assert.equal(g.ajustes.hora_apertura, '08:00');
    assert.equal(g.ajustes.hora_cierre, '22:00');
    assert.equal(g.ajustes.intervalo_minutos, 30);
    const { rows: [c] } = await A.query('select duracion_reservada, nombre_cliente, hora::text from citas where id = $1', [legado.id]);
    assert.deepEqual(c, { duracion_reservada: 60, nombre_cliente: 'Antigua', hora: '10:00:00' }, 'la cita antigua conserva sus datos y recibe su duración');
    assert.equal((await A.query('select count(*)::int n from citas where duracion_reservada is null')).rows[0].n, 0);
});

test('migración: solo el horario semanal general de fábrica pasa a 08:00–22:00', async () => {
    // Recreado aquí porque beforeEach limpia la tabla: se vuelve a aplicar la migración sobre estos datos
    await A.query(`insert into horarios_semana (barbero_id, dia, activo, abre, cierra) values
        ('*', 1, true, '09:00', '20:00'), ('*', 0, false, '09:00', '20:00'), ('*', 6, true, '10:00', '14:00'),
        ((select id::text from barberos where nombre = 'Beto'), 1, true, '09:00', '20:00')`);
    await A.query(fs.readFileSync(path.join(DIR, NUEVA), 'utf8'));
    const { rows } = await A.query(`select barbero_id = '*' general, dia, activo, abre::text, cierra::text from horarios_semana order by general desc, dia`);
    assert.deepEqual(rows, [
        { general: true, dia: 0, activo: false, abre: '09:00:00', cierra: '20:00:00' },
        { general: true, dia: 1, activo: true, abre: '08:00:00', cierra: '22:00:00' },
        { general: true, dia: 6, activo: true, abre: '10:00:00', cierra: '14:00:00' },
        { general: false, dia: 1, activo: true, abre: '09:00:00', cierra: '20:00:00' }]);
});

test('horas de inicio cada 30 min; la duración del servicio define el fin y el cierre', async () => {
    const corto = await horas('Corte 30', 'Ana', f);
    assert.equal(corto.horas.length, 28);
    assert.deepEqual(corto.horas[0], { inicio: '08:00', fin: '08:30', estado: 'libre' });
    assert.deepEqual(corto.horas[1], { inicio: '08:30', fin: '09:00', estado: 'libre' });
    assert.deepEqual(corto.horas.at(-1), { inicio: '21:30', fin: '22:00', estado: 'libre' });
    const largo = await horas('Corte 60', 'Ana', f);
    assert.equal(largo.horas.at(-1).inicio, '21:00', 'un servicio de 60 min no empieza a las 21:30');
    assert.equal(largo.horas.at(-1).fin, '22:00');
    assert.equal((await horas('Combo 90', 'Ana', f)).horas.at(-1).inicio, '20:30');
    assert.equal(await errorDe(reservar(anon, 'Corte 60', 'Ana', f, '21:30')), 'horario_no_disponible', 'no termina después de las 22:00');
    assert.equal(await errorDe(reservar(anon, 'Corte 30', 'Ana', f, '08:15')), 'horario_no_disponible', 'solo horas de la cuadrícula');
    assert.equal(await errorDe(reservar(anon, 'Corte 30', 'Ana', f, '07:30')), 'horario_no_disponible');
    await reservar(anon, 'Corte 30', 'Ana', f, '21:30');
});

test('un servicio de 60 min a las 08:00 bloquea 08:30 solo para ese barbero', async () => {
    await reservar(anon, 'Corte 60', 'Ana', f, '08:00');
    const ana = await libres('Corte 30', 'Ana', f);
    assert.ok(!ana.includes('08:00') && !ana.includes('08:30') && ana.includes('09:00'));
    assert.ok((await libres('Corte 30', 'Beto', f)).includes('08:30'), 'Beto sigue libre');
    assert.equal(await errorDe(reservar(anon, 'Corte 30', 'Ana', f, '08:30', null, '8095550101')), 'horario_no_disponible');
    // Un servicio que empezaría antes y se solaparía con el inicio también se rechaza
    await reservar(anon, 'Corte 30', 'Ana', f, '10:30');
    assert.equal(await errorDe(reservar(anon, 'Corte 60', 'Ana', f, '10:00', null, '8095550102')), 'horario_no_disponible');
    await reservar(anon, 'Corte 30', 'Beto', f, '08:30', null, '8095550103');
});

test('horas pasadas de hoy (hora de República Dominicana)', async () => {
    const hoy = await fechaLocal(A, 0);
    const { rows: [{ ahora }] } = await A.query(`select to_char(_ahora_local(), 'HH24:MI') ahora`);
    for (const h of (await horas('Corte 30', 'Ana', hoy)).horas) {
        assert.equal(h.estado === 'pasada', h.inicio <= ahora, `${h.inicio} frente a ${ahora}`);
    }
});

test('días cerrados, descansos y bloqueos configurados se respetan', async () => {
    const dow = Number((await A.query('select extract(dow from $1::date)::int d', [f])).rows[0].d);
    await A.query(`insert into horarios_semana (barbero_id, dia, activo, abre, cierra) values ('*', $1, false, '08:00', '22:00')`, [dow]);
    const cerrado = await horas('Corte 30', 'Ana', f);
    assert.equal(cerrado.abierto, false);
    assert.equal(cerrado.horas.length, 0);
    await A.query('delete from horarios_semana');
    await A.query(`insert into descansos (barbero_id, dia, desde, hasta) values (null, $1, '12:00', '13:00')`, [dow]);
    await A.query(`insert into bloqueos (barbero_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, tipo)
                   values ((select id::text from barberos where nombre = 'Ana'), $1, $1, '15:00', '16:00', 'bloqueo')`, [f]);
    const ana = await libres('Corte 30', 'Ana', f);
    for (const h of ['12:00', '12:30', '15:00', '15:30']) assert.ok(!ana.includes(h), h);
    assert.ok(ana.includes('11:30') && ana.includes('13:00') && ana.includes('16:00'));
    assert.ok(!(await libres('Corte 60', 'Ana', f)).includes('11:30'), 'un servicio que invadiría el descanso no se ofrece');
    assert.ok((await libres('Corte 30', 'Beto', f)).includes('15:00'), 'el bloqueo de Ana no afecta a Beto');
});

test('reservas simultáneas solapadas: solo una se guarda', async () => {
    const c1 = await db.conexion('anon');
    const c2 = await db.conexion('anon');
    const resultados = await Promise.allSettled([
        reservar(c1, 'Corte 60', 'Ana', f, '09:00', null, '8095550201'),
        reservar(c2, 'Corte 30', 'Ana', f, '09:30', null, '8095550202')]);
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(resultados.find(r => r.status === 'rejected').reason.message, /horario_no_disponible|23505/);
    assert.equal((await A.query(`select count(*)::int n from citas where fecha = $1 and estado <> 'cancelada'`, [f])).rows[0].n, 1);
});

test('una cita cancelada libera su espacio', async () => {
    const r = await reservar(anon, 'Corte 60', 'Ana', f, '11:00');
    assert.ok(!(await libres('Corte 30', 'Ana', f)).includes('11:30'));
    await panel(r.cita_id, 'cancelar', { motivo: 'Cliente avisó' });
    assert.ok((await libres('Corte 30', 'Ana', f)).includes('11:30'));
    await reservar(anon, 'Corte 30', 'Ana', f, '11:30', null, '8095550301');
});

test('reserva idempotente: el reintento de la misma solicitud no duplica', async () => {
    const clave = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const a = await reservar(anon, 'Corte 30', 'Ana', f, '14:00', clave);
    const b = await reservar(anon, 'Corte 30', 'Ana', f, '14:00', clave);
    assert.equal(b.cita_id, a.cita_id);
    assert.equal(b.token, a.token);
    assert.equal(a.repetida, false);
    assert.equal(b.repetida, true);
    assert.equal(a.cita.estado, 'pendiente');
    assert.equal(a.cita.hora_fin, '14:30');
    assert.equal((await A.query(`select count(*)::int n from citas where fecha = $1`, [f])).rows[0].n, 1);
    assert.equal(await errorDe(reservar(anon, 'Corte 30', 'Ana', f, '15:00', clave)), 'solicitud_ya_usada');
    // Si la respuesta se perdió, la clave recupera la cita y su token
    const [rec] = await porTokens(anon, [], [clave]);
    assert.equal(rec.token, a.token);
    assert.equal(rec.clave_solicitud, clave);
});

test('Mis citas por token: estado al día, sin datos personales ni citas ajenas', async () => {
    const mia = await reservar(anon, 'Corte 30', 'Ana', f, '16:00', null, '8095550401');
    const ajena = await reservar(anon, 'Corte 30', 'Beto', f, '16:00', null, '8095550402');
    let [c] = await porTokens(anon, [mia.token]);
    assert.equal(c.estado, 'pendiente');
    assert.deepEqual(Object.keys(c).sort(), ['barbero', 'clave_solicitud', 'cliente_confirmo', 'completada', 'creado_en', 'duracion_minutos',
        'estado', 'fecha', 'hora', 'hora_fin', 'modificable', 'no_asistio', 'precio', 'servicio', 'token']);
    assert.equal(c.precio, 500);
    await panel(mia.cita_id, 'confirmar');
    [c] = await porTokens(anon, [mia.token]);
    assert.equal(c.estado, 'confirmada');
    assert.deepEqual(await porTokens(anon, ['7c9e6679-7425-40de-944b-e07fc1f90ae7']), [], 'un token inventado no devuelve nada');
    assert.equal((await porTokens(anon, [mia.token])).length, 1, 'solo la cita del token enviado');
    assert.ok(!(await porTokens(anon, [mia.token])).some(x => x.token === ajena.token));
    // En public la RLS deja 0 filas; en barberia además se revoca el SELECT (ver base_completa.test.js)
    assert.equal((await anon.query('select * from citas')).rowCount, 0);
    assert.match(await errorDe(anon.query('select * from cita_tokens')), /permission denied/);
    assert.match(await errorDe(rpc(anon, 'mis_citas')), /permission denied/);
    assert.equal(await errorDe(porTokens(anon, Array.from({ length: 101 }, () => mia.token))), 'demasiadas_citas');
});

test('cuenta del cliente: solo sus citas (función y RLS); vinculación por token', async () => {
    const conCuenta = await reservar(cliente, 'Corte 30', 'Ana', f, '17:00', null, '8095550501');
    const invitado = await reservar(anon, 'Corte 30', 'Ana', f, '18:00', null, '8095550502');
    const deOtro = await reservar(otro, 'Corte 30', 'Beto', f, '17:00', null, '8095550503');
    assert.deepEqual((await rpc(cliente, 'mis_citas')).map(c => c.token), [conCuenta.token]);
    assert.deepEqual((await rpc(otro, 'mis_citas')).map(c => c.token), [deOtro.token]);
    assert.deepEqual((await cliente.query('select id::text from citas')).rows.map(r => r.id), [conCuenta.cita_id], 'RLS: solo sus filas');

    assert.equal(await rpc(cliente, 'vincular_citas', [invitado.token]), 1);
    assert.deepEqual((await rpc(cliente, 'mis_citas')).map(c => c.token).sort(), [conCuenta.token, invitado.token].sort());
    assert.equal(await rpc(otro, 'vincular_citas', [conCuenta.token, invitado.token]), 0, 'no se apropia de citas ya vinculadas');
    assert.deepEqual((await rpc(otro, 'mis_citas')).map(c => c.token), [deOtro.token]);

    await panel(conCuenta.cita_id, 'completar');
    const [c] = (await rpc(cliente, 'mis_citas')).filter(x => x.token === conCuenta.token);
    assert.equal(c.completada, true);
});

test('panel: agenda y creación de citas siguen funcionando con la cuadrícula de 30 min', async () => {
    const ids = (await A.query(`select (select id::text from barberos where nombre = 'Ana') ana, (select id::text from servicios where nombre = 'Corte 60') s`)).rows[0];
    const creada = await rpc(admin, 'panel_crear_cita', JSON.stringify({ nombre: 'Por teléfono', telefono: '8095550600',
        servicio_id: ids.s, barbero_id: ids.ana, fecha: f, hora: '08:30' }));
    assert.equal(creada.fin, '09:30');
    const disp = await rpc(admin, 'panel_disponibilidad', ids.ana, ids.s, f, null);
    assert.ok(!disp.horas.includes('08:00') && !disp.horas.includes('09:00') && disp.horas.includes('09:30'));
    assert.equal(await errorDe(rpc(admin, 'panel_crear_cita', JSON.stringify({ nombre: 'Choque', telefono: '8095550601',
        servicio_id: ids.s, barbero_id: ids.ana, fecha: f, hora: '09:00' }))), 'horario_no_disponible');
});
