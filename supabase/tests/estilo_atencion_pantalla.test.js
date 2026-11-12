// Consulta rápida de estilo, llegada en «Atención» y pantalla de turnos, contra PostgreSQL real:
// foto validada y privada, permisos por token / barbero asignado / administración, reintentos sin duplicar,
// citas antiguas intactas, sillas por barbero y endpoint público de la TV sin datos personales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ISAAC = '55555555-5555-5555-5555-555555555555';
const BETO = '77777777-7777-7777-7777-777777777777';
let db, A, anon, anon2, admin, isaac, beto, ids, F, manana;
const conexiones = [];

const bytes = (...b) => Buffer.from([...b, ...new Array(24).fill(7)]).toString('base64');
const JPEG = `data:image/jpeg;base64,${bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)}`;
const PNG_DISFRAZADO = `data:image/jpeg;base64,${bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)}`;
const reservar = (hora, barbero = 'Isaac', fecha = manana) =>
    rpc(anon, 'reservar_cita', 'Cliente Estilo', null, '8095550700', 'Corte 30', barbero, fecha, hora, '[]', null, false, null, randomUUID());
const citaId = async token => (await A.query('select cita_id from cita_tokens where token = $1', [token])).rows[0].cita_id;
async function reloj(hora) {
    for (const c of conexiones) await c.query(`select set_config('barberia.fila_reloj', $1, false)`, [`${F} ${hora}`]);
}

before(async () => {
    db = await iniciarBase(54363);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Isaac'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30)`);
    await db.migrar();
    await A.query(`update servicios set en_catalogo = true, activo = true`);
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'isaac@x.com'), ($3, 'beto@x.com')`, [ADMIN, ISAAC, BETO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    admin = await db.conexion('authenticated', ADMIN);
    isaac = await db.conexion('authenticated', ISAAC);
    beto = await db.conexion('authenticated', BETO);
    anon = await db.conexion('anon');
    anon2 = await db.conexion('anon');
    conexiones.push(A, admin, isaac, beto, anon, anon2);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Isaac') isaac, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from servicios where nombre = 'Corte 30') corte`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.isaac, 'isaac@x.com');
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
    manana = await fechaLocal(A, 1);
    F = await fechaLocal(A, 2);
});

after(() => db?.cerrar());

test('consulta de estilo: sin completar, solo nota y con foto; reintento sin duplicar; foto validada', async () => {
    const sin = await reservar('09:00');
    assert.equal(await rpc(anon, 'cita_estilo', sin.token, false), null, 'reservar sin completar la sección');
    assert.equal((await rpc(anon, 'consultar_cita', sin.token)).estado, 'pendiente');

    const conNota = await reservar('10:00');
    const n = await rpc(anon, 'cita_estilo_guardar', conNota.token, '  Déjame el largo arriba   y degradado bajo ', null, null, null, null);
    assert.equal(n.estilo.nota, 'Déjame el largo arriba y degradado bajo');
    assert.equal(n.estilo.tiene_foto, false);

    const conFoto = await reservar('11:00');
    const args = [conFoto.token, 'Como la foto', JPEG, JPEG, 800, 1000];
    await rpc(anon, 'cita_estilo_guardar', ...args);
    await rpc(anon, 'cita_estilo_guardar', ...args); // reintento tras un fallo de red
    assert.equal((await A.query('select count(*)::int n from cita_estilo where cita_id = $1', [await citaId(conFoto.token)])).rows[0].n, 1);
    assert.equal((await A.query(`select count(*)::int n from citas where telefono_cliente like '%8095550700'`)).rows[0].n, 3, 'ninguna cita duplicada');
    const propia = await rpc(anon, 'cita_estilo', conFoto.token, false);
    assert.equal(propia.tiene_foto, true);
    assert.equal(propia.foto, null, 'la vista normal solo trae la miniatura');
    assert.equal((await rpc(anon, 'cita_estilo', conFoto.token, true)).foto, JPEG);

    // Validaciones (formato real, tamaño, nota)
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', conNota.token, null, PNG_DISFRAZADO, null, 10, 10)), /foto_invalida/);
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', conNota.token, null, 'data:image/gif;base64,R0lGODlh', null, 10, 10)), /foto_invalida/);
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', conNota.token, null, JPEG + 'A'.repeat(1500001), null, 10, 10)), /foto_invalida/);
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', conNota.token, 'x'.repeat(301), null, null, null, null)), /nota_muy_larga/);
    assert.equal((await rpc(anon, 'cita_estilo', conNota.token, false)).nota, 'Déjame el largo arriba y degradado bajo', 'un error no borra lo guardado');
    // Quitar todo
    assert.equal((await rpc(anon, 'cita_estilo_guardar', conNota.token, '', null, null, null, null)).estilo, null);
    assert.equal(await rpc(anon, 'cita_estilo', conNota.token, false), null);
    // Token inventado / cita cancelada
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', randomUUID(), 'hola', null, null, null, null)), /cita_no_encontrada/);
    assert.equal(await rpc(anon2, 'cita_estilo', randomUUID(), true), null);
    await rpc(anon, 'cancelar_cita', sin.token);
    assert.match(await errorDe(rpc(anon, 'cita_estilo_guardar', sin.token, 'tarde', null, null, null, null)), /cita_cerrada/);
});

test('la referencia la ven el barbero asignado y la administración; otro barbero y la tabla, no', async () => {
    const r = await reservar('12:00', 'Isaac');
    await rpc(anon, 'cita_estilo_guardar', r.token, 'Degradado bajo', JPEG, JPEG, 640, 640);
    const id = await citaId(r.token);
    const delBarbero = await rpc(isaac, 'panel_cita_estilo', id, true);
    assert.equal(delBarbero.nota, 'Degradado bajo');
    assert.equal(delBarbero.foto, JPEG);
    assert.equal((await rpc(admin, 'panel_cita_estilo', id, false)).miniatura, JPEG);
    assert.match(await errorDe(rpc(beto, 'panel_cita_estilo', id, true)), /cita_no_encontrada/);
    assert.match(await errorDe(rpc(anon, 'panel_cita_estilo', id, true)), /permission denied|no_autorizado/);
    assert.match(await errorDe(anon.query('select * from cita_estilo')), /permission denied/);
    assert.match(await errorDe(isaac.query('select * from cita_estilo')), /permission denied/);
    // Cita antigua (sin consulta) se abre normalmente en el panel
    const vieja = await reservar('13:00', 'Isaac');
    const idVieja = String(await citaId(vieja.token));
    assert.equal(await rpc(isaac, 'panel_cita_estilo', idVieja, false), null);
    assert.ok(await rpc(isaac, 'panel_cita', idVieja), 'el detalle de una cita sin consulta abre igual');
    // Atención marca qué citas traen referencia
    const lista = await rpc(isaac, 'panel_atencion', manana, null);
    assert.equal(lista.find(c => c.id === id).estilo, true);
    assert.equal(lista.find(c => c.id === idVieja).estilo, false);
    assert.ok(lista.every(c => 'llegada_en' in c && 'barbero_id' in c));
});

test('llegada de la cita: solo hoy, solo el barbero asignado o la administración, idempotente', async () => {
    const hoy = (await A.query(`select _ahora_local()::date::text f`)).rows[0].f;
    const r = await reservar('12:30', 'Isaac');
    const id = await citaId(r.token);
    assert.match(await errorDe(rpc(isaac, 'panel_cita_llegada', id)), /cita_no_es_hoy/);
    await A.query('update citas set fecha = $1 where id::text = $2', [hoy, id]);
    assert.match(await errorDe(rpc(beto, 'panel_cita_llegada', id)), /cita_no_encontrada/);
    await rpc(isaac, 'panel_cita_llegada', id);
    const primera = (await A.query('select llegada_en from citas where id::text = $1', [id])).rows[0].llegada_en;
    await rpc(admin, 'panel_cita_llegada', id);
    assert.deepEqual((await A.query('select llegada_en from citas where id::text = $1', [id])).rows[0].llegada_en, primera, 'no se sobrescribe');
    const fila = (await rpc(isaac, 'panel_atencion', hoy, null)).find(c => c.id === id);
    assert.ok(fila.llegada_en);
    await rpc(isaac, 'panel_cita_iniciar', id);
    await rpc(isaac, 'panel_actualizar_cita', id, 'completar', '{}');
    assert.match(await errorDe(rpc(isaac, 'panel_cita_llegada', id)), /cita_completada/);
});

test('pantalla de turnos: silla por barbero, solo datos públicos y retiro al iniciar o vencer', async () => {
    await A.query(`delete from fila_eventos; delete from fila_turnos; update fila_config set recepcion_abierta = true, cortesia_minutos = 5`);
    await reloj('10:00');
    // Solo la administración configura sillas
    assert.match(await errorDe(rpc(isaac, 'panel_fila_sillas')), /no_autorizado/);
    assert.match(await errorDe(rpc(isaac, 'panel_fila_sillas_guardar', JSON.stringify({ [ids.isaac]: 2 }))), /no_autorizado/);
    assert.match(await errorDe(rpc(admin, 'panel_fila_sillas_guardar', JSON.stringify({ [ids.isaac]: 0 }))), /configuracion_invalida/);
    const sillas = await rpc(admin, 'panel_fila_sillas_guardar', JSON.stringify({ [ids.isaac]: 2, [ids.beto]: null }));
    assert.equal(sillas.find(b => b.id === ids.isaac).silla, 2);
    assert.equal(sillas.find(b => b.id === ids.beto).silla, null);

    const vacia = await rpc(anon, 'fila_pantalla');
    assert.deepEqual(vacia.llamados, []);
    const t1 = await rpc(anon, 'fila_tomar_turno', ids.corte, ids.isaac, randomUUID());
    const t2 = await rpc(anon2, 'fila_tomar_turno', ids.corte, ids.beto, randomUUID());
    await rpc(admin, 'panel_fila_registrar', ids.corte, ids.beto, 'Pedro Pérez', randomUUID());
    assert.equal((await rpc(anon, 'fila_pantalla')).en_espera, 3);

    // Mismo llamado para el celular y la TV
    await rpc(isaac, 'panel_fila_llamar', null);
    const tv = await rpc(anon2, 'fila_pantalla');
    assert.equal(tv.llamados.length, 1);
    assert.deepEqual(Object.keys(tv.llamados[0]).sort(), ['clave', 'codigo', 'estado', 'llamado_en', 'silla']);
    assert.deepEqual([tv.llamados[0].codigo, tv.llamados[0].silla, tv.llamados[0].estado], [t1.codigo, 2, 'llamado']);
    const cel = await rpc(anon, 'fila_turno', t1.token);
    assert.deepEqual([cel.estado, cel.silla, cel.barbero], ['llamado', 2, 'Isaac']);
    // Sin datos personales ni secretos en el endpoint público
    const texto = JSON.stringify(tv);
    for (const prohibido of ['Pedro', 'Isaac', 'Beto', 'telefono', 'token', t1.token, 'nombre', 'nota', 'foto']) assert.ok(!texto.includes(prohibido), prohibido);
    assert.match(await errorDe(anon.query('select * from fila_sillas')), /permission denied/);

    // Barbero sin silla: llamado sin número
    await rpc(beto, 'panel_fila_llamar', null);
    const dos = await rpc(anon, 'fila_pantalla');
    assert.equal(dos.llamados.length, 2);
    assert.equal(dos.llamados.find(l => l.codigo === t2.codigo).silla, null);
    // La clave es estable mientras dura el llamado (la TV suena una vez)
    assert.equal(dos.llamados.find(l => l.codigo === t1.codigo).clave, tv.llamados[0].clave);

    // Iniciar el servicio retira el llamado; vencer la cortesía también
    const turnoIsaac = (await A.query('select id from fila_turnos where token = $1', [t1.token])).rows[0].id;
    await rpc(isaac, 'panel_fila_iniciar', turnoIsaac);
    assert.deepEqual((await rpc(anon, 'fila_pantalla')).llamados.map(l => l.codigo), [t2.codigo]);
    assert.equal((await rpc(anon, 'fila_turno', t1.token)).silla, 2, 'en servicio, el cliente sigue viendo su silla');
    await reloj('10:06');
    assert.deepEqual((await rpc(anon, 'fila_pantalla')).llamados, []);
    assert.equal((await rpc(anon2, 'fila_turno', t2.token)).estado, 'no_se_presento');
});
