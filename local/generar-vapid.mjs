// Genera las claves VAPID de Web Push (una sola vez por proyecto).
// - La pública se escribe en assets/config.js (VAPID_PUBLIC_KEY): es pública por diseño.
// - La privada se guarda SOLO en local/.vapid.json (ignorado por Git) para copiarla a los secretos de Supabase.
// Si ya existen, no las cambia (cambiarlas invalidaría las suscripciones de todos los dispositivos).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO = path.join(RAIZ, 'local', '.vapid.json');
const CONFIG = path.join(RAIZ, 'assets', 'config.js');

let claves;
if (fs.existsSync(ARCHIVO)) {
    claves = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    console.log('Ya había claves VAPID en local/.vapid.json: se conservan.');
} else {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    claves = { publica: ecdh.getPublicKey().toString('base64url'), privada: ecdh.getPrivateKey().toString('base64url') };
    fs.writeFileSync(ARCHIVO, JSON.stringify(claves, null, 2));
    console.log('Claves VAPID nuevas guardadas en local/.vapid.json (no se sube a Git).');
}

const config = fs.readFileSync(CONFIG, 'utf8');
fs.writeFileSync(CONFIG, config.replace(/export const VAPID_PUBLIC_KEY = '[^']*';/, `export const VAPID_PUBLIC_KEY = '${claves.publica}';`));
console.log('assets/config.js: VAPID_PUBLIC_KEY actualizada.\n');
console.log('Guarda los secretos de la función push-enviar en Supabase (sustituye el correo y elige un CRON_SECRET largo):');
console.log(`  npx supabase secrets set --project-ref <PROYECTO> VAPID_PUBLIC_KEY=${claves.publica} VAPID_PRIVATE_KEY=<la de local/.vapid.json> VAPID_SUBJECT=mailto:tu@correo.com CRON_SECRET=<secreto>`);
