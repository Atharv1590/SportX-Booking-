export const SCHOOL_DEPARTMENTS = [
  'SoB',
  'SoT',
  'SoAD',
  'SoAP',
  'SoL',
  'SoLAH',
  'SoS',
] as const;

export type SchoolDepartment = (typeof SCHOOL_DEPARTMENTS)[number];

export type StudentStatus = 'active' | 'inactive' | 'suspended' | 'expired';

export interface Student {
  id: string;
  rollNo: string;
  idNo?: string | null;
  name: string;
  email: string;
  phone: string;
  department: string;
  year: string;
  details: string;
  status: StudentStatus;
  inRoster?: boolean;
  paymentDate?: string | null;
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  isBanned?: boolean;
  banScope?: 'none' | 'all' | 'selected';
  bannedSports?: string[];
  banUntil?: string | null;
  banReason?: string | null;
  bannedAt?: string | null;
  createdAt: string;
}

export interface RegisteredAccount {
  id: string;
  rollNo: string;
  idNo?: string | null;
  name: string;
  email: string;
  phone: string;
  department: string;
  year: string;
  details: string;
  inRoster: boolean;
  rosterStatus: StudentStatus;
  paymentDate?: string | null;
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  isBanned?: boolean;
  banScope?: 'none' | 'all' | 'selected';
  bannedSports?: string[];
  banUntil?: string | null;
  banReason?: string | null;
  bannedAt?: string | null;
  createdAt: string;
}

export interface RosterEntry {
  rollNo: string;
  idNo?: string | null;
  name: string;
  department: string;
  year: string;
  status: StudentStatus;
  paymentDate?: string | null;
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  isBanned?: boolean;
  banScope?: 'none' | 'all' | 'selected';
  bannedSports?: string[];
  banUntil?: string | null;
  banReason?: string | null;
  bannedAt?: string | null;
}

export type CourtStatus = 'operational' | 'maintenance';

export interface Court {
  id: string;
  name: string;
  surface: string;
  status: CourtStatus;
}

export interface Sport {
  id: string;
  name: string;
  category: string;
  minPlayers: number;
  maxPlayers: number;
  lateNightFee: number;
  equipmentRequired: string;
  location: string;
  courts: Court[];
}

export interface TimeSlot {
  id: string;
  label: string;
  shortLabel: string;
  startHour: number;
  isLateNight: boolean;
}

export interface TeammateInput {
  rollNo: string;
  name: string;
}

export interface PlayerValidationResult {
  rollNo: string;
  valid: boolean;
  status:
    | 'active'
    | 'suspended'
    | 'expired'
    | 'banned'
    | 'not_found'
    | 'duplicate'
    | 'conflict'
    | 'empty';
  studentName?: string;
  department?: string;
  message: string;
}

export interface PaymentInfo {
  method: 'upi' | 'card';
  amount: number;
  transactionId: string;
  detailsMasked: string;
  paidAt: string;
}

export type SecurityCheckInStatus = 'pending' | 'admitted' | 'no_show';

export interface Booking {
  id: string;
  bookingCode?: number | null;
  date: string;
  sportId: string;
  sportName: string;
  courtId: string;
  courtName: string;
  slotId: string;
  slotLabel: string;
  isLateNight: boolean;
  bookedByRollNo: string;
  bookedByName: string;
  bookedByEmail: string;
  players: { rollNo: string; name: string }[];
  status: 'confirmed' | 'cancelled';
  cancelReason?: string;
  cancelledBy?: 'student' | 'admin' | 'walkin';
  payment: PaymentInfo | null;
  rulesAcceptedAt: string;
  inCourtAt?: string | null;
  inCourtByRollNo?: string | null;
  securityStatus: SecurityCheckInStatus;
  securityCheckedInAt?: string | null;
  securityNotes?: string | null;
  autoAdmitAt?: string | null;
  createdAt: string;
}

export interface LightRequest {
  id: string;
  bookingId: string;
  bookingCode?: number | null;
  date: string;
  sportId: string;
  sportName: string;
  courtId: string;
  courtName: string;
  slotId: string;
  slotLabel: string;
  requestedByRollNo: string;
  requestedByName: string;
  note: string;
  status: 'open' | 'closed';
  createdAt: string;
  closedAt?: string | null;
}

export interface BlockedSlot {
  id: string;
  date: string;
  sportId: string;
  courtId: string;
  slotId: string;
  reason: string;
  createdAt: string;
}

export interface PublicSlotBooking {
  id: string;
  bookingCode?: number | null;
  date: string;
  sportId: string;
  courtId: string;
  slotId: string;
  bookedByName: string;
  bookedByRollNo: string;
  players?: { rollNo: string; name: string }[];
  playerCount: number;
  isLateNight: boolean;
  inCourtAt?: string | null;
  securityStatus?: SecurityCheckInStatus;
}

export interface FacilityRuleItem {
  id: string;
  title: string;
  description: string;
}

export interface BookingPolicy {
  sameDayOnly: boolean;
  openingHour: number;
  morningBookingOpenHour: number;
  eveningBookingOpenHour: number;
  enforceOpeningHour: boolean;
  weekdayMorningStart: string;
  weekdayMorningEnd: string;
  weekdayEveningStart: string;
  weekdayEveningEnd: string;
  weekendMorningStart: string;
  weekendMorningEnd: string;
  weekendEveningStart: string;
  weekendEveningEnd: string;
  announcement: string;
  earlyArrivalMinutes: number;
  inCourtWindowMinutes: number;
  adminPasscode?: string;
  securityPasscode?: string;
  walkInPasscode?: string;
  walkInCancelCode?: string;
  trainingOverrideCode?: string;
  gmailSenderEmail?: string;
  gmailAutoSend?: boolean;
  gmailConnectionMode?: 'smtp' | 'oauth';
  gmailHasAppPassword?: boolean;
  facilityRules: FacilityRuleItem[];
}

export interface SignupOtpSummary {
  id: string;
  email: string;
  rollNo: string;
  name: string;
  status: 'pending' | 'sending' | 'sent' | 'verified' | 'failed';
  attempts: number;
  sentFromEmail?: string | null;
  lastError?: string | null;
  expiresAt: string;
  sentAt?: string | null;
  createdAt: string;
}

export interface OpenGame {
  id: string;
  date: string;
  sportId: string;
  sportName: string;
  slotId: string;
  slotLabel: string;
  hostRollNo: string;
  hostName: string;
  players: { rollNo: string; name: string }[];
  spotsNeeded: number;
  skillLevel: string;
  note: string;
  status: 'open' | 'booked' | 'closed';
  bookingId?: string | null;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  type: 'booking' | 'cancel' | 'payment' | 'block' | 'facility' | 'roster' | 'policy' | 'security' | 'checkin';
  summary: string;
  actor: string;
}

export interface AdminDashboardData {
  metrics: {
    totalRevenue: number;
    upiRevenue: number;
    cardRevenue: number;
    totalConfirmedBookings: number;
    lateNightPaidBookings: number;
    standardFreeBookings: number;
    cancelledBookings: number;
    occupancyRatePercent: number;
    activeStudentsCount: number;
    suspendedStudentsCount: number;
    expiredStudentsCount: number;
    operationalCourtsCount: number;
    totalCourtsCount: number;
    connectedClientsCount: number;
    inCourtCount: number;
    securityAdmittedCount: number;
  };
  revenueBySport: {
    sportId: string;
    sportName: string;
    revenue: number;
    bookings: number;
    lateNightCount: number;
    operationalCourts: number;
    totalCourts: number;
  }[];
  hourlyDemand: {
    slotId: string;
    shortLabel: string;
    isLateNight: boolean;
    bookings: number;
  }[];
  bookings: Booking[];
  sports: Sport[];
  blockedSlots: BlockedSlot[];
  students: Student[];
  loginAccounts: RegisteredAccount[];
  lightRequests: LightRequest[];
  signupOtps: SignupOtpSummary[];
  policy: BookingPolicy;
  activityLog: ActivityLogEntry[];
}

export interface SecurityGateWindowData {
  date: string;
  currentHour: number;
  baseHour: number;
  prevSlotId: string | null;
  currentSlotId: string | null;
  nextSlotId: string | null;
  windowSlots: TimeSlot[];
  monitoredSports: Sport[];
  bookings: Booking[];
  openLightRequests: LightRequest[];
  allLightRequests: LightRequest[];
}
