// supabase/base_completa.sql (esquema barberia) en un proyecto de Supabase COMPARTIDO con otra
// aplicación (dominó) que usa public. Simula PostgREST: rol anon/authenticated y search_path del perfil.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE = fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'base_supabase.sql'), 'utf8').split('create table public.barberos')[0];
const BASE = fs.readFileSync(path.join(raiz, 'base_completa.sql'), 'utf8');
const ADMIN = '77777777-7777-7777-7777-777777777777';
const BARBERO = '88888888-8888-8888-8888-888888888888';
const AJENO = '99999999-9999-9999-9999-999999999999'; // administrador de dominó, sin rol en barbería
const PUERTO = 54338;

// Aplicación de dominó ya instalada en public (y un esquema private ajeno)
const DOMINO = `
create table public.players (id bigint generated always as identity primary key, name text not null, user_id uuid);
create table public.matches (id bigint generated always as identity primary key, player_a bigint references public.players, player_b bigint references public.players, score int);
alter table public.players enable row level security;
alter table public.matches enable row level security;
create policy players_lectura on public.players for select to anon, authenticated using (true);
create policy matches_lectura on public.matches for select to authenticated using (true);
grant select on public.players to anon, authenticated;
grant select, insert on public.matches to authenticated;
insert into public.players (name) values ('Ana'), ('Beto');
insert into public.matches (player_a, player_b, score) values (1, 2, 150);
create table public.admin_usuarios (user_id uuid primary key);
insert into public.admin_usuarios values ('${AJENO}');
create function public.es_admin() returns boolean language sql stable as $$ select true $$;
create schema private;
create function private.ayuda_domino() returns int language sql as $$ select 1 $$;
`;

// Huella de todo lo que NO es barbería (dominó, private, auth): no debe cambiar
const HUELLA = `
select jsonb_build_object(
  'clases', (select jsonb_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity order by 1)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'auth')),
  'funciones', (select jsonb_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') order by 1)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'auth')),
  'politicas', (select jsonb_agg(schemaname || '.' || tablename || '.' || policyname || ':' || qual order by 1) from pg_policies where schemaname <> 'barberia'),
  'esquemas', (select jsonb_agg(nspname || ':' || coalesce(nspacl::text, '') order by 1) from pg_namespace where nspname in ('public', 'private', 'auth')),
  'triggers', (select jsonb_agg(tgname order by 1) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in ('public', 'private', 'auth') and not t.tgisinternal),
  'datos', (select jsonb_build_array((select count(*) from public.players), (select count(*) from public.matches), (select count(*) from public.admin_usuarios)))
) h`;

let servidor, config, db;
const clientes = [];

async function conexion(rol, usuario = null) {
    const c = new pg.Client(config);
    await c.connect();
    clientes.push(c);
    if (usuario) await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario]);
    await c.query(`set role ${rol}`);
    await c.query('set search_path = barberia, public'); // perfil "barberia" de PostgREST + extra search path
    return c;
}
const rpc = async (c, fn, ...args) => (await c.query(`select barberia.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args)).rows[0].r;
const error = async promesa => { try { await promesa; return null; } catch (e) { return e.message; } };

before(async () => {
    servidor = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'barberia-compartido-')), port: PUERTO,
        user: 'postgres', password: 'postgres', persistent: false, onLog: () => {} });
    await servidor.initialise();
    await servidor.start();
    config = { host: 'localhost', port: PUERTO, user: 'postgres', password: 'postgres', database: 'postgres' };
    db = new pg.Client(config);
    await db.connect();
    await db.query(SUPABASE);
    await db.query(DOMINO);
    await db.query(`insert into auth.users (id, email) values ($1, 'barbero@x.com'), ($2, 'ajeno@domino.com')`, [BARBERO, AJENO]);
});

after(async () => {
    for (const c of [db, ...clientes]) await c?.end().catch(() => {});
    await servidor?.stop();
});

test('instalación en barberia: transaccional, repetible y sin tocar public, private ni auth', async () => {
    const antes = (await db.query(HUELLA)).rows[0].h;
    let estado = (await db.query(BASE)).at(-1).rows[0].estado_instalacion;
    assert.match(estado, /Falta: crea yafre2310@gmail.com/);
    await db.query(`insert into auth.users (id, email) values ($1, 'yafre2310@gmail.com')`, [ADMIN]);
    estado = (await db.query(BASE)).at(-1).rows[0].estado_instalacion;
    assert.match(estado, /Listo: yafre2310@gmail.com es administrador/);
    assert.deepEqual((await db.query(HUELLA)).rows[0].h, antes, 'dominó, private y auth sin cambios');
    assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'citas_duracion_catalogo' and pronamespace = 'private'::regnamespace`)).rows[0].n, 0);

    // Una instalación que falla no deja nada a medias
    const roto = BASE.replace('create table if not exists barberia.ubicacion_local', 'create table barberia.ubicacion_local_ERROR (x int); select 1/0; create table if not exists barberia.ubicacion_local');
    const limpio = new pg.Client(config);
    await limpio.connect();
    await limpio.query('create schema prueba_rollback');
    await assert.rejects(limpio.query(roto.replace(/barberia/g, 'prueba_rollback').replace('create schema if not exists prueba_rollback;', '')));
    await limpio.query('rollback').catch(() => {});
    assert.equal((await limpio.query(`select count(*)::int n from pg_tables where schemaname = 'prueba_rollback'`)).rows[0].n, 0, 'sin instalación parcial');
    await limpio.end();
});

test('seguridad del esquema: RLS en todas las tablas, EXECUTE mínimo y SECURITY DEFINER con search_path', async () => {
    const { rows: sinRls } = await db.query(`select tablename from pg_tables where schemaname = 'barberia' and not rowsecurity`);
    assert.deepEqual(sinRls, []);
    assert.ok((await db.query(`select count(*)::int n from pg_tables where schemaname = 'barberia'`)).rows[0].n >= 27);
    const { rows: ejecutablesPorTodos } = await db.query(`
        select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('barberia', 'barberia_private') and has_function_privilege('public', p.oid, 'execute')`);
    assert.deepEqual(ejecutablesPorTodos, [], 'ninguna función ejecutable por PUBLIC');
    const { rows: definerSinRuta } = await db.query(`
        select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('barberia', 'barberia_private') and not ('search_path=barberia, pg_temp' = any (coalesce(p.proconfig, '{}')))`);
    assert.deepEqual(definerSinRuta, [], 'toda función fija search_path=barberia, pg_temp');
    const priv = (await db.query(`select has_schema_privilege('anon', 'barberia_private', 'usage') a, has_schema_privilege('authenticated', 'barberia_private', 'usage') b,
        has_schema_privilege('anon', 'barberia', 'usage') c`)).rows[0];
    assert.deepEqual(priv, { a: false, b: false, c: true });
    const internas = (await db.query(`select has_function_privilege('anon', 'barberia._cotizar(text,text,date,time,text)', 'execute') a,
        has_function_privilege('authenticated', 'barberia._slot_libre(text,date,time,int,text)', 'execute') b,
        has_function_privilege('anon', 'barberia.whatsapp_reclamar(int)', 'execute') c,
        has_function_privilege('service_role', 'barberia.whatsapp_reclamar(int)', 'execute') d,
        has_function_privilege('anon', 'barberia.reservar_cita(text,text,text,text,text,date,time,jsonb,text,boolean,numeric,uuid)', 'execute') e`)).rows[0];
    assert.deepEqual(internas, { a: false, b: false, c: false, d: true, e: true });
    const misCitas = (await db.query(`select has_function_privilege('anon', 'barberia.mis_citas_por_tokens(uuid[],uuid[])', 'execute') a,
        has_function_privilege('anon', 'barberia.horarios_dia_publico(text,text,date)', 'execute') b,
        has_function_privilege('anon', 'barberia.mis_citas()', 'execute') c,
        has_function_privilege('anon', 'barberia.vincular_citas(uuid[])', 'execute') d,
        has_function_privilege('authenticated', 'barberia.mis_citas()', 'execute') e,
        has_function_privilege('authenticated', 'barberia._cita_cliente_json(text)', 'execute') f`)).rows[0];
    assert.deepEqual(misCitas, { a: true, b: true, c: false, d: false, e: true, f: false });
});

test('web pública (anon): catálogo, disponibilidad, reserva y sin duplicados ni datos personales', async () => {
    const anon = await conexion('anon');
    assert.equal((await rpc(anon, 'catalogo_publico')).length, 25);
    assert.equal((await rpc(anon, 'barberos_publicos')).length, 3);
    assert.equal((await rpc(anon, 'config_publica')).instalado, true);
    const fecha = (await db.query(`select (barberia._ahora_local()::date + 4)::text f`)).rows[0].f;
    const horas = await rpc(anon, 'horarios_disponibles', 'corte-01', 'Isaac Garcia', fecha);
    assert.ok(horas.includes('10:00'));
    const r = (await anon.query(`select barberia.reservar_cita('Cliente Web', null, '8094233247', 'corte-01', 'Isaac Garcia', $1::date, '10:00'::time) r`, [fecha])).rows[0].r;
    assert.ok(r.token);
    assert.equal(await error(anon.query(`select barberia.reservar_cita('Otro', null, '8095551111', 'corte-01', 'Isaac Garcia', $1::date, '10:00'::time)`, [fecha])), 'horario_no_disponible');
    assert.equal(await error(anon.query(`select barberia.reservar_cita('Otro', null, '8095551111', 'corte-01', 'Isaac Garcia', $1::date, '10:20'::time)`, [fecha])), 'horario_no_disponible', 'se cruza por duración');
    assert.ok(!(await rpc(anon, 'horarios_disponibles', 'corte-01', 'Isaac Garcia', fecha)).includes('10:00'));
    assert.equal((await anon.query('select barberia.consultar_cita($1) c', [r.token])).rows[0].c.estado, 'pendiente');

    assert.match(await error(anon.query('select * from barberia.citas')), /permission denied/);
    assert.match(await error(anon.query('select * from barberia.clientes')), /permission denied/);
    assert.match(await error(anon.query('select * from barberia.cita_tokens')), /permission denied/);
    assert.match(await error(anon.query(`insert into barberia.barberos (nombre) values ('Intruso')`)), /permission denied/);
    assert.match(await error(anon.query(`insert into barberia.citas (nombre_cliente, telefono_cliente, barbero_id, servicio_id, fecha, hora) values ('x','1',1,1,$1,'11:00')`, [fecha])), /permission denied/);
    assert.match(await error(rpc(anon, 'panel_resumen')), /permission denied/);
    assert.match(await error(anon.query('select barberia._cotizar($1, $1, current_date, $2)', ['1', '10:00'])), /permission denied/);
    assert.equal((await anon.query('select count(*)::int n from public.players')).rows[0].n, 2, 'dominó sigue funcionando');
});

test('panel: administrador y barbero desde barberia; un admin de dominó no tiene acceso', async () => {
    const ajeno = await conexion('authenticated', AJENO);
    assert.equal((await rpc(ajeno, 'rol_panel')).rol, null, 'ser admin en public no da acceso a barbería');
    assert.equal(await rpc(ajeno, 'es_admin'), false);
    assert.equal(await error(rpc(ajeno, 'panel_resumen')), 'no_autorizado');
    assert.equal(await error(rpc(ajeno, 'panel_clientes', null)), 'no_autorizado');
    assert.equal((await ajeno.query('select count(*)::int n from barberia.citas')).rows[0].n, 0, 'RLS: sin filas de citas');
    assert.match(await error(ajeno.query('select * from barberia.clientes')), /permission denied/);

    const admin = await conexion('authenticated', ADMIN);
    assert.equal((await rpc(admin, 'rol_panel')).rol, 'admin');
    const fecha = (await db.query(`select (barberia._ahora_local()::date + 4)::text f`)).rows[0].f;
    const citas = await rpc(admin, 'panel_citas', fecha, fecha, null, null, null);
    assert.equal(citas.length, 1);
    const isaac = citas[0].barbero_id;
    assert.equal(await error(rpc(admin, 'panel_crear_cita', JSON.stringify({ nombre: 'Cruce', telefono: '8090001234', servicio_id: citas[0].servicio_id,
        barbero_id: isaac, fecha, hora: '10:15' }))), 'horario_no_disponible', 'sin cruces desde administración');
    const { rows: [otro] } = await db.query(`select id::text from barberia.barberos where nombre = 'Acxel Rosario'`);
    await rpc(admin, 'panel_crear_cita', JSON.stringify({ nombre: 'Cliente de Acxel', telefono: '8090004321', servicio_id: citas[0].servicio_id, barbero_id: otro.id, fecha, hora: '11:00' }));
    await rpc(admin, 'panel_vincular_usuario_barbero', isaac, 'barbero@x.com');

    const barbero = await conexion('authenticated', BARBERO);
    assert.equal((await rpc(barbero, 'rol_panel')).rol, 'barbero');
    const agenda = await rpc(barbero, 'panel_citas', fecha, fecha, otro.id, null, null);
    assert.deepEqual(agenda.map(c => c.barbero_id), [isaac], 'solo su agenda');
    assert.equal((await barbero.query('select count(*)::int n from barberia.citas')).rows[0].n, 1, 'RLS: solo sus citas');
    assert.equal(await error(rpc(barbero, 'panel_clientes', null)), 'no_autorizado');
    assert.equal(await error(rpc(barbero, 'panel_actualizar_cita', agenda[0].id, 'cancelar', JSON.stringify({ motivo: 'prueba' }))), 'no_autorizado');
    assert.equal((await rpc(barbero, 'panel_actualizar_cita', agenda[0].id, 'confirmar', '{}')).estado, 'confirmada');

    const servicio = await conexion('service_role');
    assert.deepEqual((await servicio.query('select * from barberia.whatsapp_reclamar(5)')).rows, [], 'servidor: cola accesible');
});
