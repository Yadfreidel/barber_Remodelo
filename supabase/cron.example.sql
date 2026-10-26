-- Tareas programadas (NO se aplica automáticamente: requiere datos del proyecto).
-- 1. Activa las extensiones pg_cron y pg_net en Supabase (Database > Extensions).
-- 2. Reemplaza <PROYECTO> y <CRON_SECRET> y ejecuta en el SQL Editor.

-- Vence ofertas de lista de espera, programa recordatorios y recuperación (solo SQL)
select cron.schedule('barberia-tareas', '* * * * *', $$ select barberia.procesar_tareas_programadas() $$);

-- Envía la cola de WhatsApp (la función no envía nada si WHATSAPP_ENVIO_HABILITADO no es 'true')
select cron.schedule('barberia-whatsapp-envio', '* * * * *', $$
    select net.http_post(
        url := 'https://<PROYECTO>.supabase.co/functions/v1/whatsapp-enviar',
        headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
        body := '{}'::jsonb
    )
$$);

-- Para desactivar:
-- select cron.unschedule('barberia-tareas');
-- select cron.unschedule('barberia-whatsapp-envio');

-- Avisos push de citas a los barberos (la función no envía nada sin las claves VAPID)
select cron.schedule('barberia-push-envio', '* * * * *', $$
    select net.http_post(
        url := 'https://<PROYECTO>.supabase.co/functions/v1/push-enviar',
        headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
        body := '{}'::jsonb
    )
$$);
-- select cron.unschedule('barberia-push-envio');
