-- =====================================================================
-- COMPROBACIONES DE LA INSTALACIÓN DE BARBERÍA (esquema barberia)
-- Solo lectura: no modifica nada. Ejecuta cada bloque en el SQL Editor de Supabase.
-- En cada bloque se indica el resultado esperado.
-- =====================================================================

-- 1) Resumen general. Esperado: tablas >= 27, tablas_sin_rls = 0, funciones_para_public = 0,
--    funciones_sin_search_path = 0, privado_expuesto = false, admin_configurado = true
select
    (select count(*) from pg_tables where schemaname = 'barberia') as tablas,
    (select count(*) from pg_tables where schemaname = 'barberia' and not rowsecurity) as tablas_sin_rls,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('barberia', 'barberia_private') and has_function_privilege('public', p.oid, 'execute')) as funciones_para_public,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('barberia', 'barberia_private')
        and not ('search_path=barberia, pg_temp' = any (coalesce(p.proconfig, '{}')))) as funciones_sin_search_path,
    has_schema_privilege('anon', 'barberia_private', 'usage') or has_schema_privilege('authenticated', 'barberia_private', 'usage') as privado_expuesto,
    exists (select 1 from barberia.admin_usuarios) as admin_configurado;

-- 2) Tablas: RLS y permisos de los roles de la API.
--    Esperado: rls = true en todas. anon solo SELECT en barberos y servicios (datos públicos del catálogo);
--    ninguna tabla con datos personales (citas, clientes, cita_tokens...) legible por anon.
select t.tablename,
       t.rowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = 'barberia' and p.tablename = t.tablename) as politicas,
       concat_ws(',', case when has_table_privilege('anon', format('barberia.%I', t.tablename), 'select') then 'SELECT' end,
                      case when has_table_privilege('anon', format('barberia.%I', t.tablename), 'insert') then 'INSERT' end,
                      case when has_table_privilege('anon', format('barberia.%I', t.tablename), 'update') then 'UPDATE' end,
                      case when has_table_privilege('anon', format('barberia.%I', t.tablename), 'delete') then 'DELETE' end) as anon,
       concat_ws(',', case when has_table_privilege('authenticated', format('barberia.%I', t.tablename), 'select') then 'SELECT' end,
                      case when has_table_privilege('authenticated', format('barberia.%I', t.tablename), 'insert') then 'INSERT' end,
                      case when has_table_privilege('authenticated', format('barberia.%I', t.tablename), 'update') then 'UPDATE' end,
                      case when has_table_privilege('authenticated', format('barberia.%I', t.tablename), 'delete') then 'DELETE' end) as authenticated
  from pg_tables t
 where t.schemaname = 'barberia'
 order by t.tablename;

-- 3) Políticas RLS (revisión: las de citas y tablas de gestión exigen es_admin() o barbero_actual())
select tablename, policyname, roles, cmd, qual, with_check
  from pg_policies where schemaname = 'barberia' order by tablename, policyname;

-- 4) Funciones: quién puede ejecutarlas.
--    Esperado: reservas/consultas públicas -> anon y authenticated; panel_* y admin_* -> solo authenticated
--    (y verifican el rol dentro); whatsapp_* y tareas -> solo service_role; el resto (internas) -> nadie.
select p.oid::regprocedure as funcion,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as seguridad,
       array_to_string(p.proconfig, ' ') as configuracion,
       concat_ws(',', case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
                      case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end,
                      case when has_function_privilege('service_role', p.oid, 'execute') then 'service_role' end) as pueden_ejecutar
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('barberia', 'barberia_private')
 order by pueden_ejecutar desc, p.oid::regprocedure::text;

-- 5) Datos iniciales. Esperado: 3 barberos, 25 cortes de catálogo, 7 módulos, 4 plantillas
select (select count(*) from barberia.barberos) as barberos,
       (select count(*) from barberia.servicios where catalogo_id is not null) as cortes_catalogo,
       (select count(*) from barberia.modulos_config) as modulos,
       (select count(*) from barberia.plantillas_whatsapp) as plantillas,
       (select ajustes ->> 'zona_horaria' from barberia.modulos_config where modulo = 'general') as zona_horaria;

-- 6) Administradores de barbería (independientes de cualquier otra aplicación)
select u.email, a.creado_en from barberia.admin_usuarios a join auth.users u on u.id = a.user_id;

-- 7) Prueba funcional como visitante anónimo (no guarda nada: termina con rollback).
--    Esperado: catálogo 25, barberos 3 y una lista de horas libres.
begin;
set local role anon;
select jsonb_array_length(barberia.catalogo_publico()) as catalogo,
       jsonb_array_length(barberia.barberos_publicos()) as barberos,
       barberia.horarios_disponibles('corte-01', (select nombre from barberia.barberos order by id limit 1), current_date + 3) as horas_libres;
rollback;

-- 8) Objetos con nombres de barbería que existan en public (p. ej. si antes se ejecutó la versión
--    antigua en public). Solo lista para revisión MANUAL: no borres nada sin confirmar que no es de otra app.
select c.relname as tabla_en_public
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in (select tablename from pg_tables where schemaname = 'barberia');
