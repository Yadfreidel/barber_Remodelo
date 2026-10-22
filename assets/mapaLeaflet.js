// ==========================================
// MAPA (Leaflet + OpenStreetMap, sin claves)
// Leaflet se descarga solo cuando hace falta (nunca en la carga inicial).
// Teselas de tile.openstreetmap.org: créditos visibles, sin precarga ni descargas masivas.
// ==========================================

const LEAFLET = {
    css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    cssIntegridad: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
    js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    jsIntegridad: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
};

let cargaLeaflet = null;

export function cargarLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!cargaLeaflet) {
        cargaLeaflet = new Promise((resolver, rechazar) => {
            if (!document.querySelector('link[data-leaflet]')) {
                const css = document.createElement('link');
                Object.assign(css, { rel: 'stylesheet', href: LEAFLET.css, integrity: LEAFLET.cssIntegridad, crossOrigin: '' });
                css.dataset.leaflet = '';
                document.head.appendChild(css);
            }
            const script = document.createElement('script');
            Object.assign(script, { src: LEAFLET.js, integrity: LEAFLET.jsIntegridad, crossOrigin: '', async: true });
            const limite = setTimeout(() => fallar(), 15000);
            const fallar = () => {
                clearTimeout(limite);
                cargaLeaflet = null; // permite reintentar más tarde
                script.remove();
                rechazar(new Error('leaflet_no_disponible'));
            };
            script.onload = () => {
                clearTimeout(limite);
                window.L ? resolver(window.L) : fallar();
            };
            script.onerror = fallar;
            document.head.appendChild(script);
        });
    }
    return cargaLeaflet;
}

// Crea el mapa con teselas de OpenStreetMap y créditos visibles
export function crearMapa(L, contenedor, centro, zoom, opciones = {}, alFallarTeselas = () => {}) {
    const mapa = L.map(contenedor, { scrollWheelZoom: false, ...opciones }).setView(centro, zoom);
    let errores = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Colaboradores de OpenStreetMap</a>'
    })
        .on('tileerror', () => {
            errores++;
            if (errores === 3) alFallarTeselas();
        })
        .addTo(mapa);
    return mapa;
}

export function iconoBarberia(L) {
    return L.divIcon({
        className: 'pin-barberia',
        html: '<span class="pin-barberia-cabeza"><i class="fas fa-cut" aria-hidden="true"></i></span>',
        iconSize: [40, 50],
        iconAnchor: [20, 48]
    });
}
