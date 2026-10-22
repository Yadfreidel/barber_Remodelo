// ==========================================
// PANEL: WHATSAPP
// Dos vías distintas: (1) abrir WhatsApp con texto preparado (manual, desde la cita)
// y (2) envío automático por la integración existente (Meta Cloud API).
// ==========================================

import { api, esc, ejecutar } from './comun.js';

const TIPOS = { confirmacion: 'Confirmación', recordatorio: 'Recordatorio', cancelacion: 'Cancelación', reprogramacion: 'Reprogramación' };
const VARIABLES = ['cliente', 'servicio', 'barbero', 'fecha', 'hora', 'ubicacion', 'mapa'];
const EJEMPLO = { cliente: 'María Pérez', servicio: 'Degradado bajo', barbero: 'Isaac Garcia', fecha: 'viernes, 24 de octubre', hora: '10:00',
    ubicacion: 'Barbería Master - Av. Principal 10', mapa: 'https://www.google.com/maps/dir/?api=1&destination=18.48,-69.93' };
const ESTADOS_ENVIO = { pendiente: 'En cola', enviando: 'Enviando', enviado: 'Enviados', fallido: 'Fallidos', omitido: 'Omitidos' };

export async function renderWhatsApp(cont, ctx) {
    cont.innerHTML = '<p class="panel-cargando">Cargando plantillas…</p>';
    let datos;
    try { datos = await api('panel_plantillas'); } catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    const conteo = datos.mensajes || {};

    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>WhatsApp</h2>
            <p class="panel-sub">El texto se usa al pulsar "Abrir WhatsApp con texto" en una cita (envío manual desde tu teléfono).</p></div></div>
        <section class="panel-caja ${datos.envio_automatico_activo ? '' : 'panel-aviso'}">
            <h3><i class="fas fa-robot"></i> Envío automático: ${datos.envio_automatico_activo ? 'módulo activado' : 'desactivado'}</h3>
            <p class="panel-sub">${datos.envio_automatico_activo
                ? 'Se encolan avisos para las plantillas con nombre de Meta. El envío real lo hace la función whatsapp-enviar con las credenciales de Meta; el estado mostrado es el que devuelve la integración.'
                : 'Para enviar sin intervención se necesita activar el módulo WhatsApp (Módulos), configurar las credenciales de Meta en Supabase y tener cada plantilla aprobada por Meta. Mientras tanto no se envía nada automáticamente.'}</p>
            <p>Últimos 30 días: ${Object.keys(ESTADOS_ENVIO).map(k => `<span class="estado-chip envio-${k}">${ESTADOS_ENVIO[k]}: ${conteo[k] || 0}</span>`).join(' ')}</p>
        </section>
        <div class="plantillas-lista">${datos.plantillas.map(p => `
            <form class="panel-form panel-caja" data-tipo="${esc(p.tipo)}" novalidate>
                <h3>${esc(TIPOS[p.tipo])}</h3>
                <label>Texto (para abrir WhatsApp)<textarea name="texto" rows="5" maxlength="1000">${esc(p.texto)}</textarea></label>
                <p class="panel-sub">Variables: ${VARIABLES.map(v => `<button type="button" class="panel-variable" data-var="${v}">{${v}}</button>`).join(' ')}</p>
                <label>Nombre de la plantilla aprobada en Meta (envío automático)
                    <input name="meta" value="${esc(p.meta_plantilla)}" placeholder="ej. cita_${esc(p.tipo)}" pattern="[a-z0-9_]*"></label>
                <p class="panel-sub">Parámetros que recibe la plantilla de Meta, en orden: {{1}} cliente, {{2}} servicio, {{3}} barbero, {{4}} fecha, {{5}} hora, {{6}} ubicación, {{7}} enlace de gestión.${p.tipo === 'recordatorio' ? ' El recordatorio usa la configuración existente del módulo (horas antes, botones).' : ''}</p>
                <div class="plantilla-preview"><strong>Vista previa</strong><pre data-preview></pre></div>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar ${esc(TIPOS[p.tipo].toLowerCase())}</button>
            </form>`).join('')}</div>`;

    cont.querySelectorAll('form[data-tipo]').forEach(form => {
        const area = form.elements.texto;
        const preview = form.querySelector('[data-preview]');
        const pintar = () => { preview.textContent = area.value.replace(/\{(\w+)\}/g, (m, k) => EJEMPLO[k] ?? m); };
        area.addEventListener('input', pintar);
        pintar();
        form.querySelectorAll('[data-var]').forEach(b => b.addEventListener('click', () => {
            const pos = area.selectionStart ?? area.value.length;
            area.value = `${area.value.slice(0, pos)}{${b.dataset.var}}${area.value.slice(area.selectionEnd ?? pos)}`;
            area.focus();
            pintar();
        }));
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const meta = form.elements.meta.value.trim();
            if (!area.value.trim()) { ctx.notificar('El texto no puede quedar vacío.', 'error'); return; }
            if (meta && !/^[a-z0-9_]+$/.test(meta)) { ctx.notificar('El nombre de Meta solo admite minúsculas, números y guiones bajos.', 'error'); return; }
            await ejecutar(e.submitter, () => api('panel_guardar_plantilla', { p_tipo: form.dataset.tipo, p_texto: area.value, p_meta: meta }), ctx.notificar, 'Plantilla guardada');
        });
    });
}
