import { conCarga } from '../assets/motion-utils.js';
import { mostrarSeguimiento } from '../assets/reservation-feedback.js';
import { catalogoServidorListo } from './catalogoController.js';
import { obtenerServicios, esCorteCatalogo, formatoPrecioServicio } from '../models/serviceModel.js';
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { usarReservaServidor, reservarEnServidor, formatoPrecio, esc } from './modulosController.js';

export async function procesarCita(evento) {
    evento.preventDefault();
    return conCarga(evento.target, () => procesarCitaInterna(evento));
}
async function procesarCitaInterna(evento) {
    evento.preventDefault();

    const TU_TELEFONO = "8292466177";

    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const telefonoCliente = document.getElementById('telefono').value.trim();
    const servicio = document.getElementById('servicio-select').value;
    const barbero = document.getElementById('barbero-seleccionado').value;
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora-seleccionada').value;

    if (!servicio) { mostrarAlerta("Por favor, selecciona un servicio del catálogo."); return; }
    if (!barbero) { mostrarAlerta("Por favor, selecciona tu barbero en la sección de arriba."); return; }
    if (!fecha) { mostrarAlerta("Por favor, selecciona una fecha para tu cita."); return; }
    if (!hora) { mostrarAlerta("Por favor, toca una de las horas disponibles."); return; }

    let reservaServidor = null;
    let citaGuardada = false;

    // Los cortes importados siempre usan la validacion de duracion y precio del servidor.
    if (esCorteCatalogo(servicio)) {
        if (!estaSupabaseListo() || !catalogoServidorListo() || !usarReservaServidor()) {
            mostrarAlerta('No se pudo validar el catalogo. Recarga la pagina o contacta con la barberia.');
            return;
        }
        // Conserva el alta del profesional local que ya realizaba el flujo anterior.
        try {
            const { data: profesionales, error } = await supabase.from('barberos').select('id').eq('nombre', barbero).limit(1);
            if (error) throw error;
            if (!profesionales?.length) {
                const { error: altaError } = await supabase.from('barberos').insert([{ nombre: barbero, activo: true }]);
                if (altaError) throw altaError;
            }
        } catch {
            mostrarAlerta('No se pudo validar el profesional. Intenta nuevamente.');
            return;
        }
        reservaServidor = await reservarEnServidor({ nombre, email, telefono: telefonoCliente, servicio, barbero, fecha, hora }, mostrarAlerta);
        if (!reservaServidor) return;
        citaGuardada = true;
    }
    // Flujo anterior conservado para los servicios no importados.
    if (estaSupabaseListo() && !reservaServidor) {
        try {
            // Buscar ID de barbero
            let barberoId = null;
            const { data: barberosData } = await supabase
                .from('barberos')
                .select('id')
                .eq('nombre', barbero)
                .limit(1);

            if (barberosData && barberosData.length > 0) {
                barberoId = barberosData[0].id;
            } else {
                // Auto-crear si no existe en la BD
                const { data: nuevoBarbero } = await supabase
                    .from('barberos')
                    .insert([{ nombre: barbero, activo: true }])
                    .select('id')
                    .single();
                if (nuevoBarbero) barberoId = nuevoBarbero.id;
            }

            // Buscar ID de servicio
            let servicioId = null;
            const { data: serviciosData } = await supabase
                .from('servicios')
                .select('id')
                .eq('nombre', servicio)
                .limit(1);

            if (serviciosData && serviciosData.length > 0) {
                servicioId = serviciosData[0].id;
            } else {
                // Auto-crear si no existe en la BD
                const serviciosActuales = obtenerServicios();
                const sObj = serviciosActuales.find(s => s.nombre === servicio);
                const precioNum = sObj ? parseFloat(String(sObj.precio).replace(/[^0-9.]/g, '')) || 0 : 0;
                
                const { data: nuevoServicio } = await supabase
                    .from('servicios')
                    .insert([{ nombre: servicio, precio: precioNum, duracion_minutos: 30 }])
                    .select('id')
                    .single();
                if (nuevoServicio) servicioId = nuevoServicio.id;
            }

            if (barberoId && servicioId && usarReservaServidor()) {
                // Módulos activos: precio, promoción, stock y referido se validan en el servidor
                reservaServidor = await reservarEnServidor({ nombre, email, telefono: telefonoCliente, servicio, barbero, fecha, hora }, mostrarAlerta);
                if (!reservaServidor) return;
                citaGuardada = true;
            } else if (barberoId && servicioId) {
                const { error: insertError } = await supabase
                    .from('citas')
                    .insert([{
                        nombre_cliente: nombre,
                        telefono_cliente: telefonoCliente,
                        email: email,
                        barbero_id: barberoId,
                        servicio_id: servicioId,
                        fecha: fecha,
                        hora: hora,
                        estado: 'pendiente'
                    }]);

                if (insertError) {
                    const esConflictoUnique = 
                        insertError.code === '23505' || 
                        (insertError.message && (
                            insertError.message.toLowerCase().includes('unique') || 
                            insertError.message.toLowerCase().includes('duplicate') ||
                            insertError.message.toLowerCase().includes('citas_barbero_id_fecha_hora')
                        ));

                    if (esConflictoUnique) {
                        mostrarAlerta("Ese horario ya no está disponible, por favor elige otro.");
                        if (window.generarPildorasDeTiempo) {
                            window.generarPildorasDeTiempo();
                        }
                        return; // Detiene el flujo sin abrir WhatsApp ni mostrar tracking
                    } else {
                        mostrarAlerta("No se pudo registrar la reserva: " + (insertError.message || "Error en la base de datos"));
                        return;
                    }
                }
                citaGuardada = true;
            }
        } catch (err) {
            console.error("Error al procesar reserva en Supabase:", err);
            mostrarAlerta("Ocurrió un error inesperado al conectar con la base de datos.");
            return;
        }
    }

    const fechaFormateada = fecha.split('-').reverse().join('/');

    const serviciosActuales = obtenerServicios();
    const objetoServicio = serviciosActuales.find(s => s.nombre === servicio) || { precio: "$0.00" };
    const totalProductos = reservaServidor ? Number(reservaServidor.total_productos || 0) : 0;
    const precioMostrado = reservaServidor
        ? formatoPrecio(Number(reservaServidor.precio_final) + totalProductos)
        : formatoPrecioServicio(objetoServicio.precio);

    // Guardar en analytics
    guardarMetricasAnaliticas({
        servicio: servicio,
        precio: objetoServicio.precio,
        barbero: barbero,
        fecha: fechaFormateada
    });

    const mensajeWhatsApp =
        `🔥 *NUEVA RESERVA PREMIUM* 🔥%0A%0A` +
        `👤 *Cliente:* ${nombre}%0A` +
        `📞 *Teléfono:* ${telefonoCliente}%0A%0A` +
        `💈 *Servicio:* ${servicio}%0A` +
        `💈 *Barbero:* _${barbero}_%0A` +
        `📅 *Fecha:* ${fechaFormateada}%0A` +
        `⏰ *Hora:* *${hora} hrs*%0A` +
        (totalProductos > 0 ? `🛍️ *Productos para retiro:* ${formatoPrecio(totalProductos)}%0A` : '') +
        (reservaServidor ? `💵 *Total:* ${precioMostrado}%0A` : '') + `%0A` +
        `⚡ _Turno enviado desde la web._`;

    const urlWhatsApp = `https://wa.me/${TU_TELEFONO}?text=${mensajeWhatsApp}`;

    activarPantallaSeguimiento({
        nombre, servicio, barbero, hora, fecha: fechaFormateada, precio: precioMostrado,
        guardada: citaGuardada, estado: reservaServidor?.estado || 'pendiente',
        token: reservaServidor ? reservaServidor.token : null,
        avisos: reservaServidor ? reservaServidor.avisos : []
    });

    setTimeout(() => {
        window.open(urlWhatsApp, '_blank');
    }, 100);

    // Resetear form y campos hidden
    evento.target.reset();
    document.getElementById('barbero-seleccionado').value = '';
    document.getElementById('hora-seleccionada').value = '';
}

function mostrarAlerta(mensaje) {
    const existente = document.querySelector('.alerta-cita');
    if (existente) existente.remove();

    const alerta = document.createElement('div');
    alerta.className = 'alerta-cita';
    alerta.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${mensaje}`;
    
    const form = document.getElementById('form-reservas');
    form.insertBefore(alerta, form.querySelector('button[type="submit"]'));
    
    setTimeout(() => alerta.classList.add('alerta-visible'), 10);
    setTimeout(() => {
        alerta.classList.remove('alerta-visible');
        setTimeout(() => alerta.remove(), 300);
    }, 3000);
}

function guardarMetricasAnaliticas(nuevaCita) {
    let historial = JSON.parse(localStorage.getItem('barber_analytics_citas')) || [];
    historial.push(nuevaCita);
    localStorage.setItem('barber_analytics_citas', JSON.stringify(historial));
}

function activarPantallaSeguimiento(datos) {
    const formulario = document.getElementById('form-reservas');
    const contenedor = document.getElementById('pantalla-seguimiento');
    formulario.style.display = 'none';
    formulario.style.opacity = '1';
    contenedor.classList.remove('ocultar-tracking');
    contenedor.dataset.solicitud = datos.token || '';
    mostrarSeguimiento(contenedor, datos, restaurarFormulario, { enfocar: true });
    // Solo una lectura del estado guardado; no hay confirmaciones por temporizador.
    if (datos.guardada && datos.token && estaSupabaseListo()) {
        supabase.rpc('consultar_cita', { p_token: datos.token }).then(({ data, error }) => {
            if (error || !data || contenedor.classList.contains('ocultar-tracking') || contenedor.dataset.solicitud !== datos.token) return;
            if (data.estado === datos.estado && Boolean(data.completada) === Boolean(datos.completada)) return;
            mostrarSeguimiento(contenedor, { ...datos, estado: data.estado, completada: data.completada }, restaurarFormulario);
        }).catch(() => { /* El fallo de lectura no invalida una cita guardada. */ });
    }
}

function restaurarFormulario() {
    const formulario = document.getElementById('form-reservas');
    const contenedorTracking = document.getElementById('pantalla-seguimiento');

    document.getElementById('barbero-seleccionado').value = "";
    document.getElementById('hora-seleccionada').value = "";
    
    const contenedorHoras = document.getElementById('contenedor-horas');
    if (contenedorHoras) {
        contenedorHoras.innerHTML = `<p class="placeholder-horas">Por favor, selecciona una fecha primero...</p>`;
    }

    document.querySelectorAll('.card-barbero').forEach(t => t.classList.remove('barbero-activo'));

    contenedorTracking.classList.add('ocultar-tracking');
    formulario.style.display = 'flex';
    formulario.style.opacity = '1';
    formulario.classList.add('reserva-retomada');
    formulario.querySelector('.form-titulo').focus({ preventScroll: true });
}