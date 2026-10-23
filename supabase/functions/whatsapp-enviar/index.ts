// Envía la cola de mensajes_whatsapp por WhatsApp Cloud API.
// Invocada cada minuto por pg_cron + pg_net (ver supabase/cron.example.sql).
// Desplegar con: supabase functions deploy whatsapp-enviar --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { esErrorReintentable } from '../_shared/whatsapp.js';
import { enviarConTarjeta } from '../_shared/appointment-notification.js';
import { datosTarjeta } from '../../../assets/appointment-card.js';
import { cargarLogoTarjeta } from '../../../assets/card-logo.js';
import { generarPng } from './render-card.ts';

const API_META = 'https://graph.facebook.com/v21.0';

const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    const secretoCron = Deno.env.get('CRON_SECRET');
    if (!secretoCron || req.headers.get('Authorization') !== `Bearer ${secretoCron}`) {
        return json({ error: 'no_autorizado' }, 401);
    }

    const tokenMeta = Deno.env.get('WHATSAPP_TOKEN');
    const telefonoId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    // Doble interruptor: variable de entorno + módulo activo en la base (whatsapp_reclamar)
    if (Deno.env.get('WHATSAPP_ENVIO_HABILITADO') !== 'true' || !tokenMeta || !telefonoId) {
        return json({ enviados: 0, motivo: 'envio_deshabilitado_o_sin_credenciales' });
    }

    // Barbería vive en el esquema "barberia" del proyecto compartido
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'barberia' } });
    const { data: config } = await supabase.from('modulos_config').select('ajustes').eq('modulo', 'whatsapp').single();
    const { data: general } = await supabase.from('modulos_config').select('ajustes').eq('modulo', 'general').single();
    const opciones = {
        idioma: config?.ajustes?.idioma ?? 'es', codigoPais: config?.ajustes?.codigo_pais ?? '1',
        plantillaImagen: Deno.env.get('WHATSAPP_PLANTILLA_TARJETA') || '',
        plantillaTexto: Deno.env.get('WHATSAPP_PLANTILLA_TARJETA_TEXTO') || ''
    };

    const { data: mensajes, error } = await supabase.rpc('whatsapp_reclamar', { p_limite: 20 });
    if (error) return json({ error: error.message }, 500);

    let enviados = 0;
    for (const mensaje of mensajes ?? []) {
        try {
            const resultado = await enviarConTarjeta({
                mensaje, opciones,
                cargarDatos: async () => {
                    const { data: cita, error } = await supabase.from('citas')
                        .select('id,nombre_cliente,fecha,hora,estado,completada_en,servicios(nombre),barberos(nombre)')
                        .eq('id', mensaje.cita_id).single();
                    if (error || !cita) throw new Error('No se pudo leer la cita guardada');
                    if (cita.estado === 'cancelada') return { cancelada: true };
                    const { data: acceso } = await supabase.from('cita_tokens').select('token').eq('cita_id', String(cita.id)).single();
                    const servicio = Array.isArray(cita.servicios) ? cita.servicios[0] : cita.servicios;
                    const barbero = Array.isArray(cita.barberos) ? cita.barberos[0] : cita.barberos;
                    const datos = datosTarjeta({ ...cita, servicios: undefined, servicio: servicio?.nombre, barbero: barbero?.nombre }, {
                        zonaHoraria: general?.ajustes?.zona_horaria,
                        urlPublica: general?.ajustes?.url_publica,
                        token: acceso?.token
                    });
                    return { ...datos, logoData: await cargarLogoTarjeta(datos.logo, general?.ajustes?.url_publica) };
                },
                generarPng,
                subirMedia: async (png: Uint8Array) => {
                    const form = new FormData();
                    form.set('messaging_product', 'whatsapp');
                    form.set('type', 'image/png');
                    form.set('file', new Blob([new Uint8Array(png).buffer], { type: 'image/png' }), 'cita.png');
                    const respuesta = await fetch(`${API_META}/${telefonoId}/media`, {
                        method: 'POST', headers: { Authorization: `Bearer ${tokenMeta}` }, body: form,
                        signal: AbortSignal.timeout(15000)
                    });
                    const cuerpo = await respuesta.json();
                    if (!respuesta.ok || !cuerpo.id) throw new Error('No se pudo subir la tarjeta');
                    return cuerpo.id;
                },
                enviar: async (payload: unknown) => {
                    const respuesta = await fetch(`${API_META}/${telefonoId}/messages`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${tokenMeta}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
                    });
                    const cuerpo = await respuesta.json().catch(() => ({}));
                    return { ok: respuesta.ok, status: respuesta.status, codigo: cuerpo?.error?.code,
                        proveedorId: cuerpo?.messages?.[0]?.id ?? null };
                }
            });
            if (resultado.omitido) {
                await supabase.from('mensajes_whatsapp').update({ estado: 'omitido', ultimo_error: 'cita_cancelada' }).eq('id', mensaje.id);
            } else if (resultado.ok) {
                enviados++;
                await supabase.rpc('whatsapp_resultado', { p_id: mensaje.id, p_ok: true, p_proveedor_id: resultado.proveedorId });
            } else {
                await supabase.rpc('whatsapp_resultado', {
                    p_id: mensaje.id, p_ok: false, p_error: `Meta HTTP ${resultado.status}, codigo ${resultado.codigo ?? 'desconocido'}`,
                    // Con tarjeta, un error 5xx puede ocultar una entrega: no repetir.
                    p_reintentable: opciones.plantillaImagen && mensaje.tipo === 'recordatorio'
                        ? resultado.status === 429 : esErrorReintentable(resultado.status)
                });
            }
        } catch (e) {
            // Sin respuesta no se sabe si Meta lo entregó: no se reintenta para no duplicar
            await supabase.rpc('whatsapp_resultado', { p_id: mensaje.id, p_ok: false, p_error: 'envio_incierto_sin_reintento', p_reintentable: false });
        }
    }
    return json({ reclamados: mensajes?.length ?? 0, enviados });
});
