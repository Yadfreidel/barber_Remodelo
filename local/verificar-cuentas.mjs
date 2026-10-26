// Prueba HTTP aislada: nunca usa la base de datos ni cuentas del entorno habitual.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const datos = mkdtempSync(path.join(os.tmpdir(), 'barberia-cuentas-http-'));
const api = 'http://localhost:54351';
const entorno = { ...process.env, BARBERIA_DATOS: datos, BARBERIA_PUERTOS: '8091,54351,54352,54353', BARBERIA_FUNCIONES: 'http://localhost:54359', BARBERIA_FUNCIONES_AUTO: '0' };
const servidor = spawn(process.execPath, ['local/servidor-local.mjs'], { windowsHide: true, stdio: 'ignore', env: entorno });
const funciones = spawn(process.execPath, ['local/funciones-local.mjs'], { windowsHide: true, stdio: 'ignore', env: entorno });
const pausa = () => new Promise(r => setTimeout(r, 250));
async function peticion(ruta, cuerpo, token, esperado = 200) {
    const r = await fetch(api + ruta, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Profile': 'barberia',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(10000) });
    const resultado = await r.json();
    assert.equal(r.status, esperado, `HTTP ${ruta}: ${JSON.stringify(resultado)}`);
    return resultado;
}
try {
    let listo = false;
    for (let i = 0; i < 240; i++) {
        try {
            const r = await fetch(api + '/functions/v1/barbero-cuenta', { method: 'POST', body: '{}', signal: AbortSignal.timeout(500) });
            if (r.status === 403) { listo = true; break; }
        } catch {}
        await pausa();
    }
    assert.ok(listo, 'El entorno de prueba debe iniciar con su funcion de cuentas');
    const admin = await peticion('/auth/v1/token?grant_type=password', { email: 'yafre2310@gmail.com', password: '123456' });
    const rpc = (nombre, cuerpo, token = admin.access_token, estado = 200) => peticion('/rest/v1/rpc/' + nombre, cuerpo, token, estado);
    const perfil = await rpc('panel_guardar_barbero', { p_id: null, p_datos: { nombre: 'Prueba HTTP aislada', activo: true } });
    const email = 'barbero-http@example.test';
    const password = 'PruebaInicial789';
    const alta = await peticion('/functions/v1/barbero-cuenta', { barbero_id: perfil.id, email, password, permisos: ['cajero'] }, admin.access_token);
    assert.equal(alta.ok, true);
    assert.equal(alta.clave_temporal, true);
    const usuario = await peticion('/auth/v1/token?grant_type=password', { email, password });
    const rol = await rpc('rol_panel', {}, usuario.access_token);
    assert.equal(rol.rol, 'barbero'); assert.equal(rol.debe_cambiar_clave, true);
    await rpc('panel_cuenta_vincular', { p_datos: { barbero_id: perfil.id, email, permisos: [] } });
    assert.deepEqual((await rpc('rol_panel', {}, usuario.access_token)).permisos, ['cajero']);
    const cambio = await fetch(api + '/auth/v1/user', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${usuario.access_token}` }, body: JSON.stringify({ password: 'NuevaPersonal456' }) });
    assert.equal(cambio.status, 200);
    await rpc('panel_confirmar_cambio_clave', {}, usuario.access_token);
    assert.equal((await rpc('rol_panel', {}, usuario.access_token)).debe_cambiar_clave, false);
    await rpc('panel_cuenta_acceso', { p_barbero: perfil.id, p_activo: false, p_motivo: 'Prueba aislada' });
    assert.equal((await rpc('rol_panel', {}, usuario.access_token)).rol, null);
    await rpc('panel_cuenta_acceso', { p_barbero: perfil.id, p_activo: true });
    assert.equal((await rpc('rol_panel', {}, usuario.access_token)).rol, 'barbero');
    await peticion('/functions/v1/barbero-cuenta', { barbero_id: perfil.id, email, password }, usuario.access_token, 403);
    console.log('OK: alta Auth, login, rol, reintento, permisos, cambio de clave, desactivar/reactivar y rechazo de no administrador. Todo en base temporal.');
} finally {
    for (const proceso of [funciones, servidor]) {
        if (process.platform === 'win32') {
            try { execFileSync('taskkill', ['/PID', String(proceso.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch {}
        } else proceso.kill();
    }
    try { execFileSync(path.resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'), ['stop', '-D', datos, '-m', 'fast', '-w', '-t', '5'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
}
