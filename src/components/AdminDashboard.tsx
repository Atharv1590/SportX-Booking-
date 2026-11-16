import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  Ban,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Dumbbell,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Grid3X3,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import {
  SCHOOL_DEPARTMENTS,
  type AdminDashboardData,
  type BlockedSlot,
  type Booking,
  type FacilityRuleItem,
  type RegisteredAccount,
  type SecurityCheckInStatus,
  type SignupOtpSummary,
  type TimeSlot,
} from '../types';
import {
  formatHourMinute12,
  getDayScheduleWindows,
  getLiveCenteredSlots,
  getSlotOperationalState,
  getSportsDayString,
} from '../lib/schedule';
import {
  clearGmailAccessToken,
  connectAdminGmail,
  disconnectAdminGmail,
  getGmailAccessToken,
} from '../lib/firebase';
import { SportXLogo } from './SportXLogo';
import subscriptionsDarkBg from '../assets/images/subscriptions_dark_bg_1794802101746.jpg';

interface AdminDashboardProps {
  timeSlots: TimeSlot[];
  syncVersion: number;
  syncConnected: boolean;
  gmailConnectedEmail: string | null;
  gmailAutoSendConfirmed: boolean;
  onGmailStateChange: (email: string | null, autoConfirmed: boolean) => void;
  onAdminTokenChange: (token: string | null) => void;
  onExitAdmin: () => void;
  onOpenSecurity?: () => void;
  onFacilitiesUpdated: () => void;
}

type AdminTab =
  | 'overview'
  | 'matrix'
  | 'bookings'
  | 'facilities'
  | 'students'
  | 'subscriptions'
  | 'gmail'
  | 'policy';

type SubscriptionSubTab = 'subscriptions' | 'noshows' | 'accounts';

interface ParsedStudentRow {
  rollNo: string;
  idNo?: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  year: string;
  status: string;
  paymentDate?: string;
  subscriptionStartDate?: string;
}

function getTodayDateString(): string {
  return getSportsDayString();
}

function addDaysToDateString(baseDate: string, days: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const ry = dt.getUTCFullYear();
  const rm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

function addOneYearDate(startDate: string): string {
  const [y, m, d] = startDate.split('-').map(Number);
  const dt = new Date(Date.UTC((y || 2026) + 1, (m || 1) - 1, d || 1));
  const ry = dt.getUTCFullYear();
  const rm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

function enumerateDatesBetween(startDate: string, endDate: string): string[] {
  if (!startDate) return [];
  const end = endDate && endDate >= startDate ? endDate : startDate;
  const out: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const d = addDaysToDateString(startDate, i);
    out.push(d);
    if (d >= end) break;
  }
  return out;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join(
    '\n'
  );
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseFlexibleImportDate(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 25000 && raw < 80000) {
    const utcDays = Math.floor(raw - 25569);
    const dt = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(dt.getTime())) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const s = String(raw).trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (['unpaid', 'pending', 'none', 'na', 'n/a', '-', 'nil', 'not paid', 'due'].includes(low)) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (isoPrefix) return isoPrefix[1];

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const mon = Number(dmy[2]);
    let yr = Number(dmy[3]);
    if (yr < 100) yr += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "10-Jan-2026" or "10 Jan 2026"
  const dMonY = s.match(/^(\d{1,2})[\s-]+([a-zA-Z]+)[\s,-]+(\d{2,4})$/);
  if (dMonY) {
    const day = Number(dMonY[1]);
    const mon = MONTH_MAP[dMonY[2].toLowerCase()];
    let yr = Number(dMonY[3]);
    if (yr < 100) yr += 2000;
    if (mon && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "Jan 10, 2026"
  const monDY = s.match(/^([a-zA-Z]+)[\s-]+(\d{1,2})[\s,-]+(\d{2,4})$/);
  if (monDY) {
    const mon = MONTH_MAP[monDY[1].toLowerCase()];
    const day = Number(monDY[2]);
    let yr = Number(monDY[3]);
    if (yr < 100) yr += 2000;
    if (mon && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return '';
}

function normalizeImportedRow(raw: Record<string, unknown>): ParsedStudentRow | null {
  const lowered: Record<string, string> = {};
  const rawByKey: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = k.trim().toLowerCase().replace(/[\s_.-]+/g, '');
    lowered[nk] = String(v ?? '').trim();
    rawByKey[nk] = v;
  }

  const rawIdNo =
    lowered.idno ||
    lowered.idnumber ||
    lowered.collegeid ||
    lowered.cardno ||
    lowered.idcard ||
    lowered.universityid ||
    '';

  const rawRollNo =
    lowered.rollno ||
    lowered.rollnumber ||
    lowered.studentid ||
    lowered.roll ||
    (!rawIdNo && lowered.id ? lowered.id : '') ||
    rawIdNo;

  const name = lowered.name || lowered.fullname || lowered.studentname || '';
  if (!rawRollNo || !name) return null;

  const cleanRollNo = rawRollNo.toUpperCase().replace(/\s+/g, '');
  const cleanIdNo = rawIdNo ? rawIdNo.toUpperCase().replace(/\s+/g, '') : undefined;

  const email =
    lowered.email ||
    lowered.outlook ||
    lowered.outlookmail ||
    lowered.collegeemail ||
    lowered.gmail ||
    `${cleanRollNo.toLowerCase()}@campus.edu.in`;
  const phone = lowered.phone || lowered.phno || lowered.mobile || '9000000000';
  const department = lowered.school || lowered.department || lowered.dept || lowered.branch || 'SoT';
  const year = lowered.year || lowered.academicyear || '1st Year';

  const paymentKeys = [
    'dayofpayment',
    'paymentdate',
    'paiddate',
    'paidon',
    'dateofpayment',
    'paymentday',
    'feepaiddate',
    'subscriptionstartdate',
    'startdate',
    'joineddate',
  ];
  let parsedPaymentDate = '';
  for (const pk of paymentKeys) {
    if (pk in rawByKey) {
      parsedPaymentDate = parseFlexibleImportDate(rawByKey[pk]);
      if (parsedPaymentDate) break;
    }
  }

  const rawStatus = (lowered.status || '').toLowerCase();
  const todayStr = getTodayDateString();
  let computedStatus: 'active' | 'expired' | 'suspended' = 'active';
  if (rawStatus === 'suspended') {
    computedStatus = 'suspended';
  } else if (
    !parsedPaymentDate ||
    rawStatus === 'expired' ||
    rawStatus === 'unpaid' ||
    rawStatus === 'inactive'
  ) {
    computedStatus = 'expired';
  } else if (addOneYearDate(parsedPaymentDate) < todayStr) {
    computedStatus = 'expired';
  }

  return {
    rollNo: cleanRollNo,
    idNo: cleanIdNo,
    name,
    email: email.toLowerCase(),
    phone,
    department,
    year,
    status: computedStatus,
    paymentDate: parsedPaymentDate,
    subscriptionStartDate: parsedPaymentDate,
  };
}

const HALF_HOUR_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 39 },
  (_, idx) => {
    const totalMins = 5 * 60 + idx * 30;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return {
      value,
      label: formatHourMinute12(h, m),
    };
  }
);

const HOUR_UNLOCK_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 24 },
  (_, h) => ({
    value: h,
    label: formatHourMinute12(h, 0),
  })
);

export function AdminDashboard({
  timeSlots,
  syncVersion,
  syncConnected,
  gmailConnectedEmail,
  gmailAutoSendConfirmed,
  onGmailStateChange,
  onAdminTokenChange,
  onExitAdmin,
  onOpenSecurity,
  onFacilitiesUpdated,
}: AdminDashboardProps) {
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem('campusarena_admin_token')
  );

  useEffect(() => {
    onAdminTokenChange(adminToken);
  }, [adminToken, onAdminTokenChange]);

  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Matrix state
  const [matrixDate, setMatrixDate] = useState<string>(getTodayDateString());
  const [matrixSportFilter, setMatrixSportFilter] = useState<string>('all');
  const [matrixOrder, setMatrixOrder] = useState<'live' | 'chrono'>('live');
  const [selectedCell, setSelectedCell] = useState<{
    sportId: string;
    sportName: string;
    courtId: string;
    courtName: string;
    slot: TimeSlot;
    booking?: Booking;
    blocked?: BlockedSlot;
  } | null>(null);
  const [blockReason, setBlockReason] = useState('Tournament / Maintenance');
  const [reassignCourtId, setReassignCourtId] = useState<string>('');
  const [reassigning, setReassigning] = useState(false);

  // Live clock hour synced every 30s so matrix #3 column tracks real-world time
  const [currentHour, setCurrentHour] = useState<number>(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => {
      setCurrentHour(new Date().getHours());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Bulk block helper
  const [bulkSportId, setBulkSportId] = useState('badminton');
  const [bulkCourtId, setBulkCourtId] = useState('badminton-c1');
  const [bulkReason, setBulkReason] = useState('Inter-College Tournament');

  // Advance multi-day court blocking state (future dates e.g. Tomorrow Courts 1-4 Training)
  const [advStartDate, setAdvStartDate] = useState(() => addDaysToDateString(getTodayDateString(), 1));
  const [advEndDate, setAdvEndDate] = useState(() => addDaysToDateString(getTodayDateString(), 1));
  const [advSportId, setAdvSportId] = useState('badminton');
  const [advCourtIds, setAdvCourtIds] = useState<string[]>([]);
  const [advSlotIds, setAdvSlotIds] = useState<string[]>([]);
  const [advReason, setAdvReason] = useState('Official Team Training Camp');
  const [advCancelConflicts, setAdvCancelConflicts] = useState(true);
  const [submittingAdvanceBlock, setSubmittingAdvanceBlock] = useState(false);

  // Bookings filter state
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<'all' | 'confirmed' | 'cancelled'>('all');
  const [bookingTierFilter, setBookingTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);

  // Facilities, Add New Sport & inline court/table name editor state
  const [newSportName, setNewSportName] = useState('');
  const [newSportCategory, setNewSportCategory] = useState('Team Sports');
  const [newSportMinPlayers, setNewSportMinPlayers] = useState('2');
  const [newSportMaxPlayers, setNewSportMaxPlayers] = useState('6');
  const [newSportFee, setNewSportFee] = useState('300');
  const [newSportLocation, setNewSportLocation] = useState('Main Sports Complex');
  const [newSportEquipment, setNewSportEquipment] = useState('Valid College ID card and sport-appropriate shoes.');
  const [newSportCourtCount, setNewSportCourtCount] = useState('2');
  const [newSportSurface, setNewSportSurface] = useState('Pro Arena Surface');
  const [addingSport, setAddingSport] = useState(false);

  const [newCourtSportId, setNewCourtSportId] = useState('badminton');
  const [newCourtName, setNewCourtName] = useState('');
  const [newCourtSurface, setNewCourtSurface] = useState('');
  const [editingCourtKey, setEditingCourtKey] = useState<string | null>(null);
  const [editingCourtName, setEditingCourtName] = useState('');
  const [editingCourtSurface, setEditingCourtSurface] = useState('');
  const [sportEdits, setSportEdits] = useState<
    Record<
      string,
      {
        lateNightFee: string;
        minPlayers: string;
        maxPlayers: string;
        equipmentRequired: string;
        location: string;
      }
    >
  >({});

  // Roster & Document Importer state
  const [studentSearch, setStudentSearch] = useState('');
  const [newStudentRoll, setNewStudentRoll] = useState('');
  const [newStudentIdNo, setNewStudentIdNo] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentDept, setNewStudentDept] = useState<string>(SCHOOL_DEPARTMENTS[1]);
  const [newStudentSubStart, setNewStudentSubStart] = useState<string>(getTodayDateString());
  const [parsedImportRows, setParsedImportRows] = useState<ParsedStudentRow[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [importingBulk, setImportingBulk] = useState(false);

  // Unified Canva Black Subscriptions / No-Shows / Login Accounts hub state
  const [subPageTab, setSubPageTab] = useState<SubscriptionSubTab>('subscriptions');
  const [loginAccountSearch, setLoginAccountSearch] = useState('');
  const [subSearch, setSubSearch] = useState('');
  const [subFilter, setSubFilter] = useState<'all' | 'expired' | 'expiring' | 'active' | 'banned'>('all');
  const [payingRollNo, setPayingRollNo] = useState<string | null>(null);
  const [paymentEntryDate, setPaymentEntryDate] = useState<string>(getTodayDateString());
  const [banTarget, setBanTarget] = useState<{ rollNo: string; name: string } | null>(null);
  const [banDays, setBanDays] = useState<number>(3);
  const [banScope, setBanScope] = useState<'all' | 'selected'>('all');
  const [banSportIds, setBanSportIds] = useState<string[]>([]);
  const [banReason, setBanReason] = useState<string>('');
  const [savingBan, setSavingBan] = useState<boolean>(false);

  // Policy, Schedule Windows, Unlock Times & Facility Rules state
  const [policyMorningOpenHour, setPolicyMorningOpenHour] = useState<number>(3);
  const [policyEveningOpenHour, setPolicyEveningOpenHour] = useState<number>(8);
  const [policyEnforceHour, setPolicyEnforceHour] = useState<boolean>(true);
  const [policySameDay, setPolicySameDay] = useState<boolean>(true);
  const [policyWdMStart, setPolicyWdMStart] = useState<string>('05:00');
  const [policyWdMEnd, setPolicyWdMEnd] = useState<string>('09:30');
  const [policyWdEStart, setPolicyWdEStart] = useState<string>('16:00');
  const [policyWdEEnd, setPolicyWdEEnd] = useState<string>('23:00');
  const [policyWeMStart, setPolicyWeMStart] = useState<string>('05:00');
  const [policyWeMEnd, setPolicyWeMEnd] = useState<string>('12:00');
  const [policyWeEStart, setPolicyWeEStart] = useState<string>('17:00');
  const [policyWeEEnd, setPolicyWeEEnd] = useState<string>('23:00');
  const [policyAnnouncement, setPolicyAnnouncement] = useState<string>('');
  const [policyEarlyMins, setPolicyEarlyMins] = useState<number>(10);
  const [policyInCourtMins, setPolicyInCourtMins] = useState<number>(5);
  const [policyRules, setPolicyRules] = useState<FacilityRuleItem[]>([]);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleDesc, setNewRuleDesc] = useState('');

  // Dedicated Access Codes & Passwords state
  const [codeAdminPass, setCodeAdminPass] = useState('');
  const [codeSecurityPin, setCodeSecurityPin] = useState('');
  const [codeWalkInPass, setCodeWalkInPass] = useState('');
  const [codeWalkInCancel, setCodeWalkInCancel] = useState('');
  const [codeTrainingOverride, setCodeTrainingOverride] = useState('');
  const [showCodeKey, setShowCodeKey] = useState<Record<string, boolean>>({});
  const [savingCodes, setSavingCodes] = useState(false);

  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailPendingConfirmEmail, setGmailPendingConfirmEmail] = useState<string | null>(null);
  const [confirmAutoEnableModalOpen, setConfirmAutoEnableModalOpen] = useState(false);
  const [confirmManualOtpSend, setConfirmManualOtpSend] = useState<SignupOtpSummary | null>(null);
  const [sendingOtpId, setSendingOtpId] = useState<string | null>(null);

  const [smtpEmailInput, setSmtpEmailInput] = useState('');
  const [smtpAppPasswordInput, setSmtpAppPasswordInput] = useState('');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);

  const syncPolicyStateFromData = useCallback((p: AdminDashboardData['policy'] | undefined) => {
    if (!p) return;
    setPolicyMorningOpenHour(p.morningBookingOpenHour ?? 3);
    setPolicyEveningOpenHour(p.eveningBookingOpenHour ?? p.openingHour ?? 8);
    setPolicyEnforceHour(p.enforceOpeningHour ?? true);
    setPolicySameDay(p.sameDayOnly ?? true);
    setPolicyWdMStart(p.weekdayMorningStart ?? '05:00');
    setPolicyWdMEnd(p.weekdayMorningEnd ?? '09:30');
    setPolicyWdEStart(p.weekdayEveningStart ?? '16:00');
    setPolicyWdEEnd(p.weekdayEveningEnd ?? '23:00');
    setPolicyWeMStart(p.weekendMorningStart ?? '05:00');
    setPolicyWeMEnd(p.weekendMorningEnd ?? '12:00');
    setPolicyWeEStart(p.weekendEveningStart ?? '17:00');
    setPolicyWeEEnd(p.weekendEveningEnd ?? '23:00');
    setPolicyAnnouncement(p.announcement ?? '');
    setPolicyEarlyMins(p.earlyArrivalMinutes ?? 10);
    setPolicyInCourtMins(p.inCourtWindowMinutes ?? 5);
    setPolicyRules(p.facilityRules ?? []);
    if (p.adminPasscode) setCodeAdminPass(p.adminPasscode);
    if (p.securityPasscode) setCodeSecurityPin(p.securityPasscode);
    if (p.walkInPasscode) setCodeWalkInPass(p.walkInPasscode);
    if (p.walkInCancelCode) setCodeWalkInCancel(p.walkInCancelCode);
    if (p.trainingOverrideCode) setCodeTrainingOverride(p.trainingOverrideCode);
    if (p.gmailSenderEmail) {
      setSmtpEmailInput((prev) => prev || p.gmailSenderEmail || '');
    }
  }, []);

  const fetchDashboard = useCallback(
    async (token: string) => {
      setLoading(true);
      setActionError(null);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const res = await fetch(`/api/admin/dashboard?tzOffset=${tzOffset}`, {
          headers: {
            'x-admin-token': token,
            'x-tz-offset': String(tzOffset),
          },
        });
        if (res.status === 401) {
          sessionStorage.removeItem('campusarena_admin_token');
          setAdminToken(null);
          setDashboard(null);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          setDashboard(data);
          syncPolicyStateFromData(data.policy);
        } else {
          setActionError(data.error || 'Failed to load dashboard data.');
        }
      } catch {
        setActionError('Network error loading admin telemetry.');
      } finally {
        setLoading(false);
      }
    },
    [syncPolicyStateFromData]
  );

  useEffect(() => {
    if (adminToken) {
      fetchDashboard(adminToken);
    }
  }, [adminToken, fetchDashboard, syncVersion]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Access denied.');
        setLoggingIn(false);
        return;
      }
      sessionStorage.setItem('campusarena_admin_token', data.token);
      setAdminToken(data.token);
      setPasswordInput('');
    } catch {
      setAuthError('Unable to verify credentials.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleAdminLogout = async () => {
    if (adminToken) {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
      }).catch(() => {});
    }
    sessionStorage.removeItem('campusarena_admin_token');
    setAdminToken(null);
    setDashboard(null);
    onExitAdmin();
  };

  const handleAdminCancelBooking = async (bookingId: string, reason: string) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to cancel booking.');
        return;
      }
      setDashboard(data.dashboard);
      setCancellingBookingId(null);
      setCancelReasonInput('');
      setSelectedCell(null);
      setActionNotice(`Booking ${bookingId} cancelled and slot released across all devices.`);
    } catch {
      setActionError('Network error cancelling booking.');
    }
  };

  const handleAdminGateStatus = async (
    bookingId: string,
    securityStatus: SecurityCheckInStatus
  ) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/gate-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ securityStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to update gate admission status.');
        return;
      }
      setDashboard(data.dashboard);
      if (selectedCell?.booking?.id === bookingId) {
        const refreshed = data.dashboard.bookings.find((b: Booking) => b.id === bookingId);
        if (refreshed) {
          setSelectedCell({ ...selectedCell, booking: refreshed });
        }
      }
      setActionNotice(`Booking ${bookingId} updated to ${securityStatus.replace('_', ' ')}.`);
    } catch {
      setActionError('Network error updating gate status.');
    }
  };

  const handleReassignBookingCourt = async () => {
    if (!adminToken || !selectedCell?.booking || !reassignCourtId) return;
    setReassigning(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${selectedCell.booking.id}/reassign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ courtId: reassignCourtId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not move booking to selected court.');
        return;
      }
      setDashboard(data.dashboard);
      onFacilitiesUpdated();
      const updatedBooking: Booking | undefined = data.booking;
      if (updatedBooking) {
        setSelectedCell({
          ...selectedCell,
          courtId: updatedBooking.courtId,
          courtName: updatedBooking.courtName,
          booking: updatedBooking,
        });
        setActionNotice(
          `Moved ${updatedBooking.id} to ${updatedBooking.courtName} and synced all devices.`
        );
      } else {
        setSelectedCell(null);
      }
    } catch {
      setActionError('Network error reassigning venue.');
    } finally {
      setReassigning(false);
    }
  };

  const handleToggleSlotBlock = async (
    action: 'block' | 'unblock',
    sportId: string,
    courtId: string,
    slotId: string
  ) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch('/api/admin/slots/block', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          date: matrixDate,
          sportId,
          courtId,
          slotId,
          reason: blockReason,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not update slot block.');
        return;
      }
      setDashboard(data.dashboard);
      setSelectedCell(null);
      setActionNotice(
        action === 'block'
          ? `Slot blocked on ${matrixDate}.`
          : `Slot reopened for booking on ${matrixDate}.`
      );
    } catch {
      setActionError('Network error updating slot status.');
    }
  };

  const handleBulkSlotAction = async (
    action: 'block' | 'unblock',
    overrideCourtId?: string,
    overrideSlotIds?: string[]
  ) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch('/api/admin/slots/block-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          date: matrixDate,
          sportId: bulkSportId,
          courtId: overrideCourtId !== undefined ? overrideCourtId : bulkCourtId,
          slotIds: overrideSlotIds || timeSlots.map((t) => t.id),
          reason: bulkReason,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Bulk action failed.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(
        action === 'block'
          ? `Blocked target slots on ${matrixDate}.`
          : `Cleared admin blocks on ${matrixDate}.`
      );
    } catch {
      setActionError('Network error running bulk slot action.');
    }
  };

  const handleBlockAdvanceDates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionError(null);
    const dates = enumerateDatesBetween(advStartDate, advEndDate);
    if (dates.length === 0) {
      setActionError('Select a valid advance date range.');
      return;
    }
    const targetSlots = advSlotIds.length > 0 ? advSlotIds : timeSlots.map((t) => t.id);
    const advSport = dashboard?.sports.find((s) => s.id === advSportId) || dashboard?.sports[0];
    const targetCourts =
      advCourtIds.length > 0 ? advCourtIds : (advSport?.courts.map((c) => c.id) ?? []);

    if (!advSport || targetCourts.length === 0) {
      setActionError('Select a sport and at least one court.');
      return;
    }

    setSubmittingAdvanceBlock(true);
    try {
      const res = await fetch('/api/admin/slots/block-advance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          dates,
          sportId: advSport.id,
          courtIds: targetCourts,
          slotIds: targetSlots,
          reason: advReason.trim() || 'Official Team Training Camp',
          cancelConflicts: advCancelConflicts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not apply advance training block.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(
        `Advance block saved across ${dates.length} day(s): ${data.blockedCount} slot(s) marked Training Blocked and ${data.cancelledCount} conflicting booking(s) cancelled.`
      );
    } catch {
      setActionError('Network error saving advance training block.');
    } finally {
      setSubmittingAdvanceBlock(false);
    }
  };

  const handleAddSport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !newSportName.trim()) return;
    setActionError(null);
    setAddingSport(true);
    try {
      const res = await fetch('/api/admin/sports/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          name: newSportName.trim(),
          category: newSportCategory,
          minPlayers: Number(newSportMinPlayers || 2),
          maxPlayers: Number(newSportMaxPlayers || 6),
          lateNightFee: Number(newSportFee || 300),
          location: newSportLocation.trim() || 'Main Sports Complex',
          equipmentRequired:
            newSportEquipment.trim() || 'Valid College ID card and sport-appropriate gear.',
          initialCourtsCount: Number(newSportCourtCount || 2),
          defaultSurface: newSportSurface.trim() || 'Standard Arena Surface',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not add new sport.');
        return;
      }
      setDashboard(data.dashboard);
      setNewSportName('');
      onFacilitiesUpdated();
      setActionNotice(`Added new sport "${data.sport.name}" with ${data.sport.courts.length} courts and synced all devices.`);
    } catch {
      setActionError('Network error adding sport.');
    } finally {
      setAddingSport(false);
    }
  };

  const handleAddCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !newCourtName.trim()) return;
    setActionError(null);
    try {
      const res = await fetch('/api/admin/courts/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          sportId: newCourtSportId,
          name: newCourtName.trim(),
          surface: newCourtSurface.trim() || 'Standard Arena Surface',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not add court.');
        return;
      }
      setDashboard(data.dashboard);
      setNewCourtName('');
      setNewCourtSurface('');
      onFacilitiesUpdated();
      setActionNotice('New court/table added and synced to all devices.');
    } catch {
      setActionError('Network error adding court.');
    }
  };

  const handleSaveCourtDetails = async (sportId: string, courtId: string) => {
    if (!adminToken || !editingCourtName.trim()) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/courts/${sportId}/${courtId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          name: editingCourtName.trim(),
          surface: editingCourtSurface.trim() || 'Standard Arena Surface',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to rename court or table.');
        return;
      }
      setDashboard(data.dashboard);
      setEditingCourtKey(null);
      onFacilitiesUpdated();
      setActionNotice(`Renamed venue to "${editingCourtName.trim()}" across all bookings and screens.`);
    } catch {
      setActionError('Network error updating court details.');
    }
  };

  const handleToggleCourtStatus = async (
    sportId: string,
    courtId: string,
    nextStatus: 'operational' | 'maintenance'
  ) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/courts/${sportId}/${courtId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to update court status.');
        return;
      }
      setDashboard(data.dashboard);
      onFacilitiesUpdated();
      setActionNotice(`Venue status updated to ${nextStatus}.`);
    } catch {
      setActionError('Network error updating court.');
    }
  };

  const handleSaveSportConfig = async (sportId: string) => {
    if (!adminToken) return;
    const sport = dashboard?.sports.find((s) => s.id === sportId);
    const edit = sportEdits[sportId];
    if (!sport && !edit) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/sports/${sportId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          lateNightFee: Number(edit?.lateNightFee ?? sport?.lateNightFee ?? 300),
          minPlayers: Number(edit?.minPlayers ?? sport?.minPlayers ?? 2),
          maxPlayers: Number(edit?.maxPlayers ?? sport?.maxPlayers ?? 4),
          equipmentRequired: edit?.equipmentRequired ?? sport?.equipmentRequired,
          location: edit?.location ?? sport?.location,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not update sport settings.');
        return;
      }
      setDashboard(data.dashboard);
      onFacilitiesUpdated();
      setActionNotice(
        `${data.dashboard.sports.find((s: { id: string }) => s.id === sportId)?.name || 'Sport'} pricing, equipment & location synced live.`
      );
    } catch {
      setActionError('Network error updating sport settings.');
    }
  };

  const handleToggleStudentStatus = async (
    rollNo: string,
    nextStatus: 'active' | 'suspended'
  ) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(rollNo)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to update student status.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(`Student ID ${rollNo} marked as ${nextStatus}.`);
    } catch {
      setActionError('Network error updating student status.');
    }
  };

  const handleOpenBanModal = (
    rollNo: string,
    name: string,
    existing?: {
      banScope?: 'none' | 'all' | 'selected';
      bannedSports?: string[] | null;
      banReason?: string | null;
    }
  ) => {
    setActionError(null);
    setBanTarget({ rollNo, name });
    setBanDays(3);
    setBanScope(existing?.banScope === 'selected' ? 'selected' : 'all');
    setBanSportIds(existing?.bannedSports ? [...existing.bannedSports] : []);
    setBanReason(existing?.banReason || '');
  };

  const handleApplyBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !banTarget) return;
    if (banScope === 'selected' && banSportIds.length === 0) {
      setActionError('Select at least one sport to ban, or choose All Sports.');
      return;
    }
    setSavingBan(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(banTarget.rollNo)}/ban`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminToken,
          },
          body: JSON.stringify({
            days: Math.max(1, Math.min(365, Number(banDays) || 1)),
            scope: banScope,
            sportIds: banScope === 'selected' ? banSportIds : [],
            reason: banReason.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not apply temporary sports ban.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(
        `Banned ${banTarget.name} (${banTarget.rollNo}) for ${banDays} day(s) (${
          banScope === 'all' ? 'All Sports' : `${banSportIds.length} sport(s)`
        }).`
      );
      setBanTarget(null);
    } catch {
      setActionError('Network error applying temporary ban.');
    } finally {
      setSavingBan(false);
    }
  };

  const handleUnbanStudent = async (rollNo: string) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(rollNo)}/unban`, {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not remove sports ban.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(`Lifted sports ban for ${rollNo}.`);
    } catch {
      setActionError('Network error removing ban.');
    }
  };

  const handleRemoveStudentFromRoster = async (rollNo: string) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(rollNo)}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': adminToken },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to remove student from roster.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(`Removed ${rollNo} from the official Roster (booking locked for this ID).`);
    } catch {
      setActionError('Network error removing student from roster.');
    }
  };

  const handleRenewStudentSubscription = async (rollNo: string, startDate?: string) => {
    if (!adminToken) return;
    setActionError(null);
    const start = startDate || getTodayDateString();
    const end = addOneYearDate(start);
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(rollNo)}/subscription`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          subscriptionStartDate: start,
          subscriptionEndDate: end,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to renew 1-year subscription.');
        return;
      }
      setDashboard(data.dashboard);
      setActionNotice(`Renewed 1-year SportX subscription for ${rollNo} (${start} → ${end}).`);
    } catch {
      setActionError('Network error renewing subscription.');
    }
  };

  const handleMarkStudentPaid = async (
    rollNo: string,
    account?: RegisteredAccount,
    explicitPayDate?: string
  ) => {
    if (!adminToken) return;
    setActionError(null);
    setPayingRollNo(rollNo);
    const payDate = explicitPayDate || getTodayDateString();
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(rollNo)}/paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          paymentDate: payDate,
          ...(account
            ? {
                idNo: account.idNo || undefined,
                name: account.name,
                email: account.email,
                phone: account.phone,
                department: account.department,
                year: account.year,
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not mark student as paid.');
        return;
      }
      setDashboard(data.dashboard);
      const end = addOneYearDate(payDate);
      setActionNotice(
        `Marked PAID for ${account?.name || rollNo} (${payDate} -> ${end}). Booking pass activated for 1 year.`
      );
    } catch {
      setActionError('Network error recording student payment.');
    } finally {
      setPayingRollNo(null);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionError(null);
    try {
      const payDate = newStudentSubStart || getTodayDateString();
      const res = await fetch('/api/admin/students/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          rollNo: newStudentRoll,
          idNo: newStudentIdNo.trim() || undefined,
          name: newStudentName,
          email: newStudentEmail,
          department: newStudentDept,
          paymentDate: payDate,
          subscriptionStartDate: payDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not add student.');
        return;
      }
      setDashboard(data.dashboard);
      setNewStudentRoll('');
      setNewStudentIdNo('');
      setNewStudentName('');
      setNewStudentEmail('');
      setActionNotice('Student added to Official Roster with 1-year subscription from Day of Payment.');
    } catch {
      setActionError('Network error adding student.');
    }
  };

  const handleFileImport = async (file: File) => {
    setActionError(null);
    setImportFileName(file.name);
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.json')) {
        const text = await file.text();
        const json = JSON.parse(text);
        const arr = Array.isArray(json) ? json : json.students || [];
        const parsed = arr
          .map((item: Record<string, unknown>) => normalizeImportedRow(item))
          .filter(Boolean) as ParsedStudentRow[];
        setParsedImportRows(parsed);
        if (parsed.length === 0) {
          setActionError('No valid rows found in JSON file. Ensure Roll No and Name keys exist.');
        }
        return;
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
      });
      const parsed = rows
        .map((r) => normalizeImportedRow(r))
        .filter(Boolean) as ParsedStudentRow[];
      setParsedImportRows(parsed);
      if (parsed.length === 0) {
        setActionError(
          'Could not detect Roll No & Name columns. Use headers like: Name, Roll No, ID No, Day of Payment.'
        );
      }
    } catch {
      setActionError('Failed to parse document. Supported formats: .xlsx, .xls, .csv, .txt, .json.');
    }
  };

  const handleParsePastedText = () => {
    setActionError(null);
    if (!pasteText.trim()) return;
    try {
      const workbook = XLSX.read(pasteText, { type: 'string', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
      });
      const parsed = rows
        .map((r) => normalizeImportedRow(r))
        .filter(Boolean) as ParsedStudentRow[];
      if (parsed.length > 0) {
        setImportFileName('Pasted Document');
        setParsedImportRows(parsed);
      } else {
        setActionError(
          'Include a header row (e.g. name,rollNo,idNo,dayOfPayment) above pasted lines.'
        );
      }
    } catch {
      setActionError('Could not parse pasted text.');
    }
  };

  const handleConfirmBulkImport = async () => {
    if (!adminToken || parsedImportRows.length === 0) return;
    setImportingBulk(true);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/students/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ records: parsedImportRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Bulk import failed.');
        return;
      }
      setDashboard(data.dashboard);
      setParsedImportRows([]);
      setImportFileName(null);
      setPasteText('');
      setActionNotice(
        `Imported document: ${data.addedCount} added, ${data.updatedCount} updated, ${data.skippedCount} skipped.`
      );
    } catch {
      setActionError('Network error importing student document.');
    } finally {
      setImportingBulk(false);
    }
  };

  const handleAddRuleItem = () => {
    if (!newRuleTitle.trim() || !newRuleDesc.trim()) return;
    setPolicyRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}`,
        title: newRuleTitle.trim(),
        description: newRuleDesc.trim(),
      },
    ]);
    setNewRuleTitle('');
    setNewRuleDesc('');
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch('/api/admin/policy', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          openingHour: policyEveningOpenHour,
          morningBookingOpenHour: policyMorningOpenHour,
          eveningBookingOpenHour: policyEveningOpenHour,
          enforceOpeningHour: policyEnforceHour,
          sameDayOnly: policySameDay,
          weekdayMorningStart: policyWdMStart,
          weekdayMorningEnd: policyWdMEnd,
          weekdayEveningStart: policyWdEStart,
          weekdayEveningEnd: policyWdEEnd,
          weekendMorningStart: policyWeMStart,
          weekendMorningEnd: policyWeMEnd,
          weekendEveningStart: policyWeEStart,
          weekendEveningEnd: policyWeEEnd,
          announcement: policyAnnouncement,
          earlyArrivalMinutes: policyEarlyMins,
          inCourtWindowMinutes: policyInCourtMins,
          facilityRules: policyRules,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to save booking policy.');
        return;
      }
      setDashboard(data.dashboard);
      syncPolicyStateFromData(data.dashboard.policy);
      onFacilitiesUpdated();
      setActionNotice(
        'Weekday/Weekend schedules, dual unlock times (AM/PM), and campus rules synced live across all devices.'
      );
    } catch {
      setActionError('Network error saving policy.');
    }
  };

  const handleSaveAccessCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionError(null);
    const codes = [
      codeAdminPass.trim(),
      codeSecurityPin.trim(),
      codeWalkInPass.trim(),
      codeWalkInCancel.trim(),
      codeTrainingOverride.trim(),
    ];
    if (codes.some((c) => c.length < 4)) {
      setActionError('Every access code / password must be at least 4 characters long.');
      return;
    }
    setSavingCodes(true);
    try {
      const res = await fetch('/api/admin/policy', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          adminPasscode: codeAdminPass.trim(),
          securityPasscode: codeSecurityPin.trim(),
          walkInPasscode: codeWalkInPass.trim(),
          walkInCancelCode: codeWalkInCancel.trim(),
          trainingOverrideCode: codeTrainingOverride.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to update access codes.');
        return;
      }
      setDashboard(data.dashboard);
      syncPolicyStateFromData(data.dashboard.policy);
      setActionNotice(
        'All Admin, Security Gate, Walk-In Desk, Walk-In Cancel, and Training Hours codes updated and synced live.'
      );
    } catch {
      setActionError('Network error updating access codes.');
    } finally {
      setSavingCodes(false);
    }
  };

  const handleConnectSmtpGmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setActionError(null);
    setActionNotice(null);
    setSmtpSaving(true);
    try {
      const res = await fetch('/api/admin/gmail/smtp-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          email: smtpEmailInput.trim(),
          appPassword: smtpAppPasswordInput.trim(),
          autoSend: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not verify Gmail SMTP credentials.');
        return;
      }
      setDashboard(data.dashboard);
      setSmtpAppPasswordInput('');
      setActionNotice(
        `Gmail verified (${data.dashboard.policy.gmailSenderEmail}). 6-digit verification emails will now send automatically whenever students sign up.`
      );
    } catch {
      setActionError('Network error verifying Gmail credentials.');
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleDisconnectSmtpGmail = async () => {
    if (!adminToken) return;
    setActionError(null);
    setSmtpSaving(true);
    try {
      const res = await fetch('/api/admin/gmail/smtp-disconnect', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to disconnect Gmail.');
        return;
      }
      setDashboard(data.dashboard);
      setSmtpAppPasswordInput('');
      setActionNotice('Disconnected server Gmail auto-send account.');
    } catch {
      setActionError('Network error disconnecting Gmail.');
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleToggleSmtpAutoSend = async (nextVal: boolean) => {
    if (!adminToken) return;
    setActionError(null);
    try {
      const res = await fetch('/api/admin/gmail/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ gmailAutoSend: nextVal }),
      });
      const data = await res.json();
      if (res.ok && data.dashboard) {
        setDashboard(data.dashboard);
        setActionNotice(
          nextVal
            ? 'Automatic 6-digit Gmail OTP dispatch enabled for all new sign-ups.'
            : 'Automatic Gmail OTP dispatch paused.'
        );
      } else {
        setActionError(data.error || 'Could not update Gmail auto-send toggle.');
      }
    } catch {
      setActionError('Network error updating Gmail auto-send.');
    }
  };

  const handleConnectGmailSignIn = async () => {
    setActionError(null);
    setGmailConnecting(true);
    try {
      const res = await connectAdminGmail();
      setGmailPendingConfirmEmail(res.email);
      onGmailStateChange(res.email, false);
      setConfirmAutoEnableModalOpen(true);
    } catch (error) {
      const err = error as Error;
      setActionError(
        err.message ||
          'Google OAuth sign-in was blocked (Testing mode restricts unapproved Gmail accounts with Error 403). Use the Instant Gmail App Password setup above for any Gmail account.'
      );
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleConfirmEnableGmailAutoSend = async () => {
    if (!adminToken) return;
    const senderEmail = gmailPendingConfirmEmail || gmailConnectedEmail || '';
    const accessToken = getGmailAccessToken();
    if (!accessToken || !senderEmail) {
      setActionError('Google session expired. Click Sign in with Google again.');
      setConfirmAutoEnableModalOpen(false);
      return;
    }
    setActionError(null);
    try {
      const res = await fetch('/api/admin/gmail/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          gmailSenderEmail: senderEmail,
          gmailAutoSend: true,
          gmailConnectionMode: 'oauth',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not save Gmail verification configuration.');
        return;
      }
      setDashboard(data.dashboard);
      onGmailStateChange(senderEmail, true);
      setConfirmAutoEnableModalOpen(false);
      setGmailPendingConfirmEmail(null);
      setActionNotice(
        `Gmail connected (${senderEmail}). New .edu.in student sign-ups will automatically receive a 6-digit verification code.`
      );

      // Dispatch any pending OTPs queued before Gmail was connected
      const pendingList: SignupOtpSummary[] = (data.dashboard?.signupOtps || []).filter(
        (o: SignupOtpSummary) => o.status === 'pending'
      );
      for (const otp of pendingList) {
        await fetch('/api/admin/gmail/send-otp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminToken,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            otpId: otp.id,
            senderEmail,
          }),
        }).catch(() => {});
      }
      if (pendingList.length > 0) {
        fetchDashboard(adminToken);
      }
    } catch {
      setActionError('Network error saving Gmail configuration.');
    }
  };

  const handleCancelGmailAutoEnable = async () => {
    setConfirmAutoEnableModalOpen(false);
    setGmailPendingConfirmEmail(null);
    onGmailStateChange(null, false);
    await disconnectAdminGmail().catch(() => {});
  };

  const handleToggleGmailAutoSend = async (nextVal: boolean) => {
    if (!adminToken) return;
    if (nextVal) {
      if (!getGmailAccessToken() || !gmailConnectedEmail) {
        await handleConnectGmailSignIn();
        return;
      }
      setGmailPendingConfirmEmail(gmailConnectedEmail);
      setConfirmAutoEnableModalOpen(true);
      return;
    }
    try {
      const res = await fetch('/api/admin/gmail/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ gmailAutoSend: false }),
      });
      const data = await res.json();
      if (res.ok && data.dashboard) {
        setDashboard(data.dashboard);
      }
      onGmailStateChange(gmailConnectedEmail, false);
      setActionNotice('Automatic Gmail dispatch paused.');
    } catch {
      setActionError('Failed to pause automatic Gmail dispatch.');
    }
  };

  const handleDisconnectGmail = async () => {
    setActionError(null);
    await disconnectAdminGmail().catch(() => {});
    onGmailStateChange(null, false);
    if (adminToken) {
      await fetch('/api/admin/gmail/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ gmailSenderEmail: '', gmailAutoSend: false }),
      })
        .then(async (r) => {
          if (r.ok) {
            const d = await r.json();
            if (d.dashboard) setDashboard(d.dashboard);
          }
        })
        .catch(() => {});
    }
    setActionNotice('Disconnected Google OAuth session from this Admin browser.');
  };

  const handleDirectSmtpResend = async (otp: SignupOtpSummary) => {
    if (!adminToken) return;
    setSendingOtpId(otp.id);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/gmail/send-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          otpId: otp.id,
          explicitResend: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Could not resend 6-digit code via Gmail.');
        if (data.dashboard) setDashboard(data.dashboard);
        return;
      }
      if (data.dashboard) setDashboard(data.dashboard);
      setActionNotice(
        `Sent 6-digit verification code to ${otp.email} via ${data.sentFromEmail || 'Connected Gmail'}.`
      );
    } catch {
      setActionError('Network error sending verification code via Gmail.');
    } finally {
      setSendingOtpId(null);
    }
  };

  const handleConfirmManualOtpSend = async () => {
    if (!adminToken || !confirmManualOtpSend) return;
    const accessToken = getGmailAccessToken();
    if (!accessToken || !gmailConnectedEmail) {
      setConfirmManualOtpSend(null);
      setActionError('Connect Gmail with App Password above or Sign in with Google first.');
      return;
    }
    const target = confirmManualOtpSend;
    setSendingOtpId(target.id);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/gmail/send-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          otpId: target.id,
          senderEmail: gmailConnectedEmail,
          explicitResend: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && data.reconnectRequired) {
          clearGmailAccessToken();
          onGmailStateChange(null, false);
        }
        setActionError(data.error || 'Could not send verification email via Gmail.');
        return;
      }
      if (data.dashboard) setDashboard(data.dashboard);
      setConfirmManualOtpSend(null);
      setActionNotice(`Sent 6-digit verification code to ${target.email} via ${gmailConnectedEmail}.`);
    } catch {
      setActionError('Network error sending verification code via Gmail.');
    } finally {
      setSendingOtpId(null);
    }
  };

  const filteredBookings = useMemo(() => {
    if (!dashboard) return [];
    const q = bookingSearch.trim().toLowerCase();
    return dashboard.bookings.filter((b) => {
      if (bookingStatusFilter !== 'all' && b.status !== bookingStatusFilter) return false;
      if (bookingTierFilter === 'free' && b.isLateNight) return false;
      if (bookingTierFilter === 'paid' && !b.isLateNight) return false;
      if (!q) return true;
      return (
        String(b.bookingCode || '').includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.bookedByName.toLowerCase().includes(q) ||
        b.bookedByRollNo.toLowerCase().includes(q) ||
        b.sportName.toLowerCase().includes(q) ||
        b.courtName.toLowerCase().includes(q) ||
        b.players.some(
          (p) =>
            p.rollNo.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        )
      );
    });
  }, [dashboard, bookingSearch, bookingStatusFilter, bookingTierFilter]);

  const filteredStudents = useMemo(() => {
    if (!dashboard) return [];
    const q = studentSearch.trim().toLowerCase();
    if (!q) return dashboard.students;
    return dashboard.students.filter(
      (s) =>
        s.rollNo.toLowerCase().includes(q) ||
        (s.idNo && s.idNo.toLowerCase().includes(q)) ||
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
    );
  }, [dashboard, studentSearch]);

  const orderedMatrixSlots = useMemo(() => {
    if (matrixOrder === 'live') {
      return getLiveCenteredSlots(timeSlots, currentHour);
    }
    return timeSlots;
  }, [matrixOrder, timeSlots, currentHour]);

  const currentHourSlotId = `${String(currentHour).padStart(2, '0')}:00`;

  const matrixDaySchedule = useMemo(() => {
    if (!dashboard) return null;
    return getDayScheduleWindows(matrixDate, dashboard.policy);
  }, [dashboard, matrixDate]);

  // Fast matrix telemetry using dynamic schedule maintenance check
  const matrixSummary = useMemo(() => {
    if (!dashboard) return { free: 0, booked: 0, blocked: 0, maint: 0, inCourt: 0, admitted: 0 };
    const sportsSubset = dashboard.sports.filter(
      (s) => matrixSportFilter === 'all' || s.id === matrixSportFilter
    );
    let free = 0;
    let booked = 0;
    let blocked = 0;
    let maint = 0;
    let inCourt = 0;
    let admitted = 0;

    for (const sp of sportsSubset) {
      for (const ct of sp.courts) {
        for (const sl of timeSlots) {
          const slotOp = getSlotOperationalState(sl, matrixDate, dashboard.policy);
          if (ct.status === 'maintenance' || slotOp.isMaintenance) {
            maint += 1;
            continue;
          }
          const bk = dashboard.bookings.find(
            (b) =>
              b.status === 'confirmed' &&
              b.date === matrixDate &&
              b.sportId === sp.id &&
              b.courtId === ct.id &&
              b.slotId === sl.id
          );
          if (bk) {
            booked += 1;
            if (bk.inCourtAt) inCourt += 1;
            if (bk.securityStatus === 'admitted') admitted += 1;
          } else if (
            dashboard.blockedSlots.some(
              (bl) =>
                bl.date === matrixDate &&
                bl.sportId === sp.id &&
                bl.courtId === ct.id &&
                bl.slotId === sl.id
            )
          ) {
            blocked += 1;
          } else {
            free += 1;
          }
        }
      }
    }
    return { free, booked, blocked, maint, inCourt, admitted };
  }, [dashboard, matrixDate, matrixSportFilter, timeSlots]);

  // Alternative available courts for inline venue reassignment in matrix inspector
  const reassignOptions = useMemo(() => {
    if (!dashboard || !selectedCell?.booking) return [];
    const sportObj = dashboard.sports.find((s) => s.id === selectedCell.sportId);
    if (!sportObj) return [];
    return sportObj.courts.filter((c) => {
      if (c.id === selectedCell.courtId || c.status === 'maintenance') return false;
      const conflictBooking = dashboard.bookings.some(
        (b) =>
          b.status === 'confirmed' &&
          b.date === matrixDate &&
          b.sportId === selectedCell.sportId &&
          b.courtId === c.id &&
          b.slotId === selectedCell.slot.id
      );
      const conflictBlock = dashboard.blockedSlots.some(
        (blk) =>
          blk.date === matrixDate &&
          blk.sportId === selectedCell.sportId &&
          blk.courtId === c.id &&
          blk.slotId === selectedCell.slot.id
      );
      return !conflictBooking && !conflictBlock;
    });
  }, [dashboard, selectedCell, matrixDate]);

  useEffect(() => {
    if (reassignOptions.length > 0) {
      setReassignCourtId(reassignOptions[0].id);
    } else {
      setReassignCourtId('');
    }
  }, [selectedCell?.booking?.id, reassignOptions]);

  // Admin Password Gate (Passcode never shown or hinted anywhere in UI)
  if (!adminToken) {
    return (
      <div className="min-h-screen bg-[#F7F6FB] flex flex-col">
        <header className="bg-white border-b border-[#E6E2F8] px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SportXLogo size="md" />
            <span className="text-xs font-semibold text-[#7D2AE8] border-l border-[#DFDAFA] pl-2.5">
              Studio Admin
            </span>
          </div>
          <button
            type="button"
            onClick={onExitAdmin}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-[#DFDAFA] hover:border-[#7D2AE8] rounded-xl transition-colors cursor-pointer"
          >
            Student Portal
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
          <div className="w-full max-w-md bg-white border border-[#E6E2F8] rounded-3xl p-7 sm:p-8 shadow-sm space-y-6">
            <div className="space-y-2.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7D2AE8] to-[#00C4CC] flex items-center justify-center text-white">
                <Lock className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 font-display">
                Operations Console Access
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed">
                Authenticate with the administrator passcode to manage schedules, courts, slot matrix, access codes, login accounts, and 1-year student rosters.
              </p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="admin-passcode"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Administrator Passcode
                </label>
                <input
                  id="admin-passcode"
                  type="password"
                  required
                  autoFocus
                  autoComplete="off"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter passcode"
                  className="w-full min-h-[46px] px-3.5 py-2.5 text-sm font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7D2AE8]/20 focus:border-[#7D2AE8]"
                />
              </div>

              {authError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full min-h-[48px] py-2.5 px-4 text-sm font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity cursor-pointer"
              >
                {loggingIn ? 'Verifying...' : 'Unlock Studio Console'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const maxHourlyBookings = Math.max(
    1,
    ...(dashboard?.hourlyDemand.map((h) => h.bookings) || [1])
  );

  const navItems: {
    id: AdminTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'overview', label: 'Command Overview', icon: BarChart3 },
    { id: 'matrix', label: 'Court & Slot Matrix', icon: Grid3X3 },
    { id: 'bookings', label: 'Bookings Ledger', icon: CalendarDays },
    { id: 'facilities', label: 'Courts & Pricing', icon: Wrench },
    { id: 'students', label: 'Official Roster & Docs', icon: Users },
    { id: 'subscriptions', label: 'Subscriptions, No-Shows & Accounts', icon: ShieldCheck },
    { id: 'gmail', label: 'Gmail Verification', icon: Mail },
    { id: 'policy', label: 'Schedules, Rules & Codes', icon: Sliders },
  ];

  const bulkSportObj =
    dashboard?.sports.find((s) => s.id === bulkSportId) || dashboard?.sports[0];

  const upiSharePercent =
    dashboard && dashboard.metrics.totalRevenue > 0
      ? Math.round((dashboard.metrics.upiRevenue / dashboard.metrics.totalRevenue) * 100)
      : 0;

  const weekdayPreview = getDayScheduleWindows('2026-11-09', {
    weekdayMorningStart: policyWdMStart,
    weekdayMorningEnd: policyWdMEnd,
    weekdayEveningStart: policyWdEStart,
    weekdayEveningEnd: policyWdEEnd,
    morningBookingOpenHour: policyMorningOpenHour,
    eveningBookingOpenHour: policyEveningOpenHour,
  });
  const weekendPreview = getDayScheduleWindows('2026-11-14', {
    weekendMorningStart: policyWeMStart,
    weekendMorningEnd: policyWeMEnd,
    weekendEveningStart: policyWeEStart,
    weekendEveningEnd: policyWeEEnd,
    morningBookingOpenHour: policyMorningOpenHour,
    eveningBookingOpenHour: policyEveningOpenHour,
  });

  return (
    <div className="min-h-screen bg-[#F7F6FB] text-slate-900 flex flex-col lg:flex-row">
      {/* Mobile Slide-Over Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[82vw] bg-white border-r border-[#E6E2F8] p-5 flex flex-col justify-between z-10 overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <SportXLogo size="sm" />
                  <div className="text-[11px] font-medium text-[#7D2AE8] mt-0.5">Studio Admin</div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                        active
                          ? 'bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-[#F3F0FC] hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="space-y-2 border-t border-[#EFEBF9] pt-4 mt-4">
              {onOpenSecurity && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    onOpenSecurity();
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2 text-xs font-semibold text-[#007B83] bg-[#EBF9FA] border border-[#BCECF0] rounded-xl text-left cursor-pointer"
                >
                  Security Gate Console
                </button>
              )}
              <button
                type="button"
                onClick={onExitAdmin}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-semibold text-slate-700 bg-[#F3F0FC] rounded-xl text-left cursor-pointer"
              >
                Student Portal
              </button>
              <button
                type="button"
                onClick={handleAdminLogout}
                className="w-full min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Lock Console
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-[#E6E2F8] flex-col justify-between shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="p-5 space-y-6">
          <div className="border-b border-[#EFEBF9] pb-4">
            <SportXLogo size="md" />
            <div className="text-[11px] font-semibold text-[#7D2AE8] mt-1">
              Admin Command Studio
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-[#F3F0FC] hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-5 border-t border-[#EFEBF9] space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span className="inline-flex items-center gap-1.5">
              <Radio
                className={`w-3.5 h-3.5 ${
                  syncConnected ? 'text-emerald-600' : 'text-amber-500'
                }`}
              />
              {syncConnected ? 'Sync Live' : 'Offline'}
            </span>
            <span className="tabular-nums">
              {dashboard?.metrics.connectedClientsCount ?? 1} devices
            </span>
          </div>
          {onOpenSecurity && (
            <button
              type="button"
              onClick={onOpenSecurity}
              className="w-full inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#007B83] bg-[#EBF9FA] hover:bg-[#DCF4F6] border border-[#BCECF0] rounded-xl transition-colors text-left cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" />
              Security Gate Console
            </button>
          )}
          <button
            type="button"
            onClick={onExitAdmin}
            className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-[#F3F0FC] hover:bg-[#EAE4FA] rounded-xl transition-colors text-left cursor-pointer"
          >
            Switch to Student View
          </button>
          <button
            type="button"
            onClick={handleAdminLogout}
            className="w-full inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Lock &amp; Sign Out
          </button>
        </div>
      </aside>

      {/* Main Studio Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white/95 backdrop-blur-md border-b border-[#E6E2F8] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-[#F3F0FC] text-slate-700 cursor-pointer"
              aria-label="Open admin menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
              <span className="hidden sm:inline font-medium">Studio Console</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-bold text-slate-900 truncate">
                {navItems.find((n) => n.id === activeTab)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-[#007B83] font-medium">
              <Radio className="w-3.5 h-3.5" />
              {dashboard?.metrics.connectedClientsCount ?? 1} live screens
            </span>
            <button
              type="button"
              onClick={() => adminToken && fetchDashboard(adminToken)}
              className="min-h-[38px] inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] border border-[#DFDAFA] rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 space-y-6 overflow-y-auto">
          {actionError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between gap-3">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {actionNotice && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between gap-3">
              <span>{actionNotice}</span>
              <button type="button" onClick={() => setActionNotice(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!dashboard ? (
            <div className="bg-white border border-[#E6E2F8] rounded-2xl p-10 text-center text-sm text-slate-500">
              Loading telemetry &amp; studio state...
            </div>
          ) : (
            <>
              {/* ==================== TAB 1: COMMAND OVERVIEW ==================== */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* 4 Core KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500">Late-Night Revenue</p>
                      <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">
                        ₹{dashboard.metrics.totalRevenue.toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs text-[#7D2AE8] font-mono tabular-nums font-medium">
                        UPI ₹{dashboard.metrics.upiRevenue} · Card ₹{dashboard.metrics.cardRevenue}
                      </p>
                    </div>

                    <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500">Confirmed Sessions</p>
                      <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">
                        {dashboard.metrics.totalConfirmedBookings}
                      </p>
                      <p className="text-xs font-mono tabular-nums font-medium text-amber-600">
                        {dashboard.metrics.lateNightPaidBookings} Paid ·{' '}
                        <span className="text-emerald-600">
                          {dashboard.metrics.standardFreeBookings} Free
                        </span>
                      </p>
                    </div>

                    <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500">
                        Court Capacity ({dashboard.sports.length} Sports)
                      </p>
                      <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">
                        {dashboard.metrics.operationalCourtsCount}/{dashboard.metrics.totalCourtsCount}
                      </p>
                      <p className="text-xs text-[#008C93] font-mono tabular-nums font-medium">
                        {dashboard.metrics.occupancyRatePercent}% Daily Occupancy
                      </p>
                    </div>

                    <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500">Live Arrival &amp; Gate Desk</p>
                      <p className="text-2xl sm:text-3xl font-bold text-[#7D2AE8] font-mono tabular-nums">
                        {dashboard.metrics.inCourtCount} / {dashboard.metrics.securityAdmittedCount}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        In-Court Taps · Gate Admitted
                      </p>
                    </div>
                  </div>

                  {/* Quick Studio Actions Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <button
                      type="button"
                      onClick={() => setActiveTab('matrix')}
                      className="bg-white hover:bg-[#FAF8FE] border border-[#E6E2F8] hover:border-[#7D2AE8] rounded-2xl p-4 text-left transition-all flex items-center justify-between gap-3 cursor-pointer shadow-xs"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">Inspect Court Matrix</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Live-centered 12-hr grid across {dashboard.metrics.totalCourtsCount} courts
                        </p>
                      </div>
                      <Grid3X3 className="w-5 h-5 text-[#7D2AE8] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('students')}
                      className="bg-white hover:bg-[#FAF8FE] border border-[#E6E2F8] hover:border-[#00C4CC] rounded-2xl p-4 text-left transition-all flex items-center justify-between gap-3 cursor-pointer shadow-xs"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">Roster &amp; Doc Import</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {dashboard.metrics.activeStudentsCount} active · {dashboard.metrics.expiredStudentsCount} expired
                        </p>
                      </div>
                      <Users className="w-5 h-5 text-[#00A8B5] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubPageTab('accounts');
                        setActiveTab('subscriptions');
                      }}
                      className="bg-white hover:bg-[#FAF8FE] border border-[#E6E2F8] hover:border-[#7D2AE8] rounded-2xl p-4 text-left transition-all flex items-center justify-between gap-3 cursor-pointer shadow-xs"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">Student Login Accounts</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {dashboard.loginAccounts.length} registered accounts
                        </p>
                      </div>
                      <UserCheck className="w-5 h-5 text-[#FF5C5C] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('gmail')}
                      className="bg-white hover:bg-[#FAF8FE] border border-[#E6E2F8] hover:border-[#7D2AE8] rounded-2xl p-4 text-left transition-all flex items-center justify-between gap-3 cursor-pointer shadow-xs"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">Gmail OTP Verification</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[200px]">
                          {dashboard.policy.gmailHasAppPassword && dashboard.policy.gmailSenderEmail
                            ? `Auto-Send Active: ${dashboard.policy.gmailSenderEmail}`
                            : gmailConnectedEmail && getGmailAccessToken()
                              ? `Connected: ${gmailConnectedEmail}`
                              : 'Connect Gmail to auto-send 6-digit signup codes'}
                        </p>
                      </div>
                      <Mail className="w-5 h-5 text-emerald-600 shrink-0" />
                    </button>
                  </div>

                  {/* SVG Hourly Chart + Live Operations Feed */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    <div className="xl:col-span-7 bg-white border border-[#E6E2F8] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="text-sm font-bold text-slate-900">
                            12-Hour Court Demand Curve (5:00 AM – 4:00 AM)
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Teal/Violet = Standard Free · Coral/Amber = Late-Night Paid (11:00 PM – 4:00 AM)
                          </p>
                        </div>
                        <Activity className="w-4 h-4 text-[#7D2AE8]" />
                      </div>

                      <div className="w-full overflow-x-auto">
                        <svg
                          viewBox="0 0 860 215"
                          className="w-full min-w-[660px] h-52"
                          role="img"
                          aria-label="12-hour bookings distribution chart"
                        >
                          <line
                            x1="20"
                            y1="170"
                            x2="840"
                            y2="170"
                            stroke="#E6E2F8"
                            strokeWidth="1.5"
                          />
                          {dashboard.hourlyDemand.map((h, i) => {
                            const barWidth = 22;
                            const gap = 12;
                            const x = 24 + i * (barWidth + gap);
                            const barHeight = Math.round(
                              (h.bookings / maxHourlyBookings) * 130
                            );
                            const y = 170 - barHeight;
                            const fill = h.isLateNight ? '#F59E0B' : '#00C4CC';

                            return (
                              <g key={h.slotId}>
                                <rect
                                  x={x}
                                  y={Math.min(166, y)}
                                  width={barWidth}
                                  height={Math.max(4, barHeight)}
                                  rx="6"
                                  fill={h.bookings > 0 ? fill : '#EDE9FA'}
                                />
                                {h.bookings > 0 && (
                                  <text
                                    x={x + barWidth / 2}
                                    y={y - 6}
                                    textAnchor="middle"
                                    fill="#1E1B4B"
                                    fontSize="10"
                                    fontWeight="700"
                                    fontFamily="JetBrains Mono, monospace"
                                  >
                                    {h.bookings}
                                  </text>
                                )}
                                <text
                                  x={x + barWidth / 2}
                                  y="188"
                                  textAnchor="middle"
                                  fill={h.isLateNight ? '#B45309' : '#64748B'}
                                  fontSize="8.5"
                                  fontFamily="JetBrains Mono, monospace"
                                >
                                  {h.shortLabel.replace(' AM', 'A').replace(' PM', 'P')}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>

                      <div className="pt-3 border-t border-[#EFEBF9] space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Payment Channel Mix</span>
                          <span className="font-mono text-slate-900 font-semibold tabular-nums">
                            UPI {upiSharePercent}% · Card {100 - upiSharePercent}%
                          </span>
                        </div>
                        <div className="h-2.5 bg-[#F2EFFA] rounded-full overflow-hidden flex">
                          <div
                            className="bg-[#00C4CC] h-full"
                            style={{ width: `${upiSharePercent}%` }}
                          />
                          <div
                            className="bg-[#7D2AE8] h-full"
                            style={{ width: `${100 - upiSharePercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="xl:col-span-5 bg-white border border-[#E6E2F8] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-slate-900">Live Operations Feed</h2>
                        <span className="text-[11px] font-mono font-semibold text-[#008C93]">
                          Real-time stream
                        </span>
                      </div>

                      <div className="divide-y divide-[#F4F1FC] max-h-72 overflow-y-auto pr-1">
                        {dashboard.activityLog.slice(0, 14).map((act) => (
                          <div key={act.id} className="py-2.5 space-y-0.5">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-slate-900">{act.summary}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                              <span>{act.actor}</span>
                              <span>
                                {new Date(act.timestamp).toLocaleTimeString([], {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Sport Performance Table */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#EFEBF9] flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">
                        Sport Revenue &amp; Venue Capacity (All {dashboard.sports.length} Sports)
                      </h2>
                      <span className="text-xs text-slate-500">Live breakdown</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#FAF8FE] border-b border-[#EFEBF9] text-xs font-semibold text-slate-500">
                            <th className="py-3 px-5">Sport</th>
                            <th className="py-3 px-4 text-right">Active Venues</th>
                            <th className="py-3 px-4 text-right">Confirmed</th>
                            <th className="py-3 px-4 text-right">Late-Night Paid</th>
                            <th className="py-3 px-5 text-right">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F4F1FC] text-xs">
                          {dashboard.revenueBySport.map((row) => (
                            <tr key={row.sportId} className="hover:bg-[#FAF8FE]">
                              <td className="py-3 px-5 font-semibold text-slate-900 whitespace-nowrap">
                                {row.sportName}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                                {row.operationalCourts}/{row.totalCourts}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                                {row.bookings}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-600 font-semibold">
                                {row.lateNightCount}
                              </td>
                              <td className="py-3 px-5 text-right font-mono tabular-nums font-bold text-emerald-700">
                                ₹{row.revenue.toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== TAB 2: STICKY LIVE-CENTERED MATRIX ==================== */}
              {activeTab === 'matrix' && (
                <div className="space-y-5">
                  {/* Top Control Header */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Interactive Court &amp; Slot Matrix (12-Hr AM/PM)
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Time headers remain fixed on top while courts scroll below. Current live hour is anchored at Column #3 from the left.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="inline-flex rounded-xl border border-[#DFDAFA] bg-[#FAF8FE] p-0.5">
                          <button
                            type="button"
                            onClick={() => setMatrixOrder('live')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                              matrixOrder === 'live'
                                ? 'bg-[#7D2AE8] text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Live Hour @ #3
                          </button>
                          <button
                            type="button"
                            onClick={() => setMatrixOrder('chrono')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                              matrixOrder === 'chrono'
                                ? 'bg-[#7D2AE8] text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            5 AM → 4 AM
                          </button>
                        </div>

                        <input
                          type="date"
                          value={matrixDate}
                          onChange={(e) => {
                            setMatrixDate(e.target.value);
                            setSelectedCell(null);
                          }}
                          className="min-h-[40px] px-3 py-1.5 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setMatrixDate(getTodayDateString());
                            setSelectedCell(null);
                          }}
                          className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-[#007B83] bg-[#EBF9FA] border border-[#BCECF0] hover:border-[#00C4CC] rounded-xl cursor-pointer"
                        >
                          Today
                        </button>
                      </div>
                    </div>

                    {/* Day Schedule Summary Strip */}
                    {matrixDaySchedule && (
                      <div className="p-3 bg-[#FAF8FE] border border-[#EFEBF9] rounded-xl flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-600">
                        <span className="font-bold text-[#7D2AE8]">
                          {matrixDaySchedule.isWeekend ? 'Weekend Schedule' : 'Weekday Schedule'}
                        </span>
                        <span>Morning: {matrixDaySchedule.morningRangeLabel}</span>
                        <span>Maintenance: {matrixDaySchedule.maintenanceRangeLabel}</span>
                        <span>Evening: {matrixDaySchedule.eveningRangeLabel}</span>
                        <span>
                          Unlocks: {matrixDaySchedule.morningUnlockLabel} (AM) · {matrixDaySchedule.eveningUnlockLabel} (PM)
                        </span>
                      </div>
                    )}

                    {/* Sport Filter Bar */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setMatrixSportFilter('all')}
                        className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          matrixSportFilter === 'all'
                            ? 'bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] text-white'
                            : 'bg-[#FAF8FE] text-slate-600 border border-[#DFDAFA] hover:border-[#7D2AE8]'
                        }`}
                      >
                        All Sports ({dashboard.metrics.totalCourtsCount})
                      </button>
                      {dashboard.sports.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setMatrixSportFilter(s.id)}
                          className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                            matrixSportFilter === s.id
                              ? 'bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] text-white'
                              : 'bg-[#FAF8FE] text-slate-600 border border-[#DFDAFA] hover:border-[#7D2AE8]'
                          }`}
                        >
                          {s.name} ({s.courts.length})
                        </button>
                      ))}
                    </div>

                    {/* Matrix Live Counters + Legend */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#EFEBF9] pt-3.5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-4 text-slate-600 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-100 border border-emerald-400" />
                          Open ({matrixSummary.free})
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-[#7D2AE8]" />
                          Booked ({matrixSummary.booked})
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
                          Late-Night Paid
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                          Gate Admitted ({matrixSummary.admitted})
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#00C4CC]" />
                          In-Court ({matrixSummary.inCourt})
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-rose-100 border border-rose-400" />
                          Blocked ({matrixSummary.blocked})
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-slate-200" />
                          Maint ({matrixSummary.maint})
                        </span>
                      </div>

                      <div className="text-[#007B83] font-mono font-semibold">
                        Live Hour: {formatHourMinute12(currentHour, 0)}
                      </div>
                    </div>
                  </div>

                  {/* Bulk Court Control Bar */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-4 shadow-xs flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Sport
                      </label>
                      <select
                        value={bulkSportId}
                        onChange={(e) => {
                          const sp = dashboard.sports.find((x) => x.id === e.target.value);
                          setBulkSportId(e.target.value);
                          setBulkCourtId(sp?.courts[0]?.id || '');
                        }}
                        className="min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        {dashboard.sports.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Court / Table
                      </label>
                      <select
                        value={bulkCourtId}
                        onChange={(e) => setBulkCourtId(e.target.value)}
                        className="min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        <option value="">All Venues of {bulkSportObj?.name}</option>
                        {bulkSportObj?.courts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-44">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Bulk Block Reason
                      </label>
                      <input
                        type="text"
                        value={bulkReason}
                        onChange={(e) => setBulkReason(e.target.value)}
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleBulkSlotAction('block')}
                      className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-white bg-[#FF5C5C] hover:bg-rose-600 rounded-xl cursor-pointer"
                    >
                      Block Whole Day
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkSlotAction('unblock')}
                      className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] rounded-xl cursor-pointer"
                    >
                      Clear Blocks
                    </button>
                  </div>

                  {/* Advance Multi-Day Court Blocking (e.g. Tomorrow Courts 1-4 Training Blocked) */}
                  <form
                    onSubmit={handleBlockAdvanceDates}
                    className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEBF9] pb-3">
                      <div className="flex items-center gap-2">
                        <Dumbbell className="w-4 h-4 text-[#7D2AE8]" />
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">
                            Advance Multi-Day Training / Court Blocker
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            Block specific courts (e.g. Badminton Courts 1–4) for future training days so users see Training Blocked.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            const tmr = addDaysToDateString(getTodayDateString(), 1);
                            setAdvStartDate(tmr);
                            setAdvEndDate(tmr);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#F3F0FC] text-[#7D2AE8] font-semibold cursor-pointer"
                        >
                          Tomorrow Only
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const tmr = addDaysToDateString(getTodayDateString(), 1);
                            setAdvStartDate(tmr);
                            setAdvEndDate(addDaysToDateString(tmr, 2));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#F3F0FC] text-[#7D2AE8] font-semibold cursor-pointer"
                        >
                          Next 3 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const tmr = addDaysToDateString(getTodayDateString(), 1);
                            setAdvStartDate(tmr);
                            setAdvEndDate(addDaysToDateString(tmr, 6));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#F3F0FC] text-[#7D2AE8] font-semibold cursor-pointer"
                        >
                          Next 7 Days
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Start Date
                        </label>
                        <input
                          type="date"
                          required
                          value={advStartDate}
                          onChange={(e) => setAdvStartDate(e.target.value)}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          End Date
                        </label>
                        <input
                          type="date"
                          required
                          value={advEndDate}
                          onChange={(e) => setAdvEndDate(e.target.value)}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Sport
                        </label>
                        <select
                          value={advSportId}
                          onChange={(e) => {
                            setAdvSportId(e.target.value);
                            setAdvCourtIds([]);
                          }}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        >
                          {dashboard.sports.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.courts.length})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Training Block Reason
                        </label>
                        <input
                          type="text"
                          value={advReason}
                          onChange={(e) => setAdvReason(e.target.value)}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                    </div>

                    {(() => {
                      const advSport =
                        dashboard.sports.find((s) => s.id === advSportId) || dashboard.sports[0];
                      if (!advSport) return null;
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-700">
                              Select Courts ({advCourtIds.length === 0 ? `All ${advSport.courts.length} courts if empty` : `${advCourtIds.length} selected`})
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setAdvCourtIds(advSport.courts.slice(0, 4).map((c) => c.id))}
                                className="text-[#7D2AE8] font-semibold cursor-pointer"
                              >
                                First 4 Courts
                              </button>
                              <button
                                type="button"
                                onClick={() => setAdvCourtIds(advSport.courts.map((c) => c.id))}
                                className="text-[#7D2AE8] font-semibold cursor-pointer"
                              >
                                All Courts
                              </button>
                              <button
                                type="button"
                                onClick={() => setAdvCourtIds([])}
                                className="text-slate-500 cursor-pointer"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {advSport.courts.map((c) => {
                              const picked = advCourtIds.includes(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() =>
                                    setAdvCourtIds((prev) =>
                                      prev.includes(c.id)
                                        ? prev.filter((id) => id !== c.id)
                                        : [...prev, c.id]
                                    )
                                  }
                                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                                    picked
                                      ? 'bg-[#7D2AE8] text-white border-[#7D2AE8]'
                                      : 'bg-[#FAF8FE] text-slate-700 border-[#DFDAFA]'
                                  }`}
                                >
                                  {c.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-700">
                          Select Time Slots ({advSlotIds.length === 0 ? 'Full Day (all 23 slots) if empty' : `${advSlotIds.length} hours selected`})
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setAdvSlotIds(timeSlots.filter((s) => s.startHour >= 5 && s.startHour < 12).map((s) => s.id))
                            }
                            className="text-[#7D2AE8] font-semibold cursor-pointer"
                          >
                            Morning
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAdvSlotIds(timeSlots.filter((s) => s.startHour >= 16 && s.startHour < 23).map((s) => s.id))
                            }
                            className="text-[#7D2AE8] font-semibold cursor-pointer"
                          >
                            Evening
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdvSlotIds([])}
                            className="text-slate-500 cursor-pointer"
                          >
                            Full Day (Default)
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {timeSlots.map((slot) => {
                          const picked = advSlotIds.includes(slot.id);
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              onClick={() =>
                                setAdvSlotIds((prev) =>
                                  prev.includes(slot.id)
                                    ? prev.filter((id) => id !== slot.id)
                                    : [...prev, slot.id]
                                )
                              }
                              className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-semibold tabular-nums cursor-pointer ${
                                picked
                                  ? 'bg-[#00A8B5] text-white border-[#00A8B5]'
                                  : 'bg-[#FAF8FE] text-slate-700 border-[#DFDAFA]'
                              }`}
                            >
                              {slot.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EFEBF9]">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={advCancelConflicts}
                          onChange={(e) => setAdvCancelConflicts(e.target.checked)}
                          className="rounded border-slate-300 text-[#7D2AE8]"
                        />
                        Automatically cancel any overlapping student bookings
                      </label>
                      <button
                        type="submit"
                        disabled={submittingAdvanceBlock}
                        className="min-h-[40px] px-5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-50 rounded-xl cursor-pointer"
                      >
                        {submittingAdvanceBlock ? 'Blocking Future Dates...' : 'Apply Advance Training Block'}
                      </button>
                    </div>
                  </form>

                  {/* Selected Cell Inspector Drawer (Shows full student names, roll nos & Venue Switcher) */}
                  {selectedCell && (
                    <div className="bg-white border-2 border-[#7D2AE8] rounded-2xl p-5 shadow-md space-y-4">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
                            <span>{matrixDate}</span>
                            <span>·</span>
                            <span className="font-semibold text-[#7D2AE8]">
                              {
                                getSlotOperationalState(
                                  selectedCell.slot,
                                  matrixDate,
                                  dashboard.policy
                                ).effectiveLabel
                              }
                            </span>
                            {selectedCell.booking?.inCourtAt && (
                              <span className="text-[#007B83] font-semibold">
                                · In-Court Tap at{' '}
                                {new Date(selectedCell.booking.inCourtAt).toLocaleTimeString([], {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </span>
                            )}
                          </div>
                          <div className="text-base font-bold text-slate-900 font-display">
                            {selectedCell.sportName} — {selectedCell.courtName}
                          </div>

                          {selectedCell.booking ? (
                            <div className="space-y-3 pt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div className="p-3 bg-[#FAF8FE] border border-[#EFEBF9] rounded-xl">
                                  <div className="text-[11px] font-semibold text-slate-500">
                                    Booking Pass &amp; Booked By
                                  </div>
                                  <div className="font-bold text-slate-900 mt-0.5">
                                    {selectedCell.booking.bookedByName} ({selectedCell.booking.bookedByRollNo})
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                                    Code #{selectedCell.booking.bookingCode ?? '—'} · Pass {selectedCell.booking.id} · {selectedCell.booking.bookedByEmail}
                                  </div>
                                </div>

                                <div className="p-3 bg-[#FAF8FE] border border-[#EFEBF9] rounded-xl">
                                  <div className="text-[11px] font-semibold text-slate-500">
                                    Gate &amp; Payment Telemetry
                                  </div>
                                  <div
                                    className={`font-bold mt-0.5 ${
                                      selectedCell.booking.securityStatus === 'admitted'
                                        ? 'text-emerald-700'
                                        : selectedCell.booking.securityStatus === 'no_show'
                                          ? 'text-rose-700'
                                          : 'text-amber-700'
                                    }`}
                                  >
                                    {selectedCell.booking.securityStatus === 'admitted'
                                      ? 'Admitted at Gate'
                                      : selectedCell.booking.securityStatus === 'no_show'
                                        ? 'Marked No-Show'
                                        : 'Pending Gate Arrival'}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                    {selectedCell.booking.payment
                                      ? `Paid ₹${selectedCell.booking.payment.amount} (${selectedCell.booking.payment.method.toUpperCase()}) · ${selectedCell.booking.payment.transactionId}`
                                      : 'Standard Free Booking'}
                                  </div>
                                </div>
                              </div>

                              {/* Full Verified Students & Roll Numbers Grid */}
                              <div>
                                <div className="text-xs font-bold text-slate-700 mb-1.5">
                                  Verified Students &amp; Roll Numbers ({selectedCell.booking.players.length})
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {selectedCell.booking.players.map((p, idx) => (
                                    <div
                                      key={p.rollNo}
                                      className="px-3 py-2 bg-[#F7F6FB] border border-[#E6E2F8] rounded-xl flex items-center justify-between gap-2 text-xs"
                                    >
                                      <span className="font-medium text-slate-900 truncate">
                                        {idx + 1}. {p.name}
                                      </span>
                                      <span className="font-mono font-bold text-[#7D2AE8] shrink-0">
                                        {p.rollNo}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Inline Venue / Court Switcher */}
                              <div className="p-3 bg-[#EBF9FA] border border-[#BCECF0] rounded-xl flex flex-wrap items-center gap-2.5">
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#007B83]">
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                  Edit Venue / Move Court:
                                </span>
                                {reassignOptions.length === 0 ? (
                                  <span className="text-xs text-slate-600">
                                    No other operational courts/tables free in this hour.
                                  </span>
                                ) : (
                                  <>
                                    <select
                                      value={reassignCourtId}
                                      onChange={(e) => setReassignCourtId(e.target.value)}
                                      className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-[#BCECF0] rounded-lg"
                                    >
                                      {reassignOptions.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name} ({c.surface})
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={reassigning}
                                      onClick={handleReassignBookingCourt}
                                      className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold text-white bg-[#00A8B5] hover:bg-[#008C93] disabled:opacity-50 rounded-lg cursor-pointer"
                                    >
                                      {reassigning ? 'Moving...' : 'Save Venue Change'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : selectedCell.blocked ? (
                            <p className="text-xs text-rose-700 font-medium pt-1">
                              Blocked by Admin: {selectedCell.blocked.reason}
                            </p>
                          ) : (
                            <p className="text-xs text-emerald-700 font-medium pt-1">
                              Slot is open for student reservations.
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {selectedCell.booking ? (
                            <>
                              {selectedCell.booking.securityStatus !== 'admitted' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAdminGateStatus(selectedCell.booking!.id, 'admitted')
                                  }
                                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer"
                                >
                                  Admit at Gate
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdminCancelBooking(
                                    selectedCell.booking!.id,
                                    'Cancelled by Admin via Matrix'
                                  )
                                }
                                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-[#FF5C5C] hover:bg-rose-600 rounded-xl cursor-pointer"
                              >
                                Cancel &amp; Free Slot
                              </button>
                            </>
                          ) : selectedCell.blocked ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleSlotBlock(
                                  'unblock',
                                  selectedCell.sportId,
                                  selectedCell.courtId,
                                  selectedCell.slot.id
                                )
                              }
                              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer"
                            >
                              Unblock Slot
                            </button>
                          ) : (
                            <>
                              <input
                                type="text"
                                value={blockReason}
                                onChange={(e) => setBlockReason(e.target.value)}
                                placeholder="Block reason"
                                className="min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl w-48"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleSlotBlock(
                                    'block',
                                    selectedCell.sportId,
                                    selectedCell.courtId,
                                    selectedCell.slot.id
                                  )
                                }
                                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-[#FF5C5C] hover:bg-rose-600 rounded-xl cursor-pointer"
                              >
                                Block Slot
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedCell(null)}
                            className="p-2 text-slate-400 hover:text-slate-900 cursor-pointer"
                            aria-label="Close inspector"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sticky-Header Scrollable Multi-Sport Matrix Table */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-hidden">
                    <div className="max-h-[68vh] overflow-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-20">
                          <tr className="bg-[#FAF8FE] border-b border-[#E6E2F8] text-[11px] font-semibold text-slate-600">
                            <th className="py-3 px-4 sticky left-0 top-0 z-30 bg-[#FAF8FE] border-r border-[#E6E2F8] min-w-48">
                              Sport &amp; Court Venue
                            </th>
                            {orderedMatrixSlots.map((slot, colIdx) => {
                              const isNow = slot.id === currentHourSlotId;
                              const slotOp = getSlotOperationalState(
                                slot,
                                matrixDate,
                                dashboard.policy
                              );
                              return (
                                <th
                                  key={slot.id}
                                  className={`py-3 px-2 text-center font-mono whitespace-nowrap ${
                                    isNow
                                      ? 'bg-[#E0F7FA] text-[#007B83] border-x border-[#80DEEA]'
                                      : slotOp.isMaintenance
                                        ? 'bg-slate-100 text-slate-400'
                                        : slot.isLateNight
                                          ? 'bg-amber-50/70 text-amber-800'
                                          : 'bg-[#FAF8FE]'
                                  }`}
                                >
                                  <div>{slotOp.effectiveShortLabel}</div>
                                  {isNow && (
                                    <div className="text-[9px] font-sans font-bold uppercase tracking-wider text-[#007B83]">
                                      Live {matrixOrder === 'live' && colIdx === 2 ? '#3' : 'Now'}
                                    </div>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFEBF9] text-[11px]">
                          {dashboard.sports
                            .filter(
                              (s) => matrixSportFilter === 'all' || s.id === matrixSportFilter
                            )
                            .map((sport) => (
                              <React.Fragment key={sport.id}>
                                <tr className="bg-[#F3F0FC]/80 border-y border-[#E6E2F8]">
                                  <td
                                    colSpan={orderedMatrixSlots.length + 1}
                                    className="py-2 px-4 text-xs font-bold text-[#7D2AE8] sticky left-0"
                                  >
                                    {sport.name} · {sport.courts.length} Venues · {sport.location}
                                  </td>
                                </tr>

                                {sport.courts.map((court) => (
                                  <tr key={court.id} className="hover:bg-[#FAF8FE]">
                                    <td className="py-2 px-4 sticky left-0 z-10 bg-white border-r border-[#E6E2F8]">
                                      <div className="font-semibold text-slate-900 whitespace-nowrap">
                                        {court.name}
                                      </div>
                                      <div className="text-[10px] text-slate-500 truncate max-w-40">
                                        {court.status === 'maintenance'
                                          ? 'Venue Maintenance'
                                          : court.surface}
                                      </div>
                                    </td>

                                    {orderedMatrixSlots.map((slot) => {
                                      const slotOp = getSlotOperationalState(
                                        slot,
                                        matrixDate,
                                        dashboard.policy
                                      );
                                      const booking = dashboard.bookings.find(
                                        (b) =>
                                          b.status === 'confirmed' &&
                                          b.date === matrixDate &&
                                          b.sportId === sport.id &&
                                          b.courtId === court.id &&
                                          b.slotId === slot.id
                                      );
                                      const blocked = dashboard.blockedSlots.find(
                                        (blk) =>
                                          blk.date === matrixDate &&
                                          blk.sportId === sport.id &&
                                          blk.courtId === court.id &&
                                          blk.slotId === slot.id
                                      );
                                      const isNow = slot.id === currentHourSlotId;
                                      const isMaintCell =
                                        court.status === 'maintenance' ||
                                        (slotOp.isMaintenance && !booking);

                                      let cellText = 'Open';
                                      let cellClass =
                                        'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100';

                                      if (isMaintCell) {
                                        cellText = 'Maint';
                                        cellClass =
                                          'bg-slate-100 text-slate-400 border border-slate-200/70';
                                      } else if (booking) {
                                        cellText = 'Booked';
                                        cellClass = booking.isLateNight
                                          ? 'bg-amber-500 text-white font-bold hover:bg-amber-600 shadow-xs'
                                          : booking.securityStatus === 'admitted'
                                            ? 'bg-emerald-600 text-white font-semibold hover:bg-emerald-700 shadow-xs'
                                            : 'bg-[#7D2AE8] text-white font-semibold hover:bg-[#6A1FD0] shadow-xs';
                                      } else if (blocked) {
                                        cellText = blocked.reason
                                          .toLowerCase()
                                          .includes('training')
                                          ? 'Training Blocked'
                                          : 'Blocked';
                                        cellClass =
                                          'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100';
                                      }

                                      return (
                                        <td
                                          key={slot.id}
                                          className={`p-1 text-center ${
                                            isNow ? 'bg-[#EBF9FA]/60 border-x border-[#BCECF0]' : ''
                                          }`}
                                        >
                                          <button
                                            type="button"
                                            disabled={isMaintCell}
                                            onClick={() =>
                                              setSelectedCell({
                                                sportId: sport.id,
                                                sportName: sport.name,
                                                courtId: court.id,
                                                courtName: court.name,
                                                slot,
                                                booking,
                                                blocked,
                                              })
                                            }
                                            title={
                                              booking
                                                ? `Booked (${slotOp.effectiveLabel}) — click to view students, roll nos & venue options`
                                                : isMaintCell
                                                  ? `Maintenance window (${slotOp.effectiveLabel})`
                                                  : blocked
                                                    ? `Blocked: ${blocked.reason}`
                                                    : `Open (${slotOp.effectiveLabel}) — click to block`
                                            }
                                            className={`relative min-w-[84px] px-1.5 py-1.5 rounded-lg text-[10px] font-semibold tabular-nums whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed ${cellClass}`}
                                          >
                                            {cellText}
                                            {booking?.inCourtAt && (
                                              <span
                                                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#00C4CC] border-2 border-white"
                                                title="Player tapped In Court"
                                              />
                                            )}
                                          </button>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </React.Fragment>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== TAB 4: BOOKINGS LEDGER ==================== */}
              {activeTab === 'bookings' && (
                <div className="space-y-4">
                  <div className="bg-[#FAF8FE] border border-[#DFDAFA] rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-[#7D2AE8] shrink-0" />
                      <span>
                        <span className="font-bold text-slate-900">30-Day Booking Ledger:</span> Bookings are stored for 30 days. On day 31, older records are automatically and permanently deleted.
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-[#7D2AE8] tabular-nums">
                      {dashboard.bookings.length} stored
                    </span>
                  </div>

                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                    <div className="relative flex-1 min-w-56">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={bookingSearch}
                        onChange={(e) => setBookingSearch(e.target.value)}
                        placeholder="Search Code #100, Pass ID, Student, Roll No, Sport, or Court..."
                        className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:border-[#7D2AE8]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={bookingStatusFilter}
                        onChange={(e) =>
                          setBookingStatusFilter(e.target.value as 'all' | 'confirmed' | 'cancelled')
                        }
                        className="min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        <option value="all">All Statuses</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>

                      <select
                        value={bookingTierFilter}
                        onChange={(e) =>
                          setBookingTierFilter(e.target.value as 'all' | 'free' | 'paid')
                        }
                        className="min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        <option value="all">All Tiers</option>
                        <option value="free">Standard Free</option>
                        <option value="paid">Late-Night Paid</option>
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            `sportx_bookings_${getTodayDateString()}.csv`,
                            ['Daily Code', 'Booking ID', 'Date', 'Slot', 'Sport', 'Court', 'Booked By', 'Roll No', 'Players', 'In Court', 'Gate Status', 'Payment', 'Status'],
                            filteredBookings.map((b) => [
                              b.bookingCode ? String(b.bookingCode) : '',
                              b.id,
                              b.date,
                              b.slotLabel,
                              b.sportName,
                              b.courtName,
                              b.bookedByName,
                              b.bookedByRollNo,
                              b.players.map((p) => p.rollNo).join('; '),
                              b.inCourtAt ? 'Yes' : 'No',
                              b.securityStatus,
                              b.payment ? `INR ${b.payment.amount} (${b.payment.transactionId})` : 'Free',
                              b.status,
                            ])
                          )
                        }
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#7D2AE8] hover:bg-[#6A1FD0] rounded-xl cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                      </button>
                    </div>
                  </div>

                  <div className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#FAF8FE] border-b border-[#EFEBF9] text-xs font-semibold text-slate-500">
                          <th className="py-3 px-4">Code &amp; ID</th>
                          <th className="py-3 px-4">Date &amp; Slot</th>
                          <th className="py-3 px-4">Facility</th>
                          <th className="py-3 px-4">Booked By &amp; Roster</th>
                          <th className="py-3 px-4">Arrival &amp; Gate</th>
                          <th className="py-3 px-4">Payment</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F4F1FC] text-xs">
                        {filteredBookings.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-10 text-center text-slate-400">
                              No bookings match your active filters.
                            </td>
                          </tr>
                        ) : (
                          filteredBookings.map((b) => (
                            <tr key={b.id} className="hover:bg-[#FAF8FE] align-top">
                              <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                                <div className="font-bold text-slate-900 tabular-nums">
                                  Code #{b.bookingCode ?? '—'}
                                </div>
                                <div className="text-[11px] font-semibold text-[#7D2AE8]">
                                  {b.id}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap text-slate-700">
                                <div>{b.date}</div>
                                <div className="text-slate-500">{b.slotLabel}</div>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <div className="font-semibold text-slate-900">{b.sportName}</div>
                                <div className="text-slate-500">{b.courtName}</div>
                              </td>
                              <td className="py-3.5 px-4 max-w-xs">
                                <div className="font-semibold text-slate-900">
                                  {b.bookedByName} ({b.bookedByRollNo})
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                  {b.players.length} IDs: {b.players.map((p) => p.rollNo).join(', ')}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <div
                                  className={`font-semibold ${
                                    b.securityStatus === 'admitted'
                                      ? 'text-emerald-700'
                                      : b.securityStatus === 'no_show'
                                        ? 'text-rose-700'
                                        : 'text-slate-600'
                                  }`}
                                >
                                  {b.securityStatus === 'admitted'
                                    ? 'Gate Admitted'
                                    : b.securityStatus === 'no_show'
                                      ? 'No-Show'
                                      : 'Gate Pending'}
                                </div>
                                {b.inCourtAt && (
                                  <div className="text-[11px] text-[#007B83] flex items-center gap-1 mt-0.5">
                                    <MapPin className="w-3 h-3" />
                                    In-Court ({b.inCourtByRollNo})
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap font-mono tabular-nums">
                                {b.payment ? (
                                  <div>
                                    <span className="font-semibold text-amber-700">
                                      ₹{b.payment.amount} ({b.payment.method.toUpperCase()})
                                    </span>
                                    <div className="text-[11px] text-slate-500">
                                      {b.payment.transactionId}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-500">Free</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className={`font-semibold ${
                                    b.status === 'confirmed' ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                                </span>
                                {b.cancelReason && (
                                  <div className="text-[11px] text-slate-500 max-w-36 truncate">
                                    {b.cancelReason}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                {b.status === 'confirmed' && (
                                  <div className="inline-flex items-center gap-1.5">
                                    {b.securityStatus !== 'admitted' && (
                                      <button
                                        type="button"
                                        onClick={() => handleAdminGateStatus(b.id, 'admitted')}
                                        className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                                      >
                                        Admit
                                      </button>
                                    )}
                                    {cancellingBookingId === b.id ? (
                                      <div className="inline-flex items-center gap-1.5">
                                        <input
                                          type="text"
                                          value={cancelReasonInput}
                                          onChange={(e) => setCancelReasonInput(e.target.value)}
                                          placeholder="Reason"
                                          className="px-2 py-1 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded w-28"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleAdminCancelBooking(
                                              b.id,
                                              cancelReasonInput || 'Cancelled by Admin'
                                            )
                                          }
                                          className="px-2.5 py-1 text-xs font-semibold text-white bg-[#FF5C5C] rounded cursor-pointer"
                                        >
                                          Confirm
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setCancellingBookingId(null)}
                                          className="px-2 py-1 text-xs text-slate-500 cursor-pointer"
                                        >
                                          No
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCancellingBookingId(b.id);
                                          setCancelReasonInput('');
                                        }}
                                        className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ==================== TAB 6: COURTS, NEW SPORTS, TABLE RENAMING & PRICING ==================== */}
              {activeTab === 'facilities' && (
                <div className="space-y-6">
                  {/* Add Brand-New Sport + Initial Courts */}
                  <form
                    onSubmit={handleAddSport}
                    className="bg-white border border-[#E6E2F8] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4"
                  >
                    <div className="flex items-start gap-3 border-b border-[#EFEBF9] pb-3.5">
                      <CalendarPlus className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Add New Sport &amp; Initial Courts (e.g. Nets Cricket, Pickleball)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Creates a new sport with courts/nets, player limits, and late-night pricing, immediately visible to students and walk-in desks.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Sport Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={newSportName}
                          onChange={(e) => setNewSportName(e.target.value)}
                          placeholder="e.g. Nets Cricket"
                          className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Category
                        </label>
                        <select
                          value={newSportCategory}
                          onChange={(e) => setNewSportCategory(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        >
                          <option value="Team Sports">Team Sports</option>
                          <option value="Racket Sports">Racket Sports</option>
                          <option value="Cue Sports">Cue Sports</option>
                          <option value="Mind Sports">Mind Sports</option>
                          <option value="Field & Nets">Field &amp; Nets</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Initial Courts / Nets
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={newSportCourtCount}
                          onChange={(e) => setNewSportCourtCount(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Default Surface
                        </label>
                        <input
                          type="text"
                          value={newSportSurface}
                          onChange={(e) => setNewSportSurface(e.target.value)}
                          placeholder="e.g. Astro Turf Cage"
                          className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Min IDs Required
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={newSportMinPlayers}
                          onChange={(e) => setNewSportMinPlayers(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Max IDs Allowed
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={newSportMaxPlayers}
                          onChange={(e) => setNewSportMaxPlayers(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          11 PM+ Fee (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={newSportFee}
                          onChange={(e) => setNewSportFee(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Location
                        </label>
                        <input
                          type="text"
                          value={newSportLocation}
                          onChange={(e) => setNewSportLocation(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={addingSport}
                        className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-50 rounded-xl cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {addingSport ? 'Adding Sport...' : 'Create New Sport'}
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Required Equipment Rule
                      </label>
                      <input
                        type="text"
                        value={newSportEquipment}
                        onChange={(e) => setNewSportEquipment(e.target.value)}
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                  </form>

                  <form
                    onSubmit={handleAddCourt}
                    className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs flex flex-wrap items-end gap-4"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sport
                      </label>
                      <select
                        value={newCourtSportId}
                        onChange={(e) => setNewCourtSportId(e.target.value)}
                        className="min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        {dashboard.sports.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1 min-w-44">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        New Court / Table / Net Name
                      </label>
                      <input
                        type="text"
                        required
                        value={newCourtName}
                        onChange={(e) => setNewCourtName(e.target.value)}
                        placeholder="e.g. Court 11 or Table 6"
                        className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>

                    <div className="flex-1 min-w-44">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Surface Type
                      </label>
                      <input
                        type="text"
                        value={newCourtSurface}
                        onChange={(e) => setNewCourtSurface(e.target.value)}
                        placeholder="e.g. BWF Synthetic Mat"
                        className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>

                    <button
                      type="submit"
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 rounded-xl cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Court / Table
                    </button>
                  </form>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    {dashboard.sports.map((sport) => {
                      const edit = sportEdits[sport.id] || {
                        lateNightFee: String(sport.lateNightFee),
                        minPlayers: String(sport.minPlayers),
                        maxPlayers: String(sport.maxPlayers),
                        equipmentRequired: sport.equipmentRequired,
                        location: sport.location,
                      };
                      return (
                        <div
                          key={sport.id}
                          className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-hidden flex flex-col justify-between"
                        >
                          <div>
                            <div className="px-5 py-4 border-b border-[#EFEBF9] flex items-center justify-between">
                              <div>
                                <h3 className="text-sm font-bold text-slate-900">{sport.name}</h3>
                                <p className="text-xs text-slate-500">
                                  {sport.courts.length} Venues · {sport.location}
                                </p>
                              </div>
                            </div>

                            <div className="divide-y divide-[#F4F1FC] max-h-72 overflow-y-auto">
                              {sport.courts.map((court) => {
                                const isOp = court.status === 'operational';
                                const rowKey = `${sport.id}:${court.id}`;
                                const isEditing = editingCourtKey === rowKey;

                                return (
                                  <div key={court.id} className="px-5 py-2.5 space-y-2">
                                    {isEditing ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <input
                                          type="text"
                                          value={editingCourtName}
                                          onChange={(e) => setEditingCourtName(e.target.value)}
                                          placeholder="Court or Table Name"
                                          className="flex-1 min-w-28 px-2.5 py-1.5 text-xs font-semibold text-slate-900 bg-[#FAF8FE] border border-[#7D2AE8] rounded-lg"
                                        />
                                        <input
                                          type="text"
                                          value={editingCourtSurface}
                                          onChange={(e) => setEditingCourtSurface(e.target.value)}
                                          placeholder="Surface"
                                          className="flex-1 min-w-28 px-2.5 py-1.5 text-xs text-slate-700 bg-[#FAF8FE] border border-[#DFDAFA] rounded-lg"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleSaveCourtDetails(sport.id, court.id)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingCourtKey(null)}
                                          className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="text-xs font-semibold text-slate-900 truncate">
                                            {court.name}
                                          </div>
                                          <div className="text-[11px] text-slate-500 truncate">
                                            {court.surface}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingCourtKey(rowKey);
                                              setEditingCourtName(court.name);
                                              setEditingCourtSurface(court.surface);
                                            }}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#7D2AE8] bg-[#F3F0FC] hover:bg-[#EAE4FA] rounded-lg cursor-pointer"
                                          >
                                            <Edit3 className="w-3 h-3" />
                                            Rename
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleToggleCourtStatus(
                                                sport.id,
                                                court.id,
                                                isOp ? 'maintenance' : 'operational'
                                              )
                                            }
                                            className={`px-3 py-1 text-xs font-semibold rounded-lg border cursor-pointer ${
                                              isOp
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                            }`}
                                          >
                                            {isOp ? 'Operational' : 'Maintenance'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Sport Pricing, Location & Equipment Editor */}
                          <div className="p-4 bg-[#FAF8FE] border-t border-[#EFEBF9] space-y-3">
                            <div className="grid grid-cols-3 gap-2.5">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  11 PM+ Fee (₹)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  value={edit.lateNightFee}
                                  onChange={(e) =>
                                    setSportEdits((prev) => ({
                                      ...prev,
                                      [sport.id]: { ...edit, lateNightFee: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Min IDs
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={edit.minPlayers}
                                  onChange={(e) =>
                                    setSportEdits((prev) => ({
                                      ...prev,
                                      [sport.id]: { ...edit, minPlayers: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Max IDs
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={30}
                                  value={edit.maxPlayers}
                                  onChange={(e) =>
                                    setSportEdits((prev) => ({
                                      ...prev,
                                      [sport.id]: { ...edit, maxPlayers: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Facility Location
                                </label>
                                <input
                                  type="text"
                                  value={edit.location}
                                  onChange={(e) =>
                                    setSportEdits((prev) => ({
                                      ...prev,
                                      [sport.id]: { ...edit, location: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Equipment Rule (Shown to Students)
                                </label>
                                <input
                                  type="text"
                                  value={edit.equipmentRequired}
                                  onChange={(e) =>
                                    setSportEdits((prev) => ({
                                      ...prev,
                                      [sport.id]: { ...edit, equipmentRequired: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                                />
                              </div>
                            </div>

                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleSaveSportConfig(sport.id)}
                                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#7D2AE8] hover:bg-[#6A1FD0] rounded-lg cursor-pointer"
                              >
                                Save Sport Rules
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ==================== TAB 7: STUDENT ROSTER, 1-YEAR SUBSCRIPTIONS & BULK DOCUMENT IMPORTER ==================== */}
              {activeTab === 'students' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <FileSpreadsheet className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                        <div>
                          <h2 className="text-sm font-bold text-slate-900">
                            Official College Sports Roster &amp; Document Importer
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Import documents with Name, Roll No, ID No, and Day of Payment. If Day of Payment is missing/unpaid or past 1 year, the account auto-deactivates until you click Paid.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            'sportx_roster_template.csv',
                            ['name', 'rollNo', 'idNo', 'dayOfPayment', 'email', 'phone', 'department', 'year'],
                            [
                              ['Aryan Verma', '25CS201', 'WU25-0201', getTodayDateString(), 'aryan.25cs201@campus.edu.in', '9876500111', 'SoT', '1st Year'],
                              ['Sneha Patel', '25MB202', 'WU25-0202', '', 'sneha.25mb202@campus.edu.in', '9876500112', 'SoB', '1st Year'],
                            ]
                          )
                        }
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] border border-[#DFDAFA] rounded-xl cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Sample CSV Template
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <label className="border-2 border-dashed border-[#D3CBFA] hover:border-[#7D2AE8] rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-colors bg-[#FAF8FE]">
                        <Upload className="w-6 h-6 text-[#7D2AE8]" />
                        <span className="text-xs font-bold text-slate-900">
                          {importFileName
                            ? `Loaded: ${importFileName}`
                            : 'Drop or click to select Excel / CSV / TXT / JSON file'}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Columns detected automatically: Name, Roll No, ID No, Day of Payment, Email, Phone, School, Year
                        </span>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv,.tsv,.txt,.json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFileImport(f);
                          }}
                        />
                      </label>

                      <div className="space-y-2">
                        <textarea
                          rows={4}
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          placeholder={`Or paste CSV/table rows directly:\nname,rollNo,idNo,dayOfPayment,email,phone,department,year\nKaran Shah,25CS301,WU25-0301,${getTodayDateString()},karan.25cs301@campus.edu.in,9876501234,SoT,1st Year`}
                          className="w-full p-3 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:border-[#7D2AE8]"
                        />
                        <button
                          type="button"
                          onClick={handleParsePastedText}
                          className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] rounded-xl cursor-pointer"
                        >
                          Parse Pasted Text
                        </button>
                      </div>
                    </div>

                    {parsedImportRows.length > 0 && (
                      <div className="border border-emerald-200 bg-emerald-50/60 rounded-2xl p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs font-bold text-emerald-800">
                            Ready to import {parsedImportRows.length} student records ({parsedImportRows.filter((r) => r.status === 'active').length} active, {parsedImportRows.filter((r) => r.status === 'expired').length} deactivated/unpaid)
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setParsedImportRows([]);
                                setImportFileName(null);
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              disabled={importingBulk}
                              onClick={handleConfirmBulkImport}
                              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer"
                            >
                              {importingBulk
                                ? 'Importing...'
                                : `Import ${parsedImportRows.length} Students Now`}
                            </button>
                          </div>
                        </div>

                        <div className="max-h-44 overflow-auto bg-white border border-[#E6E2F8] rounded-xl">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-[#FAF8FE] text-slate-500">
                              <tr>
                                <th className="py-2 px-3">Name</th>
                                <th className="py-2 px-3">Roll No</th>
                                <th className="py-2 px-3">ID No</th>
                                <th className="py-2 px-3">Day of Payment</th>
                                <th className="py-2 px-3">School</th>
                                <th className="py-2 px-3">Auto Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F4F1FC] text-slate-800">
                              {parsedImportRows.slice(0, 20).map((r, i) => (
                                <tr key={i}>
                                  <td className="py-1.5 px-3 font-medium">{r.name}</td>
                                  <td className="py-1.5 px-3 font-mono">{r.rollNo}</td>
                                  <td className="py-1.5 px-3 font-mono text-slate-600">{r.idNo || '—'}</td>
                                  <td className="py-1.5 px-3 font-mono tabular-nums">
                                    {r.paymentDate || <span className="text-rose-600">Unpaid / None</span>}
                                  </td>
                                  <td className="py-1.5 px-3 font-mono">{r.department}</td>
                                  <td className="py-1.5 px-3 font-semibold">
                                    {r.status === 'active' ? (
                                      <span className="text-emerald-700">Active (1 Yr)</span>
                                    ) : (
                                      <span className="text-rose-700">Deactivated Until Paid</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Single Student Add with Roll No, ID No, School Short Form & Day of Payment */}
                  <form
                    onSubmit={handleAddStudent}
                    className="bg-white border border-[#E6E2F8] rounded-2xl p-5 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Roll No
                      </label>
                      <input
                        type="text"
                        required
                        value={newStudentRoll}
                        onChange={(e) => setNewStudentRoll(e.target.value.toUpperCase())}
                        placeholder="e.g. 25CS199"
                        className="w-full min-h-[40px] px-3 py-2 text-xs font-mono uppercase text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ID No
                      </label>
                      <input
                        type="text"
                        value={newStudentIdNo}
                        onChange={(e) => setNewStudentIdNo(e.target.value.toUpperCase())}
                        placeholder="e.g. WU25-0199"
                        className="w-full min-h-[40px] px-3 py-2 text-xs font-mono uppercase text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={newStudentName}
                        onChange={(e) => setNewStudentName(e.target.value)}
                        placeholder="Student Name"
                        className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        College Email (.edu.in)
                      </label>
                      <input
                        type="email"
                        required
                        value={newStudentEmail}
                        onChange={(e) => setNewStudentEmail(e.target.value)}
                        placeholder="student@campus.edu.in"
                        className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        School
                      </label>
                      <select
                        value={newStudentDept}
                        onChange={(e) => setNewStudentDept(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-2 text-xs font-semibold text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      >
                        {SCHOOL_DEPARTMENTS.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Day of Payment (Till {addOneYearDate(newStudentSubStart || getTodayDateString())})
                      </label>
                      <input
                        type="date"
                        required
                        value={newStudentSubStart}
                        onChange={(e) => setNewStudentSubStart(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                    <button
                      type="submit"
                      className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] rounded-xl cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add to Roster
                    </button>
                  </form>

                  {/* Roster Directory Table */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-hidden">
                    <div className="p-4 border-b border-[#EFEBF9] flex flex-wrap items-center justify-between gap-3">
                      <div className="relative flex-1 min-w-52 max-w-md">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          placeholder="Search Roll No, ID No, Name, .edu.in Email, or School..."
                          className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          {filteredStudents.length} Students
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            downloadCsv(
                              `sportx_roster_${getTodayDateString()}.csv`,
                              ['Roll No', 'ID No', 'Name', 'Email', 'Phone', 'School', 'Year', 'Day of Payment', 'Valid Until', 'Status'],
                              filteredStudents.map((s) => [
                                s.rollNo,
                                s.idNo || '',
                                s.name,
                                s.email,
                                s.phone,
                                s.department,
                                s.year,
                                s.paymentDate || s.subscriptionStartDate || '',
                                s.subscriptionEndDate || '',
                                s.status,
                              ])
                            )
                          }
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] border border-[#DFDAFA] rounded-xl cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#FAF8FE] border-b border-[#EFEBF9] text-xs font-semibold text-slate-500">
                            <th className="py-3 px-4">Roll No</th>
                            <th className="py-3 px-4">ID No</th>
                            <th className="py-3 px-4">Student</th>
                            <th className="py-3 px-4">Contact</th>
                            <th className="py-3 px-4">School &amp; Year</th>
                            <th className="py-3 px-4">Day of Payment &rarr; Valid Till</th>
                            <th className="py-3 px-4">ID Status</th>
                            <th className="py-3 px-4 text-right">Control</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F4F1FC] text-xs">
                          {filteredStudents.map((s) => {
                            const isActive = s.status === 'active';
                            const isExpired = s.status === 'expired';
                            const payDay = s.paymentDate || s.subscriptionStartDate;
                            return (
                              <tr key={s.id} className="hover:bg-[#FAF8FE]">
                                <td className="py-3 px-4 font-mono font-bold text-[#7D2AE8] whitespace-nowrap">
                                  {s.rollNo}
                                </td>
                                <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                                  {s.idNo || '—'}
                                </td>
                                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                                  {s.name}
                                </td>
                                <td className="py-3 px-4 text-slate-600">
                                  <div>{s.email}</div>
                                  <div className="font-mono text-[11px] text-slate-500">
                                    {s.phone}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                                  <span className="font-semibold text-slate-800">{s.department}</span> · {s.year}
                                </td>
                                <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap tabular-nums">
                                  {payDay && s.subscriptionEndDate ? (
                                    <div>
                                      {payDay} &rarr;{' '}
                                      <strong className={isExpired ? 'text-rose-700' : 'text-slate-900'}>
                                        {s.subscriptionEndDate}
                                      </strong>
                                    </div>
                                  ) : (
                                    <span className="text-rose-600 font-semibold">Unpaid</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1.5 font-semibold ${
                                      isActive
                                        ? 'text-emerald-700'
                                        : isExpired
                                          ? 'text-amber-700'
                                          : 'text-rose-700'
                                    }`}
                                  >
                                    {isActive ? (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    ) : (
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                    )}
                                    {isActive ? 'Active' : isExpired ? 'Deactivated (Due)' : 'Suspended'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      disabled={payingRollNo === s.rollNo}
                                      onClick={() => handleMarkStudentPaid(s.rollNo)}
                                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                                      title="Mark Paid today and activate 1-year subscription"
                                    >
                                      {payingRollNo === s.rollNo ? 'Saving...' : 'Paid'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleStudentStatus(
                                          s.rollNo,
                                          isActive ? 'suspended' : 'active'
                                        )
                                      }
                                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                                        isActive
                                          ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                                          : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                      }`}
                                    >
                                      {isActive ? 'Suspend' : 'Activate'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveStudentFromRoster(s.rollNo)}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg border border-transparent hover:border-rose-200 cursor-pointer"
                                      title={`Remove ${s.rollNo} from official roster`}
                                      aria-label={`Remove ${s.rollNo} from roster`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== TAB 8: CANVA BLACK STUDIO — SUBSCRIPTIONS, NO-SHOWS & LOGIN ACCOUNTS ==================== */}
              {activeTab === 'subscriptions' && (() => {
                const todayStr = getTodayDateString();
                const in30DaysStr = addDaysToDateString(todayStr, 30);
                const activeRosterStudents = dashboard.students.filter((s) => s.status === 'active');
                const expiredStudents = dashboard.students.filter((s) => s.status === 'expired');
                const expiringSoon = dashboard.students.filter(
                  (s) =>
                    s.status === 'active' &&
                    s.subscriptionEndDate &&
                    s.subscriptionEndDate <= in30DaysStr
                );
                const bannedStudents = dashboard.students.filter((s) => s.isBanned);
                const sportNameById = new Map<string, string>(
                  dashboard.sports.map((sp) => [sp.id, sp.name])
                );

                const subQuery = subSearch.trim().toLowerCase();
                const subRows = dashboard.students.filter((s) => {
                  if (subFilter === 'expired' && s.status !== 'expired') return false;
                  if (subFilter === 'active' && s.status !== 'active') return false;
                  if (subFilter === 'banned' && !s.isBanned) return false;
                  if (
                    subFilter === 'expiring' &&
                    !(
                      s.status === 'expired' ||
                      (Boolean(s.subscriptionEndDate) && (s.subscriptionEndDate || '') <= in30DaysStr)
                    )
                  ) {
                    return false;
                  }
                  if (!subQuery) return true;
                  return (
                    s.rollNo.toLowerCase().includes(subQuery) ||
                    (s.idNo && s.idNo.toLowerCase().includes(subQuery)) ||
                    s.name.toLowerCase().includes(subQuery) ||
                    s.email.toLowerCase().includes(subQuery) ||
                    s.department.toLowerCase().includes(subQuery)
                  );
                });

                const noShowBookings = dashboard.bookings.filter((b) => b.securityStatus === 'no_show');
                const admittedBookings = dashboard.bookings.filter((b) => b.securityStatus === 'admitted');
                const confirmedTodayBookings = dashboard.bookings.filter((b) => b.status === 'confirmed');

                const bookingStatsByRoll = new Map<
                  string,
                  {
                    rollNo: string;
                    name: string;
                    department: string;
                    confirmed: number;
                    admitted: number;
                    noShow: number;
                    lateNight: number;
                  }
                >();
                for (const b of confirmedTodayBookings) {
                  const key = b.bookedByRollNo.toUpperCase();
                  const rosterMatch = dashboard.students.find((s) => s.rollNo.toUpperCase() === key);
                  const cur = bookingStatsByRoll.get(key) || {
                    rollNo: b.bookedByRollNo,
                    name: b.bookedByName,
                    department: rosterMatch?.department || 'Campus',
                    confirmed: 0,
                    admitted: 0,
                    noShow: 0,
                    lateNight: 0,
                  };
                  cur.confirmed += 1;
                  if (b.securityStatus === 'admitted') cur.admitted += 1;
                  if (b.securityStatus === 'no_show') cur.noShow += 1;
                  if (b.isLateNight) cur.lateNight += 1;
                  bookingStatsByRoll.set(key, cur);
                }
                const attendanceSummaryRows = Array.from(bookingStatsByRoll.values()).sort(
                  (a, b) => b.noShow - a.noShow || b.confirmed - a.confirmed
                );
                const repeatOffenderCount = attendanceSummaryRows.filter((r) => r.noShow > 0).length;

                const filteredAccounts = dashboard.loginAccounts.filter((acc) => {
                  const q = loginAccountSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    acc.rollNo.toLowerCase().includes(q) ||
                    (acc.idNo && acc.idNo.toLowerCase().includes(q)) ||
                    acc.name.toLowerCase().includes(q) ||
                    acc.email.toLowerCase().includes(q) ||
                    acc.phone.toLowerCase().includes(q) ||
                    acc.department.toLowerCase().includes(q)
                  );
                });

                return (
                  <div className="relative rounded-3xl overflow-hidden bg-[#07080D] border border-white/10 text-zinc-100 shadow-xl">
                    {/* Canva Obsidian Hero Backdrop + Measured Scrim */}
                    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
                      <img
                        src={subscriptionsDarkBg}
                        alt=""
                        aria-hidden="true"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover opacity-30"
                      />
                      <div className="w-full h-full bg-gradient-to-br from-[#07080D]/92 via-[#0A0C14]/90 to-[#110E1E]/95 absolute inset-0" />
                    </div>

                    <div className="relative z-10 p-5 sm:p-8 space-y-6">
                      {/* Clean Header + 3 Sub-Pages */}
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-white/10 pb-5">
                        <div className="space-y-1">
                          <h2 className="text-2xl font-bold tracking-tight text-white">
                            {subPageTab === 'subscriptions'
                              ? 'Subscriptions & Bans'
                              : subPageTab === 'noshows'
                                ? 'No-Shows & Attendance'
                                : 'Login Accounts'}
                          </h2>
                          <p className="text-xs sm:text-sm text-zinc-400">
                            {subPageTab === 'subscriptions'
                              ? 'Mark 1-year fee payments or issue temporary bans for all or selected sports.'
                              : subPageTab === 'noshows'
                                ? 'Track gate admissions and student no-shows.'
                                : 'Registered .edu.in accounts and roster activation.'}
                          </p>
                        </div>

                        <div
                          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-white/[0.06] border border-white/10 self-start xl:self-auto"
                          role="tablist"
                          aria-label="Member Hub Sub-Pages"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={subPageTab === 'subscriptions'}
                            onClick={() => setSubPageTab('subscriptions')}
                            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              subPageTab === 'subscriptions'
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                            }`}
                          >
                            Subscriptions ({dashboard.students.length})
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={subPageTab === 'noshows'}
                            onClick={() => setSubPageTab('noshows')}
                            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              subPageTab === 'noshows'
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                            }`}
                          >
                            No-Shows ({noShowBookings.length})
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={subPageTab === 'accounts'}
                            onClick={() => setSubPageTab('accounts')}
                            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              subPageTab === 'accounts'
                                ? 'bg-violet-600 text-white'
                                : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                            }`}
                          >
                            Login Accounts ({dashboard.loginAccounts.length})
                          </button>
                        </div>
                      </div>

                      {/* ==================== SUB-PAGE 1: SUBSCRIPTIONS & BANS ==================== */}
                      {subPageTab === 'subscriptions' && (
                        <div className="space-y-5">
                          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 space-y-1">
                              <div className="text-xs text-zinc-400">Active Passes</div>
                              <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                                {activeRosterStudents.length}
                              </div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 space-y-1">
                              <div className="text-xs text-zinc-400">Unpaid / Expired</div>
                              <div className="text-2xl font-bold text-rose-400 font-mono tabular-nums">
                                {expiredStudents.length}
                              </div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 space-y-1">
                              <div className="text-xs text-zinc-400">Expiring &lt;30d</div>
                              <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums">
                                {expiringSoon.length}
                              </div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 space-y-1">
                              <div className="text-xs text-zinc-400">Banned Students</div>
                              <div className="text-2xl font-bold text-rose-300 font-mono tabular-nums">
                                {bannedStudents.length}
                              </div>
                            </div>
                          </div>

                          {/* Filter, Payment Date & Table */}
                          <div className="bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden">
                            <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                              <div className="flex flex-wrap items-center gap-3 flex-1">
                                <div className="relative flex-1 min-w-52 max-w-sm">
                                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                  <input
                                    type="text"
                                    value={subSearch}
                                    onChange={(e) => setSubSearch(e.target.value)}
                                    placeholder="Search Roll No, ID No, Name, School..."
                                    className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 bg-black/50 border border-white/15 rounded-xl focus:outline-none focus:border-violet-400"
                                  />
                                </div>

                                <div className="inline-flex flex-wrap rounded-xl bg-black/40 border border-white/10 p-1 gap-1">
                                  {(
                                    [
                                      { id: 'all', label: 'All' },
                                      { id: 'active', label: 'Active' },
                                      { id: 'expired', label: 'Unpaid / Expired' },
                                      { id: 'expiring', label: 'Expiring <30d' },
                                      { id: 'banned', label: `Banned (${bannedStudents.length})` },
                                    ] as const
                                  ).map((f) => (
                                    <button
                                      key={f.id}
                                      type="button"
                                      onClick={() => setSubFilter(f.id)}
                                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                                        subFilter === f.id
                                          ? 'bg-violet-600 text-white'
                                          : 'text-zinc-400 hover:text-white'
                                      }`}
                                    >
                                      {f.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-3 shrink-0">
                                <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                                  <span className="whitespace-nowrap">Paid Date:</span>
                                  <input
                                    type="date"
                                    value={paymentEntryDate}
                                    onChange={(e) => setPaymentEntryDate(e.target.value)}
                                    className="min-h-[38px] px-2.5 py-1 text-xs font-mono text-white bg-black/50 border border-white/15 rounded-lg"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadCsv(
                                      `sportx_subscriptions_${todayStr}.csv`,
                                      ['Roll No', 'ID No', 'Name', 'School', 'Day of Payment', 'Valid Until', 'Pass Status', 'Ban Status'],
                                      subRows.map((s) => [
                                        s.rollNo,
                                        s.idNo || '',
                                        s.name,
                                        s.department,
                                        s.paymentDate || s.subscriptionStartDate || 'Unpaid',
                                        s.subscriptionEndDate || '',
                                        s.status,
                                        s.isBanned
                                          ? `${s.banScope === 'selected' ? (s.bannedSports || []).join(';') : 'All Sports'} until ${s.banUntil || ''}`
                                          : 'None',
                                      ])
                                    )
                                  }
                                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 rounded-xl whitespace-nowrap cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Export CSV
                                </button>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-black/40 border-b border-white/10 text-xs font-semibold text-zinc-400">
                                    <th className="py-3.5 px-4">Roll &amp; ID No</th>
                                    <th className="py-3.5 px-4">Student &amp; School</th>
                                    <th className="py-3.5 px-4">Paid / Valid Until</th>
                                    <th className="py-3.5 px-4">Status &amp; Sports Ban</th>
                                    <th className="py-3.5 px-4 text-right">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.06] text-xs">
                                  {subRows.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="py-10 px-4 text-center text-zinc-400">
                                        No student subscriptions match your current filter.
                                      </td>
                                    </tr>
                                  ) : (
                                    subRows.map((s) => {
                                      const payDay = s.paymentDate || s.subscriptionStartDate;
                                      const isActive = s.status === 'active';
                                      const isExpired = s.status === 'expired';
                                      const bannedNames =
                                        s.banScope === 'selected'
                                          ? (s.bannedSports || [])
                                              .map((id) => sportNameById.get(id) || id)
                                              .join(', ')
                                          : 'All Sports';
                                      return (
                                        <tr key={s.id} className="hover:bg-white/[0.03] align-top">
                                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                                            <div className="font-bold text-cyan-300">{s.rollNo}</div>
                                            {s.idNo && (
                                              <div className="text-[11px] text-zinc-400">{s.idNo}</div>
                                            )}
                                          </td>
                                          <td className="py-3 px-4 whitespace-nowrap">
                                            <div className="font-semibold text-white">{s.name}</div>
                                            <div className="text-[11px] text-zinc-400">{s.department}</div>
                                          </td>
                                          <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                                            <div>
                                              {payDay ? (
                                                <span className="text-zinc-200">{payDay}</span>
                                              ) : (
                                                <span className="text-rose-400 font-semibold">Unpaid</span>
                                              )}
                                            </div>
                                            <div className={`text-[11px] ${isExpired ? 'text-rose-400 font-semibold' : 'text-zinc-400'}`}>
                                              {s.subscriptionEndDate ? `Until ${s.subscriptionEndDate}` : '—'}
                                            </div>
                                          </td>
                                          <td className="py-3 px-4">
                                            <div
                                              className={`font-semibold whitespace-nowrap ${
                                                isActive
                                                  ? 'text-emerald-400'
                                                  : isExpired
                                                    ? 'text-amber-400'
                                                    : 'text-rose-400'
                                              }`}
                                            >
                                              {isActive
                                                ? 'Active Pass'
                                                : isExpired
                                                  ? 'Unpaid / Expired'
                                                  : 'Suspended'}
                                            </div>
                                            {s.isBanned && (
                                              <div className="mt-1 text-[11px] text-rose-300 leading-snug">
                                                <span className="font-bold">Banned ({bannedNames})</span>{' '}
                                                until <span className="font-mono">{s.banUntil}</span>
                                                {s.banReason ? ` · ${s.banReason}` : ''}
                                              </div>
                                            )}
                                          </td>
                                          <td className="py-3 px-4 text-right whitespace-nowrap">
                                            <div className="inline-flex items-center justify-end gap-2">
                                              <button
                                                type="button"
                                                disabled={payingRollNo === s.rollNo}
                                                onClick={() =>
                                                  handleMarkStudentPaid(
                                                    s.rollNo,
                                                    undefined,
                                                    paymentEntryDate || todayStr
                                                  )
                                                }
                                                className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                                              >
                                                {payingRollNo === s.rollNo ? 'Saving...' : 'Paid'}
                                              </button>
                                              {s.isBanned ? (
                                                <button
                                                  type="button"
                                                  onClick={() => handleUnbanStudent(s.rollNo)}
                                                  className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-amber-200 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-400/40 rounded-lg cursor-pointer whitespace-nowrap"
                                                >
                                                  Unban
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => handleOpenBanModal(s.rollNo, s.name, s)}
                                                  className="min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-200 bg-rose-600/25 hover:bg-rose-600/40 border border-rose-500/35 rounded-lg cursor-pointer whitespace-nowrap"
                                                >
                                                  <Ban className="w-3 h-3" />
                                                  Ban
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleToggleStudentStatus(
                                                    s.rollNo,
                                                    isActive ? 'suspended' : 'active'
                                                  )
                                                }
                                                className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 rounded-lg cursor-pointer whitespace-nowrap"
                                              >
                                                {isActive ? 'Suspend' : 'Activate'}
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ==================== SUB-PAGE 2: NO-SHOWS ==================== */}
                      {subPageTab === 'noshows' && (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-1">
                              <div className="text-xs font-medium text-zinc-400">Confirmed Today</div>
                              <div className="text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
                                {confirmedTodayBookings.length}
                              </div>
                              <div className="text-[11px] text-zinc-400">Active reservations in window</div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-1">
                              <div className="text-xs font-medium text-zinc-400">Gate Admitted</div>
                              <div className="text-2xl sm:text-3xl font-bold text-emerald-400 font-mono tabular-nums">
                                {admittedBookings.length}
                              </div>
                              <div className="text-[11px] text-zinc-400">Checked in at indoor gate</div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-1">
                              <div className="text-xs font-medium text-zinc-400">No-Show Incidents</div>
                              <div className="text-2xl sm:text-3xl font-bold text-rose-400 font-mono tabular-nums">
                                {noShowBookings.length}
                              </div>
                              <div className="text-[11px] text-zinc-400">Flagged absent by Security</div>
                            </div>
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-1">
                              <div className="text-xs font-medium text-zinc-400">Students With No-Shows</div>
                              <div className="text-2xl sm:text-3xl font-bold text-amber-400 font-mono tabular-nums">
                                {repeatOffenderCount}
                              </div>
                              <div className="text-[11px] text-zinc-400">Tracked per booking captain</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                            {/* Per-Student Attendance Summary */}
                            <div className="xl:col-span-5 bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden">
                              <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3">
                                <h3 className="text-sm font-bold text-white">
                                  Student Attendance Summary
                                </h3>
                                <span className="text-xs font-mono tabular-nums text-zinc-400">
                                  {attendanceSummaryRows.length} captains
                                </span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="bg-black/40 border-b border-white/10 text-xs font-semibold text-zinc-400">
                                      <th className="py-3 px-4">Student</th>
                                      <th className="py-3 px-3 text-right">Booked</th>
                                      <th className="py-3 px-3 text-right">Admitted</th>
                                      <th className="py-3 px-4 text-right">No-Shows</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/[0.06] text-xs">
                                    {attendanceSummaryRows.length === 0 ? (
                                      <tr>
                                        <td colSpan={4} className="py-8 px-4 text-center text-zinc-400">
                                          No bookings logged yet for the active sports day.
                                        </td>
                                      </tr>
                                    ) : (
                                      attendanceSummaryRows.map((row) => (
                                        <tr key={row.rollNo} className="hover:bg-white/[0.03]">
                                          <td className="py-3 px-4">
                                            <div className="font-semibold text-white">{row.name}</div>
                                            <div className="text-[11px] font-mono text-zinc-400">
                                              {row.rollNo} · {row.department}
                                            </div>
                                          </td>
                                          <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200">
                                            {row.confirmed}
                                          </td>
                                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-400">
                                            {row.admitted}
                                          </td>
                                          <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-rose-400">
                                            {row.noShow}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Individual Gate No-Show Log */}
                            <div className="xl:col-span-7 bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden">
                              <div className="p-4 sm:p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                                <h3 className="text-sm font-bold text-white">
                                  Gate No-Show Incidents ({noShowBookings.length})
                                </h3>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadCsv(
                                      `sportx_noshows_${todayStr}.csv`,
                                      ['Code', 'Booking ID', 'Roll No', 'Student', 'Sport', 'Court', 'Slot', 'Gate Notes'],
                                      noShowBookings.map((b) => [
                                        b.bookingCode ?? '',
                                        b.id,
                                        b.bookedByRollNo,
                                        b.bookedByName,
                                        b.sportName,
                                        b.courtName,
                                        b.slotLabel,
                                        b.securityNotes || '',
                                      ])
                                    )
                                  }
                                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 rounded-xl whitespace-nowrap cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Export No-Shows
                                </button>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="bg-black/40 border-b border-white/10 text-xs font-semibold text-zinc-400">
                                      <th className="py-3 px-4">Code / ID</th>
                                      <th className="py-3 px-4">Student</th>
                                      <th className="py-3 px-4">Sport &amp; Court</th>
                                      <th className="py-3 px-4">Slot</th>
                                      <th className="py-3 px-4">Gate Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/[0.06] text-xs">
                                    {noShowBookings.length === 0 ? (
                                      <tr>
                                        <td colSpan={5} className="py-10 px-4 text-center text-zinc-400">
                                          Zero No-Shows recorded for today&apos;s sports day.
                                        </td>
                                      </tr>
                                    ) : (
                                      noShowBookings.map((b) => (
                                        <tr key={b.id} className="hover:bg-white/[0.03]">
                                          <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                                            <div className="font-bold text-rose-400">
                                              #{b.bookingCode ?? '—'}
                                            </div>
                                            <div className="text-[11px] text-zinc-400">{b.id}</div>
                                          </td>
                                          <td className="py-3 px-4 whitespace-nowrap">
                                            <div className="font-semibold text-white">
                                              {b.bookedByName}
                                            </div>
                                            <div className="text-[11px] font-mono text-zinc-400">
                                              {b.bookedByRollNo}
                                            </div>
                                          </td>
                                          <td className="py-3 px-4 whitespace-nowrap text-zinc-200">
                                            {b.sportName} · {b.courtName}
                                          </td>
                                          <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-zinc-300">
                                            {b.slotLabel}
                                          </td>
                                          <td className="py-3 px-4 text-zinc-400">
                                            {b.securityNotes || 'Marked No-Show at Gate'}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ==================== SUB-PAGE 3: LOGIN ACCOUNTS ==================== */}
                      {subPageTab === 'accounts' && (
                        <div className="space-y-5">
                          <div className="bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden">
                            <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="relative flex-1 max-w-md">
                                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                  type="text"
                                  value={loginAccountSearch}
                                  onChange={(e) => setLoginAccountSearch(e.target.value)}
                                  placeholder="Search Roll No, Name, .edu.in Email, Phone, School..."
                                  className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 bg-black/50 border border-white/15 rounded-xl focus:outline-none focus:border-violet-400"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  downloadCsv(
                                    `sportx_login_accounts_${todayStr}.csv`,
                                    ['Roll No', 'ID No', 'Name', 'Email', 'Phone', 'School', 'Year', 'In Roster', 'Roster Status', 'Created At'],
                                    dashboard.loginAccounts.map((a) => [
                                      a.rollNo,
                                      a.idNo || '',
                                      a.name,
                                      a.email,
                                      a.phone,
                                      a.department,
                                      a.year,
                                      a.inRoster ? 'Yes' : 'No',
                                      a.rosterStatus,
                                      a.createdAt,
                                    ])
                                  )
                                }
                                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl whitespace-nowrap cursor-pointer shrink-0"
                              >
                                <Download className="w-3.5 h-3.5" />
                                Export Accounts CSV
                              </button>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-black/40 border-b border-white/10 text-xs font-semibold text-zinc-400">
                                    <th className="py-3.5 px-4">Roll No</th>
                                    <th className="py-3.5 px-4">ID No</th>
                                    <th className="py-3.5 px-4">Student &amp; Details</th>
                                    <th className="py-3.5 px-4">.edu.in Email &amp; Phone</th>
                                    <th className="py-3.5 px-4">School &amp; Year</th>
                                    <th className="py-3.5 px-4">Signed Up</th>
                                    <th className="py-3.5 px-4">Roster Status</th>
                                    <th className="py-3.5 px-4 text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.06] text-xs">
                                  {filteredAccounts.length === 0 ? (
                                    <tr>
                                      <td colSpan={8} className="py-10 px-4 text-center text-zinc-400">
                                        No student login accounts match your search.
                                      </td>
                                    </tr>
                                  ) : (
                                    filteredAccounts.map((acc) => (
                                      <tr key={acc.id} className="hover:bg-white/[0.03] align-top">
                                        <td className="py-3 px-4 font-mono font-bold text-cyan-300 whitespace-nowrap">
                                          {acc.rollNo}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-zinc-300 whitespace-nowrap">
                                          {acc.idNo || '—'}
                                        </td>
                                        <td className="py-3 px-4">
                                          <div className="font-semibold text-white">{acc.name}</div>
                                          {acc.details && (
                                            <div className="text-[11px] text-zinc-400 max-w-xs truncate">
                                              {acc.details}
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-3 px-4 text-zinc-300">
                                          <div>{acc.email}</div>
                                          <div className="font-mono text-[11px] text-zinc-400">
                                            {acc.phone}
                                          </div>
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap text-zinc-300">
                                          <span className="font-semibold text-white">{acc.department}</span> · {acc.year}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[11px] text-zinc-400 whitespace-nowrap tabular-nums">
                                          {acc.createdAt.slice(0, 10)}
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap">
                                          {!acc.inRoster ? (
                                            <span className="font-semibold text-amber-400">
                                              Not on Official Roster
                                            </span>
                                          ) : acc.rosterStatus === 'active' ? (
                                            <div>
                                              <span className="font-semibold text-emerald-400">
                                                Active Pass
                                              </span>
                                              {acc.subscriptionEndDate && (
                                                <div className="text-[11px] font-mono text-zinc-400">
                                                  Until {acc.subscriptionEndDate}
                                                </div>
                                              )}
                                            </div>
                                          ) : acc.rosterStatus === 'expired' ? (
                                            <span className="font-semibold text-rose-400">
                                              Deactivated (Unpaid / Expired)
                                            </span>
                                          ) : (
                                            <span className="font-semibold text-rose-400">
                                              Suspended
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-3 px-4 text-right whitespace-nowrap">
                                          {!acc.inRoster ? (
                                            <button
                                              type="button"
                                              disabled={payingRollNo === acc.rollNo}
                                              onClick={() => handleMarkStudentPaid(acc.rollNo, acc)}
                                              className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg cursor-pointer whitespace-nowrap"
                                            >
                                              {payingRollNo === acc.rollNo ? 'Saving...' : 'Add & Mark Paid'}
                                            </button>
                                          ) : acc.rosterStatus === 'expired' ? (
                                            <button
                                              type="button"
                                              disabled={payingRollNo === acc.rollNo}
                                              onClick={() => handleMarkStudentPaid(acc.rollNo, acc)}
                                              className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg cursor-pointer whitespace-nowrap"
                                            >
                                              {payingRollNo === acc.rollNo ? 'Saving...' : 'Paid'}
                                            </button>
                                          ) : (
                                            <span className="text-[11px] text-zinc-400 font-mono">
                                              Verified
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ==================== TAB 9: SCHEDULES, RULES & ACCESS CODES ==================== */}
              {activeTab === 'policy' && (
                <div className="max-w-5xl space-y-6">
                  <form onSubmit={handleSavePolicy} className="space-y-6">
                  {/* Weekday & Weekend Schedule Editor */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-5">
                    <div className="flex items-start gap-3 border-b border-[#EFEBF9] pb-4">
                      <Clock className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Weekday &amp; Weekend Operating Schedules (12-Hr AM/PM)
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Changes update midday maintenance windows, student slot selectors, and the Court &amp; Slot Matrix automatically across all devices.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {/* Weekdays (Mon–Fri) */}
                      <div className="p-4 bg-[#FAF8FE] border border-[#DFDAFA] rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-slate-900">
                            Weekdays (Mon – Fri)
                          </h3>
                          <span className="text-[11px] font-semibold text-amber-700">
                            Maint: {weekdayPreview.maintenanceRangeLabel}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Morning Opens
                            </label>
                            <select
                              value={policyWdMStart}
                              onChange={(e) => setPolicyWdMStart(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Morning Closes (Maint Starts)
                            </label>
                            <select
                              value={policyWdMEnd}
                              onChange={(e) => setPolicyWdMEnd(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Evening Opens (Maint Ends)
                            </label>
                            <select
                              value={policyWdEStart}
                              onChange={(e) => setPolicyWdEStart(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Evening Closes (Before Paid)
                            </label>
                            <select
                              value={policyWdEEnd}
                              onChange={(e) => setPolicyWdEEnd(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Weekends (Sat–Sun) */}
                      <div className="p-4 bg-[#EBF9FA]/60 border border-[#BCECF0] rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-slate-900">
                            Weekends (Sat – Sun)
                          </h3>
                          <span className="text-[11px] font-semibold text-amber-700">
                            Maint: {weekendPreview.maintenanceRangeLabel}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Morning Opens
                            </label>
                            <select
                              value={policyWeMStart}
                              onChange={(e) => setPolicyWeMStart(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#BCECF0] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Morning Closes (Maint Starts)
                            </label>
                            <select
                              value={policyWeMEnd}
                              onChange={(e) => setPolicyWeMEnd(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#BCECF0] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Evening Opens (Maint Ends)
                            </label>
                            <select
                              value={policyWeEStart}
                              onChange={(e) => setPolicyWeEStart(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#BCECF0] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Evening Closes (Before Paid)
                            </label>
                            <select
                              value={policyWeEEnd}
                              onChange={(e) => setPolicyWeEEnd(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#BCECF0] rounded-lg"
                            >
                              {HALF_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Dual Daily Unlock Hours & Check-In Controls */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-5">
                    <div className="flex items-start gap-3 border-b border-[#EFEBF9] pb-4">
                      <Settings2 className="w-5 h-5 text-[#00A8B5] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Daily Booking Unlocks &amp; Arrival Check-In Rules
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Morning slots open at {formatHourMinute12(policyMorningOpenHour)} and Evening/Late-Night slots open at {formatHourMinute12(policyEveningOpenHour)}.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between gap-4 p-4 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl">
                        <div>
                          <p className="text-xs font-bold text-slate-900">Same-Day Booking Only</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Blocks advance bookings from earlier days.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPolicySameDay((v) => !v)}
                          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                            policySameDay
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {policySameDay ? 'Enforced' : 'Off'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4 p-4 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl">
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Enforce Split Daily Unlock ({formatHourMinute12(policyMorningOpenHour)} / {formatHourMinute12(policyEveningOpenHour)})
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Unlocks morning &amp; evening sessions at configured hours.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPolicyEnforceHour((v) => !v)}
                          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                            policyEnforceHour
                              ? 'bg-emerald-600 text-white'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          {policyEnforceHour ? 'Enforced' : 'Override Open'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Morning Booking Opens
                        </label>
                        <select
                          value={policyMorningOpenHour}
                          onChange={(e) => setPolicyMorningOpenHour(Number(e.target.value))}
                          className="w-full min-h-[42px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        >
                          {HOUR_UNLOCK_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Evening Booking Opens
                        </label>
                        <select
                          value={policyEveningOpenHour}
                          onChange={(e) => setPolicyEveningOpenHour(Number(e.target.value))}
                          className="w-full min-h-[42px] px-3 py-2 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        >
                          {HOUR_UNLOCK_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Early Arrival (Mins)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={policyEarlyMins}
                          onChange={(e) => setPolicyEarlyMins(Number(e.target.value))}
                          className="w-full min-h-[42px] px-3 py-2 text-sm font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          In-Court Window (Mins)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={policyInCourtMins}
                          onChange={(e) => setPolicyInCourtMins(Number(e.target.value))}
                          className="w-full min-h-[42px] px-3 py-2 text-sm font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <Megaphone className="w-3.5 h-3.5 text-[#7D2AE8]" />
                          Live Facility Notice Banner (Shown on all student screens)
                        </span>
                      </label>
                      <textarea
                        rows={2}
                        value={policyAnnouncement}
                        onChange={(e) => setPolicyAnnouncement(e.target.value)}
                        placeholder="Leave blank for no banner, or enter e.g.: Badminton Court 3 closed 4:00 PM–5:00 PM for Varsity Practice."
                        className="w-full p-3 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl"
                      />
                    </div>
                  </div>

                  {/* Admin-Editable Facility Rules Card */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-5">
                    <div className="flex items-start gap-3 border-b border-[#EFEBF9] pb-4">
                      <Sliders className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Student-Facing Facility Rules Editor
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Edit or add rules displayed on the Facility Rules page and the pre-booking confirmation popup.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {policyRules.map((rule, idx) => (
                        <div
                          key={rule.id}
                          className="p-4 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono font-bold text-[#7D2AE8]">
                              Rule #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPolicyRules((prev) => prev.filter((r) => r.id !== rule.id))
                              }
                              className="text-xs text-slate-500 hover:text-rose-600 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          </div>
                          <input
                            type="text"
                            value={rule.title}
                            onChange={(e) =>
                              setPolicyRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id ? { ...r, title: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Rule Title"
                            className="w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                          />
                          <textarea
                            rows={2}
                            value={rule.description}
                            onChange={(e) =>
                              setPolicyRules((prev) =>
                                prev.map((r) =>
                                  r.id === rule.id ? { ...r, description: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Rule Description"
                            className="w-full p-2.5 text-xs text-slate-700 bg-white border border-[#DFDAFA] rounded-lg"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Add New Rule Row */}
                    <div className="p-4 bg-[#FAF8FE] border border-dashed border-[#D3CBFA] rounded-xl space-y-2.5">
                      <p className="text-xs font-bold text-slate-700">Add New Campus Rule</p>
                      <input
                        type="text"
                        value={newRuleTitle}
                        onChange={(e) => setNewRuleTitle(e.target.value)}
                        placeholder="e.g. Non-Marking Footwear Enforcement"
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs text-slate-900 bg-white border border-[#DFDAFA] rounded-lg"
                      />
                      <textarea
                        rows={2}
                        value={newRuleDesc}
                        onChange={(e) => setNewRuleDesc(e.target.value)}
                        placeholder="Rule details shown to students before booking..."
                        className="w-full p-2.5 text-xs text-slate-700 bg-white border border-[#DFDAFA] rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={handleAddRuleItem}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#7D2AE8] bg-[#F3F0FC] hover:bg-[#EAE4FA] border border-[#DFDAFA] rounded-lg cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Rule to List
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="min-h-[48px] px-6 py-3 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 rounded-xl cursor-pointer shadow-xs"
                  >
                    Save &amp; Sync Schedules, Unlock Times &amp; Campus Rules
                  </button>
                </form>

                {/* Access Codes & Passwords Card (Sibling Form inside Schedules & Rules) */}
                <form onSubmit={handleSaveAccessCodes} className="space-y-6 pt-2">
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-5">
                    <div className="flex items-start gap-3 border-b border-[#EFEBF9] pb-4">
                      <KeyRound className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Staff Access Passwords &amp; Authorization Codes
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Manage Admin, Security Gate, Walk-In Desk, Walk-In Cancellation, and Today Training Hours Override credentials alongside campus schedules and rules.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {[
                        {
                          key: 'admin',
                          label: 'Admin Command Console Password',
                          desc: 'Used to unlock the Admin Studio panel from any device.',
                          value: codeAdminPass,
                          onChange: setCodeAdminPass,
                        },
                        {
                          key: 'security',
                          label: 'Security Gate Console Password / PIN',
                          desc: 'Used by Indoor Complex guards to check in students and handle Light Requests.',
                          value: codeSecurityPin,
                          onChange: setCodeSecurityPin,
                        },
                        {
                          key: 'walkin',
                          label: 'Walk-In Desk Access Password',
                          desc: 'Used by reception/sports desk staff to unlock Walk-In Court Reservations.',
                          value: codeWalkInPass,
                          onChange: setCodeWalkInPass,
                        },
                        {
                          key: 'walkinCancel',
                          label: 'Walk-In Cancellation Authorization Code',
                          desc: 'Required on the Walk-In Cancel Booking tab before cancelling any student booking.',
                          value: codeWalkInCancel,
                          onChange: setCodeWalkInCancel,
                        },
                        {
                          key: 'training',
                          label: 'Training Hours Custom Block Authorization Code',
                          desc: 'Required in Walk-In Desk or Security Gate when blocking Today Training Hours.',
                          value: codeTrainingOverride,
                          onChange: setCodeTrainingOverride,
                        },
                      ].map((item) => {
                        const visible = Boolean(showCodeKey[item.key]);
                        return (
                          <div
                            key={item.key}
                            className="p-4 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-0.5">
                              <label className="text-xs font-bold text-slate-900 block">
                                {item.label}
                              </label>
                              <p className="text-[11px] text-slate-500">{item.desc}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type={visible ? 'text' : 'password'}
                                required
                                minLength={4}
                                autoComplete="off"
                                value={item.value}
                                onChange={(e) => item.onChange(e.target.value)}
                                className="w-48 min-h-[40px] px-3 py-1.5 text-xs font-mono text-slate-900 bg-white border border-[#DFDAFA] rounded-lg focus:outline-none focus:border-[#7D2AE8]"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowCodeKey((prev) => ({
                                    ...prev,
                                    [item.key]: !prev[item.key],
                                  }))
                                }
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-white border border-[#DFDAFA] text-slate-600 hover:text-slate-900 cursor-pointer"
                                aria-label={visible ? 'Hide code' : 'Show code'}
                              >
                                {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={savingCodes}
                        className="min-h-[46px] px-6 py-2.5 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-60 rounded-xl cursor-pointer shadow-xs"
                      >
                        {savingCodes
                          ? 'Saving Codes...'
                          : 'Save & Sync All Access Codes Across Devices'}
                      </button>
                    </div>
                  </div>
                </form>
                </div>
              )}

              {/* ==================== TAB 10: GMAIL 6-DIGIT SIGNUP OTP DISPATCH ==================== */}
              {activeTab === 'gmail' && (
                <div className="max-w-5xl space-y-6">
                  {/* Primary Method: Direct Server-Side Gmail SMTP (Works with ANY Gmail 24/7, avoids OAuth 403 Testing Block) */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EFEBF9] pb-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7D2AE8] to-[#00A8B5] flex items-center justify-center text-white shrink-0">
                          <Mail className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-bold text-slate-900">
                              Connect Any Gmail Account (24/7 Automatic OTP Sending)
                            </h2>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Recommended · No Error 403
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            Connect any Gmail address (such as <span className="font-mono text-slate-700">atharvdhan4@gmail.com</span>) using a 16-character Google App Password. Once saved, the SportX server automatically emails the 6-digit verification code the instant a student submits Sign Up — zero manual clicking, even when Admin is logged out.
                          </p>
                        </div>
                      </div>

                      {dashboard.policy.gmailHasAppPassword && dashboard.policy.gmailSenderEmail && (
                        <button
                          type="button"
                          disabled={smtpSaving}
                          onClick={handleDisconnectSmtpGmail}
                          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                        >
                          Disconnect Gmail
                        </button>
                      )}
                    </div>

                    {dashboard.policy.gmailHasAppPassword && dashboard.policy.gmailSenderEmail && (
                      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-emerald-950">
                              Connected:{' '}
                              <span className="font-mono">{dashboard.policy.gmailSenderEmail}</span>
                            </p>
                            <p className="text-[11px] text-emerald-800 mt-0.5">
                              {dashboard.policy.gmailAutoSend
                                ? 'Automatic 24/7 server dispatch is active. Every new .edu.in student sign-up receives their 6-digit code immediately.'
                                : 'Auto-send is currently paused. Click Enable Auto-Send to resume automatic delivery.'}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleToggleSmtpAutoSend(!dashboard.policy.gmailAutoSend)
                          }
                          className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            dashboard.policy.gmailAutoSend
                              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                          }`}
                        >
                          {dashboard.policy.gmailAutoSend ? 'Auto-Send Active' : 'Enable Auto-Send'}
                        </button>
                      </div>
                    )}

                    <form onSubmit={handleConnectSmtpGmail} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Sender Gmail Address
                          </label>
                          <input
                            type="email"
                            required
                            value={smtpEmailInput}
                            onChange={(e) => setSmtpEmailInput(e.target.value)}
                            placeholder="e.g. atharvdhan4@gmail.com"
                            className="w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7D2AE8]/20 focus:border-[#7D2AE8]"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            16-Character Google App Password
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type={showSmtpPassword ? 'text' : 'password'}
                              required={!dashboard.policy.gmailHasAppPassword}
                              autoComplete="off"
                              value={smtpAppPasswordInput}
                              onChange={(e) => setSmtpAppPasswordInput(e.target.value)}
                              placeholder={
                                dashboard.policy.gmailHasAppPassword
                                  ? 'Saved (enter new 16-char password to replace)'
                                  : 'xxxx xxxx xxxx xxxx'
                              }
                              className="flex-1 min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7D2AE8]/20 focus:border-[#7D2AE8]"
                            />
                            <button
                              type="button"
                              onClick={() => setShowSmtpPassword((v) => !v)}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#FAF8FE] border border-[#DFDAFA] text-slate-600 hover:text-slate-900 cursor-pointer shrink-0"
                              aria-label={showSmtpPassword ? 'Hide App Password' : 'Show App Password'}
                            >
                              {showSmtpPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 bg-[#FAF8FE] border border-[#E6E2F8] rounded-xl space-y-1.5 text-xs text-slate-600">
                        <p className="font-bold text-slate-900">
                          How to get your 16-character Google App Password (takes 30 seconds):
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                          <li>
                            Make sure <span className="font-semibold text-slate-800">2-Step Verification</span> is turned ON in your Google Account Security settings.
                          </li>
                          <li>
                            Open{' '}
                            <span className="font-mono font-semibold text-[#7D2AE8]">
                              myaccount.google.com/apppasswords
                            </span>{' '}
                            and create a password named <span className="font-semibold text-slate-800">SportX</span>.
                          </li>
                          <li>
                            Paste the 16-character password above and click <span className="font-semibold text-slate-800">Verify &amp; Connect Gmail</span> (do not use your normal Gmail password).
                          </li>
                        </ol>
                      </div>

                      <button
                        type="submit"
                        disabled={smtpSaving}
                        className="min-h-[46px] inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-60 rounded-xl shadow-xs cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        {smtpSaving
                          ? 'Verifying Gmail SMTP...'
                          : dashboard.policy.gmailHasAppPassword
                            ? 'Update & Verify Gmail Auto-Send'
                            : 'Verify & Connect Gmail (Auto-Send)'}
                      </button>
                    </form>
                  </div>

                  {/* Alternative Fallback: Browser Google OAuth */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EFEBF9] pb-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Alternative: Sign in with Google (OAuth Browser Session)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Note: While Google OAuth is in Testing Mode, unapproved Gmail accounts receive{' '}
                          <span className="font-mono font-semibold text-slate-700">
                            Error 403: access_denied
                          </span>
                          . Use the Gmail App Password setup above to connect any Gmail address immediately.
                        </p>
                      </div>

                      {gmailConnectedEmail && getGmailAccessToken() ? (
                        <button
                          type="button"
                          onClick={handleDisconnectGmail}
                          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Disconnect OAuth
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={gmailConnecting}
                          onClick={handleConnectGmailSignIn}
                          className="min-h-[42px] inline-flex items-center gap-3 px-4 py-2 bg-white hover:bg-slate-50 border border-[#747775] rounded-full text-[13px] font-medium text-[#1F1F1F] shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 48 48"
                            xmlns="http://www.w3.org/2000/svg"
                            className="shrink-0"
                          >
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                          </svg>
                          <span>
                            {gmailConnecting ? 'Connecting Google...' : 'Sign in with Google'}
                          </span>
                        </button>
                      )}
                    </div>

                    {gmailConnectedEmail && getGmailAccessToken() && (
                      <div className="p-3.5 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs font-mono font-bold text-slate-900 truncate">
                            {gmailConnectedEmail}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleGmailAutoSend(!gmailAutoSendConfirmed)}
                          className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
                            gmailAutoSendConfirmed
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                          }`}
                        >
                          {gmailAutoSendConfirmed ? 'OAuth Auto-Send Active' : 'Enable OAuth Auto-Send'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Live Sign-Up Verification Code Dispatch Queue */}
                  <div className="bg-white border border-[#E6E2F8] rounded-2xl shadow-xs overflow-hidden">
                    <div className="px-5 py-4 border-b border-[#EFEBF9] flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Recent Student Sign-Up Verification Codes ({dashboard.signupOtps?.length || 0})
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Live automatic dispatch log. Students cannot create accounts until their 6-digit code is verified.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => adminToken && fetchDashboard(adminToken)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-[#F3F0FC] hover:bg-[#EAE4FA] rounded-lg cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#FAF8FE] border-b border-[#EFEBF9] text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="py-3 px-4">Student</th>
                            <th className="py-3 px-4">Roll No</th>
                            <th className="py-3 px-4">.edu.in Email</th>
                            <th className="py-3 px-4">Delivery Status</th>
                            <th className="py-3 px-4">Sender</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFEBF9] text-xs">
                          {(!dashboard.signupOtps || dashboard.signupOtps.length === 0) ? (
                            <tr>
                              <td colSpan={6} className="py-10 text-center text-slate-500">
                                No sign-up verification code requests recorded yet.
                              </td>
                            </tr>
                          ) : (
                            dashboard.signupOtps.map((otp) => (
                              <tr key={otp.id} className="hover:bg-[#FAF8FE]/70">
                                <td className="py-3 px-4 font-semibold text-slate-900">
                                  {otp.name}
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-slate-800">
                                  {otp.rollNo}
                                </td>
                                <td className="py-3 px-4 font-mono text-slate-600">
                                  {otp.email}
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`font-semibold ${
                                      otp.status === 'verified'
                                        ? 'text-emerald-700'
                                        : otp.status === 'sent'
                                          ? 'text-sky-700'
                                          : otp.status === 'failed'
                                            ? 'text-rose-700'
                                            : 'text-amber-700'
                                    }`}
                                  >
                                    {otp.status === 'verified'
                                      ? 'Verified & Account Created'
                                      : otp.status === 'sent'
                                        ? 'Auto-Sent via Gmail'
                                        : otp.status === 'sending'
                                          ? 'Sending...'
                                          : otp.status === 'failed'
                                            ? `Failed${otp.lastError ? `: ${otp.lastError}` : ''}`
                                            : 'Awaiting Gmail Connection'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                                  {otp.sentFromEmail || '—'}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {otp.status !== 'verified' && (
                                    <button
                                      type="button"
                                      disabled={sendingOtpId === otp.id}
                                      onClick={() => {
                                        if (dashboard.policy.gmailHasAppPassword) {
                                          handleDirectSmtpResend(otp);
                                        } else {
                                          setConfirmManualOtpSend(otp);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#7D2AE8] bg-[#F3F0FC] hover:bg-[#EAE4FA] border border-[#DFDAFA] rounded-lg cursor-pointer disabled:opacity-60"
                                    >
                                      <Send className="w-3 h-3" />
                                      {sendingOtpId === otp.id
                                        ? 'Sending...'
                                        : otp.status === 'sent'
                                          ? 'Resend'
                                          : 'Send Now'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal 1: Confirm Enabling Gmail Auto-Send */}
              {confirmAutoEnableModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
                  <div className="w-full max-w-md bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-start gap-3">
                      <Mail className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Confirm Gmail Auto-Send Authorization
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Connected Gmail:{' '}
                          <span className="font-mono font-bold text-slate-900">
                            {gmailPendingConfirmEmail || gmailConnectedEmail}
                          </span>
                          . By confirming, SportX will send 6-digit verification code emails on your behalf whenever new students submit Sign Up.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={handleCancelGmailAutoEnable}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmEnableGmailAutoSend}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 rounded-xl cursor-pointer"
                      >
                        Confirm &amp; Enable Auto-Send
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal 2: Explicit Confirmation Before Manual Email Send */}
              {confirmManualOtpSend && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
                  <div className="w-full max-w-md bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-start gap-3">
                      <Send className="w-5 h-5 text-[#7D2AE8] shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Send 6-Digit Verification Email?
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Send a 6-digit sign-up verification code to{' '}
                          <span className="font-mono font-bold text-slate-900">
                            {confirmManualOtpSend.email}
                          </span>{' '}
                          ({confirmManualOtpSend.rollNo}) using{' '}
                          <span className="font-mono font-semibold text-slate-900">
                            {gmailConnectedEmail || 'Connected Gmail'}
                          </span>
                          ?
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        disabled={Boolean(sendingOtpId)}
                        onClick={() => setConfirmManualOtpSend(null)}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(sendingOtpId)}
                        onClick={handleConfirmManualOtpSend}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#7D2AE8] to-[#00A8B5] hover:opacity-95 disabled:opacity-60 rounded-xl cursor-pointer"
                      >
                        {sendingOtpId ? 'Sending Email...' : 'Confirm & Send Email'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Modal 3: Temporary Sports Ban */}
              {banTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
                  <form
                    onSubmit={handleApplyBan}
                    className="w-full max-w-lg bg-white border border-[#E6E2F8] rounded-2xl p-6 shadow-xl space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <Ban className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="text-base font-bold text-slate-900">
                            Temporary Sports Ban
                          </h3>
                          <p className="text-xs text-slate-600 mt-0.5">
                            {banTarget.name} (<span className="font-mono font-semibold">{banTarget.rollNo}</span>) cannot book or be added as a teammate for banned sport(s).
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBanTarget(null)}
                        className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                        aria-label="Close ban dialog"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Duration (Days)
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {[1, 3, 7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setBanDays(d)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                              banDays === d
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-[#FAF8FE] text-slate-700 border-[#DFDAFA] hover:border-rose-300'
                            }`}
                          >
                            {d} {d === 1 ? 'Day' : 'Days'}
                          </button>
                        ))}
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={banDays}
                          onChange={(e) => setBanDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                          className="w-20 min-h-[34px] px-2.5 py-1 text-xs font-mono text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Ban Scope
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setBanScope('all')}
                          className={`min-h-[38px] px-3 py-2 text-xs font-semibold rounded-xl border cursor-pointer ${
                            banScope === 'all'
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-[#FAF8FE] text-slate-700 border-[#DFDAFA]'
                          }`}
                        >
                          All Sports
                        </button>
                        <button
                          type="button"
                          onClick={() => setBanScope('selected')}
                          className={`min-h-[38px] px-3 py-2 text-xs font-semibold rounded-xl border cursor-pointer ${
                            banScope === 'selected'
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-[#FAF8FE] text-slate-700 border-[#DFDAFA]'
                          }`}
                        >
                          Selected Sports Only
                        </button>
                      </div>

                      {banScope === 'selected' && dashboard && (
                        <div className="pt-2 flex flex-wrap gap-2">
                          {dashboard.sports.map((sp) => {
                            const checked = banSportIds.includes(sp.id);
                            return (
                              <button
                                key={sp.id}
                                type="button"
                                onClick={() =>
                                  setBanSportIds((prev) =>
                                    checked ? prev.filter((id) => id !== sp.id) : [...prev, sp.id]
                                  )
                                }
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                                  checked
                                    ? 'bg-rose-50 text-rose-700 border-rose-400'
                                    : 'bg-slate-50 text-slate-700 border-slate-200'
                                }`}
                              >
                                {checked ? '✓ ' : ''}
                                {sp.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Reason (Optional)
                      </label>
                      <input
                        type="text"
                        value={banReason}
                        onChange={(e) => setBanReason(e.target.value)}
                        placeholder="e.g. Repeated no-show or court rule violation"
                        className="w-full min-h-[40px] px-3 py-2 text-xs text-slate-900 bg-[#FAF8FE] border border-[#DFDAFA] rounded-xl focus:outline-none focus:border-rose-500"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        disabled={savingBan}
                        onClick={() => setBanTarget(null)}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingBan}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-xl cursor-pointer"
                      >
                        {savingBan ? 'Applying Ban...' : 'Apply Ban'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
