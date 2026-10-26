// ==========================================
// PANEL: MIS INGRESOS (solo lectura)
// Datos de las ventas existentes. Sin reglas de comisión configuradas no se inventan importes.
// ==========================================

import { api, esc, dinero, fechaHora, vacio } from './comun.js';
import { rangoPeriodo, filtrosPeriodo, conectarPeriodo, turnoDe } from './finanzas-comun.js';

const periodo = { tipo: 'mes' };
const estado = { barbero: '' };

export async function renderIngresos(cont, ctx) {
    const esAdmin = ctx.rol === 'admin';
    const [desde, hasta] = rangoPeriodo(periodo);
    const vigente = turnoDe(cont);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>${esAdmin ? 'Ingresos por barbero' : 'Mis ingresos'}</h2>
            <p class="panel-sub">Solo lectura. Servicios cobrados según las ventas registradas en caja.</p></div></div>
        <div class="agenda-filtros">${filtrosPeriodo(periodo, [desde, hasta])}
            ${esAdmin ? '<select data-barbero aria-label="Barbero"><option value="">Elige un barbero</option></select>' : ''}</div>
        <div data-cuerpo><p class="panel-cargando">Cargando…</p></div>`;
    const recargar = () => renderIngresos(cont, ctx);
    conectarPeriodo(cont, periodo, recargar);
    const cuerpo = cont.querySelector('[data-cuerpo]');
    if (esAdmin) {
        const sel = cont.querySelector('[data-barbero]');
        try {
            sel.innerHTML += (await api('panel_barberos')).map(b => `<option value="${esc(b.id)}" ${String(b.id) === estado.barbero ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
        } catch { /* la lista se reintenta al recargar */ }
        sel.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });
        if (!estado.barbero) { cuerpo.innerHTML = vacio('Elige un barbero para ver sus ingresos.', 'user'); return; }
    }
    let d;
    try { d = await api('panel_mis_ingresos', { p_desde: desde, p_hasta: hasta, p_barbero: esAdmin ? estado.barbero : null }); }
    catch (e) { if (vigente()) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const tarjeta = (titulo, valor, nota, icono) => `<article class="resumen-tarjeta"><i class="fas fa-${icono}"></i><div><span>${esc(titulo)}</span><strong>${valor}</strong>${nota ? `<small>${esc(nota)}</small>` : ''}</div></article>`;
    cuerpo.innerHTML = `
        <div class="resumen-tarjetas">
            ${tarjeta('Servicios realizados', String(d.realizados.servicios), 'Citas tuyas marcadas como terminadas en el periodo', 'scissors')}
            ${tarjeta('Servicios cobrados', dinero(d.cobrados.importe), `${d.cobrados.servicios} servicio(s) en ventas pagadas por completo`, 'cash-register')}
            ${tarjeta('Pendiente de cobro', dinero(d.pendientes_cobro.importe), `${d.pendientes_cobro.servicios} servicio(s) en ventas con saldo`, 'hourglass-half')}
            ${tarjeta('Comisión', 'No disponible', d.comision.motivo, 'percent')}
            ${tarjeta('Propinas', 'No disponible', d.propinas.motivo, 'hand-holding-dollar')}
        </div>
        <p class="panel-sub">Importes por servicio después de descuentos y devoluciones. Para calcular comisiones, la barbería debe definir antes sus reglas.</p>
        ${d.detalle.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Venta</th><th>Fecha</th><th>Servicio</th><th>Importe</th><th>Estado</th></tr></thead>
            <tbody>${d.detalle.map(l => `<tr><td data-titulo="Venta">#${esc(l.numero)}</td><td data-titulo="Fecha">${esc(fechaHora(l.fecha))}</td>
                <td data-titulo="Servicio">${esc(l.servicio)}</td><td data-titulo="Importe">${dinero(l.importe)}</td>
                <td data-titulo="Estado">${l.cobrada ? '<span class="estado-chip estado-confirmada">Cobrado</span>' : '<span class="estado-chip estado-pendiente">Con saldo</span>'}</td></tr>`).join('')}</tbody></table></div>`
            : vacio('No hay servicios cobrados en el periodo.', 'receipt')}`;
}
