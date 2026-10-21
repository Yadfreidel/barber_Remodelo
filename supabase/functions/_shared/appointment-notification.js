import { construirPlantilla } from './whatsapp.js';
import { textoTarjeta } from '../../../assets/appointment-card.js';

export function plantillaTarjeta(mensaje, datos, opciones, mediaId = '') {
    const nombre = mediaId ? opciones.plantillaImagen : opciones.plantillaTexto;
    if (!nombre) return null;
    const extras = [datos.ubicacion && `*Ubicación:* ${datos.ubicacion}`, datos.referencia && `*Referencia:* ${datos.referencia}`, datos.enlace && `Gestionar reserva: ${datos.enlace}`, 'Gracias por elegirnos.'].filter(Boolean).join(' · ');
    const parametros = [datos.negocio, datos.titulo, datos.nombre, datos.mensaje, datos.servicios.join(' · '), datos.profesional, datos.fecha, datos.hora, extras];
    // La plantilla multimedia de Meta admite un cuerpo de hasta 1024 caracteres.
    if (textoTarjeta(datos).length > 1024) return null;
    const cuerpo = construirPlantilla({ ...mensaje, plantilla: nombre, parametros }, opciones);
    if (mediaId) cuerpo.template.components.unshift({ type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] });
    return cuerpo;
}

// No crea mensajes ni reservas. Opera exclusivamente sobre un mensaje ya reclamado.
// Generar/subir un archivo no envía un mensaje: esos fallos permiten texto seguro.
export async function enviarConTarjeta({ mensaje, opciones, cargarDatos, generarPng, subirMedia, enviar }) {
    const original = construirPlantilla(mensaje, opciones);
    if (mensaje.tipo !== 'recordatorio' || !opciones.plantillaImagen) return enviar(original);
    let datos, conImagen;
    try {
        datos = await cargarDatos();
        if (datos.cancelada) return { omitido: true };
        // Verificar tamaño antes de generar/subir. El texto original permanece disponible.
        if (!plantillaTarjeta(mensaje, datos, opciones, 'validacion')) return enviar(original);
        const png = await generarPng(datos);
        const mediaId = await subirMedia(png);
        if (!mediaId) throw new Error('No se obtuvo identificador de imagen');
        conImagen = plantillaTarjeta(mensaje, datos, opciones, mediaId);
    } catch {
        return enviar(datos ? plantillaTarjeta(mensaje, datos, opciones) || original : original);
    }
    // Fuera del catch: timeout/caída tras enviar puede significar entrega; no duplicar.
    const resultado = await enviar(conImagen);
    // HTTP 4xx confirma rechazo: permite texto salvo 429 (limite de envio).
    if (!resultado.ok && ([131052, 131053].includes(resultado.codigo) || (resultado.status >= 400 && resultado.status < 500 && resultado.status !== 429))) {
        return enviar(plantillaTarjeta(mensaje, datos, opciones) || original);
    }
    return resultado;
}
