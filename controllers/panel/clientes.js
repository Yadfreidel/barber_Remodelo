// ==========================================
// PANEL: CLIENTES (solo administradores)
// ==========================================

import { api, esc, dinero, fechaCorta, etiquetaEstado, dialogo, ejecutar, telefonoWhatsApp, vacio } from './comun.js';
import { abrirDetalle } from './agenda.js';

let busqueda = '';

export async function renderClientes(cont, ctx) {
    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Clientes</h2><p class="panel-sub">Se agrupan por teléfono (mismos últimos 10 dígitos). El correo es opcional.</p></div>
        </div>
        <div class="agenda-filtros">
            <input type="search" data-buscar placeholder="Buscar por nombre o teléfono" value="${esc(busqueda)}" aria-label="Buscar cliente">
            <label class="panel-check"><input type="checkbox" data-duplicados> Solo posibles duplicados</label>
        </div>
        <div data-lista><p class="panel-cargando">Cargando clientes…</p></div>`;
    const lista = cont.querySelector('[data-lista]');
    let clientes = [];
    const pintar = () => {
        const solo = cont.querySelector('[data-duplicados]').checked;
        const visibles = solo ? clientes.filter(c => c.posible_duplicado) : clientes;
        lista.innerHTML = visibles.length ? `
            <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas">
                <thead><tr><th>Cliente</th><th>Teléfono</th><th>Citas</th><th>Última visita</th><th>Próxima</th><th>Cobrado</th><th></th></tr></thead>
                <tbody>${visibles.map(c => `<tr>
                    <td data-titulo="Cliente"><strong>${esc(c.nombre)}</strong>
                        ${c.posible_duplicado ? `<br><span class="estado-chip estado-pendiente" title="${esc(c.nombres.join(' / '))}">Posible duplicado</span>` : ''}</td>
                    <td data-titulo="Teléfono">${esc(c.telefono)}</td>
                    <td data-titulo="Citas">${c.total_citas} <small>(${c.completadas} completadas, ${c.canceladas} canceladas, ${c.ausencias} ausencias)</small></td>
                    <td data-titulo="Última visita">${c.ultima_visita ? esc(fechaCorta(c.ultima_visita)) : '—'}</td>
                    <td data-titulo="Próxima">${c.proxima_cita ? esc(fechaCorta(c.proxima_cita)) : '—'}</td>
                    <td data-titulo="Cobrado">${dinero(c.cobrado)}</td>
                    <td><button type="button" class="panel-btn" data-ver="${esc(c.telefono)}">Ver ficha</button></td>
                </tr>`).join('')}</tbody></table></div>` : vacio(busqueda ? 'Sin resultados.' : 'Aún no hay clientes con citas.', 'users');
        lista.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => abrirCliente(ctx, b.dataset.ver, cargar)));
    };
    const cargar = async () => {
        try { clientes = await api('panel_clientes', { p_busqueda: busqueda || null }); pintar(); }
        catch (e) { lista.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; }
    };
    let espera;
    cont.querySelector('[data-buscar]').addEventListener('input', e => {
        busqueda = e.target.value.trim();
        clearTimeout(espera);
        espera = setTimeout(cargar, 350);
    });
    cont.querySelector('[data-duplicados]').addEventListener('change', pintar);
    await cargar();
}

async function abrirCliente(ctx, telefono, recargar) {
    let c;
    try { c = await api('panel_cliente', { p_telefono: telefono }); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    const ficha = c.ficha || {};
    const nombre = ficha.nombre || c.nombres?.[0] || '';
    const pref = ficha.preferencias || {};
    const variantes = (c.telefonos?.length || 0) > 1 || (c.nombres?.length || 0) > 1;
    const { cuerpo, cerrar } = dialogo({ titulo: `Cliente: ${nombre}`, ancho: 'lg', html: `
        ${variantes ? `<div class="panel-aviso"><strong>Posible duplicado:</strong> este número aparece como
            ${esc((c.nombres || []).join(' / '))} con ${esc((c.telefonos || []).join(' / '))}. Unifica el nombre y teléfono abajo y marca "aplicar a citas futuras".</div>` : ''}
        <form class="panel-form" novalidate>
            <div class="panel-rejilla">
                <label>Nombre<input name="nombre" required maxlength="120" value="${esc(nombre)}"></label>
                <label>Teléfono<input name="telefono" inputmode="tel" value="${esc(c.telefono)}"></label>
                <label>Correo (opcional)<input type="email" name="email" maxlength="160" value="${esc(ficha.email || '')}"></label>
            </div>
            <div class="panel-rejilla">
                <label>Barbero preferido<input name="pref_barbero" maxlength="80" value="${esc(pref.barbero || '')}"></label>
                <label>Servicio preferido<input name="pref_servicio" maxlength="120" value="${esc(pref.servicio || '')}"></label>
            </div>
            <label>Notas y preferencias<textarea name="notas" rows="3" maxlength="1000">${esc(ficha.notas || '')}</textarea></label>
            <label class="panel-check"><input type="checkbox" name="actualizar_citas_futuras"> Aplicar nombre y teléfono a sus citas futuras (el historial pasado no cambia)</label>
            <p class="panel-sub">Promociones por WhatsApp: ${c.consentimiento?.marketing ? 'aceptó' : c.consentimiento?.baja_en ? 'se dio de baja' : 'sin consentimiento'}.
                <a href="https://wa.me/${esc(telefonoWhatsApp(c.telefono))}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Abrir chat</a></p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cerrar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar ficha</button></div>
        </form>
        <h4>Historial (${c.historial.length})</h4>
        <ul class="panel-lista">${c.historial.map(h => `<li>
            <button type="button" class="panel-enlace" data-cita="${esc(h.id)}">${esc(fechaCorta(h.fecha))} ${esc(h.hora)}</button>
            ${esc(h.servicio || '')} · ${esc(h.barbero || '')} · ${dinero(h.precio)} ${etiquetaEstado(h)}
            ${h.motivo_cancelacion ? `<small>· ${esc(h.motivo_cancelacion)}</small>` : ''}</li>`).join('')}</ul>` });
    const form = cuerpo.querySelector('form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = new FormData(form);
        const datos = { nombre: d.get('nombre').trim(), telefono: d.get('telefono').trim(), email: d.get('email').trim(), notas: d.get('notas').trim(),
            preferencias: { barbero: d.get('pref_barbero').trim(), servicio: d.get('pref_servicio').trim() },
            actualizar_citas_futuras: form.elements.actualizar_citas_futuras.checked };
        if (!datos.nombre || datos.telefono.replace(/\D/g, '').length < 7) { ctx.notificar('Nombre y teléfono son obligatorios.', 'error'); return; }
        if (await ejecutar(e.submitter, () => api('panel_guardar_cliente', { p_telefono: c.telefono, p_datos: datos }), ctx.notificar, 'Ficha guardada')) {
            cerrar();
            recargar();
        }
    });
    cuerpo.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => { cerrar(); abrirDetalle(b.dataset.cita, ctx, recargar); }));
}
