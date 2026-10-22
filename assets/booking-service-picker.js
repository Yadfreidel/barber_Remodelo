import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { escapar, normalizarBusqueda } from './catalogue-ui.js';

export function iniciarSelectorServicios(contenedor, select) {
    const titulo = document.createElement('h3');
    titulo.className = 'wizard-section-title';
    titulo.textContent = 'Elige tu servicio';
    const grid = document.createElement('div');
    grid.className = 'booking-service-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Servicios disponibles');
    const buscar = document.createElement('input');
    buscar.type = 'search';
    buscar.placeholder = 'Busca tu servicio';
    buscar.className = 'service-picker-search';
    buscar.setAttribute('aria-label', 'Buscar servicio para reservar');
    const cambiar = document.createElement('button');
    cambiar.type = 'button';
    cambiar.className = 'service-picker-change';
    cambiar.textContent = 'Cambiar servicio';
    let expandido = !select.value;
    const vacio = document.createElement('p');
    vacio.className = 'service-picker-empty';
    vacio.setAttribute('role', 'status');
    vacio.textContent = 'No encontramos ese servicio. Prueba otro nombre.';
    select.before(titulo, buscar, grid, vacio, cambiar);
    function filtrar() {
        buscar.hidden = !expandido;
        cambiar.hidden = !select.value || expandido;
        grid.querySelectorAll('[data-service]').forEach(boton => {
            const servicio = obtenerServicios().find(s => s.id === boton.dataset.service);
            boton.hidden = expandido
                ? !normalizarBusqueda(servicio?.nombre).includes(normalizarBusqueda(buscar.value))
                : servicio?.nombre !== select.value;
        });
        vacio.hidden = [...grid.children].some(boton => !boton.hidden);
    }
    buscar.addEventListener('input', filtrar);
    cambiar.addEventListener('click', () => { expandido = true; buscar.value = ''; filtrar(); buscar.focus(); });
    select.classList.add('sr-only');
    contenedor.querySelector('[for=servicio-select]').classList.add('sr-only');
    function actualizar() {
        grid.innerHTML = obtenerServicios().map(servicio => `<button type="button" class="booking-service-card" data-service="${escapar(servicio.id)}" aria-pressed="${select.value === servicio.nombre}">${servicio.imagen ? `<img src="${escapar(servicio.imagen)}" width="160" height="160" alt="" loading="lazy" decoding="async">` : '<span class="service-photo-empty"><i class="fas fa-scissors" aria-hidden="true"></i></span>'}<span class="service-choice-info"><strong>${escapar(servicio.nombre)}</strong><span>${escapar(formatoPrecioServicio(servicio.precio))}<small>${servicio.duracion_minutos ? `${Number(servicio.duracion_minutos)} min` : 'Duración a consultar'}</small></span></span><span class="service-choice-check" aria-hidden="true">✓</span></button>`).join('');
        filtrar();
    }
    grid.addEventListener('click', event => {
        const boton = event.target.closest('[data-service]');
        if (!boton) return;
        const servicio = obtenerServicios().find(s => s.id === boton.dataset.service);
        if (!servicio) return;
        select.value = servicio.nombre;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    select.addEventListener('change', () => {
        expandido = !select.value;
        grid.querySelectorAll('[data-service]').forEach(boton => {
            const servicio = obtenerServicios().find(s => s.id === boton.dataset.service);
            boton.setAttribute('aria-pressed', String(servicio?.nombre === select.value));
        });
        filtrar();
    });
    window.addEventListener('catalogo-listo', actualizar);
    select.form.addEventListener('reset', () => queueMicrotask(() => {expandido = true; buscar.value = ''; actualizar();}));
    actualizar();
}
