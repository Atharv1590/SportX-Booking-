import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Megaphone,
  Plus,
  Radio,
  Search,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  BlockedSlot,
  Booking,
  BookingPolicy,
  PlayerValidationResult,
  PublicSlotBooking,
  RosterEntry,
  Sport,
  Student,
  TimeSlot,
} from '../types';
import { getStudentPreferences, type SavedTeammatePref } from '../lib/preferences';
import {
  formatHourMinute12,
  getDayScheduleWindows,
  getSlotOperationalState,
  getSportsDayEffectiveHour,
  getSportsDayString,
} from '../lib/schedule';
import { SPORT_IMAGES } from '../sportImages';
import { RulesModal } from './RulesModal';

interface TeammateRow {
  rollNo: string;
  name: string;
}

export interface BookingPrefillPayload {
  sportId: string;
  courtId?: string;
  slotId?: string;
  teammates?: TeammateRow[];
}

interface BookingPortalProps {
  student: Student;
  sports: Sport[];
  timeSlots: TimeSlot[];
  policy: BookingPolicy;
  syncConnected: boolean;
  syncVersion: number;
  prefillBooking?: BookingPrefillPayload | null;
  onClearPrefill?: () => void;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onBookingCreated: (booking: Booking) => void;
  resetKey?: number;
}

type BookingStep = 'sports' | 'court-slot' | 'teammates';

export function BookingPortal({
  student,
  sports,
  timeSlots,
  policy,
  syncConnected,
  syncVersion,
  prefillBooking,
  onClearPrefill,
  authFetch,
  onBookingCreated,
  resetKey = 0,
}: BookingPortalProps) {
  const [step, setStep] = useState<BookingStep>('sports');
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  useEffect(() => {
    setStep('sports');
    setFormError(null);
    setRulesModalOpen(false);
  }, [resetKey]);

  const todayDate = useMemo(() => getSportsDayString(nowClock), [nowClock]);

  const effectiveHour = getSportsDayEffectiveHour(nowClock.getHours(), nowClock.getMinutes());
  const dayWindows = useMemo(
    () => getDayScheduleWindows(todayDate, policy),
    [todayDate, policy]
  );
  const isBeforeMorningUnlock =
    policy.enforceOpeningHour && effectiveHour < dayWindows.morningUnlockHour;
  const isBeforeEveningUnlock =
    policy.enforceOpeningHour && effectiveHour < dayWindows.eveningUnlockHour;

  const initialPrefs = useMemo(
    () => getStudentPreferences(student.rollNo),
    [student.rollNo]
  );

  const [selectedSportId, setSelectedSportId] = useState<string>(
    initialPrefs.favoriteSportId || sports[0]?.id || 'badminton'
  );
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const [bookingsForToday, setBookingsForToday] = useState<PublicSlotBooking[]>([]);
  const [blockedForToday, setBlockedForToday] = useState<BlockedSlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const [teammates, setTeammates] = useState<TeammateRow[]>([{ rollNo: '', name: '' }]);
  const [validationResults, setValidationResults] = useState<PlayerValidationResult[]>([]);
  const [validatingIds, setValidatingIds] = useState(false);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterQuery, setRosterQuery] = useState('');
  const [savedTeammates, setSavedTeammates] = useState<SavedTeammatePref[]>(
    () => initialPrefs.savedTeammates
  );

  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card'>('upi');
  const [upiId, setUpiId] = useState(() => initialPrefs.defaultUpiId || '');
  const [cardHolder, setCardHolder] = useState(student.name);
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const prefs = getStudentPreferences(student.rollNo);
    setSavedTeammates(prefs.savedTeammates);
    if (!upiId && prefs.defaultUpiId) {
      setUpiId(prefs.defaultUpiId);
    }
  }, [student.rollNo, upiId]);

  // Consume direct booking prefill from Live Court Radar
  useEffect(() => {
    if (!prefillBooking || sports.length === 0) return;
    const targetSport = sports.find((s) => s.id === prefillBooking.sportId);
    if (!targetSport) return;

    const chosenCourt =
      (prefillBooking.courtId &&
        targetSport.courts.find((c) => c.id === prefillBooking.courtId)) ||
      targetSport.courts.find((c) => c.status === 'operational') ||
      targetSport.courts[0];

    setSelectedSportId(targetSport.id);
    setSelectedCourtId(chosenCourt?.id || '');
    setSelectedSlotId(prefillBooking.slotId || null);

    const others = (prefillBooking.teammates || []).filter(
      (t) => t.rollNo.toUpperCase() !== student.rollNo.toUpperCase()
    );
    const needed = Math.max(1, targetSport.minPlayers - 1);
    const padded = [...others];
    while (padded.length < needed) {
      padded.push({ rollNo: '', name: '' });
    }
    setTeammates(padded.slice(0, targetSport.maxPlayers - 1));
    setFormError(null);
    setStep('court-slot');
    onClearPrefill?.();
  }, [prefillBooking, sports, student.rollNo, onClearPrefill]);

  // Update clock every 30s for 8:00 AM window transition
  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const selectedSport = useMemo(
    () => sports.find((s) => s.id === selectedSportId) || sports[0],
    [sports, selectedSportId]
  );

  const selectedCourt = useMemo(
    () =>
      selectedSport?.courts.find((c) => c.id === selectedCourtId) ||
      selectedSport?.courts.find((c) => c.status === 'operational') ||
      selectedSport?.courts[0],
    [selectedSport, selectedCourtId]
  );

  const selectedSlot = useMemo(
    () => timeSlots.find((t) => t.id === selectedSlotId) || null,
    [timeSlots, selectedSlotId]
  );

  const fetchAvailability = useCallback(async () => {
    setLoadingAvailability(true);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res = await authFetch(
        `/api/availability?date=${encodeURIComponent(todayDate)}&tzOffset=${tzOffset}`
      );
      if (res.ok) {
        const data = await res.json();
        setBookingsForToday(data.bookings || []);
        setBlockedForToday(data.blockedSlots || []);
      }
    } catch {
      // handled on next sync
    } finally {
      setLoadingAvailability(false);
    }
  }, [todayDate, authFetch]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability, syncVersion]);

  // Refetch on tab wake / mobile focus so devices never show stale state
  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAvailability();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [fetchAvailability]);

  // Keep roster directory synced when syncVersion bumps
  useEffect(() => {
    authFetch('/api/students/directory')
      .then((r) => (r.ok ? r.json() : { students: [] }))
      .then((d) => setRoster(d.students || []))
      .catch(() => {});
  }, [syncVersion, authFetch]);

  // Reset teammates cleanly when entering a sport
  const handleSelectSport = (sport: Sport) => {
    setSelectedSportId(sport.id);
    const firstOp =
      sport.courts.find((c) => c.status === 'operational') || sport.courts[0];
    setSelectedCourtId(firstOp?.id || '');
    setSelectedSlotId(null);
    setFormError(null);

    const neededTeammates = Math.max(1, sport.minPlayers - 1);
    setTeammates(Array.from({ length: neededTeammates }, () => ({ rollNo: '', name: '' })));
    setStep('court-slot');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const rollValidationKey = useMemo(
    () => teammates.map((t) => t.rollNo.trim().toUpperCase()).join('|'),
    [teammates]
  );

  // Automated active-ID validation whenever teammate Roll Nos, sport, or slot change
  useEffect(() => {
    if (step !== 'teammates') return;
    const rollsToCheck = rollValidationKey.split('|');
    const allRolls = [student.rollNo, ...rollsToCheck];

    const timer = setTimeout(async () => {
      setValidatingIds(true);
      try {
        const res = await authFetch('/api/students/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: todayDate,
            slotId: selectedSlotId || '08:00',
            sportId: selectedSport?.id,
            playerRollNos: allRolls,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const results: PlayerValidationResult[] = data.results || [];
          setValidationResults(results);

          setTeammates((prev) => {
            let changed = false;
            const next = prev.map((row, idx) => {
              const r = results[idx + 1];
              if (r && r.valid && r.studentName && row.name !== r.studentName) {
                changed = true;
                return { ...row, name: r.studentName };
              }
              return row;
            });
            return changed ? next : prev;
          });
        }
      } catch {
        // ignore transient errors
      } finally {
        setValidatingIds(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [
    step,
    student.rollNo,
    rollValidationKey,
    todayDate,
    selectedSlotId,
    selectedSport?.id,
    syncVersion,
    authFetch,
  ]);

  const getSlotStatus = useCallback(
    (sportId: string, courtId: string, courtStatus: string, slotId: string) => {
      if (courtStatus === 'maintenance') {
        return { state: 'maintenance' as const, label: 'Maintenance' };
      }
      const blk = blockedForToday.find(
        (b) => b.sportId === sportId && b.courtId === courtId && b.slotId === slotId
      );
      if (blk) {
        const isTraining = blk.reason.toLowerCase().includes('training');
        return {
          state: 'blocked' as const,
          label: isTraining ? 'Training Blocked' : 'Blocked',
          detail: blk.reason,
        };
      }
      const existing = bookingsForToday.find(
        (b) => b.sportId === sportId && b.courtId === courtId && b.slotId === slotId
      );
      if (existing) {
        return {
          state: 'booked' as const,
          label: 'Booked',
          detail: `${existing.bookedByName} (${existing.bookedByRollNo})`,
        };
      }
      return { state: 'free' as const, label: 'Available' };
    },
    [blockedForToday, bookingsForToday]
  );

  // If another phone books our currently selected slot while we're in Step 2 or Step 3, notify immediately
  const selectedSlotLiveConflict = useMemo(() => {
    if (!selectedSport || !selectedCourt || !selectedSlotId) return null;
    const st = getSlotStatus(
      selectedSport.id,
      selectedCourt.id,
      selectedCourt.status,
      selectedSlotId
    );
    return st.state !== 'free' ? st : null;
  }, [selectedSport, selectedCourt, selectedSlotId, getSlotStatus]);

  const getFreeSlotsCountForSport = (sport: Sport): number => {
    let free = 0;
    for (const court of sport.courts) {
      if (court.status !== 'operational') continue;
      for (const slot of timeSlots) {
        const slotOp = getSlotOperationalState(slot, todayDate, policy);
        if (slotOp.isMaintenance) continue;
        const st = getSlotStatus(sport.id, court.id, court.status, slot.id);
        if (st.state === 'free') free += 1;
      }
    }
    return free;
  };

  const selectedSlotOp = useMemo(
    () => (selectedSlot ? getSlotOperationalState(selectedSlot, todayDate, policy) : null),
    [selectedSlot, todayDate, policy]
  );

  const isSelectedSlotLockedByHour = Boolean(
    selectedSlotOp && policy.enforceOpeningHour && effectiveHour < selectedSlotOp.unlockHour
  );

  const isStudentRosterActive = student.status === 'active';
  const captainBannedForSelectedSport = Boolean(
    student.isBanned &&
      (student.banScope === 'all' ||
        (selectedSport && (student.bannedSports || []).includes(selectedSport.id)))
  );

  const getRosterLockMessage = useCallback(() => {
    if (captainBannedForSelectedSport) {
      return student.banScope === 'all'
        ? `Roll No ${student.rollNo} is temporarily banned across all sports through ${student.banUntil}${
            student.banReason ? ` (${student.banReason})` : ''
          }.`
        : `Roll No ${student.rollNo} is temporarily banned from ${selectedSport?.name || 'this sport'} through ${student.banUntil}${
            student.banReason ? ` (${student.banReason})` : ''
          }.`;
    }
    if (student.status === 'expired') {
      return `Your 1-year Sports Roster subscription expired${student.subscriptionEndDate ? ` on ${student.subscriptionEndDate}` : ''}. Contact Sports Admin to renew before booking.`;
    }
    if (student.status === 'suspended') {
      return `Roll No ${student.rollNo} is suspended in the Sports Roster and cannot book courts.`;
    }
    return `Roll No ${student.rollNo} is not active in the official Sports Roster yet. Contact Sports Admin to activate your 1-year pass before booking.`;
  }, [
    captainBannedForSelectedSport,
    student.banScope,
    student.banUntil,
    student.banReason,
    student.rollNo,
    student.status,
    student.subscriptionEndDate,
    selectedSport?.name,
  ]);

  const handleProceedToTeammates = () => {
    if (!isStudentRosterActive || captainBannedForSelectedSport) {
      setFormError(getRosterLockMessage());
      return;
    }
    if (
      !selectedSlot ||
      !selectedSlotOp ||
      selectedSlotOp.isMaintenance ||
      isSelectedSlotLockedByHour ||
      selectedSlotLiveConflict
    ) {
      return;
    }
    setFormError(null);
    setStep('teammates');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddTeammateField = () => {
    if (!selectedSport) return;
    if (teammates.length + 1 >= selectedSport.maxPlayers) return;
    setTeammates((prev) => [...prev, { rollNo: '', name: '' }]);
  };

  const handleRemoveTeammateField = (idx: number) => {
    if (!selectedSport) return;
    if (teammates.length <= selectedSport.minPlayers - 1) return;
    setTeammates((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSelectFromRoster = (entry: RosterEntry) => {
    if (entry.rollNo === student.rollNo) return;
    const alreadyIdx = teammates.findIndex(
      (t) => t.rollNo.trim().toUpperCase() === entry.rollNo.toUpperCase()
    );
    if (alreadyIdx !== -1) return;

    const emptyIdx = teammates.findIndex((t) => !t.rollNo.trim());
    if (emptyIdx !== -1) {
      setTeammates((prev) =>
        prev.map((row, idx) =>
          idx === emptyIdx ? { rollNo: entry.rollNo, name: entry.name } : row
        )
      );
    } else if (selectedSport && teammates.length + 1 < selectedSport.maxPlayers) {
      setTeammates((prev) => [...prev, { rollNo: entry.rollNo, name: entry.name }]);
    }
  };

  const handleOpenBookConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isStudentRosterActive || captainBannedForSelectedSport) {
      setFormError(getRosterLockMessage());
      return;
    }

    if (selectedSlotOp?.isMaintenance) {
      setFormError(
        `Facilities are closed for maintenance (${dayWindows.maintenanceRangeLabel}). Please choose a Morning or Evening slot.`
      );
      return;
    }

    if (selectedSlotOp && isSelectedSlotLockedByHour) {
      setFormError(
        `${selectedSlotOp.type === 'morning' ? 'Morning' : 'Evening'} slots open today at ${selectedSlotOp.unlockLabel}.`
      );
      return;
    }

    if (!selectedSport || !selectedCourt || !selectedSlot) {
      setFormError('Select a sport, court, and 1-hour slot.');
      return;
    }

    if (selectedSlotLiveConflict) {
      setFormError(
        `This slot was just reserved or blocked (${selectedSlotLiveConflict.detail || selectedSlotLiveConflict.label}). Go back and select another open slot.`
      );
      return;
    }

    const filledTeammates = teammates.filter((t) => t.rollNo.trim().length > 0);
    if (filledTeammates.length + 1 < selectedSport.minPlayers) {
      setFormError(
        `${selectedSport.name} requires at least ${selectedSport.minPlayers} player IDs (you + ${
          selectedSport.minPlayers - 1
        } teammates).`
      );
      return;
    }

    if (teammates.some((t) => !t.rollNo.trim())) {
      setFormError('Fill in or remove any empty teammate ID row.');
      return;
    }

    if (validationResults.length === 0 || validationResults.some((r) => !r.valid)) {
      const bad = validationResults.find((r) => !r.valid);
      setFormError(
        bad?.message || 'All teammate Roll Nos must pass active student ID validation.'
      );
      return;
    }

    if (selectedSlot.isLateNight) {
      if (paymentMethod === 'upi') {
        if (!upiId.trim() || !upiId.includes('@')) {
          setFormError('Enter a valid UPI ID (e.g. yourname@okaxis) for late-night access.');
          return;
        }
      } else {
        const digits = cardNumber.replace(/\D/g, '');
        if (
          digits.length < 12 ||
          cardCvv.replace(/\D/g, '').length < 3 ||
          cardExpiry.trim().length < 4
        ) {
          setFormError('Enter valid Card Number, Expiry (MM/YY), and CVV.');
          return;
        }
      }
    }

    setRulesModalOpen(true);
  };

  const handleFinalizeBooking = async () => {
    if (
      !selectedSport ||
      !selectedCourt ||
      !selectedSlot ||
      !isStudentRosterActive ||
      captainBannedForSelectedSport
    )
      return;
    setSubmitting(true);
    setFormError(null);

    try {
      const allPlayers = [
        { rollNo: student.rollNo, name: student.name },
        ...teammates.map((t) => ({
          rollNo: t.rollNo.trim().toUpperCase(),
          name: t.name.trim(),
        })),
      ];

      const paymentPayload = selectedSlot.isLateNight
        ? paymentMethod === 'upi'
          ? { method: 'upi' as const, upiId: upiId.trim() }
          : {
              method: 'card' as const,
              cardNumber: cardNumber.trim(),
              cardExpiry: cardExpiry.trim(),
              cardCvv: cardCvv.trim(),
              cardHolder: cardHolder.trim(),
            }
        : null;

      const res = await authFetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: getSportsDayString(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          sportId: selectedSport.id,
          courtId: selectedCourt.id,
          slotId: selectedSlot.id,
          bookedByRollNo: student.rollNo,
          players: allPlayers,
          rulesAccepted: true,
          payment: paymentPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRulesModalOpen(false);
        setFormError(data.error || 'Booking failed. Please check availability and IDs.');
        await fetchAvailability();
        return;
      }

      setRulesModalOpen(false);
      await fetchAvailability();
      setStep('sports');
      onBookingCreated(data.booking);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setRulesModalOpen(false);
      setFormError('Network error while creating booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const morningSlots = useMemo(
    () =>
      timeSlots.filter(
        (t) => getSlotOperationalState(t, todayDate, policy).type === 'morning'
      ),
    [timeSlots, todayDate, policy]
  );

  const eveningSlots = useMemo(
    () =>
      timeSlots.filter(
        (t) => getSlotOperationalState(t, todayDate, policy).type === 'evening'
      ),
    [timeSlots, todayDate, policy]
  );

  const lateNightSlots = useMemo(
    () =>
      timeSlots.filter(
        (t) => getSlotOperationalState(t, todayDate, policy).type === 'late-night'
      ),
    [timeSlots, todayDate, policy]
  );

  const filteredRoster = roster.filter((r) => {
    const q = rosterQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.rollNo.toLowerCase().includes(q) ||
      (r.idNo && r.idNo.toLowerCase().includes(q)) ||
      r.name.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q)
    );
  });

  const allPlayersValid =
    validationResults.length === teammates.length + 1 &&
    validationResults.every((r) => r.valid);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6 pb-24 md:pb-10">
      {/* Admin Broadcast Announcement if set */}
      {policy.announcement && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-amber-900">
          <Megaphone className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Sports Office Notice:</span> {policy.announcement}
          </div>
        </div>
      )}

      {/* Top Student Status + Live Sync + Step Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-emerald-700 truncate">
              {student.name} ({student.rollNo})
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Today {todayDate}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <Radio
                className={`w-3.5 h-3.5 ${
                  syncConnected ? 'text-emerald-600' : 'text-amber-600'
                }`}
              />
              {syncConnected ? 'Live Synced' : 'Reconnecting'}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {step === 'sports' && 'Choose a Sport to Book'}
            {step === 'court-slot' && selectedSport && `${selectedSport.name} — Select Court & Slot`}
            {step === 'teammates' && 'Enter & Verify Teammate IDs'}
          </h1>
        </div>

        {/* Clean 3-step progress indicator */}
        <div className="flex items-center gap-2 text-xs font-medium shrink-0">
          <span
            className={
              step === 'sports' ? 'text-emerald-700 font-bold' : 'text-slate-400'
            }
          >
            1. Sport
          </span>
          <span className="text-slate-300">/</span>
          <span
            className={
              step === 'court-slot' ? 'text-emerald-700 font-bold' : 'text-slate-400'
            }
          >
            2. Court &amp; Slot
          </span>
          <span className="text-slate-300">/</span>
          <span
            className={
              step === 'teammates' ? 'text-emerald-700 font-bold' : 'text-slate-400'
            }
          >
            3. Player IDs
          </span>
        </div>
      </div>

      {/* Dual Daily Unlock Banner (3:00 AM Morning / 8:00 AM Evening) */}
      {(isBeforeMorningUnlock || isBeforeEveningUnlock) && (
        <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-bold">
                {isBeforeMorningUnlock
                  ? `Morning Slots Open at ${dayWindows.morningUnlockLabel} · Evening Opens at ${dayWindows.eveningUnlockLabel}`
                  : `Evening & Late-Night Slots Open Today at ${dayWindows.eveningUnlockLabel}`}
              </p>
              <p className="text-xs text-slate-300">
                {isBeforeMorningUnlock
                  ? `Same-day booking opens at ${dayWindows.morningUnlockLabel} for morning sessions and ${dayWindows.eveningUnlockLabel} for evening sessions.`
                  : `Morning slots (${dayWindows.morningRangeLabel}) are already open. Evening slots (${dayWindows.eveningRangeLabel}) unlock automatically at ${dayWindows.eveningUnlockLabel}.`}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono tabular-nums text-amber-300 shrink-0">
            Now: {formatHourMinute12(nowClock.getHours(), nowClock.getMinutes())}
          </span>
        </div>
      )}

      {/* ==================== STEP 1: SPORTS GALLERY WITH PHOTOS ==================== */}
      {step === 'sports' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              {dayWindows.isWeekend ? 'Weekend' : 'Weekday'} Hours: Morning {dayWindows.morningRangeLabel} · Maint {dayWindows.maintenanceRangeLabel} · Evening {dayWindows.eveningRangeLabel}
            </span>
            <span>Morning unlocks {dayWindows.morningUnlockLabel} · Evening unlocks {dayWindows.eveningUnlockLabel}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sports.map((sport) => {
              const freeCount = getFreeSlotsCountForSport(sport);
              const opCourts = sport.courts.filter((c) => c.status === 'operational').length;
              const imgSrc = SPORT_IMAGES[sport.id];

              return (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => handleSelectSport(sport)}
                  className="group text-left bg-white border border-slate-200 hover:border-emerald-700 rounded-2xl overflow-hidden transition-colors flex flex-col cursor-pointer"
                >
                  <div className="relative aspect-[4/3] w-full bg-slate-900 overflow-hidden">
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={sport.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-white text-lg font-bold">
                        {sport.name}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-2 text-white">
                      <div>
                        <h2 className="text-lg font-bold leading-tight">{sport.name}</h2>
                        <p className="text-xs text-slate-200 mt-0.5">{sport.location}</p>
                      </div>
                      <span className="text-xs font-mono font-semibold text-emerald-300 shrink-0">
                        {freeCount} open
                      </span>
                    </div>
                  </div>

                  <div className="p-4 flex items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {opCourts} Courts
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Min {sport.minPlayers} IDs</span>
                      <span aria-hidden="true">·</span>
                      <span>₹{sport.lateNightFee} after 11 PM</span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 shrink-0">
                      Select
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== STEP 2: SELECT COURT & 1-HR TIME SLOT ==================== */}
      {step === 'court-slot' && selectedSport && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep('sports')}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to All Sports
            </button>

            <div className="text-xs text-slate-600">
              Min {selectedSport.minPlayers} active IDs required ·{' '}
              {loadingAvailability ? 'Syncing...' : 'Live court status'}
            </div>
          </div>

          {/* Sport Banner + Court Selector */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 border-b border-slate-200 pb-5">
              {SPORT_IMAGES[selectedSport.id] && (
                <img
                  src={SPORT_IMAGES[selectedSport.id]}
                  alt={selectedSport.name}
                  referrerPolicy="no-referrer"
                  className="w-full sm:w-32 h-32 sm:h-24 rounded-xl object-cover shrink-0"
                />
              )}
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selectedSport.name}</h2>
                  <span className="text-xs font-mono font-semibold text-amber-700">
                    Late-Night (11 PM+): ₹{selectedSport.lateNightFee}/hr
                  </span>
                </div>
                <p className="text-xs text-slate-600">{selectedSport.location}</p>
                <p className="text-xs text-slate-500">
                  Equipment: {selectedSport.equipmentRequired}
                </p>
              </div>
            </div>

            {/* Court Tabs */}
            <div className="space-y-2.5">
              <p className="text-xs font-bold text-slate-900">
                1. Choose Court / Turf ({selectedSport.courts.length} available venues)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                {selectedSport.courts.map((court) => {
                  const active = court.id === selectedCourt?.id;
                  const maint = court.status === 'maintenance';
                  return (
                    <button
                      key={court.id}
                      type="button"
                      onClick={() => {
                        setSelectedCourtId(court.id);
                        setSelectedSlotId(null);
                      }}
                      className={`min-h-[48px] px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-xs font-semibold">
                        {court.name}
                        {maint ? ' · Maintenance' : ''}
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          active ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {court.surface}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 1-Hour Slots */}
            {selectedCourt && (
              <div className="space-y-5 pt-2">
                {selectedCourt.status === 'maintenance' ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    {selectedCourt.name} is temporarily under maintenance. Select another court above.
                  </div>
                ) : (
                  <>
                    {/* Morning Window */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900">
                          2A. Morning Hours ({dayWindows.morningRangeLabel})
                        </span>
                        <span className="font-medium text-emerald-700">
                          {isBeforeMorningUnlock
                            ? `Unlocks at ${dayWindows.morningUnlockLabel}`
                            : 'Free for Active IDs'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                        {morningSlots.map((slot) => {
                          const slotOp = getSlotOperationalState(slot, todayDate, policy);
                          const st = getSlotStatus(
                            selectedSport.id,
                            selectedCourt.id,
                            selectedCourt.status,
                            slot.id
                          );
                          const isFree = st.state === 'free' && !isBeforeMorningUnlock;
                          const isSelected = selectedSlotId === slot.id;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              disabled={!isFree}
                              onClick={() => setSelectedSlotId(slot.id)}
                              className={`min-h-[54px] p-3 rounded-xl border text-left transition-colors ${
                                !isFree
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-emerald-700 border-emerald-700 text-white cursor-pointer'
                                    : 'bg-white border-slate-200 text-slate-900 hover:border-emerald-700 cursor-pointer'
                              }`}
                            >
                              <div className="text-xs font-mono font-semibold tabular-nums">
                                {slotOp.effectiveShortLabel}
                              </div>
                              <div
                                className={`text-[11px] mt-0.5 truncate ${
                                  !isFree
                                    ? 'text-slate-500'
                                    : isSelected
                                      ? 'text-emerald-100'
                                      : 'text-emerald-700'
                                }`}
                              >
                                {isBeforeMorningUnlock && st.state === 'free'
                                  ? `Opens ${dayWindows.morningUnlockLabel}`
                                  : st.label}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Midday Maintenance Window Banner */}
                    <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">
                        Scheduled Facility Maintenance ({dayWindows.isWeekend ? 'Weekend' : 'Weekday'})
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-600">
                        {dayWindows.maintenanceRangeLabel} · Courts Closed for Upkeep
                      </span>
                    </div>

                    {/* Evening Window */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900">
                          2B. Evening Hours ({dayWindows.eveningRangeLabel})
                        </span>
                        <span className="font-medium text-emerald-700">
                          {isBeforeEveningUnlock
                            ? `Unlocks at ${dayWindows.eveningUnlockLabel}`
                            : 'Free for Active IDs'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                        {eveningSlots.map((slot) => {
                          const slotOp = getSlotOperationalState(slot, todayDate, policy);
                          const st = getSlotStatus(
                            selectedSport.id,
                            selectedCourt.id,
                            selectedCourt.status,
                            slot.id
                          );
                          const isFree = st.state === 'free' && !isBeforeEveningUnlock;
                          const isSelected = selectedSlotId === slot.id;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              disabled={!isFree}
                              onClick={() => setSelectedSlotId(slot.id)}
                              className={`min-h-[54px] p-3 rounded-xl border text-left transition-colors ${
                                !isFree
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-emerald-700 border-emerald-700 text-white cursor-pointer'
                                    : 'bg-white border-slate-200 text-slate-900 hover:border-emerald-700 cursor-pointer'
                              }`}
                            >
                              <div className="text-xs font-mono font-semibold tabular-nums">
                                {slotOp.effectiveShortLabel}
                              </div>
                              <div
                                className={`text-[11px] mt-0.5 truncate ${
                                  !isFree
                                    ? 'text-slate-500'
                                    : isSelected
                                      ? 'text-emerald-100'
                                      : 'text-emerald-700'
                                }`}
                              >
                                {isBeforeEveningUnlock && st.state === 'free'
                                  ? `Opens ${dayWindows.eveningUnlockLabel}`
                                  : st.label}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Late-Night Paid Window */}
                    <div className="space-y-2.5 border-t border-slate-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900">
                          3. Late-Night Floodlit Access (11:00 PM – 4:00 AM)
                        </span>
                        <span className="font-mono font-semibold text-amber-700">
                          ₹{selectedSport.lateNightFee} / hr · UPI or Card
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                        {lateNightSlots.map((slot) => {
                          const slotOp = getSlotOperationalState(slot, todayDate, policy);
                          const st = getSlotStatus(
                            selectedSport.id,
                            selectedCourt.id,
                            selectedCourt.status,
                            slot.id
                          );
                          const isFree = st.state === 'free' && !isBeforeEveningUnlock;
                          const isSelected = selectedSlotId === slot.id;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              disabled={!isFree}
                              onClick={() => setSelectedSlotId(slot.id)}
                              className={`min-h-[56px] p-3.5 rounded-xl border text-left transition-colors ${
                                !isFree
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-amber-600 border-amber-600 text-white cursor-pointer'
                                    : 'bg-amber-50/60 border-amber-200 text-slate-900 hover:border-amber-500 cursor-pointer'
                              }`}
                            >
                              <div className="text-xs font-mono font-semibold tabular-nums">
                                {slotOp.effectiveShortLabel}
                              </div>
                              <div
                                className={`text-[11px] mt-0.5 truncate ${
                                  !isFree
                                    ? 'text-slate-500'
                                    : isSelected
                                      ? 'text-amber-100'
                                      : 'text-amber-700 font-medium'
                                }`}
                              >
                                {isBeforeEveningUnlock && st.state === 'free'
                                  ? `Opens ${dayWindows.eveningUnlockLabel}`
                                  : isFree
                                    ? `Paid ₹${selectedSport.lateNightFee} · Available`
                                    : st.label}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Next Step Action Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              {selectedSlot && selectedCourt && selectedSlotOp ? (
                <span>
                  Selected:{' '}
                  <strong className="text-slate-900">
                    {selectedSport.name} · {selectedCourt.name}
                  </strong>{' '}
                  (<span className="font-mono">{selectedSlotOp.effectiveLabel}</span>)
                </span>
              ) : (
                <span>Select any available 1-hour slot above to proceed to teammate IDs.</span>
              )}
            </div>

            <button
              type="button"
              disabled={
                !isStudentRosterActive ||
                !selectedSlot ||
                Boolean(selectedSlotOp?.isMaintenance) ||
                isSelectedSlotLockedByHour ||
                Boolean(selectedSlotLiveConflict)
              }
              onClick={handleProceedToTeammates}
              className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {isStudentRosterActive
                ? 'Next: Enter Teammate IDs'
                : 'Roster Activation Required to Book'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ==================== STEP 3: TEAMMATE IDs & PAYMENT ==================== */}
      {step === 'teammates' && selectedSport && selectedCourt && selectedSlot && (
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep('court-slot')}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Change Court or Slot
            </button>

            <div className="text-xs font-mono text-slate-700">
              {selectedSport.name} · {selectedCourt.name} · {selectedSlotOp?.effectiveShortLabel || selectedSlot.shortLabel}
            </div>
          </div>

          {selectedSlotLiveConflict && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              Heads up: Another device just booked or blocked this slot ({selectedSlotLiveConflict.label}). Go back to choose another court or hour.
            </div>
          )}

          <form
            onSubmit={handleOpenBookConfirmation}
            className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-900">
                  Team Roster ({teammates.length + 1} / Min {selectedSport.minPlayers} Active IDs)
                </h2>
              </div>

              <div className="flex items-center gap-3">
                {savedTeammates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const limit = Math.max(1, selectedSport.maxPlayers - 1);
                      const filled = savedTeammates.slice(0, limit).map((t) => ({
                        rollNo: t.rollNo,
                        name: t.name,
                      }));
                      const needed = Math.max(1, selectedSport.minPlayers - 1);
                      while (filled.length < needed) {
                        filled.push({ rollNo: '', name: '' });
                      }
                      setTeammates(filled);
                    }}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                  >
                    Fill Saved Squad ({savedTeammates.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRosterOpen((v) => !v)}
                  className="min-h-[40px] px-3 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4 cursor-pointer"
                >
                  {rosterOpen ? 'Hide Student Directory' : 'Lookup Active Student IDs'}
                </button>
              </div>
            </div>

            {rosterOpen && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={rosterQuery}
                    onChange={(e) => setRosterQuery(e.target.value)}
                    placeholder="Search Roll No or name..."
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                  {filteredRoster.map((entry) => (
                    <button
                      key={entry.rollNo}
                      type="button"
                      onClick={() => handleSelectFromRoster(entry)}
                      disabled={entry.rollNo === student.rollNo}
                      className="w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-mono font-semibold text-slate-900">
                          {entry.rollNo}
                        </span>
                        {entry.idNo && (
                          <span className="text-xs font-mono text-slate-500 ml-1.5">
                            ({entry.idNo})
                          </span>
                        )}
                        <span className="text-xs text-slate-600 ml-2">
                          {entry.name} · {entry.department}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-semibold shrink-0 ${
                          entry.status === 'active' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {entry.status === 'active'
                          ? 'Add'
                          : entry.status === 'expired'
                            ? 'Unpaid / Expired'
                            : 'Suspended'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Booked By Row */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900">
                  Player 1 (Booked by): {student.name}
                </span>
                <span className="font-mono text-slate-700">{student.rollNo}</span>
              </div>
              {validationResults[0] ? (
                <p
                  className={`text-xs flex items-center gap-1.5 ${
                    validationResults[0].valid ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {validationResults[0].valid ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {validationResults[0].message}
                </p>
              ) : (
                <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Active ID · {student.department}
                </p>
              )}
            </div>

            {/* Teammate Inputs */}
            <div className="space-y-3">
              {teammates.map((row, idx) => {
                const res = validationResults[idx + 1];
                return (
                  <div key={idx} className="p-3.5 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">
                        Teammate {idx + 2}
                      </span>
                      {teammates.length > selectedSport.minPlayers - 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTeammateField(idx)}
                          className="min-h-[36px] px-2 text-slate-400 hover:text-red-600 cursor-pointer"
                          aria-label="Remove teammate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={row.rollNo}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setTeammates((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { rollNo: val, name: '' } : item
                            )
                          );
                        }}
                        placeholder="Roll No (e.g. 23CS102)"
                        className="min-h-[44px] px-3.5 py-2 text-sm font-mono uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                      />
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTeammates((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, name: val } : item
                            )
                          );
                        }}
                        placeholder="Teammate Name"
                        className="min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                      />
                    </div>

                    {row.rollNo.trim() && (() => {
                      const trimmedRoll = row.rollNo.trim().toUpperCase();
                      const resMatchesRow =
                        Boolean(res) && res!.rollNo.trim().toUpperCase() === trimmedRoll;
                      if (resMatchesRow && res) {
                        return (
                          <div className="text-xs flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1.5 ${
                                res.valid ? 'text-emerald-700' : 'text-red-700 font-medium'
                              }`}
                            >
                              {res.valid ? (
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                              ) : (
                                <AlertCircle className="w-4 h-4 shrink-0" />
                              )}
                              {res.message}
                            </span>
                          </div>
                        );
                      }
                      if (res && !res.valid && !validatingIds) {
                        return (
                          <div className="text-xs flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              {res.message}
                            </span>
                          </div>
                        );
                      }
                      return validatingIds ? (
                        <div className="text-xs flex items-center gap-1.5 text-slate-500">
                          Checking active student ID...
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>

            {teammates.length + 1 < selectedSport.maxPlayers && (
              <button
                type="button"
                onClick={handleAddTeammateField}
                className="inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Extra Teammate (Max {selectedSport.maxPlayers})
              </button>
            )}

            {/* Late-Night Payment Panel */}
            {selectedSlot.isLateNight && (
              <div className="p-4 sm:p-5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Late-Night Payment (After 11:00 PM)
                  </span>
                  <span className="text-base font-mono font-bold text-amber-800 tabular-nums">
                    ₹{selectedSport.lateNightFee}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 bg-amber-100/70 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('upi')}
                    className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      paymentMethod === 'upi'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      paymentMethod === 'card'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Card
                  </button>
                </div>

                {paymentMethod === 'upi' ? (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="yourname@okaxis"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-amber-600"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-600">Suffix:</span>
                      {['@okaxis', '@ybl', '@oksbi'].map((suffix) => (
                        <button
                          key={suffix}
                          type="button"
                          onClick={() => {
                            const base = upiId.split('@')[0] || student.rollNo.toLowerCase();
                            setUpiId(`${base}${suffix}`);
                          }}
                          className="min-h-[34px] px-2.5 py-1 bg-white border border-amber-200 hover:border-amber-400 rounded-md text-slate-700 font-mono cursor-pointer"
                        >
                          {suffix}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value)}
                      placeholder="Cardholder Name"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-amber-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="Card Number (16 digits)"
                      maxLength={19}
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-amber-300 rounded-lg"
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="MM/YY"
                        maxLength={5}
                        className="min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-amber-300 rounded-lg"
                      />
                      <input
                        type="password"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        placeholder="CVV"
                        maxLength={4}
                        className="min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-amber-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {formError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={
                !isStudentRosterActive ||
                captainBannedForSelectedSport ||
                !allPlayersValid ||
                Boolean(selectedSlotLiveConflict) ||
                isSelectedSlotLockedByHour ||
                Boolean(selectedSlotOp?.isMaintenance)
              }
              className="w-full min-h-[48px] py-3 px-6 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {captainBannedForSelectedSport
                ? `Booking Locked (Banned until ${student.banUntil})`
                : !isStudentRosterActive
                  ? student.status === 'expired'
                    ? 'Booking Locked (1-Year Pass Expired)'
                    : 'Booking Locked (ID Not Active on Roster)'
                  : selectedSlot.isLateNight
                    ? `Review Rules & Pay ₹${selectedSport.lateNightFee}`
                    : 'Review Rules & Book Free Slot'}
            </button>
          </form>
        </div>
      )}

      {/* Mandatory Rules Confirmation Popup */}
      {selectedSport && selectedCourt && selectedSlot && (
        <RulesModal
          isOpen={rulesModalOpen}
          sport={selectedSport}
          court={selectedCourt}
          date={todayDate}
          slot={
            selectedSlotOp
              ? {
                  ...selectedSlot,
                  label: selectedSlotOp.effectiveLabel,
                  shortLabel: selectedSlotOp.effectiveShortLabel,
                }
              : selectedSlot
          }
          policy={policy}
          playerCount={teammates.length + 1}
          paymentSummary={
            selectedSlot.isLateNight
              ? paymentMethod === 'upi'
                ? `UPI · ${upiId}`
                : `Card ending ${cardNumber.replace(/\D/g, '').slice(-4)}`
              : null
          }
          submitting={submitting}
          onCancel={() => setRulesModalOpen(false)}
          onConfirm={handleFinalizeBooking}
        />
      )}
    </div>
  );
}
