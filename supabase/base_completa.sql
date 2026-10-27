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
--   20261026000000_inventario_ventas_caja.sql
--   20261027000000_portafolio_ocupacion_reclamaciones.sql
--   20261028000000_cuentas_permisos_notificaciones.sql
--   20261029000000_acceso_barberos.sql
--   20261030000000_cuentas_barberos_seguras.sql
--   20261031000000_reserva_app_whatsapp.sql
--   20261101000000_avisos_reservas.sql
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
-- Solo si conserva los valores de fábrica: volver a ejecutar la instalación no pisa un horario cambiado en el panel
update barberia.modulos_config
   set ajustes = ajustes || '{"hora_apertura": "08:00", "hora_cierre": "22:00", "intervalo_minutos": 30}'::jsonb
 where modulo = 'general' and ajustes ->> 'hora_apertura' = '09:00' and ajustes ->> 'hora_cierre' = '20:00'
   and coalesce(ajustes ->> 'intervalo_minutos', '60') = '60';

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
-- MIGRACIÓN (trasladada a barberia): 20261026000000_inventario_ventas_caja.sql
-- #####################################################################
-- =====================================================================
-- INVENTARIO, VENTAS Y CAJA
--
-- Reglas:
-- * La existencia de un artículo solo cambia con un movimiento registrado
--   (inventario_movimientos). Nunca queda negativa. Los artículos se desactivan,
--   no se borran.
-- * Valoración: costo promedio ponderado móvil. Cada salida se valora al
--   promedio vigente; si el costo es desconocido queda nulo y los reportes
--   marcan el margen como incompleto.
-- * Una venta (comprobante interno, NO fiscal) guarda precio, costo y
--   descuento del momento. Los pagos, reembolsos y devoluciones son filas
--   nuevas: nada financiero confirmado se edita ni se borra.
-- * Estado de la cita, del servicio (completada) y del pago son
--   independientes. citas.pagada_en / monto_cobrado / metodo_pago se derivan
--   de la venta de la cita.
-- * Efectivo: requiere caja abierta. Se registra como cobrado el importe
--   aplicado, no lo entregado (el cambio se guarda aparte).
-- * Toda operación financiera lleva una clave única (idempotencia ante doble
--   clic, reintentos o recargas) y es atómica (una sola transacción).
-- * Solo administradores (panel_*). Sin acceso para clientes ni barberos.
-- ADITIVA: conserva citas, productos y cobros existentes.
-- =====================================================================

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;

-- ==========================================
-- AUXILIARES (esquema privado: no se exponen por la API)
-- ==========================================
create or replace function barberia_private._num(p jsonb, p_clave text) returns numeric
language sql immutable set search_path = barberia, pg_temp as $$
    select case jsonb_typeof(p -> p_clave)
        when 'number' then (p ->> p_clave)::numeric
        when 'string' then case when trim(p ->> p_clave) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(p ->> p_clave)::numeric end
    end
$$;

create or replace function barberia_private._uuid(p text) returns uuid
language sql immutable set search_path = barberia, pg_temp as $$
    select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- Unidades: grupo y factor a la unidad base del grupo
create or replace function barberia_private._unidad(p text, out grupo text, out factor numeric)
language sql immutable set search_path = barberia, pg_temp as $$
    select g, f from (values ('unidad', 'conteo', 1::numeric), ('par', 'par', 1), ('ml', 'volumen', 1), ('l', 'volumen', 1000),
                             ('g', 'masa', 1), ('kg', 'masa', 1000)) u (n, g, f) where n = p
$$;

create or replace function barberia_private._convertir(p_cantidad numeric, p_de text, p_a text) returns numeric
language plpgsql immutable set search_path = barberia, pg_temp as $$
declare
    v_de record;
    v_a record;
begin
    select * into v_de from barberia_private._unidad(p_de);
    select * into v_a from barberia_private._unidad(p_a);
    if v_de.grupo is null or v_a.grupo is null or v_de.grupo <> v_a.grupo then
        raise exception 'unidades_incompatibles';
    end if;
    return p_cantidad * v_de.factor / v_a.factor;
end;
$$;

-- Operaciones idempotentes: la misma clave devuelve el resultado ya guardado
create table if not exists barberia.operaciones_financieras (
    clave uuid primary key,
    tipo text not null,
    referencia text,
    resultado jsonb not null,
    usuario_id uuid,
    creado_en timestamptz not null default now()
);

create or replace function barberia_private._operacion_previa(p_clave uuid, p_tipo text) returns jsonb
language plpgsql set search_path = barberia, pg_temp as $$
declare
    v operaciones_financieras;
begin
    if p_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('operacion:' || p_clave::text, 0));
    select * into v from operaciones_financieras where clave = p_clave;
    if not found then
        return null;
    end if;
    if v.tipo <> p_tipo then
        raise exception 'clave_operacion_usada';
    end if;
    return v.resultado || jsonb_build_object('repetida', true);
end;
$$;

create or replace function barberia_private._registrar_operacion(p_clave uuid, p_tipo text, p_referencia text, p_resultado jsonb) returns jsonb
language sql set search_path = barberia, pg_temp as $$
    insert into operaciones_financieras (clave, tipo, referencia, resultado, usuario_id)
    values (p_clave, p_tipo, p_referencia, p_resultado, auth.uid());
    select p_resultado || jsonb_build_object('repetida', false);
$$;

-- Registros financieros confirmados: sin cambios ni borrado (se compensan con filas nuevas)
create or replace function barberia_private.tg_inmutable() returns trigger
language plpgsql set search_path = barberia, pg_temp as $$
begin
    raise exception 'registro_inmutable: % no admite %', tg_table_name, lower(tg_op);
end;
$$;

-- ==========================================
-- PROVEEDORES Y ARTÍCULOS (se amplía la tabla productos existente)
-- ==========================================
create table if not exists barberia.proveedores (
    id uuid primary key default gen_random_uuid(),
    nombre text not null check (length(trim(nombre)) between 1 and 120),
    telefono text,
    notas text,
    activo boolean not null default true,
    creado_en timestamptz not null default now()
);
create unique index if not exists proveedores_nombre_key on barberia.proveedores (lower(nombre));

create sequence if not exists barberia.productos_codigo_seq;
alter table barberia.productos
    add column if not exists codigo text,
    add column if not exists tipo text not null default 'venta',
    add column if not exists categoria text,
    add column if not exists unidad text not null default 'unidad',
    add column if not exists costo numeric(12, 2),
    add column if not exists costo_promedio numeric(14, 4) not null default 0,
    add column if not exists existencia_minima numeric(12, 3) not null default 0,
    add column if not exists proveedor_id uuid references barberia.proveedores (id),
    add column if not exists imagen_url text,
    add column if not exists creado_por uuid;
update barberia.productos set codigo = 'PRD-' || lpad(nextval('barberia.productos_codigo_seq')::text, 5, '0') where codigo is null;
alter table barberia.productos alter column codigo set default ('PRD-' || lpad(nextval('barberia.productos_codigo_seq')::text, 5, '0'));
alter table barberia.productos alter column codigo set not null;
create unique index if not exists productos_codigo_key on barberia.productos (lower(codigo));
-- Cantidades en mililitros o gramos: existencia decimal
alter table barberia.productos alter column stock type numeric(12, 3);
-- Los insumos pueden no tener precio de venta
alter table barberia.productos alter column precio drop not null;
alter table barberia.productos drop constraint if exists productos_tipo_check;
alter table barberia.productos add constraint productos_tipo_check check (tipo in ('venta', 'insumo'));
alter table barberia.productos drop constraint if exists productos_unidad_check;
alter table barberia.productos add constraint productos_unidad_check check (unidad in ('unidad', 'par', 'ml', 'l', 'g', 'kg'));
alter table barberia.productos drop constraint if exists productos_precio_venta_check;
alter table barberia.productos add constraint productos_precio_venta_check check (tipo = 'insumo' or precio is not null);
alter table barberia.productos drop constraint if exists productos_valores_check;
alter table barberia.productos add constraint productos_valores_check
    check (existencia_minima >= 0 and coalesce(costo, 0) >= 0 and costo_promedio >= 0);

create table if not exists barberia.inventario_movimientos (
    id bigint generated always as identity primary key,
    producto_id uuid not null references barberia.productos (id),
    tipo text not null check (tipo in ('inicial', 'compra', 'venta', 'consumo', 'devolucion', 'perdida', 'ajuste',
                                       'reserva', 'reserva_liberada', 'anulacion')),
    cantidad numeric(12, 3) not null check (cantidad <> 0),
    existencia_resultante numeric(12, 3) not null check (existencia_resultante >= 0),
    costo_unitario numeric(14, 4),
    motivo text,
    referencia_tipo text,
    referencia_id text,
    usuario_id uuid,
    creado_en timestamptz not null default now()
);
create index if not exists inventario_movimientos_producto_idx on barberia.inventario_movimientos (producto_id, creado_en);
create index if not exists inventario_movimientos_referencia_idx on barberia.inventario_movimientos (referencia_tipo, referencia_id);

-- La existencia no se edita directamente: solo _mover_inventario (que registra el movimiento)
create or replace function barberia_private.tg_productos_existencia() returns trigger
language plpgsql set search_path = barberia, pg_temp as $$
begin
    if new.stock is distinct from old.stock and coalesce(current_setting('inventario.movimiento', true), '') <> 'si' then
        raise exception 'existencia_solo_por_movimiento';
    end if;
    return new;
end;
$$;

-- Un artículo creado con existencia queda con su movimiento inicial
create or replace function barberia_private.tg_productos_alta() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    if new.stock <> 0 then
        if new.stock < 0 then
            raise exception 'sin_stock';
        end if;
        insert into inventario_movimientos (producto_id, tipo, cantidad, existencia_resultante, costo_unitario, motivo, usuario_id)
        values (new.id, 'inicial', new.stock, new.stock, nullif(new.costo_promedio, 0), 'Existencia al crear el artículo', auth.uid());
    end if;
    return new;
end;
$$;

drop trigger if exists productos_existencia on barberia.productos;
create trigger productos_existencia before update on barberia.productos
    for each row execute function barberia_private.tg_productos_existencia();
drop trigger if exists productos_alta on barberia.productos;
create trigger productos_alta after insert on barberia.productos
    for each row execute function barberia_private.tg_productos_alta();
drop trigger if exists inventario_movimientos_inmutable on barberia.inventario_movimientos;
create trigger inventario_movimientos_inmutable before update or delete on barberia.inventario_movimientos
    for each row execute function barberia_private.tg_inmutable();

-- Existencia previa a este módulo: queda documentada como existencia inicial (costo desconocido)
insert into barberia.inventario_movimientos (producto_id, tipo, cantidad, existencia_resultante, motivo)
select p.id, 'inicial', p.stock, p.stock, 'Existencia registrada antes del módulo de inventario (costo desconocido)'
  from barberia.productos p
 where p.stock > 0 and not exists (select 1 from barberia.inventario_movimientos m where m.producto_id = p.id);

-- Único punto que cambia existencias. Bloquea la fila del artículo: dos ventas
-- simultáneas de la última unidad no pueden pasar ambas.
create or replace function barberia_private._mover_inventario(p_producto uuid, p_cantidad numeric, p_tipo text, p_motivo text,
    p_ref_tipo text default null, p_ref_id text default null, p_costo numeric default null) returns numeric
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v productos;
    v_nuevo numeric;
    v_costo numeric;
    v_motivo text := p_motivo;
begin
    if p_cantidad is null or p_cantidad = 0 then
        raise exception 'cantidad_invalida';
    end if;
    select * into v from productos where id = p_producto for update;
    if not found then
        raise exception 'producto_no_encontrado';
    end if;
    v_nuevo := v.stock + p_cantidad;
    if v_nuevo < 0 then
        raise exception 'sin_stock' using detail = v.nombre;
    end if;
    if p_cantidad > 0 and p_tipo in ('inicial', 'compra') and p_costo is not null then
        if p_costo < 0 then
            raise exception 'costo_invalido';
        end if;
        v_costo := round(p_costo, 4);
        -- Costo promedio ponderado. Si las existencias anteriores no tenían costo conocido,
        -- se asume para ellas el costo de esta entrada (queda indicado en el movimiento).
        if v.stock > 0 and v.costo_promedio = 0 then
            v_motivo := coalesce(v_motivo || '. ', '') || 'Costo de la existencia anterior asumido igual al de esta entrada';
        end if;
        update productos
           set costo_promedio = case when v.stock > 0 and v.costo_promedio > 0
                                     then round((v.stock * v.costo_promedio + p_cantidad * p_costo) / v_nuevo, 4)
                                     else round(p_costo, 4) end,
               costo = round(p_costo, 2)
         where id = p_producto;
    else
        v_costo := nullif(v.costo_promedio, 0); -- valorado al promedio vigente; nulo = costo desconocido
    end if;
    perform set_config('inventario.movimiento', 'si', true);
    update productos set stock = v_nuevo, actualizado_en = now() where id = p_producto;
    perform set_config('inventario.movimiento', '', true);
    insert into inventario_movimientos (producto_id, tipo, cantidad, existencia_resultante, costo_unitario, motivo, referencia_tipo, referencia_id, usuario_id)
    values (p_producto, p_tipo, p_cantidad, v_nuevo, v_costo, v_motivo, p_ref_tipo, p_ref_id, auth.uid());
    return v_nuevo;
end;
$$;

-- ==========================================
-- CONSUMO DE INSUMOS POR SERVICIO (opcional, configurable)
-- ==========================================
create table if not exists barberia.servicio_consumos (
    servicio_id text not null,
    producto_id uuid not null references barberia.productos (id),
    cantidad numeric(12, 3) not null check (cantidad > 0),
    unidad text not null check (unidad in ('unidad', 'par', 'ml', 'l', 'g', 'kg')),
    activo boolean not null default true,
    actualizado_en timestamptz not null default now(),
    primary key (servicio_id, producto_id)
);

-- Descuenta los insumos configurados. Sin existencia suficiente no bloquea el servicio:
-- se omite ese insumo y queda registrado en la auditoría para revisarlo.
create or replace function barberia_private._aplicar_consumos(p_servicio text, p_veces numeric, p_ref_tipo text, p_ref_id text) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v record;
    v_cantidad numeric;
begin
    for v in select sc.*, p.unidad as unidad_producto, p.stock
               from servicio_consumos sc join productos p on p.id = sc.producto_id
              where sc.servicio_id = p_servicio and sc.activo and p.activo
              order by sc.producto_id loop
        continue when exists (select 1 from inventario_movimientos m where m.tipo = 'consumo' and m.producto_id = v.producto_id
                                and m.referencia_tipo = p_ref_tipo and m.referencia_id = p_ref_id);
        v_cantidad := round(barberia_private._convertir(v.cantidad, v.unidad, v.unidad_producto) * p_veces, 3);
        continue when v_cantidad <= 0;
        if (select stock from productos where id = v.producto_id for update) >= v_cantidad then
            perform barberia_private._mover_inventario(v.producto_id, -v_cantidad, 'consumo', 'Consumo configurado del servicio', p_ref_tipo, p_ref_id);
        else
            perform _auditar('consumo_sin_existencia', 'producto', v.producto_id::text,
                             jsonb_build_object('referencia', p_ref_tipo || ':' || p_ref_id, 'cantidad', v_cantidad));
        end if;
    end loop;
end;
$$;

-- Al completar una cita se descuentan sus insumos (una sola vez)
create or replace function barberia_private.tg_citas_consumo() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    if new.completada_en is not null and old.completada_en is null then
        begin
            perform barberia_private._aplicar_consumos(new.servicio_id::text, 1, 'cita', new.id::text);
        exception when others then
            raise warning 'inventario: no se pudo registrar el consumo de la cita %: %', new.id, sqlerrm;
        end;
    end if;
    return new;
end;
$$;
drop trigger if exists citas_consumo on barberia.citas;
create trigger citas_consumo after update of completada_en on barberia.citas
    for each row execute function barberia_private.tg_citas_consumo();

-- ==========================================
-- COMPRAS (recepción de mercancía; su pago es un gasto aparte)
-- ==========================================
create table if not exists barberia.compras (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    clave uuid not null unique,
    proveedor_id uuid references barberia.proveedores (id),
    fecha date not null,
    factura text,
    total numeric(12, 2) not null check (total >= 0),
    notas text,
    estado text not null default 'recibida' check (estado in ('recibida', 'anulada')),
    creado_por uuid,
    creado_en timestamptz not null default now(),
    anulada_en timestamptz,
    anulada_por uuid,
    motivo_anulacion text
);

create table if not exists barberia.compra_detalles (
    id bigint generated always as identity primary key,
    compra_id uuid not null references barberia.compras (id),
    producto_id uuid not null references barberia.productos (id),
    cantidad numeric(12, 3) not null check (cantidad > 0),
    costo_unitario numeric(14, 4) not null check (costo_unitario >= 0),
    subtotal numeric(12, 2) not null
);

-- ==========================================
-- CAJA
-- ==========================================
create table if not exists barberia.caja_sesiones (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
    fondo_inicial numeric(12, 2) not null check (fondo_inicial >= 0),
    abierta_en timestamptz not null default now(),
    abierta_por uuid,
    cerrada_en timestamptz,
    cerrada_por uuid,
    efectivo_esperado numeric(12, 2),
    efectivo_contado numeric(12, 2) check (efectivo_contado >= 0),
    diferencia numeric(12, 2),
    observacion text,
    resumen jsonb
);
-- Una sola caja abierta a la vez
create unique index if not exists caja_sesiones_una_abierta on barberia.caja_sesiones ((true)) where estado = 'abierta';

create table if not exists barberia.caja_movimientos (
    id bigint generated always as identity primary key,
    sesion_id uuid not null references barberia.caja_sesiones (id),
    tipo text not null check (tipo in ('entrada', 'retiro')),
    monto numeric(12, 2) not null check (monto > 0),
    motivo text not null check (length(trim(motivo)) >= 3),
    operacion uuid not null unique,
    creado_por uuid,
    creado_en timestamptz not null default now()
);

create table if not exists barberia.caja_correcciones (
    id bigint generated always as identity primary key,
    sesion_id uuid not null references barberia.caja_sesiones (id),
    campo text not null,
    antes numeric(12, 2),
    despues numeric(12, 2),
    motivo text not null,
    creado_por uuid,
    creado_en timestamptz not null default now()
);

-- ==========================================
-- VENTAS, PAGOS Y DEVOLUCIONES
-- ==========================================
create table if not exists barberia.ventas (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    clave uuid not null unique,
    cita_id text,
    cliente_nombre text,
    cliente_telefono text,
    origen text not null default 'caja' check (origen in ('caja', 'cita', 'historico')),
    estado text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
    subtotal numeric(12, 2) not null default 0,
    descuento numeric(12, 2) not null default 0,
    total numeric(12, 2) not null default 0,
    pagado numeric(12, 2) not null default 0,
    reembolsado numeric(12, 2) not null default 0,
    devuelto numeric(12, 2) not null default 0,
    descuento_motivo text,
    notas text,
    sesion_caja_id uuid references barberia.caja_sesiones (id),
    creado_por uuid,
    creado_en timestamptz not null default now(),
    anulada_en timestamptz,
    anulada_por uuid,
    motivo_anulacion text,
    constraint ventas_reembolso_valido check (reembolsado >= 0 and reembolsado <= pagado),
    constraint ventas_sin_saldo_a_favor check (pagado - reembolsado <= total - devuelto),
    constraint ventas_devolucion_valida check (devuelto >= 0 and devuelto <= total)
);
-- Una cita se cobra con una sola venta activa
create unique index if not exists ventas_cita_activa on barberia.ventas (cita_id) where cita_id is not null and estado <> 'anulada';
create index if not exists ventas_fecha_idx on barberia.ventas (creado_en);

create table if not exists barberia.venta_detalles (
    id bigint generated always as identity primary key,
    venta_id uuid not null references barberia.ventas (id),
    tipo text not null check (tipo in ('servicio', 'producto')),
    servicio_id text,
    producto_id uuid references barberia.productos (id),
    barbero_id text,
    cita_productos_id uuid,
    descripcion text not null,
    cantidad numeric(12, 3) not null check (cantidad > 0),
    precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),
    descuento numeric(12, 2) not null default 0 check (descuento >= 0),
    total numeric(12, 2) not null check (total >= 0),
    costo_unitario numeric(14, 4),
    cantidad_devuelta numeric(12, 3) not null default 0,
    importe_devuelto numeric(12, 2) not null default 0,
    creado_en timestamptz not null default now(),
    check ((tipo = 'servicio') = (servicio_id is not null)),
    check ((tipo = 'producto') = (producto_id is not null)),
    check (cantidad_devuelta between 0 and cantidad),
    check (importe_devuelto between 0 and total)
);
create index if not exists venta_detalles_venta_idx on barberia.venta_detalles (venta_id);

create table if not exists barberia.pagos (
    id bigint generated always as identity primary key,
    venta_id uuid not null references barberia.ventas (id),
    tipo text not null check (tipo in ('pago', 'reembolso')),
    metodo text not null check (metodo in ('efectivo', 'tarjeta', 'transferencia', 'otro')),
    monto numeric(12, 2) not null check (monto > 0),
    recibido numeric(12, 2),
    cambio numeric(12, 2) not null default 0 check (cambio >= 0),
    referencia text,
    es_anticipo boolean not null default false,
    es_historico boolean not null default false,
    sesion_caja_id uuid references barberia.caja_sesiones (id),
    operacion uuid,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    check (metodo <> 'efectivo' or sesion_caja_id is not null or es_historico)
);
create index if not exists pagos_venta_idx on barberia.pagos (venta_id);
create index if not exists pagos_fecha_idx on barberia.pagos (creado_en);

create table if not exists barberia.devoluciones (
    id bigint generated always as identity primary key,
    venta_id uuid not null references barberia.ventas (id),
    detalle_id bigint not null references barberia.venta_detalles (id),
    cantidad numeric(12, 3) not null default 0 check (cantidad >= 0),
    importe numeric(12, 2) not null check (importe >= 0),
    repuesto boolean not null default false,
    motivo text not null,
    operacion uuid not null,
    creado_por uuid,
    creado_en timestamptz not null default now()
);

-- ==========================================
-- GASTOS
-- ==========================================
create table if not exists barberia.gastos (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    clave uuid not null unique,
    fecha date not null,
    categoria text not null check (categoria in ('compra_mercancia', 'alquiler', 'servicios', 'nomina', 'mantenimiento',
                                                 'limpieza', 'publicidad', 'impuestos_tasas', 'otros')),
    descripcion text not null check (length(trim(descripcion)) between 3 and 300),
    monto numeric(12, 2) not null check (monto > 0),
    medio text not null check (medio in ('efectivo_caja', 'efectivo_externo', 'tarjeta', 'transferencia')),
    sesion_caja_id uuid references barberia.caja_sesiones (id),
    responsable text,
    comprobante text,
    comprobante_imagen text,
    compra_id uuid references barberia.compras (id),
    creado_por uuid,
    creado_en timestamptz not null default now(),
    anulado_en timestamptz,
    anulado_por uuid,
    motivo_anulacion text,
    check ((medio = 'efectivo_caja') = (sesion_caja_id is not null)),
    check (compra_id is null or categoria = 'compra_mercancia')
);
create index if not exists gastos_fecha_idx on barberia.gastos (fecha);

-- Filas que nunca cambian ni se borran
do $$
declare
    v_tabla text;
begin
    foreach v_tabla in array array['pagos', 'devoluciones', 'caja_movimientos', 'caja_correcciones', 'operaciones_financieras', 'compra_detalles'] loop
        execute format('drop trigger if exists %I on barberia.%I', v_tabla || '_inmutable', v_tabla);
        execute format('create trigger %I before update or delete on barberia.%I for each row execute function barberia_private.tg_inmutable()',
                       v_tabla || '_inmutable', v_tabla);
    end loop;
    -- Con cambios de estado (anulación, cierre) pero sin borrado
    foreach v_tabla in array array['ventas', 'compras', 'gastos', 'caja_sesiones', 'productos', 'proveedores'] loop
        execute format('drop trigger if exists %I on barberia.%I', v_tabla || '_sin_borrado', v_tabla);
        execute format('create trigger %I before delete on barberia.%I for each row execute function barberia_private.tg_inmutable()',
                       v_tabla || '_sin_borrado', v_tabla);
    end loop;
end $$;

-- En una línea de venta solo cambia lo devuelto
create or replace function barberia_private.tg_venta_detalle_fija() returns trigger
language plpgsql set search_path = barberia, pg_temp as $$
begin
    if tg_op = 'DELETE' or (new.venta_id, new.tipo, new.servicio_id, new.producto_id, new.barbero_id, new.descripcion, new.cantidad,
                            new.precio_unitario, new.descuento, new.total, new.costo_unitario)
           is distinct from (old.venta_id, old.tipo, old.servicio_id, old.producto_id, old.barbero_id, old.descripcion, old.cantidad,
                             old.precio_unitario, old.descuento, old.total, old.costo_unitario) then
        raise exception 'registro_inmutable: venta_detalles';
    end if;
    return new;
end;
$$;
drop trigger if exists venta_detalles_fija on barberia.venta_detalles;
create trigger venta_detalles_fija before update or delete on barberia.venta_detalles
    for each row execute function barberia_private.tg_venta_detalle_fija();

-- ==========================================
-- CAJA: AUXILIARES
-- ==========================================
-- Caja abierta (FOR SHARE: un cierre simultáneo espera a que termine el cobro)
create or replace function barberia_private._caja_abierta() returns uuid
language sql set search_path = barberia, pg_temp as $$
    select id from caja_sesiones where estado = 'abierta' for share
$$;

create or replace function barberia_private._caja_resumen(p_sesion uuid) returns jsonb
language plpgsql stable set search_path = barberia, pg_temp as $$
declare
    s caja_sesiones;
    r jsonb;
begin
    select * into s from caja_sesiones where id = p_sesion;
    with p as (
        select coalesce(sum(monto) filter (where tipo = 'pago' and metodo = 'efectivo'), 0) cobros_efectivo,
               coalesce(sum(monto) filter (where tipo = 'reembolso' and metodo = 'efectivo'), 0) reembolsos_efectivo,
               coalesce(sum(monto) filter (where tipo = 'pago' and metodo = 'tarjeta'), 0) cobros_tarjeta,
               coalesce(sum(monto) filter (where tipo = 'pago' and metodo = 'transferencia'), 0) cobros_transferencia,
               coalesce(sum(monto) filter (where tipo = 'pago' and metodo = 'otro'), 0) cobros_otro,
               coalesce(sum(monto) filter (where tipo = 'reembolso' and metodo <> 'efectivo'), 0) reembolsos_otros_medios,
               coalesce(sum(cambio) filter (where tipo = 'pago'), 0) cambio_entregado
          from pagos where sesion_caja_id = p_sesion
    ), m as (
        select coalesce(sum(monto) filter (where tipo = 'entrada'), 0) entradas, coalesce(sum(monto) filter (where tipo = 'retiro'), 0) retiros
          from caja_movimientos where sesion_id = p_sesion
    ), g as (
        select coalesce(sum(monto), 0) gastos_efectivo from gastos where sesion_caja_id = p_sesion and anulado_en is null
    )
    select jsonb_build_object(
        'fondo_inicial', s.fondo_inicial, 'cobros_efectivo', p.cobros_efectivo, 'reembolsos_efectivo', p.reembolsos_efectivo,
        'entradas', m.entradas, 'retiros', m.retiros, 'gastos_efectivo', g.gastos_efectivo,
        'cobros_tarjeta', p.cobros_tarjeta, 'cobros_transferencia', p.cobros_transferencia, 'cobros_otro', p.cobros_otro,
        'reembolsos_otros_medios', p.reembolsos_otros_medios, 'cambio_entregado', p.cambio_entregado,
        'ventas', (select count(*) from ventas where sesion_caja_id = p_sesion and estado <> 'anulada'),
        'efectivo_esperado', s.fondo_inicial + p.cobros_efectivo - p.reembolsos_efectivo + m.entradas - m.retiros - g.gastos_efectivo)
      into r from p, m, g;
    return r;
end;
$$;

-- Una salida de efectivo no puede dejar la caja en negativo
create or replace function barberia_private._verificar_efectivo(p_sesion uuid, p_salida numeric) returns void
language plpgsql set search_path = barberia, pg_temp as $$
begin
    if (barberia_private._caja_resumen(p_sesion) ->> 'efectivo_esperado')::numeric < p_salida then
        raise exception 'efectivo_insuficiente_en_caja';
    end if;
end;
$$;

-- ==========================================
-- VENTAS: AUXILIARES
-- ==========================================
create or replace function barberia_private._venta_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'id', v.id, 'numero', v.numero, 'estado', v.estado, 'origen', v.origen, 'cita_id', v.cita_id,
        'cliente_nombre', v.cliente_nombre, 'cliente_telefono', v.cliente_telefono,
        'subtotal', v.subtotal, 'descuento', v.descuento, 'total', v.total, 'pagado', v.pagado, 'reembolsado', v.reembolsado,
        'devuelto', v.devuelto, 'cobrado_neto', v.pagado - v.reembolsado,
        'saldo', case when v.estado = 'anulada' then 0 else v.total - v.devuelto - (v.pagado - v.reembolsado) end,
        'estado_pago', case when v.estado = 'anulada' then 'anulada'
                            when v.reembolsado > 0 and v.pagado - v.reembolsado = 0 then 'reembolsada'
                            when v.total - v.devuelto - (v.pagado - v.reembolsado) <= 0 then 'pagada'
                            when v.pagado - v.reembolsado > 0 then 'parcial' else 'pendiente' end,
        'descuento_motivo', v.descuento_motivo, 'notas', v.notas, 'creado_en', v.creado_en,
        'creado_por', (select email from auth.users where id = v.creado_por),
        'anulada_en', v.anulada_en, 'motivo_anulacion', v.motivo_anulacion,
        'anulada_por', (select email from auth.users where id = v.anulada_por),
        'cita', (select jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'estado', c.estado,
                                           'completada', c.completada_en is not null, 'no_asistio', c.no_asistio_en is not null)
                   from citas c where c.id::text = v.cita_id),
        'lineas', coalesce((select jsonb_agg(jsonb_build_object(
                'id', d.id, 'tipo', d.tipo, 'descripcion', d.descripcion, 'servicio_id', d.servicio_id, 'producto_id', d.producto_id,
                'barbero_id', d.barbero_id, 'barbero', b.nombre, 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario,
                'descuento', d.descuento, 'total', d.total, 'costo_unitario', d.costo_unitario,
                'cantidad_devuelta', d.cantidad_devuelta, 'importe_devuelto', d.importe_devuelto,
                'unidad', (select unidad from productos where id = d.producto_id)) order by d.id)
            from venta_detalles d left join barberos b on b.id::text = d.barbero_id where d.venta_id = v.id), '[]'::jsonb),
        'pagos', coalesce((select jsonb_agg(jsonb_build_object(
                'id', p.id, 'tipo', p.tipo, 'metodo', p.metodo, 'monto', p.monto, 'recibido', p.recibido, 'cambio', p.cambio,
                'referencia', p.referencia, 'es_anticipo', p.es_anticipo, 'es_historico', p.es_historico, 'creado_en', p.creado_en,
                'usuario', (select email from auth.users where id = p.creado_por)) order by p.id)
            from pagos p where p.venta_id = v.id), '[]'::jsonb),
        'devoluciones', coalesce((select jsonb_agg(jsonb_build_object(
                'detalle_id', x.detalle_id, 'cantidad', x.cantidad, 'importe', x.importe, 'repuesto', x.repuesto, 'motivo', x.motivo,
                'creado_en', x.creado_en, 'usuario', (select email from auth.users where id = x.creado_por)) order by x.id)
            from devoluciones x where x.venta_id = v.id), '[]'::jsonb),
        'comprobante', 'Comprobante interno. No es un comprobante fiscal.')
      from ventas v where v.id = p_id
$$;

-- La cita refleja el cobro de su venta (sin pagos inventados)
create or replace function barberia_private._sincronizar_cita(p_venta uuid) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v ventas;
    v_metodo text;
    v_neto numeric;
    v_debe numeric;
begin
    select * into v from ventas where id = p_venta;
    if v.cita_id is null then
        return;
    end if;
    v_neto := v.pagado - v.reembolsado;
    v_debe := v.total - v.devuelto;
    select case when count(distinct metodo) = 1 then min(metodo) else 'mixto' end into v_metodo
      from pagos where venta_id = v.id and tipo = 'pago';
    update citas
       set monto_cobrado = case when v.estado <> 'anulada' and v_neto > 0 then v_neto end,
           metodo_pago = case when v.estado <> 'anulada' and v_neto > 0 then v_metodo end,
           -- Pagada: el cobro neto cubre lo que se debe. Tras una devolución real se conserva la fecha de pago
           -- (la visita sí se pagó); si solo se deshizo el cobro, deja de estar pagada.
           pagada_en = case when v.estado = 'anulada' then null
                            when v_neto > 0 and v_neto >= v_debe then coalesce(pagada_en, now())
                            when v_debe = 0 and v.total = 0 then coalesce(pagada_en, now())
                            when v_debe = 0 and v.devuelto > 0 then pagada_en end,
           reembolsada_en = case when v.reembolsado > 0 and v_neto = 0 then coalesce(reembolsada_en, now()) else reembolsada_en end
     where id::text = v.cita_id;
end;
$$;

-- ==========================================
-- VENTAS Y COBROS
-- ==========================================
-- p_datos: { clave, venta_id? | cita_id?, cliente?: {nombre, telefono}, lineas: [{tipo, servicio_id|producto_id,
--   cantidad, descuento, barbero_id}], descuento_motivo?, notas?, pagos: [{metodo, monto, recibido?, referencia?}] }
-- Crea la venta (o amplía la existente) y registra los pagos en una sola transacción.
create or replace function barberia.panel_venta_cobrar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_venta ventas;
    v_cita citas;
    v_nueva boolean := false;
    v_linea jsonb;
    v_pago jsonb;
    v_prod productos;
    v_serv servicios;
    v_cant numeric;
    v_desc numeric;
    v_bruto numeric;
    v_barbero text;
    v_det bigint;
    v_cp record;
    v_metodo text;
    v_monto numeric;
    v_recibido numeric;
    v_sesion uuid;
    v_saldo numeric;
    v_pagado numeric := 0;
    v_cambio numeric := 0;
    v_lineas int := 0;
    v_hay_descuento boolean := false;
    v_anticipo boolean := false;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'cobro');
    if v_previa is not null then
        return v_previa;
    end if;

    if barberia_private._uuid(p_datos ->> 'venta_id') is not null then
        select * into v_venta from ventas where id = barberia_private._uuid(p_datos ->> 'venta_id') for update;
        if not found or v_venta.estado = 'anulada' then
            raise exception 'venta_no_disponible';
        end if;
    elsif nullif(p_datos ->> 'cita_id', '') is not null then
        select * into v_cita from citas where id::text = p_datos ->> 'cita_id' for update;
        if not found then
            raise exception 'cita_no_encontrada';
        end if;
        select * into v_venta from ventas where cita_id = v_cita.id::text and estado <> 'anulada' for update;
        if not found then
            if v_cita.estado = 'cancelada' then
                raise exception 'cita_cancelada';
            end if;
            insert into ventas (clave, cita_id, cliente_nombre, cliente_telefono, origen, creado_por, sesion_caja_id)
            values (v_clave, v_cita.id::text, v_cita.nombre_cliente, v_cita.telefono_cliente, 'cita', auth.uid(), barberia_private._caja_abierta())
            returning * into v_venta;
            v_nueva := true;
            -- El servicio con el precio y la promoción registrados en la reserva
            insert into venta_detalles (venta_id, tipo, servicio_id, barbero_id, descripcion, cantidad, precio_unitario, descuento, total)
            select v_venta.id, 'servicio', s.id::text, v_cita.barbero_id::text, s.nombre, 1, x.precio, x.descuento, x.precio - x.descuento
              from servicios s,
                   lateral (select round(coalesce(v_cita.precio_servicio, s.precio, 0), 2) as precio) p,
                   lateral (select p.precio, round(least(coalesce(v_cita.descuento, 0), p.precio), 2) as descuento) x
             where s.id = v_cita.servicio_id;
            -- Productos reservados en la web: la reserva se convierte en venta
            for v_cp in select cp.*, pr.nombre, pr.costo_promedio from cita_productos cp join productos pr on pr.id = cp.producto_id
                         where cp.cita_id = v_cita.id::text and cp.estado = 'reservado' order by cp.producto_id for update of cp loop
                perform barberia_private._mover_inventario(v_cp.producto_id, v_cp.cantidad, 'reserva_liberada', 'Reserva web convertida en venta', 'venta', v_venta.id::text);
                perform barberia_private._mover_inventario(v_cp.producto_id, -v_cp.cantidad, 'venta', 'Venta #' || v_venta.numero, 'venta', v_venta.id::text);
                insert into venta_detalles (venta_id, tipo, producto_id, cita_productos_id, descripcion, cantidad, precio_unitario, descuento, total, costo_unitario)
                values (v_venta.id, 'producto', v_cp.producto_id, v_cp.id, v_cp.nombre, v_cp.cantidad, v_cp.precio_unitario, 0, v_cp.subtotal,
                        nullif(v_cp.costo_promedio, 0));
                update cita_productos set estado = 'entregado', actualizado_en = now() where id = v_cp.id;
            end loop;
        end if;
    else
        insert into ventas (clave, cliente_nombre, cliente_telefono, origen, notas, creado_por, sesion_caja_id)
        values (v_clave, nullif(left(trim(p_datos #>> '{cliente,nombre}'), 120), ''), normalizar_telefono(p_datos #>> '{cliente,telefono}'),
                'caja', nullif(left(trim(p_datos ->> 'notas'), 500), ''), auth.uid(), barberia_private._caja_abierta())
        returning * into v_venta;
        v_nueva := true;
    end if;

    -- Líneas nuevas: precio y costo del momento
    for v_linea in select * from jsonb_array_elements(coalesce(p_datos -> 'lineas', '[]'::jsonb)) loop
        v_lineas := v_lineas + 1;
        v_cant := barberia_private._num(v_linea, 'cantidad');
        v_desc := round(coalesce(barberia_private._num(v_linea, 'descuento'), 0), 2);
        if v_cant is null or v_cant <= 0 or v_cant > 10000 or v_desc < 0 then
            raise exception 'linea_invalida';
        end if;
        if v_linea ->> 'tipo' = 'producto' then
            select * into v_prod from productos where id = barberia_private._uuid(v_linea ->> 'producto_id') for update;
            if not found or not v_prod.activo or v_prod.tipo <> 'venta' or v_prod.precio is null then
                raise exception 'producto_no_vendible';
            end if;
            if v_prod.unidad in ('unidad', 'par') and v_cant <> trunc(v_cant) then
                raise exception 'cantidad_invalida';
            end if;
            v_bruto := round(v_cant * v_prod.precio, 2);
            if v_desc > v_bruto then
                raise exception 'descuento_invalido';
            end if;
            insert into venta_detalles (venta_id, tipo, producto_id, descripcion, cantidad, precio_unitario, descuento, total, costo_unitario)
            values (v_venta.id, 'producto', v_prod.id, v_prod.nombre, v_cant, v_prod.precio, v_desc, v_bruto - v_desc, nullif(v_prod.costo_promedio, 0));
            perform barberia_private._mover_inventario(v_prod.id, -v_cant, 'venta', 'Venta #' || v_venta.numero, 'venta', v_venta.id::text);
        elsif v_linea ->> 'tipo' = 'servicio' then
            select * into v_serv from servicios where id::text = v_linea ->> 'servicio_id' and activo;
            if not found then
                raise exception 'servicio_no_disponible';
            end if;
            if v_cant <> trunc(v_cant) then
                raise exception 'cantidad_invalida';
            end if;
            v_barbero := nullif(v_linea ->> 'barbero_id', '');
            if v_barbero is null then
                raise exception 'barbero_requerido';
            end if;
            if not exists (select 1 from barberos where id::text = v_barbero and activo is not false) then
                raise exception 'barbero_no_disponible';
            end if;
            v_bruto := round(v_cant * v_serv.precio, 2);
            if v_desc > v_bruto then
                raise exception 'descuento_invalido';
            end if;
            insert into venta_detalles (venta_id, tipo, servicio_id, barbero_id, descripcion, cantidad, precio_unitario, descuento, total)
            values (v_venta.id, 'servicio', v_serv.id::text, v_barbero, v_serv.nombre, v_cant, v_serv.precio, v_desc, v_bruto - v_desc)
            returning id into v_det;
            -- Servicio realizado sin cita: se descuentan sus insumos configurados
            perform barberia_private._aplicar_consumos(v_serv.id::text, v_cant, 'venta', v_venta.id::text || ':' || v_det);
        else
            raise exception 'linea_invalida';
        end if;
        v_hay_descuento := v_hay_descuento or v_desc > 0;
    end loop;

    -- Los descuentos manuales quedan justificados (solo administradores llegan aquí)
    if v_hay_descuento and coalesce(length(trim(p_datos ->> 'descuento_motivo')), 0) < 3 then
        raise exception 'motivo_descuento_requerido';
    end if;

    update ventas v
       set subtotal = t.subtotal, descuento = t.descuento, total = t.total,
           descuento_motivo = case when v_hay_descuento then left(trim(p_datos ->> 'descuento_motivo'), 300) else v.descuento_motivo end
      from (select coalesce(sum(round(cantidad * precio_unitario, 2)), 0) subtotal, coalesce(sum(descuento), 0) descuento,
                   coalesce(sum(total), 0) total, count(*) n
              from venta_detalles where venta_id = v_venta.id) t
     where v.id = v_venta.id
    returning v.* into v_venta;
    if not exists (select 1 from venta_detalles where venta_id = v_venta.id) then
        raise exception 'venta_vacia';
    end if;

    -- Pagos: solo el importe aplicado cuenta como cobrado; el cambio se registra aparte
    v_saldo := v_venta.total - v_venta.devuelto - (v_venta.pagado - v_venta.reembolsado);
    v_anticipo := v_venta.cita_id is not null
        and exists (select 1 from citas where id::text = v_venta.cita_id and completada_en is null);
    for v_pago in select * from jsonb_array_elements(coalesce(p_datos -> 'pagos', '[]'::jsonb)) loop
        v_metodo := v_pago ->> 'metodo';
        v_monto := round(barberia_private._num(v_pago, 'monto'), 2);
        v_recibido := coalesce(round(barberia_private._num(v_pago, 'recibido'), 2), v_monto);
        if v_metodo is null or v_metodo not in ('efectivo', 'tarjeta', 'transferencia', 'otro') or v_monto is null or v_monto <= 0 or v_monto > 10000000 then
            raise exception 'pago_invalido';
        end if;
        v_sesion := barberia_private._caja_abierta();
        if v_metodo = 'efectivo' then
            if v_sesion is null then
                raise exception 'caja_cerrada';
            end if;
            if v_recibido < v_monto then
                raise exception 'efectivo_insuficiente';
            end if;
        elsif v_recibido <> v_monto then
            raise exception 'pago_invalido';
        end if;
        v_pagado := v_pagado + v_monto;
        if v_pagado > v_saldo then
            raise exception 'pago_excede_saldo';
        end if;
        insert into pagos (venta_id, tipo, metodo, monto, recibido, cambio, referencia, es_anticipo, sesion_caja_id, operacion, creado_por)
        values (v_venta.id, 'pago', v_metodo, v_monto, case when v_metodo = 'efectivo' then v_recibido end, v_recibido - v_monto,
                nullif(left(trim(v_pago ->> 'referencia'), 80), ''), v_anticipo, v_sesion, v_clave, auth.uid());
        v_cambio := v_cambio + (v_recibido - v_monto);
    end loop;
    if not v_nueva and v_lineas = 0 and v_pagado = 0 then
        raise exception 'operacion_vacia';
    end if;
    update ventas set pagado = pagado + v_pagado where id = v_venta.id returning * into v_venta;

    -- Sin cliente identificado no queda saldo pendiente
    if v_venta.cita_id is null and v_venta.cliente_telefono is null
       and v_venta.total - v_venta.devuelto - (v_venta.pagado - v_venta.reembolsado) > 0 then
        raise exception 'venta_sin_cliente_debe_pagarse';
    end if;

    perform barberia_private._sincronizar_cita(v_venta.id);
    perform _auditar(case when v_nueva then 'venta_confirmada' else 'venta_ampliada' end, 'venta', v_venta.id::text,
        jsonb_build_object('numero', v_venta.numero, 'total', v_venta.total, 'cobrado', v_pagado, 'cambio', v_cambio,
                           'descuento', v_venta.descuento, 'motivo_descuento', v_venta.descuento_motivo, 'cita', v_venta.cita_id));
    return barberia_private._registrar_operacion(v_clave, 'cobro', v_venta.id::text,
                                        barberia_private._venta_json(v_venta.id) || jsonb_build_object('cambio', v_cambio, 'cobrado_ahora', v_pagado));
end;
$$;

-- p_datos: { clave, venta_id, motivo, lineas?: [{detalle_id, cantidad?, importe?, reponer?}], reembolsos?: [{metodo, monto}] }
-- Devolución de líneas (reduce la venta) y/o devolución de dinero. Solo repone inventario si se indica
-- que el producto regresó y es apto (reponer = true).
create or replace function barberia.panel_venta_reembolsar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_venta ventas;
    v_motivo text := trim(p_datos ->> 'motivo');
    v_linea jsonb;
    v_det venta_detalles;
    v_cant numeric;
    v_importe numeric;
    v_reponer boolean;
    v_devuelto numeric := 0;
    v_r jsonb;
    v_metodo text;
    v_monto numeric;
    v_sesion uuid;
    v_reembolsado numeric := 0;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'reembolso');
    if v_previa is not null then
        return v_previa;
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    select * into v_venta from ventas where id = barberia_private._uuid(p_datos ->> 'venta_id') for update;
    if not found or v_venta.estado = 'anulada' then
        raise exception 'venta_no_disponible';
    end if;

    for v_linea in select * from jsonb_array_elements(coalesce(p_datos -> 'lineas', '[]'::jsonb)) loop
        select * into v_det from venta_detalles where id = barberia_private._num(v_linea, 'detalle_id')::bigint and venta_id = v_venta.id for update;
        if not found then
            raise exception 'linea_invalida';
        end if;
        v_cant := case when v_det.tipo = 'producto' then coalesce(barberia_private._num(v_linea, 'cantidad'), 0) else 0 end;
        if v_cant < 0 or v_cant > v_det.cantidad - v_det.cantidad_devuelta
           or (v_det.tipo = 'producto' and v_cant <> trunc(v_cant) and (select unidad from productos where id = v_det.producto_id) in ('unidad', 'par')) then
            raise exception 'cantidad_devolucion_invalida';
        end if;
        -- Importe por defecto: parte proporcional de la línea
        v_importe := round(coalesce(barberia_private._num(v_linea, 'importe'),
                                    case when v_det.tipo = 'producto' then v_det.total * v_cant / v_det.cantidad else v_det.total - v_det.importe_devuelto end), 2);
        if v_importe < 0 or v_importe > v_det.total - v_det.importe_devuelto or (v_importe = 0 and v_cant = 0) then
            raise exception 'importe_devolucion_invalido';
        end if;
        v_reponer := v_det.tipo = 'producto' and v_cant > 0 and coalesce((v_linea ->> 'reponer')::boolean, false);
        if v_reponer then
            perform barberia_private._mover_inventario(v_det.producto_id, v_cant, 'devolucion', 'Devolución de la venta #' || v_venta.numero || ': ' || v_motivo,
                                              'venta', v_venta.id::text);
        end if;
        update venta_detalles set cantidad_devuelta = cantidad_devuelta + v_cant, importe_devuelto = importe_devuelto + v_importe where id = v_det.id;
        insert into devoluciones (venta_id, detalle_id, cantidad, importe, repuesto, motivo, operacion, creado_por)
        values (v_venta.id, v_det.id, v_cant, v_importe, v_reponer, v_motivo, v_clave, auth.uid());
        v_devuelto := v_devuelto + v_importe;
    end loop;

    for v_r in select * from jsonb_array_elements(coalesce(p_datos -> 'reembolsos', '[]'::jsonb)) loop
        v_metodo := v_r ->> 'metodo';
        v_monto := round(barberia_private._num(v_r, 'monto'), 2);
        if v_metodo is null or v_metodo not in ('efectivo', 'tarjeta', 'transferencia', 'otro') or v_monto is null or v_monto <= 0 then
            raise exception 'pago_invalido';
        end if;
        v_sesion := barberia_private._caja_abierta();
        if v_metodo = 'efectivo' then
            if v_sesion is null then
                raise exception 'caja_cerrada';
            end if;
            perform barberia_private._verificar_efectivo(v_sesion, v_monto);
        end if;
        insert into pagos (venta_id, tipo, metodo, monto, sesion_caja_id, operacion, creado_por)
        values (v_venta.id, 'reembolso', v_metodo, v_monto, v_sesion, v_clave, auth.uid());
        v_reembolsado := v_reembolsado + v_monto;
    end loop;

    if v_devuelto = 0 and v_reembolsado = 0 then
        raise exception 'operacion_vacia';
    end if;
    -- Las restricciones de ventas impiden devolver más dinero del cobrado o dejar saldo a favor
    update ventas set devuelto = devuelto + v_devuelto, reembolsado = reembolsado + v_reembolsado where id = v_venta.id;
    perform barberia_private._sincronizar_cita(v_venta.id);
    perform _auditar('venta_devolucion', 'venta', v_venta.id::text,
        jsonb_build_object('numero', v_venta.numero, 'devuelto', v_devuelto, 'reembolsado', v_reembolsado, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'reembolso', v_venta.id::text, barberia_private._venta_json(v_venta.id));
end;
$$;

-- Anulación (error de registro): la venta queda en el historial como anulada y los productos no devueltos
-- vuelven al inventario. Si hay dinero cobrado, primero se reembolsa.
create or replace function barberia.panel_venta_anular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_venta ventas;
    v_motivo text := trim(p_datos ->> 'motivo');
    v_det record;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'anulacion');
    if v_previa is not null then
        return v_previa;
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    select * into v_venta from ventas where id = barberia_private._uuid(p_datos ->> 'venta_id') for update;
    if not found or v_venta.estado = 'anulada' then
        raise exception 'venta_no_disponible';
    end if;
    if v_venta.pagado - v_venta.reembolsado > 0 then
        raise exception 'reembolsa_antes_de_anular';
    end if;
    for v_det in select * from venta_detalles where venta_id = v_venta.id and tipo = 'producto' and cantidad > cantidad_devuelta order by producto_id loop
        perform barberia_private._mover_inventario(v_det.producto_id, v_det.cantidad - v_det.cantidad_devuelta, 'anulacion',
                                          'Anulación de la venta #' || v_venta.numero || ': ' || v_motivo, 'venta', v_venta.id::text);
    end loop;
    update ventas set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), motivo_anulacion = left(v_motivo, 300) where id = v_venta.id;
    perform barberia_private._sincronizar_cita(v_venta.id);
    perform _auditar('venta_anulada', 'venta', v_venta.id::text, jsonb_build_object('numero', v_venta.numero, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'anulacion', v_venta.id::text, barberia_private._venta_json(v_venta.id));
end;
$$;

create or replace function barberia.panel_venta(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    if not exists (select 1 from ventas where id = p_id) then
        raise exception 'venta_no_disponible';
    end if;
    return barberia_private._venta_json(p_id);
end;
$$;

-- Cita a cobrar: su venta (si existe) o lo que se cobrará al crearla
create or replace function barberia.panel_venta_de_cita(p_cita text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_cita citas;
    v_venta uuid;
begin
    perform _exigir_panel(true);
    select * into v_cita from citas where id::text = p_cita;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    select id into v_venta from ventas where cita_id = p_cita and estado <> 'anulada';
    return jsonb_build_object(
        'cita', _cita_json(v_cita),
        'venta', case when v_venta is not null then barberia_private._venta_json(v_venta) end,
        'previsto', case when v_venta is null then jsonb_build_object(
            'lineas', (select jsonb_build_array(jsonb_build_object('tipo', 'servicio', 'descripcion', s.nombre, 'cantidad', 1,
                         'precio_unitario', round(coalesce(v_cita.precio_servicio, s.precio, 0), 2),
                         'descuento', round(least(coalesce(v_cita.descuento, 0), coalesce(v_cita.precio_servicio, s.precio, 0)), 2)))
                         from servicios s where s.id = v_cita.servicio_id)
                       || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'producto', 'descripcion', p.nombre, 'cantidad', cp.cantidad,
                                     'precio_unitario', cp.precio_unitario, 'descuento', 0))
                                      from cita_productos cp join productos p on p.id = cp.producto_id
                                     where cp.cita_id = p_cita and cp.estado = 'reservado'), '[]'::jsonb)) end);
end;
$$;

create or replace function barberia.panel_ventas(p_desde date, p_hasta date, p_busqueda text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_texto text := nullif(trim(p_busqueda), '');
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return coalesce((select jsonb_agg(x order by x ->> 'creado_en' desc) from (
        select jsonb_build_object('id', v.id, 'numero', v.numero, 'creado_en', v.creado_en, 'estado', v.estado, 'origen', v.origen,
               'cliente', coalesce(v.cliente_nombre, 'Cliente sin registrar'), 'cita_id', v.cita_id, 'total', v.total,
               'cobrado_neto', v.pagado - v.reembolsado, 'devuelto', v.devuelto,
               'saldo', case when v.estado = 'anulada' then 0 else v.total - v.devuelto - (v.pagado - v.reembolsado) end,
               'resumen', (select string_agg(d.descripcion, ', ' order by d.id) from venta_detalles d where d.venta_id = v.id)) x
          from ventas v
         where (v.creado_en at time zone _zona())::date between p_desde and p_hasta
           and (v_texto is null or v.numero::text = v_texto or v.cliente_nombre ilike '%' || v_texto || '%'
                or exists (select 1 from venta_detalles d where d.venta_id = v.id and d.descripcion ilike '%' || v_texto || '%'))
         order by v.creado_en desc limit 500) t), '[]'::jsonb);
end;
$$;

-- Catálogo para el cobro rápido
create or replace function barberia.panel_venta_catalogo() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return jsonb_build_object(
        'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'nombre', nombre, 'precio', precio,
                         'categoria', categoria) order by orden nulls last, catalogo_id nulls last, nombre) from servicios where activo), '[]'::jsonb),
        'productos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nombre', nombre, 'precio', precio,
                         'existencia', stock, 'unidad', unidad, 'categoria', categoria) order by nombre)
                         from productos where activo and tipo = 'venta' and precio is not null), '[]'::jsonb),
        'barberos', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'nombre', nombre) order by orden nulls last, nombre)
                         from barberos where activo is not false), '[]'::jsonb),
        'caja_abierta', exists (select 1 from caja_sesiones where estado = 'abierta'));
end;
$$;

-- ==========================================
-- CAJA
-- ==========================================
create or replace function barberia.panel_caja_abrir(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_fondo numeric := round(barberia_private._num(p_datos, 'fondo_inicial'), 2);
    v_id uuid;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'caja_apertura');
    if v_previa is not null then
        return v_previa;
    end if;
    if v_fondo is null or v_fondo < 0 or v_fondo > 10000000 then
        raise exception 'monto_invalido';
    end if;
    if exists (select 1 from caja_sesiones where estado = 'abierta') then
        raise exception 'caja_ya_abierta';
    end if;
    insert into caja_sesiones (fondo_inicial, abierta_por) values (v_fondo, auth.uid()) returning id into v_id;
    perform _auditar('caja_abierta', 'caja', v_id::text, jsonb_build_object('fondo_inicial', v_fondo));
    return barberia_private._registrar_operacion(v_clave, 'caja_apertura', v_id::text, jsonb_build_object('sesion_id', v_id));
end;
$$;

-- Entradas y retiros manuales (no son ventas ni gastos)
create or replace function barberia.panel_caja_movimiento(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_tipo text := p_datos ->> 'tipo';
    v_monto numeric := round(barberia_private._num(p_datos, 'monto'), 2);
    v_motivo text := trim(p_datos ->> 'motivo');
    v_sesion uuid;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'caja_movimiento');
    if v_previa is not null then
        return v_previa;
    end if;
    if v_tipo not in ('entrada', 'retiro') or v_monto is null or v_monto <= 0 or v_monto > 10000000 then
        raise exception 'monto_invalido';
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    v_sesion := barberia_private._caja_abierta();
    if v_sesion is null then
        raise exception 'caja_cerrada';
    end if;
    if v_tipo = 'retiro' then
        perform barberia_private._verificar_efectivo(v_sesion, v_monto);
    end if;
    insert into caja_movimientos (sesion_id, tipo, monto, motivo, operacion, creado_por)
    values (v_sesion, v_tipo, v_monto, left(v_motivo, 300), v_clave, auth.uid());
    perform _auditar('caja_' || v_tipo, 'caja', v_sesion::text, jsonb_build_object('monto', v_monto, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'caja_movimiento', v_sesion::text, barberia_private._caja_resumen(v_sesion));
end;
$$;

-- Cierre: guarda esperado, contado, diferencia y un resumen fijo de la sesión
create or replace function barberia.panel_caja_cerrar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_contado numeric := round(barberia_private._num(p_datos, 'efectivo_contado'), 2);
    v_obs text := nullif(trim(p_datos ->> 'observacion'), '');
    v_sesion caja_sesiones;
    v_resumen jsonb;
    v_esperado numeric;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'caja_cierre');
    if v_previa is not null then
        return v_previa;
    end if;
    select * into v_sesion from caja_sesiones where id = barberia_private._uuid(p_datos ->> 'sesion_id') for update;
    if not found or v_sesion.estado <> 'abierta' then
        raise exception 'caja_cerrada';
    end if;
    if v_contado is null or v_contado < 0 or v_contado > 100000000 then
        raise exception 'monto_invalido';
    end if;
    v_resumen := barberia_private._caja_resumen(v_sesion.id);
    v_esperado := (v_resumen ->> 'efectivo_esperado')::numeric;
    if v_contado <> v_esperado and coalesce(length(v_obs), 0) < 3 then
        raise exception 'observacion_requerida';
    end if;
    update caja_sesiones
       set estado = 'cerrada', cerrada_en = now(), cerrada_por = auth.uid(), efectivo_esperado = v_esperado,
           efectivo_contado = v_contado, diferencia = v_contado - v_esperado, observacion = left(v_obs, 500), resumen = v_resumen
     where id = v_sesion.id;
    perform _auditar('caja_cerrada', 'caja', v_sesion.id::text,
        jsonb_build_object('esperado', v_esperado, 'contado', v_contado, 'diferencia', v_contado - v_esperado, 'observacion', v_obs));
    return barberia_private._registrar_operacion(v_clave, 'caja_cierre', v_sesion.id::text,
        jsonb_build_object('sesion_id', v_sesion.id, 'efectivo_esperado', v_esperado, 'efectivo_contado', v_contado,
                           'diferencia', v_contado - v_esperado, 'resumen', v_resumen));
end;
$$;

-- Corrección autorizada de un cierre: el valor anterior queda registrado
create or replace function barberia.panel_caja_corregir(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_contado numeric := round(barberia_private._num(p_datos, 'efectivo_contado'), 2);
    v_motivo text := trim(p_datos ->> 'motivo');
    v_sesion caja_sesiones;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'caja_correccion');
    if v_previa is not null then
        return v_previa;
    end if;
    select * into v_sesion from caja_sesiones where id = barberia_private._uuid(p_datos ->> 'sesion_id') for update;
    if not found or v_sesion.estado <> 'cerrada' then
        raise exception 'caja_no_cerrada';
    end if;
    if v_contado is null or v_contado < 0 or v_contado > 100000000 then
        raise exception 'monto_invalido';
    end if;
    if coalesce(length(v_motivo), 0) < 5 then
        raise exception 'motivo_requerido';
    end if;
    insert into caja_correcciones (sesion_id, campo, antes, despues, motivo, creado_por)
    values (v_sesion.id, 'efectivo_contado', v_sesion.efectivo_contado, v_contado, left(v_motivo, 500), auth.uid());
    update caja_sesiones set efectivo_contado = v_contado, diferencia = v_contado - efectivo_esperado where id = v_sesion.id;
    perform _auditar('caja_cierre_corregido', 'caja', v_sesion.id::text,
        jsonb_build_object('antes', v_sesion.efectivo_contado, 'despues', v_contado, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'caja_correccion', v_sesion.id::text, jsonb_build_object('sesion_id', v_sesion.id));
end;
$$;

create or replace function barberia_private._sesion_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object('id', s.id, 'numero', s.numero, 'estado', s.estado, 'fondo_inicial', s.fondo_inicial,
        'abierta_en', s.abierta_en, 'abierta_por', (select email from auth.users where id = s.abierta_por),
        'cerrada_en', s.cerrada_en, 'cerrada_por', (select email from auth.users where id = s.cerrada_por),
        'efectivo_esperado', s.efectivo_esperado, 'efectivo_contado', s.efectivo_contado, 'diferencia', s.diferencia,
        'observacion', s.observacion,
        'resumen', case when s.estado = 'abierta' then barberia_private._caja_resumen(s.id) else s.resumen end,
        'movimientos', coalesce((select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'monto', m.monto, 'motivo', m.motivo, 'creado_en', m.creado_en,
                         'usuario', (select email from auth.users where id = m.creado_por)) order by m.id)
                         from caja_movimientos m where m.sesion_id = s.id), '[]'::jsonb),
        'correcciones', coalesce((select jsonb_agg(jsonb_build_object('campo', c.campo, 'antes', c.antes, 'despues', c.despues, 'motivo', c.motivo,
                         'creado_en', c.creado_en, 'usuario', (select email from auth.users where id = c.creado_por)) order by c.id)
                         from caja_correcciones c where c.sesion_id = s.id), '[]'::jsonb))
      from caja_sesiones s where s.id = p_id
$$;

create or replace function barberia.panel_caja_estado() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return jsonb_build_object(
        'abierta', (select barberia_private._sesion_json(id) from caja_sesiones where estado = 'abierta'),
        'recientes', coalesce((select jsonb_agg(barberia_private._sesion_json(id) order by abierta_en desc)
                                 from (select id, abierta_en from caja_sesiones where estado = 'cerrada' order by abierta_en desc limit 10) s), '[]'::jsonb));
end;
$$;

create or replace function barberia.panel_caja_sesiones(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return coalesce((select jsonb_agg(barberia_private._sesion_json(id) order by abierta_en desc) from caja_sesiones
                      where (abierta_en at time zone _zona())::date between p_desde and p_hasta), '[]'::jsonb);
end;
$$;

-- ==========================================
-- GASTOS (el pago de una compra es un gasto ligado a ella: no se registra dos veces)
-- ==========================================
create or replace function barberia_private._registrar_gasto(p_datos jsonb, p_clave uuid) returns uuid
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_monto numeric := round(barberia_private._num(p_datos, 'monto'), 2);
    v_medio text := p_datos ->> 'medio';
    v_fecha date := coalesce(nullif(p_datos ->> 'fecha', '')::date, _ahora_local()::date);
    v_compra compras;
    v_categoria text := p_datos ->> 'categoria';
    v_sesion uuid;
    v_id uuid;
begin
    if v_monto is null or v_monto <= 0 or v_monto > 100000000 then
        raise exception 'monto_invalido';
    end if;
    if v_fecha > _ahora_local()::date or v_fecha < _ahora_local()::date - 366 then
        raise exception 'fecha_invalida';
    end if;
    if barberia_private._uuid(p_datos ->> 'compra_id') is not null then
        select * into v_compra from compras where id = barberia_private._uuid(p_datos ->> 'compra_id') for update;
        if not found or v_compra.estado <> 'recibida' then
            raise exception 'compra_no_disponible';
        end if;
        if (select coalesce(sum(monto), 0) from gastos where compra_id = v_compra.id and anulado_en is null) + v_monto > v_compra.total then
            raise exception 'pago_excede_compra';
        end if;
        v_categoria := 'compra_mercancia';
    end if;
    if v_medio = 'efectivo_caja' then
        v_sesion := barberia_private._caja_abierta();
        if v_sesion is null then
            raise exception 'caja_cerrada';
        end if;
        perform barberia_private._verificar_efectivo(v_sesion, v_monto);
    end if;
    if p_datos ->> 'comprobante_imagen' is not null and not _imagen_valida(p_datos ->> 'comprobante_imagen') then
        raise exception 'imagen_invalida';
    end if;
    insert into gastos (clave, fecha, categoria, descripcion, monto, medio, sesion_caja_id, responsable, comprobante, comprobante_imagen, compra_id, creado_por)
    values (p_clave, v_fecha, v_categoria,
            coalesce(nullif(trim(p_datos ->> 'descripcion'), ''), case when v_compra.id is not null then 'Pago de la compra #' || v_compra.numero end),
            v_monto, v_medio, v_sesion, nullif(left(trim(p_datos ->> 'responsable'), 120), ''), nullif(left(trim(p_datos ->> 'comprobante'), 120), ''),
            nullif(p_datos ->> 'comprobante_imagen', ''), v_compra.id, auth.uid())
    returning id into v_id;
    perform _auditar('gasto_registrado', 'gasto', v_id::text, jsonb_build_object('monto', v_monto, 'categoria', v_categoria, 'medio', v_medio, 'compra', v_compra.numero));
    return v_id;
end;
$$;

create or replace function barberia.panel_gasto_registrar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_id uuid;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'gasto');
    if v_previa is not null then
        return v_previa;
    end if;
    v_id := barberia_private._registrar_gasto(p_datos, v_clave);
    return barberia_private._registrar_operacion(v_clave, 'gasto', v_id::text, jsonb_build_object('gasto_id', v_id));
end;
$$;

create or replace function barberia.panel_gasto_anular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_gasto gastos;
    v_motivo text := trim(p_datos ->> 'motivo');
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'gasto_anulacion');
    if v_previa is not null then
        return v_previa;
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    select * into v_gasto from gastos where id = barberia_private._uuid(p_datos ->> 'gasto_id') for update;
    if not found or v_gasto.anulado_en is not null then
        raise exception 'gasto_no_disponible';
    end if;
    -- Un gasto pagado con una caja ya cerrada no cambia ese cierre: se compensa con una entrada en la caja actual
    if v_gasto.sesion_caja_id is not null and (select estado from caja_sesiones where id = v_gasto.sesion_caja_id) <> 'abierta' then
        raise exception 'caja_de_gasto_cerrada';
    end if;
    update gastos set anulado_en = now(), anulado_por = auth.uid(), motivo_anulacion = left(v_motivo, 300) where id = v_gasto.id;
    perform _auditar('gasto_anulado', 'gasto', v_gasto.id::text, jsonb_build_object('monto', v_gasto.monto, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'gasto_anulacion', v_gasto.id::text, jsonb_build_object('gasto_id', v_gasto.id));
end;
$$;

create or replace function barberia.panel_gastos(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'numero', g.numero, 'fecha', g.fecha, 'categoria', g.categoria,
            'descripcion', g.descripcion, 'monto', g.monto, 'medio', g.medio, 'responsable', g.responsable, 'comprobante', g.comprobante,
            'tiene_imagen', g.comprobante_imagen is not null, 'compra_numero', (select numero from compras where id = g.compra_id),
            'caja_numero', (select numero from caja_sesiones where id = g.sesion_caja_id),
            'anulado_en', g.anulado_en, 'motivo_anulacion', g.motivo_anulacion,
            'creado_por', (select email from auth.users where id = g.creado_por)) order by g.fecha desc, g.numero desc)
        from gastos g where g.fecha between p_desde and p_hasta), '[]'::jsonb);
end;
$$;

create or replace function barberia.panel_gasto_comprobante(p_id uuid) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return (select comprobante_imagen from gastos where id = p_id);
end;
$$;

-- ==========================================
-- INVENTARIO
-- ==========================================
create or replace function barberia.panel_inv_productos() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'descripcion', p.descripcion, 'tipo', p.tipo, 'categoria', p.categoria,
            'unidad', p.unidad, 'costo', p.costo, 'costo_promedio', p.costo_promedio, 'precio', p.precio, 'existencia', p.stock,
            'existencia_minima', p.existencia_minima, 'activo', p.activo, 'proveedor_id', p.proveedor_id, 'proveedor', pr.nombre,
            'imagen_url', p.imagen_url, 'valor', round(p.stock * p.costo_promedio, 2),
            'alerta', case when not p.activo then null when p.stock <= 0 then 'agotado' when p.stock <= p.existencia_minima then 'bajo' end,
            'reservado_web', (select coalesce(sum(cantidad), 0) from cita_productos where producto_id = p.id and estado = 'reservado'))
            order by p.activo desc, p.nombre)
        from productos p left join proveedores pr on pr.id = p.proveedor_id), '[]'::jsonb);
end;
$$;

create or replace function barberia.panel_inv_guardar_producto(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_actual productos;
    v_id uuid := p_id;
    v_nombre text := trim(p_datos ->> 'nombre');
    v_codigo text := nullif(upper(trim(p_datos ->> 'codigo')), '');
    v_tipo text := coalesce(p_datos ->> 'tipo', 'venta');
    v_unidad text := coalesce(p_datos ->> 'unidad', 'unidad');
    v_precio numeric := round(barberia_private._num(p_datos, 'precio'), 2);
    v_costo numeric := round(barberia_private._num(p_datos, 'costo'), 2);
    v_minimo numeric := coalesce(barberia_private._num(p_datos, 'existencia_minima'), 0);
    v_inicial numeric := coalesce(barberia_private._num(p_datos, 'existencia_inicial'), 0);
    v_proveedor uuid := barberia_private._uuid(p_datos ->> 'proveedor_id');
begin
    perform _exigir_panel(true);
    if p_id is not null then
        select * into v_actual from productos where id = p_id for update;
        if not found then
            raise exception 'producto_no_encontrado';
        end if;
    end if;
    if coalesce(length(v_nombre), 0) not between 1 and 120 or length(coalesce(p_datos ->> 'descripcion', '')) > 300
       or length(coalesce(p_datos ->> 'categoria', '')) > 40 or (v_codigo is not null and v_codigo !~ '^[A-Z0-9._-]{2,30}$')
       or v_tipo not in ('venta', 'insumo') or (select grupo from barberia_private._unidad(v_unidad)) is null
       or (v_tipo = 'venta' and (v_precio is null or v_precio < 0 or v_precio > 10000000))
       or coalesce(v_costo, 0) < 0 or coalesce(v_costo, 0) > 10000000 or v_minimo < 0 or v_inicial < 0
       or not _imagen_valida(p_datos ->> 'imagen_url') then
        raise exception 'producto_invalido';
    end if;
    if v_proveedor is not null and not exists (select 1 from proveedores where id = v_proveedor) then
        raise exception 'proveedor_no_encontrado';
    end if;
    if exists (select 1 from productos where lower(codigo) = lower(v_codigo) and id is distinct from p_id) then
        raise exception 'codigo_duplicado';
    end if;
    if exists (select 1 from productos where lower(nombre) = lower(v_nombre) and id is distinct from p_id) then
        raise exception 'producto_duplicado';
    end if;

    if p_id is null then
        if v_inicial > 0 and v_unidad in ('unidad', 'par') and v_inicial <> trunc(v_inicial) then
            raise exception 'cantidad_invalida';
        end if;
        insert into productos (codigo, nombre, descripcion, tipo, categoria, unidad, precio, costo, existencia_minima, proveedor_id,
                               imagen_url, activo, stock, creado_por)
        values (coalesce(v_codigo, 'PRD-' || lpad(nextval('barberia.productos_codigo_seq')::text, 5, '0')), v_nombre,
                nullif(trim(p_datos ->> 'descripcion'), ''), v_tipo, nullif(trim(p_datos ->> 'categoria'), ''), v_unidad,
                case when v_tipo = 'venta' then v_precio end, v_costo, v_minimo, v_proveedor, nullif(p_datos ->> 'imagen_url', ''),
                coalesce((p_datos ->> 'activo')::boolean, true), 0, auth.uid())
        returning id into v_id;
        if v_inicial > 0 then
            perform barberia_private._mover_inventario(v_id, v_inicial, 'inicial', 'Existencia inicial', null, null, v_costo);
        end if;
    else
        -- Cambiar la unidad de un artículo con historial alteraría el significado de sus cantidades
        if v_unidad <> v_actual.unidad and exists (select 1 from inventario_movimientos where producto_id = p_id) then
            raise exception 'unidad_con_movimientos';
        end if;
        update productos
           set codigo = coalesce(v_codigo, codigo), nombre = v_nombre, descripcion = nullif(trim(p_datos ->> 'descripcion'), ''),
               tipo = v_tipo, categoria = nullif(trim(p_datos ->> 'categoria'), ''), unidad = v_unidad,
               precio = case when v_tipo = 'venta' then v_precio end, costo = v_costo,
               -- Sin costo conocido, el costo indicado pasa a ser el de valoración
               costo_promedio = case when costo_promedio = 0 and v_costo is not null then v_costo else costo_promedio end,
               existencia_minima = v_minimo, proveedor_id = v_proveedor, imagen_url = nullif(p_datos ->> 'imagen_url', ''),
               activo = coalesce((p_datos ->> 'activo')::boolean, activo), actualizado_en = now()
         where id = p_id;
    end if;
    perform _auditar(case when p_id is null then 'producto_creado' else 'producto_actualizado' end, 'producto', v_id::text,
        jsonb_build_object('antes', case when p_id is not null then jsonb_build_object('nombre', v_actual.nombre, 'precio', v_actual.precio,
                           'costo', v_actual.costo, 'activo', v_actual.activo) end, 'despues', p_datos - 'imagen_url'));
    return jsonb_build_object('id', v_id);
end;
$$;

-- Movimientos manuales: consumo interno, pérdida o daño, devolución al proveedor, ajuste por conteo físico
-- y existencia inicial (solo si el artículo aún no tiene movimientos).
create or replace function barberia.panel_inv_movimiento(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_prod productos;
    v_tipo text := p_datos ->> 'tipo';
    v_cant numeric := barberia_private._num(p_datos, 'cantidad');
    v_conteo numeric := barberia_private._num(p_datos, 'conteo');
    v_motivo text := trim(p_datos ->> 'motivo');
    v_delta numeric;
    v_nuevo numeric;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'inventario');
    if v_previa is not null then
        return v_previa;
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    select * into v_prod from productos where id = barberia_private._uuid(p_datos ->> 'producto_id') for update;
    if not found then
        raise exception 'producto_no_encontrado';
    end if;
    if v_tipo = 'ajuste' then
        if v_conteo is null or v_conteo < 0 then
            raise exception 'cantidad_invalida';
        end if;
        v_delta := v_conteo - v_prod.stock;
        if v_delta = 0 then
            raise exception 'sin_diferencia';
        end if;
    elsif v_tipo in ('consumo', 'perdida', 'devolucion') then
        if v_cant is null or v_cant <= 0 then
            raise exception 'cantidad_invalida';
        end if;
        v_delta := -v_cant; -- devolución manual = salida hacia el proveedor
    elsif v_tipo = 'inicial' then
        if v_cant is null or v_cant <= 0 or exists (select 1 from inventario_movimientos where producto_id = v_prod.id) then
            raise exception 'inicial_no_permitida';
        end if;
        v_delta := v_cant;
    else
        raise exception 'tipo_movimiento_invalido';
    end if;
    if v_prod.unidad in ('unidad', 'par') and v_delta <> trunc(v_delta) then
        raise exception 'cantidad_invalida';
    end if;
    v_nuevo := barberia_private._mover_inventario(v_prod.id, v_delta, v_tipo, left(v_motivo, 300), 'manual', null,
                                         case when v_tipo = 'inicial' then round(barberia_private._num(p_datos, 'costo_unitario'), 4) end);
    return barberia_private._registrar_operacion(v_clave, 'inventario', v_prod.id::text,
                                        jsonb_build_object('producto_id', v_prod.id, 'existencia', v_nuevo, 'cantidad', v_delta));
end;
$$;

create or replace function barberia.panel_inv_movimientos(p_producto uuid default null, p_desde date default null, p_hasta date default null)
returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(x order by (x ->> 'id')::bigint desc) from (
        select jsonb_build_object('id', m.id, 'fecha', m.creado_en, 'producto_id', m.producto_id, 'producto', p.nombre, 'codigo', p.codigo,
               'unidad', p.unidad, 'tipo', m.tipo, 'cantidad', m.cantidad, 'existencia_resultante', m.existencia_resultante,
               'costo_unitario', m.costo_unitario, 'motivo', m.motivo, 'referencia_tipo', m.referencia_tipo, 'referencia_id', m.referencia_id,
               'referencia_numero', case m.referencia_tipo when 'venta' then (select numero from ventas where id::text = m.referencia_id)
                                                           when 'compra' then (select numero from compras where id::text = m.referencia_id) end,
               'usuario', (select email from auth.users where id = m.usuario_id)) x
          from inventario_movimientos m join productos p on p.id = m.producto_id
         where (p_producto is null or m.producto_id = p_producto)
           and (p_desde is null or (m.creado_en at time zone _zona())::date >= p_desde)
           and (p_hasta is null or (m.creado_en at time zone _zona())::date <= p_hasta)
         order by m.id desc limit 1000) t), '[]'::jsonb);
end;
$$;

create or replace function barberia.panel_inv_proveedores() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'notas', notas, 'activo', activo)
                       order by activo desc, nombre) from proveedores), '[]'::jsonb);
end;
$$;

create or replace function barberia.panel_inv_guardar_proveedor(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_id uuid := p_id;
    v_nombre text := trim(p_datos ->> 'nombre');
begin
    perform _exigir_panel(true);
    if coalesce(length(v_nombre), 0) not between 1 and 120 or length(coalesce(p_datos ->> 'notas', '')) > 300
       or length(coalesce(p_datos ->> 'telefono', '')) > 30 then
        raise exception 'proveedor_invalido';
    end if;
    if exists (select 1 from proveedores where lower(nombre) = lower(v_nombre) and id is distinct from p_id) then
        raise exception 'proveedor_duplicado';
    end if;
    if p_id is null then
        insert into proveedores (nombre, telefono, notas) values (v_nombre, nullif(trim(p_datos ->> 'telefono'), ''), nullif(trim(p_datos ->> 'notas'), ''))
        returning id into v_id;
    else
        update proveedores set nombre = v_nombre, telefono = nullif(trim(p_datos ->> 'telefono'), ''), notas = nullif(trim(p_datos ->> 'notas'), ''),
               activo = coalesce((p_datos ->> 'activo')::boolean, activo)
         where id = p_id;
        if not found then
            raise exception 'proveedor_no_encontrado';
        end if;
    end if;
    perform _auditar('proveedor_guardado', 'proveedor', v_id::text, p_datos);
    return jsonb_build_object('id', v_id);
end;
$$;

-- p_datos: { clave, proveedor_id?, fecha?, factura?, notas?, lineas: [{producto_id, cantidad, costo_unitario}],
--            pago?: {medio, monto, comprobante?} }  (sin pago: queda pendiente de pago)
create or replace function barberia.panel_inv_compra(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_compra compras;
    v_linea jsonb;
    v_prod productos;
    v_cant numeric;
    v_costo numeric;
    v_fecha date := coalesce(nullif(p_datos ->> 'fecha', '')::date, _ahora_local()::date);
    v_proveedor uuid := barberia_private._uuid(p_datos ->> 'proveedor_id');
    v_gasto uuid;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'compra');
    if v_previa is not null then
        return v_previa;
    end if;
    if jsonb_array_length(coalesce(p_datos -> 'lineas', '[]'::jsonb)) = 0 then
        raise exception 'compra_vacia';
    end if;
    if v_fecha > _ahora_local()::date or v_fecha < _ahora_local()::date - 366 then
        raise exception 'fecha_invalida';
    end if;
    if v_proveedor is not null and not exists (select 1 from proveedores where id = v_proveedor) then
        raise exception 'proveedor_no_encontrado';
    end if;
    insert into compras (clave, proveedor_id, fecha, factura, total, notas, creado_por)
    values (v_clave, v_proveedor, v_fecha, nullif(left(trim(p_datos ->> 'factura'), 60), ''), 0, nullif(left(trim(p_datos ->> 'notas'), 300), ''), auth.uid())
    returning * into v_compra;
    for v_linea in select * from jsonb_array_elements(p_datos -> 'lineas') loop
        v_cant := barberia_private._num(v_linea, 'cantidad');
        v_costo := barberia_private._num(v_linea, 'costo_unitario');
        select * into v_prod from productos where id = barberia_private._uuid(v_linea ->> 'producto_id');
        if not found then
            raise exception 'producto_no_encontrado';
        end if;
        if v_cant is null or v_cant <= 0 or v_cant > 100000 or v_costo is null or v_costo < 0 or v_costo > 10000000
           or (v_prod.unidad in ('unidad', 'par') and v_cant <> trunc(v_cant)) then
            raise exception 'linea_invalida';
        end if;
        insert into compra_detalles (compra_id, producto_id, cantidad, costo_unitario, subtotal)
        values (v_compra.id, v_prod.id, v_cant, round(v_costo, 4), round(v_cant * v_costo, 2));
        perform barberia_private._mover_inventario(v_prod.id, v_cant, 'compra', 'Compra #' || v_compra.numero, 'compra', v_compra.id::text, v_costo);
    end loop;
    update compras set total = (select sum(subtotal) from compra_detalles where compra_id = v_compra.id) where id = v_compra.id
    returning * into v_compra;
    perform _auditar('compra_recibida', 'compra', v_compra.id::text, jsonb_build_object('numero', v_compra.numero, 'total', v_compra.total));
    if p_datos -> 'pago' is not null and jsonb_typeof(p_datos -> 'pago') = 'object' then
        v_gasto := barberia_private._registrar_gasto((p_datos -> 'pago') || jsonb_build_object('compra_id', v_compra.id, 'fecha', v_fecha,
                                            'categoria', 'compra_mercancia'), gen_random_uuid());
    end if;
    return barberia_private._registrar_operacion(v_clave, 'compra', v_compra.id::text,
        jsonb_build_object('compra_id', v_compra.id, 'numero', v_compra.numero, 'total', v_compra.total, 'gasto_id', v_gasto));
end;
$$;

create or replace function barberia.panel_inv_compras(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'fecha', c.fecha, 'factura', c.factura,
            'proveedor', pr.nombre, 'total', c.total, 'estado', c.estado, 'motivo_anulacion', c.motivo_anulacion,
            'pagado', (select coalesce(sum(monto), 0) from gastos where compra_id = c.id and anulado_en is null),
            'lineas', (select jsonb_agg(jsonb_build_object('producto', p.nombre, 'cantidad', d.cantidad, 'unidad', p.unidad,
                         'costo_unitario', d.costo_unitario, 'subtotal', d.subtotal) order by d.id)
                         from compra_detalles d join productos p on p.id = d.producto_id where d.compra_id = c.id)) order by c.fecha desc, c.numero desc)
        from compras c left join proveedores pr on pr.id = c.proveedor_id where c.fecha between p_desde and p_hasta), '[]'::jsonb);
end;
$$;

-- Anular una recepción registrada por error: sin pagos activos y con existencia suficiente para retirarla
create or replace function barberia.panel_inv_anular_compra(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_previa jsonb;
    v_compra compras;
    v_motivo text := trim(p_datos ->> 'motivo');
    v_det record;
begin
    perform _exigir_panel(true);
    v_previa := barberia_private._operacion_previa(v_clave, 'compra_anulacion');
    if v_previa is not null then
        return v_previa;
    end if;
    if coalesce(length(v_motivo), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    select * into v_compra from compras where id = barberia_private._uuid(p_datos ->> 'compra_id') for update;
    if not found or v_compra.estado <> 'recibida' then
        raise exception 'compra_no_disponible';
    end if;
    if exists (select 1 from gastos where compra_id = v_compra.id and anulado_en is null) then
        raise exception 'compra_con_pagos';
    end if;
    for v_det in select * from compra_detalles where compra_id = v_compra.id order by producto_id loop
        perform barberia_private._mover_inventario(v_det.producto_id, -v_det.cantidad, 'anulacion', 'Anulación de la compra #' || v_compra.numero || ': ' || v_motivo,
                                          'compra', v_compra.id::text);
    end loop;
    update compras set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), motivo_anulacion = left(v_motivo, 300) where id = v_compra.id;
    perform _auditar('compra_anulada', 'compra', v_compra.id::text, jsonb_build_object('numero', v_compra.numero, 'motivo', v_motivo));
    return barberia_private._registrar_operacion(v_clave, 'compra_anulacion', v_compra.id::text, jsonb_build_object('compra_id', v_compra.id));
end;
$$;

create or replace function barberia.panel_inv_consumos() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('servicio_id', c.servicio_id, 'servicio', s.nombre, 'producto_id', c.producto_id,
            'producto', p.nombre, 'unidad_producto', p.unidad, 'cantidad', c.cantidad, 'unidad', c.unidad, 'activo', c.activo)
            order by s.nombre, p.nombre)
        from servicio_consumos c join productos p on p.id = c.producto_id left join servicios s on s.id::text = c.servicio_id), '[]'::jsonb);
end;
$$;

create or replace function barberia.panel_inv_guardar_consumo(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_servicio text := p_datos ->> 'servicio_id';
    v_prod productos;
    v_cant numeric := barberia_private._num(p_datos, 'cantidad');
    v_unidad text := p_datos ->> 'unidad';
begin
    perform _exigir_panel(true);
    if not exists (select 1 from servicios where id::text = v_servicio) then
        raise exception 'servicio_no_disponible';
    end if;
    select * into v_prod from productos where id = barberia_private._uuid(p_datos ->> 'producto_id');
    if not found then
        raise exception 'producto_no_encontrado';
    end if;
    if v_cant is null or v_cant <= 0 or v_cant > 100000 then
        raise exception 'cantidad_invalida';
    end if;
    perform barberia_private._convertir(v_cant, v_unidad, v_prod.unidad); -- unidades compatibles (ml con l, g con kg...)
    insert into servicio_consumos (servicio_id, producto_id, cantidad, unidad, activo)
    values (v_servicio, v_prod.id, v_cant, v_unidad, coalesce((p_datos ->> 'activo')::boolean, true))
    on conflict (servicio_id, producto_id) do update
       set cantidad = excluded.cantidad, unidad = excluded.unidad, activo = excluded.activo, actualizado_en = now();
    perform _auditar('consumo_configurado', 'servicio', v_servicio, p_datos);
    return panel_inv_consumos();
end;
$$;

-- ==========================================
-- REPORTES FINANCIEROS
-- ==========================================
-- Cada indicador sale de registros guardados (ventas, pagos, devoluciones, movimientos, gastos, caja).
create or replace function barberia.panel_finanzas(p_desde date, p_hasta date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_barbero text := nullif(p_barbero, '');
    v_resultado jsonb;
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    with ventas_p as (
        select v.* from ventas v where v.estado <> 'anulada' and (v.creado_en at time zone _zona())::date between p_desde and p_hasta
    ), lineas as (
        select d.*, v.creado_en as fecha_venta from venta_detalles d join ventas_p v on v.id = d.venta_id
         where v_barbero is null or (d.tipo = 'servicio' and d.barbero_id = v_barbero) -- los productos no se atribuyen a un barbero
    ), pagos_p as (
        select p.* from pagos p join ventas v on v.id = p.venta_id
         where (p.creado_en at time zone _zona())::date between p_desde and p_hasta
    ), devol_p as (
        select x.*, d.tipo as tipo_linea from devoluciones x join venta_detalles d on d.id = x.detalle_id
         where (x.creado_en at time zone _zona())::date between p_desde and p_hasta
    ), mov_p as (
        select m.* from inventario_movimientos m where (m.creado_en at time zone _zona())::date between p_desde and p_hasta
    ), gastos_p as (
        select g.* from gastos g where g.anulado_en is null and g.fecha between p_desde and p_hasta
    )
    select jsonb_build_object(
        'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'barbero_id', v_barbero),
        'ventas_servicios', (select coalesce(sum(total), 0) from lineas where tipo = 'servicio'),
        'ventas_productos', (select coalesce(sum(total), 0) from lineas where tipo = 'producto'),
        'descuentos', (select coalesce(sum(descuento), 0) from lineas),
        'devoluciones', (select coalesce(sum(importe), 0) from devol_p),
        'cobros', (select coalesce(sum(monto), 0) from pagos_p where tipo = 'pago'),
        'reembolsos', (select coalesce(sum(monto), 0) from pagos_p where tipo = 'reembolso'),
        'anticipos', (select coalesce(sum(monto), 0) from pagos_p where tipo = 'pago' and es_anticipo),
        'cambio_entregado', (select coalesce(sum(cambio), 0) from pagos_p where tipo = 'pago'),
        'por_medio', coalesce((select jsonb_object_agg(metodo, jsonb_build_object('cobros', c, 'reembolsos', r)) from (
                     select metodo, coalesce(sum(monto) filter (where tipo = 'pago'), 0) c, coalesce(sum(monto) filter (where tipo = 'reembolso'), 0) r
                       from pagos_p group by metodo) m), '{}'::jsonb),
        'saldos_pendientes', jsonb_build_object(
            'importe', (select coalesce(sum(total - devuelto - (pagado - reembolsado)), 0) from ventas
                         where estado <> 'anulada' and total - devuelto - (pagado - reembolsado) > 0),
            'ventas', (select count(*) from ventas where estado <> 'anulada' and total - devuelto - (pagado - reembolsado) > 0),
            'citas_completadas_sin_venta', (select count(*) from citas c where c.completada_en is not null and c.estado <> 'cancelada'
                                              and not exists (select 1 from ventas v where v.cita_id = c.id::text and v.estado <> 'anulada'))),
        'gastos', coalesce((select jsonb_object_agg(categoria, total) from (select categoria, sum(monto) total from gastos_p
                             where compra_id is null group by categoria) g), '{}'::jsonb),
        'gastos_total', (select coalesce(sum(monto), 0) from gastos_p where compra_id is null),
        'pagos_compras', (select coalesce(sum(monto), 0) from gastos_p where compra_id is not null),
        'compras_recibidas', (select coalesce(sum(total), 0) from compras where estado = 'recibida' and fecha between p_desde and p_hasta),
        'costo_productos_vendidos', jsonb_build_object(
            -- Salidas por venta (en negativo) menos devoluciones repuestas y anulaciones, al costo registrado en cada movimiento
            'importe', (select coalesce(round(sum(-cantidad * costo_unitario), 2), 0) from mov_p
                         where referencia_tipo = 'venta' and tipo in ('venta', 'devolucion', 'anulacion')),
            'movimientos_sin_costo', (select count(*) from mov_p where referencia_tipo = 'venta' and tipo = 'venta' and costo_unitario is null)),
        'costo_consumos', jsonb_build_object(
            'importe', (select coalesce(round(sum(-cantidad * costo_unitario), 2), 0) from mov_p where tipo = 'consumo'),
            'movimientos_sin_costo', (select count(*) from mov_p where tipo = 'consumo' and costo_unitario is null)),
        'servicios_por_barbero', coalesce((select jsonb_agg(x order by (x ->> 'importe')::numeric desc) from (
            select jsonb_build_object('barbero_id', b.id::text, 'barbero', b.nombre,
                   'servicios_vendidos', coalesce((select sum(l.cantidad) from lineas l where l.tipo = 'servicio' and l.barbero_id = b.id::text), 0),
                   'importe', coalesce((select sum(l.total) from lineas l where l.tipo = 'servicio' and l.barbero_id = b.id::text), 0),
                   'citas_completadas', (select count(*) from citas c where c.barbero_id = b.id and c.completada_en is not null
                                           and (c.completada_en at time zone _zona())::date between p_desde and p_hasta)) x
              from barberos b where v_barbero is null or b.id::text = v_barbero) t), '[]'::jsonb),
        'productos_mas_vendidos', coalesce((select jsonb_agg(x) from (
            select jsonb_build_object('producto', descripcion, 'cantidad', sum(cantidad - cantidad_devuelta), 'importe', sum(total - importe_devuelto)) x
              from lineas where tipo = 'producto' group by producto_id, descripcion
             order by sum(cantidad - cantidad_devuelta) desc limit 10) t), '[]'::jsonb),
        'existencias_bajas', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'existencia', stock,
                               'minimo', existencia_minima, 'unidad', unidad, 'agotado', stock <= 0) order by stock <= 0 desc, nombre)
                               from productos where activo and stock <= existencia_minima), '[]'::jsonb),
        'inventario', jsonb_build_object(
            'valor_al_costo', (select coalesce(round(sum(stock * costo_promedio), 2), 0) from productos where stock > 0),
            'articulos_sin_costo', (select count(*) from productos where stock > 0 and costo_promedio = 0)),
        'cierres', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'abierta_en', abierta_en, 'cerrada_en', cerrada_en,
                     'esperado', efectivo_esperado, 'contado', efectivo_contado, 'diferencia', diferencia, 'observacion', observacion,
                     'corregido', exists (select 1 from caja_correcciones c where c.sesion_id = s.id)) order by abierta_en)
                     from caja_sesiones s where estado = 'cerrada' and (cerrada_en at time zone _zona())::date between p_desde and p_hasta), '[]'::jsonb),
        'ventas', (select count(*) from ventas_p))
      into v_resultado;
    return v_resultado;
end;
$$;

-- ==========================================
-- FLUJOS EXISTENTES SOBRE EL NUEVO REGISTRO
-- ==========================================
-- Reserva web con productos: la reserva descuenta existencia como movimiento 'reserva'
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
            select precio into v_precio from productos
             where id = v_item.id and activo and tipo = 'venta' and precio is not null for update;
            if not found then
                raise exception 'sin_stock';
            end if;
            perform barberia_private._mover_inventario(v_item.id, -v_item.cantidad, 'reserva', 'Reserva web con la cita', 'cita', v_cita);
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

-- Cancelación de cita: la reserva de productos vuelve al inventario como movimiento
create or replace function barberia.tg_citas_modulos() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_id text := new.id::text;
    v_item record;
    v_liberar boolean := false;
begin
    if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
        -- Devolución de existencias en orden fijo para evitar bloqueos cruzados
        for v_item in select * from cita_productos where cita_id = v_id and estado = 'reservado' order by producto_id for update loop
            perform barberia_private._mover_inventario(v_item.producto_id, v_item.cantidad, 'reserva_liberada', 'Cita cancelada: se libera la reserva', 'cita', v_id);
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

-- La web solo muestra productos para vender (nunca insumos ni costos)
create or replace function barberia.listar_productos() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select case when not _modulo_activo('productos') then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'descripcion', descripcion, 'precio', precio, 'stock', stock) order by nombre)
          from productos where activo and tipo = 'venta' and precio is not null
    ), '[]'::jsonb) end
$$;

-- Ajuste desde la pestaña Módulos: ahora queda como movimiento de inventario
create or replace function barberia.admin_ajustar_stock(p_producto_id uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_stock numeric;
begin
    perform _exigir_admin();
    if p_delta is null or p_delta = 0 then
        raise exception 'stock_invalido';
    end if;
    begin
        v_stock := barberia_private._mover_inventario(p_producto_id, p_delta, 'ajuste', 'Ajuste desde Módulos');
    exception when sqlstate 'P0001' then
        if sqlerrm in ('sin_stock', 'producto_no_encontrado') then
            raise exception 'stock_invalido';
        end if;
        raise;
    end;
    return jsonb_build_object('ok', true, 'stock', v_stock);
end;
$$;

-- Devuelve todo el dinero cobrado de la cita por los mismos medios (queda en el historial).
-- p_devolver = true: devolución real (el servicio y los productos se descuentan de la venta, sin reponer existencias).
-- p_devolver = false: se deshace un cobro registrado por error (la venta vuelve a tener saldo pendiente).
create or replace function barberia_private._reembolso_total_cita(p_cita text, p_motivo text, p_devolver boolean) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_venta ventas;
    v_reembolsos jsonb;
    v_lineas jsonb := '[]'::jsonb;
begin
    select * into v_venta from ventas where cita_id = p_cita and estado <> 'anulada' for update;
    if not found or v_venta.pagado - v_venta.reembolsado <= 0 then
        raise exception 'cita_sin_cobro';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('metodo', metodo, 'monto', neto)), '[]'::jsonb) into v_reembolsos
      from (select metodo, sum(case tipo when 'pago' then monto else -monto end) neto from pagos where venta_id = v_venta.id group by metodo) m
     where neto > 0;
    if p_devolver then
        select coalesce(jsonb_agg(jsonb_build_object('detalle_id', id, 'cantidad', cantidad - cantidad_devuelta, 'importe', total - importe_devuelto,
                                                     'reponer', false)), '[]'::jsonb) into v_lineas
          from venta_detalles where venta_id = v_venta.id and total > importe_devuelto;
    end if;
    perform panel_venta_reembolsar(jsonb_build_object('clave', gen_random_uuid(), 'venta_id', v_venta.id, 'motivo', p_motivo,
                                                      'lineas', v_lineas, 'reembolsos', v_reembolsos));
end;
$$;

-- Acciones antiguas de la pestaña Módulos sobre el registro de ventas
create or replace function barberia.admin_marcar_cita(p_cita_id text, p_accion text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_cita citas;
    v_venta ventas;
    v_saldo numeric;
begin
    perform _exigir_admin();
    select * into v_cita from citas where id::text = p_cita_id for update;
    if p_accion = 'completar_pagar' then
        if not found or v_cita.estado = 'cancelada' then
            raise exception 'cita_no_valida_para_accion';
        end if;
        update citas set completada_en = coalesce(completada_en, now()) where id = v_cita.id;
        select * into v_venta from ventas where cita_id = p_cita_id and estado <> 'anulada';
        v_saldo := case when v_venta.id is null then null else v_venta.total - v_venta.devuelto - (v_venta.pagado - v_venta.reembolsado) end;
        -- Pago expreso del saldo (medio "otro": esta acción no indica el medio)
        if v_venta.id is null or v_saldo > 0 then
            perform panel_venta_cobrar(jsonb_build_object('clave', gen_random_uuid(), 'cita_id', p_cita_id,
                'pagos', case when v_venta.id is null then
                             coalesce((select jsonb_build_array(jsonb_build_object('metodo', 'otro', 'monto',
                                                round(coalesce(v_cita.precio_servicio, s.precio, 0) - coalesce(v_cita.descuento, 0), 2)))
                                         from servicios s where s.id = v_cita.servicio_id
                                          and coalesce(v_cita.precio_servicio, s.precio, 0) - coalesce(v_cita.descuento, 0) > 0), '[]'::jsonb)
                             else jsonb_build_array(jsonb_build_object('metodo', 'otro', 'monto', v_saldo)) end));
        end if;
    elsif p_accion = 'reembolsar' then
        if not found then
            raise exception 'cita_no_valida_para_accion';
        end if;
        perform barberia_private._reembolso_total_cita(p_cita_id, 'Reembolso registrado desde Módulos', true);
    elsif p_accion = 'entregar_productos' then
        -- La entrega queda registrada al cobrar la cita (la reserva se convierte en venta)
        raise exception 'usa_cobro_de_cita';
    else
        raise exception 'accion_invalida';
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- Agenda: "registrar cobro" y "anular cobro" usan el registro de ventas (un solo origen de verdad)
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
        v_monto := barberia_private._num(p_datos, 'monto');
        v_metodo := p_datos ->> 'metodo';
        if v_monto is null or v_monto <= 0 or v_monto > 10000000 or v_metodo is null or v_metodo not in ('efectivo', 'tarjeta', 'transferencia', 'otro') then
            raise exception 'pago_invalido';
        end if;
        perform panel_venta_cobrar(jsonb_build_object('clave', coalesce(barberia_private._uuid(p_datos ->> 'clave'), gen_random_uuid()), 'cita_id', p_cita,
            'pagos', jsonb_build_array(jsonb_build_object('metodo', v_metodo, 'monto', round(v_monto, 2)))));
    elsif p_accion = 'anular_pago' then
        perform barberia_private._reembolso_total_cita(p_cita, coalesce(nullif(trim(p_datos ->> 'motivo'), ''), 'Anulación del cobro desde la agenda'), false);
    else
        raise exception 'accion_invalida';
    end if;
    return panel_cita(p_cita);
end;
$$;

-- ==========================================
-- COBROS ANTERIORES A ESTE MÓDULO
-- Cada cita marcada como pagada pasa a tener su venta histórica (sin caja), para que
-- los reportes salgan de un solo registro. Solo citas sin venta: se puede repetir.
-- ==========================================
do $$
declare
    v record;
    v_venta uuid;
    v_monto numeric;
    v_precio numeric;
    v_metodo text;
begin
    for v in select c.*, s.nombre as servicio_nombre, s.precio as servicio_precio from citas c join servicios s on s.id = c.servicio_id
              where c.pagada_en is not null
                and not exists (select 1 from ventas x where x.cita_id = c.id::text) order by c.id loop
        v_precio := round(coalesce(v.precio_final, v.precio_servicio, v.servicio_precio, 0), 2);
        v_monto := round(coalesce(v.monto_cobrado, v_precio), 2);
        v_metodo := case when v.metodo_pago in ('efectivo', 'tarjeta', 'transferencia') then v.metodo_pago else 'otro' end;
        insert into ventas (clave, cita_id, cliente_nombre, cliente_telefono, origen, subtotal, descuento, total, pagado, notas, creado_en)
        values (gen_random_uuid(), v.id::text, v.nombre_cliente, v.telefono_cliente, 'historico', greatest(v_precio, v_monto), 0,
                greatest(v_precio, v_monto), case when v_monto > 0 then v_monto else 0 end,
                'Cobro registrado antes del módulo de ventas', v.pagada_en)
        returning id into v_venta;
        insert into venta_detalles (venta_id, tipo, servicio_id, barbero_id, descripcion, cantidad, precio_unitario, descuento, total, creado_en)
        values (v_venta, 'servicio', v.servicio_id::text, v.barbero_id::text, v.servicio_nombre, 1, greatest(v_precio, v_monto), 0,
                greatest(v_precio, v_monto), v.pagada_en);
        if v_monto > 0 then
            insert into pagos (venta_id, tipo, metodo, monto, es_historico, creado_en)
            values (v_venta, 'pago', v_metodo, v_monto, true, v.pagada_en);
            if v.reembolsada_en is not null then
                insert into pagos (venta_id, tipo, metodo, monto, es_historico, creado_en)
                values (v_venta, 'reembolso', v_metodo, v_monto, true, v.reembolsada_en);
                update ventas set reembolsado = v_monto where id = v_venta;
            end if;
        end if;
    end loop;
end $$;

-- ==========================================
-- SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['operaciones_financieras', 'proveedores', 'inventario_movimientos', 'servicio_consumos', 'compras',
                                   'compra_detalles', 'caja_sesiones', 'caja_movimientos', 'caja_correcciones', 'ventas', 'venta_detalles',
                                   'pagos', 'devoluciones', 'gastos'] loop
        execute format('alter table barberia.%I enable row level security', v_tabla);
        execute format('revoke all on barberia.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and (p.proname like 'panel\_venta%' or p.proname like 'panel\_caja\_%'
                       or p.proname like 'panel\_gasto%' or p.proname like 'panel\_inv\_%' or p.proname = 'panel_finanzas') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;
-- Funciones internas: nadie las ejecuta directamente
revoke all on function barberia_private._num(jsonb, text) from public, anon, authenticated;
revoke all on function barberia_private._uuid(text) from public, anon, authenticated;
revoke all on function barberia_private._unidad(text) from public, anon, authenticated;
revoke all on function barberia_private._convertir(numeric, text, text) from public, anon, authenticated;
revoke all on function barberia_private._operacion_previa(uuid, text) from public, anon, authenticated;
revoke all on function barberia_private._registrar_operacion(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function barberia_private.tg_inmutable() from public, anon, authenticated;
revoke all on function barberia_private.tg_productos_existencia() from public, anon, authenticated;
revoke all on function barberia_private.tg_productos_alta() from public, anon, authenticated;
revoke all on function barberia_private._mover_inventario(uuid, numeric, text, text, text, text, numeric) from public, anon, authenticated;
revoke all on function barberia_private._aplicar_consumos(text, numeric, text, text) from public, anon, authenticated;
revoke all on function barberia_private.tg_citas_consumo() from public, anon, authenticated;
revoke all on function barberia_private._caja_abierta() from public, anon, authenticated;
revoke all on function barberia_private._caja_resumen(uuid) from public, anon, authenticated;
revoke all on function barberia_private._verificar_efectivo(uuid, numeric) from public, anon, authenticated;
revoke all on function barberia_private._venta_json(uuid) from public, anon, authenticated;
revoke all on function barberia_private._sincronizar_cita(uuid) from public, anon, authenticated;
revoke all on function barberia_private.tg_venta_detalle_fija() from public, anon, authenticated;
revoke all on function barberia_private._sesion_json(uuid) from public, anon, authenticated;
revoke all on function barberia_private._registrar_gasto(jsonb, uuid) from public, anon, authenticated;
revoke all on function barberia_private._reembolso_total_cita(text, text, boolean) from public, anon, authenticated;
-- Artículos: escritura solo por funciones (la existencia, solo por movimientos)
revoke insert, update, delete on barberia.productos from anon, authenticated;
revoke all on sequence barberia.productos_codigo_seq from anon, authenticated;

notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261027000000_portafolio_ocupacion_reclamaciones.sql
-- #####################################################################
-- =====================================================================
-- PORTAFOLIO POR BARBERO, OCUPACIÓN Y RECLAMACIONES
--
-- Portafolio: trabajos con estados borrador -> pendiente -> publicado -> archivado.
--   Solo el administrador publica. Una imagen con una persona identificable solo
--   se publica con una autorización de imagen vigente (registrada aparte: aceptar
--   una cita NO es autorización). Menores: exige representante. Retirar la
--   autorización archiva (despublica) sus trabajos. Lo no publicado es privado.
-- Ocupación: lectura sobre el mismo motor de agenda (jornada, descansos, bloqueos,
--   minutos entre citas). No cambia reservas ni horarios.
-- Reclamaciones: caso con número y token secreto para el cliente; mensajes visibles
--   y notas internas separadas; historial inmutable. No cancela citas, no reembolsa
--   ni toca la caja: un reembolso se hace en Ventas y aquí solo se vincula.
-- Imágenes: en la base, comprimidas (mismo almacenamiento que las fotos actuales).
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;

-- ==========================================
-- PERFIL PÚBLICO DEL BARBERO
-- ==========================================
alter table barberia.barberos
    add column if not exists presentacion text,
    add column if not exists especialidades text[] not null default '{}',
    add column if not exists portafolio_propio boolean not null default true;

-- ==========================================
-- AUTORIZACIONES DE IMAGEN
-- ==========================================
create table if not exists barberia.autorizaciones_imagen (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    cliente_nombre text not null check (length(trim(cliente_nombre)) between 1 and 120),
    cliente_telefono text,
    alcance text not null check (alcance in ('portafolio_web', 'portafolio_y_redes')),
    fecha date not null,
    referencia text check (length(referencia) <= 200),
    es_menor boolean not null default false,
    representante_nombre text,
    representante_relacion text,
    evidencia text,
    estado text not null default 'vigente' check (estado in ('vigente', 'retirada')),
    retirada_en timestamptz,
    retirada_por uuid,
    motivo_retiro text,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    check (not es_menor or (length(trim(coalesce(representante_nombre, ''))) > 0 and length(trim(coalesce(representante_relacion, ''))) > 0))
);

-- ==========================================
-- TRABAJOS DEL PORTAFOLIO
-- ==========================================
create table if not exists barberia.portafolio_trabajos (
    id uuid primary key default gen_random_uuid(),
    -- Como en el resto del sistema, los ids de barberos y servicios se guardan como texto (id::text)
    barbero_id text not null,
    servicio_id text,
    titulo text not null check (length(trim(titulo)) between 1 and 80),
    descripcion text check (length(descripcion) <= 300),
    texto_alternativo text not null check (length(trim(texto_alternativo)) between 3 and 200),
    especialidad text check (length(especialidad) <= 40),
    imagen text not null,
    miniatura text not null,
    estado text not null default 'borrador' check (estado in ('borrador', 'pendiente', 'publicado', 'archivado')),
    destacado boolean not null default false,
    orden int,
    muestra_persona boolean not null default true,
    autorizacion_id uuid references barberia.autorizaciones_imagen (id),
    motivo_estado text,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    publicado_en timestamptz,
    publicado_por uuid
);
create index if not exists portafolio_publicados_idx on barberia.portafolio_trabajos (barbero_id, destacado desc, orden, publicado_en desc) where estado = 'publicado';
create index if not exists portafolio_barbero_idx on barberia.portafolio_trabajos (barbero_id, estado);
create index if not exists portafolio_autorizacion_idx on barberia.portafolio_trabajos (autorizacion_id) where autorizacion_id is not null;

-- Regla de datos (además de los permisos): un trabajo con persona identificable solo
-- queda publicado con una autorización vigente para el portafolio.
create or replace function barberia_private.tg_portafolio_publicacion() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    if new.estado = 'publicado' and new.muestra_persona
       and not exists (select 1 from autorizaciones_imagen a where a.id = new.autorizacion_id and a.estado = 'vigente') then
        raise exception 'autorizacion_requerida';
    end if;
    new.actualizado_en := now();
    return new;
end;
$$;
drop trigger if exists portafolio_publicacion on barberia.portafolio_trabajos;
create trigger portafolio_publicacion before insert or update on barberia.portafolio_trabajos
    for each row execute function barberia_private.tg_portafolio_publicacion();

-- ==========================================
-- RECLAMACIONES
-- ==========================================
create table if not exists barberia.reclamacion_categorias (
    id bigint generated always as identity primary key,
    nombre text not null check (length(trim(nombre)) between 1 and 60),
    activa boolean not null default true,
    orden int not null default 0
);
create unique index if not exists reclamacion_categorias_nombre_key on barberia.reclamacion_categorias (lower(nombre));
insert into barberia.reclamacion_categorias (nombre, orden)
select v.nombre, v.orden from (values ('Resultado del servicio', 1), ('Tiempo de espera', 2), ('Atención recibida', 3), ('Cobro', 4),
                                      ('Reserva', 5), ('Producto', 6), ('Otro', 7)) v (nombre, orden)
 where not exists (select 1 from barberia.reclamacion_categorias c where lower(c.nombre) = lower(v.nombre));

create table if not exists barberia.reclamaciones_config (
    id boolean primary key default true check (id),
    horas_objetivo_respuesta int not null default 48 check (horas_objetivo_respuesta between 1 and 720),
    actualizado_en timestamptz not null default now()
);
insert into barberia.reclamaciones_config (id) values (true) on conflict (id) do nothing;

create table if not exists barberia.reclamaciones (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    token uuid not null unique default gen_random_uuid(),
    clave uuid not null unique,
    cita_id text,
    venta_id uuid references barberia.ventas (id),
    barbero_id text,
    cliente_nombre text not null check (length(trim(cliente_nombre)) between 1 and 120),
    cliente_telefono text,
    cliente_user_id uuid,
    categoria_id bigint not null references barberia.reclamacion_categorias (id),
    descripcion text not null check (length(trim(descripcion)) between 10 and 2000),
    origen text not null default 'cliente' check (origen in ('cliente', 'equipo')),
    estado text not null default 'recibida' check (estado in ('recibida', 'en_revision', 'esperando_cliente', 'resuelta', 'cerrada')),
    prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta')),
    responsable_user_id uuid,
    fecha_objetivo timestamptz not null,
    primera_respuesta_en timestamptz,
    resuelta_en timestamptz,
    cerrada_en timestamptz,
    ultima_actividad_en timestamptz not null default now(),
    solucion text check (length(solucion) <= 2000),
    reembolso_venta_id uuid references barberia.ventas (id),
    creado_en timestamptz not null default now()
);
create index if not exists reclamaciones_estado_idx on barberia.reclamaciones (estado, ultima_actividad_en desc);
create index if not exists reclamaciones_responsable_idx on barberia.reclamaciones (responsable_user_id) where responsable_user_id is not null;
create index if not exists reclamaciones_cliente_idx on barberia.reclamaciones (cliente_user_id) where cliente_user_id is not null;
create index if not exists reclamaciones_cita_idx on barberia.reclamaciones (cita_id) where cita_id is not null;

create table if not exists barberia.reclamacion_mensajes (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references barberia.reclamaciones (id),
    clave uuid not null unique,
    autor text not null check (autor in ('cliente', 'equipo')),
    autor_user_id uuid,
    interno boolean not null default false,
    cuerpo text not null check (length(trim(cuerpo)) between 1 and 2000),
    creado_en timestamptz not null default now(),
    check (autor = 'equipo' or not interno)
);
create index if not exists reclamacion_mensajes_idx on barberia.reclamacion_mensajes (reclamacion_id, id);

create table if not exists barberia.reclamacion_adjuntos (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references barberia.reclamaciones (id),
    mensaje_id bigint references barberia.reclamacion_mensajes (id),
    subido_por text not null check (subido_por in ('cliente', 'equipo')),
    interno boolean not null default false,
    imagen text not null,
    creado_por uuid,
    creado_en timestamptz not null default now()
);
create index if not exists reclamacion_adjuntos_idx on barberia.reclamacion_adjuntos (reclamacion_id);

create table if not exists barberia.reclamacion_eventos (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references barberia.reclamaciones (id),
    tipo text not null check (tipo in ('creada', 'estado', 'asignacion', 'prioridad', 'mensaje', 'nota', 'solucion', 'reapertura',
                                       'reembolso', 'fecha_objetivo', 'respuesta_cliente')),
    de text,
    a text,
    motivo text,
    usuario_id uuid,
    actor text not null default 'equipo' check (actor in ('cliente', 'equipo', 'sistema')),
    creado_en timestamptz not null default now()
);
create index if not exists reclamacion_eventos_idx on barberia.reclamacion_eventos (reclamacion_id, id);

-- Historial y mensajes nunca cambian; casos, trabajos y autorizaciones no se borran
do $$
declare
    v_tabla text;
begin
    foreach v_tabla in array array['reclamacion_mensajes', 'reclamacion_adjuntos', 'reclamacion_eventos'] loop
        execute format('drop trigger if exists %I on barberia.%I', v_tabla || '_inmutable', v_tabla);
        execute format('create trigger %I before update or delete on barberia.%I for each row execute function barberia_private.tg_inmutable()',
                       v_tabla || '_inmutable', v_tabla);
    end loop;
    foreach v_tabla in array array['reclamaciones', 'portafolio_trabajos', 'autorizaciones_imagen', 'reclamacion_categorias'] loop
        execute format('drop trigger if exists %I on barberia.%I', v_tabla || '_sin_borrado', v_tabla);
        execute format('create trigger %I before delete on barberia.%I for each row execute function barberia_private.tg_inmutable()',
                       v_tabla || '_sin_borrado', v_tabla);
    end loop;
end $$;

-- ==========================================
-- AUXILIARES
-- ==========================================
-- Imagen comprimida y de tamaño acotado (jpeg, png o webp)
create or replace function barberia_private._imagen_ok(p text, p_max int) returns boolean
language sql immutable set search_path = barberia, pg_temp as $$
    select p is not null and length(p) <= p_max and p ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
$$;

-- Administrador, o el propio barbero si puede gestionar su portafolio
create or replace function barberia_private._exigir_portafolio(p_barbero text) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
begin
    if v_rol = 'admin' then
        return v_rol;
    end if;
    if p_barbero is distinct from barbero_actual()
       or not coalesce((select portafolio_propio from barberos where id::text = p_barbero), false) then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v_rol;
end;
$$;

create or replace function barberia_private._trabajo_json(t barberia.portafolio_trabajos, p_privado boolean) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object('id', t.id, 'barbero_id', t.barbero_id::text, 'servicio_id', t.servicio_id::text,
        'servicio', (select nombre from servicios where id::text = t.servicio_id), 'titulo', t.titulo, 'descripcion', t.descripcion,
        'texto_alternativo', t.texto_alternativo, 'especialidad', t.especialidad, 'miniatura', t.miniatura, 'destacado', t.destacado,
        'orden', t.orden)
        || case when p_privado then jsonb_build_object('estado', t.estado, 'muestra_persona', t.muestra_persona,
            'autorizacion_id', t.autorizacion_id, 'autorizacion_numero', (select numero from autorizaciones_imagen where id = t.autorizacion_id),
            'autorizacion_vigente', (select estado = 'vigente' from autorizaciones_imagen where id = t.autorizacion_id),
            'motivo_estado', t.motivo_estado, 'creado_en', t.creado_en, 'publicado_en', t.publicado_en,
            'barbero', (select nombre from barberos where id::text = t.barbero_id),
            'creado_por', (select email from auth.users where id = t.creado_por)) else '{}'::jsonb end
$$;

-- ==========================================
-- PORTAFOLIO: WEB PÚBLICA
-- ==========================================
-- Perfil público: ahora también presentación, especialidades y cantidad de trabajos publicados
create or replace function barberia.barberos_publicos() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id::text, 'nombre', b.nombre, 'especialidad', b.especialidad, 'foto_url', b.foto_url,
        'presentacion', b.presentacion, 'especialidades', to_jsonb(b.especialidades),
        'trabajos', (select count(*) from portafolio_trabajos t where t.barbero_id = b.id::text and t.estado = 'publicado'))
        order by b.orden nulls last, b.nombre), '[]'::jsonb)
      from barberos b where b.activo is not false
$$;

-- Galería paginada: solo trabajos publicados de barberos activos, en miniatura
create or replace function barberia.portafolio_publico(p_barbero text, p_limite int default 24, p_desde int default 0) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_limite int := least(greatest(coalesce(p_limite, 24), 1), 48);
begin
    if not exists (select 1 from barberos where id::text = p_barbero and activo is not false) then
        raise exception 'barbero_no_encontrado';
    end if;
    return jsonb_build_object(
        'total', (select count(*) from portafolio_trabajos where barbero_id::text = p_barbero and estado = 'publicado'),
        'trabajos', coalesce((select jsonb_agg(barberia_private._trabajo_json(t, false) order by t.destacado desc, t.orden nulls last, t.publicado_en desc, t.id)
            from portafolio_trabajos t
           where t.id in (select id from portafolio_trabajos where barbero_id::text = p_barbero and estado = 'publicado'
                           order by destacado desc, orden nulls last, publicado_en desc, id limit v_limite offset greatest(coalesce(p_desde, 0), 0))), '[]'::jsonb),
        'especialidades', coalesce((select jsonb_agg(distinct especialidad) from portafolio_trabajos
                                     where barbero_id::text = p_barbero and estado = 'publicado' and especialidad is not null), '[]'::jsonb),
        'servicios', coalesce((select jsonb_agg(distinct jsonb_build_object('id', s.id::text, 'nombre', s.nombre)) from portafolio_trabajos t
                                 join servicios s on s.id::text = t.servicio_id where t.barbero_id = p_barbero and t.estado = 'publicado'), '[]'::jsonb));
end;
$$;

-- Imagen ampliada (solo si está publicada)
create or replace function barberia.portafolio_imagen(p_id uuid) returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select t.imagen from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id
     where t.id = p_id and t.estado = 'publicado' and b.activo is not false
$$;

-- ==========================================
-- PORTAFOLIO: PANEL
-- ==========================================
create or replace function barberia.panel_portafolio(p_barbero text default null, p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return jsonb_build_object(
        'puede_gestionar', v_rol = 'admin' or coalesce((select portafolio_propio from barberos where id::text = v_barbero), false),
        'es_admin', v_rol = 'admin',
        'trabajos', coalesce((select jsonb_agg(barberia_private._trabajo_json(t, true) order by t.barbero_id, t.destacado desc, t.orden nulls last, t.creado_en desc)
            from portafolio_trabajos t
           where (v_barbero is null or t.barbero_id::text = v_barbero) and (nullif(p_estado, '') is null or t.estado = p_estado)), '[]'::jsonb));
end;
$$;

create or replace function barberia.panel_portafolio_imagen(p_id uuid) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v portafolio_trabajos;
begin
    select * into v from portafolio_trabajos where id = p_id;
    if not found then
        raise exception 'trabajo_no_encontrado';
    end if;
    if _exigir_panel() = 'barbero' and v.barbero_id::text is distinct from barbero_actual() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v.imagen;
end;
$$;

-- p_datos: { barbero_id, servicio_id?, titulo, descripcion?, texto_alternativo, especialidad?, imagen?, miniatura?,
--            muestra_persona, autorizacion_id? (solo administrador) }
create or replace function barberia.panel_portafolio_guardar(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_actual portafolio_trabajos;
    v_barbero text;
    v_rol text;
    v_servicio text;
    v_autorizacion uuid := barberia_private._uuid(p_datos ->> 'autorizacion_id');
    v_id uuid := p_id;
begin
    if p_id is not null then
        select * into v_actual from portafolio_trabajos where id = p_id for update;
        if not found then
            raise exception 'trabajo_no_encontrado';
        end if;
        v_barbero := v_actual.barbero_id::text;
    else
        v_barbero := coalesce(nullif(p_datos ->> 'barbero_id', ''), barbero_actual());
    end if;
    v_rol := barberia_private._exigir_portafolio(v_barbero);
    -- El barbero edita sus borradores y pendientes; lo publicado o archivado lo gestiona el administrador
    if v_rol = 'barbero' and p_id is not null and v_actual.estado not in ('borrador', 'pendiente') then
        raise exception 'trabajo_bloqueado';
    end if;
    if v_rol = 'barbero' and v_autorizacion is distinct from v_actual.autorizacion_id then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if not exists (select 1 from barberos where id::text = v_barbero) then
        raise exception 'barbero_no_encontrado';
    end if;
    if nullif(p_datos ->> 'servicio_id', '') is not null then
        select id::text into v_servicio from servicios where id::text = p_datos ->> 'servicio_id';
        if v_servicio is null then
            raise exception 'servicio_no_disponible';
        end if;
    end if;
    if v_autorizacion is not null and not exists (select 1 from autorizaciones_imagen where id = v_autorizacion) then
        raise exception 'autorizacion_no_encontrada';
    end if;
    if coalesce(length(trim(p_datos ->> 'titulo')), 0) not between 1 and 80 or length(coalesce(p_datos ->> 'descripcion', '')) > 300
       or coalesce(length(trim(p_datos ->> 'texto_alternativo')), 0) not between 3 and 200 or length(coalesce(p_datos ->> 'especialidad', '')) > 40 then
        raise exception 'trabajo_invalido';
    end if;
    if (p_id is null or p_datos ? 'imagen') and (not barberia_private._imagen_ok(p_datos ->> 'imagen', 900000) or not barberia_private._imagen_ok(p_datos ->> 'miniatura', 200000)) then
        raise exception 'imagen_invalida';
    end if;

    if p_id is null then
        if (select count(*) from portafolio_trabajos where barbero_id::text = v_barbero and estado <> 'archivado') >= 120 then
            raise exception 'limite_portafolio';
        end if;
        insert into portafolio_trabajos (barbero_id, servicio_id, titulo, descripcion, texto_alternativo, especialidad, imagen, miniatura,
                                         muestra_persona, autorizacion_id, creado_por)
        values (v_barbero, v_servicio, trim(p_datos ->> 'titulo'), nullif(trim(p_datos ->> 'descripcion'), ''), trim(p_datos ->> 'texto_alternativo'),
                nullif(trim(p_datos ->> 'especialidad'), ''), p_datos ->> 'imagen', p_datos ->> 'miniatura',
                coalesce((p_datos ->> 'muestra_persona')::boolean, true), v_autorizacion, auth.uid())
        returning id into v_id;
    else
        update portafolio_trabajos
           set servicio_id = v_servicio, titulo = trim(p_datos ->> 'titulo'), descripcion = nullif(trim(p_datos ->> 'descripcion'), ''),
               texto_alternativo = trim(p_datos ->> 'texto_alternativo'), especialidad = nullif(trim(p_datos ->> 'especialidad'), ''),
               imagen = case when p_datos ? 'imagen' then p_datos ->> 'imagen' else imagen end,
               miniatura = case when p_datos ? 'imagen' then p_datos ->> 'miniatura' else miniatura end,
               muestra_persona = coalesce((p_datos ->> 'muestra_persona')::boolean, muestra_persona),
               autorizacion_id = v_autorizacion
         where id = p_id;
    end if;
    perform _auditar(case when p_id is null then 'trabajo_creado' else 'trabajo_actualizado' end, 'portafolio', v_id::text,
                     jsonb_build_object('titulo', trim(p_datos ->> 'titulo'), 'barbero_id', v_barbero));
    return barberia_private._trabajo_json((select t from portafolio_trabajos t where id = v_id), true);
end;
$$;

-- Flujo: enviar a revisión (barbero o admin) · devolver a borrador, publicar, archivar, destacar (admin) · retirar el propio (barbero)
create or replace function barberia.panel_portafolio_estado(p_id uuid, p_accion text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v portafolio_trabajos;
    v_rol text;
begin
    select * into v from portafolio_trabajos where id = p_id for update;
    if not found then
        raise exception 'trabajo_no_encontrado';
    end if;
    v_rol := barberia_private._exigir_portafolio(v.barbero_id::text);
    if p_accion = 'enviar_revision' then
        if v.estado <> 'borrador' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set estado = 'pendiente', motivo_estado = null where id = p_id;
    elsif p_accion = 'archivar' then
        if v.estado = 'archivado' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set estado = 'archivado', destacado = false, motivo_estado = nullif(left(trim(p_motivo), 300), '') where id = p_id;
    elsif v_rol <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    elsif p_accion = 'publicar' then
        if v.estado = 'publicado' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set estado = 'publicado', motivo_estado = null, publicado_en = now(), publicado_por = auth.uid() where id = p_id;
    elsif p_accion = 'devolver' then
        if v.estado <> 'pendiente' then raise exception 'transicion_invalida'; end if;
        if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'motivo_requerido'; end if;
        update portafolio_trabajos set estado = 'borrador', motivo_estado = left(trim(p_motivo), 300) where id = p_id;
    elsif p_accion = 'destacar' then
        if v.estado <> 'publicado' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set destacado = not destacado where id = p_id;
    else
        raise exception 'accion_invalida';
    end if;
    perform _auditar('trabajo_' || p_accion, 'portafolio', p_id::text, jsonb_build_object('antes', v.estado, 'motivo', p_motivo));
    return barberia_private._trabajo_json((select t from portafolio_trabajos t where id = p_id), true);
end;
$$;

create or replace function barberia.panel_portafolio_ordenar(p_barbero text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform barberia_private._exigir_portafolio(p_barbero);
    if coalesce(cardinality(p_ids), 0) > 200 then
        raise exception 'trabajo_invalido';
    end if;
    update portafolio_trabajos t set orden = o.pos from unnest(p_ids) with ordinality o(id, pos)
     where t.id = o.id and t.barbero_id::text = p_barbero;
    perform _auditar('portafolio_ordenado', 'portafolio', p_barbero, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end;
$$;

-- Perfil público del barbero: presentación y especialidades (admin, o el propio barbero si puede gestionar su portafolio)
create or replace function barberia.panel_barbero_perfil(p_barbero text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else p_barbero end;
begin
    return (select jsonb_build_object('id', id::text, 'nombre', nombre, 'presentacion', presentacion, 'especialidades', to_jsonb(especialidades),
                   'portafolio_propio', portafolio_propio, 'foto_url', foto_url) from barberos where id::text = v_barbero);
end;
$$;

create or replace function barberia.panel_barbero_perfil_guardar(p_barbero text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := barberia_private._exigir_portafolio(p_barbero);
    v_especialidades text[];
begin
    select coalesce(array_agg(distinct trim(e)) filter (where trim(e) <> ''), '{}') into v_especialidades
      from jsonb_array_elements_text(coalesce(p_datos -> 'especialidades', '[]'::jsonb)) e;
    if length(coalesce(p_datos ->> 'presentacion', '')) > 500 or cardinality(v_especialidades) > 8
       or exists (select 1 from unnest(v_especialidades) e where length(e) > 40) then
        raise exception 'perfil_invalido';
    end if;
    update barberos set presentacion = nullif(trim(p_datos ->> 'presentacion'), ''), especialidades = v_especialidades,
           portafolio_propio = case when v_rol = 'admin' and p_datos ? 'portafolio_propio' then (p_datos ->> 'portafolio_propio')::boolean else portafolio_propio end
     where id::text = p_barbero;
    if not found then
        raise exception 'barbero_no_encontrado';
    end if;
    perform _auditar('perfil_barbero', 'barbero', p_barbero, p_datos);
    return panel_barbero_perfil(p_barbero);
end;
$$;

-- ==========================================
-- AUTORIZACIONES DE IMAGEN (solo administrador; datos y evidencia privados)
-- ==========================================
create or replace function barberia.panel_autorizaciones() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'numero', a.numero, 'cliente_nombre', a.cliente_nombre,
            'cliente_telefono', a.cliente_telefono, 'alcance', a.alcance, 'fecha', a.fecha, 'referencia', a.referencia, 'es_menor', a.es_menor,
            'representante_nombre', a.representante_nombre, 'representante_relacion', a.representante_relacion, 'tiene_evidencia', a.evidencia is not null,
            'estado', a.estado, 'retirada_en', a.retirada_en, 'motivo_retiro', a.motivo_retiro,
            'trabajos', (select count(*) from portafolio_trabajos t where t.autorizacion_id = a.id),
            'publicados', (select count(*) from portafolio_trabajos t where t.autorizacion_id = a.id and t.estado = 'publicado'))
            order by a.estado, a.numero desc) from autorizaciones_imagen a), '[]'::jsonb);
end;
$$;

-- Se registra cuando el cliente (o su representante) autoriza expresamente el uso de su imagen.
create or replace function barberia.panel_autorizacion_registrar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_id uuid;
    v_menor boolean := coalesce((p_datos ->> 'es_menor')::boolean, false);
    v_fecha date := nullif(p_datos ->> 'fecha', '')::date;
begin
    perform _exigir_panel(true);
    if coalesce(length(trim(p_datos ->> 'cliente_nombre')), 0) not between 1 and 120 or p_datos ->> 'alcance' not in ('portafolio_web', 'portafolio_y_redes')
       or v_fecha is null or v_fecha > _ahora_local()::date or length(coalesce(p_datos ->> 'referencia', '')) > 200 then
        raise exception 'autorizacion_invalida';
    end if;
    if v_menor and (coalesce(length(trim(p_datos ->> 'representante_nombre')), 0) = 0 or coalesce(length(trim(p_datos ->> 'representante_relacion')), 0) = 0) then
        raise exception 'representante_requerido';
    end if;
    if nullif(p_datos ->> 'evidencia', '') is not null and not barberia_private._imagen_ok(p_datos ->> 'evidencia', 900000) then
        raise exception 'imagen_invalida';
    end if;
    insert into autorizaciones_imagen (cliente_nombre, cliente_telefono, alcance, fecha, referencia, es_menor, representante_nombre,
                                       representante_relacion, evidencia, creado_por)
    values (trim(p_datos ->> 'cliente_nombre'), normalizar_telefono(p_datos ->> 'cliente_telefono'), p_datos ->> 'alcance', v_fecha,
            nullif(trim(p_datos ->> 'referencia'), ''), v_menor, nullif(trim(p_datos ->> 'representante_nombre'), ''),
            nullif(trim(p_datos ->> 'representante_relacion'), ''), nullif(p_datos ->> 'evidencia', ''), auth.uid())
    returning id into v_id;
    perform _auditar('autorizacion_registrada', 'autorizacion', v_id::text, jsonb_build_object('alcance', p_datos ->> 'alcance', 'es_menor', v_menor));
    return jsonb_build_object('id', v_id, 'numero', (select numero from autorizaciones_imagen where id = v_id));
end;
$$;

-- Retirada: la autorización queda retirada y sus trabajos publicados se archivan (despublican) en la misma operación
create or replace function barberia.panel_autorizacion_retirar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_archivados int;
begin
    perform _exigir_panel(true);
    if coalesce(length(trim(p_motivo)), 0) < 3 then
        raise exception 'motivo_requerido';
    end if;
    update autorizaciones_imagen set estado = 'retirada', retirada_en = now(), retirada_por = auth.uid(), motivo_retiro = left(trim(p_motivo), 300)
     where id = p_id and estado = 'vigente';
    if not found then
        raise exception 'autorizacion_no_encontrada';
    end if;
    update portafolio_trabajos set estado = 'archivado', destacado = false, motivo_estado = 'Autorización de imagen retirada'
     where autorizacion_id = p_id and estado in ('publicado', 'pendiente', 'borrador') and muestra_persona;
    get diagnostics v_archivados = row_count;
    perform _auditar('autorizacion_retirada', 'autorizacion', p_id::text, jsonb_build_object('trabajos_archivados', v_archivados));
    return jsonb_build_object('ok', true, 'trabajos_archivados', v_archivados);
end;
$$;

create or replace function barberia.panel_autorizacion_evidencia(p_id uuid) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return (select evidencia from autorizaciones_imagen where id = p_id);
end;
$$;

-- ==========================================
-- OCUPACIÓN (lectura del motor de agenda)
-- ==========================================
-- Jornada programada del barbero ese día, sin descontar bloqueos (los bloqueos se restan aparte).
-- Mismas fuentes y prioridad que _jornada: horario propio, horario general, horas generales.
create or replace function barberia_private._jornada_base(p_barbero text, p_fecha date, out abre time, out cierra time)
language plpgsql stable set search_path = barberia, pg_temp as $$
declare
    v_dia int := extract(dow from p_fecha)::int;
    v_fila record;
begin
    select * into v_fila from horarios_semana where barbero_id = p_barbero and dia = v_dia;
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
    select (ajustes ->> 'hora_apertura')::time, (ajustes ->> 'hora_cierre')::time into abre, cierra from modulos_config where modulo = 'general';
end;
$$;

create or replace function barberia_private._minutos(p tsmultirange) returns numeric
language sql immutable set search_path = barberia, pg_temp as $$
    select coalesce(sum(extract(epoch from upper(r) - lower(r)) / 60), 0) from unnest(p) r
$$;

-- Estados incluidos como reservados: citas no canceladas (pendientes, confirmadas, completadas y ausencias:
-- todas ocuparon su horario). Las canceladas no cuentan. Las solapadas se cuentan una vez y se informan.
create or replace function barberia.panel_ocupacion(p_desde date, p_hasta date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_barbero text := nullif(p_barbero, '');
    v_margen int := coalesce((_ajuste('general', 'minutos_entre_citas'))::int, 0); -- preparación entre citas configurada
    v_intervalo int := greatest(coalesce((_ajuste('general', 'intervalo_minutos'))::int, 60), 5);
    v_ahora timestamp := _ahora_local();
    v_b record;
    v_fecha date;
    v_j record;
    v_base tsmultirange;
    v_nodisp tsmultirange;
    v_disp tsmultirange;
    v_res tsmultirange;
    v_ocup tsmultirange;
    v_libre tsmultirange;
    v_h int;
    v_franja tsmultirange;
    v_hueco tsrange;
    v_inicio timestamp;
    v_dias jsonb := '[]'::jsonb;
    v_huecos jsonb := '[]'::jsonb;
    v_conflictos jsonb := '[]'::jsonb;
    v_calor jsonb := '{}'::jsonb;
    v_clave text;
    v_min_servicio int;
begin
    perform _exigir_panel(true);
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
        raise exception 'rango_invalido';
    end if;
    for v_b in select b.id::text as id, b.nombre from barberos b
                where (v_barbero is null or b.id::text = v_barbero)
                  and (b.activo is not false or exists (select 1 from citas c where c.barbero_id = b.id and c.fecha between p_desde and p_hasta))
                order by b.orden nulls last, b.nombre loop
        select min(s.duracion_minutos) into v_min_servicio from servicios s where s.activo and _barbero_hace_servicio(v_b.id, s.id::text);
        for v_fecha in select generate_series(p_desde, p_hasta, interval '1 day')::date loop
            select * into v_j from barberia_private._jornada_base(v_b.id, v_fecha);
            v_base := case when v_j.abre is not null and v_j.cierra > v_j.abre
                           then tsmultirange(tsrange(v_fecha + v_j.abre, v_fecha + v_j.cierra)) else '{}'::tsmultirange end;
            -- Descansos y bloqueos (parciales o de día completo) del barbero o de todo el negocio
            select coalesce(range_agg(r), '{}'::tsmultirange) into v_nodisp from (
                select tsrange(v_fecha + d.desde, v_fecha + d.hasta) r from descansos d
                 where d.dia = extract(dow from v_fecha)::int and (d.barbero_id is null or d.barbero_id = v_b.id)
                union all
                select case when bl.hora_desde is null then tsrange(v_fecha::timestamp, (v_fecha + 1)::timestamp)
                            else tsrange(v_fecha + bl.hora_desde, v_fecha + bl.hora_hasta) end
                  from bloqueos bl
                 where bl.activo and v_fecha between bl.fecha_desde and bl.fecha_hasta and (bl.barbero_id is null or bl.barbero_id = v_b.id)) x;
            v_nodisp := v_nodisp * v_base;
            v_disp := v_base - v_nodisp;
            select coalesce(range_agg(tsrange(v_fecha + c.hora, v_fecha + c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30)))), '{}'::tsmultirange),
                   coalesce(range_agg(tsrange(v_fecha + c.hora - make_interval(mins => v_margen),
                                              v_fecha + c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30) + v_margen))), '{}'::tsmultirange)
              into v_res, v_ocup
              from citas c left join servicios s on s.id = c.servicio_id
             where c.barbero_id::text = v_b.id and c.fecha = v_fecha and c.estado <> 'cancelada';

            v_dias := v_dias || jsonb_build_object('barbero_id', v_b.id, 'barbero', v_b.nombre, 'fecha', v_fecha,
                'programados', barberia_private._minutos(v_base), 'no_disponibles', barberia_private._minutos(v_nodisp), 'disponibles', barberia_private._minutos(v_disp),
                'reservados', barberia_private._minutos(v_res * v_disp), 'fuera_de_jornada', barberia_private._minutos(v_res - v_disp),
                'citas', (select count(*) from citas where barbero_id::text = v_b.id and fecha = v_fecha and estado <> 'cancelada'),
                'completadas', (select count(*) from citas where barbero_id::text = v_b.id and fecha = v_fecha and estado <> 'cancelada' and completada_en is not null),
                'minutos_completados', (select coalesce(sum(coalesce(c.duracion_reservada, s.duracion_minutos, 30)), 0) from citas c left join servicios s on s.id = c.servicio_id
                                         where c.barbero_id::text = v_b.id and c.fecha = v_fecha and c.estado <> 'cancelada' and c.completada_en is not null),
                'canceladas', (select count(*) from citas where barbero_id::text = v_b.id and fecha = v_fecha and estado = 'cancelada'),
                'ausencias', (select count(*) from citas where barbero_id::text = v_b.id and fecha = v_fecha and estado <> 'cancelada' and no_asistio_en is not null));

            -- Conflictos visibles: citas que se solapan entre sí o caen fuera del tiempo disponible
            v_conflictos := v_conflictos || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'solape', 'barbero', v_b.nombre, 'barbero_id', v_b.id, 'fecha', v_fecha,
                    'citas', jsonb_build_array(a.id::text, b.id::text), 'horas', to_char(a.hora, 'HH24:MI') || ' y ' || to_char(b.hora, 'HH24:MI')))
                from citas a join citas b on b.barbero_id = a.barbero_id and b.fecha = a.fecha and a.id < b.id
                left join servicios sa on sa.id = a.servicio_id left join servicios sb on sb.id = b.servicio_id
               where a.barbero_id::text = v_b.id and a.fecha = v_fecha and a.estado <> 'cancelada' and b.estado <> 'cancelada'
                 and a.hora < b.hora + make_interval(mins => coalesce(b.duracion_reservada, sb.duracion_minutos, 30))
                 and b.hora < a.hora + make_interval(mins => coalesce(a.duracion_reservada, sa.duracion_minutos, 30))), '[]'::jsonb);
            if barberia_private._minutos(v_res - v_disp) > 0 then
                v_conflictos := v_conflictos || jsonb_build_object('tipo', 'fuera_de_jornada', 'barbero', v_b.nombre, 'barbero_id', v_b.id, 'fecha', v_fecha,
                    'minutos', barberia_private._minutos(v_res - v_disp));
            end if;

            -- Mapa de calor: minutos disponibles y reservados por día de la semana y hora
            for v_h in select generate_series(0, 23) loop
                v_franja := tsmultirange(tsrange(v_fecha + make_interval(hours => v_h), v_fecha + make_interval(hours => v_h + 1))) * v_disp;
                continue when barberia_private._minutos(v_franja) = 0;
                v_clave := extract(dow from v_fecha)::int || ':' || v_h;
                v_calor := jsonb_set(v_calor, array[v_clave], jsonb_build_object(
                    'dia', extract(dow from v_fecha)::int, 'hora', v_h,
                    'disponibles', coalesce((v_calor #>> array[v_clave, 'disponibles'])::numeric, 0) + barberia_private._minutos(v_franja),
                    'reservados', coalesce((v_calor #>> array[v_clave, 'reservados'])::numeric, 0) + barberia_private._minutos(v_res * v_franja)));
            end loop;

            -- Huecos aprovechables (futuros): tiempo disponible sin citas ni su margen, desde la primera hora de la cuadrícula
            v_libre := v_disp - v_ocup;
            for v_hueco in select unnest(v_libre) loop
                continue when upper(v_hueco) <= v_ahora;
                v_inicio := v_fecha + v_j.abre + make_interval(mins => v_intervalo
                            * ceil(extract(epoch from greatest(lower(v_hueco), v_ahora) - (v_fecha + v_j.abre)) / 60 / v_intervalo)::int);
                continue when v_inicio + make_interval(mins => coalesce(v_min_servicio, 30)) > upper(v_hueco);
                v_huecos := v_huecos || jsonb_build_object('barbero_id', v_b.id, 'barbero', v_b.nombre, 'fecha', v_fecha,
                    'desde', to_char(lower(v_hueco), 'HH24:MI'), 'hasta', to_char(upper(v_hueco), 'HH24:MI'),
                    'primer_inicio', to_char(v_inicio, 'HH24:MI'), 'minutos', extract(epoch from upper(v_hueco) - v_inicio) / 60,
                    'servicios_que_caben', (select count(*) from servicios s where s.activo and _barbero_hace_servicio(v_b.id, s.id::text)
                                              and v_inicio + make_interval(mins => s.duracion_minutos) <= upper(v_hueco)),
                    'servicios', coalesce((select jsonb_agg(jsonb_build_object('nombre', s.nombre, 'duracion', s.duracion_minutos) order by s.duracion_minutos desc, s.nombre)
                        from (select * from servicios s where s.activo and _barbero_hace_servicio(v_b.id, s.id::text)
                                 and v_inicio + make_interval(mins => s.duracion_minutos) <= upper(v_hueco)
                               order by s.duracion_minutos desc, s.nombre limit 5) s), '[]'::jsonb));
            end loop;
        end loop;
    end loop;

    return jsonb_build_object(
        'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'barbero_id', v_barbero, 'zona', _zona(), 'margen_minutos', v_margen,
                                      'intervalo_minutos', v_intervalo),
        'dias', v_dias,
        'barberos', coalesce((select jsonb_agg(to_jsonb(t) order by t.barbero) from (
            select d ->> 'barbero_id' as barbero_id, min(d ->> 'barbero') as barbero,
                   sum((d ->> 'programados')::numeric) as programados, sum((d ->> 'no_disponibles')::numeric) as no_disponibles,
                   sum((d ->> 'disponibles')::numeric) as disponibles, sum((d ->> 'reservados')::numeric) as reservados,
                   sum((d ->> 'fuera_de_jornada')::numeric) as fuera_de_jornada, sum((d ->> 'citas')::int) as citas,
                   sum((d ->> 'completadas')::int) as completadas, sum((d ->> 'minutos_completados')::numeric) as minutos_completados,
                   sum((d ->> 'canceladas')::int) as canceladas, sum((d ->> 'ausencias')::int) as ausencias
              from jsonb_array_elements(v_dias) d group by d ->> 'barbero_id') t), '[]'::jsonb),
        'mapa_calor', coalesce((select jsonb_agg(v order by (v ->> 'dia')::int, (v ->> 'hora')::int) from jsonb_each(v_calor) e(k, v)), '[]'::jsonb),
        'huecos', coalesce((select jsonb_agg(h order by h ->> 'fecha', h ->> 'primer_inicio', h ->> 'barbero') from (
                    select h from jsonb_array_elements(v_huecos) h order by h ->> 'fecha', h ->> 'primer_inicio' limit 300) t), '[]'::jsonb),
        'huecos_total', jsonb_array_length(v_huecos),
        'conflictos', v_conflictos);
end;
$$;

-- ==========================================
-- RECLAMACIONES: AUXILIARES
-- ==========================================
create or replace function barberia_private._reclamacion_evento(p_id uuid, p_tipo text, p_de text, p_a text, p_motivo text, p_actor text default 'equipo')
returns void
language sql security definer set search_path = barberia, pg_temp as $$
    insert into reclamacion_eventos (reclamacion_id, tipo, de, a, motivo, usuario_id, actor)
    values (p_id, p_tipo, p_de, p_a, left(p_motivo, 500), case when p_actor = 'equipo' then auth.uid() end, p_actor);
    update reclamaciones set ultima_actividad_en = now() where id = p_id;
$$;

create or replace function barberia_private._reclamacion_adjuntar(p_id uuid, p_mensaje bigint, p_adjuntos jsonb, p_por text, p_interno boolean) returns int
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_img text;
    v_n int := 0;
begin
    if jsonb_typeof(coalesce(p_adjuntos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_adjuntos, '[]'::jsonb)) > 3 then
        raise exception 'adjuntos_invalidos';
    end if;
    if (select count(*) from reclamacion_adjuntos where reclamacion_id = p_id) + jsonb_array_length(coalesce(p_adjuntos, '[]'::jsonb)) > 12 then
        raise exception 'adjuntos_invalidos';
    end if;
    for v_img in select jsonb_array_elements_text(coalesce(p_adjuntos, '[]'::jsonb)) loop
        if not barberia_private._imagen_ok(v_img, 900000) then
            raise exception 'imagen_invalida';
        end if;
        insert into reclamacion_adjuntos (reclamacion_id, mensaje_id, subido_por, interno, imagen, creado_por)
        values (p_id, p_mensaje, p_por, p_interno, v_img, auth.uid());
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

create or replace function barberia_private._reclamacion_codigo(p_numero bigint) returns text
language sql immutable set search_path = barberia, pg_temp as $$
    select 'R-' || lpad(p_numero::text, 5, '0')
$$;

-- Vista del cliente: sin notas internas, sin adjuntos del equipo ni datos del responsable
create or replace function barberia_private._reclamacion_cliente_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object('codigo', barberia_private._reclamacion_codigo(r.numero), 'token', r.token, 'estado', r.estado,
        'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'descripcion', r.descripcion,
        'creado_en', r.creado_en, 'ultima_actividad_en', r.ultima_actividad_en, 'resuelta_en', r.resuelta_en,
        'solucion', case when r.estado in ('resuelta', 'cerrada') then r.solucion end,
        'puede_responder', r.estado = 'esperando_cliente',
        'cita', (select jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', s.nombre)
                   from citas c left join servicios s on s.id = c.servicio_id where c.id::text = r.cita_id),
        'mensajes', coalesce((select jsonb_agg(jsonb_build_object('autor', m.autor, 'cuerpo', m.cuerpo, 'creado_en', m.creado_en,
                'adjuntos', coalesce((select jsonb_agg(a.id) from reclamacion_adjuntos a where a.mensaje_id = m.id and a.subido_por = 'cliente'), '[]'::jsonb))
                order by m.id) from reclamacion_mensajes m where m.reclamacion_id = r.id and not m.interno), '[]'::jsonb),
        'adjuntos', coalesce((select jsonb_agg(a.id order by a.id) from reclamacion_adjuntos a where a.reclamacion_id = r.id and a.subido_por = 'cliente'), '[]'::jsonb))
      from reclamaciones r where r.id = p_id
$$;

create or replace function barberia_private._reclamacion_resumen_json(r barberia.reclamaciones) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object('codigo', barberia_private._reclamacion_codigo(r.numero), 'token', r.token, 'estado', r.estado,
        'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'creado_en', r.creado_en,
        'ultima_actividad_en', r.ultima_actividad_en, 'puede_responder', r.estado = 'esperando_cliente')
$$;

-- ==========================================
-- RECLAMACIONES: CLIENTE (token secreto de la cita o del caso; nunca por teléfono ni por número)
-- ==========================================
create or replace function barberia.reclamacion_categorias_publicas() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by orden, nombre), '[]'::jsonb)
      from reclamacion_categorias where activa
$$;

-- p_datos: { clave, token_cita, categoria_id, descripcion, adjuntos?: [data URL, ...] (máx. 3) }
create or replace function barberia.reclamacion_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_cita citas;
    v_id uuid;
    v_categoria bigint;
    v_descripcion text := trim(p_datos ->> 'descripcion');
begin
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    select * into v_cita from citas where id::text = _cita_por_token(barberia_private._uuid(p_datos ->> 'token_cita'));
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    -- Doble envío: devuelve el caso ya creado con esta clave para esta misma cita
    select id into v_id from reclamaciones where clave = v_clave;
    if v_id is not null then
        if (select cita_id from reclamaciones where id = v_id) is distinct from v_cita.id::text then
            raise exception 'clave_operacion_usada';
        end if;
        return barberia_private._reclamacion_cliente_json(v_id) || jsonb_build_object('repetida', true);
    end if;
    select id into v_categoria from reclamacion_categorias where id = barberia_private._num(p_datos, 'categoria_id')::bigint and activa;
    if v_categoria is null then
        raise exception 'categoria_invalida';
    end if;
    if coalesce(length(v_descripcion), 0) not between 10 and 2000 then
        raise exception 'descripcion_invalida';
    end if;
    if (select count(*) from reclamaciones where cita_id = v_cita.id::text and estado not in ('resuelta', 'cerrada')) >= 3 then
        raise exception 'limite_reclamaciones';
    end if;
    insert into reclamaciones (clave, cita_id, venta_id, barbero_id, cliente_nombre, cliente_telefono, cliente_user_id, categoria_id, descripcion, fecha_objetivo)
    values (v_clave, v_cita.id::text, (select id from ventas where cita_id = v_cita.id::text and estado <> 'anulada'), v_cita.barbero_id::text,
            v_cita.nombre_cliente, normalizar_telefono(v_cita.telefono_cliente), coalesce(auth.uid(), v_cita.cliente_user_id), v_categoria, v_descripcion,
            now() + make_interval(hours => (select horas_objetivo_respuesta from reclamaciones_config where id)))
    returning id into v_id;
    perform barberia_private._reclamacion_adjuntar(v_id, null, p_datos -> 'adjuntos', 'cliente', false);
    perform barberia_private._reclamacion_evento(v_id, 'creada', null, 'recibida', null, 'cliente');
    return barberia_private._reclamacion_cliente_json(v_id) || jsonb_build_object('repetida', false);
end;
$$;

create or replace function barberia.reclamacion_consultar(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_id uuid;
begin
    select id into v_id from reclamaciones where token = p_token;
    if v_id is null then
        raise exception 'reclamacion_no_encontrada';
    end if;
    return barberia_private._reclamacion_cliente_json(v_id);
end;
$$;

-- Imagen que el propio cliente adjuntó (las del equipo no se muestran al cliente)
create or replace function barberia.reclamacion_adjunto(p_token uuid, p_adjunto bigint) returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select a.imagen from reclamacion_adjuntos a join reclamaciones r on r.id = a.reclamacion_id
     where r.token = p_token and a.id = p_adjunto and a.subido_por = 'cliente'
$$;

-- p_datos: { clave, token, cuerpo, adjuntos? }  · solo cuando el equipo pidió información
create or replace function barberia.reclamacion_responder(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v reclamaciones;
    v_mensaje bigint;
begin
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    select * into v from reclamaciones where token = barberia_private._uuid(p_datos ->> 'token') for update;
    if not found then
        raise exception 'reclamacion_no_encontrada';
    end if;
    if exists (select 1 from reclamacion_mensajes where clave = v_clave and reclamacion_id = v.id) then
        return barberia_private._reclamacion_cliente_json(v.id) || jsonb_build_object('repetida', true);
    end if;
    if v.estado <> 'esperando_cliente' then
        raise exception 'respuesta_no_solicitada';
    end if;
    if coalesce(length(trim(p_datos ->> 'cuerpo')), 0) not between 1 and 2000 then
        raise exception 'descripcion_invalida';
    end if;
    insert into reclamacion_mensajes (reclamacion_id, clave, autor, cuerpo) values (v.id, v_clave, 'cliente', trim(p_datos ->> 'cuerpo'))
    returning id into v_mensaje;
    perform barberia_private._reclamacion_adjuntar(v.id, v_mensaje, p_datos -> 'adjuntos', 'cliente', false);
    update reclamaciones set estado = 'en_revision' where id = v.id;
    perform barberia_private._reclamacion_evento(v.id, 'respuesta_cliente', 'esperando_cliente', 'en_revision', null, 'cliente');
    return barberia_private._reclamacion_cliente_json(v.id) || jsonb_build_object('repetida', false);
end;
$$;

create or replace function barberia.mis_reclamaciones_por_tokens(p_tokens uuid[]) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    if coalesce(cardinality(p_tokens), 0) > 100 then
        raise exception 'demasiadas_citas';
    end if;
    return coalesce((select jsonb_agg(barberia_private._reclamacion_resumen_json(r) order by r.creado_en desc)
                       from reclamaciones r where r.token = any (coalesce(p_tokens, '{}'))), '[]'::jsonb);
end;
$$;

create or replace function barberia.mis_reclamaciones() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return coalesce((select jsonb_agg(barberia_private._reclamacion_resumen_json(r) order by r.creado_en desc)
                       from reclamaciones r where r.id in (select id from reclamaciones where cliente_user_id = auth.uid() order by creado_en desc limit 100)), '[]'::jsonb);
end;
$$;

-- ==========================================
-- RECLAMACIONES: PANEL
-- Administrador: todos los casos. Barbero: solo los que tiene asignados.
-- ==========================================
create or replace function barberia_private._exigir_reclamacion(p_id uuid) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
begin
    if not exists (select 1 from reclamaciones where id = p_id and (v_rol = 'admin' or responsable_user_id = auth.uid())) then
        raise exception 'reclamacion_no_encontrada';
    end if;
    return v_rol;
end;
$$;

create or replace function barberia_private._responsables() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select coalesce(jsonb_agg(x order by x ->> 'nombre'), '[]'::jsonb) from (
        select jsonb_build_object('user_id', u.id, 'nombre', u.email, 'rol', 'Administración') x
          from admin_usuarios a join auth.users u on u.id = a.user_id
        union all
        select jsonb_build_object('user_id', u.id, 'nombre', b.nombre || ' (' || u.email || ')', 'rol', 'Barbero')
          from barbero_usuarios bu join auth.users u on u.id = bu.user_id join barberos b on b.id::text = bu.barbero_id
         where b.activo is not false and not exists (select 1 from admin_usuarios a where a.user_id = bu.user_id)) t
$$;

create or replace function barberia.panel_reclamaciones(p_filtros jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_estado text := nullif(p_filtros ->> 'estado', '');
    v_texto text := nullif(trim(p_filtros ->> 'busqueda'), '');
    v_limite int := least(greatest(coalesce(barberia_private._num(p_filtros, 'limite')::int, 50), 1), 100);
    v_desde int := greatest(coalesce(barberia_private._num(p_filtros, 'desde')::int, 0), 0);
begin
    return (with base as (
        select r.* from reclamaciones r
         where (v_rol = 'admin' or r.responsable_user_id = auth.uid())
           and (v_estado is null or (v_estado = 'abiertas' and r.estado not in ('resuelta', 'cerrada')) or r.estado = v_estado)
           and (nullif(p_filtros ->> 'categoria_id', '') is null or r.categoria_id::text = p_filtros ->> 'categoria_id')
           and (nullif(p_filtros ->> 'responsable', '') is null
                or (p_filtros ->> 'responsable' = 'sin_asignar' and r.responsable_user_id is null)
                or r.responsable_user_id::text = p_filtros ->> 'responsable')
           and (v_texto is null or barberia_private._reclamacion_codigo(r.numero) ilike '%' || v_texto || '%' or r.numero::text = v_texto
                or r.cliente_nombre ilike '%' || v_texto || '%'))
    select jsonb_build_object('total', (select count(*) from base),
        'casos', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', barberia_private._reclamacion_codigo(r.numero), 'estado', r.estado,
                'prioridad', r.prioridad, 'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'cliente', r.cliente_nombre,
                'responsable', (select email from auth.users where id = r.responsable_user_id), 'creado_en', r.creado_en,
                'ultima_actividad_en', r.ultima_actividad_en, 'fecha_objetivo', r.fecha_objetivo, 'primera_respuesta_en', r.primera_respuesta_en,
                'vencida', r.estado not in ('resuelta', 'cerrada') and r.primera_respuesta_en is null and now() > r.fecha_objetivo,
                'esperando_equipo', r.estado in ('recibida', 'en_revision'))
                order by r.estado in ('resuelta', 'cerrada'), r.prioridad = 'alta' desc, r.ultima_actividad_en desc)
            from (select * from base order by estado in ('resuelta', 'cerrada'), prioridad = 'alta' desc, ultima_actividad_en desc
                   limit v_limite offset v_desde) r), '[]'::jsonb),
        'categorias', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'activa', activa) order by orden, nombre), '[]'::jsonb) from reclamacion_categorias),
        'responsables', case when v_rol = 'admin' then barberia_private._responsables() else '[]'::jsonb end,
        'es_admin', v_rol = 'admin'));
end;
$$;

create or replace function barberia.panel_reclamacion(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := barberia_private._exigir_reclamacion(p_id);
begin
    return (select jsonb_build_object('id', r.id, 'codigo', barberia_private._reclamacion_codigo(r.numero), 'estado', r.estado, 'prioridad', r.prioridad,
        'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'categoria_id', r.categoria_id,
        'descripcion', r.descripcion, 'origen', r.origen, 'cliente_nombre', r.cliente_nombre, 'cliente_telefono', r.cliente_telefono,
        'cita_id', r.cita_id, 'venta_id', r.venta_id, 'venta_numero', (select numero from ventas where id = r.venta_id),
        'cita', (select jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', s.nombre, 'barbero', b.nombre, 'estado', c.estado)
                   from citas c left join servicios s on s.id = c.servicio_id left join barberos b on b.id = c.barbero_id where c.id::text = r.cita_id),
        'responsable_user_id', r.responsable_user_id, 'responsable', (select email from auth.users where id = r.responsable_user_id),
        'creado_en', r.creado_en, 'ultima_actividad_en', r.ultima_actividad_en, 'fecha_objetivo', r.fecha_objetivo,
        'primera_respuesta_en', r.primera_respuesta_en, 'resuelta_en', r.resuelta_en, 'cerrada_en', r.cerrada_en, 'solucion', r.solucion,
        'reembolso_venta_id', r.reembolso_venta_id, 'reembolso_venta_numero', (select numero from ventas where id = r.reembolso_venta_id),
        'enlace_token', case when v_rol = 'admin' then r.token end,
        'mensajes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'autor', m.autor, 'interno', m.interno, 'cuerpo', m.cuerpo, 'creado_en', m.creado_en,
                'usuario', (select email from auth.users where id = m.autor_user_id),
                'adjuntos', coalesce((select jsonb_agg(a.id) from reclamacion_adjuntos a where a.mensaje_id = m.id), '[]'::jsonb)) order by m.id)
            from reclamacion_mensajes m where m.reclamacion_id = r.id), '[]'::jsonb),
        'adjuntos_iniciales', coalesce((select jsonb_agg(a.id order by a.id) from reclamacion_adjuntos a where a.reclamacion_id = r.id and a.mensaje_id is null), '[]'::jsonb),
        'eventos', coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'de', e.de, 'a', e.a, 'motivo', e.motivo, 'actor', e.actor,
                'usuario', (select email from auth.users where id = e.usuario_id), 'creado_en', e.creado_en) order by e.id)
            from reclamacion_eventos e where e.reclamacion_id = r.id), '[]'::jsonb),
        'ventas_cita', case when v_rol = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'reembolsado', v.reembolsado,
                'devuelto', v.devuelto, 'estado', v.estado)) from ventas v where v.cita_id = r.cita_id or v.id = r.venta_id), '[]'::jsonb) end,
        'responsables', case when v_rol = 'admin' then barberia_private._responsables() else '[]'::jsonb end,
        'es_admin', v_rol = 'admin')
      from reclamaciones r where r.id = p_id);
end;
$$;

create or replace function barberia.panel_reclamacion_adjunto(p_adjunto bigint) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_caso uuid;
begin
    select reclamacion_id into v_caso from reclamacion_adjuntos where id = p_adjunto;
    if v_caso is null then
        raise exception 'reclamacion_no_encontrada';
    end if;
    perform barberia_private._exigir_reclamacion(v_caso);
    return (select imagen from reclamacion_adjuntos where id = p_adjunto);
end;
$$;

-- Mensaje al cliente (visible) o nota interna. solicitar_info = el caso pasa a esperar respuesta del cliente.
-- Solo un mensaje visible cuenta como primera respuesta; una nota interna no.
create or replace function barberia.panel_reclamacion_mensaje(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_id uuid := barberia_private._uuid(p_datos ->> 'reclamacion_id');
    v reclamaciones;
    v_interno boolean := coalesce((p_datos ->> 'interno')::boolean, false);
    v_solicitar boolean := coalesce((p_datos ->> 'solicitar_info')::boolean, false);
    v_mensaje bigint;
begin
    perform barberia_private._exigir_reclamacion(v_id);
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    if exists (select 1 from reclamacion_mensajes where clave = v_clave) then
        return panel_reclamacion(v_id);
    end if;
    select * into v from reclamaciones where id = v_id for update;
    if v.estado = 'cerrada' then
        raise exception 'reclamacion_cerrada';
    end if;
    if coalesce(length(trim(p_datos ->> 'cuerpo')), 0) not between 1 and 2000 then
        raise exception 'descripcion_invalida';
    end if;
    insert into reclamacion_mensajes (reclamacion_id, clave, autor, autor_user_id, interno, cuerpo)
    values (v_id, v_clave, 'equipo', auth.uid(), v_interno, trim(p_datos ->> 'cuerpo'))
    returning id into v_mensaje;
    perform barberia_private._reclamacion_adjuntar(v_id, v_mensaje, p_datos -> 'adjuntos', 'equipo', v_interno);
    perform barberia_private._reclamacion_evento(v_id, case when v_interno then 'nota' else 'mensaje' end, null, null, null);
    if not v_interno then
        update reclamaciones set primera_respuesta_en = coalesce(primera_respuesta_en, now()),
               estado = case when v_solicitar then 'esperando_cliente' when estado = 'recibida' then 'en_revision' else estado end
         where id = v_id;
        if v_solicitar and v.estado <> 'esperando_cliente' then
            perform barberia_private._reclamacion_evento(v_id, 'estado', v.estado, 'esperando_cliente', 'Se pidió información al cliente');
        elsif v.estado = 'recibida' and not v_solicitar then
            perform barberia_private._reclamacion_evento(v_id, 'estado', 'recibida', 'en_revision', null);
        end if;
    end if;
    return panel_reclamacion(v_id);
end;
$$;

-- p_datos: { clave, reclamacion_id, accion, valor?, motivo? }
-- accion: estado (barbero asignado o admin; cerrar solo admin) · asignar · prioridad · fecha_objetivo · reabrir · reembolso (admin)
--         solucion (registrar la solución aplicada)
create or replace function barberia.panel_reclamacion_actualizar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_id uuid := barberia_private._uuid(p_datos ->> 'reclamacion_id');
    v_rol text := barberia_private._exigir_reclamacion(v_id);
    v reclamaciones;
    v_accion text := p_datos ->> 'accion';
    v_valor text := nullif(trim(p_datos ->> 'valor'), '');
    v_motivo text := nullif(trim(p_datos ->> 'motivo'), '');
    v_venta ventas;
begin
    select * into v from reclamaciones where id = v_id for update;
    if v_accion = 'estado' then
        if v_valor not in ('en_revision', 'esperando_cliente', 'resuelta', 'cerrada') or v_valor = v.estado then
            raise exception 'transicion_invalida';
        end if;
        if v.estado in ('resuelta', 'cerrada') and v_valor <> 'cerrada' then
            raise exception 'usa_reabrir';
        end if;
        if v_valor = 'cerrada' and v_rol <> 'admin' then
            raise exception 'no_autorizado' using errcode = '42501';
        end if;
        if v_valor = 'resuelta' and coalesce(length(coalesce(v_motivo, v.solucion)), 0) < 3 then
            raise exception 'solucion_requerida';
        end if;
        update reclamaciones set estado = v_valor,
               solucion = case when v_valor = 'resuelta' and v_motivo is not null then left(v_motivo, 2000) else solucion end,
               resuelta_en = case when v_valor = 'resuelta' then now() else resuelta_en end,
               cerrada_en = case when v_valor = 'cerrada' then now() else cerrada_en end
         where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'estado', v.estado, v_valor, v_motivo);
    elsif v_accion = 'solucion' then
        if coalesce(length(v_valor), 0) not between 3 and 2000 then
            raise exception 'solucion_requerida';
        end if;
        update reclamaciones set solucion = v_valor where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'solucion', null, null, null);
    elsif v_rol <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    elsif v_accion = 'asignar' then
        if v_valor is not null and not exists (select 1 from jsonb_array_elements(barberia_private._responsables()) x where x ->> 'user_id' = v_valor) then
            raise exception 'responsable_invalido';
        end if;
        update reclamaciones set responsable_user_id = v_valor::uuid where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'asignacion', (select email from auth.users where id = v.responsable_user_id),
                                            (select email from auth.users where id::text = v_valor), v_motivo);
    elsif v_accion = 'prioridad' then
        if v_valor not in ('baja', 'media', 'alta') then
            raise exception 'transicion_invalida';
        end if;
        update reclamaciones set prioridad = v_valor where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'prioridad', v.prioridad, v_valor, v_motivo);
    elsif v_accion = 'fecha_objetivo' then
        if v_valor is null or v_valor::timestamptz < v.creado_en then
            raise exception 'fecha_invalida';
        end if;
        update reclamaciones set fecha_objetivo = v_valor::timestamptz where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'fecha_objetivo', v.fecha_objetivo::text, v_valor, v_motivo);
    elsif v_accion = 'reabrir' then
        if v.estado not in ('resuelta', 'cerrada') then
            raise exception 'transicion_invalida';
        end if;
        if coalesce(length(v_motivo), 0) < 3 then
            raise exception 'motivo_requerido';
        end if;
        update reclamaciones set estado = 'en_revision', resuelta_en = null, cerrada_en = null where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'reapertura', v.estado, 'en_revision', v_motivo);
    elsif v_accion = 'reembolso' then
        -- Solo se vincula: el reembolso se registra en Ventas y cobros (caja y devoluciones)
        select * into v_venta from ventas where id = barberia_private._uuid(v_valor);
        if not found or (v_venta.reembolsado = 0 and v_venta.devuelto = 0) then
            raise exception 'reembolso_no_encontrado';
        end if;
        update reclamaciones set reembolso_venta_id = v_venta.id where id = v_id;
        perform barberia_private._reclamacion_evento(v_id, 'reembolso', null, 'Venta #' || v_venta.numero, v_motivo);
    else
        raise exception 'accion_invalida';
    end if;
    perform _auditar('reclamacion_' || v_accion, 'reclamacion', v_id::text, jsonb_build_object('a', v_valor));
    return panel_reclamacion(v_id);
end;
$$;

-- Caso registrado por el equipo (p. ej. una compra en mostrador): devuelve el enlace privado para el cliente
create or replace function barberia.panel_reclamacion_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_clave uuid := barberia_private._uuid(p_datos ->> 'clave');
    v_id uuid;
    v_cita citas;
    v_venta ventas;
begin
    perform _exigir_panel(true);
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    select id into v_id from reclamaciones where clave = v_clave;
    if v_id is not null then
        return panel_reclamacion(v_id);
    end if;
    if nullif(p_datos ->> 'cita_id', '') is not null then
        select * into v_cita from citas where id::text = p_datos ->> 'cita_id';
        if not found then raise exception 'cita_no_encontrada'; end if;
    end if;
    if barberia_private._uuid(p_datos ->> 'venta_id') is not null then
        select * into v_venta from ventas where id = barberia_private._uuid(p_datos ->> 'venta_id');
        if not found then raise exception 'venta_no_disponible'; end if;
    end if;
    if not exists (select 1 from reclamacion_categorias where id = barberia_private._num(p_datos, 'categoria_id')::bigint and activa) then
        raise exception 'categoria_invalida';
    end if;
    if coalesce(length(trim(coalesce(p_datos ->> 'cliente_nombre', v_cita.nombre_cliente, v_venta.cliente_nombre))), 0) = 0 then
        raise exception 'cliente_invalido';
    end if;
    if coalesce(length(trim(p_datos ->> 'descripcion')), 0) not between 10 and 2000 then
        raise exception 'descripcion_invalida';
    end if;
    insert into reclamaciones (clave, cita_id, venta_id, barbero_id, cliente_nombre, cliente_telefono, cliente_user_id, categoria_id, descripcion,
                               origen, fecha_objetivo)
    values (v_clave, v_cita.id::text, coalesce(v_venta.id, (select id from ventas where cita_id = v_cita.id::text and estado <> 'anulada')),
            v_cita.barbero_id::text, trim(coalesce(nullif(p_datos ->> 'cliente_nombre', ''), v_cita.nombre_cliente, v_venta.cliente_nombre)),
            normalizar_telefono(coalesce(nullif(p_datos ->> 'cliente_telefono', ''), v_cita.telefono_cliente, v_venta.cliente_telefono)),
            v_cita.cliente_user_id, barberia_private._num(p_datos, 'categoria_id')::bigint, trim(p_datos ->> 'descripcion'), 'equipo',
            now() + make_interval(hours => (select horas_objetivo_respuesta from reclamaciones_config where id)))
    returning id into v_id;
    perform barberia_private._reclamacion_adjuntar(v_id, null, p_datos -> 'adjuntos', 'equipo', false);
    perform barberia_private._reclamacion_evento(v_id, 'creada', null, 'recibida', 'Registrada por el equipo');
    return panel_reclamacion(v_id);
end;
$$;

-- Indicadores del periodo (por fecha de creación) y estado actual
create or replace function barberia.panel_reclamaciones_indicadores(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
begin
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return (with visibles as (
        select * from reclamaciones r where v_rol = 'admin' or r.responsable_user_id = auth.uid()
    ), periodo as (
        select * from visibles where (creado_en at time zone _zona())::date between p_desde and p_hasta
    )
    select jsonb_build_object(
        'abiertas', (select count(*) from visibles where estado not in ('resuelta', 'cerrada')),
        'sin_primera_respuesta', (select count(*) from visibles where estado not in ('resuelta', 'cerrada') and primera_respuesta_en is null),
        'fuera_de_plazo', (select count(*) from visibles where estado not in ('resuelta', 'cerrada') and primera_respuesta_en is null and now() > fecha_objetivo),
        'esperando_cliente', (select count(*) from visibles where estado = 'esperando_cliente'),
        'creadas_periodo', (select count(*) from periodo),
        'respondidas_tarde_periodo', (select count(*) from periodo where primera_respuesta_en > fecha_objetivo),
        'horas_primera_respuesta', (select round(avg(extract(epoch from primera_respuesta_en - creado_en) / 3600)::numeric, 1) from periodo where primera_respuesta_en is not null),
        'horas_resolucion', (select round(avg(extract(epoch from resuelta_en - creado_en) / 3600)::numeric, 1) from periodo where resuelta_en is not null),
        'motivos', coalesce((select jsonb_agg(jsonb_build_object('categoria', c.nombre, 'casos', n) order by n desc, c.nombre) from (
                    select categoria_id, count(*) n from periodo group by categoria_id) x join reclamacion_categorias c on c.id = x.categoria_id), '[]'::jsonb),
        'horas_objetivo', (select horas_objetivo_respuesta from reclamaciones_config where id)));
end;
$$;

-- Aviso interno del panel: casos que esperan al equipo
create or replace function barberia.panel_reclamaciones_pendientes() returns int
language sql stable security definer set search_path = barberia, pg_temp as $$
    select case when _rol_panel() is null then 0 else (select count(*)::int from reclamaciones
        where estado in ('recibida', 'en_revision') and (_rol_panel() = 'admin' or responsable_user_id = auth.uid())) end
$$;

create or replace function barberia.panel_reclamaciones_config(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_cat jsonb;
begin
    perform _exigir_panel(true);
    if p_datos ? 'horas_objetivo' then
        if barberia_private._num(p_datos, 'horas_objetivo') is null or barberia_private._num(p_datos, 'horas_objetivo') not between 1 and 720 then
            raise exception 'regla_invalida';
        end if;
        update reclamaciones_config set horas_objetivo_respuesta = barberia_private._num(p_datos, 'horas_objetivo')::int, actualizado_en = now() where id;
    end if;
    for v_cat in select * from jsonb_array_elements(coalesce(p_datos -> 'categorias', '[]'::jsonb)) loop
        if coalesce(length(trim(v_cat ->> 'nombre')), 0) not between 1 and 60 then
            raise exception 'categoria_invalida';
        end if;
        if nullif(v_cat ->> 'id', '') is null then
            insert into reclamacion_categorias (nombre, orden) values (trim(v_cat ->> 'nombre'), (select coalesce(max(orden), 0) + 1 from reclamacion_categorias));
        else
            update reclamacion_categorias set nombre = trim(v_cat ->> 'nombre'), activa = coalesce((v_cat ->> 'activa')::boolean, activa)
             where id::text = v_cat ->> 'id';
        end if;
    end loop;
    perform _auditar('reclamaciones_config', 'configuracion', 'reclamaciones', p_datos);
    return jsonb_build_object('horas_objetivo', (select horas_objetivo_respuesta from reclamaciones_config where id),
        'categorias', (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'activa', activa) order by orden, nombre) from reclamacion_categorias));
end;
$$;

-- ==========================================
-- SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['autorizaciones_imagen', 'portafolio_trabajos', 'reclamacion_categorias', 'reclamaciones_config', 'reclamaciones',
                                   'reclamacion_mensajes', 'reclamacion_adjuntos', 'reclamacion_eventos'] loop
        execute format('alter table barberia.%I enable row level security', v_tabla);
        execute format('revoke all on barberia.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and (p.proname like 'panel\_portafolio%' or p.proname like 'panel\_autorizacion%'
                       or p.proname like 'panel\_barbero\_perfil%' or p.proname like 'panel\_reclamacion%' or p.proname = 'panel_ocupacion'
                       or p.proname = 'mis_reclamaciones') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname in ('portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas',
                       'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens',
                       'barberos_publicos') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function barberia_private.tg_portafolio_publicacion() from public, anon, authenticated;
revoke all on function barberia_private._imagen_ok(text, int) from public, anon, authenticated;
revoke all on function barberia_private._exigir_portafolio(text) from public, anon, authenticated;
revoke all on function barberia_private._trabajo_json(barberia.portafolio_trabajos, boolean) from public, anon, authenticated;
revoke all on function barberia_private._jornada_base(text, date) from public, anon, authenticated;
revoke all on function barberia_private._minutos(tsmultirange) from public, anon, authenticated;
revoke all on function barberia_private._reclamacion_evento(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function barberia_private._reclamacion_adjuntar(uuid, bigint, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function barberia_private._reclamacion_codigo(bigint) from public, anon, authenticated;
revoke all on function barberia_private._reclamacion_cliente_json(uuid) from public, anon, authenticated;
revoke all on function barberia_private._reclamacion_resumen_json(barberia.reclamaciones) from public, anon, authenticated;
revoke all on function barberia_private._exigir_reclamacion(uuid) from public, anon, authenticated;
revoke all on function barberia_private._responsables() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261028000000_cuentas_permisos_notificaciones.sql
-- #####################################################################
-- =====================================================================
-- CUENTAS DE BARBEROS, PERMISOS, ATENCIÓN, DISPONIBILIDAD, INGRESOS Y NOTIFICACIONES
--
-- Cuentas: las contraseñas viven solo en Supabase Auth. barbero_usuarios vincula una
--   cuenta (user_id) con un perfil (barbero_id) de forma única. Una contraseña temporal
--   puesta por el administrador obliga a cambiarla: el servidor compara la huella del
--   hash de Auth (nunca la contraseña) y bloquea el panel hasta que cambie.
-- Solicitudes de acceso: registrarse no da privilegios; el administrador aprueba.
-- Permiso adicional «cajero»: cobrar y caja del día, sin administración completa.
-- Notificaciones internas por cuenta, únicas por evento y destinatario, generadas por
--   un disparador al guardar/cambiar la cita. Nunca impiden guardar la cita.
-- Web Push: cola aparte (push_envios) enviada por una Edge Function; si falla o no está
--   configurada, la cita y su aviso interno quedan guardados igual.
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;

-- ==========================================
-- CUENTAS PROFESIONALES
-- ==========================================
alter table barberia.barbero_usuarios
    add column if not exists debe_cambiar_clave boolean not null default false,
    add column if not exists huella_clave text,
    add column if not exists vinculado_por uuid,
    add column if not exists vinculado_en timestamptz;

-- Un perfil, una cuenta (si hubiera datos antiguos duplicados no se toca nada y se avisa)
do $$
begin
    if to_regclass('barberia.barbero_usuarios_barbero_key') is null then
        if exists (select barbero_id from barberia.barbero_usuarios group by barbero_id having count(*) > 1) then
            raise notice 'barbero_usuarios: hay perfiles con varias cuentas; revisalos antes de exigir cuenta unica';
        else
            create unique index barbero_usuarios_barbero_key on barberia.barbero_usuarios (barbero_id);
        end if;
    end if;
end $$;

create table if not exists barberia.barbero_permisos (
    user_id uuid not null,
    permiso text not null check (permiso in ('cajero')),
    otorgado_por uuid,
    otorgado_en timestamptz not null default now(),
    primary key (user_id, permiso)
);

create table if not exists barberia.solicitudes_profesionales (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    email text not null,
    nombre text not null check (length(trim(nombre)) between 2 and 80),
    telefono text,
    mensaje text check (length(mensaje) <= 500),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
    barbero_id text,
    respuesta text check (length(respuesta) <= 300),
    resuelta_por uuid,
    resuelta_en timestamptz,
    creado_en timestamptz not null default now()
);
create unique index if not exists solicitudes_profesionales_pendiente on barberia.solicitudes_profesionales (user_id) where estado = 'pendiente';
create index if not exists solicitudes_profesionales_estado_idx on barberia.solicitudes_profesionales (estado, creado_en desc);

-- Huella del hash de la contraseña en Auth (para saber si cambió; nunca se lee la contraseña)
create or replace function barberia_private._huella_clave(p_user uuid) returns text
language sql stable security definer set search_path = barberia, pg_temp as $$
    select md5(coalesce(encrypted_password, '') || id::text) from auth.users where id = p_user
$$;

-- Rol del panel. Un barbero con contraseña temporal no opera hasta cambiarla.
create or replace function barberia._exigir_panel(p_solo_admin boolean default false) returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _rol_panel();
begin
    if v_rol is null or (p_solo_admin and v_rol <> 'admin') then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if v_rol = 'barbero' and exists (select 1 from barbero_usuarios where user_id = auth.uid() and debe_cambiar_clave) then
        raise exception 'cambio_clave_requerido' using errcode = '42501';
    end if;
    return v_rol;
end;
$$;

create or replace function barberia.rol_panel() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'rol', _rol_panel(),
        'barbero_id', case when not es_admin() then barbero_actual() end,
        'barbero_nombre', (select nombre from barberos where id::text = barbero_actual()),
        'debe_cambiar_clave', case when not es_admin() then coalesce((select debe_cambiar_clave from barbero_usuarios where user_id = auth.uid()), false) else false end,
        'permisos', case when _rol_panel() = 'barbero'
                         then coalesce((select jsonb_agg(permiso order by permiso) from barbero_permisos where user_id = auth.uid()), '[]'::jsonb)
                         else '[]'::jsonb end)
$$;

-- Caja del día: administrador o barbero con el permiso explícito «cajero»
create or replace function barberia._exigir_caja() returns text
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
begin
    if v_rol = 'admin' then
        return v_rol;
    end if;
    if not exists (select 1 from barbero_permisos where user_id = auth.uid() and permiso = 'cajero') then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return 'cajero';
end;
$$;

-- El barbero confirma que ya cambió la contraseña temporal: el servidor lo comprueba en Auth
create or replace function barberia.panel_confirmar_cambio_clave() returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v barbero_usuarios;
begin
    select * into v from barbero_usuarios where user_id = auth.uid();
    if not found then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if v.debe_cambiar_clave then
        if v.huella_clave is not distinct from barberia_private._huella_clave(auth.uid()) then
            raise exception 'clave_sin_cambiar';
        end if;
        update barbero_usuarios set debe_cambiar_clave = false, huella_clave = null where user_id = auth.uid();
        perform _auditar('clave_temporal_cambiada', 'cuenta', v.barbero_id, '{}'::jsonb);
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- Estado de una cuenta de Auth por correo (solo administrador; nunca devuelve contraseñas)
create or replace function barberia.panel_cuenta_consultar(p_email text) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v record;
begin
    perform _exigir_panel(true);
    select id, created_at, last_sign_in_at, email_confirmed_at into v from auth.users where lower(email) = lower(trim(p_email));
    if not found then
        return jsonb_build_object('existe', false);
    end if;
    return jsonb_build_object('existe', true, 'verificado', v.email_confirmed_at is not null,
        'reciente', v.created_at > now() - interval '30 minutes' and v.last_sign_in_at is null,
        'es_admin', exists (select 1 from admin_usuarios where user_id = v.id),
        'barbero', (select b.nombre from barbero_usuarios bu join barberos b on b.id::text = bu.barbero_id where bu.user_id = v.id));
end;
$$;

-- Vinculación explícita cuenta-perfil. Idempotente (reintentos y doble clic).
-- p_datos: { barbero_id, email, clave_temporal, confirmar_existente, permisos: ['cajero'] }
-- Una cuenta ya existente (no creada en este alta) no se marca con contraseña temporal
-- ni pierde sus roles: solo se vincula si el administrador lo confirma.
create or replace function barberia.panel_cuenta_vincular(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_barbero text := p_datos ->> 'barbero_id';
    v record;
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
        return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    if exists (select 1 from barbero_usuarios where user_id = v.id) then
        raise exception 'cuenta_vinculada_otro';
    end if;
    if exists (select 1 from barbero_usuarios where barbero_id = v_barbero) then
        raise exception 'barbero_con_cuenta';
    end if;
    v_nueva := v.created_at > now() - interval '30 minutes' and v.last_sign_in_at is null;
    if not v_nueva and not coalesce((p_datos ->> 'confirmar_existente')::boolean, false) then
        raise exception 'cuenta_existente';
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

create or replace function barberia_private._permisos_guardar(p_user uuid, p_permisos jsonb) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then
        return;
    end if;
    if exists (select 1 from jsonb_array_elements_text(p_permisos) x where x not in ('cajero')) then
        raise exception 'permiso_invalido';
    end if;
    delete from barbero_permisos where user_id = p_user and permiso not in (select jsonb_array_elements_text(p_permisos));
    insert into barbero_permisos (user_id, permiso, otorgado_por)
    select p_user, x, auth.uid() from jsonb_array_elements_text(p_permisos) x
    on conflict (user_id, permiso) do nothing;
end;
$$;

create or replace function barberia.panel_cuenta_permisos(p_barbero text, p_permisos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_user uuid;
begin
    perform _exigir_panel(true);
    select user_id into v_user from barbero_usuarios where barbero_id = p_barbero;
    if v_user is null then
        raise exception 'barbero_sin_cuenta';
    end if;
    perform barberia_private._permisos_guardar(v_user, coalesce(p_permisos, '[]'::jsonb));
    perform _auditar('permisos_barbero', 'barbero', p_barbero, jsonb_build_object('permisos', p_permisos));
    return jsonb_build_object('ok', true);
end;
$$;

-- Quitar acceso: la cuenta de Auth se conserva (puede ser también cliente); se desactivan sus avisos push
create or replace function barberia.panel_cuenta_desvincular(p_barbero text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_user uuid;
begin
    perform _exigir_panel(true);
    select user_id into v_user from barbero_usuarios where barbero_id = p_barbero;
    if v_user is null then
        return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    delete from barbero_usuarios where barbero_id = p_barbero;
    delete from barbero_permisos where user_id = v_user;
    if not exists (select 1 from admin_usuarios where user_id = v_user) then
        update push_suscripciones set activa = false, actualizado_en = now() where user_id = v_user;
    end if;
    perform _auditar('cuenta_desvinculada', 'barbero', p_barbero, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'repetida', false);
end;
$$;

create or replace function barberia.panel_cuentas_barberos() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('barbero_id', bu.barbero_id, 'email', u.email,
            'verificado', u.email_confirmed_at is not null, 'debe_cambiar_clave', bu.debe_cambiar_clave,
            'ultimo_acceso', u.last_sign_in_at, 'vinculado_en', bu.vinculado_en,
            'permisos', coalesce((select jsonb_agg(p.permiso) from barbero_permisos p where p.user_id = bu.user_id), '[]'::jsonb)))
        from barbero_usuarios bu join auth.users u on u.id = bu.user_id), '[]'::jsonb);
end;
$$;

-- ==========================================
-- SOLICITUDES DE ACCESO PROFESIONAL
-- ==========================================
create or replace function barberia.solicitud_profesional_estado() returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object(
        'tiene_acceso', _rol_panel() is not null,
        'verificado', (select email_confirmed_at is not null from auth.users where id = auth.uid()),
        'solicitud', (select jsonb_build_object('estado', s.estado, 'creado_en', s.creado_en, 'respuesta', s.respuesta)
                        from solicitudes_profesionales s where s.user_id = auth.uid() order by s.creado_en desc limit 1))
$$;

create or replace function barberia.solicitud_profesional_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_email text;
    v_verificado boolean;
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select email, email_confirmed_at is not null into v_email, v_verificado from auth.users where id = auth.uid();
    if not v_verificado then
        raise exception 'correo_no_verificado';
    end if;
    if _rol_panel() is not null then
        raise exception 'ya_tiene_acceso';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('solicitud_profesional:' || auth.uid()::text, 0));
    select id into v_id from solicitudes_profesionales where user_id = auth.uid() and estado = 'pendiente';
    if v_id is not null then
        return jsonb_build_object('ok', true, 'repetida', true);
    end if;
    if coalesce(length(trim(p_datos ->> 'nombre')), 0) not between 2 and 80 or length(coalesce(p_datos ->> 'mensaje', '')) > 500 then
        raise exception 'datos_invalidos';
    end if;
    insert into solicitudes_profesionales (user_id, email, nombre, telefono, mensaje)
    values (auth.uid(), v_email, trim(p_datos ->> 'nombre'), normalizar_telefono(p_datos ->> 'telefono'), nullif(trim(p_datos ->> 'mensaje'), ''))
    returning id into v_id;
    perform barberia_private._notificar(a.user_id, 'solicitud:' || v_id::text, 'solicitud_acceso', 'Solicitud de acceso profesional',
                               trim(p_datos ->> 'nombre') || ' pidió acceso como barbero.', null, jsonb_build_object('seccion', 'solicitudes'))
       from admin_usuarios a;
    return jsonb_build_object('ok', true, 'repetida', false);
end;
$$;

create or replace function barberia.panel_solicitudes_profesionales(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'email', s.email, 'nombre', s.nombre, 'telefono', s.telefono,
            'mensaje', s.mensaje, 'estado', s.estado, 'respuesta', s.respuesta, 'creado_en', s.creado_en, 'resuelta_en', s.resuelta_en,
            'verificado', (select email_confirmed_at is not null from auth.users where id = s.user_id),
            'barbero', (select nombre from barberos where id::text = s.barbero_id)) order by s.creado_en desc)
        from (select * from solicitudes_profesionales where nullif(p_estado, '') is null or estado = p_estado order by creado_en desc limit 100) s), '[]'::jsonb);
end;
$$;

-- Aprobar = vincular con un perfil existente (sin cuenta). Rechazar = con motivo. Nunca cambia la contraseña.
create or replace function barberia.panel_solicitud_resolver(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v solicitudes_profesionales;
    v_barbero text := nullif(p_datos ->> 'barbero_id', '');
begin
    perform _exigir_panel(true);
    select * into v from solicitudes_profesionales where id = p_id for update;
    if not found then
        raise exception 'solicitud_no_encontrada';
    end if;
    if v.estado <> 'pendiente' then
        raise exception 'transicion_invalida';
    end if;
    if p_datos ->> 'accion' = 'rechazar' then
        update solicitudes_profesionales set estado = 'rechazada', respuesta = nullif(left(trim(p_datos ->> 'respuesta'), 300), ''),
               resuelta_por = auth.uid(), resuelta_en = now() where id = p_id;
    elsif p_datos ->> 'accion' = 'aprobar' then
        if (select email_confirmed_at from auth.users where id = v.user_id) is null then
            raise exception 'correo_no_verificado';
        end if;
        if v_barbero is null or not exists (select 1 from barberos where id::text = v_barbero) then
            raise exception 'barbero_no_encontrado';
        end if;
        if exists (select 1 from barbero_usuarios where barbero_id = v_barbero) then
            raise exception 'barbero_con_cuenta';
        end if;
        if exists (select 1 from barbero_usuarios where user_id = v.user_id) then
            raise exception 'cuenta_vinculada_otro';
        end if;
        insert into barbero_usuarios (user_id, barbero_id, vinculado_por, vinculado_en) values (v.user_id, v_barbero, auth.uid(), now());
        perform barberia_private._permisos_guardar(v.user_id, coalesce(p_datos -> 'permisos', '[]'::jsonb));
        update solicitudes_profesionales set estado = 'aprobada', barbero_id = v_barbero, respuesta = nullif(left(trim(p_datos ->> 'respuesta'), 300), ''),
               resuelta_por = auth.uid(), resuelta_en = now() where id = p_id;
    else
        raise exception 'accion_invalida';
    end if;
    perform _auditar('solicitud_' || (p_datos ->> 'accion'), 'solicitud_profesional', p_id::text, jsonb_build_object('barbero_id', v_barbero));
    return jsonb_build_object('ok', true);
end;
$$;

-- Perfil propio: el barbero edita foto, presentación y especialidades (no roles, precios ni comisiones)
create or replace function barberia.panel_barbero_perfil_guardar(p_barbero text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_especialidades text[];
begin
    if v_rol = 'barbero' and p_barbero is distinct from barbero_actual() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select coalesce(array_agg(distinct trim(e)) filter (where trim(e) <> ''), '{}') into v_especialidades
      from jsonb_array_elements_text(coalesce(p_datos -> 'especialidades', '[]'::jsonb)) e;
    if length(coalesce(p_datos ->> 'presentacion', '')) > 500 or cardinality(v_especialidades) > 8
       or exists (select 1 from unnest(v_especialidades) e where length(e) > 40) then
        raise exception 'perfil_invalido';
    end if;
    if p_datos ? 'foto_url' and nullif(p_datos ->> 'foto_url', '') is not null and not _imagen_valida(p_datos ->> 'foto_url') then
        raise exception 'imagen_invalida';
    end if;
    update barberos set presentacion = nullif(trim(p_datos ->> 'presentacion'), ''), especialidades = v_especialidades,
           foto_url = case when p_datos ? 'foto_url' then nullif(p_datos ->> 'foto_url', '') else foto_url end,
           portafolio_propio = case when v_rol = 'admin' and p_datos ? 'portafolio_propio' then (p_datos ->> 'portafolio_propio')::boolean else portafolio_propio end
     where id::text = p_barbero;
    if not found then
        raise exception 'barbero_no_encontrado';
    end if;
    perform _auditar('perfil_barbero', 'barbero', p_barbero, p_datos - 'foto_url');
    return panel_barbero_perfil(p_barbero);
end;
$$;

-- ==========================================
-- ATENCIÓN: inicio real del servicio (el fin es «completar», que no marca pagado)
-- ==========================================
alter table barberia.citas add column if not exists iniciada_en timestamptz;

create or replace function barberia.panel_cita_iniciar(p_cita text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v citas;
begin
    select * into v from citas where id::text = p_cita for update;
    if not found or (v_rol = 'barbero' and v.barbero_id::text is distinct from barbero_actual()) then
        raise exception 'cita_no_encontrada';
    end if;
    if v.estado = 'cancelada' then raise exception 'cita_cancelada'; end if;
    if v.completada_en is not null then raise exception 'cita_completada'; end if;
    if v.no_asistio_en is not null then raise exception 'cita_marcada_no_asistio'; end if;
    if v.fecha <> _ahora_local()::date then raise exception 'cita_no_es_hoy'; end if;
    update citas set iniciada_en = coalesce(iniciada_en, now()) where id = v.id;
    perform _auditar('cita_iniciada', 'cita', p_cita, '{}'::jsonb);
    return jsonb_build_object('ok', true);
end;
$$;

-- Citas de un día para atender (barbero: las suyas)
create or replace function barberia.panel_atencion(p_fecha date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id::text, 'hora', to_char(c.hora, 'HH24:MI'),
            'duracion', coalesce(c.duracion_reservada, s.duracion_minutos, 30), 'cliente', c.nombre_cliente, 'servicio', s.nombre,
            'barbero', b.nombre, 'estado', c.estado, 'notas', c.notas, 'iniciada_en', c.iniciada_en, 'completada_en', c.completada_en,
            'no_asistio_en', c.no_asistio_en) order by c.hora)
        from citas c left join servicios s on s.id = c.servicio_id left join barberos b on b.id = c.barbero_id
       where c.fecha = p_fecha and c.estado <> 'cancelada' and (v_barbero is null or c.barbero_id::text = v_barbero)), '[]'::jsonb);
end;
$$;

-- Tiempo real de atención (solo citas con inicio y fin registrados)
create or replace function barberia.panel_tiempo_real(p_desde date, p_hasta date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return (select jsonb_build_object('servicios', count(*),
            'minutos', coalesce(round(sum(extract(epoch from c.completada_en - c.iniciada_en) / 60)), 0),
            'minutos_reservados', coalesce(sum(coalesce(c.duracion_reservada, s.duracion_minutos, 30)), 0))
        from citas c left join servicios s on s.id = c.servicio_id
       where c.fecha between p_desde and p_hasta and c.iniciada_en is not null and c.completada_en > c.iniciada_en
         and (v_barbero is null or c.barbero_id::text = v_barbero));
end;
$$;

-- ==========================================
-- DISPONIBILIDAD: solicitudes del barbero sujetas a aprobación
-- ==========================================
create table if not exists barberia.solicitudes_disponibilidad (
    id uuid primary key default gen_random_uuid(),
    barbero_id text not null,
    solicitado_por uuid,
    tipo text not null check (tipo in ('bloqueo', 'vacaciones', 'descanso')),
    fecha_desde date,
    fecha_hasta date,
    hora_desde time,
    hora_hasta time,
    dia smallint check (dia between 0 and 6),
    motivo text check (length(motivo) <= 300),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
    respuesta text check (length(respuesta) <= 300),
    resuelta_por uuid,
    resuelta_en timestamptz,
    bloqueo_id uuid,
    descanso_id uuid,
    creado_en timestamptz not null default now(),
    check ((tipo = 'descanso') = (dia is not null)),
    check (tipo = 'descanso' or (fecha_desde is not null and fecha_hasta >= fecha_desde)),
    check ((hora_desde is null) = (hora_hasta is null) and (hora_desde is null or hora_hasta > hora_desde)),
    check (tipo <> 'descanso' or hora_desde is not null)
);
create index if not exists solicitudes_disponibilidad_idx on barberia.solicitudes_disponibilidad (estado, creado_en desc);

-- Citas activas que quedarían dentro de lo solicitado (no se cancelan: se gestionan a mano)
create or replace function barberia_private._citas_afectadas(s barberia.solicitudes_disponibilidad) returns int
language sql stable security definer set search_path = barberia, pg_temp as $$
    select count(*)::int from citas c
     where c.barbero_id::text = s.barbero_id and c.estado <> 'cancelada' and c.completada_en is null and c.fecha >= _ahora_local()::date
       and (case when s.tipo = 'descanso' then extract(dow from c.fecha)::int = s.dia
                 else c.fecha between s.fecha_desde and s.fecha_hasta end)
       and (s.hora_desde is null
            or (c.hora < s.hora_hasta and c.hora + make_interval(mins => coalesce(c.duracion_reservada, 30)) > s.hora_desde))
$$;

create or replace function barberia.panel_disponibilidad_mia() returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := barbero_actual();
begin
    if v_rol <> 'barbero' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'horario', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'abre', to_char(j.abre, 'HH24:MI'), 'cierra', to_char(j.cierra, 'HH24:MI')) order by d)
            from generate_series(0, 6) d, lateral barberia_private._jornada_base(v_barbero, (date '2026-01-04' + d)) j), '[]'::jsonb),
        'descansos', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'desde', to_char(desde, 'HH24:MI'), 'hasta', to_char(hasta, 'HH24:MI'),
                'general', barbero_id is null) order by dia, desde) from descansos where barbero_id is null or barbero_id = v_barbero), '[]'::jsonb),
        'bloqueos', coalesce((select jsonb_agg(jsonb_build_object('fecha_desde', fecha_desde, 'fecha_hasta', fecha_hasta, 'hora_desde', to_char(hora_desde, 'HH24:MI'),
                'hora_hasta', to_char(hora_hasta, 'HH24:MI'), 'tipo', tipo, 'general', barbero_id is null) order by fecha_desde)
            from bloqueos where activo and fecha_hasta >= _ahora_local()::date and (barbero_id is null or barbero_id = v_barbero)), '[]'::jsonb),
        'solicitudes', coalesce((select jsonb_agg(barberia_private._solicitud_disp_json(s) order by s.creado_en desc)
            from (select * from solicitudes_disponibilidad where barbero_id = v_barbero order by creado_en desc limit 50) s), '[]'::jsonb));
end;
$$;

create or replace function barberia_private._solicitud_disp_json(s barberia.solicitudes_disponibilidad) returns jsonb
language sql stable security definer set search_path = barberia, pg_temp as $$
    select jsonb_build_object('id', s.id, 'barbero_id', s.barbero_id, 'barbero', (select nombre from barberos where id::text = s.barbero_id),
        'tipo', s.tipo, 'fecha_desde', s.fecha_desde, 'fecha_hasta', s.fecha_hasta, 'hora_desde', to_char(s.hora_desde, 'HH24:MI'),
        'hora_hasta', to_char(s.hora_hasta, 'HH24:MI'), 'dia', s.dia, 'motivo', s.motivo, 'estado', s.estado, 'respuesta', s.respuesta,
        'creado_en', s.creado_en, 'resuelta_en', s.resuelta_en,
        'citas_afectadas', case when s.estado = 'pendiente' then barberia_private._citas_afectadas(s) end)
$$;

-- p_datos: { clave?, tipo, fecha_desde, fecha_hasta, hora_desde?, hora_hasta?, dia?, motivo }
create or replace function barberia.panel_disponibilidad_solicitar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := barbero_actual();
    v solicitudes_disponibilidad;
begin
    if v_rol <> 'barbero' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if (select count(*) from solicitudes_disponibilidad where barbero_id = v_barbero and estado = 'pendiente') >= 10 then
        raise exception 'demasiadas_solicitudes';
    end if;
    begin
        insert into solicitudes_disponibilidad (barbero_id, solicitado_por, tipo, fecha_desde, fecha_hasta, hora_desde, hora_hasta, dia, motivo)
        values (v_barbero, auth.uid(), p_datos ->> 'tipo', nullif(p_datos ->> 'fecha_desde', '')::date,
                coalesce(nullif(p_datos ->> 'fecha_hasta', ''), nullif(p_datos ->> 'fecha_desde', ''))::date,
                nullif(p_datos ->> 'hora_desde', '')::time, nullif(p_datos ->> 'hora_hasta', '')::time,
                nullif(p_datos ->> 'dia', '')::smallint, nullif(left(trim(p_datos ->> 'motivo'), 300), ''))
        returning * into v;
    exception when check_violation or invalid_datetime_format or invalid_text_representation then
        raise exception 'datos_invalidos';
    end;
    if v.tipo <> 'descanso' and v.fecha_desde < _ahora_local()::date then
        raise exception 'fecha_invalida';
    end if;
    -- Duplicado exacto pendiente (doble envío)
    if exists (select 1 from solicitudes_disponibilidad x where x.id <> v.id and x.barbero_id = v.barbero_id and x.estado = 'pendiente'
                 and x.tipo = v.tipo and x.fecha_desde is not distinct from v.fecha_desde and x.fecha_hasta is not distinct from v.fecha_hasta
                 and x.hora_desde is not distinct from v.hora_desde and x.hora_hasta is not distinct from v.hora_hasta and x.dia is not distinct from v.dia) then
        raise exception 'solicitud_duplicada';
    end if;
    perform barberia_private._notificar(a.user_id, 'disponibilidad:' || v.id::text, 'disponibilidad', 'Solicitud de disponibilidad',
                               (select nombre from barberos where id::text = v_barbero) || ' pidió un cambio de disponibilidad.', null,
                               jsonb_build_object('seccion', 'solicitudes'))
       from admin_usuarios a;
    perform _auditar('disponibilidad_solicitada', 'barbero', v_barbero, jsonb_build_object('solicitud', v.id, 'tipo', v.tipo));
    return barberia_private._solicitud_disp_json(v);
end;
$$;

create or replace function barberia.panel_disponibilidad_cancelar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    update solicitudes_disponibilidad set estado = 'cancelada', resuelta_en = now()
     where id = p_id and estado = 'pendiente' and barbero_id = barbero_actual();
    if not found then
        raise exception 'transicion_invalida';
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function barberia.panel_disponibilidad_solicitudes(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel(true);
    return coalesce((select jsonb_agg(barberia_private._solicitud_disp_json(s) order by s.creado_en desc)
        from (select * from solicitudes_disponibilidad where nullif(p_estado, '') is null or estado = p_estado order by creado_en desc limit 100) s), '[]'::jsonb);
end;
$$;

-- Aprobar crea el bloqueo o descanso real. Las citas afectadas NO se cancelan: se informan.
create or replace function barberia.panel_disponibilidad_resolver(p_id uuid, p_aprobar boolean, p_respuesta text default null) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v solicitudes_disponibilidad;
    v_afectadas int;
    v_ref uuid;
begin
    perform _exigir_panel(true);
    select * into v from solicitudes_disponibilidad where id = p_id for update;
    if not found or v.estado <> 'pendiente' then
        raise exception 'transicion_invalida';
    end if;
    v_afectadas := barberia_private._citas_afectadas(v);
    if p_aprobar then
        if v.tipo = 'descanso' then
            insert into descansos (barbero_id, dia, desde, hasta) values (v.barbero_id, v.dia, v.hora_desde, v.hora_hasta) returning id into v_ref;
            update solicitudes_disponibilidad set descanso_id = v_ref where id = p_id;
        else
            insert into bloqueos (barbero_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, tipo, motivo, creado_por)
            values (v.barbero_id, v.fecha_desde, v.fecha_hasta, v.hora_desde, v.hora_hasta, v.tipo, coalesce(v.motivo, 'Solicitud del barbero'), auth.uid())
            returning id into v_ref;
            update solicitudes_disponibilidad set bloqueo_id = v_ref where id = p_id;
        end if;
    end if;
    update solicitudes_disponibilidad set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
           respuesta = nullif(left(trim(p_respuesta), 300), ''), resuelta_por = auth.uid(), resuelta_en = now()
     where id = p_id;
    perform barberia_private._notificar(bu.user_id, 'disponibilidad:' || p_id::text || ':' || case when p_aprobar then 'aprobada' else 'rechazada' end,
                               'disponibilidad', case when p_aprobar then 'Disponibilidad aprobada' else 'Disponibilidad rechazada' end,
                               coalesce(nullif(trim(p_respuesta), ''), 'Revisa «Mi disponibilidad».'), null, jsonb_build_object('seccion', 'disponibilidad'))
       from barbero_usuarios bu where bu.barbero_id = v.barbero_id;
    perform _auditar(case when p_aprobar then 'disponibilidad_aprobada' else 'disponibilidad_rechazada' end, 'barbero', v.barbero_id,
                     jsonb_build_object('solicitud', p_id, 'citas_afectadas', v_afectadas));
    return jsonb_build_object('ok', true, 'citas_afectadas', v_afectadas);
end;
$$;

-- ==========================================
-- MIS INGRESOS (solo lectura; datos de ventas existentes, sin inventar comisiones)
-- ==========================================
create or replace function barberia.panel_mis_ingresos(p_desde date, p_hasta date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    if v_barbero is null then
        raise exception 'barbero_requerido';
    end if;
    if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
        raise exception 'rango_invalido';
    end if;
    return (with lineas as (
        select vd.id, v.numero, v.creado_en, vd.descripcion, vd.total - vd.importe_devuelto as importe,
               (v.pagado - v.reembolsado) >= (v.total - v.devuelto) as cobrada
          from venta_detalles vd join ventas v on v.id = vd.venta_id
         where vd.tipo = 'servicio' and vd.barbero_id = v_barbero and v.estado = 'confirmada'
           and (v.creado_en at time zone _zona())::date between p_desde and p_hasta)
    select jsonb_build_object(
        'realizados', (select jsonb_build_object('servicios', count(*), 'importe_reservado', coalesce(sum(precio_final), 0))
                         from citas where barbero_id::text = v_barbero and completada_en is not null and fecha between p_desde and p_hasta),
        'cobrados', (select jsonb_build_object('servicios', count(*), 'importe', coalesce(sum(importe), 0)) from lineas where cobrada),
        'pendientes_cobro', (select jsonb_build_object('servicios', count(*), 'importe', coalesce(sum(importe), 0)) from lineas where not cobrada),
        'comision', jsonb_build_object('disponible', false, 'motivo', 'El sistema no tiene reglas de comisión configuradas: no se calcula comisión generada, pendiente ni pagada.'),
        'propinas', jsonb_build_object('disponible', false, 'motivo', 'El sistema no registra propinas.'),
        'detalle', coalesce((select jsonb_agg(jsonb_build_object('numero', numero, 'fecha', creado_en, 'servicio', descripcion, 'importe', importe, 'cobrada', cobrada)
                               order by creado_en desc) from (select * from lineas order by creado_en desc limit 200) l), '[]'::jsonb)));
end;
$$;

-- ==========================================
-- NOTIFICACIONES INTERNAS
-- ==========================================
create table if not exists barberia.notificaciones (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    evento text not null,
    tipo text not null check (tipo in ('cita_nueva', 'cita_cancelada', 'cita_reprogramada', 'cita_asignada', 'cita_reasignada',
                                       'disponibilidad', 'solicitud_acceso', 'sistema')),
    titulo text not null,
    cuerpo text,
    cita_id text,
    datos jsonb not null default '{}'::jsonb,
    leida_en timestamptz,
    creado_en timestamptz not null default now(),
    unique (user_id, evento)
);
create index if not exists notificaciones_usuario_idx on barberia.notificaciones (user_id, id desc);
create index if not exists notificaciones_no_leidas_idx on barberia.notificaciones (user_id) where leida_en is null;

create table if not exists barberia.notificacion_preferencias (
    user_id uuid primary key,
    sonido boolean not null default true,
    volumen int not null default 70 check (volumen between 0 and 100),
    push boolean not null default false,
    actualizado_en timestamptz not null default now()
);

create table if not exists barberia.push_suscripciones (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
    p256dh text not null check (length(p256dh) <= 200),
    auth text not null check (length(auth) <= 100),
    dispositivo text check (length(dispositivo) <= 200),
    activa boolean not null default true,
    ultimo_error text,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists push_suscripciones_usuario_idx on barberia.push_suscripciones (user_id) where activa;

create table if not exists barberia.push_envios (
    id bigint generated always as identity primary key,
    notificacion_id bigint not null references barberia.notificaciones (id),
    suscripcion_id uuid not null references barberia.push_suscripciones (id),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'vencido', 'omitido')),
    intentos int not null default 0,
    ultimo_error text,
    programado_para timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    unique (notificacion_id, suscripcion_id)
);
create index if not exists push_envios_pendientes_idx on barberia.push_envios (programado_para) where estado = 'pendiente';

-- Crea la notificación (una sola vez por evento y destinatario) y encola el push si el usuario lo activó
create or replace function barberia_private._notificar(p_user uuid, p_evento text, p_tipo text, p_titulo text, p_cuerpo text, p_cita text, p_datos jsonb)
returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_id bigint;
begin
    if p_user is null then
        return;
    end if;
    insert into notificaciones (user_id, evento, tipo, titulo, cuerpo, cita_id, datos)
    values (p_user, p_evento, p_tipo, left(p_titulo, 120), left(p_cuerpo, 500), p_cita, coalesce(p_datos, '{}'::jsonb))
    on conflict (user_id, evento) do nothing
    returning id into v_id;
    if v_id is not null and coalesce((select push from notificacion_preferencias where user_id = p_user), false) then
        insert into push_envios (notificacion_id, suscripcion_id)
        select v_id, s.id from push_suscripciones s where s.user_id = p_user and s.activa
        on conflict do nothing;
    end if;
end;
$$;

-- Destinatarios de una cita: las cuentas del barbero activo; si no tiene cuenta (o no hay barbero), administración
create or replace function barberia_private._destinatarios_cita(p_barbero text) returns setof uuid
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    return query select bu.user_id from barbero_usuarios bu join barberos b on b.id::text = bu.barbero_id
                  where bu.barbero_id = p_barbero and b.activo is not false;
    if not found then
        return query select user_id from admin_usuarios;
    end if;
end;
$$;

create or replace function barberia_private.tg_citas_notificar() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_servicio text;
    v_detalle text;
    v_datos jsonb;
    v_user uuid;
begin
    begin
        select nombre into v_servicio from servicios where id = new.servicio_id;
        v_detalle := new.nombre_cliente || ' · ' || coalesce(v_servicio, 'Servicio') || ' · ' || to_char(new.fecha, 'DD/MM/YYYY') || ' ' || to_char(new.hora, 'HH24:MI');
        v_datos := jsonb_build_object('seccion', 'agenda', 'fecha', new.fecha, 'hora', to_char(new.hora, 'HH24:MI'));
        if tg_op = 'INSERT' then
            if new.estado <> 'cancelada' then
                for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                    perform barberia_private._notificar(v_user, 'cita:' || new.id || ':nueva', 'cita_nueva', 'Nueva cita', v_detalle, new.id::text, v_datos);
                end loop;
            end if;
        elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':cancelada:' || coalesce(new.cancelada_en, now())::text, 'cita_cancelada',
                                           'Cita cancelada', v_detalle, new.id::text, v_datos);
            end loop;
        elsif new.estado <> 'cancelada' and new.barbero_id is distinct from old.barbero_id then
            -- Reasignación: el nuevo profesional recibe el detalle; el anterior solo un aviso sin datos del cliente
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':asignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_asignada',
                                           'Cita asignada a ti', v_detalle, new.id::text, v_datos);
            end loop;
            update notificaciones set cuerpo = 'Esta cita se asignó a otro profesional.', datos = '{}'::jsonb
             where cita_id = new.id::text and user_id in (select user_id from barbero_usuarios where barbero_id = old.barbero_id::text);
            for v_user in select user_id from barbero_usuarios where barbero_id = old.barbero_id::text loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':reasignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_reasignada',
                                           'Una cita tuya se reasignó', 'La cita del ' || to_char(old.fecha, 'DD/MM/YYYY') || ' ' || to_char(old.hora, 'HH24:MI')
                                           || ' ya no está en tu agenda.', null, jsonb_build_object('seccion', 'agenda', 'fecha', old.fecha));
            end loop;
        elsif new.estado <> 'cancelada' and (new.fecha, new.hora) is distinct from (old.fecha, old.hora) then
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':reprogramada:' || new.fecha || new.hora, 'cita_reprogramada',
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
drop trigger if exists citas_notificar on barberia.citas;
create trigger citas_notificar after insert or update of estado, fecha, hora, barbero_id on barberia.citas
    for each row execute function barberia_private.tg_citas_notificar();

-- Centro de notificaciones (solo las propias)
create or replace function barberia.panel_notificaciones(p_limite int default 30, p_antes bigint default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    return jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'tipo', n.tipo, 'titulo', n.titulo, 'cuerpo', n.cuerpo, 'datos', n.datos,
                'leida', n.leida_en is not null, 'creado_en', n.creado_en) order by n.id desc)
            from (select * from notificaciones where user_id = auth.uid() and (p_antes is null or id < p_antes)
                   order by id desc limit least(greatest(coalesce(p_limite, 30), 1), 100)) n), '[]'::jsonb),
        'no_leidas', (select count(*) from notificaciones where user_id = auth.uid() and leida_en is null),
        'ultimo_id', (select max(id) from notificaciones where user_id = auth.uid()),
        'preferencias', (select to_jsonb(p) - 'user_id' from notificacion_preferencias p where p.user_id = auth.uid()));
end;
$$;

-- Consulta ligera para el aviso (cada pocos segundos con la app abierta)
create or replace function barberia.panel_notificaciones_estado(p_desde bigint default null) returns jsonb
language plpgsql stable security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    return jsonb_build_object(
        'no_leidas', (select count(*) from notificaciones where user_id = auth.uid() and leida_en is null),
        'ultimo_id', (select max(id) from notificaciones where user_id = auth.uid()),
        'nuevas', case when p_desde is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'titulo', titulo,
                'cuerpo', cuerpo, 'datos', datos) order by id)
            from (select * from notificaciones where user_id = auth.uid() and id > p_desde and leida_en is null order by id limit 10) n), '[]'::jsonb) end);
end;
$$;

create or replace function barberia.panel_notificaciones_leer(p_ids bigint[] default null) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    update notificaciones set leida_en = now()
     where user_id = auth.uid() and leida_en is null and (p_ids is null or id = any (p_ids));
    update push_envios set estado = 'omitido', actualizado_en = now()
     where estado = 'pendiente' and notificacion_id in (select id from notificaciones where user_id = auth.uid() and leida_en is not null);
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function barberia.panel_notif_preferencias_guardar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    insert into notificacion_preferencias (user_id, sonido, volumen, push)
    values (auth.uid(), coalesce((p_datos ->> 'sonido')::boolean, true), least(greatest(coalesce((p_datos ->> 'volumen')::int, 70), 0), 100),
            coalesce((p_datos ->> 'push')::boolean, false))
    on conflict (user_id) do update set
        sonido = coalesce((p_datos ->> 'sonido')::boolean, notificacion_preferencias.sonido),
        volumen = least(greatest(coalesce((p_datos ->> 'volumen')::int, notificacion_preferencias.volumen), 0), 100),
        push = coalesce((p_datos ->> 'push')::boolean, notificacion_preferencias.push),
        actualizado_en = now();
    return (select to_jsonb(p) - 'user_id' from notificacion_preferencias p where p.user_id = auth.uid());
end;
$$;

-- ==========================================
-- WEB PUSH (suscripciones por cuenta y dispositivo; envío desde la Edge Function push-enviar)
-- ==========================================
-- El mismo dispositivo (endpoint) pasa a la cuenta que se suscribe: un teléfono compartido no
-- sigue recibiendo avisos de la cuenta anterior.
create or replace function barberia.push_suscribir(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    perform _exigir_panel();
    if coalesce(p_datos ->> 'endpoint', '') !~ '^https://' or length(p_datos ->> 'endpoint') > 1000
       or coalesce(length(p_datos ->> 'p256dh'), 0) not between 10 and 200 or coalesce(length(p_datos ->> 'auth'), 0) not between 8 and 100 then
        raise exception 'datos_invalidos';
    end if;
    insert into push_suscripciones (user_id, endpoint, p256dh, auth, dispositivo)
    values (auth.uid(), p_datos ->> 'endpoint', p_datos ->> 'p256dh', p_datos ->> 'auth', left(p_datos ->> 'dispositivo', 200))
    on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        dispositivo = excluded.dispositivo, activa = true, ultimo_error = null, actualizado_en = now();
    perform panel_notif_preferencias_guardar(jsonb_build_object('push', true));
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function barberia.push_desuscribir(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    update push_suscripciones set activa = false, actualizado_en = now() where endpoint = p_endpoint and user_id = auth.uid();
    update push_envios set estado = 'omitido', actualizado_en = now()
     where estado = 'pendiente' and suscripcion_id in (select id from push_suscripciones where endpoint = p_endpoint);
    return jsonb_build_object('ok', true);
end;
$$;

-- Solo service_role (Edge Function). Mensaje discreto: sin datos del cliente en la pantalla bloqueada.
create or replace function barberia.push_reclamar(p_limite int default 50) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
            'titulo', case n.tipo when 'cita_nueva' then 'Nueva cita' when 'cita_cancelada' then 'Cita cancelada'
                                  when 'cita_reprogramada' then 'Cita reprogramada' when 'cita_asignada' then 'Cita asignada' else 'Barbería' end,
            'cuerpo', 'Abre la app para ver el detalle.', 'etiqueta', 'notificacion-' || n.id,
            'url', '?panel=' || coalesce(n.datos ->> 'seccion', 'notificaciones') || coalesce('&fecha=' || (n.datos ->> 'fecha'), ''))), '[]'::jsonb)
      into v_res
      from e join notificaciones n on n.id = e.notificacion_id join push_suscripciones s on s.id = e.suscripcion_id;
    return v_res;
end;
$$;

-- p_resultado: 'ok' | 'vencida' (404/410: se desactiva la suscripción) | 'reintentar' | 'fallido'
create or replace function barberia.push_resultado(p_id bigint, p_resultado text, p_error text default null) returns void
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v push_envios;
begin
    select * into v from push_envios where id = p_id for update;
    if not found then
        return;
    end if;
    if p_resultado = 'ok' then
        update push_envios set estado = 'enviado', ultimo_error = null, actualizado_en = now() where id = p_id;
    elsif p_resultado = 'vencida' then
        update push_envios set estado = 'vencido', ultimo_error = left(p_error, 300), actualizado_en = now() where id = p_id;
        update push_suscripciones set activa = false, ultimo_error = left(p_error, 300), actualizado_en = now() where id = v.suscripcion_id;
    elsif p_resultado = 'reintentar' and v.intentos < 3 then
        update push_envios set estado = 'pendiente', ultimo_error = left(p_error, 300), programado_para = now() + make_interval(mins => 2 * v.intentos),
               actualizado_en = now() where id = p_id;
    else
        update push_envios set estado = 'fallido', ultimo_error = left(p_error, 300), actualizado_en = now() where id = p_id;
    end if;
end;
$$;

-- ==========================================
-- CAJERO Y OCUPACIÓN PROPIA: se ajusta solo la comprobación de permisos de funciones existentes
-- ==========================================
do $$
declare
    v_fn regprocedure;
    v_def text;
begin
    -- Cobrar y caja del día con el permiso «cajero» (anular, reembolsar, movimientos, gastos e inventario siguen siendo del administrador)
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname in ('panel_venta_cobrar', 'panel_venta', 'panel_venta_de_cita', 'panel_ventas',
                                                              'panel_venta_catalogo', 'panel_caja_abrir', 'panel_caja_cerrar', 'panel_caja_estado') loop
        v_def := pg_get_functiondef(v_fn);
        if position('perform _exigir_panel(true);' in v_def) > 0 then
            execute replace(v_def, 'perform _exigir_panel(true);', 'perform _exigir_caja();');
        end if;
    end loop;
    -- Ocupación: el barbero ve solo la suya
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = 'panel_ocupacion' loop
        v_def := pg_get_functiondef(v_fn);
        if position('perform _exigir_panel(true);' in v_def) > 0 then
            execute replace(v_def, 'perform _exigir_panel(true);',
                            'if _exigir_panel() = ''barbero'' then v_barbero := barbero_actual(); end if;');
        end if;
    end loop;
end $$;

-- ==========================================
-- SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['barbero_permisos', 'solicitudes_profesionales', 'solicitudes_disponibilidad', 'notificaciones',
                                   'notificacion_preferencias', 'push_suscripciones', 'push_envios'] loop
        execute format('alter table barberia.%I enable row level security', v_tabla);
        execute format('revoke all on barberia.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname in ('panel_confirmar_cambio_clave', 'panel_cuenta_consultar', 'panel_cuenta_vincular',
                       'panel_cuenta_permisos', 'panel_cuenta_desvincular', 'panel_cuentas_barberos', 'solicitud_profesional_estado',
                       'solicitud_profesional_crear', 'panel_solicitudes_profesionales', 'panel_solicitud_resolver', 'panel_cita_iniciar',
                       'panel_atencion', 'panel_tiempo_real', 'panel_disponibilidad_mia', 'panel_disponibilidad_solicitar',
                       'panel_disponibilidad_cancelar', 'panel_disponibilidad_solicitudes', 'panel_disponibilidad_resolver', 'panel_mis_ingresos',
                       'panel_notificaciones', 'panel_notificaciones_estado', 'panel_notificaciones_leer', 'panel_notif_preferencias_guardar',
                       'push_suscribir', 'push_desuscribir') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname in ('push_reclamar', 'push_resultado', '_exigir_caja') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function barberia_private._huella_clave(uuid) from public, anon, authenticated;
revoke all on function barberia_private._permisos_guardar(uuid, jsonb) from public, anon, authenticated;
revoke all on function barberia_private._citas_afectadas(barberia.solicitudes_disponibilidad) from public, anon, authenticated;
revoke all on function barberia_private._solicitud_disp_json(barberia.solicitudes_disponibilidad) from public, anon, authenticated;
revoke all on function barberia_private._notificar(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function barberia_private._destinatarios_cita(text) from public, anon, authenticated;
revoke all on function barberia_private.tg_citas_notificar() from public, anon, authenticated;

notify pgrst, 'reload schema';

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
-- MIGRACIÓN (trasladada a barberia): 20261031000000_reserva_app_whatsapp.sql
-- #####################################################################
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

alter table barberia.clientes_contacto
    add column if not exists avisos_whatsapp boolean,
    add column if not exists avisos_whatsapp_en timestamptz;

-- Tipo nuevo de mensaje y de plantilla: 'solicitud'
do $$
declare
    v_nombre text;
begin
    for v_nombre in select conname from pg_constraint
                     where conrelid = 'barberia.mensajes_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%' loop
        execute format('alter table barberia.mensajes_whatsapp drop constraint %I', v_nombre);
    end loop;
    alter table barberia.mensajes_whatsapp add constraint mensajes_whatsapp_tipo_check
        check (tipo in ('recordatorio', 'oferta_espera', 'recuperacion', 'confirmacion', 'cancelacion', 'reprogramacion', 'solicitud'));
    for v_nombre in select conname from pg_constraint
                     where conrelid = 'barberia.plantillas_whatsapp'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recordatorio%' loop
        execute format('alter table barberia.plantillas_whatsapp drop constraint %I', v_nombre);
    end loop;
    alter table barberia.plantillas_whatsapp add constraint plantillas_whatsapp_tipo_check
        check (tipo in ('confirmacion', 'recordatorio', 'cancelacion', 'reprogramacion', 'solicitud'));
end $$;

-- Texto de referencia (el envío automático usa la plantilla aprobada en Meta: meta_plantilla)
insert into barberia.plantillas_whatsapp (tipo, texto, meta_plantilla) values
    ('solicitud', E'Hola {cliente}, recibimos tu solicitud de cita en {ubicacion}.\n{servicio} con {barbero}\n{fecha} a las {hora}\nEstá pendiente de confirmación: te avisaremos cuando la barbería la confirme.\n{mapa}', '')
on conflict (tipo) do nothing;

-- «Solicitud recibida» al crearse una cita pendiente (la confirmada ya encola su confirmación)
create or replace function barberia_private.tg_citas_solicitud() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
drop trigger if exists citas_solicitud on barberia.citas;
create trigger citas_solicitud after insert on barberia.citas
    for each row execute function barberia_private.tg_citas_solicitud();

-- El cliente acepta o rechaza los avisos de su cita (con el token secreto de la cita).
-- Se guarda por teléfono para sus próximas citas; no toca el consentimiento de marketing.
create or replace function barberia.cita_avisos_whatsapp(p_token uuid, p_acepta boolean) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.cita_notas_cliente(p_token uuid, p_notas text) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia._cita_cliente_json(p_cita_id text) returns jsonb
language sql stable set search_path = barberia, pg_temp as $$
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
create or replace function barberia.whatsapp_reclamar(p_limite int default 20) returns setof barberia.mensajes_whatsapp
language plpgsql security definer set search_path = barberia, pg_temp as $$
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

revoke all on function barberia_private.tg_citas_solicitud() from public, anon, authenticated;
revoke all on function barberia.cita_avisos_whatsapp(uuid, boolean) from public;
grant execute on function barberia.cita_avisos_whatsapp(uuid, boolean) to anon, authenticated;
revoke all on function barberia.cita_notas_cliente(uuid, text) from public;
grant execute on function barberia.cita_notas_cliente(uuid, text) to anon, authenticated;
revoke all on function barberia.whatsapp_reclamar(int) from public, anon, authenticated;
revoke all on function barberia._cita_cliente_json(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- #####################################################################
-- MIGRACIÓN (trasladada a barberia): 20261101000000_avisos_reservas.sql
-- #####################################################################
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

create schema if not exists barberia_private;
revoke all on schema barberia_private from public;

create or replace function barberia_private.tg_citas_notificar() returns trigger
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
                for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                    perform barberia_private._notificar(v_user, 'cita:' || new.id || ':nueva', 'cita_nueva', 'Nueva reserva',
                                               v_detalle || ' · ' || case new.estado when 'confirmada' then 'Confirmada' else 'Pendiente de confirmar' end, new.id::text, v_datos);
                end loop;
            end if;
        elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':cancelada:' || coalesce(new.cancelada_en, now())::text, 'cita_cancelada',
                                           'Cita cancelada', v_detalle, new.id::text, v_datos);
            end loop;
        elsif new.estado <> 'cancelada' and new.barbero_id is distinct from old.barbero_id then
            -- Reasignación: el nuevo profesional recibe el detalle; el anterior solo un aviso sin datos del cliente
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':asignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_asignada',
                                           'Cita asignada a ti', v_detalle, new.id::text, v_datos);
            end loop;
            update notificaciones set cuerpo = 'Esta cita se asignó a otro profesional.', datos = '{}'::jsonb
             where cita_id = new.id::text and user_id in (select user_id from barbero_usuarios where barbero_id = old.barbero_id::text);
            for v_user in select user_id from barbero_usuarios where barbero_id = old.barbero_id::text loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':reasignada:' || new.barbero_id || ':' || new.fecha || new.hora, 'cita_reasignada',
                                           'Una cita tuya se reasignó', 'La cita del ' || to_char(old.fecha, 'DD/MM/YYYY') || ' ' || to_char(old.hora, 'HH24:MI')
                                           || ' ya no está en tu agenda.', null, jsonb_build_object('seccion', 'agenda', 'fecha', old.fecha));
            end loop;
        elsif new.estado <> 'cancelada' and (new.fecha, new.hora) is distinct from (old.fecha, old.hora) then
            for v_user in select * from barberia_private._destinatarios_cita(new.barbero_id::text) loop
                perform barberia_private._notificar(v_user, 'cita:' || new.id || ':reprogramada:' || new.fecha || new.hora, 'cita_reprogramada',
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

create or replace function barberia.push_reclamar(p_limite int default 50) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_push_estado(p_endpoint text default null) returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
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
create or replace function barberia.panel_notificacion_prueba() returns jsonb
language plpgsql security definer set search_path = barberia, pg_temp as $$
declare
    v_encolados int;
begin
    perform _exigir_panel();
    if exists (select 1 from notificaciones where user_id = auth.uid() and evento like 'prueba:%' and creado_en > now() - interval '15 seconds') then
        raise exception 'espera_prueba';
    end if;
    perform barberia_private._notificar(auth.uid(), 'prueba:' || extract(epoch from clock_timestamp())::text, 'sistema', 'Prueba de avisos',
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
                 where n.nspname = 'barberia' and p.proname in ('panel_push_estado', 'panel_notificacion_prueba') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'barberia' and p.proname = 'push_reclamar' loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
end $$;
revoke all on function barberia_private.tg_citas_notificar() from public, anon, authenticated;

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

select case when exists (select 1 from barberia.admin_usuarios a join auth.users u on u.id = a.user_id
                          where lower(u.email) = lower('yafre2310@gmail.com'))
            then 'Instalado en barberia. Listo: yafre2310@gmail.com es administrador de barbería.'
            else 'Instalado en barberia. Falta: crea yafre2310@gmail.com en Authentication > Users y vuelve a ejecutar el bloque ADMINISTRADOR.'
       end as estado_instalacion;
