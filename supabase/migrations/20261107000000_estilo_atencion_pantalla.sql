-- =====================================================================
-- CONSULTA RÁPIDA DE ESTILO, ATENCIÓN UNIFICADA Y PANTALLA DE TURNOS PARA LA TV
--
-- 1. «¿Cómo quieres tu corte?»: al reservar, el cliente puede dejar una foto de referencia y una nota breve.
--    Se guardan en una tabla privada (sin acceso directo) vinculada a la cita, con la foto validada por su
--    cabecera real, tipo y tamaño (mismas reglas que las fotos del chat). Solo se sirven por funciones que
--    comprueban el permiso: el cliente con el token secreto de SU cita, el barbero asignado o la
--    administración (mismos permisos que el detalle de la cita). Guardar es idempotente (una fila por cita):
--    reintentar nunca duplica nada. Las citas sin consulta funcionan igual que antes.
-- 2. Atención: marca de llegada de la cita (llegada_en) y panel_atencion con los datos que necesita la vista
--    unificada (llegada, barbero_id y si hay referencia de estilo). Los turnos de la fila siguen usando las
--    funciones de la Fila virtual (mismas reglas de huecos, prioridad de citas y concurrencia).
-- 3. Pantalla de turnos: silla de cada barbero (la configura la administración) y fila_pantalla(), pública,
--    que devuelve SOLO código de turno, silla y estado de los turnos llamados (sin nombres, teléfonos, fotos,
--    notas ni datos de citas). Lee el mismo estado «llamado» que la página del cliente.
-- No cambia precios, pagos ni disponibilidad. ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ==========================================
-- 1. CONSULTA RÁPIDA DE ESTILO
-- ==========================================
create table if not exists public.cita_estilo (
    cita_id text primary key,
    nota text check (nota is null or length(nota) between 1 and 300),
    foto text,
    miniatura text,
    ancho int check (ancho is null or ancho between 1 and 8000),
    alto int check (alto is null or alto between 1 and 8000),
    bytes int,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    check (nota is not null or foto is not null)
);

create or replace function private._estilo_json(e public.cita_estilo, p_completa boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when e.cita_id is null then null else jsonb_build_object(
        'nota', e.nota, 'tiene_foto', e.foto is not null, 'miniatura', e.miniatura, 'ancho', e.ancho, 'alto', e.alto,
        'actualizado_en', e.actualizado_en,
        'foto', case when p_completa then e.foto end) end
$$;

-- El cliente (con el token de SU cita) guarda su consulta. Reemplaza la anterior: una fila por cita.
-- Nota y foto vacías la quitan. Solo mientras la cita siga abierta.
create or replace function public.cita_estilo_guardar(p_token uuid, p_nota text, p_foto text default null, p_miniatura text default null,
                                                      p_ancho int default null, p_alto int default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v citas;
    v_nota text := nullif(btrim(regexp_replace(coalesce(p_nota, ''), '\s+', ' ', 'g')), '');
    e cita_estilo;
begin
    select * into v from citas where id::text = _cita_por_token(p_token) for update;
    if not found then
        raise exception 'cita_no_encontrada';
    end if;
    if v.estado = 'cancelada' or v.completada_en is not null or v.no_asistio_en is not null then
        raise exception 'cita_cerrada';
    end if;
    if v_nota is not null and length(v_nota) > 300 then
        raise exception 'nota_muy_larga';
    end if;
    if p_foto is not null and (not private._chat_foto_ok(p_foto, 1500000)
            or (p_miniatura is not null and not private._chat_foto_ok(p_miniatura, 80000))
            or coalesce(p_ancho, 0) not between 1 and 8000 or coalesce(p_alto, 0) not between 1 and 8000) then
        raise exception 'foto_invalida';
    end if;
    if v_nota is null and p_foto is null then
        delete from cita_estilo where cita_id = v.id::text;
        return jsonb_build_object('ok', true, 'estilo', null);
    end if;
    insert into cita_estilo as x (cita_id, nota, foto, miniatura, ancho, alto, bytes)
    values (v.id::text, v_nota, p_foto, case when p_foto is not null then p_miniatura end,
            case when p_foto is not null then p_ancho end, case when p_foto is not null then p_alto end, length(p_foto))
    on conflict (cita_id) do update set nota = excluded.nota, foto = excluded.foto, miniatura = excluded.miniatura,
        ancho = excluded.ancho, alto = excluded.alto, bytes = excluded.bytes,
        actualizado_en = case when (x.nota, x.foto) is distinct from (excluded.nota, excluded.foto) then now() else x.actualizado_en end
    returning * into e;
    return jsonb_build_object('ok', true, 'estilo', private._estilo_json(e, false));
end;
$$;

-- El cliente consulta su consulta de estilo (p_completa: incluye la foto completa)
create or replace function public.cita_estilo(p_token uuid, p_completa boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    e cita_estilo;
begin
    select * into e from cita_estilo where cita_id = _cita_por_token(p_token);
    return private._estilo_json(e, coalesce(p_completa, false));
end;
$$;

-- Barbero asignado o administración (mismos permisos que panel_cita / panel_cita_referencia)
create or replace function public.panel_cita_estilo(p_cita text, p_completa boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v citas;
    e cita_estilo;
begin
    select * into v from citas where id::text = p_cita;
    if not found or (v_rol = 'barbero' and v.barbero_id::text is distinct from barbero_actual()) then
        raise exception 'cita_no_encontrada';
    end if;
    select * into e from cita_estilo where cita_id = v.id::text;
    return private._estilo_json(e, coalesce(p_completa, false));
end;
$$;

-- ==========================================
-- 2. ATENCIÓN: LLEGADA DEL CLIENTE CON CITA
-- ==========================================
alter table public.citas add column if not exists llegada_en timestamptz;

-- Mismas reglas que panel_cita_iniciar: el barbero, solo sus citas; solo citas de hoy, abiertas
create or replace function public.panel_cita_llegada(p_cita text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
    if v.llegada_en is null then
        update citas set llegada_en = now() where id = v.id;
        perform _auditar('cita_llegada', 'cita', p_cita, '{}'::jsonb);
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- Citas de un día para atender (barbero: las suyas). Mismo contrato que antes con datos añadidos.
create or replace function public.panel_atencion(p_fecha date, p_barbero text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id::text, 'hora', to_char(c.hora, 'HH24:MI'),
            'duracion', coalesce(c.duracion_reservada, s.duracion_minutos, 30), 'cliente', c.nombre_cliente, 'servicio', s.nombre,
            'barbero', b.nombre, 'barbero_id', c.barbero_id::text, 'estado', c.estado, 'notas', c.notas,
            'llegada_en', c.llegada_en, 'iniciada_en', c.iniciada_en, 'completada_en', c.completada_en,
            'no_asistio_en', c.no_asistio_en,
            'estilo', exists (select 1 from cita_estilo e where e.cita_id = c.id::text) or c.referencia_trabajo_id is not null) order by c.hora)
        from citas c left join servicios s on s.id = c.servicio_id left join barberos b on b.id = c.barbero_id
       where c.fecha = p_fecha and c.estado <> 'cancelada' and (v_barbero is null or c.barbero_id::text = v_barbero)), '[]'::jsonb);
end;
$$;

-- ==========================================
-- 3. SILLAS Y PANTALLA DE TURNOS
-- ==========================================
create table if not exists public.fila_sillas (
    barbero_id text primary key,
    silla smallint not null check (silla between 1 and 99),
    actualizado_por uuid,
    actualizado_en timestamptz not null default now()
);

create or replace function private._fila_silla(p_barbero text) returns smallint
language sql stable security definer set search_path = public, pg_temp as $$
    select silla from fila_sillas where barbero_id = p_barbero
$$;

-- Sillas del equipo (administración)
create or replace function public.panel_fila_sillas() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if _exigir_panel() <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', b.id::text, 'nombre', b.nombre, 'silla', s.silla) order by b.nombre)
                       from barberos b left join fila_sillas s on s.barbero_id = b.id::text
                      where b.activo is not false), '[]'::jsonb);
end;
$$;

-- p_sillas: { "<barbero_id>": 2, "<otro>": null }  (null o vacío = sin silla)
create or replace function public.panel_fila_sillas_guardar(p_sillas jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_clave text;
    v_valor jsonb;
    v_silla int;
begin
    if _exigir_panel() <> 'admin' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if jsonb_typeof(p_sillas) is distinct from 'object' then
        raise exception 'configuracion_invalida';
    end if;
    for v_clave, v_valor in select * from jsonb_each(p_sillas) loop
        if not exists (select 1 from barberos where id::text = v_clave) then
            raise exception 'barbero_no_encontrado';
        end if;
        if v_valor is null or v_valor = 'null'::jsonb or btrim(v_valor #>> '{}') = '' then
            delete from fila_sillas where barbero_id = v_clave;
            continue;
        end if;
        begin
            v_silla := (v_valor #>> '{}')::int;
        exception when others then
            raise exception 'configuracion_invalida';
        end;
        if v_silla not between 1 and 99 then
            raise exception 'configuracion_invalida';
        end if;
        insert into fila_sillas (barbero_id, silla, actualizado_por) values (v_clave, v_silla, auth.uid())
        on conflict (barbero_id) do update set silla = excluded.silla, actualizado_por = excluded.actualizado_por, actualizado_en = now();
    end loop;
    perform _auditar('fila_sillas', 'configuracion', 'fila', p_sillas);
    return public.panel_fila_sillas();
end;
$$;

-- Pantalla de la TV (pública, solo lectura): código, silla y estado de los llamados vigentes.
-- «clave» identifica cada llamado (turno + número de llamada) para sonar una sola vez por llamado.
create or replace function public.fila_pantalla() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ahora timestamp;
begin
    perform private._fila_vencer();
    v_ahora := private._fila_ahora();
    return jsonb_build_object(
        'ahora', v_ahora,
        'recepcion_abierta', (select recepcion_abierta from fila_config),
        'url_publica', (select url_publica from fila_config),
        'en_espera', (select count(*) from fila_turnos where fecha = v_ahora::date and estado = 'en_espera'),
        'llamados', coalesce((select jsonb_agg(jsonb_build_object(
                'clave', md5(t.id::text || ':' || t.llamadas), 'codigo', t.codigo, 'estado', t.estado,
                'silla', private._fila_silla(t.barbero_atiende), 'llamado_en', t.llamado_en) order by t.llamado_en desc)
            from fila_turnos t where t.fecha = v_ahora::date and t.estado = 'llamado' and t.llamado_hasta > v_ahora), '[]'::jsonb));
end;
$$;

-- Estado del turno para SU cliente: igual que antes, más la silla de quien lo llamó
create or replace function private._fila_turno_publico(t public.fila_turnos) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c fila_config;
    v_ahora timestamp := private._fila_ahora();
    v_ini timestamp;
    v_min int;
    v_delante int;
begin
    select * into c from fila_config;
    if t.estado = 'en_espera' then
        v_delante := private._fila_delante(t);
        select s.inicio into v_ini from private._fila_simulacion(v_ahora) s where s.turno_id = t.id;
        if v_ini is not null then
            v_min := greatest(0, ceil(extract(epoch from v_ini - v_ahora) / 60)::int);
        end if;
    end if;
    return jsonb_build_object(
        'codigo', t.codigo, 'estado', t.estado, 'fecha', t.fecha,
        'servicio', (select nombre from servicios where id::text = t.servicio_id), 'duracion', t.duracion,
        'preferencia', (select nombre from barberos where id::text = t.preferencia_barbero),
        'delante', v_delante,
        'espera', case when v_min is not null then jsonb_build_object('min', v_min, 'max', v_min + greatest(5, round(v_min * 0.3)::int)) end,
        'cerca', t.estado = 'en_espera' and (v_delante < c.aviso_cerca or (v_min is not null and v_min <= 10)),
        'barbero', case when t.estado in ('llamado', 'en_servicio') then (select nombre from barberos where id::text = t.barbero_atiende) end,
        'silla', case when t.estado in ('llamado', 'en_servicio') then private._fila_silla(t.barbero_atiende) end,
        'llamado_hasta', case when t.estado = 'llamado' then t.llamado_hasta end,
        'cortesia_minutos', c.cortesia_minutos,
        'recepcion_abierta', c.recepcion_abierta,
        'ahora', v_ahora);
end;
$$;

-- ==========================================
-- 4. SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['cita_estilo', 'fila_sillas'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('cita_estilo_guardar', 'cita_estilo', 'fila_pantalla') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('panel_cita_estilo', 'panel_cita_llegada', 'panel_atencion',
                       'panel_fila_sillas', 'panel_fila_sillas_guardar') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;

revoke all on function private._estilo_json(public.cita_estilo, boolean) from public, anon, authenticated;
revoke all on function private._fila_silla(text) from public, anon, authenticated;
revoke all on function private._fila_turno_publico(public.fila_turnos) from public, anon, authenticated;

notify pgrst, 'reload schema';
