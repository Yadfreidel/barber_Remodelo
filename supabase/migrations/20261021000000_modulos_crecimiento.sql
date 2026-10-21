-- =====================================================================
-- MÓDULOS DE CRECIMIENTO
-- WhatsApp, lista de espera, recuperación, referidos, productos y
-- promociones de horas vacías.
--
-- Migración ADITIVA: no elimina ni cambia columnas o datos existentes.
-- Todos los módulos quedan DESACTIVADOS (modulos_config.activo = false).
-- Los ids de barberos/servicios/citas se guardan como texto (id::text)
-- para no depender del tipo de clave de las tablas existentes.
-- =====================================================================

do $$
begin
    if to_regclass('public.citas') is null or to_regclass('public.barberos') is null or to_regclass('public.servicios') is null then
        raise exception 'Faltan las tablas base citas, barberos y servicios';
    end if;
    if (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'citas' and column_name = 'fecha') <> 'date'
       or (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'citas' and column_name = 'hora') not like 'time%' then
        raise exception 'Se esperaba citas.fecha de tipo date y citas.hora de tipo time';
    end if;
end $$;

-- ==========================================
-- CONFIGURACIÓN Y ADMINISTRADORES
-- ==========================================
create table if not exists public.modulos_config (
    modulo text primary key check (modulo in ('general', 'whatsapp', 'lista_espera', 'recuperacion', 'referidos', 'productos', 'promociones')),
    activo boolean not null default false,
    ajustes jsonb not null default '{}'::jsonb,
    actualizado_en timestamptz not null default now()
);

insert into public.modulos_config (modulo, activo, ajustes) values
    ('general', true, '{"zona_horaria": "America/Santo_Domingo", "hora_apertura": "09:00", "hora_cierre": "20:00", "intervalo_minutos": 60, "horas_minimas_cambio": 1, "url_publica": ""}'),
    ('whatsapp', false, '{"horas_antes": [24, 2], "max_intentos": 3, "codigo_pais": "1", "idioma": "es", "plantilla_recordatorio": "recordatorio_cita", "plantilla_oferta": "oferta_lista_espera", "plantilla_recuperacion": "recuperacion_cliente"}'),
    ('lista_espera', false, '{"minutos_vencimiento_oferta": 30, "max_dias_anticipacion": 30, "max_inscripciones_por_telefono": 3}'),
    ('recuperacion', false, '{"dias_inactividad": 45, "dias_entre_contactos": 30, "max_contactos": 3}'),
    ('referidos', false, '{"beneficio_tipo": "porcentaje", "beneficio_valor": 10, "acumulable_con_promocion": false}'),
    ('productos', false, '{"max_unidades_por_producto": 5}'),
    ('promociones', false, '{}')
on conflict (modulo) do nothing;

-- Usuarios de Supabase Auth con permisos de administrador (alta manual, ver supabase/README.md)
create table if not exists public.admin_usuarios (
    user_id uuid primary key,
    creado_en timestamptz not null default now()
);

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from admin_usuarios where user_id = auth.uid())
$$;

create or replace function public.normalizar_telefono(p text) returns text
language sql immutable as $$
    select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;

create or replace function public._mismo_telefono(a text, b text) returns boolean
language sql immutable as $$
    select right(normalizar_telefono(a), 10) = right(normalizar_telefono(b), 10)
$$;

create or replace function public._modulo_activo(p_modulo text) returns boolean
language sql stable set search_path = public, pg_temp as $$
    select coalesce((select activo from modulos_config where modulo = p_modulo), false)
$$;

create or replace function public._ajuste(p_modulo text, p_clave text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select ajustes -> p_clave from modulos_config where modulo = p_modulo
$$;

create or replace function public._zona() returns text
language sql stable set search_path = public, pg_temp as $$
    select coalesce(_ajuste('general', 'zona_horaria') ->> 0, 'America/Santo_Domingo')
$$;

create or replace function public._ahora_local() returns timestamp
language sql stable set search_path = public, pg_temp as $$
    select now() at time zone _zona()
$$;

-- ==========================================
-- COLUMNAS ADITIVAS EN CITAS
-- ==========================================
alter table public.citas
    add column if not exists cliente_confirmo_en timestamptz,
    add column if not exists completada_en timestamptz,
    add column if not exists pagada_en timestamptz,
    add column if not exists reembolsada_en timestamptz,
    add column if not exists precio_servicio numeric(10, 2),
    add column if not exists descuento numeric(10, 2),
    add column if not exists precio_final numeric(10, 2),
    add column if not exists promocion_id uuid,
    add column if not exists total_productos numeric(10, 2),
    add column if not exists origen text;

create index if not exists citas_id_texto_idx on public.citas ((id::text));
create index if not exists citas_telefono_norm_idx on public.citas (normalizar_telefono(telefono_cliente));

-- Token secreto por cita para enlaces de confirmar/cancelar/reprogramar.
-- Tabla aparte para no exponerlo en las lecturas públicas existentes de citas.
create table if not exists public.cita_tokens (
    cita_id text primary key,
    token uuid not null unique default gen_random_uuid(),
    creado_en timestamptz not null default now()
);

insert into public.cita_tokens (cita_id)
select id::text from public.citas
on conflict (cita_id) do nothing;

-- ==========================================
-- TABLAS DE LOS MÓDULOS
-- ==========================================
create table if not exists public.clientes_contacto (
    telefono text primary key,
    nombre text,
    consentimiento_marketing boolean not null default false,
    consentimiento_en timestamptz,
    baja_en timestamptz,
    token_baja uuid not null unique default gen_random_uuid(),
    ultimo_contacto_recuperacion timestamptz,
    contactos_recuperacion int not null default 0
);

create table if not exists public.mensajes_whatsapp (
    id uuid primary key default gen_random_uuid(),
    clave_idempotencia text not null unique,
    tipo text not null check (tipo in ('recordatorio', 'oferta_espera', 'recuperacion')),
    telefono text not null,
    cita_id text,
    oferta_id uuid,
    plantilla text not null,
    parametros jsonb not null default '[]'::jsonb,
    botones jsonb not null default '[]'::jsonb,
    programado_para timestamptz not null default now(),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'omitido')),
    intentos int not null default 0,
    ultimo_error text,
    proveedor_mensaje_id text,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists mensajes_whatsapp_pendientes_idx on public.mensajes_whatsapp (programado_para) where estado = 'pendiente';

create table if not exists public.webhook_eventos (
    id text primary key,
    recibido_en timestamptz not null default now(),
    resultado text
);

create table if not exists public.lista_espera (
    id uuid primary key default gen_random_uuid(),
    token uuid not null unique default gen_random_uuid(),
    nombre text not null,
    telefono text not null,
    email text,
    servicio_id text not null,
    barbero_id text,
    fecha_desde date not null,
    fecha_hasta date not null,
    hora_desde time not null,
    hora_hasta time not null,
    estado text not null default 'activa' check (estado in ('activa', 'ofertada', 'aceptada', 'cancelada', 'vencida')),
    creado_en timestamptz not null default now(),
    check (fecha_hasta >= fecha_desde),
    check (hora_hasta >= hora_desde)
);
create index if not exists lista_espera_activa_idx on public.lista_espera (creado_en) where estado = 'activa';

create table if not exists public.ofertas_espera (
    id uuid primary key default gen_random_uuid(),
    token uuid not null unique default gen_random_uuid(),
    lista_id uuid not null references public.lista_espera (id),
    barbero_id text not null,
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'vencida', 'rechazada', 'invalidada')),
    expira_en timestamptz not null,
    cita_id text,
    creado_en timestamptz not null default now()
);
-- Un solo ofrecimiento vigente por espacio y por inscripción
create unique index if not exists ofertas_espacio_vigente_uq on public.ofertas_espera (barbero_id, fecha, hora) where estado = 'pendiente';
create unique index if not exists ofertas_lista_vigente_uq on public.ofertas_espera (lista_id) where estado = 'pendiente';

create table if not exists public.referidos_codigos (
    telefono text primary key,
    codigo text not null unique,
    creado_en timestamptz not null default now()
);

create table if not exists public.referidos (
    id uuid primary key default gen_random_uuid(),
    codigo text not null,
    referidor_tel text not null,
    referido_tel text not null unique,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'otorgado', 'anulado', 'revertido')),
    cita_otorgamiento text,
    nota text,
    creado_en timestamptz not null default now(),
    otorgado_en timestamptz,
    check (referidor_tel <> referido_tel)
);

create table if not exists public.beneficios (
    id uuid primary key default gen_random_uuid(),
    telefono text not null,
    tipo text not null check (tipo in ('porcentaje', 'monto')),
    valor numeric(10, 2) not null check (valor > 0),
    estado text not null default 'disponible' check (estado in ('disponible', 'usado', 'anulado')),
    referido_id uuid unique references public.referidos (id),
    cita_uso text,
    creado_en timestamptz not null default now(),
    usado_en timestamptz
);

create table if not exists public.productos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text,
    precio numeric(10, 2) not null check (precio >= 0),
    stock int not null default 0 check (stock >= 0),
    activo boolean not null default false,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

create table if not exists public.cita_productos (
    id uuid primary key default gen_random_uuid(),
    cita_id text not null,
    producto_id uuid not null references public.productos (id),
    cantidad int not null check (cantidad > 0),
    precio_unitario numeric(10, 2) not null,
    subtotal numeric(10, 2) not null,
    estado text not null default 'reservado' check (estado in ('reservado', 'entregado', 'devuelto')),
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists cita_productos_cita_idx on public.cita_productos (cita_id);

create table if not exists public.promociones (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activa boolean not null default false,
    tipo text not null check (tipo in ('porcentaje', 'monto')),
    valor numeric(10, 2) not null check (valor > 0),
    fecha_desde date not null,
    fecha_hasta date not null,
    dias_semana int[],
    hora_desde time not null,
    hora_hasta time not null,
    servicio_id text,
    barbero_id text,
    max_usos int check (max_usos is null or max_usos > 0),
    usos int not null default 0 check (usos >= 0),
    creado_en timestamptz not null default now(),
    check (fecha_hasta >= fecha_desde),
    check (hora_hasta > hora_desde),
    check (tipo <> 'porcentaje' or valor <= 100)
);

-- ==========================================
-- DISPONIBILIDAD Y PRECIOS
-- ==========================================

-- Serializa las escrituras de agenda por barbero y día (transaccional)
create or replace function public._bloquear_agenda(p_barbero_id text, p_fecha date) returns void
language sql as $$
    select pg_advisory_xact_lock(hashtextextended('agenda:' || p_barbero_id || ':' || p_fecha::text, 0))
$$;

create or replace function public._en_horario(p_hora time, p_duracion int) returns boolean
language sql stable set search_path = public, pg_temp as $$
    select p_hora >= g.apertura
       and p_hora + make_interval(mins => p_duracion) > p_hora
       and p_hora + make_interval(mins => p_duracion) <= g.cierre
       and (extract(epoch from (p_hora - g.apertura))::int / 60) % g.intervalo = 0
    from (
        select (ajustes ->> 'hora_apertura')::time as apertura,
               (ajustes ->> 'hora_cierre')::time as cierre,
               greatest(coalesce((ajustes ->> 'intervalo_minutos')::int, 60), 5) as intervalo
        from modulos_config where modulo = 'general'
    ) g
$$;

-- Verifica solapamiento real usando la duración de cada servicio
create or replace function public._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean
language sql stable set search_path = public, pg_temp as $$
    select not exists (
        select 1
        from citas c
        left join servicios s on s.id::text = c.servicio_id::text
        where c.barbero_id::text = p_barbero_id
          and c.fecha = p_fecha
          and c.estado <> 'cancelada'
          and (p_excluir_cita is null or c.id::text <> p_excluir_cita)
          and c.hora < p_hora + make_interval(mins => p_duracion)
          and p_hora < c.hora + make_interval(mins => coalesce(s.duracion_minutos, 30))
    )
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

    v_disponible := (p_fecha + p_hora) > _ahora_local()
        and _en_horario(p_hora, v_duracion)
        and _slot_libre(p_barbero_id, p_fecha, p_hora, v_duracion, p_excluir_cita);

    -- Una sola promoción por cita (la de mayor descuento): no se acumulan
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

create or replace function public._aplicar_promocion(p_id uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
    update promociones set usos = usos + 1
     where id = p_id and activa and (max_usos is null or usos < max_usos);
    if not found then
        raise exception 'promocion_no_disponible';
    end if;
end;
$$;

create or replace function public._liberar_promocion(p_id uuid) returns void
language sql set search_path = public, pg_temp as $$
    update promociones set usos = greatest(usos - 1, 0) where id = p_id
$$;

create or replace function public._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = public, pg_temp as $$
    select id::text from servicios where nombre = p_nombre limit 1
$$;

create or replace function public._resolver_barbero(p_nombre text) returns text
language sql stable set search_path = public, pg_temp as $$
    select id::text from barberos where nombre = p_nombre and activo is not false limit 1
$$;

-- Inserta la cita con los precios ya validados en servidor
create or replace function public._crear_cita(p_nombre text, p_telefono text, p_email text, p_cotizacion jsonb, p_fecha date, p_hora time, p_origen text)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare
    v_id text;
    v_promo uuid := (p_cotizacion ->> 'promocion_id')::uuid;
begin
    insert into citas (nombre_cliente, telefono_cliente, email, barbero_id, servicio_id, fecha, hora, estado,
                       precio_servicio, descuento, precio_final, promocion_id, origen)
    select p_nombre, p_telefono, coalesce(p_email, ''), b.id, s.id, p_fecha, p_hora, 'pendiente',
           (p_cotizacion ->> 'precio_base')::numeric, (p_cotizacion ->> 'descuento')::numeric,
           (p_cotizacion ->> 'precio_final')::numeric, v_promo, p_origen
      from barberos b, servicios s
     where b.id::text = p_cotizacion ->> 'barbero_id' and s.id::text = p_cotizacion ->> 'servicio_id'
    returning id::text into v_id;

    if v_id is null then
        raise exception 'servicio_o_barbero_no_encontrado';
    end if;
    if v_promo is not null then
        perform _aplicar_promocion(v_promo);
    end if;
    return v_id;
end;
$$;

-- ==========================================
-- MENSAJERÍA (cola idempotente)
-- ==========================================
create or replace function public._enlace(p_param text, p_token uuid) returns text
language sql stable set search_path = public, pg_temp as $$
    select case when coalesce(_ajuste('general', 'url_publica') ->> 0, '') = '' then ''
                else (_ajuste('general', 'url_publica') ->> 0) || '?' || p_param || '=' || p_token::text end
$$;

create or replace function public._encolar_mensaje(p_clave text, p_tipo text, p_telefono text, p_cita_id text, p_oferta_id uuid,
                                                   p_plantilla text, p_parametros jsonb, p_botones jsonb)
returns void
language plpgsql set search_path = public, pg_temp as $$
begin
    if not _modulo_activo('whatsapp') then
        return;
    end if;
    insert into mensajes_whatsapp (clave_idempotencia, tipo, telefono, cita_id, oferta_id, plantilla, parametros, botones)
    values (p_clave, p_tipo, p_telefono, p_cita_id, p_oferta_id, p_plantilla, p_parametros, p_botones)
    on conflict (clave_idempotencia) do nothing;
end;
$$;

-- ==========================================
-- LISTA DE ESPERA
-- ==========================================

-- Ofrece un espacio liberado a la primera inscripción compatible
create or replace function public._ofrecer_espacio(p_barbero_id text, p_fecha date, p_hora time) returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare
    v_entrada record;
    v_oferta record;
    v_minutos int := coalesce((_ajuste('lista_espera', 'minutos_vencimiento_oferta'))::int, 30);
    v_inicio timestamptz := (p_fecha + p_hora) at time zone _zona();
begin
    if not _modulo_activo('lista_espera') or v_inicio <= now() then
        return null;
    end if;
    if exists (select 1 from ofertas_espera where barbero_id = p_barbero_id and fecha = p_fecha and hora = p_hora and estado = 'pendiente') then
        return null;
    end if;

    select le.* into v_entrada
      from lista_espera le
      join servicios s on s.id::text = le.servicio_id
     where le.estado = 'activa'
       and p_fecha between le.fecha_desde and le.fecha_hasta
       and p_hora between le.hora_desde and le.hora_hasta
       and (le.barbero_id is null or le.barbero_id = p_barbero_id)
       and _en_horario(p_hora, coalesce(s.duracion_minutos, 30))
       and _slot_libre(p_barbero_id, p_fecha, p_hora, coalesce(s.duracion_minutos, 30))
       and not exists (select 1 from ofertas_espera o
                        where o.lista_id = le.id and o.barbero_id = p_barbero_id and o.fecha = p_fecha and o.hora = p_hora)
     order by le.creado_en, le.id
     limit 1
     for update of le skip locked;

    if not found then
        return null;
    end if;

    insert into ofertas_espera (lista_id, barbero_id, fecha, hora, expira_en)
    values (v_entrada.id, p_barbero_id, p_fecha, p_hora, least(now() + make_interval(mins => v_minutos), v_inicio))
    returning * into v_oferta;

    update lista_espera set estado = 'ofertada' where id = v_entrada.id;

    perform _encolar_mensaje(
        'oferta:' || v_oferta.id, 'oferta_espera', v_entrada.telefono, null, v_oferta.id,
        coalesce(_ajuste('whatsapp', 'plantilla_oferta') ->> 0, 'oferta_lista_espera'),
        jsonb_build_array(v_entrada.nombre, to_char(p_fecha, 'DD/MM/YYYY'), to_char(p_hora, 'HH24:MI'),
                          v_minutos::text, _enlace('oferta', v_oferta.token)),
        jsonb_build_array('ACEPTAR:' || v_oferta.token));
    return v_oferta.id;
end;
$$;

-- Cierra una oferta y pasa el espacio al siguiente en la lista
create or replace function public._cerrar_oferta(p_oferta_id uuid, p_estado text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
    v_oferta record;
begin
    update ofertas_espera set estado = p_estado where id = p_oferta_id and estado = 'pendiente' returning * into v_oferta;
    if not found then
        return;
    end if;
    update lista_espera
       set estado = case when fecha_hasta >= _ahora_local()::date then 'activa' else 'vencida' end
     where id = v_oferta.lista_id and estado = 'ofertada';
    perform _ofrecer_espacio(v_oferta.barbero_id, v_oferta.fecha, v_oferta.hora);
end;
$$;

-- ==========================================
-- REFERIDOS
-- ==========================================
create or replace function public._registrar_referido(p_telefono text, p_codigo text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
    v_referidor text;
begin
    if not _modulo_activo('referidos') then
        return 'referidos_inactivo';
    end if;
    select telefono into v_referidor from referidos_codigos where codigo = upper(trim(p_codigo));
    if not found then
        return 'codigo_invalido';
    end if;
    if right(v_referidor, 10) = right(p_telefono, 10) then
        return 'autorreferido_no_permitido';
    end if;
    if exists (select 1 from citas where normalizar_telefono(telefono_cliente) = p_telefono and pagada_en is not null) then
        return 'cliente_no_nuevo';
    end if;
    insert into referidos (codigo, referidor_tel, referido_tel)
    values (upper(trim(p_codigo)), v_referidor, p_telefono)
    on conflict (referido_tel) do nothing;
    if not found then
        return 'ya_referido';
    end if;
    return null;
end;
$$;

-- Otorga el beneficio una sola vez: primera visita completada y pagada del referido
create or replace function public._otorgar_referido(p_cita_id text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
    v_tel text;
    v_ref record;
begin
    select normalizar_telefono(telefono_cliente) into v_tel from citas where id::text = p_cita_id;
    select * into v_ref from referidos where referido_tel = v_tel and estado = 'pendiente' for update;
    if not found then
        return;
    end if;
    if exists (select 1 from citas where normalizar_telefono(telefono_cliente) = v_tel
               and id::text <> p_cita_id and pagada_en is not null) then
        update referidos set estado = 'anulado', nota = 'no_es_primera_visita_pagada' where id = v_ref.id;
        return;
    end if;
    update referidos set estado = 'otorgado', otorgado_en = now(), cita_otorgamiento = p_cita_id where id = v_ref.id;
    insert into beneficios (telefono, tipo, valor, referido_id)
    values (v_ref.referidor_tel,
            coalesce(_ajuste('referidos', 'beneficio_tipo') ->> 0, 'porcentaje'),
            coalesce((_ajuste('referidos', 'beneficio_valor'))::numeric, 10),
            v_ref.id)
    on conflict (referido_id) do nothing;
end;
$$;

-- Reembolso de la visita que generó el beneficio: se anula si no se ha usado.
-- Si ya se usó, no se recupera (queda registrado en la nota).
create or replace function public._revertir_referido(p_cita_id text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
    v_ref record;
begin
    select * into v_ref from referidos where cita_otorgamiento = p_cita_id and estado = 'otorgado' for update;
    if not found then
        return;
    end if;
    update beneficios set estado = 'anulado' where referido_id = v_ref.id and estado = 'disponible';
    if found then
        update referidos set estado = 'revertido', nota = 'reembolso' where id = v_ref.id;
    else
        update referidos set nota = 'reembolso_con_beneficio_ya_usado' where id = v_ref.id;
    end if;
end;
$$;

-- ==========================================
-- TRIGGERS SOBRE CITAS
-- ==========================================
create or replace function public.tg_citas_bloquear_agenda() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _bloquear_agenda(new.barbero_id::text, new.fecha);
    return new;
end;
$$;

create or replace function public.tg_citas_token() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    insert into cita_tokens (cita_id) values (new.id::text) on conflict (cita_id) do nothing;
    return new;
end;
$$;

create or replace function public.tg_citas_modulos() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id text := new.id::text;
    v_item record;
    v_liberar boolean := false;
begin
    if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
        -- Devolución de stock en orden fijo para evitar bloqueos cruzados
        for v_item in select * from cita_productos where cita_id = v_id and estado = 'reservado' order by producto_id for update loop
            update productos set stock = stock + v_item.cantidad, actualizado_en = now() where id = v_item.producto_id;
            update cita_productos set estado = 'devuelto', actualizado_en = now() where id = v_item.id;
        end loop;
        if new.promocion_id is not null then
            perform _liberar_promocion(new.promocion_id);
        end if;
        update mensajes_whatsapp set estado = 'omitido', ultimo_error = 'cita_cancelada', actualizado_en = now()
         where cita_id = v_id and tipo = 'recordatorio' and estado = 'pendiente';
        v_liberar := true;
    elsif new.estado <> 'cancelada'
          and (new.fecha, new.hora, new.barbero_id::text) is distinct from (old.fecha, old.hora, old.barbero_id::text) then
        update mensajes_whatsapp set estado = 'omitido', ultimo_error = 'cita_reprogramada', actualizado_en = now()
         where cita_id = v_id and tipo = 'recordatorio' and estado = 'pendiente';
        v_liberar := true;
    end if;

    if v_liberar then
        -- La lista de espera nunca debe impedir una cancelación o reprogramación
        begin
            perform _ofrecer_espacio(old.barbero_id::text, old.fecha, old.hora);
        exception when others then
            raise warning 'lista_espera: no se pudo ofrecer el espacio: %', sqlerrm;
        end;
    end if;

    if new.completada_en is not null and new.pagada_en is not null
       and (old.completada_en is null or old.pagada_en is null) and new.reembolsada_en is null then
        update clientes_contacto set contactos_recuperacion = 0 where telefono = normalizar_telefono(new.telefono_cliente);
        perform _otorgar_referido(v_id);
    end if;

    if new.reembolsada_en is not null and old.reembolsada_en is null then
        perform _revertir_referido(v_id);
    end if;
    return new;
end;
$$;

drop trigger if exists citas_bloquear_agenda on public.citas;
create trigger citas_bloquear_agenda before insert or update of barbero_id, fecha, hora on public.citas
    for each row execute function public.tg_citas_bloquear_agenda();

drop trigger if exists citas_token on public.citas;
create trigger citas_token after insert on public.citas
    for each row execute function public.tg_citas_token();

drop trigger if exists citas_modulos on public.citas;
create trigger citas_modulos after update on public.citas
    for each row execute function public.tg_citas_modulos();

-- ==========================================
-- API PÚBLICA (cliente web, rol anon)
-- ==========================================
create or replace function public.config_publica() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'instalado', true,
        'modulos', (select jsonb_object_agg(modulo, activo) from modulos_config where modulo <> 'general'),
        'general', (select jsonb_build_object('hora_apertura', ajustes -> 'hora_apertura', 'hora_cierre', ajustes -> 'hora_cierre',
                                              'intervalo_minutos', ajustes -> 'intervalo_minutos') from modulos_config where modulo = 'general'),
        'lista_espera', (select jsonb_build_object('max_dias_anticipacion', ajustes -> 'max_dias_anticipacion',
                                                   'minutos_vencimiento_oferta', ajustes -> 'minutos_vencimiento_oferta') from modulos_config where modulo = 'lista_espera'),
        'productos', (select jsonb_build_object('max_unidades_por_producto', ajustes -> 'max_unidades_por_producto') from modulos_config where modulo = 'productos'),
        'referidos', (select jsonb_build_object('beneficio_tipo', ajustes -> 'beneficio_tipo', 'beneficio_valor', ajustes -> 'beneficio_valor') from modulos_config where modulo = 'referidos')
    )
$$;

create or replace function public.listar_productos() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when not _modulo_activo('productos') then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'descripcion', descripcion, 'precio', precio, 'stock', stock) order by nombre)
          from productos where activo
    ), '[]'::jsonb) end
$$;

create or replace function public.cotizar_cita(p_servicio text, p_barbero text, p_fecha date, p_hora time) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_servicio text := _resolver_servicio(p_servicio);
    v_barbero text := _resolver_barbero(p_barbero);
begin
    if v_servicio is null or v_barbero is null then
        raise exception 'servicio_o_barbero_no_encontrado';
    end if;
    return _cotizar(v_servicio, v_barbero, p_fecha, p_hora);
end;
$$;

-- Horas libres considerando duración del servicio (opcionalmente excluyendo una cita que se reprograma)
create or replace function public._horas_libres(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(to_char(h, 'HH24:MI') order by h), '[]'::jsonb)
      from modulos_config g,
           lateral (select coalesce(duracion_minutos, 30) as dur from servicios where id::text = p_servicio_id) s,
           lateral generate_series(
               p_fecha + (g.ajustes ->> 'hora_apertura')::time,
               p_fecha + (g.ajustes ->> 'hora_cierre')::time - interval '1 minute',
               make_interval(mins => greatest(coalesce((g.ajustes ->> 'intervalo_minutos')::int, 60), 5))) h
     where g.modulo = 'general'
       and h > _ahora_local()
       and _en_horario(h::time, s.dur)
       and _slot_libre(p_barbero_id, p_fecha, h::time, s.dur, p_excluir_cita)
$$;

create or replace function public.horarios_disponibles(p_servicio text, p_barbero text, p_fecha date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select _horas_libres(_resolver_servicio(p_servicio), _resolver_barbero(p_barbero), p_fecha)
$$;

create or replace function public.reservar_cita(
    p_nombre text, p_email text, p_telefono text, p_servicio text, p_barbero text, p_fecha date, p_hora time,
    p_productos jsonb default '[]'::jsonb, p_codigo_referido text default null,
    p_consentimiento boolean default false, p_precio_esperado numeric default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tel text := normalizar_telefono(p_telefono);
    v_servicio text := _resolver_servicio(p_servicio);
    v_barbero text := _resolver_barbero(p_barbero);
    v_cotizacion jsonb;
    v_cita text;
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

    perform _bloquear_agenda(v_barbero, p_fecha);
    v_cotizacion := _cotizar(v_servicio, v_barbero, p_fecha, p_hora);
    if not (v_cotizacion ->> 'disponible')::boolean then
        raise exception 'horario_no_disponible';
    end if;
    if p_precio_esperado is not null and p_precio_esperado <> (v_cotizacion ->> 'precio_final')::numeric then
        raise exception 'precio_cambiado';
    end if;

    v_cita := _crear_cita(trim(p_nombre), trim(p_telefono), p_email, v_cotizacion, p_fecha, p_hora, 'web');

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
        'avisos', v_avisos);
end;
$$;

create or replace function public._cita_por_token(p_token uuid) returns text
language sql stable set search_path = public, pg_temp as $$
    select cita_id from cita_tokens where token = p_token
$$;

create or replace function public.consultar_cita(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v record;
    v_tel text;
begin
    select c.*, s.nombre as servicio_nombre, b.nombre as barbero_nombre into v
      from citas c
      left join servicios s on s.id::text = c.servicio_id::text
      left join barberos b on b.id::text = c.barbero_id::text
     where c.id::text = _cita_por_token(p_token);
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    v_tel := normalizar_telefono(v.telefono_cliente);
    return jsonb_build_object(
        'nombre', v.nombre_cliente, 'servicio', v.servicio_nombre, 'barbero', v.barbero_nombre,
        'fecha', v.fecha, 'hora', to_char(v.hora, 'HH24:MI'), 'estado', v.estado,
        'cliente_confirmo', v.cliente_confirmo_en is not null,
        'completada', v.completada_en is not null,
        'precio_base', v.precio_servicio, 'descuento', v.descuento, 'precio_final', v.precio_final,
        'total_productos', v.total_productos,
        'modificable', v.estado <> 'cancelada' and v.completada_en is null
            and (v.fecha + v.hora) - _ahora_local() >= make_interval(hours => coalesce((_ajuste('general', 'horas_minimas_cambio'))::int, 1)),
        'productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'cantidad', cp.cantidad, 'subtotal', cp.subtotal, 'estado', cp.estado))
                                 from cita_productos cp join productos p on p.id = cp.producto_id where cp.cita_id = v.id::text), '[]'::jsonb),
        'beneficios', case when _modulo_activo('referidos') then coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'valor', valor))
                                 from beneficios where telefono = v_tel and estado = 'disponible'), '[]'::jsonb) else '[]'::jsonb end,
        'referidos_activo', _modulo_activo('referidos'));
end;
$$;

-- Bloquea la cita del token y valida que todavía se pueda modificar
create or replace function public._cita_modificable(p_token uuid, out id text, out barbero_id text, out servicio_id text,
                                                    out estado text, out fecha date, out hora time, out promocion_id uuid,
                                                    out completada_en timestamptz)
language plpgsql set search_path = public, pg_temp as $$
begin
    select c.id::text, c.barbero_id::text, c.servicio_id::text, c.estado, c.fecha, c.hora, c.promocion_id, c.completada_en
      into id, barbero_id, servicio_id, estado, fecha, hora, promocion_id, completada_en
      from citas c where c.id::text = _cita_por_token(p_token)
       for update;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
end;
$$;

create or replace function public._validar_plazo(p_fecha date, p_hora time) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if (p_fecha + p_hora) - _ahora_local() < make_interval(hours => coalesce((_ajuste('general', 'horas_minimas_cambio'))::int, 1)) then
        raise exception 'fuera_de_plazo';
    end if;
end;
$$;

create or replace function public.confirmar_cita(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v record;
begin
    select * into v from _cita_modificable(p_token);
    if v.estado = 'cancelada' then
        raise exception 'cita_cancelada';
    end if;
    update citas set cliente_confirmo_en = coalesce(cliente_confirmo_en, now()) where id::text = v.id;
    return jsonb_build_object('ok', true, 'estado', v.estado, 'cliente_confirmo', true);
end;
$$;

create or replace function public.cancelar_cita(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v record;
begin
    select * into v from _cita_modificable(p_token);
    if v.estado = 'cancelada' then
        return jsonb_build_object('ok', true, 'estado', 'cancelada');
    end if;
    if v.completada_en is not null then
        raise exception 'cita_completada';
    end if;
    perform _validar_plazo(v.fecha, v.hora);
    update citas set estado = 'cancelada' where id::text = v.id;
    return jsonb_build_object('ok', true, 'estado', 'cancelada');
end;
$$;

create or replace function public.horarios_reprogramacion(p_token uuid, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_id text := _cita_por_token(p_token);
    v record;
begin
    select barbero_id::text as barbero_id, servicio_id::text as servicio_id into v from citas where id::text = v_id;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    return _horas_libres(v.servicio_id, v.barbero_id, p_fecha, v_id);
end;
$$;

create or replace function public.cotizar_reprogramacion(p_token uuid, p_fecha date, p_hora time) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_id text := _cita_por_token(p_token);
    v record;
begin
    select barbero_id::text as barbero_id, servicio_id::text as servicio_id into v from citas where id::text = v_id;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    return _cotizar(v.servicio_id, v.barbero_id, p_fecha, p_hora, v_id);
end;
$$;

create or replace function public.reprogramar_cita(p_token uuid, p_fecha date, p_hora time, p_precio_esperado numeric default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v record;
    v_cotizacion jsonb;
    v_promo uuid;
begin
    select * into v from _cita_modificable(p_token);
    if v.estado = 'cancelada' then
        raise exception 'cita_cancelada';
    end if;
    if v.completada_en is not null then
        raise exception 'cita_completada';
    end if;
    perform _validar_plazo(v.fecha, v.hora);

    perform _bloquear_agenda(v.barbero_id, p_fecha);
    v_cotizacion := _cotizar(v.servicio_id, v.barbero_id, p_fecha, p_hora, v.id);
    if not (v_cotizacion ->> 'disponible')::boolean then
        raise exception 'horario_no_disponible';
    end if;
    if p_precio_esperado is not null and p_precio_esperado <> (v_cotizacion ->> 'precio_final')::numeric then
        raise exception 'precio_cambiado';
    end if;

    v_promo := (v_cotizacion ->> 'promocion_id')::uuid;
    if v_promo is distinct from v.promocion_id then
        if v_promo is not null then
            perform _aplicar_promocion(v_promo);
        end if;
        if v.promocion_id is not null then
            perform _liberar_promocion(v.promocion_id);
        end if;
    end if;

    update citas
       set fecha = p_fecha, hora = p_hora, cliente_confirmo_en = null,
           precio_servicio = (v_cotizacion ->> 'precio_base')::numeric,
           descuento = (v_cotizacion ->> 'descuento')::numeric,
           precio_final = (v_cotizacion ->> 'precio_final')::numeric,
           promocion_id = v_promo
     where id::text = v.id;
    return jsonb_build_object('ok', true, 'fecha', p_fecha, 'hora', to_char(p_hora, 'HH24:MI'),
                              'precio_final', v_cotizacion -> 'precio_final');
end;
$$;

create or replace function public.unirse_lista_espera(
    p_nombre text, p_telefono text, p_email text, p_servicio text, p_barbero text,
    p_fecha_desde date, p_fecha_hasta date, p_hora_desde time, p_hora_hasta time)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tel text := normalizar_telefono(p_telefono);
    v_servicio text := _resolver_servicio(p_servicio);
    v_barbero text;
    v_hoy date := _ahora_local()::date;
    v_token uuid;
begin
    if not _modulo_activo('lista_espera') then
        raise exception 'modulo_inactivo';
    end if;
    if coalesce(trim(p_nombre), '') = '' or coalesce(length(v_tel), 0) < 7 then
        raise exception 'datos_invalidos';
    end if;
    if v_servicio is null then
        raise exception 'servicio_o_barbero_no_encontrado';
    end if;
    if nullif(trim(p_barbero), '') is not null then
        v_barbero := _resolver_barbero(p_barbero);
        if v_barbero is null then
            raise exception 'servicio_o_barbero_no_encontrado';
        end if;
    end if;
    if p_fecha_desde < v_hoy or p_fecha_hasta < p_fecha_desde or p_hora_hasta < p_hora_desde
       or p_fecha_hasta > v_hoy + coalesce((_ajuste('lista_espera', 'max_dias_anticipacion'))::int, 30) then
        raise exception 'preferencias_invalidas';
    end if;

    -- Serializa por teléfono para que el límite no se pueda saltar en paralelo
    perform pg_advisory_xact_lock(hashtextextended('espera:' || v_tel, 0));
    if (select count(*) from lista_espera where telefono = v_tel and estado in ('activa', 'ofertada'))
       >= coalesce((_ajuste('lista_espera', 'max_inscripciones_por_telefono'))::int, 3) then
        raise exception 'limite_lista_espera';
    end if;

    insert into lista_espera (nombre, telefono, email, servicio_id, barbero_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta)
    values (trim(p_nombre), v_tel, p_email, v_servicio, v_barbero, p_fecha_desde, p_fecha_hasta, p_hora_desde, p_hora_hasta)
    returning token into v_token;
    return jsonb_build_object('token', v_token, 'estado', 'activa');
end;
$$;

create or replace function public.consultar_lista_espera(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v record;
begin
    select le.*, s.nombre as servicio_nombre, b.nombre as barbero_nombre into v
      from lista_espera le
      left join servicios s on s.id::text = le.servicio_id
      left join barberos b on b.id::text = le.barbero_id
     where le.token = p_token;
    if not found then
        raise exception 'inscripcion_no_encontrada';
    end if;
    return jsonb_build_object(
        'nombre', v.nombre, 'servicio', v.servicio_nombre, 'barbero', coalesce(v.barbero_nombre, 'Cualquiera'),
        'fecha_desde', v.fecha_desde, 'fecha_hasta', v.fecha_hasta,
        'hora_desde', to_char(v.hora_desde, 'HH24:MI'), 'hora_hasta', to_char(v.hora_hasta, 'HH24:MI'),
        'estado', v.estado,
        'oferta', (select jsonb_build_object('token', o.token, 'fecha', o.fecha, 'hora', to_char(o.hora, 'HH24:MI'), 'expira_en', o.expira_en)
                     from ofertas_espera o where o.lista_id = v.id and o.estado = 'pendiente' and o.expira_en > now()));
end;
$$;

create or replace function public.cancelar_lista_espera(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_oferta uuid;
begin
    update lista_espera set estado = 'cancelada' where token = p_token and estado in ('activa', 'ofertada') returning id into v_id;
    if v_id is not null then
        select id into v_oferta from ofertas_espera where lista_id = v_id and estado = 'pendiente' for update;
        if v_oferta is not null then
            update ofertas_espera set estado = 'rechazada' where id = v_oferta;
            perform _ofrecer_espacio(o.barbero_id, o.fecha, o.hora) from ofertas_espera o where o.id = v_oferta;
        end if;
    end if;
    return jsonb_build_object('ok', true, 'estado', 'cancelada');
end;
$$;

create or replace function public.consultar_oferta(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v record;
begin
    select o.*, le.nombre, s.nombre as servicio_nombre, b.nombre as barbero_nombre into v
      from ofertas_espera o
      join lista_espera le on le.id = o.lista_id
      left join servicios s on s.id::text = le.servicio_id
      left join barberos b on b.id::text = o.barbero_id
     where o.token = p_token;
    if not found then
        raise exception 'oferta_no_encontrada';
    end if;
    return jsonb_build_object(
        'nombre', v.nombre, 'servicio', v.servicio_nombre, 'barbero', v.barbero_nombre,
        'fecha', v.fecha, 'hora', to_char(v.hora, 'HH24:MI'), 'expira_en', v.expira_en,
        'estado', case when v.estado = 'pendiente' and v.expira_en <= now() then 'vencida' else v.estado end,
        'cita_token', (select token from cita_tokens where cita_id = v.cita_id));
end;
$$;

-- Aceptación atómica: bloquea la oferta y la agenda; nunca crea dos citas
create or replace function public.aceptar_oferta(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_oferta record;
    v_entrada record;
    v_cotizacion jsonb;
    v_cita text;
begin
    select * into v_oferta from ofertas_espera where token = p_token for update;
    if not found then
        raise exception 'oferta_no_encontrada';
    end if;
    if v_oferta.estado = 'aceptada' then
        return jsonb_build_object('ok', true, 'token', (select token from cita_tokens where cita_id = v_oferta.cita_id));
    end if;
    if v_oferta.estado <> 'pendiente' then
        return jsonb_build_object('ok', false, 'error', 'oferta_no_vigente');
    end if;
    if v_oferta.expira_en <= now() then
        perform _cerrar_oferta(v_oferta.id, 'vencida');
        return jsonb_build_object('ok', false, 'error', 'oferta_vencida');
    end if;

    select * into v_entrada from lista_espera where id = v_oferta.lista_id for update;
    perform _bloquear_agenda(v_oferta.barbero_id, v_oferta.fecha);
    v_cotizacion := _cotizar(v_entrada.servicio_id, v_oferta.barbero_id, v_oferta.fecha, v_oferta.hora);
    if not (v_cotizacion ->> 'disponible')::boolean then
        perform _cerrar_oferta(v_oferta.id, 'invalidada');
        return jsonb_build_object('ok', false, 'error', 'horario_no_disponible');
    end if;

    v_cita := _crear_cita(v_entrada.nombre, v_entrada.telefono, v_entrada.email, v_cotizacion,
                          v_oferta.fecha, v_oferta.hora, 'lista_espera');
    update ofertas_espera set estado = 'aceptada', cita_id = v_cita where id = v_oferta.id;
    update lista_espera set estado = 'aceptada' where id = v_entrada.id;
    return jsonb_build_object('ok', true, 'token', (select token from cita_tokens where cita_id = v_cita),
                              'precio_final', v_cotizacion -> 'precio_final');
end;
$$;

create or replace function public.rechazar_oferta(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    select id into v_id from ofertas_espera where token = p_token and estado = 'pendiente' for update;
    if v_id is not null then
        perform _cerrar_oferta(v_id, 'rechazada');
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mi_codigo_referido(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tel text;
    v_codigo text;
begin
    if not _modulo_activo('referidos') then
        raise exception 'modulo_inactivo';
    end if;
    select normalizar_telefono(telefono_cliente) into v_tel from citas where id::text = _cita_por_token(p_token);
    if v_tel is null then
        raise exception 'cita_no_encontrada';
    end if;
    loop
        select codigo into v_codigo from referidos_codigos where telefono = v_tel;
        exit when found;
        begin
            insert into referidos_codigos (telefono, codigo)
            values (v_tel, upper(substr(md5(gen_random_uuid()::text), 1, 8)));
        exception when unique_violation then
            null; -- colisión de código o alta concurrente: se reintenta
        end;
    end loop;
    return jsonb_build_object('codigo', v_codigo);
end;
$$;

create or replace function public.darse_de_baja(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tel text;
begin
    update clientes_contacto set consentimiento_marketing = false, baja_en = coalesce(baja_en, now())
     where token_baja = p_token returning telefono into v_tel;
    if v_tel is null then
        raise exception 'enlace_invalido';
    end if;
    update mensajes_whatsapp set estado = 'omitido', ultimo_error = 'baja_cliente', actualizado_en = now()
     where telefono = v_tel and tipo = 'recuperacion' and estado = 'pendiente';
    return jsonb_build_object('ok', true);
end;
$$;

-- ==========================================
-- TAREAS PROGRAMADAS Y PROVEEDOR (rol service_role)
-- ==========================================
create or replace function public.programar_recordatorios() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_horas jsonb := coalesce(_ajuste('whatsapp', 'horas_antes'), '[24]'::jsonb);
    v_max int;
    v_c record;
    v_h int;
    v_total int := 0;
begin
    if not _modulo_activo('whatsapp') then
        return 0;
    end if;
    select max(h::int) into v_max from jsonb_array_elements_text(v_horas) h;

    for v_c in
        select c.id::text as id, c.nombre_cliente, c.telefono_cliente, c.fecha, c.hora, s.nombre as servicio, t.token,
               extract(epoch from ((c.fecha + c.hora) - _ahora_local())) / 3600 as horas_restantes
          from citas c
          join cita_tokens t on t.cita_id = c.id::text
          left join servicios s on s.id::text = c.servicio_id::text
         where c.estado <> 'cancelada'
           and c.fecha between _ahora_local()::date and _ahora_local()::date + (v_max / 24 + 1)
           and (c.fecha + c.hora) > _ahora_local()
    loop
        -- Solo el recordatorio más cercano aplicable: evita enviar 24h y 2h a la vez
        select min(h::int) into v_h from jsonb_array_elements_text(v_horas) h where v_c.horas_restantes <= h::int;
        continue when v_h is null;
        perform _encolar_mensaje(
            'recordatorio:' || v_c.id || ':' || v_c.fecha || 'T' || v_c.hora || ':' || v_h,
            'recordatorio', v_c.telefono_cliente, v_c.id, null,
            coalesce(_ajuste('whatsapp', 'plantilla_recordatorio') ->> 0, 'recordatorio_cita'),
            jsonb_build_array(v_c.nombre_cliente, coalesce(v_c.servicio, ''), to_char(v_c.fecha, 'DD/MM/YYYY'),
                              to_char(v_c.hora, 'HH24:MI'), _enlace('cita', v_c.token)),
            jsonb_build_array('CONFIRMAR:' || v_c.token, 'CANCELAR:' || v_c.token, 'REPROGRAMAR:' || v_c.token));
        v_total := v_total + 1;
    end loop;
    return v_total;
end;
$$;

create or replace function public.programar_recuperacion() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_dias int := coalesce((_ajuste('recuperacion', 'dias_inactividad'))::int, 45);
    v_espaciado int := coalesce((_ajuste('recuperacion', 'dias_entre_contactos'))::int, 30);
    v_max int := coalesce((_ajuste('recuperacion', 'max_contactos'))::int, 3);
    v_hoy date := _ahora_local()::date;
    v_c record;
    v_total int := 0;
begin
    if not (_modulo_activo('recuperacion') and _modulo_activo('whatsapp')) then
        return 0;
    end if;
    for v_c in
        select cc.telefono, cc.nombre, cc.token_baja, cc.contactos_recuperacion, u.ultima
          from clientes_contacto cc
          cross join lateral (
              select max(c.fecha) as ultima from citas c
               where normalizar_telefono(c.telefono_cliente) = cc.telefono
                 and c.completada_en is not null and c.estado <> 'cancelada'
          ) u
         where cc.consentimiento_marketing and cc.baja_en is null
           and u.ultima is not null and u.ultima < v_hoy - v_dias
           and cc.contactos_recuperacion < v_max
           and (cc.ultimo_contacto_recuperacion is null or cc.ultimo_contacto_recuperacion < now() - make_interval(days => v_espaciado))
           and not exists (select 1 from citas c2 where normalizar_telefono(c2.telefono_cliente) = cc.telefono
                            and c2.estado <> 'cancelada' and c2.fecha >= v_hoy)
           for update of cc skip locked
    loop
        perform _encolar_mensaje(
            'recuperacion:' || v_c.telefono || ':' || v_c.ultima || ':' || (v_c.contactos_recuperacion + 1),
            'recuperacion', v_c.telefono, null, null,
            coalesce(_ajuste('whatsapp', 'plantilla_recuperacion') ->> 0, 'recuperacion_cliente'),
            jsonb_build_array(coalesce(v_c.nombre, ''), coalesce(_ajuste('general', 'url_publica') ->> 0, ''), _enlace('baja', v_c.token_baja)),
            jsonb_build_array('BAJA:' || v_c.token_baja));
        update clientes_contacto
           set ultimo_contacto_recuperacion = now(), contactos_recuperacion = contactos_recuperacion + 1
         where telefono = v_c.telefono;
        v_total := v_total + 1;
    end loop;
    return v_total;
end;
$$;

create or replace function public.procesar_tareas_programadas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_oferta record;
    v_vencidas int := 0;
begin
    for v_oferta in select id from ofertas_espera where estado = 'pendiente' and expira_en <= now() for update skip locked loop
        perform _cerrar_oferta(v_oferta.id, 'vencida');
        v_vencidas := v_vencidas + 1;
    end loop;
    update lista_espera set estado = 'vencida' where estado = 'activa' and fecha_hasta < _ahora_local()::date;
    -- Sin confirmación del proveedor no se reintenta: evita duplicados
    update mensajes_whatsapp set estado = 'fallido', ultimo_error = 'estado_incierto_sin_confirmacion', actualizado_en = now()
     where estado = 'enviando' and actualizado_en < now() - interval '15 minutes';
    return jsonb_build_object('ofertas_vencidas', v_vencidas,
                              'recordatorios', programar_recordatorios(),
                              'recuperacion', programar_recuperacion());
end;
$$;

-- Reclama mensajes para envío (FOR UPDATE SKIP LOCKED: varios workers no envían el mismo)
create or replace function public.whatsapp_reclamar(p_limite int default 20) returns setof public.mensajes_whatsapp
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not _modulo_activo('whatsapp') then
        return;
    end if;
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'cita_cancelada', actualizado_en = now()
      from citas c
     where m.estado = 'pendiente' and m.tipo = 'recordatorio' and c.id::text = m.cita_id and c.estado = 'cancelada';
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'oferta_no_vigente', actualizado_en = now()
      from ofertas_espera o
     where m.estado = 'pendiente' and m.tipo = 'oferta_espera' and o.id = m.oferta_id and (o.estado <> 'pendiente' or o.expira_en <= now());
    update mensajes_whatsapp m set estado = 'omitido', ultimo_error = 'sin_consentimiento', actualizado_en = now()
     where m.estado = 'pendiente' and m.tipo = 'recuperacion'
       and not exists (select 1 from clientes_contacto cc where cc.telefono = m.telefono and cc.consentimiento_marketing and cc.baja_en is null);

    return query
    update mensajes_whatsapp set estado = 'enviando', intentos = intentos + 1, actualizado_en = now()
     where id in (select id from mensajes_whatsapp where estado = 'pendiente' and programado_para <= now()
                   order by programado_para limit greatest(least(p_limite, 100), 1) for update skip locked)
    returning *;
end;
$$;

create or replace function public.whatsapp_resultado(p_id uuid, p_ok boolean, p_proveedor_id text default null,
                                                     p_error text default null, p_reintentable boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_max int := coalesce((_ajuste('whatsapp', 'max_intentos'))::int, 3);
begin
    update mensajes_whatsapp
       set estado = case when p_ok then 'enviado'
                         when p_reintentable and intentos < v_max then 'pendiente'
                         else 'fallido' end,
           programado_para = case when not p_ok and p_reintentable then now() + make_interval(mins => power(2, intentos)::int) else programado_para end,
           proveedor_mensaje_id = coalesce(p_proveedor_id, proveedor_mensaje_id),
           ultimo_error = case when p_ok then null else left(p_error, 500) end,
           actualizado_en = now()
     where id = p_id and estado = 'enviando';
end;
$$;

-- Procesa respuestas del cliente (botones o texto) de forma idempotente por id de evento
create or replace function public.whatsapp_procesar_evento(p_evento_id text, p_telefono text, p_payload text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_accion text := upper(split_part(coalesce(p_payload, ''), ':', 1));
    v_token uuid;
    v_resultado jsonb;
    v_tel_cita text;
begin
    insert into webhook_eventos (id) values (p_evento_id) on conflict (id) do nothing;
    if not found then
        return jsonb_build_object('duplicado', true);
    end if;

    begin
        if v_accion in ('BAJA', 'STOP') and split_part(p_payload, ':', 2) = '' then
            update clientes_contacto set consentimiento_marketing = false, baja_en = coalesce(baja_en, now())
             where right(telefono, 10) = right(normalizar_telefono(p_telefono), 10);
            update mensajes_whatsapp set estado = 'omitido', ultimo_error = 'baja_cliente'
             where right(normalizar_telefono(telefono), 10) = right(normalizar_telefono(p_telefono), 10)
               and tipo = 'recuperacion' and estado = 'pendiente';
            v_resultado := jsonb_build_object('accion', 'baja');
        elsif v_accion in ('CONFIRMAR', 'CANCELAR', 'REPROGRAMAR', 'ACEPTAR', 'BAJA') then
            v_token := split_part(p_payload, ':', 2)::uuid;
            -- El token debe pertenecer al mismo teléfono que responde
            if v_accion = 'ACEPTAR' then
                select le.telefono into v_tel_cita from ofertas_espera o join lista_espera le on le.id = o.lista_id where o.token = v_token;
            elsif v_accion = 'BAJA' then
                select telefono into v_tel_cita from clientes_contacto where token_baja = v_token;
            else
                select telefono_cliente into v_tel_cita from citas where id::text = _cita_por_token(v_token);
            end if;
            if v_tel_cita is null or not _mismo_telefono(v_tel_cita, p_telefono) then
                raise exception 'token_no_corresponde';
            end if;
            v_resultado := case v_accion
                when 'CONFIRMAR' then confirmar_cita(v_token)
                when 'CANCELAR' then cancelar_cita(v_token)
                when 'ACEPTAR' then aceptar_oferta(v_token)
                when 'BAJA' then darse_de_baja(v_token)
                else jsonb_build_object('enlace', _enlace('cita', v_token)) end
                || jsonb_build_object('accion', lower(v_accion));
        else
            v_resultado := jsonb_build_object('accion', 'ignorada');
        end if;
    exception when others then
        v_resultado := jsonb_build_object('accion', lower(v_accion), 'error', sqlerrm);
    end;

    update webhook_eventos set resultado = left(v_resultado::text, 500) where id = p_evento_id;
    return v_resultado;
end;
$$;

-- ==========================================
-- API DE ADMINISTRACIÓN (Supabase Auth + admin_usuarios)
-- ==========================================
create or replace function public._exigir_admin() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
    if not es_admin() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.admin_guardar_modulo(p_modulo text, p_activo boolean, p_ajustes jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual jsonb;
    v_nuevo jsonb;
    v_clave text;
    v_num numeric;
begin
    perform _exigir_admin();
    select ajustes into v_actual from modulos_config where modulo = p_modulo for update;
    if not found then
        raise exception 'modulo_desconocido';
    end if;
    -- Solo claves existentes y del mismo tipo
    for v_clave in select jsonb_object_keys(coalesce(p_ajustes, '{}'::jsonb)) loop
        if not v_actual ? v_clave or jsonb_typeof(v_actual -> v_clave) <> jsonb_typeof(p_ajustes -> v_clave) then
            raise exception 'ajuste_invalido: %', v_clave;
        end if;
        if jsonb_typeof(p_ajustes -> v_clave) = 'number' then
            v_num := (p_ajustes ->> v_clave)::numeric;
            if v_num < 0 or v_num > 100000 then
                raise exception 'ajuste_fuera_de_rango: %', v_clave;
            end if;
        end if;
    end loop;
    v_nuevo := v_actual || coalesce(p_ajustes, '{}'::jsonb);

    if p_modulo = 'whatsapp' and exists (select 1 from jsonb_array_elements(v_nuevo -> 'horas_antes') h
                                          where jsonb_typeof(h) <> 'number' or h::text::numeric not between 1 and 168) then
        raise exception 'ajuste_fuera_de_rango: horas_antes';
    end if;
    if p_modulo = 'referidos' and ((v_nuevo ->> 'beneficio_tipo') not in ('porcentaje', 'monto')
        or (v_nuevo ->> 'beneficio_valor')::numeric <= 0
        or ((v_nuevo ->> 'beneficio_tipo') = 'porcentaje' and (v_nuevo ->> 'beneficio_valor')::numeric > 100)) then
        raise exception 'ajuste_fuera_de_rango: beneficio';
    end if;
    if p_modulo = 'general' then
        perform (v_nuevo ->> 'hora_apertura')::time, (v_nuevo ->> 'hora_cierre')::time, now() at time zone (v_nuevo ->> 'zona_horaria');
        if (v_nuevo ->> 'intervalo_minutos')::int < 5 then
            raise exception 'ajuste_fuera_de_rango: intervalo_minutos';
        end if;
    end if;

    update modulos_config
       set activo = case when p_modulo = 'general' then true else coalesce(p_activo, activo) end,
           ajustes = v_nuevo, actualizado_en = now()
     where modulo = p_modulo;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_marcar_cita(p_cita_id text, p_accion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_admin();
    if p_accion = 'completar_pagar' then
        update citas set completada_en = coalesce(completada_en, now()), pagada_en = coalesce(pagada_en, now())
         where id::text = p_cita_id and estado <> 'cancelada';
    elsif p_accion = 'reembolsar' then
        update citas set reembolsada_en = coalesce(reembolsada_en, now())
         where id::text = p_cita_id and pagada_en is not null;
    elsif p_accion = 'entregar_productos' then
        update cita_productos set estado = 'entregado', actualizado_en = now()
         where cita_id = p_cita_id and estado = 'reservado';
        return jsonb_build_object('ok', true);
    else
        raise exception 'accion_invalida';
    end if;
    if not found then
        raise exception 'cita_no_valida_para_accion';
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_usar_beneficio(p_beneficio_id uuid, p_cita_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_beneficio record;
    v_cita record;
begin
    perform _exigir_admin();
    select * into v_beneficio from beneficios where id = p_beneficio_id for update;
    if not found or v_beneficio.estado <> 'disponible' then
        raise exception 'beneficio_no_disponible';
    end if;
    select * into v_cita from citas where id::text = p_cita_id for update;
    if not found or not _mismo_telefono(v_cita.telefono_cliente, v_beneficio.telefono) or v_cita.estado = 'cancelada' then
        raise exception 'cita_no_corresponde';
    end if;
    if exists (select 1 from beneficios where cita_uso = p_cita_id and estado = 'usado') then
        raise exception 'cita_ya_tiene_beneficio';
    end if;
    if v_cita.promocion_id is not null and not coalesce((_ajuste('referidos', 'acumulable_con_promocion'))::boolean, false) then
        raise exception 'no_acumulable_con_promocion';
    end if;
    update beneficios set estado = 'usado', cita_uso = p_cita_id, usado_en = now() where id = p_beneficio_id;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_ajustar_stock(p_producto_id uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_stock int;
begin
    perform _exigir_admin();
    update productos set stock = stock + p_delta, actualizado_en = now()
     where id = p_producto_id and stock + p_delta >= 0
    returning stock into v_stock;
    if not found then
        raise exception 'stock_invalido';
    end if;
    return jsonb_build_object('ok', true, 'stock', v_stock);
end;
$$;

create or replace function public.admin_reintentar_mensaje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_admin();
    update mensajes_whatsapp set estado = 'pendiente', programado_para = now(), actualizado_en = now()
     where id = p_id and estado = 'fallido';
    if not found then
        raise exception 'mensaje_no_reintentable';
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_cancelar_espera(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_admin();
    return cancelar_lista_espera((select token from lista_espera where id = p_id));
end;
$$;

-- ==========================================
-- SEGURIDAD: RLS y permisos
-- ==========================================
do $$
declare
    v_tabla text;
begin
    foreach v_tabla in array array['modulos_config', 'admin_usuarios', 'cita_tokens', 'clientes_contacto', 'mensajes_whatsapp',
                                   'webhook_eventos', 'lista_espera', 'ofertas_espera', 'referidos_codigos', 'referidos',
                                   'beneficios', 'productos', 'cita_productos', 'promociones'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;

    -- Lectura para administradores
    foreach v_tabla in array array['modulos_config', 'clientes_contacto', 'mensajes_whatsapp', 'lista_espera', 'ofertas_espera',
                                   'referidos', 'beneficios', 'productos', 'cita_productos', 'promociones'] loop
        execute format('drop policy if exists admin_lectura on public.%I', v_tabla);
        execute format('create policy admin_lectura on public.%I for select to authenticated using (public.es_admin())', v_tabla);
        execute format('grant select on public.%I to authenticated', v_tabla);
    end loop;
end $$;

drop policy if exists admin_escritura on public.productos;
create policy admin_escritura on public.productos for insert to authenticated with check (public.es_admin());
drop policy if exists admin_edicion on public.productos;
create policy admin_edicion on public.productos for update to authenticated using (public.es_admin()) with check (public.es_admin());
grant insert (nombre, descripcion, precio, stock, activo) on public.productos to authenticated;
-- El stock solo se ajusta con admin_ajustar_stock (delta atómico)
grant update (nombre, descripcion, precio, activo) on public.productos to authenticated;

drop policy if exists admin_escritura on public.promociones;
create policy admin_escritura on public.promociones for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant insert, update, delete on public.promociones to authenticated;

do $$
declare
    v_fn regprocedure;
    v_publicas text[] := array['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita',
                               'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita',
                               'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta',
                               'aceptar_oferta', 'rechazar_oferta', 'mi_codigo_referido', 'darse_de_baja', 'normalizar_telefono', 'es_admin'];
    v_admin text[] := array['admin_guardar_modulo', 'admin_marcar_cita', 'admin_usar_beneficio', 'admin_ajustar_stock',
                            'admin_reintentar_mensaje', 'admin_cancelar_espera'];
    v_servicio text[] := array['programar_recordatorios', 'programar_recuperacion', 'procesar_tareas_programadas',
                               'whatsapp_reclamar', 'whatsapp_resultado', 'whatsapp_procesar_evento'];
    v_internas text[] := array['_mismo_telefono', '_modulo_activo', '_ajuste', '_zona', '_ahora_local', '_bloquear_agenda',
                               '_en_horario', '_slot_libre', '_cotizar', '_aplicar_promocion', '_liberar_promocion',
                               '_resolver_servicio', '_resolver_barbero', '_crear_cita', '_enlace', '_encolar_mensaje',
                               '_ofrecer_espacio', '_cerrar_oferta', '_registrar_referido', '_otorgar_referido',
                               '_revertir_referido', '_horas_libres', '_cita_por_token', '_cita_modificable',
                               '_validar_plazo', '_exigir_admin', 'tg_citas_bloquear_agenda', 'tg_citas_token', 'tg_citas_modulos'];
begin
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_publicas || v_admin || v_servicio || v_internas) loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_publicas) loop
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_admin) loop
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = any (v_servicio) loop
        execute format('grant execute on function %s to service_role', v_fn);
    end loop;
end $$;
