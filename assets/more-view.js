// Vista Más: reutiliza ubicación y acceso administrativo, sin duplicar sus controladores.
export function crearVistaMas() {
    const vista = document.createElement('section');
    vista.id = 'mas';
    vista.innerHTML = `<div class="view-heading"><p class="editorial-eyebrow">A TU SERVICIO</p><h1>Más de tu barbería</h1><p>Tu próxima visita, sin complicaciones.</p></div>
        <a class="more-card more-row" id="mi-cita-link" href="#mis-citas"><i class="fas fa-calendar-check" aria-hidden="true"></i><span><strong>Mis citas</strong><small>Tus próximas citas, su estado y tu historial</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></a>
        <div id="more-location"></div>
        <section id="more-hours" class="more-card" aria-labelledby="more-hours-title"><h2 id="more-hours-title"><i class="fas fa-clock" aria-hidden="true"></i> Horarios</h2><p>Consultando horario…</p></section>
        <section class="more-card contact-card"><h2><i class="fas fa-comment-dots" aria-hidden="true"></i> Hablemos</h2><a href="https://wa.me/18292466177" target="_blank" rel="noopener"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>WhatsApp<small>(829) 246-6177</small></span><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a><a href="tel:+18292466177"><i class="fas fa-phone" aria-hidden="true"></i><span>Llamar a la barbería<small>Estamos para ayudarte</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></a></section>
        <section class="more-card faq-card"><h2><i class="fas fa-circle-question" aria-hidden="true"></i> Preguntas frecuentes</h2><details><summary>¿Cómo reservo?</summary><p>Elige tu servicio, profesional y una hora disponible. Completa tu nombre y WhatsApp y confirma para guardar tu cita.</p></details><details><summary>¿Puedo cambiar mi cita?</summary><p>Abre «Mis citas» o el enlace privado de tu reserva para consultar las opciones disponibles de confirmación, cancelación o cambio de horario.</p></details><details><summary>¿Necesito un correo electrónico?</summary><p>No. Para reservar solo necesitas tu nombre y un número de WhatsApp válido.</p></details></section>
        <section id="more-politicas" class="more-card politicas-card" aria-labelledby="more-politicas-titulo" hidden></section>
        <section class="more-card ayuda-card" aria-labelledby="ayuda-soporte-titulo"><h2 id="ayuda-soporte-titulo"><i class="fas fa-life-ring" aria-hidden="true"></i> Ayuda y soporte</h2>
            <details><summary>¿Por qué una hora aparece como «No disponible»?</summary><p>Porque tu servicio completo no cabe en ese espacio: se cruza con otra cita pendiente o confirmada, con un descanso o bloqueo, o queda fuera de la anticipación mínima o del plazo de reserva. Las horas cambian según el servicio, el barbero y el día que elijas.</p></details>
            <details><summary>¿Qué significa el estado de mi cita?</summary><ul class="ayuda-estados">
                <li><strong>Pendiente de confirmación:</strong> tu cita está guardada y la hora apartada; falta que la barbería la confirme.</li>
                <li><strong>Confirmada:</strong> la barbería confirmó tu cita.</li>
                <li><strong>Completada:</strong> el servicio ya se realizó.</li>
                <li><strong>Cancelada:</strong> la cita se anuló y la hora quedó libre.</li>
                <li><strong>No asistió:</strong> la barbería registró que no acudiste.</li></ul>
                <p>«Confirmaste tu asistencia» indica que avisaste que irás; no cambia el estado de la cita.</p></details>
            <details><summary>¿Qué es el enlace privado de mi cita?</summary><p>Es la dirección única de tu reserva. Quien la tenga puede ver la cita y, mientras esté dentro del plazo, confirmar asistencia, cambiarla o cancelarla. Compártelo solo con quien confíes. Lo encuentras en «Mis citas» con «Copiar enlace privado».</p></details>
            <details><summary>¿Cómo cambio o cancelo mi cita?</summary><p>Abre «Mis citas» y pulsa «Gestionar». Puedes cambiarla o cancelarla en línea hasta el plazo mínimo que fija la barbería antes de la hora de la cita; pasado ese plazo, contáctanos.</p></details>
            <details><summary>¿Recibiré avisos por WhatsApp?</summary><p>Solo si marcas la casilla de avisos al reservar. En ese caso la barbería puede enviarte por WhatsApp la confirmación y los recordatorios de esa cita.</p></details>
            <p class="ayuda-soporte">¿Necesitas algo más? <button type="button" class="enlace-boton" data-ir-contacto>Escríbenos o llámanos en «Hablemos»</button>.</p>
        </section>`;
    const ubicacion = document.getElementById('ubicacion-seccion');
    ubicacion.classList.add('more-card');
    ubicacion.querySelector('h2').innerHTML = '<i class="fas fa-location-dot" aria-hidden="true"></i> Ubicación';
    vista.querySelector('#more-location').replaceWith(ubicacion);
    const admin = document.getElementById('btn-flotante-admin');
    admin.className = 'more-card more-row admin-access';
    admin.innerHTML = '<i class="fas fa-user-shield" aria-hidden="true"></i><span><strong>Acceso administrativo</strong><small>Gestiona tu barbería</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i>';
    vista.append(admin);
    const contacto = vista.querySelector('.contact-card');
    contacto.setAttribute('tabindex', '-1');
    vista.querySelector('[data-ir-contacto]').addEventListener('click', () => { contacto.scrollIntoView({ block: 'center' }); contacto.focus({ preventScroll: true }); });
    return vista;
}
