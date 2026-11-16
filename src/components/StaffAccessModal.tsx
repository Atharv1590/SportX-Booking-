import React, { useState } from 'react';
import { Lock, Shield, Users, X } from 'lucide-react';

export type StaffRole = 'walkin' | 'security' | 'admin';

interface StaffAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlockedWalkIn: (token: string) => void;
  onUnlockedSecurity: (token: string) => void;
  onUnlockedAdmin: (token: string) => void;
}

const ROLE_OPTIONS: {
  id: StaffRole;
  title: string;
  subtitle: string;
  endpoint: string;
  storageKey: string;
}[] = [
  {
    id: 'walkin',
    title: 'Walk-In Desk',
    subtitle: 'Book courts, look up passes & cancel at desk',
    endpoint: '/api/walkin/login',
    storageKey: 'campusarena_walkin_token',
  },
  {
    id: 'security',
    title: 'Security Gate',
    subtitle: '3-hour admission window & gate pass lookup',
    endpoint: '/api/security/login',
    storageKey: 'campusarena_security_token',
  },
  {
    id: 'admin',
    title: 'Admin Console',
    subtitle: 'Operations, roster, matrix & facility rules',
    endpoint: '/api/admin/login',
    storageKey: 'campusarena_admin_token',
  },
];

export function StaffAccessModal({
  isOpen,
  onClose,
  onUnlockedWalkIn,
  onUnlockedSecurity,
  onUnlockedAdmin,
}: StaffAccessModalProps) {
  const [selectedRole, setSelectedRole] = useState<StaffRole>('walkin');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const activeOption =
    ROLE_OPTIONS.find((r) => r.id === selectedRole) || ROLE_OPTIONS[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(activeOption.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setError(data.error || `Invalid ${activeOption.title} password.`);
        setSubmitting(false);
        return;
      }

      sessionStorage.setItem(activeOption.storageKey, data.token);
      setPassword('');
      onClose();

      if (selectedRole === 'walkin') {
        onUnlockedWalkIn(data.token);
      } else if (selectedRole === 'security') {
        onUnlockedSecurity(data.token);
      } else {
        onUnlockedAdmin(data.token);
      }
    } catch {
      setError('Network error verifying desk password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-access-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 id="staff-access-title" className="text-base font-bold text-slate-900">
              SportX booking · Staff &amp; Admin Access
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose a desk console and enter its access password.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
            aria-label="Close access dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 3 Role Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {ROLE_OPTIONS.map((opt) => {
              const active = selectedRole === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSelectedRole(opt.id);
                    setError(null);
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer flex flex-col gap-2 ${
                    active
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900 hover:border-slate-300'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-slate-200 text-emerald-700'
                    }`}
                  >
                    {opt.id === 'walkin' ? (
                      <Users className="w-4 h-4" />
                    ) : opt.id === 'security' ? (
                      <Shield className="w-4 h-4" />
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold">{opt.title}</div>
                    <div
                      className={`text-[11px] leading-snug mt-0.5 ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {opt.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <label
              htmlFor="staff-access-password"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              {activeOption.title} Password
            </label>
            <input
              id="staff-access-password"
              type="password"
              required
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Enter ${activeOption.title} password`}
              className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
            >
              {submitting ? 'Verifying...' : `Unlock ${activeOption.title}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
