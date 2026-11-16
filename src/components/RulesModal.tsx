import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, PackageCheck, X } from 'lucide-react';
import type { BookingPolicy, Court, Sport, TimeSlot } from '../types';

interface RulesModalProps {
  isOpen: boolean;
  sport: Sport;
  court: Court;
  date: string;
  slot: TimeSlot;
  policy: BookingPolicy;
  playerCount: number;
  paymentSummary: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RulesModal({
  isOpen,
  sport,
  court,
  date,
  slot,
  policy,
  playerCount,
  paymentSummary,
  submitting,
  onCancel,
  onConfirm,
}: RulesModalProps) {
  if (!isOpen) return null;

  const earlyMins = policy.earlyArrivalMinutes ?? 10;
  const inCourtMins = policy.inCourtWindowMinutes ?? 5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <h2 id="rules-modal-title" className="text-base font-bold text-slate-900">
              Facility Rules &amp; Booking Confirmation
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
            aria-label="Close rules popup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
            <p className="text-sm font-semibold text-slate-900">
              {sport.name} · {court.name}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              {date} · {slot.label} · {playerCount} Active Players
            </p>
            {slot.isLateNight ? (
              <p className="text-xs font-medium text-amber-700 pt-1">
                Late-Night Access Fee: ₹{sport.lateNightFee} ({paymentSummary})
              </p>
            ) : (
              <p className="text-xs font-medium text-emerald-700 pt-1">
                Standard College Hours · Free Reservation
              </p>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-700">
              To confirm this reservation, you and your teammates must follow all campus sports rules:
            </p>

            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <strong className="text-slate-900">Arrive {earlyMins} minutes early:</strong> Report to {sport.location} at least {earlyMins} mins before your slot. You can tap &ldquo;I&apos;m In Court&rdquo; starting {inCourtMins} mins before start.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <PackageCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <strong className="text-slate-900">Bring required sport equipment:</strong> {sport.equipmentRequired}
                </p>
              </div>

              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <strong className="text-slate-900">College Cancellation Policy:</strong> Your booking can be cancelled by the college administration at any time with a valid reason (such as official training hours, tournaments, or maintenance).
                </p>
              </div>

              {policy.facilityRules
                ?.filter((r) => r.id !== 'rule-college-cancel' && r.id !== 'rule-arrival')
                .slice(0, 3)
                .map((rule) => (
                  <div key={rule.id} className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <p className="text-xs leading-relaxed">
                      <strong className="text-slate-900">{rule.title}:</strong> {rule.description}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {submitting
              ? slot.isLateNight
                ? 'Processing Payment & Booking...'
                : 'Confirming Booking...'
              : slot.isLateNight
                ? `Agree & Pay ₹${sport.lateNightFee}`
                : 'I Agree & Confirm Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
