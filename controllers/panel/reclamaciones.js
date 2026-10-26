// ==========================================
// PANEL: RECLAMACIONES
// Conversación con el cliente separada de las notas internas (que nunca ve). No se borra nada:
// cada cambio queda en el historial. Registrar una reclamación no cancela citas, no reembolsa
// ni toca la caja: un reembolso se registra en Ventas y cobros y aquí solo se vincula.
// ==========================================

import { api, esc, dialogo, confirmar, vacio, fechaHora, fechaCorta, hoyLocal, sumarDias, imagenADataURL, descargarCSV } from './comun.js';
import { nuevaClave, turnoDe } from './finanzas-comun.js';

export const ESTADOS = { recibida: 'Recibida', en_revision: 'En revisión', esperando_cliente: 'Esperando respuesta del cliente', resuelta: 'Resuelta', cerrada: 'Cerrada' };
const CHIP = { recibida: 'estado-pendiente', en_revision: 'estado-pendiente', esperando_cliente: '', resuelta: 'estado-confirmada', cerrada: 'estado-cancelada' };
const PRIORIDADES = { baja: 'Baja', media: 'Media', alta: 'Alta' };
const EVENTOS = { creada: 'Caso creado', estado: 'Cambio de estado', asignacion: 'Responsable', prioridad: 'Prioridad', mensaje: 'Mensaje al cliente',
    nota: 'Nota interna', solucion: 'Solución registrada', reapertura: 'Reabierto', reembolso: 'Reembolso vinculado', fecha_objetivo: 'Fecha objetivo',
    respuesta_cliente: 'Respuesta del cliente' };
const POR_PAGINA = 25;
const filtros = { estado: 'abiertas', categoria_id: '', responsable: '', busqueda: '', desde: 0 };

const chip = e => `<span class="estado-chip ${CHIP[e] || ''}">${esc(ESTADOS[e] || e)}</span>`;
const enlaceCliente = token => `${location.origin}${location.pathname}?reclamacion=${encodeURIComponent(token)}`;

async function imagenes(input) {
    const archivos = [...(input?.files || [])];
    if (archivos.length > 3) throw new Error('Máximo 3 imágenes por mensaje.');
    if (archivos.some(a => a.size > 10 * 1024 * 1024)) throw new Error('Cada imagen debe pesar menos de 10 MB.');
    return Promise.all(archivos.map(a => imagenADataURL(a, 1400)));
}

export async function renderReclamaciones(cont, ctx, opciones = {}) {
    const vigente = turnoDe(cont);
    const esAdmin = ctx.rol === 'admin';
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Reclamaciones</h2>
            <p class="panel-sub">${esAdmin ? 'Casos enviados por los clientes desde su cita o registrados por el equipo.' : 'Casos que el administrador te asignó.'}
                Las notas internas nunca se muestran al cliente.</p></div>
            ${esAdmin ? `<div class="panel-acciones"><button type="button" class="panel-btn" data-config><i class="fas fa-gear"></i> Configuración</button>
                <button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-plus"></i> Registrar caso</button></div>` : ''}</div>
        <div data-indicadores><p class="panel-cargando">Cargando indicadores…</p></div>
        <div class="agenda-filtros" data-filtros></div>
        <div data-lista><p class="panel-cargando">Cargando casos…</p></div>`;
    const recargar = () => renderReclamaciones(cont, ctx);
    const hasta = hoyLocal(), desde = sumarDias(hasta, -29);
    let datos, ind;
    try {
        [datos, ind] = await Promise.all([api('panel_reclamaciones', { p_filtros: { ...filtros, limite: POR_PAGINA } }),
            api('panel_reclamaciones_indicadores', { p_desde: desde, p_hasta: hasta })]);
    } catch (e) { if (vigente()) cont.querySelector('[data-lista]').innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    ctx.actualizarAvisos?.();
    cont.querySelector('[data-indicadores]').innerHTML = `<div class="resumen-tarjetas">
        ${indicador('Abiertas', ind.abiertas, 'folder-open', `${ind.esperando_cliente} esperando al cliente`)}
        ${indicador('Sin primera respuesta', ind.sin_primera_respuesta, 'envelope', 'Una nota interna no cuenta como respuesta')}
        ${indicador('Fuera de plazo', ind.fuera_de_plazo, 'triangle-exclamation', `Plazo de primera respuesta: ${ind.horas_objetivo} h`)}
        ${indicador('Primera respuesta (prom.)', ind.horas_primera_respuesta === null ? '—' : `${ind.horas_primera_respuesta} h`, 'reply', `Casos creados en los últimos 30 días (${ind.creadas_periodo})`)}
        ${indicador('Resolución (prom.)', ind.horas_resolucion === null ? '—' : `${ind.horas_resolucion} h`, 'circle-check', `${ind.respondidas_tarde_periodo} respondida(s) fuera de plazo`)}
        </div>
        ${ind.motivos.length ? `<p class="panel-sub">Motivos (últimos 30 días): ${ind.motivos.map(m => `${esc(m.categoria)} <strong>${m.casos}</strong>`).join(' · ')}</p>` : ''}`;

    const caja = cont.querySelector('[data-filtros]');
    caja.innerHTML = `
        <select data-f="estado" aria-label="Estado"><option value="abiertas">Abiertas</option><option value="">Todas</option>
            ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        <select data-f="categoria_id" aria-label="Categoría"><option value="">Todas las categorías</option>
            ${datos.categorias.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select>
        ${esAdmin ? `<select data-f="responsable" aria-label="Responsable"><option value="">Cualquier responsable</option><option value="sin_asignar">Sin asignar</option>
            ${datos.responsables.map(r => `<option value="${esc(r.user_id)}">${esc(r.nombre)}</option>`).join('')}</select>` : ''}
        <input type="search" data-f="busqueda" placeholder="N.º de caso o cliente" aria-label="Buscar">
        <button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> CSV</button>`;
    caja.querySelectorAll('[data-f]').forEach(el => {
        el.value = filtros[el.dataset.f];
        el.addEventListener(el.type === 'search' ? 'change' : 'input', () => { filtros[el.dataset.f] = el.value; filtros.desde = 0; recargar(); });
    });
    caja.querySelector('[data-csv]').addEventListener('click', () => descargarCSV(`reclamaciones-${hoyLocal()}.csv`, [
        ['Caso', 'Estado', 'Prioridad', 'Categoría', 'Cliente', 'Responsable', 'Creada', 'Primera respuesta', 'Fecha objetivo', 'Fuera de plazo'],
        ...datos.casos.map(c => [c.codigo, ESTADOS[c.estado], PRIORIDADES[c.prioridad], c.categoria, c.cliente, c.responsable || '', c.creado_en,
            c.primera_respuesta_en || '', c.fecha_objetivo, c.vencida ? 'Sí' : 'No'])]));

    const lista = cont.querySelector('[data-lista]');
    lista.innerHTML = datos.casos.length ? `
        <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Caso</th><th>Cliente</th><th>Categoría</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Última actividad</th></tr></thead>
        <tbody>${datos.casos.map(c => `<tr class="fila-clic" data-caso="${esc(c.id)}" tabindex="0">
            <td data-titulo="Caso"><strong>${esc(c.codigo)}</strong>${c.vencida ? '<br><small class="texto-negativo">Fuera de plazo</small>' : ''}</td>
            <td data-titulo="Cliente">${esc(c.cliente)}</td><td data-titulo="Categoría">${esc(c.categoria)}</td>
            <td data-titulo="Estado">${chip(c.estado)}</td><td data-titulo="Prioridad">${esc(PRIORIDADES[c.prioridad])}</td>
            <td data-titulo="Responsable">${esc(c.responsable || 'Sin asignar')}</td><td data-titulo="Última actividad">${esc(fechaHora(c.ultima_actividad_en))}</td></tr>`).join('')}</tbody></table></div>
        <div class="panel-acciones">
            ${filtros.desde > 0 ? '<button type="button" class="panel-btn" data-pagina="-1">Anteriores</button>' : ''}
            <span class="panel-sub">${filtros.desde + 1}–${filtros.desde + datos.casos.length} de ${datos.total}</span>
            ${filtros.desde + datos.casos.length < datos.total ? '<button type="button" class="panel-btn" data-pagina="1">Siguientes</button>' : ''}</div>`
        : vacio(filtros.estado === 'abiertas' ? 'No hay reclamaciones abiertas.' : 'No hay reclamaciones con estos filtros.', 'face-smile');
    const abrir = id => abrirCaso(ctx, id, recargar);
    lista.querySelectorAll('[data-caso]').forEach(f => {
        f.addEventListener('click', () => abrir(f.dataset.caso));
        f.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(f.dataset.caso); });
    });
    lista.querySelectorAll('[data-pagina]').forEach(b => b.addEventListener('click', () => { filtros.desde = Math.max(0, filtros.desde + Number(b.dataset.pagina) * POR_PAGINA); recargar(); }));
    cont.querySelector('[data-nuevo]')?.addEventListener('click', () => abrirNuevo(ctx, datos.categorias, recargar));
    cont.querySelector('[data-config]')?.addEventListener('click', () => abrirConfig(ctx, datos.categorias, ind.horas_objetivo, recargar));
    if (opciones.caso) abrir(opciones.caso);
}

function indicador(titulo, valor, icono, nota) {
    return `<article class="resumen-tarjeta"><i class="fas fa-${icono}"></i><div><span>${esc(titulo)}</span><strong>${esc(valor)}</strong><small>${esc(nota)}</small></div></article>`;
}

// ---------- Detalle del caso ----------
async function abrirCaso(ctx, id, alCambiar) {
    const { cuerpo, cerrar } = dialogo({ titulo: 'Reclamación', ancho: 'lg', html: '<p class="panel-cargando">Cargando caso…</p>' });
    let r;
    try { r = await api('panel_reclamacion', { p_id: id }); }
    catch (e) { cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    pintarCaso(cuerpo, ctx, r, { alCambiar, cerrar });
}

function pintarCaso(cuerpo, ctx, r, { alCambiar, cerrar }) {
    if (!cuerpo.isConnected) return;
    const esAdmin = r.es_admin;
    const abierta = !['resuelta', 'cerrada'].includes(r.estado);
    const vencida = abierta && !r.primera_respuesta_en && new Date(r.fecha_objetivo) < new Date();
    const adjuntos = ids => ids.length ? `<div class="reclamacion-adjuntos">${ids.map(a => `<button type="button" class="panel-btn panel-btn-mini" data-adjunto="${esc(a)}"><i class="fas fa-image"></i> Ver imagen</button>`).join('')}</div>` : '';
    const reembolsables = (r.ventas_cita || []).filter(v => Number(v.reembolsado) > 0 || Number(v.devuelto) > 0);
    cuerpo.closest('.panel-dialogo')?.querySelector('h3')?.replaceChildren(`Reclamación ${r.codigo}`);
    cuerpo.innerHTML = `
        <div class="reclamacion-cabecera">${chip(r.estado)} <span class="estado-chip">${esc(PRIORIDADES[r.prioridad])}</span>
            ${vencida ? '<span class="estado-chip estado-cancelada">Fuera de plazo</span>' : ''}</div>
        <dl class="reclamacion-datos">
            <div><dt>Cliente</dt><dd>${esc(r.cliente_nombre)}${r.cliente_telefono ? ` · ${esc(r.cliente_telefono)}` : ''}</dd></div>
            <div><dt>Categoría</dt><dd>${esc(r.categoria)}</dd></div>
            <div><dt>Cita</dt><dd>${r.cita ? `${esc(r.cita.servicio || '')} · ${esc(fechaCorta(r.cita.fecha))} ${esc(r.cita.hora)} · ${esc(r.cita.barbero || '')}` : 'Sin cita'}</dd></div>
            <div><dt>Venta</dt><dd>${r.venta_numero ? `#${esc(r.venta_numero)}` : 'Sin venta'}${r.reembolso_venta_numero ? ` · Reembolso vinculado: venta #${esc(r.reembolso_venta_numero)}` : ''}</dd></div>
            <div><dt>Responsable</dt><dd>${esc(r.responsable || 'Sin asignar')}</dd></div>
            <div><dt>Recibida</dt><dd>${esc(fechaHora(r.creado_en))} · ${r.origen === 'equipo' ? 'registrada por el equipo' : 'enviada por el cliente'}</dd></div>
            <div><dt>Respuesta objetivo</dt><dd>${esc(fechaHora(r.fecha_objetivo))}${r.primera_respuesta_en ? ` · respondida ${esc(fechaHora(r.primera_respuesta_en))}` : ''}</dd></div>
        </dl>
        <p class="reclamacion-texto">${esc(r.descripcion)}</p>${adjuntos(r.adjuntos_iniciales)}
        ${r.solucion ? `<div class="panel-aviso"><strong>Solución:</strong> ${esc(r.solucion)}</div>` : ''}

        <h4>Conversación y notas</h4>
        ${r.mensajes.length ? `<ol class="reclamacion-mensajes">${r.mensajes.map(m => `<li class="${m.interno ? 'nota-interna' : m.autor === 'cliente' ? 'del-cliente' : 'del-equipo'}">
            <strong>${m.interno ? '<i class="fas fa-lock"></i> Nota interna' : m.autor === 'cliente' ? 'Cliente' : 'Barbería'}</strong>
            <small>${esc(m.usuario || '')} · ${esc(fechaHora(m.creado_en))}</small><p>${esc(m.cuerpo)}</p>${adjuntos(m.adjuntos)}</li>`).join('')}</ol>`
            : '<p class="panel-sub">Aún no hay mensajes.</p>'}
        ${r.estado !== 'cerrada' ? `<form class="panel-form reclamacion-responder" novalidate>
            <div class="panel-segmentos" role="group" aria-label="Tipo de mensaje">
                <button type="button" data-tipo="mensaje" aria-pressed="true">Mensaje al cliente</button>
                <button type="button" data-tipo="nota" aria-pressed="false"><i class="fas fa-lock"></i> Nota interna</button></div>
            <label><span data-ayuda>El cliente lo verá con su enlace privado.</span><textarea name="cuerpo" rows="3" maxlength="2000" required></textarea></label>
            <label class="panel-check" data-solicitar><input type="checkbox" name="solicitar_info"> Pedir información al cliente (el caso queda «Esperando respuesta del cliente»)</label>
            <label>Imágenes (opcional, hasta 3)<input type="file" name="imagenes" accept="image/png,image/jpeg,image/webp" multiple></label>
            <button type="submit" class="panel-btn panel-btn-principal">Enviar</button></form>` : ''}

        <h4>Gestión</h4>
        <div class="reclamacion-gestion">
            ${abierta ? `<label>Estado<select data-estado><option value="">Cambiar estado…</option>
                ${['en_revision', 'esperando_cliente', 'resuelta'].filter(e => e !== r.estado).map(e => `<option value="${e}">${esc(ESTADOS[e])}</option>`).join('')}
                ${esAdmin ? '<option value="cerrada">Cerrada</option>' : ''}</select></label>` : ''}
            ${esAdmin && r.estado === 'resuelta' ? '<button type="button" class="panel-btn" data-cerrar-caso>Cerrar caso</button>' : ''}
            ${!abierta && esAdmin ? '<button type="button" class="panel-btn" data-reabrir><i class="fas fa-rotate-left"></i> Reabrir</button>' : ''}
            ${abierta ? '<button type="button" class="panel-btn" data-solucion>Registrar solución</button>' : ''}
            ${esAdmin ? `<label>Responsable<select data-asignar><option value="">Sin asignar</option>
                ${r.responsables.map(x => `<option value="${esc(x.user_id)}" ${x.user_id === r.responsable_user_id ? 'selected' : ''}>${esc(x.nombre)} · ${esc(x.rol)}</option>`).join('')}</select></label>
                <label>Prioridad<select data-prioridad>${Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}" ${k === r.prioridad ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label>Fecha objetivo<input type="datetime-local" data-objetivo value="${esc(localInput(r.fecha_objetivo))}"></label>
                ${reembolsables.length ? `<label>Vincular reembolso<select data-reembolso><option value="">Elegir venta…</option>
                    ${reembolsables.map(v => `<option value="${esc(v.id)}">Venta #${esc(v.numero)} · reembolsado RD$ ${esc(v.reembolsado)}</option>`).join('')}</select></label>`
                    : '<p class="panel-sub">Para devolver dinero usa Ventas y cobros › Devolución; después podrás vincularla aquí.</p>'}
                <button type="button" class="panel-btn" data-copiar><i class="fas fa-link"></i> Copiar enlace del cliente</button>` : ''}
        </div>

        <details class="reclamacion-historial"><summary>Historial (${r.eventos.length})</summary><ol>${r.eventos.map(e => `<li><small>${esc(fechaHora(e.creado_en))}</small>
            <strong>${esc(EVENTOS[e.tipo] || e.tipo)}</strong>${e.de || e.a ? `: ${esc(ESTADOS[e.de] || e.de || '—')} → ${esc(ESTADOS[e.a] || e.a || '—')}` : ''}
            ${e.motivo ? `<em>«${esc(e.motivo)}»</em>` : ''} <small>${esc(e.usuario || (e.actor === 'cliente' ? 'Cliente' : ''))}</small></li>`).join('')}</ol></details>`;

    const repintar = nuevo => { pintarCaso(cuerpo, ctx, nuevo, { alCambiar, cerrar }); alCambiar(); };
    const actualizar = async (datos, boton, ok) => {
        if (boton) boton.disabled = true;
        try { const nuevo = await api('panel_reclamacion_actualizar', { p_datos: { reclamacion_id: r.id, ...datos } }); ctx.notificar(ok); repintar(nuevo); }
        catch (e) { ctx.notificar(e.message, 'error'); if (boton) boton.disabled = false; }
    };

    cuerpo.querySelectorAll('[data-adjunto]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { b.outerHTML = `<img class="reclamacion-imagen" src="${esc(await api('panel_reclamacion_adjunto', { p_adjunto: Number(b.dataset.adjunto) }))}" alt="Imagen adjunta">`; }
        catch (e) { ctx.notificar(e.message, 'error'); b.disabled = false; }
    }));

    const form = cuerpo.querySelector('.reclamacion-responder');
    if (form) {
        let tipo = 'mensaje';
        let clave = nuevaClave();
        form.addEventListener('input', () => { clave = nuevaClave(); }); // otro texto = otra operación
        form.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
            tipo = b.dataset.tipo;
            form.querySelectorAll('[data-tipo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            form.querySelector('[data-ayuda]').textContent = tipo === 'nota' ? 'Solo la ve el equipo. No cuenta como respuesta al cliente.' : 'El cliente lo verá con su enlace privado.';
            form.querySelector('[data-solicitar]').hidden = tipo === 'nota';
            form.classList.toggle('es-nota', tipo === 'nota');
        }));
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const boton = e.submitter;
            const texto = form.elements.cuerpo.value.trim();
            if (!texto) { ctx.notificar('Escribe el mensaje.', 'error'); return; }
            boton.disabled = true;
            try {
                const adjuntos = await imagenes(form.elements.imagenes);
                const nuevo = await api('panel_reclamacion_mensaje', { p_datos: { clave, reclamacion_id: r.id, cuerpo: texto, interno: tipo === 'nota',
                    solicitar_info: tipo === 'mensaje' && form.elements.solicitar_info.checked, adjuntos } });
                ctx.notificar(tipo === 'nota' ? 'Nota interna guardada' : 'Mensaje enviado al cliente');
                repintar(nuevo);
            } catch (fallo) { ctx.notificar(fallo.message, 'error'); boton.disabled = false; }
        });
    }

    cuerpo.querySelector('[data-estado]')?.addEventListener('change', async e => {
        const valor = e.target.value;
        if (!valor) return;
        let motivo = null;
        if (valor === 'resuelta' && !r.solucion) {
            motivo = window.prompt('Describe la solución aplicada (el cliente la verá):', '');
            if (motivo === null || motivo.trim().length < 3) { e.target.value = ''; if (motivo !== null) ctx.notificar('Escribe la solución.', 'error'); return; }
        }
        if (valor === 'cerrada' && !await confirmar('¿Cerrar el caso? Solo podrá reabrirse con un motivo.', { textoOk: 'Cerrar caso' })) { e.target.value = ''; return; }
        actualizar({ accion: 'estado', valor, motivo: motivo?.trim() }, e.target, `Estado: ${ESTADOS[valor]}`);
    });
    cuerpo.querySelector('[data-cerrar-caso]')?.addEventListener('click', async e => {
        if (await confirmar('¿Cerrar el caso? Solo podrá reabrirse con un motivo.', { textoOk: 'Cerrar caso' })) actualizar({ accion: 'estado', valor: 'cerrada' }, e.currentTarget, 'Caso cerrado');
    });
    cuerpo.querySelector('[data-reabrir]')?.addEventListener('click', e => {
        const motivo = window.prompt('Motivo para reabrir el caso:', '');
        if (motivo === null) return;
        if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo (mínimo 3 caracteres).', 'error'); return; }
        actualizar({ accion: 'reabrir', motivo: motivo.trim() }, e.currentTarget, 'Caso reabierto');
    });
    cuerpo.querySelector('[data-solucion]')?.addEventListener('click', e => {
        const valor = window.prompt('Solución aplicada (el cliente la verá en su enlace):', r.solucion || '');
        if (valor === null) return;
        if (valor.trim().length < 3) { ctx.notificar('Escribe la solución.', 'error'); return; }
        actualizar({ accion: 'solucion', valor: valor.trim() }, e.currentTarget, 'Solución registrada');
    });
    cuerpo.querySelector('[data-asignar]')?.addEventListener('change', e => actualizar({ accion: 'asignar', valor: e.target.value }, e.target, 'Responsable actualizado'));
    cuerpo.querySelector('[data-prioridad]')?.addEventListener('change', e => actualizar({ accion: 'prioridad', valor: e.target.value }, e.target, 'Prioridad actualizada'));
    cuerpo.querySelector('[data-objetivo]')?.addEventListener('change', e => {
        if (e.target.value) actualizar({ accion: 'fecha_objetivo', valor: new Date(e.target.value).toISOString() }, e.target, 'Fecha objetivo actualizada');
    });
    cuerpo.querySelector('[data-reembolso]')?.addEventListener('change', async e => {
        if (e.target.value && await confirmar('¿Vincular este reembolso al caso? Solo se registra la relación; no mueve dinero.', { textoOk: 'Vincular' }))
            actualizar({ accion: 'reembolso', valor: e.target.value }, e.target, 'Reembolso vinculado');
        else e.target.value = '';
    });
    cuerpo.querySelector('[data-copiar]')?.addEventListener('click', async e => {
        const enlace = enlaceCliente(r.enlace_token);
        try { await navigator.clipboard.writeText(enlace); e.currentTarget.textContent = 'Enlace copiado'; }
        catch { window.prompt('Enlace privado del cliente (compártelo solo con él):', enlace); }
    });
}

// datetime-local en la hora del navegador
function localInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Caso registrado por el equipo (p. ej. una compra en mostrador) ----------
async function abrirNuevo(ctx, categorias, recargar) {
    let ventas = [];
    try { ventas = await api('panel_ventas', { p_desde: sumarDias(hoyLocal(), -90), p_hasta: hoyLocal() }); } catch { /* se puede registrar sin venta */ }
    const lista = ventas.filter(v => v.estado !== 'anulada').slice(0, 200);
    const { cuerpo, cerrar } = dialogo({ titulo: 'Registrar reclamación', ancho: 'md', html: `
        <form class="panel-form" novalidate>
            <p class="panel-sub">Para reclamaciones recibidas en persona o por teléfono. Al guardar obtendrás un enlace privado para que el cliente siga el caso.</p>
            <label>Venta relacionada (opcional)<select name="venta_id"><option value="">Sin venta</option>
                ${lista.map(v => `<option value="${esc(v.id)}">#${esc(v.numero)} · ${esc(fechaHora(v.creado_en))} · ${esc(v.cliente)}</option>`).join('')}</select></label>
            <div class="panel-rejilla">
                <label>Nombre del cliente<input name="cliente_nombre" maxlength="120"></label>
                <label>Teléfono (opcional)<input name="cliente_telefono" inputmode="tel" maxlength="20"></label>
            </div>
            <label>Categoría<select name="categoria_id" required><option value="">Elige una categoría</option>
                ${categorias.filter(c => c.activa).map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select></label>
            <label>Descripción<textarea name="descripcion" rows="4" maxlength="2000" required></textarea></label>
            <label>Imágenes (opcional, hasta 3)<input type="file" name="imagenes" accept="image/png,image/jpeg,image/webp" multiple></label>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Registrar</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    let clave = nuevaClave();
    form.addEventListener('input', () => { clave = nuevaClave(); });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        if (!f.categoria_id.value || f.descripcion.value.trim().length < 10) { ctx.notificar('Elige la categoría y describe el caso (mínimo 10 caracteres).', 'error'); return; }
        if (!f.venta_id.value && !f.cliente_nombre.value.trim()) { ctx.notificar('Indica el nombre del cliente.', 'error'); return; }
        const boton = e.submitter;
        boton.disabled = true;
        try {
            const adjuntos = await imagenes(f.imagenes);
            const r = await api('panel_reclamacion_crear', { p_datos: { clave, venta_id: f.venta_id.value || null, cliente_nombre: f.cliente_nombre.value.trim(),
                cliente_telefono: f.cliente_telefono.value.trim(), categoria_id: Number(f.categoria_id.value), descripcion: f.descripcion.value.trim(), adjuntos } });
            cerrar();
            recargar();
            const enlace = enlaceCliente(r.enlace_token);
            dialogo({ titulo: `Caso ${r.codigo} registrado`, ancho: 'sm', html: `<p class="panel-texto">Comparte este enlace privado solo con el cliente para que siga su caso:</p>
                <input class="reclamacion-enlace" readonly value="${esc(enlace)}" aria-label="Enlace privado del cliente">` })
                .cuerpo.querySelector('input').select();
        } catch (fallo) { ctx.notificar(fallo.message, 'error'); boton.disabled = false; }
    });
}

// ---------- Configuración: plazo objetivo y categorías ----------
function abrirConfig(ctx, categorias, horas, recargar) {
    const { cuerpo, cerrar } = dialogo({ titulo: 'Configuración de reclamaciones', ancho: 'md', html: `
        <form class="panel-form" novalidate>
            <label>Plazo para la primera respuesta (horas)<input type="number" name="horas" min="1" max="720" step="1" value="${esc(horas)}" required></label>
            <p class="panel-sub">Se aplica a los casos nuevos. Las categorías no se borran: desactívalas para que no se ofrezcan.</p>
            <div class="reclamacion-categorias">${categorias.map(c => `<div class="panel-rejilla" data-cat="${esc(c.id)}">
                <label>Categoría<input name="nombre" maxlength="60" value="${esc(c.nombre)}"></label>
                <label class="panel-check"><input type="checkbox" name="activa" ${c.activa ? 'checked' : ''}> Activa</label></div>`).join('')}</div>
            <label>Nueva categoría (opcional)<input name="nueva" maxlength="60"></label>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div>
        </form>` });
    cuerpo.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        const cats = [...f.querySelectorAll('[data-cat]')].map(d => ({ id: d.dataset.cat, nombre: d.querySelector('[name=nombre]').value.trim(), activa: d.querySelector('[name=activa]').checked }));
        if (f.elements.nueva.value.trim()) cats.push({ nombre: f.elements.nueva.value.trim(), activa: true });
        if (cats.some(c => !c.nombre)) { ctx.notificar('Las categorías necesitan un nombre.', 'error'); return; }
        e.submitter.disabled = true;
        try {
            await api('panel_reclamaciones_config', { p_datos: { horas_objetivo: Number(f.elements.horas.value), categorias: cats } });
            ctx.notificar('Configuración guardada');
            cerrar();
            recargar();
        } catch (fallo) { ctx.notificar(fallo.message, 'error'); e.submitter.disabled = false; }
    });
}
