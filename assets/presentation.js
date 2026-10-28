import { obtenerServicios, formatoPrecioServicio } from '../models/serviceModel.js';
import { escapar, fotoCorte } from './catalogue-ui.js';
// Refleja las selecciones existentes sin modificar el flujo de reservas.
function actualizarSeleccionVisual() {
    const servicio = document.getElementById('servicio-select').value;
    const seleccionado = obtenerServicios().find(s => s.nombre === servicio);
    const vista = document.getElementById('reserva-seleccion');
    const firma = JSON.stringify(seleccionado ? [seleccionado.nombre, seleccionado.precio, seleccionado.duracion_minutos, seleccionado.descripcion, seleccionado.imagen] : []);
    if (vista && vista.dataset.servicio !== firma) {
        vista.dataset.servicio = firma;
        vista.innerHTML = seleccionado ? `${fotoCorte(seleccionado)}<div><h3>${escapar(seleccionado.nombre)}</h3><p class="reserva-seleccion-tarifa">${escapar(formatoPrecioServicio(seleccionado.precio))}${seleccionado.duracion_minutos ? ` <span>&middot; ${Number(seleccionado.duracion_minutos)} min</span>` : ''}</p><p>${escapar(seleccionado.descripcion)}</p></div>` : '<p>Selecciona tu corte del catálogo para ver sus datos aquí.</p>';
    }
    document.querySelectorAll('.btn-card-reserva').forEach(boton => {
        const seleccionado = boton.dataset.nombre === servicio;
        boton.setAttribute('aria-pressed', String(seleccionado));
        boton.textContent = seleccionado ? '✓ Elegido' : 'Elegir';
    });
    document.querySelectorAll('.btn-seleccionar-barbero').forEach(boton => {
        boton.setAttribute('aria-pressed', String(boton.closest('.card-barbero').classList.contains('barbero-activo')));
    });
    document.querySelectorAll('.pildora-hora').forEach(boton => {
        boton.setAttribute('aria-pressed', String(boton.classList.contains('pildora-activa')));
    });
}
document.addEventListener('click', () => queueMicrotask(actualizarSeleccionVisual));
document.addEventListener('change', () => queueMicrotask(actualizarSeleccionVisual));
document.addEventListener('reset', () => queueMicrotask(actualizarSeleccionVisual));
