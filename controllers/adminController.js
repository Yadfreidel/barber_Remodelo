// ==========================================
// ACCESO AL PANEL DE ADMINISTRACIÓN
// Inicio de sesión (Supabase Auth), recuperación de contraseña y cierre de sesión.
// El contenido del panel está en panelController.js; los permisos los decide el servidor.
// ==========================================

import { obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { obtenerSesionPanel } from '../assets/admin-session.js';
import { renderPanel } from './panelController.js';

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
                await cliente.auth.signOut();
                throw new Error('Tu cuenta no tiene permisos para el panel.');
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

// Enlace de recuperación de Supabase: la sesión llega en la URL (cliente de administración)
obtenerClienteAdmin()?.auth.onAuthStateChange(evento => {
    if (evento === 'PASSWORD_RECOVERY') pedirNuevaContrasena();
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

async function abrirDashboard() {
    const sesion = await obtenerSesionPanel();
    if (!sesion) return;
    const modal = document.getElementById('dashboard-admin');
    if (!modal) return;

    renderPanel(modal.querySelector('.dashboard-contenido'), {
        sesion,
        notificar: mostrarNotificacion,
        cerrar: cerrarDashboard,
        salir: async () => {
            await obtenerClienteAdmin().auth.signOut();
            cerrarDashboard();
            mostrarNotificacion('Sesión cerrada', 'info');
        }
    });
    modal.style.display = 'flex';
    modal.classList.remove('ocultar-dashboard');
    document.body.style.overflow = 'hidden';
    document.getElementById('btn-cerrar-dashboard-inner')?.focus();
}

export function cerrarDashboard() {
    const modal = document.getElementById('dashboard-admin');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('ocultar-dashboard');
        document.body.style.overflow = '';
    }
}
