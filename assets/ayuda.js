// ==========================================
// AYUDA CONTEXTUAL
// Botón «?» con nombre accesible que despliega una explicación breve justo debajo,
// dentro del flujo de la página (no flota: nunca se sale de la pantalla).
// Se abre con toque, clic, Enter o Espacio; Escape la cierra y devuelve el foco al botón.
// ==========================================

let contador = 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// tema: qué explica (forma el nombre accesible «Ayuda: …»); html: contenido ya escapado por quien llama
export function ayuda(tema, html) {
    const id = `ayuda-${++contador}`;
    return `<button type="button" class="ayuda-boton" aria-expanded="false" aria-controls="${id}" aria-label="Ayuda: ${esc(tema)}">`
        + `<i class="fas fa-circle-question" aria-hidden="true"></i></button>`
        + `<div class="ayuda-panel" id="${id}" hidden><p class="ayuda-titulo">${esc(tema)}</p>${html}</div>`;
}

function alternar(boton, abrir) {
    const panel = document.getElementById(boton.getAttribute('aria-controls'));
    if (!panel) return;
    boton.setAttribute('aria-expanded', String(abrir));
    panel.hidden = !abrir;
}

if (!window.__ayudaContextual) {
    window.__ayudaContextual = true;
    document.addEventListener('click', e => {
        const boton = e.target.closest('.ayuda-boton');
        if (boton) { alternar(boton, boton.getAttribute('aria-expanded') !== 'true'); return; }
        // Tocar fuera cierra las ayudas abiertas (no las que contienen el toque)
        document.querySelectorAll('.ayuda-boton[aria-expanded="true"]').forEach(b => {
            const panel = document.getElementById(b.getAttribute('aria-controls'));
            if (!panel?.contains(e.target)) alternar(b, false);
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const abierta = [...document.querySelectorAll('.ayuda-boton[aria-expanded="true"]')]
            .find(b => b === document.activeElement || document.getElementById(b.getAttribute('aria-controls'))?.contains(document.activeElement));
        if (!abierta) return;
        e.stopPropagation(); // no cierra además el diálogo que la contiene
        e.preventDefault();
        alternar(abierta, false);
        abierta.focus();
    }, true);
}
