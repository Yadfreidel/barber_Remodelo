-- =====================================================================
-- FILA VIRTUAL PARA CLIENTES SIN CITA
--
-- El cliente escanea un QR en el local (fila.html), elige servicio y barbero (o «Primero disponible») y
-- recibe un código (A-07). Sigue su posición desde el navegador, sin cuenta. El equipo llama y atiende desde
-- el panel. Estados: en_espera -> llamado -> en_servicio -> finalizado; además salio y no_se_presento.
--
--   - Acceso del cliente: token privado (uuid aleatorio) que solo conoce su navegador. El código A-07 solo
--     sirve para llamarlo. La página pública nunca devuelve nombres ni datos de otros clientes.
--   - Idempotencia: la clave de la solicitud (generada en el dispositivo) evita turnos duplicados.
--   - Disponibilidad: al llamar se reserva el hueco [ahora, ahora + cortesía + duración] del barbero y al
--     iniciar se protege [inicio, inicio + duración]. Esos huecos se integran en _slot_libre (la misma
--     fuente que usan el calendario, las reservas y el panel), así que ninguna cita nueva puede ocuparlos.
--     Las citas existentes conservan su prioridad: solo se llama un turno que cabe completo antes de ellas.
--   - Concurrencia: la llamada toma el bloqueo diario de la fila y el bloqueo de agenda del barbero (el
--     mismo que usan las reservas): un turno no se asigna dos veces ni un hueco se ocupa dos veces.
--   - Plazo de cortesía: un turno llamado que no se inicia a tiempo pasa a «no se presentó» y libera el hueco.
--   - Avisos con la página cerrada: notificaciones + Web Push existentes, con un identificador propio del
--     turno (el cliente no tiene cuenta). Un aviso por evento (sin duplicados).
--   - Interruptor: recepcion_abierta. Pausado, no se emiten turnos nuevos desde el QR; los emitidos se atienden.
-- Cambios compartidos (aditivos): _slot_libre (comprueba también los huecos de la fila), push_reclamar
-- (título y enlace propios de los avisos de la fila) y los tipos admitidos en notificaciones.
-- No cambia citas, precios ni pagos. ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ==========================================
-- 1. TABLAS
-- ==========================================
create table if not exists public.fila_config (
    id boolean primary key default true check (id),
    recepcion_abierta boolean not null default false,
    cortesia_minutos int not null default 5 check (cortesia_minutos between 1 and 30),
    aviso_cerca int not null default 2 check (aviso_cerca between 1 and 10),     -- «Ya casi te toca» con N o menos delante
    limite_espera int not null default 40 check (limite_espera between 1 and 200),
    url_publica text check (url_publica is null or (url_publica ~ '^https?://' and length(url_publica) <= 300)),
    actualizado_por uuid,
    actualizado_en timestamptz not null default now()
);
insert into public.fila_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.fila_turnos (
    id uuid primary key default gen_random_uuid(),
    token uuid not null unique default gen_random_uuid(),          -- acceso privado del cliente
    clave_solicitud uuid unique,                                    -- evita duplicados por doble toque o reintento
    aviso_id uuid not null unique default gen_random_uuid(),        -- destinatario de sus avisos push (sin cuenta)
    fecha date not null,
    numero int not null,
    codigo text not null,
    servicio_id text not null,
    duracion int not null check (duracion between 1 and 600),
    preferencia_barbero text,                                       -- elección del cliente (null = primero disponible)
    barbero_id text,                                                -- quién debe atenderlo (null = cualquiera elegible)
    barbero_atiende text,                                           -- quién lo llamó / atiende
    nombre text check (nombre is null or length(nombre) <= 40),     -- solo registros manuales (visible en el panel)
    origen text not null default 'qr' check (origen in ('qr', 'manual')),
    origen_huella text,                                             -- huella del origen de la solicitud (límite por dispositivo/red)
    estado text not null default 'en_espera'
        check (estado in ('en_espera', 'llamado', 'en_servicio', 'finalizado', 'salio', 'no_se_presento')),
    llamadas int not null default 0,
    llamado_en timestamptz,
    llamado_hasta timestamp,                                        -- hora local límite de la cortesía
    hueco_inicio timestamp,                                         -- hueco reservado (hora local)
    hueco_fin timestamp,
    iniciado_en timestamptz,
    cerrado_en timestamptz,
    cierre_motivo text,
    creado_por uuid,
    creado_en timestamptz not null default now(),
    unique (fecha, numero)
);
create index if not exists fila_turnos_activos_idx on public.fila_turnos (fecha, estado, creado_en);
create index if not exists fila_turnos_barbero_idx on public.fila_turnos (barbero_atiende, fecha) where estado in ('llamado', 'en_servicio');

create table if not exists public.fila_eventos (
    id bigint generated always as identity primary key,
    turno_id uuid not null references public.fila_turnos (id),
    de text,
    a text not null,
    barbero_id text,
    usuario_id uuid,
    detalle text,
    creado_en timestamptz not null default now()
);
create index if not exists fila_eventos_turno_idx on public.fila_eventos (turno_id, id);

-- Tipos de aviso de la fila
do $$
declare
    v_nombre text;
begin
    for v_nombre in select conname from pg_constraint
                     where conrelid = 'public.notificaciones'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cita_nueva%' loop
        execute format('alter table public.notificaciones drop constraint %I', v_nombre);
    end loop;
    alter table public.notificaciones add constraint notificaciones_tipo_check
        check (tipo in ('cita_nueva', 'cita_cancelada', 'cita_reprogramada', 'cita_asignada', 'cita_reasignada',
                        'disponibilidad', 'solicitud_acceso', 'sistema', 'chat_mensaje', 'chat_asignada', 'chat_referencia',
                        'fila_llamado', 'fila_cerca'));
end $$;

-- ==========================================
-- 2. RELOJ Y DISPONIBILIDAD
-- ==========================================
-- Hora local del negocio. barberia.fila_reloj solo la fijan las pruebas (no se puede fijar desde la API).
create or replace function private._fila_ahora() returns timestamp
language sql stable set search_path = public, pg_temp as $$
    select date_trunc('minute', coalesce(nullif(current_setting('barberia.fila_reloj', true), '')::timestamp, _ahora_local()))
$$;

-- Fuente única de disponibilidad: idéntica a la anterior más los huecos reservados por la fila
-- (turno llamado dentro de su cortesía o en servicio). barberia.fila_excluir excluye el turno que se valida.
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
    -- Hueco reservado por la fila virtual
    if exists (select 1 from fila_turnos t
                where t.barbero_atiende = p_barbero_id and t.fecha = p_fecha
                  and (t.estado = 'en_servicio' or (t.estado = 'llamado' and t.llamado_hasta > private._fila_ahora()))
                  and t.id::text is distinct from nullif(current_setting('barberia.fila_excluir', true), '')
                  and t.hueco_inicio - make_interval(mins => v_margen) < p_fecha + v_fin
                  and p_fecha + p_hora < t.hueco_fin + make_interval(mins => v_margen)) then
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

-- El barbero puede tomar este turno: activo, hace el servicio, trabaja hoy y respeta la asignación
create or replace function private._fila_elegible(p_barbero text, t public.fila_turnos) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select p_barbero is not null
       and (t.barbero_id is null or t.barbero_id = p_barbero)
       and exists (select 1 from barberos b where b.id::text = p_barbero and b.activo is not false)
       and _barbero_hace_servicio(p_barbero, t.servicio_id)
       and (select abre from _jornada(p_barbero, t.fecha)) is not null
$$;

-- Ocupado ahora: atención de una cita sin terminar o turno de la fila llamado/en servicio
create or replace function private._fila_ocupado_hasta(p_barbero text, p_ahora timestamp) returns timestamp
language sql stable security definer set search_path = public, pg_temp as $$
    select greatest(p_ahora,
        (select max(t.hueco_fin) from fila_turnos t where t.barbero_atiende = p_barbero and t.fecha = p_ahora::date
           and (t.estado = 'en_servicio' or (t.estado = 'llamado' and t.llamado_hasta > p_ahora))),
        -- cita iniciada y sin completar: al menos hasta su fin previsto (y mientras siga abierta, ahora)
        (select max(greatest(p_ahora + interval '5 minutes', c.fecha + c.hora + make_interval(mins => coalesce(c.duracion_reservada, 30))))
           from citas c where c.barbero_id::text = p_barbero and c.fecha = p_ahora::date and c.iniciada_en is not null
            and c.completada_en is null and c.estado <> 'cancelada' and c.no_asistio_en is null))
$$;

-- Primer inicio >= p_desde (pasos de 5 min) en que cabe p_duracion según _slot_libre; null si no cabe hoy
create or replace function private._fila_primer_hueco(p_barbero text, p_desde timestamp, p_duracion int) returns timestamp
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_fecha date := p_desde::date;
    v_j record;
    v_ini timestamp := date_trunc('minute', p_desde);
    v_vueltas int := 0;
begin
    select * into v_j from _jornada(p_barbero, v_fecha);
    if v_j.abre is null then
        return null;
    end if;
    if v_ini < v_fecha + v_j.abre then
        v_ini := v_fecha + v_j.abre;
    end if;
    while v_ini::date = v_fecha and v_ini + make_interval(mins => p_duracion) <= v_fecha + v_j.cierra and v_vueltas < 300 loop
        if _slot_libre(p_barbero, v_fecha, v_ini::time, p_duracion) then
            return v_ini;
        end if;
        -- siguiente múltiplo de 5 minutos
        v_ini := date_trunc('hour', v_ini) + make_interval(mins => (floor(extract(minute from v_ini) / 5)::int + 1) * 5);
        v_vueltas := v_vueltas + 1;
    end loop;
    return null;
end;
$$;

-- Estimación de la fila del día: cada turno en espera (por orden de llegada) al barbero elegible que antes
-- pueda empezarlo completo, respetando citas, descansos, bloqueos y huecos de la fila. inicio null = sin estimación.
create or replace function private._fila_simulacion(p_ahora timestamp)
returns table (turno_id uuid, barbero_id text, inicio timestamp)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_libre jsonb := '{}'::jsonb;
    b record;
    t fila_turnos;
    v_ini timestamp;
    v_mejor text;
    v_mejor_ini timestamp;
begin
    for b in select x.id::text id from barberos x where x.activo is not false loop
        v_libre := v_libre || jsonb_build_object(b.id, private._fila_ocupado_hasta(b.id, p_ahora));
    end loop;
    for t in select * from fila_turnos f where f.fecha = p_ahora::date and f.estado = 'en_espera' order by f.creado_en, f.numero loop
        v_mejor := null;
        v_mejor_ini := null;
        for b in select key id from jsonb_each_text(v_libre) loop
            if private._fila_elegible(b.id, t) then
                v_ini := private._fila_primer_hueco(b.id, (v_libre ->> b.id)::timestamp, t.duracion);
                if v_ini is not null and (v_mejor_ini is null or v_ini < v_mejor_ini) then
                    v_mejor := b.id;
                    v_mejor_ini := v_ini;
                end if;
            end if;
        end loop;
        if v_mejor is not null then
            v_libre := v_libre || jsonb_build_object(v_mejor, v_mejor_ini + make_interval(mins => t.duracion));
        end if;
        turno_id := t.id;
        barbero_id := v_mejor;
        inicio := v_mejor_ini;
        return next;
    end loop;
end;
$$;

-- Turnos en espera anteriores que compiten por al menos un mismo barbero
create or replace function private._fila_delante(t public.fila_turnos) returns int
language sql stable security definer set search_path = public, pg_temp as $$
    select count(*)::int from fila_turnos e
     where e.fecha = t.fecha and e.estado = 'en_espera' and (e.creado_en, e.numero) < (t.creado_en, t.numero)
       and exists (select 1 from barberos b where b.activo is not false
                     and private._fila_elegible(b.id::text, e) and private._fila_elegible(b.id::text, t))
$$;

-- ==========================================
-- 3. TRANSICIONES Y AVISOS
-- ==========================================
create or replace function private._fila_evento(t public.fila_turnos, p_a text, p_detalle text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into fila_eventos (turno_id, de, a, barbero_id, usuario_id, detalle)
    values (t.id, t.estado, p_a, coalesce(t.barbero_atiende, t.barbero_id), auth.uid(), p_detalle)
$$;

-- Al cerrar un turno: sus avisos pendientes ya no se envían y su suscripción push deja de usarse
create or replace function private._fila_cerrar_avisos(t public.fila_turnos) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    update notificaciones set leida_en = now() where user_id = t.aviso_id and leida_en is null;
    update push_envios set estado = 'omitido', actualizado_en = now()
     where estado = 'pendiente' and notificacion_id in (select id from notificaciones where user_id = t.aviso_id);
    update push_suscripciones set activa = false, actualizado_en = now() where user_id = t.aviso_id;
end;
$$;

-- «Ya casi te toca» (una sola vez por turno) a quienes tienen pocos turnos compatibles delante
create or replace function private._fila_avisar_cerca(p_fecha date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
    v_cerca int := (select aviso_cerca from fila_config);
begin
    for t in select * from fila_turnos where fecha = p_fecha and estado = 'en_espera' order by creado_en limit 30 loop
        if private._fila_delante(t) < v_cerca then
            perform private._notificar(t.aviso_id, 'fila:' || t.id || ':cerca', 'fila_cerca', 'Ya casi te toca',
                'Turno ' || t.codigo || ': acércate al local.', null, jsonb_build_object('url', 'fila.html#t=' || t.token));
        end if;
    end loop;
exception when others then
    raise warning 'aviso de fila no generado: %', sqlerrm;
end;
$$;

-- Cierra lo vencido: llamados sin iniciar dentro de la cortesía y turnos de días anteriores
create or replace function private._fila_vencer() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ahora timestamp := private._fila_ahora();
    t fila_turnos;
    v_hubo boolean := false;
begin
    for t in select * from fila_turnos
              where (estado = 'llamado' and llamado_hasta <= v_ahora)
                 or (fecha < v_ahora::date and estado in ('en_espera', 'llamado', 'en_servicio'))
              for update skip locked loop
        perform private._fila_evento(t, case when t.estado = 'en_servicio' then 'finalizado' else 'no_se_presento' end,
                                     case when t.fecha < v_ahora::date then 'cierre del día' else 'venció la cortesía' end);
        update fila_turnos set estado = case when estado = 'en_servicio' then 'finalizado' else 'no_se_presento' end,
               cerrado_en = now(), cierre_motivo = case when t.fecha < v_ahora::date then 'cierre_dia' else 'cortesia_vencida' end
         where id = t.id;
        perform private._fila_cerrar_avisos(t);
        v_hubo := true;
    end loop;
    if v_hubo then
        perform private._fila_avisar_cerca(v_ahora::date);
    end if;
end;
$$;

-- ==========================================
-- 4. REPRESENTACIÓN
-- ==========================================
-- Estado del turno para SU cliente (sin datos de nadie más)
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
        'llamado_hasta', case when t.estado = 'llamado' then t.llamado_hasta end,
        'cortesia_minutos', c.cortesia_minutos,
        'recepcion_abierta', c.recepcion_abierta,
        'ahora', v_ahora);
end;
$$;

-- Turno en el panel (con nombre solo si se registró manualmente)
create or replace function private._fila_turno_panel(t public.fila_turnos, p_inicio timestamp, p_estimado text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('id', t.id, 'codigo', t.codigo, 'estado', t.estado, 'origen', t.origen, 'nombre', t.nombre,
        'servicio_id', t.servicio_id, 'servicio', (select nombre from servicios where id::text = t.servicio_id), 'duracion', t.duracion,
        'preferencia', (select nombre from barberos where id::text = t.preferencia_barbero),
        'barbero_id', t.barbero_id, 'barbero', (select nombre from barberos where id::text = t.barbero_id),
        'barbero_atiende', t.barbero_atiende, 'atiende', (select nombre from barberos where id::text = t.barbero_atiende),
        'creado_en', t.creado_en, 'llamado_en', t.llamado_en, 'llamado_hasta', t.llamado_hasta, 'iniciado_en', t.iniciado_en,
        'cerrado_en', t.cerrado_en, 'cierre_motivo', t.cierre_motivo, 'llamadas', t.llamadas,
        'inicio_estimado', p_inicio, 'barbero_estimado', p_estimado)
$$;

-- ==========================================
-- 5. PÁGINA PÚBLICA (QR)
-- ==========================================
-- Servicios activos del catálogo con los barberos que los hacen y trabajan hoy, y el estado de la recepción
create or replace function public.fila_publica() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_hoy date := private._fila_ahora()::date;
begin
    perform private._fila_vencer();
    return jsonb_build_object(
        'recepcion_abierta', (select recepcion_abierta from fila_config),
        'en_espera', (select count(*) from fila_turnos where fecha = v_hoy and estado = 'en_espera'),
        'barberos', coalesce((select jsonb_agg(jsonb_build_object('id', b.id::text, 'nombre', b.nombre) order by b.nombre)
                                from barberos b where b.activo is not false and (select abre from _jornada(b.id::text, v_hoy)) is not null), '[]'::jsonb),
        'servicios', coalesce((select jsonb_agg(x.s order by x.orden nulls last, x.nombre) from (
            select s.orden, s.nombre, jsonb_build_object('id', s.id::text, 'nombre', s.nombre, 'precio', s.precio, 'duracion', s.duracion_minutos,
                       'categoria', s.categoria,
                       'barberos', coalesce((select jsonb_agg(b.id::text order by b.nombre) from barberos b
                                              where b.activo is not false and _barbero_hace_servicio(b.id::text, s.id::text)
                                                and (select abre from _jornada(b.id::text, v_hoy)) is not null), '[]'::jsonb)) s
              from servicios s
             where s.activo and (s.catalogo_id is not null or s.en_catalogo) and coalesce(s.duracion_minutos, 0) > 0) x), '[]'::jsonb));
end;
$$;

-- Toma un turno. p_barbero null = primero disponible. La misma p_clave devuelve el mismo turno.
create or replace function public.fila_tomar_turno(p_servicio text, p_barbero text, p_clave uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
    c fila_config;
    v_ahora timestamp := private._fila_ahora();
    v_servicio record;
    v_huella text;
    v_num int;
begin
    if p_clave is null then
        raise exception 'datos_invalidos';
    end if;
    select * into t from fila_turnos where clave_solicitud = p_clave;
    if found then
        return private._fila_turno_publico(t) || jsonb_build_object('token', t.token);
    end if;
    perform private._fila_vencer();
    select * into c from fila_config;
    if not c.recepcion_abierta then
        raise exception 'fila_cerrada';
    end if;
    select s.id::text id, s.duracion_minutos into v_servicio from servicios s
     where s.id::text = p_servicio and s.activo and (s.catalogo_id is not null or s.en_catalogo) and coalesce(s.duracion_minutos, 0) > 0;
    if v_servicio.id is null then
        raise exception 'servicio_no_disponible';
    end if;
    if p_barbero is not null and not (exists (select 1 from barberos where id::text = p_barbero and activo is not false)
                                      and _barbero_hace_servicio(p_barbero, v_servicio.id)
                                      and (select abre from _jornada(p_barbero, v_ahora::date)) is not null) then
        raise exception 'barbero_no_disponible';
    end if;
    if not exists (select 1 from barberos b where b.activo is not false and (p_barbero is null or b.id::text = p_barbero)
                     and _barbero_hace_servicio(b.id::text, v_servicio.id) and (select abre from _jornada(b.id::text, v_ahora::date)) is not null) then
        raise exception 'sin_barberos';
    end if;
    -- Límite por origen de la solicitud (IP vista por la API): 3 turnos activos
    v_huella := nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
    if v_huella is not null then
        v_huella := md5('fila:' || v_huella);
        if (select count(*) from fila_turnos where origen_huella = v_huella and fecha = v_ahora::date
              and estado in ('en_espera', 'llamado')) >= 3 then
            raise exception 'demasiados_turnos';
        end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('fila:' || v_ahora::date, 0));
    -- Otra solicitud con la misma clave pudo entrar mientras se esperaba el bloqueo
    select * into t from fila_turnos where clave_solicitud = p_clave;
    if found then
        return private._fila_turno_publico(t) || jsonb_build_object('token', t.token);
    end if;
    if (select count(*) from fila_turnos where fecha = v_ahora::date and estado = 'en_espera') >= c.limite_espera then
        raise exception 'fila_llena';
    end if;
    v_num := coalesce((select max(numero) from fila_turnos where fecha = v_ahora::date), 0) + 1;
    insert into fila_turnos (clave_solicitud, fecha, numero, codigo, servicio_id, duracion, preferencia_barbero, barbero_id, origen, origen_huella)
    values (p_clave, v_ahora::date, v_num, 'A-' || lpad(v_num::text, 2, '0'), v_servicio.id, v_servicio.duracion_minutos,
            p_barbero, p_barbero, 'qr', v_huella)
    returning * into t;
    insert into fila_eventos (turno_id, de, a, barbero_id, detalle) values (t.id, null, 'en_espera', p_barbero, 'qr');
    perform private._fila_avisar_cerca(t.fecha);
    return private._fila_turno_publico(t) || jsonb_build_object('token', t.token);
end;
$$;

-- Estado del propio turno (solo con su token)
create or replace function public.fila_turno(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
begin
    perform private._fila_vencer();
    select * into t from fila_turnos where token = p_token;
    if not found then
        return null;
    end if;
    return private._fila_turno_publico(t);
end;
$$;

-- «Salir de la fila» (solo con su token, mientras espera o tras ser llamado)
create or replace function public.fila_salir(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
begin
    perform private._fila_vencer();
    select * into t from fila_turnos where token = p_token for update;
    if not found then
        raise exception 'turno_no_encontrado';
    end if;
    if t.estado not in ('en_espera', 'llamado') then
        raise exception 'transicion_invalida';
    end if;
    perform private._fila_evento(t, 'salio', 'cliente');
    update fila_turnos set estado = 'salio', cerrado_en = now(), cierre_motivo = 'cliente' where id = t.id returning * into t;
    perform private._fila_cerrar_avisos(t);
    perform private._fila_avisar_cerca(t.fecha);
    return private._fila_turno_publico(t);
end;
$$;

-- Avisos con la página cerrada: suscripción Web Push del navegador para ESTE turno
create or replace function public.fila_push_suscribir(p_token uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
    v_endpoint text := p_datos ->> 'endpoint';
begin
    select * into t from fila_turnos where token = p_token;
    if not found or t.estado not in ('en_espera', 'llamado') then
        raise exception 'turno_no_encontrado';
    end if;
    if v_endpoint is null or v_endpoint !~ '^https://' or length(v_endpoint) > 1000
       or length(coalesce(p_datos ->> 'p256dh', '')) not between 1 and 200 or length(coalesce(p_datos ->> 'auth', '')) not between 1 and 100 then
        raise exception 'datos_invalidos';
    end if;
    -- Un dispositivo suscrito a una cuenta del equipo no se reasigna a un turno
    if exists (select 1 from push_suscripciones s where s.endpoint = v_endpoint and s.activa
                 and not exists (select 1 from fila_turnos f where f.aviso_id = s.user_id)) then
        return jsonb_build_object('ok', false, 'motivo', 'dispositivo_en_uso');
    end if;
    insert into push_suscripciones (user_id, endpoint, p256dh, auth, dispositivo, activa)
    values (t.aviso_id, v_endpoint, p_datos ->> 'p256dh', p_datos ->> 'auth', left(p_datos ->> 'dispositivo', 200), true)
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           activa = true, actualizado_en = now();
    insert into notificacion_preferencias (user_id, push) values (t.aviso_id, true)
    on conflict (user_id) do update set push = true, actualizado_en = now();
    return jsonb_build_object('ok', true);
end;
$$;

-- ==========================================
-- 6. PANEL
-- ==========================================
-- Barbero sobre el que actúa quien llama: el barbero, el suyo; la administración, el indicado
create or replace function private._fila_barbero_de(p_rol text, p_barbero text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v text := case when p_rol = 'barbero' then barbero_actual() else nullif(p_barbero, '') end;
begin
    if v is null or not exists (select 1 from barberos where id::text = v and activo is not false) then
        raise exception 'barbero_requerido';
    end if;
    return v;
end;
$$;

-- Turno sobre el que actúa el personal: la administración, cualquiera; el barbero, solo el que él atiende
create or replace function private._fila_turno_personal(p_turno uuid, p_rol text) returns public.fila_turnos
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
begin
    select * into t from fila_turnos where id = p_turno for update;
    if not found or (p_rol = 'barbero' and t.barbero_atiende is distinct from barbero_actual()) then
        raise exception 'turno_no_encontrado';
    end if;
    return t;
end;
$$;

-- Fila del día. Administración: todo. Barbero: lo que tiene asignado, lo que puede atender (servicio y
-- horario) y lo que atiende o atendió hoy.
create or replace function public.panel_fila(p_barbero text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_yo text := case when v_rol = 'barbero' then barbero_actual() end;
    v_ahora timestamp;
    c fila_config;
    v_prox_hora time;
    v_prox_servicio text;
begin
    if v_rol = 'barbero' and v_yo is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    perform private._fila_vencer();
    v_ahora := private._fila_ahora();
    select * into c from fila_config;
    if v_yo is not null then
        select c2.hora, s.nombre into v_prox_hora, v_prox_servicio from citas c2 left join servicios s on s.id = c2.servicio_id
         where c2.barbero_id::text = v_yo and c2.fecha = v_ahora::date and c2.estado <> 'cancelada'
           and c2.completada_en is null and c2.no_asistio_en is null and c2.fecha + c2.hora >= v_ahora
         order by c2.hora limit 1;
    end if;
    return jsonb_build_object(
        'rol', v_rol, 'barbero_id', v_yo, 'ahora', v_ahora,
        'config', jsonb_build_object('recepcion_abierta', c.recepcion_abierta, 'cortesia_minutos', c.cortesia_minutos,
                                     'aviso_cerca', c.aviso_cerca, 'limite_espera', c.limite_espera, 'url_publica', c.url_publica),
        'proxima_cita', case when v_prox_hora is not null then jsonb_build_object('hora', to_char(v_prox_hora, 'HH24:MI'), 'servicio', v_prox_servicio) end,
        'ocupado_por_cita', v_yo is not null and exists (select 1 from citas x where x.barbero_id::text = v_yo and x.fecha = v_ahora::date
                              and x.iniciada_en is not null and x.completada_en is null and x.estado <> 'cancelada' and x.no_asistio_en is null),
        'turnos', coalesce((select jsonb_agg(private._fila_turno_panel(t, s.inicio, s.barbero_id) order by
                                case t.estado when 'en_servicio' then 0 when 'llamado' then 1 when 'en_espera' then 2 else 3 end,
                                case when t.estado in ('en_espera', 'llamado', 'en_servicio') then t.creado_en end,
                                t.cerrado_en desc nulls last)
                              from fila_turnos t
                              left join private._fila_simulacion(v_ahora) s on s.turno_id = t.id
                             where t.fecha = v_ahora::date
                               and (v_yo is null
                                    or t.barbero_atiende = v_yo
                                    or (t.estado = 'en_espera' and private._fila_elegible(v_yo, t)))), '[]'::jsonb),
        'barberos', case when v_rol = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', b.id::text, 'nombre', b.nombre,
                        'trabaja_hoy', (select abre from _jornada(b.id::text, v_ahora::date)) is not null,
                        'ocupado', exists (select 1 from fila_turnos f where f.barbero_atiende = b.id::text and f.fecha = v_ahora::date
                                             and (f.estado = 'en_servicio' or (f.estado = 'llamado' and f.llamado_hasta > v_ahora))))
                        order by b.nombre) from barberos b where b.activo is not false), '[]'::jsonb) end,
        'servicios', case when v_rol = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'nombre', s.nombre, 'duracion', s.duracion_minutos)
                        order by s.orden nulls last, s.nombre) from servicios s
                        where s.activo and (s.catalogo_id is not null or s.en_catalogo) and coalesce(s.duracion_minutos, 0) > 0), '[]'::jsonb) end);
end;
$$;

-- «Llamar siguiente»: el turno más antiguo que este barbero puede atender y que cabe completo (con la
-- cortesía) antes de su próxima cita, bloqueo o cierre. Atómico frente a otros paneles y a reservas.
create or replace function public.panel_fila_llamar(p_barbero text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := private._fila_barbero_de(v_rol, p_barbero);
    v_ahora timestamp;
    c fila_config;
    t fila_turnos;
    v_esperan int := 0;
begin
    perform private._fila_vencer();
    v_ahora := private._fila_ahora();
    select * into c from fila_config;
    -- Orden fijo de bloqueos (fila del día y luego agenda del barbero, como las reservas): sin interbloqueos
    perform pg_advisory_xact_lock(hashtextextended('fila:' || v_ahora::date, 0));
    perform _bloquear_agenda(v_barbero, v_ahora::date);
    if exists (select 1 from fila_turnos where barbero_atiende = v_barbero and fecha = v_ahora::date
                 and (estado = 'en_servicio' or (estado = 'llamado' and llamado_hasta > v_ahora))) then
        raise exception 'ya_tiene_turno';
    end if;
    if exists (select 1 from citas x where x.barbero_id::text = v_barbero and x.fecha = v_ahora::date and x.iniciada_en is not null
                 and x.completada_en is null and x.estado <> 'cancelada' and x.no_asistio_en is null) then
        raise exception 'atencion_en_curso';
    end if;
    for t in select * from fila_turnos where fecha = v_ahora::date and estado = 'en_espera' order by creado_en, numero for update loop
        if private._fila_elegible(v_barbero, t) then
            v_esperan := v_esperan + 1;
            -- Cabe completo (cortesía + servicio) en el hueco actual: horario, descansos, bloqueos, citas y fila
            if _slot_libre(v_barbero, v_ahora::date, v_ahora::time, c.cortesia_minutos + t.duracion) then
                perform private._fila_evento(t, 'llamado', null);
                update fila_turnos set estado = 'llamado', barbero_atiende = v_barbero, llamadas = llamadas + 1, llamado_en = now(),
                       llamado_hasta = v_ahora + make_interval(mins => c.cortesia_minutos),
                       hueco_inicio = v_ahora, hueco_fin = v_ahora + make_interval(mins => c.cortesia_minutos + t.duracion)
                 where id = t.id returning * into t;
                perform private._notificar(t.aviso_id, 'fila:' || t.id || ':llamado:' || t.llamadas, 'fila_llamado', 'Es tu turno: ' || t.codigo,
                    'Pasa con ' || coalesce((select nombre from barberos where id::text = v_barbero), 'tu barbero') || '.', null,
                    jsonb_build_object('url', 'fila.html#t=' || t.token));
                perform private._fila_avisar_cerca(t.fecha);
                perform _auditar('fila_llamar', 'fila_turno', t.id::text, jsonb_build_object('barbero', v_barbero, 'codigo', t.codigo));
                return jsonb_build_object('turno', private._fila_turno_panel(t, null, null));
            end if;
        end if;
    end loop;
    return jsonb_build_object('turno', null, 'motivo', case when v_esperan = 0 then 'sin_turnos' else 'sin_hueco' end, 'esperan', v_esperan);
end;
$$;

-- «Iniciar servicio»: vuelve a validar el hueco y protege el intervalo del servicio
create or replace function public.panel_fila_iniciar(p_turno uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    t fila_turnos;
    v_ahora timestamp;
begin
    perform private._fila_vencer();
    v_ahora := private._fila_ahora();
    t := private._fila_turno_personal(p_turno, v_rol);
    if t.estado <> 'llamado' then
        raise exception 'transicion_invalida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('fila:' || t.fecha, 0));
    perform _bloquear_agenda(t.barbero_atiende, t.fecha);
    perform set_config('barberia.fila_excluir', t.id::text, true);
    if not _slot_libre(t.barbero_atiende, t.fecha, v_ahora::time, t.duracion) then
        perform set_config('barberia.fila_excluir', '', true);
        raise exception 'hueco_no_disponible';
    end if;
    perform set_config('barberia.fila_excluir', '', true);
    perform private._fila_evento(t, 'en_servicio', null);
    update fila_turnos set estado = 'en_servicio', iniciado_en = now(), hueco_inicio = v_ahora,
           hueco_fin = v_ahora + make_interval(mins => t.duracion)
     where id = t.id returning * into t;
    perform private._fila_cerrar_avisos(t);
    return jsonb_build_object('turno', private._fila_turno_panel(t, null, null));
end;
$$;

-- «Finalizar», «No se presentó» y «Salió de la fila» (personal)
create or replace function public.panel_fila_cerrar(p_turno uuid, p_accion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    t fila_turnos;
    v_a text := case p_accion when 'finalizar' then 'finalizado' when 'no_se_presento' then 'no_se_presento' when 'salio' then 'salio' end;
begin
    if v_a is null then
        raise exception 'transicion_invalida';
    end if;
    perform private._fila_vencer();
    -- «Salió» de un turno que aún espera (sin barbero): solo la administración
    if p_accion = 'salio' and v_rol = 'admin' then
        select * into t from fila_turnos where id = p_turno for update;
        if not found then raise exception 'turno_no_encontrado'; end if;
    else
        t := private._fila_turno_personal(p_turno, v_rol);
    end if;
    if not ((v_a = 'finalizado' and t.estado = 'en_servicio')
            or (v_a = 'no_se_presento' and t.estado = 'llamado')
            or (v_a = 'salio' and t.estado in ('en_espera', 'llamado'))) then
        raise exception 'transicion_invalida';
    end if;
    perform private._fila_evento(t, v_a, 'personal');
    update fila_turnos set estado = v_a, cerrado_en = now(), cierre_motivo = 'personal',
           hueco_fin = case when v_a = 'finalizado' then least(hueco_fin, private._fila_ahora()) else hueco_fin end
     where id = t.id returning * into t;
    perform private._fila_cerrar_avisos(t);
    perform private._fila_avisar_cerca(t.fecha);
    return jsonb_build_object('turno', private._fila_turno_panel(t, null, null));
end;
$$;

-- Asignar o reasignar un turno en espera (administración). p_barbero null = primero disponible.
create or replace function public.panel_fila_asignar(p_turno uuid, p_barbero text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
begin
    perform _exigir_panel(true);
    perform private._fila_vencer();
    select * into t from fila_turnos where id = p_turno for update;
    if not found then
        raise exception 'turno_no_encontrado';
    end if;
    if t.estado <> 'en_espera' then
        raise exception 'transicion_invalida';
    end if;
    if p_barbero is not null and not (exists (select 1 from barberos where id::text = p_barbero and activo is not false)
                                      and _barbero_hace_servicio(p_barbero, t.servicio_id)
                                      and (select abre from _jornada(p_barbero, t.fecha)) is not null) then
        raise exception 'barbero_no_elegible';
    end if;
    insert into fila_eventos (turno_id, de, a, barbero_id, usuario_id, detalle) values (t.id, t.estado, t.estado, p_barbero, auth.uid(), 'asignado');
    update fila_turnos set barbero_id = p_barbero where id = t.id returning * into t;
    perform private._fila_avisar_cerca(t.fecha);
    perform _auditar('fila_asignar', 'fila_turno', t.id::text, jsonb_build_object('barbero', p_barbero, 'codigo', t.codigo));
    return jsonb_build_object('turno', private._fila_turno_panel(t, null, null));
end;
$$;

-- Registro manual en el mostrador (administración): para quien llega sin teléfono
create or replace function public.panel_fila_registrar(p_servicio text, p_barbero text, p_nombre text, p_clave uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t fila_turnos;
    v_ahora timestamp := private._fila_ahora();
    v_servicio record;
    v_num int;
    v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
begin
    perform _exigir_panel(true);
    if p_clave is null or length(coalesce(v_nombre, '')) > 40 then
        raise exception 'datos_invalidos';
    end if;
    select * into t from fila_turnos where clave_solicitud = p_clave;
    if found then
        return jsonb_build_object('turno', private._fila_turno_panel(t, null, null), 'token', t.token);
    end if;
    select s.id::text id, s.duracion_minutos into v_servicio from servicios s
     where s.id::text = p_servicio and s.activo and coalesce(s.duracion_minutos, 0) > 0;
    if v_servicio.id is null then
        raise exception 'servicio_no_disponible';
    end if;
    if p_barbero is not null and not (exists (select 1 from barberos where id::text = p_barbero and activo is not false)
                                      and _barbero_hace_servicio(p_barbero, v_servicio.id)
                                      and (select abre from _jornada(p_barbero, v_ahora::date)) is not null) then
        raise exception 'barbero_no_elegible';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('fila:' || v_ahora::date, 0));
    v_num := coalesce((select max(numero) from fila_turnos where fecha = v_ahora::date), 0) + 1;
    insert into fila_turnos (clave_solicitud, fecha, numero, codigo, servicio_id, duracion, preferencia_barbero, barbero_id, nombre, origen, creado_por)
    values (p_clave, v_ahora::date, v_num, 'A-' || lpad(v_num::text, 2, '0'), v_servicio.id, v_servicio.duracion_minutos,
            p_barbero, p_barbero, v_nombre, 'manual', auth.uid())
    returning * into t;
    insert into fila_eventos (turno_id, de, a, barbero_id, usuario_id, detalle) values (t.id, null, 'en_espera', p_barbero, auth.uid(), 'manual');
    perform _auditar('fila_registrar', 'fila_turno', t.id::text, jsonb_build_object('codigo', t.codigo));
    return jsonb_build_object('turno', private._fila_turno_panel(t, null, null), 'token', t.token);
end;
$$;

-- Configuración (administración): recepción abierta/pausada, cortesía, aviso, límite y URL pública del QR
create or replace function public.panel_fila_config(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c fila_config;
begin
    perform _exigir_panel(true);
    begin
        update fila_config set
            recepcion_abierta = coalesce((p_datos ->> 'recepcion_abierta')::boolean, recepcion_abierta),
            cortesia_minutos = coalesce((p_datos ->> 'cortesia_minutos')::int, cortesia_minutos),
            aviso_cerca = coalesce((p_datos ->> 'aviso_cerca')::int, aviso_cerca),
            limite_espera = coalesce((p_datos ->> 'limite_espera')::int, limite_espera),
            url_publica = case when p_datos ? 'url_publica' then nullif(btrim(p_datos ->> 'url_publica'), '') else url_publica end,
            actualizado_por = auth.uid(), actualizado_en = now()
         where id
        returning * into c;
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
        raise exception 'configuracion_invalida';
    end;
    perform _auditar('fila_config', 'fila_config', null, p_datos);
    return to_jsonb(c) - 'id' - 'actualizado_por';
end;
$$;

-- ==========================================
-- 7. AVISOS PUSH: título y enlace propios de la fila (el resto, igual que antes)
-- ==========================================
create or replace function public.push_reclamar(p_limite int default 50) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
            'titulo', case when n.tipo like 'fila\_%' then n.titulo
                           else case n.tipo when 'cita_nueva' then 'Nueva reserva' when 'cita_cancelada' then 'Cita cancelada'
                                  when 'cita_reprogramada' then 'Cita reprogramada' when 'cita_asignada' then 'Cita asignada' when 'sistema' then 'Prueba de avisos' else 'Barbería' end end,
            'cuerpo', case when n.tipo like 'fila\_%' then n.cuerpo
                           when n.tipo = 'sistema' then 'Si ves esto, los avisos funcionan en este dispositivo.' else 'Toca para ver los detalles.' end,
            'etiqueta', 'notificacion-' || n.id,
            'url', coalesce(n.datos ->> 'url',
                   '?panel=' || coalesce(n.datos ->> 'seccion', 'notificaciones') || coalesce('&fecha=' || (n.datos ->> 'fecha'), '') || coalesce('&cita=' || (n.datos ->> 'cita'), '')))), '[]'::jsonb)
      into v_res
      from e join notificaciones n on n.id = e.notificacion_id join push_suscripciones s on s.id = e.suscripcion_id;
    return v_res;
end;
$$;

-- ==========================================
-- 8. SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['fila_config', 'fila_turnos', 'fila_eventos'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('fila_publica', 'fila_tomar_turno', 'fila_turno', 'fila_salir', 'fila_push_suscribir') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to anon, authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('panel_fila', 'panel_fila_llamar', 'panel_fila_iniciar', 'panel_fila_cerrar',
                       'panel_fila_asignar', 'panel_fila_registrar', 'panel_fila_config') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'push_reclamar' loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end loop;
end $$;

revoke all on function private._fila_ahora() from public, anon, authenticated;
revoke all on function private._fila_elegible(text, public.fila_turnos) from public, anon, authenticated;
revoke all on function private._fila_ocupado_hasta(text, timestamp) from public, anon, authenticated;
revoke all on function private._fila_primer_hueco(text, timestamp, int) from public, anon, authenticated;
revoke all on function private._fila_simulacion(timestamp) from public, anon, authenticated;
revoke all on function private._fila_delante(public.fila_turnos) from public, anon, authenticated;
revoke all on function private._fila_evento(public.fila_turnos, text, text) from public, anon, authenticated;
revoke all on function private._fila_cerrar_avisos(public.fila_turnos) from public, anon, authenticated;
revoke all on function private._fila_avisar_cerca(date) from public, anon, authenticated;
revoke all on function private._fila_vencer() from public, anon, authenticated;
revoke all on function private._fila_turno_publico(public.fila_turnos) from public, anon, authenticated;
revoke all on function private._fila_turno_panel(public.fila_turnos, timestamp, text) from public, anon, authenticated;
revoke all on function private._fila_barbero_de(text, text) from public, anon, authenticated;
revoke all on function private._fila_turno_personal(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
