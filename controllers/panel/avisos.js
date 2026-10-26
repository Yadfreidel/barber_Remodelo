// ==========================================
// PANEL: AVISOS EN VIVO (notificaciones internas, sonido y Web Push)
// Con la app abierta (también en una pestaña de fondo, que el navegador consulta con menos frecuencia) se consulta cada pocos segundos. Al entrar no suena nada antiguo:
// solo lo que llega después. Varias pestañas abiertas: suena una sola vez por aviso.
// ==========================================

import { api } from './comun.js';
import { obtenerClienteAdmin } from '../../assets/supabaseClient.js';
import { VAPID_PUBLIC_KEY } from '../../assets/config.js';

const INTERVALO = 20000;
const CLAVE_SONADO = 'barberia-aviso-sonado';
let audio = null;
let preferencias = { sonido: true, volumen: 70, push: false };
let estado = null;

export function preferenciasActuales() { return { ...preferencias }; }
export function fijarPreferencias(p) { if (p) preferencias = { ...preferencias, ...p }; }

// ---------- Sonido ----------
// El navegador solo permite sonar tras una acción del usuario: se desbloquea con «Activar».
export async function desbloquearSonido() {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return false;
    audio ??= new Contexto();
    if (audio.state === 'suspended') await audio.resume().catch(() => {});
    return audio.state === 'running';
}
export const sonidoBloqueado = () => !audio || audio.state !== 'running';

export function reproducirSonido(volumen = preferencias.volumen) {
    if (sonidoBloqueado()) return false;
    const ahora = audio.currentTime;
    const ganancia = audio.createGain();
    ganancia.connect(audio.destination);
    const nivel = Math.max(0, Math.min(1, volumen / 100)) * 0.35;
    // Dos tonos breves
    [[880, 0], [1320, 0.16]].forEach(([frecuencia, inicio]) => {
        const osc = audio.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frecuencia;
        osc.connect(ganancia);
        osc.start(ahora + inicio);
        osc.stop(ahora + inicio + 0.14);
    });
    ganancia.gain.setValueAtTime(0.0001, ahora);
    ganancia.gain.exponentialRampToValueAtTime(Math.max(nivel, 0.0002), ahora + 0.02);
    ganancia.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.32);
    return true;
}

// Solo suena el aviso que ninguna otra pestaña ha hecho sonar
function reclamarSonido(usuario, id) {
    try {
        const clave = `${CLAVE_SONADO}:${usuario}`;
        if (Number(localStorage.getItem(clave) || 0) >= id) return false;
        localStorage.setItem(clave, String(id));
        return true;
    } catch { return true; }
}

// ---------- Consulta periódica ----------
// alAviso(nuevas) se llama con los avisos llegados; alContar(n) con las no leídas.
export function iniciarAvisos({ usuario, alContar, alAviso, vivo }) {
    detenerAvisos();
    const yo = { ultimo: null, temporizador: null, activo: true };
    estado = yo;
    const consultar = async () => {
        if (!yo.activo || !vivo()) return detenerAvisos();
        try {
            const r = await api('panel_notificaciones_estado', { p_desde: yo.ultimo });
            if (!yo.activo) return;
            alContar(Number(r.no_leidas));
            const ultimo = Number(r.ultimo_id || 0);
            if (yo.ultimo === null) {
                // Primera consulta: línea base. Lo anterior no suena al entrar ni al reconectar.
                reclamarSonido(usuario, ultimo);
            } else if (r.nuevas.length) {
                alAviso(r.nuevas);
                const mayor = Math.max(...r.nuevas.map(n => Number(n.id)));
                if (preferencias.sonido && reclamarSonido(usuario, mayor)) reproducirSonido();
            }
            yo.ultimo = Math.max(ultimo, yo.ultimo || 0);
        } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
    };
    yo.consultar = consultar;
    consultar();
    yo.temporizador = setInterval(consultar, INTERVALO);
    yo.visible = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', yo.visible);
    return yo;
}

export function consultarAhora() { estado?.consultar?.(); }

export function detenerAvisos() {
    if (!estado) return;
    estado.activo = false;
    clearInterval(estado.temporizador);
    document.removeEventListener('visibilitychange', estado.visible);
    estado = null;
}

// ---------- Web Push ----------
const base64AUint8 = b64 => {
    const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const claves = sub => { const j = sub.toJSON(); return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }; };

export function estadoPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        return { disponible: false, motivo: ios ? 'En iPhone/iPad los avisos con la app cerrada requieren iOS 16.4 o posterior y abrir la web desde el ícono agregado a la pantalla de inicio (Compartir › Agregar a inicio).'
            : 'Este navegador no admite avisos con la app cerrada.' };
    }
    if (!VAPID_PUBLIC_KEY) return { disponible: false, motivo: 'Los avisos con la app cerrada aún no están configurados en el servidor (faltan las claves VAPID).' };
    if (Notification.permission === 'denied') return { disponible: false, denegado: true, motivo: 'Bloqueaste las notificaciones para esta web. Actívalas en los ajustes del navegador (ícono del candado junto a la dirección).' };
    return { disponible: true, permiso: Notification.permission };
}

async function registro() {
    return navigator.serviceWorker.register('sw.js');
}

// Debe llamarse desde un clic (el navegador pide el permiso)
export async function activarPush() {
    const e = estadoPush();
    if (!e.disponible) throw new Error(e.motivo);
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('No se concedió el permiso de notificaciones. Seguirás viendo los avisos dentro de la app.');
    const reg = await registro();
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(VAPID_PUBLIC_KEY) });
    await api('push_suscribir', { p_datos: { ...claves(sub), dispositivo: navigator.userAgent.slice(0, 200) } });
    preferencias.push = true;
}

export async function pushActivoEnEsteDispositivo() {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager?.getSubscription());
}

// Al cerrar sesión o desactivar: este dispositivo deja de recibir avisos de la cuenta
export async function desactivarPushDispositivo() {
    try {
        if (!('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (!sub) return;
        await obtenerClienteAdmin()?.rpc('push_desuscribir', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
    } catch { /* sin conexión: el servidor la descarta cuando caduque */ }
}
