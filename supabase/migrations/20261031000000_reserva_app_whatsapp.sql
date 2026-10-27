-- =====================================================================
-- RESERVA COMPLETA EN LA APP + AVISOS DE LA CITA POR WHATSAPP (complemento)
--
-- La reserva se guarda en reservar_cita (sin cambios) y se muestra en la app; WhatsApp ya no forma
-- parte de la reserva. Los avisos al cliente usan la cola existente (mensajes_whatsapp) y la Edge
-- Function whatsapp-enviar (API oficial de Meta, plantillas aprobadas):
--   - cita pendiente  -> «solicitud recibida» (tipo nuevo 'solicitud'), y después la confirmación.
--   - cita confirmada al reservar -> una sola confirmación (como ya hacía el disparador).
-- Consentimiento: el cliente lo marca al reservar (cita_avisos_whatsapp). Sin él, ningún aviso de su
-- cita se envía (solicitud, confirmación, cancelación, reprogramación ni recordatorio). Es distinto
-- del consentimiento de marketing (consentimiento_marketing), que no se toca.
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

alter table public.clientes_contacto
    add column if not exists avisos_whatsapp boolean,
    add column if not exists avisos_whatsapp_en timestamptz;

-- Tipo nuevo de mensaje y de plantilla: 'solicitud'
do $$
declare
    v_nombre text;
begin
    for v_nombre in select conname from pg_constraint
                     where conrelid = 'public.mensajes_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%' loop
        execute format('alter table public.mensajes_whatsapp drop constraint %I', v_nombre);
    end loop;
    alter table public.mensajes_whatsapp add constraint mensajes_whatsapp_tipo_check
        check (tipo in ('recordatorio', 'oferta_espera', 'recuperacion', 'confirmacion', 'cancelacion', 'reprogramacion', 'solicitud'));
    for v_nombre in select conname from pg_constraint
                     where conrelid = 'public.plantillas_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%' loop
        execute format('alter table public.plantillas_whatsapp drop constraint %I', v_nombre);
    end loop;
    alter table public.plantillas_whatsapp add constraint plantillas_whatsapp_tipo_check
        check (tipo in ('confirmacion', 'recordatorio', 'cancelacion', 'reprogramacion', 'solicitud'));
end $$;

-- Texto de referencia (el envío automático usa la plantilla aprobada en Meta: meta_plantilla)
insert into public.plantillas_whatsapp (tipo, texto, meta_plantilla) values
    ('solicitud', E'Hola {cliente}, recibimos tu solicitud de cita en {ubicacion}.\n{servicio} con {barbero}\n{fecha} a las {hora}\nEstá pendiente de confirmación: te avisaremos cuando la barbería la confirme.\n{mapa}', '')
on conflict (tipo) do nothing;

-- «Solicitud recibida» al crearse una cita pendiente (la confirmada ya encola su confirmación)
create or replace function private.tg_citas_solicitud() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.estado = 'pendiente' then
        perform _encolar_aviso('solicitud', new.id::text, 'solicitud:' || new.id);
    end if;
    return null;
exception when others then
    -- Un aviso nunca impide guardar la cita
    raise warning 'aviso de solicitud no encolado: %', sqlerrm;
    return null;
end;
$$;
drop trigger if exists citas_solicitud on public.citas;
create trigger citas_solicitud after insert on public.citas
    for each row execute function private.tg_citas_solicitud();

-- El cliente acepta o rechaza los avisos de su cita (con el token secreto de la cita).
-- Se guarda por teléfono para sus próximas citas; no toca el consentimiento de marketing.
create or replace function public.cita_avisos_whatsapp(p_token uuid, p_acepta boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v citas;
    v_tel text;
begin
    select * into v from citas where id::text = _cita_por_token(p_token);
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    v_tel := normalizar_telefono(v.telefono_cliente);
    insert into clientes_contacto (telefono, nombre, avisos_whatsapp, avisos_whatsapp_en)
    values (v_tel, v.nombre_cliente, coalesce(p_acepta, false), now())
    on conflict (telefono) do update set avisos_whatsapp = coalesce(p_acepta, false), avisos_whatsapp_en = now();
    if not coalesce(p_acepta, false) then
        update mensajes_whatsapp set estado = 'omitido', ultimo_error = 'sin_consentimiento_avisos', actualizado_en = now()
         where estado = 'pendiente' and telefono = v_tel and tipo in ('solicitud', 'confirmacion', 'cancelacion', 'reprogramacion', 'recordatorio');
    end if;
    return jsonb_build_object('ok', true, 'avisos_whatsapp', coalesce(p_acepta, false));
end;
$$;

-- Notas del cliente para el barbero (antes solo viajaban en el mensaje de WhatsApp). Solo con el
-- token de la cita, solo si aún no tiene notas (reintentos idempotentes) y antes de que ocurra.
create or replace function public.cita_notas_cliente(p_token uuid, p_notas text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v citas;
    v_notas text := nullif(trim(p_notas), '');
begin
    select * into v from citas where id::text = _cita_por_token(p_token) for update;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    if v_notas is null then
        return jsonb_build_object('ok', true, 'guardadas', false);
    end if;
    if length(v_notas) > 1000 then
        raise exception 'datos_invalidos';
    end if;
    if v.notas is not null then
        return jsonb_build_object('ok', true, 'guardadas', v.notas = 'Nota del cliente: ' || v_notas, 'repetida', true);
    end if;
    if v.estado = 'cancelada' or v.completada_en is not null then
        raise exception 'cita_cerrada';
    end if;
    update citas set notas = 'Nota del cliente: ' || v_notas where id = v.id;
    return jsonb_build_object('ok', true, 'guardadas', true);
end;
$$;

-- Referencia visible de la reserva en el comprobante
create or replace function public._cita_cliente_json(p_cita_id text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'token', t.token, 'servicio', s.nombre, 'barbero', b.nombre,
        'referencia', case when c.id::text ~ '^\d+$' then 'C-' || lpad(c.id::text, 5, '0') else 'C-' || upper(left(c.id::text, 8)) end,
        'fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'),
        'hora_fin', to_char(c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30)), 'HH24:MI'),
        'duracion_minutos', coalesce(c.duracion_reservada, s.duracion_minutos, 30),
        'precio', coalesce(c.precio_final, c.precio_servicio, s.precio, 0)
                  + case when c.estado = 'cancelada' then 0 else coalesce(c.total_productos, 0) end,
        'estado', c.estado,
        'completada', c.completada_en is not null,
        'no_asistio', c.no_asistio_en is not null,
        'cliente_confirmo', c.cliente_confirmo_en is not null,
        'modificable', c.estado <> 'cancelada' and c.completada_en is null and c.no_asistio_en is null
            and (c.fecha + c.hora) - _ahora_local() >= make_interval(hours => coalesce((_ajuste('general', 'horas_minimas_cambio'))::int, 1)),
        'creado_en', c.creado_en)
      from citas c
      join cita_tokens t on t.cita_id = c.id::text
      left join servicios s on s.id = c.servicio_id
      left join barberos b on b.id = c.barbero_id
     where c.id::text = p_cita_id
$$;

-- Envío: solo con consentimiento para los avisos de la cita. Se espera hasta 2 minutos a que el
-- cliente responda (la casilla se guarda justo después de reservar); sin respuesta o con «no», se omite.
create or replace function public.whatsapp_reclamar(p_limite int default 20) returns setof public.mensajes_whatsapp
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not _modulo_activo('whatsapp') then
        return;
    end if;
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'cita_cancelada', actualizado_en = now()
      from citas c
     where m.estado = 'pendiente' and m.tipo in ('recordatorio', 'solicitud', 'confirmacion', 'reprogramacion')
       and c.id::text = m.cita_id and c.estado = 'cancelada';
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'oferta_no_vigente', actualizado_en = now()
      from ofertas_espera o
     where m.estado = 'pendiente' and m.tipo = 'oferta_espera' and o.id = m.oferta_id and (o.estado <> 'pendiente' or o.expira_en <= now());
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'sin_consentimiento', actualizado_en = now()
     where m.estado = 'pendiente' and m.tipo = 'recuperacion'
       and not exists (select 1 from clientes_contacto cc where cc.telefono = m.telefono and cc.consentimiento_marketing and cc.baja_en is null);
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'sin_consentimiento_avisos', actualizado_en = now()
     where m.estado = 'pendiente' and m.tipo in ('solicitud', 'confirmacion', 'cancelacion', 'reprogramacion', 'recordatorio')
       and not exists (select 1 from clientes_contacto cc where cc.telefono = m.telefono and cc.avisos_whatsapp and cc.baja_en is null)
       and (m.creado_en < now() - interval '2 minutes'
            or exists (select 1 from clientes_contacto cc where cc.telefono = m.telefono and cc.avisos_whatsapp is false));

    return query
    update mensajes_whatsapp set estado = 'enviando', intentos = intentos + 1, actualizado_en = now()
     where id in (select m.id from mensajes_whatsapp m
                   where m.estado = 'pendiente' and m.programado_para <= now()
                     and (m.tipo not in ('solicitud', 'confirmacion', 'cancelacion', 'reprogramacion', 'recordatorio')
                          or exists (select 1 from clientes_contacto cc where cc.telefono = m.telefono and cc.avisos_whatsapp and cc.baja_en is null))
                   order by m.programado_para limit greatest(least(p_limite, 100), 1) for update skip locked)
    returning *;
end;
$$;

revoke all on function private.tg_citas_solicitud() from public, anon, authenticated;
revoke all on function public.cita_avisos_whatsapp(uuid, boolean) from public;
grant execute on function public.cita_avisos_whatsapp(uuid, boolean) to anon, authenticated;
revoke all on function public.cita_notas_cliente(uuid, text) from public;
grant execute on function public.cita_notas_cliente(uuid, text) to anon, authenticated;
revoke all on function public.whatsapp_reclamar(int) from public, anon, authenticated;
revoke all on function public._cita_cliente_json(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
