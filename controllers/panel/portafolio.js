// ==========================================
// PANEL: PORTAFOLIO DE LOS BARBEROS
// Trabajos (borrador → pendiente de revisión → publicado → archivado), perfil público
// y autorizaciones de imagen. Solo el administrador publica. Un trabajo en el que se
// reconoce a una persona solo se publica con una autorización vigente (el servidor lo exige).
// ==========================================

import { api, esc, dialogo, confirmar, ejecutar, imagenADataURL, vacio, hoyLocal, fechaCorta, fechaHora } from './comun.js';
import { obtenerServicios } from '../../models/serviceModel.js';
import { turnoDe } from './finanzas-comun.js';

const ESTADOS = { borrador: 'Borrador', pendiente: 'Pendiente de revisión', publicado: 'Publicado', archivado: 'Archivado' };
const CHIP = { borrador: '', pendiente: 'estado-pendiente', publicado: 'estado-confirmada', archivado: 'estado-cancelada' };
const ALCANCES = { portafolio_web: 'Portafolio en la web', portafolio_y_redes: 'Portafolio en la web y redes sociales' };
const avisar = (ctx, e) => ctx.notificar(e.message, 'error');

const estado = { sub: 'trabajos', barbero: '', filtro: '' };

export async function renderPortafolio(cont, ctx, opciones = {}) {
    const esAdmin = ctx.rol === 'admin';
    if (opciones.barbero !== undefined) estado.barbero = String(opciones.barbero);
    if (!esAdmin) estado.barbero = String(ctx.barbero_id || '');
    if (!esAdmin && estado.sub === 'autorizaciones') estado.sub = 'trabajos';
    const subs = { trabajos: 'Trabajos', perfil: 'Perfil público', ...(esAdmin ? { autorizaciones: 'Autorizaciones de imagen' } : {}) };
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Portafolio</h2>
            <p class="panel-sub">${esAdmin ? 'Los trabajos se muestran en el perfil público del barbero solo cuando los publicas.'
                : 'Sube tus trabajos y envíalos a revisión: el administrador los publica.'}</p></div></div>
        <div class="panel-segmentos" role="tablist">${Object.entries(subs).map(([k, v]) =>
            `<button type="button" role="tab" data-sub="${k}" aria-selected="${estado.sub === k}">${esc(v)}</button>`).join('')}</div>
        <div data-cuerpo><p class="panel-cargando">Cargando…</p></div>`;
    cont.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { estado.sub = b.dataset.sub; renderPortafolio(cont, ctx); }));
    const cuerpo = cont.querySelector('[data-cuerpo]');
    const vigente = turnoDe(cont);
    const recargar = () => renderPortafolio(cont, ctx);
    try {
        const barberos = esAdmin ? (await api('panel_barberos')).filter(b => b.activo || b.id === estado.barbero)
            : [{ id: String(ctx.barbero_id), nombre: ctx.barbero_nombre }];
        if (!vigente()) return;
        if (estado.sub === 'perfil') await renderPerfil(cuerpo, ctx, barberos, vigente, recargar);
        else if (estado.sub === 'autorizaciones') await renderAutorizaciones(cuerpo, ctx, vigente, recargar);
        else await renderTrabajos(cuerpo, ctx, barberos, vigente, recargar);
    } catch (e) {
        if (vigente()) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`;
    }
}

function selectorBarbero(barberos, valor, { todos = true } = {}) {
    return `<select data-barbero aria-label="Barbero">${todos ? '<option value="">Todos los barberos</option>' : ''}
        ${barberos.map(b => `<option value="${esc(b.id)}" ${String(b.id) === valor ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select>`;
}

// ---------- Trabajos ----------
async function renderTrabajos(cuerpo, ctx, barberos, vigente, recargar) {
    const esAdmin = ctx.rol === 'admin';
    const datos = await api('panel_portafolio', { p_barbero: estado.barbero || null, p_estado: estado.filtro || null });
    const autorizaciones = esAdmin ? await api('panel_autorizaciones') : [];
    if (!vigente()) return;
    const trabajos = datos.trabajos;
    const pendientes = trabajos.filter(t => t.estado === 'pendiente').length;
    // Ordenar solo tiene sentido dentro de un barbero y entre lo publicado
    const ordenables = estado.barbero && datos.puede_gestionar ? trabajos.filter(t => t.estado === 'publicado') : [];
    cuerpo.innerHTML = `
        ${!datos.puede_gestionar ? '<div class="panel-aviso">El administrador gestiona tu portafolio. Pídele que active «El barbero gestiona su portafolio» si quieres subir tus trabajos.</div>' : ''}
        <div class="agenda-filtros">
            ${esAdmin ? selectorBarbero(barberos, estado.barbero) : ''}
            <select data-estado aria-label="Estado"><option value="">Todos los estados</option>
                ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${estado.filtro === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            ${datos.puede_gestionar ? '<button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-plus"></i> Nuevo trabajo</button>' : ''}
        </div>
        ${esAdmin && pendientes ? `<p class="panel-aviso">${pendientes} trabajo(s) esperan tu revisión.</p>` : ''}
        <p class="panel-sub">Las imágenes se reducen en el navegador y se guardan sin metadatos (ubicación, cámara). Nada es visible en la web hasta que se publica.</p>
        <div class="portafolio-rejilla">${trabajos.length ? trabajos.map(t => tarjetaTrabajo(t, esAdmin, ordenables)).join('')
            : vacio(estado.filtro ? 'No hay trabajos con este estado.' : 'Aún no hay trabajos. Sube el primero con «Nuevo trabajo».', 'images')}</div>`;
    cuerpo.querySelector('[data-barbero]')?.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });
    cuerpo.querySelector('[data-estado]').addEventListener('change', e => { estado.filtro = e.target.value; recargar(); });
    cuerpo.querySelector('[data-nuevo]')?.addEventListener('click', () => abrirEditor(ctx, null, barberos, autorizaciones, recargar));
    const buscar = id => trabajos.find(t => t.id === id);
    cuerpo.addEventListener('click', async e => {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const t = buscar(b.dataset.id);
        const accion = b.dataset.accion;
        if (accion === 'editar') return abrirEditor(ctx, t, barberos, autorizaciones, recargar);
        if (accion === 'ver') return verImagen(ctx, t);
        if (accion === 'subir' || accion === 'bajar') {
            const ids = ordenables.map(x => x.id);
            const i = ids.indexOf(t.id), j = accion === 'subir' ? i - 1 : i + 1;
            if (j < 0 || j >= ids.length) return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            if (await ejecutar(b, () => api('panel_portafolio_ordenar', { p_barbero: estado.barbero, p_ids: ids }), ctx.notificar)) recargar();
            return;
        }
        let motivo = null;
        if (accion === 'devolver') {
            motivo = window.prompt('¿Qué debe corregir el barbero? (se le mostrará este motivo)', '');
            if (motivo === null) return;
            if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo (mínimo 3 caracteres).', 'error'); return; }
        }
        if (accion === 'archivar' && !await confirmar(`¿Archivar «${t.titulo}»? ${t.estado === 'publicado' ? 'Dejará de verse en la web inmediatamente. ' : ''}Se conserva en el historial y podrá publicarse de nuevo.`, { textoOk: 'Archivar', peligro: true })) return;
        if (accion === 'publicar' && !await confirmar(`¿Publicar «${t.titulo}» en el perfil de ${t.barbero}? Será visible para todos los visitantes.`, { textoOk: 'Publicar' })) return;
        b.disabled = true;
        try {
            await api('panel_portafolio_estado', { p_id: t.id, p_accion: accion, p_motivo: motivo });
            ctx.notificar({ enviar_revision: 'Enviado a revisión', publicar: 'Trabajo publicado', devolver: 'Devuelto al barbero', archivar: 'Trabajo archivado', destacar: 'Listo' }[accion]);
            recargar();
        } catch (fallo) { avisar(ctx, fallo); b.disabled = false; }
    });
}

function tarjetaTrabajo(t, esAdmin, ordenables) {
    const posicion = ordenables.findIndex(x => x.id === t.id);
    const btn = (accion, texto, extra = '') => `<button type="button" class="panel-btn panel-btn-mini ${extra}" data-accion="${accion}" data-id="${esc(t.id)}">${texto}</button>`;
    const acciones = [];
    acciones.push(btn('ver', '<i class="fas fa-magnifying-glass-plus"></i> Ver'));
    if (esAdmin || ['borrador', 'pendiente'].includes(t.estado)) acciones.push(btn('editar', 'Editar'));
    if (t.estado === 'borrador') acciones.push(btn('enviar_revision', 'Enviar a revisión', 'panel-btn-principal'));
    if (esAdmin && t.estado === 'pendiente') acciones.push(btn('publicar', 'Publicar', 'panel-btn-principal'), btn('devolver', 'Devolver'));
    if (esAdmin && t.estado === 'archivado') acciones.push(btn('publicar', 'Volver a publicar'));
    if (esAdmin && t.estado === 'publicado') acciones.push(btn('destacar', t.destacado ? 'Quitar destacado' : '<i class="fas fa-star"></i> Destacar'));
    if (posicion > 0) acciones.push(btn('subir', '<i class="fas fa-arrow-up"></i><span class="sr-only">Subir</span>'));
    if (posicion > -1 && posicion < ordenables.length - 1) acciones.push(btn('bajar', '<i class="fas fa-arrow-down"></i><span class="sr-only">Bajar</span>'));
    if (t.estado !== 'archivado') acciones.push(btn('archivar', t.estado === 'publicado' ? 'Retirar' : 'Archivar', 'panel-btn-peligro'));
    const persona = !t.muestra_persona ? '<small>Sin personas identificables</small>'
        : t.autorizacion_numero ? `<small>Autorización #${esc(t.autorizacion_numero)} ${t.autorizacion_vigente ? '(vigente)' : '<strong class="texto-negativo">(retirada)</strong>'}</small>`
            : '<small class="texto-negativo">Muestra a una persona: falta su autorización</small>';
    return `<article class="portafolio-tarjeta">
        <div class="portafolio-mini"><img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}" loading="lazy">${t.destacado ? '<span class="portafolio-destacado" title="Destacado"><i class="fas fa-star"></i></span>' : ''}</div>
        <div class="portafolio-info">
            <strong>${esc(t.titulo)}</strong>
            <span class="estado-chip ${CHIP[t.estado]}">${ESTADOS[t.estado]}</span>
            <small>${esc(t.barbero || '')}${t.servicio ? ` · ${esc(t.servicio)}` : ''}${t.especialidad ? ` · ${esc(t.especialidad)}` : ''}</small>
            ${persona}
            ${t.motivo_estado ? `<small>Motivo: ${esc(t.motivo_estado)}</small>` : ''}
            <small>${t.publicado_en && t.estado === 'publicado' ? `Publicado ${esc(fechaHora(t.publicado_en))}` : `Creado ${esc(fechaHora(t.creado_en))}`}</small>
        </div>
        <div class="portafolio-acciones">${acciones.join('')}</div>
    </article>`;
}

async function verImagen(ctx, t) {
    const { cuerpo } = dialogo({ titulo: t.titulo, ancho: 'lg', html: `<figure class="portafolio-vista"><img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}">
        <figcaption>${esc(t.descripcion || '')}</figcaption></figure>` });
    try { cuerpo.querySelector('img').src = await api('panel_portafolio_imagen', { p_id: t.id }); }
    catch (e) { avisar(ctx, e); }
}

async function prepararImagen(archivo) {
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
    if (archivo.size > 10 * 1024 * 1024) throw new Error('La imagen pesa más de 10 MB.');
    // Imagen ampliada y miniatura; al volver a codificarlas se eliminan los metadatos
    const [imagen, miniatura] = await Promise.all([imagenADataURL(archivo, 1400), imagenADataURL(archivo, 480)]);
    if (miniatura.length > 200000) throw new Error('No se pudo reducir la miniatura. Usa otra imagen.');
    return { imagen, miniatura };
}

function abrirEditor(ctx, t, barberos, autorizaciones, recargar) {
    const esAdmin = ctx.rol === 'admin';
    const servicios = obtenerServicios().filter(s => s.servicio_id);
    const vigentes = autorizaciones.filter(a => a.estado === 'vigente' || a.id === t?.autorizacion_id);
    const { cuerpo, cerrar } = dialogo({ titulo: t ? 'Editar trabajo' : 'Nuevo trabajo', ancho: 'md', html: `
        <form class="panel-form" novalidate>
            ${esAdmin && !t ? `<label>Barbero${selectorBarbero(barberos, estado.barbero, { todos: false }).replace('data-barbero', 'name="barbero_id" required')}</label>` : ''}
            <label>Imagen ${t ? '(deja vacío para conservar la actual)' : ''}<input type="file" name="imagen" accept="image/png,image/jpeg,image/webp" ${t ? '' : 'required'}></label>
            <div class="portafolio-previa" data-previa>${t ? `<img src="${esc(t.miniatura)}" alt="">` : ''}</div>
            <label>Título<input name="titulo" maxlength="80" required value="${esc(t?.titulo || '')}" placeholder="Ej.: Skin fade con diseño"></label>
            <label>Descripción (opcional)<textarea name="descripcion" maxlength="300" rows="2">${esc(t?.descripcion || '')}</textarea></label>
            <label>Texto alternativo (describe la imagen para lectores de pantalla)<input name="texto_alternativo" maxlength="200" required value="${esc(t?.texto_alternativo || '')}" placeholder="Ej.: Corte degradado bajo visto de perfil"></label>
            <div class="panel-rejilla">
                <label>Servicio (opcional)<select name="servicio_id"><option value="">Sin servicio</option>
                    ${servicios.map(s => `<option value="${esc(s.servicio_id)}" ${s.servicio_id === t?.servicio_id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>
                <label>Especialidad (opcional, para filtrar)<input name="especialidad" maxlength="40" value="${esc(t?.especialidad || '')}" placeholder="Ej.: Degradados"></label>
            </div>
            <label class="panel-check"><input type="checkbox" name="muestra_persona" ${t?.muestra_persona === false ? '' : 'checked'}>
                Se reconoce a una persona (rostro, tatuaje u otro rasgo identificable)</label>
            ${esAdmin ? `<label data-autorizacion>Autorización de imagen<select name="autorizacion_id"><option value="">Sin autorización</option>
                ${vigentes.map(a => `<option value="${esc(a.id)}" ${a.id === t?.autorizacion_id ? 'selected' : ''}>#${esc(a.numero)} · ${esc(a.cliente_nombre)} · ${esc(fechaCorta(a.fecha))}${a.estado !== 'vigente' ? ' (retirada)' : ''}</option>`).join('')}</select></label>
                <p class="panel-sub">Aceptar una cita no es autorización. Regístrala en «Autorizaciones de imagen» con la fecha y la evidencia.</p>`
                : '<p class="panel-sub">Si se reconoce a una persona, el administrador vinculará su autorización antes de publicar.</p>'}
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar como ${t && t.estado !== 'borrador' ? 'está' : 'borrador'}</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    let preparada = null;
    form.elements.imagen.addEventListener('change', async () => {
        preparada = null;
        const archivo = form.elements.imagen.files[0];
        const previa = form.querySelector('[data-previa]');
        if (!archivo) return;
        previa.innerHTML = '<p class="panel-cargando">Preparando imagen…</p>';
        try {
            preparada = await prepararImagen(archivo);
            previa.innerHTML = `<img src="${esc(preparada.miniatura)}" alt="">`;
        } catch (e) { previa.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; form.elements.imagen.value = ''; }
    });
    const persona = form.elements.muestra_persona;
    const caja = form.querySelector('[data-autorizacion]');
    const alternar = () => { if (caja) caja.hidden = !persona.checked; };
    persona.addEventListener('change', alternar);
    alternar();
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        const boton = e.submitter;
        if (!t && !preparada) { ctx.notificar(f.imagen.files[0] ? 'Espera a que termine de prepararse la imagen.' : 'Elige una imagen.', 'error'); return; }
        if (!f.titulo.value.trim() || f.texto_alternativo.value.trim().length < 3) { ctx.notificar('Escribe el título y el texto alternativo.', 'error'); return; }
        const datos = {
            barbero_id: f.barbero_id?.value || estado.barbero || String(ctx.barbero_id || ''),
            servicio_id: f.servicio_id.value, titulo: f.titulo.value.trim(), descripcion: f.descripcion.value.trim(),
            texto_alternativo: f.texto_alternativo.value.trim(), especialidad: f.especialidad.value.trim(),
            muestra_persona: persona.checked, autorizacion_id: persona.checked ? (f.autorizacion_id?.value || t?.autorizacion_id || null) : null,
            ...(preparada || {})
        };
        if (!esAdmin) datos.autorizacion_id = t?.autorizacion_id || null; // el barbero no vincula autorizaciones
        boton.disabled = true;
        try {
            await api('panel_portafolio_guardar', { p_id: t?.id || null, p_datos: datos });
            ctx.notificar(t ? 'Trabajo actualizado' : 'Trabajo guardado como borrador');
            cerrar();
            recargar();
        } catch (fallo) { avisar(ctx, fallo); boton.disabled = false; }
    });
}

// ---------- Perfil público ----------
async function renderPerfil(cuerpo, ctx, barberos, vigente, recargar) {
    const esAdmin = ctx.rol === 'admin';
    if (!estado.barbero) estado.barbero = String(barberos[0]?.id || '');
    if (!estado.barbero) { cuerpo.innerHTML = vacio('Aún no hay barberos.', 'users'); return; }
    const p = await api('panel_barbero_perfil', { p_barbero: estado.barbero });
    if (!vigente()) return;
    const puede = esAdmin || p?.portafolio_propio;
    cuerpo.innerHTML = `
        ${esAdmin ? `<div class="agenda-filtros">${selectorBarbero(barberos, estado.barbero, { todos: false })}</div>` : ''}
        <div class="panel-caja"><h3>Perfil de ${esc(p.nombre)}</h3>
            <p class="panel-sub">Se muestra en «Ver perfil y trabajos» de la web. La foto y la especialidad principal se editan en Barberos; los servicios salen del catálogo.</p>
            <form class="panel-form" novalidate>
                <label>Presentación<textarea name="presentacion" rows="4" maxlength="500" ${puede ? '' : 'disabled'} placeholder="Cuéntale al cliente tu estilo y experiencia">${esc(p.presentacion || '')}</textarea></label>
                <label>Especialidades (separadas por comas, máx. 8)<input name="especialidades" maxlength="400" ${puede ? '' : 'disabled'} value="${esc((p.especialidades || []).join(', '))}" placeholder="Degradados, Barba, Diseños"></label>
                ${esAdmin ? `<label class="panel-check"><input type="checkbox" name="portafolio_propio" ${p.portafolio_propio ? 'checked' : ''}> El barbero gestiona su portafolio (sube trabajos y edita su perfil; publicar sigue siendo del administrador)</label>` : ''}
                ${puede ? '<button type="submit" class="panel-btn panel-btn-principal">Guardar perfil</button>' : '<p class="panel-aviso">El administrador gestiona tu perfil público.</p>'}
            </form></div>`;
    cuerpo.querySelector('[data-barbero]')?.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });
    cuerpo.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        const especialidades = f.especialidades.value.split(',').map(x => x.trim()).filter(Boolean);
        if (especialidades.length > 8 || especialidades.some(x => x.length > 40)) { ctx.notificar('Máximo 8 especialidades de 40 caracteres.', 'error'); return; }
        const datos = { presentacion: f.presentacion.value.trim(), especialidades, ...(esAdmin ? { portafolio_propio: f.portafolio_propio.checked } : {}) };
        if (await ejecutar(e.submitter, () => api('panel_barbero_perfil_guardar', { p_barbero: estado.barbero, p_datos: datos }), ctx.notificar, 'Perfil guardado')) recargar();
    });
}

// ---------- Autorizaciones de imagen (solo administrador) ----------
async function renderAutorizaciones(cuerpo, ctx, vigente, recargar) {
    const lista = await api('panel_autorizaciones');
    if (!vigente()) return;
    cuerpo.innerHTML = `
        <div class="agenda-filtros"><button type="button" class="panel-btn panel-btn-principal" data-nueva><i class="fas fa-file-signature"></i> Registrar autorización</button></div>
        <p class="panel-sub">Registra aquí el consentimiento expreso del cliente para publicar imágenes en las que se le reconoce. Es privado: solo lo ve el administrador.
            Si el cliente la retira, sus trabajos se despublican en el acto.</p>
        ${lista.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>N.º</th><th>Cliente</th><th>Alcance</th><th>Fecha</th><th>Trabajos</th><th>Estado</th><th></th></tr></thead>
            <tbody>${lista.map(a => `<tr>
                <td data-titulo="N.º">#${esc(a.numero)}</td>
                <td data-titulo="Cliente">${esc(a.cliente_nombre)}${a.cliente_telefono ? `<br><small>${esc(a.cliente_telefono)}</small>` : ''}
                    ${a.es_menor ? `<br><small>Menor · ${esc(a.representante_relacion)}: ${esc(a.representante_nombre)}</small>` : ''}${a.referencia ? `<br><small>Ref.: ${esc(a.referencia)}</small>` : ''}</td>
                <td data-titulo="Alcance">${esc(ALCANCES[a.alcance])}</td>
                <td data-titulo="Fecha">${esc(fechaCorta(a.fecha))}</td>
                <td data-titulo="Trabajos">${a.trabajos} (${a.publicados} publicados)</td>
                <td data-titulo="Estado">${a.estado === 'vigente' ? '<span class="estado-chip estado-confirmada">Vigente</span>'
                    : `<span class="estado-chip estado-cancelada">Retirada</span><br><small>${esc(fechaHora(a.retirada_en))} · ${esc(a.motivo_retiro || '')}</small>`}</td>
                <td>${a.tiene_evidencia ? `<button type="button" class="panel-btn panel-btn-mini" data-evidencia="${esc(a.id)}">Evidencia</button>` : ''}
                    ${a.estado === 'vigente' ? `<button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-retirar="${esc(a.id)}">Registrar retirada</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
            : vacio('No hay autorizaciones registradas.', 'file-signature')}`;
    cuerpo.querySelector('[data-nueva]').addEventListener('click', () => abrirAutorizacion(ctx, recargar));
    cuerpo.querySelectorAll('[data-evidencia]').forEach(b => b.addEventListener('click', async () => {
        try {
            const url = await api('panel_autorizacion_evidencia', { p_id: b.dataset.evidencia });
            dialogo({ titulo: 'Evidencia de la autorización', ancho: 'lg', html: `<figure class="portafolio-vista"><img src="${esc(url)}" alt="Evidencia de la autorización"></figure>` });
        } catch (e) { avisar(ctx, e); }
    }));
    cuerpo.querySelectorAll('[data-retirar]').forEach(b => b.addEventListener('click', async () => {
        const a = lista.find(x => x.id === b.dataset.retirar);
        const motivo = window.prompt('Motivo de la retirada (p. ej., «El cliente lo pidió por WhatsApp el 26/10»):', '');
        if (motivo === null) return;
        if (motivo.trim().length < 3) { ctx.notificar('Escribe el motivo (mínimo 3 caracteres).', 'error'); return; }
        if (!await confirmar(`¿Registrar la retirada de la autorización #${a.numero}? ${a.trabajos ? `Sus ${a.trabajos} trabajo(s) con la persona visible se archivarán y dejarán de verse en la web.` : ''}`, { textoOk: 'Retirar y despublicar', peligro: true })) return;
        b.disabled = true;
        try {
            const r = await api('panel_autorizacion_retirar', { p_id: a.id, p_motivo: motivo.trim() });
            ctx.notificar(`Autorización retirada. Trabajos despublicados: ${r.trabajos_archivados}`);
            recargar();
        } catch (e) { avisar(ctx, e); b.disabled = false; }
    }));
}

function abrirAutorizacion(ctx, recargar) {
    const { cuerpo, cerrar } = dialogo({ titulo: 'Registrar autorización de imagen', ancho: 'md', html: `
        <form class="panel-form" novalidate>
            <div class="panel-rejilla">
                <label>Nombre del cliente<input name="cliente_nombre" maxlength="120" required></label>
                <label>Teléfono (opcional)<input name="cliente_telefono" inputmode="tel" maxlength="20"></label>
                <label>Alcance<select name="alcance">${Object.entries(ALCANCES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
                <label>Fecha en que autorizó<input type="date" name="fecha" value="${hoyLocal()}" max="${hoyLocal()}" required></label>
            </div>
            <label>Referencia (dónde consta: formulario firmado, mensaje, etc.)<input name="referencia" maxlength="200"></label>
            <label class="panel-check"><input type="checkbox" name="es_menor"> Es menor de edad</label>
            <div class="panel-rejilla" data-menor hidden>
                <label>Nombre de la madre, padre o tutor<input name="representante_nombre" maxlength="120"></label>
                <label>Relación<input name="representante_relacion" maxlength="60" placeholder="Madre, padre, tutor legal"></label>
            </div>
            <label>Evidencia (foto del documento firmado o captura; privada)<input type="file" name="evidencia" accept="image/png,image/jpeg,image/webp"></label>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Registrar</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    form.elements.es_menor.addEventListener('change', () => { form.querySelector('[data-menor]').hidden = !form.elements.es_menor.checked; });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        if (!f.cliente_nombre.value.trim() || !f.fecha.value) { ctx.notificar('Indica el nombre del cliente y la fecha.', 'error'); return; }
        if (f.es_menor.checked && (!f.representante_nombre.value.trim() || !f.representante_relacion.value.trim())) { ctx.notificar('Para un menor indica el nombre y la relación de su madre, padre o tutor.', 'error'); return; }
        const boton = e.submitter;
        boton.disabled = true;
        try {
            const archivo = f.evidencia.files[0];
            if (archivo && archivo.size > 10 * 1024 * 1024) throw new Error('La evidencia pesa más de 10 MB.');
            const evidencia = archivo ? await imagenADataURL(archivo, 1600) : null;
            const r = await api('panel_autorizacion_registrar', { p_datos: { cliente_nombre: f.cliente_nombre.value.trim(), cliente_telefono: f.cliente_telefono.value.trim(),
                alcance: f.alcance.value, fecha: f.fecha.value, referencia: f.referencia.value.trim(), es_menor: f.es_menor.checked,
                representante_nombre: f.representante_nombre.value.trim(), representante_relacion: f.representante_relacion.value.trim(), evidencia } });
            ctx.notificar(`Autorización #${r.numero} registrada`);
            cerrar();
            recargar();
        } catch (fallo) { avisar(ctx, fallo); boton.disabled = false; }
    });
}
