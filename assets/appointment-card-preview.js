import { datosTarjeta, layoutTarjeta, textoTarjeta } from './appointment-card.js';
import { cargarLogoTarjeta } from './card-logo.js';

let fuente;
async function cargarFuente() {
    fuente ??= (async () => {
        const font = new FontFace('InterTarjeta', `url(${new URL('./fonts/Inter.ttf', import.meta.url)})`);
        document.fonts.add(await font.load());
    })();
    await fuente;
}
export async function pngTarjetaNavegador(datos) {
    await cargarFuente();
    // Logo publicado desde el panel: data URL de imagen ya recodificada (PNG/JPEG/WebP, nunca SVG)
    const logoData = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(datos.logo || '') ? datos.logo
        : await cargarLogoTarjeta(datos.logo, window.location.origin);
    const layout = layoutTarjeta(datos, logoData);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0e11'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = layout.color; ctx.fillRect(0, 0, canvas.width, 12);
    for (const e of layout.elementos) {
        if (e.tipo === 'texto') {
            ctx.fillStyle = e.fill;
            ctx.font = `${e.weight} ${e.size}px InterTarjeta, sans-serif`;
            ctx.fillText(e.texto, e.x, e.y);
        } else if (e.tipo === 'linea') {
            ctx.strokeStyle = '#364149'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(72, e.y); ctx.lineTo(1008, e.y); ctx.stroke();
        } else {
            try {
                const logo = new Image(); logo.src = e.href; await logo.decode();
                const escala = Math.min(e.width / logo.width, e.height / logo.height);
                ctx.drawImage(logo, e.x, e.y + (e.height - logo.height * escala) / 2, logo.width * escala, logo.height * escala);
            } catch { /* Nombre del negocio siempre visible aunque falle el logo. */ }
        }
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG')), 'image/png'));
}

// No envía mensajes ni realiza escrituras. Solo recibe una cita ya consultada.
export function montarTarjeta(contenedor, cita, opciones = {}) {
    const bloque = document.createElement('details');
    bloque.className = 'tarjeta-digital';
    bloque.open = opciones.ficticia === true;
    bloque.innerHTML = `
        <summary>Tarjeta digital de la cita${opciones.ficticia ? ' · Datos ficticios' : ''}</summary>
        <p class="nota-espera">Vista previa y descarga local. Este botón no envía mensajes.</p>
        <div class="acciones-gestion">
            <button type="button" class="btn-admin-accion tarjeta-generar">Generar vista previa PNG</button>
            <a class="btn-admin-accion tarjeta-descargar" hidden download="cita.png">Descargar PNG</a>
        </div>
        <p class="nota-espera tarjeta-estado" role="status"></p>
        <img class="tarjeta-imagen" hidden alt="Tarjeta digital con los datos de la cita">
        <label>Texto de WhatsApp<textarea class="tarjeta-texto" rows="12" readonly aria-label="Texto de la tarjeta para WhatsApp"></textarea></label>`;
    contenedor.appendChild(bloque);
    const texto = bloque.querySelector('.tarjeta-texto');
    const estado = bloque.querySelector('.tarjeta-estado');
    const generar = bloque.querySelector('.tarjeta-generar');
    const imagen = bloque.querySelector('.tarjeta-imagen');
    const descargar = bloque.querySelector('.tarjeta-descargar');
    let datos;
    try { datos = datosTarjeta(cita, opciones); texto.value = textoTarjeta(datos); }
    catch { estado.textContent = 'No se puede generar la tarjeta: faltan datos válidos de la cita.'; generar.disabled = true; return; }
    texto.addEventListener('click', () => texto.select());
    generar.addEventListener('click', async () => {
        generar.disabled = true;
        estado.textContent = 'Generando imagen…';
        try {
            const blob = await pngTarjetaNavegador(datos);
            const url = URL.createObjectURL(blob);
            if (!bloque.isConnected) { URL.revokeObjectURL(url); return; }
            imagen.src = url; imagen.hidden = false;
            descargar.href = url; descargar.hidden = false;
            estado.textContent = opciones.ficticia ? 'PNG de prueba. Datos ficticios; no se envió ningún mensaje.' : 'PNG generado. Puedes descargarlo; el texto permanece disponible.';
            // Se conserva una sola imagen por vista y se libera al retirarla.
            const observer = new MutationObserver(() => {
                if (!bloque.isConnected) { URL.revokeObjectURL(url); observer.disconnect(); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            generar.hidden = true;
        } catch {
            estado.textContent = 'No se pudo generar la imagen. El texto sigue disponible; tu reserva no ha cambiado.';
        } finally { generar.disabled = false; }
    });
}

export function montarPruebasTarjeta(contenedor, opciones = {}) {
    const grupo = document.createElement('section');
    grupo.className = 'tarjeta-pruebas';
    grupo.innerHTML = `<h3>Vista previa de tarjeta digital</h3>
        <p class="nota-espera">DATOS FICTICIOS. No se envían mensajes ni se crean reservas. La tarjeta automática requiere desplegar la función y aprobar las plantillas de Meta.</p>
        <label>Escenario de prueba<select class="tarjeta-escenario">
            <option value="confirmada">Confirmada</option>
            <option value="pendiente">Pendiente de confirmación</option>
            <option value="larga">Nombre largo y varios servicios</option>
            <option value="minima">Sin logo, ubicación ni referencia</option>
            <option value="cancelada">Cancelada</option>
        </select></label><div class="tarjeta-muestra"></div>`;
    contenedor.prepend(grupo);
    const mostrar = () => {
        const escenario = grupo.querySelector('select').value;
        const muestra = grupo.querySelector('.tarjeta-muestra'); muestra.replaceChildren();
        const cita = {
            nombre: escenario === 'larga' ? 'María Alejandra de los Ángeles Fernández Rodríguez · CLIENTE FICTICIO' : 'Cliente de demostración · FICTICIO',
            servicios: escenario === 'larga' ? ['Servicio de demostración: corte y asesoría de estilo', 'Servicio de demostración: arreglo de barba', 'Servicio de demostración: tratamiento facial'] : ['Servicio de demostración'],
            barbero: 'Profesional de demostración', fecha: '2026-11-21', hora: '14:30',
            estado: ['pendiente', 'cancelada'].includes(escenario) ? escenario : 'confirmada',
            referencia: escenario === 'minima' ? '' : 'DEMO-NO-VALIDA'
        };
        montarTarjeta(muestra, cita, { ...opciones, ficticia: true, ...(escenario === 'minima' ? { identidad: { logo: '', ubicacion: '' } } : {}) });
    };
    grupo.querySelector('select').addEventListener('change', mostrar); mostrar();
}
