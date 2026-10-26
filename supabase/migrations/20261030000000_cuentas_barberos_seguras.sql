-- Altas de cuentas identificadas por metadatos exclusivos del servidor.
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
    values (v.id, v_barbero, v_temporal, case when v_temporal then private._huella_clave(v.id) end, auth.uid(), now());
    perform private._permisos_guardar(v.id, p_datos -> 'permisos');
    update solicitudes_profesionales set estado = 'aprobada', barbero_id = v_barbero, resuelta_por = auth.uid(), resuelta_en = now()
     where user_id = v.id and estado = 'pendiente';
    perform _auditar('cuenta_vinculada', 'barbero', v_barbero, jsonb_build_object('email', lower(trim(p_datos ->> 'email')),
        'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal, 'permisos', coalesce(p_datos -> 'permisos', '[]'::jsonb)));
    return jsonb_build_object('ok', true, 'repetida', false, 'cuenta_nueva', v_nueva, 'clave_temporal', v_temporal);
end;
$$;


create or replace function public.panel_cuenta_consultar(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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

create or replace function public._clave_panel_lista() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select not exists (select 1 from barbero_usuarios where user_id = auth.uid() and debe_cambiar_clave)
$$;
revoke all on function public._clave_panel_lista() from public, anon;
grant execute on function public._clave_panel_lista() to authenticated;
drop policy if exists barbero_agenda on public.citas;
create policy barbero_agenda on public.citas for select to authenticated
using (barbero_id::text = (select public.barbero_actual()) and (select public._clave_panel_lista()));
notify pgrst, 'reload schema';
