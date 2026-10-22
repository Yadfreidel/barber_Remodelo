// Ubicación de la barbería: validación compartida y funciones del servidor (PostgreSQL real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarBase, rpc, errorDe } from './helpers.js';
import { validarUbicacion, urlComoLlegar, firmaUbicacion } from '../../models/ubicacionValidacion.js';

const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const USUARIO_ID = '44444444-4444-4444-4444-444444444444';
let db, anon, adminCli, usuarioCli;

before(async () => {
    db = await iniciarBase(54335);
    await db.migrar();
    await db.admin.query('insert into auth.users values ($1), ($2)', [ADMIN_ID, USUARIO_ID]);
    await db.admin.query('insert into admin_usuarios values ($1)', [ADMIN_ID]);
    anon = await db.conexion('anon');
    adminCli = await db.conexion('authenticated', ADMIN_ID);
    usuarioCli = await db.conexion('authenticated', USUARIO_ID);
});

after(() => db?.cerrar());

const guardar = (cli, nombre, direccion, referencia, lat, lng) =>
    rpc(cli, 'admin_guardar_ubicacion', nombre, direccion, referencia, lat, lng);

test('validación: campos obligatorios, rangos y coordenadas 0,0', () => {
    const ok = validarUbicacion({ nombre: ' Barbería ', direccion: 'Calle 1', referencia: '', latitud: '18,4860581', longitud: '-69.9312117' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.valor, { nombre: 'Barbería', direccion: 'Calle 1', referencia: '', latitud: 18.486058, longitud: -69.931212 });

    const malo = validarUbicacion({ nombre: '', direccion: ' ', latitud: '95', longitud: 'abc' });
    assert.deepEqual(Object.keys(malo.errores).sort(), ['direccion', 'latitud', 'longitud', 'nombre']);
    assert.ok(validarUbicacion({ nombre: 'a', direccion: 'b', latitud: 0, longitud: 0 }).errores.latitud);
    assert.ok(validarUbicacion({ nombre: 'a', direccion: 'b', latitud: '', longitud: '' }).errores.latitud, 'vacío no es 0');
    assert.ok(validarUbicacion({ nombre: 'a'.repeat(121), direccion: 'b', latitud: 1, longitud: 1 }).errores.nombre);
});

test('Cómo llegar abre Google Maps con las coordenadas guardadas', () => {
    assert.equal(urlComoLlegar({ latitud: 18.486058, longitud: -69.931212 }),
        'https://www.google.com/maps/dir/?api=1&destination=18.486058%2C-69.931212');
    assert.notEqual(firmaUbicacion({ nombre: 'a', direccion: 'b', latitud: 1, longitud: 2 }), firmaUbicacion({ nombre: 'a', direccion: 'b', latitud: 1, longitud: 3 }));
    assert.equal(firmaUbicacion(null), '');
});

test('servidor: pendiente hasta guardar, solo administradores, coordenadas validadas', async () => {
    assert.equal(await rpc(anon, 'ubicacion_publica'), null, 'sin ubicación inventada');

    assert.match(await errorDe(guardar(anon, 'X', 'Y', '', 18.5, -69.9)), /permission denied/);
    assert.equal(await errorDe(guardar(usuarioCli, 'X', 'Y', '', 18.5, -69.9)), 'no_autorizado');
    assert.match(await errorDe(anon.query('select * from ubicacion_local')), /permission denied/);

    assert.equal(await errorDe(guardar(adminCli, 'X', 'Y', '', 0, 0)), 'ubicacion_coordenadas_invalidas');
    assert.equal(await errorDe(guardar(adminCli, 'X', 'Y', '', 91, 10)), 'ubicacion_coordenadas_invalidas');
    assert.equal(await errorDe(guardar(adminCli, 'X', 'Y', '', 18, -181)), 'ubicacion_coordenadas_invalidas');
    assert.equal(await errorDe(guardar(adminCli, '  ', 'Y', '', 18, -69)), 'ubicacion_nombre_invalido');
    assert.equal(await errorDe(guardar(adminCli, 'X', '', '', 18, -69)), 'ubicacion_direccion_invalida');
    assert.equal(await rpc(anon, 'ubicacion_publica'), null, 'los intentos fallidos no guardan nada');

    const r = await guardar(adminCli, ' Barbería Master ', 'Av. Principal 10', 'Frente al parque', 18.4860581, -69.9312117);
    assert.equal(r.nombre, 'Barbería Master');
    assert.equal(Number(r.latitud), 18.486058);
    const publica = await rpc(anon, 'ubicacion_publica');
    assert.equal(publica.referencia, 'Frente al parque');
    assert.equal(Number(publica.longitud), -69.931212);

    // Actualizar mantiene una sola fila y la referencia vacía queda en null
    await guardar(adminCli, 'Barbería Master', 'Av. Principal 12', '', 18.5, -69.95);
    const { rows } = await db.admin.query('select count(*)::int n, max(referencia) ref, max(actualizado_por::text) por from ubicacion_local');
    assert.deepEqual(rows[0], { n: 1, ref: null, por: ADMIN_ID });
    assert.equal((await rpc(anon, 'ubicacion_publica')).direccion, 'Av. Principal 12');
});
