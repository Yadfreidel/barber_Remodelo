import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let supabaseClient = null;

const URL_POR_DEFECTO = "https://tu-proyecto.supabase.co";
const KEY_POR_DEFECTO = "tu-anon-key-aqui";

const estaConfigurado = 
    Boolean(SUPABASE_URL) && 
    Boolean(SUPABASE_ANON_KEY) && 
    SUPABASE_URL !== URL_POR_DEFECTO && 
    SUPABASE_ANON_KEY !== KEY_POR_DEFECTO;

if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    if (estaConfigurado) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.warn("⚠️ Supabase aún no está configurado en assets/config.js. Por favor, coloca tu URL y ANON KEY.");
    }
} else if (estaConfigurado) {
    console.error("❌ El SDK de Supabase no está cargado en window.supabase. Verifica la etiqueta script CDN en index.html.");
}

export const supabase = supabaseClient;

export function estaSupabaseListo() {
    return Boolean(supabaseClient);
}

// Cliente separado para la sesión de administrador (Supabase Auth).
// Usa otra storageKey para que el cliente público siga actuando como anon.
let adminClient = null;

export function obtenerClienteAdmin() {
    if (!adminClient && estaConfigurado && typeof window !== 'undefined' && window.supabase) {
        adminClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { storageKey: 'barber-admin-auth', persistSession: true }
        });
    }
    return adminClient;
}
