import { conCarga } from '../assets/motion-utils.js';
import { mostrarSeguimiento } from '../assets/reservation-feedback.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { cargarConfigModulos, usarReservaServidor, reservarEnServidor, formatoPrecio } from './modulosController.js';
import { registrarCitaReservada } from './misCitasController.js';
import { guardarBorrador } from '../assets/mis-citas-store.js';
import { rango12h, sumarMinutos } from '../assets/horario-utils.js';

export async function procesarCita(evento) {
    evento.preventDefault();
    return conCarga(evento.target, () => procesarCitaInterna(evento));
}
async function procesarCitaInterna(evento) {
    evento.preventDefault();

    const TU_TELEFONO = "8292466177";

    const nombre = document.getElementById('nombre').value.trim();
    const email = null; // El contrato RPC admite null; el correo administrativo no cambia.
    const notas = document.getElementById('notas')?.value.trim() || '';
    if (!nombre || telefonoClienteInvalido()) { mostrarAlerta('Revisa tu nombre y número de WhatsApp.'); return; }
    const telefonoCliente = document.getElementById('telefono').value.trim();
    const servicio = document.getElementById('servicio-select').value;
    const barbero = document.getElementById('barbero-seleccionado').value;
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora-seleccionada').value;

    if (!servicio) { mostrarAlerta("Por favor, selecciona un servicio del catálogo."); return; }
    if (!barbero) { mostrarAlerta("Por favor, selecciona tu barbero en la sección de arriba."); return; }
    if (!fecha) { mostrarAlerta("Por favor, selecciona una fecha para tu cita."); return; }
    if (!hora) { mostrarAlerta("Por favor, toca una de las horas disponibles."); return; }

    // Sin base de datos (web publicada sin servidor): la cita se envía como solicitud por WhatsApp
    const modoSolicitud = !estaSupabaseListo();
    let reservaServidor = null;

    if (!modoSolicitud) {
        // Toda reserva pasa por reservar_cita: valida horario, duración, solapamientos y precio en el servidor
        // y queda guardada antes de mostrarse. La clave del borrador evita duplicados por reintentos.
        await cargarConfigModulos();
        if (!usarReservaServidor()) {
            mostrarAlerta('No pudimos conectar con la barbería. Revisa tu conexión y vuelve a intentarlo.');
            return;
        }
        const borrador = guardarBorrador({ servicio, barbero, fecha, hora });
        reservaServidor = await reservarEnServidor({ nombre, email, telefono: telefonoCliente, servicio, barbero, fecha, hora, clave: borrador?.clave }, mostrarAlerta);
        if (!reservaServidor) return;
        registrarCitaReservada(reservaServidor);
    }

    const fechaFormateada = fecha.split('-').reverse().join('/');
    const objetoServicio = obtenerServicios().find(s => s.nombre === servicio) || { precio: "$0.00" };
    const horaFin = reservaServidor?.cita?.hora_fin || (objetoServicio.duracion_minutos ? sumarMinutos(hora, objetoServicio.duracion_minutos) : null);
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
        (modoSolicitud ? `📝 *SOLICITUD DE CITA* (pendiente de confirmar)%0A%0A` : `🔥 *NUEVA RESERVA PREMIUM* 🔥%0A%0A`) +
        `👤 *Cliente:* ${nombre}%0A` +
        `📞 *Teléfono:* ${telefonoCliente}%0A%0A` +
        `💈 *Servicio:* ${servicio}%0A` +
        `💈 *Barbero:* _${barbero}_%0A` +
        `📅 *Fecha:* ${fechaFormateada}%0A` +
        `⏰ *Hora:* *${rango12h(hora, horaFin)}*%0A` +
        (totalProductos > 0 ? `🛍️ *Productos para retiro:* ${formatoPrecio(totalProductos)}%0A` : '') +
        (reservaServidor ? `💵 *Total:* ${precioMostrado}%0A` : '') +
        (modoSolicitud ? `💵 *Precio estimado:* ${precioMostrado}%0A` : '') + `%0A` +
        `⚡ _Turno enviado desde la web._`;

    // Texto completo codificado (conserva emojis y acentos) y número con código de país (+1 para RD)
    const textoWhatsApp = mensajeWhatsApp.replace(/%0A/g, '\n') + (notas ? `\n*Notas:* ${notas}` : '');
    const numeroWhatsApp = TU_TELEFONO.length === 10 ? `1${TU_TELEFONO}` : TU_TELEFONO;
    // api.whatsapp.com conserva los emojis (la redirección de wa.me los reemplaza por "�")
    const urlWhatsApp = `https://api.whatsapp.com/send?phone=${numeroWhatsApp}&text=${encodeURIComponent(textoWhatsApp)}`;

    activarPantallaSeguimiento({
        nombre, servicio, barbero, hora: rango12h(hora, horaFin), fecha: fechaFormateada, precio: precioMostrado,
        guardada: Boolean(reservaServidor), estado: reservaServidor?.cita?.estado || 'pendiente',
        token: reservaServidor ? reservaServidor.token : null,
        avisos: reservaServidor ? reservaServidor.avisos : [],
        enlaceWhatsApp: modoSolicitud ? urlWhatsApp : null
    });

    // Una reserva repetida (reintento de la misma solicitud) no vuelve a avisar por WhatsApp
    if (!reservaServidor?.repetida) {
        setTimeout(() => {
            window.open(urlWhatsApp, '_blank');
        }, 100);
    }

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
    alerta.setAttribute('role', 'alert');
    alerta.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${mensaje}`;

    const form = document.getElementById('form-reservas');
    form.insertBefore(alerta, form.querySelector('button[type="submit"]'));

    setTimeout(() => alerta.classList.add('alerta-visible'), 10);
    setTimeout(() => {
        alerta.classList.remove('alerta-visible');
        setTimeout(() => alerta.remove(), 300);
    }, 6000);
}

function guardarMetricasAnaliticas(nuevaCita) {
    try {
        let historial = JSON.parse(localStorage.getItem('barber_analytics_citas')) || [];
        historial.push(nuevaCita);
        localStorage.setItem('barber_analytics_citas', JSON.stringify(historial));
    } catch { /* sin almacenamiento local: no afecta a la reserva */ }
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
function telefonoClienteInvalido() { return !document.getElementById('telefono').checkValidity(); }
