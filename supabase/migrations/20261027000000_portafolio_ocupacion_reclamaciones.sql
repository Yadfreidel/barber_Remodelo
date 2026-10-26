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

create schema if not exists private;
revoke all on schema private from public;

-- ==========================================
-- PERFIL PÚBLICO DEL BARBERO
-- ==========================================
alter table public.barberos
    add column if not exists presentacion text,
    add column if not exists especialidades text[] not null default '{}',
    add column if not exists portafolio_propio boolean not null default true;

-- ==========================================
-- AUTORIZACIONES DE IMAGEN
-- ==========================================
create table if not exists public.autorizaciones_imagen (
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
create table if not exists public.portafolio_trabajos (
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
    autorizacion_id uuid references public.autorizaciones_imagen (id),
    motivo_estado text,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    publicado_en timestamptz,
    publicado_por uuid
);
create index if not exists portafolio_publicados_idx on public.portafolio_trabajos (barbero_id, destacado desc, orden, publicado_en desc) where estado = 'publicado';
create index if not exists portafolio_barbero_idx on public.portafolio_trabajos (barbero_id, estado);
create index if not exists portafolio_autorizacion_idx on public.portafolio_trabajos (autorizacion_id) where autorizacion_id is not null;

-- Regla de datos (además de los permisos): un trabajo con persona identificable solo
-- queda publicado con una autorización vigente para el portafolio.
create or replace function private.tg_portafolio_publicacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if new.estado = 'publicado' and new.muestra_persona
       and not exists (select 1 from autorizaciones_imagen a where a.id = new.autorizacion_id and a.estado = 'vigente') then
        raise exception 'autorizacion_requerida';
    end if;
    new.actualizado_en := now();
    return new;
end;
$$;
drop trigger if exists portafolio_publicacion on public.portafolio_trabajos;
create trigger portafolio_publicacion before insert or update on public.portafolio_trabajos
    for each row execute function private.tg_portafolio_publicacion();

-- ==========================================
-- RECLAMACIONES
-- ==========================================
create table if not exists public.reclamacion_categorias (
    id bigint generated always as identity primary key,
    nombre text not null check (length(trim(nombre)) between 1 and 60),
    activa boolean not null default true,
    orden int not null default 0
);
create unique index if not exists reclamacion_categorias_nombre_key on public.reclamacion_categorias (lower(nombre));
insert into public.reclamacion_categorias (nombre, orden)
select v.nombre, v.orden from (values ('Resultado del servicio', 1), ('Tiempo de espera', 2), ('Atención recibida', 3), ('Cobro', 4),
                                      ('Reserva', 5), ('Producto', 6), ('Otro', 7)) v (nombre, orden)
 where not exists (select 1 from public.reclamacion_categorias c where lower(c.nombre) = lower(v.nombre));

create table if not exists public.reclamaciones_config (
    id boolean primary key default true check (id),
    horas_objetivo_respuesta int not null default 48 check (horas_objetivo_respuesta between 1 and 720),
    actualizado_en timestamptz not null default now()
);
insert into public.reclamaciones_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.reclamaciones (
    id uuid primary key default gen_random_uuid(),
    numero bigint generated always as identity unique,
    token uuid not null unique default gen_random_uuid(),
    clave uuid not null unique,
    cita_id text,
    venta_id uuid references public.ventas (id),
    barbero_id text,
    cliente_nombre text not null check (length(trim(cliente_nombre)) between 1 and 120),
    cliente_telefono text,
    cliente_user_id uuid,
    categoria_id bigint not null references public.reclamacion_categorias (id),
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
    reembolso_venta_id uuid references public.ventas (id),
    creado_en timestamptz not null default now()
);
create index if not exists reclamaciones_estado_idx on public.reclamaciones (estado, ultima_actividad_en desc);
create index if not exists reclamaciones_responsable_idx on public.reclamaciones (responsable_user_id) where responsable_user_id is not null;
create index if not exists reclamaciones_cliente_idx on public.reclamaciones (cliente_user_id) where cliente_user_id is not null;
create index if not exists reclamaciones_cita_idx on public.reclamaciones (cita_id) where cita_id is not null;

create table if not exists public.reclamacion_mensajes (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references public.reclamaciones (id),
    clave uuid not null unique,
    autor text not null check (autor in ('cliente', 'equipo')),
    autor_user_id uuid,
    interno boolean not null default false,
    cuerpo text not null check (length(trim(cuerpo)) between 1 and 2000),
    creado_en timestamptz not null default now(),
    check (autor = 'equipo' or not interno)
);
create index if not exists reclamacion_mensajes_idx on public.reclamacion_mensajes (reclamacion_id, id);

create table if not exists public.reclamacion_adjuntos (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references public.reclamaciones (id),
    mensaje_id bigint references public.reclamacion_mensajes (id),
    subido_por text not null check (subido_por in ('cliente', 'equipo')),
    interno boolean not null default false,
    imagen text not null,
    creado_por uuid,
    creado_en timestamptz not null default now()
);
create index if not exists reclamacion_adjuntos_idx on public.reclamacion_adjuntos (reclamacion_id);

create table if not exists public.reclamacion_eventos (
    id bigint generated always as identity primary key,
    reclamacion_id uuid not null references public.reclamaciones (id),
    tipo text not null check (tipo in ('creada', 'estado', 'asignacion', 'prioridad', 'mensaje', 'nota', 'solucion', 'reapertura',
                                       'reembolso', 'fecha_objetivo', 'respuesta_cliente')),
    de text,
    a text,
    motivo text,
    usuario_id uuid,
    actor text not null default 'equipo' check (actor in ('cliente', 'equipo', 'sistema')),
    creado_en timestamptz not null default now()
);
create index if not exists reclamacion_eventos_idx on public.reclamacion_eventos (reclamacion_id, id);

-- Historial y mensajes nunca cambian; casos, trabajos y autorizaciones no se borran
do $$
declare
    v_tabla text;
begin
    foreach v_tabla in array array['reclamacion_mensajes', 'reclamacion_adjuntos', 'reclamacion_eventos'] loop
        execute format('drop trigger if exists %I on public.%I', v_tabla || '_inmutable', v_tabla);
        execute format('create trigger %I before update or delete on public.%I for each row execute function private.tg_inmutable()',
                       v_tabla || '_inmutable', v_tabla);
    end loop;
    foreach v_tabla in array array['reclamaciones', 'portafolio_trabajos', 'autorizaciones_imagen', 'reclamacion_categorias'] loop
        execute format('drop trigger if exists %I on public.%I', v_tabla || '_sin_borrado', v_tabla);
        execute format('create trigger %I before delete on public.%I for each row execute function private.tg_inmutable()',
                       v_tabla || '_sin_borrado', v_tabla);
    end loop;
end $$;

-- ==========================================
-- AUXILIARES
-- ==========================================
-- Imagen comprimida y de tamaño acotado (jpeg, png o webp)
create or replace function private._imagen_ok(p text, p_max int) returns boolean
language sql immutable set search_path = public, pg_temp as $$
    select p is not null and length(p) <= p_max and p ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
$$;

-- Administrador, o el propio barbero si puede gestionar su portafolio
create or replace function private._exigir_portafolio(p_barbero text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
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

create or replace function private._trabajo_json(t public.portafolio_trabajos, p_privado boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.barberos_publicos() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id::text, 'nombre', b.nombre, 'especialidad', b.especialidad, 'foto_url', b.foto_url,
        'presentacion', b.presentacion, 'especialidades', to_jsonb(b.especialidades),
        'trabajos', (select count(*) from portafolio_trabajos t where t.barbero_id = b.id::text and t.estado = 'publicado'))
        order by b.orden nulls last, b.nombre), '[]'::jsonb)
      from barberos b where b.activo is not false
$$;

-- Galería paginada: solo trabajos publicados de barberos activos, en miniatura
create or replace function public.portafolio_publico(p_barbero text, p_limite int default 24, p_desde int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_limite int := least(greatest(coalesce(p_limite, 24), 1), 48);
begin
    if not exists (select 1 from barberos where id::text = p_barbero and activo is not false) then
        raise exception 'barbero_no_encontrado';
    end if;
    return jsonb_build_object(
        'total', (select count(*) from portafolio_trabajos where barbero_id::text = p_barbero and estado = 'publicado'),
        'trabajos', coalesce((select jsonb_agg(private._trabajo_json(t, false) order by t.destacado desc, t.orden nulls last, t.publicado_en desc, t.id)
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
create or replace function public.portafolio_imagen(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select t.imagen from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id
     where t.id = p_id and t.estado = 'publicado' and b.activo is not false
$$;

-- ==========================================
-- PORTAFOLIO: PANEL
-- ==========================================
create or replace function public.panel_portafolio(p_barbero text default null, p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return jsonb_build_object(
        'puede_gestionar', v_rol = 'admin' or coalesce((select portafolio_propio from barberos where id::text = v_barbero), false),
        'es_admin', v_rol = 'admin',
        'trabajos', coalesce((select jsonb_agg(private._trabajo_json(t, true) order by t.barbero_id, t.destacado desc, t.orden nulls last, t.creado_en desc)
            from portafolio_trabajos t
           where (v_barbero is null or t.barbero_id::text = v_barbero) and (nullif(p_estado, '') is null or t.estado = p_estado)), '[]'::jsonb));
end;
$$;

create or replace function public.panel_portafolio_imagen(p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.panel_portafolio_guardar(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual portafolio_trabajos;
    v_barbero text;
    v_rol text;
    v_servicio text;
    v_autorizacion uuid := private._uuid(p_datos ->> 'autorizacion_id');
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
    v_rol := private._exigir_portafolio(v_barbero);
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
    if (p_id is null or p_datos ? 'imagen') and (not private._imagen_ok(p_datos ->> 'imagen', 900000) or not private._imagen_ok(p_datos ->> 'miniatura', 200000)) then
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
    return private._trabajo_json((select t from portafolio_trabajos t where id = v_id), true);
end;
$$;

-- Flujo: enviar a revisión (barbero o admin) · devolver a borrador, publicar, archivar, destacar (admin) · retirar el propio (barbero)
create or replace function public.panel_portafolio_estado(p_id uuid, p_accion text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos;
    v_rol text;
begin
    select * into v from portafolio_trabajos where id = p_id for update;
    if not found then
        raise exception 'trabajo_no_encontrado';
    end if;
    v_rol := private._exigir_portafolio(v.barbero_id::text);
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
    return private._trabajo_json((select t from portafolio_trabajos t where id = p_id), true);
end;
$$;

create or replace function public.panel_portafolio_ordenar(p_barbero text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform private._exigir_portafolio(p_barbero);
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
create or replace function public.panel_barbero_perfil(p_barbero text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else p_barbero end;
begin
    return (select jsonb_build_object('id', id::text, 'nombre', nombre, 'presentacion', presentacion, 'especialidades', to_jsonb(especialidades),
                   'portafolio_propio', portafolio_propio, 'foto_url', foto_url) from barberos where id::text = v_barbero);
end;
$$;

create or replace function public.panel_barbero_perfil_guardar(p_barbero text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._exigir_portafolio(p_barbero);
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
create or replace function public.panel_autorizaciones() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.panel_autorizacion_registrar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
    if nullif(p_datos ->> 'evidencia', '') is not null and not private._imagen_ok(p_datos ->> 'evidencia', 900000) then
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
create or replace function public.panel_autorizacion_retirar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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

create or replace function public.panel_autorizacion_evidencia(p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function private._jornada_base(p_barbero text, p_fecha date, out abre time, out cierra time)
language plpgsql stable set search_path = public, pg_temp as $$
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

create or replace function private._minutos(p tsmultirange) returns numeric
language sql immutable set search_path = public, pg_temp as $$
    select coalesce(sum(extract(epoch from upper(r) - lower(r)) / 60), 0) from unnest(p) r
$$;

-- Estados incluidos como reservados: citas no canceladas (pendientes, confirmadas, completadas y ausencias:
-- todas ocuparon su horario). Las canceladas no cuentan. Las solapadas se cuentan una vez y se informan.
create or replace function public.panel_ocupacion(p_desde date, p_hasta date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
            select * into v_j from private._jornada_base(v_b.id, v_fecha);
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
                'programados', private._minutos(v_base), 'no_disponibles', private._minutos(v_nodisp), 'disponibles', private._minutos(v_disp),
                'reservados', private._minutos(v_res * v_disp), 'fuera_de_jornada', private._minutos(v_res - v_disp),
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
            if private._minutos(v_res - v_disp) > 0 then
                v_conflictos := v_conflictos || jsonb_build_object('tipo', 'fuera_de_jornada', 'barbero', v_b.nombre, 'barbero_id', v_b.id, 'fecha', v_fecha,
                    'minutos', private._minutos(v_res - v_disp));
            end if;

            -- Mapa de calor: minutos disponibles y reservados por día de la semana y hora
            for v_h in select generate_series(0, 23) loop
                v_franja := tsmultirange(tsrange(v_fecha + make_interval(hours => v_h), v_fecha + make_interval(hours => v_h + 1))) * v_disp;
                continue when private._minutos(v_franja) = 0;
                v_clave := extract(dow from v_fecha)::int || ':' || v_h;
                v_calor := jsonb_set(v_calor, array[v_clave], jsonb_build_object(
                    'dia', extract(dow from v_fecha)::int, 'hora', v_h,
                    'disponibles', coalesce((v_calor #>> array[v_clave, 'disponibles'])::numeric, 0) + private._minutos(v_franja),
                    'reservados', coalesce((v_calor #>> array[v_clave, 'reservados'])::numeric, 0) + private._minutos(v_res * v_franja)));
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
create or replace function private._reclamacion_evento(p_id uuid, p_tipo text, p_de text, p_a text, p_motivo text, p_actor text default 'equipo')
returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into reclamacion_eventos (reclamacion_id, tipo, de, a, motivo, usuario_id, actor)
    values (p_id, p_tipo, p_de, p_a, left(p_motivo, 500), case when p_actor = 'equipo' then auth.uid() end, p_actor);
    update reclamaciones set ultima_actividad_en = now() where id = p_id;
$$;

create or replace function private._reclamacion_adjuntar(p_id uuid, p_mensaje bigint, p_adjuntos jsonb, p_por text, p_interno boolean) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
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
        if not private._imagen_ok(v_img, 900000) then
            raise exception 'imagen_invalida';
        end if;
        insert into reclamacion_adjuntos (reclamacion_id, mensaje_id, subido_por, interno, imagen, creado_por)
        values (p_id, p_mensaje, p_por, p_interno, v_img, auth.uid());
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

create or replace function private._reclamacion_codigo(p_numero bigint) returns text
language sql immutable set search_path = public, pg_temp as $$
    select 'R-' || lpad(p_numero::text, 5, '0')
$$;

-- Vista del cliente: sin notas internas, sin adjuntos del equipo ni datos del responsable
create or replace function private._reclamacion_cliente_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('codigo', private._reclamacion_codigo(r.numero), 'token', r.token, 'estado', r.estado,
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

create or replace function private._reclamacion_resumen_json(r public.reclamaciones) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('codigo', private._reclamacion_codigo(r.numero), 'token', r.token, 'estado', r.estado,
        'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'creado_en', r.creado_en,
        'ultima_actividad_en', r.ultima_actividad_en, 'puede_responder', r.estado = 'esperando_cliente')
$$;

-- ==========================================
-- RECLAMACIONES: CLIENTE (token secreto de la cita o del caso; nunca por teléfono ni por número)
-- ==========================================
create or replace function public.reclamacion_categorias_publicas() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by orden, nombre), '[]'::jsonb)
      from reclamacion_categorias where activa
$$;

-- p_datos: { clave, token_cita, categoria_id, descripcion, adjuntos?: [data URL, ...] (máx. 3) }
create or replace function public.reclamacion_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_clave uuid := private._uuid(p_datos ->> 'clave');
    v_cita citas;
    v_id uuid;
    v_categoria bigint;
    v_descripcion text := trim(p_datos ->> 'descripcion');
begin
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    select * into v_cita from citas where id::text = _cita_por_token(private._uuid(p_datos ->> 'token_cita'));
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    -- Doble envío: devuelve el caso ya creado con esta clave para esta misma cita
    select id into v_id from reclamaciones where clave = v_clave;
    if v_id is not null then
        if (select cita_id from reclamaciones where id = v_id) is distinct from v_cita.id::text then
            raise exception 'clave_operacion_usada';
        end if;
        return private._reclamacion_cliente_json(v_id) || jsonb_build_object('repetida', true);
    end if;
    select id into v_categoria from reclamacion_categorias where id = private._num(p_datos, 'categoria_id')::bigint and activa;
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
    perform private._reclamacion_adjuntar(v_id, null, p_datos -> 'adjuntos', 'cliente', false);
    perform private._reclamacion_evento(v_id, 'creada', null, 'recibida', null, 'cliente');
    return private._reclamacion_cliente_json(v_id) || jsonb_build_object('repetida', false);
end;
$$;

create or replace function public.reclamacion_consultar(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    select id into v_id from reclamaciones where token = p_token;
    if v_id is null then
        raise exception 'reclamacion_no_encontrada';
    end if;
    return private._reclamacion_cliente_json(v_id);
end;
$$;

-- Imagen que el propio cliente adjuntó (las del equipo no se muestran al cliente)
create or replace function public.reclamacion_adjunto(p_token uuid, p_adjunto bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select a.imagen from reclamacion_adjuntos a join reclamaciones r on r.id = a.reclamacion_id
     where r.token = p_token and a.id = p_adjunto and a.subido_por = 'cliente'
$$;

-- p_datos: { clave, token, cuerpo, adjuntos? }  · solo cuando el equipo pidió información
create or replace function public.reclamacion_responder(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_clave uuid := private._uuid(p_datos ->> 'clave');
    v reclamaciones;
    v_mensaje bigint;
begin
    if v_clave is null then
        raise exception 'clave_operacion_requerida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reclamacion:' || v_clave::text, 0));
    select * into v from reclamaciones where token = private._uuid(p_datos ->> 'token') for update;
    if not found then
        raise exception 'reclamacion_no_encontrada';
    end if;
    if exists (select 1 from reclamacion_mensajes where clave = v_clave and reclamacion_id = v.id) then
        return private._reclamacion_cliente_json(v.id) || jsonb_build_object('repetida', true);
    end if;
    if v.estado <> 'esperando_cliente' then
        raise exception 'respuesta_no_solicitada';
    end if;
    if coalesce(length(trim(p_datos ->> 'cuerpo')), 0) not between 1 and 2000 then
        raise exception 'descripcion_invalida';
    end if;
    insert into reclamacion_mensajes (reclamacion_id, clave, autor, cuerpo) values (v.id, v_clave, 'cliente', trim(p_datos ->> 'cuerpo'))
    returning id into v_mensaje;
    perform private._reclamacion_adjuntar(v.id, v_mensaje, p_datos -> 'adjuntos', 'cliente', false);
    update reclamaciones set estado = 'en_revision' where id = v.id;
    perform private._reclamacion_evento(v.id, 'respuesta_cliente', 'esperando_cliente', 'en_revision', null, 'cliente');
    return private._reclamacion_cliente_json(v.id) || jsonb_build_object('repetida', false);
end;
$$;

create or replace function public.mis_reclamaciones_por_tokens(p_tokens uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if coalesce(cardinality(p_tokens), 0) > 100 then
        raise exception 'demasiadas_citas';
    end if;
    return coalesce((select jsonb_agg(private._reclamacion_resumen_json(r) order by r.creado_en desc)
                       from reclamaciones r where r.token = any (coalesce(p_tokens, '{}'))), '[]'::jsonb);
end;
$$;

create or replace function public.mis_reclamaciones() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return coalesce((select jsonb_agg(private._reclamacion_resumen_json(r) order by r.creado_en desc)
                       from reclamaciones r where r.id in (select id from reclamaciones where cliente_user_id = auth.uid() order by creado_en desc limit 100)), '[]'::jsonb);
end;
$$;

-- ==========================================
-- RECLAMACIONES: PANEL
-- Administrador: todos los casos. Barbero: solo los que tiene asignados.
-- ==========================================
create or replace function private._exigir_reclamacion(p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
begin
    if not exists (select 1 from reclamaciones where id = p_id and (v_rol = 'admin' or responsable_user_id = auth.uid())) then
        raise exception 'reclamacion_no_encontrada';
    end if;
    return v_rol;
end;
$$;

create or replace function private._responsables() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(x order by x ->> 'nombre'), '[]'::jsonb) from (
        select jsonb_build_object('user_id', u.id, 'nombre', u.email, 'rol', 'Administración') x
          from admin_usuarios a join auth.users u on u.id = a.user_id
        union all
        select jsonb_build_object('user_id', u.id, 'nombre', b.nombre || ' (' || u.email || ')', 'rol', 'Barbero')
          from barbero_usuarios bu join auth.users u on u.id = bu.user_id join barberos b on b.id::text = bu.barbero_id
         where b.activo is not false and not exists (select 1 from admin_usuarios a where a.user_id = bu.user_id)) t
$$;

create or replace function public.panel_reclamaciones(p_filtros jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_estado text := nullif(p_filtros ->> 'estado', '');
    v_texto text := nullif(trim(p_filtros ->> 'busqueda'), '');
    v_limite int := least(greatest(coalesce(private._num(p_filtros, 'limite')::int, 50), 1), 100);
    v_desde int := greatest(coalesce(private._num(p_filtros, 'desde')::int, 0), 0);
begin
    return (with base as (
        select r.* from reclamaciones r
         where (v_rol = 'admin' or r.responsable_user_id = auth.uid())
           and (v_estado is null or (v_estado = 'abiertas' and r.estado not in ('resuelta', 'cerrada')) or r.estado = v_estado)
           and (nullif(p_filtros ->> 'categoria_id', '') is null or r.categoria_id::text = p_filtros ->> 'categoria_id')
           and (nullif(p_filtros ->> 'responsable', '') is null
                or (p_filtros ->> 'responsable' = 'sin_asignar' and r.responsable_user_id is null)
                or r.responsable_user_id::text = p_filtros ->> 'responsable')
           and (v_texto is null or private._reclamacion_codigo(r.numero) ilike '%' || v_texto || '%' or r.numero::text = v_texto
                or r.cliente_nombre ilike '%' || v_texto || '%'))
    select jsonb_build_object('total', (select count(*) from base),
        'casos', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', private._reclamacion_codigo(r.numero), 'estado', r.estado,
                'prioridad', r.prioridad, 'categoria', (select nombre from reclamacion_categorias where id = r.categoria_id), 'cliente', r.cliente_nombre,
                'responsable', (select email from auth.users where id = r.responsable_user_id), 'creado_en', r.creado_en,
                'ultima_actividad_en', r.ultima_actividad_en, 'fecha_objetivo', r.fecha_objetivo, 'primera_respuesta_en', r.primera_respuesta_en,
                'vencida', r.estado not in ('resuelta', 'cerrada') and r.primera_respuesta_en is null and now() > r.fecha_objetivo,
                'esperando_equipo', r.estado in ('recibida', 'en_revision'))
                order by r.estado in ('resuelta', 'cerrada'), r.prioridad = 'alta' desc, r.ultima_actividad_en desc)
            from (select * from base order by estado in ('resuelta', 'cerrada'), prioridad = 'alta' desc, ultima_actividad_en desc
                   limit v_limite offset v_desde) r), '[]'::jsonb),
        'categorias', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'activa', activa) order by orden, nombre), '[]'::jsonb) from reclamacion_categorias),
        'responsables', case when v_rol = 'admin' then private._responsables() else '[]'::jsonb end,
        'es_admin', v_rol = 'admin'));
end;
$$;

create or replace function public.panel_reclamacion(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._exigir_reclamacion(p_id);
begin
    return (select jsonb_build_object('id', r.id, 'codigo', private._reclamacion_codigo(r.numero), 'estado', r.estado, 'prioridad', r.prioridad,
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
        'responsables', case when v_rol = 'admin' then private._responsables() else '[]'::jsonb end,
        'es_admin', v_rol = 'admin')
      from reclamaciones r where r.id = p_id);
end;
$$;

create or replace function public.panel_reclamacion_adjunto(p_adjunto bigint) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_caso uuid;
begin
    select reclamacion_id into v_caso from reclamacion_adjuntos where id = p_adjunto;
    if v_caso is null then
        raise exception 'reclamacion_no_encontrada';
    end if;
    perform private._exigir_reclamacion(v_caso);
    return (select imagen from reclamacion_adjuntos where id = p_adjunto);
end;
$$;

-- Mensaje al cliente (visible) o nota interna. solicitar_info = el caso pasa a esperar respuesta del cliente.
-- Solo un mensaje visible cuenta como primera respuesta; una nota interna no.
create or replace function public.panel_reclamacion_mensaje(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_clave uuid := private._uuid(p_datos ->> 'clave');
    v_id uuid := private._uuid(p_datos ->> 'reclamacion_id');
    v reclamaciones;
    v_interno boolean := coalesce((p_datos ->> 'interno')::boolean, false);
    v_solicitar boolean := coalesce((p_datos ->> 'solicitar_info')::boolean, false);
    v_mensaje bigint;
begin
    perform private._exigir_reclamacion(v_id);
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
    perform private._reclamacion_adjuntar(v_id, v_mensaje, p_datos -> 'adjuntos', 'equipo', v_interno);
    perform private._reclamacion_evento(v_id, case when v_interno then 'nota' else 'mensaje' end, null, null, null);
    if not v_interno then
        update reclamaciones set primera_respuesta_en = coalesce(primera_respuesta_en, now()),
               estado = case when v_solicitar then 'esperando_cliente' when estado = 'recibida' then 'en_revision' else estado end
         where id = v_id;
        if v_solicitar and v.estado <> 'esperando_cliente' then
            perform private._reclamacion_evento(v_id, 'estado', v.estado, 'esperando_cliente', 'Se pidió información al cliente');
        elsif v.estado = 'recibida' and not v_solicitar then
            perform private._reclamacion_evento(v_id, 'estado', 'recibida', 'en_revision', null);
        end if;
    end if;
    return panel_reclamacion(v_id);
end;
$$;

-- p_datos: { clave, reclamacion_id, accion, valor?, motivo? }
-- accion: estado (barbero asignado o admin; cerrar solo admin) · asignar · prioridad · fecha_objetivo · reabrir · reembolso (admin)
--         solucion (registrar la solución aplicada)
create or replace function public.panel_reclamacion_actualizar(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid := private._uuid(p_datos ->> 'reclamacion_id');
    v_rol text := private._exigir_reclamacion(v_id);
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
        perform private._reclamacion_evento(v_id, 'estado', v.estado, v_valor, v_motivo);
    elsif v_accion = 'solucion' then
        if coalesce(length(v_valor), 0) not between 3 and 2000 then
            raise exception 'solucion_requerida';
        end if;
        update reclamaciones set solucion = v_valor where id = v_id;
        perform private._reclamacion_evento(v_id, 'solucion', null, null, null);
    elsif v_rol <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    elsif v_accion = 'asignar' then
        if v_valor is not null and not exists (select 1 from jsonb_array_elements(private._responsables()) x where x ->> 'user_id' = v_valor) then
            raise exception 'responsable_invalido';
        end if;
        update reclamaciones set responsable_user_id = v_valor::uuid where id = v_id;
        perform private._reclamacion_evento(v_id, 'asignacion', (select email from auth.users where id = v.responsable_user_id),
                                            (select email from auth.users where id::text = v_valor), v_motivo);
    elsif v_accion = 'prioridad' then
        if v_valor not in ('baja', 'media', 'alta') then
            raise exception 'transicion_invalida';
        end if;
        update reclamaciones set prioridad = v_valor where id = v_id;
        perform private._reclamacion_evento(v_id, 'prioridad', v.prioridad, v_valor, v_motivo);
    elsif v_accion = 'fecha_objetivo' then
        if v_valor is null or v_valor::timestamptz < v.creado_en then
            raise exception 'fecha_invalida';
        end if;
        update reclamaciones set fecha_objetivo = v_valor::timestamptz where id = v_id;
        perform private._reclamacion_evento(v_id, 'fecha_objetivo', v.fecha_objetivo::text, v_valor, v_motivo);
    elsif v_accion = 'reabrir' then
        if v.estado not in ('resuelta', 'cerrada') then
            raise exception 'transicion_invalida';
        end if;
        if coalesce(length(v_motivo), 0) < 3 then
            raise exception 'motivo_requerido';
        end if;
        update reclamaciones set estado = 'en_revision', resuelta_en = null, cerrada_en = null where id = v_id;
        perform private._reclamacion_evento(v_id, 'reapertura', v.estado, 'en_revision', v_motivo);
    elsif v_accion = 'reembolso' then
        -- Solo se vincula: el reembolso se registra en Ventas y cobros (caja y devoluciones)
        select * into v_venta from ventas where id = private._uuid(v_valor);
        if not found or (v_venta.reembolsado = 0 and v_venta.devuelto = 0) then
            raise exception 'reembolso_no_encontrado';
        end if;
        update reclamaciones set reembolso_venta_id = v_venta.id where id = v_id;
        perform private._reclamacion_evento(v_id, 'reembolso', null, 'Venta #' || v_venta.numero, v_motivo);
    else
        raise exception 'accion_invalida';
    end if;
    perform _auditar('reclamacion_' || v_accion, 'reclamacion', v_id::text, jsonb_build_object('a', v_valor));
    return panel_reclamacion(v_id);
end;
$$;

-- Caso registrado por el equipo (p. ej. una compra en mostrador): devuelve el enlace privado para el cliente
create or replace function public.panel_reclamacion_crear(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_clave uuid := private._uuid(p_datos ->> 'clave');
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
    if private._uuid(p_datos ->> 'venta_id') is not null then
        select * into v_venta from ventas where id = private._uuid(p_datos ->> 'venta_id');
        if not found then raise exception 'venta_no_disponible'; end if;
    end if;
    if not exists (select 1 from reclamacion_categorias where id = private._num(p_datos, 'categoria_id')::bigint and activa) then
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
            v_cita.cliente_user_id, private._num(p_datos, 'categoria_id')::bigint, trim(p_datos ->> 'descripcion'), 'equipo',
            now() + make_interval(hours => (select horas_objetivo_respuesta from reclamaciones_config where id)))
    returning id into v_id;
    perform private._reclamacion_adjuntar(v_id, null, p_datos -> 'adjuntos', 'equipo', false);
    perform private._reclamacion_evento(v_id, 'creada', null, 'recibida', 'Registrada por el equipo');
    return panel_reclamacion(v_id);
end;
$$;

-- Indicadores del periodo (por fecha de creación) y estado actual
create or replace function public.panel_reclamaciones_indicadores(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.panel_reclamaciones_pendientes() returns int
language sql stable security definer set search_path = public, pg_temp as $$
    select case when _rol_panel() is null then 0 else (select count(*)::int from reclamaciones
        where estado in ('recibida', 'en_revision') and (_rol_panel() = 'admin' or responsable_user_id = auth.uid())) end
$$;

create or replace function public.panel_reclamaciones_config(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_cat jsonb;
begin
    perform _exigir_panel(true);
    if p_datos ? 'horas_objetivo' then
        if private._num(p_datos, 'horas_objetivo') is null or private._num(p_datos, 'horas_objetivo') not between 1 and 720 then
            raise exception 'regla_invalida';
        end if;
        update reclamaciones_config set horas_objetivo_respuesta = private._num(p_datos, 'horas_objetivo')::int, actualizado_en = now() where id;
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
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and (p.proname like 'panel\_portafolio%' or p.proname like 'panel\_autorizacion%'
                       or p.proname like 'panel\_barbero\_perfil%' or p.proname like 'panel\_reclamacion%' or p.proname = 'panel_ocupacion'
                       or p.proname = 'mis_reclamaciones') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas',
                       'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens',
                       'barberos_publicos') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function private.tg_portafolio_publicacion() from public, anon, authenticated;
revoke all on function private._imagen_ok(text, int) from public, anon, authenticated;
revoke all on function private._exigir_portafolio(text) from public, anon, authenticated;
revoke all on function private._trabajo_json(public.portafolio_trabajos, boolean) from public, anon, authenticated;
revoke all on function private._jornada_base(text, date) from public, anon, authenticated;
revoke all on function private._minutos(tsmultirange) from public, anon, authenticated;
revoke all on function private._reclamacion_evento(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private._reclamacion_adjuntar(uuid, bigint, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function private._reclamacion_codigo(bigint) from public, anon, authenticated;
revoke all on function private._reclamacion_cliente_json(uuid) from public, anon, authenticated;
revoke all on function private._reclamacion_resumen_json(public.reclamaciones) from public, anon, authenticated;
revoke all on function private._exigir_reclamacion(uuid) from public, anon, authenticated;
revoke all on function private._responsables() from public, anon, authenticated;

notify pgrst, 'reload schema';
