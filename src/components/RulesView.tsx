import React from 'react';
import { Clock, CreditCard, ShieldCheck } from 'lucide-react';
import type { BookingPolicy, Sport } from '../types';
import {
  formatHourMinute12,
  formatTotalMinutes12,
  parseHHMMToMinutes,
} from '../lib/schedule';

interface RulesViewProps {
  sports: Sport[];
  policy: BookingPolicy;
  onStartBooking: () => void;
}

export function RulesView({ sports, policy, onStartBooking }: RulesViewProps) {
  const rules = policy.facilityRules || [];
  const wdMStart = formatTotalMinutes12(parseHHMMToMinutes(policy.weekdayMorningStart, 5 * 60));
  const wdMEnd = formatTotalMinutes12(parseHHMMToMinutes(policy.weekdayMorningEnd, 9 * 60 + 30));
  const wdEStart = formatTotalMinutes12(parseHHMMToMinutes(policy.weekdayEveningStart, 16 * 60));
  const wdEEnd = formatTotalMinutes12(parseHHMMToMinutes(policy.weekdayEveningEnd, 23 * 60));

  const weMStart = formatTotalMinutes12(parseHHMMToMinutes(policy.weekendMorningStart, 5 * 60));
  const weMEnd = formatTotalMinutes12(parseHHMMToMinutes(policy.weekendMorningEnd, 12 * 60));
  const weEStart = formatTotalMinutes12(parseHHMMToMinutes(policy.weekendEveningStart, 17 * 60));
  const weEEnd = formatTotalMinutes12(parseHHMMToMinutes(policy.weekendEveningEnd, 23 * 60));

  const morningUnlock = formatHourMinute12(policy.morningBookingOpenHour ?? 3, 0);
  const eveningUnlock = formatHourMinute12(policy.eveningBookingOpenHour ?? 8, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Facility Guidelines &amp; Equipment Matrix</h1>
          <p className="text-sm text-slate-600 mt-1">
            Official campus sports rules managed live by administration, including operating hours, maintenance breaks, and late-night rates.
          </p>
        </div>
        <button
          type="button"
          onClick={onStartBooking}
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          Book a Court
        </button>
      </div>

      {/* Weekday & Weekend Schedule Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="text-xs font-bold text-emerald-700">Weekdays (Monday – Friday)</div>
          <div className="text-xs text-slate-700 space-y-1 font-mono tabular-nums">
            <div>Morning Open: <strong>{wdMStart} – {wdMEnd}</strong> (opens {morningUnlock})</div>
            <div>Maintenance: <strong className="text-slate-500">{wdMEnd} – {wdEStart}</strong></div>
            <div>Evening Open: <strong>{wdEStart} – {wdEEnd}</strong> (opens {eveningUnlock})</div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="text-xs font-bold text-sky-700">Weekends (Saturday &amp; Sunday)</div>
          <div className="text-xs text-slate-700 space-y-1 font-mono tabular-nums">
            <div>Morning Open: <strong>{weMStart} – {weMEnd}</strong> (opens {morningUnlock})</div>
            <div>Maintenance: <strong className="text-slate-500">{weMEnd} – {weEStart}</strong></div>
            <div>Evening Open: <strong>{weEStart} – {weEEnd}</strong> (opens {eveningUnlock})</div>
          </div>
        </div>
      </div>

      {/* Dynamic Admin-Managed Facility Rules */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {rules.length > 0 ? (
          rules.map((rule, idx) => (
            <div key={rule.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              {idx % 3 === 0 ? (
                <Clock className="w-5 h-5 text-emerald-700" />
              ) : idx % 3 === 1 ? (
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
              ) : (
                <CreditCard className="w-5 h-5 text-amber-600" />
              )}
              <h2 className="text-sm font-bold text-slate-900">{rule.title}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{rule.description}</p>
            </div>
          ))
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
              <Clock className="w-5 h-5 text-emerald-700" />
              <h2 className="text-base font-bold text-slate-900">
                {policy.earlyArrivalMinutes}-Minute Early Check-In
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Every reservation is strictly 1 hour. The booking creator and listed teammates must arrive at least {policy.earlyArrivalMinutes} minutes early with college IDs.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              <h2 className="text-base font-bold text-slate-900">Active Teammate Verification</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                All required teammate Roll Nos are validated live against the college student roster.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
              <CreditCard className="w-5 h-5 text-amber-600" />
              <h2 className="text-base font-bold text-slate-900">Late-Night Paid Hours (11 PM – 4 AM)</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Standard hours until 11:00 PM are free. Late-night hours (11:00 PM – 4:00 AM) require online UPI or Card payment.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Sport-Wise Requirements &amp; Courts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-5">Sport</th>
                <th className="py-3 px-5">Courts / Tables</th>
                <th className="py-3 px-5">Min / Max IDs</th>
                <th className="py-3 px-5">After 11 PM Fee</th>
                <th className="py-3 px-5">Required Equipment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs text-slate-700">
              {sports.map((sport) => (
                <tr key={sport.id} className="hover:bg-slate-50">
                  <td className="py-3.5 px-5 font-semibold text-slate-900 whitespace-nowrap">
                    <div>{sport.name}</div>
                    <div className="text-[11px] font-normal text-slate-500">{sport.location}</div>
                  </td>
                  <td className="py-3.5 px-5 font-mono tabular-nums whitespace-nowrap">
                    {sport.courts.length} venues
                  </td>
                  <td className="py-3.5 px-5 font-mono tabular-nums whitespace-nowrap">
                    Min {sport.minPlayers} / Max {sport.maxPlayers}
                  </td>
                  <td className="py-3.5 px-5 font-mono tabular-nums font-medium text-amber-700 whitespace-nowrap">
                    ₹{sport.lateNightFee} / hr
                  </td>
                  <td className="py-3.5 px-5 text-slate-600 max-w-md">{sport.equipmentRequired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
