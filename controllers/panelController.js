// ==========================================
// PANEL DE ADMINISTRACIÓN: estructura y navegación
// PC: menú lateral. Móvil: menú desplegable. Las secciones visibles dependen del
// rol, pero cada operación se vuelve a verificar en el servidor.
// ==========================================

import { esc, api } from './panel/comun.js';
import { renderResumen } from './panel/resumen.js';
import { renderAgenda } from './panel/agenda.js';
import { renderHorarios } from './panel/horarios.js';
import { renderServicios } from './panel/servicios.js';
import { renderBarberos } from './panel/barberos.js';
import { renderClientes } from './panel/clientes.js';
import { renderNegocio } from './panel/negocio.js';
import { renderWhatsApp } from './panel/whatsapp.js';
import { renderReportes } from './panel/reportes.js';
import { renderAuditoria } from './panel/auditoria.js';
import { renderTabModulos } from './modulosAdminController.js';
import { renderFinResumen, renderFinReportes } from './panel/finanzas.js';
import { renderVentas } from './panel/ventas.js';
import { renderCaja } from './panel/caja.js';
import { renderGastos } from './panel/gastos.js';
import { renderInventario } from './panel/inventario.js';
import { renderPortafolio } from './panel/portafolio.js';
import { renderOcupacion } from './panel/ocupacion.js';
import { renderReclamaciones } from './panel/reclamaciones.js';
import { renderAtencion } from './panel/atencion.js';
import { renderIngresos } from './panel/ingresos.js';
import { renderDisponibilidad } from './panel/disponibilidad.js';
import { renderPerfil } from './panel/perfil.js';
import { renderSolicitudes } from './panel/solicitudes.js';
import { renderNotificaciones, abrirAviso } from './panel/notificaciones.js';
import { iniciarAvisos, desbloquearSonido, fijarPreferencias } from './panel/avisos.js';

// Inventario, ventas y caja: solo administradores (el servidor lo vuelve a comprobar). Un barbero con el permiso
// explícito «cajero» ve también Ventas y Caja. «titulos.barbero» es el nombre de la sección en el menú del barbero.
const SECCIONES = [
    { id: 'resumen', titulo: 'Resumen', titulos: { barbero: 'Inicio' }, icono: 'gauge-high', roles: ['admin', 'barbero'], render: renderResumen, grupo: 'Barbería' },
    { id: 'agenda', titulo: 'Agenda', titulos: { barbero: 'Mi agenda' }, icono: 'calendar-days', roles: ['admin', 'barbero'], render: renderAgenda, grupo: 'Barbería' },
    { id: 'atencion', titulo: 'Atención', icono: 'play', roles: ['admin', 'barbero'], render: renderAtencion, grupo: 'Barbería' },
    { id: 'reclamaciones', titulo: 'Reclamaciones', titulos: { barbero: 'Casos asignados' }, icono: 'flag', roles: ['admin', 'barbero'], render: renderReclamaciones, grupo: 'Barbería' },
    { id: 'horarios', titulo: 'Horarios', icono: 'clock', roles: ['admin'], render: renderHorarios, grupo: 'Barbería' },
    { id: 'servicios', titulo: 'Servicios', icono: 'scissors', roles: ['admin'], render: renderServicios, grupo: 'Barbería' },
    { id: 'barberos', titulo: 'Barberos', icono: 'users', roles: ['admin'], render: renderBarberos, grupo: 'Barbería' },
    { id: 'solicitudes', titulo: 'Solicitudes', icono: 'inbox', roles: ['admin'], render: renderSolicitudes, grupo: 'Barbería' },
    { id: 'portafolio', titulo: 'Portafolio', titulos: { barbero: 'Mi portafolio' }, icono: 'images', roles: ['admin', 'barbero'], render: renderPortafolio, grupo: 'Barbería' },
    { id: 'ingresos', titulo: 'Ingresos por barbero', titulos: { barbero: 'Mis ingresos' }, icono: 'wallet', roles: ['admin', 'barbero'], render: renderIngresos, grupo: 'Barbería' },
    { id: 'disponibilidad', titulo: 'Mi disponibilidad', icono: 'business-time', roles: ['barbero'], render: renderDisponibilidad, grupo: 'Barbería' },
    { id: 'clientes', titulo: 'Clientes', icono: 'address-book', roles: ['admin'], render: renderClientes, grupo: 'Barbería' },
    { id: 'reportes', titulo: 'Reportes de citas', icono: 'chart-column', roles: ['admin'], render: renderReportes, grupo: 'Barbería' },
    { id: 'ocupacion', titulo: 'Ocupación y horas vacías', titulos: { barbero: 'Mi ocupación' }, icono: 'chart-area', roles: ['admin', 'barbero'], render: renderOcupacion, grupo: 'Barbería' },
    { id: 'notificaciones', titulo: 'Notificaciones', icono: 'bell', roles: ['admin', 'barbero'], render: renderNotificaciones, grupo: 'Barbería' },
    { id: 'perfil', titulo: 'Mi perfil', icono: 'id-badge', roles: ['admin', 'barbero'], render: renderPerfil, grupo: 'Barbería' },
    { id: 'fin-resumen', titulo: 'Resumen financiero', icono: 'sack-dollar', roles: ['admin'], render: renderFinResumen, grupo: 'Finanzas' },
    { id: 'inventario', titulo: 'Inventario', icono: 'boxes-stacked', roles: ['admin'], render: renderInventario, grupo: 'Finanzas' },
    { id: 'ventas', titulo: 'Ventas y cobros', icono: 'cash-register', roles: ['admin'], permiso: 'cajero', render: renderVentas, grupo: 'Finanzas' },
    { id: 'caja', titulo: 'Caja', icono: 'vault', roles: ['admin'], permiso: 'cajero', render: renderCaja, grupo: 'Finanzas' },
    { id: 'gastos', titulo: 'Gastos', icono: 'file-invoice-dollar', roles: ['admin'], render: renderGastos, grupo: 'Finanzas' },
    { id: 'fin-reportes', titulo: 'Reportes financieros', icono: 'chart-line', roles: ['admin'], render: renderFinReportes, grupo: 'Finanzas' },
    { id: 'negocio', titulo: 'Negocio', icono: 'store', roles: ['admin'], render: renderNegocio, grupo: 'Configuración' },
    { id: 'ubicacion', titulo: 'Ubicación del local', icono: 'location-dot', roles: ['admin'], render: (c, ctx, o) => renderNegocio(c, ctx, { ...o, sub: 'ubicacion' }), grupo: 'Configuración' },
    { id: 'whatsapp', titulo: 'WhatsApp', icono: 'comment-dots', roles: ['admin'], render: renderWhatsApp, grupo: 'Configuración' },
    { id: 'modulos', titulo: 'Módulos', icono: 'puzzle-piece', roles: ['admin'], render: (c, ctx) => renderTabModulos(c, ctx.notificar), grupo: 'Configuración' },
    { id: 'auditoria', titulo: 'Registro de cambios', icono: 'clipboard-list', roles: ['admin'], render: renderAuditoria, grupo: 'Configuración' }
];

// Orden del menú del barbero
const ORDEN_BARBERO = ['resumen', 'agenda', 'atencion', 'portafolio', 'ingresos', 'disponibilidad', 'ocupacion', 'reclamaciones', 'notificaciones', 'perfil', 'ventas', 'caja'];

function seccionesDe(sesion) {
    const lista = SECCIONES.filter(s => s.roles.includes(sesion.rol) || (s.permiso && (sesion.permisos || []).includes(s.permiso)))
        .map(s => ({ ...s, titulo: s.titulos?.[sesion.rol] || s.titulo }));
    return sesion.rol === 'barbero' ? lista.sort((a, b) => ORDEN_BARBERO.indexOf(a.id) - ORDEN_BARBERO.indexOf(b.id)) : lista;
}

// Menú agrupado (lateral en PC, desplegable con grupos en el móvil)
function menuAgrupado(disponibles, plantilla) {
    const grupos = [...new Set(disponibles.map(s => s.grupo))];
    return grupos.map(g => plantilla(g, disponibles.filter(s => s.grupo === g))).join('');
}

let seccionActual = 'resumen';

export function renderPanel(contenedor, { sesion, notificar, cerrar, salir, inicio = null }) {
    const disponibles = seccionesDe(sesion);
    if (inicio?.seccion && disponibles.some(s => s.id === inicio.seccion)) seccionActual = inicio.seccion;
    if (!disponibles.some(s => s.id === seccionActual)) seccionActual = 'resumen';
    contenedor.classList.add('panel-shell');
    contenedor.innerHTML = `
        <header class="panel-top">
            <div class="panel-marca"><i class="fas fa-crown"></i><div><strong>Panel de gestión</strong>
                <small>${esc(sesion.email || '')} · ${sesion.rol === 'admin' ? 'Administrador' : `Barbero (${esc(sesion.barbero_nombre || '')})`}</small></div></div>
            <label class="panel-menu-movil"><span class="sr-only">Sección</span>
                <select aria-label="Sección del panel">${menuAgrupado(disponibles, (g, secciones) => `<optgroup label="${esc(g)}">${secciones.map(s => `<option value="${s.id}">${esc(s.titulo)}</option>`).join('')}</optgroup>`)}</select></label>
            <div class="panel-top-acciones">
                <button type="button" class="panel-icono panel-campana" data-campana aria-label="Notificaciones"><i class="fas fa-bell"></i><span class="panel-aviso-numero" data-contador hidden></span></button>
                <button type="button" class="panel-btn" data-salir><i class="fas fa-right-from-bracket"></i> <span>Cerrar sesión</span></button>
                <button type="button" class="panel-icono" id="btn-cerrar-dashboard-inner" aria-label="Cerrar panel"><i class="fas fa-times"></i></button>
            </div>
        </header>
        <div class="panel-cuerpo">
            <nav class="panel-menu" aria-label="Secciones del panel">${menuAgrupado(disponibles, (g, secciones) => `
                ${disponibles.length > secciones.length ? `<p class="panel-menu-grupo">${esc(g)}</p>` : ''}${secciones.map(s => `
                <button type="button" data-seccion="${s.id}"><i class="fas fa-${s.icono}"></i><span>${esc(s.titulo)}</span></button>`).join('')}`)}
            </nav>
            <main class="panel-contenido" id="admin-tab-body" tabindex="-1"></main>
        </div>`;

    const cuerpo = contenedor.querySelector('.panel-contenido');
    const selector = contenedor.querySelector('.panel-menu-movil select');
    const ctx = { ...sesion, notificar, irA: (id, opciones) => mostrar(id, opciones), actualizarAvisos };

    // Aviso interno: reclamaciones que esperan al equipo (sin envíos externos)
    async function actualizarAvisos() {
        let n = 0;
        try { n = await api('panel_reclamaciones_pendientes'); } catch { return; }
        const boton = contenedor.querySelector('[data-seccion="reclamaciones"]');
        if (!boton) return;
        boton.querySelector('.panel-aviso-numero')?.remove();
        if (n > 0) boton.insertAdjacentHTML('beforeend', `<span class="panel-aviso-numero" aria-label="${n} pendiente(s)">${n}</span>`);
        const opcion = selector.querySelector('option[value="reclamaciones"]');
        if (opcion) opcion.textContent = n > 0 ? `Reclamaciones (${n})` : 'Reclamaciones';
    }

    async function mostrar(id, opciones = {}) {
        const seccion = disponibles.find(s => s.id === id) || disponibles[0];
        seccionActual = seccion.id;
        selector.value = seccion.id;
        contenedor.querySelectorAll('[data-seccion]').forEach(b => {
            if (b.dataset.seccion === seccion.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        cuerpo.innerHTML = '';
        cuerpo.scrollTop = 0;
        try {
            await seccion.render(cuerpo, ctx, opciones);
        } catch (e) {
            cuerpo.innerHTML = `<p class="panel-error">${esc(e.message || 'No se pudo cargar la sección.')}</p>`;
        }
    }

    contenedor.querySelectorAll('[data-seccion]').forEach(b => b.addEventListener('click', () => mostrar(b.dataset.seccion)));
    selector.addEventListener('change', () => mostrar(selector.value));
    contenedor.querySelector('#btn-cerrar-dashboard-inner').addEventListener('click', cerrar);
    contenedor.querySelector('[data-salir]').addEventListener('click', salir);
    contenedor.querySelector('[data-campana]').addEventListener('click', () => mostrar('notificaciones'));
    mostrar(seccionActual, seccionActual === inicio?.seccion ? inicio.opciones || {} : {});
    actualizarAvisos();

    // Avisos internos: contador, aviso visual y sonido (el navegador exige una acción del usuario para sonar)
    contenedor.addEventListener('pointerdown', () => desbloquearSonido(), { once: true });
    api('panel_notificaciones', { p_limite: 1, p_antes: null }).then(r => fijarPreferencias(r.preferencias)).catch(() => {});
    iniciarAvisos({
        usuario: sesion.email,
        vivo: () => contenedor.isConnected && contenedor.querySelector('.panel-contenido') === cuerpo,
        alContar: n => {
            const contador = contenedor.querySelector('[data-contador]');
            contador.hidden = !n;
            contador.textContent = n > 99 ? '99+' : String(n);
            const boton = contenedor.querySelector('[data-seccion="notificaciones"]');
            boton?.querySelector('.panel-aviso-numero')?.remove();
            if (n) boton?.insertAdjacentHTML('beforeend', `<span class="panel-aviso-numero">${n > 99 ? '99+' : n}</span>`);
        },
        alAviso: nuevas => {
            const n = nuevas.at(-1);
            notificar(nuevas.length > 1 ? `${nuevas.length} avisos nuevos. ${n.titulo}` : `${n.titulo}: ${n.cuerpo || ''}`, 'info');
            if (seccionActual === 'notificaciones') mostrar('notificaciones');
        }
    });
    // Clic en un aviso push con la app ya abierta
    navigator.serviceWorker?.addEventListener('message', e => {
        if (e.data?.tipo !== 'abrir-aviso' || !contenedor.isConnected) return;
        const params = new URL(e.data.url).searchParams;
        abrirAviso(ctx, { datos: { seccion: params.get('panel'), fecha: params.get('fecha') } });
    });
}
