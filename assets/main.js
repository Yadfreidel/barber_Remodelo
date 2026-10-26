import { conectarDetalles, coincideCorte, fotoCorte, escapar } from './catalogue-ui.js';
import { cargarCatalogoServidor } from '../controllers/catalogoController.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { obtenerBarberos } from '../models/barberModel.js';
import { procesarCita } from '../controllers/appointmentController.js';
import { verificarAccesoAdmin, cerrarDashboard, abrirPanelDesdeEnlace } from '../controllers/adminController.js';
import { estaSupabaseListo } from './supabaseClient.js';
import { inicializarUbicacionCliente } from '../controllers/ubicacionController.js';
import { cargarBarberosServidor, aplicarNegocioPublico } from '../controllers/publicoController.js';
import { inicializarModulosCliente, horariosDiaServidor, obtenerConfigModulos, mensajeError } from '../controllers/modulosController.js';
import { hoyRD, formato12h, rango12h, franja, FRANJAS, cuadricula } from './horario-utils.js';
import { leerBorrador, guardarBorrador } from './mis-citas-store.js';
import { abrirPerfilBarbero } from '../controllers/perfilBarberoController.js';

// ==========================================
// ELEMENTOS DEL DOM
// ==========================================
const gridServicios = document.getElementById('grid-dinamico-servicios');
const gridStaff = document.getElementById('grid-dinamico-staff');
const selectServicios = document.getElementById('servicio-select');
const inputBarbero = document.getElementById('barbero-seleccionado');
const inputHora = document.getElementById('hora-seleccionada');
const inputFecha = document.getElementById('fecha');
const contenedorHoras = document.getElementById('contenedor-horas');
const formulario = document.getElementById('form-reservas');
const botonesFiltro = document.querySelectorAll('.btn-filtro');

const btnFlotanteAdmin = document.getElementById('btn-flotante-admin');
const btnCerrarDash = document.getElementById('btn-cerrar-dashboard');
const menuToggle = document.getElementById('menu-toggle');
const navLinks = document.getElementById('nav-links');

// ==========================================
// INICIALIZACIÓN PRINCIPAL
// ==========================================
async function inicializarPagina() {
    configurarAccesoAdmin();
    configurarMenuMobile();
    if (inputFecha) {
        // Fecha de República Dominicana, no la UTC del dispositivo
        inputFecha.min = hoyRD();
        inputFecha.addEventListener('change', () => { generarPildorasDeTiempo(); guardarSeleccion(); });
    }
    selectServicios?.addEventListener('change', () => { if (inputFecha?.value) generarPildorasDeTiempo(); guardarSeleccion(); });

    const catalogoActualizado = await cargarCatalogoServidor();
    document.getElementById('catalogo-aviso').hidden = catalogoActualizado;
    try { await inicializarModulosCliente(); }
    catch { document.getElementById('catalogo-aviso').hidden = false; }
    renderizarServicios();
    window.dispatchEvent(new Event('catalogo-listo'));
    await cargarBarberosServidor();
    renderizarStaff();
    aplicarNegocioPublico();
    configurarFiltros();
    conectarDetalles(obtenerServicios);
    inicializarUbicacionCliente();
    restaurarBorrador();
}

// ==========================================
// BORRADOR (selección sin reservar: no aparta el horario)
// ==========================================
let horaDelBorrador = null;
let restaurando = false;

function guardarSeleccion() {
    if (restaurando) return;
    guardarBorrador({ servicio: selectServicios?.value || '', barbero: inputBarbero.value, fecha: inputFecha?.value || '', hora: inputHora.value });
}

function restaurarBorrador() {
    const borrador = leerBorrador();
    if (!borrador || !selectServicios || selectServicios.value
        || ![...selectServicios.options].some(o => o.value === borrador.servicio)) return;
    selectServicios.value = borrador.servicio;
    restaurando = true;
    try { selectServicios.dispatchEvent(new Event('change', { bubbles: true })); } finally { restaurando = false; }
    const tarjeta = [...document.querySelectorAll('.card-barbero')]
        .find(t => t.querySelector('.btn-seleccionar-barbero')?.dataset.nombre === borrador.barbero);
    if (tarjeta) {
        tarjeta.classList.add('barbero-activo');
        inputBarbero.value = borrador.barbero;
    }
    if (borrador.fecha && borrador.fecha >= hoyRD() && inputFecha) {
        inputFecha.value = borrador.fecha;
        horaDelBorrador = borrador.hora || null;
        generarPildorasDeTiempo();
    }
    window.dispatchEvent(new Event('borrador-restaurado'));
}

// «Reservar con este barbero» (perfil): selecciona su tarjeta como si se pulsara y retoma la reserva
window.addEventListener('reservar-con-barbero', e => {
    const boton = [...document.querySelectorAll('.btn-seleccionar-barbero')].find(b => b.dataset.nombre === e.detail.nombre);
    if (!boton) return;
    boton.click();
    const barbero = obtenerBarberos().find(b => b.nombre === e.detail.nombre);
    const servicio = obtenerServicios().find(s => s.nombre === selectServicios?.value);
    if (servicio && Array.isArray(servicio.barberos) && servicio.barberos.length && !servicio.barberos.map(String).includes(String(barbero?.barbero_id))) {
        selectServicios.value = '';
        selectServicios.dispatchEvent(new Event('change', { bubbles: true }));
    }
    location.hash = 'contacto';
    window.dispatchEvent(new Event('continuar-borrador'));
});

window.addEventListener('borrador-descartado', () => {
    if (!formulario) return;
    formulario.reset();
    inputBarbero.value = '';
    inputHora.value = '';
    document.querySelectorAll('.card-barbero').forEach(t => t.classList.remove('barbero-activo'));
    if (contenedorHoras) contenedorHoras.innerHTML = '<p class="placeholder-horas">Por favor, selecciona una fecha primero...</p>';
});

// Exponer función global para que el admin panel recargue la página
window.recargarPaginaPrincipal = async function () {
    await cargarCatalogoServidor();
    renderizarServicios();
    window.dispatchEvent(new Event('catalogo-listo'));
    await cargarBarberosServidor();
    renderizarStaff();
};

// ==========================================
// RENDERIZADO DE SERVICIOS
// ==========================================
function renderizarServicios() {
    if (!gridServicios) return;

    const servicios = obtenerServicios();
    const seleccionAnterior = selectServicios?.value;
    gridServicios.innerHTML = '';
    if (selectServicios) {
        selectServicios.innerHTML = '<option value="" disabled selected>-- Elige un corte del catálogo --</option>';
    }

    servicios.forEach(servicio => {
        const card = document.createElement('div');
        card.classList.add('card-servicio', 'animate-on-scroll');
        card.setAttribute('data-cat', servicio.categoria);
        card.dataset.servicioId = servicio.id;
        card.innerHTML = `
            ${fotoCorte(servicio)}
            <div class="card-info">
                <p class="editorial-eyebrow">${escapar(servicio.categoria)}</p>
                <h3>${escapar(servicio.nombre)}</h3>
                <p class="corte-descripcion">${escapar(servicio.descripcion)}</p>
                <div class="corte-tarifa"><span class="precio-tag">${escapar(formatoPrecioServicio(servicio.precio))}</span>
                ${servicio.duracion_minutos ? `<span class="duracion-servicio">${servicio.duracion_minutos} min</span>` : ''}</div>
                <div class="corte-acciones">
                    <button type="button" class="btn-ver-detalle" data-detalle="${escapar(servicio.id)}" aria-label="Ver detalles de ${escapar(servicio.nombre)}">Ver detalles <span aria-hidden="true">&#8599;</span></button>
                    <button type="button" class="btn-card-reserva" data-nombre="${escapar(servicio.nombre)}" aria-pressed="${seleccionAnterior === servicio.nombre}">${seleccionAnterior === servicio.nombre ? '&#10003; Seleccionado' : 'Elegir y reservar'}</button>
                </div>
            </div>`;
        gridServicios.appendChild(card);

        if (selectServicios) {
            const opcion = document.createElement('option');
            opcion.value = servicio.nombre;
            opcion.textContent = `${servicio.nombre} (${formatoPrecioServicio(servicio.precio)}${servicio.duracion_minutos ? ` / ${servicio.duracion_minutos} min` : ''})`;
            selectServicios.appendChild(opcion);
        }
    });

    if (seleccionAnterior && servicios.some(s => s.nombre === seleccionAnterior)) selectServicios.value = seleccionAnterior;
    gridServicios.setAttribute('aria-busy', 'false');

    // Event listeners para botones "Elegir Este"
    document.querySelectorAll('.btn-card-reserva').forEach(boton => {
        boton.addEventListener('click', (e) => {
            if (selectServicios) {
                selectServicios.value = e.target.getAttribute('data-nombre');
                selectServicios.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const staffSection = document.getElementById('staff-seccion');
            window.dispatchEvent(new CustomEvent('reservar-servicio'));
        });
    });

    // Reaplicar filtro activo
    const categoriaActual = document.getElementById('category-select')?.value;
    if (categoriaActual) aplicarFiltro(categoriaActual);
    const filtroActivo = categoriaActual ? null : document.querySelector('.btn-filtro.activo');
    if (filtroActivo) {
        const cat = filtroActivo.getAttribute('data-categoria');
        aplicarFiltro(cat);
    }


}

// ==========================================
// RENDERIZADO DE STAFF
// ==========================================
function renderizarStaff() {
    if (!gridStaff) return;

    const barberos = obtenerBarberos();
    gridStaff.innerHTML = '';

    barberos.forEach(barbero => {
        const cardBarbero = document.createElement('div');
        cardBarbero.classList.add('card-barbero', 'animate-on-scroll');
        cardBarbero.innerHTML = `
            <div class="barbero-img-contenedor">
                <img src="${escapar(barbero.imagen)}" alt="${escapar(barbero.nombre)}" loading="lazy"
                     onerror="this.src='https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop'">
            </div>
            <div class="barbero-info">
                <h4>${escapar(barbero.nombre)}</h4>
                <p>${escapar(barbero.especialidad)}</p>
                <button type="button" class="btn-seleccionar-barbero" data-nombre="${escapar(barbero.nombre)}">Seleccionar</button>
                ${barbero.barbero_id ? `<button type="button" class="btn-perfil-barbero" data-perfil="${escapar(barbero.nombre)}">Ver perfil${barbero.trabajos ? ` y trabajos (${barbero.trabajos})` : ''}</button>` : ''}
            </div>
        `;
        gridStaff.appendChild(cardBarbero);
    });

    configurarSeleccionBarberos();
    gridStaff.querySelectorAll('[data-perfil]').forEach(b => b.addEventListener('click', () => {
        const barbero = obtenerBarberos().find(x => x.nombre === b.dataset.perfil);
        if (barbero) abrirPerfilBarbero(barbero);
    }));
    configurarTouchBarberos();
}

// ==========================================
// HORAS DE INICIO (cada 30 min, según el servidor)
// ==========================================
// El intervalo de inicio no es la duración: cada píldora muestra inicio y fin del servicio elegido.
let turnoPildoras = 0;

function mensajeHoras(texto, conReintento = false) {
    contenedorHoras.classList.remove('horas-agrupadas');
    contenedorHoras.innerHTML = `<p class="placeholder-horas">${texto}</p>${conReintento ? '<button type="button" class="btn-reintentar-horas">Reintentar</button>' : ''}`;
    contenedorHoras.querySelector('.btn-reintentar-horas')?.addEventListener('click', generarPildorasDeTiempo);
}

export async function generarPildorasDeTiempo() {
    if (!contenedorHoras) return;
    const turno = ++turnoPildoras;
    inputHora.value = '';
    contenedorHoras.setAttribute('aria-busy', 'false');

    if (!inputFecha || !inputFecha.value) {
        mensajeHoras('Por favor, selecciona una fecha primero...');
        return;
    }
    const fechaSeleccionada = inputFecha.value;
    const barberoNombre = inputBarbero ? inputBarbero.value : '';
    const servicioNombre = selectServicios ? selectServicios.value : '';
    if (!servicioNombre || !barberoNombre) {
        mensajeHoras('Elige primero el servicio y el barbero para ver sus horas disponibles.');
        return;
    }

    contenedorHoras.setAttribute('aria-busy', 'true');
    contenedorHoras.classList.remove('horas-agrupadas');
    contenedorHoras.innerHTML = '<span class="motion-skeleton skeleton-hora" aria-hidden="true"></span>'.repeat(6);

    let dia;
    try {
        if (estaSupabaseListo()) {
            dia = await horariosDiaServidor(servicioNombre, barberoNombre, fechaSeleccionada);
        } else {
            // Sin servidor (solo solicitud por WhatsApp): cuadrícula del horario general; la barbería confirma
            const general = obtenerConfigModulos().general || {};
            const servicio = obtenerServicios().find(s => s.nombre === servicioNombre);
            dia = { abierto: true, duracion_minutos: servicio?.duracion_minutos || 30,
                horas: cuadricula({ abre: general.hora_apertura, cierra: general.hora_cierre, intervalo: general.intervalo_minutos || 30,
                    duracion: servicio?.duracion_minutos || 30, fecha: fechaSeleccionada }) };
        }
    } catch (error) {
        if (turno !== turnoPildoras) return;
        contenedorHoras.setAttribute('aria-busy', 'false');
        // Nunca se muestran horas como libres si no se pudo comprobar la disponibilidad
        mensajeHoras(`No pudimos cargar las horas disponibles (${escapar(mensajeError(error))}). Revisa tu conexión.`, true);
        return;
    }

    // Solo pinta la última llamada (evita píldoras duplicadas por llamadas concurrentes)
    if (turno !== turnoPildoras) return;
    contenedorHoras.setAttribute('aria-busy', 'false');

    if (!dia.abierto) {
        mensajeHoras(dia.motivo === 'no_realiza_servicio'
            ? 'Este barbero no realiza el servicio elegido. Prueba con otro barbero.'
            : 'La barbería no atiende ese día. Elige otra fecha.');
        horaDelBorrador = null;
        return;
    }
    if (!dia.horas.some(h => h.estado === 'libre')) {
        mensajeHoras('No quedan horas disponibles ese día. Prueba otra fecha u otro barbero.');
        horaDelBorrador = null;
        return;
    }

    contenedorHoras.classList.add('horas-agrupadas');
    contenedorHoras.innerHTML = `<p class="horas-ayuda">Duración del servicio: ${Number(dia.duracion_minutos)} min · horas de República Dominicana</p>`
        + FRANJAS.map(([clave, titulo]) => {
            const horas = dia.horas.filter(h => franja(h.inicio) === clave);
            if (!horas.length) return '';
            return `<div class="franja-horas"><h4>${titulo}</h4><div class="grid-horas">${horas.map(h => {
                const texto = rango12h(h.inicio, h.fin);
                const motivo = h.estado === 'pasada' ? 'Hora pasada' : h.estado === 'libre' ? '' : 'No disponible';
                return `<button type="button" class="pildora-hora${h.estado === 'libre' ? '' : ' deshabilitada'}" data-hora="${escapar(h.inicio)}"
                    ${h.estado === 'libre' ? '' : `disabled title="${motivo}"`} aria-label="${escapar(texto)}${motivo ? `, ${motivo.toLowerCase()}` : ''}">
                    <span>${escapar(formato12h(h.inicio))}</span><small>a ${escapar(formato12h(h.fin))}</small></button>`;
            }).join('')}</div></div>`;
        }).join('');

    contenedorHoras.querySelectorAll('.pildora-hora:not(.deshabilitada)').forEach(pildora => {
        pildora.addEventListener('click', () => {
            contenedorHoras.querySelectorAll('.pildora-hora').forEach(p => { p.classList.remove('pildora-activa'); p.removeAttribute('aria-pressed'); });
            pildora.classList.add('pildora-activa');
            pildora.setAttribute('aria-pressed', 'true');
            inputHora.value = pildora.dataset.hora;
            guardarSeleccion();
        });
    });

    // Hora guardada en el borrador: solo se recupera si sigue libre
    if (horaDelBorrador) {
        const pildora = contenedorHoras.querySelector(`.pildora-hora[data-hora="${horaDelBorrador}"]:not(.deshabilitada)`);
        if (pildora) {
            pildora.click();
            window.dispatchEvent(new Event('borrador-restaurado')); // con la hora recuperada, sigue en «Tus datos»
        } else contenedorHoras.insertAdjacentHTML('afterbegin', `<p class="resumen-alerta" role="alert">La hora ${escapar(formato12h(horaDelBorrador))} de tu borrador ya no está disponible. Elige otra.</p>`);
        horaDelBorrador = null;
    }
}

// Exponer globalmente para refrescar tras choques de reservas
window.generarPildorasDeTiempo = generarPildorasDeTiempo;

// ==========================================
// SELECCIÓN DE BARBERO
// ==========================================
function configurarSeleccionBarberos() {
    const tarjetasBarberos = document.querySelectorAll('.card-barbero');
    tarjetasBarberos.forEach(tarjeta => {
        const boton = tarjeta.querySelector('.btn-seleccionar-barbero');
        if (boton) {
            boton.addEventListener('click', (e) => {
                tarjetasBarberos.forEach(t => t.classList.remove('barbero-activo'));
                tarjeta.classList.add('barbero-activo');
                inputBarbero.value = e.target.getAttribute('data-nombre');
                window.dispatchEvent(new Event('barbero-cambiado'));
                
                // Refrescar horarios si la fecha ya está seleccionada
                generarPildorasDeTiempo();
                guardarSeleccion();

                const contacto = document.getElementById('contacto');
                if (contacto) contacto.scrollIntoView({ behavior: 'smooth' });
            });
        }
    });
}

function configurarTouchBarberos() {
    const tarjetasBarberos = document.querySelectorAll('.card-barbero');
    tarjetasBarberos.forEach(tarjeta => {
        tarjeta.addEventListener('touchstart', () => {
            tarjetasBarberos.forEach(t => t.classList.remove('touch-active'));
            tarjeta.classList.add('touch-active');
        }, { passive: true });
    });

    document.addEventListener('touchstart', (e) => {
        if (!e.target.closest('.card-barbero')) {
            tarjetasBarberos.forEach(t => t.classList.remove('touch-active'));
        }
    }, { passive: true });
}

// ==========================================
// FILTROS DE CATEGORÍA
// ==========================================
function configurarFiltros() {
    document.getElementById('buscar-corte').addEventListener('input', () => aplicarFiltro(document.getElementById('category-select')?.value || 'todos'));
    document.getElementById('category-select')?.addEventListener('change', event => aplicarFiltro(event.target.value));
    botonesFiltro.forEach(boton => {
        boton.addEventListener('click', (e) => {
            botonesFiltro.forEach(b => {
                b.classList.remove('activo');
            });
            e.currentTarget.classList.add('activo');
            const cat = e.currentTarget.getAttribute('data-categoria');
            aplicarFiltro(cat);
        });
    });
}

function aplicarFiltro(cat) {
    const consulta = document.getElementById('buscar-corte').value;
    const servicios = obtenerServicios();
    let visibles = 0;
    document.querySelectorAll('.card-servicio').forEach(tarjeta => {
        const servicio = servicios.find(s => s.id === tarjeta.dataset.servicioId);
        const mostrar = servicio && coincideCorte(servicio, cat, consulta);
        tarjeta.classList.toggle('ocultar-card', !mostrar);
        if (mostrar) visibles++;
    });
    document.getElementById('catalogo-vacio').hidden = visibles > 0;
    document.getElementById('catalogo-resultados').textContent = `${visibles} ${visibles === 1 ? 'corte disponible' : 'cortes disponibles'}`;
    botonesFiltro.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.categoria === cat)));
}

// ==========================================
// MENÚ HAMBURGUESA MÓVIL
// ==========================================
function configurarMenuMobile() {
    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('nav-abierto');
            menuToggle.classList.toggle('menu-activo');
            menuToggle.setAttribute('aria-expanded', String(navLinks.classList.contains('nav-abierto')));
        });

        navLinks.addEventListener('keydown', e => {
            if (e.key === 'Escape' && navLinks.classList.contains('nav-abierto')) {
                navLinks.classList.remove('nav-abierto');
                menuToggle.classList.remove('menu-activo');
                menuToggle.setAttribute('aria-expanded', 'false');
                menuToggle.focus();
            }
        });

        // Cerrar menú al hacer clic en un enlace
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('nav-abierto');
                menuToggle.classList.remove('menu-activo');
                menuToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }
}

// ==========================================
// ACCESO ADMIN
// ==========================================
function configurarAccesoAdmin() {
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            verificarAccesoAdmin();
        }
    });

    if (btnFlotanteAdmin) {
        btnFlotanteAdmin.addEventListener('click', verificarAccesoAdmin);
    }

    if (btnCerrarDash) btnCerrarDash.addEventListener('click', cerrarDashboard);

    // Enlace de un aviso (?panel=agenda&fecha=…): pide iniciar sesión y abre esa sección
    abrirPanelDesdeEnlace(new URLSearchParams(location.search));
}

// ==========================================
// INIT
// ==========================================
if (formulario) formulario.addEventListener('submit', procesarCita);
document.addEventListener('DOMContentLoaded', inicializarPagina);