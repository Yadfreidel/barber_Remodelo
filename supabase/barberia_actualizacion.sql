-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema `barberia`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta 20261101000000_avisos_reservas.sql).
-- Aplica solo estas migraciones nuevas, trasladadas a barberia:
--   20261102000000_identidad_negocio.sql
-- y vuelve a aplicar los permisos mínimos. No toca `public`, `private` ni Auth.
-- Conserva todas las citas. Una sola transacción: si algo falla, no cambia nada.
-- Es seguro ejecutarlo más de una vez. Una instalación nueva usa base_completa.sql.
-- =====================================================================

begin;

create schema if not exists barberia;
create schema if not exists barberia_private;
revoke all on schema barberia from public;
revoke all on schema barberia_private from public;
grant usage on schema barberia to anon, authenticated, service_role;

-- Objetos sin esquema dentro de este script se crean y resuelven en barberia
set local search_path = barberia, pg_temp;

-- Las funciones nuevas de este esquema no quedan ejecutables por PUBLIC
alter default privileges in schema barberia revoke execute on functions from public;
alter default privileges in schema barberia_private revoke execute on functions from public;

do $$
begin
    if to_regclass('barberia.citas') is null then
        raise exception 'Barbería no está instalada en barberia: ejecuta primero supabase/base_completa.sql';
    end if;
end $$;

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261102000000_identidad_negocio.sql
-- #####################################################################
-- =====================================================================
-- IDENTIDAD DEL NEGOCIO: COLORES, CORREO DE CONTACTO Y POLÍTICAS INFORMATIVAS
--
-- La configuración sigue guardándose en negocio_config.datos (jsonb, una sola fila: instalación
-- de un solo negocio). Esta migración solo amplía la validación del servidor al publicar:
--   - color_principal y color_acento: '' (valor por defecto del sitio) o '#rrggbb' con contraste
--     mínimo de 4.5:1 sobre el fondo oscuro de la web (#0b0b0c), que también es el color del texto
--     de los botones rellenos con ese color;
--   - correo: '' o una dirección de correo de hasta 120 caracteres;
--   - politica_reservas y politica_cancelacion: texto informativo de hasta 1200 caracteres.
--     Se muestran como texto plano; no crean reglas de cancelación, cobros ni penalizaciones.
-- Solo administradores (_exigir_panel(true)). ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

-- Luminancia relativa WCAG de un color '#rrggbb' (null si el formato no es válido)
create or replace function barberia._luminancia(p_color text) returns numeric
language plpgsql immutable set search_path = barberia, pg_temp as $$
declare
    v_canal numeric;
    v_lum numeric := 0;
    v_pesos numeric[] := array[0.2126, 0.7152, 0.0722];
    i int;
begin
    if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then
        return null;
    end if;
    for i in 1..3 loop
        v_canal := ('x' || lpad(substr(p_color, 2 * i, 2), 8, '0'))::bit(32)::int / 255.0;
        v_lum := v_lum + v_pesos[i] * case when v_canal <= 0.03928 then v_canal / 12.92 else power((v_canal + 0.055) / 1.055, 2.4) end;
    end loop;
    return v_lum;
end;
$$;

-- Contraste WCAG de un color frente al fondo oscuro de la web (#0b0b0c)
create or replace function barberia._contraste_sobre_fondo(p_color text) returns numeric
language sql immutable set search_path = barberia, pg_temp as $$
    select round((greatest(_luminancia(p_color), _luminancia('#0b0b0c')) + 0.05)
               / (least(_luminancia(p_color), _luminancia('#0b0b0c')) + 0.05), 2)
$$;

create or replace function barberia.panel_guardar_negocio(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_red text;
    v_item jsonb;
    v_linea text;
    v_color text;
begin
    perform _exigir_panel(true);
    if length(coalesce(p_datos ->> 'nombre', '')) > 80 or length(coalesce(p_datos ->> 'descripcion', '')) > 300
       or not _imagen_valida(p_datos ->> 'logo_url') or not _imagen_valida(p_datos ->> 'portada_url')
       or (nullif(p_datos ->> 'whatsapp', '') is not null and length(normalizar_telefono(p_datos ->> 'whatsapp')) not between 10 and 15)
       or (nullif(p_datos ->> 'telefono', '') is not null and length(normalizar_telefono(p_datos ->> 'telefono')) not between 7 and 15) then
        raise exception 'negocio_invalido';
    end if;
    for v_red in select jsonb_object_keys(coalesce(p_datos -> 'redes', '{}'::jsonb)) loop
        if v_red not in ('instagram', 'facebook', 'tiktok', 'youtube')
           or (nullif(p_datos -> 'redes' ->> v_red, '') is not null
               and (p_datos -> 'redes' ->> v_red !~ '^https://[^\s"''<>]+$' or length(p_datos -> 'redes' ->> v_red) > 200)) then
            raise exception 'negocio_invalido: redes';
        end if;
    end loop;
    if jsonb_array_length(coalesce(p_datos -> 'faq', '[]'::jsonb)) > 20 then raise exception 'negocio_invalido: faq'; end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_datos -> 'faq', '[]'::jsonb)) loop
        if length(coalesce(v_item ->> 'pregunta', '')) not between 1 and 160 or length(coalesce(v_item ->> 'respuesta', '')) not between 1 and 600 then
            raise exception 'negocio_invalido: faq';
        end if;
    end loop;
    if jsonb_array_length(coalesce(p_datos -> 'horarios_publicos', '[]'::jsonb)) > 10 then raise exception 'negocio_invalido: horarios'; end if;
    for v_linea in select jsonb_array_elements_text(coalesce(p_datos -> 'horarios_publicos', '[]'::jsonb)) loop
        if length(v_linea) > 80 then raise exception 'negocio_invalido: horarios'; end if;
    end loop;

    -- Identidad: colores legibles sobre el fondo de la web
    foreach v_color in array array[coalesce(p_datos ->> 'color_principal', ''), coalesce(p_datos ->> 'color_acento', '')] loop
        if v_color <> '' and (v_color !~ '^#[0-9a-fA-F]{6}$' or _contraste_sobre_fondo(v_color) < 4.5) then
            raise exception 'negocio_invalido: color';
        end if;
    end loop;
    if nullif(p_datos ->> 'correo', '') is not null
       and (length(p_datos ->> 'correo') > 120 or p_datos ->> 'correo' !~ '^[^\s@<>"'']+@[^\s@<>"'']+\.[^\s@<>"'']+$') then
        raise exception 'negocio_invalido: correo';
    end if;
    if length(coalesce(p_datos ->> 'politica_reservas', '')) > 1200 or length(coalesce(p_datos ->> 'politica_cancelacion', '')) > 1200 then
        raise exception 'negocio_invalido: politicas';
    end if;

    insert into negocio_config (id, datos, actualizado_en, actualizado_por) values (true, p_datos, now(), auth.uid())
    on conflict (id) do update set datos = excluded.datos, actualizado_en = now(), actualizado_por = auth.uid();
    perform _auditar('negocio_publicado', 'configuracion', 'negocio', p_datos - 'logo_url' - 'portada_url');
    return negocio_publico();
end;
$$;

revoke all on function barberia._luminancia(text) from public, anon, authenticated;
revoke all on function barberia._contraste_sobre_fondo(text) from public, anon, authenticated;

-- #####################################################################
-- PERMISOS MÍNIMOS DE BARBERIA
-- La web pública reserva y consulta solo con funciones (SECURITY DEFINER con
-- search_path fijo); no necesita escribir tablas ni leer citas.
-- #####################################################################
-- El alta automática de barberos/servicios desde la web ya no se usa (los gestiona el panel)
drop policy if exists web_alta on barberia.barberos;
drop policy if exists web_alta on barberia.servicios;
revoke insert, update, delete, truncate, references, trigger on barberia.barberos from anon, authenticated;
revoke insert, delete, truncate, references, trigger on barberia.servicios from anon, authenticated;
revoke update on barberia.servicios from anon;
-- Citas: datos personales. Reservas por reservar_cita(); el panel usa panel_*()
drop policy if exists web_reserva on barberia.citas;
revoke all on barberia.citas from anon;
revoke insert, delete, truncate, references, trigger on barberia.citas from authenticated;

-- RLS en todas las tablas del esquema
do $$
declare
    v_tabla text;
begin
    for v_tabla in select tablename from pg_tables where schemaname = 'barberia' loop
        execute format('alter table barberia.%I enable row level security', v_tabla);
    end loop;
end $$;

-- EXECUTE solo para los roles que lo necesitan
do $$
declare
    v_fn regprocedure;
    v_nombre text;
begin
    for v_fn, v_nombre in select p.oid::regprocedure, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname in ('barberia', 'barberia_private') loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
        if v_nombre = any (array['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita', 'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita', 'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta', 'aceptar_oferta', 'rechazar_oferta', 'mi_codigo_referido', 'darse_de_baja', 'catalogo_publico', 'barberos_publicos', 'negocio_publico', 'ubicacion_publica', 'horarios_dia_publico', 'mis_citas_por_tokens', 'portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas', 'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens', 'cita_avisos_whatsapp', 'cita_notas_cliente']) then
            execute format('grant execute on function %s to anon, authenticated', v_fn);
        elsif v_nombre = any (array['_clave_panel_lista', 'es_admin', 'rol_panel', 'barbero_actual', 'mis_citas', 'vincular_citas', 'mis_reclamaciones', 'solicitud_profesional_estado', 'solicitud_profesional_crear', 'push_suscribir', 'push_desuscribir']) or v_nombre like 'panel\_%' or v_nombre like 'admin\_%' then
            execute format('grant execute on function %s to authenticated', v_fn);
        elsif v_nombre = any (array['push_reclamar', 'push_resultado', 'programar_recordatorios', 'programar_recuperacion', 'procesar_tareas_programadas', 'whatsapp_reclamar', 'whatsapp_resultado', 'whatsapp_procesar_evento']) then
            execute format('grant execute on function %s to service_role', v_fn);
        end if;
    end loop;
end $$;

-- service_role (solo servidor: Edge Functions y tareas programadas)
grant select, insert, update, delete on all tables in schema barberia to service_role;
grant usage, select on all sequences in schema barberia to service_role;

-- #####################################################################
-- CONFIGURACIÓN DE ESTE PROYECTO
-- #####################################################################
-- URL pública de la web (enlaces de "Gestionar mi cita" en WhatsApp)
update barberia.modulos_config
   set ajustes = ajustes || jsonb_build_object('url_publica', 'https://yadfreidel.github.io/barberia-master/')
 where modulo = 'general';

-- ADMINISTRADOR: solo en barberia.admin_usuarios (independiente de otras aplicaciones).
-- Requiere el usuario en Authentication > Users; si aún no existe no hace nada.
insert into barberia.admin_usuarios (user_id)
select id from auth.users where lower(email) = lower('yafre2310@gmail.com')
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

commit;

select 'Actualizado: ' || (select count(*) from barberia.citas) || ' citas conservadas; horario '
       || (select (ajustes ->> 'hora_apertura') || '–' || (ajustes ->> 'hora_cierre') || ' cada ' || (ajustes ->> 'intervalo_minutos') || ' min'
             from barberia.modulos_config where modulo = 'general') as estado_actualizacion;
