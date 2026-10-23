// Panel de administración contra PostgreSQL real: permisos por rol, agenda sin cruces,
// horarios y bloqueos, catálogo, cobros, clientes, negocio, WhatsApp y auditoría.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BARBERO = '55555555-5555-5555-5555-555555555555';
const OTRO = '66666666-6666-6666-6666-666666666666';
let db, A, anon, admin, barbero, otro, ids;

before(async () => {
    db = await iniciarBase(54337);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana Barbera'), ('Beto Barbero'), ('Caro Barbera')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte', 700, 60), ('Combo', 1200, 90), ('Barba', 300, 30)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'beto@x.com'), ($3, 'otro@x.com')`, [ADMIN, BARBERO, OTRO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    barbero = await db.conexion('authenticated', BARBERO);
    otro = await db.conexion('authenticated', OTRO);
    const { rows } = await A.query(`select (select id::text from barberos where nombre='Ana Barbera') ana, (select id::text from barberos where nombre='Beto Barbero') beto,
        (select id::text from barberos where nombre='Caro Barbera') caro, (select id::text from servicios where nombre='Corte') corte,
        (select id::text from servicios where nombre='Combo') combo, (select id::text from servicios where nombre='Barba') barba`);
    ids = rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
});

after(() => db?.cerrar());

beforeEach(async () => {
    await A.query(`delete from horarios_semana; delete from descansos; delete from bloqueos; delete from servicio_barberos;
                   update modulos_config set ajustes = ajustes || '{"anticipacion_minima_minutos":0,"max_dias_reserva":0,"minutos_entre_citas":0}'
                    where modulo = 'general'; update modulos_config set activo = false where modulo <> 'general'`);
});

const crear = (cli, datos) => rpc(cli, 'panel_crear_cita', JSON.stringify(datos));
const accion = (cli, id, nombre, datos = {}) => rpc(cli, 'panel_actualizar_cita', id, nombre, JSON.stringify(datos));
const cita = (barberoId, fecha, hora, extra = {}) => ({ nombre: 'Cliente Prueba', telefono: '809-555-0100', servicio_id: ids.corte,
    barbero_id: barberoId, fecha, hora, ...extra });
const diaSemana = async (n, dow) => {
    // Próxima fecha (a partir de hoy + n) que cae en el día de la semana dow (0 = domingo)
    const { rows } = await A.query(`select (d)::date::text f from generate_series(_ahora_local()::date + $1::int, _ahora_local()::date + $1::int + 6, '1 day') d
                                    where extract(dow from d) = $2 limit 1`, [n, dow]);
    return rows[0].f;
};

test('permisos: anon y usuarios sin rol no acceden; barbero solo a su agenda', async () => {
    assert.match(await errorDe(rpc(anon, 'panel_resumen')), /permission denied/);
    assert.equal(await errorDe(rpc(otro, 'panel_resumen')), 'no_autorizado');
    assert.equal(await errorDe(rpc(otro, 'panel_citas', '2026-01-01', '2026-01-31', null, null, null)), 'no_autorizado');
    assert.deepEqual(await rpc(barbero, 'rol_panel'), { rol: 'barbero', barbero_id: ids.beto, barbero_nombre: 'Beto Barbero' });
    assert.equal((await rpc(admin, 'rol_panel')).rol, 'admin');
    assert.equal((await rpc(otro, 'rol_panel')).rol, null);

    const f = await fechaLocal(A, 5);
    const deAna = await crear(admin, cita(ids.ana, f, '10:00'));
    const deBeto = await crear(admin, cita(ids.beto, f, '10:00', { nombre: 'Cliente Beto' }));
    const agenda = await rpc(barbero, 'panel_citas', f, f, ids.ana, null, null);
    assert.deepEqual(agenda.map(c => c.id), [deBeto.id], 'el barbero no puede pedir la agenda de otro');
    assert.equal(agenda[0].token, null, 'el barbero no ve el token de gestión del cliente');
    assert.equal((await barbero.query('select * from citas')).rowCount, 1, 'RLS: solo su agenda');

    assert.equal(await errorDe(rpc(barbero, 'panel_cita', deAna.id)), 'cita_no_encontrada');
    assert.equal(await errorDe(accion(barbero, deAna.id, 'completar')), 'cita_no_encontrada');
    assert.equal(await errorDe(accion(barbero, deBeto.id, 'cancelar', { motivo: 'No puedo' })), 'no_autorizado');
    assert.equal(await errorDe(accion(barbero, deBeto.id, 'registrar_pago', { monto: 700, metodo: 'efectivo' })), 'no_autorizado');
    assert.equal(await errorDe(accion(barbero, deBeto.id, 'reprogramar', { fecha: f, hora: '12:00' })), 'no_autorizado');
    assert.equal(await errorDe(crear(barbero, cita(ids.beto, f, '15:00'))), 'no_autorizado');
    assert.equal(await errorDe(rpc(barbero, 'panel_clientes', null)), 'no_autorizado', 'datos de clientes solo para administradores');
    assert.equal(await errorDe(rpc(barbero, 'panel_reporte', f, f)), 'no_autorizado');
    await accion(barbero, deBeto.id, 'notas', { notas: 'Prefiere tijera' });
    assert.equal((await accion(barbero, deBeto.id, 'completar')).estado_visual, 'completada');
    assert.equal((await rpc(barbero, 'panel_resumen')).cobrado_mes, null, 'el barbero no ve ingresos');

    // Barbero desactivado: pierde el acceso sin borrar su historial
    await rpc(admin, 'panel_guardar_barbero', ids.beto, JSON.stringify({ nombre: 'Beto Barbero', activo: false }));
    assert.equal((await rpc(barbero, 'rol_panel')).rol, null);
    assert.equal(await errorDe(rpc(barbero, 'panel_resumen')), 'no_autorizado');
    assert.equal((await A.query('select count(*)::int n from citas where barbero_id::text = $1', [ids.beto])).rows[0].n, 1);
    await rpc(admin, 'panel_guardar_barbero', ids.beto, JSON.stringify({ nombre: 'Beto Barbero', activo: true }));
});

test('citas desde administración: sin cruces, duración real, servicio y barbero activos', async () => {
    const f = await fechaLocal(A, 6);
    const c1 = await crear(admin, cita(ids.ana, f, '10:00', { servicio_id: ids.combo, notas: 'Cliente llamó por teléfono' }));
    assert.equal(c1.origen, 'admin');
    assert.equal(c1.estado, 'confirmada');
    assert.equal(c1.fin, '11:30');
    assert.equal(c1.email, null, 'sin correo');
    assert.equal(await errorDe(crear(admin, cita(ids.ana, f, '11:00'))), 'horario_no_disponible', 'combo de 90 min ocupa hasta 11:30');
    const walkIn = await crear(admin, cita(ids.ana, f, '11:30'));
    assert.equal(walkIn.hora, '11:30', 'el admin puede registrar horas fuera de la cuadrícula');
    assert.equal(await errorDe(crear(admin, cita(ids.ana, f, '21:30'))), 'horario_no_disponible', 'sobrepasa el cierre de las 22:00');
    // Una reserva pública tampoco puede pisar una cita creada por el admin
    assert.equal(await errorDe(rpc(anon, 'reservar_cita', 'Web', null, '8095550111', 'Corte', 'Ana Barbera', f, '10:00')), 'horario_no_disponible');
    assert.ok(!(await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', f)).includes('11:00'));
    // Inserción directa legada con la anon key también se valida por duración
    const { rows: [r] } = await A.query(`select (select id from barberos where nombre='Ana Barbera') b, (select id from servicios where nombre='Barba') s`);
    await assert.rejects(anon.query(`insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado)
                                     values ('Directa', '8090001111', null, $1, $2, $3, '10:30', 'pendiente')`, [r.b, r.s, f]), e => e.code === '23505');

    // Servicio limitado a ciertos barberos
    await rpc(admin, 'panel_guardar_servicio', ids.barba, JSON.stringify({ nombre: 'Barba', precio: 300, duracion_minutos: 30, barberos: [ids.caro] }));
    assert.equal(await errorDe(crear(admin, cita(ids.ana, f, '15:00', { servicio_id: ids.barba }))), 'barbero_no_realiza_servicio');
    assert.deepEqual(await rpc(anon, 'horarios_disponibles', 'Barba', 'Ana Barbera', f), []);
    assert.equal((await crear(admin, cita(ids.caro, f, '15:00', { servicio_id: ids.barba }))).barbero, 'Caro Barbera');

    // Servicio desactivado: no se reserva, pero las citas registradas se conservan
    await rpc(admin, 'panel_guardar_servicio', ids.combo, JSON.stringify({ nombre: 'Combo', precio: 1200, duracion_minutos: 90, activo: false }));
    assert.equal(await errorDe(crear(admin, cita(ids.caro, f, '16:00', { servicio_id: ids.combo }))), 'servicio_no_disponible');
    assert.match(await errorDe(rpc(anon, 'reservar_cita', 'Web', null, '8095550112', 'Combo', 'Caro Barbera', f, '16:00')), /servicio_o_barbero_no_encontrado/);
    assert.equal((await rpc(admin, 'panel_cita', c1.id)).servicio, 'Combo');
    await rpc(admin, 'panel_guardar_servicio', ids.combo, JSON.stringify({ nombre: 'Combo', precio: 1200, duracion_minutos: 90, activo: true }));
});

test('horarios: por día y barbero, descansos, bloqueos, margen, anticipación y límite de días', async () => {
    const domingo = await diaSemana(3, 0);
    const lunes = await diaSemana(3, 1);
    const dias = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, activo: dia !== 0, abre: '09:00', cierra: dia === 6 ? '14:00' : '19:00',
        descansos: dia === 1 ? [{ desde: '13:00', hasta: '14:00' }] : [] }));
    await rpc(admin, 'panel_guardar_semana', null, JSON.stringify(dias));
    assert.deepEqual(await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', domingo), [], 'domingo cerrado');
    const horasLunes = await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', lunes);
    assert.ok(!horasLunes.includes('13:00') && !horasLunes.includes('12:30') && horasLunes.includes('12:00') && horasLunes.includes('18:00'));
    assert.ok(!horasLunes.includes('19:00'), 'cierra a las 19:00');
    assert.equal(await errorDe(crear(admin, cita(ids.ana, lunes, '12:30'))), 'horario_no_disponible', 'el descanso aplica también al admin');

    // Horario propio de un barbero (Caro entra a las 12:00 los lunes)
    await rpc(admin, 'panel_guardar_semana', ids.caro, JSON.stringify([{ dia: 1, activo: true, abre: '12:00', cierra: '20:00', descansos: [] }]));
    const horasCaro = await rpc(anon, 'horarios_disponibles', 'Corte', 'Caro Barbera', lunes);
    assert.equal(horasCaro[0], '12:00');
    assert.ok(horasCaro.includes('19:00'));

    // Bloqueos: vacaciones de un barbero (día completo) y hora bloqueada para todos
    const vac = await rpc(admin, 'panel_guardar_bloqueo', JSON.stringify({ barbero_id: ids.caro, fecha_desde: lunes, tipo: 'vacaciones', motivo: 'Viaje' }));
    assert.deepEqual(await rpc(anon, 'horarios_disponibles', 'Corte', 'Caro Barbera', lunes), []);
    assert.ok((await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', lunes)).length > 0, 'los demás siguen disponibles');
    const reservada = await crear(admin, cita(ids.ana, lunes, '16:00'));
    const parcial = await rpc(admin, 'panel_guardar_bloqueo', JSON.stringify({ fecha_desde: lunes, hora_desde: '15:00', hora_hasta: '17:00', tipo: 'bloqueo' }));
    assert.deepEqual(parcial.citas_afectadas.map(c => c.id), [reservada.id], 'informa las citas ya reservadas en el bloqueo');
    assert.equal((await rpc(admin, 'panel_cita', reservada.id)).estado, 'confirmada', 'no las cancela solas');
    assert.ok(!(await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', lunes)).includes('15:00'));
    await rpc(admin, 'panel_desactivar_bloqueo', vac.id);
    assert.ok((await rpc(anon, 'horarios_disponibles', 'Corte', 'Caro Barbera', lunes)).length > 0, 'desactivar el bloqueo libera el día');

    // Margen entre citas
    await A.query(`delete from horarios_semana; delete from descansos; update bloqueos set activo = false`);
    const f = await fechaLocal(A, 8);
    await crear(admin, cita(ids.caro, f, '10:00'));
    await rpc(admin, 'panel_guardar_reglas', JSON.stringify({ minutos_entre_citas: 15 }));
    assert.equal(await errorDe(crear(admin, cita(ids.caro, f, '11:00'))), 'horario_no_disponible', '15 min de margen tras la cita');
    assert.ok((await crear(admin, cita(ids.caro, f, '11:15'))).id);

    // Anticipación y límite de días: solo para la web
    await rpc(admin, 'panel_guardar_reglas', JSON.stringify({ minutos_entre_citas: 0, max_dias_reserva: 5, anticipacion_minima_minutos: 1440 }));
    const lejos = await fechaLocal(A, 9);
    assert.deepEqual(await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', lejos), [], 'más allá del límite de días');
    assert.ok((await crear(admin, cita(ids.ana, lejos, '10:00'))).id, 'el admin sí puede agendar');
    assert.deepEqual(await rpc(anon, 'horarios_disponibles', 'Corte', 'Ana Barbera', await fechaLocal(A, 0)), [], 'anticipación de 24 h');
    assert.match(await errorDe(rpc(admin, 'panel_guardar_reglas', JSON.stringify({ max_dias_reserva: 999 }))), /regla_invalida/);
    assert.match(await errorDe(rpc(admin, 'panel_guardar_reglas', JSON.stringify({ zona_horaria: 'Marte/Base' }))), /time zone/);
    assert.equal((await rpc(admin, 'panel_horarios')).reglas.zona_horaria, 'America/Santo_Domingo');
});

test('flujo completo: confirmar, reprogramar, cancelar con motivo, no asistió, completar y cobrar por separado', async () => {
    const f = await fechaLocal(A, 10);
    const reservada = await rpc(anon, 'reservar_cita', 'Lucía Web', null, '8095557777', 'Corte', 'Ana Barbera', f, '09:00');
    const { rows: [{ cita_id: id }] } = await A.query('select cita_id from cita_tokens where token = $1', [reservada.token]);

    assert.equal((await accion(admin, id, 'confirmar')).estado, 'confirmada');
    assert.equal(await errorDe(accion(admin, id, 'confirmar')), 'cita_no_pendiente');
    await crear(admin, cita(ids.ana, f, '11:00'));
    assert.equal(await errorDe(accion(admin, id, 'reprogramar', { fecha: f, hora: '10:30' })), 'horario_no_disponible');
    const movida = await accion(admin, id, 'reprogramar', { fecha: f, hora: '14:00', barbero_id: ids.caro });
    assert.deepEqual([movida.hora, movida.barbero], ['14:00', 'Caro Barbera']);
    assert.equal(Number(movida.precio), 700, 'conserva el precio original');
    assert.equal(await errorDe(accion(admin, id, 'no_asistio')), 'cita_aun_no_ocurre');
    assert.equal(await errorDe(accion(admin, id, 'cancelar', { motivo: '' })), 'motivo_requerido');
    const cancelada = await accion(admin, id, 'cancelar', { motivo: 'Cliente enfermo' });
    assert.deepEqual([cancelada.estado_visual, cancelada.motivo_cancelacion], ['cancelada', 'Cliente enfermo']);
    assert.equal(await errorDe(accion(admin, id, 'completar')), 'cita_cancelada');
    const historial = (await rpc(admin, 'panel_cita', id)).historial.map(h => [h.accion, h.rol]);
    assert.deepEqual(historial, [['cita_creada', 'web'], ['cita_confirmada', 'admin'], ['cita_reprogramada', 'admin'], ['cita_cancelada', 'admin']]);
    assert.equal((await A.query(`select usuario_id::text from auditoria where entidad_id = $1 and accion = 'cita_cancelada'`, [id])).rows[0].usuario_id, ADMIN);

    // Cita pasada: no asistió / completada y pagada por separado
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado)
                   select 'Pedro Pasado', '8095558888', b.id, s.id, _ahora_local()::date - 2, '10:00', 'confirmada'
                     from barberos b, servicios s where b.nombre = 'Ana Barbera' and s.nombre = 'Corte'`);
    const { rows: [{ id: pasada }] } = await A.query(`select id::text from citas where nombre_cliente = 'Pedro Pasado'`);
    const completada = await accion(admin, pasada, 'completar');
    assert.deepEqual([completada.estado_visual, completada.pagada], ['completada', false], 'completar no la marca como pagada');
    assert.equal(await errorDe(accion(admin, pasada, 'registrar_pago', { monto: -5, metodo: 'efectivo' })), 'pago_invalido');
    assert.equal(await errorDe(accion(admin, pasada, 'registrar_pago', { monto: 700, metodo: 'cripto' })), 'pago_invalido');
    const pagada = await accion(admin, pasada, 'registrar_pago', { monto: 650, metodo: 'transferencia' });
    assert.deepEqual([pagada.pagada, Number(pagada.monto_cobrado), pagada.metodo_pago], [true, 650, 'transferencia']);
    assert.equal(await errorDe(accion(admin, pasada, 'no_asistio')), 'cita_completada');

    const resumen = await rpc(admin, 'panel_resumen');
    assert.ok(Number(resumen.cobrado_hoy) >= 650, 'cobrado (por fecha de cobro)');
    assert.ok(Number(resumen.estimado_reservas) > 0, 'valor estimado de reservas separado');
    const rep = await rpc(admin, 'panel_reporte', await fechaLocal(A, -3), await fechaLocal(A, 30));
    assert.equal(Number(rep.por_metodo.transferencia), 650);
    assert.ok(rep.incidencias.some(i => i.tipo === 'cancelada' && i.motivo === 'Cliente enfermo'));
    assert.ok(rep.por_barbero.some(b => b.barbero === 'Ana Barbera' && Number(b.cobrado) === 650));
});

test('catálogo: precios y duración de citas registradas no cambian; orden, duplicados y catálogo público', async () => {
    const f = await fechaLocal(A, 12);
    const c = await crear(admin, cita(ids.caro, f, '09:00'));
    await rpc(admin, 'panel_guardar_servicio', ids.corte, JSON.stringify({ nombre: 'Corte', precio: 900, duracion_minutos: 45 }));
    const despues = await rpc(admin, 'panel_cita', c.id);
    assert.deepEqual([Number(despues.precio), despues.duracion], [700, 60], 'la cita conserva precio y duración originales');
    assert.equal(Number((await crear(admin, cita(ids.caro, f, '11:00'))).precio), 900, 'las nuevas usan la tarifa actual');

    const nuevo = await rpc(admin, 'panel_guardar_servicio', null, JSON.stringify({ nombre: 'Cejas', descripcion: 'Perfilado', categoria: 'diseños',
        precio: 250, duracion_minutos: 15, destacado: true, imagen_url: 'data:image/webp;base64,UklGRg==' }));
    assert.equal(await errorDe(rpc(admin, 'panel_guardar_servicio', null, JSON.stringify({ nombre: 'cejas', precio: 1, duracion_minutos: 10 }))), 'servicio_duplicado');
    assert.equal(await errorDe(rpc(admin, 'panel_guardar_servicio', null, JSON.stringify({ nombre: 'Malo', precio: 1, duracion_minutos: 10, imagen_url: 'javascript:alert(1)' }))), 'servicio_invalido');
    assert.equal(await errorDe(rpc(admin, 'panel_guardar_servicio', null, JSON.stringify({ nombre: 'Sin precio', duracion_minutos: 10 }))), 'servicio_invalido');
    let publico = await rpc(anon, 'catalogo_publico');
    assert.ok(publico.some(s => s.id === nuevo.id && s.destacado), 'el servicio nuevo aparece en el catálogo');
    assert.ok(!publico.some(s => s.nombre === 'Corte'), 'los servicios anteriores al catálogo siguen fuera de la vista pública');
    await rpc(admin, 'panel_ordenar_servicios', [nuevo.id, ids.corte]);
    assert.equal((await rpc(admin, 'panel_servicios'))[0].id, nuevo.id);
    await rpc(admin, 'panel_guardar_servicio', nuevo.id, JSON.stringify({ nombre: 'Cejas', precio: 250, duracion_minutos: 15, activo: false }));
    publico = await rpc(anon, 'catalogo_publico');
    assert.ok(!publico.some(s => s.id === nuevo.id), 'desactivado: fuera del catálogo');
    assert.ok((await rpc(anon, 'barberos_publicos')).every(b => b.nombre));
});

test('clientes: búsqueda, posibles duplicados por teléfono, edición e historial', async () => {
    const f = await fechaLocal(A, 14);
    await crear(admin, cita(ids.ana, f, '09:00', { nombre: 'Mario Pérez', telefono: '809-555-0199' }));
    await crear(admin, cita(ids.ana, f, '10:00', { nombre: 'Mario P.', telefono: '1 (809) 555-0199' }));
    const lista = await rpc(admin, 'panel_clientes', '555-0199');
    assert.equal(lista.length, 1, 'mismo teléfono agrupado');
    assert.equal(lista[0].posible_duplicado, true);
    assert.equal(lista[0].total_citas, 2);
    assert.equal((await rpc(admin, 'panel_clientes', 'mario')).length, 1);

    const ficha = await rpc(admin, 'panel_guardar_cliente', '8095550199', JSON.stringify({ nombre: 'Mario Pérez', notas: 'Alergia a lociones',
        preferencias: { barbero: 'Ana Barbera' }, actualizar_citas_futuras: true }));
    assert.equal(ficha.ficha.notas, 'Alergia a lociones');
    assert.ok(ficha.historial.every(c => c.cliente === 'Mario Pérez'), 'citas futuras unificadas');
    assert.equal(await errorDe(rpc(admin, 'panel_guardar_cliente', '8095550199', JSON.stringify({ nombre: '' }))), 'cliente_invalido');
});

test('negocio: validación y publicación; plantillas y avisos automáticos reales', async () => {
    assert.equal(await rpc(anon, 'negocio_publico'), null);
    assert.equal(await errorDe(rpc(admin, 'panel_guardar_negocio', JSON.stringify({ nombre: 'X', logo_url: 'javascript:alert(1)' }))), 'negocio_invalido');
    assert.match(await errorDe(rpc(admin, 'panel_guardar_negocio', JSON.stringify({ redes: { instagram: 'http://inseguro.com' } }))), /redes/);
    await rpc(admin, 'panel_guardar_negocio', JSON.stringify({ nombre: 'Barbería Master', whatsapp: '8292466177', telefono: '8292466177',
        horarios_publicos: ['Lun - Sáb: 9:00 AM - 7:00 PM'], redes: { instagram: 'https://instagram.com/barberia' },
        faq: [{ pregunta: '¿Aceptan tarjeta?', respuesta: 'Sí.' }] }));
    assert.equal((await rpc(anon, 'negocio_publico')).nombre, 'Barbería Master');
    assert.equal(await errorDe(rpc(otro, 'panel_guardar_negocio', JSON.stringify({ nombre: 'Hack' }))), 'no_autorizado');

    // Sin plantilla de Meta o con WhatsApp desactivado: no se encola nada (no se simulan envíos)
    const f = await fechaLocal(A, 16);
    const c1 = await crear(admin, cita(ids.caro, f, '09:00'));
    await A.query(`update modulos_config set activo = true where modulo = 'whatsapp'`);
    const c2 = await crear(admin, cita(ids.caro, f, '10:00'));
    assert.equal((await rpc(admin, 'panel_cita', c2.id)).mensajes.length, 0, 'sin plantilla aprobada no hay envío automático');
    await rpc(admin, 'panel_guardar_plantilla', 'confirmacion', 'Hola {cliente}', 'cita_confirmada');
    await rpc(admin, 'panel_guardar_plantilla', 'cancelacion', 'Cancelada {cliente}', 'cita_cancelada');
    assert.match(await errorDe(rpc(admin, 'panel_guardar_plantilla', 'confirmacion', 'x', 'Nombre Con Espacios')), /plantilla_invalida/);
    const c3 = await crear(admin, cita(ids.caro, f, '11:00', { nombre: 'Rosa', telefono: '8095550300' }));
    await accion(admin, c3.id, 'cancelar', { motivo: 'Lluvia fuerte' });
    const mensajes = (await rpc(admin, 'panel_cita', c3.id)).mensajes;
    assert.deepEqual(mensajes.map(m => [m.tipo, m.estado]), [['confirmacion', 'pendiente'], ['cancelacion', 'pendiente']]);
    const { rows: [m] } = await A.query(`select parametros from mensajes_whatsapp where cita_id = $1 and tipo = 'confirmacion'`, [c3.id]);
    assert.deepEqual(m.parametros.slice(0, 5), ['Rosa', 'Corte', 'Caro Barbera', f.split('-').reverse().join('/'), '11:00']);
    assert.equal((await rpc(admin, 'panel_plantillas')).envio_automatico_activo, true);
    await accion(admin, c1.id, 'notas', { notas: 'x' });
    assert.ok((await rpc(admin, 'panel_auditoria', 50)).some(a => a.accion === 'negocio_publicado' && a.usuario === 'admin@x.com'));
});
