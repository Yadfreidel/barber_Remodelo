// Crea una cuenta del entorno local o cambia su contraseña (equivale a Authentication de Supabase).
// Uso:  npm run local:usuario -- correo@ejemplo.com nuevaClave [--admin]
// Requiere el entorno local en marcha (npm run local). Con --admin la agrega a admin_usuarios.
// Para el rol barbero: crea la cuenta aquí y vincúlala desde Panel > Barberos > Acceso al panel.
import pg from 'pg';
import crypto from 'node:crypto';

const [email, clave, ...resto] = process.argv.slice(2);
if (!email || !clave || clave.length < 6) {
    console.error('Uso: npm run local:usuario -- correo@ejemplo.com nuevaClave [--admin]   (mínimo 6 caracteres)');
    process.exit(1);
}

const sal = crypto.randomBytes(16).toString('hex');
const hash = `scrypt$${sal}$${crypto.scryptSync(clave, sal, 32).toString('hex')}`;
const db = new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres-local', database: 'postgres' });

try {
    await db.connect();
    const { rows: [usuario] } = await db.query(
        `insert into auth.users (email, password_hash) values (lower($1), $2)
         on conflict (email) do update set password_hash = excluded.password_hash
         returning id, (xmax = 0) as creado`, [email.trim(), hash]);
    if (resto.includes('--admin')) {
        await db.query('insert into barberia.admin_usuarios (user_id) values ($1) on conflict do nothing', [usuario.id]);
    }
    console.log(`${usuario.creado ? 'Cuenta creada' : 'Contraseña actualizada'}: ${email}${resto.includes('--admin') ? ' (administrador)' : ''}`);
} catch (e) {
    console.error('No se pudo conectar con la base local. ¿Está corriendo "npm run local"?', e.message);
    process.exitCode = 1;
} finally {
    await db.end().catch(() => {});
}
