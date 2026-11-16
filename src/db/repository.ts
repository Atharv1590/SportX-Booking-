import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  activityLogs,
  appPolicy,
  blockedSlots,
  bookings,
  courts,
  lightRequests,
  openGames,
  sports,
  studentAccounts,
  students,
} from './schema.ts';
import {
  addDaysYmd,
  addOneYearDate,
  computeEffectiveRosterStatus,
  decryptSecret,
  encryptSecret,
  getAllRegisteredAccounts,
  getRecentSignupOtps,
  getTodayUtcYmd,
  hashPassword,
  isBanActive,
  isStudentBannedForSport,
  isSubscriptionExpired,
} from './users.ts';
import type {
  ActivityLogEntry,
  AdminDashboardData,
  BlockedSlot,
  Booking,
  BookingPolicy,
  FacilityRuleItem,
  LightRequest,
  OpenGame,
  PlayerValidationResult,
  PublicSlotBooking,
  RosterEntry,
  SecurityCheckInStatus,
  SecurityGateWindowData,
  Sport,
  Student,
  StudentStatus,
  TimeSlot,
} from '../types.ts';

import {
  ALL_TIME_SLOTS,
  formatHourMinute12,
  getDateDaysAgoString,
  getDayScheduleWindows,
  getFourAmCodeCycleDate,
  getSlotOperationalState,
  getSportsDayEffectiveHour,
  getSportsDayFromOffset,
} from '../lib/schedule.ts';

export const TIME_SLOTS: TimeSlot[] = ALL_TIME_SLOTS;

export const SECURITY_MONITORED_SPORT_IDS = ['badminton', 'pool', 'billiards'];

export const DEFAULT_FACILITY_RULES: FacilityRuleItem[] = [
  {
    id: 'rule-arrival',
    title: 'Arrive 10 Minutes Early',
    description:
      'Booking creator and all listed players must report at the facility desk 10 minutes before the slot starts. Unclaimed courts are released automatically.',
  },
  {
    id: 'rule-incourt',
    title: 'In-Court Pre-Check-In (5 Mins Prior)',
    description:
      'Players may tap "In Court" in My Bookings up to 5 minutes before their slot begins to confirm court presence with gate security.',
  },
  {
    id: 'rule-equipment',
    title: 'Mandatory Sport Equipment & Footwear',
    description:
      'Wear non-marking indoor shoes on wooden/synthetic courts and bring sport-specific racquets, shuttles, or balls listed per venue.',
  },
  {
    id: 'rule-schedule',
    title: 'Operating Windows & Maintenance Breaks',
    description:
      'Weekdays: 5:00 AM–9:30 AM & 4:00 PM–11:00 PM (Maint 9:30 AM–4:00 PM). Weekends: 5:00 AM–12:00 PM & 5:00 PM–11:00 PM (Maint 12:00 PM–5:00 PM). Morning opens 3:00 AM, Evening opens 8:00 AM.',
  },
  {
    id: 'rule-latenight',
    title: 'Late-Night Floodlit Access (11:00 PM – 4:00 AM)',
    description:
      'Daytime & evening slots up to 11:00 PM are free; 11:00 PM – 4:00 AM floodlight sessions require verified UPI or Card payment.',
  },
  {
    id: 'rule-college-cancel',
    title: 'College Cancellation Authority',
    description:
      'Your booking can be cancelled by the college administration at any time with a valid reason (such as official training hours, tournaments, or urgent maintenance).',
  },
];

const CATALOG_SPORTS = [
  {
    id: 'badminton',
    name: 'Badminton',
    category: 'Indoor Racquet',
    minPlayers: 2,
    maxPlayers: 4,
    lateNightFee: 250,
    equipmentRequired:
      'Non-marking indoor court shoes, badminton racquets, and nylon/feather shuttlecocks.',
    location: 'Indoor Badminton Arena · Courts 1–10',
    sortOrder: 1,
  },
  {
    id: 'squash',
    name: 'Squash',
    category: 'Indoor Racquet',
    minPlayers: 2,
    maxPlayers: 4,
    lateNightFee: 250,
    equipmentRequired:
      'Non-marking indoor shoes, squash racquets, protective eyewear, and double-yellow-dot balls.',
    location: 'Glass-Back Squash Wing · Level 1',
    sortOrder: 2,
  },
  {
    id: 'chess',
    name: 'Chess',
    category: 'Mind Sports',
    minPlayers: 2,
    maxPlayers: 2,
    lateNightFee: 120,
    equipmentRequired: 'Valid College ID card for tournament clock & wooden board check-out.',
    location: 'Academic Recreation Hall · Room 108',
    sortOrder: 3,
  },
  {
    id: 'pool',
    name: 'Pool',
    category: 'Cue Sports',
    minPlayers: 2,
    maxPlayers: 4,
    lateNightFee: 200,
    equipmentRequired:
      'Valid College ID card for cue stick, 8-ball rack, and chalk issuance at Security Desk.',
    location: 'Student Recreation Wing · Cue Hall A',
    sortOrder: 4,
  },
  {
    id: 'billiards',
    name: 'Billiards',
    category: 'Cue Sports',
    minPlayers: 2,
    maxPlayers: 4,
    lateNightFee: 220,
    equipmentRequired:
      'Valid College ID card for English billiards/snooker cues and rest issuance at Security Desk.',
    location: 'Student Recreation Wing · Cue Hall B',
    sortOrder: 5,
  },
  {
    id: 'tennis',
    name: 'Tennis',
    category: 'Outdoor Racquet',
    minPlayers: 2,
    maxPlayers: 4,
    lateNightFee: 350,
    equipmentRequired:
      'Flat-sole tennis shoes, tennis racquets, and pressurized hardcourt tennis balls.',
    location: 'North Varsity Hardcourts',
    sortOrder: 6,
  },
  {
    id: 'basketball',
    name: 'Basketball',
    category: 'Outdoor Court',
    minPlayers: 4,
    maxPlayers: 10,
    lateNightFee: 450,
    equipmentRequired:
      'Basketball court shoes, team bibs/jerseys, and a size-7 leather basketball.',
    location: 'Central Sports Complex · Courts 1–3',
    sortOrder: 7,
  },
  {
    id: 'box-football',
    name: 'Box Football',
    category: 'Turf Arena',
    minPlayers: 6,
    maxPlayers: 12,
    lateNightFee: 600,
    equipmentRequired:
      'Turf football shoes (no metal studs), shin guards, and a size-5 futsal/turf ball.',
    location: 'East Quadrangle Floodlit Turf',
    sortOrder: 8,
  },
  {
    id: 'volleyball',
    name: 'Volleyball',
    category: 'Indoor / Hardcourt',
    minPlayers: 6,
    maxPlayers: 12,
    lateNightFee: 400,
    equipmentRequired:
      'Athletic court shoes, knee pads (recommended), and a leather match volleyball.',
    location: 'Central Sports Pavilion · Courts 1–4',
    sortOrder: 9,
  },
  {
    id: 'sand-volleyball',
    name: 'Sand Volleyball',
    category: 'Beach Court',
    minPlayers: 2,
    maxPlayers: 6,
    lateNightFee: 350,
    equipmentRequired:
      'Barefoot or sand socks only (no spiked/street footwear) and an outdoor beach volleyball.',
    location: 'South Beach Sand Arena',
    sortOrder: 10,
  },
  {
    id: 'cricket-nets',
    name: 'Cricket',
    category: 'Practice Pitch',
    minPlayers: 3,
    maxPlayers: 8,
    lateNightFee: 400,
    equipmentRequired:
      'Cricket bat, batting pads, protective helmet, gloves, and leather/tennis balls.',
    location: 'South Pavilion Cricket Bays',
    sortOrder: 11,
  },
];

const CATALOG_COURTS = [
  // 10 Badminton Courts
  ...Array.from({ length: 10 }, (_, idx) => ({
    id: `badminton-c${idx + 1}`,
    sportId: 'badminton',
    name: `Court ${idx + 1}`,
    surface: idx < 6 ? 'BWF Synthetic Mat' : 'Teak Hardwood',
    status: 'operational',
    sortOrder: idx + 1,
  })),
  // 2 Squash Courts
  { id: 'squash-c1', sportId: 'squash', name: 'Squash Court 1', surface: 'WFS Glass Back · Maple', status: 'operational', sortOrder: 1 },
  { id: 'squash-c2', sportId: 'squash', name: 'Squash Court 2', surface: 'WFS Glass Back · Maple', status: 'operational', sortOrder: 2 },
  // 3 Chess Boards
  { id: 'chess-b1', sportId: 'chess', name: 'Board 1', surface: 'Tournament Staunton · DGT Clock', status: 'operational', sortOrder: 1 },
  { id: 'chess-b2', sportId: 'chess', name: 'Board 2', surface: 'Tournament Staunton · DGT Clock', status: 'operational', sortOrder: 2 },
  { id: 'chess-b3', sportId: 'chess', name: 'Board 3', surface: 'Tournament Staunton · DGT Clock', status: 'operational', sortOrder: 3 },
  // 5 Pool Tables
  ...Array.from({ length: 5 }, (_, idx) => ({
    id: `pool-t${idx + 1}`,
    sportId: 'pool',
    name: `Pool Table ${idx + 1}`,
    surface: '9ft Championship 8-Ball Slate',
    status: 'operational',
    sortOrder: idx + 1,
  })),
  // 2 Billiards Tables
  { id: 'billiards-t1', sportId: 'billiards', name: 'Billiards Table 1', surface: '12ft English Wool Snooker/Billiards', status: 'operational', sortOrder: 1 },
  { id: 'billiards-t2', sportId: 'billiards', name: 'Billiards Table 2', surface: '12ft English Wool Snooker/Billiards', status: 'operational', sortOrder: 2 },
  // 2 Tennis Courts
  { id: 'tennis-c1', sportId: 'tennis', name: 'Tennis Court 1', surface: 'DecoTurf Cushioned Hardcourt', status: 'operational', sortOrder: 1 },
  { id: 'tennis-c2', sportId: 'tennis', name: 'Tennis Court 2', surface: 'DecoTurf Cushioned Hardcourt', status: 'operational', sortOrder: 2 },
  // 3 Basketball Courts
  { id: 'bball-c1', sportId: 'basketball', name: 'Main Floodlit Court', surface: 'Acrylic Cushion Hardcourt', status: 'operational', sortOrder: 1 },
  { id: 'bball-c2', sportId: 'basketball', name: 'Practice Court East', surface: 'Acrylic Cushion Hardcourt', status: 'operational', sortOrder: 2 },
  { id: 'bball-c3', sportId: 'basketball', name: 'Practice Court West', surface: 'Acrylic Cushion Hardcourt', status: 'operational', sortOrder: 3 },
  // 2 Box Football Turfs
  { id: 'football-t1', sportId: 'box-football', name: 'Turf North', surface: '50mm FIFA Pro AstroTurf', status: 'operational', sortOrder: 1 },
  { id: 'football-t2', sportId: 'box-football', name: 'Turf South', surface: '50mm FIFA Pro AstroTurf', status: 'operational', sortOrder: 2 },
  // 4 Volleyball Courts
  ...Array.from({ length: 4 }, (_, idx) => ({
    id: `volleyball-c${idx + 1}`,
    sportId: 'volleyball',
    name: `Volleyball Court ${idx + 1}`,
    surface: idx < 2 ? 'Maple Hardwood Indoor' : 'High-Grip Synthetic Court',
    status: 'operational',
    sortOrder: idx + 1,
  })),
  // 1 Sand Volleyball Court
  { id: 'sandvb-c1', sportId: 'sand-volleyball', name: 'Beach Arena Court 1', surface: '40cm Washed Quartz Sand', status: 'operational', sortOrder: 1 },
  // 2 Cricket Nets
  { id: 'cricket-n1', sportId: 'cricket-nets', name: 'Net 1 (Pace Bay)', surface: 'Matting over Turf', status: 'operational', sortOrder: 1 },
  { id: 'cricket-n2', sportId: 'cricket-nets', name: 'Net 2 (Spin Bay)', surface: 'Natural Clay Strip', status: 'operational', sortOrder: 2 },
];

export function normalizeRollNo(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function getTodayDateString(tzOffsetMinutes = 0): string {
  return getSportsDayFromOffset(tzOffsetMinutes);
}

export function getLocalHour(tzOffsetMinutes = 0): number {
  const clampedOffset = Math.max(-720, Math.min(840, Number(tzOffsetMinutes) || 0));
  const localMs = Date.now() - clampedOffset * 60_000;
  return new Date(localMs).getUTCHours();
}

export function getLocalHourAndMinute(tzOffsetMinutes = 0): { hour: number; minute: number } {
  const clampedOffset = Math.max(-720, Math.min(840, Number(tzOffsetMinutes) || 0));
  const localMs = Date.now() - clampedOffset * 60_000;
  const dt = new Date(localMs);
  return { hour: dt.getUTCHours(), minute: dt.getUTCMinutes() };
}

export function getFiveAmCycleDate(tzOffsetMinutes = 0): string {
  return getFourAmCodeCycleDate(tzOffsetMinutes);
}

export async function purgeExpiredBookingsOlderThan30Days(
  tzOffsetMinutes = 0
): Promise<number> {
  try {
    const cutoffDate = getDateDaysAgoString(29, tzOffsetMinutes);
    await db.delete(lightRequests).where(lt(lightRequests.date, cutoffDate));
    await db.delete(openGames).where(lt(openGames.date, cutoffDate));
    await db.delete(blockedSlots).where(lt(blockedSlots.date, cutoffDate));
    const deletedBookings = await db
      .delete(bookings)
      .where(lt(bookings.date, cutoffDate))
      .returning({ id: bookings.id });

    if (deletedBookings.length > 0) {
      await db.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'policy',
        summary: `30-day retention purge permanently deleted ${deletedBookings.length} booking(s) older than ${cutoffDate}`,
        actor: 'System Retention Job',
      });
    }
    return deletedBookings.length;
  } catch (error) {
    console.error('Failed 30-day booking retention purge:', error);
    return 0;
  }
}

export async function getEmailsForBooking(booking: Booking): Promise<string[]> {
  try {
    const playerRolls = Array.from(
      new Set([
        normalizeRollNo(booking.bookedByRollNo),
        ...(booking.players || []).map((p) => normalizeRollNo(p.rollNo)),
      ])
    ).filter(Boolean);

    const [studentRows, accountRows] = await Promise.all([
      db.select({ rollNo: students.rollNo, idNo: students.idNo, email: students.email }).from(students),
      db.select({ rollNo: studentAccounts.rollNo, email: studentAccounts.email }).from(studentAccounts),
    ]);

    const emailSet = new Set<string>();
    const pushIfEmail = (candidate?: string | null) => {
      const clean = (candidate || '').trim().toLowerCase();
      if (clean && clean.includes('@') && clean.length >= 5) {
        emailSet.add(clean);
      }
    };

    pushIfEmail(booking.bookedByEmail);
    for (const row of accountRows) {
      if (playerRolls.includes(normalizeRollNo(row.rollNo))) {
        pushIfEmail(row.email);
      }
    }
    for (const row of studentRows) {
      const nr = normalizeRollNo(row.rollNo);
      const nid = row.idNo ? normalizeRollNo(row.idNo) : '';
      if (playerRolls.includes(nr) || (nid && playerRolls.includes(nid))) {
        pushIfEmail(row.email);
      }
    }

    return Array.from(emailSet);
  } catch (error) {
    console.error('Failed to look up booking participant emails:', error);
    return booking.bookedByEmail ? [booking.bookedByEmail.toLowerCase()] : [];
  }
}

function computeBookingAutoAdmitIso(
  dateStr: string,
  slotId: string,
  tzOffsetMinutes = 0,
  createdAtMs = Date.now()
): string {
  const clampedOffset = Math.max(-720, Math.min(840, Number(tzOffsetMinutes) || 0));
  const [y, m, d] = dateStr.split('-').map(Number);
  const rawHour = Number(slotId.split(':')[0]);
  const effectiveHour = rawHour < 4 ? rawHour + 24 : rawHour;
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(effectiveHour)
  ) {
    return new Date(createdAtMs + 30 * 60_000).toISOString();
  }
  const slotStartUtcMs = Date.UTC(y, m - 1, d, effectiveHour, 0, 0) + clampedOffset * 60_000;
  const referenceStartMs = Math.max(slotStartUtcMs, createdAtMs);
  return new Date(referenceStartMs + 30 * 60_000).toISOString();
}

let seedPromise: Promise<void> | null = null;
let seededDone = false;

async function syncFacilityCatalogIfNeeded(): Promise<void> {
  const existingSports = await db.select().from(sports);
  const existingBadmintonCourts = await db
    .select()
    .from(courts)
    .where(eq(courts.sportId, 'badminton'));
  const hasSquash = existingSports.some((s) => s.id === 'squash');
  const hasBilliards = existingSports.some((s) => s.id === 'billiards');
  const hasSandVb = existingSports.some((s) => s.id === 'sand-volleyball');

  if (
    hasSquash &&
    hasBilliards &&
    hasSandVb &&
    existingBadmintonCourts.length >= 10 &&
    existingSports.length >= 11
  ) {
    return;
  }

  // Upsert all 11 updated sports
  for (const sp of CATALOG_SPORTS) {
    await db
      .insert(sports)
      .values(sp)
      .onConflictDoUpdate({
        target: sports.id,
        set: {
          name: sp.name,
          category: sp.category,
          sortOrder: sp.sortOrder,
          location: sp.location,
        },
      });
  }

  // Upsert all 36 courts cleanly
  for (const ct of CATALOG_COURTS) {
    await db.insert(courts).values(ct).onConflictDoNothing();
  }

  // Retire legacy table-tennis if no bookings reference it
  if (existingSports.some((s) => s.id === 'table-tennis')) {
    const ttBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.sportId, 'table-tennis'))
      .limit(1);
    if (ttBookings.length === 0) {
      await db.delete(blockedSlots).where(eq(blockedSlots.sportId, 'table-tennis'));
      await db.delete(sports).where(eq(sports.id, 'table-tennis'));
    }
  }
}

export async function ensureSeeded(): Promise<void> {
  if (seededDone) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    try {
      await syncFacilityCatalogIfNeeded();

      const existingStudents = await db.select().from(students).limit(1);
      const today = getTodayDateString(0);
      const nowIso = new Date().toISOString();

      const todaySub = getTodayUtcYmd();
      const oneYearLater = addOneYearDate(todaySub);

      if (existingStudents.length === 0) {
        await db
          .insert(students)
          .values([
            { id: 'stu-1', rollNo: '23CS101', name: 'Aarav Sharma', email: 'aarav.23cs101@campus.edu.in', phone: '9876543210', department: 'SoT', year: '3rd Year', details: 'Hostel H4 · Badminton Squad', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-2', rollNo: '23CS102', name: 'Diya Nair', email: 'diya.23cs102@campus.edu.in', phone: '9876543211', department: 'SoT', year: '3rd Year', details: 'Hostel H2 · Badminton Doubles', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-3', rollNo: '23CS103', name: 'Rohan Kulkarni', email: 'rohan.23cs103@campus.edu.in', phone: '9876543212', department: 'SoT', year: '3rd Year', details: 'Day Scholar', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-4', rollNo: '23EC201', name: 'Ananya Verma', email: 'ananya.23ec201@campus.edu.in', phone: '9876543213', department: 'SoT', year: '3rd Year', details: 'Hostel H1', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-5', rollNo: '23EC202', name: 'Kabir Mehta', email: 'kabir.23ec202@campus.edu.in', phone: '9876543214', department: 'SoB', year: '3rd Year', details: 'Box Football Captain', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-6', rollNo: '23ME301', name: 'Vikram Singh', email: 'vikram.23me301@campus.edu.in', phone: '9876543215', department: 'SoT', year: '3rd Year', details: 'Hostel H6', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-7', rollNo: '23ME302', name: 'Siddharth Rao', email: 'siddharth.23me302@campus.edu.in', phone: '9876543216', department: 'SoT', year: '3rd Year', details: 'Hostel H6', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-8', rollNo: '24CS105', name: 'Meera Iyer', email: 'meera.24cs105@campus.edu.in', phone: '9876543217', department: 'SoAD', year: '2nd Year', details: 'Hostel H3', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-9', rollNo: '24CS106', name: 'Arjun Reddy', email: 'arjun.24cs106@campus.edu.in', phone: '9876543218', department: 'SoL', year: '2nd Year', details: 'Hostel H5', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-10', rollNo: '24IT202', name: 'Pranav Joshi', email: 'pranav.24it202@campus.edu.in', phone: '9876543219', department: 'SoB', year: '2nd Year', details: 'Day Scholar', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-11', rollNo: '24AI304', name: 'Neha Kapoor', email: 'neha.24ai304@campus.edu.in', phone: '9876543220', department: 'SoS', year: '2nd Year', details: 'Hostel H2', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-12', rollNo: '24EE401', name: 'Karthik Subramanian', email: 'karthik.24ee401@campus.edu.in', phone: '9876543221', department: 'SoAP', year: '2nd Year', details: 'Hostel H4', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-13', rollNo: '25CS110', name: 'Ishaan Gupta', email: 'ishaan.25cs110@campus.edu.in', phone: '9876543222', department: 'SoLAH', year: '1st Year', details: 'Hostel H1', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-14', rollNo: '25EC118', name: 'Tanvi Deshmukh', email: 'tanvi.25ec118@campus.edu.in', phone: '9876543223', department: 'SoAD', year: '1st Year', details: 'Hostel H3', status: 'active', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
            { id: 'stu-15', rollNo: '22CS999', name: 'Devansh Malhotra', email: 'devansh.22cs999@campus.edu.in', phone: '9876543299', department: 'SoT', year: '4th Year', details: 'Sports ID Temporarily Suspended', status: 'suspended', subscriptionStartDate: todaySub, subscriptionEndDate: oneYearLater },
          ])
          .onConflictDoNothing();
      } else {
        // Backfill missing subscription dates on any pre-existing roster rows
        await db.execute(
          sql`UPDATE students SET subscription_start_date = COALESCE(subscription_start_date, ${todaySub}), subscription_end_date = COALESCE(subscription_end_date, ${oneYearLater}) WHERE subscription_start_date IS NULL OR subscription_end_date IS NULL`
        );
      }

      // Ensure sample student login account exists in student_accounts (separate from Roster)
      await db
        .insert(studentAccounts)
        .values({
          id: 'acc-stu-1',
          rollNo: '23CS101',
          name: 'Aarav Sharma',
          email: 'aarav.23cs101@campus.edu.in',
          phone: '9876543210',
          department: 'SoT',
          year: '3rd Year',
          details: 'Hostel H4 · Badminton Squad',
          passwordHash: hashPassword('campus123'),
          savedDeviceKeys: [],
        })
        .onConflictDoNothing();

      // Ensure appPolicy row 1 has default facility rules & schedule populated
      const existingPolicy = await db.select().from(appPolicy).where(eq(appPolicy.id, 1)).limit(1);
      if (existingPolicy.length === 0) {
        await db
          .insert(appPolicy)
          .values({
            id: 1,
            sameDayOnly: true,
            openingHour: 8,
            morningBookingOpenHour: 3,
            eveningBookingOpenHour: 8,
            enforceOpeningHour: true,
            weekdayMorningStart: '05:00',
            weekdayMorningEnd: '09:30',
            weekdayEveningStart: '16:00',
            weekdayEveningEnd: '23:00',
            weekendMorningStart: '05:00',
            weekendMorningEnd: '12:00',
            weekendEveningStart: '17:00',
            weekendEveningEnd: '23:00',
            announcement: '',
            earlyArrivalMinutes: 10,
            inCourtWindowMinutes: 5,
            securityPasscode: 'gate2026',
            walkInPasscode: 'walk2026',
            walkInCancelCode: 'cancel2026',
            trainingOverrideCode: 'train2026',
            adminPasscode: '8309762055',
            facilityRules: DEFAULT_FACILITY_RULES,
          })
          .onConflictDoNothing();
      } else {
        const curRules = Array.isArray(existingPolicy[0].facilityRules)
          ? existingPolicy[0].facilityRules
          : [];
        const hasCollegeCancelRule = curRules.some((r) => r.id === 'rule-college-cancel');
        if (curRules.length === 0) {
          await db
            .update(appPolicy)
            .set({ facilityRules: DEFAULT_FACILITY_RULES })
            .where(eq(appPolicy.id, 1));
        } else if (!hasCollegeCancelRule) {
          const collegeRule = DEFAULT_FACILITY_RULES.find((r) => r.id === 'rule-college-cancel')!;
          await db
            .update(appPolicy)
            .set({ facilityRules: [...curRules, collegeRule] })
            .where(eq(appPolicy.id, 1));
        }
      }

      const existingBookings = await db.select().from(bookings).limit(1);
      if (existingBookings.length === 0) {
        const cycleDate = getFiveAmCycleDate(0);
        await db
          .insert(bookings)
          .values([
            {
              id: 'BK-4102',
              bookingCode: 100,
              codeCycleDate: cycleDate,
              date: today,
              sportId: 'badminton',
              sportName: 'Badminton',
              courtId: 'badminton-c1',
              courtName: 'Court 1',
              slotId: '18:00',
              slotLabel: '6:00 PM – 7:00 PM',
              isLateNight: false,
              bookedByRollNo: '23CS101',
              bookedByName: 'Aarav Sharma',
              bookedByEmail: 'aarav.23cs101@campus.edu.in',
              players: [
                { rollNo: '23CS101', name: 'Aarav Sharma' },
                { rollNo: '23CS102', name: 'Diya Nair' },
              ],
              status: 'confirmed',
              payment: null,
              rulesAcceptedAt: nowIso,
              securityStatus: 'pending',
              autoAdmitAt: computeBookingAutoAdmitIso(today, '18:00', 0),
            },
            {
              id: 'BK-4108',
              bookingCode: 101,
              codeCycleDate: cycleDate,
              date: today,
              sportId: 'badminton',
              sportName: 'Badminton',
              courtId: 'badminton-c2',
              courtName: 'Court 2',
              slotId: '23:00',
              slotLabel: '11:00 PM – 12:00 AM',
              isLateNight: true,
              bookedByRollNo: '24CS105',
              bookedByName: 'Meera Iyer',
              bookedByEmail: 'meera.24cs105@campus.edu.in',
              players: [
                { rollNo: '24CS105', name: 'Meera Iyer' },
                { rollNo: '24AI304', name: 'Neha Kapoor' },
              ],
              status: 'confirmed',
              payment: {
                method: 'upi',
                amount: 250,
                transactionId: 'UPI-98412031',
                detailsMasked: 'meera.iyer@okaxis',
                paidAt: nowIso,
              },
              rulesAcceptedAt: nowIso,
              securityStatus: 'pending',
              autoAdmitAt: computeBookingAutoAdmitIso(today, '23:00', 0),
            },
            {
              id: 'BK-4115',
              bookingCode: 102,
              codeCycleDate: cycleDate,
              date: today,
              sportId: 'box-football',
              sportName: 'Box Football',
              courtId: 'football-t1',
              courtName: 'Turf North',
              slotId: '23:00',
              slotLabel: '11:00 PM – 12:00 AM',
              isLateNight: true,
              bookedByRollNo: '23EC202',
              bookedByName: 'Kabir Mehta',
              bookedByEmail: 'kabir.23ec202@campus.edu.in',
              players: [
                { rollNo: '23EC202', name: 'Kabir Mehta' },
                { rollNo: '23ME301', name: 'Vikram Singh' },
                { rollNo: '23ME302', name: 'Siddharth Rao' },
                { rollNo: '24CS106', name: 'Arjun Reddy' },
                { rollNo: '24IT202', name: 'Pranav Joshi' },
                { rollNo: '24EE401', name: 'Karthik Subramanian' },
              ],
              status: 'confirmed',
              payment: {
                method: 'card',
                amount: 600,
                transactionId: 'CARD-77319042',
                detailsMasked: 'Card •••• 4821',
                paidAt: nowIso,
              },
              rulesAcceptedAt: nowIso,
              securityStatus: 'pending',
              autoAdmitAt: computeBookingAutoAdmitIso(today, '23:00', 0),
            },
          ])
          .onConflictDoNothing();
      }

      const existingGames = await db.select().from(openGames).limit(1);
      if (existingGames.length === 0) {
        await db
          .insert(openGames)
          .values([
            {
              id: 'MATCH-301',
              date: today,
              sportId: 'badminton',
              sportName: 'Badminton',
              slotId: '19:00',
              slotLabel: '07:00 PM – 08:00 PM',
              hostRollNo: '23CS103',
              hostName: 'Rohan Kulkarni',
              players: [
                { rollNo: '23CS103', name: 'Rohan Kulkarni' },
                { rollNo: '24CS106', name: 'Arjun Reddy' },
              ],
              spotsNeeded: 4,
              skillLevel: 'Intermediate Doubles',
              note: 'Looking for 2 more doubles players. Have extra Yonex Mavis 350 shuttles.',
              status: 'open',
            },
            {
              id: 'MATCH-302',
              date: today,
              sportId: 'box-football',
              sportName: 'Box Football',
              slotId: '21:00',
              slotLabel: '09:00 PM – 10:00 PM',
              hostRollNo: '23EC202',
              hostName: 'Kabir Mehta',
              players: [
                { rollNo: '23EC202', name: 'Kabir Mehta' },
                { rollNo: '23ME301', name: 'Vikram Singh' },
                { rollNo: '23ME302', name: 'Siddharth Rao' },
              ],
              spotsNeeded: 6,
              skillLevel: 'Casual 6v6',
              note: 'Need 3 active IDs to lock Turf South at 9 PM. Turf studs required.',
              status: 'open',
            },
          ])
          .onConflictDoNothing();
      }

      await db
        .insert(blockedSlots)
        .values({
          id: 'BLK-101',
          date: today,
          sportId: 'badminton',
          courtId: 'badminton-c3',
          slotId: '16:00',
          reason: 'Varsity Team Practice',
        })
        .onConflictDoNothing();

      const existingLogs = await db.select().from(activityLogs).limit(1);
      if (existingLogs.length === 0) {
        await db
          .insert(activityLogs)
          .values([
            {
              id: 'ACT-1',
              type: 'payment',
              summary: 'Box Football Turf North (23:00) paid ₹600 via Card',
              actor: 'Kabir Mehta (23EC202)',
            },
            {
              id: 'ACT-2',
              type: 'payment',
              summary: 'Badminton Court 2 (23:00) paid ₹250 via UPI',
              actor: 'Meera Iyer (24CS105)',
            },
            {
              id: 'ACT-3',
              type: 'booking',
              summary: 'Badminton Court 1 (18:00) reserved (2 players)',
              actor: 'Aarav Sharma (23CS101)',
            },
          ])
          .onConflictDoNothing();
      }

      seededDone = true;
    } catch (error) {
      seedPromise = null;
      console.error('Failed to seed sports database:', error);
      throw new Error('Failed to initialize facility catalog.', { cause: error });
    }
  })();

  return seedPromise;
}

function mapBookingRow(row: typeof bookings.$inferSelect): Booking {
  return {
    id: row.id,
    bookingCode: row.bookingCode ?? null,
    date: row.date,
    sportId: row.sportId,
    sportName: row.sportName,
    courtId: row.courtId,
    courtName: row.courtName,
    slotId: row.slotId,
    slotLabel: row.slotLabel,
    isLateNight: row.isLateNight,
    bookedByRollNo: row.bookedByRollNo,
    bookedByName: row.bookedByName,
    bookedByEmail: row.bookedByEmail,
    players: row.players,
    status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
    cancelReason: row.cancelReason || undefined,
    cancelledBy:
      row.cancelledBy === 'admin'
        ? 'admin'
        : row.cancelledBy === 'walkin'
          ? 'walkin'
          : row.cancelledBy === 'student'
            ? 'student'
            : undefined,
    payment: row.payment,
    rulesAcceptedAt: row.rulesAcceptedAt,
    inCourtAt: row.inCourtAt || null,
    inCourtByRollNo: row.inCourtByRollNo || null,
    securityStatus:
      row.securityStatus === 'admitted'
        ? 'admitted'
        : row.securityStatus === 'no_show'
          ? 'no_show'
          : 'pending',
    securityCheckedInAt: row.securityCheckedInAt || null,
    securityNotes: row.securityNotes || null,
    autoAdmitAt: row.autoAdmitAt || null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapStudentRow(
  row: typeof students.$inferSelect,
  referenceDate: string = getTodayUtcYmd()
): Student {
  const effectiveStatus = computeEffectiveRosterStatus(row, referenceDate);
  const paymentDate =
    row.paymentDate ||
    (row.status !== 'expired' && row.status !== 'inactive' ? row.subscriptionStartDate || null : null);
  const subscriptionStartDate =
    row.subscriptionStartDate || paymentDate || null;
  const subscriptionEndDate =
    row.subscriptionEndDate || (paymentDate ? addOneYearDate(paymentDate) : null);
  const banned = isBanActive(row, referenceDate);
  const banScope: 'none' | 'all' | 'selected' = banned
    ? row.banScope === 'selected'
      ? 'selected'
      : 'all'
    : 'none';

  return {
    id: row.id,
    rollNo: row.rollNo,
    idNo: row.idNo || null,
    name: row.name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    year: row.year,
    details: row.details,
    status: effectiveStatus,
    paymentDate,
    subscriptionStartDate,
    subscriptionEndDate,
    isBanned: banned,
    banScope,
    bannedSports: banned && Array.isArray(row.bannedSports) ? row.bannedSports : [],
    banUntil: banned ? row.banUntil || null : null,
    banReason: banned ? row.banReason || null : null,
    bannedAt: banned ? row.bannedAt || null : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapLightRequestRow(row: typeof lightRequests.$inferSelect): LightRequest {
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingCode: row.bookingCode ?? null,
    date: row.date,
    sportId: row.sportId,
    sportName: row.sportName,
    courtId: row.courtId,
    courtName: row.courtName,
    slotId: row.slotId,
    slotLabel: row.slotLabel,
    requestedByRollNo: row.requestedByRollNo,
    requestedByName: row.requestedByName,
    note: row.note,
    status: row.status === 'closed' ? 'closed' : 'open',
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt || null,
  };
}

function mapOpenGameRow(row: typeof openGames.$inferSelect): OpenGame {
  return {
    id: row.id,
    date: row.date,
    sportId: row.sportId,
    sportName: row.sportName,
    slotId: row.slotId,
    slotLabel: row.slotLabel,
    hostRollNo: row.hostRollNo,
    hostName: row.hostName,
    players: row.players,
    spotsNeeded: row.spotsNeeded,
    skillLevel: row.skillLevel,
    note: row.note,
    status:
      row.status === 'booked' ? 'booked' : row.status === 'closed' ? 'closed' : 'open',
    bookingId: row.bookingId || null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getSportsWithCourts(): Promise<Sport[]> {
  try {
    await ensureSeeded();
    const sportRows = await db.select().from(sports).orderBy(asc(sports.sortOrder), asc(sports.name));
    const courtRows = await db.select().from(courts).orderBy(asc(courts.sortOrder), asc(courts.name));

    return sportRows.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      minPlayers: s.minPlayers,
      maxPlayers: s.maxPlayers,
      lateNightFee: s.lateNightFee,
      equipmentRequired: s.equipmentRequired,
      location: s.location,
      courts: courtRows
        .filter((c) => c.sportId === s.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          surface: c.surface,
          status: c.status === 'maintenance' ? 'maintenance' : 'operational',
        })),
    }));
  } catch (error) {
    console.error('Failed to fetch sports & courts:', error);
    throw new Error('Failed to load sports facilities.', { cause: error });
  }
}

export async function getPolicy(includeAdminFields = false): Promise<BookingPolicy> {
  try {
    await ensureSeeded();
    const rows = await db.select().from(appPolicy).where(eq(appPolicy.id, 1)).limit(1);
    if (rows.length === 0) {
      return {
        sameDayOnly: true,
        openingHour: 8,
        morningBookingOpenHour: 3,
        eveningBookingOpenHour: 8,
        enforceOpeningHour: true,
        weekdayMorningStart: '05:00',
        weekdayMorningEnd: '09:30',
        weekdayEveningStart: '16:00',
        weekdayEveningEnd: '23:00',
        weekendMorningStart: '05:00',
        weekendMorningEnd: '12:00',
        weekendEveningStart: '17:00',
        weekendEveningEnd: '23:00',
        announcement: '',
        earlyArrivalMinutes: 10,
        inCourtWindowMinutes: 5,
        ...(includeAdminFields
          ? {
              adminPasscode: process.env.ADMIN_PASSWORD || '8309762055',
              securityPasscode: 'gate2026',
              walkInPasscode: 'walk2026',
              walkInCancelCode: 'cancel2026',
              trainingOverrideCode: 'train2026',
              gmailSenderEmail: '',
              gmailAutoSend: true,
              gmailConnectionMode: 'smtp' as const,
              gmailHasAppPassword: false,
            }
          : {}),
        facilityRules: DEFAULT_FACILITY_RULES,
      };
    }
    const r = rows[0];
    return {
      sameDayOnly: r.sameDayOnly,
      openingHour: r.eveningBookingOpenHour ?? r.openingHour ?? 8,
      morningBookingOpenHour: r.morningBookingOpenHour ?? 3,
      eveningBookingOpenHour: r.eveningBookingOpenHour ?? r.openingHour ?? 8,
      enforceOpeningHour: r.enforceOpeningHour,
      weekdayMorningStart: r.weekdayMorningStart || '05:00',
      weekdayMorningEnd: r.weekdayMorningEnd || '09:30',
      weekdayEveningStart: r.weekdayEveningStart || '16:00',
      weekdayEveningEnd: r.weekdayEveningEnd || '23:00',
      weekendMorningStart: r.weekendMorningStart || '05:00',
      weekendMorningEnd: r.weekendMorningEnd || '12:00',
      weekendEveningStart: r.weekendEveningStart || '17:00',
      weekendEveningEnd: r.weekendEveningEnd || '23:00',
      announcement: r.announcement,
      earlyArrivalMinutes: r.earlyArrivalMinutes ?? 10,
      inCourtWindowMinutes: r.inCourtWindowMinutes ?? 5,
      ...(includeAdminFields
        ? {
            adminPasscode: r.adminPasscode || process.env.ADMIN_PASSWORD || '8309762055',
            securityPasscode: r.securityPasscode || 'gate2026',
            walkInPasscode: r.walkInPasscode || 'walk2026',
            walkInCancelCode: r.walkInCancelCode || 'cancel2026',
            trainingOverrideCode: r.trainingOverrideCode || 'train2026',
            gmailSenderEmail: r.gmailSenderEmail || '',
            gmailAutoSend: r.gmailAutoSend ?? true,
            gmailConnectionMode:
              r.gmailConnectionMode === 'oauth' ? ('oauth' as const) : ('smtp' as const),
            gmailHasAppPassword: Boolean(r.gmailAppPasswordEnc),
          }
        : {}),
      facilityRules:
        Array.isArray(r.facilityRules) && r.facilityRules.length > 0
          ? r.facilityRules
          : DEFAULT_FACILITY_RULES,
    };
  } catch (error) {
    console.error('Failed to fetch policy:', error);
    throw new Error('Failed to load booking policy.', { cause: error });
  }
}

export async function verifyAdminPasscode(passcode: string): Promise<boolean> {
  const policy = await getPolicy(true);
  const expected = policy.adminPasscode || process.env.ADMIN_PASSWORD || '8309762055';
  return passcode.trim() === expected;
}

export async function verifySecurityPasscode(passcode: string): Promise<boolean> {
  const policy = await getPolicy(true);
  const expected = policy.securityPasscode || process.env.SECURITY_PASSWORD || 'gate2026';
  return passcode.trim() === expected;
}

export async function verifyWalkInPasscode(passcode: string): Promise<boolean> {
  const policy = await getPolicy(true);
  const expected = policy.walkInPasscode || process.env.WALKIN_PASSWORD || 'walk2026';
  return passcode.trim() === expected;
}

export async function verifyWalkInCancelCode(code: string): Promise<boolean> {
  const policy = await getPolicy(true);
  const expected = policy.walkInCancelCode || 'cancel2026';
  return code.trim() === expected;
}

export async function verifyTrainingOverrideCode(code: string): Promise<boolean> {
  const policy = await getPolicy(true);
  const expected = policy.trainingOverrideCode || 'train2026';
  return code.trim() === expected;
}

export async function autoAdmitOverduePendingBookings(): Promise<number> {
  try {
    await ensureSeeded();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const pendingRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.status, 'confirmed'), eq(bookings.securityStatus, 'pending')));

    const dueRows = pendingRows.filter((row) => {
      if (row.autoAdmitAt) {
        const ts = Date.parse(row.autoAdmitAt);
        return Number.isFinite(ts) && ts <= nowMs;
      }
      return row.createdAt.getTime() + 30 * 60_000 <= nowMs;
    });

    if (dueRows.length === 0) return 0;

    for (const row of dueRows) {
      await db
        .update(bookings)
        .set({
          securityStatus: 'admitted',
          securityCheckedInAt: nowIso,
          securityNotes: row.securityNotes
            ? `${row.securityNotes} · Auto-admitted (30m timeout)`
            : 'Auto-admitted after 30 mins pending',
        })
        .where(
          and(
            eq(bookings.id, row.id),
            eq(bookings.status, 'confirmed'),
            eq(bookings.securityStatus, 'pending')
          )
        );

      await db.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'security',
        summary: `Auto-admitted ${row.bookingCode ? `#${row.bookingCode} ` : ''}${row.sportName} ${row.courtName} (${row.slotId}) after 30 mins pending`,
        actor: `${row.bookedByName} (${row.bookedByRollNo})`,
      });
    }

    return dueRows.length;
  } catch (error) {
    console.error('Failed auto-admit sweep:', error);
    return 0;
  }
}

export async function getRosterDirectory(): Promise<RosterEntry[]> {
  try {
    await ensureSeeded();
    const today = getTodayUtcYmd();
    const rows = await db.select().from(students).orderBy(asc(students.rollNo));
    return rows.map((s) => {
      const effStatus = computeEffectiveRosterStatus(s, today);
      const paymentDate =
        s.paymentDate ||
        (s.status !== 'expired' && s.status !== 'inactive' ? s.subscriptionStartDate || null : null);
      const banned = isBanActive(s, today);
      const banScope: 'none' | 'all' | 'selected' = banned
        ? s.banScope === 'selected'
          ? 'selected'
          : 'all'
        : 'none';
      return {
        rollNo: s.rollNo,
        idNo: s.idNo || null,
        name: s.name,
        department: s.department,
        year: s.year,
        status: effStatus,
        paymentDate,
        subscriptionStartDate: s.subscriptionStartDate || paymentDate,
        subscriptionEndDate: s.subscriptionEndDate || (paymentDate ? addOneYearDate(paymentDate) : null),
        isBanned: banned,
        banScope,
        bannedSports: banned && Array.isArray(s.bannedSports) ? s.bannedSports : [],
        banUntil: banned ? s.banUntil || null : null,
        banReason: banned ? s.banReason || null : null,
        bannedAt: banned ? s.bannedAt || null : null,
      };
    });
  } catch (error) {
    console.error('Failed to fetch roster directory:', error);
    throw new Error('Failed to load student directory.', { cause: error });
  }
}

export async function validatePlayers(
  date: string,
  slotId: string,
  rollNos: string[],
  sportId?: string
): Promise<{ results: PlayerValidationResult[]; allValid: boolean }> {
  try {
    await ensureSeeded();
    const today = getTodayUtcYmd();
    const [allStudents, allSports, slotBookings] = await Promise.all([
      db.select().from(students),
      db.select().from(sports),
      db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.date, date),
            eq(bookings.slotId, slotId),
            eq(bookings.status, 'confirmed')
          )
        ),
    ]);
    const sportNameById = new Map(allSports.map((sp) => [sp.id, sp.name]));

    const seen = new Map<string, number>();
    const normalizedList = rollNos.map(normalizeRollNo);
    for (const r of normalizedList) {
      if (r) seen.set(r, (seen.get(r) || 0) + 1);
    }

    const results: PlayerValidationResult[] = normalizedList.map((roll) => {
      if (!roll) {
        return {
          rollNo: '',
          valid: false,
          status: 'empty',
          message: 'Enter a valid student Roll No.',
        };
      }
      if ((seen.get(roll) || 0) > 1) {
        return {
          rollNo: roll,
          valid: false,
          status: 'duplicate',
          message: `Duplicate ID ${roll} in this booking.`,
        };
      }

      const student = allStudents.find(
        (s) =>
          normalizeRollNo(s.rollNo) === roll ||
          (s.idNo ? normalizeRollNo(s.idNo) === roll : false)
      );
      if (!student) {
        return {
          rollNo: roll,
          valid: false,
          status: 'not_found',
          message: `Roll No ${roll} is not in the official college Sports Roster.`,
        };
      }

      const effStatus = computeEffectiveRosterStatus(student, today);
      if (effStatus === 'suspended') {
        return {
          rollNo: student.rollNo,
          valid: false,
          status: 'suspended',
          studentName: student.name,
          department: student.department,
          message: `ID ${student.rollNo} (${student.name}) is currently suspended.`,
        };
      }
      if (effStatus === 'expired' || effStatus === 'inactive') {
        return {
          rollNo: student.rollNo,
          valid: false,
          status: 'expired',
          studentName: student.name,
          department: student.department,
          message: student.subscriptionEndDate
            ? `ID ${student.rollNo} (${student.name}) 1-year payment expired on ${student.subscriptionEndDate}. Admin must click Paid in Roster to reactivate.`
            : `ID ${student.rollNo} (${student.name}) is deactivated (unpaid). Admin must click Paid in Roster to activate.`,
        };
      }

      if (isBanActive(student, today)) {
        const isAllSports = student.banScope === 'all';
        const bannedList = Array.isArray(student.bannedSports) ? student.bannedSports : [];
        const matchesSelectedSport = Boolean(sportId && bannedList.includes(sportId));
        if (isAllSports || matchesSelectedSport || (!sportId && bannedList.length > 0)) {
          const scopeLabel = isAllSports
            ? 'all sports'
            : (sportId && sportNameById.get(sportId)) ||
              bannedList.map((id) => sportNameById.get(id) || id).join(', ');
          return {
            rollNo: student.rollNo,
            valid: false,
            status: 'banned',
            studentName: student.name,
            department: student.department,
            message: `${student.name} (${student.rollNo}) is temporarily banned from ${scopeLabel} through ${student.banUntil}${
              student.banReason ? ` · Reason: ${student.banReason}` : ''
            }.`,
          };
        }
      }

      const normCanonical = normalizeRollNo(student.rollNo);
      const conflictBooking = slotBookings.find((b) =>
        b.players.some((p) => {
          const pr = normalizeRollNo(p.rollNo);
          return pr === roll || pr === normCanonical;
        })
      );
      if (conflictBooking) {
        return {
          rollNo: student.rollNo,
          valid: false,
          status: 'conflict',
          studentName: student.name,
          department: student.department,
          message: `${student.name} (${student.rollNo}) is already booked on ${conflictBooking.sportName} (${conflictBooking.courtName}) for this hour.`,
        };
      }

      return {
        rollNo: student.rollNo,
        valid: true,
        status: 'active',
        studentName: student.name,
        department: student.department,
        message: `Active ID · ${student.name} (${student.department})`,
      };
    });

    const allValid = results.length > 0 && results.every((r) => r.valid);
    return { results, allValid };
  } catch (error) {
    console.error('Failed to validate player IDs:', error);
    throw new Error('Failed to verify teammate IDs.', { cause: error });
  }
}

export async function getAvailability(date: string): Promise<{
  bookings: PublicSlotBooking[];
  blockedSlots: BlockedSlot[];
  policy: BookingPolicy;
}> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    const bookingRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.date, date), eq(bookings.status, 'confirmed')));
    const blockRows = await db
      .select()
      .from(blockedSlots)
      .where(eq(blockedSlots.date, date));
    const policy = await getPolicy(false);

    return {
      bookings: bookingRows.map((b) => ({
        id: b.id,
        bookingCode: b.bookingCode ?? null,
        date: b.date,
        sportId: b.sportId,
        courtId: b.courtId,
        slotId: b.slotId,
        bookedByName: b.bookedByName,
        bookedByRollNo: b.bookedByRollNo,
        players: b.players,
        playerCount: b.players.length,
        isLateNight: b.isLateNight,
        inCourtAt: b.inCourtAt || null,
        securityStatus:
          b.securityStatus === 'admitted'
            ? 'admitted'
            : b.securityStatus === 'no_show'
              ? 'no_show'
              : 'pending',
      })),
      blockedSlots: blockRows.map((blk) => ({
        id: blk.id,
        date: blk.date,
        sportId: blk.sportId,
        courtId: blk.courtId,
        slotId: blk.slotId,
        reason: blk.reason,
        createdAt: blk.createdAt.toISOString(),
      })),
      policy,
    };
  } catch (error) {
    console.error('Failed to load availability:', error);
    throw new Error('Failed to load court availability.', { cause: error });
  }
}

export async function getStudentBookings(
  rollNo: string,
  tzOffsetMinutes = 0
): Promise<Booking[]> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    await purgeExpiredBookingsOlderThan30Days(tzOffsetMinutes);
    const norm = normalizeRollNo(rollNo);
    if (!norm) return [];
    const cutoff30 = getDateDaysAgoString(29, tzOffsetMinutes);
    const allRows = await db.select().from(bookings).orderBy(desc(bookings.createdAt));
    return allRows
      .filter(
        (b) =>
          b.date >= cutoff30 &&
          (normalizeRollNo(b.bookedByRollNo) === norm ||
            b.players.some((p) => normalizeRollNo(p.rollNo) === norm))
      )
      .map(mapBookingRow);
  } catch (error) {
    console.error('Failed to fetch student bookings:', error);
    throw new Error('Failed to load your bookings.', { cause: error });
  }
}

export async function createBookingTransactional(params: {
  date: string;
  tzOffsetMinutes: number;
  sportId: string;
  courtId: string;
  slotId: string;
  bookedByUid: string | null;
  bookedByRollNo: string;
  players: { rollNo: string; name?: string }[];
  rulesAccepted: boolean;
  payment?: {
    method: 'upi' | 'card';
    upiId?: string;
    cardNumber?: string;
    cardExpiry?: string;
    cardCvv?: string;
    cardHolder?: string;
  } | null;
}): Promise<{
  booking?: Booking;
  errorStatus?: number;
  errorMessage?: string;
  validationResults?: PlayerValidationResult[];
}> {
  try {
    await ensureSeeded();

    const policy = await getPolicy(false);
    const localToday = getTodayDateString(params.tzOffsetMinutes);
    const { hour, minute } = getLocalHourAndMinute(params.tzOffsetMinutes);
    const effectiveHour = getSportsDayEffectiveHour(hour, minute);

    if (policy.sameDayOnly && params.date !== localToday) {
      return {
        errorStatus: 403,
        errorMessage: `Advance pre-booking is disabled. Bookings are only accepted for today (${localToday}).`,
      };
    }

    const slot = TIME_SLOTS.find((t) => t.id === params.slotId);
    if (!slot) return { errorStatus: 404, errorMessage: 'Selected slot is invalid.' };

    const dayWindows = getDayScheduleWindows(params.date, policy);
    const slotOp = getSlotOperationalState(slot, params.date, policy);

    if (slotOp.isMaintenance) {
      return {
        errorStatus: 409,
        errorMessage: `Facilities are closed for scheduled maintenance (${dayWindows.maintenanceRangeLabel}) on ${
          dayWindows.isWeekend ? 'Weekends' : 'Weekdays'
        }.`,
      };
    }

    if (policy.enforceOpeningHour && effectiveHour < slotOp.unlockHour) {
      const slotKindLabel = slotOp.type === 'morning' ? 'Morning' : 'Evening & Late-Night';
      return {
        errorStatus: 403,
        errorMessage: `${slotKindLabel} slots open today at ${slotOp.unlockLabel}. Please try again once booking unlocks.`,
      };
    }

    if (!params.rulesAccepted) {
      return {
        errorStatus: 400,
        errorMessage: 'You must accept the facility arrival and equipment rules before booking.',
      };
    }

    const sportRows = await db.select().from(sports).where(eq(sports.id, params.sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) return { errorStatus: 404, errorMessage: 'Selected sport not found.' };

    const courtRows = await db
      .select()
      .from(courts)
      .where(and(eq(courts.id, params.courtId), eq(courts.sportId, params.sportId)))
      .limit(1);
    const court = courtRows[0];
    if (!court) return { errorStatus: 404, errorMessage: 'Selected court not found.' };
    if (court.status !== 'operational') {
      return { errorStatus: 409, errorMessage: `${court.name} is currently closed for maintenance.` };
    }

    const captainRoll = normalizeRollNo(params.bookedByRollNo);
    const captainRows = await db
      .select()
      .from(students)
      .where(
        sql`UPPER(${students.rollNo}) = ${captainRoll} OR UPPER(COALESCE(${students.idNo}, '')) = ${captainRoll}`
      )
      .limit(1);
    const captain = captainRows[0];
    if (!captain) {
      return {
        errorStatus: 403,
        errorMessage: `Roll No ${captainRoll} is not in the official Sports Roster yet. Contact Sports Admin to activate your ID before booking.`,
      };
    }
    const todayUtc = getTodayUtcYmd();
    const captainEffStatus = computeEffectiveRosterStatus(captain, todayUtc);
    if (captainEffStatus === 'suspended') {
      return {
        errorStatus: 403,
        errorMessage: `Roll No ${captain.rollNo} is currently suspended and cannot book courts.`,
      };
    }
    if (captainEffStatus === 'expired' || captainEffStatus === 'inactive') {
      return {
        errorStatus: 403,
        errorMessage: captain.subscriptionEndDate
          ? `Your 1-year Sports Roster pass (${captain.rollNo}) expired on ${captain.subscriptionEndDate}. Ask Sports Admin to mark Paid in Roster.`
          : `Your Sports Roster pass (${captain.rollNo}) is currently deactivated (unpaid). Ask Sports Admin to mark Paid in Roster before booking.`,
      };
    }
    if (isStudentBannedForSport(captain, sport.id, todayUtc)) {
      return {
        errorStatus: 403,
        errorMessage:
          captain.banScope === 'all'
            ? `Your Sports ID (${captain.rollNo}) is temporarily banned across all sports until ${captain.banUntil}${
                captain.banReason ? ` (${captain.banReason})` : ''
              }.`
            : `Your Sports ID (${captain.rollNo}) is temporarily banned from ${sport.name} until ${captain.banUntil}${
                captain.banReason ? ` (${captain.banReason})` : ''
              }.`,
      };
    }

    if (params.players.length < sport.minPlayers) {
      return {
        errorStatus: 400,
        errorMessage: `${sport.name} requires at least ${sport.minPlayers} active player IDs (including you).`,
      };
    }
    if (params.players.length > sport.maxPlayers) {
      return {
        errorStatus: 400,
        errorMessage: `${sport.name} allows at most ${sport.maxPlayers} players per court booking.`,
      };
    }

    const rollList = params.players.map((p) => p.rollNo);
    const validation = await validatePlayers(params.date, params.slotId, rollList, sport.id);
    if (!validation.allValid) {
      const firstErr = validation.results.find((r) => !r.valid);
      return {
        errorStatus: 400,
        errorMessage: firstErr?.message || 'One or more teammate IDs failed active validation.',
        validationResults: validation.results,
      };
    }

    let verifiedPayment: Booking['payment'] = null;
    if (slot.isLateNight) {
      if (!params.payment || (params.payment.method !== 'upi' && params.payment.method !== 'card')) {
        return {
          errorStatus: 402,
          errorMessage: `Slots after 11:00 PM require a ₹${sport.lateNightFee} late-night access payment via UPI or Card.`,
        };
      }
      if (params.payment.method === 'upi') {
        const upi = (params.payment.upiId || '').trim();
        if (!upi || !upi.includes('@') || upi.length < 5) {
          return {
            errorStatus: 400,
            errorMessage: 'Enter a valid UPI ID (e.g. name@okaxis) to complete payment.',
          };
        }
        verifiedPayment = {
          method: 'upi',
          amount: sport.lateNightFee,
          transactionId: `UPI-${Math.floor(10000000 + Math.random() * 89999999)}`,
          detailsMasked: upi,
          paidAt: new Date().toISOString(),
        };
      } else {
        const digits = (params.payment.cardNumber || '').replace(/\D/g, '');
        const cvv = (params.payment.cardCvv || '').replace(/\D/g, '');
        const expiry = (params.payment.cardExpiry || '').trim();
        if (digits.length < 12 || digits.length > 19 || cvv.length < 3 || expiry.length < 4) {
          return {
            errorStatus: 400,
            errorMessage: 'Enter valid Card Number, Expiry (MM/YY), and CVV.',
          };
        }
        verifiedPayment = {
          method: 'card',
          amount: sport.lateNightFee,
          transactionId: `CARD-${Math.floor(10000000 + Math.random() * 89999999)}`,
          detailsMasked: `Card •••• ${digits.slice(-4)}`,
          paidAt: new Date().toISOString(),
        };
      }
    }

    const resolvedPlayers = validation.results.map((r) => ({
      rollNo: r.rollNo,
      name: r.studentName || r.rollNo,
    }));

    const txResult = await db.transaction(async (tx) => {
      const existingCourtBooking = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            eq(bookings.date, params.date),
            eq(bookings.sportId, sport.id),
            eq(bookings.courtId, court.id),
            eq(bookings.slotId, slot.id)
          )
        )
        .limit(1);

      if (existingCourtBooking.length > 0) {
        return {
          errorStatus: 409,
          errorMessage: `Double-booking prevented: ${sport.name} · ${court.name} (${slot.label}) was just reserved by ${existingCourtBooking[0].bookedByName}.`,
        };
      }

      const adminBlock = await tx
        .select()
        .from(blockedSlots)
        .where(
          and(
            eq(blockedSlots.date, params.date),
            eq(blockedSlots.sportId, sport.id),
            eq(blockedSlots.courtId, court.id),
            eq(blockedSlots.slotId, slot.id)
          )
        )
        .limit(1);

      if (adminBlock.length > 0) {
        return {
          errorStatus: 409,
          errorMessage: `This slot is blocked by administration: ${adminBlock[0].reason}.`,
        };
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(784512)`);
      const cycleDate = getFiveAmCycleDate(params.tzOffsetMinutes);
      const maxRow = await tx
        .select({ maxCode: sql<number>`COALESCE(MAX(${bookings.bookingCode}), 99)` })
        .from(bookings)
        .where(eq(bookings.codeCycleDate, cycleDate));
      const nextBookingCode = Math.max(99, Number(maxRow[0]?.maxCode ?? 99)) + 1;

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const autoAdmitAt = computeBookingAutoAdmitIso(
        params.date,
        slot.id,
        params.tzOffsetMinutes,
        nowMs
      );
      const inserted = await tx
        .insert(bookings)
        .values({
          id: `BK-${Math.floor(1000 + Math.random() * 9000)}`,
          bookingCode: nextBookingCode,
          codeCycleDate: cycleDate,
          date: params.date,
          sportId: sport.id,
          sportName: sport.name,
          courtId: court.id,
          courtName: court.name,
          slotId: slot.id,
          slotLabel: slotOp.effectiveLabel,
          isLateNight: slot.isLateNight,
          bookedByUid: params.bookedByUid,
          bookedByRollNo: captain.rollNo,
          bookedByName: captain.name,
          bookedByEmail: captain.email,
          players: resolvedPlayers,
          status: 'confirmed',
          payment: verifiedPayment,
          rulesAcceptedAt: nowIso,
          securityStatus: 'pending',
          autoAdmitAt,
        })
        .returning();

      await tx.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: verifiedPayment ? 'payment' : 'booking',
        summary: `#${nextBookingCode} ${sport.name} ${court.name} (${slotOp.effectiveShortLabel}) ${
          verifiedPayment
            ? `paid ₹${verifiedPayment.amount} via ${verifiedPayment.method.toUpperCase()}`
            : 'booked'
        }`,
        actor: `${captain.name} (${captain.rollNo})`,
      });

      return { booking: mapBookingRow(inserted[0]) };
    });

    return txResult;
  } catch (error) {
    console.error('Failed to create booking:', error);
    throw new Error('Failed to confirm court reservation.', { cause: error });
  }
}

export async function markBookingInCourt(params: {
  bookingId: string;
  rollNo: string;
  tzOffsetMinutes: number;
}): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
    if (existing.status !== 'confirmed') {
      return { errorStatus: 400, errorMessage: 'Cancelled bookings cannot be checked into court.' };
    }

    const norm = normalizeRollNo(params.rollNo);
    const isMember =
      normalizeRollNo(existing.bookedByRollNo) === norm ||
      existing.players.some((p) => normalizeRollNo(p.rollNo) === norm);
    if (!isMember) {
      return { errorStatus: 403, errorMessage: 'Only listed players on this pass can check in.' };
    }

    if (existing.inCourtAt) {
      return { booking: mapBookingRow(existing) };
    }

    const policy = await getPolicy(false);
    const preMins = Math.max(0, policy.inCourtWindowMinutes ?? 5);
    const localToday = getTodayDateString(params.tzOffsetMinutes);
    const { hour, minute } = getLocalHourAndMinute(params.tzOffsetMinutes);
    const slotObj = TIME_SLOTS.find((t) => t.id === existing.slotId);
    const slotStartHour = slotObj ? slotObj.startHour : Number(existing.slotId.split(':')[0]);

    // Calculate minutes on a continuous late-night day scale (hours 00:00..04:29 treated as 24..28 until 4:30 AM rollover)
    const effectiveNowHour = getSportsDayEffectiveHour(hour, minute);
    const effectiveSlotHour = getSportsDayEffectiveHour(slotStartHour, 0);
    const nowMinutes = effectiveNowHour * 60 + minute;
    const slotStartMinutes = effectiveSlotHour * 60;
    const earliestCheckIn = slotStartMinutes - preMins;
    const latestCheckIn = slotStartMinutes + 60;

    if (existing.date !== localToday) {
      return {
        errorStatus: 400,
        errorMessage: `In-Court arrival is only available on the reservation date (${existing.date}).`,
      };
    }

    if (nowMinutes < earliestCheckIn) {
      const opensTotalMins = earliestCheckIn;
      const openH24 = Math.floor(opensTotalMins / 60) % 24;
      const openM = opensTotalMins % 60;
      const suffix = openH24 >= 12 ? 'PM' : 'AM';
      const h12 = openH24 % 12 || 12;
      const openLabel = `${String(h12).padStart(2, '0')}:${String(openM).padStart(2, '0')} ${suffix}`;
      return {
        errorStatus: 400,
        errorMessage: `You can tap "In Court" starting ${preMins} mins before your slot begins (opens at ${openLabel}).`,
      };
    }

    if (nowMinutes > latestCheckIn) {
      return {
        errorStatus: 400,
        errorMessage: 'This 1-hour slot window has already ended.',
      };
    }

    const nowIso = new Date().toISOString();
    const updated = await db
      .update(bookings)
      .set({
        inCourtAt: nowIso,
        inCourtByRollNo: norm,
      })
      .where(eq(bookings.id, params.bookingId))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'checkin',
      summary: `${existing.sportName} ${existing.courtName} (${existing.slotId}) — player marked In Court`,
      actor: norm,
    });

    return { booking: mapBookingRow(updated[0]) };
  } catch (error) {
    console.error('Failed to mark booking in court:', error);
    throw new Error('Failed to mark court arrival.', { cause: error });
  }
}

export async function getSecurityGateWindow(
  tzOffsetMinutes: number,
  baseHourOverride?: number
): Promise<SecurityGateWindowData> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    const date = getTodayDateString(tzOffsetMinutes);
    const currentHour = getLocalHour(tzOffsetMinutes);
    const baseHour =
      typeof baseHourOverride === 'number' && !Number.isNaN(baseHourOverride)
        ? Math.max(0, Math.min(23, Math.floor(baseHourOverride)))
        : currentHour;

    const slotIdForHour = (h: number): string | null => {
      const normalized = ((h % 24) + 24) % 24;
      const match = TIME_SLOTS.find((t) => t.startHour === normalized);
      return match ? match.id : null;
    };

    const prevSlotId = slotIdForHour(baseHour - 1);
    const currentSlotId = slotIdForHour(baseHour);
    const nextSlotId = slotIdForHour(baseHour + 1);

    const activeIds = [prevSlotId, currentSlotId, nextSlotId].filter(Boolean) as string[];
    const windowSlots = activeIds
      .map((id) => TIME_SLOTS.find((t) => t.id === id)!)
      .filter(Boolean);

    const allSports = await getSportsWithCourts();
    const monitoredSports = allSports.filter((s) =>
      SECURITY_MONITORED_SPORT_IDS.includes(s.id)
    );

    const rows =
      activeIds.length > 0
        ? await db
            .select()
            .from(bookings)
            .where(
              and(
                eq(bookings.date, date),
                eq(bookings.status, 'confirmed'),
                inArray(bookings.sportId, SECURITY_MONITORED_SPORT_IDS),
                inArray(bookings.slotId, activeIds)
              )
            )
            .orderBy(asc(bookings.slotId), asc(bookings.courtName))
        : [];

    const lightRows = await db
      .select()
      .from(lightRequests)
      .orderBy(desc(lightRequests.createdAt))
      .limit(100);
    const mappedLights = lightRows
      .filter((l) => l.date >= date)
      .map(mapLightRequestRow);

    return {
      date,
      currentHour,
      baseHour,
      prevSlotId,
      currentSlotId,
      nextSlotId,
      windowSlots,
      monitoredSports,
      bookings: rows.map(mapBookingRow),
      openLightRequests: mappedLights.filter((l) => l.status === 'open'),
      allLightRequests: mappedLights,
    };
  } catch (error) {
    console.error('Failed to fetch security gate window:', error);
    throw new Error('Failed to load gate check-in schedule.', { cause: error });
  }
}

export async function createLightRequest(params: {
  bookingId: string;
  rollNo: string;
  note?: string;
}): Promise<{ request?: LightRequest; alreadyOpen?: boolean; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
    if (existing.status !== 'confirmed') {
      return { errorStatus: 400, errorMessage: 'Only confirmed bookings can request court lights.' };
    }

    const norm = normalizeRollNo(params.rollNo);
    const isMember =
      normalizeRollNo(existing.bookedByRollNo) === norm ||
      existing.players.some((p) => normalizeRollNo(p.rollNo) === norm);
    if (!isMember) {
      return { errorStatus: 403, errorMessage: 'Only players listed on this booking can request lights.' };
    }

    const openExisting = await db
      .select()
      .from(lightRequests)
      .where(and(eq(lightRequests.bookingId, existing.id), eq(lightRequests.status, 'open')))
      .limit(1);
    if (openExisting.length > 0) {
      return { request: mapLightRequestRow(openExisting[0]), alreadyOpen: true };
    }

    const stuRows = await db
      .select({ name: studentAccounts.name })
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, norm))
      .limit(1);
    const requesterName = stuRows[0]?.name || existing.bookedByName;

    const inserted = await db
      .insert(lightRequests)
      .values({
        id: `LGT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        bookingId: existing.id,
        bookingCode: existing.bookingCode ?? null,
        date: existing.date,
        sportId: existing.sportId,
        sportName: existing.sportName,
        courtId: existing.courtId,
        courtName: existing.courtName,
        slotId: existing.slotId,
        slotLabel: existing.slotLabel,
        requestedByRollNo: norm,
        requestedByName: requesterName,
        note: (params.note || 'Turn on / check court lights').trim(),
        status: 'open',
      })
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'security',
      summary: `Lights ON requested for ${existing.sportName} · ${existing.courtName} (${existing.slotLabel})`,
      actor: `${requesterName} (${norm})`,
    });

    return { request: mapLightRequestRow(inserted[0]), alreadyOpen: false };
  } catch (error) {
    console.error('Failed creating light request:', error);
    throw new Error('Failed to send lights request to gate.', { cause: error });
  }
}

export async function getSecurityLightRequests(tzOffsetMinutes = 0): Promise<{
  openLightRequests: LightRequest[];
  allLightRequests: LightRequest[];
}> {
  await ensureSeeded();
  const activeSportsDay = getTodayDateString(tzOffsetMinutes);
  const rows = await db
    .select()
    .from(lightRequests)
    .orderBy(desc(lightRequests.createdAt))
    .limit(100);
  const mapped = rows.filter((l) => l.date >= activeSportsDay).map(mapLightRequestRow);
  return {
    openLightRequests: mapped.filter((l) => l.status === 'open'),
    allLightRequests: mapped,
  };
}

export async function closeLightRequest(
  requestId: string
): Promise<{ request?: LightRequest; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(lightRequests)
      .where(eq(lightRequests.id, requestId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Light request not found.' };
    if (existing.status === 'closed') {
      return { request: mapLightRequestRow(existing) };
    }
    const updated = await db
      .update(lightRequests)
      .set({
        status: 'closed',
        closedAt: new Date().toISOString(),
      })
      .where(eq(lightRequests.id, requestId))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'security',
      summary: `Gate acknowledged & closed light request for ${existing.sportName} · ${existing.courtName}`,
      actor: 'Security Gate',
    });

    return { request: mapLightRequestRow(updated[0]) };
  } catch (error) {
    console.error('Failed closing light request:', error);
    throw new Error('Failed to close light request.', { cause: error });
  }
}

export async function updateSecurityGateStatus(params: {
  bookingId: string;
  securityStatus: SecurityCheckInStatus;
  notes?: string;
}): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
    if (existing.status !== 'confirmed') {
      return { errorStatus: 400, errorMessage: 'Cannot admit a cancelled reservation.' };
    }

    const nowMs = Date.now();
    const nowIso = params.securityStatus === 'admitted' ? new Date(nowMs).toISOString() : null;
    const nextAutoAdmitAt =
      params.securityStatus === 'pending'
        ? new Date(nowMs + 30 * 60_000).toISOString()
        : existing.autoAdmitAt;

    const updated = await db
      .update(bookings)
      .set({
        securityStatus: params.securityStatus,
        securityCheckedInAt: nowIso,
        securityNotes: (params.notes ?? existing.securityNotes ?? '').trim() || null,
        autoAdmitAt: nextAutoAdmitAt,
      })
      .where(eq(bookings.id, params.bookingId))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'security',
      summary: `Gate ${
        params.securityStatus === 'admitted'
          ? 'admitted'
          : params.securityStatus === 'no_show'
            ? 'marked no-show'
            : 'reset'
      }: ${existing.sportName} ${existing.courtName} (${existing.slotId})`,
      actor: `${existing.bookedByName} (${existing.bookedByRollNo})`,
    });

    return { booking: mapBookingRow(updated[0]) };
  } catch (error) {
    console.error('Failed to update security entry status:', error);
    throw new Error('Failed to update gate admission.', { cause: error });
  }
}

export async function cancelStudentBooking(
  bookingId: string,
  rollNo: string
): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
    if (normalizeRollNo(existing.bookedByRollNo) !== normalizeRollNo(rollNo)) {
      return {
        errorStatus: 403,
        errorMessage: 'Only the captain who created this booking can cancel it.',
      };
    }
    if (existing.status === 'cancelled') {
      return { errorStatus: 400, errorMessage: 'Booking is already cancelled.' };
    }

    const updated = await db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledBy: 'student',
        cancelReason: 'Cancelled by student',
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'cancel',
      summary: `${existing.sportName} ${existing.courtName} (${existing.slotId}) cancelled by student`,
      actor: `${existing.bookedByName} (${existing.bookedByRollNo})`,
    });

    return { booking: mapBookingRow(updated[0]) };
  } catch (error) {
    console.error('Failed to cancel student booking:', error);
    throw new Error('Failed to cancel reservation.', { cause: error });
  }
}

export async function getWalkInBookings(
  date: string,
  query?: string
): Promise<Booking[]> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.date, date))
      .orderBy(desc(bookings.createdAt));

    const mapped = rows.map(mapBookingRow);
    const q = (query || '').trim().toLowerCase().replace(/^#/, '');
    if (!q) return mapped;
    return mapped.filter(
      (b) =>
        (b.bookingCode !== null && b.bookingCode !== undefined && String(b.bookingCode).includes(q)) ||
        b.id.toLowerCase().includes(q) ||
        b.bookedByRollNo.toLowerCase().includes(q) ||
        b.bookedByName.toLowerCase().includes(q) ||
        b.sportName.toLowerCase().includes(q) ||
        b.courtName.toLowerCase().includes(q) ||
        b.players.some(
          (p) =>
            p.rollNo.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        )
    );
  } catch (error) {
    console.error('Failed to fetch walk-in bookings:', error);
    throw new Error('Failed to load today bookings.', { cause: error });
  }
}

export async function searchSecurityBookings(
  tzOffsetMinutes: number,
  query?: string,
  dateOverride?: string
): Promise<{ date: string; bookings: Booking[] }> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    const targetDate = dateOverride || getTodayDateString(tzOffsetMinutes);
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.date, targetDate))
      .orderBy(desc(bookings.createdAt));

    const mapped = rows.map(mapBookingRow);
    const q = (query || '').trim().toLowerCase().replace(/^#/, '');
    if (!q) return { date: targetDate, bookings: mapped };
    return {
      date: targetDate,
      bookings: mapped.filter(
        (b) =>
          (b.bookingCode !== null && b.bookingCode !== undefined && String(b.bookingCode).includes(q)) ||
          b.id.toLowerCase().includes(q) ||
          b.bookedByRollNo.toLowerCase().includes(q) ||
          b.bookedByName.toLowerCase().includes(q) ||
          b.sportName.toLowerCase().includes(q) ||
          b.courtName.toLowerCase().includes(q) ||
          b.players.some(
            (p) => p.rollNo.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
          )
      ),
    };
  } catch (error) {
    console.error('Failed to lookup security bookings:', error);
    throw new Error('Failed to look up bookings.', { cause: error });
  }
}

export async function cancelAdminBooking(
  bookingId: string,
  reason?: string,
  actor: 'admin' | 'walkin' = 'admin'
): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
    if (existing.status === 'cancelled') {
      return { errorStatus: 400, errorMessage: 'Booking is already cancelled.' };
    }

    const defaultReason =
      actor === 'walkin'
        ? 'Cancelled at Walk-In Desk'
        : 'Cancelled by Sports Administration';
    const actorLabel = actor === 'walkin' ? 'Walk-In Desk' : 'Admin Console';

    const updated = await db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledBy: actor,
        cancelReason: (reason || defaultReason).trim(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'cancel',
      summary: `${actorLabel} cancelled ${existing.id} (${existing.sportName} ${existing.courtName})`,
      actor: actorLabel,
    });

    return { booking: mapBookingRow(updated[0]) };
  } catch (error) {
    console.error('Failed to cancel booking:', error);
    throw new Error('Failed to cancel booking.', { cause: error });
  }
}

export async function blockOrUnblockSlot(params: {
  date: string;
  sportId: string;
  courtId: string;
  slotId: string;
  reason?: string;
  action?: 'block' | 'unblock';
}): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    if (params.action === 'unblock') {
      await db
        .delete(blockedSlots)
        .where(
          and(
            eq(blockedSlots.date, params.date),
            eq(blockedSlots.sportId, params.sportId),
            eq(blockedSlots.courtId, params.courtId),
            eq(blockedSlots.slotId, params.slotId)
          )
        );
      await db.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'block',
        summary: `Unblocked slot ${params.slotId} on ${params.date}`,
        actor: 'Admin Console',
      });
      return {};
    }

    const existingBooking = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          eq(bookings.date, params.date),
          eq(bookings.sportId, params.sportId),
          eq(bookings.courtId, params.courtId),
          eq(bookings.slotId, params.slotId)
        )
      )
      .limit(1);

    if (existingBooking.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `Slot currently holds confirmed booking ${existingBooking[0].id}. Cancel that booking first before blocking.`,
      };
    }

    const alreadyBlocked = await db
      .select()
      .from(blockedSlots)
      .where(
        and(
          eq(blockedSlots.date, params.date),
          eq(blockedSlots.sportId, params.sportId),
          eq(blockedSlots.courtId, params.courtId),
          eq(blockedSlots.slotId, params.slotId)
        )
      )
      .limit(1);

    if (alreadyBlocked.length === 0) {
      await db.insert(blockedSlots).values({
        id: `BLK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        date: params.date,
        sportId: params.sportId,
        courtId: params.courtId,
        slotId: params.slotId,
        reason: (params.reason || 'Maintenance / Reserved Event').trim(),
      });
      await db.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'block',
        summary: `Blocked slot ${params.slotId} on ${params.date}: ${params.reason || 'Reserved'}`,
        actor: 'Admin Console',
      });
    }

    return {};
  } catch (error) {
    console.error('Failed to update slot block:', error);
    throw new Error('Failed to update slot status.', { cause: error });
  }
}

export async function bulkBlockOrUnblockSlots(params: {
  date: string;
  sportId: string;
  courtId?: string;
  slotIds: string[];
  reason?: string;
  action?: 'block' | 'unblock';
}): Promise<void> {
  try {
    await ensureSeeded();
    const targetCourts = params.courtId
      ? [{ id: params.courtId }]
      : await db.select({ id: courts.id }).from(courts).where(eq(courts.sportId, params.sportId));

    for (const courtRow of targetCourts) {
      if (params.action === 'unblock') {
        const existing = await db
          .select()
          .from(blockedSlots)
          .where(
            and(
              eq(blockedSlots.date, params.date),
              eq(blockedSlots.sportId, params.sportId),
              eq(blockedSlots.courtId, courtRow.id)
            )
          );
        for (const blk of existing) {
          if (params.slotIds.includes(blk.slotId)) {
            await db.delete(blockedSlots).where(eq(blockedSlots.id, blk.id));
          }
        }
      } else {
        const dayBookings = await db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.status, 'confirmed'),
              eq(bookings.date, params.date),
              eq(bookings.sportId, params.sportId),
              eq(bookings.courtId, courtRow.id)
            )
          );
        const dayBlocks = await db
          .select()
          .from(blockedSlots)
          .where(
            and(
              eq(blockedSlots.date, params.date),
              eq(blockedSlots.sportId, params.sportId),
              eq(blockedSlots.courtId, courtRow.id)
            )
          );

        for (const sid of params.slotIds) {
          const hasBooking = dayBookings.some((b) => b.slotId === sid);
          const hasBlock = dayBlocks.some((b) => b.slotId === sid);
          if (!hasBooking && !hasBlock) {
            await db.insert(blockedSlots).values({
              id: `BLK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
              date: params.date,
              sportId: params.sportId,
              courtId: courtRow.id,
              slotId: sid,
              reason: (params.reason || 'Tournament / Reserved Event').trim(),
            });
          }
        }
      }
    }

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'block',
      summary: `Bulk ${params.action === 'unblock' ? 'unblocked' : 'blocked'} ${params.slotIds.length} slots on ${params.date}`,
      actor: 'Admin Console',
    });
  } catch (error) {
    console.error('Failed bulk slot operation:', error);
    throw new Error('Failed bulk slot operation.', { cause: error });
  }
}

export async function applyTrainingHours(params: {
  date: string;
  sportId: string;
  courtIds: string[];
  slotIds: string[];
  reason?: string;
  actorLabel: string;
  actorType: 'admin' | 'walkin';
}): Promise<{
  blockedCount: number;
  cancelledCount: number;
  cancelledBookings: Booking[];
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    await ensureSeeded();
    const sportRows = await db.select().from(sports).where(eq(sports.id, params.sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) {
      return {
        blockedCount: 0,
        cancelledCount: 0,
        cancelledBookings: [],
        errorStatus: 404,
        errorMessage: 'Sport not found.',
      };
    }

    const validCourts =
      params.courtIds.length > 0
        ? await db
            .select()
            .from(courts)
            .where(and(eq(courts.sportId, params.sportId), inArray(courts.id, params.courtIds)))
        : await db.select().from(courts).where(eq(courts.sportId, params.sportId));

    if (validCourts.length === 0) {
      return {
        blockedCount: 0,
        cancelledCount: 0,
        cancelledBookings: [],
        errorStatus: 400,
        errorMessage: 'Select at least one court/table.',
      };
    }

    if (params.slotIds.length === 0) {
      return {
        blockedCount: 0,
        cancelledCount: 0,
        cancelledBookings: [],
        errorStatus: 400,
        errorMessage: 'Select at least one 1-hour slot for training hours.',
      };
    }

    const rawReason = (params.reason || 'College Varsity Training Hours').trim();
    const blockReason = rawReason.toLowerCase().includes('training')
      ? rawReason
      : `Training Blocked · ${rawReason}`;

    let cancelledCount = 0;
    let blockedCount = 0;
    const cancelledBookings: Booking[] = [];

    for (const c of validCourts) {
      for (const sid of params.slotIds) {
        const conflicting = await db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.status, 'confirmed'),
              eq(bookings.date, params.date),
              eq(bookings.sportId, params.sportId),
              eq(bookings.courtId, c.id),
              eq(bookings.slotId, sid)
            )
          );
        for (const bk of conflicting) {
          const updated = await db
            .update(bookings)
            .set({
              status: 'cancelled',
              cancelledBy: params.actorType,
              cancelReason: `Cancelled by College for Training Hours: ${rawReason}`,
            })
            .where(eq(bookings.id, bk.id))
            .returning();
          if (updated[0]) {
            cancelledBookings.push(mapBookingRow(updated[0]));
          }
          cancelledCount += 1;
        }

        const existingBlock = await db
          .select()
          .from(blockedSlots)
          .where(
            and(
              eq(blockedSlots.date, params.date),
              eq(blockedSlots.sportId, params.sportId),
              eq(blockedSlots.courtId, c.id),
              eq(blockedSlots.slotId, sid)
            )
          )
          .limit(1);
        if (existingBlock.length === 0) {
          await db.insert(blockedSlots).values({
            id: `BLK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
            date: params.date,
            sportId: params.sportId,
            courtId: c.id,
            slotId: sid,
            reason: blockReason,
          });
          blockedCount += 1;
        } else {
          await db
            .update(blockedSlots)
            .set({ reason: blockReason })
            .where(eq(blockedSlots.id, existingBlock[0].id));
        }
      }
    }

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'block',
      summary: `${params.actorLabel} set Training Hours on ${params.date} (${sport.name}: ${validCourts.length} courts, ${params.slotIds.length} hrs · ${cancelledCount} bookings cancelled)`,
      actor: params.actorLabel,
    });

    return { blockedCount, cancelledCount, cancelledBookings };
  } catch (error) {
    console.error('Failed applying training hours:', error);
    throw new Error('Failed to apply training hours.', { cause: error });
  }
}

export async function bulkBlockAdvanceDates(params: {
  dates: string[];
  sportId: string;
  courtIds: string[];
  slotIds: string[];
  reason?: string;
  cancelConflicts?: boolean;
}): Promise<{
  blockedCount: number;
  cancelledCount: number;
  cancelledBookings: Booking[];
  errorStatus?: number;
  errorMessage?: string;
}> {
  try {
    await ensureSeeded();
    if (!params.dates.length || !params.slotIds.length || !params.courtIds.length) {
      return {
        blockedCount: 0,
        cancelledCount: 0,
        cancelledBookings: [],
        errorStatus: 400,
        errorMessage: 'Dates, courts, and time slots are all required.',
      };
    }

    const sportRows = await db.select().from(sports).where(eq(sports.id, params.sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) {
      return {
        blockedCount: 0,
        cancelledCount: 0,
        cancelledBookings: [],
        errorStatus: 404,
        errorMessage: 'Sport not found.',
      };
    }

    const rawReason = (params.reason || 'Training Blocked · College Squad').trim();
    const blockReason = rawReason.toLowerCase().includes('training')
      ? rawReason
      : `Training Blocked · ${rawReason}`;

    let blockedCount = 0;
    let cancelledCount = 0;
    const cancelledBookings: Booking[] = [];

    for (const dateStr of params.dates) {
      for (const courtId of params.courtIds) {
        for (const slotId of params.slotIds) {
          const conflicting = await db
            .select()
            .from(bookings)
            .where(
              and(
                eq(bookings.status, 'confirmed'),
                eq(bookings.date, dateStr),
                eq(bookings.sportId, params.sportId),
                eq(bookings.courtId, courtId),
                eq(bookings.slotId, slotId)
              )
            );
          if (conflicting.length > 0) {
            if (!params.cancelConflicts) {
              continue;
            }
            for (const bk of conflicting) {
              const updated = await db
                .update(bookings)
                .set({
                  status: 'cancelled',
                  cancelledBy: 'admin',
                  cancelReason: `Cancelled by College for Advance Training Block: ${rawReason}`,
                })
                .where(eq(bookings.id, bk.id))
                .returning();
              if (updated[0]) {
                cancelledBookings.push(mapBookingRow(updated[0]));
              }
              cancelledCount += 1;
            }
          }

          const existingBlock = await db
            .select()
            .from(blockedSlots)
            .where(
              and(
                eq(blockedSlots.date, dateStr),
                eq(blockedSlots.sportId, params.sportId),
                eq(blockedSlots.courtId, courtId),
                eq(blockedSlots.slotId, slotId)
              )
            )
            .limit(1);
          if (existingBlock.length === 0) {
            await db.insert(blockedSlots).values({
              id: `BLK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
              date: dateStr,
              sportId: params.sportId,
              courtId,
              slotId,
              reason: blockReason,
            });
            blockedCount += 1;
          }
        }
      }
    }

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'block',
      summary: `Advance Training Block: ${sport.name} · ${params.courtIds.length} courts across ${params.dates.length} day(s) (${blockedCount} slots blocked)`,
      actor: 'Admin Console',
    });

    return { blockedCount, cancelledCount, cancelledBookings };
  } catch (error) {
    console.error('Failed advance multi-day block:', error);
    throw new Error('Failed to apply advance court blocking.', { cause: error });
  }
}

export async function addSportAdmin(params: {
  name: string;
  category: string;
  minPlayers: number;
  maxPlayers: number;
  lateNightFee: number;
  location: string;
  equipmentRequired: string;
  initialCourtsCount: number;
  defaultSurface: string;
}): Promise<{ sport?: Sport; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const cleanName = params.name.trim();
    if (cleanName.length < 2) {
      return { errorStatus: 400, errorMessage: 'Sport name must be at least 2 characters.' };
    }
    const baseSlug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `sport-${Date.now().toString().slice(-4)}`;

    const existingSports = await db.select().from(sports);
    if (existingSports.some((s) => s.name.toLowerCase() === cleanName.toLowerCase())) {
      return { errorStatus: 409, errorMessage: `Sport "${cleanName}" already exists.` };
    }
    const uniqueSlug = existingSports.some((s) => s.id === baseSlug)
      ? `${baseSlug}-${Date.now().toString().slice(-3)}`
      : baseSlug;

    const minP = Math.max(1, Math.min(20, Math.round(params.minPlayers || 2)));
    const maxP = Math.max(minP, Math.min(30, Math.round(params.maxPlayers || minP + 2)));
    const fee = Math.max(0, Math.round(params.lateNightFee || 200));
    const count = Math.max(1, Math.min(20, Math.round(params.initialCourtsCount || 1)));
    const surface = params.defaultSurface.trim() || 'Standard Arena Surface';

    await db.insert(sports).values({
      id: uniqueSlug,
      name: cleanName,
      category: params.category.trim() || 'Campus Sport',
      minPlayers: minP,
      maxPlayers: maxP,
      lateNightFee: fee,
      equipmentRequired:
        params.equipmentRequired.trim() || 'Valid College ID card and standard athletic gear.',
      location: params.location.trim() || 'Main Sports Complex',
      sortOrder: existingSports.length + 1,
    });

    const createdCourts = [];
    for (let i = 1; i <= count; i++) {
      const c = {
        id: `${uniqueSlug}-c${i}-${Date.now().toString().slice(-3)}`,
        sportId: uniqueSlug,
        name: `Court ${i}`,
        surface,
        status: 'operational',
        sortOrder: i,
      };
      await db.insert(courts).values(c);
      createdCourts.push({
        id: c.id,
        name: c.name,
        surface: c.surface,
        status: 'operational' as const,
      });
    }

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'facility',
      summary: `Added new sport "${cleanName}" with ${count} court(s)`,
      actor: 'Admin Console',
    });

    return {
      sport: {
        id: uniqueSlug,
        name: cleanName,
        category: params.category.trim() || 'Campus Sport',
        minPlayers: minP,
        maxPlayers: maxP,
        lateNightFee: fee,
        equipmentRequired:
          params.equipmentRequired.trim() || 'Valid College ID card and standard athletic gear.',
        location: params.location.trim() || 'Main Sports Complex',
        courts: createdCourts,
      },
    };
  } catch (error) {
    console.error('Failed to add new sport:', error);
    throw new Error('Failed to add new sport.', { cause: error });
  }
}

export async function addCourt(
  sportId: string,
  name: string,
  surface: string
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const sportRows = await db.select().from(sports).where(eq(sports.id, sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) return { errorStatus: 404, errorMessage: 'Sport not found.' };

    const existingCourts = await db.select().from(courts).where(eq(courts.sportId, sportId));
    await db.insert(courts).values({
      id: `${sport.id}-c${existingCourts.length + 1}-${Date.now().toString().slice(-4)}`,
      sportId: sport.id,
      name: name.trim(),
      surface: surface.trim() || 'Standard Arena Surface',
      status: 'operational',
      sortOrder: existingCourts.length + 1,
    });
    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'facility',
      summary: `Added ${name.trim()} to ${sport.name}`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to add court:', error);
    throw new Error('Failed to add court.', { cause: error });
  }
}

export async function updateCourtDetails(
  sportId: string,
  courtId: string,
  updates: {
    status?: 'operational' | 'maintenance';
    name?: string;
    surface?: string;
  }
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const sportRows = await db.select().from(sports).where(eq(sports.id, sportId)).limit(1);
    const courtRows = await db
      .select()
      .from(courts)
      .where(and(eq(courts.id, courtId), eq(courts.sportId, sportId)))
      .limit(1);
    if (!sportRows[0] || !courtRows[0]) {
      return { errorStatus: 404, errorMessage: 'Court or table not found.' };
    }

    const currentCourt = courtRows[0];
    const nextStatus =
      updates.status === 'maintenance' || updates.status === 'operational'
        ? updates.status
        : (currentCourt.status as 'operational' | 'maintenance');
    const nextName =
      typeof updates.name === 'string' && updates.name.trim().length >= 2
        ? updates.name.trim()
        : currentCourt.name;
    const nextSurface =
      typeof updates.surface === 'string' && updates.surface.trim().length >= 2
        ? updates.surface.trim()
        : currentCourt.surface;

    await db
      .update(courts)
      .set({
        status: nextStatus,
        name: nextName,
        surface: nextSurface,
      })
      .where(eq(courts.id, courtId));

    if (nextName !== currentCourt.name) {
      await db
        .update(bookings)
        .set({ courtName: nextName })
        .where(and(eq(bookings.courtId, courtId), eq(bookings.status, 'confirmed')));
    }

    const changes: string[] = [];
    if (nextName !== currentCourt.name) changes.push(`renamed to "${nextName}"`);
    if (nextSurface !== currentCourt.surface) changes.push(`surface "${nextSurface}"`);
    if (nextStatus !== currentCourt.status) changes.push(`status ${nextStatus}`);

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'facility',
      summary: `${sportRows[0].name} · ${currentCourt.name} ${
        changes.length > 0 ? changes.join(', ') : `set to ${nextStatus}`
      }`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to update court details:', error);
    throw new Error('Failed to update court details.', { cause: error });
  }
}

export async function toggleCourtStatus(
  sportId: string,
  courtId: string,
  status: 'operational' | 'maintenance'
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  return updateCourtDetails(sportId, courtId, { status });
}

export async function reassignBookingCourt(
  bookingId: string,
  newCourtId: string
): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return { errorStatus: 404, errorMessage: 'Booking not found.' };
      if (existing.status !== 'confirmed') {
        return { errorStatus: 400, errorMessage: 'Only confirmed bookings can change venue.' };
      }
      if (existing.courtId === newCourtId) {
        return { booking: mapBookingRow(existing) };
      }

      const targetCourtRows = await tx
        .select()
        .from(courts)
        .where(and(eq(courts.id, newCourtId), eq(courts.sportId, existing.sportId)))
        .limit(1);
      const targetCourt = targetCourtRows[0];
      if (!targetCourt) {
        return { errorStatus: 404, errorMessage: 'Target court/table not found for this sport.' };
      }
      if (targetCourt.status !== 'operational') {
        return {
          errorStatus: 409,
          errorMessage: `${targetCourt.name} is currently under maintenance.`,
        };
      }

      const conflictBooking = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            eq(bookings.date, existing.date),
            eq(bookings.sportId, existing.sportId),
            eq(bookings.courtId, targetCourt.id),
            eq(bookings.slotId, existing.slotId)
          )
        )
        .limit(1);
      if (conflictBooking.length > 0) {
        return {
          errorStatus: 409,
          errorMessage: `${targetCourt.name} is already booked (${conflictBooking[0].id}) for this slot.`,
        };
      }

      const conflictBlock = await tx
        .select()
        .from(blockedSlots)
        .where(
          and(
            eq(blockedSlots.date, existing.date),
            eq(blockedSlots.sportId, existing.sportId),
            eq(blockedSlots.courtId, targetCourt.id),
            eq(blockedSlots.slotId, existing.slotId)
          )
        )
        .limit(1);
      if (conflictBlock.length > 0) {
        return {
          errorStatus: 409,
          errorMessage: `${targetCourt.name} is blocked (${conflictBlock[0].reason}) for this slot.`,
        };
      }

      const updated = await tx
        .update(bookings)
        .set({
          courtId: targetCourt.id,
          courtName: targetCourt.name,
        })
        .where(eq(bookings.id, existing.id))
        .returning();

      await tx.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'booking',
        summary: `Venue updated for ${existing.id}: ${existing.courtName} -> ${targetCourt.name}`,
        actor: 'Admin Console',
      });

      return { booking: mapBookingRow(updated[0]) };
    });
  } catch (error) {
    console.error('Failed to reassign booking court:', error);
    throw new Error('Failed to change booking venue.', { cause: error });
  }
}

export async function createAdminWalkInBooking(params: {
  date: string;
  sportId: string;
  courtId: string;
  slotId: string;
  bookedByRollNo: string;
  playerRollNos: string[];
  note?: string;
}): Promise<{ booking?: Booking; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const policy = await getPolicy(false);
    const sportRows = await db.select().from(sports).where(eq(sports.id, params.sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) return { errorStatus: 404, errorMessage: 'Sport not found.' };

    const courtRows = await db
      .select()
      .from(courts)
      .where(and(eq(courts.id, params.courtId), eq(courts.sportId, params.sportId)))
      .limit(1);
    const court = courtRows[0];
    if (!court) return { errorStatus: 404, errorMessage: 'Court/Table not found.' };
    if (court.status !== 'operational') {
      return { errorStatus: 409, errorMessage: `${court.name} is currently under maintenance.` };
    }

    const slot = TIME_SLOTS.find((t) => t.id === params.slotId);
    if (!slot) return { errorStatus: 404, errorMessage: 'Invalid slot selected.' };
    const slotOp = getSlotOperationalState(slot, params.date, policy);

    const normCaptain = normalizeRollNo(params.bookedByRollNo);
    const captainRows = await db
      .select()
      .from(students)
      .where(
        sql`UPPER(${students.rollNo}) = ${normCaptain} OR UPPER(COALESCE(${students.idNo}, '')) = ${normCaptain}`
      )
      .limit(1);
    const captain = captainRows[0];
    if (!captain) {
      return { errorStatus: 400, errorMessage: `Captain ID ${normCaptain} must be in the Official Roster.` };
    }
    const todayUtc = getTodayUtcYmd();
    const captainEffStatus = computeEffectiveRosterStatus(captain, todayUtc);
    if (captainEffStatus === 'suspended') {
      return { errorStatus: 400, errorMessage: `Captain ID ${captain.rollNo} is currently suspended.` };
    }
    if (captainEffStatus === 'expired' || captainEffStatus === 'inactive') {
      return {
        errorStatus: 400,
        errorMessage: captain.subscriptionEndDate
          ? `Captain ID ${captain.rollNo} pass expired on ${captain.subscriptionEndDate}. Click Paid in Admin Roster first.`
          : `Captain ID ${captain.rollNo} is deactivated (unpaid). Click Paid in Admin Roster first.`,
      };
    }
    if (isStudentBannedForSport(captain, sport.id, todayUtc)) {
      return {
        errorStatus: 403,
        errorMessage:
          captain.banScope === 'all'
            ? `Captain ID ${captain.rollNo} is banned across all sports until ${captain.banUntil}${
                captain.banReason ? ` (${captain.banReason})` : ''
              }.`
            : `Captain ID ${captain.rollNo} is banned from ${sport.name} until ${captain.banUntil}${
                captain.banReason ? ` (${captain.banReason})` : ''
              }.`,
      };
    }

    const uniqueRolls = Array.from(
      new Set([normCaptain, ...params.playerRollNos.map(normalizeRollNo).filter(Boolean)])
    );
    const validation = await validatePlayers(params.date, params.slotId, uniqueRolls, sport.id);
    if (!validation.allValid) {
      const bad = validation.results.find((r) => !r.valid);
      return {
        errorStatus: 400,
        errorMessage: bad?.message || 'One or more player IDs failed validation.',
      };
    }

    const resolvedPlayers = validation.results.map((r) => ({
      rollNo: r.rollNo,
      name: r.studentName || r.rollNo,
    }));

    return await db.transaction(async (tx) => {
      const conflictBooking = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.status, 'confirmed'),
            eq(bookings.date, params.date),
            eq(bookings.sportId, sport.id),
            eq(bookings.courtId, court.id),
            eq(bookings.slotId, slot.id)
          )
        )
        .limit(1);
      if (conflictBooking.length > 0) {
        return {
          errorStatus: 409,
          errorMessage: `${court.name} (${slotOp.effectiveShortLabel}) is already booked (${conflictBooking[0].id}).`,
        };
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(784512)`);
      const cycleDate = getFiveAmCycleDate(0);
      const maxRow = await tx
        .select({ maxCode: sql<number>`COALESCE(MAX(${bookings.bookingCode}), 99)` })
        .from(bookings)
        .where(eq(bookings.codeCycleDate, cycleDate));
      const nextBookingCode = Math.max(99, Number(maxRow[0]?.maxCode ?? 99)) + 1;

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const autoAdmitAt = computeBookingAutoAdmitIso(params.date, slot.id, 0, nowMs);

      const inserted = await tx
        .insert(bookings)
        .values({
          id: `BK-${Math.floor(1000 + Math.random() * 9000)}`,
          bookingCode: nextBookingCode,
          codeCycleDate: cycleDate,
          date: params.date,
          sportId: sport.id,
          sportName: sport.name,
          courtId: court.id,
          courtName: court.name,
          slotId: slot.id,
          slotLabel: slotOp.effectiveLabel,
          isLateNight: slot.isLateNight,
          bookedByUid: null,
          bookedByRollNo: captain.rollNo,
          bookedByName: captain.name,
          bookedByEmail: captain.email,
          players: resolvedPlayers,
          status: 'confirmed',
          payment: null,
          rulesAcceptedAt: nowIso,
          securityStatus: 'pending',
          securityNotes: params.note?.trim() || 'Admin Desk Walk-In',
          autoAdmitAt,
        })
        .returning();

      await tx.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'booking',
        summary: `Admin Desk booked #${nextBookingCode} ${sport.name} ${court.name} (${slotOp.effectiveShortLabel}) for ${captain.rollNo}`,
        actor: 'Admin Console',
      });

      return { booking: mapBookingRow(inserted[0]) };
    });
  } catch (error) {
    console.error('Failed to create admin walk-in booking:', error);
    throw new Error('Failed to create walk-in booking.', { cause: error });
  }
}

export async function updateSportConfig(
  sportId: string,
  params: {
    lateNightFee?: number;
    minPlayers?: number;
    maxPlayers?: number;
    equipmentRequired?: string;
    location?: string;
  }
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db.select().from(sports).where(eq(sports.id, sportId)).limit(1);
    const sport = rows[0];
    if (!sport) return { errorStatus: 404, errorMessage: 'Sport not found.' };

    const nextFee =
      typeof params.lateNightFee === 'number' && params.lateNightFee >= 0
        ? Math.round(params.lateNightFee)
        : sport.lateNightFee;
    const nextMin =
      typeof params.minPlayers === 'number' && params.minPlayers >= 1 && params.minPlayers <= 20
        ? Math.round(params.minPlayers)
        : sport.minPlayers;
    const nextMax =
      typeof params.maxPlayers === 'number' && params.maxPlayers >= nextMin && params.maxPlayers <= 30
        ? Math.round(params.maxPlayers)
        : Math.max(nextMin, sport.maxPlayers);
    const nextEquipment =
      typeof params.equipmentRequired === 'string' && params.equipmentRequired.trim().length > 0
        ? params.equipmentRequired.trim()
        : sport.equipmentRequired;
    const nextLocation =
      typeof params.location === 'string' && params.location.trim().length > 0
        ? params.location.trim()
        : sport.location;

    await db
      .update(sports)
      .set({
        lateNightFee: nextFee,
        minPlayers: nextMin,
        maxPlayers: nextMax,
        equipmentRequired: nextEquipment,
        location: nextLocation,
      })
      .where(eq(sports.id, sportId));

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'facility',
      summary: `Updated ${sport.name} settings (Fee ₹${nextFee}, Min ${nextMin} players, rules updated)`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to update sport configuration:', error);
    throw new Error('Failed to update sport settings.', { cause: error });
  }
}

export async function updatePolicy(params: Partial<BookingPolicy>): Promise<void> {
  try {
    await ensureSeeded();
    const current = await getPolicy(true);
    const nextMorningOpenHour =
      typeof params.morningBookingOpenHour === 'number' &&
      params.morningBookingOpenHour >= 0 &&
      params.morningBookingOpenHour <= 23
        ? Math.round(params.morningBookingOpenHour)
        : current.morningBookingOpenHour;
    const nextEveningOpenHour =
      typeof params.eveningBookingOpenHour === 'number' &&
      params.eveningBookingOpenHour >= 0 &&
      params.eveningBookingOpenHour <= 23
        ? Math.round(params.eveningBookingOpenHour)
        : typeof params.openingHour === 'number' &&
            params.openingHour >= 0 &&
            params.openingHour <= 23
          ? Math.round(params.openingHour)
          : current.eveningBookingOpenHour;
    const nextEnforce =
      typeof params.enforceOpeningHour === 'boolean'
        ? params.enforceOpeningHour
        : current.enforceOpeningHour;
    const nextSameDay =
      typeof params.sameDayOnly === 'boolean' ? params.sameDayOnly : current.sameDayOnly;

    const sanitizeHHMM = (val: string | undefined, fallback: string) =>
      typeof val === 'string' && /^\d{2}:\d{2}$/.test(val.trim()) ? val.trim() : fallback;

    const nextWeekdayMorningStart = sanitizeHHMM(
      params.weekdayMorningStart,
      current.weekdayMorningStart
    );
    const nextWeekdayMorningEnd = sanitizeHHMM(
      params.weekdayMorningEnd,
      current.weekdayMorningEnd
    );
    const nextWeekdayEveningStart = sanitizeHHMM(
      params.weekdayEveningStart,
      current.weekdayEveningStart
    );
    const nextWeekdayEveningEnd = sanitizeHHMM(
      params.weekdayEveningEnd,
      current.weekdayEveningEnd
    );
    const nextWeekendMorningStart = sanitizeHHMM(
      params.weekendMorningStart,
      current.weekendMorningStart
    );
    const nextWeekendMorningEnd = sanitizeHHMM(
      params.weekendMorningEnd,
      current.weekendMorningEnd
    );
    const nextWeekendEveningStart = sanitizeHHMM(
      params.weekendEveningStart,
      current.weekendEveningStart
    );
    const nextWeekendEveningEnd = sanitizeHHMM(
      params.weekendEveningEnd,
      current.weekendEveningEnd
    );

    const nextAnnouncement =
      typeof params.announcement === 'string'
        ? params.announcement.trim()
        : current.announcement;
    const nextEarlyArrival =
      typeof params.earlyArrivalMinutes === 'number' &&
      params.earlyArrivalMinutes >= 0 &&
      params.earlyArrivalMinutes <= 60
        ? Math.round(params.earlyArrivalMinutes)
        : current.earlyArrivalMinutes;
    const nextInCourtWindow =
      typeof params.inCourtWindowMinutes === 'number' &&
      params.inCourtWindowMinutes >= 1 &&
      params.inCourtWindowMinutes <= 30
        ? Math.round(params.inCourtWindowMinutes)
        : current.inCourtWindowMinutes;
    const nextAdminPasscode =
      typeof params.adminPasscode === 'string' && params.adminPasscode.trim().length >= 4
        ? params.adminPasscode.trim()
        : current.adminPasscode || process.env.ADMIN_PASSWORD || '8309762055';
    const nextSecurityPasscode =
      typeof params.securityPasscode === 'string' && params.securityPasscode.trim().length >= 4
        ? params.securityPasscode.trim()
        : current.securityPasscode || 'gate2026';
    const nextWalkInPasscode =
      typeof params.walkInPasscode === 'string' && params.walkInPasscode.trim().length >= 4
        ? params.walkInPasscode.trim()
        : current.walkInPasscode || 'walk2026';
    const nextWalkInCancelCode =
      typeof params.walkInCancelCode === 'string' && params.walkInCancelCode.trim().length >= 4
        ? params.walkInCancelCode.trim()
        : current.walkInCancelCode || 'cancel2026';
    const nextTrainingOverrideCode =
      typeof params.trainingOverrideCode === 'string' && params.trainingOverrideCode.trim().length >= 4
        ? params.trainingOverrideCode.trim()
        : current.trainingOverrideCode || 'train2026';
    const nextGmailSenderEmail =
      typeof params.gmailSenderEmail === 'string'
        ? params.gmailSenderEmail.trim().toLowerCase()
        : current.gmailSenderEmail || '';
    const nextGmailAutoSend =
      typeof params.gmailAutoSend === 'boolean'
        ? params.gmailAutoSend
        : current.gmailAutoSend ?? true;
    const nextGmailConnectionMode =
      params.gmailConnectionMode === 'oauth' || params.gmailConnectionMode === 'smtp'
        ? params.gmailConnectionMode
        : current.gmailConnectionMode || 'smtp';
    const nextRules =
      Array.isArray(params.facilityRules) && params.facilityRules.length > 0
        ? params.facilityRules
            .filter((r) => r.title?.trim() && r.description?.trim())
            .map((r, i) => ({
              id: r.id || `rule-${i + 1}`,
              title: r.title.trim(),
              description: r.description.trim(),
            }))
        : current.facilityRules;

    await db
      .insert(appPolicy)
      .values({
        id: 1,
        sameDayOnly: nextSameDay,
        openingHour: nextEveningOpenHour,
        morningBookingOpenHour: nextMorningOpenHour,
        eveningBookingOpenHour: nextEveningOpenHour,
        enforceOpeningHour: nextEnforce,
        weekdayMorningStart: nextWeekdayMorningStart,
        weekdayMorningEnd: nextWeekdayMorningEnd,
        weekdayEveningStart: nextWeekdayEveningStart,
        weekdayEveningEnd: nextWeekdayEveningEnd,
        weekendMorningStart: nextWeekendMorningStart,
        weekendMorningEnd: nextWeekendMorningEnd,
        weekendEveningStart: nextWeekendEveningStart,
        weekendEveningEnd: nextWeekendEveningEnd,
        announcement: nextAnnouncement,
        earlyArrivalMinutes: nextEarlyArrival,
        inCourtWindowMinutes: nextInCourtWindow,
        adminPasscode: nextAdminPasscode,
        securityPasscode: nextSecurityPasscode,
        walkInPasscode: nextWalkInPasscode,
        walkInCancelCode: nextWalkInCancelCode,
        trainingOverrideCode: nextTrainingOverrideCode,
        gmailSenderEmail: nextGmailSenderEmail,
        gmailAutoSend: nextGmailAutoSend,
        gmailConnectionMode: nextGmailConnectionMode,
        facilityRules: nextRules,
      })
      .onConflictDoUpdate({
        target: appPolicy.id,
        set: {
          sameDayOnly: nextSameDay,
          openingHour: nextEveningOpenHour,
          morningBookingOpenHour: nextMorningOpenHour,
          eveningBookingOpenHour: nextEveningOpenHour,
          enforceOpeningHour: nextEnforce,
          weekdayMorningStart: nextWeekdayMorningStart,
          weekdayMorningEnd: nextWeekdayMorningEnd,
          weekdayEveningStart: nextWeekdayEveningStart,
          weekdayEveningEnd: nextWeekdayEveningEnd,
          weekendMorningStart: nextWeekendMorningStart,
          weekendMorningEnd: nextWeekendMorningEnd,
          weekendEveningStart: nextWeekendEveningStart,
          weekendEveningEnd: nextWeekendEveningEnd,
          announcement: nextAnnouncement,
          earlyArrivalMinutes: nextEarlyArrival,
          inCourtWindowMinutes: nextInCourtWindow,
          adminPasscode: nextAdminPasscode,
          securityPasscode: nextSecurityPasscode,
          walkInPasscode: nextWalkInPasscode,
          walkInCancelCode: nextWalkInCancelCode,
          trainingOverrideCode: nextTrainingOverrideCode,
          gmailSenderEmail: nextGmailSenderEmail,
          gmailAutoSend: nextGmailAutoSend,
          gmailConnectionMode: nextGmailConnectionMode,
          facilityRules: nextRules,
        },
      });

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'policy',
      summary: `Updated policy, schedule & access codes (Morning ${formatHourMinute12(nextMorningOpenHour)}, Evening ${formatHourMinute12(nextEveningOpenHour)})`,
      actor: 'Admin Console',
    });
  } catch (error) {
    console.error('Failed to update policy:', error);
    throw new Error('Failed to save booking policy.', { cause: error });
  }
}

export async function getAdminGmailSmtpCredentials(): Promise<{
  senderEmail: string;
  appPassword: string;
  autoSend: boolean;
  mode: 'smtp' | 'oauth';
}> {
  await ensureSeeded();
  const rows = await db.select().from(appPolicy).where(eq(appPolicy.id, 1)).limit(1);
  if (rows.length === 0) {
    return { senderEmail: '', appPassword: '', autoSend: true, mode: 'smtp' };
  }
  const r = rows[0];
  let appPassword = '';
  if (r.gmailAppPasswordEnc) {
    try {
      appPassword = decryptSecret(r.gmailAppPasswordEnc);
    } catch {
      appPassword = '';
    }
  }
  return {
    senderEmail: (r.gmailSenderEmail || '').trim().toLowerCase(),
    appPassword,
    autoSend: r.gmailAutoSend ?? true,
    mode: r.gmailConnectionMode === 'oauth' ? 'oauth' : 'smtp',
  };
}

export async function saveAdminGmailSmtpConfig(params: {
  email?: string;
  appPassword?: string;
  autoSend?: boolean;
  clear?: boolean;
}): Promise<void> {
  await ensureSeeded();
  if (params.clear) {
    await db
      .update(appPolicy)
      .set({
        gmailSenderEmail: '',
        gmailAppPasswordEnc: '',
        gmailAutoSend: false,
        gmailConnectionMode: 'smtp',
      })
      .where(eq(appPolicy.id, 1));
    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'policy',
      summary: 'Disconnected Admin Gmail SMTP auto-dispatch account',
      actor: 'Admin Console',
    });
    return;
  }

  const rows = await db.select().from(appPolicy).where(eq(appPolicy.id, 1)).limit(1);
  const current = rows[0];
  const nextEmail =
    typeof params.email === 'string'
      ? params.email.trim().toLowerCase()
      : (current?.gmailSenderEmail || '').trim().toLowerCase();
  const cleanPass = params.appPassword ? params.appPassword.replace(/\s+/g, '').trim() : '';
  const nextEnc = cleanPass ? encryptSecret(cleanPass) : current?.gmailAppPasswordEnc || '';
  const nextAutoSend =
    typeof params.autoSend === 'boolean' ? params.autoSend : current?.gmailAutoSend ?? true;

  await db
    .update(appPolicy)
    .set({
      gmailSenderEmail: nextEmail,
      gmailAppPasswordEnc: nextEnc,
      gmailAutoSend: nextAutoSend,
      gmailConnectionMode: 'smtp',
    })
    .where(eq(appPolicy.id, 1));

  await db.insert(activityLogs).values({
    id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    type: 'policy',
    summary: `Connected Admin Gmail (${nextEmail}) for automatic 6-digit sign-up OTP dispatch`,
    actor: 'Admin Console',
  });
}

export async function toggleStudentStatus(
  rollNo: string,
  status: 'active' | 'suspended'
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(rollNo);
    const rows = await db.select().from(students).where(eq(students.rollNo, norm)).limit(1);
    if (!rows[0]) return { errorStatus: 404, errorMessage: 'Student not found.' };

    await db.update(students).set({ status }).where(eq(students.rollNo, norm));
    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Student ID ${norm} set to ${status}`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to update student status:', error);
    throw new Error('Failed to update student status.', { cause: error });
  }
}

export async function removeStudentFromRoster(
  rollNo: string
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(rollNo);
    const rows = await db.select().from(students).where(eq(students.rollNo, norm)).limit(1);
    if (!rows[0]) return { errorStatus: 404, errorMessage: 'Student Roll No not found in roster.' };

    await db.delete(students).where(eq(students.rollNo, norm));
    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Removed ${rows[0].name} (${norm}) from active roster`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to remove student from roster:', error);
    throw new Error('Failed to remove student from roster.', { cause: error });
  }
}

export async function updateStudentSubscription(
  rollNo: string,
  subscriptionStartDate?: string,
  subscriptionEndDate?: string
): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(rollNo);
    const rows = await db
      .select()
      .from(students)
      .where(
        sql`UPPER(${students.rollNo}) = ${norm} OR UPPER(COALESCE(${students.idNo}, '')) = ${norm}`
      )
      .limit(1);
    if (!rows[0]) return { errorStatus: 404, errorMessage: 'Student not found in Roster.' };

    const start =
      subscriptionStartDate && /^\d{4}-\d{2}-\d{2}$/.test(subscriptionStartDate.trim())
        ? subscriptionStartDate.trim()
        : getTodayUtcYmd();
    const end =
      subscriptionEndDate && /^\d{4}-\d{2}-\d{2}$/.test(subscriptionEndDate.trim())
        ? subscriptionEndDate.trim()
        : addOneYearDate(start);

    await db
      .update(students)
      .set({
        paymentDate: start,
        subscriptionStartDate: start,
        subscriptionEndDate: end,
        status: isSubscriptionExpired(end, getTodayUtcYmd()) ? 'expired' : 'active',
      })
      .where(eq(students.id, rows[0].id));

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Updated 1-Year Subscription for ${rows[0].name} (${rows[0].rollNo}): ${start} → ${end}`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to update student subscription:', error);
    throw new Error('Failed to update 1-year subscription.', { cause: error });
  }
}

export async function markStudentPaid(params: {
  rollNo: string;
  paymentDate?: string;
  idNo?: string;
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  year?: string;
}): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(params.rollNo);
    const payDate =
      params.paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(params.paymentDate.trim())
        ? params.paymentDate.trim()
        : getTodayUtcYmd();
    const end = addOneYearDate(payDate);

    const existing = await db
      .select()
      .from(students)
      .where(
        sql`UPPER(${students.rollNo}) = ${norm} OR UPPER(COALESCE(${students.idNo}, '')) = ${norm}`
      )
      .limit(1);

    if (existing.length > 0) {
      const target = existing[0];
      const nextIdNo = params.idNo ? normalizeRollNo(params.idNo) : target.idNo;
      await db
        .update(students)
        .set({
          idNo: nextIdNo || null,
          paymentDate: payDate,
          subscriptionStartDate: payDate,
          subscriptionEndDate: end,
          status: 'active',
        })
        .where(eq(students.id, target.id));

      await db.insert(activityLogs).values({
        id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        type: 'payment',
        summary: `Marked PAID & activated ${target.name} (${target.rollNo}) · Valid ${payDate} → ${end}`,
        actor: 'Admin Console',
      });
      return {};
    }

    // Check student_accounts if not yet on Official Roster
    const accountRows = await db
      .select()
      .from(studentAccounts)
      .where(eq(studentAccounts.rollNo, norm))
      .limit(1);
    const acc = accountRows[0];
    const cleanName = params.name?.trim() || acc?.name;
    const cleanEmail = params.email?.trim().toLowerCase() || acc?.email;
    if (!cleanName || !cleanEmail) {
      return { errorStatus: 404, errorMessage: `Student ${norm} not found in Roster or Accounts.` };
    }

    await db.insert(students).values({
      id: `stu-${crypto.randomUUID().slice(0, 8)}`,
      rollNo: norm,
      idNo: params.idNo ? normalizeRollNo(params.idNo) : null,
      name: cleanName,
      email: cleanEmail,
      phone: (params.phone || acc?.phone || '9000000000').replace(/\D/g, '') || '9000000000',
      department: (params.department || acc?.department || 'SoT').trim(),
      year: (params.year || acc?.year || '1st Year').trim(),
      details: acc?.details || 'Activated via Payment Desk',
      status: 'active',
      paymentDate: payDate,
      subscriptionStartDate: payDate,
      subscriptionEndDate: end,
    });

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'payment',
      summary: `Added & Marked PAID for ${cleanName} (${norm}) · Valid ${payDate} → ${end}`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to mark student paid:', error);
    throw new Error('Failed to mark student as paid.', { cause: error });
  }
}

export async function addStudentAdmin(params: {
  rollNo: string;
  idNo?: string;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  year?: string;
  paymentDate?: string;
  subscriptionStartDate?: string;
}): Promise<{ errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const normRoll = normalizeRollNo(params.rollNo);
    const cleanIdNo = params.idNo ? normalizeRollNo(params.idNo) : null;
    const existing = await db
      .select()
      .from(students)
      .where(
        cleanIdNo
          ? sql`UPPER(${students.rollNo}) = ${normRoll} OR UPPER(COALESCE(${students.idNo}, '')) = ${cleanIdNo}`
          : eq(students.rollNo, normRoll)
      )
      .limit(1);
    if (existing.length > 0) {
      return {
        errorStatus: 409,
        errorMessage: `Roll No ${normRoll}${cleanIdNo ? ` or ID No ${cleanIdNo}` : ''} already exists in roster.`,
      };
    }

    const hasExplicitBlankPayment =
      params.paymentDate === '' && (params.subscriptionStartDate === undefined || params.subscriptionStartDate === '');
    const rawDate = (params.paymentDate ?? params.subscriptionStartDate)?.trim();
    const start = hasExplicitBlankPayment
      ? null
      : rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : getTodayUtcYmd();
    const end = start ? addOneYearDate(start) : null;
    const status =
      !start || !end || isSubscriptionExpired(end, getTodayUtcYmd()) ? 'expired' : 'active';

    await db.insert(students).values({
      id: `stu-${crypto.randomUUID().slice(0, 8)}`,
      rollNo: normRoll,
      idNo: cleanIdNo,
      name: params.name.trim(),
      email: params.email.trim().toLowerCase(),
      phone: (params.phone || '9000000000').replace(/\D/g, '') || '9000000000',
      department: (params.department || 'SoT').trim(),
      year: (params.year || '1st Year').trim(),
      details: 'Added by Sports Office',
      status,
      paymentDate: start,
      subscriptionStartDate: start,
      subscriptionEndDate: end,
    });
    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: start
        ? `Added student ${params.name.trim()} (${normRoll}${cleanIdNo ? ` · ID ${cleanIdNo}` : ''}) · Paid ${start} → ${end} (${status})`
        : `Added student ${params.name.trim()} (${normRoll}) · Deactivated until Paid`,
      actor: 'Admin Console',
    });
    return {};
  } catch (error) {
    console.error('Failed to add student:', error);
    throw new Error('Failed to add student.', { cause: error });
  }
}

export async function bulkImportStudents(
  records: {
    rollNo?: string;
    idNo?: string;
    name?: string;
    email?: string;
    phone?: string;
    department?: string;
    year?: string;
    details?: string;
    status?: string;
    paymentDate?: string;
    subscriptionStartDate?: string;
  }[]
): Promise<{ addedCount: number; updatedCount: number; skippedCount: number }> {
  try {
    await ensureSeeded();
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const today = getTodayUtcYmd();

    for (const row of records) {
      const cleanIdNo = row.idNo ? normalizeRollNo(String(row.idNo)) : null;
      const normRoll = normalizeRollNo(String(row.rollNo || cleanIdNo || ''));
      const cleanName = String(row.name || '').trim();
      if (!normRoll || normRoll.length < 2 || !cleanName) {
        skippedCount += 1;
        continue;
      }

      const cleanEmail =
        String(row.email || '').trim().toLowerCase() || `${normRoll.toLowerCase()}@campus.edu.in`;
      const cleanPhone = String(row.phone || '9000000000').replace(/\D/g, '') || '9000000000';
      const cleanDept = String(row.department || 'SoT').trim() || 'SoT';
      const cleanYear = String(row.year || '1st Year').trim() || '1st Year';
      const cleanDetails = String(row.details || 'Imported from Document').trim();

      const rawDateCandidate = String(row.paymentDate ?? row.subscriptionStartDate ?? '').trim();
      const rowPayDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDateCandidate) ? rawDateCandidate : '';
      const rawStatus = String(row.status || '').trim().toLowerCase();

      let finalPaymentDate: string | null = rowPayDate || null;
      let finalEnd: string | null = rowPayDate ? addOneYearDate(rowPayDate) : null;
      let finalStatus: 'active' | 'suspended' | 'expired' = 'active';

      if (rawStatus === 'suspended') {
        finalStatus = 'suspended';
      } else if (!finalPaymentDate || rawStatus === 'expired' || rawStatus === 'unpaid' || rawStatus === 'inactive') {
        // Missing/unpaid day of payment OR expired 1-year window automatically deactivates until Admin clicks Paid
        finalStatus = 'expired';
      } else if (finalEnd && isSubscriptionExpired(finalEnd, today)) {
        finalStatus = 'expired';
      }

      const existing = await db
        .select()
        .from(students)
        .where(
          cleanIdNo
            ? sql`UPPER(${students.rollNo}) = ${normRoll} OR UPPER(COALESCE(${students.idNo}, '')) = ${cleanIdNo}`
            : eq(students.rollNo, normRoll)
        )
        .limit(1);

      if (existing.length > 0) {
        const cur = existing[0];
        // If imported row has a date, apply it (auto-deactivating if >1yr). If imported row is unpaid/empty, auto-deactivate unless existing row wasn't touched.
        const resolvedPayDate = finalPaymentDate;
        const resolvedEnd = finalEnd;
        const resolvedStatus =
          rawStatus === 'suspended'
            ? 'suspended'
            : !resolvedPayDate || (resolvedEnd && isSubscriptionExpired(resolvedEnd, today)) || rawStatus === 'expired' || rawStatus === 'unpaid'
              ? 'expired'
              : 'active';

        await db
          .update(students)
          .set({
            idNo: cleanIdNo ?? cur.idNo ?? null,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            department: cleanDept,
            year: cleanYear,
            details: cleanDetails,
            status: resolvedStatus,
            paymentDate: resolvedPayDate,
            subscriptionStartDate: resolvedPayDate,
            subscriptionEndDate: resolvedEnd,
          })
          .where(eq(students.id, cur.id));
        updatedCount += 1;
      } else {
        await db.insert(students).values({
          id: `stu-${crypto.randomUUID().slice(0, 8)}`,
          rollNo: normRoll,
          idNo: cleanIdNo,
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          department: cleanDept,
          year: cleanYear,
          details: cleanDetails,
          status: finalStatus,
          paymentDate: finalPaymentDate,
          subscriptionStartDate: finalPaymentDate,
          subscriptionEndDate: finalEnd,
        });
        addedCount += 1;
      }
    }

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Document import: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped`,
      actor: 'Admin Console',
    });

    return { addedCount, updatedCount, skippedCount };
  } catch (error) {
    console.error('Failed to bulk import students:', error);
    throw new Error('Failed to import student document.', { cause: error });
  }
}

// ==================== PARTNER FINDER / OPEN MATCHES ====================
export async function getOpenGames(date: string): Promise<OpenGame[]> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(openGames)
      .where(and(eq(openGames.date, date), eq(openGames.status, 'open')))
      .orderBy(desc(openGames.createdAt));
    return rows.map(mapOpenGameRow);
  } catch (error) {
    console.error('Failed to load open matches:', error);
    throw new Error('Failed to load partner finder matches.', { cause: error });
  }
}

export async function createOpenGame(params: {
  date: string;
  sportId: string;
  slotId: string;
  hostRollNo: string;
  spotsNeeded: number;
  skillLevel: string;
  note: string;
}): Promise<{ game?: OpenGame; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const sportRows = await db.select().from(sports).where(eq(sports.id, params.sportId)).limit(1);
    const sport = sportRows[0];
    if (!sport) return { errorStatus: 404, errorMessage: 'Sport not found.' };

    const slot = TIME_SLOTS.find((t) => t.id === params.slotId);
    if (!slot) return { errorStatus: 404, errorMessage: 'Invalid time slot.' };

    const normHost = normalizeRollNo(params.hostRollNo);
    const hostRows = await db
      .select()
      .from(students)
      .where(eq(students.rollNo, normHost))
      .limit(1);
    const host = hostRows[0];
    if (!host || host.status !== 'active') {
      return { errorStatus: 403, errorMessage: 'Active student profile required to post a match.' };
    }

    const clampedSpots = Math.max(
      sport.minPlayers,
      Math.min(sport.maxPlayers, Math.round(params.spotsNeeded || sport.minPlayers))
    );

    const inserted = await db
      .insert(openGames)
      .values({
        id: `MATCH-${Math.floor(100 + Math.random() * 900)}`,
        date: params.date,
        sportId: sport.id,
        sportName: sport.name,
        slotId: slot.id,
        slotLabel: slot.label,
        hostRollNo: host.rollNo,
        hostName: host.name,
        players: [{ rollNo: host.rollNo, name: host.name }],
        spotsNeeded: clampedSpots,
        skillLevel: (params.skillLevel || 'All Levels').trim(),
        note: (params.note || '').trim(),
        status: 'open',
      })
      .returning();

    return { game: mapOpenGameRow(inserted[0]) };
  } catch (error) {
    console.error('Failed to create open match:', error);
    throw new Error('Failed to post match invite.', { cause: error });
  }
}

export async function joinOrLeaveOpenGame(params: {
  gameId: string;
  rollNo: string;
  action: 'join' | 'leave' | 'close';
}): Promise<{ game?: OpenGame; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(openGames)
      .where(eq(openGames.id, params.gameId))
      .limit(1);
    const existing = rows[0];
    if (!existing) return { errorStatus: 404, errorMessage: 'Match listing not found.' };

    const norm = normalizeRollNo(params.rollNo);

    if (params.action === 'close') {
      if (normalizeRollNo(existing.hostRollNo) !== norm) {
        return { errorStatus: 403, errorMessage: 'Only the squad host can close this post.' };
      }
      const updated = await db
        .update(openGames)
        .set({ status: 'closed' })
        .where(eq(openGames.id, existing.id))
        .returning();
      return { game: mapOpenGameRow(updated[0]) };
    }

    if (existing.status !== 'open') {
      return { errorStatus: 400, errorMessage: 'This match squad is no longer open.' };
    }

    if (params.action === 'leave') {
      if (normalizeRollNo(existing.hostRollNo) === norm) {
        return { errorStatus: 400, errorMessage: 'Host cannot leave without closing the squad.' };
      }
      const nextPlayers = existing.players.filter((p) => normalizeRollNo(p.rollNo) !== norm);
      const updated = await db
        .update(openGames)
        .set({ players: nextPlayers })
        .where(eq(openGames.id, existing.id))
        .returning();
      return { game: mapOpenGameRow(updated[0]) };
    }

    // Join
    const stuRows = await db.select().from(students).where(eq(students.rollNo, norm)).limit(1);
    const stu = stuRows[0];
    if (!stu || stu.status !== 'active') {
      return { errorStatus: 403, errorMessage: 'Your student ID must be active to join.' };
    }
    if (existing.players.some((p) => normalizeRollNo(p.rollNo) === norm)) {
      return { game: mapOpenGameRow(existing) };
    }
    if (existing.players.length >= existing.spotsNeeded) {
      return { errorStatus: 409, errorMessage: 'This match squad is already full.' };
    }

    const nextPlayers = [...existing.players, { rollNo: stu.rollNo, name: stu.name }];
    const updated = await db
      .update(openGames)
      .set({ players: nextPlayers })
      .where(eq(openGames.id, existing.id))
      .returning();
    return { game: mapOpenGameRow(updated[0]) };
  } catch (error) {
    console.error('Failed updating open match:', error);
    throw new Error('Failed updating match squad.', { cause: error });
  }
}

export async function banStudentAdmin(params: {
  rollNo: string;
  days: number;
  scope: 'all' | 'selected';
  sportIds: string[];
  reason?: string;
}): Promise<{ student?: Student; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(params.rollNo);
    const rows = await db
      .select()
      .from(students)
      .where(eq(students.rollNo, norm))
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      return { errorStatus: 404, errorMessage: `Student ${norm} not found in Official Roster.` };
    }

    const days = Math.max(1, Math.min(365, Math.round(Number(params.days) || 1)));
    const scope: 'all' | 'selected' = params.scope === 'selected' ? 'selected' : 'all';
    const cleanSports =
      scope === 'selected'
        ? Array.from(new Set((params.sportIds || []).map((s) => s.trim()).filter(Boolean)))
        : [];
    if (scope === 'selected' && cleanSports.length === 0) {
      return {
        errorStatus: 400,
        errorMessage: 'Select at least one sport to ban, or choose All Sports.',
      };
    }

    const today = getTodayUtcYmd();
    const banUntil = addDaysYmd(today, days - 1);
    const cleanReason = (params.reason || '').trim() || null;
    const bannedAt = new Date().toISOString();

    const updated = await db
      .update(students)
      .set({
        banScope: scope,
        bannedSports: cleanSports,
        banUntil,
        banReason: cleanReason,
        bannedAt,
      })
      .where(eq(students.rollNo, norm))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Banned ${existing.name} (${existing.rollNo}) for ${days} day(s) through ${banUntil} (${
        scope === 'all' ? 'All Sports' : cleanSports.join(', ')
      })${cleanReason ? ` · ${cleanReason}` : ''}`,
      actor: 'Admin Console',
    });

    return { student: mapStudentRow(updated[0], today) };
  } catch (error) {
    console.error('Failed to ban student:', error);
    throw new Error('Failed to apply temporary ban.', { cause: error });
  }
}

export async function unbanStudentAdmin(
  rollNo: string
): Promise<{ student?: Student; errorStatus?: number; errorMessage?: string }> {
  try {
    await ensureSeeded();
    const norm = normalizeRollNo(rollNo);
    const rows = await db
      .select()
      .from(students)
      .where(eq(students.rollNo, norm))
      .limit(1);
    if (rows.length === 0) {
      return { errorStatus: 404, errorMessage: `Student ${norm} not found.` };
    }

    const updated = await db
      .update(students)
      .set({
        banScope: 'none',
        bannedSports: [],
        banUntil: null,
        banReason: null,
        bannedAt: null,
      })
      .where(eq(students.rollNo, norm))
      .returning();

    await db.insert(activityLogs).values({
      id: `ACT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      type: 'roster',
      summary: `Lifted sports ban for ${rows[0].name} (${rows[0].rollNo})`,
      actor: 'Admin Console',
    });

    return { student: mapStudentRow(updated[0], getTodayUtcYmd()) };
  } catch (error) {
    console.error('Failed to lift student ban:', error);
    throw new Error('Failed to unban student.', { cause: error });
  }
}

export async function buildAdminDashboard(
  connectedClientsCount: number,
  tzOffsetMinutes = 0
): Promise<AdminDashboardData> {
  try {
    await ensureSeeded();
    await autoAdmitOverduePendingBookings();
    await purgeExpiredBookingsOlderThan30Days(tzOffsetMinutes);
    const [
      sportsList,
      bookingRows,
      blockRows,
      studentRows,
      policy,
      logRows,
      loginAccounts,
      lightRows,
      signupOtpRows,
    ] = await Promise.all([
      getSportsWithCourts(),
      db.select().from(bookings).orderBy(desc(bookings.createdAt)),
      db.select().from(blockedSlots),
      db.select().from(students).orderBy(asc(students.rollNo)),
      getPolicy(true),
      db.select().from(activityLogs).orderBy(desc(activityLogs.timestamp)).limit(60),
      getAllRegisteredAccounts(),
      db.select().from(lightRequests).orderBy(desc(lightRequests.createdAt)).limit(100),
      getRecentSignupOtps(30),
    ]);

    const today = getTodayDateString(tzOffsetMinutes);
    const cutoff30 = getDateDaysAgoString(29, tzOffsetMinutes);
    const todaySub = getTodayUtcYmd();
    const mappedStudents = studentRows.map((row) => mapStudentRow(row, todaySub));
    // Retain 30-day rolling history in Bookings Ledger; permanent purge runs for day 31+
    const mappedBookings = bookingRows.map(mapBookingRow).filter((b) => b.date >= cutoff30);
    const activeBlocks = blockRows.filter((blk) => blk.date >= today);
    const activeLights = lightRows.filter((l) => l.date >= today);
    const confirmed = mappedBookings.filter((b) => b.status === 'confirmed');
    const cancelled = mappedBookings.filter((b) => b.status === 'cancelled');

    let totalRevenue = 0;
    let upiRevenue = 0;
    let cardRevenue = 0;
    let lateNightPaidBookings = 0;
    let standardFreeBookings = 0;

    for (const b of confirmed) {
      if (b.payment && b.payment.amount > 0) {
        totalRevenue += b.payment.amount;
        lateNightPaidBookings += 1;
        if (b.payment.method === 'upi') upiRevenue += b.payment.amount;
        if (b.payment.method === 'card') cardRevenue += b.payment.amount;
      } else {
        standardFreeBookings += 1;
      }
    }

    const totalCourtsCount = sportsList.reduce((acc, s) => acc + s.courts.length, 0);
    const operationalCourtsCount = sportsList.reduce(
      (acc, s) => acc + s.courts.filter((c) => c.status === 'operational').length,
      0
    );

    const todayConfirmedCount = confirmed.filter((b) => b.date === today).length;
    const totalSlotsToday = Math.max(1, operationalCourtsCount * TIME_SLOTS.length);
    const occupancyRatePercent = Math.min(
      100,
      Math.round((todayConfirmedCount / totalSlotsToday) * 100)
    );

    const revenueBySport = sportsList.map((s) => {
      const sportBookings = confirmed.filter((b) => b.sportId === s.id);
      const rev = sportBookings.reduce((sum, b) => sum + (b.payment?.amount || 0), 0);
      const lnCount = sportBookings.filter((b) => b.isLateNight).length;
      return {
        sportId: s.id,
        sportName: s.name,
        revenue: rev,
        bookings: sportBookings.length,
        lateNightCount: lnCount,
        operationalCourts: s.courts.filter((c) => c.status === 'operational').length,
        totalCourts: s.courts.length,
      };
    });

    const hourlyDemand = TIME_SLOTS.map((slot) => ({
      slotId: slot.id,
      shortLabel: slot.shortLabel,
      isLateNight: slot.isLateNight,
      bookings: confirmed.filter((b) => b.slotId === slot.id).length,
    }));

    return {
      metrics: {
        totalRevenue,
        upiRevenue,
        cardRevenue,
        totalConfirmedBookings: confirmed.length,
        lateNightPaidBookings,
        standardFreeBookings,
        cancelledBookings: cancelled.length,
        occupancyRatePercent,
        activeStudentsCount: mappedStudents.filter((s) => s.status === 'active').length,
        suspendedStudentsCount: mappedStudents.filter((s) => s.status === 'suspended').length,
        expiredStudentsCount: mappedStudents.filter((s) => s.status === 'expired').length,
        operationalCourtsCount,
        totalCourtsCount,
        connectedClientsCount,
        inCourtCount: confirmed.filter((b) => Boolean(b.inCourtAt)).length,
        securityAdmittedCount: confirmed.filter((b) => b.securityStatus === 'admitted').length,
      },
      revenueBySport,
      hourlyDemand,
      bookings: mappedBookings,
      sports: sportsList,
      blockedSlots: activeBlocks.map((blk) => ({
        id: blk.id,
        date: blk.date,
        sportId: blk.sportId,
        courtId: blk.courtId,
        slotId: blk.slotId,
        reason: blk.reason,
        createdAt: blk.createdAt.toISOString(),
      })),
      students: mappedStudents,
      loginAccounts,
      lightRequests: activeLights.map(mapLightRequestRow),
      signupOtps: signupOtpRows,
      policy,
      activityLog: logRows.map((l): ActivityLogEntry => ({
        id: l.id,
        timestamp: l.timestamp.toISOString(),
        type: l.type as ActivityLogEntry['type'],
        summary: l.summary,
        actor: l.actor,
      })),
    };
  } catch (error) {
    console.error('Failed to build admin dashboard:', error);
    throw new Error('Failed to load admin analytics.', { cause: error });
  }
}
