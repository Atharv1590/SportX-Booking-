import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { SCHOOL_DEPARTMENTS, type Booking, type RosterEntry, type Sport, type Student } from '../types';
import {
  getStudentPreferences,
  saveStudentPreferences,
  type SavedTeammatePref,
} from '../lib/preferences';

const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG / M.Tech'];

interface SettingsViewProps {
  student: Student;
  sports: Sport[];
  myBookings: Booking[];
  isDeviceSaved: boolean;
  onSaveDevice: () => Promise<boolean>;
  onForgetDevice: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onStudentUpdated: (updated: Student) => void;
  onViewBookings: () => void;
  onViewRules: () => void;
  onSignOut: () => void;
}

export function SettingsView({
  student,
  sports,
  myBookings,
  isDeviceSaved,
  onSaveDevice,
  onForgetDevice,
  authFetch,
  onStudentUpdated,
  onViewBookings,
  onViewRules,
  onSignOut,
}: SettingsViewProps) {
  // Profile edit state
  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone);
  const [department, setDepartment] = useState(student.department);
  const [year, setYear] = useState(student.year);
  const [details, setDetails] = useState(student.details);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Account security & password state
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Booking preferences & saved squad state
  const [favoriteSportId, setFavoriteSportId] = useState('');
  const [defaultUpiId, setDefaultUpiId] = useState('');
  const [savedTeammates, setSavedTeammates] = useState<SavedTeammatePref[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [teammateSearch, setTeammateSearch] = useState('');
  const [prefsSavedNotice, setPrefsSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setName(student.name);
    setPhone(student.phone);
    setDepartment(student.department);
    setYear(student.year);
    setDetails(student.details);
    const loadedPrefs = getStudentPreferences(student.rollNo);
    setFavoriteSportId(loadedPrefs.favoriteSportId);
    setDefaultUpiId(loadedPrefs.defaultUpiId);
    setSavedTeammates(loadedPrefs.savedTeammates);
  }, [student]);

  useEffect(() => {
    authFetch('/api/auth/security')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setHasPassword(Boolean(d.hasPassword));
        }
      })
      .catch(() => {});

    authFetch('/api/students/directory')
      .then((r) => (r.ok ? r.json() : { students: [] }))
      .then((d) => setRoster(d.students || []))
      .catch(() => {});
  }, [authFetch]);

  const stats = useMemo(() => {
    const confirmed = myBookings.filter((b) => b.status === 'confirmed');
    const cancelled = myBookings.filter((b) => b.status === 'cancelled');
    const lateNight = confirmed.filter((b) => b.isLateNight).length;
    const sportCounts = new Map<string, number>();
    for (const b of confirmed) {
      sportCounts.set(b.sportName, (sportCounts.get(b.sportName) || 0) + 1);
    }
    let topSport = 'None yet';
    let maxCount = 0;
    for (const [sp, count] of sportCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topSport = sp;
      }
    }
    return {
      confirmedCount: confirmed.length,
      cancelledCount: cancelled.length,
      lateNightCount: lateNight,
      topSport,
    };
  }, [myBookings]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setSavingProfile(true);
    try {
      const res = await authFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          department,
          year,
          details,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMessage({
          type: 'error',
          text: data.error || 'Could not update your profile.',
        });
      } else if (data.student) {
        onStudentUpdated(data.student);
        setProfileMessage({
          type: 'success',
          text: 'Profile saved to Cloud SQL and synced across devices.',
        });
      }
    } catch {
      setProfileMessage({
        type: 'error',
        text: 'Network error updating profile. Please try again.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword.length < 4) {
      setPasswordMessage({
        type: 'error',
        text: 'New password must be at least 4 characters.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        type: 'error',
        text: 'New password and confirmation do not match.',
      });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPassword : '',
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMessage({
          type: 'error',
          text: data.error || 'Failed to update password.',
        });
      } else {
        setHasPassword(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordMessage({
          type: 'success',
          text: 'Account password updated. Use this password with your Student ID or .edu.in email on any device.',
        });
      }
    } catch {
      setPasswordMessage({
        type: 'error',
        text: 'Network error updating password. Please try again.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSavePreferences = (
    nextSportId = favoriteSportId,
    nextUpi = defaultUpiId,
    nextSquad = savedTeammates
  ) => {
    saveStudentPreferences(student.rollNo, {
      favoriteSportId: nextSportId,
      defaultUpiId: nextUpi.trim(),
      savedTeammates: nextSquad,
    });
    setPrefsSavedNotice('Booking preferences updated.');
    setTimeout(() => setPrefsSavedNotice(null), 2500);
  };

  const handleAddSavedTeammate = (entry: RosterEntry) => {
    if (entry.rollNo === student.rollNo) return;
    if (savedTeammates.some((t) => t.rollNo === entry.rollNo)) return;
    const updated = [...savedTeammates, { rollNo: entry.rollNo, name: entry.name }].slice(
      0,
      8
    );
    setSavedTeammates(updated);
    setTeammateSearch('');
    handleSavePreferences(favoriteSportId, defaultUpiId, updated);
  };

  const handleRemoveSavedTeammate = (rollNo: string) => {
    const updated = savedTeammates.filter((t) => t.rollNo !== rollNo);
    setSavedTeammates(updated);
    handleSavePreferences(favoriteSportId, defaultUpiId, updated);
  };

  const filteredDirectory = useMemo(() => {
    const q = teammateSearch.trim().toLowerCase();
    if (!q) return [];
    return roster
      .filter(
        (r) =>
          r.rollNo !== student.rollNo &&
          r.status === 'active' &&
          !savedTeammates.some((t) => t.rollNo === r.rollNo) &&
          (r.rollNo.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [roster, teammateSearch, student.rollNo, savedTeammates]);

  const memberSince = new Date(student.createdAt).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6 pb-24 md:pb-12">
      {/* Page Header & Student Identity Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-mono font-semibold text-emerald-700">{student.rollNo}</span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                student.status === 'active'
                  ? 'text-emerald-700'
                  : student.status === 'suspended' || student.status === 'expired'
                    ? 'text-red-700'
                    : 'text-amber-700'
              }`}
            >
              {student.status === 'active'
                ? 'Active on Sports Roster'
                : student.status === 'expired'
                  ? `Subscription Expired${student.subscriptionEndDate ? ` (${student.subscriptionEndDate})` : ''}`
                  : student.status === 'suspended'
                    ? 'Suspended on Roster'
                    : 'Not Active on Sports Roster Yet'}
            </span>
            {student.subscriptionStartDate && student.subscriptionEndDate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-600">
                  1-Yr Plan: {student.subscriptionStartDate} → {student.subscriptionEndDate}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Joined {memberSince}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {student.name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            {student.email} · {student.department} · {student.year}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onViewBookings}
            className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            My Bookings
          </button>
          <button
            type="button"
            onClick={onViewRules}
            className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Facility Rules
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Activity Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Confirmed Passes</div>
          <div className="text-xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
            {stats.confirmedCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Late-Night Access</div>
          <div className="text-xl font-mono font-bold text-amber-700 tabular-nums mt-0.5">
            {stats.lateNightCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Cancelled</div>
          <div className="text-xl font-mono font-bold text-slate-600 tabular-nums mt-0.5">
            {stats.cancelledCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] font-medium text-slate-500">Most Played</div>
          <div className="text-sm font-bold text-emerald-700 truncate mt-1">
            {stats.topSport}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Editable Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3.5">
            <User className="w-4 h-4 text-emerald-700" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Student Account Profile</h2>
              <p className="text-xs text-slate-500">
                Changes sync immediately to your active campus roster card.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                College Outlook Email (.edu.in)
              </label>
              <input
                type="email"
                value={student.email}
                readOnly
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-100 text-slate-600 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                College Roll No (Fixed)
              </label>
              <input
                type="text"
                value={student.rollNo}
                readOnly
                className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-slate-100 text-slate-700 border border-slate-200 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number (10 digits)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                School
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
              >
                {SCHOOL_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                {!SCHOOL_DEPARTMENTS.includes(department as (typeof SCHOOL_DEPARTMENTS)[number]) && (
                  <option value={department}>{department}</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Year
              </label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                {!YEARS.includes(year) && <option value={year}>{year}</option>}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Hostel / Campus Details
            </label>
            <input
              type="text"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Hostel Block B · Room 204"
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
            />
          </div>

          {profileMessage && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                profileMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {profileMessage.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{profileMessage.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {savingProfile ? 'Saving Profile...' : 'Save Profile Changes'}
          </button>
        </form>

        {/* Right Column: Password Security + Booking Preferences */}
        <div className="lg:col-span-5 space-y-6">
          {/* Account Security & Password */}
          <form
            onSubmit={handleSavePassword}
            className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <KeyRound className="w-4 h-4 text-emerald-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Sign-In &amp; Password</h2>
                <p className="text-xs text-slate-500">
                  Manage how you log in across laptops and phones.
                </p>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <span>Student ID / .edu.in Login</span>
                <span
                  className={`font-semibold ${
                    hasPassword ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {hasPassword === null
                    ? 'Checking...'
                    : hasPassword
                      ? 'Password Configured'
                      : 'Not set yet'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200">
                <span>1-Tap Login on This Device</span>
                <button
                  type="button"
                  disabled={savingDevice}
                  onClick={async () => {
                    setSavingDevice(true);
                    try {
                      if (isDeviceSaved) {
                        await onForgetDevice();
                      } else {
                        await onSaveDevice();
                      }
                    } finally {
                      setSavingDevice(false);
                    }
                  }}
                  className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                    isDeviceSaved
                      ? 'bg-emerald-100 text-emerald-800 hover:bg-red-50 hover:text-red-700'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {savingDevice
                    ? 'Updating...'
                    : isDeviceSaved
                      ? 'Saved (Tap to Remove)'
                      : 'Save Account on Device'}
                </button>
              </div>
            </div>

            {hasPassword && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  placeholder="Enter current password"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={4}
                  placeholder="Min 4 chars"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={4}
                  placeholder="Repeat password"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            {passwordMessage && (
              <div
                className={`p-3 rounded-xl border text-xs ${
                  passwordMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {passwordMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingPassword}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {savingPassword
                ? 'Updating...'
                : hasPassword
                  ? 'Change Password'
                  : 'Set Account Password'}
            </button>
          </form>

          {/* Booking Preferences & Saved Squad */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <Sliders className="w-4 h-4 text-emerald-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Booking Shortcuts &amp; Saved Squad
                </h2>
                <p className="text-xs text-slate-500">
                  Pre-fill late-night UPI and frequent teammate Roll Nos in Step 3.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Favorite Campus Sport
                </label>
                <select
                  value={favoriteSportId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFavoriteSportId(next);
                    handleSavePreferences(next, defaultUpiId, savedTeammates);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                >
                  <option value="">No default preference</option>
                  {sports.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Late-Night UPI Handle (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={defaultUpiId}
                    onChange={(e) => setDefaultUpiId(e.target.value)}
                    placeholder="e.g. aarav@okaxis"
                    className="flex-1 min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleSavePreferences(favoriteSportId, defaultUpiId, savedTeammates)
                    }
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Saved Teammates Picker */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Users className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Frequent Teammate IDs ({savedTeammates.length}/8)</span>
                </div>

                <input
                  type="text"
                  value={teammateSearch}
                  onChange={(e) => setTeammateSearch(e.target.value)}
                  placeholder="Search active student Roll No or name to save..."
                  className="w-full min-h-[42px] px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-700"
                />

                {filteredDirectory.length > 0 && (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                    {filteredDirectory.map((entry) => (
                      <button
                        key={entry.rollNo}
                        type="button"
                        onClick={() => handleAddSavedTeammate(entry)}
                        className="w-full min-h-[40px] px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-white cursor-pointer text-xs"
                      >
                        <span className="truncate">
                          <strong className="font-mono text-slate-900">{entry.rollNo}</strong>{' '}
                          <span className="text-slate-600">· {entry.name}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold shrink-0">
                          <Plus className="w-3.5 h-3.5" />
                          Save
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {savedTeammates.length > 0 ? (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                    {savedTeammates.map((tm) => (
                      <div
                        key={tm.rollNo}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-slate-50/70"
                      >
                        <span className="truncate">
                          <strong className="font-mono text-slate-900">{tm.rollNo}</strong>{' '}
                          <span className="text-slate-600">· {tm.name}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSavedTeammate(tm.rollNo)}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                          aria-label={`Remove ${tm.rollNo}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    No saved teammates yet. Add regular partners above for 1-tap squad fill when booking.
                  </p>
                )}
              </div>

              {prefsSavedNotice && (
                <p className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {prefsSavedNotice}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
