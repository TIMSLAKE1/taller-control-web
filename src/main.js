const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowIso = () => new Date().toISOString();
const localDateTime = (value = new Date()) => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const money = (value) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value || 0));
const fmtDate = (value, options = { dateStyle: 'medium', timeStyle: 'short' }) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('es-MX', options).format(date);
};
const publicDemoBuild = import.meta.env.MODE === 'public-demo';
const cleanTestBuild = import.meta.env.MODE === 'clean-test';
const localMode = publicDemoBuild || cleanTestBuild;
const serverMode = !localMode;
const STORAGE_PREFIX = publicDemoBuild ? 'taller-control.demo' : cleanTestBuild ? 'taller-control.clean-test' : 'taller-control';
const LOCAL_ORDERS_KEY = `${STORAGE_PREFIX}.orders.v1`;
const LOCAL_EXPENSES_KEY = `${STORAGE_PREFIX}.expenses.v1`;
const LOCAL_TEAM_KEY = `${STORAGE_PREFIX}.team.v1`;
const LOCAL_TEAM_NAME_KEY = `${STORAGE_PREFIX}.team-name.v1`;
const STATUSES = ['Borrador', 'Inspección', 'Aprobación', 'En servicio', 'Completa', 'Cancelada'];
const REASONS = ['Mantenimiento', 'Reparación', 'Diagnóstico'];
const FLUID_NAMES = ['Aceite de motor', 'Refrigerante', 'Líquido de frenos', 'Dirección hidráulica', 'Limpiaparabrisas', 'Transmisión'];
const CATEGORIES = ['Refacciones', 'Insumos', 'Servicios externos', 'Herramientas', 'Operación', 'Otro'];
let user = null;
let orders = [];
let expenses = [];
let authorizedUsers = [];
let teamMembers = [];
let localTeamName = 'Equipo de taller';
let activeOrderId = null;
let approvalOrderId = null;
let printOrderId = null;
let toastTimer = null;
let refreshTimer = null;
let installPrompt = null;
let photoDbPromise = null;
let photoUrls = [];

function demoOrder() {
  const id = 'demo-os-0001';
  return {
    id, order_number: 'OS-0001', is_demo: true,
    customer: { name: 'Diana Ejemplo', phone: '5550000100', city: 'Guadalajara', address: 'Calle de Prueba 10', notes: 'Registro ficticio para verificar el flujo de trabajo.' },
    vehicle: { plate: 'TEST-001', vin: 'VIN-DEMO-00000001', make: 'Volkswagen', model: 'Jetta', year: '2021', color: 'Gris', notes: '' },
    received_at: new Date().toISOString(), reason: 'Diagnóstico', technician: '',
    failure_summary: 'Vibración al frenar', reported_issue: 'Prueba ficticia: revisar vibración al frenar a velocidad media.',
    status: 'Inspección', odometer: 68420, fuel_level: '½', physical_notes: 'Datos inventados para probar la captura; sin daños reales.',
    inspection: { fluids: Object.fromEntries(FLUID_NAMES.map((name) => [name, 'Revisar'])) },
    inventory: { accessories: ['Llaves', 'Gato / herramienta'], documents: ['Tarjeta de circulación'], valuables: 'Ninguno declarado (dato ficticio).' },
    evidence: [], work_scope: 'Diagnóstico de vibración en frenado (prueba).', estimate_total: 0,
    approval_status: 'not_requested', approval_channel: '', signature_provider: '', approval_note: '', approval_recorded_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}

function readLocal(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch { return fallback; }
}
function writeLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function getPhotoDb() {
  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('taller-control-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('evidence', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return photoDbPromise;
}
async function putLocalPhoto(key, file) {
  const db = await getPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('evidence', 'readwrite');
    tx.objectStore('evidence').put({ key, blob: file, name: file.name, type: file.type });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function getLocalPhoto(key) {
  const db = await getPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('evidence', 'readonly');
    const request = tx.objectStore('evidence').get(key);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
}
async function deleteLocalPhoto(key) {
  const db = await getPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('evidence', 'readwrite');
    tx.objectStore('evidence').delete(key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}

function lockExpiredSession() {
  if (!serverMode || !user) return;
  user = null;
  clearInterval(refreshTimer);
  showAuth('signin');
  const message = $('#authMessage');
  if (message) message.textContent = 'La sesión venció o fue revocada; vuelve a iniciar sesión.';
}

async function serverRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body !== undefined && body !== null && !(body instanceof Blob) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  } else if (body instanceof Blob) {
    headers.set('Content-Type', body.type || 'application/octet-stream');
    if (body.name) headers.set('X-File-Name', body.name);
  }
  const response = await fetch(url, { ...options, headers, body, credentials: 'same-origin', cache: 'no-store' });
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.error || `Error del servidor (${response.status}).`);
    error.status = response.status;
    if (response.status === 401) lockExpiredSession();
    throw error;
  }
  return result;
}

function startServerRefresh() {
  if (!serverMode || !user) return;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (document.hidden || !user) return;
    try {
      const data = await serverRequest('/api/data');
      orders = data.orders || []; expenses = data.expenses || [];
      setConnection('Servidor SQLite', 'server'); renderAll();
    } catch (error) {
      if (error.status !== 401) setConnection('Sin conexión', 'offline');
    }
  }, 30000);
}

function setConnection(label, type) {
  const el = $('#connectionStatus');
  if (!el) return;
  el.textContent = label;
  el.className = `badge gray connection-indicator ${type}`;
  el.title = type === 'local' ? 'Los cambios se guardan en este navegador.' : type === 'server' ? 'Sesión autenticada; los cambios se guardan en la base SQLite del servidor local.' : 'No hay conexión disponible.';
}
function notify(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}
function setProfile() {
  const name = serverMode && user ? (user.display_name || user.email) : localMode && !publicDemoBuild ? localTeamName : 'Equipo de taller';
  const role = serverMode ? (user ? (user.role === 'manager' ? (user.is_technician ? 'Encargado · Técnico autorizado' : 'Encargado') : 'Técnico mecánico · SQLite local') : 'Sesión cerrada') : publicDemoBuild ? 'Demo ficticia' : 'Prueba limpia · este dispositivo';
  const nameEl = $('.profile-name');
  const roleEl = $('.profile-role');
  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = role;
  const teamButton = $('#openTeamBtn');
  if (teamButton) {
    const canManageUsers = serverMode && user?.role === 'manager';
    const canManageLocalTeam = localMode && !publicDemoBuild;
    teamButton.disabled = !canManageUsers && !canManageLocalTeam;
    teamButton.title = canManageUsers ? 'Administrar cuentas autorizadas del taller' : canManageLocalTeam ? 'Administrar sugerencias locales de equipo' : 'La administración solo está disponible para el encargado del taller.';
  }
  renderTeamUi();
  const bottom = $('.side-bottom');
  if (bottom && user && !$('#signOutBtn')) {
    const tools = document.createElement('div');
    tools.className = 'user-tools';
    tools.innerHTML = '<button type="button" id="signOutBtn">Cerrar sesión</button>';
    bottom.append(tools);
    $('#signOutBtn').addEventListener('click', async () => {
      if (serverMode) await serverRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.reload();
    });
  }
}

function statusClass(status) {
  return ({ 'Inspección': 'blue', 'Aprobación': 'amber', 'En servicio': 'green', 'Completa': 'gray', 'Borrador': 'violet', 'Cancelada': 'coral' })[status] || 'gray';
}
function approvalLabel(order) {
  return ({ not_requested: 'Sin solicitar', pending: 'Pendiente', approved: 'Aprobada', changes_requested: 'Cambios solicitados' })[order.approval_status] || 'Sin solicitar';
}
function orderTitle(order) { return `${order.vehicle?.make || ''} ${order.vehicle?.model || ''}`.trim() || 'Vehículo sin identificar'; }
function orderNumber(order) { return order.order_number || 'Sin folio'; }
function routeOrder(id, view = 'inspection') {
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  activeOrderId = id;
  fillForm(order);
  showView(view);
}
function orderById(id) { return orders.find((order) => order.id === id); }

const backend = {
  async boot() {
    if (localMode) {
      orders = readLocal(LOCAL_ORDERS_KEY, null);
      if (!Array.isArray(orders)) orders = publicDemoBuild ? [demoOrder()] : [];
      if (publicDemoBuild && orders.length === 0) orders = [demoOrder()];
      if (!publicDemoBuild) orders = orders.filter((order) => !order.is_demo && !String(order.id || '').startsWith('demo-'));
      writeLocal(LOCAL_ORDERS_KEY, orders);
      expenses = readLocal(LOCAL_EXPENSES_KEY, []);
      teamMembers = readLocal(LOCAL_TEAM_KEY, []);
      if (!Array.isArray(teamMembers)) teamMembers = [];
      teamMembers = teamMembers.filter((member) => member && typeof member.name === 'string' && member.name.trim()).map((member) => ({ id: member.id || uuid(), name: member.name.trim(), role: String(member.role || '').trim() }));
      localTeamName = readLocal(LOCAL_TEAM_NAME_KEY, 'Equipo de taller');
      if (typeof localTeamName !== 'string' || !localTeamName.trim()) localTeamName = 'Equipo de taller';
      localTeamName = localTeamName.trim();
      setConnection(navigator.onLine ? 'Modo local' : 'Sin conexión', navigator.onLine ? 'local' : 'offline');
      setProfile();
      return true;
    }
    const session = await serverRequest('/api/session');
    user = session.user;
    if (!session.authenticated) {
      showAuth('signin');
      setConnection('Inicia sesión', 'offline');
      return false;
    }
    await this.loadData();
    setConnection('Servidor SQLite', 'server');
    setProfile();
    hideAuth();
    return true;
  },
  async loadData() {
    const data = await serverRequest('/api/data');
    orders = data.orders || [];
    expenses = data.expenses || [];
  },
  async saveOrder(order) {
    order.updated_at = nowIso();
    if (localMode) {
      const index = orders.findIndex((item) => item.id === order.id);
      if (index >= 0) orders[index] = order; else orders.unshift(order);
      writeLocal(LOCAL_ORDERS_KEY, orders);
      return order;
    }
    const result = await serverRequest(`/api/orders/${encodeURIComponent(order.id)}`, { method: 'PUT', body: order });
    Object.assign(order, result.order);
    const index = orders.findIndex((item) => item.id === order.id);
    if (index >= 0) orders[index] = order; else orders.unshift(order);
    return order;
  },
  async saveExpense(expense) {
    if (localMode) {
      expenses.unshift(expense); writeLocal(LOCAL_EXPENSES_KEY, expenses); return expense;
    }
    const result = await serverRequest('/api/expenses', { method: 'POST', body: expense });
    expenses.unshift(result.expense); return result.expense;
  },
  async deleteExpense(id) {
    if (localMode) { expenses = expenses.filter((expense) => expense.id !== id); writeLocal(LOCAL_EXPENSES_KEY, expenses); return; }
    await serverRequest(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    expenses = expenses.filter((expense) => expense.id !== id);
  },
  async logEvent(order, eventType, details = {}) {
    if (localMode) return;
    try { await serverRequest('/api/events', { method: 'POST', body: { order_id: order.id, event_type: eventType, details } }); }
    catch (error) { console.warn('No se pudo guardar el evento de auditoría', error.message); }
  },
  async uploadPhoto(order, file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Cada foto debe pesar 10 MB o menos.');
    const fileId = uuid();
    if (localMode) {
      const localKey = `${order.id}:${fileId}`;
      await putLocalPhoto(localKey, file);
      order.evidence = [...(order.evidence || []), { name: file.name, localKey, created_at: nowIso(), size: file.size, type: file.type }];
    } else {
      const result = await serverRequest(`/api/orders/${encodeURIComponent(order.id)}/photos`, { method: 'POST', body: file });
      order.evidence = [...(order.evidence || []), result.photo];
    }
    await this.saveOrder(order);
  },
  async removePhoto(order, photo) {
    if (localMode) await deleteLocalPhoto(photo.localKey);
    else if (photo.photoId) await serverRequest(`/api/orders/${encodeURIComponent(order.id)}/photos/${encodeURIComponent(photo.photoId)}`, { method: 'DELETE' });
    order.evidence = (order.evidence || []).filter((item) => item !== photo && item.localKey !== photo.localKey && item.path !== photo.path && item.photoId !== photo.photoId);
    await this.saveOrder(order);
  }
};

function showAuth(mode) {
  if (serverMode) document.body.classList.add('server-locked');
  let backdrop = $('#authBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'authBackdrop'; backdrop.className = 'auth-backdrop';
    document.body.append(backdrop);
  }
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = `<section class="auth-panel"><div class="eyebrow"><span class="dot"></span>Acceso al taller · red local</div><h2>Iniciar sesión</h2><p class="intro">Acceso reservado al encargado y a técnicos con cuenta autorizada. No hay registro abierto; solicita acceso al encargado del taller.</p><form id="localAuthForm"><div class="field"><label for="authEmail">Correo electrónico</label><input id="authEmail" type="email" autocomplete="username" required /></div><div class="field"><label for="authPassword">Contraseña</label><input id="authPassword" type="password" autocomplete="current-password" required /></div><div class="auth-actions"><button class="btn" id="authSubmit" type="submit">Entrar</button></div><div id="authMessage" class="auth-error" role="status" aria-live="polite"></div></form></section>`;
  $('#localAuthForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#authMessage');
    const email = $('#authEmail').value.trim(); const password = $('#authPassword').value;
    const button = $('#authSubmit');
    button.disabled = true;
    message.className = 'auth-success'; message.textContent = 'Conectando…';
    try {
      const result = await serverRequest('/api/auth/login', { method: 'POST', body: { email, password } });
      user = result.user;
      await backend.loadData();
      setConnection('Servidor SQLite', 'server');
      setProfile(); hideAuth(); renderAll();
      startServerRefresh();
      if (orders.length) fillForm(orders[0]); else clearForm();
      showView('home'); notify('Sesión iniciada.');
    } catch (error) { message.className = 'auth-error'; message.textContent = error.message || 'No se pudo iniciar sesión.'; }
    finally { button.disabled = false; }
  });
}
function hideAuth() { $('#authBackdrop')?.remove(); document.body.classList.remove('server-locked'); }

function addExtraUi() {
  const receiptActions = $('#view-reception .form-actions');
  if (receiptActions && !$('#workScope')) {
    receiptActions.insertAdjacentHTML('beforebegin', `<section class="form-section"><div class="section-head"><h2 class="section-name">Alcance y estimación</h2><span class="section-optional">SEPARADO DE GASTOS REALES</span></div><div class="extra-fields"><div class="field"><label for="workScope">Trabajo solicitado / propuesta inicial</label><textarea id="workScope" placeholder="Describe el trabajo a revisar o cotizar"></textarea></div><div class="field"><label for="estimateTotal">Estimación (MXN)</label><input id="estimateTotal" type="number" min="0" step="0.01" placeholder="0.00" inputmode="decimal" /></div></div></section>`);
  }
  const continueBtn = $$('#view-reception .form-actions .btn').find((button) => button.textContent.includes('Continuar a inspección'));
  if (continueBtn) { continueBtn.id = 'continueReceptionBtn'; continueBtn.removeAttribute('data-go'); }
  const draftBtn = $$('#view-reception .page-head .btn').find((button) => button.textContent.includes('Guardar borrador'));
  if (draftBtn) { draftBtn.id = 'saveDraftBtn'; draftBtn.removeAttribute('data-toast'); }
  const filterbar = $('#orderList .filterbar');
  if (filterbar && !$('#exportOrdersBtn')) filterbar.insertAdjacentHTML('beforeend', '<button class="btn btn-light btn-small" id="exportOrdersBtn">Exportar CSV</button>');
  if (publicDemoBuild && !$('#resetDemoBtn')) {
    const banner = $('#view-home .demo-banner');
    if (banner) banner.insertAdjacentHTML('afterend', '<button type="button" class="demo-reset" id="resetDemoBtn">Restablecer el registro ficticio de demostración</button>');
  }
  if (cleanTestBuild && !$('#resetTestBtn')) {
    const banner = $('#view-home .demo-banner');
    if (banner) banner.insertAdjacentHTML('afterend', '<button type="button" class="demo-reset" id="resetTestBtn">Reiniciar la prueba y borrar lo capturado</button>');
  }
  if (!$('#expenseModal')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="expenseModal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="expenseTitle"><div class="modal-head"><h2 id="expenseTitle">Registrar gasto real</h2><button class="icon-btn" type="button" id="closeExpense" aria-label="Cerrar">×</button></div><form id="expenseForm"><div class="field-grid"><div class="field"><label for="expenseDate">Fecha</label><input id="expenseDate" type="date" required /></div><div class="field"><label for="expenseCategory">Rubro</label><select id="expenseCategory" required>${CATEGORIES.map((category) => `<option>${escapeHtml(category)}</option>`).join('')}</select></div><div class="field full"><label for="expenseDescription">Descripción</label><input id="expenseDescription" maxlength="160" required placeholder="Ej. Compra de refacciones" /></div><div class="field"><label for="expenseAmount">Importe (MXN)</label><input id="expenseAmount" type="number" min="0.01" step="0.01" inputmode="decimal" required /></div><div class="field"><label for="expenseOrder">Orden relacionada</label><select id="expenseOrder"><option value="">Sin orden</option></select></div></div><div class="modal-actions"><button class="btn btn-light" type="button" id="cancelExpense">Cancelar</button><button class="btn btn-teal" type="submit">Guardar gasto</button></div></form></div></div>`);
}

function setupTeamUi() {
  const profile = $('.side-bottom .profile');
  if (profile && !$('#openTeamBtn')) {
    const button = document.createElement('button');
    button.id = 'openTeamBtn'; button.type = 'button'; button.className = 'profile team-profile';
    button.innerHTML = profile.innerHTML;
    profile.replaceWith(button);
  }
  if (!$('#teamProfileStyles')) document.head.insertAdjacentHTML('beforeend', '<style id="teamProfileStyles">.team-profile{width:100%;border:0;background:transparent;color:inherit;text-align:left;border-radius:12px;cursor:pointer;transition:background .15s}.team-profile:hover:not(:disabled){background:#f6f8f5}.team-profile:disabled{opacity:1;cursor:default}</style>');
  const technician = $('#technician');
  if (technician && !$('#teamMemberSuggestions')) {
    technician.setAttribute('list', 'teamMemberSuggestions');
    technician.insertAdjacentHTML('afterend', '<datalist id="teamMemberSuggestions"></datalist>');
  }
  if (!$('#teamModal')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="teamModal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="teamModalTitle"><div class="modal-head"><h2 id="teamModalTitle">Equipo local</h2><button class="icon-btn" type="button" id="closeTeamModal" aria-label="Cerrar">×</button></div><p>Organiza a las personas que trabajan en el taller y úsalas como sugerencias al asignar un responsable.</p><form id="teamNameForm"><div class="field"><label for="teamNameInput">Nombre del taller o equipo</label><input id="teamNameInput" maxlength="80" required /></div><div class="modal-actions"><button class="btn btn-light" type="submit">Guardar nombre</button></div></form><form id="teamMemberForm" style="margin-top:15px;padding-top:14px;border-top:1px solid var(--line)"><div class="field-grid"><div class="field"><label for="teamMemberName">Nombre del integrante</label><input id="teamMemberName" maxlength="100" required placeholder="Nombre" /></div><div class="field"><label for="teamMemberRole">Función (opcional)</label><input id="teamMemberRole" maxlength="80" placeholder="Ej. Técnico automotriz" /></div></div><div class="modal-actions"><button class="btn btn-teal" type="submit">Agregar al equipo</button></div></form><div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px"><strong style="font-size:10px">Integrantes</strong><span id="teamMemberCount" class="badge gray">0 integrantes</span></div><div id="teamMembersList" style="max-height:190px;overflow:auto;margin-top:8px"></div><div class="callout" style="margin-top:12px"><strong>Solo en este dispositivo:</strong> esta lista no crea cuentas, no controla permisos y no se sincroniza. Los nombres quedan en este navegador; puedes seguir escribiendo cualquier responsable directamente en Recepción.</div></div></div>`);
  setupAuthorizedUsersUi();
  renderTeamUi();
}

function setupAuthorizedUsersUi() {
  if ($('#userAdminModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="userAdminModal"><div class="modal user-admin-modal" role="dialog" aria-modal="true" aria-labelledby="userAdminTitle"><div class="modal-head"><h2 id="userAdminTitle">Usuarios autorizados</h2><button class="icon-btn" type="button" id="closeUserAdmin" aria-label="Cerrar">×</button></div><p>Agrega técnicos con una cuenta propia o desactiva su acceso. No hay registro público ni se envían invitaciones.</p><div class="callout" style="margin-top:10px"><strong>Tu cuenta de encargado también es de técnico autorizado:</strong> puedes usar todas las funciones operativas y no se puede desactivar desde esta pantalla.</div><form id="authorizedUserForm"><div class="field-grid"><div class="field"><label for="authorizedUserName">Nombre del técnico</label><input id="authorizedUserName" maxlength="100" autocomplete="name" required /></div><div class="field"><label for="authorizedUserEmail">Correo electrónico</label><input id="authorizedUserEmail" type="email" maxlength="254" autocomplete="username" required /></div><div class="field"><label for="authorizedUserPassword">Contraseña inicial</label><input id="authorizedUserPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required /><span class="hint">Al menos 12 caracteres.</span></div><div class="field"><label for="authorizedUserPasswordAgain">Confirmar contraseña</label><input id="authorizedUserPasswordAgain" type="password" minlength="12" maxlength="200" autocomplete="new-password" required /></div></div><div class="modal-actions"><button class="btn btn-teal" id="addAuthorizedUserBtn" type="submit">Agregar técnico</button></div><div id="userAdminMessage" class="auth-error" role="status" aria-live="polite"></div></form><div class="user-admin-list-head"><strong>Técnicos</strong><span id="authorizedUserCount" class="badge gray">0 cuentas</span></div><div id="authorizedUsersList" class="user-admin-list"></div><div class="callout" style="margin-top:12px"><strong>Control de acceso:</strong> entrega la contraseña inicial al técnico por un canal privado. Al desactivarlo se revocan sus sesiones; sus registros históricos se conservan.</div></div></div>`);
}

function renderAuthorizedUsers() {
  const list = $('#authorizedUsersList');
  const count = $('#authorizedUserCount');
  if (count) count.textContent = `${authorizedUsers.length} cuenta${authorizedUsers.length === 1 ? '' : 's'}`;
  if (!list) return;
  list.innerHTML = authorizedUsers.length ? authorizedUsers.map((person) => {
    const active = Number(person.active) === 1;
    return `<div class="authorized-user-row"><div class="authorized-user-details"><strong>${escapeHtml(person.display_name)}</strong><span>${escapeHtml(person.email)}</span><small>Creada ${escapeHtml(fmtDate(person.created_at, { dateStyle: 'medium' }))}</small></div><span class="badge ${active ? 'green' : 'gray'}">${active ? 'Activa' : 'Desactivada'}</span><button class="text-btn" type="button" data-toggle-user-active="${escapeHtml(person.id)}" data-next-active="${active ? 'false' : 'true'}">${active ? 'Desactivar' : 'Reactivar'}</button></div>`;
  }).join('') : '<div class="empty-state">Aún no hay técnicos agregados. Las cuentas nuevas podrán iniciar sesión cuando las compartas con ellos.</div>';
}

async function refreshAuthorizedUsers() {
  const result = await serverRequest('/api/admin/users');
  authorizedUsers = Array.isArray(result.users) ? result.users : [];
  renderAuthorizedUsers();
}

async function openUserAdminModal() {
  if (!serverMode || user?.role !== 'manager') return;
  $('#userAdminModal').classList.add('open');
  $('#userAdminMessage').className = 'auth-success';
  $('#userAdminMessage').textContent = 'Cargando cuentas…';
  try {
    await refreshAuthorizedUsers();
    $('#userAdminMessage').textContent = '';
  } catch (error) {
    $('#userAdminMessage').className = 'auth-error';
    $('#userAdminMessage').textContent = error.message;
  }
}

function closeUserAdminModal() { $('#userAdminModal')?.classList.remove('open'); }

async function addAuthorizedUser(event) {
  event.preventDefault();
  if (user?.role !== 'manager') return;
  const password = $('#authorizedUserPassword').value;
  const confirmation = $('#authorizedUserPasswordAgain').value;
  const message = $('#userAdminMessage');
  if (password !== confirmation) {
    message.className = 'auth-error'; message.textContent = 'Las contraseñas no coinciden.'; return;
  }
  const button = $('#addAuthorizedUserBtn');
  button.disabled = true;
  message.className = 'auth-success'; message.textContent = 'Creando cuenta…';
  try {
    await serverRequest('/api/admin/users', { method: 'POST', body: {
      display_name: $('#authorizedUserName').value.trim(),
      email: $('#authorizedUserEmail').value.trim(), password
    } });
    $('#authorizedUserForm').reset();
    await refreshAuthorizedUsers();
    message.className = 'auth-success'; message.textContent = 'Cuenta creada. Comparte la contraseña inicial con el técnico por un canal privado.';
  } catch (error) {
    message.className = 'auth-error'; message.textContent = error.message;
  } finally { button.disabled = false; }
}

async function toggleAuthorizedUser(id, nextActive) {
  const person = authorizedUsers.find((item) => item.id === id);
  if (!person || user?.role !== 'manager') return;
  if (!nextActive && !window.confirm(`¿Desactivar el acceso de ${person.display_name}? Se cerrarán sus sesiones y se conservarán sus registros.`)) return;
  try {
    await serverRequest(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active: nextActive } });
    await refreshAuthorizedUsers();
    notify(nextActive ? 'Cuenta de técnico reactivada.' : 'Cuenta desactivada y sesiones revocadas.');
  } catch (error) {
    $('#userAdminMessage').className = 'auth-error'; $('#userAdminMessage').textContent = error.message;
  }
}

function renderTeamUi() {
  const list = $('#teamMembersList');
  const datalist = $('#teamMemberSuggestions');
  const count = $('#teamMemberCount');
  if (count) count.textContent = `${teamMembers.length} integrante${teamMembers.length === 1 ? '' : 's'}`;
  if (list) list.innerHTML = teamMembers.length ? teamMembers.map((member) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 2px;border-bottom:1px solid var(--line)"><div><strong style="font-size:10px">${escapeHtml(member.name)}</strong><div class="hint">${escapeHtml(member.role || 'Función sin indicar')}</div></div><button class="text-btn" type="button" data-remove-team-member="${escapeHtml(member.id)}" aria-label="Quitar a ${escapeHtml(member.name)}">Quitar</button></div>`).join('') : '<div class="empty-state" style="padding:14px 8px">Aún no hay integrantes. Agrega nombres si quieres usarlos como sugerencias.</div>';
  if (datalist) datalist.innerHTML = teamMembers.map((member) => `<option value="${escapeHtml(member.name)}">${escapeHtml(member.role)}</option>`).join('');
}

function openTeamModal() {
  if (!localMode || publicDemoBuild) return;
  $('#teamNameInput').value = localTeamName;
  renderTeamUi();
  $('#teamModal').classList.add('open');
  $('#teamMemberName').focus();
}
function closeTeamModal() { $('#teamModal')?.classList.remove('open'); }
function saveTeamName(event) {
  event.preventDefault();
  if (!localMode || publicDemoBuild) return;
  const value = $('#teamNameInput').value.trim();
  if (!value) { notify('Escribe el nombre del taller o equipo.'); return; }
  localTeamName = value;
  writeLocal(LOCAL_TEAM_NAME_KEY, localTeamName);
  setProfile();
  notify('Nombre del equipo guardado en este dispositivo.');
}
function saveTeamMember(event) {
  event.preventDefault();
  if (!localMode || publicDemoBuild) return;
  const name = $('#teamMemberName').value.trim();
  const role = $('#teamMemberRole').value.trim();
  if (!name) return;
  if (teamMembers.some((member) => member.name.toLocaleLowerCase('es-MX') === name.toLocaleLowerCase('es-MX'))) {
    notify('Ese integrante ya está en la lista.');
    return;
  }
  teamMembers.push({ id: uuid(), name, role });
  writeLocal(LOCAL_TEAM_KEY, teamMembers);
  renderTeamUi();
  $('#teamMemberForm').reset();
  $('#teamMemberName').focus();
  notify('Integrante agregado al equipo local.');
}
function removeTeamMember(id) {
  teamMembers = teamMembers.filter((member) => member.id !== id);
  writeLocal(LOCAL_TEAM_KEY, teamMembers);
  renderTeamUi();
  notify('Integrante quitado de las sugerencias. Los expedientes existentes no cambian.');
}

function showView(key) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${key}`));
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === key));
  const names = { home: 'Panel general', reception: 'Recepción', inspection: 'Inspección', orders: 'Órdenes de servicio', approval: 'Aprobación del cliente', reports: 'Reportes y gastos' };
  if ($('#breadcrumb')) $('#breadcrumb').textContent = names[key] || 'Panel general';
  $('#sidebar')?.classList.remove('open');
  if ($('#orderList')) $('#orderList').style.display = '';
  if ($('#printArea')) $('#printArea').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function clearForm() {
  activeOrderId = null;
  ['custName','custPhone','custCity','custAddress','custNotes','plate','vin','make','model','year','color','vehicleNotes','failure','reportedIssue','odometer','physicalNotes','valuables','workScope','estimateTotal'].forEach((id) => { const el = $(`#${id}`); if (el) el.value = ''; });
  $('#receivedAt').value = localDateTime();
  $('#reason').value = 'Seleccionar motivo';
  $('#technician').value = '';
  $$('.fuel-option').forEach((el) => el.classList.remove('selected'));
  $$('#accessoriesList input, #documentsList input').forEach((el) => { el.checked = false; });
  $$('.fluid-item select').forEach((el) => { el.value = 'Revisar'; });
  renderSummary(null); renderPhotoGrid(null);
}
function fillForm(order) {
  if (!order) { clearForm(); return; }
  activeOrderId = order.id;
  const fields = {
    custName: order.customer?.name, custPhone: order.customer?.phone, custCity: order.customer?.city, custAddress: order.customer?.address,
    custNotes: order.customer?.notes, plate: order.vehicle?.plate, vin: order.vehicle?.vin, make: order.vehicle?.make, model: order.vehicle?.model,
    year: order.vehicle?.year, color: order.vehicle?.color, vehicleNotes: order.vehicle?.notes, failure: order.failure_summary,
    reportedIssue: order.reported_issue, odometer: order.odometer, physicalNotes: order.physical_notes,
    valuables: order.inventory?.valuables, workScope: order.work_scope, estimateTotal: order.estimate_total
  };
  Object.entries(fields).forEach(([id, value]) => { const el = $(`#${id}`); if (el) el.value = value ?? ''; });
  $('#receivedAt').value = localDateTime(order.received_at || new Date());
  $('#reason').value = order.reason || 'Seleccionar motivo';
  $('#technician').value = order.technician || '';
  $$('.fuel-option').forEach((el) => el.classList.toggle('selected', el.textContent.trim() === order.fuel_level));
  const checkSet = (container, values) => $$('#' + container + ' label').forEach((label) => { const input = $('input', label); input.checked = (values || []).includes(label.textContent.trim()); });
  checkSet('accessoriesList', order.inventory?.accessories);
  checkSet('documentsList', order.inventory?.documents);
  $$('.fluid-item').forEach((label) => {
    const name = label.firstChild.textContent.trim(); const select = $('select', label);
    select.value = order.inspection?.fluids?.[name] || 'Revisar';
  });
  renderSummary(order); renderPhotoGrid(order);
}
function nextOrderNumber() {
  const max = orders.reduce((value, order) => Math.max(value, Number(String(order.order_number || '').replace(/\D/g, '')) || 0), 0);
  return `OS-${String(max + 1).padStart(4, '0')}`;
}
function selectedChecks(container) {
  return $$('#' + container + ' label').filter((label) => $('input', label).checked).map((label) => label.textContent.trim());
}
function readForm(previous = {}) {
  const received = $('#receivedAt').value ? new Date($('#receivedAt').value).toISOString() : nowIso();
  const fluids = Object.fromEntries($$('.fluid-item').map((label) => [label.firstChild.textContent.trim(), $('select', label).value]));
  return {
    ...previous,
    id: previous.id || uuid(), order_number: previous.order_number || nextOrderNumber(), is_demo: Boolean(previous.is_demo),
    customer: { name: $('#custName').value.trim(), phone: $('#custPhone').value.trim(), city: $('#custCity').value.trim(), address: $('#custAddress').value.trim(), notes: $('#custNotes').value.trim() },
    vehicle: { plate: $('#plate').value.trim().toUpperCase(), vin: $('#vin').value.trim(), make: $('#make').value.trim(), model: $('#model').value.trim(), year: $('#year').value.trim(), color: $('#color').value.trim(), notes: $('#vehicleNotes').value.trim() },
    received_at: received, reason: $('#reason').value, technician: $('#technician').value.trim(),
    failure_summary: $('#failure').value.trim(), reported_issue: $('#reportedIssue').value.trim(),
    odometer: Number(String($('#odometer').value).replace(/[^\d]/g, '')) || null,
    fuel_level: $('.fuel-option.selected')?.textContent.trim() || '', physical_notes: $('#physicalNotes').value.trim(),
    inspection: { ...(previous.inspection || {}), fluids },
    inventory: { ...(previous.inventory || {}), accessories: selectedChecks('accessoriesList'), documents: selectedChecks('documentsList'), valuables: $('#valuables').value.trim() },
    evidence: previous.evidence || [], work_scope: $('#workScope').value.trim(), estimate_total: Number($('#estimateTotal').value) || 0,
    status: previous.status || 'Borrador', approval_status: previous.approval_status || 'not_requested',
    approval_channel: previous.approval_channel || '', signature_provider: previous.signature_provider || '', approval_note: previous.approval_note || '', approval_recorded_at: previous.approval_recorded_at || null,
    created_at: previous.created_at || nowIso(), updated_at: nowIso()
  };
}
function validateReception() {
  const missing = [];
  if (!$('#custName').value.trim()) missing.push('nombre del cliente');
  if (!$('#custPhone').value.trim()) missing.push('teléfono');
  if (!$('#plate').value.trim()) missing.push('placas');
  if (!$('#make').value.trim()) missing.push('marca');
  if (!$('#model').value.trim()) missing.push('modelo');
  if (!$('#reason').value || $('#reason').value.includes('Seleccionar')) missing.push('motivo de ingreso');
  if (missing.length) { notify(`Completa: ${missing.join(', ')}.`); return false; }
  return true;
}
async function saveReception(next = 'draft') {
  if (next !== 'draft' && !validateReception()) return null;
  const previous = orderById(activeOrderId) || {};
  const order = readForm(previous);
  if (next === 'draft' && !previous.status) order.status = 'Borrador';
  else if (next === 'inspection' && (!previous.status || previous.status === 'Borrador')) order.status = 'Inspección';
  try {
    await backend.saveOrder(order);
    activeOrderId = order.id;
    await backend.logEvent(order, previous.id ? 'order_updated' : 'order_created', { status: order.status });
    renderAll(); fillForm(order);
    notify(`${orderNumber(order)} guardada.`);
    return order;
  } catch (error) { notify(`No se pudo guardar: ${error.message || 'revisa la conexión y los datos.'}`); return null; }
}
function validateInspection() {
  const missing = [];
  const odometer = Number(String($('#odometer').value).replace(/[^\d]/g, ''));
  if (!$('#odometer').value.trim() || !Number.isFinite(odometer) || odometer < 0) missing.push('kilometraje');
  if (!$('.fuel-option.selected')) missing.push('nivel de combustible');
  if (missing.length) { notify(`Completa la inspección: ${missing.join(' y ')}.`); return false; }
  return true;
}
function renderSummary(order) {
  const summaries = [$('#view-reception .summary-list'), $('#view-inspection .summary-list')].filter(Boolean);
  summaries.forEach((container) => {
    const customer = order?.customer?.name || 'Sin capturar';
    const vehicle = order ? orderTitle(order) : 'Sin capturar';
    const rows = [
      ['Folio', order ? orderNumber(order) : 'Se asigna al guardar'],
      ['Cliente', customer], ['Vehículo', vehicle],
      ['Año / placas', order ? `${order.vehicle?.year || '—'} · ${order.vehicle?.plate || '—'}` : '—'],
      ['Motivo', order?.reason || 'Por seleccionar'], ['Técnico', order?.technician || 'Por asignar']
    ];
    container.innerHTML = rows.map(([label, value]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  });
  const receptionStep = $('#view-reception .workflow-bar');
  if (receptionStep) $$('.wf-step', receptionStep).forEach((step, index) => step.classList.toggle('active', index === 0));
  const inspectionTitle = $('#view-inspection .eyebrow');
  if (inspectionTitle) inspectionTitle.innerHTML = `<span class="dot"></span>${escapeHtml(order ? orderNumber(order) : 'Nueva orden')} · Paso 2 de 4`;
}
function renderDashboard() {
  const active = orders.filter((order) => !['Completa', 'Cancelada'].includes(order.status));
  const pending = orders.filter((order) => order.approval_status === 'pending' || order.status === 'Aprobación');
  const inspections = orders.filter((order) => order.status === 'Inspección');
  const ready = orders.filter((order) => ['Aprobación', 'En servicio', 'Completa'].includes(order.status));
  const values = [active.length, pending.length, inspections.length, ready.length];
  $$('.kpi-value', $('#view-home')).forEach((el, index) => { if (index < values.length) el.textContent = String(values[index]).padStart(2, '0'); });
  const feet = $$('.kpi-foot', $('#view-home'));
  if (feet[0]) feet[0].innerHTML = `<b>${orders.filter((order) => new Date(order.received_at).toDateString() === new Date().toDateString()).length} ingresaron hoy</b> · registros guardados`;
  if (feet[1]) feet[1].innerHTML = '<b>Requieren respuesta</b> · registro interno';
  if (feet[2]) feet[2].textContent = 'Evidencia o revisión por completar';
  if (feet[3]) feet[3].textContent = 'No equivale a una orden firmada';
  const tableBody = $('#view-home .dashboard-grid table tbody');
  const priorities = orders.filter((order) => !['Completa', 'Cancelada'].includes(order.status)).slice(0, 4);
  if (tableBody) tableBody.innerHTML = priorities.length ? priorities.map((order) => {
    const next = order.status === 'Aprobación' ? 'Registrar respuesta' : order.status === 'En servicio' ? 'Continuar servicio' : order.status === 'Completa' ? 'Ver orden' : 'Completar inspección';
    const go = order.status === 'Aprobación' ? 'approval' : order.status === 'En servicio' ? 'orders' : 'inspection';
    return `<tr><td class="primary-cell mono">${escapeHtml(orderNumber(order))}<span class="subcell">${escapeHtml(order.customer?.name || '')}</span></td><td>${escapeHtml(orderTitle(order))}<span class="subcell">${escapeHtml(order.vehicle?.year || '')} · ${escapeHtml(order.vehicle?.plate || '')}</span></td><td><span class="badge ${statusClass(order.status)}">${escapeHtml(next)}</span></td><td>${escapeHtml(order.technician || 'Por asignar')}</td><td><button class="order-click" data-open-order="${escapeHtml(order.id)}" data-target-view="${go}">Abrir →</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-state">Aún no hay órdenes; crea una recepción para comenzar.</td></tr>';
  const counts = $$('.flow-step .step-count', $('#view-home'));
  [orders.filter((o) => !['Cancelada'].includes(o.status)).length, inspections.length, ready.length, pending.length].forEach((value, index) => { if (counts[index]) counts[index].textContent = String(value).padStart(2, '0'); });
  const badge = $('#view-home .dashboard-grid .flow-head .badge');
  if (badge) { badge.textContent = publicDemoBuild ? 'Demo aislada' : cleanTestBuild ? 'Prueba limpia' : 'SQLite local'; badge.className = `badge ${publicDemoBuild ? 'violet' : cleanTestBuild ? 'blue' : 'green'}`; }
  const banner = $('#view-home .demo-banner div');
  if (banner) banner.innerHTML = publicDemoBuild
    ? '<strong>Demostración:</strong> contiene un expediente inventado y separado de los datos operativos. Los cambios de esta demo se quedan en este navegador.'
    : cleanTestBuild
      ? '<strong>Prueba limpia:</strong> no hay registros precargados. Lo que captures se guarda solo en este navegador, separado de los datos habituales; no usa backend ni genera cargos.'
      : localMode
      ? '<strong>Modo local sin costo de servidor:</strong> las órdenes y gastos empiezan vacíos y se guardan solo en este navegador. No se sincronizan con otros dispositivos; puedes exportar listas CSV. Las fotos permanecen en este navegador.'
      : '<strong>Servidor local del taller:</strong> órdenes, gastos y fotos se comparten en la red del taller y se guardan en SQLite. Solo entran técnicos con cuenta autorizada; no requiere Supabase ni servicios de pago.';
  if ($('#resetDemoBtn')) $('#resetDemoBtn').hidden = !publicDemoBuild;
  if ($('#resetTestBtn')) $('#resetTestBtn').hidden = !cleanTestBuild;
  const homeMeta = $('#view-home .dashboard-grid .card-meta');
  if (homeMeta) homeMeta.textContent = 'Atajos a la siguiente acción · órdenes guardadas';
  const homeFoot = $('#view-home .dashboard-grid .table-foot span:first-child');
  if (homeFoot) homeFoot.textContent = orders.length ? 'Órdenes de tu espacio de trabajo.' : 'Todavía no hay órdenes registradas.';
  const priorityCount = $('#view-home .dashboard-grid .table-foot .mono');
  if (priorityCount) priorityCount.textContent = `${String(priorities.length).padStart(2, '0')} prioritarias`;
  const quickApproval = $$('#view-home .quick-sub')[3];
  if (quickApproval) quickApproval.textContent = `${pending.length} pendiente(s)`;
  const badgeCounts = $$('.nav-count');
  if (badgeCounts[0]) badgeCounts[0].textContent = String(active.length).padStart(2, '0');
  if (badgeCounts[1]) badgeCounts[1].textContent = String(inspections.length).padStart(2, '0');
  if (badgeCounts[2]) badgeCounts[2].textContent = String(orders.length).padStart(2, '0');
  if (badgeCounts[3]) { badgeCounts[3].textContent = String(pending.length).padStart(2, '0'); badgeCounts[3].classList.toggle('hot', pending.length > 0); }
  const eyebrow = $('#view-orders .eyebrow');
  if (eyebrow) eyebrow.innerHTML = `<span class="dot"></span>Seguimiento · ${orders.length} ${orders.length === 1 ? 'registro' : 'registros'}`;
}
function renderOrders() {
  const body = $('#ordersTable tbody');
  if (!body) return;
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-state">No hay órdenes. Registra un vehículo para empezar.</td></tr>';
  } else {
    body.innerHTML = orders.map((order) => `<tr data-status="${escapeHtml(order.status)}" data-reason="${escapeHtml(order.reason)}">
      <td class="primary-cell mono">${escapeHtml(orderNumber(order))}<span class="subcell">${escapeHtml(fmtDate(order.received_at))}</span></td>
      <td>${escapeHtml(order.customer?.name || '')}</td><td>${escapeHtml(orderTitle(order))}<span class="subcell">${escapeHtml(order.vehicle?.year || '—')} · ${escapeHtml(order.vehicle?.plate || '—')}</span></td>
      <td>${escapeHtml(order.reason || '—')}</td><td>${escapeHtml(order.technician || 'Por asignar')}</td>
      <td><select class="status-select" data-order-status="${escapeHtml(order.id)}" aria-label="Estado de ${escapeHtml(orderNumber(order))}">${STATUSES.map((status) => `<option${status === order.status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select></td>
      <td><div class="table-action"><button class="order-click show-pdf" data-open-pdf="${escapeHtml(order.id)}">Vista PDF</button><button class="order-click" data-open-order="${escapeHtml(order.id)}" data-target-view="reception">Editar</button></div></td></tr>`).join('');
  }
  filterOrders();
  const approvalSelect = $('#approvalOrder');
  if (approvalSelect) {
    const current = approvalOrderId;
    approvalSelect.innerHTML = orders.length ? orders.map((order) => `<option value="${escapeHtml(order.id)}">${escapeHtml(orderNumber(order))} · ${escapeHtml(order.customer?.name || '')} · ${escapeHtml(orderTitle(order))}</option>`).join('') : '<option value="">No hay órdenes</option>';
    approvalSelect.disabled = orders.length === 0;
    approvalOrderId = orderById(current) ? current : (orders[0]?.id || null);
    if (approvalOrderId) approvalSelect.value = approvalOrderId;
    renderApprovalSummary();
  }
}
function filterOrders() {
  const query = ($('#orderSearch')?.value || '').trim().toLowerCase();
  const status = $('#stateFilter')?.value || '';
  const reason = $('#reasonFilter')?.value || '';
  let count = 0;
  $$('#ordersTable tbody tr').forEach((row) => {
    const show = row.innerText.toLowerCase().includes(query) && (!status || row.dataset.status === status) && (!reason || row.dataset.reason === reason);
    row.style.display = show ? '' : 'none'; if (show && row.dataset.status) count++;
  });
  if ($('#resultCount')) $('#resultCount').textContent = `${String(count).padStart(2, '0')} visibles`;
}
async function changeOrderStatus(id, status) {
  const order = orderById(id);
  if (!order || !STATUSES.includes(status)) return;
  if (status === 'Aprobación' && order.approval_status !== 'pending') {
    notify('Registra primero la solicitud en la sección Aprobación del cliente.');
    renderOrders();
    return;
  }
  if (status === 'En servicio' && order.approval_status !== 'approved') {
    notify('Registra la aprobación recibida antes de iniciar el servicio.');
    renderOrders();
    return;
  }
  if (status === 'Completa' && order.status !== 'En servicio') {
    notify('Marca la orden En servicio antes de completarla.');
    renderOrders();
    return;
  }
  const updated = { ...order, status, updated_at: nowIso() };
  try {
    await backend.saveOrder(updated);
    await backend.logEvent(updated, 'status_changed', { from: order.status, to: status });
    renderAll();
    notify(`${orderNumber(updated)} · estado actualizado a ${status}.`);
  } catch (error) {
    renderOrders();
    notify(`No se pudo actualizar el estado: ${error.message || 'revisa la conexión.'}`);
  }
}

function renderApprovalSummary() {
  const order = orderById(approvalOrderId);
  if (!order) {
    const eyebrow = $('#view-approval .eyebrow');
    if (eyebrow) eyebrow.innerHTML = '<span class="dot"></span>Sin orden seleccionada';
    const summary = $('#view-approval .summary-list');
    if (summary) summary.innerHTML = '<div class="empty-state">Registra una recepción para habilitar el flujo de aprobación.</div>';
    const status = $('#approvalPreviewStatus');
    if (status) { status.textContent = 'Sin órdenes'; status.className = 'badge gray'; }
    const state = $('#view-approval .approval-state');
    if (state) {
      state.querySelector('strong').textContent = 'No hay una orden para revisar';
      state.querySelector('span:not(.big-icon)').textContent = 'Cuando exista una orden, aquí podrás registrar la solicitud y la respuesta recibida.';
    }
    if ($('#simulateApproval')) $('#simulateApproval').disabled = true;
    return;
  }
  if ($('#simulateApproval')) $('#simulateApproval').disabled = false;
  const eyebrow = $('#view-approval .eyebrow');
  if (eyebrow) eyebrow.innerHTML = `<span class="dot"></span>${escapeHtml(orderNumber(order))} · Paso 4 de 4`;
  const summary = $('#view-approval .summary-list');
  if (summary) summary.innerHTML = [
    ['Folio', orderNumber(order)], ['Cliente', order.customer?.name || 'Sin nombre'], ['Vehículo', `${orderTitle(order)} · ${order.vehicle?.year || '—'}`],
    ['Trabajo', order.reason || 'Sin motivo'], ['Canal', order.approval_channel || 'Por acordar'], ['Proveedor de firma', order.signature_provider || 'No definido']
  ].map(([a, b]) => `<div class="summary-row"><span>${escapeHtml(a)}</span><b>${escapeHtml(b)}</b></div>`).join('');
  const status = $('#approvalPreviewStatus');
  if (status) {
    status.textContent = approvalLabel(order);
    status.className = `badge ${order.approval_status === 'approved' ? 'green' : order.approval_status === 'changes_requested' ? 'coral' : order.approval_status === 'pending' ? 'amber' : 'gray'}`;
  }
  if ($('#signatureProvider')) $('#signatureProvider').value = order.signature_provider || 'Por definir con el cliente';
  $('#approvalNote').value = order.approval_note || '';
  $$('input[name="channel"]').forEach((input) => { input.checked = input.parentElement.textContent.trim() === order.approval_channel; });
  const state = $('#view-approval .approval-state');
  if (state) {
    const titles = { not_requested: 'Sin solicitud registrada', pending: 'Solicitud registrada en el taller', approved: 'Aprobación registrada internamente', changes_requested: 'Cambios registrados' };
    const copies = { not_requested: 'Selecciona el canal y guarda la solicitud cuando la hayas compartido por fuera.', pending: 'El taller puede registrar aquí la respuesta recibida.', approved: 'No se capturó firma electrónica ni se envió comunicación.', changes_requested: 'Actualiza el alcance y vuelve a solicitar autorización.' };
    state.querySelector('strong').textContent = titles[order.approval_status] || titles.not_requested;
    state.querySelector('span:not(.big-icon)').textContent = copies[order.approval_status] || copies.not_requested;
  }
  if (!$('#approvalDisclaimer')) $('#view-approval .approval-grid .approval-card').insertAdjacentHTML('beforeend', '<div id="approvalDisclaimer" class="approval-disclaimer">Registro interno del taller. No envía mensajes, no firma por el cliente y no sustituye asesoría sobre validez legal.</div>');
}
function renderAll() {
  renderDashboard(); renderOrders(); renderExpenses();
  const selected = orderById(activeOrderId);
  renderSummary(selected || null);
  if (selected) renderPhotoGrid(selected);
}

function openNewReception() { clearForm(); showView('reception'); }
function openNextInspection() {
  const order = orders.find((item) => ['Inspección', 'Borrador'].includes(item.status));
  if (order) routeOrder(order.id, 'inspection'); else openNewReception();
}
function handleNavigation(event) {
  const openOrder = event.target.closest('[data-open-order]');
  if (openOrder) { routeOrder(openOrder.dataset.openOrder, openOrder.dataset.targetView || 'inspection'); return; }
  const openPdf = event.target.closest('[data-open-pdf]');
  if (openPdf) { showView('orders'); openPdfOrder(openPdf.dataset.openPdf); return; }
  const go = event.target.closest('[data-go]');
  if (go) {
    const key = go.dataset.go;
    if (key === 'reception') { openNewReception(); return; }
    if (key === 'inspection') { openNextInspection(); return; }
    if (key === 'approval' && !approvalOrderId) approvalOrderId = orders[0]?.id || null;
    showView(key); return;
  }
  const nav = event.target.closest('[data-view]');
  if (nav) {
    const key = nav.dataset.view;
    if (key === 'reception') { if (activeOrderId && orderById(activeOrderId)) { fillForm(orderById(activeOrderId)); showView(key); } else openNewReception(); return; }
    if (key === 'inspection' && !activeOrderId) { openNextInspection(); return; }
    if (key === 'approval' && !approvalOrderId) approvalOrderId = orders[0]?.id || null;
    showView(key);
  }
}

async function openPdfOrder(id) {
  const order = orderById(id);
  if (!order) return;
  printOrderId = id;
  const photos = await Promise.all((order.evidence || []).slice(0, 6).map(async (photo) => ({ photo, url: await photoUrl(photo).catch(() => '') })));
  const evidenceMarkup = photos.filter((item) => item.url).map((item, index) => `<div><img class="pdf-photo" src="${item.url}" alt="Evidencia ${index + 1}"><span class="hint">${escapeHtml(item.photo.name || `Foto ${index + 1}`)}</span></div>`).join('');
  const line = (a, b) => `<div class="pdf-line"><span>${escapeHtml(a)}</span><b>${escapeHtml(b || 'Sin capturar')}</b></div>`;
  const fluidText = Object.entries(order.inspection?.fluids || {}).map(([name, value]) => `${name}: ${value}`).join(' · ') || 'Pendiente';
  const inv = order.inventory || {};
  $('.pdf-paper').innerHTML = `<div class="pdf-top"><div><div class="pdf-brand">Taller Control</div><div class="pdf-sub">Recepción de vehículo · ${serverMode ? 'servidor SQLite del taller' : 'registro local'}</div></div><div class="pdf-folio"><strong>${escapeHtml(orderNumber(order))}</strong><span>${escapeHtml(fmtDate(order.received_at))}</span></div></div><h2 class="pdf-title">Orden de recepción y servicio</h2><div class="pdf-intro">Registro de la información proporcionada al ingreso y condición documentada del vehículo.</div><div class="preview-checks" style="margin-top:12px"><span class="badge ${order.is_demo ? 'amber' : 'green'}">${order.is_demo ? 'Prueba ficticia' : 'Registro guardado'}</span><span class="badge ${statusClass(order.status)}">${escapeHtml(order.status)}</span><span class="badge blue">Evidencia ${(order.evidence || []).length} fotos</span></div><div class="pdf-grid"><section class="pdf-box"><h3>Cliente</h3>${line('Nombre', order.customer?.name)}${line('Teléfono', order.customer?.phone)}${line('Dirección', order.customer?.address)}${line('Ciudad', order.customer?.city)}${line('Observaciones', order.customer?.notes)}</section><section class="pdf-box"><h3>Vehículo</h3>${line('Marca / modelo', orderTitle(order))}${line('Año / color', `${order.vehicle?.year || ''} · ${order.vehicle?.color || ''}`)}${line('Placas', order.vehicle?.plate)}${line('VIN', order.vehicle?.vin)}${line('Observaciones', order.vehicle?.notes)}</section><section class="pdf-box"><h3>Ingreso y lecturas</h3>${line('Motivo', order.reason)}${line('Técnico', order.technician || 'Por asignar')}${line('Kilometraje', order.odometer ? `${Number(order.odometer).toLocaleString('es-MX')} km` : '')}${line('Combustible', order.fuel_level)}</section><section class="pdf-box"><h3>Falla y condición física</h3>${line('Falla según cliente', order.reported_issue || order.failure_summary)}${line('Daños / observaciones', order.physical_notes)}</section></div><div class="pdf-notes"><b>Fluidos:</b> ${escapeHtml(fluidText)}</div><div class="pdf-notes"><b>Accesorios:</b> ${escapeHtml((inv.accessories || []).join(', ') || 'Ninguno marcado')}<br><b>Documentos:</b> ${escapeHtml((inv.documents || []).join(', ') || 'Ninguno marcado')}<br><b>Objetos declarados:</b> ${escapeHtml(inv.valuables || 'Sin declarar')}<br><b>Trabajo propuesto:</b> ${escapeHtml(order.work_scope || 'Sin definir')}<br><b>Estimación:</b> ${escapeHtml(money(order.estimate_total))}</div>${evidenceMarkup ? `<div class="print-evidence">${evidenceMarkup}</div>` : '<div class="pdf-notes"><b>Evidencia fotográfica:</b> No se adjuntaron fotografías.</div>'}<div class="pdf-signatures"><div class="signature">Entrega del vehículo · nombre y firma</div><div class="signature">Recepción en taller · nombre y firma</div></div><div class="pdf-disclaimer">Formato de control interno. Las firmas impresas requieren firma manuscrita; el registro digital no representa una firma electrónica ni una aprobación del cliente.</div>`;
  $('#orderList').style.display = 'none'; $('#printArea').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderPhotoGrid(order) {
  const grid = $('#photoGrid');
  if (!grid) return;
  photoUrls.forEach((url) => URL.revokeObjectURL(url)); photoUrls = [];
  if (!order) {
    grid.innerHTML = '<div class="photo-slot"><div>Guarda la recepción antes de adjuntar evidencia.</div></div><button type="button" class="photo-slot add" data-photo-add><div>＋<br>Agregar foto</div></button>';
    return;
  }
  const images = await Promise.all((order.evidence || []).map(async (photo, index) => {
    const url = await photoUrl(photo).catch(() => '');
    if (!url) return '';
    if (url.startsWith('blob:')) photoUrls.push(url);
    return `<div class="photo-slot evidence-card"><button class="evidence-remove" type="button" data-remove-photo="${index}" aria-label="Eliminar foto">×</button><img src="${url}" alt="${escapeHtml(photo.name || `Evidencia ${index + 1}`)}"><span>${escapeHtml(photo.name || `Foto ${index + 1}`)}</span></div>`;
  }));
  grid.innerHTML = `${images.join('')}<button type="button" class="photo-slot add" data-photo-add><div>＋<br>Agregar foto</div></button>${order.evidence?.length ? '' : '<div class="photo-slot"><div>Frente · laterales · daños<br><b>Documenta lo visible</b></div></div>'}`;
}
async function photoUrl(photo) {
  if (photo.localKey) {
    const blob = await getLocalPhoto(photo.localKey);
    return blob ? URL.createObjectURL(blob) : '';
  }
  if (photo.photoId && serverMode) return `/api/evidence/${encodeURIComponent(photo.photoId)}`;
  return '';
}
async function addPhotos(files) {
  let order = orderById(activeOrderId);
  if (!order) {
    order = await saveReception('inspection');
    if (!order) { $('#photoInput').value = ''; return; }
  } else {
    const current = readForm(order);
    await backend.saveOrder(current); order = current; activeOrderId = current.id;
  }
  const selected = [...files].filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 6 - (order.evidence || []).length));
  if (!selected.length) { notify('Se aceptan imágenes; máximo 6 fotos por orden.'); return; }
  try {
    for (const file of selected) await backend.uploadPhoto(order, file);
    renderAll(); await renderPhotoGrid(order); notify(`${selected.length} foto(s) guardada(s).`);
  } catch (error) { notify(`No se pudo guardar la foto: ${error.message}`); }
  $('#photoInput').value = '';
}

function renderExpenses() {
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const month = new Date();
  const monthly = expenses.filter((expense) => {
    const date = new Date(`${expense.expense_date}T12:00:00`);
    return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
  }).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const avg = expenses.length ? total / expenses.length : 0;
  const kpis = $('#expenseKpis');
  if (kpis) kpis.innerHTML = `<article class="card mini-kpi"><div class="kpi-label">Acumulado</div><div class="kpi-value">${escapeHtml(money(total))}</div><div class="kpi-foot">${expenses.length} gasto(s) registrado(s)</div></article><article class="card mini-kpi"><div class="kpi-label">Este mes</div><div class="kpi-value">${escapeHtml(money(monthly))}</div><div class="kpi-foot">Según la fecha del gasto</div></article><article class="card mini-kpi"><div class="kpi-label">Promedio por gasto</div><div class="kpi-value">${escapeHtml(money(avg))}</div><div class="kpi-foot">Solo movimientos capturados</div></article>`;
  const body = $('#expensesBody');
  const empty = $('#expensesEmpty');
  if (!body) return;
  body.innerHTML = expenses.map((expense) => {
    const linked = orders.find((order) => order.id === expense.service_order_id);
    return `<tr><td>${escapeHtml(expense.expense_date)}</td><td>${escapeHtml(expense.description)}</td><td>${escapeHtml(expense.category)}</td><td>${escapeHtml(linked ? orderNumber(linked) : '—')}</td><td class="expense-amount">${escapeHtml(money(expense.amount))}</td><td><button class="order-click" data-delete-expense="${escapeHtml(expense.id)}">Eliminar</button></td></tr>`;
  }).join('');
  if (empty) empty.hidden = expenses.length > 0;
  const orderSelect = $('#expenseOrder');
  if (orderSelect) {
    const value = orderSelect.value;
    orderSelect.innerHTML = '<option value="">Sin orden</option>' + orders.map((order) => `<option value="${escapeHtml(order.id)}">${escapeHtml(orderNumber(order))} · ${escapeHtml(order.customer?.name || '')}</option>`).join('');
    if (orders.some((order) => order.id === value)) orderSelect.value = value;
  }
}
function openExpenseModal() {
  $('#expenseDate').value = new Date().toISOString().slice(0, 10);
  $('#expenseForm').reset(); $('#expenseDate').value = new Date().toISOString().slice(0, 10);
  $('#expenseModal').classList.add('open'); $('#expenseDescription').focus();
}
function closeExpenseModal() { $('#expenseModal').classList.remove('open'); }
async function saveExpense(event) {
  event.preventDefault();
  const expense = {
    id: uuid(), expense_date: $('#expenseDate').value, category: $('#expenseCategory').value,
    description: $('#expenseDescription').value.trim(), amount: Number($('#expenseAmount').value), service_order_id: $('#expenseOrder').value || null
  };
  if (!expense.description || expense.amount <= 0) { notify('Captura descripción e importe mayor que cero.'); return; }
  try { await backend.saveExpense(expense); renderExpenses(); closeExpenseModal(); notify('Gasto registrado.'); }
  catch (error) { notify(`No se pudo registrar: ${error.message}`); }
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function downloadCsv(filename, rows) {
  const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
function exportOrders() {
  const rows = [['Folio','Fecha','Cliente','Teléfono','Vehículo','Año','Placas','Motivo','Técnico','Estado','Estimación MXN']];
  orders.forEach((order) => rows.push([orderNumber(order), fmtDate(order.received_at), order.customer?.name, order.customer?.phone, orderTitle(order), order.vehicle?.year, order.vehicle?.plate, order.reason, order.technician, order.status, order.estimate_total]));
  downloadCsv('taller-control-ordenes.csv', rows);
}
function exportExpenses() {
  const rows = [['Fecha','Descripción','Categoría','Orden','Importe MXN']];
  expenses.forEach((expense) => rows.push([expense.expense_date, expense.description, expense.category, orderNumber(orders.find((order) => order.id === expense.service_order_id) || {}), expense.amount]));
  downloadCsv('taller-control-gastos.csv', rows);
}

async function saveInspection() {
  const current = orderById(activeOrderId);
  if (!current) { notify('Primero crea o abre una recepción.'); openNewReception(); return; }
  if (!validateInspection()) return;
  const order = readForm(current);
  order.status = current.status === 'Borrador' ? 'Inspección' : current.status;
  try {
    await backend.saveOrder(order); await backend.logEvent(order, 'inspection_saved', { odometer: order.odometer, evidence_count: order.evidence.length });
    activeOrderId = order.id; renderAll(); fillForm(order); notify('Inspección guardada.');
  } catch (error) { notify(`No se pudo guardar la inspección: ${error.message}`); }
}
async function reviewOrder() {
  if (!validateInspection()) return;
  let order = orderById(activeOrderId);
  if (!order) order = await saveReception('inspection');
  else {
    order = readForm(order);
    try { await backend.saveOrder(order); renderAll(); } catch (error) { notify(`No se pudo guardar: ${error.message}`); return; }
  }
  if (order) { showView('orders'); openPdfOrder(order.id); }
}

function collectChannel() { return $('input[name="channel"]:checked')?.parentElement.textContent.trim() || ''; }
async function openApprovalRequest() {
  const order = orderById(approvalOrderId);
  if (!order) { notify('No hay una orden para seleccionar.'); return; }
  const channel = collectChannel();
  if (!channel) { notify('Selecciona el canal acordado con el cliente.'); return; }
  order.approval_status = 'pending'; order.approval_channel = channel;
  order.signature_provider = $('#signatureProvider').value.includes('Por definir') ? '' : $('#signatureProvider').value;
  order.approval_note = $('#approvalNote').value.trim(); order.approval_recorded_at = nowIso(); order.status = 'Aprobación';
  try {
    await backend.saveOrder(order); await backend.logEvent(order, 'approval_request_recorded', { channel, provider: order.signature_provider });
    renderAll(); renderApprovalSummary();
    $('#modalTitle').textContent = 'Solicitud registrada internamente';
    $('#modalText').textContent = 'Se guardó el registro para esta orden. No se envió correo ni WhatsApp y no se generó una firma electrónica.';
    $('#clientOrderSummary').innerHTML = `<strong>${escapeHtml(orderNumber(order))} · ${escapeHtml(orderTitle(order))}</strong><br>${escapeHtml(order.customer?.name || '')}<br>Canal acordado: ${escapeHtml(channel)}<br>Estado: Pendiente de respuesta`;
    $('#approveDemo').textContent = 'Registrar aprobación recibida'; $('#requestChangesDemo').textContent = 'Registrar cambios solicitados';
    $('#modalBackdrop').classList.add('open');
  } catch (error) { notify(`No se pudo registrar: ${error.message}`); }
}
async function recordDecision(approved) {
  const order = orderById(approvalOrderId);
  if (!order) return;
  order.approval_status = approved ? 'approved' : 'changes_requested';
  order.approval_recorded_at = nowIso();
  order.status = approved ? 'En servicio' : 'Aprobación';
  try {
    await backend.saveOrder(order);
    await backend.logEvent(order, approved ? 'approval_recorded' : 'changes_recorded', { channel: order.approval_channel, note: order.approval_note });
    renderAll(); renderApprovalSummary();
    $('#modalText').textContent = approved ? 'Se registró internamente una aprobación recibida. Esto no constituye una firma electrónica ni prueba de identidad.' : 'Se registró internamente que el cliente pidió cambios. Actualiza la propuesta antes de iniciar el servicio.';
    notify(approved ? 'Aprobación registrada en el expediente.' : 'Solicitud de cambios registrada.');
    setTimeout(() => $('#modalBackdrop').classList.remove('open'), 1200);
  } catch (error) { notify(`No se pudo registrar la respuesta: ${error.message}`); }
}

function registerEvents() {
  document.addEventListener('click', handleNavigation);
  $('#openTeamBtn')?.addEventListener('click', () => {
    if (serverMode && user?.role === 'manager') openUserAdminModal();
    else openTeamModal();
  });
  $('#closeTeamModal')?.addEventListener('click', closeTeamModal);
  $('#teamModal')?.addEventListener('click', (event) => { if (event.target === $('#teamModal')) closeTeamModal(); });
  $('#teamNameForm')?.addEventListener('submit', saveTeamName);
  $('#teamMemberForm')?.addEventListener('submit', saveTeamMember);
  $('#closeUserAdmin')?.addEventListener('click', closeUserAdminModal);
  $('#userAdminModal')?.addEventListener('click', (event) => { if (event.target === $('#userAdminModal')) closeUserAdminModal(); });
  $('#authorizedUserForm')?.addEventListener('submit', addAuthorizedUser);
  $('#authorizedUsersList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-user-active]');
    if (button) toggleAuthorizedUser(button.dataset.toggleUserActive, button.dataset.nextActive === 'true');
  });
  $('#teamMembersList')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-team-member]');
    if (remove) removeTeamMember(remove.dataset.removeTeamMember);
  });
  $('#menuBtn')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#searchBtn')?.addEventListener('click', () => { showView('orders'); setTimeout(() => $('#orderSearch')?.focus(), 120); });
  $('#notifyBtn')?.addEventListener('click', () => { approvalOrderId = orders.find((order) => order.approval_status === 'pending')?.id || orders[0]?.id || null; renderApprovalSummary(); showView('approval'); notify(`${orders.filter((order) => order.approval_status === 'pending').length} aprobación(es) pendiente(s).`); });
  $('#saveDraftBtn')?.addEventListener('click', () => saveReception('draft'));
  $('#continueReceptionBtn')?.addEventListener('click', async () => { const order = await saveReception('inspection'); if (order) showView('inspection'); });
  $('#reviewOrderBtn')?.addEventListener('click', reviewOrder);
  $('#backToOrders')?.addEventListener('click', () => { $('#printArea').style.display = 'none'; $('#orderList').style.display = 'block'; });
  $('#printBtn')?.addEventListener('click', () => window.print());
  $('#photoAddBtn')?.addEventListener('click', () => $('#photoInput').click());
  $('#photoInput')?.addEventListener('change', (event) => addPhotos(event.target.files));
  $$('.fuel-option').forEach((button) => button.addEventListener('click', () => { $$('.fuel-option').forEach((el) => el.classList.remove('selected')); button.classList.add('selected'); }));
  $('#ordersTable')?.addEventListener('change', (event) => {
    const statusSelect = event.target.closest('[data-order-status]');
    if (statusSelect) changeOrderStatus(statusSelect.dataset.orderStatus, statusSelect.value);
  });
  ['orderSearch', 'stateFilter', 'reasonFilter'].forEach((id) => $(`#${id}`)?.addEventListener('input', filterOrders));
  $('#approvalOrder')?.addEventListener('change', () => { approvalOrderId = $('#approvalOrder').value; renderApprovalSummary(); });
  $('#toApprovalBtn')?.addEventListener('click', () => { approvalOrderId = printOrderId || activeOrderId; renderApprovalSummary(); showView('approval'); });
  $('#simulateApproval')?.addEventListener('click', openApprovalRequest);
  $('#approveDemo')?.addEventListener('click', () => recordDecision(true));
  $('#requestChangesDemo')?.addEventListener('click', () => recordDecision(false));
  $('#closeModal')?.addEventListener('click', () => $('#modalBackdrop').classList.remove('open'));
  $('#modalBackdrop')?.addEventListener('click', (event) => { if (event.target === $('#modalBackdrop')) $('#modalBackdrop').classList.remove('open'); });
  $('#addExpenseBtn')?.addEventListener('click', openExpenseModal);
  $('#expenseForm')?.addEventListener('submit', saveExpense);
  $('#closeExpense')?.addEventListener('click', closeExpenseModal);
  $('#cancelExpense')?.addEventListener('click', closeExpenseModal);
  $('#expenseModal')?.addEventListener('click', (event) => { if (event.target === $('#expenseModal')) closeExpenseModal(); });
  $('#exportOrdersBtn')?.addEventListener('click', exportOrders);
  $('#exportExpensesBtn')?.addEventListener('click', exportExpenses);
  $('#resetDemoBtn')?.addEventListener('click', () => {
    if (!publicDemoBuild) { notify('El restablecimiento solo está disponible en la demo ficticia.'); return; }
    if (!window.confirm('Esto restablecerá solo los datos aislados de esta demo en este navegador. ¿Continuar?')) return;
    const sample = demoOrder();
    writeLocal(LOCAL_ORDERS_KEY, [sample]); writeLocal(LOCAL_EXPENSES_KEY, []); orders = [sample]; expenses = []; activeOrderId = null; approvalOrderId = sample.id; renderAll(); notify('Demo ficticia restablecida.');
  });
  $('#resetTestBtn')?.addEventListener('click', async () => {
    if (!cleanTestBuild || !window.confirm('Esto borrará las órdenes, gastos, fotos y equipo local creados en esta prueba, sin tocar los datos habituales. ¿Continuar?')) return;
    try {
      const photoKeys = orders.flatMap((order) => order.evidence || []).map((photo) => photo.localKey).filter(Boolean);
      await Promise.all(photoKeys.map(deleteLocalPhoto));
      orders = []; expenses = [];
      writeLocal(LOCAL_ORDERS_KEY, orders); writeLocal(LOCAL_EXPENSES_KEY, expenses);
      teamMembers = []; localTeamName = 'Equipo de taller';
      writeLocal(LOCAL_TEAM_KEY, teamMembers); writeLocal(LOCAL_TEAM_NAME_KEY, localTeamName);
      activeOrderId = null; approvalOrderId = null;
      clearForm(); setProfile(); renderAll(); showView('home'); notify('Prueba limpia: se borraron los datos capturados y el equipo local.');
    } catch (error) { notify(`No se pudieron borrar los datos de prueba: ${error.message || 'intenta de nuevo.'}`); }
  });
  document.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-photo-add]');
    if (add) { $('#photoInput').click(); return; }
    const remove = event.target.closest('[data-remove-photo]');
    if (remove) {
      const order = orderById(activeOrderId); const photo = order?.evidence?.[Number(remove.dataset.removePhoto)];
      if (!photo || !window.confirm('¿Eliminar esta evidencia de la orden?')) return;
      try { await backend.removePhoto(order, photo); renderAll(); notify('Evidencia eliminada.'); } catch (error) { notify(`No se pudo eliminar: ${error.message}`); }
      return;
    }
    const deleteExpense = event.target.closest('[data-delete-expense]');
    if (deleteExpense) {
      if (!window.confirm('¿Eliminar este gasto del registro?')) return;
      try { await backend.deleteExpense(deleteExpense.dataset.deleteExpense); renderExpenses(); notify('Gasto eliminado.'); } catch (error) { notify(`No se pudo eliminar: ${error.message}`); }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { $('#modalBackdrop')?.classList.remove('open'); $('#expenseModal')?.classList.remove('open'); closeTeamModal(); closeUserAdminModal(); $('#sidebar')?.classList.remove('open'); }
  });
  window.addEventListener('online', () => { if (localMode) setConnection('Modo local', 'local'); });
  window.addEventListener('offline', () => setConnection('Sin conexión', 'offline'));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event; const button = $('#installBtn'); if (button) button.hidden = false;
  });
  $('#installBtn')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installBtn').hidden = true;
  });
}
function updateStaticText() {
  $('#topDate').textContent = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date());
  const footer = $('.footer-note');
  if (footer) footer.textContent = publicDemoBuild ? 'DEMO AISLADA · DATOS FICTICIOS · SIN SERVICIOS EXTERNOS' : cleanTestBuild ? 'PRUEBA LIMPIA · SIN DATOS PRECARGADOS · ALMACENAMIENTO LOCAL SEPARADO' : 'TALLER CONTROL · SQLITE LOCAL · ACCESO SOLO PARA TÉCNICOS';
  $('#view-orders .page-sub').textContent = 'Busca, filtra y abre expedientes; imprime o guarda la orden como PDF.';
  const demoNote = $('#view-orders .demo-banner div');
  if (demoNote) demoNote.innerHTML = '<strong>Orden imprimible:</strong> genera una vista del expediente actual. La impresión contiene espacios de firma manuscrita; no es una firma electrónica.';
  const approvalIntro = $('#view-approval .page-sub');
  if (approvalIntro) approvalIntro.textContent = 'Registra solicitud y respuesta recibida; el sistema no envía mensajes ni firma por el cliente.';
  $('#simulateApproval').textContent = 'Registrar solicitud interna';
  const ordersFoot = $('#view-orders .table-foot span:first-child');
  if (ordersFoot) ordersFoot.textContent = localMode ? 'Datos locales de este navegador.' : 'Órdenes compartidas en la base SQLite local.';
  const sideNote = $('.side-note p');
  if (sideNote) sideNote.textContent = localMode ? 'Recepción, inspección, órdenes, aprobación interna y gastos; guardados en este navegador.' : 'Órdenes, gastos y evidencia compartidos en SQLite dentro de la red local del taller.';
  const storageCallout = $$('#view-reception .summary-card .callout').find((item) => item.textContent.includes('Almacenamiento local'));
  if (storageCallout && serverMode) storageCallout.innerHTML = '<strong>Almacenamiento del taller:</strong> esta recepción se comparte con las demás sesiones autorizadas en SQLite local.';
}

async function start() {
  if (serverMode) {
    document.body.classList.add('server-locked');
    showAuth('signin');
    const message = $('#authMessage');
    message.className = 'auth-success';
    message.textContent = 'Conectando con el servidor local…';
    $('#localAuthForm').querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  }
  document.documentElement.classList.remove('app-pending');
  addExtraUi(); setupTeamUi(); updateStaticText(); registerEvents();
  $('#stateFilter').innerHTML = '<option value="">Todos los estados</option>' + STATUSES.map((status) => `<option>${escapeHtml(status)}</option>`).join('');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/service-worker.js').catch((error) => console.warn('PWA no pudo registrarse:', error.message));
  try {
    const ready = await backend.boot();
    if (ready) { renderAll(); if (orders.length) fillForm(orders[0]); else clearForm(); showView('home'); startServerRefresh(); }
  } catch (error) {
    console.error(error);
    setConnection('Error de conexión', 'offline');
    if (serverMode) {
      showAuth('signin');
      const message = $('#authMessage');
      message.textContent = `No se pudo contactar al servidor local: ${error.message}`;
    } else notify(`No se pudo abrir el taller: ${error.message}`);
  }
}

start();
