import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  Users,
  Wrench,
} from 'lucide-react';
import type {
  BlockedSlot,
  BookingPolicy,
  PublicSlotBooking,
  Sport,
  Student,
  TimeSlot,
} from '../types';
import {
  getDayScheduleWindows,
  getSlotOperationalState,
  getSportsDayEffectiveHour,
  getSportsDayString,
} from '../lib/schedule';
import { SPORT_IMAGES } from '../sportImages';

export interface SlotBookShortcut {
  sportId: string;
  courtId: string;
  slotId: string;
}

interface CourtBookingsViewProps {
  student: Student;
  sports: Sport[];
  timeSlots: TimeSlot[];
  policy: BookingPolicy;
  syncVersion: number;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onSelectFreeSlot: (req: SlotBookShortcut) => void;
}

export function CourtBookingsView({
  student,
  sports,
  timeSlots,
  policy,
  syncVersion,
  authFetch,
  onSelectFreeSlot,
}: CourtBookingsViewProps) {
  const [nowClock, setNowClock] = useState<Date>(() => new Date());
  const todayDate = useMemo(() => getSportsDayString(nowClock), [nowClock]);
  const [selectedSportId, setSelectedSportId] = useState<string>(
    () => sports[0]?.id || 'badminton'
  );
  const [statusFilter, setStatusFilter] = useState<'all' | 'booked' | 'free'>('all');

  const [bookings, setBookings] = useState<PublicSlotBooking[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sports.length > 0 && !sports.some((s) => s.id === selectedSportId)) {
      setSelectedSportId(sports[0].id);
    }
  }, [sports, selectedSportId]);

  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const fetchTodayBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res = await authFetch(
        `/api/availability?date=${encodeURIComponent(todayDate)}&tzOffset=${tzOffset}`
      );
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
        setBlockedSlots(data.blockedSlots || []);
      } else {
        setError('Could not load today’s slot bookings.');
      }
    } catch {
      setError('Network error loading court bookings.');
    } finally {
      setLoading(false);
    }
  }, [todayDate, authFetch]);

  useEffect(() => {
    fetchTodayBookings();
  }, [fetchTodayBookings, syncVersion]);

  const selectedSport = useMemo(
    () => sports.find((s) => s.id === selectedSportId) || sports[0],
    [sports, selectedSportId]
  );

  const dayWindows = useMemo(
    () => getDayScheduleWindows(todayDate, policy),
    [todayDate, policy]
  );
  const effectiveHour = getSportsDayEffectiveHour(nowClock.getHours(), nowClock.getMinutes());

  const activeSlots = useMemo(
    () =>
      timeSlots.filter(
        (slot) => !getSlotOperationalState(slot, todayDate, policy).isMaintenance
      ),
    [timeSlots, todayDate, policy]
  );

  const bookedCountBySport = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      map.set(b.sportId, (map.get(b.sportId) || 0) + 1);
    }
    return map;
  }, [bookings]);

  const slotGroups = useMemo(() => {
    if (!selectedSport) return [];
    return activeSlots.map((slot) => {
      const slotOp = getSlotOperationalState(slot, todayDate, policy);
      const isLockedByHour = policy.enforceOpeningHour && effectiveHour < slotOp.unlockHour;

      const courtEntries = selectedSport.courts.map((court) => {
        const booking = bookings.find(
          (b) => b.sportId === selectedSport.id && b.courtId === court.id && b.slotId === slot.id
        );
        const block = blockedSlots.find(
          (blk) =>
            blk.sportId === selectedSport.id &&
            blk.courtId === court.id &&
            blk.slotId === slot.id
        );
        return {
          court,
          booking,
          block,
        };
      });

      const filteredCourts = courtEntries.filter((entry) => {
        if (statusFilter === 'booked') return Boolean(entry.booking);
        if (statusFilter === 'free') {
          return !entry.booking && !entry.block && entry.court.status === 'operational';
        }
        return true;
      });

      const bookedTotal = courtEntries.filter((e) => Boolean(e.booking)).length;
      const blockedTotal = courtEntries.filter((e) => !e.booking && Boolean(e.block)).length;
      const freeTotal = courtEntries.filter(
        (e) => !e.booking && !e.block && e.court.status === 'operational'
      ).length;

      return {
        slot,
        slotOp,
        isLockedByHour,
        courts: filteredCourts,
        bookedTotal,
        blockedTotal,
        freeTotal,
      };
    });
  }, [
    selectedSport,
    activeSlots,
    todayDate,
    policy,
    effectiveHour,
    bookings,
    blockedSlots,
    statusFilter,
  ]);

  const totalBookedSelectedSport = selectedSport ? bookedCountBySport.get(selectedSport.id) || 0 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-24 md:pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bookings Directory</h1>
          <p className="text-sm text-slate-600 mt-1">
            Select a sport below to view every time slot&apos;s court bookings, booked students, and teammate IDs for {todayDate}.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-emerald-700" />
            {todayDate}
          </div>
          <button
            type="button"
            onClick={fetchTodayBookings}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Sport Selector Strip */}
      <div className="space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          1. Select Sport
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {sports.map((sport) => {
            const active = selectedSport?.id === sport.id;
            const sportBookingsCount = bookedCountBySport.get(sport.id) || 0;
            const img = SPORT_IMAGES[sport.id];
            return (
              <button
                key={sport.id}
                type="button"
                onClick={() => setSelectedSportId(sport.id)}
                className={`group rounded-xl border text-left overflow-hidden transition-all cursor-pointer ${
                  active
                    ? 'border-emerald-700 bg-slate-900 text-white ring-2 ring-emerald-600/20'
                    : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
                }`}
              >
                <div className="h-14 w-full bg-slate-900 relative overflow-hidden">
                  {img && (
                    <img
                      src={img}
                      alt={sport.name}
                      referrerPolicy="no-referrer"
                      className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                        active ? 'opacity-70' : 'opacity-85'
                      }`}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                  <span className="absolute bottom-1.5 left-2.5 right-2.5 text-xs font-bold text-white truncate">
                    {sport.name}
                  </span>
                </div>
                <div className="px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className={active ? 'text-slate-300' : 'text-slate-500'}>
                    {sport.courts.length} courts
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      active
                        ? 'text-emerald-300'
                        : sportBookingsCount > 0
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                    }`}
                  >
                    {sportBookingsCount} booked
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {selectedSport && (
        <div className="space-y-4">
          {/* Selected Sport Toolbar & Filter */}
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{selectedSport.name}</h2>
                <span className="text-xs font-mono text-slate-500">
                  · {selectedSport.courts.length} Courts · {totalBookedSelectedSport} Active Bookings Today
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {selectedSport.location} · Maintenance: {dayWindows.maintenanceRangeLabel}
              </p>
            </div>

            <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg self-start sm:self-auto">
              {(
                [
                  { id: 'all', label: 'All Courts' },
                  { id: 'booked', label: 'Booked Only' },
                  { id: 'free', label: 'Open Only' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Per-Slot Booking Matrix List */}
          <div className="space-y-4">
            {slotGroups.map(
              ({ slot, slotOp, isLockedByHour, courts, bookedTotal, blockedTotal, freeTotal }) => {
                if (courts.length === 0) return null;
                return (
                  <section
                    key={slot.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
                  >
                    <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">
                          {slotOp.effectiveLabel}
                        </span>
                        {slot.isLateNight ? (
                          <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                            Floodlit · ₹{selectedSport.lateNightFee}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                            {slotOp.type === 'morning' ? 'Morning' : 'Evening'} · Free
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs font-medium">
                        <span className="text-slate-700">
                          <strong className="font-mono text-slate-900">{bookedTotal}</strong> Booked
                        </span>
                        {blockedTotal > 0 && (
                          <span className="text-amber-700">
                            <strong className="font-mono">{blockedTotal}</strong> Blocked
                          </span>
                        )}
                        <span className="text-emerald-700">
                          <strong className="font-mono">{freeTotal}</strong> Available
                        </span>
                      </div>
                    </div>

                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {courts.map(({ court, booking, block }) => {
                        if (booking) {
                          const myRollUpper = student.rollNo.toUpperCase();
                          const otherPlayers = (booking.players || []).filter(
                            (p) => p.rollNo.toUpperCase() !== booking.bookedByRollNo.toUpperCase()
                          );
                          const isUserInvolved =
                            booking.bookedByRollNo.toUpperCase() === myRollUpper ||
                            (booking.players || []).some(
                              (p) => p.rollNo.toUpperCase() === myRollUpper
                            );

                          return (
                            <div
                              key={court.id}
                              className={`p-3.5 rounded-xl border space-y-2 ${
                                isUserInvolved
                                  ? 'bg-emerald-50/60 border-emerald-300'
                                  : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-900">
                                  {court.name}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {booking.bookingCode && (
                                    <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white">
                                      #{booking.bookingCode}
                                    </span>
                                  )}
                                  <span className="text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded">
                                    {isUserInvolved ? 'Booked (Yours)' : 'Booked'}
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-1 text-xs">
                                <p className="text-slate-900 font-medium">
                                  Booked by:{' '}
                                  <span className="font-bold">{booking.bookedByName}</span>{' '}
                                  <span className="font-mono text-slate-600">
                                    ({booking.bookedByRollNo})
                                  </span>
                                </p>
                                <div className="flex items-start gap-1.5 text-slate-600">
                                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                  <span className="leading-relaxed">
                                    <strong className="text-slate-700 font-medium">
                                      Other players ({otherPlayers.length}):
                                    </strong>{' '}
                                    {otherPlayers.length > 0
                                      ? otherPlayers
                                          .map((p) => `${p.name} (${p.rollNo})`)
                                          .join(', ')
                                      : 'None'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (block) {
                          return (
                            <div
                              key={court.id}
                              className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/70 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-amber-950">
                                  {court.name}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                                  <Ban className="w-3 h-3" />
                                  Blocked
                                </span>
                              </div>
                              <p className="text-xs text-amber-800">{block.reason}</p>
                            </div>
                          );
                        }

                        if (court.status === 'maintenance') {
                          return (
                            <div
                              key={court.id}
                              className="p-3.5 rounded-xl border border-slate-200 bg-slate-100 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-700">
                                  {court.name}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                                  <Wrench className="w-3 h-3" />
                                  Maintenance
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500">{court.surface}</p>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={court.id}
                            className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900">{court.name}</div>
                              <div className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium mt-0.5">
                                {isLockedByHour ? (
                                  <>
                                    <Lock className="w-3 h-3 text-slate-400" />
                                    <span className="text-slate-500">
                                      Opens {slotOp.unlockLabel}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Available</span>
                                  </>
                                )}
                              </div>
                            </div>
                            {!isLockedByHour && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectFreeSlot({
                                    sportId: selectedSport.id,
                                    courtId: court.id,
                                    slotId: slot.id,
                                  })
                                }
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shrink-0 cursor-pointer"
                              >
                                Book
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              }
            )}

            {statusFilter !== 'all' &&
              slotGroups.every((g) => g.courts.length === 0) && (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
                  No courts match the &ldquo;{statusFilter === 'booked' ? 'Booked Only' : 'Open Only'}&rdquo; filter for {selectedSport.name} today.
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
