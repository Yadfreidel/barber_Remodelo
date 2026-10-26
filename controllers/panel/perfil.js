// ==========================================
// PANEL: MI PERFIL
// El barbero edita su foto, presentación y especialidades (no roles, precios ni comisiones).
// Contraseña y correo se cambian con Supabase Auth (el correo nuevo se confirma por correo).
// ==========================================

import { api, esc, imagenADataURL } from './comun.js';
import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';

export async function renderPerfil(cont, ctx) {
    const esBarbero = ctx.rol === 'barbero';
    let p = null;
    if (esBarbero) {
        try { p = await api('panel_barbero_perfil', { p_barbero: ctx.barbero_id }); }
        catch (e) { cont.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    }
    let foto = p?.foto_url || '';
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>Mi perfil</h2><p class="panel-sub">${esc(ctx.email)}</p></div></div>
        ${esBarbero ? `<div class="panel-caja"><h3>Perfil profesional</h3>
            <p class="panel-sub">Se muestra en «Ver perfil» de la web. Tu rol, precios y comisiones los gestiona la barbería.</p>
            <form class="panel-form" data-perfil novalidate>
                <div class="perfil-propio-foto"><div class="barbero-foto grande" data-vista>${foto ? `<img src="${esc(foto)}" alt="">` : '<i class="fas fa-user"></i>'}</div>
                    <label class="panel-btn panel-btn-mini"><i class="fas fa-upload"></i> Cambiar foto<input type="file" accept="image/png,image/jpeg,image/webp" data-archivo hidden></label></div>
                <label>Presentación<textarea name="presentacion" rows="4" maxlength="500">${esc(p.presentacion || '')}</textarea></label>
                <label>Especialidades (separadas por comas, máx. 8)<input name="especialidades" maxlength="400" value="${esc((p.especialidades || []).join(', '))}"></label>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar perfil</button>
            </form></div>` : ''}
        <div class="panel-caja"><h3>Contraseña</h3>
            <form class="panel-form" data-clave novalidate><div class="panel-rejilla">
                <label>Nueva contraseña<input type="password" name="clave" minlength="8" autocomplete="new-password" required></label>
                <label>Repítela<input type="password" name="clave2" minlength="8" autocomplete="new-password" required></label></div>
                <button type="submit" class="panel-btn">Cambiar contraseña</button></form></div>
        <div class="panel-caja"><h3>Correo de acceso</h3>
            <form class="panel-form" data-correo novalidate>
                <label>Correo nuevo<input type="email" name="email" autocomplete="email" required></label>
                <p class="panel-sub">Recibirás un enlace de confirmación; el cambio se aplica al confirmarlo.</p>
                <button type="submit" class="panel-btn">Cambiar correo</button></form></div>
        <div class="panel-caja"><h3>Avisos</h3><p class="panel-sub">Sonido, volumen y avisos con la app cerrada.</p>
            <button type="button" class="panel-btn" data-avisos><i class="fas fa-bell"></i> Configurar avisos</button></div>`;
    cont.querySelector('[data-avisos]').addEventListener('click', () => ctx.irA('notificaciones'));
    const formPerfil = cont.querySelector('[data-perfil]');
    if (formPerfil) {
        formPerfil.querySelector('[data-archivo]').addEventListener('change', async e => {
            if (!e.target.files[0]) return;
            try { foto = await imagenADataURL(e.target.files[0], 600); formPerfil.querySelector('[data-vista]').innerHTML = `<img src="${esc(foto)}" alt="">`; }
            catch (err) { ctx.notificar(err.message, 'error'); }
        });
        formPerfil.addEventListener('submit', async e => {
            e.preventDefault();
            const especialidades = formPerfil.elements.especialidades.value.split(',').map(x => x.trim()).filter(Boolean);
            if (especialidades.length > 8 || especialidades.some(x => x.length > 40)) { ctx.notificar('Máximo 8 especialidades de 40 caracteres.', 'error'); return; }
            e.submitter.disabled = true;
            try {
                await api('panel_barbero_perfil_guardar', { p_barbero: ctx.barbero_id, p_datos: { presentacion: formPerfil.elements.presentacion.value.trim(), especialidades, foto_url: foto } });
                ctx.notificar('Perfil guardado');
            } catch (err) { ctx.notificar(err.message, 'error'); }
            finally { e.submitter.disabled = false; }
        });
    }
    cont.querySelector('[data-clave]').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        if (f.clave.value.length < 8 || f.clave.value !== f.clave2.value) { ctx.notificar('Las contraseñas deben coincidir y tener al menos 8 caracteres.', 'error'); return; }
        e.submitter.disabled = true;
        const { error } = await obtenerClienteAdmin().auth.updateUser({ password: f.clave.value });
        e.submitter.disabled = false;
        if (error) { ctx.notificar('No se pudo cambiar la contraseña. Inténtalo de nuevo.', 'error'); return; }
        e.target.reset();
        ctx.notificar('Contraseña actualizada');
    });
    cont.querySelector('[data-correo]').addEventListener('submit', async e => {
        e.preventDefault();
        const email = e.target.elements.email.value.trim();
        if (!e.target.elements.email.checkValidity() || !email) { ctx.notificar('Escribe un correo válido.', 'error'); return; }
        e.submitter.disabled = true;
        const { error } = await obtenerClienteAdmin().auth.updateUser({ email });
        e.submitter.disabled = false;
        ctx.notificar(error ? 'No se pudo solicitar el cambio de correo en este servidor.' : 'Te enviamos un enlace para confirmar el correo nuevo.', error ? 'error' : 'info');
    });
}
