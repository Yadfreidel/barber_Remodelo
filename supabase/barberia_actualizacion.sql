-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema `barberia`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta 20261027000000_portafolio_ocupacion_reclamaciones.sql).
-- Aplica solo estas migraciones nuevas, trasladadas a barberia:
--   20261028000000_cuentas_permisos_notificaciones.sql
-- y vuelve a aplicar los permisos mínimos. No toca `public`, `private` ni Auth.
-- Conserva todas las citas. Una sola transacción: si algo falla, no cambia nada.
-- Es seguro ejecutarlo más de una vez. Una instalación nueva usa base_completa.sql.
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

do $$
begin
    if to_regclass('barberia.citas') is null then
        raise exception 'Barbería no está instalada en barberia: ejecuta primero supabase/base_completa.sql';
    end if;
end $$;

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
        if v_nombre = any (array['config_publica', 'listar_productos', 'cotizar_cita', 'horarios_disponibles', 'reservar_cita', 'consultar_cita', 'confirmar_cita', 'cancelar_cita', 'horarios_reprogramacion', 'cotizar_reprogramacion', 'reprogramar_cita', 'unirse_lista_espera', 'consultar_lista_espera', 'cancelar_lista_espera', 'consultar_oferta', 'aceptar_oferta', 'rechazar_oferta', 'mi_codigo_referido', 'darse_de_baja', 'catalogo_publico', 'barberos_publicos', 'negocio_publico', 'ubicacion_publica', 'horarios_dia_publico', 'mis_citas_por_tokens', 'portafolio_publico', 'portafolio_imagen', 'reclamacion_categorias_publicas', 'reclamacion_crear', 'reclamacion_consultar', 'reclamacion_adjunto', 'reclamacion_responder', 'mis_reclamaciones_por_tokens']) then
            execute format('grant execute on function %s to anon, authenticated', v_fn);
        elsif v_nombre = any (array['es_admin', 'rol_panel', 'barbero_actual', 'mis_citas', 'vincular_citas', 'mis_reclamaciones', 'solicitud_profesional_estado', 'solicitud_profesional_crear', 'push_suscribir', 'push_desuscribir']) or v_nombre like 'panel\_%' or v_nombre like 'admin\_%' then
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
   set ajustes = ajustes || jsonb_build_object('url_publica', 'https://yadfreidel.github.io/barber_Remodelo/')
 where modulo = 'general';

-- ADMINISTRADOR: solo en barberia.admin_usuarios (independiente de otras aplicaciones).
-- Requiere el usuario en Authentication > Users; si aún no existe no hace nada.
insert into barberia.admin_usuarios (user_id)
select id from auth.users where lower(email) = lower('yafre2310@gmail.com')
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

commit;

select 'Actualizado: ' || (select count(*) from barberia.citas) || ' citas conservadas; horario '
       || (select (ajustes ->> 'hora_apertura') || '–' || (ajustes ->> 'hora_cierre') || ' cada ' || (ajustes ->> 'intervalo_minutos') || ' min'
             from barberia.modulos_config where modulo = 'general') as estado_actualizacion;
