// ==========================================
// PANEL: GASTOS
// Un gasto pagado con la caja ya descuenta del efectivo esperado: no se registra
// además como retiro. Los pagos de compras se registran desde Inventario > Compras
// para enlazarlos con la mercancía recibida.
// ==========================================

import { api, esc, dinero, confirmar, fechaCorta, hoyLocal, vacio, descargarCSV, imagenADataURL } from './comun.js';
import { CATEGORIAS_GASTO, MEDIOS_GASTO, nuevaClave, exigirConexion, rangoPeriodo, filtrosPeriodo, conectarPeriodo, numero, turnoDe } from './finanzas-comun.js';

const periodo = { tipo: 'mes' };

export async function renderGastos(cont, ctx) {
    const [desde, hasta] = rangoPeriodo(periodo);
    const vigente = turnoDe(cont);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Gastos</h2>
            <p class="panel-sub">Si pagas con el efectivo de la caja, se descuenta solo del efectivo esperado (no registres además un retiro).</p></div></div>
        <section class="panel-caja"><h3>Registrar gasto</h3>
            <form class="panel-form" data-gasto novalidate><div class="panel-rejilla">
                <label>Fecha<input type="date" name="fecha" value="${hoyLocal()}" max="${hoyLocal()}" required></label>
                <label>Categoría<select name="categoria">${Object.entries(CATEGORIAS_GASTO).filter(([k]) => k !== 'compra_mercancia')
                    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
                <label>Importe RD$<input type="number" name="monto" min="0.01" step="0.01" inputmode="decimal" required></label>
                <label>Pagado con<select name="medio">${Object.entries(MEDIOS_GASTO).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
                <label>Responsable<input name="responsable" maxlength="120"></label>
                <label>N.º de comprobante (opcional)<input name="comprobante" maxlength="120"></label></div>
                <label>Descripción<input name="descripcion" maxlength="300" required placeholder="Ej.: factura de electricidad de octubre"></label>
                <label>Foto del comprobante (opcional)<input type="file" name="imagen" accept="image/png,image/jpeg,image/webp"></label>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar gasto</button></form>
            <p class="panel-sub">Para pagar mercancía recibida usa Inventario › Compras › Registrar pago (así no se duplica).</p></section>
        <div class="agenda-filtros">${filtrosPeriodo(periodo, [desde, hasta])}<button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> CSV</button></div>
        <div data-lista><p class="panel-cargando">Cargando gastos…</p></div>`;
    const recargar = () => renderGastos(cont, ctx);
    conectarPeriodo(cont, periodo, recargar);

    const form = cont.querySelector('[data-gasto]');
    form.addEventListener('input', () => { delete form.dataset.clave; }); // otros datos = otra operación
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        const monto = numero(f.monto);
        if (!(monto > 0) || f.descripcion.value.trim().length < 3) { ctx.notificar('Indica el importe y una descripción.', 'error'); return; }
        const boton = e.submitter;
        boton.disabled = true;
        try {
            exigirConexion();
            const imagen = f.imagen.files[0] ? await imagenADataURL(f.imagen.files[0], 1200) : null;
            await api('panel_gasto_registrar', { p_datos: { clave: form.dataset.clave || (form.dataset.clave = nuevaClave()), fecha: f.fecha.value,
                categoria: f.categoria.value, descripcion: f.descripcion.value.trim(), monto, medio: f.medio.value, responsable: f.responsable.value.trim(),
                comprobante: f.comprobante.value.trim(), comprobante_imagen: imagen } });
            ctx.notificar('Gasto registrado');
            recargar();
        } catch (fallo) { ctx.notificar(fallo.message, 'error'); boton.disabled = false; }
    });

    let gastos = [];
    try { gastos = await api('panel_gastos', { p_desde: desde, p_hasta: hasta }); }
    catch (e) { if (vigente()) cont.querySelector('[data-lista]').innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const activos = gastos.filter(g => !g.anulado_en);
    cont.querySelector('[data-lista]').innerHTML = gastos.length ? `
        <p class="panel-sub">Total del periodo (sin anulados): <strong>${dinero(activos.reduce((s, g) => s + Number(g.monto), 0))}</strong></p>
        <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Importe</th><th>Pagado con</th><th>Comprobante</th><th></th></tr></thead>
        <tbody>${gastos.map(g => `<tr class="${g.anulado_en ? 'fila-anulada' : ''}">
            <td data-titulo="Fecha">${esc(fechaCorta(g.fecha))}</td><td data-titulo="Categoría">${esc(CATEGORIAS_GASTO[g.categoria] || g.categoria)}${g.compra_numero ? `<br><small>Compra #${esc(g.compra_numero)}</small>` : ''}</td>
            <td data-titulo="Descripción">${esc(g.descripcion)}${g.responsable ? `<br><small>${esc(g.responsable)}</small>` : ''}${g.anulado_en ? `<br><small>Anulado: ${esc(g.motivo_anulacion)}</small>` : ''}</td>
            <td data-titulo="Importe">${dinero(g.monto)}</td><td data-titulo="Pagado con">${esc(MEDIOS_GASTO[g.medio] || g.medio)}${g.caja_numero ? ` (caja #${esc(g.caja_numero)})` : ''}</td>
            <td data-titulo="Comprobante">${esc(g.comprobante || '')}${g.tiene_imagen ? ` <button type="button" class="panel-btn panel-btn-mini" data-imagen="${esc(g.id)}">Ver foto</button>` : ''}</td>
            <td>${g.anulado_en ? '' : `<button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-anular="${esc(g.id)}">Anular</button>`}</td></tr>`).join('')}</tbody></table></div>`
        : vacio('No hay gastos en el periodo.', 'receipt');
    cont.querySelectorAll('[data-imagen]').forEach(b => b.addEventListener('click', async () => {
        try {
            const url = await api('panel_gasto_comprobante', { p_id: b.dataset.imagen });
            const w = window.open('', '_blank');
            if (w) w.document.write(`<img src="${esc(url)}" alt="Comprobante" style="max-width:100%">`);
        } catch (e) { ctx.notificar(e.message, 'error'); }
    }));
    cont.querySelectorAll('[data-anular]').forEach(b => b.addEventListener('click', async () => {
        const motivo = window.prompt('Motivo de la anulación:', '');
        if (motivo === null) return;
        if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo.', 'error'); return; }
        if (!await confirmar('¿Anular este gasto? Quedará en el historial como anulado.', { textoOk: 'Anular gasto', peligro: true })) return;
        b.disabled = true;
        try {
            exigirConexion();
            await api('panel_gasto_anular', { p_datos: { clave: b.dataset.clave || (b.dataset.clave = nuevaClave()), gasto_id: b.dataset.anular, motivo: motivo.trim() } });
            ctx.notificar('Gasto anulado');
            recargar();
        } catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));
    cont.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`gastos-${desde}_${hasta}.csv`, [
        ['Número', 'Fecha', 'Categoría', 'Descripción', 'Importe (RD$)', 'Pagado con', 'Responsable', 'Comprobante', 'Compra', 'Anulado', 'Motivo de anulación'],
        ...gastos.map(g => [g.numero, g.fecha, CATEGORIAS_GASTO[g.categoria], g.descripcion, g.monto, MEDIOS_GASTO[g.medio], g.responsable || '', g.comprobante || '',
            g.compra_numero || '', g.anulado_en ? 'Sí' : 'No', g.motivo_anulacion || ''])]));
}
