import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const BUCKET = 'taller-evidencia';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 700 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      global: { headers: { 'X-Client-Info': 'taller-control-static/1.0' } }
    })
  : null;

const temporaryAuth = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' }
    })
  : null;

function client() {
  if (!supabase) throw apiError('Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para la compilación estática.', 503);
  return supabase;
}

function apiError(message, status = 500, code = '') {
  const error = new Error(message || 'No se pudo completar la operación.');
  error.status = status;
  error.code = code;
  return error;
}

function translateError(error) {
  if (error?.status) return error;
  const code = String(error?.code || '');
  const status = code === '23505' ? 409 : code === '42501' || code === 'PGRST301' ? 403 : code === 'PGRST116' ? 404 : 500;
  const text = String(error?.message || 'Error de conexión con Supabase.');
  if (/duplicate key|already exists|unique constraint/i.test(text)) return apiError('Ya existe una cuenta o folio con esos datos.', 409, code);
  if (/row-level security|permission denied|42501/i.test(text)) return apiError('La cuenta no tiene autorización para esta operación.', 403, code);
  if (/evidence limit|límite de evidencia/i.test(text)) return apiError('Se alcanzó el límite interno de evidencia. Revisa el uso antes de adjuntar más archivos.', 413, code);
  return apiError(text, status, code);
}

function throwIfError(result) {
  if (result?.error) throw translateError(result.error);
  return result?.data;
}

function publicUser(profile) {
  return {
    id: profile.id,
    email: profile.email,
    display_name: profile.display_name,
    role: profile.is_manager ? 'manager' : 'mechanic',
    is_technician: profile.role === 'mechanic'
  };
}

async function fetchProfile(userId) {
  const { data, error } = await client().from('profiles')
    .select('id,email,display_name,role,is_manager,active,created_at')
    .eq('id', userId).maybeSingle();
  if (error) throw translateError(error);
  return data;
}

async function promoteInitialManagerIfEligible(profile) {
  if (!profile || profile.active) return profile;
  const { data, error } = await client().rpc('claim_initial_manager');
  if (error) throw translateError(error);
  return data === true ? await fetchProfile(profile.id) : profile;
}

async function activeSessionProfile() {
  const { data, error } = await client().auth.getUser();
  if (error || !data?.user) return null;
  let profile = await fetchProfile(data.user.id);
  profile = await promoteInitialManagerIfEligible(profile);
  if (!profile?.active || profile.role !== 'mechanic') {
    await client().auth.signOut({ scope: 'local' }).catch(() => {});
    return null;
  }
  return profile;
}

function asDate(value, fallback = new Date().toISOString()) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.valueOf())) throw apiError('Fecha inválida.', 400);
  return date.toISOString();
}

function safeName(value) {
  return String(value || 'evidencia').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(-180) || 'evidencia';
}

async function validImage(file) {
  if (!(file instanceof Blob) || file.size <= 0) throw apiError('El archivo está vacío o no es válido.', 400);
  if (file.size > MAX_FILE_BYTES) throw apiError('Cada imagen debe pesar 10 MB o menos.', 413);
  if (!ALLOWED_TYPES.has(file.type)) throw apiError('Tipo de imagen no admitido. Usa JPEG, PNG, WebP, GIF, AVIF o HEIC.', 415);
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  let valid = false;
  if (file.type === 'image/jpeg') valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  else if (file.type === 'image/png') valid = bytes.length >= 8 && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  else if (file.type === 'image/gif') valid = ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  else if (file.type === 'image/webp') valid = bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  else if (['image/avif', 'image/heic', 'image/heif'].includes(file.type)) {
    const brands = ascii(8, bytes.length);
    valid = bytes.length >= 12 && ascii(4, 8) === 'ftyp' && (file.type === 'image/avif'
      ? brands.includes('avif') || brands.includes('avis')
      : ['heic','heix','hevc','hevx','heif','mif1','msf1'].some((brand) => brands.includes(brand)));
  }
  if (!valid) throw apiError('El contenido del archivo no coincide con su formato de imagen.', 415);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function registerAccount(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw apiError('Escribe un correo electrónico válido.', 400);
  if (displayName.length < 2 || displayName.length > 100) throw apiError('El nombre debe tener entre 2 y 100 caracteres.', 400);
  if (password.length < 12 || password.length > 200) throw apiError('La contraseña debe tener entre 12 y 200 caracteres.', 400);
  const { data, error } = await temporaryAuth.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin }
  });
  if (error) throw translateError(error);
  return { created: Boolean(data?.user), confirmation_required: !data?.session };
}

async function inviteTechnician(body) {
  const manager = await activeSessionProfile();
  if (!manager?.is_manager) throw apiError('Solo el encargado puede administrar las cuentas de técnicos.', 403);
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw apiError('Escribe un correo electrónico válido.', 400);
  if (displayName.length < 2 || displayName.length > 100) throw apiError('El nombre debe tener entre 2 y 100 caracteres.', 400);
  if (password.length < 12 || password.length > 200) throw apiError('La contraseña debe tener entre 12 y 200 caracteres.', 400);

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const db = client();
  const { error: deleteError } = await db.from('technician_invitations').delete().eq('email', email).is('accepted_at', null);
  if (deleteError) throw translateError(deleteError);
  const { error: insertError } = await db.from('technician_invitations').insert({
    email, display_name: displayName, token_hash: tokenHash, created_by: manager.id, expires_at: expiresAt
  });
  if (insertError) throw translateError(insertError);

  const { data, error } = await temporaryAuth.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, invitation_token: token }, emailRedirectTo: window.location.origin }
  });
  if (error || !data?.user) {
    await db.from('technician_invitations').delete().eq('email', email).eq('token_hash', tokenHash);
    throw translateError(error || apiError('No se pudo crear la cuenta autorizada.', 500));
  }
  return { user: { id: data.user.id, email, display_name: displayName, role: 'mechanic', is_technician: true } };
}

async function loadData() {
  const db = client();
  const [orderResult, expenseResult, orderFileResult, expenseFileResult] = await Promise.all([
    db.from('service_orders').select('id,order_number,received_at,status,customer_name,vehicle_plate,data_json,created_at,updated_at').order('received_at', { ascending: false }).limit(2000),
    db.from('shop_expenses').select('id,expense_date,category,description,amount,service_order_id,created_at').order('expense_date', { ascending: false }).limit(2000),
    db.from('evidence_files').select('id,service_order_id,original_name,media_type,size,created_at').order('created_at').limit(12000),
    db.from('expense_evidence_files').select('id,expense_id,original_name,media_type,size,created_at').order('created_at').limit(4000)
  ]);
  const orderRows = throwIfError(orderResult) || [];
  const expenseRows = throwIfError(expenseResult) || [];
  const orderFiles = throwIfError(orderFileResult) || [];
  const expenseFiles = throwIfError(expenseFileResult) || [];
  const filesByOrder = new Map();
  for (const file of orderFiles) {
    const rows = filesByOrder.get(file.service_order_id) || [];
    rows.push({ photoId: file.id, name: file.original_name, type: file.media_type, size: file.size, created_at: file.created_at });
    filesByOrder.set(file.service_order_id, rows);
  }
  const proofByExpense = new Map(expenseFiles.map((file) => [file.expense_id, {
    photoId: file.id, name: file.original_name, type: file.media_type, size: file.size, created_at: file.created_at
  }]));
  const orders = orderRows.map((row) => ({ ...(row.data_json || {}), id: row.id, order_number: row.order_number, received_at: row.received_at, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at, evidence: filesByOrder.get(row.id) || [] }));
  const expenses = expenseRows.map((row) => ({ ...row, amount: Number(row.amount), proof: proofByExpense.get(row.id) || null }));
  return { orders, expenses };
}

async function saveOrder(order) {
  if (!order || typeof order !== 'object' || typeof order.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(order.id)) throw apiError('Identificador de orden inválido.', 400);
  if (typeof order.order_number !== 'string' || order.order_number.length > 80) throw apiError('Folio de orden inválido.', 400);
  const payload = {
    id: order.id,
    order_number: order.order_number,
    received_at: asDate(order.received_at),
    status: order.status,
    customer_name: String(order.customer?.name || '').slice(0, 200),
    vehicle_plate: String(order.vehicle?.plate || '').slice(0, 40),
    data_json: order,
    created_at: asDate(order.created_at),
    updated_at: asDate(order.updated_at)
  };
  const { error } = await client().from('service_orders').upsert(payload, { onConflict: 'id' });
  if (error) throw translateError(error);
  return { order: { ...order, received_at: payload.received_at, created_at: payload.created_at, updated_at: payload.updated_at } };
}

async function saveExpense(body) {
  const amount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.expense_date || '')) || !String(body.category || '').trim() || !String(body.description || '').trim() || !Number.isFinite(amount) || amount <= 0) {
    throw apiError('Fecha, categoría, descripción e importe mayor que cero son obligatorios.', 400);
  }
  const session = await client().auth.getUser();
  if (!session.data?.user) throw apiError('Inicia sesión de nuevo.', 401);
  const payload = {
    id: body.id || crypto.randomUUID(), expense_date: body.expense_date, category: String(body.category).trim().slice(0, 80),
    description: String(body.description).trim().slice(0, 160), amount,
    service_order_id: body.service_order_id || null, created_by: session.data.user.id
  };
  const { data, error } = await client().from('shop_expenses').insert(payload).select('id,expense_date,category,description,amount,service_order_id,created_at').single();
  if (error) throw translateError(error);
  return { expense: { ...data, amount: Number(data.amount), proof: null } };
}

async function uploadOrderPhoto(orderId, file) {
  await validImage(file);
  const db = client();
  const { data: sessionData, error: sessionError } = await db.auth.getUser();
  if (sessionError || !sessionData?.user) throw apiError('Inicia sesión de nuevo.', 401);
  const { count, error: countError } = await db.from('evidence_files').select('id', { count: 'exact', head: true }).eq('service_order_id', orderId);
  if (countError) throw translateError(countError);
  if (count >= 6) throw apiError('Una orden puede tener un máximo de 6 fotos.', 409);
  const fileId = crypto.randomUUID();
  const storagePath = `orders/${orderId}/${fileId}`;
  const metadata = { id: fileId, service_order_id: orderId, storage_path: storagePath, original_name: safeName(file.name), media_type: file.type, size: file.size, created_by: sessionData.user.id };
  const { error: insertError } = await db.from('evidence_files').insert(metadata);
  if (insertError) throw translateError(insertError);
  const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    await db.from('evidence_files').delete().eq('id', fileId);
    throw translateError(uploadError);
  }
  return { photo: { photoId: fileId, name: metadata.original_name, created_at: new Date().toISOString(), size: file.size, type: file.type } };
}

async function removeOrderPhoto(orderId, photoId) {
  const db = client();
  const { data: photo, error } = await db.from('evidence_files').select('id,storage_path').eq('id', photoId).eq('service_order_id', orderId).maybeSingle();
  if (error) throw translateError(error);
  if (!photo) throw apiError('No se encontró la foto de esa orden.', 404);
  const { error: removeError } = await db.storage.from(BUCKET).remove([photo.storage_path]);
  if (removeError) throw translateError(removeError);
  const { error: deleteError } = await db.from('evidence_files').delete().eq('id', photoId);
  if (deleteError) throw translateError(deleteError);
  return { ok: true };
}

async function uploadExpenseProof(expenseId, file) {
  await validImage(file);
  const db = client();
  const { data: sessionData, error: sessionError } = await db.auth.getUser();
  if (sessionError || !sessionData?.user) throw apiError('Inicia sesión de nuevo.', 401);
  const { data: existing, error: findError } = await db.from('expense_evidence_files').select('id').eq('expense_id', expenseId).maybeSingle();
  if (findError) throw translateError(findError);
  if (existing) throw apiError('Este gasto ya tiene una imagen; elimina el comprobante anterior antes de reemplazarlo.', 409);
  const fileId = crypto.randomUUID();
  const storagePath = `expenses/${expenseId}/${fileId}`;
  const metadata = { id: fileId, expense_id: expenseId, storage_path: storagePath, original_name: safeName(file.name), media_type: file.type, size: file.size, created_by: sessionData.user.id };
  const { error: insertError } = await db.from('expense_evidence_files').insert(metadata);
  if (insertError) throw translateError(insertError);
  const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    await db.from('expense_evidence_files').delete().eq('id', fileId);
    throw translateError(uploadError);
  }
  return { proof: { photoId: fileId, name: metadata.original_name, type: file.type, size: file.size, created_at: new Date().toISOString() } };
}

async function removeExpenseProof(expenseId) {
  const db = client();
  const { data: proof, error } = await db.from('expense_evidence_files').select('id,storage_path').eq('expense_id', expenseId).maybeSingle();
  if (error) throw translateError(error);
  if (!proof) throw apiError('Este gasto no tiene una imagen adjunta.', 404);
  const { error: removeError } = await db.storage.from(BUCKET).remove([proof.storage_path]);
  if (removeError) throw translateError(removeError);
  const { error: deleteError } = await db.from('expense_evidence_files').delete().eq('id', proof.id);
  if (deleteError) throw translateError(deleteError);
  return { ok: true };
}

async function deleteExpense(expenseId) {
  const db = client();
  const { data: proofs, error: findError } = await db.from('expense_evidence_files').select('id,storage_path').eq('expense_id', expenseId);
  if (findError) throw translateError(findError);
  if (proofs?.length) {
    const { error: removeError } = await db.storage.from(BUCKET).remove(proofs.map((proof) => proof.storage_path));
    if (removeError) throw translateError(removeError);
  }
  const { error: deleteError } = await db.from('shop_expenses').delete().eq('id', expenseId);
  if (deleteError) throw translateError(deleteError);
  return { ok: true };
}

async function downloadPrivateEvidence(kind, id) {
  const db = client();
  const table = kind === 'expense' ? 'expense_evidence_files' : 'evidence_files';
  const key = kind === 'expense' ? 'id' : 'id';
  const { data: row, error } = await db.from(table).select('storage_path').eq(key, id).maybeSingle();
  if (error) throw translateError(error);
  if (!row) throw apiError('No se encontró la imagen privada.', 404);
  const { data, error: downloadError } = await db.storage.from(BUCKET).download(row.storage_path);
  if (downloadError) throw translateError(downloadError);
  return data;
}

async function storageUsage() {
  const { data, error } = await client().rpc('get_storage_usage');
  if (error) throw translateError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return { used_bytes: Number(row?.used_bytes || 0), limit_bytes: Number(row?.limit_bytes || MAX_TOTAL_BYTES) };
}

async function apiRequest(rawUrl, options = {}) {
  const url = new URL(rawUrl, window.location.origin);
  const pathname = decodeURI(url.pathname);
  const method = String(options.method || 'GET').toUpperCase();
  let body = options.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { throw apiError('La solicitud contiene JSON inválido.', 400); }
  }
  const db = client();

  try {
    if (pathname === '/api/session' && method === 'GET') {
      const profile = await activeSessionProfile();
      return { authenticated: Boolean(profile), user: profile ? publicUser(profile) : null };
    }
    if (pathname === '/api/auth/register' && method === 'POST') return await registerAccount(body || {});
    if (pathname === '/api/auth/login' && method === 'POST') {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = typeof body?.password === 'string' ? body.password : '';
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw translateError(apiError('Correo o contraseña incorrectos, o cuenta aún no verificada.', 401));
      const profile = await activeSessionProfile();
      if (!profile) throw apiError('La cuenta todavía no está autorizada. El encargado debe agregarla; la cuenta inicial solo se activa con el correo propietario y correo verificado.', 403);
      return { user: publicUser(profile) };
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const { error } = await db.auth.signOut();
      if (error) throw translateError(error);
      return { ok: true };
    }
    if (pathname === '/api/technicians' && method === 'GET') {
      const profile = await activeSessionProfile();
      if (!profile) throw apiError('Inicia sesión con una cuenta de técnico autorizada.', 401);
      const { data, error } = await db.rpc('get_active_technician_names');
      if (error) throw translateError(error);
      return { technicians: (Array.isArray(data) ? data : []).map((row) => ({ display_name: row.display_name })) };
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      const manager = await activeSessionProfile();
      if (!manager?.is_manager) throw apiError('Solo el encargado puede administrar las cuentas de técnicos.', 403);
      const { data, error } = await db.from('profiles').select('id,email,display_name,active,created_at').eq('is_manager', false).eq('role', 'mechanic').order('created_at', { ascending: false }).limit(500);
      if (error) throw translateError(error);
      return { users: data || [] };
    }
    if (pathname === '/api/admin/users' && method === 'POST') return await inviteTechnician(body || {});
    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && method === 'PATCH') {
      const { data, error } = await db.rpc('set_technician_active', { p_user_id: decodeURIComponent(userMatch[1]), p_active: Boolean(body?.active) });
      if (error) throw translateError(error);
      if (!data) throw apiError('No se encontró una cuenta de técnico administrable.', 404);
      return { ok: true };
    }
    if (pathname === '/api/data' && method === 'GET') return await loadData();
    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch && method === 'PUT') return await saveOrder(body);
    if (pathname === '/api/expenses' && method === 'POST') return await saveExpense(body || {});
    const expenseProofMatch = pathname.match(/^\/api\/expenses\/([^/]+)\/proof$/);
    if (expenseProofMatch && method === 'POST') return await uploadExpenseProof(decodeURIComponent(expenseProofMatch[1]), body);
    if (expenseProofMatch && method === 'DELETE') return await removeExpenseProof(decodeURIComponent(expenseProofMatch[1]));
    const expenseMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch && method === 'DELETE') return await deleteExpense(decodeURIComponent(expenseMatch[1]));
    if (pathname === '/api/events' && method === 'POST') {
      const { data: sessionData, error: sessionError } = await db.auth.getUser();
      if (sessionError || !sessionData?.user) throw apiError('Inicia sesión de nuevo.', 401);
      if (!body?.order_id || !String(body.event_type || '').trim()) throw apiError('El evento debe incluir una orden y un tipo.', 400);
      const { error } = await db.from('service_order_events').insert({
        service_order_id: body.order_id, event_type: String(body.event_type).slice(0, 80), details_json: body.details || {}, actor_id: sessionData.user.id
      });
      if (error) throw translateError(error);
      return { ok: true };
    }
    const photoUploadMatch = pathname.match(/^\/api\/orders\/([^/]+)\/photos$/);
    if (photoUploadMatch && method === 'POST') return await uploadOrderPhoto(decodeURIComponent(photoUploadMatch[1]), body);
    const photoDeleteMatch = pathname.match(/^\/api\/orders\/([^/]+)\/photos\/([^/]+)$/);
    if (photoDeleteMatch && method === 'DELETE') return await removeOrderPhoto(decodeURIComponent(photoDeleteMatch[1]), decodeURIComponent(photoDeleteMatch[2]));
    if (pathname === '/api/storage-usage' && method === 'GET') return await storageUsage();
    throw apiError('Ruta de servicio no encontrada.', 404);
  } catch (error) {
    throw translateError(error);
  }
}

export async function supabaseRequest(url, options) {
  return apiRequest(url, options);
}

export { registerAccount as registerInitialAccount };

export async function getPrivateEvidence(kind, id) {
  return downloadPrivateEvidence(kind, id);
}
