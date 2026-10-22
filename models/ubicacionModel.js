// ==========================================
// PERSISTENCIA DE LA UBICACIÓN
// - Con Supabase configurado: configuración compartida en el servidor
//   (lectura pública, guardado solo para administradores con sesión).
// - Sin Supabase: localStorage. SOLO persiste en este navegador y NO
//   se sincroniza con otros dispositivos (modo demostración).
// ==========================================

import { supabase, estaSupabaseListo, obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { validarUbicacion } from './ubicacionValidacion.js';

const STORAGE_KEY = 'barber_ubicacion_local';

const MENSAJES = {
    no_autorizado: 'Tu cuenta no tiene permisos de administrador.',
    sesion_admin_requerida: 'Inicia sesión como administrador para guardar la ubicación.',
    ubicacion_nombre_invalido: 'El nombre del local no es válido.',
    ubicacion_direccion_invalida: 'La dirección no es válida.',
    ubicacion_referencia_invalida: 'La referencia es demasiado larga.',
    ubicacion_coordenadas_invalidas: 'Las coordenadas no son válidas.',
    datos_invalidos: 'Revisa los campos marcados.'
};

export function mensajeErrorUbicacion(error) {
    const texto = error?.message || '';
    const clave = Object.keys(MENSAJES).find(k => texto.includes(k));
    return clave ? MENSAJES[clave] : 'No se pudo completar la operación. Intenta de nuevo.';
}

export function modoPersistenciaUbicacion() {
    return estaSupabaseListo() ? 'servidor' : 'local';
}

function leerLocal() {
    try {
        const guardado = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!guardado) return null;
        const { ok, valor } = validarUbicacion(guardado);
        return ok ? { ...valor, actualizado_en: guardado.actualizado_en || null } : null;
    } catch (e) {
        return null;
    }
}

// null = todavía no configurada. Lanza error si el servidor no responde.
export async function obtenerUbicacion() {
    if (modoPersistenciaUbicacion() === 'local') return leerLocal();
    const { data, error } = await supabase.rpc('ubicacion_publica');
    if (error) throw error;
    return data || null;
}

export async function guardarUbicacion(datos) {
    const { ok, valor } = validarUbicacion(datos);
    if (!ok) throw new Error('datos_invalidos');

    if (modoPersistenciaUbicacion() === 'local') {
        const registro = { ...valor, actualizado_en: new Date().toISOString() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registro));
        return registro;
    }

    const admin = obtenerClienteAdmin();
    const { data: { session } } = await admin.auth.getSession();
    if (!session) throw new Error('sesion_admin_requerida');
    const { data, error } = await admin.rpc('admin_guardar_ubicacion', {
        p_nombre: valor.nombre,
        p_direccion: valor.direccion,
        p_referencia: valor.referencia,
        p_latitud: valor.latitud,
        p_longitud: valor.longitud
    });
    if (error) throw error;
    return data;
}

// Solo modo local: otras pestañas de ESTE navegador (evento storage)
export function escucharCambiosLocalesUbicacion(callback) {
    if (modoPersistenciaUbicacion() !== 'local') return;
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) callback();
    });
}
