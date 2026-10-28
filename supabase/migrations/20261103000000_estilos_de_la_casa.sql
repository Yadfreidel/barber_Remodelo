-- =====================================================================
-- ESTILOS DE LA CASA: GALERÍA PÚBLICA DE TRABAJOS (sobre el portafolio existente)
--
-- Una publicación sigue siendo un registro de portafolio_trabajos (la misma para el inicio,
-- la galería y el perfil del barbero). Novedades:
--   - portafolio_fotos: varias fotos por trabajo, con el original privado (nunca se expone
--     públicamente ni se sobrescribe al editar), los ajustes del editor y tres versiones
--     optimizadas sin metadatos (imagen para el detalle, tarjeta y miniatura), dimensiones y
--     punto focal. Los trabajos anteriores (una imagen) siguen funcionando igual.
--   - Revisiones: si el barbero edita un trabajo publicado y la publicación requiere aprobación,
--     se crea una versión aparte (revision_de); la publicada sigue visible hasta que el
--     administrador aprueba la nueva. Al aprobarse, sus fotos pasan al trabajo original
--     (sin duplicar archivos) y la versión queda archivada como historial.
--   - Confirmación de autorización del cliente: quién la confirmó y cuándo. No sustituye la
--     autorización de imagen registrada por el administrador, que sigue siendo obligatoria
--     para publicar un trabajo con una persona identificable (regla existente).
--   - galeria_config: publicación directa o con aprobación (valor inicial: con aprobación).
--   - Destacados del inicio con orden propio (orden_destacado).
--   - Funciones públicas: estilos_publicos, estilo_publico y estilo_foto. Solo devuelven lo
--     publicado de barberos activos; nunca borradores, pendientes, rechazados ni originales.
-- Imágenes en la base, comprimidas (mismo almacenamiento que el resto de fotos).
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ==========================================
-- ESQUEMA
-- ==========================================
-- Los trabajos nuevos guardan sus imágenes en portafolio_fotos (imagen/miniatura quedan para los anteriores)
alter table public.portafolio_trabajos alter column imagen drop not null;
alter table public.portafolio_trabajos alter column miniatura drop not null;
alter table public.portafolio_trabajos
    add column if not exists orden_destacado int,
    add column if not exists revision_de uuid references public.portafolio_trabajos (id),
    add column if not exists revision_aplicada_en timestamptz,
    add column if not exists autorizacion_confirmada_por uuid,
    add column if not exists autorizacion_confirmada_en timestamptz;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'portafolio_revision_no_publicada') then
        alter table public.portafolio_trabajos add constraint portafolio_revision_no_publicada check (revision_de is null or estado <> 'publicado');
    end if;
end $$;
-- Una sola versión abierta por trabajo publicado
create unique index if not exists portafolio_revision_abierta on public.portafolio_trabajos (revision_de)
    where revision_de is not null and revision_aplicada_en is null and estado <> 'archivado';
create index if not exists portafolio_estilos_idx on public.portafolio_trabajos (destacado desc, orden_destacado, publicado_en desc)
    where estado = 'publicado' and revision_de is null;

create table if not exists public.portafolio_fotos (
    id uuid primary key default gen_random_uuid(),
    trabajo_id uuid not null references public.portafolio_trabajos (id),
    orden int not null default 0,
    portada boolean not null default false,
    original text,                          -- privado: el archivo tal como se subió
    ajustes jsonb not null default '{}'::jsonb,
    imagen text not null,                   -- detalle (máx. 1600 px)
    tarjeta text not null,                  -- tarjetas (máx. 960 px)
    miniatura text not null,                -- miniaturas (máx. 480 px)
    ancho int not null check (ancho between 100 and 4000),
    alto int not null check (alto between 100 and 4000),
    foco_x numeric not null default 50 check (foco_x between 0 and 100),
    foco_y numeric not null default 50 check (foco_y between 0 and 100),
    texto_alternativo text check (length(texto_alternativo) <= 200),
    creado_por uuid,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists portafolio_fotos_trabajo_idx on public.portafolio_fotos (trabajo_id, orden);
create unique index if not exists portafolio_fotos_portada on public.portafolio_fotos (trabajo_id) where portada;

create table if not exists public.galeria_config (
    id boolean primary key default true check (id),
    publicacion_directa boolean not null default false,
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);
insert into public.galeria_config (id) values (true) on conflict (id) do nothing;

-- ==========================================
-- AUXILIARES
-- ==========================================
create or replace function private._galeria_directa() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select publicacion_directa from galeria_config where id), false)
$$;

-- Portada del trabajo (foto marcada o la primera); null si es un trabajo anterior sin fotos
create or replace function private._portada(p_trabajo uuid) returns public.portafolio_fotos
language sql stable security definer set search_path = public, pg_temp as $$
    select f from portafolio_fotos f where f.trabajo_id = p_trabajo order by f.portada desc, f.orden, f.creado_en limit 1
$$;

create or replace function private._tiene_foto(t public.portafolio_trabajos) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select t.imagen is not null or exists (select 1 from portafolio_fotos f where f.trabajo_id = t.id)
$$;

-- Misma forma que antes; la miniatura sale de la portada cuando el trabajo tiene fotos
create or replace function private._trabajo_json(t public.portafolio_trabajos, p_privado boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('id', t.id, 'barbero_id', t.barbero_id::text, 'servicio_id', t.servicio_id::text,
        'servicio', (select nombre from servicios where id::text = t.servicio_id), 'titulo', t.titulo, 'descripcion', t.descripcion,
        'texto_alternativo', t.texto_alternativo, 'especialidad', t.especialidad,
        'miniatura', coalesce((private._portada(t.id)).miniatura, t.miniatura), 'destacado', t.destacado,
        'orden', t.orden)
        || case when p_privado then jsonb_build_object('estado', t.estado, 'muestra_persona', t.muestra_persona,
            'autorizacion_id', t.autorizacion_id, 'autorizacion_numero', (select numero from autorizaciones_imagen where id = t.autorizacion_id),
            'autorizacion_vigente', (select estado = 'vigente' from autorizaciones_imagen where id = t.autorizacion_id),
            'motivo_estado', t.motivo_estado, 'creado_en', t.creado_en, 'publicado_en', t.publicado_en,
            'barbero', (select nombre from barberos where id::text = t.barbero_id),
            'creado_por', (select email from auth.users where id = t.creado_por)) else '{}'::jsonb end
$$;

-- Trabajo con sus fotos. Privado: miniaturas, ajustes, revisión abierta y confirmación de autorización
create or replace function private._estilo_json(t public.portafolio_trabajos, p_privado boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select private._trabajo_json(t, p_privado) || jsonb_build_object(
        'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'orden', f.orden, 'portada', f.portada, 'ancho', f.ancho, 'alto', f.alto,
                'foco_x', f.foco_x, 'foco_y', f.foco_y, 'texto_alternativo', f.texto_alternativo)
                || case when p_privado then jsonb_build_object('miniatura', f.miniatura, 'ajustes', f.ajustes, 'tiene_original', f.original is not null) else '{}'::jsonb end
                order by f.orden, f.creado_en) from portafolio_fotos f where f.trabajo_id = t.id), '[]'::jsonb),
        'legado', t.imagen is not null and not exists (select 1 from portafolio_fotos f where f.trabajo_id = t.id))
        || case when p_privado then jsonb_build_object('revision_de', t.revision_de, 'orden_destacado', t.orden_destacado,
            'autorizacion_confirmada_en', t.autorizacion_confirmada_en,
            'autorizacion_confirmada_por', (select email from auth.users where id = t.autorizacion_confirmada_por),
            'original_titulo', (select o.titulo from portafolio_trabajos o where o.id = t.revision_de),
            'revision', (select jsonb_build_object('id', r.id, 'estado', r.estado, 'motivo_estado', r.motivo_estado) from portafolio_trabajos r
                          where r.revision_de = t.id and r.revision_aplicada_en is null and r.estado <> 'archivado' limit 1)) else '{}'::jsonb end
$$;

-- Trabajo que se puede modificar (fotos y datos): bloquea la fila y comprueba permisos.
-- Lo publicado lo cambia el administrador, o el propio barbero con publicación directa;
-- si no, el barbero trabaja sobre una versión (panel_estilo_guardar la crea).
create or replace function private._estilo_modificable(p_id uuid) returns public.portafolio_trabajos
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
    if v.revision_de is not null and (v.revision_aplicada_en is not null or v.estado = 'archivado') then
        raise exception 'trabajo_bloqueado';
    end if;
    if v.estado = 'publicado' and v_rol = 'barbero' and not private._galeria_directa() then
        raise exception 'usar_revision';
    end if;
    return v;
end;
$$;

-- Copia una foto (para crear una versión) sin tocar la del trabajo publicado
create or replace function private._copiar_fotos(p_de uuid, p_a uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into portafolio_fotos (trabajo_id, orden, portada, original, ajustes, imagen, tarjeta, miniatura, ancho, alto, foco_x, foco_y, texto_alternativo, creado_por)
    select p_a, orden, portada, original, ajustes, imagen, tarjeta, miniatura, ancho, alto, foco_x, foco_y, texto_alternativo, creado_por
      from portafolio_fotos where trabajo_id = p_de
$$;

-- Trabajos anteriores (una imagen): su imagen pasa a ser la primera foto, sin perderse
create or replace function private._fotos_desde_legado(p_trabajo uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos;
begin
    select * into v from portafolio_trabajos where id = p_trabajo;
    if v.imagen is null or exists (select 1 from portafolio_fotos where trabajo_id = p_trabajo) then
        return;
    end if;
    insert into portafolio_fotos (trabajo_id, orden, portada, original, imagen, tarjeta, miniatura, ancho, alto, creado_por)
    values (v.id, 0, true, v.imagen, v.imagen, v.imagen, v.miniatura, 1200, 1500, v.creado_por);
    update portafolio_trabajos set imagen = null, miniatura = null where id = p_trabajo;
end;
$$;

-- Aprueba una versión: sus datos y fotos pasan al trabajo publicado; la versión queda archivada
create or replace function private._aplicar_revision(p_revision uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r portafolio_trabajos;
begin
    select * into r from portafolio_trabajos where id = p_revision for update;
    perform 1 from portafolio_trabajos where id = r.revision_de for update;
    update portafolio_trabajos o
       set titulo = r.titulo, descripcion = r.descripcion, servicio_id = r.servicio_id, texto_alternativo = r.texto_alternativo,
           especialidad = r.especialidad, muestra_persona = r.muestra_persona, autorizacion_id = r.autorizacion_id,
           autorizacion_confirmada_por = r.autorizacion_confirmada_por, autorizacion_confirmada_en = r.autorizacion_confirmada_en,
           imagen = null, miniatura = null, motivo_estado = null, estado = 'publicado', publicado_en = now(), publicado_por = auth.uid()
     where o.id = r.revision_de;
    delete from portafolio_fotos where trabajo_id = r.revision_de;
    update portafolio_fotos set trabajo_id = r.revision_de where trabajo_id = r.id;
    update portafolio_trabajos set estado = 'archivado', revision_aplicada_en = now(), motivo_estado = 'Versión aprobada y publicada' where id = r.id;
    return r.revision_de;
end;
$$;

create or replace function private._exigir_lista_publicar(t public.portafolio_trabajos) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not private._tiene_foto(t) then
        raise exception 'sin_fotos';
    end if;
    if t.muestra_persona and t.autorizacion_confirmada_en is null and t.autorizacion_id is null then
        raise exception 'confirmacion_requerida';
    end if;
end;
$$;

-- ==========================================
-- PANEL: PUBLICACIONES CON VARIAS FOTOS
-- ==========================================
create or replace function public.panel_estilo(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos;
begin
    select * into v from portafolio_trabajos where id = p_id;
    if not found then
        raise exception 'trabajo_no_encontrado';
    end if;
    perform private._exigir_portafolio(v.barbero_id::text);
    return private._estilo_json(v, true) || jsonb_build_object('publicacion_directa', private._galeria_directa());
end;
$$;

-- p_datos: { barbero_id (solo admin, al crear), titulo, descripcion?, servicio_id?, texto_alternativo, especialidad?,
--            muestra_persona, autorizacion_confirmada, autorizacion_id (solo admin) }
-- Devuelve el trabajo realmente editado: si es una versión nueva de uno publicado, la versión.
create or replace function public.panel_estilo_guardar(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos;
    v_rol text;
    v_barbero text;
    v_servicio text;
    v_destino uuid;
    v_autorizacion uuid := private._uuid(p_datos ->> 'autorizacion_id');
    v_confirma boolean := coalesce((p_datos ->> 'autorizacion_confirmada')::boolean, false);
    v_persona boolean := coalesce((p_datos ->> 'muestra_persona')::boolean, true);
begin
    if coalesce(length(trim(p_datos ->> 'titulo')), 0) not between 1 and 80 or length(coalesce(p_datos ->> 'descripcion', '')) > 300
       or coalesce(length(trim(p_datos ->> 'texto_alternativo')), 0) not between 3 and 200 or length(coalesce(p_datos ->> 'especialidad', '')) > 40 then
        raise exception 'trabajo_invalido';
    end if;
    if nullif(p_datos ->> 'servicio_id', '') is not null then
        select id::text into v_servicio from servicios where id::text = p_datos ->> 'servicio_id';
        if v_servicio is null then
            raise exception 'servicio_no_disponible';
        end if;
    end if;

    if p_id is null then
        v_barbero := case when _rol_panel() = 'admin' then nullif(p_datos ->> 'barbero_id', '') else barbero_actual() end;
        v_rol := private._exigir_portafolio(v_barbero);
        if not exists (select 1 from barberos where id::text = v_barbero) then
            raise exception 'barbero_no_encontrado';
        end if;
        if (select count(*) from portafolio_trabajos where barbero_id::text = v_barbero and estado <> 'archivado' and revision_de is null) >= 120 then
            raise exception 'limite_portafolio';
        end if;
        insert into portafolio_trabajos (barbero_id, titulo, texto_alternativo, creado_por) values (v_barbero, trim(p_datos ->> 'titulo'), trim(p_datos ->> 'texto_alternativo'), auth.uid())
        returning id into v_destino;
    else
        select * into v from portafolio_trabajos where id = p_id for update;
        if not found then
            raise exception 'trabajo_no_encontrado';
        end if;
        v_rol := private._exigir_portafolio(v.barbero_id::text);
        if v.revision_de is not null and (v.revision_aplicada_en is not null or v.estado = 'archivado') then
            raise exception 'trabajo_bloqueado';
        end if;
        if v.estado = 'publicado' and v_rol = 'barbero' and not private._galeria_directa() then
            -- La publicada sigue visible: se edita (o se crea) su versión pendiente
            select id into v_destino from portafolio_trabajos
             where revision_de = v.id and revision_aplicada_en is null and estado <> 'archivado' for update;
            if v_destino is null then
                insert into portafolio_trabajos (barbero_id, servicio_id, titulo, descripcion, texto_alternativo, especialidad, muestra_persona,
                                                 autorizacion_id, autorizacion_confirmada_por, autorizacion_confirmada_en, revision_de, creado_por)
                values (v.barbero_id, v.servicio_id, v.titulo, v.descripcion, v.texto_alternativo, v.especialidad, v.muestra_persona,
                        v.autorizacion_id, v.autorizacion_confirmada_por, v.autorizacion_confirmada_en, v.id, auth.uid())
                returning id into v_destino;
                if exists (select 1 from portafolio_fotos where trabajo_id = v.id) then
                    perform private._copiar_fotos(v.id, v_destino);
                elsif v.imagen is not null then
                    insert into portafolio_fotos (trabajo_id, orden, portada, original, imagen, tarjeta, miniatura, ancho, alto, creado_por)
                    values (v_destino, 0, true, v.imagen, v.imagen, v.imagen, v.miniatura, 1200, 1500, auth.uid());
                end if;
            end if;
        else
            v_destino := v.id;
            -- Un trabajo retirado que el barbero vuelve a editar regresa a borrador
            if v_rol = 'barbero' and v.estado = 'archivado' then
                update portafolio_trabajos set estado = 'borrador' where id = v.id;
            end if;
        end if;
    end if;

    select * into v from portafolio_trabajos where id = v_destino;
    if v_rol = 'barbero' and v_autorizacion is distinct from v.autorizacion_id and p_datos ? 'autorizacion_id' then
        v_autorizacion := v.autorizacion_id; -- el barbero no vincula autorizaciones registradas
    elsif not (p_datos ? 'autorizacion_id') then
        v_autorizacion := v.autorizacion_id;
    end if;
    if v_autorizacion is not null and not exists (select 1 from autorizaciones_imagen where id = v_autorizacion) then
        raise exception 'autorizacion_no_encontrada';
    end if;
    update portafolio_trabajos
       set titulo = trim(p_datos ->> 'titulo'), descripcion = nullif(trim(p_datos ->> 'descripcion'), ''), servicio_id = v_servicio,
           texto_alternativo = trim(p_datos ->> 'texto_alternativo'), especialidad = nullif(trim(p_datos ->> 'especialidad'), ''),
           muestra_persona = v_persona, autorizacion_id = case when v_persona then v_autorizacion end,
           autorizacion_confirmada_por = case when not v_persona or not v_confirma then null
                                              when autorizacion_confirmada_en is null then auth.uid() else autorizacion_confirmada_por end,
           autorizacion_confirmada_en = case when not v_persona or not v_confirma then null else coalesce(autorizacion_confirmada_en, now()) end
     where id = v_destino;
    perform _auditar(case when p_id is null then 'trabajo_creado' when v_destino <> p_id then 'trabajo_version' else 'trabajo_actualizado' end,
                     'portafolio', v_destino::text, jsonb_build_object('titulo', trim(p_datos ->> 'titulo'), 'confirmacion_autorizacion', v_persona and v_confirma));
    return panel_estilo(v_destino);
end;
$$;

-- p_datos: { original? (solo al crear), imagen, tarjeta, miniatura, ancho, alto, foco_x, foco_y, ajustes, texto_alternativo? }
-- Sin p_foto: añade una foto. Con p_foto: sustituye sus versiones publicables (el original no cambia).
create or replace function public.panel_estilo_foto_guardar(p_trabajo uuid, p_foto uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos := private._estilo_modificable(p_trabajo);
    v_id uuid := p_foto;
    v_ancho int := (p_datos ->> 'ancho')::int;
    v_alto int := (p_datos ->> 'alto')::int;
begin
    if not private._imagen_ok(p_datos ->> 'imagen', 900000) or not private._imagen_ok(p_datos ->> 'tarjeta', 400000)
       or not private._imagen_ok(p_datos ->> 'miniatura', 150000)
       or v_ancho not between 100 and 4000 or v_alto not between 100 and 4000
       or coalesce((p_datos ->> 'foco_x')::numeric, 50) not between 0 and 100 or coalesce((p_datos ->> 'foco_y')::numeric, 50) not between 0 and 100
       or length(coalesce(p_datos ->> 'texto_alternativo', '')) > 200 or length(coalesce(p_datos ->> 'ajustes', '{}')) > 2000 then
        raise exception 'imagen_invalida';
    end if;
    perform private._fotos_desde_legado(v.id);
    if p_foto is null then
        -- El original (privado) es obligatorio al crear: JPG, PNG o WebP de hasta 8 MB
        if not private._imagen_ok(p_datos ->> 'original', 11200000) then
            raise exception 'imagen_invalida';
        end if;
        if (select count(*) from portafolio_fotos where trabajo_id = v.id) >= 10 then
            raise exception 'limite_fotos';
        end if;
        insert into portafolio_fotos (trabajo_id, orden, portada, original, ajustes, imagen, tarjeta, miniatura, ancho, alto, foco_x, foco_y, texto_alternativo, creado_por)
        values (v.id, coalesce((select max(orden) + 1 from portafolio_fotos where trabajo_id = v.id), 0),
                not exists (select 1 from portafolio_fotos where trabajo_id = v.id), p_datos ->> 'original', coalesce(p_datos -> 'ajustes', '{}'::jsonb),
                p_datos ->> 'imagen', p_datos ->> 'tarjeta', p_datos ->> 'miniatura', v_ancho, v_alto,
                coalesce((p_datos ->> 'foco_x')::numeric, 50), coalesce((p_datos ->> 'foco_y')::numeric, 50),
                nullif(trim(p_datos ->> 'texto_alternativo'), ''), auth.uid())
        returning id into v_id;
    else
        update portafolio_fotos
           set ajustes = coalesce(p_datos -> 'ajustes', '{}'::jsonb), imagen = p_datos ->> 'imagen', tarjeta = p_datos ->> 'tarjeta',
               miniatura = p_datos ->> 'miniatura', ancho = v_ancho, alto = v_alto,
               foco_x = coalesce((p_datos ->> 'foco_x')::numeric, 50), foco_y = coalesce((p_datos ->> 'foco_y')::numeric, 50),
               texto_alternativo = nullif(trim(p_datos ->> 'texto_alternativo'), ''), actualizado_en = now()
         where id = p_foto and trabajo_id = v.id;
        if not found then
            raise exception 'foto_no_encontrada';
        end if;
    end if;
    update portafolio_trabajos set actualizado_en = now() where id = v.id;
    return jsonb_build_object('id', v_id, 'trabajo_id', v.id);
end;
$$;

-- Original privado para volver a editar (solo quien gestiona ese portafolio)
create or replace function public.panel_estilo_foto_original(p_foto uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    f portafolio_fotos;
begin
    select * into f from portafolio_fotos where id = p_foto;
    if not found then
        raise exception 'foto_no_encontrada';
    end if;
    perform private._exigir_portafolio((select barbero_id::text from portafolio_trabajos where id = f.trabajo_id));
    return coalesce(f.original, f.imagen);
end;
$$;

-- Versión publicable de una foto aún no publicada (vista previa y revisión en el panel)
create or replace function public.panel_estilo_foto(p_foto uuid, p_tam text default 'tarjeta') returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    f portafolio_fotos;
begin
    select * into f from portafolio_fotos where id = p_foto;
    if not found then
        raise exception 'foto_no_encontrada';
    end if;
    perform private._exigir_portafolio((select barbero_id::text from portafolio_trabajos where id = f.trabajo_id));
    return case p_tam when 'miniatura' then f.miniatura when 'imagen' then f.imagen else f.tarjeta end;
end;
$$;

create or replace function public.panel_estilo_fotos_ordenar(p_trabajo uuid, p_ids uuid[], p_portada uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos := private._estilo_modificable(p_trabajo);
begin
    perform private._fotos_desde_legado(v.id);
    if coalesce(cardinality(p_ids), 0) > 10 or p_portada is null
       or not exists (select 1 from portafolio_fotos where id = p_portada and trabajo_id = v.id) then
        raise exception 'imagen_invalida';
    end if;
    update portafolio_fotos f set orden = o.pos from unnest(p_ids) with ordinality o(id, pos) where f.id = o.id and f.trabajo_id = v.id;
    update portafolio_fotos set portada = false where trabajo_id = v.id and portada and id <> p_portada;
    update portafolio_fotos set portada = true where id = p_portada;
    return panel_estilo(v.id);
end;
$$;

-- Quita una foto de un trabajo editable (las de otros trabajos o versiones no se tocan)
create or replace function public.panel_estilo_foto_quitar(p_foto uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_trabajo uuid := (select trabajo_id from portafolio_fotos where id = p_foto);
    v portafolio_trabajos;
begin
    if v_trabajo is null then
        raise exception 'foto_no_encontrada';
    end if;
    v := private._estilo_modificable(v_trabajo);
    if v.estado = 'publicado' and (select count(*) from portafolio_fotos where trabajo_id = v.id) <= 1 then
        raise exception 'sin_fotos'; -- lo publicado conserva al menos una foto
    end if;
    delete from portafolio_fotos where id = p_foto;
    if not exists (select 1 from portafolio_fotos where trabajo_id = v.id and portada) then
        update portafolio_fotos set portada = true where id = (select id from portafolio_fotos where trabajo_id = v.id order by orden, creado_en limit 1);
    end if;
    return panel_estilo(v.id);
end;
$$;

-- Flujo: enviar a revisión (o publicar directamente si está configurado) · publicar, devolver con motivo,
-- destacar (admin) · archivar/retirar (barbero lo suyo, admin todo). En una versión: publicar la aplica.
create or replace function public.panel_portafolio_estado(p_id uuid, p_accion text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v portafolio_trabajos;
    v_rol text;
    v_resultado uuid := p_id;
begin
    select * into v from portafolio_trabajos where id = p_id for update;
    if not found then
        raise exception 'trabajo_no_encontrado';
    end if;
    v_rol := private._exigir_portafolio(v.barbero_id::text);
    if v.revision_de is not null and (v.revision_aplicada_en is not null or v.estado = 'archivado') then
        raise exception 'transicion_invalida';
    end if;
    if p_accion = 'enviar_revision' then
        if v.estado <> 'borrador' then raise exception 'transicion_invalida'; end if;
        perform private._exigir_lista_publicar(v);
        -- Publicación directa: sin persona identificable, o con su autorización registrada y vigente
        if private._galeria_directa() and (not v.muestra_persona
               or exists (select 1 from autorizaciones_imagen a where a.id = v.autorizacion_id and a.estado = 'vigente')) then
            if v.revision_de is not null then
                v_resultado := private._aplicar_revision(v.id);
            else
                update portafolio_trabajos set estado = 'publicado', motivo_estado = null, publicado_en = now(), publicado_por = auth.uid() where id = p_id;
            end if;
        else
            update portafolio_trabajos set estado = 'pendiente', motivo_estado = null where id = p_id;
        end if;
    elsif p_accion = 'archivar' then
        if v.estado = 'archivado' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set estado = 'archivado', destacado = false, orden_destacado = null, motivo_estado = nullif(left(trim(p_motivo), 300), '') where id = p_id;
        -- Retirar lo publicado descarta también su versión pendiente
        update portafolio_trabajos set estado = 'archivado', motivo_estado = 'Descartada al retirar la publicación'
         where revision_de = p_id and revision_aplicada_en is null and estado <> 'archivado';
    elsif v_rol <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    elsif p_accion = 'publicar' then
        if v.estado = 'publicado' then raise exception 'transicion_invalida'; end if;
        perform private._exigir_lista_publicar(v);
        if v.revision_de is not null then
            if v.muestra_persona and not exists (select 1 from autorizaciones_imagen a where a.id = v.autorizacion_id and a.estado = 'vigente') then
                raise exception 'autorizacion_requerida';
            end if;
            v_resultado := private._aplicar_revision(v.id);
        else
            update portafolio_trabajos set estado = 'publicado', motivo_estado = null, publicado_en = now(), publicado_por = auth.uid() where id = p_id;
        end if;
    elsif p_accion = 'devolver' then
        if v.estado <> 'pendiente' then raise exception 'transicion_invalida'; end if;
        if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'motivo_requerido'; end if;
        update portafolio_trabajos set estado = 'borrador', motivo_estado = left(trim(p_motivo), 300) where id = p_id;
    elsif p_accion = 'destacar' then
        if v.estado <> 'publicado' then raise exception 'transicion_invalida'; end if;
        update portafolio_trabajos set destacado = not destacado,
               orden_destacado = case when destacado then null else coalesce((select max(orden_destacado) + 1 from portafolio_trabajos where destacado), 1) end
         where id = p_id;
    else
        raise exception 'accion_invalida';
    end if;
    perform _auditar('trabajo_' || p_accion, 'portafolio', p_id::text, jsonb_build_object('antes', v.estado, 'motivo', p_motivo, 'version_de', v.revision_de));
    return private._estilo_json((select t from portafolio_trabajos t where id = v_resultado), true);
end;
$$;

-- Listado del panel: las versiones pendientes no aparecen sueltas, sino dentro de su trabajo publicado
create or replace function public.panel_portafolio(p_barbero text default null, p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return jsonb_build_object(
        'puede_gestionar', v_rol = 'admin' or coalesce((select portafolio_propio from barberos where id::text = v_barbero), false),
        'es_admin', v_rol = 'admin',
        'publicacion_directa', private._galeria_directa(),
        'trabajos', coalesce((select jsonb_agg(private._estilo_json(t, true) order by t.barbero_id, t.destacado desc, t.orden nulls last, t.creado_en desc)
            from portafolio_trabajos t
           where t.revision_de is null and (v_barbero is null or t.barbero_id::text = v_barbero)
             and (nullif(p_estado, '') is null or t.estado = p_estado
                  or (p_estado = 'pendiente' and exists (select 1 from portafolio_trabajos r where r.revision_de = t.id and r.estado = 'pendiente' and r.revision_aplicada_en is null)))), '[]'::jsonb));
end;
$$;

-- ==========================================
-- PANEL: CONTENIDO Y GALERÍA (administración)
-- ==========================================
create or replace function public.panel_galeria() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    return jsonb_build_object(
        'publicacion_directa', private._galeria_directa(),
        'pendientes', coalesce((select jsonb_agg(private._estilo_json(t, true) order by t.actualizado_en)
            from portafolio_trabajos t where t.estado = 'pendiente' and t.revision_aplicada_en is null), '[]'::jsonb),
        'publicados', coalesce((select jsonb_agg(private._estilo_json(t, true) order by t.destacado desc, t.orden_destacado nulls last, t.publicado_en desc)
            from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id
           where t.estado = 'publicado' and t.revision_de is null), '[]'::jsonb));
end;
$$;

create or replace function public.panel_galeria_config(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    if jsonb_typeof(p_datos -> 'publicacion_directa') <> 'boolean' then
        raise exception 'configuracion_invalida';
    end if;
    update galeria_config set publicacion_directa = (p_datos ->> 'publicacion_directa')::boolean, actualizado_en = now(), actualizado_por = auth.uid() where id;
    perform _auditar('galeria_config', 'configuracion', 'galeria', p_datos);
    return panel_galeria();
end;
$$;

-- Destacados del inicio en el orden indicado (solo trabajos publicados); el resto deja de ser destacado
create or replace function public.panel_galeria_destacados(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel(true);
    if coalesce(cardinality(p_ids), 0) > 24
       or exists (select 1 from unnest(p_ids) i where not exists (select 1 from portafolio_trabajos t where t.id = i and t.estado = 'publicado' and t.revision_de is null)) then
        raise exception 'trabajo_invalido';
    end if;
    update portafolio_trabajos set destacado = false, orden_destacado = null where destacado and not (id = any (coalesce(p_ids, '{}')));
    update portafolio_trabajos t set destacado = true, orden_destacado = o.pos from unnest(p_ids) with ordinality o(id, pos) where t.id = o.id;
    perform _auditar('galeria_destacados', 'portafolio', 'destacados', jsonb_build_object('ids', p_ids));
    return panel_galeria();
end;
$$;

-- ==========================================
-- WEB PÚBLICA: ESTILOS DE LA CASA
-- ==========================================
-- Galería paginada (inicio y «Ver todos»): solo lo publicado de barberos activos, destacados primero
create or replace function public.estilos_publicos(p_barbero text default null, p_limite int default 8, p_desde int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_limite int := least(greatest(coalesce(p_limite, 8), 1), 24);
begin
    return jsonb_build_object(
        'total', (select count(*) from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
                   where t.estado = 'publicado' and t.revision_de is null and private._tiene_foto(t)
                     and (nullif(p_barbero, '') is null or t.barbero_id = p_barbero)),
        'trabajos', coalesce((select jsonb_agg(x.j order by x.n) from (
            select row_number() over (order by t.destacado desc, t.orden_destacado nulls last, t.publicado_en desc, t.id) n,
                   jsonb_build_object('id', t.id, 'titulo', t.titulo, 'barbero_id', t.barbero_id, 'barbero', b.nombre,
                       'texto_alternativo', t.texto_alternativo, 'destacado', t.destacado,
                       'fotos', greatest((select count(*) from portafolio_fotos f where f.trabajo_id = t.id), 1),
                       'portada', case when p.id is null then jsonb_build_object('id', t.id, 'ancho', 4, 'alto', 5, 'foco_x', 50, 'foco_y', 50)
                                       else jsonb_build_object('id', p.id, 'ancho', p.ancho, 'alto', p.alto, 'foco_x', p.foco_x, 'foco_y', p.foco_y) end) j
              from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
              left join lateral (select f.* from portafolio_fotos f where f.trabajo_id = t.id order by f.portada desc, f.orden, f.creado_en limit 1) p on true
             where t.estado = 'publicado' and t.revision_de is null and private._tiene_foto(t)
               and (nullif(p_barbero, '') is null or t.barbero_id = p_barbero)
             order by t.destacado desc, t.orden_destacado nulls last, t.publicado_en desc, t.id
             limit v_limite offset greatest(coalesce(p_desde, 0), 0)) x), '[]'::jsonb));
end;
$$;

-- Detalle de un trabajo publicado (el servicio solo si sigue activo en el catálogo)
create or replace function public.estilo_publico(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('id', t.id, 'titulo', t.titulo, 'descripcion', t.descripcion, 'texto_alternativo', t.texto_alternativo,
               'barbero_id', t.barbero_id, 'barbero', b.nombre,
               'servicio', (select jsonb_build_object('id', s.id::text, 'nombre', s.nombre) from servicios s where s.id::text = t.servicio_id and s.activo is not false),
               'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ancho', f.ancho, 'alto', f.alto, 'foco_x', f.foco_x, 'foco_y', f.foco_y,
                            'texto_alternativo', f.texto_alternativo) order by f.portada desc, f.orden, f.creado_en)
                          from portafolio_fotos f where f.trabajo_id = t.id),
                         case when t.imagen is not null then jsonb_build_array(jsonb_build_object('id', t.id, 'ancho', 4, 'alto', 5, 'foco_x', 50, 'foco_y', 50)) else '[]'::jsonb end))
      from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
     where t.id = p_id and t.estado = 'publicado' and t.revision_de is null
$$;

-- Una versión publicable de una foto: 'miniatura' (480 px), 'tarjeta' (960 px) o 'imagen' (1600 px).
-- Nunca el original. p_id puede ser el de un trabajo anterior sin fotos (su imagen única).
create or replace function public.estilo_foto(p_id uuid, p_tam text default 'tarjeta') returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select case p_tam when 'miniatura' then f.miniatura when 'imagen' then f.imagen else f.tarjeta end
      from portafolio_fotos f join portafolio_trabajos t on t.id = f.trabajo_id join barberos b on b.id::text = t.barbero_id and b.activo is not false
     where f.id = p_id and t.estado = 'publicado' and t.revision_de is null
    union all
    select case p_tam when 'imagen' then t.imagen else t.miniatura end
      from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
     where t.id = p_id and t.estado = 'publicado' and t.revision_de is null and t.imagen is not null
    limit 1
$$;

-- Imagen ampliada del perfil: la portada del trabajo publicado (o su imagen única)
create or replace function public.portafolio_imagen(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((private._portada(t.id)).imagen, t.imagen) from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id
     where t.id = p_id and t.estado = 'publicado' and t.revision_de is null and b.activo is not false
$$;

-- La galería del perfil no muestra versiones (nunca están publicadas) ni cambia de forma
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
    return coalesce((private._portada(v.id)).imagen, v.imagen);
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
    foreach v_tabla in array array['portafolio_fotos', 'galeria_config'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and (p.proname like 'panel\_estilo%' or p.proname like 'panel\_galeria%'
                       or p.proname in ('panel_portafolio', 'panel_portafolio_estado', 'panel_portafolio_imagen')) loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('estilos_publicos', 'estilo_publico', 'estilo_foto', 'portafolio_imagen') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function private._galeria_directa() from public, anon, authenticated;
revoke all on function private._portada(uuid) from public, anon, authenticated;
revoke all on function private._tiene_foto(public.portafolio_trabajos) from public, anon, authenticated;
revoke all on function private._trabajo_json(public.portafolio_trabajos, boolean) from public, anon, authenticated;
revoke all on function private._estilo_json(public.portafolio_trabajos, boolean) from public, anon, authenticated;
revoke all on function private._estilo_modificable(uuid) from public, anon, authenticated;
revoke all on function private._copiar_fotos(uuid, uuid) from public, anon, authenticated;
revoke all on function private._fotos_desde_legado(uuid) from public, anon, authenticated;
revoke all on function private._aplicar_revision(uuid) from public, anon, authenticated;
revoke all on function private._exigir_lista_publicar(public.portafolio_trabajos) from public, anon, authenticated;

notify pgrst, 'reload schema';
