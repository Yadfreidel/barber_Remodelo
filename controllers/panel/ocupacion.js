// ==========================================
// PANEL: OCUPACIÓN Y HORAS VACÍAS
// Lectura del mismo motor de agenda (jornada, descansos, bloqueos, duración de cada cita
// y minutos de preparación entre citas). Solo muestra datos: no crea descuentos, mensajes
// ni cambios en la agenda.
// ==========================================

import { api, esc, hoyLocal, sumarDias, inicioSemana, inicioMes, finMes, fechaCorta, descargarCSV, vacio, DIAS } from './comun.js';
import { turnoDe } from './finanzas-comun.js';

const PERIODOS = { hoy: 'Hoy', semana: 'Esta semana', proxima: 'Próxima semana', mes: 'Este mes', mes_anterior: 'Mes anterior', personalizado: 'Rango de fechas' };
const estado = { tipo: 'semana', desde: '', hasta: '', barbero: '' };
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo

function rango() {
    const hoy = hoyLocal();
    if (estado.tipo === 'hoy') return [hoy, hoy];
    if (estado.tipo === 'semana') return [inicioSemana(hoy), sumarDias(inicioSemana(hoy), 6)];
    if (estado.tipo === 'proxima') return [sumarDias(inicioSemana(hoy), 7), sumarDias(inicioSemana(hoy), 13)];
    if (estado.tipo === 'mes') return [inicioMes(hoy), finMes(hoy)];
    if (estado.tipo === 'mes_anterior') { const ant = sumarDias(inicioMes(hoy), -1); return [inicioMes(ant), finMes(ant)]; }
    return [estado.desde || inicioSemana(hoy), estado.hasta || sumarDias(inicioSemana(hoy), 6)];
}

export const horas = min => {
    const m = Math.round(Number(min) || 0);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
// Ocupación reservada = minutos reservados dentro del tiempo disponible ÷ minutos disponibles
export const porcentaje = (reservados, disponibles) => Number(disponibles) > 0 ? Math.round(Number(reservados) / Number(disponibles) * 1000) / 10 : null;
const textoPct = p => p === null ? 'Sin jornada disponible' : `${p.toLocaleString('es-DO')} %`;

function tarjeta(titulo, valor, explicacion, { icono = 'chart-simple', nota = '' } = {}) {
    return `<article class="resumen-tarjeta"><i class="fas fa-${icono}"></i><div><span>${esc(titulo)}</span><strong>${valor}</strong>
        ${nota ? `<small>${nota}</small>` : ''}${explicacion ? `<details class="fin-explica"><summary>¿Cómo se calcula?</summary><p>${esc(explicacion)}</p></details>` : ''}</div></article>`;
}

export async function renderOcupacion(cont, ctx) {
    const [desde, hasta] = rango();
    const vigente = turnoDe(cont);
    cont.innerHTML = `
        <div class="panel-encabezado"><div><h2>${ctx.rol === 'admin' ? 'Ocupación y horas vacías' : 'Mi ocupación'}</h2>
            <p class="panel-sub">Cuánto del tiempo disponible de cada barbero está reservado y qué huecos quedan libres. Solo informa: no cambia la agenda.</p></div></div>
        <div class="agenda-filtros">
            <select data-periodo aria-label="Periodo">${Object.entries(PERIODOS).map(([k, v]) => `<option value="${k}" ${estado.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <input type="date" data-desde value="${desde}" ${estado.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Desde">
            <input type="date" data-hasta value="${hasta}" ${estado.tipo === 'personalizado' ? '' : 'disabled'} aria-label="Hasta">
            ${ctx.rol === 'admin' ? '<select data-barbero aria-label="Barbero"><option value="">Todos los barberos</option></select>' : ''}
            <button type="button" class="panel-btn" data-csv disabled><i class="fas fa-file-csv"></i> CSV</button>
        </div>
        <div data-cuerpo><p class="panel-cargando"><span class="motion-skeleton" aria-hidden="true"></span>Calculando ocupación…</p></div>`;
    const recargar = () => renderOcupacion(cont, ctx);
    cont.querySelector('[data-periodo]').addEventListener('change', e => { estado.tipo = e.target.value; [estado.desde, estado.hasta] = [desde, hasta]; recargar(); });
    ['desde', 'hasta'].forEach(k => cont.querySelector(`[data-${k}]`).addEventListener('change', e => { estado[k] = e.target.value; recargar(); }));
    const cuerpo = cont.querySelector('[data-cuerpo]');
    if (hasta < desde || (Date.parse(hasta) - Date.parse(desde)) / 864e5 > 92) {
        cuerpo.innerHTML = '<p class="panel-error">Elige un rango de hasta 93 días con la fecha final posterior a la inicial.</p>';
        return;
    }
    let datos, barberos, real;
    try {
        // El barbero solo recibe su propia ocupación (lo decide el servidor)
        [datos, barberos, real] = await Promise.all([api('panel_ocupacion', { p_desde: desde, p_hasta: hasta, p_barbero: estado.barbero || null }),
            ctx.rol === 'admin' ? api('panel_barberos') : [], api('panel_tiempo_real', { p_desde: desde, p_hasta: hasta, p_barbero: estado.barbero || null })]);
    } catch (e) { if (vigente()) cuerpo.innerHTML = `<p class="panel-error">${esc(e.message)}</p>`; return; }
    if (!vigente()) return;
    const selector = cont.querySelector('[data-barbero]');
    if (selector) selector.innerHTML += barberos.filter(b => b.activo || String(b.id) === estado.barbero)
        .map(b => `<option value="${esc(b.id)}" ${String(b.id) === estado.barbero ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('');
    selector?.addEventListener('change', e => { estado.barbero = e.target.value; recargar(); });

    const suma = k => datos.barberos.reduce((s, b) => s + Number(b[k] || 0), 0);
    const total = { programados: suma('programados'), no_disponibles: suma('no_disponibles'), disponibles: suma('disponibles'), reservados: suma('reservados'),
        citas: suma('citas'), completadas: suma('completadas'), minutos_completados: suma('minutos_completados'), canceladas: suma('canceladas'), ausencias: suma('ausencias') };
    const pct = porcentaje(total.reservados, total.disponibles);
    const margen = Number(datos.periodo.margen_minutos);

    cuerpo.innerHTML = `
        <div class="resumen-tarjetas">
            ${tarjeta('Ocupación reservada', textoPct(pct), 'Minutos reservados por citas no canceladas (pendientes, confirmadas, completadas y ausencias) dentro del tiempo disponible, divididos entre los minutos disponibles. Si dos citas se solapan, ese tiempo se cuenta una sola vez.', { icono: 'gauge-high', nota: `${horas(total.reservados)} de ${horas(total.disponibles)}` })}
            ${tarjeta('Horas disponibles', horas(total.disponibles), 'Jornada programada menos descansos y bloqueos.', { icono: 'clock', nota: `Programadas ${horas(total.programados)} · No disponibles ${horas(total.no_disponibles)}` })}
            ${tarjeta('Horas sin reservar', horas(Math.max(total.disponibles - total.reservados, 0)), 'Tiempo disponible sin citas. Incluye pasado y futuro del periodo; los huecos aprovechables de abajo son solo futuros.', { icono: 'hourglass-half' })}
            ${tarjeta('Servicios completados', String(total.completadas), 'Citas marcadas como completadas en el periodo y la suma de la duración reservada de esas citas.', { icono: 'circle-check', nota: `${horas(total.minutos_completados)} reservadas en citas completadas` })}
            ${tarjeta('Cancelaciones', String(total.canceladas), 'Citas canceladas con fecha en el periodo. No ocupan tiempo.', { icono: 'ban' })}
            ${tarjeta('Ausencias', String(total.ausencias), 'Citas marcadas como «no asistió». Ocupaban el horario, por eso cuentan como tiempo reservado.', { icono: 'user-xmark' })}
            ${Number(real.servicios) ? tarjeta('Tiempo real de atención', horas(real.minutos), 'Suma del tiempo entre «Iniciar» y «Terminar» (sección Atención), solo de los servicios con ambos registrados. Es distinto del tiempo programado.', { icono: 'stopwatch', nota: `${real.servicios} servicio(s) registrados · reservado ${horas(real.minutos_reservados)}` })
                : tarjeta('Tiempo real de atención', 'No disponible', 'Aún no hay servicios con inicio y fin registrados en Atención en este periodo. Las cifras de arriba usan la duración reservada.', { icono: 'stopwatch' })}
        </div>
        ${datos.conflictos.length ? `<div class="panel-aviso"><strong>Conflictos en la agenda (${datos.conflictos.length})</strong><ul>${datos.conflictos.slice(0, 20).map(c =>
            `<li>${esc(fechaCorta(c.fecha))} · ${esc(c.barbero)}: ${c.tipo === 'solape' ? `citas que se solapan (${esc(c.horas)})` : `${horas(c.minutos)} de citas fuera del tiempo disponible`}
                <button type="button" class="panel-btn panel-btn-mini" data-agenda="${esc(c.fecha)}" data-agenda-barbero="${esc(c.barbero_id)}">Ver en agenda</button></li>`).join('')}</ul></div>` : ''}
        <div class="panel-caja"><h3>Comparación por barbero</h3>
            ${datos.barberos.length ? `<div class="ocupacion-barras">${datos.barberos.map(b => {
                const p = porcentaje(b.reservados, b.disponibles);
                return `<div class="ocupacion-fila"><span>${esc(b.barbero)}</span>
                    <div class="ocupacion-barra" role="img" aria-label="${esc(b.barbero)}: ${esc(textoPct(p))}"><i style="width:${Math.min(p ?? 0, 100)}%"></i></div>
                    <strong>${esc(textoPct(p))}</strong><small>${horas(b.reservados)} de ${horas(b.disponibles)} · ${b.citas} cita(s) · ${b.canceladas} canc. · ${b.ausencias} aus.</small></div>`;
            }).join('')}</div>` : vacio('No hay barberos con jornada en el periodo.', 'users')}
        </div>
        <div class="panel-caja"><h3>Mapa de ocupación por día y hora</h3>
            <p class="panel-sub">Porcentaje de los minutos disponibles de cada franja que están reservados, sumando todos los días del periodo. Más dorado = más ocupado.</p>
            ${mapaCalor(datos.mapa_calor)}
        </div>
        <div class="panel-caja"><h3>Huecos libres aprovechables (${datos.huecos_total})</h3>
            <p class="panel-sub">Solo futuros, alineados a la cuadrícula de ${esc(datos.periodo.intervalo_minutos)} min${margen ? ` y respetando ${margen} min de preparación entre citas` : ''}. Solo se listan los huecos donde cabe al menos un servicio del barbero.</p>
            ${datos.huecos.length ? `<div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Fecha</th><th>Barbero</th><th>Libre</th><th>Duración</th><th>Servicios que caben</th><th></th></tr></thead>
                <tbody>${datos.huecos.map(h => `<tr>
                    <td data-titulo="Fecha">${esc(fechaCorta(h.fecha))}</td><td data-titulo="Barbero">${esc(h.barbero)}</td>
                    <td data-titulo="Libre">${esc(h.primer_inicio)}–${esc(h.hasta)}</td><td data-titulo="Duración">${horas(h.minutos)}</td>
                    <td data-titulo="Servicios que caben">${h.servicios_que_caben} servicio(s)${h.servicios.length ? `<br><small>${h.servicios.map(s => `${esc(s.nombre)} (${s.duracion} min)`).join(', ')}${h.servicios_que_caben > h.servicios.length ? '…' : ''}</small>` : ''}</td>
                    <td><button type="button" class="panel-btn panel-btn-mini" data-agenda="${esc(h.fecha)}" data-agenda-barbero="${esc(h.barbero_id)}">Ver en agenda</button></td></tr>`).join('')}</tbody></table></div>
                ${datos.huecos_total > datos.huecos.length ? `<p class="panel-sub">Se muestran los primeros ${datos.huecos.length}. Acota el periodo o el barbero para ver el resto.</p>` : ''}`
                : vacio('No quedan huecos futuros donde quepa un servicio en este periodo.', 'calendar-check')}
        </div>
        <details class="panel-caja ocupacion-detalle"><summary>Detalle por día</summary>
            <div class="panel-tabla-envoltura"><table class="panel-tabla panel-tabla-tarjetas"><thead><tr><th>Fecha</th><th>Barbero</th><th>Programado</th><th>No disponible</th><th>Disponible</th><th>Reservado</th><th>Ocupación</th><th>Citas</th></tr></thead>
            <tbody>${datos.dias.filter(d => d.programados > 0 || d.citas > 0 || d.canceladas > 0).map(d => `<tr>
                <td data-titulo="Fecha">${esc(fechaCorta(d.fecha))}</td><td data-titulo="Barbero">${esc(d.barbero)}</td>
                <td data-titulo="Programado">${horas(d.programados)}</td><td data-titulo="No disponible">${horas(d.no_disponibles)}</td>
                <td data-titulo="Disponible">${horas(d.disponibles)}</td><td data-titulo="Reservado">${horas(d.reservados)}${d.fuera_de_jornada > 0 ? `<br><small class="texto-negativo">+${horas(d.fuera_de_jornada)} fuera de jornada</small>` : ''}</td>
                <td data-titulo="Ocupación">${esc(textoPct(porcentaje(d.reservados, d.disponibles)))}</td>
                <td data-titulo="Citas">${d.citas}${d.canceladas ? ` · ${d.canceladas} canc.` : ''}${d.ausencias ? ` · ${d.ausencias} aus.` : ''}</td></tr>`).join('')}</tbody></table></div>
        </details>
        <details class="fin-explica ocupacion-explica"><summary>¿Qué incluye cada cifra?</summary>
            <p><strong>Programado:</strong> la jornada del barbero (su horario propio, el general o las horas del negocio). <strong>No disponible:</strong> descansos y bloqueos dentro de la jornada.
            <strong>Disponible:</strong> programado menos no disponible. <strong>Reservado:</strong> citas pendientes, confirmadas, completadas y marcadas como ausencia (no las canceladas), con la duración reservada de cada cita; el tiempo de dos citas solapadas se cuenta una vez y se avisa como conflicto.
            Las citas fuera del tiempo disponible se muestran aparte y no suben la ocupación por encima del 100 %. Zona horaria: ${esc(datos.periodo.zona)}.
            Estas cifras no representan demanda: un hueco libre no significa que alguien lo haya pedido.</p></details>`;

    cuerpo.addEventListener('click', e => {
        const b = e.target.closest('[data-agenda]');
        if (b) ctx.irA('agenda', { fecha: b.dataset.agenda, barbero: b.dataset.agendaBarbero, vista: 'dia' });
    });
    const csv = cont.querySelector('[data-csv]');
    csv.disabled = false;
    csv.addEventListener('click', () => descargarCSV(`ocupacion-${desde}_${hasta}.csv`, [
        ['Fecha', 'Barbero', 'Programado (min)', 'No disponible (min)', 'Disponible (min)', 'Reservado (min)', 'Fuera de jornada (min)', 'Ocupación (%)', 'Citas', 'Completadas', 'Canceladas', 'Ausencias'],
        ...datos.dias.map(d => [d.fecha, d.barbero, d.programados, d.no_disponibles, d.disponibles, d.reservados, d.fuera_de_jornada,
            porcentaje(d.reservados, d.disponibles) ?? 'Sin jornada disponible', d.citas, d.completadas, d.canceladas, d.ausencias])]));
}

function mapaCalor(celdas) {
    if (!celdas.length) return vacio('No hay tiempo disponible en el periodo.', 'calendar-xmark');
    const horasUsadas = [...new Set(celdas.map(c => c.hora))].sort((a, b) => a - b);
    const celda = (dia, hora) => celdas.find(c => c.dia === dia && c.hora === hora);
    const etiquetaHora = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'a. m.' : 'p. m.'}`;
    return `<div class="panel-tabla-envoltura"><table class="ocupacion-calor"><thead><tr><th scope="col">Hora</th>${ORDEN_DIAS.map(d => `<th scope="col">${DIAS[d].slice(0, 3)}</th>`).join('')}</tr></thead>
        <tbody>${horasUsadas.map(h => `<tr><th scope="row">${etiquetaHora(h)}</th>${ORDEN_DIAS.map(d => {
            const c = celda(d, h);
            if (!c) return '<td class="sin-jornada" title="Sin jornada disponible">—</td>';
            const p = porcentaje(c.reservados, c.disponibles);
            return `<td style="--p:${Math.min(p, 100) / 100}" title="${esc(DIAS[d])} ${etiquetaHora(h)}: ${horas(c.reservados)} de ${horas(c.disponibles)}">${Math.round(p)} %</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
