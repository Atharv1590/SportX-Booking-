import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Dumbbell,
  Lock,
  LogOut,
  Megaphone,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  BlockedSlot,
  Booking,
  BookingPolicy,
  PlayerValidationResult,
  PublicSlotBooking,
  RosterEntry,
  Sport,
  TimeSlot,
} from '../types';
import {
  ALL_TIME_SLOTS,
  formatHourMinute12,
  getDayScheduleWindows,
  getSlotOperationalState,
  getSportsDayEffectiveHour,
  getSportsDayString,
} from '../lib/schedule';
import { subscribeLivePulse } from '../lib/firebase';
import { SPORT_IMAGES } from '../sportImages';
import { RulesModal } from './RulesModal';
import { SportXLogo } from './SportXLogo';

interface WalkInDeskViewProps {
  onBackToLogin: () => void;
  onOpenAdmin: () => void;
  onOpenSecurity: () => void;
  backLabel?: string;
}

interface PlayerRow {
  rollNo: string;
  name: string;
}

type DeskMode = 'book' | 'lookup' | 'cancel' | 'training';
type BookStep = 'sports' | 'court-slot' | 'players';

const DEFAULT_POLICY: BookingPolicy = {
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
  facilityRules: [],
};

export function WalkInDeskView({
  onBackToLogin,
  onOpenAdmin,
  onOpenSecurity,
  backLabel = 'Student Login',
}: WalkInDeskViewProps) {
  const [walkInToken, setWalkInToken] = useState<string | null>(() =>
    sessionStorage.getItem('campusarena_walkin_token')
  );
  const [deskPassInput, setDeskPassInput] = useState('');
  const [deskAuthError, setDeskAuthError] = useState<string | null>(null);
  const [loggingInDesk, setLoggingInDesk] = useState(false);

  const [mode, setMode] = useState<DeskMode>('book');
  const [step, setStep] = useState<BookStep>('sports');
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  const [sports, setSports] = useState<Sport[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(ALL_TIME_SLOTS);
  const [policy, setPolicy] = useState<BookingPolicy>(DEFAULT_POLICY);
  const [loadingFacilities, setLoadingFacilities] = useState(true);

  const [bookingsForToday, setBookingsForToday] = useState<PublicSlotBooking[]>([]);
  const [blockedForToday, setBlockedForToday] = useState<BlockedSlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const [syncConnected, setSyncConnected] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);

  // Booking selection state
  const [selectedSportId, setSelectedSportId] = useState('');
  const [selectedCourtId, setSelectedCourtId] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Player IDs (Index 0 = Lead / Booked By, Index 1..N = Friends)
  const [players, setPlayers] = useState<PlayerRow[]>([
    { rollNo: '', name: '' },
    { rollNo: '', name: '' },
  ]);
  const [validationResults, setValidationResults] = useState<PlayerValidationResult[]>([]);
  const [validatingIds, setValidatingIds] = useState(false);

  // Optional active directory lookup
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterQuery, setRosterQuery] = useState('');

  // Late-night payment state
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card'>('upi');
  const [upiId, setUpiId] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmedPass, setConfirmedPass] = useState<Booking | null>(null);

  // Cancel / Lookup Desk state
  const [deskSearch, setDeskSearch] = useState('');
  const [deskBookings, setDeskBookings] = useState<Booking[]>([]);
  const [loadingDeskBookings, setLoadingDeskBookings] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelCode, setCancelCode] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Training Hours (Today Only) state
  const [trainSportId, setTrainSportId] = useState('');
  const [trainCourtIds, setTrainCourtIds] = useState<string[]>([]);
  const [trainSlotIds, setTrainSlotIds] = useState<string[]>([]);
  const [trainReason, setTrainReason] = useState('Official Campus Team Training');
  const [trainingCode, setTrainingCode] = useState('');
  const [submittingTraining, setSubmittingTraining] = useState(false);
  const [trainingFeedback, setTrainingFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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

  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Authenticated SSE live sync for Walk-In Desk
  useEffect(() => {
    if (!walkInToken) {
      setSyncConnected(false);
      return;
    }
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(`/api/events?walkinToken=${encodeURIComponent(walkInToken)}`);
      es.onopen = () => setSyncConnected(true);
      es.addEventListener('sync', (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data);
          setSyncConnected(true);
          if (parsed.type && parsed.type !== 'connected') {
            setSyncVersion((v) => v + 1);
          }
        } catch {
          setSyncVersion((v) => v + 1);
        }
      });
      es.onerror = () => {
        setSyncConnected(false);
        es?.close();
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3500);
        }
      };
    };

    connect();
    const unsubFirestore = subscribeLivePulse(() => {
      setSyncVersion((v) => v + 1);
    });
    return () => {
      disposed = true;
      es?.close();
      unsubFirestore();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [walkInToken]);

  const handleUnauthorizedWalkIn = useCallback(() => {
    sessionStorage.removeItem('campusarena_walkin_token');
    setWalkInToken(null);
  }, []);

  const handleDeskLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeskAuthError(null);
    setLoggingInDesk(true);
    try {
      const res = await fetch('/api/walkin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deskPassInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeskAuthError(data.error || 'Invalid Walk-In Desk password.');
        return;
      }
      sessionStorage.setItem('campusarena_walkin_token', data.token);
      setWalkInToken(data.token);
      setDeskPassInput('');
    } catch {
      setDeskAuthError('Unable to reach Walk-In Desk authentication service.');
    } finally {
      setLoggingInDesk(false);
    }
  };

  const handleDeskLogout = async () => {
    if (walkInToken) {
      await fetch('/api/walkin/logout', {
        method: 'POST',
        headers: { 'x-walkin-token': walkInToken },
      }).catch(() => {});
    }
    sessionStorage.removeItem('campusarena_walkin_token');
    setWalkInToken(null);
    onBackToLogin();
  };

  const fetchFacilities = useCallback(async () => {
    if (!walkInToken) return;
    try {
      const res = await fetch('/api/walkin/facilities', {
        headers: { 'x-walkin-token': walkInToken },
      });
      if (res.status === 401) {
        handleUnauthorizedWalkIn();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const loadedSports: Sport[] = data.sports || [];
        setSports(loadedSports);
        if (loadedSports.length > 0 && !trainSportId) {
          setTrainSportId(loadedSports[0].id);
        }
        if (Array.isArray(data.timeSlots) && data.timeSlots.length > 0) {
          setTimeSlots(data.timeSlots);
        }
        if (data.policy) setPolicy(data.policy);
      }
    } catch {
      // retry on next sync
    } finally {
      setLoadingFacilities(false);
    }
  }, [walkInToken, handleUnauthorizedWalkIn]);

  const fetchAvailability = useCallback(async () => {
    if (!walkInToken) return;
    setLoadingAvailability(true);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res = await fetch(
        `/api/walkin/availability?date=${encodeURIComponent(todayDate)}&tzOffset=${tzOffset}`,
        { headers: { 'x-walkin-token': walkInToken } }
      );
      if (res.status === 401) {
        handleUnauthorizedWalkIn();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setBookingsForToday(data.bookings || []);
        setBlockedForToday(data.blockedSlots || []);
        if (data.policy) setPolicy(data.policy);
      }
    } catch {
      // retry on next sync
    } finally {
      setLoadingAvailability(false);
    }
  }, [todayDate, walkInToken, handleUnauthorizedWalkIn]);

  const fetchDeskBookings = useCallback(async () => {
    if (!walkInToken) return;
    setLoadingDeskBookings(true);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res = await fetch(
        `/api/walkin/bookings?date=${encodeURIComponent(todayDate)}&tzOffset=${tzOffset}&q=${encodeURIComponent(deskSearch)}`,
        { headers: { 'x-walkin-token': walkInToken } }
      );
      if (res.status === 401) {
        handleUnauthorizedWalkIn();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setDeskBookings(data.bookings || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDeskBookings(false);
    }
  }, [todayDate, deskSearch, walkInToken, handleUnauthorizedWalkIn]);

  useEffect(() => {
    if (!walkInToken) return;
    fetchFacilities();
    fetchAvailability();
    fetch('/api/walkin/directory', {
      headers: { 'x-walkin-token': walkInToken },
    })
      .then((r) => {
        if (r.status === 401) {
          handleUnauthorizedWalkIn();
          return { students: [] };
        }
        return r.ok ? r.json() : { students: [] };
      })
      .then((d) => setRoster(d.students || []))
      .catch(() => {});
  }, [walkInToken, fetchFacilities, fetchAvailability, handleUnauthorizedWalkIn, syncVersion]);

  useEffect(() => {
    if (walkInToken && (mode === 'lookup' || mode === 'cancel')) {
      fetchDeskBookings();
    }
  }, [walkInToken, mode, fetchDeskBookings, syncVersion]);

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

  const selectedSlotOp = useMemo(
    () => (selectedSlot ? getSlotOperationalState(selectedSlot, todayDate, policy) : null),
    [selectedSlot, todayDate, policy]
  );

  const isSelectedSlotLockedByHour = Boolean(
    selectedSlotOp && policy.enforceOpeningHour && effectiveHour < selectedSlotOp.unlockHour
  );

  const getSlotStatus = useCallback(
    (sportId: string, courtId: string, courtStatus: string, slotId: string) => {
      if (courtStatus === 'maintenance') {
        return { state: 'maintenance' as const, label: 'Maintenance' };
      }
      const blk = blockedForToday.find(
        (b) => b.sportId === sportId && b.courtId === courtId && b.slotId === slotId
      );
      if (blk) {
        return {
          state: 'blocked' as const,
          label: blk.reason.toLowerCase().includes('training')
            ? 'Training Blocked'
            : 'Blocked',
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

  const playersValidationKey = useMemo(
    () => players.map((p) => p.rollNo.trim().toUpperCase()).join('|'),
    [players]
  );

  // Validate all entered player Roll Nos live without name-fill retrigger blink
  useEffect(() => {
    if (!walkInToken || mode !== 'book' || step !== 'players') return;
    const allRolls = playersValidationKey.split('|');

    const timer = setTimeout(async () => {
      setValidatingIds(true);
      try {
        const res = await fetch('/api/walkin/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-walkin-token': walkInToken,
          },
          body: JSON.stringify({
            date: todayDate,
            slotId: selectedSlotId || '08:00',
            sportId: selectedSport?.id,
            playerRollNos: allRolls,
          }),
        });
        if (res.status === 401) {
          handleUnauthorizedWalkIn();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          const results: PlayerValidationResult[] = data.results || [];
          setValidationResults(results);
          setPlayers((prev) => {
            let changed = false;
            const next = prev.map((row, idx) => {
              const r = results[idx];
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
        // transient
      } finally {
        setValidatingIds(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [
    walkInToken,
    mode,
    step,
    playersValidationKey,
    todayDate,
    selectedSlotId,
    selectedSport?.id,
    syncVersion,
    handleUnauthorizedWalkIn,
  ]);

  const handleSelectSport = (sport: Sport) => {
    setConfirmedPass(null);
    setSelectedSportId(sport.id);
    const firstOp =
      sport.courts.find((c) => c.status === 'operational') || sport.courts[0];
    setSelectedCourtId(firstOp?.id || '');
    setSelectedSlotId(null);
    setFormError(null);
    const needed = Math.max(2, sport.minPlayers);
    setPlayers(Array.from({ length: needed }, () => ({ rollNo: '', name: '' })));
    setStep('court-slot');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectFromRoster = (entry: RosterEntry) => {
    const exists = players.some(
      (p) => p.rollNo.trim().toUpperCase() === entry.rollNo.toUpperCase()
    );
    if (exists) return;

    const emptyIdx = players.findIndex((p) => !p.rollNo.trim());
    if (emptyIdx !== -1) {
      setPlayers((prev) =>
        prev.map((row, idx) =>
          idx === emptyIdx ? { rollNo: entry.rollNo, name: entry.name } : row
        )
      );
    } else if (selectedSport && players.length < selectedSport.maxPlayers) {
      setPlayers((prev) => [...prev, { rollNo: entry.rollNo, name: entry.name }]);
    }
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedSport || !selectedCourt || !selectedSlot) {
      setFormError('Select a sport, court, and 1-hour slot.');
      return;
    }
    if (selectedSlotOp?.isMaintenance) {
      setFormError(`Facilities are under maintenance (${dayWindows.maintenanceRangeLabel}).`);
      return;
    }
    if (isSelectedSlotLockedByHour && selectedSlotOp) {
      setFormError(
        `${selectedSlotOp.type === 'morning' ? 'Morning' : 'Evening'} slots open today at ${selectedSlotOp.unlockLabel}.`
      );
      return;
    }
    if (selectedSlotLiveConflict) {
      setFormError(
        `This slot was just booked or blocked (${selectedSlotLiveConflict.detail || selectedSlotLiveConflict.label}). Choose another slot.`
      );
      return;
    }
    if (players.some((p) => !p.rollNo.trim())) {
      setFormError('Fill in all required Roll Nos or remove extra empty rows.');
      return;
    }
    if (players.length < selectedSport.minPlayers) {
      setFormError(`${selectedSport.name} requires at least ${selectedSport.minPlayers} active Roll Nos.`);
      return;
    }
    if (validationResults.length !== players.length || validationResults.some((r) => !r.valid)) {
      const bad = validationResults.find((r) => !r.valid);
      setFormError(bad?.message || 'Every entered Roll No must be active in the college Sports Roster.');
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

  const handleFinalizeWalkInBooking = async () => {
    if (!selectedSport || !selectedCourt || !selectedSlot || !walkInToken) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const cleanPlayers = players.map((p) => ({
        rollNo: p.rollNo.trim().toUpperCase(),
        name: p.name.trim(),
      }));

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

      const res = await fetch('/api/walkin/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-walkin-token': walkInToken,
        },
        body: JSON.stringify({
          date: getSportsDayString(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          sportId: selectedSport.id,
          courtId: selectedCourt.id,
          slotId: selectedSlot.id,
          bookedByRollNo: cleanPlayers[0].rollNo,
          players: cleanPlayers,
          rulesAccepted: true,
          payment: paymentPayload,
        }),
      });

      if (res.status === 401) {
        setRulesModalOpen(false);
        handleUnauthorizedWalkIn();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setRulesModalOpen(false);
        setFormError(data.error || 'Could not confirm walk-in booking.');
        await fetchAvailability();
        return;
      }

      setRulesModalOpen(false);
      setConfirmedPass(data.booking);
      setStep('sports');
      await fetchAvailability();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setRulesModalOpen(false);
      setFormError('Network error while creating walk-in booking.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWalkInCancel = async (bookingId: string) => {
    if (!walkInToken) return;
    if (!cancelCode.trim()) {
      setCancelMessage({
        type: 'error',
        text: 'Enter the Walk-In cancellation authorization code before confirming.',
      });
      return;
    }
    setCancellingId(bookingId);
    setCancelMessage(null);
    try {
      const res = await fetch(`/api/walkin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-walkin-token': walkInToken,
        },
        body: JSON.stringify({
          reason: cancelReason.trim() || 'Cancelled at Walk-In Desk',
          cancelCode: cancelCode.trim(),
        }),
      });
      if (res.status === 401) {
        handleUnauthorizedWalkIn();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setCancelMessage({
          type: 'error',
          text: data.error || 'Failed to cancel booking.',
        });
      } else {
        setConfirmCancelId(null);
        setCancelReason('');
        setCancelCode('');
        setCancelMessage({
          type: 'success',
          text: `Booking ${bookingId} cancelled and slot released across all devices.`,
        });
        await Promise.all([fetchDeskBookings(), fetchAvailability()]);
      }
    } catch {
      setCancelMessage({
        type: 'error',
        text: 'Network error while cancelling reservation.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  const trainSport = useMemo(
    () => sports.find((s) => s.id === trainSportId) || sports[0],
    [sports, trainSportId]
  );

  const handleApplyTrainingHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInToken || !trainSport) return;
    setTrainingFeedback(null);

    if (trainSlotIds.length === 0) {
      setTrainingFeedback({
        type: 'error',
        text: 'Select at least one 1-hour slot to reserve for Training Hours.',
      });
      return;
    }
    if (!trainingCode.trim()) {
      setTrainingFeedback({
        type: 'error',
        text: 'Enter the Training Hours authorization code.',
      });
      return;
    }

    setSubmittingTraining(true);
    try {
      const res = await fetch('/api/walkin/training-hours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-walkin-token': walkInToken,
        },
        body: JSON.stringify({
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          sportId: trainSport.id,
          courtIds: trainCourtIds,
          slotIds: trainSlotIds,
          reason: trainReason.trim() || 'Official Campus Team Training',
          trainingCode: trainingCode.trim(),
        }),
      });
      if (res.status === 401) {
        handleUnauthorizedWalkIn();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setTrainingFeedback({
          type: 'error',
          text: data.error || 'Could not apply training hours.',
        });
        return;
      }
      setTrainingCode('');
      setTrainSlotIds([]);
      setTrainingFeedback({
        type: 'success',
        text: `Training Hours applied for today (${todayDate}): ${data.blockedCount} slot(s) marked Training Blocked and ${data.cancelledCount} conflicting student booking(s) cancelled.`,
      });
      await Promise.all([fetchAvailability(), fetchDeskBookings()]);
    } catch {
      setTrainingFeedback({
        type: 'error',
        text: 'Network error applying training hours.',
      });
    } finally {
      setSubmittingTraining(false);
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
    players.length > 0 &&
    validationResults.length === players.length &&
    validationResults.every((r) => r.valid);

  const cancellableBookings = useMemo(
    () => deskBookings.filter((b) => b.status === 'confirmed'),
    [deskBookings]
  );

  if (!walkInToken) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <header className="border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SportXLogo size="md" theme="dark" />
            <span className="text-xs font-semibold text-emerald-400">Walk-In Desk</span>
          </div>
          <button
            type="button"
            onClick={onBackToLogin}
            className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Back to {backLabel}
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400">
                <Users className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-white">Walk-In Front Desk Access</h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter the Walk-In Desk password configured by Sports Admin to reserve courts for walk-in students, look up booking codes, or process cancellations.
              </p>
            </div>

            <form onSubmit={handleDeskLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="walkin-password"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Walk-In Desk Password
                </label>
                <input
                  id="walkin-password"
                  type="password"
                  required
                  autoFocus
                  autoComplete="off"
                  value={deskPassInput}
                  onChange={(e) => setDeskPassInput(e.target.value)}
                  placeholder="Enter Walk-In Desk password"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono text-white bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
              </div>

              {deskAuthError && (
                <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-300">
                  {deskAuthError}
                </div>
              )}

              <button
                type="submit"
                disabled={loggingInDesk}
                className="w-full min-h-[48px] py-2.5 px-4 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
              >
                {loggingInDesk ? 'Verifying Desk Password...' : 'Unlock Walk-In Desk'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <SportXLogo size="md" />
            <span className="hidden sm:inline text-slate-300" aria-hidden="true">·</span>
            <span className="hidden sm:inline text-xs font-semibold text-emerald-700 whitespace-nowrap">
              Walk-In Desk
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 mr-1">
              <Radio
                className={`w-3.5 h-3.5 ${
                  syncConnected ? 'text-emerald-600' : 'text-amber-600'
                }`}
              />
              {syncConnected ? 'Live Sync' : 'Connecting'}
            </span>

            <button
              type="button"
              onClick={onOpenSecurity}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-700" />
              <span className="hidden sm:inline">Security Gate</span>
            </button>

            <button
              type="button"
              onClick={onOpenAdmin}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Admin</span>
            </button>

            <button
              type="button"
              onClick={handleDeskLogout}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Lock &amp; {backLabel}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6">
        {policy.announcement && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-amber-900">
            <Megaphone className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Sports Office Notice:</span> {policy.announcement}
            </div>
          </div>
        )}

        {/* 3-Page Mode Switcher Bar: Book Court | Lookup Booking | Cancel Booking */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-emerald-700">
              Walk-In Operations Console · {todayDate}
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {mode === 'book'
                ? 'Walk-In Court Reservation'
                : mode === 'lookup'
                  ? 'Lookup Booking & Daily Code'
                  : mode === 'cancel'
                    ? 'Cancel Reservation Desk'
                    : 'Training Hours Block (Today Only)'}
            </h1>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl self-start md:self-auto">
            <button
              type="button"
              onClick={() => {
                setMode('book');
                setCancelMessage(null);
              }}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'book'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Book Court
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('lookup');
                setCancelMessage(null);
                fetchDeskBookings();
              }}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'lookup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lookup Booking
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('cancel');
                fetchDeskBookings();
              }}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'cancel'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cancel Booking
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('training');
                setTrainingFeedback(null);
              }}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'training'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Training Hours
            </button>
          </div>
        </div>

        {/* Confirmed Pass Card Right After Walk-In Booking */}
        {confirmedPass && mode === 'book' && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-bold text-emerald-900">
                    <span className="px-2 py-0.5 bg-emerald-700 text-white rounded-md tabular-nums">
                      Code #{confirmedPass.bookingCode ?? '—'}
                    </span>
                    <span>PASS CONFIRMED · {confirmedPass.id}</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">
                    {confirmedPass.sportName} — {confirmedPass.courtName}
                  </h2>
                  <p className="text-xs text-slate-700 font-mono tabular-nums">
                    {confirmedPass.date} · {confirmedPass.slotLabel}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmedPass(null);
                    setMode('lookup');
                  }}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl cursor-pointer"
                >
                  Open in Lookup Booking
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmedPass(null)}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-white border border-emerald-200 rounded-xl p-4">
              <div>
                <span className="text-slate-500">Booked by:</span>{' '}
                <strong className="text-slate-900">
                  {confirmedPass.bookedByName} ({confirmedPass.bookedByRollNo})
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Players ({confirmedPass.players.length}):</span>{' '}
                <span className="font-mono text-slate-800">
                  {confirmedPass.players.map((p) => `${p.name} (${p.rollNo})`).join(', ')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== MODE 1: WALK-IN BOOKING ==================== */}
        {mode === 'book' && (
          <>
            {(isBeforeMorningUnlock || isBeforeEveningUnlock) && (
              <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold">
                      {isBeforeMorningUnlock
                        ? `Morning Slots Open at ${dayWindows.morningUnlockLabel} · Evening Opens at ${dayWindows.eveningUnlockLabel}`
                        : `Evening & Late-Night Slots Open Today at ${dayWindows.eveningUnlockLabel}`}
                    </p>
                    <p className="text-xs text-slate-300">
                      Morning unlocks {dayWindows.morningUnlockLabel}, evening unlocks{' '}
                      {dayWindows.eveningUnlockLabel}.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono tabular-nums text-amber-300 shrink-0">
                  Now: {formatHourMinute12(nowClock.getHours(), nowClock.getMinutes())}
                </span>
              </div>
            )}

            {loadingFacilities && sports.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500">
                Loading campus courts and live slots...
              </div>
            ) : step === 'sports' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    {dayWindows.isWeekend ? 'Weekend' : 'Weekday'} Hours: Morning{' '}
                    {dayWindows.morningRangeLabel} · Maint {dayWindows.maintenanceRangeLabel} ·
                    Evening {dayWindows.eveningRangeLabel}
                  </span>
                  <span>Select a sport, pick a court &amp; slot, and enter Roll Nos</span>
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
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center text-white text-lg font-bold">
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
                            <span className="font-semibold text-slate-900">{opCourts} Courts</span>
                            <span aria-hidden="true">·</span>
                            <span>Min {sport.minPlayers} IDs</span>
                            <span aria-hidden="true">·</span>
                            <span>₹{sport.lateNightFee} after 11 PM</span>
                          </div>
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 shrink-0">
                            Select
                            <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : step === 'court-slot' && selectedSport ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('sports')}
                    className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Sports
                  </button>
                  <div className="text-xs text-slate-600">
                    Min {selectedSport.minPlayers} active Roster IDs ·{' '}
                    {loadingAvailability ? 'Syncing...' : 'Live court status'}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
                  <div className="space-y-2.5">
                    <p className="text-xs font-bold text-slate-900">
                      1. Choose Court / Table ({selectedSport.courts.length} venues)
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

                  {selectedCourt && (
                    <div className="space-y-5 pt-2">
                      {selectedCourt.status === 'maintenance' ? (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                          {selectedCourt.name} is under maintenance. Select another court above.
                        </div>
                      ) : (
                        <>
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

                          <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">
                              Midday Maintenance ({dayWindows.isWeekend ? 'Weekend' : 'Weekday'})
                            </span>
                            <span className="font-mono font-semibold tabular-nums text-slate-600">
                              {dayWindows.maintenanceRangeLabel} · Courts Closed
                            </span>
                          </div>

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
                      <span>Select any available 1-hour slot to enter player Roll Nos.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={
                      !selectedSlot ||
                      Boolean(selectedSlotOp?.isMaintenance) ||
                      isSelectedSlotLockedByHour ||
                      Boolean(selectedSlotLiveConflict)
                    }
                    onClick={() => {
                      setFormError(null);
                      setStep('players');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl cursor-pointer disabled:cursor-not-allowed"
                  >
                    Next: Enter Student Roll Nos
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              step === 'players' &&
              selectedSport &&
              selectedCourt &&
              selectedSlot && (
                <div className="max-w-3xl mx-auto space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setStep('court-slot')}
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl cursor-pointer"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Change Court or Slot
                    </button>
                    <div className="text-xs font-mono text-slate-700">
                      {selectedSport.name} · {selectedCourt.name} ·{' '}
                      {selectedSlotOp?.effectiveShortLabel || selectedSlot.shortLabel}
                    </div>
                  </div>

                  {selectedSlotLiveConflict && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                      Another device just booked or blocked this slot. Go back to select another slot.
                    </div>
                  )}

                  <form
                    onSubmit={handleOpenConfirm}
                    className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-700" />
                        <h2 className="text-sm font-bold text-slate-900">
                          Enter Your Roll No &amp; Friends&apos; Roll Nos ({players.length} / Min{' '}
                          {selectedSport.minPlayers})
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRosterOpen((v) => !v)}
                        className="min-h-[40px] px-3 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4 cursor-pointer"
                      >
                        {rosterOpen ? 'Hide Student Directory' : 'Lookup Active Roster IDs'}
                      </button>
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
                            className="w-full min-h-[42px] pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                          {filteredRoster.map((entry) => (
                            <button
                              key={entry.rollNo}
                              type="button"
                              onClick={() => handleSelectFromRoster(entry)}
                              className="w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-slate-50 cursor-pointer"
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
                                  ? 'Fill'
                                  : entry.status === 'expired'
                                    ? 'Unpaid / Expired'
                                    : 'Suspended'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {players.map((row, idx) => {
                        const res = validationResults[idx];
                        return (
                          <div
                            key={idx}
                            className="p-3.5 border border-slate-200 rounded-xl space-y-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-800">
                                {idx === 0
                                  ? 'Player 1 (Booked By — Primary Student)'
                                  : `Player ${idx + 1} (Friend / Teammate)`}
                              </span>
                              {idx >= selectedSport.minPlayers && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPlayers((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="min-h-[36px] px-2 text-slate-400 hover:text-red-600 cursor-pointer"
                                  aria-label="Remove player"
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
                                  setPlayers((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { rollNo: val, name: '' } : item
                                    )
                                  );
                                }}
                                placeholder={idx === 0 ? 'Your Roll No (e.g. 23CS101)' : 'Friend Roll No'}
                                className="min-h-[44px] px-3.5 py-2 text-sm font-mono uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                              />
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPlayers((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, name: val } : item
                                    )
                                  );
                                }}
                                placeholder="Student Name (auto-filled when valid)"
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
                                  Checking Sports Roster ID...
                                </div>
                              ) : null;
                            })()}
                          </div>
                        );
                      })}
                    </div>

                    {players.length < selectedSport.maxPlayers && (
                      <button
                        type="button"
                        onClick={() => setPlayers((prev) => [...prev, { rollNo: '', name: '' }])}
                        className="inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Add Extra Player (Max {selectedSport.maxPlayers})
                      </button>
                    )}

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
                            className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md cursor-pointer ${
                              paymentMethod === 'upi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-700'
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            UPI
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('card')}
                            className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md cursor-pointer ${
                              paymentMethod === 'card' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-700'
                            }`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Card
                          </button>
                        </div>

                        {paymentMethod === 'upi' ? (
                          <input
                            type="text"
                            value={upiId}
                            onChange={(e) => setUpiId(e.target.value)}
                            placeholder="yourname@okaxis"
                            className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-amber-300 rounded-lg"
                          />
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
                        !allPlayersValid ||
                        Boolean(selectedSlotLiveConflict) ||
                        isSelectedSlotLockedByHour ||
                        Boolean(selectedSlotOp?.isMaintenance)
                      }
                      className="w-full min-h-[48px] py-3 px-6 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      {selectedSlot.isLateNight
                        ? `Review Rules & Pay ₹${selectedSport.lateNightFee}`
                        : 'Review Rules & Confirm Walk-In Booking'}
                    </button>
                  </form>
                </div>
              )
            )}
          </>
        )}

        {/* ==================== MODE 2: LOOKUP BOOKING PAGE (READ-ONLY) ==================== */}
        {mode === 'lookup' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={deskSearch}
                  onChange={(e) => setDeskSearch(e.target.value)}
                  placeholder="Lookup by Code (e.g. 100), Pass ID, Roll No, Student Name, Sport, or Court..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                />
              </div>
              <button
                type="button"
                onClick={fetchDeskBookings}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDeskBookings ? 'animate-spin' : ''}`} />
                Refresh Today ({todayDate})
              </button>
            </div>

            {deskBookings.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
                <Search className="w-7 h-7 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-900">
                  No matching bookings found for {todayDate}
                </p>
                <p className="text-xs text-slate-500">
                  Search any 3-digit daily code starting at 100, Pass ID, Roll No, or player name.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {deskBookings.map((b) => (
                  <div
                    key={b.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono font-bold tabular-nums">
                            Code #{b.bookingCode ?? '—'}
                          </span>
                          <span className="font-mono font-semibold text-slate-600">{b.id}</span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900">
                          {b.sportName} — {b.courtName}
                        </h3>
                        <div className="text-xs font-mono text-slate-600 tabular-nums">
                          {b.date} · {b.slotLabel}
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            b.status === 'confirmed' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {b.status === 'confirmed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          {b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                        </span>
                        <div
                          className={`text-[11px] font-semibold ${
                            b.securityStatus === 'admitted'
                              ? 'text-emerald-700'
                              : b.securityStatus === 'no_show'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {b.securityStatus === 'admitted'
                            ? 'Gate: Admitted Inside'
                            : b.securityStatus === 'no_show'
                              ? 'Gate: Marked No-Show'
                              : 'Gate: Pending (Auto-admits 30m)'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600">
                      <div>
                        Booked by:{' '}
                        <strong className="text-slate-900">
                          {b.bookedByName} ({b.bookedByRollNo})
                        </strong>
                      </div>
                      <div>
                        Players ({b.players.length}):{' '}
                        <span className="font-mono text-slate-800">
                          {b.players.map((p) => `${p.name} (${p.rollNo})`).join(', ')}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                        <span>
                          {b.payment
                            ? `Paid ₹${b.payment.amount} (${b.payment.method.toUpperCase()}) · ${b.payment.transactionId}`
                            : 'Standard College Hours · Free'}
                        </span>
                        <span className="font-mono tabular-nums">
                          Created{' '}
                          {new Date(b.createdAt).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </span>
                      </div>
                      {b.status === 'cancelled' && b.cancelReason && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                          Cancel Reason: {b.cancelReason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== MODE 3: CANCEL BOOKING PAGE ==================== */}
        {mode === 'cancel' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={deskSearch}
                  onChange={(e) => setDeskSearch(e.target.value)}
                  placeholder="Find reservation to cancel by Code (100), Pass ID, Roll No, or Name..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-red-600"
                />
              </div>
              <button
                type="button"
                onClick={fetchDeskBookings}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDeskBookings ? 'animate-spin' : ''}`} />
                Refresh Active ({cancellableBookings.length})
              </button>
            </div>

            {cancelMessage && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-medium ${
                  cancelMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {cancelMessage.text}
              </div>
            )}

            {cancellableBookings.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
                <Calendar className="w-7 h-7 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-900">
                  No active confirmed bookings to cancel for {todayDate}
                </p>
                <p className="text-xs text-slate-500">
                  Students cannot self-cancel online; confirmed slots matching your search appear here for desk cancellation.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cancellableBookings.map((b) => (
                  <div
                    key={b.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono font-bold tabular-nums">
                          Code #{b.bookingCode ?? '—'}
                        </span>
                        <span className="font-mono font-bold text-slate-700">{b.id}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono text-slate-700 tabular-nums">{b.slotLabel}</span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900">
                        {b.sportName} — {b.courtName}
                      </h3>

                      <p className="text-xs text-slate-600">
                        Booked by:{' '}
                        <strong className="text-slate-900">
                          {b.bookedByName} ({b.bookedByRollNo})
                        </strong>
                        {b.players.length > 1 && (
                          <>
                            {' · '}Other players:{' '}
                            <span className="font-mono text-slate-700">
                              {b.players
                                .filter((p) => p.rollNo !== b.bookedByRollNo)
                                .map((p) => `${p.name} (${p.rollNo})`)
                                .join(', ')}
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {confirmCancelId === b.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className="min-h-[40px] px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg w-40"
                          />
                          <input
                            type="password"
                            required
                            autoComplete="off"
                            value={cancelCode}
                            onChange={(e) => setCancelCode(e.target.value)}
                            placeholder="Cancel Code"
                            className="min-h-[40px] px-3 py-1.5 text-xs font-mono bg-slate-50 border border-red-300 rounded-lg w-32 focus:outline-none focus:border-red-600"
                          />
                          <button
                            type="button"
                            disabled={cancellingId === b.id || !cancelCode.trim()}
                            onClick={() => handleWalkInCancel(b.id)}
                            className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg cursor-pointer"
                          >
                            {cancellingId === b.id ? 'Cancelling...' : 'Confirm Cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmCancelId(null);
                              setCancelReason('');
                              setCancelCode('');
                            }}
                            className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmCancelId(b.id);
                            setCancelReason('');
                            setCancelCode('');
                          }}
                          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl cursor-pointer"
                        >
                          Cancel at Walk-In Desk
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== MODE 4: TRAINING HOURS (TODAY ONLY) ==================== */}
        {mode === 'training' && (
          <form
            onSubmit={handleApplyTrainingHours}
            className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                  <Dumbbell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Reserve Official Training Hours (Today Only · {todayDate})
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Blocks selected courts and 1-hour slots for today only and automatically cancels any existing student reservations during those hours. Requires the Training Override Code from Admin.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl shrink-0">
                Today Only: {todayDate}
              </span>
            </div>

            {trainingFeedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-medium ${
                  trainingFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {trainingFeedback.text}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Sport Facility
                </label>
                <select
                  value={trainSport?.id || ''}
                  onChange={(e) => {
                    setTrainSportId(e.target.value);
                    setTrainCourtIds([]);
                  }}
                  className="w-full min-h-[42px] px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  {sports.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.courts.length} Courts/Tables)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Training Notice / Reason
                </label>
                <input
                  type="text"
                  required
                  value={trainReason}
                  onChange={(e) => setTrainReason(e.target.value)}
                  placeholder="e.g. Inter-University Badminton Practice"
                  className="w-full min-h-[42px] px-3.5 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
            </div>

            {trainSport && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    Courts / Venues ({trainCourtIds.length === 0 ? `All ${trainSport.courts.length} courts if none picked` : `${trainCourtIds.length} selected`})
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setTrainCourtIds(trainSport.courts.map((c) => c.id))}
                      className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                    >
                      Select All Courts
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setTrainCourtIds([])}
                      className="text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {trainSport.courts.map((c) => {
                    const checked = trainCourtIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setTrainCourtIds((prev) =>
                            prev.includes(c.id)
                              ? prev.filter((id) => id !== c.id)
                              : [...prev, c.id]
                          )
                        }
                        className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors cursor-pointer ${
                          checked
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-amber-500'
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  1-Hour Training Slots ({trainSlotIds.length} selected)
                </span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setTrainSlotIds(morningSlots.map((s) => s.id))}
                    className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                  >
                    Morning
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => setTrainSlotIds(eveningSlots.map((s) => s.id))}
                    className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                  >
                    Evening
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => setTrainSlotIds([])}
                    className="text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {timeSlots.map((slot) => {
                  const slotOp = getSlotOperationalState(slot, todayDate, policy);
                  const checked = trainSlotIds.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() =>
                        setTrainSlotIds((prev) =>
                          prev.includes(slot.id)
                            ? prev.filter((id) => id !== slot.id)
                            : [...prev, slot.id]
                        )
                      }
                      className={`min-h-[42px] px-2.5 py-2 rounded-xl border text-[11px] font-mono font-semibold tabular-nums transition-colors cursor-pointer ${
                        checked
                          ? 'bg-slate-900 text-white border-slate-900'
                          : slotOp.isMaintenance
                            ? 'bg-slate-100 text-slate-400 border-slate-200'
                            : 'bg-white text-slate-800 border-slate-200 hover:border-slate-900'
                      }`}
                    >
                      {slotOp.effectiveShortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="w-full sm:w-72">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Training Hours Authorization Code (Required)
                </label>
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={trainingCode}
                  onChange={(e) => setTrainingCode(e.target.value)}
                  placeholder="Enter training override code"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono text-slate-900 bg-slate-50 border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600"
                />
              </div>

              <button
                type="submit"
                disabled={submittingTraining}
                className="min-h-[46px] px-6 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-xl cursor-pointer whitespace-nowrap"
              >
                {submittingTraining
                  ? 'Applying Training Block...'
                  : 'Block Training Hours & Cancel Overlaps'}
              </button>
            </div>
          </form>
        )}
      </main>

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
          playerCount={players.length}
          paymentSummary={
            selectedSlot.isLateNight
              ? paymentMethod === 'upi'
                ? `UPI · ${upiId}`
                : `Card ending ${cardNumber.replace(/\D/g, '').slice(-4)}`
              : null
          }
          submitting={submitting}
          onCancel={() => setRulesModalOpen(false)}
          onConfirm={handleFinalizeWalkInBooking}
        />
      )}
    </div>
  );
}
