-- =====================================================================
-- Unicidad de agenda solo para citas NO canceladas.
--
-- Si citas tiene un UNIQUE simple (barbero_id, fecha, hora), un horario
-- cancelado nunca puede volver a reservarse, aunque la web lo muestra libre.
-- La lista de espera y la reprogramación lo necesitan.
-- Se reemplaza por un índice único parcial con el MISMO nombre, así que el
-- anti double-booking y el mensaje de error que detecta el cliente no cambian.
-- Si ya existe un índice parcial, no hace nada.
-- =====================================================================
do $$
declare
    v_nombre text;
begin
    select con.conname into v_nombre
      from pg_constraint con
     where con.conrelid = 'public.citas'::regclass
       and con.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k) = array['barbero_id', 'fecha', 'hora'];

    if v_nombre is not null then
        execute format('alter table public.citas drop constraint %I', v_nombre);
        execute format('create unique index %I on public.citas (barbero_id, fecha, hora) where estado <> %L', v_nombre, 'cancelada');
    elsif not exists (
        select 1 from pg_index i
         where i.indrelid = 'public.citas'::regclass and i.indisunique
           and (select array_agg(a.attname::text order by a.attname)
                  from unnest(i.indkey) k
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k) = array['barbero_id', 'fecha', 'hora']
    ) then
        create unique index citas_barbero_id_fecha_hora_key on public.citas (barbero_id, fecha, hora) where estado <> 'cancelada';
    end if;
end $$;
