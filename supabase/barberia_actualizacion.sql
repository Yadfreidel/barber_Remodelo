-- =====================================================================
-- ACTUALIZACIÓN DE BARBERÍA (esquema `barberia`)
-- (generado con: npm run base:completa — no editar a mano)
--
-- Para un proyecto que YA ejecutó supabase/base_completa.sql (hasta 20261023120000_fotos_barberos.sql).
-- Aplica solo estas migraciones nuevas, trasladadas a barberia:
--   20261024000000_mis_citas_horarios_30.sql
--   20261026000000_inventario_ventas_caja.sql
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

select 'Actualizado: ' || (select count(*) from barberia.citas) || ' citas conservadas; horario '
       || (select (ajustes ->> 'hora_apertura') || '–' || (ajustes ->> 'hora_cierre') || ' cada ' || (ajustes ->> 'intervalo_minutos') || ' min'
             from barberia.modulos_config where modulo = 'general') as estado_actualizacion;
