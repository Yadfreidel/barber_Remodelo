import { CATALOGO_25, CATEGORIAS_CATALOGO } from '../models/catalogo25.js';
import { guardarTarifaCorte } from './catalogoController.js';
// ==========================================
// CONTROLADOR DE ADMINISTRACIÓN COMPLETO
// Panel CRUD para Servicios, Barberos y Stats
// ==========================================

import { obtenerServicios, agregarServicio, actualizarServicio, eliminarServicio, resetearServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { obtenerBarberos, agregarBarbero, actualizarBarbero, eliminarBarbero, resetearBarberos } from '../models/barberModel.js';
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { cargarConfigModulos } from './modulosController.js';
import { renderTabUbicacion } from './ubicacionAdminController.js';
import { renderTabModulos, columnasExtraCitas, accionesCitaAdmin, configurarAccionesCitaAdmin, iniciarSesionModulos } from './modulosAdminController.js';

// Credenciales locales del panel (visibles en el código fuente del navegador).
// La seguridad real de los módulos la da Supabase Auth en el servidor.
const ADMIN_EMAIL = "yafre2310@gmail.com";
const ADMIN_CLAVE = "123456";
let tabActiva = 'citas';

export function verificarAccesoAdmin() {
    if (document.getElementById('login-admin-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'login-admin-modal';
    modal.className = 'login-admin-modal';
    modal.innerHTML = `
        <form class="admin-form login-admin-caja">
            <h3><i class="fas fa-key"></i> Acceso de administrador</h3>
            <input type="email" id="login-admin-email" placeholder="Correo" required autocomplete="username">
            <input type="password" id="login-admin-clave" placeholder="Contraseña" required autocomplete="current-password">
            <div class="acciones-gestion">
                <button type="submit" class="btn-admin-accion"><i class="fas fa-sign-in-alt"></i> Entrar</button>
                <button type="button" class="btn-danger" id="login-admin-cancelar">Cancelar</button>
            </div>
        </form>
    `;
    document.body.appendChild(modal);

    const cerrar = () => modal.remove();
    modal.querySelector('#login-admin-cancelar').addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    modal.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = modal.querySelector('#login-admin-email').value.trim().toLowerCase();
        const clave = modal.querySelector('#login-admin-clave').value;
        if (email === ADMIN_EMAIL && clave === ADMIN_CLAVE) {
            cerrar();
            abrirDashboard();
            // Si Supabase está conectado y existe el mismo usuario, abre también la sesión de módulos
            iniciarSesionModulos(email, clave);
        } else {
            mostrarNotificacion('Correo o contraseña incorrectos.', 'error');
        }
    });

    modal.querySelector('#login-admin-email').focus();
}

function mostrarNotificacion(mensaje, tipo = 'success') {
    const existente = document.querySelector('.admin-notificacion');
    if (existente) existente.remove();

    const noti = document.createElement('div');
    noti.className = `admin-notificacion noti-${tipo}`;
    noti.innerHTML = `<i class="fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'times-circle' : 'info-circle'}"></i> ${mensaje}`;
    document.body.appendChild(noti);

    setTimeout(() => noti.classList.add('noti-visible'), 10);
    setTimeout(() => {
        noti.classList.remove('noti-visible');
        setTimeout(() => noti.remove(), 300);
    }, 2500);
}

function abrirDashboard() {
    const modal = document.getElementById('dashboard-admin');
    if (!modal) return;

    renderizarDashboardCompleto();
    modal.style.display = 'flex';
    modal.classList.remove('ocultar-dashboard');
    document.body.style.overflow = 'hidden';
}

export function cerrarDashboard() {
    const modal = document.getElementById('dashboard-admin');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('ocultar-dashboard');
        document.body.style.overflow = '';
    }
}

function renderizarDashboardCompleto() {
    const contenido = document.querySelector('.dashboard-contenido');
    if (!contenido) return;

    contenido.innerHTML = `
        <div class="dashboard-header">
            <h2><i class="fas fa-crown"></i> Panel de Control</h2>
            <button id="btn-cerrar-dashboard-inner" class="btn-cerrar" aria-label="Cerrar">&times;</button>
        </div>

        <div class="admin-tabs">
            <button class="admin-tab ${tabActiva === 'citas' ? 'tab-activa' : ''}" data-tab="citas">
                <i class="fas fa-calendar-alt"></i> <span>Citas</span>
            </button>
            <button class="admin-tab ${tabActiva === 'stats' ? 'tab-activa' : ''}" data-tab="stats">
                <i class="fas fa-chart-line"></i> <span>Stats</span>
            </button>
            <button class="admin-tab ${tabActiva === 'servicios' ? 'tab-activa' : ''}" data-tab="servicios">
                <i class="fas fa-scissors"></i> <span>Catálogo</span>
            </button>
            <button class="admin-tab ${tabActiva === 'barberos' ? 'tab-activa' : ''}" data-tab="barberos">
                <i class="fas fa-users"></i> <span>Barberos</span>
            </button>
            <button class="admin-tab ${tabActiva === 'ubicacion' ? 'tab-activa' : ''}" data-tab="ubicacion">
                <i class="fas fa-map-marked-alt"></i> <span>Ubicación</span>
            </button>
            <button class="admin-tab ${tabActiva === 'modulos' ? 'tab-activa' : ''}" data-tab="modulos">
                <i class="fas fa-puzzle-piece"></i> <span>Módulos</span>
            </button>
        </div>

        <div class="admin-tab-contenido" id="admin-tab-body"></div>
    `;

    // Event listeners para tabs
    contenido.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            tabActiva = tab.dataset.tab;
            renderizarDashboardCompleto();
        });
    });

    contenido.querySelector('#btn-cerrar-dashboard-inner').addEventListener('click', cerrarDashboard);

    // Renderizar contenido de tab activa
    const body = contenido.querySelector('#admin-tab-body');
    if (tabActiva === 'citas') renderTabCitas(body);
    else if (tabActiva === 'stats') renderTabStats(body);
    else if (tabActiva === 'servicios') renderTabServicios(body);
    else if (tabActiva === 'barberos') renderTabBarberos(body);
    else if (tabActiva === 'modulos') renderTabModulos(body, mostrarNotificacion);
    else if (tabActiva === 'ubicacion') renderTabUbicacion(body, mostrarNotificacion);
}

// ==========================================
// TAB: ESTADÍSTICAS
// ==========================================
function renderTabStats(container) {
    const citasGuardadas = JSON.parse(localStorage.getItem('barber_analytics_citas')) || [];

    let ingresosTotales = 0;
    let mapeoServicios = {};
    let mapeoBarberos = {};

    citasGuardadas.forEach(cita => {
        const precioNumerico = parseFloat(String(cita.precio).replace(/[^0-9.]/g, '')) || 0;
        ingresosTotales += precioNumerico;
        mapeoServicios[cita.servicio] = (mapeoServicios[cita.servicio] || 0) + 1;
        mapeoBarberos[cita.barbero] = (mapeoBarberos[cita.barbero] || 0) + 1;
    });

    const topServicio = obtenerMaximoMapeo(mapeoServicios);
    const topBarbero = obtenerMaximoMapeo(mapeoBarberos);

    container.innerHTML = `
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-icon"><i class="fas fa-calendar-check"></i></div>
                <div class="metric-info">
                    <h3>${citasGuardadas.length}</h3>
                    <p>Citas Registradas</p>
                </div>
            </div>
            <div class="metric-card metric-green">
                <div class="metric-icon icon-green"><i class="fas fa-dollar-sign"></i></div>
                <div class="metric-info">
                    <h3>$${ingresosTotales.toFixed(2)}</h3>
                    <p>Ingresos Estimados</p>
                </div>
            </div>
        </div>

        <div class="details-grid">
            <div class="detail-box">
                <h4><i class="fas fa-star"></i> Servicio Estrella</h4>
                <p class="detail-value">${topServicio.nombre}</p>
                <span class="badge">${topServicio.cantidad} ventas</span>
            </div>
            <div class="detail-box">
                <h4><i class="fas fa-trophy"></i> Barbero Destacado</h4>
                <p class="detail-value">${topBarbero.nombre}</p>
                <span class="badge">${topBarbero.cantidad} turnos</span>
            </div>
        </div>

        <button id="btn-reset-stats" class="btn-danger">
            <i class="fas fa-trash-alt"></i> Reiniciar Estadísticas
        </button>
    `;

    container.querySelector('#btn-reset-stats').addEventListener('click', () => {
        if (confirm("⚠️ ¿Borrar todas las estadísticas? Esta acción es irreversible.")) {
            localStorage.removeItem('barber_analytics_citas');
            mostrarNotificacion('Estadísticas reiniciadas', 'success');
            renderTabStats(container);
        }
    });
}

// ==========================================
// TAB: GESTIÓN DE CATÁLOGO (SERVICIOS)
// ==========================================
function renderTabServicios(container) {
    const servicios = obtenerServicios();

    container.innerHTML = `
        <div class="admin-section-header">
            <h3><i class="fas fa-list"></i> Catálogo de Servicios (${servicios.length})</h3>
            <button id="btn-agregar-servicio" class="btn-admin-accion">
                <i class="fas fa-plus"></i> Agregar
            </button>
        </div>

        <div class="admin-filtros-mini">
            <button class="admin-filtro-mini activo" data-cat="todos">Todos</button>
${Object.entries(CATEGORIAS_CATALOGO).map(([valor,texto]) => `<button class="admin-filtro-mini" data-cat="${valor}">${texto}</button>`).join('')}
            <button class="admin-filtro-mini" data-cat="cortes">Cortes</button>
            <button class="admin-filtro-mini" data-cat="barba">Barba</button>
            <button class="admin-filtro-mini" data-cat="combos">Combos</button>
        </div>

        <div class="admin-lista-items" id="admin-lista-servicios"></div>

        <button id="btn-reset-catalogo" class="btn-danger btn-small">
            <i class="fas fa-undo"></i> Restaurar Catálogo Original
        </button>
    `;

    renderListaServicios(container, 'todos');

    // Filtros mini
    container.querySelectorAll('.admin-filtro-mini').forEach(btn => {
        btn.addEventListener('click', (e) => {
            container.querySelectorAll('.admin-filtro-mini').forEach(b => b.classList.remove('activo'));
            e.currentTarget.classList.add('activo');
            renderListaServicios(container, e.currentTarget.dataset.cat);
        });
    });

    // Agregar servicio
    container.querySelector('#btn-agregar-servicio').addEventListener('click', () => {
        mostrarFormularioServicio(container);
    });

    // Reset catálogo
    container.querySelector('#btn-reset-catalogo').addEventListener('click', () => {
        if (confirm("¿Restaurar el catálogo a los servicios originales?")) {
            resetearServicios();
            mostrarNotificacion('Catálogo restaurado', 'success');
            renderTabServicios(container);
            if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
        }
    });
}

function renderListaServicios(container, filtro) {
    const lista = container.querySelector('#admin-lista-servicios');
    let servicios = obtenerServicios();
    if (filtro !== 'todos') servicios = servicios.filter(s => s.categoria === filtro);

    if (servicios.length === 0) {
        lista.innerHTML = '<p class="admin-vacio">No hay servicios en esta categoría</p>';
        return;
    }

    lista.innerHTML = servicios.map(s => `
        <div class="admin-item-card" data-id="${s.id}">
            <div class="admin-item-img">
                <img src="${s.imagen}" alt="${s.nombre}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=100&auto=format&fit=crop'">
            </div>
            <div class="admin-item-info">
                <h4>${s.nombre}</h4>
                <p class="admin-item-cat">${s.categoria}</p>
                <p class="admin-item-precio">${formatoPrecioServicio(s.precio)}${s.duracion_minutos ? ` / ${s.duracion_minutos} min` : ''}</p>
            </div>
            <div class="admin-item-acciones">
                <button class="btn-editar-item" data-id="${s.id}" title="Editar">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-eliminar-item" data-id="${s.id}" title="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Editar
    lista.querySelectorAll('.btn-editar-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const servicio = obtenerServicios().find(s => s.id === btn.dataset.id);
            if (servicio) mostrarFormularioServicio(container, servicio);
        });
    });

    // Eliminar
    lista.querySelectorAll('.btn-eliminar-item').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm("¿Eliminar este servicio?")) {
                eliminarServicio(btn.dataset.id);
                mostrarNotificacion('Servicio eliminado', 'success');
                renderTabServicios(container);
                if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
            }
        });
    });
}

function mostrarFormularioServicio(container, servicioExistente = null) {
    const esEdicion = !!servicioExistente;
    const esImportado = esEdicion && CATALOGO_25.some(s => s.id === servicioExistente.id);
    const body = container.querySelector('#admin-tab-body') || container;

    body.innerHTML = `
        <div class="admin-form-header">
            <button class="btn-volver-admin" id="btn-volver-servicios">
                <i class="fas fa-arrow-left"></i> Volver
            </button>
            <h3>${esEdicion ? 'Editar Servicio' : 'Nuevo Servicio'}</h3>
        </div>

        <form class="admin-form" id="form-servicio-admin">
            <div class="admin-form-group">
                <label>Nombre del servicio</label>
                <input type="text" id="admin-srv-nombre" required value="${esEdicion ? servicioExistente.nombre : ''}" placeholder="Ej: Corte Fade Premium">
            </div>
            <div class="admin-form-group">
                <label>Descripción</label>
                <textarea id="admin-srv-desc" required rows="3" placeholder="Descripción del servicio...">${esEdicion ? servicioExistente.descripcion : ''}</textarea>
            </div>
            <div class="admin-form-row">
                <div class="admin-form-group">
                    <label>Precio</label>
                    <input type="${esImportado ? 'number' : 'text'}" ${esImportado ? 'min="0" step="0.01"' : ''} id="admin-srv-precio" required value="${esEdicion ? servicioExistente.precio : ''}" placeholder="RD$ 700">
                </div>
                <div class="admin-form-group">
                    <label>Categoría</label>
                    <select id="admin-srv-cat" required>
                        ${Object.entries(CATEGORIAS_CATALOGO).map(([valor, texto]) => `<option value="${valor}" ${esEdicion && servicioExistente.categoria === valor ? 'selected' : ''}>${texto}</option>`).join('')}
                        <option value="cortes" ${esEdicion && servicioExistente.categoria === 'cortes' ? 'selected' : ''}>Cortes</option>
                        <option value="barba" ${esEdicion && servicioExistente.categoria === 'barba' ? 'selected' : ''}>Barba & SPA</option>
                        <option value="combos" ${esEdicion && servicioExistente.categoria === 'combos' ? 'selected' : ''}>Combos VIP</option>
                    </select>
                </div>
            </div>
            <div class="admin-form-group">
                <label>URL de Imagen</label>
                <input type="text" id="admin-srv-img" value="${esEdicion ? servicioExistente.imagen : ''}" placeholder="https://ejemplo.com/imagen.jpg">
                <small class="admin-hint">Deja vacío para usar imagen por defecto</small>
            </div>
            ${esEdicion && servicioExistente.imagen ? `
                <div class="admin-preview-img">
                    <img src="${servicioExistente.imagen}" alt="Vista previa" onerror="this.style.display='none'">
                </div>
            ` : ''}
            ${esImportado ? `<div class="admin-form-group"><label for="admin-srv-duracion">Duracion del corte (minutos)</label><input type="number" id="admin-srv-duracion" min="1" max="480" step="1" required value="${servicioExistente.duracion_minutos}"><small class="admin-hint">Solo corte, sin barba, lavado ni extras. Las citas anteriores conservan su duracion reservada.</small></div>` : ''}
            <button type="submit" class="btn-admin-guardar">
                <i class="fas fa-save"></i> ${esEdicion ? 'Guardar Cambios' : 'Agregar Servicio'}
            </button>
        </form>
    `;

    body.querySelector('#btn-volver-servicios').addEventListener('click', () => {
        renderTabServicios(container);
    });

    body.querySelector('#form-servicio-admin').addEventListener('submit', async (e) => {
        e.preventDefault();
        const datos = {
            nombre: document.getElementById('admin-srv-nombre').value.trim(),
            descripcion: document.getElementById('admin-srv-desc').value.trim(),
            precio: document.getElementById('admin-srv-precio').value.trim(),
            categoria: document.getElementById('admin-srv-cat').value,
            imagen: document.getElementById('admin-srv-img').value.trim() || 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=600&auto=format&fit=crop'
        };

        if (esImportado) {
            datos.precio = Number(datos.precio);
            datos.duracion_minutos = Number(body.querySelector('#admin-srv-duracion').value);
            const botonGuardar = body.querySelector('button[type="submit"]');
            botonGuardar.disabled = true;
            try {
                await guardarTarifaCorte(servicioExistente.id, datos.precio, datos.duracion_minutos);
            } catch (error) {
                mostrarNotificacion(error.message, 'error');
                botonGuardar.disabled = false;
                return;
            }
        }
        if (esEdicion) {
            actualizarServicio(servicioExistente.id, datos);
            mostrarNotificacion('Servicio actualizado', 'success');
        } else {
            agregarServicio(datos);
            mostrarNotificacion('Servicio agregado', 'success');
        }

        renderTabServicios(container);
        if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
    });
}

// ==========================================
// TAB: GESTIÓN DE BARBEROS
// ==========================================
function renderTabBarberos(container) {
    const barberos = obtenerBarberos();

    container.innerHTML = `
        <div class="admin-section-header">
            <h3><i class="fas fa-users"></i> Staff de Barberos (${barberos.length})</h3>
            <button id="btn-agregar-barbero" class="btn-admin-accion">
                <i class="fas fa-plus"></i> Agregar
            </button>
        </div>

        <div class="admin-lista-items" id="admin-lista-barberos"></div>

        <button id="btn-reset-barberos" class="btn-danger btn-small">
            <i class="fas fa-undo"></i> Restaurar Barberos Originales
        </button>
    `;

    renderListaBarberos(container);

    container.querySelector('#btn-agregar-barbero').addEventListener('click', () => {
        mostrarFormularioBarbero(container);
    });

    container.querySelector('#btn-reset-barberos').addEventListener('click', () => {
        if (confirm("¿Restaurar los barberos a la lista original?")) {
            resetearBarberos();
            mostrarNotificacion('Barberos restaurados', 'success');
            renderTabBarberos(container);
            if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
        }
    });
}

function renderListaBarberos(container) {
    const lista = container.querySelector('#admin-lista-barberos');
    const barberos = obtenerBarberos();

    if (barberos.length === 0) {
        lista.innerHTML = '<p class="admin-vacio">No hay barberos registrados</p>';
        return;
    }

    lista.innerHTML = barberos.map(b => `
        <div class="admin-item-card" data-id="${b.id}">
            <div class="admin-item-img admin-item-img-round">
                <img src="${b.imagen}" alt="${b.nombre}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=100&auto=format&fit=crop'">
            </div>
            <div class="admin-item-info">
                <h4>${b.nombre}</h4>
                <p class="admin-item-cat">${b.especialidad}</p>
            </div>
            <div class="admin-item-acciones">
                <button class="btn-editar-item" data-id="${b.id}" title="Editar">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-eliminar-item" data-id="${b.id}" title="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    lista.querySelectorAll('.btn-editar-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const barbero = obtenerBarberos().find(b => b.id === btn.dataset.id);
            if (barbero) mostrarFormularioBarbero(container, barbero);
        });
    });

    lista.querySelectorAll('.btn-eliminar-item').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm("¿Eliminar este barbero?")) {
                eliminarBarbero(btn.dataset.id);
                mostrarNotificacion('Barbero eliminado', 'success');
                renderTabBarberos(container);
                if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
            }
        });
    });
}

function mostrarFormularioBarbero(container, barberoExistente = null) {
    const esEdicion = !!barberoExistente;
    const body = container.querySelector('#admin-tab-body') || container;

    body.innerHTML = `
        <div class="admin-form-header">
            <button class="btn-volver-admin" id="btn-volver-barberos">
                <i class="fas fa-arrow-left"></i> Volver
            </button>
            <h3>${esEdicion ? 'Editar Barbero' : 'Nuevo Barbero'}</h3>
        </div>

        <form class="admin-form" id="form-barbero-admin">
            <div class="admin-form-group">
                <label>Nombre completo</label>
                <input type="text" id="admin-barb-nombre" required value="${esEdicion ? barberoExistente.nombre : ''}" placeholder="Ej: Carlos Martínez">
            </div>
            <div class="admin-form-group">
                <label>Especialidad</label>
                <input type="text" id="admin-barb-especialidad" required value="${esEdicion ? barberoExistente.especialidad : ''}" placeholder="Ej: Experto en fades y degradados">
            </div>
            <div class="admin-form-group">
                <label>URL de Foto</label>
                <input type="url" id="admin-barb-img" value="${esEdicion ? barberoExistente.imagen : ''}" placeholder="https://ejemplo.com/foto.jpg">
                <small class="admin-hint">Deja vacío para usar foto por defecto</small>
            </div>
            ${esEdicion && barberoExistente.imagen ? `
                <div class="admin-preview-img admin-preview-round">
                    <img src="${barberoExistente.imagen}" alt="Vista previa" onerror="this.style.display='none'">
                </div>
            ` : ''}
            <button type="submit" class="btn-admin-guardar">
                <i class="fas fa-save"></i> ${esEdicion ? 'Guardar Cambios' : 'Agregar Barbero'}
            </button>
        </form>
    `;

    body.querySelector('#btn-volver-barberos').addEventListener('click', () => {
        renderTabBarberos(container);
    });

    body.querySelector('#form-barbero-admin').addEventListener('submit', (e) => {
        e.preventDefault();
        const datos = {
            nombre: document.getElementById('admin-barb-nombre').value.trim(),
            especialidad: document.getElementById('admin-barb-especialidad').value.trim(),
            imagen: document.getElementById('admin-barb-img').value.trim() || 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=600&auto=format&fit=crop'
        };

        if (esEdicion) {
            actualizarBarbero(barberoExistente.id, datos);
            mostrarNotificacion('Barbero actualizado', 'success');
        } else {
            agregarBarbero(datos);
            mostrarNotificacion('Barbero agregado', 'success');
        }

        renderTabBarberos(container);
        if (window.recargarPaginaPrincipal) window.recargarPaginaPrincipal();
    });
}

// ==========================================
// UTILIDADES
// ==========================================
function obtenerMaximoMapeo(mapeo) {
    let nombreMax = "Ninguno aún";
    let cantMax = 0;
    for (const clave in mapeo) {
        if (mapeo[clave] > cantMax) {
            cantMax = mapeo[clave];
            nombreMax = clave;
        }
    }
    return { nombre: nombreMax, cantidad: cantMax };
}

export function resetearEstadisticas() {
    if (confirm("⚠️ ¿Borrar todas las estadísticas?")) {
        localStorage.removeItem('barber_analytics_citas');
        mostrarNotificacion('Datos reseteados', 'success');
    }
}

// ==========================================
// TAB: HISTORIAL DE CITAS (SUPABASE)
// ==========================================
async function renderTabCitas(container) {
    if (!estaSupabaseListo()) {
        container.innerHTML = `
            <div class="admin-section-header">
                <h3><i class="fas fa-calendar-alt"></i> Historial de Citas</h3>
            </div>
            <div class="admin-aviso-config">
                <i class="fas fa-exclamation-triangle"></i>
                <p><strong>Supabase aún no está configurado.</strong></p>
                <p>Por favor, edita <code>assets/config.js</code> colocando tu URL y ANON KEY para consultar y actualizar el historial en tiempo real.</p>
            </div>
        `;
        return;
    }

    await cargarConfigModulos();

    let barberosOpciones = [];
    try {
        const { data: barberosData } = await supabase.from('barberos').select('id, nombre');
        if (barberosData) barberosOpciones = barberosData;
    } catch (e) {
        console.error("Error al cargar barberos para filtro:", e);
    }

    container.innerHTML = `
        <div class="admin-section-header">
            <h3><i class="fas fa-calendar-alt"></i> Historial de Citas (${barberosOpciones.length ? 'En Línea' : 'Supabase'})</h3>
            <button id="btn-refrescar-citas" class="btn-admin-accion">
                <i class="fas fa-sync-alt"></i> Refrescar
            </button>
        </div>

        <div class="admin-filtros-citas">
            <div class="filtro-item">
                <label><i class="fas fa-user-tie"></i> Barbero:</label>
                <select id="filtro-citas-barbero">
                    <option value="">-- Todos los barberos --</option>
                    ${barberosOpciones.map(b => `<option value="${b.id}">${b.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="filtro-item">
                <label><i class="fas fa-calendar"></i> Desde:</label>
                <input type="date" id="filtro-citas-desde">
            </div>
            <div class="filtro-item">
                <label><i class="fas fa-calendar"></i> Hasta:</label>
                <input type="date" id="filtro-citas-hasta">
            </div>
            <button id="btn-aplicar-filtros-citas" class="btn-admin-filtrar">
                <i class="fas fa-filter"></i> Filtrar
            </button>
        </div>

        <div class="tabla-contenedor-responsive">
            <table class="tabla-admin-citas">
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th>Teléfono</th>
                        <th>Servicio</th>
                        <th>Barbero</th>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="tabla-citas-body">
                    <tr><td colspan="8" class="cargando-td"><i class="fas fa-spinner fa-spin"></i> Cargando citas...</td></tr>
                </tbody>
            </table>
        </div>
    `;

    const cargarCitas = async () => {
        const tbody = container.querySelector('#tabla-citas-body');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="8" class="cargando-td"><i class="fas fa-spinner fa-spin"></i> Cargando citas...</td></tr>';

        const barberoId = container.querySelector('#filtro-citas-barbero').value;
        const fechaDesde = container.querySelector('#filtro-citas-desde').value;
        const fechaHasta = container.querySelector('#filtro-citas-hasta').value;

        try {
            let query = supabase
                .from('citas')
                .select(`
                    id,
                    nombre_cliente,
                    telefono_cliente,
                    email,
                    fecha,
                    hora,
                    estado,
                    creado_en,
                    ${columnasExtraCitas()}
                    barberos ( id, nombre ),
                    servicios ( id, nombre, precio )
                `)
                .order('fecha', { ascending: false })
                .order('hora', { ascending: false });

            if (barberoId) query = query.eq('barbero_id', barberoId);
            if (fechaDesde) query = query.gte('fecha', fechaDesde);
            if (fechaHasta) query = query.lte('fecha', fechaHasta);

            const { data: citas, error } = await query;

            if (error) {
                tbody.innerHTML = `<tr><td colspan="8" class="error-td">Error al cargar citas: ${error.message}</td></tr>`;
                return;
            }

            if (!citas || citas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="vacio-td">No se encontraron citas registradas</td></tr>';
                return;
            }

            tbody.innerHTML = citas.map(c => {
                const nombreBarbero = c.barberos ? c.barberos.nombre : 'No especificado';
                const nombreServicio = c.servicios ? c.servicios.nombre : 'No especificado';
                const horaFormat = String(c.hora).substring(0, 5);

                const badgeClass = c.estado === 'confirmada' ? 'badge-confirmada' : c.estado === 'cancelada' ? 'badge-cancelada' : 'badge-pendiente';

                return `
                    <tr>
                        <td>
                            <strong>${c.nombre_cliente}</strong><br>
                            <small class="subtext-email">${c.email || ''}</small>
                        </td>
                        <td><a href="tel:${c.telefono_cliente}" class="link-tel">${c.telefono_cliente}</a></td>
                        <td>${nombreServicio}</td>
                        <td>${nombreBarbero}</td>
                        <td>${c.fecha}</td>
                        <td><strong>${horaFormat}</strong></td>
                        <td><span class="badge-estado ${badgeClass}">${c.estado.toUpperCase()}</span></td>
                        <td>
                            <div class="acciones-cita-row">
                                <button class="btn-accion-cita btn-confirmar" data-id="${c.id}" title="Confirmar Cita" ${c.estado === 'confirmada' ? 'disabled' : ''}>
                                    <i class="fas fa-check"></i>
                                </button>
                                <button class="btn-accion-cita btn-cancelar" data-id="${c.id}" title="Cancelar Cita" ${c.estado === 'cancelada' ? 'disabled' : ''}>
                                    <i class="fas fa-times"></i>
                                </button>
                                ${accionesCitaAdmin(c)}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.btn-confirmar:not([data-modulo-accion])').forEach(btn => {
                btn.addEventListener('click', () => cambiarEstadoCita(btn.dataset.id, 'confirmada', cargarCitas));
            });

            tbody.querySelectorAll('.btn-cancelar:not([data-modulo-accion])').forEach(btn => {
                btn.addEventListener('click', () => cambiarEstadoCita(btn.dataset.id, 'cancelada', cargarCitas));
            });

            configurarAccionesCitaAdmin(tbody, cargarCitas, mostrarNotificacion);

        } catch (err) {
            console.error("Error al consultar citas:", err);
            tbody.innerHTML = '<tr><td colspan="8" class="error-td">Error al conectar con la base de datos</td></tr>';
        }
    };

    container.querySelector('#btn-aplicar-filtros-citas').addEventListener('click', cargarCitas);
    container.querySelector('#btn-refrescar-citas').addEventListener('click', cargarCitas);

    cargarCitas();
}

async function cambiarEstadoCita(idCita, nuevoEstado, callbackRecarga) {
    if (!estaSupabaseListo()) return;

    try {
        const { error } = await supabase
            .from('citas')
            .update({ estado: nuevoEstado })
            .eq('id', idCita);

        if (error) {
            mostrarNotificacion(`Error al actualizar estado: ${error.message}`, 'error');
        } else {
            mostrarNotificacion(`Cita ${nuevoEstado === 'confirmada' ? 'confirmada' : 'cancelada'}`, 'success');
            if (callbackRecarga) callbackRecarga();
            if (window.generarPildorasDeTiempo) window.generarPildorasDeTiempo();
        }
    } catch (err) {
        console.error("Error al cambiar estado de cita:", err);
        mostrarNotificacion('Error al conectar con Supabase', 'error');
    }
}