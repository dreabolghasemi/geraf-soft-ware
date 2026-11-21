# Security Specification — سامانه ثبت فعالیت‌ها (Centralized Firestore Architecture)

## Phase 0: Data Invariants & Access Laws
1. **Verified Identity Law:** Unauthenticated users or accounts with `email_verified != true` cannot read or write ANY collection.
2. **Global Default-Deny Safety Net:** Every unspecified path under `/databases/{database}/documents` is explicitly denied (`allow read, write: if false`).
3. **Path Hardening & Resource-Bounds Law:** All document IDs (`userId`, `adminUid`, `docId`, `shardId`, `graphId`, `personnelCode`) must satisfy `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, length `<= 128`). Every string, array, and nested map field has strict `.size()` and key constraints.
4. **PII Isolation Law:**
   - `/users/{userId}` (`get` only for `isOwner(userId) || isAdmin()`, `list: if false`) protects operator identity records.
   - `/personnel_overrides/{personnelCode}` (`get`/`write` only for `isAdmin()`, `list` only for `isBootstrappedAdmin()`) ensures national IDs and mobile numbers are never exposed to non-admin users.
   - `/graphs/{graphId}` strips `nationalId` and `mobile` from the embedded `operator` snapshot.
5. **No Blanket List / No O(n) Query Lookup Law:**
   - `/org_structure/main` and `/org_catalog/assets_0..assets_9` use deterministic document IDs (`allow get` only; `allow list: if false`), completely eliminating blanket collection scans.
   - `/graphs` `allow list` restricts reads to `resource.data.authorUid == request.auth.uid || isBootstrappedAdmin() || (request.auth.uid in resource.data.authorizedUids)` with ZERO `get()`/`exists()` lookups inside `allow list`.
6. **Immutability & Server Time Law:** `createdAt` and `authorUid` / `createdByUid` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
7. **Admin Privilege Integrity:** Users cannot self-assign admin roles in `/admins/{adminUid}` or mutate `/org_structure/main` unless already verified as `isAdmin()` (via bootstrapped email `eabolghasemi2@gmail.com` with `email_verified == true` or pre-existing `/admins/$(request.auth.uid)` document).
8. **No Plaintext Credentials:** `/admins/{adminUid}` schema forbids `password` or `passwordHash` ghost fields via strict `keys().hasOnly(...)`.

---

## Phase 2: Relationship Mapping (Master Source of Truth)
- **Root Authority:** Bootstrapped admin `eabolghasemi2@gmail.com` (`email_verified == true`) and `/admins/{request.auth.uid}` documents.
- **Organization Config (`/org_structure/main`):** Owned/mutated by Admins; consumed read-only by verified operators.
- **Equipment Catalog (`/org_catalog/assets_0..assets_9`):** Owned/mutated by Admins; consumed read-only by verified operators.
- **Activity Logs (`/graphs/{graphId}`):** Created by verified operators (`authorUid == request.auth.uid`); readable/listable by `authorUid`, `authorizedUids`, or Bootstrapped Admin; deletable/fully editable by `isAdmin()` or creator (limited state sync for creator).
- **Personnel Deltas (`/personnel_overrides/{personnelCode}`):** Owned/readable/writable exclusively by Admins.

---

## Phase 0: The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Unauthenticated Graph Creation:** Request with `auth == null` attempting `create` on `/graphs/g1`.
2. **Email Spoofing (`email_verified: false`):** Request with `auth.token.email == 'eabolghasemi2@gmail.com'` and `auth.token.email_verified == false` attempting `read`/`write` on `/admins/u1`.
3. **Self-Assigned Admin Escalation:** Non-admin user creating `/admins/<ownUid>` with `isSuperAdmin: true`.
4. **Ghost / Shadow Field Injection on Graph:** Operator creating `/graphs/g_shadow` including unexpected field `isVerified: true` or `operator.nationalId: "1234567890"`.
5. **Identity Spoofing on Graph Creation:** Operator (`uid = 'tech_1'`) creating `/graphs/g_spoof` with `authorUid: 'tech_2'`.
6. **Immutable Field Tampering on Update:** Operator updating own `/graphs/g1` trying to alter `authorUid` or `createdAt` or `operator.personnelId` (blocked by `affectedKeys().hasOnly(...)` + immutability check).
7. **Timestamp Forgery:** Operator creating `/graphs/g_time` with client-supplied `createdAt: "2020-01-01T00:00:00Z"` instead of `serverTimestamp()` (`request.time`).
8. **Document ID Poisoning:** Attacker attempting `setDoc` on `/graphs/<150-char-invalid@id#with$chars>`.
9. **Denial-of-Wallet Oversized String / Array:** Operator submitting `/graphs/g_huge` with `reportNotes` > 2000 chars or `photos.size() > 5` or `photos[0].size() > 650000`.
10. **PII Blanket Read on `/users` & `/personnel_overrides`:** Non-admin authenticated user attempting `get` on `/users/other_uid` or `/personnel_overrides/417734` or `list` on `/users` or `/personnel_overrides`.
11. **Non-Admin Org/Catalog Hijack:** Regular operator attempting `update` on `/org_structure/main` or `/org_catalog/assets_0`.
12. **Blanket Query Scraping on `/graphs`:** Regular operator (`uid = 'tech_1'`) issuing unfiltered `getDocs(collection(db, 'graphs'))` without `where('authorUid', '==', 'tech_1')`.
