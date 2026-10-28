import { ANCHOS_INTER } from './fonts/inter-widths.js';
import { IDENTIDAD_BARBERIA } from './business-identity.js';

const COLOR_TARJETA = '#168bff';
const limpio = valor => typeof valor === 'string' || typeof valor === 'number'
    ? String(valor).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const xml = valor => String(valor).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function zonaValida(zona = 'America/Santo_Domingo') {
    new Intl.DateTimeFormat('es-DO', { timeZone: zona }).format();
    return zona;
}
export function enlaceGestionSeguro(base, token) {
    if (!token || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)) return '';
    try {
        const url = new URL(base);
        if (url.protocol !== 'https:' || url.username || url.password) return '';
        url.search = '';
        url.hash = '';
        url.searchParams.set('cita', token);
        return url.href;
    } catch { return ''; }
}

// fecha/hora de citas son DATE/TIME locales del negocio, no instantes UTC.
// Solo se convierte de zona cuando se proporciona un instante explícito.
export function datosTarjeta(cita, opciones = {}) {
    const zona = zonaValida(opciones.zonaHoraria);
    let fecha = '', hora = '';
    if (cita.instante) {
        const instante = new Date(cita.instante);
        fecha = new Intl.DateTimeFormat('es-DO', { dateStyle: 'full', timeZone: zona }).format(instante);
        const partes = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zona }).formatToParts(instante);
        hora = `${partes.find(p => p.type === 'hour').value}:${partes.find(p => p.type === 'minute').value} ${partes.find(p => p.type === 'dayPeriod').value === 'AM' ? 'a. m.' : 'p. m.'}`;
    } else {
        const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio(cita.fecha));
        if (f) {
            const d = new Date(Date.UTC(+f[1], +f[2] - 1, +f[3]));
            if (d.toISOString().slice(0, 10) !== f[0]) throw new Error('Fecha de cita inválida');
            fecha = new Intl.DateTimeFormat('es-DO', { dateStyle: 'full', timeZone: 'UTC' }).format(d);
        }
        const h = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(limpio(cita.hora));
        if (h && +h[1] < 24 && +h[2] < 60) hora = `${+h[1] % 12 || 12}:${h[2]} ${+h[1] < 12 ? 'a. m.' : 'p. m.'}`;
    }
    if (!fecha || !hora) throw new Error('La tarjeta requiere fecha y hora válidas de la cita guardada');
    const servicios = (Array.isArray(cita.servicios) ? cita.servicios : [cita.servicio]).map(limpio).filter(Boolean);
    const estado = cita.completada || cita.completada_en ? 'completada' : limpio(cita.estado);
    const estados = {
        confirmada: ['Confirmación de cita', 'Confirmada', 'Tu cita está confirmada. Será un placer recibirte.'],
        cancelada: ['Cita cancelada', 'Cancelada', 'Tu cita está cancelada.'],
        completada: ['Cita completada', 'Completada', 'Tu cita ha sido completada. Gracias por tu visita.']
    };
    const [titulo, etiqueta, mensaje] = estados[estado] || ['Solicitud recibida', 'Pendiente de confirmación', 'Recibimos tu solicitud. Tu cita está pendiente de confirmación.'];
    const nombre = limpio(cita.nombre ?? cita.nombre_cliente);
    const profesional = limpio(cita.barbero);
    if (!nombre || !servicios.length || !profesional) throw new Error('Faltan datos de la cita guardada');
    return {
        negocio: limpio(opciones.identidad?.nombre) || IDENTIDAD_BARBERIA.nombre,
        logo: opciones.identidad?.logo || IDENTIDAD_BARBERIA.logo,
        ubicacion: limpio(opciones.identidad?.ubicacion ?? IDENTIDAD_BARBERIA.ubicacion),
        // Color principal de la identidad (ya validado como legible al publicarse); sin él, el azul original
        color: /^#[0-9a-f]{6}$/i.test(opciones.identidad?.color || '') ? opciones.identidad.color : COLOR_TARJETA,
        nombre, servicios, profesional, fecha, hora, titulo, etiqueta, mensaje, zona,
        referencia: limpio(cita.referencia ?? cita.id),
        enlace: enlaceGestionSeguro(opciones.urlPublica, opciones.token),
        ficticia: opciones.ficticia === true
    };
}
export function textoTarjeta(datos) {
    return [
        `*${datos.negocio}*`, `*${datos.titulo}*`, '', `Hola, ${datos.nombre}.`, datos.mensaje, '',
        `*Servicio:* ${datos.servicios.join(' · ')}`, `*Profesional:* ${datos.profesional}`,
        `*Fecha:* ${datos.fecha}`, `*Hora:* ${datos.hora}`,
        ...(datos.ubicacion ? [`*Ubicación:* ${datos.ubicacion}`] : []),
        ...(datos.referencia ? [`*Referencia:* ${datos.referencia}`] : []),
        ...(datos.enlace ? [`Gestionar reserva: ${datos.enlace}`] : []),
        '', 'Gracias por elegirnos.', ...(datos.ficticia ? ['', 'VISTA PREVIA · DATOS FICTICIOS · NO ENVIAR'] : [])
    ].join('\n');
}

// Metricas de la fuente empaquetada, con 12% de reserva para otros pesos.
export function anchoTextoTarjeta(texto, tamano) {
    return Array.from(texto).reduce((total, letra) => total + (ANCHOS_INTER[letra] ?? 1), 0) * tamano * 1.12;
}
export function lineasTarjeta(texto, tamano, ancho = 936) {
    const lineas = [];
    let linea = '';
    for (const palabra of String(texto).split(/\s+/u)) {
        const propuesta = linea ? `${linea} ${palabra}` : palabra;
        if (anchoTextoTarjeta(propuesta, tamano) <= ancho) { linea = propuesta; continue; }
        if (linea) lineas.push(linea);
        linea = '';
        for (const letra of Array.from(palabra)) {
            if (anchoTextoTarjeta(linea + letra, tamano) > ancho && linea) { lineas.push(linea); linea = ''; }
            linea += letra;
        }
    }
    if (linea) lineas.push(linea);
    return lineas;
}
export function layoutTarjeta(datos, logo = '') {
    const elementos = [];
    let y = 76;
    const texto = (valor, size, fill, weight = 400) => {
        for (const linea of lineasTarjeta(valor, size)) {
            elementos.push({ tipo: 'texto', texto: linea, x: 72, y, size, fill, weight });
            y += size * 1.35;
        }
    };
    if (datos.ficticia) { texto('VISTA PREVIA · DATOS FICTICIOS', 25, '#70baff', 700); y += 24; }
    if (logo) { elementos.push({ tipo: 'logo', href: logo, x: 72, y: y - 30, width: 180, height: 100 }); y += 105; }
    texto(datos.negocio, 48, '#ffffff', 700); y += 36;
    texto(datos.titulo, 52, datos.color || COLOR_TARJETA, 700); y += 16;
    texto(datos.etiqueta, 30, '#bddfff', 600); y += 34;
    elementos.push({ tipo: 'linea', y }); y += 52;
    const campos = [['CLIENTE', datos.nombre], ['SERVICIO', datos.servicios.join(' · ')], ['PROFESIONAL', datos.profesional], ['FECHA', datos.fecha], ['HORA', datos.hora], ['UBICACIÓN', datos.ubicacion], ['REFERENCIA', datos.referencia]];
    for (const [etiqueta, valor] of campos) {
        if (!valor) continue;
        texto(etiqueta, 25, '#aebdc9', 600); y += 5;
        texto(valor, 39, '#ffffff', 500); y += 32;
    }
    elementos.push({ tipo: 'linea', y }); y += 52;
    texto('Gracias por elegirnos.', 34, '#ffffff', 600);
    texto('Será un placer recibirte', 34, '#bccbd6');
    return { width: 1080, height: Math.ceil(y + 60), elementos, color: datos.color || COLOR_TARJETA };
}
export function svgTarjeta(layout) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${layout.height}" viewBox="0 0 1080 ${layout.height}">
    <rect width="1080" height="${layout.height}" fill="#0a0e11"/><rect width="1080" height="12" fill="${xml(layout.color || COLOR_TARJETA)}"/>
    ${layout.elementos.map(e => e.tipo === 'texto' ? `<text x="${e.x}" y="${e.y}" font-family="Inter" font-size="${e.size}" font-weight="${e.weight}" fill="${e.fill}">${xml(e.texto)}</text>` : e.tipo === 'linea' ? `<path d="M72 ${e.y}H1008" stroke="#364149" stroke-width="2"/>` : `<image href="${xml(e.href)}" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMinYMid meet"/>`).join('')}
    </svg>`;
}
