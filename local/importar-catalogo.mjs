// Importacion repetible SOLO al PostgreSQL local del proyecto, sin crear citas.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivo = fs.readdirSync(path.join(raiz,'supabase','migrations')).find(f=>f.endsWith('_catalogo_25_cortes.sql'));
const db = new pg.Client({host:'127.0.0.1',port:54322,user:'postgres',password:process.env.BARBER_LOCAL_PASSWORD || 'postgres-local',database:'postgres'});
try {
    await db.connect();
    await db.query('begin');
    await db.query('lock table servicios, citas in share row exclusive mode');
    const anteriores = async () => (await db.query(`select
        (select coalesce(jsonb_agg(to_jsonb(s)-'catalogo_id' order by s.id),'[]'::jsonb) from servicios s where to_jsonb(s)->>'catalogo_id' is null) servicios,
        (select coalesce(jsonb_agg(to_jsonb(c)-'duracion_reservada' order by c.id),'[]'::jsonb) from citas c) citas`)).rows[0];
    const antes=await anteriores();
    await db.query(fs.readFileSync(path.join(raiz,'supabase','migrations',archivo),'utf8'));
    const despues=await anteriores();
    if(JSON.stringify(antes)!==JSON.stringify(despues))throw new Error('La verificacion detecto cambios en servicios o citas anteriores');
    const {rows:[registro]}=await db.query("select to_regclass('public.migraciones_locales') as tabla");
    if(registro.tabla)await db.query('insert into migraciones_locales(archivo) values($1) on conflict do nothing',[archivo]);
    const {rows:[resumen]}=await db.query('select count(*)::int cantidad,min(precio)::int precio_min,max(precio)::int precio_max,min(duracion_minutos)::int duracion_min,max(duracion_minutos)::int duracion_max from servicios where catalogo_id is not null');
    if(resumen.cantidad!==25)throw new Error('El catalogo no tiene exactamente 25 cortes');
    await db.query("notify pgrst, 'reload schema'");
    await db.query('commit');
    console.log('Catalogo importado en localhost. Servicios anteriores y citas sin cambios.', resumen);
} catch(error) {
    await db.query('rollback').catch(()=>{});
    console.error('No se aplico la importacion:',error.message);
    process.exitCode=1;
} finally {await db.end().catch(()=>{});}
