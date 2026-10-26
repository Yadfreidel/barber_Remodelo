// Inventario, ventas y caja contra PostgreSQL real: cobro único de citas, existencias, ventas simultáneas,
// pagos mixtos y cambio, anticipos, devoluciones y anulaciones, consumo interno, caja, gastos y permisos.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { iniciarBase, rpc, errorDe, fechaLocal } from './helpers.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const BARBERO = '55555555-5555-5555-5555-555555555555';
const CLIENTE = '66666666-6666-6666-6666-666666666666';
let db, A, anon, admin, barbero, cliente, ids;

const j = o => JSON.stringify(o);
const n = v => Number(v);
const cobrar = (datos, cli = admin) => rpc(cli, 'panel_venta_cobrar', j({ clave: randomUUID(), ...datos }));
const producto = async (datos) => (await rpc(admin, 'panel_inv_guardar_producto', null, j({ precio: 500, ...datos }))).id;
const existencia = async id => n((await A.query('select stock from productos where id = $1', [id])).rows[0].stock);
const cajaAbierta = async () => (await rpc(admin, 'panel_caja_estado')).abierta;
const cuenta = async (tabla) => n((await A.query(`select count(*) c from ${tabla}`)).rows[0].c);

let horaCita = 0;
async function citaPasada(nombre, servicio = 'Corte') {
    const hora = `${String(8 + horaCita++).padStart(2, '0')}:00`;
    const { rows: [c] } = await A.query(`insert into citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora, estado)
        select $1, '8095550001', b.id, s.id, _ahora_local()::date - 1, $3::time, 'confirmada' from barberos b, servicios s
         where b.nombre = 'Ana' and s.nombre = $2 returning id::text`, [nombre, servicio, hora]);
    return c.id;
}

before(async () => {
    db = await iniciarBase(54341);
    A = db.admin;
    await A.query(`insert into barberos (nombre) values ('Ana'), ('Beto')`);
    await A.query(`insert into servicios (nombre, precio, duracion_minutos) values ('Corte', 700, 60), ('Barba', 300, 30)`);
    await db.migrar();
    await A.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'beto@x.com'), ($3, 'cliente@x.com')`, [ADMIN, BARBERO, CLIENTE]);
    await A.query('insert into admin_usuarios values ($1)', [ADMIN]);
    anon = await db.conexion('anon');
    admin = await db.conexion('authenticated', ADMIN);
    barbero = await db.conexion('authenticated', BARBERO);
    cliente = await db.conexion('authenticated', CLIENTE);
    ids = (await A.query(`select (select id::text from barberos where nombre = 'Ana') ana, (select id::text from barberos where nombre = 'Beto') beto,
        (select id::text from servicios where nombre = 'Corte') corte, (select id::text from servicios where nombre = 'Barba') barba`)).rows[0];
    await rpc(admin, 'panel_vincular_usuario_barbero', ids.beto, 'beto@x.com');
});

after(() => db?.cerrar());

beforeEach(async () => {
    // Cada prueba empieza sin caja abierta
    const abierta = await cajaAbierta();
    if (abierta) {
        await rpc(admin, 'panel_caja_cerrar', j({ clave: randomUUID(), sesion_id: abierta.id, efectivo_contado: n(abierta.resumen.efectivo_esperado) }));
    }
});

test('accesos: solo administradores; clientes, barberos y anónimos no ven costos, ventas ni caja', async () => {
    for (const fn of ['panel_venta_cobrar', 'panel_caja_abrir', 'panel_gasto_registrar', 'panel_inv_movimiento']) {
        assert.match(await errorDe(rpc(anon, fn, j({ clave: randomUUID() }))), /permission denied/, fn);
        assert.equal(await errorDe(rpc(barbero, fn, j({ clave: randomUUID() }))), 'no_autorizado', fn);
        assert.equal(await errorDe(rpc(cliente, fn, j({ clave: randomUUID() }))), 'no_autorizado', fn);
    }
    assert.equal(await errorDe(rpc(barbero, 'panel_finanzas', '2026-01-01', '2026-01-31', null)), 'no_autorizado');
    assert.equal(await errorDe(rpc(barbero, 'panel_inv_productos')), 'no_autorizado');
    for (const tabla of ['ventas', 'pagos', 'gastos', 'caja_sesiones', 'inventario_movimientos', 'compras', 'operaciones_financieras']) {
        assert.match(await errorDe(cliente.query(`select * from ${tabla}`)), /permission denied/, tabla);
        assert.match(await errorDe(anon.query(`select * from ${tabla}`)), /permission denied/, tabla);
    }
    await producto({ nombre: 'Guantes', tipo: 'insumo', unidad: 'par', costo: 20, existencia_inicial: 10 });
    assert.equal((await cliente.query('select * from productos')).rowCount, 0, 'RLS: sin costos para no administradores');
    assert.match(await errorDe(anon.query(`select private._mover_inventario(gen_random_uuid(), 1, 'ajuste', 'x')`)), /permission denied/);
    await A.query(`update modulos_config set activo = true where modulo = 'productos'`);
    assert.ok(!(await rpc(anon, 'listar_productos')).some(p => p.nombre === 'Guantes'), 'los insumos no se publican');
    await A.query(`update modulos_config set activo = false where modulo = 'productos'`);
});

test('inventario: la existencia solo cambia con movimientos; sin negativos; costo promedio ponderado', async () => {
    const cera = await producto({ nombre: 'Cera mate', codigo: 'CER-01', categoria: 'Fijación', precio: 450 });
    assert.equal(await existencia(cera), 0);
    await rpc(admin, 'panel_inv_compra', j({ clave: randomUUID(), lineas: [{ producto_id: cera, cantidad: 10, costo_unitario: 100 }] }));
    await rpc(admin, 'panel_inv_compra', j({ clave: randomUUID(), lineas: [{ producto_id: cera, cantidad: 10, costo_unitario: 200 }] }));
    const { rows: [p] } = await A.query('select stock, costo_promedio from productos where id = $1', [cera]);
    assert.deepEqual([n(p.stock), n(p.costo_promedio)], [20, 150], 'promedio ponderado: (10×100 + 10×200) / 20');
    assert.match(await errorDe(A.query('update productos set stock = 99 where id = $1', [cera])), /existencia_solo_por_movimiento/);
    assert.match(await errorDe(admin.query('update productos set stock = 99 where id = $1', [cera])), /permission denied/);
    assert.equal(await errorDe(rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: cera, tipo: 'perdida', cantidad: 25, motivo: 'Caída' }))), 'sin_stock');
    assert.equal(await errorDe(rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: cera, tipo: 'perdida', cantidad: 1, motivo: '' }))), 'motivo_requerido');
    assert.equal(await errorDe(rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: cera, tipo: 'perdida', cantidad: 1.5, motivo: 'Dañada' }))), 'cantidad_invalida');
    await rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: cera, tipo: 'perdida', cantidad: 2, motivo: 'Envase roto' }));
    await rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: cera, tipo: 'ajuste', conteo: 17, motivo: 'Conteo físico mensual' }));
    assert.equal(await existencia(cera), 17);
    const movs = await rpc(admin, 'panel_inv_movimientos', cera, null, null);
    assert.deepEqual(movs.map(m => [m.tipo, n(m.cantidad), n(m.existencia_resultante)]),
        [['ajuste', -1, 17], ['perdida', -2, 18], ['compra', 10, 20], ['compra', 10, 10]]);
    assert.ok(movs.every(m => m.usuario === 'admin@x.com' && m.fecha));
    // Desactivar conserva el historial
    await rpc(admin, 'panel_inv_guardar_producto', cera, j({ nombre: 'Cera mate', codigo: 'CER-01', precio: 450, activo: false }));
    assert.equal((await rpc(admin, 'panel_inv_movimientos', cera, null, null)).length, 4);
    assert.equal(await errorDe(cobrar({ cliente: { telefono: '8095550002' }, lineas: [{ tipo: 'producto', producto_id: cera, cantidad: 1 }] })), 'producto_no_vendible');
    assert.equal(await errorDe(rpc(admin, 'panel_inv_guardar_producto', null, j({ nombre: 'Otra', codigo: 'cer-01', precio: 1 }))), 'codigo_duplicado');
    assert.match(await errorDe(A.query('delete from inventario_movimientos where producto_id = $1', [cera])), /registro_inmutable/);
});

test('venta de productos: descuenta existencias; sin existencias se rechaza sin dejar nada a medias', async () => {
    await rpc(admin, 'panel_caja_abrir', j({ clave: randomUUID(), fondo_inicial: 1000 }));
    const champu = await producto({ nombre: 'Champú', precio: 333.33, costo: 120, existencia_inicial: 3 });
    const v = await cobrar({ lineas: [{ tipo: 'producto', producto_id: champu, cantidad: 3 }], pagos: [{ metodo: 'efectivo', monto: 999.99, recibido: 1000 }] });
    assert.equal(n(v.total), 999.99, 'redondeo a 2 decimales de cada línea');
    assert.equal(n(v.cambio), 0.01);
    assert.equal(v.estado_pago, 'pagada');
    assert.equal(await existencia(champu), 0);
    assert.equal(n(v.lineas[0].costo_unitario), 120, 'costo del momento guardado en la línea');

    const [ventasAntes, pagosAntes, movsAntes] = [await cuenta('ventas'), await cuenta('pagos'), await cuenta('inventario_movimientos')];
    assert.equal(await errorDe(cobrar({ lineas: [{ tipo: 'producto', producto_id: champu, cantidad: 1 }], pagos: [{ metodo: 'tarjeta', monto: 333.33 }] })), 'sin_stock');
    assert.deepEqual([await cuenta('ventas'), await cuenta('pagos'), await cuenta('inventario_movimientos')], [ventasAntes, pagosAntes, movsAntes], 'operación atómica');
    // Venta sin cliente: debe pagarse completa
    const gel = await producto({ nombre: 'Gel', precio: 200, existencia_inicial: 5 });
    assert.equal(await errorDe(cobrar({ lineas: [{ tipo: 'producto', producto_id: gel, cantidad: 1 }] })), 'venta_sin_cliente_debe_pagarse');
    assert.equal(await existencia(gel), 5);
    const fiada = await cobrar({ cliente: { nombre: 'Luis', telefono: '809-555-0003' }, lineas: [{ tipo: 'producto', producto_id: gel, cantidad: 1 }] });
    assert.deepEqual([fiada.estado_pago, n(fiada.saldo)], ['pendiente', 200], 'con cliente identificado puede quedar saldo');
});

test('última unidad: dos ventas simultáneas, solo una se confirma', async () => {
    const aceite = await producto({ nombre: 'Aceite barba', precio: 600, existencia_inicial: 1 });
    const c1 = await db.conexion('authenticated', ADMIN);
    const c2 = await db.conexion('authenticated', ADMIN);
    const r = await Promise.allSettled([c1, c2].map(c => cobrar({ lineas: [{ tipo: 'producto', producto_id: aceite, cantidad: 1 }], pagos: [{ metodo: 'tarjeta', monto: 600 }] }, c)));
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(r.find(x => x.status === 'rejected').reason.message, 'sin_stock');
    assert.equal(await existencia(aceite), 0);
});

test('duplicados: la misma clave (doble clic, reintento, recarga) no repite la venta', async () => {
    const pomada = await producto({ nombre: 'Pomada', precio: 350, existencia_inicial: 4 });
    const datos = { clave: randomUUID(), lineas: [{ tipo: 'producto', producto_id: pomada, cantidad: 1 }], pagos: [{ metodo: 'transferencia', monto: 350 }] };
    const c1 = await db.conexion('authenticated', ADMIN);
    const c2 = await db.conexion('authenticated', ADMIN);
    const [a, b] = await Promise.all([rpc(c1, 'panel_venta_cobrar', j(datos)), rpc(c2, 'panel_venta_cobrar', j(datos))]);
    assert.equal(a.id, b.id);
    assert.deepEqual([a.repetida, b.repetida].sort(), [false, true]);
    assert.equal((await rpc(admin, 'panel_venta_cobrar', j(datos))).repetida, true);
    assert.equal(await existencia(pomada), 3, 'una sola salida de inventario');
    assert.equal(n((await A.query('select count(*) c from pagos where venta_id = $1', [a.id])).rows[0].c), 1);
    assert.equal(await errorDe(rpc(admin, 'panel_caja_abrir', j({ clave: datos.clave, fondo_inicial: 0 }))), 'clave_operacion_usada');
});

test('cita: se cobra una sola vez; confirmar o completar no crea pagos; pago mixto con cambio', async () => {
    const cita = await citaPasada('Mario Mixto');
    await rpc(admin, 'panel_actualizar_cita', cita, 'completar', '{}');
    assert.equal(await cuenta(`ventas where cita_id = '${cita}'`), 0, 'completar el servicio no crea un cobro');
    assert.equal(await errorDe(cobrar({ cita_id: cita, pagos: [{ metodo: 'efectivo', monto: 300, recibido: 500 }] })), 'caja_cerrada');
    await rpc(admin, 'panel_caja_abrir', j({ clave: randomUUID(), fondo_inicial: 500 }));
    const v = await cobrar({ cita_id: cita, pagos: [{ metodo: 'efectivo', monto: 300, recibido: 500 }, { metodo: 'tarjeta', monto: 400, referencia: 'AUT-123' }] });
    assert.deepEqual([n(v.total), n(v.pagado), n(v.cambio), v.estado_pago], [700, 700, 200, 'pagada']);
    assert.deepEqual(v.pagos.map(p => [p.metodo, n(p.monto), p.recibido === null ? null : n(p.recibido), n(p.cambio)]),
        [['efectivo', 300, 500, 200], ['tarjeta', 400, null, 0]], 'se cobra el importe aplicado, no lo entregado');
    const c = await rpc(admin, 'panel_cita', cita);
    assert.deepEqual([c.pagada, n(c.monto_cobrado), c.metodo_pago, c.estado_visual], [true, 700, 'mixto', 'completada']);
    // Una segunda venta para la misma cita no es posible y no se puede cobrar de más
    assert.equal(await errorDe(cobrar({ cita_id: cita, pagos: [{ metodo: 'tarjeta', monto: 1 }] })), 'pago_excede_saldo');
    assert.match(await errorDe(A.query(`insert into ventas (clave, cita_id) values (gen_random_uuid(), $1)`, [cita])), /ventas_cita_activa/);
    const caja = (await cajaAbierta()).resumen;
    assert.deepEqual([n(caja.cobros_efectivo), n(caja.cobros_tarjeta), n(caja.efectivo_esperado)], [300, 400, 800],
        'la tarjeta no aumenta el efectivo esperado; el cambio no cuenta como cobro');
});

test('anticipo: el saldo se cobra después sin contar dos veces el ingreso', async () => {
    const f = await fechaLocal(A, 3);
    const reserva = await rpc(anon, 'reservar_cita', 'Ana Anticipo', null, '8095550010', 'Corte', 'Ana', f, '10:00');
    const desde = await fechaLocal(A, 0);
    const antes = await rpc(admin, 'panel_finanzas', desde, desde, null);
    const anticipo = await cobrar({ cita_id: reserva.cita_id, pagos: [{ metodo: 'transferencia', monto: 300 }] });
    assert.deepEqual([anticipo.estado_pago, n(anticipo.saldo)], ['parcial', 400]);
    assert.equal(anticipo.pagos[0].es_anticipo, true);
    assert.equal((await rpc(admin, 'panel_cita', reserva.cita_id)).pagada, false, 'un anticipo no marca la cita como pagada');
    await A.query(`update citas set completada_en = now() where id = $1`, [reserva.cita_id]);
    const saldo = await cobrar({ cita_id: reserva.cita_id, pagos: [{ metodo: 'tarjeta', monto: 400 }] });
    assert.deepEqual([saldo.id, saldo.estado_pago, n(saldo.pagado)], [anticipo.id, 'pagada', 700], 'la misma venta recibe el saldo');
    const despues = await rpc(admin, 'panel_finanzas', desde, desde, null);
    assert.equal(n(despues.cobros) - n(antes.cobros), 700, 'ingreso total 700, no 1000');
    assert.equal(n(despues.anticipos) - n(antes.anticipos), 300);
});

test('descuentos con motivo; servicio sin cita con barbero; venta de servicio y producto juntos', async () => {
    const cera = await producto({ nombre: 'Cera brillo', precio: 400, costo: 150, existencia_inicial: 2 });
    const base = { cliente: { telefono: '8095550020' }, lineas: [{ tipo: 'servicio', servicio_id: ids.barba, barbero_id: ids.beto, cantidad: 1, descuento: 50 },
        { tipo: 'producto', producto_id: cera, cantidad: 1 }] };
    assert.equal(await errorDe(cobrar(base)), 'motivo_descuento_requerido');
    assert.equal(await errorDe(cobrar({ ...base, lineas: [{ tipo: 'servicio', servicio_id: ids.barba, cantidad: 1 }] })), 'barbero_requerido');
    assert.equal(await errorDe(cobrar({ ...base, descuento_motivo: 'Cliente frecuente', lineas: [{ ...base.lineas[0], descuento: 500 }] })), 'descuento_invalido');
    const v = await cobrar({ ...base, descuento_motivo: 'Cliente frecuente', pagos: [{ metodo: 'tarjeta', monto: 650 }] });
    assert.deepEqual([n(v.subtotal), n(v.descuento), n(v.total), v.descuento_motivo], [700, 50, 650, 'Cliente frecuente']);
    const auditoria = (await A.query(`select detalle from auditoria where entidad = 'venta' and entidad_id = $1`, [v.id])).rows[0].detalle;
    assert.equal(auditoria.motivo_descuento, 'Cliente frecuente');
    // Un cambio de precio posterior no altera la venta registrada
    await rpc(admin, 'panel_inv_guardar_producto', cera, j({ nombre: 'Cera brillo', precio: 999 }));
    assert.equal(n((await rpc(admin, 'panel_venta', v.id)).lineas[1].precio_unitario), 400);
});

test('devoluciones y anulaciones: historial conservado; solo se repone lo que regresó apto', async () => {
    await rpc(admin, 'panel_caja_abrir', j({ clave: randomUUID(), fondo_inicial: 1000 }));
    const tonico = await producto({ nombre: 'Tónico', precio: 250, costo: 100, existencia_inicial: 5 });
    const v = await cobrar({ lineas: [{ tipo: 'producto', producto_id: tonico, cantidad: 3 }], pagos: [{ metodo: 'efectivo', monto: 750 }] });
    assert.equal(await existencia(tonico), 2);
    const linea = v.lineas[0].id;
    assert.equal(await errorDe(rpc(admin, 'panel_venta_anular', j({ clave: randomUUID(), venta_id: v.id, motivo: 'Error' }))), 'reembolsa_antes_de_anular');
    // Devuelve 1 apto (se repone) y 1 dañado (no se repone)
    const r = await rpc(admin, 'panel_venta_reembolsar', j({ clave: randomUUID(), venta_id: v.id, motivo: 'Cliente devolvió dos',
        lineas: [{ detalle_id: linea, cantidad: 1, reponer: true }, { detalle_id: linea, cantidad: 1, reponer: false }],
        reembolsos: [{ metodo: 'efectivo', monto: 500 }] }));
    assert.deepEqual([n(r.devuelto), n(r.reembolsado), n(r.cobrado_neto), r.estado_pago], [500, 500, 250, 'pagada']);
    assert.equal(await existencia(tonico), 3, 'solo regresa al inventario la unidad apta');
    assert.match(await errorDe(rpc(admin, 'panel_venta_reembolsar', j({ clave: randomUUID(), venta_id: v.id, motivo: 'Más',
        reembolsos: [{ metodo: 'efectivo', monto: 300 }] }))), /ventas_reembolso_valido|ventas_sin_saldo_a_favor/, 'no se devuelve más de lo cobrado');
    await rpc(admin, 'panel_venta_reembolsar', j({ clave: randomUUID(), venta_id: v.id, motivo: 'Cobro deshecho', reembolsos: [{ metodo: 'efectivo', monto: 250 }] }));
    const anulada = await rpc(admin, 'panel_venta_anular', j({ clave: randomUUID(), venta_id: v.id, motivo: 'Venta registrada por error' }));
    assert.deepEqual([anulada.estado, anulada.estado_pago, anulada.lineas.length, anulada.pagos.length], ['anulada', 'anulada', 1, 3]);
    assert.equal(await existencia(tonico), 4, 'la unidad no devuelta vuelve con la anulación');
    assert.equal((await A.query('select count(*) c from ventas where id = $1', [v.id])).rows[0].c, '1', 'la venta anulada se conserva');
    assert.match(await errorDe(A.query('delete from ventas where id = $1', [v.id])), /registro_inmutable/);
    assert.match(await errorDe(A.query('update pagos set monto = 1 where venta_id = $1', [v.id])), /registro_inmutable/);
    const caja = (await cajaAbierta()).resumen;
    assert.deepEqual([n(caja.cobros_efectivo), n(caja.reembolsos_efectivo), n(caja.efectivo_esperado)], [750, 750, 1000]);
});

test('reembolso de una cita cobrada desde la agenda y desde Módulos', async () => {
    const cita = await citaPasada('Rita Reembolso');
    await rpc(admin, 'panel_actualizar_cita', cita, 'registrar_pago', j({ monto: 700, metodo: 'transferencia' }));
    let c = await rpc(admin, 'panel_actualizar_cita', cita, 'anular_pago', j({ motivo: 'Transferencia no recibida' }));
    assert.deepEqual([c.pagada, c.monto_cobrado], [false, null], 'cobro deshecho: vuelve a tener saldo');
    const venta = (await rpc(admin, 'panel_venta_de_cita', cita)).venta;
    assert.deepEqual([venta.estado_pago, n(venta.saldo), venta.pagos.length], ['reembolsada', 700, 2]);
    await rpc(admin, 'panel_actualizar_cita', cita, 'registrar_pago', j({ monto: 700, metodo: 'tarjeta' }));
    await rpc(admin, 'admin_marcar_cita', cita, 'reembolsar');
    c = await rpc(admin, 'panel_cita', cita);
    const { rows: [cr] } = await A.query('select pagada_en is not null pagada, reembolsada_en is not null reembolsada from citas where id::text = $1', [cita]);
    assert.deepEqual(cr, { pagada: true, reembolsada: true }, 'devolución real: la visita sí se pagó y quedó reembolsada');
});

test('consumo interno y por servicio: descuenta insumos con unidades compatibles, no es venta', async () => {
    const desinfectante = await producto({ nombre: 'Desinfectante', tipo: 'insumo', unidad: 'ml', costo: 0.5, existencia_inicial: 1000 });
    const desde = await fechaLocal(A, 0);
    const antes = await rpc(admin, 'panel_finanzas', desde, desde, null);
    await rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: desinfectante, tipo: 'consumo', cantidad: 100, motivo: 'Limpieza de estaciones' }));
    assert.equal(await existencia(desinfectante), 900);
    // 0,02 l por corte = 20 ml
    assert.equal(await errorDe(rpc(admin, 'panel_inv_guardar_consumo', j({ servicio_id: ids.corte, producto_id: desinfectante, cantidad: 1, unidad: 'unidad' }))), 'unidades_incompatibles');
    await rpc(admin, 'panel_inv_guardar_consumo', j({ servicio_id: ids.corte, producto_id: desinfectante, cantidad: 0.02, unidad: 'l' }));
    const cita = await citaPasada('Carlos Consumo');
    await rpc(admin, 'panel_actualizar_cita', cita, 'completar', '{}');
    await rpc(admin, 'panel_actualizar_cita', cita, 'notas', j({ notas: 'otra actualización' }));
    assert.equal(await existencia(desinfectante), 880, 'un solo consumo de 20 ml por la cita completada');
    const despues = await rpc(admin, 'panel_finanzas', desde, desde, null);
    assert.equal(n(despues.ventas_productos), n(antes.ventas_productos), 'el consumo interno no es venta');
    assert.equal(n(despues.cobros), n(antes.cobros));
    assert.equal(n(despues.costo_consumos.importe) - n(antes.costo_consumos.importe), 60, '120 ml × 0,50');
    // Sin existencia suficiente el servicio se completa igual y queda constancia
    await rpc(admin, 'panel_inv_movimiento', j({ clave: randomUUID(), producto_id: desinfectante, tipo: 'ajuste', conteo: 5, motivo: 'Conteo' }));
    const otra = await citaPasada('Sin Insumo');
    assert.equal((await rpc(admin, 'panel_actualizar_cita', otra, 'completar', '{}')).estado_visual, 'completada');
    assert.equal(await existencia(desinfectante), 5);
    assert.ok((await A.query(`select 1 from auditoria where accion = 'consumo_sin_existencia' and entidad_id = $1`, [desinfectante])).rowCount);
});

test('caja: apertura única, entradas/retiros con motivo, cierre con diferencia y corrección trazable', async () => {
    const apertura = await rpc(admin, 'panel_caja_abrir', j({ clave: randomUUID(), fondo_inicial: 2000 }));
    assert.equal(await errorDe(rpc(admin, 'panel_caja_abrir', j({ clave: randomUUID(), fondo_inicial: 0 }))), 'caja_ya_abierta');
    await rpc(admin, 'panel_caja_movimiento', j({ clave: randomUUID(), tipo: 'entrada', monto: 500, motivo: 'Aporte para cambio' }));
    await rpc(admin, 'panel_caja_movimiento', j({ clave: randomUUID(), tipo: 'retiro', monto: 300, motivo: 'Depósito bancario' }));
    assert.equal(await errorDe(rpc(admin, 'panel_caja_movimiento', j({ clave: randomUUID(), tipo: 'retiro', monto: 100000, motivo: 'Exceso' }))), 'efectivo_insuficiente_en_caja');
    await rpc(admin, 'panel_gasto_registrar', j({ clave: randomUUID(), categoria: 'limpieza', descripcion: 'Escobas', monto: 200, medio: 'efectivo_caja', responsable: 'Ana' }));
    await rpc(admin, 'panel_gasto_registrar', j({ clave: randomUUID(), categoria: 'servicios', descripcion: 'Internet', monto: 1500, medio: 'transferencia' }));
    const esperado = n((await cajaAbierta()).resumen.efectivo_esperado);
    assert.equal(esperado, 2000 + 500 - 300 - 200, 'fondo, aporte y retiro no son ventas; el gasto por transferencia no sale de caja');
    assert.equal(await errorDe(rpc(admin, 'panel_caja_cerrar', j({ clave: randomUUID(), sesion_id: apertura.sesion_id, efectivo_contado: 1950 }))), 'observacion_requerida');
    const cierre = await rpc(admin, 'panel_caja_cerrar', j({ clave: randomUUID(), sesion_id: apertura.sesion_id, efectivo_contado: 1950, observacion: 'Faltan 50' }));
    assert.deepEqual([n(cierre.efectivo_esperado), n(cierre.efectivo_contado), n(cierre.diferencia)], [2000, 1950, -50]);
    // Movimientos posteriores no tocan una caja cerrada
    assert.equal(await errorDe(rpc(admin, 'panel_caja_movimiento', j({ clave: randomUUID(), tipo: 'entrada', monto: 1, motivo: 'Tarde' }))), 'caja_cerrada');
    assert.equal(await errorDe(rpc(admin, 'panel_caja_corregir', j({ clave: randomUUID(), sesion_id: apertura.sesion_id, efectivo_contado: 2000, motivo: 'x' }))), 'motivo_requerido');
    await rpc(admin, 'panel_caja_corregir', j({ clave: randomUUID(), sesion_id: apertura.sesion_id, efectivo_contado: 2000, motivo: 'Billete de 50 encontrado en la gaveta' }));
    const sesiones = await rpc(admin, 'panel_caja_sesiones', await fechaLocal(A, 0), await fechaLocal(A, 0));
    const s = sesiones.find(x => x.id === apertura.sesion_id);
    assert.deepEqual([n(s.diferencia), s.correcciones.length, n(s.correcciones[0].antes), n(s.resumen.efectivo_esperado)], [0, 1, 1950, 2000]);
});

test('compras y gastos: recibir no es pagar; el pago de la compra no se registra dos veces', async () => {
    const prov = (await rpc(admin, 'panel_inv_guardar_proveedor', null, j({ nombre: 'Distribuidora Uno', telefono: '8095551111' }))).id;
    const navaja = await producto({ nombre: 'Cuchillas', tipo: 'insumo', unidad: 'unidad', proveedor_id: prov });
    const desde = await fechaLocal(A, 0);
    const antes = await rpc(admin, 'panel_finanzas', desde, desde, null);
    const compra = await rpc(admin, 'panel_inv_compra', j({ clave: randomUUID(), proveedor_id: prov, factura: 'F-77',
        lineas: [{ producto_id: navaja, cantidad: 100, costo_unitario: 12.5 }] }));
    assert.equal(n(compra.total), 1250);
    let lista = (await rpc(admin, 'panel_inv_compras', desde, desde)).find(c => c.id === compra.compra_id);
    assert.equal(n(lista.pagado), 0, 'mercancía recibida sin pagar');
    await rpc(admin, 'panel_gasto_registrar', j({ clave: randomUUID(), compra_id: compra.compra_id, monto: 1000, medio: 'transferencia' }));
    assert.equal(await errorDe(rpc(admin, 'panel_gasto_registrar', j({ clave: randomUUID(), compra_id: compra.compra_id, monto: 300, medio: 'transferencia' }))), 'pago_excede_compra');
    lista = (await rpc(admin, 'panel_inv_compras', desde, desde)).find(c => c.id === compra.compra_id);
    assert.equal(n(lista.pagado), 1000);
    const despues = await rpc(admin, 'panel_finanzas', desde, desde, null);
    assert.equal(n(despues.pagos_compras) - n(antes.pagos_compras), 1000);
    assert.equal(n(despues.gastos_total), n(antes.gastos_total), 'el pago de la compra no se suma también como gasto general');
    assert.equal(n(despues.compras_recibidas) - n(antes.compras_recibidas), 1250);
    assert.equal(await errorDe(rpc(admin, 'panel_inv_anular_compra', j({ clave: randomUUID(), compra_id: compra.compra_id, motivo: 'Error' }))), 'compra_con_pagos');
});

test('reportes: ventas, cobros, margen con costo documentado e indicadores incompletos', async () => {
    const desde = await fechaLocal(A, 0);
    const sinCosto = await producto({ nombre: 'Peine', precio: 100, existencia_inicial: 3 });
    await cobrar({ lineas: [{ tipo: 'producto', producto_id: sinCosto, cantidad: 1 }], pagos: [{ metodo: 'tarjeta', monto: 100 }] });
    const r = await rpc(admin, 'panel_finanzas', desde, desde, null);
    assert.ok(n(r.costo_productos_vendidos.movimientos_sin_costo) >= 1, 'falta el costo del peine: margen incompleto');
    assert.ok(n(r.inventario.articulos_sin_costo) >= 1);
    assert.ok(r.existencias_bajas.some(p => p.nombre === 'Champú' && p.agotado));
    assert.ok(r.productos_mas_vendidos.length > 0);
    assert.ok(n(r.por_medio.tarjeta.cobros) > 0);
    const porBarbero = await rpc(admin, 'panel_finanzas', desde, desde, ids.beto);
    assert.equal(n(porBarbero.ventas_productos), 0, 'con filtro de barbero solo cuentan sus servicios');
    assert.ok(n(porBarbero.ventas_servicios) > 0);
    assert.deepEqual(porBarbero.servicios_por_barbero.map(b => b.barbero), ['Beto']);
});

test('cobros anteriores al módulo pasan a ventas históricas una sola vez', async () => {
    const cita = await citaPasada('Histórico');
    await A.query(`update citas set completada_en = now(), pagada_en = now(), monto_cobrado = 700, metodo_pago = 'efectivo' where id::text = $1`, [cita]);
    const migracion = (await import('node:fs')).readFileSync(new URL('../migrations/20261026000000_inventario_ventas_caja.sql', import.meta.url), 'utf8');
    await A.query(migracion);
    await A.query(migracion);
    const ventas = (await A.query(`select origen, total, pagado from ventas where cita_id = $1`, [cita])).rows;
    assert.deepEqual(ventas.map(v => [v.origen, n(v.total), n(v.pagado)]), [['historico', 700, 700]]);
    const { rows: [p] } = await A.query(`select p.es_historico, p.sesion_caja_id from pagos p join ventas v on v.id = p.venta_id where v.cita_id = $1`, [cita]);
    assert.deepEqual(p, { es_historico: true, sesion_caja_id: null }, 'no altera el efectivo de ninguna caja');
});
