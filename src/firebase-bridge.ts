import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// ============================================================================
// Firebase Initialization (Using provisioned firestoreDatabaseId)
// ============================================================================
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const BOOTSTRAPPED_ADMIN_EMAIL = 'eabolghasemi2@gmail.com';
export const ORG_STRUCTURE_VERSION = 'v3_telecom_tech_workshops';
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const ASSET_SHARD_SIZE = 500;
const MAX_ASSET_SHARDS = 10;

// ============================================================================
// Structured Error Handling (Mandatory OperationType & FirestoreErrorInfo)
// ============================================================================
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (errMsg.includes('Quota exceeded')) {
    reportQuotaExceeded(errMsg);
  }
  throw new Error(JSON.stringify(errInfo));
}

function reportQuotaExceeded(msg: string) {
  const projectUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
  console.error('Firestore Quota Exceeded:', msg, projectUrl);
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.showToast === 'function') {
    (w.showToast as (m: string, t: string) => void)(
      'سهمیه روزانه دیتابیس مرکزی تکمیل شده است. سهمیه فردا بازنشانی می‌شود.',
      'error'
    );
  }
}

// Startup Connection Validation
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration (the client is offline).');
      return false;
    }
    // Missing/insufficient permissions before sign-in simply confirms network reachability
    return true;
  }
}

void testConnection();

// ============================================================================
// Defensive Payload Sanitizers (Synchronized with firebase-blueprint.json)
// ============================================================================
function sStr(val: unknown, maxLen: number): string {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sInt(val: unknown, min = 0, max = 999999999): number {
  const n = Math.trunc(Number(val) || 0);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const raw = `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return raw.slice(0, 128);
}

function ensureValidId(id: string, fallbackPrefix: string): string {
  const cleaned = String(id || '').trim();
  if (cleaned.length >= 1 && cleaned.length <= 128 && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return makeSafeId(fallbackPrefix);
}

function requireVerifiedUser(): User {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('AUTH_REQUIRED');
  }
  return user;
}

// ============================================================================
// Centralized Cloud Cache & Real-Time Listeners State
// ============================================================================
export interface CloudPermissions {
  orgManage: boolean;
  adminManage: boolean;
  backup: boolean;
  personnelManage: boolean;
  assetRebuildable: boolean;
}

export interface CloudAdminRecord {
  uid: string;
  email?: string;
  username: string;
  fullName: string;
  supervision: string;
  unit: string;
  isSuperAdmin: boolean;
  permissions: CloudPermissions;
  createdByUid: string;
}

export interface OrgUnit {
  name: string;
  supervision: string;
}

export interface OrgStructureData {
  version: string;
  supervisions: string[];
  units: OrgUnit[];
  adminUids: string[];
}

export interface AssetItem {
  id: string;
  asset: string;
  rebuildable: string;
  description: string;
  supervision: string;
  unit: string;
  createdAt?: string;
  importedFromExcel?: boolean;
}

export interface PersonnelOverrideDoc {
  code: string;
  action: 'upsert' | 'delete';
  name: string;
  nationalId?: string;
  mobile?: string;
  management?: string;
  supervision?: string;
  serviceUnit?: string;
  jobTitle?: string;
}

const DEFAULT_SUPERVISIONS: string[] = [
  'سرپرستی مخابرات',
  'سرپرستی خدمات فنی',
  'سرپرستی اتوماسیون کارگاه ها',
];

const DEFAULT_UNITS: OrgUnit[] = [
  { name: 'واحد اعلام حریق', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد صوتی و تصویری', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد شبکه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد اسکادا', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد تعمیرگاه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد مراکز تلفن', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد توزین', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد کارگاه مکانیک', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ابزار دقیق', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ازمایشگاه الکترونیک و کامپیوتر', supervision: 'سرپرستی خدمات فنی' },
  { name: 'اتوماسیون نورد', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون کک سازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون فولادسازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آگلومراسیون', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون نیروگاهها', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون انرژی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آبرسانی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
];

const DEFAULT_ASSETS: AssetItem[] = [
  {
    id: 'def_41030DEMO_SD14',
    asset: '41030DEMO',
    rebuildable: 'SD#14',
    description: 'دتکتور دوداتاق برق  سرپرستی مخابرات   واحد:واحد اعلام حریق',
    supervision: 'سرپرستی مخابرات',
    unit: 'واحد اعلام حریق',
    createdAt: '2026-09-30T00:00:00.000Z',
  },
  {
    id: 'def_14031DEM0_HD15',
    asset: '14031DEM0',
    rebuildable: 'HD#15',
    description: 'دتکتور حرارت اتاق برق  سرپریتی مخابرات   واحد اعلام حریق',
    supervision: 'سرپرستی مخابرات',
    unit: 'واحد اعلام حریق',
    createdAt: '2026-09-30T00:00:00.000Z',
  },
];

interface CloudCache {
  authReady: boolean;
  user: User | null;
  isBootstrappedAdmin: boolean;
  isCloudAdmin: boolean;
  adminProfile: CloudAdminRecord | null;
  graphs: Array<Record<string, unknown>>;
  admins: CloudAdminRecord[];
  orgStructure: OrgStructureData;
  orgDocExists: boolean;
  assetShards: Record<string, AssetItem[]>;
  assets: AssetItem[];
  personnelOverrides: Map<string, PersonnelOverrideDoc>;
  operatorProfile: Record<string, unknown> | null;
  errorHandlers: Array<() => void>;
  unsubs: Unsubscribe[];
}

const cloudCache: CloudCache = {
  authReady: false,
  user: null,
  isBootstrappedAdmin: false,
  isCloudAdmin: false,
  adminProfile: null,
  graphs: [],
  admins: [],
  orgStructure: {
    version: ORG_STRUCTURE_VERSION,
    supervisions: [...DEFAULT_SUPERVISIONS],
    units: [...DEFAULT_UNITS],
    adminUids: [],
  },
  orgDocExists: false,
  assetShards: {},
  assets: [],
  personnelOverrides: new Map(),
  operatorProfile: null,
  errorHandlers: [],
  unsubs: [],
};

function notifyUI(reason: string) {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.onCloudStateSync === 'function') {
    try {
      (w.onCloudStateSync as (r: string) => void)(reason);
    } catch (e) {
      console.warn('onCloudStateSync error:', e);
    }
  }
  window.dispatchEvent(new CustomEvent('cloudDataUpdated', { detail: { reason } }));
}

function clearSubscriptions() {
  while (cloudCache.unsubs.length > 0) {
    const u = cloudCache.unsubs.pop();
    if (u) {
      try {
        u();
      } catch (e) {
        console.warn('Unsubscribe error:', e);
      }
    }
  }
}

function rebuildAssetsFromShards() {
  const combined: AssetItem[] = [];
  for (let i = 0; i < MAX_ASSET_SHARDS; i++) {
    const key = `assets_${i}`;
    if (cloudCache.assetShards[key]) {
      combined.push(...cloudCache.assetShards[key]);
    }
  }
  cloudCache.assets = combined;
}

// ============================================================================
// Authentication & Real-Time Synchronization
// ============================================================================
export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutFromGoogle(): Promise<void> {
  clearSubscriptions();
  await signOut(auth);
}

function attachGraphListener(user: User, isBootstrapped: boolean, isAdmin: boolean) {
  let q;
  if (isBootstrapped) {
    q = query(collection(db, 'graphs'), orderBy('timestamp', 'desc'));
  } else if (isAdmin) {
    q = query(collection(db, 'graphs'), where('authorizedUids', 'array-contains', user.uid));
  } else {
    q = query(collection(db, 'graphs'), where('authorUid', '==', user.uid));
  }

  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows: Array<Record<string, unknown>> = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const photos = Array.isArray(data.photos) ? data.photos : [];
        return {
          ...data,
          id: d.id,
          photo: photos.length > 0 ? photos[0] : null,
        };
      });
      rows.sort((a, b) => Number(b['timestamp'] || 0) - Number(a['timestamp'] || 0));
      cloudCache.graphs = rows;
      notifyUI('graphs');
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'graphs');
    }
  );
  cloudCache.unsubs.push(unsub);
}

function attachAssetShardListener(shardIndex: number) {
  const shardId = `assets_${shardIndex}`;
  if (cloudCache.unsubs.some((fn) => (fn as unknown as { __shardId?: string }).__shardId === shardId)) {
    return;
  }
  const shardRef = doc(db, 'org_catalog', shardId);
  const unsub = onSnapshot(
    shardRef,
    async (snap) => {
      if (snap.exists()) {
        const data = snap.data() as { items?: AssetItem[] };
        cloudCache.assetShards[shardId] = Array.isArray(data.items) ? data.items : [];
        rebuildAssetsFromShards();
        notifyUI('assets');

        // Cascade listen to next shard if current shard is near full
        if (
          cloudCache.assetShards[shardId].length >= ASSET_SHARD_SIZE - 50 &&
          shardIndex + 1 < MAX_ASSET_SHARDS
        ) {
          attachAssetShardListener(shardIndex + 1);
        }
      } else {
        cloudCache.assetShards[shardId] = [];
        if (shardIndex === 0 && (cloudCache.isBootstrappedAdmin || cloudCache.isCloudAdmin)) {
          await saveAllAssetCatalogItems([...DEFAULT_ASSETS]).catch((err) =>
            console.warn('Seed default assets skipped:', err)
          );
        } else if (shardIndex === 0) {
          cloudCache.assetShards[shardId] = [...DEFAULT_ASSETS];
        }
        rebuildAssetsFromShards();
        notifyUI('assets');
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `org_catalog/${shardId}`);
    }
  );
  (unsub as unknown as { __shardId?: string }).__shardId = shardId;
  cloudCache.unsubs.push(unsub);
}

async function setupUserListeners(user: User) {
  clearSubscriptions();

  const isBootstrapped =
    user.emailVerified === true &&
    String(user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

  let adminDoc: CloudAdminRecord | null = null;
  try {
    const aSnap = await getDoc(doc(db, 'admins', user.uid));
    if (aSnap.exists()) {
      adminDoc = aSnap.data() as CloudAdminRecord;
    }
  } catch (err) {
    // Non-admins do not have a doc in /admins/{uid}; only treat permission errors as fatal
    console.warn('Admin doc lookup note:', err);
  }

  cloudCache.isBootstrappedAdmin = isBootstrapped;
  cloudCache.isCloudAdmin = isBootstrapped || adminDoc !== null;
  cloudCache.adminProfile = isBootstrapped
    ? {
        uid: user.uid,
        email: user.email || BOOTSTRAPPED_ADMIN_EMAIL,
        username: 'admin',
        fullName: 'احسان ابوالقاسمی (مدیر نرم افزار )',
        supervision: 'کل سرپرستی‌ها',
        unit: 'کل واحدها',
        isSuperAdmin: true,
        permissions: {
          orgManage: true,
          adminManage: true,
          backup: true,
          personnelManage: true,
          assetRebuildable: true,
        },
        createdByUid: user.uid,
      }
    : adminDoc;

  // 1. User's own active operator profile (/users/{uid})
  const userUnsub = onSnapshot(
    doc(db, 'users', user.uid),
    (snap) => {
      if (snap.exists()) {
        cloudCache.operatorProfile = snap.data() as Record<string, unknown>;
      } else {
        cloudCache.operatorProfile = null;
      }
      notifyUI('operatorProfile');
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    }
  );
  cloudCache.unsubs.push(userUnsub);

  // 2. Singleton Organization Structure (/org_structure/main)
  const orgUnsub = onSnapshot(
    doc(db, 'org_structure', 'main'),
    async (snap) => {
      if (snap.exists()) {
        const d = snap.data() as OrgStructureData;
        cloudCache.orgDocExists = true;
        cloudCache.orgStructure = {
          version: d.version || ORG_STRUCTURE_VERSION,
          supervisions: Array.isArray(d.supervisions) && d.supervisions.length > 0 ? d.supervisions : [...DEFAULT_SUPERVISIONS],
          units: Array.isArray(d.units) && d.units.length > 0 ? d.units : [...DEFAULT_UNITS],
          adminUids: Array.isArray(d.adminUids) ? d.adminUids : [],
        };
      } else {
        cloudCache.orgDocExists = false;
        cloudCache.orgStructure = {
          version: ORG_STRUCTURE_VERSION,
          supervisions: [...DEFAULT_SUPERVISIONS],
          units: [...DEFAULT_UNITS],
          adminUids: [],
        };
        if (isBootstrapped || adminDoc?.isSuperAdmin || adminDoc?.permissions?.orgManage) {
          await saveOrgStructure(cloudCache.orgStructure).catch((err) =>
            console.warn('Initial org_structure seed note:', err)
          );
        }
      }
      notifyUI('orgStructure');
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'org_structure/main');
    }
  );
  cloudCache.unsubs.push(orgUnsub);

  // 3. Equipment & Rebuildable Catalog (/org_catalog/assets_0...)
  attachAssetShardListener(0);

  // 4. Graphs Listener
  attachGraphListener(user, isBootstrapped, cloudCache.isCloudAdmin);

  // 5. Bootstrapped Admin Collections (/admins & /personnel_overrides)
  if (isBootstrapped) {
    const adminsUnsub = onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as CloudAdminRecord);
        cloudCache.admins = list;
        // Keep org_structure.adminUids synchronized so delegated admins can list future graphs
        const nextAdminUids = Array.from(
          new Set(list.map((a) => a.uid).filter((u) => VALID_ID_REGEX.test(u) && !u.startsWith('pending_')))
        ).slice(0, 20);
        const currentAdminUids = cloudCache.orgStructure.adminUids || [];
        if (
          cloudCache.orgDocExists &&
          JSON.stringify(nextAdminUids) !== JSON.stringify(currentAdminUids)
        ) {
          void saveOrgStructure({ ...cloudCache.orgStructure, adminUids: nextAdminUids }).catch(() => {});
        }
        notifyUI('admins');
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'admins');
      }
    );
    cloudCache.unsubs.push(adminsUnsub);

    const personnelUnsub = onSnapshot(
      collection(db, 'personnel_overrides'),
      (snap) => {
        const map = new Map<string, PersonnelOverrideDoc>();
        snap.docs.forEach((d) => {
          const item = d.data() as PersonnelOverrideDoc;
          map.set(String(item.code || d.id).trim(), item);
        });
        cloudCache.personnelOverrides = map;
        notifyUI('personnelOverrides');
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'personnel_overrides');
      }
    );
    cloudCache.unsubs.push(personnelUnsub);
  }
}

onAuthStateChanged(auth, (user) => {
  cloudCache.authReady = true;
  cloudCache.user = user;
  if (!user || !user.emailVerified) {
    clearSubscriptions();
    cloudCache.isBootstrappedAdmin = false;
    cloudCache.isCloudAdmin = false;
    cloudCache.adminProfile = null;
    cloudCache.graphs = [];
    cloudCache.admins = [];
    cloudCache.personnelOverrides = new Map();
    cloudCache.operatorProfile = null;
    cloudCache.assetShards = {};
    cloudCache.assets = [];
    notifyUI('authSignedOut');
    return;
  }

  void setupUserListeners(user).then(() => {
    notifyUI('authSignedIn');
  });
});

// ============================================================================
// CRUD Operations (Strict Blueprint Schema + handleFirestoreError)
// ============================================================================

// --- A. User Active Operator Profile (/users/{uid}) ---
export async function saveUserOperatorProfile(profile: Record<string, unknown>): Promise<void> {
  const user = requireVerifiedUser();
  const path = `users/${user.uid}`;
  const docRef = doc(db, 'users', user.uid);
  const pid = sStr(profile.personnelId || profile.code, 32).replace(/\D/g, '');
  if (!pid) throw new Error('شماره پرسنلی معتبر نیست');

  try {
    const snap = await getDoc(docRef);
    const basePayload: Record<string, unknown> = {
      uid: user.uid,
      personnelId: pid,
      firstName: sStr(profile.firstName, 80),
      lastName: sStr(profile.lastName, 80),
      name: sStr(profile.name || `${profile.firstName || ''} ${profile.lastName || ''}`, 160) || pid,
      fatherName: sStr(profile.fatherName, 80),
      management: sStr(profile.management || 'مدیریت اتوماسیون و ارتباطات', 160),
      supervision: sStr(profile.supervision, 120),
      unit: sStr(profile.unit, 120),
      role: sStr(profile.role, 160),
      email: sStr(user.email, 160),
      updatedAt: serverTimestamp(),
    };

    if (snap.exists()) {
      await updateDoc(docRef, basePayload);
    } else {
      await setDoc(docRef, {
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    }
    cloudCache.operatorProfile = { ...basePayload };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearUserOperatorProfile(): Promise<void> {
  const user = requireVerifiedUser();
  const path = `users/${user.uid}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid));
    cloudCache.operatorProfile = null;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- B. Activity Graphs (/graphs/{graphId}) ---
function buildGraphPayload(
  record: Record<string, unknown>,
  authorUid: string,
  isCreate: boolean
): Record<string, unknown> {
  const rawOp = (record.operator || {}) as Record<string, unknown>;
  // Strictly strip PII (nationalId, mobile) from shared graph documents
  const cleanOperator = {
    personnelId: sStr(rawOp.personnelId || rawOp.code || '0', 32),
    firstName: sStr(rawOp.firstName, 80),
    lastName: sStr(rawOp.lastName, 80),
    name: sStr(rawOp.name || `${rawOp.firstName || ''} ${rawOp.lastName || ''}`, 160) || 'اپراتور',
    fatherName: sStr(rawOp.fatherName, 80),
    management: sStr(rawOp.management || 'مدیریت اتوماسیون و ارتباطات', 160),
    supervision: sStr(rawOp.supervision, 120),
    unit: sStr(rawOp.unit, 120),
    role: sStr(rawOp.role, 160),
  };

  const rawCf = (record.conditionalFields || {}) as Record<string, unknown>;
  const cleanCf: Record<string, string> = {};
  if (rawCf.footage) cleanCf.footage = sStr(rawCf.footage, 64);
  if (rawCf.equipmentId) cleanCf.equipmentId = sStr(rawCf.equipmentId, 120);
  if (rawCf.deviceTag) cleanCf.deviceTag = sStr(rawCf.deviceTag, 120);
  if (rawCf.referenceTool) cleanCf.referenceTool = sStr(rawCf.referenceTool, 160);

  const rawLoc = (record.location || {}) as Record<string, unknown>;
  const cleanLoc: Record<string, unknown> = {
    lat: rawLoc.lat !== null && rawLoc.lat !== undefined ? sStr(rawLoc.lat, 32) : null,
    lng: rawLoc.lng !== null && rawLoc.lng !== undefined ? sStr(rawLoc.lng, 32) : null,
    accuracy: typeof rawLoc.accuracy === 'number' ? rawLoc.accuracy : null,
    timestamp: rawLoc.timestamp ? sStr(rawLoc.timestamp, 64) : null,
    updatedAt: rawLoc.updatedAt ? sStr(rawLoc.updatedAt, 32) : null,
  };

  const rawActs = Array.isArray(record.activities) ? record.activities.slice(0, 30) : [];
  const cleanActs = rawActs.map((a) => {
    const item = (a || {}) as Record<string, unknown>;
    const cf = (item.conditionalFields || {}) as Record<string, unknown>;
    const itemCf: Record<string, string> = {};
    if (cf.footage) itemCf.footage = sStr(cf.footage, 64);
    if (cf.equipmentId) itemCf.equipmentId = sStr(cf.equipmentId, 120);
    if (cf.deviceTag) itemCf.deviceTag = sStr(cf.deviceTag, 120);
    if (cf.referenceTool) itemCf.referenceTool = sStr(cf.referenceTool, 160);
    return {
      type: sStr(item.type || 'فعالیت', 200) || 'فعالیت',
      rebuildable: sStr(item.rebuildable, 200),
      conditionalFields: itemCf,
      durationHours: sInt(item.durationHours, 0, 9999),
      durationMinutes: sInt(item.durationMinutes, 0, 59),
      durationSeconds: sInt(item.durationSeconds, 0, 59),
      durationTotalSeconds: sInt(item.durationTotalSeconds, 0),
      durationFormatted: sStr(item.durationFormatted, 120),
      durationDigital: sStr(item.durationDigital, 32),
      durationMethod: sStr(item.durationMethod || 'دستی', 64),
    };
  });
  if (cleanActs.length === 0) {
    cleanActs.push({
      type: sStr(record.activityType || 'سایر موارد', 200) || 'سایر موارد',
      rebuildable: sStr(record.rebuildable, 200),
      conditionalFields: {},
      durationHours: 0,
      durationMinutes: 0,
      durationSeconds: 0,
      durationTotalSeconds: 0,
      durationFormatted: '',
      durationDigital: '',
      durationMethod: 'دستی',
    });
  }

  const rawColleagues = Array.isArray(record.colleagues) ? record.colleagues.slice(0, 20) : [];
  const cleanColleagues = rawColleagues.map((c) => {
    if (typeof c === 'object' && c !== null) {
      const obj = c as Record<string, unknown>;
      return { code: sStr(obj.code, 32), name: sStr(obj.name, 120) };
    }
    return sStr(c, 160);
  });

  const rawPhotos = Array.isArray(record.photos)
    ? record.photos
    : record.photo
      ? [record.photo]
      : [];
  const cleanPhotos = rawPhotos
    .map((p) => String(p || ''))
    .filter((p) => p.length > 0 && p.length <= 650000)
    .slice(0, 5);

  const photosByteSize = cleanPhotos.reduce((acc, p) => acc + p.length, 0);
  if (photosByteSize > 850000) {
    throw new Error('حجم کل تصاویر انتخاب‌شده از سقف مجاز پایگاه داده مرکزی (حدود ۸۵۰ کیلوبایت) بیشتر است. لطفاً تعداد عکس کمتری پیوست کنید.');
  }

  const syncStatus = record.syncStatus === 'pending' ? 'pending' : 'synced';
  const authorizedUids = (cloudCache.orgStructure.adminUids || [])
    .map((u) => sStr(u, 128))
    .filter((u) => VALID_ID_REGEX.test(u))
    .slice(0, 20);

  const payload: Record<string, unknown> = {
    authorUid,
    authorizedUids,
    timestamp: Number(record.timestamp) || Date.now(),
    jalaliDate: sStr(record.jalaliDate, 32),
    jalaliTime: sStr(record.jalaliTime, 32),
    jalaliFull: sStr(record.jalaliFull, 120),
    operator: cleanOperator,
    asett: sStr(record.asett, 200),
    rebuildable: sStr(record.rebuildable, 200) || 'نامشخص',
    photos: cleanPhotos,
    reportNotes: sStr(record.reportNotes, 2000),
    activityType: sStr(record.activityType, 500) || cleanActs[0].type,
    activities: cleanActs,
    conditionalFields: cleanCf,
    colleagues: cleanColleagues,
    location: cleanLoc,
    durationHours: sInt(record.durationHours, 0, 9999),
    durationMinutes: sInt(record.durationMinutes, 0, 59),
    durationSeconds: sInt(record.durationSeconds, 0, 59),
    durationTotalSeconds: sInt(record.durationTotalSeconds, 0),
    durationFormatted: sStr(record.durationFormatted, 120),
    durationDigital: sStr(record.durationDigital, 32),
    durationMethod: sStr(record.durationMethod || 'دستی', 64),
    syncStatus,
    syncedAt: record.syncedAt ? sStr(record.syncedAt, 64) : null,
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export async function saveGraphRecord(record: Record<string, unknown>): Promise<string> {
  const user = requireVerifiedUser();
  const payload = buildGraphPayload(record, user.uid, true);
  try {
    const ref = await addDoc(collection(db, 'graphs'), payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'graphs');
  }
}

export async function getAllGraphRecords(): Promise<Array<Record<string, unknown>>> {
  const user = requireVerifiedUser();
  try {
    let q;
    if (cloudCache.isBootstrappedAdmin) {
      q = query(collection(db, 'graphs'), orderBy('timestamp', 'desc'));
    } else if (cloudCache.isCloudAdmin) {
      q = query(collection(db, 'graphs'), where('authorizedUids', 'array-contains', user.uid));
    } else {
      q = query(collection(db, 'graphs'), where('authorUid', '==', user.uid));
    }
    const snap = await getDocs(q);
    const rows: Array<Record<string, unknown>> = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const photos = Array.isArray(data.photos) ? data.photos : [];
      return {
        ...data,
        id: d.id,
        photo: photos.length > 0 ? photos[0] : null,
      };
    });
    rows.sort((a, b) => Number(b['timestamp'] || 0) - Number(a['timestamp'] || 0));
    cloudCache.graphs = rows;
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'graphs');
  }
}

export async function updateGraphRecord(record: Record<string, unknown>): Promise<string> {
  const user = requireVerifiedUser();
  const rawId = record.id ? String(record.id).trim() : '';
  const docId = rawId && VALID_ID_REGEX.test(rawId) ? rawId : '';

  if (!docId) {
    return saveGraphRecord(record);
  }

  const path = `graphs/${docId}`;
  const docRef = doc(db, 'graphs', docId);
  try {
    const existingSnap = await getDoc(docRef);
    if (!existingSnap.exists()) {
      const createPayload = buildGraphPayload(record, user.uid, true);
      await setDoc(docRef, createPayload);
      return docId;
    }

    const existingData = existingSnap.data() as Record<string, unknown>;
    const authorUid = sStr(existingData.authorUid || user.uid, 128);
    if (cloudCache.isCloudAdmin) {
      const fullUpdate = buildGraphPayload(record, authorUid, false);
      fullUpdate.createdAt = existingData.createdAt || serverTimestamp();
      await updateDoc(docRef, fullUpdate);
    } else {
      await updateDoc(docRef, {
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
        reportNotes: sStr(record.reportNotes ?? existingData.reportNotes, 2000),
        updatedAt: serverTimestamp(),
      });
    }
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteGraphRecord(id: string | number): Promise<void> {
  requireVerifiedUser();
  const docId = ensureValidId(String(id), 'graph');
  const path = `graphs/${docId}`;
  try {
    await deleteDoc(doc(db, 'graphs', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- C. Organization Structure (/org_structure/main) ---
export function getCachedOrgStructure(): OrgStructureData {
  return {
    version: cloudCache.orgStructure.version,
    supervisions: [...cloudCache.orgStructure.supervisions],
    units: cloudCache.orgStructure.units.map((u) => ({ ...u })),
    adminUids: [...cloudCache.orgStructure.adminUids],
  };
}

export async function saveOrgStructure(data: Partial<OrgStructureData>): Promise<void> {
  const user = requireVerifiedUser();
  const path = 'org_structure/main';
  const docRef = doc(db, 'org_structure', 'main');

  const cleanSups = (Array.isArray(data.supervisions) ? data.supervisions : cloudCache.orgStructure.supervisions)
    .map((s) => sStr(s, 150))
    .filter(Boolean)
    .slice(0, 100);

  const cleanUnits = (Array.isArray(data.units) ? data.units : cloudCache.orgStructure.units)
    .map((u) => ({
      name: sStr(u?.name, 150),
      supervision: sStr(u?.supervision, 150),
    }))
    .filter((u) => u.name.length > 0)
    .slice(0, 250);

  const cleanAdminUids = (Array.isArray(data.adminUids) ? data.adminUids : cloudCache.orgStructure.adminUids)
    .map((u) => sStr(u, 128))
    .filter((u) => VALID_ID_REGEX.test(u))
    .slice(0, 20);

  try {
    const snap = await getDoc(docRef);
    const payload: Record<string, unknown> = {
      version: sStr(data.version || ORG_STRUCTURE_VERSION, 80) || ORG_STRUCTURE_VERSION,
      supervisions: cleanSups,
      units: cleanUnits,
      adminUids: cleanAdminUids,
      updatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    };
    if (snap.exists()) {
      await updateDoc(docRef, payload);
    } else {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    cloudCache.orgDocExists = true;
    cloudCache.orgStructure = {
      version: payload.version as string,
      supervisions: cleanSups,
      units: cleanUnits,
      adminUids: cleanAdminUids,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- D. Equipment & Rebuildable Catalog (/org_catalog/assets_0..assets_9) ---
function normalizeAssetItem(r: Partial<AssetItem>): AssetItem {
  return {
    id: ensureValidId(String(r.id || ''), 'asset'),
    asset: sStr(r.asset || 'تجهیز نامشخص', 200) || 'تجهیز نامشخص',
    rebuildable: sStr(r.rebuildable || 'قطعه نامشخص', 200) || 'قطعه نامشخص',
    description: sStr(r.description, 500),
    supervision: sStr(r.supervision, 150),
    unit: sStr(r.unit, 150),
    createdAt: sStr(r.createdAt || new Date().toISOString(), 64),
    importedFromExcel: Boolean(r.importedFromExcel),
  };
}

export async function getAllAssetCatalogItems(): Promise<AssetItem[]> {
  requireVerifiedUser();
  try {
    const loaded: AssetItem[] = [];
    for (let i = 0; i < MAX_ASSET_SHARDS; i++) {
      const shardId = `assets_${i}`;
      const snap = await getDoc(doc(db, 'org_catalog', shardId));
      if (!snap.exists()) break;
      const items = (snap.data()?.items || []) as AssetItem[];
      cloudCache.assetShards[shardId] = items;
      loaded.push(...items);
      if (items.length < ASSET_SHARD_SIZE) break;
    }
    cloudCache.assets = loaded;
    return loaded;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'org_catalog/assets_0');
  }
}

export async function saveAllAssetCatalogItems(allItems: Array<Partial<AssetItem>>): Promise<void> {
  const user = requireVerifiedUser();
  const normalized = allItems.map(normalizeAssetItem);
  const shardCount = Math.max(1, Math.min(MAX_ASSET_SHARDS, Math.ceil(normalized.length / ASSET_SHARD_SIZE)));

  for (let i = 0; i < shardCount; i++) {
    const shardId = `assets_${i}`;
    const slice = normalized.slice(i * ASSET_SHARD_SIZE, (i + 1) * ASSET_SHARD_SIZE);
    const path = `org_catalog/${shardId}`;
    const ref = doc(db, 'org_catalog', shardId);
    try {
      const snap = await getDoc(ref);
      const payload: Record<string, unknown> = {
        items: slice,
        count: slice.length,
        updatedByUid: user.uid,
        updatedAt: serverTimestamp(),
      };
      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      cloudCache.assetShards[shardId] = slice;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // Delete empty trailing shards if catalog shrank
  for (let i = shardCount; i < MAX_ASSET_SHARDS; i++) {
    const shardId = `assets_${i}`;
    if (cloudCache.assetShards[shardId]) {
      try {
        await deleteDoc(doc(db, 'org_catalog', shardId));
        delete cloudCache.assetShards[shardId];
      } catch {
        // ignore missing
      }
    }
  }
  rebuildAssetsFromShards();
}

export async function saveAssetRebuildableRecord(record: Partial<AssetItem>): Promise<string> {
  const item = normalizeAssetItem(record);
  const list = [...cloudCache.assets];
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    list[idx] = item;
  } else {
    list.push(item);
  }
  await saveAllAssetCatalogItems(list);
  return item.id;
}

export async function saveMultipleAssetRebuildables(records: Array<Partial<AssetItem>>): Promise<void> {
  const current = [...cloudCache.assets];
  for (const r of records) {
    const item = normalizeAssetItem(r);
    const idx = current.findIndex((x) => x.id === item.id);
    if (idx >= 0) current[idx] = item;
    else current.push(item);
  }
  await saveAllAssetCatalogItems(current);
}

export async function deleteAssetRebuildableRecord(id: string | number): Promise<void> {
  const targetId = String(id).trim();
  const next = cloudCache.assets.filter((x) => String(x.id) !== targetId);
  await saveAllAssetCatalogItems(next);
}

// --- E. Admins Registry (/admins/{adminUid}) ---
export async function getAdminsList(): Promise<CloudAdminRecord[]> {
  requireVerifiedUser();
  if (!cloudCache.isBootstrappedAdmin) {
    return cloudCache.adminProfile ? [cloudCache.adminProfile] : [];
  }
  try {
    const snap = await getDocs(collection(db, 'admins'));
    const list = snap.docs.map((d) => d.data() as CloudAdminRecord);
    cloudCache.admins = list;
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admins');
  }
}

export async function saveAdminUser(admin: Partial<CloudAdminRecord>): Promise<void> {
  const user = requireVerifiedUser();
  const username = sStr(admin.username, 64).toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
  if (!username) throw new Error('نام کاربری معتبر نیست');
  const targetUid = ensureValidId(admin.uid || `pending_${username}`, 'admin');
  const path = `admins/${targetUid}`;
  const docRef = doc(db, 'admins', targetUid);

  const perms: CloudPermissions = {
    orgManage: Boolean(admin.permissions?.orgManage),
    adminManage: Boolean(admin.permissions?.adminManage),
    backup: Boolean(admin.permissions?.backup),
    personnelManage: Boolean(admin.permissions?.personnelManage),
    assetRebuildable: admin.permissions?.assetRebuildable !== false,
  };

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, {
        fullName: sStr(admin.fullName || username, 160),
        email: sStr(admin.email, 160),
        supervision: sStr(admin.supervision || 'همه سرپرستی‌ها', 120),
        unit: sStr(admin.unit || 'همه واحدها', 120),
        isSuperAdmin: Boolean(admin.isSuperAdmin),
        permissions: perms,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        uid: targetUid,
        email: sStr(admin.email, 160),
        username,
        fullName: sStr(admin.fullName || username, 160),
        supervision: sStr(admin.supervision || 'همه سرپرستی‌ها', 120),
        unit: sStr(admin.unit || 'همه واحدها', 120),
        isSuperAdmin: Boolean(admin.isSuperAdmin),
        permissions: perms,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAdminUser(uidOrUsername: string): Promise<void> {
  requireVerifiedUser();
  const match = cloudCache.admins.find(
    (a) => a.uid === uidOrUsername || a.username === uidOrUsername
  );
  const targetId = ensureValidId(match ? match.uid : uidOrUsername, 'admin');
  const path = `admins/${targetId}`;
  try {
    await deleteDoc(doc(db, 'admins', targetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- F. Personnel Catalog Overrides (/personnel_overrides/{code}) ---
export async function savePersonnelOverride(
  record: Partial<PersonnelOverrideDoc>,
  action: 'upsert' | 'delete' = 'upsert'
): Promise<void> {
  const user = requireVerifiedUser();
  const rawCode = sStr(record.code, 32)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const code = rawCode.replace(/\D/g, '');
  if (!code || !VALID_ID_REGEX.test(code)) {
    throw new Error('شماره پرسنلی معتبر نیست (از ارقام لاتین/فارسی استفاده کنید)');
  }
  const path = `personnel_overrides/${code}`;
  const docRef = doc(db, 'personnel_overrides', code);

  try {
    const snap = await getDoc(docRef);
    const payload: Record<string, unknown> = {
      code,
      action,
      name: sStr(record.name || code, 160) || code,
      nationalId: sStr(record.nationalId, 20),
      mobile: sStr(record.mobile, 24),
      management: sStr(record.management || 'مدیریت اتوماسیون و ارتباطات', 160),
      supervision: sStr(record.supervision, 120),
      serviceUnit: sStr(record.serviceUnit, 120),
      jobTitle: sStr(record.jobTitle, 160),
      updatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    };
    if (snap.exists()) {
      await updateDoc(docRef, payload);
    } else {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function resetPersonnelOverrides(): Promise<void> {
  requireVerifiedUser();
  try {
    const snap = await getDocs(collection(db, 'personnel_overrides'));
    for (const d of snap.docs) {
      await deleteDoc(doc(db, 'personnel_overrides', d.id));
    }
    cloudCache.personnelOverrides = new Map();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'personnel_overrides');
  }
}

// ============================================================================
// Global Window API Exposed to app.js & index.html
// ============================================================================
export const CloudDB = {
  getState: () => ({
    authReady: cloudCache.authReady,
    signedIn: Boolean(cloudCache.user && cloudCache.user.emailVerified),
    uid: cloudCache.user?.uid || null,
    email: cloudCache.user?.email || null,
    displayName: cloudCache.user?.displayName || null,
    isBootstrappedAdmin: cloudCache.isBootstrappedAdmin,
    isCloudAdmin: cloudCache.isCloudAdmin,
    adminProfile: cloudCache.adminProfile,
    operatorProfile: cloudCache.operatorProfile,
    graphs: [...cloudCache.graphs],
    admins: [...cloudCache.admins],
    orgStructure: getCachedOrgStructure(),
    assets: [...cloudCache.assets],
    personnelOverrides: Array.from(cloudCache.personnelOverrides.values()),
  }),
  signInGoogle: signInWithGoogle,
  signOutGoogle: signOutFromGoogle,
  testConnection,

  // Operator profile
  saveUserOperatorProfile,
  clearUserOperatorProfile,

  // Graphs
  saveGraphRecord,
  getAllGraphRecords,
  updateGraphRecord,
  deleteGraphRecord,

  // Organization structure
  getOrgStructure: getCachedOrgStructure,
  saveOrgStructure,

  // Asset & Rebuildable catalog
  getAllAssetCatalogItems,
  saveAllAssetCatalogItems,
  saveAssetRebuildableRecord,
  saveMultipleAssetRebuildables,
  deleteAssetRebuildableRecord,

  // Admins
  getAdminsList,
  saveAdminUser,
  deleteAdminUser,

  // Personnel deltas
  savePersonnelOverride,
  resetPersonnelOverrides,
};

declare global {
  interface Window {
    CloudDB: typeof CloudDB;
  }
}

window.CloudDB = CloudDB;
