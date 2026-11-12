-- ==========================================
-- PANTALLA DE TURNOS: FILA SIN CITA Y CITAS DE HOY
-- Aditiva y compatible: no crea tablas ni columnas; los turnos y citas existentes no cambian.
--   1. private._cita_codigo(): el código público de la cita que ya existía («referencia» del comprobante,
--      p. ej. C-00412). Es estable y lo tienen también las citas antiguas. Solo se muestra; ninguna función lo
--      acepta para consultar o modificar una cita (eso sigue exigiendo el token privado).
--   2. consultar_cita(): igual que antes, más «referencia» (el detalle de la cita del cliente muestra el código).
--   3. fila_pantalla(): igual que antes, más dos listas de solo lectura para la TV:
--        «espera»: código, estado, turnos delante y minutos estimados (los cálculos de la Fila virtual);
--        «citas»:  código, hora reservada, estado y silla (solo si está en atención).
--      Sin nombres, teléfonos, fotos, notas, identificadores internos ni tokens.
-- ==========================================

-- ==========================================
-- 1. CÓDIGO PÚBLICO DE LA CITA (el mismo del comprobante)
-- ==========================================
create or replace function private._cita_codigo(p_cita text) returns text
language sql immutable set search_path = public, pg_temp as $$
    select case when p_cita ~ '^\d+$' then 'C-' || lpad(p_cita, 5, '0') else 'C-' || upper(left(p_cita, 8)) end
$$;

-- ==========================================
-- 2. DETALLE DE LA CITA PARA SU CLIENTE (con el token): añade «referencia»
-- ==========================================
create or replace function public.consultar_cita(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
        'referencia', private._cita_codigo(v.id::text),
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

-- ==========================================
-- 3. PANTALLA DE LA TV (pública, solo lectura)
-- ==========================================
-- Turnos en espera, en el orden de la Fila virtual (llegada), con los mismos cálculos que ve cada cliente:
-- «delante» = turnos anteriores que compiten por algún mismo barbero; «minutos» = inicio estimado por la
-- simulación (respeta el barbero elegido, los servicios en curso y las citas). Sin estimación: null.
create or replace function private._pantalla_espera(p_ahora timestamp) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'codigo', t.codigo, 'estado', t.estado,
               'delante', private._fila_delante(t),
               'minutos', case when s.inicio is not null then greatest(0, ceil(extract(epoch from s.inicio - p_ahora) / 60)::int) end)
             order by t.creado_en, t.numero), '[]'::jsonb)
      from fila_turnos t
      left join private._fila_simulacion(p_ahora) s on s.turno_id = t.id
     where t.fecha = p_ahora::date and t.estado = 'en_espera'
$$;

-- Citas confirmadas de hoy que siguen vigentes (sin canceladas, terminadas ni «no asistió»), por hora.
-- estado: reservada | llego | en_atencion (los mismos hitos que registra «Atención»).
create or replace function private._pantalla_citas(p_ahora timestamp) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'codigo', private._cita_codigo(c.id::text),
               'hora', to_char(c.hora, 'HH24:MI'),
               'estado', case when c.iniciada_en is not null then 'en_atencion' when c.llegada_en is not null then 'llego' else 'reservada' end,
               'silla', case when c.iniciada_en is not null then private._fila_silla(c.barbero_id::text) end)
             order by c.hora, c.id), '[]'::jsonb)
      from citas c
     where c.fecha = p_ahora::date and c.estado = 'confirmada'
       and c.completada_en is null and c.no_asistio_en is null
$$;

-- Igual que la versión anterior (llamados, en_espera, recepción y URL del QR) más «fecha», «espera» y «citas».
create or replace function public.fila_pantalla() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ahora timestamp;
begin
    perform private._fila_vencer();
    v_ahora := private._fila_ahora();
    return jsonb_build_object(
        'ahora', v_ahora,
        'fecha', v_ahora::date,
        'recepcion_abierta', (select recepcion_abierta from fila_config),
        'url_publica', (select url_publica from fila_config),
        'en_espera', (select count(*) from fila_turnos where fecha = v_ahora::date and estado = 'en_espera'),
        'llamados', coalesce((select jsonb_agg(jsonb_build_object(
                'clave', md5(t.id::text || ':' || t.llamadas), 'codigo', t.codigo, 'estado', t.estado,
                'silla', private._fila_silla(t.barbero_atiende), 'llamado_en', t.llamado_en) order by t.llamado_en desc)
            from fila_turnos t where t.fecha = v_ahora::date and t.estado = 'llamado' and t.llamado_hasta > v_ahora), '[]'::jsonb),
        'espera', private._pantalla_espera(v_ahora),
        'citas', private._pantalla_citas(v_ahora));
end;
$$;

-- ==========================================
-- 4. SEGURIDAD (los permisos públicos de consultar_cita y fila_pantalla no cambian)
-- ==========================================
revoke all on function private._cita_codigo(text) from public, anon, authenticated;
revoke all on function private._pantalla_espera(timestamp) from public, anon, authenticated;
revoke all on function private._pantalla_citas(timestamp) from public, anon, authenticated;

notify pgrst, 'reload schema';
