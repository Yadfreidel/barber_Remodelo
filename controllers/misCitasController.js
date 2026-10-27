// «Mis citas»: reservas de este navegador (tokens secretos de gestión) y, si el cliente inicia sesión,
// las de su cuenta (Supabase Auth + RLS). Nunca se consultan citas por teléfono ni por correo.
import { supabase, estaSupabaseListo } from '../assets/supabaseClient.js';
import { tokensGuardados, clavesPendientes, sincronizar, citasEnCache, guardarToken, guardarEnCache, clasificar,
    leerBorrador, borrarBorrador, olvidarTodo } from '../assets/mis-citas-store.js';
import { rango12h, formato12h, fechaLarga } from '../assets/horario-utils.js';
import { esc, formatoPrecio, mensajeError } from './modulosController.js';
import { abrirFormularioReclamacion, cargarMisReclamaciones, htmlMisReclamaciones, olvidarReclamaciones } from './reclamacionesClienteController.js';

const ERRORES_CUENTA = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'Email not confirmed': 'Confirma tu correo antes de iniciar sesión (revisa tu bandeja de entrada).',
    'User already registered': 'Ese correo ya tiene una cuenta. Inicia sesión.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
    'Signups not allowed for this instance': 'La creación de cuentas no está habilitada. Usa tu enlace privado.'
};

let vista = null;
let turno = 0;

export function crearVistaMisCitas() {
    vista = document.createElement('section');
    vista.id = 'mis-citas';
    vista.setAttribute('aria-labelledby', 'mis-citas-titulo');
    vista.innerHTML = `<div class="view-heading"><p class="editorial-eyebrow">TUS RESERVAS</p><h1 id="mis-citas-titulo">Mis citas</h1>
            <p>Tus próximas visitas y tu historial, con el estado que indica la barbería.</p></div>
        <div id="mc-borrador"></div>
        <div id="mc-estado" role="status" aria-live="polite"></div>
        <section class="mc-grupo" aria-labelledby="mc-proximas-titulo"><h2 id="mc-proximas-titulo">Próximas</h2><div id="mc-proximas" class="mc-lista"></div></section>
        <section class="mc-grupo" aria-labelledby="mc-historial-titulo"><h2 id="mc-historial-titulo">Historial</h2><div id="mc-historial" class="mc-lista"></div></section>
        <section class="mc-grupo mc-reclamaciones" aria-labelledby="mc-reclamaciones-titulo" hidden><h2 id="mc-reclamaciones-titulo">Mis reclamaciones</h2><div id="mc-reclamaciones" class="mc-lista"></div></section>
        <section class="mc-cuenta" id="mc-cuenta" aria-label="Cuenta"></section>
        <footer class="mc-pie">
            <p class="mc-privacidad"><i class="fas fa-lock" aria-hidden="true"></i><span>Tus citas se guardan de forma privada en este navegador.
            Para verlas en otro dispositivo o si borras los datos del navegador, inicia sesión o abre tu enlace privado
            «Gestionar mi cita». Por seguridad, no se pueden buscar citas con un teléfono o un correo.</span></p>
            <button type="button" class="mc-enlace" id="mc-olvidar">Quitar mis citas de este navegador</button>
        </footer>`;
    vista.addEventListener('click', manejarClic);
    vista.querySelector('#mc-cuenta').addEventListener('submit', manejarCuenta);
    supabase?.auth.onAuthStateChange(evento => {
        // Al cerrar sesión no quedan en este navegador las citas de la cuenta (ya están vinculadas a ella:
        // vuelven al iniciar sesión). Evita que otra persona las vea en un dispositivo compartido.
        if (evento === 'SIGNED_OUT') { olvidarTodo(); olvidarReclamaciones(); }
        // Diferido: llamar a Supabase Auth dentro de este callback bloquea el cliente (supabase-js)
        if (['SIGNED_IN', 'SIGNED_OUT'].includes(evento) && !vista.hidden) setTimeout(() => actualizarMisCitas(), 0);
    });
    window.addEventListener('reclamaciones-cambiaron', () => { if (!vista.hidden) pintarReclamaciones(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !vista.hidden) actualizarMisCitas({ silencioso: true });
    });
    return vista;
}

// Llamar tras guardar una reserva: se ve al instante en «Mis citas» y sobrevive a recargas
export function registrarCitaReservada(respuesta) {
    if (!respuesta?.token) return;
    guardarToken(respuesta.token);
    if (respuesta.cita) guardarEnCache(respuesta.cita);
    borrarBorrador();
}

// También se recuerda una cita abierta desde su enlace privado (?cita=)
export function recordarCita(token) {
    guardarToken(token);
}

function badge(c) {
    if (c.estado === 'cancelada') return ['Cancelada', 'badge-cancelada'];
    if (c.no_asistio) return ['No asistió', 'badge-cancelada'];
    if (c.completada) return ['Completada', 'badge-confirmada'];
    if (c.estado === 'confirmada') return ['Confirmada', 'badge-confirmada'];
    return ['Pendiente de confirmación', 'badge-pendiente'];
}

// Día, mes y año de la fecha de la cita (AAAA-MM-DD, día local de la barbería): se leen del propio texto
// y se formatean en UTC, igual que fechaLarga, para que separarlos no cambie el día mostrado
function partesFecha(fecha) {
    const [a, m, d] = String(fecha).split('-').map(Number);
    const dia = new Date(Date.UTC(a, m - 1, d));
    const formato = opciones => new Intl.DateTimeFormat('es-DO', { ...opciones, timeZone: 'UTC' }).format(dia);
    return { dia: d, mes: formato({ month: 'short' }).replace('.', ''), anio: a, semana: formato({ weekday: 'long' }) };
}

function tarjeta(c) {
    const [texto, clase] = badge(c);
    const f = partesFecha(c.fecha);
    return `<article class="mc-cita" data-estado="${esc(c.estado)}">
        <span class="badge-estado mc-insignia ${clase}">${texto}</span>
        <div class="mc-cita-cabecera">
            <div class="mc-fecha" aria-hidden="true"><span class="mc-fecha-dia">${f.dia}</span><span class="mc-fecha-mes">${esc(f.mes)}</span><span class="mc-fecha-anio">${f.anio}</span></div>
            <div class="mc-cita-titulo">
                <h3>${esc(c.servicio || 'Servicio')}</h3>
                <p class="mc-cuando"><i class="fa-regular fa-calendar" aria-hidden="true"></i><span class="mc-semana">${esc(f.semana)}</span><span class="sr-only">, ${esc(fechaLarga(c.fecha))}</span></p>
                <p class="mc-cuando"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>${esc(rango12h(c.hora, c.hora_fin))}</span></p>
            </div>
        </div>
        <dl class="mc-datos">
            <div><dt><i class="fa-regular fa-user" aria-hidden="true"></i>Barbero</dt><dd>${esc(c.barbero || '—')}</dd></div>
            <div><dt><i class="fa-regular fa-money-bill-1" aria-hidden="true"></i>Precio</dt><dd class="mc-precio">${esc(formatoPrecio(c.precio))}</dd></div>
        </dl>
        ${c.cliente_confirmo && c.estado !== 'cancelada' ? '<p class="mc-nota"><i class="fas fa-check" aria-hidden="true"></i> Confirmaste tu asistencia</p>' : ''}
        <div class="mc-acciones">
            <a class="mc-boton mc-principal" href="?cita=${encodeURIComponent(c.token)}#contacto"><span>${c.modificable ? 'Gestionar (confirmar, cambiar o cancelar)' : 'Ver detalle'}</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>
            <div class="mc-acciones-sec">
                <button type="button" class="mc-boton mc-secundario" data-copiar="${esc(c.token)}"><i class="fas fa-link" aria-hidden="true"></i> Copiar enlace privado</button>
                <button type="button" class="mc-boton mc-secundario" data-reclamar="${esc(c.token)}" data-descripcion="${esc(`${c.servicio || 'Cita'} · ${fechaLarga(c.fecha)}`)}"><i class="fa-regular fa-flag" aria-hidden="true"></i> Reportar un inconveniente</button>
            </div>
        </div>
    </article>`;
}

function pintarBorrador() {
    const caja = vista.querySelector('#mc-borrador');
    const b = leerBorrador();
    caja.innerHTML = b ? `<article class="mc-cita mc-borrador">
        <header><h3>${esc(b.servicio)}</h3><span class="badge-estado badge-borrador">Borrador sin reservar</span></header>
        <dl>
            <div><dt>Barbero</dt><dd>${esc(b.barbero || 'Sin elegir')}</dd></div>
            <div><dt>Fecha</dt><dd>${b.fecha ? esc(fechaLarga(b.fecha)) : 'Sin elegir'}</dd></div>
            <div><dt>Hora</dt><dd>${b.hora ? esc(formato12h(b.hora)) : 'Sin elegir'}</dd></div>
        </dl>
        <p class="mc-nota">Todavía no está reservada: el horario no está apartado hasta que confirmes la cita.</p>
        <div class="mc-acciones"><a class="mc-boton" href="#contacto" data-continuar>Continuar reserva</a>
            <button type="button" class="mc-boton mc-secundario" data-descartar>Descartar borrador</button></div>
    </article>` : '';
}

function pintarCitas(citas) {
    const { proximas, historial } = clasificar(citas);
    vista.querySelector('#mc-proximas').innerHTML = proximas.length ? proximas.map(tarjeta).join('')
        : `<div class="mc-vacio-tarjeta"><span class="mc-vacio-icono" aria-hidden="true"><i class="fa-regular fa-calendar"></i></span>
            <p>No tienes próximas citas</p><a class="mc-boton mc-principal" href="#contacto">Reservar cita <i class="fas fa-arrow-right" aria-hidden="true"></i></a></div>`;
    vista.querySelector('#mc-historial').innerHTML = historial.length ? historial.map(tarjeta).join('')
        : '<p class="mc-vacio">Aún no hay citas anteriores.</p>';
}

function pintarEstado(html, tipo = '') {
    const estado = vista.querySelector('#mc-estado');
    estado.className = tipo ? `mc-estado mc-${tipo}` : '';
    estado.innerHTML = html;
}

function grupos(visible) {
    vista.querySelectorAll('.mc-grupo').forEach(g => { g.hidden = !visible; });
}

async function sesionActual() {
    try { return (await supabase.auth.getSession()).data.session; } catch { return null; }
}

async function pintarCuenta(miTurno) {
    const caja = vista.querySelector('#mc-cuenta');
    if (!estaSupabaseListo()) { caja.innerHTML = ''; return; }
    const sesion = await sesionActual();
    if (miTurno !== turno) return; // una actualización más reciente se encarga
    // Solo se vuelve a pintar si cambió la sesión: no borra lo que el cliente está escribiendo
    const clave = sesion?.user?.email || '-';
    if (caja.dataset.cuenta === clave) return;
    caja.dataset.cuenta = clave;
    caja.innerHTML = sesion
        ? `<p class="mc-cuenta-sesion"><span class="mc-cuenta-icono" aria-hidden="true"><i class="fas fa-user-check"></i></span><span>Sesión iniciada como <strong>${esc(sesion.user.email)}</strong>.
              Tus reservas de este navegador se guardan en tu cuenta.</span></p>
           <button type="button" class="mc-boton mc-secundario" data-salir>Cerrar sesión</button>`
        : `<details><summary><span class="mc-cuenta-icono" aria-hidden="true"><i class="fas fa-mobile-screen-button"></i></span>
              <span class="mc-cuenta-texto">Ver mis citas en cualquier dispositivo</span><i class="fas fa-chevron-down mc-chevron" aria-hidden="true"></i></summary>
              <form class="mc-form" novalidate>
                <p>Inicia sesión para guardar tus reservas en tu cuenta. Es opcional: puedes reservar sin cuenta.</p>
                <label>Correo<input type="email" name="email" autocomplete="email" required></label>
                <label>Contraseña<input type="password" name="clave" autocomplete="current-password" minlength="6" required></label>
                <p class="mc-form-error" role="alert"></p>
                <div class="mc-acciones"><button type="submit" class="mc-boton" value="entrar">Iniciar sesión</button>
                    <button type="submit" class="mc-boton mc-secundario" value="crear">Crear cuenta</button></div>
              </form></details>`;
}

// Carga desde Supabase. Un fallo de conexión NUNCA se muestra como «No tienes citas».
export async function actualizarMisCitas({ silencioso = false } = {}) {
    if (!vista) return;
    const miTurno = ++turno;
    pintarBorrador();
    pintarCuenta(miTurno);
    if (!estaSupabaseListo()) {
        grupos(false);
        pintarEstado('<p>Las reservas en línea no están disponibles en este momento: las solicitudes se envían por WhatsApp y la barbería te confirma el horario.</p>', 'aviso');
        return;
    }
    const cache = citasEnCache();
    if (!silencioso || !cache) {
        grupos(false);
        pintarEstado('<p class="mc-cargando"><span class="motion-skeleton" aria-hidden="true"></span>Cargando tus citas…</p>');
    }
    const tokens = tokensGuardados();
    const claves = clavesPendientes();
    try {
        const sesion = await sesionActual();
        const porToken = new Map();
        if (tokens.length || claves.length) {
            const { data, error } = await supabase.rpc('mis_citas_por_tokens', { p_tokens: tokens, p_claves: claves });
            if (error) throw error;
            data.forEach(c => porToken.set(c.token, c));
        }
        if (sesion) {
            if (tokens.length) await supabase.rpc('vincular_citas', { p_tokens: tokens }); // si falla, se reintenta en la próxima carga
            const { data, error } = await supabase.rpc('mis_citas');
            if (error) throw error;
            data.forEach(c => porToken.set(c.token, { ...porToken.get(c.token), ...c }));
        }
        if (miTurno !== turno) return;
        const citas = [...porToken.values()];
        sincronizar(citas, { tokensConsultados: tokens });
        grupos(true);
        pintarEstado(citas.length ? '' : `<p>Aún no tienes citas en este navegador${sesion ? ' ni en tu cuenta' : ''}.</p>`);
        pintarCitas(citas);
        pintarReclamaciones();
    } catch (error) {
        if (miTurno !== turno) return;
        const reintentar = '<button type="button" class="mc-boton" data-reintentar>Reintentar</button>';
        if (cache?.citas.length) {
            grupos(true);
            pintarCitas(cache.citas);
            pintarEstado(`<p>No pudimos actualizar tus citas (${esc(mensajeError(error))}). Se muestra la última copia guardada
                ${cache.actualizado ? `del ${esc(new Date(cache.actualizado).toLocaleString('es-DO'))}` : ''}: el estado podría haber cambiado.</p>${reintentar}`, 'error');
        } else {
            grupos(false);
            pintarEstado(`<p>No pudimos cargar tus citas. Revisa tu conexión e inténtalo de nuevo.</p>${reintentar}`, 'error');
        }
    }
}

async function copiar(token, boton) {
    const enlace = `${location.origin}${location.pathname}?cita=${encodeURIComponent(token)}`;
    try {
        await navigator.clipboard.writeText(enlace);
        boton.textContent = 'Enlace copiado';
    } catch {
        window.prompt('Copia tu enlace privado (no lo compartas):', enlace);
    }
}

// Reclamaciones de este navegador y de la cuenta. Si fallan, no afectan a la lista de citas.
async function pintarReclamaciones() {
    const seccion = vista.querySelector('.mc-reclamaciones');
    try {
        const lista = await cargarMisReclamaciones();
        seccion.hidden = !lista.length;
        vista.querySelector('#mc-reclamaciones').innerHTML = htmlMisReclamaciones(lista);
    } catch {
        seccion.hidden = false;
        vista.querySelector('#mc-reclamaciones').innerHTML = '<p class="mc-vacio">No pudimos cargar tus reclamaciones. Vuelve a intentarlo más tarde.</p>';
    }
}

function manejarClic(evento) {
    const objetivo = evento.target.closest('button, a');
    if (!objetivo) return;
    if (objetivo.matches('[data-reintentar]')) actualizarMisCitas();
    else if (objetivo.matches('[data-copiar]')) copiar(objetivo.dataset.copiar, objetivo);
    else if (objetivo.matches('[data-reclamar]')) abrirFormularioReclamacion({ tokenCita: objetivo.dataset.reclamar, descripcionCita: objetivo.dataset.descripcion });
    else if (objetivo.matches('[data-descartar]')) {
        borrarBorrador();
        window.dispatchEvent(new Event('borrador-descartado'));
        pintarBorrador();
    } else if (objetivo.matches('[data-continuar]')) window.dispatchEvent(new Event('continuar-borrador'));
    else if (objetivo.matches('[data-salir]')) {
        objetivo.disabled = true;
        supabase.auth.signOut({ scope: 'local' }); // solo este dispositivo; SIGNED_OUT actualiza la vista (onAuthStateChange)
    }
    else if (objetivo.id === 'mc-olvidar' && confirm('¿Quitar de este navegador la lista de tus citas? Las citas no se cancelan; podrás verlas con tu enlace privado o iniciando sesión.')) {
        olvidarTodo();
        olvidarReclamaciones();
        actualizarMisCitas();
    }
}

async function manejarCuenta(evento) {
    evento.preventDefault();
    const form = evento.target;
    const error = form.querySelector('.mc-form-error');
    const email = form.elements.email.value.trim();
    const clave = form.elements.clave.value;
    if (!form.elements.email.checkValidity() || clave.length < 6) {
        error.textContent = 'Escribe un correo válido y una contraseña de al menos 6 caracteres.';
        return;
    }
    const botones = form.querySelectorAll('button');
    botones.forEach(b => { b.disabled = true; });
    error.textContent = '';
    try {
        const crear = evento.submitter?.value === 'crear';
        const { data, error: fallo } = crear
            ? await supabase.auth.signUp({ email, password: clave, options: { emailRedirectTo: `${location.origin}${location.pathname}#mis-citas` } })
            : await supabase.auth.signInWithPassword({ email, password: clave });
        if (fallo) throw fallo;
        if (crear && !data.session) {
            error.textContent = 'Te enviamos un correo para confirmar la cuenta. Después vuelve a «Mis citas» e inicia sesión.';
            return;
        }
        await actualizarMisCitas();
    } catch (fallo) {
        error.textContent = ERRORES_CUENTA[fallo?.message] || 'No se pudo completar. Revisa tu conexión e inténtalo de nuevo.';
    } finally {
        botones.forEach(b => { b.disabled = false; });
    }
}
