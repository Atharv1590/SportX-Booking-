import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Dumbbell,
  Lightbulb,
  LogOut,
  MapPin,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type {
  Booking,
  LightRequest,
  SecurityCheckInStatus,
  SecurityGateWindowData,
  Sport,
  TimeSlot,
} from '../types';
import { ALL_TIME_SLOTS } from '../lib/schedule';
import { SportXLogo } from './SportXLogo';

interface SecurityDashboardProps {
  syncVersion: number;
  syncConnected: boolean;
  onSecurityTokenChange: (token: string | null) => void;
  onExitSecurity: () => void;
}

const SPORT_FILTER_OPTIONS = [
  { id: 'all', label: 'All Gate Sports' },
  { id: 'badminton', label: 'Badminton (10)' },
  { id: 'pool', label: 'Pool (5)' },
  { id: 'billiards', label: 'Billiards (2)' },
];

export function SecurityDashboard({
  syncVersion,
  syncConnected,
  onSecurityTokenChange,
  onExitSecurity,
}: SecurityDashboardProps) {
  const [securityToken, setSecurityToken] = useState<string | null>(() =>
    sessionStorage.getItem('campusarena_security_token')
  );
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [securityTab, setSecurityTab] = useState<'window' | 'lookup' | 'lights' | 'training'>('window');
  const [windowData, setWindowData] = useState<SecurityGateWindowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [baseHourOverride, setBaseHourOverride] = useState<number | null>(null);
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [slotFilter, setSlotFilter] = useState<'all' | 'prev' | 'current' | 'next'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupBookings, setLookupBookings] = useState<Booking[]>([]);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [deskNotes, setDeskNotes] = useState<Record<string, string>>({});
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);

  // Light Requests state
  const [closingLightId, setClosingLightId] = useState<string | null>(null);

  // Training Hours (Today Only) state
  const [allSports, setAllSports] = useState<Sport[]>([]);
  const [allSlots, setAllSlots] = useState<TimeSlot[]>(ALL_TIME_SLOTS);
  const [trainSportId, setTrainSportId] = useState('');
  const [trainCourtIds, setTrainCourtIds] = useState<string[]>([]);
  const [trainSlotIds, setTrainSlotIds] = useState<string[]>([]);
  const [trainReason, setTrainReason] = useState('Official Team Training Session');
  const [trainingCode, setTrainingCode] = useState('');
  const [submittingTraining, setSubmittingTraining] = useState(false);

  useEffect(() => {
    onSecurityTokenChange(securityToken);
  }, [securityToken, onSecurityTokenChange]);

  const fetchWindow = useCallback(
    async (token: string) => {
      setLoading(true);
      setError(null);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const params = new URLSearchParams({ tzOffset: String(tzOffset) });
        if (baseHourOverride !== null) {
          params.set('baseHour', String(baseHourOverride));
        }
        const res = await fetch(`/api/security/window?${params.toString()}`, {
          headers: { 'x-security-token': token },
        });
        if (res.status === 401) {
          sessionStorage.removeItem('campusarena_security_token');
          setSecurityToken(null);
          setWindowData(null);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          setWindowData(data);
        } else {
          setError(data.error || 'Could not load security gate roster.');
        }
      } catch {
        setError('Network error fetching gate check-in window.');
      } finally {
        setLoading(false);
      }
    },
    [baseHourOverride]
  );

  const fetchLookupBookings = useCallback(
    async (token: string, query: string) => {
      setLoadingLookup(true);
      setError(null);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const params = new URLSearchParams({
          tzOffset: String(tzOffset),
          q: query,
        });
        const res = await fetch(`/api/security/lookup?${params.toString()}`, {
          headers: { 'x-security-token': token },
        });
        if (res.status === 401) {
          sessionStorage.removeItem('campusarena_security_token');
          setSecurityToken(null);
          setWindowData(null);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          setLookupBookings(data.bookings || []);
        } else {
          setError(data.error || 'Could not look up bookings.');
        }
      } catch {
        setError('Network error looking up bookings.');
      } finally {
        setLoadingLookup(false);
      }
    },
    []
  );

  const fetchFacilities = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/security/facilities', {
        headers: { 'x-security-token': token },
      });
      if (res.ok) {
        const data = await res.json();
        const loaded: Sport[] = data.sports || [];
        setAllSports(loaded);
        if (loaded.length > 0) {
          setTrainSportId((prev) => prev || loaded[0].id);
        }
        if (Array.isArray(data.timeSlots) && data.timeSlots.length > 0) {
          setAllSlots(data.timeSlots);
        }
      }
    } catch {
      // retry on next sync
    }
  }, []);

  useEffect(() => {
    if (securityToken) {
      fetchWindow(securityToken);
      fetchFacilities(securityToken);
    }
  }, [securityToken, fetchWindow, fetchFacilities, syncVersion]);

  useEffect(() => {
    if (!securityToken || securityTab !== 'lookup') return;
    const timer = setTimeout(() => {
      fetchLookupBookings(securityToken, lookupQuery);
    }, 180);
    return () => clearTimeout(timer);
  }, [securityToken, securityTab, lookupQuery, fetchLookupBookings, syncVersion]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/security/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passcodeInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Invalid Gate PIN.');
        setLoggingIn(false);
        return;
      }
      sessionStorage.setItem('campusarena_security_token', data.token);
      setSecurityToken(data.token);
      setPasscodeInput('');
    } catch {
      setAuthError('Unable to reach gate authentication service.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (securityToken) {
      await fetch('/api/security/logout', {
        method: 'POST',
        headers: { 'x-security-token': securityToken },
      }).catch(() => {});
    }
    sessionStorage.removeItem('campusarena_security_token');
    setSecurityToken(null);
    setWindowData(null);
    onExitSecurity();
  };

  const handleUpdateGateStatus = async (
    booking: Booking,
    securityStatus: SecurityCheckInStatus
  ) => {
    if (!securityToken) return;
    setUpdatingBookingId(booking.id);
    setError(null);
    setNotice(null);
    try {
      const notes = deskNotes[booking.id] ?? booking.securityNotes ?? '';
      const res = await fetch(`/api/security/bookings/${booking.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-security-token': securityToken,
        },
        body: JSON.stringify({ securityStatus, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update entry status.');
      } else {
        setNotice(
          `${booking.sportName} · ${booking.courtName} (Code #${booking.bookingCode ?? '—'}) marked as ${
            securityStatus === 'admitted'
              ? 'Admitted Inside'
              : securityStatus === 'no_show'
                ? 'No-Show'
                : 'Pending'
          }.`
        );
        await fetchWindow(securityToken);
        if (securityTab === 'lookup') {
          await fetchLookupBookings(securityToken, lookupQuery);
        }
      }
    } catch {
      setError('Network error updating gate entry.');
    } finally {
      setUpdatingBookingId(null);
    }
  };

  const handleCloseLightRequest = async (request: LightRequest) => {
    if (!securityToken) return;
    setClosingLightId(request.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/security/light-requests/${request.id}/close`, {
        method: 'POST',
        headers: { 'x-security-token': securityToken },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not close light request.');
      } else {
        setNotice(
          `Lights request closed for ${request.sportName} · ${request.courtName} (${request.slotLabel}).`
        );
        await fetchWindow(securityToken);
      }
    } catch {
      setError('Network error closing court lights alert.');
    } finally {
      setClosingLightId(null);
    }
  };

  const selectedTrainSport = useMemo(
    () => allSports.find((s) => s.id === trainSportId) || allSports[0],
    [allSports, trainSportId]
  );

  const handleApplySecurityTrainingHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityToken || !selectedTrainSport) return;
    setError(null);
    setNotice(null);
    if (trainSlotIds.length === 0) {
      setError('Select at least one 1-hour slot for Training Hours.');
      return;
    }
    if (!trainingCode.trim()) {
      setError('Enter the Training Hours authorization code.');
      return;
    }
    setSubmittingTraining(true);
    try {
      const res = await fetch('/api/security/training-hours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-security-token': securityToken,
        },
        body: JSON.stringify({
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          sportId: selectedTrainSport.id,
          courtIds: trainCourtIds,
          slotIds: trainSlotIds,
          reason: trainReason.trim() || 'Official Team Training Session',
          trainingCode: trainingCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not apply training hours.');
        return;
      }
      setTrainingCode('');
      setTrainSlotIds([]);
      setNotice(
        `Today's Training Hours applied: ${data.blockedCount} slot(s) marked Training Blocked and ${data.cancelledCount} conflicting booking(s) cancelled.`
      );
      await fetchWindow(securityToken);
    } catch {
      setError('Network error blocking training hours.');
    } finally {
      setSubmittingTraining(false);
    }
  };

  const shiftHour = (delta: number) => {
    const activeBase =
      baseHourOverride !== null
        ? baseHourOverride
        : windowData?.baseHour ?? new Date().getHours();
    const next = (activeBase + delta + 24) % 24;
    setBaseHourOverride(next);
  };

  const filteredBookings = useMemo(() => {
    if (!windowData) return [];
    const q = searchQuery.trim().toLowerCase();
    return windowData.bookings.filter((b) => {
      if (sportFilter !== 'all' && b.sportId !== sportFilter) return false;
      if (slotFilter === 'prev' && b.slotId !== windowData.prevSlotId) return false;
      if (slotFilter === 'current' && b.slotId !== windowData.currentSlotId) return false;
      if (slotFilter === 'next' && b.slotId !== windowData.nextSlotId) return false;
      if (!q) return true;
      return (
        String(b.bookingCode || '').includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.courtName.toLowerCase().includes(q) ||
        b.sportName.toLowerCase().includes(q) ||
        b.bookedByName.toLowerCase().includes(q) ||
        b.bookedByRollNo.toLowerCase().includes(q) ||
        b.players.some(
          (p) =>
            p.rollNo.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        )
      );
    });
  }, [windowData, sportFilter, slotFilter, searchQuery]);

  if (!securityToken) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <header className="border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SportXLogo size="md" theme="dark" />
            <span className="text-xs font-semibold text-emerald-400">Gate Desk</span>
          </div>
          <button
            type="button"
            onClick={onExitSecurity}
            className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Back to Portal
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400">
                <Shield className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-white">Security Gate Check-In Desk</h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Dedicated indoor desk console for Badminton, Pool, and Billiards. Displays the Previous, Current, and Next hour slots to verify active student IDs before admission.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="security-pin"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Security Desk PIN
                </label>
                <input
                  id="security-pin"
                  type="password"
                  required
                  autoFocus
                  autoComplete="off"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  placeholder="Enter Security Gate PIN"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono text-white bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
              </div>

              {authError && (
                <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-300">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full min-h-[48px] py-2.5 px-4 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
              >
                {loggingIn ? 'Verifying Desk PIN...' : 'Open Gate Check-In Console'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const slotBadges = windowData
    ? [
        { key: 'prev' as const, label: 'Previous Hour', slotId: windowData.prevSlotId },
        { key: 'current' as const, label: 'Current Hour (Live)', slotId: windowData.currentSlotId },
        { key: 'next' as const, label: 'Next Hour', slotId: windowData.nextSlotId },
      ]
    : [];

  const counts = {
    total: windowData?.bookings.length ?? 0,
    admitted: windowData?.bookings.filter((b) => b.securityStatus === 'admitted').length ?? 0,
    inCourt: windowData?.bookings.filter((b) => Boolean(b.inCourtAt)).length ?? 0,
    pending: windowData?.bookings.filter((b) => b.securityStatus === 'pending').length ?? 0,
  };

  const openLightRequests = windowData?.openLightRequests ?? [];
  const allLightRequests = windowData?.allLightRequests ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Persistent Pop-Up Alert for Open Court Lights Requests (stays until guard presses Close) */}
      {openLightRequests.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lights-alert-title"
        >
          <div className="w-full max-w-lg bg-slate-900 border-2 border-amber-400 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-amber-500 text-slate-950 px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <BellRing className="w-5 h-5 shrink-0" />
                <div>
                  <h2 id="lights-alert-title" className="text-sm font-extrabold uppercase tracking-wide">
                    Court Lights ON Request ({openLightRequests.length})
                  </h2>
                  <p className="text-[11px] font-semibold">
                    Verify court presence &amp; switch on lights — stays open until you press Close.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
              {openLightRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-mono font-bold tabular-nums">
                      Code #{req.bookingCode ?? '—'}
                    </span>
                    <span className="text-[11px] font-mono text-amber-300 tabular-nums">
                      {new Date(req.createdAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  </div>
                  <div className="text-base font-bold text-white">
                    {req.sportName} — {req.courtName}
                  </div>
                  <div className="text-xs font-mono text-cyan-300 tabular-nums">
                    Slot: {req.slotLabel}
                  </div>
                  <div className="text-xs text-slate-300">
                    Requested by: <strong className="text-white">{req.requestedByName}</strong> (
                    <span className="font-mono">{req.requestedByRollNo}</span>)
                  </div>
                  {req.note && (
                    <div className="text-xs text-amber-200 bg-amber-950/50 border border-amber-800/60 rounded-lg px-3 py-2">
                      Note: {req.note}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={closingLightId === req.id}
                    onClick={() => handleCloseLightRequest(req)}
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 rounded-xl cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    {closingLightId === req.id
                      ? 'Closing Alert...'
                      : 'Lights Switched On · Close Request'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sticky Desk Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SportXLogo size="md" theme="dark" />
            <div className="hidden sm:block min-w-0 border-l border-slate-700 pl-3">
              <div className="text-xs font-bold text-white truncate">
                Security Gate Desk
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Badminton · Pool · Billiards · Lights · {windowData?.date || 'Today'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg">
              <Radio
                className={`w-3.5 h-3.5 ${
                  syncConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              {syncConnected ? 'Live Synced' : 'Connecting'}
            </span>

            <button
              type="button"
              onClick={() => {
                if (!securityToken) return;
                if (securityTab === 'lookup') {
                  fetchLookupBookings(securityToken, lookupQuery);
                } else {
                  fetchWindow(securityToken);
                }
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${(securityTab === 'lookup' ? loadingLookup : loading) ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-950/50 hover:bg-red-900/50 border border-red-800/70 rounded-lg cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Exit Desk
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Gate Console Tabs: 3-Hour Gate Window | Lookup Booking | Light Requests | Training Hours */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white">
              {securityTab === 'window'
                ? '3-Hour Rolling Gate Verification'
                : securityTab === 'lookup'
                  ? 'Lookup Campus Booking'
                  : securityTab === 'lights'
                    ? 'Court Lights-ON Requests'
                    : 'Training Hours Block (Today Only)'}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {securityTab === 'window'
                ? 'Pending bookings auto-admit 30 minutes after start time if not manually marked.'
                : securityTab === 'lookup'
                  ? 'Search any reservation today by 3-digit daily code (starting 100), Pass ID, Roll No, Name, or Court.'
                  : securityTab === 'lights'
                    ? 'Live alerts sent from active student My Bookings cards when court floodlights need to be switched on.'
                    : 'Code-protected today-only training hours blocker (cancels overlapping reservations).'}
            </p>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl self-start lg:self-auto">
            <button
              type="button"
              onClick={() => setSecurityTab('window')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                securityTab === 'window'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              3-Hour Gate Window
            </button>
            <button
              type="button"
              onClick={() => setSecurityTab('lookup')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                securityTab === 'lookup'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Lookup Booking
            </button>
            <button
              type="button"
              onClick={() => setSecurityTab('lights')}
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                securityTab === 'lights'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Light Requests
              {openLightRequests.length > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-red-600 text-white text-[10px] font-mono tabular-nums">
                  {openLightRequests.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSecurityTab('training')}
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                securityTab === 'training'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Dumbbell className="w-3.5 h-3.5" />
              Training Hours
            </button>
          </div>
        </div>

        {securityTab === 'window' && (
          <>
        {/* 3-Hour Rolling Window Control & Telemetry */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">
                  3-Hour Gate Window (Prev / Current / Next Slot)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => shiftHour(-1)}
                  className="min-h-[34px] px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  -1 Hr
                </button>
                <button
                  type="button"
                  onClick={() => setBaseHourOverride(null)}
                  className="min-h-[34px] px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 hover:border-emerald-500 rounded-lg text-emerald-400 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Live Hour
                </button>
                <button
                  type="button"
                  onClick={() => shiftHour(1)}
                  className="min-h-[34px] px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  +1 Hr
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {slotBadges.map((item) => {
                const slotObj = windowData?.windowSlots.find((s) => s.id === item.slotId);
                const selected = slotFilter === item.key;
                const countForSlot = item.slotId
                  ? windowData?.bookings.filter((b) => b.slotId === item.slotId).length || 0
                  : 0;

                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={!item.slotId}
                    onClick={() =>
                      setSlotFilter((prev) => (prev === item.key ? 'all' : item.key))
                    }
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-emerald-700 border-emerald-500 text-white'
                        : item.key === 'current'
                          ? 'bg-slate-950 border-emerald-600/70 text-white hover:border-emerald-400'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span
                        className={
                          selected
                            ? 'text-emerald-100 font-semibold'
                            : item.key === 'current'
                              ? 'text-emerald-400 font-semibold'
                              : 'text-slate-400'
                        }
                      >
                        {item.label}
                      </span>
                      <span className="font-mono font-bold tabular-nums">{countForSlot}</span>
                    </div>
                    <div className="text-xs font-mono font-semibold mt-1 tabular-nums">
                      {slotObj ? slotObj.shortLabel : 'Off Hours'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Telemetry Counters */}
          <div className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">Window Bookings</div>
              <div className="text-2xl font-bold text-white font-mono tabular-nums mt-1">
                {counts.total}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">Admitted Inside</div>
              <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
                {counts.admitted}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">Player In-Court Tap</div>
              <div className="text-2xl font-bold text-cyan-400 font-mono tabular-nums mt-1">
                {counts.inCourt}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">Awaiting Entry</div>
              <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums mt-1">
                {counts.pending}
              </div>
            </div>
          </div>
        </div>

        {/* Sport Tabs + Search Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {SPORT_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSportFilter(opt.id)}
                className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  sportFilter === opt.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Verify Code #100, Roll No, Name, Booking ID, or Court..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-white bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3.5 bg-emerald-950/60 border border-emerald-700 rounded-xl text-xs text-emerald-200">
            {notice}
          </div>
        )}

        {/* Booking Gate Verification Cards */}
        {loading && !windowData ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-400">
            Loading 3-hour gate window...
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
            <Clock className="w-7 h-7 text-slate-500 mx-auto" />
            <p className="text-sm font-semibold text-white">
              No Badminton, Pool, or Billiards bookings in this 3-hour filter
            </p>
            <p className="text-xs text-slate-400">
              Bookings for Previous, Current, and Next hour appear here automatically as students reserve courts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredBookings.map((booking) => {
              const isCurrent = booking.slotId === windowData?.currentSlotId;
              const isAdmitted = booking.securityStatus === 'admitted';
              const isNoShow = booking.securityStatus === 'no_show';
              const isBusy = updatingBookingId === booking.id;
              const noteVal =
                deskNotes[booking.id] !== undefined
                  ? deskNotes[booking.id]
                  : booking.securityNotes || '';

              return (
                <div
                  key={booking.id}
                  className={`bg-slate-900 rounded-2xl p-5 space-y-4 border ${
                    isAdmitted
                      ? 'border-emerald-600/70'
                      : isCurrent
                        ? 'border-cyan-500/70'
                        : isNoShow
                          ? 'border-red-800/70'
                          : 'border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold tabular-nums">
                          Code #{booking.bookingCode ?? '—'}
                        </span>
                        <span className="font-bold text-white">{booking.id}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span
                          className={
                            isCurrent
                              ? 'text-cyan-400 font-bold'
                              : booking.slotId === windowData?.prevSlotId
                                ? 'text-slate-400'
                                : 'text-amber-400 font-semibold'
                          }
                        >
                          {isCurrent
                            ? `LIVE NOW (${booking.slotLabel})`
                            : booking.slotLabel}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-white">
                        {booking.sportName} — {booking.courtName}
                      </h3>
                    </div>

                    <div className="text-right space-y-1">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-bold ${
                          isAdmitted
                            ? 'text-emerald-400'
                            : isNoShow
                              ? 'text-red-400'
                              : 'text-amber-300'
                        }`}
                      >
                        {isAdmitted
                          ? 'Admitted Inside'
                          : isNoShow
                            ? 'Marked No-Show'
                            : 'Awaiting Gate Entry'}
                      </span>
                      {booking.securityStatus === 'pending' && (
                        <div className="text-[11px] text-slate-400">
                          Auto-admits 30m after start
                        </div>
                      )}
                      {booking.inCourtAt && (
                        <div className="text-[11px] text-cyan-400 font-medium flex items-center justify-end gap-1">
                          <MapPin className="w-3 h-3" />
                          Student tapped In-Court (
                          {new Date(booking.inCourtAt).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                          )
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verified Player Roster for ID Card Checking */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                        <Users className="w-3.5 h-3.5 text-emerald-400" />
                        Verify Player College IDs ({booking.players.length})
                      </span>
                      <span className="font-mono text-[11px]">
                        Booked by: {booking.bookedByRollNo}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {booking.players.map((p) => (
                        <div
                          key={p.rollNo}
                          className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-200 truncate">{p.name}</span>
                          <span className="font-mono font-bold text-emerald-400 ml-2 shrink-0">
                            {p.rollNo}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Desk Verification Note + Enter / Admit Controls */}
                  <div className="space-y-3 pt-1">
                    <input
                      type="text"
                      value={noteVal}
                      onChange={(e) =>
                        setDeskNotes((prev) => ({
                          ...prev,
                          [booking.id]: e.target.value,
                        }))
                      }
                      placeholder="Optional desk note (e.g. Verified 2 IDs + Non-marking shoes)"
                      className="w-full min-h-[38px] px-3 py-1.5 text-xs text-white bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-emerald-500"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy || isAdmitted}
                        onClick={() => handleUpdateGateStatus(booking, 'admitted')}
                        className={`flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed ${
                          isAdmitted
                            ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {isAdmitted ? 'Admitted at Gate' : 'Let In / Admit Team'}
                      </button>

                      {!isNoShow && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleUpdateGateStatus(booking, 'no_show')}
                          className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-300 bg-red-950/50 hover:bg-red-900/60 border border-red-800/70 rounded-xl cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          No-Show
                        </button>
                      )}

                      {(isAdmitted || isNoShow) && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleUpdateGateStatus(booking, 'pending')}
                          className="min-h-[42px] px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </>
        )}

        {/* ==================== TAB 2: LOOKUP BOOKING (ALL SPORTS TODAY) ==================== */}
        {securityTab === 'lookup' && (
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Lookup by Code #100, Pass ID (BK-...), Roll No, Student Name, Sport, or Court..."
                  className="w-full min-h-[42px] pl-10 pr-4 py-2 text-xs sm:text-sm text-white bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => securityToken && fetchLookupBookings(securityToken, lookupQuery)}
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingLookup ? 'animate-spin' : ''}`} />
                Search ({lookupBookings.length})
              </button>
            </div>

            {error && (
              <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="p-3.5 bg-emerald-950/60 border border-emerald-700 rounded-xl text-xs text-emerald-200">
                {notice}
              </div>
            )}

            {loadingLookup && lookupBookings.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-400">
                Searching reservations...
              </div>
            ) : lookupBookings.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
                <Search className="w-7 h-7 text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-white">No bookings match your search</p>
                <p className="text-xs text-slate-400">
                  Try a daily 3-digit code (e.g. 100), Pass ID, Roll No, or student name.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {lookupBookings.map((booking) => {
                  const isAdmitted = booking.securityStatus === 'admitted';
                  const isNoShow = booking.securityStatus === 'no_show';
                  const isBusy = updatingBookingId === booking.id;
                  const canGateUpdate =
                    booking.status === 'confirmed' &&
                    ['badminton', 'pool', 'billiards'].includes(booking.sportId);

                  return (
                    <div
                      key={booking.id}
                      className={`bg-slate-900 rounded-2xl p-5 space-y-4 border ${
                        booking.status === 'cancelled'
                          ? 'border-red-900/60 opacity-80'
                          : isAdmitted
                            ? 'border-emerald-600/70'
                            : 'border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                            <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold tabular-nums">
                              Code #{booking.bookingCode ?? '—'}
                            </span>
                            <span className="font-bold text-white">{booking.id}</span>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-slate-300 tabular-nums">{booking.slotLabel}</span>
                          </div>
                          <h3 className="text-base font-bold text-white">
                            {booking.sportName} — {booking.courtName}
                          </h3>
                        </div>

                        <div className="text-right space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                              booking.status === 'cancelled'
                                ? 'text-red-400'
                                : isAdmitted
                                  ? 'text-emerald-400'
                                  : isNoShow
                                    ? 'text-red-400'
                                    : 'text-amber-300'
                            }`}
                          >
                            {booking.status === 'cancelled'
                              ? 'Cancelled'
                              : isAdmitted
                                ? 'Admitted Inside'
                                : isNoShow
                                  ? 'Marked No-Show'
                                  : 'Awaiting Gate Entry'}
                          </span>
                          {booking.status === 'confirmed' && booking.securityStatus === 'pending' && (
                            <div className="text-[11px] text-slate-400">
                              Auto-admits 30m after start
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                            <Users className="w-3.5 h-3.5 text-emerald-400" />
                            Players ({booking.players.length})
                          </span>
                          <span className="font-mono text-[11px]">
                            Booked by: {booking.bookedByName} ({booking.bookedByRollNo})
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {booking.players.map((p) => (
                            <div
                              key={p.rollNo}
                              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between text-xs"
                            >
                              <span className="text-slate-200 truncate">{p.name}</span>
                              <span className="font-mono font-bold text-emerald-400 ml-2 shrink-0">
                                {p.rollNo}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {canGateUpdate && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isBusy || isAdmitted}
                            onClick={() => handleUpdateGateStatus(booking, 'admitted')}
                            className={`flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed ${
                              isAdmitted
                                ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {isAdmitted ? 'Admitted at Gate' : 'Let In / Admit Team'}
                          </button>

                          {!isNoShow && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleUpdateGateStatus(booking, 'no_show')}
                              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-300 bg-red-950/50 hover:bg-red-900/60 border border-red-800/70 rounded-xl cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              No-Show
                            </button>
                          )}

                          {(isAdmitted || isNoShow) && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleUpdateGateStatus(booking, 'pending')}
                              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 3: COURT LIGHT REQUESTS ==================== */}
        {securityTab === 'lights' && (
          <div className="space-y-4">
            {error && (
              <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="p-3.5 bg-emerald-950/60 border border-emerald-700 rounded-xl text-xs text-emerald-200">
                {notice}
              </div>
            )}

            {allLightRequests.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
                <Lightbulb className="w-7 h-7 text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-white">No court light requests logged</p>
                <p className="text-xs text-slate-400">
                  When a student clicks &quot;Request Lights On&quot; in My Bookings, a live alert pops up automatically here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {allLightRequests.map((req) => {
                  const isOpen = req.status === 'open';
                  return (
                    <div
                      key={req.id}
                      className={`bg-slate-900 rounded-2xl p-5 border space-y-3 ${
                        isOpen ? 'border-amber-400' : 'border-slate-800 opacity-80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-mono font-bold tabular-nums">
                          Code #{req.bookingCode ?? '—'}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            isOpen ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {isOpen ? 'Open Alert · Lights Requested' : 'Lights Switched On · Closed'}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">
                          {req.sportName} — {req.courtName}
                        </h3>
                        <p className="text-xs font-mono text-slate-300 tabular-nums mt-0.5">
                          {req.date} · {req.slotLabel}
                        </p>
                      </div>
                      <p className="text-xs text-slate-400">
                        Student:{' '}
                        <strong className="text-slate-200">
                          {req.requestedByName} ({req.requestedByRollNo})
                        </strong>
                      </p>
                      {req.note && (
                        <p className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                          {req.note}
                        </p>
                      )}
                      {isOpen ? (
                        <button
                          type="button"
                          disabled={closingLightId === req.id}
                          onClick={() => handleCloseLightRequest(req)}
                          className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                          {closingLightId === req.id ? 'Closing...' : 'Lights Turned On · Close'}
                        </button>
                      ) : (
                        req.closedAt && (
                          <div className="text-[11px] font-mono text-slate-500">
                            Closed at{' '}
                            {new Date(req.closedAt).toLocaleTimeString([], {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 4: TRAINING HOURS (TODAY ONLY) ==================== */}
        {securityTab === 'training' && (
          <form
            onSubmit={handleApplySecurityTrainingHours}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 space-y-5"
          >
            <div className="border-b border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">
                  Block Training Hours (Today Only · {windowData?.date || 'Today'})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Requires Training Override Code. Automatically cancels conflicting student bookings for today&apos;s selected courts and hours.
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-amber-300 bg-amber-950/50 border border-amber-700/60 px-3 py-1 rounded-lg">
                Today Only
              </span>
            </div>

            {error && (
              <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="p-3.5 bg-emerald-950/60 border border-emerald-700 rounded-xl text-xs text-emerald-200">
                {notice}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Sport
                </label>
                <select
                  value={selectedTrainSport?.id || ''}
                  onChange={(e) => {
                    setTrainSportId(e.target.value);
                    setTrainCourtIds([]);
                  }}
                  className="w-full min-h-[42px] px-3 py-2 text-xs text-white bg-slate-950 border border-slate-700 rounded-xl"
                >
                  {allSports.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.courts.length} Venues)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Training Session Reason
                </label>
                <input
                  type="text"
                  required
                  value={trainReason}
                  onChange={(e) => setTrainReason(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 text-xs text-white bg-slate-950 border border-slate-700 rounded-xl"
                />
              </div>
            </div>

            {selectedTrainSport && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    Courts / Venues ({trainCourtIds.length === 0 ? 'All courts if unselected' : `${trainCourtIds.length} selected`})
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTrainCourtIds(selectedTrainSport.courts.map((c) => c.id))}
                      className="text-emerald-400 hover:underline cursor-pointer"
                    >
                      All Courts
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrainCourtIds([])}
                      className="text-slate-400 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {selectedTrainSport.courts.map((c) => {
                    const active = trainCourtIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setTrainCourtIds((prev) =>
                            prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                          )
                        }
                        className={`min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-semibold text-left cursor-pointer ${
                          active
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  1-Hour Slots ({trainSlotIds.length} selected)
                </span>
                <button
                  type="button"
                  onClick={() => setTrainSlotIds([])}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  Clear Slots
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {allSlots.map((slot) => {
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
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-semibold tabular-nums cursor-pointer ${
                        checked
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {slot.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="w-full sm:w-72">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Training Override Code (Required)
                </label>
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={trainingCode}
                  onChange={(e) => setTrainingCode(e.target.value)}
                  placeholder="Enter training override code"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono text-white bg-slate-950 border border-amber-500/70 rounded-xl focus:outline-none focus:border-amber-400"
                />
              </div>

              <button
                type="submit"
                disabled={submittingTraining}
                className="min-h-[46px] px-6 py-2.5 text-sm font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 rounded-xl cursor-pointer whitespace-nowrap"
              >
                {submittingTraining ? 'Blocking Training Slots...' : 'Apply Today Training Block'}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
