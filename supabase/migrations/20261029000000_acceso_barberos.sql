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

create schema if not exists private;
revoke all on schema private from public;

alter table public.barbero_usuarios
    add column if not exists acceso_activo boolean not null default true,
    add column if not exists desactivado_por uuid,
    add column if not exists desactivado_en timestamptz,
    add column if not exists motivo_desactivacion text;

-- El rol barbero exige perfil activo y acceso activo
create or replace function public.barbero_actual() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select bu.barbero_id from barbero_usuarios bu
      join barberos b on b.id::text = bu.barbero_id
     where bu.user_id = auth.uid() and b.activo is not false and bu.acceso_activo
$$;

-- Avisos de citas: a la cuenta con acceso activo; si no hay, a administración
create or replace function private._destinatarios_cita(p_barbero text) returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.panel_cuenta_vincular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
        perform private._permisos_guardar(v.id, p_datos -> 'permisos');
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
    values (v.id, v_barbero, v_temporal, case when v_temporal then private._huella_clave(v.id) end, auth.uid(), now());
    perform private._permisos_guardar(v.id, p_datos -> 'permisos');
    update solicitudes_profesionales set estado = 'aprobada', barbero_id = v_barbero, resuelta_por = auth.uid(), resuelta_en = now()
     where user_id = v.id and estado = 'pendiente';
    perform _auditar('cuenta_vinculada', 'barbero', v_barbero, jsonb_build_object('email', lower(trim(p_datos ->> 'email')),
        'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal, 'permisos', coalesce(p_datos -> 'permisos', '[]'::jsonb)));
    return jsonb_build_object('ok', true, 'repetida', false, 'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal);
end;
$$;

-- Desactivar / reactivar el acceso profesional (conserva vínculo, citas e historial)
create or replace function public.panel_cuenta_acceso(p_barbero text, p_activo boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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

create or replace function public.panel_cuentas_barberos() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
                 where n.nspname = 'public' and p.proname in ('panel_cuenta_vincular', 'panel_cuenta_acceso', 'panel_cuentas_barberos') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;
revoke all on function private._destinatarios_cita(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
