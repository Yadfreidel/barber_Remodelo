// ==========================================
// PANEL: CONFIGURACIÓN DEL NEGOCIO (+ ubicación del local)
// Los cambios se ven en la vista previa y solo llegan a la web al pulsar "Publicar".
// ==========================================

import { api, esc, ejecutar, imagenADataURL } from './comun.js';
import { renderTabUbicacion } from '../ubicacionAdminController.js';

const REDES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };

// Valores actuales de la página como punto de partida (si aún no se ha publicado nada)
function valoresDePagina() {
    const texto = sel => document.querySelector(sel)?.textContent.trim() || '';
    return {
        nombre: texto('.logo-text'),
        descripcion: texto('.hero-description'),
        whatsapp: (document.querySelector('a[href*="wa.me/"]')?.href.match(/wa\.me\/(\d+)/) || [])[1] || '',
        telefono: (document.querySelector('a[href^="tel:"]')?.getAttribute('href') || '').replace(/[^\d+]/g, ''),
        horarios_publicos: [...document.querySelectorAll('.footer-info p')].map(p => p.textContent.trim()).filter(Boolean),
        redes: {},
        faq: [...document.querySelectorAll('.faq-card details')].map(d => ({ pregunta: d.querySelector('summary')?.textContent.trim() || '', respuesta: d.querySelector('p')?.textContent.trim() || '' })),
        logo_url: '', portada_url: ''
    };
}

export async function renderNegocio(cont, ctx, opciones = {}) {
    let publicado = null;
    try { publicado = await api('negocio_publico'); } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    const datos = { ...valoresDePagina(), ...(publicado || {}) };
    datos.redes = { ...(datos.redes || {}) };
    datos.faq = [...(datos.faq || [])];

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Configuración del negocio</h2><p class="panel-sub">${publicado ? 'Publicado. Los cambios se aplican al pulsar Publicar.' : 'Aún no se ha publicado: la web muestra sus textos originales.'}</p></div>
            <div class="panel-segmentos" role="group" aria-label="Sección">
                <button type="button" data-sub="datos" aria-pressed="${opciones.sub !== 'ubicacion'}">Datos y contenido</button>
                <button type="button" data-sub="ubicacion" aria-pressed="${opciones.sub === 'ubicacion'}">Ubicación y mapa</button>
            </div>
        </div>
        <div data-zona="datos" ${opciones.sub === 'ubicacion' ? 'hidden' : ''}>
            <div class="negocio-columnas">
                <form class="panel-form panel-caja" novalidate>
                    <div class="panel-rejilla">
                        <label>Nombre del negocio<input name="nombre" maxlength="80" value="${esc(datos.nombre)}"></label>
                        <label>WhatsApp<input name="whatsapp" inputmode="tel" value="${esc(datos.whatsapp)}" placeholder="18291234567"></label>
                        <label>Teléfono<input name="telefono" inputmode="tel" value="${esc(datos.telefono)}"></label>
                    </div>
                    <label>Descripción (portada)<textarea name="descripcion" rows="2" maxlength="300">${esc(datos.descripcion)}</textarea></label>
                    <div class="panel-rejilla">
                        <div><span class="panel-etiqueta">Logo</span><div class="negocio-imagen" data-img="logo_url"></div>
                            <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Subir<input type="file" accept="image/png,image/jpeg,image/webp" data-subir="logo_url" hidden></label>
                            <button type="button" class="panel-btn panel-btn-mini" data-quitar="logo_url">Quitar</button></div>
                        <div><span class="panel-etiqueta">Portada</span><div class="negocio-imagen" data-img="portada_url"></div>
                            <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Subir<input type="file" accept="image/png,image/jpeg,image/webp" data-subir="portada_url" hidden></label>
                            <button type="button" class="panel-btn panel-btn-mini" data-quitar="portada_url">Quitar</button></div>
                    </div>
                    <label>Horarios públicos (una línea por renglón)<textarea name="horarios_publicos" rows="3">${esc(datos.horarios_publicos.join('\n'))}</textarea></label>
                    <p class="panel-sub">Solo informativo. Las horas reservables se configuran en Horarios.</p>
                    <fieldset class="panel-fieldset"><legend>Redes sociales (https://)</legend>
                        <div class="panel-rejilla">${Object.entries(REDES).map(([k, v]) => `<label>${v}<input type="url" name="red_${k}" value="${esc(datos.redes[k] || '')}" placeholder="https://"></label>`).join('')}</div>
                    </fieldset>
                    <fieldset class="panel-fieldset"><legend>Preguntas frecuentes</legend>
                        <div data-faq></div>
                        <button type="button" class="panel-btn panel-btn-mini" data-agregar-faq><i class="fas fa-plus"></i> Agregar pregunta</button>
                    </fieldset>
                    <div class="panel-acciones">
                        <button type="button" class="panel-btn" data-descartar>Descartar cambios</button>
                        <button type="submit" class="panel-btn panel-btn-principal"><i class="fas fa-upload"></i> Publicar</button>
                    </div>
                </form>
                <aside class="panel-caja negocio-preview" aria-label="Vista previa">
                    <h3>Vista previa</h3>
                    <div data-preview></div>
                </aside>
            </div>
        </div>
        <div data-zona="ubicacion" ${opciones.sub === 'ubicacion' ? '' : 'hidden'}></div>`;

    const form = cont.querySelector('form');
    const zonaUbicacion = cont.querySelector('[data-zona="ubicacion"]');
    let ubicacionCargada = false;
    const mostrarSub = sub => {
        cont.querySelectorAll('[data-sub]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sub === sub)));
        cont.querySelector('[data-zona="datos"]').hidden = sub !== 'datos';
        zonaUbicacion.hidden = sub !== 'ubicacion';
        if (sub === 'ubicacion' && !ubicacionCargada) { ubicacionCargada = true; renderTabUbicacion(zonaUbicacion, ctx.notificar); }
    };
    cont.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => mostrarSub(b.dataset.sub)));
    if (opciones.sub === 'ubicacion') mostrarSub('ubicacion');

    const faq = cont.querySelector('[data-faq]');
    const pintarFaq = () => {
        faq.innerHTML = datos.faq.map((f, i) => `<div class="negocio-faq" data-i="${i}">
            <input data-campo="pregunta" maxlength="160" value="${esc(f.pregunta)}" placeholder="Pregunta" aria-label="Pregunta ${i + 1}">
            <textarea data-campo="respuesta" rows="2" maxlength="600" placeholder="Respuesta" aria-label="Respuesta ${i + 1}">${esc(f.respuesta)}</textarea>
            <button type="button" class="panel-icono" data-quitar-faq="${i}" aria-label="Quitar pregunta"><i class="fas fa-trash"></i></button></div>`).join('');
    };
    const leer = () => {
        const d = new FormData(form);
        datos.nombre = d.get('nombre').trim();
        datos.descripcion = d.get('descripcion').trim();
        datos.whatsapp = d.get('whatsapp').trim();
        datos.telefono = d.get('telefono').trim();
        datos.horarios_publicos = d.get('horarios_publicos').split('\n').map(l => l.trim()).filter(Boolean);
        Object.keys(REDES).forEach(k => { datos.redes[k] = d.get(`red_${k}`).trim(); });
        datos.faq = [...faq.querySelectorAll('.negocio-faq')].map(f => ({ pregunta: f.querySelector('[data-campo="pregunta"]').value.trim(), respuesta: f.querySelector('[data-campo="respuesta"]').value.trim() }));
    };
    const pintarPreview = () => {
        cont.querySelectorAll('[data-img]').forEach(el => {
            const url = datos[el.dataset.img];
            el.innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span class="panel-sub">Sin imagen (se mantiene la actual)</span>';
        });
        const redes = Object.entries(datos.redes).filter(([, v]) => v);
        cont.querySelector('[data-preview]').innerHTML = `
            <div class="preview-sitio">
                <header class="preview-cabecera">${datos.logo_url ? `<img src="${esc(datos.logo_url)}" alt="" class="preview-logo">` : '<i class="fas fa-scissors"></i>'}<strong>${esc(datos.nombre || 'Tu barbería')}</strong></header>
                <div class="preview-portada" ${datos.portada_url ? `style="background-image:url('${esc(datos.portada_url)}')"` : ''}><p>${esc(datos.descripcion)}</p></div>
                <div class="preview-bloque"><h4>Horarios</h4>${datos.horarios_publicos.map(h => `<p>${esc(h)}</p>`).join('') || '<p class="panel-sub">Sin horarios</p>'}</div>
                <div class="preview-bloque"><h4>Contacto</h4>
                    ${datos.whatsapp ? `<p><i class="fab fa-whatsapp"></i> ${esc(datos.whatsapp)}</p>` : ''}
                    ${datos.telefono ? `<p><i class="fas fa-phone"></i> ${esc(datos.telefono)}</p>` : ''}
                    ${redes.map(([k, v]) => `<p><i class="fab fa-${k}"></i> ${esc(v)}</p>`).join('')}</div>
                ${datos.faq.length ? `<div class="preview-bloque"><h4>Preguntas frecuentes</h4>${datos.faq.map(f => `<details><summary>${esc(f.pregunta)}</summary><p>${esc(f.respuesta)}</p></details>`).join('')}</div>` : ''}
            </div>`;
    };
    pintarFaq();
    pintarPreview();

    form.addEventListener('input', () => { leer(); pintarPreview(); });
    cont.querySelector('[data-agregar-faq]').addEventListener('click', () => { leer(); datos.faq.push({ pregunta: '', respuesta: '' }); pintarFaq(); pintarPreview(); });
    faq.addEventListener('click', e => {
        const b = e.target.closest('[data-quitar-faq]');
        if (!b) return;
        leer();
        datos.faq.splice(Number(b.dataset.quitarFaq), 1);
        pintarFaq();
        pintarPreview();
    });
    cont.querySelectorAll('[data-subir]').forEach(input => input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { datos[input.dataset.subir] = await imagenADataURL(input.files[0], input.dataset.subir === 'logo_url' ? 300 : 1400); pintarPreview(); }
        catch (e) { ctx.notificar(e.message, 'error'); }
    }));
    cont.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => { datos[b.dataset.quitar] = ''; pintarPreview(); }));
    cont.querySelector('[data-descartar]').addEventListener('click', () => renderNegocio(cont, ctx));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        leer();
        const invalida = Object.values(datos.redes).find(v => v && !/^https:\/\//.test(v));
        if (invalida) { ctx.notificar('Los enlaces de redes deben empezar con https://', 'error'); return; }
        if (datos.faq.some(f => !f.pregunta || !f.respuesta)) { ctx.notificar('Completa o quita las preguntas frecuentes vacías.', 'error'); return; }
        const guardado = await ejecutar(e.submitter, () => api('panel_guardar_negocio', { p_datos: datos }), ctx.notificar, 'Publicado: la web mostrará estos datos al recargarse');
        if (guardado) renderNegocio(cont, ctx);
    });
}
