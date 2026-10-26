// ==========================================
// PANEL: CUENTAS DE ACCESO DE LOS BARBEROS
// La contraseña solo pasa por Supabase Auth: nunca se guarda en tablas, ni se muestra después,
// ni se envía por avisos. La vinculación cuenta-perfil la valida el servidor (panel_cuenta_vincular).
// ==========================================

import { api, esc, dialogo } from './comun.js';
import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';

export const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PERMISOS = { cajero: 'Cajero: cobrar y caja del día (sin anular, reembolsar, gastos ni inventario)' };
const ERRORES_SERVIDOR = {
    no_autorizado: 'Solo un administrador puede crear cuentas.',
    clave_debil: 'La contraseña inicial debe tener entre 8 y 72 caracteres, con letras y números.',
    datos_invalidos: 'Revisa el correo y la contraseña inicial.',
    alta_fallida: 'El servidor de acceso no pudo crear la cuenta. Inténtalo de nuevo.',
    cuenta_vinculada_otro: 'Esa cuenta ya está vinculada con otro barbero.',
    barbero_con_cuenta: 'Este barbero ya tiene una cuenta vinculada.'
};

// Requisitos de la contraseña inicial (los mismos que valida el servidor)
export function problemaClave(clave, confirmacion) {
    if (clave.length < 8 || clave.length > 72) return 'La contraseña inicial debe tener entre 8 y 72 caracteres.';
    if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) return 'La contraseña inicial debe combinar letras y números.';
    if (clave !== confirmacion) return 'Las contraseñas no coinciden.';
    return null;
}

export function generarClaveTemporal() {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digitos = '23456789';
    const todo = letras + digitos;
    const azar = [...crypto.getRandomValues(new Uint32Array(14))];
    // Siempre con letras y números
    return [letras[azar[0] % letras.length], digitos[azar[1] % digitos.length], ...azar.slice(2).map(n => todo[n % todo.length])]
        .sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] & 1) - 0.5).join('');
}

// Campos de contraseña inicial con mostrar/ocultar y «Generar» (el valor nunca se guarda en el navegador)
export function camposClave() {
    return `<label>Contraseña inicial<span class="panel-fila clave-fila">
            <input type="password" name="clave" minlength="8" maxlength="72" autocomplete="new-password">
            <button type="button" class="panel-btn panel-btn-mini" data-ver-clave aria-pressed="false">Mostrar</button>
            <button type="button" class="panel-btn panel-btn-mini" data-generar>Generar segura</button></span></label>
        <label>Confirmar contraseña<input type="password" name="clave2" minlength="8" maxlength="72" autocomplete="new-password"></label>
        <p class="panel-sub">Mínimo 8 caracteres con letras y números. Entrégasela al barbero en persona: no se guarda ni se vuelve a mostrar, y deberá cambiarla en su primer acceso.</p>`;
}

export function conectarCamposClave(raiz) {
    const clave = raiz.querySelector('[name=clave]');
    const clave2 = raiz.querySelector('[name=clave2]');
    const ver = raiz.querySelector('[data-ver-clave]');
    if (!clave) return;
    const mostrar = visible => {
        clave.type = clave2.type = visible ? 'text' : 'password';
        ver.textContent = visible ? 'Ocultar' : 'Mostrar';
        ver.setAttribute('aria-pressed', String(visible));
    };
    ver.addEventListener('click', () => mostrar(clave.type === 'password'));
    raiz.querySelector('[data-generar]').addEventListener('click', () => { clave.value = clave2.value = generarClaveTemporal(); mostrar(true); });
}

export function limpiarCamposClave(raiz) {
    raiz.querySelectorAll('[name=clave], [name=clave2]').forEach(i => { i.value = ''; i.type = 'password'; });
}

// 1) Operación completa en el servidor (Edge Function «barbero-cuenta»): crea la cuenta confirmada, le da el rol
//    y la vincula; si algo falla, deshace el alta. Si el servidor no esta disponible se informa sin crear cuentas desde el navegador.
async function altaEnServidor(datos) {
    let respuesta;
    try {
        const { data, error } = await obtenerClienteAdmin().functions.invoke('barbero-cuenta', { body: datos });
        if (!error) return { ...data, via: 'servidor' };
        respuesta = error.context;
    } catch { throw new Error('No se pudo contactar con el servidor de cuentas. Reintenta con el mismo correo.'); }
    const estado = respuesta?.status;
    if (!estado || estado === 404) throw new Error('Servidor de cuentas no disponible. Inicia npm run local:funciones o despliega barbero-cuenta en Supabase.');
    let cuerpo = {};
    try { cuerpo = await respuesta.json(); } catch { /* sin cuerpo */ }
    if (estado === 409 && cuerpo.error === 'cuenta_existente') return { existe: true, reciente: cuerpo.reciente };
    if (cuerpo.compensado === false) throw new Error('La cuenta existe pero falta vincularla. Reintenta con el mismo correo; no crees otro perfil.');
    throw new Error(ERRORES_SERVIDOR[cuerpo.error] || ERRORES_SERVIDOR.alta_fallida);
}

function confirmarExistente(c, email) {
    return new Promise(resolver => {
        const { cuerpo, cerrar } = dialogo({ titulo: 'Este correo ya tiene una cuenta', ancho: 'sm', html: `
            <p class="panel-texto">${esc(email)} ya está registrado${c.verificado ? '' : ' (correo pendiente de verificar)'}${c.es_admin ? ' y es administrador' : ''}.</p>
            <p class="panel-sub">Se vinculará con este perfil sin cambiar su contraseña ni sus otros accesos${c.es_admin ? ' (seguirá siendo administrador)' : ''}.
                No se usará la contraseña inicial que escribiste. Hazlo solo si la cuenta es de este barbero.</p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-no>Cancelar</button><button type="button" class="panel-btn panel-btn-principal" data-si>Vincular esta cuenta</button></div>` });
        let respondido = false;
        const responder = v => { respondido = true; cerrar(); resolver(v); };
        cuerpo.querySelector('[data-si]').addEventListener('click', () => responder(true));
        cuerpo.querySelector('[data-no]').addEventListener('click', () => responder(false));
        const obs = new MutationObserver(() => { if (!cuerpo.isConnected) { obs.disconnect(); if (!respondido) resolver(false); } });
        obs.observe(document.body, { childList: true });
    });
}

// Habilita (o cambia, con reemplazar) el acceso de un perfil. Solo termina bien cuando la cuenta existe,
// tiene el rol barbero y está vinculada; devuelve también si el correo está verificado.
// Seguro ante reintentos: una cuenta creada en un intento anterior se vincula sin crear otra.
export async function habilitarAcceso(barberoId, { email, clave, permisos = [], reemplazar = false }) {
    email = email.trim().toLowerCase();
    if (!CORREO.test(email)) throw new Error('Escribe un correo válido.');
    const base = { barbero_id: String(barberoId), email, permisos, reemplazar };
    let c = await api('panel_cuenta_consultar', { p_email: email });
    let intentoPrevio = false;
    if (!c.existe) {
        if (!clave) throw new Error('Ese correo aún no tiene cuenta: escribe una contraseña inicial y confírmala.');
        const servidor = await altaEnServidor({ ...base, password: clave });
        if (servidor?.ok) return { ...servidor, verificado: true };

        c = await api('panel_cuenta_consultar', { p_email: email });
        if (!c.existe) throw new Error('No se pudo crear la cuenta. Inténtalo de nuevo.');
    } else if (c.alta_panel && c.alta_perfil === String(barberoId)) {
        intentoPrevio = true;
    }
    let confirmar = false;
    if (!(c.alta_panel && c.alta_perfil === String(barberoId))) {
        if (!await confirmarExistente(c, email)) return null;
        confirmar = true;
    }
    const r = await api('panel_cuenta_vincular', { p_datos: { ...base, clave_temporal: true, confirmar_existente: confirmar } });
    const estado = await api('panel_cuenta_consultar', { p_email: email });
    return { ...r, verificado: estado.verificado, intentoPrevio, existente: confirmar };
}

export async function enviarRestablecimiento(email) {
    const { error } = await obtenerClienteAdmin().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) throw new Error('El servidor de acceso no pudo enviar el enlace (revisa la configuración de correo de Supabase Auth).');
}

export function mensajeAlta(r) {
    if (!r) return null;
    if (!r.verificado) return 'Cuenta creada y vinculada. Pendiente de verificar correo: el barbero debe abrir el enlace que recibió y después entrar con su contraseña inicial (deberá cambiarla).';
    if (r.repetida) return 'La cuenta ya estaba vinculada con este barbero.';
    if (r.existente) return 'Cuenta existente vinculada. Su contraseña y sus otros accesos no cambiaron.';
    if (r.intentoPrevio) return 'Cuenta vinculada. Se había creado en un intento anterior: su contraseña inicial es la de ese intento (si no la recuerdas, envía el enlace para restablecerla).';
    return 'Acceso listo: el barbero ya puede entrar con su correo y la contraseña inicial (deberá cambiarla en su primer acceso).';
}
