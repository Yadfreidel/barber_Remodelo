// Fila virtual contra PostgreSQL real: turnos idempotentes, privacidad por token, llamadas simultáneas,
// convivencia con citas (huecos en la misma fuente de disponibilidad), ciclo completo, cortesía vencida,
// recepción pausada, permisos por rol y avisos sin duplicados. El reloj de la fila se fija por sesión.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ISAAC = '55555555-5555-5555-5555-555555555555';
const BETO = '77777777-7777-7777-7777-777777777777';
let db, A, admin, isaac, beto, cli1, cli2, ids, F;
const conexiones = [];

// Reloj de la fila (hora local del negocio) en todas las sesiones
async function reloj(hora) {
    for (const c of conexiones) await c.query(`select set_config('barberia.fila_reloj', $1, false)`, [`${F} ${hora}`]);
}
const tomar = (cli, servicio, barbero = null, clave = randomUUID()) => rpc(cli, 'fila_tomar_turno', servicio, barbero, clave);
const estado = (cli, token) => rpc(cli, 'fila_turno', token);
const config = datos => rpc(admin, 'panel_fila_config', JSON.stringify(datos));
const crearCita = (barbero, hora) => rpc(admin, 'panel_crear_cita', JSON.stringify({ nombre: 'Cliente Cita', telefono: '809-555-0100',
    servicio_id: ids.corte, barbero_id: barbero, fecha: F, hora, estado: 'confirmada' }));
const fila = async (cli, ...a) => (await rpc(cli, 'panel_fila', ...a));
const limpiar = async () => {
    await A.query(`delete from push_envios; delete from notificaciones where tipo like 'fila%'; delete from fila_eventos; delete from fila_turnos;
                   delete from cita_tokens; delete from citas`);
    await A.query(`update fila_config set recepcion_abierta = true, cortesia_minutos = 5`);
};

before(async () => {
    db = await iniciarBase(54352);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Isaac'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte 30', 500, 30), ('Barba 15', 300, 15)`);
    await db.migrar();
    await A.query(`update servicios set en_catalogo = true, activo = true`);
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'isaac@x.com'), ($3, 'beto@x.com')`, [ADMIN, ISAAC, BETO]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    admin = await db.conexion('authenticated', ADMIN);
    isaac = await db.conexion('authenticated', ISAAC);
    beto = await db.conexion('authenticated', BETO);
    cli1 = await db.conexion('anon');
    cli2 = await db.conexion('anon');
    conexiones.push(A, admin, isaac, beto, cli1, cli2);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Isaac') isaac, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from servicios where nombre = 'Corte 30') corte, (select id::text from servicios where nombre = 'Barba 15') barba`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.isaac, 'isaac@x.com');
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
    F = await fechaLocal(A, 2);
    await reloj('10:00');
});

after(() => db?.cerrar());

test('recepción pausada por defecto; abierta, el QR emite turnos con código y sin duplicados', async () => {
    assert.equal((await rpc(cli1, 'fila_publica')).recepcion_abierta, false, 'nace pausada: la activa el administrador');
    assert.match(await errorDe(tomar(cli1, ids.corte)), /fila_cerrada/);
    await limpiar();
    const pub = await rpc(cli1, 'fila_publica');
    assert.equal(pub.recepcion_abierta, true);
    const quienes = pub.servicios.find(s => s.id === ids.corte).barberos;
    assert.ok(quienes.includes(ids.beto) && quienes.includes(ids.isaac));
    assert.ok(!JSON.stringify(pub).includes('telefono'));
    // Doble toque: misma clave -> mismo turno (también si llegan a la vez)
    const clave = randomUUID();
    const [a, b] = await Promise.all([tomar(cli1, ids.corte, null, clave), tomar(cli2, ids.corte, null, clave)]);
    assert.equal(a.token, b.token);
    assert.equal(a.codigo, 'A-01');
    assert.equal((await tomar(cli1, ids.corte, null, clave)).token, a.token, 'reintento posterior');
    assert.equal((await A.query('select count(*)::int n from fila_turnos')).rows[0].n, 1);
    // Recargar: el token recupera el turno
    const e = await estado(cli1, a.token);
    assert.equal(e.codigo, 'A-01');
    assert.equal(e.estado, 'en_espera');
    assert.equal(e.delante, 0);
    assert.deepEqual(e.espera, { min: 0, max: 5 });
    assert.equal(e.cerca, true);
    assert.equal(e.token, undefined, 'la consulta no reexpone el token');
    // Validaciones
    assert.match(await errorDe(tomar(cli1, '99999')), /servicio_no_disponible/);
    assert.match(await errorDe(tomar(cli1, ids.corte, 'no-existe')), /barbero_no_disponible/);
});

test('privacidad: solo con el token propio; sin nombres ni datos de otros; tablas cerradas', async () => {
    await limpiar();
    const m = await rpc(admin, 'panel_fila_registrar', ids.corte, null, 'Pedro Mostrador', randomUUID());
    assert.equal(m.turno.nombre, 'Pedro Mostrador');
    const t2 = await tomar(cli2, ids.corte);
    assert.equal(t2.codigo, 'A-02');
    assert.equal(t2.delante, 1, 'un turno compatible por delante');
    assert.ok(!JSON.stringify(t2).includes('Pedro'), 'no se exponen nombres de otros');
    assert.equal(await estado(cli1, randomUUID()), null, 'un token inventado no devuelve nada');
    assert.match(await errorDe(rpc(cli1, 'fila_salir', randomUUID())), /turno_no_encontrado/);
    for (const tabla of ['fila_turnos', 'fila_config', 'fila_eventos']) assert.match(await errorDe(cli1.query(`select * from ${tabla}`)), /permission denied/);
    for (const fn of ['panel_fila', 'panel_fila_llamar']) assert.match(await errorDe(rpc(cli1, fn)), /permission denied/);
});

test('dos paneles llaman a la vez: cada turno se asigna una sola vez; el mismo barbero no toma dos', async () => {
    await limpiar();
    const t1 = await tomar(cli1, ids.corte);
    const t2 = await tomar(cli2, ids.corte);
    const [ri, rb] = await Promise.all([rpc(isaac, 'panel_fila_llamar', null), rpc(beto, 'panel_fila_llamar', null)]);
    assert.ok(ri.turno && rb.turno);
    assert.notEqual(ri.turno.id, rb.turno.id);
    assert.deepEqual([ri.turno.codigo, rb.turno.codigo].sort(), ['A-01', 'A-02']);
    assert.equal((await A.query(`select count(*)::int n from fila_turnos where estado = 'llamado'`)).rows[0].n, 2);
    assert.match(await errorDe(rpc(isaac, 'panel_fila_llamar', null)), /ya_tiene_turno/);
    // El cliente ve con quién pasar
    const e1 = await estado(cli1, t1.token);
    assert.equal(e1.estado, 'llamado');
    assert.ok(['Isaac', 'Beto'].includes(e1.barbero));
    assert.equal((await estado(cli2, t2.token)).estado, 'llamado');
    // Mismo barbero desde dos dispositivos a la vez: solo uno de los dos turnos nuevos
    await limpiar();
    await tomar(cli1, ids.corte);
    await tomar(cli2, ids.corte);
    const isaac2 = await db.conexion('authenticated', ISAAC);
    await isaac2.query(`select set_config('barberia.fila_reloj', $1, false)`, [`${F} 10:00`]);
    const r = await Promise.allSettled([rpc(isaac, 'panel_fila_llamar', null), rpc(isaac2, 'panel_fila_llamar', null)]);
    assert.equal(r.filter(x => x.status === 'fulfilled' && x.value.turno).length, 1);
    assert.match(r.find(x => x.status === 'rejected').reason.message, /ya_tiene_turno/);
});

test('cita en 15 minutos: un corte de 30 no se asigna a Isaac; espera por Isaac y otro atiende «primero disponible»', async () => {
    await limpiar();
    await crearCita(ids.isaac, '10:15');
    const paraIsaac = await tomar(cli1, ids.corte, ids.isaac);
    const cualquiera = await tomar(cli2, ids.corte);
    const r = await rpc(isaac, 'panel_fila_llamar', null);
    assert.equal(r.turno, null);
    assert.equal(r.motivo, 'sin_hueco', 'no cabe: cortesía 5 + 30 min antes de la cita de las 10:15');
    assert.equal((await estado(cli1, paraIsaac.token)).estado, 'en_espera');
    // Beto no puede tomar el turno elegido para Isaac, sí el de «primero disponible»
    const rb = await rpc(beto, 'panel_fila_llamar', null);
    assert.equal(rb.turno.codigo, cualquiera.codigo);
    assert.equal((await estado(cli1, paraIsaac.token)).estado, 'en_espera');
    // Estimación del turno de Isaac: después de su cita (10:15 + 30 = 10:45 -> 45 min)
    const e = await estado(cli1, paraIsaac.token);
    assert.equal(e.espera.min, 45);
    // El hueco llamado de Beto [10:00, 10:35) ya no está disponible para reservas ni en el calendario
    assert.match(await errorDe(crearCita(ids.beto, '10:20')), /horario_no_disponible/);
    const libres = (await rpc(admin, 'panel_disponibilidad', ids.beto, ids.corte, F, null));
    assert.ok(!JSON.stringify(libres).includes('"10:00"'), 'el calendario no ofrece el hueco reservado');
    assert.ok(await crearCita(ids.beto, '10:40'), 'después del hueco sí se puede reservar');
    // Isaac termina su cita a las 10:45: entonces sí puede llamar
    await reloj('10:45');
    const tarde = await rpc(isaac, 'panel_fila_llamar', null);
    assert.equal(tarde.turno.codigo, paraIsaac.codigo);
});

test('una reserva que entra mientras se asigna no ocupa el mismo hueco', async () => {
    await limpiar();
    await reloj('12:00');
    await tomar(cli1, ids.corte, ids.beto);
    const [llamada, cita] = await Promise.allSettled([rpc(beto, 'panel_fila_llamar', null), crearCita(ids.beto, '12:10')]);
    const llamo = llamada.status === 'fulfilled' && llamada.value.turno;
    const reservo = cita.status === 'fulfilled';
    assert.ok(llamo !== reservo, 'gana exactamente una de las dos');
    if (!reservo) assert.match(cita.reason.message, /horario_no_disponible/);
    else assert.equal(llamada.value.motivo, 'sin_hueco');
});

test('ciclo completo, salida voluntaria y cortesía vencida (libera el hueco)', async () => {
    await limpiar();
    await reloj('13:00');
    const a = await tomar(cli1, ids.corte);
    const b = await tomar(cli2, ids.barba);
    const llam = (await rpc(isaac, 'panel_fila_llamar', null)).turno;
    assert.equal(llam.codigo, a.codigo);
    // Beto no gestiona el turno de Isaac
    assert.match(await errorDe(rpc(beto, 'panel_fila_iniciar', llam.id)), /turno_no_encontrado/);
    await reloj('13:03');
    assert.equal((await rpc(isaac, 'panel_fila_iniciar', llam.id)).turno.estado, 'en_servicio');
    assert.equal((await estado(cli1, a.token)).estado, 'en_servicio');
    // En servicio el intervalo [13:03, 13:33) queda protegido
    assert.match(await errorDe(crearCita(ids.isaac, '13:15')), /horario_no_disponible/);
    assert.match(await errorDe(rpc(isaac, 'panel_fila_llamar', null)), /ya_tiene_turno/);
    await reloj('13:20');
    assert.equal((await rpc(isaac, 'panel_fila_cerrar', llam.id, 'finalizar')).turno.estado, 'finalizado');
    assert.match(await errorDe(rpc(isaac, 'panel_fila_cerrar', llam.id, 'finalizar')), /transicion_invalida/);
    // Al finalizar antes, el resto del hueco se libera
    assert.ok(await crearCita(ids.isaac, '13:25'));
    // Salida voluntaria del cliente
    assert.equal((await rpc(cli2, 'fila_salir', b.token)).estado, 'salio');
    assert.match(await errorDe(rpc(cli2, 'fila_salir', b.token)), /transicion_invalida/);
    // Llamado que no se presenta: al vencer la cortesía pasa a «no se presentó» y libera el hueco
    const c = await tomar(cli1, ids.barba);
    const ll = (await rpc(beto, 'panel_fila_llamar', null)).turno;
    assert.equal(ll.codigo, c.codigo);
    assert.match(await errorDe(crearCita(ids.beto, '13:30')), /horario_no_disponible/);
    await reloj('13:26');
    const vencido = await estado(cli1, c.token);
    assert.equal(vencido.estado, 'no_se_presento');
    assert.ok(await crearCita(ids.beto, '13:30'), 'hueco liberado');
    // «No se presentó» manual (después de esa cita)
    await reloj('14:30');
    const d = await tomar(cli2, ids.barba, ids.beto);
    const ld = (await rpc(beto, 'panel_fila_llamar', null)).turno;
    assert.equal(ld.codigo, d.codigo);
    assert.equal((await rpc(beto, 'panel_fila_cerrar', ld.id, 'no_se_presento')).turno.estado, 'no_se_presento');
    const eventos = (await A.query(`select a from fila_eventos where turno_id = $1 order by id`, [llam.id])).rows.map(r => r.a);
    assert.deepEqual(eventos, ['en_espera', 'llamado', 'en_servicio', 'finalizado'], 'transiciones registradas en el servidor');
});

test('pausar la recepción: no entran turnos nuevos, los emitidos se siguen atendiendo', async () => {
    await limpiar();
    await reloj('15:00');
    const t = await tomar(cli1, ids.corte);
    await config({ recepcion_abierta: false });
    assert.match(await errorDe(tomar(cli2, ids.corte)), /fila_cerrada/);
    const e = await estado(cli1, t.token);
    assert.equal(e.estado, 'en_espera');
    assert.equal(e.recepcion_abierta, false);
    const ll = (await rpc(isaac, 'panel_fila_llamar', null)).turno;
    assert.equal(ll.codigo, t.codigo);
    assert.equal((await rpc(isaac, 'panel_fila_iniciar', ll.id)).turno.estado, 'en_servicio');
});

test('permisos: el barbero ve lo suyo y lo que puede atender; la administración asigna, registra y configura', async () => {
    await limpiar();
    await reloj('16:00');
    await A.query(`insert into servicio_barberos (servicio_id, barbero_id) values ($1, $2)`, [ids.barba, ids.beto]);
    const deIsaac = await tomar(cli1, ids.corte, ids.isaac);
    const barba = await tomar(cli2, ids.barba);       // solo Beto hace barba
    const libre = await tomar(cli1, ids.corte);
    const vistaBeto = (await fila(beto, null)).turnos.map(t => t.codigo);
    assert.deepEqual(vistaBeto.sort(), [barba.codigo, libre.codigo].sort(), 'Beto no ve el turno elegido para Isaac');
    const vistaIsaac = (await fila(isaac, null)).turnos.map(t => t.codigo);
    assert.deepEqual(vistaIsaac.sort(), [deIsaac.codigo, libre.codigo].sort(), 'Isaac no ve la barba (no la hace)');
    assert.equal((await fila(admin, null)).turnos.length, 3);
    for (const [fn, ...a] of [['panel_fila_asignar', randomUUID(), null], ['panel_fila_config', '{}'], ['panel_fila_registrar', ids.corte, null, 'x', randomUUID()]]) {
        assert.match(await errorDe(rpc(beto, fn, ...a)), /no_autorizado/);
    }
    // Reasignar: el turno de Isaac pasa a Beto (elegible); a un barbero que no hace el servicio, no
    const idIsaac = (await fila(admin, null)).turnos.find(t => t.codigo === deIsaac.codigo).id;
    const idBarba = (await fila(admin, null)).turnos.find(t => t.codigo === barba.codigo).id;
    assert.match(await errorDe(rpc(admin, 'panel_fila_asignar', idBarba, ids.isaac)), /barbero_no_elegible/);
    assert.equal((await rpc(admin, 'panel_fila_asignar', idIsaac, ids.beto)).turno.barbero, 'Beto');
    assert.ok((await fila(beto, null)).turnos.some(t => t.codigo === deIsaac.codigo));
    assert.ok(!(await fila(isaac, null)).turnos.some(t => t.codigo === deIsaac.codigo));
    // La administración llama en nombre de un barbero y configura la cortesía
    assert.match(await errorDe(rpc(admin, 'panel_fila_llamar', null)), /barbero_requerido/);
    assert.equal((await config({ cortesia_minutos: 8, url_publica: 'https://ejemplo.com/fila.html' })).cortesia_minutos, 8);
    assert.match(await errorDe(config({ cortesia_minutos: 99 })), /configuracion_invalida/);
    assert.match(await errorDe(config({ url_publica: 'javascript:alert(1)' })), /configuracion_invalida/);
    const ll = (await rpc(admin, 'panel_fila_llamar', ids.isaac)).turno;
    assert.equal(ll.codigo, libre.codigo, 'Isaac toma el «primero disponible» (el suyo se reasignó)');
    assert.equal(ll.llamado_hasta.slice(11, 16), '16:08');
});

test('avisos con la página cerrada: un aviso por evento, enlace a la fila y nada tras cerrar el turno', async () => {
    await limpiar();
    await reloj('17:00');
    const t = await tomar(cli1, ids.corte);
    assert.deepEqual(await rpc(cli1, 'fila_push_suscribir', t.token, JSON.stringify({ endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' })), { ok: true });
    const aviso = (await A.query('select aviso_id from fila_turnos where token = $1', [t.token])).rows[0].aviso_id;
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'fila_cerca'`, [aviso])).rows[0].n, 1);
    await tomar(cli2, ids.corte);   // recalcula «cerca» de todos: sin duplicar el aviso
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'fila_cerca'`, [aviso])).rows[0].n, 1);
    await rpc(isaac, 'panel_fila_llamar', null);
    assert.equal((await A.query(`select count(*)::int n from notificaciones where user_id = $1 and tipo = 'fila_llamado'`, [aviso])).rows[0].n, 1);
    const envios = await rpc(A, 'push_reclamar', 50);
    const llamado = envios.find(e => /Es tu turno/.test(e.titulo));
    assert.equal(llamado.cuerpo, 'Pasa con Isaac.');
    assert.equal(llamado.url, `fila.html#t=${t.token}`);
    // Los avisos del panel conservan su enlace habitual
    assert.ok(envios.every(e => e.url.startsWith('fila.html') || e.url.startsWith('?panel=')));
    // Al salir, lo pendiente no se envía y la suscripción queda inactiva
    await rpc(cli1, 'fila_salir', t.token);
    assert.equal((await A.query(`select count(*)::int n from push_envios e join notificaciones n on n.id = e.notificacion_id where n.user_id = $1 and e.estado = 'pendiente'`, [aviso])).rows[0].n, 0);
    assert.equal((await A.query(`select activa from push_suscripciones where user_id = $1`, [aviso])).rows[0].activa, false);
});

test('con la fila habilitada, reservar, reprogramar y cancelar citas funcionan igual', async () => {
    await limpiar();
    await tomar(cli1, ids.corte);
    const f = await fechaLocal(A, 4);
    const r = await rpc(cli2, 'reservar_cita', 'Cliente Web', null, '8095550101', 'Corte 30', 'Beto', f, '11:00', '[]', null, false, null, randomUUID());
    assert.ok(r.token);
    const cot = await rpc(cli2, 'cotizar_reprogramacion', r.token, f, '12:00');
    await rpc(cli2, 'reprogramar_cita', r.token, f, '12:00', cot.precio_final);
    assert.equal((await rpc(cli2, 'consultar_cita', r.token)).hora, '12:00');
    await rpc(cli2, 'cancelar_cita', r.token);
    assert.equal((await rpc(cli2, 'consultar_cita', r.token)).estado, 'cancelada');
});
