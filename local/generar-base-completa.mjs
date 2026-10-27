// Genera supabase/base_completa.sql: instalación COMPLETA de barbería en el esquema `barberia`
// (para compartir el proyecto de Supabase con otras aplicaciones que usan `public`).
// Toma las migraciones históricas de supabase/migrations (escritas para `public`) y las
// traslada a `barberia` / `barberia_private` con reglas precisas y verificadas.
// Uso: npm run base:completa
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(RAIZ, 'supabase', 'migrations');
const SALIDA = path.join(RAIZ, 'supabase', 'base_completa.sql');
// Actualización para un proyecto que ya ejecutó base_completa.sql hasta INSTALADO_HASTA (incluida)
const SALIDA_ACTUALIZACION = path.join(RAIZ, 'supabase', 'barberia_actualizacion.sql');
const INSTALADO_HASTA = '20261030000000_cuentas_barberos_seguras.sql';
const ESQUEMA = 'barberia';
const PRIVADO = 'barberia_private';
const URL_PUBLICA = 'https://yadfreidel.github.io/barberia-master/';
const ADMIN = 'yafre2310@gmail.com';

// Funciones que puede ejecutar cada rol (el resto queda interno: solo las usan otras funciones)
const FUNCIONES_PUBLICAS = ['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita',
    'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita',
    'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta', 'aceptar_oferta', 'rechazar_oferta',
    'mi_codigo_referido', 'darse_de_baja', 'catalogo_publico', 'barberos_publicos', 'negocio_publico', 'ubicacion_publica',
    'horarios_dia_publico', 'mis_citas_por_tokens', 'portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas',
    'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens'];
const FUNCIONES_SESION = ['_clave_panel_lista', 'es_admin', 'rol_panel', 'barbero_actual', 'mis_citas', 'vincular_citas', 'mis_reclamaciones',
    'solicitud_profesional_estado', 'solicitud_profesional_crear', 'push_suscribir', 'push_desuscribir']; // + todas las panel_* y admin_*
const FUNCIONES_SERVIDOR = ['push_reclamar', 'push_resultado', 'programar_recordatorios', 'programar_recuperacion', 'procesar_tareas_programadas',
    'whatsapp_reclamar', 'whatsapp_resultado', 'whatsapp_procesar_evento'];

function fallar(mensaje) {
    throw new Error(`generar-base-completa: ${mensaje}`);
}

function contar(texto, re) {
    return (texto.match(re) || []).length;
}

// Traslada una migración de `public` a `barberia`. No toca el rol PUBLIC (GRANT/REVOKE ... public).
export function trasladar(sql, archivo) {
    let s = sql.replace(/\r\n/g, '\n');
    const rolPublic = contar(s, /\b(from|to)\s+public\b(?!\.)/gi);

    // Esquema privado propio (no se modifica `private`)
    s = s.replace(/create schema if not exists private;/g, `create schema if not exists ${PRIVADO};`)
         .replace(/\bon schema private\b/g, `on schema ${PRIVADO}`)
         .replace(/(?<![\w])private\./g, `${PRIVADO}.`);

    // search_path de funciones
    s = s.replace(/set search_path = public, pg_temp/g, `set search_path = ${ESQUEMA}, pg_temp`);

    // Literales de esquema en consultas de catálogo (pg_namespace, information_schema)
    s = s.replace(/(nspname|table_schema)(\s*=\s*)'public'/g, `$1$2'${ESQUEMA}'`);
    if (/'public'/.test(s)) fallar(`${archivo}: literal 'public' en un contexto no previsto`);

    // Objetos calificados (también dentro de cadenas: 'public.citas'::regclass, format('... public.%I'))
    s = s.replace(/\bpublic\./g, `${ESQUEMA}.`);

    // Tipos de fila en firmas
    s = s.replace(/\((c|v_cita) citas\)/g, `($1 ${ESQUEMA}.citas)`);

    // Funciones sin search_path fijo: se fija para no depender del search_path de quien las llama
    s = s.replace(/(create or replace function [\s\S]*?)(\bas \$\$)/g, (m, cabecera, as) =>
        /search_path/.test(cabecera) ? m : `${cabecera}set search_path = ${ESQUEMA}, pg_temp ${as}`);

    if (/\bpublic\./.test(s)) fallar(`${archivo}: quedó una referencia public.`);
    if (/(?<![\w])private\b/.test(s.replace(new RegExp(PRIVADO, 'g'), ''))) fallar(`${archivo}: quedó una referencia a private`);
    if (contar(s, /\b(from|to)\s+public\b(?!\.)/gi) !== rolPublic) fallar(`${archivo}: cambió un uso del rol PUBLIC`);
    for (const [, cabecera] of s.matchAll(/(create or replace function [\s\S]*?)\bas \$\$/g)) {
        if (!/search_path/.test(cabecera)) fallar(`${archivo}: función sin search_path: ${cabecera.slice(0, 80)}`);
    }
    return s;
}

function lista(nombres) {
    return `array[${nombres.map(n => `'${n}'`).join(', ')}]`;
}

function bloqueMigraciones(archivos) {
    return archivos.map(f => {
        const sql = trasladar(fs.readFileSync(path.join(DIR, f), 'utf8'), f).trim();
        return `\n-- #####################################################################\n-- MIGRACIÓN (trasladada a ${ESQUEMA}): ${f}\n-- #####################################################################\n${sql}\n`;
    }).join('');
}

const INICIO = `begin;

create schema if not exists ${ESQUEMA};
create schema if not exists ${PRIVADO};
revoke all on schema ${ESQUEMA} from public;
revoke all on schema ${PRIVADO} from public;
grant usage on schema ${ESQUEMA} to anon, authenticated, service_role;

-- Objetos sin esquema dentro de este script se crean y resuelven en ${ESQUEMA}
set local search_path = ${ESQUEMA}, pg_temp;

-- Las funciones nuevas de este esquema no quedan ejecutables por PUBLIC
alter default privileges in schema ${ESQUEMA} revoke execute on functions from public;
alter default privileges in schema ${PRIVADO} revoke execute on functions from public;
`;

export function generar() {
    const archivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
    if (!archivos.includes(INSTALADO_HASTA)) fallar(`no existe la migración ${INSTALADO_HASTA}`);
    const nuevas = archivos.filter(f => f > INSTALADO_HASTA);

    const contenido = `-- =====================================================================
-- INSTALACIÓN COMPLETA DE BARBERÍA EN EL ESQUEMA \`${ESQUEMA}\`
-- (generado con: npm run base:completa — no editar a mano)
--
-- Pensado para un proyecto de Supabase COMPARTIDO: no crea ni modifica nada en
-- \`public\` (p. ej. las tablas players y matches de dominó), ni en \`private\`,
-- ni en Auth. Solo lee auth.users para el alta del administrador.
--
-- Contiene, trasladadas a ${ESQUEMA} / ${PRIVADO}, estas migraciones:
${archivos.map(f => `--   ${f}`).join('\n')}
--
-- CÓMO USARLO:
--   1. Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--      Se ejecuta en una transacción: si algo falla no queda nada a medias.
--   2. Project Settings > Data API > Exposed schemas: AÑADE "${ESQUEMA}" (sin quitar public
--      ni los demás). No expongas "${PRIVADO}".
--   3. Authentication > Users > Add user: crea ${ADMIN} (si aún no existe) y vuelve a
--      ejecutar el bloque "ADMINISTRADOR" del final.
--   4. Comprueba con supabase/barberia_verificacion.sql.
-- Es seguro ejecutarlo más de una vez.
-- =====================================================================

${INICIO}${bloqueMigraciones(archivos)}${FINAL}
select case when exists (select 1 from ${ESQUEMA}.admin_usuarios a join auth.users u on u.id = a.user_id
                          where lower(u.email) = lower('${ADMIN}'))
            then 'Instalado en ${ESQUEMA}. Listo: ${ADMIN} es administrador de barbería.'
            else 'Instalado en ${ESQUEMA}. Falta: crea ${ADMIN} en Authentication > Users y vuelve a ejecutar el bloque ADMINISTRADOR.'
       end as estado_instalacion;
`;
    const actualizacion = `-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema \`${ESQUEMA}\`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta ${INSTALADO_HASTA}).
-- Aplica solo estas migraciones nuevas, trasladadas a ${ESQUEMA}:
${nuevas.map(f => `--   ${f}`).join('\n') || '--   (ninguna)'}
-- y vuelve a aplicar los permisos mínimos. No toca \`public\`, \`private\` ni Auth.
-- Conserva todas las citas. Una sola transacción: si algo falla, no cambia nada.
-- Es seguro ejecutarlo más de una vez. Una instalación nueva usa base_completa.sql.
-- =====================================================================

${INICIO}
do $$
begin
    if to_regclass('${ESQUEMA}.citas') is null then
        raise exception 'Barbería no está instalada en ${ESQUEMA}: ejecuta primero supabase/base_completa.sql';
    end if;
end $$;
${bloqueMigraciones(nuevas)}${FINAL}
select 'Actualizado: ' || (select count(*) from ${ESQUEMA}.citas) || ' citas conservadas; horario '
       || (select (ajustes ->> 'hora_apertura') || '–' || (ajustes ->> 'hora_cierre') || ' cada ' || (ajustes ->> 'intervalo_minutos') || ' min'
             from ${ESQUEMA}.modulos_config where modulo = 'general') as estado_actualizacion;
`;
    for (const [nombre, texto] of [['base_completa', contenido], ['actualización', actualizacion]]) {
        if (/\bpublic\./.test(texto)) fallar(`${nombre}: la salida contiene public.`);
    }
    fs.writeFileSync(SALIDA, contenido);
    fs.writeFileSync(SALIDA_ACTUALIZACION, actualizacion);
    return { archivos, nuevas, kb: Math.round(fs.statSync(SALIDA).size / 1024) };
}

// Permisos mínimos y configuración: comunes a la instalación y a la actualización
const FINAL = `
-- #####################################################################
-- PERMISOS MÍNIMOS DE ${ESQUEMA.toUpperCase()}
-- La web pública reserva y consulta solo con funciones (SECURITY DEFINER con
-- search_path fijo); no necesita escribir tablas ni leer citas.
-- #####################################################################
-- El alta automática de barberos/servicios desde la web ya no se usa (los gestiona el panel)
drop policy if exists web_alta on ${ESQUEMA}.barberos;
drop policy if exists web_alta on ${ESQUEMA}.servicios;
revoke insert, update, delete, truncate, references, trigger on ${ESQUEMA}.barberos from anon, authenticated;
revoke insert, delete, truncate, references, trigger on ${ESQUEMA}.servicios from anon, authenticated;
revoke update on ${ESQUEMA}.servicios from anon;
-- Citas: datos personales. Reservas por reservar_cita(); el panel usa panel_*()
drop policy if exists web_reserva on ${ESQUEMA}.citas;
revoke all on ${ESQUEMA}.citas from anon;
revoke insert, delete, truncate, references, trigger on ${ESQUEMA}.citas from authenticated;

-- RLS en todas las tablas del esquema
do $$
declare
    v_tabla text;
begin
    for v_tabla in select tablename from pg_tables where schemaname = '${ESQUEMA}' loop
        execute format('alter table ${ESQUEMA}.%I enable row level security', v_tabla);
    end loop;
end $$;

-- EXECUTE solo para los roles que lo necesitan
do $$
declare
    v_fn regprocedure;
    v_nombre text;
begin
    for v_fn, v_nombre in select p.oid::regprocedure, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname in ('${ESQUEMA}', '${PRIVADO}') loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
        if v_nombre = any (${lista(FUNCIONES_PUBLICAS)}) then
            execute format('grant execute on function %s to anon, authenticated', v_fn);
        elsif v_nombre = any (${lista(FUNCIONES_SESION)}) or v_nombre like 'panel\\_%' or v_nombre like 'admin\\_%' then
            execute format('grant execute on function %s to authenticated', v_fn);
        elsif v_nombre = any (${lista(FUNCIONES_SERVIDOR)}) then
            execute format('grant execute on function %s to service_role', v_fn);
        end if;
    end loop;
end $$;

-- service_role (solo servidor: Edge Functions y tareas programadas)
grant select, insert, update, delete on all tables in schema ${ESQUEMA} to service_role;
grant usage, select on all sequences in schema ${ESQUEMA} to service_role;

-- #####################################################################
-- CONFIGURACIÓN DE ESTE PROYECTO
-- #####################################################################
-- URL pública de la web (enlaces de "Gestionar mi cita" en WhatsApp)
update ${ESQUEMA}.modulos_config
   set ajustes = ajustes || jsonb_build_object('url_publica', '${URL_PUBLICA}')
 where modulo = 'general';

-- ADMINISTRADOR: solo en ${ESQUEMA}.admin_usuarios (independiente de otras aplicaciones).
-- Requiere el usuario en Authentication > Users; si aún no existe no hace nada.
insert into ${ESQUEMA}.admin_usuarios (user_id)
select id from auth.users where lower(email) = lower('${ADMIN}')
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

commit;
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { archivos, nuevas, kb } = generar();
    console.log(`Generado ${path.relative(RAIZ, SALIDA)} (esquema ${ESQUEMA}, ${archivos.length} migraciones, ${kb} KB)`);
    console.log(`Generado ${path.relative(RAIZ, SALIDA_ACTUALIZACION)} (${nuevas.length} migraciones nuevas)`);
}
