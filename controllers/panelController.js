// ==========================================
// PANEL DE ADMINISTRACIÓN: estructura y navegación
// PC: menú lateral. Móvil: menú desplegable. Las secciones visibles dependen del
// rol, pero cada operación se vuelve a verificar en el servidor.
// ==========================================

import { esc } from './panel/comun.js';
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

const SECCIONES = [
    { id: 'resumen', titulo: 'Resumen', icono: 'gauge-high', roles: ['admin', 'barbero'], render: renderResumen },
    { id: 'agenda', titulo: 'Agenda', icono: 'calendar-days', roles: ['admin', 'barbero'], render: renderAgenda },
    { id: 'horarios', titulo: 'Horarios', icono: 'clock', roles: ['admin'], render: renderHorarios },
    { id: 'servicios', titulo: 'Servicios', icono: 'scissors', roles: ['admin'], render: renderServicios },
    { id: 'barberos', titulo: 'Barberos', icono: 'users', roles: ['admin'], render: renderBarberos },
    { id: 'clientes', titulo: 'Clientes', icono: 'address-book', roles: ['admin'], render: renderClientes },
    { id: 'reportes', titulo: 'Cobros y reportes', icono: 'chart-column', roles: ['admin'], render: renderReportes },
    { id: 'negocio', titulo: 'Negocio', icono: 'store', roles: ['admin'], render: renderNegocio },
    { id: 'ubicacion', titulo: 'Ubicación del local', icono: 'location-dot', roles: ['admin'], render: (c, ctx, o) => renderNegocio(c, ctx, { ...o, sub: 'ubicacion' }) },
    { id: 'whatsapp', titulo: 'WhatsApp', icono: 'comment-dots', roles: ['admin'], render: renderWhatsApp },
    { id: 'modulos', titulo: 'Módulos', icono: 'puzzle-piece', roles: ['admin'], render: (c, ctx) => renderTabModulos(c, ctx.notificar) },
    { id: 'auditoria', titulo: 'Registro de cambios', icono: 'clipboard-list', roles: ['admin'], render: renderAuditoria }
];

let seccionActual = 'resumen';

export function renderPanel(contenedor, { sesion, notificar, cerrar, salir }) {
    const disponibles = SECCIONES.filter(s => s.roles.includes(sesion.rol));
    if (!disponibles.some(s => s.id === seccionActual)) seccionActual = 'resumen';
    contenedor.classList.add('panel-shell');
    contenedor.innerHTML = `
        <header class="panel-top">
            <div class="panel-marca"><i class="fas fa-crown"></i><div><strong>Panel de gestión</strong>
                <small>${esc(sesion.email || '')} · ${sesion.rol === 'admin' ? 'Administrador' : `Barbero (${esc(sesion.barbero_nombre || '')})`}</small></div></div>
            <label class="panel-menu-movil"><span class="sr-only">Sección</span>
                <select aria-label="Sección del panel">${disponibles.map(s => `<option value="${s.id}">${esc(s.titulo)}</option>`).join('')}</select></label>
            <div class="panel-top-acciones">
                <button type="button" class="panel-btn" data-salir><i class="fas fa-right-from-bracket"></i> <span>Cerrar sesión</span></button>
                <button type="button" class="panel-icono" id="btn-cerrar-dashboard-inner" aria-label="Cerrar panel"><i class="fas fa-times"></i></button>
            </div>
        </header>
        <div class="panel-cuerpo">
            <nav class="panel-menu" aria-label="Secciones del panel">${disponibles.map(s => `
                <button type="button" data-seccion="${s.id}"><i class="fas fa-${s.icono}"></i><span>${esc(s.titulo)}</span></button>`).join('')}
            </nav>
            <main class="panel-contenido" id="admin-tab-body" tabindex="-1"></main>
        </div>`;

    const cuerpo = contenedor.querySelector('.panel-contenido');
    const selector = contenedor.querySelector('.panel-menu-movil select');
    const ctx = { ...sesion, notificar, irA: (id, opciones) => mostrar(id, opciones) };

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
    mostrar(seccionActual);
}
