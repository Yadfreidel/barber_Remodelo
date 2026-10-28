// ==========================================
// PANEL: CONTENIDO Y GALERÍA (solo administración)
// Revisión de publicaciones (aprobar o devolver con motivo), contenido publicado, destacados del
// inicio con su orden y la política de publicación (directa o con aprobación).
// Reutiliza el flujo del portafolio: mismos estados, mismas funciones del servidor.
// ==========================================

import { api, esc, confirmar, pedirMotivo, ejecutar, vacio, fechaHora } from './comun.js';
import { turnoDe } from './finanzas-comun.js';
import { abrirDetalleEstilo } from '../estilosController.js';

const estado = { sub: 'revision' };

export async function renderGaleria(cont, ctx) {
    const subs = { revision: 'Revisión', publicados: 'Publicados y destacados', configuracion: 'Configuración' };
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Contenido y galería</h2>
            <p class="panel-sub">Publicaciones de «Estilos de la casa»: se muestran en el inicio, en la galería y en el perfil de cada barbero.</p></div></div>
        <div class="panel-segmentos" role="tablist" aria-label="Secciones">${Object.entries(subs).map(([k, v]) =>
            `<button type="button" role="tab" data-sub="${k}" aria-selected="${estado.sub === k}">${esc(v)}</button>`).join('')}</div>
        <div data-cuerpo><p class="panel-cargando">Cargando…</p></div>`;
    cont.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { estado.sub = b.dataset.sub; renderGaleria(cont, ctx); }));
    const cuerpo = cont.querySelector('[data-cuerpo]');
    const vigente = turnoDe(cont);
    const recargar = () => renderGaleria(cont, ctx);
    let datos;
    try { datos = await api('panel_galeria'); } catch (e) { if (vigente()) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    if (estado.sub === 'configuracion') return pintarConfiguracion(cuerpo, ctx, datos, recargar);
    if (estado.sub === 'publicados') return pintarPublicados(cuerpo, ctx, datos, recargar);
    pintarRevision(cuerpo, ctx, datos, recargar);
}

function miniatura(t) {
    return t.miniatura ? `<img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}" loading="lazy">` : '<span class="panel-sub">Sin fotos</span>';
}

async function vistaPrevia(ctx, t, origen) {
    try {
        const e = await api('panel_estilo', { p_id: t.id });
        const fuentes = {};
        await Promise.all(e.fotos.map(async f => { fuentes[f.id] = await api('panel_estilo_foto', { p_foto: f.id, p_tam: 'tarjeta' }); }));
        if (e.legado) { fuentes[e.id] = await api('panel_portafolio_imagen', { p_id: e.id }); e.fotos = [{ id: e.id, ancho: 4, alto: 5, foco_x: 50, foco_y: 50 }]; }
        abrirDetalleEstilo(e.id, { origen, vista: { ...e, servicio: e.servicio_id ? { id: e.servicio_id, nombre: e.servicio } : null }, fuentes });
    } catch (err) { ctx.notificar(err.message, 'error'); }
}

// ---------- Revisión ----------
function pintarRevision(cuerpo, ctx, datos, recargar) {
    const lista = datos.pendientes;
    cuerpo.innerHTML = `
        <p class="panel-sub">${datos.publicacion_directa ? 'Publicación directa activada: aquí solo llegan los trabajos con una persona identificable que aún no tienen su autorización registrada.'
            : 'Las publicaciones nuevas y las nuevas versiones esperan tu aprobación. Mientras tanto, la versión publicada sigue visible.'}</p>
        <div class="portafolio-rejilla">${lista.length ? lista.map(t => `<article class="portafolio-tarjeta">
            <div class="portafolio-mini">${miniatura(t)}</div>
            <div class="portafolio-info">
                <strong>${esc(t.titulo)}</strong>
                <span class="estado-chip estado-pendiente">${t.revision_de ? 'Nueva versión' : 'Publicación nueva'}</span>
                ${t.revision_de ? `<small>Sustituirá a «${esc(t.original_titulo || '')}», que sigue publicado.</small>` : ''}
                <small>${esc(t.barbero || '')} · ${t.fotos.length || (t.legado ? 1 : 0)} foto(s)${t.servicio ? ` · ${esc(t.servicio)}` : ''}</small>
                <small>${!t.muestra_persona ? 'Sin personas identificables'
                    : t.autorizacion_numero ? `Autorización registrada #${esc(t.autorizacion_numero)}${t.autorizacion_vigente ? '' : ' (retirada)'}`
                    : `Confirmada por ${esc(t.autorizacion_confirmada_por || '—')}${t.autorizacion_confirmada_en ? ` el ${esc(fechaHora(t.autorizacion_confirmada_en))}` : ''}. Para aprobar, vincula la autorización registrada en Portafolio › Editar.`}</small>
            </div>
            <div class="portafolio-acciones">
                <button type="button" class="panel-btn panel-btn-mini" data-ver="${esc(t.id)}"><i class="fas fa-eye" aria-hidden="true"></i> Vista previa</button>
                <button type="button" class="panel-btn panel-btn-mini panel-btn-principal" data-aprobar="${esc(t.id)}">Aprobar y publicar</button>
                <button type="button" class="panel-btn panel-btn-mini" data-rechazar="${esc(t.id)}">Rechazar con motivo</button>
            </div></article>`).join('') : vacio('No hay publicaciones esperando revisión.', 'circle-check')}</div>`;
    const buscar = id => lista.find(t => t.id === id);
    cuerpo.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.ver) return vistaPrevia(ctx, buscar(b.dataset.ver), b);
        if (b.dataset.aprobar) {
            const t = buscar(b.dataset.aprobar);
            if (!await confirmar(`¿Aprobar «${t.titulo}»? ${t.revision_de ? 'Sustituirá a la versión publicada.' : 'Será visible para todos los visitantes.'}`, { textoOk: 'Aprobar y publicar' })) return;
            if (await ejecutar(b, () => api('panel_portafolio_estado', { p_id: t.id, p_accion: 'publicar', p_motivo: null }), ctx.notificar, 'Publicado')) recargar();
        }
        if (b.dataset.rechazar) {
            const t = buscar(b.dataset.rechazar);
            const motivo = await pedirMotivo({ titulo: `Rechazar «${t.titulo}»`, etiqueta: 'Motivo (el barbero lo verá para corregirlo)', textoOk: 'Rechazar' });
            if (motivo === null) return;
            if (await ejecutar(b, () => api('panel_portafolio_estado', { p_id: t.id, p_accion: 'devolver', p_motivo: motivo }), ctx.notificar, 'Devuelto al barbero con el motivo')) recargar();
        }
    });
}

// ---------- Publicados y destacados ----------
function pintarPublicados(cuerpo, ctx, datos, recargar) {
    const publicados = datos.publicados;
    let destacados = publicados.filter(t => t.destacado).sort((a, b) => (a.orden_destacado ?? 999) - (b.orden_destacado ?? 999)).map(t => t.id);
    const pintar = () => {
        const porId = id => publicados.find(t => t.id === id);
        cuerpo.innerHTML = `
            <section class="panel-caja" aria-labelledby="destacados-titulo">
                <h3 id="destacados-titulo">Destacados del inicio</h3>
                <p class="panel-sub">Se muestran primero en «Estilos de la casa», en este orden. Después aparecen los demás, del más reciente al más antiguo.</p>
                ${destacados.length ? `<ol class="galeria-destacados">${destacados.map((id, i) => `<li>
                    <span>${esc(porId(id)?.titulo || '')} <small>· ${esc(porId(id)?.barbero || '')}</small></span>
                    <button type="button" class="panel-icono" data-mover="-1" data-id="${esc(id)}" aria-label="Subir «${esc(porId(id)?.titulo || '')}»" ${i ? '' : 'disabled'}><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                    <button type="button" class="panel-icono" data-mover="1" data-id="${esc(id)}" aria-label="Bajar «${esc(porId(id)?.titulo || '')}»" ${i < destacados.length - 1 ? '' : 'disabled'}><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                </li>`).join('')}</ol>` : '<p class="panel-sub">Ningún trabajo destacado.</p>'}
                <button type="button" class="panel-btn panel-btn-principal" data-guardar-orden>Guardar destacados</button>
            </section>
            <div class="portafolio-rejilla">${publicados.length ? publicados.map(t => `<article class="portafolio-tarjeta">
                <div class="portafolio-mini">${miniatura(t)}</div>
                <div class="portafolio-info">
                    <strong>${esc(t.titulo)}</strong>
                    <small>${esc(t.barbero || '')} · Publicado ${esc(fechaHora(t.publicado_en))}</small>
                    ${t.revision ? `<span class="estado-chip estado-pendiente">Nueva versión en ${t.revision.estado === 'pendiente' ? 'revisión' : 'borrador'}</span>` : ''}
                    <label class="panel-check"><input type="checkbox" data-destacar="${esc(t.id)}" ${destacados.includes(t.id) ? 'checked' : ''}> Destacado en el inicio</label>
                </div>
                <div class="portafolio-acciones">
                    <button type="button" class="panel-btn panel-btn-mini" data-ver="${esc(t.id)}"><i class="fas fa-eye" aria-hidden="true"></i> Ver</button>
                    <button type="button" class="panel-btn panel-btn-mini panel-btn-peligro" data-retirar="${esc(t.id)}">Retirar</button>
                </div></article>`).join('') : vacio('Aún no hay trabajos publicados.', 'images')}</div>`;
    };
    pintar();
    cuerpo.addEventListener('change', e => {
        const id = e.target.dataset.destacar;
        if (!id) return;
        destacados = e.target.checked ? [...destacados, id] : destacados.filter(x => x !== id);
        pintar();
        cuerpo.querySelector(`[data-destacar="${CSS.escape(id)}"]`)?.focus();
    });
    cuerpo.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mover) {
            const i = destacados.indexOf(b.dataset.id), j = i + Number(b.dataset.mover);
            [destacados[i], destacados[j]] = [destacados[j], destacados[i]];
            pintar();
            (cuerpo.querySelector(`[data-id="${CSS.escape(b.dataset.id)}"][data-mover="${b.dataset.mover}"]:not([disabled])`)
                || cuerpo.querySelector(`[data-id="${CSS.escape(b.dataset.id)}"][data-mover]:not([disabled])`))?.focus();
        }
        if ('guardarOrden' in b.dataset && await ejecutar(b, () => api('panel_galeria_destacados', { p_ids: destacados }), ctx.notificar, 'Destacados guardados')) recargar();
        if (b.dataset.ver) vistaPrevia(ctx, publicados.find(t => t.id === b.dataset.ver), b);
        if (b.dataset.retirar) {
            const t = publicados.find(x => x.id === b.dataset.retirar);
            const motivo = await pedirMotivo({ titulo: `Retirar «${t.titulo}»`, etiqueta: 'Motivo de la retirada (queda en el historial y lo ve el barbero)', textoOk: 'Retirar de la web' });
            if (motivo === null) return;
            if (await ejecutar(b, () => api('panel_portafolio_estado', { p_id: t.id, p_accion: 'archivar', p_motivo: motivo }), ctx.notificar, 'Retirado: ya no se muestra en la web')) recargar();
        }
    });
}

// ---------- Configuración ----------
function pintarConfiguracion(cuerpo, ctx, datos, recargar) {
    cuerpo.innerHTML = `<form class="panel-form panel-caja" novalidate>
        <fieldset class="panel-fieldset"><legend>¿Cómo se publican los trabajos de los barberos?</legend>
            <label class="panel-check"><input type="radio" name="modo" value="aprobacion" ${datos.publicacion_directa ? '' : 'checked'}>
                Con aprobación del administrador (recomendado)</label>
            <label class="panel-check"><input type="radio" name="modo" value="directa" ${datos.publicacion_directa ? 'checked' : ''}>
                Publicación directa por el barbero</label>
        </fieldset>
        <p class="panel-sub">Con publicación directa, el barbero publica y edita lo suyo sin revisión, salvo los trabajos en los que se reconoce a una persona y aún no tienen su autorización registrada: esos siguen esperando tu revisión. Siempre puedes retirar cualquier publicación.</p>
        <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></form>`;
    cuerpo.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const directa = e.target.elements.modo.value === 'directa';
        if (await ejecutar(e.submitter, () => api('panel_galeria_config', { p_datos: { publicacion_directa: directa } }), ctx.notificar, 'Configuración guardada')) recargar();
    });
}
