// Proyecto de Supabase vacío: todas las migraciones en orden crean un esquema funcional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Solo la parte de la plantilla que imita a Supabase (roles y auth), sin tablas de la app
const SUPABASE = fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'base_supabase.sql'), 'utf8').split('create table public.barberos')[0];

test('proyecto nuevo: base inicial + módulos, reserva web y anti double-booking', async () => {
    const servidor = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'barberia-nuevo-')), port: 54332, user: 'postgres', password: 'postgres', persistent: false, onLog: () => {} });
    await servidor.initialise();
    await servidor.start();
    const config = { host: 'localhost', port: 54332, user: 'postgres', password: 'postgres', database: 'postgres' };
    const admin = new pg.Client(config);
    const anon = new pg.Client(config);
    try {
        await admin.connect();
        await admin.query(SUPABASE);
        const migraciones = fs.readdirSync(path.join(raiz, 'migrations')).filter(f => f.endsWith('.sql')).sort();
        for (const f of migraciones) await admin.query(fs.readFileSync(path.join(raiz, 'migrations', f), 'utf8'));
        for (const f of migraciones) await admin.query(fs.readFileSync(path.join(raiz, 'migrations', f), 'utf8')); // idempotentes

        const { rows: [n] } = await admin.query(`select (select count(*) from barberos)::int b, (select count(*) from servicios)::int s`);
        assert.deepEqual(n, { b: 3, s: 53 });

        await anon.connect();
        await anon.query('set role anon');
        const fecha = (await anon.query(`select (current_date + 3)::text f`)).rows[0].f;
        // Flujo actual de la web: buscar ids e insertar directo
        const ids = (await anon.query(`select (select id from barberos where nombre = 'Isaac Garcia') b, (select id from servicios where nombre = 'Corte Signature Master') s`)).rows[0];
        const insertar = () => anon.query(`insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado)
                                           values ('Ana', '8091234567', 'a@x.com', $1, $2, $3, '10:00', 'pendiente')`, [ids.b, ids.s, fecha]);
        await insertar();
        await assert.rejects(insertar(), e => e.code === '23505' && e.message.includes('citas_barbero_id_fecha_hora'));
        await admin.query(`update citas set estado = 'cancelada' where fecha = $1`, [fecha]);
        await insertar();

        // Reserva por el servidor (módulos)
        const r = (await anon.query(`select public.reservar_cita('Leo', 'l@x.com', '8097654321', 'Corte Signature Master', 'Acxel Rosario', $1::date, '11:00'::time) r`, [fecha])).rows[0].r;
        assert.equal(Number(r.precio_final), 700);
        assert.ok(r.token);
        // Sin política de borrado, RLS no deja eliminar citas con la anon key
        await assert.rejects(anon.query('delete from citas'), e => e.code === '42501');
    } finally {
        await admin.end().catch(() => {});
        await anon.end().catch(() => {});
        await servidor.stop();
    }
});
