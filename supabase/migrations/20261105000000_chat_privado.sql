-- =====================================================================
-- CHAT PRIVADO CLIENTE - BARBERÍA
--
-- Una conversación por cliente con cuenta («Mis citas», Supabase Auth). La administración la atiende y
-- la asigna a un barbero; el barbero asignado lee y responde solo mientras siga asignado.
--   - Permisos SIEMPRE en el servidor (_chat_rol): el cliente solo su conversación; el administrador todas;
--     el barbero solo las asignadas a él (con acceso activo y sin contraseña temporal pendiente).
--   - Mensajes de texto, foto, nota de voz, tarjeta de cita y solicitud de cambio. Cada envío lleva una
--     clave generada en el dispositivo: un reintento o una reconexión nunca duplica el mensaje ni el adjunto.
--   - Fotos y audios en una tabla privada (sin acceso directo): se validan tipo real (cabecera del archivo),
--     tamaño y duración, y solo se sirven por chat_adjunto, que vuelve a comprobar el permiso.
--   - Una foto puede ser «Referencia para mi corte» de una cita próxima del propio cliente; el barbero
--     asignado a esa cita (o la administración) la abre desde el detalle de la cita.
--   - La tarjeta de cita se calcula al leer: siempre muestra el estado actual.
--   - Avisos: reutiliza las notificaciones internas y Web Push del panel (un aviso por ráfaga de mensajes).
-- No cambia citas, precios, pagos ni disponibilidad. ADITIVA: no borra columnas, tablas ni datos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ==========================================
-- 1. TIPOS DE AVISO DEL CHAT
-- ==========================================
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
                        'disponibilidad', 'solicitud_acceso', 'sistema', 'chat_mensaje', 'chat_asignada', 'chat_referencia'));
end $$;

-- ==========================================
-- 2. TABLAS
-- ==========================================
create table if not exists public.chat_conversaciones (
    id uuid primary key default gen_random_uuid(),
    cliente_user_id uuid not null unique,
    cliente_nombre text not null check (length(cliente_nombre) between 1 and 120),
    barbero_id text,                         -- barbero asignado (barberos.id); null = sin asignar
    asignada_por uuid,
    asignada_en timestamptz,
    ultimo_mensaje_id bigint,
    ultimo_mensaje_en timestamptz,
    ultimo_autor text check (ultimo_autor in ('cliente', 'equipo', 'sistema')),
    creado_en timestamptz not null default now()
);
create index if not exists chat_conversaciones_barbero_idx on public.chat_conversaciones (barbero_id, ultimo_mensaje_en desc);
create index if not exists chat_conversaciones_recientes_idx on public.chat_conversaciones (ultimo_mensaje_en desc nulls last);

create table if not exists public.chat_adjuntos (
    id uuid primary key default gen_random_uuid(),
    conversacion_id uuid not null references public.chat_conversaciones (id),
    tipo text not null check (tipo in ('foto', 'audio')),
    mime text not null check (length(mime) <= 60),
    datos text not null,
    miniatura text,
    ancho int check (ancho between 1 and 8000),
    alto int check (alto between 1 and 8000),
    duracion_ms int check (duracion_ms between 300 and 180000),
    bytes int not null,
    referencia_cita_id text,                 -- «Referencia para mi corte» de esta cita
    referencia_en timestamptz,
    creado_por uuid not null,
    creado_en timestamptz not null default now()
);
create index if not exists chat_adjuntos_conversacion_idx on public.chat_adjuntos (conversacion_id);
create index if not exists chat_adjuntos_referencia_idx on public.chat_adjuntos (referencia_cita_id) where referencia_cita_id is not null;

create table if not exists public.chat_mensajes (
    id bigint generated always as identity primary key,
    conversacion_id uuid not null references public.chat_conversaciones (id),
    clave uuid not null,                     -- generada en el dispositivo: el reintento no duplica
    autor_rol text not null check (autor_rol in ('cliente', 'admin', 'barbero', 'sistema')),
    autor_user_id uuid,
    autor_barbero_id text,
    tipo text not null check (tipo in ('texto', 'foto', 'audio', 'cita', 'solicitud_cambio', 'asignacion')),
    texto text check (texto is null or length(texto) <= 2000),
    adjunto_id uuid references public.chat_adjuntos (id),
    cita_id text,
    creado_en timestamptz not null default now(),
    unique (conversacion_id, clave)
);
create index if not exists chat_mensajes_conversacion_idx on public.chat_mensajes (conversacion_id, id desc);
create index if not exists chat_mensajes_autor_idx on public.chat_mensajes (autor_user_id, creado_en desc);

-- Hasta dónde leyó cada participante (contador de no leídos)
create table if not exists public.chat_lecturas (
    conversacion_id uuid not null references public.chat_conversaciones (id),
    user_id uuid not null,
    ultimo_leido bigint not null default 0,
    actualizado_en timestamptz not null default now(),
    primary key (conversacion_id, user_id)
);

-- Respuestas rápidas del personal (las edita la administración)
create table if not exists public.chat_respuestas_rapidas (
    id uuid primary key default gen_random_uuid(),
    texto text not null check (length(texto) between 1 and 500),
    orden int not null default 0,
    actualizado_por uuid,
    actualizado_en timestamptz not null default now()
);
insert into public.chat_respuestas_rapidas (texto, orden)
select t, o from (values
    ('¡Hola! Gracias por escribirnos. ¿En qué podemos ayudarte?', 1),
    ('¿Puedes enviarme una foto del corte que buscas?', 2),
    ('Revisamos tu cita y te confirmamos en breve.', 3),
    ('Puedes cambiar la fecha u hora desde «Ver cita» › «Cambiar», según la disponibilidad.', 4),
    ('¡Te esperamos! Llega unos minutos antes de tu hora.', 5)) v (t, o)
where not exists (select 1 from public.chat_respuestas_rapidas);

-- ==========================================
-- 3. PERMISOS
-- ==========================================
-- Papel de quien llama en la conversación. Cualquier otro caso: no_autorizado (sin revelar si existe).
create or replace function private._chat_rol(p_conversacion uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v chat_conversaciones;
    v_rol text;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into v from chat_conversaciones where id = p_conversacion;
    if not found then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if v.cliente_user_id = auth.uid() then
        return 'cliente';
    end if;
    v_rol := _exigir_panel();   -- personal del panel (también exige el cambio de contraseña temporal)
    if v_rol = 'admin' then
        return 'admin';
    end if;
    -- Barbero: solo mientras la conversación siga asignada a él (al reasignarla pierde el acceso)
    if v.barbero_id is not null and v.barbero_id = barbero_actual() then
        return 'barbero';
    end if;
    raise exception 'no_autorizado' using errcode = '42501';
end;
$$;

-- Conversación del cliente con sesión (se crea con su primer mensaje)
create or replace function private._chat_conversacion_cliente(p_crear boolean) returns public.chat_conversaciones
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v chat_conversaciones;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into v from chat_conversaciones where cliente_user_id = auth.uid();
    if found or not p_crear then
        return v;
    end if;
    -- Nombre con el que reservó (el más reciente) o, si aún no tiene citas, la parte local del correo
    v_nombre := left(coalesce(
        (select btrim(nombre_cliente) from citas where cliente_user_id = auth.uid() and nullif(btrim(nombre_cliente), '') is not null
          order by creado_en desc limit 1),
        (select nullif(split_part(email, '@', 1), '') from auth.users where id = auth.uid()),
        'Cliente'), 120);
    insert into chat_conversaciones (cliente_user_id, cliente_nombre) values (auth.uid(), v_nombre)
    on conflict (cliente_user_id) do nothing;
    select * into v from chat_conversaciones where cliente_user_id = auth.uid();
    return v;
end;
$$;

-- Cita compartible en la conversación: debe ser del cliente de la conversación.
-- El cliente la identifica con el token secreto de su cita (si aún no está en su cuenta, se vincula, como
-- vincular_citas); el personal, con el id de la cita.
create or replace function private._chat_cita_de(p_conv public.chat_conversaciones, p_cita text, p_rol text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id text;
    v_dueno uuid;
begin
    if nullif(btrim(coalesce(p_cita, '')), '') is null then
        raise exception 'cita_no_encontrada';
    end if;
    if p_rol = 'cliente' then
        if p_cita !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            raise exception 'cita_no_encontrada';
        end if;
        select c.id::text, c.cliente_user_id into v_id, v_dueno
          from cita_tokens t join citas c on c.id::text = t.cita_id where t.token = p_cita::uuid;
        if v_id is null or (v_dueno is not null and v_dueno <> p_conv.cliente_user_id) then
            raise exception 'cita_no_encontrada';
        end if;
        if v_dueno is null then
            update citas set cliente_user_id = p_conv.cliente_user_id where id::text = v_id and cliente_user_id is null;
        end if;
        return v_id;
    end if;
    select c.id::text into v_id from citas c where c.id::text = p_cita and c.cliente_user_id = p_conv.cliente_user_id;
    if v_id is null then
        raise exception 'cita_no_encontrada';
    end if;
    return v_id;
end;
$$;

-- Cita próxima (para referencias): no cancelada, sin completar ni ausencia, de hoy en adelante
create or replace function private._chat_cita_proxima(p_cita text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from citas c where c.id::text = p_cita and c.estado <> 'cancelada' and c.completada_en is null
                     and c.no_asistio_en is null and c.fecha >= _ahora_local()::date)
$$;

-- ==========================================
-- 4. REPRESENTACIÓN
-- ==========================================
-- Tarjeta de cita con su estado ACTUAL. El cliente recibe el token (para «Ver cita»/«Solicitar cambio»
-- con el flujo de siempre); el personal, el id (sin token).
create or replace function private._chat_cita_json(p_cita text, p_rol text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when p_cita is null then null
                when j is null then jsonb_build_object('disponible', false)
                when p_rol = 'cliente' then j || jsonb_build_object('disponible', true)
                else (j - 'token') || jsonb_build_object('disponible', true, 'id', p_cita, 'barbero_id', c.barbero_id::text,
                                                         'propia', c.barbero_id::text is not distinct from barbero_actual()) end
      from (select _cita_cliente_json(p_cita) j) x
      left join citas c on c.id::text = p_cita
$$;

create or replace function private._chat_vista_previa(m public.chat_mensajes) returns text
language sql immutable set search_path = public, pg_temp as $$
    select case m.tipo when 'foto' then 'Foto' || coalesce(': ' || left(m.texto, 60), '')
                       when 'audio' then 'Nota de voz'
                       when 'cita' then 'Cita compartida'
                       when 'solicitud_cambio' then 'Solicitud de cambio: ' || left(coalesce(m.texto, ''), 80)
                       when 'asignacion' then coalesce(m.texto, '')
                       else left(coalesce(m.texto, ''), 120) end
$$;

create or replace function private._chat_mensaje_json(m public.chat_mensajes, p_rol text, p_cliente text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', m.id,
        'conversacion', m.conversacion_id,
        'clave', case when m.autor_user_id = auth.uid() then m.clave end,
        'propio', m.autor_user_id is not null and m.autor_user_id = auth.uid(),
        'autor_rol', m.autor_rol,
        'autor', case m.autor_rol when 'cliente' then p_cliente
                                  when 'admin' then 'La barbería'
                                  when 'barbero' then coalesce((select nombre from barberos where id::text = m.autor_barbero_id), 'Barbero')
                                  else null end,
        'tipo', m.tipo,
        'texto', m.texto,
        'creado_en', m.creado_en,
        'cita', private._chat_cita_json(m.cita_id, p_rol),
        'adjunto', (select jsonb_build_object('id', a.id, 'tipo', a.tipo, 'mime', a.mime, 'ancho', a.ancho, 'alto', a.alto,
                                              'duracion_ms', a.duracion_ms, 'bytes', a.bytes, 'miniatura', a.miniatura,
                                              'referencia', private._chat_cita_json(a.referencia_cita_id, p_rol))
                      from chat_adjuntos a where a.id = m.adjunto_id))
$$;

-- No leídos de quien llama: para el cliente, lo que escribe el equipo; para el personal, lo que escribe el cliente
create or replace function private._chat_no_leidos(p_conversacion uuid, p_rol text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
    select count(*)::int from chat_mensajes m
     where m.conversacion_id = p_conversacion
       and m.id > coalesce((select ultimo_leido from chat_lecturas where conversacion_id = p_conversacion and user_id = auth.uid()), 0)
       and case when p_rol = 'cliente' then m.autor_rol in ('admin', 'barbero', 'sistema') else m.autor_rol = 'cliente' end
$$;

-- ==========================================
-- 5. VALIDACIÓN DE ADJUNTOS
-- ==========================================
-- Primeros bytes reales del archivo (no basta con lo que declare el navegador)
create or replace function private._chat_cabecera(p_data_url text) returns bytea
language plpgsql immutable set search_path = public, pg_temp as $$
begin
    return decode(substr(split_part(p_data_url, ',', 2), 1, 24), 'base64');
exception when others then
    return null;
end;
$$;

create or replace function private._chat_foto_ok(p text, p_max int) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
    v_b bytea;
begin
    if not private._imagen_ok(p, p_max) then
        return false;
    end if;
    v_b := private._chat_cabecera(p);
    if v_b is null or length(v_b) < 12 then
        return false;
    end if;
    return case
        when p like 'data:image/jpeg;%' then substr(v_b, 1, 3) = '\xffd8ff'::bytea
        when p like 'data:image/png;%' then substr(v_b, 1, 4) = '\x89504e47'::bytea
        when p like 'data:image/webp;%' then substr(v_b, 1, 4) = '\x52494646'::bytea and substr(v_b, 9, 4) = '\x57454250'::bytea
        else false end;
end;
$$;

create or replace function private._chat_audio_ok(p text, p_max int) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
    v_b bytea;
begin
    if p is null or length(p) > p_max
       or p !~ '^data:audio/(webm|ogg|mp4|mpeg|aac|x-m4a)(;codecs=[A-Za-z0-9.,"=-]{1,40})?;base64,[A-Za-z0-9+/]+={0,2}$' then
        return false;
    end if;
    v_b := private._chat_cabecera(p);
    if v_b is null or length(v_b) < 12 then
        return false;
    end if;
    return case
        when p like 'data:audio/webm%' then substr(v_b, 1, 4) = '\x1a45dfa3'::bytea
        when p like 'data:audio/ogg%' then substr(v_b, 1, 4) = '\x4f676753'::bytea
        when p like 'data:audio/mp4%' or p like 'data:audio/x-m4a%' then substr(v_b, 5, 4) = '\x66747970'::bytea
        when p like 'data:audio/mpeg%' then substr(v_b, 1, 3) = '\x494433'::bytea or get_byte(v_b, 0) = 255
        when p like 'data:audio/aac%' then get_byte(v_b, 0) = 255
        else false end;
end;
$$;

-- ==========================================
-- 6. AVISOS
-- ==========================================
-- Destinatarios del personal: las cuentas del barbero asignado (con acceso activo); si no hay, administración
create or replace function private._chat_destinatarios(p_conv public.chat_conversaciones) returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if p_conv.barbero_id is not null then
        return query select bu.user_id from barbero_usuarios bu join barberos b on b.id::text = bu.barbero_id
                      where bu.barbero_id = p_conv.barbero_id and b.activo is not false and bu.acceso_activo;
        if found then
            return;
        end if;
    end if;
    return query select user_id from admin_usuarios;
end;
$$;

-- Un aviso por ráfaga: mientras el destinatario no lea, los mensajes siguientes actualizan el mismo aviso
create or replace function private._chat_avisar(p_conv public.chat_conversaciones, p_mensaje public.chat_mensajes) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid;
    v_evento text;
    v_texto text := private._chat_vista_previa(p_mensaje);
begin
    for v_user in select * from private._chat_destinatarios(p_conv) loop
        v_evento := 'chat:' || p_conv.id || ':' || coalesce((select ultimo_leido from chat_lecturas where conversacion_id = p_conv.id and user_id = v_user), 0);
        perform private._notificar(v_user, v_evento, 'chat_mensaje', 'Mensaje de ' || p_conv.cliente_nombre, v_texto, null,
                                   jsonb_build_object('seccion', 'conversaciones', 'conversacion', p_conv.id));
        update notificaciones set cuerpo = left(v_texto, 500) where user_id = v_user and evento = v_evento and leida_en is null;
    end loop;
exception when others then
    raise warning 'aviso de chat no generado: %', sqlerrm;   -- un aviso nunca impide guardar el mensaje
end;
$$;

-- El barbero de la cita recibe aviso cuando el cliente vincula una referencia
create or replace function private._chat_avisar_referencia(p_conv public.chat_conversaciones, p_adjunto uuid, p_cita text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid;
    c citas;
begin
    select * into c from citas where id::text = p_cita;
    for v_user in select * from private._destinatarios_cita(c.barbero_id::text) loop
        perform private._notificar(v_user, 'chat-referencia:' || p_adjunto || ':' || p_cita, 'chat_referencia',
            'Foto de referencia para una cita', p_conv.cliente_nombre || ' · ' || to_char(c.fecha, 'DD/MM/YYYY') || ' ' || to_char(c.hora, 'HH24:MI'),
            p_cita, jsonb_build_object('seccion', 'agenda', 'fecha', c.fecha, 'cita', p_cita));
    end loop;
exception when others then
    raise warning 'aviso de referencia no generado: %', sqlerrm;
end;
$$;

-- ==========================================
-- 7. CONVERSACIÓN: CLIENTE Y PERSONAL
-- ==========================================
-- Conversación del cliente con sesión (null si aún no escribió)
create or replace function public.chat_mi_conversacion() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v chat_conversaciones := private._chat_conversacion_cliente(false);
begin
    if v.id is null then
        return jsonb_build_object('conversacion', null, 'no_leidos', 0);
    end if;
    return jsonb_build_object('conversacion', v.id, 'no_leidos', private._chat_no_leidos(v.id, 'cliente'),
        'asignado', (select nombre from barberos where id::text = v.barbero_id));
end;
$$;

-- Página de mensajes (los más recientes primero en la consulta; se devuelven en orden cronológico)
create or replace function public.chat_mensajes(p_conversacion uuid, p_antes bigint default null, p_limite int default 30) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._chat_rol(p_conversacion);
    v chat_conversaciones;
    v_limite int := least(greatest(coalesce(p_limite, 30), 1), 50);
    v_lista jsonb;
    v_min bigint;
begin
    select * into v from chat_conversaciones where id = p_conversacion;
    select coalesce(jsonb_agg(private._chat_mensaje_json(m, v_rol, v.cliente_nombre) order by m.id), '[]'::jsonb), min(m.id)
      into v_lista, v_min
      from (select * from chat_mensajes where conversacion_id = p_conversacion and (p_antes is null or id < p_antes)
             order by id desc limit v_limite) m;
    return jsonb_build_object('mensajes', v_lista,
        'hay_mas', v_min is not null and exists (select 1 from chat_mensajes where conversacion_id = p_conversacion and id < v_min),
        'rol', v_rol, 'asignado', (select nombre from barberos where id::text = v.barbero_id), 'barbero_id', case when v_rol <> 'cliente' then v.barbero_id end,
        'leido_por_otro', case when v_rol = 'cliente'
            then (select max(l.ultimo_leido) from chat_lecturas l where l.conversacion_id = p_conversacion and l.user_id <> v.cliente_user_id)
            else (select l.ultimo_leido from chat_lecturas l where l.conversacion_id = p_conversacion and l.user_id = v.cliente_user_id) end);
end;
$$;

-- Lo nuevo desde el último id visto, más el estado actual de las tarjetas de cita ya mostradas
create or replace function public.chat_novedades(p_conversacion uuid, p_despues bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._chat_rol(p_conversacion);
    v chat_conversaciones;
begin
    select * into v from chat_conversaciones where id = p_conversacion;
    return jsonb_build_object(
        'mensajes', coalesce((select jsonb_agg(private._chat_mensaje_json(m, v_rol, v.cliente_nombre) order by m.id)
                                from (select * from chat_mensajes where conversacion_id = p_conversacion and id > coalesce(p_despues, 0)
                                       order by id limit 100) m), '[]'::jsonb),
        'tarjetas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'cita', private._chat_cita_json(m.cita_id, v_rol),
                                                                  'referencia', private._chat_cita_json(a.referencia_cita_id, v_rol)))
                                from (select * from chat_mensajes where conversacion_id = p_conversacion and id <= coalesce(p_despues, 0)
                                         and (cita_id is not null or adjunto_id is not null) order by id desc limit 60) m
                                left join chat_adjuntos a on a.id = m.adjunto_id and a.tipo = 'foto'
                               where m.cita_id is not null or a.id is not null), '[]'::jsonb),
        'rol', v_rol, 'asignado', (select nombre from barberos where id::text = v.barbero_id), 'barbero_id', case when v_rol <> 'cliente' then v.barbero_id end,
        'no_leidos', private._chat_no_leidos(p_conversacion, v_rol),
        'leido_por_otro', case when v_rol = 'cliente'
            then (select max(l.ultimo_leido) from chat_lecturas l where l.conversacion_id = p_conversacion and l.user_id <> v.cliente_user_id)
            else (select l.ultimo_leido from chat_lecturas l where l.conversacion_id = p_conversacion and l.user_id = v.cliente_user_id) end);
end;
$$;

-- Envío idempotente. p_conversacion null: el cliente escribe en la suya (se crea con el primer mensaje).
-- p_adjunto: { datos, miniatura?, ancho?, alto? } para foto; { datos, duracion_ms } para audio.
-- p_cita: token (cliente) o id (personal). En una foto del cliente marca «Referencia para mi corte».
create or replace function public.chat_enviar(p_conversacion uuid, p_clave uuid, p_tipo text, p_texto text default null,
                                              p_adjunto jsonb default null, p_cita text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_conv chat_conversaciones;
    v_rol text;
    v_msg chat_mensajes;
    v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
    v_adjunto uuid;
    v_cita text;
    v_ref text;
    v_datos text := p_adjunto ->> 'datos';
    v_mini text := nullif(p_adjunto ->> 'miniatura', '');
    v_mime text;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if p_clave is null then
        raise exception 'datos_invalidos';
    end if;
    if p_conversacion is null then
        v_conv := private._chat_conversacion_cliente(true);
        v_rol := 'cliente';
    else
        v_rol := private._chat_rol(p_conversacion);
        select * into v_conv from chat_conversaciones where id = p_conversacion;
    end if;
    -- Reintento o reconexión: el mismo envío devuelve el mensaje ya guardado
    select * into v_msg from chat_mensajes where conversacion_id = v_conv.id and clave = p_clave;
    if found then
        if v_msg.autor_user_id is distinct from auth.uid() then
            raise exception 'no_autorizado' using errcode = '42501';
        end if;
        return private._chat_mensaje_json(v_msg, v_rol, v_conv.cliente_nombre);
    end if;
    if (select count(*) from chat_mensajes where autor_user_id = auth.uid() and creado_en > now() - interval '1 minute') >= 20 then
        raise exception 'demasiados_mensajes';
    end if;

    if p_tipo = 'texto' then
        if v_texto is null or length(v_texto) > 2000 or p_adjunto is not null or p_cita is not null then
            raise exception 'mensaje_invalido';
        end if;
    elsif p_tipo in ('foto', 'audio') then
        if p_adjunto is null or length(coalesce(v_texto, '')) > 500 then
            raise exception 'mensaje_invalido';
        end if;
        if (select count(*) from chat_adjuntos where creado_por = auth.uid() and creado_en > now() - interval '1 hour') >= 30 then
            raise exception 'demasiados_adjuntos';
        end if;
        if p_tipo = 'foto' then
            -- ~1,1 MB por foto (el navegador la reduce antes de enviarla) y miniatura ~60 KB
            if not private._chat_foto_ok(v_datos, 1500000) or (v_mini is not null and not private._chat_foto_ok(v_mini, 80000))
               or coalesce((p_adjunto ->> 'ancho')::int, 1) not between 1 and 8000 or coalesce((p_adjunto ->> 'alto')::int, 1) not between 1 and 8000 then
                raise exception 'adjunto_invalido';
            end if;
            v_mime := substring(v_datos from '^data:([^;]+);');
            if p_cita is not null then
                -- «Referencia para mi corte»: solo el cliente, con una cita próxima suya
                if v_rol <> 'cliente' then
                    raise exception 'mensaje_invalido';
                end if;
                v_ref := private._chat_cita_de(v_conv, p_cita, v_rol);
                if not private._chat_cita_proxima(v_ref) then
                    raise exception 'cita_no_proxima';
                end if;
            end if;
        else
            -- Nota de voz: hasta 3 minutos (~2,2 MB)
            if p_cita is not null or not private._chat_audio_ok(v_datos, 3000000)
               or coalesce((p_adjunto ->> 'duracion_ms')::int, 0) not between 300 and 180000 then
                raise exception 'adjunto_invalido';
            end if;
            v_mime := substring(v_datos from '^data:([^;]+(;codecs=[^;]+)?);');
            v_mini := null;
        end if;
    elsif p_tipo = 'cita' then
        if length(coalesce(v_texto, '')) > 500 or p_adjunto is not null then
            raise exception 'mensaje_invalido';
        end if;
        v_cita := private._chat_cita_de(v_conv, p_cita, v_rol);
    elsif p_tipo = 'solicitud_cambio' then
        -- Registro en el chat cuando la cita ya no admite cambios desde la web
        if v_rol <> 'cliente' or v_texto is null or length(v_texto) not between 3 and 1000 or p_adjunto is not null then
            raise exception 'mensaje_invalido';
        end if;
        v_cita := private._chat_cita_de(v_conv, p_cita, v_rol);
    else
        raise exception 'mensaje_invalido';
    end if;

    if p_tipo in ('foto', 'audio') then
        insert into chat_adjuntos (conversacion_id, tipo, mime, datos, miniatura, ancho, alto, duracion_ms, bytes, referencia_cita_id, referencia_en, creado_por)
        values (v_conv.id, p_tipo, v_mime, v_datos, v_mini,
                case when p_tipo = 'foto' then (p_adjunto ->> 'ancho')::int end, case when p_tipo = 'foto' then (p_adjunto ->> 'alto')::int end,
                case when p_tipo = 'audio' then (p_adjunto ->> 'duracion_ms')::int end,
                (length(split_part(v_datos, ',', 2)) * 3) / 4, v_ref, case when v_ref is not null then now() end, auth.uid())
        returning id into v_adjunto;
    end if;
    begin
        insert into chat_mensajes (conversacion_id, clave, autor_rol, autor_user_id, autor_barbero_id, tipo, texto, adjunto_id, cita_id)
        values (v_conv.id, p_clave, v_rol, auth.uid(), case when v_rol = 'barbero' then barbero_actual() end, p_tipo, v_texto, v_adjunto, v_cita)
        returning * into v_msg;
    exception when unique_violation then
        -- Dos envíos simultáneos del mismo mensaje: queda uno solo (el adjunto sobrante no se referencia y se borra)
        delete from chat_adjuntos where id = v_adjunto;
        select * into v_msg from chat_mensajes where conversacion_id = v_conv.id and clave = p_clave;
        return private._chat_mensaje_json(v_msg, v_rol, v_conv.cliente_nombre);
    end;
    update chat_conversaciones set ultimo_mensaje_id = v_msg.id, ultimo_mensaje_en = v_msg.creado_en,
           ultimo_autor = case when v_rol = 'cliente' then 'cliente' else 'equipo' end
     where id = v_conv.id;
    -- Lo propio cuenta como leído
    insert into chat_lecturas (conversacion_id, user_id, ultimo_leido) values (v_conv.id, auth.uid(), v_msg.id)
    on conflict (conversacion_id, user_id) do update set ultimo_leido = greatest(chat_lecturas.ultimo_leido, excluded.ultimo_leido), actualizado_en = now();
    if v_rol = 'cliente' then
        perform private._chat_avisar(v_conv, v_msg);
        if v_ref is not null then
            perform private._chat_avisar_referencia(v_conv, v_adjunto, v_ref);
        end if;
    end if;
    return private._chat_mensaje_json(v_msg, v_rol, v_conv.cliente_nombre);
end;
$$;

-- Marca como leído hasta p_hasta (y, para el personal, los avisos de esta conversación)
create or replace function public.chat_leer(p_conversacion uuid, p_hasta bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._chat_rol(p_conversacion);
    v_hasta bigint := least(coalesce(p_hasta, 0), coalesce((select max(id) from chat_mensajes where conversacion_id = p_conversacion), 0));
begin
    insert into chat_lecturas (conversacion_id, user_id, ultimo_leido) values (p_conversacion, auth.uid(), v_hasta)
    on conflict (conversacion_id, user_id) do update set ultimo_leido = greatest(chat_lecturas.ultimo_leido, excluded.ultimo_leido), actualizado_en = now();
    if v_rol <> 'cliente' then
        update notificaciones set leida_en = now()
         where user_id = auth.uid() and leida_en is null and tipo = 'chat_mensaje' and datos ->> 'conversacion' = p_conversacion::text;
        update push_envios set estado = 'omitido', actualizado_en = now()
         where estado = 'pendiente' and notificacion_id in (select id from notificaciones where user_id = auth.uid() and leida_en is not null
                                                             and tipo = 'chat_mensaje' and datos ->> 'conversacion' = p_conversacion::text);
    end if;
    return jsonb_build_object('no_leidos', private._chat_no_leidos(p_conversacion, v_rol));
end;
$$;

-- Foto o audio completo (o la miniatura): solo para quien puede ver la conversación o, si la foto es
-- referencia de una cita, para el barbero asignado a esa cita y la administración.
create or replace function public.chat_adjunto(p_id uuid, p_variante text default 'completa') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a chat_adjuntos;
    v_rol text;
    v_permitido boolean := false;
begin
    if auth.uid() is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into a from chat_adjuntos where id = p_id;
    if not found then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    begin
        perform private._chat_rol(a.conversacion_id);
        v_permitido := true;
    exception when others then
        v_permitido := false;
    end;
    if not v_permitido and a.referencia_cita_id is not null and a.tipo = 'foto' then
        v_rol := _rol_panel();
        if v_rol is not null then
            v_rol := _exigir_panel();
            v_permitido := v_rol = 'admin' or exists (select 1 from citas where id::text = a.referencia_cita_id and barbero_id::text = barbero_actual());
        end if;
    end if;
    if not v_permitido then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return jsonb_build_object('id', a.id, 'tipo', a.tipo, 'mime', a.mime,
        'datos', case when p_variante = 'miniatura' and a.miniatura is not null then a.miniatura else a.datos end);
end;
$$;

-- «Referencia para mi corte»: el cliente vincula (o quita, p_cita null) una foto SUYA a una cita próxima suya
create or replace function public.chat_referencia(p_adjunto uuid, p_cita text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a chat_adjuntos;
    v_conv chat_conversaciones;
    v_cita text;
begin
    select * into a from chat_adjuntos where id = p_adjunto;
    if not found or a.tipo <> 'foto' or a.creado_por is distinct from auth.uid() then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if private._chat_rol(a.conversacion_id) <> 'cliente' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into v_conv from chat_conversaciones where id = a.conversacion_id;
    if p_cita is not null then
        v_cita := private._chat_cita_de(v_conv, p_cita, 'cliente');
        if not private._chat_cita_proxima(v_cita) then
            raise exception 'cita_no_proxima';
        end if;
    end if;
    update chat_adjuntos set referencia_cita_id = v_cita, referencia_en = case when v_cita is null then null else now() end where id = a.id;
    if v_cita is not null and v_cita is distinct from a.referencia_cita_id then
        perform private._chat_avisar_referencia(v_conv, a.id, v_cita);
    end if;
    return jsonb_build_object('adjunto', a.id, 'referencia', private._chat_cita_json(v_cita, 'cliente'));
end;
$$;

-- ==========================================
-- 8. PANEL: BANDEJA, ASIGNACIÓN Y RESPUESTAS RÁPIDAS
-- ==========================================
-- Bandeja. Administrador: todas. Barbero: solo las asignadas a él.
-- p_filtro: todas | sin_responder (lo último lo escribió el cliente) | asignadas | sin_asignar
create or replace function public.panel_chat_bandeja(p_filtro text default 'todas', p_buscar text default null,
                                                     p_limite int default 30, p_antes timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() end;
    v_buscar text := nullif(btrim(coalesce(p_buscar, '')), '');
    v_patron text;
    v_limite int := least(greatest(coalesce(p_limite, 30), 1), 50);
begin
    if v_rol = 'barbero' and v_barbero is null then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if v_buscar is not null then
        v_patron := '%' || replace(replace(replace(left(v_buscar, 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    end if;
    return jsonb_build_object('items', coalesce((
        select jsonb_agg(x.item order by x.orden desc nulls last, x.creado desc)
          from (select c.ultimo_mensaje_en orden, c.creado_en creado, jsonb_build_object(
                    'id', c.id, 'cliente', c.cliente_nombre,
                    'correo', case when v_rol = 'admin' then (select email from auth.users where id = c.cliente_user_id) end,
                    'barbero_id', c.barbero_id, 'barbero', (select nombre from barberos where id::text = c.barbero_id),
                    'ultimo_en', c.ultimo_mensaje_en, 'ultimo_autor', c.ultimo_autor,
                    'vista_previa', (select private._chat_vista_previa(m) from chat_mensajes m where m.id = c.ultimo_mensaje_id),
                    'no_leidos', (select count(*) from chat_mensajes m where m.conversacion_id = c.id and m.autor_rol = 'cliente'
                                     and m.id > coalesce((select ultimo_leido from chat_lecturas l where l.conversacion_id = c.id and l.user_id = auth.uid()), 0)),
                    'proxima_cita', (select jsonb_build_object('fecha', ci.fecha, 'hora', to_char(ci.hora, 'HH24:MI'), 'servicio', s.nombre)
                                       from citas ci left join servicios s on s.id = ci.servicio_id
                                      where ci.cliente_user_id = c.cliente_user_id and ci.estado <> 'cancelada' and ci.completada_en is null
                                        and ci.fecha >= _ahora_local()::date order by ci.fecha, ci.hora limit 1)) item
                  from chat_conversaciones c
                 where c.ultimo_mensaje_id is not null
                   and (v_barbero is null or c.barbero_id = v_barbero)
                   and (p_antes is null or c.ultimo_mensaje_en < p_antes)
                   and case coalesce(p_filtro, 'todas') when 'sin_responder' then c.ultimo_autor = 'cliente'
                                                        when 'asignadas' then c.barbero_id is not null
                                                        when 'sin_asignar' then c.barbero_id is null
                                                        else true end
                   and (v_patron is null or c.cliente_nombre ilike v_patron
                        or (v_rol = 'admin' and exists (select 1 from auth.users u where u.id = c.cliente_user_id and u.email ilike v_patron)))
                 order by c.ultimo_mensaje_en desc nulls last
                 limit v_limite) x), '[]'::jsonb),
        'rol', v_rol);
end;
$$;

-- Conversaciones con mensajes del cliente sin leer (para el contador del menú)
create or replace function public.panel_chat_no_leidos() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text := case when v_rol = 'barbero' then barbero_actual() end;
begin
    return (select count(*) from chat_conversaciones c
             where (v_rol = 'admin' or c.barbero_id = v_barbero)
               and exists (select 1 from chat_mensajes m where m.conversacion_id = c.id and m.autor_rol = 'cliente'
                              and m.id > coalesce((select ultimo_leido from chat_lecturas l where l.conversacion_id = c.id and l.user_id = auth.uid()), 0)));
end;
$$;

-- Cabecera de la conversación en el panel: cliente, asignación, citas próximas para compartir y barberos
create or replace function public.panel_chat_conversacion(p_conversacion uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := private._chat_rol(p_conversacion);
    v chat_conversaciones;
begin
    if v_rol = 'cliente' then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    select * into v from chat_conversaciones where id = p_conversacion;
    return jsonb_build_object('id', v.id, 'cliente', v.cliente_nombre, 'rol', v_rol,
        'correo', case when v_rol = 'admin' then (select email from auth.users where id = v.cliente_user_id) end,
        'barbero_id', v.barbero_id, 'barbero', (select nombre from barberos where id::text = v.barbero_id),
        'citas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id::text, 'fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'),
                                                               'servicio', s.nombre, 'barbero', b.nombre, 'estado', c.estado) order by c.fecha, c.hora)
                             from citas c left join servicios s on s.id = c.servicio_id left join barberos b on b.id = c.barbero_id
                            where c.cliente_user_id = v.cliente_user_id and c.estado <> 'cancelada' and c.completada_en is null
                              and c.no_asistio_en is null and c.fecha >= _ahora_local()::date), '[]'::jsonb),
        'barberos', case when v_rol = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', b.id::text, 'nombre', b.nombre) order by b.nombre)
                                                               from barberos b where b.activo is not false), '[]'::jsonb) end);
end;
$$;

-- Asignar o reasignar (solo administración). p_barbero null: sin asignar.
create or replace function public.panel_chat_asignar(p_conversacion uuid, p_barbero text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v chat_conversaciones;
    v_nombre text;
    v_msg chat_mensajes;
    v_user uuid;
begin
    perform _exigir_panel(true);
    select * into v from chat_conversaciones where id = p_conversacion for update;
    if not found then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    if p_barbero is not null then
        select nombre into v_nombre from barberos where id::text = p_barbero and activo is not false;
        if v_nombre is null then
            raise exception 'barbero_no_disponible';
        end if;
    end if;
    if v.barbero_id is not distinct from p_barbero then
        return jsonb_build_object('barbero_id', v.barbero_id, 'barbero', v_nombre, 'sin_cambios', true);
    end if;
    update chat_conversaciones set barbero_id = p_barbero, asignada_por = auth.uid(), asignada_en = now() where id = v.id;
    insert into chat_mensajes (conversacion_id, clave, autor_rol, tipo, texto)
    values (v.id, gen_random_uuid(), 'sistema', 'asignacion',
            case when p_barbero is null then 'La barbería te atenderá en esta conversación.' else v_nombre || ' te atenderá en esta conversación.' end)
    returning * into v_msg;
    update chat_conversaciones set ultimo_mensaje_id = v_msg.id, ultimo_mensaje_en = v_msg.creado_en,
           ultimo_autor = case when ultimo_autor = 'cliente' then 'cliente' else 'sistema' end
     where id = v.id;
    -- El barbero anterior deja de ver el contenido de sus avisos de esta conversación
    if v.barbero_id is not null then
        update notificaciones set cuerpo = 'Esta conversación se asignó a otro profesional.', datos = '{}'::jsonb
         where tipo in ('chat_mensaje', 'chat_asignada') and datos ->> 'conversacion' = v.id::text
           and user_id in (select user_id from barbero_usuarios where barbero_id = v.barbero_id);
    end if;
    if p_barbero is not null then
        for v_user in select bu.user_id from barbero_usuarios bu where bu.barbero_id = p_barbero and bu.acceso_activo loop
            perform private._notificar(v_user, 'chat-asignada:' || v.id || ':' || v_msg.id, 'chat_asignada', 'Conversación asignada a ti',
                                       'Cliente: ' || v.cliente_nombre, null, jsonb_build_object('seccion', 'conversaciones', 'conversacion', v.id));
        end loop;
    end if;
    perform _auditar('chat_asignar', 'chat_conversacion', v.id::text, jsonb_build_object('antes', v.barbero_id, 'despues', p_barbero));
    return jsonb_build_object('barbero_id', p_barbero, 'barbero', v_nombre);
end;
$$;

create or replace function public.panel_chat_respuestas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform _exigir_panel();
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto) order by orden, actualizado_en) from chat_respuestas_rapidas), '[]'::jsonb);
end;
$$;

-- Reemplaza la lista completa (solo administración): hasta 20 respuestas de 1 a 500 caracteres
create or replace function public.panel_chat_respuestas_guardar(p_textos text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_textos text[];
begin
    perform _exigir_panel(true);
    select coalesce(array_agg(btrim(t) order by n), '{}') into v_textos
      from unnest(coalesce(p_textos, '{}')) with ordinality u (t, n) where nullif(btrim(t), '') is not null;
    if cardinality(v_textos) > 20 or exists (select 1 from unnest(v_textos) t where length(t) > 500) then
        raise exception 'respuestas_invalidas';
    end if;
    delete from chat_respuestas_rapidas;
    insert into chat_respuestas_rapidas (texto, orden, actualizado_por)
    select t, n, auth.uid() from unnest(v_textos) with ordinality u (t, n);
    perform _auditar('chat_respuestas', 'chat_respuestas_rapidas', null, jsonb_build_object('total', cardinality(v_textos)));
    return public.panel_chat_respuestas();
end;
$$;

-- Fotos de referencia del chat vinculadas a una cita (mismos permisos que el detalle de la cita)
create or replace function public.panel_cita_chat_referencias(p_cita text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol text := _exigir_panel();
    v_barbero text;
begin
    select barbero_id::text into v_barbero from citas where id::text = p_cita;
    if not found or (v_rol = 'barbero' and v_barbero is distinct from barbero_actual()) then
        raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'miniatura', a.miniatura, 'ancho', a.ancho, 'alto', a.alto,
                                                         'texto', m.texto, 'creado_en', a.creado_en) order by a.referencia_en)
                       from chat_adjuntos a left join chat_mensajes m on m.adjunto_id = a.id
                      where a.referencia_cita_id = p_cita and a.tipo = 'foto'), '[]'::jsonb);
end;
$$;

-- ==========================================
-- 9. SEGURIDAD
-- ==========================================
do $$
declare
    v_tabla text;
    v_fn regprocedure;
begin
    foreach v_tabla in array array['chat_conversaciones', 'chat_mensajes', 'chat_adjuntos', 'chat_lecturas', 'chat_respuestas_rapidas'] loop
        execute format('alter table public.%I enable row level security', v_tabla);
        execute format('revoke all on public.%I from anon, authenticated', v_tabla);
    end loop;
    -- Solo con sesión (cliente con cuenta o personal); cada función comprueba el papel en la conversación
    for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('chat_mi_conversacion', 'chat_mensajes', 'chat_novedades', 'chat_enviar',
                       'chat_leer', 'chat_adjunto', 'chat_referencia', 'panel_chat_bandeja', 'panel_chat_no_leidos', 'panel_chat_conversacion',
                       'panel_chat_asignar', 'panel_chat_respuestas', 'panel_chat_respuestas_guardar', 'panel_cita_chat_referencias') loop
        execute format('revoke all on function %s from public, anon, authenticated', v_fn);
        execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
end $$;

revoke all on function private._chat_rol(uuid) from public, anon, authenticated;
revoke all on function private._chat_conversacion_cliente(boolean) from public, anon, authenticated;
revoke all on function private._chat_cita_de(public.chat_conversaciones, text, text) from public, anon, authenticated;
revoke all on function private._chat_cita_proxima(text) from public, anon, authenticated;
revoke all on function private._chat_cita_json(text, text) from public, anon, authenticated;
revoke all on function private._chat_vista_previa(public.chat_mensajes) from public, anon, authenticated;
revoke all on function private._chat_mensaje_json(public.chat_mensajes, text, text) from public, anon, authenticated;
revoke all on function private._chat_no_leidos(uuid, text) from public, anon, authenticated;
revoke all on function private._chat_cabecera(text) from public, anon, authenticated;
revoke all on function private._chat_foto_ok(text, int) from public, anon, authenticated;
revoke all on function private._chat_audio_ok(text, int) from public, anon, authenticated;
revoke all on function private._chat_destinatarios(public.chat_conversaciones) from public, anon, authenticated;
revoke all on function private._chat_avisar(public.chat_conversaciones, public.chat_mensajes) from public, anon, authenticated;
revoke all on function private._chat_avisar_referencia(public.chat_conversaciones, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
