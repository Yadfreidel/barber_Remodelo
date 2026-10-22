// ==========================================
// PANEL: CATÁLOGO DE SERVICIOS
// Se desactiva en vez de borrar: las citas registradas conservan su precio y duración.
// ==========================================

import { CATALOGO_25, CATEGORIAS_CATALOGO } from '../../models/catalogo25.js';
import { api, esc, dinero, dialogo, confirmar, ejecutar, imagenADataURL, vacio } from './comun.js';
import { invalidarCatalogosAgenda } from './agenda.js';

// Los 25 cortes originales toman foto, descripción y categoría del catálogo estático hasta que se editen
export function servicioEfectivo(s) {
    const base = s.catalogo_id ? CATALOGO_25.find(c => c.id === s.catalogo_id) : null;
    return {
        ...s,
        descripcion_original: s.descripcion,
        categoria_original: s.categoria,
        descripcion: s.descripcion ?? base?.descripcion ?? '',
        categoria: s.categoria ?? base?.categoria ?? '',
        imagen: s.imagen_url || base?.imagen || ''
    };
}

export async function renderServicios(cont, ctx, opciones = {}) {
    cont.innerHTML = '<p class="panel-cargando">Cargando servicios…</p>';
    let servicios, barberos;
    try { [servicios, barberos] = await Promise.all([api('panel_servicios'), api('panel_barberos')]); }
    catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    servicios = servicios.map(servicioEfectivo);
    let filtro = 'activos';

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Catálogo de servicios</h2><p class="panel-sub">Precios en RD$. Cambiar un precio o duración no altera las citas ya registradas.</p></div>
            <button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-plus"></i> Agregar servicio</button>
        </div>
        <div class="panel-segmentos" role="group" aria-label="Mostrar">
            <button type="button" data-filtro="activos" aria-pressed="true">Activos</button>
            <button type="button" data-filtro="inactivos" aria-pressed="false">Inactivos</button>
            <button type="button" data-filtro="todos" aria-pressed="false">Todos</button>
        </div>
        <div class="servicios-lista"></div>`;

    const lista = cont.querySelector('.servicios-lista');
    const recargar = () => { invalidarCatalogosAgenda(); renderServicios(cont, ctx); };
    const pintar = () => {
        const visibles = servicios.filter(s => filtro === 'todos' || (filtro === 'activos' ? s.activo : !s.activo));
        lista.innerHTML = visibles.length ? visibles.map((s, i) => `
            <article class="servicio-fila ${s.activo ? '' : 'inactivo'}">
                <div class="servicio-foto">${s.imagen ? `<img src="${esc(s.imagen)}" alt="" loading="lazy">` : '<i class="fas fa-scissors"></i>'}</div>
                <div class="servicio-info">
                    <strong>${esc(s.nombre)}</strong>
                    ${s.destacado ? '<span class="estado-chip estado-confirmada">Destacado</span>' : ''}
                    ${!s.activo ? '<span class="estado-chip estado-cancelada">Inactivo</span>' : ''}
                    ${!s.catalogo_id && !s.en_catalogo ? '<span class="estado-chip estado-pendiente">Fuera del catálogo web</span>' : ''}
                    <small>${esc(CATEGORIAS_CATALOGO[s.categoria] || s.categoria || 'Sin categoría')} · ${s.duracion_minutos} min · ${dinero(s.precio)}</small>
                    <small>${s.barberos.length ? `Solo: ${esc(s.barberos.map(id => barberos.find(b => b.id === id)?.nombre).filter(Boolean).join(', '))}` : 'Todos los barberos'}
                        ${s.citas_futuras ? ` · ${s.citas_futuras} cita(s) futura(s)` : ''}</small>
                </div>
                <div class="servicio-acciones">
                    ${filtro === 'activos' ? `<button type="button" class="panel-icono" data-subir="${i}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
                    <button type="button" class="panel-icono" data-bajar="${i}" aria-label="Bajar" ${i === visibles.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>` : ''}
                    <button type="button" class="panel-btn" data-editar="${esc(s.id)}">Editar</button>
                    <button type="button" class="panel-btn ${s.activo ? 'panel-btn-peligro' : ''}" data-alternar="${esc(s.id)}">${s.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
            </article>`).join('') : vacio('No hay servicios en esta vista.', 'scissors');

        lista.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abrirServicio(ctx, servicios.find(s => s.id === b.dataset.editar), barberos, recargar)));
        lista.querySelectorAll('[data-alternar]').forEach(b => b.addEventListener('click', async () => {
            const s = servicios.find(x => x.id === b.dataset.alternar);
            if (s.activo && !await confirmar(`¿Desactivar "${s.nombre}"? Dejará de ofrecerse en la web${s.citas_futuras ? `; sus ${s.citas_futuras} cita(s) futura(s) se conservan` : ''}. El historial no se borra.`, { textoOk: 'Desactivar', peligro: true })) return;
            if (await ejecutar(b, () => api('panel_guardar_servicio', { p_id: s.id, p_datos: datosServicio(s, { activo: !s.activo }) }), ctx.notificar, s.activo ? 'Servicio desactivado' : 'Servicio activado')) recargar();
        }));
        const mover = async (i, paso, boton) => {
            const orden = visibles.map(s => s.id);
            [orden[i], orden[i + paso]] = [orden[i + paso], orden[i]];
            const resto = servicios.filter(s => !orden.includes(s.id)).map(s => s.id);
            if (await ejecutar(boton, () => api('panel_ordenar_servicios', { p_ids: [...orden, ...resto] }), ctx.notificar)) recargar();
        };
        lista.querySelectorAll('[data-subir]').forEach(b => b.addEventListener('click', () => mover(Number(b.dataset.subir), -1, b)));
        lista.querySelectorAll('[data-bajar]').forEach(b => b.addEventListener('click', () => mover(Number(b.dataset.bajar), 1, b)));
    };
    cont.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
        filtro = b.dataset.filtro;
        cont.querySelectorAll('[data-filtro]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        pintar();
    }));
    cont.querySelector('[data-nuevo]').addEventListener('click', () => abrirServicio(ctx, null, barberos, recargar));
    pintar();
    if (opciones.nuevo) abrirServicio(ctx, null, barberos, recargar);
}

function datosServicio(s, cambios = {}) {
    return {
        nombre: s.nombre, descripcion: s.descripcion_original ?? s.descripcion, categoria: s.categoria_original ?? s.categoria,
        imagen_url: s.imagen_url || '', precio: Number(s.precio), duracion_minutos: Number(s.duracion_minutos),
        activo: s.activo, destacado: s.destacado, en_catalogo: s.en_catalogo, ...cambios
    };
}

function abrirServicio(ctx, s, barberos, recargar) {
    const categorias = { ...CATEGORIAS_CATALOGO };
    let imagen = s?.imagen_url || '';
    const { cuerpo, cerrar } = dialogo({ titulo: s ? `Editar: ${s.nombre}` : 'Agregar servicio', ancho: 'lg', html: `
        <form class="panel-form" novalidate>
            <div class="servicio-editor">
                <div class="servicio-editor-foto">
                    <div class="servicio-foto grande" data-vista-foto>${s?.imagen ? `<img src="${esc(s.imagen)}" alt="">` : '<i class="fas fa-image"></i>'}</div>
                    <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Subir foto<input type="file" accept="image/png,image/jpeg,image/webp" data-archivo hidden></label>
                    <input type="url" data-url placeholder="o pega un enlace https://" value="${esc(s?.imagen_url?.startsWith('https://') ? s.imagen_url : '')}" aria-label="Enlace de la foto">
                    ${s?.catalogo_id && !s?.imagen_url ? '<small class="panel-sub">Usa la foto original del catálogo.</small>' : ''}
                    <button type="button" class="panel-btn panel-btn-mini" data-quitar-foto ${imagen ? '' : 'hidden'}>Quitar foto personalizada</button>
                </div>
                <div>
                    <label>Nombre<input name="nombre" required maxlength="120" value="${esc(s?.nombre || '')}"></label>
                    <label>Descripción<textarea name="descripcion" rows="3" maxlength="600">${esc(s?.descripcion || '')}</textarea></label>
                    <div class="panel-rejilla">
                        <label>Categoría<input name="categoria" list="categorias-servicio" maxlength="40" value="${esc(s?.categoria || '')}"></label>
                        <label>Precio (RD$)<input type="number" name="precio" min="0" step="1" required value="${esc(s?.precio ?? '')}"></label>
                        <label>Duración (min)<input type="number" name="duracion_minutos" min="5" max="480" step="5" required value="${esc(s?.duracion_minutos ?? 30)}"></label>
                    </div>
                    <datalist id="categorias-servicio">${Object.entries(categorias).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</datalist>
                    <div class="panel-fila">
                        <label class="panel-check"><input type="checkbox" name="activo" ${s ? (s.activo ? 'checked' : '') : 'checked'}> Activo (se puede reservar)</label>
                        <label class="panel-check"><input type="checkbox" name="destacado" ${s?.destacado ? 'checked' : ''}> Destacado</label>
                        ${s && !s.catalogo_id ? `<label class="panel-check"><input type="checkbox" name="en_catalogo" ${s.en_catalogo ? 'checked' : ''}> Mostrar en el catálogo web</label>` : ''}
                    </div>
                    <fieldset class="panel-fieldset"><legend>Barberos que lo realizan</legend>
                        <p class="panel-sub">Sin marcar ninguno = todos los barberos.</p>
                        <div class="panel-fila">${barberos.filter(b => b.activo).map(b => `<label class="panel-check"><input type="checkbox" name="barberos" value="${esc(b.id)}" ${s?.barberos.includes(b.id) ? 'checked' : ''}> ${esc(b.nombre)}</label>`).join('')}</div>
                    </fieldset>
                </div>
            </div>
            <p class="panel-error" data-error role="alert"></p>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    const vista = cuerpo.querySelector('[data-vista-foto]');
    const quitar = cuerpo.querySelector('[data-quitar-foto]');
    const mostrar = url => { vista.innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<i class="fas fa-image"></i>'; quitar.hidden = !imagen; };
    cuerpo.querySelector('[data-archivo]').addEventListener('change', async e => {
        const archivo = e.target.files[0];
        if (!archivo) return;
        try { imagen = await imagenADataURL(archivo); mostrar(imagen); } catch (err) { ctx.notificar(err.message, 'error'); }
    });
    cuerpo.querySelector('[data-url]').addEventListener('change', e => {
        const url = e.target.value.trim();
        if (url && !/^https:\/\//.test(url)) { ctx.notificar('El enlace debe empezar con https://', 'error'); return; }
        imagen = url;
        mostrar(url || s?.imagen);
    });
    quitar.addEventListener('click', () => { imagen = ''; mostrar(s?.catalogo_id ? CATALOGO_25.find(c => c.id === s.catalogo_id)?.imagen : ''); });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const error = form.querySelector('[data-error]');
        const d = new FormData(form);
        const precio = Number(d.get('precio'));
        const duracion = Number(d.get('duracion_minutos'));
        if (!d.get('nombre').trim() || d.get('precio') === '' || !(precio >= 0) || !(duracion >= 5 && duracion <= 480)) {
            error.textContent = 'Completa nombre, precio (RD$) y duración (5 a 480 min).';
            return;
        }
        const datos = {
            nombre: d.get('nombre').trim(), descripcion: d.get('descripcion').trim(), categoria: d.get('categoria').trim(),
            imagen_url: imagen, precio, duracion_minutos: duracion, activo: form.elements.activo.checked,
            destacado: form.elements.destacado.checked, barberos: d.getAll('barberos')
        };
        if (form.elements.en_catalogo) datos.en_catalogo = form.elements.en_catalogo.checked;
        // Para los cortes originales no se copia el texto estático si no se modificó
        const base = s?.catalogo_id ? CATALOGO_25.find(c => c.id === s.catalogo_id) : null;
        if (base && datos.descripcion === base.descripcion && s.descripcion_original == null) datos.descripcion = '';
        if (base && datos.categoria === base.categoria && s.categoria_original == null) datos.categoria = '';
        if (await ejecutar(e.submitter, () => api('panel_guardar_servicio', { p_id: s?.id || null, p_datos: datos }), ctx.notificar, s ? 'Servicio actualizado' : 'Servicio creado')) {
            cerrar();
            recargar();
        }
    });
}
