import { CATALOGO_25 } from '../models/catalogo25.js';
import { supabase, estaSupabaseListo, obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { obtenerServicios, sincronizarCatalogoServidor } from '../models/serviceModel.js';

let sincronizado = false;
export async function cargarCatalogoServidor() {
    sincronizado = false;
    if (!estaSupabaseListo()) return false;
    try {
        const { data, error } = await supabase.from('servicios')
            .select('id,catalogo_id,nombre,precio,duracion_minutos').in('catalogo_id', CATALOGO_25.map(s => s.id));
        if (error || !data || data.length !== 25) return false;
        sincronizarCatalogoServidor(data);
        sincronizado = true;
    } catch { /* No confirmar una reserva con tarifas locales desactualizadas. */ }
    return sincronizado;
}
export function catalogoServidorListo() { return sincronizado; }
export function referenciaServicio(nombre) {
    const servicio = obtenerServicios().find(s => s.nombre === nombre);
    return servicio?.servicio_id || nombre;
}
export async function guardarTarifaCorte(id, precio, duracion) {
    if (!Number.isFinite(precio) || precio < 0 || !Number.isInteger(duracion) || duracion <= 0 || duracion > 480) throw new Error('Precio o duracion invalidos');
    const admin = obtenerClienteAdmin();
    if (!admin) throw new Error('Inicia sesion de administrador para guardar la tarifa');
    const { data, error } = await admin.rpc('admin_actualizar_corte', { p_catalogo_id: id, p_precio: precio, p_duracion: duracion });
    if (error) throw new Error(error.message);
    await cargarCatalogoServidor();
    return data;
}
