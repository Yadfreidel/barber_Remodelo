import { obtenerClienteAdmin } from './supabaseClient.js';

// La autorización se decide en el servidor, con la lista admin_usuarios original.
export async function tieneAccesoAdmin() {
    const cliente = obtenerClienteAdmin();
    if (!cliente) return false;
    try {
        const { data: { session }, error } = await cliente.auth.getSession();
        if (error || !session) return false;
        const { data, error: permisoError } = await cliente.rpc('es_admin');
        return !permisoError && data === true;
    } catch { return false; }
}
export async function exigirAdmin() {
    if (!await tieneAccesoAdmin()) throw new Error('Se requiere una sesión con permisos administrativos.');
    return obtenerClienteAdmin();
}

// Rol del panel decidido por el servidor: 'admin' (admin_usuarios) o 'barbero' (barbero_usuarios activo)
export async function obtenerSesionPanel() {
    const cliente = obtenerClienteAdmin();
    if (!cliente) return null;
    try {
        const { data: { session }, error } = await cliente.auth.getSession();
        if (error || !session) return null;
        const { data, error: rolError } = await cliente.rpc('rol_panel');
        if (rolError || !data?.rol) return null;
        return { ...data, email: session.user?.email || '' };
    } catch { return null; }
}
