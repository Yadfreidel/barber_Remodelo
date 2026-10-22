// ==========================================
// VISTA DEL CLIENTE: "Encuéntranos"
// El mapa se carga al acercarse a la sección. La ubicación se vuelve a
// consultar de forma moderada (cada data-intervalo-sync segundos, solo con
// la pestaña visible) para reflejar cambios guardados por el administrador.
// ==========================================

import { obtenerUbicacion, escucharCambiosLocalesUbicacion } from '../models/ubicacionModel.js';
import { urlComoLlegar, firmaUbicacion } from '../models/ubicacionValidacion.js';
import { cargarLeaflet, crearMapa, iconoBarberia } from '../assets/mapaLeaflet.js';

export function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tarjeta reutilizable (también la usa la vista previa del panel admin)
export function htmlTarjetaUbicacion(u, { vistaPrevia = false } = {}) {
    if (!u) {
        return `
            <div class="ubicacion-pendiente">
                <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
                <p>Ubicación pendiente de configurar</p>
            </div>`;
    }
    return `
        <div class="ubicacion-info">
            <h3 class="ubicacion-nombre">${esc(u.nombre)}</h3>
            <p class="ubicacion-direccion"><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${esc(u.direccion)}</p>
            ${u.referencia ? `<p class="ubicacion-referencia"><i class="fas fa-info-circle" aria-hidden="true"></i> ${esc(u.referencia)}</p>` : ''}
            <div class="ubicacion-acciones">
                <a class="btn-ubicacion btn-ubicacion-principal" href="${esc(urlComoLlegar(u))}" target="_blank" rel="noopener noreferrer">
                    <i class="fas fa-route" aria-hidden="true"></i> Cómo llegar
                </a>
                <button type="button" class="btn-ubicacion" data-copiar-direccion ${vistaPrevia ? 'disabled' : ''}>
                    <i class="fas fa-copy" aria-hidden="true"></i> Copiar dirección
                </button>
            </div>
            <p class="ubicacion-aviso" aria-live="polite"></p>
        </div>`;
}

async function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return;
    }
    // Respaldo para http en red local, donde la API del portapapeles no está disponible
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copia_no_disponible');
}

export function inicializarUbicacionCliente() {
    const seccion = document.getElementById('ubicacion-seccion');
    if (!seccion) return;
    const tarjeta = seccion.querySelector('.ubicacion-tarjeta');
    const intervalo = Math.max(5, Number(seccion.dataset.intervaloSync) || 60) * 1000;

    let ubicacion;            // undefined = cargando, null = pendiente
    let cerca = false;        // la sección está cerca del viewport
    let mapa = null;
    let marcador = null;
    let leafletFallo = false;

    function pintar() {
        const contenido = ubicacion === undefined
            ? '<p class="ubicacion-cargando">Cargando ubicación…</p>'
            : htmlTarjetaUbicacion(ubicacion);
        if (mapa) {
            mapa.remove();
            mapa = null;
            marcador = null;
        }
        tarjeta.classList.toggle('ubicacion-tarjeta--pendiente', !ubicacion);
        tarjeta.innerHTML = ubicacion
            ? `${contenido}<div class="ubicacion-mapa" role="region" aria-label="Mapa de ubicación de ${esc(ubicacion.nombre)}"></div>`
            : contenido;

        const copiar = tarjeta.querySelector('[data-copiar-direccion]');
        if (copiar) copiar.addEventListener('click', async () => {
            const aviso = tarjeta.querySelector('.ubicacion-aviso');
            try {
                await copiarTexto(ubicacion.direccion);
                aviso.textContent = 'Dirección copiada.';
            } catch (e) {
                aviso.textContent = 'No se pudo copiar. Mantén presionada la dirección para copiarla.';
            }
            setTimeout(() => { aviso.textContent = ''; }, 3000);
        });
        if (ubicacion && cerca) montarMapa();
    }

    async function montarMapa() {
        const contenedor = tarjeta.querySelector('.ubicacion-mapa');
        if (!contenedor || mapa || leafletFallo) return;
        contenedor.innerHTML = '<p class="ubicacion-mapa-estado">Cargando mapa…</p>';
        let L;
        try {
            L = await cargarLeaflet();
        } catch (e) {
            leafletFallo = true;
            contenedor.innerHTML = '<p class="ubicacion-mapa-estado">No se pudo cargar el mapa. Usa “Cómo llegar”.</p>';
            return;
        }
        if (!contenedor.isConnected || mapa) return;
        contenedor.innerHTML = '';
        const centro = [Number(ubicacion.latitud), Number(ubicacion.longitud)];
        // En pantallas táctiles un dedo desplaza la página; el mapa se mueve con los botones o con dos dedos
        mapa = crearMapa(L, contenedor, centro, 17, { dragging: !L.Browser.mobile, touchZoom: true }, () => {
            contenedor.insertAdjacentHTML('beforeend', '<p class="ubicacion-mapa-error">El mapa no cargó por completo. Revisa tu conexión.</p>');
        });
        marcador = L.marker(centro, { icon: iconoBarberia(L), keyboard: false, title: ubicacion.nombre }).addTo(mapa);
    }

    async function refrescar() {
        try {
            const nueva = await obtenerUbicacion();
            if (ubicacion === undefined || firmaUbicacion(nueva) !== firmaUbicacion(ubicacion)) {
                ubicacion = nueva;
                pintar();
            }
        } catch (e) {
            if (ubicacion === undefined) {
                ubicacion = null;
                pintar();
            }
        }
    }

    pintar();
    refrescar();

    if ('IntersectionObserver' in window) {
        const observador = new IntersectionObserver(entradas => {
            if (entradas.some(e => e.isIntersecting)) {
                cerca = true;
                observador.disconnect();
                if (ubicacion) montarMapa();
            }
        }, { rootMargin: '300px 0px' });
        observador.observe(seccion);
    } else {
        cerca = true;
    }

    setInterval(() => {
        if (document.visibilityState === 'visible') refrescar();
    }, intervalo);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refrescar();
    });
    escucharCambiosLocalesUbicacion(refrescar);
}
