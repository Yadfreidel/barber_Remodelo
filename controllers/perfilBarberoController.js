// Perfil público del barbero: presentación, especialidades, servicios que realiza (del catálogo actual)
// y galería de trabajos publicados. «Reservar con este barbero» usa el mismo flujo de reserva.
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { escapar as esc } from '../assets/catalogue-ui.js';

const POR_PAGINA = 12;
let dialogo = null;

function crearDialogo() {
    dialogo = document.createElement('dialog');
    dialogo.className = 'detalle-corte perfil-barbero';
    dialogo.setAttribute('aria-labelledby', 'perfil-barbero-titulo');
    dialogo.innerHTML = `<div class="detalle-barra"><span>PERFIL DEL BARBERO</span>
        <button type="button" data-cerrar aria-label="Cerrar perfil">Cerrar <span aria-hidden="true">&times;</span></button></div>
        <div class="perfil-contenido"></div>`;
    document.body.append(dialogo);
    dialogo.addEventListener('click', e => { if (e.target === dialogo || e.target.closest('[data-cerrar]')) dialogo.close(); });
    dialogo.addEventListener('close', () => document.body.classList.remove('detalle-abierto'));
    return dialogo;
}

// Servicios que el barbero realiza: sin asignación explícita, todos los barberos los hacen (misma regla que el servidor)
function serviciosDe(barbero) {
    return obtenerServicios().filter(s => !Array.isArray(s.barberos) || !s.barberos.length || s.barberos.map(String).includes(String(barbero.barbero_id)));
}

export function abrirPerfilBarbero(barbero) {
    const d = dialogo || crearDialogo();
    const cont = d.querySelector('.perfil-contenido');
    const servicios = serviciosDe(barbero);
    cont.innerHTML = `
        <header class="perfil-cabecera">
            <img src="${esc(barbero.imagen)}" alt="" width="120" height="120" loading="lazy">
            <div><p class="editorial-eyebrow">TU BARBERO</p><h2 id="perfil-barbero-titulo">${esc(barbero.nombre)}</h2>
                ${barbero.especialidad ? `<p class="perfil-lema">${esc(barbero.especialidad)}</p>` : ''}
                ${barbero.especialidades?.length ? `<ul class="perfil-chips" aria-label="Especialidades">${barbero.especialidades.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>
        </header>
        ${barbero.presentacion ? `<p class="perfil-presentacion">${esc(barbero.presentacion)}</p>` : ''}
        <button type="button" class="btn-primary perfil-reservar" data-reservar>Reservar con ${esc(barbero.nombre.split(' ')[0])} <span aria-hidden="true">→</span></button>
        <section class="perfil-seccion" aria-labelledby="perfil-trabajos-titulo">
            <h3 id="perfil-trabajos-titulo">Trabajos</h3>
            <div class="perfil-filtros" data-filtros hidden></div>
            <div class="perfil-galeria" data-galeria aria-busy="true"><p class="perfil-estado">Cargando trabajos…</p></div>
            <button type="button" class="perfil-mas" data-mas hidden>Ver más trabajos</button>
        </section>
        <section class="perfil-seccion" aria-labelledby="perfil-servicios-titulo">
            <h3 id="perfil-servicios-titulo">Servicios que realiza</h3>
            ${servicios.length ? `<ul class="perfil-servicios">${servicios.map(s => `<li><span>${esc(s.nombre)}</span>
                <small>${esc(formatoPrecioServicio(s.precio))}${s.duracion_minutos ? ` · ${Number(s.duracion_minutos)} min` : ''}</small></li>`).join('')}</ul>`
                : '<p class="perfil-estado">Consulta los servicios disponibles al reservar.</p>'}
        </section>`;
    cont.querySelector('[data-reservar]').addEventListener('click', () => {
        d.close();
        window.dispatchEvent(new CustomEvent('reservar-con-barbero', { detail: { nombre: barbero.nombre } }));
    });
    d.showModal();
    document.body.classList.add('detalle-abierto');
    cont.querySelector('[data-reservar]').focus();
    cargarGaleria(cont, barbero);
}

async function cargarGaleria(cont, barbero) {
    const galeria = cont.querySelector('[data-galeria]');
    const botonMas = cont.querySelector('[data-mas]');
    const trabajos = [];
    let total = 0, filtro = '', datos = null;
    if (!estaSupabaseListo() || !barbero.barbero_id) {
        galeria.setAttribute('aria-busy', 'false');
        galeria.innerHTML = '<p class="perfil-estado">La galería estará disponible cuando la barbería publique trabajos.</p>';
        return;
    }
    async function pedir() {
        const { data, error } = await supabase.rpc('portafolio_publico', { p_barbero: String(barbero.barbero_id), p_limite: POR_PAGINA, p_desde: trabajos.length });
        if (error) throw error;
        return data;
    }
    function pintar() {
        const visibles = trabajos.filter(t => !filtro || t.especialidad === filtro || t.servicio_id === filtro);
        galeria.setAttribute('aria-busy', 'false');
        galeria.innerHTML = visibles.length ? visibles.map(t => `<button type="button" class="perfil-trabajo${t.destacado ? ' destacado' : ''}" data-trabajo="${esc(t.id)}">
                <img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}" loading="lazy" decoding="async">
                <span>${esc(t.titulo)}${t.servicio ? `<small>${esc(t.servicio)}</small>` : ''}</span></button>`).join('')
            : `<p class="perfil-estado">${trabajos.length ? 'No hay trabajos con este filtro.' : `${esc(barbero.nombre.split(' ')[0])} aún no tiene trabajos publicados. Puedes reservar igualmente.`}</p>`;
        botonMas.hidden = trabajos.length >= total;
    }
    try {
        datos = await pedir();
        total = Number(datos.total);
        trabajos.push(...datos.trabajos);
    } catch {
        galeria.setAttribute('aria-busy', 'false');
        galeria.innerHTML = '<p class="perfil-estado">No pudimos cargar los trabajos. <button type="button" class="perfil-mas" data-reintentar>Reintentar</button></p>';
        galeria.querySelector('[data-reintentar]').addEventListener('click', () => cargarGaleria(cont, barbero));
        return;
    }
    // Filtros solo cuando hay contenido suficiente para que sirvan
    const opciones = [...datos.especialidades.map(e => [e, e]), ...datos.servicios.map(s => [s.id, s.nombre])];
    const filtros = cont.querySelector('[data-filtros]');
    if (total >= 4 && opciones.length > 1) {
        filtros.hidden = false;
        filtros.innerHTML = `<button type="button" data-filtro="" aria-pressed="true">Todos</button>${opciones.map(([v, t]) => `<button type="button" data-filtro="${esc(v)}" aria-pressed="false">${esc(t)}</button>`).join('')}`;
        filtros.addEventListener('click', e => {
            const b = e.target.closest('[data-filtro]');
            if (!b) return;
            filtro = b.dataset.filtro;
            filtros.querySelectorAll('[data-filtro]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            pintar();
        });
    }
    botonMas.addEventListener('click', async () => {
        botonMas.disabled = true;
        try { const mas = await pedir(); trabajos.push(...mas.trabajos); pintar(); }
        catch { botonMas.textContent = 'No se pudo cargar. Toca para reintentar'; }
        finally { botonMas.disabled = false; }
    });
    galeria.addEventListener('click', e => {
        const b = e.target.closest('[data-trabajo]');
        if (b) ampliar(trabajos.find(t => t.id === b.dataset.trabajo), b);
    });
    pintar();
}

// Vista ampliada: la imagen completa se pide solo al abrirla
async function ampliar(t, origen) {
    const caja = document.createElement('dialog');
    caja.className = 'perfil-ampliada';
    caja.setAttribute('aria-label', t.titulo);
    caja.innerHTML = `<button type="button" data-cerrar aria-label="Cerrar imagen">&times;</button>
        <figure><img src="${esc(t.miniatura)}" alt="${esc(t.texto_alternativo)}"><figcaption><strong>${esc(t.titulo)}</strong>
        ${t.descripcion ? `<span>${esc(t.descripcion)}</span>` : ''}${t.servicio ? `<small>${esc(t.servicio)}</small>` : ''}</figcaption></figure>`;
    dialogo.append(caja);
    caja.addEventListener('click', e => {
        e.stopPropagation(); // está dentro del perfil: cerrar la imagen no debe cerrar también el perfil
        if (e.target === caja || e.target.closest('[data-cerrar]')) caja.close();
    });
    caja.addEventListener('close', () => { caja.remove(); origen?.focus(); });
    caja.showModal();
    try {
        const { data } = await supabase.rpc('portafolio_imagen', { p_id: t.id });
        if (data && caja.isConnected) caja.querySelector('img').src = data;
    } catch { /* queda la miniatura */ }
}
