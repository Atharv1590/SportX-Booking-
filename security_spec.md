# SportX Firestore Security Specification

## 1. Architecture Role
Cloud SQL (PostgreSQL) remains the authoritative relational database for all SportX transactions (student accounts, official roster & bans, 30-day bookings, courts/sports, gate check-ins, OTP dispatches, and light requests). Firestore (`ai-studio-campusarena-15c304c7-52e6-4f80-a5d3-cdf34328a12e`) operates strictly as a **zero-PII real-time synchronization layer** under `/live_sync/{channelId}` (`LivePulse`), updated exclusively by the Express server via `firebase-admin`.

## 2. Data Invariants
1. **Default-Deny Baseline**: Every unspecified collection and subcollection (`/{document=**}`) is strictly denied for all reads and writes.
2. **Zero-PII Isolation**: No student emails, phone numbers, roll numbers, passwords, or booking rosters are stored in publicly readable Firestore documents.
3. **Server-Authoritative Writes Only**: All client SDK writes (`create`, `update`, `delete`) to `/live_sync/{channelId}` are unconditionally denied (`if false;`); only the Express backend via `firebase-admin` updates sync pulses after verified Cloud SQL commits.
4. **No Collection Scraping (`list` denied)**: Clients subscribe strictly to known single document paths (`/live_sync/global`) via `allow get`; `allow list` is explicitly denied (`if false;`).
5. **Path Variable Hardening**: `isValidId(channelId)` enforces `id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`.
6. **Strict Schema Helper (`isValidLivePulse`)**: Validates required keys, allowed keys (`hasOnly`), string length boundaries, and monotonic integer `version` even on admin-documented shapes.

## 3. Dirty Dozen Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. Client `setDoc` attempting to overwrite `/live_sync/global` with forged version (`{ channelId: "global", version: 999999, lastEventType: "forged", updatedAt: "2026-01-01T00:00:00Z" }`).
2. Client `updateDoc` attempting a partial shadow field injection (`{ extraFlag: true }`) on `/live_sync/global`.
3. Client `deleteDoc` attempting to erase `/live_sync/global`.
4. Client `getDocs(collection(db, "live_sync"))` attempting collection listing/scraping.
5. Client `setDoc` on `/test/connection` attempting probe-collection pollution.
6. Client `getDoc` on `/live_sync/` + oversized 1500-char ID poisoning payload (`isValidId` denial).
7. Client `setDoc` on `/students/24CS108` trying to spoof roster active status or unban self.
8. Client `getDoc` on `/students/24CS108` trying to harvest student PII from Firestore.
9. Client `setDoc` on `/bookings/fake-1` trying to bypass Cloud SQL booking checks & ban rules.
10. Client `setDoc` on `/admins/attacker` trying to escalate privileges.
11. Client `updateDoc` on `/live_sync/global` trying to spoof `lastEventType` as `"admin_override"` with non-string type or >64 chars.
12. Unauthenticated `setDoc` on `/signup_otps/otp-1` trying to inject/read 6-digit OTP verification codes.
