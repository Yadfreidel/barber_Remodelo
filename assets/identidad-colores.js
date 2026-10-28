// ==========================================
// COLORES DE LA IDENTIDAD DEL NEGOCIO
// Principal y acento sustituyen al dorado del portal público. El fondo sigue oscuro y los
// colores de estado, error y aviso no cambian. Sin colores guardados se conserva el diseño original.
// ==========================================

export const FONDO = '#0b0b0c';
export const CONTRASTE_MINIMO = 4.5; // WCAG AA, texto normal

// Combinaciones probadas: legibles como texto sobre el fondo y con texto oscuro encima de un botón
export const PALETAS = [
    { nombre: 'Dorado original', principal: '', acento: '' },
    { nombre: 'Champán', principal: '#dfc38f', acento: '#f3e3c0' },
    { nombre: 'Plata', principal: '#c7ccd4', acento: '#eef1f5' },
    { nombre: 'Cobre', principal: '#e3a47c', acento: '#f5cfb3' },
    { nombre: 'Esmeralda', principal: '#6fd4a8', acento: '#b9eed6' },
    { nombre: 'Azul', principal: '#7fb9f2', acento: '#c3defa' },
    { nombre: 'Rosa', principal: '#f2a7c3', acento: '#f9d3e1' }
];

export const colorValido = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));

function luminancia(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((total, c, i) => total + c * [0.2126, 0.7152, 0.0722][i], 0);
}

// Igual que _contraste_sobre_fondo en el servidor (redondeado a 2 decimales)
export function contraste(hex, fondo = FONDO) {
    if (!colorValido(hex)) return null;
    const [a, b] = [luminancia(hex), luminancia(fondo)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}

export const colorLegible = hex => !hex || (colorValido(hex) && contraste(hex) >= CONTRASTE_MINIMO);

// Reglas CSS para aplicar los colores; `ambito` limita la vista previa a un contenedor
export function cssColores({ principal, acento }, ambito = ':root') {
    const p = colorLegible(principal) && principal ? principal : '';
    const a = colorLegible(acento) && acento ? acento : p;
    if (!p && !a) return '';
    const vars = [
        p && `--dorado:${p};--gold:${p};--dorado-suave:color-mix(in srgb, ${p} 12%, transparent);--home-champagne:${p};--identidad-principal:${p};`,
        a && `--dorado-brillante:${a};--identidad-acento:${a};`
    ].join('');
    const misCitas = [p && `--mc-oro:${p};--mc-oro-suave:color-mix(in srgb, ${p} 10%, transparent);`, a && `--mc-oro-claro:${a};`].join('');
    return ambito === ':root'
        ? `:root, body[data-view] {${vars}} #mis-citas {${misCitas}}`
        : `${ambito} {${vars}${misCitas}}`;
}

export function aplicarColoresPortal(colores) {
    let estilo = document.getElementById('identidad-colores');
    const css = cssColores(colores);
    if (!css) { estilo?.remove(); return; }
    if (!estilo) {
        estilo = document.createElement('style');
        estilo.id = 'identidad-colores';
        document.head.appendChild(estilo);
    }
    estilo.textContent = css;
}
