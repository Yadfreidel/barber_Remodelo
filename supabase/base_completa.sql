-- =====================================================================
-- INSTALACIÓN COMPLETA DE BARBERÍA EN EL ESQUEMA `barberia`
-- (generado con: npm run base:completa — no editar a mano)
--
-- Pensado para un proyecto de Supabase COMPARTIDO: no crea ni modifica nada en
-- `public` (p. ej. las tablas players y matches de dominó), ni en `private`,
-- ni en Auth. Solo lee auth.users para el alta del administrador.
--
-- Contiene, trasladadas a barberia / barberia_private, estas migraciones:
--   20261020000000_base_inicial.sql
--   20261021000000_modulos_crecimiento.sql
--   20261021000001_citas_unicidad_activas.sql
--   20261021155903_catalogo_25_cortes.sql
--   20261022000000_ubicacion_local.sql
--   20261022161508_restaurar_acceso_admin_seguro.sql
--   20261023000000_panel_administracion.sql
--   20261023120000_fotos_barberos.sql
--   20261024000000_mis_citas_horarios_30.sql
--
-- CÓMO USARLO:
--   1. Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--      Se ejecuta en una transacción: si algo falla no queda nada a medias.
--   2. Project Settings > Data API > Exposed schemas: AÑADE "barberia" (sin quitar public
--      ni los demás). No expongas "barberia_private".
--   3. Authentication > Users > Add user: crea yafre2310@gmail.com (si aún no existe) y vuelve a
--      ejecutar el bloque "ADMINISTRADOR" del final.
--   4. Comprueba con supabase/barberia_verificacion.sql.
-- Es seguro ejecutarlo más de una vez.
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

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261020000000_base_inicial.sql
-- #####################################################################
-- =====================================================================
-- ESQUEMA BASE (para un proyecto de Supabase nuevo)
-- Tablas que ya usa la app: barberos, servicios y citas.
-- Si las tablas ya existen, no las modifica (create if not exists).
-- =====================================================================

create table if not exists barberia.barberos (
    id bigint generated always as identity primary key,
    nombre text not null,
    activo boolean not null default true,
    creado_en timestamptz not null default now()
);

create table if not exists barberia.servicios (
    id bigint generated always as identity primary key,
    nombre text not null,
    precio numeric(10, 2) not null default 0,
    duracion_minutos int not null default 60 check (duracion_minutos > 0),
    creado_en timestamptz not null default now()
);

create table if not exists barberia.citas (
    id bigint generated always as identity primary key,
    nombre_cliente text not null,
    telefono_cliente text not null,
    email text,
    barbero_id bigint not null references barberia.barberos (id),
    servicio_id bigint not null references barberia.servicios (id),
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'cancelada')),
    creado_en timestamptz not null default now()
);

-- Anti double-booking: un barbero no puede tener dos citas activas a la misma hora
create unique index if not exists citas_barbero_id_fecha_hora_key
    on barberia.citas (barbero_id, fecha, hora) where estado <> 'cancelada';
create index if not exists citas_fecha_idx on barberia.citas (fecha);

-- Acceso que necesita hoy la web con la anon key (lectura, reserva y cambio de estado desde el panel)
alter table barberia.barberos enable row level security;
alter table barberia.servicios enable row level security;
alter table barberia.citas enable row level security;

drop policy if exists web_lectura on barberia.barberos;
create policy web_lectura on barberia.barberos for select to anon, authenticated using (true);
drop policy if exists web_alta on barberia.barberos;
create policy web_alta on barberia.barberos for insert to anon, authenticated with check (true);

drop policy if exists web_lectura on barberia.servicios;
create policy web_lectura on barberia.servicios for select to anon, authenticated using (true);
drop policy if exists web_alta on barberia.servicios;
create policy web_alta on barberia.servicios for insert to anon, authenticated with check (true);

drop policy if exists web_lectura on barberia.citas;
create policy web_lectura on barberia.citas for select to anon, authenticated using (true);
drop policy if exists web_reserva on barberia.citas;
create policy web_reserva on barberia.citas for insert to anon, authenticated with check (true);
drop policy if exists web_estado on barberia.citas;
create policy web_estado on barberia.citas for update to anon, authenticated using (true) with check (true);

grant select, insert on barberia.barberos, barberia.servicios to anon, authenticated;
grant select, insert, update on barberia.citas to anon, authenticated;

-- Datos iniciales: mismos barberos y catálogo que muestra la web
insert into barberia.barberos (nombre)
select v.nombre from (values ('Isaac Garcia'), ('Yadfreidel Victoria'), ('Acxel Rosario')) v (nombre)
where not exists (select 1 from barberia.barberos b where b.nombre = v.nombre);

insert into barberia.servicios (nombre, precio, duracion_minutos)
select v.nombre, v.precio, 60 from (values
    ('Corte Signature Master', 700), ('High / Mid / Low Skin Fade', 750), ('Blowout / Taper Fade Moderno', 700),
    ('Buzz Cut con Line Up', 550), ('Pompadour Clásico Ejecutivo', 800), ('Modern Mullet Texturizado', 750),
    ('French Crop con Textura', 700), ('Corte Clásico a Tijera', 850), ('Corte Elite & Diseño de Cejas', 850),
    ('Corte Kids (Menores de 12)', 500), ('Ritual de Barba Toalla Caliente', 500), ('Perfilado de Barba y Cerquillo', 350),
    ('Barba con Degradado (Beard Fade)', 450), ('Esculpido de Barba Larga', 550), ('Camuflaje de Barba Elite', 650),
    ('Hidratación Profunda de Barba', 400), ('Limpieza con Mascarilla Negra', 600), ('Facial Premium de Oro 24K', 900),
    ('Diseño de Perilla / Candado', 400), ('Alaciado de Barba Rebelde', 800), ('Combo Ejecutivo Real', 900),
    ('Combo Master Absoluto', 1100), ('Combo El Padrino VIP', 1600), ('Combo Oro Inmortal', 1950),
    ('Combo Urbano Black', 1350), ('Combo Herencia (Padre e Hijo)', 1100), ('Combo Fresh & Clean Business', 1200),
    ('Combo Groom / Novio & Celebridades', 2500)
) v (nombre, precio)
where not exists (select 1 from barberia.servicios s where s.nombre = v.nombre);

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261021000000_modulos_crecimiento.sql
-- #####################################################################
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
    if to_regclass('barberia.citas') is null or to_regclass('barberia.barberos') is null or to_regclass('barberia.servicios') is null then
        raise exception 'Faltan las tablas base citas, barberos y servicios';
    end if;
    if (select data_type from information_schema.columns
        where table_schema = 'barberia' and table_name = 'citas' and column_name = 'fecha') <> 'date'
       or (select data_type from information_schema.columns
        where table_schema = 'barberia' and table_name = 'citas' and column_name = 'hora') not like 'time%' then
        raise exception 'Se esperaba citas.fecha de tipo date y citas.hora de tipo time';
    end if;
end $$;

-- ==========================================
-- CONFIGURACIÓN Y ADMINISTRADORES
-- ==========================================
create table if not exists barberia.modulos_config (
    modulo text primary key check (modulo in ('general', 'whatsapp', 'lista_espera', 'recuperacion', 'referidos', 'productos', 'promociones')),
    activo boolean not null default false,
    ajustes jsonb not null default '{}'::jsonb,
    actualizado_en timestamptz not null default now()
);

insert into barberia.modulos_config (modulo, activo, ajustes) values
    ('general', true, '{"zona_horaria": "America/Santo_Domingo", "hora_apertura": "09:00", "hora_cierre": "20:00", "intervalo_minutos": 60, "horas_minimas_cambio": 1, "url_publica": ""}'),
    ('whatsapp', false, '{"horas_antes": [24, 2], "max_intentos": 3, "codigo_pais": "1", "idioma": "es", "plantilla_recordatorio": "recordatorio_cita", "plantilla_oferta": "oferta_lista_espera", "plantilla_recuperacion": "recuperacion_cliente"}'),
    ('lista_espera', false, '{"minutos_vencimiento_oferta": 30, "max_dias_anticipacion": 30, "max_inscripciones_por_telefono": 3}'),
    ('recuperacion', false, '{"dias_inactividad": 45, "dias_entre_contactos": 30, "max_contactos": 3}'),
    ('referidos', false, '{"beneficio_tipo": "porcentaje", "beneficio_valor": 10, "acumulable_con_promocion": false}'),
    ('productos', false, '{"max_unidades_por_producto": 5}'),
    ('promociones', false, '{}')
on conflict (modulo) do nothing;

-- Usuarios de Supabase Auth con permisos de administrador (alta manual, ver supabase/README.md)
create table if not exists barberia.admin_usuarios (
    user_id uuid primary key,
    creado_en timestamptz not null default now()
);

create or replace function barberia.es_admin() returns boolean
language sql stable security definer set search_path = barberia, pg_temp as $$
    select exists (select 1 from admin_usuarios where user_id = auth.uid())
$$;

create or replace function barberia.normalizar_telefono(p text) returns text
language sql immutable set search_path = barberia, pg_temp as $$
    select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;

create or replace function barberia._mismo_telefono(a text, b text) returns boolean
language sql immutable set search_path = barberia, pg_temp as $$
    select right(normalizar_telefono(a), 10) = right(normalizar_telefono(b), 10)
$$;

create or replace function barberia._modulo_activo(p_modulo text) returns boolean
language sql stable set search_path = barberia, pg_temp as $$
    select coalesce((select activo from modulos_config where modulo = p_modulo), false)
$$;

create or replace function barberia._ajuste(p_modulo text, p_clave text) returns jsonb
language sql stable set search_path = barberia, pg_temp as $$
    select ajustes -> p_clave from modulos_config where modulo = p_modulo
$$;

create or replace function barberia._zona() returns text
language sql stable set search_path = barberia, pg_temp as $$
    select coalesce(_ajuste('general', 'zona_horaria') ->> 0, 'America/Santo_Domingo')
$$;

create or replace function barberia._ahora_local() returns timestamp
language sql stable set search_path = barberia, pg_temp as $$
    select now() at time zone _zona()
$$;

-- ==========================================
-- COLUMNAS ADITIVAS EN CITAS
-- ==========================================
alter table barberia.citas
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

create index if not exists citas_id_texto_idx on barberia.citas ((id::text));
create index if not exists citas_telefono_norm_idx on barberia.citas (normalizar_telefono(telefono_cliente));

-- Token secreto por cita para enlaces de confirmar/cancelar/reprogramar.
-- Tabla aparte para no exponerlo en las lecturas públicas existentes de citas.
create table if not exists barberia.cita_tokens (
    cita_id text primary key,
    token uuid not null unique default gen_random_uuid(),
    creado_en timestamptz not null default now()
);

insert into barberia.cita_tokens (cita_id)
select id::text from barberia.citas
on conflict (cita_id) do nothing;

-- ==========================================
-- TABLAS DE LOS MÓDULOS
-- ==========================================
create table if not exists barberia.clientes_contacto (
    telefono text primary key,
    nombre text,
    consentimiento_marketing boolean not null default false,
    consentimiento_en timestamptz,
    baja_en timestamptz,
    token_baja uuid not null unique default gen_random_uuid(),
    ultimo_contacto_recuperacion timestamptz,
    contactos_recuperacion int not null default 0
);

create table if not exists barberia.mensajes_whatsapp (
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
create index if not exists mensajes_whatsapp_pendientes_idx on barberia.mensajes_whatsapp (programado_para) where estado = 'pendiente';

create table if not exists barberia.webhook_eventos (
    id text primary key,
    recibido_en timestamptz not null default now(),
    resultado text
);

create table if not exists barberia.lista_espera (
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
create index if not exists lista_espera_activa_idx on barberia.lista_espera (creado_en) where estado = 'activa';

create table if not exists barberia.ofertas_espera (
    id uuid primary key default gen_random_uuid(),
    token uuid not null unique default gen_random_uuid(),
    lista_id uuid not null references barberia.lista_espera (id),
    barbero_id text not null,
    fecha date not null,
    hora time not null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'vencida', 'rechazada', 'invalidada')),
    expira_en timestamptz not null,
    cita_id text,
    creado_en timestamptz not null default now()
);
-- Un solo ofrecimiento vigente por espacio y por inscripción
create unique index if not exists ofertas_espacio_vigente_uq on barberia.ofertas_espera (barbero_id, fecha, hora) where estado = 'pendiente';
create unique index if not exists ofertas_lista_vigente_uq on barberia.ofertas_espera (lista_id) where estado = 'pendiente';

create table if not exists barberia.referidos_codigos (
    telefono text primary key,
    codigo text not null unique,
    creado_en timestamptz not null default now()
);

create table if not exists barberia.referidos (
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

create table if not exists barberia.beneficios (
    id uuid primary key default gen_random_uuid(),
    telefono text not null,
    tipo text not null check (tipo in ('porcentaje', 'monto')),
    valor numeric(10, 2) not null check (valor > 0),
    estado text not null default 'disponible' check (estado in ('disponible', 'usado', 'anulado')),
    referido_id uuid unique references barberia.referidos (id),
    cita_uso text,
    creado_en timestamptz not null default now(),
    usado_en timestamptz
);

create table if not exists barberia.productos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text,
    precio numeric(10, 2) not null check (precio >= 0),
    stock int not null default 0 check (stock >= 0),
    activo boolean not null default false,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

create table if not exists barberia.cita_productos (
    id uuid primary key default gen_random_uuid(),
    cita_id text not null,
    producto_id uuid not null references barberia.productos (id),
    cantidad int not null check (cantidad > 0),
    precio_unitario numeric(10, 2) not null,
    subtotal numeric(10, 2) not null,
    estado text not null default 'reservado' check (estado in ('reservado', 'entregado', 'devuelto')),
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists cita_productos_cita_idx on barberia.cita_productos (cita_id);

create table if not exists barberia.promociones (
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
create or replace function barberia._bloquear_agenda(p_barbero_id text, p_fecha date) returns void
language sql set search_path = barberia, pg_temp as $$
    select pg_advisory_xact_lock(hashtextextended('agenda:' || p_barbero_id || ':' || p_fecha::text, 0))
$$;

create or replace function barberia._en_horario(p_hora time, p_duracion int) returns boolean
language sql stable set search_path = barberia, pg_temp as $$
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
create or replace function barberia._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean
language sql stable set search_path = barberia, pg_temp as $$
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

create or replace function barberia._cotizar(p_servicio_id text, p_barbero_id text, p_fecha date, p_hora time, p_excluir_cita text default null)
returns jsonb
language plpgsql stable set search_path = barberia, pg_temp as $$
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

create or replace function barberia._aplicar_promocion(p_id uuid) returns void
language plpgsql set search_path = barberia, pg_temp as $$
begin
    update promociones set usos = usos + 1
     where id = p_id and activa and (max_usos is null or usos < max_usos);
    if not found then
        raise exception 'promocion_no_disponible';
    end if;
end;
$$;

create or replace function barberia._liberar_promocion(p_id uuid) returns void
language sql set search_path = barberia, pg_temp as $$
    update promociones set usos = greatest(usos - 1, 0) where id = p_id
$$;

create or replace function barberia._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select id::text from servicios where nombre = p_nombre limit 1
$$;

create or replace function barberia._resolver_barbero(p_nombre text) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select id::text from barberos where nombre = p_nombre and activo is not false limit 1
$$;

-- Inserta la cita con los precios ya validados en servidor
create or replace function barberia._crear_cita(p_nombre text, p_telefono text, p_email text, p_cotizacion jsonb, p_fecha date, p_hora time, p_origen text)
returns text
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._enlace(p_param text, p_token uuid) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select case when coalesce(_ajuste('general', 'url_publica') ->> 0, '') = '' then ''
                else (_ajuste('general', 'url_publica') ->> 0) || '?' || p_param || '=' || p_token::text end
$$;

create or replace function barberia._encolar_mensaje(p_clave text, p_tipo text, p_telefono text, p_cita_id text, p_oferta_id uuid,
                                                   p_plantilla text, p_parametros jsonb, p_botones jsonb)
returns void
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._ofrecer_espacio(p_barbero_id text, p_fecha date, p_hora time) returns uuid
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._cerrar_oferta(p_oferta_id uuid, p_estado text) returns void
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._registrar_referido(p_telefono text, p_codigo text) returns text
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._otorgar_referido(p_cita_id text) returns void
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia._revertir_referido(p_cita_id text) returns void
language plpgsql set search_path = barberia, pg_temp as $$
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
create or replace function barberia.tg_citas_bloquear_agenda() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _bloquear_agenda(new.barbero_id::text, new.fecha);
    return new;
end;
$$;

create or replace function barberia.tg_citas_token() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    insert into cita_tokens (cita_id) values (new.id::text) on conflict (cita_id) do nothing;
    return new;
end;
$$;

create or replace function barberia.tg_citas_modulos() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

drop trigger if exists citas_bloquear_agenda on barberia.citas;
create trigger citas_bloquear_agenda before insert or update of barbero_id, fecha, hora on barberia.citas
    for each row execute function barberia.tg_citas_bloquear_agenda();

drop trigger if exists citas_token on barberia.citas;
create trigger citas_token after insert on barberia.citas
    for each row execute function barberia.tg_citas_token();

drop trigger if exists citas_modulos on barberia.citas;
create trigger citas_modulos after update on barberia.citas
    for each row execute function barberia.tg_citas_modulos();

-- ==========================================
-- API PÚBLICA (cliente web, rol anon)
-- ==========================================
create or replace function barberia.config_publica() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.listar_productos() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select case when not _modulo_activo('productos') then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'descripcion', descripcion, 'precio', precio, 'stock', stock) order by nombre)
          from productos where activo
    ), '[]'::jsonb) end
$$;

create or replace function barberia.cotizar_cita(p_servicio text, p_barbero text, p_fecha date, p_hora time) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia._horas_libres(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language sql stable set search_path = barberia, pg_temp as $$
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

create or replace function barberia.horarios_disponibles(p_servicio text, p_barbero text, p_fecha date) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select _horas_libres(_resolver_servicio(p_servicio), _resolver_barbero(p_barbero), p_fecha)
$$;

create or replace function barberia.reservar_cita(
    p_nombre text, p_email text, p_telefono text, p_servicio text, p_barbero text, p_fecha date, p_hora time,
    p_productos jsonb default '[]'::jsonb, p_codigo_referido text default null,
    p_consentimiento boolean default false, p_precio_esperado numeric default null)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia._cita_por_token(p_token uuid) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select cita_id from cita_tokens where token = p_token
$$;

create or replace function barberia.consultar_cita(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia._cita_modificable(p_token uuid, out id text, out barbero_id text, out servicio_id text,
                                                    out estado text, out fecha date, out hora time, out promocion_id uuid,
                                                    out completada_en timestamptz)
language plpgsql set search_path = barberia, pg_temp as $$
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

create or replace function barberia._validar_plazo(p_fecha date, p_hora time) returns void
language plpgsql stable set search_path = barberia, pg_temp as $$
begin
    if (p_fecha + p_hora) - _ahora_local() < make_interval(hours => coalesce((_ajuste('general', 'horas_minimas_cambio'))::int, 1)) then
        raise exception 'fuera_de_plazo';
    end if;
end;
$$;

create or replace function barberia.confirmar_cita(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.cancelar_cita(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.horarios_reprogramacion(p_token uuid, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.cotizar_reprogramacion(p_token uuid, p_fecha date, p_hora time) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.reprogramar_cita(p_token uuid, p_fecha date, p_hora time, p_precio_esperado numeric default null)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.unirse_lista_espera(
    p_nombre text, p_telefono text, p_email text, p_servicio text, p_barbero text,
    p_fecha_desde date, p_fecha_hasta date, p_hora_desde time, p_hora_hasta time)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.consultar_lista_espera(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.cancelar_lista_espera(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.consultar_oferta(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.aceptar_oferta(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.rechazar_oferta(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.mi_codigo_referido(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.darse_de_baja(p_token uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.programar_recordatorios() returns int
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.programar_recuperacion() returns int
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.procesar_tareas_programadas() returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.whatsapp_reclamar(p_limite int default 20) returns setof barberia.mensajes_whatsapp
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.whatsapp_resultado(p_id uuid, p_ok boolean, p_proveedor_id text default null,
                                                     p_error text default null, p_reintentable boolean default false)
returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.whatsapp_procesar_evento(p_evento_id text, p_telefono text, p_payload text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia._exigir_admin() returns void
language plpgsql stable set search_path = barberia, pg_temp as $$
begin
    if not es_admin() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
end;
$$;

create or replace function barberia.admin_guardar_modulo(p_modulo text, p_activo boolean, p_ajustes jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.admin_marcar_cita(p_cita_id text, p_accion text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.admin_usar_beneficio(p_beneficio_id uuid, p_cita_id text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.admin_ajustar_stock(p_producto_id uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.admin_reintentar_mensaje(p_id uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.admin_cancelar_espera(p_id uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
        execute format('alter table barberia.%I enable row level security', v_tabla);
        execute format('revoke all on barberia.%I from anon, authenticated', v_tabla);
    end loop;

    -- Lectura para administradores
    foreach v_tabla in array array['modulos_config', 'clientes_contacto', 'mensajes_whatsapp', 'lista_espera', 'ofertas_espera',
                                   'referidos', 'beneficios', 'productos', 'cita_productos', 'promociones'] loop
        execute format('drop policy if exists admin_lectura on barberia.%I', v_tabla);
        execute format('create policy admin_lectura on barberia.%I for select to authenticated using (barberia.es_admin())', v_tabla);
        execute format('grant select on barberia.%I to authenticated', v_tabla);
    end loop;
end $$;

drop policy if exists admin_escritura on barberia.productos;
create policy admin_escritura on barberia.productos for insert to authenticated with check (barberia.es_admin());
drop policy if exists admin_edicion on barberia.productos;
create policy admin_edicion on barberia.productos for update to authenticated using (barberia.es_admin()) with check (barberia.es_admin());
grant insert (nombre, descripcion, precio, stock, activo) on barberia.productos to authenticated;
-- El stock solo se ajusta con admin_ajustar_stock (delta atómico)
grant update (nombre, descripcion, precio, activo) on barberia.productos to authenticated;

drop policy if exists admin_escritura on barberia.promociones;
create policy admin_escritura on barberia.promociones for all to authenticated using (barberia.es_admin()) with check (barberia.es_admin());
grant insert, update, delete on barberia.promociones to authenticated;

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
                 where n.nspname = 'barberia' and p.proname = any (v_publicas || v_admin || v_servicio || v_internas) loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_publicas) loop
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_admin) loop
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_servicio) loop
        execute format('grant execute on function %s to service_role', v_fn);
    end loop;
end $$;

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261021000001_citas_unicidad_activas.sql
-- #####################################################################
-- =====================================================================
-- Unicidad de agenda solo para citas NO canceladas.
--
-- Si citas tiene un UNIQUE simple (barbero_id, fecha, hora), un horario
-- cancelado nunca puede volver a reservarse, aunque la web lo muestra libre.
-- La lista de espera y la reprogramación lo necesitan.
-- Se reemplaza por un índice único parcial con el MISMO nombre, así que el
-- anti double-booking y el mensaje de error que detecta el cliente no cambian.
-- Si ya existe un índice parcial, no hace nada.
-- =====================================================================
do $$
declare
    v_nombre text;
begin
    select con.conname into v_nombre
      from pg_constraint con
     where con.conrelid = 'barberia.citas'::regclass
       and con.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k) = array['barbero_id', 'fecha', 'hora'];

    if v_nombre is not null then
        execute format('alter table barberia.citas drop constraint %I', v_nombre);
        execute format('create unique index %I on barberia.citas (barbero_id, fecha, hora) where estado <> %L', v_nombre, 'cancelada');
    elsif not exists (
        select 1 from pg_index i
         where i.indrelid = 'barberia.citas'::regclass and i.indisunique
           and (select array_agg(a.attname::text order by a.attname)
                  from unnest(i.indkey) k
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k) = array['barbero_id', 'fecha', 'hora']
    ) then
        create unique index citas_barbero_id_fecha_hora_key on barberia.citas (barbero_id, fecha, hora) where estado <> 'cancelada';
    end if;
end $$;

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261021155903_catalogo_25_cortes.sql
-- #####################################################################
-- Solo nuevos estilos. Las filas anteriores y las citas existentes no se actualizan.
alter table barberia.servicios add column if not exists catalogo_id text;
create unique index if not exists servicios_catalogo_id_key on barberia.servicios(catalogo_id);
insert into barberia.servicios (catalogo_id, nombre, precio, duracion_minutos) values
    ('corte-01','Degradado bajo rizado',600,40),
    ('corte-02','Degradado medio rizado',600,40),
    ('corte-03','Degradado alto rizado',600,40),
    ('corte-04','Taper bajo natural',550,35),
    ('corte-05','Taper medio rizado',600,40),
    ('corte-06','Burst fade rizado',700,45),
    ('corte-07','Drop fade rizado',650,45),
    ('corte-08','Degradado en V',650,45),
    ('corte-09','Crop francés rizado',600,40),
    ('corte-10','César texturizado',500,30),
    ('corte-11','Buzz cut degradado',450,30),
    ('corte-12','Crew cut texturizado',500,30),
    ('corte-13','Afro corto redondo',600,40),
    ('corte-14','Afro medio con taper',700,50),
    ('corte-15','High top rizado',750,50),
    ('corte-16','Frohawk rizado',750,50),
    ('corte-17','Mullet rizado suave',800,60),
    ('corte-18','Mohicano rizado',750,50),
    ('corte-19','Rizos con flequillo',650,45),
    ('corte-20','Rizos messy',650,45),
    ('corte-21','Quiff rizado',700,45),
    ('corte-22','Undercut rizado',700,45),
    ('corte-23','Raya lateral marcada',650,45),
    ('corte-24','Diseño doble en la sien',700,50),
    ('corte-25','Flat top texturizado',750,50)
on conflict (catalogo_id) do nothing;

-- Mantiene los nombres anteriores y admite identificadores de los nuevos estilos.
create or replace function barberia._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select id::text from servicios
    where nombre = p_nombre or (catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre))
    order by case when catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre) then 0 else 1 end, id
    limit 1
$$;

-- Instantanea solo para las citas de los nuevos cortes; no cambia citas anteriores.
alter table barberia.citas add column if not exists duracion_reservada int check (duracion_reservada > 0);
create or replace function barberia._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean language sql stable set search_path = barberia, pg_temp as $$
    select not exists (
        select 1 from citas c left join servicios s on s.id::text = c.servicio_id::text
        where c.barbero_id::text = p_barbero_id and c.fecha = p_fecha and c.estado <> 'cancelada'
          and (p_excluir_cita is null or c.id::text <> p_excluir_cita)
          and c.hora < p_hora + make_interval(mins => p_duracion)
          and p_hora < c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30))
    )
$$;

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;
create or replace function barberia_private.citas_duracion_catalogo() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_duracion int;
    v_catalogo text;
    v_validar boolean;
begin
    select s.duracion_minutos, s.catalogo_id into v_duracion, v_catalogo
      from servicios s where s.id = new.servicio_id for share;
    if v_catalogo is null then
        if tg_op = 'INSERT' then new.duracion_reservada := null;
        else new.duracion_reservada := old.duracion_reservada; end if;
        return new;
    end if;
    if tg_op = 'INSERT' then
        new.duracion_reservada := v_duracion;
        v_validar := true;
    else
        new.duracion_reservada := case when new.servicio_id = old.servicio_id
            then coalesce(old.duracion_reservada, v_duracion) else v_duracion end;
        v_validar := (new.barbero_id, new.servicio_id, new.fecha, new.hora) is distinct from
                     (old.barbero_id, old.servicio_id, old.fecha, old.hora)
                     or (old.estado = 'cancelada' and new.estado <> 'cancelada');
    end if;
    if new.estado <> 'cancelada' and v_validar then
        perform _bloquear_agenda(new.barbero_id::text, new.fecha);
        if not _en_horario(new.hora, new.duracion_reservada)
           or not _slot_libre(new.barbero_id::text, new.fecha, new.hora, new.duracion_reservada, new.id::text) then
            raise exception 'horario_no_disponible' using errcode = '23505';
        end if;
    end if;
    return new;
end;
$$;
revoke all on function barberia_private.citas_duracion_catalogo() from public, anon, authenticated;
drop trigger if exists citas_catalogo25_duracion on barberia.citas;
create trigger citas_catalogo25_duracion before insert or update on barberia.citas
    for each row execute function barberia_private.citas_duracion_catalogo();

-- Edicion de tarifas: misma autenticacion y lista de administradores existentes.
-- SECURITY INVOKER + RLS: el RPC no tiene privilegios adicionales del propietario.
grant update(precio, duracion_minutos) on barberia.servicios to authenticated;
drop policy if exists admin_tarifa_catalogo on barberia.servicios;
create policy admin_tarifa_catalogo on barberia.servicios for update to authenticated
    using (catalogo_id is not null and (select barberia.es_admin()))
    with check (catalogo_id is not null and (select barberia.es_admin()));
create or replace function barberia.admin_actualizar_corte(p_catalogo_id text, p_precio numeric, p_duracion int)
returns jsonb language plpgsql security invoker set search_path = barberia, pg_temp as $$
declare v_resultado jsonb;
begin
    if not barberia.es_admin() then raise exception 'no_autorizado' using errcode = '42501'; end if;
    if p_precio is null or p_precio < 0 or p_precio > 99999999 or p_duracion is null or p_duracion not between 1 and 480 then
        raise exception 'tarifa_invalida';
    end if;
    update barberia.servicios set precio = p_precio, duracion_minutos = p_duracion where catalogo_id = p_catalogo_id
    returning jsonb_build_object('id', id, 'catalogo_id', catalogo_id, 'precio', precio, 'duracion_minutos', duracion_minutos) into v_resultado;
    if v_resultado is null then raise exception 'corte_no_encontrado'; end if;
    return v_resultado;
end;
$$;
revoke all on function barberia.admin_actualizar_corte(text,numeric,int) from public, anon, authenticated;
grant execute on function barberia.admin_actualizar_corte(text,numeric,int) to authenticated;

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261022000000_ubicacion_local.sql
-- #####################################################################
-- =====================================================================
-- UBICACIÓN DE LA BARBERÍA (minimapa "Encuéntranos")
-- Configuración compartida de una sola fila. Sin datos iniciales: hasta que
-- un administrador la guarde, la web muestra "Ubicación pendiente de configurar".
-- Aditiva e idempotente. Requiere es_admin() (migración de módulos).
-- =====================================================================

create table if not exists barberia.ubicacion_local (
    id boolean primary key default true check (id),
    nombre text not null check (length(trim(nombre)) between 1 and 120),
    direccion text not null check (length(trim(direccion)) between 1 and 250),
    referencia text check (referencia is null or length(referencia) <= 250),
    latitud numeric(9, 6) not null check (latitud between -90 and 90),
    longitud numeric(9, 6) not null check (longitud between -180 and 180),
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

alter table barberia.ubicacion_local enable row level security;
revoke all on barberia.ubicacion_local from anon, authenticated;

-- Lectura pública: null mientras no esté configurada
create or replace function barberia.ubicacion_publica() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'nombre', nombre, 'direccion', direccion, 'referencia', referencia,
        'latitud', latitud, 'longitud', longitud, 'actualizado_en', actualizado_en)
      from ubicacion_local where id
$$;

create or replace function barberia.admin_guardar_ubicacion(
    p_nombre text, p_direccion text, p_referencia text, p_latitud numeric, p_longitud numeric)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_admin();
    if coalesce(length(trim(p_nombre)), 0) = 0 or length(trim(p_nombre)) > 120 then
        raise exception 'ubicacion_nombre_invalido';
    end if;
    if coalesce(length(trim(p_direccion)), 0) = 0 or length(trim(p_direccion)) > 250 then
        raise exception 'ubicacion_direccion_invalida';
    end if;
    if length(p_referencia) > 250 then
        raise exception 'ubicacion_referencia_invalida';
    end if;
    -- (0, 0) es el valor por defecto de un formulario vacío, no un local real
    if p_latitud is null or p_longitud is null
       or p_latitud not between -90 and 90 or p_longitud not between -180 and 180
       or (p_latitud = 0 and p_longitud = 0) then
        raise exception 'ubicacion_coordenadas_invalidas';
    end if;

    insert into ubicacion_local (id, nombre, direccion, referencia, latitud, longitud, actualizado_en, actualizado_por)
    values (true, trim(p_nombre), trim(p_direccion), nullif(trim(p_referencia), ''),
            round(p_latitud, 6), round(p_longitud, 6), now(), auth.uid())
    on conflict (id) do update
       set nombre = excluded.nombre, direccion = excluded.direccion, referencia = excluded.referencia,
           latitud = excluded.latitud, longitud = excluded.longitud,
           actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por;
    return ubicacion_publica();
end;
$$;

revoke all on function barberia.ubicacion_publica() from public, anon, authenticated;
revoke all on function barberia.admin_guardar_ubicacion(text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function barberia.ubicacion_publica() to anon, authenticated;
grant execute on function barberia.admin_guardar_ubicacion(text, text, text, numeric, numeric) to authenticated;

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261022161508_restaurar_acceso_admin_seguro.sql
-- #####################################################################
-- El historial y los cambios de estado requieren la sesión administrativa real.
-- Las reservas públicas y la gestión por token conservan sus contratos.
alter table barberia.citas enable row level security;
drop policy if exists acceso_publico on barberia.citas;
drop policy if exists web_lectura on barberia.citas;
drop policy if exists web_estado on barberia.citas;
drop policy if exists web_reserva on barberia.citas;
drop policy if exists admin_historial on barberia.citas;
drop policy if exists admin_estado on barberia.citas;
create policy web_reserva on barberia.citas for insert to anon, authenticated
    with check (estado = 'pendiente');
create policy admin_historial on barberia.citas for select to authenticated
    using ((select barberia.es_admin()));
create policy admin_estado on barberia.citas for update to authenticated
    using ((select barberia.es_admin())) with check ((select barberia.es_admin()));
revoke update, delete on barberia.citas from anon;
grant select, insert, update on barberia.citas to authenticated;
-- No se concede borrado: cancelar preserva el historial y activa las reglas existentes.
notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261023000000_panel_administracion.sql
-- #####################################################################
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
alter table barberia.citas
    add column if not exists notas text,
    add column if not exists motivo_cancelacion text,
    add column if not exists cancelada_en timestamptz,
    add column if not exists cancelada_por uuid,
    add column if not exists no_asistio_en timestamptz,
    add column if not exists monto_cobrado numeric(10, 2),
    add column if not exists metodo_pago text,
    add column if not exists creada_por uuid;

alter table barberia.servicios
    add column if not exists descripcion text,
    add column if not exists categoria text,
    add column if not exists imagen_url text,
    add column if not exists activo boolean,
    add column if not exists destacado boolean,
    add column if not exists orden int,
    add column if not exists en_catalogo boolean;

-- Los servicios anteriores al catálogo no se mostraban en la web: se conservan reservables pero fuera del catálogo
update barberia.servicios set activo = true where activo is null;
update barberia.servicios set destacado = false where destacado is null;
update barberia.servicios set en_catalogo = (catalogo_id is not null) where en_catalogo is null;
alter table barberia.servicios
    alter column activo set default true, alter column activo set not null,
    alter column destacado set default false, alter column destacado set not null,
    alter column en_catalogo set default true, alter column en_catalogo set not null;

alter table barberia.barberos
    add column if not exists especialidad text,
    add column if not exists foto_url text,
    add column if not exists orden int;

-- Nuevas configuraciones de reserva (sin cambiar el comportamiento actual: 0 = sin límite)
update barberia.modulos_config
   set ajustes = jsonb_build_object('anticipacion_minima_minutos', 0, 'max_dias_reserva', 0, 'minutos_entre_citas', 0,
                                    'zona_horaria', 'America/Santo_Domingo') || ajustes
 where modulo = 'general';

-- ==========================================
-- TABLAS NUEVAS
-- ==========================================
-- Horario semanal: barbero_id '*' = horario general del negocio
create table if not exists barberia.horarios_semana (
    barbero_id text not null default '*',
    dia smallint not null check (dia between 0 and 6),
    activo boolean not null default true,
    abre time not null,
    cierra time not null,
    primary key (barbero_id, dia),
    check (cierra > abre)
);

-- Descansos recurrentes (p. ej. almuerzo). barbero_id null = todos
create table if not exists barberia.descansos (
    id uuid primary key default gen_random_uuid(),
    barbero_id text,
    dia smallint not null check (dia between 0 and 6),
    desde time not null,
    hasta time not null,
    check (hasta > desde)
);

-- Vacaciones, feriados, cierres y bloqueos. Sin horas = día completo. barbero_id null = todo el negocio
create table if not exists barberia.bloqueos (
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
create table if not exists barberia.servicio_barberos (
    servicio_id text not null,
    barbero_id text not null,
    primary key (servicio_id, barbero_id)
);

-- Usuarios de Supabase Auth con rol barbero (solo su agenda)
create table if not exists barberia.barbero_usuarios (
    user_id uuid primary key,
    barbero_id text not null,
    creado_en timestamptz not null default now()
);

create table if not exists barberia.clientes (
    telefono text primary key,
    nombre text,
    email text,
    notas text,
    preferencias jsonb not null default '{}'::jsonb,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

create table if not exists barberia.negocio_config (
    id boolean primary key default true check (id),
    datos jsonb not null default '{}'::jsonb,
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

create table if not exists barberia.plantillas_whatsapp (
    tipo text primary key check (tipo in ('confirmacion', 'recordatorio', 'cancelacion', 'reprogramacion')),
    texto text not null,
    meta_plantilla text not null default '',
    actualizado_en timestamptz not null default now()
);
insert into barberia.plantillas_whatsapp (tipo, texto, meta_plantilla) values
    ('confirmacion', E'Hola {cliente}, tu cita está confirmada.\n{servicio} con {barbero}\n{fecha} a las {hora}\n{ubicacion}\n{mapa}', ''),
    ('recordatorio', E'Hola {cliente}, te recordamos tu cita de {servicio} con {barbero} el {fecha} a las {hora}.\n{ubicacion}\n{mapa}',
        coalesce((select ajustes ->> 'plantilla_recordatorio' from barberia.modulos_config where modulo = 'whatsapp'), '')),
    ('cancelacion', E'Hola {cliente}, tu cita de {servicio} del {fecha} a las {hora} fue cancelada. Escríbenos para elegir otro horario.', ''),
    ('reprogramacion', E'Hola {cliente}, tu cita de {servicio} con {barbero} cambió al {fecha} a las {hora}.\n{ubicacion}\n{mapa}', '')
on conflict (tipo) do nothing;

create table if not exists barberia.auditoria (
    id bigint generated always as identity primary key,
    creado_en timestamptz not null default now(),
    usuario_id uuid,
    rol text,
    accion text not null,
    entidad text not null,
    entidad_id text,
    detalle jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_entidad_idx on barberia.auditoria (entidad, entidad_id);
create index if not exists auditoria_fecha_idx on barberia.auditoria (creado_en desc);

-- La cola de WhatsApp admite los nuevos tipos de aviso
do $$
declare
    v_nombre text;
begin
    select conname into v_nombre from pg_constraint
     where conrelid = 'barberia.mensajes_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%';
    if v_nombre is not null then
        execute format('alter table barberia.mensajes_whatsapp drop constraint %I', v_nombre);
    end if;
    alter table barberia.mensajes_whatsapp add constraint mensajes_whatsapp_tipo_check
        check (tipo in ('recordatorio', 'oferta_espera', 'recuperacion', 'confirmacion', 'cancelacion', 'reprogramacion'));
end $$;

-- ==========================================
-- ROLES
-- ==========================================
create or replace function barberia.barbero_actual() returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select bu.barbero_id from barbero_usuarios bu
      join barberos b on b.id::text = bu.barbero_id
     where bu.user_id = auth.uid() and b.activo is not false
$$;

create or replace function barberia._rol_panel() returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select case when es_admin() then 'admin' when barbero_actual() is not null then 'barbero' end
$$;

create or replace function barberia._exigir_panel(p_solo_admin boolean default false) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _rol_panel();
begin
    if v_rol is null or (p_solo_admin and v_rol <> 'admin') then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v_rol;
end;
$$;

create or replace function barberia.rol_panel() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'rol', _rol_panel(),
        'barbero_id', case when not es_admin() then barbero_actual() end,
        'barbero_nombre', (select nombre from barberos where id::text = barbero_actual()))
$$;

create or replace function barberia._auditar(p_accion text, p_entidad text, p_id text, p_detalle jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = barberia, pg_temp as $$
    insert into auditoria (usuario_id, rol, accion, entidad, entidad_id, detalle)
    values (auth.uid(), coalesce(_rol_panel(), case when auth.uid() is null then 'web' else 'usuario' end),
            p_accion, p_entidad, p_id, coalesce(p_detalle, '{}'::jsonb))
$$;

-- ==========================================
-- DISPONIBILIDAD
-- ==========================================
-- Jornada efectiva de un barbero en una fecha (abre = null: cerrado)
create or replace function barberia._jornada(p_barbero_id text, p_fecha date, out abre time, out cierra time)
language plpgsql stable set search_path = barberia, pg_temp as $$
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
create or replace function barberia._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean
language plpgsql stable set search_path = barberia, pg_temp as $$
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
create or replace function barberia._en_horario(p_hora time, p_duracion int) returns boolean
language sql stable set search_path = barberia, pg_temp as $$
    select p_hora + make_interval(mins => p_duracion) > p_hora
$$;

create or replace function barberia._barbero_hace_servicio(p_barbero_id text, p_servicio_id text) returns boolean
language sql stable set search_path = barberia, pg_temp as $$
    select not exists (select 1 from servicio_barberos where servicio_id = p_servicio_id)
        or exists (select 1 from servicio_barberos where servicio_id = p_servicio_id and barbero_id = p_barbero_id)
$$;

-- Reglas solo para reservas de clientes: anticipación mínima, límite de días y horas en la cuadrícula
create or replace function barberia._hora_publica_valida(p_barbero_id text, p_fecha date, p_hora time) returns boolean
language plpgsql stable set search_path = barberia, pg_temp as $$
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

create or replace function barberia._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select id::text from servicios
    where activo and (nombre = p_nombre or (catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre))
                      or id::text = p_nombre)
    order by case when catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre) then 0
                  when id::text = p_nombre then 1 else 2 end, id
    limit 1
$$;

create or replace function barberia._cotizar(p_servicio_id text, p_barbero_id text, p_fecha date, p_hora time, p_excluir_cita text default null)
returns jsonb
language plpgsql stable set search_path = barberia, pg_temp as $$
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
create or replace function barberia._horas_dia(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text, p_publico boolean)
returns jsonb
language plpgsql stable set search_path = barberia, pg_temp as $$
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

create or replace function barberia._horas_libres(p_servicio_id text, p_barbero_id text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language sql stable set search_path = barberia, pg_temp as $$
    select _horas_dia(p_servicio_id, p_barbero_id, p_fecha, p_excluir_cita, true)
$$;

-- ==========================================
-- TRIGGERS DE CITAS: precio/duración registrados, validación, auditoría y avisos
-- ==========================================
create or replace function barberia.tg_citas_panel_antes() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

drop trigger if exists citas_snapshot_panel on barberia.citas;
create trigger citas_snapshot_panel before insert or update on barberia.citas
    for each row execute function barberia.tg_citas_panel_antes();

create or replace function barberia._encolar_aviso(p_tipo text, p_cita_id text, p_clave text) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.tg_citas_panel_despues() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

drop trigger if exists citas_panel_eventos on barberia.citas;
create trigger citas_panel_eventos after insert or update on barberia.citas
    for each row execute function barberia.tg_citas_panel_despues();

-- ==========================================
-- LECTURAS PÚBLICAS (web de clientes)
-- ==========================================
create or replace function barberia.catalogo_publico() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'catalogo_id', s.catalogo_id, 'nombre', s.nombre, 'descripcion', s.descripcion,
        'categoria', s.categoria, 'imagen_url', s.imagen_url, 'precio', s.precio, 'duracion_minutos', s.duracion_minutos,
        'destacado', s.destacado, 'orden', s.orden,
        'barberos', (select jsonb_agg(sb.barbero_id) from servicio_barberos sb where sb.servicio_id = s.id::text))
        order by s.orden nulls last, s.catalogo_id nulls last, s.nombre), '[]'::jsonb)
      from servicios s
     where s.activo and (s.catalogo_id is not null or s.en_catalogo)
$$;

create or replace function barberia.barberos_publicos() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id::text, 'nombre', b.nombre, 'especialidad', b.especialidad, 'foto_url', b.foto_url)
        order by b.orden nulls last, b.nombre), '[]'::jsonb)
      from barberos b where b.activo is not false
$$;

create or replace function barberia.negocio_publico() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select datos from negocio_config where id
$$;

-- ==========================================
-- PANEL: CITAS
-- ==========================================
create or replace function barberia._estado_visual(c barberia.citas) returns text
language sql stable set search_path = barberia, pg_temp as $$
    select case when c.estado = 'cancelada' then 'cancelada'
                when c.no_asistio_en is not null then 'no_asistio'
                when c.completada_en is not null then 'completada'
                else c.estado end
$$;

create or replace function barberia._cita_json(c barberia.citas) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_citas(p_desde date, p_hasta date, p_barbero text default null,
                                              p_estado text default null, p_busqueda text default null)
returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_cita(p_cita text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_disponibilidad(p_barbero text, p_servicio text, p_fecha date, p_excluir_cita text default null)
returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_crear_cita(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_actualizar_cita(p_cita text, p_accion text, p_datos jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_resumen() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_horarios() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_guardar_reglas(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_guardar_semana(p_barbero text, p_dias jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_guardar_bloqueo(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_desactivar_bloqueo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia._imagen_valida(p_url text) returns boolean
language sql immutable set search_path = barberia, pg_temp as $$
    select p_url is null or p_url = ''
        or (length(p_url) <= 900000 and (p_url ~ '^https://[^\s"''<>]+$' or p_url ~ '^assets/[A-Za-z0-9_./-]+$'
            or p_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'))
$$;

create or replace function barberia.panel_servicios() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_guardar_servicio(p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_ordenar_servicios(p_ids text[]) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_barberos() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_guardar_barbero(p_id text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_vincular_usuario_barbero(p_barbero text, p_email text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_clientes(p_busqueda text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_cliente(p_telefono text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_guardar_cliente(p_telefono text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_guardar_negocio(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_plantillas() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_guardar_plantilla(p_tipo text, p_texto text, p_meta text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_reporte(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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

create or replace function barberia.panel_auditoria(p_limite int default 100) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
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
        execute format('alter table barberia.%I enable row level security', v_tabla);
        execute format('revoke all on barberia.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_publicas || v_panel || v_internas) loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_publicas) loop
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = any (v_panel) loop
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;

-- Rol barbero: lectura de su propia agenda (las modificaciones van por panel_actualizar_cita)
drop policy if exists barbero_agenda on barberia.citas;
create policy barbero_agenda on barberia.citas for select to authenticated
    using (barbero_id::text = (select barberia.barbero_actual()));

notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261023120000_fotos_barberos.sql
-- #####################################################################
-- Fotos propias de los barberos (archivos en assets/imagenes/barberos).
-- Solo reemplaza fotos vacías o de stock: no pisa una foto subida desde el panel.
update barberia.barberos b
   set foto_url = f.foto
  from (values ('Isaac Garcia', 'assets/imagenes/barberos/isaac-garcia.webp'),
               ('Yadfreidel Victoria', 'assets/imagenes/barberos/yadfreidel-victoria.webp'),
               ('Acxel Rosario', 'assets/imagenes/barberos/acxel-rosario.webp')) as f (nombre, foto)
 where b.nombre = f.nombre
   and (b.foto_url is null or b.foto_url = '' or b.foto_url like 'https://images.unsplash.com/%');

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

select case when exists (select 1 from barberia.admin_usuarios a join auth.users u on u.id = a.user_id
                          where lower(u.email) = lower('yafre2310@gmail.com'))
            then 'Instalado en barberia. Listo: yafre2310@gmail.com es administrador de barbería.'
            else 'Instalado en barberia. Falta: crea yafre2310@gmail.com en Authentication > Users y vuelve a ejecutar el bloque ADMINISTRADOR.'
       end as estado_instalacion;
