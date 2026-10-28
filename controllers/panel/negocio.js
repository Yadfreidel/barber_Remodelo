// ==========================================
// PANEL: CONFIGURACIÓN DEL NEGOCIO (+ ubicación del local)
// Los cambios se ven en la vista previa y solo llegan a la web al pulsar "Publicar".
// ==========================================

import { api, esc, ejecutar, imagenADataURL } from './comun.js';
import { renderTabUbicacion } from '../ubicacionAdminController.js';
import { ayuda } from '../../assets/ayuda.js';
import { PALETAS, CONTRASTE_MINIMO, contraste, colorLegible, cssColores } from '../../assets/identidad-colores.js';

const REDES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
// Color que muestra el selector cuando se usan los colores originales del sitio
const COLOR_SITIO = { color_principal: '#d9c39a', color_acento: '#f0dfbc' };
// Requisitos de las imágenes: formato, peso del archivo original y tamaño mínimo
const IMAGENES = {
    logo_url: { nombre: 'Logo', lado: 300, minimo: [64, 64], texto: 'PNG, JPG o WebP · mínimo 64 × 64 px · hasta 10 MB. Se reduce a 300 px.' },
    portada_url: { nombre: 'Portada', lado: 1400, minimo: [800, 400], texto: 'PNG, JPG o WebP · mínimo 800 × 400 px · hasta 10 MB. Se reduce a 1400 px.' }
};
const PESO_MAXIMO = 10 * 1024 * 1024;
const LIMITE_POLITICA = 1200;

// Valores actuales de la página como punto de partida (si aún no se ha publicado nada)
function valoresDePagina() {
    const texto = sel => document.querySelector(sel)?.textContent.trim() || '';
    return {
        nombre: texto('.logo-text'),
        descripcion: texto('.hero-description'),
        whatsapp: (document.querySelector('a[href*="wa.me/"]')?.href.match(/wa\.me\/(\d+)/) || [])[1] || '',
        telefono: (document.querySelector('a[href^="tel:"]')?.getAttribute('href') || '').replace(/[^\d+]/g, ''),
        correo: '',
        horarios_publicos: [...document.querySelectorAll('.footer-info p')].map(p => p.textContent.trim()).filter(Boolean),
        redes: {},
        faq: [...document.querySelectorAll('.faq-card details')].map(d => ({ pregunta: d.querySelector('summary')?.textContent.trim() || '', respuesta: d.querySelector('p')?.textContent.trim() || '' })),
        logo_url: '', portada_url: '',
        color_principal: '', color_acento: '',
        politica_reservas: '', politica_cancelacion: ''
    };
}

// Formato, peso y dimensiones antes de procesarla; el lienzo la recodifica (solo píxeles, nunca SVG ni scripts)
async function validarImagen(archivo, campo) {
    const reglas = IMAGENES[campo];
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) throw new Error(`${reglas.nombre}: usa una imagen PNG, JPG o WebP. No se admiten SVG ni otros archivos.`);
    if (archivo.size > PESO_MAXIMO) throw new Error(`${reglas.nombre}: el archivo pesa más de 10 MB. Usa uno más ligero.`);
    let imagen;
    try { imagen = await createImageBitmap(archivo); }
    catch { throw new Error(`${reglas.nombre}: no se pudo leer la imagen. Puede estar dañada o no ser una imagen real.`); }
    const [ancho, alto] = [imagen.width, imagen.height];
    imagen.close?.();
    const [minAncho, minAlto] = reglas.minimo;
    if (ancho < minAncho || alto < minAlto) throw new Error(`${reglas.nombre}: la imagen mide ${ancho} × ${alto} px; el mínimo es ${minAncho} × ${minAlto} px.`);
}

function textoContraste(color) {
    const valor = contraste(color);
    return valor >= CONTRASTE_MINIMO
        ? `<i class="fas fa-circle-check" aria-hidden="true"></i> Contraste ${valor.toLocaleString('es-DO')}:1 · legible`
        : `<i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Contraste ${valor.toLocaleString('es-DO')}:1 · poco legible: elige un tono más claro (mínimo ${CONTRASTE_MINIMO}:1)`;
}

export async function renderNegocio(cont, ctx, opciones = {}) {
    let publicado = null;
    try { publicado = await api('negocio_publico'); } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    const datos = { ...valoresDePagina(), ...(publicado || {}) };
    datos.redes = { ...(datos.redes || {}) };
    datos.faq = [...(datos.faq || [])];
    const inicial = JSON.stringify(datos);
    const paletaActual = () => PALETAS.findIndex(p => p.principal === (datos.color_principal || '') && p.acento === (datos.color_acento || ''));

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
                    <fieldset class="panel-fieldset negocio-seccion">
                        <legend>Identidad del negocio</legend>
                        <div class="negocio-intro"><p class="panel-sub">Nombre, imágenes y colores de la web pública. La vista previa es solo tuya: nadie más ve los cambios hasta que pulses «Publicar».</p>
                            ${ayuda('Identidad del negocio', `<p>Se aplica en la web pública: cabecera, portada, botones y destacados, «Mis citas» y la tarjeta digital (PNG) de cada cita. El panel conserva sus propios colores.</p>
                                <p>Los colores de estados, errores y avisos no cambian. Si dejas los colores originales o quitas una imagen, la web usa sus valores por defecto.</p>
                                <p>«Descartar cambios» vuelve a lo último publicado.</p>`)}</div>
                        <div class="panel-rejilla">
                            <label>Nombre comercial<input name="nombre" maxlength="80" value="${esc(datos.nombre)}"></label>
                        </div>
                        <label>Descripción (portada)<textarea name="descripcion" rows="2" maxlength="300">${esc(datos.descripcion)}</textarea></label>
                        <div class="panel-rejilla">${Object.entries(IMAGENES).map(([campo, r]) => `
                            <div class="negocio-imagen-campo"><span class="panel-etiqueta" id="etiqueta-${campo}">${r.nombre}</span><div class="negocio-imagen" data-img="${campo}"></div>
                                <p class="panel-sub" id="requisitos-${campo}">${r.texto}</p>
                                <div class="negocio-imagen-acciones">
                                    <label class="panel-btn panel-btn-mini negocio-subir"><i class="fas fa-upload" aria-hidden="true"></i> Subir ${r.nombre.toLowerCase()}<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp" data-subir="${campo}" aria-describedby="requisitos-${campo} error-${campo}"></label>
                                    <button type="button" class="panel-btn panel-btn-mini" data-quitar="${campo}">Quitar ${r.nombre.toLowerCase()}</button>
                                </div>
                                <p class="campo-error" id="error-${campo}" role="alert"></p></div>`).join('')}
                        </div>
                        <fieldset class="panel-fieldset negocio-colores">
                            <legend>Colores</legend>
                            <p class="panel-sub" id="colores-ayuda">Elige una combinación o personaliza el color principal (botones y destacados) y el de acento (títulos y detalles). Solo se publican colores legibles sobre el fondo oscuro de la web.</p>
                            <div class="negocio-paletas">${PALETAS.map((p, i) => `
                                <label class="negocio-paleta"><input type="radio" name="paleta" value="${i}" ${paletaActual() === i ? 'checked' : ''}>
                                    <span class="negocio-muestras" aria-hidden="true"><i style="background:${p.principal || COLOR_SITIO.color_principal}"></i><i style="background:${p.acento || COLOR_SITIO.color_acento}"></i></span>${esc(p.nombre)}</label>`).join('')}
                            </div>
                            <div class="panel-rejilla">${[['color_principal', 'Color principal'], ['color_acento', 'Color de acento']].map(([campo, texto]) => `
                                <div class="negocio-color"><label>${texto}<input type="color" name="${campo}" value="${esc(datos[campo] || COLOR_SITIO[campo])}" aria-describedby="contraste-${campo} colores-ayuda"></label>
                                    <p class="negocio-contraste" id="contraste-${campo}" data-contraste="${campo}"></p></div>`).join('')}
                            </div>
                        </fieldset>
                    </fieldset>

                    <fieldset class="panel-fieldset negocio-seccion">
                        <legend>Contacto y redes</legend>
                        <div class="panel-rejilla">
                            <label>WhatsApp<input name="whatsapp" inputmode="tel" value="${esc(datos.whatsapp)}" placeholder="18291234567"></label>
                            <label>Teléfono<input name="telefono" inputmode="tel" value="${esc(datos.telefono)}"></label>
                            <label>Correo (opcional)<input name="correo" type="email" maxlength="120" value="${esc(datos.correo)}" autocomplete="off" aria-describedby="error-correo"></label>
                        </div>
                        <p class="campo-error" id="error-correo" role="alert"></p>
                        <p class="panel-sub negocio-direccion">La dirección y el mapa se editan en <button type="button" class="panel-enlace" data-ir-ubicacion>Ubicación y mapa</button>.</p>
                        <fieldset class="panel-fieldset"><legend>Redes sociales (https://)</legend>
                            <div class="panel-rejilla">${Object.entries(REDES).map(([k, v]) => `<label>${v}<input type="url" name="red_${k}" value="${esc(datos.redes[k] || '')}" placeholder="https://"></label>`).join('')}</div>
                        </fieldset>
                    </fieldset>

                    <fieldset class="panel-fieldset negocio-seccion">
                        <legend>Políticas informativas</legend>
                        <div class="negocio-intro"><p class="panel-sub">Se muestran tal cual a los clientes, al reservar y en «Más». Son solo informativas.</p>
                            ${ayuda('Políticas informativas', `<p>El texto se publica como texto plano (sin enlaces ni formato) y no cambia cómo funciona la app: no crea reglas de cancelación, cobros ni penalizaciones.</p>
                                <p>Lo que sí se aplica es el plazo mínimo para cambiar o cancelar en línea (horas_minimas_cambio, en Módulos › general). Procura que el texto coincida con ese plazo.</p>`)}</div>
                        <label>Reservas<textarea name="politica_reservas" rows="3" maxlength="${LIMITE_POLITICA}" aria-describedby="limite-politicas">${esc(datos.politica_reservas)}</textarea></label>
                        <label>Cambios y cancelaciones<textarea name="politica_cancelacion" rows="3" maxlength="${LIMITE_POLITICA}" aria-describedby="limite-politicas">${esc(datos.politica_cancelacion)}</textarea></label>
                        <p class="panel-sub" id="limite-politicas">Hasta ${LIMITE_POLITICA} caracteres cada una.</p>
                    </fieldset>

                    <label>Horarios públicos (una línea por renglón)<textarea name="horarios_publicos" rows="3">${esc(datos.horarios_publicos.join('\n'))}</textarea></label>
                    <p class="panel-sub">Solo informativo. Las horas reservables se configuran en Horarios.</p>
                    <fieldset class="panel-fieldset"><legend>Preguntas frecuentes</legend>
                        <div data-faq></div>
                        <button type="button" class="panel-btn panel-btn-mini" data-agregar-faq><i class="fas fa-plus"></i> Agregar pregunta</button>
                    </fieldset>
                    <p class="negocio-pendiente" role="status" data-pendiente></p>
                    <div class="panel-acciones">
                        <button type="button" class="panel-btn" data-descartar>Descartar cambios</button>
                        <button type="submit" class="panel-btn panel-btn-principal"><i class="fas fa-upload"></i> Publicar</button>
                    </div>
                </form>
                <aside class="panel-caja negocio-preview" aria-label="Vista previa">
                    <h3>Vista previa</h3>
                    <p class="panel-sub">Solo en este navegador, sin publicar.</p>
                    <style data-preview-colores></style>
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
    cont.querySelector('[data-ir-ubicacion]').addEventListener('click', () => { mostrarSub('ubicacion'); cont.querySelector('[data-sub="ubicacion"]').focus(); });
    if (opciones.sub === 'ubicacion') mostrarSub('ubicacion');

    const faq = cont.querySelector('[data-faq]');
    const pintarFaq = () => {
        faq.innerHTML = datos.faq.map((f, i) => `<div class="negocio-faq" data-i="${i}">
            <input data-campo="pregunta" maxlength="160" value="${esc(f.pregunta)}" placeholder="Pregunta" aria-label="Pregunta ${i + 1}">
            <textarea data-campo="respuesta" rows="2" maxlength="600" placeholder="Respuesta" aria-label="Respuesta ${i + 1}">${esc(f.respuesta)}</textarea>
            <button type="button" class="panel-icono" data-quitar-faq="${i}" aria-label="Quitar pregunta ${i + 1}"><i class="fas fa-trash" aria-hidden="true"></i></button></div>`).join('');
    };
    const leer = () => {
        const d = new FormData(form);
        datos.nombre = d.get('nombre').trim();
        datos.descripcion = d.get('descripcion').trim();
        datos.whatsapp = d.get('whatsapp').trim();
        datos.telefono = d.get('telefono').trim();
        datos.correo = d.get('correo').trim();
        datos.politica_reservas = d.get('politica_reservas').trim();
        datos.politica_cancelacion = d.get('politica_cancelacion').trim();
        datos.horarios_publicos = d.get('horarios_publicos').split('\n').map(l => l.trim()).filter(Boolean);
        Object.keys(REDES).forEach(k => { datos.redes[k] = d.get(`red_${k}`).trim(); });
        datos.faq = [...faq.querySelectorAll('.negocio-faq')].map(f => ({ pregunta: f.querySelector('[data-campo="pregunta"]').value.trim(), respuesta: f.querySelector('[data-campo="respuesta"]').value.trim() }));
    };
    const pintarColores = () => {
        ['color_principal', 'color_acento'].forEach(campo => {
            const valor = datos[campo] || COLOR_SITIO[campo];
            form.elements[campo].value = valor;
            const nota = cont.querySelector(`[data-contraste="${campo}"]`);
            nota.innerHTML = textoContraste(valor);
            nota.classList.toggle('negocio-contraste-bajo', !colorLegible(valor));
            form.elements[campo].setAttribute('aria-invalid', String(!colorLegible(valor)));
        });
        const i = paletaActual();
        form.querySelectorAll('[name="paleta"]').forEach(r => { r.checked = Number(r.value) === i; });
    };
    const pintarPreview = () => {
        cont.querySelectorAll('[data-img]').forEach(el => {
            const url = datos[el.dataset.img];
            el.innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span class="panel-sub">Sin imagen (la web usa la suya por defecto)</span>';
        });
        const redes = Object.entries(datos.redes).filter(([, v]) => v);
        const politicas = [['Reservas', datos.politica_reservas], ['Cambios y cancelaciones', datos.politica_cancelacion]].filter(([, t]) => t);
        // Los colores solo se aplican dentro de la vista previa (ningún otro usuario los ve)
        cont.querySelector('[data-preview-colores]').textContent = cssColores({ principal: datos.color_principal, acento: datos.color_acento }, '.negocio-preview .preview-sitio');
        cont.querySelector('[data-preview]').innerHTML = `
            <div class="preview-sitio">
                <header class="preview-cabecera">${datos.logo_url ? `<img src="${esc(datos.logo_url)}" alt="" class="preview-logo">` : '<i class="fas fa-scissors"></i>'}<strong>${esc(datos.nombre || 'Tu barbería')}</strong></header>
                <div class="preview-portada" ${datos.portada_url ? `style="background-image:url('${esc(datos.portada_url)}')"` : ''}><p>${esc(datos.descripcion)}</p></div>
                <div class="preview-bloque preview-acciones"><span class="preview-eyebrow">TU PRÓXIMA VISITA</span><span class="preview-boton">Reservar ahora</span></div>
                <div class="preview-bloque"><h4>Horarios</h4>${datos.horarios_publicos.map(h => `<p>${esc(h)}</p>`).join('') || '<p class="panel-sub">Sin horarios</p>'}</div>
                <div class="preview-bloque"><h4>Contacto</h4>
                    ${datos.whatsapp ? `<p><i class="fab fa-whatsapp"></i> ${esc(datos.whatsapp)}</p>` : ''}
                    ${datos.telefono ? `<p><i class="fas fa-phone"></i> ${esc(datos.telefono)}</p>` : ''}
                    ${datos.correo ? `<p><i class="fas fa-envelope"></i> ${esc(datos.correo)}</p>` : ''}
                    ${redes.map(([k, v]) => `<p><i class="fab fa-${k}"></i> ${esc(v)}</p>`).join('')}</div>
                ${politicas.length ? `<div class="preview-bloque"><h4>Políticas</h4>${politicas.map(([t, x]) => `<p><strong>${esc(t)}:</strong></p><p class="politica-texto">${esc(x)}</p>`).join('')}</div>` : ''}
                ${datos.faq.length ? `<div class="preview-bloque"><h4>Preguntas frecuentes</h4>${datos.faq.map(f => `<details><summary>${esc(f.pregunta)}</summary><p>${esc(f.respuesta)}</p></details>`).join('')}</div>` : ''}
            </div>`;
        const pendiente = JSON.stringify(datos) !== inicial;
        cont.querySelector('[data-pendiente]').innerHTML = pendiente ? '<i class="fas fa-pen" aria-hidden="true"></i> Hay cambios sin publicar.' : '';
    };
    pintarFaq();
    pintarColores();
    pintarPreview();

    form.addEventListener('input', e => {
        if (e.target.name === 'paleta') {
            const p = PALETAS[Number(e.target.value)];
            datos.color_principal = p.principal;
            datos.color_acento = p.acento;
        } else if (e.target.type === 'color') datos[e.target.name] = e.target.value;
        if (e.target.name === 'correo') cont.querySelector('#error-correo').textContent = '';
        leer();
        if (e.target.name === 'paleta' || e.target.type === 'color') pintarColores();
        pintarPreview();
    });
    cont.querySelector('[data-agregar-faq]').addEventListener('click', () => { leer(); datos.faq.push({ pregunta: '', respuesta: '' }); pintarFaq(); pintarPreview(); faq.querySelector('.negocio-faq:last-child input')?.focus(); });
    faq.addEventListener('click', e => {
        const b = e.target.closest('[data-quitar-faq]');
        if (!b) return;
        leer();
        datos.faq.splice(Number(b.dataset.quitarFaq), 1);
        pintarFaq();
        pintarPreview();
        cont.querySelector('[data-agregar-faq]').focus();
    });
    cont.querySelectorAll('[data-subir]').forEach(input => input.addEventListener('change', async () => {
        const archivo = input.files[0];
        const campo = input.dataset.subir;
        const error = cont.querySelector(`#error-${campo}`);
        error.textContent = '';
        if (!archivo) return;
        try {
            await validarImagen(archivo, campo);
            datos[campo] = await imagenADataURL(archivo, IMAGENES[campo].lado);
            pintarPreview();
        } catch (e) { error.textContent = e.message; }
        finally { input.value = ''; }
    }));
    cont.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => { datos[b.dataset.quitar] = ''; cont.querySelector(`#error-${b.dataset.quitar}`).textContent = ''; pintarPreview(); }));
    cont.querySelector('[data-descartar]').addEventListener('click', () => renderNegocio(cont, ctx));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        leer();
        const invalida = Object.values(datos.redes).find(v => v && !/^https:\/\//.test(v));
        if (invalida) { ctx.notificar('Los enlaces de redes deben empezar con https://', 'error'); return; }
        if (datos.faq.some(f => !f.pregunta || !f.respuesta)) { ctx.notificar('Completa o quita las preguntas frecuentes vacías.', 'error'); return; }
        if (datos.correo && !form.elements.correo.checkValidity()) {
            cont.querySelector('#error-correo').textContent = 'Escribe un correo válido (por ejemplo, nombre@dominio.com) o déjalo vacío.';
            form.elements.correo.focus();
            return;
        }
        const ilegible = ['color_principal', 'color_acento'].find(c => !colorLegible(datos[c]));
        if (ilegible) { ctx.notificar('Elige colores con contraste suficiente (mínimo 4.5:1) antes de publicar.', 'error'); form.elements[ilegible].focus(); return; }
        const guardado = await ejecutar(e.submitter, () => api('panel_guardar_negocio', { p_datos: datos }), ctx.notificar, 'Publicado: la web mostrará estos datos al recargarse');
        if (guardado) renderNegocio(cont, ctx);
    });
}
