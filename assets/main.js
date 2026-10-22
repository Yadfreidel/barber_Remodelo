import { conectarDetalles, coincideCorte, fotoCorte, escapar } from './catalogue-ui.js';
import { cargarCatalogoServidor } from '../controllers/catalogoController.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { obtenerBarberos } from '../models/barberModel.js';
import { procesarCita } from '../controllers/appointmentController.js';
import { verificarAccesoAdmin, cerrarDashboard } from '../controllers/adminController.js';
import { supabase, estaSupabaseListo } from './supabaseClient.js';
import { inicializarUbicacionCliente } from '../controllers/ubicacionController.js';
import { cargarBarberosServidor, aplicarNegocioPublico } from '../controllers/publicoController.js';
import { inicializarModulosCliente, horasLibresServidor, usarReservaServidor } from '../controllers/modulosController.js';

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

const HORARIOS_DISPONIBLES = [
    "09:00", "10:00", "11:00", "12:00", "13:00",
    "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"
];

// ==========================================
// INICIALIZACIÓN PRINCIPAL
// ==========================================
async function inicializarPagina() {
    configurarAccesoAdmin();
    configurarMenuMobile();
    if (inputFecha) {
        const hoy = new Date().toISOString().split('T')[0];
        inputFecha.min = hoy;
        inputFecha.addEventListener('change', generarPildorasDeTiempo);
    }

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


}

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
            </div>
        `;
        gridStaff.appendChild(cardBarbero);
    });

    configurarSeleccionBarberos();
    configurarTouchBarberos();
}

// ==========================================
// PÍLDORAS DE HORA (SUPABASE REAL-TIME)
// ==========================================
let turnoPildoras = 0;

export async function generarPildorasDeTiempo() {
    if (!contenedorHoras) return;
    const turno = ++turnoPildoras;
    contenedorHoras.innerHTML = '';
    inputHora.value = '';
    contenedorHoras.setAttribute('aria-busy', 'false');

    if (!inputFecha || !inputFecha.value) {
        contenedorHoras.innerHTML = `<p class="placeholder-horas">Por favor, selecciona una fecha primero...</p>`;
        return;
    }

    const fechaSeleccionada = inputFecha.value;
    const barberoNombre = inputBarbero ? inputBarbero.value : '';

    contenedorHoras.setAttribute('aria-busy', 'true');
    contenedorHoras.innerHTML = '<span class="motion-skeleton skeleton-hora" aria-hidden="true"></span>'.repeat(6);
    const horasOcupadas = new Set();

    if (estaSupabaseListo() && barberoNombre && !usarReservaServidor()) {
        try {
            // Buscar barbero en Supabase por nombre
            const { data: barberosData } = await supabase
                .from('barberos')
                .select('id')
                .eq('nombre', barberoNombre)
                .limit(1);

            if (barberosData && barberosData.length > 0) {
                const barberoId = barberosData[0].id;
                // Consultar citas no canceladas para ese barbero y fecha
                const { data: citasData, error } = await supabase
                    .from('citas')
                    .select('hora')
                    .eq('barbero_id', barberoId)
                    .eq('fecha', fechaSeleccionada)
                    .neq('estado', 'cancelada');

                if (citasData && !error) {
                    citasData.forEach(cita => {
                        const horaNormal = String(cita.hora).substring(0, 5);
                        horasOcupadas.add(horaNormal);
                    });
                }
            }
        } catch (err) {
            console.error("Error al consultar horarios ocupados:", err);
        }
    }

    // Con módulos activos: disponibilidad real del servidor (considera duración del servicio)
    const libresServidor = await horasLibresServidor(selectServicios ? selectServicios.value : '', barberoNombre, fechaSeleccionada);

    // Solo pinta la última llamada (evita píldoras duplicadas por llamadas concurrentes)
    if (turno !== turnoPildoras) return;
    contenedorHoras.setAttribute('aria-busy', 'false');
    contenedorHoras.innerHTML = '';

    const fechaActualStr = new Date().toISOString().split('T')[0];
    const ahora = new Date();
    const horaActual = ahora.getHours();
    const minutosActuales = ahora.getMinutes();

    const horarios = libresServidor ? [...libresServidor] : HORARIOS_DISPONIBLES;
    if (!horarios.length) contenedorHoras.innerHTML = '<p class="placeholder-horas">No hay horarios disponibles. Revisa el servicio, el profesional y la fecha.</p>';
    horarios.forEach(horaTexto => {
        const pildora = document.createElement('button');
        pildora.type = 'button';
        pildora.classList.add('pildora-hora');
        pildora.textContent = horaTexto;
        const [horaBloque] = horaTexto.split(':').map(Number);

        let esPasado = false;
        if (fechaSeleccionada === fechaActualStr) {
            if (horaBloque < horaActual || (horaBloque === horaActual && minutosActuales > 0)) {
                esPasado = true;
            }
        }

        const estaOcupada = horasOcupadas.has(horaTexto) || Boolean(libresServidor && !libresServidor.has(horaTexto));

        if (esPasado || estaOcupada) {
            pildora.classList.add('deshabilitada');
            pildora.disabled = true;
            if (estaOcupada) {
                pildora.title = "Horario reservado por otro cliente";
            }
        }

        if (!pildora.classList.contains('deshabilitada')) {
            pildora.addEventListener('click', () => {
                document.querySelectorAll('.pildora-hora').forEach(p => p.classList.remove('pildora-activa'));
                pildora.classList.add('pildora-activa');
                inputHora.value = horaTexto;
            });
        }
        contenedorHoras.appendChild(pildora);
    });
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
                
                // Refrescar horarios si la fecha ya está seleccionada
                generarPildorasDeTiempo();

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
}

// ==========================================
// INIT
// ==========================================
if (formulario) formulario.addEventListener('submit', procesarCita);
document.addEventListener('DOMContentLoaded', inicializarPagina);