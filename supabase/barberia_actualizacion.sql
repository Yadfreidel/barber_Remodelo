-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema `barberia`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta 20261023120000_fotos_barberos.sql).
-- Aplica solo estas migraciones nuevas, trasladadas a barberia:
--   20261024000000_mis_citas_horarios_30.sql
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
-- MIGRACIÓN (trasladada a barberia): 20261024000000_mis_citas_horarios_30.sql
-- #####################################################################
-- =====================================================================
-- MIS CITAS Y HORARIOS CADA 30 MINUTOS
-- 1. Horario de atención 08:00–22:00 (America/Santo_Domingo) con inicios cada 30 min.
--    El intervalo de inicio NO cambia la duración de los servicios.
-- 2. Hora de fin en todas las citas: las antiguas sin duración guardada toman la
--    duración actual de su servicio (30 min si no tiene), una sola vez.
-- 3. «Mis citas»: consulta por tokens secretos de gestión (sin cuenta) o por la
--    cuenta del cliente (Supabase Auth + RLS). Nunca por teléfono o correo.
-- 4. Reserva idempotente: la misma solicitud reintentada no crea otra cita.
-- ADITIVA: no borra columnas, tablas ni citas.
-- =====================================================================

-- ==========================================
-- 1. HORARIO DE ATENCIÓN
-- ==========================================
update barberia.modulos_config
   set ajustes = ajustes || '{"hora_apertura": "08:00", "hora_cierre": "22:00", "intervalo_minutos": 30}'::jsonb
 where modulo = 'general';

-- El horario semanal general guardado con los valores de fábrica (09:00–20:00) pasa a 08:00–22:00.
-- No se tocan días cerrados, horarios por barbero, descansos, bloqueos ni horarios distintos.
update barberia.horarios_semana set abre = '08:00', cierra = '22:00'
 where barbero_id = '*' and activo and abre = '09:00' and cierra = '20:00';

-- ==========================================
-- 2. DURACIÓN (Y FIN) REGISTRADA EN CADA CITA
-- ==========================================
-- citas_catalogo25_duracion conserva el valor anterior en los servicios fuera del catálogo;
-- se desactiva solo durante este relleno (dentro de la misma transacción).
alter table barberia.citas disable trigger citas_catalogo25_duracion;
update barberia.citas c set duracion_reservada = coalesce(s.duracion_minutos, 30)
  from barberia.servicios s
 where s.id = c.servicio_id and c.duracion_reservada is null;
update barberia.citas set duracion_reservada = 30 where duracion_reservada is null;
alter table barberia.citas enable trigger citas_catalogo25_duracion;

-- ==========================================
-- 3. CUENTA DEL CLIENTE E IDEMPOTENCIA
-- ==========================================
alter table barberia.citas
    add column if not exists cliente_user_id uuid,
    add column if not exists clave_solicitud uuid;
create unique index if not exists citas_clave_solicitud_key on barberia.citas (clave_solicitud);
create index if not exists citas_cliente_user_idx on barberia.citas (cliente_user_id) where cliente_user_id is not null;

-- RLS: un cliente con sesión solo lee sus propias citas
drop policy if exists cliente_propias on barberia.citas;
create policy cliente_propias on barberia.citas for select to authenticated
    using (cliente_user_id is not null and cliente_user_id = (select auth.uid()));

-- Datos de una cita para su cliente (sin teléfono, correo ni notas internas)
create or replace function barberia._cita_cliente_json(p_cita_id text) returns jsonb
language sql stable set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'token', t.token, 'servicio', s.nombre, 'barbero', b.nombre,
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

-- Citas de este navegador: tokens de gestión guardados y solicitudes cuyo resultado no llegó
create or replace function barberia.mis_citas_por_tokens(p_tokens uuid[], p_claves uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    if coalesce(cardinality(p_tokens), 0) + coalesce(cardinality(p_claves), 0) > 100 then
        raise exception 'demasiadas_citas';
    end if;
    return coalesce((
        select jsonb_agg(_cita_cliente_json(c.id::text) || jsonb_build_object('clave_solicitud',
                         case when c.clave_solicitud = any (coalesce(p_claves, '{}')) then c.clave_solicitud end)
                         order by c.fecha desc, c.hora desc)
          from citas c
          join cita_tokens t on t.cita_id = c.id::text
         where t.token = any (coalesce(p_tokens, '{}'))
            or (c.clave_solicitud is not null and c.clave_solicitud = any (coalesce(p_claves, '{}')))), '[]'::jsonb);
end;
$$;

-- Citas de la cuenta con sesión iniciada
create or replace function barberia.mis_citas() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(_cita_cliente_json(c.id::text) order by c.fecha desc, c.hora desc)
          from (select id, fecha, hora from citas where cliente_user_id = auth.uid() order by fecha desc, hora desc limit 200) c), '[]'::jsonb);
end;
$$;

-- Asocia a la cuenta las citas cuyos tokens secretos tiene el cliente (prueba de que son suyas)
create or replace function barberia.vincular_citas(p_tokens uuid[]) returns int
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_total int;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if coalesce(cardinality(p_tokens), 0) > 100 then
        raise exception 'demasiadas_citas';
    end if;
    update citas c set cliente_user_id = auth.uid()
      from cita_tokens t
     where t.cita_id = c.id::text and t.token = any (coalesce(p_tokens, '{}')) and c.cliente_user_id is null;
    get diagnostics v_total = row_count;
    return v_total;
end;
$$;

-- ==========================================
-- 4. HORARIOS DEL DÍA PARA LA WEB (todas las horas de inicio con su estado)
-- ==========================================
create or replace function barberia.horarios_dia_publico(p_servicio text, p_barbero text, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_servicio text := _resolver_servicio(p_servicio);
    v_barbero text := _resolver_barbero(p_barbero);
    v_duracion int;
    v_jornada record;
    v_intervalo int := greatest(coalesce((_ajuste('general', 'intervalo_minutos'))::int, 30), 5);
    v_inicio timestamp;
    v_fin timestamp;
    v_horas jsonb := '[]'::jsonb;
begin
    if v_servicio is null or v_barbero is null or p_fecha is null then
        raise exception 'servicio_o_barbero_no_encontrado';
    end if;
    select coalesce(duracion_minutos, 30) into v_duracion from servicios where id::text = v_servicio;
    select * into v_jornada from _jornada(v_barbero, p_fecha);
    if v_jornada.abre is null or not _barbero_hace_servicio(v_barbero, v_servicio) then
        return jsonb_build_object('abierto', false, 'duracion_minutos', v_duracion, 'intervalo_minutos', v_intervalo,
            'motivo', case when v_jornada.abre is null then 'cerrado' else 'no_realiza_servicio' end, 'horas', v_horas);
    end if;
    for v_inicio in select generate_series(p_fecha + v_jornada.abre, p_fecha + v_jornada.cierra - interval '1 minute',
                                           make_interval(mins => v_intervalo)) loop
        v_fin := v_inicio + make_interval(mins => v_duracion);
        -- Solo horas en las que el servicio completo termina antes del cierre
        continue when v_fin > p_fecha + v_jornada.cierra;
        v_horas := v_horas || jsonb_build_object(
            'inicio', to_char(v_inicio, 'HH24:MI'), 'fin', to_char(v_fin, 'HH24:MI'),
            'estado', case when v_inicio <= _ahora_local() then 'pasada'
                           when _hora_publica_valida(v_barbero, p_fecha, v_inicio::time)
                                and _slot_libre(v_barbero, p_fecha, v_inicio::time, v_duracion) then 'libre'
                           else 'no_disponible' end);
    end loop;
    return jsonb_build_object('abierto', true, 'abre', to_char(v_jornada.abre, 'HH24:MI'), 'cierra', to_char(v_jornada.cierra, 'HH24:MI'),
        'duracion_minutos', v_duracion, 'intervalo_minutos', v_intervalo, 'horas', v_horas);
end;
$$;

-- ==========================================
-- 5. RESERVA IDEMPOTENTE (p_clave_solicitud) Y CON CUENTA OPCIONAL
-- ==========================================
drop function if exists barberia.reservar_cita(text, text, text, text, text, date, time, jsonb, text, boolean, numeric);
create or replace function barberia.reservar_cita(
    p_nombre text, p_email text, p_telefono text, p_servicio text, p_barbero text, p_fecha date, p_hora time,
    p_productos jsonb default '[]'::jsonb, p_codigo_referido text default null,
    p_consentimiento boolean default false, p_precio_esperado numeric default null,
    p_clave_solicitud uuid default null)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_tel text := normalizar_telefono(p_telefono);
    v_servicio text := _resolver_servicio(p_servicio);
    v_barbero text := _resolver_barbero(p_barbero);
    v_cotizacion jsonb;
    v_cita text;
    v_existente record;
    v_total numeric := 0;
    v_max int;
    v_item record;
    v_precio numeric;
    v_aviso text;
    v_avisos jsonb := '[]'::jsonb;
begin
    if coalesce(trim(p_nombre), '') = '' or coalesce(length(v_tel), 0) < 7 then
        raise exception 'datos_invalidos';
    end if;
    if v_servicio is null or v_barbero is null then
        raise exception 'servicio_o_barbero_no_encontrado';
    end if;

    -- Reintento de la misma solicitud (doble clic, respuesta perdida): devuelve la cita ya guardada
    if p_clave_solicitud is not null then
        perform pg_advisory_xact_lock(hashtextextended('solicitud:' || p_clave_solicitud::text, 0));
        select c.id::text as id, c.fecha, c.hora, c.barbero_id::text as barbero_id, c.precio_servicio, c.descuento,
               c.precio_final, c.total_productos
          into v_existente from citas c where c.clave_solicitud = p_clave_solicitud;
        if found then
            if (v_existente.fecha, v_existente.hora, v_existente.barbero_id) is distinct from (p_fecha, p_hora, v_barbero) then
                raise exception 'solicitud_ya_usada';
            end if;
            return jsonb_build_object(
                'cita_id', v_existente.id,
                'token', (select token from cita_tokens where cita_id = v_existente.id),
                'precio_base', v_existente.precio_servicio, 'descuento', v_existente.descuento,
                'precio_final', v_existente.precio_final, 'promocion_nombre', null,
                'total_productos', coalesce(v_existente.total_productos, 0), 'avisos', '[]'::jsonb,
                'repetida', true, 'cita', _cita_cliente_json(v_existente.id));
        end if;
    end if;

    perform _bloquear_agenda(v_barbero, p_fecha);
    v_cotizacion := _cotizar(v_servicio, v_barbero, p_fecha, p_hora);
    if not (v_cotizacion ->> 'disponible')::boolean then
        raise exception 'horario_no_disponible';
    end if;
    if p_precio_esperado is not null and p_precio_esperado <> (v_cotizacion ->> 'precio_final')::numeric then
        raise exception 'precio_cambiado';
    end if;

    v_cita := _crear_cita(trim(p_nombre), trim(p_telefono), p_email, v_cotizacion, p_fecha, p_hora, 'web');
    if p_clave_solicitud is not null or auth.uid() is not null then
        update citas set clave_solicitud = p_clave_solicitud, cliente_user_id = auth.uid() where id::text = v_cita;
    end if;

    if jsonb_typeof(p_productos) = 'array' and jsonb_array_length(p_productos) > 0 then
        if not _modulo_activo('productos') then
            raise exception 'modulo_productos_inactivo';
        end if;
        v_max := coalesce((_ajuste('productos', 'max_unidades_por_producto'))::int, 5);
        -- Orden fijo por id para evitar bloqueos cruzados entre reservas concurrentes
        for v_item in
            select (e ->> 'id')::uuid as id, sum((e ->> 'cantidad')::int) as cantidad
              from jsonb_array_elements(p_productos) e group by 1 order by 1
        loop
            if v_item.cantidad is null or v_item.cantidad < 1 or v_item.cantidad > v_max then
                raise exception 'cantidad_invalida';
            end if;
            update productos set stock = stock - v_item.cantidad, actualizado_en = now()
             where id = v_item.id and activo and stock >= v_item.cantidad
            returning precio into v_precio;
            if not found then
                raise exception 'sin_stock';
            end if;
            insert into cita_productos (cita_id, producto_id, cantidad, precio_unitario, subtotal)
            values (v_cita, v_item.id, v_item.cantidad, v_precio, v_precio * v_item.cantidad);
            v_total := v_total + v_precio * v_item.cantidad;
        end loop;
        update citas set total_productos = v_total where id::text = v_cita;
    end if;

    if p_consentimiento then
        insert into clientes_contacto (telefono, nombre, consentimiento_marketing, consentimiento_en)
        values (v_tel, trim(p_nombre), true, now())
        on conflict (telefono) do update
           set nombre = excluded.nombre, consentimiento_marketing = true, consentimiento_en = now(), baja_en = null;
    end if;

    if nullif(trim(p_codigo_referido), '') is not null then
        v_aviso := _registrar_referido(v_tel, p_codigo_referido);
        if v_aviso is not null then
            v_avisos := v_avisos || to_jsonb(v_aviso);
        end if;
    end if;

    return jsonb_build_object(
        'cita_id', v_cita,
        'token', (select token from cita_tokens where cita_id = v_cita),
        'precio_base', v_cotizacion -> 'precio_base',
        'descuento', v_cotizacion -> 'descuento',
        'precio_final', v_cotizacion -> 'precio_final',
        'promocion_nombre', v_cotizacion -> 'promocion_nombre',
        'total_productos', v_total,
        'avisos', v_avisos,
        'repetida', false,
        'cita', _cita_cliente_json(v_cita));
end;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
revoke all on function barberia._cita_cliente_json(text) from public, anon, authenticated;
revoke all on function barberia.mis_citas_por_tokens(uuid[], uuid[]) from public, anon, authenticated;
revoke all on function barberia.mis_citas() from public, anon, authenticated;
revoke all on function barberia.vincular_citas(uuid[]) from public, anon, authenticated;
revoke all on function barberia.horarios_dia_publico(text, text, date) from public, anon, authenticated;
revoke all on function barberia.reservar_cita(text, text, text, text, text, date, time, jsonb, text, boolean, numeric, uuid) from public, anon, authenticated;
grant execute on function barberia.mis_citas_por_tokens(uuid[], uuid[]) to anon, authenticated;
grant execute on function barberia.horarios_dia_publico(text, text, date) to anon, authenticated;
grant execute on function barberia.reservar_cita(text, text, text, text, text, date, time, jsonb, text, boolean, numeric, uuid) to anon, authenticated;
grant execute on function barberia.mis_citas() to authenticated;
grant execute on function barberia.vincular_citas(uuid[]) to authenticated;

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
        if v_nombre = any (array['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita', 'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita', 'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta', 'aceptar_oferta', 'rechazar_oferta', 'mi_codigo_referido', 'darse_de_baja', 'catalogo_publico', 'barberos_publicos', 'negocio_publico', 'ubicacion_publica', 'horarios_dia_publico', 'mis_citas_por_tokens']) then
            execute format('grant execute on function %s to anon, authenticated', v_fn);
        elsif v_nombre = any (array['es_admin', 'rol_panel', 'barbero_actual', 'mis_citas', 'vincular_citas']) or v_nombre like 'panel\_%' or v_nombre like 'admin\_%' then
            execute format('grant execute on function %s to authenticated', v_fn);
        elsif v_nombre = any (array['programar_recordatorios', 'programar_recuperacion', 'procesar_tareas_programadas', 'whatsapp_reclamar', 'whatsapp_resultado', 'whatsapp_procesar_evento']) then
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
   set ajustes = ajustes || jsonb_build_object('url_publica', 'https://yadfreidel.github.io/barber_Remodelo/')
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
