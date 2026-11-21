/**
 * Security TDD Specification Runner for Firestore Rules ("Dirty Dozen" Verification).
 * Evaluates all 12 adversarial payloads against the live ruleset invariants.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: {
    uid: string;
    email?: string;
    email_verified?: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Graph Creation',
    operation: 'create',
    path: '/graphs/g_unauth_1',
    auth: null,
    payload: {
      authorUid: 'anon',
      authorizedUids: [],
      timestamp: Date.now(),
      jalaliDate: '1405/08/29',
      jalaliTime: '10:00:00',
      jalaliFull: 'جمعه ۲۹ آبان ۱۴۰۵',
      operator: { personnelId: '1001', name: 'تست', supervision: 'مخابرات', unit: 'اسکادا' },
      asett: 'A1',
      rebuildable: 'R1',
      photos: [],
      reportNotes: '',
      activityType: 'بازدید',
      activities: [{ type: 'بازدید' }],
      conditionalFields: {},
      colleagues: [],
      location: {},
      durationHours: 0,
      durationMinutes: 10,
      durationSeconds: 0,
      durationTotalSeconds: 600,
      durationFormatted: '۱۰ دقیقه',
      durationDigital: '00:10',
      durationMethod: 'دستی',
      syncStatus: 'synced'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Email Spoofing (email_verified: false)',
    operation: 'get',
    path: '/admins/fake_admin_uid',
    auth: { uid: 'attacker_uid', email: 'eabolghasemi2@gmail.com', email_verified: false },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'Self-Assigned Admin Escalation',
    operation: 'create',
    path: '/admins/attacker_uid',
    auth: { uid: 'attacker_uid', email: 'attacker@gmail.com', email_verified: true },
    payload: {
      uid: 'attacker_uid',
      email: 'attacker@gmail.com',
      username: 'attacker',
      fullName: 'Attacker',
      supervision: 'کل سرپرستی‌ها',
      unit: 'کل واحدها',
      isSuperAdmin: true,
      permissions: {
        orgManage: true,
        adminManage: true,
        backup: true,
        personnelManage: true,
        assetRebuildable: true
      },
      createdByUid: 'attacker_uid'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'Shadow / Ghost Field & PII Injection on Graph',
    operation: 'create',
    path: '/graphs/g_shadow_1',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      authorUid: 'tech_1',
      authorizedUids: [],
      timestamp: Date.now(),
      isVerified: true,
      operator: {
        personnelId: '1001',
        name: 'کاربر تست',
        nationalId: '1280000000',
        mobile: '09130000000'
      },
      asett: 'A1',
      rebuildable: 'R1',
      activityType: 'بازدید'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Identity Spoofing on Graph Creation',
    operation: 'create',
    path: '/graphs/g_spoof_1',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      authorUid: 'tech_2',
      authorizedUids: [],
      timestamp: Date.now(),
      asett: 'A1',
      rebuildable: 'R1',
      activityType: 'بازدید'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Immutable Field Tampering on Graph Update',
    operation: 'update',
    path: '/graphs/g_existing_1',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      authorUid: 'tech_2',
      asett: 'HIJACKED_ASETT'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/graphs/g_time_forgery',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      authorUid: 'tech_1',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Path Variable ID Poisoning',
    operation: 'create',
    path: `/graphs/${'x'.repeat(150)}@invalid`,
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: { authorUid: 'tech_1' },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Denial-of-Wallet Oversized String / Photos Array',
    operation: 'create',
    path: '/graphs/g_oversized',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      authorUid: 'tech_1',
      reportNotes: 'A'.repeat(2500),
      photos: ['1', '2', '3', '4', '5', '6']
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'PII Blanket Read on /users and /personnel_overrides',
    operation: 'get',
    path: '/personnel_overrides/417734',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Non-Admin Org Structure / Catalog Hijack',
    operation: 'update',
    path: '/org_structure/main',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    payload: {
      version: 'hacked',
      supervisions: ['Hacked'],
      units: [],
      adminUids: ['tech_1']
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Unfiltered Blanket Query Scraping on /graphs',
    operation: 'list',
    path: '/graphs',
    auth: { uid: 'tech_1', email: 'tech1@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED'
  }
];
