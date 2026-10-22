// ==========================================
// VALIDACIÓN DE LA UBICACIÓN (sin dependencias del navegador)
// Las mismas reglas se aplican en el servidor (admin_guardar_ubicacion).
// ==========================================

export const LIMITES_UBICACION = { nombre: 120, direccion: 250, referencia: 250 };

function aNumero(valor) {
    if (typeof valor === 'number') return valor;
    const texto = String(valor ?? '').trim().replace(',', '.');
    return texto === '' ? NaN : Number(texto);
}

// Devuelve { ok, errores: { campo: mensaje }, valor } con los datos normalizados
export function validarUbicacion(datos = {}) {
    const errores = {};
    const nombre = String(datos.nombre ?? '').trim();
    const direccion = String(datos.direccion ?? '').trim();
    const referencia = String(datos.referencia ?? '').trim();
    const latitud = aNumero(datos.latitud);
    const longitud = aNumero(datos.longitud);

    if (!nombre) errores.nombre = 'Escribe el nombre del local.';
    else if (nombre.length > LIMITES_UBICACION.nombre) errores.nombre = `Máximo ${LIMITES_UBICACION.nombre} caracteres.`;
    if (!direccion) errores.direccion = 'Escribe la dirección.';
    else if (direccion.length > LIMITES_UBICACION.direccion) errores.direccion = `Máximo ${LIMITES_UBICACION.direccion} caracteres.`;
    if (referencia.length > LIMITES_UBICACION.referencia) errores.referencia = `Máximo ${LIMITES_UBICACION.referencia} caracteres.`;

    if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90) errores.latitud = 'La latitud debe estar entre -90 y 90.';
    if (!Number.isFinite(longitud) || longitud < -180 || longitud > 180) errores.longitud = 'La longitud debe estar entre -180 y 180.';
    if (!errores.latitud && !errores.longitud && latitud === 0 && longitud === 0) {
        errores.latitud = 'Coloca el marcador en el mapa (0, 0 no es una ubicación válida).';
    }

    const ok = Object.keys(errores).length === 0;
    return {
        ok,
        errores,
        valor: ok ? {
            nombre, direccion, referencia,
            latitud: Math.round(latitud * 1e6) / 1e6,
            longitud: Math.round(longitud * 1e6) / 1e6
        } : null
    };
}

// Abre Google Maps con indicaciones hacia las coordenadas guardadas
export function urlComoLlegar(ubicacion) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${ubicacion.latitud},${ubicacion.longitud}`)}`;
}

// Identifica una versión de la ubicación para detectar cambios entre consultas
export function firmaUbicacion(u) {
    return u ? [u.nombre, u.direccion, u.referencia || '', Number(u.latitud), Number(u.longitud)].join('|') : '';
}
