// Solo imágenes de la propia web, sin credenciales ni redirecciones.
export async function cargarLogoTarjeta(ruta, base, fetchImpl = fetch) {
    if (!ruta || !base) return '';
    try {
        const origen = new URL(base);
        const url = new URL(ruta, origen);
        if (url.origin !== origen.origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return '';
        if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return '';
        const respuesta = await fetchImpl(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!respuesta.ok || !respuesta.body || Number(respuesta.headers.get('content-length')) > 1048576) return '';
        const lector = respuesta.body.getReader();
        const trozos = [];
        let longitud = 0;
        try {
            while (true) {
                const { done, value } = await lector.read();
                if (done) break;
                longitud += value.length;
                if (longitud > 1048576) { await lector.cancel(); return ''; }
                trozos.push(value);
            }
        } finally { lector.releaseLock(); }
        const bytes = new Uint8Array(longitud);
        let posicion = 0;
        for (const trozo of trozos) { bytes.set(trozo, posicion); posicion += trozo.length; }
        const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!png && !jpeg) return '';
        let binario = '';
        for (const byte of bytes) binario += String.fromCharCode(byte);
        return `data:image/${png ? 'png' : 'jpeg'};base64,${btoa(binario)}`;
    } catch { return ''; }
}
