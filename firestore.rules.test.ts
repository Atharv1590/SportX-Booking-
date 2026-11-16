/**
 * Adversarial "Dirty Dozen" Firestore Security Verification Spec
 *
 * Verifies against Firestore rules invariants defined in firestore.rules:
 *  - Only `/live_sync/{channelId}` single-doc `get` is permitted when `isValidId(channelId)` holds.
 *  - All client `list`, `create`, `update`, `delete` operations and all other paths deny cleanly.
 */

export const DIRTY_DOZEN_PAYLOADS = [
  {
    id: 1,
    operation: 'create',
    path: '/live_sync/global',
    payload: {
      channelId: 'global',
      version: 999999,
      lastEventType: 'forged_pulse',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    operation: 'update',
    path: '/live_sync/global',
    payload: { extraFlag: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    operation: 'delete',
    path: '/live_sync/global',
    payload: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    operation: 'list',
    path: '/live_sync',
    payload: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    operation: 'create',
    path: '/test/connection',
    payload: { ok: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    operation: 'get',
    path: `/live_sync/${'x'.repeat(200)}`,
    payload: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    operation: 'create',
    path: '/students/24CS108',
    payload: { status: 'active', banScope: 'none' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    operation: 'get',
    path: '/students/24CS108',
    payload: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    operation: 'create',
    path: '/bookings/forged-1',
    payload: { sportId: 'badminton', status: 'confirmed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    operation: 'create',
    path: '/admins/attacker',
    payload: { role: 'superadmin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    operation: 'update',
    path: '/live_sync/global',
    payload: { lastEventType: 'x'.repeat(120) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    operation: 'create',
    path: '/signup_otps/otp-forged',
    payload: { code: '123456' },
    expected: 'PERMISSION_DENIED',
  },
] as const;
