import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACIONES = fs.readdirSync(path.join(raiz, 'migrations')).filter(f => f.endsWith('.sql')).sort()
    .map(f => path.join(raiz, 'migrations', f));
const BASE = path.join(raiz, 'tests', 'fixtures', 'base_supabase.sql');

export async function iniciarBase(puerto) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barberia-pg-'));
    const servidor = new EmbeddedPostgres({ databaseDir: dir, port: puerto, user: 'postgres', password: 'postgres', persistent: false, onLog: () => {} });
    await servidor.initialise();
    await servidor.start();
    const config = { host: 'localhost', port: puerto, user: 'postgres', password: 'postgres', database: 'postgres' };

    const admin = new pg.Client(config);
    await admin.connect();
    await admin.query(fs.readFileSync(BASE, 'utf8'));

    const abiertas = [admin];
    const db = {
        admin,
        async migrar() {
            for (const archivo of MIGRACIONES) await admin.query(fs.readFileSync(archivo, 'utf8'));
        },
        // Conexión independiente con un rol de Supabase (para concurrencia real)
        async conexion(rol = 'anon', usuario = null) {
            const c = new pg.Client(config);
            await c.connect();
            abiertas.push(c);
            if (usuario) await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario]);
            await c.query(`set role ${rol}`);
            return c;
        },
        async cerrar() {
            for (const c of abiertas) await c.end().catch(() => {});
            await servidor.stop();
        }
    };
    return db;
}

export async function rpc(cliente, fn, ...args) {
    const marcas = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await cliente.query(`select public.${fn}(${marcas}) as r`, args);
    return rows[0].r;
}

export async function errorDe(promesa) {
    try {
        await promesa;
    } catch (e) {
        return e.message;
    }
    return null;
}

export async function fechaLocal(cliente, dias) {
    const { rows } = await cliente.query(`select (public._ahora_local()::date + $1::int)::text as f`, [dias]);
    return rows[0].f;
}
