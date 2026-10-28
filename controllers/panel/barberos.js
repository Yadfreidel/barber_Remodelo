// ==========================================
// PANEL: BARBEROS Y ACCESOS
// ==========================================

import { obtenerBarberosLocales } from '../../models/barberModel.js';
import { api, esc, dialogo, confirmar, ejecutar, imagenADataURL, vacio } from './comun.js';
import { ayuda } from '../../assets/ayuda.js';
import { servicioEfectivo } from './servicios.js';
import { invalidarCatalogosAgenda } from './agenda.js';
import { habilitarAcceso, enviarRestablecimiento, mensajeAlta, PERMISOS, CORREO, problemaClave, camposClave, conectarCamposClave, limpiarCamposClave } from './cuentas.js';

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
            <div><div class="titulo-con-ayuda"><h2>Barberos</h2>${ayuda('Crear, activar y desactivar barberos', `<p><strong>Agregar:</strong> indica nombre, especialidad, foto y los servicios que realiza; en la web solo se le podrán reservar esos servicios. El acceso al panel es opcional: entra con su correo y contraseña y ve lo que permitan sus permisos.</p>
                <p><strong>Desactivar:</strong> deja de aparecer en la web y no recibe reservas nuevas, y pierde el acceso al panel. Su historial y sus citas futuras se conservan: reprograma esas citas desde la Agenda.</p>
                <p><strong>Activar:</strong> vuelve a aparecer en la web. Revisa en su tarjeta el estado del acceso al panel.</p>`)}</div><p class="panel-sub">Desactivar oculta al barbero de la web y le quita el acceso, sin borrar su historial.</p></div>
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
                    <small><i class="fas fa-key"></i> ${(e => `${esc(e.texto)} ${chipsHtml(e.chips)}`)(estadoAcceso(cuentaDe(b)))}</small>
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
const permisosMarcados = raiz => [...raiz.querySelectorAll('[name=permisos]:checked')].map(x => x.value);

// Estado del acceso para mostrar (nunca la contraseña: no se puede consultar)
export function estadoAcceso(c) {
    if (!c) return { texto: 'Sin acceso al panel', chips: [] };
    const chips = [];
    if (!c.acceso_activo) chips.push(['Acceso desactivado', 'estado-cancelada']);
    else if (!c.verificado) chips.push(['Pendiente de verificar correo', 'estado-pendiente']);
    else if (c.debe_cambiar_clave) chips.push(['Debe cambiar la contraseña inicial', 'estado-pendiente']);
    else chips.push(['Acceso activo', 'estado-confirmada']);
    if (c.permisos.length) chips.push([c.permisos.join(', '), '']);
    return { texto: c.email, chips };
}
const chipsHtml = chips => chips.map(([t, clase]) => `<span class="estado-chip ${clase}">${esc(t)}</span>`).join(' ');

// Crea o vincula la cuenta (validando antes en el navegador; el servidor vuelve a validar todo)
async function crearAcceso(ctx, raiz, barberoId, { reemplazar = false } = {}) {
    const email = raiz.querySelector('[name=email]').value.trim();
    if (!CORREO.test(email)) throw new Error('Escribe un correo válido.');
    // Solo se exige si hay que crear la cuenta (una cuenta existente conserva su contraseña)
    const clave = raiz.querySelector('[name=clave]').value;
    const problema = clave || raiz.querySelector('[name=clave2]').value ? problemaClave(clave, raiz.querySelector('[name=clave2]').value) : null;
    if (problema) throw new Error(problema);
    const r = await habilitarAcceso(barberoId, { email, clave, permisos: permisosMarcados(raiz), reemplazar });
    limpiarCamposClave(raiz);
    return r;
}

const ayudaVerificacion = '<p class="panel-sub">Si el servidor exige verificar el correo, el barbero recibirá un enlace: hasta abrirlo verás «Pendiente de verificar correo» y no podrá entrar.</p>';

// Habilitar acceso a un perfil sin cuenta (desde la tarjeta)
function abrirHabilitar(ctx, b, recargar) {
    const { cuerpo, cerrar } = dialogo({ titulo: `Habilitar acceso: ${b.nombre}`, ancho: 'md', html: `
        <form class="panel-form" novalidate>
            <label>Correo de acceso<input type="email" name="email" autocomplete="off" required></label>
            ${camposClave()}
            <fieldset class="panel-fieldset"><legend>Permisos adicionales</legend>${permisosHtml()}</fieldset>
            ${ayudaVerificacion}
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button><button type="submit" class="panel-btn panel-btn-principal">Habilitar acceso</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    conectarCamposClave(form);
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const boton = e.submitter;
        if (boton.disabled) return;
        boton.disabled = true;
        boton.textContent = 'Creando acceso…';
        try {
            const r = await crearAcceso(ctx, form, b.id);
            if (r) { cerrar(); ctx.notificar(mensajeAlta(r), r.verificado ? 'success' : 'info'); recargar(); }
        } catch (err) { ctx.notificar(err.message, 'error'); }
        finally { boton.disabled = false; boton.textContent = 'Habilitar acceso'; }
    });
}

function seccionCuenta(b, cuenta) {
    if (!b) return `<fieldset class="panel-fieldset" data-cuenta><legend>Cuenta de acceso (opcional)</legend>
        <p class="panel-sub">Con cuenta, el barbero entra al panel y ve solo su agenda, su atención, su portafolio, sus ingresos y sus casos.</p>
        <label>Correo de acceso<input type="email" name="email" autocomplete="off"></label>
        ${camposClave()}${permisosHtml()}${ayudaVerificacion}</fieldset>`;
    if (!cuenta) return `<fieldset class="panel-fieldset" data-cuenta><legend>Cuenta de acceso</legend>
        <p class="panel-sub">Sin cuenta vinculada.</p>
        <label>Correo de acceso<input type="email" name="email" autocomplete="off"></label>
        ${camposClave()}${permisosHtml()}${ayudaVerificacion}
        <button type="button" class="panel-btn panel-btn-principal" data-habilitar-aqui><i class="fas fa-key"></i> Habilitar acceso</button></fieldset>`;
    const e = estadoAcceso(cuenta);
    return `<fieldset class="panel-fieldset" data-cuenta><legend>Cuenta de acceso</legend>
        <p><strong>${esc(cuenta.email)}</strong> ${chipsHtml(e.chips)}</p>
        <p class="panel-sub">${cuenta.vinculado_en ? `Vinculada el ${esc(new Date(cuenta.vinculado_en).toLocaleString('es-DO'))}${cuenta.vinculado_por ? ` por ${esc(cuenta.vinculado_por)}` : ''}. ` : ''}
            ${cuenta.ultimo_acceso ? `Último acceso: ${esc(new Date(cuenta.ultimo_acceso).toLocaleString('es-DO'))}.` : 'Aún no ha entrado.'}
            ${!cuenta.acceso_activo ? ` Desactivado${cuenta.desactivado_por ? ` por ${esc(cuenta.desactivado_por)}` : ''}${cuenta.motivo_desactivacion ? `: ${esc(cuenta.motivo_desactivacion)}` : ''}.` : ''}
            La contraseña no se puede consultar.</p>
        ${!cuenta.verificado ? '<p class="panel-aviso">Pendiente de verificar correo: el barbero debe abrir el enlace de verificación que recibió. Hasta entonces no puede entrar.</p>' : ''}
        <div data-permisos>${permisosHtml(cuenta.permisos)}</div>
        <div class="panel-fila panel-fila-wrap">
            <button type="button" class="panel-btn" data-guardar-permisos>Guardar permisos</button>
            <button type="button" class="panel-btn" data-restablecer><i class="fas fa-envelope"></i> Enviar enlace para restablecer contraseña</button>
            <button type="button" class="panel-btn ${cuenta.acceso_activo ? 'panel-btn-peligro' : 'panel-btn-principal'}" data-acceso="${cuenta.acceso_activo ? '0' : '1'}">
                ${cuenta.acceso_activo ? 'Desactivar acceso' : 'Reactivar acceso'}</button></div>
        <details class="cuenta-cambiar-correo"><summary>Cambiar el correo de acceso</summary>
            <p class="panel-sub">Se vincula otra cuenta al mismo perfil (citas e historial se conservan). La cuenta anterior deja de tener acceso
                profesional pero no se borra: si también es cliente, lo sigue siendo. El propio barbero también puede cambiar su correo desde
                «Mi perfil», confirmándolo por correo.</p>
            <label>Correo nuevo<input type="email" name="email" autocomplete="off"></label>
            ${camposClave()}
            <button type="button" class="panel-btn" data-cambiar-correo>Cambiar correo de acceso</button></details>
    </fieldset>`;
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
                    ${seccionCuenta(b, cuenta)}
                </div>
            </div>
            <div class="panel-acciones"><button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal">Guardar</button></div>
        </form>` });
    const form = cuerpo.querySelector('form');
    const seccion = form.querySelector("[data-cuenta]");
    conectarCamposClave(seccion);
    cuerpo.querySelector('[data-archivo]').addEventListener('change', async e => {
        if (!e.target.files[0]) return;
        try { foto = await imagenADataURL(e.target.files[0], 600); cuerpo.querySelector('[data-vista]').innerHTML = `<img src="${esc(foto)}" alt="">`; }
        catch (err) { ctx.notificar(err.message, 'error'); }
    });
    const accionCuenta = async (boton, operacion, textoEspera) => {
        if (boton.disabled) return;
        const texto = boton.innerHTML;
        boton.disabled = true;
        boton.textContent = textoEspera;
        try {
            const r = await operacion();
            if (r !== null) { cerrar(); recargar(); }
        } catch (err) { ctx.notificar(err.message, 'error'); }
        finally { boton.disabled = false; boton.innerHTML = texto; }
    };
    cuerpo.querySelector('[data-habilitar-aqui]')?.addEventListener('click', e => accionCuenta(e.currentTarget, async () => {
        const r = await crearAcceso(ctx, seccion, b.id);
        if (r) ctx.notificar(mensajeAlta(r), r.verificado ? 'success' : 'info');
        return r;
    }, 'Creando acceso…'));
    cuerpo.querySelector('[data-cambiar-correo]')?.addEventListener('click', e => accionCuenta(e.currentTarget, async () => {
        const detalle = seccion.querySelector('.cuenta-cambiar-correo');
        if (!await confirmar(`¿Cambiar el correo de acceso de ${b.nombre}? ${cuenta.email} dejará de tener acceso profesional (la cuenta no se borra).`, { textoOk: 'Cambiar correo' })) return null;
        const r = await crearAcceso(ctx, detalle, b.id, { reemplazar: true });
        if (r) ctx.notificar(mensajeAlta(r), r.verificado ? 'success' : 'info');
        return r;
    }, 'Cambiando…'));
    cuerpo.querySelector('[data-guardar-permisos]')?.addEventListener('click', e => accionCuenta(e.currentTarget, async () => {
        await api('panel_cuenta_permisos', { p_barbero: b.id, p_permisos: permisosMarcados(seccion.querySelector('[data-permisos]')) });
        ctx.notificar('Permisos actualizados');
    }, 'Guardando…'));
    cuerpo.querySelector('[data-restablecer]')?.addEventListener('click', async e => {
        await ejecutar(e.currentTarget, () => enviarRestablecimiento(cuenta.email), ctx.notificar, `Enlace enviado a ${cuenta.email}`);
    });
    cuerpo.querySelector('[data-acceso]')?.addEventListener('click', e => accionCuenta(e.currentTarget, async () => {
        const activar = e.currentTarget.dataset.acceso === '1';
        let motivo = null;
        if (!activar) {
            motivo = window.prompt(`Motivo para desactivar el acceso de ${b.nombre} (sus citas e historial se conservan):`, '');
            if (motivo === null) return null;
            if (motivo.trim().length < 3) throw new Error('Escribe el motivo (mínimo 3 caracteres).');
        }
        await api('panel_cuenta_acceso', { p_barbero: b.id, p_activo: activar, p_motivo: motivo });
        ctx.notificar(activar ? 'Acceso reactivado' : 'Acceso desactivado: ya no puede entrar al panel');
    }, 'Guardando…'));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const boton = e.submitter;
        if (boton.disabled) return;
        const d = new FormData(form);
        if (!d.get('nombre').trim()) { ctx.notificar('Escribe el nombre.', 'error'); return; }
        const especialidades = String(d.get('especialidades') || '').split(',').map(x => x.trim()).filter(Boolean);
        if (especialidades.length > 8 || especialidades.some(x => x.length > 40)) { ctx.notificar('Máximo 8 especialidades de 40 caracteres.', 'error'); return; }
        const email = !b ? String(d.get('email') || '').trim() : '';
        if (email) {
            if (!CORREO.test(email)) { ctx.notificar('Escribe un correo de acceso válido.', 'error'); return; }
            const problema = problemaClave(d.get('clave') || '', d.get('clave2') || '');
            if (problema) { ctx.notificar(problema, 'error'); return; }
        }
        const datos = { nombre: d.get('nombre').trim(), especialidad: d.get('especialidad').trim(), foto_url: foto,
            activo: form.elements.activo.checked, servicios: d.getAll('servicios') };
        boton.disabled = true;
        boton.textContent = 'Guardando…';
        let id = b?.id;
        try {
            id = (await api('panel_guardar_barbero', { p_id: b?.id || null, p_datos: datos })).id || id;
            await api('panel_barbero_perfil_guardar', { p_barbero: String(id), p_datos: { presentacion: d.get('presentacion').trim(), especialidades } });
        } catch (err) { ctx.notificar(err.message, 'error'); boton.disabled = false; boton.textContent = 'Guardar'; return; }
        if (email) {
            boton.textContent = 'Creando acceso…';
            try {
                const r = await crearAcceso(ctx, seccion, id);
                ctx.notificar(r ? mensajeAlta(r) : 'Barbero agregado sin cuenta de acceso', r && !r.verificado ? 'info' : 'success');
            } catch (err) {
                // El perfil ya existe: el acceso se reintenta desde «Habilitar acceso» sin duplicar nada
                limpiarCamposClave(seccion);
                ctx.notificar(`Barbero agregado, pero el acceso no se completó: ${err.message} Usa «Habilitar acceso» para reintentar.`, 'error');
            }
        } else ctx.notificar(b ? 'Barbero actualizado' : 'Barbero agregado');
        cerrar();
        recargar();
    });
}
