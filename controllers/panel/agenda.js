// ==========================================
// PANEL: AGENDA (calendario día/semana/mes y lista)
// ==========================================

import {
    api, esc, dinero, hoyLocal, sumarDias, inicioSemana, inicioMes, finMes, diaSemana, fechaLarga, fechaCorta,
    fechaHora, ESTADOS, etiquetaEstado, dialogo, confirmar, ejecutar, descargarCSV, telefonoWhatsApp, vacio
} from './comun.js';
import { abrirCobroDeCita, abrirVenta } from './ventas.js';

const estado = {
    vista: window.matchMedia('(max-width: 760px)').matches ? 'lista' : 'dia',
    rangoLista: 'dia',
    fecha: null,
    filtros: { busqueda: '', barbero: '', estado: '' }
};

const ACCIONES_HISTORIAL = {
    cita_creada: 'Cita creada', cita_confirmada: 'Confirmada', cita_cancelada: 'Cancelada', cita_pendiente: 'Vuelve a pendiente',
    cita_reprogramada: 'Reprogramada', cita_completada: 'Completada', cita_no_asistio: 'Marcada como no asistió',
    pago_registrado: 'Pago registrado', pago_anulado: 'Pago anulado', notas_actualizadas: 'Notas actualizadas'
};
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro', mixto: 'Mixto' };

let catalogos = null;
async function obtenerCatalogos(ctx) {
    if (ctx.rol !== 'admin') return { barberos: [], servicios: [] };
    if (!catalogos) {
        const [barberos, servicios] = await Promise.all([api('panel_barberos'), api('panel_servicios')]);
        catalogos = { barberos, servicios };
    }
    return catalogos;
}
export function invalidarCatalogosAgenda() { catalogos = null; }

function rango() {
    const f = estado.fecha;
    const tipo = estado.vista === 'lista' ? estado.rangoLista : estado.vista;
    if (tipo === 'semana') return [inicioSemana(f), sumarDias(inicioSemana(f), 6)];
    if (tipo === 'mes') return [inicioMes(f), finMes(f)];
    return [f, f];
}

function moverFecha(paso) {
    const tipo = estado.vista === 'lista' ? estado.rangoLista : estado.vista;
    if (tipo === 'semana') estado.fecha = sumarDias(estado.fecha, 7 * paso);
    else if (tipo === 'mes') {
        const [a, m] = estado.fecha.split('-').map(Number);
        const d = new Date(Date.UTC(a, m - 1 + paso, 1));
        estado.fecha = d.toISOString().slice(0, 10);
    } else estado.fecha = sumarDias(estado.fecha, paso);
}

function tituloRango() {
    const [desde, hasta] = rango();
    const mayuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
    if (desde === hasta) return mayuscula(fechaLarga(desde));
    if (desde.slice(8) === '01' && hasta === finMes(desde)) return mayuscula(fechaLarga(desde, { month: 'long', year: 'numeric' }));
    return `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
}

export async function renderAgenda(cont, ctx, opciones = {}) {
    estado.fecha = opciones.fecha || estado.fecha || hoyLocal();
    if (opciones.vista) estado.vista = opciones.vista;
    const esAdmin = ctx.rol === 'admin';
    const { barberos } = await obtenerCatalogos(ctx);

    cont.innerHTML = `
        <div class="panel-encabezado">
            <div><h2>Agenda</h2><p class="panel-sub">${esAdmin ? 'Todas las citas del negocio' : `Agenda de ${esc(ctx.barbero_nombre || 'tu cuenta')}`}</p></div>
            ${esAdmin ? '<button type="button" class="panel-btn panel-btn-principal" data-nueva><i class="fas fa-plus"></i> Nueva cita</button>' : ''}
        </div>
        <div class="agenda-barra">
            <div class="agenda-nav">
                <button type="button" class="panel-btn" data-hoy>Hoy</button>
                <button type="button" class="panel-icono" data-mover="-1" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
                <strong class="agenda-titulo"></strong>
                <button type="button" class="panel-icono" data-mover="1" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>
            </div>
            <div class="panel-segmentos" role="group" aria-label="Vista">
                ${['dia', 'semana', 'mes', 'lista'].map(v => `<button type="button" data-vista="${v}" aria-pressed="${estado.vista === v}">${{ dia: 'Día', semana: 'Semana', mes: 'Mes', lista: 'Lista' }[v]}</button>`).join('')}
            </div>
        </div>
        <div class="agenda-filtros">
            <input type="search" data-filtro="busqueda" placeholder="Buscar cliente o teléfono" value="${esc(estado.filtros.busqueda)}" aria-label="Buscar cliente o teléfono">
            ${esAdmin ? `<select data-filtro="barbero" aria-label="Barbero"><option value="">Todos los barberos</option>
                ${barberos.map(b => `<option value="${esc(b.id)}" ${estado.filtros.barbero === b.id ? 'selected' : ''}>${esc(b.nombre)}${b.activo ? '' : ' (inactivo)'}</option>`).join('')}</select>` : ''}
            <select data-filtro="estado" aria-label="Estado"><option value="">Todos los estados</option>
                ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${estado.filtros.estado === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <select data-rango-lista aria-label="Periodo de la lista" ${estado.vista === 'lista' ? '' : 'hidden'}>
                ${['dia', 'semana', 'mes'].map(r => `<option value="${r}" ${estado.rangoLista === r ? 'selected' : ''}>${{ dia: 'Día', semana: 'Semana', mes: 'Mes' }[r]}</option>`).join('')}
            </select>
            ${esAdmin ? '<button type="button" class="panel-btn" data-csv><i class="fas fa-file-csv"></i> CSV</button>' : ''}
        </div>
        <div class="agenda-cuerpo" aria-live="polite"></div>`;

    const cuerpo = cont.querySelector('.agenda-cuerpo');
    let citas = [];
    const recargar = async () => {
        cont.querySelector('.agenda-titulo').textContent = tituloRango();
        cont.querySelectorAll('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === estado.vista)));
        cont.querySelector('[data-rango-lista]').hidden = estado.vista !== 'lista';
        cuerpo.innerHTML = '<p class="panel-cargando">Cargando citas…</p>';
        const [desde, hasta] = rango();
        try {
            citas = await api('panel_citas', { p_desde: desde, p_hasta: hasta, p_barbero: estado.filtros.barbero || null,
                p_estado: estado.filtros.estado || null, p_busqueda: estado.filtros.busqueda || null });
        } catch (e) {
            cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`;
            return;
        }
        const abrir = id => abrirDetalle(id, ctx, recargar);
        if (estado.vista === 'dia') pintarDia(cuerpo, citas, ctx, barberos, abrir);
        else if (estado.vista === 'semana') pintarSemana(cuerpo, citas, abrir);
        else if (estado.vista === 'mes') pintarMes(cuerpo, citas, fecha => { estado.fecha = fecha; estado.vista = 'dia'; recargar(); });
        else pintarLista(cuerpo, citas, abrir);
    };

    cont.querySelector('[data-hoy]').addEventListener('click', () => { estado.fecha = hoyLocal(); recargar(); });
    cont.querySelectorAll('[data-mover]').forEach(b => b.addEventListener('click', () => { moverFecha(Number(b.dataset.mover)); recargar(); }));
    cont.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => { estado.vista = b.dataset.vista; recargar(); }));
    cont.querySelector('[data-rango-lista]').addEventListener('change', e => { estado.rangoLista = e.target.value; recargar(); });
    let espera;
    cont.querySelectorAll('[data-filtro]').forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
        estado.filtros[el.dataset.filtro] = el.value.trim();
        clearTimeout(espera);
        espera = setTimeout(recargar, el.tagName === 'INPUT' ? 350 : 0);
    }));
    cont.querySelector('[data-nueva]')?.addEventListener('click', () => abrirNuevaCita(ctx, recargar));
    cont.querySelector('[data-csv]')?.addEventListener('click', () => exportarCitasCSV(citas, `citas-${rango().join('_')}.csv`));
    await recargar();
    if (opciones.abrirNueva) abrirNuevaCita(ctx, recargar, opciones.nueva || {});
    if (opciones.abrirCita) abrirDetalle(opciones.abrirCita, ctx, recargar);
}

export function exportarCitasCSV(citas, nombre) {
    descargarCSV(nombre, [
        ['Fecha', 'Hora', 'Fin', 'Duración (min)', 'Cliente', 'Teléfono', 'Servicio', 'Barbero', 'Estado', 'Precio (RD$)',
         'Pagada', 'Monto cobrado (RD$)', 'Método de pago', 'Motivo de cancelación', 'Notas', 'Origen'],
        ...citas.map(c => [c.fecha, c.hora, c.fin, c.duracion, c.cliente, c.telefono, c.servicio, c.barbero,
            ESTADOS[c.estado_visual] || c.estado_visual, c.precio ?? '', c.pagada ? 'Sí' : 'No', c.monto_cobrado ?? '',
            METODOS[c.metodo_pago] || '', c.motivo_cancelacion || '', c.notas || '', c.origen])
    ]);
}

const aMin = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };

function tarjetaCita(c, compacta = false) {
    return `<button type="button" class="cita-chip cita-${esc(c.estado_visual)}" data-cita="${esc(c.id)}">
        <span class="cita-hora">${esc(c.hora)}${compacta ? '' : `–${esc(c.fin)}`}</span>
        <span class="cita-cliente">${esc(c.cliente)}</span>
        ${compacta ? '' : `<span class="cita-detalle">${esc(c.servicio || '')} · ${esc(c.barbero || '')}</span>`}
    </button>`;
}

function pintarDia(cuerpo, citas, ctx, barberos, abrir) {
    const columnas = ctx.rol === 'admin'
        ? barberos.filter(b => (b.activo && (!estado.filtros.barbero || b.id === estado.filtros.barbero)) || citas.some(c => c.barbero_id === b.id))
        : [{ id: ctx.barbero_id, nombre: ctx.barbero_nombre }];
    if (!columnas.length) { cuerpo.innerHTML = vacio('No hay barberos activos.', 'user-slash'); return; }
    const visibles = citas.filter(c => c.estado_visual !== 'cancelada');
    const inicio = Math.min(8 * 60, ...visibles.map(c => aMin(c.hora)));
    const fin = Math.max(20 * 60, ...visibles.map(c => aMin(c.fin)));
    const ppm = 1.1;
    const horas = [];
    for (let m = Math.floor(inicio / 60) * 60; m <= fin; m += 60) horas.push(m);
    const canceladas = citas.filter(c => c.estado_visual === 'cancelada');

    cuerpo.innerHTML = `
        <div class="agenda-dia" style="--alto:${Math.round((fin - inicio) * ppm)}px; --columnas:${columnas.length}">
            <div class="agenda-dia-horas">${horas.map(m => `<span style="top:${Math.round((m - inicio) * ppm)}px">${String(m / 60).padStart(2, '0')}:00</span>`).join('')}</div>
            ${columnas.map(b => `
                <div class="agenda-dia-columna">
                    <div class="agenda-dia-barbero">${esc(b.nombre)}</div>
                    <div class="agenda-dia-pista">
                        ${horas.map(m => `<i class="agenda-linea" style="top:${Math.round((m - inicio) * ppm)}px"></i>`).join('')}
                        ${visibles.filter(c => c.barbero_id === b.id).map(c => `
                            <div class="agenda-bloque" style="top:${Math.round((aMin(c.hora) - inicio) * ppm)}px;height:${Math.max(26, Math.round(c.duracion * ppm) - 2)}px">
                                ${tarjetaCita(c)}
                            </div>`).join('')}
                    </div>
                </div>`).join('')}
        </div>
        ${visibles.length ? '' : vacio('Sin citas para este día.', 'calendar-day')}
        ${canceladas.length ? `<details class="agenda-canceladas"><summary>${canceladas.length} cancelada(s)</summary>${canceladas.map(c => tarjetaCita(c)).join('')}</details>` : ''}`;
    cuerpo.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrir(b.dataset.cita)));
}

function pintarSemana(cuerpo, citas, abrir) {
    const desde = inicioSemana(estado.fecha);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(desde, i));
    const hoy = hoyLocal();
    cuerpo.innerHTML = `<div class="agenda-semana">${dias.map(d => {
        const delDia = citas.filter(c => c.fecha === d);
        return `<section class="agenda-semana-dia ${d === hoy ? 'es-hoy' : ''}">
            <h4>${esc(fechaCorta(d))} <small>${delDia.filter(c => c.estado_visual !== 'cancelada').length}</small></h4>
            ${delDia.length ? delDia.map(c => tarjetaCita(c, true)).join('') : '<p class="panel-sub">Libre</p>'}
        </section>`;
    }).join('')}</div>`;
    cuerpo.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrir(b.dataset.cita)));
}

function pintarMes(cuerpo, citas, irDia) {
    const primero = inicioMes(estado.fecha);
    const ultimo = finMes(estado.fecha);
    const desde = inicioSemana(primero);
    const celdas = [];
    for (let d = desde; d <= ultimo || diaSemana(d) !== 1; d = sumarDias(d, 1)) celdas.push(d);
    const hoy = hoyLocal();
    cuerpo.innerHTML = `
        <div class="agenda-mes">
            ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="agenda-mes-cabecera">${d}</div>`).join('')}
            ${celdas.map(d => {
                const activas = citas.filter(c => c.fecha === d && c.estado_visual !== 'cancelada');
                return `<button type="button" class="agenda-mes-dia ${d.slice(0, 7) !== primero.slice(0, 7) ? 'fuera' : ''} ${d === hoy ? 'es-hoy' : ''}" data-dia="${d}">
                    <span class="agenda-mes-numero">${Number(d.slice(8))}</span>
                    ${activas.length ? `<span class="agenda-mes-total">${activas.length} cita${activas.length === 1 ? '' : 's'}</span>` : ''}
                    ${activas.slice(0, 3).map(c => `<span class="agenda-mes-item cita-${esc(c.estado_visual)}">${esc(c.hora)} ${esc(c.cliente)}</span>`).join('')}
                    ${activas.length > 3 ? `<span class="agenda-mes-mas">+${activas.length - 3} más</span>` : ''}
                </button>`;
            }).join('')}
        </div>`;
    cuerpo.querySelectorAll('[data-dia]').forEach(b => b.addEventListener('click', () => irDia(b.dataset.dia)));
}

function pintarLista(cuerpo, citas, abrir) {
    if (!citas.length) { cuerpo.innerHTML = vacio('No hay citas con estos filtros.', 'calendar-xmark'); return; }
    cuerpo.innerHTML = `
        <div class="panel-tabla-envoltura">
            <table class="panel-tabla panel-tabla-tarjetas">
                <thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Barbero</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
                <tbody>${citas.map(c => `
                    <tr>
                        <td data-titulo="Fecha">${esc(fechaCorta(c.fecha))}</td>
                        <td data-titulo="Hora">${esc(c.hora)}–${esc(c.fin)} <small>(${c.duracion} min)</small></td>
                        <td data-titulo="Cliente"><strong>${esc(c.cliente)}</strong><br><small>${esc(c.telefono)}</small></td>
                        <td data-titulo="Servicio">${esc(c.servicio || '')}</td>
                        <td data-titulo="Barbero">${esc(c.barbero || '')}</td>
                        <td data-titulo="Precio">${dinero(c.precio)}</td>
                        <td data-titulo="Estado">${etiquetaEstado(c)}</td>
                        <td><button type="button" class="panel-btn" data-cita="${esc(c.id)}">Ver</button></td>
                    </tr>`).join('')}</tbody>
            </table>
        </div>`;
    cuerpo.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => abrir(b.dataset.cita)));
}

// ---------- Selección de horario (nueva cita y reprogramación) ----------
function selectorHorario(contenedor, ctx, { barberoId, servicioId, fecha, excluir }) {
    const zona = contenedor.querySelector('[data-horas]');
    const libre = contenedor.querySelector('[name="hora"]');
    if (!barberoId || !servicioId || !fecha) {
        zona.innerHTML = '<p class="panel-sub">Elige servicio, barbero y fecha para ver las horas libres.</p>';
        return;
    }
    zona.innerHTML = '<p class="panel-sub">Buscando horas libres…</p>';
    delete zona.dataset.fecha;
    // Solo se pinta la última consulta (las respuestas pueden llegar desordenadas)
    const turno = String(Number(zona.dataset.turno || 0) + 1);
    zona.dataset.turno = turno;
    api('panel_disponibilidad', { p_barbero: barberoId, p_servicio: servicioId, p_fecha: fecha, p_excluir_cita: excluir || null })
        .then(d => {
            if (zona.dataset.turno !== turno) return;
            zona.dataset.fecha = fecha;
            if (!d.puede_realizar) { zona.innerHTML = '<p class="panel-error">Ese barbero no realiza este servicio.</p>'; return; }
            if (!d.abre) { zona.innerHTML = '<p class="panel-error">Cerrado ese día (horario, vacaciones o feriado).</p>'; return; }
            zona.innerHTML = d.horas.length
                ? `<div class="panel-horas">${d.horas.map(h => `<button type="button" class="panel-hora" data-h="${h}" aria-pressed="${libre.value === h}">${h}</button>`).join('')}</div>
                   <p class="panel-sub">Jornada ${esc(d.abre)}–${esc(d.cierra)}. También puedes escribir otra hora (se valida al guardar).</p>`
                : `<p class="panel-error">No quedan horas libres (jornada ${esc(d.abre)}–${esc(d.cierra)}).</p>`;
            zona.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => {
                libre.value = b.dataset.h;
                zona.querySelectorAll('[data-h]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            }));
        })
        .catch(e => { if (zona.dataset.turno === turno) zona.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; });
}

async function abrirNuevaCita(ctx, recargar, inicial = {}) {
    let datos;
    try { datos = await obtenerCatalogos(ctx); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    const servicios = datos.servicios.filter(s => s.activo);
    const barberosActivos = datos.barberos.filter(b => b.activo);
    const { cuerpo, cerrar } = dialogo({ titulo: 'Nueva cita', ancho: 'lg', html: `
        <form class="panel-form" novalidate>
            <div class="panel-rejilla">
                <label>Teléfono / WhatsApp<input name="telefono" inputmode="tel" required autocomplete="off" value="${esc(inicial.telefono || '')}"></label>
                <label>Nombre del cliente<input name="nombre" required maxlength="120" value="${esc(inicial.nombre || '')}"></label>
            </div>
            <p class="panel-sub" data-cliente-existente></p>
            <div class="panel-rejilla">
                <label>Servicio<select name="servicio_id" required><option value="">Elige un servicio</option>
                    ${servicios.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)} · ${s.duracion_minutos} min · ${dinero(s.precio)}</option>`).join('')}</select></label>
                <label>Barbero<select name="barbero_id" required><option value="">Elige un barbero</option></select></label>
                <label>Fecha<input type="date" name="fecha" required value="${esc(inicial.fecha || estado.fecha || hoyLocal())}"></label>
                <label>Hora<input type="time" name="hora" required step="300"></label>
            </div>
            <div data-horas></div>
            <div class="panel-rejilla">
                <label>Estado inicial<select name="estado"><option value="confirmada">Confirmada</option><option value="pendiente">Pendiente</option></select></label>
                <label>Correo (opcional)<input type="email" name="email" maxlength="160"></label>
            </div>
            <label>Notas<textarea name="notas" rows="2" maxlength="1000" placeholder="Ej.: llamó por teléfono, prefiere tijera"></textarea></label>
            <p class="panel-error" data-error role="alert"></p>
            <div class="panel-acciones">
                <button type="button" class="panel-btn" data-cerrar>Cancelar</button>
                <button type="submit" class="panel-btn panel-btn-principal"><i class="fas fa-check"></i> Crear cita</button>
            </div>
        </form>` });
    const form = cuerpo.querySelector('form');
    const f = n => form.elements[n];
    const actualizarBarberos = () => {
        const actual = f('barbero_id').value;
        const aptos = barberosActivos.filter(b => !f('servicio_id').value || b.servicios.includes(f('servicio_id').value));
        f('barbero_id').innerHTML = '<option value="">Elige un barbero</option>' + aptos.map(b => `<option value="${esc(b.id)}" ${b.id === actual ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
    };
    const actualizarHoras = () => selectorHorario(form, ctx, { barberoId: f('barbero_id').value, servicioId: f('servicio_id').value, fecha: f('fecha').value });
    f('servicio_id').addEventListener('change', () => { actualizarBarberos(); actualizarHoras(); });
    f('barbero_id').addEventListener('change', actualizarHoras);
    f('fecha').addEventListener('change', actualizarHoras);
    if (inicial.barbero_id) { actualizarBarberos(); f('barbero_id').value = inicial.barbero_id; }
    actualizarBarberos();
    actualizarHoras();

    // Cliente existente por teléfono (evita duplicados)
    f('telefono').addEventListener('change', async () => {
        const aviso = form.querySelector('[data-cliente-existente]');
        aviso.textContent = '';
        if (f('telefono').value.replace(/\D/g, '').length < 7) return;
        try {
            const encontrados = await api('panel_clientes', { p_busqueda: f('telefono').value });
            if (encontrados.length) {
                const c = encontrados[0];
                if (!f('nombre').value) f('nombre').value = c.nombre;
                aviso.textContent = `Cliente existente: ${c.nombre} · ${c.total_citas} cita(s)${c.posible_duplicado ? ' · revisar posibles duplicados en Clientes' : ''}`;
            }
        } catch { /* la búsqueda es solo una ayuda */ }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const error = form.querySelector('[data-error]');
        error.textContent = '';
        const valores = Object.fromEntries(new FormData(form));
        if (!valores.nombre.trim() || valores.telefono.replace(/\D/g, '').length < 7 || !valores.servicio_id || !valores.barbero_id || !valores.fecha || !valores.hora) {
            error.textContent = 'Completa teléfono, nombre, servicio, barbero, fecha y hora.';
            return;
        }
        const creada = await ejecutar(e.submitter, () => api('panel_crear_cita', { p_datos: valores }), ctx.notificar, 'Cita creada');
        if (creada) {
            cerrar();
            estado.fecha = creada.fecha;
            await recargar();
        }
    });
}

// ---------- Detalle de cita ----------
async function textoWhatsApp(c, tipo) {
    let plantillas = null;
    let ubicacion = null;
    try { plantillas = (await api('panel_plantillas')).plantillas; } catch { /* rol barbero: texto básico */ }
    try { ubicacion = await api('ubicacion_publica'); } catch { /* sin ubicación */ }
    const base = plantillas?.find(p => p.tipo === tipo)?.texto
        || 'Hola {cliente}, te escribimos sobre tu cita de {servicio} con {barbero} el {fecha} a las {hora}.';
    const valores = {
        cliente: c.cliente, servicio: c.servicio || '', barbero: c.barbero || '', fecha: fechaLarga(c.fecha), hora: c.hora,
        ubicacion: ubicacion ? `${ubicacion.nombre} - ${ubicacion.direccion}` : '',
        mapa: ubicacion ? `https://www.google.com/maps/dir/?api=1&destination=${ubicacion.latitud},${ubicacion.longitud}` : ''
    };
    return base.replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m)).replace(/\n{2,}/g, '\n').trim();
}

export async function abrirDetalle(id, ctx, recargar) {
    let c;
    try { c = await api('panel_cita', { p_cita: id }); } catch (e) { ctx.notificar(e.message, 'error'); return; }
    const esAdmin = ctx.rol === 'admin';
    const abierta = c.estado_visual === 'pendiente' || c.estado_visual === 'confirmada';
    const yaPaso = `${c.fecha} ${c.hora}` <= `${hoyLocal()} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())}`;
    const { cuerpo, cerrar } = dialogo({ titulo: `Cita de ${c.cliente}`, ancho: 'lg', html: `
        <div class="detalle-cita">
            <div class="detalle-estado">${etiquetaEstado(c)} ${c.cliente_confirmo ? '<span class="estado-chip estado-confirmada">Cliente confirmó</span>' : ''}</div>
            <dl class="panel-datos">
                <div><dt>Fecha</dt><dd>${esc(fechaLarga(c.fecha))}</dd></div>
                <div><dt>Horario</dt><dd>${esc(c.hora)}–${esc(c.fin)} (${c.duracion} min)</dd></div>
                <div><dt>Servicio</dt><dd>${esc(c.servicio || '')}</dd></div>
                <div><dt>Barbero</dt><dd>${esc(c.barbero || '')}</dd></div>
                <div><dt>Precio</dt><dd>${dinero(c.precio)}${Number(c.descuento) > 0 ? ` <small>(descuento ${dinero(c.descuento)})</small>` : ''}${Number(c.total_productos) > 0 ? ` + productos ${dinero(c.total_productos)}` : ''}</dd></div>
                <div><dt>Pago</dt><dd>${c.pagada ? `Pagada: ${dinero(c.monto_cobrado)} · ${esc(METODOS[c.metodo_pago] || c.metodo_pago)} · ${esc(fechaHora(c.pagada_en))}`
                    : Number(c.monto_cobrado) > 0 ? `Pago parcial: ${dinero(c.monto_cobrado)} cobrado` : 'Pendiente de cobro'}</dd></div>
                <div><dt>Cliente</dt><dd>${esc(c.cliente)}<br><a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>${c.email ? `<br>${esc(c.email)}` : ''}</dd></div>
                <div><dt>Origen</dt><dd>${esc({ web: 'Web', admin: 'Administración', lista_espera: 'Lista de espera' }[c.origen] || c.origen)} · ${esc(fechaHora(c.creado_en))}</dd></div>
                ${c.motivo_cancelacion ? `<div class="ancho"><dt>Motivo de cancelación</dt><dd>${esc(c.motivo_cancelacion)}</dd></div>` : ''}
            </dl>

            <section class="detalle-bloque">
                <h4><i class="fab fa-whatsapp"></i> WhatsApp</h4>
                <div class="panel-fila">
                    <select data-wa-tipo aria-label="Mensaje">
                        <option value="confirmacion">Confirmación</option><option value="recordatorio">Recordatorio</option>
                        <option value="reprogramacion">Reprogramación</option><option value="cancelacion">Cancelación</option>
                    </select>
                    <button type="button" class="panel-btn" data-wa><i class="fab fa-whatsapp"></i> Abrir WhatsApp con texto</button>
                </div>
                <p class="panel-sub">Abre WhatsApp con el mensaje preparado; el envío lo haces tú desde tu teléfono.</p>
                ${esAdmin ? `<div class="detalle-envios"><strong>Envío automático:</strong> ${c.mensajes?.length
                    ? c.mensajes.map(m => `<span class="estado-chip envio-${esc(m.estado)}">${esc(m.tipo)}: ${esc(m.estado)}${m.error ? ` (${esc(m.error)})` : ''}</span>`).join(' ')
                    : 'sin mensajes automáticos para esta cita (requiere el módulo WhatsApp, credenciales de Meta y plantillas aprobadas).'}</div>` : ''}
            </section>

            <section class="detalle-bloque">
                <h4><i class="fas fa-sticky-note"></i> Notas</h4>
                <textarea data-notas rows="2" maxlength="1000">${esc(c.notas || '')}</textarea>
                <button type="button" class="panel-btn" data-guardar-notas>Guardar notas</button>
            </section>

            <section class="detalle-bloque">
                <h4><i class="fas fa-bolt"></i> Acciones</h4>
                <div class="panel-acciones panel-acciones-izq">
                    ${c.estado_visual === 'pendiente' ? '<button type="button" class="panel-btn panel-btn-principal" data-accion="confirmar"><i class="fas fa-check"></i> Confirmar</button>' : ''}
                    ${abierta ? '<button type="button" class="panel-btn" data-accion="completar"><i class="fas fa-check-double"></i> Marcar completada</button>' : ''}
                    ${abierta && yaPaso ? '<button type="button" class="panel-btn" data-accion="no_asistio"><i class="fas fa-user-xmark"></i> No asistió</button>' : ''}
                    ${esAdmin && abierta ? '<button type="button" class="panel-btn" data-mostrar="reprogramar"><i class="fas fa-calendar-alt"></i> Reprogramar</button>' : ''}
                    ${esAdmin && c.estado_visual !== 'cancelada' && !c.pagada ? '<button type="button" class="panel-btn" data-cobrar><i class="fas fa-cash-register"></i> Cobrar</button>' : ''}
                    ${esAdmin && (c.pagada || Number(c.monto_cobrado) > 0) ? '<button type="button" class="panel-btn" data-ver-venta><i class="fas fa-receipt"></i> Ver cobro, devolver o anular</button>' : ''}
                    ${esAdmin && abierta ? '<button type="button" class="panel-btn panel-btn-peligro" data-mostrar="cancelar"><i class="fas fa-ban"></i> Cancelar cita</button>' : ''}
                </div>
                <form class="panel-form detalle-sub" data-sub="reprogramar" hidden novalidate>
                    <div class="panel-rejilla">
                        <label>Nueva fecha<input type="date" name="fecha" value="${esc(c.fecha)}"></label>
                        <label>Barbero<select name="barbero_id"></select></label>
                        <label>Hora<input type="time" name="hora" step="300" value="${esc(c.hora)}"></label>
                    </div>
                    <div data-horas></div>
                    <button type="submit" class="panel-btn panel-btn-principal">Guardar nuevo horario</button>
                </form>
                <form class="panel-form detalle-sub" data-sub="cancelar" hidden novalidate>
                    <label>Motivo de la cancelación<input name="motivo" maxlength="300" required placeholder="Ej.: el cliente avisó que no puede venir"></label>
                    <button type="submit" class="panel-btn panel-btn-peligro">Cancelar la cita</button>
                </form>
            </section>

            <details class="detalle-bloque" ${c.historial.length > 1 ? '' : 'open'}>
                <summary><i class="fas fa-history"></i> Historial de cambios (${c.historial.length})</summary>
                <ol class="panel-historial">${c.historial.map(h => `
                    <li><time>${esc(fechaHora(h.fecha))}</time> <strong>${esc(ACCIONES_HISTORIAL[h.accion] || h.accion)}</strong>
                        <small>· ${esc({ admin: 'Administración', barbero: 'Barbero', web: 'Cliente (web)' }[h.rol] || h.rol)}</small>
                        ${h.detalle?.motivo ? `<br><small>Motivo: ${esc(h.detalle.motivo)}</small>` : ''}
                        ${h.detalle?.de ? `<br><small>De ${esc(h.detalle.de.fecha)} ${esc(h.detalle.de.hora)} a ${esc(h.detalle.a.fecha)} ${esc(h.detalle.a.hora)}</small>` : ''}
                        ${h.detalle?.monto !== undefined && h.accion === 'pago_registrado' ? `<br><small>${dinero(h.detalle.monto)} · ${esc(METODOS[h.detalle.metodo] || h.detalle.metodo)}</small>` : ''}
                    </li>`).join('')}</ol>
            </details>
        </div>` });

    const refrescar = async () => { cerrar(); await recargar?.(); await abrirDetalle(id, ctx, recargar); };
    const actuar = (boton, accion, datos, mensaje) => ejecutar(boton, () => api('panel_actualizar_cita', { p_cita: id, p_accion: accion, p_datos: datos }), ctx.notificar, mensaje);

    cuerpo.querySelector('[data-wa]').addEventListener('click', async () => {
        const texto = await textoWhatsApp(c, cuerpo.querySelector('[data-wa-tipo]').value);
        window.open(`https://wa.me/${telefonoWhatsApp(c.telefono)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    });
    cuerpo.querySelector('[data-guardar-notas]').addEventListener('click', async e => {
        if (await actuar(e.currentTarget, 'notas', { notas: cuerpo.querySelector('[data-notas]').value }, 'Notas guardadas')) refrescar();
    });
    cuerpo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', async () => {
        const accion = b.dataset.accion;
        if (accion === 'no_asistio' && !await confirmar('¿Marcar que el cliente no asistió?', { textoOk: 'Sí, no asistió', peligro: true })) return;
        const mensajes = { confirmar: 'Cita confirmada', completar: 'Cita completada (el cobro se registra aparte)', no_asistio: 'Ausencia registrada' };
        if (await actuar(b, accion, {}, mensajes[accion])) refrescar();
    }));
    cuerpo.querySelectorAll('[data-mostrar]').forEach(b => b.addEventListener('click', () => {
        cuerpo.querySelectorAll('[data-sub]').forEach(f => { f.hidden = f.dataset.sub !== b.dataset.mostrar || !f.hidden; });
        const form = cuerpo.querySelector(`[data-sub="${b.dataset.mostrar}"]`);
        form.querySelector('input,select')?.focus();
        if (b.dataset.mostrar === 'reprogramar') prepararReprogramacion(form, c, ctx);
    }));
    // El cobro se registra en Ventas y cobros (caja, pagos mixtos, saldos y devoluciones)
    const tras = async () => { await recargar?.(); };
    cuerpo.querySelector('[data-cobrar]')?.addEventListener('click', () => { cerrar(); abrirCobroDeCita(id, ctx, tras); });
    cuerpo.querySelector('[data-ver-venta]')?.addEventListener('click', async () => {
        try {
            const { venta } = await api('panel_venta_de_cita', { p_cita: id });
            if (venta) { cerrar(); abrirVenta(venta.id, ctx, tras); }
        } catch (e) { ctx.notificar(e.message, 'error'); }
    });
    cuerpo.querySelector('[data-sub="cancelar"]').addEventListener('submit', async e => {
        e.preventDefault();
        const motivo = e.target.elements.motivo.value.trim();
        if (motivo.length < 3) { ctx.notificar('Escribe el motivo de la cancelación.', 'error'); return; }
        if (!await confirmar(`¿Cancelar la cita de ${c.cliente}? El horario quedará libre.`, { textoOk: 'Cancelar cita', peligro: true })) return;
        if (await actuar(e.submitter, 'cancelar', { motivo }, 'Cita cancelada')) refrescar();
    });
    cuerpo.querySelector('[data-sub="reprogramar"]').addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        if (!d.fecha || !d.hora) { ctx.notificar('Elige fecha y hora.', 'error'); return; }
        if (await actuar(e.submitter, 'reprogramar', d, 'Cita reprogramada')) refrescar();
    });
}

async function prepararReprogramacion(form, c, ctx) {
    const { barberos } = await obtenerCatalogos(ctx);
    const aptos = barberos.filter(b => b.activo && b.servicios.includes(c.servicio_id));
    if (!aptos.some(b => b.id === c.barbero_id)) aptos.unshift({ id: c.barbero_id, nombre: c.barbero });
    form.elements.barbero_id.innerHTML = aptos.map(b => `<option value="${esc(b.id)}" ${b.id === c.barbero_id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
    const actualizar = () => selectorHorario(form, ctx, { barberoId: form.elements.barbero_id.value, servicioId: c.servicio_id, fecha: form.elements.fecha.value, excluir: c.id });
    form.elements.fecha.onchange = actualizar;
    form.elements.barbero_id.onchange = actualizar;
    actualizar();
}
