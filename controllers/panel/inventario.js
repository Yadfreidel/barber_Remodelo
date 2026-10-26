// ==========================================
// PANEL: INVENTARIO
// Artículos para vender e insumos de uso interno. La existencia solo cambia con
// movimientos registrados (compra, venta, consumo, pérdida, ajuste por conteo...).
// Valoración: costo promedio ponderado.
// ==========================================

import { api, esc, dinero, dialogo, confirmar, fechaHora, fechaCorta, hoyLocal, sumarDias, vacio, descargarCSV, imagenADataURL } from './comun.js';
import { UNIDADES, TIPOS_MOVIMIENTO, MEDIOS_GASTO, nuevaClave, cantidad, exigirConexion, rangoPeriodo, filtrosPeriodo, conectarPeriodo, numero, turnoDe } from './finanzas-comun.js';

const SUBSECCIONES = { articulos: 'Artículos', movimientos: 'Movimientos', compras: 'Compras', proveedores: 'Proveedores', consumos: 'Consumo por servicio' };
let sub = 'articulos';
let filtro = { texto: '', tipo: '' };
const periodoCompras = { tipo: 'mes' };

async function operar(boton, funcion, args, ctx, ok) {
    if (boton?.disabled) return null;
    if (boton) boton.disabled = true;
    try {
        exigirConexion();
        const r = await api(funcion, args);
        if (ok) ctx.notificar(ok);
        return r;
    } catch (e) {
        ctx.notificar(e.message, 'error');
        if (boton) boton.disabled = false;
        return null;
    }
}

export async function renderInventario(cont, ctx) {
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Inventario</h2>
            <p class="panel-sub">La existencia solo cambia con un movimiento y su motivo. Nunca queda en negativo.</p></div></div>
        <div class="panel-segmentos" role="tablist">${Object.entries(SUBSECCIONES).map(([k, v]) =>
            `<button type="button" role="tab" data-sub="${k}" aria-selected="${sub === k}">${esc(v)}</button>`).join('')}</div>
        <div data-cuerpo><p class="panel-cargando">Cargando…</p></div>`;
    cont.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { sub = b.dataset.sub; renderInventario(cont, ctx); }));
    const cuerpo = cont.querySelector('[data-cuerpo]');
    const recargar = () => renderInventario(cont, ctx);
    const vigente = turnoDe(cuerpo);
    try {
        await ({ articulos, movimientos, compras, proveedores, consumos })[sub](cuerpo, ctx, recargar);
    } catch (e) {
        if (vigente()) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`;
    }
}

// ---------- Artículos ----------
async function articulos(cuerpo, ctx, recargar) {
    const [productos, proveedoresLista] = await Promise.all([api('panel_inv_productos'), api('panel_inv_proveedores')]);
    const activos = productos.filter(p => p.activo);
    const agotados = activos.filter(p => p.alerta === 'agotado');
    const bajos = activos.filter(p => p.alerta === 'bajo');
    const valor = activos.reduce((s, p) => s + Number(p.valor), 0);
    const sinCosto = activos.filter(p => Number(p.existencia) > 0 && Number(p.costo_promedio) === 0).length;
    cuerpo.innerHTML = `
        <div class="resumen-tarjetas">
            <article class="resumen-tarjeta ${agotados.length ? 'resumen-alerta' : ''}"><i class="fas fa-box-open"></i><div><span>Agotados</span><strong>${agotados.length}</strong></div></article>
            <article class="resumen-tarjeta ${bajos.length ? 'resumen-alerta' : ''}"><i class="fas fa-triangle-exclamation"></i><div><span>Existencia baja</span><strong>${bajos.length}</strong></div></article>
            <article class="resumen-tarjeta resumen-dinero"><i class="fas fa-warehouse"></i><div><span>Valor al costo</span><strong>${dinero(valor)}</strong>
                <small>${sinCosto ? `${sinCosto} artículo(s) sin costo: valor incompleto` : 'Costo promedio ponderado'}</small></div></article>
        </div>
        ${agotados.length || bajos.length ? `<section class="panel-caja panel-aviso"><h3>Reponer</h3><ul class="panel-lista">${[...agotados, ...bajos].map(p =>
            `<li><strong>${esc(p.nombre)}</strong> · ${p.alerta === 'agotado' ? 'agotado' : `quedan ${esc(cantidad(p.existencia, p.unidad))} (mínimo ${esc(cantidad(p.existencia_minima, p.unidad))})`}</li>`).join('')}</ul></section>` : ''}
        <div class="agenda-filtros">
            <input type="search" data-texto placeholder="Buscar por nombre, código o categoría" value="${esc(filtro.texto)}" aria-label="Buscar artículo">
            <select data-tipo aria-label="Tipo"><option value="">Todos</option><option value="venta" ${filtro.tipo === 'venta' ? 'selected' : ''}>Para vender</option>
                <option value="insumo" ${filtro.tipo === 'insumo' ? 'selected' : ''}>Insumos</option><option value="inactivo" ${filtro.tipo === 'inactivo' ? 'selected' : ''}>Inactivos</option></select>
            <button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-plus"></i> Nuevo artículo</button>
            <button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> CSV</button></div>
        <div data-tabla></div>`;

    function pintar() {
        const t = filtro.texto.trim().toLowerCase();
        const lista = productos.filter(p => (filtro.tipo === 'inactivo' ? !p.activo : p.activo && (!filtro.tipo || p.tipo === filtro.tipo))
            && (!t || [p.nombre, p.codigo, p.categoria].some(x => String(x || '').toLowerCase().includes(t))));
        cuerpo.querySelector('[data-tabla]').innerHTML = lista.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas">
            <thead><tr><th>Artículo</th><th>Tipo</th><th>Existencia</th><th>Costo prom.</th><th>Precio</th><th>Valor</th><th></th></tr></thead><tbody>
            ${lista.map(p => `<tr>
                <td data-titulo="Artículo"><strong>${esc(p.nombre)}</strong><br><small>${esc(p.codigo)}${p.categoria ? ` · ${esc(p.categoria)}` : ''}${p.proveedor ? ` · ${esc(p.proveedor)}` : ''}</small></td>
                <td data-titulo="Tipo">${p.tipo === 'venta' ? 'Para vender' : 'Insumo'}</td>
                <td data-titulo="Existencia"><strong class="${p.alerta ? 'texto-negativo' : ''}">${esc(cantidad(p.existencia, p.unidad))}</strong>
                    ${p.alerta ? `<br><span class="estado-chip estado-cancelada">${p.alerta === 'agotado' ? 'Agotado' : 'Bajo'}</span>` : ''}
                    ${Number(p.reservado_web) > 0 ? `<br><small>${esc(cantidad(p.reservado_web))} reservado(s) en la web</small>` : ''}</td>
                <td data-titulo="Costo prom.">${Number(p.costo_promedio) > 0 ? dinero(p.costo_promedio) : '<small>Sin costo</small>'}</td>
                <td data-titulo="Precio">${p.precio !== null ? dinero(p.precio) : '—'}</td>
                <td data-titulo="Valor">${dinero(p.valor)}</td>
                <td><div class="panel-acciones panel-acciones-izq">
                    <button type="button" class="panel-btn panel-btn-mini" data-mov="${esc(p.id)}">Movimiento</button>
                    <button type="button" class="panel-btn panel-btn-mini" data-historial="${esc(p.id)}">Historial</button>
                    <button type="button" class="panel-btn panel-btn-mini" data-editar="${esc(p.id)}">Editar</button></div></td></tr>`).join('')}
            </tbody></table></div>` : vacio(productos.length ? 'Ningún artículo coincide con el filtro.' : 'Aún no hay artículos. Crea el primero con «Nuevo artículo».', 'boxes-stacked');
        cuerpo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => editarArticulo(productos.find(p => p.id === b.dataset.editar), proveedoresLista, ctx, recargar)));
        cuerpo.querySelectorAll('[data-mov]').forEach(b => b.addEventListener('click', () => registrarMovimiento(productos.find(p => p.id === b.dataset.mov), ctx, recargar)));
        cuerpo.querySelectorAll('[data-historial]').forEach(b => b.addEventListener('click', () => historial(productos.find(p => p.id === b.dataset.historial), ctx)));
    }
    cuerpo.querySelector('[data-texto]').addEventListener('input', e => { filtro.texto = e.target.value; pintar(); });
    cuerpo.querySelector('[data-tipo]').addEventListener('change', e => { filtro.tipo = e.target.value; pintar(); });
    cuerpo.querySelector('[data-nuevo]').addEventListener('click', () => editarArticulo(null, proveedoresLista, ctx, recargar));
    cuerpo.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`inventario-${hoyLocal()}.csv`, [
        ['Código', 'Nombre', 'Tipo', 'Categoría', 'Unidad', 'Existencia', 'Mínimo', 'Costo promedio (RD$)', 'Precio (RD$)', 'Valor al costo (RD$)', 'Proveedor', 'Activo'],
        ...productos.map(p => [p.codigo, p.nombre, p.tipo, p.categoria || '', p.unidad, p.existencia, p.existencia_minima, p.costo_promedio, p.precio ?? '', p.valor, p.proveedor || '', p.activo ? 'Sí' : 'No'])]));
    pintar();
}

function editarArticulo(p, proveedoresLista, ctx, recargar) {
    const nuevo = !p;
    const { cuerpo, cerrar } = dialogo({ titulo: nuevo ? 'Nuevo artículo' : `Editar ${p.nombre}`, ancho: 'md', html: `
        <form class="panel-form" novalidate><div class="panel-rejilla">
            <label>Nombre<input name="nombre" maxlength="120" required value="${esc(p?.nombre || '')}"></label>
            <label>Código<input name="codigo" maxlength="30" value="${esc(p?.codigo || '')}" placeholder="Automático si lo dejas vacío"></label>
            <label>Tipo<select name="tipo"><option value="venta" ${p?.tipo !== 'insumo' ? 'selected' : ''}>Para vender</option><option value="insumo" ${p?.tipo === 'insumo' ? 'selected' : ''}>Insumo (uso interno)</option></select></label>
            <label>Categoría<input name="categoria" maxlength="40" value="${esc(p?.categoria || '')}" placeholder="Ej.: cuidado de barba"></label>
            <label>Unidad de medida<select name="unidad" ${!nuevo && Number(p.existencia) > 0 ? 'title="Con movimientos no se puede cambiar"' : ''}>${Object.entries(UNIDADES).map(([k, v]) => `<option value="${k}" ${p?.unidad === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
            <label>Precio de venta RD$<input type="number" name="precio" min="0" step="0.01" value="${esc(p?.precio ?? '')}" inputmode="decimal"></label>
            <label>Costo unitario RD$<input type="number" name="costo" min="0" step="0.01" value="${esc(p?.costo ?? '')}" inputmode="decimal"></label>
            <label>Existencia mínima<input type="number" name="existencia_minima" min="0" step="0.001" value="${esc(p?.existencia_minima ?? 0)}"></label>
            <label>Proveedor<select name="proveedor_id"><option value="">Sin proveedor</option>${proveedoresLista.filter(x => x.activo || x.id === p?.proveedor_id).map(x =>
                `<option value="${esc(x.id)}" ${x.id === p?.proveedor_id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>
            ${nuevo ? '<label>Existencia inicial<input type="number" name="existencia_inicial" min="0" step="0.001" value="0"></label>' : ''}
        </div>
        <label>Descripción<input name="descripcion" maxlength="300" value="${esc(p?.descripcion || '')}"></label>
        <label>Imagen (opcional)<input type="file" name="imagen" accept="image/png,image/jpeg,image/webp"></label>
        ${!nuevo ? `<label class="panel-check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''}> Activo (los inactivos conservan su historial)</label>` : ''}
        <p class="panel-sub">${nuevo ? 'La existencia inicial se registra como movimiento con el costo indicado.' : 'La existencia no se edita aquí: usa «Movimiento» (compra, consumo, pérdida o ajuste por conteo).'}
            El costo es el de compra por unidad de medida; la valoración usa el costo promedio ponderado.</p>
        <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div></form>` });
    const form = cuerpo.querySelector('form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        const datos = { nombre: f.nombre.value.trim(), codigo: f.codigo.value.trim(), tipo: f.tipo.value, categoria: f.categoria.value.trim(), unidad: f.unidad.value,
            precio: numero(f.precio), costo: numero(f.costo), existencia_minima: numero(f.existencia_minima) ?? 0, proveedor_id: f.proveedor_id.value || null,
            descripcion: f.descripcion.value.trim(), imagen_url: p?.imagen_url || null };
        if (!datos.nombre) { ctx.notificar('Escribe el nombre del artículo.', 'error'); return; }
        if (datos.tipo === 'venta' && datos.precio === null) { ctx.notificar('Indica el precio de venta.', 'error'); return; }
        if (nuevo) datos.existencia_inicial = numero(f.existencia_inicial) ?? 0; else datos.activo = f.activo.checked;
        if (nuevo && datos.existencia_inicial > 0 && datos.costo === null
            && !await confirmar('Registrarás existencia sin costo: el valor del inventario y el margen quedarán incompletos. ¿Continuar?', { textoOk: 'Continuar' })) return;
        try { if (f.imagen.files[0]) datos.imagen_url = await imagenADataURL(f.imagen.files[0]); } catch (er) { ctx.notificar(er.message, 'error'); return; }
        if (await operar(e.submitter, 'panel_inv_guardar_producto', { p_id: p?.id || null, p_datos: datos }, ctx, nuevo ? 'Artículo creado' : 'Artículo actualizado')) { cerrar(); recargar(); }
    });
}

function registrarMovimiento(p, ctx, recargar) {
    const entero = ['unidad', 'par'].includes(p.unidad);
    const { cuerpo, cerrar } = dialogo({ titulo: `Movimiento · ${p.nombre}`, ancho: 'md', html: `
        <p class="panel-sub">Existencia actual: <strong>${esc(cantidad(p.existencia, p.unidad))}</strong>. Para compras usa la pestaña Compras; las ventas y devoluciones de clientes se registran al cobrar.</p>
        <form class="panel-form" novalidate data-clave="${nuevaClave()}">
            <label>Tipo<select name="tipo">
                <option value="consumo">Consumo interno (sale)</option><option value="perdida">Pérdida o daño (sale)</option>
                <option value="devolucion">Devolución al proveedor (sale)</option><option value="ajuste">Ajuste por conteo físico</option>
                ${Number(p.existencia) === 0 ? '<option value="inicial">Existencia inicial (entra)</option>' : ''}</select></label>
            <label data-campo-cantidad>Cantidad (${esc(UNIDADES[p.unidad])})<input type="number" name="cantidad" min="0" step="${entero ? 1 : 0.001}" inputmode="decimal"></label>
            <label data-campo-conteo hidden>Cantidad contada (${esc(UNIDADES[p.unidad])})<input type="number" name="conteo" min="0" step="${entero ? 1 : 0.001}" inputmode="decimal"></label>
            <label data-campo-costo hidden>Costo unitario RD$<input type="number" name="costo" min="0" step="0.01"></label>
            <label>Motivo<input name="motivo" maxlength="300" required placeholder="Ej.: uso en limpieza de estaciones"></label>
            <p class="panel-sub" data-vista></p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Registrar</button></div></form>` });
    const form = cuerpo.querySelector('form');
    const f = form.elements;
    const vista = () => {
        const tipo = f.tipo.value;
        form.querySelector('[data-campo-cantidad]').hidden = tipo === 'ajuste';
        form.querySelector('[data-campo-conteo]').hidden = tipo !== 'ajuste';
        form.querySelector('[data-campo-costo]').hidden = tipo !== 'inicial';
        const actual = Number(p.existencia);
        const nueva = tipo === 'ajuste' ? numero(f.conteo) : tipo === 'inicial' ? actual + (numero(f.cantidad) || 0) : actual - (numero(f.cantidad) || 0);
        form.querySelector('[data-vista]').innerHTML = nueva === null ? '' : `Existencia resultante: <strong class="${nueva < 0 ? 'texto-negativo' : ''}">${esc(cantidad(nueva, p.unidad))}</strong>${nueva < 0 ? ' (no permitido)' : ''}`;
    };
    form.addEventListener('input', vista);
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const datos = { clave: form.dataset.clave, producto_id: p.id, tipo: f.tipo.value, cantidad: numero(f.cantidad), conteo: numero(f.conteo),
            costo_unitario: numero(f.costo), motivo: f.motivo.value.trim() };
        if (datos.motivo.length < 3) { ctx.notificar('Escribe el motivo del movimiento.', 'error'); return; }
        if (await operar(e.submitter, 'panel_inv_movimiento', { p_datos: datos }, ctx, 'Movimiento registrado')) { cerrar(); recargar(); }
    });
    vista();
}

async function historial(p, ctx) {
    let movs;
    try { movs = await api('panel_inv_movimientos', { p_producto: p.id, p_desde: null, p_hasta: null }); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    dialogo({ titulo: `Historial · ${p.nombre}`, ancho: 'lg', html: tablaMovimientos(movs, false) });
}

function tablaMovimientos(movs, conProducto) {
    return movs.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Fecha</th>${conProducto ? '<th>Artículo</th>' : ''}<th>Tipo</th><th>Cantidad</th><th>Queda</th><th>Costo u.</th><th>Motivo / referencia</th><th>Usuario</th></tr></thead>
        <tbody>${movs.map(m => `<tr><td data-titulo="Fecha">${esc(fechaHora(m.fecha))}</td>${conProducto ? `<td data-titulo="Artículo">${esc(m.producto)}<br><small>${esc(m.codigo)}</small></td>` : ''}
            <td data-titulo="Tipo">${esc(TIPOS_MOVIMIENTO[m.tipo] || m.tipo)}</td>
            <td data-titulo="Cantidad" class="${Number(m.cantidad) < 0 ? 'texto-negativo' : 'texto-positivo'}">${Number(m.cantidad) > 0 ? '+' : ''}${esc(cantidad(m.cantidad, m.unidad))}</td>
            <td data-titulo="Queda">${esc(cantidad(m.existencia_resultante, m.unidad))}</td>
            <td data-titulo="Costo u.">${m.costo_unitario !== null ? dinero(m.costo_unitario) : '<small>Sin costo</small>'}</td>
            <td data-titulo="Motivo">${esc(m.motivo || '')}${m.referencia_numero ? `<br><small>${m.referencia_tipo === 'venta' ? 'Venta' : 'Compra'} #${esc(m.referencia_numero)}</small>` : ''}</td>
            <td data-titulo="Usuario">${esc(m.usuario || 'sistema')}</td></tr>`).join('')}</tbody></table></div>` : vacio('Sin movimientos.', 'clock-rotate-left');
}

// ---------- Movimientos ----------
async function movimientos(cuerpo) {
    const hasta = hoyLocal();
    const desde = sumarDias(hasta, -30);
    const movs = await api('panel_inv_movimientos', { p_producto: null, p_desde: desde, p_hasta: hasta });
    cuerpo.innerHTML = `<p class="panel-sub">Últimos 30 días (máximo 1000 movimientos).
        <button type="button" class="panel-btn panel-btn-mini" data-csv><i class="fas fa-file-csv"></i> CSV</button></p>${tablaMovimientos(movs, true)}`;
    cuerpo.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`movimientos-${desde}_${hasta}.csv`, [
        ['Fecha', 'Código', 'Artículo', 'Tipo', 'Cantidad', 'Unidad', 'Existencia resultante', 'Costo unitario (RD$)', 'Motivo', 'Referencia', 'Usuario'],
        ...movs.map(m => [fechaHora(m.fecha), m.codigo, m.producto, TIPOS_MOVIMIENTO[m.tipo] || m.tipo, m.cantidad, m.unidad, m.existencia_resultante, m.costo_unitario ?? '',
            m.motivo || '', m.referencia_numero ? `${m.referencia_tipo} #${m.referencia_numero}` : '', m.usuario || ''])]));
}

// ---------- Compras ----------
async function compras(cuerpo, ctx, recargar) {
    const [desde, hasta] = rangoPeriodo(periodoCompras);
    const [lista, productos, proveedoresLista] = await Promise.all([api('panel_inv_compras', { p_desde: desde, p_hasta: hasta }), api('panel_inv_productos'), api('panel_inv_proveedores')]);
    cuerpo.innerHTML = `
        <p class="panel-sub">Recibir mercancía no es pagarla: registra el pago aparte (queda como gasto enlazado a la compra, una sola vez).</p>
        <div class="agenda-filtros">${filtrosPeriodo(periodoCompras, [desde, hasta])}
            <button type="button" class="panel-btn panel-btn-principal" data-nueva><i class="fas fa-truck-ramp-box"></i> Registrar compra</button></div>
        ${lista.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Compra</th><th>Proveedor</th><th>Artículos</th><th>Total</th><th>Pagado</th><th>Pendiente</th><th></th></tr></thead>
            <tbody>${lista.map(c => `<tr class="${c.estado === 'anulada' ? 'fila-anulada' : ''}">
                <td data-titulo="Compra">#${esc(c.numero)} · ${esc(fechaCorta(c.fecha))}${c.factura ? `<br><small>Factura ${esc(c.factura)}</small>` : ''}${c.estado === 'anulada' ? `<br><small>Anulada: ${esc(c.motivo_anulacion)}</small>` : ''}</td>
                <td data-titulo="Proveedor">${esc(c.proveedor || '—')}</td>
                <td data-titulo="Artículos">${(c.lineas || []).map(l => `${esc(l.producto)}: ${esc(cantidad(l.cantidad, l.unidad))} × ${dinero(l.costo_unitario)}`).join('<br>')}</td>
                <td data-titulo="Total">${dinero(c.total)}</td><td data-titulo="Pagado">${dinero(c.pagado)}</td>
                <td data-titulo="Pendiente">${c.estado === 'anulada' ? '—' : dinero(Number(c.total) - Number(c.pagado))}</td>
                <td>${c.estado === 'recibida' ? `<div class="panel-acciones panel-acciones-izq">
                    ${Number(c.total) > Number(c.pagado) ? `<button type="button" class="panel-btn panel-btn-mini" data-pagar="${esc(c.id)}">Registrar pago</button>` : ''}
                    ${Number(c.pagado) === 0 ? `<button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-anular="${esc(c.id)}">Anular</button>` : ''}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
            : vacio('No hay compras en el periodo.', 'truck')}`;
    conectarPeriodo(cuerpo, periodoCompras, recargar);
    cuerpo.querySelector('[data-nueva]').addEventListener('click', () => nuevaCompra(productos.filter(p => p.activo), proveedoresLista.filter(p => p.activo), ctx, recargar));
    cuerpo.querySelectorAll('[data-pagar]').forEach(b => b.addEventListener('click', () => pagarCompra(lista.find(c => c.id === b.dataset.pagar), ctx, recargar)));
    cuerpo.querySelectorAll('[data-anular]').forEach(b => b.addEventListener('click', async () => {
        const motivo = window.prompt('Motivo de la anulación de la compra:', '');
        if (motivo === null) return;
        if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo.', 'error'); return; }
        if (!await confirmar('¿Anular la compra? Sus artículos saldrán del inventario.', { textoOk: 'Anular compra', peligro: true })) return;
        if (await operar(b, 'panel_inv_anular_compra', { p_datos: { clave: b.dataset.clave || (b.dataset.clave = nuevaClave()), compra_id: b.dataset.anular, motivo: motivo.trim() } }, ctx, 'Compra anulada')) recargar();
    }));
}

function nuevaCompra(productos, proveedoresLista, ctx, recargar) {
    const lineas = [{ producto_id: '', cantidad: null, costo_unitario: null }];
    const { cuerpo, cerrar } = dialogo({ titulo: 'Registrar compra (mercancía recibida)', ancho: 'lg', html: `
        <form class="panel-form" novalidate data-clave="${nuevaClave()}"><div class="panel-rejilla">
            <label>Proveedor<select name="proveedor_id"><option value="">Sin proveedor</option>${proveedoresLista.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></label>
            <label>Fecha de recepción<input type="date" name="fecha" value="${hoyLocal()}" max="${hoyLocal()}"></label>
            <label>N.º de factura<input name="factura" maxlength="60"></label></div>
            <div data-lineas></div>
            <button type="button" class="panel-btn panel-btn-mini" data-agregar><i class="fas fa-plus"></i> Otro artículo</button>
            <p class="cobro-total" data-total></p>
            <fieldset class="panel-fieldset"><legend>¿La pagaste ahora?</legend>
                <label class="panel-check"><input type="checkbox" name="pagar"> Registrar el pago ahora</label>
                <div class="panel-rejilla" data-pago hidden>
                    <label>Pagado con<select name="medio">${Object.entries(MEDIOS_GASTO).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
                    <label>Importe RD$<input type="number" name="monto" min="0.01" step="0.01"></label></div>
                <p class="panel-sub">Si no la pagas ahora, queda pendiente de pago.</p></fieldset>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Guardar compra</button></div></form>` });
    const form = cuerpo.querySelector('form');
    const total = () => lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0);
    const pintar = () => {
        form.querySelector('[data-lineas]').innerHTML = lineas.map((l, i) => `<div class="cobro-linea" data-i="${i}">
            <label>Artículo<select data-c="producto_id"><option value="">Elige…</option>${productos.map(p => `<option value="${esc(p.id)}" ${p.id === l.producto_id ? 'selected' : ''}>${esc(p.nombre)} (${esc(UNIDADES[p.unidad])})</option>`).join('')}</select></label>
            <label>Cantidad<input type="number" data-c="cantidad" min="0" step="0.001" value="${l.cantidad ?? ''}"></label>
            <label>Costo unitario RD$<input type="number" data-c="costo_unitario" min="0" step="0.01" value="${l.costo_unitario ?? ''}"></label>
            ${lineas.length > 1 ? '<button type="button" class="panel-icono" data-quitar aria-label="Quitar"><i class="fas fa-trash"></i></button>' : ''}</div>`).join('');
        form.querySelector('[data-total]').textContent = `Total de la compra: ${dinero(total())}`;
    };
    form.addEventListener('input', e => {
        const fila = e.target.closest('[data-i]');
        if (fila) {
            const l = lineas[Number(fila.dataset.i)];
            l[e.target.dataset.c] = e.target.dataset.c === 'producto_id' ? e.target.value : numero(e.target);
            form.querySelector('[data-total]').textContent = `Total de la compra: ${dinero(total())}`;
        }
        if (e.target.name === 'pagar') {
            form.querySelector('[data-pago]').hidden = !e.target.checked;
            if (e.target.checked && !form.elements.monto.value) form.elements.monto.value = total().toFixed(2);
        }
    });
    form.addEventListener('change', e => { if (e.target.matches('select[data-c]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    form.addEventListener('click', e => {
        if (e.target.closest('[data-agregar]')) { lineas.push({ producto_id: '', cantidad: null, costo_unitario: null }); pintar(); }
        if (e.target.closest('[data-quitar]')) { lineas.splice(Number(e.target.closest('[data-i]').dataset.i), 1); pintar(); }
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        const validas = lineas.filter(l => l.producto_id);
        if (!validas.length || validas.some(l => !(l.cantidad > 0) || l.costo_unitario === null || l.costo_unitario < 0)) {
            ctx.notificar('Indica artículo, cantidad y costo unitario en cada línea.', 'error'); return;
        }
        const pago = f.pagar.checked ? { medio: f.medio.value, monto: numero(f.monto) } : null;
        if (pago && !(pago.monto > 0)) { ctx.notificar('Indica el importe pagado.', 'error'); return; }
        if (await operar(e.submitter, 'panel_inv_compra', { p_datos: { clave: form.dataset.clave, proveedor_id: f.proveedor_id.value || null, fecha: f.fecha.value,
            factura: f.factura.value.trim(), lineas: validas, pago } }, ctx, 'Compra registrada: existencias actualizadas')) { cerrar(); recargar(); }
    });
    pintar();
}

function pagarCompra(c, ctx, recargar) {
    const pendiente = Number(c.total) - Number(c.pagado);
    const { cuerpo, cerrar } = dialogo({ titulo: `Pago de la compra #${c.numero}`, ancho: 'sm', html: `
        <form class="panel-form" novalidate data-clave="${nuevaClave()}">
            <p class="panel-sub">Pendiente: <strong>${dinero(pendiente)}</strong>. Queda como gasto de la categoría «compras de mercancía».</p>
            <label>Pagado con<select name="medio">${Object.entries(MEDIOS_GASTO).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
            <label>Importe RD$<input type="number" name="monto" min="0.01" max="${pendiente}" step="0.01" value="${pendiente.toFixed(2)}"></label>
            <label>N.º de comprobante (opcional)<input name="comprobante" maxlength="120"></label>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Registrar pago</button></div></form>` });
    const form = cuerpo.querySelector('form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const monto = numero(form.elements.monto);
        if (!(monto > 0)) { ctx.notificar('Indica el importe.', 'error'); return; }
        if (await operar(e.submitter, 'panel_gasto_registrar', { p_datos: { clave: form.dataset.clave, compra_id: c.id, monto, medio: form.elements.medio.value,
            comprobante: form.elements.comprobante.value.trim() } }, ctx, 'Pago registrado')) { cerrar(); recargar(); }
    });
}

// ---------- Proveedores ----------
async function proveedores(cuerpo, ctx, recargar) {
    const lista = await api('panel_inv_proveedores');
    cuerpo.innerHTML = `
        <form class="panel-form panel-caja" data-nuevo novalidate><h3>Nuevo proveedor</h3><div class="panel-rejilla">
            <label>Nombre<input name="nombre" maxlength="120" required></label><label>Teléfono<input name="telefono" maxlength="30" inputmode="tel"></label>
            <label>Notas<input name="notas" maxlength="300"></label></div><button type="submit" class="panel-btn panel-btn-principal">Agregar</button></form>
        ${lista.length ? `<ul class="panel-lista">${lista.map(p => `<li class="${p.activo ? '' : 'fila-anulada'}"><span><strong>${esc(p.nombre)}</strong>${p.telefono ? ` · ${esc(p.telefono)}` : ''}${p.notas ? `<br><small>${esc(p.notas)}</small>` : ''}</span>
            <button type="button" class="panel-btn panel-btn-mini" data-activo="${esc(p.id)}">${p.activo ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul>` : vacio('Aún no hay proveedores.', 'truck-field')}`;
    cuerpo.querySelector('[data-nuevo]').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        if (!f.nombre.value.trim()) { ctx.notificar('Escribe el nombre.', 'error'); return; }
        if (await operar(e.submitter, 'panel_inv_guardar_proveedor', { p_id: null, p_datos: { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), notas: f.notas.value.trim() } }, ctx, 'Proveedor agregado')) recargar();
    });
    cuerpo.querySelectorAll('[data-activo]').forEach(b => b.addEventListener('click', async () => {
        const p = lista.find(x => x.id === b.dataset.activo);
        if (await operar(b, 'panel_inv_guardar_proveedor', { p_id: p.id, p_datos: { nombre: p.nombre, telefono: p.telefono, notas: p.notas, activo: !p.activo } }, ctx, 'Proveedor actualizado')) recargar();
    }));
}

// ---------- Consumo por servicio ----------
async function consumos(cuerpo, ctx, recargar) {
    const [lista, productos, servicios] = await Promise.all([api('panel_inv_consumos'), api('panel_inv_productos'), api('panel_servicios')]);
    cuerpo.innerHTML = `
        <p class="panel-sub">Opcional: al completar una cita (o vender el servicio sin cita) se descuenta esta cantidad del insumo.
            Indica la cantidad real por servicio (p. ej. 20 ml de un frasco de 1 l), nunca el envase completo. Si no hay existencia suficiente,
            el servicio se completa igual y queda una alerta en el registro de cambios.</p>
        <form class="panel-form panel-caja" data-consumo novalidate><div class="panel-rejilla">
            <label>Servicio<select name="servicio_id">${servicios.filter(s => s.activo).map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('')}</select></label>
            <label>Insumo<select name="producto_id">${productos.filter(p => p.activo).map(p => `<option value="${esc(p.id)}" data-unidad="${esc(p.unidad)}">${esc(p.nombre)} (${esc(UNIDADES[p.unidad])})</option>`).join('')}</select></label>
            <label>Cantidad por servicio<input type="number" name="cantidad" min="0.001" step="0.001" required></label>
            <label>Unidad<select name="unidad">${Object.entries(UNIDADES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div>
            <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></form>
        ${lista.length ? `<ul class="panel-lista">${lista.map(c => `<li class="${c.activo ? '' : 'fila-anulada'}"><span><strong>${esc(c.servicio || 'Servicio')}</strong> → ${esc(cantidad(c.cantidad, c.unidad))} de ${esc(c.producto)}</span>
            <button type="button" class="panel-btn panel-btn-mini" data-alternar="${esc(c.servicio_id)}|${esc(c.producto_id)}">${c.activo ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul>` : vacio('Sin consumos configurados.', 'flask')}`;
    const form = cuerpo.querySelector('[data-consumo]');
    const sincronizarUnidad = () => { const op = form.elements.producto_id.selectedOptions[0]; if (op) form.elements.unidad.value = op.dataset.unidad; };
    form.elements.producto_id.addEventListener('change', sincronizarUnidad);
    sincronizarUnidad();
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        if (!(numero(f.cantidad) > 0)) { ctx.notificar('Indica la cantidad por servicio.', 'error'); return; }
        if (await operar(e.submitter, 'panel_inv_guardar_consumo', { p_datos: { servicio_id: f.servicio_id.value, producto_id: f.producto_id.value, cantidad: numero(f.cantidad), unidad: f.unidad.value } }, ctx, 'Consumo guardado')) recargar();
    });
    cuerpo.querySelectorAll('[data-alternar]').forEach(b => b.addEventListener('click', async () => {
        const [servicio, producto] = b.dataset.alternar.split('|');
        const c = lista.find(x => x.servicio_id === servicio && x.producto_id === producto);
        if (await operar(b, 'panel_inv_guardar_consumo', { p_datos: { servicio_id: servicio, producto_id: producto, cantidad: c.cantidad, unidad: c.unidad, activo: !c.activo } }, ctx, 'Consumo actualizado')) recargar();
    }));
}
