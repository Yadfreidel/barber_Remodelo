// ==========================================
// PANEL: EDITOR DE FOTOS DE «ESTILOS DE LA CASA»
// Recorte (proporción, zoom y encuadre), giro, brillo/contraste/saturación, punto focal y marca opcional.
// Todo con canvas, sin servicios externos. Los ajustes se aplican a los archivos publicados (no solo a la vista):
// al recodificar se respeta la orientación EXIF y se eliminan los metadatos (ubicación incluida).
// El original nunca se modifica: se guarda aparte, privado, y se vuelve a usar para cada edición.
// ==========================================

import { dialogo, esc } from './comun.js';

export const PESO_MAXIMO = 8 * 1024 * 1024;
export const AJUSTES_INICIALES = Object.freeze({ giro: 0, proporcion: '4:5', zoom: 1, cx: 0.5, cy: 0.5, brillo: 0, contraste: 0, saturacion: 0, foco_x: 50, foco_y: 50, marca: 'ninguna' });
const PROPORCIONES = { '4:5': ['Vertical 4:5 (recomendada)', 4 / 5], '1:1': ['Cuadrada 1:1', 1], '3:4': ['Vertical 3:4', 3 / 4], original: ['Original', null] };
// Versiones publicables: lado mayor y tamaño máximo aceptado por el servidor
const VERSIONES = { imagen: [1600, 900000], tarjeta: [960, 400000], miniatura: [480, 150000] };

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

// ---------- Carga ----------
// Valida formato y peso, y devuelve el original (data URL privado) y la imagen ya orientada según EXIF
export async function leerArchivo(archivo) {
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) throw new Error(`«${archivo.name}»: usa JPG, PNG o WebP (no se admiten SVG, HEIC ni otros archivos).`);
    if (archivo.size > PESO_MAXIMO) throw new Error(`«${archivo.name}» pesa más de 8 MB.`);
    const bitmap = await decodificar(archivo).catch(() => { throw new Error(`«${archivo.name}» no se pudo leer: puede estar dañada o no ser una imagen.`); });
    if (bitmap.width < 300 || bitmap.height < 300) throw new Error(`«${archivo.name}» es demasiado pequeña (${bitmap.width} × ${bitmap.height} px; mínimo 300 × 300).`);
    const original = await new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(lector.result);
        lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
        lector.readAsDataURL(archivo);
    });
    return { original, bitmap };
}

export async function bitmapDesdeDataURL(url) {
    return decodificar(await (await fetch(url)).blob());
}

async function decodificar(blob) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch {
        // Navegadores sin opciones en createImageBitmap: la etiqueta <img> ya aplica la orientación EXIF
        const url = URL.createObjectURL(blob);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } finally { URL.revokeObjectURL(url); }
    }
}

// ---------- Render ----------
function girada(fuente, giro) {
    const w = fuente.width, h = fuente.height;
    const lado = giro % 180 === 0;
    const c = document.createElement('canvas');
    c.width = lado ? w : h;
    c.height = lado ? h : w;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((giro * Math.PI) / 180);
    ctx.drawImage(fuente, -w / 2, -h / 2);
    return c;
}

export function recorte(W, H, aj) {
    const a = PROPORCIONES[aj.proporcion]?.[1] ?? W / H;
    let w, h;
    if (W / H > a) { h = H; w = H * a; } else { w = W; h = W / a; }
    w /= aj.zoom; h /= aj.zoom;
    return { x: limitar(aj.cx * W - w / 2, 0, W - w), y: limitar(aj.cy * H - h / 2, 0, H - h), w, h };
}

// Brillo, contraste y saturación sobre los píxeles (el archivo publicado lleva el ajuste)
function filtrar(ctx, w, h, aj) {
    if (!aj.brillo && !aj.contraste && !aj.saturacion) return;
    const datos = ctx.getImageData(0, 0, w, h);
    const p = datos.data;
    const b = aj.brillo * 2.55;
    const c = aj.contraste * 2.55;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    const s = 1 + aj.saturacion / 100;
    for (let i = 0; i < p.length; i += 4) {
        let r = f * (p[i] - 128) + 128 + b, g = f * (p[i + 1] - 128) + 128 + b, bl = f * (p[i + 2] - 128) + 128 + b;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        p[i] = l + (r - l) * s; p[i + 1] = l + (g - l) * s; p[i + 2] = l + (bl - l) * s;
    }
    ctx.putImageData(datos, 0, 0);
}

// Marca discreta en la esquina inferior derecha: nombre del barbero o logo real del negocio
function marcar(ctx, w, h, aj, marca) {
    const margen = Math.round(w * 0.035);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = Math.max(2, w * 0.006);
    if (aj.marca === 'logo' && marca.logo) {
        const alto = Math.round(h * 0.07);
        const ancho = Math.min(w * 0.3, alto * (marca.logo.width / marca.logo.height));
        ctx.drawImage(marca.logo, w - ancho - margen, h - alto - margen, ancho, ancho / (marca.logo.width / marca.logo.height));
    } else if (aj.marca === 'nombre' && marca.nombre) {
        ctx.font = `600 ${Math.max(12, Math.round(w * 0.032))}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(marca.nombre, w - margen, h - margen);
    }
    ctx.restore();
}

export function renderizar(fuenteGirada, aj, lado, marca = {}) {
    const r = recorte(fuenteGirada.width, fuenteGirada.height, aj);
    const escala = Math.min(1, lado / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * escala));
    c.height = Math.max(1, Math.round(r.h * escala));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuenteGirada, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    filtrar(ctx, c.width, c.height, aj);
    if (aj.marca !== 'ninguna') marcar(ctx, c.width, c.height, aj, marca);
    return c;
}

function codificar(lienzo, maximo) {
    for (const calidad of [0.84, 0.74, 0.62, 0.5, 0.4]) {
        const webp = lienzo.toDataURL('image/webp', calidad);
        const url = webp.startsWith('data:image/webp') ? webp : lienzo.toDataURL('image/jpeg', calidad); // Safari antiguo: JPEG
        if (url.length <= maximo) return url;
    }
    throw new Error('La foto no se pudo reducir lo suficiente. Prueba con otra.');
}

// Versiones publicables (sin metadatos) con los ajustes aplicados
export async function exportar(fuente, aj, marca = {}) {
    const base = girada(fuente, aj.giro);
    const salida = { ajustes: { ...aj }, foco_x: Math.round(aj.foco_x), foco_y: Math.round(aj.foco_y) };
    for (const [nombre, [lado, maximo]] of Object.entries(VERSIONES)) {
        const lienzo = renderizar(base, aj, lado, marca);
        salida[nombre] = codificar(lienzo, maximo);
        if (nombre === 'imagen') { salida.ancho = lienzo.width; salida.alto = lienzo.height; }
        await new Promise(r => setTimeout(r, 0)); // no bloquea la interfaz entre versiones
    }
    return salida;
}

// ---------- Interfaz ----------
// Devuelve los ajustes aplicados, o null si se cancela. No toca el original.
export function abrirEditorFoto({ fuente, ajustes = AJUSTES_INICIALES, marca = {}, titulo = 'Editar foto' }) {
    return new Promise(resolver => {
        let aj = { ...AJUSTES_INICIALES, ...ajustes };
        const historial = [];
        let base = girada(fuente, aj.giro);
        let resuelto = false;
        const deslizador = (nombre, texto, min, max, paso) => `<label class="editor-rango">${texto}
            <input type="range" name="${nombre}" min="${min}" max="${max}" step="${paso}" value="${aj[nombre]}"><output data-salida="${nombre}"></output></label>`;
        const { cuerpo, cerrar, fondo } = dialogo({ titulo, ancho: 'lg', clase: 'editor-foto-dialogo', html: `
            <div class="editor-foto">
                <div class="editor-vista">
                    <div class="editor-lienzo" data-lienzo><canvas data-vista aria-label="Vista previa de la foto editada" role="img"></canvas>
                        <span class="editor-foco" data-marcador aria-hidden="true"></span></div>
                    <p class="panel-sub">Arrastra la foto para encuadrarla. Toca un punto para marcarlo como punto focal (lo que siempre se verá en las tarjetas).</p>
                </div>
                <form class="editor-controles panel-form" novalidate>
                    <fieldset class="panel-fieldset"><legend>Encuadre</legend>
                        <label>Proporción<select name="proporcion">${Object.entries(PROPORCIONES).map(([k, [t]]) => `<option value="${k}" ${aj.proporcion === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                        ${deslizador('zoom', 'Zoom', 1, 4, 0.05)}${deslizador('cx', 'Horizontal', 0, 1, 0.01)}${deslizador('cy', 'Vertical', 0, 1, 0.01)}
                        <div class="editor-botones"><button type="button" class="panel-btn" data-girar="-90"><i class="fas fa-rotate-left" aria-hidden="true"></i> Girar a la izquierda</button>
                            <button type="button" class="panel-btn" data-girar="90"><i class="fas fa-rotate-right" aria-hidden="true"></i> Girar a la derecha</button></div>
                    </fieldset>
                    <fieldset class="panel-fieldset"><legend>Ajustes de imagen</legend>
                        ${deslizador('brillo', 'Brillo', -50, 50, 1)}${deslizador('contraste', 'Contraste', -50, 50, 1)}${deslizador('saturacion', 'Saturación', -50, 50, 1)}
                    </fieldset>
                    <fieldset class="panel-fieldset"><legend>Punto focal</legend>
                        ${deslizador('foco_x', 'Horizontal (%)', 0, 100, 1)}${deslizador('foco_y', 'Vertical (%)', 0, 100, 1)}
                    </fieldset>
                    <label>Marca discreta<select name="marca"><option value="ninguna">Sin marca</option>
                        ${marca.nombre ? `<option value="nombre" ${aj.marca === 'nombre' ? 'selected' : ''}>Nombre: ${esc(marca.nombre)}</option>` : ''}
                        ${marca.logo ? `<option value="logo" ${aj.marca === 'logo' ? 'selected' : ''}>Logo del negocio</option>` : ''}</select></label>
                    <div class="editor-botones"><button type="button" class="panel-btn" data-deshacer disabled><i class="fas fa-rotate-left" aria-hidden="true"></i> Deshacer</button>
                        <button type="button" class="panel-btn" data-restablecer>Volver al original</button></div>
                    <div class="panel-acciones"><button type="button" class="panel-btn" data-cancelar>Cancelar</button>
                        <button type="submit" class="panel-btn panel-btn-principal">Aplicar</button></div>
                </form>
            </div>` });
        const form = cuerpo.querySelector('form');
        const vista = cuerpo.querySelector('[data-vista]');
        const marcador = cuerpo.querySelector('[data-marcador]');
        let pendiente = false;
        const pintar = () => {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(() => {
                pendiente = false;
                const lienzo = renderizar(base, aj, 720, marca);
                vista.width = lienzo.width;
                vista.height = lienzo.height;
                vista.getContext('2d').drawImage(lienzo, 0, 0);
                marcador.style.left = `${aj.foco_x}%`;
                marcador.style.top = `${aj.foco_y}%`;
            });
        };
        const sincronizar = () => {
            for (const nombre of ['zoom', 'cx', 'cy', 'brillo', 'contraste', 'saturacion', 'foco_x', 'foco_y']) {
                form.elements[nombre].value = aj[nombre];
                const salida = form.querySelector(`[data-salida="${nombre}"]`);
                salida.textContent = nombre === 'zoom' ? `${Number(aj.zoom).toFixed(2)}×` : ['cx', 'cy'].includes(nombre) ? `${Math.round(aj[nombre] * 100)}%`
                    : ['foco_x', 'foco_y'].includes(nombre) ? `${Math.round(aj[nombre])}%` : `${aj[nombre] > 0 ? '+' : ''}${aj[nombre]}`;
            }
            form.elements.proporcion.value = aj.proporcion;
            form.elements.marca.value = aj.marca;
            cuerpo.querySelector('[data-deshacer]').disabled = !historial.length;
            pintar();
        };
        const recordar = () => { historial.push({ ...aj }); if (historial.length > 50) historial.shift(); };
        form.addEventListener('focusin', e => { if (e.target.matches('input, select')) e.target.dataset.antes = JSON.stringify(aj); });
        form.addEventListener('input', e => {
            const n = e.target.name;
            if (!n) return;
            aj = { ...aj, [n]: ['proporcion', 'marca'].includes(n) ? e.target.value : Number(e.target.value) };
            sincronizar();
        });
        // Un paso de «deshacer» por cada cambio terminado (no por cada píxel del deslizador)
        form.addEventListener('change', e => {
            if (!e.target.name) return;
            const antes = e.target.dataset.antes ? JSON.parse(e.target.dataset.antes) : null;
            if (antes) { historial.push(antes); e.target.dataset.antes = JSON.stringify(aj); }
            cuerpo.querySelector('[data-deshacer]').disabled = !historial.length;
        });
        cuerpo.querySelectorAll('[data-girar]').forEach(b => b.addEventListener('click', () => {
            recordar();
            aj = { ...aj, giro: (aj.giro + Number(b.dataset.girar) + 360) % 360, cx: 0.5, cy: 0.5 };
            base = girada(fuente, aj.giro);
            sincronizar();
        }));
        cuerpo.querySelector('[data-deshacer]').addEventListener('click', () => {
            const previo = historial.pop();
            if (!previo) return;
            if (previo.giro !== aj.giro) base = girada(fuente, previo.giro);
            aj = previo;
            sincronizar();
        });
        cuerpo.querySelector('[data-restablecer]').addEventListener('click', () => {
            recordar();
            if (aj.giro) base = girada(fuente, 0);
            aj = { ...AJUSTES_INICIALES };
            sincronizar();
        });
        // Arrastrar encuadra; un toque sin arrastre marca el punto focal
        const lienzo = cuerpo.querySelector('[data-lienzo]');
        let arrastre = null;
        lienzo.addEventListener('pointerdown', e => {
            arrastre = { x: e.clientX, y: e.clientY, movido: false, inicio: { ...aj } };
            lienzo.setPointerCapture(e.pointerId);
        });
        lienzo.addEventListener('pointermove', e => {
            if (!arrastre) return;
            const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
            if (!arrastre.movido && Math.hypot(dx, dy) < 6) return;
            arrastre.movido = true;
            const caja = vista.getBoundingClientRect();
            const r = recorte(base.width, base.height, arrastre.inicio);
            aj = { ...aj, cx: limitar(arrastre.inicio.cx - (dx / caja.width) * (r.w / base.width), 0, 1), cy: limitar(arrastre.inicio.cy - (dy / caja.height) * (r.h / base.height), 0, 1) };
            sincronizar();
        });
        lienzo.addEventListener('pointerup', e => {
            if (!arrastre) return;
            const caja = vista.getBoundingClientRect();
            historial.push(arrastre.inicio);
            if (!arrastre.movido) aj = { ...aj, foco_x: limitar(((e.clientX - caja.left) / caja.width) * 100, 0, 100), foco_y: limitar(((e.clientY - caja.top) / caja.height) * 100, 0, 100) };
            arrastre = null;
            sincronizar();
        });
        lienzo.addEventListener('pointercancel', () => { arrastre = null; });
        const terminar = valor => { if (resuelto) return; resuelto = true; resolver(valor); };
        cuerpo.querySelector('[data-cancelar]').addEventListener('click', () => { cerrar(); terminar(null); });
        form.addEventListener('submit', e => { e.preventDefault(); cerrar(); terminar({ ...aj }); });
        // Cerrar con Escape o la X equivale a cancelar
        new MutationObserver((_, obs) => { if (!fondo.isConnected) { obs.disconnect(); terminar(null); } }).observe(document.body, { childList: true });
        sincronizar();
        form.elements.proporcion.focus();
    });
}
