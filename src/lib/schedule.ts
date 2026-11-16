import type { BookingPolicy, TimeSlot } from '../types.ts';

export const ALL_TIME_SLOTS: TimeSlot[] = [
  { id: '05:00', label: '5:00 AM – 6:00 AM', shortLabel: '5–6 AM', startHour: 5, isLateNight: false },
  { id: '06:00', label: '6:00 AM – 7:00 AM', shortLabel: '6–7 AM', startHour: 6, isLateNight: false },
  { id: '07:00', label: '7:00 AM – 8:00 AM', shortLabel: '7–8 AM', startHour: 7, isLateNight: false },
  { id: '08:00', label: '8:00 AM – 9:00 AM', shortLabel: '8–9 AM', startHour: 8, isLateNight: false },
  { id: '09:00', label: '9:00 AM – 10:00 AM', shortLabel: '9–10 AM', startHour: 9, isLateNight: false },
  { id: '10:00', label: '10:00 AM – 11:00 AM', shortLabel: '10–11 AM', startHour: 10, isLateNight: false },
  { id: '11:00', label: '11:00 AM – 12:00 PM', shortLabel: '11–12 PM', startHour: 11, isLateNight: false },
  { id: '12:00', label: '12:00 PM – 1:00 PM', shortLabel: '12–1 PM', startHour: 12, isLateNight: false },
  { id: '13:00', label: '1:00 PM – 2:00 PM', shortLabel: '1–2 PM', startHour: 13, isLateNight: false },
  { id: '14:00', label: '2:00 PM – 3:00 PM', shortLabel: '2–3 PM', startHour: 14, isLateNight: false },
  { id: '15:00', label: '3:00 PM – 4:00 PM', shortLabel: '3–4 PM', startHour: 15, isLateNight: false },
  { id: '16:00', label: '4:00 PM – 5:00 PM', shortLabel: '4–5 PM', startHour: 16, isLateNight: false },
  { id: '17:00', label: '5:00 PM – 6:00 PM', shortLabel: '5–6 PM', startHour: 17, isLateNight: false },
  { id: '18:00', label: '6:00 PM – 7:00 PM', shortLabel: '6–7 PM', startHour: 18, isLateNight: false },
  { id: '19:00', label: '7:00 PM – 8:00 PM', shortLabel: '7–8 PM', startHour: 19, isLateNight: false },
  { id: '20:00', label: '8:00 PM – 9:00 PM', shortLabel: '8–9 PM', startHour: 20, isLateNight: false },
  { id: '21:00', label: '9:00 PM – 10:00 PM', shortLabel: '9–10 PM', startHour: 21, isLateNight: false },
  { id: '22:00', label: '10:00 PM – 11:00 PM', shortLabel: '10–11 PM', startHour: 22, isLateNight: false },
  { id: '23:00', label: '11:00 PM – 12:00 AM', shortLabel: '11–12 AM', startHour: 23, isLateNight: true },
  { id: '00:00', label: '12:00 AM – 1:00 AM', shortLabel: '12–1 AM', startHour: 0, isLateNight: true },
  { id: '01:00', label: '1:00 AM – 2:00 AM', shortLabel: '1–2 AM', startHour: 1, isLateNight: true },
  { id: '02:00', label: '2:00 AM – 3:00 AM', shortLabel: '2–3 AM', startHour: 2, isLateNight: true },
  { id: '03:00', label: '3:00 AM – 4:00 AM', shortLabel: '3–4 AM', startHour: 3, isLateNight: true },
];

export const SPORTS_DAY_ROLLOVER_MINUTES = 4 * 60 + 30; // 4:30 AM daily operational rollover (30m before 5 AM open)
export const BOOKING_CODE_RESET_MINUTES = 4 * 60; // 4:00 AM daily booking-code (#100) reset

/**
 * Operational Sports-Day date string (local browser clock).
 * Rolls over at 4:30 AM rather than midnight so 11:00 PM – 4:00 AM slots
 * stay tied to the same evening session and clear out 30m before 5:00 AM open.
 */
export function getSportsDayString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - SPORTS_DAY_ROLLOVER_MINUTES * 60_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Server-side Sports-Day date string given client tzOffsetMinutes (from Date.getTimezoneOffset()).
 */
export function getSportsDayFromOffset(tzOffsetMinutes = 0, nowMs = Date.now()): string {
  const clampedOffset = Math.max(-720, Math.min(840, Number(tzOffsetMinutes) || 0));
  const localShiftedMs =
    nowMs - clampedOffset * 60_000 - SPORTS_DAY_ROLLOVER_MINUTES * 60_000;
  const dt = new Date(localShiftedMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 4:00 AM cycle date string used strictly for resetting daily booking codes (#100, #101, ...).
 * Preserves all underlying booking history while starting booking numbers fresh at 100 at 4:00 AM.
 */
export function getFourAmCodeCycleDate(tzOffsetMinutes = 0, nowMs = Date.now()): string {
  const clampedOffset = Math.max(-720, Math.min(840, Number(tzOffsetMinutes) || 0));
  const localShiftedMs =
    nowMs - clampedOffset * 60_000 - BOOKING_CODE_RESET_MINUTES * 60_000;
  const dt = new Date(localShiftedMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns YYYY-MM-DD for `daysAgo` calendar days before the current sports day.
 * With `daysAgo = 29`, records with `date >= cutoff` form a 30-day inclusive window (today + 29 prior days);
 * any record with `date < cutoff` is on day 31+ and eligible for permanent purge.
 */
export function getDateDaysAgoString(
  daysAgo: number,
  tzOffsetMinutes = 0,
  nowMs = Date.now()
): string {
  const baseDate = getSportsDayFromOffset(tzOffsetMinutes, nowMs);
  const [y, m, d] = baseDate.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d) - Math.max(0, Math.floor(daysAgo)) * 86_400_000;
  const dt = new Date(utc);
  const ry = dt.getUTCFullYear();
  const rm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

/**
 * Maps clock hours 00:00..04:29 to continuous evening hours 24..28 so
 * post-11 PM / post-midnight bookings stay unlocked past 12:00 AM until 4:30 AM rollover.
 */
export function getSportsDayEffectiveHour(hour24: number, minute = 0): number {
  const h = ((Math.floor(hour24) % 24) + 24) % 24;
  if (h < 4 || (h === 4 && minute < 30)) {
    return h + 24;
  }
  return h;
}

export function formatHourMinute12(hour24: number, minute = 0): string {
  const hNorm = ((hour24 % 24) + 24) % 24;
  const period = hNorm >= 12 ? 'PM' : 'AM';
  const h12 = hNorm % 12 === 0 ? 12 : hNorm % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatTotalMinutes12(totalMinutes: number): string {
  const mNorm = ((totalMinutes % 1440) + 1440) % 1440;
  return formatHourMinute12(Math.floor(mNorm / 60), mNorm % 60);
}

export function formatCompactTotalMinutes12(startMins: number, endMins: number): string {
  const sNorm = ((startMins % 1440) + 1440) % 1440;
  const eNorm = ((endMins % 1440) + 1440) % 1440;
  const sH = Math.floor(sNorm / 60);
  const sM = sNorm % 60;
  const eH = Math.floor(eNorm / 60);
  const eM = eNorm % 60;
  const s12 = sH % 12 === 0 ? 12 : sH % 12;
  const e12 = eH % 12 === 0 ? 12 : eH % 12;
  const ePeriod = eH >= 12 ? 'PM' : 'AM';
  const sStr = sM === 0 ? `${s12}` : `${s12}:${String(sM).padStart(2, '0')}`;
  const eStr = eM === 0 ? `${e12}` : `${e12}:${String(eM).padStart(2, '0')}`;
  return `${sStr}–${eStr} ${ePeriod}`;
}

export function parseHHMMToMinutes(hhmm: string | undefined, fallbackMins: number): number {
  if (!hhmm || !hhmm.includes(':')) return fallbackMins;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallbackMins;
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
}

export function isWeekendDate(dateStr: string): boolean {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = dt.getDay();
  return day === 0 || day === 6;
}

export interface DayScheduleWindows {
  isWeekend: boolean;
  morningStartMins: number;
  morningEndMins: number;
  eveningStartMins: number;
  eveningEndMins: number;
  morningRangeLabel: string;
  maintenanceRangeLabel: string;
  eveningRangeLabel: string;
  morningUnlockHour: number;
  eveningUnlockHour: number;
  morningUnlockLabel: string;
  eveningUnlockLabel: string;
}

export function getDayScheduleWindows(
  dateStr: string,
  policy: Partial<BookingPolicy>
): DayScheduleWindows {
  const weekend = isWeekendDate(dateStr);
  const morningStartMins = weekend
    ? parseHHMMToMinutes(policy.weekendMorningStart, 5 * 60)
    : parseHHMMToMinutes(policy.weekdayMorningStart, 5 * 60);
  const morningEndMins = weekend
    ? parseHHMMToMinutes(policy.weekendMorningEnd, 12 * 60)
    : parseHHMMToMinutes(policy.weekdayMorningEnd, 9 * 60 + 30);
  const eveningStartMins = weekend
    ? parseHHMMToMinutes(policy.weekendEveningStart, 17 * 60)
    : parseHHMMToMinutes(policy.weekdayEveningStart, 16 * 60);
  const eveningEndMins = weekend
    ? parseHHMMToMinutes(policy.weekendEveningEnd, 23 * 60)
    : parseHHMMToMinutes(policy.weekdayEveningEnd, 23 * 60);

  const morningUnlockHour = policy.morningBookingOpenHour ?? 3;
  const eveningUnlockHour = policy.eveningBookingOpenHour ?? policy.openingHour ?? 8;

  return {
    isWeekend: weekend,
    morningStartMins,
    morningEndMins,
    eveningStartMins,
    eveningEndMins,
    morningRangeLabel: `${formatTotalMinutes12(morningStartMins)} – ${formatTotalMinutes12(morningEndMins)}`,
    maintenanceRangeLabel: `${formatTotalMinutes12(morningEndMins)} – ${formatTotalMinutes12(eveningStartMins)}`,
    eveningRangeLabel: `${formatTotalMinutes12(eveningStartMins)} – ${formatTotalMinutes12(eveningEndMins)}`,
    morningUnlockHour,
    eveningUnlockHour,
    morningUnlockLabel: formatHourMinute12(morningUnlockHour, 0),
    eveningUnlockLabel: formatHourMinute12(eveningUnlockHour, 0),
  };
}

export type SlotOperationalType = 'morning' | 'evening' | 'late-night' | 'maintenance';

export interface SlotOperationalInfo {
  type: SlotOperationalType;
  isMaintenance: boolean;
  effectiveLabel: string;
  effectiveShortLabel: string;
  unlockHour: number;
  unlockLabel: string;
}

export function getSlotOperationalState(
  slot: TimeSlot,
  dateStr: string,
  policy: Partial<BookingPolicy>
): SlotOperationalInfo {
  const win = getDayScheduleWindows(dateStr, policy);

  if (slot.isLateNight || slot.startHour >= 23 || slot.startHour < 4) {
    return {
      type: 'late-night',
      isMaintenance: false,
      effectiveLabel: slot.label,
      effectiveShortLabel: slot.shortLabel,
      unlockHour: win.eveningUnlockHour,
      unlockLabel: win.eveningUnlockLabel,
    };
  }

  const slotStart = slot.startHour * 60;
  const slotEnd = slotStart + 60;

  // Check morning open window (supports half-hour cutoff like 9:30 AM!)
  if (slotStart >= win.morningStartMins && slotStart < win.morningEndMins) {
    const cappedEnd = Math.min(slotEnd, win.morningEndMins);
    return {
      type: 'morning',
      isMaintenance: false,
      effectiveLabel: `${formatTotalMinutes12(slotStart)} – ${formatTotalMinutes12(cappedEnd)}`,
      effectiveShortLabel: formatCompactTotalMinutes12(slotStart, cappedEnd),
      unlockHour: win.morningUnlockHour,
      unlockLabel: win.morningUnlockLabel,
    };
  }

  // Check evening open window
  if (slotStart >= win.eveningStartMins && slotStart < win.eveningEndMins) {
    const cappedEnd = Math.min(slotEnd, win.eveningEndMins);
    return {
      type: 'evening',
      isMaintenance: false,
      effectiveLabel: `${formatTotalMinutes12(slotStart)} – ${formatTotalMinutes12(cappedEnd)}`,
      effectiveShortLabel: formatCompactTotalMinutes12(slotStart, cappedEnd),
      unlockHour: win.eveningUnlockHour,
      unlockLabel: win.eveningUnlockLabel,
    };
  }

  // Otherwise falls in midday maintenance or before morning open
  return {
    type: 'maintenance',
    isMaintenance: true,
    effectiveLabel: slot.label,
    effectiveShortLabel: slot.shortLabel,
    unlockHour: win.eveningUnlockHour,
    unlockLabel: win.eveningUnlockLabel,
  };
}

/**
 * Circularly orders slots so that the current real-world hour sits at index 2 (3rd column from left).
 */
export function getLiveCenteredSlots(slots: TimeSlot[], nowHour: number): TimeSlot[] {
  if (slots.length <= 3) return slots;
  const idx = slots.findIndex((s) => s.startHour === nowHour);
  const anchorIdx = idx === -1 ? 0 : idx;
  const startIdx = (anchorIdx - 2 + slots.length) % slots.length;
  return [...slots.slice(startIdx), ...slots.slice(0, startIdx)];
}
