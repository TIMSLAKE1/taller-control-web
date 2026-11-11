import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(['https://taller-control-web.pages.dev']);
const CORS_BASE = {
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  const headers = new Headers({ ...CORS_BASE, 'Content-Type': 'application/json; charset=utf-8' });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function secureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origen no permitido.' }, 403, null);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...CORS_BASE,
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  } });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405, origin);

  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: 'Inicia sesión con una cuenta de encargado.' }, 401, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'La función no tiene la configuración segura requerida.' }, 500, origin);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse({ error: 'La sesión no es válida. Inicia sesión de nuevo.' }, 401, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: manager, error: managerError } = await admin.from('profiles')
    .select('id,role,is_manager,active')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (managerError) return jsonResponse({ error: 'No se pudo comprobar la autorización del encargado.' }, 500, origin);
  if (!manager || manager.active !== true || manager.role !== 'mechanic' || manager.is_manager !== true) {
    return jsonResponse({ error: 'Solo el encargado activo puede administrar las cuentas de técnicos.' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'La solicitud contiene JSON inválido.' }, 400, origin);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!validEmail(email)) return jsonResponse({ error: 'Escribe un correo electrónico válido.' }, 400, origin);
  if (displayName.length < 2 || displayName.length > 100) return jsonResponse({ error: 'El nombre debe tener entre 2 y 100 caracteres.' }, 400, origin);
  if (password.length < 12 || password.length > 200) return jsonResponse({ error: 'La contraseña debe tener entre 12 y 200 caracteres.' }, 400, origin);

  const invitationToken = secureToken();
  const tokenHash = await sha256(invitationToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: deleteError } = await admin.from('technician_invitations')
    .delete().eq('email', email).is('accepted_at', null);
  if (deleteError) return jsonResponse({ error: 'No se pudo preparar la autorización de la cuenta.' }, 500, origin);

  const { data: invitation, error: insertError } = await admin.from('technician_invitations')
    .insert({
      email,
      display_name: displayName,
      token_hash: tokenHash,
      created_by: manager.id,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insertError || !invitation) {
    return jsonResponse({ error: 'No se pudo preparar la autorización de la cuenta.' }, 409, origin);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, invitation_token: invitationToken },
  });
  if (createError || !created.user) {
    await admin.from('technician_invitations').delete().eq('id', invitation.id);
    const duplicate = /already registered|already exists|duplicate key/i.test(createError?.message || '');
    return jsonResponse({
      error: duplicate
        ? 'Ya existe una cuenta con ese correo. Si está desactivada, reactívala desde Administración de usuarios.'
        : 'No se pudo crear la cuenta autorizada.',
    }, duplicate ? 409 : 500, origin);
  }

  // The database trigger consumes the one-time invitation token during account creation.
  // Remove the consumed token from user-editable metadata as an additional precaution.
  await admin.auth.admin.updateUserById(created.user.id, { user_metadata: { display_name: displayName } });

  return jsonResponse({ user: {
    id: created.user.id,
    email,
    display_name: displayName,
    role: 'mechanic',
    is_technician: true,
  } }, 201, origin);
});
