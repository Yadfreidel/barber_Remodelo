// Refleja las selecciones existentes sin modificar el flujo de reservas.
function actualizarSeleccionVisual() {
    const servicio = document.getElementById('servicio-select').value;
    document.querySelectorAll('.btn-card-reserva').forEach(boton => {
        const seleccionado = boton.dataset.nombre === servicio;
        boton.setAttribute('aria-pressed', String(seleccionado));
        boton.textContent = seleccionado ? '✓ Seleccionado' : 'Elegir Este';
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
