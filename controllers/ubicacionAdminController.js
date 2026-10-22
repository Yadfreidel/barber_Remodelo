// ==========================================
// PANEL ADMIN: "Ubicación de la barbería"
// Marcador arrastrable, clic para colocar, geolocalización solo al pulsar
// el botón (una lectura, sin seguimiento), vista previa, Guardar y Cancelar.
// ==========================================

import { obtenerClienteAdmin } from '../assets/supabaseClient.js';
import { obtenerUbicacion, guardarUbicacion, modoPersistenciaUbicacion, mensajeErrorUbicacion } from '../models/ubicacionModel.js';
import { validarUbicacion, LIMITES_UBICACION } from '../models/ubicacionValidacion.js';
import { cargarLeaflet, crearMapa, iconoBarberia } from '../assets/mapaLeaflet.js';
import { htmlTarjetaUbicacion } from './ubicacionController.js';

// Vista inicial del mapa cuando aún no hay ubicación (país completo; no se coloca marcador)
const VISTA_SIN_UBICACION = { centro: [18.7357, -70.1627], zoom: 7 };
const CAMPOS = ['nombre', 'direccion', 'referencia', 'latitud', 'longitud'];

export async function renderTabUbicacion(container, notificar) {
    const modo = modoPersistenciaUbicacion();
    container.innerHTML = '<p class="placeholder-horas">Cargando…</p>';

    if (modo === 'servidor') {
        const { data: { session } } = await obtenerClienteAdmin().auth.getSession();
        if (!session) {
            container.innerHTML = `
                <div class="admin-aviso-config">
                    <i class="fas fa-lock"></i>
                    <p><strong>Se requiere sesión de administrador.</strong></p>
                    <p>Cierra el panel y vuelve a entrar con tu correo y contraseña de administrador, o inicia sesión en la pestaña Módulos.</p>
                </div>`;
            return;
        }
    }

    let guardada = null;
    let errorCarga = false;
    try {
        guardada = await obtenerUbicacion();
    } catch (e) {
        errorCarga = true;
    }

    container.innerHTML = `
        <div class="admin-section-header">
            <h3><i class="fas fa-map-marked-alt"></i> Ubicación de la barbería</h3>
        </div>
        ${modo === 'local' ? `
            <div class="ubicacion-modo-demo">
                <i class="fas fa-exclamation-triangle"></i>
                <p><strong>Modo demostración (sin base de datos):</strong> la ubicación se guarda solo en este navegador.
                No se comparte con otros dispositivos ni con tus clientes.</p>
            </div>` : ''}
        ${errorCarga ? '<p class="resumen-alerta">No se pudo leer la ubicación guardada. Puedes configurarla de nuevo.</p>' : ''}
        <div class="ubicacion-admin">
            <form class="admin-form ubicacion-admin-form" novalidate>
                <label>Nombre del local
                    <input name="nombre" maxlength="${LIMITES_UBICACION.nombre}" autocomplete="organization" required>
                    <small class="ubicacion-error" data-error="nombre"></small>
                </label>
                <label>Dirección
                    <input name="direccion" maxlength="${LIMITES_UBICACION.direccion}" autocomplete="street-address" required>
                    <small class="ubicacion-error" data-error="direccion"></small>
                </label>
                <label>Referencia (opcional)
                    <textarea name="referencia" rows="2" maxlength="${LIMITES_UBICACION.referencia}" placeholder="Ej.: frente al parque, segundo nivel"></textarea>
                    <small class="ubicacion-error" data-error="referencia"></small>
                </label>
                <div class="ubicacion-coordenadas">
                    <label>Latitud
                        <input name="latitud" inputmode="decimal" placeholder="18.486058">
                        <small class="ubicacion-error" data-error="latitud"></small>
                    </label>
                    <label>Longitud
                        <input name="longitud" inputmode="decimal" placeholder="-69.931212">
                        <small class="ubicacion-error" data-error="longitud"></small>
                    </label>
                </div>
                <button type="button" class="btn-ubicacion" data-mi-ubicacion>
                    <i class="fas fa-location-arrow"></i> Usar mi ubicación
                </button>
                <p class="ubicacion-estado-gps" aria-live="polite"></p>
                <div class="acciones-gestion">
                    <button type="submit" class="btn-admin-accion"><i class="fas fa-save"></i> Guardar</button>
                    <button type="button" class="btn-danger" data-cancelar><i class="fas fa-undo"></i> Cancelar</button>
                </div>
            </form>
            <div class="ubicacion-admin-mapa-zona">
                <p class="nota-espera">Haz clic en el mapa para colocar el marcador o arrástralo para ajustarlo.</p>
                <div class="ubicacion-mapa ubicacion-mapa-admin" role="application" aria-label="Mapa para elegir la ubicación"></div>
                <h4 class="ubicacion-preview-titulo">Vista previa para clientes</h4>
                <div class="ubicacion-tarjeta ubicacion-preview"></div>
            </div>
        </div>`;

    const form = container.querySelector('form');
    const contenedorMapa = container.querySelector('.ubicacion-mapa-admin');
    const preview = container.querySelector('.ubicacion-preview');
    const estadoGps = container.querySelector('.ubicacion-estado-gps');
    let L = null;
    let mapa = null;
    let marcador = null;

    const leerFormulario = () => Object.fromEntries(CAMPOS.map(c => [c, form.elements[c].value]));

    function actualizarPreview() {
        const { ok, valor } = validarUbicacion(leerFormulario());
        preview.innerHTML = htmlTarjetaUbicacion(ok ? valor : null, { vistaPrevia: true });
        if (!ok) preview.insertAdjacentHTML('beforeend', '<p class="nota-espera">Completa nombre, dirección y marcador para ver la tarjeta final.</p>');
    }

    function mostrarErrores(errores = {}) {
        form.querySelectorAll('[data-error]').forEach(el => {
            el.textContent = errores[el.dataset.error] || '';
            form.elements[el.dataset.error].setAttribute('aria-invalid', errores[el.dataset.error] ? 'true' : 'false');
        });
    }

    function colocarMarcador(lat, lng, { centrar = false, zoom = null, escribirCampos = true } = {}) {
        // Al teclear coordenadas el marcador sigue al campo sin reescribirlo
        if (escribirCampos) {
            form.elements.latitud.value = lat.toFixed(6);
            form.elements.longitud.value = lng.toFixed(6);
        }
        if (mapa) {
            if (!marcador) {
                marcador = L.marker([lat, lng], { draggable: true, icon: iconoBarberia(L), title: 'Ubicación del local' }).addTo(mapa);
                marcador.on('dragend', () => {
                    const p = marcador.getLatLng();
                    colocarMarcador(p.lat, p.lng);
                });
            } else {
                marcador.setLatLng([lat, lng]);
            }
            if (centrar) mapa.setView([lat, lng], zoom || Math.max(mapa.getZoom(), 17));
        }
        actualizarPreview();
    }

    function cargarEnFormulario(u) {
        CAMPOS.forEach(c => { form.elements[c].value = u ? (u[c] ?? '') : ''; });
        mostrarErrores();
        estadoGps.textContent = '';
        if (marcador && !u) {
            marcador.remove();
            marcador = null;
        }
        if (u) colocarMarcador(Number(u.latitud), Number(u.longitud), { centrar: true, zoom: 17 });
        else if (mapa) mapa.setView(VISTA_SIN_UBICACION.centro, VISTA_SIN_UBICACION.zoom);
        actualizarPreview();
    }

    // Mapa
    try {
        L = await cargarLeaflet();
        const inicio = guardada ? [Number(guardada.latitud), Number(guardada.longitud)] : VISTA_SIN_UBICACION.centro;
        mapa = crearMapa(L, contenedorMapa, inicio, guardada ? 17 : VISTA_SIN_UBICACION.zoom, {}, () => {
            contenedorMapa.insertAdjacentHTML('beforeend', '<p class="ubicacion-mapa-error">Algunas partes del mapa no cargaron. Revisa tu conexión.</p>');
        });
        mapa.on('click', e => colocarMarcador(e.latlng.lat, e.latlng.lng));
        setTimeout(() => mapa && mapa.invalidateSize(), 200); // el panel cambia de tamaño al abrirse
    } catch (e) {
        contenedorMapa.innerHTML = '<p class="ubicacion-mapa-estado">No se pudo cargar el mapa. Puedes escribir la latitud y longitud manualmente.</p>';
    }

    cargarEnFormulario(guardada);

    form.addEventListener('input', e => {
        if (e.target.name === 'latitud' || e.target.name === 'longitud') {
            const { latitud, longitud } = leerFormulario();
            const lat = Number(String(latitud).replace(',', '.'));
            const lng = Number(String(longitud).replace(',', '.'));
            if (latitud !== '' && longitud !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) && mapa) {
                if (!marcador) colocarMarcador(lat, lng, { centrar: true, escribirCampos: false });
                else {
                    marcador.setLatLng([lat, lng]);
                    mapa.panTo([lat, lng]);
                }
            }
        }
        actualizarPreview();
    });

    container.querySelector('[data-mi-ubicacion]').addEventListener('click', () => {
        if (!('geolocation' in navigator)) {
            estadoGps.textContent = 'Este navegador no permite obtener la ubicación. Coloca el marcador manualmente.';
            return;
        }
        if (!window.isSecureContext) {
            estadoGps.textContent = 'La ubicación del dispositivo solo funciona en https o en localhost. Coloca el marcador manualmente.';
            return;
        }
        estadoGps.textContent = 'Obteniendo tu ubicación…';
        // Una sola lectura (sin seguimiento continuo)
        navigator.geolocation.getCurrentPosition(
            pos => {
                colocarMarcador(pos.coords.latitude, pos.coords.longitude, { centrar: true, zoom: 18 });
                estadoGps.textContent = `Ubicación aproximada (±${Math.round(pos.coords.accuracy)} m). Ajusta el marcador si hace falta y luego pulsa Guardar.`;
            },
            err => {
                estadoGps.textContent = {
                    1: 'Permiso de ubicación denegado. Actívalo en el navegador o coloca el marcador manualmente.',
                    2: 'No se pudo determinar tu ubicación. Coloca el marcador manualmente.',
                    3: 'La ubicación tardó demasiado. Intenta de nuevo o coloca el marcador manualmente.'
                }[err.code] || 'No se pudo obtener la ubicación.';
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });

    container.querySelector('[data-cancelar]').addEventListener('click', () => {
        cargarEnFormulario(guardada);
        notificar('Cambios descartados', 'info');
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const { ok, errores } = validarUbicacion(leerFormulario());
        mostrarErrores(errores);
        if (!ok) {
            notificar('Revisa los campos marcados', 'error');
            return;
        }
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
            guardada = await guardarUbicacion(leerFormulario());
            cargarEnFormulario(guardada);
            notificar(modo === 'local' ? 'Ubicación guardada en este navegador' : 'Ubicación guardada');
        } catch (err) {
            notificar(mensajeErrorUbicacion(err), 'error');
        } finally {
            boton.disabled = false;
        }
    });

    // Libera el mapa si se cambia de pestaña
    const observador = new MutationObserver(() => {
        if (!contenedorMapa.isConnected) {
            if (mapa) mapa.remove();
            mapa = null;
            observador.disconnect();
        }
    });
    observador.observe(container, { childList: true });
}
