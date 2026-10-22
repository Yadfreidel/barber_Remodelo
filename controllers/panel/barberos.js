// ==========================================
// PANEL: BARBEROS Y ACCESOS
// ==========================================

import { obtenerBarberosLocales } from '../../models/barberModel.js';
import { api, esc, dialogo, confirmar, ejecutar, imagenADataURL, vacio } from './comun.js';
import { servicioEfectivo } from './servicios.js';
import { invalidarCatalogosAgenda } from './agenda.js';

export async function renderBarberos(cont, ctx) {
    cont.innerHTML = '<p class="panel-cargando">Cargando barberos…</p>';
    let barberos, servicios;
    try { [barberos, servicios] = await Promise.all([api('panel_barberos'), api('panel_servicios')]); }
    catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    servicios = servicios.filter(s => s.activo).map(servicioEfectivo);
    const recargar = () => { invalidarCatalogosAgenda(); renderBarberos(cont, ctx); };

    // Datos que el panel anterior guardaba solo en este navegador (fotos y especialidades)
    const locales = obtenerBarberosLocales().filter(l => {
        const b = barberos.find(x => x.nombre.toLowerCase() === l.nombre.toLowerCase());
        return b && ((l.imagen && !b.foto_url) || (l.especialidad && !b.especialidad));
    });

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Barberos</h2><p class="panel-sub">Desactivar oculta al barbero de la web y le quita el acceso, sin borrar su historial.</p></div>
            <button type="button" class="panel-btn panel-btn-principal" data-nuevo><i class="fas fa-user-plus"></i> Agregar barbero</button>
        </div>
        ${locales.length ? `<div class="panel-aviso">Este navegador tiene fotos o especialidades de ${locales.length} barbero(s) que aún no están en el servidor.
            <button type="button" class="panel-btn panel-btn-mini" data-importar>Importar al servidor</button></div>` : ''}
        <div class="barberos-rejilla">${barberos.length ? barberos.map(b => `
            <article class="barbero-tarjeta ${b.activo ? '' : 'inactivo'}">
                <div class="barbero-foto">${b.foto_url ? `<img src="${esc(b.foto_url)}" alt="">` : '<i class="fas fa-user"></i>'}</div>
                <div class="barbero-info">
                    <strong>${esc(b.nombre)}</strong> ${b.activo ? '' : '<span class="estado-chip estado-cancelada">Inactivo</span>'}
                    <small>${esc(b.especialidad || 'Sin especialidad')}</small>
                    <small>${b.servicios.length === servicios.length ? 'Todos los servicios' : `${b.servicios.length} de ${servicios.length} servicios`}
                        ${b.citas_futuras ? ` · ${b.citas_futuras} cita(s) futura(s)` : ''}</small>
                    <small><i class="fas fa-key"></i> ${b.usuario ? `Acceso: ${esc(b.usuario)}` : 'Sin acceso al panel'}</small>
                </div>
                <div class="barbero-acciones">
                    <button type="button" class="panel-btn" data-editar="${esc(b.id)}">Editar</button>
                    <button type="button" class="panel-btn" data-horario="${esc(b.id)}"><i class="fas fa-clock"></i> Horario</button>
                    <button type="button" class="panel-btn ${b.activo ? 'panel-btn-peligro' : ''}" data-alternar="${esc(b.id)}">${b.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
            </article>`).join('') : vacio('Aún no hay barberos.', 'users')}</div>`;

    const buscar = id => barberos.find(b => b.id === id);
    const guardar = (b, cambios) => api('panel_guardar_barbero', { p_id: b.id, p_datos: {
        nombre: b.nombre, especialidad: b.especialidad || '', foto_url: b.foto_url || '', activo: b.activo, ...cambios } });

    cont.querySelector('[data-nuevo]').addEventListener('click', () => abrirBarbero(ctx, null, servicios, recargar));
    cont.querySelectorAll('[data-editar]').forEach(x => x.addEventListener('click', () => abrirBarbero(ctx, buscar(x.dataset.editar), servicios, recargar)));
    cont.querySelectorAll('[data-horario]').forEach(x => x.addEventListener('click', () => ctx.irA('horarios', { barbero: x.dataset.horario })));
    cont.querySelectorAll('[data-alternar]').forEach(x => x.addEventListener('click', async () => {
        const b = buscar(x.dataset.alternar);
        if (b.activo && !await confirmar(`¿Desactivar a ${b.nombre}? No aparecerá en la web ni podrá entrar al panel.${b.citas_futuras ? ` Tiene ${b.citas_futuras} cita(s) futura(s) que se conservan: reprográmalas desde la Agenda.` : ''}`, { textoOk: 'Desactivar', peligro: true })) return;
        if (await ejecutar(x, () => guardar(b, { activo: !b.activo }), ctx.notificar, b.activo ? 'Barbero desactivado' : 'Barbero activado')) recargar();
    }));
    cont.querySelector('[data-importar]')?.addEventListener('click', async e => {
        const resultado = await ejecutar(e.currentTarget, async () => {
            for (const l of locales) {
                const b = barberos.find(x => x.nombre.toLowerCase() === l.nombre.toLowerCase());
                await guardar(b, { foto_url: b.foto_url || (/^(https:\/\/|assets\/|data:image\/)/.test(l.imagen || '') ? l.imagen : ''), especialidad: b.especialidad || l.especialidad || '' });
            }
            return true;
        }, ctx.notificar, 'Datos importados al servidor');
        if (resultado) recargar();
    });
}

function abrirBarbero(ctx, b, servicios, recargar) {
    let foto = b?.foto_url || '';
    const { cuerpo, cerrar } = dialogo({ titulo: b ? `Editar: ${b.nombre}` : 'Agregar barbero', ancho: 'lg', html: `
        <form class="panel-form" novalidate>
            <div class="servicio-editor">
                <div class="servicio-editor-foto">
                    <div class="barbero-foto grande" data-vista>${foto ? `<img src="${esc(foto)}" alt="">` : '<i class="fas fa-user"></i>'}</div>
                    <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Subir foto<input type="file" accept="image/png,image/jpeg,image/webp" data-archivo hidden></label>
                </div>
                <div>
                    <label>Nombre<input name="nombre" required maxlength="80" value="${esc(b?.nombre || '')}"></label>
                    <label>Especialidades<input name="especialidad" maxlength="200" value="${esc(b?.especialidad || '')}" placeholder="Ej.: degradados, barba con navaja"></label>
                    <label class="panel-check"><input type="checkbox" name="activo" ${b ? (b.activo ? 'checked' : '') : 'checked'}> Activo</label>
                    <fieldset class="panel-fieldset"><legend>Servicios que realiza</legend>
                        <div class="panel-fila panel-fila-checks">${servicios.map(s => `<label class="panel-check"><input type="checkbox" name="servicios" value="${esc(s.id)}" ${!b || b.servicios.includes(s.id) ? 'checked' : ''}> ${esc(s.nombre)}</label>`).join('')}</div>
                    </fieldset>
                    ${b ? `<fieldset class="panel-fieldset"><legend>Acceso al panel (rol barbero)</legend>
                        <p class="panel-sub">Solo verá su agenda y podrá confirmar, completar, marcar ausencias y anotar. La cuenta se crea en Authentication de Supabase (o con <code>npm run local:usuario</code> en local).</p>
                        <div class="panel-fila"><input type="email" name="usuario" value="${esc(b.usuario || '')}" placeholder="correo@ejemplo.com" aria-label="Correo de acceso">
                        <button type="button" class="panel-btn" data-vincular>${b.usuario ? 'Cambiar acceso' : 'Dar acceso'}</button>
                        ${b.usuario ? '<button type="button" class="panel-btn panel-btn-peligro" data-quitar-acceso>Quitar acceso</button>' : ''}</div>
                    </fieldset>` : ''}
                </div>
            </div>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-archivo]').addEventListener('change', async e => {
        if (!e.target.files[0]) return;
        try { foto = await imagenADataURL(e.target.files[0], 600); cuerpo.querySelector('[data-vista]').innerHTML = `<img src="${esc(foto)}" alt="">`; }
        catch (err) { ctx.notificar(err.message, 'error'); }
    });
    const vincular = async (boton, email) => {
        if (await ejecutar(boton, () => api('panel_vincular_usuario_barbero', { p_barbero: b.id, p_email: email }), ctx.notificar, email ? 'Acceso actualizado' : 'Acceso quitado')) { cerrar(); recargar(); }
    };
    cuerpo.querySelector('[data-vincular]')?.addEventListener('click', e => {
        const email = form.elements.usuario.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ctx.notificar('Escribe un correo válido.', 'error'); return; }
        vincular(e.currentTarget, email);
    });
    cuerpo.querySelector('[data-quitar-acceso]')?.addEventListener('click', async e => {
        if (await confirmar(`¿Quitar el acceso al panel de ${b.nombre}?`, { textoOk: 'Quitar acceso', peligro: true })) vincular(e.currentTarget, '');
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = new FormData(form);
        if (!d.get('nombre').trim()) { ctx.notificar('Escribe el nombre.', 'error'); return; }
        const datos = { nombre: d.get('nombre').trim(), especialidad: d.get('especialidad').trim(), foto_url: foto,
            activo: form.elements.activo.checked, servicios: d.getAll('servicios') };
        if (await ejecutar(e.submitter, () => api('panel_guardar_barbero', { p_id: b?.id || null, p_datos: datos }), ctx.notificar, b ? 'Barbero actualizado' : 'Barbero agregado')) {
            cerrar();
            recargar();
        }
    });
}
