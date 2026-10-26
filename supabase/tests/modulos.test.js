// Pruebas de la migración de módulos contra un PostgreSQL 17 real (embedded-postgres).
// Ejecutar: npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USUARIO_ID = '22222222-2222-2222-2222-222222222222';

let db, A, anon, servicio, adminCli, usuarioCli;

before(async () => {
    db = await iniciarBase(54331);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Isaac Garcia'), ('Yadfreidel Victoria'), ('Acxel Rosario'),
                   ('Barbero Stock'), ('Barbero Promo'), ('Barbero Ref'), ('Barbero Msg'), ('Barbero Espera')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte', 700, 60), ('Combo VIP', 1200, 90), ('Barba', 300, 30)`);
    // Dato existente antes de migrar
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora)
                   select 'Previo', '8090000000', 'p@x.com', b.id, s.id, current_date + 20, '09:00'
                     from barberos b, servicios s where b.nombre = 'Isaac Garcia' and s.nombre = 'Corte'`);
    await db.migrar();
    await A.query(`insert into auth.users values ($1), ($2)`, [ADMIN_ID, USUARIO_ID]);
    await A.query(`insert into admin_usuarios values ($1)`, [ADMIN_ID]);
    anon = await db.conexion('anon');
    servicio = await db.conexion('service_role');
    adminCli = await db.conexion('authenticated', ADMIN_ID);
    usuarioCli = await db.conexion('authenticated', USUARIO_ID);
});

after(() => db?.cerrar());

beforeEach(() => A.query(`update modulos_config set activo = false where modulo <> 'general'`));

const activar = (modulo, ajustes = {}) =>
    A.query(`update modulos_config set activo = true, ajustes = ajustes || $2::jsonb where modulo = $1`, [modulo, JSON.stringify(ajustes)]);

const reservar = (cli, { nombre = 'Cliente', tel, servicio: serv = 'Corte', barbero, fecha, hora, productos = [], codigo = null, consentimiento = false, precio = null }) =>
    rpc(cli, 'reservar_cita', nombre, 'c@x.com', tel, serv, barbero, fecha, hora, JSON.stringify(productos), codigo, consentimiento, precio);

// Cancelación desde el panel con sesión administrativa.
const cancelarDirecto = async token => {
    const { rows: [t] } = await A.query(`select cita_id from cita_tokens where token = $1`, [token]);
    await adminCli.query(`update citas set estado = 'cancelada' where id::text = $1`, [t.cita_id]);
};

const citasVivas = async (barbero, fecha, hora) => {
    const { rows } = await A.query(`select count(*)::int n from citas c join barberos b on b.id = c.barbero_id
                                    where b.nombre = $1 and c.fecha = $2 and c.hora = $3 and c.estado <> 'cancelada'`, [barbero, fecha, hora]);
    return rows[0].n;
};

test('migración aditiva, idempotente y con módulos desactivados', async () => {
    await db.migrar();
    const { rows } = await A.query(`select count(*)::int n from citas c join cita_tokens t on t.cita_id = c.id::text where c.nombre_cliente = 'Previo'`);
    assert.equal(rows[0].n, 1, 'la cita existente recibe token');
    const cfg = await rpc(anon, 'config_publica');
    assert.ok(Object.values(cfg.modulos).every(v => v === false), 'todos los módulos inician desactivados');
    assert.deepEqual(await rpc(anon, 'listar_productos'), []);
});

test('flujo existente: insert directo con anon key sigue funcionando y conserva anti double-booking', async () => {
    const fecha = await fechaLocal(A, 3);
    const ids = (await anon.query(`select (select id from barberos where nombre = 'Isaac Garcia') b, (select id from servicios where nombre = 'Corte') s`)).rows[0];
    const insertar = () => anon.query(`insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado)
                                       values ('Ana', '8091234567', 'a@x.com', $1, $2, $3, '10:00', 'pendiente')`, [ids.b, ids.s, fecha]);
    await insertar();
    await assert.rejects(insertar(), e => e.code === '23505');
    const { rows } = await adminCli.query(`select id, estado from citas where fecha = $1 and hora = '10:00'`, [fecha]);
    assert.equal(rows.length, 1);
    await adminCli.query(`update citas set estado = 'confirmada' where id = $1`, [rows[0].id]);
    const tokens = await A.query(`select count(*)::int n from cita_tokens where cita_id = $1`, [String(rows[0].id)]);
    assert.equal(tokens.rows[0].n, 1);
    // Un horario cancelado vuelve a quedar reservable (unicidad solo entre citas activas)
    await adminCli.query(`update citas set estado = 'cancelada' where id = $1`, [rows[0].id]);
    await insertar();
    await assert.rejects(insertar(), e => e.code === '23505' && e.message.includes('citas_barbero_id_fecha_hora'));
});

test('reservar_cita valida disponibilidad por duración, horario y precio en servidor', async () => {
    const fecha = await fechaLocal(A, 3);
    const b = 'Yadfreidel Victoria';
    const r = await reservar(anon, { tel: '8095550001', servicio: 'Combo VIP', barbero: b, fecha, hora: '10:00' });
    assert.equal(Number(r.precio_final), 1200);
    assert.ok(r.token);
    assert.equal(await errorDe(reservar(anon, { tel: '8095550002', barbero: b, fecha, hora: '11:00' })), 'horario_no_disponible', 'solapa con combo de 90 min');
    await reservar(anon, { tel: '8095550003', barbero: b, fecha, hora: '12:00' });
    assert.equal(await errorDe(reservar(anon, { tel: '8095550004', barbero: b, fecha, hora: '14:00', precio: 1 })), 'precio_cambiado');
    assert.equal(await errorDe(reservar(anon, { tel: '8095550005', servicio: 'Combo VIP', barbero: b, fecha, hora: '21:00' })), 'horario_no_disponible', 'excede el cierre de las 22:00');
    assert.equal(await errorDe(reservar(anon, { tel: '8095550006', barbero: b, fecha: await fechaLocal(A, -1), hora: '10:00' })), 'horario_no_disponible', 'fecha pasada');
    const libres = await rpc(anon, 'horarios_disponibles', 'Corte', b, fecha);
    assert.ok(!libres.includes('10:00') && !libres.includes('11:00') && !libres.includes('12:00') && libres.includes('13:00'));
});

test('confirmar, cancelar y reprogramar por token', async () => {
    const fecha = await fechaLocal(A, 4);
    const b = 'Acxel Rosario';
    const { token } = await reservar(anon, { tel: '8096660001', barbero: b, fecha, hora: '10:00' });
    await reservar(anon, { tel: '8096660002', barbero: b, fecha, hora: '12:00' });

    const horas = await rpc(anon, 'horarios_reprogramacion', token, fecha);
    assert.ok(horas.includes('10:00') && horas.includes('11:00') && !horas.includes('12:00'));

    const cot = await rpc(anon, 'cotizar_reprogramacion', token, fecha, '11:00');
    assert.equal(cot.disponible, true, 'se excluye la propia cita al cotizar');
    await rpc(anon, 'reprogramar_cita', token, fecha, '11:00', cot.precio_final);
    assert.equal((await rpc(anon, 'consultar_cita', token)).hora, '11:00');
    assert.equal(await errorDe(rpc(anon, 'reprogramar_cita', token, fecha, '12:00', null)), 'horario_no_disponible');

    assert.equal((await rpc(anon, 'confirmar_cita', token)).cliente_confirmo, true);

    await A.query(`update modulos_config set ajustes = ajustes || '{"horas_minimas_cambio": 500}' where modulo = 'general'`);
    assert.equal(await errorDe(rpc(anon, 'cancelar_cita', token)), 'fuera_de_plazo');
    await A.query(`update modulos_config set ajustes = ajustes || '{"horas_minimas_cambio": 1}' where modulo = 'general'`);

    assert.equal((await rpc(anon, 'cancelar_cita', token)).estado, 'cancelada');
    assert.equal((await rpc(anon, 'cancelar_cita', token)).estado, 'cancelada', 'idempotente');
    assert.equal(await errorDe(rpc(anon, 'reprogramar_cita', token, fecha, '14:00', null)), 'cita_cancelada');
    assert.equal(await errorDe(rpc(anon, 'consultar_cita', '00000000-0000-0000-0000-000000000000')), 'cita_no_encontrada');
});

test('lista de espera: orden, vencimiento, duración y aceptación atómica concurrente', async () => {
    await activar('lista_espera');
    const b = 'Barbero Espera';
    const fecha = await fechaLocal(A, 6);
    const c1 = await reservar(anon, { tel: '8097770001', barbero: b, fecha, hora: '10:00' });
    const c2 = await reservar(anon, { tel: '8097770002', barbero: b, fecha, hora: '14:00' });
    await reservar(anon, { tel: '8097770003', barbero: b, fecha, hora: '15:00' });

    const unir = (tel, serv, barbero) => rpc(anon, 'unirse_lista_espera', 'Espera ' + tel, tel, null, serv, barbero, fecha, fecha, '09:00', '18:00');
    const eCombo = await unir('8097771000', 'Combo VIP', b); // 90 min: no cabe a las 14:00 (15:00 ocupado)
    const e1 = await unir('8097771001', 'Corte', b);
    const e2 = await unir('8097771002', 'Corte', '');
    const e3 = await unir('8097771003', 'Corte', '');

    // Cancelación por el flujo existente (update directo del panel admin)
    await cancelarDirecto(c2.token);
    assert.equal(await citasVivas(b, fecha, '14:00'), 0);
    const oferta1 = (await rpc(anon, 'consultar_lista_espera', e1.token)).oferta;
    assert.ok(oferta1, 'primer compatible en orden recibe la oferta');
    assert.equal((await rpc(anon, 'consultar_lista_espera', eCombo.token)).oferta, null, 'no se ofrece si la duración no cabe');

    // Vence y pasa al siguiente
    await A.query(`update ofertas_espera set expira_en = now() - interval '1 second' where token = $1`, [oferta1.token]);
    assert.deepEqual(await rpc(anon, 'aceptar_oferta', oferta1.token), { ok: false, error: 'oferta_vencida' });
    assert.equal((await rpc(anon, 'consultar_lista_espera', e1.token)).estado, 'activa');
    const oferta2 = (await rpc(anon, 'consultar_lista_espera', e2.token)).oferta;
    assert.ok(oferta2, 'el siguiente en la lista recibe el espacio');

    // Dos aceptaciones simultáneas de la misma oferta -> una sola cita
    const conexiones = await Promise.all([db.conexion(), db.conexion(), db.conexion()]);
    const resultados = await Promise.all(conexiones.map(c => rpc(c, 'aceptar_oferta', oferta2.token)));
    assert.ok(resultados.every(r => r.ok && r.token === resultados[0].token), 'idempotente');
    assert.equal(await citasVivas(b, fecha, '14:00'), 1);
    assert.equal((await rpc(anon, 'consultar_lista_espera', e2.token)).estado, 'aceptada');

    // Aceptación compitiendo con una reserva directa del mismo espacio -> exactamente una cita
    await rpc(anon, 'cancelar_cita', c1.token);
    const oferta3 = (await rpc(anon, 'consultar_lista_espera', eCombo.token)).oferta;
    assert.ok(oferta3, 'a las 10:00 el combo de 90 min sí cabe y es el primero en orden');
    assert.equal((await rpc(anon, 'consultar_lista_espera', e1.token)).oferta, null);
    const [x, y] = await Promise.all([db.conexion(), db.conexion()]);
    const carrera = await Promise.allSettled([
        rpc(x, 'aceptar_oferta', oferta3.token),
        reservar(y, { tel: '8097779999', barbero: b, fecha, hora: '10:00' })
    ]);
    assert.equal(await citasVivas(b, fecha, '10:00'), 1, `resultado carrera: ${JSON.stringify(carrera.map(r => r.value ?? r.reason?.message))}`);
    assert.equal((await rpc(anon, 'consultar_lista_espera', e3.token)).estado, 'activa');
});

test('productos: stock concurrente, total separado y devolución por cancelación', async () => {
    const b = 'Barbero Stock';
    const fecha = await fechaLocal(A, 7);
    const { rows: [prod] } = await A.query(`insert into productos (nombre, precio, stock, activo) values ('Cera', 500, 3, true) returning id`);
    const item = [{ id: prod.id, cantidad: 1 }];
    assert.equal(await errorDe(reservar(anon, { tel: '8098880000', barbero: b, fecha, hora: '09:00', productos: item })), 'modulo_productos_inactivo');

    await activar('productos', { max_unidades_por_producto: 2 });
    assert.equal(await errorDe(reservar(anon, { tel: '8098880000', barbero: b, fecha, hora: '09:00', productos: [{ id: prod.id, cantidad: 3 }] })), 'cantidad_invalida');

    const horas = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
    const conexiones = await Promise.all(horas.map(() => db.conexion()));
    const res = await Promise.allSettled(horas.map((h, i) => reservar(conexiones[i], { tel: '80988800' + (10 + i), barbero: b, fecha, hora: h, productos: item })));
    const ok = res.filter(r => r.status === 'fulfilled');
    assert.equal(ok.length, 3, 'solo se venden 3 unidades');
    assert.ok(res.filter(r => r.status === 'rejected').every(r => r.reason.message === 'sin_stock'));
    const { rows: [estado] } = await A.query(`select stock from productos where id = $1`, [prod.id]);
    assert.equal(Number(estado.stock), 0);
    const { rows: [n] } = await A.query(`select count(*)::int n from citas c join barberos b on b.id = c.barbero_id where b.nombre = $1 and c.fecha = $2`, [b, fecha]);
    assert.equal(n.n, 3, 'las reservas sin stock no dejan cita creada');

    const primera = ok[0].value;
    assert.equal(Number(primera.total_productos), 500);
    assert.equal(Number(primera.precio_final), 700, 'el precio del servicio no cambia');

    await rpc(anon, 'cancelar_cita', primera.token);
    await rpc(anon, 'cancelar_cita', primera.token);
    await cancelarDirecto(primera.token);
    const { rows: [despues] } = await A.query(`select stock from productos where id = $1`, [prod.id]);
    assert.equal(Number(despues.stock), 1, 'se devuelve una sola vez');
    const { rows: movs } = await A.query(`select tipo, cantidad::int c from inventario_movimientos where producto_id = $1 order by id`, [prod.id]);
    assert.deepEqual(movs.map(m => m.tipo), ['inicial', 'reserva', 'reserva', 'reserva', 'reserva_liberada'], 'cada cambio de existencia queda en el historial');
    const det = await rpc(anon, 'consultar_cita', primera.token);
    assert.equal(det.productos[0].estado, 'devuelto');
});

test('referidos: sin autorreferido ni duplicados, otorgado una vez, reembolso', async () => {
    await activar('referidos', { beneficio_tipo: 'monto', beneficio_valor: 200 });
    const b = 'Barbero Ref';
    const f = await fechaLocal(A, 8);
    const r = await reservar(anon, { tel: '809-111-1111', barbero: b, fecha: f, hora: '09:00' });
    const { codigo } = await rpc(anon, 'mi_codigo_referido', r.token);
    assert.equal((await rpc(anon, 'mi_codigo_referido', r.token)).codigo, codigo, 'código estable');

    assert.deepEqual((await reservar(anon, { tel: '8091111111', barbero: b, fecha: f, hora: '10:00', codigo })).avisos, ['autorreferido_no_permitido']);
    assert.deepEqual((await reservar(anon, { tel: '8091111112', barbero: b, fecha: f, hora: '11:00', codigo: 'NOEXISTE' })).avisos, ['codigo_invalido']);
    const n1 = await reservar(anon, { tel: '8092222222', barbero: b, fecha: f, hora: '12:00', codigo });
    assert.deepEqual(n1.avisos, []);
    const n2 = await reservar(anon, { tel: '8092222222', barbero: b, fecha: f, hora: '13:00', codigo });
    assert.deepEqual(n2.avisos, ['ya_referido']);

    const idDe = async t => (await A.query(`select cita_id from cita_tokens where token = $1`, [t])).rows[0].cita_id;
    assert.equal(await errorDe(rpc(usuarioCli, 'admin_marcar_cita', await idDe(n1.token), 'completar_pagar')), 'no_autorizado');
    assert.match(await errorDe(rpc(anon, 'admin_marcar_cita', await idDe(n1.token), 'completar_pagar')), /permission denied/);

    await rpc(adminCli, 'admin_marcar_cita', await idDe(n1.token), 'completar_pagar');
    await rpc(adminCli, 'admin_marcar_cita', await idDe(n1.token), 'completar_pagar');
    await rpc(adminCli, 'admin_marcar_cita', await idDe(n2.token), 'completar_pagar');
    const ben = await A.query(`select * from beneficios where telefono = '8091111111'`);
    assert.equal(ben.rows.length, 1, 'beneficio otorgado una sola vez');
    assert.equal(Number(ben.rows[0].valor), 200);
    assert.equal((await rpc(anon, 'consultar_cita', r.token)).beneficios.length, 1);

    await rpc(adminCli, 'admin_marcar_cita', await idDe(n1.token), 'reembolsar');
    const tras = await A.query(`select b.estado, r.estado as ref from beneficios b join referidos r on r.id = b.referido_id where b.telefono = '8091111111'`);
    assert.deepEqual(tras.rows[0], { estado: 'anulado', ref: 'revertido' });

    // Cliente con visita pagada previa no cuenta como nuevo
    assert.deepEqual((await reservar(anon, { tel: '8092222222', barbero: b, fecha: f, hora: '14:00', codigo })).avisos, ['cliente_no_nuevo']);
});

test('promociones de horas vacías: mejor descuento sin acumular, cupo concurrente y validación', async () => {
    const b = 'Barbero Promo';
    const f = await fechaLocal(A, 9);
    const { rows: [p1] } = await A.query(`insert into promociones (nombre, activa, tipo, valor, fecha_desde, fecha_hasta, hora_desde, hora_hasta, max_usos)
                                          values ('Tarde 20%', true, 'porcentaje', 20, $1, $1, '14:00', '17:00', 1) returning id`, [f]);
    await A.query(`insert into promociones (nombre, activa, tipo, valor, fecha_desde, fecha_hasta, hora_desde, hora_hasta)
                   values ('Tarde -100', true, 'monto', 100, $1, $1, '14:00', '17:00')`, [f]);

    assert.equal(Number((await rpc(anon, 'cotizar_cita', 'Corte', b, f, '15:00')).descuento), 0, 'módulo desactivado: sin descuento');
    await activar('promociones');
    const q = await rpc(anon, 'cotizar_cita', 'Corte', b, f, '15:00');
    assert.equal(Number(q.descuento), 140);
    assert.equal(Number(q.precio_final), 560, 'se aplica solo la mejor promoción');
    assert.equal(Number((await rpc(anon, 'cotizar_cita', 'Corte', b, f, '10:00')).descuento), 0, 'fuera de franja');

    const [x, y] = await Promise.all([db.conexion(), db.conexion()]);
    const res = await Promise.allSettled([
        reservar(x, { tel: '8093330001', barbero: b, fecha: f, hora: '15:00', precio: 560 }),
        reservar(y, { tel: '8093330002', barbero: b, fecha: f, hora: '16:00', precio: 560 })
    ]);
    assert.equal(res.filter(r => r.status === 'fulfilled').length, 1, 'cupo de 1 uso respetado');
    assert.ok(['promocion_no_disponible', 'precio_cambiado'].includes(res.find(r => r.status === 'rejected').reason.message));
    const q2 = await rpc(anon, 'cotizar_cita', 'Corte', b, f, '14:00');
    assert.equal(Number(q2.precio_final), 600, 'agotada la primera, aplica la siguiente');

    const ganador = res.find(r => r.status === 'fulfilled').value;
    await rpc(anon, 'cancelar_cita', ganador.token);
    assert.equal((await A.query(`select usos from promociones where id = $1`, [p1.id])).rows[0].usos, 0, 'cancelar libera el cupo');
});

test('WhatsApp: recordatorios sin duplicados, no a canceladas, envío y webhook idempotentes', async () => {
    const b = 'Barbero Msg';
    const f = await fechaLocal(A, 2);
    const c1 = await reservar(anon, { tel: '8094440001', barbero: b, fecha: f, hora: '10:00' });
    const c2 = await reservar(anon, { tel: '8094440002', barbero: b, fecha: f, hora: '11:00' });
    const c3 = await reservar(anon, { tel: '8094440003', barbero: b, fecha: f, hora: '12:00' });
    const mensajes = async t => (await A.query(`select m.* from mensajes_whatsapp m join cita_tokens k on k.cita_id = m.cita_id where k.token = $1 order by creado_en`, [t])).rows;

    await rpc(servicio, 'procesar_tareas_programadas');
    assert.equal((await mensajes(c1.token)).length, 0, 'módulo desactivado: no encola');

    await activar('whatsapp', { horas_antes: [100, 2] });
    await rpc(servicio, 'procesar_tareas_programadas');
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.equal((await mensajes(c1.token)).length, 1, 'un solo recordatorio por cita y ventana');

    await rpc(anon, 'cancelar_cita', c2.token);
    assert.equal((await mensajes(c2.token))[0].estado, 'omitido');
    await rpc(anon, 'reprogramar_cita', c3.token, f, '13:00', null);
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.deepEqual((await mensajes(c3.token)).map(m => m.estado), ['omitido', 'pendiente'], 'reprogramar reemplaza el recordatorio');

    // Cancelada después de encolar pero antes de reclamar: no se envía
    const c4 = await reservar(anon, { tel: '8094440004', barbero: b, fecha: f, hora: '15:00' });
    await rpc(servicio, 'procesar_tareas_programadas');
    await cancelarDirecto(c4.token);
    await A.query(`update mensajes_whatsapp set estado = 'pendiente' where cita_id = (select cita_id from cita_tokens where token = $1)`, [c4.token]);

    // Dos workers en paralelo nunca reclaman el mismo mensaje
    const [w1, w2] = await Promise.all([db.conexion('service_role'), db.conexion('service_role')]);
    const [l1, l2] = await Promise.all([w1.query('select * from whatsapp_reclamar(100)'), w2.query('select * from whatsapp_reclamar(100)')]);
    const ids = [...l1.rows, ...l2.rows].map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, 'sin reclamos duplicados');
    assert.ok(!ids.includes((await mensajes(c4.token))[0].id), 'cita cancelada no se envía');
    assert.equal((await mensajes(c4.token))[0].estado, 'omitido');

    const m1 = (await mensajes(c1.token))[0];
    await rpc(servicio, 'whatsapp_resultado', m1.id, false, null, 'timeout', true);
    assert.equal((await mensajes(c1.token))[0].estado, 'pendiente', 'reintento programado');
    await A.query(`update mensajes_whatsapp set programado_para = now() where id = $1`, [m1.id]);
    await servicio.query('select * from whatsapp_reclamar(100)');
    await rpc(servicio, 'whatsapp_resultado', m1.id, true, 'wamid.X', null, false);
    await rpc(servicio, 'whatsapp_resultado', m1.id, false, null, 'tarde', true);
    assert.equal((await mensajes(c1.token))[0].estado, 'enviado', 'un resultado tardío no reabre un mensaje enviado');

    // Webhook: idempotente y ligado al teléfono del token
    assert.equal((await rpc(servicio, 'whatsapp_procesar_evento', 'wamid.A', '18094440001', 'CONFIRMAR:' + c1.token)).cliente_confirmo, true);
    assert.deepEqual(await rpc(servicio, 'whatsapp_procesar_evento', 'wamid.A', '18094440001', 'CONFIRMAR:' + c1.token), { duplicado: true });
    assert.equal((await rpc(servicio, 'whatsapp_procesar_evento', 'wamid.B', '18090000000', 'CANCELAR:' + c1.token)).error, 'token_no_corresponde');
    assert.equal((await rpc(servicio, 'whatsapp_procesar_evento', 'wamid.C', '18094440001', 'CANCELAR:' + c1.token)).estado, 'cancelada');

    assert.match(await errorDe(rpc(anon, 'whatsapp_procesar_evento', 'x', '1', 'CANCELAR:x')), /permission denied/);
    assert.match(await errorDe(anon.query('select * from whatsapp_reclamar(1)')), /permission denied/);
});

test('recuperación: solo con consentimiento, respeta frecuencia y baja', async () => {
    await activar('whatsapp');
    await activar('recuperacion', { dias_inactividad: 30, dias_entre_contactos: 20, max_contactos: 2 });
    const f = await fechaLocal(A, 10);
    const conConsent = await reservar(anon, { nombre: 'Kiko', tel: '8095550101', barbero: 'Isaac Garcia', fecha: f, hora: '13:00', consentimiento: true });
    await reservar(anon, { nombre: 'Sin', tel: '8095550102', barbero: 'Isaac Garcia', fecha: f, hora: '14:00' });
    await rpc(anon, 'cancelar_cita', conConsent.token);
    await A.query(`delete from citas where telefono_cliente = '8095550102'`);
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado, completada_en, pagada_en)
                   select x.n, x.t, '', b.id, s.id, current_date - 60, '10:00'::time, 'confirmada', now() - interval '60 days', now() - interval '60 days'
                     from (values ('Kiko', '8095550101'), ('Sin', '8095550102')) x(n, t), barberos b, servicios s
                    where b.nombre = 'Acxel Rosario' and s.nombre = 'Corte' and x.t = '8095550101'
                    union all
                   select 'Sin', '8095550102', '', b.id, s.id, current_date - 61, '10:00'::time, 'confirmada', now() - interval '61 days', now() - interval '61 days'
                     from barberos b, servicios s where b.nombre = 'Acxel Rosario' and s.nombre = 'Corte'`);
    const recuperacion = async () => (await A.query(`select telefono, estado from mensajes_whatsapp where tipo = 'recuperacion' order by creado_en`)).rows;

    await rpc(servicio, 'procesar_tareas_programadas');
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.deepEqual((await recuperacion()).map(m => m.telefono), ['8095550101'], 'solo con consentimiento y sin repetir');

    await A.query(`update clientes_contacto set ultimo_contacto_recuperacion = now() - interval '21 days' where telefono = '8095550101'`);
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.equal((await recuperacion()).length, 2, 'nuevo contacto tras el plazo');
    await A.query(`update clientes_contacto set ultimo_contacto_recuperacion = now() - interval '21 days' where telefono = '8095550101'`);
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.equal((await recuperacion()).length, 2, 'máximo de contactos respetado');

    await A.query(`update clientes_contacto set contactos_recuperacion = 0, ultimo_contacto_recuperacion = now() - interval '21 days' where telefono = '8095550101'`);
    const { rows: [cc] } = await A.query(`select token_baja from clientes_contacto where telefono = '8095550101'`);
    await rpc(anon, 'darse_de_baja', cc.token_baja);
    await rpc(servicio, 'procesar_tareas_programadas');
    assert.equal((await recuperacion()).length, 2, 'tras la baja no se contacta');
});

test('permisos: tablas y funciones protegidas, administración con Supabase Auth', async () => {
    assert.match(await errorDe(anon.query('select * from productos')), /permission denied/);
    assert.match(await errorDe(anon.query('select * from cita_tokens')), /permission denied/);
    assert.match(await errorDe(anon.query(`select public._cotizar('1', '1', current_date, '10:00')`)), /permission denied/);
    assert.match(await errorDe(rpc(anon, 'procesar_tareas_programadas')), /permission denied/);
    assert.match(await errorDe(rpc(anon, 'admin_guardar_modulo', 'productos', true, '{}')), /permission denied/);

    assert.equal(await errorDe(rpc(usuarioCli, 'admin_guardar_modulo', 'productos', true, '{}')), 'no_autorizado');
    assert.equal((await usuarioCli.query('select * from productos')).rows.length, 0, 'RLS oculta datos a no administradores');

    await rpc(adminCli, 'admin_guardar_modulo', 'productos', true, '{"max_unidades_por_producto": 4}');
    assert.equal((await rpc(anon, 'config_publica')).modulos.productos, true);
    assert.match(await errorDe(rpc(adminCli, 'admin_guardar_modulo', 'productos', true, '{"inventado": 1}')), /ajuste_invalido/);
    assert.match(await errorDe(rpc(adminCli, 'admin_guardar_modulo', 'whatsapp', true, '{"horas_antes": [0]}')), /ajuste_fuera_de_rango/);

    // Los artículos se crean por la función del inventario: la existencia inicial queda como movimiento
    assert.match(await errorDe(adminCli.query(`insert into productos (nombre, precio, stock, activo) values ('Gel', 300, 2, true)`)), /permission denied/);
    const p = await rpc(adminCli, 'panel_inv_guardar_producto', null, JSON.stringify({ nombre: 'Gel', precio: 300, existencia_inicial: 2 }));
    assert.match(await errorDe(adminCli.query(`update productos set stock = 99 where id = $1`, [p.id])), /permission denied/);
    assert.equal(Number((await rpc(adminCli, 'admin_ajustar_stock', p.id, -1)).stock), 1);
    assert.equal(await errorDe(rpc(adminCli, 'admin_ajustar_stock', p.id, -5)), 'stock_invalido');
});
