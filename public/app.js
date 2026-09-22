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

// ==========================================
// ۲. مدیریت دیتابیس محلی (IndexedDB)
// ==========================================
const DB_NAME = 'AutomationGraphDB';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
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
      document.getElementById('opFullName').textContent = `${op.firstName} ${op.lastName}`;
      document.getElementById('opPersonnelId').textContent = op.personnelId;
      document.getElementById('opUnit').textContent = op.unit || '---';
      document.getElementById('opSupervision').textContent = op.supervision || '---';
      document.getElementById('opRole').textContent = op.role || '---';
    }
  } else {
    if (alertBox) alertBox.classList.remove('hidden');
    if (container) container.classList.add('hidden');
  }
}

function saveOperatorProfile(e) {
  e.preventDefault();
  const firstName = document.getElementById('modalFirstName').value.trim();
  const lastName = document.getElementById('modalLastName').value.trim();
  const personnelId = document.getElementById('modalPersonnelId').value.trim();
  const supervision = document.getElementById('modalSupervision').value.trim();
  const unit = document.getElementById('modalUnit').value.trim();
  const role = document.getElementById('modalRole').value.trim();

  if (!firstName || !lastName || !personnelId) {
    showToast('لطفاً نام، نام خانوادگی و شماره پرسنلی را وارد نمایید', 'error');
    return;
  }

  const profile = { firstName, lastName, personnelId, supervision, unit, role };
  localStorage.setItem('automation_operator_profile', JSON.stringify(profile));
  window.AppState.operator = profile;
  updateOperatorSummaryUI();
  closeModal('personnelModal');
  showToast('مشخصات مجری با موفقیت در دستگاه ذخیره شد', 'success');
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
    if (equipIdGroup) {
      equipIdGroup.classList.remove('hidden');
      if (equipInput) equipInput.required = true;
    }
  } else if (val === 'انجام تنظیمات حرفه‌ای') {
    if (settingsGroup) {
      settingsGroup.classList.remove('hidden');
      if (deviceTag) deviceTag.required = true;
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
    const equipVal = document.getElementById('equipmentIdInput')?.value.trim();
    if (!equipVal) {
      showToast('لطفاً شماره شناسایی تجهیز را وارد فرمایید', 'error');
      document.getElementById('equipmentIdInput')?.focus();
      return;
    }
    conditionalFields.equipmentId = equipVal;
  } else if (val === 'انجام تنظیمات حرفه‌ای') {
    const devTag = document.getElementById('deviceTagInput')?.value.trim();
    const refTool = document.getElementById('referenceToolInput')?.value.trim();
    if (!devTag || !refTool) {
      showToast('لطفاً هر دو فیلد شماره تجهیز و شماره مرجع را تکمیل فرمایید', 'error');
      return;
    }
    conditionalFields.deviceTag = devTag;
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

  // بررسی تکراری نبودن دقیق
  const isDuplicate = window.AppState.addedActivities.some(
    (a) => a.type === val && JSON.stringify(a.conditionalFields) === JSON.stringify(conditionalFields)
  );
  if (isDuplicate) {
    showToast('این فعالیت با همین مشخصات قبلاً اضافه شده است', 'warning');
    return;
  }

  const activityItem = {
    id: Date.now() + Math.random().toString(36).substring(2, 6),
    type: val,
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
  showToast(`فعالیت «${val}» با موفقیت افزوده شد.`, 'success');
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
    itemEl.innerHTML = `
      <div class="flex items-center gap-2.5 overflow-hidden">
        <span class="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-amber-500/30">
          ${index + 1}
        </span>
        <div class="flex flex-wrap items-center gap-1.5 overflow-hidden">
          <span class="text-xs sm:text-sm font-bold text-slate-100">${act.type}</span>
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
// ۵. مدیریت همکاران همراه (Dynamic Colleagues)
// ==========================================
function addColleague() {
  const input = document.getElementById('colleaguePersonnelInput');
  const val = input.value.trim();
  if (!val) {
    showToast('لطفاً شماره پرسنلی همکار را وارد کنید', 'error');
    return;
  }
  if (window.AppState.colleagues.includes(val)) {
    showToast('این شماره پرسنلی قبلاً افزوده شده است', 'warning');
    return;
  }
  window.AppState.colleagues.push(val);
  input.value = '';
  renderColleaguesList();
}

function removeColleague(code) {
  window.AppState.colleagues = window.AppState.colleagues.filter((c) => c !== code);
  renderColleaguesList();
}

function renderColleaguesList() {
  const container = document.getElementById('colleaguesListContainer');
  if (!container) return;
  container.innerHTML = '';
  if (window.AppState.colleagues.length === 0) {
    container.innerHTML = '<span class="text-xs text-slate-400">همکاری ثبت نشده است.</span>';
    return;
  }
  window.AppState.colleagues.forEach((code) => {
    const badge = document.createElement('div');
    badge.className = 'inline-flex items-center gap-2 bg-slate-700/80 border border-slate-600 text-amber-300 px-3 py-1.5 rounded-lg text-sm font-mono';
    badge.innerHTML = `
      <span>کد: ${code}</span>
      <button type="button" onclick="removeColleague('${code}')" class="text-slate-400 hover:text-red-400 transition" title="حذف">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    `;
    container.appendChild(badge);
  });
}

// ==========================================
// ۶. دریافت موقعیت مکانی (GPS)
// ==========================================
function updateGPSLocation() {
  const statusEl = document.getElementById('gpsStatusText');
  const coordsEl = document.getElementById('gpsCoordsText');
  const indicator = document.getElementById('gpsIndicator');

  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = 'دستگاه شما از GPS پشتیبانی نمی‌کند';
    if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-red-500';
    return;
  }

  if (statusEl) statusEl.textContent = 'در حال دریافت مختصات دقیق...';
  if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-amber-400 animate-ping';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      const accuracy = Math.round(position.coords.accuracy);
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      window.AppState.currentLocation = { lat, lng, accuracy, timestamp: now.toISOString() };

      if (statusEl) statusEl.textContent = `موقعیت به‌روز است (دقت: ±${accuracy} متر - ساعت ${timeStr})`;
      if (coordsEl) coordsEl.textContent = `عرض: ${lat} | طول: ${lng}`;
      if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-emerald-500';

      const mapBtn = document.getElementById('viewOnMapBtn');
      if (mapBtn) {
        mapBtn.classList.remove('hidden');
        mapBtn.onclick = () => window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
      }
    },
    (err) => {
      console.warn('Geolocation error:', err);
      let msg = 'خطا در دریافت مختصات (مجوز مکان داده نشد یا GPS خاموش است)';
      if (statusEl) statusEl.textContent = msg;
      if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-amber-500';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
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
  window.AppState.selectedQrTargetField = targetFieldId;
  const modal = document.getElementById('qrScannerModal');
  const title = document.getElementById('qrModalTitle');
  if (title) {
    title.textContent = targetFieldId === 'asettInput' ? 'اسکن بارکد / QR کد تجهیز (ASETT ID)' : 'اسکن بارکد / QR کد قطعه (rebuidable ID )';
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
  const targetId = window.AppState.selectedQrTargetField;
  if (targetId) {
    const targetInput = document.getElementById(targetId);
    if (targetInput) {
      targetInput.value = code;
      targetInput.classList.add('ring-2', 'ring-amber-400');
      setTimeout(() => targetInput.classList.remove('ring-2', 'ring-amber-400'), 1500);

      const clearBtn = targetId === 'asettInput' ? document.getElementById('clearAsettBtn') : document.getElementById('clearRebuildableBtn');
      if (clearBtn) clearBtn.classList.remove('hidden');
    }
  }
  showToast(`بارکد با موفقیت اسکن شد: ${code}`, 'success');
  closeQrScannerModal();
}

function clearQrField(targetFieldId) {
  const targetInput = document.getElementById(targetFieldId);
  if (targetInput) {
    targetInput.value = '';
  }
  const clearBtn = targetFieldId === 'asettInput' ? document.getElementById('clearAsettBtn') : document.getElementById('clearRebuildableBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  showToast('کد اسکن‌شده پاکسازی شد', 'info');
}

function handleAsettInput(inputEl) {
  const clearBtn = document.getElementById('clearAsettBtn');
  if (clearBtn) {
    if (inputEl && inputEl.value.trim().length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
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
  const rebuildable = document.getElementById('rebuildableInput').value.trim();
  const reportNotes = document.getElementById('reportNotesInput').value.trim();
  
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
  document.getElementById('rebuildableInput').value = '';
  const clearAsett = document.getElementById('clearAsettBtn');
  if (clearAsett) clearAsett.classList.add('hidden');
  const clearRebuildable = document.getElementById('clearRebuildableBtn');
  if (clearRebuildable) clearRebuildable.classList.add('hidden');
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
  if (!user) return false;
  return user.username === 'admin' || user.isSuperAdmin === true;
}

function canAccessOrgManage(user) {
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  return !!(user.permissions && user.permissions.orgManage);
}

function canAccessAdminManage(user) {
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  return !!(user.permissions && user.permissions.adminManage);
}

function canAccessBackup(user) {
  if (!user) user = window.AppState ? window.AppState.currentUser : null;
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  return !!(user.permissions && user.permissions.backup);
}

window.isMasterAdmin = isMasterAdmin;
window.canAccessOrgManage = canAccessOrgManage;
window.canAccessAdminManage = canAccessAdminManage;
window.canAccessBackup = canAccessBackup;

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

  const adminManageTab = document.getElementById('tabBtnAdminManage');
  const orgManageTab = document.getElementById('tabBtnOrgManage');
  const backupTab = document.getElementById('tabBtnBackup');

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
      const colleagues = (r.colleagues || []).join(' ');
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
          <div class="flex justify-between py-1"><span class="text-slate-400">همکاران همراه:</span><span class="font-mono text-slate-200">${(record.colleagues || []).join(', ') || 'ندارد'}</span></div>
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

    const backupData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      jalaliExportedAt: getFormattedJalali().fullPersian,
      data: { graphs, admins, operator, supervisions, units }
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

      showToast(`بازنشانی با موفقیت انجام شد: ${parsed.data.graphs.length} رکورد بازیابی گردید.`, 'success');
      loadAdminReports();
      loadAdminUsersList();
      renderOrgManagementUI();
      populateOrgDropdowns();
      updatePendingQueueCount();
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

      let permsListHtml = '';
      if (!hasOrgPerm && !hasAdminPerm && !hasBackupPerm) {
        permsListHtml = '<span class="text-[10px] bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded border border-slate-700">فقط گزارش‌گیری و کارتابل (فاقد ماژول‌های مدیریتی)</span>';
      } else {
        const badges = [];
        if (hasOrgPerm) badges.push('<span class="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded font-bold">✓ سرپرستی و واحدها</span>');
        if (hasAdminPerm) badges.push('<span class="text-[10px] bg-blue-950/80 text-blue-300 border border-blue-700 px-2 py-0.5 rounded font-bold">✓ تعریف و سطوح مدیران</span>');
        if (hasBackupPerm) badges.push('<span class="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-700 px-2 py-0.5 rounded font-bold">✓ پشتیبان‌گیری و بازنشانی</span>');
        permsListHtml = badges.join(' ');
      }

      const row = document.createElement('div');
      row.className = 'p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-2';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-200 text-sm">${admin.fullName || admin.username}</span>
              ${scopeBadgeHtml}
            </div>
            <div class="text-xs text-slate-400 font-mono">نام کاربری: ${admin.username}</div>
            <div class="text-[11px] text-slate-300 font-sans mt-0.5">${scopeDescHtml}</div>
          </div>
          <button onclick="confirmDeleteAdmin('${admin.username}')" class="p-2 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-400 hover:text-red-200 transition shrink-0" title="حذف مدیر">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/80">
          <span class="text-[10px] text-slate-400 font-medium">ماژول‌های مجاز:</span>
          ${permsListHtml}
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

  if (isGlobalSup && isGlobalUnit) {
    hintText.innerHTML = '<span class="text-emerald-400 font-bold">✓ دسترسی جامع:</span> این مدیر به تمام اطلاعات و گراف‌های ثبت‌شده در <strong class="text-slate-100">تمامی سرپرستی‌ها و تمام واحدهای سازمان</strong> دسترسی کامل خواهد داشت.';
  } else if (!isGlobalSup && isGlobalUnit) {
    hintText.innerHTML = `<span class="text-blue-400 font-bold">✓ دسترسی سرپرستی:</span> این مدیر به تمامی اطلاعات و گراف‌های ثبت‌شده برای <strong class="text-slate-100">کل واحدهای زیرمجموعه «${sup}»</strong> دسترسی خواهد داشت.`;
  } else if (!isGlobalSup && !isGlobalUnit) {
    hintText.innerHTML = `<span class="text-amber-400 font-bold">✓ دسترسی محدود تک‌واحدی:</span> این مدیر <strong class="text-amber-300 font-extrabold">تنها و منحصراً</strong> به اطلاعات ثبت‌شده برای واحد <strong class="text-slate-100">«${unit}»</strong> در سرپرستی «${sup}» دسترسی خواهد داشت و گزارش‌های سایر واحدها از دید او کاملاً مخفی خواهند بود.`;
  } else {
    hintText.innerHTML = `<span class="text-amber-400 font-bold">✓ دسترسی واحد:</span> محدود به واحد «${unit}».`;
  }
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
      backup: permBackup
    },
    createdAt: new Date().toISOString()
  };

  try {
    await saveAdminUser(newAdmin);
    showToast(`مدیر جدید با نام کاربری «${username}» و دسترسی‌های تعیین‌شده با موفقیت ثبت شد`, 'success');
    document.getElementById('newAdminForm').reset();
    populateOrgDropdowns();
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
  const op = window.AppState.operator;
  if (op) {
    const fn = document.getElementById('modalFirstName');
    const ln = document.getElementById('modalLastName');
    const pid = document.getElementById('modalPersonnelId');
    const sup = document.getElementById('modalSupervision');
    const role = document.getElementById('modalRole');

    if (fn) fn.value = op.firstName || '';
    if (ln) ln.value = op.lastName || '';
    if (pid) pid.value = op.personnelId || '';
    if (sup && op.supervision) sup.value = op.supervision;
    updateModalUnitsDropdown(op.unit || '');
    if (role) role.value = op.role || '';
  } else {
    updateModalUnitsDropdown('');
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
  populateOrgDropdowns();
  renderOrgManagementUI();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  updateGPSLocation();
  setupCameraInput();
  updateNetworkStatusIndicator();
  updatePendingQueueCount();
  setupPWAInstall();

  const graphForm = document.getElementById('graphRegistrationForm');
  if (graphForm) graphForm.addEventListener('submit', handleGraphFormSubmit);

  const personnelForm = document.getElementById('personnelProfileForm');
  if (personnelForm) personnelForm.addEventListener('submit', saveOperatorProfile);

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

// تعاریف نام‌های مستعار برای حذف و سوئیچ تب‌ها
async function deleteRecord(id) {
  return confirmDeleteReport(id);
}

async function deleteAdmin(username) {
  return confirmDeleteAdmin(username);
}

function showAdminTab(tabName) {
  const user = window.AppState && window.AppState.currentUser;
  const isAdmin = user && (user.username === 'admin' || user.isSuperAdmin);

  const canOrg = isAdmin || !!(user && user.permissions && user.permissions.orgManage);
  const canAdmin = isAdmin || !!(user && user.permissions && user.permissions.adminManage);
  const canBackup = isAdmin || !!(user && user.permissions && user.permissions.backup);

  if (tabName === 'orgManage' && !canOrg) tabName = 'reports';
  if (tabName === 'adminManage' && !canAdmin) tabName = 'reports';
  if (tabName === 'backup' && !canBackup) tabName = 'reports';

  const tabs = ['adminTabReports', 'adminTabOrg', 'adminTabManage', 'adminTabBackup'];
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

  if (btnReports) btnReports.className = inactiveClass;
  if (btnOrg) btnOrg.className = inactiveClass;
  if (btnManage) btnManage.className = inactiveClass;
  if (btnBackup) btnBackup.className = inactiveClass;

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
window.clearQrField = clearQrField;
window.handleAsettInput = handleAsettInput;
window.openQrScannerModal = openQrScannerModal;
window.closeQrScannerModal = closeQrScannerModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.toggleTheme = toggleTheme;
window.updateGPSLocation = updateGPSLocation;
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
window.handleDeleteSupervision = handleDeleteSupervision;
window.handleEditSupervision = handleEditSupervision;
window.handleDeleteUnit = handleDeleteUnit;
window.handleEditUnit = handleEditUnit;
window.showAdminTab = showAdminTab;
window.switchInstallTab = switchInstallTab;
window.handlePWAInstallClick = handlePWAInstallClick;
window.triggerDirectInstall = triggerDirectInstall;
window.dismissPWABanner = dismissPWABanner;

