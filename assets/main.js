import { cargarCatalogoServidor } from '../controllers/catalogoController.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { obtenerBarberos } from '../models/barberModel.js';
import { procesarCita } from '../controllers/appointmentController.js';
import { verificarAccesoAdmin, cerrarDashboard } from '../controllers/adminController.js';
import { supabase, estaSupabaseListo } from './supabaseClient.js';
import { inicializarModulosCliente, horasLibresServidor } from '../controllers/modulosController.js';

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
    if (inputFecha) {
        const hoy = new Date().toISOString().split('T')[0];
        inputFecha.min = hoy;
        inputFecha.addEventListener('change', generarPildorasDeTiempo);
    }

    await cargarCatalogoServidor();
    await inicializarModulosCliente();
    renderizarServicios();
    renderizarStaff();
    configurarFiltros();
    configurarAccesoAdmin();
    configurarMenuMobile();
    configurarScrollAnimations();
    configurarEfectos3D();
}

// Exponer función global para que el admin panel recargue la página
window.recargarPaginaPrincipal = async function () {
    await cargarCatalogoServidor();
    renderizarServicios();
    renderizarStaff();
};

// ==========================================
// RENDERIZADO DE SERVICIOS
// ==========================================
function renderizarServicios() {
    if (!gridServicios) return;

    const servicios = obtenerServicios();
    gridServicios.innerHTML = '';
    if (selectServicios) {
        selectServicios.innerHTML = '<option value="" disabled selected>-- Elige un corte del catálogo --</option>';
    }

    servicios.forEach(servicio => {
        const card = document.createElement('div');
        card.classList.add('card-servicio', 'animate-on-scroll');
        card.setAttribute('data-cat', servicio.categoria);
        card.innerHTML = `
            <div class="card-imagen-contenedor">
                <img src="${servicio.imagen}" alt="${servicio.nombre}" class="card-img" loading="lazy"
                     onerror="this.src='https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=600&auto=format&fit=crop'">
            </div>
            <div class="card-info">
                <h3>${servicio.nombre}</h3>
                <p>${servicio.descripcion}</p>
                <span class="precio-tag">${formatoPrecioServicio(servicio.precio)}</span>
                ${servicio.duracion_minutos ? `<span class="duracion-servicio">${servicio.duracion_minutos} min</span>` : ''}
                <button class="btn-card-reserva" data-nombre="${servicio.nombre}">Elegir Este</button>
            </div>
        `;
        gridServicios.appendChild(card);

        if (selectServicios) {
            const opcion = document.createElement('option');
            opcion.value = servicio.nombre;
            opcion.textContent = `${servicio.nombre} (${formatoPrecioServicio(servicio.precio)}${servicio.duracion_minutos ? ` / ${servicio.duracion_minutos} min` : ''})`;
            selectServicios.appendChild(opcion);
        }
    });

    // Event listeners para botones "Elegir Este"
    document.querySelectorAll('.btn-card-reserva').forEach(boton => {
        boton.addEventListener('click', (e) => {
            if (selectServicios) {
                selectServicios.value = e.target.getAttribute('data-nombre');
                selectServicios.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const staffSection = document.getElementById('staff-seccion');
            if (staffSection) staffSection.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // Reaplicar filtro activo
    const filtroActivo = document.querySelector('.btn-filtro.activo');
    if (filtroActivo) {
        const cat = filtroActivo.getAttribute('data-categoria');
        aplicarFiltro(cat);
    }

    // Re-observar elementos para animaciones
    configurarScrollAnimations();
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
                <img src="${barbero.imagen}" alt="${barbero.nombre}" loading="lazy"
                     onerror="this.src='https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop'">
            </div>
            <div class="barbero-info">
                <h4>${barbero.nombre}</h4>
                <p>${barbero.especialidad}</p>
                <button class="btn-seleccionar-barbero" data-nombre="${barbero.nombre}">Seleccionar</button>
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

    if (!inputFecha || !inputFecha.value) {
        contenedorHoras.innerHTML = `<p class="placeholder-horas">Por favor, selecciona una fecha primero...</p>`;
        return;
    }

    const fechaSeleccionada = inputFecha.value;
    const barberoNombre = inputBarbero ? inputBarbero.value : '';

    const horasOcupadas = new Set();

    if (estaSupabaseListo() && barberoNombre) {
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
    document.querySelectorAll('.card-servicio').forEach(tarjeta => {
        const catTarjeta = tarjeta.getAttribute('data-cat');
        if (cat === 'todos' || cat === catTarjeta) {
            tarjeta.classList.remove('ocultar-card');
        } else {
            tarjeta.classList.add('ocultar-card');
        }
    });
}

// ==========================================
// MENÚ HAMBURGUESA MÓVIL
// ==========================================
function configurarMenuMobile() {
    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('nav-abierto');
            menuToggle.classList.toggle('menu-activo');
        });

        // Cerrar menú al hacer clic en un enlace
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('nav-abierto');
                menuToggle.classList.remove('menu-activo');
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
// SCROLL ANIMATIONS (Intersection Observer)
// ==========================================
function configurarScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.animate-on-scroll').forEach(el => {
        if (!el.classList.contains('visible')) {
            observer.observe(el);
        }
    });
}

// ==========================================
// EFECTOS 3D (solo escritorio)
// ==========================================
function configurarEfectos3D() {
    if (window.matchMedia("(max-width: 768px)").matches) return;

    document.addEventListener('mousemove', (e) => {
        const tarjetas = document.querySelectorAll('.card-servicio');
        tarjetas.forEach(card => {
            const rect = card.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const x = e.clientX - rect.left - (rect.width / 2);
                const y = e.clientY - rect.top - (rect.height / 2);
                card.style.transform = `translateY(-8px) rotateX(${-y / 20}deg) rotateY(${x / 20}deg)`;

                const tagPrecio = card.querySelector('.precio-tag');
                if (tagPrecio) tagPrecio.style.transform = 'translateZ(20px)';
            }
        });
    });

    // Reset al salir
    gridServicios.addEventListener('mouseleave', () => {
        document.querySelectorAll('.card-servicio').forEach(card => {
            card.style.transform = '';
            const tagPrecio = card.querySelector('.precio-tag');
            if (tagPrecio) tagPrecio.style.transform = '';
        });
    });
}

// ==========================================
// INIT
// ==========================================
if (formulario) formulario.addEventListener('submit', procesarCita);
document.addEventListener('DOMContentLoaded', inicializarPagina);