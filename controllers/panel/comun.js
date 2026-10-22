// ==========================================
// PANEL: utilidades compartidas
// Todas las operaciones pasan por funciones del servidor (panel_*), que
// verifican el rol. Los botones ocultos en la interfaz no son la protección.
// ==========================================

import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';

export const ZONA = 'America/Santo_Domingo';

const MENSAJES = {
    horario_no_disponible: 'Ese horario no está disponible (se cruza con otra cita, un descanso, un bloqueo o está fuera de la jornada).',
    no_autorizado: 'No tienes permiso para esta operación.',
    motivo_requerido: 'Escribe el motivo de la cancelación (mínimo 3 caracteres).',
    cita_no_pendiente: 'Solo se pueden confirmar citas pendientes.',
    cita_aun_no_ocurre: 'Solo puedes marcar "no asistió" cuando ya pasó la hora de la cita.',
    cita_completada: 'La cita ya está completada.',
    cita_cancelada: 'La cita está cancelada.',
    cita_cerrada: 'No se puede reprogramar una cita completada o marcada como ausencia.',
    cita_marcada_no_asistio: 'La cita está marcada como ausencia.',
    cita_no_encontrada: 'No se encontró la cita.',
    pago_invalido: 'Revisa el importe y el método de pago.',
    barbero_no_realiza_servicio: 'Ese barbero no realiza el servicio elegido.',
    servicio_no_disponible: 'El servicio no está activo.',
    barbero_no_disponible: 'El barbero no está activo.',
    servicio_duplicado: 'Ya existe un servicio con ese nombre.',
    servicio_invalido: 'Revisa los datos del servicio (nombre, precio, duración y foto).',
    barbero_duplicado: 'Ya existe un barbero con ese nombre.',
    barbero_invalido: 'Revisa los datos del barbero.',
    barbero_no_encontrado: 'No se encontró el barbero.',
    usuario_no_encontrado: 'No existe una cuenta con ese correo. Créala primero en Authentication de Supabase (o con npm run local:usuario en el entorno local).',
    cliente_invalido: 'Revisa nombre, teléfono y correo del cliente.',
    telefono_invalido: 'Teléfono no válido.',
    negocio_invalido: 'Revisa los datos del negocio (teléfonos, enlaces https:// e imágenes).',
    plantilla_invalida: 'El texto es obligatorio y el nombre de plantilla de Meta solo admite minúsculas, números y guiones bajos.',
    regla_invalida: 'Algún valor de las reglas está fuera de rango.',
    horario_invalido: 'La hora de cierre debe ser posterior a la de apertura.',
    descanso_invalido: 'El fin del descanso debe ser posterior a su inicio.',
    rango_invalido: 'El rango de fechas no es válido (máximo 400 días).',
    datos_invalidos: 'Revisa los datos ingresados.',
    bloqueo_no_encontrado: 'El bloqueo ya no existe.',
    'time zone': 'Zona horaria no válida.',
    JWT: 'Tu sesión expiró. Vuelve a iniciar sesión.'
};

export function mensajeError(error) {
    const texto = error?.message || String(error || '');
    const clave = Object.keys(MENSAJES).find(k => texto.includes(k));
    return clave ? MENSAJES[clave] : 'No se pudo completar la operación. Inténtalo de nuevo.';
}

export async function api(funcion, argumentos = {}) {
    const cliente = obtenerClienteAdmin();
    if (!cliente) throw new Error('No hay conexión con el servidor.');
    const { data, error } = await cliente.rpc(funcion, argumentos);
    if (error) throw new Error(mensajeError(error));
    return data;
}

export function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dinero(n) {
    return `RD$ ${Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ---------- Fechas (siempre en la zona horaria del negocio) ----------
export function hoyLocal() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function horaLocal() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

const aUTC = f => { const [a, m, d] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const deUTC = d => d.toISOString().slice(0, 10);

export function sumarDias(fecha, dias) {
    const d = aUTC(fecha);
    d.setUTCDate(d.getUTCDate() + dias);
    return deUTC(d);
}

export function diaSemana(fecha) {
    return aUTC(fecha).getUTCDay();
}

export function inicioSemana(fecha) {
    return sumarDias(fecha, -((diaSemana(fecha) + 6) % 7)); // lunes
}

export function inicioMes(fecha) {
    return `${fecha.slice(0, 7)}-01`;
}

export function finMes(fecha) {
    const d = aUTC(inicioMes(fecha));
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return deUTC(d);
}

export function fechaLarga(fecha, opciones = { weekday: 'long', day: 'numeric', month: 'long' }) {
    return new Intl.DateTimeFormat('es-DO', { ...opciones, timeZone: 'UTC' }).format(aUTC(fecha));
}

export function fechaCorta(fecha) {
    return new Intl.DateTimeFormat('es-DO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(aUTC(fecha));
}

export function fechaHora(iso) {
    return iso ? new Intl.DateTimeFormat('es-DO', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '';
}

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// ---------- Estados ----------
export const ESTADOS = {
    pendiente: 'Pendiente', confirmada: 'Confirmada', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió'
};

export function etiquetaEstado(c) {
    const e = c.estado_visual || c.estado;
    return `<span class="estado-chip estado-${esc(e)}">${esc(ESTADOS[e] || e)}</span>${c.pagada ? '<span class="estado-chip estado-pagada">Pagada</span>' : ''}`;
}

// ---------- Diálogos ----------
export function dialogo({ titulo, html, ancho = 'md' }) {
    const fondo = document.createElement('div');
    fondo.className = 'panel-dialogo-fondo';
    fondo.innerHTML = `
        <div class="panel-dialogo panel-dialogo-${ancho}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
            <header class="panel-dialogo-cabecera">
                <h3>${esc(titulo)}</h3>
                <button type="button" class="panel-icono" data-cerrar aria-label="Cerrar"><i class="fas fa-times"></i></button>
            </header>
            <div class="panel-dialogo-cuerpo">${html}</div>
        </div>`;
    const anterior = document.activeElement;
    const cerrar = () => {
        fondo.remove();
        document.removeEventListener('keydown', tecla);
        anterior?.focus?.();
    };
    const tecla = e => { if (e.key === 'Escape') cerrar(); };
    fondo.addEventListener('click', e => { if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar(); });
    document.addEventListener('keydown', tecla);
    document.body.appendChild(fondo);
    // Foco inmediato: un foco diferido podría saltar al primer campo mientras ya se escribe en otro
    fondo.querySelector('input,select,textarea,button:not([data-cerrar])')?.focus();
    return { fondo, cuerpo: fondo.querySelector('.panel-dialogo-cuerpo'), cerrar };
}

// Confirmación explícita para acciones destructivas o difíciles de revertir
export function confirmar(mensaje, { textoOk = 'Confirmar', peligro = false } = {}) {
    return new Promise(resolver => {
        let respondido = false;
        const { cuerpo, cerrar } = dialogo({
            titulo: 'Confirmar acción',
            ancho: 'sm',
            html: `<p class="panel-texto">${esc(mensaje)}</p>
                   <div class="panel-acciones">
                       <button type="button" class="panel-btn" data-no>Volver</button>
                       <button type="button" class="panel-btn ${peligro ? 'panel-btn-peligro' : 'panel-btn-principal'}" data-si>${esc(textoOk)}</button>
                   </div>`
        });
        const responder = valor => { respondido = true; cerrar(); resolver(valor); };
        cuerpo.querySelector('[data-si]').addEventListener('click', () => responder(true));
        cuerpo.querySelector('[data-no]').addEventListener('click', () => responder(false));
        const observador = new MutationObserver(() => {
            if (!cuerpo.isConnected) { observador.disconnect(); if (!respondido) resolver(false); }
        });
        observador.observe(document.body, { childList: true });
    });
}

// Ejecuta una operación y solo informa éxito si el servidor la guardó
export async function ejecutar(boton, operacion, notificar, mensajeOk) {
    if (boton) boton.disabled = true;
    try {
        const resultado = await operacion();
        if (mensajeOk) notificar(mensajeOk);
        return resultado;
    } catch (e) {
        notificar(e.message || mensajeError(e), 'error');
        return undefined;
    } finally {
        if (boton) boton.disabled = false;
    }
}

// ---------- CSV ----------
export function descargarCSV(nombre, filas) {
    const celda = v => {
        let texto = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`; // evita fórmulas al abrir en Excel
        return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };
    const contenido = '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    setTimeout(() => { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1000);
}

// ---------- Imágenes ----------
// Se reduce en el navegador y se guarda como data URL (sin servicio de archivos).
export function imagenADataURL(archivo, lado = 800) {
    return new Promise((resolver, rechazar) => {
        if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) return rechazar(new Error('Usa una imagen JPG, PNG o WebP.'));
        const img = new Image();
        img.onload = () => {
            const escala = Math.min(1, lado / Math.max(img.width, img.height));
            const lienzo = document.createElement('canvas');
            lienzo.width = Math.round(img.width * escala);
            lienzo.height = Math.round(img.height * escala);
            lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
            URL.revokeObjectURL(img.src);
            for (const calidad of [0.82, 0.7, 0.55, 0.4]) {
                const url = lienzo.toDataURL('image/webp', calidad);
                if (url.length < 850000) return resolver(url.startsWith('data:image/webp') ? url : lienzo.toDataURL('image/jpeg', calidad));
            }
            rechazar(new Error('La imagen es demasiado grande. Usa una más pequeña.'));
        };
        img.onerror = () => rechazar(new Error('No se pudo leer la imagen.'));
        img.src = URL.createObjectURL(archivo);
    });
}

export function telefonoWhatsApp(telefono) {
    const digitos = String(telefono || '').replace(/\D/g, '');
    return digitos.length === 10 ? `1${digitos}` : digitos;
}

export function vacio(texto, icono = 'inbox') {
    return `<div class="panel-vacio"><i class="fas fa-${icono}"></i><p>${esc(texto)}</p></div>`;
}
