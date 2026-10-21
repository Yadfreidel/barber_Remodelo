import { catalogoServidorListo } from './catalogoController.js';
import { obtenerServicios, esCorteCatalogo, formatoPrecioServicio } from '../models/serviceModel.js';
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { usarReservaServidor, reservarEnServidor, formatoPrecio, esc } from './modulosController.js';

export async function procesarCita(evento) {
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
    const contenedorTracking = document.getElementById('pantalla-seguimiento');

    formulario.style.opacity = '0';

    setTimeout(() => {
        formulario.style.display = 'none';

        contenedorTracking.innerHTML = `
            <div class="tracking-header">
                <div class="radar-ping"></div>
                <h3>Cita en Tiempo Real</h3>
                <p>¡Hola <span>${datos.nombre}</span>! Tu solicitud está siendo procesada.</p>
            </div>

            <div class="resumen-ticket">
                <div><i class="fas fa-cut"></i> ${datos.servicio}</div>
                <div><i class="fas fa-user-tie"></i> Staff: ${datos.barbero}</div>
                <div><i class="fas fa-clock"></i> ${datos.fecha} a las ${datos.hora} hrs</div>
            </div>

            <div class="linea-tiempo" id="linea-tiempo-uber">
                <div class="barra-progreso-fondo">
                    <div class="barra-progreso-llena" id="barra-progreso"></div>
                </div>

                <div class="paso-tracking activo-nodo" id="paso-1">
                    <div class="icono-nodo"><i class="fas fa-paper-plane"></i></div>
                    <div class="texto-nodo"><h4>Solicitada</h4><p>Enviado a WhatsApp</p></div>
                </div>

                <div class="paso-tracking" id="paso-2">
                    <div class="icono-nodo"><i class="fas fa-check-circle"></i></div>
                    <div class="texto-nodo"><h4>Confirmada</h4><p>Validando tu horario</p></div>
                </div>

                <div class="paso-tracking" id="paso-3">
                    <div class="icono-nodo"><i class="fas fa-chair"></i></div>
                    <div class="texto-nodo"><h4>Listo</h4><p>¡Te vemos en el sillón!</p></div>
                </div>
            </div>

            <div id="contenedor-ticket-wallet" style="display: none;"></div>

            ${(datos.avisos || []).map(a => `<p class="resumen-alerta">${esc(a)}</p>`).join('')}
            ${datos.token ? `<a class="btn-regresar-form enlace-gestion" href="?cita=${datos.token}"><i class="fas fa-link"></i> Gestionar mi cita (confirmar, cancelar o reprogramar)</a>` : ''}

            <button id="btn-regresar-formulario" class="btn-regresar-form">
                <i class="fas fa-arrow-left"></i> Volver / Nueva Cita
            </button>

            <p class="nota-footer-tracking">No cierres esta pestaña para mantener el monitoreo en vivo.</p>
        `;

        contenedorTracking.classList.remove('ocultar-tracking');
        document.getElementById('btn-regresar-formulario').addEventListener('click', restaurarFormulario);

        simularAvanceUber(datos);
    }, 400);
}

function simularAvanceUber(datosCita) {
    const barra = document.getElementById('barra-progreso');
    const paso2 = document.getElementById('paso-2');
    const paso3 = document.getElementById('paso-3');

    setTimeout(() => {
        if (barra && paso2) {
            barra.style.height = '50%';
            paso2.classList.add('activo-nodo');
        }
    }, 4500);

    setTimeout(() => {
        if (barra && paso3) {
            barra.style.height = '100%';
            paso3.classList.add('activo-nodo');

            const textoHeader = document.querySelector('.tracking-header p');
            if (textoHeader) textoHeader.innerHTML = "✨ ¡Turno Verificado con Éxito! Te esperamos.";

            const radar = document.querySelector('.radar-ping');
            if (radar) {
                radar.style.animation = "none";
                radar.style.backgroundColor = "#c5a059";
            }

            setTimeout(() => {
                const lineaTiempo = document.getElementById('linea-tiempo-uber');
                const contenedorTicket = document.getElementById('contenedor-ticket-wallet');

                if (lineaTiempo && contenedorTicket) {
                    lineaTiempo.style.display = 'none';

                    contenedorTicket.innerHTML = `
                        <div class="ticket-wallet-card">
                            <div class="ticket-wallet-header">
                                <span>BARBER PASS</span>
                                <span class="ticket-premium-tag">PREMIUM ACCESS</span>
                            </div>

                            <div class="ticket-wallet-body">
                                <div class="ticket-row">
                                    <div><label>CLIENTE</label><p>${datosCita.nombre}</p></div>
                                    <div><label>SERVICIO</label><p>${datosCita.servicio}</p></div>
                                </div>
                                <div class="ticket-row">
                                    <div><label>FECHA / HORA</label><p>${datosCita.fecha} - ${datosCita.hora} HRS</p></div>
                                    <div><label>BARBERO</label><p>${datosCita.barbero}</p></div>
                                </div>
                                <div class="ticket-row">
                                    <div><label>TOTAL ESTIMADO</label><p class="ticket-precio">${datosCita.precio}</p></div>
                                    <div><label>STATUS</label><p class="ticket-confirmado"><i class="fas fa-check-circle"></i> CONFIRMADO</p></div>
                                </div>
                            </div>

                            <div class="ticket-wallet-qrcode-zone">
                                <div id="qrcode-canvas"></div>
                                <p class="ticket-qr-instruction">Muestra este código al llegar a la recepción</p>
                            </div>
                        </div>
                    `;

                    contenedorTicket.style.display = 'block';

                    // Generar QR si la librería está cargada
                    const stringDatosQR = `CITA CONFIRMADA\nCliente: ${datosCita.nombre}\nServicio: ${datosCita.servicio}\nBarbero: ${datosCita.barbero}\nFecha: ${datosCita.fecha} a las ${datosCita.hora} hrs.\nPrecio: ${datosCita.precio}`;

                    if (typeof QRCode !== 'undefined') {
                        new QRCode(document.getElementById("qrcode-canvas"), {
                            text: stringDatosQR,
                            width: 140,
                            height: 140,
                            colorDark: "#000000",
                            colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.H
                        });
                    } else {
                        // Fallback: mostrar datos como texto si QR no carga
                        const qrDiv = document.getElementById("qrcode-canvas");
                        if (qrDiv) {
                            qrDiv.innerHTML = `<div style="padding: 15px; background: #f0f0f0; border-radius: 8px; text-align: center; font-size: 0.8rem; color: #333;">
                                <i class="fas fa-qrcode" style="font-size: 3rem; color: #999; display: block; margin-bottom: 10px;"></i>
                                <strong>Datos de tu cita guardados</strong><br>
                                ${datosCita.servicio} - ${datosCita.fecha}
                            </div>`;
                        }
                    }
                }
            }, 1500);
        }
    }, 9000);
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
    setTimeout(() => {
        formulario.style.opacity = '1';
    }, 50);
}