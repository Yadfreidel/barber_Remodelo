// ==========================================
// PANEL: CAJA
// Apertura con fondo, entradas y retiros con motivo, efectivo esperado en vivo,
// cierre con efectivo contado y diferencia. Tarjeta y transferencia se muestran
// aparte: no forman parte del efectivo esperado. Los cierres se conservan y
// sus correcciones quedan registradas.
// ==========================================

import { api, esc, dinero, dialogo, confirmar, fechaHora, vacio } from './comun.js';
import { nuevaClave, exigirConexion, numero, turnoDe } from './finanzas-comun.js';

async function operar(boton, funcion, datos, ctx, ok) {
    if (boton.disabled) return null;
    boton.disabled = true;
    try {
        exigirConexion();
        // Misma clave en los reintentos del mismo formulario: no se registra dos veces
        const r = await api(funcion, { p_datos: { clave: boton.dataset.clave || (boton.dataset.clave = nuevaClave()), ...datos } });
        ctx.notificar(ok);
        return r;
    } catch (e) {
        ctx.notificar(e.message, 'error');
        boton.disabled = false;
        return null;
    }
}

function filasResumen(r) {
    return `<dl class="caja-cuentas">
        <div><dt>Fondo inicial</dt><dd>${dinero(r.fondo_inicial)}</dd></div>
        <div><dt>+ Cobros en efectivo</dt><dd>${dinero(r.cobros_efectivo)}</dd></div>
        <div><dt>− Reembolsos en efectivo</dt><dd>${dinero(r.reembolsos_efectivo)}</dd></div>
        <div><dt>+ Entradas manuales</dt><dd>${dinero(r.entradas)}</dd></div>
        <div><dt>− Retiros</dt><dd>${dinero(r.retiros)}</dd></div>
        <div><dt>− Gastos pagados con la caja</dt><dd>${dinero(r.gastos_efectivo)}</dd></div>
        <div class="caja-esperado"><dt>Efectivo esperado</dt><dd>${dinero(r.efectivo_esperado)}</dd></div></dl>
        <dl class="caja-cuentas caja-otros">
        <div><dt>Tarjeta (no entra en caja)</dt><dd>${dinero(r.cobros_tarjeta)}</dd></div>
        <div><dt>Transferencia (no entra en caja)</dt><dd>${dinero(r.cobros_transferencia)}</dd></div>
        ${Number(r.cobros_otro) ? `<div><dt>Otros medios</dt><dd>${dinero(r.cobros_otro)}</dd></div>` : ''}
        ${Number(r.reembolsos_otros_medios) ? `<div><dt>Reembolsos por otros medios</dt><dd>${dinero(r.reembolsos_otros_medios)}</dd></div>` : ''}
        <div><dt>Ventas en esta caja</dt><dd>${esc(r.ventas)}</dd></div></dl>`;
}

export async function renderCaja(cont, ctx) {
    const vigente = turnoDe(cont);
    cont.innerHTML = '<p class="panel-cargando">Cargando caja…</p>';
    let estado;
    try { estado = await api('panel_caja_estado'); } catch (e) { if (vigente()) cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const recargar = () => renderCaja(cont, ctx);
    const s = estado.abierta;
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Caja</h2>
            <p class="panel-sub">El fondo inicial, los aportes y los retiros no son ventas. Tarjeta y transferencia no cambian el efectivo esperado.</p></div></div>
        ${s ? `<section class="panel-caja"><h3><i class="fas fa-lock-open"></i> Caja #${esc(s.numero)} abierta</h3>
                <p class="panel-sub">Desde ${esc(fechaHora(s.abierta_en))} · ${esc(s.abierta_por || '')}</p>
                ${filasResumen(s.resumen)}</section>
            <div class="reportes-rejilla">
            <section class="panel-caja"><h3>Entrada o retiro de efectivo</h3>
                <form class="panel-form" data-movimiento novalidate><div class="panel-rejilla">
                    <label>Tipo<select name="tipo"><option value="entrada">Entrada (aporte)</option><option value="retiro">Retiro</option></select></label>
                    <label>Importe RD$<input type="number" name="monto" min="0.01" step="0.01" inputmode="decimal" required></label></div>
                    <label>Motivo<input name="motivo" maxlength="300" required placeholder="Ej.: depósito en el banco"></label>
                    <button type="submit" class="panel-btn">Registrar</button></form>
                ${s.movimientos.length ? `<ul class="panel-lista">${s.movimientos.map(m => `<li>${esc(fechaHora(m.creado_en))} · ${m.tipo === 'entrada' ? 'Entrada' : 'Retiro'} ${dinero(m.monto)} · ${esc(m.motivo)} <small>(${esc(m.usuario || '')})</small></li>`).join('')}</ul>` : ''}
            </section>
            <section class="panel-caja"><h3>Cerrar caja</h3>
                <form class="panel-form" data-cierre novalidate>
                    <label>Efectivo contado RD$<input type="number" name="contado" min="0" step="0.01" inputmode="decimal" required></label>
                    <p class="caja-diferencia" data-diferencia aria-live="polite">Cuenta el efectivo de la gaveta.</p>
                    <label>Observación<textarea name="observacion" rows="2" maxlength="500" placeholder="Obligatoria si hay diferencia"></textarea></label>
                    <button type="submit" class="panel-btn panel-btn-principal">Cerrar caja</button></form>
            </section></div>`
        : `<section class="panel-caja"><h3><i class="fas fa-lock"></i> La caja está cerrada</h3>
                <p class="panel-sub">Ábrela para cobrar o devolver en efectivo y para pagar gastos con la caja.</p>
                <form class="panel-form" data-apertura novalidate><label>Fondo inicial RD$<input type="number" name="fondo" min="0" step="0.01" inputmode="decimal" required value="0"></label>
                    <button type="submit" class="panel-btn panel-btn-principal">Abrir caja</button></form></section>`}
        <section class="panel-caja"><h3>Cierres recientes</h3>${estado.recientes.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas">
            <thead><tr><th>Caja</th><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>Observación</th><th></th></tr></thead><tbody>
            ${estado.recientes.map(c => `<tr><td data-titulo="Caja">#${esc(c.numero)}</td><td data-titulo="Cierre">${esc(fechaHora(c.cerrada_en))}<br><small>${esc(c.cerrada_por || '')}</small></td>
                <td data-titulo="Esperado">${dinero(c.efectivo_esperado)}</td><td data-titulo="Contado">${dinero(c.efectivo_contado)}</td>
                <td data-titulo="Diferencia" class="${Number(c.diferencia) < 0 ? 'texto-negativo' : Number(c.diferencia) > 0 ? 'texto-positivo' : ''}">${dinero(c.diferencia)}</td>
                <td data-titulo="Observación">${esc(c.observacion || '—')}${c.correcciones.length ? `<br><small>Corregido ${c.correcciones.length} vez/veces</small>` : ''}</td>
                <td><button type="button" class="panel-btn panel-btn-mini" data-ver="${esc(c.id)}">Ver</button></td></tr>`).join('')}</tbody></table></div>`
            : vacio('Aún no hay cierres.', 'cash-register')}</section>`;

    cont.querySelector('[data-apertura]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const fondo = numero(e.target.elements.fondo);
        if (fondo === null || fondo < 0) { ctx.notificar('Indica el fondo inicial (puede ser 0).', 'error'); return; }
        if (await operar(e.submitter, 'panel_caja_abrir', { fondo_inicial: fondo }, ctx, 'Caja abierta')) recargar();
    });
    cont.querySelector('[data-movimiento]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        const monto = numero(f.monto);
        if (!(monto > 0) || f.motivo.value.trim().length < 3) { ctx.notificar('Indica el importe y el motivo.', 'error'); return; }
        if (await operar(e.submitter, 'panel_caja_movimiento', { tipo: f.tipo.value, monto, motivo: f.motivo.value.trim() }, ctx,
            f.tipo.value === 'entrada' ? 'Entrada registrada' : 'Retiro registrado')) recargar();
    });
    const cierre = cont.querySelector('[data-cierre]');
    cierre?.addEventListener('input', () => {
        const contado = numero(cierre.elements.contado);
        const esperado = Number(s.resumen.efectivo_esperado);
        cierre.querySelector('[data-diferencia]').innerHTML = contado === null ? 'Cuenta el efectivo de la gaveta.'
            : `Esperado ${dinero(esperado)} · Diferencia <strong>${dinero(contado - esperado)}</strong>${contado < esperado ? ' (falta)' : contado > esperado ? ' (sobra)' : ''}`;
    });
    cierre?.addEventListener('submit', async e => {
        e.preventDefault();
        const contado = numero(cierre.elements.contado);
        const obs = cierre.elements.observacion.value.trim();
        if (contado === null || contado < 0) { ctx.notificar('Indica el efectivo contado.', 'error'); return; }
        const diferencia = contado - Number(s.resumen.efectivo_esperado);
        if (Math.abs(diferencia) > 0.004 && obs.length < 3) { ctx.notificar('Hay diferencia: escribe una observación.', 'error'); return; }
        if (!await confirmar(`¿Cerrar la caja con ${dinero(contado)} contados (diferencia ${dinero(diferencia)})? El cierre queda guardado.`, { textoOk: 'Cerrar caja' })) return;
        if (await operar(e.submitter, 'panel_caja_cerrar', { sesion_id: s.id, efectivo_contado: contado, observacion: obs }, ctx, 'Caja cerrada')) recargar();
    });
    cont.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => verCierre(estado.recientes.find(c => c.id === b.dataset.ver), ctx, recargar)));
}

function verCierre(c, ctx, recargar) {
    const { cuerpo, cerrar } = dialogo({ titulo: `Cierre de la caja #${c.numero}`, ancho: 'md', html: `
        <p class="panel-sub">Abierta ${esc(fechaHora(c.abierta_en))} (${esc(c.abierta_por || '')}) · cerrada ${esc(fechaHora(c.cerrada_en))} (${esc(c.cerrada_por || '')})</p>
        ${filasResumen(c.resumen)}
        <dl class="caja-cuentas"><div><dt>Efectivo contado</dt><dd>${dinero(c.efectivo_contado)}</dd></div>
            <div class="caja-esperado"><dt>Diferencia</dt><dd>${dinero(c.diferencia)}</dd></div></dl>
        ${c.observacion ? `<p>Observación: ${esc(c.observacion)}</p>` : ''}
        ${c.correcciones.length ? `<h4>Correcciones</h4><ul class="panel-lista">${c.correcciones.map(x => `<li>${esc(fechaHora(x.creado_en))} · contado ${dinero(x.antes)} → ${dinero(x.despues)} · ${esc(x.motivo)} <small>(${esc(x.usuario || '')})</small></li>`).join('')}</ul>` : ''}
        <details class="detalle-bloque"><summary>Corregir el efectivo contado</summary>
            <form class="panel-form" data-corregir novalidate>
                <label>Efectivo contado correcto RD$<input type="number" name="contado" min="0" step="0.01" required></label>
                <label>Motivo de la corrección<input name="motivo" maxlength="500" required></label>
                <p class="panel-sub">El valor anterior queda registrado junto con quién hizo el cambio.</p>
                <button type="submit" class="panel-btn panel-btn-peligro">Guardar corrección</button></form></details>` });
    cuerpo.querySelector('[data-corregir]').addEventListener('submit', async e => {
        e.preventDefault();
        const contado = numero(e.target.elements.contado);
        const motivo = e.target.elements.motivo.value.trim();
        if (contado === null || contado < 0 || motivo.length < 5) { ctx.notificar('Indica el importe y un motivo (mínimo 5 caracteres).', 'error'); return; }
        if (!await confirmar('¿Corregir un cierre ya guardado? Quedará registrado.', { textoOk: 'Corregir', peligro: true })) return;
        if (await operar(e.submitter, 'panel_caja_corregir', { sesion_id: c.id, efectivo_contado: contado, motivo }, ctx, 'Cierre corregido')) { cerrar(); recargar(); }
    });
}
