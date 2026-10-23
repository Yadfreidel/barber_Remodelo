import { obtenerServicios } from '../models/serviceModel.js';
import { referenciaServicio } from './catalogoController.js';
// ==========================================
// MÓDULOS DEL CLIENTE
// Productos, promociones, referidos, consentimiento, lista de espera
// y gestión de cita por enlace seguro (?cita= ?oferta= ?espera= ?baja=)
// ==========================================

import { montarTarjeta } from '../assets/appointment-card-preview.js';
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { guardarToken, guardarClavePendiente } from '../assets/mis-citas-store.js';
import { formato12h, hoyRD } from '../assets/horario-utils.js';

// Módulos que hacen pasar la reserva por la validación del servidor
const MODULOS_RESERVA_SERVIDOR = ['productos', 'promociones', 'referidos', 'recuperacion'];

const MENSAJES_ERROR = {
    horario_no_disponible: 'Ese horario ya no está disponible, por favor elige otro.',
    precio_cambiado: 'El precio cambió. Revisa el nuevo total y vuelve a confirmar.',
    promocion_no_disponible: 'La promoción se agotó. Revisa el nuevo total y vuelve a confirmar.',
    sin_stock: 'Uno de los productos ya no tiene stock suficiente.',
    cantidad_invalida: 'Cantidad de productos no permitida.',
    modulo_productos_inactivo: 'La venta de productos no está disponible ahora.',
    servicio_o_barbero_no_encontrado: 'El servicio o barbero no está disponible en línea.',
    datos_invalidos: 'Revisa tu nombre y teléfono.',
    fuera_de_plazo: 'Ya no se puede modificar en línea. Por favor contáctanos.',
    cita_cancelada: 'Esta cita está cancelada.',
    cita_completada: 'Esta cita ya fue completada.',
    cita_no_encontrada: 'No encontramos la cita de este enlace.',
    oferta_no_encontrada: 'No encontramos esta oferta.',
    inscripcion_no_encontrada: 'No encontramos esta inscripción.',
    limite_lista_espera: 'Ya tienes el máximo de inscripciones activas en la lista de espera.',
    preferencias_invalidas: 'Revisa las fechas y horas de tu preferencia.',
    modulo_inactivo: 'Esta función no está disponible ahora.',
    enlace_invalido: 'El enlace no es válido.',
    duplicate: 'Ese horario ya no está disponible, por favor elige otro.'
};

const AVISOS_REFERIDO = {
    codigo_invalido: 'El código de referido no es válido; tu cita se registró sin él.',
    autorreferido_no_permitido: 'No puedes usar tu propio código de referido.',
    ya_referido: 'Este teléfono ya fue referido antes.',
    cliente_no_nuevo: 'El código de referido aplica solo a clientes nuevos.',
    referidos_inactivo: 'El programa de referidos no está activo.',
    solicitud_ya_usada: 'Esta solicitud ya se usó para otra cita. Revisa «Mis citas».',
    demasiadas_citas: 'Hay demasiadas citas guardadas en este navegador.'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let config = { instalado: false, modulos: {} };
let configCargada = null;
let ultimaCotizacion = null;

export function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatoPrecio(n) {
    return `RD$ ${Number(n || 0).toLocaleString('es-DO', { maximumFractionDigits: 2 })}`;
}

export function mensajeError(error) {
    const texto = error?.message || '';
    const clave = Object.keys(MENSAJES_ERROR).find(k => texto.includes(k));
    return clave ? MENSAJES_ERROR[clave] : (texto || 'Ocurrió un error inesperado.');
}

export function cargarConfigModulos() {
    if (!configCargada) {
        configCargada = (async () => {
            if (!estaSupabaseListo()) return config;
            try {
                const { data, error } = await supabase.rpc('config_publica');
                if (!error && data) config = data;
                else configCargada = null; // se reintenta en la próxima llamada
            } catch (e) {
                configCargada = null; // sin conexión: se reintenta en la próxima llamada
            }
            return config;
        })();
    }
    return configCargada;
}

export function obtenerConfigModulos() {
    return config;
}

export function moduloActivo(modulo) {
    return Boolean(config.modulos && config.modulos[modulo]);
}

export function usarReservaServidor() {
    return config.instalado || MODULOS_RESERVA_SERVIDOR.some(moduloActivo);
}

function valor(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function claveSeleccion() {
    return ['servicio-select', 'barbero-seleccionado', 'fecha', 'hora-seleccionada'].map(valor).join('|');
}

function productosSeleccionados() {
    return [...document.querySelectorAll('[data-producto]')]
        .map(s => ({ id: s.dataset.producto, cantidad: Number(s.value), precio: Number(s.dataset.precio) }))
        .filter(p => p.cantidad > 0);
}

// Horas de inicio del día con su estado (libre, pasada, no_disponible) y la hora de fin según el servicio
export async function horariosDiaServidor(servicio, barbero, fecha) {
    const { data, error } = await supabase.rpc('horarios_dia_publico', { p_servicio: referenciaServicio(servicio), p_barbero: barbero, p_fecha: fecha });
    if (error) throw error;
    return data;
}

// Sin respuesta del servidor (conexión cortada): la cita pudo guardarse o no
function esFalloDeRed(error) {
    return !error?.code && /fetch|network|load failed|conexi/i.test(String(error?.message || error));
}

// ==========================================
// FORMULARIO DE RESERVA
// ==========================================
export async function inicializarModulosCliente() {
    await cargarConfigModulos();
    if (!config.instalado) return;

    const form = document.getElementById('form-reservas');
    const params = new URLSearchParams(window.location.search);
    if (form) await inyectarExtrasFormulario(form, params.get('ref'));
    await manejarEnlaceEntrante(params);
}

async function inyectarExtrasFormulario(form, codigoRef) {
    const boton = form.querySelector('button[type="submit"]');
    const bloques = [];

    if (moduloActivo('productos')) {
        const { data } = await supabase.rpc('listar_productos');
        const maximo = Number(config.productos?.max_unidades_por_producto) || 5;
        if (data && data.length) {
            bloques.push(`
                <div class="modulo-bloque">
                    <label class="label-fijo"><i class="fas fa-shopping-bag"></i> Productos para retirar en tu cita (opcional):</label>
                    <div class="lista-productos-reserva">
                        ${data.map(p => `
                            <div class="producto-reserva">
                                <div><strong>${esc(p.nombre)}</strong><small>${formatoPrecio(p.precio)}</small></div>
                                ${p.stock > 0
                                    ? `<select data-producto="${esc(p.id)}" data-precio="${Number(p.precio)}" aria-label="Cantidad de ${esc(p.nombre)}">
                                           ${Array.from({ length: Math.min(maximo, p.stock) + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join('')}
                                       </select>`
                                    : '<span class="producto-agotado">Agotado</span>'}
                            </div>`).join('')}
                    </div>
                </div>`);
        }
    }

    if (moduloActivo('referidos')) {
        bloques.push(`
            <div class="form-group">
                <input type="text" id="codigo-referido" placeholder=" " maxlength="12" value="${esc(codigoRef || '')}">
                <label for="codigo-referido">Código de referido (opcional)</label>
            </div>`);
    }

    if (moduloActivo('recuperacion')) {
        bloques.push(`
            <label class="check-consentimiento">
                <input type="checkbox" id="consentimiento-marketing">
                <span>Acepto recibir promociones por WhatsApp. Puedo darme de baja en cualquier momento.</span>
            </label>`);
    }

    if (usarReservaServidor()) {
        bloques.push(`<div id="resumen-precio" class="resumen-precio" aria-live="polite"></div>`);
    }

    if (bloques.length) {
        const contenedor = document.createElement('div');
        contenedor.id = 'modulos-reserva';
        contenedor.className = 'modulos-reserva';
        contenedor.innerHTML = bloques.join('');
        form.insertBefore(contenedor, boton);
    }

    if (moduloActivo('lista_espera')) {
        const espera = document.createElement('div');
        espera.className = 'bloque-lista-espera';
        espera.innerHTML = plantillaListaEspera();
        form.appendChild(espera);
        configurarListaEspera(espera);
    }

    if (usarReservaServidor()) {
        form.addEventListener('change', e => {
            if (e.target.id === 'servicio-select' && window.generarPildorasDeTiempo) window.generarPildorasDeTiempo();
            actualizarResumen();
        });
        // Barbero y hora se eligen con clics sobre tarjetas y píldoras
        document.addEventListener('click', e => {
            if (e.target.closest('.pildora-hora, .card-barbero')) setTimeout(actualizarResumen, 0);
        });
        actualizarResumen();
    }
}

export async function actualizarResumen() {
    const caja = document.getElementById('resumen-precio');
    if (!caja) return;
    const clave = claveSeleccion();
    const [servicio, barbero, fecha, hora] = clave.split('|');
    const totalProductos = productosSeleccionados().reduce((s, p) => s + p.cantidad * p.precio, 0);

    if (!servicio || !barbero || !fecha || !hora) {
        caja.setAttribute?.('aria-busy', 'false');
        ultimaCotizacion = null;
        const elegido = obtenerServicios().find(s => s.nombre === servicio);
        caja.innerHTML = elegido && typeof elegido.precio === 'number' ? `<div class="resumen-linea"><span>${esc(elegido.nombre)}</span><span>${formatoPrecio(elegido.precio)}</span></div><div class="resumen-linea"><span>Duracion</span><span>${Number(elegido.duracion_minutos)} min</span></div><p class="resumen-pendiente">Selecciona profesional, fecha y hora para confirmar el total.</p>` : '<p class="resumen-pendiente">Selecciona un corte.</p>';
        return;
    }

    caja.setAttribute?.('aria-busy', 'true');
    const { data, error } = await supabase.rpc('cotizar_cita', { p_servicio: referenciaServicio(servicio), p_barbero: barbero, p_fecha: fecha, p_hora: hora });
    if (clave !== claveSeleccion()) return; // la selección cambió mientras se cotizaba

    caja.setAttribute?.('aria-busy', 'false');
    if (error) {
        ultimaCotizacion = null;
        caja.innerHTML = `<p class="resumen-pendiente">El total se confirmará al reservar.</p>`;
        return;
    }
    ultimaCotizacion = { clave, datos: data };
    const descuento = Number(data.descuento);
    caja.innerHTML = `
        <div class="resumen-linea"><span>Servicio</span><span>${formatoPrecio(data.precio_base)}</span></div>
        <div class="resumen-linea"><span>Duracion</span><span>${Number(data.duracion_minutos)} min</span></div>
        ${descuento > 0 ? `<div class="resumen-linea resumen-descuento"><span><i class="fas fa-tag"></i> ${esc(data.promocion_nombre)}</span><span>- ${formatoPrecio(descuento)}</span></div>` : ''}
        ${totalProductos > 0 ? `<div class="resumen-linea"><span>Productos (retiro en tienda)</span><span>${formatoPrecio(totalProductos)}</span></div>` : ''}
        <div class="resumen-linea resumen-total"><span>Total a pagar</span><span>${formatoPrecio(Number(data.precio_final) + totalProductos)}</span></div>
        ${data.disponible ? '' : '<p class="resumen-alerta"><i class="fas fa-exclamation-triangle"></i> Este horario ya no está disponible.</p>'}`;
}

// Reserva validada en servidor (precio, promoción, stock, referido). Devuelve null si falla.
export async function reservarEnServidor(datos, mostrarAlerta) {
    if (!ultimaCotizacion || ultimaCotizacion.clave !== claveSeleccion() || !ultimaCotizacion.datos.disponible) {
        await actualizarResumen();
        mostrarAlerta(ultimaCotizacion && !ultimaCotizacion.datos.disponible
            ? MENSAJES_ERROR.horario_no_disponible
            : 'Revisa el total de tu reserva y vuelve a confirmar.');
        return null;
    }

    const codigo = document.getElementById('codigo-referido');
    const consentimiento = document.getElementById('consentimiento-marketing');
    // El cliente de Supabase devuelve el fallo de red como `error`; el catch cubre cualquier excepción
    const { data, error } = await Promise.resolve(supabase.rpc('reservar_cita', {
        p_nombre: datos.nombre,
        p_email: null,
        p_telefono: datos.telefono,
        p_servicio: referenciaServicio(datos.servicio),
        p_barbero: datos.barbero,
        p_fecha: datos.fecha,
        p_hora: datos.hora,
        p_productos: productosSeleccionados().map(({ id, cantidad }) => ({ id, cantidad })),
        p_codigo_referido: codigo ? codigo.value.trim() || null : null,
        p_consentimiento: Boolean(consentimiento && consentimiento.checked),
        p_precio_esperado: ultimaCotizacion.datos.precio_final,
        p_clave_solicitud: datos.clave || null
    })).catch(e => ({ error: e }));

    if (error && esFalloDeRed(error) && datos.clave) {
        // Se comprobará en «Mis citas»; reintentar con la misma selección no crea otra cita
        guardarClavePendiente(datos.clave);
        mostrarAlerta('No pudimos confirmar si tu cita se guardó por un problema de conexión. Vuelve a pulsar «Confirmar cita» o revisa «Mis citas»: no se duplicará.');
        return null;
    }
    if (error) {
        mostrarAlerta(mensajeError(error));
        if (/horario_no_disponible|duplicate|23505/.test(error.message + error.code) && window.generarPildorasDeTiempo) {
            window.generarPildorasDeTiempo();
        }
        if (/precio_cambiado|promocion_no_disponible|sin_stock/.test(error.message)) actualizarResumen();
        return null;
    }

    data.productos = productosSeleccionados();
    data.avisos = (data.avisos || []).map(a => AVISOS_REFERIDO[a] || a);
    return data;
}

// ==========================================
// LISTA DE ESPERA (inscripción)
// ==========================================
function plantillaListaEspera() {
    const hoy = new Date().toISOString().split('T')[0];
    return `
        <button type="button" class="btn-lista-espera" id="btn-abrir-espera">
            <i class="fas fa-hourglass-half"></i> ¿No hay horario? Únete a la lista de espera
        </button>
        <div class="form-espera" id="form-espera" hidden>
            <p class="nota-espera">Usaremos tu nombre, teléfono y el servicio elegidos arriba. Si se libera un espacio te lo ofreceremos en orden de inscripción.</p>
            <div class="espera-grid">
                <label>Desde<input type="date" id="espera-desde" min="${hoy}" value="${hoy}"></label>
                <label>Hasta<input type="date" id="espera-hasta" min="${hoy}" value="${hoy}"></label>
                <label>Hora desde<input type="time" id="espera-hora-desde" value="${esc(config.general?.hora_apertura || '09:00')}"></label>
                <label>Hora hasta<input type="time" id="espera-hora-hasta" value="19:00"></label>
            </div>
            <label class="check-consentimiento"><input type="checkbox" id="espera-cualquier-barbero" checked> <span>Cualquier barbero (desmarca para usar el elegido arriba)</span></label>
            <button type="button" class="btn-admin-accion" id="btn-unirse-espera"><i class="fas fa-check"></i> Unirme a la lista</button>
            <div id="resultado-espera"></div>
        </div>`;
}

function configurarListaEspera(bloque) {
    const panel = bloque.querySelector('#form-espera');
    bloque.querySelector('#btn-abrir-espera').addEventListener('click', () => { panel.hidden = !panel.hidden; });
    bloque.querySelector('#btn-unirse-espera').addEventListener('click', async () => {
        const resultado = bloque.querySelector('#resultado-espera');
        const cualquiera = bloque.querySelector('#espera-cualquier-barbero').checked;
        if (!valor('nombre') || !valor('telefono') || !valor('servicio-select')) {
            resultado.innerHTML = '<p class="resumen-alerta">Completa nombre, teléfono y servicio en el formulario.</p>';
            return;
        }
        if (!cualquiera && !valor('barbero-seleccionado')) {
            resultado.innerHTML = '<p class="resumen-alerta">Elige un barbero arriba o marca "Cualquier barbero".</p>';
            return;
        }
        const { data, error } = await supabase.rpc('unirse_lista_espera', {
            p_nombre: valor('nombre'),
            p_telefono: valor('telefono'),
            p_email: valor('email') || null,
            p_servicio: referenciaServicio(valor('servicio-select')),
            p_barbero: cualquiera ? null : valor('barbero-seleccionado'),
            p_fecha_desde: valor('espera-desde'),
            p_fecha_hasta: valor('espera-hasta'),
            p_hora_desde: valor('espera-hora-desde'),
            p_hora_hasta: valor('espera-hora-hasta')
        });
        if (error) {
            resultado.innerHTML = `<p class="resumen-alerta">${esc(mensajeError(error))}</p>`;
            return;
        }
        const enlace = `${window.location.pathname}?espera=${data.token}`;
        resultado.innerHTML = `
            <p class="resumen-ok"><i class="fas fa-check-circle"></i> Estás en la lista de espera.
            ${moduloActivo('whatsapp') ? 'Te avisaremos por WhatsApp si se libera un espacio.' : 'Guarda este enlace para revisar si tienes una oferta.'}</p>
            <a class="enlace-gestion" href="${esc(enlace)}">Ver mi inscripción</a>`;
    });
}

// ==========================================
// PÁGINAS DE GESTIÓN POR ENLACE SEGURO
// ==========================================
async function manejarEnlaceEntrante(params) {
    const tipos = { cita: renderCita, oferta: renderOferta, espera: renderEspera, baja: renderBaja };
    const tipo = Object.keys(tipos).find(k => params.get(k));
    if (!tipo) return false;

    const panel = mostrarPanel();
    if (!panel) return false;
    const token = params.get(tipo);
    if (!UUID.test(token)) {
        panel.innerHTML = plantillaAviso(MENSAJES_ERROR.enlace_invalido);
        return true;
    }
    await tipos[tipo](panel, token);
    return true;
}

function mostrarPanel() {
    const form = document.getElementById('form-reservas');
    const panel = document.getElementById('pantalla-seguimiento');
    if (!form || !panel) return null;
    form.style.display = 'none';
    panel.classList.remove('ocultar-tracking');
    panel.innerHTML = '<p class="placeholder-horas">Cargando...</p>';
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return panel;
}

function plantillaAviso(texto) {
    return `
        <div class="panel-gestion">
            <p class="resumen-alerta"><i class="fas fa-info-circle"></i> ${esc(texto)}</p>
            ${botonNuevaReserva()}
        </div>`;
}

function botonNuevaReserva() {
    return `<a class="btn-regresar-form enlace-gestion" href="${esc(window.location.pathname)}#contacto"><i class="fas fa-arrow-left"></i> Hacer una nueva reserva</a>`;
}

function estadoCita(c) {
    if (c.estado === 'cancelada') return ['Cancelada', 'badge-cancelada'];
    if (c.completada) return ['Completada', 'badge-confirmada'];
    if (c.estado === 'confirmada') return ['Confirmada por la barbería', 'badge-confirmada'];
    return ['Pendiente de confirmación', 'badge-pendiente'];
}

async function renderCita(panel, token) {
    const { data: c, error } = await supabase.rpc('consultar_cita', { p_token: token });
    if (error) {
        panel.innerHTML = plantillaAviso(mensajeError(error));
        return;
    }
    guardarToken(token); // la cita abierta con su enlace privado aparece también en «Mis citas»
    const [textoEstado, claseEstado] = estadoCita(c);
    const fecha = String(c.fecha).split('-').reverse().join('/');
    const totalProductos = Number(c.total_productos || 0);

    panel.innerHTML = `
        <div class="panel-gestion">
            <div class="tracking-header">
                <h3>Tu Cita</h3>
                <p>Hola <span>${esc(c.nombre)}</span></p>
                <span class="badge-estado ${claseEstado}">${textoEstado}</span>
                ${c.cliente_confirmo && c.estado !== 'cancelada' ? '<p class="resumen-ok"><i class="fas fa-check"></i> Confirmaste tu asistencia</p>' : ''}
            </div>
            <div class="resumen-ticket">
                <div><i class="fas fa-cut"></i> ${esc(c.servicio)}</div>
                <div><i class="fas fa-user-tie"></i> Staff: ${esc(c.barbero)}</div>
                <div><i class="fas fa-clock"></i> ${esc(fecha)} a las ${esc(formato12h(c.hora))}</div>
            </div>
            ${c.precio_final !== null ? `
                <div class="resumen-precio">
                    <div class="resumen-linea"><span>Servicio</span><span>${formatoPrecio(c.precio_base)}</span></div>
                    ${Number(c.descuento) > 0 ? `<div class="resumen-linea resumen-descuento"><span>Promoción</span><span>- ${formatoPrecio(c.descuento)}</span></div>` : ''}
                    ${c.productos.map(p => `<div class="resumen-linea"><span>${esc(p.cantidad)} × ${esc(p.nombre)} ${p.estado === 'devuelto' ? '(devuelto)' : ''}</span><span>${formatoPrecio(p.subtotal)}</span></div>`).join('')}
                    <div class="resumen-linea resumen-total"><span>Total</span><span>${formatoPrecio(Number(c.precio_final) + (c.estado === 'cancelada' ? 0 : totalProductos))}</span></div>
                </div>` : ''}
            ${c.beneficios.length ? `<p class="resumen-ok"><i class="fas fa-gift"></i> Tienes ${c.beneficios.length} beneficio(s) por referidos; menciónalo al pagar.</p>` : ''}
            <div class="acciones-gestion">
                ${c.modificable && !c.cliente_confirmo ? '<button class="btn-admin-accion" data-accion="confirmar"><i class="fas fa-check"></i> Confirmar asistencia</button>' : ''}
                ${c.modificable ? '<button class="btn-admin-accion" data-accion="reprogramar"><i class="fas fa-calendar-alt"></i> Reprogramar</button>' : ''}
                ${c.modificable ? '<button class="btn-danger" data-accion="cancelar"><i class="fas fa-times"></i> Cancelar cita</button>' : ''}
                ${c.referidos_activo ? '<button class="btn-admin-accion" data-accion="referido"><i class="fas fa-user-friends"></i> Mi código de referido</button>' : ''}
            </div>
            ${!c.modificable && c.estado !== 'cancelada' && !c.completada ? `<p class="nota-espera">${MENSAJES_ERROR.fuera_de_plazo}</p>` : ''}
            <div id="zona-gestion"></div>
            ${botonNuevaReserva()}
        </div>`;

    // La tarjeta usa exclusivamente los datos guardados devueltos por consultar_cita.
    montarTarjeta(panel.querySelector('.panel-gestion'), c, { urlPublica: window.location.href, token });

    const zona = panel.querySelector('#zona-gestion');
    const recargar = () => renderCita(panel, token);
    const ejecutar = async (fn, args) => {
        const { error: err } = await supabase.rpc(fn, args);
        if (err) zona.innerHTML = `<p class="resumen-alerta">${esc(mensajeError(err))}</p>`;
        else recargar();
    };

    panel.querySelectorAll('[data-accion]').forEach(btn => btn.addEventListener('click', async () => {
        const accion = btn.dataset.accion;
        if (accion === 'confirmar') ejecutar('confirmar_cita', { p_token: token });
        if (accion === 'cancelar' && confirm('¿Seguro que deseas cancelar tu cita?')) ejecutar('cancelar_cita', { p_token: token });
        if (accion === 'reprogramar') mostrarReprogramacion(zona, token, recargar);
        if (accion === 'referido') {
            const { data, error: err } = await supabase.rpc('mi_codigo_referido', { p_token: token });
            if (err) {
                zona.innerHTML = `<p class="resumen-alerta">${esc(mensajeError(err))}</p>`;
                return;
            }
            const enlace = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(data.codigo)}#contacto`;
            const beneficio = config.referidos?.beneficio_tipo === 'monto'
                ? formatoPrecio(config.referidos?.beneficio_valor)
                : `${Number(config.referidos?.beneficio_valor || 0)}%`;
            zona.innerHTML = `
                <div class="resumen-precio">
                    <p>Tu código: <strong class="codigo-referido">${esc(data.codigo)}</strong></p>
                    <p class="nota-espera">Comparte este enlace. Recibes ${esc(beneficio)} de beneficio cuando un cliente nuevo complete y pague su primera visita.</p>
                    <input type="text" readonly value="${esc(enlace)}" class="input-enlace" onclick="this.select()">
                </div>`;
        }
    }));
}

function mostrarReprogramacion(zona, token, recargar) {
    const hoy = hoyRD();
    zona.innerHTML = `
        <div class="resumen-precio">
            <label class="label-fijo">Nueva fecha:</label>
            <input type="date" id="reprog-fecha" min="${hoy}">
            <div id="reprog-horas" class="grid-horas"></div>
            <div id="reprog-confirmar"></div>
        </div>`;
    const inputFecha = zona.querySelector('#reprog-fecha');
    const horas = zona.querySelector('#reprog-horas');
    const confirmar = zona.querySelector('#reprog-confirmar');

    inputFecha.addEventListener('change', async () => {
        confirmar.innerHTML = '';
        const { data, error } = await supabase.rpc('horarios_reprogramacion', { p_token: token, p_fecha: inputFecha.value });
        if (error || !data.length) {
            horas.innerHTML = `<p class="placeholder-horas">${error ? esc(mensajeError(error)) : 'No hay horarios libres ese día.'}</p>`;
            return;
        }
        horas.innerHTML = data.map(h => `<div class="pildora-hora" data-hora="${esc(h)}">${esc(formato12h(h))}</div>`).join('');
        horas.querySelectorAll('.pildora-hora').forEach(p => p.addEventListener('click', async () => {
            horas.querySelectorAll('.pildora-hora').forEach(x => x.classList.remove('pildora-activa'));
            p.classList.add('pildora-activa');
            const { data: q, error: err } = await supabase.rpc('cotizar_reprogramacion', { p_token: token, p_fecha: inputFecha.value, p_hora: p.dataset.hora });
            if (err || !q.disponible) {
                confirmar.innerHTML = `<p class="resumen-alerta">${esc(err ? mensajeError(err) : MENSAJES_ERROR.horario_no_disponible)}</p>`;
                return;
            }
            confirmar.innerHTML = `
                <div class="resumen-linea resumen-total"><span>Nuevo precio del servicio</span><span>${formatoPrecio(q.precio_final)}</span></div>
                <button class="btn-admin-accion" id="btn-confirmar-reprog"><i class="fas fa-check"></i> Confirmar cambio a las ${esc(formato12h(p.dataset.hora))}</button>`;
            confirmar.querySelector('#btn-confirmar-reprog').addEventListener('click', async () => {
                const { error: e2 } = await supabase.rpc('reprogramar_cita', {
                    p_token: token, p_fecha: inputFecha.value, p_hora: p.dataset.hora, p_precio_esperado: q.precio_final
                });
                if (e2) confirmar.innerHTML = `<p class="resumen-alerta">${esc(mensajeError(e2))}</p>`;
                else recargar();
            });
        }));
    });
}

async function renderOferta(panel, token) {
    const { data: o, error } = await supabase.rpc('consultar_oferta', { p_token: token });
    if (error) {
        panel.innerHTML = plantillaAviso(mensajeError(error));
        return;
    }
    if (o.estado === 'aceptada' && o.cita_token) {
        window.location.search = `?cita=${o.cita_token}`;
        return;
    }
    const fecha = String(o.fecha).split('-').reverse().join('/');
    const vigente = o.estado === 'pendiente';
    const vence = new Date(o.expira_en).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    panel.innerHTML = `
        <div class="panel-gestion">
            <div class="tracking-header">
                <h3>Espacio disponible</h3>
                <p>Hola <span>${esc(o.nombre)}</span>, se liberó un espacio para ti.</p>
            </div>
            <div class="resumen-ticket">
                <div><i class="fas fa-cut"></i> ${esc(o.servicio)}</div>
                <div><i class="fas fa-user-tie"></i> Staff: ${esc(o.barbero)}</div>
                <div><i class="fas fa-clock"></i> ${esc(fecha)} a las ${esc(o.hora)} hrs</div>
            </div>
            ${vigente
                ? `<p class="nota-espera">La oferta vence a las ${esc(vence)}.</p>
                   <div class="acciones-gestion">
                       <button class="btn-admin-accion" id="btn-aceptar-oferta"><i class="fas fa-check"></i> Aceptar</button>
                       <button class="btn-danger" id="btn-rechazar-oferta"><i class="fas fa-times"></i> No me sirve</button>
                   </div>`
                : `<p class="resumen-alerta">Esta oferta ya no está vigente (${esc(o.estado)}).</p>`}
            <div id="zona-gestion"></div>
            ${botonNuevaReserva()}
        </div>`;
    if (!vigente) return;

    const zona = panel.querySelector('#zona-gestion');
    panel.querySelector('#btn-aceptar-oferta').addEventListener('click', async () => {
        const { data, error: err } = await supabase.rpc('aceptar_oferta', { p_token: token });
        if (err || !data.ok) {
            zona.innerHTML = `<p class="resumen-alerta">${esc(err ? mensajeError(err) : (data.error === 'oferta_vencida' ? 'La oferta venció.' : MENSAJES_ERROR.horario_no_disponible))}</p>`;
            return;
        }
        window.location.search = `?cita=${data.token}`;
    });
    panel.querySelector('#btn-rechazar-oferta').addEventListener('click', async () => {
        await supabase.rpc('rechazar_oferta', { p_token: token });
        renderOferta(panel, token);
    });
}

async function renderEspera(panel, token) {
    const { data: e, error } = await supabase.rpc('consultar_lista_espera', { p_token: token });
    if (error) {
        panel.innerHTML = plantillaAviso(mensajeError(error));
        return;
    }
    const estados = {
        activa: 'Esperando un espacio', ofertada: 'Tienes un espacio ofrecido', aceptada: 'Espacio aceptado',
        cancelada: 'Inscripción cancelada', vencida: 'Inscripción vencida'
    };
    const rango = d => String(d).split('-').reverse().join('/');
    panel.innerHTML = `
        <div class="panel-gestion">
            <div class="tracking-header">
                <h3>Lista de Espera</h3>
                <p>Hola <span>${esc(e.nombre)}</span></p>
                <span class="badge-estado ${e.estado === 'activa' || e.estado === 'ofertada' ? 'badge-pendiente' : e.estado === 'aceptada' ? 'badge-confirmada' : 'badge-cancelada'}">${estados[e.estado] || esc(e.estado)}</span>
            </div>
            <div class="resumen-ticket">
                <div><i class="fas fa-cut"></i> ${esc(e.servicio)}</div>
                <div><i class="fas fa-user-tie"></i> ${esc(e.barbero)}</div>
                <div><i class="fas fa-calendar"></i> ${esc(rango(e.fecha_desde))} – ${esc(rango(e.fecha_hasta))}, ${esc(e.hora_desde)} a ${esc(e.hora_hasta)}</div>
            </div>
            <div class="acciones-gestion">
                ${e.oferta ? `<a class="btn-admin-accion" href="?oferta=${esc(e.oferta.token)}"><i class="fas fa-bell"></i> Ver espacio ofrecido</a>` : ''}
                ${e.estado === 'activa' || e.estado === 'ofertada' ? '<button class="btn-danger" id="btn-salir-espera"><i class="fas fa-times"></i> Salir de la lista</button>' : ''}
            </div>
            ${botonNuevaReserva()}
        </div>`;
    const salir = panel.querySelector('#btn-salir-espera');
    if (salir) salir.addEventListener('click', async () => {
        if (!confirm('¿Salir de la lista de espera?')) return;
        await supabase.rpc('cancelar_lista_espera', { p_token: token });
        renderEspera(panel, token);
    });
}

async function renderBaja(panel, token) {
    // Requiere un clic: los visores de enlaces no deben dar de baja por accidente
    panel.innerHTML = `
        <div class="panel-gestion">
            <div class="tracking-header"><h3>Mensajes promocionales</h3></div>
            <p class="nota-espera">Dejarás de recibir promociones por WhatsApp. Los recordatorios de tus citas no se ven afectados.</p>
            <div class="acciones-gestion"><button class="btn-danger" id="btn-confirmar-baja">Darme de baja</button></div>
            <div id="zona-gestion"></div>
            ${botonNuevaReserva()}
        </div>`;
    panel.querySelector('#btn-confirmar-baja').addEventListener('click', async () => {
        const { error } = await supabase.rpc('darse_de_baja', { p_token: token });
        panel.querySelector('#zona-gestion').innerHTML = error
            ? `<p class="resumen-alerta">${esc(mensajeError(error))}</p>`
            : '<p class="resumen-ok"><i class="fas fa-check-circle"></i> Listo, ya no recibirás promociones.</p>';
    });
}
