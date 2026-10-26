// Sirve una Edge Function de supabase/functions con Deno contra el entorno local (npm run local en marcha),
// igual que en Supabase: SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY (claves SOLO locales).
// Uso: npm run local:funciones -- barbero-cuenta     (descarga Deno con npx la primera vez)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JWT_SECRETO = 'barberia-local-secreto-solo-para-desarrollo'; // el mismo de servidor-local.mjs
const b64url = d => Buffer.from(d).toString('base64url');
const firmar = payload => {
    const cuerpo = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
    return `${cuerpo}.${crypto.createHmac('sha256', JWT_SECRETO).update(cuerpo).digest('base64url')}`;
};
const clave = role => firmar({ iss: 'barberia-local', role, iat: 1760000000, exp: 4102444800 });

const nombre = process.argv[2] || 'barbero-cuenta';
const [, api] = (process.env.BARBERIA_PUERTOS || '8080,54321').split(',');
const puerto = (process.env.BARBERIA_FUNCIONES || 'http://127.0.0.1:54329').split(':').pop();
const hijo = spawn('npx', ['-y', 'deno@2.1.4', 'run', '--no-lock', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', `"${path.join(RAIZ, 'local', 'deno-servir.ts')}"`], {
    stdio: 'inherit', shell: true, windowsHide: true,
    env: { ...process.env, SUPABASE_URL: `http://localhost:${api}`, SUPABASE_ANON_KEY: clave('anon'), SUPABASE_SERVICE_ROLE_KEY: clave('service_role'),
        PUERTO_FUNCION: puerto, FUNCION_URL: pathToFileURL(path.join(RAIZ, 'supabase', 'functions', nombre, 'index.ts')).href }
});
hijo.on('exit', c => process.exit(c ?? 0));
