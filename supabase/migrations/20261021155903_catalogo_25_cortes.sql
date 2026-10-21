-- Solo nuevos estilos. Las filas anteriores y las citas existentes no se actualizan.
alter table public.servicios add column if not exists catalogo_id text;
create unique index if not exists servicios_catalogo_id_key on public.servicios(catalogo_id);
insert into public.servicios (catalogo_id, nombre, precio, duracion_minutos) values
    ('corte-01','Degradado bajo rizado',600,40),
    ('corte-02','Degradado medio rizado',600,40),
    ('corte-03','Degradado alto rizado',600,40),
    ('corte-04','Taper bajo natural',550,35),
    ('corte-05','Taper medio rizado',600,40),
    ('corte-06','Burst fade rizado',700,45),
    ('corte-07','Drop fade rizado',650,45),
    ('corte-08','Degradado en V',650,45),
    ('corte-09','Crop francés rizado',600,40),
    ('corte-10','César texturizado',500,30),
    ('corte-11','Buzz cut degradado',450,30),
    ('corte-12','Crew cut texturizado',500,30),
    ('corte-13','Afro corto redondo',600,40),
    ('corte-14','Afro medio con taper',700,50),
    ('corte-15','High top rizado',750,50),
    ('corte-16','Frohawk rizado',750,50),
    ('corte-17','Mullet rizado suave',800,60),
    ('corte-18','Mohicano rizado',750,50),
    ('corte-19','Rizos con flequillo',650,45),
    ('corte-20','Rizos messy',650,45),
    ('corte-21','Quiff rizado',700,45),
    ('corte-22','Undercut rizado',700,45),
    ('corte-23','Raya lateral marcada',650,45),
    ('corte-24','Diseño doble en la sien',700,50),
    ('corte-25','Flat top texturizado',750,50)
on conflict (catalogo_id) do nothing;

-- Mantiene los nombres anteriores y admite identificadores de los nuevos estilos.
create or replace function public._resolver_servicio(p_nombre text) returns text
language sql stable set search_path = public, pg_temp as $$
    select id::text from servicios
    where nombre = p_nombre or (catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre))
    order by case when catalogo_id is not null and (id::text = p_nombre or catalogo_id = p_nombre) then 0 else 1 end, id
    limit 1
$$;

-- Instantanea solo para las citas de los nuevos cortes; no cambia citas anteriores.
alter table public.citas add column if not exists duracion_reservada int check (duracion_reservada > 0);
create or replace function public._slot_libre(p_barbero_id text, p_fecha date, p_hora time, p_duracion int, p_excluir_cita text default null)
returns boolean language sql stable set search_path = public, pg_temp as $$
    select not exists (
        select 1 from citas c left join servicios s on s.id::text = c.servicio_id::text
        where c.barbero_id::text = p_barbero_id and c.fecha = p_fecha and c.estado <> 'cancelada'
          and (p_excluir_cita is null or c.id::text <> p_excluir_cita)
          and c.hora < p_hora + make_interval(mins => p_duracion)
          and p_hora < c.hora + make_interval(mins => coalesce(c.duracion_reservada, s.duracion_minutos, 30))
    )
$$;

create schema if not exists private;
revoke all on schema private from public;
create or replace function private.citas_duracion_catalogo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_duracion int;
    v_catalogo text;
    v_validar boolean;
begin
    select s.duracion_minutos, s.catalogo_id into v_duracion, v_catalogo
      from servicios s where s.id = new.servicio_id for share;
    if v_catalogo is null then
        if tg_op = 'INSERT' then new.duracion_reservada := null;
        else new.duracion_reservada := old.duracion_reservada; end if;
        return new;
    end if;
    if tg_op = 'INSERT' then
        new.duracion_reservada := v_duracion;
        v_validar := true;
    else
        new.duracion_reservada := case when new.servicio_id = old.servicio_id
            then coalesce(old.duracion_reservada, v_duracion) else v_duracion end;
        v_validar := (new.barbero_id, new.servicio_id, new.fecha, new.hora) is distinct from
                     (old.barbero_id, old.servicio_id, old.fecha, old.hora)
                     or (old.estado = 'cancelada' and new.estado <> 'cancelada');
    end if;
    if new.estado <> 'cancelada' and v_validar then
        perform _bloquear_agenda(new.barbero_id::text, new.fecha);
        if not _en_horario(new.hora, new.duracion_reservada)
           or not _slot_libre(new.barbero_id::text, new.fecha, new.hora, new.duracion_reservada, new.id::text) then
            raise exception 'horario_no_disponible' using errcode = '23505';
        end if;
    end if;
    return new;
end;
$$;
revoke all on function private.citas_duracion_catalogo() from public, anon, authenticated;
drop trigger if exists citas_catalogo25_duracion on public.citas;
create trigger citas_catalogo25_duracion before insert or update on public.citas
    for each row execute function private.citas_duracion_catalogo();

-- Edicion de tarifas: misma autenticacion y lista de administradores existentes.
-- SECURITY INVOKER + RLS: el RPC no tiene privilegios adicionales del propietario.
grant update(precio, duracion_minutos) on public.servicios to authenticated;
drop policy if exists admin_tarifa_catalogo on public.servicios;
create policy admin_tarifa_catalogo on public.servicios for update to authenticated
    using (catalogo_id is not null and (select public.es_admin()))
    with check (catalogo_id is not null and (select public.es_admin()));
create or replace function public.admin_actualizar_corte(p_catalogo_id text, p_precio numeric, p_duracion int)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_resultado jsonb;
begin
    if not public.es_admin() then raise exception 'no_autorizado' using errcode = '42501'; end if;
    if p_precio is null or p_precio < 0 or p_precio > 99999999 or p_duracion is null or p_duracion not between 1 and 480 then
        raise exception 'tarifa_invalida';
    end if;
    update public.servicios set precio = p_precio, duracion_minutos = p_duracion where catalogo_id = p_catalogo_id
    returning jsonb_build_object('id', id, 'catalogo_id', catalogo_id, 'precio', precio, 'duracion_minutos', duracion_minutos) into v_resultado;
    if v_resultado is null then raise exception 'corte_no_encontrado'; end if;
    return v_resultado;
end;
$$;
revoke all on function public.admin_actualizar_corte(text,numeric,int) from public, anon, authenticated;
grant execute on function public.admin_actualizar_corte(text,numeric,int) to authenticated;
