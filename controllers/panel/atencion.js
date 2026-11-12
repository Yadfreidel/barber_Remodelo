// ==========================================
// PANEL: ATENCIÓN (citas del día y turnos de la Fila virtual en una sola lista)
// Citas: «Llegó», «Iniciar» y «Terminar» (terminar usa el mismo «completar» de la agenda: no registra pagos).
// Turnos QR: «Llamar siguiente», «Iniciar servicio», «No se presentó» y «Finalizar» llaman a las MISMAS
// funciones de la Fila virtual: el servidor decide permisos, huecos, prioridad de las citas confirmadas y
// concurrencia (un turno nunca se asigna dos veces). El panel de Fila virtual, el celular del cliente y la
// pantalla de la TV leen el mismo estado. La administración ve todo el equipo; cada barbero, lo suyo.
// ==========================================

import { api, esc, hoyLocal, fechaLarga, confirmar, vacio, fechaHora, dialogo } from './comun.js';
import { turnoDe } from './finanzas-comun.js';
import { formato12h } from '../../assets/horario-utils.js';
import { ESTADOS_FILA, MOTIVOS_FILA, traducirFila, abrirPantallaTurnos } from './fila.js';
import { pintarConsultaEstilo } from '../estiloConsultaController.js';
import { pintarReferenciaCita } from '../referenciaEstiloController.js';

const INTERVALO = 8000;
const estado = { fecha: null, barbero: '', tipo: 'todo', barberoLlamar: '' };
const minutos = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000));
const horaDe = ts => (ts ? String(ts).slice(11, 16) : '');                       // timestamp local del servidor
const horaRD = iso => (iso ? new Date(iso).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Santo_Domingo' }) : '');
const hhmmRD = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santo_Domingo' }) : '');
const ERRORES_CITA = {
    cita_no_es_hoy: 'Solo se puede marcar en citas de hoy.',
    cita_cancelada: 'La cita está cancelada.',
    cita_completada: 'La cita ya se completó.',
    cita_marcada_no_asistio: 'La cita está marcada como «no asistió».',
    cita_no_encontrada: 'Esa cita ya no está a tu cargo.'
};
const traducirCita = e => ERRORES_CITA[Object.keys(ERRORES_CITA).find(k => `${e?.codigo || ''} ${e?.message || ''}`.includes(k))] || traducirFila(e);

function faseCita(c) {
    if (c.no_asistio_en) return ['No asistió', 'estado-cancelada'];
    if (c.completada_en) return ['Terminado', 'estado-confirmada'];
    if (c.iniciada_en) return ['En atención', 'estado-pendiente'];
    if (c.llegada_en) return ['Llegó', 'estado-llego'];
    return [c.estado === 'confirmada' ? 'Confirmada · por llegar' : 'Pendiente · por llegar', ''];
}

export async function renderAtencion(cont, ctx) {
    const esAdmin = ctx.rol === 'admin';
    estado.fecha = estado.fecha || hoyLocal();
    const vigente = turnoDe(cont);
    cont.innerHTML = `<div class="atencion-unificada">
        <div class="panel-encabezado"><div><h2>Atención</h2>
            <p class="panel-sub">Citas del día y turnos del QR en una sola lista. Terminar no registra el pago: el cobro se hace en caja.</p></div>
            ${esAdmin ? `<div class="fila-panel-acciones"><button type="button" class="panel-btn panel-btn-mini" data-pantalla>
                <i class="fas fa-tv" aria-hidden="true"></i> Abrir pantalla de turnos</button></div>` : ''}</div>
        <div class="agenda-filtros">
            <input type="date" data-fecha value="${esc(estado.fecha)}" aria-label="Fecha">
            ${esAdmin ? '<select data-barbero aria-label="Barbero"><option value="">Todos los barberos</option></select>' : ''}
            <div class="atencion-tipos" role="group" aria-label="Mostrar">
                ${[['todo', 'Todo'], ['cita', 'Citas'], ['turno', 'Turnos QR']].map(([v, t]) =>
                    `<button type="button" class="atencion-tipo" data-tipo="${v}" aria-pressed="${estado.tipo === v}">${t}</button>`).join('')}
            </div>
        </div>
        <div data-zona-llamar></div>
        <div data-lista aria-live="polite"><p class="panel-cargando">Cargando la atención del día…</p></div></div>`;
    const raiz = cont.querySelector('.atencion-unificada');
    const lista = raiz.querySelector('[data-lista]');
    const zonaLlamar = raiz.querySelector("[data-zona-llamar]");
    const vivo = () => raiz.isConnected && vigente();
    const st = { citas: [], fila: null, firma: '', temporizador: null, barberos: null, ocupado: false, motivo: null, errorFila: null };

    // ---------- Datos ----------
    async function cargar({ silencioso = false } = {}) {
        clearTimeout(st.temporizador);
        // Tras una acción (recarga no silenciosa) se repinta todo: los botones vuelven a habilitarse
        if (!silencioso) { lista.__html = null; zonaLlamar.__html = null; }
        const esHoy = estado.fecha === hoyLocal();
        try {
            const [citas, fila, barberos] = await Promise.all([
                api('panel_atencion', { p_fecha: estado.fecha, p_barbero: estado.barbero || null }),
                // Los turnos de la fila son del día: solo se consultan hoy
                esHoy ? api('panel_fila', { p_barbero: null }).catch(e => { st.errorFila = traducirFila(e); return null; }) : null,
                esAdmin && !st.barberos ? api('panel_barberos') : null]);
            if (!vivo()) return;
            if (barberos) { st.barberos = barberos; pintarFiltroBarberos(); }
            st.citas = citas;
            st.fila = fila;
            if (fila) st.errorFila = null;
            const firma = JSON.stringify([citas, fila?.turnos, fila?.config?.recepcion_abierta, fila?.ocupado_por_cita, fila?.proxima_cita, st.motivo, st.errorFila]);
            if (firma !== st.firma || !silencioso) { st.firma = firma; pintar(); }
        } catch (e) {
            if (!vivo()) return;
            if (!silencioso) poner(lista, `<p class="panel-error">${esc(e.message)}</p><button type="button" class="panel-btn" data-recargar>Reintentar</button>`);
        }
        if (vivo() && esHoy) st.temporizador = setTimeout(() => { if (document.visibilityState === 'visible') cargar({ silencioso: true }); }, INTERVALO);
    }
    const alVolver = () => {
        if (!vivo()) return document.removeEventListener('visibilitychange', alVolver);
        if (document.visibilityState === 'visible' && estado.fecha === hoyLocal()) cargar({ silencioso: true });
    };
    document.addEventListener('visibilitychange', alVolver);

    function pintarFiltroBarberos() {
        const sel = raiz.querySelector('[data-barbero]');
        if (!sel) return;
        sel.innerHTML = '<option value="">Todos los barberos</option>' + st.barberos.filter(b => b.activo)
            .map(b => `<option value="${esc(b.id)}" ${String(b.id) === estado.barbero ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
    }

    // ---------- Pintado ----------
    function turnosVisibles() {
        const t = st.fila?.turnos || [];
        if (!esAdmin || !estado.barbero) return t;
        const b = estado.barbero;
        // Un barbero filtrado: los que atiende, los pedidos para él y los «primero disponible» que esperan
        return t.filter(x => x.barbero_atiende === b || x.barbero_id === b || (x.estado === 'en_espera' && !x.barbero_id));
    }

    function claveTurno(t) {
        if (t.estado === 'en_servicio') return hhmmRD(t.iniciado_en);
        if (t.estado === 'llamado') return hhmmRD(t.llamado_en);
        if (t.estado === 'en_espera') return horaDe(t.inicio_estimado) || hhmmRD(t.creado_en);
        return hhmmRD(t.cerrado_en || t.creado_en);
    }

    function tarjetaCita(c, esHoy) {
        const fase = faseCita(c);
        const abierta = !c.completada_en && !c.no_asistio_en;
        return `<article class="atencion-cita atencion-item" data-cita="${esc(c.id)}">
            <div class="atencion-hora"><span class="atencion-etiqueta cita">Cita</span><strong>${esc(formato12h(c.hora))}</strong><small>${esc(c.duracion)} min</small></div>
            <div class="atencion-info"><strong>${esc(c.cliente)}</strong><span>${esc(c.servicio || '')}${esAdmin ? ` · ${esc(c.barbero || '')}` : ''}</span>
                ${c.notas ? `<small><i class="fas fa-note-sticky" aria-hidden="true"></i> ${esc(c.notas)}</small>` : ''}
                <small><span class="estado-chip ${fase[1]}">${fase[0]}</span>
                ${c.llegada_en && !c.iniciada_en ? ` Llegó ${esc(horaRD(c.llegada_en))}` : ''}
                ${c.iniciada_en ? ` Inicio ${esc(fechaHora(c.iniciada_en).split(' ').pop())}` : ''}
                ${c.iniciada_en && c.completada_en ? ` · Duración real ${minutos(c.iniciada_en, c.completada_en)} min` : ''}</small>
                ${c.estilo ? `<button type="button" class="atencion-estilo" data-estilo="${esc(c.id)}"><i class="fas fa-image" aria-hidden="true"></i> Ver cómo quiere su corte</button>` : ''}</div>
            <div class="atencion-acciones">
                ${esHoy && abierta && !c.llegada_en && !c.iniciada_en ? `<button type="button" class="panel-btn" data-llego="${esc(c.id)}"><i class="fas fa-door-open" aria-hidden="true"></i> Llegó</button>` : ''}
                ${esHoy && abierta && !c.iniciada_en ? `<button type="button" class="panel-btn panel-btn-principal" data-iniciar="${esc(c.id)}"><i class="fas fa-play" aria-hidden="true"></i> Iniciar</button>` : ''}
                ${abierta ? `<button type="button" class="panel-btn" data-terminar="${esc(c.id)}"><i class="fas fa-flag-checkered" aria-hidden="true"></i> Terminar</button>` : ''}
            </div></article>`;
    }

    function tarjetaTurno(t) {
        const [texto] = ESTADOS_FILA[t.estado] || [t.estado];
        const yo = st.fila?.barbero_id;
        const puedo = esAdmin || (yo && t.barbero_atiende === yo);
        const quien = t.estado === 'en_espera' ? (t.barbero ? `Pidió a ${esc(t.barbero)}` : 'Primero disponible')
            : t.atiende ? `Atiende ${esc(t.atiende)}` : (t.barbero ? esc(t.barbero) : 'Primero disponible');
        const espera = Math.max(0, Math.round((Date.parse(st.fila.ahora) - Date.parse(t.creado_en)) / 60000));
        const detalle = t.estado === 'en_espera'
            ? `Espera ${espera} min · ${t.inicio_estimado ? `≈ ${esc(formato12h(horaDe(t.inicio_estimado)))}` : 'sin hueco hoy por ahora'}`
            : t.estado === 'llamado' ? `Llamado ${esc(horaRD(t.llamado_en))} · cortesía hasta ${esc(formato12h(horaDe(t.llamado_hasta)))}`
            : t.estado === 'en_servicio' ? `En servicio desde ${esc(horaRD(t.iniciado_en))}`
            : t.cierre_motivo === 'cortesia_vencida' ? 'Venció la cortesía' : t.cerrado_en ? `Cerrado ${esc(horaRD(t.cerrado_en))}` : '';
        return `<article class="atencion-cita atencion-item atencion-turno ${esc(t.estado)}" data-turno="${esc(t.id)}">
            <div class="atencion-hora"><span class="atencion-etiqueta turno">Turno QR</span><strong class="fila-codigo-panel">${esc(t.codigo)}</strong><small>${Number(t.duracion)} min</small></div>
            <div class="atencion-info"><strong>${esc(t.servicio)}${t.nombre ? ` · ${esc(t.nombre)}` : ''}</strong><span>${quien}</span>
                <small><span class="estado-chip ${t.estado === 'en_servicio' ? 'estado-pendiente' : t.estado === 'llamado' ? 'estado-llego' : ['finalizado'].includes(t.estado) ? 'estado-confirmada' : ['salio', 'no_se_presento'].includes(t.estado) ? 'estado-cancelada' : ''}">${esc(texto)}</span> ${detalle}</small></div>
            <div class="atencion-acciones">${puedo && t.estado === 'llamado'
                ? `<button type="button" class="panel-btn panel-btn-principal" data-turno-accion="iniciar"><i class="fas fa-play" aria-hidden="true"></i> Iniciar servicio</button>
                   <button type="button" class="panel-btn" data-turno-accion="no_se_presento"><i class="fas fa-user-slash" aria-hidden="true"></i> No se presentó</button>`
                : puedo && t.estado === 'en_servicio'
                ? `<button type="button" class="panel-btn panel-btn-principal" data-turno-accion="finalizar"><i class="fas fa-check" aria-hidden="true"></i> Finalizar</button>` : ''}</div>
        </article>`;
    }

    // Solo se reemplaza el HTML que cambió: un toque durante el refresco automático no se pierde
    const poner = (caja, html) => { if (caja.__html !== html) { caja.__html = html; caja.innerHTML = html; } };
    function pintarLlamar() { poner(zonaLlamar, htmlLlamar()); }
    function htmlLlamar() {
        const d = st.fila;
        if (!d) return st.errorFila ? `<p class="panel-aviso">Fila virtual no disponible: ${esc(st.errorFila)}</p>` : '';
        const recepcion = `<span class="fila-recepcion ${d.config.recepcion_abierta ? 'abierta' : ''}">${d.config.recepcion_abierta ? 'Recepción QR abierta' : 'Recepción QR en pausa'}</span>`;
        const esperan = d.turnos.filter(t => t.estado === 'en_espera').length;
        if (esAdmin) {
            return `<div class="atencion-llamar">${recepcion} <span class="fila-tenue">${esperan} en espera</span>
                <label>Llamar siguiente para <select data-barbero-llamar><option value="">Elige un barbero</option>${(d.barberos || []).filter(b => b.trabaja_hoy)
                    .map(b => `<option value="${esc(b.id)}" ${b.id === estado.barberoLlamar ? 'selected' : ''} ${b.ocupado ? 'disabled' : ''}>${esc(b.nombre)}${b.ocupado ? ' (atendiendo)' : ''}</option>`).join('')}</select></label>
                <button type="button" class="panel-btn panel-btn-principal" data-llamar ${st.ocupado ? 'disabled' : ''}><i class="fas fa-bullhorn" aria-hidden="true"></i> Llamar siguiente</button></div>
                ${st.motivo ? `<p class="panel-aviso fila-motivo" role="status">${esc(st.motivo)}</p>` : ''}`;
        }
        const mio = d.turnos.find(t => ['llamado', 'en_servicio'].includes(t.estado) && t.barbero_atiende === d.barbero_id);
        return `<div class="atencion-llamar">${recepcion} <span class="fila-tenue">${esperan} turno(s) que puedes atender</span>
            ${mio ? `<span class="fila-tenue">Tienes el turno ${esc(mio.codigo)} ${mio.estado === 'llamado' ? 'llamado' : 'en servicio'}.</span>`
                : `<button type="button" class="panel-btn panel-btn-principal" data-llamar ${st.ocupado || d.ocupado_por_cita ? 'disabled' : ''}><i class="fas fa-bullhorn" aria-hidden="true"></i> Llamar siguiente</button>`}</div>
            ${d.ocupado_por_cita && !mio ? '<p class="fila-tenue">Tienes una cita en atención: termínala para llamar a la fila.</p>'
                : d.proxima_cita && !mio ? `<p class="fila-tenue">Tu próxima cita es a las ${esc(formato12h(d.proxima_cita.hora))}: solo se llama un turno que termina antes.</p>` : ''}
            ${st.motivo ? `<p class="panel-aviso fila-motivo" role="status">${esc(st.motivo)}</p>` : ''}`;
    }

    function pintar() {
        const esHoy = estado.fecha === hoyLocal();
        pintarLlamar();
        const items = [];
        if (estado.tipo !== 'turno') st.citas.forEach(c => items.push({ clave: c.hora, orden: 0, html: tarjetaCita(c, esHoy) }));
        if (estado.tipo !== 'cita' && st.fila) turnosVisibles().forEach(t => items.push({ clave: claveTurno(t), orden: 1, html: tarjetaTurno(t) }));
        items.sort((a, b) => a.clave.localeCompare(b.clave) || a.orden - b.orden);
        const foco = document.activeElement && raiz.contains(document.activeElement) ? document.activeElement : null;
        const marca = foco && [...foco.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
        poner(lista, `<h3 class="atencion-dia">${esc(fechaLarga(estado.fecha))}</h3>` + (items.length
            ? `<div class="atencion-lista">${items.map(i => i.html).join('')}</div>`
            : vacio(estado.tipo === 'turno' ? (esHoy ? 'No hay turnos del QR hoy.' : 'Los turnos del QR solo existen el día de hoy.') : 'No hay citas ni turnos para atender este día.', 'mug-hot')));
        if (marca && !foco.isConnected) raiz.querySelector(marca)?.focus({ preventScroll: true }); // el refresco no roba el foco
    }

    // ---------- Acciones ----------
    async function accionCita(b, operacion, mensaje) {
        b.disabled = true;
        try { await operacion(); ctx.notificar(mensaje); }
        catch (e) { ctx.notificar(traducirCita(e), 'error'); }
        await cargar();
    }

    async function llamar(b) {
        const p = esAdmin ? raiz.querySelector('[data-barbero-llamar]')?.value : null;
        if (esAdmin && !p) { ctx.notificar('Elige el barbero que atenderá.', 'error'); return; }
        st.ocupado = true;
        b.disabled = true;
        try {
            const r = await api('panel_fila_llamar', { p_barbero: p || null });
            st.motivo = r.turno ? null : MOTIVOS_FILA[r.motivo];
            if (r.turno) ctx.notificar(`Llamado ${r.turno.codigo}${r.turno.nombre ? ` (${r.turno.nombre})` : ''}: ${r.turno.servicio}.`);
        } catch (e) { ctx.notificar(traducirFila(e), 'error'); }
        st.ocupado = false;
        await cargar();
    }

    async function accionTurno(b) {
        const id = b.closest('[data-turno]').dataset.turno;
        const nombre = b.dataset.turnoAccion;
        if (nombre === 'no_se_presento' && !await confirmar('¿Marcar que no se presentó? El turno se cerrará y el hueco quedará libre.', { textoOk: 'No se presentó' })) return;
        b.disabled = true;
        try {
            if (nombre === 'iniciar') await api('panel_fila_iniciar', { p_turno: id });
            else await api('panel_fila_cerrar', { p_turno: id, p_accion: nombre });
            st.motivo = null;
            ctx.notificar({ iniciar: 'Servicio iniciado', finalizar: 'Turno finalizado', no_se_presento: 'Turno cerrado: no se presentó' }[nombre]);
        } catch (e) { ctx.notificar(traducirFila(e), 'error'); }
        await cargar();
    }

    function verEstilo(id) {
        const { cuerpo } = dialogo({ titulo: 'Cómo quiere su corte', html: `
            <section class="cita-referencia" data-estilo-cita hidden></section>
            <section class="cita-referencia" data-referencia-cita hidden></section>` });
        pintarConsultaEstilo(cuerpo.querySelector('[data-estilo-cita]'), completa => api('panel_cita_estilo', { p_cita: id, p_completa: completa }), { titulo: 'Foto y nota del cliente' });
        pintarReferenciaCita(cuerpo.querySelector('[data-referencia-cita]'), () => api('panel_cita_referencia', { p_cita: id }), { titulo: 'Estilo elegido en «Estilos de la casa»', nota: false });
    }

    raiz.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.matches('[data-recargar]')) return cargar();
        if (b.matches('[data-pantalla]')) return abrirPantallaTurnos();
        if (b.dataset.tipo) {
            estado.tipo = b.dataset.tipo;
            raiz.querySelectorAll('[data-tipo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            return pintar();
        }
        if (b.matches('[data-llamar]')) return llamar(b);
        if (b.dataset.turnoAccion) return accionTurno(b);
        if (b.dataset.estilo) return verEstilo(b.dataset.estilo);
        if (b.dataset.llego) return accionCita(b, () => api('panel_cita_llegada', { p_cita: b.dataset.llego }), 'Llegada registrada');
        if (b.dataset.iniciar) return accionCita(b, () => api('panel_cita_iniciar', { p_cita: b.dataset.iniciar }), 'Servicio iniciado');
        if (b.dataset.terminar) {
            if (!await confirmar('¿Terminar el servicio? Queda como completado; el pago se registra aparte en caja.', { textoOk: 'Terminar' })) return;
            return accionCita(b, () => api('panel_actualizar_cita', { p_cita: b.dataset.terminar, p_accion: 'completar', p_datos: {} }), 'Servicio terminado');
        }
    });
    raiz.addEventListener('change', e => {
        if (e.target.matches('[data-fecha]')) { estado.fecha = e.target.value || hoyLocal(); st.motivo = null; poner(lista, '<p class="panel-cargando">Cargando…</p>'); cargar(); }
        if (e.target.matches('[data-barbero]')) { estado.barbero = e.target.value; cargar(); }
        if (e.target.matches('[data-barbero-llamar]')) estado.barberoLlamar = e.target.value;
    });

    await cargar();
}
