/**
 * سامانه مدیریت اتوماسیون و ارتباطات - هسته پردازش منطق، دیتابیس و ارتباط با سخت‌افزار
 * سازگار با Cloudflare Pages، PWA و کارکرد ۱۰۰٪ آفلاین (Offline-First)
 */

// ==========================================
// ۱. تبدیل تاریخ میلادی به هجری شمسی (Jalali)
// ==========================================
function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 0) days = (days - 1) % 365;
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { jy, jm, jd };
}

function getFormattedJalali(date = new Date()) {
  const { jy, jm, jd } = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  const daysOfWeek = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const dayName = daysOfWeek[date.getDay()];
  const monthName = months[jm - 1];
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const dateNumStr = `${jy}/${pad(jm)}/${pad(jd)}`;
  const fullPersian = `${dayName}، ${jd} ${monthName} ${jy} - ساعت ${timeStr.slice(0, 5)}`;
  return { jy, jm, jd, dateNumStr, timeStr, fullPersian };
}

// تابع امن سراسری escapeHtml جهت جلوگیری از حملات XSS و خطاهای ReferenceError
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

// ==========================================
// ۲. مدیریت دیتابیس محلی (IndexedDB)
// ==========================================
const DB_NAME = 'AutomationGraphDB';
const DB_VERSION = 7;

function openDB() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      try {
        request = indexedDB.open(DB_NAME);
      } catch (err) {
        return reject(err);
      }
    }

    request.onerror = () => {
      // اگر نسخه درخواستی کمتر از دیتابیس موجود باشد (خطای VersionError)، بدون تعیین نسخه باز می‌کنیم
      if (request.error && (request.error.name === 'VersionError' || (request.error.message && request.error.message.includes('less than')))) {
        console.warn('Recovering from VersionError: opening existing DB without version constrain');
        try {
          const fallbackReq = indexedDB.open(DB_NAME);
          fallbackReq.onsuccess = () => resolve(fallbackReq.result);
          fallbackReq.onerror = () => reject(fallbackReq.error);
          return;
        } catch (fbErr) {
          return reject(fbErr);
        }
      }
      reject(request.error);
    };

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (e) => {
      const db = request.result;
      if (!db.objectStoreNames.contains('graphs')) {
        const store = db.createObjectStore('graphs', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('syncStatus', 'syncStatus', { unique: false });
        store.createIndex('unit', 'operator.unit', { unique: false });
        store.createIndex('activityType', 'activityType', { unique: false });
      }
      if (!db.objectStoreNames.contains('admins')) {
        const adminStore = db.createObjectStore('admins', { keyPath: 'username' });
        adminStore.createIndex('username', 'username', { unique: true });
      }
      if (!db.objectStoreNames.contains('personnel')) {
        const pStore = db.createObjectStore('personnel', { keyPath: 'code' });
        pStore.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('asset_rebuildables')) {
        const arStore = db.createObjectStore('asset_rebuildables', { keyPath: 'id', autoIncrement: true });
        arStore.createIndex('asset', 'asset', { unique: false });
        arStore.createIndex('supervision', 'supervision', { unique: false });
        arStore.createIndex('unit', 'unit', { unique: false });
      }
    };
  });
}

async function saveGraphRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('graphs', 'readwrite');
    const store = tx.objectStore('graphs');
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllGraphRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('graphs', 'readonly');
    const store = tx.objectStore('graphs');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteGraphRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('graphs', 'readwrite');
    const store = tx.objectStore('graphs');
    const req = store.delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function updateGraphRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('graphs', 'readwrite');
    const store = tx.objectStore('graphs');
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAdminsList() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('admins', 'readonly');
    const store = tx.objectStore('admins');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveAdminUser(admin) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('admins', 'readwrite');
    const store = tx.objectStore('admins');
    const req = store.put(admin);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteAdminUser(username) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('admins', 'readwrite');
    const store = tx.objectStore('admins');
    const req = store.delete(username);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// عملیات بانک اطلاعات پرسنل در دیتابیس محلی IndexedDB
async function getAllPersonnelFromDB() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('personnel')) return [];
    return new Promise((resolve) => {
      const tx = db.transaction('personnel', 'readonly');
      const store = tx.objectStore('personnel');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.warn('getAllPersonnelFromDB error:', e);
    return [];
  }
}

async function savePersonnelRecordToDB(p) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('personnel')) return;
    return new Promise((resolve) => {
      const tx = db.transaction('personnel', 'readwrite');
      const store = tx.objectStore('personnel');
      const req = store.put(p);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('savePersonnelRecordToDB error:', e);
  }
}

async function saveMultiplePersonnelToDB(list) {
  if (!list || !list.length) return;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('personnel')) return;
    return new Promise((resolve) => {
      const tx = db.transaction('personnel', 'readwrite');
      const store = tx.objectStore('personnel');
      for (let i = 0; i < list.length; i++) {
        store.put(list[i]);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('saveMultiplePersonnelToDB error:', e);
  }
}

async function deletePersonnelFromDB(code) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('personnel')) return;
    return new Promise((resolve) => {
      const tx = db.transaction('personnel', 'readwrite');
      const store = tx.objectStore('personnel');
      const req = store.delete(String(code));
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('deletePersonnelFromDB error:', e);
  }
}

async function clearPersonnelDB() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('personnel')) return;
    return new Promise((resolve) => {
      const tx = db.transaction('personnel', 'readwrite');
      const store = tx.objectStore('personnel');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('clearPersonnelDB error:', e);
  }
}

// عملیات بانک اطلاعات تجهیزات و قطعات بازسازی (Asset & Rebuildable)
async function getAllAssetRebuildableRecordsFromDB() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('asset_rebuildables')) {
      return JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
    }
    return new Promise((resolve) => {
      const tx = db.transaction('asset_rebuildables', 'readonly');
      const store = tx.objectStore('asset_rebuildables');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        localStorage.setItem('automation_asset_rebuildables', JSON.stringify(list));
        resolve(list);
      };
      req.onerror = () => {
        const fallback = JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
        resolve(fallback);
      };
    });
  } catch (e) {
    console.warn('getAllAssetRebuildableRecordsFromDB error:', e);
    return JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
  }
}

async function saveAssetRebuildableRecordToDB(record) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('asset_rebuildables')) {
      const list = JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
      if (!record.id) record.id = Date.now() + Math.floor(Math.random() * 1000);
      const idx = list.findIndex(r => r.id === record.id);
      if (idx >= 0) list[idx] = record;
      else list.push(record);
      localStorage.setItem('automation_asset_rebuildables', JSON.stringify(list));
      return record.id;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('asset_rebuildables', 'readwrite');
      const store = tx.objectStore('asset_rebuildables');
      const req = store.put(record);
      req.onsuccess = () => {
        record.id = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('saveAssetRebuildableRecordToDB error:', e);
    const list = JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
    if (!record.id) record.id = Date.now() + Math.floor(Math.random() * 1000);
    const idx = list.findIndex(r => r.id === record.id);
    if (idx >= 0) list[idx] = record;
    else list.push(record);
    localStorage.setItem('automation_asset_rebuildables', JSON.stringify(list));
    return record.id;
  }
}

async function saveMultipleAssetRebuildablesToDB(records) {
  if (!records || !records.length) return;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('asset_rebuildables')) {
      const list = JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
      records.forEach(r => {
        if (!r.id) r.id = Date.now() + Math.floor(Math.random() * 100000);
        list.push(r);
      });
      localStorage.setItem('automation_asset_rebuildables', JSON.stringify(list));
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction('asset_rebuildables', 'readwrite');
      const store = tx.objectStore('asset_rebuildables');
      records.forEach(r => {
        if (!r.id) delete r.id; // اجازه تولید خودکار id در صورت وجود autoIncrement
        store.put(r);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('saveMultipleAssetRebuildablesToDB error:', e);
  }
}

async function deleteAssetRebuildableRecordFromDB(id) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('asset_rebuildables')) {
      let list = JSON.parse(localStorage.getItem('automation_asset_rebuildables') || '[]');
      list = list.filter(r => r.id !== id);
      localStorage.setItem('automation_asset_rebuildables', JSON.stringify(list));
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction('asset_rebuildables', 'readwrite');
      const store = tx.objectStore('asset_rebuildables');
      const req = store.delete(Number(id) || id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('deleteAssetRebuildableRecordFromDB error:', e);
  }
}

// ==========================================
// ۳. وضعیت برنامه، پوسته (تم) و متغیرهای سراسری
// ==========================================
window.AppState = {
  currentView: 'home',
  currentUser: null,
  operator: null,
  capturedImageBase64: null,
  capturedImages: [], // پشتیبانی از چندین عکس
  addedActivities: [], // پشتیبانی از افزودن چندین فعالیت پویا (دکمه ADD)
  currentLocation: { lat: null, lng: null, accuracy: null, timestamp: null },
  colleagues: [],
  personnel: [], // بانک اطلاعات پرسنل اکسل (کد پرسنلی و نام)
  personnelMap: new Map(), // مپ سریع بر اساس کد پرسنلی
  personnelSearchQuery: '',
  personnelCurrentPage: 1,
  personnelPageSize: 50,
  assetRecords: [], // لیست رکوردهای تجهیزات و قطعات بازسازی
  filteredAssetRecords: [], // رکوردهای فیلترشده جاری برای کاربر
  assetSearchQuery: '',
  assetFilterSupervision: '',
  assetFilterUnit: '',
  deferredPrompt: null,
  selectedQrTargetField: null,
  activeCameraStream: null,
  theme: localStorage.getItem('automation_app_theme') || 'dark',
};

function applyTheme(themeName) {
  const isLight = themeName === 'light';
  window.AppState.theme = themeName;
  localStorage.setItem('automation_app_theme', themeName);

  if (isLight) {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  }

  // به‌روزرسانی دکمه و متای تم
  const themeText = document.getElementById('themeToggleText');
  const sunIcon = document.getElementById('themeSunIcon');
  const moonIcon = document.getElementById('themeMoonIcon');
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');

  if (themeText) {
    themeText.textContent = isLight ? 'حالت شب' : 'حالت روز';
  }
  if (sunIcon && moonIcon) {
    if (isLight) {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    }
  }
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', isLight ? '#f1f5f9' : '#0f172a');
  }
}

function toggleTheme() {
  const current = window.AppState.theme || (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const nextTheme = current === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  if (typeof showToast === 'function') {
    showToast(`حالت ${nextTheme === 'light' ? 'روز (روشن)' : 'شب (تاریک)'} فعال شد`, 'info');
  }
}

function initThemeUI() {
  const currentTheme = localStorage.getItem('automation_app_theme') || 'dark';
  applyTheme(currentTheme);
}

function loadOperatorProfile() {
  try {
    const stored = localStorage.getItem('automation_operator_profile');
    if (stored) {
      window.AppState.operator = JSON.parse(stored);
      if (window.AppState.operator && window.AppState.operator.personnelId) {
        const match = findPersonnelByCode(window.AppState.operator.personnelId);
        if (match) {
          const parsed = parsePersonnelFullName(match.name);
          let changed = false;
          if (!window.AppState.operator.fatherName && parsed.fatherName) {
            window.AppState.operator.fatherName = parsed.fatherName;
            changed = true;
          }
          if ((!window.AppState.operator.firstName || !window.AppState.operator.lastName) && (parsed.firstName || parsed.lastName)) {
            window.AppState.operator.firstName = window.AppState.operator.firstName || parsed.firstName;
            window.AppState.operator.lastName = window.AppState.operator.lastName || parsed.lastName;
            changed = true;
          }
          if (changed) {
            localStorage.setItem('automation_operator_profile', JSON.stringify(window.AppState.operator));
          }
        }
      }
    }
  } catch (e) {
    console.error('Error loading operator profile', e);
  }
  updateOperatorSummaryUI();
}

function updateOperatorSummaryUI() {
  const container = document.getElementById('operatorSummaryContainer');
  const alertBox = document.getElementById('operatorMissingAlert');
  const op = window.AppState.operator;

  if (op && op.firstName && op.lastName && op.personnelId) {
    if (alertBox) alertBox.classList.add('hidden');
    if (container) {
      container.classList.remove('hidden');
      const fnEl = document.getElementById('opFullName');
      if (fnEl) fnEl.textContent = `${op.firstName} ${op.lastName}`;
      const pidEl = document.getElementById('opPersonnelId');
      if (pidEl) pidEl.textContent = op.personnelId;
      const unitEl = document.getElementById('opUnit');
      if (unitEl) unitEl.textContent = op.unit || '---';
      const supEl = document.getElementById('opSupervision');
      if (supEl) supEl.textContent = op.supervision || '---';
      const roleEl = document.getElementById('opRole');
      if (roleEl) roleEl.textContent = op.role || '---';
      const fathEl = document.getElementById('opFatherName');
      if (fathEl) fathEl.textContent = op.fatherName || '---';
    }
  } else {
    if (alertBox) alertBox.classList.remove('hidden');
    if (container) container.classList.add('hidden');
  }
}

function saveOperatorProfile(e) {
  e.preventDefault();
  let firstName = document.getElementById('modalFirstName')?.value.trim() || '';
  let lastName = document.getElementById('modalLastName')?.value.trim() || '';
  let fatherName = document.getElementById('modalFatherName')?.value.trim() || '';
  let personnelId = document.getElementById('modalPersonnelId')?.value.trim() || '';
  const supervision = document.getElementById('modalSupervision')?.value.trim() || '';
  const unit = document.getElementById('modalUnit')?.value.trim() || '';
  const role = document.getElementById('modalRole')?.value.trim() || '';

  // اگر شماره پرسنلی وارد شده اما فیلدهای نام، نام خانوادگی یا نام پدر هنوز خالی مانده باشند، استخراج خودکار انجام شود
  if (personnelId && (!firstName || !lastName || !fatherName)) {
    const match = findPersonnelByCode(personnelId);
    if (match) {
      const parsed = parsePersonnelFullName(match.name);
      if (!firstName) firstName = parsed.firstName;
      if (!lastName) lastName = parsed.lastName;
      if (!fatherName) fatherName = parsed.fatherName;
      const fnInput = document.getElementById('modalFirstName');
      const lnInput = document.getElementById('modalLastName');
      const fathInput = document.getElementById('modalFatherName');
      if (fnInput) fnInput.value = firstName;
      if (lnInput) lnInput.value = lastName;
      if (fathInput) fathInput.value = fatherName;
    }
  }

  if (!personnelId) {
    showToast('لطفاً شماره پرسنلی مجری را وارد نمایید', 'error');
    document.getElementById('modalPersonnelId')?.focus();
    return;
  }

  if (!firstName || !lastName) {
    showToast('لطفاً نام و نام خانوادگی را وارد نمایید (یا شماره پرسنلی صحیح وارد فرمایید تا خودکار تکمیل شود)', 'error');
    document.getElementById('modalFirstName')?.focus();
    return;
  }

  if (!supervision) {
    showToast('لطفاً سرپرستی مربوطه را انتخاب فرمایید', 'error');
    document.getElementById('modalSupervision')?.focus();
    return;
  }

  if (!unit) {
    showToast('لطفاً واحد خدمتی مربوطه را انتخاب فرمایید', 'error');
    document.getElementById('modalUnit')?.focus();
    return;
  }

  const cleanPid = toEnglishDigits(personnelId).replace(/\D/g, '') || personnelId;
  const profile = { 
    firstName, 
    lastName, 
    fatherName, 
    personnelId: cleanPid, 
    supervision, 
    unit, 
    role 
  };
  localStorage.setItem('automation_operator_profile', JSON.stringify(profile));
  window.AppState.operator = profile;
  updateOperatorSummaryUI();
  populateAsettDatalist();
  const currentAsett = document.getElementById('asettInput')?.value.trim();
  if (currentAsett) {
    syncRebuildablesForAsett(currentAsett);
  }
  closeModal('personnelModal');
  showToast(`مشخصات مجری (${firstName} ${lastName}${fatherName ? ` فرزند ${fatherName}` : ''}) با موفقیت ثبت شد`, 'success');
}

// ==========================================
// ۴. منطق فیلدهای شرطی نوار کشویی (Select) و افزودن فعالیت (دکمه ADD)
// ==========================================
function handleActivityChange() {
  const select = document.getElementById('activityTypeSelect');
  const val = select ? select.value : '';

  const equipIdGroup = document.getElementById('equipIdGroup');
  const settingsGroup = document.getElementById('settingsGroup');
  const footageGroup = document.getElementById('footageGroup');
  const customGroup = document.getElementById('customActivityGroup');

  if (equipIdGroup) equipIdGroup.classList.add('hidden');
  if (settingsGroup) settingsGroup.classList.add('hidden');
  if (footageGroup) footageGroup.classList.add('hidden');
  if (customGroup) customGroup.classList.add('hidden');

  const equipInput = document.getElementById('equipmentIdInput');
  const deviceTag = document.getElementById('deviceTagInput');
  const refTool = document.getElementById('referenceToolInput');
  const footage = document.getElementById('footageInput');
  const customInput = document.getElementById('customActivityInput');

  if (equipInput) equipInput.required = false;
  if (deviceTag) deviceTag.required = false;
  if (refTool) refTool.required = false;
  if (footage) footage.required = false;
  if (customInput) customInput.required = false;

  if (val === 'مونتاژ تجهیزات' || val === 'دمونتاژ تجهیزات') {
    // طبق درخواست کاربر فیلد شماره شناسایی تجهیز برای این فعالیت‌ها حذف گردید
    if (equipIdGroup) equipIdGroup.classList.add('hidden');
    if (equipInput) equipInput.required = false;
  } else if (val === 'انجام تنظیمات حرفه‌ای' || val === 'انجام تنظیمات و فعالیت‌های حرفه‌ای' || val === 'انجام فعالیت‌های حرفه‌ای') {
    if (settingsGroup) {
      settingsGroup.classList.remove('hidden');
      if (refTool) refTool.required = true;
    }
  } else if (val === 'انجام کابل‌کشی' || val === 'انجام کاندوئیت‌کاری') {
    if (footageGroup) {
      footageGroup.classList.remove('hidden');
      if (footage) footage.required = true;
    }
  } else if (val === 'سایر فعالیت‌ها') {
    if (customGroup) {
      customGroup.classList.remove('hidden');
      if (customInput) {
        customInput.required = true;
        customInput.focus();
      }
    }
  }
}

function addSelectedActivity() {
  // ۱. اعتبارسنجی قطعی: بدون تعیین قطعه قابل بازسازی (Rebuildable ID) نباید بتوان فعالیت اضافه کرد
  const rebuildableVal = getSelectedRebuildableValue();
  if (!rebuildableVal) {
    showToast('⚠️ بدون مشخص بودن قطعه قابل بازسازی (Rebuildable ID)، امکان افزودن فعالیت وجود ندارد. لطفاً ابتدا در کادر بالا قطعه را انتخاب یا ثبت فرمایید.', 'error');
    const sel = document.getElementById('rebuildableSelect');
    if (sel && !sel.disabled) {
      sel.focus();
      sel.classList.add('ring-2', 'ring-rose-500', 'border-rose-500');
      setTimeout(() => sel.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500'), 2500);
    } else {
      const asettInp = document.getElementById('asettInput');
      if (asettInp) {
        asettInp.focus();
        asettInp.classList.add('ring-2', 'ring-rose-500', 'border-rose-500');
        setTimeout(() => asettInp.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500'), 2500);
      }
    }
    return;
  }

  const select = document.getElementById('activityTypeSelect');
  let val = select ? select.value.trim() : '';

  if (val === 'سایر فعالیت‌ها') {
    const customInput = document.getElementById('customActivityInput');
    const customVal = customInput ? customInput.value.trim() : '';
    if (!customVal) {
      showToast('لطفاً عنوان فعالیت سفارشی را وارد نمایید', 'error');
      if (customInput) customInput.focus();
      return;
    }
    val = customVal;
  }

  if (!val) {
    showToast('لطفاً ابتدا نوع فعالیت را از لیست انتخاب فرمایید', 'warning');
    if (select) select.focus();
    return;
  }

  const conditionalFields = {};

  if (val === 'مونتاژ تجهیزات' || val === 'دمونتاژ تجهیزات') {
    // طبق درخواست کاربر فیلد شماره شناسایی تجهیز حذف گردید
  } else if (val === 'انجام تنظیمات حرفه‌ای' || val === 'انجام تنظیمات و فعالیت‌های حرفه‌ای' || val === 'انجام فعالیت‌های حرفه‌ای') {
    const refTool = document.getElementById('referenceToolInput')?.value.trim();
    if (!refTool) {
      showToast('لطفاً شماره مرجع (لپ‌تاپ، هارت، کالیبراتور) را وارد فرمایید', 'error');
      document.getElementById('referenceToolInput')?.focus();
      return;
    }
    conditionalFields.referenceTool = refTool;
  } else if (val === 'انجام کابل‌کشی' || val === 'انجام کاندوئیت‌کاری') {
    const footageVal = document.getElementById('footageInput')?.value.trim();
    if (!footageVal) {
      showToast('لطفاً متراژ را وارد فرمایید', 'error');
      document.getElementById('footageInput')?.focus();
      return;
    }
    conditionalFields.footage = footageVal;
  }

  if (!window.AppState.addedActivities) {
    window.AppState.addedActivities = [];
  }

  // بررسی تکراری نبودن دقیق با در نظر گرفتن نوع و قطعه بازسازی
  const isDuplicate = window.AppState.addedActivities.some(
    (a) => a.type === val && a.rebuildable === rebuildableVal && JSON.stringify(a.conditionalFields) === JSON.stringify(conditionalFields)
  );
  if (isDuplicate) {
    showToast('این فعالیت با همین مشخصات و قطعه قبلاً اضافه شده است', 'warning');
    return;
  }

  const activityItem = {
    id: Date.now() + Math.random().toString(36).substring(2, 6),
    type: val,
    rebuildable: rebuildableVal,
    asett: document.getElementById('asettInput')?.value.trim() || '',
    conditionalFields
  };

  window.AppState.addedActivities.push(activityItem);

  // پاکسازی ورودی‌های فیلدهای شرطی برای فعالیت بعدی
  if (select) select.value = '';
  const customInput = document.getElementById('customActivityInput');
  if (customInput) customInput.value = '';
  const equipInput = document.getElementById('equipmentIdInput');
  if (equipInput) equipInput.value = '';
  const devTagInput = document.getElementById('deviceTagInput');
  if (devTagInput) devTagInput.value = '';
  const refToolInput = document.getElementById('referenceToolInput');
  if (refToolInput) refToolInput.value = '';
  const footageInput = document.getElementById('footageInput');
  if (footageInput) footageInput.value = '';

  handleActivityChange();
  renderAddedActivitiesList();
  showToast(`فعالیت «${val}» برای قطعه «${rebuildableVal}» با موفقیت افزوده شد.`, 'success');
}

function removeAddedActivity(id) {
  if (!window.AppState.addedActivities) return;
  window.AppState.addedActivities = window.AppState.addedActivities.filter((a) => a.id !== id);
  renderAddedActivitiesList();
  showToast('فعالیت مورد نظر حذف شد', 'info');
}

function renderAddedActivitiesList() {
  const container = document.getElementById('addedActivitiesContainer');
  const countBadge = document.getElementById('activitiesCountText');
  if (!container) return;

  const activities = window.AppState.addedActivities || [];

  if (countBadge) {
    countBadge.textContent = `${activities.length} مورد`;
  }

  if (activities.length === 0) {
    container.innerHTML = `
      <div id="emptyActivitiesNotice" class="text-xs text-slate-400 py-3 px-3 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-700/80">
        فعالیتی به این گراف اضافه نشده است. پس از انتخاب اقدام از نوار بالا، دکمه <strong class="text-amber-400 font-bold">«افزودن فعالیت (ADD)»</strong> را بزنید.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  activities.forEach((act, index) => {
    let detailPills = '';
    if (act.conditionalFields) {
      if (act.conditionalFields.footage) {
        detailPills += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-950/70 border border-emerald-600/50 text-[11px] font-bold text-emerald-300">متراژ: ${act.conditionalFields.footage} متر</span>`;
      }
      if (act.conditionalFields.equipmentId) {
        detailPills += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-950/70 border border-amber-600/50 text-[11px] font-bold text-amber-300 font-mono">تجهیز: ${act.conditionalFields.equipmentId}</span>`;
      }
      if (act.conditionalFields.deviceTag) {
        detailPills += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-950/70 border border-blue-600/50 text-[11px] font-bold text-blue-300 font-mono">تگ: ${act.conditionalFields.deviceTag}</span>`;
      }
      if (act.conditionalFields.referenceTool) {
        detailPills += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-950/70 border border-blue-600/50 text-[11px] font-bold text-blue-300 font-mono">مرجع: ${act.conditionalFields.referenceTool}</span>`;
      }
    }

    const itemEl = document.createElement('div');
    itemEl.className = 'flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950/90 border border-slate-700/90 shadow-sm hover:border-slate-600 transition';
    const rebuildableBadge = act.rebuildable
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-500/50 text-[11px] font-bold text-cyan-300">
          <svg class="w-3 h-3 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <span>قطعه: ${escapeHtml(act.rebuildable)}</span>
        </span>`
      : '';

    itemEl.innerHTML = `
      <div class="flex items-center gap-2.5 overflow-hidden">
        <span class="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-amber-500/30">
          ${index + 1}
        </span>
        <div class="flex flex-wrap items-center gap-1.5 overflow-hidden">
          <span class="text-xs sm:text-sm font-bold text-slate-100">${escapeHtml(act.type)}</span>
          ${rebuildableBadge}
          ${detailPills}
        </div>
      </div>
      <button type="button" onclick="removeAddedActivity('${act.id}')" class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition shrink-0" title="حذف این فعالیت">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    `;
    container.appendChild(itemEl);
  });
}

// انتشار سراسری در آبجکت window جهت اطمینان از دسترس‌پذیری در رویدادهای inline HTML
window.handleActivityChange = handleActivityChange;
window.addSelectedActivity = addSelectedActivity;
window.removeAddedActivity = removeAddedActivity;
window.renderAddedActivitiesList = renderAddedActivitiesList;

// ==========================================
// ۵. مدیریت همکاران همراه (Dynamic Colleagues) با جستجو در بانک پرسنل اکسل
// ==========================================
function parsePersonnelFullName(rawName) {
  if (!rawName) return { firstName: '', lastName: '', fatherName: '', fullName: '' };

  let cleanName = String(rawName).replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();

  // تفکیک بر اساس کاما فارسی (،) یا کاما انگلیسی (,)
  const parts = cleanName.split(/[,،]+/).map(p => p.trim()).filter(Boolean);

  if (parts.length >= 3) {
    // قالب استاندارد دیتابیس پرسنل:
    // بخش اول: نام خانوادگی
    // بخش دوم: نام
    // بخش سوم: نام پدر
    // مثال دقیق دیتابیس: «ابوالقاسمی، احسان، حسین» => نام خانوادگی: ابوالقاسمی | نام: احسان | نام پدر: حسین
    const lastName = parts[0];
    const firstName = parts[1];
    const fatherName = parts.slice(2).join(' ');
    return {
      lastName,
      firstName,
      fatherName,
      fullName: `${firstName} ${lastName}`
    };
  } else if (parts.length === 2) {
    // در صورت وجود ۲ بخش: اول نام خانوادگی، دوم نام
    const lastName = parts[0];
    const firstName = parts[1];
    return {
      lastName,
      firstName,
      fatherName: '',
      fullName: `${firstName} ${lastName}`
    };
  } else {
    // در صورتی که کاما وجود نداشته باشد
    const words = cleanName.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return {
        firstName: words[0],
        lastName: words.slice(1).join(' '),
        fatherName: '',
        fullName: cleanName
      };
    }
    return {
      firstName: cleanName,
      lastName: '',
      fatherName: '',
      fullName: cleanName
    };
  }
}

function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim();
}

window.toEnglishDigits = toEnglishDigits;

// مپ جامع پرسنل با تضمین دسترسی فوق‌سریع و بدون وقفه به کل ۷۵۲۷ رکورد
const masterPersonnelMap = new Map();

function indexPersonnelRecords(records) {
  if (!records || !Array.isArray(records)) return;
  for (let i = 0; i < records.length; i++) {
    const p = records[i];
    if (!p || !p.code) continue;
    const clean = toEnglishDigits(p.code);
    if (!clean) continue;
    masterPersonnelMap.set(clean, p);
    const unpadded = clean.replace(/^0+/, '');
    if (unpadded) masterPersonnelMap.set(unpadded, p);
    const padded = clean.padStart(7, '0');
    masterPersonnelMap.set(padded, p);
    if (window.AppState && window.AppState.personnelMap) {
      window.AppState.personnelMap.set(clean, p);
      if (unpadded) window.AppState.personnelMap.set(unpadded, p);
      window.AppState.personnelMap.set(padded, p);
    }
  }
}

// ایندکس‌گذاری آنی در لحظه فراخوانی اسکریپت
if (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA)) {
  indexPersonnelRecords(window.INITIAL_PERSONNEL_DATA);
}

function findPersonnelByCode(rawCode) {
  if (!rawCode) return null;
  const rawStr = String(rawCode).trim();
  const digitsOnly = toEnglishDigits(rawStr).replace(/\D/g, '');
  if (!digitsOnly) return null;

  const clean = digitsOnly;
  const padded = clean.padStart(7, '0');
  const unpadded = clean.replace(/^0+/, '');

  // ۱. جستجو در مپ جامع حافظه
  if (masterPersonnelMap.has(clean)) return masterPersonnelMap.get(clean);
  if (masterPersonnelMap.has(padded)) return masterPersonnelMap.get(padded);
  if (unpadded && masterPersonnelMap.has(unpadded)) return masterPersonnelMap.get(unpadded);

  if (window.AppState && window.AppState.personnelMap) {
    if (window.AppState.personnelMap.has(clean)) return window.AppState.personnelMap.get(clean);
    if (window.AppState.personnelMap.has(padded)) return window.AppState.personnelMap.get(padded);
    if (unpadded && window.AppState.personnelMap.has(unpadded)) return window.AppState.personnelMap.get(unpadded);
  }

  // ۲. جستجو در لیست‌های کامل پرسنل
  const masterList = (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA))
    ? window.INITIAL_PERSONNEL_DATA
    : [];
  const appList = (window.AppState && Array.isArray(window.AppState.personnel)) ? window.AppState.personnel : [];
  const list = masterList.length >= appList.length ? masterList : appList;

  if (list && list.length > 0) {
    const match = list.find((p) => {
      if (!p || !p.code) return false;
      const c = toEnglishDigits(p.code);
      const cPadded = c.padStart(7, '0');
      const cUnpadded = c.replace(/^0+/, '');
      return c === clean || c === padded || cUnpadded === unpadded || cPadded === padded;
    });
    if (match) {
      masterPersonnelMap.set(clean, match);
      masterPersonnelMap.set(padded, match);
      if (unpadded) masterPersonnelMap.set(unpadded, match);
      return match;
    }
  }

  return null;
}

function populatePersonnelDatalist() {
  const datalist = document.getElementById('personnelDatalist');
  if (!datalist) return;
  if (datalist.children.length > 0) return;

  const list = (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA) && window.INITIAL_PERSONNEL_DATA.length > 0)
    ? window.INITIAL_PERSONNEL_DATA
    : (window.AppState.personnel || []);

  if (!list || list.length === 0) return;

  const seenCodes = new Set();
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p && p.code) {
      const cleanCode = toEnglishDigits(p.code).trim();
      if (seenCodes.has(cleanCode)) continue;
      seenCodes.add(cleanCode);

      const opt = document.createElement('option');
      const parsed = parsePersonnelFullName(p.name);
      opt.value = `${p.code} - ${parsed.lastName}، ${parsed.firstName}${parsed.fatherName ? ` (${parsed.fatherName})` : ''}`;
      fragment.appendChild(opt);
    }
  }
  datalist.appendChild(fragment);
}

function handleModalPersonnelInput(val) {
  const badge = document.getElementById('modalPersonnelMatchBadge');
  const fnInput = document.getElementById('modalFirstName');
  const lnInput = document.getElementById('modalLastName');
  const fatherInput = document.getElementById('modalFatherName');
  const badgeFirst = document.getElementById('autoFilledBadgeFirst');
  const badgeLast = document.getElementById('autoFilledBadgeLast');
  const badgeFather = document.getElementById('autoFilledBadgeFather');

  const raw = (val || '').trim();
  if (!raw) {
    if (badge) badge.innerHTML = '<span class="text-slate-400 text-[11px]">با وارد کردن شماره پرسنلی یا انتخاب از لیست، نام، نام خانوادگی و نام پدر به صورت خودکار تکمیل می‌شود.</span>';
    if (badgeFirst) badgeFirst.classList.add('hidden');
    if (badgeLast) badgeLast.classList.add('hidden');
    if (badgeFather) badgeFather.classList.add('hidden');
    return;
  }

  // ۱. اگر کاربر گزینه‌ای از دیتالیست انتخاب کرده باشد (مثلاً "0452891 - ابوالقاسمی، احسان (حسین)")
  let codeQuery = raw;
  if (raw.includes(' - ')) {
    codeQuery = raw.split(' - ')[0].trim();
    const pidInput = document.getElementById('modalPersonnelId');
    if (pidInput && pidInput.value !== codeQuery) pidInput.value = codeQuery;
  }

  // ۲. جستجو در دیتابیس پرسنل بر اساس شماره پرسنلی
  let match = findPersonnelByCode(codeQuery);

  // ۳. در صورتی که کاربر به صورت متنی نام جستجو کرده باشد (و نه شماره پرسنلی)
  if (!match) {
    const hasDigits = /[0-9۰-۹٠-٩]/.test(raw);
    if (!hasDigits) {
      const list = (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA) && window.INITIAL_PERSONNEL_DATA.length > 0)
        ? window.INITIAL_PERSONNEL_DATA
        : (window.AppState.personnel || []);
      const norm = normalizeSearchText(raw);
      if (norm.length >= 3 && list.length > 0) {
        match = list.find(p => p && normalizeSearchText(p.name).includes(norm));
      }
    }
  }

  if (match) {
    const parsed = parsePersonnelFullName(match.name);
    if (fnInput) {
      fnInput.value = parsed.firstName;
      fnInput.dispatchEvent(new Event('input', { bubbles: true }));
      fnInput.classList.add('border-emerald-500', 'bg-emerald-950/20');
      setTimeout(() => fnInput.classList.remove('border-emerald-500', 'bg-emerald-950/20'), 1500);
    }
    if (lnInput) {
      lnInput.value = parsed.lastName;
      lnInput.dispatchEvent(new Event('input', { bubbles: true }));
      lnInput.classList.add('border-emerald-500', 'bg-emerald-950/20');
      setTimeout(() => lnInput.classList.remove('border-emerald-500', 'bg-emerald-950/20'), 1500);
    }
    if (fatherInput) {
      fatherInput.value = parsed.fatherName || '';
      fatherInput.dispatchEvent(new Event('input', { bubbles: true }));
      fatherInput.classList.add('border-emerald-500', 'bg-emerald-950/20');
      setTimeout(() => fatherInput.classList.remove('border-emerald-500', 'bg-emerald-950/20'), 1500);
    }
    if (badgeFirst) badgeFirst.classList.remove('hidden');
    if (badgeLast) badgeLast.classList.remove('hidden');
    if (badgeFather) badgeFather.classList.remove('hidden');

    if (badge) {
      badge.innerHTML = `
        <span class="inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-950/70 border border-emerald-700/60 px-2.5 py-1 rounded-lg text-xs">
          <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          <span>پرسنل شناسایی شد: <strong>${escapeHtml(parsed.firstName)} ${escapeHtml(parsed.lastName)}</strong> ${parsed.fatherName ? `(نام پدر: <strong>${escapeHtml(parsed.fatherName)}</strong>)` : ''} [کد: ${escapeHtml(match.code)}]</span>
        </span>
      `;
    }
  } else {
    if (badgeFirst) badgeFirst.classList.add('hidden');
    if (badgeLast) badgeLast.classList.add('hidden');
    if (badgeFather) badgeFather.classList.add('hidden');
    const isDigits = /[0-9۰-۹٠-٩]/.test(raw);
    if (badge) {
      if (isDigits && raw.length >= 4) {
        badge.innerHTML = `
          <span class="inline-flex items-center gap-1 text-amber-400 text-[11px] bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/60">
            <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <span>شماره پرسنلی در بانک اطلاعات یافت نشد (می‌توانید نام، نام خانوادگی و نام پدر را دستی وارد فرمایید).</span>
          </span>
        `;
      } else {
        badge.innerHTML = '<span class="text-slate-400 text-[11px]">با وارد کردن شماره پرسنلی، نام و نام خانوادگی و نام پدر خودکار تکمیل می‌شود.</span>';
      }
    }
  }
}

window.masterPersonnelMap = masterPersonnelMap;
window.indexPersonnelRecords = indexPersonnelRecords;
window.parsePersonnelFullName = parsePersonnelFullName;
window.populatePersonnelDatalist = populatePersonnelDatalist;
window.handleModalPersonnelInput = handleModalPersonnelInput;
window.executeModalPersonnelInput = handleModalPersonnelInput;

function handleColleagueInput(val) {
  const preview = document.getElementById('colleagueMatchPreview');
  if (!preview) return;
  const clean = (val || '').trim();
  if (!clean) {
    preview.innerHTML = '';
    return;
  }

  const match = findPersonnelByCode(clean);
  if (match) {
    preview.innerHTML = `<span class="inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-lg"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>پرسنل شناسایی شد: <strong>${escapeHtml(match.name)}</strong> (کد: ${escapeHtml(match.code)})</span></span>`;
  } else {
    preview.innerHTML = `<span class="text-slate-400 text-[11px]">شماره در بانک پرسنل یافت نشد (در صورت فشردن «افزودن»، با همین شماره ثبت می‌شود).</span>`;
  }
}

function addColleague() {
  const input = document.getElementById('colleaguePersonnelInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToast('لطفاً شماره پرسنلی همکار را وارد کنید', 'error');
    return;
  }

  const match = findPersonnelByCode(val);
  const code = match ? match.code : val;
  const name = match ? match.name : 'نامشخص';

  // بررسی تکراری بودن بر اساس شماره پرسنلی
  const isDuplicate = window.AppState.colleagues.some((c) => {
    const cCode = typeof c === 'object' && c !== null ? c.code : c;
    return String(cCode).trim() === String(code).trim();
  });

  if (isDuplicate) {
    showToast('این شماره پرسنلی قبلاً به لیست همکاران افزوده شده است', 'warning');
    return;
  }

  window.AppState.colleagues.push({ code, name });
  input.value = '';
  const preview = document.getElementById('colleagueMatchPreview');
  if (preview) preview.innerHTML = '';
  renderColleaguesList();
  showToast(`همکار «${name}» (شماره پرسنلی: ${code}) افزوده شد`, 'success');
}

function removeColleague(code) {
  window.AppState.colleagues = window.AppState.colleagues.filter((c) => {
    const cCode = typeof c === 'object' && c !== null ? c.code : c;
    return String(cCode) !== String(code);
  });
  renderColleaguesList();
}

function renderColleaguesList() {
  const container = document.getElementById('colleaguesListContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!window.AppState.colleagues || window.AppState.colleagues.length === 0) {
    container.innerHTML = '<span class="text-xs text-slate-400">همکاری ثبت نشده است.</span>';
    return;
  }

  window.AppState.colleagues.forEach((item) => {
    const code = typeof item === 'object' && item !== null ? item.code : item;
    const name = typeof item === 'object' && item !== null ? item.name : '';

    const badge = document.createElement('div');
    badge.className = 'inline-flex items-center gap-2 bg-slate-800/90 border border-slate-700 hover:border-amber-500/50 text-slate-100 px-3 py-1.5 rounded-xl text-xs shadow transition';
    badge.innerHTML = `
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]"></span>
        ${name && name !== 'نامشخص' ? `<span class="font-bold text-amber-300 font-sans">${escapeHtml(name)}</span>` : ''}
        <span class="font-mono text-slate-300 text-[11px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">${escapeHtml(code)}</span>
      </div>
      <button type="button" onclick="removeColleague('${escapeHtml(code)}')" class="text-slate-400 hover:text-red-400 transition p-0.5 mr-0.5" title="حذف همکار">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    `;
    container.appendChild(badge);
  });
}

// تنظیم و ایندکس‌گذاری ساختار پرسنل در حافظه
function initPersonnelState(records) {
  if (!records || !Array.isArray(records)) return;
  window.AppState.personnel = records;
  if (!window.AppState.personnelMap) {
    window.AppState.personnelMap = new Map();
  }
  indexPersonnelRecords(records);

  const totalBadge = document.getElementById('personnelTotalBadge');
  if (totalBadge) {
    totalBadge.textContent = `${records.length.toLocaleString('fa-IR')} پرسنل`;
  }
}

// مقداردهی اولیه همگام و آنی در بدو اجرای فایل بدون هیچ‌گونه تاخیر یا پیش‌شرط
if (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA) && window.INITIAL_PERSONNEL_DATA.length > 0) {
  initPersonnelState(window.INITIAL_PERSONNEL_DATA);
}

// بارگذاری بانک اطلاعات پرسنل (از IndexedDB یا فایل پرسنل اولیه اکسل)
async function loadPersonnelData() {
  try {
    const masterList = (typeof window !== 'undefined' && window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA))
      ? window.INITIAL_PERSONNEL_DATA
      : [];

    if (masterList.length > 0) {
      initPersonnelState(masterList);
    }

    let records = [];
    try {
      records = await getAllPersonnelFromDB();
    } catch (dbErr) {
      console.warn('Could not read from IndexedDB personnel store:', dbErr);
    }

    // اگر دیتابیس لوکال خالی است یا رکوردهای کمتری نسبت به فایل اکسل کامل (۷۵۲۷ رکورد) دارد، بروزرسانی شود
    if (!records || records.length < masterList.length) {
      if (masterList.length > 0) {
        records = masterList;
        saveMultiplePersonnelToDB(records).catch((e) => console.warn('Background save to DB error:', e));
      } else {
        try {
          const res = await fetch('/personnel-data.json');
          if (res.ok) {
            records = await res.json();
            if (records && records.length > 0) {
              saveMultiplePersonnelToDB(records).catch((e) => console.warn('Background save to DB error:', e));
            }
          }
        } catch (fetchErr) {
          console.warn('Fetch personnel-data.json failed:', fetchErr);
        }
      }
    }

    if (records && records.length > 0) {
      initPersonnelState(records);
    }

    // در صورتی که جدول پرسنل در DOM فعال باشد، به‌روزرسانی شود
    const tbody = document.getElementById('personnelTableBody');
    if (tbody) {
      renderPersonnelTable();
    }
  } catch (err) {
    console.error('Error loading personnel data:', err);
  }
}

// ==========================================
// ۶. دریافت و ثبت خودکار موقعیت مکانی (GPS) با بروزرسانی هر ۱۰ ثانیه
// ==========================================
let gpsAutoUpdateInterval = null;
let gpsWatchId = null;

function applyGpsPosition(position) {
  if (!position || !position.coords) return;
  const lat = position.coords.latitude.toFixed(6);
  const lng = position.coords.longitude.toFixed(6);
  const accuracy = Math.round(position.coords.accuracy);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  window.AppState.currentLocation = { 
    lat, 
    lng, 
    accuracy, 
    timestamp: now.toISOString(),
    updatedAt: timeStr 
  };

  const statusEl = document.getElementById('gpsStatusText');
  const coordsEl = document.getElementById('gpsCoordsText');
  const indicator = document.getElementById('gpsIndicator');
  const mapBtn = document.getElementById('viewOnMapBtn');

  if (statusEl) {
    statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-emerald-300 font-bold">موقعیت خودکار قفل شد</span> • ساعت <span class="font-mono">${timeStr}</span> (دقت: ±${accuracy} متر)`;
  }
  if (coordsEl) {
    coordsEl.textContent = `عرض: ${lat} | طول: ${lng}`;
  }
  if (indicator) {
    indicator.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]';
  }
  if (mapBtn) {
    mapBtn.classList.remove('hidden');
    mapBtn.onclick = () => window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
  }
}

function updateGPSLocation(isManual = false) {
  const statusEl = document.getElementById('gpsStatusText');
  const indicator = document.getElementById('gpsIndicator');

  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = 'دستگاه شما از GPS پشتیبانی نمی‌کند';
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-red-500';
    return;
  }

  if (isManual && !window.AppState.currentLocation?.lat) {
    if (statusEl) statusEl.textContent = 'در حال دریافت خودکار مختصات دقیق...';
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      applyGpsPosition(position);
    },
    (err) => {
      console.warn('Geolocation update note:', err);
      if (!window.AppState.currentLocation?.lat) {
        if (statusEl) statusEl.textContent = 'در حال مکان‌یابی خودکار ماهواره‌ای (دستور دسترسی مکان را در مرورگر تأیید نمایید)...';
        if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
      }
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 4000 }
  );
}

function startAutoGPS() {
  // ۱. دریافت بلافاصله در ابتدای باز شدن برنامه
  updateGPSLocation(true);

  // ۲. گوش‌به‌زنگ بودن سنسور GPS دستگاه برای دریافت فوری کوچک‌ترین جابجایی
  if (navigator.geolocation && navigator.geolocation.watchPosition) {
    try {
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
      }
      gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => applyGpsPosition(pos),
        (err) => console.warn('GPS watchPosition note:', err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    } catch (e) {
      console.warn('GPS watch error:', e);
    }
  }

  // ۳. حلقه منظم بروزرسانی خودکار هر ۱۰ ثانیه (دقیقاً بر اساس درخواست کاربر)
  if (gpsAutoUpdateInterval) {
    clearInterval(gpsAutoUpdateInterval);
  }
  gpsAutoUpdateInterval = setInterval(() => {
    updateGPSLocation(false);
  }, 10000);
}

// ==========================================
// ۷. مدیریت دوربین و عکس‌برداری صنعتی (پشتیبانی از چندین عکس همزمان)
// ==========================================
function setupCameraInput() {
  const fileInput = document.getElementById('cameraFileInput');
  if (!fileInput) return;

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (!window.AppState.capturedImages) {
      window.AppState.capturedImages = [];
    }

    showToast(`در حال پردازش و برچسب‌گذاری ${files.length} تصویر...`, 'info');

    for (const file of files) {
      try {
        const dataUrl = await processAndWatermarkImage(file);
        window.AppState.capturedImages.push(dataUrl);
      } catch (err) {
        console.error('Error processing photo:', err);
      }
    }

    if (window.AppState.capturedImages.length > 0) {
      window.AppState.capturedImageBase64 = window.AppState.capturedImages[0];
    }

    fileInput.value = ''; // ریست برای امکان انتخاب/ثبت عکس‌های بیشتر
    renderImagePreview();
    showToast(`تعداد کل عکس‌های الحاق‌شده: ${window.AppState.capturedImages.length} تصویر`, 'success');
  });
}

function processAndWatermarkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round(height * (MAX_WIDTH / width));
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round(width * (MAX_HEIGHT / height));
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // درج نوار رسمی و مُهر تاریخ و زمان شمسی
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, height - 42, width, 42);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 16px Vazirmatn, Tahoma, sans-serif';
        ctx.direction = 'rtl';
        const jalali = getFormattedJalali();
        const stampText = `مدیریت اتوماسیون و ارتباطات | ${jalali.fullPersian}`;
        ctx.fillText(stampText, width - 20, height - 15);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  const galleryContainer = document.getElementById('photosGalleryContainer');
  const photosGrid = document.getElementById('photosGrid');
  const uploadPlaceholder = document.getElementById('cameraUploadPlaceholder');
  const countBadge = document.getElementById('photosCountBadge');

  const previewContainer = document.getElementById('cameraPreviewContainer');
  const previewImg = document.getElementById('cameraPreviewImg');

  const images = window.AppState.capturedImages || [];
  if (images.length === 0 && window.AppState.capturedImageBase64) {
    images.push(window.AppState.capturedImageBase64);
    window.AppState.capturedImages = images;
  }

  if (countBadge) {
    if (images.length > 0) {
      countBadge.textContent = `${images.length} تصویر الحاق‌شده`;
      countBadge.classList.remove('hidden');
    } else {
      countBadge.classList.add('hidden');
    }
  }

  if (images.length > 0) {
    if (galleryContainer) galleryContainer.classList.remove('hidden');
    if (uploadPlaceholder) uploadPlaceholder.classList.add('hidden');

    if (photosGrid) {
      photosGrid.innerHTML = '';
      images.forEach((dataUrl, idx) => {
        const photoCard = document.createElement('div');
        photoCard.className = 'group relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 shadow-md hover:border-amber-500/80 transition aspect-square';
        photoCard.innerHTML = `
          <img src="${dataUrl}" alt="عکس ${idx + 1}" class="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition duration-300" onclick="openPhotoViewerModal('${idx}')">
          <div class="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition pointer-events-none flex items-center justify-center">
            <span class="p-2 bg-slate-900/80 rounded-full text-amber-400 shadow">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            </span>
          </div>
          <div class="absolute top-2 right-2">
            <span class="px-2 py-0.5 rounded-md bg-slate-900/85 backdrop-blur-sm text-[10px] font-mono font-bold text-amber-300 border border-slate-700/80 shadow">
              #${idx + 1}
            </span>
          </div>
          <div class="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between items-center">
            <button type="button" onclick="openPhotoViewerModal('${idx}')" class="px-2 py-0.5 bg-slate-900/85 hover:bg-slate-800 text-[11px] font-bold text-slate-200 rounded-md border border-slate-700 transition" title="بزرگ‌نمایی">
              مشاهده
            </button>
            <button type="button" onclick="removeSinglePhoto(${idx})" class="p-1 bg-red-950/90 hover:bg-red-900 text-red-300 rounded-md border border-red-800 transition" title="حذف این عکس">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        `;
        photosGrid.appendChild(photoCard);
      });
    }

    // سازگاری با عناصر قدیمی
    if (previewContainer) previewContainer.classList.remove('hidden');
    if (previewImg) previewImg.src = images[0];
  } else {
    if (galleryContainer) galleryContainer.classList.add('hidden');
    if (uploadPlaceholder) uploadPlaceholder.classList.remove('hidden');
    if (photosGrid) photosGrid.innerHTML = '';
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewImg) previewImg.src = '';
  }
}

function removeSinglePhoto(index) {
  if (!window.AppState.capturedImages) return;
  window.AppState.capturedImages.splice(index, 1);
  window.AppState.capturedImageBase64 = window.AppState.capturedImages.length > 0 ? window.AppState.capturedImages[0] : null;
  renderImagePreview();
  showToast('عکس مورد نظر حذف شد', 'info');
}

function removeAllCapturedPhotos() {
  window.AppState.capturedImages = [];
  window.AppState.capturedImageBase64 = null;
  const fileInput = document.getElementById('cameraFileInput');
  if (fileInput) fileInput.value = '';
  renderImagePreview();
  showToast('تمام عکس‌های الحاق‌شده حذف شدند', 'info');
}

function removeCapturedImage() {
  removeAllCapturedPhotos();
}

function openPhotoViewerModal(target) {
  let src = '';
  let indexStr = '';
  if (typeof target === 'number' || (!isNaN(target) && typeof target === 'string' && !target.startsWith('data:'))) {
    const idx = parseInt(target, 10);
    const images = window.AppState.capturedImages || [];
    src = images[idx] || '';
    indexStr = `تصویر شماره ${idx + 1} از ${images.length}`;
  } else {
    src = target;
    indexStr = 'تصویر تجهیز و محیط کار';
  }

  const modal = document.getElementById('photoViewerModal');
  const img = document.getElementById('photoViewerImg');
  const info = document.getElementById('photoViewerInfo');

  if (modal && img && src) {
    img.src = src;
    if (info) info.textContent = indexStr;
    modal.classList.remove('hidden');
  }
}

function closePhotoViewerModal() {
  const modal = document.getElementById('photoViewerModal');
  const img = document.getElementById('photoViewerImg');
  if (modal) modal.classList.add('hidden');
  if (img) img.src = '';
}

// انتشار سراسری توابع مدیریت عکس‌ها در window
window.renderImagePreview = renderImagePreview;
window.removeSinglePhoto = removeSinglePhoto;
window.removeAllCapturedPhotos = removeAllCapturedPhotos;
window.removeCapturedImage = removeCapturedImage;
window.openPhotoViewerModal = openPhotoViewerModal;
window.closePhotoViewerModal = closePhotoViewerModal;

// ==========================================
// ۸. اسکن بارکد و QR Code
// ==========================================
function openQrScannerModal(targetFieldId) {
  window.AppState.selectedQrTargetField = targetFieldId || 'asettInput';
  const modal = document.getElementById('qrScannerModal');
  const title = document.getElementById('qrModalTitle');
  if (title) {
    title.textContent = 'اسکن بارکد / QR کد تجهیز (ASETT ID)';
  }
  if (modal) modal.classList.remove('hidden');
  startQrVideoScan();
}

function closeQrScannerModal() {
  stopQrVideoScan();
  const modal = document.getElementById('qrScannerModal');
  if (modal) modal.classList.add('hidden');
  window.AppState.selectedQrTargetField = null;
}

async function startQrVideoScan() {
  const video = document.getElementById('qrVideo');
  const status = document.getElementById('qrScannerStatus');
  if (!video) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    window.AppState.activeCameraStream = stream;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    if (status) status.textContent = 'دوربین فعال است؛ لطفاً بارکد را مقابل کادر نگاه دارید...';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let isBarcodeDetectorSupported = 'BarcodeDetector' in window;
    let detector = null;
    if (isBarcodeDetectorSupported) {
      try {
        detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] });
      } catch (e) {
        detector = null;
      }
    }

    let isScanning = true;
    const scanLoop = async () => {
      if (!window.AppState.activeCameraStream || !isScanning) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // ۱. تلاش با BarcodeDetector محلی
        if (detector) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              isScanning = false;
              handleQrCodeDetected(barcodes[0].rawValue);
              return;
            }
          } catch (e) {}
        }

        // ۲. اسکن با موتور فوق‌سریع jsQR
        if (window.jsQR && isScanning) {
          try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qrResult = window.jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'attemptBoth'
            });
            if (qrResult && qrResult.data) {
              isScanning = false;
              handleQrCodeDetected(qrResult.data);
              return;
            }
          } catch (err) {}
        }
      }

      requestAnimationFrame(scanLoop);
    };

    requestAnimationFrame(scanLoop);
  } catch (err) {
    console.warn('Camera stream error:', err);
    if (status) status.textContent = 'امکان دسترسی به دوربین وجود ندارد. لطفاً مجوز دسترسی به دوربین را در مرورگر تایید کنید.';
  }
}

function stopQrVideoScan() {
  if (window.AppState.activeCameraStream) {
    window.AppState.activeCameraStream.getTracks().forEach((t) => t.stop());
    window.AppState.activeCameraStream = null;
  }
}

function handleQrCodeDetected(code) {
  if (navigator.vibrate) navigator.vibrate(120);
  const targetId = window.AppState.selectedQrTargetField || 'asettInput';
  const targetInput = document.getElementById(targetId);
  if (targetInput) {
    targetInput.value = code;
    targetInput.classList.add('ring-2', 'ring-amber-400');
    setTimeout(() => targetInput.classList.remove('ring-2', 'ring-amber-400'), 1500);

    const clearBtn = document.getElementById('clearAsettBtn');
    if (clearBtn) clearBtn.classList.remove('hidden');

    if (targetId === 'asettInput') {
      syncRebuildablesForAsett(code);
    }
  }
  showToast(`بارکد تجهیز با موفقیت اسکن شد: ${code}`, 'success');
  closeQrScannerModal();
}

function clearQrField(targetFieldId) {
  const targetInput = document.getElementById(targetFieldId);
  if (targetInput) {
    targetInput.value = '';
  }
  const clearBtn = document.getElementById('clearAsettBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  if (targetFieldId === 'asettInput') {
    syncRebuildablesForAsett('');
  }
  showToast('کد اسکن‌شده پاکسازی شد', 'info');
}

function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/۰/g, '0').replace(/۱/g, '1').replace(/۲/g, '2').replace(/۳/g, '3').replace(/۴/g, '4')
    .replace(/۵/g, '5').replace(/۶/g, '6').replace(/۷/g, '7').replace(/۸/g, '8').replace(/۹/g, '9')
    .replace(/[\s\-_/\\,،.]+/g, ' ');
}

function handleAsettInput(inputEl) {
  const clearBtn = document.getElementById('clearAsettBtn');
  const val = inputEl ? inputEl.value.trim() : '';
  if (clearBtn) {
    if (val.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
  if (window._asettDebounceTimer) clearTimeout(window._asettDebounceTimer);
  window._asettDebounceTimer = setTimeout(() => {
    syncRebuildablesForAsett(val);
  }, 40);
}

// ==========================================
// ۸.۱. منطق فرم کشویی قطعه قابل بازسازی (Rebuildable ID) و اتصال به دیتابیس ASETT
// ==========================================
async function getOrFetchAllAssetRebuildables() {
  if (window.AppState.assetRecords && window.AppState.assetRecords.length > 0) {
    return window.AppState.assetRecords;
  }
  try {
    let records = await getAllAssetRebuildableRecordsFromDB();
    const defaultRebuildables = [
      'کارت پردازنده اصلی CPU 414-4H',
      'ماژول ورودی/خروجی آنالوگ AI 8x13Bit',
      'پوزیشنر هوشمند Fisher DVC6200',
      'اکچویتور پنوماتیک دیافراگمی 657',
      'فرستنده-گیرنده UHF تله‌متری',
      'پاور ماژولار ریداندنت 12V 450W'
    ];
    if (records && records.length > 0) {
      const hasDefaults = records.some(r => defaultRebuildables.includes((r.rebuildable || '').trim()));
      if (hasDefaults) {
        records = records.filter(r => !defaultRebuildables.includes((r.rebuildable || '').trim()));
        localStorage.setItem('automation_asset_rebuildables', JSON.stringify(records));
      }
    }
    window.AppState.assetRecords = records || [];
    return window.AppState.assetRecords;
  } catch (err) {
    console.warn('getOrFetchAllAssetRebuildables fallback:', err);
    return [];
  }
}

async function populateAsettDatalist() {
  try {
    const datalist = document.getElementById('asettDatalist');
    if (!datalist) return;
    const records = await getOrFetchAllAssetRebuildables();
    const op = window.AppState.operator;
    const opSupervision = (op?.supervision || '').trim();
    const opUnit = (op?.unit || '').trim();

    let filteredRecords = records;
    if (opSupervision || opUnit) {
      const unitScoped = records.filter(r => {
        let match = true;
        if (opSupervision && r.supervision && normalizeSearchText(r.supervision) !== normalizeSearchText(opSupervision)) {
          match = false;
        }
        if (opUnit && r.unit && normalizeSearchText(r.unit) !== normalizeSearchText(opUnit)) {
          match = false;
        }
        return match;
      });
      if (unitScoped.length > 0) {
        filteredRecords = unitScoped;
      }
    }

    const uniqueAssets = Array.from(new Set(filteredRecords.map(r => (r.asset || '').trim()).filter(Boolean)));
    datalist.innerHTML = uniqueAssets.map(a => `<option value="${escapeHtml(a)}"></option>`).join('');
  } catch (err) {
    console.warn('populateAsettDatalist error:', err);
  }
}

async function syncRebuildablesForAsett(asettVal) {
  try {
    const inputEl = document.getElementById('asettInput');
    const rawVal = asettVal !== undefined ? asettVal : (inputEl ? inputEl.value : '');
    const asett = (rawVal || '').trim();

    const select = document.getElementById('rebuildableSelect');
    const badge = document.getElementById('rebuildableStatusBadge');
    const feedback = document.getElementById('asettFeedback');
    const detailBox = document.getElementById('rebuildableDetailBox');
    const customBox = document.getElementById('customRebuildableBox');
    const clearBtn = document.getElementById('clearRebuildableSelectBtn');

    if (detailBox) detailBox.classList.add('hidden');
    if (customBox) customBox.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');

    if (!select) return;

    if (!asett) {
      select.innerHTML = '<option value=""></option>';
      select.disabled = true;
      if (badge) {
        badge.className = 'text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700';
        badge.textContent = 'منتظر ورود ASETT ID';
      }
      if (feedback) {
        feedback.innerHTML = `
          <svg class="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>با ثبت یا اسکن ASETT ID، فقط قطعات قابل بازسازی (Rebuildable) مربوط به همان سرپرستی و واحد از دیتابیس بارگذاری و انتخاب می‌شوند.</span>
        `;
      }
      return;
    }

    const records = await getOrFetchAllAssetRebuildables();
    const cleanQuery = normalizeSearchText(asett);
    const queryTokens = cleanQuery.split(' ').filter(t => t.length >= 2);

    // ۱. بررسی مشخصات سرپرستی و واحد مجری عملیات (در صورت ثبت مشخصات)
    const op = window.AppState.operator;
    const opSupervision = (op?.supervision || '').trim();
    const opUnit = (op?.unit || '').trim();

    // ۲. تطبیق رکورد تجهیز (ASETT) از دیتابیس
    let assetMatches = records.filter(r => normalizeSearchText(r.asset) === cleanQuery);

    if (assetMatches.length === 0) {
      assetMatches = records.filter(r => {
        const norm = normalizeSearchText(r.asset);
        return norm.includes(cleanQuery) || cleanQuery.includes(norm);
      });
    }

    if (assetMatches.length === 0 && queryTokens.length > 0) {
      assetMatches = records.filter(r => {
        const norm = normalizeSearchText(r.asset);
        return queryTokens.some(tok => norm.includes(tok));
      });
    }

    if (assetMatches.length === 0) {
      assetMatches = records.filter(r => {
        const normRebuild = normalizeSearchText(r.rebuildable);
        return normRebuild.includes(cleanQuery) || String(r.id) === cleanQuery;
      });
    }

    // ۳. تعیین دقیق سرپرستی و واحد مرجع:
    // اولویت با سرپرستی و واحد اپراتور جاری است؛ در غیر اینصورت از سرپرستی و واحد تجهیز تطبیق داده شده استفاده می‌شود
    const targetSupervision = opSupervision || (assetMatches.length > 0 ? (assetMatches[0].supervision || '').trim() : '');
    const targetUnit = opUnit || (assetMatches.length > 0 ? (assetMatches[0].unit || '').trim() : '');

    // ۴. اعمال فیلتر قطعی بر روی قطعات قابل بازسازی: فقط رکوردهای متعلق به همان سرپرستی و واحد
    let scopedMatches = assetMatches;
    if (targetSupervision) {
      const normTargetSup = normalizeSearchText(targetSupervision);
      scopedMatches = scopedMatches.filter(r => !r.supervision || normalizeSearchText(r.supervision) === normTargetSup);
    }
    if (targetUnit) {
      const normTargetUnit = normalizeSearchText(targetUnit);
      scopedMatches = scopedMatches.filter(r => !r.unit || normalizeSearchText(r.unit) === normTargetUnit);
    }

    select.disabled = false;

    if (scopedMatches.length > 0) {
      let optionsHtml = '';
      scopedMatches.forEach((m, idx) => {
        const desc = m.description || '';
        const unitLabel = [m.supervision, m.unit].filter(Boolean).join(' - ');
        const label = m.rebuildable;
        optionsHtml += `<option value="${escapeHtml(m.rebuildable)}" data-desc="${escapeHtml(desc)}" data-unit="${escapeHtml(unitLabel)}" data-idx="${idx}">${escapeHtml(label)}</option>`;
      });
      optionsHtml += '<option value="__custom__">➕ ثبت قطعه بازسازی دیگر برای این واحد (دستی)...</option>';
      select.innerHTML = optionsHtml;

      // انتخاب و نمایش آنی اولین قطعه بازسازی منطبق در فیلد کشویی و نمایش اطلاعات فنی
      select.selectedIndex = 0;
      handleRebuildableSelectChange(select);

      const scopeInfoText = [targetSupervision, targetUnit].filter(Boolean).join(' / ');
      if (badge) {
        badge.className = 'text-[10px] text-emerald-300 font-bold bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30';
        badge.textContent = `✓ ${scopedMatches.length} قطعه بازسازی [${scopeInfoText || 'اختصاصی'}] انتخاب گردید`;
      }
      if (feedback) {
        feedback.innerHTML = `
          <svg class="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          <span class="text-emerald-400 font-bold">برای تجهیز «${escapeHtml(asett)}»، فقط قطعات مربوط به سرپرستی و واحد «${escapeHtml(scopeInfoText)}» بارگذاری شدند (${scopedMatches.length} قطعه مجاز).</span>
        `;
      }
    } else if (assetMatches.length > 0) {
      // تجهیز در دیتابیس وجود دارد اما قطعات آن مربوط به سرپرستی یا واحد دیگری است
      const assetSup = assetMatches[0].supervision || 'نامشخص';
      const assetUnit = assetMatches[0].unit || 'نامشخص';
      const desiredScope = [targetSupervision, targetUnit].filter(Boolean).join(' - ');

      let optionsHtml = `<option value="">-- برای واحد «${escapeHtml(desiredScope)}» قطعه‌ای در این تجهیز تعریف نشده است --</option>`;
      optionsHtml += '<option value="__custom__">➕ ثبت قطعه بازسازی جدید برای واحد شما (دستی)...</option>';
      select.innerHTML = optionsHtml;

      if (badge) {
        badge.className = 'text-[10px] text-amber-300 font-bold bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30';
        badge.textContent = 'عدم تطابق واحد با تجهیز';
      }
      if (feedback) {
        feedback.innerHTML = `
          <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span class="text-amber-300">تجهیز «${escapeHtml(asett)}» در دیتابیس متعلق به «${escapeHtml(assetSup)} - ${escapeHtml(assetUnit)}» است. برای واحد «${escapeHtml(desiredScope)}» قطعه‌ای ثبت نشده است؛ می‌توانید قطعه جدید ثبت فرمایید.</span>
        `;
      }
    } else {
      // تجهیز جدید است: فقط قطعات همان سرپرستی و واحد از سایر تجهیزات پیشنهاد داده شوند
      let sameScopeRecords = records;
      if (targetSupervision) {
        const normTargetSup = normalizeSearchText(targetSupervision);
        sameScopeRecords = sameScopeRecords.filter(r => !r.supervision || normalizeSearchText(r.supervision) === normTargetSup);
      }
      if (targetUnit) {
        const normTargetUnit = normalizeSearchText(targetUnit);
        sameScopeRecords = sameScopeRecords.filter(r => !r.unit || normalizeSearchText(r.unit) === normTargetUnit);
      }

      const uniqueScopeRebuildables = Array.from(new Set(sameScopeRecords.map(r => (r.rebuildable || '').trim()).filter(Boolean)));

      let optionsHtml = '<option value="">-- لطفاً قطعه بازسازی را انتخاب یا دستی وارد نمایید --</option>';
      if (uniqueScopeRebuildables.length > 0) {
        const scopeTitle = [targetSupervision, targetUnit].filter(Boolean).join(' - ') || 'سامانه';
        optionsHtml += `<optgroup label="قطعات بازسازی مربوط به ${escapeHtml(scopeTitle)}">`;
        uniqueScopeRebuildables.forEach(r => {
          optionsHtml += `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`;
        });
        optionsHtml += '</optgroup>';
      }
      optionsHtml += '<option value="__custom__">➕ ثبت دستی عنوان قطعه جدید...</option>';
      select.innerHTML = optionsHtml;

      const scopeInfoText = [targetSupervision, targetUnit].filter(Boolean).join(' / ');
      if (badge) {
        badge.className = 'text-[10px] text-amber-300 font-bold bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30';
        badge.textContent = `فیلتر سرپرستی و واحد [${scopeInfoText || 'کلی'}]`;
      }
      if (feedback) {
        feedback.innerHTML = `
          <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span class="text-amber-300">برای تجهیز «${escapeHtml(asett)}» قطعه ثبت‌شده‌ای یافت نشد؛ منوی کشویی به قطعات واحد «${escapeHtml(scopeInfoText || 'مجاز')}» محدود گردید.</span>
        `;
      }
    }
  } catch (err) {
    console.warn('syncRebuildablesForAsett error:', err);
  }
}

function handleRebuildableSelectChange(selectEl) {
  const val = selectEl ? selectEl.value : '';
  const detailBox = document.getElementById('rebuildableDetailBox');
  const customBox = document.getElementById('customRebuildableBox');
  const clearBtn = document.getElementById('clearRebuildableSelectBtn');

  if (clearBtn) {
    if (val) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }

  if (val === '__custom__') {
    if (detailBox) detailBox.classList.add('hidden');
    if (customBox) {
      customBox.classList.remove('hidden');
      const inp = document.getElementById('customRebuildableInput');
      if (inp) {
        inp.focus();
      }
    }
    return;
  }

  if (customBox) customBox.classList.add('hidden');

  if (!val) {
    if (detailBox) detailBox.classList.add('hidden');
    return;
  }

  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const desc = selectedOpt ? selectedOpt.getAttribute('data-desc') : '';
  const unit = selectedOpt ? selectedOpt.getAttribute('data-unit') : '';

  if (detailBox) {
    const titleEl = document.getElementById('rebuildableDetailTitle');
    const unitEl = document.getElementById('rebuildableDetailUnit');
    const descEl = document.getElementById('rebuildableDetailDesc');

    if (titleEl) titleEl.textContent = `قطعه انتخابی: ${val}`;
    if (unitEl) unitEl.textContent = unit ? `سازمان: ${unit}` : '';
    if (descEl) {
      if (desc && desc.trim()) {
        descEl.textContent = `توضیحات: ${desc}`;
        descEl.classList.remove('hidden');
      } else {
        descEl.textContent = '';
        descEl.classList.add('hidden');
      }
    }
    detailBox.classList.remove('hidden');
  }
}

function clearRebuildableSelection() {
  const select = document.getElementById('rebuildableSelect');
  if (select) {
    select.value = '';
    handleRebuildableSelectChange(select);
  }
  const customInput = document.getElementById('customRebuildableInput');
  if (customInput) customInput.value = '';
}

function getSelectedRebuildableValue() {
  const select = document.getElementById('rebuildableSelect');
  if (!select) return '';
  const val = select.value.trim();
  if (val === '__custom__') {
    return document.getElementById('customRebuildableInput')?.value.trim() || '';
  }
  return val;
}

function resetRebuildableSelect() {
  const select = document.getElementById('rebuildableSelect');
  if (select) {
    select.value = '';
    select.innerHTML = '<option value=""></option>';
    select.disabled = true;
  }
  const badge = document.getElementById('rebuildableStatusBadge');
  if (badge) {
    badge.className = 'text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700';
    badge.textContent = 'منتظر ورود ASETT ID';
  }
  const feedback = document.getElementById('asettFeedback');
  if (feedback) {
    feedback.innerHTML = `
      <svg class="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>با ثبت یا اسکن ASETT ID، قطعات قابل بازسازی (Rebuildable) به صورت خودکار از دیتابیس در بخش فعالیت‌ها بارگذاری می‌شوند.</span>
    `;
  }
  const detailBox = document.getElementById('rebuildableDetailBox');
  if (detailBox) detailBox.classList.add('hidden');
  const customBox = document.getElementById('customRebuildableBox');
  if (customBox) customBox.classList.add('hidden');
  const customInput = document.getElementById('customRebuildableInput');
  if (customInput) customInput.value = '';
  const clearBtn = document.getElementById('clearRebuildableSelectBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
}

// ==========================================
// ۹. ثبت و ذخیره‌سازی گراف در IndexedDB
// ==========================================
async function handleGraphFormSubmit(e) {
  e.preventDefault();

  if (!window.AppState.operator || !window.AppState.operator.personnelId) {
    showToast('لطفاً ابتدا مشخصات شخص (مجری) را ثبت نمایید', 'error');
    openModal('personnelModal');
    return;
  }

  const asett = document.getElementById('asettInput').value.trim();
  const rebuildable = getSelectedRebuildableValue();
  const reportNotes = document.getElementById('reportNotesInput').value.trim();

  if (!rebuildable) {
    showToast('⚠️ ثبت گزارش بدون قطعه قابل بازسازی (Rebuildable ID) امکان‌پذیر نیست. لطفاً قطعه را انتخاب یا وارد فرمایید.', 'error');
    const select = document.getElementById('rebuildableSelect');
    if (select && !select.disabled) {
      select.focus();
    } else {
      document.getElementById('asettInput')?.focus();
    }
    return;
  }
  
  // بررسی فعالیت‌های ثبت شده
  let activities = (window.AppState.addedActivities && window.AppState.addedActivities.length > 0)
    ? [...window.AppState.addedActivities]
    : [];

  const activitySelectVal = document.getElementById('activityTypeSelect')?.value.trim();

  // اگر هنوز در لیست خالی است اما در نوار کشویی مقداری انتخاب شده، خودکار ارزیابی و اضافه شود
  if (activities.length === 0) {
    if (activitySelectVal) {
      addSelectedActivity();
      activities = (window.AppState.addedActivities && window.AppState.addedActivities.length > 0)
        ? [...window.AppState.addedActivities]
        : [];
    }
  }

  if (activities.length === 0) {
    showToast('لطفاً نوع فعالیت انجام شده را انتخاب و با دکمه ADD اضافه فرمایید', 'error');
    document.getElementById('activityTypeSelect')?.focus();
    return;
  }

  const primaryActivity = activities[0];
  const activityTypeSummary = activities.map((a) => a.type).join(' | ');

  // تصاویر ثبت شده (پشتیبانی از چند عکس)
  const photos = (window.AppState.capturedImages && window.AppState.capturedImages.length > 0)
    ? [...window.AppState.capturedImages]
    : (window.AppState.capturedImageBase64 ? [window.AppState.capturedImageBase64] : []);
  const primaryPhoto = photos.length > 0 ? photos[0] : null;

  const isOnline = navigator.onLine;
  const now = new Date();
  const jalali = getFormattedJalali(now);

  const graphRecord = {
    timestamp: now.getTime(),
    jalaliDate: jalali.dateNumStr,
    jalaliTime: jalali.timeStr,
    jalaliFull: jalali.fullPersian,
    operator: { ...window.AppState.operator },
    asett,
    rebuildable,
    photo: primaryPhoto,
    photos: photos,
    reportNotes: reportNotes || '', // توضیحات تکمیلی اختیاری است
    activityType: activityTypeSummary,
    activities: activities,
    conditionalFields: primaryActivity.conditionalFields || {},
    colleagues: [...window.AppState.colleagues],
    location: { ...window.AppState.currentLocation },
    syncStatus: isOnline ? 'synced' : 'pending',
    syncedAt: isOnline ? now.toISOString() : null
  };

  try {
    const id = await saveGraphRecord(graphRecord);
    showToast(
      isOnline
        ? `فعالیت شماره #${id} با موفقیت ثبت و همگام‌سازی شد.`
        : `فعالیت شماره #${id} به دلیل آفلاین بودن در حافظه ذخیره و در صف انتظار قرار گرفت.`,
      isOnline ? 'success' : 'warning'
    );

    resetGraphForm();
    updatePendingQueueCount();
  } catch (err) {
    console.error('Error saving record', err);
    showToast('خطا در ذخیره‌سازی رکورد در دیتابیس محلی', 'error');
  }
}

function resetGraphForm() {
  document.getElementById('asettInput').value = '';
  const clearAsett = document.getElementById('clearAsettBtn');
  if (clearAsett) clearAsett.classList.add('hidden');
  resetRebuildableSelect();
  document.getElementById('reportNotesInput').value = '';
  document.getElementById('activityTypeSelect').value = '';
  const customInput = document.getElementById('customActivityInput');
  if (customInput) customInput.value = '';
  document.getElementById('equipmentIdInput').value = '';
  document.getElementById('deviceTagInput').value = '';
  document.getElementById('referenceToolInput').value = '';
  document.getElementById('footageInput').value = '';
  handleActivityChange();

  window.AppState.addedActivities = [];
  renderAddedActivitiesList();

  window.AppState.capturedImages = [];
  window.AppState.capturedImageBase64 = null;
  const fileInput = document.getElementById('cameraFileInput');
  if (fileInput) fileInput.value = '';
  renderImagePreview();

  window.AppState.colleagues = [];
  renderColleaguesList();

  updateLiveClock();
}

// ==========================================
// ۱۰. مدیریت وضعیت آنلاین / آفلاین و همگام‌سازی
// ==========================================
function updateNetworkStatusIndicator() {
  const isOnline = navigator.onLine;
  const badge = document.getElementById('networkStatusBadge');
  const dot = document.getElementById('networkStatusDot');
  const text = document.getElementById('networkStatusText');

  if (isOnline) {
    if (badge) badge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/70 border border-emerald-500/50 text-emerald-300';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    if (text) text.textContent = 'آنلاین';
  } else {
    if (badge) badge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-950/70 border border-amber-500/50 text-amber-300';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    if (text) text.textContent = 'آفلاین (محلی)';
  }
}

async function updatePendingQueueCount() {
  try {
    const records = await getAllGraphRecords();
    const pendingList = records.filter((r) => r.syncStatus === 'pending');
    const count = pendingList.length;

    const countEl = document.getElementById('pendingQueueCount');
    const badgeEl = document.getElementById('pendingQueueBadge');

    if (countEl) countEl.textContent = count;
    if (badgeEl) {
      if (count > 0) {
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  } catch (e) {
    console.error('Queue count check error', e);
  }
}

async function syncPendingRecords() {
  if (!navigator.onLine) {
    showToast('در حال حاضر دسترسی به اینترنت مقدور نیست.', 'warning');
    return;
  }

  try {
    const records = await getAllGraphRecords();
    const pendingList = records.filter((r) => r.syncStatus === 'pending');

    if (pendingList.length === 0) {
      showToast('تمام گراف‌ها همگام‌سازی شده‌اند و صفی وجود ندارد.', 'info');
      return;
    }

    showToast(`در حال همگام‌سازی ${pendingList.length} رکورد با سرور...`, 'info');

    for (const rec of pendingList) {
      rec.syncStatus = 'synced';
      rec.syncedAt = new Date().toISOString();
      await updateGraphRecord(rec);
    }

    await updatePendingQueueCount();
    showToast(`همگام‌سازی موفق: تمام ${pendingList.length} رکورد ارسال شدند.`, 'success');
    if (window.AppState.currentView === 'admin') {
      loadAdminReports();
    }
  } catch (e) {
    console.error('Sync failed', e);
    showToast('خطا در همگام‌سازی رکوردها', 'error');
  }
}

window.addEventListener('online', () => {
  updateNetworkStatusIndicator();
  showToast('اتصال به اینترنت برقرار شد. در حال همگام‌سازی داده‌های صف...', 'info');
  syncPendingRecords();
});

window.addEventListener('offline', () => {
  updateNetworkStatusIndicator();
  showToast('ارتباط با شبکه قطع شد. سیستم در حالت آفلاین فعال است.', 'warning');
});

// ==========================================
// ۱۱. ساعت و تاریخ زنده
// ==========================================
function updateLiveClock() {
  const clockEl = document.getElementById('liveJalaliDateText');
  if (clockEl) {
    const jalali = getFormattedJalali();
    clockEl.textContent = jalali.fullPersian;
  }
}

// ==========================================
// ۱۲. احراز هویت و ورود به پنل ادمین
// ==========================================
const SUPER_ADMIN = {
  username: 'admin',
  password: 'Ehsan2559',
  fullName: 'احسان ابوالقاسمی (مدیر نرم افزار )',
  isSuperAdmin: true,
  unit: 'کل واحدها',
  supervision: 'کل سرپرستی‌ها'
};

function isMasterAdmin(user) {
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  if (!user) {
    try {
      const stored = sessionStorage.getItem('automation_admin_session');
      if (stored) user = JSON.parse(stored);
    } catch (e) {}
  }
  if (!user) return true; // دسترسی پیش‌فرض در صورت عدم تعیین کاربر
  return user.username === 'admin' || user.isSuperAdmin === true;
}

function canAccessOrgManage(user) {
  if (isMasterAdmin(user)) return true;
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  return !!(user && user.permissions && user.permissions.orgManage);
}

function canAccessAdminManage(user) {
  if (isMasterAdmin(user)) return true;
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  return !!(user && user.permissions && user.permissions.adminManage);
}

function canAccessBackup(user) {
  if (isMasterAdmin(user)) return true;
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  return !!(user && user.permissions && user.permissions.backup);
}

function canAccessPersonnelManage(user) {
  if (isMasterAdmin(user)) return true;
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  return !!(user && user.permissions && user.permissions.personnelManage);
}

function canAccessAssetRebuildable(user) {
  if (isMasterAdmin(user)) return true;
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  return user && user.permissions ? user.permissions.assetRebuildable !== false : true;
}

window.isMasterAdmin = isMasterAdmin;
window.canAccessOrgManage = canAccessOrgManage;
window.canAccessAdminManage = canAccessAdminManage;
window.canAccessBackup = canAccessBackup;
window.canAccessPersonnelManage = canAccessPersonnelManage;
window.canAccessAssetRebuildable = canAccessAssetRebuildable;

function checkAdminAuthSession() {
  const stored = sessionStorage.getItem('automation_admin_session');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && (parsed.username === 'admin' || parsed.isSuperAdmin)) {
        window.AppState.currentUser = SUPER_ADMIN;
      } else {
        window.AppState.currentUser = parsed;
      }
      return true;
    } catch (e) {
      sessionStorage.removeItem('automation_admin_session');
    }
  }
  return false;
}

// ==========================================
// بنر ۳ ثانیه‌ای ورود به صفحه مدیران با تیتر اختصاصی
// ==========================================
let adminWelcomeBannerTimer = null;
let adminWelcomeBannerInterval = null;

function showAdminWelcomeBanner(displayName) {
  const banner = document.getElementById('adminWelcomeBanner');
  const titleEl = document.getElementById('adminWelcomeBannerTitle');
  const progressBar = document.getElementById('adminWelcomeBannerProgressBar');
  const countdownEl = document.getElementById('adminWelcomeBannerCountdown');

  if (!banner || !titleEl) return;

  if (adminWelcomeBannerTimer) {
    clearTimeout(adminWelcomeBannerTimer);
    adminWelcomeBannerTimer = null;
  }
  if (adminWelcomeBannerInterval) {
    clearInterval(adminWelcomeBannerInterval);
    adminWelcomeBannerInterval = null;
  }

  // تیتر دقیقاً مطابق با متن درخواستی کاربر:
  // "{نام کاربر} عزیز به سیستم ثبت گراف مدیریت اتوماسیون و ارتباطات خوش آمدید"
  titleEl.textContent = `${displayName} عزیز به سیستم ثبت گراف مدیریت اتوماسیون و ارتباطات خوش آمدید`;

  // بازنشانی وضعیت اولیه نوار و شمارنده
  if (countdownEl) countdownEl.textContent = '۳ ثانیه';
  if (progressBar) {
    progressBar.style.transition = 'none';
    progressBar.style.width = '100%';
  }

  banner.classList.remove('hidden');
  banner.classList.remove('translate-y-0', 'opacity-100');
  banner.classList.add('-translate-y-2', 'opacity-0');

  // اجرای انیمیشن ورود و نوار پیشرفت
  setTimeout(() => {
    banner.classList.remove('-translate-y-2', 'opacity-0');
    banner.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
      if (progressBar) {
        progressBar.style.transition = 'width 3000ms linear';
        progressBar.style.width = '0%';
      }
    }, 40);
  }, 20);

  let remaining = 3;
  adminWelcomeBannerInterval = setInterval(() => {
    remaining--;
    if (countdownEl) {
      if (remaining > 0) {
        countdownEl.textContent = `${remaining} ثانیه`;
      } else {
        countdownEl.textContent = '۰ ثانیه';
      }
    }
  }, 1000);

  // بسته شدن خودکار بنر دقیقاً پس از ۳ ثانیه (۳۰۰۰ میلی‌ثانیه)
  adminWelcomeBannerTimer = setTimeout(() => {
    closeAdminWelcomeBanner();
  }, 3000);
}

function closeAdminWelcomeBanner() {
  const banner = document.getElementById('adminWelcomeBanner');
  if (adminWelcomeBannerTimer) {
    clearTimeout(adminWelcomeBannerTimer);
    adminWelcomeBannerTimer = null;
  }
  if (adminWelcomeBannerInterval) {
    clearInterval(adminWelcomeBannerInterval);
    adminWelcomeBannerInterval = null;
  }
  if (!banner) return;

  banner.classList.remove('translate-y-0', 'opacity-100');
  banner.classList.add('-translate-y-2', 'opacity-0');
  setTimeout(() => {
    banner.classList.add('hidden');
  }, 500);
}
window.closeAdminWelcomeBanner = closeAdminWelcomeBanner;
window.showAdminWelcomeBanner = showAdminWelcomeBanner;

// اسلاید ۳ ثانیه‌ای ورود مدیران (نگهداری برای سازگاری کامل)
function showAdminWelcomeSlide(displayName, callback) {
  const modal = document.getElementById('adminWelcomeSlideModal');
  const messageEl = document.getElementById('adminWelcomeMessageText');
  const progressBar = document.getElementById('adminWelcomeProgressBar');
  const countdownEl = document.getElementById('adminWelcomeCountdown');

  if (!modal || !messageEl) {
    if (typeof callback === 'function') callback();
    return;
  }

  // پیام اختصاصی دقیق طبق درخواست کاربر
  messageEl.textContent = `${displayName} عزیز به سیستم ثبت گراف مدیریت اتوماسیون و ارتباطات خوش آمدید`;

  if (progressBar) {
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
  }
  if (countdownEl) {
    countdownEl.textContent = '۳ ثانیه';
  }

  modal.classList.remove('hidden');
  modal.classList.remove('opacity-0');

  setTimeout(() => {
    if (progressBar) {
      progressBar.style.transition = 'width 3000ms linear';
      progressBar.style.width = '100%';
    }
  }, 40);

  let secondsLeft = 3;
  const interval = setInterval(() => {
    secondsLeft--;
    if (countdownEl && secondsLeft > 0) {
      countdownEl.textContent = `${secondsLeft} ثانیه`;
    }
  }, 1000);

  setTimeout(() => {
    clearInterval(interval);
    modal.classList.add('opacity-0');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('opacity-0');
      if (typeof callback === 'function') callback();
    }, 300);
  }, 3000);
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const user = document.getElementById('loginUsername').value.trim();
  const pass = document.getElementById('loginPassword').value.trim();

  if (user.toLowerCase() === 'admin' && (pass === 'Ehsan2559' || pass.toLowerCase() === 'ehsan2559')) {
    window.AppState.currentUser = SUPER_ADMIN;
    sessionStorage.setItem('automation_admin_session', JSON.stringify(SUPER_ADMIN));
    closeModal('loginModal');
    const form = document.getElementById('adminLoginForm');
    if (form) form.reset();

    const displayName = 'احسان ابوالقاسمی (مدیر نرم افزار )';
    // انتقال به صفحه مدیر و نمایش بنر ۳ ثانیه‌ای با تیتر اختصاصی
    switchToAdminView();
    showAdminWelcomeBanner(displayName);
    return;
  }

  try {
    const admins = await getAdminsList();
    const match = admins.find((a) => a.username === user && a.password === pass);
    if (match) {
      window.AppState.currentUser = match;
      sessionStorage.setItem('automation_admin_session', JSON.stringify(match));
      closeModal('loginModal');
      const form = document.getElementById('adminLoginForm');
      if (form) form.reset();

      const displayName = match.fullName || match.username;
      // انتقال به صفحه مدیر و نمایش بنر ۳ ثانیه‌ای با تیتر اختصاصی
      switchToAdminView();
      showAdminWelcomeBanner(displayName);
      return;
    }
  } catch (err) {
    console.error('Login check error', err);
  }

  showToast('نام کاربری یا رمز عبور اشتباه است', 'error');
}

function handleAdminLogout() {
  window.AppState.currentUser = null;
  sessionStorage.removeItem('automation_admin_session');
  showToast('با موفقیت از سیستم خارج شدید', 'info');
  switchToHomeView();
}

function openAdminAccess() {
  if (checkAdminAuthSession()) {
    switchToAdminView();
  } else {
    openModal('loginModal');
  }
}

// ==========================================
// ۱۳. پنل ادمین: سوئیچ نماها
// ==========================================
function switchToHomeView() {
  window.AppState.currentView = 'home';
  document.getElementById('homeViewSection').classList.remove('hidden');
  document.getElementById('adminViewSection').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchToAdminView() {
  window.AppState.currentView = 'admin';
  document.getElementById('homeViewSection').classList.add('hidden');
  document.getElementById('adminViewSection').classList.remove('hidden');

  const user = window.AppState.currentUser;
  renderAdminUserHeaderInfo(user);

  // تنها کاربر admin و مدیرانی که در زمان تعریف مجوز ماژول‌ها را دریافت کرده‌اند به این تب‌ها دسترسی دارند
  const canOrg = canAccessOrgManage(user);
  const canAdmin = canAccessAdminManage(user);
  const canBackup = canAccessBackup(user);
  const canPersonnel = canAccessPersonnelManage(user);
  const canAsset = canAccessAssetRebuildable(user);

  const adminManageTab = document.getElementById('tabBtnAdminManage');
  const orgManageTab = document.getElementById('tabBtnOrgManage');
  const backupTab = document.getElementById('tabBtnBackup');
  const personnelTab = document.getElementById('tabBtnPersonnelManage');
  const assetRebuildableTab = document.getElementById('tabBtnAssetRebuildable');

  if (adminManageTab) {
    if (canAdmin) adminManageTab.classList.remove('hidden');
    else adminManageTab.classList.add('hidden');
  }
  if (orgManageTab) {
    if (canOrg) orgManageTab.classList.remove('hidden');
    else orgManageTab.classList.add('hidden');
  }
  if (backupTab) {
    if (canBackup) backupTab.classList.remove('hidden');
    else backupTab.classList.add('hidden');
  }
  if (personnelTab) {
    if (canPersonnel) personnelTab.classList.remove('hidden');
    else personnelTab.classList.add('hidden');
  }
  if (assetRebuildableTab) {
    if (canAsset) assetRebuildableTab.classList.remove('hidden');
    else assetRebuildableTab.classList.add('hidden');
  }

  showAdminTab('reports');
  updateAdminFilterDropdowns();
  loadAdminReports();
  if (canAdmin) {
    loadAdminUsersList();
    populateOrgDropdowns();
  }
  if (canOrg) {
    renderOrgManagementUI();
    populateOrgDropdowns();
  }
  if (canPersonnel) {
    renderPersonnelTable();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAdminUserHeaderInfo(user) {
  const titleEl = document.getElementById('adminUserTitle');
  const scopeBadgeEl = document.getElementById('adminUserScopeBadge');
  const scopeDetailEl = document.getElementById('adminUserScopeDetail');

  if (!user) return;

  const isSuperAdmin = isMasterAdmin(user);
  if (titleEl) {
    titleEl.textContent = isSuperAdmin ? 'احسان ابوالقاسمی (مدیر نرم افزار )' : (user.fullName || user.username);
  }

  const userSup = (user.supervision || '').trim();
  const userUnit = (user.unit || '').trim();
  const isGlobalSup = isSuperAdmin || !userSup || userSup === 'همه سرپرستی‌ها' || userSup === 'کل سرپرستی‌ها';
  const isGlobalUnit = isSuperAdmin || !userUnit || userUnit === 'همه واحدها' || userUnit === 'کل واحدها' || userUnit === 'همه واحدهای سرپرستی';

  if (scopeBadgeEl) {
    if (isGlobalSup && isGlobalUnit) {
      scopeBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
      scopeBadgeEl.textContent = 'دسترسی کامل (کل سازمان)';
    } else if (!isGlobalSup && isGlobalUnit) {
      scopeBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-blue-500/10 border border-blue-500/30 text-blue-300';
      scopeBadgeEl.textContent = `حوزه سرپرستی: ${userSup} (همه واحدها)`;
    } else if (!isGlobalSup && !isGlobalUnit) {
      scopeBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300';
      scopeBadgeEl.textContent = `حوزه اختصاصی: ${userSup} / ${userUnit}`;
    } else {
      scopeBadgeEl.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300';
      scopeBadgeEl.textContent = `واحد اختصاصی: ${userUnit}`;
    }
  }

  if (scopeDetailEl) {
    if (isGlobalSup && isGlobalUnit) {
      scopeDetailEl.textContent = 'دسترسی نامحدود به گزارش‌های تمامی سرپرستی‌ها و واحدها';
    } else if (!isGlobalSup && isGlobalUnit) {
      scopeDetailEl.textContent = `فقط مجاز به مشاهده گزارش‌های زیرمجموعه سرپرستی ${userSup}`;
    } else if (!isGlobalSup && !isGlobalUnit) {
      scopeDetailEl.textContent = `فقط مجاز به مشاهده گزارش‌های واحد ${userUnit}`;
    } else {
      scopeDetailEl.textContent = `محدود به واحد ${userUnit}`;
    }
  }
}

// ==========================================
// ۱۴. پنل ادمین: ارزیابی سطوح دسترسی (RBAC) و گزارش‌گیری
// ==========================================

/**
 * بررسی دسترسی مجاز مدیر به یک رکورد گزارش
 * طبق دستور صریح کاربر:
 * ۱. اگر مدیری برای همه سرپرستی‌ها و همه واحدها تعریف شود -> دسترسی به تمام اطلاعات
 * ۲. اگر مدیری برای یک سرپرستی خاص و همه واحدهای آن سرپرستی تعریف شود -> دسترسی به اطلاعات کل زیرمجموعه همان سرپرستی
 * ۳. اگر مدیری برای یک سرپرستی و یک واحد خاص تعریف شود -> فقط و فقط به اطلاعات همان واحد دسترسی دارد
 */
function isRecordAccessibleByAdmin(record, user) {
  if (!user) return false;
  if (user.isSuperAdmin || user.username === 'admin') {
    return true; // مدیر ارشد سیستم بدون محدودیت
  }

  const userSup = (user.supervision || '').trim();
  const userUnit = (user.unit || '').trim();

  const isGlobalSup = !userSup || userSup === 'همه سرپرستی‌ها' || userSup === 'کل سرپرستی‌ها' || userSup === 'همه';
  const isGlobalUnit = !userUnit || userUnit === 'همه واحدها' || userUnit === 'کل واحدها' || userUnit === 'همه واحدهای سرپرستی' || userUnit === 'همه';

  // حالت ۱: اگر مدیر برای همه سرپرستی‌ها و همه واحدها تعریف شود -> دسترسی کامل به کل اطلاعات
  if (isGlobalSup && isGlobalUnit) {
    return true;
  }

  const op = record.operator || {};
  const recordSup = (op.supervision || '').trim();
  const recordUnit = (op.unit || '').trim();

  // در صورتی که سرپرستی در فیلد مجری ثبت نشده باشد، از پایگاه داده سازمانی استخراج می‌شود
  const allUnits = getStoredUnits();
  const matchedUnitObj = allUnits.find((u) => u.name === recordUnit);
  const inferredSup = matchedUnitObj ? (matchedUnitObj.supervision || '').trim() : '';

  const recordBelongsToSup = isGlobalSup ||
    (recordSup && recordSup === userSup) ||
    (inferredSup && inferredSup === userSup);

  // حالت ۲: اگر مدیر برای یک سرپرستی خاص و همه واحدهای آن سرپرستی تعریف شود -> دسترسی به تمام اطلاعات زیرمجموعه همان سرپرستی
  if (!isGlobalSup && isGlobalUnit) {
    return recordBelongsToSup;
  }

  // حالت ۳: اگر مدیر برای یک سرپرستی و یک واحد خاص تعریف شود -> فقط اطلاعات همان واحد در آن سرپرستی
  if (!isGlobalSup && !isGlobalUnit) {
    const unitMatches = recordUnit === userUnit;
    return recordBelongsToSup && unitMatches;
  }

  // حالت فرعی (سرپرستی عمومی اما واحد اختصاصی)
  if (isGlobalSup && !isGlobalUnit) {
    return recordUnit === userUnit;
  }

  return false;
}

async function loadAdminReports() {
  try {
    const allRecords = await getAllGraphRecords();
    const user = window.AppState.currentUser;

    // فیلتر کردن دقیق براساس حوزه سرپرستی و واحد مدیر
    let records = allRecords.filter((r) => isRecordAccessibleByAdmin(r, user));

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    window.AppState.allReports = records;

    renderAdminKPIs(records);
    applyAdminFilters();
  } catch (err) {
    console.error('Error loading reports', err);
  }
}

function renderAdminKPIs(records) {
  const total = records.length;
  const pending = records.filter((r) => r.syncStatus === 'pending').length;
  const synced = records.filter((r) => r.syncStatus === 'synced').length;

  const todayStr = getFormattedJalali().dateNumStr;
  const todayCount = records.filter((r) => r.jalaliDate === todayStr).length;

  document.getElementById('kpiTotalCount').textContent = total;
  document.getElementById('kpiTodayCount').textContent = todayCount;
  document.getElementById('kpiPendingCount').textContent = pending;
  document.getElementById('kpiSyncedCount').textContent = synced;
}

function updateAdminFilterDropdowns() {
  const user = window.AppState.currentUser;
  const supervisions = getStoredSupervisions();
  const units = getStoredUnits();

  const filterSupSelect = document.getElementById('filterSupervisionSelect');
  const filterUnitSelect = document.getElementById('filterUnitSelect');
  const supLockedBadge = document.getElementById('filterSupervisionLockedBadge');
  const unitLockedBadge = document.getElementById('filterUnitLockedBadge');

  if (!filterSupSelect || !filterUnitSelect) return;

  const isSuperAdmin = !user || user.isSuperAdmin || user.username === 'admin';
  const userSup = user ? (user.supervision || '').trim() : '';
  const userUnit = user ? (user.unit || '').trim() : '';

  const isGlobalSup = isSuperAdmin || !userSup || userSup === 'همه سرپرستی‌ها' || userSup === 'کل سرپرستی‌ها' || userSup === 'همه';
  const isGlobalUnit = isSuperAdmin || !userUnit || userUnit === 'همه واحدها' || userUnit === 'کل واحدها' || userUnit === 'همه واحدهای سرپرستی' || userUnit === 'همه';

  // ۱. کنترل نوار فیلتر سرپرستی
  filterSupSelect.innerHTML = '';
  if (isGlobalSup) {
    filterSupSelect.disabled = false;
    filterSupSelect.className = 'w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none';
    if (supLockedBadge) supLockedBadge.classList.add('hidden');

    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '-- همه سرپرستی‌ها --';
    filterSupSelect.appendChild(allOpt);

    supervisions.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      filterSupSelect.appendChild(opt);
    });
  } else {
    // قفل‌شده بر روی سرپرستی این مدیر
    filterSupSelect.disabled = true;
    filterSupSelect.className = 'w-full bg-slate-900/90 border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-300 font-bold outline-none cursor-not-allowed';
    if (supLockedBadge) supLockedBadge.classList.remove('hidden');

    const opt = document.createElement('option');
    opt.value = userSup;
    opt.textContent = userSup;
    filterSupSelect.appendChild(opt);
    filterSupSelect.value = userSup;
  }

  // ۲. کنترل نوار فیلتر واحد خدمتی
  filterUnitSelect.innerHTML = '';
  if (!isGlobalSup && !isGlobalUnit) {
    // قفل‌شده بر روی تک‌واحد مجاز این مدیر
    filterUnitSelect.disabled = true;
    filterUnitSelect.className = 'w-full bg-slate-900/90 border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-300 font-bold outline-none cursor-not-allowed';
    if (unitLockedBadge) unitLockedBadge.classList.remove('hidden');

    const opt = document.createElement('option');
    opt.value = userUnit;
    opt.textContent = userUnit;
    filterUnitSelect.appendChild(opt);
    filterUnitSelect.value = userUnit;
  } else {
    // آزاد برای فیلتر در محدوده مجاز
    filterUnitSelect.disabled = false;
    filterUnitSelect.className = 'w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none';
    if (unitLockedBadge) unitLockedBadge.classList.add('hidden');

    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = !isGlobalSup ? `همه واحدهای ${userSup}` : '-- همه واحدها --';
    filterUnitSelect.appendChild(allOpt);

    const allowedUnits = !isGlobalSup
      ? units.filter((u) => !u.supervision || u.supervision === userSup)
      : units;

    allowedUnits.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.name;
      filterUnitSelect.appendChild(opt);
    });
  }
}

function onAdminFilterSupervisionChange() {
  const supSelect = document.getElementById('filterSupervisionSelect');
  const unitSelect = document.getElementById('filterUnitSelect');
  if (!supSelect || !unitSelect) return;

  const selectedSup = supSelect.value.trim();
  const allUnits = getStoredUnits();

  unitSelect.innerHTML = '<option value="">-- همه واحدها --</option>';
  const filteredUnits = selectedSup
    ? allUnits.filter((u) => !u.supervision || u.supervision === selectedSup)
    : allUnits;

  filteredUnits.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u.name;
    opt.textContent = u.name;
    unitSelect.appendChild(opt);
  });

  applyAdminFilters();
}

function applyAdminFilters() {
  let list = window.AppState.allReports || [];

  const search = (document.getElementById('filterSearchInput')?.value || '').toLowerCase().trim();
  const activity = document.getElementById('filterActivitySelect')?.value || '';
  const supervision = document.getElementById('filterSupervisionSelect')?.value || '';
  const unit = document.getElementById('filterUnitSelect')?.value || '';
  const dateFrom = document.getElementById('filterDateFrom')?.value.trim() || '';
  const dateTo = document.getElementById('filterDateTo')?.value.trim() || '';

  if (search) {
    list = list.filter((r) => {
      const notes = (r.reportNotes || '').toLowerCase();
      const asett = (r.asett || '').toLowerCase();
      const rebuild = (r.rebuildable || '').toLowerCase();
      const opName = r.operator ? `${r.operator.firstName} ${r.operator.lastName} ${r.operator.personnelId}`.toLowerCase() : '';
      const colleagues = (r.colleagues || []).map(c => typeof c === 'object' && c !== null ? `${c.name} ${c.code}` : c).join(' ').toLowerCase();
      return notes.includes(search) || asett.includes(search) || rebuild.includes(search) || opName.includes(search) || colleagues.includes(search);
    });
  }

  if (activity) {
    list = list.filter((r) => r.activityType === activity);
  }

  if (supervision) {
    list = list.filter((r) => {
      const rSup = r.operator ? (r.operator.supervision || '').trim() : '';
      if (rSup === supervision) return true;
      const allUnits = getStoredUnits();
      const uObj = allUnits.find((u) => u.name === (r.operator ? r.operator.unit : ''));
      return uObj && uObj.supervision === supervision;
    });
  }

  if (unit) {
    list = list.filter((r) => r.operator && r.operator.unit === unit);
  }

  if (dateFrom) {
    list = list.filter((r) => (r.jalaliDate || '') >= dateFrom);
  }

  if (dateTo) {
    list = list.filter((r) => (r.jalaliDate || '') <= dateTo);
  }

  window.AppState.filteredReports = list;
  renderReportsTable(list);
}

function resetAdminFilters() {
  if (document.getElementById('filterSearchInput')) document.getElementById('filterSearchInput').value = '';
  if (document.getElementById('filterActivitySelect')) document.getElementById('filterActivitySelect').value = '';
  if (document.getElementById('filterDateFrom')) document.getElementById('filterDateFrom').value = '';
  if (document.getElementById('filterDateTo')) document.getElementById('filterDateTo').value = '';

  const user = window.AppState.currentUser;
  const isSuperAdmin = !user || user.isSuperAdmin || user.username === 'admin';
  const userSup = user ? (user.supervision || '').trim() : '';
  const userUnit = user ? (user.unit || '').trim() : '';
  const isGlobalSup = isSuperAdmin || !userSup || userSup === 'همه سرپرستی‌ها' || userSup === 'کل سرپرستی‌ها';
  const isGlobalUnit = isSuperAdmin || !userUnit || userUnit === 'همه واحدها' || userUnit === 'کل واحدها';

  const filterSupSelect = document.getElementById('filterSupervisionSelect');
  const filterUnitSelect = document.getElementById('filterUnitSelect');

  if (isGlobalSup) {
    if (filterSupSelect) filterSupSelect.value = '';
  } else {
    if (filterSupSelect) filterSupSelect.value = userSup;
  }

  if (isGlobalSup && isGlobalUnit) {
    if (filterUnitSelect) filterUnitSelect.value = '';
  } else if (!isGlobalSup && isGlobalUnit) {
    if (filterUnitSelect) filterUnitSelect.value = '';
  } else {
    if (filterUnitSelect) filterUnitSelect.value = userUnit;
  }

  applyAdminFilters();
}

function renderReportsTable(list) {
  const tbody = document.getElementById('reportsTableBody');
  const emptyBox = document.getElementById('reportsEmptyState');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!list || list.length === 0) {
    if (emptyBox) emptyBox.classList.remove('hidden');
    return;
  }
  if (emptyBox) emptyBox.classList.add('hidden');

  list.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-800 hover:bg-slate-800/40 transition';

    const opName = r.operator ? `${r.operator.firstName} ${r.operator.lastName}` : '---';
    const personnel = r.operator ? r.operator.personnelId : '---';
    const unit = r.operator ? r.operator.unit : '---';

    let conditionInfo = '';
    if (r.conditionalFields) {
      if (r.conditionalFields.footage) conditionInfo = `متراژ: ${r.conditionalFields.footage}م`;
      if (r.conditionalFields.equipmentId) conditionInfo = `تجهیز: ${r.conditionalFields.equipmentId}`;
      if (r.conditionalFields.deviceTag) conditionInfo = `تگ: ${r.conditionalFields.deviceTag} (مرجع: ${r.conditionalFields.referenceTool})`;
    }

    const isSynced = r.syncStatus === 'synced';
    const statusBadge = isSynced
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">همگام‌شده</span>'
      : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-950 text-amber-300 border border-amber-800">در صف</span>';

    const photosList = Array.isArray(r.photos) && r.photos.length > 0 ? r.photos : (r.photo ? [r.photo] : []);
    let photoThumb = '<span class="text-xs text-slate-500">بدون عکس</span>';
    if (photosList.length === 1) {
      photoThumb = `<img src="${photosList[0]}" onclick="showDetailModal(${r.id})" class="w-10 h-10 object-cover rounded cursor-pointer border border-slate-700 hover:scale-105 transition" title="مشاهده تصویر">`;
    } else if (photosList.length > 1) {
      photoThumb = `
        <div class="relative inline-block cursor-pointer" onclick="showDetailModal(${r.id})" title="مشاهده ${photosList.length} تصویر">
          <img src="${photosList[0]}" class="w-10 h-10 object-cover rounded border border-amber-500/60 shadow hover:scale-105 transition">
          <span class="absolute -top-1.5 -left-1.5 bg-amber-500 text-slate-950 font-bold text-[9px] px-1 rounded-full border border-slate-900 shadow">
            +${photosList.length}
          </span>
        </div>
      `;
    }

    tr.innerHTML = `
      <td class="p-3 text-center text-slate-400 font-mono text-xs">${idx + 1}</td>
      <td class="p-3 whitespace-nowrap">
        <div class="font-medium text-slate-200 text-sm">${r.jalaliDate || '---'}</div>
        <div class="text-xs text-slate-400 font-mono">${r.jalaliTime || ''}</div>
      </td>
      <td class="p-3 whitespace-nowrap">
        <div class="font-medium text-slate-200">${opName}</div>
        <div class="text-xs text-slate-400 font-mono">پرسنلی: ${personnel}</div>
      </td>
      <td class="p-3 text-slate-300 text-xs whitespace-nowrap">${unit}</td>
      <td class="p-3 whitespace-nowrap">
        <div class="text-amber-400 font-medium text-xs">${r.activityType}</div>
        ${conditionInfo ? `<div class="text-xs text-slate-400 mt-0.5">${conditionInfo}</div>` : ''}
      </td>
      <td class="p-3 text-xs font-mono text-slate-300 whitespace-nowrap">
        <div>ASETT: ${r.asett || '-'}</div>
        <div>Rebuild: ${r.rebuildable || '-'}</div>
      </td>
      <td class="p-3 text-center whitespace-nowrap">${statusBadge}</td>
      <td class="p-3 text-center">${photoThumb}</td>
      <td class="p-3 text-center whitespace-nowrap">
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="showDetailModal(${r.id})" class="p-1.5 rounded-lg bg-blue-900/40 hover:bg-blue-800 text-blue-300 transition" title="مشاهده کامل">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          </button>
          <button onclick="confirmDeleteReport(${r.id})" class="p-1.5 rounded-lg bg-red-950/50 hover:bg-red-900 text-red-400 transition" title="حذف رکورد">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function showDetailModal(id) {
  const record = (window.AppState.allReports || []).find((r) => r.id === id);
  if (!record) return;

  const content = document.getElementById('reportDetailContent');
  if (!content) return;

  const op = record.operator || {};

  // پردازش و نمایش فعالیت‌های چندگانه
  let activitiesHtml = '';
  if (Array.isArray(record.activities) && record.activities.length > 0) {
    activitiesHtml = record.activities.map((act, i) => {
      let conds = '';
      if (act.conditionalFields) {
        if (act.conditionalFields.footage) conds += ` - متراژ: ${act.conditionalFields.footage} متر`;
        if (act.conditionalFields.equipmentId) conds += ` - شناسایی تجهیز: ${act.conditionalFields.equipmentId}`;
        if (act.conditionalFields.deviceTag) conds += ` - شماره تجهیز: ${act.conditionalFields.deviceTag}`;
        if (act.conditionalFields.referenceTool) conds += ` - مرجع: ${act.conditionalFields.referenceTool}`;
      }
      return `
        <div class="flex items-center justify-between p-2 rounded-lg bg-slate-950/80 border border-slate-700/60 text-xs">
          <span class="font-bold text-amber-300">${i + 1}. ${act.type}</span>
          <span class="text-slate-300 font-mono text-[11px]">${conds || '---'}</span>
        </div>
      `;
    }).join('');
  } else {
    let conditionRows = '';
    if (record.conditionalFields) {
      if (record.conditionalFields.footage) conditionRows += ` (متراژ: ${record.conditionalFields.footage} متر)`;
      if (record.conditionalFields.equipmentId) conditionRows += ` (تجهیز: ${record.conditionalFields.equipmentId})`;
      if (record.conditionalFields.deviceTag) conditionRows += ` (تگ: ${record.conditionalFields.deviceTag} - مرجع: ${record.conditionalFields.referenceTool})`;
    }
    activitiesHtml = `<div class="font-bold text-amber-300 text-xs">${record.activityType} ${conditionRows}</div>`;
  }

  // پردازش و نمایش تصاویر چندگانه
  const photosList = Array.isArray(record.photos) && record.photos.length > 0
    ? record.photos
    : (record.photo ? [record.photo] : []);

  let photosHtml = '';
  if (photosList.length > 0) {
    photosHtml = `
      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
        <h4 class="font-bold text-amber-400 text-xs border-b border-slate-800 pb-1">تصاویر ثبت شده از تجهیز و محیط کار (${photosList.length} عکس)</h4>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-1">
          ${photosList.map((p, idx) => `
            <div class="group relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer shadow hover:border-amber-500 transition" onclick="openPhotoViewerModal('${p}', ${idx})">
              <img src="${p}" class="w-full h-full object-cover group-hover:scale-105 transition duration-200" alt="عکس شماره ${idx + 1}">
              <span class="absolute top-1 right-1 bg-slate-900/80 text-[10px] font-mono text-amber-300 px-1.5 py-0.5 rounded border border-slate-700">#${idx + 1}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const mapLink = record.location && record.location.lat
    ? `<a href="https://www.google.com/maps?q=${record.location.lat},${record.location.lng}" target="_blank" class="text-blue-400 underline font-mono">نمایش روی نقشه (${record.location.lat}, ${record.location.lng})</a>`
    : '<span class="text-slate-500">ثبت نشده</span>';

  content.innerHTML = `
    <div class="space-y-4 text-sm">
      <div class="grid grid-cols-2 gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div><span class="text-slate-400 text-xs">تاریخ و ساعت:</span> <div class="font-bold text-slate-200 mt-1">${record.jalaliFull || record.jalaliDate}</div></div>
        <div><span class="text-slate-400 text-xs">وضعیت همگام‌سازی:</span> <div class="mt-1">${record.syncStatus === 'synced' ? '<span class="text-emerald-400 font-bold">همگام‌شده با سرور</span>' : '<span class="text-amber-400 font-bold">در صف انتظار محلی</span>'}</div></div>
      </div>

      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
        <h4 class="font-bold text-amber-400 text-xs border-b border-slate-800 pb-1">اطلاعات مجری و سرپرستی</h4>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>نام و پرسنلی: <strong class="text-slate-200">${op.firstName || ''} ${op.lastName || ''} (${op.personnelId || '-'})</strong></div>
          <div>نام پدر: <strong class="text-slate-200">${op.fatherName || '---'}</strong></div>
          <div>واحد خدمتی: <strong class="text-slate-200">${op.unit || '-'}</strong></div>
          <div>سرپرستی: <strong class="text-slate-200">${op.supervision || '-'}</strong></div>
          <div>سمت: <strong class="text-slate-200">${op.role || '-'}</strong></div>
        </div>
      </div>

      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
        <h4 class="font-bold text-amber-400 text-xs border-b border-slate-800 pb-1">فعالیت‌های انجام‌شده</h4>
        <div class="space-y-1.5 pt-1">
          ${activitiesHtml}
        </div>
        <div class="pt-2 border-t border-slate-800 space-y-1 text-xs">
          <div class="flex justify-between py-1 border-b border-slate-800/60"><span class="text-slate-400">کد تجهیز (ASETT ID):</span><span class="font-mono text-slate-200">${record.asett || '---'}</span></div>
          <div class="flex justify-between py-1 border-b border-slate-800/60"><span class="text-slate-400">شناسه داغی (rebuidable ID):</span><span class="font-mono text-slate-200">${record.rebuildable || '---'}</span></div>
          <div class="flex justify-between py-1 border-b border-slate-800/60"><span class="text-slate-400">موقعیت مکانی (GPS):</span>${mapLink}</div>
          <div class="flex justify-between py-1"><span class="text-slate-400">همکاران همراه:</span><span class="font-mono text-slate-200">${(record.colleagues || []).map(c => typeof c === 'object' && c !== null ? `${c.name} (${c.code})` : c).join('، ') || 'ندارد'}</span></div>
        </div>
      </div>

      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <h4 class="font-bold text-amber-400 text-xs mb-2">توضیحات تکمیلی:</h4>
        <p class="text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">${record.reportNotes || '<span class="text-slate-500 italic">توضیحی ثبت نشده است.</span>'}</p>
      </div>

      ${photosHtml}
    </div>
  `;

  openModal('reportDetailModal');
}

async function confirmDeleteReport(id) {
  if (confirm(`آیا از حذف دائمی گراف شماره #${id} اطمینان دارید؟`)) {
    try {
      await deleteGraphRecord(id);
      showToast('گراف با موفقیت حذف گردید.', 'success');
      loadAdminReports();
    } catch (e) {
      showToast('خطا در حذف رکورد', 'error');
    }
  }
}

// ==========================================
// ۱۵. خروجی اکسل (Excel / CSV با BOM فارسی)
// ==========================================
function exportToExcel() {
  const list = window.AppState.filteredReports || window.AppState.allReports || [];
  if (list.length === 0) {
    showToast('رکوردی جهت خروجی اکسل وجود ندارد', 'warning');
    return;
  }

  const headers = [
    'شناسه',
    'تاریخ شمسی',
    'ساعت',
    'نام و نام خانوادگی مجری',
    'نام پدر',
    'شماره پرسنلی',
    'واحد خدمتی',
    'سرپرستی',
    'سمت',
    'نوع فعالیت',
    'متراژ (متر)',
    'شماره تجهیز',
    'شماره مرجع ابزار',
    'کد تجهیز (ASETT)',
    'قطعه داغی (Rebuildable)',
    'همکاران همراه',
    'عرض جغرافیایی (Lat)',
    'طول جغرافیایی (Lng)',
    'وضعیت همگام‌سازی',
    'شرح کامل گزارش'
  ];

  const rows = list.map((r) => {
    const op = r.operator || {};
    const cond = r.conditionalFields || {};
    const loc = r.location || {};
    const notesClean = (r.reportNotes || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');

    return [
      r.id,
      r.jalaliDate || '',
      r.jalaliTime || '',
      `"${op.firstName || ''} ${op.lastName || ''}"`,
      `"${op.fatherName || ''}"`,
      `"${op.personnelId || ''}"`,
      `"${op.unit || ''}"`,
      `"${op.supervision || ''}"`,
      `"${op.role || ''}"`,
      `"${r.activityType || ''}"`,
      cond.footage || '',
      `"${cond.equipmentId || cond.deviceTag || ''}"`,
      `"${cond.referenceTool || ''}"`,
      `"${r.asett || ''}"`,
      `"${r.rebuildable || ''}"`,
      `"${(r.colleagues || []).join(' - ')}"`,
      loc.lat || '',
      loc.lng || '',
      r.syncStatus === 'synced' ? 'همگام‌شده' : 'در صف',
      `"${notesClean}"`
    ].join(',');
  });

  const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Automation_Graphs_${getFormattedJalali().dateNumStr.replace(/\//g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('فایل اکسل با موفقیت ایجاد و دانلود شد', 'success');
}

// ==========================================
// ۱۶. خروجی PDF و چاپ رسمی فرم صنعتی
// ==========================================
function printReportsAsPDF() {
  const list = window.AppState.filteredReports || window.AppState.allReports || [];
  if (list.length === 0) {
    showToast('رکوردی جهت چاپ وجود ندارد', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.print();
    return;
  }

  const jalaliNow = getFormattedJalali().fullPersian;
  let tableRows = '';
  list.forEach((r, idx) => {
    const op = r.operator || {};
    const cond = r.conditionalFields || {};
    let extra = '';
    if (cond.footage) extra = `متراژ: ${cond.footage}م`;
    if (cond.equipmentId) extra = `تجهیز: ${cond.equipmentId}`;
    if (cond.deviceTag) extra = `تگ: ${cond.deviceTag}`;

    tableRows += `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td>${r.jalaliDate} ${r.jalaliTime}</td>
        <td>${op.firstName || ''} ${op.lastName || ''} (${op.personnelId || '-'})</td>
        <td>${op.unit || '-'}</td>
        <td><strong>${r.activityType}</strong> ${extra ? `<br><small>${extra}</small>` : ''}</td>
        <td>ASETT: ${r.asett || '-'}<br>Rebuild: ${r.rebuildable || '-'}</td>
        <td>${(r.reportNotes || '').slice(0, 100)}${(r.reportNotes || '').length > 100 ? '...' : ''}</td>
        <td style="text-align:center;">${r.syncStatus === 'synced' ? 'تایید و ارسال' : 'محلی'}</td>
      </tr>
    `;
  });

  printWindow.document.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="fa">
    <head>
      <meta charset="utf-8">
      <title>گزارش رسمی فعالیت‌های اتوماسیون و ارتباطات</title>
      <style>
        body { font-family: Tahoma, 'Segoe UI', sans-serif; direction: rtl; padding: 25px; color: #111; }
        .header { border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .header h2 { margin: 0; font-size: 18px; }
        .header p { margin: 5px 0 0 0; font-size: 12px; color: #555; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
        th, td { border: 1px solid #777; padding: 6px 8px; text-align: right; }
        th { background: #f0f0f0; }
        .signatures { margin-top: 50px; display: flex; justify-content: space-between; font-size: 12px; padding: 0 40px; }
        @media print {
          @page { size: landscape; margin: 15mm; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h2>مدیریت اتوماسیون و ارتباطات</h2>
          <p>صورت‌جلسه و گراف رسمی فعالیت‌های فنی، تعمیراتی و نگهداری میدانی</p>
        </div>
        <div style="text-align:left; font-size:12px;">
          <div>تاریخ چاپ: ${jalaliNow}</div>
          <div>تعداد رکوردها: ${list.length}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:30px;">ردیف</th>
            <th style="width:90px;">تاریخ/ساعت</th>
            <th style="width:130px;">مجری (پرسنلی)</th>
            <th style="width:100px;">واحد خدمتی</th>
            <th style="width:140px;">نوع فعالیت</th>
            <th style="width:110px;">کدهای تجهیز</th>
            <th>شرح خلاصه اقدام</th>
            <th style="width:70px;">وضعیت</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="signatures">
        <div><strong>امضاء تکنسین / مجری عملیات</strong><br><br>.....................................</div>
        <div><strong>امضاء سرپرست مربوطه</strong><br><br>.....................................</div>
        <div><strong>تایید رئیس اداره اتوماسیون و ارتباطات</strong><br><br>.....................................</div>
      </div>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ==========================================
// ۱۷. پشتیبان‌گیری (Backup) و بازنشانی (Restore)
// ==========================================
async function exportFullBackup() {
  if (!canAccessBackup()) {
    showToast('دسترسی غیرمجاز: شما مجوز دسترسی به ماژول پشتیبان‌گیری را ندارید', 'error');
    return;
  }
  try {
    const graphs = await getAllGraphRecords();
    const admins = await getAdminsList();
    const operator = window.AppState.operator;
    const supervisions = getStoredSupervisions();
    const units = getStoredUnits();
    const assetRebuildables = await getAllAssetRebuildableRecordsFromDB();

    const backupData = {
      version: '2.1',
      exportedAt: new Date().toISOString(),
      jalaliExportedAt: getFormattedJalali().fullPersian,
      data: { graphs, admins, operator, supervisions, units, assetRebuildables }
    };

    const str = JSON.stringify(backupData, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Automation_Backup_${getFormattedJalali().dateNumStr.replace(/\//g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('فایل پشتیبان JSON با موفقیت دریافت گردید', 'success');
  } catch (err) {
    console.error('Backup error', err);
    showToast('خطا در تهیه فایل پشتیبان', 'error');
  }
}

async function handleRestoreFile(e) {
  if (!canAccessBackup()) {
    showToast('دسترسی غیرمجاز: شما مجوز دسترسی به ماژول بازنشانی اطلاعات را ندارید', 'error');
    if (e && e.target) e.target.value = '';
    return;
  }
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!confirm('آیا مطمئن هستید؟ بازنشانی پشتیبان ممکن است رکوردهای قبلی را به‌روزرسانی کند.')) {
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed || !parsed.data || !Array.isArray(parsed.data.graphs)) {
        showToast('فرمت فایل پشتیبان نامعتبر است', 'error');
        return;
      }

      for (const item of parsed.data.graphs) {
        await updateGraphRecord(item);
      }

      if (Array.isArray(parsed.data.admins)) {
        for (const admin of parsed.data.admins) {
          await saveAdminUser(admin);
        }
      }

      if (parsed.data.operator) {
        localStorage.setItem('automation_operator_profile', JSON.stringify(parsed.data.operator));
        loadOperatorProfile();
      }

      if (Array.isArray(parsed.data.supervisions)) {
        saveStoredSupervisions(parsed.data.supervisions);
      }

      if (Array.isArray(parsed.data.units)) {
        saveStoredUnits(parsed.data.units);
      }

      if (Array.isArray(parsed.data.assetRebuildables)) {
        await saveMultipleAssetRebuildablesToDB(parsed.data.assetRebuildables);
        window.AppState.assetRecords = parsed.data.assetRebuildables;
      }

      showToast(`بازنشانی با موفقیت انجام شد: ${parsed.data.graphs.length} رکورد بازیابی گردید.`, 'success');
      loadAdminReports();
      loadAdminUsersList();
      renderOrgManagementUI();
      populateOrgDropdowns();
      updatePendingQueueCount();
      if (typeof renderAssetRebuildableUI === 'function') {
        renderAssetRebuildableUI();
      }
    } catch (err) {
      console.error('Restore error', err);
      showToast('خطا در پردازش فایل پشتیبان', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ==========================================
// ۱۸. مدیریت مدیران توسط Super Admin با تفکیک دقیق حوزه دسترسی (RBAC)
// ==========================================
async function loadAdminUsersList() {
  const container = document.getElementById('adminUsersListContainer');
  if (!container) return;

  try {
    const list = await getAdminsList();
    container.innerHTML = '';

    // ردیف مدیر ارشد سیستم (Super Admin)
    const superRow = document.createElement('div');
    superRow.className = 'p-3.5 rounded-xl bg-slate-900/80 border border-amber-500/30 shadow-sm space-y-2';
    superRow.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-amber-300 text-sm">احسان ابوالقاسمی (مدیر نرم افزار )</span>
          <span class="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md font-bold">مدیر ارشد (admin)</span>
        </div>
        <span class="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold">دسترسی جامع و نامحدود</span>
      </div>
      <div class="text-xs text-slate-400 font-mono">نام کاربری: admin</div>
      <div class="text-[11px] text-emerald-400 font-sans font-medium flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
        <span>حوزه دسترسی سازمانی: تمام سرپرستی‌ها و تمام واحدهای سازمان</span>
      </div>
      <div class="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
        <span class="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold">✓ تعریف سرپرستی‌ها و واحدها</span>
        <span class="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold">✓ تعریف و سطوح مدیران</span>
        <span class="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold">✓ پشتیبان‌گیری و بازنشانی</span>
        <span class="text-[10px] bg-teal-500/10 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-bold">✓ ماژول پرسنل (کامل)</span>
        <span class="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded font-bold">✓ ماژول asset &Rebuidble (کامل)</span>
      </div>
    `;
    container.appendChild(superRow);

    if (list.length === 0) {
      const p = document.createElement('div');
      p.className = 'text-xs text-slate-400 p-3.5 text-center bg-slate-900/30 rounded-xl border border-dashed border-slate-800';
      p.textContent = 'مدیر فرعی دیگری هنوز تعریف نشده است. از فرم بالا برای تعریف مدیر با حوزه و دسترسی‌های مشخص استفاده نمایید.';
      container.appendChild(p);
      return;
    }

    list.forEach((admin) => {
      const isGlobalSup = !admin.supervision || admin.supervision === 'همه سرپرستی‌ها' || admin.supervision === 'کل سرپرستی‌ها';
      const isGlobalUnit = !admin.unit || admin.unit === 'همه واحدها' || admin.unit === 'کل واحدها' || admin.unit === 'همه واحدهای سرپرستی';

      let scopeBadgeHtml = '';
      let scopeDescHtml = '';

      if (isGlobalSup && isGlobalUnit) {
        scopeBadgeHtml = '<span class="text-[11px] bg-purple-950/80 text-purple-300 border border-purple-800 px-2 py-0.5 rounded font-bold">کل سازمان</span>';
        scopeDescHtml = 'دسترسی نامحدود به تمامی سرپرستی‌ها و واحدها';
      } else if (!isGlobalSup && isGlobalUnit) {
        scopeBadgeHtml = '<span class="text-[11px] bg-blue-950/80 text-blue-300 border border-blue-800 px-2 py-0.5 rounded font-bold">سرپرستی (همه واحدها)</span>';
        scopeDescHtml = `سرپرستی: <strong class="text-slate-100">${admin.supervision}</strong> (تمام واحدهای زیرمجموعه)`;
      } else if (!isGlobalSup && !isGlobalUnit) {
        scopeBadgeHtml = '<span class="text-[11px] bg-amber-950/80 text-amber-300 border border-amber-800 px-2 py-0.5 rounded font-bold">تک‌واحدی</span>';
        scopeDescHtml = `سرپرستی: <strong class="text-slate-100">${admin.supervision}</strong> ➔ واحد: <strong class="text-amber-300">${admin.unit}</strong>`;
      } else {
        scopeBadgeHtml = `<span class="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold">واحد: ${admin.unit}</span>`;
        scopeDescHtml = `محدود به واحد ${admin.unit}`;
      }

      const hasOrgPerm = !!(admin.permissions && admin.permissions.orgManage);
      const hasAdminPerm = !!(admin.permissions && admin.permissions.adminManage);
      const hasBackupPerm = !!(admin.permissions && admin.permissions.backup);
      const hasPersonnelPerm = !!(admin.permissions && admin.permissions.personnelManage);
      const hasAssetPerm = !(admin.permissions && admin.permissions.assetRebuildable === false);

      const row = document.createElement('div');
      row.className = 'p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-2.5';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-200 text-sm">${escapeHtml(admin.fullName || admin.username)}</span>
              ${scopeBadgeHtml}
            </div>
            <div class="text-xs text-slate-400 font-mono">نام کاربری: ${escapeHtml(admin.username)}</div>
            <div class="text-[11px] text-slate-300 font-sans mt-0.5">${scopeDescHtml}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="openEditAdminModal('${escapeHtml(admin.username)}')" class="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition flex items-center gap-1 text-xs font-bold shadow-sm" title="ویرایش مشخصات، کلمه عبور، واحد و دسترسی‌های مدیر با حفظ تنظیمات قبلی">
              <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
              <span>ویرایش</span>
            </button>
            <button type="button" onclick="confirmDeleteAdmin('${escapeHtml(admin.username)}')" class="p-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-400 hover:text-red-200 transition" title="حذف مدیر">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>

        <!-- نوار وضعیت و کلیدهای اعطا / سلب دسترسی ماژول‌ها توسط admin -->
        <div class="flex flex-col gap-1.5 pt-2 border-t border-slate-800/80">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span class="font-bold text-slate-300">سطوح دسترسی به ماژول‌ها (کلیک جهت اعطا یا سلب):</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <!-- ۱. دسترسی به تب پرسنل (درخواستی کاربر) -->
            <button type="button" onclick="toggleAdminModulePermission('${escapeHtml(admin.username)}', 'personnelManage')" class="px-2.5 py-1 text-[11px] rounded-lg border font-medium transition inline-flex items-center gap-1.5 ${hasPersonnelPerm ? 'bg-teal-950/80 hover:bg-teal-900 border-teal-600/80 text-teal-300 shadow-sm' : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-500 hover:text-slate-300'}" title="کلیک جهت ${hasPersonnelPerm ? 'سلب' : 'اعطای'} دسترسی به ماژول پرسنل">
              <span class="w-2 h-2 rounded-full ${hasPersonnelPerm ? 'bg-teal-400 shadow-[0_0_6px_#2dd4bf]' : 'bg-slate-600'}"></span>
              <span>تب پرسنل: <strong class="${hasPersonnelPerm ? 'text-teal-200 font-bold' : 'text-slate-400'}">${hasPersonnelPerm ? 'مجاز ✓' : 'مسدود ✕'}</strong></span>
            </button>

            <!-- ۲. دسترسی به ماژول ساختار سازمانی (سرپرستی و واحدها) -->
            <button type="button" onclick="toggleAdminModulePermission('${escapeHtml(admin.username)}', 'orgManage')" class="px-2.5 py-1 text-[11px] rounded-lg border font-medium transition inline-flex items-center gap-1.5 ${hasOrgPerm ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-600/80 text-emerald-300 shadow-sm' : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-500 hover:text-slate-300'}" title="کلیک جهت ${hasOrgPerm ? 'سلب' : 'اعطای'} دسترسی به ماژول سرپرستی و واحدها">
              <span class="w-2 h-2 rounded-full ${hasOrgPerm ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-600'}"></span>
              <span>سرپرستی و واحدها: <strong class="${hasOrgPerm ? 'text-emerald-200 font-bold' : 'text-slate-400'}">${hasOrgPerm ? 'مجاز ✓' : 'مسدود ✕'}</strong></span>
            </button>

            <!-- ۳. دسترسی به ماژول تعریف مدیران -->
            <button type="button" onclick="toggleAdminModulePermission('${escapeHtml(admin.username)}', 'adminManage')" class="px-2.5 py-1 text-[11px] rounded-lg border font-medium transition inline-flex items-center gap-1.5 ${hasAdminPerm ? 'bg-blue-950/80 hover:bg-blue-900 border-blue-600/80 text-blue-300 shadow-sm' : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-500 hover:text-slate-300'}" title="کلیک جهت ${hasAdminPerm ? 'سلب' : 'اعطای'} دسترسی به ماژول تعریف مدیران">
              <span class="w-2 h-2 rounded-full ${hasAdminPerm ? 'bg-blue-400 shadow-[0_0_6px_#60a5fa]' : 'bg-slate-600'}"></span>
              <span>تعریف مدیران: <strong class="${hasAdminPerm ? 'text-blue-200 font-bold' : 'text-slate-400'}">${hasAdminPerm ? 'مجاز ✓' : 'مسدود ✕'}</strong></span>
            </button>

            <!-- ۴. دسترسی به ماژول پشتیبان‌گیری -->
            <button type="button" onclick="toggleAdminModulePermission('${escapeHtml(admin.username)}', 'backup')" class="px-2.5 py-1 text-[11px] rounded-lg border font-medium transition inline-flex items-center gap-1.5 ${hasBackupPerm ? 'bg-amber-950/80 hover:bg-amber-900 border-amber-600/80 text-amber-300 shadow-sm' : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-500 hover:text-slate-300'}" title="کلیک جهت ${hasBackupPerm ? 'سلب' : 'اعطای'} دسترسی به ماژول پشتیبان‌گیری">
              <span class="w-2 h-2 rounded-full ${hasBackupPerm ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]' : 'bg-slate-600'}"></span>
              <span>پشتیبان‌گیری: <strong class="${hasBackupPerm ? 'text-amber-200 font-bold' : 'text-slate-400'}">${hasBackupPerm ? 'مجاز ✓' : 'مسدود ✕'}</strong></span>
            </button>

            <!-- ۵. دسترسی به ماژول asset &Rebuidble -->
            <button type="button" onclick="toggleAdminModulePermission('${escapeHtml(admin.username)}', 'assetRebuildable')" class="px-2.5 py-1 text-[11px] rounded-lg border font-medium transition inline-flex items-center gap-1.5 ${hasAssetPerm ? 'bg-cyan-950/80 hover:bg-cyan-900 border-cyan-600/80 text-cyan-300 shadow-sm' : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-500 hover:text-slate-300'}" title="کلیک جهت ${hasAssetPerm ? 'سلب' : 'اعطای'} دسترسی به ماژول asset &Rebuidble">
              <span class="w-2 h-2 rounded-full ${hasAssetPerm ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-slate-600'}"></span>
              <span>asset &Rebuidble: <strong class="${hasAssetPerm ? 'text-cyan-200 font-bold' : 'text-slate-400'}">${hasAssetPerm ? 'مجاز ✓' : 'مسدود ✕'}</strong></span>
            </button>
          </div>
        </div>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    console.error('Error loading admins', err);
  }
}

function onNewAdminSupervisionChange() {
  const supSelect = document.getElementById('newAdminSupervision');
  const unitSelect = document.getElementById('newAdminUnit');
  if (!supSelect || !unitSelect) return;

  const selectedSup = supSelect.value.trim();
  const allUnits = getStoredUnits();

  unitSelect.innerHTML = '';

  if (!selectedSup || selectedSup === 'همه سرپرستی‌ها' || selectedSup === 'کل سرپرستی‌ها') {
    const opt = document.createElement('option');
    opt.value = 'همه واحدها';
    opt.textContent = 'همه واحدها (دسترسی نامحدود به کل سازمان)';
    unitSelect.appendChild(opt);
  } else {
    // سرپرستی خاص انتخاب شده است
    const allInSupOpt = document.createElement('option');
    allInSupOpt.value = 'همه واحدها';
    allInSupOpt.textContent = `همه واحدهای این سرپرستی (دسترسی به کل زیرمجموعه)`;
    unitSelect.appendChild(allInSupOpt);

    const filteredUnits = allUnits.filter((u) => !u.supervision || u.supervision === selectedSup);
    filteredUnits.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = `فقط واحد اختصاصی: ${u.name}`;
      unitSelect.appendChild(opt);
    });

    if (filteredUnits.length === 0) {
      allUnits.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.textContent = `واحد: ${u.name}`;
        unitSelect.appendChild(opt);
      });
    }
  }

  updateNewAdminScopeHint();
}

function updateNewAdminScopeHint() {
  const supSelect = document.getElementById('newAdminSupervision');
  const unitSelect = document.getElementById('newAdminUnit');
  const hintText = document.getElementById('newAdminScopePreviewText');
  if (!supSelect || !unitSelect || !hintText) return;

  const sup = supSelect.value.trim();
  const unit = unitSelect.value.trim();

  const isGlobalSup = !sup || sup === 'همه سرپرستی‌ها' || sup === 'کل سرپرستی‌ها';
  const isGlobalUnit = !unit || unit === 'همه واحدها' || unit === 'کل واحدها' || unit === 'همه واحدهای سرپرستی';

  let scopePart = '';
  if (isGlobalSup && isGlobalUnit) {
    scopePart = '<span class="text-emerald-400 font-bold">✓ دسترسی سازمانی:</span> دسترسی کامل به اطلاعات و گراف‌های ثبت‌شده در <strong class="text-slate-100">تمامی سرپرستی‌ها و تمامی واحدهای سازمان</strong>.';
  } else if (!isGlobalSup && isGlobalUnit) {
    scopePart = `<span class="text-blue-400 font-bold">✓ دسترسی سرپرستی:</span> دسترسی به تمامی اطلاعات و گراف‌های ثبت‌شده برای <strong class="text-slate-100">کل واحدهای زیرمجموعه «${sup}»</strong>.`;
  } else if (!isGlobalSup && !isGlobalUnit) {
    scopePart = `<span class="text-amber-400 font-bold">✓ دسترسی تک‌واحدی:</span> منحصراً به اطلاعات ثبت‌شده برای واحد <strong class="text-amber-300 font-extrabold">«${unit}»</strong> در سرپرستی «${sup}».`;
  } else {
    scopePart = `<span class="text-amber-400 font-bold">✓ دسترسی واحد:</span> محدود به واحد «${unit}».`;
  }

  // ماژول‌های انتخابی
  const permOrg = document.getElementById('permOrgManage')?.checked;
  const permAdmin = document.getElementById('permAdminManage')?.checked;
  const permBackup = document.getElementById('permBackup')?.checked;
  const permPersonnel = document.getElementById('permPersonnelManage')?.checked;
  const permAsset = document.getElementById('permAssetRebuildable')?.checked;

  const selectedModules = [];
  if (permPersonnel) selectedModules.push('بانک اطلاعات پرسنل (تب پرسنل)');
  if (permOrg) selectedModules.push('تعریف سرپرستی‌ها و واحدها');
  if (permAdmin) selectedModules.push('تعریف و سطوح مدیران');
  if (permBackup) selectedModules.push('پشتیبان‌گیری و بازنشانی');
  if (permAsset) selectedModules.push('ماژول asset &Rebuidble');

  let modulesPart = '';
  if (selectedModules.length > 0) {
    modulesPart = `<div class="mt-2 pt-2 border-t border-slate-800 text-[11px] text-teal-300 flex items-center gap-1.5 flex-wrap"><span class="font-bold text-slate-300">ماژول‌های مجاز اعطاشده:</span> ${selectedModules.map(m => `<span class="px-2 py-0.5 rounded bg-teal-950/70 border border-teal-800 font-medium">${m}</span>`).join(' ')}</div>`;
  } else {
    modulesPart = `<div class="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">این مدیر فاقد دسترسی به ماژول‌های ویژه (تب پرسنل، سرپرستی‌ها، پشتیبان‌گیری) بوده و صرفاً به تب گزارش‌ها دسترسی خواهد داشت.</div>`;
  }

  hintText.innerHTML = `<div>${scopePart}</div>${modulesPart}`;
}

async function handleCreateNewAdmin(e) {
  e.preventDefault();
  if (!canAccessAdminManage()) {
    showToast('دسترسی غیرمجاز: تنها کاربر admin یا مدیران مجاز به ماژول مدیریت مدیران، امکان تعریف مدیر جدید دارند', 'error');
    return;
  }
  const fullName = document.getElementById('newAdminFullName').value.trim();
  const username = document.getElementById('newAdminUsername').value.trim().toLowerCase();
  const password = document.getElementById('newAdminPassword').value.trim();
  const unit = document.getElementById('newAdminUnit').value.trim();
  const supervision = document.getElementById('newAdminSupervision').value.trim();

  // دریافت مجوزهای ماژول‌های ویژه انتخابی توسط admin
  const permOrgManage = document.getElementById('permOrgManage')?.checked || false;
  const permAdminManage = document.getElementById('permAdminManage')?.checked || false;
  const permBackup = document.getElementById('permBackup')?.checked || false;
  const permPersonnelManage = document.getElementById('permPersonnelManage')?.checked || false;
  const permAssetRebuildable = document.getElementById('permAssetRebuildable')?.checked || false;

  if (!username || !password) {
    showToast('نام کاربری و رمز عبور الزامی است', 'error');
    return;
  }
  if (username === 'admin') {
    showToast('نام کاربری admin مخصوص مدیر ارشد است', 'error');
    return;
  }

  const newAdmin = {
    fullName: fullName || username,
    username,
    password,
    unit: unit || 'همه واحدها',
    supervision: supervision || 'همه سرپرستی‌ها',
    permissions: {
      orgManage: permOrgManage,
      adminManage: permAdminManage,
      backup: permBackup,
      personnelManage: permPersonnelManage,
      assetRebuildable: permAssetRebuildable
    },
    createdAt: new Date().toISOString()
  };

  try {
    await saveAdminUser(newAdmin);
    showToast(`مدیر جدید با نام کاربری «${username}» و دسترسی‌های تعیین‌شده با موفقیت ثبت شد`, 'success');
    document.getElementById('newAdminForm').reset();
    populateOrgDropdowns();
    updateNewAdminScopeHint();
    loadAdminUsersList();
  } catch (err) {
    console.error('Admin create error', err);
    showToast('خطا در ذخیره‌سازی مدیر جدید', 'error');
  }
}

async function confirmDeleteAdmin(username) {
  if (!canAccessAdminManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز حذف مدیران را ندارید', 'error');
    return;
  }
  if (confirm(`آیا از حذف مدیر با نام کاربری "${username}" اطمینان دارید؟`)) {
    try {
      await deleteAdminUser(username);
      showToast('مدیر حذف گردید', 'success');
      loadAdminUsersList();
    } catch (e) {
      showToast('خطا در حذف مدیر', 'error');
    }
  }
}

// تغییر وضعیت دسترسی ماژول‌های ویژه برای مدیران توسط admin
async function toggleAdminModulePermission(username, moduleKey) {
  if (!canAccessAdminManage()) {
    showToast('تنها کاربر admin مجوز تغییر دسترسی‌های مدیران را دارد', 'error');
    return;
  }
  try {
    const admins = await getAdminsList();
    const admin = admins.find(a => a.username === username);
    if (!admin) {
      showToast('مدیر مورد نظر یافت نشد', 'error');
      return;
    }
    if (!admin.permissions) admin.permissions = {};
    const newStatus = (admin.permissions[moduleKey] !== undefined) ? !admin.permissions[moduleKey] : false;
    admin.permissions[moduleKey] = newStatus;
    await saveAdminUser(admin);

    const labels = {
      personnelManage: 'ماژول بانک پرسنل',
      orgManage: 'ماژول سرپرستی و واحدها',
      adminManage: 'ماژول تعریف مدیران',
      backup: 'ماژول پشتیبان‌گیری',
      assetRebuildable: 'ماژول asset &Rebuidble'
    };
    const modLabel = labels[moduleKey] || moduleKey;
    showToast(`دسترسی به «${modLabel}» برای مدیر «${admin.fullName || username}» ${newStatus ? 'اعطا شد (فعال)' : 'سلب گردید (مسدود)'}`, 'success');

    // اگر خود کاربر در حال حاضر با این نام کاربری لاگین است، وضعیت سشن و تب‌ها بلافاصله به‌روزرسانی شود
    if (window.AppState.currentUser && window.AppState.currentUser.username === username) {
      window.AppState.currentUser.permissions[moduleKey] = newStatus;
      sessionStorage.setItem('automation_admin_session', JSON.stringify(window.AppState.currentUser));
      const tabBtnMap = {
        personnelManage: 'tabBtnPersonnelManage',
        orgManage: 'tabBtnOrgManage',
        adminManage: 'tabBtnAdminManage',
        backup: 'tabBtnBackup',
        assetRebuildable: 'tabBtnAssetRebuildable'
      };
      const btn = document.getElementById(tabBtnMap[moduleKey]);
      if (btn) {
        if (newStatus) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
      }
    }

    loadAdminUsersList();
  } catch (e) {
    console.error('Error toggling admin module permission:', e);
    showToast('خطا در تغییر دسترسی مدیر', 'error');
  }
}

async function toggleAdminPersonnelAccess(username) {
  return toggleAdminModulePermission(username, 'personnelManage');
}

// ==========================================
// ۱۸.۱. ویرایش اطلاعات، رمز عبور و دسترسی‌های مدیر با حفظ تنظیمات قبلی
// ==========================================
async function openEditAdminModal(username) {
  if (!canAccessAdminManage()) {
    showToast('دسترسی غیرمجاز: تنها کاربر admin یا مدیران مجاز امکان ویرایش مدیران را دارند', 'error');
    return;
  }
  try {
    const admins = await getAdminsList();
    const admin = admins.find(a => a.username === username);
    if (!admin) {
      showToast('مدیر مورد نظر یافت نشد', 'error');
      return;
    }

    // ۱. پر کردن مشخصات اولیه مدیر با حفظ تنظیمات قبلی
    const fullNameInp = document.getElementById('editAdminFullName');
    const userInp = document.getElementById('editAdminUsername');
    const passInp = document.getElementById('editAdminPassword');
    const supSelect = document.getElementById('editAdminSupervision');

    if (fullNameInp) fullNameInp.value = admin.fullName || admin.username;
    if (userInp) userInp.value = admin.username;
    if (passInp) passInp.value = ''; // رمز خالی یعنی حفظ رمز فعلی مدیر

    // ۲. پر کردن لیست سرپرستی‌ها و انتخاب مقدار قبلی
    const supervisions = getStoredSupervisions();
    if (supSelect) {
      supSelect.innerHTML = '<option value="همه سرپرستی‌ها">همه سرپرستی‌ها (کل سازمان)</option>';
      supervisions.forEach((sup) => {
        const opt = document.createElement('option');
        opt.value = sup;
        opt.textContent = sup;
        supSelect.appendChild(opt);
      });
      supSelect.value = admin.supervision || 'همه سرپرستی‌ها';
    }

    // ۳. پر کردن لیست واحدهای وابسته و انتخاب واحد قبلی مدیر
    populateEditAdminUnitsDropdown(admin.unit || 'همه واحدها');

    // ۴. بارگذاری دسترسی‌های قبلی مدیر در چک‌باکس‌ها (حفظ وضعیت پیشین)
    const perms = admin.permissions || {};
    const chkPersonnel = document.getElementById('editPermPersonnelManage');
    const chkOrg = document.getElementById('editPermOrgManage');
    const chkAdmin = document.getElementById('editPermAdminManage');
    const chkBackup = document.getElementById('editPermBackup');
    const chkAsset = document.getElementById('editPermAssetRebuildable');

    if (chkPersonnel) chkPersonnel.checked = !!perms.personnelManage;
    if (chkOrg) chkOrg.checked = !!perms.orgManage;
    if (chkAdmin) chkAdmin.checked = !!perms.adminManage;
    if (chkBackup) chkBackup.checked = !!perms.backup;
    if (chkAsset) chkAsset.checked = (perms.assetRebuildable !== undefined) ? !!perms.assetRebuildable : true;

    // ۵. به‌روزرسانی پیش‌نمایش زنده سطح دسترسی و گشودن مودال
    updateEditAdminScopeHint();
    openModal('editAdminModal');
  } catch (err) {
    console.error('Error opening edit admin modal:', err);
    showToast('خطا در بارگذاری اطلاعات مدیر جهت ویرایش', 'error');
  }
}

function populateEditAdminUnitsDropdown(targetUnit) {
  const supSelect = document.getElementById('editAdminSupervision');
  const unitSelect = document.getElementById('editAdminUnit');
  if (!supSelect || !unitSelect) return;

  const selectedSup = supSelect.value.trim();
  const allUnits = getStoredUnits();

  unitSelect.innerHTML = '';

  if (!selectedSup || selectedSup === 'همه سرپرستی‌ها' || selectedSup === 'کل سرپرستی‌ها') {
    const opt = document.createElement('option');
    opt.value = 'همه واحدها';
    opt.textContent = 'همه واحدها (دسترسی نامحدود به کل سازمان)';
    unitSelect.appendChild(opt);
  } else {
    const allInSupOpt = document.createElement('option');
    allInSupOpt.value = 'همه واحدها';
    allInSupOpt.textContent = 'همه واحدهای این سرپرستی (دسترسی به کل زیرمجموعه)';
    unitSelect.appendChild(allInSupOpt);

    const filteredUnits = allUnits.filter(u => !u.supervision || u.supervision === selectedSup);
    filteredUnits.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = `فقط واحد اختصاصی: ${u.name}`;
      unitSelect.appendChild(opt);
    });

    if (filteredUnits.length === 0) {
      allUnits.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.textContent = `واحد: ${u.name}`;
        unitSelect.appendChild(opt);
      });
    }
  }

  if (targetUnit) {
    unitSelect.value = targetUnit;
  }
}

function onEditAdminSupervisionChange() {
  populateEditAdminUnitsDropdown();
  updateEditAdminScopeHint();
}

function updateEditAdminScopeHint() {
  const supSelect = document.getElementById('editAdminSupervision');
  const unitSelect = document.getElementById('editAdminUnit');
  const hintText = document.getElementById('editAdminScopePreviewText');
  if (!supSelect || !unitSelect || !hintText) return;

  const sup = supSelect.value.trim();
  const unit = unitSelect.value.trim();

  const isGlobalSup = !sup || sup === 'همه سرپرستی‌ها' || sup === 'کل سرپرستی‌ها';
  const isGlobalUnit = !unit || unit === 'همه واحدها' || unit === 'کل واحدها' || unit === 'همه واحدهای سرپرستی';

  let scopePart = '';
  if (isGlobalSup && isGlobalUnit) {
    scopePart = '<span class="text-emerald-400 font-bold">✓ دسترسی سازمانی:</span> دسترسی به تمامی اطلاعات و گراف‌های ثبت‌شده در <strong class="text-slate-100">تمامی سرپرستی‌ها و تمامی واحدهای سازمان</strong>.';
  } else if (!isGlobalSup && isGlobalUnit) {
    scopePart = `<span class="text-blue-400 font-bold">✓ دسترسی سرپرستی:</span> دسترسی به تمامی اطلاعات و گراف‌های ثبت‌شده برای <strong class="text-slate-100">کل واحدهای زیرمجموعه «${sup}»</strong>.`;
  } else if (!isGlobalSup && !isGlobalUnit) {
    scopePart = `<span class="text-amber-400 font-bold">✓ دسترسی تک‌واحدی:</span> منحصراً به اطلاعات ثبت‌شده برای واحد <strong class="text-amber-300 font-extrabold">«${unit}»</strong> در سرپرستی «${sup}».`;
  } else {
    scopePart = `<span class="text-amber-400 font-bold">✓ دسترسی واحد:</span> محدود به واحد «${unit}».`;
  }

  const permPersonnel = document.getElementById('editPermPersonnelManage')?.checked;
  const permOrg = document.getElementById('editPermOrgManage')?.checked;
  const permAdmin = document.getElementById('editPermAdminManage')?.checked;
  const permBackup = document.getElementById('editPermBackup')?.checked;
  const permAsset = document.getElementById('editPermAssetRebuildable')?.checked;

  const selectedModules = [];
  if (permPersonnel) selectedModules.push('بانک اطلاعات پرسنل (تب پرسنل)');
  if (permOrg) selectedModules.push('تعریف سرپرستی‌ها و واحدها');
  if (permAdmin) selectedModules.push('تعریف و سطوح مدیران');
  if (permBackup) selectedModules.push('پشتیبان‌گیری و بازنشانی');
  if (permAsset) selectedModules.push('ماژول asset &Rebuidble');

  let modulesPart = '';
  if (selectedModules.length > 0) {
    modulesPart = `<div class="mt-2 pt-2 border-t border-slate-800 text-[11px] text-teal-300 flex items-center gap-1.5 flex-wrap"><span class="font-bold text-slate-300">ماژول‌های مجاز اعطاشده:</span> ${selectedModules.map(m => `<span class="px-2 py-0.5 rounded bg-teal-950/70 border border-teal-800 font-medium">${m}</span>`).join(' ')}</div>`;
  } else {
    modulesPart = `<div class="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">این مدیر فاقد دسترسی به ماژول‌های ویژه بوده و صرفاً به تب گزارش‌ها دسترسی خواهد داشت.</div>`;
  }

  hintText.innerHTML = `<div>${scopePart}</div>${modulesPart}`;
}

async function handleEditAdminSubmit(e) {
  e.preventDefault();
  if (!canAccessAdminManage()) {
    showToast('دسترسی غیرمجاز: تنها کاربر admin یا مدیران مجاز امکان ویرایش مدیران را دارند', 'error');
    return;
  }
  const username = document.getElementById('editAdminUsername')?.value.trim().toLowerCase();
  const fullName = document.getElementById('editAdminFullName')?.value.trim();
  const newPassword = document.getElementById('editAdminPassword')?.value.trim();
  const supervision = document.getElementById('editAdminSupervision')?.value.trim();
  const unit = document.getElementById('editAdminUnit')?.value.trim();

  const permPersonnel = document.getElementById('editPermPersonnelManage')?.checked || false;
  const permOrg = document.getElementById('editPermOrgManage')?.checked || false;
  const permAdmin = document.getElementById('editPermAdminManage')?.checked || false;
  const permBackup = document.getElementById('editPermBackup')?.checked || false;
  const permAsset = document.getElementById('editPermAssetRebuildable')?.checked || false;

  if (!username) {
    showToast('شناسه کاربری نامعتبر است', 'error');
    return;
  }

  try {
    const admins = await getAdminsList();
    const existing = admins.find(a => a.username === username);
    if (!existing) {
      showToast('مدیر مورد نظر جهت ویرایش یافت نشد', 'error');
      return;
    }

    // بروزرسانی مشخصات با حفظ تنظیمات و مقادیر قبلی
    existing.fullName = fullName || existing.fullName || username;
    if (newPassword) {
      existing.password = newPassword; // فقط در صورت وارد کردن مقدار جدید تغییر می‌کند
    }
    existing.supervision = supervision || existing.supervision || 'همه سرپرستی‌ها';
    existing.unit = unit || existing.unit || 'همه واحدها';
    existing.permissions = {
      personnelManage: permPersonnel,
      orgManage: permOrg,
      adminManage: permAdmin,
      backup: permBackup,
      assetRebuildable: permAsset
    };
    existing.updatedAt = new Date().toISOString();

    await saveAdminUser(existing);

    // اگر مدیر جاری همان کاربر ویرایش‌شده باشد، سشن فعال نیز بلافاصله به‌روزرسانی شود
    if (window.AppState.currentUser && window.AppState.currentUser.username === username) {
      window.AppState.currentUser = { ...existing };
      sessionStorage.setItem('automation_admin_session', JSON.stringify(window.AppState.currentUser));
      const tabBtnMap = {
        personnelManage: 'tabBtnPersonnelManage',
        orgManage: 'tabBtnOrgManage',
        adminManage: 'tabBtnAdminManage',
        backup: 'tabBtnBackup',
        assetRebuildable: 'tabBtnAssetRebuildable'
      };
      Object.keys(tabBtnMap).forEach((key) => {
        const btn = document.getElementById(tabBtnMap[key]);
        if (btn) {
          if (existing.permissions[key]) btn.classList.remove('hidden');
          else btn.classList.add('hidden');
        }
      });
    }

    closeModal('editAdminModal');
    showToast(`اطلاعات و سطوح دسترسی مدیر «${existing.fullName || username}» با موفقیت به‌روزرسانی شد`, 'success');
    loadAdminUsersList();
  } catch (err) {
    console.error('Error saving edited admin:', err);
    showToast('خطا در ذخیره‌سازی تغییرات مدیر', 'error');
  }
}

// ==========================================
// ۱۹. مدیریت سرپرستی‌ها و واحدهای سازمانی (Org Structure)
// ==========================================
const ORG_STRUCTURE_VERSION = 'v3_telecom_tech_workshops';

const DEFAULT_SUPERVISIONS = [
  'سرپرستی مخابرات',
  'سرپرستی خدمات فنی',
  'سرپرستی اتوماسیون کارگاه ها'
];

const DEFAULT_UNITS = [
  // سرپرستی مخابرات
  { name: 'واحد اعلام حریق', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد صوتی و تصویری', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد شبکه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد اسکادا', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد تعمیرگاه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد مراکز تلفن', supervision: 'سرپرستی مخابرات' },

  // سرپرستی خدمات فنی
  { name: 'واحد توزین', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد کارگاه مکانیک', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ابزار دقیق', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ازمایشگاه الکترونیک و کامپیوتر', supervision: 'سرپرستی خدمات فنی' },

  // سرپرستی اتوماسیون کارگاه ها
  { name: 'اتوماسیون نورد', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون کک سازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون فولادسازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آگلومراسیون', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون نیروگاهها', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون انرژی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آبرسانی', supervision: 'سرپرستی اتوماسیون کارگاه ها' }
];

function getStoredSupervisions() {
  try {
    const ver = localStorage.getItem('automation_org_version');
    if (ver !== ORG_STRUCTURE_VERSION) {
      localStorage.setItem('automation_org_version', ORG_STRUCTURE_VERSION);
      localStorage.setItem('automation_supervisions', JSON.stringify(DEFAULT_SUPERVISIONS));
      localStorage.setItem('automation_units', JSON.stringify(DEFAULT_UNITS));
      return [...DEFAULT_SUPERVISIONS];
    }
    const raw = localStorage.getItem('automation_supervisions');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Error reading supervisions', e);
  }
  return [...DEFAULT_SUPERVISIONS];
}

function saveStoredSupervisions(list) {
  localStorage.setItem('automation_supervisions', JSON.stringify(list));
  populateOrgDropdowns();
  renderOrgManagementUI();
}

function getStoredUnits() {
  try {
    const ver = localStorage.getItem('automation_org_version');
    if (ver !== ORG_STRUCTURE_VERSION) {
      localStorage.setItem('automation_org_version', ORG_STRUCTURE_VERSION);
      localStorage.setItem('automation_supervisions', JSON.stringify(DEFAULT_SUPERVISIONS));
      localStorage.setItem('automation_units', JSON.stringify(DEFAULT_UNITS));
      return [...DEFAULT_UNITS];
    }
    const raw = localStorage.getItem('automation_units');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((u) => (typeof u === 'string' ? { name: u, supervision: '' } : u));
      }
    }
  } catch (e) {
    console.error('Error reading units', e);
  }
  return [...DEFAULT_UNITS];
}

function saveStoredUnits(list) {
  localStorage.setItem('automation_units', JSON.stringify(list));
  populateOrgDropdowns();
  renderOrgManagementUI();
}

function handleCreateSupervision(e) {
  if (e) e.preventDefault();
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: تنها کاربر admin یا مدیران مجاز امکان تعریف سرپرستی‌ها و واحدها را دارند', 'error');
    return;
  }
  const input = document.getElementById('newSupervisionInput');
  const name = input ? input.value.trim() : '';
  if (!name) {
    showToast('لطفاً عنوان سرپرستی را وارد کنید', 'error');
    return;
  }
  const current = getStoredSupervisions();
  if (current.includes(name)) {
    showToast('این سرپرستی قبلاً در سامانه ثبت شده است', 'warning');
    return;
  }
  current.push(name);
  saveStoredSupervisions(current);
  if (input) input.value = '';
  showToast(`سرپرستی «${name}» با موفقیت اضافه شد`, 'success');
}

function handleDeleteSupervision(index) {
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز حذف سرپرستی‌ها را ندارید', 'error');
    return;
  }
  const current = getStoredSupervisions();
  const item = current[index];
  if (!item) return;
  if (confirm(`آیا از حذف سرپرستی «${item}» اطمینان دارید؟`)) {
    current.splice(index, 1);
    saveStoredSupervisions(current);
    showToast(`سرپرستی «${item}» حذف گردید`, 'info');
  }
}

function handleEditSupervision(index) {
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز ویرایش سرپرستی‌ها را ندارید', 'error');
    return;
  }
  const current = getStoredSupervisions();
  const item = current[index];
  if (!item) return;
  const newName = prompt('عنوان جدید سرپرستی را وارد نمایید:', item);
  if (newName && newName.trim() && newName.trim() !== item) {
    const cleanName = newName.trim();
    current[index] = cleanName;
    const units = getStoredUnits();
    units.forEach((u) => {
      if (u.supervision === item) u.supervision = cleanName;
    });
    localStorage.setItem('automation_units', JSON.stringify(units));
    saveStoredSupervisions(current);
    showToast('عنوان سرپرستی با موفقیت ویرایش شد', 'success');
  }
}

function handleCreateUnit(e) {
  if (e) e.preventDefault();
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: تنها کاربر admin یا مدیران مجاز امکان تعریف واحدها را دارند', 'error');
    return;
  }
  const input = document.getElementById('newUnitInput');
  const supSelect = document.getElementById('newUnitSupervisionSelect');
  const name = input ? input.value.trim() : '';
  const supervision = supSelect ? supSelect.value : '';

  if (!name) {
    showToast('لطفاً عنوان واحد سازمانی را وارد نمایید', 'error');
    return;
  }
  const current = getStoredUnits();
  if (current.some((u) => u.name === name)) {
    showToast('این واحد قبلاً در سامانه تعریف شده است', 'warning');
    return;
  }
  current.push({ name, supervision });
  saveStoredUnits(current);
  if (input) input.value = '';
  showToast(`واحد سازمانی «${name}» با موفقیت افزوده شد`, 'success');
}

function handleDeleteUnit(index) {
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز حذف واحدها را ندارید', 'error');
    return;
  }
  const current = getStoredUnits();
  const item = current[index];
  if (!item) return;
  if (confirm(`آیا از حذف واحد «${item.name}» اطمینان دارید؟`)) {
    current.splice(index, 1);
    saveStoredUnits(current);
    showToast(`واحد «${item.name}» حذف گردید`, 'info');
  }
}

function handleEditUnit(index) {
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز ویرایش واحدها را ندارید', 'error');
    return;
  }
  const current = getStoredUnits();
  const item = current[index];
  if (!item) return;
  const newName = prompt('عنوان جدید واحد سازمانی را وارد نمایید:', item.name);
  if (newName && newName.trim() && newName.trim() !== item.name) {
    current[index].name = newName.trim();
    saveStoredUnits(current);
    showToast('عنوان واحد با موفقیت ویرایش شد', 'success');
  }
}

function resetOrgStructureToDefault() {
  if (!canAccessOrgManage()) {
    showToast('دسترسی غیرمجاز: شما مجوز بازنشانی ساختار سازمانی را ندارید', 'error');
    return;
  }
  if (confirm('آیا از بازنشانی سرپرستی‌ها و واحدها به مقادیر پیش‌فرض اطمینان دارید؟')) {
    localStorage.setItem('automation_org_version', ORG_STRUCTURE_VERSION);
    saveStoredSupervisions([...DEFAULT_SUPERVISIONS]);
    saveStoredUnits([...DEFAULT_UNITS]);
    showToast('ساختار سازمانی به حالت پیش‌فرض بازنشانی شد', 'success');
  }
}

function renderOrgManagementUI() {
  const supContainer = document.getElementById('supervisionsListContainer');
  const unitContainer = document.getElementById('unitsListContainer');
  const supCountBadge = document.getElementById('supervisionsCountBadge');
  const unitCountBadge = document.getElementById('unitsCountBadge');
  const supSelectInUnitForm = document.getElementById('newUnitSupervisionSelect');

  const supervisions = getStoredSupervisions();
  const units = getStoredUnits();

  if (supCountBadge) supCountBadge.textContent = `${supervisions.length} سرپرستی`;
  if (unitCountBadge) unitCountBadge.textContent = `${units.length} واحد`;

  // رندر لیست سرپرستی‌ها
  if (supContainer) {
    supContainer.innerHTML = '';
    if (supervisions.length === 0) {
      supContainer.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">هیچ سرپرستی‌ای ثبت نشده است.</div>';
    } else {
      supervisions.forEach((sup, idx) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition';
        itemEl.innerHTML = `
          <div class="flex items-center gap-2.5">
            <span class="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs flex items-center justify-center font-mono font-bold">${idx + 1}</span>
            <span class="text-sm font-semibold text-slate-200">${sup}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="handleEditSupervision(${idx})" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-amber-300 hover:bg-slate-700 transition" title="ویرایش">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button type="button" onclick="handleDeleteSupervision(${idx})" class="p-1.5 rounded-lg bg-red-950/60 text-red-400 hover:bg-red-900 hover:text-red-200 transition" title="حذف">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        `;
        supContainer.appendChild(itemEl);
      });
    }
  }

  // رندر انتخاب سرپرستی والد در فرم واحد جدید
  if (supSelectInUnitForm) {
    const prevVal = supSelectInUnitForm.value;
    supSelectInUnitForm.innerHTML = '<option value="">-- بدون سرپرستی والد (مستقل) --</option>';
    supervisions.forEach((sup) => {
      const opt = document.createElement('option');
      opt.value = sup;
      opt.textContent = sup;
      supSelectInUnitForm.appendChild(opt);
    });
    if (prevVal) supSelectInUnitForm.value = prevVal;
  }

  // رندر لیست واحدها
  if (unitContainer) {
    unitContainer.innerHTML = '';
    if (units.length === 0) {
      unitContainer.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">هیچ واحدی ثبت نشده است.</div>';
    } else {
      units.forEach((unit, idx) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition';
        itemEl.innerHTML = `
          <div>
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs flex items-center justify-center font-mono font-bold">${idx + 1}</span>
              <span class="text-sm font-semibold text-slate-200">${unit.name}</span>
            </div>
            ${unit.supervision ? `<div class="text-xs text-slate-400 font-sans mt-0.5 pr-8">سرپرستی: ${unit.supervision}</div>` : ''}
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="handleEditUnit(${idx})" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-amber-300 hover:bg-slate-700 transition" title="ویرایش">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button type="button" onclick="handleDeleteUnit(${idx})" class="p-1.5 rounded-lg bg-red-950/60 text-red-400 hover:bg-red-900 hover:text-red-200 transition" title="حذف">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        `;
        unitContainer.appendChild(itemEl);
      });
    }
  }
}

function updateModalUnitsDropdown(preserveValue) {
  const modalSupSelect = document.getElementById('modalSupervision');
  const modalUnitSelect = document.getElementById('modalUnit');
  if (!modalUnitSelect) return;

  const selectedSup = modalSupSelect ? modalSupSelect.value.trim() : '';
  const allUnits = getStoredUnits();
  const curVal = preserveValue !== undefined ? preserveValue : modalUnitSelect.value;

  modalUnitSelect.innerHTML = '<option value="">-- انتخاب واحد خدمتی --</option>';

  const filteredUnits = selectedSup
    ? allUnits.filter((u) => !u.supervision || u.supervision === selectedSup)
    : allUnits;

  if (filteredUnits.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = selectedSup
      ? 'واحدی برای این سرپرستی توسط مدیر تعریف نشده است'
      : 'هیچ واحدی توسط مدیر ثبت نشده است';
    modalUnitSelect.appendChild(opt);
  } else {
    filteredUnits.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.supervision && !selectedSup ? `${u.name} (${u.supervision})` : u.name;
      modalUnitSelect.appendChild(opt);
    });
  }

  if (curVal && filteredUnits.some((u) => u.name === curVal)) {
    modalUnitSelect.value = curVal;
  } else if (curVal) {
    const opt = document.createElement('option');
    opt.value = curVal;
    opt.textContent = curVal;
    modalUnitSelect.appendChild(opt);
    modalUnitSelect.value = curVal;
  }
}

function populateOrgDropdowns() {
  const supervisions = getStoredSupervisions();
  const units = getStoredUnits();

  // ۱. نوار انتخاب سرپرستی در مشخصات پرسنلی
  const modalSupSelect = document.getElementById('modalSupervision');
  if (modalSupSelect) {
    const curVal = modalSupSelect.value;
    modalSupSelect.innerHTML = '<option value="">-- انتخاب سرپرستی مربوطه --</option>';
    if (supervisions.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.textContent = 'هیچ سرپرستی‌ای توسط مدیر تعریف نشده است';
      modalSupSelect.appendChild(opt);
    } else {
      supervisions.forEach((sup) => {
        const opt = document.createElement('option');
        opt.value = sup;
        opt.textContent = sup;
        modalSupSelect.appendChild(opt);
      });
    }
    if (curVal && supervisions.includes(curVal)) {
      modalSupSelect.value = curVal;
    }
  }

  // ۲. نوار انتخاب واحد در مشخصات پرسنلی
  updateModalUnitsDropdown();

  // ۳. هماهنگ‌سازی منوهای فیلتر گزارش‌های پنل ادمین
  updateAdminFilterDropdowns();

  // ۴. تعریف مدیر جدید - گزینه‌های سرپرستی و هماهنگ‌سازی پویای واحدها
  const newAdminSupSelect = document.getElementById('newAdminSupervision');
  if (newAdminSupSelect) {
    const curVal = newAdminSupSelect.value;
    newAdminSupSelect.innerHTML = '<option value="همه سرپرستی‌ها">همه سرپرستی‌ها (کل سازمان)</option>';
    supervisions.forEach((sup) => {
      const opt = document.createElement('option');
      opt.value = sup;
      opt.textContent = sup;
      newAdminSupSelect.appendChild(opt);
    });
    if (curVal && (curVal === 'همه سرپرستی‌ها' || supervisions.includes(curVal))) {
      newAdminSupSelect.value = curVal;
    }
    // به‌روزرسانی پویای منوی واحدهای وابسته و راهنمای محدوده دسترسی
    onNewAdminSupervisionChange();
  }
}

function preparePersonnelModal() {
  populateOrgDropdowns();
  populatePersonnelDatalist();
  const op = window.AppState.operator;
  if (op) {
    const fn = document.getElementById('modalFirstName');
    const ln = document.getElementById('modalLastName');
    const fath = document.getElementById('modalFatherName');
    const pid = document.getElementById('modalPersonnelId');
    const sup = document.getElementById('modalSupervision');
    const role = document.getElementById('modalRole');

    if (pid) pid.value = op.personnelId || '';
    if (fn) fn.value = op.firstName || '';
    if (ln) ln.value = op.lastName || '';
    if (fath) fath.value = op.fatherName || '';
    if (sup && op.supervision) sup.value = op.supervision;
    updateModalUnitsDropdown(op.unit || '');
    if (role) role.value = op.role || '';

    if (op.personnelId) {
      handleModalPersonnelInput(op.personnelId);
    }
  } else {
    updateModalUnitsDropdown('');
    const badge = document.getElementById('modalPersonnelMatchBadge');
    if (badge) {
      badge.innerHTML = '<span class="text-slate-400 text-[11px]">با وارد کردن شماره پرسنلی یا انتخاب از لیست، نام، نام خانوادگی و نام پدر به صورت خودکار تکمیل می‌شود.</span>';
    }
  }
}

// ==========================================
// ۲۰. سیستم اعلان‌ها (Toasts) و مودال‌ها
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  let bg = 'bg-slate-800 text-slate-100 border-slate-700';
  let icon = '<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  if (type === 'success') {
    bg = 'bg-emerald-950/95 text-emerald-100 border-emerald-600';
    icon = '<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
  } else if (type === 'error') {
    bg = 'bg-red-950/95 text-red-100 border-red-600';
    icon = '<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
  } else if (type === 'warning') {
    bg = 'bg-amber-950/95 text-amber-100 border-amber-600';
    icon = '<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
  }

  toast.className = `flex items-center gap-3 p-3.5 rounded-xl border shadow-xl text-sm font-medium transition-all transform duration-300 translate-y-2 opacity-0 ${bg}`;
  toast.innerHTML = `
    <div class="shrink-0">${icon}</div>
    <div class="flex-1 text-right leading-snug">${message}</div>
    <button type="button" class="text-slate-400 hover:text-slate-200" onclick="this.parentElement.remove()">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    if (id === 'personnelModal') {
      preparePersonnelModal();
    } else if (id === 'loginModal') {
      const loginForm = document.getElementById('adminLoginForm');
      if (loginForm) loginForm.reset();
      const userInp = document.getElementById('loginUsername');
      const passInp = document.getElementById('loginPassword');
      if (userInp) userInp.value = '';
      if (passInp) passInp.value = '';
    }
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

// ==========================================
// ۲۱. آماده‌سازی PWA و نصب روی موبایل و رایانه
// ==========================================
function handlePWAInstallClick() {
  if (window.pwaDeferredPrompt) {
    triggerDirectInstall();
  } else {
    if (typeof openModal === 'function') {
      openModal('pwaInstallModal');
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isAndroid = /Android/.test(navigator.userAgent);
      if (isIOS) switchInstallTab('ios');
      else if (isAndroid) switchInstallTab('android');
      else switchInstallTab('desktop');
    }
  }
}

async function triggerDirectInstall() {
  if (window.pwaDeferredPrompt) {
    try {
      window.pwaDeferredPrompt.prompt();
      const { outcome } = await window.pwaDeferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('برنامه با موفقیت در حال نصب روی دستگاه شما است', 'success');
        const btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.classList.add('hidden');
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.classList.add('hidden');
        closeModal('pwaInstallModal');
      }
      window.pwaDeferredPrompt = null;
    } catch (e) {
      console.warn('[PWA] Prompt error:', e);
      openModal('pwaInstallModal');
    }
  } else {
    openModal('pwaInstallModal');
  }
}

function switchInstallTab(tab) {
  const tabs = ['android', 'desktop', 'ios'];
  tabs.forEach((t) => {
    const el = document.getElementById(`installTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const btn = document.getElementById(`installTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    if (el) el.classList.add('hidden');
    if (btn) {
      btn.className = 'pb-2 px-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200';
    }
  });

  const activeEl = document.getElementById(`installTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  const activeBtn = document.getElementById(`installTab${tab.charAt(0).toUpperCase() + tab.slice(1)}Btn`);
  if (activeEl) activeEl.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.className = 'pb-2 px-2 border-b-2 border-amber-500 text-amber-400';
  }
}

function dismissPWABanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.add('hidden');
  localStorage.setItem('pwa_banner_dismissed', 'true');
}

function setupPWAInstall() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;

  const btn = document.getElementById('pwaInstallBtn');
  const badge = document.getElementById('pwaInstalledBadge');
  const banner = document.getElementById('pwaInstallBanner');

  if (isStandalone) {
    if (btn) btn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (banner) banner.classList.add('hidden');
  } else {
    if (btn) btn.classList.remove('hidden');
    const isDismissed = localStorage.getItem('pwa_banner_dismissed') === 'true';
    if (!isDismissed && banner) {
      banner.classList.remove('hidden');
    }
  }

  window.addEventListener('pwaPromptReady', () => {
    console.log('[PWA] Prompt is ready for install');
    const directBox = document.getElementById('pwaDirectInstallBox');
    if (directBox) directBox.classList.remove('hidden');
  });

  window.addEventListener('pwaInstalled', () => {
    if (btn) btn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (banner) banner.classList.add('hidden');
    showToast('نصب اپلیکیشن ثبت گراف با موفقیت تکمیل شد', 'success');
  });

  // ثبت مطمئن و پایدار Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
  }
}

// ==========================================
// ۲۲. آغاز به کار سیستم (Init)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initThemeUI();
  loadOperatorProfile();
  loadPersonnelData();
  populateOrgDropdowns();
  renderOrgManagementUI();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  startAutoGPS();
  setupCameraInput();
  updateNetworkStatusIndicator();
  updatePendingQueueCount();
  setupPWAInstall();
  initAssetRebuildables().then(() => populateAsettDatalist());

  const graphForm = document.getElementById('graphRegistrationForm');
  if (graphForm) graphForm.addEventListener('submit', handleGraphFormSubmit);

  const personnelForm = document.getElementById('personnelProfileForm');
  if (personnelForm) personnelForm.addEventListener('submit', saveOperatorProfile);

  const modalPidInput = document.getElementById('modalPersonnelId');
  if (modalPidInput) {
    ['input', 'change', 'blur', 'paste'].forEach(evt => {
      modalPidInput.addEventListener(evt, () => {
        handleModalPersonnelInput(modalPidInput.value);
      });
    });
  }

  const modalSupSelect = document.getElementById('modalSupervision');
  if (modalSupSelect) {
    modalSupSelect.addEventListener('change', () => updateModalUnitsDropdown());
  }

  const modalUnitSelect = document.getElementById('modalUnit');
  if (modalUnitSelect) {
    modalUnitSelect.addEventListener('change', () => {
      const selectedUnitName = modalUnitSelect.value;
      const modalSup = document.getElementById('modalSupervision');
      if (modalSup && !modalSup.value && selectedUnitName) {
        const allUnits = getStoredUnits();
        const found = allUnits.find((u) => u.name === selectedUnitName);
        if (found && found.supervision) {
          modalSup.value = found.supervision;
          updateModalUnitsDropdown(selectedUnitName);
        }
      }
    });
  }

  const loginForm = document.getElementById('adminLoginForm');
  if (loginForm) loginForm.addEventListener('submit', handleAdminLogin);

  const newAdminForm = document.getElementById('newAdminForm');
  if (newAdminForm) newAdminForm.addEventListener('submit', handleCreateNewAdmin);

  const newSupForm = document.getElementById('newSupervisionForm');
  if (newSupForm) newSupForm.addEventListener('submit', handleCreateSupervision);

  const newUnitForm = document.getElementById('newUnitForm');
  if (newUnitForm) newUnitForm.addEventListener('submit', handleCreateUnit);

  const newPersonnelForm = document.getElementById('newPersonnelForm');
  if (newPersonnelForm) newPersonnelForm.addEventListener('submit', handleNewPersonnelSubmit);

  const restoreInput = document.getElementById('restoreFileInput');
  if (restoreInput) restoreInput.addEventListener('change', handleRestoreFile);

  const addActivityBtn = document.getElementById('addActivityBtn');
  if (addActivityBtn) {
    addActivityBtn.addEventListener('click', (e) => {
      e.preventDefault();
      addSelectedActivity();
    });
  }
});

// ==========================================
// ۲۱. ماژول مدیریت پرسنل (Personnel Management) در پنل مدیریت
// ==========================================
function renderPersonnelTable() {
  const tbody = document.getElementById('personnelTableBody');
  const countText = document.getElementById('personnelFilterCountText');
  const totalBadge = document.getElementById('personnelTotalBadge');
  const pageInfo = document.getElementById('personnelPaginationInfo');
  const paginationControls = document.getElementById('personnelPaginationControls');
  if (!tbody) return;

  if (!window.AppState.personnel || window.AppState.personnel.length === 0) {
    if (window.INITIAL_PERSONNEL_DATA && Array.isArray(window.INITIAL_PERSONNEL_DATA) && window.INITIAL_PERSONNEL_DATA.length > 0) {
      initPersonnelState(window.INITIAL_PERSONNEL_DATA);
    }
  }

  const allPersonnel = window.AppState.personnel || [];
  if (totalBadge) {
    totalBadge.textContent = `${allPersonnel.length.toLocaleString('fa-IR')} پرسنل`;
  }

  if (allPersonnel.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-10 text-center text-slate-400 font-sans">
          <div class="flex flex-col items-center justify-center gap-2">
            <svg class="w-6 h-6 text-amber-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
            <span>در حال بارگذاری اطلاعات بانک پرسنل...</span>
          </div>
        </td>
      </tr>
    `;
    setTimeout(() => {
      if (window.INITIAL_PERSONNEL_DATA && window.INITIAL_PERSONNEL_DATA.length > 0) {
        initPersonnelState(window.INITIAL_PERSONNEL_DATA);
        renderPersonnelTable();
      } else {
        fetch('/personnel-data.json')
          .then((res) => res.json())
          .then((data) => {
            if (data && data.length) {
              window.INITIAL_PERSONNEL_DATA = data;
              initPersonnelState(data);
              renderPersonnelTable();
            }
          })
          .catch(() => {});
      }
    }, 150);
    return;
  }

  const query = (window.AppState.personnelSearchQuery || '').trim().toLowerCase();
  let filtered = allPersonnel;
  if (query) {
    filtered = allPersonnel.filter((p) => {
      const code = String(p.code || '').toLowerCase();
      const name = String(p.name || '').toLowerCase();
      return code.includes(query) || name.includes(query);
    });
  }

  const total = filtered.length;
  const pageSize = window.AppState.personnelPageSize || 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (window.AppState.personnelCurrentPage > totalPages) {
    window.AppState.personnelCurrentPage = totalPages;
  }
  if (window.AppState.personnelCurrentPage < 1) {
    window.AppState.personnelCurrentPage = 1;
  }
  const currentPage = window.AppState.personnelCurrentPage;

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const pageItems = filtered.slice(startIndex, endIndex);

  if (countText) {
    if (query) {
      countText.textContent = `یافت‌شده: ${total.toLocaleString('fa-IR')} از کل ${allPersonnel.length.toLocaleString('fa-IR')} نفر`;
    } else {
      countText.textContent = `نمایش ${startIndex + 1} تا ${endIndex} از کل ${total.toLocaleString('fa-IR')} پرسنل`;
    }
  }

  if (pageInfo) {
    pageInfo.textContent = `صفحه ${currentPage.toLocaleString('fa-IR')} از ${totalPages.toLocaleString('fa-IR')} (تعداد کل: ${total.toLocaleString('fa-IR')})`;
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-10 text-center text-slate-500 font-sans">
          پرسنلی با مشخصات جستجو شده یافت نشد.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems.map((p, idx) => {
      const rowNum = startIndex + idx + 1;
      const safeCode = escapeHtml(p.code);
      const safeName = escapeHtml(p.name);
      return `
        <tr class="hover:bg-slate-800/50 transition border-b border-slate-800/40">
          <td class="py-2.5 px-3 text-center text-slate-500 text-[11px] font-mono">${rowNum}</td>
          <td class="py-2.5 px-4 font-mono font-bold text-amber-300">${safeCode}</td>
          <td class="py-2.5 px-4 text-slate-200 font-medium">${safeName}</td>
          <td class="py-2.5 px-4 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button type="button" onclick="editPersonnelRecord('${safeCode}')" class="px-2 py-1 text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 rounded-lg transition" title="ویرایش نام پرسنل">
                ویرایش
              </button>
              <button type="button" onclick="confirmDeletePersonnel('${safeCode}')" class="px-2 py-1 text-[11px] bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-red-100 border border-red-800/60 rounded-lg transition active:scale-95" title="حذف از بانک پرسنل">
                حذف
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ایجاد دکمه‌های کنترل صفحه‌بندی
  if (paginationControls) {
    let html = '';
    html += `<button type="button" onclick="goToPersonnelPage(1)" ${currentPage === 1 ? 'disabled' : ''} class="px-2 py-1 rounded bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 text-xs">« اول</button>`;
    html += `<button type="button" onclick="goToPersonnelPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 text-xs">قبلی</button>`;

    const startP = Math.max(1, currentPage - 2);
    const endP = Math.min(totalPages, currentPage + 2);
    for (let i = startP; i <= endP; i++) {
      if (i === currentPage) {
        html += `<span class="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-xs">${i.toLocaleString('fa-IR')}</span>`;
      } else {
        html += `<button type="button" onclick="goToPersonnelPage(${i})" class="px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs">${i.toLocaleString('fa-IR')}</button>`;
      }
    }

    html += `<button type="button" onclick="goToPersonnelPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 text-xs">بعدی</button>`;
    html += `<button type="button" onclick="goToPersonnelPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} class="px-2 py-1 rounded bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 text-xs">آخر »</button>`;
    paginationControls.innerHTML = html;
  }
}

function toggleAddPersonnelForm(show) {
  const container = document.getElementById('addPersonnelFormContainer');
  if (!container) return;
  if (show === undefined) {
    container.classList.toggle('hidden');
  } else if (show) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
  if (!container.classList.contains('hidden')) {
    const codeInput = document.getElementById('newPersonnelCode');
    if (codeInput) {
      setTimeout(() => codeInput.focus(), 50);
    }
  }
}

async function handleNewPersonnelSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const codeInput = document.getElementById('newPersonnelCode');
  const nameInput = document.getElementById('newPersonnelName');
  if (!codeInput || !nameInput) return;

  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (!code || !name) {
    showToast('شماره پرسنلی و نام پرسنل الزامی است', 'error');
    return;
  }

  const existing = window.AppState.personnelMap ? window.AppState.personnelMap.get(code) : null;
  if (existing) {
    if (!confirm(`پرسنل با شماره پرسنلی ${code} قبلاً با نام «${existing.name}» ثبت شده است. آیا می‌خواهید اطلاعات به‌روزرسانی شود؟`)) {
      return;
    }
  }

  const newRecord = { code, name };

  // ۱. به‌روزرسانی فوری در حافظه رم
  if (!window.AppState.personnel) window.AppState.personnel = [];
  const existingIdx = window.AppState.personnel.findIndex((p) => String(p.code).trim() === code);
  if (existingIdx >= 0) {
    window.AppState.personnel[existingIdx] = newRecord;
  } else {
    window.AppState.personnel.unshift(newRecord);
  }

  if (window.AppState.personnelMap) {
    window.AppState.personnelMap.set(code, newRecord);
    const unpadded = code.replace(/^0+/, '');
    if (unpadded) window.AppState.personnelMap.set(unpadded, newRecord);
    const padded7 = code.padStart(7, '0');
    if (padded7) window.AppState.personnelMap.set(padded7, newRecord);
  }

  // ۲. پاک‌سازی فرم و بستن پنجره
  codeInput.value = '';
  nameInput.value = '';
  toggleAddPersonnelForm(false);

  // انتقال به صفحه اول بدون فیلتر جهت مشاهده رکورد جدید
  window.AppState.personnelSearchQuery = '';
  const searchInput = document.getElementById('personnelSearchInput');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('clearPersonnelSearchBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  window.AppState.personnelCurrentPage = 1;

  renderPersonnelTable();
  showToast(`پرسنل «${name}» با شماره ${code} با موفقیت ثبت شد`, 'success');

  // ۳. ذخیره در IndexedDB در پس‌زمینه
  try {
    await savePersonnelRecordToDB(newRecord);
  } catch (dbErr) {
    console.warn('Background save new personnel error:', dbErr);
  }
}

function editPersonnelRecord(code) {
  if (!code) return;
  const cleanCode = String(code).trim();
  const p = (window.AppState.personnelMap && window.AppState.personnelMap.get(cleanCode)) ||
            (window.AppState.personnel || []).find((x) => String(x.code).trim() === cleanCode);
  if (!p) return;

  const newName = prompt(`ویرایش نام پرسنل با شماره پرسنلی ${cleanCode}:`, p.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showToast('نام پرسنل نمی‌تواند خالی باشد', 'error');
    return;
  }

  p.name = trimmed;
  if (window.AppState.personnelMap) {
    window.AppState.personnelMap.set(cleanCode, p);
  }
  renderPersonnelTable();
  showToast(`نام پرسنل با موفقیت به «${trimmed}» به‌روزرسانی شد`, 'success');
  savePersonnelRecordToDB(p).catch((e) => console.warn(e));
}

async function confirmDeletePersonnel(code) {
  if (!code) return;
  const cleanCode = String(code).trim();
  const p = (window.AppState.personnelMap && window.AppState.personnelMap.get(cleanCode)) ||
            (window.AppState.personnel || []).find((x) => String(x.code).trim() === cleanCode);
  const name = p ? p.name : cleanCode;

  if (!confirm(`آیا از حذف پرسنل «${name}» با شماره پرسنلی ${cleanCode} اطمینان دارید؟`)) {
    return;
  }

  // ۱. حذف فوری از حافظه رم جهت پاسخدهی آنی
  window.AppState.personnel = (window.AppState.personnel || []).filter((item) => String(item.code).trim() !== cleanCode);
  if (window.AppState.personnelMap) {
    window.AppState.personnelMap.delete(cleanCode);
    const unpadded = cleanCode.replace(/^0+/, '');
    if (unpadded) window.AppState.personnelMap.delete(unpadded);
    const padded7 = cleanCode.padStart(7, '0');
    if (padded7) window.AppState.personnelMap.delete(padded7);
  }

  // ۲. رندر مجدد جدول و نمایش پیام به کاربر
  renderPersonnelTable();
  showToast(`پرسنل «${name}» (${cleanCode}) با موفقیت حذف گردید`, 'info');

  // ۳. حذف پایدار در پس‌زمینه از دیتابیس
  try {
    await deletePersonnelFromDB(cleanCode);
  } catch (dbErr) {
    console.warn('Background delete personnel error:', dbErr);
  }
}

async function confirmResetPersonnelData() {
  if (!confirm('آیا از بازنشانی کامل اطلاعات پرسنل به فایل اولیه اکسل (۷,۵۲۷ رکورد) اطمینان دارید؟ هرگونه تغییر دستی بازنشانی خواهد شد.')) {
    return;
  }
  try {
    let sourceData = window.INITIAL_PERSONNEL_DATA;
    if (!sourceData || !sourceData.length) {
      const res = await fetch('/personnel-data.json');
      sourceData = await res.json();
    }
    await clearPersonnelDB();
    saveMultiplePersonnelToDB(sourceData).catch(() => {});
    window.AppState.personnel = [...sourceData];
    initPersonnelState(window.AppState.personnel);
    window.AppState.personnelCurrentPage = 1;
    renderPersonnelTable();
    showToast('بانک اطلاعات پرسنل با موفقیت به فایل اولیه اکسل بازنشانی شد', 'success');
  } catch (e) {
    console.error('Error resetting personnel data:', e);
    showToast('خطا در بازنشانی اطلاعات پرسنل', 'error');
  }
}

function onPersonnelSearchInput(val) {
  window.AppState.personnelSearchQuery = val || '';
  window.AppState.personnelCurrentPage = 1;
  const clearBtn = document.getElementById('clearPersonnelSearchBtn');
  if (clearBtn) {
    if (val) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderPersonnelTable();
}

function clearPersonnelSearch() {
  const input = document.getElementById('personnelSearchInput');
  if (input) input.value = '';
  onPersonnelSearchInput('');
}

function onPersonnelPageSizeChange(size) {
  window.AppState.personnelPageSize = Number(size) || 50;
  window.AppState.personnelCurrentPage = 1;
  renderPersonnelTable();
}

function goToPersonnelPage(page) {
  window.AppState.personnelCurrentPage = Number(page);
  renderPersonnelTable();
}

// تعاریف نام‌های مستعار برای حذف و سوئیچ تب‌ها
async function deleteRecord(id) {
  return confirmDeleteReport(id);
}

async function deleteAdmin(username) {
  return confirmDeleteAdmin(username);
}

function showAdminTab(tabName) {
  let user = window.AppState && window.AppState.currentUser;
  if (!user) {
    try {
      const session = sessionStorage.getItem('automation_admin_session');
      if (session) user = JSON.parse(session);
    } catch (e) {}
  }
  const isSuper = !user || user.username === 'admin' || user.isSuperAdmin;

  const canOrg = isSuper || !!(user && user.permissions && user.permissions.orgManage);
  const canAdmin = isSuper || !!(user && user.permissions && user.permissions.adminManage);
  const canBackup = isSuper || !!(user && user.permissions && user.permissions.backup);
  const canPersonnel = isSuper || !!(user && user.permissions && user.permissions.personnelManage);
  const canAssetRebuildable = isSuper || (user && user.permissions ? user.permissions.assetRebuildable !== false : true);

  if (tabName === 'orgManage' && !canOrg) tabName = 'reports';
  if (tabName === 'adminManage' && !canAdmin) tabName = 'reports';
  if (tabName === 'backup' && !canBackup) tabName = 'reports';
  if (tabName === 'personnelManage' && !canPersonnel) tabName = 'reports';
  if (tabName === 'assetRebuildable' && !canAssetRebuildable) tabName = 'reports';

  const tabs = ['adminTabReports', 'adminTabOrg', 'adminTabManage', 'adminTabBackup', 'adminTabPersonnel', 'adminTabAssetRebuildable'];
  tabs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const inactiveClass = 'px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition';
  const activeClass = 'px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 border-amber-500 text-amber-400 flex items-center gap-1.5 transition';

  const btnReports = document.getElementById('tabBtnReports');
  const btnOrg = document.getElementById('tabBtnOrgManage');
  const btnManage = document.getElementById('tabBtnAdminManage');
  const btnBackup = document.getElementById('tabBtnBackup');
  const btnPersonnel = document.getElementById('tabBtnPersonnelManage');
  const btnAsset = document.getElementById('tabBtnAssetRebuildable');

  if (btnReports) btnReports.className = inactiveClass;
  if (btnOrg) btnOrg.className = inactiveClass;
  if (btnManage) btnManage.className = inactiveClass;
  if (btnBackup) btnBackup.className = inactiveClass;
  if (btnPersonnel) btnPersonnel.className = inactiveClass;
  if (btnAsset) btnAsset.className = inactiveClass;

  if (tabName === 'reports') {
    const el = document.getElementById('adminTabReports');
    if (el) el.classList.remove('hidden');
    if (btnReports) btnReports.className = activeClass;
  } else if (tabName === 'orgManage' && canOrg) {
    const el = document.getElementById('adminTabOrg');
    if (el) el.classList.remove('hidden');
    if (btnOrg) btnOrg.className = activeClass;
    if (typeof renderOrgManagementUI === 'function') renderOrgManagementUI();
  } else if (tabName === 'adminManage' && canAdmin) {
    const el = document.getElementById('adminTabManage');
    if (el) el.classList.remove('hidden');
    if (btnManage) btnManage.className = activeClass;
  } else if (tabName === 'backup' && canBackup) {
    const el = document.getElementById('adminTabBackup');
    if (el) el.classList.remove('hidden');
    if (btnBackup) btnBackup.className = activeClass;
  } else if (tabName === 'personnelManage' && canPersonnel) {
    const el = document.getElementById('adminTabPersonnel');
    if (el) el.classList.remove('hidden');
    if (btnPersonnel) btnPersonnel.className = activeClass;
    renderPersonnelTable();
  } else if (tabName === 'assetRebuildable') {
    const el = document.getElementById('adminTabAssetRebuildable');
    if (el) el.classList.remove('hidden');
    if (btnAsset) btnAsset.className = 'px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 border-cyan-500 text-cyan-400 flex items-center gap-1.5 transition';
    renderAssetRebuildableUI();
  }
}

// ==========================================
// ۲۲. ماژول بانک اطلاعات تجهیزات و قطعات بازسازی (asset &Rebuidble)
// ==========================================
const DEFAULT_INITIAL_ASSETS = [];

function getUserAssetScope() {
  let user = window.AppState && window.AppState.currentUser;
  if (!user) {
    try {
      const session = sessionStorage.getItem('automation_admin_session');
      if (session) user = JSON.parse(session);
    } catch (e) {}
  }
  const isSuper = !user || user.username === 'admin' || user.isSuperAdmin;
  const userSup = user && user.supervision ? user.supervision.trim() : '';
  const userUnit = user && user.unit ? user.unit.trim() : '';

  const isGlobalSup = isSuper || !userSup || userSup === 'همه سرپرستی‌ها' || userSup === 'کل سرپرستی‌ها';
  const isGlobalUnit = isSuper || !userUnit || userUnit === 'همه واحدها' || userUnit === 'کل واحدها' || userUnit === 'همه واحدهای سرپرستی';

  return {
    user,
    isSuper,
    isGlobalSup,
    isGlobalUnit,
    supervision: userSup,
    unit: userUnit
  };
}

function canUserAccessAssetRecord(record, scope) {
  if (!scope) scope = getUserAssetScope();
  if (scope.isSuper) return true;
  if (scope.isGlobalSup && scope.isGlobalUnit) return true;

  if (!scope.isGlobalSup) {
    if (record.supervision && record.supervision !== scope.supervision) return false;
  }
  if (!scope.isGlobalUnit) {
    if (record.unit && record.unit !== scope.unit) return false;
  }
  return true;
}

async function initAssetRebuildables() {
  let records = await getAllAssetRebuildableRecordsFromDB();
  const defaultRebuildables = [
    'کارت پردازنده اصلی CPU 414-4H',
    'ماژول ورودی/خروجی آنالوگ AI 8x13Bit',
    'پوزیشنر هوشمند Fisher DVC6200',
    'اکچویتور پنوماتیک دیافراگمی 657',
    'فرستنده-گیرنده UHF تله‌متری',
    'پاور ماژولار ریداندنت 12V 450W'
  ];
  if (records && records.length > 0) {
    const toDelete = records.filter(r => defaultRebuildables.includes((r.rebuildable || '').trim()));
    if (toDelete.length > 0) {
      for (const r of toDelete) {
        if (r.id) await deleteAssetRebuildableRecordFromDB(r.id);
      }
      records = records.filter(r => !defaultRebuildables.includes((r.rebuildable || '').trim()));
      localStorage.setItem('automation_asset_rebuildables', JSON.stringify(records));
    }
  }
  window.AppState.assetRecords = records || [];
  await populateAsettDatalist();
  return window.AppState.assetRecords;
}

function updateAssetScopeUI(scope) {
  const badgeText = document.getElementById('assetUserScopeText');
  const supWrapper = document.getElementById('assetSupFilterWrapper');
  const unitWrapper = document.getElementById('assetUnitFilterWrapper');

  if (badgeText) {
    if (scope.isSuper || (scope.isGlobalSup && scope.isGlobalUnit)) {
      badgeText.innerHTML = '<span class="text-emerald-400 font-black">دسترسی نامحدود سازمانی</span> (رویت و مدیریت کل تجهیزات)';
    } else if (!scope.isGlobalSup && scope.isGlobalUnit) {
      badgeText.innerHTML = `سرپرستی: <strong class="text-amber-300">«${escapeHtml(scope.supervision)}»</strong> (تمامی واحدهای زیرمجموعه)`;
    } else {
      badgeText.innerHTML = `سرپرستی: <strong class="text-amber-300">«${escapeHtml(scope.supervision)}»</strong> | واحد: <strong class="text-cyan-300">«${escapeHtml(scope.unit)}»</strong>`;
    }
  }

  if (supWrapper) {
    if (scope.isGlobalSup) {
      supWrapper.classList.remove('hidden');
      supWrapper.classList.add('flex');
    } else {
      supWrapper.classList.add('hidden');
      supWrapper.classList.remove('flex');
    }
  }

  if (unitWrapper) {
    if (scope.isGlobalUnit) {
      unitWrapper.classList.remove('hidden');
      unitWrapper.classList.add('flex');
    } else {
      unitWrapper.classList.add('hidden');
      unitWrapper.classList.remove('flex');
    }
  }
}

function populateAssetFilterDropdowns(scope) {
  const supSelect = document.getElementById('assetFilterSupervision');
  const unitSelect = document.getElementById('assetFilterUnit');

  if (supSelect && scope.isGlobalSup) {
    const supervisions = getStoredSupervisions();
    let optionsHtml = '<option value="همه">همه سرپرستی‌ها</option>';
    supervisions.forEach(s => {
      optionsHtml += `<option value="${escapeHtml(s.title)}">${escapeHtml(s.title)}</option>`;
    });
    supSelect.innerHTML = optionsHtml;
  }

  if (unitSelect) {
    let units = [];
    if (scope.isGlobalSup) {
      units = getStoredUnits();
    } else {
      units = getStoredUnits().filter(u => u.supervision === scope.supervision);
    }
    let optionsHtml = '<option value="همه">همه واحدها</option>';
    units.forEach(u => {
      optionsHtml += `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`;
    });
    unitSelect.innerHTML = optionsHtml;
  }
}

function onAssetFilterSupervisionChange() {
  const supSelect = document.getElementById('assetFilterSupervision');
  const unitSelect = document.getElementById('assetFilterUnit');
  if (supSelect && unitSelect) {
    const selectedSup = supSelect.value;
    let units = getStoredUnits();
    if (selectedSup && selectedSup !== 'همه') {
      units = units.filter(u => u.supervision === selectedSup);
    }
    let optionsHtml = '<option value="همه">همه واحدها</option>';
    units.forEach(u => {
      optionsHtml += `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`;
    });
    unitSelect.innerHTML = optionsHtml;
  }
  applyAssetFiltersAndRender();
}

function onAssetFilterUnitChange() {
  applyAssetFiltersAndRender();
}

function onAssetSearchInput(val) {
  window.AppState.assetSearchQuery = val || '';
  const clearBtn = document.getElementById('clearAssetSearchBtn');
  if (clearBtn) {
    if (val && val.trim().length > 0) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  applyAssetFiltersAndRender();
}

function clearAssetSearch() {
  const input = document.getElementById('assetSearchInput');
  if (input) input.value = '';
  onAssetSearchInput('');
}

async function renderAssetRebuildableUI() {
  await initAssetRebuildables();
  const scope = getUserAssetScope();
  updateAssetScopeUI(scope);
  populateAssetFilterDropdowns(scope);
  applyAssetFiltersAndRender();
}

function applyAssetFiltersAndRender() {
  const scope = getUserAssetScope();
  const allRecords = window.AppState.assetRecords || [];

  // ۱. فیلتر امنیتی سطرها بر اساس حوزه کاربر
  let list = allRecords.filter(r => canUserAccessAssetRecord(r, scope));

  // ۲. فیلتر انتخابی سرپرستی
  const supSelect = document.getElementById('assetFilterSupervision');
  if (supSelect && supSelect.value && supSelect.value !== 'همه') {
    list = list.filter(r => r.supervision === supSelect.value);
  }

  // ۳. فیلتر انتخابی واحد
  const unitSelect = document.getElementById('assetFilterUnit');
  if (unitSelect && unitSelect.value && unitSelect.value !== 'همه') {
    list = list.filter(r => r.unit === unitSelect.value);
  }

  // ۴. فیلتر متن جستجو
  const q = (window.AppState.assetSearchQuery || '').trim().toLowerCase();
  if (q) {
    list = list.filter(r => {
      const assetStr = (r.asset || '').toLowerCase();
      const rebStr = (r.rebuildable || '').toLowerCase();
      const descStr = (r.description || '').toLowerCase();
      const supStr = (r.supervision || '').toLowerCase();
      const unitStr = (r.unit || '').toLowerCase();
      return assetStr.includes(q) || rebStr.includes(q) || descStr.includes(q) || supStr.includes(q) || unitStr.includes(q);
    });
  }

  window.AppState.filteredAssetRecords = list;

  const countEl = document.getElementById('assetRecordsCountText');
  if (countEl) countEl.textContent = list.length.toLocaleString('fa-IR');

  renderAssetRebuildableTable(list, scope);
}

function renderAssetRebuildableTable(list, scope) {
  const tbody = document.getElementById('assetTableBody');
  const paginationInfo = document.getElementById('assetPaginationInfo');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 px-4 text-center">
          <div class="flex flex-col items-center justify-center space-y-3">
            <div class="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-500">
              <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div class="text-sm font-bold text-slate-300">هیچ رکوردی در بانک اطلاعات تجهیزات یافت نشد</div>
            <p class="text-xs text-slate-500 max-w-sm">برای ثبت تجهیز و قطعات بازسازی جدید از دکمه «افزودن ASETT / Rebuildable» یا بارگذاری فایل اکسل استفاده فرمایید.</p>
            <button type="button" onclick="openAddAssetModal()" class="mt-2 px-3.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition">
              + ثبت اولین رکورد برای این واحد
            </button>
          </div>
        </td>
      </tr>
    `;
    if (paginationInfo) paginationInfo.textContent = '۰ رکورد نمایش داده شده است';
    return;
  }

  // شمارش تعداد قطعات هر ASETT جهت نمایش برچسب رابطه‌ای
  const assetCounts = {};
  list.forEach(r => {
    const k = (r.asset || '').trim();
    assetCounts[k] = (assetCounts[k] || 0) + 1;
  });

  let rowsHtml = '';
  list.forEach((r, idx) => {
    const isUserAllowedToMutate = canUserAccessAssetRecord(r, scope);
    const countForAsset = assetCounts[(r.asset || '').trim()] || 1;

    rowsHtml += `
      <tr class="hover:bg-slate-800/40 transition border-b border-slate-800/50">
        <!-- ۱. شماره ردیف -->
        <td class="py-3 px-3 text-center font-mono font-bold text-slate-400 text-xs">
          ${idx + 1}
        </td>

        <!-- ۲. ASETT -->
        <td class="py-3 px-4 font-extrabold text-slate-100">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-slate-100 font-bold">${escapeHtml(r.asset || '---')}</span>
            ${countForAsset > 1 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800 font-mono" title="این تجهیز دارای ${countForAsset} قطعه بازسازی در لیست می‌باشد">${countForAsset} قطعه</span>` : ''}
          </div>
        </td>

        <!-- ۳. Rebuidble -->
        <td class="py-3 px-4">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold text-xs">
            <svg class="w-3 h-3 shrink-0 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/></svg>
            <span>${escapeHtml(r.rebuildable || '---')}</span>
          </span>
        </td>

        <!-- ۴. توضیحات -->
        <td class="py-3 px-4 text-slate-300 leading-relaxed text-xs max-w-xs">
          ${r.description ? escapeHtml(r.description) : '<span class="text-slate-600 font-mono">---</span>'}
        </td>

        <!-- ۵. سرپرستی -->
        <td class="py-3 px-4 text-slate-300 text-xs">
          <span class="inline-block px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 text-[11px] font-medium">
            ${escapeHtml(r.supervision || '---')}
          </span>
        </td>

        <!-- ۶. واحد -->
        <td class="py-3 px-4 text-slate-300 text-xs">
          <span class="inline-block px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 text-[11px] font-medium">
            ${escapeHtml(r.unit || '---')}
          </span>
        </td>

        <!-- عملیات -->
        <td class="py-3 px-3 text-center">
          ${isUserAllowedToMutate ? `
            <div class="inline-flex items-center gap-1">
              <button type="button" onclick="openEditAssetModal(${r.id})" class="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition" title="ویرایش رکورد">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button type="button" onclick="confirmDeleteAssetRecord(${r.id})" class="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition" title="حذف رکورد">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          ` : `
            <span class="text-[10px] text-slate-600 font-mono">فقط خواندنی</span>
          `}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;
  if (paginationInfo) {
    paginationInfo.textContent = `نمایش ${list.length.toLocaleString('fa-IR')} رکورد`;
  }
}

// ==========================================
// عملیات افزودن و ویرایش رکورد با پشتیبانی از چند Rebuidble برای هر ASETT
// ==========================================
function openAddAssetModal() {
  const form = document.getElementById('newAssetRebuildableForm');
  if (form) form.reset();

  const scope = getUserAssetScope();
  const supSelect = document.getElementById('newAssetSupervision');
  const unitSelect = document.getElementById('newAssetUnit');
  const lockNote = document.getElementById('newAssetScopeLockNote');
  const lockText = document.getElementById('newAssetScopeLockNoteText');

  // مقداردهی دراپ‌داون سرپرستی
  if (supSelect) {
    const supervisions = getStoredSupervisions();
    let optionsHtml = '';

    if (!scope.isGlobalSup) {
      // قفل شده به سرپرستی کاربر
      optionsHtml = `<option value="${escapeHtml(scope.supervision)}">${escapeHtml(scope.supervision)}</option>`;
      supSelect.innerHTML = optionsHtml;
      supSelect.value = scope.supervision;
      supSelect.disabled = true;
    } else {
      optionsHtml = '<option value="">-- انتخاب سرپرستی --</option>';
      supervisions.forEach(s => {
        const sName = (typeof s === 'object' && s !== null) ? (s.name || s.title || '') : String(s);
        if (sName) {
          optionsHtml += `<option value="${escapeHtml(sName)}">${escapeHtml(sName)}</option>`;
        }
      });
      supSelect.innerHTML = optionsHtml;
      supSelect.disabled = false;
    }
  }

  // مقداردهی دراپ‌داون واحد
  populateNewAssetUnitsDropdown();

  if (lockNote && lockText) {
    if (!scope.isGlobalSup || !scope.isGlobalUnit) {
      lockNote.classList.remove('hidden');
      lockText.textContent = `توجه: با توجه به سطح دسترسی شما، این رکورد در سرپرستی «${scope.supervision}» و واحد «${scope.unit}» ثبت خواهد شد.`;
    } else {
      lockNote.classList.add('hidden');
    }
  }

  // آماده‌سازی بخش اقلام Rebuildable با یک سطر اولیه
  const container = document.getElementById('rebuildablesContainer');
  if (container) {
    container.innerHTML = '';
    addNewRebuildableItemRow('', '');
  }

  openModal('assetAddModal');
}

function onNewAssetSupervisionChange() {
  populateNewAssetUnitsDropdown();
}

function populateNewAssetUnitsDropdown() {
  const scope = getUserAssetScope();
  const supSelect = document.getElementById('newAssetSupervision');
  const unitSelect = document.getElementById('newAssetUnit');
  if (!unitSelect) return;

  const currentSup = (!scope.isGlobalSup && scope.supervision)
    ? scope.supervision
    : (supSelect ? supSelect.value : '');

  let units = getStoredUnits();
  if (currentSup) {
    units = units.filter(u => u.supervision === currentSup);
  }

  if (!scope.isGlobalUnit && scope.unit) {
    unitSelect.innerHTML = `<option value="${escapeHtml(scope.unit)}">${escapeHtml(scope.unit)}</option>`;
    unitSelect.value = scope.unit;
    unitSelect.disabled = true;
  } else {
    let optionsHtml = '<option value="">-- انتخاب واحد سازمانی --</option>';
    units.forEach(u => {
      optionsHtml += `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`;
    });
    unitSelect.innerHTML = optionsHtml;
    unitSelect.disabled = false;
  }
}

function addNewRebuildableItemRow(initialName = '', initialDesc = '') {
  const container = document.getElementById('rebuildablesContainer');
  if (!container) return;

  const rowCount = container.children.length + 1;
  const rowDiv = document.createElement('div');
  rowDiv.className = 'rebuildable-row p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 relative transition hover:border-slate-700';

  rowDiv.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-bold text-cyan-400 flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
        <span>Rebuidble شماره <strong class="row-num font-mono">${rowCount}</strong></span>
      </span>
      <button type="button" onclick="removeRebuildableItemRow(this)" class="text-rose-400 hover:text-rose-300 text-xs px-2 py-0.5 rounded hover:bg-rose-950/40 transition">
        حذف سطر ✕
      </button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <div>
        <label class="block text-[11px] text-slate-300 mb-1 font-semibold">عنوان یا کد Rebuidble: <span class="text-red-400">*</span></label>
        <input type="text" required value="${escapeHtml(initialName)}" placeholder="عنوان یا کد قطعه بازسازی..." class="rebuildable-name-input w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs text-slate-100 outline-none">
      </div>
      <div>
        <label class="block text-[11px] text-slate-300 mb-1 font-semibold">توضیحات و مشخصات بازسازی:</label>
        <input type="text" value="${escapeHtml(initialDesc)}" placeholder="توضیحات بازسازی (اختیاری)..." class="rebuildable-desc-input w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs text-slate-100 outline-none">
      </div>
    </div>
  `;

  container.appendChild(rowDiv);
  refreshRebuildableRowNumbers();
}

function removeRebuildableItemRow(btn) {
  const container = document.getElementById('rebuildablesContainer');
  if (!container) return;
  const row = btn.closest('.rebuildable-row');
  if (row) {
    if (container.children.length <= 1) {
      showToast('حداقل یک قطعه Rebuidble باید تعریف گردد', 'warning');
      return;
    }
    row.remove();
    refreshRebuildableRowNumbers();
  }
}

function refreshRebuildableRowNumbers() {
  const container = document.getElementById('rebuildablesContainer');
  if (!container) return;
  const rows = container.querySelectorAll('.rebuildable-row');
  rows.forEach((r, idx) => {
    const numEl = r.querySelector('.row-num');
    if (numEl) numEl.textContent = idx + 1;
  });
}

async function handleNewAssetRebuildableSubmit(e) {
  e.preventDefault();
  const scope = getUserAssetScope();

  const supSelect = document.getElementById('newAssetSupervision');
  const unitSelect = document.getElementById('newAssetUnit');
  const assetInput = document.getElementById('newAssetName');

  const supervision = (!scope.isGlobalSup && scope.supervision) ? scope.supervision : (supSelect ? supSelect.value.trim() : '');
  const unit = (!scope.isGlobalUnit && scope.unit) ? scope.unit : (unitSelect ? unitSelect.value.trim() : '');
  const assetName = assetInput ? assetInput.value.trim() : '';

  if (!supervision) {
    showToast('لطفاً سرپرستی را انتخاب فرمایید', 'warning');
    return;
  }
  if (!unit) {
    showToast('لطفاً واحد سازمانی را انتخاب فرمایید', 'warning');
    return;
  }
  if (!assetName) {
    showToast('لطفاً عنوان تجهیز (ASETT) را وارد فرمایید', 'warning');
    return;
  }

  // جمع‌آوری تمامی سطرهای Rebuildable
  const container = document.getElementById('rebuildablesContainer');
  const rows = container ? container.querySelectorAll('.rebuildable-row') : [];
  const recordsToSave = [];

  for (let i = 0; i < rows.length; i++) {
    const nameInput = rows[i].querySelector('.rebuildable-name-input');
    const descInput = rows[i].querySelector('.rebuildable-desc-input');
    const rName = nameInput ? nameInput.value.trim() : '';
    const rDesc = descInput ? descInput.value.trim() : '';

    if (!rName) {
      showToast(`عنوان Rebuidble در سطر ${i + 1} الزامی است`, 'warning');
      if (nameInput) nameInput.focus();
      return;
    }

    recordsToSave.push({
      asset: assetName,
      rebuildable: rName,
      description: rDesc,
      supervision: supervision,
      unit: unit,
      createdAt: new Date().toISOString()
    });
  }

  if (recordsToSave.length === 0) {
    showToast('حداقل یک قطعه Rebuidble باید مشخص شود', 'warning');
    return;
  }

  await saveMultipleAssetRebuildablesToDB(recordsToSave);
  showToast(`تعداد ${recordsToSave.length} قطعه قابل بازسازی برای تجهیز «${assetName}» با موفقیت ذخیره شد`, 'success');
  closeModal('assetAddModal');
  await populateAsettDatalist();
  syncRebuildablesForAsett();
  renderAssetRebuildableUI();
}

function openEditAssetModal(id) {
  const scope = getUserAssetScope();
  const record = (window.AppState.assetRecords || []).find(r => r.id === id);
  if (!record) {
    showToast('رکورد مورد نظر یافت نشد', 'error');
    return;
  }

  if (!canUserAccessAssetRecord(record, scope)) {
    showToast('شما مجاز به ویرایش این رکورد نیستید', 'error');
    return;
  }

  document.getElementById('editAssetId').value = record.id;
  document.getElementById('editAssetName').value = record.asset || '';
  document.getElementById('editAssetRebuildableName').value = record.rebuildable || '';
  document.getElementById('editAssetDescription').value = record.description || '';

  const supSelect = document.getElementById('editAssetSupervision');
  const unitSelect = document.getElementById('editAssetUnit');

  if (supSelect) {
    const supervisions = getStoredSupervisions();
    if (!scope.isGlobalSup) {
      supSelect.innerHTML = `<option value="${escapeHtml(scope.supervision)}">${escapeHtml(scope.supervision)}</option>`;
      supSelect.value = scope.supervision;
      supSelect.disabled = true;
    } else {
      let optionsHtml = '<option value="">-- انتخاب سرپرستی --</option>';
      supervisions.forEach(s => {
        const sName = (typeof s === 'object' && s !== null) ? (s.name || s.title || '') : String(s);
        if (sName) {
          optionsHtml += `<option value="${escapeHtml(sName)}">${escapeHtml(sName)}</option>`;
        }
      });
      supSelect.innerHTML = optionsHtml;
      supSelect.value = record.supervision || '';
      supSelect.disabled = false;
    }
  }

  if (unitSelect) {
    if (!scope.isGlobalUnit) {
      unitSelect.innerHTML = `<option value="${escapeHtml(scope.unit)}">${escapeHtml(scope.unit)}</option>`;
      unitSelect.value = scope.unit;
      unitSelect.disabled = true;
    } else {
      const units = getStoredUnits();
      let optionsHtml = '';
      units.forEach(u => {
        optionsHtml += `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`;
      });
      unitSelect.innerHTML = optionsHtml;
      unitSelect.value = record.unit || '';
      unitSelect.disabled = false;
    }
  }

  openModal('assetEditModal');
}

function onEditAssetSupervisionChange() {
  const supSelect = document.getElementById('editAssetSupervision');
  const unitSelect = document.getElementById('editAssetUnit');
  if (supSelect && unitSelect) {
    const units = getStoredUnits().filter(u => u.supervision === supSelect.value);
    let optionsHtml = '';
    units.forEach(u => {
      optionsHtml += `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`;
    });
    unitSelect.innerHTML = optionsHtml;
  }
}

async function handleEditAssetSubmit(e) {
  e.preventDefault();
  const id = Number(document.getElementById('editAssetId').value);
  const scope = getUserAssetScope();

  const record = (window.AppState.assetRecords || []).find(r => r.id === id);
  if (!record || !canUserAccessAssetRecord(record, scope)) {
    showToast('شما مجاز به ویرایش این رکورد نیستید', 'error');
    return;
  }

  const supSelect = document.getElementById('editAssetSupervision');
  const unitSelect = document.getElementById('editAssetUnit');

  record.asset = document.getElementById('editAssetName').value.trim();
  record.rebuildable = document.getElementById('editAssetRebuildableName').value.trim();
  record.description = document.getElementById('editAssetDescription').value.trim();

  if (scope.isGlobalSup && supSelect) record.supervision = supSelect.value.trim();
  if (scope.isGlobalUnit && unitSelect) record.unit = unitSelect.value.trim();

  await saveAssetRebuildableRecordToDB(record);
  showToast('رکورد با موفقیت به‌روزرسانی شد', 'success');
  closeModal('assetEditModal');
  await populateAsettDatalist();
  syncRebuildablesForAsett();
  renderAssetRebuildableUI();
}

async function confirmDeleteAssetRecord(id) {
  const scope = getUserAssetScope();
  const record = (window.AppState.assetRecords || []).find(r => r.id === id);
  if (!record) return;

  if (!canUserAccessAssetRecord(record, scope)) {
    showToast('شما فقط مجاز به حذف رکوردهای مربوط به سرپرستی و واحد خود هستید', 'error');
    return;
  }

  const msg = `آیا از حذف قطعه بازسازی «${record.rebuildable}» متعلق به تجهیز «${record.asset}» اطمینان دارید؟`;
  if (!confirm(msg)) return;

  await deleteAssetRebuildableRecordFromDB(id);
  window.AppState.assetRecords = (window.AppState.assetRecords || []).filter(r => r.id !== id);
  showToast('رکورد با موفقیت حذف گردید', 'success');
  await populateAsettDatalist();
  syncRebuildablesForAsett();
  applyAssetFiltersAndRender();
}

// ==========================================
// صادر کردن و وارد کردن فایل اکسل (Excel Import / Export)
// ==========================================
function exportAssetRebuildablesToExcel() {
  const list = window.AppState.filteredAssetRecords || [];
  if (list.length === 0) {
    showToast('رکوردی جهت استخراج به اکسل یافت نشد', 'warning');
    return;
  }

  const aoa = [
    ['شماره ردیف', 'ASETT', 'Rebuidble', 'توضیحات', 'سرپرستی', 'واحد']
  ];

  list.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      r.asset || '',
      r.rebuildable || '',
      r.description || '',
      r.supervision || '',
      r.unit || ''
    ]);
  });

  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws['!cols'] = [
      { wch: 12 }, // شماره ردیف
      { wch: 32 }, // ASETT
      { wch: 32 }, // Rebuidble
      { wch: 50 }, // توضیحات
      { wch: 28 }, // سرپرستی
      { wch: 28 }  // واحد
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Asset_Rebuildables');
    const todayStr = getFormattedJalali().dateNumStr.replace(/\//g, '-');
    XLSX.writeFile(wb, `Asset_Rebuildables_${todayStr}.xlsx`);
    showToast(`فایل اکسل با ${list.length} رکورد با موفقیت ایجاد شد`, 'success');
  } else {
    // خروجی CSV سازگار
    let csv = '\uFEFF' + aoa.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Asset_Rebuildables.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('فایل با موفقیت بارگیری شد', 'success');
  }
}

function downloadAssetExcelTemplate() {
  const scope = getUserAssetScope();
  const sampleSup = (!scope.isGlobalSup && scope.supervision) ? scope.supervision : 'سرپرستی ابزار دقیق و اتوماسیون';
  const sampleUnit = (!scope.isGlobalUnit && scope.unit) ? scope.unit : 'واحد نگهداری و تعمیرات';

  const aoa = [
    ['شماره ردیف', 'ASETT', 'Rebuidble', 'توضیحات', 'سرپرستی', 'واحد'],
    [1, 'کمپرسور اطلس کوپکو GA-75', 'المنت فیلتر هوا', 'سرویس هر ۵۰۰۰ ساعت و تعویض با کیت اورجینال', sampleSup, sampleUnit],
    [2, 'کمپرسور اطلس کوپکو GA-75', 'شیر آنلودر', 'بررسی اورینگ‌ها و فنر داخلی', sampleSup, sampleUnit],
    [3, 'ترانسمیتر فشار Rosemount 3051', 'کپسول دیافراگمی هسلوی', 'کالیبراسیون ۵ نقطه‌ای و تست نشتی', sampleSup, sampleUnit]
  ];

  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 32 }, { wch: 50 }, { wch: 28 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Sample_Template');
    XLSX.writeFile(wb, 'Asset_Rebuildables_Template.xlsx');
    showToast('فایل قالب نمونه اکسل دانلود شد', 'info');
  } else {
    let csv = '\uFEFF' + aoa.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Asset_Rebuildables_Template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

async function handleAssetExcelUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const scope = getUserAssetScope();

  try {
    const data = await file.arrayBuffer();
    if (typeof XLSX === 'undefined') {
      showToast('کتابخانه پردازش اکسل بارگذاری نشده است', 'error');
      event.target.value = '';
      return;
    }

    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (!rows || rows.length < 2) {
      showToast('فایل اکسل خالی است یا فاقد سطر داده می‌باشد', 'warning');
      event.target.value = '';
      return;
    }

    // شناسایی ستون‌ها از سطر نخست
    const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase());
    let idxAsset = -1, idxReb = -1, idxDesc = -1, idxSup = -1, idxUnit = -1;

    headerRow.forEach((col, idx) => {
      if (col.includes('asett') || col.includes('asset') || col.includes('تجهیز')) idxAsset = idx;
      else if (col.includes('rebuid') || col.includes('rebuild') || col.includes('قطعه') || col.includes('بازسازی')) idxReb = idx;
      else if (col.includes('توضیح') || col.includes('شرح') || col.includes('desc') || col.includes('note')) idxDesc = idx;
      else if (col.includes('سرپرست') || col.includes('supervision')) idxSup = idx;
      else if (col.includes('واحد') || col.includes('unit')) idxUnit = idx;
    });

    if (idxAsset === -1 && rows[0].length >= 3) {
      idxAsset = 1;
      idxReb = 2;
      idxDesc = 3;
      idxSup = 4;
      idxUnit = 5;
    }

    const recordsToImport = [];
    let skippedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const assetName = String(row[idxAsset] || '').trim();
      const rebName = String(row[idxReb] || '').trim();
      const desc = idxDesc !== -1 ? String(row[idxDesc] || '').trim() : '';
      let rowSup = idxSup !== -1 ? String(row[idxSup] || '').trim() : '';
      let rowUnit = idxUnit !== -1 ? String(row[idxUnit] || '').trim() : '';

      if (!assetName && !rebName) continue;

      // بررسی سطح دسترسی کاربر
      if (!scope.isGlobalSup) {
        if (rowSup && rowSup !== scope.supervision) {
          skippedCount++;
          continue;
        }
        rowSup = scope.supervision;
      } else if (!rowSup) {
        rowSup = 'سرپرستی ابزار دقیق و اتوماسیون';
      }

      if (!scope.isGlobalUnit) {
        if (rowUnit && rowUnit !== scope.unit) {
          skippedCount++;
          continue;
        }
        rowUnit = scope.unit;
      } else if (!rowUnit) {
        rowUnit = 'واحد عمومی';
      }

      recordsToImport.push({
        asset: assetName || 'تجهیز نامشخص',
        rebuildable: rebName || 'قطعه نامشخص',
        description: desc,
        supervision: rowSup,
        unit: rowUnit,
        createdAt: new Date().toISOString(),
        importedFromExcel: true
      });
    }

    if (recordsToImport.length === 0) {
      if (skippedCount > 0) {
        showToast(`هیچ رکوردی منطبق با حوزه سرپرستی و واحد شما یافت نشد (${skippedCount} سطر مغایر با دسترسی نادیده گرفته شد)`, 'warning');
      } else {
        showToast('رکوردی جهت واردسازی از اکسل یافت نشد', 'warning');
      }
      event.target.value = '';
      return;
    }

    await saveMultipleAssetRebuildablesToDB(recordsToImport);
    showToast(`تعداد ${recordsToImport.length} رکورد با موفقیت از اکسل وارد گردید` + (skippedCount > 0 ? ` (${skippedCount} سطر خارج از دسترسی فیلتر شد)` : ''), 'success');
    event.target.value = '';
    await populateAsettDatalist();
    syncRebuildablesForAsett();
    renderAssetRebuildableUI();
  } catch (err) {
    console.error('Error importing excel:', err);
    showToast('خطا در پردازش فایل اکسل', 'error');
    event.target.value = '';
  }
}

// صادر کردن تمام توابع عمومی و رویدادها در شیء پنجره مرورگر (window)
window.addSelectedActivity = addSelectedActivity;
window.removeAddedActivity = removeAddedActivity;
window.renderAddedActivitiesList = renderAddedActivitiesList;
window.handleActivityChange = handleActivityChange;
window.openPhotoViewerModal = openPhotoViewerModal;
window.closePhotoViewerModal = closePhotoViewerModal;
window.removeSinglePhoto = removeSinglePhoto;
window.removeAllCapturedPhotos = removeAllCapturedPhotos;
window.removeCapturedImage = removeCapturedImage;
window.renderImagePreview = renderImagePreview;
window.addColleague = addColleague;
window.removeColleague = removeColleague;
window.handleColleagueInput = handleColleagueInput;
window.findPersonnelByCode = findPersonnelByCode;
window.renderColleaguesList = renderColleaguesList;
window.clearQrField = clearQrField;
window.handleAsettInput = handleAsettInput;
window.openQrScannerModal = openQrScannerModal;
window.closeQrScannerModal = closeQrScannerModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.toggleTheme = toggleTheme;
window.updateGPSLocation = updateGPSLocation;
window.startAutoGPS = startAutoGPS;
window.switchToHomeView = switchToHomeView;
window.syncPendingRecords = syncPendingRecords;
window.exportToExcel = exportToExcel;
window.printReportsAsPDF = printReportsAsPDF;
window.exportFullBackup = exportFullBackup;
window.resetAdminFilters = resetAdminFilters;
window.resetOrgStructureToDefault = resetOrgStructureToDefault;
window.handleAdminLogout = handleAdminLogout;
window.openAdminAccess = openAdminAccess;
window.closeAdminWelcomeBanner = closeAdminWelcomeBanner;
window.showDetailModal = showDetailModal;
window.deleteRecord = deleteRecord;
window.confirmDeleteReport = confirmDeleteReport;
window.deleteAdmin = deleteAdmin;
window.confirmDeleteAdmin = confirmDeleteAdmin;
window.toggleAdminPersonnelAccess = toggleAdminPersonnelAccess;
window.toggleAdminModulePermission = toggleAdminModulePermission;
window.openEditAdminModal = openEditAdminModal;
window.populateEditAdminUnitsDropdown = populateEditAdminUnitsDropdown;
window.onEditAdminSupervisionChange = onEditAdminSupervisionChange;
window.updateEditAdminScopeHint = updateEditAdminScopeHint;
window.handleEditAdminSubmit = handleEditAdminSubmit;
window.updateNewAdminScopeHint = updateNewAdminScopeHint;
window.handleDeleteSupervision = handleDeleteSupervision;
window.handleEditSupervision = handleEditSupervision;
window.handleDeleteUnit = handleDeleteUnit;
window.handleEditUnit = handleEditUnit;
window.showAdminTab = showAdminTab;
window.renderPersonnelTable = renderPersonnelTable;
window.toggleAddPersonnelForm = toggleAddPersonnelForm;
window.handleNewPersonnelSubmit = handleNewPersonnelSubmit;
window.editPersonnelRecord = editPersonnelRecord;
window.confirmDeletePersonnel = confirmDeletePersonnel;
window.confirmResetPersonnelData = confirmResetPersonnelData;
window.onPersonnelSearchInput = onPersonnelSearchInput;
window.clearPersonnelSearch = clearPersonnelSearch;
window.onPersonnelPageSizeChange = onPersonnelPageSizeChange;
window.goToPersonnelPage = goToPersonnelPage;
window.switchInstallTab = switchInstallTab;
window.handlePWAInstallClick = handlePWAInstallClick;
window.triggerDirectInstall = triggerDirectInstall;
window.dismissPWABanner = dismissPWABanner;
// توابع ماژول asset &Rebuidble
window.renderAssetRebuildableUI = renderAssetRebuildableUI;
window.openAddAssetModal = openAddAssetModal;
window.onNewAssetSupervisionChange = onNewAssetSupervisionChange;
window.addNewRebuildableItemRow = addNewRebuildableItemRow;
window.removeRebuildableItemRow = removeRebuildableItemRow;
window.handleNewAssetRebuildableSubmit = handleNewAssetRebuildableSubmit;
window.openEditAssetModal = openEditAssetModal;
window.onEditAssetSupervisionChange = onEditAssetSupervisionChange;
window.handleEditAssetSubmit = handleEditAssetSubmit;
window.confirmDeleteAssetRecord = confirmDeleteAssetRecord;
window.exportAssetRebuildablesToExcel = exportAssetRebuildablesToExcel;
window.downloadAssetExcelTemplate = downloadAssetExcelTemplate;
window.handleAssetExcelUpload = handleAssetExcelUpload;
window.onAssetSearchInput = onAssetSearchInput;
window.clearAssetSearch = clearAssetSearch;
window.onAssetFilterSupervisionChange = onAssetFilterSupervisionChange;
window.onAssetFilterUnitChange = onAssetFilterUnitChange;
window.handleRebuildableSelectChange = handleRebuildableSelectChange;
window.clearRebuildableSelection = clearRebuildableSelection;
window.syncRebuildablesForAsett = syncRebuildablesForAsett;
window.populateAsettDatalist = populateAsettDatalist;

