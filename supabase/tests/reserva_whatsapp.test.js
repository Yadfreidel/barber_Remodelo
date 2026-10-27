// Reserva completa en la app + avisos de la cita por WhatsApp como complemento, contra PostgreSQL real:
// cola idempotente, consentimiento, fallo y reintento del envío sin perder la cita, solapes simultáneos,
// aviso al barbero y acceso del cliente solo a sus citas. No se envía ningún mensaje real: la cola se
// reclama y se marca como lo haría la Edge Function whatsapp-enviar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BETO = '55555555-5555-5555-5555-555555555555';
let db, A, anon, anon2, admin, beto, ids, manana;

const j = o => JSON.stringify(o);
const reservar = (cli, hora, tel, { barbero = 'Beto', servicio = 'Corte 30', clave = null } = {}) =>
    rpc(cli, 'reservar_cita', 'Cliente App', null, tel, servicio, barbero, manana, hora, '[]', null, false, null, clave);
const cola = async tel => (await A.query(`select tipo, estado, clave_idempotencia, ultimo_error from mensajes_whatsapp where telefono like $1 order by creado_en, tipo`, [`%${tel}`])).rows;

before(async () => {
    db = await iniciarBase(54346);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30), ('Corte 60', 700, 60)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email, created_at, last_sign_in_at) values ($1, 'admin@x.com', now() - interval '9 days', now()),
                   ($2, 'beto@x.com', now() - interval '9 days', now())`, [ADMIN, BETO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    anon2 = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    beto = await db.conexion('authenticated', BETO);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Beto') beto`)).rows[0];
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto@x.com', confirmar_existente: true }));
    // WhatsApp configurado como en producción: módulo activo y plantillas aprobadas en Meta
    await A.query(`update modulos_config set activo = true where modulo = 'whatsapp'`);
    await A.query(`update plantillas_whatsapp set meta_plantilla = 'cita_' || tipo where tipo in ('solicitud', 'confirmacion', 'cancelacion')`);
    manana = await fechaLocal(A, 1);
});

after(() => db?.cerrar());

test('reserva en la app: queda pendiente, con referencia; «solicitud recibida» en cola y aviso al barbero', async () => {
    const r = await reservar(anon, '10:00', '8095550401');
    assert.equal(r.cita.estado, 'pendiente', 'se respeta la política actual (la barbería confirma)');
    assert.match(r.cita.referencia, /^C-/);
    assert.equal((await rpc(anon, 'cita_avisos_whatsapp', r.token, true)).avisos_whatsapp, true);
    assert.deepEqual((await cola('8095550401')).map(m => [m.tipo, m.estado]), [['solicitud', 'pendiente']], 'solo la solicitud (no una confirmación)');
    const [msg] = (await A.query(`select parametros from mensajes_whatsapp where telefono like '%8095550401'`)).rows;
    assert.equal(msg.parametros[0], 'Cliente App');
    assert.equal(msg.parametros[2], 'Beto');
    const aviso = (await A.query(`select tipo, cuerpo from notificaciones where user_id = $1`, [BETO])).rows;
    assert.deepEqual(aviso.map(n => n.tipo), ['cita_nueva'], 'el barbero recibe su aviso interno');
    assert.equal((await rpc(beto, 'panel_notificaciones_estado', null)).no_leidas, 1, 'contador de pendientes');
    // Reintento de la misma reserva (doble clic con la misma clave): ni otra cita ni otro mensaje
    const clave = '7c2d3f5e-1111-4a2b-9c3d-123456789abc';
    const r1 = await reservar(anon, '11:00', '8095550402', { clave });
    const r2 = await reservar(anon, '11:00', '8095550402', { clave });
    assert.equal(r2.repetida, true);
    assert.equal(r2.token, r1.token);
    assert.equal((await A.query(`select count(*)::int n from citas where telefono_cliente like '%8095550402'`)).rows[0].n, 1);
    assert.equal((await cola('8095550402')).length, 1);
});

test('confirmación posterior: un único mensaje aunque se repita el evento; cita confirmada al crearse = un solo comprobante', async () => {
    const r = await reservar(anon, '12:00', '8095550403');
    await rpc(anon, 'cita_avisos_whatsapp', r.token, true);
    const id = (await A.query(`select id::text from citas where telefono_cliente like '%8095550403'`)).rows[0].id;
    await rpc(admin, 'panel_actualizar_cita', id, 'confirmar', '{}');
    await A.query(`update citas set estado = 'confirmada' where id::text = $1`, [id]); // evento repetido
    assert.deepEqual((await cola('8095550403')).map(m => m.tipo), ['solicitud', 'confirmacion']);
    // Cita creada ya confirmada (panel): solo la confirmación, sin «solicitud»
    const c = await rpc(admin, 'panel_crear_cita', j({ nombre: 'Cliente Panel', telefono: '8095550404', servicio_id:
        (await A.query(`select id::text from servicios where nombre = 'Corte 30'`)).rows[0].id, barbero_id: ids.beto, fecha: manana, hora: '13:00' }));
    const tipos = (await cola('8095550404')).map(m => m.tipo);
    assert.ok(!tipos.includes('solicitud'));
    assert.equal(tipos.filter(t => t === 'confirmacion').length, (await A.query('select estado from citas where id::text = $1', [c.id])).rows[0].estado === 'confirmada' ? 1 : 0);
});

test('consentimiento: sin él no se envía nada; el fallo del envío no toca la cita y el reintento no duplica', async () => {
    const sin = await reservar(anon, '14:00', '8095550405');
    await rpc(anon, 'cita_avisos_whatsapp', sin.token, false);
    const con = await reservar(anon, '15:00', '8095550406');
    await rpc(anon, 'cita_avisos_whatsapp', con.token, true);
    // Sin respuesta todavía (recién reservada): espera, no se envía ni se descarta
    const pendienteSinRespuesta = await reservar(anon, '16:00', '8095550407');
    const lote = (await A.query('select * from whatsapp_reclamar(20)')).rows;
    assert.ok(lote.some(m => m.telefono.endsWith('8095550406')));
    assert.ok(!lote.some(m => m.telefono.endsWith('8095550405') || m.telefono.endsWith('8095550407')));
    assert.equal((await cola('8095550405'))[0].estado, 'omitido');
    assert.equal((await cola('8095550405'))[0].ultimo_error, 'sin_consentimiento_avisos');
    assert.equal((await cola('8095550407'))[0].estado, 'pendiente', 'espera la respuesta del cliente');
    assert.ok(pendienteSinRespuesta.token);
    // Fallo del proveedor (como lo reporta whatsapp-enviar): la cita sigue igual y el mensaje vuelve a la cola
    const m = lote.find(x => x.telefono.endsWith('8095550406'));
    await A.query(`select whatsapp_resultado($1, false, null, 'HTTP 503', true)`, [m.id]);
    assert.equal((await A.query(`select estado from mensajes_whatsapp where id = $1`, [m.id])).rows[0].estado, 'pendiente');
    assert.equal((await rpc(anon, 'consultar_cita', con.token)).estado, 'pendiente', 'la cita no cambia');
    await A.query(`update mensajes_whatsapp set programado_para = now() where id = $1`, [m.id]);
    const reintento = (await A.query('select * from whatsapp_reclamar(20)')).rows.filter(x => x.id === m.id);
    assert.equal(reintento.length, 1);
    await A.query(`select whatsapp_resultado($1, true, 'wamid.prueba', null, false)`, [m.id]);
    assert.equal((await A.query('select * from whatsapp_reclamar(20)')).rows.filter(x => x.id === m.id).length, 0, 'enviado una sola vez');
    assert.equal((await A.query(`select count(*)::int n from mensajes_whatsapp where telefono like '%8095550406'`)).rows[0].n, 1);
    // Cancelada antes de enviarse: su aviso pendiente se descarta
    await rpc(anon, 'cita_avisos_whatsapp', pendienteSinRespuesta.token, true);
    await rpc(anon, 'cancelar_cita', pendienteSinRespuesta.token);
    await A.query('select * from whatsapp_reclamar(20)');
    const solicitud = (await cola('8095550407')).find(x => x.tipo === 'solicitud');
    assert.equal(solicitud.estado, 'omitido');
});

test('notas del cliente para el barbero; acceso solo con el token de su cita', async () => {
    const r = await reservar(anon, '17:00', '8095550408');
    await rpc(anon, 'cita_notas_cliente', r.token, 'Prefiero tijera arriba');
    assert.equal((await rpc(anon, 'cita_notas_cliente', r.token, 'Prefiero tijera arriba')).repetida, true, 'reintento sin duplicar');
    const id = (await A.query(`select id::text from citas where telefono_cliente like '%8095550408'`)).rows[0].id;
    assert.equal((await A.query('select notas from citas where id::text = $1', [id])).rows[0].notas, 'Nota del cliente: Prefiero tijera arriba');
    assert.equal((await rpc(beto, 'panel_atencion', manana, null)).find(c => c.id === id).notas, 'Nota del cliente: Prefiero tijera arriba');
    const otro = '00000000-0000-4000-8000-000000000000';
    assert.equal(await errorDe(rpc(anon, 'cita_notas_cliente', otro, 'x')), 'cita_no_encontrada');
    assert.equal(await errorDe(rpc(anon, 'cita_avisos_whatsapp', otro, true)), 'cita_no_encontrada');
    // Cada cliente solo ve sus citas (por sus tokens)
    const propias = await rpc(anon2, 'mis_citas_por_tokens', [r.token], []);
    assert.deepEqual(propias.map(c => c.token), [r.token]);
    // Sin acceso directo a citas ni a la cola en la instalación real: lo comprueba base_completa.test.js
});

test('dos reservas simultáneas que se solapan con el mismo barbero: solo una se guarda', async () => {
    // Corte 60 a las 18:00 y Corte 30 a las 18:30 se pisan; se envían a la vez desde dos conexiones
    const resultados = await Promise.allSettled([
        reservar(anon, '18:00', '8095550409', { servicio: 'Corte 60' }),
        reservar(anon2, '18:30', '8095550410')
    ]);
    assert.equal(resultados.filter(x => x.status === 'fulfilled').length, 1, 'una sola gana');
    assert.match(resultados.find(x => x.status === 'rejected').reason.message, /horario_no_disponible/);
    const activas = (await A.query(`select count(*)::int n from citas where barbero_id::text = $1 and fecha = $2 and hora in ('18:00', '18:30') and estado <> 'cancelada'`,
        [ids.beto, manana])).rows[0].n;
    assert.equal(activas, 1);
    // Mismo inicio a la vez (doble envío sin clave): también una sola
    const mismo = await Promise.allSettled([reservar(anon, '19:00', '8095550411'), reservar(anon2, '19:00', '8095550412')]);
    assert.equal(mismo.filter(x => x.status === 'fulfilled').length, 1);
});
