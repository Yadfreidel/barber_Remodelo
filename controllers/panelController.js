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
import { iniciarAvisos, desbloquearSonido, fijarPreferencias, comprobarDispositivo } from './panel/avisos.js';

// Inventario, ventas y caja: solo administradores (el servidor lo vuelve a comprobar). Un barbero con el permiso
// explícito «cajero» ve también Ventas y Caja. «titulos.barbero» es el nombre de la sección en el menú del barbero.
const SECCIONES = [
    { id: 'resumen', titulo: 'Resumen', titulos: { barbero: 'Inicio' }, icono: 'gauge-high', roles: ['admin', 'barbero'], render: renderResumen, grupo: 'Día a día' },
    { id: 'agenda', titulo: 'Agenda', titulos: { barbero: 'Mi agenda' }, icono: 'calendar-days', roles: ['admin', 'barbero'], render: renderAgenda, grupo: 'Día a día' },
    { id: 'atencion', titulo: 'Atención', icono: 'play', roles: ['admin', 'barbero'], render: renderAtencion, grupo: 'Día a día' },
    { id: 'solicitudes', titulo: 'Solicitudes', icono: 'inbox', roles: ['admin'], render: renderSolicitudes, grupo: 'Día a día' },
    { id: 'reclamaciones', titulo: 'Reclamaciones', titulos: { barbero: 'Casos asignados' }, icono: 'flag', roles: ['admin', 'barbero'], render: renderReclamaciones, grupo: 'Día a día' },
    { id: 'notificaciones', titulo: 'Notificaciones', icono: 'bell', roles: ['admin', 'barbero'], render: renderNotificaciones, grupo: 'Día a día' },
    { id: 'horarios', titulo: 'Horarios', icono: 'clock', roles: ['admin'], render: renderHorarios, grupo: 'Catálogo y equipo' },
    { id: 'servicios', titulo: 'Servicios', icono: 'scissors', roles: ['admin'], render: renderServicios, grupo: 'Catálogo y equipo' },
    { id: 'barberos', titulo: 'Barberos', icono: 'users', roles: ['admin'], render: renderBarberos, grupo: 'Catálogo y equipo' },
    { id: 'portafolio', titulo: 'Portafolio', titulos: { barbero: 'Mi portafolio' }, icono: 'images', roles: ['admin', 'barbero'], render: renderPortafolio, grupo: 'Catálogo y equipo' },
    { id: 'disponibilidad', titulo: 'Mi disponibilidad', icono: 'business-time', roles: ['barbero'], render: renderDisponibilidad, grupo: 'Catálogo y equipo' },
    { id: 'clientes', titulo: 'Clientes', icono: 'address-book', roles: ['admin'], render: renderClientes, grupo: 'Clientes y análisis' },
    { id: 'ingresos', titulo: 'Ingresos por barbero', titulos: { barbero: 'Mis ingresos' }, icono: 'wallet', roles: ['admin', 'barbero'], render: renderIngresos, grupo: 'Clientes y análisis' },
    { id: 'reportes', titulo: 'Reportes de citas', icono: 'chart-column', roles: ['admin'], render: renderReportes, grupo: 'Clientes y análisis' },
    { id: 'ocupacion', titulo: 'Ocupación y horas vacías', titulos: { barbero: 'Mi ocupación' }, icono: 'chart-area', roles: ['admin', 'barbero'], render: renderOcupacion, grupo: 'Clientes y análisis' },
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
    { id: 'auditoria', titulo: 'Registro de cambios', icono: 'clipboard-list', roles: ['admin'], render: renderAuditoria, grupo: 'Configuración' },
    { id: 'perfil', titulo: 'Mi perfil', icono: 'id-badge', roles: ['admin', 'barbero'], render: renderPerfil, grupo: 'Configuración' }
];

// Orden del menú del barbero
const ORDEN_BARBERO = ['resumen', 'agenda', 'atencion', 'portafolio', 'ingresos', 'disponibilidad', 'ocupacion', 'reclamaciones', 'notificaciones', 'perfil', 'ventas', 'caja'];

function seccionesDe(sesion) {
    // El barbero ve su menú en su propio orden, sin los grupos del administrador (solo «Finanzas» aparte)
    const lista = SECCIONES.filter(s => s.roles.includes(sesion.rol) || (s.permiso && (sesion.permisos || []).includes(s.permiso)))
        .map(s => ({ ...s, titulo: s.titulos?.[sesion.rol] || s.titulo, grupo: sesion.rol === 'barbero' && s.grupo !== 'Finanzas' ? 'Mi trabajo' : s.grupo }));
    return sesion.rol === 'barbero' ? lista.sort((a, b) => ORDEN_BARBERO.indexOf(a.id) - ORDEN_BARBERO.indexOf(b.id)) : lista;
}

// Menú agrupado (lateral fijo en PC, panel deslizante en el móvil y la tablet)
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
    const cuenta = `${esc(sesion.email || '')} · ${sesion.rol === 'admin' ? 'Administrador' : `Barbero (${esc(sesion.barbero_nombre || '')})`}`;
    const marca = `<div class="panel-marca"><span class="panel-marca-icono" aria-hidden="true"><i class="fas fa-crown"></i></span><div><strong>Panel de gestión</strong>
                <small>${cuenta}</small></div></div>`;
    contenedor.innerHTML = `
        <header class="panel-top">
            <button type="button" class="panel-menu-boton" data-menu-abrir aria-expanded="false" aria-controls="panel-menu-nav">
                <i class="fas fa-bars" aria-hidden="true"></i><span class="sr-only">Menú de secciones. Sección actual:</span>
                <span class="panel-menu-actual"><i class="fas" data-menu-icono aria-hidden="true"></i><strong data-menu-actual></strong></span>
            </button>
            ${marca}
            <div class="panel-top-acciones">
                <button type="button" class="panel-icono panel-campana" data-campana aria-label="Notificaciones"><i class="fas fa-bell"></i><span class="panel-aviso-numero" data-contador hidden></span></button>
                <button type="button" class="panel-btn" data-salir><i class="fas fa-right-from-bracket"></i> <span>Cerrar sesión</span></button>
                <button type="button" class="panel-icono" id="btn-cerrar-dashboard-inner" aria-label="Cerrar panel"><i class="fas fa-times"></i></button>
            </div>
        </header>
        <div class="panel-cuerpo">
            <div class="panel-menu-fondo" data-menu-fondo hidden></div>
            <nav class="panel-menu" id="panel-menu-nav" aria-label="Secciones del panel">
                <div class="panel-menu-cabecera">${marca}
                    <button type="button" class="panel-icono" data-menu-cerrar aria-label="Cerrar menú"><i class="fas fa-times"></i></button>
                </div>${menuAgrupado(disponibles, (g, secciones) => `
                <div class="panel-menu-seccion">${disponibles.length > secciones.length ? `<p class="panel-menu-grupo">${esc(g)}</p>` : ''}${secciones.map(s => `
                <button type="button" data-seccion="${s.id}"><i class="fas fa-${s.icono}" aria-hidden="true"></i><span>${esc(s.titulo)}</span></button>`).join('')}</div>`)}
            </nav>
            <main class="panel-contenido" id="admin-tab-body" tabindex="-1"></main>
        </div>`;

    const cuerpo = contenedor.querySelector('.panel-contenido');
    const menu = contenedor.querySelector('.panel-menu');
    const botonMenu = contenedor.querySelector('[data-menu-abrir]');
    const fondoMenu = contenedor.querySelector('[data-menu-fondo]');
    const ctx = { ...sesion, notificar, irA: (id, opciones) => mostrar(id, opciones), actualizarAvisos, salir };

    // Aviso interno: reclamaciones que esperan al equipo (sin envíos externos)
    async function actualizarAvisos() {
        let n = 0;
        try { n = await api('panel_reclamaciones_pendientes'); } catch { return; }
        const boton = contenedor.querySelector('[data-seccion="reclamaciones"]');
        if (!boton) return;
        boton.querySelector('.panel-aviso-numero')?.remove();
        if (n > 0) boton.insertAdjacentHTML('beforeend', `<span class="panel-aviso-numero" aria-label="${n} pendiente(s)">${n}</span>`);
    }

    // Menú deslizante (móvil y tablet): se cierra con Escape, el fondo o al elegir; el foco vuelve al botón
    function abrirMenu() {
        menu.classList.add('abierto');
        fondoMenu.hidden = false;
        botonMenu.setAttribute('aria-expanded', 'true');
        (menu.querySelector('[aria-current="page"]') || menu.querySelector('[data-seccion]'))?.focus();
    }
    function cerrarMenu(devolverFoco = true) {
        if (!menu.classList.contains('abierto')) return;
        menu.classList.remove('abierto');
        fondoMenu.hidden = true;
        botonMenu.setAttribute('aria-expanded', 'false');
        if (devolverFoco) botonMenu.focus();
    }

    async function mostrar(id, opciones = {}) {
        const seccion = disponibles.find(s => s.id === id) || disponibles[0];
        seccionActual = seccion.id;
        botonMenu.querySelector('[data-menu-actual]').textContent = seccion.titulo;
        botonMenu.querySelector('[data-menu-icono]').className = `fas fa-${seccion.icono}`;
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

    contenedor.querySelectorAll('[data-seccion]').forEach(b => b.addEventListener('click', () => {
        const desdeMenu = menu.classList.contains('abierto');
        cerrarMenu(false);
        mostrar(b.dataset.seccion);
        if (desdeMenu) cuerpo.focus({ preventScroll: true });
    }));
    botonMenu.addEventListener('click', abrirMenu);
    fondoMenu.addEventListener('click', () => cerrarMenu());
    contenedor.querySelector('[data-menu-cerrar]').addEventListener('click', () => cerrarMenu());
    menu.addEventListener('keydown', e => {
        if (!menu.classList.contains('abierto')) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarMenu(); return; }
        if (e.key !== 'Tab') return;
        const focos = [...menu.querySelectorAll('button')];
        if (e.shiftKey && document.activeElement === focos[0]) { e.preventDefault(); focos.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === focos.at(-1)) { e.preventDefault(); focos[0].focus(); }
    });
    // En pantalla ancha el menú es fijo: si estaba abierto como panel deslizante, se cierra
    window.matchMedia('(max-width: 899px)').addEventListener('change', () => cerrarMenu(false));
    contenedor.querySelector('#btn-cerrar-dashboard-inner').addEventListener('click', cerrar);
    contenedor.querySelector('[data-salir]').addEventListener('click', () => salir());
    contenedor.querySelector('[data-campana]').addEventListener('click', () => mostrar('notificaciones'));
    mostrar(seccionActual, seccionActual === inicio?.seccion ? inicio.opciones || {} : {});
    actualizarAvisos();

    // Avisos internos: contador, aviso visual y sonido (el navegador exige una acción del usuario para sonar)
    contenedor.addEventListener('pointerdown', () => desbloquearSonido(), { once: true });
    api('panel_notificaciones', { p_limite: 1, p_antes: null }).then(r => fijarPreferencias(r.preferencias)).catch(() => {});
    // Un dispositivo que estaba registrado con otra cuenta deja de recibir sus avisos
    comprobarDispositivo();
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
            mostrarAvisoFlotante(n, nuevas.length);
            // La agenda, la atención, el resumen y la lista de avisos se actualizan sin recargar
            if (seccionActual === 'notificaciones' || (['agenda', 'atencion', 'resumen'].includes(seccionActual) && nuevas.some(x => String(x.tipo).startsWith('cita_')))) {
                mostrar(seccionActual);
            }
        }
    });
    // Aviso visible y accionable (el aviso normal desaparece solo y no se puede pulsar)
    function mostrarAvisoFlotante(n, total) {
        document.querySelector('.aviso-flotante')?.remove();
        const caja = document.createElement('div');
        caja.className = 'aviso-flotante';
        caja.setAttribute('role', 'alert');
        caja.innerHTML = '<i class="fas fa-bell" aria-hidden="true"></i><div><strong></strong><span></span></div>'
            + (n.datos?.seccion ? '<button type="button" class="panel-btn panel-btn-mini panel-btn-principal" data-ver></button>' : '')
            + '<button type="button" class="panel-icono" data-cerrar-aviso aria-label="Cerrar aviso"><i class="fas fa-times"></i></button>';
        caja.querySelector('strong').textContent = n.titulo + (total > 1 ? ` (+${total - 1})` : '');
        caja.querySelector('span').textContent = n.cuerpo || '';
        const ver = caja.querySelector('[data-ver]');
        if (ver) ver.textContent = n.datos?.cita ? 'Ver reserva' : 'Ver';
        document.body.append(caja);
        const quitar = () => caja.remove();
        const temporizador = setTimeout(quitar, 20000);
        caja.querySelector('[data-cerrar-aviso]').addEventListener('click', () => { clearTimeout(temporizador); quitar(); });
        ver?.addEventListener('click', () => {
            clearTimeout(temporizador);
            quitar();
            api('panel_notificaciones_leer', { p_ids: [n.id] }).catch(() => {});
            abrirAviso(ctx, n);
        });
    }

    // Clic en un aviso push con la app ya abierta
    navigator.serviceWorker?.addEventListener('message', e => {
        if (e.data?.tipo !== 'abrir-aviso' || !contenedor.isConnected || contenedor.closest('#dashboard-admin')?.style.display === 'none') return;
        const params = new URL(e.data.url).searchParams;
        abrirAviso(ctx, { datos: { seccion: params.get('panel'), fecha: params.get('fecha'), cita: params.get('cita') } });
    });
}
