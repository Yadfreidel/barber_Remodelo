-- =====================================================================
-- DEL RESULTADO A LA RESERVA: PUBLICACIÓN DE «ESTILOS DE LA CASA» COMO REFERENCIA DE UNA CITA
--
-- La cita puede guardar, de forma opcional, la publicación que el cliente eligió como inspiración
-- (citas.referencia_trabajo_id). Las reservas sin referencia funcionan igual que antes.
--   - No se copian imágenes ni publicaciones: solo se guarda el identificador.
--   - Si la publicación se retira (o se borrara), la cita sigue intacta: la referencia se muestra como
--     «no disponible» y sus imágenes dejan de servirse (las funciones públicas solo sirven lo publicado).
--   - cita_referencia_estilo: el cliente, con el token secreto de SU cita, guarda o quita la referencia;
--     el servidor solo acepta publicaciones publicadas de barberos activos (no confía en el navegador).
--   - cita_referencia: el cliente consulta la referencia de su cita (con su token).
--   - panel_cita_referencia: el barbero asignado o el administrador la consultan (mismos permisos que panel_cita).
-- La referencia no cambia estados, asignaciones, precios, pagos ni disponibilidad.
-- ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

alter table public.citas
    add column if not exists referencia_trabajo_id uuid references public.portafolio_trabajos (id) on delete set null;
create index if not exists citas_referencia_trabajo_idx on public.citas (referencia_trabajo_id) where referencia_trabajo_id is not null;

-- Datos mostrables de la referencia: completos solo si la publicación sigue publicada; si no, «no disponible»
create or replace function private._referencia_json(p_trabajo uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when p_trabajo is null then null else coalesce((
        select jsonb_build_object('disponible', true, 'trabajo_id', t.id, 'titulo', t.titulo, 'texto_alternativo', t.texto_alternativo,
                   'barbero_id', t.barbero_id, 'barbero', b.nombre,
                   'portada_id', coalesce((private._portada(t.id)).id, case when t.imagen is not null then t.id end))
          from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
         where t.id = p_trabajo and t.estado = 'publicado' and t.revision_de is null),
        jsonb_build_object('disponible', false)) end
$$;

-- p_trabajo null quita la referencia
create or replace function public.cita_referencia_estilo(p_token uuid, p_trabajo uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v citas;
begin
    select * into v from citas where id::text = _cita_por_token(p_token) for update;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    if v.estado = 'cancelada' or v.completada_en is not null then
        raise exception 'cita_cerrada';
    end if;
    if p_trabajo is not null and not exists (
        select 1 from portafolio_trabajos t join barberos b on b.id::text = t.barbero_id and b.activo is not false
         where t.id = p_trabajo and t.estado = 'publicado' and t.revision_de is null) then
        raise exception 'referencia_no_disponible';
    end if;
    if v.referencia_trabajo_id is distinct from p_trabajo then
        update citas set referencia_trabajo_id = p_trabajo where id = v.id;
    end if;
    return jsonb_build_object('ok', true, 'referencia', private._referencia_json(p_trabajo));
end;
$$;

create or replace function public.cita_referencia(p_token uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select private._referencia_json(c.referencia_trabajo_id) from citas c where c.id::text = _cita_por_token(p_token)
$$;

create or replace function public.panel_cita_referencia(p_cita text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v citas;
begin
    select * into v from citas where id::text = p_cita;
    if not found or (v_rol = 'barbero' and v.barbero_id::text is distinct from barbero_actual()) then
        raise exception 'cita_no_encontrada';
    end if;
    return private._referencia_json(v.referencia_trabajo_id);
end;
$$;

-- ==========================================
-- SEGURIDAD
-- ==========================================
do $$
declare
    v_fn regprocedure;
begin
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'panel_cita_referencia' loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('cita_referencia_estilo', 'cita_referencia') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function private._referencia_json(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
