-- =====================================================================
-- AVISOS DE NUEVAS RESERVAS AL BARBERO (app abierta y push)
--
-- Reutiliza las notificaciones internas (una por evento y destinatario, generadas por el disparador
-- al guardar la cita) y la cola push_envios. Cambios:
--   - el aviso se titula «Nueva reserva», incluye el estado y lleva el id de la cita para abrir su detalle;
--   - el push dice solo «Nueva reserva. Toca para ver los detalles.» y abre esa cita en la app;
--   - estado real de la suscripción de cada dispositivo y notificación de prueba;
--   - un dispositivo que pasa a otra cuenta deja de recibir avisos de la anterior.
-- La reserva nunca depende del aviso. ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.tg_citas_notificar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_servicio text;
    v_detalle text;
    v_datos jsonb;
    v_user uuid;
begin
    begin
        select nombre into v_servicio from servicios where id = new.servicio_id;
        v_detalle := new.nombre_cliente || ' · ' || coalesce(v_servicio, 'Servicio') || ' · ' || to_char(new.fecha, 'DD/MM/YYYY') || ' ' || to_char(new.hora, 'HH24:MI');
        v_datos := jsonb_build_object('seccion', 'agenda', 'fecha', new.fecha, 'hora', to_char(new.hora, 'HH24:MI'), 'cita', new.id::text, 'estado', new.estado);
        if tg_op = 'INSERT' then
            if new.estado <> 'cancelada' then
                for v_user in select * from private._destinatarios_cita(new.barbero_id::text) loop
                    perform private._notificar(v_user, 'cita:' || new.id || ':nueva', 'cita_nueva', 'Nueva reserva',
                                               v_detalle || ' · ' || case new.estado when 'confirmada' then 'Confirmada' else 'Pendiente de confirmar' end, new.id::text, v_datos);
                end loop;
            end if;
        elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then
            for v_user in select * from private._destinatarios_cita(new.barbero_id::text) loop
                perform private._notificar(v_user, 'cita:' || new.id || ':cancelada:' || coalesce(new.cancelada_en, now())::text, 'cita_cancelada',
                                           'Cita cancelada', v_detalle, new.id::text, v_datos);
            end loop;
        elsif new.estado <> 'cancelada' and new.barbero_id is distinct from old.barbero_id then
            -- Reasignación: el nuevo profesional recibe el detalle; el anterior solo un aviso sin datos del cliente
            for v_user in select * from private._destinatarios_cita(new.barbero_id::text) loop
                perform private._notificar(v_user, 'cita:' || new.id || ':asignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_asignada',
                                           'Cita asignada a ti', v_detalle, new.id::text, v_datos);
            end loop;
            update notificaciones set cuerpo = 'Esta cita se asignó a otro profesional.', datos = '{}'::jsonb
             where cita_id = new.id::text and user_id in (select user_id from barbero_usuarios where barbero_id = old.barbero_id::text);
            for v_user in select user_id from barbero_usuarios where barbero_id = old.barbero_id::text loop
                perform private._notificar(v_user, 'cita:' || new.id || ':reasignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_reasignada',
                                           'Una cita tuya se reasignó', 'La cita del ' || to_char(old.fecha, 'DD/MM/YYYY') || ' ' || to_char(old.hora, 'HH24:MI')
                                           || ' ya no está en tu agenda.', null, jsonb_build_object('seccion', 'agenda', 'fecha', old.fecha));
            end loop;
        elsif new.estado <> 'cancelada' and (new.fecha, new.hora) is distinct from (old.fecha, old.hora) then
            for v_user in select * from private._destinatarios_cita(new.barbero_id::text) loop
                perform private._notificar(v_user, 'cita:' || new.id || ':reprogramada:' || new.fecha || new.hora, 'cita_reprogramada',
                                           'Cita reprogramada', v_detalle, new.id::text, v_datos);
            end loop;
        end if;
    exception when others then
        -- Un aviso nunca impide guardar la cita
        raise warning 'aviso de cita no generado: %', sqlerrm;
    end;
    return null;
end;
$$;

create or replace function public.push_reclamar(p_limite int default 50) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_res jsonb;
begin
    update push_envios e set estado = 'omitido', actualizado_en = now()
      from notificaciones n, push_suscripciones s
     where e.estado = 'pendiente' and n.id = e.notificacion_id and s.id = e.suscripcion_id
       and (n.leida_en is not null or not s.activa or s.user_id <> n.user_id or n.creado_en < now() - interval '1 day');
    with e as (
        update push_envios set estado = 'enviando', intentos = intentos + 1, actualizado_en = now()
         where id in (select id from push_envios where estado = 'pendiente' and programado_para <= now()
                       order by programado_para limit least(greatest(coalesce(p_limite, 50), 1), 200) for update skip locked)
        returning *)
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
            'titulo', case n.tipo when 'cita_nueva' then 'Nueva reserva' when 'cita_cancelada' then 'Cita cancelada'
                                  when 'cita_reprogramada' then 'Cita reprogramada' when 'cita_asignada' then 'Cita asignada' when 'sistema' then 'Prueba de avisos' else 'Barbería' end,
            'cuerpo', case n.tipo when 'sistema' then 'Si ves esto, los avisos funcionan en este dispositivo.' else 'Toca para ver los detalles.' end, 'etiqueta', 'notificacion-' || n.id,
            'url', '?panel=' || coalesce(n.datos ->> 'seccion', 'notificaciones') || coalesce('&fecha=' || (n.datos ->> 'fecha'), '') || coalesce('&cita=' || (n.datos ->> 'cita'), ''))), '[]'::jsonb)
      into v_res
      from e join notificaciones n on n.id = e.notificacion_id join push_suscripciones s on s.id = e.suscripcion_id;
    return v_res;
end;
$$;


-- Estado real de los avisos push de la cuenta y de este dispositivo (por su endpoint).
-- Si el dispositivo estaba suscrito a OTRA cuenta (teléfono compartido), esa suscripción se desactiva:
-- el endpoint solo lo conoce el propio navegador.
create or replace function public.panel_push_estado(p_endpoint text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v push_suscripciones;
    v_dispositivo text := 'sin_suscripcion';
begin
    perform _exigir_panel();
    if nullif(p_endpoint, '') is not null then
        select * into v from push_suscripciones where endpoint = p_endpoint;
        if found then
            if v.user_id <> auth.uid() then
                update push_suscripciones set activa = false, actualizado_en = now() where id = v.id and activa;
                update push_envios set estado = 'omitido', actualizado_en = now() where suscripcion_id = v.id and estado = 'pendiente';
                v_dispositivo := 'otra_cuenta';
            else
                v_dispositivo := case when v.activa then 'activa' else 'inactiva' end;
            end if;
        end if;
    end if;
    return jsonb_build_object(
        'dispositivo', v_dispositivo,
        'preferencia_push', coalesce((select push from notificacion_preferencias where user_id = auth.uid()), false),
        'dispositivos_activos', (select count(*) from push_suscripciones where user_id = auth.uid() and activa),
        'ultimo_envio', (select max(e.actualizado_en) from push_envios e join push_suscripciones s on s.id = e.suscripcion_id
                          where s.user_id = auth.uid() and e.estado = 'enviado'),
        'ultimo_error', (select e.ultimo_error from push_envios e join push_suscripciones s on s.id = e.suscripcion_id
                          where s.user_id = auth.uid() and e.estado in ('fallido', 'vencido') order by e.actualizado_en desc limit 1),
        'ultima_prueba', (select jsonb_build_object('creada', n.creado_en,
                    'envios', coalesce((select jsonb_agg(e.estado) from push_envios e where e.notificacion_id = n.id), '[]'::jsonb))
                from notificaciones n where n.user_id = auth.uid() and n.evento like 'prueba:%' order by n.id desc limit 1));
end;
$$;

-- Notificación de prueba para la propia cuenta (aparece en la app y, si hay push, en sus dispositivos)
create or replace function public.panel_notificacion_prueba() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_encolados int;
begin
    perform _exigir_panel();
    if exists (select 1 from notificaciones where user_id = auth.uid() and evento like 'prueba:%' and creado_en > now() - interval '15 seconds') then
        raise exception 'espera_prueba';
    end if;
    perform private._notificar(auth.uid(), 'prueba:' || extract(epoch from clock_timestamp())::text, 'sistema', 'Prueba de avisos',
                               'Si ves esto, los avisos funcionan en este dispositivo.', null, jsonb_build_object('seccion', 'notificaciones', 'prueba', true));
    select count(*) into v_encolados from push_envios e join notificaciones n on n.id = e.notificacion_id
     where n.user_id = auth.uid() and n.evento like 'prueba:%' and n.creado_en > now() - interval '5 seconds';
    return jsonb_build_object('ok', true, 'push_encolados', v_encolados);
end;
$$;

do $$
declare
    v_fn regprocedure;
begin
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('panel_push_estado', 'panel_notificacion_prueba') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'push_reclamar' loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
end $$;
revoke all on function private.tg_citas_notificar() from public, anon, authenticated;

notify pgrst, 'reload schema';
