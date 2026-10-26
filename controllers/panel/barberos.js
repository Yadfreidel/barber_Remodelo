// ==========================================
// PANEL: BARBEROS Y ACCESOS
// ==========================================

import { obtenerBarberosLocales } from '../../models/barberModel.js';
import { api, esc, dialogo, confirmar, ejecutar, imagenADataURL, vacio } from './comun.js';
import { servicioEfectivo } from './servicios.js';
import { invalidarCatalogosAgenda } from './agenda.js';
import { habilitarAcceso, enviarRestablecimiento, mensajeAlta, generarClaveTemporal, PERMISOS, CORREO } from './cuentas.js';

export async function renderBarberos(cont, ctx) {
    cont.innerHTML = '<p class="panel-cargando">Cargando barberos…</p>';
    let barberos, servicios, cuentas;
    try { [barberos, servicios, cuentas] = await Promise.all([api('panel_barberos'), api('panel_servicios'), api('panel_cuentas_barberos')]); }
    catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    servicios = servicios.filter(s => s.activo).map(servicioEfectivo);
    const cuentaDe = b => cuentas.find(c => c.barbero_id === String(b.id)) || null;
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
                    <small><i class="fas fa-key"></i> ${(c => c ? `Acceso: ${esc(c.email)}${c.verificado ? '' : ' · correo sin verificar'}${c.debe_cambiar_clave ? ' · debe cambiar la contraseña temporal' : ''}${c.permisos.length ? ` · ${c.permisos.map(x => esc(x)).join(', ')}` : ''}`
                        : 'Sin acceso al panel')(cuentaDe(b))}</small>
                </div>
                <div class="barbero-acciones">
                    <button type="button" class="panel-btn" data-editar="${esc(b.id)}">Editar</button>
                    <button type="button" class="panel-btn" data-horario="${esc(b.id)}"><i class="fas fa-clock"></i> Horario</button>
                    <button type="button" class="panel-btn" data-portafolio="${esc(b.id)}"><i class="fas fa-images"></i> Portafolio</button>
                    ${cuentaDe(b) ? '' : `<button type="button" class="panel-btn" data-habilitar="${esc(b.id)}"><i class="fas fa-key"></i> Habilitar acceso</button>`}
                    <button type="button" class="panel-btn ${b.activo ? 'panel-btn-peligro' : ''}" data-alternar="${esc(b.id)}">${b.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
            </article>`).join('') : vacio('Aún no hay barberos.', 'users')}</div>`;

    const buscar = id => barberos.find(b => b.id === id);
    const guardar = (b, cambios) => api('panel_guardar_barbero', { p_id: b.id, p_datos: {
        nombre: b.nombre, especialidad: b.especialidad || '', foto_url: b.foto_url || '', activo: b.activo, ...cambios } });

    cont.querySelector('[data-nuevo]').addEventListener('click', () => abrirBarbero(ctx, null, servicios, null, recargar));
    cont.querySelectorAll('[data-editar]').forEach(x => x.addEventListener('click', () => { const b = buscar(x.dataset.editar); abrirBarbero(ctx, b, servicios, cuentaDe(b), recargar); }));
    cont.querySelectorAll('[data-habilitar]').forEach(x => x.addEventListener('click', () => abrirHabilitar(ctx, buscar(x.dataset.habilitar), recargar)));
    cont.querySelectorAll('[data-horario]').forEach(x => x.addEventListener('click', () => ctx.irA('horarios', { barbero: x.dataset.horario })));
    cont.querySelectorAll('[data-portafolio]').forEach(x => x.addEventListener('click', () => ctx.irA('portafolio', { barbero: x.dataset.portafolio })));
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

const permisosHtml = (marcados = []) => Object.entries(PERMISOS).map(([k, v]) =>
    `<label class="panel-check"><input type="checkbox" name="permisos" value="${k}" ${marcados.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('');

// Habilitar acceso a un perfil sin cuenta (cuenta nueva con contraseña temporal o cuenta existente)
function abrirHabilitar(ctx, b, recargar) {
    const { cuerpo, cerrar } = dialogo({ titulo: `Habilitar acceso: ${b.nombre}`, ancho: 'md', html: `
        <form class="panel-form" novalidate>
            <label>Correo de acceso<input type="email" name="email" autocomplete="off" required></label>
            <label>Contraseña temporal (solo para una cuenta nueva)<span class="panel-fila"><input type="text" name="clave" minlength="8" maxlength="72" autocomplete="new-password">
                <button type="button" class="panel-btn panel-btn-mini" data-generar>Generar</button></span></label>
            <p class="panel-sub">Entrégasela al barbero en persona: no se guarda ni se vuelve a mostrar. Al entrar deberá cambiarla.
                Si el correo ya tiene una cuenta, se vincula sin cambiar su contraseña.</p>
            <fieldset class="panel-fieldset"><legend>Permisos adicionales</legend>${permisosHtml()}</fieldset>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Habilitar acceso</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    form.querySelector('[data-generar]').addEventListener('click', () => { form.elements.clave.value = generarClaveTemporal(); });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const boton = e.submitter;
        if (boton.disabled) return;
        boton.disabled = true;
        try {
            const r = await habilitarAcceso(b.id, { email: form.elements.email.value, clave: form.elements.clave.value,
                permisos: [...form.querySelectorAll('[name=permisos]:checked')].map(x => x.value) });
            if (r) { form.elements.clave.value = ''; cerrar(); ctx.notificar(mensajeAlta(r), r.pendienteConfirmar ? 'info' : 'success'); recargar(); }
        } catch (err) { ctx.notificar(err.message, 'error'); }
        finally { boton.disabled = false; }
    });
}

async function abrirBarbero(ctx, b, servicios, cuenta, recargar) {
    let foto = b?.foto_url || '';
    let perfil = { presentacion: '', especialidades: [] };
    if (b) { try { perfil = await api('panel_barbero_perfil', { p_barbero: b.id }) || perfil; } catch { /* se edita igual */ } }
    const { cuerpo, cerrar } = dialogo({ titulo: b ? `Editar: ${b.nombre}` : 'Agregar barbero', ancho: 'lg', html: `
        <form class="panel-form" novalidate>
            <div class="servicio-editor">
                <div class="servicio-editor-foto">
                    <div class="barbero-foto grande" data-vista>${foto ? `<img src="${esc(foto)}" alt="">` : '<i class="fas fa-user"></i>'}</div>
                    <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Subir foto<input type="file" accept="image/png,image/jpeg,image/webp" data-archivo hidden></label>
                </div>
                <div>
                    <label>Nombre<input name="nombre" required maxlength="80" value="${esc(b?.nombre || '')}"></label>
                    <label>Lema o especialidad principal<input name="especialidad" maxlength="200" value="${esc(b?.especialidad || '')}" placeholder="Ej.: degradados, barba con navaja"></label>
                    <label>Presentación (perfil público)<textarea name="presentacion" rows="3" maxlength="500">${esc(perfil.presentacion || '')}</textarea></label>
                    <label>Especialidades (separadas por comas, máx. 8)<input name="especialidades" maxlength="400" value="${esc((perfil.especialidades || []).join(', '))}"></label>
                    <label class="panel-check"><input type="checkbox" name="activo" ${b ? (b.activo ? 'checked' : '') : 'checked'}> Activo</label>
                    <fieldset class="panel-fieldset"><legend>Servicios que realiza</legend>
                        <div class="panel-fila panel-fila-checks">${servicios.map(s => `<label class="panel-check"><input type="checkbox" name="servicios" value="${esc(s.id)}" ${!b || b.servicios.includes(s.id) ? 'checked' : ''}> ${esc(s.nombre)}</label>`).join('')}</div>
                    </fieldset>
                    <fieldset class="panel-fieldset"><legend>Acceso al panel (rol barbero)</legend>
                        ${!b ? `<p class="panel-sub">Opcional. Verá solo su agenda, su atención, su portafolio, sus ingresos y sus casos asignados.</p>
                            <label>Correo de acceso<input type="email" name="email" autocomplete="off"></label>
                            <label>Contraseña temporal<span class="panel-fila"><input type="text" name="clave" minlength="8" maxlength="72" autocomplete="new-password">
                                <button type="button" class="panel-btn panel-btn-mini" data-generar>Generar</button></span></label>
                            <p class="panel-sub">Entrégasela en persona: no se guarda ni se vuelve a mostrar. Deberá cambiarla al entrar.</p>
                            ${permisosHtml()}`
                        : cuenta ? `<p class="panel-sub"><strong>${esc(cuenta.email)}</strong>${cuenta.verificado ? '' : ' · correo sin verificar'}${cuenta.debe_cambiar_clave ? ' · pendiente de cambiar la contraseña temporal' : ''}
                                ${cuenta.ultimo_acceso ? ` · último acceso ${esc(new Date(cuenta.ultimo_acceso).toLocaleString('es-DO'))}` : ''}</p>
                            <div data-permisos>${permisosHtml(cuenta.permisos)}</div>
                            <div class="panel-fila"><button type="button" class="panel-btn" data-guardar-permisos>Guardar permisos</button>
                                <button type="button" class="panel-btn" data-restablecer><i class="fas fa-envelope"></i> Enviar enlace para restablecer contraseña</button>
                                <button type="button" class="panel-btn panel-btn-peligro" data-quitar-acceso>Quitar acceso</button></div>
                            <p class="panel-sub">El correo de la cuenta lo cambia el propio barbero desde «Mi perfil» (se confirma por correo).</p>`
                        : `<p class="panel-sub">Sin cuenta vinculada.</p><button type="button" class="panel-btn" data-habilitar><i class="fas fa-key"></i> Habilitar acceso</button>`}
                    </fieldset>
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
    const permisosMarcados = () => [...form.querySelectorAll('[name=permisos]:checked')].map(x => x.value);
    cuerpo.querySelector('[data-generar]')?.addEventListener('click', () => { form.elements.clave.value = generarClaveTemporal(); });
    cuerpo.querySelector('[data-habilitar]')?.addEventListener('click', () => { cerrar(); abrirHabilitar(ctx, b, recargar); });
    cuerpo.querySelector('[data-guardar-permisos]')?.addEventListener('click', async e => {
        if (await ejecutar(e.currentTarget, () => api('panel_cuenta_permisos', { p_barbero: b.id, p_permisos: permisosMarcados() }), ctx.notificar, 'Permisos actualizados')) recargar();
    });
    cuerpo.querySelector('[data-restablecer]')?.addEventListener('click', async e => {
        await ejecutar(e.currentTarget, () => enviarRestablecimiento(cuenta.email), ctx.notificar, `Enlace enviado a ${cuenta.email}`);
    });
    cuerpo.querySelector('[data-quitar-acceso]')?.addEventListener('click', async e => {
        if (!await confirmar(`¿Quitar el acceso al panel de ${b.nombre}? Su cuenta no se borra (si también es cliente, conserva su historial).`, { textoOk: 'Quitar acceso', peligro: true })) return;
        if (await ejecutar(e.currentTarget, () => api('panel_cuenta_desvincular', { p_barbero: b.id }), ctx.notificar, 'Acceso quitado')) { cerrar(); recargar(); }
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const boton = e.submitter;
        if (boton.disabled) return;
        const d = new FormData(form);
        if (!d.get('nombre').trim()) { ctx.notificar('Escribe el nombre.', 'error'); return; }
        const especialidades = String(d.get('especialidades') || '').split(',').map(x => x.trim()).filter(Boolean);
        if (especialidades.length > 8 || especialidades.some(x => x.length > 40)) { ctx.notificar('Máximo 8 especialidades de 40 caracteres.', 'error'); return; }
        const email = String(d.get('email') || '').trim();
        if (!b && email && (!CORREO.test(email) || String(d.get('clave') || '').length < 8)) {
            ctx.notificar('Para crear el acceso escribe un correo válido y una contraseña temporal de al menos 8 caracteres.', 'error'); return;
        }
        const datos = { nombre: d.get('nombre').trim(), especialidad: d.get('especialidad').trim(), foto_url: foto,
            activo: form.elements.activo.checked, servicios: d.getAll('servicios') };
        boton.disabled = true;
        let id = b?.id;
        try {
            id = (await api('panel_guardar_barbero', { p_id: b?.id || null, p_datos: datos })).id || id;
            await api('panel_barbero_perfil_guardar', { p_barbero: String(id), p_datos: { presentacion: d.get('presentacion').trim(), especialidades } });
        } catch (err) { ctx.notificar(err.message, 'error'); boton.disabled = false; return; }
        if (!b && email) {
            try {
                const r = await habilitarAcceso(id, { email, clave: d.get('clave'), permisos: permisosMarcados() });
                ctx.notificar(r ? mensajeAlta(r) : 'Barbero agregado sin acceso', r?.pendienteConfirmar ? 'info' : 'success');
            } catch (err) {
                // El perfil ya existe: el acceso se puede reintentar sin duplicar nada
                ctx.notificar(`Barbero agregado, pero el acceso no se completó: ${err.message} Usa «Habilitar acceso» para reintentar.`, 'error');
            }
        } else ctx.notificar(b ? 'Barbero actualizado' : 'Barbero agregado');
        cerrar();
        recargar();
    });
}
