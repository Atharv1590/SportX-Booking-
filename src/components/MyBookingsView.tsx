import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Lightbulb,
  MapPin,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import type { Booking, BookingPolicy, Sport, Student } from '../types';
import {
  getDateDaysAgoString,
  getSportsDayEffectiveHour,
  getSportsDayString,
} from '../lib/schedule';
import { SPORT_IMAGES } from '../sportImages';

interface MyBookingsViewProps {
  student: Student;
  bookings: Booking[];
  sports: Sport[];
  policy: BookingPolicy;
  highlightedBookingId: string | null;
  loading: boolean;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onBookNew: () => void;
}

function getInCourtWindowState(
  booking: Booking,
  now: Date,
  inCourtWindowMinutes: number
): { canCheckIn: boolean; statusText: string } {
  if (booking.status !== 'confirmed') {
    return { canCheckIn: false, statusText: 'Cancelled' };
  }
  if (booking.inCourtAt) {
    return { canCheckIn: false, statusText: 'Checked In Court' };
  }

  const today = getSportsDayString(now);
  if (booking.date !== today) {
    return { canCheckIn: false, statusText: 'Available on booking day' };
  }

  const rawHour = Number(booking.slotId.split(':')[0]);
  const effectiveNowH = getSportsDayEffectiveHour(now.getHours(), now.getMinutes());
  const effectiveSlotH = rawHour < 4 ? rawHour + 24 : rawHour;
  const nowMins = effectiveNowH * 60 + now.getMinutes();
  const startMins = effectiveSlotH * 60;
  const endMins = startMins + 60;
  const openMins = startMins - inCourtWindowMinutes;

  if (nowMins < openMins) {
    const openH24 = Math.floor(openMins / 60) % 24;
    const openM = openMins % 60;
    const suffix = openH24 >= 12 ? 'PM' : 'AM';
    const h12 = openH24 % 12 || 12;
    return {
      canCheckIn: false,
      statusText: `In-Court opens ${h12}:${String(openM).padStart(2, '0')} ${suffix} (${inCourtWindowMinutes}m before slot)`,
    };
  }
  if (nowMins > endMins) {
    return { canCheckIn: false, statusText: 'Slot window completed' };
  }

  return { canCheckIn: true, statusText: 'Court arrival window active' };
}

export function MyBookingsView({
  student,
  bookings,
  sports,
  policy,
  highlightedBookingId,
  loading,
  authFetch,
  onRefresh,
  onBookNew,
}: MyBookingsViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    highlightedBookingId || bookings[0]?.id || null
  );
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [lightRequestingId, setLightRequestingId] = useState<string | null>(null);
  const [sentLightIds, setSentLightIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  useEffect(() => {
    if (highlightedBookingId) {
      setExpandedId(highlightedBookingId);
    } else if (!expandedId && bookings.length > 0) {
      setExpandedId(bookings[0].id);
    }
  }, [highlightedBookingId, bookings, expandedId]);

  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 20000);
    return () => clearInterval(timer);
  }, []);

  const handleMarkInCourt = async (bookingId: string) => {
    setCheckingInId(bookingId);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/bookings/${bookingId}/in-court`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rollNo: student.rollNo,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not mark In Court right now.');
      } else {
        setNotice(`Marked In Court for ${bookingId}. Security and admin have been notified.`);
        onRefresh();
      }
    } catch {
      setError('Network error marking court arrival.');
    } finally {
      setCheckingInId(null);
    }
  };

  const handleRequestLights = async (booking: Booking) => {
    setLightRequestingId(booking.id);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/bookings/${booking.id}/light-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rollNo: student.rollNo,
          note: `Turn on floodlights/court lights for ${booking.sportName} · ${booking.courtName}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send light request to Security Gate.');
      } else {
        setSentLightIds((prev) => ({ ...prev, [booking.id]: true }));
        setNotice(
          data.alreadyOpen
            ? `A Lights ON alert for ${booking.courtName} (${booking.slotLabel}) is already open on the Security Gate screen.`
            : `Lights ON request sent for ${booking.courtName} (${booking.slotLabel}). A persistent alert is now shown on Security Gate.`
        );
      }
    } catch {
      setError('Network error sending Lights ON request.');
    } finally {
      setLightRequestingId(null);
    }
  };

  const inCourtWindowMins = policy.inCourtWindowMinutes ?? 5;
  const activeSportsDay = getSportsDayString(nowClock);
  const cutoff30 = getDateDaysAgoString(29, nowClock.getTimezoneOffset(), nowClock.getTime());
  const visibleBookings = bookings.filter((b) => b.date >= cutoff30);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Reservations &amp; Passes</h1>
          <p className="text-sm text-slate-600 mt-1">
            30-day history of reservations booked by you or where you are listed as a player ({student.rollNo}). Daily booking codes reset to #100 at 4:00 AM; tap &ldquo;I&apos;m In Court&rdquo; {inCourtWindowMins} mins before today&apos;s slot start.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onBookNew}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            Book Another Slot
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
          {notice}
        </div>
      )}

      {loading && visibleBookings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
          Loading your reservations...
        </div>
      ) : visibleBookings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-4">
          <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <p className="text-base font-semibold text-slate-900">No reservations in the past 30 days</p>
            <p className="text-sm text-slate-500">
              Your bookings and teammate passes are kept for 30 days. Reserve your next 1-hour slot below.
            </p>
          </div>
          <button
            type="button"
            onClick={onBookNew}
            className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            Browse Available Courts
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleBookings.map((booking) => {
            const otherPlayers = booking.players.filter(
              (p) => p.rollNo.toUpperCase() !== booking.bookedByRollNo.toUpperCase()
            );
            const isExpanded = expandedId === booking.id;
            const isHighlighted = highlightedBookingId === booking.id;
            const sportObj = sports.find((s) => s.id === booking.sportId);
            const windowState = getInCourtWindowState(
              booking,
              nowClock,
              inCourtWindowMins
            );

            return (
              <div
                key={booking.id}
                className={`bg-white rounded-2xl overflow-hidden transition-colors border ${
                  isHighlighted ? 'border-emerald-600 ring-2 ring-emerald-600/15' : 'border-slate-200'
                }`}
              >
                {/* Header Summary Row */}
                <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    {SPORT_IMAGES[booking.sportId] && (
                      <img
                        src={SPORT_IMAGES[booking.sportId]}
                        alt={booking.sportName}
                        referrerPolicy="no-referrer"
                        className="hidden sm:block w-16 h-16 rounded-xl object-cover shrink-0"
                      />
                    )}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-bold tabular-nums">
                          Code #{booking.bookingCode ?? '—'}
                        </span>
                        <span className="font-mono font-bold text-slate-700">{booking.id}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            booking.status === 'confirmed' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {booking.status === 'confirmed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          {booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono text-slate-600 tabular-nums">{booking.date}</span>
                        {booking.date < activeSportsDay && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                            Past Day
                          </span>
                        )}
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono font-medium text-slate-800 tabular-nums">
                          {booking.slotLabel}
                        </span>
                        {booking.inCourtAt && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="font-semibold text-teal-700">In Court Verified</span>
                          </>
                        )}
                        {booking.securityStatus === 'admitted' && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="font-semibold text-emerald-700">Gate Admitted</span>
                          </>
                        )}
                      </div>

                      <h3 className="text-base sm:text-lg font-bold text-slate-900">
                        {booking.sportName} — {booking.courtName}
                      </h3>

                      <div className="text-xs text-slate-600 space-y-0.5">
                        <p>
                          Booked by:{' '}
                          <strong className="text-slate-900">{booking.bookedByName}</strong>{' '}
                          <span className="font-mono text-slate-700">({booking.bookedByRollNo})</span>
                        </p>
                        <p>
                          Other players:{' '}
                          <span className="text-slate-800">
                            {otherPlayers.length > 0
                              ? otherPlayers
                                  .map((p) => `${p.name} (${p.rollNo})`)
                                  .join(', ')
                              : 'None'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {booking.status === 'confirmed' && !booking.inCourtAt && (
                      <button
                        type="button"
                        disabled={!windowState.canCheckIn || checkingInId === booking.id}
                        onClick={() => handleMarkInCourt(booking.id)}
                        title={windowState.statusText}
                        className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                          windowState.canCheckIn
                            ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                            : 'bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed'
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        {checkingInId === booking.id
                          ? 'Checking In...'
                          : windowState.canCheckIn
                            ? "I'm In Court"
                            : 'In Court (5m Prior)'}
                      </button>
                    )}

                    {booking.inCourtAt && (
                      <span className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        In Court ({new Date(booking.inCourtAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })})
                      </span>
                    )}

                    {booking.status === 'confirmed' && booking.date === activeSportsDay && (
                      <button
                        type="button"
                        disabled={lightRequestingId === booking.id}
                        onClick={() => handleRequestLights(booking)}
                        className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          sentLightIds[booking.id]
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        {lightRequestingId === booking.id
                          ? 'Alerting Gate...'
                          : sentLightIds[booking.id]
                            ? 'Lights Requested'
                            : 'Request Lights On'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <span>{isExpanded ? 'Hide Details' : 'Full Pass'}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Complete Pass View (opened automatically after booking!) */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50/70 p-5 sm:p-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {/* Verified Players List */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 md:col-span-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-900">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="w-4 h-4 text-emerald-700" />
                            Verified Players ({booking.players.length})
                          </span>
                          <span className="text-slate-600 font-medium">
                            Booked by: {booking.bookedByName} ({booking.bookedByRollNo})
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {booking.players.map((p, idx) => {
                            const isCreator =
                              p.rollNo.toUpperCase() === booking.bookedByRollNo.toUpperCase();
                            return (
                              <div
                                key={p.rollNo}
                                className={`px-3 py-2 border rounded-lg flex items-center justify-between gap-2 text-xs ${
                                  isCreator
                                    ? 'bg-emerald-50/70 border-emerald-200'
                                    : 'bg-slate-50 border-slate-200'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 truncate">
                                    {idx + 1}. {p.name}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {isCreator ? 'Booked by' : 'Other player'}
                                  </div>
                                </div>
                                <span className="font-mono font-semibold text-slate-700 ml-2 shrink-0">
                                  {p.rollNo}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Facility & Security Status */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-700" />
                          Pass &amp; Arrival Status
                        </div>
                        <div className="space-y-1.5 text-slate-600">
                          <div className="flex items-center justify-between">
                            <span>Court Location</span>
                            <span className="font-medium text-slate-900 text-right">
                              {sportObj?.location || booking.sportName}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Player Arrival</span>
                            <span className="font-medium text-slate-900">
                              {booking.inCourtAt
                                ? `In Court (${booking.inCourtByRollNo})`
                                : windowState.statusText}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Daily Gate Code</span>
                            <span className="font-mono font-bold text-slate-900 tabular-nums">
                              #{booking.bookingCode ?? '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Gate Desk Entry</span>
                            <span
                              className={`font-semibold ${
                                booking.securityStatus === 'admitted'
                                  ? 'text-emerald-700'
                                  : booking.securityStatus === 'no_show'
                                    ? 'text-red-700'
                                    : 'text-slate-700'
                              }`}
                            >
                              {booking.securityStatus === 'admitted'
                                ? 'Admitted Inside'
                                : booking.securityStatus === 'no_show'
                                  ? 'Marked No-Show'
                                  : 'Awaiting Gate (Auto-admit 30m)'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Booked At</span>
                            <span className="font-mono text-slate-700">
                              {new Date(booking.createdAt).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Equipment & Payment Footer */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-start gap-2.5 text-slate-700">
                        <PackageCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold text-slate-900">Required Equipment: </span>
                          {sportObj?.equipmentRequired || 'Bring valid College ID & court gear.'}
                        </div>
                      </div>

                      <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-start gap-2.5 text-slate-700">
                        <CreditCard className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        {booking.payment ? (
                          <div>
                            <span className="font-semibold text-amber-800">
                              Late-Night Paid ₹{booking.payment.amount} ({booking.payment.method.toUpperCase()}):{' '}
                            </span>
                            {booking.payment.detailsMasked} · Ref{' '}
                            <span className="font-mono">{booking.payment.transactionId}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-emerald-800">
                              Standard College Hours · Free Reservation
                            </span>
                            <div className="text-slate-500 mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Arrive {policy.earlyArrivalMinutes ?? 10} mins prior at desk.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {booking.status === 'cancelled' && booking.cancelReason && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                        Cancellation Reason: {booking.cancelReason}
                      </div>
                    )}

                    {booking.status === 'confirmed' && (
                      <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between gap-2">
                        <span>
                          Confirmed bookings cannot be cancelled online. Visit the{' '}
                          <strong className="text-slate-900">Walk-In Desk</strong> or contact{' '}
                          <strong className="text-slate-900">Sports Admin</strong> for cancellations.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
