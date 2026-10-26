-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema `barberia`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta 20261028000000_cuentas_permisos_notificaciones.sql).
-- Aplica solo estas migraciones nuevas, trasladadas a barberia:
--   20261029000000_acceso_barberos.sql
--   20261030000000_cuentas_barberos_seguras.sql
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
-- MIGRACIÓN (trasladada a barberia): 20261029000000_acceso_barberos.sql
-- #####################################################################
-- =====================================================================
-- ACCESO DE LOS BARBEROS: desactivar/reactivar y cambio de correo de acceso
--
-- Desactivar el acceso bloquea el rol barbero en el servidor (barbero_actual) sin borrar el
-- vínculo, las citas ni el historial; la cuenta de Auth sigue existiendo (si también es cliente,
-- conserva ese acceso). Reactivar lo devuelve tal cual.
-- Cambiar el correo de acceso = vincular otra cuenta al mismo perfil (nueva o existente, con
-- confirmación explícita) reemplazando la anterior en una sola transacción.
-- Queda registrado quién vinculó, desactivó o reactivó (sin contraseñas).
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;

alter table barberia.barbero_usuarios
    add column if not exists acceso_activo boolean not null default true,
    add column if not exists desactivado_por uuid,
    add column if not exists desactivado_en timestamptz,
    add column if not exists motivo_desactivacion text;

-- El rol barbero exige perfil activo y acceso activo
create or replace function barberia.barbero_actual() returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select bu.barbero_id from barbero_usuarios bu
      join barberos b on b.id::text = bu.barbero_id
     where bu.user_id = auth.uid() and b.activo is not false and bu.acceso_activo
$$;

-- Avisos de citas: a la cuenta con acceso activo; si no hay, a administración
create or replace function barberia_private._destinatarios_cita(p_barbero text) returns setof uuid
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    return query select bu.user_id from barbero_usuarios bu join barberos b on b.id::text = bu.barbero_id
                  where bu.barbero_id = p_barbero and b.activo is not false and bu.acceso_activo;
    if not found then
        return query select user_id from admin_usuarios;
    end if;
end;
$$;

-- Vinculación explícita cuenta-perfil (idempotente). p_datos:
--   { barbero_id, email, clave_temporal, confirmar_existente, permisos: ['cajero'], reemplazar }
-- reemplazar = el perfil ya tenía otra cuenta y se cambia el correo de acceso (la anterior se desvincula).
-- Una cuenta existente nunca se marca con contraseña temporal ni pierde sus roles.
create or replace function barberia.panel_cuenta_vincular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_barbero text := p_datos ->> 'barbero_id';
    v record;
    v_anterior uuid;
    v_nueva boolean;
    v_temporal boolean;
begin
    perform _exigir_panel(true);
    if not exists (select 1 from barberos where id::text = v_barbero) then
        raise exception 'barbero_no_encontrado';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('cuenta_barbero:' || v_barbero, 0));
    select id, created_at, last_sign_in_at into v from auth.users where lower(email) = lower(trim(p_datos ->> 'email'));
    if not found then
        raise exception 'usuario_no_encontrado';
    end if;
    if exists (select 1 from barbero_usuarios where user_id = v.id and barbero_id = v_barbero) then
        perform barberia_private._permisos_guardar(v.id, p_datos -> 'permisos');
        return jsonb_build_object('ok', true, 'repetida', true,
            'clave_temporal', (select debe_cambiar_clave from barbero_usuarios where user_id = v.id));
    end if;
    if exists (select 1 from barbero_usuarios where user_id = v.id) then
        raise exception 'cuenta_vinculada_otro';
    end if;
    select user_id into v_anterior from barbero_usuarios where barbero_id = v_barbero;
    if v_anterior is not null and not coalesce((p_datos ->> 'reemplazar')::boolean, false) then
        raise exception 'barbero_con_cuenta';
    end if;
    v_nueva := v.created_at > now() - interval '30 minutes' and v.last_sign_in_at is null;
    if not v_nueva and not coalesce((p_datos ->> 'confirmar_existente')::boolean, false) then
        raise exception 'cuenta_existente';
    end if;
    if v_anterior is not null then
        -- Cambio de correo de acceso: la cuenta anterior deja de ser barbero (no se borra de Auth)
        delete from barbero_usuarios where barbero_id = v_barbero;
        delete from barbero_permisos where user_id = v_anterior;
        if not exists (select 1 from admin_usuarios where user_id = v_anterior) then
            update push_suscripciones set activa = false, actualizado_en = now() where user_id = v_anterior;
        end if;
        perform _auditar('cuenta_reemplazada', 'barbero', v_barbero, jsonb_build_object('email_anterior', (select email from auth.users where id = v_anterior)));
    end if;
    v_temporal := v_nueva and coalesce((p_datos ->> 'clave_temporal')::boolean, false);
    insert into barbero_usuarios (user_id, barbero_id, debe_cambiar_clave, huella_clave, vinculado_por, vinculado_en)
    values (v.id, v_barbero, v_temporal, case when v_temporal then barberia_private._huella_clave(v.id) end, auth.uid(), now());
    perform barberia_private._permisos_guardar(v.id, p_datos -> 'permisos');
    update solicitudes_profesionales set estado = 'aprobada', barbero_id = v_barbero, resuelta_por = auth.uid(), resuelta_en = now()
     where user_id = v.id and estado = 'pendiente';
    perform _auditar('cuenta_vinculada', 'barbero', v_barbero, jsonb_build_object('email', lower(trim(p_datos ->> 'email')),
        'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal, 'permisos', coalesce(p_datos -> 'permisos', '[]'::jsonb)));
    return jsonb_build_object('ok', true, 'repetida', false, 'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal);
end;
$$;

-- Desactivar / reactivar el acceso profesional (conserva vínculo, citas e historial)
create or replace function barberia.panel_cuenta_acceso(p_barbero text, p_activo boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v barbero_usuarios;
begin
    perform _exigir_panel(true);
    select * into v from barbero_usuarios where barbero_id = p_barbero for update;
    if not found then
        raise exception 'barbero_sin_cuenta';
    end if;
    if v.acceso_activo = p_activo then
        return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    if not p_activo and coalesce(length(trim(p_motivo)), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    update barbero_usuarios set acceso_activo = p_activo,
           desactivado_por = case when p_activo then null else auth.uid() end,
           desactivado_en = case when p_activo then null else now() end,
           motivo_desactivacion = case when p_activo then null else left(trim(p_motivo), 300) end
     where barbero_id = p_barbero;
    -- Sin acceso no recibe avisos en sus dispositivos (salvo que también administre)
    if not p_activo and not exists (select 1 from admin_usuarios where user_id = v.user_id) then
        update push_suscripciones set activa = false, actualizado_en = now() where user_id = v.user_id;
    end if;
    perform _auditar(case when p_activo then 'acceso_reactivado' else 'acceso_desactivado' end, 'barbero', p_barbero,
                     jsonb_build_object('motivo', nullif(trim(p_motivo), '')));
    return jsonb_build_object('ok', true, 'repetida', false);
end;
$$;

create or replace function barberia.panel_cuentas_barberos() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('barbero_id', bu.barbero_id, 'email', u.email,
            'verificado', u.email_confirmed_at is not null, 'debe_cambiar_clave', bu.debe_cambiar_clave,
            'acceso_activo', bu.acceso_activo, 'desactivado_en', bu.desactivado_en, 'motivo_desactivacion', bu.motivo_desactivacion,
            'desactivado_por', (select email from auth.users where id = bu.desactivado_por),
            'ultimo_acceso', u.last_sign_in_at, 'vinculado_en', bu.vinculado_en,
            'vinculado_por', (select email from auth.users where id = bu.vinculado_por),
            'permisos', coalesce((select jsonb_agg(p.permiso) from barbero_permisos p where p.user_id = bu.user_id), '[]'::jsonb)))
        from barbero_usuarios bu join auth.users u on u.id = bu.user_id), '[]'::jsonb);
end;
$$;

do $$
declare
    v_fn regprocedure;
begin
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname in ('panel_cuenta_vincular', 'panel_cuenta_acceso', 'panel_cuentas_barberos') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;
revoke all on function barberia_private._destinatarios_cita(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261030000000_cuentas_barberos_seguras.sql
-- #####################################################################
-- Altas de cuentas identificadas por metadatos exclusivos del servidor.
create or replace function barberia.panel_cuenta_vincular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_barbero text := p_datos ->> 'barbero_id';
    v record;
    v_anterior uuid;
    v_nueva boolean;
    v_temporal boolean;
begin
    perform _exigir_panel(true);
    if not exists (select 1 from barberos where id::text = v_barbero) then
        raise exception 'barbero_no_encontrado';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('cuenta_barbero:' || v_barbero, 0));
    select id, created_at, last_sign_in_at, raw_app_meta_data into v from auth.users where lower(email) = lower(trim(p_datos ->> 'email'));
    if not found then
        raise exception 'usuario_no_encontrado';
    end if;
    if exists (select 1 from barbero_usuarios where user_id = v.id and barbero_id = v_barbero) then
        return jsonb_build_object('ok', true, 'repetida', true,
            'clave_temporal', (select debe_cambiar_clave from barbero_usuarios where user_id = v.id));
    end if;
    if exists (select 1 from barbero_usuarios where user_id = v.id) then
        raise exception 'cuenta_vinculada_otro';
    end if;
    select user_id into v_anterior from barbero_usuarios where barbero_id = v_barbero;
    if v_anterior is not null and not coalesce((p_datos ->> 'reemplazar')::boolean, false) then
        raise exception 'barbero_con_cuenta';
    end if;
    v_nueva := coalesce(v.raw_app_meta_data ->> 'barberia_alta_admin' = auth.uid()::text and v.raw_app_meta_data ->> 'barberia_alta_perfil' = v_barbero and v.last_sign_in_at is null, false);
    if not v_nueva and not coalesce((p_datos ->> 'confirmar_existente')::boolean, false) then
        raise exception 'cuenta_existente';
    end if;
    if v_anterior is not null then
        -- Cambio de correo de acceso: la cuenta anterior deja de ser barbero (no se borra de Auth)
        delete from barbero_usuarios where barbero_id = v_barbero;
        delete from barbero_permisos where user_id = v_anterior;
        if not exists (select 1 from admin_usuarios where user_id = v_anterior) then
            update push_suscripciones set activa = false, actualizado_en = now() where user_id = v_anterior;
        end if;
        perform _auditar('cuenta_reemplazada', 'barbero', v_barbero, jsonb_build_object('email_anterior', (select email from auth.users where id = v_anterior)));
    end if;
    v_temporal := v_nueva and coalesce((p_datos ->> 'clave_temporal')::boolean, false);
    insert into barbero_usuarios (user_id, barbero_id, debe_cambiar_clave, huella_clave, vinculado_por, vinculado_en)
    values (v.id, v_barbero, v_temporal, case when v_temporal then barberia_private._huella_clave(v.id) end, auth.uid(), now());
    perform barberia_private._permisos_guardar(v.id, p_datos -> 'permisos');
    update solicitudes_profesionales set estado = 'aprobada', barbero_id = v_barbero, resuelta_por = auth.uid(), resuelta_en = now()
     where user_id = v.id and estado = 'pendiente';
    perform _auditar('cuenta_vinculada', 'barbero', v_barbero, jsonb_build_object('email', lower(trim(p_datos ->> 'email')),
        'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal, 'permisos', coalesce(p_datos -> 'permisos', '[]'::jsonb)));
    return jsonb_build_object('ok', true, 'repetida', false, 'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal);
end;
$$;


create or replace function barberia.panel_cuenta_consultar(p_email text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v record;
begin
    perform _exigir_panel(true);
    select id, created_at, last_sign_in_at, email_confirmed_at, raw_app_meta_data into v from auth.users where lower(email) = lower(trim(p_email));
    if not found then
        return jsonb_build_object('existe', false);
    end if;
    return jsonb_build_object('existe', true, 'verificado', v.email_confirmed_at is not null,
        'reciente', false,
        'alta_panel', coalesce(v.raw_app_meta_data ->> 'barberia_alta_admin' = auth.uid()::text and v.last_sign_in_at is null, false),
        'alta_perfil', v.raw_app_meta_data ->> 'barberia_alta_perfil',
        'es_admin', exists (select 1 from admin_usuarios where user_id = v.id),
        'barbero', (select b.nombre from barbero_usuarios bu join barberos b on b.id::text = bu.barbero_id where bu.user_id = v.id));
end;
$$;

create or replace function barberia._clave_panel_lista() returns boolean
language sql stable security definer set search_path = barberia, pg_temp as $$
 select not exists (select 1 from barbero_usuarios where user_id = auth.uid() and debe_cambiar_clave)
$$;
revoke all on function barberia._clave_panel_lista() from public, anon;
grant execute on function barberia._clave_panel_lista() to authenticated;
drop policy if exists barbero_agenda on barberia.citas;
create policy barbero_agenda on barberia.citas for select to authenticated
using (barbero_id::text = (select barberia.barbero_actual()) and (select barberia._clave_panel_lista()));
notify pgrst, 'reload schema';

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
        if v_nombre = any (array['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita', 'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita', 'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta', 'aceptar_oferta', 'rechazar_oferta', 'mi_codigo_referido', 'darse_de_baja', 'catalogo_publico', 'barberos_publicos', 'negocio_publico', 'ubicacion_publica', 'horarios_dia_publico', 'mis_citas_por_tokens', 'portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas', 'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens']) then
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
