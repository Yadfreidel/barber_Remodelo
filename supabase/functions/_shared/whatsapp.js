// Lógica pura de WhatsApp Cloud API (Meta), compartida por las Edge Functions.
// Sin dependencias: funciona en Deno (Supabase) y en Node (pruebas).

const codificador = new TextEncoder();

function aHex(buffer) {
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function igualdadConstante(a, b) {
    if (a.length !== b.length) return false;
    let diferencia = 0;
    for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferencia === 0;
}

// Valida X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, cuerpo crudo)
export async function verificarFirma(cuerpoCrudo, cabeceraFirma, secreto) {
    if (!secreto || !cabeceraFirma || !cabeceraFirma.startsWith('sha256=')) return false;
    const clave = await crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(cuerpoCrudo));
    return igualdadConstante('sha256=' + aHex(firma), cabeceraFirma);
}

export function telefonoInternacional(telefono, codigoPais = '1') {
    const digitos = String(telefono || '').replace(/\D/g, '');
    return digitos.length === 10 ? codigoPais + digitos : digitos;
}

// Mensaje de la cola (mensajes_whatsapp) -> cuerpo de la API de Meta con plantilla aprobada
export function construirPlantilla(mensaje, { idioma = 'es', codigoPais = '1' } = {}) {
    const componentes = [];
    const parametros = mensaje.parametros || [];
    if (parametros.length) {
        componentes.push({ type: 'body', parameters: parametros.map(texto => ({ type: 'text', text: String(texto ?? '') })) });
    }
    (mensaje.botones || []).forEach((payload, indice) => {
        componentes.push({ type: 'button', sub_type: 'quick_reply', index: String(indice), parameters: [{ type: 'payload', payload }] });
    });
    return {
        messaging_product: 'whatsapp',
        to: telefonoInternacional(mensaje.telefono, codigoPais),
        type: 'template',
        template: { name: mensaje.plantilla, language: { code: idioma }, components: componentes }
    };
}

// Extrae respuestas del cliente del webhook (botón de plantilla, botón interactivo o texto)
export function extraerEventos(cuerpo) {
    const eventos = [];
    for (const entrada of cuerpo?.entry || []) {
        for (const cambio of entrada.changes || []) {
            for (const msg of cambio.value?.messages || []) {
                let payload = null;
                if (msg.type === 'button') payload = msg.button?.payload;
                else if (msg.type === 'interactive') payload = msg.interactive?.button_reply?.id;
                else if (msg.type === 'text') payload = String(msg.text?.body || '').trim().toUpperCase();
                if (msg.id && msg.from && payload) eventos.push({ id: msg.id, telefono: msg.from, payload });
            }
        }
    }
    return eventos;
}

// Solo se reintenta cuando Meta indica límite o error temporal; ante dudas no se reenvía
export function esErrorReintentable(status) {
    return status === 429 || status >= 500;
}
