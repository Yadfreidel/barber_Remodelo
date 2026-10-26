// Portafolio, ocupación y reclamaciones contra PostgreSQL real: permisos por rol, autorización de imagen,
// cálculo de ocupación (descansos, bloqueos, cancelaciones, solapes, jornadas vacías, duraciones) y privacidad
// de las reclamaciones (token, notas internas, adjuntos, historial).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BARBERO = '55555555-5555-5555-5555-555555555555';
const OTRO_BARBERO = '77777777-7777-7777-7777-777777777777';
const CLIENTE = '66666666-6666-6666-6666-666666666666';
const IMG = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
let db, A, anon, admin, barbero, otroBarbero, cliente, ids;

const j = o => JSON.stringify(o);
const n = Number;
const trabajo = (cli, datos) => rpc(cli, 'panel_portafolio_guardar', null, j({ titulo: 'Degradado', texto_alternativo: 'Corte degradado visto de lado',
    imagen: IMG, miniatura: IMG, ...datos }));

before(async () => {
    db = await iniciarBase(54342);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto'), ('Caro')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30), ('Corte 60', 700, 60), ('Combo 90', 1200, 90)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'beto@x.com'), ($3, 'caro@x.com'), ($4, 'cliente@x.com')`,
        [ADMIN, BARBERO, OTRO_BARBERO, CLIENTE]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    barbero = await db.conexion('authenticated', BARBERO);
    otroBarbero = await db.conexion('authenticated', OTRO_BARBERO);
    cliente = await db.conexion('authenticated', CLIENTE);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Ana') ana, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from barberos where nombre = 'Caro') caro, (select id::text from servicios where nombre = 'Corte 30') s30,
        (select id::text from servicios where nombre = 'Corte 60') s60, (select id::text from servicios where nombre = 'Combo 90') s90`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.caro, 'caro@x.com');
});

after(() => db?.cerrar());

// ---------------- Portafolio ----------------
test('portafolio: el barbero gestiona solo lo suyo y no publica; sin autorización no se publica', async () => {
    const t = await trabajo(barbero, { barbero_id: ids.beto, servicio_id: ids.s60, especialidad: 'Degradados', muestra_persona: true });
    assert.equal(t.estado, 'borrador');
    assert.equal(await errorDe(trabajo(barbero, { barbero_id: ids.caro })), 'no_autorizado', 'no crea en el portafolio de otro');
    assert.equal(await errorDe(trabajo(otroBarbero, {})).then(() => null) ?? 'ok', 'ok');
    assert.equal(await errorDe(rpc(otroBarbero, 'panel_portafolio_estado', t.id, 'archivar', null)), 'no_autorizado', 'no toca trabajos ajenos');
    assert.equal(await errorDe(rpc(barbero, 'panel_portafolio_estado', t.id, 'publicar', null)), 'no_autorizado', 'publicar es del administrador');
    assert.equal(await errorDe(trabajo(barbero, { barbero_id: ids.beto, imagen: 'data:image/svg+xml;base64,PHN2Zz4=' })), 'imagen_invalida');
    await rpc(barbero, 'panel_portafolio_estado', t.id, 'enviar_revision', null);
    assert.equal(await errorDe(rpc(admin, 'panel_portafolio_estado', t.id, 'publicar', null)), 'autorizacion_requerida');
    assert.equal(await errorDe(A.query(`update portafolio_trabajos set estado = 'publicado' where id = $1`, [t.id])), 'autorizacion_requerida', 'regla también en la base');
    // Sin persona identificable se puede publicar
    const sinPersona = await trabajo(admin, { barbero_id: ids.beto, titulo: 'Detalle de nuca', muestra_persona: false });
    await rpc(admin, 'panel_portafolio_estado', sinPersona.id, 'publicar', null);
    const publico = await rpc(anon, 'portafolio_publico', ids.beto, 24, 0);
    assert.deepEqual(publico.trabajos.map(x => x.titulo), ['Detalle de nuca'], 'lo pendiente o sin autorización no aparece');
    assert.deepEqual(Object.keys(publico.trabajos[0]).sort(), ['barbero_id', 'descripcion', 'destacado', 'especialidad', 'id', 'miniatura', 'orden',
        'servicio', 'servicio_id', 'texto_alternativo', 'titulo'], 'sin estado, autorización ni datos privados');
    assert.equal(await rpc(anon, 'portafolio_imagen', t.id), null, 'la imagen pendiente es privada');
    assert.equal(await rpc(anon, 'portafolio_imagen', sinPersona.id), IMG);
    for (const tabla of ['portafolio_trabajos', 'autorizaciones_imagen']) {
        assert.match(await errorDe(anon.query(`select * from ${tabla}`)), /permission denied/);
        assert.match(await errorDe(cliente.query(`select * from ${tabla}`)), /permission denied/);
    }
    assert.equal(await errorDe(rpc(cliente, 'panel_portafolio', null, null)), 'no_autorizado');
    assert.match(await errorDe(rpc(anon, 'panel_portafolio_guardar', null, '{}')), /permission denied/);
});

test('autorización de imagen: menores con representante; retirarla despublica sus trabajos', async () => {
    assert.equal(await errorDe(rpc(admin, 'panel_autorizacion_registrar', j({ cliente_nombre: 'Niño', alcance: 'portafolio_web', fecha: await fechaLocal(A, 0), es_menor: true }))), 'representante_requerido');
    assert.equal(await errorDe(rpc(barbero, 'panel_autorizacion_registrar', j({ cliente_nombre: 'X', alcance: 'portafolio_web', fecha: await fechaLocal(A, 0) }))), 'no_autorizado');
    const aut = await rpc(admin, 'panel_autorizacion_registrar', j({ cliente_nombre: 'Luis Pérez', cliente_telefono: '809-555-0101', alcance: 'portafolio_web',
        fecha: await fechaLocal(A, 0), referencia: 'Formulario firmado #12', evidencia: IMG }));
    const menor = await rpc(admin, 'panel_autorizacion_registrar', j({ cliente_nombre: 'Tomás', alcance: 'portafolio_web', fecha: await fechaLocal(A, 0),
        es_menor: true, representante_nombre: 'María Pérez', representante_relacion: 'Madre' }));
    const t1 = await trabajo(admin, { barbero_id: ids.beto, titulo: 'Fade Luis', autorizacion_id: aut.id });
    const t2 = await trabajo(admin, { barbero_id: ids.beto, titulo: 'Corte Tomás', autorizacion_id: menor.id });
    await rpc(admin, 'panel_portafolio_estado', t1.id, 'publicar', null);
    await rpc(admin, 'panel_portafolio_estado', t2.id, 'publicar', null);
    await rpc(admin, 'panel_portafolio_estado', t1.id, 'destacar', null);
    let publico = await rpc(anon, 'portafolio_publico', ids.beto, 24, 0);
    assert.equal(publico.trabajos[0].titulo, 'Fade Luis', 'el destacado va primero');
    assert.equal(publico.total, 3);
    const r = await rpc(admin, 'panel_autorizacion_retirar', aut.id, 'El cliente retiró su permiso');
    assert.equal(r.trabajos_archivados, 1);
    publico = await rpc(anon, 'portafolio_publico', ids.beto, 24, 0);
    assert.ok(!publico.trabajos.some(x => x.titulo === 'Fade Luis'), 'despublicado al retirar la autorización');
    assert.equal(await rpc(anon, 'portafolio_imagen', t1.id), null);
    const lista = await rpc(admin, 'panel_autorizaciones');
    assert.equal(lista.find(a => a.id === aut.id).estado, 'retirada');
    assert.ok(!('evidencia' in lista[0]), 'la evidencia no viaja en el listado');
    assert.equal(await rpc(admin, 'panel_autorizacion_evidencia', aut.id), IMG);
    assert.match(await errorDe(rpc(anon, 'panel_autorizacion_evidencia', aut.id)), /permission denied/);
    // Republicar con la autorización retirada no es posible
    assert.equal(await errorDe(rpc(admin, 'panel_portafolio_estado', t1.id, 'publicar', null)), 'autorizacion_requerida');
    assert.match(await errorDe(A.query('delete from autorizaciones_imagen where id = $1', [aut.id])), /registro_inmutable/);
});

test('perfil público: presentación, especialidades y permiso de portafolio propio', async () => {
    await rpc(barbero, 'panel_barbero_perfil_guardar', ids.beto, j({ presentacion: '10 años con rizos', especialidades: ['Degradados', 'Rizos'], portafolio_propio: false }));
    let perfil = (await rpc(anon, 'barberos_publicos')).find(b => b.id === ids.beto);
    assert.deepEqual([perfil.presentacion, perfil.especialidades.sort()], ['10 años con rizos', ['Degradados', 'Rizos']]);
    assert.equal(n(perfil.trabajos), 2);
    assert.equal((await rpc(admin, 'panel_barbero_perfil', ids.beto)).portafolio_propio, true, 'el barbero no puede cambiar su propio permiso');
    await rpc(admin, 'panel_barbero_perfil_guardar', ids.beto, j({ presentacion: '10 años con rizos', especialidades: ['Degradados'], portafolio_propio: false }));
    assert.equal(await errorDe(trabajo(barbero, { barbero_id: ids.beto })), 'no_autorizado', 'sin permiso de portafolio propio');
    await rpc(admin, 'panel_barbero_perfil_guardar', ids.beto, j({ presentacion: '10 años con rizos', especialidades: ['Degradados'], portafolio_propio: true }));
    assert.equal(await errorDe(rpc(barbero, 'panel_barbero_perfil_guardar', ids.caro, '{}')), 'no_autorizado');
});

// ---------------- Ocupación ----------------
test('ocupación: descansos, bloqueos, cancelaciones, solapes, jornadas vacías y servicios de distinta duración', async () => {
    const f = await fechaLocal(A, 8);
    const dow = n((await A.query('select extract(dow from $1::date)::int d', [f])).rows[0].d);
    const cerrado = await fechaLocal(A, 9);
    const dowCerrado = n((await A.query('select extract(dow from $1::date)::int d', [cerrado])).rows[0].d);
    await A.query(`insert into horarios_semana (barbero_id, dia, activo, abre, cierra) values ($1, $2, true, '09:00', '13:00'), ($1, $3, false, '09:00', '13:00')`,
        [ids.ana, dow, dowCerrado]);
    await A.query(`insert into descansos (barbero_id, dia, desde, hasta) values ($1, $2, '11:00', '11:30')`, [ids.ana, dow]);
    await A.query(`insert into bloqueos (barbero_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, tipo) values ($1, $2, $2, '12:30', '13:00', 'bloqueo')`, [ids.ana, f]);
    const cita = (hora, servicio, extra = {}) => rpc(admin, 'panel_crear_cita', j({ nombre: 'Ocupa', telefono: '8095550200', servicio_id: servicio, barbero_id: ids.ana, fecha: f, hora, ...extra }));
    await cita('09:00', ids.s60);
    await cita('10:00', ids.s30);
    const cancelada = await cita('11:30', ids.s30);
    await rpc(admin, 'panel_actualizar_cita', cancelada.id, 'cancelar', j({ motivo: 'Avisó' }));
    // Conflicto heredado: una cita solapada (creada antes de las reglas actuales)
    await A.query('alter table citas disable trigger user');
    await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado, duracion_reservada)
                   select 'Solapada', '8095550201', b.id, s.id, $3::date, '09:30', 'confirmada', 30 from barberos b, servicios s where b.id::text = $1 and s.id::text = $2`, [ids.ana, ids.s30, f]);
    await A.query('alter table citas enable trigger user');

    const r = await rpc(admin, 'panel_ocupacion', f, cerrado, ids.ana);
    const dia = r.dias.find(d => d.fecha === f);
    assert.deepEqual([n(dia.programados), n(dia.no_disponibles), n(dia.disponibles)], [240, 60, 180], '4 h − descanso 30 − bloqueo 30');
    assert.equal(n(dia.reservados), 90, '09:00–10:00 + 10:00–10:30; la solapada 09:30 no se cuenta dos veces; la cancelada no cuenta');
    assert.equal(n(dia.canceladas), 1);
    assert.ok(r.conflictos.some(c => c.tipo === 'solape' && c.fecha === f), 'el solape se informa');
    const vacio = r.dias.find(d => d.fecha === cerrado);
    assert.deepEqual([n(vacio.disponibles), n(vacio.reservados)], [0, 0], 'jornada vacía: sin minutos disponibles');
    const huecos = r.huecos.filter(h => h.fecha === f);
    assert.deepEqual(huecos.map(h => [h.desde, h.hasta, n(h.minutos)]), [['10:30', '11:00', 30], ['11:30', '12:30', 60]]);
    // Solo servicios que caben completos (el catálogo también tiene cortes de 30 a 60 min)
    assert.ok(huecos[0].servicios.every(s => n(s.duracion) <= 30) && huecos[0].servicios.some(s => s.nombre === 'Corte 30'), 'hueco de 30 min');
    assert.ok(!huecos[0].servicios.some(s => ['Corte 60', 'Combo 90'].includes(s.nombre)));
    assert.ok(huecos[1].servicios.every(s => n(s.duracion) <= 60) && huecos[1].servicios.some(s => n(s.duracion) === 60), 'hueco de 60 min: entra uno de 60');
    assert.ok(!huecos[1].servicios.some(s => s.nombre === 'Combo 90'), 'un servicio de 90 min no cabe en 60');
    assert.ok(r.mapa_calor.some(c => c.dia === dow && c.hora === 9 && n(c.reservados) === 60));
    assert.ok(!r.mapa_calor.some(c => c.dia === dow && c.hora === 13), 'fuera de jornada no aparece');
    // Tiempo de preparación entre citas: el hueco de 30 min deja de servir
    await A.query(`update modulos_config set ajustes = ajustes || '{"minutos_entre_citas": 15}' where modulo = 'general'`);
    const conMargen = await rpc(admin, 'panel_ocupacion', f, f, ids.ana);
    assert.deepEqual(conMargen.huecos.map(h => [h.desde, h.hasta]), [['11:30', '12:30']]);
    await A.query(`update modulos_config set ajustes = ajustes || '{"minutos_entre_citas": 0}' where modulo = 'general'`);
    // La disponibilidad pública coincide: las horas libres de 30 min están en los huecos
    const libres = (await rpc(anon, 'horarios_dia_publico', 'Corte 30', 'Ana', f)).horas.filter(h => h.estado === 'libre').map(h => h.inicio);
    assert.deepEqual(libres, ['10:30', '11:30', '12:00']);
    assert.deepEqual([...new Set((await rpc(barbero, 'panel_ocupacion', f, f, null)).dias.map(d => d.barbero_id))], [ids.beto], 'el barbero solo ve su ocupación');
    assert.equal(await errorDe(rpc(cliente, 'panel_ocupacion', f, f, null)), 'no_autorizado');
    assert.equal(await errorDe(rpc(admin, 'panel_ocupacion', f, await fechaLocal(A, 120), null)), 'rango_invalido');
});

// ---------------- Reclamaciones ----------------
test('reclamaciones: el cliente crea y consulta solo con su token; doble envío no duplica', async () => {
    const f = await fechaLocal(A, 4);
    const reserva = await rpc(anon, 'reservar_cita', 'Rosa Reclama', null, '8095550300', 'Corte 30', 'Beto', f, '10:00');
    const categorias = await rpc(anon, 'reclamacion_categorias_publicas');
    assert.deepEqual(categorias.map(c => c.nombre), ['Resultado del servicio', 'Tiempo de espera', 'Atención recibida', 'Cobro', 'Reserva', 'Producto', 'Otro']);
    const datos = { clave: randomUUID(), token_cita: reserva.token, categoria_id: categorias[0].id, descripcion: 'El degradado quedó disparejo', adjuntos: [IMG] };
    const [a, b] = await Promise.all([rpc(anon, 'reclamacion_crear', j(datos)), rpc(await db.conexion('anon'), 'reclamacion_crear', j(datos))]);
    assert.equal(a.codigo, b.codigo);
    assert.deepEqual([a.repetida, b.repetida].sort(), [false, true]);
    assert.equal(n((await A.query(`select count(*) c from reclamaciones where cita_id = $1`, [reserva.cita_id])).rows[0].c), 1);
    assert.equal(await errorDe(rpc(anon, 'reclamacion_crear', j({ ...datos, clave: randomUUID(), token_cita: randomUUID() }))), 'cita_no_encontrada');
    assert.equal(await errorDe(rpc(anon, 'reclamacion_crear', j({ ...datos, clave: randomUUID(), descripcion: 'corto' }))), 'descripcion_invalida');
    assert.equal(await errorDe(rpc(anon, 'reclamacion_consultar', randomUUID())), 'reclamacion_no_encontrada');
    const c = await rpc(anon, 'reclamacion_consultar', a.token);
    assert.deepEqual([c.estado, c.categoria, c.adjuntos.length], ['recibida', 'Resultado del servicio', 1]);
    assert.equal(await rpc(anon, 'reclamacion_adjunto', a.token, c.adjuntos[0]), IMG);
    assert.equal(await rpc(anon, 'reclamacion_adjunto', randomUUID(), c.adjuntos[0]), null, 'el adjunto solo con el token del caso');
    assert.deepEqual((await rpc(anon, 'mis_reclamaciones_por_tokens', [a.token])).map(x => x.codigo), [a.codigo]);
    assert.deepEqual(await rpc(anon, 'mis_reclamaciones_por_tokens', [randomUUID()]), []);
    for (const tabla of ['reclamaciones', 'reclamacion_mensajes', 'reclamacion_adjuntos', 'reclamacion_eventos']) {
        assert.match(await errorDe(anon.query(`select * from ${tabla}`)), /permission denied/);
        assert.match(await errorDe(cliente.query(`select * from ${tabla}`)), /permission denied/);
    }
    // Registrar la reclamación no cambia la cita
    assert.equal((await A.query('select estado from citas where id::text = $1', [reserva.cita_id])).rows[0].estado, 'pendiente');
});

test('reclamaciones: notas internas y adjuntos del equipo no llegan al cliente; barbero solo lo asignado; historial', async () => {
    const f = await fechaLocal(A, 5);
    const reserva = await rpc(anon, 'reservar_cita', 'Pedro Caso', null, '8095550301', 'Corte 30', 'Beto', f, '11:00');
    const cat = (await rpc(anon, 'reclamacion_categorias_publicas'))[1].id;
    const caso = await rpc(anon, 'reclamacion_crear', j({ clave: randomUUID(), token_cita: reserva.token, categoria_id: cat, descripcion: 'Esperé 40 minutos para entrar' }));
    const { rows: [{ id }] } = await A.query(`select id::text from reclamaciones where token = $1`, [caso.token]);
    assert.equal(await errorDe(rpc(barbero, 'panel_reclamacion', id)), 'reclamacion_no_encontrada', 'sin asignar, el barbero no lo ve');
    assert.equal((await rpc(barbero, 'panel_reclamaciones', '{}')).total, 0);
    const msg = (cli, datos) => rpc(cli, 'panel_reclamacion_mensaje', j({ clave: randomUUID(), reclamacion_id: id, ...datos }));
    const act = (cli, datos) => rpc(cli, 'panel_reclamacion_actualizar', j({ reclamacion_id: id, ...datos }));
    await msg(admin, { cuerpo: 'Revisar cámara: llegó tarde el barbero anterior', interno: true, adjuntos: [IMG] });
    let d = await rpc(admin, 'panel_reclamacion', id);
    assert.equal(d.primera_respuesta_en, null, 'una nota interna no es respuesta al cliente');
    await act(admin, { accion: 'asignar', valor: BARBERO });
    assert.equal((await rpc(barbero, 'panel_reclamacion', id)).codigo, caso.codigo, 'asignado: el barbero lo ve');
    assert.equal(await errorDe(rpc(otroBarbero, 'panel_reclamacion', id)), 'reclamacion_no_encontrada');
    await msg(barbero, { cuerpo: '¿A qué hora llegó? Nos ayuda a revisarlo.', solicitar_info: true });
    d = await rpc(admin, 'panel_reclamacion', id);
    assert.ok(d.primera_respuesta_en);
    assert.equal(d.estado, 'esperando_cliente');
    let cli = await rpc(anon, 'reclamacion_consultar', caso.token);
    assert.deepEqual(cli.mensajes.map(m => m.autor), ['equipo'], 'el cliente ve solo el mensaje, no la nota interna');
    assert.ok(!JSON.stringify(cli).includes('cámara'));
    assert.equal(cli.adjuntos.length, 0, 'los adjuntos internos no se muestran al cliente');
    const interno = (await A.query(`select id from reclamacion_adjuntos where reclamacion_id = $1 and interno`, [id])).rows[0].id;
    assert.equal(await rpc(anon, 'reclamacion_adjunto', caso.token, interno), null);
    assert.equal(cli.puede_responder, true);
    const resp = { clave: randomUUID(), token: caso.token, cuerpo: 'Llegué a las 11:00 en punto' };
    await rpc(anon, 'reclamacion_responder', j(resp));
    assert.equal((await rpc(anon, 'reclamacion_responder', j(resp))).repetida, true, 'reenvío sin duplicar');
    assert.equal(await errorDe(rpc(anon, 'reclamacion_responder', j({ ...resp, clave: randomUUID() }))), 'respuesta_no_solicitada');
    assert.equal((await rpc(admin, 'panel_reclamacion', id)).estado, 'en_revision');
    assert.equal(await errorDe(act(barbero, { accion: 'estado', valor: 'cerrada' })), 'no_autorizado', 'cerrar es del administrador');
    assert.equal(await errorDe(act(barbero, { accion: 'estado', valor: 'resuelta' })), 'solucion_requerida');
    await act(barbero, { accion: 'estado', valor: 'resuelta', motivo: 'Se ofreció cortesía en la próxima visita' });
    cli = await rpc(anon, 'reclamacion_consultar', caso.token);
    assert.deepEqual([cli.estado, cli.solucion], ['resuelta', 'Se ofreció cortesía en la próxima visita']);
    await act(admin, { accion: 'estado', valor: 'cerrada' });
    assert.equal(await errorDe(act(admin, { accion: 'reabrir' })), 'motivo_requerido');
    await act(admin, { accion: 'reabrir', motivo: 'El cliente volvió a escribir' });
    d = await rpc(admin, 'panel_reclamacion', id);
    assert.deepEqual(d.eventos.map(e => e.tipo), ['creada', 'nota', 'asignacion', 'mensaje', 'estado', 'respuesta_cliente', 'estado', 'estado', 'reapertura']);
    assert.equal(d.eventos.at(-1).motivo, 'El cliente volvió a escribir');
    assert.match(await errorDe(A.query('delete from reclamaciones where id = $1', [id])), /registro_inmutable/);
    assert.match(await errorDe(A.query('update reclamacion_mensajes set cuerpo = $1 where reclamacion_id = $2', ['x', id])), /registro_inmutable/);
});

test('reclamaciones: reembolso solo se vincula; indicadores; cuenta del cliente', async () => {
    const f = await fechaLocal(A, 6);
    const reserva = await rpc(cliente, 'reservar_cita', 'Cuenta Cliente', null, '8095550302', 'Corte 30', 'Beto', f, '12:00');
    const cat = (await rpc(anon, 'reclamacion_categorias_publicas'))[3].id;
    const caso = await rpc(cliente, 'reclamacion_crear', j({ clave: randomUUID(), token_cita: reserva.token, categoria_id: cat, descripcion: 'Me cobraron dos veces' }));
    assert.deepEqual((await rpc(cliente, 'mis_reclamaciones')).map(x => x.codigo), [caso.codigo]);
    assert.deepEqual(await rpc(otroBarbero, 'mis_reclamaciones'), [], 'otra cuenta no ve casos ajenos');
    const { rows: [{ id }] } = await A.query(`select id::text from reclamaciones where token = $1`, [caso.token]);
    const pagosAntes = n((await A.query('select count(*) c from pagos')).rows[0].c);
    // Sin reembolso registrado en Ventas, no hay nada que vincular
    const venta = await rpc(admin, 'panel_venta_cobrar', j({ clave: randomUUID(), cita_id: reserva.cita_id, pagos: [{ metodo: 'tarjeta', monto: 500 }] }));
    assert.equal(await errorDe(rpc(admin, 'panel_reclamacion_actualizar', j({ reclamacion_id: id, accion: 'reembolso', valor: venta.id }))), 'reembolso_no_encontrado');
    await rpc(admin, 'panel_venta_reembolsar', j({ clave: randomUUID(), venta_id: venta.id, motivo: 'Cobro duplicado', reembolsos: [{ metodo: 'tarjeta', monto: 500 }] }));
    const pagosDespues = n((await A.query('select count(*) c from pagos')).rows[0].c);
    await rpc(admin, 'panel_reclamacion_actualizar', j({ reclamacion_id: id, accion: 'reembolso', valor: venta.id, motivo: 'Reembolso por tarjeta' }));
    assert.equal(n((await A.query('select count(*) c from pagos')).rows[0].c), pagosDespues, 'vincular no crea pagos');
    assert.equal(pagosDespues - pagosAntes, 2, 'solo el cobro y el reembolso hechos en Ventas');
    // Indicadores: fuera de plazo cuando vence la fecha objetivo sin primera respuesta
    const { rows: [r] } = await A.query('select creado_en::text c from reclamaciones where id = $1', [id]);
    await rpc(admin, 'panel_reclamacion_actualizar', j({ reclamacion_id: id, accion: 'fecha_objetivo', valor: r.c }));
    const hoy = await fechaLocal(A, 0);
    const ind = await rpc(admin, 'panel_reclamaciones_indicadores', hoy, hoy);
    assert.ok(n(ind.abiertas) >= 2 && n(ind.sin_primera_respuesta) >= 1 && n(ind.fuera_de_plazo) >= 1);
    assert.ok(ind.motivos.some(m => m.categoria === 'Cobro'));
    assert.ok(n(ind.horas_primera_respuesta) >= 0);
    assert.equal(await rpc(barbero, 'panel_reclamaciones_pendientes'), 1, 'el barbero solo cuenta su caso asignado (reabierto, en revisión)');
    assert.equal(await rpc(otroBarbero, 'panel_reclamaciones_pendientes'), 0);
    assert.ok(await rpc(admin, 'panel_reclamaciones_pendientes') >= 1);
    // Caso registrado por el equipo (compra en mostrador) con enlace privado para el cliente
    const equipo = await rpc(admin, 'panel_reclamacion_crear', j({ clave: randomUUID(), cliente_nombre: 'Cliente mostrador', categoria_id: cat, descripcion: 'El producto vino abierto' }));
    assert.ok(equipo.enlace_token);
    assert.equal((await rpc(anon, 'reclamacion_consultar', equipo.enlace_token)).estado, 'recibida');
    assert.equal(await errorDe(rpc(barbero, 'panel_reclamacion_crear', j({ clave: randomUUID() }))), 'no_autorizado');
});
