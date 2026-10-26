// Envía la cola push_envios por Web Push (VAPID). Invocada cada minuto por pg_cron + pg_net
// (ver supabase/cron.example.sql). El aviso interno ya está guardado: si esto falla, no se pierde nada.
// Mensaje discreto: sin datos del cliente (los da la app tras iniciar sesión).
// Secretos: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… o https://…).
// Desplegar con: supabase functions deploy push-enviar --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    const secreto = Deno.env.get('CRON_SECRET');
    if (!secreto || req.headers.get('Authorization') !== `Bearer ${secreto}`) return json({ error: 'no_autorizado' }, 401);
    const publica = Deno.env.get('VAPID_PUBLIC_KEY');
    const privada = Deno.env.get('VAPID_PRIVATE_KEY');
    const sujeto = Deno.env.get('VAPID_SUBJECT');
    if (!publica || !privada || !sujeto) return json({ enviados: 0, motivo: 'sin_claves_vapid' });
    webpush.setVapidDetails(sujeto, publica, privada);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'barberia' } });
    const { data: lote, error } = await supabase.rpc('push_reclamar', { p_limite: 50 });
    if (error) return json({ error: error.message }, 500);

    let enviados = 0;
    for (const envio of lote ?? []) {
        let resultado = 'ok';
        let detalle: string | null = null;
        try {
            await webpush.sendNotification(
                { endpoint: envio.endpoint, keys: { p256dh: envio.p256dh, auth: envio.auth } },
                JSON.stringify({ titulo: envio.titulo, cuerpo: envio.cuerpo, etiqueta: envio.etiqueta, url: envio.url }),
                { TTL: 3600, urgency: 'high' }
            );
            enviados++;
        } catch (e) {
            const estado = (e as { statusCode?: number }).statusCode ?? 0;
            // 404/410: la suscripción ya no existe (permiso retirado o navegador reinstalado)
            resultado = estado === 404 || estado === 410 ? 'vencida' : estado === 429 || estado >= 500 || estado === 0 ? 'reintentar' : 'fallido';
            detalle = `HTTP ${estado}`;
        }
        await supabase.rpc('push_resultado', { p_id: envio.id, p_resultado: resultado, p_error: detalle });
    }
    return json({ enviados, procesados: lote?.length ?? 0 });
});
