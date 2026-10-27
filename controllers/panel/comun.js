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
    usuario_no_encontrado: 'No existe una cuenta con ese correo. Créala con «Habilitar acceso» y una contraseña temporal.',
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
    // Inventario, ventas y caja
    sin_stock: 'No hay existencias suficientes.',
    caja_cerrada: 'La caja está cerrada: ábrela para cobrar o devolver en efectivo.',
    caja_ya_abierta: 'Ya hay una caja abierta.',
    caja_no_cerrada: 'Solo se corrigen cajas cerradas.',
    caja_de_gasto_cerrada: 'La caja de ese gasto ya se cerró: registra una entrada en la caja actual para compensarlo.',
    pago_excede_saldo: 'El pago supera el saldo pendiente.',
    efectivo_insuficiente_en_caja: 'No hay tanto efectivo en la caja.',
    efectivo_insuficiente: 'El efectivo recibido es menor que el importe a cobrar.',
    motivo_descuento_requerido: 'Escribe el motivo del descuento.',
    descuento_invalido: 'El descuento no puede superar el importe de la línea.',
    barbero_requerido: 'Indica el barbero que realiza el servicio.',
    producto_no_vendible: 'Ese artículo no está a la venta (inactivo, sin precio o es un insumo).',
    venta_sin_cliente_debe_pagarse: 'Sin cliente identificado la venta debe pagarse completa (o indica el teléfono del cliente).',
    reembolsa_antes_de_anular: 'Devuelve primero el dinero cobrado; después podrás anular la venta.',
    ventas_reembolso_valido: 'No se puede devolver más dinero del cobrado.',
    ventas_sin_saldo_a_favor: 'Al devolver productos o servicios ya pagados, devuelve también ese dinero.',
    ventas_devolucion_valida: 'La devolución supera el total de la venta.',
    ventas_cita_activa: 'Esa cita ya tiene una venta.',
    importe_devolucion_invalido: 'Revisa el importe a devolver.',
    cantidad_devolucion_invalida: 'Revisa la cantidad a devolver.',
    venta_no_disponible: 'La venta no existe o está anulada.',
    venta_vacia: 'Agrega al menos un servicio o producto.',
    operacion_vacia: 'No hay nada que registrar.',
    observacion_requerida: 'Hay diferencia entre lo contado y lo esperado: escribe una observación.',
    pago_excede_compra: 'El pago supera lo que falta por pagar de esa compra.',
    compra_con_pagos: 'La compra tiene pagos: anúlalos antes.',
    compra_no_disponible: 'La compra no existe o está anulada.',
    compra_vacia: 'Agrega al menos un artículo a la compra.',
    codigo_duplicado: 'Ya existe un artículo con ese código.',
    producto_duplicado: 'Ya existe un artículo con ese nombre.',
    producto_invalido: 'Revisa los datos del artículo (nombre, código, unidad y precio de venta).',
    producto_no_encontrado: 'No se encontró el artículo.',
    unidad_con_movimientos: 'No se puede cambiar la unidad de un artículo con movimientos.',
    unidades_incompatibles: 'La unidad no es compatible con la del artículo (ml con litros, g con kg).',
    sin_diferencia: 'El conteo coincide con la existencia: no hay nada que ajustar.',
    inicial_no_permitida: 'La existencia inicial solo se registra en artículos sin movimientos.',
    cantidad_invalida: 'Revisa la cantidad (las unidades y pares van sin decimales).',
    linea_invalida: 'Revisa las cantidades y precios.',
    tipo_movimiento_invalido: 'Tipo de movimiento no válido.',
    gasto_no_disponible: 'El gasto no existe o ya está anulado.',
    monto_invalido: 'Revisa el importe.',
    fecha_invalida: 'Revisa la fecha.',
    imagen_invalida: 'La imagen no es válida. Usa JPG, PNG o WebP.',
    proveedor_duplicado: 'Ya existe un proveedor con ese nombre.',
    proveedor_invalido: 'Revisa los datos del proveedor.',
    proveedor_no_encontrado: 'No se encontró el proveedor.',
    cita_sin_cobro: 'La cita no tiene cobros que anular.',
    clave_operacion_usada: 'Operación repetida con otros datos. Vuelve a abrir la pantalla.',
    registro_inmutable: 'Las operaciones confirmadas no se modifican: usa una devolución o anulación.',
    usa_cobro_de_cita: 'Los productos reservados se entregan al cobrar la cita.',
    // Portafolio
    autorizacion_requerida: 'Se reconoce a una persona: vincula una autorización de imagen vigente antes de publicar.',
    autorizacion_no_encontrada: 'La autorización no existe o ya fue retirada.',
    autorizacion_invalida: 'Revisa el nombre, el alcance y la fecha de la autorización (no puede ser futura).',
    representante_requerido: 'Para un menor indica el nombre y la relación de su madre, padre o tutor.',
    trabajo_bloqueado: 'Este trabajo ya fue publicado o archivado: solo el administrador puede modificarlo.',
    trabajo_no_encontrado: 'El trabajo ya no existe.',
    trabajo_invalido: 'Revisa el título (máx. 80), la descripción (máx. 300) y el texto alternativo (3 a 200).',
    limite_portafolio: 'Se alcanzó el límite de 120 trabajos activos para este barbero. Archiva alguno antes.',
    transicion_invalida: 'El elemento ya cambió de estado. Actualiza la lista.',
    perfil_invalido: 'La presentación admite 500 caracteres y hasta 8 especialidades de 40 caracteres.',
    // Reclamaciones
    reclamacion_no_encontrada: 'No se encontró la reclamación.',
    solucion_requerida: 'Escribe la solución antes de marcarla como resuelta.',
    usa_reabrir: 'El caso está resuelto o cerrado: usa «Reabrir» con un motivo.',
    reembolso_no_encontrado: 'Esa venta no tiene un reembolso o devolución registrada (regístralo antes en Ventas y cobros).',
    reclamacion_cerrada: 'El caso está cerrado: reábrelo para escribir.',
    descripcion_invalida: 'Describe lo ocurrido (entre 10 y 2000 caracteres).',
    categoria_invalida: 'Elige una categoría válida.',
    responsable_invalido: 'Ese usuario no puede ser responsable.',
    adjuntos_invalidos: 'Máximo 3 imágenes por mensaje y 12 por caso.',
    limite_reclamaciones: 'Esa cita ya tiene 3 reclamaciones abiertas.',
    // Cuentas, permisos, atención y disponibilidad
    cambio_clave_requerido: 'Cambia tu contraseña temporal para continuar.',
    clave_sin_cambiar: 'La contraseña aún no ha cambiado. Escribe una nueva distinta de la temporal.',
    cuenta_existente: 'Ese correo ya tiene una cuenta: confirma la vinculación (no se cambia su contraseña ni sus permisos).',
    cuenta_vinculada_otro: 'Esa cuenta ya está vinculada con otro barbero.',
    barbero_con_cuenta: 'Este barbero ya tiene una cuenta vinculada. Quita el acceso actual antes de vincular otra.',
    barbero_sin_cuenta: 'Este barbero no tiene una cuenta vinculada.',
    permiso_invalido: 'Permiso no válido.',
    correo_no_verificado: 'El correo de la cuenta aún no está verificado.',
    ya_tiene_acceso: 'Tu cuenta ya tiene acceso al panel.',
    solicitud_no_encontrada: 'La solicitud ya no existe.',
    solicitud_duplicada: 'Ya enviaste una solicitud igual que está pendiente.',
    demasiadas_solicitudes: 'Tienes demasiadas solicitudes pendientes.',
    cita_no_es_hoy: 'Solo se inicia el servicio el día de la cita.',
    'Failed to fetch': 'Sin conexión: la operación NO se confirmó. Revisa la conexión y vuelve a intentarlo (no se duplicará).',
    NetworkError: 'Sin conexión: la operación NO se confirmó. Revisa la conexión y vuelve a intentarlo (no se duplicará).',
    'Load failed': 'Sin conexión: la operación NO se confirmó. Revisa la conexión y vuelve a intentarlo (no se duplicará).',
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
    // sin_stock indica en el detalle qué artículo se agotó
    if (error) throw new Error(mensajeError(error) + (/sin_stock/.test(error.message) && error.details ? ` (${error.details})` : ''));
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
// cabecera: HTML propio (ya escapado) en lugar del título simple; clase: estilos de un diálogo concreto
export function dialogo({ titulo, html, ancho = 'md', cabecera = null, clase = '' }) {
    const fondo = document.createElement('div');
    fondo.className = 'panel-dialogo-fondo';
    fondo.innerHTML = `
        <div class="panel-dialogo panel-dialogo-${ancho}${clase ? ` ${clase}` : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
            <header class="panel-dialogo-cabecera">
                ${cabecera ?? `<h3>${esc(titulo)}</h3>`}
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
