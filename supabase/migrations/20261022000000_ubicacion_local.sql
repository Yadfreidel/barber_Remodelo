-- =====================================================================
-- UBICACIÓN DE LA BARBERÍA (minimapa "Encuéntranos")
-- Configuración compartida de una sola fila. Sin datos iniciales: hasta que
-- un administrador la guarde, la web muestra "Ubicación pendiente de configurar".
-- Aditiva e idempotente. Requiere es_admin() (migración de módulos).
-- =====================================================================

create table if not exists public.ubicacion_local (
    id boolean primary key default true check (id),
    nombre text not null check (length(trim(nombre)) between 1 and 120),
    direccion text not null check (length(trim(direccion)) between 1 and 250),
    referencia text check (referencia is null or length(referencia) <= 250),
    latitud numeric(9, 6) not null check (latitud between -90 and 90),
    longitud numeric(9, 6) not null check (longitud between -180 and 180),
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid
);

alter table public.ubicacion_local enable row level security;
revoke all on public.ubicacion_local from anon, authenticated;

-- Lectura pública: null mientras no esté configurada
create or replace function public.ubicacion_publica() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'nombre', nombre, 'direccion', direccion, 'referencia', referencia,
        'latitud', latitud, 'longitud', longitud, 'actualizado_en', actualizado_en)
      from ubicacion_local where id
$$;

create or replace function public.admin_guardar_ubicacion(
    p_nombre text, p_direccion text, p_referencia text, p_latitud numeric, p_longitud numeric)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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

revoke all on function public.ubicacion_publica() from public, anon, authenticated;
revoke all on function public.admin_guardar_ubicacion(text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.ubicacion_publica() to anon, authenticated;
grant execute on function public.admin_guardar_ubicacion(text, text, text, numeric, numeric) to authenticated;
