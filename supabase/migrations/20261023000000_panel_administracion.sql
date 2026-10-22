-- =====================================================================
-- PANEL DE ADMINISTRACIÓN
-- Horarios y bloqueos, catálogo y barberos en el servidor, rol barbero,
-- clientes, configuración del negocio, plantillas de WhatsApp, cobros,
-- reportes y auditoría.
-- ADITIVA: no borra columnas, tablas ni datos. Los estados de cita no
-- cambian (pendiente/confirmada/cancelada); "completada" y "no asistió"
-- se registran en columnas propias, igual que el pago.
-- Zona horaria: modulos_config.general.zona_horaria (America/Santo_Domingo).
-- =====================================================================

-- ==========================================
-- COLUMNAS ADITIVAS
-- ==========================================
alter table public.citas
    add column if not exists notas text,
    add column if not exists motivo_cancelacion text,
    add column if not exists cancelada_en timestamptz,
    add column if not exists cancelada_por uuid,
    add column if not exists no_asistio_en timestamptz,
    add column if not exists monto_cobrado numeric(10, 2),
    add column if not exists metodo_pago text,
    add column if not exists creada_por uuid;

alter table public.servicios
    add column if not exists descripcion text,
    add column if not exists categoria text,
    add column if not exists imagen_url text,
    add column if not exists activo boolean,
    add column if not exists destacado boolean,
    add column if not exists orden int,
    add column if not exists en_catalogo boolean;

-- Los servicios anteriores al catálogo no se mostraban en la web: se conservan reservables pero fuera del catálogo
update public.servicios set activo = true where activo is null;
update public.servicios set destacado = false where destacado is null;
update public.servicios set en_catalogo = (catalogo_id is not null) where en_catalogo is null;
alter table public.servicios
    alter column activo set default true, alter column activo set not null,
    alter column destacado set default false, alter column destacado set not null,
    alter column en_catalogo set default true, alter column en_catalogo set not null;

alter table public.barberos
    add column if not exists especialidad text,
    add column if not exists foto_url text,
    add column if not exists orden int;

-- Nuevas configuraciones de reserva (sin cambiar el comportamiento actual: 0 = sin límite)
update public.modulos_config
   set ajustes = jsonb_build_object('anticipacion_minima_minutos', 0, 'max_dias_reserva', 0, 'minutos_entre_citas', 0,
                                    'zona_horaria', 'America/Santo_Domingo') || ajustes
 where modulo = 'general';

-- ==========================================
-- TABLAS NUEVAS
-- ==========================================
-- Horario semanal: barbero_id '*' = horario general del negocio
create table if not exists public.horarios_semana (
    barbero_id text not null default '*',
    dia smallint not null check (dia between 0 and 6),
    activo boolean not null default true,
    abre time not null,
    cierra time not null,
    primary key (barbero_id, dia),
    check (cierra > abre)
);

-- Descansos recurrentes (p. ej. almuerzo). barbero_id null = todos
create table if not exists public.descansos (
    id uuid primary key default gen_random_uuid(),
    barbero_id text,
    dia smallint not null check (dia between 0 and 6),
    desde time not null,
    hasta time not null,
    check (hasta > desde)
);

-- Vacaciones, feriados, cierres y bloqueos. Sin horas = día completo. barbero_id null = todo el negocio
create table if not exists public.bloqueos (
    id uuid primary key default gen_random_uuid(),
    barbero_id text,
    fecha_desde date not null,
    fecha_hasta date not null,
    hora_desde time,
    hora_hasta time,
    tipo text not null check (tipo in ('bloqueo', 'vacaciones', 'feriado', 'cierre')),
    motivo text,
    activo boolean not null default true,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    check (fecha_hasta >= fecha_desde),
    check ((hora_desde is null and hora_hasta is null) or (hora_desde is not null and hora_hasta is not null and hora_hasta > hora_desde))
);

-- Sin filas para un servicio = todos los barberos pueden realizarlo
create table if not exists public.servicio_barberos (
    servicio_id text not null,
    barbero_id text not null,
    primary key (servicio_id, barbero_id)
);

-- Usuarios de Supabase Auth con rol barbero (solo su agenda)
create table if not exists public.barbero_usuarios (
    user_id uuid primary key,
    barbero_id text not null,
    creado_en timestamptz not null default now()
);

create table if not exists public.clientes (
    telefono text primary key,
    nombre text,
    email text,
    notas text,
    preferencias jsonb not null default '{}'::jsonb,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

create table if not exists public.negocio_config (
    id boolean primary key default true check (id),
    datos jsonb not null default '{}'::jsonb,
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

create table if not exists public.plantillas_whatsapp (
    tipo text primary key check (tipo in ('confirmacion', 'recordatorio', 'cancelacion', 'reprogramacion')),
    texto text not null,
    meta_plantilla text not null default '',
    actualizado_en timestamptz not null default now()
);
insert into public.plantillas_whatsapp (tipo, texto, meta_plantilla) values
    ('confirmacion', E'Hola {cliente}, tu cita está confirmada.\n{servicio} con {barbero}\n{fecha} a las {hora}\n{ubicacion}\n{mapa}', ''),
    ('recordatorio', E'Hola {cliente}, te recordamos tu cita de {servicio} con {barbero} el {fecha} a las {hora}.\n{ubicacion}\n{mapa}',
        coalesce((select ajustes ->> 'plantilla_recordatorio' from public.modulos_config where modulo = 'whatsapp'), '')),
    ('cancelacion', E'Hola {cliente}, tu cita de {servicio} del {fecha} a las {hora} fue cancelada. Escríbenos para elegir otro horario.', ''),
    ('reprogramacion', E'Hola {cliente}, tu cita de {servicio} con {barbero} cambió al {fecha} a las {hora}.\n{ubicacion}\n{mapa}', '')
on conflict (tipo) do nothing;

create table if not exists public.auditoria (
    id bigint generated always as identity primary key,
    creado_en timestamptz not null default now(),
    usuario_id uuid,
    rol text,
    accion text not null,
    entidad text not null,
    entidad_id text,
    detalle jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_entidad_idx on public.auditoria (entidad, entidad_id);
create index if not exists auditoria_fecha_idx on public.auditoria (creado_en desc);

-- La cola de WhatsApp admite los nuevos tipos de aviso
do $$
declare
    v_nombre text;
begin
    select conname into v_nombre from pg_constraint
     where conrelid = 'public.mensajes_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%';
    if v_nombre is not null then
        execute format('alter table public.mensajes_whatsapp drop constraint %I', v_nombre);
    end if;
    alter table public.mensajes_whatsapp add constraint mensajes_whatsapp_tipo_check
        check (tipo in ('recordatorio', 'oferta_espera', 'recuperacion', 'confirmacion', 'cancelacion', 'reprogramacion'));
end $$;

-- ==========================================
-- ROLES
-- ==========================================
create or replace function public.barbero_actual() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select bu.barbero_id from barbero_usuarios bu
      join barberos b on b.id::text = bu.barbero_id
     where bu.user_id = auth.uid() and b.activo is not false
$$;

create or replace function public._rol_panel() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select case when es_admin() then 'admin' when barbero_actual() is not null then 'barbero' end
$$;

create or replace function public._exigir_panel(p_solo_admin boolean default false) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _rol_panel();
begin
    if v_rol is null or (p_solo_admin and v_rol <> 'admin') then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v_rol;
end;
$$;

create or replace function public.rol_panel() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'rol', _rol_panel(),
        'barbero_id', case when not es_admin() then barbero_actual() end,
        'barbero_nombre', (select nombre from barberos where id::text = barbero_actual()))
$$;

create or replace function public._auditar(p_accion text, p_entidad text, p_id text, p_detalle jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into auditoria (usuario_id, rol, accion, entidad, entidad_id, detalle)
    values (auth.uid(), coalesce(_rol_panel(), case when auth.uid() is null then 'web' else 'usuario' end),
            p_accion, p_entidad, p_id, coalesce(p_detalle, '{}'::jsonb))
$$;

-- ==========================================
-- DISPONIBILIDAD
-- ==========================================
-- Jornada efectiva de un barbero en una fecha (abre = null: cerrado)
create or replace function public._jornada(p_barbero_id text, p_fecha date, out abre time, out cierra time)
language plpgsql stable set search_path = public, pg_temp as $$
declare
    v_dia int := extract(dow from p_fecha)::int;
    v_fila record;
begin
    if exists (select 1 from bloqueos b
                where b.activo and b.hora_desde is null and p_fecha between b.fecha_desde and b.fecha_hasta
                  and (b.barbero_id is null or b.barbero_id = p_barbero_id)) then
        return;
    end if;
    select * into v_fila from horarios_semana where barbero_id = p_barbero_id and dia = v_dia;
    if not found then
        select * into v_fila from horarios_semana where barbero_id = '*' and dia = v_dia;
    end if;
    if found then
        if v_fila.activo then
            abre := v_fila.abre;
            cierra := v_fila.cierra;
        end if;
        return;
    end if;
    select (ajustes ->> 'hora_apertura')::time, (ajustes ->> 'hora_cierre')::time
      into abre, cierra from modulos_config where modulo = 'general';
end;
$$;

-- Jornada, descansos, bloqueos y citas existentes (con el tiempo entre citas configurado)
create or replace function public._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
declare
    v_jornada record;
    v_fin time;
    v_margen int := coalesce((_ajuste('general', 'minutos_entre_citas'))::int, 0);
begin
    if p_barbero_id is null or p_duracion is null or p_duracion <= 0 then
        return false;
    end if;
    v_fin := p_hora + make_interval(mins => p_duracion);
    if v_fin <= p_hora then
        return false; -- cruzaría la medianoche
    end if;
    select * into v_jornada from _jornada(p_barbero_id, p_fecha);
    if v_jornada.abre is null or p_hora < v_jornada.abre or v_fin > v_jornada.cierra then
        return false;
    end if;
    if exists (select 1 from descansos d
                where d.dia = extract(dow from p_fecha)::int and (d.barbero_id is null or d.barbero_id = p_barbero_id)
                  and d.desde < v_fin and p_hora < d.hasta) then
        return false;
    end if;
    if exists (select 1 from bloqueos b
                where b.activo and b.hora_desde is not null and p_fecha between b.fecha_desde and b.fecha_hasta
                  and (b.barbero_id is null or b.barbero_id = p_barbero_id)
                  and b.hora_desde < v_fin and p_hora < b.hora_hasta) then
        return false;
    end if;
    return not exists (
        select 1 from citas c left join servicios s on s.id::text = c.servicio_id::text
         where c.barbero_id::text = p_barbero_id and c.fecha = p_fecha and c.estado <> 'cancelada'
           and (p_excluir_cita is null or c.id::text <> p_excluir_cita)
           and c.hora - make_interval(mins => v_margen) < v_fin
           and p_hora < c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30) + v_margen));
end;
$$;

-- La jornada ahora la valida _slot_libre (por día y barbero); aquí solo se evita cruzar la medianoche
create or replace function public._en_horario(p_hora time, p_duracion int) returns boolean
language sql stable as $$
    select p_hora + make_interval(mins => p_duracion) > p_hora
$$;

create or replace function public._barbero_hace_servicio(p_barbero_id text, p_servicio_id text) returns boolean
language sql stable set search_path = public, pg_temp as $$
    select not exists (select 1 from servicio_barberos where servicio_id = p_servicio_id)
        or exists (select 1 from servicio_barberos where servicio_id = p_servicio_id and barbero_id = p_barbero_id)
$$;

-- Reglas solo para reservas de clientes: anticipación mínima, límite de días y horas en la cuadrícula
create or replace function public._hora_publica_valida(p_barbero_id text, p_fecha date, p_hora time) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
declare
    v_jornada record;
    v_intervalo int := greatest(coalesce((_ajuste('general', 'intervalo_minutos'))::int, 60), 5);
    v_anticipacion int := coalesce((_ajuste('general', 'anticipacion_minima_minutos'))::int, 0);
    v_max_dias int := coalesce((_ajuste('general', 'max_dias_reserva'))::int, 0);
begin
    if (p_fecha + p_hora) <= _ahora_local() + make_interval(mins => v_anticipacion) then
        return false;
    end if;
    if v_max_dias > 0 and p_fecha > _ahora_local()::date + v_max_dias then
        return false;
    end if;
    select * into v_jornada from _jornada(p_barbero_id, p_fecha);
    return v_jornada.abre is not null and p_hora >= v_jornada.abre
       and (extract(epoch from (p_hora - v_jornada.abre))::int / 60) % v_intervalo = 0;
end;
$$;

create or replace function public._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = public, pg_temp as $$
    select id::text from servicios
    where activo and (nombre = p_nombre or (catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre))
                      or id::text = p_nombre)
    order by case when catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre) then 0
                  when id::text = p_nombre then 1 else 2 end, id
    limit 1
$$;

create or replace function public._cotizar(p_servicio_id text, p_barbero_id text, p_fecha date, p_hora time, p_excluir_cita text default null)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
    v_precio numeric;
    v_duracion int;
    v_disponible boolean;
    v_descuento numeric := 0;
    v_promo_id uuid;
    v_promo_nombre text;
begin
    select coalesce(precio, 0)::numeric, coalesce(duracion_minutos, 30)
      into v_precio, v_duracion
      from servicios where id::text = p_servicio_id;
    if not found then
        raise exception 'servicio_no_encontrado';
    end if;
    -- Al reprogramar se conserva la duración registrada en la cita
    if p_excluir_cita is not null then
        select coalesce(duracion_reservada, v_duracion) into v_duracion from citas where id::text = p_excluir_cita;
    end if;

    v_disponible := _hora_publica_valida(p_barbero_id, p_fecha, p_hora)
        and _barbero_hace_servicio(p_barbero_id, p_servicio_id)
        and _slot_libre(p_barbero_id, p_fecha, p_hora, v_duracion, p_excluir_cita);

    if v_disponible and _modulo_activo('promociones') then
        select pr.id, pr.nombre,
               least(v_precio, case when pr.tipo = 'porcentaje' then round(v_precio * pr.valor / 100, 2) else pr.valor end)
          into v_promo_id, v_promo_nombre, v_descuento
          from promociones pr
         where pr.activa
           and p_fecha between pr.fecha_desde and pr.fecha_hasta
           and (pr.dias_semana is null or extract(dow from p_fecha)::int = any (pr.dias_semana))
           and p_hora >= pr.hora_desde and p_hora < pr.hora_hasta
           and (pr.servicio_id is null or pr.servicio_id = p_servicio_id)
           and (pr.barbero_id is null or pr.barbero_id = p_barbero_id)
           and (pr.max_usos is null or pr.usos < pr.max_usos)
         order by 3 desc, pr.creado_en, pr.id
         limit 1;
        v_descuento := coalesce(v_descuento, 0);
    end if;

    return jsonb_build_object(
        'servicio_id', p_servicio_id,
        'barbero_id', p_barbero_id,
        'duracion_minutos', v_duracion,
        'disponible', v_disponible,
        'precio_base', v_precio,
        'descuento', v_descuento,
        'precio_final', v_precio - v_descuento,
        'promocion_id', case when v_descuento > 0 then v_promo_id end,
        'promocion_nombre', case when v_descuento > 0 then v_promo_nombre end
    );
end;
$$;

-- Horas libres de un día (p_publico: aplica anticipación y límite de días de la web)
create or replace function public._horas_dia(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text, p_publico boolean)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
    v_duracion int;
    v_jornada record;
    v_intervalo int := greatest(coalesce((_ajuste('general', 'intervalo_minutos'))::int, 60), 5);
    v_hora timestamp;
    v_resultado jsonb := '[]'::jsonb;
begin
    select coalesce(duracion_minutos, 30) into v_duracion from servicios where id::text = p_servicio_id and activo;
    if p_excluir_cita is not null then
        select coalesce(duracion_reservada, v_duracion) into v_duracion from citas where id::text = p_excluir_cita;
    end if;
    if v_duracion is null or p_barbero_id is null or not _barbero_hace_servicio(p_barbero_id, p_servicio_id) then
        return v_resultado;
    end if;
    select * into v_jornada from _jornada(p_barbero_id, p_fecha);
    if v_jornada.abre is null then
        return v_resultado;
    end if;
    for v_hora in select generate_series(p_fecha + v_jornada.abre, p_fecha + v_jornada.cierra - interval '1 minute',
                                         make_interval(mins => v_intervalo)) loop
        if (not p_publico or _hora_publica_valida(p_barbero_id, p_fecha, v_hora::time))
           and _slot_libre(p_barbero_id, p_fecha, v_hora::time, v_duracion, p_excluir_cita) then
            v_resultado := v_resultado || to_jsonb(to_char(v_hora, 'HH24:MI'));
        end if;
    end loop;
    return v_resultado;
end;
$$;

create or replace function public._horas_libres(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select _horas_dia(p_servicio_id, p_barbero_id, p_fecha, p_excluir_cita, true)
$$;

-- ==========================================
-- TRIGGERS DE CITAS: precio/duración registrados, validación, auditoría y avisos
-- ==========================================
create or replace function public.tg_citas_panel_antes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_servicio record;
    v_validar boolean;
begin
    select precio, duracion_minutos, catalogo_id into v_servicio from servicios where id = new.servicio_id;
    if tg_op = 'INSERT' then
        -- El precio y la duración de la cita no cambian si luego se edita el catálogo
        new.precio_servicio := coalesce(new.precio_servicio, v_servicio.precio);
        new.precio_final := coalesce(new.precio_final, new.precio_servicio - coalesce(new.descuento, 0));
        if new.duracion_reservada is null then
            new.duracion_reservada := v_servicio.duracion_minutos;
        end if;
    elsif new.servicio_id is distinct from old.servicio_id and v_servicio.catalogo_id is null then
        new.duracion_reservada := v_servicio.duracion_minutos;
    end if;

    -- Los cortes del catálogo ya los valida citas_catalogo25_duracion
    if v_servicio.catalogo_id is null and new.estado <> 'cancelada' then
        v_validar := tg_op = 'INSERT'
            or (new.barbero_id, new.fecha, new.hora, new.servicio_id) is distinct from (old.barbero_id, old.fecha, old.hora, old.servicio_id)
            or old.estado = 'cancelada';
        -- Misma hora exacta: la restricción única existente informa el conflicto con su mensaje habitual
        if v_validar and not exists (select 1 from citas x where x.barbero_id = new.barbero_id and x.fecha = new.fecha
                                       and x.hora = new.hora and x.estado <> 'cancelada'
                                       and (tg_op = 'INSERT' or x.id <> new.id)) then
            perform _bloquear_agenda(new.barbero_id::text, new.fecha);
            if not _slot_libre(new.barbero_id::text, new.fecha, new.hora,
                               coalesce(new.duracion_reservada, v_servicio.duracion_minutos, 30),
                               case when tg_op = 'UPDATE' then new.id::text end) then
                raise exception 'horario_no_disponible' using errcode = '23505';
            end if;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists citas_snapshot_panel on public.citas;
create trigger citas_snapshot_panel before insert or update on public.citas
    for each row execute function public.tg_citas_panel_antes();

create or replace function public._encolar_aviso(p_tipo text, p_cita_id text, p_clave text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_plantilla text;
    v record;
begin
    select meta_plantilla into v_plantilla from plantillas_whatsapp where tipo = p_tipo;
    if coalesce(v_plantilla, '') = '' or not _modulo_activo('whatsapp') then
        return; -- sin plantilla aprobada en Meta no hay envío automático
    end if;
    select c.nombre_cliente, c.telefono_cliente, c.fecha, c.hora, s.nombre as servicio, b.nombre as barbero, t.token
      into v
      from citas c
      left join servicios s on s.id = c.servicio_id
      left join barberos b on b.id = c.barbero_id
      left join cita_tokens t on t.cita_id = c.id::text
     where c.id::text = p_cita_id;
    perform _encolar_mensaje(p_clave, p_tipo, v.telefono_cliente, p_cita_id, null, v_plantilla,
        jsonb_build_array(v.nombre_cliente, coalesce(v.servicio, ''), coalesce(v.barbero, ''), to_char(v.fecha, 'DD/MM/YYYY'),
                          to_char(v.hora, 'HH24:MI'),
                          coalesce((select nombre || ' - ' || direccion from ubicacion_local where id), ''),
                          case when v.token is null then '' else _enlace('cita', v.token) end),
        '[]'::jsonb);
end;
$$;

create or replace function public.tg_citas_panel_despues() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id text := new.id::text;
begin
    if tg_op = 'INSERT' then
        perform _auditar('cita_creada', 'cita', v_id, jsonb_build_object(
            'origen', coalesce(new.origen, 'web'), 'cliente', new.nombre_cliente, 'fecha', new.fecha,
            'hora', to_char(new.hora, 'HH24:MI'), 'estado', new.estado, 'precio', new.precio_final));
        if new.estado = 'confirmada' then
            perform _encolar_aviso('confirmacion', v_id, 'confirmacion:' || v_id || ':' || new.fecha || 'T' || new.hora);
        end if;
        return new;
    end if;

    if new.estado is distinct from old.estado then
        perform _auditar('cita_' || new.estado, 'cita', v_id, jsonb_build_object(
            'antes', old.estado, 'motivo', new.motivo_cancelacion));
        if new.estado = 'confirmada' then
            perform _encolar_aviso('confirmacion', v_id, 'confirmacion:' || v_id || ':' || new.fecha || 'T' || new.hora);
        elsif new.estado = 'cancelada' then
            perform _encolar_aviso('cancelacion', v_id, 'cancelacion:' || v_id);
        end if;
    end if;
    if new.estado <> 'cancelada'
       and (new.fecha, new.hora, new.barbero_id) is distinct from (old.fecha, old.hora, old.barbero_id) then
        perform _auditar('cita_reprogramada', 'cita', v_id, jsonb_build_object(
            'de', jsonb_build_object('fecha', old.fecha, 'hora', to_char(old.hora, 'HH24:MI'), 'barbero_id', old.barbero_id::text),
            'a', jsonb_build_object('fecha', new.fecha, 'hora', to_char(new.hora, 'HH24:MI'), 'barbero_id', new.barbero_id::text)));
        perform _encolar_aviso('reprogramacion', v_id, 'reprogramacion:' || v_id || ':' || new.fecha || 'T' || new.hora);
    end if;
    if new.completada_en is not null and old.completada_en is null then
        perform _auditar('cita_completada', 'cita', v_id, '{}'::jsonb);
    end if;
    if new.no_asistio_en is not null and old.no_asistio_en is null then
        perform _auditar('cita_no_asistio', 'cita', v_id, '{}'::jsonb);
    end if;
    if new.pagada_en is not null and (old.pagada_en is null
        or (new.monto_cobrado, new.metodo_pago) is distinct from (old.monto_cobrado, old.metodo_pago)) then
        perform _auditar('pago_registrado', 'cita', v_id, jsonb_build_object('monto', new.monto_cobrado, 'metodo', new.metodo_pago));
    elsif new.pagada_en is null and old.pagada_en is not null then
        perform _auditar('pago_anulado', 'cita', v_id, jsonb_build_object('monto_anterior', old.monto_cobrado));
    end if;
    if new.notas is distinct from old.notas then
        perform _auditar('notas_actualizadas', 'cita', v_id, '{}'::jsonb);
    end if;
    return new;
end;
$$;

drop trigger if exists citas_panel_eventos on public.citas;
create trigger citas_panel_eventos after insert or update on public.citas
    for each row execute function public.tg_citas_panel_despues();

-- ==========================================
-- LECTURAS PÚBLICAS (web de clientes)
-- ==========================================
create or replace function public.catalogo_publico() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'catalogo_id', s.catalogo_id, 'nombre', s.nombre, 'descripcion', s.descripcion,
        'categoria', s.categoria, 'imagen_url', s.imagen_url, 'precio', s.precio, 'duracion_minutos', s.duracion_minutos,
        'destacado', s.destacado, 'orden', s.orden,
        'barberos', (select jsonb_agg(sb.barbero_id) from servicio_barberos sb where sb.servicio_id = s.id::text))
        order by s.orden nulls last, s.catalogo_id nulls last, s.nombre), '[]'::jsonb)
      from servicios s
     where s.activo and (s.catalogo_id is not null or s.en_catalogo)
$$;

create or replace function public.barberos_publicos() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id::text, 'nombre', b.nombre, 'especialidad', b.especialidad, 'foto_url', b.foto_url)
        order by b.orden nulls last, b.nombre), '[]'::jsonb)
      from barberos b where b.activo is not false
$$;

create or replace function public.negocio_publico() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select datos from negocio_config where id
$$;

-- ==========================================
-- PANEL: CITAS
-- ==========================================
create or replace function public._estado_visual(c citas) returns text
language sql stable as $$
    select case when c.estado = 'cancelada' then 'cancelada'
                when c.no_asistio_en is not null then 'no_asistio'
                when c.completada_en is not null then 'completada'
                else c.estado end
$$;

create or replace function public._cita_json(c citas) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', c.id::text, 'fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'),
        'duracion', coalesce(c.duracion_reservada, s.duracion_minutos, 30),
        'fin', to_char(c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30)), 'HH24:MI'),
        'estado', c.estado, 'estado_visual', _estado_visual(c),
        'cliente', c.nombre_cliente, 'telefono', c.telefono_cliente, 'email', c.email,
        'servicio_id', c.servicio_id::text, 'servicio', s.nombre,
        'barbero_id', c.barbero_id::text, 'barbero', b.nombre,
        'precio', coalesce(c.precio_final, c.precio_servicio, s.precio), 'precio_servicio', c.precio_servicio,
        'descuento', c.descuento, 'total_productos', c.total_productos,
        'pagada', c.pagada_en is not null, 'pagada_en', c.pagada_en, 'monto_cobrado', c.monto_cobrado, 'metodo_pago', c.metodo_pago,
        'completada_en', c.completada_en, 'no_asistio_en', c.no_asistio_en,
        'notas', c.notas, 'motivo_cancelacion', c.motivo_cancelacion, 'cancelada_en', c.cancelada_en,
        'origen', coalesce(c.origen, 'web'), 'cliente_confirmo', c.cliente_confirmo_en is not null,
        'creado_en', c.creado_en,
        'token', case when es_admin() then (select token from cita_tokens where cita_id = c.id::text) end)
      from (select 1) x
      left join servicios s on s.id = c.servicio_id
      left join barberos b on b.id = c.barbero_id
$$;

create or replace function public.panel_citas(p_desde date, p_hasta date, p_barbero text default null,
                                              p_estado text default null, p_busqueda text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
    v_texto text := nullif(trim(p_busqueda), '');
    v_digitos text := normalizar_telefono(p_busqueda);
begin
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return coalesce((
        select jsonb_agg(_cita_json(c) order by c.fecha, c.hora)
          from (select c.* from citas c
                 where c.fecha between p_desde and p_hasta
                   and (v_barbero is null or c.barbero_id::text = v_barbero)
                   and (nullif(p_estado, '') is null or _estado_visual(c) = p_estado)
                   and (v_texto is null or c.nombre_cliente ilike '%' || v_texto || '%'
                        or (v_digitos is not null and normalizar_telefono(c.telefono_cliente) like '%' || v_digitos || '%'))
                 order by c.fecha, c.hora
                 limit 3000) c), '[]'::jsonb);
end;
$$;

create or replace function public.panel_cita(p_cita text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_cita citas;
begin
    select * into v_cita from citas where id::text = p_cita;
    if not found or (v_rol = 'barbero' and v_cita.barbero_id::text is distinct from barbero_actual()) then
        raise exception 'cita_no_encontrada';
    end if;
    return _cita_json(v_cita) || jsonb_build_object(
        'historial', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.creado_en, 'accion', a.accion, 'rol', a.rol,
                                                                   'detalle', a.detalle, 'usuario_id', a.usuario_id) order by a.creado_en)
                                 from auditoria a where a.entidad = 'cita' and a.entidad_id = p_cita), '[]'::jsonb),
        'mensajes', case when v_rol = 'admin' then coalesce((
            select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'estado', m.estado, 'intentos', m.intentos,
                                                'error', m.ultimo_error, 'actualizado_en', m.actualizado_en) order by m.creado_en)
              from mensajes_whatsapp m where m.cita_id = p_cita), '[]'::jsonb) end);
end;
$$;

create or replace function public.panel_disponibilidad(p_barbero text, p_servicio text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_jornada record;
begin
    if v_rol = 'barbero' and p_barbero is distinct from barbero_actual() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into v_jornada from _jornada(p_barbero, p_fecha);
    return jsonb_build_object(
        'abre', to_char(v_jornada.abre, 'HH24:MI'), 'cierra', to_char(v_jornada.cierra, 'HH24:MI'),
        'horas', _horas_dia(p_servicio, p_barbero, p_fecha, nullif(p_excluir_cita, ''), false),
        'puede_realizar', _barbero_hace_servicio(p_barbero, p_servicio));
end;
$$;

create or replace function public.panel_crear_cita(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_nombre text := trim(p_datos ->> 'nombre');
    v_telefono text := trim(p_datos ->> 'telefono');
    v_tel text := normalizar_telefono(p_datos ->> 'telefono');
    v_servicio text := p_datos ->> 'servicio_id';
    v_barbero text := p_datos ->> 'barbero_id';
    v_fecha date := (p_datos ->> 'fecha')::date;
    v_hora time := (p_datos ->> 'hora')::time;
    v_estado text := coalesce(nullif(p_datos ->> 'estado', ''), 'confirmada');
    v_duracion int;
    v_id text;
begin
    perform _exigir_panel(true);
    if coalesce(length(v_nombre), 0) not between 1 and 120 or coalesce(length(v_tel), 0) not between 7 and 15 then
        raise exception 'datos_invalidos';
    end if;
    if v_estado not in ('pendiente', 'confirmada') or length(coalesce(p_datos ->> 'notas', '')) > 1000 then
        raise exception 'datos_invalidos';
    end if;
    select duracion_minutos into v_duracion from servicios where id::text = v_servicio and activo;
    if v_duracion is null then
        raise exception 'servicio_no_disponible';
    end if;
    if not exists (select 1 from barberos where id::text = v_barbero and activo is not false) then
        raise exception 'barbero_no_disponible';
    end if;
    if not _barbero_hace_servicio(v_barbero, v_servicio) then
        raise exception 'barbero_no_realiza_servicio';
    end if;
    perform _bloquear_agenda(v_barbero, v_fecha);
    if not _slot_libre(v_barbero, v_fecha, v_hora, v_duracion) then
        raise exception 'horario_no_disponible';
    end if;

    insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado, notas, origen, creada_por)
    select v_nombre, v_telefono, nullif(trim(p_datos ->> 'email'), ''), b.id, s.id, v_fecha, v_hora, v_estado,
           nullif(trim(p_datos ->> 'notas'), ''), 'admin', auth.uid()
      from barberos b, servicios s where b.id::text = v_barbero and s.id::text = v_servicio
    returning id::text into v_id;

    -- Una ficha por número (mismos últimos 10 dígitos aunque se escriba con o sin código de país)
    insert into clientes (telefono, nombre, actualizado_por)
    select v_tel, v_nombre, auth.uid()
     where not exists (select 1 from clientes where right(telefono, 10) = right(v_tel, 10))
    on conflict (telefono) do nothing;
    return panel_cita(v_id);
end;
$$;

create or replace function public.panel_actualizar_cita(p_cita text, p_accion text, p_datos jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_cita citas;
    v_barbero text;
    v_fecha date;
    v_hora time;
    v_monto numeric;
    v_metodo text;
    v_motivo text;
begin
    select * into v_cita from citas where id::text = p_cita for update;
    if not found or (v_rol = 'barbero' and v_cita.barbero_id::text is distinct from barbero_actual()) then
        raise exception 'cita_no_encontrada';
    end if;
    -- Rol barbero: solo operaciones de su agenda del día a día
    if v_rol = 'barbero' and p_accion not in ('confirmar', 'completar', 'no_asistio', 'notas') then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if p_accion <> 'notas' and v_cita.estado = 'cancelada' then
        raise exception 'cita_cancelada';
    end if;

    if p_accion = 'confirmar' then
        if v_cita.estado <> 'pendiente' then raise exception 'cita_no_pendiente'; end if;
        update citas set estado = 'confirmada' where id = v_cita.id;
    elsif p_accion = 'completar' then
        if v_cita.no_asistio_en is not null then raise exception 'cita_marcada_no_asistio'; end if;
        update citas set completada_en = coalesce(completada_en, now()) where id = v_cita.id;
    elsif p_accion = 'no_asistio' then
        if v_cita.completada_en is not null then raise exception 'cita_completada'; end if;
        if (v_cita.fecha + v_cita.hora) > _ahora_local() then raise exception 'cita_aun_no_ocurre'; end if;
        update citas set no_asistio_en = coalesce(no_asistio_en, now()) where id = v_cita.id;
    elsif p_accion = 'cancelar' then
        v_motivo := trim(p_datos ->> 'motivo');
        if coalesce(length(v_motivo), 0) not between 3 and 300 then raise exception 'motivo_requerido'; end if;
        if v_cita.completada_en is not null then raise exception 'cita_completada'; end if;
        update citas set estado = 'cancelada', motivo_cancelacion = v_motivo, cancelada_en = now(), cancelada_por = auth.uid()
         where id = v_cita.id;
    elsif p_accion = 'reprogramar' then
        if v_cita.completada_en is not null or v_cita.no_asistio_en is not null then raise exception 'cita_cerrada'; end if;
        v_fecha := (p_datos ->> 'fecha')::date;
        v_hora := (p_datos ->> 'hora')::time;
        v_barbero := coalesce(nullif(p_datos ->> 'barbero_id', ''), v_cita.barbero_id::text);
        if v_fecha is null or v_hora is null then raise exception 'datos_invalidos'; end if;
        if not exists (select 1 from barberos where id::text = v_barbero and activo is not false) then
            raise exception 'barbero_no_disponible';
        end if;
        if not _barbero_hace_servicio(v_barbero, v_cita.servicio_id::text) then raise exception 'barbero_no_realiza_servicio'; end if;
        perform _bloquear_agenda(v_barbero, v_fecha);
        if not _slot_libre(v_barbero, v_fecha, v_hora,
                           coalesce(v_cita.duracion_reservada, (select duracion_minutos from servicios where id = v_cita.servicio_id), 30),
                           p_cita) then
            raise exception 'horario_no_disponible';
        end if;
        update citas set fecha = v_fecha, hora = v_hora, barbero_id = b.id, cliente_confirmo_en = null
          from barberos b where b.id::text = v_barbero and citas.id = v_cita.id;
    elsif p_accion = 'notas' then
        if length(coalesce(p_datos ->> 'notas', '')) > 1000 then raise exception 'datos_invalidos'; end if;
        update citas set notas = nullif(trim(p_datos ->> 'notas'), '') where id = v_cita.id;
    elsif p_accion = 'registrar_pago' then
        v_monto := (p_datos ->> 'monto')::numeric;
        v_metodo := p_datos ->> 'metodo';
        if v_monto is null or v_monto < 0 or v_monto > 10000000 or v_metodo not in ('efectivo', 'tarjeta', 'transferencia', 'otro') then
            raise exception 'pago_invalido';
        end if;
        update citas set monto_cobrado = round(v_monto, 2), metodo_pago = v_metodo, pagada_en = now() where id = v_cita.id;
    elsif p_accion = 'anular_pago' then
        update citas set monto_cobrado = null, metodo_pago = null, pagada_en = null where id = v_cita.id;
    else
        raise exception 'accion_invalida';
    end if;
    return panel_cita(p_cita);
end;
$$;

create or replace function public.panel_resumen() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() end;
    v_ahora timestamp := _ahora_local();
    v_hoy date := _ahora_local()::date;
    v_mes date := date_trunc('month', _ahora_local())::date;
    v_res jsonb;
begin
    with c as (
        select c.*, _estado_visual(c) as ev from citas c
         where (v_barbero is null or c.barbero_id::text = v_barbero)
           and c.fecha between v_mes - 7 and v_hoy + 60
    )
    select jsonb_build_object(
        'rol', v_rol, 'hoy', v_hoy, 'ahora', to_char(v_ahora, 'HH24:MI'),
        'citas_hoy', (select count(*) from c where fecha = v_hoy and ev <> 'cancelada'),
        'pendientes_hoy', (select count(*) from c where fecha = v_hoy and ev = 'pendiente'),
        'proximas', (select count(*) from c where (fecha + hora) > v_ahora and fecha <= v_hoy + 7 and ev in ('pendiente', 'confirmada')),
        'canceladas_hoy', (select count(*) from c where fecha = v_hoy and ev = 'cancelada'),
        'canceladas_semana', (select count(*) from c where fecha between v_hoy - 6 and v_hoy and ev = 'cancelada'),
        'completadas_hoy', (select count(*) from c where fecha = v_hoy and ev = 'completada'),
        'completadas_mes', (select count(*) from c where fecha >= v_mes and fecha <= v_hoy and ev = 'completada'),
        'no_asistio_mes', (select count(*) from c where fecha >= v_mes and ev = 'no_asistio'),
        'cobrado_hoy', case when v_rol = 'admin' then (select coalesce(sum(monto_cobrado), 0) from c
                          where pagada_en is not null and (pagada_en at time zone _zona())::date = v_hoy) end,
        'cobrado_mes', case when v_rol = 'admin' then (select coalesce(sum(monto_cobrado), 0) from c
                          where pagada_en is not null and (pagada_en at time zone _zona())::date >= v_mes) end,
        'completadas_sin_cobrar', case when v_rol = 'admin' then (select count(*) from c where ev = 'completada' and pagada_en is null) end,
        'estimado_reservas', case when v_rol = 'admin' then (select coalesce(sum(coalesce(precio_final, 0) + coalesce(total_productos, 0)), 0) from c
                          where fecha >= v_hoy and ev in ('pendiente', 'confirmada') and pagada_en is null) end,
        'agenda_hoy', coalesce((select jsonb_agg(_cita_json(x) order by x.hora) from citas x
                                 where x.fecha = v_hoy and (v_barbero is null or x.barbero_id::text = v_barbero)), '[]'::jsonb),
        'siguientes', coalesce((select jsonb_agg(_cita_json(x) order by x.fecha, x.hora) from (
                                 select * from citas x where (x.fecha + x.hora) > v_ahora and x.estado <> 'cancelada'
                                    and x.completada_en is null and (v_barbero is null or x.barbero_id::text = v_barbero)
                                  order by x.fecha, x.hora limit 6) x), '[]'::jsonb))
      into v_res;
    return v_res;
end;
$$;

-- ==========================================
-- PANEL: HORARIOS Y DISPONIBILIDAD
-- ==========================================
create or replace function public.panel_horarios() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return jsonb_build_object(
        'reglas', (select jsonb_build_object(
            'zona_horaria', ajustes -> 'zona_horaria', 'hora_apertura', ajustes -> 'hora_apertura', 'hora_cierre', ajustes -> 'hora_cierre',
            'intervalo_minutos', ajustes -> 'intervalo_minutos', 'anticipacion_minima_minutos', ajustes -> 'anticipacion_minima_minutos',
            'max_dias_reserva', ajustes -> 'max_dias_reserva', 'minutos_entre_citas', ajustes -> 'minutos_entre_citas',
            'horas_minimas_cambio', ajustes -> 'horas_minimas_cambio')
            from modulos_config where modulo = 'general'),
        'semana', coalesce((select jsonb_agg(jsonb_build_object('barbero_id', barbero_id, 'dia', dia, 'activo', activo,
                    'abre', to_char(abre, 'HH24:MI'), 'cierra', to_char(cierra, 'HH24:MI')) order by barbero_id, dia)
                    from horarios_semana), '[]'::jsonb),
        'descansos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'barbero_id', barbero_id, 'dia', dia,
                    'desde', to_char(desde, 'HH24:MI'), 'hasta', to_char(hasta, 'HH24:MI')) order by dia, desde)
                    from descansos), '[]'::jsonb),
        'bloqueos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'barbero_id', barbero_id, 'fecha_desde', fecha_desde,
                    'fecha_hasta', fecha_hasta, 'hora_desde', to_char(hora_desde, 'HH24:MI'), 'hora_hasta', to_char(hora_hasta, 'HH24:MI'),
                    'tipo', tipo, 'motivo', motivo) order by fecha_desde, hora_desde)
                    from bloqueos where activo and fecha_hasta >= _ahora_local()::date - 30), '[]'::jsonb));
end;
$$;

create or replace function public.panel_guardar_reglas(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual jsonb;
    v_nuevo jsonb;
    v_clave text;
    v_rangos jsonb := '{"intervalo_minutos": [5, 240], "anticipacion_minima_minutos": [0, 20160],
                        "max_dias_reserva": [0, 365], "minutos_entre_citas": [0, 120], "horas_minimas_cambio": [0, 168]}';
begin
    perform _exigir_panel(true);
    select ajustes into v_actual from modulos_config where modulo = 'general' for update;
    v_nuevo := v_actual;
    for v_clave in select jsonb_object_keys(v_rangos) loop
        if p_datos ? v_clave then
            if jsonb_typeof(p_datos -> v_clave) <> 'number'
               or (p_datos ->> v_clave)::numeric <> round((p_datos ->> v_clave)::numeric)
               or (p_datos ->> v_clave)::int not between (v_rangos -> v_clave ->> 0)::int and (v_rangos -> v_clave ->> 1)::int then
                raise exception 'regla_invalida: %', v_clave;
            end if;
            v_nuevo := v_nuevo || jsonb_build_object(v_clave, (p_datos ->> v_clave)::int);
        end if;
    end loop;
    if p_datos ? 'hora_apertura' or p_datos ? 'hora_cierre' then
        if (coalesce(p_datos ->> 'hora_cierre', v_actual ->> 'hora_cierre'))::time
           <= (coalesce(p_datos ->> 'hora_apertura', v_actual ->> 'hora_apertura'))::time then
            raise exception 'regla_invalida: horario';
        end if;
        v_nuevo := v_nuevo || jsonb_build_object(
            'hora_apertura', to_char(coalesce(p_datos ->> 'hora_apertura', v_actual ->> 'hora_apertura')::time, 'HH24:MI'),
            'hora_cierre', to_char(coalesce(p_datos ->> 'hora_cierre', v_actual ->> 'hora_cierre')::time, 'HH24:MI'));
    end if;
    if p_datos ? 'zona_horaria' then
        perform now() at time zone (p_datos ->> 'zona_horaria');
        v_nuevo := v_nuevo || jsonb_build_object('zona_horaria', p_datos ->> 'zona_horaria');
    end if;
    update modulos_config set ajustes = v_nuevo, actualizado_en = now() where modulo = 'general';
    perform _auditar('reglas_reserva', 'configuracion', 'general', jsonb_build_object('antes', v_actual, 'despues', v_nuevo));
    return panel_horarios();
end;
$$;

-- p_dias: [{dia, activo, abre, cierra, descansos: [{desde, hasta}]}] ; p_dias = null restablece (usa el horario general)
create or replace function public.panel_guardar_semana(p_barbero text, p_dias jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_barbero text := coalesce(nullif(p_barbero, ''), '*');
    v_dia jsonb;
    v_descanso jsonb;
begin
    perform _exigir_panel(true);
    if v_barbero <> '*' and not exists (select 1 from barberos where id::text = v_barbero) then
        raise exception 'barbero_no_encontrado';
    end if;
    delete from horarios_semana where barbero_id = v_barbero;
    delete from descansos where coalesce(barbero_id, '*') = v_barbero;
    if p_dias is not null then
        for v_dia in select * from jsonb_array_elements(p_dias) loop
            if (v_dia ->> 'dia')::int not between 0 and 6
               or ((v_dia ->> 'activo')::boolean and (v_dia ->> 'cierra')::time <= (v_dia ->> 'abre')::time) then
                raise exception 'horario_invalido';
            end if;
            insert into horarios_semana (barbero_id, dia, activo, abre, cierra)
            values (v_barbero, (v_dia ->> 'dia')::int, (v_dia ->> 'activo')::boolean,
                    coalesce((v_dia ->> 'abre')::time, '09:00'), coalesce((v_dia ->> 'cierra')::time, '18:00'));
            for v_descanso in select * from jsonb_array_elements(coalesce(v_dia -> 'descansos', '[]'::jsonb)) loop
                if (v_descanso ->> 'hasta')::time <= (v_descanso ->> 'desde')::time then
                    raise exception 'descanso_invalido';
                end if;
                insert into descansos (barbero_id, dia, desde, hasta)
                values (nullif(v_barbero, '*'), (v_dia ->> 'dia')::int, (v_descanso ->> 'desde')::time, (v_descanso ->> 'hasta')::time);
            end loop;
        end loop;
    end if;
    perform _auditar('horario_semanal', 'horario', v_barbero, jsonb_build_object('dias', p_dias));
    return panel_horarios();
end;
$$;

create or replace function public.panel_guardar_bloqueo(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_bloqueo bloqueos;
    v_afectadas jsonb;
begin
    perform _exigir_panel(true);
    if nullif(p_datos ->> 'barbero_id', '') is not null and not exists (select 1 from barberos where id::text = p_datos ->> 'barbero_id') then
        raise exception 'barbero_no_encontrado';
    end if;
    if length(coalesce(p_datos ->> 'motivo', '')) > 200 then
        raise exception 'datos_invalidos';
    end if;
    insert into bloqueos (barbero_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, tipo, motivo, creado_por)
    values (nullif(p_datos ->> 'barbero_id', ''), (p_datos ->> 'fecha_desde')::date,
            coalesce((p_datos ->> 'fecha_hasta')::date, (p_datos ->> 'fecha_desde')::date),
            nullif(p_datos ->> 'hora_desde', '')::time, nullif(p_datos ->> 'hora_hasta', '')::time,
            coalesce(nullif(p_datos ->> 'tipo', ''), 'bloqueo'), nullif(trim(p_datos ->> 'motivo'), ''), auth.uid())
    returning * into v_bloqueo;

    -- Las citas ya reservadas no se cancelan solas: se informan para decidir caso por caso
    select coalesce(jsonb_agg(_cita_json(c) order by c.fecha, c.hora), '[]'::jsonb) into v_afectadas
      from citas c
      left join servicios s on s.id = c.servicio_id
     where c.estado <> 'cancelada' and c.completada_en is null
       and c.fecha between v_bloqueo.fecha_desde and v_bloqueo.fecha_hasta
       and (v_bloqueo.barbero_id is null or c.barbero_id::text = v_bloqueo.barbero_id)
       and (v_bloqueo.hora_desde is null or (c.hora < v_bloqueo.hora_hasta
            and v_bloqueo.hora_desde < c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30))));
    perform _auditar('bloqueo_creado', 'bloqueo', v_bloqueo.id::text, to_jsonb(v_bloqueo));
    return jsonb_build_object('id', v_bloqueo.id, 'citas_afectadas', v_afectadas);
end;
$$;

create or replace function public.panel_desactivar_bloqueo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    update bloqueos set activo = false where id = p_id and activo;
    if not found then raise exception 'bloqueo_no_encontrado'; end if;
    perform _auditar('bloqueo_desactivado', 'bloqueo', p_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end;
$$;

-- ==========================================
-- PANEL: SERVICIOS
-- ==========================================
create or replace function public._imagen_valida(p_url text) returns boolean
language sql immutable as $$
    select p_url is null or p_url = ''
        or (length(p_url) <= 900000 and (p_url ~ '^https://[^\s"''<>]+$' or p_url ~ '^assets/[A-Za-z0-9_./-]+$'
            or p_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'))
$$;

create or replace function public.panel_servicios() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'catalogo_id', s.catalogo_id, 'nombre', s.nombre, 'descripcion', s.descripcion, 'categoria', s.categoria,
        'imagen_url', s.imagen_url, 'precio', s.precio, 'duracion_minutos', s.duracion_minutos, 'activo', s.activo,
        'destacado', s.destacado, 'en_catalogo', s.en_catalogo, 'orden', s.orden,
        'barberos', coalesce((select jsonb_agg(sb.barbero_id) from servicio_barberos sb where sb.servicio_id = s.id::text), '[]'::jsonb),
        'citas_futuras', (select count(*) from citas c where c.servicio_id = s.id and c.estado <> 'cancelada' and c.fecha >= _ahora_local()::date))
        order by s.orden nulls last, s.catalogo_id nulls last, s.nombre) from servicios s), '[]'::jsonb);
end;
$$;

create or replace function public.panel_guardar_servicio(p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual servicios;
    v_id text := nullif(p_id, '');
    v_nombre text := trim(p_datos ->> 'nombre');
    v_barbero text;
begin
    perform _exigir_panel(true);
    if v_id is not null then
        select * into v_actual from servicios where id::text = v_id for update;
        if not found then raise exception 'servicio_no_encontrado'; end if;
    end if;
    if coalesce(length(v_nombre), 0) not between 1 and 120
       or length(coalesce(p_datos ->> 'descripcion', '')) > 600 or length(coalesce(p_datos ->> 'categoria', '')) > 40
       or coalesce((p_datos ->> 'precio')::numeric not between 0 and 1000000, true)
       or coalesce((p_datos ->> 'duracion_minutos')::int not between 5 and 480, true)
       or not _imagen_valida(p_datos ->> 'imagen_url') then
        raise exception 'servicio_invalido';
    end if;
    if exists (select 1 from servicios where lower(nombre) = lower(v_nombre) and id::text is distinct from v_id) then
        raise exception 'servicio_duplicado';
    end if;

    if v_id is null then
        insert into servicios (nombre, descripcion, categoria, imagen_url, precio, duracion_minutos, activo, destacado, en_catalogo, orden)
        values (v_nombre, nullif(trim(p_datos ->> 'descripcion'), ''), nullif(trim(p_datos ->> 'categoria'), ''),
                nullif(p_datos ->> 'imagen_url', ''), (p_datos ->> 'precio')::numeric, (p_datos ->> 'duracion_minutos')::int,
                coalesce((p_datos ->> 'activo')::boolean, true), coalesce((p_datos ->> 'destacado')::boolean, false), true,
                coalesce((select max(orden) from servicios), 0) + 1)
        returning id::text into v_id;
    else
        update servicios set nombre = v_nombre, descripcion = nullif(trim(p_datos ->> 'descripcion'), ''),
               categoria = nullif(trim(p_datos ->> 'categoria'), ''), imagen_url = nullif(p_datos ->> 'imagen_url', ''),
               precio = (p_datos ->> 'precio')::numeric, duracion_minutos = (p_datos ->> 'duracion_minutos')::int,
               activo = coalesce((p_datos ->> 'activo')::boolean, activo), destacado = coalesce((p_datos ->> 'destacado')::boolean, destacado),
               en_catalogo = coalesce((p_datos ->> 'en_catalogo')::boolean, en_catalogo)
         where id::text = v_id;
    end if;

    if p_datos ? 'barberos' then
        delete from servicio_barberos where servicio_id = v_id;
        for v_barbero in select jsonb_array_elements_text(p_datos -> 'barberos') loop
            if not exists (select 1 from barberos where id::text = v_barbero) then raise exception 'barbero_no_encontrado'; end if;
            insert into servicio_barberos (servicio_id, barbero_id) values (v_id, v_barbero) on conflict do nothing;
        end loop;
    end if;
    perform _auditar(case when p_id is null or p_id = '' then 'servicio_creado' else 'servicio_actualizado' end, 'servicio', v_id,
        jsonb_build_object('antes', case when v_actual.id is not null then jsonb_build_object('nombre', v_actual.nombre,
            'precio', v_actual.precio, 'duracion', v_actual.duracion_minutos, 'activo', v_actual.activo) end,
            'despues', p_datos - 'imagen_url'));
    return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.panel_ordenar_servicios(p_ids text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    update servicios s set orden = o.pos from unnest(p_ids) with ordinality as o(id, pos) where s.id::text = o.id;
    perform _auditar('servicios_ordenados', 'servicio', null, jsonb_build_object('orden', to_jsonb(p_ids)));
    return jsonb_build_object('ok', true);
end;
$$;

-- ==========================================
-- PANEL: BARBEROS
-- ==========================================
create or replace function public.panel_barberos() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id::text, 'nombre', b.nombre, 'especialidad', b.especialidad, 'foto_url', b.foto_url,
        'activo', b.activo is not false, 'orden', b.orden,
        'servicios', coalesce((select jsonb_agg(s.id::text) from servicios s where s.activo and _barbero_hace_servicio(b.id::text, s.id::text)), '[]'::jsonb),
        'usuario', (select u.email from barbero_usuarios bu join auth.users u on u.id = bu.user_id where bu.barbero_id = b.id::text limit 1),
        'citas_futuras', (select count(*) from citas c where c.barbero_id = b.id and c.estado <> 'cancelada' and c.fecha >= _ahora_local()::date))
        order by b.orden nulls last, b.nombre) from barberos b), '[]'::jsonb);
end;
$$;

-- p_datos.servicios (opcional): lista completa de servicios que el barbero puede realizar
create or replace function public.panel_guardar_barbero(p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id text := nullif(p_id, '');
    v_nombre text := trim(p_datos ->> 'nombre');
    v_antes jsonb;
    v_servicio record;
    v_quiere boolean;
    v_puede boolean;
begin
    perform _exigir_panel(true);
    if coalesce(length(v_nombre), 0) not between 1 and 80 or length(coalesce(p_datos ->> 'especialidad', '')) > 200
       or not _imagen_valida(p_datos ->> 'foto_url') then
        raise exception 'barbero_invalido';
    end if;
    if exists (select 1 from barberos where lower(nombre) = lower(v_nombre) and id::text is distinct from v_id) then
        raise exception 'barbero_duplicado';
    end if;
    if v_id is null then
        insert into barberos (nombre, especialidad, foto_url, activo, orden)
        values (v_nombre, nullif(trim(p_datos ->> 'especialidad'), ''), nullif(p_datos ->> 'foto_url', ''),
                coalesce((p_datos ->> 'activo')::boolean, true), coalesce((select max(orden) from barberos), 0) + 1)
        returning id::text into v_id;
    else
        select jsonb_build_object('nombre', nombre, 'activo', activo) into v_antes from barberos where id::text = v_id for update;
        if v_antes is null then raise exception 'barbero_no_encontrado'; end if;
        update barberos set nombre = v_nombre, especialidad = nullif(trim(p_datos ->> 'especialidad'), ''),
               foto_url = nullif(p_datos ->> 'foto_url', ''), activo = coalesce((p_datos ->> 'activo')::boolean, activo)
         where id::text = v_id;
    end if;

    if p_datos ? 'servicios' then
        for v_servicio in select id::text as id from servicios where activo loop
            v_quiere := p_datos -> 'servicios' ? v_servicio.id;
            v_puede := _barbero_hace_servicio(v_id, v_servicio.id);
            if v_quiere and not v_puede then
                insert into servicio_barberos (servicio_id, barbero_id) values (v_servicio.id, v_id) on conflict do nothing;
            elsif not v_quiere and v_puede then
                if not exists (select 1 from servicio_barberos where servicio_id = v_servicio.id) then
                    -- Hasta ahora lo hacían todos: queda limitado a los demás barberos activos
                    insert into servicio_barberos (servicio_id, barbero_id)
                    select v_servicio.id, b.id::text from barberos b where b.activo is not false and b.id::text <> v_id;
                end if;
                delete from servicio_barberos where servicio_id = v_servicio.id and barbero_id = v_id;
            end if;
        end loop;
    end if;
    perform _auditar(case when p_id is null or p_id = '' then 'barbero_creado' else 'barbero_actualizado' end, 'barbero', v_id,
        jsonb_build_object('antes', v_antes, 'despues', p_datos - 'foto_url'));
    return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.panel_vincular_usuario_barbero(p_barbero text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_usuario uuid;
begin
    perform _exigir_panel(true);
    if not exists (select 1 from barberos where id::text = p_barbero) then raise exception 'barbero_no_encontrado'; end if;
    delete from barbero_usuarios where barbero_id = p_barbero;
    if nullif(trim(p_email), '') is not null then
        select id into v_usuario from auth.users where lower(email) = lower(trim(p_email));
        if v_usuario is null then raise exception 'usuario_no_encontrado'; end if;
        insert into barbero_usuarios (user_id, barbero_id) values (v_usuario, p_barbero)
        on conflict (user_id) do update set barbero_id = excluded.barbero_id;
    end if;
    perform _auditar('acceso_barbero', 'barbero', p_barbero, jsonb_build_object('email', nullif(trim(p_email), '')));
    return jsonb_build_object('ok', true);
end;
$$;

-- ==========================================
-- PANEL: CLIENTES
-- ==========================================
create or replace function public.panel_clientes(p_busqueda text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_texto text := nullif(trim(p_busqueda), '');
    v_digitos text := normalizar_telefono(p_busqueda);
begin
    perform _exigir_panel(true);
    return coalesce((
        with base as (
            select right(normalizar_telefono(c.telefono_cliente), 10) as clave, c.*
              from citas c where normalizar_telefono(c.telefono_cliente) is not null
        ), grupos as (
            select clave,
                   (array_agg(nombre_cliente order by creado_en desc))[1] as ultimo_nombre,
                   (array_agg(normalizar_telefono(telefono_cliente) order by creado_en desc))[1] as telefono,
                   count(*) as total,
                   count(*) filter (where completada_en is not null) as completadas,
                   count(*) filter (where estado = 'cancelada') as canceladas,
                   count(*) filter (where no_asistio_en is not null) as ausencias,
                   max(fecha) filter (where completada_en is not null) as ultima_visita,
                   min(fecha) filter (where fecha >= _ahora_local()::date and estado <> 'cancelada') as proxima,
                   coalesce(sum(monto_cobrado) filter (where pagada_en is not null), 0) as cobrado,
                   count(distinct normalizar_telefono(telefono_cliente)) as variantes_tel,
                   count(distinct lower(trim(nombre_cliente))) as variantes_nombre,
                   jsonb_agg(distinct nombre_cliente) as nombres
              from base group by clave
        )
        select jsonb_agg(jsonb_build_object(
            'telefono', g.telefono, 'nombre', coalesce(cl.nombre, g.ultimo_nombre), 'total_citas', g.total,
            'completadas', g.completadas, 'canceladas', g.canceladas, 'ausencias', g.ausencias,
            'ultima_visita', g.ultima_visita, 'proxima_cita', g.proxima, 'cobrado', g.cobrado,
            'posible_duplicado', g.variantes_tel > 1 or g.variantes_nombre > 1, 'nombres', g.nombres,
            'consentimiento', coalesce(cc.consentimiento_marketing, false))
            order by g.ultima_visita desc nulls last, g.total desc)
          from grupos g
          left join lateral (select * from clientes x where right(x.telefono, 10) = g.clave order by x.actualizado_en desc limit 1) cl on true
          left join lateral (select * from clientes_contacto x where right(x.telefono, 10) = g.clave limit 1) cc on true
         where v_texto is null
            or coalesce(cl.nombre, g.ultimo_nombre) ilike '%' || v_texto || '%'
            or g.nombres::text ilike '%' || v_texto || '%'
            or (v_digitos is not null and g.clave like '%' || right(v_digitos, 10) || '%')
         limit 300), '[]'::jsonb);
end;
$$;

create or replace function public.panel_cliente(p_telefono text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_clave text := right(normalizar_telefono(p_telefono), 10);
begin
    perform _exigir_panel(true);
    if coalesce(length(v_clave), 0) < 7 then raise exception 'telefono_invalido'; end if;
    return jsonb_build_object(
        'telefono', normalizar_telefono(p_telefono),
        'ficha', (select to_jsonb(cl) from clientes cl where right(cl.telefono, 10) = v_clave limit 1),
        'consentimiento', (select jsonb_build_object('marketing', consentimiento_marketing, 'baja_en', baja_en)
                             from clientes_contacto where right(telefono, 10) = v_clave limit 1),
        'telefonos', (select jsonb_agg(distinct telefono_cliente) from citas where right(normalizar_telefono(telefono_cliente), 10) = v_clave),
        'nombres', (select jsonb_agg(distinct nombre_cliente) from citas where right(normalizar_telefono(telefono_cliente), 10) = v_clave),
        'historial', coalesce((select jsonb_agg(_cita_json(c) order by c.fecha desc, c.hora desc) from citas c
                                where right(normalizar_telefono(c.telefono_cliente), 10) = v_clave), '[]'::jsonb));
end;
$$;

create or replace function public.panel_guardar_cliente(p_telefono text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tel text := normalizar_telefono(p_telefono);
    v_nuevo_tel text := coalesce(normalizar_telefono(p_datos ->> 'telefono'), v_tel);
begin
    perform _exigir_panel(true);
    if coalesce(length(v_tel), 0) < 7 or length(v_nuevo_tel) not between 7 and 15
       or length(coalesce(p_datos ->> 'nombre', '')) not between 1 and 120 or length(coalesce(p_datos ->> 'notas', '')) > 1000
       or length(coalesce(p_datos ->> 'email', '')) > 160 then
        raise exception 'cliente_invalido';
    end if;
    delete from clientes where right(telefono, 10) = right(v_tel, 10) and telefono <> v_nuevo_tel;
    insert into clientes (telefono, nombre, email, notas, preferencias, actualizado_en, actualizado_por)
    values (v_nuevo_tel, trim(p_datos ->> 'nombre'), nullif(trim(p_datos ->> 'email'), ''), nullif(trim(p_datos ->> 'notas'), ''),
            coalesce(p_datos -> 'preferencias', '{}'::jsonb), now(), auth.uid())
    on conflict (telefono) do update set nombre = excluded.nombre, email = excluded.email, notas = excluded.notas,
        preferencias = excluded.preferencias, actualizado_en = now(), actualizado_por = auth.uid();
    -- Citas futuras con los datos corregidos; el historial pasado se conserva como se registró
    if coalesce((p_datos ->> 'actualizar_citas_futuras')::boolean, false) then
        update citas set nombre_cliente = trim(p_datos ->> 'nombre'),
               telefono_cliente = case when v_nuevo_tel <> v_tel then v_nuevo_tel else telefono_cliente end
         where right(normalizar_telefono(telefono_cliente), 10) = right(v_tel, 10)
           and fecha >= _ahora_local()::date and estado <> 'cancelada';
    end if;
    perform _auditar('cliente_actualizado', 'cliente', v_nuevo_tel, p_datos);
    return panel_cliente(v_nuevo_tel);
end;
$$;

-- ==========================================
-- PANEL: NEGOCIO, WHATSAPP, REPORTES Y AUDITORÍA
-- ==========================================
create or replace function public.panel_guardar_negocio(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_red text;
    v_item jsonb;
    v_linea text;
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

    insert into negocio_config (id, datos, actualizado_en, actualizado_por) values (true, p_datos, now(), auth.uid())
    on conflict (id) do update set datos = excluded.datos, actualizado_en = now(), actualizado_por = auth.uid();
    perform _auditar('negocio_publicado', 'configuracion', 'negocio', p_datos - 'logo_url' - 'portada_url');
    return negocio_publico();
end;
$$;

create or replace function public.panel_plantillas() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return jsonb_build_object(
        'plantillas', (select jsonb_agg(to_jsonb(p) order by array_position(array['confirmacion', 'recordatorio', 'cancelacion', 'reprogramacion'], p.tipo))
                         from plantillas_whatsapp p),
        'envio_automatico_activo', _modulo_activo('whatsapp'),
        'mensajes', (select jsonb_object_agg(estado, n) from (select estado, count(*) n from mensajes_whatsapp
                       where creado_en > now() - interval '30 days' group by estado) x));
end;
$$;

create or replace function public.panel_guardar_plantilla(p_tipo text, p_texto text, p_meta text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    if coalesce(length(trim(p_texto)), 0) not between 1 and 1000 or length(coalesce(p_meta, '')) > 100
       or coalesce(p_meta, '') !~ '^[a-z0-9_]*$' then
        raise exception 'plantilla_invalida';
    end if;
    update plantillas_whatsapp set texto = trim(p_texto), meta_plantilla = coalesce(p_meta, ''), actualizado_en = now() where tipo = p_tipo;
    if not found then raise exception 'plantilla_invalida'; end if;
    -- El recordatorio automático existente usa este nombre de plantilla
    if p_tipo = 'recordatorio' and coalesce(p_meta, '') <> '' then
        update modulos_config set ajustes = ajustes || jsonb_build_object('plantilla_recordatorio', p_meta) where modulo = 'whatsapp';
    end if;
    perform _auditar('plantilla_whatsapp', 'configuracion', p_tipo, jsonb_build_object('meta', p_meta));
    return panel_plantillas();
end;
$$;

create or replace function public.panel_reporte(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return (
        with c as (
            select c.*, _estado_visual(c) as ev, s.nombre as servicio, b.nombre as barbero
              from citas c left join servicios s on s.id = c.servicio_id left join barberos b on b.id = c.barbero_id
             where c.fecha between p_desde and p_hasta
        )
        select jsonb_build_object(
            'totales', jsonb_build_object(
                'citas', count(*), 'completadas', count(*) filter (where ev = 'completada'),
                'canceladas', count(*) filter (where ev = 'cancelada'), 'no_asistio', count(*) filter (where ev = 'no_asistio'),
                'pagadas', count(*) filter (where pagada_en is not null),
                'completadas_sin_cobrar', count(*) filter (where ev = 'completada' and pagada_en is null),
                'cobrado', coalesce(sum(monto_cobrado) filter (where pagada_en is not null), 0),
                'estimado', coalesce(sum(coalesce(precio_final, 0)) filter (where ev in ('pendiente', 'confirmada')), 0)),
            'por_dia', coalesce((select jsonb_agg(x order by x->>'fecha') from (select jsonb_build_object('fecha', fecha, 'citas', count(*),
                'completadas', count(*) filter (where ev = 'completada'), 'canceladas', count(*) filter (where ev = 'cancelada'),
                'no_asistio', count(*) filter (where ev = 'no_asistio'),
                'cobrado', coalesce(sum(monto_cobrado) filter (where pagada_en is not null), 0)) x from c group by fecha) d), '[]'::jsonb),
            'por_servicio', coalesce((select jsonb_agg(x order by (x->>'cobrado')::numeric desc) from (select jsonb_build_object('servicio', servicio,
                'citas', count(*), 'completadas', count(*) filter (where ev = 'completada'),
                'cobrado', coalesce(sum(monto_cobrado) filter (where pagada_en is not null), 0)) x from c group by servicio) d), '[]'::jsonb),
            'por_barbero', coalesce((select jsonb_agg(x order by (x->>'cobrado')::numeric desc) from (select jsonb_build_object('barbero', barbero,
                'citas', count(*), 'completadas', count(*) filter (where ev = 'completada'),
                'canceladas', count(*) filter (where ev = 'cancelada'), 'no_asistio', count(*) filter (where ev = 'no_asistio'),
                'cobrado', coalesce(sum(monto_cobrado) filter (where pagada_en is not null), 0)) x from c group by barbero) d), '[]'::jsonb),
            'por_metodo', coalesce((select jsonb_object_agg(metodo_pago, total) from (select metodo_pago, sum(monto_cobrado) total
                from c where pagada_en is not null group by metodo_pago) d), '{}'::jsonb),
            'incidencias', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'hora', to_char(hora, 'HH24:MI'),
                'cliente', nombre_cliente, 'telefono', telefono_cliente, 'servicio', servicio, 'barbero', barbero, 'tipo', ev,
                'motivo', motivo_cancelacion) order by fecha, hora) from c where ev in ('cancelada', 'no_asistio')), '[]'::jsonb))
          from c);
end;
$$;

create or replace function public.panel_auditoria(p_limite int default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('fecha', a.creado_en, 'accion', a.accion, 'entidad', a.entidad,
            'entidad_id', a.entidad_id, 'rol', a.rol, 'detalle', a.detalle,
            'usuario', (select email from auth.users u where u.id = a.usuario_id)) order by a.creado_en desc)
        from (select * from auditoria order by creado_en desc limit least(greatest(p_limite, 1), 500)) a), '[]'::jsonb);
end;
$$;

-- ==========================================
-- SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
    v_publicas text[] := array['catalogo_publico', 'barberos_publicos', 'negocio_publico'];
    v_panel text[] := array['rol_panel', 'barbero_actual', 'panel_citas', 'panel_cita', 'panel_disponibilidad', 'panel_crear_cita',
        'panel_actualizar_cita', 'panel_resumen', 'panel_horarios', 'panel_guardar_reglas', 'panel_guardar_semana',
        'panel_guardar_bloqueo', 'panel_desactivar_bloqueo', 'panel_servicios', 'panel_guardar_servicio', 'panel_ordenar_servicios',
        'panel_barberos', 'panel_guardar_barbero', 'panel_vincular_usuario_barbero', 'panel_clientes', 'panel_cliente',
        'panel_guardar_cliente', 'panel_guardar_negocio', 'panel_plantillas', 'panel_guardar_plantilla', 'panel_reporte',
        'panel_auditoria'];
    v_internas text[] := array['_rol_panel', '_exigir_panel', '_auditar', '_jornada', '_slot_libre', '_en_horario',
        '_barbero_hace_servicio', '_hora_publica_valida', '_resolver_servicio', '_cotizar', '_horas_dia', '_horas_libres',
        'tg_citas_panel_antes', 'tg_citas_panel_despues', '_encolar_aviso', '_estado_visual', '_cita_json', '_imagen_valida'];
begin
    foreach v_tabla in array array['horarios_semana', 'descansos', 'bloqueos', 'servicio_barberos', 'barbero_usuarios', 'clientes',
                                   'negocio_config', 'plantillas_whatsapp', 'auditoria'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_publicas || v_panel || v_internas) loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_publicas) loop
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_panel) loop
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;

-- Rol barbero: lectura de su propia agenda (las modificaciones van por panel_actualizar_cita)
drop policy if exists barbero_agenda on public.citas;
create policy barbero_agenda on public.citas for select to authenticated
    using (barbero_id::text = (select public.barbero_actual()));

notify pgrst, 'reload schema';
