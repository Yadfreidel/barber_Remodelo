// Alta de la cuenta de acceso de un barbero desde el panel (Configuración › Barberos).
// Hace toda la operación en el servidor y solo responde «ok» cuando cuenta, rol y perfil quedan listos:
//   1. Quien llama debe ser administrador de barbería (su propia sesión; es_admin en la base).
//   2. Crea la cuenta en Supabase Auth con la contraseña inicial (correo confirmado por el administrador).
//   3. La vincula con el perfil y le da el rol barbero (panel_cuenta_vincular, con la sesión del administrador:
//      la base vuelve a validar permisos, unicidad y contraseña temporal).
//   4. Si el paso 3 falla, elimina la cuenta recién creada (compensación). Nunca borra una cuenta que ya existía.
// Si el correo ya tiene cuenta NO se toca (ni contraseña ni roles): se responde 409 para que el panel pida
// la vinculación explícita. La contraseña no se guarda, no se devuelve y no se registra en logs.
// Desplegar con: supabase functions deploy barbero-cuenta   (o desde el panel de Supabase › Edge Functions)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mismos requisitos que el panel: 8 a 72 caracteres, con letras y números
export const claveValida = (c: string) => c.length >= 8 && c.length <= 72 && /[A-Za-z]/.test(c) && /\d/.test(c);
const codigo = (m?: string) => (m || '').match(/[a-z]+(?:_[a-z]+)+/)?.[0] || 'error';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'metodo_no_permitido' }, 405);
    const url = Deno.env.get('SUPABASE_URL')!;

    // 1. Administrador de barbería, con su propia sesión
    const comoAdmin = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        db: { schema: 'barberia' }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false }
    });
    const { data: esAdmin, error: errorRol } = await comoAdmin.rpc('es_admin');
    if (errorRol || esAdmin !== true) return json({ error: 'no_autorizado' }, 403);

    let cuerpo: { email?: string; password?: string; barbero_id?: string; permisos?: string[]; reemplazar?: boolean };
    try { cuerpo = await req.json(); } catch { return json({ error: 'datos_invalidos' }, 400); }
    const email = String(cuerpo.email ?? '').trim().toLowerCase();
    const password = String(cuerpo.password ?? '');
    const barbero = String(cuerpo.barbero_id ?? '');
    if (!CORREO.test(email) || !barbero) return json({ error: 'datos_invalidos' }, 400);
    if (!claveValida(password)) return json({ error: 'clave_debil' }, 400);

    // Correo ya registrado: no se crea ni se modifica nada
    const { data: existente, error: errorConsulta } = await comoAdmin.rpc('panel_cuenta_consultar', { p_email: email });
    if (errorConsulta) return json({ error: codigo(errorConsulta.message) }, 400);
    if (existente?.existe) return json({ error: 'cuenta_existente', ...existente }, 409);

    // 2. Cuenta nueva en Auth
    const servicio = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identidad, error: errorIdentidad } = await comoAdmin.auth.getUser();
    if (errorIdentidad || !identidad.user) return json({ error: 'no_autorizado' }, 403);
    const { data: creada, error: errorAlta } = await servicio.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { barberia_alta_admin: identidad.user.id, barberia_alta_perfil: barbero } });
    if (errorAlta || !creada.user) {
        // Otra petición (doble clic) la creó entre la consulta y el alta
        if (/already|registered|exists/i.test(errorAlta?.message || '')) return json({ error: 'cuenta_existente', existe: true, reciente: true }, 409);
        if (/password/i.test(errorAlta?.message || '')) return json({ error: 'clave_debil' }, 400);
        return json({ error: 'alta_fallida' }, 502);
    }

    // 3. Rol barbero + vínculo con el perfil (validado en la base con la sesión del administrador)
    const { data: vinculo, error: errorVinculo } = await comoAdmin.rpc('panel_cuenta_vincular', { p_datos: {
        barbero_id: barbero, email, clave_temporal: true, permisos: cuerpo.permisos ?? [], reemplazar: cuerpo.reemplazar === true } });
    if (errorVinculo) {
        // 4. Compensación: sin vínculo no queda una cuenta huérfana (solo la creada en esta petición)
        const { error: errorBorrado } = await servicio.auth.admin.deleteUser(creada.user.id);
        return json({ error: codigo(errorVinculo.message), compensado: !errorBorrado }, errorBorrado ? 500 : 409);
    }
    return json({ ok: true, verificado: true, clave_temporal: vinculo?.clave_temporal === true, repetida: vinculo?.repetida === true });
});
