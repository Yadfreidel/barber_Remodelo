// ==========================================
// PANEL ADMIN DE MÓDULOS
// Requiere sesión de Supabase Auth de un usuario en admin_usuarios.
// Toda escritura se valida en el servidor (RLS + funciones admin_*).
// ==========================================

import { montarPruebasTarjeta } from '../assets/appointment-card-preview.js';
import { supabase, obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { cargarConfigModulos, esc, formatoPrecio, mensajeError } from './modulosController.js';

const NOMBRES_MODULOS = {
    whatsapp: 'Recordatorios WhatsApp',
    lista_espera: 'Lista de espera',
    recuperacion: 'Recuperación de clientes',
    referidos: 'Referidos',
    productos: 'Productos',
    promociones: 'Promociones horas vacías',
    general: 'General (horario y enlace público)'
};

const SECCIONES = {
    modulos: 'Activar / configurar',
    productos: 'Productos',
    promociones: 'Promociones',
    espera: 'Lista de espera',
    referidos: 'Referidos',
    mensajes: 'Mensajes WhatsApp'
};

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

let seccionActiva = 'modulos';

function tabla(columnas, filas) {
    return `
        <div class="tabla-contenedor-responsive">
            <table class="tabla-admin-citas">
                <thead><tr>${columnas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody>${filas.length ? filas.join('') : `<tr><td colspan="${columnas.length}" class="vacio-td">Sin registros</td></tr>`}</tbody>
            </table>
        </div>`;
}

const fechaHora = v => v ? new Date(v).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '';

export async function iniciarSesionModulos(email, clave) {
    const admin = obtenerClienteAdmin();
    if (!admin) return;
    try {
        await admin.auth.signInWithPassword({ email, password: clave });
    } catch (e) {
        // Sin conexión o sin usuario en Supabase: la pestaña Módulos pedirá el login
    }
}

export async function renderTabModulos(container, notificar) {
    const cfg = await cargarConfigModulos();
    if (!cfg.instalado) {
        container.innerHTML = `
            <div class="admin-aviso-config">
                <i class="fas fa-database"></i>
                <p><strong>Módulos no instalados.</strong></p>
                <p>Aplica las migraciones de <code>supabase/migrations</code> (ver <code>supabase/README.md</code>).</p>
            </div>`;
        return;
    }

    const admin = obtenerClienteAdmin();
    const { data: { session } } = await admin.auth.getSession();
    if (!session) {
        renderLogin(container, notificar);
        return;
    }

    container.innerHTML = `
        <div class="admin-section-header">
            <h3><i class="fas fa-puzzle-piece"></i> Módulos</h3>
            <button id="btn-salir-admin" class="btn-admin-accion"><i class="fas fa-sign-out-alt"></i> ${esc(session.user.email)}</button>
        </div>
        <div class="admin-filtros-citas">
            <div class="filtro-item">
                <label><i class="fas fa-list"></i> Sección:</label>
                <select id="seccion-modulos">
                    ${Object.entries(SECCIONES).map(([k, v]) => `<option value="${k}" ${k === seccionActiva ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
        </div>
        <div id="cuerpo-modulos"></div>`;

    container.querySelector('#btn-salir-admin').addEventListener('click', async () => {
        await admin.auth.signOut();
        renderTabModulos(container, notificar);
    });
    container.querySelector('#seccion-modulos').addEventListener('change', e => {
        seccionActiva = e.target.value;
        renderSeccion(container.querySelector('#cuerpo-modulos'), admin, notificar);
    });
    renderSeccion(container.querySelector('#cuerpo-modulos'), admin, notificar);
}

function renderLogin(container, notificar) {
    container.innerHTML = `
        <div class="admin-section-header"><h3><i class="fas fa-lock"></i> Acceso de administrador</h3></div>
        <p class="nota-espera">Los módulos requieren una cuenta de Supabase Auth autorizada en <code>admin_usuarios</code>.</p>
        <form id="form-login-admin" class="admin-form">
            <input type="email" id="admin-email" placeholder="Correo" required autocomplete="username">
            <input type="password" id="admin-clave" placeholder="Contraseña" required autocomplete="current-password">
            <button type="submit" class="btn-admin-accion"><i class="fas fa-sign-in-alt"></i> Entrar</button>
        </form>`;
    container.querySelector('#form-login-admin').addEventListener('submit', async e => {
        e.preventDefault();
        const admin = obtenerClienteAdmin();
        const { error } = await admin.auth.signInWithPassword({
            email: container.querySelector('#admin-email').value.trim(),
            password: container.querySelector('#admin-clave').value
        });
        if (error) {
            notificar('Credenciales inválidas', 'error');
            return;
        }
        const { data: esAdmin } = await admin.rpc('es_admin');
        if (!esAdmin) {
            await admin.auth.signOut();
            notificar('Esta cuenta no tiene permisos de administrador', 'error');
            return;
        }
        renderTabModulos(container, notificar);
    });
}

async function renderSeccion(cuerpo, admin, notificar) {
    cuerpo.innerHTML = '<p class="placeholder-horas">Cargando...</p>';
    const recargar = () => renderSeccion(cuerpo, admin, notificar);
    const ejecutar = async (promesa, ok) => {
        const { error } = await promesa;
        if (error) notificar(mensajeError(error), 'error');
        else {
            notificar(ok);
            recargar();
        }
    };
    const secciones = { modulos: seccionModulos, productos: seccionProductos, promociones: seccionPromociones, espera: seccionEspera, referidos: seccionReferidos, mensajes: seccionMensajes };
    await secciones[seccionActiva](cuerpo, admin, ejecutar);
}

async function seccionModulos(cuerpo, admin, ejecutar) {
    const { data, error } = await admin.from('modulos_config').select('*').order('modulo');
    if (error) {
        cuerpo.innerHTML = `<p class="resumen-alerta">${esc(mensajeError(error))}</p>`;
        return;
    }
    cuerpo.innerHTML = `
        <p class="nota-espera">Los cambios se validan en el servidor. Recarga la página para verlos en el formulario de reservas.</p>
        ${data.map(m => `
            <div class="admin-form" data-modulo="${esc(m.modulo)}">
                <label class="check-consentimiento">
                    ${m.modulo === 'general' ? '' : `<input type="checkbox" class="modulo-activo" ${m.activo ? 'checked' : ''}>`}
                    <strong>${esc(NOMBRES_MODULOS[m.modulo] || m.modulo)}</strong>
                </label>
                <textarea class="modulo-ajustes" rows="4" spellcheck="false">${esc(JSON.stringify(m.ajustes, null, 2))}</textarea>
                <button class="btn-admin-accion btn-guardar-modulo"><i class="fas fa-save"></i> Guardar</button>
            </div>`).join('')}`;

    cuerpo.querySelectorAll('[data-modulo]').forEach(bloque => {
        bloque.querySelector('.btn-guardar-modulo').addEventListener('click', () => {
            let ajustes;
            try {
                ajustes = JSON.parse(bloque.querySelector('.modulo-ajustes').value);
            } catch (e) {
                ejecutar(Promise.resolve({ error: { message: 'JSON de ajustes inválido' } }));
                return;
            }
            const activo = bloque.querySelector('.modulo-activo');
            ejecutar(admin.rpc('admin_guardar_modulo', {
                p_modulo: bloque.dataset.modulo, p_activo: activo ? activo.checked : true, p_ajustes: ajustes
            }), 'Módulo guardado');
        });
    });
}

// Los artículos se gestionan en Finanzas › Inventario: la existencia solo cambia con movimientos registrados
async function seccionProductos(cuerpo) {
    cuerpo.innerHTML = `<p class="nota-espera">Los productos (precio, existencias, compras y ajustes) se gestionan en
        <strong>Finanzas › Inventario</strong>, donde cada cambio de existencia queda registrado con su motivo.
        Aquí solo se activa o desactiva la venta de productos en la web (pestaña Módulos › Productos).</p>`;
}

async function seccionPromociones(cuerpo, admin, ejecutar) {
    const [{ data: promos }, { data: servicios }, { data: barberos }] = await Promise.all([
        admin.from('promociones').select('*').order('fecha_desde', { ascending: false }),
        supabase.from('servicios').select('id, nombre'),
        supabase.from('barberos').select('id, nombre')
    ]);
    const nombreDe = (lista, id) => ((lista || []).find(x => String(x.id) === id) || {}).nombre || 'Todos';

    cuerpo.innerHTML = `
        <form id="form-promo" class="admin-form">
            <input id="promo-nombre" placeholder="Nombre (ej. Martes tarde -20%)" required>
            <div class="espera-grid">
                <label>Tipo<select id="promo-tipo"><option value="porcentaje">Porcentaje</option><option value="monto">Monto RD$</option></select></label>
                <label>Valor<input id="promo-valor" type="number" min="0.01" step="0.01" required></label>
                <label>Desde<input id="promo-desde" type="date" required></label>
                <label>Hasta<input id="promo-hasta" type="date" required></label>
                <label>Hora desde<input id="promo-hora-desde" type="time" value="14:00" required></label>
                <label>Hora hasta<input id="promo-hora-hasta" type="time" value="17:00" required></label>
                <label>Servicio<select id="promo-servicio"><option value="">Todos</option>${(servicios || []).map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('')}</select></label>
                <label>Barbero<select id="promo-barbero"><option value="">Todos</option>${(barberos || []).map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('')}</select></label>
                <label>Máx. usos (vacío = sin límite)<input id="promo-max" type="number" min="1" step="1"></label>
            </div>
            <div class="acciones-gestion">${DIAS.map((d, i) => `<label class="check-consentimiento"><input type="checkbox" class="promo-dia" value="${i}"> ${d}</label>`).join('')}</div>
            <p class="nota-espera">Sin días marcados aplica todos los días. Solo se aplica una promoción por cita (la de mayor descuento).</p>
            <label class="check-consentimiento"><input type="checkbox" id="promo-activa"> <span>Activar al guardar</span></label>
            <button type="submit" class="btn-admin-accion"><i class="fas fa-plus"></i> Crear promoción</button>
        </form>
        ${tabla(['Promoción', 'Descuento', 'Vigencia', 'Aplica a', 'Usos', 'Acciones'], (promos || []).map(p => `
            <tr>
                <td><strong>${esc(p.nombre)}</strong><br><span class="badge-estado ${p.activa ? 'badge-confirmada' : 'badge-cancelada'}">${p.activa ? 'ACTIVA' : 'INACTIVA'}</span></td>
                <td>${p.tipo === 'porcentaje' ? `${Number(p.valor)}%` : formatoPrecio(p.valor)}</td>
                <td>${esc(p.fecha_desde)} → ${esc(p.fecha_hasta)}<br><small>${esc(String(p.hora_desde).slice(0, 5))}-${esc(String(p.hora_hasta).slice(0, 5))} ${p.dias_semana ? p.dias_semana.map(d => DIAS[d]).join(',') : ''}</small></td>
                <td>${esc(nombreDe(servicios, p.servicio_id))}<br><small>${esc(nombreDe(barberos, p.barbero_id))}</small></td>
                <td>${p.usos}${p.max_usos ? ` / ${p.max_usos}` : ''}</td>
                <td><div class="acciones-cita-row">
                    <button class="btn-accion-cita" data-toggle="${esc(p.id)}" data-valor="${!p.activa}" title="${p.activa ? 'Desactivar' : 'Activar'}"><i class="fas fa-power-off"></i></button>
                    <button class="btn-accion-cita btn-cancelar" data-borrar="${esc(p.id)}" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`))}`;

    cuerpo.querySelector('#form-promo').addEventListener('submit', e => {
        e.preventDefault();
        const v = id => cuerpo.querySelector(id).value;
        const dias = [...cuerpo.querySelectorAll('.promo-dia:checked')].map(c => Number(c.value));
        ejecutar(admin.from('promociones').insert([{
            nombre: v('#promo-nombre').trim(), tipo: v('#promo-tipo'), valor: Number(v('#promo-valor')),
            fecha_desde: v('#promo-desde'), fecha_hasta: v('#promo-hasta'),
            hora_desde: v('#promo-hora-desde'), hora_hasta: v('#promo-hora-hasta'),
            dias_semana: dias.length ? dias : null,
            servicio_id: v('#promo-servicio') || null, barbero_id: v('#promo-barbero') || null,
            max_usos: v('#promo-max') ? Number(v('#promo-max')) : null,
            activa: cuerpo.querySelector('#promo-activa').checked
        }]), 'Promoción creada');
    });
    cuerpo.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () =>
        ejecutar(admin.from('promociones').update({ activa: b.dataset.valor === 'true' }).eq('id', b.dataset.toggle), 'Promoción actualizada')));
    cuerpo.querySelectorAll('[data-borrar]').forEach(b => b.addEventListener('click', () => {
        if (confirm('¿Eliminar esta promoción?')) ejecutar(admin.from('promociones').delete().eq('id', b.dataset.borrar), 'Promoción eliminada');
    }));
}

async function seccionEspera(cuerpo, admin, ejecutar) {
    const [{ data: entradas }, { data: ofertas }] = await Promise.all([
        admin.from('lista_espera').select('*').in('estado', ['activa', 'ofertada']).order('creado_en'),
        admin.from('ofertas_espera').select('*').order('creado_en', { ascending: false }).limit(30)
    ]);
    cuerpo.innerHTML = `
        <h4>En espera (orden de atención)</h4>
        ${tabla(['#', 'Cliente', 'Preferencia', 'Estado', ''], (entradas || []).map((e, i) => `
            <tr>
                <td>${i + 1}</td>
                <td><strong>${esc(e.nombre)}</strong><br><a href="tel:${esc(e.telefono)}" class="link-tel">${esc(e.telefono)}</a></td>
                <td>${esc(e.fecha_desde)} → ${esc(e.fecha_hasta)}<br><small>${esc(String(e.hora_desde).slice(0, 5))}-${esc(String(e.hora_hasta).slice(0, 5))}</small></td>
                <td><span class="badge-estado badge-pendiente">${esc(e.estado.toUpperCase())}</span></td>
                <td><button class="btn-accion-cita btn-cancelar" data-quitar="${esc(e.id)}" title="Quitar de la lista"><i class="fas fa-times"></i></button></td>
            </tr>`))}
        <h4>Ofertas recientes</h4>
        ${tabla(['Espacio', 'Estado', 'Vence'], (ofertas || []).map(o => `
            <tr><td>${esc(o.fecha)} ${esc(String(o.hora).slice(0, 5))}</td><td>${esc(o.estado.toUpperCase())}</td><td>${fechaHora(o.expira_en)}</td></tr>`))}`;
    cuerpo.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => {
        if (confirm('¿Quitar de la lista de espera?')) ejecutar(admin.rpc('admin_cancelar_espera', { p_id: b.dataset.quitar }), 'Inscripción cancelada');
    }));
}

async function seccionReferidos(cuerpo, admin) {
    const [{ data: referidos }, { data: beneficios }] = await Promise.all([
        admin.from('referidos').select('*').order('creado_en', { ascending: false }).limit(100),
        admin.from('beneficios').select('*').order('creado_en', { ascending: false }).limit(100)
    ]);
    cuerpo.innerHTML = `
        <p class="nota-espera">El beneficio se otorga al marcar "Completada y pagada" la primera visita del referido. Úsalo desde la tabla de Citas (botón regalo).</p>
        <h4>Referidos</h4>
        ${tabla(['Código', 'Referidor', 'Referido', 'Estado', 'Nota'], (referidos || []).map(r => `
            <tr><td>${esc(r.codigo)}</td><td>${esc(r.referidor_tel)}</td><td>${esc(r.referido_tel)}</td>
                <td>${esc(r.estado.toUpperCase())}</td><td><small>${esc(r.nota || '')}</small></td></tr>`))}
        <h4>Beneficios</h4>
        ${tabla(['Teléfono', 'Beneficio', 'Estado', 'Fecha'], (beneficios || []).map(b => `
            <tr><td>${esc(b.telefono)}</td><td>${b.tipo === 'porcentaje' ? `${Number(b.valor)}%` : formatoPrecio(b.valor)}</td>
                <td>${esc(b.estado.toUpperCase())}</td><td>${fechaHora(b.usado_en || b.creado_en)}</td></tr>`))}`;
}

async function seccionMensajes(cuerpo, admin, ejecutar) {
    const { data } = await admin.from('mensajes_whatsapp').select('*').order('creado_en', { ascending: false }).limit(50);
    cuerpo.innerHTML = `
        <p class="nota-espera">El envío real requiere credenciales de Meta y <code>WHATSAPP_ENVIO_HABILITADO=true</code> en la Edge Function.</p>
        ${tabla(['Tipo', 'Teléfono', 'Programado', 'Estado', 'Intentos', 'Detalle', ''], (data || []).map(m => `
            <tr>
                <td>${esc(m.tipo)}</td><td>${esc(m.telefono)}</td><td>${fechaHora(m.programado_para)}</td>
                <td>${esc(m.estado.toUpperCase())}</td><td>${m.intentos}</td><td><small>${esc(m.ultimo_error || '')}</small></td>
                <td>${m.estado === 'fallido' ? `<button class="btn-accion-cita" data-reintentar="${esc(m.id)}" title="Reintentar"><i class="fas fa-redo"></i></button>` : ''}</td>
            </tr>`))}`;
    const { data: general } = await admin.from('modulos_config').select('ajustes').eq('modulo', 'general').single();
    montarPruebasTarjeta(cuerpo, { zonaHoraria: general?.ajustes?.zona_horaria });
    cuerpo.querySelectorAll('[data-reintentar]').forEach(b => b.addEventListener('click', () => {
        if (confirm('Si el mensaje llegó pero no se confirmó, el cliente lo recibirá dos veces. ¿Reintentar?')) {
            ejecutar(admin.rpc('admin_reintentar_mensaje', { p_id: b.dataset.reintentar }), 'Mensaje en cola');
        }
    }));
}
