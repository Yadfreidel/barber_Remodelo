// Cuentas de barberos, permisos, atención, disponibilidad, ingresos y notificaciones contra PostgreSQL real:
// vinculación explícita (cuentas nuevas y existentes), contraseña temporal comprobada en el servidor,
// solicitudes de acceso sin escalada, permiso de cajero, avisos únicos por evento y destinatario y cola push.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BETO = '55555555-5555-5555-5555-555555555555';
const CARO = '77777777-7777-7777-7777-777777777777';
const DANI = '88888888-8888-8888-8888-888888888888';
const CLIENTE = '66666666-6666-6666-6666-666666666666';
const NUEVO = '99999999-9999-9999-9999-999999999999';
let db, A, anon, admin, beto, caro, dani, cliente, nuevo, ids, manana;

const j = o => JSON.stringify(o);
const reservar = (barbero, fecha, hora, tel) =>
    rpc(anon, 'reservar_cita', 'Cliente Aviso', null, tel, 'Corte 30', barbero, fecha, hora, '[]', null, false, null, null);
const citaPorTel = async tel => (await A.query('select id::text from citas where telefono_cliente like $1', [`%${tel}`])).rows[0].id;
const avisos = async (usuario, tipo) => (await A.query('select * from notificaciones where user_id = $1 and ($2::text is null or tipo = $2) order by id',
    [usuario, tipo ?? null])).rows;

before(async () => {
    db = await iniciarBase(54344);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto'), ('Caro'), ('Dani'), ('Eva')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30), ('Corte 60', 700, 60)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email, encrypted_password, created_at, last_sign_in_at) values
        ($1, 'admin@x.com', 'h-admin', now() - interval '90 days', now()), ($2, 'beto@x.com', 'h-beto', now() - interval '9 days', now()),
        ($3, 'caro@x.com', 'h-caro', now() - interval '9 days', now()), ($4, 'cliente@x.com', 'h-cli', now() - interval '30 days', now())`,
        [ADMIN, BETO, CARO, CLIENTE]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    beto = await db.conexion('authenticated', BETO);
    caro = await db.conexion('authenticated', CARO);
    dani = await db.conexion('authenticated', DANI);
    cliente = await db.conexion('authenticated', CLIENTE);
    nuevo = await db.conexion('authenticated', NUEVO);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Ana') ana, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from barberos where nombre = 'Caro') caro, (select id::text from barberos where nombre = 'Dani') dani,
        (select id::text from barberos where nombre = 'Eva') eva`)).rows[0];
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto@x.com', confirmar_existente: true }));
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.caro, email: 'caro@x.com', confirmar_existente: true }));
    manana = await fechaLocal(A, 1);
});

after(() => db?.cerrar());

// ---------------- Cuentas ----------------
test('alta: cuenta nueva con contraseña temporal; el servidor exige cambiarla antes de trabajar', async () => {
    // La cuenta acaba de crearse en Auth (registro desde el panel): aún sin iniciar sesión
    await A.query(`insert into auth.users (id, email, encrypted_password) values ($1, 'dani@x.com', 'h-temporal')`, [DANI]);
    await A.query(`update auth.users set raw_app_meta_data = $2::jsonb where id = $1`, [DANI, j({ barberia_alta_admin: ADMIN, barberia_alta_perfil: ids.dani })]);
    const estado = await rpc(admin, 'panel_cuenta_consultar', 'DANI@x.com');
    assert.deepEqual({ existe: estado.existe, reciente: estado.alta_panel, barbero: estado.barbero }, { existe: true, reciente: true, barbero: null });
    const datos = j({ barbero_id: ids.dani, email: 'dani@x.com', clave_temporal: true, permisos: [] });
    const r = await rpc(admin, 'panel_cuenta_vincular', datos);
    assert.equal(r.clave_temporal, true);
    assert.equal((await rpc(admin, 'panel_cuenta_vincular', datos)).repetida, true, 'reintento o doble clic: sin duplicar');
    assert.equal((await A.query('select count(*)::int n from barbero_usuarios where barbero_id = $1', [ids.dani])).rows[0].n, 1);

    await reservar('Dani', manana, '14:00', '8095550991');
    assert.equal((await dani.query('select * from citas')).rowCount, 0, 'RLS bloquea lectura con clave temporal');
    const rol = await rpc(dani, 'rol_panel');
    assert.equal(rol.rol, 'barbero');
    assert.equal(rol.debe_cambiar_clave, true);
    assert.equal(await errorDe(rpc(dani, 'panel_atencion', manana, null)), 'cambio_clave_requerido', 'bloqueado hasta cambiarla');
    assert.equal(await errorDe(rpc(dani, 'panel_confirmar_cambio_clave')), 'clave_sin_cambiar', 'no basta con decir que se cambió');
    await A.query(`update auth.users set encrypted_password = 'h-nueva' where id = $1`, [DANI]); // cambio real en Auth
    await rpc(dani, 'panel_confirmar_cambio_clave');
    assert.equal((await rpc(dani, 'rol_panel')).debe_cambiar_clave, false);
    assert.equal((await rpc(dani, 'panel_atencion', manana, null)).length, 1);
    const fila = (await A.query('select * from barbero_usuarios where user_id = $1', [DANI])).rows[0];
    assert.equal(fila.huella_clave, null);
    assert.doesNotMatch(JSON.stringify((await A.query(`select detalle from auditoria where entidad in ('barbero', 'cuenta')`)).rows), /h-temporal|h-nueva|clave":/,
        'ni contraseñas ni huellas en la auditoría');
});

test('cuenta existente: vinculación explícita, sin tocar su contraseña ni sus roles; perfiles y cuentas únicos', async () => {
    const datos = { barbero_id: ids.ana, email: 'admin@x.com', clave_temporal: true };
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j(datos))), 'cuenta_existente', 'necesita confirmación explícita');
    const r = await rpc(admin, 'panel_cuenta_vincular', j({ ...datos, confirmar_existente: true }));
    assert.equal(r.clave_temporal, false, 'una cuenta existente nunca se marca con contraseña temporal');
    assert.equal(await rpc(admin, 'es_admin'), true, 'conserva su rol de administrador');
    assert.equal((await A.query('select encrypted_password from auth.users where id = $1', [ADMIN])).rows[0].encrypted_password, 'h-admin');
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.eva, email: 'beto@x.com', confirmar_existente: true }))), 'cuenta_vinculada_otro');
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'cliente@x.com', confirmar_existente: true }))), 'barbero_con_cuenta');
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.eva, email: 'nadie@x.com' }))), 'usuario_no_encontrado');
    assert.equal(await errorDe(rpc(beto, 'panel_cuenta_vincular', j({ barbero_id: ids.eva, email: 'cliente@x.com', confirmar_existente: true }))), 'no_autorizado');
    assert.equal(await errorDe(rpc(beto, 'panel_cuenta_consultar', 'admin@x.com')), 'no_autorizado');
    await rpc(admin, 'panel_cuenta_desvincular', ids.ana);
    assert.equal(await rpc(admin, 'es_admin'), true);
    assert.equal((await rpc(admin, 'panel_cuentas_barberos')).some(c => c.barbero_id === ids.ana), false);
    for (const t of ['barbero_permisos', 'solicitudes_profesionales', 'notificaciones', 'push_suscripciones', 'push_envios', 'solicitudes_disponibilidad'])
        assert.match(await errorDe(beto.query(`select * from ${t}`)), /permission denied/, t);
});

test('solicitud de acceso: correo verificado, sin duplicados ni privilegios hasta aprobar', async () => {
    await A.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at) values ($1, 'nuevo@x.com', 'h', null)`, [NUEVO]);
    const solicitud = j({ nombre: 'Nuevo Barbero', telefono: '8095550199', mensaje: 'Trabajo los fines de semana' });
    assert.equal(await errorDe(rpc(nuevo, 'solicitud_profesional_crear', solicitud)), 'correo_no_verificado');
    await A.query('update auth.users set email_confirmed_at = now() where id = $1', [NUEVO]);
    assert.equal((await rpc(nuevo, 'solicitud_profesional_crear', solicitud)).repetida, false);
    assert.equal((await rpc(nuevo, 'solicitud_profesional_crear', solicitud)).repetida, true, 'doble envío: una sola solicitud');
    assert.equal((await rpc(nuevo, 'rol_panel')).rol, null, 'registrarse no da acceso');
    assert.equal(await errorDe(rpc(nuevo, 'panel_atencion', manana, null)), 'no_autorizado');
    assert.equal((await rpc(nuevo, 'solicitud_profesional_estado')).solicitud.estado, 'pendiente');
    assert.equal(await errorDe(rpc(beto, 'solicitud_profesional_crear', solicitud)), 'ya_tiene_acceso');
    assert.equal((await avisos(ADMIN, 'solicitud_acceso')).length, 1, 'administración recibe el aviso');
    const [s] = await rpc(admin, 'panel_solicitudes_profesionales', 'pendiente');
    assert.equal(await errorDe(rpc(admin, 'panel_solicitud_resolver', s.id, j({ accion: 'aprobar', barbero_id: ids.beto }))), 'barbero_con_cuenta');
    await rpc(admin, 'panel_solicitud_resolver', s.id, j({ accion: 'aprobar', barbero_id: ids.eva }));
    assert.equal((await rpc(nuevo, 'rol_panel')).rol, 'barbero');
    assert.equal((await rpc(nuevo, 'rol_panel')).debe_cambiar_clave, false, 'su propia contraseña, sin cambio forzado');
    assert.equal(await errorDe(rpc(admin, 'panel_solicitud_resolver', s.id, j({ accion: 'rechazar' }))), 'transicion_invalida');
});

test('cajero: cobra y ve la caja del día solo con el permiso; anular, reembolsar y gastos siguen siendo del administrador', async () => {
    assert.equal(await errorDe(rpc(beto, 'panel_caja_estado')), 'no_autorizado');
    await rpc(admin, 'panel_cuenta_permisos', ids.beto, j(['cajero']));
    assert.deepEqual((await rpc(beto, 'rol_panel')).permisos, ['cajero']);
    assert.ok(await rpc(beto, 'panel_caja_estado'));
    assert.ok(Array.isArray(await rpc(beto, 'panel_ventas', manana, manana, null)));
    assert.equal(await errorDe(rpc(beto, 'panel_gastos', manana, manana)), 'no_autorizado');
    assert.equal(await errorDe(rpc(beto, 'panel_venta_anular', j({}))), 'no_autorizado');
    assert.equal(await errorDe(rpc(beto, 'panel_finanzas', manana, manana)), 'no_autorizado');
    assert.equal(await errorDe(rpc(caro, 'panel_caja_estado')), 'no_autorizado', 'sin permiso, sin caja');
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_permisos', ids.beto, j(['admin']))), 'permiso_invalido');
    await rpc(admin, 'panel_cuenta_permisos', ids.beto, j([]));
    assert.equal(await errorDe(rpc(beto, 'panel_caja_estado')), 'no_autorizado', 'retirar el permiso lo quita al instante');
});

// ---------------- Notificaciones ----------------
test('avisos: uno por evento y destinatario; cancelación, reprogramación y reasignación sin acceso indebido', async () => {
    const reserva = await reservar('Beto', manana, '10:00', '8095550301');
    assert.ok(reserva, 'la reserva se guarda igual que antes');
    const id = await citaPorTel('8095550301');
    let deBeto = await avisos(BETO);
    assert.equal(deBeto.length, 1);
    assert.equal(deBeto[0].tipo, 'cita_nueva');
    assert.match(deBeto[0].cuerpo, /Cliente Aviso · Corte 30 · .* 10:00/);
    assert.equal((await avisos(CARO)).length, 0, 'otro barbero no recibe nada');
    assert.equal((await avisos(ADMIN, 'cita_nueva')).length, 0, 'si el barbero tiene cuenta, no se avisa a administración');
    await A.query('update citas set notas = $2 where id::text = $1', [id, 'sin cambios de agenda']);
    await A.query(`update citas set estado = estado where id::text = $1`, [id]);
    assert.equal((await avisos(BETO)).length, 1, 'reintentos y cambios ajenos no duplican');

    const estado = await rpc(beto, 'panel_notificaciones_estado', 0);
    assert.equal(estado.no_leidas, 1);
    assert.equal(estado.nuevas.length, 1);
    assert.equal((await rpc(caro, 'panel_notificaciones', 30, null)).items.length, 0, 'cada cuenta ve solo las suyas');

    // Reprogramar
    await rpc(admin, 'panel_actualizar_cita', id, 'reprogramar', j({ fecha: manana, hora: '11:00' }));
    assert.deepEqual((await avisos(BETO)).map(n => n.tipo), ['cita_nueva', 'cita_reprogramada']);
    // Reasignar: el nuevo profesional recibe el detalle; el anterior pierde los datos del cliente
    await rpc(admin, 'panel_actualizar_cita', id, 'reprogramar', j({ fecha: manana, hora: '11:00', barbero_id: ids.caro }));
    assert.deepEqual((await avisos(CARO)).map(n => n.tipo), ['cita_asignada']);
    deBeto = await avisos(BETO);
    assert.deepEqual(deBeto.map(n => n.tipo), ['cita_nueva', 'cita_reprogramada', 'cita_reasignada']);
    assert.doesNotMatch(deBeto.map(n => n.cuerpo).join(' '), /Cliente Aviso/, 'el anterior ya no conserva datos del cliente');
    assert.equal(await errorDe(rpc(beto, 'panel_cita_iniciar', id)), 'cita_no_encontrada', 'ni acceso a la cita');
    // Cancelar
    await rpc(admin, 'panel_actualizar_cita', id, 'cancelar', j({ motivo: 'El cliente avisó' }));
    assert.deepEqual((await avisos(CARO)).map(n => n.tipo), ['cita_asignada', 'cita_cancelada']);
    // Leer no vuelve a generar avisos
    await rpc(caro, 'panel_notificaciones_leer', null);
    assert.equal((await rpc(caro, 'panel_notificaciones_estado', null)).no_leidas, 0);
    assert.equal((await avisos(CARO)).length, 2);
    // La notificación no confirma, cobra ni cancela
    const cita = (await A.query('select estado, completada_en from citas where id::text = $1', [id])).rows[0];
    assert.equal(cita.estado, 'cancelada');

    // Barbero sin cuenta: avisa a administración
    await reservar('Ana', manana, '12:00', '8095550302');
    assert.equal((await avisos(ADMIN, 'cita_nueva')).length, 1);
});

test('push: cola por suscripción, mensaje discreto, dispositivo compartido y suscripciones vencidas', async () => {
    const sub = { endpoint: 'https://push.example.com/abc', p256dh: 'BPublicaDePrueba123', auth: 'secreto123', dispositivo: 'Chrome' };
    await rpc(beto, 'push_suscribir', j(sub));
    await reservar('Beto', manana, '14:00', '8095550303');
    const pendientes = (await A.query(`select * from push_envios where estado = 'pendiente'`)).rows;
    assert.equal(pendientes.length, 1);
    const lote = await rpc(A, 'push_reclamar', 10);
    assert.equal(lote.length, 1);
    assert.equal(lote[0].cuerpo, 'Toca para ver los detalles.');
    assert.doesNotMatch(JSON.stringify(lote), /Cliente Aviso|8095550303/, 'sin datos del cliente en la pantalla bloqueada');
    assert.match(lote[0].url, /^\?panel=agenda&fecha=/);
    assert.deepEqual(await rpc(A, 'push_reclamar', 10), [], 'no se reenvía');
    await rpc(A, 'push_resultado', lote[0].id, 'vencida', '410 Gone');
    assert.equal((await A.query('select activa from push_suscripciones')).rows[0].activa, false);
    // Otra cuenta en el mismo dispositivo: el endpoint pasa a esa cuenta
    await rpc(caro, 'push_suscribir', j(sub));
    assert.equal((await A.query('select user_id from push_suscripciones')).rows[0].user_id, CARO);
    await reservar('Beto', manana, '15:00', '8095550304');
    assert.equal((await A.query(`select count(*)::int n from push_envios where estado = 'pendiente'`)).rows[0].n, 0, 'Beto ya no recibe en ese dispositivo');
    await rpc(caro, 'push_desuscribir', sub.endpoint);
    assert.match(await errorDe(rpc(beto, 'push_reclamar', 10)), /permission denied/, 'solo el servidor envía');
});

// ---------------- Atención, disponibilidad, ingresos, ocupación ----------------
test('atención: iniciar y terminar su servicio; terminar no marca pagado', async () => {
    const hoy = await fechaLocal(A, 0);
    // Cita de hoy creada sin las validaciones de horario (la hora de la prueba no depende del reloj)
    await A.query('set session_replication_role = replica');
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado)
                   select 'Cliente Hoy', '8095550310', b.id, s.id, $1::date, '23:00', 'confirmada' from barberos b, servicios s
                    where b.id::text = $2 and s.nombre = 'Corte 30'`, [hoy, ids.beto]);
    await A.query('set session_replication_role = origin');
    const id = await citaPorTel('8095550310');
    assert.equal(await errorDe(rpc(caro, 'panel_cita_iniciar', id)), 'cita_no_encontrada', 'acceso directo por id a cita ajena');
    await rpc(beto, 'panel_cita_iniciar', id);
    const [c] = (await rpc(beto, 'panel_atencion', hoy, null)).filter(x => x.id === id);
    assert.ok(c.iniciada_en);
    await rpc(beto, 'panel_actualizar_cita', id, 'completar', '{}');
    assert.equal((await A.query('select count(*)::int n from ventas where cita_id = $1', [id])).rows[0].n, 0, 'terminar no crea cobro');
    const real = await rpc(beto, 'panel_tiempo_real', hoy, hoy, ids.caro);
    assert.equal(real.servicios, 1, 'el barbero ve solo su tiempo real');
});

test('disponibilidad: solicitud sujeta a aprobación; aprobar crea el bloqueo sin cancelar citas', async () => {
    const id = await citaPorTel('8095550304'); // cita de Beto mañana 15:00
    const s = await rpc(beto, 'panel_disponibilidad_solicitar', j({ tipo: 'bloqueo', fecha_desde: manana, hora_desde: '14:30', hora_hasta: '16:00', motivo: 'Médico' }));
    assert.equal(s.citas_afectadas, 1);
    assert.equal(await errorDe(rpc(beto, 'panel_disponibilidad_solicitar', j({ tipo: 'bloqueo', fecha_desde: manana, hora_desde: '14:30', hora_hasta: '16:00' }))),
        'solicitud_duplicada');
    assert.equal(await errorDe(rpc(beto, 'panel_disponibilidad_solicitar', j({ tipo: 'bloqueo', fecha_desde: manana, hora_desde: '16:00', hora_hasta: '15:00' }))),
        'datos_invalidos');
    assert.equal(await errorDe(rpc(beto, 'panel_disponibilidad_resolver', s.id, true, null)), 'no_autorizado');
    assert.equal((await A.query('select count(*)::int n from bloqueos where barbero_id = $1', [ids.beto])).rows[0].n, 0, 'nada cambia sin aprobación');
    const r = await rpc(admin, 'panel_disponibilidad_resolver', s.id, true, 'Aprobado');
    assert.equal(r.citas_afectadas, 1);
    assert.equal((await A.query('select count(*)::int n from bloqueos where barbero_id = $1', [ids.beto])).rows[0].n, 1);
    assert.equal((await A.query('select estado from citas where id::text = $1', [id])).rows[0].estado, 'pendiente', 'la cita no se cancela sola');
    assert.equal((await avisos(BETO, 'disponibilidad')).length, 1);
    const mia = await rpc(beto, 'panel_disponibilidad_mia');
    assert.equal(mia.horario.length, 7);
    assert.equal(mia.solicitudes[0].estado, 'aprobada');
    assert.equal(await errorDe(rpc(admin, 'panel_disponibilidad_mia')), 'no_autorizado');
    const d = await rpc(caro, 'panel_disponibilidad_solicitar', j({ tipo: 'descanso', dia: 3, hora_desde: '13:00', hora_hasta: '14:00' }));
    await rpc(caro, 'panel_disponibilidad_cancelar', d.id);
    assert.equal(await errorDe(rpc(beto, 'panel_disponibilidad_cancelar', d.id)), 'transicion_invalida');
});

test('ingresos y ocupación: cada barbero ve solo lo suyo; sin comisiones inventadas', async () => {
    const ing = await rpc(beto, 'panel_mis_ingresos', manana, manana, ids.caro);
    assert.equal(ing.comision.disponible, false);
    assert.equal(ing.propinas.disponible, false);
    assert.equal(ing.cobrados.importe, 0);
    assert.equal(await errorDe(rpc(admin, 'panel_mis_ingresos', manana, manana, null)), 'barbero_requerido');
    const oc = await rpc(beto, 'panel_ocupacion', manana, manana, ids.caro);
    assert.deepEqual([...new Set(oc.dias.map(d => d.barbero_id))], [ids.beto], 'ocupación propia aunque pida la de otro');
    assert.ok((await rpc(admin, 'panel_ocupacion', manana, manana, null)).barberos.length >= 3, 'el administrador ve todos');
});

test('desactivar un barbero bloquea su panel y sus avisos; conserva el historial', async () => {
    await A.query('update barberos set activo = false where id::text = $1', [ids.caro]);
    assert.equal((await rpc(caro, 'rol_panel')).rol, null);
    assert.equal(await errorDe(rpc(caro, 'panel_notificaciones', 30, null)), 'no_autorizado');
    assert.ok((await avisos(CARO)).length > 0, 'su historial se conserva');
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado)
                   select 'Cliente Inactivo', '8095550320', b.id, s.id, $1::date, '09:00', 'pendiente' from barberos b, servicios s
                    where b.id::text = $2 and s.nombre = 'Corte 60'`, [manana, ids.caro]);
    const ultima = (await avisos(ADMIN, 'cita_nueva')).at(-1);
    assert.match(ultima.cuerpo, /Cliente Inactivo/, 'el aviso va a administración');
    await A.query('update barberos set activo = true where id::text = $1', [ids.caro]);
});

// ---------------- Desactivar / reactivar el acceso y cambio de correo ----------------
test('desactivar el acceso bloquea el rol en el servidor sin perder historial; reactivar lo devuelve', async () => {
    const citasAntes = (await A.query('select count(*)::int n from citas where barbero_id::text = $1', [ids.beto])).rows[0].n;
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_acceso', ids.beto, false, null)), 'motivo_requerido');
    assert.equal(await errorDe(rpc(beto, 'panel_cuenta_acceso', ids.beto, false, 'Intento propio')), 'no_autorizado');
    await rpc(admin, 'panel_cuenta_acceso', ids.beto, false, 'Baja temporal');
    assert.equal((await rpc(beto, 'rol_panel')).rol, null, 'sin rol barbero');
    assert.equal(await errorDe(rpc(beto, 'panel_atencion', manana, null)), 'no_autorizado');
    const c = (await rpc(admin, 'panel_cuentas_barberos')).find(x => x.barbero_id === ids.beto);
    assert.deepEqual([c.acceso_activo, c.desactivado_por, c.motivo_desactivacion], [false, 'admin@x.com', 'Baja temporal']);
    // Sus nuevas citas avisan a administración, no a la cuenta desactivada
    const antes = (await avisos(BETO)).length;
    await reservar('Beto', manana, '17:00', '8095550330');
    assert.equal((await avisos(BETO)).length, antes);
    assert.match((await avisos(ADMIN, 'cita_nueva')).at(-1).cuerpo, /Cliente Aviso/);
    // La misma cuenta no puede vincularse a otro perfil mientras está desactivada
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.ana, email: 'beto@x.com', confirmar_existente: true }))), 'cuenta_vinculada_otro');
    await rpc(admin, 'panel_cuenta_acceso', ids.beto, true, null);
    assert.equal((await rpc(beto, 'rol_panel')).rol, 'barbero');
    assert.equal((await A.query('select count(*)::int n from citas where barbero_id::text = $1', [ids.beto])).rows[0].n, citasAntes + 1, 'citas conservadas');
    assert.ok((await A.query(`select count(*)::int n from auditoria where accion in ('acceso_desactivado', 'acceso_reactivado')`)).rows[0].n >= 2);
});

test('cambiar el correo de acceso: reemplazo explícito y atómico; la cuenta anterior no se borra', async () => {
    const OTRA = '12121212-1212-1212-1212-121212121212';
    await A.query(`insert into auth.users (id, email, encrypted_password) values ($1, 'beto.nuevo@x.com', 'h-nueva-cuenta')`, [OTRA]);
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto.nuevo@x.com', clave_temporal: true }))),
        'barbero_con_cuenta', 'sin reemplazar explícitamente no cambia');
    await A.query(`update auth.users set raw_app_meta_data = $2::jsonb where id = $1`, [OTRA, j({ barberia_alta_admin: ADMIN, barberia_alta_perfil: ids.beto })]);
    const r = await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto.nuevo@x.com', clave_temporal: true, reemplazar: true }));
    assert.equal(r.clave_temporal, true);
    assert.equal((await rpc(beto, 'rol_panel')).rol, null, 'la cuenta anterior deja de ser barbero');
    assert.equal((await A.query('select count(*)::int n from auth.users where id = $1', [BETO])).rows[0].n, 1, 'y sigue existiendo en Auth');
    assert.equal((await A.query('select user_id from barbero_usuarios where barbero_id = $1', [ids.beto])).rows[0].user_id, OTRA);
    // Se deja como estaba para el resto de pruebas
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto@x.com', confirmar_existente: true, reemplazar: true }));
    assert.equal((await rpc(beto, 'rol_panel')).rol, 'barbero');
});

test('reintentar vinculo conserva permisos; cuenta reciente ajena requiere confirmacion', async () => {
    await rpc(admin, 'panel_cuenta_permisos', ids.beto, j(['cajero']));
    await rpc(admin, 'panel_cuenta_vincular', j({ barbero_id: ids.beto, email: 'beto@x.com', permisos: [] }));
    assert.deepEqual((await rpc(beto, 'rol_panel')).permisos, ['cajero']);
    await rpc(admin, 'panel_cuenta_permisos', ids.beto, j([]));
    await A.query(`insert into auth.users (id,email,encrypted_password) values ('13131313-1313-1313-1313-131313131313','reciente@x.com','h')`);
    assert.equal(await errorDe(rpc(admin, 'panel_cuenta_vincular', j({barbero_id: ids.ana, email:'reciente@x.com', clave_temporal:true}))), 'cuenta_existente');
});
