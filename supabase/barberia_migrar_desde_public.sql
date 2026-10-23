-- =====================================================================
-- MIGRAR DATOS DE BARBERÍA DE public A barberia (procedimiento aparte)
--
-- Solo para una base que YA tenía barbería instalada en public (versión anterior).
-- Requisitos: 1) barberia instalado con base_completa.sql;  2) barberia aún sin citas.
-- Qué hace: copia filas de public.<tabla> a barberia.<tabla> conservando ids (los enlaces
-- de "Gestionar mi cita" siguen funcionando), sin ejecutar triggers (no re-valida ni audita
-- citas pasadas) y ajusta las secuencias. Las columnas que no existan en public toman su
-- valor por defecto. La configuración nueva que no exista en public se conserva.
-- NO modifica ni borra nada en public. Todo en una transacción.
-- Retirar después los objetos antiguos de public es un paso MANUAL y revisado: nunca
-- borres tablas o funciones de public sin comprobar que no las usa otra aplicación.
-- =====================================================================
begin;

do $$
declare
    -- Orden por dependencias (claves foráneas)
    v_tablas text[] := array['barberos', 'servicios', 'admin_usuarios', 'citas', 'cita_tokens', 'clientes_contacto',
        'mensajes_whatsapp', 'webhook_eventos', 'lista_espera', 'ofertas_espera', 'referidos_codigos', 'referidos', 'beneficios',
        'productos', 'cita_productos', 'promociones', 'ubicacion_local', 'horarios_semana', 'descansos', 'bloqueos',
        'servicio_barberos', 'barbero_usuarios', 'clientes', 'negocio_config', 'auditoria'];
    v_tabla text;
    v_columnas text;
    v_filas bigint;
    v_identidad record;
begin
    if to_regclass('public.citas') is null or to_regclass('public.barberos') is null then
        raise exception 'No hay una instalación anterior de barbería en public: no hay nada que migrar';
    end if;
    if to_regclass('barberia.citas') is null then
        raise exception 'Primero instala barberia con supabase/base_completa.sql';
    end if;
    if exists (select 1 from barberia.citas) then
        raise exception 'barberia.citas ya tiene datos: la migración solo se hace una vez, sobre una instalación nueva';
    end if;

    foreach v_tabla in array v_tablas || array['modulos_config', 'plantillas_whatsapp'] loop
        execute format('alter table barberia.%I disable trigger user', v_tabla);
    end loop;

    -- Los datos iniciales de la instalación nueva se reemplazan por los de public
    execute 'truncate ' || (select string_agg(format('barberia.%I', t), ', ') from unnest(v_tablas) t) || ' restart identity cascade';

    foreach v_tabla in array v_tablas loop
        continue when to_regclass(format('public.%I', v_tabla)) is null;
        select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_columnas
          from information_schema.columns c
         where c.table_schema = 'barberia' and c.table_name = v_tabla and c.is_generated = 'NEVER'
           and exists (select 1 from information_schema.columns p
                        where p.table_schema = 'public' and p.table_name = v_tabla and p.column_name = c.column_name);
        execute format('insert into barberia.%I (%s) overriding system value select %s from public.%I', v_tabla, v_columnas, v_columnas, v_tabla);
        get diagnostics v_filas = row_count;
        raise notice 'barberia.%: % filas', v_tabla, v_filas;
    end loop;

    -- Configuración: los valores de public ganan, sin perder ajustes nuevos
    if to_regclass('public.modulos_config') is not null then
        insert into barberia.modulos_config (modulo, activo, ajustes, actualizado_en)
        select modulo, activo, ajustes, actualizado_en from public.modulos_config
        on conflict (modulo) do update set activo = excluded.activo,
            ajustes = barberia.modulos_config.ajustes || excluded.ajustes, actualizado_en = excluded.actualizado_en;
    end if;
    if to_regclass('public.plantillas_whatsapp') is not null then
        insert into barberia.plantillas_whatsapp (tipo, texto, meta_plantilla, actualizado_en)
        select tipo, texto, meta_plantilla, actualizado_en from public.plantillas_whatsapp
        on conflict (tipo) do update set texto = excluded.texto, meta_plantilla = excluded.meta_plantilla, actualizado_en = excluded.actualizado_en;
    end if;

    -- Las nuevas filas continúan después de los ids copiados
    for v_identidad in select table_name, column_name from information_schema.columns
                        where table_schema = 'barberia' and is_identity = 'YES' loop
        execute format('select setval(pg_get_serial_sequence(%L, %L), greatest(coalesce((select max(%I) from barberia.%I), 0), 1), (select count(*) > 0 from barberia.%I))',
                       'barberia.' || v_identidad.table_name, v_identidad.column_name, v_identidad.column_name,
                       v_identidad.table_name, v_identidad.table_name);
    end loop;

    foreach v_tabla in array v_tablas || array['modulos_config', 'plantillas_whatsapp'] loop
        execute format('alter table barberia.%I enable trigger user', v_tabla);
    end loop;
end $$;

commit;

select (select count(*) from barberia.citas) as citas_migradas,
       (select count(*) from barberia.barberos) as barberos,
       (select count(*) from barberia.servicios) as servicios,
       (select count(*) from barberia.admin_usuarios) as administradores;
