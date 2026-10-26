// Crea la cuenta de Auth de un barbero con una contraseña temporal (alta desde el panel).
// Solo un administrador de barbería (barberia.admin_usuarios) puede llamarla. La vinculación con el
// perfil la hace después el panel con panel_cuenta_vincular (validada en la base).
// Si el correo ya existe NO se toca: ni su contraseña ni sus roles.
// La contraseña no se guarda ni se registra en logs.
// Desplegar con: supabase functions deploy barbero-cuenta
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
    const url = Deno.env.get('SUPABASE_URL')!;

    // 1. Quien llama debe ser administrador de barbería (con su propia sesión)
    const autorizacion = req.headers.get('Authorization') ?? '';
    const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        db: { schema: 'barberia' }, global: { headers: { Authorization: autorizacion } }, auth: { persistSession: false }
    });
    const { data: esAdmin, error: errorRol } = await comoUsuario.rpc('es_admin');
    if (errorRol || esAdmin !== true) return json({ error: 'no_autorizado' }, 403);

    let cuerpo: { email?: string; password?: string };
    try { cuerpo = await req.json(); } catch { return json({ error: 'datos_invalidos' }, 400); }
    const email = String(cuerpo.email ?? '').trim().toLowerCase();
    const password = String(cuerpo.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 72) {
        return json({ error: 'datos_invalidos' }, 400);
    }

    // 2. Alta con la API de administración de Auth (correo confirmado por el administrador)
    const servicio = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await servicio.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
        const existe = /already|registered|exists/i.test(error.message);
        return json({ error: existe ? 'cuenta_existente' : 'alta_fallida', existe }, existe ? 409 : 502);
    }
    return json({ ok: true, user_id: data.user?.id });
});
