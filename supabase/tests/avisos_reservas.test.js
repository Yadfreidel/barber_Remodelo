// Avisos de nuevas reservas al barbero, contra PostgreSQL real: destinatario correcto, contenido del aviso y del
// push (discreto), enlace a la cita, estado de la suscripción, dispositivo compartido, prueba y aislamiento.
// No se envía ningún push real: la cola se reclama y se marca como lo haría la Edge Function push-enviar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ANA = '22222222-2222-2222-2222-222222222222';
const BETO = '55555555-5555-5555-5555-555555555555';
let db, A, anon, admin, ana, beto, ids, manana;

const j = o => JSON.stringify(o);
const reservar = (barbero, hora, tel) => rpc(anon, 'reservar_cita', 'Cliente Aviso', null, tel, 'Corte 30', barbero, manana, hora, '[]', null, false, null, null);
const avisosDe = async u => (await A.query('select * from notificaciones where user_id = $1 order by id', [u])).rows;
const SUB_ANA = { endpoint: 'https://push.example.com/ana-telefono', p256dh: 'BPublicaDePruebaAna123', auth: 'secretoAna1', dispositivo: 'Android' };

before(async () => {
    db = await iniciarBase(54348);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email, created_at, last_sign_in_at) values ($1, 'admin@x.com', now() - interval '9 days', now()),
                   ($2, 'ana@x.com', now() - interval '9 days', now()), ($3, 'beto@x.com', now() - interval '9 days', now())`, [ADMIN, ANA, BETO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    ana = await db.conexion('authenticated', ANA);
    beto = await db.conexion('authenticated', BETO);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Ana') ana, (select id::text from barberos where nombre = 'Beto') beto`)).rows[0];
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.ana, email: 'ana@x.com', confirmar_existente: true }));
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto@x.com', confirmar_existente: true }));
    manana = await fechaLocal(A, 1);
});

after(() => db?.cerrar());

test('la reserva para Ana avisa solo a Ana: «Nueva reserva» con cliente, servicio, fecha, hora, estado y enlace a la cita', async () => {
    await rpc(ana, 'push_suscribir', j(SUB_ANA));
    await reservar('Ana', '10:00', '8095550501');
    const id = (await A.query(`select id::text from citas where telefono_cliente like '%8095550501'`)).rows[0].id;
    const [n] = await avisosDe(ANA);
    assert.equal(n.titulo, 'Nueva reserva');
    assert.match(n.cuerpo, /^Cliente Aviso · Corte 30 · \d{2}\/\d{2}\/\d{4} 10:00 · Pendiente de confirmar$/);
    assert.equal(n.datos.cita, id);
    assert.equal(n.datos.estado, 'pendiente');
    assert.equal((await avisosDe(BETO)).length, 0, 'Beto no recibe la reserva de Ana');
    assert.equal((await avisosDe(ADMIN)).filter(x => x.tipo === 'cita_nueva').length, 0, 'administración no se duplica si el barbero tiene cuenta');
    // Push discreto: sin datos del cliente; al tocarlo abre esa cita
    const [p] = await rpc(A, 'push_reclamar', 10);
    assert.equal(p.titulo, 'Nueva reserva');
    assert.equal(p.cuerpo, 'Toca para ver los detalles.');
    assert.doesNotMatch(JSON.stringify(p), /Cliente Aviso|8095550501/);
    assert.equal(p.url, `?panel=agenda&fecha=${manana}&cita=${id}`);
    assert.deepEqual(await rpc(A, 'push_reclamar', 10), [], 'reintentos y eventos repetidos no lo reenvían');
    await rpc(A, 'push_resultado', p.id, 'ok', null);
    // El detalle de la cita solo lo abre su barbero (o administración)
    assert.ok((await rpc(ana, 'panel_cita', id)).id);
    assert.equal(await errorDe(rpc(beto, 'panel_cita', id)), 'cita_no_encontrada');
});

test('estado real de la suscripción y dispositivo compartido: la cuenta anterior deja de recibir avisos', async () => {
    const e = await rpc(ana, 'panel_push_estado', SUB_ANA.endpoint);
    assert.equal(e.dispositivo, 'activa');
    assert.equal(e.dispositivos_activos, 1);
    assert.ok(e.ultimo_envio);
    // Beto entra en el teléfono de Ana: al abrir su panel se anula la suscripción de Ana en ese dispositivo
    await reservar('Ana', '11:00', '8095550502'); // deja un push pendiente para Ana
    const deBeto = await rpc(beto, 'panel_push_estado', SUB_ANA.endpoint);
    assert.equal(deBeto.dispositivo, 'otra_cuenta');
    assert.equal((await rpc(ana, 'panel_push_estado', SUB_ANA.endpoint)).dispositivo, 'inactiva');
    assert.deepEqual(await rpc(A, 'push_reclamar', 10), [], 'el aviso pendiente de Ana ya no llega a ese teléfono');
    assert.equal((await avisosDe(ANA)).length, 2, 'Ana sigue viendo sus avisos dentro de la app');
    assert.match(await errorDe(rpc(anon, 'panel_push_estado', null)), /permission denied|no_autorizado/);
});

test('notificación de prueba: aparece en la app, se encola al push si hay dispositivo y no se puede repetir en ráfaga', async () => {
    await rpc(ana, 'push_suscribir', j({ ...SUB_ANA, endpoint: 'https://push.example.com/ana-otro' }));
    const r = await rpc(ana, 'panel_notificacion_prueba');
    assert.equal(r.push_encolados, 1);
    assert.equal(await errorDe(rpc(ana, 'panel_notificacion_prueba')), 'espera_prueba');
    const [p] = await rpc(A, 'push_reclamar', 10);
    assert.equal(p.titulo, 'Prueba de avisos');
    await rpc(A, 'push_resultado', p.id, 'vencida', '410 Gone');
    const e = await rpc(ana, 'panel_push_estado', 'https://push.example.com/ana-otro');
    assert.equal(e.dispositivo, 'inactiva', 'la suscripción caducada se desactiva');
    assert.equal(e.ultimo_error, '410 Gone');
    assert.deepEqual(e.ultima_prueba.envios, ['vencido']);
});

test('si el push falla, la reserva sigue guardada y el aviso interno también', async () => {
    await rpc(ana, 'push_suscribir', j({ ...SUB_ANA, endpoint: 'https://push.example.com/ana-tres' }));
    const r = await reservar('Ana', '12:00', '8095550503');
    const [p] = await rpc(A, 'push_reclamar', 10);
    await rpc(A, 'push_resultado', p.id, 'fallido', 'HTTP 400');
    assert.equal((await rpc(anon, 'consultar_cita', r.token)).estado, 'pendiente');
    assert.ok((await avisosDe(ANA)).some(n => n.cuerpo.includes('12:00')));
});
