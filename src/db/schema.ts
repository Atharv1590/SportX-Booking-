import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const students = pgTable('students', {
  id: text('id').primaryKey(),
  firebaseUid: text('firebase_uid').unique(),
  rollNo: text('roll_no').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  department: text('department').notNull(),
  year: text('year').notNull(),
  details: text('details').notNull().default(''),
  passwordHash: text('password_hash'),
  savedDeviceKeys: jsonb('saved_device_keys').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('active'),
  idNo: text('id_no'),
  paymentDate: text('payment_date'),
  subscriptionStartDate: text('subscription_start_date'),
  subscriptionEndDate: text('subscription_end_date'),
  banScope: text('ban_scope').notNull().default('none'),
  bannedSports: jsonb('banned_sports').$type<string[]>().notNull().default([]),
  banUntil: text('ban_until'),
  banReason: text('ban_reason'),
  bannedAt: text('banned_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const studentAccounts = pgTable('student_accounts', {
  id: text('id').primaryKey(),
  firebaseUid: text('firebase_uid').unique(),
  rollNo: text('roll_no').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  department: text('department').notNull(),
  year: text('year').notNull(),
  details: text('details').notNull().default(''),
  passwordHash: text('password_hash'),
  savedDeviceKeys: jsonb('saved_device_keys').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sports = pgTable('sports', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  minPlayers: integer('min_players').notNull(),
  maxPlayers: integer('max_players').notNull(),
  lateNightFee: integer('late_night_fee').notNull(),
  equipmentRequired: text('equipment_required').notNull(),
  location: text('location').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const courts = pgTable('courts', {
  id: text('id').primaryKey(),
  sportId: text('sport_id')
    .notNull()
    .references(() => sports.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  surface: text('surface').notNull(),
  status: text('status').notNull().default('operational'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const bookings = pgTable('bookings', {
  id: text('id').primaryKey(),
  bookingCode: integer('booking_code'),
  codeCycleDate: text('code_cycle_date'),
  date: text('date').notNull(),
  sportId: text('sport_id')
    .notNull()
    .references(() => sports.id),
  sportName: text('sport_name').notNull(),
  courtId: text('court_id')
    .notNull()
    .references(() => courts.id),
  courtName: text('court_name').notNull(),
  slotId: text('slot_id').notNull(),
  slotLabel: text('slot_label').notNull(),
  isLateNight: boolean('is_late_night').notNull().default(false),
  bookedByUid: text('booked_by_uid'),
  bookedByRollNo: text('booked_by_roll_no').notNull(),
  bookedByName: text('booked_by_name').notNull(),
  bookedByEmail: text('booked_by_email').notNull(),
  players: jsonb('players').$type<{ rollNo: string; name: string }[]>().notNull(),
  status: text('status').notNull().default('confirmed'),
  cancelReason: text('cancel_reason'),
  cancelledBy: text('cancelled_by'),
  payment: jsonb('payment').$type<{
    method: 'upi' | 'card';
    amount: number;
    transactionId: string;
    detailsMasked: string;
    paidAt: string;
  } | null>(),
  rulesAcceptedAt: text('rules_accepted_at').notNull(),
  inCourtAt: text('in_court_at'),
  inCourtByRollNo: text('in_court_by_roll_no'),
  securityStatus: text('security_status').notNull().default('pending'),
  securityCheckedInAt: text('security_checked_in_at'),
  securityNotes: text('security_notes'),
  autoAdmitAt: text('auto_admit_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const blockedSlots = pgTable('blocked_slots', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  sportId: text('sport_id')
    .notNull()
    .references(() => sports.id),
  courtId: text('court_id')
    .notNull()
    .references(() => courts.id),
  slotId: text('slot_id').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const appPolicy = pgTable('app_policy', {
  id: integer('id').primaryKey(),
  sameDayOnly: boolean('same_day_only').notNull().default(true),
  openingHour: integer('opening_hour').notNull().default(8),
  morningBookingOpenHour: integer('morning_booking_open_hour').notNull().default(3),
  eveningBookingOpenHour: integer('evening_booking_open_hour').notNull().default(8),
  enforceOpeningHour: boolean('enforce_opening_hour').notNull().default(true),
  weekdayMorningStart: text('weekday_morning_start').notNull().default('05:00'),
  weekdayMorningEnd: text('weekday_morning_end').notNull().default('09:30'),
  weekdayEveningStart: text('weekday_evening_start').notNull().default('16:00'),
  weekdayEveningEnd: text('weekday_evening_end').notNull().default('23:00'),
  weekendMorningStart: text('weekend_morning_start').notNull().default('05:00'),
  weekendMorningEnd: text('weekend_morning_end').notNull().default('12:00'),
  weekendEveningStart: text('weekend_evening_start').notNull().default('17:00'),
  weekendEveningEnd: text('weekend_evening_end').notNull().default('23:00'),
  announcement: text('announcement').notNull().default(''),
  earlyArrivalMinutes: integer('early_arrival_minutes').notNull().default(10),
  inCourtWindowMinutes: integer('in_court_window_minutes').notNull().default(5),
  securityPasscode: text('security_passcode').notNull().default('gate2026'),
  walkInPasscode: text('walkin_passcode').notNull().default('walk2026'),
  walkInCancelCode: text('walkin_cancel_code').notNull().default('cancel2026'),
  trainingOverrideCode: text('training_override_code').notNull().default('train2026'),
  adminPasscode: text('admin_passcode').notNull().default('8309762055'),
  gmailSenderEmail: text('gmail_sender_email').notNull().default(''),
  gmailAutoSend: boolean('gmail_auto_send').notNull().default(true),
  gmailConnectionMode: text('gmail_connection_mode').notNull().default('smtp'),
  gmailAppPasswordEnc: text('gmail_app_password_enc').notNull().default(''),
  facilityRules: jsonb('facility_rules')
    .$type<{ id: string; title: string; description: string }[]>()
    .notNull()
    .default([]),
});

export const signupOtps = pgTable('signup_otps', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  rollNo: text('roll_no').notNull(),
  name: text('name').notNull(),
  codeHash: text('code_hash').notNull(),
  encryptedCode: text('encrypted_code').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  sentFromEmail: text('sent_from_email'),
  lastError: text('last_error'),
  expiresAt: timestamp('expires_at').notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const lightRequests = pgTable('light_requests', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull(),
  bookingCode: integer('booking_code'),
  date: text('date').notNull(),
  sportId: text('sport_id').notNull(),
  sportName: text('sport_name').notNull(),
  courtId: text('court_id').notNull(),
  courtName: text('court_name').notNull(),
  slotId: text('slot_id').notNull(),
  slotLabel: text('slot_label').notNull(),
  requestedByRollNo: text('requested_by_roll_no').notNull(),
  requestedByName: text('requested_by_name').notNull(),
  note: text('note').notNull().default(''),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  closedAt: text('closed_at'),
});

export const openGames = pgTable('open_games', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  sportId: text('sport_id')
    .notNull()
    .references(() => sports.id, { onDelete: 'cascade' }),
  sportName: text('sport_name').notNull(),
  slotId: text('slot_id').notNull(),
  slotLabel: text('slot_label').notNull(),
  hostRollNo: text('host_roll_no').notNull(),
  hostName: text('host_name').notNull(),
  players: jsonb('players').$type<{ rollNo: string; name: string }[]>().notNull(),
  spotsNeeded: integer('spots_needed').notNull(),
  skillLevel: text('skill_level').notNull().default('All Levels'),
  note: text('note').notNull().default(''),
  status: text('status').notNull().default('open'),
  bookingId: text('booking_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  type: text('type').notNull(),
  summary: text('summary').notNull(),
  actor: text('actor').notNull(),
});

export const sportsRelations = relations(sports, ({ many }) => ({
  courts: many(courts),
}));

export const courtsRelations = relations(courts, ({ one }) => ({
  sport: one(sports, {
    fields: [courts.sportId],
    references: [sports.id],
  }),
}));
