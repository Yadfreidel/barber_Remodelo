// ==========================================
// ESTILOS DE LA CASA (web pública)
// Galería de trabajos publicados por los barberos (los mismos del portafolio y del perfil).
// Sección del inicio, «Ver todos» (galería paginada) y detalle con carrusel manual.
// Las fotos se piden por separado y solo al acercarse a la pantalla; nunca se piden originales.
// ==========================================

import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { obtenerBarberos } from '../models/barberModel.js';
import { obtenerServicios } from '../models/serviceModel.js';
import { escapar as esc } from '../assets/catalogue-ui.js';
import { abrirPerfilBarbero } from './perfilBarberoController.js';

const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fotos = new Map(); // «id|tamaño» → promesa de data URL (una sola petición por foto y tamaño)

// ---------- Datos ----------
async function pedirEstilos(barbero, limite, desde) {
    const { data, error } = await supabase.rpc('estilos_publicos', { p_barbero: barbero || null, p_limite: limite, p_desde: desde });
    if (error) throw error;
    return data;
}

function pedirFoto(id, tam) {
    const clave = `${id}|${tam}`;
    if (!fotos.has(clave)) {
        fotos.set(clave, Promise.resolve(supabase.rpc('estilo_foto', { p_id: id, p_tam: tam }))
            .then(({ data, error }) => { if (error || !data) throw error || new Error('sin_foto'); return data; })
            .catch(e => { fotos.delete(clave); throw e; }));
    }
    return fotos.get(clave);
}

const barberoDe = id => obtenerBarberos().find(b => String(b.barbero_id) === String(id));
const primerNombre = nombre => String(nombre || '').split(' ')[0];

// ---------- Imágenes diferidas ----------
// Tamaño según el ancho real en pantalla (densidad incluida): miniatura 480 px, tarjeta 960 px, detalle 1600 px
function tamPara(img, detalle = false) {
    if (detalle) return 'imagen';
    const necesario = (img.getBoundingClientRect().width || 320) * Math.min(window.devicePixelRatio || 1, 2.5);
    return necesario > 480 ? 'tarjeta' : 'miniatura';
}

async function cargarImagen(img, detalle = false) {
    if (img.dataset.estado) return;
    img.dataset.estado = 'cargando';
    try {
        const url = await (img.dataset.fuente ? Promise.resolve(img.dataset.fuente) : pedirFoto(img.dataset.foto, tamPara(img, detalle)));
        img.addEventListener('load', () => img.closest('.estilo-media, .carrusel-diapositiva')?.classList.add('cargada'), { once: true });
        img.src = url;
        img.dataset.estado = 'lista';
    } catch {
        img.dataset.estado = 'error';
        img.closest('.estilo-media, .carrusel-diapositiva')?.classList.add('sin-foto');
    }
}

// ---------- Plantillas ----------
function avatar(barbero, clase = 'estilo-avatar') {
    const b = barberoDe(barbero.barbero_id ?? barbero.id);
    return b?.imagen ? `<img class="${clase}" src="${esc(b.imagen)}" alt="" width="32" height="32" loading="lazy" decoding="async">`
        : `<span class="${clase} estilo-avatar-vacio" aria-hidden="true">${esc(iniciales(barbero.nombre || barbero.barbero))}</span>`;
}
const iniciales = nombre => String(nombre || '').split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase();

// Una diapositiva por trabajo (sus fotos adicionales se ven en «Ver trabajo»)
function diapositiva(t, i, total) {
    const p = t.portada;
    return `<li class="estilo-slide" data-indice="${i}" aria-roledescription="trabajo" aria-label="${i + 1} de ${total}">
        <article class="estilo-tarjeta" aria-labelledby="estilo-t-${esc(t.id)}">
            <div class="estilo-media" data-ver="${esc(t.id)}">
                <img data-foto="${esc(p.id)}" alt="${esc(t.texto_alternativo)}" width="${Number(p.ancho)}" height="${Number(p.alto)}"
                     style="object-position:${Number(p.foco_x)}% ${Number(p.foco_y)}%" decoding="async">
                ${t.fotos > 1 ? `<span class="estilo-cantidad"><i class="fas fa-images" aria-hidden="true"></i> ${Number(t.fotos)}<span class="sr-only"> fotos</span></span>` : ''}
            </div>
            <div class="estilo-pie">
                <h4 id="estilo-t-${esc(t.id)}">${esc(t.titulo)}</h4>
                <div class="estilo-pie-fila">
                    <p class="estilo-autor">${avatar({ barbero_id: t.barbero_id, nombre: t.barbero })}<span>Realizado por ${esc(t.barbero)}</span></p>
                    <button type="button" class="estilo-ver" data-ver="${esc(t.id)}">Ver trabajo<span class="sr-only">: ${esc(t.titulo)}</span> <i class="fas fa-chevron-right" aria-hidden="true"></i></button>
                </div>
            </div>
        </article></li>`;
}

const esqueleto = `<li class="estilo-slide estilo-esqueleto" aria-hidden="true"><div class="estilo-tarjeta">
    <div class="estilo-media motion-skeleton"></div><div class="estilo-pie"><span class="esq-linea motion-skeleton"></span><span class="esq-linea corta motion-skeleton"></span></div></div></li>`;

// ---------- Sección del inicio: un barbero a la vez y sus trabajos de uno en uno ----------
const POR_BARBERO = 24;          // máximo que devuelve la consulta pública por página
const PUNTOS_VISIBLES = 7;       // con muchos trabajos, los puntos se limitan; el contador sigue siendo real
let seccion = null;
let estadoSeccion = { barbero: '', trabajos: [], actual: 0, turno: 0 };

export function crearSeccionEstilos() {
    seccion = document.createElement('section');
    seccion.id = 'estilos-casa';
    seccion.className = 'estilos-casa';
    seccion.setAttribute('aria-labelledby', 'estilos-titulo');
    seccion.innerHTML = `<div class="estilos-contenido">
        <div class="estilos-cabecera">
            <h2 id="estilos-titulo">Estilos de la casa</h2>
            <p class="estilos-sub">Elige un barbero y descubre sus trabajos.</p>
        </div>
        <div class="estilos-selector">
            <button type="button" class="selector-flecha anterior" data-desplazar="-1" aria-label="Ver barberos anteriores" hidden><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
            <div class="estilos-barberos" role="group" aria-label="Elige un barbero" data-barberos></div>
            <button type="button" class="selector-flecha siguiente" data-desplazar="1" aria-label="Ver más barberos" hidden><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
        </div>
        <div class="estilos-trabajos" aria-labelledby="estilos-trabajos-titulo">
            <div class="estilos-trabajos-cabecera">
                <h3 id="estilos-trabajos-titulo" data-titulo-trabajos>Trabajos</h3>
                <span class="estilos-contador" data-contador aria-hidden="true"></span>
            </div>
            <div class="estilos-carrusel" aria-roledescription="carrusel" aria-labelledby="estilos-trabajos-titulo">
                <ul class="estilos-pista" data-pista aria-busy="true">${esqueleto}</ul>
                <button type="button" class="carrusel-flecha anterior" data-paso="-1" aria-label="Trabajo anterior" hidden><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
                <button type="button" class="carrusel-flecha siguiente" data-paso="1" aria-label="Trabajo siguiente" hidden><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
            </div>
            <div class="estilos-puntos" data-puntos></div>
            <p class="estilos-ayuda" data-ayuda hidden></p>
            <p class="sr-only" role="status" data-anuncio></p>
        </div>
    </div>`;
    // Entrada suave al aparecer en pantalla (una vez)
    if ('IntersectionObserver' in window && !reducido()) {
        const entrada = new IntersectionObserver(([e]) => { if (e.isIntersecting) { seccion.classList.add('estilos-visible'); entrada.disconnect(); } }, { threshold: 0.12 });
        entrada.observe(seccion);
    } else seccion.classList.add('estilos-visible');
    conectarSeccion();
    return seccion;
}

const $s = sel => seccion.querySelector(sel);

function conectarSeccion() {
    const fila = $s('[data-barberos]');
    const pista = $s('[data-pista]');
    fila.addEventListener('click', e => {
        const b = e.target.closest('[data-barbero]');
        if (b && b.getAttribute('aria-pressed') !== 'true') elegirBarbero(b.dataset.barbero);
    });
    // Selector: flechas solo si hay barberos fuera de vista
    seccion.querySelectorAll('[data-desplazar]').forEach(b => b.addEventListener('click', () => {
        fila.scrollBy({ left: Number(b.dataset.desplazar) * fila.clientWidth * 0.7, behavior: reducido() ? 'auto' : 'smooth' });
    }));
    fila.addEventListener('scroll', () => requestAnimationFrame(flechasSelector), { passive: true });
    window.addEventListener('resize', () => { flechasSelector(); irA(estadoSeccion.actual, false); });
    // Carrusel: deslizar con el dedo (desplazamiento nativo con «snap», sin bloquear el vertical), flechas y teclado
    let espera, ultimaPos = null;
    const asentar = () => {
        // Mientras dura un desplazamiento pedido con flechas o teclado, manda su destino (pulsaciones rápidas);
        // si el carrusel se detiene en otra posición y ya no se mueve, esa posición es la válida
        if (estadoSeccion.destino !== null && estadoSeccion.destino !== undefined
            && Math.abs(pista.scrollLeft - estadoSeccion.destino * pista.clientWidth) > 2 && pista.scrollLeft !== ultimaPos) {
            ultimaPos = pista.scrollLeft;
            espera = setTimeout(asentar, 140);
            return;
        }
        estadoSeccion.destino = null;
        ultimaPos = null;
        const i = Math.round(pista.scrollLeft / Math.max(pista.clientWidth, 1));
        if (i !== estadoSeccion.actual && estadoSeccion.trabajos.length) marcar(i);
    };
    pista.addEventListener('scroll', () => { clearTimeout(espera); espera = setTimeout(asentar, 80); }, { passive: true });
    // Un gesto del usuario (dedo, rueda o arrastre) recupera el control del carrusel
    ['touchstart', 'pointerdown', 'wheel'].forEach(t => pista.addEventListener(t, () => { estadoSeccion.destino = null; }, { passive: true }));
    seccion.querySelectorAll('[data-paso]').forEach(b => b.addEventListener('click', () => {
        irA(estadoSeccion.actual + Number(b.dataset.paso));
        // En un extremo la flecha se oculta: el foco pasa a la contraria para no perderse
        if (b.hidden) seccion.querySelector(`[data-paso="${-Number(b.dataset.paso)}"]:not([hidden])`)?.focus();
    }));
    pista.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); irA(estadoSeccion.actual + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); irA(estadoSeccion.actual - 1); }
    });
    $s('[data-puntos]').addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) irA(Number(b.dataset.ir)); });
    pista.addEventListener('click', e => {
        const objetivo = e.target.closest('[data-ver]');
        if (objetivo) abrirDetalleEstilo(objetivo.dataset.ver, { origen: pista.querySelector(`button[data-ver="${CSS.escape(objetivo.dataset.ver)}"]`) });
    });
}

function flechasSelector() {
    const fila = $s('[data-barberos]');
    const hayMas = fila.scrollWidth - fila.clientWidth > 2;
    $s('[data-desplazar="-1"]').hidden = !hayMas || fila.scrollLeft <= 2;
    $s('[data-desplazar="1"]').hidden = !hayMas || fila.scrollLeft >= fila.scrollWidth - fila.clientWidth - 2;
}

function pintarBarberos() {
    const barberos = obtenerBarberos().filter(b => b.barbero_id);
    $s('[data-barberos]').innerHTML = barberos.map(b => `<button type="button" class="estilo-barbero" data-barbero="${esc(b.barbero_id)}" aria-pressed="${String(b.barbero_id) === estadoSeccion.barbero}">
        <span class="estilo-barbero-foto">${b.imagen ? `<img src="${esc(b.imagen)}" alt="" width="56" height="56" loading="lazy" decoding="async">` : `<span class="estilo-avatar-vacio" aria-hidden="true">${esc(iniciales(b.nombre))}</span>`}</span>
        <span class="estilo-barbero-nombre">${esc(primerNombre(b.nombre))}</span><span class="sr-only"> ${esc(b.nombre.split(' ').slice(1).join(' '))}</span></button>`).join('');
    requestAnimationFrame(flechasSelector);
    return barberos;
}

// El barbero elegido queda a la vista dentro de la fila (sin mover la página)
function mostrarSeleccionado() {
    const fila = $s('[data-barberos]');
    const b = fila.querySelector('[aria-pressed="true"]');
    if (!b) return;
    const izq = b.getBoundingClientRect().left - fila.getBoundingClientRect().left + fila.scrollLeft, der = izq + b.offsetWidth;
    if (izq < fila.scrollLeft) fila.scrollTo({ left: izq - 8, behavior: reducido() ? 'auto' : 'smooth' });
    else if (der > fila.scrollLeft + fila.clientWidth) fila.scrollTo({ left: der - fila.clientWidth + 8, behavior: reducido() ? 'auto' : 'smooth' });
}

async function elegirBarbero(id) {
    const turno = ++estadoSeccion.turno;
    const b = barberoDe(id);
    estadoSeccion = { ...estadoSeccion, barbero: String(id), trabajos: [], actual: 0, destino: null };
    seccion.querySelectorAll('[data-barbero]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.barbero === String(id))));
    mostrarSeleccionado();
    // Nada del barbero anterior queda visible bajo el nombre nuevo: carga con las mismas dimensiones
    const pista = $s('[data-pista]');
    $s('[data-titulo-trabajos]').textContent = `Trabajos de ${b?.nombre || 'este barbero'}`;
    $s('[data-contador]').textContent = '';
    pista.setAttribute('aria-busy', 'true');
    pista.innerHTML = esqueleto;
    pista.scrollLeft = 0;
    pintarControles();
    let datos;
    try { datos = await pedirEstilos(id, POR_BARBERO, 0); }
    catch (error) {
        if (turno !== estadoSeccion.turno) return;
        // El servidor aún no tiene la galería (migración sin aplicar): la sección no se muestra, sin aviso de error
        if (error?.code === 'PGRST202' || /could not find the function|does not exist/i.test(error?.message || '')) {
            seccion.hidden = true;
            seccion.dataset.sinServidor = 'true';
            return;
        }
        pista.setAttribute('aria-busy', 'false');
        pista.innerHTML = '<li class="estilos-estado"><p>No pudimos cargar los trabajos. Revisa tu conexión.</p><button type="button" class="estilos-boton" data-reintentar>Reintentar</button></li>';
        pista.querySelector('[data-reintentar]').addEventListener('click', () => elegirBarbero(id));
        $s('[data-anuncio]').textContent = 'No pudimos cargar los trabajos.';
        return;
    }
    if (turno !== estadoSeccion.turno) return; // el cliente ya eligió otro barbero
    estadoSeccion.trabajos = datos.trabajos;
    estadoSeccion.total = Number(datos.total);
    pista.setAttribute('aria-busy', 'false');
    pista.classList.remove('estilos-cambio');
    void pista.offsetWidth; // reinicia la transición discreta del cambio de barbero
    pista.classList.add('estilos-cambio');
    if (!datos.trabajos.length) {
        pista.innerHTML = '<li class="estilos-estado"><p>Este barbero todavía no ha publicado trabajos.</p></li>';
        $s('[data-anuncio]').textContent = `${b?.nombre || 'Este barbero'} todavía no ha publicado trabajos.`;
        pintarControles();
        return;
    }
    pista.innerHTML = datos.trabajos.map((t, i) => diapositiva(t, i, datos.trabajos.length)).join('');
    pista.scrollLeft = 0;
    marcar(0);
    $s('[data-anuncio]').textContent = `${datos.trabajos.length} ${datos.trabajos.length === 1 ? 'trabajo' : 'trabajos'} de ${b?.nombre || 'este barbero'}.`;
}

function irA(i, animar = true) {
    const n = estadoSeccion.trabajos.length;
    if (!n) return;
    const destino = Math.max(0, Math.min(n - 1, i));
    const pista = $s('[data-pista]');
    estadoSeccion.destino = destino;
    pista.scrollTo({ left: pista.clientWidth * destino, behavior: animar && !reducido() ? 'smooth' : 'auto' });
    marcar(destino);
}

// Sincroniza contador, puntos, flechas y accesibilidad con el trabajo visible
function marcar(i) {
    const n = estadoSeccion.trabajos.length;
    estadoSeccion.actual = Math.max(0, Math.min(n - 1, i));
    const pista = $s('[data-pista]');
    const enfocada = document.activeElement?.closest?.('.estilo-slide');
    pista.querySelectorAll('.estilo-slide').forEach((s, k) => {
        const visible = k === estadoSeccion.actual;
        s.inert = !visible;                      // los trabajos fuera de vista no reciben foco
        s.setAttribute('aria-hidden', String(!visible));
        // Carga diferida: el visible y sus vecinos
        if (Math.abs(k - estadoSeccion.actual) <= 1) s.querySelectorAll('img[data-foto]:not([data-estado])').forEach(img => cargarImagen(img));
    });
    // El foco estaba en la tarjeta que acaba de quedar oculta: pasa a la misma acción de la tarjeta visible
    if (enfocada?.inert) pista.querySelector('.estilo-slide:not([inert]) .estilo-ver')?.focus({ preventScroll: true });
    pintarControles();
}

function pintarControles() {
    const n = estadoSeccion.trabajos.length, i = estadoSeccion.actual;
    const varios = n > 1;
    $s('[data-contador]').textContent = n ? `${i + 1} / ${n}` : '';
    $s('[data-paso="-1"]').hidden = !varios || i === 0;
    $s('[data-paso="1"]').hidden = !varios || i === n - 1;
    const ayuda = $s('[data-ayuda]');
    ayuda.hidden = !varios;
    ayuda.innerHTML = varios ? `Desliza para ver más estilos de ${esc(primerNombre(barberoDe(estadoSeccion.barbero)?.nombre))} <span aria-hidden="true">→</span>` : '';
    // Puntos: ventana de PUNTOS_VISIBLES alrededor del actual; los extremos se ven más pequeños si hay más
    const puntos = $s('[data-puntos]');
    if (!varios) { puntos.innerHTML = ''; return; }
    const desde = Math.max(0, Math.min(i - Math.floor(PUNTOS_VISIBLES / 2), n - PUNTOS_VISIBLES));
    const hasta = Math.min(n, desde + PUNTOS_VISIBLES);
    let html = '';
    for (let k = desde; k < hasta; k++) {
        const borde = (k === desde && desde > 0) || (k === hasta - 1 && hasta < n);
        html += `<button type="button" data-ir="${k}" class="${borde ? 'punto-borde' : ''}" aria-label="Ver trabajo ${k + 1} de ${n}" ${k === i ? 'aria-current="true"' : ''}></button>`;
    }
    const enfocado = document.activeElement?.closest?.('[data-puntos]') ? document.activeElement.dataset.ir : null;
    puntos.innerHTML = html;
    if (enfocado !== null) (puntos.querySelector(`[data-ir="${i}"]`) || puntos.querySelector('[data-ir]'))?.focus({ preventScroll: true });
}

// Se llama cuando los barberos reales ya están cargados (avatares y selector salen de sus perfiles)
export function iniciarEstilos() {
    if (!seccion) return;
    if (!estaSupabaseListo()) { seccion.hidden = true; seccion.dataset.sinServidor = 'true'; return; }
    const barberos = pintarBarberos();
    if (!barberos.length) {
        $s('[data-pista]').innerHTML = '<li class="estilos-estado"><p>Pronto verás aquí los trabajos de nuestro equipo.</p></li>';
        return;
    }
    // Conserva la selección si el barbero sigue disponible; si no, el primero según el orden existente
    const elegido = barberos.some(b => String(b.barbero_id) === estadoSeccion.barbero) ? estadoSeccion.barbero : String(barberos[0].barbero_id);
    seccion.querySelector(`[data-barbero="${CSS.escape(elegido)}"]`)?.setAttribute('aria-pressed', 'true');
    elegirBarbero(elegido);
}

// ---------- Diálogos: apertura/cierre suaves, Escape, clic fuera y foco devuelto ----------
function conectarDialogo(d) {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrarDialogo(d); });
    d.addEventListener('cancel', e => { e.preventDefault(); cerrarDialogo(d); });
    d.addEventListener('close', () => {
        d.classList.remove('cerrando');
        if (!document.querySelector('dialog[open]')) document.body.classList.remove('detalle-abierto');
        if (d.origen?.isConnected) d.origen.focus({ preventScroll: true });
    });
}
function abrirDialogo(d) {
    d.classList.remove('cerrando');
    if (!d.open) d.showModal();
    document.body.classList.add('detalle-abierto');
}
function cerrarDialogo(d) {
    if (!d.open || d.classList.contains('cerrando')) return;
    if (reducido()) { d.close(); return; }
    d.classList.add('cerrando');
    setTimeout(() => d.close(), 180);
}

// ---------- Detalle del trabajo ----------
let detalle = null;
// id: trabajo publicado. opciones.vista: datos ya preparados (vista previa del panel, con opciones.fuentes por foto)
export async function abrirDetalleEstilo(id, opciones = {}) {
    if (!detalle) {
        detalle = document.createElement('dialog');
        detalle.className = 'estilos-dialogo estilo-detalle';
        detalle.setAttribute('aria-labelledby', 'estilo-detalle-titulo');
        document.body.append(detalle);
        conectarDialogo(detalle);
    }
    detalle.origen = opciones.origen || document.activeElement;
    detalle.innerHTML = `<div class="estilos-dialogo-barra"><span class="estilos-eyebrow">${opciones.vista ? 'Vista previa · no publicada' : 'Estilos de la casa'}</span>
        <button type="button" class="estilos-cerrar" data-cerrar aria-label="Cerrar trabajo"><i class="fas fa-xmark" aria-hidden="true"></i></button></div>
        <div class="estilos-dialogo-cuerpo"><div class="estilo-detalle-cargando" role="status">
            <div class="carrusel-diapositiva motion-skeleton" style="aspect-ratio:4/5"></div><span class="sr-only">Cargando trabajo…</span></div></div>`;
    abrirDialogo(detalle);
    detalle.querySelector('[data-cerrar]').focus();
    let t = opciones.vista || null;
    if (!t) {
        try {
            const { data, error } = await supabase.rpc('estilo_publico', { p_id: id });
            if (error) throw error;
            t = data;
        } catch { t = undefined; }
    }
    if (!detalle.open) return;
    const cuerpo = detalle.querySelector('.estilos-dialogo-cuerpo');
    if (!t) {
        cuerpo.innerHTML = t === null
            ? '<p class="estilos-estado">Este trabajo ya no está disponible.</p>'
            : '<div class="estilos-estado"><p>No pudimos cargar el trabajo.</p><button type="button" class="estilos-boton" data-reintentar>Reintentar</button></div>';
        cuerpo.querySelector('[data-reintentar]')?.addEventListener('click', () => abrirDetalleEstilo(id, opciones));
        return;
    }
    pintarDetalle(cuerpo, t, opciones);
}

function pintarDetalle(cuerpo, t, opciones) {
    const barbero = barberoDe(t.barbero_id);
    // El servicio se muestra solo si sigue en el catálogo actual (el servidor ya descarta los inactivos)
    const servicio = t.servicio && obtenerServicios().some(s => String(s.servicio_id) === String(t.servicio.id) || s.nombre === t.servicio.nombre) ? t.servicio : null;
    const n = t.fotos.length;
    cuerpo.innerHTML = `
        <div class="carrusel" aria-roledescription="carrusel" aria-label="Fotos de ${esc(t.titulo)}">
            <div class="carrusel-pista" data-pista tabindex="0" aria-label="Fotos: usa las flechas para cambiar">
                ${t.fotos.map((f, i) => `<figure class="carrusel-diapositiva" role="group" aria-roledescription="foto" aria-label="${i + 1} de ${n}" style="aspect-ratio:${Number(f.ancho)}/${Number(f.alto)}">
                    <img data-foto="${esc(f.id)}" ${opciones.fuentes?.[f.id] ? `data-fuente="${esc(opciones.fuentes[f.id])}"` : ''}
                         alt="${esc(f.texto_alternativo || t.texto_alternativo)}${n > 1 ? ` (foto ${i + 1} de ${n})` : ''}" width="${Number(f.ancho)}" height="${Number(f.alto)}"
                         style="object-position:${Number(f.foco_x)}% ${Number(f.foco_y)}%" decoding="async"></figure>`).join('')}
            </div>
            ${n > 1 ? `<button type="button" class="carrusel-flecha anterior" data-paso="-1" aria-label="Foto anterior"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
            <button type="button" class="carrusel-flecha siguiente" data-paso="1" aria-label="Foto siguiente"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
            <div class="carrusel-puntos">${t.fotos.map((_, i) => `<button type="button" data-ir="${i}" aria-label="Ver foto ${i + 1} de ${n}" ${i ? '' : 'aria-current="true"'}></button>`).join('')}</div>
            <p class="sr-only" role="status" data-carrusel-estado>Foto 1 de ${n}</p>` : ''}
        </div>
        <div class="estilo-detalle-info">
            <h2 id="estilo-detalle-titulo">${esc(t.titulo)}</h2>
            ${t.descripcion ? `<p class="estilo-descripcion">${esc(t.descripcion)}</p>` : ''}
            ${servicio ? `<p class="estilo-servicio"><i class="fas fa-scissors" aria-hidden="true"></i> Servicio: <strong>${esc(servicio.nombre)}</strong></p>` : ''}
            <div class="estilo-autor-bloque">${avatar({ barbero_id: t.barbero_id, nombre: t.barbero }, 'estilo-avatar grande')}
                <p><span>Realizado por</span><strong>${esc(t.barbero)}</strong></p>
                ${barbero ? `<button type="button" class="estilos-boton secundario" data-perfil>Ver perfil</button>` : ''}</div>
            ${opciones.vista ? '<p class="estilo-nota-vista">Vista previa: así se verá en la web cuando se publique.</p>'
                : `<button type="button" class="btn-primary estilo-reservar" data-reservar>Reservar con ${esc(primerNombre(t.barbero))} <span aria-hidden="true">→</span></button>
                   <p class="estilo-nota">Elegirás servicio, fecha y hora en el formulario de reserva. No se reserva nada hasta que confirmes.</p>`}
        </div>`;
    const pista = cuerpo.querySelector('[data-pista]');
    const imagenes = [...pista.querySelectorAll('img')];
    let actual = 0;
    const cargarCerca = i => [i, i + 1].forEach(k => imagenes[k] && cargarImagen(imagenes[k], true));
    const ir = (i, enfocar = false) => {
        actual = Math.max(0, Math.min(n - 1, i));
        pista.scrollTo({ left: pista.clientWidth * actual, behavior: reducido() ? 'auto' : 'smooth' });
        marcar();
        if (enfocar) pista.focus({ preventScroll: true });
    };
    const marcar = () => {
        cargarCerca(actual);
        cuerpo.querySelectorAll('[data-ir]').forEach((b, k) => { if (k === actual) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
        const estadoFoto = cuerpo.querySelector('[data-carrusel-estado]');
        if (estadoFoto) estadoFoto.textContent = `Foto ${actual + 1} de ${n}`;
        cuerpo.querySelector('[data-paso="-1"]')?.toggleAttribute('disabled', actual === 0);
        cuerpo.querySelector('[data-paso="1"]')?.toggleAttribute('disabled', actual === n - 1);
    };
    // Deslizar con el dedo actualiza los indicadores al terminar el desplazamiento
    let espera;
    pista.addEventListener('scroll', () => {
        clearTimeout(espera);
        espera = setTimeout(() => { const i = Math.round(pista.scrollLeft / Math.max(pista.clientWidth, 1)); if (i !== actual) { actual = i; marcar(); } }, 90);
    }, { passive: true });
    pista.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(actual + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(actual - 1); }
    });
    cuerpo.querySelectorAll('[data-paso]').forEach(b => b.addEventListener('click', () => ir(actual + Number(b.dataset.paso))));
    cuerpo.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ir(Number(b.dataset.ir))));
    marcar();
    cuerpo.querySelector('[data-perfil]')?.addEventListener('click', () => { cerrarDialogo(detalle); setTimeout(() => abrirPerfilBarbero(barbero), 200); });
    // Reserva: el mismo flujo de siempre con el barbero preseleccionado; no crea ni confirma nada
    cuerpo.querySelector('[data-reservar]')?.addEventListener('click', () => {
        if (detalle.open) detalle.close();
        window.dispatchEvent(new CustomEvent('reservar-con-barbero', { detail: { nombre: t.barbero } }));
    });
}
