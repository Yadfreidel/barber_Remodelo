// Webhook de WhatsApp Cloud API: respuestas de botones (confirmar, cancelar, reprogramar,
// aceptar oferta, baja). Valida la firma de Meta y procesa cada evento una sola vez.
// Desplegar con: supabase functions deploy whatsapp-webhook --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verificarFirma, extraerEventos, telefonoInternacional } from '../_shared/whatsapp.js';

const API_META = 'https://graph.facebook.com/v21.0';

const RESPUESTAS: Record<string, string> = {
    confirmar: 'Gracias, tu asistencia quedó confirmada.',
    cancelar: 'Tu cita fue cancelada.',
    aceptar: 'Listo, el espacio es tuyo. Te esperamos.',
    baja: 'Te dimos de baja de los mensajes promocionales.'
};

async function responderTexto(telefono: string, texto: string) {
    const tokenMeta = Deno.env.get('WHATSAPP_TOKEN');
    const telefonoId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    if (Deno.env.get('WHATSAPP_ENVIO_HABILITADO') !== 'true' || !tokenMeta || !telefonoId) return;
    await fetch(`${API_META}/${telefonoId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenMeta}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: telefonoInternacional(telefono), type: 'text', text: { body: texto } })
    }).catch(() => {});
}

Deno.serve(async (req) => {
    const url = new URL(req.url);

    // Verificación de suscripción de Meta
    if (req.method === 'GET') {
        const tokenVerificacion = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
        if (tokenVerificacion && url.searchParams.get('hub.mode') === 'subscribe'
            && url.searchParams.get('hub.verify_token') === tokenVerificacion) {
            return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
        }
        return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const cuerpoCrudo = await req.text();
    if (!(await verificarFirma(cuerpoCrudo, req.headers.get('X-Hub-Signature-256'), Deno.env.get('WHATSAPP_APP_SECRET') ?? ''))) {
        return new Response('firma invalida', { status: 401 });
    }

    let cuerpo: unknown;
    try {
        cuerpo = JSON.parse(cuerpoCrudo);
    } catch {
        return new Response('json invalido', { status: 400 });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    for (const evento of extraerEventos(cuerpo)) {
        const { data, error } = await supabase.rpc('whatsapp_procesar_evento', {
            p_evento_id: evento.id, p_telefono: evento.telefono, p_payload: evento.payload
        });
        // Error de base: 500 para que Meta reintente; el id del evento evita reprocesar
        if (error) return new Response('error', { status: 500 });
        if (!data || data.duplicado || data.error) continue;
        if (data.accion === 'reprogramar' && data.enlace) {
            await responderTexto(evento.telefono, `Elige tu nuevo horario aquí: ${data.enlace}`);
        } else if (RESPUESTAS[data.accion]) {
            await responderTexto(evento.telefono, RESPUESTAS[data.accion]);
        }
    }
    return new Response('ok', { status: 200 });
});
