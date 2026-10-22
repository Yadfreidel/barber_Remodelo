// Vista Más: reutiliza ubicación y acceso administrativo, sin duplicar sus controladores.
export function crearVistaMas() {
    const vista = document.createElement('section');
    vista.id = 'mas';
    vista.innerHTML = `<div class="view-heading"><p class="editorial-eyebrow">A TU SERVICIO</p><h1>Más de tu barbería</h1><p>Tu próxima visita, sin complicaciones.</p></div>
        <a class="more-card more-row" id="mi-cita-link" href="#contacto"><i class="fas fa-calendar-check" aria-hidden="true"></i><span><strong>Mi cita</strong><small>Consulta tu reserva y su seguimiento</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></a>
        <div id="more-location"></div>
        <section id="more-hours" class="more-card" aria-labelledby="more-hours-title"><h2 id="more-hours-title"><i class="fas fa-clock" aria-hidden="true"></i> Horarios</h2><p>Consultando horario…</p></section>
        <section class="more-card contact-card"><h2><i class="fas fa-comment-dots" aria-hidden="true"></i> Hablemos</h2><a href="https://wa.me/18292466177" target="_blank" rel="noopener"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>WhatsApp<small>(829) 246-6177</small></span><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a><a href="tel:+18292466177"><i class="fas fa-phone" aria-hidden="true"></i><span>Llamar a la barbería<small>Estamos para ayudarte</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></a></section>
        <section class="more-card faq-card"><h2><i class="fas fa-circle-question" aria-hidden="true"></i> Preguntas frecuentes</h2><details><summary>¿Cómo reservo?</summary><p>Elige tu servicio, profesional y una hora disponible. Completa tu nombre y WhatsApp y confirma para guardar tu cita.</p></details><details><summary>¿Puedo cambiar mi cita?</summary><p>Abre el enlace seguro de tu reserva para consultar las opciones disponibles de confirmación, cancelación o cambio de horario.</p></details><details><summary>¿Necesito un correo electrónico?</summary><p>No. Para reservar solo necesitas tu nombre y un número de WhatsApp válido.</p></details></section>`;
    const ubicacion = document.getElementById('ubicacion-seccion');
    ubicacion.classList.add('more-card');
    ubicacion.querySelector('h2').innerHTML = '<i class="fas fa-location-dot" aria-hidden="true"></i> Ubicación';
    vista.querySelector('#more-location').replaceWith(ubicacion);
    const admin = document.getElementById('btn-flotante-admin');
    admin.className = 'more-card more-row admin-access';
    admin.innerHTML = '<i class="fas fa-user-shield" aria-hidden="true"></i><span><strong>Acceso administrativo</strong><small>Gestiona tu barbería</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i>';
    vista.append(admin);
    vista.querySelector('#mi-cita-link').addEventListener('click', event => {
        const token = document.getElementById('pantalla-seguimiento').dataset.solicitud;
        if (token) { event.preventDefault(); location.href = `?cita=${encodeURIComponent(token)}#contacto`; }
    });
    return vista;
}
