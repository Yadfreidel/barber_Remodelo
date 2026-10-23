// supabase/barberia_migrar_desde_public.sql: de una instalación anterior en public a barberia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE = fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'base_supabase.sql'), 'utf8').split('create table public.barberos')[0];
const MIGRACIONES = fs.readdirSync(path.join(raiz, 'migrations')).filter(f => f.endsWith('.sql')).sort()
    .map(f => fs.readFileSync(path.join(raiz, 'migrations', f), 'utf8'));
const BASE = fs.readFileSync(path.join(raiz, 'base_completa.sql'), 'utf8');
const MIGRAR = fs.readFileSync(path.join(raiz, 'barberia_migrar_desde_public.sql'), 'utf8');
const ADMIN = '12121212-1212-1212-1212-121212121212';

test('migración public -> barberia: datos, ids, tokens y configuración; public intacto', async () => {
    const servidor = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'barberia-migracion-')), port: 54339,
        user: 'postgres', password: 'postgres', persistent: false, onLog: () => {} });
    await servidor.initialise();
    await servidor.start();
    const config = { host: 'localhost', port: 54339, user: 'postgres', password: 'postgres', database: 'postgres' };
    const db = new pg.Client(config);
    try {
        await db.connect();
        await db.query(SUPABASE);
        for (const sql of MIGRACIONES) await db.query(sql); // instalación anterior en public
        await db.query(`insert into auth.users (id, email) values ($1, 'yafre2310@gmail.com')`, [ADMIN]);
        await db.query('insert into public.admin_usuarios values ($1)', [ADMIN]);
        const fecha = (await db.query(`select (public._ahora_local()::date + 5)::text f`)).rows[0].f;
        const reserva = (await db.query(`select public.reservar_cita('Lucía', null, '8095550001', 'corte-01', 'Isaac Garcia', $1::date, '10:00'::time) r`, [fecha])).rows[0].r;
        await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
        await db.query(`select public.panel_crear_cita(jsonb_build_object('nombre', 'Mario', 'telefono', '8095550002', 'servicio_id',
            (select id::text from public.servicios where catalogo_id = 'corte-02'), 'barbero_id', (select id::text from public.barberos where nombre = 'Acxel Rosario'),
            'fecha', $1::text, 'hora', '11:00', 'notas', 'Llamó por teléfono'))`, [fecha]);
        await db.query(`select public.panel_guardar_cliente('8095550002', '{"nombre":"Mario","notas":"Prefiere tijera"}')`);
        await db.query(`update public.modulos_config set ajustes = ajustes || '{"hora_cierre":"21:00"}' where modulo = 'general'`);
        await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
        const antes = (await db.query(`select (select count(*) from public.citas)::int c, (select count(*) from public.auditoria)::int a,
            (select max(id) from public.citas)::int m, (select md5(string_agg(t::text, '|' order by t::text)) from public.citas t) h`)).rows[0];

        await db.query(BASE);
        await assert.rejects(db.query(MIGRAR.replace("to_regclass('public.citas') is null", "to_regclass('public.no_existe') is null")), /No hay una instalación anterior/);
        await db.query('rollback').catch(() => {});
        const res = await db.query(MIGRAR);
        assert.deepEqual(res.at(-1).rows[0], { citas_migradas: '2', barberos: '3', servicios: '53', administradores: '1' });

        // public intacto
        const despues = (await db.query(`select (select count(*) from public.citas)::int c, (select count(*) from public.auditoria)::int a,
            (select max(id) from public.citas)::int m, (select md5(string_agg(t::text, '|' order by t::text)) from public.citas t) h`)).rows[0];
        assert.deepEqual(despues, antes);

        // Datos y referencias conservados
        assert.equal((await db.query('select count(*)::int n from barberia.auditoria')).rows[0].n, antes.a, 'auditoría copiada sin duplicar');
        assert.equal((await db.query(`select notas from barberia.clientes where telefono = '8095550002'`)).rows[0].notas, 'Prefiere tijera');
        assert.equal((await db.query(`select ajustes->>'hora_cierre' h from barberia.modulos_config where modulo = 'general'`)).rows[0].h, '21:00');
        assert.ok((await db.query(`select ajustes ? 'minutos_entre_citas' k from barberia.modulos_config where modulo = 'general'`)).rows[0].k, 'conserva ajustes nuevos');
        const anon = new pg.Client(config);
        await anon.connect();
        await anon.query('set role anon');
        assert.equal((await anon.query('select barberia.consultar_cita($1) c', [reserva.token])).rows[0].c.nombre, 'Lucía', 'el token anterior sigue sirviendo');
        assert.equal((await anon.query(`select barberia.horarios_disponibles('corte-01', 'Isaac Garcia', $1::date) h`, [fecha])).rows[0].h.includes('10:00'), false, 'la cita copiada ocupa su hora');
        const nueva = (await anon.query(`select barberia.reservar_cita('Nuevo', null, '8095550003', 'corte-01', 'Isaac Garcia', $1::date, '12:00'::time) r`, [fecha])).rows[0].r;
        assert.ok(Number(nueva.cita_id) > antes.m, 'los ids nuevos continúan después de los copiados');
        assert.equal((await db.query(`select count(*)::int n from barberia.auditoria where entidad = 'cita' and entidad_id = $1`, [nueva.cita_id])).rows[0].n, 1, 'triggers reactivados');
        await anon.end();
        await assert.rejects(db.query(MIGRAR), /ya tiene datos/, 'no se ejecuta dos veces');
    } finally {
        await db.end().catch(() => {});
        await servidor.stop();
    }
});
