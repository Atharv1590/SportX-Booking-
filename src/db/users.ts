import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { db } from './index.ts';
import { signupOtps, studentAccounts, students, users } from './schema.ts';
import type {
  RegisteredAccount,
  SignupOtpSummary,
  Student,
  StudentStatus,
} from '../types.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`campusarena:${firebaseConfig.projectId}:${firebaseConfig.apiKey}`)
    .digest('hex');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

export interface SignedStudentSession {
  uid: string;
  studentId: string;
  rollNo: string;
  email: string;
  name: string;
  exp: number;
}

export function signStudentSessionToken(student: Student): string {
  const payload: SignedStudentSession = {
    uid: `local:${student.id}`,
    studentId: student.id,
    rollNo: student.rollNo,
    email: student.email,
    name: student.name,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  return `ca_stu.${body}.${sig}`;
}

export function verifyStudentSessionToken(token: string): SignedStudentSession | null {
  if (!token.startsWith('ca_stu.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedStudentSession;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email: email.toLowerCase(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email.toLowerCase(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Failed to sync authenticated user:', error);
    throw new Error('Unable to synchronize user account.', { cause: error });
  }
}

function normalizeRoll(rollNo: string): string {
  return rollNo.trim().toUpperCase().replace(/\s+/g, '');
}

export function getTodayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addOneYearDate(startYmd: string): string {
  const parts = startYmd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const dt = new Date();
    dt.setUTCFullYear(dt.getUTCFullYear() + 1);
    return dt.toISOString().slice(0, 10);
  }
  const [y, m, d] = parts;
  const targetYear = y + 1;
  // Handle Feb 29 -> Feb 28 cleanly
  const dt = new Date(Date.UTC(targetYear, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) {
    return `${targetYear}-02-28`;
  }
  return dt.toISOString().slice(0, 10);
}

export function addDaysYmd(startYmd: string, days: number): string {
  const parts = startYmd.split('-').map(Number);
  const baseMs =
    parts.length === 3 && !parts.some(Number.isNaN)
      ? Date.UTC(parts[0], parts[1] - 1, parts[2])
      : Date.now();
  return new Date(baseMs + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}

export function isBanActive(
  row: { banScope?: string | null; banUntil?: string | null },
  referenceDate: string = getTodayUtcYmd()
): boolean {
  if (row.banScope !== 'all' && row.banScope !== 'selected') return false;
  if (!row.banUntil || !/^\d{4}-\d{2}-\d{2}$/.test(row.banUntil)) return false;
  return referenceDate <= row.banUntil;
}

export function isStudentBannedForSport(
  row: { banScope?: string | null; bannedSports?: string[] | null; banUntil?: string | null },
  sportId?: string,
  referenceDate: string = getTodayUtcYmd()
): boolean {
  if (!isBanActive(row, referenceDate)) return false;
  if (row.banScope === 'all') return true;
  if (!sportId) return false;
  const list = Array.isArray(row.bannedSports) ? row.bannedSports : [];
  return list.includes(sportId);
}

export function isSubscriptionExpired(
  endDate?: string | null,
  referenceDate: string = getTodayUtcYmd()
): boolean {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  return referenceDate > endDate;
}

export function computeEffectiveRosterStatus(
  row: {
    status: string;
    paymentDate?: string | null;
    subscriptionStartDate?: string | null;
    subscriptionEndDate?: string | null;
  },
  referenceDate: string = getTodayUtcYmd()
): StudentStatus {
  if (row.status === 'suspended') return 'suspended';
  if (row.status === 'expired' || row.status === 'inactive') return 'expired';
  const effectiveEnd =
    row.subscriptionEndDate && /^\d{4}-\d{2}-\d{2}$/.test(row.subscriptionEndDate)
      ? row.subscriptionEndDate
      : row.paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(row.paymentDate)
        ? addOneYearDate(row.paymentDate)
        : row.subscriptionStartDate && /^\d{4}-\d{2}-\d{2}$/.test(row.subscriptionStartDate)
          ? addOneYearDate(row.subscriptionStartDate)
          : null;
  if (!effectiveEnd) return 'expired';
  if (isSubscriptionExpired(effectiveEnd, referenceDate)) return 'expired';
  return 'active';
}

export interface ResolvedRosterState {
  status: StudentStatus;
  inRoster: boolean;
  idNo: string | null;
  paymentDate: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  isBanned: boolean;
  banScope: 'none' | 'all' | 'selected';
  bannedSports: string[];
  banUntil: string | null;
  banReason: string | null;
  bannedAt: string | null;
}

/**
 * Checks whether a student's Roll No (or ID No) is present, active, within its 1-year
 * payment window, and whether any temporary sports ban is active in the official Admin Roster (`students`).
 */
export async function resolveRosterStatus(
  rollNo: string,
  referenceDate: string = getTodayUtcYmd()
): Promise<ResolvedRosterState> {
  const normRoll = normalizeRoll(rollNo);
  const rosterRows = await db
    .select({
      status: students.status,
      idNo: students.idNo,
      paymentDate: students.paymentDate,
      subscriptionStartDate: students.subscriptionStartDate,
      subscriptionEndDate: students.subscriptionEndDate,
      banScope: students.banScope,
      bannedSports: students.bannedSports,
      banUntil: students.banUntil,
      banReason: students.banReason,
      bannedAt: students.bannedAt,
    })
    .from(students)
    .where(
      sql`UPPER(${students.rollNo}) = ${normRoll} OR UPPER(COALESCE(${students.idNo}, '')) = ${normRoll}`
    )
    .limit(1);

  if (rosterRows.length === 0) {
    return {
      status: 'inactive',
      inRoster: false,
      idNo: null,
      paymentDate: null,
      subscriptionStartDate: null,
      subscriptionEndDate: null,
      isBanned: false,
      banScope: 'none',
      bannedSports: [],
      banUntil: null,
      banReason: null,
      bannedAt: null,
    };
  }
  const row = rosterRows[0];
  const status = computeEffectiveRosterStatus(row, referenceDate);
  const paymentDate = row.paymentDate || row.subscriptionStartDate || null;
  const subscriptionEndDate =
    row.subscriptionEndDate || (paymentDate ? addOneYearDate(paymentDate) : null);
  const banned = isBanActive(row, referenceDate);
  const cleanScope: 'none' | 'all' | 'selected' = banned
    ? row.banScope === 'selected'
      ? 'selected'
      : 'all'
    : 'none';
  return {
    status,
    inRoster: true,
    idNo: row.idNo || null,
    paymentDate,
    subscriptionStartDate: row.subscriptionStartDate || paymentDate,
    subscriptionEndDate,
    isBanned: banned,
    banScope: cleanScope,
    bannedSports: banned && Array.isArray(row.bannedSports) ? row.bannedSports : [],
    banUntil: banned ? row.banUntil || null : null,
    banReason: banned ? row.banReason || null : null,
    bannedAt: banned ? row.bannedAt || null : null,
  };
}

function mapAccountToStudent(
  row: typeof studentAccounts.$inferSelect,
  rosterState: ResolvedRosterState
): Student {
  return {
    id: row.id,
    rollNo: row.rollNo,
    idNo: rosterState.idNo,
    name: row.name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    year: row.year,
    details: row.details,
    status: rosterState.status,
    inRoster: rosterState.inRoster,
    paymentDate: rosterState.paymentDate,
    subscriptionStartDate: rosterState.subscriptionStartDate,
    subscriptionEndDate: rosterState.subscriptionEndDate,
    isBanned: rosterState.isBanned,
    banScope: rosterState.banScope,
    bannedSports: rosterState.bannedSports,
    banUntil: rosterState.banUntil,
    banReason: rosterState.banReason,
    bannedAt: rosterState.bannedAt,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getAllRegisteredAccounts(): Promise<RegisteredAccount[]> {
  const [accountRows, rosterRows] = await Promise.all([
    db.select().from(studentAccounts).orderBy(desc(studentAccounts.createdAt)),
    db.select().from(students),
  ]);
  const today = getTodayUtcYmd();
  const rosterByRoll = new Map(rosterRows.map((r) => [normalizeRoll(r.rollNo), r]));
  const rosterByIdNo = new Map(
    rosterRows
      .filter((r) => Boolean(r.idNo))
      .map((r) => [normalizeRoll(r.idNo!), r])
  );

  return accountRows.map((acc) => {
    const normAccRoll = normalizeRoll(acc.rollNo);
    const roster = rosterByRoll.get(normAccRoll) || rosterByIdNo.get(normAccRoll);
    const rosterStatus: StudentStatus = roster
      ? computeEffectiveRosterStatus(roster, today)
      : 'inactive';
    const paymentDate = roster ? roster.paymentDate || roster.subscriptionStartDate || null : null;
    const subscriptionEndDate = roster
      ? roster.subscriptionEndDate || (paymentDate ? addOneYearDate(paymentDate) : null)
      : null;
    const banned = roster ? isBanActive(roster, today) : false;
    const banScope: 'none' | 'all' | 'selected' = banned
      ? roster?.banScope === 'selected'
        ? 'selected'
        : 'all'
      : 'none';
    return {
      id: acc.id,
      rollNo: acc.rollNo,
      idNo: roster?.idNo || null,
      name: acc.name,
      email: acc.email,
      phone: acc.phone,
      department: acc.department,
      year: acc.year,
      details: acc.details,
      inRoster: Boolean(roster),
      rosterStatus,
      paymentDate,
      subscriptionStartDate: roster?.subscriptionStartDate || paymentDate,
      subscriptionEndDate,
      isBanned: banned,
      banScope,
      bannedSports: banned && Array.isArray(roster?.bannedSports) ? roster!.bannedSports : [],
      banUntil: banned ? roster?.banUntil || null : null,
      banReason: banned ? roster?.banReason || null : null,
      bannedAt: banned ? roster?.bannedAt || null : null,
      createdAt: acc.createdAt.toISOString(),
    };
  });
}

export async function findStudentByFirebaseAuth(
  uid: string,
  email: string,
  rollNoHint?: string
): Promise<Student | null> {
  try {
    if (uid && !uid.startsWith('local:')) {
      const byUid = await db
        .select()
        .from(studentAccounts)
        .where(eq(studentAccounts.firebaseUid, uid))
        .limit(1);
      if (byUid.length > 0) {
        const rosterState = await resolveRosterStatus(byUid[0].rollNo);
        return mapAccountToStudent(byUid[0], rosterState);
      }
    }

    if (rollNoHint) {
      const cleanRoll = normalizeRoll(rollNoHint);
      const byRoll = await db
        .select()
        .from(studentAccounts)
        .where(eq(studentAccounts.rollNo, cleanRoll))
        .limit(1);
      if (byRoll.length > 0) {
        const rosterState = await resolveRosterStatus(byRoll[0].rollNo);
        return mapAccountToStudent(byRoll[0], rosterState);
      }
    }

    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      const byEmail = await db
        .select()
        .from(studentAccounts)
        .where(sql`LOWER(${studentAccounts.email}) = ${cleanEmail}`)
        .limit(1);
      if (byEmail.length > 0) {
        if (uid && !uid.startsWith('local:') && !byEmail[0].firebaseUid) {
          const updated = await db
            .update(studentAccounts)
            .set({ firebaseUid: uid })
            .where(eq(studentAccounts.id, byEmail[0].id))
            .returning();
          const rosterState = await resolveRosterStatus(updated[0].rollNo);
          return mapAccountToStudent(updated[0], rosterState);
        }
        const rosterState = await resolveRosterStatus(byEmail[0].rollNo);
        return mapAccountToStudent(byEmail[0], rosterState);
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to look up student profile:', error);
    throw new Error('Failed to load student profile.', { cause: error });
  }
}

export function isEduInEmail(email: string): boolean {
  const clean = email.trim().toLowerCase();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 0 || clean.includes(' ')) return false;
  const domain = clean.slice(atIdx + 1);
  return domain.endsWith('.edu.in') && domain.length > 7;
}

export async function registerStudentWithPassword(params: {
  email: string;
  password: string;
  name: string;
  phone: string;
  rollNo: string;
  department: string;
  year: string;
  details: string;
  saveDevice?: boolean;
}): Promise<{
  student?: Student;
  token?: string;
  deviceKey?: string;
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    const cleanEmail = params.email.trim().toLowerCase();
    if (!isEduInEmail(cleanEmail)) {
      return {
        errorStatus: 400,
        errorMessage: 'Please use your official .edu.in college Outlook email (e.g. name@college.edu.in).',
      };
    }

    const normRoll = normalizeRoll(params.rollNo);
    const cleanPhone = params.phone.replace(/\D/g, '');
    const pwHash = hashPassword(params.password);
    const newDeviceKey = params.saveDevice ? `dev_${crypto.randomBytes(18).toString('hex')}` : undefined;

    const existingByEmail = await db
      .select()
      .from(studentAccounts)
      .where(sql`LOWER(${studentAccounts.email}) = ${cleanEmail}`)
      .limit(1);

    if (existingByEmail.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `An account for ${cleanEmail} already exists. Please use Sign In with your Student ID or .edu.in email.`,
      };
    }

    const existingByRoll = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, normRoll))
      .limit(1);

    if (existingByRoll.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `Student ID ${normRoll} already has an account (${existingByRoll[0].email}). Please use Sign In instead.`,
      };
    }

    // Insert ONLY into student_accounts — NEVER automatically into the official Admin Roster (`students`)
    const inserted = await db
      .insert(studentAccounts)
      .values({
        id: `acc-${crypto.randomUUID().slice(0, 8)}`,
        rollNo: normRoll,
        name: params.name.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        department: params.department.trim() || 'SoT',
        year: params.year.trim() || '1st Year',
        details: params.details.trim() || 'Registered Student',
        passwordHash: pwHash,
        savedDeviceKeys: newDeviceKey ? [newDeviceKey] : [],
      })
      .returning();

    const rosterState = await resolveRosterStatus(normRoll);
    const student = mapAccountToStudent(inserted[0], rosterState);
    return { student, token: signStudentSessionToken(student), deviceKey: newDeviceKey };
  } catch (error) {
    console.error('Failed to register student account:', error);
    throw new Error('Failed to create student account.', { cause: error });
  }
}

export async function loginStudentWithPassword(
  identifier: string,
  password: string,
  saveDevice = false
): Promise<{
  student?: Student;
  token?: string;
  deviceKey?: string;
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    const raw = identifier.trim();
    const isEmailInput = raw.includes('@');
    const cleanEmail = raw.toLowerCase();
    const normRoll = normalizeRoll(raw);

    const rows = isEmailInput
      ? await db
          .select()
          .from(studentAccounts)
          .where(sql`LOWER(${studentAccounts.email}) = ${cleanEmail}`)
          .limit(1)
      : await db
          .select()
          .from(studentAccounts)
          .where(eq(studentAccounts.rollNo, normRoll))
          .limit(1);

    if (rows.length === 0) {
      return {
        errorStatus: 401,
        errorMessage:
          'No student account found for this Student ID or .edu.in email. Please switch to Sign Up to register.',
      };
    }

    const row = rows[0];
    if (row.passwordHash) {
      if (!verifyPassword(password, row.passwordHash)) {
        return {
          errorStatus: 401,
          errorMessage: 'Incorrect password for this account. Please try again.',
        };
      }
    }

    const newDeviceKey = saveDevice ? `dev_${crypto.randomBytes(18).toString('hex')}` : undefined;
    const updates: Partial<typeof studentAccounts.$inferInsert> = {};
    if (!row.passwordHash) {
      updates.passwordHash = hashPassword(password);
    }
    if (newDeviceKey) {
      updates.savedDeviceKeys = [...(row.savedDeviceKeys || []).slice(-9), newDeviceKey];
    }

    let finalRow = row;
    if (Object.keys(updates).length > 0) {
      const updated = await db
        .update(studentAccounts)
        .set(updates)
        .where(eq(studentAccounts.id, row.id))
        .returning();
      finalRow = updated[0];
    }

    const rosterState = await resolveRosterStatus(finalRow.rollNo);
    const student = mapAccountToStudent(finalRow, rosterState);
    return { student, token: signStudentSessionToken(student), deviceKey: newDeviceKey };
  } catch (error) {
    console.error('Failed to sign in student:', error);
    throw new Error('Sign in failed.', { cause: error });
  }
}

export async function quickLoginWithSavedDevice(
  rollNo: string,
  deviceKey: string
): Promise<{
  student?: Student;
  token?: string;
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    const normRoll = normalizeRoll(rollNo);
    if (!normRoll || !deviceKey) {
      return { errorStatus: 400, errorMessage: 'Missing saved student device credentials.' };
    }
    const rows = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, normRoll))
      .limit(1);
    if (rows.length === 0) {
      return { errorStatus: 404, errorMessage: 'Saved student account no longer exists.' };
    }
    const row = rows[0];
    const keys = row.savedDeviceKeys || [];
    if (!keys.includes(deviceKey)) {
      return {
        errorStatus: 401,
        errorMessage: 'Saved quick-login expired or was removed. Please sign in with your password once.',
      };
    }
    const rosterState = await resolveRosterStatus(row.rollNo);
    const student = mapAccountToStudent(row, rosterState);
    return { student, token: signStudentSessionToken(student) };
  } catch (error) {
    console.error('Failed quick login:', error);
    throw new Error('Quick login failed.', { cause: error });
  }
}

export async function registerSavedDeviceForStudent(studentId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(studentAccounts)
    .where(eq(studentAccounts.id, studentId))
    .limit(1);
  if (rows.length === 0) return null;
  const deviceKey = `dev_${crypto.randomBytes(18).toString('hex')}`;
  const nextKeys = [...(rows[0].savedDeviceKeys || []).slice(-9), deviceKey];
  await db
    .update(studentAccounts)
    .set({ savedDeviceKeys: nextKeys })
    .where(eq(studentAccounts.id, studentId));
  return deviceKey;
}

export async function forgetSavedDeviceForStudent(
  rollNo: string,
  deviceKey: string
): Promise<void> {
  const normRoll = normalizeRoll(rollNo);
  if (!normRoll || !deviceKey) return;
  const rows = await db
    .select()
    .from(studentAccounts)
    .where(eq(studentAccounts.rollNo, normRoll))
    .limit(1);
  if (rows.length === 0) return;
  const nextKeys = (rows[0].savedDeviceKeys || []).filter((k) => k !== deviceKey);
  await db
    .update(studentAccounts)
    .set({ savedDeviceKeys: nextKeys })
    .where(eq(studentAccounts.id, rows[0].id));
}

export async function registerOrLinkStudentProfile(params: {
  uid: string;
  email: string;
  name: string;
  phone: string;
  rollNo: string;
  department: string;
  year: string;
  details: string;
}): Promise<{ student?: Student; errorStatus?: number; errorMessage?: string }> {
  try {
    const normRoll = normalizeRoll(params.rollNo);
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanPhone = params.phone.replace(/\D/g, '');

    const existingByRoll = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, normRoll))
      .limit(1);

    if (existingByRoll.length > 0) {
      const existing = existingByRoll[0];
      if (existing.firebaseUid && existing.firebaseUid !== params.uid) {
        return {
          errorStatus: 409,
          errorMessage: `Roll No ${normRoll} is already linked to another account.`,
        };
      }

      const updated = await db
        .update(studentAccounts)
        .set({
          firebaseUid: params.uid,
          email: cleanEmail,
          name: params.name.trim(),
          phone: cleanPhone,
          department: params.department.trim(),
          year: params.year.trim(),
          details: params.details.trim(),
        })
        .where(eq(studentAccounts.id, existing.id))
        .returning();

      const rosterState = await resolveRosterStatus(normRoll);
      return { student: mapAccountToStudent(updated[0], rosterState) };
    }

    const inserted = await db
      .insert(studentAccounts)
      .values({
        id: `acc-${crypto.randomUUID().slice(0, 8)}`,
        firebaseUid: params.uid,
        rollNo: normRoll,
        name: params.name.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        department: params.department.trim() || 'SoT',
        year: params.year.trim() || '1st Year',
        details: params.details.trim(),
      })
      .returning();

    const rosterState = await resolveRosterStatus(normRoll);
    return { student: mapAccountToStudent(inserted[0], rosterState) };
  } catch (error) {
    console.error('Failed to register student profile:', error);
    throw new Error('Failed to save student profile.', { cause: error });
  }
}

export async function getStudentSecurityInfo(studentId: string): Promise<{
  hasPassword: boolean;
  googleLinked: boolean;
} | null> {
  const rows = await db
    .select({
      passwordHash: studentAccounts.passwordHash,
      firebaseUid: studentAccounts.firebaseUid,
    })
    .from(studentAccounts)
    .where(eq(studentAccounts.id, studentId))
    .limit(1);

  if (rows.length === 0) return null;
  return {
    hasPassword: Boolean(rows[0].passwordHash),
    googleLinked: Boolean(rows[0].firebaseUid && !rows[0].firebaseUid.startsWith('local:')),
  };
}

export async function updateStudentProfile(params: {
  studentId: string;
  name: string;
  phone: string;
  department: string;
  year: string;
  details: string;
}): Promise<{ student?: Student; errorStatus?: number; errorMessage?: string }> {
  try {
    const cleanPhone = params.phone.replace(/\D/g, '');
    if (params.name.trim().length < 2) {
      return { errorStatus: 400, errorMessage: 'Full name must be at least 2 characters.' };
    }
    if (cleanPhone.length < 10) {
      return { errorStatus: 400, errorMessage: 'Please enter a valid 10-digit phone number.' };
    }

    const updated = await db
      .update(studentAccounts)
      .set({
        name: params.name.trim(),
        phone: cleanPhone,
        department: params.department.trim() || 'SoT',
        year: params.year.trim() || '1st Year',
        details: params.details.trim() || 'Registered Student',
      })
      .where(eq(studentAccounts.id, params.studentId))
      .returning();

    if (updated.length === 0) {
      return { errorStatus: 404, errorMessage: 'Student account not found.' };
    }

    const rosterState = await resolveRosterStatus(updated[0].rollNo);
    return { student: mapAccountToStudent(updated[0], rosterState) };
  } catch (error) {
    console.error('Failed to update student profile:', error);
    throw new Error('Failed to update student profile.', { cause: error });
  }
}

export async function changeStudentPassword(params: {
  studentId: string;
  currentPassword?: string;
  newPassword: string;
}): Promise<{ ok?: boolean; errorStatus?: number; errorMessage?: string }> {
  try {
    if (!params.newPassword || params.newPassword.length < 4) {
      return {
        errorStatus: 400,
        errorMessage: 'New password must be at least 4 characters.',
      };
    }

    const rows = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.id, params.studentId))
      .limit(1);

    if (rows.length === 0) {
      return { errorStatus: 404, errorMessage: 'Student account not found.' };
    }

    const row = rows[0];
    if (row.passwordHash) {
      if (!params.currentPassword) {
        return {
          errorStatus: 400,
          errorMessage: 'Enter your current password to set a new password.',
        };
      }
      if (!verifyPassword(params.currentPassword, row.passwordHash)) {
        return {
          errorStatus: 401,
          errorMessage: 'Current password is incorrect.',
        };
      }
    }

    const nextHash = hashPassword(params.newPassword);
    await db
      .update(studentAccounts)
      .set({ passwordHash: nextHash })
      .where(eq(studentAccounts.id, params.studentId));

    return { ok: true };
  } catch (error) {
    console.error('Failed to update student password:', error);
    throw new Error('Failed to update password.', { cause: error });
  }
}

// ==================== SIGNUP 6-DIGIT GMAIL OTP VERIFICATION ====================

const OTP_AES_KEY = crypto.createHash('sha256').update(`otp:${SESSION_SECRET}`).digest();

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', OTP_AES_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload.');
  }
  const [ivHex, tagHex, cipherHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    OTP_AES_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

function encryptOtpCode(code: string): string {
  return encryptSecret(code);
}

function decryptOtpCode(payload: string): string {
  return decryptSecret(payload);
}

function hashOtpCode(code: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(code.trim()).digest('hex');
}

export async function createSignupOtpRequest(params: {
  email: string;
  password: string;
  name: string;
  phone: string;
  rollNo: string;
}): Promise<{
  otpId?: string;
  email?: string;
  rollNo?: string;
  name?: string;
  expiresAt?: string;
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    const cleanEmail = params.email.trim().toLowerCase();
    if (!isEduInEmail(cleanEmail)) {
      return {
        errorStatus: 400,
        errorMessage:
          'Please enter your official .edu.in college Outlook email (e.g. name@college.edu.in).',
      };
    }
    if (!params.password || params.password.length < 4) {
      return { errorStatus: 400, errorMessage: 'Create a password with at least 4 characters.' };
    }
    if (!params.name || params.name.trim().length < 2) {
      return { errorStatus: 400, errorMessage: 'Please enter your full name.' };
    }
    const cleanPhone = (params.phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return { errorStatus: 400, errorMessage: 'Please enter a valid 10-digit phone number.' };
    }
    const normRoll = normalizeRoll(params.rollNo || '');
    if (normRoll.length < 4) {
      return {
        errorStatus: 400,
        errorMessage: 'Please enter a valid Student ID / Roll No (e.g. 24CS108).',
      };
    }

    const existingByEmail = await db
      .select()
      .from(studentAccounts)
      .where(sql`LOWER(${studentAccounts.email}) = ${cleanEmail}`)
      .limit(1);
    if (existingByEmail.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `An account for ${cleanEmail} already exists. Please use Sign In instead.`,
      };
    }

    const existingByRoll = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, normRoll))
      .limit(1);
    if (existingByRoll.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `Student ID ${normRoll} already has an account (${existingByRoll[0].email}). Please use Sign In instead.`,
      };
    }

    // Supersede any earlier active OTP requests for the same email/rollNo
    await db
      .update(signupOtps)
      .set({
        status: 'failed',
        lastError: 'Superseded by a newer verification code request.',
      })
      .where(
        and(
          inArray(signupOtps.status, ['pending', 'sending', 'sent']),
          sql`LOWER(${signupOtps.email}) = ${cleanEmail} OR UPPER(${signupOtps.rollNo}) = ${normRoll}`
        )
      );

    const code = String(crypto.randomInt(100000, 1000000));
    const otpId = `otp-${crypto.randomUUID().slice(0, 12)}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(signupOtps).values({
      id: otpId,
      email: cleanEmail,
      rollNo: normRoll,
      name: params.name.trim(),
      codeHash: hashOtpCode(code),
      encryptedCode: encryptOtpCode(code),
      status: 'pending',
      attempts: 0,
      expiresAt,
    });

    return {
      otpId,
      email: cleanEmail,
      rollNo: normRoll,
      name: params.name.trim(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to create signup OTP request:', error);
    throw new Error('Could not initiate verification code request.', { cause: error });
  }
}

export async function getSignupOtpPublicStatus(otpId: string): Promise<{
  id: string;
  email: string;
  status: string;
  sentFromEmail: string | null;
  lastError: string | null;
  expiresAt: string;
  sentAt: string | null;
} | null> {
  const rows = await db
    .select()
    .from(signupOtps)
    .where(eq(signupOtps.id, otpId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    status: r.status,
    sentFromEmail: r.sentFromEmail || null,
    lastError: r.lastError || null,
    expiresAt: r.expiresAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  };
}

export async function getRecentSignupOtps(limit = 30): Promise<SignupOtpSummary[]> {
  const rows = await db
    .select()
    .from(signupOtps)
    .orderBy(desc(signupOtps.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    rollNo: r.rollNo,
    name: r.name,
    status: r.status as SignupOtpSummary['status'],
    attempts: r.attempts,
    sentFromEmail: r.sentFromEmail || null,
    lastError: r.lastError || null,
    expiresAt: r.expiresAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function claimAndGetOtpForGmailSend(
  otpId: string,
  explicitResend = false
): Promise<{
  id: string;
  email: string;
  rollNo: string;
  name: string;
  code: string;
  expiresAt: Date;
} | null> {
  const allowedStatuses = explicitResend ? ['pending', 'failed', 'sent'] : ['pending'];
  const claimed = await db
    .update(signupOtps)
    .set({ status: 'sending', lastError: null })
    .where(and(eq(signupOtps.id, otpId), inArray(signupOtps.status, allowedStatuses)))
    .returning();

  if (claimed.length === 0) return null;
  const row = claimed[0];
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(signupOtps)
      .set({ status: 'failed', lastError: 'Verification code expired before dispatch.' })
      .where(eq(signupOtps.id, otpId));
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    rollNo: row.rollNo,
    name: row.name,
    code: decryptOtpCode(row.encryptedCode),
    expiresAt: row.expiresAt,
  };
}

export async function markOtpSendResult(
  otpId: string,
  ok: boolean,
  sentFromEmail?: string | null,
  errorMessage?: string | null
): Promise<void> {
  await db
    .update(signupOtps)
    .set(
      ok
        ? {
            status: 'sent',
            sentFromEmail: sentFromEmail || null,
            sentAt: new Date(),
            lastError: null,
          }
        : {
            status: 'failed',
            lastError: errorMessage || 'Gmail send failed.',
          }
    )
    .where(eq(signupOtps.id, otpId));
}

export async function verifySignupOtpAndRegister(params: {
  otpId: string;
  code: string;
  email: string;
  password: string;
  name: string;
  phone: string;
  rollNo: string;
  department: string;
  year: string;
  details: string;
  saveDevice?: boolean;
}): Promise<{
  student?: Student;
  token?: string;
  deviceKey?: string;
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    const cleanCode = (params.code || '').replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      return {
        errorStatus: 400,
        errorMessage: 'Please enter the 6-digit verification code sent to your email.',
      };
    }

    const rows = await db
      .select()
      .from(signupOtps)
      .where(eq(signupOtps.id, params.otpId))
      .limit(1);

    if (rows.length === 0) {
      return {
        errorStatus: 404,
        errorMessage: 'Verification session not found. Please request a new 6-digit code.',
      };
    }

    const row = rows[0];
    if (row.status === 'verified') {
      return {
        errorStatus: 400,
        errorMessage: 'This verification code has already been used.',
      };
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return {
        errorStatus: 400,
        errorMessage: 'This 6-digit code has expired. Click Resend Code to get a new one.',
      };
    }
    if (row.attempts >= 5) {
      return {
        errorStatus: 429,
        errorMessage: 'Too many invalid attempts. Request a new 6-digit verification code.',
      };
    }

    const cleanEmail = params.email.trim().toLowerCase();
    const normRoll = normalizeRoll(params.rollNo);
    if (row.email.toLowerCase() !== cleanEmail || row.rollNo.toUpperCase() !== normRoll) {
      return {
        errorStatus: 400,
        errorMessage: 'Verification code does not match this email or Roll No.',
      };
    }

    const suppliedHash = hashOtpCode(cleanCode);
    const expectedBuf = Buffer.from(row.codeHash, 'hex');
    const suppliedBuf = Buffer.from(suppliedHash, 'hex');
    const match =
      expectedBuf.length === suppliedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, suppliedBuf);

    if (!match) {
      const nextAttempts = row.attempts + 1;
      await db
        .update(signupOtps)
        .set({ attempts: nextAttempts })
        .where(eq(signupOtps.id, row.id));
      const remaining = Math.max(0, 5 - nextAttempts);
      return {
        errorStatus: 400,
        errorMessage:
          remaining > 0
            ? `Incorrect 6-digit code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            : 'Too many incorrect codes. Please click Resend Code for a new code.',
      };
    }

    await db
      .update(signupOtps)
      .set({ status: 'verified' })
      .where(eq(signupOtps.id, row.id));

    return registerStudentWithPassword({
      email: cleanEmail,
      password: params.password,
      name: params.name,
      phone: params.phone,
      rollNo: normRoll,
      department: params.department,
      year: params.year,
      details: params.details,
      saveDevice: Boolean(params.saveDevice),
    });
  } catch (error) {
    console.error('Failed to verify signup OTP:', error);
    throw new Error('Verification failed. Please try again.', { cause: error });
  }
}

