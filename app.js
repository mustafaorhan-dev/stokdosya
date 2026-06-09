// ¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦
// STOKDEPO — Ana Uygulama JavaScript'i
// ¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦

// ----- VERİ KATMANI -----
// Supabase Entegrasyonu
// Bilgiler: Supabase Dashboard > Project Settings > API
const SUPABASE_URL = 'https://jarnxfhviniqfdeptifb.supabase.co';
const SUPABASE_ANON = 'sb_publishable_jDi72096C6MNcrcZHmpPFg_ATt5_2SP';

let data = { products: {}, transactions: [], users: [], activeUser: '', tenders: [], companies: [], settings: {}, productNames: [], productUnits: {} };
let nextPartiCounter = 1;
let _syncLock = false;
if (typeof Chart !== 'undefined') Chart.defaults.devicePixelRatio = window.devicePixelRatio;

function isSupabaseReady() {
  return SUPABASE_URL && SUPABASE_ANON;
}

function isAdmin() {
  const u = data.users.find(x => x.name === data.activeUser);
  return u && u.role === 'Yönetici';
}

async function supabaseFetch(method, table, params, body) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (params) url += '?' + new URLSearchParams(params);
  const headers = {
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  if (method === 'POST') headers['Prefer'] = 'return=representation,resolution=merge-duplicates';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal
  });
  clearTimeout(timeout);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const text = await res.text(); msg += ': ' + text; console.error('🔥 SUPABASE HATA YANITI:', text); } catch(_) { msg += ' (yanıt okunamadı)'; }
    throw new Error(msg);
  }
  if (method === 'DELETE') return null;
  return res.json();
}

function isViewOnly() {
  const u = data.users.find(x => x.name === data.activeUser);
  return u && u.role === 'Sadece Görüntüleme';
}

// ===== SUPABASE VERİ KATMANI =====

async function supabaseSave() {
  if (!isSupabaseReady()) return false;
  if (_syncLock) { toast('Eşitleme zaten devam ediyor.', 'warning'); return false; }
  _syncLock = true;
  try {
    // Her kayıt öncesi float ID'leri tam sayıya çevir
    (data.transactions || []).forEach(function(t) { if (t.id && !Number.isInteger(t.id)) t.id = Math.floor(t.id); });
    const statusEl = document.getElementById('cloud-status-text');
    if (statusEl) statusEl.textContent = '☁️ Supabase\'e yazılıyor...';

    // Products toplu upsert
    const productArray = Object.entries(data.products).map(([pid, p]) => ({
      parti_no: pid, name: p.name, category: p.category || '', unit: p.unit || 'kg',
      stock: p.stock || 0, critical_level: p.criticalLevel || 0, stt: p.stt || '',
      company_name: p.companyName || '', active: p.active !== false,
      created_at: p.createdAt || new Date().toISOString(), created_by: p.createdBy || '',
      deleted_by: p.deletedBy || null, deleted_at: p.deletedAt || null
    }));
    if (productArray.length > 0) {
      try { await supabaseFetch('POST', 'products', null, productArray); } catch(e) { toast('❌ Ürünler Supabase\'e kaydedilemedi', 'error'); }
    }

    // Transactions toplu upsert
    const txArrayFull = data.transactions.map(t => ({
      id: t.id, type: t.type || '', parti_no: t.partiNo || '', product_name: t.productName || '',
      amount: t.amount || 0, unit: t.unit || '', date: t.date || '', note: t.note || '',
      stt: t.stt || '', timestamp: t.timestamp || new Date().toISOString(),
      created_by: t.createdBy || '',
      person_count: t.personCount || 0, unit_price: t.unitPrice || 0,
      total_cost: t.totalCost || 0, cost_per_person: t.costPerPerson || 0
    }));
    const txArrayBasic = data.transactions.map(t => ({
      id: t.id, type: t.type || '', parti_no: t.partiNo || '', product_name: t.productName || '',
      amount: t.amount || 0, unit: t.unit || '', date: t.date || '', note: t.note || '',
      stt: t.stt || '', timestamp: t.timestamp || new Date().toISOString(),
      created_by: t.createdBy || ''
    }));
    if (txArrayFull.length > 0) {
      try {
        await supabaseFetch('POST', 'transactions', null, txArrayFull);
      } catch(e) {
        toast('⚠️ İşlemler kaydedilemedi, basit alanlarla deneniyor...', 'warning');
        try { await supabaseFetch('POST', 'transactions', null, txArrayBasic); } catch(e2) { toast('❌ İşlemler Supabase\'e kaydedilemedi', 'error'); }
      }
    }

    // Users upsert (benzersiz) — sadece tabloda var olan kolonlar gönderilsin
    const seenUsers = new Set();
    const userArray = data.users.filter(u => { if (seenUsers.has(u.name)) return false; seenUsers.add(u.name); return true; }).map(u => ({
      name: u.name, role: u.role || 'Depo Kullanıcısı', password: u.password,
      last_login: u.lastLogin || null
    }));
    if (userArray.length > 0) {
      try { await supabaseFetch('POST', 'stok_users', null, userArray); } catch(e) { toast('❌ Kullanıcı Supabase\'e kaydedilemedi: ' + e.message, 'error'); }
    }

    // Tenders upsert
    if (data.tenders.length > 0) {
      const tenderArray = data.tenders.map(t => ({
        id: t.id, company_name: t.companyName, product: t.product,
        quantity: t.quantity, unit: t.unit || '', delivered: t.delivered || 0,
        price: t.price || 0, year: t.year || new Date().getFullYear()
      }));
      try { await supabaseFetch('POST', 'tenders', null, tenderArray); } catch(e) { toast('❌ İhale kayıtları Supabase\'e kaydedilemedi', 'error'); }
    }

    // Companies upsert
    const compRows = (data.companies || []).map(c => ({ name: c }));
    if (compRows.length > 0) {
      try { await supabaseFetch('POST', 'companies', null, compRows); } catch(e) { toast('❌ Firmalar Supabase\'e kaydedilemedi', 'error'); }
    }

    // Product names upsert
    const nameRows = (data.productNames || []).map(n => ({
      name: n,
      unit: (data.productUnits || {})[n] || null
    }));
    if (nameRows.length > 0) {
      try { await supabaseFetch('POST', 'product_names', null, nameRows); } catch(e) { toast('❌ Ürün isimleri Supabase\'e kaydedilemedi', 'error'); }
    }

    // Settings upsert
    const settingRows = Object.entries(data.settings || {}).map(([k, v]) => ({ key: k, value: v }));
    if (settingRows.length > 0) {
      try { await supabaseFetch('POST', 'settings', null, settingRows); } catch(e) { toast('❌ Ayarlar Supabase\'e kaydedilemedi', 'error'); }
    }

    if (statusEl) statusEl.textContent = 'Sunucuya Bağlı';
    return true;
  } catch (e) {
    console.error('Supabase kayıt hatası:', e);
    const statusEl = document.getElementById('cloud-status-text');
    if (statusEl) statusEl.textContent = '☁️ Supabase hatası';
    return false;
  } finally {
    _syncLock = false;
  }
}

async function supabaseLoad() {
  if (!isSupabaseReady()) return null;
  try {
    const [products, transactions, users, tenders, companies, productNames, settings] = await Promise.all([
      supabaseFetch('GET', 'products', { order: 'parti_no.asc' }),
      supabaseFetch('GET', 'transactions', { order: 'id.asc' }),
      supabaseFetch('GET', 'stok_users', { order: 'name.asc' }),
      supabaseFetch('GET', 'tenders', { order: 'id.asc' }),
      supabaseFetch('GET', 'companies', { order: 'name.asc' }),
      supabaseFetch('GET', 'product_names', { order: 'name.asc' }),
      supabaseFetch('GET', 'settings')
    ]);

    const prodMap = {};
    (products || []).forEach(p => {
      prodMap[p.parti_no] = {
        partiNo: p.parti_no, name: p.name, category: p.category || '', unit: p.unit || 'kg',
        stock: p.stock || 0, criticalLevel: p.critical_level || 0, stt: p.stt || '',
        companyName: p.company_name || '', active: p.active !== false,
        createdAt: p.created_at, createdBy: p.created_by || '',
        deletedBy: p.deleted_by || '', deletedAt: p.deleted_at
      };
    });

    const txList = (transactions || []).map(t => ({
      id: t.id, type: t.type, partiNo: t.parti_no, productName: t.product_name,
      amount: t.amount, unit: t.unit || '', date: t.date, note: t.note || '',
      stt: t.stt || '', timestamp: t.timestamp, createdBy: t.created_by || '',
      personCount: t.person_count, unitPrice: t.unit_price,
      totalCost: t.total_cost, costPerPerson: t.cost_per_person
    }));

    const userList = (users || []).map(u => ({
      name: u.name, role: u.role || 'Depo Kullanıcısı',
      password: u.password, lastLogin: u.last_login, active: u.active !== false
    }));

    const tenderList = (tenders || []).map(t => ({
      id: t.id, companyName: t.company_name, product: t.product,
      quantity: t.quantity, unit: t.unit || '', delivered: t.delivered || 0,
      price: t.price || 0, year: t.year || new Date().getFullYear()
    }));

    const compList = (companies || []).map(c => c.name);

    const nameList = [];
    const unitsMap = {};
    (productNames || []).forEach(n => {
      nameList.push(n.name);
      if (n.unit) unitsMap[n.name] = n.unit;
    });

    const settingObj = {};
    (settings || []).forEach(s => { settingObj[s.key] = s.value; });

    return { products: prodMap, transactions: txList, users: userList, tenders: tenderList, companies: compList, productNames: nameList, productUnits: unitsMap, settings: settingObj, activeUser: data.activeUser || '' };
  } catch (e) {
    console.error('Supabase yükleme hatası:', e);
    return null;
  }
}

function recalculateStocks() {
  const legacyStocks = {};
  Object.keys(data.products).forEach(pid => {
    legacyStocks[pid] = data.products[pid].stock || 0;
    data.products[pid].stock = 0;
  });
  (data.transactions || []).forEach(tx => {
    const p = data.products[tx.partiNo];
    if (!p) return;
    const amt = Number(tx.amount) || 0;
    if (tx.type === 'giris') p.stock += amt;
    else if (tx.type === 'cikis') p.stock -= amt;
  });
  Object.keys(data.products).forEach(pid => {
    if (!data.transactions.some(tx => tx.partiNo === pid)) {
      data.products[pid].stock = legacyStocks[pid];
    }
    });
  }

// ---------- KULLANICI GİRİŞİ (local veri kontrolü) ----------
function sheetsLogin(username, password) {
  var user = data.users.find(function(u) {
    return u.name === username && u.password === password && u.active !== false;
  });
  if (user) {
    data.activeUser = user.name;
    return Promise.resolve(user);
  }
  return Promise.resolve(null);
}

async function heartbeatActiveSession() {
  if (!data.activeUser || !isSupabaseReady()) return;
  try {
    const remote = await supabaseFetch('GET', 'settings');
    let sessions = [];
    let forceLogout = '';
    if (Array.isArray(remote)) {
      const obj = {};
      remote.forEach(s => obj[s.key] = s.value);
      if (obj._activeSessions) { try { sessions = JSON.parse(obj._activeSessions); } catch(e) {} }
      forceLogout = obj._forceLogout || '';
    }
    // Başka bir yönetici bu kullanıcıyı pasif yaptıysa oturumu kapat
    if (forceLogout === data.activeUser) {
      const logoutUser = data.users.find(u => u.name === data.activeUser);
      if (logoutUser) logoutUser.active = false;
      supabaseFetch('POST', 'settings', null, [{ key: '_forceLogout', value: '' }]).catch(() => {});
      sessionStorage.removeItem('stokdosya_logged_in');
      sessionStorage.removeItem('stokdosya_activeUser');
      data.activeUser = '';
      const loginScr = document.getElementById('login-screen');
      const appCont = document.getElementById('app-container');
      if (loginScr) loginScr.style.display = 'flex';
      if (appCont) appCont.style.display = 'none';
      if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
      return;
    }
    const now = new Date().toISOString();
    const idx = sessions.findIndex(s => s.user === data.activeUser);
    if (idx >= 0) sessions[idx].time = now;
    else sessions.push({ user: data.activeUser, time: now });
    const cutoff = Date.now() - 120000;
    sessions = sessions.filter(s => new Date(s.time).getTime() > cutoff);
    data.settings._activeSessions = JSON.stringify(sessions);
    await supabaseFetch('POST', 'settings', null, [{ key: '_activeSessions', value: data.settings._activeSessions }]);
  } catch(e) { /* silent */ }
}
let _heartbeatInterval = null;
function startHeartbeat() {
  if (_heartbeatInterval) return;
  heartbeatActiveSession();
  _heartbeatInterval = setInterval(heartbeatActiveSession, 30000);
}

// ----- SUPABASE TEST -----
async function sheetsTest() {
  if (!isSupabaseReady()) {
    toast('☁️ Supabase bağlantısı kurulamadı. Anahtarları kontrol edin.', 'error');
    return;
  }
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) { toast('Overlay öğesi bulunamadı.', 'error'); return; }
  overlay.style.display = 'flex';
  document.getElementById('loading-text').textContent = 'Supabase bağlantısı test ediliyor...';
  try {
    const result = await supabaseFetch('GET', 'products', { select: 'parti_no', limit: '1' });
    if (Array.isArray(result)) {
      toast('☁️ Supabase bağlantısı başarılı!', 'success');
      document.getElementById('cloud-status-text').textContent = 'Sunucuya Bağlı';
      refreshSettings();
    } else {
      toast('⚠️ Beklenmeyen yanıt.', 'error');
    }
  } catch (e) {
    toast('❌ Hata: ' + e.message, 'error');
  }
  overlay.style.display = 'none';
}

async function clearCacheAndReload() {
  if (!isSupabaseReady()) { toast('⚠️ Supabase bağlı değil.', 'warning'); return; }
  if (!confirm('Tüm veriler Supabase\'ten yeniden yüklenecek. Devam etmek istiyor musunuz?')) return;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.display = 'flex'; document.getElementById('loading-text').textContent = 'Supabase\'ten yükleniyor...'; }
  try {
    data.products = {}; data.transactions = []; data.users = []; data.tenders = [];
    data.companies = []; data.productNames = []; data.settings = {};
    const remoteData = await supabaseLoad();
    if (remoteData) {
      data.products = remoteData.products || {};
      data.transactions = remoteData.transactions || [];
      data.users = remoteData.users || [];
      data.tenders = remoteData.tenders || [];
      data.companies = remoteData.companies || [];
      data.productNames = remoteData.productNames || [];
      data.settings = remoteData.settings || {};
      initData();
      toast('✅ Veriler Supabase\'ten yeniden yüklendi!', 'success');
      refreshAll();
    } else {
      toast('⚠️ Supabase\'ten veri alınamadı. Sayfayı yenileyin.', 'warning');
    }
  } catch (e) {
    toast('❌ Hata: ' + e.message, 'error');
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

async function sheetsPull() {
  if (!isSupabaseReady()) return null;
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return null;
  overlay.style.display = 'flex';
  document.getElementById('loading-text').textContent = 'Supabase\'ten veriler alınıyor...';
  try {
    const remoteData = await supabaseLoad();
    if (remoteData) {
      data.products = remoteData.products || {};
      data.transactions = remoteData.transactions || [];
      data.users = remoteData.users || [];
      if (remoteData.tenders && remoteData.tenders.length) data.tenders = remoteData.tenders;
      data.companies = remoteData.companies || [];
      data.productNames = remoteData.productNames || [];
      const sheetsLocalFlags = data.settings._userActiveFlags;
      const sheetsLocalForce = data.settings._forceLogout;
      data.settings = remoteData.settings || {};
      if (sheetsLocalFlags) data.settings._userActiveFlags = sheetsLocalFlags;
      if (sheetsLocalForce) data.settings._forceLogout = sheetsLocalForce;
      initData();
      toast('✅ Veriler Supabase\'ten alındı!', 'success');
      return true;
    } else {
      toast('⚠️ Supabase\'ten veri alınamadı.', 'warning');
      return false;
    }
  } catch (e) {
    toast('❌ Hata: ' + e.message, 'error');
    return false;
  } finally {
    overlay.style.display = 'none';
    refreshAll();
  }
}

function initData() {
  if (!data.users) data.users = [];
  // _userActiveFlags ayarından aktif/pasif durumlarını uygula
  let userFlags = {};
  try { userFlags = JSON.parse(data.settings._userActiveFlags || '{}'); } catch(e) {}
  data.users.forEach(u => {
    if (userFlags[u.name] !== undefined) u.active = userFlags[u.name];
    else if (u.active === undefined) u.active = true;
  });
  if (!data.users.length) {
    data.users = [{ name: 'MUSTAFA ORHAN', role: 'Yönetici', password: '159357', active: true }];
    data.activeUser = 'MUSTAFA ORHAN';
  } else {
    // MUSTAFA ORHAN her zaman var olsun
    if (!data.users.some(u => u.name === 'MUSTAFA ORHAN')) {
      data.users.unshift({ name: 'MUSTAFA ORHAN', role: 'Yönetici', password: '159357', active: true });
    }
  }
  if (!data.settings) data.settings = {};
  if (!data.settings.autoBackupTime) data.settings.autoBackupTime = '23:00';
  if (data.settings.autoBackupEnabled === undefined) data.settings.autoBackupEnabled = false;
  if (!data.settings.autoSync) data.settings.autoSync = true;
  if (!data.products) data.products = {};
  if (!data.transactions) data.transactions = [];
  if (!data.tenders) data.tenders = [];
  if (!data.companies) data.companies = [];
  if (!data.productNames) data.productNames = [];
  if (!data.productUnits) data.productUnits = {};
  // Soft-delete migration: tüm mevcut ürünlere active:true ekle
  if (data.products) {
    Object.values(data.products).forEach(p => {
      if (p.active === undefined) p.active = true;
      if (p.companyName && !data.companies.includes(p.companyName)) {
        data.companies.push(p.companyName);
      }
    });
    data.companies.sort((a, b) => a.localeCompare(b));
  }
}

async function loadData() {
  if (isSupabaseReady()) {
    const remoteData = await supabaseLoad();
    if (remoteData) {
      data.products = remoteData.products || {};
      data.transactions = remoteData.transactions || [];
      data.users = remoteData.users || [];
      data.activeUser = remoteData.activeUser || '';
      data.tenders = remoteData.tenders || [];
      data.companies = remoteData.companies || [];
      data.productNames = remoteData.productNames || [];
      data.productUnits = remoteData.productUnits || {};
      if (remoteData.settings) {
        const localFlags = data.settings._userActiveFlags;
        const localForce = data.settings._forceLogout;
        data.settings = { ...data.settings, ...remoteData.settings };
        if (localFlags) data.settings._userActiveFlags = localFlags;
        if (localForce) data.settings._forceLogout = localForce;
      }
      initData();
      return;
    }
  }
  initData();
}

async function saveData() {
  if (isSupabaseReady() && !_syncLock) {
    const ok = await supabaseSave();
    if (!ok) {
      toast('⚠️ Supabase\'e kaydedilemedi. Veri kaybolabilir!', 'warning');
      return false;
    }
    return true;
  }
  toast('⚠️ Supabase bağlı değil, kayıt yapılamadı.', 'warning');
  return false;
}

// ----- TEMA -----
function getTheme() {
  if (!isAdmin()) return 'light';
  return localStorage.getItem('stokdosya_theme') || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const tt = document.getElementById('theme-toggle');
  if (tt) tt.textContent = theme === 'light' ? '🌙' : '☀️';
  localStorage.setItem('stokdosya_theme', theme);
  document.body.style.setProperty('color', theme === 'dark' ? '#f1f5f9' : '#0f172a', 'important');
}

function toggleTheme() {
  if (!isAdmin()) return;
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  refreshAll();
}



// ----- YARDIMCI -----
function htmlEscape(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function base64ToUtf8(str) {
  try { return decodeURIComponent(escape(atob(str))); }
  catch (e) { try { return new TextDecoder().decode(Uint8Array.from(atob(str), function(c) { return c.charCodeAt(0); })); } catch (e2) { return atob(str); } }
}

function formatDate(iso) {
  if (!iso) return '-';
  // YYYY-MM-DD formatı
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.split('-');
    if (y && m && d) return d + '.' + m + '.' + y;
  }
  // Date string (ör: "Fri May 29 2026...") veya Date objesi
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    return String(d.getDate()).padStart(2,'0') + '.' +
           String(d.getMonth()+1).padStart(2,'0') + '.' +
           d.getFullYear();
  }
  return iso;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function isValidDate(str) {
  if (!str) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (y < 2016 || y > 2040) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function sanitizeDateInput(input) {
  let val = input.value;
  if (!val) return;
  let parts = val.split('-');
  if (parts.length === 3 && parts[0].length > 4) {
    parts[0] = parts[0].slice(0, 4);
    input.value = parts.join('-');
  }
}

document.querySelectorAll('input[type="date"]').forEach(el => {
  el.addEventListener('input', function() { sanitizeDateInput(this); });
});

// ----- KİŞİ ADI AYIKLAMA -----
function extractPerson(note) {
  if (!note) return '';
  // Sadece harf ve boşluk kalacak şekilde temizle (büyük/küçük tüm Türkçe harfler)
  let clean = note.replace(/[^a-zA-ZıİşŞğĞüÜöÖçÇ\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const words = clean.split(' ').filter(w => w.length >= 2);
  if (words.length >= 1) return words.join(' ');
  return '';
}

function getAllPersons() {
  const set = new Set();
  // Sistem kullanıcılarını ekle
  data.users.forEach(u => { if (u.name) set.add(u.name.toUpperCase()); });
  // İşlem notlarından isimleri ekle
  data.transactions.forEach(t => {
    const p = extractPerson(t.note);
    if (p) set.add(p);
  });
  return [...set].sort();
}

function refreshPersonFilter() {
  // replaced with static Giriş/Çıkış filter in HTML
}

function populateYearSelect(selectId, selectedYear) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const cyil = new Date().getFullYear();
  select.innerHTML = '';
  for (let y = 2016; y <= cyil + 5; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y + ' Yılı';
    if (y === (selectedYear || cyil)) opt.selected = true;
    select.appendChild(opt);
  }
}

function populateMonthSelect(selectId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const now = new Date();
  const val = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (el.type === 'month') {
    if (!el.value) el.value = val;
  } else {
    // Eski select yapısı (yedek)
    el.innerHTML = '';
    for (let y = now.getFullYear(); y >= 2016; y--) {
      for (let m = 11; m >= 0; m--) {
        const v = y + '-' + String(m + 1).padStart(2, '0');
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = AYLAR[m] + ' ' + y;
        if (v === val) opt.selected = true;
        el.appendChild(opt);
      }
    }
  }
}

function populateSupplierSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '<option value="">Tüm Tedarikçiler</option>';
  (data.companies || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  _csRefresh(selectId);
}

function populateSupplierProductSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const names = [...new Set(data.transactions.map(t => t.productName).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Tüm Ürünler</option>';
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    select.appendChild(opt);
  });
  _csRefresh(selectId);
}

// ----- ÖZEL SEÇİM KUTUSU (ARA + KAYDIRMA) -----
const _csInstances = {};

function _createCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return null;
  if (select.dataset.csReady === '1') return _csInstances[selectId];

  const wrapper = document.createElement('div');
  wrapper.className = 'cs-group';
  // Preserve original inline width on the wrapper
  if (select.style.width) wrapper.style.width = select.style.width;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.style.display = 'none';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  btn.innerHTML = '<span class="cs-label"></span><i class="fa-solid fa-chevron-down"></i>';
  wrapper.appendChild(btn);

  const dd = document.createElement('div');
  dd.className = 'cs-dd';
  dd.innerHTML = '<div class="cs-search"><i class="fa-solid fa-search"></i><input type="text" placeholder="Ara..." autocomplete="off"></div><div class="cs-options"></div>';
  wrapper.appendChild(dd);

  const inst = {
    select, wrapper, btn, dd,
    label: btn.querySelector('.cs-label'),
    search: dd.querySelector('input'),
    opts: dd.querySelector('.cs-options')
  };
  _csInstances[selectId] = inst;
  select.dataset.csReady = '1';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrapper.classList.contains('show');
    document.querySelectorAll('.cs-group.show').forEach(g => { if (g !== wrapper) g.classList.remove('show'); });
    wrapper.classList.toggle('show');
    if (!isOpen) setTimeout(() => inst.search && inst.search.focus(), 50);
  });

  document.addEventListener('click', () => {
    wrapper.classList.remove('show');
  });

  dd.addEventListener('click', (e) => {
    const opt = e.target.closest('.cs-option');
    if (!opt) return;
    select.value = opt.dataset.value;
    inst.label.textContent = opt.textContent;
    wrapper.classList.remove('show');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    _csRefreshOpts(inst);
  });

  inst.search.addEventListener('input', () => {
    const q = inst.search.value.toLowerCase();
    inst.opts.querySelectorAll('.cs-option').forEach(o => {
      o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  _csRefreshOpts(inst);
  return inst;
}

function _csRefresh(selectId) {
  const inst = _csInstances[selectId];
  if (inst) _csRefreshOpts(inst);
}

function _csRefreshOpts(inst) {
  const { select, opts, label } = inst;
  const val = select.value;
  opts.innerHTML = Array.from(select.options).map(o =>
    `<div class="cs-option${o.value === val ? ' active' : ''}" data-value="${htmlEscape(o.value).replace(/"/g, '&quot;')}">${o.textContent}</div>`
  ).join('');
  const sel = select.options[select.selectedIndex];
  label.textContent = sel ? sel.textContent : '';
}

// ----- AYLAR -----
const AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const AY_INDEX = new Date().getMonth();

// ----- CHART JS YÖNETİMİ -----
let _yearChart = null;

function _chartUnit() {
  const btn = document.getElementById('year-filter-btn');
  if (!btn) return '';
  const secili = btn.dataset.value || '';
  if (!secili) return '';
  for (const p of Object.values(data.products)) {
    if (p.name === secili) return p.unit || '';
  }
  for (const t of data.transactions) {
    if (t.productName === secili && t.unit) return t.unit;
  }
  return '';
}

const barValuePlugin = {
  id: 'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const birim = _chartUnit();
    const isDark = getTheme() === 'dark';
    chart.data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, index) => {
        const val = dataset.data[index];
        if (val === 0) return;
        ctx.fillStyle = isDark ? '#fff' : '#0f172a';
        ctx.font = 'bold 11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(val + (birim ? ' ' + birim : ''), bar.x, bar.y - 3);
      });
    });
  }
};

function populateYearProductFilter() {
  const container = document.getElementById('year-filter-options');
  if (!container) return;
  const urunler = [...new Set(data.transactions.map(t => t.productName).filter(Boolean))].sort();
  const current = document.getElementById('year-filter-btn').dataset.value || '';
  container.innerHTML = '<div class="year-filter-option" data-value="">Tüm Ürünler</div>' +
    urunler.map(u => `<div class="year-filter-option${u === current ? ' active' : ''}" data-value="${htmlEscape(u).replace(/"/g, '&quot;')}">${htmlEscape(u)}</div>`).join('');
}

// Custom dropdown for year product filter
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('year-filter-btn');
  const dropdown = document.getElementById('year-filter-dropdown');
  const label = document.getElementById('year-filter-label');
  const searchInput = document.getElementById('year-filter-search-input');
  const options = document.getElementById('year-filter-options');

  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const group = btn.parentElement;
    const isOpen = group.classList.contains('show');
    document.querySelectorAll('.year-filter-group.show').forEach(g => { if (g !== group) g.classList.remove('show'); });
    group.classList.toggle('show');
    if (!isOpen) {
      setTimeout(() => searchInput && searchInput.focus(), 50);
    }
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.year-filter-group.show').forEach(g => g.classList.remove('show'));
  });

  dropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('.year-filter-option');
    if (!opt) return;
    const val = opt.dataset.value;
    btn.dataset.value = val;
    label.textContent = opt.textContent;
    btn.parentElement.classList.remove('show');
    document.querySelectorAll('.year-filter-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    refreshYearsView();
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      options.querySelectorAll('.year-filter-option').forEach(o => {
        o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
});

function renderYearChart(yil) {
  const canvas = document.getElementById('year-chart');
  if (!canvas) return;
  if (_yearChart) { _yearChart.destroy(); _yearChart = null; }

  const urunFiltre = (document.getElementById('year-filter-btn').dataset.value || '');
  const emptyEl = document.getElementById('year-chart-empty');

  const aktifUrun = t => data.products[t.partiNo]?.active !== false;
  const girisAylik = AYLAR.map((_, i) =>
    data.transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'giris' && d.getMonth() === i && d.getFullYear() === yil
        && (!urunFiltre || t.productName === urunFiltre) && aktifUrun(t);
    }).reduce((s, t) => s + t.amount, 0)
  );
  const cikisAylik = AYLAR.map((_, i) =>
    data.transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'cikis' && d.getMonth() === i && d.getFullYear() === yil
        && (!urunFiltre || t.productName === urunFiltre) && aktifUrun(t);
    }).reduce((s, t) => s + t.amount, 0)
  );

  const toplam = girisAylik.reduce((a, b) => a + b, 0) + cikisAylik.reduce((a, b) => a + b, 0);

  if (toplam === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const ctx = canvas.getContext('2d');
  const isDark = getTheme() === 'dark';

  const girisGrad = ctx.createLinearGradient(0, 0, 0, 400);
  girisGrad.addColorStop(0, 'rgba(34,197,94,0.9)');
  girisGrad.addColorStop(0.6, 'rgba(34,197,94,0.5)');
  girisGrad.addColorStop(1, 'rgba(34,197,94,0.15)');

  const cikisGrad = ctx.createLinearGradient(0, 0, 0, 400);
  cikisGrad.addColorStop(0, 'rgba(239,68,68,0.9)');
  cikisGrad.addColorStop(0.6, 'rgba(239,68,68,0.5)');
  cikisGrad.addColorStop(1, 'rgba(239,68,68,0.15)');

  const labelColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(71,85,105,0.12)';

  _yearChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: AYLAR,
      datasets: [
        {
          label: 'Giriş',
          data: girisAylik,
          backgroundColor: girisGrad,
          borderColor: '#22c55e',
          borderWidth: 2,
          borderRadius: 6,
          barPercentage: 0.55,
          categoryPercentage: 0.7
        },
        {
          label: 'Çıkış',
          data: cikisAylik,
          backgroundColor: cikisGrad,
          borderColor: '#ef4444',
          borderWidth: 2,
          borderRadius: 6,
          barPercentage: 0.55,
          categoryPercentage: 0.7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: labelColor, font: { size: 12, weight: '600' }, usePointStyle: true, padding: 16 }
        },
        tooltip: {
          enabled: true,
          backgroundColor: isDark ? '#1e293b' : '#fff',
          titleColor: isDark ? '#f1f5f9' : '#0f172a',
          bodyColor: isDark ? '#94a3b8' : '#475569',
          borderColor: isDark ? '#334155' : '#cbd5e1',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': ' + _fmt(ctx.raw);
            }
          }
        }
      },
      hover: {
        mode: 'index',
        intersect: false
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: {
          ticks: { color: labelColor, font: { size: 11 } },
          grid: { color: gridColor }
        },
        y: {
          beginAtZero: true,
          ticks: { color: labelColor, font: { size: 11 } },
          grid: { color: gridColor }
        }
      }
    },
    plugins: [barValuePlugin]
  });
}

// ----- YILLIK KARSILASTIRMA GRAFIGI -----
let _yearCompareChart = null;

function refreshYearCompare() {
  const select = document.getElementById('yc-product');
  const canvas = document.getElementById('year-compare-canvas');
  const empty = document.getElementById('year-compare-empty');
  if (!canvas) return;

  const urunler = [...new Set(data.transactions.map(t => t.productName).filter(Boolean))].sort();
  const secili = select.value;
  const currentHTML = select.innerHTML;
  const yeniHTML = '<option value="">Tüm Ürünler</option>' +
    urunler.map(u => `<option value="${htmlEscape(u).replace(/"/g, '&quot;')}"${u === secili ? ' selected' : ''}>${htmlEscape(u)}</option>`).join('');
  if (yeniHTML !== currentHTML) select.innerHTML = yeniHTML;

  let birim = '';
  if (secili) {
    for (const p of Object.values(data.products)) {
      if (p.name === secili && p.unit) { birim = p.unit; break; }
    }
    if (!birim) {
      for (const t of data.transactions) {
        if (t.productName === secili && t.unit) { birim = t.unit; break; }
      }
    }
  }

  const yilGiris = {}, yilCikis = {}, yilAdet = {};
  data.transactions.forEach(t => {
    if (!t.date || !t.amount) return;
    if (secili && t.productName !== secili) return;
    const yil = new Date(t.date).getFullYear();
    if (t.type === 'giris') { if (!yilGiris[yil]) yilGiris[yil] = 0; yilGiris[yil] += t.amount; }
    else if (t.type === 'cikis') { if (!yilCikis[yil]) yilCikis[yil] = 0; yilCikis[yil] += t.amount; }
    if (!yilAdet[yil]) yilAdet[yil] = 0;
    yilAdet[yil]++;
  });

  const tumYillar = [...new Set([...Object.keys(yilGiris), ...Object.keys(yilCikis)].map(Number))].sort((a, b) => a - b);
  const girisDataAll = tumYillar.map(y => yilGiris[y] || 0);
  const cikisDataAll = tumYillar.map(y => yilCikis[y] || 0);
  const toplam = girisDataAll.reduce((s, v) => s + v, 0) + cikisDataAll.reduce((s, v) => s + v, 0);

  // Mode
  const activeBtn = document.querySelector('.yc-mode-btn.active');
  const mode = activeBtn ? activeBtn.dataset.mode : 'all';
  const yc = document.querySelector('.yc-year-controls');
  const sep = document.querySelector('.yc-year-sep');
  if (yc) yc.style.display = mode === 'all' ? 'none' : 'flex';

  // Populate year selects
  const y1 = document.getElementById('yc-year1');
  const y2 = document.getElementById('yc-year2');
  if (tumYillar.length) {
    const mevcut1 = y1.value;
    const mevcut2 = y2.value;
    const opts = tumYillar.map(y => `<option value="${y}">${y}</option>`).join('');
    if (y1.innerHTML !== opts) y1.innerHTML = opts;
    if (y2.innerHTML !== opts) y2.innerHTML = opts;
    if (!mevcut1 || !tumYillar.includes(Number(mevcut1))) y1.value = tumYillar[tumYillar.length - 2] ?? tumYillar[0];
    if (!mevcut2 || !tumYillar.includes(Number(mevcut2))) y2.value = tumYillar[tumYillar.length - 1];
  } else {
    y1.innerHTML = '<option value="">—</option>';
    y2.innerHTML = '<option value="">—</option>';
  }

  let goster;
  if (mode === 'all') {
    goster = tumYillar;
  } else if (mode === 'range') {
    const yil1 = Number(y1.value) || 0;
    const yil2 = Number(y2.value) || 0;
    const minY = Math.min(yil1, yil2);
    const maxY = Math.max(yil1, yil2);
    goster = tumYillar.filter(y => y >= minY && y <= maxY);
  } else {
    const yil1 = Number(y1.value) || 0;
    const yil2 = Number(y2.value) || 0;
    goster = [...new Set([yil1, yil2].filter(Boolean))].sort((a, b) => a - b);
  }

  if (sep) sep.textContent = mode === 'range' ? '→' : 'vs';

  const girisData = goster.map(y => yilGiris[y] || 0);
  const cikisData = goster.map(y => yilCikis[y] || 0);

  // Stats
  if (mode === 'all') {
    const totalIn = girisData.reduce((s, v) => s + v, 0);
    const totalOut = cikisData.reduce((s, v) => s + v, 0);
    const netChange = totalIn - totalOut;
    const totalCount = goster.reduce((s, y) => s + (yilAdet[y] || 0), 0);
    const busiestYear = goster.length ? goster.reduce((a, b) => ((yilAdet[a] || 0) >= (yilAdet[b] || 0)) ? a : b) : null;

    document.getElementById('yc-year1-label').textContent = 'Toplam Giriş';
    document.getElementById('yc-year2-label').textContent = 'Toplam Çıkış';
    document.getElementById('yc-year1-in').textContent = _fmt(totalIn);
    document.getElementById('yc-year1-out').textContent = '—';
    document.getElementById('yc-year2-in').textContent = '—';
    document.getElementById('yc-year2-out').textContent = _fmt(totalOut);

    const netEl = document.getElementById('yc-net-change');
    netEl.textContent = (netChange >= 0 ? '+' : '') + _fmt(Math.abs(netChange)) + ' ' + birim;
    netEl.style.color = netChange > 0 ? 'var(--success)' : netChange < 0 ? 'var(--accent)' : 'var(--text-primary)';
    document.getElementById('yc-net-detail').textContent = `En yoğun: ${busiestYear || '—'}`;

    document.getElementById('yc-year1-count').textContent = goster.length + ' yıl';
    document.getElementById('yc-year2-count').textContent = _fmt(totalCount);
    const ccEl = document.getElementById('yc-count-change');
    ccEl.textContent = 'işlem';
    ccEl.style.color = 'var(--text-muted)';
  } else {
    const yil1 = Number(y1.value) || 0;
    const yil2 = Number(y2.value) || 0;
    const g1 = yilGiris[yil1] || 0, c1 = yilCikis[yil1] || 0;
    const g2 = yilGiris[yil2] || 0, c2 = yilCikis[yil2] || 0;
    const net1 = g1 - c1, net2 = g2 - c2;
    const netChange = net2 - net1;
    const a1 = yilAdet[yil1] || 0, a2 = yilAdet[yil2] || 0;
    const countPct = a1 > 0 ? ((a2 - a1) / a1 * 100).toFixed(1) : (a2 > 0 ? '+100' : '0');

    document.getElementById('yc-year1-label').textContent = yil1 || 'Yıl 1';
    document.getElementById('yc-year2-label').textContent = yil2 || 'Yıl 2';
    document.getElementById('yc-year1-in').textContent = _fmt(g1);
    document.getElementById('yc-year1-out').textContent = _fmt(c1);
    document.getElementById('yc-year2-in').textContent = _fmt(g2);
    document.getElementById('yc-year2-out').textContent = _fmt(c2);

    const netEl = document.getElementById('yc-net-change');
    netEl.textContent = (netChange >= 0 ? '+' : '') + _fmt(Math.abs(netChange)) + ' ' + birim;
    netEl.style.color = netChange > 0 ? 'var(--success)' : netChange < 0 ? 'var(--accent)' : 'var(--text-primary)';
    document.getElementById('yc-net-detail').textContent =
      yil1 && yil2 ? `(${yil2} - ${yil1})` : '';

    document.getElementById('yc-year1-count').textContent = a1;
    document.getElementById('yc-year2-count').textContent = a2;
    const ccEl = document.getElementById('yc-count-change');
    const ccVal = a2 - a1;
    ccEl.textContent = `(${ccVal >= 0 ? '+' : ''}${ccVal}, %${countPct})`;
    ccEl.style.color = ccVal > 0 ? 'var(--success)' : ccVal < 0 ? 'var(--accent)' : 'var(--text-primary)';
  }

  // Detail table
  const tbody = document.getElementById('yc-table-body');
  const tempty = document.getElementById('yc-table-empty');
  if (!goster.length) {
    tbody.innerHTML = '';
    tempty.style.display = 'block';
  } else {
    tempty.style.display = 'none';
    tbody.innerHTML = goster.map(y => {
      const g = yilGiris[y] || 0;
      const c = yilCikis[y] || 0;
      const net = g - c;
      const netStr = (net >= 0 ? '+' : '') + _fmt(Math.abs(net));
      const netClass = net > 0 ? 'yc-growth' : net < 0 ? 'yc-decline' : '';
      return `<tr>
        <td style="font-weight:700;font-size:14px;">${y}</td>
        <td style="text-align:right;font-weight:700;color:var(--success);">${_fmt(g)}</td>
        <td style="text-align:right;font-weight:700;color:var(--accent);">${_fmt(c)}</td>
        <td style="text-align:right;font-weight:700;" class="${netClass}">${netStr}</td>
        <td style="text-align:right;color:var(--text-secondary);">${yilAdet[y] || 0}</td>
      </tr>`;
    }).join('');
  }

  if (!toplam) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    if (_yearCompareChart) { _yearCompareChart.destroy(); _yearCompareChart = null; }
    return;
  }
  canvas.style.display = 'block';
  if (empty) empty.style.display = 'none';

  if (_yearCompareChart) _yearCompareChart.destroy();

  const isDark = getTheme() === 'dark';
  const labelColor = isDark ? '#e2e8f0' : '#334155';

  const ycLabelPlugin = {
    id: 'ycLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const girisMeta = chart.getDatasetMeta(0);
      const cikisMeta = chart.getDatasetMeta(1);
      [girisMeta, cikisMeta].forEach((meta, di) => {
        const dataArr = di === 0 ? girisData : cikisData;
        meta.data.forEach((bar, idx) => {
          const val = dataArr[idx];
          if (!val) return;
          ctx.save();
          ctx.font = 'bold 11px Outfit, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = isDark ? '#fff' : '#0f172a';
          ctx.fillText(_fmt(val), bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    }
  };

  _yearCompareChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: goster,
      datasets: [
        {
          label: 'Giriş',
          data: girisData,
          backgroundColor: function(ctx) {
            if (!ctx.chart?.ctx) return isDark ? 'rgba(34,197,94,0.85)' : '#22c55e';
            const c = ctx.chart.ctx;
            const g = c.createLinearGradient(0, ctx.chart.height, 0, 0);
            g.addColorStop(0, isDark ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.5)');
            g.addColorStop(1, isDark ? 'rgba(34,197,94,0.85)' : '#22c55e');
            return g;
          },
          borderColor: isDark ? 'rgba(34,197,94,0.4)' : 'rgba(22,163,74,0.3)',
          borderWidth: 0,
          borderRadius: 6,
          barPercentage: goster.length > 3 ? 0.7 : 0.6,
          categoryPercentage: goster.length > 3 ? 0.8 : 0.7
        },
        {
          label: 'Çıkış',
          data: cikisData,
          backgroundColor: function(ctx) {
            if (!ctx.chart?.ctx) return isDark ? 'rgba(239,68,68,0.85)' : '#ef4444';
            const c = ctx.chart.ctx;
            const g = c.createLinearGradient(0, ctx.chart.height, 0, 0);
            g.addColorStop(0, isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.5)');
            g.addColorStop(1, isDark ? 'rgba(239,68,68,0.85)' : '#ef4444');
            return g;
          },
          borderColor: isDark ? 'rgba(239,68,68,0.4)' : 'rgba(220,38,38,0.3)',
          borderWidth: 0,
          borderRadius: 6,
          barPercentage: goster.length > 3 ? 0.7 : 0.6,
          categoryPercentage: goster.length > 3 ? 0.8 : 0.7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 32, bottom: 8 } },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          align: 'center',
          labels: {
            color: labelColor,
            font: { size: 12, weight: '600' },
            usePointStyle: true,
            padding: 14
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#fff',
          titleColor: isDark ? '#e2e8f0' : '#0f172a',
          bodyColor: isDark ? '#cbd5e1' : '#334155',
          borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${_fmt(ctx.raw)} ${birim}`
          }
        }
      },
      hover: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: labelColor, font: { size: 13, weight: '700' } }
        },
        y: {
          beginAtZero: true,
          grid: { color: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)' },
          ticks: { color: labelColor, font: { size: 11 } },
          title: {
            display: !!birim,
            text: birim,
            color: isDark ? '#94a3b8' : '#64748b',
            font: { size: 11, weight: '600' }
          }
        }
      },
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      }
    },
    plugins: [ycLabelPlugin]
  });
}

// Ürün / yıl / mod değişince grafiği yenile
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('yc-product');
  if (sel) sel.addEventListener('change', refreshYearCompare);
  const y1 = document.getElementById('yc-year1');
  const y2 = document.getElementById('yc-year2');
  if (y1) y1.addEventListener('change', refreshYearCompare);
  if (y2) y2.addEventListener('change', refreshYearCompare);
  document.querySelectorAll('.yc-mode-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.yc-mode-btn').forEach(b => {
        b.style.color = 'var(--text-muted)'; b.classList.remove('active');
      });
      this.style.color = 'var(--text-primary)'; this.classList.add('active');
      refreshYearCompare();
    });
  });
});

// ----- TOAST -----
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  el.textContent = `${icons[type] || ''} ${msg}`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ----- NAVIGASYON -----
function navigateTo(target) {
  // Admin değilse ayarlara gidemez
  if (target === 'settings-view' && !isAdmin()) {
    target = 'dashboard';
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-target="${target}"]`);
  if (navItem) navItem.classList.add('active');

  const view = document.getElementById(target);
  if (view) view.classList.add('active');

  const titles = {
    'dashboard': 'Genel Bakış', 'warehouse': 'Anbar Listesi', 'aggregated-stock': 'Depodaki Ürün Miktarları', 'entry': 'Yeni Ürün & Parti Tanımı',
    'exit': 'Ürün Çıkış', 'daily': 'Günlük İşlemler', 'month-view': 'Aylık Rapor',
    'years-view': 'Yıllık Raporlar', 'year-compare': 'Yıllık Karşılaştırma', 'stt-tracking': 'STT Takibi', 'tender-tracking': 'İhale Takip', 'suppliers': 'Tedarikçiler',     'supplier-report-view': 'Aylık Tedarikçi Raporu', 'critical-stock-view': 'Kritik Stok Listesi', 'user-guide-view': 'Kullanım Kılavuzu', 'settings-view': 'Ayarlar & Bulut', 'daily-cost': 'Günlük Maliyet'
  };
  document.getElementById('page-title').textContent = titles[target] || 'STOKDEPO';

  // view'e ozel yenilemeler (try/catch ile korunuyor)
  if (target === 'dashboard') _safe(refreshDashboard);
  if (target === 'warehouse') _safe(refreshWarehouse);
  if (target === 'aggregated-stock') _safe(refreshAggregatedStock);
  if (target === 'month-view') _safe(refreshMonthView);
  if (target === 'years-view') _safe(refreshYearsView);
  if (target === 'year-compare') _safe(refreshYearCompare);
  if (target === 'stt-tracking') _safe(refreshSttTracking);
  if (target === 'tender-tracking') _safe(refreshTenders);
  if (target === 'suppliers') { _safe(refreshSuppliers); _safe(refreshProductNames); }
  if (target === 'critical-stock-view') _safe(refreshCriticalStock);
  if (target === 'entry') _safe(refreshEntryForm);
  if (target === 'exit') _safe(refreshExitForm);
  if (target === 'daily') {
    var _ddEl = document.getElementById('daily-date');
    if (_ddEl) _ddEl.value = todayStr();
    _safe(refreshDailyView);
  }
  if (target === 'daily-cost') {
    var _dcEl = document.getElementById('daily-cost-date');
    if (_dcEl && !_dcEl.value) _dcEl.value = todayStr();
    _safe(refreshDailyCost);
  }
  if (target === 'supplier-report-view') {
    _safe(function() { populateMonthSelect('sr-month'); });
    _safe(function() { populateSupplierSelect('sr-supplier'); });
    _safe(function() { populateSupplierProductSelect('sr-product'); });
    _safe(refreshSupplierReport);
  }
  if (target === 'settings-view') _safe(refreshSettings);
  if (target === 'user-guide-view') { /* static content, no refresh needed */ }

  // URL hash'ini güncelle (yeni sekmede açılabilmesi için)
  if (target) location.hash = '#' + target;
}

// ----- AY MENÜSÜ OLUŞTUR -----
function buildMonthMenu() {
  const select = document.getElementById('months-year-select');
  const prevYil = parseInt(select.value);
  populateYearSelect('months-year-select', prevYil || new Date().getFullYear());
  const yil = parseInt(select.value) || new Date().getFullYear();
  const container = document.getElementById('months-menu');
  container.innerHTML = AYLAR.map((ay, i) => {
    const aktif = (i === AY_INDEX && yil === new Date().getFullYear()) ? ' active' : '';
    const count = ayHareketSayisi(i, yil);
    const ok = aktif ? ' <i class="fa-solid fa-chevron-left" style="font-size:10px;margin-left:3px;opacity:0.8;"></i>' : '';
    return `<a href="javascript:void(0)" class="nav-item${aktif}" data-month="${i}" data-year="${yil}" onclick="goToMonth(${i}, ${yil})">
      <i class="fa-regular fa-calendar"></i>
      <span>${ay} ${yil}${ok}</span>
      <span class="month-badge">${count}</span>
    </a>`;
  }).join('');
}

function ayHareketSayisi(ay, yil) {
  return data.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === ay && d.getFullYear() === yil && data.products[t.partiNo]?.active !== false;
  }).length;
}

function goToMonth(ay, yil) {
  window._selectedMonth = ay;
  window._selectedYear = yil;
  navigateTo('month-view');
  document.querySelectorAll('.nav-item[data-month]').forEach(n => n.classList.remove('active'));
  const el = document.querySelector(`.nav-item[data-month="${ay}"]`);
  if (el) el.classList.add('active');
}

// ----- DASHBOARD -----
function refreshDashboard() {
  try {
  // Kritik stok: ürün adı bazında grupla (toplam stok ≤ max criticalLevel)
  const prods = Object.values(data.products).filter(p => p.active !== false);
  const el = _el;
  if (el('total-varieties')) el('total-varieties').textContent = prods.length;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiringCount = prods.filter(p => p.stt).filter(p => {
    const sttDate = new Date(p.stt + 'T00:00:00');
    const fark = Math.ceil((sttDate - now) / (1000 * 60 * 60 * 24));
    return fark <= 3;
  }).length;
  if (el('total-expiring')) el('total-expiring').textContent = expiringCount;

  // Aggregate by product name
  const groups = {};
  prods.forEach(p => {
    if (!groups[p.name]) groups[p.name] = { name: p.name, totalStock: 0, maxCritical: 0, unit: p.unit || '', batchCount: 0 };
    groups[p.name].totalStock += (p.stock || 0);
    if ((p.criticalLevel || 0) > groups[p.name].maxCritical) groups[p.name].maxCritical = p.criticalLevel || 0;
    if (p.unit && !groups[p.name].unit) groups[p.name].unit = p.unit;
    groups[p.name].batchCount++;
  });
  const kritik = Object.values(groups).filter(g => g.maxCritical > 0 && g.totalStock <= g.maxCritical);
  if (el('critical-count')) el('critical-count').textContent = kritik.length;
  // critical-badge-container rengi inline style ile sabit, dinamik değişmez

  const bugun = todayStr();
  const bugunHareket = data.transactions.filter(t => t.date === bugun);
  if (el('today-transactions')) el('today-transactions').textContent = bugunHareket.length;

  // Son hareketler tablosu (tümü, en yeniler üstte)
  const tbody = document.getElementById('recent-transactions-body');
  const hareketler = [...data.transactions].reverse().slice(0, 4);
  if (!hareketler.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;">Henüz hareket kaydı yok.</td></tr>';
  } else {
    tbody.innerHTML = hareketler.map(t => {
      const silindi = data.products[t.partiNo]?.active === false;
      const tipEl = t.type === 'giris' ? '<span style="color:var(--success);font-weight:700;">GİRİŞ</span>' : t.type === 'duzeltme' ? '<span style="color:var(--warning);font-weight:700;">GÜNCELLEME</span>' : '<span style="color:var(--accent);font-weight:700;">ÇIKIŞ</span>';
      const birim = t.unit || (data.products[t.partiNo] && data.products[t.partiNo].unit) || '';
      const silindiNotu = silindi ? ' <span style="color:var(--accent);font-weight:700;">[SİLİNDİ]</span>' : '';
      return `<tr><td style="font-weight:600;">${htmlEscape(t.partiNo)}${silindiNotu}</td><td>${formatDate(t.date)}</td><td>${tipEl}</td><td>${htmlEscape(t.productName)}</td><td>${_fmt(t.amount)}</td><td>${htmlEscape(birim)}</td><td style="color:var(--text-secondary);">${htmlEscape(t.note) || '-'}</td></tr>`;
    }).join('');
  }

  // Kritik stok yan panel
  const kritikDiv = document.getElementById('critical-stock-list');
  if (!kritik.length) {
    kritikDiv.innerHTML = '<p style="color:var(--text-secondary);text-align:center;font-size:0.9rem;">✅ Tüm stoklar normal seviyede.</p>';
  } else {
    kritikDiv.innerHTML = kritik.slice(0, 3).map(g => `
      <div style="display:flex;align-items:center;gap:12px;background:var(--warning-light);padding:12px;border-radius:var(--border-radius-sm);border:1px solid rgba(234,179,8,0.2);">
        <i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);font-size:18px;"></i>
        <div style="flex:1;"><strong>${htmlEscape(g.name)}</strong><br><span style="font-size:13px;color:var(--text-secondary);">Toplam Stok: ${_fmt(g.totalStock)} / Limit: ${g.maxCritical} ${htmlEscape(g.unit)} (${g.batchCount} parti)</span></div>
        <span style="background:#422006;color:var(--warning);padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;">KRİTİK</span>
      </div>
    `).join('');
  }

  // Tarihi Yaklaşan / Geçen Ürünler
  const expiring = Object.values(data.products).filter(p => p.active !== false && p.stt).map(p => {
    const sttDate = new Date(p.stt + 'T00:00:00');
    const fark = Math.ceil((sttDate - now) / (1000 * 60 * 60 * 24));
    return { ...p, sttGunFark: fark };
  }).filter(p => p.sttGunFark <= 3);
  expiring.sort((a, b) => a.sttGunFark - b.sttGunFark);

  const expDiv = document.getElementById('expiring-products-list');
  if (!expiring.length) {
    expDiv.innerHTML = '<p style="color:var(--text-secondary);text-align:center;font-size:0.9rem;">ℹ️ 3 gün içinde son kullanma tarihi yaklaşan ürün yok.</p>';
  } else {
    expDiv.innerHTML = expiring.map(p => {
      const gecti = p.sttGunFark < 0;
      const uyari = gecti ? 'GEÇTİ' : (p.sttGunFark === 0 ? 'BUGÜN' : p.sttGunFark + ' gün');
      const bg = gecti ? 'var(--accent)' : 'var(--warning)';
      const bgLight = gecti ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)';
      return `
      <div style="display:flex;align-items:center;gap:12px;background:${bgLight};padding:12px;border-radius:var(--border-radius-sm);border:1px solid ${bg}40;">
        <i class="fa-regular fa-clock" style="color:${bg};font-size:18px;"></i>
        <div style="flex:1;"><strong>${htmlEscape(p.name)}</strong> [${htmlEscape(p.partiNo)}]<br><span style="font-size:13px;color:var(--text-secondary);">STT: ${formatDate(p.stt)} — Stok: ${_fmt(p.stock)} ${htmlEscape(p.unit)}</span></div>
        <span style="background:${bg};color:#fff;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;">${uyari}</span>
      </div>`;
    }).join('');
  }

  // Kategori Dağılımı (normalize edilmiş)
  const catMap = [
    { names: ['Sebze','Sebzeler','Sebze Grubu','Yeşillik'], key: 'Sebze', color: '#22c55e' },
    { names: ['Meyve','Meyveler','Meyve Grubu'], key: 'Meyve', color: '#f97316' },
    { names: ['Bakliyat','Baklagil','Baklagiller','Kuru Baklagil'], key: 'Bakliyat', color: '#8b5cf6' },
    { names: ['Temel Gıda','Temel Gida','Gıda','Kuru Gıda'], key: 'Temel Gıda', color: '#3b82f6' },
    { names: ['Temizlik','Temizlik Malzemesi','Temizlik Ürünü','Hijyen'], key: 'Temizlik', color: '#14b8a6' },
    { names: ['Süt Ürünleri','Sut Urunleri','Süt','Sut','Peynir','Yoğurt'], key: 'Süt Ürünleri', color: '#f472b6' }
  ];
  const catLookup = {};
  catMap.forEach(g => { g.names.forEach(n => { catLookup[n.toLowerCase()] = g.key; }); });
  const catKeys = catMap.map(g => g.key);
  const catColors = {};
  catMap.forEach(g => { catColors[g.key] = g.color; });
  catColors['Diğer'] = '#64748b';
  const catCount = {};
  catKeys.forEach(c => catCount[c] = 0);
  catCount['Diğer'] = 0;
  Object.values(data.products).filter(p => p.active !== false).forEach(p => {
    const raw = (p.category || '').trim().toLowerCase();
    const normalized = catLookup[raw] || 'Diğer';
    catCount[normalized]++;
  });
  const catTotal = Object.values(catCount).reduce((s, v) => s + v, 0);
  const catOrder = [...catKeys, 'Diğer'];
  const catCanvas = document.getElementById('category-chart-canvas');
  const catEmpty = document.getElementById('category-chart-empty');
  if (!catTotal) {
    catCanvas.style.display = 'none';
    catEmpty.style.display = 'block';
  } else {
    catCanvas.style.display = 'block';
    catEmpty.style.display = 'none';
    if (window._catChart) window._catChart.destroy();

    const isDark = getTheme() === 'dark';
    const labelColor = isDark ? '#e2e8f0' : '#334155';
    const catLabels = catOrder;
    const catData = catOrder.map(c => catCount[c] || 0);
    const catBgColors = catOrder.map(c => catColors[c]);
    const catBgTransparent = catBgColors.map(c => c + 'CC');

    // Legend
    document.getElementById('category-chart-legend').innerHTML = catLabels.map((l, i) => `
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${catBgColors[i]};flex-shrink:0;"></div>
        <span style="font-size:12px;font-weight:600;color:${isDark ? '#94a3b8' : '#64748b'};">${l}</span>
        <span style="font-size:11px;font-weight:700;color:${labelColor};">${catData[i]}</span>
      </div>
    `).join('');

    // Dilim etiketi
    const catLabelPlugin = {
      id: 'catLabel',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((arc, idx) => {
          const val = catData[idx];
          if (!val) return;
          const angle = (arc.startAngle + arc.endAngle) / 2;
          const radius = arc.outerRadius * 0.55;
          const tx = arc.x + Math.cos(angle) * radius;
          const ty = arc.y + Math.sin(angle) * radius;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 15px Outfit, Arial, sans-serif';
          ctx.fillStyle = '#fff';
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = 5;
          ctx.fillText(val, tx, ty);
          ctx.restore();
        });
      }
    };

    window._catChart = new Chart(catCanvas, {
      type: 'polarArea',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: catBgTransparent,
          borderColor: isDark ? '#1e293b' : '#fff',
          borderWidth: 2,
          hoverBorderWidth: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.0,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            titleColor: isDark ? '#e2e8f0' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: ctx => {
                const pct = catTotal > 0 ? ((ctx.parsed.r / catTotal) * 100).toFixed(1) : '0';
                return ` ${ctx.label}: ${ctx.parsed.r} çeşit (%${pct})`;
              }
            }
          }
        },
        scales: {
            r: {
              grid: {
                color: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.12)'
              },
            ticks: { display: false }
          }
        },
        animation: {
          duration: 800,
          easing: 'easeOutQuart',
          delay(ctx) {
            return ctx.dataIndex * 100;
          }
        }
      },
      plugins: [catLabelPlugin]
    });
  }

  // Hızlı Bilgiler (horizontal bar)
  const sttOlan = prods.filter(p => p.stt).length;
  const tedarikciSayisi = data.companies.length;
  const toplamIslem = data.transactions.length;
  const bugunHareketAdet = bugunHareket.length;
  const qiContainer = document.getElementById('quick-info-list');
  qiContainer.innerHTML = `<canvas id="quick-info-canvas"></canvas>`;
  if (window._qiChart) window._qiChart.destroy();

  const isDark = getTheme() === 'dark';
  const qiLabels = ["STT'li Ürün", 'Tedarikçi', 'Toplam İşlem', 'Bugünkü İşlem', 'Ürün Listesi'];
  const qiData = [sttOlan, tedarikciSayisi, toplamIslem, bugunHareketAdet, (data.productNames || []).length];
  const qiColors = ['#3b82f6', '#2563eb', '#a78bfa', '#94a3b8', '#10b981'];

  const qiLabelPlugin = {
    id: 'qiLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      ctx.font = 'bold 12px Outfit, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      meta.data.forEach((bar, idx) => {
        const val = qiData[idx];
        if (!val) return;
        ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
        ctx.textAlign = 'right';
        ctx.fillText(val, bar.x - 6, bar.y);
      });
    }
  };

  window._qiChart = new Chart(document.getElementById('quick-info-canvas'), {
    type: 'bar',
    data: {
      labels: qiLabels,
      datasets: [{
        data: qiData,
        backgroundColor: qiColors.map(c => isDark ? c + 'CC' : c),
        borderColor: qiColors,
        borderWidth: 0,
        borderRadius: 6,
        barPercentage: 0.9,
        categoryPercentage: 0.95
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: 0
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#fff',
          titleColor: isDark ? '#e2e8f0' : '#0f172a',
          bodyColor: isDark ? '#cbd5e1' : '#334155',
          borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          padding: 8,
          cornerRadius: 6,
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} adet`
          }
        }
      },
      scales: {
        x: {
          reverse: true,
          beginAtZero: true,
          grid: { color: isDark ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.05)' },
          ticks: { display: false }
        },
        y: {
          position: 'right',
          grid: { display: false },
          ticks: { color: isDark ? '#e2e8f0' : '#334155', font: { size: 11, weight: '600' } }
        }
      },
      animation: {
        duration: 600,
        easing: 'easeOutQuart'
      }
    },
    plugins: [qiLabelPlugin]
  });

  // İhale Çekilme Yüzdeleri Grafiği (bar)
  const canvas = document.getElementById('tender-chart-canvas');
  const emptyMsg = document.getElementById('tender-chart-empty');
  const tenderYil = new Date().getFullYear();
  const firmaToplam = {};
  (data.tenders || []).filter(t => t.quantity > 0 && (t.year || new Date().getFullYear()) === tenderYil).forEach(t => {
    if (!firmaToplam[t.companyName]) firmaToplam[t.companyName] = { quantity: 0, delivered: 0 };
    firmaToplam[t.companyName].quantity += t.quantity;
    firmaToplam[t.companyName].delivered += (t.delivered || 0);
  });
  const ihaleVeri = Object.keys(firmaToplam).map(name => {
    const { quantity, delivered } = firmaToplam[name];
    return { label: name, pct: Math.min(100, Math.round((delivered / quantity) * 100)) };
  });
  if (!ihaleVeri.length) {
    canvas.style.display = 'none';
    emptyMsg.style.display = 'block';
  } else {
    canvas.style.display = 'block';
    emptyMsg.style.display = 'none';
    if (window._tenderChart) window._tenderChart.destroy();

    const isDark = getTheme() === 'dark';
    const labelColor = isDark ? '#e2e8f0' : '#334155';
    const blueScale = ['#3b82f6', '#60a5fa', '#2563eb', '#93c5fd', '#1d4ed8', '#7dd3fc', '#1e40af', '#bae6fd'];
    const barColors = ihaleVeri.map((_, i) => blueScale[i % blueScale.length]);

    const barLabelPlugin = {
      id: 'barLabel',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          meta.data.forEach((bar, idx) => {
            const val = ds.data[idx];
            if (!val) return;
            ctx.save();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 11px Outfit, Arial, sans-serif';
            ctx.fillStyle = isDark ? '#fff' : '#0f172a';
            ctx.fillText('%' + val, bar.x + 4, bar.y);
            ctx.restore();
          });
        });
      }
    };

    window._tenderChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ihaleVeri.map(v => v.label),
        datasets: [{
          label: 'Çekilme %',
          data: ihaleVeri.map(v => v.pct),
          backgroundColor: barColors,
          borderColor: barColors,
          borderWidth: 0,
          borderRadius: 6,
          barPercentage: 0.9,
          categoryPercentage: 0.95
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: 0
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            titleColor: isDark ? '#e2e8f0' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            callbacks: {
              label: ctx => ctx.parsed.x + '% teslimat'
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            grid: { color: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(0,0,0,0.08)' },
            ticks: { callback: v => v + '%', color: labelColor, font: { size: 9 } }
          },
          y: {
            grid: { display: false },
            ticks: { color: labelColor, font: { size: 10, weight: 'bold' } }
          }
        }
      },
      plugins: [barLabelPlugin]
    });
  }
  } catch (e) { console.error('refreshDashboard hatası:', e); }
}

// ----- ANBAR / WAREHOUSE -----
let _warehouseFilter = 'ALL';
let _hideZeroStock = false;
let _onlyCritical = false;
let _showDeletedProducts = false;

function sttDurum(stt) {
  if (!stt) return { text: '-', cls: '' };
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const sttDate = new Date(stt + 'T00:00:00');
  const fark = Math.ceil((sttDate - bugun) / (1000 * 60 * 60 * 24));
  const goster = formatDate(stt);
  if (fark < 0) return { text: goster + ' (GEÇTİ)', cls: 'color:var(--accent);font-weight:800;' };
  if (fark <= 3) return { text: goster + ' (' + fark + ' gün)', cls: 'color:var(--warning);font-weight:700;' };
  return { text: goster, cls: '' };
}

function _el(id) { return document.getElementById(id); }
function _safe(fn) { try { return fn(); } catch (e) { console.error('Hata:', e); } }

function refreshWarehouse() {
  const prods = Object.values(data.products).filter(p => _showDeletedProducts ? true : p.active !== false);
  const searchEl = _el('anbar-search');
  const search = (searchEl ? searchEl.value : '').toLowerCase();

  let filtered = prods;
  if (_warehouseFilter !== 'ALL') filtered = filtered.filter(p => p.category === _warehouseFilter);
  if (_hideZeroStock) filtered = filtered.filter(p => p.stock > 0);
  if (_onlyCritical) filtered = filtered.filter(p => p.criticalLevel > 0 && p.stock <= p.criticalLevel);
  if (search) filtered = filtered.filter(p => p.name.toLowerCase().includes(search) || p.partiNo.toLowerCase().includes(search));

  // Filtre durumunu göster
  const badge = _el('filter-active-badge');
  const aktifFiltreler = [];
  if (_hideZeroStock) aktifFiltreler.push('Sıfır stok gizli');
  if (_onlyCritical) aktifFiltreler.push('Kritik altı');
  if (_warehouseFilter !== 'ALL') aktifFiltreler.push('Kategori: ' + _warehouseFilter);
  if (badge) {
    if (aktifFiltreler.length) {
      badge.style.display = 'inline';
      badge.textContent = '🔍 ' + aktifFiltreler.join(' | ');
    } else {
      badge.style.display = 'none';
    }
  }

  const colCount = 9;
  const tbody = _el('anbar-body');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="' + colCount + '" style="text-align:center;color:var(--text-muted);padding:40px;">Eşleşen ürün bulunamadı.</td></tr>';
    return;
  }

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  tbody.innerHTML = filtered.map(p => {
    const kritik = p.criticalLevel > 0 && p.stock <= p.criticalLevel;
    const stokClass = kritik ? 'color:var(--accent);font-weight:800;' : '';
    const stt = sttDurum(p.stt);
    const eslesenIhale = (data.tenders || []).filter(t => t.companyName === p.companyName && t.product === p.name);
    const ihaleKalan = eslesenIhale.reduce((top, t) => top + (t.quantity - t.delivered), 0);
    const ihaleGoster = ihaleKalan > 0 ? `<span style="color:var(--primary);font-weight:600;">${_fmt(ihaleKalan)} ${htmlEscape(p.unit)}</span>` : '<span style="color:var(--text-muted);font-size:12px;">—</span>';
    return `<tr>
      <td style="font-weight:600;color:var(--primary);">${htmlEscape(p.partiNo)}</td>
      <td><span style="background:var(--primary-light);color:var(--primary);padding:2px 10px;border-radius:999px;font-size:12px;">${htmlEscape(p.category)}</span></td>
      <td><strong>${htmlEscape(p.name)}</strong></td>
      <td style="${stokClass}">${_fmt(p.stock)} ${htmlEscape(p.unit)}</td>
      <td>${htmlEscape(p.unit)}</td>
      <td>${ihaleGoster}</td>
      <td>${_fmt(p.criticalLevel)}</td>
      <td style="${stt.cls}">${stt.text}</td>
      <td style="text-align:right;">
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="editProduct('${htmlEscape(p.partiNo)}')" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-ui btn-sm btn-outline" onclick="deleteProduct('${htmlEscape(p.partiNo)}')" title="Sil" style="color:var(--accent);"><i class="fa-solid fa-trash-can"></i></button>`}
      </td>
    </tr>`;
  }).join('');
}

// ----- DEPODAKİ ÜRÜN MİKTARLARI (ÜRÜN ADI BAZINDA TOPLAMA) -----
function refreshAggregatedStock() {
  const prods = Object.values(data.products).filter(p => p.active !== false);
  const search = (document.getElementById('agg-stock-search')?.value || '').toLowerCase();
  const catFilter = document.getElementById('agg-stock-category')?.value || '';

  // Kategori filtre dropdown'ı doldur (ilk çağrıda)
  const catSelect = document.getElementById('agg-stock-category');
  if (catSelect && !catSelect.dataset.ready) {
    catSelect.dataset.ready = '1';
    const cats = [...new Set(prods.map(p => p.category).filter(Boolean))].sort();
    catSelect.innerHTML = '<option value="">Tüm Kategoriler</option>' + cats.map(c => `<option value="${htmlEscape(c)}">${htmlEscape(c)}</option>`).join('');
  }

  // Ürün adı bazında grupla
  const groups = {};
  prods.forEach(p => {
    if (!groups[p.name]) groups[p.name] = { name: p.name, totalStock: 0, unit: p.unit || '', categories: new Set(), batchCount: 0, sttDates: [] };
    groups[p.name].totalStock += p.stock;
    groups[p.name].batchCount++;
    if (p.category) groups[p.name].categories.add(p.category);
    if (p.unit && !groups[p.name].unit) groups[p.name].unit = p.unit;
    if (p.stt) groups[p.name].sttDates.push(p.stt);
  });

  let entries = Object.values(groups);

  // Kategori filtre
  if (catFilter) entries = entries.filter(e => e.categories.has(catFilter));
  // Arama filtre
  if (search) entries = entries.filter(e => e.name.toLowerCase().includes(search));

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const countEl = document.getElementById('agg-stock-count');
  if (countEl) countEl.textContent = entries.length + ' ürün';

  // Legend
  const legend = document.getElementById('agg-stock-legend');
  if (legend) {
    const allCats = [...new Set(entries.flatMap(e => [...e.categories]))].sort();
    if (allCats.length) {
      const catColors = { 'Sebze':'#22c55e','Meyve':'#f97316','Bakliyat':'#8b5cf6','Temel Gıda':'#3b82f6','Temizlik':'#14b8a6','Süt Ürünleri':'#f472b6' };
      legend.innerHTML = allCats.map(c => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:${catColors[c] || '#a1a1aa'};"><span style="width:10px;height:10px;border-radius:50%;background:${catColors[c] || '#a1a1aa'};display:inline-block;"></span>${htmlEscape(c)}</span>`).join(' | ');
    } else {
      legend.innerHTML = '';
    }
  }

  const tbody = document.getElementById('agg-stock-body');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px;">Eşleşen ürün bulunamadı.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map((e, i) => {
    const sttVals = e.sttDates.filter(Boolean).sort();
    const enErken = sttVals.length ? formatDate(sttVals[0]) : '—';
    const enGec = sttVals.length ? formatDate(sttVals[sttVals.length - 1]) : '—';
    const catStr = [...e.categories].join(', ');
    return `<tr>
      <td style="color:var(--text-muted);">${i + 1}</td>
      <td><strong>${htmlEscape(e.name)}</strong></td>
      <td style="font-weight:700;color:var(--primary);">${_fmt(e.totalStock)}</td>
      <td>${htmlEscape(e.unit || '—')}</td>
      <td>${e.batchCount}</td>
      <td style="font-size:13px;color:var(--text-secondary);">${htmlEscape(catStr || '—')}</td>
      <td style="font-size:13px;">${enErken}</td>
      <td style="font-size:13px;">${enGec}</td>
    </tr>`;
  }).join('');
}

// Kategori filtreleme + Anbar filtre butonları
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('category-filter-container').addEventListener('click', (e) => {
    if (e.target.classList.contains('category-tag')) {
      document.querySelectorAll('.category-tag').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      _warehouseFilter = e.target.dataset.category;
      refreshWarehouse();
    }
  });

  document.getElementById('anbar-search').addEventListener('input', refreshWarehouse);

  document.getElementById('filter-zero-btn').addEventListener('click', () => {
    _hideZeroStock = !_hideZeroStock;
    document.getElementById('filter-zero-btn').classList.toggle('active', _hideZeroStock);
    refreshWarehouse();
  });

  document.getElementById('filter-critical-btn').addEventListener('click', () => {
    _onlyCritical = !_onlyCritical;
    document.getElementById('filter-critical-btn').classList.toggle('active', _onlyCritical);
    if (_onlyCritical) document.getElementById('filter-zero-btn').classList.remove('active');
    refreshWarehouse();
  });

  document.getElementById('filter-deleted-btn').addEventListener('click', () => {
    _showDeletedProducts = !_showDeletedProducts;
    document.getElementById('filter-deleted-btn').classList.toggle('active', _showDeletedProducts);
    refreshWarehouse();
  });
});

// ----- LISTE AL (DISARI AKTAR) -----
function _exportData() {
  const prods = Object.values(data.products).filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const now = new Date(); now.setHours(0,0,0,0);
  return prods.map(p => {
    const fark = p.stt ? Math.ceil((new Date(p.stt+'T00:00:00') - now) / (1000*60*60*24)) : '';
    const sttDurum = fark !== '' ? (fark < 0 ? 'GEÇTİ' : fark + ' gün') : '—';
    const stokBitti = p.stock <= 0 ? ' STOKTA BİTTİ' : '';
    const eslesenIhale = (data.tenders || []).filter(t => t.companyName === p.companyName && t.product === p.name);
    const ihaleKalan = eslesenIhale.reduce((top, t) => top + (t.quantity - t.delivered), 0);
    return { ...p, sttDurum, stokBitti, ihaleKalan };
  });
}

function _htmlExcelBlob(rows, headers, fileName) {
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const attr = ' style="border:1px solid #ccc;padding:6px 8px;"';
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sayfa1</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>';
  html += '<tr>' + headers.map(h => '<th' + attr + '>' + esc(h) + '</th>').join('') + '</tr>';
  rows.forEach(r => {
    html += '<tr>' + r.map(v => '<td' + attr + '>' + esc(v) + '</td>').join('') + '</tr>';
  });
  html += '</table></body></html>';
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportXLSX() {
  const rows = _exportData();
  const headers = ['Parti No','Kategori','Ürün Adı','Stok Miktarı','Birim','İhale Kalan','Kritik Limit','STT','STT Durumu','Durum'];
  const data = rows.map(p => {
    const durum = p.stokBitti ? p.stokBitti.trim() : (p.stock <= p.criticalLevel ? 'KRİTİK' : '');
    return [p.partiNo, p.category, p.name, _fmt(p.stock), p.unit,
      p.ihaleKalan > 0 ? _fmt(p.ihaleKalan) + ' ' + p.unit : '—',
      p.criticalLevel, formatDate(p.stt) || '—', p.sttDurum, durum];
  });
  _htmlExcelBlob(data, headers, 'stok_listesi.xls');
  toast('Excel dosyası indirildi.', 'success');
}

function exportWord() {
  const rows = _exportData();
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>Stok Listesi</title></head>
<body><h2>Stok Listesi</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:13px;width:100%;">
<thead><tr style="background:#e2e8f0;">
<th>Parti No</th><th>Kategori</th><th>Ürün Adı</th><th>Stok</th><th>Birim</th><th>İhale Kalan</th><th>Kritik Limit</th><th>STT</th><th>STT Durumu</th><th>Durum</th>
</tr></thead>
<tbody>${rows.map(p => {
    const durum = p.stokBitti ? p.stokBitti : (p.stock <= p.criticalLevel ? ' KRİTİK' : '');
    return `<tr><td>${p.partiNo}</td><td>${p.category}</td><td>${p.name}</td><td align="right">${_fmt(p.stock)}</td><td>${p.unit}</td><td align="right">${p.ihaleKalan > 0 ? _fmt(p.ihaleKalan) + ' ' + p.unit : '—'}</td><td align="right">${p.criticalLevel}</td><td>${formatDate(p.stt) || '—'}</td><td>${p.sttDurum}</td><td>${durum.trim()}</td></tr>`;
  }).join('\n')}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stok_listesi.doc';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Word dosyası indirildi.', 'success');
}

function exportPrint() {
  const rows = _exportData();
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Stok Listesi - Yazdır</title>
    <style>
      body { font-family:Arial; padding:20px; }
      h2 { margin-bottom:12px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th, td { border:1px solid #ccc; padding:6px 8px; text-align:left; }
      th { background:#e2e8f0; }
      .bitti { color:red; font-weight:700; }
    </style></head>
    <body><h2>Stok Listesi</h2>
    <table><thead><tr>
      <th>Parti No</th><th>Kategori</th><th>Ürün Adı</th><th>Stok</th><th>Birim</th><th>İhale Kalan</th><th>Kritik</th><th>STT</th><th>STT Durumu</th><th>Durum</th>
    </tr></thead>
    <tbody>${rows.map(p => {
      const durum = p.stokBitti ? 'STOKTA BİTTİ' : (p.stock <= p.criticalLevel ? 'KRİTİK' : '');
      const cls = p.stokBitti ? ' class="bitti"' : '';
      return `<tr${cls}><td>${htmlEscape(p.partiNo)}</td><td>${htmlEscape(p.category)}</td><td>${htmlEscape(p.name)}</td><td align="right">${_fmt(p.stock)}</td><td>${htmlEscape(p.unit)}</td><td align="right">${p.ihaleKalan > 0 ? _fmt(p.ihaleKalan) + ' ' + htmlEscape(p.unit) : '—'}</td><td align="right">${p.criticalLevel}</td><td>${formatDate(p.stt) || '—'}</td><td>${htmlEscape(p.sttDurum)}</td><td>${htmlEscape(durum)}</td></tr>`;
    }).join('\n')}</tbody></table>
    <p style="margin-top:20px;color:#888;font-size:11px;">Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}</p>
    <script>window.print();<\/script>
    </body></html>
  `);
  w.document.close();
}

// ----- STT LISTE AL -----
function _sttExportData() {
  const now = new Date(); now.setHours(0,0,0,0);
  return Object.values(data.products).filter(p => p.active !== false && p.stt).map(p => {
    const sttDate = new Date(p.stt + 'T00:00:00');
    const fark = Math.ceil((sttDate - now) / (1000*60*60*24));
    const uyari = fark < 0 ? 'GEÇTİ' : (fark === 0 ? 'BUGÜN' : fark + ' gün');
    const durum = (p.stock <= 0) ? 'STOKTA BİTTİ' : (p.criticalLevel > 0 && p.stock <= p.criticalLevel ? 'KRİTİK' : '—');
    return [p.partiNo, p.name, formatDate(p.stt), uyari, _fmt(p.stock) + ' ' + p.unit, durum];
  });
}

function sttExportXLSX() {
  const rows = _sttExportData();
  _htmlExcelBlob(rows, ['Parti No','Ürün','STT','Kalan Gün','Stok','Durum'], 'stt_takip.xls');
  toast('Excel dosyası indirildi.', 'success');
}
function sttExportWord() {
  const rows = _sttExportData();
  const esc = htmlEscape;
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>STT Takip</title></head>
<body><h2>STT Takip Listesi</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:13px;width:100%;">
<thead><tr style="background:#e2e8f0;"><th>Parti No</th><th>Ürün</th><th>STT</th><th>Kalan Gün</th><th>Stok</th><th>Durum</th></tr></thead>
<tbody>${rows.map(r => '<tr><td>' + r.map(esc).join('</td><td>') + '</td></tr>').join('\n')}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'stt_takip.doc'; a.click();
  URL.revokeObjectURL(a.href);
  toast('Word dosyası indirildi.', 'success');
}
function sttExportPrint() {
  const rows = _sttExportData();
  const esc = htmlEscape;
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>STT Takip - Yazdır</title>
    <style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;font-size:12px;}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}th{background:#e2e8f0;}</style></head>
    <body><h2>STT Takip Listesi</h2>
    <table><thead><tr><th>Parti No</th><th>Ürün</th><th>STT</th><th>Kalan Gün</th><th>Stok</th><th>Durum</th></tr></thead>
    <tbody>${rows.map(r => '<tr><td>' + r.map(esc).join('</td><td>') + '</td></tr>').join('\n')}</tbody></table>
    <p style="margin-top:20px;color:#888;font-size:11px;">Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}</p>
    <script>window.print();<\/script></body></html>`);
  w.document.close();
}

// Dropdown ac/kapa
function _toggleMenu(btnId, menuId) {
  const menu = document.getElementById(menuId);
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}
function _closeMenu(menuId) {
  const el = document.getElementById(menuId);
  if (el) el.style.display = 'none';
}

document.addEventListener('click', (e) => {
  // Anbar export
  if (e.target.closest('#export-btn')) { _toggleMenu('export-btn', 'export-menu'); return; }
  if (!e.target.closest('.export-dropdown') && !e.target.closest('.export-menu')) {
    _closeMenu('export-menu');
  }
  const opt = e.target.closest('.export-option');
  if (opt) {
    _closeMenu('export-menu');
    const fmt = opt.dataset.format;
    if (fmt === 'xlsx') exportXLSX();
    else if (fmt === 'word') exportWord();
    else if (fmt === 'print') exportPrint();
  }
  // STT export
  if (e.target.closest('#stt-export-btn')) { _toggleMenu('stt-export-btn', 'stt-export-menu'); return; }
  if (!e.target.closest('.export-dropdown') && !e.target.closest('#stt-export-menu')) {
    _closeMenu('stt-export-menu');
  }
  const sopt = e.target.closest('.stt-export-option');
  if (sopt) {
    _closeMenu('stt-export-menu');
    const fmt = sopt.dataset.format;
    if (fmt === 'xlsx') sttExportXLSX();
    else if (fmt === 'word') sttExportWord();
    else if (fmt === 'print') sttExportPrint();
  }
  // Kritik stok export
  if (e.target.closest('#critical-export-btn')) { _toggleMenu('critical-export-btn', 'critical-export-menu'); return; }
  if (!e.target.closest('.export-dropdown') && !e.target.closest('#critical-export-menu')) {
    _closeMenu('critical-export-menu');
  }
  const copt = e.target.closest('.critical-export-option');
  if (copt) {
    _closeMenu('critical-export-menu');
    const fmt = copt.dataset.format;
    if (fmt === 'xlsx') criticalExportXLSX();
    else if (fmt === 'word') criticalExportWord();
    else if (fmt === 'print') criticalExportPrint();
  }
});

// ----- ÜRÜN CRUD -----
// ----- PARTI NO (BATCH) OLUŞTURMA -----
function generateBatchPrefix() {
  const now = new Date();
  const yil = String(now.getFullYear()).slice(-2);
  const baslangic = new Date(Date.UTC(now.getFullYear(), 0, 4));
  const gunFarki = ((now.getTime() - baslangic.getTime()) / 86400000 + baslangic.getDay() + 1) / 7;
  const hafta = String(Math.ceil(gunFarki)).padStart(2, '0');
  const gun = now.getDay() === 0 ? 7 : now.getDay();
  return 'A' + yil + hafta + gun + '1';
}

function nextBatchNoSeq() {
  if (!data.settings.batchCounters) data.settings.batchCounters = {};
  const bugun = todayStr();
  if (!data.settings.batchCounters[bugun]) data.settings.batchCounters[bugun] = 0;
  data.settings.batchCounters[bugun]++;
  return data.settings.batchCounters[bugun];
}

function openProductModal(editPartiNo) {
  const modal = document.getElementById('new-product-modal');
  const form = document.getElementById('new-product-form');
  form.reset();
  document.getElementById('np-is-edit').value = 'false';
  document.getElementById('submit-product-btn').innerHTML = '<i class="fa-solid fa-save"></i> Kartı Oluştur';

  if (editPartiNo) {
    const p = data.products[editPartiNo];
    if (!p) return;
    document.getElementById('np-is-edit').value = 'true';
    document.getElementById('np-id').value = p.partiNo;
    document.getElementById('np-id').readOnly = true;
    document.getElementById('np-name').value = p.name;
    document.getElementById('np-category').value = p.category;
    document.getElementById('np-unit').value = p.unit;
    document.getElementById('np-stock').value = _fmt(p.stock);
    document.getElementById('np-critical').value = p.criticalLevel;
    document.getElementById('np-stt').value = p.stt || '';
    document.getElementById('submit-product-btn').innerHTML = '<i class="fa-solid fa-pen"></i> Kartı Güncelle';
  } else {
    document.getElementById('np-id').readOnly = false;
    document.getElementById('np-id').value = generateBatchPrefix() + '??';
    document.getElementById('np-stt').value = '';
  }

  // Tedarikçi dropdown'ını doldur
  const companySelect = document.getElementById('np-company');
  if (companySelect) {
    const secili = editPartiNo ? data.products[editPartiNo]?.companyName || '' : '';
      companySelect.innerHTML = '<option value="">Tedarikçi Seçin</option>' +
      (data.companies || []).map(c => `<option value="${htmlEscape(c)}"${c === secili ? ' selected' : ''}>${htmlEscape(c)}</option>`).join('');
  }

  // Ürün isim dropdown'ını doldur
  const nameSelect = document.getElementById('np-name');
  if (nameSelect) {
    const seciliName = editPartiNo ? data.products[editPartiNo]?.name || '' : '';
    let options = '<option value="">Ürün Adı Seçin</option>' +
      (data.productNames || []).map(n => `<option value="${htmlEscape(n)}"${n === seciliName ? ' selected' : ''}>${htmlEscape(n)}</option>`).join('');
    // Düzenleme modunda isim listede yoksa ekle
    if (editPartiNo && seciliName && !(data.productNames || []).includes(seciliName)) {
      options += `<option value="${htmlEscape(seciliName)}" selected>${htmlEscape(seciliName)} (listedışı)</option>`;
    }
    nameSelect.innerHTML = options;
  }

  modal.classList.add('show');
  _csRefresh('np-company');
  _csRefresh('np-name');
}

function editProduct(partiNo) { openProductModal(partiNo); }

// Ürün modalını kapat
document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('new-product-modal').classList.remove('show');
});
document.getElementById('new-product-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.target.classList.remove('show');
});

// Modal içindeki + butonu ile ürün ismi ekle
const modalAddNameBtn = document.getElementById('add-product-name-from-modal');
if (modalAddNameBtn) {
  modalAddNameBtn.addEventListener('click', () => {
    const yeniIsim = prompt('Yeni ürün adını girin:');
    if (yeniIsim && yeniIsim.trim()) {
      const name = yeniIsim.trim();
  if (!data.productNames) data.productNames = [];
      if (data.productNames.includes(name)) { toast('Bu isim zaten listede.', 'warning'); return; }
      const unit = prompt(`"${name}" için birim girin (kg, adet, litre, paket, koli, teneke, torba, şişe):`, 'kg');
      data.productNames.push(name);
      if (unit && unit.trim()) {
        if (!data.productUnits) data.productUnits = {};
        data.productUnits[name] = unit.trim();
      }
      data.productNames.sort((a, b) => a.localeCompare(b));
      saveData();
      refreshProductNames();
      // Seçili yap
      const ns = document.getElementById('np-name');
      if (ns) ns.value = name;
      _csRefresh('np-name');
      toast('Ürün ismi eklendi.', 'success');
    }
  });
}

// Ürün kaydet
document.getElementById('new-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isViewOnly()) { toast('Görüntüleme modunda ürün ekleyemezsiniz.', 'error'); return; }

  // Supabase'ten son veriyi çek
  if (isSupabaseReady()) {
    try { const r = await supabaseLoad(); if (r) { data.products = r.products || {}; } } catch (e) { /* sessiz */ }
  }

  const isEdit = document.getElementById('np-is-edit').value === 'true';
  let partiNo = document.getElementById('np-id').value.trim().toUpperCase();
  // Yeni ürünse ?? yerine sıra numarası koy
  if (!isEdit && partiNo.endsWith('??')) {
    partiNo = partiNo.slice(0, -2) + String(nextBatchNoSeq()).padStart(2, '0');
    document.getElementById('np-id').value = partiNo;
  }
  const name = document.getElementById('np-name').value.trim();
  const category = document.getElementById('np-category').value;
  const unit = document.getElementById('np-unit').value;
  const stock = _parseAmount(document.getElementById('np-stock').value) || 0;
  const critical = parseInt(document.getElementById('np-critical').value) || 0;
  const stt = document.getElementById('np-stt').value || '';
  const companyName = document.getElementById('np-company').value.trim().toUpperCase() || '';

  if (!partiNo || !name || !companyName) {
    toast('Parti No, ürün adı ve tedarikçi gerekli!', 'error');
    if (!companyName) {
      const cs = document.querySelector('#np-company + .cs-btn');
      if (cs) cs.focus(); else document.getElementById('np-company').focus();
    }
    return;
  }
  if (stt && !isValidDate(stt)) { toast('Geçersiz STT tarihi!', 'error'); return; }

  if (isEdit) {
    const p = data.products[partiNo];
    if (p) {
      const fark = stock - p.stock;
      p.name = name; p.category = category; p.unit = unit;
      p.stock = stock; p.criticalLevel = critical; p.stt = stt; p.companyName = companyName;

      // Stok değişimini ihaleye işle (artış/azalış)
      if (fark !== 0 && p.companyName && data.tenders && data.tenders.length) {
        const eslesen = data.tenders.filter(t =>
          t.companyName === p.companyName && t.product === p.name
        );
        eslesen.forEach(t => { t.delivered = Math.max(0, t.delivered + fark); });
        if (eslesen.length) {
          await saveData();
          const yon = fark > 0 ? 'işlendi' : 'düşüldü';
          toast(`${_fmt(Math.abs(fark))} ${p.unit} "${p.companyName}" ihaleye ${yon}.`, 'success');
        }
      }

      // Stok değişimini hareketlere kaydet
      if (fark !== 0) {
        const tip = fark > 0 ? 'giris' : 'cikis';
        const mutlakFark = Math.abs(fark);
        data.transactions.push({
          id: Math.floor(Date.now() + Math.random() * 1000), type: tip, partiNo, productName: p.name,
          amount: mutlakFark, unit: p.unit, date: todayStr(),
          note: tip === 'giris' ? 'Düzenleme ile stok artışı' : 'Düzenleme ile stok azalışı',
          timestamp: new Date().toISOString(), createdBy: data.activeUser || ''
        });
      }

      await saveData();
      toast('Ürün güncellendi.', 'success');
    }
  } else {
    if (data.products[partiNo]) { toast('Bu Parti No zaten var!', 'error'); return; }
    data.products[partiNo] = {
      partiNo, name, category, unit, stock, criticalLevel: critical, stt: stt, companyName,
      active: true,
      createdAt: new Date().toISOString(), createdBy: data.activeUser || ''
    };
    if (stock > 0) {
      data.transactions.push({
        id: Math.floor(Date.now() + Math.random() * 1000), type: 'giris', partiNo, productName: name,
        amount: stock, unit: unit, date: todayStr(), note: 'İlk giriş',
        timestamp: new Date().toISOString(), createdBy: data.activeUser || ''
      });
      // Yeni ürün başlangıç stoğunu ihaleye işle
      if (companyName && data.tenders && data.tenders.length) {
        const eslesen = data.tenders.filter(t =>
          t.companyName === companyName && t.product === name
        );
        eslesen.forEach(t => { t.delivered += stock; });
        if (eslesen.length) {
          await saveData();
          toast(`✅ ${_fmt(stock)} ${unit} "${companyName}" ihaleye işlendi.`, 'success');
        }
      }
    }
    await saveData();
    toast('Yeni ürün kartı oluşturuldu!', 'success');
  }

  // Yeni firma adını hafızaya ekle
  if (companyName && !data.companies.includes(companyName)) {
    data.companies.push(companyName);
    data.companies.sort((a, b) => a.localeCompare(b));
    await saveData();
  }

  if (name && !data.productNames.includes(name)) {
    data.productNames.push(name);
    data.productNames.sort((a, b) => a.localeCompare(b));
    await saveData();
  }

  document.getElementById('new-product-modal').classList.remove('show');
  refreshWarehouse();
  refreshDashboard();
  buildMonthMenu();
  navigateTo('warehouse');
});

// Ürün sil (soft delete)
function deleteProduct(partiNo) {
  if (isViewOnly()) { toast('Görüntüleme modunda ürün silemezsiniz.', 'error'); return; }
  if (!confirm(`"${partiNo}" ürün kartı silinecek. Emin misiniz?`)) return;
  const p = data.products[partiNo];
  if (p) {
    // Stok varsa ihalelerden düş ve çıkış hareketi kaydet
    if (p.stock > 0) {
      if (p.companyName && data.tenders && data.tenders.length) {
        const eslesen = data.tenders.filter(t =>
          t.companyName === p.companyName && t.product === p.name
        );
        eslesen.forEach(t => { t.delivered = Math.max(0, t.delivered - p.stock); });
      }
      data.transactions.push({
        id: Math.floor(Date.now() + Math.random() * 1000), type: 'cikis', partiNo,
        productName: p.name, amount: p.stock, unit: p.unit,
        date: todayStr(), note: 'Ürün silindi',
        timestamp: new Date().toISOString(), createdBy: data.activeUser || ''
      });
    }
    p.stock = 0;
    p.active = false;
    p.deletedBy = data.activeUser || '';
    p.deletedAt = new Date().toISOString();
  }
  saveData();
  toast('Ürün silindi.', 'info');
  refreshWarehouse();
  refreshDashboard();
  buildMonthMenu();
}

// ----- TEDARİKÇİ YÖNETİMİ -----
function refreshSuppliers() {
  const container = document.getElementById('supplier-list');
  if (!container) return;
  const list = data.companies || [];
  const countEl = document.getElementById('supplier-count');
  if (countEl) countEl.textContent = `(${list.length})`;
  if (!list.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem 0;">Henüz tedarikçi eklenmemiş.</p>';
    return;
  }
  container.innerHTML = '<table class="minimal-table" style="width:100%;"><thead><tr><th style="text-align:left;">Tedarikçi Adı</th><th style="text-align:right;width:100px;">İşlem</th></tr></thead><tbody>' +
    list.map(c => {
      const enc = encodeURIComponent(c);
      return `<tr>
      <td><strong>${htmlEscape(c)}</strong></td>
      <td style="text-align:right;white-space:nowrap;">
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="editSupplier('${enc}')" title="Düzenle" style="color:var(--warning);margin-right:4px;"><i class="fa-solid fa-pen"></i></button>`}
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="deleteSupplier('${enc}')" title="Sil" style="color:var(--accent);"><i class="fa-solid fa-trash-can"></i></button>`}
      </td>
    </tr>`;
    }).join('') +
    '</tbody></table>';
}

function deleteSupplier(enc) {
  const name = decodeURIComponent(enc);
  if (isViewOnly()) { toast('Görüntüleme modunda tedarikçi silemezsiniz.', 'error'); return; }
  if (!confirm(`"${name}" tedarikçisini silmek istediğinize emin misiniz?`)) return;
  data.companies = (data.companies || []).filter(c => c !== name);
  saveData();
  refreshSuppliers();
  refreshEntryForm();
  toast(`"${name}" silindi.`, 'success');
}

function editSupplier(enc) {
  const name = decodeURIComponent(enc);
  if (isViewOnly()) { toast('Görüntüleme modunda tedarikçi düzenleyemezsiniz.', 'error'); return; }
  const yeni = prompt(`"${name}" için yeni ad girin:`, name);
  if (!yeni || yeni.trim().toUpperCase() === name) return;
  const yeniAd = yeni.trim().toUpperCase();
  if (!yeniAd) { toast('Geçersiz ad.', 'error'); return; }
  if ((data.companies || []).includes(yeniAd)) { toast('Bu tedarikçi zaten var!', 'error'); return; }
  // companies listesini güncelle
  const idx = data.companies.indexOf(name);
  if (idx !== -1) data.companies[idx] = yeniAd;
  data.companies.sort((a, b) => a.localeCompare(b));
  // products içindeki referansları güncelle
  Object.values(data.products).forEach(p => {
    if (p.companyName === name) p.companyName = yeniAd;
  });
  // tenders içindeki referansları güncelle
  (data.tenders || []).forEach(t => {
    if (t.companyName === name) t.companyName = yeniAd;
  });
  // transactions içindeki referansları güncelle
  (data.transactions || []).forEach(t => {
    if (t.companyName === name) t.companyName = yeniAd;
  });
  saveData();
  refreshSuppliers();
  refreshEntryForm();
  refreshTenders();
  toast(`"${name}" › "${yeniAd}" olarak güncellendi.`, 'success');
}

// Tedarikçi sayfası yönetimi (DOMContentLoaded'dan bağımsız çalışır)
(function setupSuppliers() {
  // Yeni ürün modalındaki + butonu
  const npAddBtn = document.getElementById('np-add-supplier');
  if (npAddBtn) npAddBtn.addEventListener('click', () => navigateTo('suppliers'));

  const addBtn = document.getElementById('add-supplier-btn');
  const input = document.getElementById('new-supplier-input');
  if (!addBtn || !input) return;
  const addSupplier = () => {
    if (isViewOnly()) { toast('Görüntüleme modunda tedarikçi ekleyemezsiniz.', 'error'); return; }
    const name = input.value.trim().toUpperCase();
    if (!name) { toast('Tedarikçi adı girin.', 'error'); return; }
    if ((data.companies || []).includes(name)) { toast('Bu tedarikçi zaten var!', 'error'); return; }
    data.companies = data.companies || [];
    data.companies.push(name);
    data.companies.sort((a, b) => a.localeCompare(b));
    saveData();
    input.value = '';
    refreshSuppliers();
    refreshEntryForm();
    toast(`"${name}" eklendi.`, 'success');
  };
  addBtn.addEventListener('click', addSupplier);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSupplier(); });
})();

// ----- YENİ ÜRÜN & PARTİ TANIMI (GİRİŞ) -----
function refreshEntryForm() {
  document.getElementById('entry-date').value = todayStr();
  // Tedarikçi dropdown'ı doldur
  const companySelect = document.getElementById('entry-company');
  if (companySelect) {
    const secili = companySelect.value;
    companySelect.innerHTML = '<option value="">Tedarikçi Seçin</option>' +
      (data.companies || []).map(c => `<option value="${htmlEscape(c)}"${c === secili ? ' selected' : ''}>${htmlEscape(c)}</option>`).join('');
    _csRefresh('entry-company');
  }
  // Ürün adı dropdown'ını doldur
  const nameSelect = document.getElementById('entry-name');
  if (nameSelect) {
    const secili = nameSelect.value;
    nameSelect.innerHTML = '<option value="">Ürün Adı Seçin</option>' +
      (data.productNames || []).map(n => `<option value="${htmlEscape(n)}"${n === secili ? ' selected' : ''}>${htmlEscape(n)}</option>`).join('');
    _csRefresh('entry-name');
  }
  _csRefresh('entry-category');
}

// Kategori seçilince otomatik birim ata
const _categoryUnits = { 'Sebze':'kg', 'Meyve':'kg', 'Bakliyat':'kg', 'Temel Gıda':'kg', 'Temizlik':'adet', 'Süt Ürünleri':'adet' };
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#entry-category, #np-category').forEach(sel => {
    sel.addEventListener('change', function() {
      const birim = _categoryUnits[this.value];
      const target = this.id === 'entry-category' ? 'entry-unit' : 'np-unit';
      if (birim) document.getElementById(target).value = birim;
    });
  });
});

// Ürün adı seçilince birimi otomatik doldur
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#entry-name, #np-name').forEach(sel => {
    sel.addEventListener('change', function() {
      const name = this.value;
      const unit = (data.productUnits || {})[name];
      if (unit) {
        const target = this.id === 'entry-name' ? 'entry-unit' : 'np-unit';
        document.getElementById(target).value = unit;
      }
    });
  });
  // İhale formu için de aynı
  const tenderProduct = document.getElementById('tender-product');
  if (tenderProduct) {
    tenderProduct.addEventListener('change', function() {
      const unit = (data.productUnits || {})[this.value.trim()];
      if (unit) document.getElementById('tender-unit').value = unit;
    });
  }
});

document.getElementById('entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isViewOnly()) { toast('Görüntüleme modunda giriş yapamazsınız.', 'error'); return; }

  // Supabase'ten son veriyi çek
  if (isSupabaseReady()) {
    try { const r = await supabaseLoad(); if (r) { data.products = r.products || {}; } } catch (e) { /* sessiz */ }
  }

  const name = document.getElementById('entry-name').value.trim();
  const category = document.getElementById('entry-category').value;
  const companyName = document.getElementById('entry-company').value.trim().toUpperCase();
  const amount = _parseAmount(document.getElementById('entry-amount').value);
  const unit = document.getElementById('entry-unit').value.trim() || 'kg';
  const stt = document.getElementById('entry-stt').value || '';
  const date = document.getElementById('entry-date').value;
  const note = document.getElementById('entry-note').value.trim();

  if (!name || !companyName || !amount || amount <= 0 || !date) {
    toast('Ürün adı, tedarikçi, miktar ve tarih gerekli!', 'error');
    return;
  }
  if (!isValidDate(date)) { toast('Geçersiz giriş tarihi!', 'error'); return; }
  if (stt && !isValidDate(stt)) { toast('Geçersiz STT tarihi!', 'error'); return; }

  // Parti No oluştur
  let partiNo = generateBatchPrefix() + String(nextBatchNoSeq()).padStart(2, '0');
  // Çakışma olursa arttır
  while (data.products[partiNo]) {
    data.settings.batchCounters[todayStr()]++;
    partiNo = generateBatchPrefix() + String(data.settings.batchCounters[todayStr()]).padStart(2, '0');
  }

  // Yeni ürün oluştur
  data.products[partiNo] = {
    partiNo, name, category, unit, stock: amount, criticalLevel: 50, stt, companyName,
    active: true, createdAt: new Date().toISOString(), createdBy: data.activeUser || ''
  };

  // Stok hareketi ekle
  data.transactions.push({
    id: Math.floor(Date.now() + Math.random() * 1000), type: 'giris', partiNo, productName: name,
    amount, unit, date, note: note || 'Mal kabul', stt: stt || '',
    timestamp: new Date().toISOString(), createdBy: data.activeUser || ''
  });

  await saveData();

  // İhale teslimatına otomatik ekle
  let ihaleMsg = '';
  if (data.tenders && data.tenders.length && companyName) {
    const eslesen = data.tenders.filter(t => t.companyName === companyName && t.product === name);
    eslesen.forEach(t => { t.delivered += amount; });
    if (eslesen.length) { await saveData(); ihaleMsg = ` | ✅ "${companyName}" ihaleye işlendi`; }
  }

  // Yeni firma adını hafızaya ekle
  if (companyName && !data.companies.includes(companyName)) {
    data.companies.push(companyName);
    data.companies.sort((a, b) => a.localeCompare(b));
    await saveData();
  }

  // Yeni ürün adını isim listesine ekle
  if (name && !data.productNames.includes(name)) {
    data.productNames.push(name);
    data.productNames.sort((a, b) => a.localeCompare(b));
    await saveData();
  }

    toast(`✅ ${_fmt(amount)} ${unit} ${name} [${partiNo}] oluşturuldu ve stoğa eklendi.${ihaleMsg}`, 'success');
  navigateTo('dashboard');
  refreshEntryForm();
  refreshDashboard();
  buildMonthMenu();
});

function _parseAmount(v) {
  return parseFloat(v.replace(/\./g, '').replace(',', '.'));
}
function _fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const s = n.toString();
  const i = s.indexOf('.');
  let intPart, decPart;
  if (i === -1) { intPart = s; decPart = ''; }
  else {
    intPart = s.slice(0, i);
    decPart = s.slice(i + 1, i + 3).replace(/0+$/, '');
  }
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart ? intPart + ',' + decPart : intPart;
}

// ----- ÇIKIŞ FORMU -----
function refreshExitForm() {
  const select = document.getElementById('exit-product');
  const prods = Object.values(data.products).filter(p => p.active !== false);
  const grouped = {};
  prods.forEach(p => {
    if (!grouped[p.name]) grouped[p.name] = { name: p.name, totalStock: 0, unit: p.unit };
    grouped[p.name].totalStock += (p.stock || 0);
    if (p.unit) grouped[p.name].unit = p.unit;
  });
  const sorted = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = sorted.map(g =>
    `<option value="${htmlEscape(g.name)}">${htmlEscape(g.name)} (Toplam Stok: ${_fmt(g.totalStock)} ${htmlEscape(g.unit)})</option>`
  ).join('');
  if (!sorted.length) select.innerHTML = '<option value="">Önce ürün ekleyin</option>';
  document.getElementById('exit-date').value = todayStr();
  document.getElementById('exit-person-count').value = '';
  updateExitCostPreview();
  _csRefresh('exit-product');
}

document.getElementById('exit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isViewOnly()) { toast('Görüntüleme modunda çıkış yapamazsınız.', 'error'); return; }
  const productName = document.getElementById('exit-product').value;
  const amount = _parseAmount(document.getElementById('exit-amount').value);
  const personCount = _parseAmount(document.getElementById('exit-person-count').value) || 0;
  const date = document.getElementById('exit-date').value;
  const note = document.getElementById('exit-note').value.trim();

  if (!productName || !amount || amount <= 0 || !date) { toast('Tüm alanları doldurun.', 'error'); return; }
  if (!isValidDate(date)) { toast('Geçersiz çıkış tarihi!', 'error'); return; }
  if (!personCount && !confirm('⚠️ Kişi sayısı girilmedi! Günlük Maliyet hesaplamaları eksik olabilir. Devam etmek istiyor musunuz?')) { return; }

  const parts = Object.values(data.products)
    .filter(p => p.active !== false && p.name === productName && (p.stock || 0) > 0)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  if (!parts.length) { toast('Bu ürün için stok bulunamadı.', 'error'); return; }

  const totalStock = parts.reduce((s, p) => s + (p.stock || 0), 0);
  if (totalStock < amount) { toast(`Yetersiz stok! Toplam: ${_fmt(totalStock)} ${parts[0].unit}`, 'error'); return; }

  let remaining = amount;
  const transactions = [];
  const unitPrice = lookupTenderPrice(parts[0].name, parts[0].companyName);

  for (const p of parts) {
    if (remaining <= 0) break;
    const deduct = Math.min(p.stock, remaining);
    p.stock -= deduct;
    remaining -= deduct;
    const tc = unitPrice ? deduct * unitPrice : 0;
    const cp = personCount > 0 ? tc / personCount : 0;
    transactions.push({
      id: Math.floor(Date.now() + Math.random() * 1000) + transactions.length,
      type: 'cikis', partiNo: p.partiNo, productName: p.name,
      amount: deduct, unit: p.unit, date, note: note || 'Ürün çıkış',
      timestamp: new Date().toISOString(), createdBy: data.activeUser || '',
      personCount, unitPrice, totalCost: tc, costPerPerson: cp
    });
  }

  transactions.forEach(t => data.transactions.push(t));
  await saveData();
  toast(`${_fmt(amount)} ${parts[0].unit} ${productName} çıkışı kaydedildi.`, 'success');
  navigateTo('dashboard');
  refreshExitForm();
  refreshDashboard();
  buildMonthMenu();
});

function lookupTenderPrice(productName, companyName) {
  if (!data.tenders || !data.tenders.length) return 0;
  const pLow = productName.toLowerCase();
  const cLow = (companyName || '').toLowerCase();
  const eslesen = data.tenders.filter(t =>
    t.product.toLowerCase() === pLow && (!cLow || t.companyName.toLowerCase() === cLow)
  );
  if (!eslesen.length) return 0;
  eslesen.sort((a, b) => (b.year || 0) - (a.year || 0));
  return eslesen[0].price || 0;
}

function updateExitCostPreview() {
  const productName = document.getElementById('exit-product').value;
  const amount = _parseAmount(document.getElementById('exit-amount').value) || 0;
  const personCount = _parseAmount(document.getElementById('exit-person-count').value) || 0;
  const upEl = document.getElementById('exit-unit-price-display');
  const tcEl = document.getElementById('exit-total-cost-display');
  const cpEl = document.getElementById('exit-cost-per-person-display');
  if (!productName || !amount) {
    upEl.textContent = '—'; tcEl.textContent = '—'; cpEl.textContent = '—';
    return;
  }
  const p = Object.values(data.products).find(pr => pr.active !== false && pr.name === productName);
  if (!p) return;
  const unitPrice = lookupTenderPrice(p.name, p.companyName);
  const totalCost = unitPrice * amount;
  const costPerPerson = personCount > 0 ? totalCost / personCount : 0;
  upEl.textContent = unitPrice ? `${_fmt(unitPrice)} ₺` : '—';
  tcEl.textContent = totalCost ? `${_fmt(totalCost)} ₺` : '—';
  cpEl.textContent = costPerPerson ? `${_fmt(costPerPerson)} ₺` : '—';
}

document.getElementById('exit-product').addEventListener('change', updateExitCostPreview);
document.getElementById('exit-amount').addEventListener('input', updateExitCostPreview);
document.getElementById('exit-person-count').addEventListener('input', updateExitCostPreview);

// ----- AYLIK RAPOR -----
function refreshMonthView() {
  const ay = window._selectedMonth !== undefined ? window._selectedMonth : AY_INDEX;
  const yil = window._selectedYear !== undefined ? window._selectedYear : new Date().getFullYear();
  document.getElementById('month-title').textContent = `${AYLAR[ay]} ${yil} — Aylık Rapor`;

  const aktifUrun = t => data.products[t.partiNo]?.active !== false;
  const girisler = data.transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'giris' && d.getMonth() === ay && d.getFullYear() === yil && aktifUrun(t);
  });
  const cikislar = data.transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'cikis' && d.getMonth() === ay && d.getFullYear() === yil && aktifUrun(t);
  });

  document.getElementById('month-in-total').textContent = `${_fmt(girisler.reduce((s, t) => s + t.amount, 0))} Adet`;
  document.getElementById('month-out-total').textContent = `${_fmt(cikislar.reduce((s, t) => s + t.amount, 0))} Adet`;

  function _birim(t) {
    return (data.products[t.partiNo] && data.products[t.partiNo].unit) || t.unit || '—';
  }
  function _firma(t) {
    return (data.products[t.partiNo] && data.products[t.partiNo].companyName) || '—';
  }
  function _stt(t) {
    const stt = (data.products[t.partiNo] && data.products[t.partiNo].stt) || t.stt || '';
    return stt ? formatDate(stt) : '—';
  }

  const adminUser = isAdmin();
  const silBtnHtml = (id, label) => adminUser
    ? `<button class="btn-ui btn-sm btn-outline" onclick="deleteTransaction(${id})" style="padding:2px 6px;font-size:10px;color:var(--accent);" title="Sil"><i class="fa-solid fa-trash-can"></i></button>`
    : '';

  const inBody = document.getElementById('month-in-list');
  inBody.innerHTML = girisler.length
    ? girisler.map(t => `<tr><td><strong>${htmlEscape(_firma(t))}</strong></td><td>${formatDate(t.date)}</td><td>${htmlEscape(t.productName)}</td><td>${_stt(t)}</td><td>${t.amount}</td><td>${htmlEscape(_birim(t))}</td><td style="text-align:center;">${silBtnHtml(t.id, 'giris')}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">Bu ayda giriş yok.</td></tr>';

  const outBody = document.getElementById('month-out-list');
  outBody.innerHTML = cikislar.length
    ? cikislar.map(t => `<tr><td><strong>${htmlEscape(_firma(t))}</strong></td><td>${formatDate(t.date)}</td><td>${htmlEscape(t.productName)}</td><td>${t.amount}</td><td>${htmlEscape(_birim(t))}</td><td style="text-align:center;">${silBtnHtml(t.id, 'cikis')}</td></tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">Bu ayda çıkış yok.</td></tr>';

  window._monthGirisler = girisler;
  window._monthCikislar = cikislar;
  window._monthAy = ay;
  window._monthYil = yil;
}

function monthExportPrint() {
  const girisler = window._monthGirisler || [];
  const cikislar = window._monthCikislar || [];
  const ay = window._monthAy;
  const yil = window._monthYil;
  const ayAdi = AYLAR[ay] || '';
  function _firma(t) { return (data.products[t.partiNo] && data.products[t.partiNo].companyName) || '—'; }
  function _stt(t) { const stt = (data.products[t.partiNo] && data.products[t.partiNo].stt) || t.stt || ''; return stt ? formatDate(stt) : '—'; }
  function _birim(t) { return (data.products[t.partiNo] && data.products[t.partiNo].unit) || t.unit || '—'; }

  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Aylık Rapor - ${ayAdi} ${yil}</title>
    <style>
      body { font-family:Arial; padding:20px; }
      h2 { margin-bottom:4px; }
      .sub { color:#666; margin-bottom:16px; font-size:13px; }
      h4 { margin:20px 0 8px; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px; }
      th, td { border:1px solid #ccc; padding:6px 8px; text-align:left; }
      th { background:#e2e8f0; }
      .toplam { font-weight:700; background:#f8fafc; }
      @media print { .no-print { display:none; } }
    </style></head>
    <body>
      <h2>Aylık Rapor — ${htmlEscape(ayAdi)} ${yil}</h2>
      <p class="sub">Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}</p>

      <h4>Girişler (Toplam: ${_fmt(girisler.reduce((s,t) => s + t.amount, 0))})</h4>
      <table>
        <thead><tr><th>Firma</th><th>Tarih</th><th>Ürün</th><th>STT</th><th>Miktar</th><th>Birim</th></tr></thead>
        <tbody>${girisler.map(t => `<tr><td>${htmlEscape(_firma(t))}</td><td>${formatDate(t.date)}</td><td>${htmlEscape(t.productName)}</td><td>${_stt(t)}</td><td>${t.amount}</td><td>${htmlEscape(_birim(t))}</td></tr>`).join('')}</tbody>
      </table>

      <h4>Çıkışlar (Toplam: ${_fmt(cikislar.reduce((s,t) => s + t.amount, 0))})</h4>
      <table>
        <thead><tr><th>Firma</th><th>Tarih</th><th>Ürün</th><th>Miktar</th><th>Birim</th></tr></thead>
        <tbody>${cikislar.map(t => `<tr><td>${htmlEscape(_firma(t))}</td><td>${formatDate(t.date)}</td><td>${htmlEscape(t.productName)}</td><td>${t.amount}</td><td>${htmlEscape(_birim(t))}</td></tr>`).join('')}</tbody>
      </table>

      <button class="no-print" onclick="window.print()" style="padding:8px 20px;font-size:14px;cursor:pointer;"><i class="fa-solid fa-print"></i> Yazdır</button>
    </body></html>
  `);
  w.document.close();
}

// ----- YILLIK RAPOR -----
function refreshYearsView() {
  const prevYil = parseInt(document.getElementById('year-select').value);
  populateYearSelect('year-select', prevYil || new Date().getFullYear());
  populateYearProductFilter();
  const yil = parseInt(document.getElementById('year-select').value) || new Date().getFullYear();
  const urunFiltre = (document.getElementById('year-filter-btn').dataset.value || '');
  renderYearChart(yil);

  const tumYil = t => new Date(t.date).getFullYear() === yil;
  const urunEslesme = t => !urunFiltre || t.productName === urunFiltre;
  const aktifUrun = t => data.products[t.partiNo]?.active !== false;
  const hareketler = data.transactions.filter(t => tumYil(t) && urunEslesme(t) && aktifUrun(t));
  const girisler = hareketler.filter(t => t.type === 'giris');
  const cikislar = hareketler.filter(t => t.type === 'cikis');
  const girisMiktar = girisler.reduce((s, t) => s + t.amount, 0);
  const cikisMiktar = cikislar.reduce((s, t) => s + t.amount, 0);
  const netDegisim = girisMiktar - cikisMiktar;

  // --- İstatistik kartları ---
  document.getElementById('year-total-in').textContent = girisler.length;
  document.getElementById('year-total-out').textContent = cikislar.length;
  document.getElementById('year-total-trans').textContent = hareketler.length;
  document.getElementById('year-net-change').textContent = (netDegisim >= 0 ? '+' : '') + _fmt(Math.abs(netDegisim));
  document.getElementById('year-net-change-unit').textContent = netDegisim >= 0 ? 'birim net artış' : 'birim net azalış';
  document.getElementById('year-net-change').style.color = netDegisim >= 0 ? 'var(--success)' : 'var(--accent)';

  // --- Geçen yıl karşılaştırması ---
  const gecenYil = yil - 1;
  const gecenHareket = data.transactions.filter(t => new Date(t.date).getFullYear() === gecenYil && urunEslesme(t) && aktifUrun(t));
  const vsPrevEl = document.getElementById('year-vs-prev');
  const vsPrevUnit = document.getElementById('year-vs-prev-unit');
  if (gecenHareket.length > 0 && hareketler.length > 0) {
    const fark = hareketler.length - gecenHareket.length;
    const yuzde = ((fark / gecenHareket.length) * 100);
    const sembol = fark >= 0 ? '+' : '';
    vsPrevEl.textContent = sembol + yuzde.toFixed(1) + '%';
    vsPrevEl.style.color = fark >= 0 ? 'var(--success)' : 'var(--accent)';
    vsPrevUnit.textContent = (fark >= 0 ? 'artış' : 'azalış') + ' (' + sembol + fark + ' işlem)';
  } else if (hareketler.length > 0) {
    vsPrevEl.textContent = 'YENİ';
    vsPrevEl.style.color = 'var(--primary)';
    vsPrevUnit.textContent = 'Geçen yıl verisi yok';
  } else {
    vsPrevEl.textContent = '—';
    vsPrevUnit.textContent = '';
  }

  // --- Ortalama işlem ---
  const avgEl = document.getElementById('year-avg-amount');
  const avgUnit = document.getElementById('year-avg-amount-unit');
  if (hareketler.length > 0) {
    const toplamMiktar = girisMiktar + cikisMiktar;
    avgEl.textContent = _fmt(Math.round(toplamMiktar / hareketler.length));
  } else {
    avgEl.textContent = '0';
  }

  // --- En hareketli ay ---
  const aySayilari = Array(12).fill(0);
  hareketler.forEach(t => { aySayilari[new Date(t.date).getMonth()]++; });
  const enYogunAyIndex = aySayilari.indexOf(Math.max(...aySayilari));
  const enYogunAyAdet = aySayilari[enYogunAyIndex];
  if (hareketler.length) {
    document.getElementById('year-busy-month').textContent = AYLAR[enYogunAyIndex];
    document.getElementById('year-busy-month-count').textContent = enYogunAyAdet + ' işlem';
  } else {
    document.getElementById('year-busy-month').textContent = '—';
    document.getElementById('year-busy-month-count').textContent = '';
  }

  // --- En Çok İşlem Görenler (strip) ---
  const topList = document.getElementById('year-top-list');
  if (!hareketler.length) {
    topList.innerHTML = '<div class="year-top-strip-empty">Veri yok.</div>';
  } else {
    const sirali = Object.entries(
      hareketler.reduce((acc, t) => { acc[t.productName] = (acc[t.productName] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const maxAdet = sirali.length ? sirali[0][1] : 1;
    const renkPalet = ['#f59e0b','#3b82f6','#8b5cf6','#22c55e','#f472b6'];
    topList.innerHTML = sirali.map(([urun, adet], i) => {
      const barPct = (adet / maxAdet) * 100;
      return `
        <div class="year-top-strip-item">
          <span class="year-top-strip-rank" style="background:${renkPalet[i]};">${i + 1}</span>
          <span class="year-top-strip-name">${htmlEscape(urun)}</span>
          <div class="year-top-strip-bar-wrap">
            <div class="year-top-strip-bar" style="width:${barPct}%;background:${renkPalet[i]}30;border-color:${renkPalet[i]};box-shadow:inset 0 0 0 1px ${renkPalet[i]}60;"></div>
          </div>
          <span class="year-top-strip-count">${adet}</span>
        </div>`;
    }).join('');
  }

  // --- Aylık karşılaştırma tablosu ---
  const monthlyBody = document.getElementById('year-monthly-body');
  const monthlyWrap = document.getElementById('year-monthly-summary');
  if (hareketler.length) {
    monthlyWrap.style.display = 'block';
    monthlyBody.innerHTML = AYLAR.map((ayAdi, i) => {
      const ayHar = hareketler.filter(t => new Date(t.date).getMonth() === i);
      const g = ayHar.filter(t => t.type === 'giris').reduce((s, t) => s + t.amount, 0);
      const c = ayHar.filter(t => t.type === 'cikis').reduce((s, t) => s + t.amount, 0);
      const net = g - c;
      if (!ayHar.length) return '';
      const netClass = net > 0 ? 'year-amount-in' : (net < 0 ? 'year-amount-out' : '');
      return `<tr>
        <td><strong>${ayAdi}</strong></td>
        <td class="year-amount-in" style="text-align:right;font-weight:700;">${_fmt(g)}</td>
        <td class="year-amount-out" style="text-align:right;font-weight:700;">${_fmt(c)}</td>
        <td class="${netClass}" style="text-align:right;font-weight:700;">${net > 0 ? '+' : ''}${_fmt(net)}</td>
        <td style="text-align:right;color:var(--text-secondary);">${ayHar.length}</td>
      </tr>`;
    }).filter(r => r).join('');
  } else {
    monthlyWrap.style.display = 'none';
  }

  // --- Detay tablosu ---
  const tbody = document.getElementById('year-report-body');
  document.getElementById('year-table-count').textContent = hareketler.length + ' kayıt';
  if (!hareketler.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px;">Bu yıla ait hareket bulunamadı.</td></tr>';
    return;
  }

  hareketler.sort((a, b) => new Date(b.date) - new Date(a.date));
  tbody.innerHTML = hareketler.map(t => {
    const tipEl = t.type === 'giris'
      ? '<span class="year-badge year-badge-in">GİRİŞ</span>'
      : t.type === 'duzeltme'
        ? '<span class="year-badge" style="background:var(--warning-light);color:var(--warning);">DÜZELTME</span>'
        : '<span class="year-badge year-badge-out">ÇIKIŞ</span>';
    const birim = t.unit || (data.products[t.partiNo] && data.products[t.partiNo].unit) || '';
    const cls = t.type === 'giris' ? 'year-amount-in' : t.type === 'duzeltme' ? '' : 'year-amount-out';
    const sign = t.type === 'giris' ? '+' : t.type === 'duzeltme' ? '±' : '-';
    return `<tr><td>${formatDate(t.date)}</td><td>${tipEl}</td><td>${htmlEscape(t.productName)}</td><td class="${cls}" style="text-align:right;font-weight:700;">${sign}${_fmt(t.amount)}</td><td>${htmlEscape(birim)}</td><td style="color:var(--text-secondary);font-size:13px;">${htmlEscape(t.note) || '-'}</td></tr>`;
  }).join('');
}

function yearExportPrint() {
  const yil = parseInt(document.getElementById('year-select').value) || new Date().getFullYear();
  const urunFiltre = (document.getElementById('year-filter-btn').dataset.value || '');
  const baslik = urunFiltre ? `${yil} Yılı Analiz Raporu — ${htmlEscape(urunFiltre)}` : `${yil} Yılı Analiz Raporu`;
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>${htmlEscape(baslik)}</title>
    <style>
      body { font-family:Arial; padding:24px; color:#1e293b; }
      h2 { margin-bottom:4px; font-size:20px; }
      .sub { color:#64748b; margin-bottom:16px; font-size:13px; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px; }
      th, td { border:1px solid #cbd5e1; padding:6px 10px; text-align:left; }
      th { background:#f1f5f9; font-size:11px; text-transform:uppercase; }
      .toplam { font-weight:700; background:#f8fafc; }
      .g { color:#16a34a; } .c { color:#dc2626; }
      @media print { .no-print { display:none; } body { padding:12px; } }
    </style></head>
    <body>
      <h2>${htmlEscape(baslik)}</h2>
      <p class="sub">Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}</p>
      <table>
        <thead><tr><th>Ay</th><th style="text-align:right">Giriş</th><th style="text-align:right">Çıkış</th><th style="text-align:right">Net</th></tr></thead>
        <tbody>
          ${AYLAR.map((ayAdi, i) => {
            const har = data.transactions.filter(t => {
              const d = new Date(t.date);
              return d.getFullYear() === yil && d.getMonth() === i && (!urunFiltre || t.productName === urunFiltre) && data.products[t.partiNo]?.active !== false;
            });
            if (!har.length) return '';
            const g = har.filter(t => t.type === 'giris').reduce((s, t) => s + t.amount, 0);
            const c = har.filter(t => t.type === 'cikis').reduce((s, t) => s + t.amount, 0);
            const net = g - c;
            return `<tr><td><strong>${ayAdi}</strong></td><td class="g" style="text-align:right">${_fmt(g)}</td><td class="c" style="text-align:right">${_fmt(c)}</td><td style="text-align:right;font-weight:700;">${net > 0 ? '+' : ''}${_fmt(net)}</td></tr>`;
          }).filter(r => r).join('')}
        </tbody>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin-top:20px;">STOKDEPO — Otomatik oluşturulmuş rapordur.</p>
      <script>window.print();<\/script>
    </body></html>
  `);
  w.document.close();
}

document.getElementById('year-select').addEventListener('change', refreshYearsView);

// ----- STT TAKIP -----
let _sttFilter = 'all';

function refreshSttTracking() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const products = Object.values(data.products).filter(p => p.active !== false && p.stt).map(p => {
    const sttDate = new Date(p.stt + 'T00:00:00');
    const fark = Math.ceil((sttDate - now) / (1000 * 60 * 60 * 24));
    return { ...p, sttGunFark: fark };
  });

  let filtered = products;
  if (_sttFilter === 'expired') filtered = products.filter(p => p.sttGunFark < 0);
  else if (_sttFilter === 'approaching') filtered = products.filter(p => p.sttGunFark >= 0 && p.sttGunFark <= 30);
  else if (_sttFilter === 'ok') filtered = products.filter(p => p.sttGunFark > 30);
  else if (_sttFilter === 'bitti') filtered = products.filter(p => p.stock <= 0);

  filtered.sort((a, b) => a.sttGunFark - b.sttGunFark);

  document.getElementById('stt-filter-badge').textContent = filtered.length + ' ürün';

  const tbody = document.getElementById('stt-tracking-body');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px;">Bu filtrede STT\'li ürün bulunamadı.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const gecti = p.sttGunFark < 0;
    const uyari = gecti ? 'GEÇTİ' : (p.sttGunFark === 0 ? 'BUGÜN' : p.sttGunFark + ' gün');
    const renk = gecti ? 'var(--accent)' : (p.sttGunFark <= 7 ? 'var(--warning)' : 'var(--success)');
    const stokBitti = p.stock <= 0;
    const not = stokBitti ? '<span style="color:var(--accent);font-weight:700;">STOKTA BİTTİ</span>' : '—';
    return `<tr>
      <td style="font-weight:600;color:var(--primary);">${htmlEscape(p.partiNo)}</td>
      <td><strong>${htmlEscape(p.name)}</strong></td>
      <td>${formatDate(p.stt)}</td>
      <td style="color:${renk};font-weight:700;">${uyari}</td>
      <td>${_fmt(p.stock)} ${htmlEscape(p.unit)}</td>
      <td>${not}</td>
    </tr>`;
  }).join('');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.stt-filter-btn');
  if (!btn) return;
  document.querySelectorAll('.stt-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _sttFilter = btn.dataset.filter;
  refreshSttTracking();
});

// ----- IHALE TAKIP -----
function refreshTenderChart() {
  const canvas = document.getElementById('tender-page-chart-canvas');
  const emptyMsg = document.getElementById('tender-page-chart-empty');
  if (!canvas) return;
  const yilFilter = document.getElementById('tender-year-filter');
  const firmaFilter = document.getElementById('tender-company-filter');
  const seciliYil = yilFilter?.value || '';
  const seciliFirma = firmaFilter?.value || '';
  const firmaToplam = {};
  const cyil = new Date().getFullYear();
  let filteredTenders = data.tenders || [];
  if (seciliYil) {
    filteredTenders = filteredTenders.filter(t => String(t.year || cyil) === seciliYil);
  }
  if (seciliFirma) {
    filteredTenders = filteredTenders.filter(t => t.companyName === seciliFirma);
  }
  filteredTenders.filter(t => t.quantity > 0).forEach(t => {
    if (!firmaToplam[t.companyName]) firmaToplam[t.companyName] = { quantity: 0, delivered: 0 };
    firmaToplam[t.companyName].quantity += t.quantity;
    firmaToplam[t.companyName].delivered += (t.delivered || 0);
  });
  const ihaleVeri = Object.keys(firmaToplam).map(name => {
    const { quantity, delivered } = firmaToplam[name];
    return { label: name, pct: Math.min(100, Math.round((delivered / quantity) * 100)) };
  });
  if (!ihaleVeri.length) {
    canvas.style.display = 'none';
    emptyMsg.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  emptyMsg.style.display = 'none';
  if (window._tenderPageChart) window._tenderPageChart.destroy();
  const isDark = getTheme() === 'dark';
  const labelColor = isDark ? '#e2e8f0' : '#334155';
  const blueScale = ['#3b82f6', '#60a5fa', '#2563eb', '#93c5fd', '#1d4ed8', '#7dd3fc', '#1e40af', '#bae6fd'];
  const barColors = ihaleVeri.map((_, i) => blueScale[i % blueScale.length]);
  const barLabelPlugin = {
    id: 'barLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        meta.data.forEach((bar, idx) => {
          const val = ds.data[idx];
          if (!val) return;
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 11px Outfit, Arial, sans-serif';
          ctx.fillStyle = isDark ? '#fff' : '#0f172a';
          ctx.fillText('%' + val, bar.x + 4, bar.y);
          ctx.restore();
        });
      });
    }
  };
  window._tenderPageChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ihaleVeri.map(v => v.label),
      datasets: [{
        label: 'Çekilme %',
        data: ihaleVeri.map(v => v.pct),
        backgroundColor: barColors,
        borderColor: barColors,
        borderWidth: 0,
        borderRadius: 6,
        barPercentage: 0.9,
        categoryPercentage: 0.95
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#fff',
          titleColor: isDark ? '#e2e8f0' : '#0f172a',
          bodyColor: isDark ? '#cbd5e1' : '#334155',
          borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          callbacks: {
            label: ctx => ctx.parsed.x + '% teslimat'
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          grid: { color: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(0,0,0,0.08)' },
          ticks: { callback: v => v + '%', color: labelColor, font: { size: 9 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: labelColor, font: { size: 10, weight: 'bold' } }
        }
      }
    },
    plugins: [barLabelPlugin]
  });
}
function refreshTenders() {
  if (!data.tenders) data.tenders = [];
  const tbody = document.getElementById('tender-body');
  // Yıl filtresini güncelle
  const yilFilter = document.getElementById('tender-year-filter');
  if (yilFilter) {
    const secili = yilFilter.value;
    const mevcutYillar = [...new Set(data.tenders.map(t => t.year || new Date().getFullYear()))].sort((a, b) => b - a);
    yilFilter.innerHTML = '<option value="">Tüm Yıllar</option>' +
      mevcutYillar.map(y => `<option value="${y}"${String(y) === secili ? ' selected' : ''}>${y}</option>`).join('');
  }
  // Firma filtresini güncelle
  const firmaFilter = document.getElementById('tender-company-filter');
  if (firmaFilter) {
    const seciliFirma = firmaFilter.value;
    const mevcutFirmalar = [...new Set(data.tenders.map(t => t.companyName))].sort((a, b) => a.localeCompare(b));
    firmaFilter.innerHTML = '<option value="">Tüm Firmalar</option>' +
      mevcutFirmalar.map(f => `<option value="${htmlEscape(f)}"${f === seciliFirma ? ' selected' : ''}>${htmlEscape(f)}</option>`).join('');
  }
  if (!data.tenders.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:40px;">Henüz ihale kaydı yok.</td></tr>';
    refreshTenderChart();
    return;
  }
  // Filtrelere göre süz
  const yilFiltre = yilFilter?.value || '';
  const firmaFiltre = firmaFilter?.value || '';
  let filtreli = data.tenders;
  if (yilFiltre) filtreli = filtreli.filter(t => String(t.year || new Date().getFullYear()) === yilFiltre);
  if (firmaFiltre) filtreli = filtreli.filter(t => t.companyName === firmaFiltre);
  tbody.innerHTML = filtreli.map(t => {
    const kalan = t.quantity - t.delivered;
    const sozlesmeTutar = t.price * t.quantity;
    const teslimTutar = t.price * t.delivered;
    const oran = sozlesmeTutar > 0 ? ((teslimTutar / sozlesmeTutar) * 100).toFixed(1) : 0;
    const oranRenk = oran >= 100 ? 'var(--accent)' : (oran >= 80 ? 'var(--accent)' : (oran >= 70 ? '#f97316' : (oran >= 50 ? '#eab308' : 'var(--success)')));
    const uyari80 = (oran >= 80 && oran < 100) ? '<span style="background:rgba(239,68,68,0.15);color:var(--accent);font-size:11px;padding:2px 8px;border-radius:999px;font-weight:700;margin-left:6px;white-space:nowrap;">⚠️ %80+</span>' : (oran >= 100 ? '<span style="color:var(--accent);margin-left:4px;">✅ TAMAM</span>' : '');
    const satirBg = (oran >= 80 && oran < 100) ? ' style="background:rgba(239,68,68,0.06);"' : (oran >= 100 ? ' style="background:rgba(239,68,68,0.03);"' : '');
    return `<tr${satirBg}>
      <td style="white-space:nowrap;"><strong>${htmlEscape(t.companyName)}</strong></td>
      <td style="white-space:nowrap;color:var(--text-secondary);font-size:12px;">${t.year || new Date().getFullYear()}</td>
      <td style="white-space:nowrap;">${htmlEscape(t.product)}</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(t.quantity)}</td>
      <td style="text-align:right;white-space:nowrap;">${t.unit || '—'}</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(t.delivered)} ${t.unit || ''}</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(kalan)} ${t.unit || ''}</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(t.price)} ₺</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(sozlesmeTutar)} ₺</td>
      <td style="text-align:right;white-space:nowrap;">${_fmt(teslimTutar)} ₺</td>
      <td style="text-align:right;white-space:nowrap;color:${oranRenk};font-weight:700;">%${oran} ${uyari80}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="editTender(${t.id})" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-ui btn-sm btn-outline" onclick="deleteTender(${t.id})" title="Sil" style="color:var(--accent);"><i class="fa-solid fa-trash-can"></i></button>`}
      </td>
    </tr>`;
  }).join('');
  refreshTenderChart();
}

function openTenderModal(editId) {
  const modal = document.getElementById('tender-modal');
  const form = document.getElementById('tender-form');
  form.reset();
  document.getElementById('tender-edit-id').value = '';
  document.getElementById('tender-modal-title').textContent = 'Yeni İhale';
  document.getElementById('tender-submit-text').textContent = 'İhale Ekle';

  // Firma seçimini doldur
  const companySelect = document.getElementById('tender-company');
  const secili = editId ? data.tenders.find(x => x.id === editId)?.companyName || '' : '';
  companySelect.innerHTML = '<option value="">Firma Seçin</option>' +
    (data.companies || []).map(c => `<option value="${htmlEscape(c)}"${c === secili ? ' selected' : ''}>${htmlEscape(c)}</option>`).join('');

  // Yıl seçimini doldur
  const yearSelect = document.getElementById('tender-year');
  if (yearSelect) {
    const cyil = new Date().getFullYear();
    const seciliYil = editId ? data.tenders.find(x => x.id === editId)?.year || cyil : cyil;
    const yillar = [];
    for (let y = cyil + 1; y >= 2016; y--) yillar.push(y);
    yearSelect.innerHTML = yillar.map(y => `<option value="${y}"${y === seciliYil ? ' selected' : ''}>${y}</option>`).join('');
  }

  if (editId) {
    const t = data.tenders.find(x => x.id === editId);
    if (!t) return;
    document.getElementById('tender-edit-id').value = t.id;
    document.getElementById('tender-product').value = t.product;
    document.getElementById('tender-quantity').value = t.quantity;
    document.getElementById('tender-unit').value = t.unit || '';
    document.getElementById('tender-delivered').value = t.delivered;
    document.getElementById('tender-price').value = t.price;
    document.getElementById('tender-modal-title').textContent = 'İhale Düzenle';
    document.getElementById('tender-submit-text').textContent = 'Güncelle';
  }
  modal.classList.add('show');
  _csRefresh('tender-company');
  _csRefresh('tender-year');
  // Ürün isim datalist'ini güncelle
  const dl = document.getElementById('product-name-datalist');
  if (dl) dl.innerHTML = (data.productNames || []).map(n => `<option value="${htmlEscape(n)}">`).join('');
}
function editTender(id) { openTenderModal(id); }

async function deleteTender(id) {
  if (isViewOnly()) { toast('Görüntüleme modunda ihale silemezsiniz.', 'error'); return; }
  if (!confirm('Bu ihaleyi silmek istediğinize emin misiniz?')) return;
  const silinen = data.tenders.find(t => t.id === id);
  if (silinen && data.products) {
    const miktar = silinen.delivered || 0;
    const co = silinen.companyName.toLowerCase();
    const pr = silinen.product.toLowerCase();
    Object.entries(data.products).forEach(([partiNo, p]) => {
      if (p.companyName.toLowerCase() === co && p.name.toLowerCase() === pr) {
        p.stock = Math.max(0, (p.stock || 0) - miktar);
      }
    });
  }
  data.tenders = data.tenders.filter(t => t.id !== id);
  await saveData();
  // Supabase'den de sil
  if (isSupabaseReady()) {
    try { await supabaseFetch('DELETE', 'tenders', { id: `eq.${id}` }); } catch (e) { console.error('Supabase ihale silme hatası:', e); }
  }
  refreshTenders();
  toast('İhale silindi.', 'success');
}

document.getElementById('add-tender-btn').addEventListener('click', () => openTenderModal());

document.getElementById('tender-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isViewOnly()) { toast('Görüntüleme modunda ihale ekleyemezsiniz.', 'error'); return; }
  const editId = document.getElementById('tender-edit-id').value;
  const companyName = document.getElementById('tender-company').value.trim().toUpperCase();
  const product = document.getElementById('tender-product').value.trim();
  const quantity = _parseAmount(document.getElementById('tender-quantity').value);
  const unit = document.getElementById('tender-unit').value.trim();
  const delivered = _parseAmount(document.getElementById('tender-delivered').value) || 0;
  const price = _parseAmount(document.getElementById('tender-price').value);
  const year = parseInt(document.getElementById('tender-year')?.value) || new Date().getFullYear();

  if (!companyName || !product || !quantity || !price || !unit) { toast('Tüm alanları doldurun.', 'error'); return; }

  // Stok güncelleme yardımcısı
  function _stokGuncelle(eski, yeni) {
    if (!data.products) return;
    const fark = yeni - eski;
    if (fark === 0) return;
    const co = companyName.toLowerCase();
    const pr = product.toLowerCase();
    Object.entries(data.products).forEach(([partiNo, p]) => {
      if (p.companyName.toLowerCase() === co && p.name.toLowerCase() === pr) {
        p.stock = Math.max(0, (p.stock || 0) + fark);
      }
    });
  }

  if (editId) {
    const t = data.tenders.find(x => x.id === parseFloat(editId));
    if (t) {
      const oldDelivered = t.delivered || 0;
      _stokGuncelle(oldDelivered, delivered);
      t.companyName = companyName; t.product = product; t.quantity = quantity; t.unit = unit; t.delivered = delivered; t.price = price; t.year = year;
    }
    toast('İhale güncellendi.', 'success');
  } else {
    _stokGuncelle(0, delivered);
    data.tenders.push({ id: Math.floor(Date.now() + Math.random() * 1000), companyName, product, quantity, unit, delivered, price, year });
    toast('İhale eklendi.', 'success');
  }
  saveData();
  document.getElementById('tender-modal').classList.remove('show');
  refreshTenders();
});

// İhale filtreleri değişince listeyi güncelle
document.getElementById('tender-year-filter')?.addEventListener('change', refreshTenders);
document.getElementById('tender-company-filter')?.addEventListener('change', refreshTenders);

// ----- AYARLAR -----
function refreshSettings() {
  // Kullanici adi
  const su = document.getElementById('settings-username');
  if (su) su.value = data.activeUser || '';
  const aktifKullanici = data.users.find(u => u.name === data.activeUser);
  const sr = document.getElementById('settings-role');
  if (sr) sr.value = aktifKullanici ? aktifKullanici.role : '';

  // Kullanici listesi
  const ul = document.getElementById('users-list-ul');
  const admin = isAdmin();
  // Admin değilse ekleme formunu gizle
  const addUserSection = document.getElementById('add-user-section');
  if (addUserSection) addUserSection.style.display = admin ? '' : 'none';
  if (!ul) return;
  ul.innerHTML = data.users.map(u => {
    const aktif = u.name === data.activeUser;
    const aktifMi = u.active !== false;
    const canEditPass = admin || aktif;
    return `<li style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-primary);padding:10px 14px;border-radius:var(--border-radius-sm);border:1px solid ${aktif ? 'var(--primary)' : 'var(--border-color)'};flex-wrap:wrap;gap:6px;${!aktifMi ? 'opacity:0.6;' : ''}">
      <span style="flex:1;min-width:120px;"><strong>${htmlEscape(u.name)}</strong> <span style="color:var(--text-secondary);font-size:13px;">— ${htmlEscape(u.role)}</span> ${aktif ? '<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:6px;">AKTİF</span>' : ''} ${!aktifMi ? '<span style="background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:6px;">PASİF</span>' : ''}</span>
      <span style="font-size:13px;color:var(--text-muted);font-family:monospace;">${'•'.repeat(8)}</span>
      ${canEditPass ? `<button class="btn-ui btn-sm btn-outline" onclick="editUserPassword('${u.name.replace(/'/g, '&#39;')}')" title="Şifre Değiştir" style="padding:4px 8px;font-size:12px;"><i class="fa-solid fa-key"></i></button>` : ''}
      ${isAdmin && u.name !== 'MUSTAFA ORHAN' ? `<button class="btn-ui btn-sm ${aktifMi ? 'btn-outline' : ''}" onclick="toggleUserActive('${u.name.replace(/'/g, '&#39;')}')" style="color:${aktifMi ? 'var(--accent)' : 'var(--success)'};padding:4px 10px;font-size:12px;border:1px solid currentColor;border-radius:var(--border-radius-sm);background:transparent;cursor:pointer;">${aktifMi ? 'Pasif Yap' : 'Aktifleştir'}</button>
      <button class="btn-ui btn-sm btn-outline" onclick="deleteUserPermanently('${u.name.replace(/'/g, '&#39;')}')" title="Kullanıcıyı Sil" style="color:var(--accent);padding:4px 8px;font-size:12px;margin-left:4px;"><i class="fa-solid fa-trash-can"></i></button>` : ''}
    </li>`;
  }).join('');

  // Aktif Kullanıcılar
  const aktifUserBox = document.getElementById('dashboard-active-user-box');
  const userListEl = document.getElementById('settings-user-list');
  if (aktifUserBox && userListEl) {
    const a = isAdmin();
    aktifUserBox.style.display = a ? '' : 'none';
    let activeSessions = [];
    try { activeSessions = JSON.parse(data.settings._activeSessions || '[]'); } catch(e) {}
    const now = Date.now();
    activeSessions = activeSessions.filter(s => (now - new Date(s.time).getTime()) < 120000);
    const aktifSet = new Set(activeSessions.map(s => s.user));
    const aktifCount = aktifSet.size;
    const countEl = document.getElementById('settings-active-count');
    if (countEl) countEl.textContent = 'Aktif Kullanıcı: ' + aktifCount + ' / Toplam: ' + data.users.filter(u => u.active !== false).length;
    userListEl.innerHTML = data.users.filter(u => u.active !== false).map(u => {
      const isAktif = aktifSet.has(u.name);
      return `<div style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:${isAktif ? 'var(--primary-light)' : 'var(--bg-secondary)'};border:1px solid ${isAktif ? 'var(--primary)' : 'var(--border-color)'};">
        <i class="fa-solid fa-circle" style="font-size:4px;color:${isAktif ? 'var(--success)' : 'var(--text-muted)'};flex-shrink:0;"></i>
        <span style="font-size:11px;font-weight:${isAktif ? '700' : '400'};color:var(--text-primary);white-space:nowrap;">${htmlEscape(u.name)}</span>
        <span style="font-size:10px;color:var(--text-secondary);">${htmlEscape(u.role)}</span>
        ${isAktif ? '<span style="background:var(--success);color:#fff;padding:0 5px;border-radius:999px;font-size:8px;font-weight:700;line-height:14px;">AKTİF</span>' : ''}
      </div>`;
    }).join('');
  }

// Supabase Durum Göstergesi
   const sbReady = isSupabaseReady();
   const githubStatusBox = document.getElementById('github-status-box');
   const githubTitle = document.getElementById('github-status-title');
   const githubDesc = document.getElementById('github-status-desc');
   const githubUrlDisplay = document.getElementById('github-url-display');
   const statusEl = document.getElementById('cloud-status-text');
   const cloudUser = document.getElementById('cloud-user-text');

   if (statusEl) {
     statusEl.textContent = sbReady ? 'Sunucuya Bağlı' : 'Bağlı Değil';
   }
   if (cloudUser && data.activeUser) { cloudUser.textContent = '• ' + data.activeUser; cloudUser.style.display = ''; }

   if (githubUrlDisplay) githubUrlDisplay.textContent = SUPABASE_URL;
   if (githubStatusBox) githubStatusBox.style.borderColor = sbReady ? 'var(--success)' : 'var(--warning)';
   if (githubTitle) {
     githubTitle.style.color = sbReady ? 'var(--success)' : 'var(--warning)';
      githubTitle.textContent = sbReady ? '☁️ Aktif — Supabase Veritabanı' : '⚠️ Supabase Bağlantısı Kurulamadı';
   }
   if (githubDesc) {
     githubDesc.textContent = sbReady
       ? 'Tüm veriler Supabase PostgreSQL veritabanında saklanır. Gerçek zamanlı eşitleme aktif.'
       : 'Supabase client oluşturulamadı. index.html\'deki SDK script\'ini kontrol edin.';
   }

  // Cloud status badge
  const badge = document.getElementById('cloud-status-badge');
  if (badge) {
    if (sbReady) {
      badge.style.borderColor = 'var(--success)';
      badge.style.color = 'var(--success)';
    } else {
      badge.style.borderColor = 'var(--text-muted)';
      badge.style.color = 'var(--text-muted)';
    }
  }

  // Yedekleme
  const abt = document.getElementById('auto-backup-time');
  if (abt) abt.value = data.settings.autoBackupTime || '17:00';
  const abtog = document.getElementById('auto-backup-toggle');
  if (abtog) abtog.checked = data.settings.autoBackupEnabled || false;
  updateBackupDirLabel();

  // Ürün isim listesini güncelle
  refreshProductNames();
}

// ----- ÜRÜN İSİM LİSTESİ YÖNETİMİ -----
function refreshProductNames() {
  const container = document.getElementById('product-name-list');
  if (!container) return;

  const countEl = document.getElementById('product-name-count');
  if (countEl) countEl.textContent = `(${(data.productNames || []).length})`;

  if (!data.productNames || !data.productNames.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem 0;">Henüz ürün ismi eklenmemiş.</p>';
    return;
  }
  container.innerHTML = '<table class="minimal-table" style="width:100%;"><thead><tr><th style="text-align:left;">Ürün Adı</th><th style="text-align:center;width:80px;">Birim</th><th style="text-align:right;width:100px;">İşlem</th></tr></thead><tbody>' +
    data.productNames.map(n => {
      const enc = encodeURIComponent(n);
      const unit = (data.productUnits || {})[n] || '—';
      return `<tr>
      <td><strong>${htmlEscape(n)}</strong></td>
      <td style="text-align:center;color:var(--text-secondary);font-size:0.85rem;">${htmlEscape(unit)}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="editProductName('${enc}')" title="Düzenle" style="color:var(--warning);margin-right:4px;"><i class="fa-solid fa-pen"></i></button>`}
        ${isViewOnly() ? '' : `<button class="btn-ui btn-sm btn-outline" onclick="deleteProductName('${enc}')" title="Sil" style="color:var(--accent);"><i class="fa-solid fa-trash-can"></i></button>`}
      </td>
    </tr>`;
    }).join('') +
    '</tbody></table>';

  // np-name dropdown'ini güncelle
  const nameSelect = document.getElementById('np-name');
  if (nameSelect) {
    const secili = nameSelect.value;
    nameSelect.innerHTML = '<option value="">Ürün Adı Seçin</option>' +
      data.productNames.map(n => `<option value="${htmlEscape(n)}"${n === secili ? ' selected' : ''}>${htmlEscape(n)}</option>`).join('');
    _csRefresh('np-name');
  }
  // tender-product için datalist'i güncelle
  const datalist = document.getElementById('product-name-datalist');
  if (datalist) {
    datalist.innerHTML = data.productNames.map(n => `<option value="${htmlEscape(n)}">`).join('');
  }
}

function editProductName(enc) {
  const name = decodeURIComponent(enc);
  if (isViewOnly()) { toast('Görüntüleme modunda ürün adı düzenleyemezsiniz.', 'error'); return; }
  const yeni = prompt(`"${name}" için yeni ad girin:`, name);
  if (!yeni || yeni.trim() === name) {
    // ad değişmedi, sadece birim güncelleme dene
    const curUnit = (data.productUnits || {})[name] || '';
    const yeniUnit = prompt(`"${name}" için birim girin (kg, adet, litre, paket, koli, teneke, torba, şişe):`, curUnit);
    if (yeniUnit !== null) {
      if (!data.productUnits) data.productUnits = {};
      data.productUnits[name] = yeniUnit.trim();
      saveData();
      refreshProductNames();
      toast(`"${name}" birimi "${yeniUnit.trim() || '—'}" olarak güncellendi.`, 'success');
    }
    return;
  }
  const yeniAd = yeni.trim();
  if (!yeniAd) { toast('Geçersiz ad.', 'error'); return; }
  if (data.productNames.includes(yeniAd)) { toast('Bu isim zaten listede!', 'error'); return; }
  const idx = data.productNames.indexOf(name);
  if (idx !== -1) data.productNames[idx] = yeniAd;
  data.productNames.sort((a, b) => a.localeCompare(b));
  // birimi de taşı
  if (data.productUnits && data.productUnits[name] !== undefined) {
    data.productUnits[yeniAd] = data.productUnits[name];
    delete data.productUnits[name];
  }
  // products içindeki referansları güncelle
  Object.values(data.products).forEach(p => {
    if (p.name === name) p.name = yeniAd;
  });
  // transactions içindeki referansları güncelle
  (data.transactions || []).forEach(t => {
    if (t.productName === name) t.productName = yeniAd;
  });
  // tenders içindeki referansları güncelle
  (data.tenders || []).forEach(t => {
    if (t.product === name) t.product = yeniAd;
  });
  saveData();
  refreshProductNames();
  refreshWarehouse();
  toast(`"${name}" › "${yeniAd}" olarak güncellendi.`, 'success');
}

function addProductName() {
  if (isViewOnly()) { toast('Görüntüleme modunda ürün adı ekleyemezsiniz.', 'error'); return; }
  const input = document.getElementById('new-product-name-input');
  const unitInput = document.getElementById('new-product-unit-input');
  const name = input.value.trim();
  const unit = unitInput ? unitInput.value : '';
  if (!name) { toast('Ürün adı girin.', 'error'); return; }
  if (data.productNames.includes(name)) { toast('Bu isim zaten listede.', 'warning'); return; }
  data.productNames.push(name);
  if (unit) {
    if (!data.productUnits) data.productUnits = {};
    data.productUnits[name] = unit;
  }
  data.productNames.sort((a, b) => a.localeCompare(b));
  input.value = '';
  if (unitInput) unitInput.value = '';
  saveData();
  refreshProductNames();
  toast('Ürün ismi eklendi.', 'success');
}

function deleteProductName(enc) {
  const name = decodeURIComponent(enc);
  if (isViewOnly()) { toast('Görüntüleme modunda ürün ismi silemezsiniz.', 'error'); return; }
  if (!confirm(`"${name}" ürün ismini listeden kaldırmak istediğinize emin misiniz?`)) return;
  data.productNames = data.productNames.filter(n => n !== name);
  if (data.productUnits) delete data.productUnits[name];
  saveData();
  refreshProductNames();
  toast(`"${name}" listeden kaldırıldı.`, 'success');
}

// Profil formu (unvan kaydet + şifre değiştir)
document.getElementById('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const role = document.getElementById('settings-role').value.trim();
  const yeniSifre = document.getElementById('settings-new-password').value.trim();
  if (data.activeUser) {
    const u = data.users.find(x => x.name === data.activeUser);
    if (u) {
      if (yeniSifre) {
        if (yeniSifre.length < 3) { toast('Şifre en az 3 karakter olmalı.', 'error'); return; }
        u.password = yeniSifre;
        document.getElementById('settings-new-password').value = '';
        toast('Şifreniz güncellendi.', 'success');
      }
      u.role = role;
      saveData();
      if (!yeniSifre) toast('Unvan güncellendi.', 'success');
      refreshSettings();
    }
  }
});

// Kullanici ekle (sadece admin)
document.getElementById('add-user-btn').addEventListener('click', async () => {
  if (!isAdmin()) { toast('Sadece yönetici kullanıcı ekleyebilir.', 'error'); return; }
  const name = document.getElementById('new-username-input').value.trim();
  const role = document.getElementById('new-userrole-input').value.trim() || 'Depo Kullanıcısı';
  const password = document.getElementById('new-userpassword-input').value.trim();
  if (!name) { toast('Kullanıcı adı girin.', 'error'); return; }
  if (!password) { toast('Şifre girin.', 'error'); return; }
  if (data.users.find(u => u.name === name)) { toast('Bu kullanıcı zaten var.', 'error'); return; }
  data.users.push({ name, role, password, active: true });
  let userFlags = {};
  try { userFlags = JSON.parse(data.settings._userActiveFlags || '{}'); } catch(e) {}
  userFlags[name] = true;
  data.settings._userActiveFlags = JSON.stringify(userFlags);
  const ok = await saveData();
  if (ok) toast(`"${name}" eklendi.`, 'success');
  document.getElementById('new-username-input').value = '';
  document.getElementById('new-userrole-input').value = 'Depo Kullanıcısı';
  document.getElementById('new-userpassword-input').value = '';
  refreshSettings();
});

// Ürün isim listesi
document.getElementById('add-product-name-btn').addEventListener('click', addProductName);
document.getElementById('new-product-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addProductName(); }
});
document.getElementById('upload-names-btn').addEventListener('click', () => {
  document.getElementById('upload-names-input').click();
});
document.getElementById('upload-names-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
    if (!lines.length) { toast('Dosyada geçerli ürün ismi bulunamadı.', 'error'); return; }
    let added = 0;
    lines.forEach(line => {
      // Format: "isim,birim" veya sadece "isim"
      const parts = line.split(',');
      const name = parts[0].trim();
      const unit = parts.length > 1 ? parts[1].trim() : '';
      if (!name) return;
      if (!data.productNames.includes(name)) {
        data.productNames.push(name);
        if (unit) {
          if (!data.productUnits) data.productUnits = {};
          data.productUnits[name] = unit;
        }
        added++;
      }
    });
    if (!added) { toast('Tüm isimler zaten listede.', 'info'); } else {
      data.productNames.sort((a, b) => a.localeCompare(b));
      saveData();
      refreshProductNames();
      toast(`${added} yeni ürün ismi eklendi.`, 'success');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

async function toggleUserActive(name) {
  if (!isAdmin()) { toast('Sadece yönetici kullanıcı pasif/aktif yapabilir.', 'error'); return; }
  if (name === 'MUSTAFA ORHAN') { toast('Yönetici pasif yapılamaz.', 'error'); return; }
  const u = data.users.find(x => x.name === name);
  if (!u) return;
  u.active = !u.active;
  if (!u.active && data.activeUser === name) data.activeUser = 'MUSTAFA ORHAN';
  // _userActiveFlags ayarını güncelle (Supabase kolonu olmasa da çalışır)
  let userFlags = {};
  try { userFlags = JSON.parse(data.settings._userActiveFlags || '{}'); } catch(e) {}
  userFlags[name] = u.active;
  data.settings._userActiveFlags = JSON.stringify(userFlags);
  // Diğer tarayıcılardaki oturumu sonlandırmak için Supabase'e sinyal gönder
  if (!u.active && isSupabaseReady()) {
    data.settings._forceLogout = name;
    try { await supabaseFetch('POST', 'settings', null, [{ key: '_forceLogout', value: name }]); } catch(e) {}
  }
  saveData();
  toast(`"${name}" kullanıcısı ${u.active ? 'aktifleştirildi' : 'pasif yapıldı'}.`, 'info');
  refreshSettings();
}

async function deleteUserPermanently(name) {
  if (!isAdmin()) { toast('Sadece yönetici kullanıcı silebilir.', 'error'); return; }
  if (name === 'MUSTAFA ORHAN') { toast('Yönetici silinemez.', 'error'); return; }
  if (!confirm(`"${name}" kullanıcısını tamamen silmek istediğinize emin misiniz?`)) return;
  data.users = data.users.filter(u => u.name !== name);
  let userFlags = {};
  try { userFlags = JSON.parse(data.settings._userActiveFlags || '{}'); } catch(e) {}
  delete userFlags[name];
  data.settings._userActiveFlags = JSON.stringify(userFlags);
  if (data.activeUser === name) data.activeUser = 'MUSTAFA ORHAN';
  if (isSupabaseReady()) {
    try { await supabaseFetch('DELETE', 'stok_users', { name: `eq.${name}` }); } catch(e) { console.error('Supabase kullanıcı silme hatası:', e); }
  }
  saveData();
  toast(`"${name}" silindi.`, 'info');
  refreshSettings();
}

// Kullanıcı ekleme işlemi sonrası güncelleme (çoklu kullanıcı için)
function refreshUserSelect() {}

function editUserPassword(name) {
  if (!isAdmin() && data.activeUser !== name) {
    toast('Sadece kendi şifrenizi değiştirebilirsiniz.', 'error'); return;
  }
  const u = data.users.find(x => x.name === name);
  if (!u) return;
  const newPass = prompt(`"${name}" için yeni şifre:`);
  if (!newPass || newPass.length < 3) { toast('Geçerli bir şifre girin (en az 3 karakter).', 'error'); return; }
  u.password = newPass;
  saveData();
  toast(`"${name}" şifresi güncellendi.`, 'success');
  refreshSettings();
}

// ----- YEDEKLEME -----
document.getElementById('backup-btn').addEventListener('click', async () => {
  const bakOk = await supabaseBackup('manuel');
  if (bakOk) toast('✅ Yedek Supabase\'e kaydedildi!', 'success');
  else toast('⚠️ Supabase yedekleme başarısız, yerel indiriliyor...', 'warning');
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tazedepo_yedek_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('restore-btn').addEventListener('click', () => {
  const fileInput = document.getElementById('restore-file');
  const file = fileInput.files[0];
  if (!file) { toast('Önce bir .json dosyası seçin.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      var imported = JSON.parse(e.target.result);
      imported = convertBackupFormat(imported);
      if (!imported.products || !imported.transactions) {
        toast('Geçersiz yedek dosyası!', 'error'); return;
      }
      if (!confirm('Mevcut tüm veri değişecek. Devam et?')) return;
      var oldUser = data.activeUser;
      data = imported;
      data.activeUser = oldUser;
      initData();
      saveData();
      toast('Veri başarıyla geri yüklendi!', 'success');
      fileInput.value = '';
      refreshAll();
    } catch (err) {
      toast('Dosya okunamadı: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
});

document.getElementById('list-backups-btn')?.addEventListener('click', async () => {
  const container = document.getElementById('backup-list-container');
  if (!container) return;
  if (container.style.display !== 'none') { container.style.display = 'none'; return; }
  if (!isSupabaseReady()) { toast('Supabase bağlı değil.', 'warning'); return; }
  container.style.display = 'block';
  container.innerHTML = '<p style="color:var(--text-muted);padding:8px;text-align:center;">Yükleniyor...</p>';
  try {
    const data = await supabaseFetch('GET', 'backups', { order: 'created_at.desc', limit: '50' });
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:8px;text-align:center;">Hiç yedek bulunamadı.</p>';
      return;
    }
    let html = '<table class="minimal-table" style="font-size:12px;"><thead><tr><th>Tarih</th><th>Etiket</th><th>İşlem</th></tr></thead><tbody>';
    data.forEach(b => {
      const d = new Date(b.created_at || b.id).toLocaleString('tr-TR');
      html += `<tr><td style="white-space:nowrap;">${d}</td><td>${b.label || b.filename || ''}</td><td><button class="btn-ui btn-sm btn-outline" onclick="restoreBackup('${b.id}')" style="font-size:11px;padding:2px 8px;">Yükle</button> <button class="btn-ui btn-sm btn-outline" onclick="downloadBackup('${b.id}')" style="font-size:11px;padding:2px 8px;">İndir</button></td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p style="color:var(--accent);padding:8px;text-align:center;">Hata: ' + e.message + '</p>';
  }
});

async function downloadBackup(id) {
  try {
    const data = await supabaseFetch('GET', 'backups', { id: `eq.${id}`, limit: '1' });
    if (!data || data.length === 0) { toast('Yedek bulunamadı.', 'error'); return; }
    var parsed = JSON.parse(data[0].data);
    parsed = convertBackupFormat(parsed);
    const json = JSON.stringify(parsed, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data[0].filename || `yedek_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

function convertBackupFormat(parsed) {
  // SQL yedek formatını uygulama formatına çevir (products array ise)
  if (Array.isArray(parsed.products)) {
    var prodObj = {};
    parsed.products.forEach(function(p) {
      prodObj[p.parti_no || p.partiNo] = {
        partiNo: p.parti_no || p.partiNo, name: p.name, category: p.category || '',
        unit: p.unit || 'kg', stock: p.stock || 0, criticalLevel: p.critical_level || p.criticalLevel || 0,
        stt: p.stt || '', companyName: p.company_name || p.companyName || '',
        active: p.active !== false, createdAt: p.created_at || p.createdAt || '',
        createdBy: p.created_by || p.createdBy || '',
        deletedBy: p.deleted_by || p.deletedBy || '',
        deletedAt: p.deleted_at || p.deletedAt
      };
    });
    parsed.products = prodObj;
  }
  if (Array.isArray(parsed.transactions)) {
    parsed.transactions = parsed.transactions.map(function(t) {
      if (t.parti_no !== undefined) {
        return {
          id: t.id, type: t.type, partiNo: t.parti_no, productName: t.product_name || t.productName,
          amount: t.amount, unit: t.unit || '', date: t.date, note: t.note || '',
          stt: t.stt || '', timestamp: t.timestamp, createdBy: t.created_by || t.createdBy || '',
          personCount: t.person_count || t.personCount || 0,
          unitPrice: t.unit_price || t.unitPrice || 0,
          totalCost: t.total_cost || t.totalCost || 0,
          costPerPerson: t.cost_per_person || t.costPerPerson || 0
        };
      }
      return t;
    });
  }
  if (parsed.users && Array.isArray(parsed.users)) {
    parsed.users = parsed.users.map(function(u) {
      return { name: u.name, role: u.role || 'Depo Kullanıcısı', password: u.password, lastLogin: u.last_login || u.lastLogin || null, active: u.active !== false };
    });
  }
  if (parsed.tenders && Array.isArray(parsed.tenders)) {
    parsed.tenders = parsed.tenders.map(function(t) {
      return { id: t.id, companyName: t.company_name || t.companyName, product: t.product, quantity: t.quantity, unit: t.unit || '', delivered: t.delivered || 0, price: t.price || 0, year: t.year || new Date().getFullYear() };
    });
  }
  if (Array.isArray(parsed.settings) && parsed.settings[0] && parsed.settings[0].key !== undefined) {
    var setObj = {};
    parsed.settings.forEach(function(s) { setObj[s.key] = s.value; });
    parsed.settings = setObj;
  }
  if (parsed.product_names) { parsed.productNames = parsed.product_names.map(function(n) { return n.name || n; }); delete parsed.product_names; }
  if (!parsed.productNames && Array.isArray(parsed.products)) { parsed.productNames = Object.values(parsed.products).map(function(p) { return p.name; }); }
  return parsed;
}

async function restoreBackup(id) {
  if (!confirm('Bu yedeği yüklemek mevcut verilerin üzerine yazar. Devam?')) return;
  try {
    const data = await supabaseFetch('GET', 'backups', { id: `eq.${id}`, limit: '1' });
    if (!data || data.length === 0) { toast('Yedek bulunamadı.', 'error'); return; }
    var parsed = JSON.parse(data[0].data);
    parsed = convertBackupFormat(parsed);
    if (!parsed.products || !parsed.transactions) { toast('Geçersiz yedek.', 'error'); return; }
    var oldUser = window.data.activeUser;
    window.data = parsed;
    window.data.activeUser = oldUser;
    initData();
    saveData();
    refreshAll();
    toast('✅ Yedek geri yüklendi!', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ----- SUPABASE YEDEKLEME -----
async function supabaseBackup(label) {
  if (!isSupabaseReady()) return false;
  const ts = new Date().toISOString();
  const filename = `yedek_${todayStr()}_${String(new Date().getHours()).padStart(2,'0')}${String(new Date().getMinutes()).padStart(2,'0')}.json`;
  try {
    await supabaseFetch('POST', 'backups', null, [{
      id: ts,
      filename: filename,
      label: label || '',
      data: JSON.stringify(data),
      created_at: ts,
      created_by: data.activeUser || ''
    }]);
    return true;
  } catch (e) { console.error('Yedekleme hatası:', e); return false; }
}

// ----- SUPABASE SETTINGS TEMİZLİĞİ -----
async function _cleanupSupabaseSettings() {
  if (!isSupabaseReady()) return;
  const silinecekKeys = ['_migrated', '_productNames', '_deletedUsers', 'apiUrl', 'github', 'Anahtar'];
  // Numerik anahtarlar (eski migrasyon)
  for (let i = 0; i <= 15; i++) silinecekKeys.push(String(i));
  // _forceLogout'u boş yap (silme, değerini sıfırla)
  await supabaseFetch('POST', 'settings', null, [{ key: '_forceLogout', value: '' }]).catch(() => {});
  try {
    await Promise.all(silinecekKeys.map(k =>
      supabaseFetch('DELETE', 'settings', { key: `eq.${k}` }).catch(() => {})
    ));
  } catch(e) { /* sessiz */ }
}

// ----- DEPO SIFIRLAMA -----
function resetAllData() {
  if (isViewOnly()) { toast('Görüntüleme modunda sıfırlama yapamazsınız.', 'error'); return; }
  if (!confirm('⚠️ Tüm stok verileri silinecek! Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?')) return;
  if (!confirm('⚠️ Son bir kez daha: Tüm ürünler, stok hareketleri, STT kayıtları, ihaleler ve tedarikçiler silinecek. Onaylıyor musunuz?')) return;

  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'flex';
  document.getElementById('loading-text').textContent = 'Yedekleniyor...';

  setTimeout(async () => {
    const bakOk = await supabaseBackup('sifirlama');
    if (!bakOk) { toast('⚠️ Yedekleme başarısız, sıfırlama iptal.', 'error'); if (overlay) overlay.style.display = 'none'; return; }

    document.getElementById('loading-text').textContent = 'Supabase sıfırlanıyor...';
    data.products = {};
    data.transactions = [];
    data.tenders = [];
    data.companies = [];

    initData();
    saveData();

    if (overlay) overlay.style.display = 'none';
    toast('✅ Depo tamamen sıfırlandı! Yedek Supabase\'te saklanıyor.', 'success');
    refreshAll();
    navigateTo('dashboard');
  }, 300);
}

document.getElementById('reset-all-btn').addEventListener('click', resetAllData);

// Otomatik yedekleme
document.getElementById('auto-backup-toggle').addEventListener('change', (e) => {
  const timeInput = document.getElementById('auto-backup-time');
  if (e.target.checked && !timeInput.value) {
    e.target.checked = false;
    toast('Lütfen önce saat seçin.', 'error');
    return;
  }
  data.settings.autoBackupEnabled = e.target.checked;
  data.settings.autoBackupTime = timeInput.value;
  saveData();
  if (e.target.checked) {
    toast('Otomatik yedekleme aktif.', 'success');
    scheduleAutoBackup();
  } else {
    toast('Otomatik yedekleme devre dışı.', 'info');
  }
});

document.getElementById('auto-backup-time').addEventListener('change', (e) => {
  data.settings.autoBackupTime = e.target.value;
  saveData();
  if (data.settings.autoBackupEnabled) scheduleAutoBackup();
});

document.getElementById('pick-backup-dir').addEventListener('click', pickBackupDir);

let backupTimer = null;
function scheduleAutoBackup() {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
  if (!data.settings.autoBackupEnabled) return;

  const timeStr = data.settings.autoBackupTime;
  if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
    data.settings.autoBackupEnabled = false;
    document.getElementById('auto-backup-toggle').checked = false;
    saveData();
    toast('Geçersiz saat — otomatik yedek devre dışı.', 'error');
    return;
  }

  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return;

  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  if (target <= now) target.setDate(target.getDate() + 1);

  backupTimer = setTimeout(async () => {
    await supabaseBackup('otomatik');
    const prefix = data.settings.backupPrefix || 'tazedepo_otomatik';
    const filename = `${prefix}_${todayStr()}.json`;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const dirHandle = await getBackupDirHandle();
    if (dirHandle) {
      try {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        const statusMsg = document.getElementById('backup-status-msg');
        if (statusMsg) statusMsg.textContent = `✅ ${new Date().toLocaleTimeString('tr-TR')} — "${filename}" kaydedildi.`;
      } catch (e) {
        console.error('Dizin yazma hatası, tarayıcı indirmeye düşülüyor:', e);
        fallbackDownload(blob, filename);
      }
    } else {
      fallbackDownload(blob, filename);
    }
    toast('Otomatik yedek alındı.', 'success');
    scheduleAutoBackup();
  }, target.getTime() - now.getTime());
}

function fallbackDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  const statusMsg = document.getElementById('backup-status-msg');
  if (statusMsg) statusMsg.textContent = `✅ ${new Date().toLocaleTimeString('tr-TR')} — "${filename}" indirildi.`;
}

// ----- DİZİN YÖNETİCİSİ (File System Access API - IndexedDB kalıcı) -----
let _backupDirHandle = null;
const DB_NAME = 'BackupDirDB';
const DB_STORE = 'handles';
const DB_KEY = 'backupDir';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(handle, DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.warn('IndexedDB kaydetme hatası:', e); }
}

async function loadDirHandle() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (e) { console.warn('IndexedDB yükleme hatası:', e); return null; }
}

async function getBackupDirHandle() {
  if (_backupDirHandle) {
    try {
      const perm = await _backupDirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return _backupDirHandle;
    } catch (e) { /* handle kaybolmuş olabilir */ }
    _backupDirHandle = null;
  }
  const handle = await loadDirHandle();
  if (handle) {
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        _backupDirHandle = handle;
        updateBackupDirLabel();
        return handle;
      }
      const prompted = await handle.requestPermission({ mode: 'readwrite' });
      if (prompted === 'granted') {
        _backupDirHandle = handle;
        updateBackupDirLabel();
        return handle;
      }
    } catch (e) { /* handle bozuk */ }
  }
  return null;
}

async function pickBackupDir() {
  if (!window.showDirectoryPicker) {
    toast('Bu tarayıcı klasör seçimini desteklemiyor. Lütfen Chrome/Edge kullanın.', 'error');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _backupDirHandle = handle;
    await saveDirHandle(handle);
    // Çerez ile kalıcı işaret — geçmiş temizliğinde IndexedDB silinirse haberdar olmak için
    document.cookie = 'backup_dir_set=1; path=/; max-age=' + (60*60*24*365*10);
    updateBackupDirLabel();
    toast('Yedek klasörü kalıcı olarak kaydedildi.', 'success');
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Klasör seçme hatası:', e);
  }
}

function updateBackupDirLabel() {
  const label = document.getElementById('backup-dir-label');
  if (!label) return;
  if (_backupDirHandle) {
    label.textContent = `📁 ${_backupDirHandle.name}`;
    label.style.color = 'var(--success)';
  } else if (document.cookie.split(';').some(c => c.trim().startsWith('backup_dir_set=1'))) {
    label.textContent = '⚠️ Klasör seçimi kayboldu — lütfen butona tıklayıp yeniden seçin';
    label.style.color = 'var(--accent)';
  } else {
    label.textContent = 'Henüz klasör seçilmedi (varsayılan: tarayıcı indirme)';
    label.style.color = 'var(--text-muted)';
  }
}

// ----- NAVIGASYON EVENTLERI -----
document.querySelectorAll('.nav-item[data-target]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = item.dataset.target;
    if (target === 'month-view') {
      window._selectedMonth = AY_INDEX;
      window._selectedYear = new Date().getFullYear();
      document.querySelectorAll('.nav-item[data-month]').forEach(n => n.classList.remove('active'));
      const el = document.querySelector(`.nav-item[data-month="${AY_INDEX}"]`);
      if (el) el.classList.add('active');
    }
    navigateTo(target);
  });
});

// ----- KRITIK STOK LISTESI -----
function refreshCriticalStock() {
  const prods = Object.values(data.products).filter(p => p.active !== false);
  const groups = {};
  prods.forEach(p => {
    if (!groups[p.name]) groups[p.name] = { name: p.name, totalStock: 0, maxCritical: 0, unit: p.unit || '', batchCount: 0, partis: [] };
    groups[p.name].totalStock += (p.stock || 0);
    if ((p.criticalLevel || 0) > groups[p.name].maxCritical) groups[p.name].maxCritical = p.criticalLevel || 0;
    if (p.unit && !groups[p.name].unit) groups[p.name].unit = p.unit;
    groups[p.name].batchCount++;
    groups[p.name].partis.push(p);
  });
  const kritik = Object.values(groups).filter(g => g.maxCritical > 0 && g.totalStock <= g.maxCritical);
  const container = document.getElementById('critical-stock-full-list');
  const countEl = document.getElementById('critical-stock-count');
  if (!kritik.length) {
    container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;font-size:0.9rem;padding:30px 0;">✅ Tüm stoklar normal seviyede.</p>';
    if (countEl) countEl.textContent = '0 ürün';
    return;
  }
  if (countEl) countEl.textContent = kritik.length + ' ürün';
  container.innerHTML = kritik.map(g => `
    <div style="display:flex;align-items:center;gap:12px;background:var(--warning-light);padding:12px 16px;border-radius:var(--border-radius-sm);border:1px solid rgba(234,179,8,0.2);">
      <i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);font-size:18px;"></i>
      <div style="flex:1;min-width:0;">
        <strong>${htmlEscape(g.name)}</strong>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">${g.batchCount} parti</span>
        <br><span style="font-size:13px;color:var(--text-secondary);">Toplam Stok: ${_fmt(g.totalStock)} / Limit: ${g.maxCritical} ${htmlEscape(g.unit)}</span>
      </div>
      <span style="background:#422006;color:var(--warning);padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap;">KRİTİK</span>
    </div>
  `).join('');
}

function _criticalExportData() {
  const prods = Object.values(data.products).filter(p => p.active !== false);
  const groups = {};
  prods.forEach(p => {
    if (!groups[p.name]) groups[p.name] = { name: p.name, totalStock: 0, maxCritical: 0, unit: p.unit || '', batchCount: 0, categories: new Set(), sttDates: [], companyName: p.companyName || '' };
    groups[p.name].totalStock += (p.stock || 0);
    if ((p.criticalLevel || 0) > groups[p.name].maxCritical) groups[p.name].maxCritical = p.criticalLevel || 0;
    if (p.unit && !groups[p.name].unit) groups[p.name].unit = p.unit;
    groups[p.name].batchCount++;
    if (p.category) groups[p.name].categories.add(p.category);
    if (p.stt) groups[p.name].sttDates.push(p.stt);
  });
  return Object.values(groups).filter(g => g.maxCritical > 0 && g.totalStock <= g.maxCritical)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(g => {
      const eslesenIhale = (data.tenders || []).filter(t => t.product === g.name);
      const ihaleKalan = eslesenIhale.reduce((top, t) => top + (t.quantity - t.delivered), 0);
      return { ...g, ihaleKalan, categories: [...g.categories], sttDates: g.sttDates };
    });
}

function criticalExportXLSX() {
  const rows = _criticalExportData();
  const headers = ['Ürün Adı', 'Kategori', 'Toplam Stok', 'Birim', 'İhale Kalan', 'Kritik Limit', 'Parti Sayısı', 'STT Aralığı'];
  const data = rows.map(g => {
    const cats = [...g.categories].join(', ') || '-';
    const sttRange = g.sttDates.length ? g.sttDates.sort()[0] + (g.sttDates.length > 1 ? ' — ' + g.sttDates.sort().pop() : '') : '—';
    return [g.name, cats, _fmt(g.totalStock), g.unit, g.ihaleKalan > 0 ? _fmt(g.ihaleKalan) + ' ' + g.unit : '—', g.maxCritical, g.batchCount, sttRange];
  });
  _htmlExcelBlob(data, headers, 'kritik_stok_listesi.xls');
  _closeMenu('critical-export-menu');
  toast('Excel dosyası indirildi.', 'success');
}

function criticalExportWord() {
  const rows = _criticalExportData();
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>Kritik Stok Listesi</title></head>
<body><h2>Kritik Stok Listesi</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:13px;width:100%;">
<thead><tr style="background:#e2e8f0;">
<th>Ürün Adı</th><th>Kategori</th><th>Toplam Stok</th><th>Birim</th><th>İhale Kalan</th><th>Kritik Limit</th><th>Parti Sayısı</th><th>STT Aralığı</th>
</tr></thead>
<tbody>${rows.map(g => {
  const cats = [...g.categories].join(', ') || '-';
  const sttRange = g.sttDates.length ? g.sttDates.sort()[0] + (g.sttDates.length > 1 ? ' — ' + g.sttDates.sort().pop() : '') : '—';
  return `<tr><td>${g.name}</td><td>${cats}</td><td align="right">${_fmt(g.totalStock)}</td><td>${g.unit}</td><td align="right">${g.ihaleKalan > 0 ? _fmt(g.ihaleKalan) + ' ' + g.unit : '—'}</td><td align="right">${g.maxCritical}</td><td align="right">${g.batchCount}</td><td>${sttRange}</td></tr>`;
}).join('\n')}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kritik_stok_listesi.doc';
  a.click();
  URL.revokeObjectURL(a.href);
  _closeMenu('critical-export-menu');
  toast('Word dosyası indirildi.', 'success');
}

function criticalExportPrint() {
  const rows = _criticalExportData();
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Kritik Stok Listesi - Yazdır</title>
    <style>
      body { font-family:Arial; padding:20px; }
      h2 { margin-bottom:12px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th, td { border:1px solid #ccc; padding:6px 8px; text-align:left; }
      th { background:#e2e8f0; }
      @media print { body { padding:0; } }
    </style></head>
    <body>
    <h2>Kritik Stok Listesi</h2>
    <table>
      <thead><tr><th>Ürün Adı</th><th>Kategori</th><th>Toplam Stok</th><th>Birim</th><th>İhale Kalan</th><th>Kritik Limit</th><th>Parti Sayısı</th><th>STT Aralığı</th></tr></thead>
      <tbody>${rows.map(g => {
        const cats = [...g.categories].join(', ') || '-';
        const sttRange = g.sttDates.length ? g.sttDates.sort()[0] + (g.sttDates.length > 1 ? ' — ' + g.sttDates.sort().pop() : '') : '—';
        return `<tr><td>${htmlEscape(g.name)}</td><td>${htmlEscape(cats)}</td><td>${_fmt(g.totalStock)}</td><td>${htmlEscape(g.unit)}</td><td>${g.ihaleKalan > 0 ? _fmt(g.ihaleKalan) + ' ' + htmlEscape(g.unit) : '—'}</td><td>${g.maxCritical}</td><td>${g.batchCount}</td><td>${sttRange}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p style="margin-top:16px;font-size:11px;color:#666;">Toplam ${rows.length} kritik stok ürünü</p>
    </body></html>
  `);
  w.document.close();
  _closeMenu('critical-export-menu');
  setTimeout(() => w.print(), 300);
}

function printUserGuide() {
  const guide = document.getElementById('user-guide-content');
  if (!guide) return;
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>STOKDEPO - Kullanım Kılavuzu</title>
    <style>
      body { font-family:Arial; padding:30px; max-width:800px; margin:0 auto; line-height:1.8; font-size:15px; color:#1e293b; }
      h2 { font-size:22px; margin-bottom:4px; }
      h3 { font-size:17px; margin-top:28px; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px; }
      ul { margin:6px 0 12px; padding-left:24px; }
      li { margin-bottom:4px; }
      .version { color:#64748b; font-size:13px; margin-bottom:30px; }
      @media print { body { padding:20px; } }
    </style></head>
    <body>${guide.innerHTML}</body></html>
  `);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ----- TUMUNU YENILE -----
function refreshAll() {
  try {
  // Pasif kullanıcıyı anında oturumdan at
  const currentUser = data.users.find(u => u.name === data.activeUser);
  if (currentUser && currentUser.active === false) {
    currentUser.active = false;
    sessionStorage.removeItem('stokdosya_logged_in');
    sessionStorage.removeItem('stokdosya_activeUser');
    data.activeUser = '';
    const loginScr = document.getElementById('login-screen');
    const appCont = document.getElementById('app-container');
    if (loginScr) loginScr.style.display = 'flex';
    if (appCont) appCont.style.display = 'none';
    return;
  }
  const vo = isViewOnly();
  if (_el('add-product-btn')) _el('add-product-btn').style.display = vo ? 'none' : '';
  if (_el('add-tender-btn')) _el('add-tender-btn').style.display = vo ? 'none' : '';
  if (_el('add-supplier-btn')) _el('add-supplier-btn').style.display = vo ? 'none' : '';
  if (_el('np-add-supplier')) _el('np-add-supplier').style.display = vo ? 'none' : '';
  if (_el('add-product-name-btn')) _el('add-product-name-btn').style.display = vo ? 'none' : '';
  if (_el('upload-names-btn')) _el('upload-names-btn').style.display = vo ? 'none' : '';
  if (_el('new-product-name-input')) _el('new-product-name-input').style.display = vo ? 'none' : '';
  if (_el('add-product-name-from-modal')) _el('add-product-name-from-modal').style.display = vo ? 'none' : '';
  if (_el('entry-form')) _el('entry-form').style.display = vo ? 'none' : '';
  if (_el('exit-form')) _el('exit-form').style.display = vo ? 'none' : '';
  if (_el('new-supplier-input')) _el('new-supplier-input').style.display = vo ? 'none' : '';

  const settingsNav = document.querySelector('.nav-item[data-target="settings-view"]');
  if (settingsNav) settingsNav.style.display = isAdmin() ? '' : 'none';
  const themeBtn = _el('theme-toggle');
  if (themeBtn) themeBtn.style.display = isAdmin() ? '' : 'none';
  const statusEl = _el('cloud-status-text');
  if (statusEl) statusEl.textContent = isSupabaseReady() ? 'Sunucuya Bağlı' : 'Yerel Bellek';
  const cloudUser = _el('cloud-user-text');
  if (cloudUser && data.activeUser) { cloudUser.textContent = '• ' + data.activeUser; cloudUser.style.display = ''; }

  _safe(refreshUserSelect);
  _safe(buildMonthMenu);
  _safe(refreshPersonFilter);
  _safe(refreshDashboard);
  _safe(refreshWarehouse);
  _safe(refreshAggregatedStock);
  _safe(refreshEntryForm);
  _safe(refreshExitForm);
  if (isAdmin()) _safe(refreshSettings);

  const aktifView = document.querySelector('.view-section.active');
  if (aktifView) {
    const id = aktifView.id;
    if (id === 'dashboard') _safe(refreshDashboard);
    if (id === 'warehouse') _safe(refreshWarehouse);
    if (id === 'aggregated-stock') _safe(refreshAggregatedStock);
    if (id === 'month-view') _safe(refreshMonthView);
    if (id === 'years-view') _safe(refreshYearsView);
    if (id === 'daily') _safe(refreshDailyView);
    if (id === 'daily-cost') _safe(refreshDailyCost);
    if (id === 'critical-stock-view') _safe(refreshCriticalStock);
    if (id === 'year-compare') _safe(refreshYearCompare);
  }
  } catch (e) { console.error('refreshAll hatası:', e); }
}

// ----- SAAT -----
function updateClock() {
  const el = document.getElementById('header-date');
  if (el) el.textContent = new Date().toLocaleString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ----- GÜNLÜK İŞLEMLER -----
function refreshDailyView() {
  try {
  const prevYil = parseInt(document.getElementById('daily-year-select').value);
  populateYearSelect('daily-year-select', prevYil || new Date().getFullYear());
  const dateStr = document.getElementById('daily-date').value || todayStr();
  document.getElementById('daily-date').value = dateStr;
  const yil = parseInt(document.getElementById('daily-year-select').value) || new Date().getFullYear();

  // Yıla göre filtrele, tarih seçiliyse ona da daralt
  let yilHareket = data.transactions.filter(t => t.date && new Date(t.date).getFullYear() === yil);
  let hareketler = dateStr ? yilHareket.filter(t => t.date === dateStr) : yilHareket;
  console.log('refreshDailyView:', {yil, dateStr, toplamTx: data.transactions.length, yilSayisi: yilHareket.length, filtreSonucu: hareketler.length});

  // Kişi filtresi (not veya createdBy üzerinden)
  const kisiFiltre = document.getElementById('daily-person-filter').value;
  if (kisiFiltre) {
    hareketler = hareketler.filter(t => t.type === kisiFiltre);
  }

  const giris = hareketler.filter(t => t.type === 'giris');
  const cikis = hareketler.filter(t => t.type === 'cikis');
  document.getElementById('daily-giris-adet').textContent = giris.length + ' işlem';
  document.getElementById('daily-cikis-adet').textContent = cikis.length + ' işlem';
  document.getElementById('daily-toplam-adet').textContent = hareketler.length + ' işlem';

  document.getElementById('daily-baslik').textContent = yil + ' Yılı' + (dateStr ? ' — ' + formatDate(dateStr) : ' — Tümü');

  const tbody = document.getElementById('daily-body');
  if (!hareketler.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px;">Bu tarihte işlem bulunamadı.</td></tr>';
    return;
  }
  hareketler.sort((a,b) => (b.id || 0) - (a.id || 0));
  tbody.innerHTML = hareketler.map((t,i) => {
    const silindi = data.products[t.partiNo]?.active === false;
    const tip = t.type === 'giris'
      ? '<span style="color:var(--success);font-weight:700;">GİRİŞ</span>'
      : t.type === 'duzeltme'
        ? '<span style="color:var(--warning);font-weight:700;">DÜZELTME</span>'
        : '<span style="color:var(--accent);font-weight:700;">ÇIKIŞ</span>';
    const birim = t.unit || (data.products[t.partiNo] && data.products[t.partiNo].unit) || '';
    const adminUser = isAdmin();
    const duzeltBtn = adminUser && t.type === 'cikis'
      ? `<button class="btn-ui btn-sm btn-outline" onclick="openExitEdit(${t.id})" style="padding:2px 8px;font-size:11px;" title="Düzelt"><i class="fa-solid fa-pen"></i></button>`
      : '';
    const silBtn = adminUser
      ? `<button class="btn-ui btn-sm btn-outline" onclick="deleteTransaction(${t.id})" style="padding:2px 8px;font-size:11px;color:var(--accent);margin-left:4px;" title="Sil"><i class="fa-solid fa-trash-can"></i></button>`
      : '';
    const silindiNotu = silindi ? ' <span style="color:var(--accent);font-weight:700;">[SİLİNDİ]</span>' : '';
    return `<tr><td>${i+1}</td><td>${tip}</td><td style="font-weight:600;">${htmlEscape(t.partiNo)}${silindiNotu}</td><td>${htmlEscape(t.productName)}</td><td>${_fmt(t.amount)}</td><td>${htmlEscape(birim)}</td><td style="font-weight:600;color:var(--primary);font-size:13px;">${htmlEscape(t.createdBy) || '-'}</td><td style="color:var(--text-secondary);">${htmlEscape(t.note) || '-'}</td><td>${duzeltBtn}${silBtn}</td></tr>`;
  }).join('');
  } catch(e) { console.error('refreshDailyView hatası:', e); toast('Günlük İşlemler hatası: ' + e.message, 'error'); }
}

function openExitEdit(id) {
  if (!isAdmin()) { toast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const t = data.transactions.find(x => x.id === id);
  if (!t || t.type !== 'cikis') return;
  document.getElementById('exit-edit-id').value = id;
  document.getElementById('exit-edit-product-info').textContent = `${t.productName} — ${t.partiNo}`;
  document.getElementById('exit-edit-old-info').textContent = `Çıkış: ${_fmt(t.amount)} ${t.unit || ''} | Tarih: ${formatDate(t.date)} | ${t.note || '-'}`;
  document.getElementById('exit-edit-amount').value = _fmt(t.amount);
  document.getElementById('exit-edit-note').value = '';
  document.getElementById('exit-edit-modal').classList.add('show');
}

document.getElementById('exit-edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isViewOnly()) { toast('Görüntüleme modunda düzeltme yapamazsınız.', 'error'); return; }
  if (!isAdmin()) { toast('Bu işlem için yetkiniz yok.', 'error'); return; }

  const id = parseFloat(document.getElementById('exit-edit-id').value);
  const t = data.transactions.find(x => x.id === id);
  if (!t || t.type !== 'cikis') { toast('İşlem bulunamadı.', 'error'); return; }

  const yeniMiktar = _parseAmount(document.getElementById('exit-edit-amount').value);
  if (!yeniMiktar || yeniMiktar <= 0) { toast('Geçerli bir miktar girin.', 'error'); return; }
  const duzeltmeNotu = document.getElementById('exit-edit-note').value.trim();
  const eskiMiktar = t.amount;

  // Delta hesaplama: negatif fark = stoğa iade, pozitif fark = ekstra düşüm
  const fark = yeniMiktar - eskiMiktar;
  if (fark === 0) { toast('Miktar değişmedi.', 'info'); return; }

  const p = data.products[t.partiNo];
  if (!p) { toast('Ürün kartı bulunamadı.', 'error'); return; }

  // Pozitif fark (çıkış artıyor) › ekstra stok düşümü, stok kontrolü gerek
  if (fark > 0 && p.stock < fark) {
    toast(`Yetersiz stok! Mevcut: ${_fmt(p.stock)} ${p.unit}`, 'error');
    return;
  }

  // Delta kadar stok düzeltmesi (negatif fark otomatik iade eder)
  p.stock -= fark;

  // Çıkış kaydını güncelle ve cost'ları yeniden hesapla
  t.amount = yeniMiktar;
  t.totalCost = (t.unitPrice || 0) * yeniMiktar;
  t.costPerPerson = (t.personCount || 0) > 0 ? t.totalCost / t.personCount : 0;
  t.note = (duzeltmeNotu ? duzeltmeNotu + ' | ' : '') + `Düzeltme: ${_fmt(eskiMiktar)} › ${_fmt(yeniMiktar)} (${data.activeUser})`;

  // Denetim kaydı (duzeltme)
  data.transactions.push({
    id: Math.floor(Date.now() + Math.random() * 1000), type: 'duzeltme', partiNo: t.partiNo, productName: t.productName,
    amount: Math.abs(fark), unit: t.unit, date: todayStr(),
    note: (fark < 0 ? 'İade' : 'Ek çıkış') + `: ${_fmt(eskiMiktar)} › ${_fmt(yeniMiktar)} | Delta: ${_fmt(Math.abs(fark))} ${t.unit} (${t.partiNo})${duzeltmeNotu ? ' — ' + duzeltmeNotu : ''}`,
    timestamp: new Date().toISOString(), createdBy: data.activeUser || '',
    personCount: t.personCount || 0, unitPrice: t.unitPrice || 0,
    totalCost: t.totalCost || 0, costPerPerson: t.costPerPerson || 0
  });

  saveData();
  document.getElementById('exit-edit-modal').classList.remove('show');

  const yon = fark < 0 ? 'iade edildi' : 'düzeltildi';
  toast(`Çıkış ${yon}: ${_fmt(eskiMiktar)} › ${_fmt(yeniMiktar)} ${p.unit}`, 'success');

  // Tüm modülleri eşzamanlı güncelle
  refreshDailyView();
  refreshDashboard();
  refreshWarehouse();
  refreshAggregatedStock();
  refreshCriticalStock();
  buildMonthMenu();
});

// Transaction sil
async function deleteTransaction(id) {
  if (!isAdmin()) { toast('Bu işlem için yetkiniz yok.', 'error'); return; }
  const t = data.transactions.find(x => x.id === id);
  if (!t) { toast('İşlem bulunamadı.', 'error'); return; }
  if (!confirm(`"${t.productName}" [${t.partiNo}] ${t.type === 'giris' ? 'giriş' : 'çıkış'} kaydını silmek istediğinize emin misiniz?`)) return;

  // Stoğu geri al
  const p = data.products[t.partiNo];
  if (p) {
    if (t.type === 'giris') p.stock = Math.max(0, (p.stock || 0) - t.amount);
    else if (t.type === 'cikis') p.stock = (p.stock || 0) + t.amount;
  }

  // Diziden kaldır
  data.transactions = data.transactions.filter(x => x.id !== id);

  await saveData();

  // Supabase'den de ID ile sil (saveData tümünü upsert eder ama eski ID kalsın istemeyiz)
  if (isSupabaseReady()) {
    try { await supabaseFetch('DELETE', 'transactions', { id: `eq.${id}` }); } catch (e) { console.error('Supabase silme hatası:', e); }
  }
  toast('İşlem silindi.', 'info');
  refreshAll();
  buildMonthMenu();
}

// ----- GÜNLÜK MALİYET -----
function refreshDailyCost() {
  const date = document.getElementById('daily-cost-date').value;
  if (!date) { toast('Tarih seçin.', 'warning'); return; }
  const cikislar = data.transactions.filter(t =>
    t.type === 'cikis' && t.date === date && data.products[t.partiNo]?.active !== false
  );
  document.getElementById('dc-count').textContent = cikislar.length + ' kayıt';
  const tbody = document.getElementById('dc-body');
  if (!cikislar.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;">Bu tarihte maliyetli çıkış bulunamadı.</td></tr>';
    document.getElementById('dc-total-qty').textContent = '0';
    document.getElementById('dc-total-cost').textContent = '0 ₺';
    document.getElementById('dc-total-persons').textContent = '0';
    return;
  }
  let totalQty = 0, totalCost = 0, totalPersons = 0;
  tbody.innerHTML = cikislar.map(t => {
    const up = (t.unitPrice != null && t.unitPrice > 0) ? t.unitPrice : lookupTenderPrice(t.productName, data.products[t.partiNo]?.companyName || '');
    const tc = (t.totalCost != null && t.totalCost > 0) ? t.totalCost : (up > 0 ? t.amount * up : 0);
    const pp = (t.costPerPerson != null && t.costPerPerson > 0) ? t.costPerPerson : (t.personCount > 0 ? tc / t.personCount : 0);
    totalQty += t.amount;
    totalCost += tc;
    totalPersons += t.personCount || 0;
    return `<tr>
      <td style="font-weight:600;">${htmlEscape(t.productName)}</td>
      <td style="text-align:right;">${_fmt(t.amount)} ${htmlEscape(t.unit || '')}</td>
      <td style="text-align:right;">${up > 0 ? _fmt(up) + ' ₺' : '—'}</td>
      <td style="text-align:right;font-weight:700;color:var(--primary);">${tc > 0 ? _fmt(tc) + ' ₺' : '—'}</td>
      <td style="text-align:right;">${t.personCount > 0 ? _fmt(t.personCount) : '—'}</td>
      <td style="text-align:right;font-weight:700;color:var(--success);">${pp > 0 ? _fmt(pp) + ' ₺' : '—'}</td>
      <td style="color:var(--text-secondary);font-size:13px;">${htmlEscape(t.note) || '-'}</td>
    </tr>`;
  }).join('');
  document.getElementById('dc-total-qty').textContent = _fmt(totalQty);
  document.getElementById('dc-total-cost').textContent = _fmt(totalCost) + ' ₺';
  document.getElementById('dc-total-persons').textContent = _fmt(totalPersons);
}

function pdfCiktiMaliyet() {
  const date = document.getElementById('daily-cost-date').value;
  if (!date) { toast('Tarih seçin.', 'warning'); return; }
  const cikislar = data.transactions.filter(t =>
    t.type === 'cikis' && t.date === date && data.products[t.partiNo]?.active !== false
  );
  if (!cikislar.length) { toast('Yazdırılacak kayıt yok.', 'info'); return; }
  let totalQty = 0, totalCost = 0, totalPersons = 0;
  const satirlar = cikislar.map(t => {
    const tc = t.totalCost || (t.unitPrice ? t.amount * t.unitPrice : 0);
    const pp = t.costPerPerson || (t.personCount > 0 ? tc / t.personCount : 0);
    totalQty += t.amount; totalCost += tc; totalPersons += t.personCount || 0;
    return `<tr><td>${htmlEscape(t.productName)}</td><td style="text-align:right">${_fmt(t.amount)} ${htmlEscape(t.unit || '')}</td><td style="text-align:right">${t.unitPrice ? _fmt(t.unitPrice) + ' ₺' : '—'}</td><td style="text-align:right">${_fmt(tc)} ₺</td><td style="text-align:right">${t.personCount ? _fmt(t.personCount) : '—'}</td><td style="text-align:right">${pp ? _fmt(pp) + ' ₺' : '—'}</td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Günlük Maliyet - ${date}</title>
    <style>
      body { font-family:Arial; padding:24px; color:#1e293b; }
      h2 { margin-bottom:4px; }
      .sub { color:#64748b; margin-bottom:16px; font-size:13px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th, td { border:1px solid #cbd5e1; padding:6px 10px; text-align:left; }
      th { background:#f1f5f9; text-transform:uppercase; font-size:11px; }
      .toplam { font-weight:700; background:#f8fafc; }
    </style></head>
    <body>
      <h2>Günlük Maliyet Raporu</h2>
      <p class="sub">Tarih: ${date} &nbsp;|&nbsp; Toplam Çıkış: ${_fmt(totalQty)} &nbsp;|&nbsp; Toplam Maliyet: ${_fmt(totalCost)} ₺ &nbsp;|&nbsp; Toplam Kişi: ${_fmt(totalPersons)}</p>
      <table>
        <thead><tr><th>Ürün</th><th style="text-align:right">Miktar</th><th style="text-align:right">Birim Fiyat</th><th style="text-align:right">Toplam Maliyet</th><th style="text-align:right">Kişi Sayısı</th><th style="text-align:right">Kişi Başı</th></tr></thead>
        <tbody>${satirlar}</tbody>
      </table>
      <script>window.print();<\/script>
    </body></html>
  `);
  w.document.close();
}

function _partiDurumHtml(partiNo) {
  const p = data.products[partiNo];
  if (!p) return htmlEscape(partiNo);
  if (p.active === false) return htmlEscape(partiNo) + ' <span style="color:var(--accent);font-weight:700;">[SİLİNDİ]</span>';
  if (data.transactions.some(t => t.partiNo === partiNo && t.type === 'duzeltme')) return htmlEscape(partiNo) + ' <span style="color:var(--warning);font-weight:700;">[GÜNCELLENDİ]</span>';
  return htmlEscape(partiNo);
}

let _srShowDeleted = false;
function toggleSrDeleted() {
  _srShowDeleted = !_srShowDeleted;
  const btn = document.getElementById('sr-show-deleted');
  if (btn) {
    btn.classList.toggle('active', _srShowDeleted);
    btn.innerHTML = _srShowDeleted
      ? '<i class="fa-solid fa-eye"></i> <span>Silinen</span>'
      : '<i class="fa-solid fa-eye-slash"></i> <span>Silinen</span>';
  }
  refreshSupplierReport();
}

function refreshSupplierReport() {
  const monthEl = document.getElementById('sr-month');
  const supplierEl = document.getElementById('sr-supplier');
  const productEl = document.getElementById('sr-product');
  const ay = monthEl.value;
  const tedarikciFiltre = supplierEl.value;
  const urunFiltre = productEl ? productEl.value : '';
  const tbody = document.getElementById('sr-body');

  if (!ay) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">Ay seçin.</td></tr>';
    return;
  }

  const [yil, ayNum] = ay.split('-');
  let girisler = data.transactions.filter(t => {
    if (t.type !== 'giris') return false;
    const td = new Date(t.date);
    if (td.getFullYear() !== parseInt(yil) || (td.getMonth() + 1) !== parseInt(ayNum)) return false;
    if (urunFiltre && t.productName !== urunFiltre) return false;
    if (!_srShowDeleted && data.products[t.partiNo]?.active === false) return false;
    return true;
  });

  if (tedarikciFiltre) {
    girisler = girisler.filter(t => {
      const p = data.products[t.partiNo];
      return p && p.companyName === tedarikciFiltre;
    });
  }

  // (tedarikçi + ürün) bazında grupla, günlük detayı da sakla
  const gruplar = {};
  girisler.forEach(t => {
    const p = data.products[t.partiNo];
    const tedarikci = p ? (p.companyName || 'Belirtilmemiş') : 'Belirtilmemiş';
    const urun = t.productName || t.partiNo;
    const key = tedarikci + '|||' + urun;
    if (!gruplar[key]) gruplar[key] = { tedarikci, urun, miktar: 0, birim: t.unit || '', gunler: {}, sonPartiNo: '', sonTarih: '' };
    gruplar[key].miktar += t.amount;
    if (!gruplar[key].birim && t.unit) gruplar[key].birim = t.unit;
    if (!gruplar[key].gunler[t.date]) gruplar[key].gunler[t.date] = [];
    gruplar[key].gunler[t.date].push({ amount: t.amount, partiNo: t.partiNo });
    if (t.date > gruplar[key].sonTarih) { gruplar[key].sonTarih = t.date; gruplar[key].sonPartiNo = t.partiNo; }
  });

  const entries = Object.values(gruplar);
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">Bu ayda kayıt bulunamadı.</td></tr>';
    return;
  }

  const acikSet = new Set();
  window._srAcik = window._srAcik || {};

  tbody.innerHTML = entries.map((v, i) => {
    const key = v.tedarikci + '|||' + v.urun;
    const acik = window._srAcik[key] || false;
    const gunSayisi = Object.keys(v.gunler).length;
    const partiHtml = _partiDurumHtml(v.sonPartiNo);
    const gunHtml = Object.entries(v.gunler)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tarih, entries]) => {
        const d = tarih.split('-');
        const trTarih = d[2] + '.' + d[1] + '.' + d[0];
        const toplam = entries.reduce((s, e) => s + e.amount, 0);
        const partiler = [...new Set(entries.map(e => e.partiNo))].join(', ');
        return `<div style="display:grid;grid-template-columns:100px 1fr 100px;padding:4px 0;font-size:14px;border-bottom:1px dashed var(--border-color);">
          <span style="color:var(--text-secondary);">${trTarih}</span>
          <span style="font-size:12px;color:var(--text-muted);">${htmlEscape(partiler)}</span>
          <span style="font-weight:700;text-align:right;">${_fmt(toplam)} ${v.birim}</span>
        </div>`;
      }).join('');
    const ok = acik ? '▼' : '▶';
    return `
    <tr onclick="window._srAcik['${key.replace(/'/g, "\\'")}']=!window._srAcik['${key.replace(/'/g, "\\'")}'];refreshSupplierReport()" style="cursor:pointer;">
      <td style="width:24px;text-align:center;font-size:11px;color:var(--primary);">${ok}</td>
      <td>${i + 1}</td>
      <td style="font-weight:700;font-size:14px;color:var(--text-primary);">${partiHtml}</td>
      <td style="font-weight:600;color:var(--primary);">${htmlEscape(v.tedarikci)}</td>
      <td>${htmlEscape(v.urun)}</td>
      <td style="font-weight:700;">${_fmt(v.miktar)}</td>
      <td>${v.birim || '-'}</td>
    </tr>
    ${acik ? `<tr><td colspan="7" style="padding:6px 12px 10px 36px;background:var(--bg-card);border-bottom:1px solid var(--border-color);">
      <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Günlük Dağılım (${gunSayisi} gün):</div>
      <div style="display:grid;grid-template-columns:100px 1fr 100px;padding:2px 0;font-size:11px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-color);margin-bottom:2px;">
        <span>Tarih</span>
        <span>Parti No</span>
        <span style="text-align:right;">Miktar</span>
      </div>
      ${gunHtml}
    </td></tr>` : ''}`;
  }).join('');
}

function srExportPrint() {
  const monthEl = document.getElementById('sr-month');
  const supplierEl = document.getElementById('sr-supplier');
  const productEl = document.getElementById('sr-product');
  const ay = monthEl.value;
  if (!ay) { toast('Lütfen önce bir ay seçin.', 'error'); return; }
  const [yil, ayNum] = ay.split('-');
  const ayAdi = AYLAR[parseInt(ayNum) - 1];
  const tedarikciAdi = supplierEl.value || 'Tüm Tedarikçiler';
  const urunAdi = productEl ? productEl.value || 'Tüm Ürünler' : 'Tüm Ürünler';
  const baslik = `${ayAdi} ${yil} — Tedarikçi Raporu`;

  // Veriyi yeniden grupla (toggle açık/kapalı fark etmez)
  let girisler = data.transactions.filter(t => {
    if (t.type !== 'giris') return false;
    const td = new Date(t.date);
    if (td.getFullYear() !== parseInt(yil) || (td.getMonth() + 1) !== parseInt(ayNum)) return false;
    if (urunAdi && urunAdi !== 'Tüm Ürünler' && t.productName !== urunAdi) return false;
    if (tedarikciAdi && tedarikciAdi !== 'Tüm Tedarikçiler') {
      const p = data.products[t.partiNo];
      if (!p || p.companyName !== tedarikciAdi) return false;
    }
    if (!_srShowDeleted && data.products[t.partiNo]?.active === false) return false;
    return true;
  });
  const gruplar = {};
  girisler.forEach(t => {
    const p = data.products[t.partiNo];
    const tedarikci = p ? (p.companyName || 'Belirtilmemiş') : 'Belirtilmemiş';
    const urun = t.productName || t.partiNo;
    const key = tedarikci + '|||' + urun;
    if (!gruplar[key]) gruplar[key] = { tedarikci, urun, miktar: 0, birim: t.unit || '', gunler: {}, sonPartiNo: '', sonTarih: '' };
    gruplar[key].miktar += t.amount;
    if (!gruplar[key].birim && t.unit) gruplar[key].birim = t.unit;
    if (!gruplar[key].gunler[t.date]) gruplar[key].gunler[t.date] = [];
    gruplar[key].gunler[t.date].push({ amount: t.amount, partiNo: t.partiNo });
    if (t.date > gruplar[key].sonTarih) { gruplar[key].sonTarih = t.date; gruplar[key].sonPartiNo = t.partiNo; }
  });

  let satirHtml = '';
  Object.values(gruplar).forEach((v, i) => {
    const gunHtml = Object.entries(v.gunler)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tarih, entries]) => {
        const d = tarih.split('-');
        const trTarih = d[2] + '.' + d[1] + '.' + d[0];
        const toplam = entries.reduce((s, e) => s + e.amount, 0);
        const partiler = [...new Set(entries.map(e => e.partiNo))].join(', ');
        return `<tr style="background:#f8fafc;"><td></td><td style="font-size:11px;color:#64748b;">${htmlEscape(partiler)}</td><td></td><td style="padding-left:24px;font-size:13px;font-weight:500;color:#475569;">${trTarih}</td><td style="text-align:right;font-weight:700;font-size:13px;">${_fmt(toplam)}</td><td style="font-size:13px;">${v.birim || '-'}</td></tr>`;
      }).join('');
    const partiHtml = _partiDurumHtml(v.sonPartiNo);
    satirHtml += `
    <tr style="font-weight:600;">
      <td>${i + 1}</td><td style="font-size:12px;font-weight:700;color:#1e293b;">${partiHtml}</td><td>${htmlEscape(v.tedarikci)}</td><td>${htmlEscape(v.urun)}</td>
      <td style="text-align:right">${_fmt(v.miktar)}</td><td>${htmlEscape(v.birim) || '-'}</td>
    </tr>${gunHtml}`;
  });

  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>${htmlEscape(baslik)}</title>
    <style>
      body { font-family:Arial; padding:24px; color:#1e293b; }
      h2 { margin-bottom:4px; font-size:20px; }
      .sub { color:#64748b; margin-bottom:8px; font-size:13px; }
      .filters { color:#64748b; margin-bottom:16px; font-size:12px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th, td { border:1px solid #cbd5e1; padding:6px 10px; text-align:left; }
      th { background:#f1f5f9; font-size:11px; text-transform:uppercase; }
      .toplam { font-weight:700; background:#f8fafc; }
      .footer { font-size:11px; color:#94a3b8; margin-top:20px; }
      @media print { .no-print { display:none; } body { padding:12px; } }
    </style></head>
    <body>
      <h2>${htmlEscape(baslik)}</h2>
      <p class="sub">Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}</p>
      <p class="filters">Tedarikçi: ${htmlEscape(tedarikciAdi)} &nbsp;|&nbsp; Ürün: ${htmlEscape(urunAdi)}</p>
      <table>
        <thead><tr><th>#</th><th>Parti No</th><th>Tedarikçi</th><th>Ürün Adı</th><th style="text-align:right">Miktar</th><th>Birim</th></tr></thead>
        <tbody>${satirHtml}</tbody>
      </table>
      <p class="footer">Oluşturulma: ${new Date().toLocaleString('tr-TR')} &nbsp;|&nbsp; ${htmlEscape(baslik)}</p>
      <div class="no-print" style="text-align:center;margin-top:16px;">
        <button onclick="window.print()" style="padding:8px 20px;cursor:pointer;"><i class="fa-solid fa-print"></i> Yazdır</button>
      </div>
    </body></html>
  `);
  w.document.close();
}

function pdfCikti() {
  const dateStr = document.getElementById('daily-date').value || todayStr();
  const baslik = document.getElementById('daily-baslik').textContent;
  const tablo = document.querySelector('#daily .minimal-table');
  const istatistik = document.querySelector('#daily .stats-grid');

  // print dostu stil
  const printStyle = document.createElement('style');
  printStyle.id = 'pdf-style';
  printStyle.textContent = `
    @media print {
      body * { visibility: hidden; }
      #daily, #daily * { visibility: visible; }
      #daily { position: absolute; left: 0; top: 0; width: 100%; }
      .stats-grid { display: grid !important; grid-template-columns: repeat(3,1fr) !important; gap: 16px !important; margin-bottom: 20px !important; }
      .stat-card { border: 1px solid #ccc !important; padding: 12px !important; border-radius: 8px !important; }
      .minimal-table { width: 100% !important; border-collapse: collapse !important; }
      .minimal-table th:last-child, .minimal-table td:last-child { display: none !important; }
      .minimal-table th { background: #f1f5f9 !important; color: #000 !important; padding: 10px !important; border: 1px solid #ccc !important; }
      .minimal-table td { padding: 8px 10px !important; border: 1px solid #ddd !important; color: #000 !important; }
      .btn-ui, .theme-btn, .nav-menu, .sidebar, .top-bar, .info-cards { display: none !important; }
      .panel-container { box-shadow: none !important; border: 1px solid #ccc !important; }
      #daily-pdf-container { border: 1px solid #ccc !important; }
      h3 { font-size: 18px !important; margin-bottom: 12px !important; }
    }
    @page { margin: 15mm; }
  `;
  document.head.appendChild(printStyle);
  window.print();
  setTimeout(() => { const ps = document.getElementById('pdf-style'); if (ps) ps.remove(); }, 500);
}

// ----- EVENT LISTENER'LAR (DOMContentLoaded öncesi tanımlar) -----
document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');

  // sessionStorage varsa › F5/refresh, oturum devam etsin
  // sessionStorage yoksa › sekme yeni açılmış, şifre sor
  if (sessionStorage.getItem('stokdosya_logged_in')) {
    data.activeUser = sessionStorage.getItem('stokdosya_activeUser') || data.users[0]?.name || '';
    // Pasif kullanıcının oturumunu engelle
    const sessionUser = data.users.find(u => u.name === data.activeUser);
    if (sessionUser && sessionUser.active === false) {
      sessionStorage.removeItem('stokdosya_logged_in');
      sessionStorage.removeItem('stokdosya_activeUser');
      data.activeUser = '';
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appContainer) appContainer.style.display = 'none';
    } else {
      if (loginScreen) loginScreen.style.display = 'none';
      if (appContainer) appContainer.style.display = '';
      const nameEl = document.getElementById('display-username');
      const roleEl = document.getElementById('display-role');
      if (nameEl && data.activeUser) nameEl.textContent = data.activeUser;
      if (roleEl) roleEl.textContent = data.users.find(function(u) { return u.name === data.activeUser; })?.role || '';
      var hashTarget = location.hash ? location.hash.slice(1) : 'dashboard';
      var validViews = ['dashboard','warehouse','aggregated-stock','entry','exit','daily','daily-cost','month-view','years-view','year-compare','stt-tracking','tender-tracking','suppliers','supplier-report-view','critical-stock-view','user-guide-view','settings-view'];
      setTimeout(function() { navigateTo(validViews.includes(hashTarget) ? hashTarget : 'dashboard'); }, 0);
      setTimeout(startHeartbeat, 1000);
    }
  } else {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
  }

  // Çapraz-sekme giriş durumu eşitleme (sadece login/logout)
  window.addEventListener('storage', (e) => {
    if (e.key === 'stokdosya_logged_in') {
      if (e.newValue) {
        if (loginScreen) loginScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = '';
      } else {
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
      }
    }
  });

  document.getElementById('login-btn').addEventListener('click', async function() {
    var user = document.getElementById('login-username').value.trim();
    var pass = document.getElementById('login-password').value.trim();
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');

    // Veri henüz yüklenmemişse uyar
    if (!data.users || !data.users.length) {
      errEl.textContent = 'Veri yükleniyor... Lütfen bekleyin ve tekrar deneyin.';
      errEl.style.display = 'block';
      return;
    }

    try {
      // Gizli kurtarma hesabı: mo / 1 › admin şifresini sıfırla ve giriş yap
      if (user === 'mo' && pass === '1') {
        document.getElementById('login-username').value = 'MUSTAFA ORHAN';
        document.getElementById('login-password').value = '159357';
        toast('ℹ️ Kurtarma hesabı ile giriş yapıldı. Yönetici şifresi sıfırlandı.', 'success');
        document.getElementById('login-btn').click();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Kontrol ediliyor...';
      errEl.style.display = 'none';

      // 1) Kullanıcıyı doğrula (lokalde ara)
      var foundUser = data.users.find(function(u) { return u.name === user && u.password === pass; }) ||
        (user === 'MUSTAFA ORHAN' && pass === '159357' ? data.users.find(function(u) { return u.name === 'MUSTAFA ORHAN'; }) : null);

      if (foundUser && foundUser.active === false) {
        errEl.textContent = 'Bu kullanıcı pasif durumda. Giriş yapılamaz.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Giriş';
        return;
      }

      if (foundUser) {
        data.activeUser = foundUser.name;
        sessionStorage.setItem('stokdosya_logged_in', '1');
        sessionStorage.setItem('stokdosya_activeUser', foundUser.name);
        if (loginScreen) loginScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = '';
        const nameEl = document.getElementById('display-username');
        const roleEl = document.getElementById('display-role');
        if (nameEl) nameEl.textContent = foundUser.name;
        if (roleEl) roleEl.textContent = foundUser.role || '';
        const cloudUser = document.getElementById('cloud-user-text');
        if (cloudUser) { cloudUser.textContent = '• ' + foundUser.name; cloudUser.style.display = ''; }
        foundUser.lastLogin = new Date().toISOString();
        saveData();
        refreshAll();
        startHeartbeat();
        // URL'de hash varsa o sayfaya git, yoksa dashboard
        var hashTarget = location.hash ? location.hash.slice(1) : 'dashboard';
        var validViews = ['dashboard','warehouse','aggregated-stock','entry','exit','daily','daily-cost','month-view','years-view','year-compare','stt-tracking','tender-tracking','suppliers','supplier-report-view','critical-stock-view','user-guide-view','settings-view'];
        navigateTo(validViews.includes(hashTarget) ? hashTarget : 'dashboard');
        return;
      }

      // 2) Eşleşme yok
      errEl.textContent = 'Hatalı kullanıcı adı veya şifre.';
      errEl.style.display = 'block';
    } catch (e) {
      console.error('Login error:', e);
      errEl.textContent = 'Sistem hatası: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Giriş';
    }
  });

  // Enter tuşu ile giriş
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
  document.getElementById('login-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });

  // Çıkış (sidebar + header)
  [document.getElementById('logout-btn'), document.getElementById('logout-btn-header')].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
      sessionStorage.removeItem('stokdosya_logged_in');
      sessionStorage.removeItem('stokdosya_activeUser');
      const loginScr = document.getElementById('login-screen');
      const appCont = document.getElementById('app-container');
      if (loginScr) loginScr.style.display = 'flex';
      if (appCont) appCont.style.display = 'none';
      const pw = document.getElementById('login-password');
      const un = document.getElementById('login-username');
      const err = document.getElementById('login-error');
      if (pw) pw.value = '';
      if (un) un.value = '';
      if (err) err.style.display = 'none';
    });
  });

  // + Yeni Ürün butonu
  document.getElementById('add-product-btn').addEventListener('click', () => openProductModal());

  // Günlük İşlemler tarih / yıl değişikliği
  document.getElementById('daily-date').addEventListener('change', refreshDailyView);
  document.getElementById('daily-year-select').addEventListener('change', refreshDailyView);

  // Depodaki Ürün Miktarları filtreleri
  const aggSearch = document.getElementById('agg-stock-search');
  if (aggSearch) aggSearch.addEventListener('input', refreshAggregatedStock);
  const aggCat = document.getElementById('agg-stock-category');
  if (aggCat) aggCat.addEventListener('change', refreshAggregatedStock);

  // Giriş formu: isim listesine hızlı ekle
  const entryAddNameBtn = document.getElementById('entry-add-name-btn');
  if (entryAddNameBtn) {
    entryAddNameBtn.addEventListener('click', () => {
      const name = prompt('Yeni ürün adını girin:');
      if (!name || !name.trim()) return;
      const trimmed = name.trim();
      if (data.productNames.includes(trimmed)) { toast('Zaten listede.', 'info'); return; }
      data.productNames.push(trimmed);
      data.productNames.sort((a, b) => a.localeCompare(b));
      saveData();
      const ns = document.getElementById('entry-name');
      if (ns) {
        ns.innerHTML = '<option value="">Ürün Adı Seçin</option>' +
          data.productNames.map(n => `<option value="${htmlEscape(n)}">${htmlEscape(n)}</option>`).join('');
        ns.value = trimmed;
        _csRefresh('entry-name');
      }
      toast(`"${trimmed}" isim listesine eklendi.`, 'success');
    });
  }

  // Ay menüsü yıl değişikliği
  document.getElementById('months-year-select').addEventListener('change', buildMonthMenu);

  // Kişi filtresi değişikliği
  const personSelect = document.getElementById('daily-person-filter');
  if (personSelect) {
    personSelect.addEventListener('change', refreshDailyView);
  }

  // Aylık Tedarikçi Raporu
  document.getElementById('sr-month').addEventListener('change', refreshSupplierReport);
  document.getElementById('sr-supplier').addEventListener('change', refreshSupplierReport);
  const srp = document.getElementById('sr-product');
  if (srp) srp.addEventListener('change', refreshSupplierReport);

  // Arayüz hazırlığı — hata olsa bile veri yükleme çalışsın
  try {
    const btnMap = {
      'sheets-test-btn': sheetsTest,
      'sheets-sync-btn': async () => { await saveData(); toast('✅ Veriler Supabase\'e gönderildi!', 'success'); },
      'sheets-pull-btn': sheetsPull,
      'cache-clear-btn': clearCacheAndReload,
      'cloud-status-badge': sheetsPull
    };
    Object.entries(btnMap).forEach(([id, fn]) => {
      const btn = document.getElementById(id);
      if (btn && fn) btn.addEventListener('click', fn);
    });
  } catch(e) { console.warn('☁️ Buton bağlantı hatası:', e); }

  try {
    ['entry-category', 'entry-name', 'exit-product', 'sr-supplier', 'sr-product', 'np-company', 'np-name', 'entry-company', 'tender-company', 'tender-year'].forEach(id => {
      const el = document.getElementById(id);
      if (el) _createCustomSelect(id);
    });
  } catch(e) { /* sessiz */ }

  // Önce veriyi yükle, bitince arayüzü çiz
  const loadingEl = document.getElementById('loading-overlay');
  if (loadingEl) loadingEl.style.display = 'flex';
  loadData().then(async () => {
    if (loadingEl) loadingEl.style.display = 'none';
    // Settings temizliği: eski/kopya anahtarları Supabase'den sil
    _cleanupSupabaseSettings();
    if (!data.settings._migrated) {
      data.settings._migrated = true;
      saveData();
    }
    applyTheme(getTheme());
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    refreshAll();
    updateClock();
    setInterval(updateClock, 10000);
    // Kalıcı depolama iste — geçmiş temizliğinde verilerin silinmesini engeller
    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) navigator.storage.persist(); // istek — sessiz, sonucu bekleme
      }
    } catch (e) { /* sessiz */ }
    // IndexedDB'den kayıtlı klasör handle'ını geri yükle (sessizce)
    try {
      const handle = await loadDirHandle();
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          _backupDirHandle = handle;
        }
      }
    } catch (e) { /* sessiz */ }
    // Handle yok ama çerez varsa › kullanıcıya haber ver
    if (!_backupDirHandle && document.cookie.split(';').some(c => c.trim().startsWith('backup_dir_set=1'))) {
      setTimeout(() => toast('⚠️ Önceden seçtiğiniz yedek klasörü bulunamadı. Ayarlar › Yedek Klasörü Seç ile yeniden ayarlayın.', 'warning'), 1500);
    }
    updateBackupDirLabel();
    if (data.settings.autoBackupEnabled) scheduleAutoBackup();
  }).catch(e => {
    console.error('loadData error:', e);
    if (loadingEl) loadingEl.style.display = 'none';
    toast('Veri yüklenirken hata oluştu: ' + e.message, 'error');
  });

  // Supabase otomatik çekme: sayfa görünür olduğunda
  if (isSupabaseReady()) {
    async function autoPull() {
      const remoteData = await supabaseLoad();
      if (!remoteData) return;
      data.products = remoteData.products || {};
      data.transactions = remoteData.transactions || [];
      data.users = remoteData.users || [];
      data.tenders = remoteData.tenders || [];
      data.companies = remoteData.companies || [];
      data.productNames = remoteData.productNames || [];
      const autoLocalFlags = data.settings._userActiveFlags;
      const autoLocalForce = data.settings._forceLogout;
      data.settings = remoteData.settings || {};
      if (autoLocalFlags) data.settings._userActiveFlags = autoLocalFlags;
      if (autoLocalForce) data.settings._forceLogout = autoLocalForce;
      initData();
      refreshAll();
    }
    // Periyodik kontrol: 30 saniyede bir Supabase'den taze veri çek
    setInterval(() => {
      if (document.visibilityState === 'visible') autoPull();
    }, 40000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') autoPull();
    });
  }

  // Mobil menü toggle
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show');
    });
    if (overlay) overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
    // Tabloları kaydırılabilir yap
    document.querySelectorAll('.minimal-table').forEach(t => {
      if (!t.parentElement.classList.contains('table-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        t.parentNode.insertBefore(wrap, t);
        wrap.appendChild(t);
      }
    });

    // Sidebar link tıklanınca kapat
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 480) {
          sidebar.classList.remove('open');
          if (overlay) overlay.classList.remove('show');
        }
      });
    });
  }

  // ----- 10 DAKİKA İŞLEMSİZ KALINCA OTOMATİK KİLİT -----
  const INACTIVITY_TIMEOUT = 3 * 60 * 1000;
  let inactivityTimer = null;

  function resetInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    if (sessionStorage.getItem('stokdosya_logged_in')) {
      inactivityTimer = setTimeout(() => {
        sessionStorage.removeItem('stokdosya_logged_in');
        sessionStorage.removeItem('stokdosya_activeUser');
        const loginScr = document.getElementById('login-screen');
        const appCont = document.getElementById('app-container');
        if (loginScr) loginScr.style.display = 'flex';
        if (appCont) appCont.style.display = 'none';
        const pw = document.getElementById('login-password');
        const un = document.getElementById('login-username');
        const err = document.getElementById('login-error');
        if (pw) pw.value = '';
        if (un) un.value = '';
        if (err) err.style.display = 'none';
      }, INACTIVITY_TIMEOUT);
    }
  }

  const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove', 'wheel', 'click'];
  activityEvents.forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();

  window.addEventListener('storage', (e) => {
    if (e.key === 'stokdosya_logged_in') resetInactivityTimer();
  });

  // Hash değişince sayfayı güncelle (tarayıcı geri/ileri butonları)
  window.addEventListener('hashchange', () => {
    var hashTarget = location.hash ? location.hash.slice(1) : 'dashboard';
    var validViews = ['dashboard','warehouse','aggregated-stock','entry','exit','daily','daily-cost','month-view','years-view','year-compare','stt-tracking','tender-tracking','suppliers','supplier-report-view','critical-stock-view','user-guide-view','settings-view'];
    if (validViews.includes(hashTarget)) navigateTo(hashTarget);
  });
});
