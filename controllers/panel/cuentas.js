// ==========================================
// PANEL: CUENTAS DE ACCESO DE LOS BARBEROS
// La contraseña solo pasa por Supabase Auth: nunca se guarda en tablas, ni se muestra después,
// ni se envía por avisos. La vinculación cuenta-perfil la valida el servidor (panel_cuenta_vincular).
// ==========================================

import { api, esc, dialogo } from './comun.js';
import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from '../../assets/config.js';

export const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PERMISOS = { cajero: 'Cajero: cobrar y caja del día (sin anular, reembolsar, gastos ni inventario)' };

export function generarClaveTemporal() {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const azar = crypto.getRandomValues(new Uint32Array(12));
    return [...azar].map(n => letras[n % letras.length]).join('');
}

// Crea la cuenta en Auth. Primero con la Edge Function «barbero-cuenta» (cuenta confirmada por el
// administrador, sin correos); si no está desplegada, con el registro normal de Auth (el barbero
// confirma su correo con el enlace que recibe).
async function crearCuentaAuth(email, clave) {
    try {
        const { error } = await obtenerClienteAdmin().functions.invoke('barbero-cuenta', { body: { email, password: clave } });
        if (!error) return { confirmada: true };
        const estado = error.context?.status;
        if (estado === 409) return { existe: true };
        if (estado === 403) throw new Error('No tienes permiso para crear cuentas.');
        if (estado === 400) throw new Error('Revisa el correo y la contraseña temporal (mínimo 8 caracteres).');
    } catch (e) {
        if (/permiso|Revisa/.test(e.message)) throw e;
    }
    const temporal = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        db: { schema: SUPABASE_SCHEMA },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `barberia-alta-${Date.now()}` }
    });
    const { data, error } = await temporal.auth.signUp({ email, password: clave, options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
    if (error) {
        if (/already|registered|exists/i.test(error.message)) return { existe: true };
        if (/password/i.test(error.message)) throw new Error('La contraseña temporal no cumple los requisitos del servidor (usa al menos 8 caracteres con letras y números).');
        if (/sending|email/i.test(error.message)) throw new Error('El servidor no pudo enviar el correo de confirmación (revisa la configuración de correo de Supabase Auth).');
        throw new Error('No se pudo crear la cuenta en el servidor de acceso. Inténtalo de nuevo.');
    }
    return { confirmada: Boolean(data.session) || Boolean(data.user?.email_confirmed_at) };
}

function confirmarExistente(c, email) {
    return new Promise(resolver => {
        const { cuerpo, cerrar } = dialogo({ titulo: 'Cuenta existente', ancho: 'sm', html: `
            <p class="panel-texto">${esc(email)} ya tiene una cuenta${c.verificado ? ' verificada' : ' (correo aún sin verificar)'}${c.es_admin ? ' de administración' : ''}.</p>
            <p class="panel-sub">Se vinculará con este perfil sin cambiar su contraseña ni sus accesos actuales${c.es_admin ? ' (seguirá siendo administrador)' : ''}. Haz esto solo si la cuenta es de este barbero.</p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-no>Cancelar</button><button type="button" class="panel-btn panel-btn-principal" data-si>Vincular cuenta</button></div>` });
        let respondido = false;
        const responder = v => { respondido = true; cerrar(); resolver(v); };
        cuerpo.querySelector('[data-si]').addEventListener('click', () => responder(true));
        cuerpo.querySelector('[data-no]').addEventListener('click', () => responder(false));
        const obs = new MutationObserver(() => { if (!cuerpo.isConnected) { obs.disconnect(); if (!respondido) resolver(false); } });
        obs.observe(document.body, { childList: true });
    });
}

// Habilita el acceso de un perfil. Seguro ante reintentos: si la cuenta se creó pero falló la
// vinculación, volver a pulsar la vincula (el servidor la reconoce como recién creada).
export async function habilitarAcceso(barberoId, { email, clave, permisos = [] }) {
    email = email.trim().toLowerCase();
    if (!CORREO.test(email)) throw new Error('Escribe un correo válido.');
    const c = await api('panel_cuenta_consultar', { p_email: email });
    if (c.barbero) throw new Error(`Esa cuenta ya está vinculada con ${c.barbero}.`);
    let creada = null;
    let confirmar = false;
    if (!c.existe) {
        if (!clave || clave.length < 8) throw new Error('Escribe una contraseña temporal de al menos 8 caracteres.');
        creada = await crearCuentaAuth(email, clave);
        if (creada.existe) confirmar = true;
    } else if (!c.reciente) {
        if (!await confirmarExistente(c, email)) return null;
        confirmar = true;
    }
    const r = await api('panel_cuenta_vincular', { p_datos: { barbero_id: String(barberoId), email, clave_temporal: Boolean(clave),
        confirmar_existente: confirmar, permisos } });
    return { ...r, pendienteConfirmar: creada && !creada.confirmada, intentoPrevio: c.existe && c.reciente };
}

export async function enviarRestablecimiento(email) {
    const { error } = await obtenerClienteAdmin().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) throw new Error('El servidor de acceso no pudo enviar el enlace (revisa la configuración de correo de Supabase Auth).');
}

export function mensajeAlta(r) {
    if (!r) return null;
    if (r.repetida) return 'La cuenta ya estaba vinculada';
    if (r.intentoPrevio) return 'Cuenta vinculada. Se había creado en un intento anterior: su contraseña temporal es la de ese intento (si no la recuerdas, envía el enlace para restablecerla).';
    if (r.pendienteConfirmar) return 'Acceso creado. El barbero debe confirmar su correo con el enlace que recibió y después cambiar la contraseña temporal.';
    return r.clave_temporal ? 'Acceso creado. Al entrar, el barbero deberá cambiar la contraseña temporal.' : 'Cuenta vinculada';
}
