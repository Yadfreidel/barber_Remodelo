// Presentación del inicio. Reutiliza navegación, horario y ubicación existentes.
export function inicializarInicioInmersivo(inicio, encabezado) {
    const limpiarPortada = inicializarInteraccionPortada(inicio);
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)');
    const foto = inicio.querySelector('.hero-portrait img');
    const menu = document.getElementById('menu-toggle');
    const enlaces = document.getElementById('nav-links');
    const ciclo = new AbortController();
    const observar = (nodo, opciones, callback) => {
        const observador = new MutationObserver(callback);
        observador.observe(nodo, opciones);
        ciclo.signal.addEventListener('abort', () => observador.disconnect(), { once: true });
    };
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
    fondo.addEventListener('click', () => { cerrarMenu(); menu.focus({ preventScroll: true }); }, { signal: ciclo.signal });
    document.addEventListener('keydown', evento => {
        if (evento.key === 'Escape' && document.body.dataset.view === 'inicio' && menu.getAttribute('aria-expanded') === 'true') {
            cerrarMenu();
            menu.focus({ preventScroll: true });
        }
    }, { signal: ciclo.signal });
    const sincronizarMenu = () => {
        encabezado.dataset.menuOpen = menu.getAttribute('aria-expanded') === 'true' ? 'true' : 'false';
        // Evita que el foco alcance enlaces de un menú visualmente cerrado.
        if (document.body.dataset.view === 'inicio') enlaces.inert = menu.getAttribute('aria-expanded') !== 'true';
        else enlaces.inert = false;
    };
    observar(menu, { attributes: true, attributeFilter: ['aria-expanded'] }, sincronizarMenu);

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
    observar(ubicacion, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] }, sincronizarUbicacion);
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
            animar(foto, [{ opacity: .3 }, { opacity: 1 }], { duration: 1050 });
        };
        if (foto.complete && foto.naturalWidth) revelarFoto();
        else foto.addEventListener('load', revelarFoto, { once: true, signal: ciclo.signal });
        inicio.querySelectorAll('.home-eyebrow,.hero-title,.hero-description:not([hidden]),.btn-hero-cta,.hero-secundaria').forEach((elemento, i) => {
            animar(elemento, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 340, delay: i * 25 });
        });
    }
    observar(document.body, { attributes: true, attributeFilter: ['data-view'] }, () => {
        if (document.body.dataset.view !== 'inicio') animaciones.forEach(a => a.cancel());
        entrar();
    });
    entrar();
    reducido.addEventListener('change', () => {
        if (reducido.matches) animaciones.forEach(animacion => animacion.cancel());
    }, { signal: ciclo.signal });
    const desmontaje = new MutationObserver(() => { if (!inicio.isConnected) limpiar(); });
    desmontaje.observe(inicio.parentNode, { childList: true });
    function limpiar() {
        ciclo.abort();
        desmontaje.disconnect();
        animaciones.forEach(a => a.cancel());
        limpiarPortada();
        fondo.remove();
    }
    window.addEventListener('pagehide', evento => { if (!evento.persisted) limpiar(); }, { signal: ciclo.signal });
    return limpiar;
}
// Pointer Events sin capturar el gesto: el navegador conserva el scroll vertical.
function inicializarInteraccionPortada(inicio) {
    const zona = inicio.querySelector('.hero-layout');
    const foto = zona.querySelector('.hero-portrait img');
    const reducido = matchMedia('(prefers-reduced-motion: reduce)');
    const ciclo = new AbortController();
    const efectos = document.createElement('div');
    efectos.className = 'home-interaction-effects';
    efectos.setAttribute('aria-hidden', 'true');
    const brillo = document.createElement('div');
    brillo.className = 'home-pointer-glow';
    efectos.append(brillo);
    zona.append(efectos);
    const animaciones = new Set();
    let visible = false, activo = null, raf = 0, temporizador = 0;
    let objetivo = [0, 0, 0], actual = [0, 0, 0];
    const permitido = () => visible && !document.hidden && document.body.dataset.view === 'inicio';
    const control = evento => evento.target.closest('a,button,input,select,textarea,[role="button"],[contenteditable="true"]');
    const escuchar = (nodo, tipo, fn) => nodo.addEventListener(tipo, fn, { passive: true, signal: ciclo.signal });
    function cuadro() {
        raf = 0;
        actual = actual.map((v, i) => Math.abs(objetivo[i] - v) < .001 ? objetivo[i] : v + (objetivo[i] - v) * .16);
        const [x, y, fuerza] = actual;
        foto.style.transform = `perspective(1400px) translate3d(${x * 8}px,${y * 8}px,0) rotateX(${-y * 2}deg) rotateY(${x * 2}deg) scale(${1 + fuerza * .06})`;
        if (actual.some((v, i) => v !== objetivo[i])) raf = requestAnimationFrame(cuadro);
        else if (!objetivo[2]) foto.style.removeProperty('will-change');
    }
    function programar() {
        if (!raf) raf = requestAnimationFrame(cuadro);
    }
    function restaurar(inmediato = false) {
        activo = null;
        clearTimeout(temporizador);
        objetivo = [0, 0, 0];
        brillo.style.opacity = '0';
        if (inmediato || reducido.matches) {
            cancelAnimationFrame(raf); raf = 0;
            actual = [0, 0, 0];
            foto.style.removeProperty('transform');
            foto.style.removeProperty('will-change');
        } else programar();
    }
    function detener() {
        restaurar(true);
        animaciones.forEach(a => a.cancel());
        efectos.querySelectorAll('.home-touch-wave,.home-touch-particle').forEach(n => n.remove());
    }
    function posicion(evento) {
        const rect = zona.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, evento.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, evento.clientY - rect.top));
        brillo.style.left = `${x}px`; brillo.style.top = `${y}px`;
        brillo.style.opacity = '1';
        if (!reducido.matches) {
            objetivo = [x / rect.width * 2 - 1, evento.pointerType === 'mouse' ? y / rect.height * 2 - 1 : 0, 1];
            foto.style.willChange = 'transform';
            programar();
        }
        return { x, y };
    }
    function destello(evento) {
        if (!permitido() || control(evento)) return;
        const { x, y } = posicion(evento);
        if (reducido.matches) {
            clearTimeout(temporizador);
            temporizador = setTimeout(() => restaurar(), 180);
            return;
        }
        // Como máximo dos grupos de una onda y seis partículas.
        if (animaciones.size >= 14 || !efectos.animate) return;
        for (let i = 0; i < 7; i++) {
            const nodo = document.createElement('span');
            nodo.className = i ? 'home-touch-particle' : 'home-touch-wave';
            nodo.style.left = `${x}px`; nodo.style.top = `${y}px`;
            efectos.append(nodo);
            const angulo = i * Math.PI / 3;
            const transform = i ? `translate(${Math.cos(angulo) * 42}px,${Math.sin(angulo) * 42}px) scale(.25)` : 'scale(5)';
            const a = nodo.animate([{ transform: 'scale(.4)', opacity: .65 }, { transform, opacity: 0 }], { duration: i ? 480 : 620, easing: 'cubic-bezier(.2,.6,.3,1)' });
            animaciones.add(a);
            const quitar = () => { animaciones.delete(a); nodo.remove(); };
            a.finished.then(quitar, quitar);
        }
    }
    escuchar(zona, 'pointerenter', e => {
        if (e.pointerType === 'mouse' && permitido() && !control(e)) { activo = e.pointerId; posicion(e); }
    });
    escuchar(zona, 'pointermove', e => {
        if (!permitido()) return;
        if (control(e)) { restaurar(); return; }
        if (e.pointerType === 'mouse' || activo === e.pointerId) posicion(e);
    });
    escuchar(zona, 'pointerdown', e => {
        if (!permitido() || control(e) || !e.isPrimary || e.button !== 0) return;
        activo = e.pointerId;
        posicion(e);
        if (e.pointerType !== 'mouse') {
            destello(e);
            temporizador = setTimeout(() => restaurar(), 650);
        }
    });
    escuchar(zona, 'click', e => { if (e.pointerType === 'mouse' && e.detail) destello(e); });
    escuchar(zona, 'pointerleave', () => restaurar());
    escuchar(window, 'pointerup', () => restaurar());
    escuchar(window, 'pointercancel', () => restaurar());
    escuchar(window, 'blur', detener);
    escuchar(document, 'visibilitychange', () => { if (document.hidden) detener(); });
    escuchar(reducido, 'change', detener);
    const interseccion = new IntersectionObserver(entradas => {
        visible = entradas[0].isIntersecting;
        if (!visible) detener();
    });
    interseccion.observe(zona);
    const vista = new MutationObserver(() => { if (!permitido()) detener(); });
    vista.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    return () => { detener(); ciclo.abort(); interseccion.disconnect(); vista.disconnect(); efectos.remove(); };
}
