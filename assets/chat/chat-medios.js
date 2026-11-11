// ==========================================
// CHAT: fotos, notas de voz y envío con progreso
// Las fotos se reducen en el dispositivo (JPEG ~1600 px + miniatura) antes de subirlas; el servidor vuelve
// a validar tipo real y tamaño. Las notas de voz usan MediaRecorder con el formato que admita el navegador
// (WebM/Opus en Chrome, Edge y Firefox; MP4/AAC en Safari).
// ==========================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from '../config.js';

export const MAX_AUDIO_MS = 180000;      // 3 minutos (mismo límite que el servidor)
const MAX_FOTO = 1450000;                // caracteres del data URL (el servidor admite 1 500 000)
const MAX_MINI = 76000;

// ---------- Fotos ----------
function leerComoURL(blob) {
    return new Promise((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(lector.result);
        lector.onerror = () => mal(lector.error);
        lector.readAsDataURL(blob);
    });
}

async function decodificar(archivo) {
    // createImageBitmap respeta la orientación EXIF de las fotos del móvil
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch { /* se intenta con <img> */ }
    }
    const url = URL.createObjectURL(archivo);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
    } finally { URL.revokeObjectURL(url); }
}

function dibujar(fuente, lado, calidad) {
    const ancho0 = fuente.width || fuente.naturalWidth;
    const alto0 = fuente.height || fuente.naturalHeight;
    const escala = Math.min(1, lado / Math.max(ancho0, alto0));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(ancho0 * escala));
    lienzo.height = Math.max(1, Math.round(alto0 * escala));
    const g = lienzo.getContext('2d');
    g.fillStyle = '#fff';            // PNG con transparencia: fondo blanco al pasar a JPEG
    g.fillRect(0, 0, lienzo.width, lienzo.height);
    g.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    return { datos: lienzo.toDataURL('image/jpeg', calidad), ancho: lienzo.width, alto: lienzo.height };
}

// Devuelve { datos, miniatura, ancho, alto } listo para chat_enviar. Error con .codigo = 'formato' si no se puede leer.
export async function prepararFoto(archivo) {
    if (!archivo || !/^image\//.test(archivo.type || 'image/')) throw Object.assign(new Error('Elige una imagen (JPG, PNG o WebP).'), { codigo: 'formato' });
    if (archivo.size > 40 * 1024 * 1024) throw Object.assign(new Error('La imagen es demasiado grande (máximo 40 MB).'), { codigo: 'tamano' });
    let fuente;
    try { fuente = await decodificar(archivo); }
    catch { throw Object.assign(new Error('No se pudo leer esa imagen en este dispositivo. Prueba con una foto JPG o PNG.'), { codigo: 'formato' }); }
    let foto;
    for (const [lado, calidad] of [[1600, 0.82], [1400, 0.75], [1200, 0.7], [1000, 0.65]]) {
        foto = dibujar(fuente, lado, calidad);
        if (foto.datos.length <= MAX_FOTO) break;
    }
    let mini = dibujar(fuente, 360, 0.62);
    if (mini.datos.length > MAX_MINI) mini = dibujar(fuente, 240, 0.55);
    fuente.close?.();
    if (foto.datos.length > MAX_FOTO) throw Object.assign(new Error('La imagen es demasiado pesada incluso reducida.'), { codigo: 'tamano' });
    return { datos: foto.datos, miniatura: mini.datos, ancho: foto.ancho, alto: foto.alto };
}

// ---------- Notas de voz ----------
const TIPOS_AUDIO = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2'];

export function compatibilidadAudio() {
    if (typeof window === 'undefined') return { grabar: false, motivo: 'sin_navegador' };
    if (!window.isSecureContext) return { grabar: false, motivo: 'inseguro' };
    if (!navigator.mediaDevices?.getUserMedia) return { grabar: false, motivo: 'sin_api' };
    if (typeof window.MediaRecorder !== 'function') return { grabar: false, motivo: 'sin_api' };
    const tipo = TIPOS_AUDIO.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
    return { grabar: true, tipo };
}

export const MENSAJES_MICROFONO = {
    permiso: 'No hay permiso para usar el micrófono. Actívalo en los ajustes del navegador (ícono del candado junto a la dirección) y vuelve a intentarlo.',
    sin_microfono: 'No se encontró un micrófono en este dispositivo.',
    ocupado: 'El micrófono está en uso por otra aplicación. Ciérrala y vuelve a intentarlo.',
    inseguro: 'Las notas de voz solo funcionan en una conexión segura (https).',
    sin_api: 'Este navegador no permite grabar notas de voz. Puedes escribir un mensaje o actualizar el navegador.',
    corta: 'La nota de voz es demasiado corta.',
    error: 'No se pudo grabar la nota de voz. Inténtalo de nuevo.'
};

// Graba hasta MAX_AUDIO_MS. alTick(ms) cada 200 ms; alLimite() si se alcanza el máximo.
export async function iniciarGrabacion({ alTick, alLimite } = {}) {
    const comp = compatibilidadAudio();
    if (!comp.grabar) throw Object.assign(new Error(MENSAJES_MICROFONO[comp.motivo]), { codigo: comp.motivo });
    let flujo;
    try {
        flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
        const codigo = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(e?.name) ? 'permiso'
            : ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(e?.name) ? 'sin_microfono'
            : ['NotReadableError', 'TrackStartError', 'AbortError'].includes(e?.name) ? 'ocupado' : 'error';
        throw Object.assign(new Error(MENSAJES_MICROFONO[codigo]), { codigo });
    }
    const opciones = { audioBitsPerSecond: 48000 };
    if (comp.tipo) opciones.mimeType = comp.tipo;
    let grabador;
    try { grabador = new MediaRecorder(flujo, opciones); }
    catch { grabador = new MediaRecorder(flujo); }
    const partes = [];
    grabador.ondataavailable = e => { if (e.data?.size) partes.push(e.data); };
    const inicio = performance.now();
    let pausa = 0;
    const reloj = setInterval(() => {
        const ms = performance.now() - inicio - pausa;
        alTick?.(ms);
        if (ms >= MAX_AUDIO_MS) { alLimite?.(); }
    }, 200);
    const apagar = () => { clearInterval(reloj); flujo.getTracks().forEach(t => t.stop()); };
    grabador.start(1000);
    return {
        detener: () => new Promise((ok, mal) => {
            const duracion = Math.min(MAX_AUDIO_MS, Math.round(performance.now() - inicio - pausa));
            grabador.onstop = () => {
                apagar();
                const tipo = (grabador.mimeType || comp.tipo || partes[0]?.type || 'audio/webm').replace(/\s+/g, '');
                const blob = new Blob(partes, { type: tipo });
                if (duracion < 700 || !blob.size) return mal(Object.assign(new Error(MENSAJES_MICROFONO.corta), { codigo: 'corta' }));
                ok({ blob, duracion_ms: duracion, tipo });
            };
            try { grabador.state === 'inactive' ? grabador.onstop() : grabador.stop(); } catch { apagar(); mal(new Error(MENSAJES_MICROFONO.error)); }
        }),
        cancelar: () => { try { grabador.onstop = null; if (grabador.state !== 'inactive') grabador.stop(); } catch { /* ya detenido */ } apagar(); }
    };
}

// data URL del audio con el tipo normalizado (sin espacios: «audio/ogg; codecs=opus» → «audio/ogg;codecs=opus»)
export async function audioADataURL(blob, tipo) {
    const url = await leerComoURL(blob);
    const base64 = String(url).split(',')[1] || '';
    const limpio = String(tipo || blob.type || 'audio/webm').replace(/\s+/g, '').replace(/;codecs=$/, '');
    return `data:${limpio};base64,${base64}`;
}

// Un data URL servido por el chat → URL local reproducible/visible (se libera al cerrar)
export async function dataURLaObjeto(dataURL) {
    const [cabecera, base64] = String(dataURL).split(',');
    const tipo = (cabecera.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const binario = atob(base64 || '');
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: tipo }));
}

// ---------- Envío con progreso real de subida ----------
// supabase-js no informa del progreso: los envíos con adjunto usan XMLHttpRequest contra la misma RPC
// (mismas cabeceras, misma sesión y mismos permisos en el servidor).
export async function rpcConProgreso(cliente, funcion, argumentos, alProgreso) {
    const sesion = (await cliente.auth.getSession()).data.session;
    if (!sesion) throw new Error('JWT: sesión no iniciada');
    return new Promise((ok, mal) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${SUPABASE_URL}/rest/v1/rpc/${funcion}`);
        xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
        xhr.setRequestHeader('Authorization', `Bearer ${sesion.access_token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Content-Profile', SUPABASE_SCHEMA);
        xhr.setRequestHeader('Accept-Profile', SUPABASE_SCHEMA);
        xhr.timeout = 120000;
        xhr.upload.onprogress = e => { if (e.lengthComputable) alProgreso?.(e.loaded / e.total); };
        xhr.onload = () => {
            let cuerpo = null;
            try { cuerpo = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* respuesta no JSON */ }
            if (xhr.status >= 200 && xhr.status < 300) ok(cuerpo);
            else mal(Object.assign(new Error(cuerpo?.message || `HTTP ${xhr.status}`), { status: xhr.status }));
        };
        xhr.onerror = () => mal(Object.assign(new Error('Failed to fetch'), { red: true }));
        xhr.ontimeout = () => mal(Object.assign(new Error('Failed to fetch'), { red: true }));
        xhr.send(JSON.stringify(argumentos));
    });
}
