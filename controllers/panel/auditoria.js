// ==========================================
// PANEL: REGISTRO DE CAMBIOS (quién hizo qué)
// ==========================================

import { api, esc, fechaHora, vacio } from './comun.js';

const ACCIONES = {
    cita_creada: 'Cita creada', cita_confirmada: 'Cita confirmada', cita_cancelada: 'Cita cancelada', cita_pendiente: 'Cita vuelve a pendiente',
    cita_reprogramada: 'Cita reprogramada', cita_completada: 'Cita completada', cita_no_asistio: 'Ausencia registrada',
    pago_registrado: 'Cobro registrado', pago_anulado: 'Cobro anulado', notas_actualizadas: 'Notas de cita',
    reglas_reserva: 'Reglas de reserva', horario_semanal: 'Horario semanal', bloqueo_creado: 'Bloqueo creado', bloqueo_desactivado: 'Bloqueo quitado',
    servicio_creado: 'Servicio creado', servicio_actualizado: 'Servicio actualizado', servicios_ordenados: 'Orden del catálogo',
    barbero_creado: 'Barbero creado', barbero_actualizado: 'Barbero actualizado', acceso_barbero: 'Acceso de barbero',
    cliente_actualizado: 'Ficha de cliente', negocio_publicado: 'Datos del negocio publicados', plantilla_whatsapp: 'Plantilla de WhatsApp'
};
const ROLES = { admin: 'Administración', barbero: 'Barbero', web: 'Cliente (web)', usuario: 'Usuario' };

export async function renderAuditoria(cont) {
    cont.innerHTML = '<p class="panel-cargando">Cargando registro…</p>';
    let filas;
    try { filas = await api('panel_auditoria', { p_limite: 300 }); } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Registro de cambios</h2><p class="panel-sub">Últimos 300 cambios importantes con su autor.</p></div></div>
        <div class="agenda-filtros"><input type="search" data-buscar placeholder="Filtrar por acción, usuario o detalle" aria-label="Filtrar"></div>
        <div data-lista></div>`;
    const lista = cont.querySelector('[data-lista]');
    const pintar = texto => {
        const t = texto.toLowerCase();
        const visibles = filas.filter(f => !t || `${ACCIONES[f.accion] || f.accion} ${f.usuario || ''} ${JSON.stringify(f.detalle)}`.toLowerCase().includes(t));
        lista.innerHTML = visibles.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas">
            <thead><tr><th>Fecha</th><th>Acción</th><th>Quién</th><th>Detalle</th></tr></thead>
            <tbody>${visibles.map(f => `<tr>
                <td data-titulo="Fecha">${esc(fechaHora(f.fecha))}</td>
                <td data-titulo="Acción">${esc(ACCIONES[f.accion] || f.accion)}</td>
                <td data-titulo="Quién">${esc(f.usuario || ROLES[f.rol] || f.rol)}${f.usuario ? `<br><small>${esc(ROLES[f.rol] || f.rol)}</small>` : ''}</td>
                <td data-titulo="Detalle"><small>${esc(resumen(f))}</small></td></tr>`).join('')}</tbody></table></div>` : vacio('Sin registros.', 'clipboard-list');
    };
    cont.querySelector('[data-buscar]').addEventListener('input', e => pintar(e.target.value.trim()));
    pintar('');
}

function resumen(f) {
    const d = f.detalle || {};
    if (d.motivo) return `Motivo: ${d.motivo}`;
    if (d.de && d.a) return `De ${d.de.fecha} ${d.de.hora} a ${d.a.fecha} ${d.a.hora}`;
    if (d.monto !== undefined) return `RD$ ${d.monto} · ${d.metodo || ''}`;
    if (d.cliente) return `${d.cliente} · ${d.fecha || ''} ${d.hora || ''}`;
    if (d.despues?.nombre) return d.despues.nombre;
    if (d.nombre) return d.nombre;
    if (d.email !== undefined) return d.email ? `Acceso para ${d.email}` : 'Acceso quitado';
    return f.entidad_id ? `${f.entidad} ${f.entidad_id}` : f.entidad;
}
