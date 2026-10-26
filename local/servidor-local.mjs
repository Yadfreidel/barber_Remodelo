// =====================================================================
// ENTORNO LOCAL QUE IMITA A SUPABASE (solo desarrollo, Windows)
//   PostgreSQL 17 (embedded-postgres, datos en local/.datos-pg)
//   PostgREST  -> http://localhost:54321/rest/v1   (misma API que Supabase)
//   Auth       -> http://localhost:54321/auth/v1   (login con correo/contraseña)
//   Web        -> http://localhost:8080
//   Tareas programadas: procesar_tareas_programadas() cada minuto
// Uso: npm run local
// =====================================================================
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// BARBERIA_DATOS y BARBERIA_PUERTOS (web,api,postgres,postgrest) permiten una segunda instancia (p. ej. para pruebas)
const DIR_DATOS = process.env.BARBERIA_DATOS ? path.resolve(process.env.BARBERIA_DATOS) : path.join(RAIZ, 'local', '.datos-pg');
const DIR_BIN = path.join(RAIZ, 'local', '.bin');
const BASE_BARBERIA = path.join(RAIZ, 'supabase', 'base_completa.sql');
const MIGRAR_DESDE_PUBLIC = path.join(RAIZ, 'supabase', 'barberia_migrar_desde_public.sql');

const [PW, PA, PP, PR] = (process.env.BARBERIA_PUERTOS || '8080,54321,54322,54323').split(',').map(Number);
const PUERTOS = { web: PW, api: PA, postgres: PP, postgrest: PR };
// Edge Functions locales (supabase/functions/*) servidas con Deno: npm run local:funciones
const FUNCIONES = process.env.BARBERIA_FUNCIONES || 'http://127.0.0.1:54329';
const VERSION_POSTGREST = 'v16.4';
const CLAVE_POSTGRES = 'postgres-local';
const CLAVE_AUTHENTICATOR = 'authenticator-local';
// Secreto SOLO para desarrollo local; la anon key de assets/config.js se firma con él
const JWT_SECRETO = 'barberia-local-secreto-solo-para-desarrollo';
const ADMIN = { email: 'yafre2310@gmail.com', clave: '123456' };

// ==========================================
// JWT (HS256) y contraseñas
// ==========================================
const b64url = datos => Buffer.from(datos).toString('base64url');

function firmarJWT(payload) {
    const cuerpo = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
    return `${cuerpo}.${crypto.createHmac('sha256', JWT_SECRETO).update(cuerpo).digest('base64url')}`;
}

function verificarJWT(token) {
    const [cabecera, cuerpo, firma] = String(token || '').split('.');
    if (!firma) return null;
    const esperada = crypto.createHmac('sha256', JWT_SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url');
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return payload.exp && payload.exp < Date.now() / 1000 ? null : payload;
}

export const ANON_KEY = firmarJWT({ iss: 'barberia-local', role: 'anon', iat: 1760000000, exp: 4102444800 });
// Solo para las Edge Functions locales (nunca en el navegador)
export const SERVICE_KEY = firmarJWT({ iss: 'barberia-local', role: 'service_role', iat: 1760000000, exp: 4102444800 });

function hashClave(clave) {
    const sal = crypto.randomBytes(16).toString('hex');
    return `scrypt$${sal}$${crypto.scryptSync(clave, sal, 32).toString('hex')}`;
}

function claveValida(clave, guardada) {
    const [, sal, hash] = String(guardada).split('$');
    if (!sal || !hash) return false;
    return crypto.timingSafeEqual(crypto.scryptSync(clave, sal, 32), Buffer.from(hash, 'hex'));
}

// ==========================================
// POSTGRESQL
// ==========================================
async function iniciarPostgres() {
    const primeraVez = !fs.existsSync(path.join(DIR_DATOS, 'PG_VERSION'));
    const servidor = new EmbeddedPostgres({
        databaseDir: DIR_DATOS, port: PUERTOS.postgres, user: 'postgres', password: CLAVE_POSTGRES,
        persistent: true, onLog: () => {}, onError: e => console.error('[postgres]', String(e).trim())
    });
    if (primeraVez) await servidor.initialise();
    await servidor.start();

    const db = new pg.Client({ host: 'localhost', port: PUERTOS.postgres, user: 'postgres', password: CLAVE_POSTGRES, database: 'postgres' });
    await db.connect();
    return { servidor, db, primeraVez };
}

// Roles y esquema auth equivalentes a los de Supabase
async function prepararEsquemaSupabase(db) {
    await db.query(`
        do $$
        begin
            if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
            if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
            if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
            if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
        end $$;
        alter role authenticator with login password '${CLAVE_AUTHENTICATOR}';
        grant anon, authenticated, service_role to authenticator;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

        create schema if not exists auth;
        create table if not exists auth.users (
            id uuid primary key default gen_random_uuid(),
            email text not null unique,
            password_hash text not null,
            created_at timestamptz not null default now()
        );
        -- Columnas de Supabase Auth que usa barbería (verificación, último acceso, huella del hash)
        alter table auth.users add column if not exists email_confirmed_at timestamptz default now();
        alter table auth.users add column if not exists last_sign_in_at timestamptz;
        alter table auth.users add column if not exists raw_app_meta_data jsonb default '{}'::jsonb;
        alter table auth.users add column if not exists encrypted_password text generated always as (password_hash) stored;
        create or replace function auth.uid() returns uuid language sql stable as $f$
            select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                                   nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
        $f$;
        grant usage on schema auth to anon, authenticated, service_role;

        create table if not exists public.migraciones_locales (archivo text primary key, aplicada_en timestamptz not null default now());
        revoke all on public.migraciones_locales from anon, authenticated;
    `);
}

// Misma instalación que en Supabase: esquema barberia (supabase/base_completa.sql, idempotente).
// Una sola vez: si esta base tenía barbería en public (versión anterior), se copian sus datos.
async function instalarBarberia(db) {
    try {
        await db.query(fs.readFileSync(BASE_BARBERIA, 'utf8'));
    } catch (e) {
        await db.query('rollback').catch(() => {});
        throw new Error(`Falló la instalación de barberia: ${e.message}`);
    }
    const marca = 'barberia_desde_public';
    const { rowCount: hecha } = await db.query('select 1 from public.migraciones_locales where archivo = $1', [marca]);
    if (hecha) return;
    const { rows: [estado] } = await db.query(`select to_regclass('public.citas') is not null as anterior,
        (select count(*) from barberia.citas)::int as citas`);
    if (estado.anterior && estado.citas === 0) {
        try {
            await db.query(fs.readFileSync(MIGRAR_DESDE_PUBLIC, 'utf8'));
        } catch (e) {
            await db.query('rollback').catch(() => {});
            throw new Error(`Falló la migración de public a barberia: ${e.message}`);
        }
        console.log('  datos de la instalación anterior (public) copiados a barberia');
    }
    await db.query('insert into public.migraciones_locales (archivo) values ($1) on conflict do nothing', [marca]);
}

async function asegurarAdmin(db) {
    const { rows: [existente] } = await db.query('select id from auth.users where email = $1', [ADMIN.email]);
    const id = existente
        ? existente.id
        : (await db.query('insert into auth.users (email, password_hash) values ($1, $2) returning id', [ADMIN.email, hashClave(ADMIN.clave)])).rows[0].id;
    await db.query('insert into barberia.admin_usuarios (user_id) values ($1) on conflict (user_id) do nothing', [id]);
}

// ==========================================
// POSTGREST
// ==========================================
async function asegurarPostgrest() {
    const exe = path.join(DIR_BIN, 'postgrest.exe');
    if (fs.existsSync(exe)) return exe;
    if (process.platform !== 'win32') throw new Error('Este script descarga PostgREST para Windows; en otro sistema instálalo manualmente en local/.bin');
    fs.mkdirSync(DIR_BIN, { recursive: true });
    const url = `https://github.com/PostgREST/postgrest/releases/download/${VERSION_POSTGREST}/postgrest-${VERSION_POSTGREST}-windows-x86-64.zip`;
    console.log(`  descargando PostgREST ${VERSION_POSTGREST}...`);
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`No se pudo descargar PostgREST (${respuesta.status})`);
    const zip = path.join(DIR_BIN, 'postgrest.zip');
    fs.writeFileSync(zip, Buffer.from(await respuesta.arrayBuffer()));
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${DIR_BIN}' -Force`]);
    fs.rmSync(zip);
    return exe;
}

async function iniciarPostgrest() {
    const exe = await asegurarPostgrest();
    // PostgREST necesita libpq.dll: se usa la de los binarios de embedded-postgres
    const dirLibpq = path.join(RAIZ, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
    if (!fs.existsSync(path.join(dirLibpq, 'libpq.dll'))) throw new Error(`No se encontró libpq.dll en ${dirLibpq} (ejecuta npm install)`);
    const proceso = spawn(exe, [], {
        env: {
            ...process.env,
            PATH: `${dirLibpq}${path.delimiter}${process.env.PATH}`,
            PGRST_DB_URI: `postgres://authenticator:${CLAVE_AUTHENTICATOR}@127.0.0.1:${PUERTOS.postgres}/postgres`,
            PGRST_DB_SCHEMAS: 'barberia',
            PGRST_DB_ANON_ROLE: 'anon',
            PGRST_JWT_SECRET: JWT_SECRETO,
            PGRST_SERVER_HOST: '127.0.0.1',
            PGRST_SERVER_PORT: String(PUERTOS.postgrest)
        },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    proceso.stderr.on('data', d => console.error('[postgrest]', String(d).trim()));

    for (let i = 0; i < 120; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${PUERTOS.postgrest}/`)).ok) return proceso;
        } catch (e) {
            // aún iniciando
        }
        await new Promise(r => setTimeout(r, 500));
    }
    proceso.kill();
    throw new Error('PostgREST no respondió');
}

// ==========================================
// API ESTILO SUPABASE (/rest/v1 y /auth/v1)
// ==========================================
function leerCuerpo(req) {
    return new Promise((ok, error) => {
        const partes = [];
        req.on('data', c => partes.push(c)).on('end', () => ok(Buffer.concat(partes))).on('error', error);
    });
}

function cabecerasCors(req) {
    return {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'authorization, apikey, content-type, prefer, accept, x-client-info',
        'Access-Control-Expose-Headers': 'Content-Range, Preference-Applied',
        'Vary': 'Origin'
    };
}

function responderJSON(res, req, status, datos) {
    res.writeHead(status, { ...cabecerasCors(req), 'Content-Type': 'application/json' });
    res.end(datos === undefined ? '' : JSON.stringify(datos));
}

function usuarioPublico(u) {
    return {
        id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
        app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
        created_at: u.created_at, updated_at: u.created_at
    };
}

function crearSesion(u) {
    const ahora = Math.floor(Date.now() / 1000);
    const duracion = 60 * 60 * 24 * 7;
    return {
        access_token: firmarJWT({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: ahora, exp: ahora + duracion }),
        refresh_token: firmarJWT({ sub: u.id, tipo: 'refresh', iat: ahora, exp: ahora + duracion * 4 }),
        token_type: 'bearer',
        expires_in: duracion,
        expires_at: ahora + duracion,
        user: usuarioPublico(u)
    };
}

async function manejarAuth(req, res, url, db) {
    const credencialesInvalidas = () => responderJSON(res, req, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });

    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
        if (url.searchParams.get('grant_type') === 'password') {
            const { rows: [u] } = await db.query('select * from auth.users where email = lower($1)', [String(cuerpo.email || '').trim()]);
            if (!u || !claveValida(String(cuerpo.password || ''), u.password_hash)) return credencialesInvalidas();
            await db.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
            return responderJSON(res, req, 200, crearSesion(u));
        }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
            const payload = verificarJWT(cuerpo.refresh_token);
            if (!payload || payload.tipo !== 'refresh') return credencialesInvalidas();
            const { rows: [u] } = await db.query('select * from auth.users where id = $1', [payload.sub]);
            if (!u) return credencialesInvalidas();
            return responderJSON(res, req, 200, crearSesion(u));
        }
        return credencialesInvalidas();
    }

    // Alta de cuenta de cliente (en local, como un proyecto sin confirmación por correo)
    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
        const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
        const email = String(cuerpo.email || '').trim().toLowerCase();
        const clave = String(cuerpo.password || '');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responderJSON(res, req, 400, { code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' });
        if (clave.length < 6) return responderJSON(res, req, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters' });
        const { rows: [u] } = await db.query(`insert into auth.users (email, password_hash) values ($1, $2)
                                               on conflict (email) do nothing returning *`, [email, hashClave(clave)]);
        if (!u) return responderJSON(res, req, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        return responderJSON(res, req, 200, crearSesion(u));
    }

    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const payload = verificarJWT(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
        if (!payload || payload.role !== 'authenticated') return responderJSON(res, req, 401, { code: 401, msg: 'invalid JWT' });
        const { rows: [u] } = await db.query('select * from auth.users where id = $1', [payload.sub]);
        return u ? responderJSON(res, req, 200, usuarioPublico(u)) : responderJSON(res, req, 404, { code: 404, msg: 'User not found' });
    }

    // Cambio de contraseña de la sesión actual (supabase.auth.updateUser). El cambio de correo necesita
    // confirmación por correo: en local no se simula.
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
        const payload = verificarJWT(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
        if (!payload || payload.role !== 'authenticated') return responderJSON(res, req, 401, { code: 401, msg: 'invalid JWT' });
        const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
        if (cuerpo.email) return responderJSON(res, req, 501, { code: 501, error_code: 'not_implemented', msg: 'El cambio de correo requiere confirmación por correo: no disponible en local' });
        const clave = String(cuerpo.password || '');
        if (clave.length < 6) return responderJSON(res, req, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters' });
        const { rows: [u] } = await db.query('update auth.users set password_hash = $2 where id = $1 returning *', [payload.sub, hashClave(clave)]);
        return u ? responderJSON(res, req, 200, usuarioPublico(u)) : responderJSON(res, req, 404, { code: 404, msg: 'User not found' });
    }

    if (url.pathname.startsWith('/auth/v1/admin/users')) {
        const payload = verificarJWT(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
        if (payload?.role !== 'service_role') return responderJSON(res, req, 403, { code: 403, error_code: 'not_admin', msg: 'User not allowed' });
        if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
            const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
            const email = String(cuerpo.email || '').trim().toLowerCase();
            const clave = String(cuerpo.password || '');
            if (clave.length < 6) return responderJSON(res, req, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters' });
            const { rows: [u] } = await db.query(`insert into auth.users (email, password_hash, email_confirmed_at, raw_app_meta_data) values ($1, $2, case when $3 then now() end, $4::jsonb)
                                                   on conflict (email) do nothing returning *`, [email, hashClave(clave), Boolean(cuerpo.email_confirm), JSON.stringify(cuerpo.app_metadata || {})]);
            if (!u) return responderJSON(res, req, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
            return responderJSON(res, req, 200, usuarioPublico(u));
        }
        const id = url.pathname.split('/').pop();
        if (req.method === 'DELETE' && /^[0-9a-f-]{36}$/.test(id)) {
            await db.query('delete from auth.users where id = $1', [id]);
            return responderJSON(res, req, 200, {});
        }
        return responderJSON(res, req, 404, { code: 404, msg: 'No disponible en el entorno local' });
    }

    // Sin servidor de correo en local: se informa en vez de simular el envío
    if (url.pathname === '/auth/v1/recover') {
        return responderJSON(res, req, 501, { code: 501, error_code: 'not_implemented',
            msg: 'La recuperación por correo no está disponible en el entorno local. Usa: npm run local:usuario -- correo nuevaClave' });
    }

    if (url.pathname === '/auth/v1/logout') {
        res.writeHead(204, cabecerasCors(req));
        return res.end();
    }

    return responderJSON(res, req, 404, { code: 404, msg: 'No disponible en el entorno local' });
}

async function reenviarAPostgrest(req, res, url) {
    const cabeceras = {};
    for (const nombre of ['authorization', 'content-type', 'prefer', 'accept', 'range', 'accept-profile', 'content-profile']) {
        if (req.headers[nombre]) cabeceras[nombre] = req.headers[nombre];
    }
    const cuerpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await leerCuerpo(req);
    const destino = `http://127.0.0.1:${PUERTOS.postgrest}${url.pathname.replace(/^\/rest\/v1/, '') || '/'}${url.search}`;
    const respuesta = await fetch(destino, { method: req.method, headers: cabeceras, body: cuerpo });
    const salida = { ...cabecerasCors(req) };
    for (const nombre of ['content-type', 'content-range', 'preference-applied', 'location']) {
        const valor = respuesta.headers.get(nombre);
        if (valor) salida[nombre] = valor;
    }
    res.writeHead(respuesta.status, salida);
    res.end(Buffer.from(await respuesta.arrayBuffer()));
}

// /functions/v1/<nombre> -> Deno local. Sin Deno en marcha responde 404, como una función no desplegada.
async function reenviarAFunciones(req, res, url) {
    const cabeceras = {};
    for (const nombre of ['authorization', 'content-type', 'apikey', 'x-client-info']) {
        if (req.headers[nombre]) cabeceras[nombre] = req.headers[nombre];
    }
    let respuesta;
    try {
        respuesta = await fetch(`${FUNCIONES}${url.pathname.replace(/^\/functions\/v1/, '')}`, { method: req.method, headers: cabeceras,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : await leerCuerpo(req) });
    } catch {
        return responderJSON(res, req, 404, { code: 404, msg: 'Función no desplegada en local (npm run local:funciones)' });
    }
    res.writeHead(respuesta.status, { ...cabecerasCors(req), 'content-type': respuesta.headers.get('content-type') || 'application/json' });
    res.end(Buffer.from(await respuesta.arrayBuffer()));
}

function iniciarApi(db) {
    const servidor = http.createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, cabecerasCors(req));
                return res.end();
            }
            const url = new URL(req.url, `http://localhost:${PUERTOS.api}`);
            if (url.pathname.startsWith('/rest/v1')) return await reenviarAPostgrest(req, res, url);
            if (url.pathname.startsWith('/auth/v1')) return await manejarAuth(req, res, url, db);
            if (url.pathname.startsWith('/functions/v1/')) return await reenviarAFunciones(req, res, url);
            responderJSON(res, req, 404, { msg: 'Ruta no encontrada' });
        } catch (e) {
            console.error('[api]', e);
            if (!res.headersSent) responderJSON(res, req, 500, { msg: 'Error interno del entorno local' });
        }
    });
    // Todas las interfaces: permite probar desde un celular en la misma red local
    return new Promise(ok => servidor.listen(PUERTOS.api, '0.0.0.0', () => ok(servidor)));
}

// ==========================================
// WEB ESTÁTICA
// ==========================================
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};
const PUBLICOS = ['index.html', 'sw.js', 'manifest.webmanifest', 'assets', 'controllers', 'models', 'imagenes'];

function iniciarWeb() {
    const servidor = http.createServer((req, res) => {
        const ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const relativa = path.normalize(ruta === '/' ? 'index.html' : ruta.replace(/^\/+/, ''));
        const archivo = path.join(RAIZ, relativa);
        if (!PUBLICOS.some(p => relativa === p || relativa.startsWith(p + path.sep)) || !archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('No encontrado');
        }
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        if (relativa === path.join('assets', 'config.js') && PUERTOS.api !== 54321) {
            return res.end(fs.readFileSync(archivo, 'utf8').replace(/:54321\b/g, `:${PUERTOS.api}`));
        }
        fs.createReadStream(archivo).pipe(res);
    });
    return new Promise((ok, error) => {
        servidor.once('error', error);
        servidor.listen(PUERTOS.web, () => ok(servidor));
    });
}

function direccionesRed() {
    return Object.values(os.networkInterfaces()).flat()
        .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('172.'))
        .map(i => i.address);
}

// ==========================================
// ARRANQUE
// ==========================================
async function principal() {
    console.log('Iniciando entorno local de la barbería...');
    const configWeb = fs.readFileSync(path.join(RAIZ, 'assets', 'config.js'), 'utf8');
    if (!configWeb.includes(ANON_KEY)) {
        console.warn(`\n⚠️  assets/config.js no apunta al entorno local. Usa:\n  SUPABASE_URL = "http://localhost:${PUERTOS.api}"\n  SUPABASE_ANON_KEY = "${ANON_KEY}"\n`);
    }

    const { servidor: servidorPg, db, primeraVez } = await iniciarPostgres();
    console.log(`  PostgreSQL en el puerto ${PUERTOS.postgres}${primeraVez ? ' (base nueva)' : ''}`);
    let postgrest, api, web, funciones;
    try {
        await prepararEsquemaSupabase(db);
        await instalarBarberia(db);
        await asegurarAdmin(db);
        postgrest = await iniciarPostgrest();
        api = await iniciarApi(db);
        web = await iniciarWeb();
        if (process.env.BARBERIA_FUNCIONES_AUTO !== '0') try {
            await fetch(`${FUNCIONES}/barbero-cuenta`, { method: 'OPTIONS', signal: AbortSignal.timeout(1000) });
        } catch {
            funciones = spawn(process.execPath, [path.join(RAIZ, 'local', 'funciones-local.mjs')], { stdio: 'inherit', windowsHide: true });
            funciones.on('error', e => console.error('[funciones]', e.message));
        }
    } catch (e) {
        // Cierre ordenado: evita dejar PostgreSQL abierto o la base sin cerrar correctamente
        if (postgrest) postgrest.kill();
        if (api) api.close();
        await db.end().catch(() => {});
        await servidorPg.stop().catch(() => {});
        throw e;
    }

    const tareas = setInterval(() => {
        db.query('select barberia.procesar_tareas_programadas()').catch(e => console.error('[tareas]', e.message));
    }, 60 * 1000);

    console.log(`
Listo:
  Web:            http://localhost:${PUERTOS.web}
${direccionesRed().map(ip => `  En el celular:  http://${ip}:${PUERTOS.web}  (misma red Wi-Fi)
`).join('')}  API (Supabase): http://localhost:${PUERTOS.api}
  Admin:          ${ADMIN.email} / ${ADMIN.clave}
Ctrl+C para detener (los datos quedan en local/.datos-pg).`);

    let cerrando = false;
    const cerrar = async () => {
        if (cerrando) return;
        cerrando = true;
        console.log('\nDeteniendo...');
        clearInterval(tareas);
        if (funciones) {
            if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(funciones.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
            else funciones.kill();
        }
        web.close();
        api.close();
        postgrest.kill();
        await db.end().catch(() => {});
        await servidorPg.stop().catch(() => {});
        process.exit(0);
    };
    process.on('SIGINT', cerrar);
    process.on('SIGTERM', cerrar);
}

principal().catch(e => {
    console.error('\n❌', e.message);
    process.exit(1);
});
