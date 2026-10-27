// ==========================================
// ACCESO AL PANEL DE ADMINISTRACIÓN
// Inicio de sesión (Supabase Auth), recuperación de contraseña y cierre de sesión.
// El contenido del panel está en panelController.js; los permisos los decide el servidor.
// ==========================================

import { obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { obtenerSesionPanel } from '../assets/admin-session.js';
import { renderPanel } from './panelController.js';
import { desactivarPushDispositivo, detenerAvisos } from './panel/avisos.js';
import { invalidarCatalogosAgenda } from './panel/agenda.js';

// Cerrar sesión solo en este dispositivo: signOut() sin scope revoca TODAS las sesiones de la cuenta
// (los demás teléfonos y PC). «Todos los dispositivos» es una acción aparte en Mi perfil.
const cerrarSesionLocal = cliente => cliente.auth.signOut({ scope: 'local' });

// Sección a abrir al entrar (enlace de un aviso: ?panel=agenda&fecha=…). El panel vuelve a comprobar permisos.
let inicioPendiente = null;
export function abrirPanelDesdeEnlace(params) {
    const seccion = params.get('panel');
    if (!/^[a-z-]{3,30}$/.test(seccion || '')) return false;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') || '') ? params.get('fecha') : null;
    // Cita concreta (aviso de nueva reserva): la agenda abre su detalle; el servidor comprueba que sea de esta cuenta
    const cita = /^[\w-]{1,40}$/.test(params.get('cita') || '') ? params.get('cita') : null;
    inicioPendiente = { seccion, opciones: fecha ? { fecha, vista: 'dia', ...(cita ? { abrirCita: cita } : {}) } : {} };
    history.replaceState(null, '', location.pathname + location.hash);
    verificarAccesoAdmin();
    return true;
}

export async function verificarAccesoAdmin() {
    if (await obtenerSesionPanel()) return abrirDashboard();
    if (document.getElementById('login-admin-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'login-admin-modal';
    modal.className = 'login-admin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Acceso administrativo');
    modal.innerHTML = `
        <form class="admin-form login-admin-caja">
            <h3><i class="fas fa-key"></i> Acceso al panel</h3>
            <input type="email" id="login-admin-email" placeholder="Correo" required autocomplete="username">
            <input type="password" id="login-admin-clave" placeholder="Contraseña" required autocomplete="current-password">
            <p id="login-admin-error" role="alert"></p><div class="acciones-gestion">
                <button type="submit" class="btn-admin-accion"><i class="fas fa-sign-in-alt"></i> Entrar</button>
                <button type="button" class="btn-danger" id="login-admin-cancelar">Cancelar</button>
            </div>
            <button type="button" class="login-admin-olvido" id="login-admin-olvido">¿Olvidaste tu contraseña?</button>
            <button type="button" class="login-admin-olvido" id="login-admin-registro">¿Eres barbero y aún no tienes cuenta? Crear cuenta profesional</button>
        </form>
    `;
    document.body.appendChild(modal);

    const cerrar = () => modal.remove();
    const aviso = modal.querySelector('#login-admin-error');
    modal.querySelector('#login-admin-cancelar').addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    modal.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const boton = e.submitter || modal.querySelector('[type=submit]');
        if (boton.disabled) return;
        boton.disabled = true;
        boton.textContent = 'Verificando…';
        aviso.textContent = '';
        try {
            const cliente = obtenerClienteAdmin();
            if (!cliente) throw new Error('No se puede conectar con el servidor de acceso.');
            const { error } = await cliente.auth.signInWithPassword({
                email: modal.querySelector('#login-admin-email').value.trim(),
                password: modal.querySelector('#login-admin-clave').value
            });
            if (error) throw new Error('Correo o contraseña incorrectos, o servidor no disponible.');
            if (!await obtenerSesionPanel()) {
                // Sin rol: puede pedir acceso profesional (registrarse no da privilegios)
                cerrar();
                await mostrarSolicitudAcceso();
                return;
            }
            cerrar();
            await abrirDashboard();
        } catch (error) { aviso.textContent = error.message; }
        finally { boton.disabled = false; boton.textContent = 'Entrar'; }
    });

    // Recuperación: Supabase envía un enlace al correo; al abrirlo se pide la nueva contraseña
    modal.querySelector('#login-admin-olvido').addEventListener('click', async (e) => {
        const email = modal.querySelector('#login-admin-email').value.trim();
        aviso.textContent = '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { aviso.textContent = 'Escribe tu correo arriba y vuelve a pulsar.'; return; }
        e.currentTarget.disabled = true;
        try {
            const cliente = obtenerClienteAdmin();
            const { error } = await cliente.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
            aviso.textContent = error
                ? 'La recuperación por correo no está disponible en este servidor. En el entorno local usa: npm run local:usuario -- correo nuevaClave'
                : 'Si el correo tiene una cuenta, recibirás un enlace para crear una nueva contraseña.';
        } catch {
            aviso.textContent = 'No se pudo enviar el correo de recuperación.';
        } finally { e.currentTarget.disabled = false; }
    });

    modal.querySelector('#login-admin-registro').addEventListener('click', () => { cerrar(); mostrarRegistroProfesional(); });

    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') cerrar();
        if (event.key === 'Tab') {
            const campos = [...modal.querySelectorAll('input,button')].filter(el => !el.disabled);
            const primero = campos[0], ultimo = campos.at(-1);
            if (event.shiftKey && document.activeElement === primero) {event.preventDefault();ultimo.focus();}
            else if (!event.shiftKey && document.activeElement === ultimo) {event.preventDefault();primero.focus();}
        }
    });

    modal.querySelector('#login-admin-email').focus();
}

function pedirNuevaContrasena() {
    if (document.getElementById('nueva-clave-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'nueva-clave-modal';
    modal.className = 'login-admin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
        <form class="admin-form login-admin-caja">
            <h3><i class="fas fa-lock"></i> Nueva contraseña</h3>
            <input type="password" id="nueva-clave" placeholder="Nueva contraseña (mínimo 8 caracteres)" minlength="8" required autocomplete="new-password">
            <input type="password" id="nueva-clave-2" placeholder="Repite la contraseña" minlength="8" required autocomplete="new-password">
            <p id="nueva-clave-error" role="alert"></p>
            <div class="acciones-gestion"><button type="submit" class="btn-admin-accion">Guardar contraseña</button></div>
        </form>`;
    document.body.appendChild(modal);
    modal.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const clave = modal.querySelector('#nueva-clave').value;
        const aviso = modal.querySelector('#nueva-clave-error');
        if (clave.length < 8 || clave !== modal.querySelector('#nueva-clave-2').value) { aviso.textContent = 'Las contraseñas deben coincidir y tener al menos 8 caracteres.'; return; }
        const { error } = await obtenerClienteAdmin().auth.updateUser({ password: clave });
        if (error) { aviso.textContent = 'No se pudo guardar la contraseña. Solicita un nuevo enlace.'; return; }
        modal.remove();
        history.replaceState(null, '', location.pathname + location.search);
        mostrarNotificacion('Contraseña actualizada');
        abrirDashboard();
    });
    modal.querySelector('#nueva-clave').focus();
}

// Cuenta con la que se abrió el panel en esta pestaña
let usuarioPanel = null;

// Clic en un aviso push con la web abierta pero el panel cerrado: pide sesión si hace falta y abre ese destino
// (con el panel abierto lo atiende el propio panel)
navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.tipo !== 'abrir-aviso' || usuarioPanel) return;
    try { abrirPanelDesdeEnlace(new URL(e.data.url).searchParams); } catch { /* enlace no válido */ }
});

// Enlace de recuperación de Supabase: la sesión llega en la URL (cliente de administración).
// La sesión se comparte entre pestañas: si en otra se entra con otra cuenta o se cierra la sesión,
// este panel se cierra en vez de seguir mostrando la cuenta anterior (sus peticiones ya irían con la nueva).
obtenerClienteAdmin()?.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') pedirNuevaContrasena();
    // Panel oculto (cerrado con la X) y sesión cerrada en otra pestaña: también se vacía
    if (!usuarioPanel) { if (evento === 'SIGNED_OUT') setTimeout(vaciarPanel, 0); return; }
    const correo = session?.user?.email || null;
    if (correo === usuarioPanel) return;
    // Diferido: llamar a Auth dentro de este callback bloquea el cliente (supabase-js)
    setTimeout(() => {
        vaciarPanel();
        mostrarNotificacion(correo ? `La sesión cambió a ${correo} en otra pestaña. Vuelve a abrir el panel.` : 'La sesión se cerró en otra pestaña.', 'info');
    }, 0);
});

function mostrarNotificacion(mensaje, tipo = 'success') {
    const existente = document.querySelector('.admin-notificacion');
    if (existente) existente.remove();

    const noti = document.createElement('div');
    noti.className = `admin-notificacion noti-${tipo}`;
    noti.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    const icono = document.createElement('i');
    icono.className = `fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'times-circle' : 'info-circle'}`;
    noti.append(icono, ` ${mensaje}`);
    document.body.appendChild(noti);

    setTimeout(() => noti.classList.add('noti-visible'), 10);
    setTimeout(() => {
        noti.classList.remove('noti-visible');
        setTimeout(() => noti.remove(), 300);
    }, tipo === 'error' ? 5000 : 2800);
}

// ---------- Registro y solicitud de acceso profesional ----------
function modalSimple(id, titulo, html) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'login-admin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', titulo);
    modal.innerHTML = `<div class="admin-form login-admin-caja"><h3>${titulo}</h3>${html}</div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-cerrar-modal]')) modal.remove(); });
    modal.querySelector('input,button')?.focus();
    return modal;
}

function mostrarRegistroProfesional() {
    const modal = modalSimple('registro-profesional', '<i class="fas fa-user-plus"></i> Crear cuenta profesional', `
        <form novalidate>
            <p class="login-admin-nota">Crea tu cuenta y confirma tu correo. Después inicia sesión y envía tu solicitud: la barbería la aprueba.</p>
            <input type="email" name="email" placeholder="Correo" required autocomplete="email">
            <input type="password" name="clave" placeholder="Contraseña (mínimo 8 caracteres)" minlength="8" required autocomplete="new-password">
            <input type="password" name="clave2" placeholder="Repite la contraseña" minlength="8" required autocomplete="new-password">
            <p role="alert" data-error></p>
            <div class="acciones-gestion"><button type="submit" class="btn-admin-accion">Crear cuenta</button><button type="button" class="btn-danger" data-cerrar-modal>Cancelar</button></div>
        </form>`);
    const form = modal.querySelector('form');
    const aviso = form.querySelector('[data-error]');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) { aviso.textContent = 'Escribe un correo válido.'; return; }
        if (f.clave.value.length < 8 || f.clave.value !== f.clave2.value) { aviso.textContent = 'Las contraseñas deben coincidir y tener al menos 8 caracteres.'; return; }
        const boton = e.submitter;
        if (boton.disabled) return;
        boton.disabled = true;
        const { data, error } = await obtenerClienteAdmin().auth.signUp({ email: f.email.value.trim(), password: f.clave.value,
            options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
        boton.disabled = false;
        if (error) {
            aviso.textContent = /already|registered/i.test(error.message) ? 'Ese correo ya tiene una cuenta: inicia sesión con ella (también sirve tu cuenta de cliente).'
                : /signups|disabled/i.test(error.message) ? 'El registro de cuentas no está habilitado. Pide acceso a la barbería.' : 'No se pudo crear la cuenta. Inténtalo de nuevo.';
            return;
        }
        if (data.session) { modal.remove(); mostrarSolicitudAcceso(); return; }
        form.innerHTML = '<p class="login-admin-nota">Te enviamos un correo para confirmar tu cuenta. Después vuelve aquí, inicia sesión y envía tu solicitud.</p><div class="acciones-gestion"><button type="button" class="btn-admin-accion" data-cerrar-modal>Entendido</button></div>';
    });
}

async function mostrarSolicitudAcceso() {
    const cliente = obtenerClienteAdmin();
    const salir = async () => { await cerrarSesionLocal(cliente); document.getElementById('solicitud-acceso')?.remove(); };
    const { data: e } = await cliente.rpc('solicitud_profesional_estado');
    const s = e?.solicitud;
    const pie = '<div class="acciones-gestion"><button type="button" class="btn-danger" data-salir-solicitud>Cerrar sesión</button></div>';
    let html;
    if (s?.estado === 'pendiente') html = `<p class="login-admin-nota">Tu solicitud de acceso profesional está pendiente de aprobación. Te avisaremos cuando la barbería la revise.</p>${pie}`;
    else if (e && !e.verificado) html = `<p class="login-admin-nota">Confirma tu correo con el enlace que te enviamos y vuelve a iniciar sesión para enviar tu solicitud.</p>${pie}`;
    else html = `${s?.estado === 'rechazada' ? `<p class="login-admin-nota">Tu solicitud anterior no fue aprobada${s.respuesta ? `: ${esc(s.respuesta)}` : ''}.</p>` : ''}
        <p class="login-admin-nota">Tu cuenta no tiene acceso al panel. Si trabajas en la barbería, solicita acceso profesional. Tu historial como cliente se conserva.</p>
        <form novalidate>
            <input name="nombre" placeholder="Tu nombre" maxlength="80" required autocomplete="name">
            <input name="telefono" placeholder="Teléfono (opcional)" inputmode="tel" maxlength="20" autocomplete="tel">
            <input name="mensaje" placeholder="Mensaje para la barbería (opcional)" maxlength="500">
            <p role="alert" data-error></p>
            <div class="acciones-gestion"><button type="submit" class="btn-admin-accion">Solicitar acceso</button><button type="button" class="btn-danger" data-salir-solicitud>Cerrar sesión</button></div>
        </form>`;
    const modal = modalSimple('solicitud-acceso', '<i class="fas fa-user-clock"></i> Acceso profesional', html);
    modal.querySelectorAll('[data-salir-solicitud]').forEach(b => b.addEventListener('click', salir));
    modal.querySelector('form')?.addEventListener('submit', async ev => {
        ev.preventDefault();
        const f = ev.target.elements;
        const aviso = ev.target.querySelector('[data-error]');
        if (f.nombre.value.trim().length < 2) { aviso.textContent = 'Escribe tu nombre.'; return; }
        ev.submitter.disabled = true;
        const { error } = await cliente.rpc('solicitud_profesional_crear', { p_datos: { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), mensaje: f.mensaje.value.trim() } });
        ev.submitter.disabled = false;
        if (error) { aviso.textContent = /correo_no_verificado/.test(error.message) ? 'Confirma primero tu correo.' : 'No se pudo enviar la solicitud. Inténtalo de nuevo.'; return; }
        mostrarSolicitudAcceso();
    });
}

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Contraseña temporal: hay que cambiarla antes de trabajar (lo exige el servidor) ----------
function pedirCambioTemporal() {
    const modal = modalSimple('cambio-temporal', '<i class="fas fa-lock"></i> Cambia tu contraseña temporal', `
        <form novalidate>
            <p class="login-admin-nota">Por seguridad, elige tu propia contraseña antes de usar el panel.</p>
            <input type="password" name="clave" placeholder="Nueva contraseña (mínimo 8 caracteres)" minlength="8" required autocomplete="new-password">
            <input type="password" name="clave2" placeholder="Repite la contraseña" minlength="8" required autocomplete="new-password">
            <p role="alert" data-error></p>
            <div class="acciones-gestion"><button type="submit" class="btn-admin-accion">Guardar y entrar</button><button type="button" class="btn-danger" data-salir-temporal>Cerrar sesión</button></div>
        </form>`);
    modal.querySelector('[data-salir-temporal]').addEventListener('click', async () => { await cerrarSesionLocal(obtenerClienteAdmin()); modal.remove(); });
    modal.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        const aviso = e.target.querySelector('[data-error]');
        if (f.clave.value.length < 8 || f.clave.value !== f.clave2.value) { aviso.textContent = 'Las contraseñas deben coincidir y tener al menos 8 caracteres.'; return; }
        e.submitter.disabled = true;
        const cliente = obtenerClienteAdmin();
        const { error } = await cliente.auth.updateUser({ password: f.clave.value });
        const confirmado = error ? null : await cliente.rpc('panel_confirmar_cambio_clave');
        e.submitter.disabled = false;
        if (error || confirmado?.error) {
            aviso.textContent = /clave_sin_cambiar|same/i.test(error?.message || confirmado?.error?.message || '')
                ? 'La nueva contraseña debe ser distinta de la temporal.' : 'No se pudo guardar la contraseña. Inténtalo de nuevo.';
            return;
        }
        modal.remove();
        mostrarNotificacion('Contraseña actualizada');
        abrirDashboard();
    });
}

async function abrirDashboard() {
    const sesion = await obtenerSesionPanel();
    if (!sesion) return;
    if (sesion.debe_cambiar_clave) return pedirCambioTemporal();
    const inicio = inicioPendiente;
    inicioPendiente = null;
    const modal = document.getElementById('dashboard-admin');
    if (!modal) return;
    usuarioPanel = sesion.email;

    renderPanel(modal.querySelector('.dashboard-contenido'), {
        sesion,
        notificar: mostrarNotificacion,
        cerrar: cerrarDashboard,
        inicio,
        salir: async ({ todas = false } = {}) => {
            usuarioPanel = null; // cierre pedido aquí: no es un cambio desde otra pestaña
            // Este dispositivo deja de recibir avisos de la cuenta (teléfonos compartidos)
            detenerAvisos();
            await desactivarPushDispositivo();
            const cliente = obtenerClienteAdmin();
            await (todas ? cliente.auth.signOut({ scope: 'global' }) : cerrarSesionLocal(cliente));
            vaciarPanel();
            mostrarNotificacion(todas ? 'Sesión cerrada en todos los dispositivos' : 'Sesión cerrada', 'info');
        }
    });
    modal.style.display = 'flex';
    modal.classList.remove('ocultar-dashboard');
    document.body.style.overflow = 'hidden';
    document.getElementById('btn-cerrar-dashboard-inner')?.focus();
}

export function cerrarDashboard() {
    usuarioPanel = null;
    const modal = document.getElementById('dashboard-admin');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('ocultar-dashboard');
        document.body.style.overflow = '';
    }
}

// Sesión cerrada o cambiada: sin restos de la cuenta en la página (datos, diálogos, avisos, catálogos).
// Al volver a entrar, todo se pide de nuevo al servidor con la sesión que haya entonces.
function vaciarPanel() {
    detenerAvisos();
    cerrarDashboard();
    const contenido = document.querySelector('#dashboard-admin .dashboard-contenido');
    if (contenido) contenido.innerHTML = '';
    invalidarCatalogosAgenda();
    document.querySelectorAll('.aviso-flotante, .panel-dialogo-fondo').forEach(e => e.remove());
}
