// ==========================================
// PANEL: PORTAFOLIO DE LOS BARBEROS
// Trabajos (borrador → pendiente de revisión → publicado → archivado), perfil público
// y autorizaciones de imagen. Solo el administrador publica. Un trabajo en el que se
// reconoce a una persona solo se publica con una autorización vigente (el servidor lo exige).
// ==========================================

import { api, esc, dialogo, confirmar, pedirMotivo, ejecutar, imagenADataURL, vacio, hoyLocal, fechaCorta, fechaHora } from './comun.js';
import { leerArchivo, bitmapDesdeDataURL, exportar, abrirEditorFoto, AJUSTES_INICIALES } from './editorFotos.js';
import { abrirDetalleEstilo } from '../estilosController.js';
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
    const pendientes = trabajos.filter(t => t.estado === 'pendiente' || t.revision?.estado === 'pendiente').length;
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
        <p class="panel-sub">Cada publicación puede tener varias fotos y aparece en «Estilos de la casa» (inicio y galería) y en el perfil del barbero. Los originales son privados; en la web solo se publican versiones optimizadas sin metadatos (ubicación, cámara). Nada es visible hasta que se publica.</p>
        <div class="portafolio-rejilla">${trabajos.length ? trabajos.map(t => tarjetaTrabajo(t, esAdmin, ordenables)).join('')
            : vacio(estado.filtro ? 'No hay trabajos con este estado.' : 'Aún no hay trabajos. Sube el primero con «Nuevo trabajo».', 'images')}</div>`;
    cuerpo.querySelector('[data-barbero]')?.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });
    cuerpo.querySelector('[data-estado]').addEventListener('change', e => { estado.filtro = e.target.value; recargar(); });
    cuerpo.querySelector('[data-nuevo]')?.addEventListener('click', () => abrirPublicacion(ctx, null, barberos, autorizaciones, recargar, datos.publicacion_directa));
    // Una versión pendiente se gestiona desde la tarjeta de su trabajo publicado
    const buscar = id => trabajos.find(t => t.id === id)
        || (p => p && { ...p, id, estado: p.revision.estado, titulo: `${p.titulo} (nueva versión)` })(trabajos.find(t => t.revision?.id === id));
    cuerpo.addEventListener('click', async e => {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const t = buscar(b.dataset.id);
        const accion = b.dataset.accion;
        if (accion === 'editar') return abrirPublicacion(ctx, t, barberos, autorizaciones, recargar, datos.publicacion_directa);
        if (accion === 'ver') return previsualizar(ctx, t);
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
            motivo = await pedirMotivo({ titulo: `Devolver «${t.titulo}»`, etiqueta: '¿Qué debe corregir el barbero? Verá este motivo.', textoOk: 'Devolver' });
            if (motivo === null) return;
        }
        if (accion === 'archivar' && !await confirmar(`¿Archivar «${t.titulo}»? ${t.estado === 'publicado' ? 'Dejará de verse en la web inmediatamente. ' : ''}Se conserva en el historial y podrá publicarse de nuevo.`, { textoOk: 'Archivar', peligro: true })) return;
        if (accion === 'publicar' && !await confirmar(`¿Publicar «${t.titulo}» en el perfil de ${t.barbero}? Será visible para todos los visitantes.`, { textoOk: 'Publicar' })) return;
        b.disabled = true;
        try {
            const r = await api('panel_portafolio_estado', { p_id: t.id, p_accion: accion, p_motivo: motivo });
            ctx.notificar(accion === 'enviar_revision' && r.estado === 'publicado' ? 'Publicado' : { enviar_revision: 'Enviado a revisión', publicar: 'Trabajo publicado', devolver: 'Devuelto al barbero', archivar: 'Trabajo archivado', destacar: 'Listo' }[accion]);
            recargar();
        } catch (fallo) { avisar(ctx, fallo); b.disabled = false; }
    });
}

function tarjetaTrabajo(t, esAdmin, ordenables) {
    const posicion = ordenables.findIndex(x => x.id === t.id);
    const btn = (accion, texto, extra = '', id = t.id) => `<button type="button" class="panel-btn panel-btn-mini ${extra}" data-accion="${accion}" data-id="${esc(id)}">${texto}</button>`;
    const acciones = [];
    const v = t.revision;
    acciones.push(btn('ver', '<i class="fas fa-eye" aria-hidden="true"></i> Vista previa'));
    acciones.push(btn('editar', t.estado === 'publicado' && !esAdmin ? (v ? 'Seguir editando la versión' : 'Editar (nueva versión)') : 'Editar'));
    if (t.estado === 'borrador') acciones.push(btn('enviar_revision', 'Enviar a revisión', 'panel-btn-principal'));
    if (esAdmin && t.estado === 'pendiente') acciones.push(btn('publicar', 'Publicar', 'panel-btn-principal'), btn('devolver', 'Devolver'));
    if (esAdmin && t.estado === 'archivado') acciones.push(btn('publicar', 'Volver a publicar'));
    if (esAdmin && t.estado === 'publicado') acciones.push(btn('destacar', t.destacado ? 'Quitar destacado' : '<i class="fas fa-star"></i> Destacar'));
    // Versión de un trabajo publicado: la publicada sigue visible hasta aprobarla
    if (v && esAdmin && v.estado === 'pendiente') acciones.push(btn('publicar', 'Aprobar nueva versión', 'panel-btn-principal', v.id), btn('devolver', 'Devolver versión', '', v.id));
    if (v && v.estado === 'borrador' && !esAdmin) acciones.push(btn('enviar_revision', 'Enviar versión a revisión', 'panel-btn-principal', v.id));
    if (v) acciones.push(btn('archivar', 'Descartar versión', '', v.id));
    if (posicion > 0) acciones.push(btn('subir', '<i class="fas fa-arrow-up"></i><span class="sr-only">Subir</span>'));
    if (posicion > -1 && posicion < ordenables.length - 1) acciones.push(btn('bajar', '<i class="fas fa-arrow-down"></i><span class="sr-only">Bajar</span>'));
    if (t.estado !== 'archivado') acciones.push(btn('archivar', t.estado === 'publicado' ? 'Retirar' : 'Archivar', 'panel-btn-peligro'));
    const persona = !t.muestra_persona ? '<small>Sin personas identificables</small>'
        : t.autorizacion_numero ? `<small>Autorización #${esc(t.autorizacion_numero)} ${t.autorizacion_vigente ? '(vigente)' : '<strong class="texto-negativo">(retirada)</strong>'}</small>`
            : t.autorizacion_confirmada_en ? `<small>Autorización confirmada por ${esc(t.autorizacion_confirmada_por || 'el equipo')} · falta vincular la registrada</small>`
                : '<small class="texto-negativo">Muestra a una persona: falta su autorización</small>';
    const nFotos = t.fotos?.length || (t.legado ? 1 : 0);
    return `<article class="portafolio-tarjeta">
        <div class="portafolio-mini">${t.miniatura ? `<img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}" loading="lazy">` : '<span class="panel-sub">Sin fotos</span>'}${t.destacado ? '<span class="portafolio-destacado" title="Destacado"><i class="fas fa-star"></i><span class="sr-only">Destacado</span></span>' : ''}</div>
        <div class="portafolio-info">
            <strong>${esc(t.titulo)}</strong>
            <span class="estado-chip ${CHIP[t.estado]}">${ESTADOS[t.estado]}</span>
            ${v ? `<span class="estado-chip ${CHIP[v.estado]}">Nueva versión: ${ESTADOS[v.estado]}</span>` : ''}
            <small>${esc(t.barbero || '')}${t.servicio ? ` · ${esc(t.servicio)}` : ''}${t.especialidad ? ` · ${esc(t.especialidad)}` : ''} · ${nFotos} foto${nFotos === 1 ? '' : 's'}</small>
            ${persona}
            ${t.motivo_estado ? `<small>Motivo: ${esc(t.motivo_estado)}</small>` : ''}
            ${v?.motivo_estado ? `<small>Motivo (versión): ${esc(v.motivo_estado)}</small>` : ''}
            <small>${t.publicado_en && t.estado === 'publicado' ? `Publicado ${esc(fechaHora(t.publicado_en))}` : `Creado ${esc(fechaHora(t.creado_en))}`}</small>
        </div>
        <div class="portafolio-acciones">${acciones.join('')}</div>
    </article>`;
}

// Vista previa: el mismo detalle que verá el público (versiones de tarjeta; nada se publica)
async function previsualizar(ctx, t) {
    try {
        const e = await api('panel_estilo', { p_id: t.revision?.id || t.id });
        const fuentes = {};
        await Promise.all(e.fotos.map(async f => { fuentes[f.id] = await api('panel_estilo_foto', { p_foto: f.id, p_tam: 'tarjeta' }); }));
        if (e.legado) { fuentes[e.id] = await api('panel_portafolio_imagen', { p_id: e.id }); e.fotos = [{ id: e.id, ancho: 4, alto: 5, foco_x: 50, foco_y: 50 }]; }
        abrirDetalleEstilo(e.id, { vista: { ...e, servicio: e.servicio_id ? { id: e.servicio_id, nombre: e.servicio } : null }, fuentes });
    } catch (err) { avisar(ctx, err); }
}

// ---------- Publicación con varias fotos ----------
const MAX_FOTOS = 10;
let logoNegocio = null;
async function marcaDisponible(nombreBarbero) {
    // Logo real publicado del negocio (si existe) o el nombre del barbero
    logoNegocio ??= (async () => {
        try {
            const n = await api('negocio_publico');
            return n?.logo_url ? await bitmapDesdeDataURL(n.logo_url) : null;
        } catch { return null; }
    })();
    return { nombre: nombreBarbero, logo: await logoNegocio };
}

async function abrirPublicacion(ctx, t, barberos, autorizaciones, recargar, publicacionDirecta) {
    const esAdmin = ctx.rol === 'admin';
    // Si ya hay una versión en curso de un trabajo publicado, se sigue editando esa versión
    let trabajo = null;
    try { trabajo = t ? await api('panel_estilo', { p_id: t.revision?.id || t.id }) : null; }
    catch (e) { avisar(ctx, e); return; }
    const nombreDe = id => barberos.find(b => String(b.id) === String(id))?.nombre || '';
    const creaVersion = trabajo && trabajo.estado === 'publicado' && !esAdmin && !publicacionDirecta;
    const servicios = obtenerServicios().filter(s => s.servicio_id);
    const vigentes = autorizaciones.filter(a => a.estado === 'vigente' || a.id === trabajo?.autorizacion_id);
    let clave = 0;
    const fotos = (trabajo?.fotos || []).map(f => ({ clave: ++clave, id: f.id, miniatura: f.miniatura, ajustes: f.ajustes || {}, ancho: f.ancho, alto: f.alto,
        foco_x: f.foco_x, foco_y: f.foco_y, portada: f.portada, estado: 'subida' }));
    const legado = trabajo?.legado ? { miniatura: trabajo.miniatura } : null;
    const quitar = [];
    const textoEnviar = esAdmin || publicacionDirecta ? 'Publicar' : 'Enviar a revisión';
    const confirmada = trabajo?.autorizacion_confirmada_en;
    const { cuerpo, cerrar } = dialogo({ titulo: trabajo ? (trabajo.revision_de || creaVersion ? 'Nueva versión del trabajo' : 'Editar publicación') : 'Nueva publicación', ancho: 'lg', html: `
        <form class="panel-form publicacion-form" novalidate>
            ${trabajo?.revision_de || creaVersion ? '<p class="panel-aviso">La versión publicada sigue visible en la web. Esta nueva versión se mostrará cuando el administrador la apruebe.</p>' : ''}
            ${trabajo?.motivo_estado && trabajo.estado === 'borrador' ? `<p class="panel-aviso">Motivo de la devolución: ${esc(trabajo.motivo_estado)}</p>` : ''}
            ${esAdmin && !trabajo ? `<label>Barbero autor${selectorBarbero(barberos, estado.barbero, { todos: false }).replace('data-barbero', 'name="barbero_id" required')}</label>` : ''}
            <label>Nombre del estilo<input name="titulo" maxlength="80" required value="${esc(trabajo?.titulo || '')}" placeholder="Ej.: Taper fade con textura"></label>
            <label>Descripción (opcional)<textarea name="descripcion" maxlength="300" rows="3" placeholder="Técnica, productos o mantenimiento recomendado">${esc(trabajo?.descripcion || '')}</textarea></label>
            <div class="panel-rejilla">
                <label>Servicio relacionado (opcional)<select name="servicio_id"><option value="">Sin servicio</option>
                    ${servicios.map(s => `<option value="${esc(s.servicio_id)}" ${String(s.servicio_id) === String(trabajo?.servicio_id) ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>
                <label>Especialidad (opcional, para filtrar en el perfil)<input name="especialidad" maxlength="40" value="${esc(trabajo?.especialidad || '')}" placeholder="Ej.: Degradados"></label>
            </div>
            <label>Texto alternativo (describe las fotos para lectores de pantalla)<input name="texto_alternativo" maxlength="200" required value="${esc(trabajo?.texto_alternativo || '')}" placeholder="Ej.: Corte taper fade visto de perfil"></label>
            <fieldset class="panel-fieldset"><legend>Fotos</legend>
                <p class="panel-sub">Hasta ${MAX_FOTOS} fotos JPG, PNG o WebP de hasta 8 MB. El original se guarda privado; en la web solo se publican versiones optimizadas sin metadatos. La portada es la foto de las tarjetas.</p>
                ${legado ? '<p class="panel-sub">La imagen anterior de este trabajo se conserva como primera foto al añadir otras.</p>' : ''}
                <ul class="pub-fotos" data-fotos aria-label="Fotos de la publicación"></ul>
                <label class="panel-btn negocio-subir"><i class="fas fa-plus" aria-hidden="true"></i> Añadir fotos<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp" multiple data-anadir></label>
                <p class="pub-fotos-estado" role="status" data-fotos-estado></p>
            </fieldset>
            <fieldset class="panel-fieldset"><legend>Autorización del cliente</legend>
                <label class="panel-check"><input type="checkbox" name="muestra_persona" ${trabajo?.muestra_persona === false ? '' : 'checked'}>
                    Se reconoce a una persona (rostro, tatuaje u otro rasgo identificable)</label>
                <div data-persona>
                    <label class="panel-check"><input type="checkbox" name="autorizacion_confirmada" ${confirmada ? 'checked' : ''}>
                        Confirmo que el cliente autorizó publicar estas fotografías</label>
                    <p class="panel-sub">${confirmada ? `Confirmado por ${esc(trabajo.autorizacion_confirmada_por || 'el equipo')} el ${esc(fechaHora(confirmada))}. ` : ''}Se registra quién lo confirma y cuándo. No sustituye la autorización o el acuerdo que use la barbería: para publicar, el administrador vincula la autorización registrada.</p>
                    ${esAdmin ? `<label>Autorización de imagen registrada<select name="autorizacion_id"><option value="">Sin autorización</option>
                        ${vigentes.map(a => `<option value="${esc(a.id)}" ${a.id === trabajo?.autorizacion_id ? 'selected' : ''}>#${esc(a.numero)} · ${esc(a.cliente_nombre)} · ${esc(fechaCorta(a.fecha))}${a.estado !== 'vigente' ? ' (retirada)' : ''}</option>`).join('')}</select></label>` : ''}
                </div>
            </fieldset>
            <p class="campo-error" role="alert" data-error></p>
            <div class="panel-acciones publicacion-acciones">
                <button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="button" class="panel-btn" data-previa><i class="fas fa-eye" aria-hidden="true"></i> Previsualizar</button>
                <button type="submit" class="panel-btn" value="borrador">Guardar borrador</button>
                <button type="submit" class="panel-btn panel-btn-principal" value="enviar">${textoEnviar}</button>
            </div>
        </form>` });
    const form = cuerpo.querySelector('form');
    const lista = form.querySelector('[data-fotos]');
    const estadoFotos = form.querySelector('[data-fotos-estado]');
    const error = form.querySelector('[data-error]');
    const persona = form.elements.muestra_persona;
    const autor = () => (trabajo ? nombreDe(trabajo.barbero_id) || trabajo.barbero : esAdmin ? nombreDe(form.elements.barbero_id?.value) : ctx.barbero_nombre) || '';
    const alternarPersona = () => { form.querySelector('[data-persona]').hidden = !persona.checked; };
    persona.addEventListener('change', alternarPersona);
    alternarPersona();

    const pintarFotos = () => {
        if (fotos.length && !fotos.some(f => f.portada)) fotos[0].portada = true;
        lista.innerHTML = (legado && !fotos.length ? `<li class="pub-foto"><img src="${esc(legado.miniatura)}" alt="Imagen anterior del trabajo"><span class="pub-foto-estado">Imagen anterior</span></li>` : '')
            + fotos.map((f, i) => `<li class="pub-foto${f.estado === 'error' ? ' con-error' : ''}" data-clave="${f.clave}">
                <img src="${esc(f.miniatura)}" alt="Foto ${i + 1}${f.portada ? ', portada' : ''}">
                <span class="pub-foto-estado">${f.estado === 'error' ? `Error: ${esc(f.error)}` : f.estado === 'subida' && !f.cambiada ? (f.portada ? '★ Portada' : 'Guardada') : 'Sin subir'}</span>
                <label class="panel-check pub-portada"><input type="radio" name="portada" value="${f.clave}" ${f.portada ? 'checked' : ''}> Portada</label>
                <div class="pub-foto-acciones">
                    <button type="button" class="panel-btn panel-btn-mini" data-editar="${f.clave}"><i class="fas fa-sliders" aria-hidden="true"></i> Editar<span class="sr-only"> la foto ${i + 1}</span></button>
                    <button type="button" class="panel-icono" data-mover="-1" data-c="${f.clave}" aria-label="Mover la foto ${i + 1} antes" ${i ? '' : 'disabled'}><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
                    <button type="button" class="panel-icono" data-mover="1" data-c="${f.clave}" aria-label="Mover la foto ${i + 1} después" ${i < fotos.length - 1 ? '' : 'disabled'}><i class="fas fa-arrow-right" aria-hidden="true"></i></button>
                    <button type="button" class="panel-icono" data-quitar="${f.clave}" aria-label="Quitar la foto ${i + 1}"><i class="fas fa-trash" aria-hidden="true"></i></button>
                </div></li>`).join('');
        form.querySelector('[data-anadir]').disabled = fotos.length >= MAX_FOTOS;
    };
    pintarFotos();

    form.querySelector('[data-anadir]').addEventListener('change', async e => {
        const archivos = [...e.target.files].slice(0, MAX_FOTOS - fotos.length);
        e.target.value = '';
        const errores = [];
        const marca = await marcaDisponible(autor());
        for (const [i, archivo] of archivos.entries()) {
            estadoFotos.textContent = `Preparando foto ${i + 1} de ${archivos.length}…`;
            try {
                const { original, bitmap } = await leerArchivo(archivo);
                const ajustes = { ...AJUSTES_INICIALES };
                const salida = await exportar(bitmap, ajustes, marca);
                fotos.push({ clave: ++clave, id: null, fuente: bitmap, original, ajustes, salida, miniatura: salida.miniatura, ancho: salida.ancho, alto: salida.alto,
                    foco_x: salida.foco_x, foco_y: salida.foco_y, estado: 'pendiente' });
            } catch (fallo) { errores.push(fallo.message); }
        }
        estadoFotos.textContent = errores.length ? errores.join(' ') : `${archivos.length} foto(s) lista(s). Se subirán al guardar.`;
        pintarFotos();
    });

    lista.addEventListener('change', e => {
        if (e.target.name !== 'portada') return;
        fotos.forEach(f => { f.portada = String(f.clave) === e.target.value; });
        pintarFotos();
        lista.querySelector('input[name="portada"]:checked')?.focus();
    });
    lista.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mover) {
            const i = fotos.findIndex(f => String(f.clave) === b.dataset.c), j = i + Number(b.dataset.mover);
            [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
            pintarFotos();
            (lista.querySelector(`[data-c="${b.dataset.c}"][data-mover="${b.dataset.mover}"]:not([disabled])`) || lista.querySelector(`[data-editar="${b.dataset.c}"]`))?.focus();
        } else if (b.dataset.quitar) {
            const i = fotos.findIndex(f => String(f.clave) === b.dataset.quitar);
            if (fotos[i].id) quitar.push(fotos[i].id);
            fotos.splice(i, 1);
            pintarFotos();
            form.querySelector('[data-anadir]').focus();
        } else if (b.dataset.editar) {
            const f = fotos.find(x => String(x.clave) === b.dataset.editar);
            b.disabled = true;
            try {
                // El editor siempre parte del original (no se acumulan pérdidas ni se sobrescribe)
                f.fuente ??= await bitmapDesdeDataURL(await api('panel_estilo_foto_original', { p_foto: f.id }));
                const marca = await marcaDisponible(autor());
                const ajustes = await abrirEditorFoto({ fuente: f.fuente, ajustes: f.ajustes, marca, titulo: 'Editar foto' });
                if (ajustes) {
                    estadoFotos.textContent = 'Aplicando ajustes…';
                    f.salida = await exportar(f.fuente, ajustes, marca);
                    Object.assign(f, { ajustes, miniatura: f.salida.miniatura, ancho: f.salida.ancho, alto: f.salida.alto, foco_x: f.salida.foco_x, foco_y: f.salida.foco_y });
                    if (f.id) f.cambiada = true;
                    estadoFotos.textContent = 'Ajustes aplicados. Se subirán al guardar.';
                    pintarFotos();
                }
            } catch (fallo) { avisar(ctx, fallo); }
            finally { b.disabled = false; lista.querySelector(`[data-editar="${b.dataset.editar}"]`)?.focus(); }
        }
    });

    const datosFormulario = () => {
        const f = form.elements;
        return {
            barbero_id: f.barbero_id?.value || trabajo?.barbero_id || estado.barbero || String(ctx.barbero_id || ''),
            titulo: f.titulo.value.trim(), descripcion: f.descripcion.value.trim(), servicio_id: f.servicio_id.value,
            especialidad: f.especialidad.value.trim(), texto_alternativo: f.texto_alternativo.value.trim(),
            muestra_persona: persona.checked, autorizacion_confirmada: persona.checked && f.autorizacion_confirmada.checked,
            ...(esAdmin ? { autorizacion_id: persona.checked ? f.autorizacion_id.value || null : null } : {})
        };
    };

    form.querySelector('[data-previa]').addEventListener('click', e => {
        const d = datosFormulario();
        const visibles = [...fotos].sort((a, b) => Number(b.portada) - Number(a.portada));
        if (!visibles.length && !legado) { error.textContent = 'Añade al menos una foto para previsualizar.'; return; }
        const servicio = servicios.find(s => String(s.servicio_id) === d.servicio_id);
        const lista = visibles.length ? visibles.map(f => ({ id: `local-${f.clave}`, ancho: f.ancho, alto: f.alto, foco_x: f.foco_x, foco_y: f.foco_y }))
            : [{ id: 'legado', ancho: 4, alto: 5, foco_x: 50, foco_y: 50 }];
        const fuentes = visibles.length ? Object.fromEntries(visibles.map(f => [`local-${f.clave}`, f.salida?.tarjeta || f.miniatura])) : { legado: legado.miniatura };
        abrirDetalleEstilo(null, { origen: e.currentTarget, fuentes, vista: {
            titulo: d.titulo || 'Sin nombre', descripcion: d.descripcion, texto_alternativo: d.texto_alternativo || d.titulo,
            barbero_id: d.barbero_id, barbero: autor(), servicio: servicio ? { id: servicio.servicio_id, nombre: servicio.nombre } : null, fotos: lista } });
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const accion = e.submitter?.value || 'borrador';
        const d = datosFormulario();
        error.textContent = '';
        if (!d.titulo || d.texto_alternativo.length < 3) {
            error.textContent = 'Escribe el nombre del estilo y el texto alternativo (mínimo 3 caracteres).';
            (d.titulo ? form.elements.texto_alternativo : form.elements.titulo).focus();
            return;
        }
        if (esAdmin && !trabajo && !d.barbero_id) { error.textContent = 'Elige el barbero autor.'; return; }
        if (accion === 'enviar' && !fotos.length && !legado) { error.textContent = 'Añade al menos una foto antes de enviar.'; form.querySelector('[data-anadir]').focus(); return; }
        if (accion === 'enviar' && d.muestra_persona && !d.autorizacion_confirmada && !d.autorizacion_id) {
            error.textContent = 'Confirma que el cliente autorizó publicar sus fotos, o desmarca «Se reconoce a una persona».';
            form.elements.autorizacion_confirmada.focus();
            return;
        }
        const botones = [...form.querySelectorAll('button')];
        botones.forEach(b => { b.disabled = true; });
        try {
            // 1) Datos. Si es una versión nueva de lo publicado, el servidor devuelve esa versión con copia de las fotos
            const anterior = trabajo;
            trabajo = await api('panel_estilo_guardar', { p_id: trabajo?.id || null, p_datos: d });
            if (anterior && trabajo.id !== anterior.id) {
                const viejas = [...anterior.fotos].sort((a, b) => a.orden - b.orden).map(f => f.id);
                const nuevas = [...trabajo.fotos].sort((a, b) => a.orden - b.orden).map(f => f.id);
                const mapa = Object.fromEntries(viejas.map((id, i) => [id, nuevas[i]]));
                fotos.forEach(f => { if (f.id) f.id = mapa[f.id] || f.id; });
                quitar.forEach((id, i) => { quitar[i] = mapa[id] || id; });
            }
            // 2) Fotos, una a una: si alguna falla, el borrador queda guardado y se puede reintentar
            while (quitar.length) { await api('panel_estilo_foto_quitar', { p_foto: quitar[0] }); quitar.shift(); }
            let fallidas = 0;
            for (const [i, f] of fotos.entries()) {
                if (f.estado === 'subida' && !f.cambiada) continue;
                estadoFotos.textContent = `Subiendo foto ${i + 1} de ${fotos.length}…`;
                try {
                    const { salida } = f;
                    const r = await api('panel_estilo_foto_guardar', { p_trabajo: trabajo.id, p_foto: f.id, p_datos: {
                        imagen: salida.imagen, tarjeta: salida.tarjeta, miniatura: salida.miniatura, ancho: salida.ancho, alto: salida.alto,
                        foco_x: salida.foco_x, foco_y: salida.foco_y, ajustes: salida.ajustes, ...(f.id ? {} : { original: f.original }) } });
                    Object.assign(f, { id: r.id, estado: 'subida', cambiada: false, error: null });
                } catch (fallo) { fallidas++; Object.assign(f, { estado: 'error', error: fallo.message }); }
            }
            const subidas = fotos.filter(f => f.id);
            if (subidas.length) trabajo = await api('panel_estilo_fotos_ordenar', { p_trabajo: trabajo.id, p_ids: subidas.map(f => f.id), p_portada: (subidas.find(f => f.portada) || subidas[0]).id });
            estadoFotos.textContent = '';
            if (fallidas) {
                error.textContent = `Borrador guardado, pero ${fallidas} foto(s) no se subieron. Pulsa de nuevo «Guardar borrador» para reintentar.`;
                return;
            }
            // 3) Envío: revisión o publicación según la configuración y el rol
            if (accion === 'enviar') {
                const r = await api('panel_portafolio_estado', { p_id: trabajo.id, p_accion: esAdmin ? 'publicar' : 'enviar_revision', p_motivo: null });
                ctx.notificar(r.estado === 'publicado' ? 'Publicado en «Estilos de la casa»' : 'Enviado a revisión: el administrador lo revisará');
            } else ctx.notificar('Borrador guardado');
            cerrar();
            recargar();
        } catch (fallo) {
            error.textContent = fallo.message;
        } finally {
            botones.forEach(b => { b.disabled = false; });
            if (form.isConnected) pintarFotos();
        }
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
