// Presentación del inicio. Reutiliza navegación, horario y ubicación existentes.
export function inicializarInicioInmersivo(inicio, encabezado) {
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)');
    const foto = inicio.querySelector('.hero-portrait img');
    const menu = document.getElementById('menu-toggle');
    const enlaces = document.getElementById('nav-links');
    const fondo = document.createElement('button');
    fondo.type = 'button';
    fondo.className = 'home-menu-backdrop';
    fondo.tabIndex = -1;
    fondo.setAttribute('aria-label', 'Cerrar menú');
    encabezado.append(fondo);
    const cerrarMenu = () => {
        enlaces.classList.remove('nav-abierto');
        menu.classList.remove('menu-activo');
        menu.setAttribute('aria-expanded', 'false');
    };
    fondo.addEventListener('click', () => { cerrarMenu(); menu.focus({ preventScroll: true }); });
    document.addEventListener('keydown', evento => {
        if (evento.key === 'Escape' && document.body.dataset.view === 'inicio' && menu.getAttribute('aria-expanded') === 'true') {
            cerrarMenu();
            menu.focus({ preventScroll: true });
        }
    });
    const sincronizarMenu = () => {
        encabezado.dataset.menuOpen = menu.getAttribute('aria-expanded') === 'true' ? 'true' : 'false';
        // Evita que el foco alcance enlaces de un menú visualmente cerrado.
        if (document.body.dataset.view === 'inicio') enlaces.inert = menu.getAttribute('aria-expanded') !== 'true';
        else enlaces.inert = false;
    };
    new MutationObserver(sincronizarMenu).observe(menu, { attributes: true, attributeFilter: ['aria-expanded'] });

    // La URL procede del mismo componente que muestra el minimapa y se actualiza con él.
    const ubicacion = document.getElementById('ubicacion-seccion');
    const destino = document.getElementById('home-directions');
    const sincronizarUbicacion = () => {
        const enlace = ubicacion.querySelector('.btn-ubicacion-principal[href]');
        if (enlace) {
            destino.href = enlace.href;
            destino.target = '_blank';
            destino.rel = 'noopener noreferrer';
        } else {
            destino.href = '#mas';
            destino.removeAttribute('target');
            destino.removeAttribute('rel');
        }
    };
    new MutationObserver(sincronizarUbicacion).observe(ubicacion, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    sincronizarUbicacion();

    let entrado = false;
    const animaciones = new Set();
    function animar(elemento, cuadros, opciones) {
        if (!elemento?.animate || reducido.matches) return;
        const animacion = elemento.animate(cuadros, { easing: 'cubic-bezier(.22,.61,.36,1)', ...opciones });
        animaciones.add(animacion);
        animacion.finished.then(() => animaciones.delete(animacion)).catch(() => animaciones.delete(animacion));
    }
    function entrar() {
        sincronizarMenu();
        if (entrado || document.body.dataset.view !== 'inicio') return;
        entrado = true;
        inicio.dataset.entrada = 'completa';
        if (reducido.matches) return;
        animar(encabezado.querySelector('.navbar'), [{ opacity: 0 }, { opacity: 1 }], { duration: 360 });
        const revelarFoto = () => {
            if (reducido.matches || document.body.dataset.view !== 'inicio') return;
            animar(foto, [{ opacity: .3, transform: 'scale(1.03)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1050 });
        };
        if (foto.complete && foto.naturalWidth) revelarFoto();
        else foto.addEventListener('load', revelarFoto, { once: true });
        inicio.querySelectorAll('.home-eyebrow,.hero-title,.btn-hero-cta,.hero-secundaria').forEach((elemento, i) => {
            animar(elemento, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 460, delay: 90 + i * 70, fill: 'backwards' });
        });
    }
    new MutationObserver(entrar).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    entrar();
    reducido.addEventListener('change', () => {
        if (reducido.matches) animaciones.forEach(animacion => animacion.cancel());
    });
}
