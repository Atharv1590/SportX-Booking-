import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  CheckCircle2,
  Lock,
  LogIn,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { SavedAccountEntry } from '../lib/preferences';
import { SCHOOL_DEPARTMENTS, type Student } from '../types';
import { StaffAccessModal } from './StaffAccessModal';
import { SportXLogo } from './SportXLogo';

interface LoginViewProps {
  authError: string | null;
  savedAccounts: SavedAccountEntry[];
  onQuickLogin: (entry: SavedAccountEntry) => Promise<string | null>;
  onForgetSavedAccount: (entry: SavedAccountEntry) => Promise<void>;
  onEmailPasswordLogin: (
    identifier: string,
    password: string,
    saveDevice: boolean
  ) => Promise<string | null>;
  onRequestSignupOtp: (payload: {
    email: string;
    password: string;
    name: string;
    phone: string;
    rollNo: string;
  }) => Promise<{
    otpId?: string;
    email?: string;
    dispatchStatus?: 'pending' | 'sending' | 'sent' | 'failed';
    sentFromEmail?: string | null;
    dispatchError?: string | null;
    error?: string;
  }>;
  onVerifySignupOtp: (payload: {
    otpId: string;
    code: string;
    email: string;
    password: string;
    name: string;
    phone: string;
    rollNo: string;
    department: string;
    year: string;
    details: string;
    saveDevice: boolean;
  }) => Promise<string | null>;
  onUnlockedWalkIn: (token: string) => void;
  onUnlockedSecurity: (token: string) => void;
  onUnlockedAdmin: (token: string) => void;
}

export function LoginView({
  authError,
  savedAccounts,
  onQuickLogin,
  onForgetSavedAccount,
  onEmailPasswordLogin,
  onRequestSignupOtp,
  onVerifySignupOtp,
  onUnlockedWalkIn,
  onUnlockedSecurity,
  onUnlockedAdmin,
}: LoginViewProps) {
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [signupStep, setSignupStep] = useState<'form' | 'verify-otp'>('form');
  const [pendingOtpId, setPendingOtpId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpDeliveryStatus, setOtpDeliveryStatus] = useState<
    'pending' | 'sending' | 'sent' | 'failed' | 'verified'
  >('pending');
  const [otpSenderEmail, setOtpSenderEmail] = useState<string | null>(null);
  const [otpDeliveryError, setOtpDeliveryError] = useState<string | null>(null);
  const [resendingOtp, setResendingOtp] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [department, setDepartment] = useState<string>('SoT');
  const [year, setYear] = useState('3rd Year');
  const [details, setDetails] = useState('');
  const [saveDevice, setSaveDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [quickBusyRoll, setQuickBusyRoll] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'signup' || signupStep !== 'verify-otp' || !pendingOtpId) return;
    let active = true;

    const pollStatus = async () => {
      try {
        const res = await fetch(
          `/api/auth/register/otp-status?otpId=${encodeURIComponent(pendingOtpId)}`
        );
        if (!res.ok || !active) return;
        const data = await res.json();
        if (!active) return;
        if (data.status) setOtpDeliveryStatus(data.status);
        if (data.sentFromEmail) setOtpSenderEmail(data.sentFromEmail);
        if (data.lastError) setOtpDeliveryError(data.lastError);
      } catch {
        // ignore transient poll errors
      }
    };

    pollStatus();
    const timer = setInterval(pollStatus, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mode, signupStep, pendingOtpId]);

  const handleQuickTap = async (entry: SavedAccountEntry) => {
    setFormError(null);
    setQuickBusyRoll(entry.rollNo);
    try {
      const err = await onQuickLogin(entry);
      if (err) setFormError(err);
    } finally {
      setQuickBusyRoll(null);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const err = await onEmailPasswordLogin(identifier, password, saveDevice);
      if (err) setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.endsWith('.edu.in') || !cleanEmail.includes('@')) {
      setFormError('Please use your official .edu.in college Outlook email (e.g. name@college.edu.in).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await onRequestSignupOtp({
        email: cleanEmail,
        password,
        name,
        phone,
        rollNo,
      });
      if (res.error || !res.otpId) {
        setFormError(res.error || 'Could not start email verification.');
        return;
      }
      setPendingOtpId(res.otpId);
      setOtpCode('');
      setOtpDeliveryStatus(res.dispatchStatus || 'pending');
      setOtpSenderEmail(res.sentFromEmail || null);
      setOtpDeliveryError(res.dispatchError || null);
      setSignupStep('verify-otp');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setFormError(null);
    setResendingOtp(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await onRequestSignupOtp({
        email: cleanEmail,
        password,
        name,
        phone,
        rollNo,
      });
      if (res.error || !res.otpId) {
        setFormError(res.error || 'Could not resend 6-digit code.');
        return;
      }
      setPendingOtpId(res.otpId);
      setOtpCode('');
      setOtpDeliveryStatus(res.dispatchStatus || 'pending');
      setOtpSenderEmail(res.sentFromEmail || null);
      setOtpDeliveryError(res.dispatchError || null);
    } finally {
      setResendingOtp(false);
    }
  };

  const handleOtpVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingOtpId) return;
    setFormError(null);
    const cleanCode = otpCode.replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setFormError('Enter the 6-digit verification code sent to your email.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const err = await onVerifySignupOtp({
        otpId: pendingOtpId,
        code: cleanCode,
        email: cleanEmail,
        password,
        name,
        phone,
        rollNo,
        department,
        year,
        details,
        saveDevice,
      });
      if (err) setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = formError || authError;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
          <SportXLogo size="md" />

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setStaffModalOpen(true)}
              className="inline-flex items-center gap-2 min-h-[38px] px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              Admin Login
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between py-1">
            <div className="space-y-5">
              <div className="space-y-2.5">
                <p className="text-xs font-semibold tracking-wide text-emerald-700">
                  Collegiate Athletics &amp; Recreation
                </p>
                <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
                  Reserve campus courts in real time with verified teammates.
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Morning sessions open today at 3:00 AM and evening sessions open at 8:00 AM across all campus courts. Standard hours run until 11:00 PM free; floodlit late-night play (11:00 PM – 4:00 AM) is bookable via UPI or card.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-5 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Login Account &amp; 1-Year Sports Roster Pass
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Sign up with your .edu.in Outlook email to manage your profile anytime. Booking unlocks when your Roll No has an active 1-year subscription in the Official Sports Roster.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200">
                  <div>
                    <p className="text-lg sm:text-xl font-bold text-slate-900 font-mono tabular-nums">
                      3:00 AM
                    </p>
                    <p className="text-xs text-slate-500">Morning Unlock</p>
                  </div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold text-slate-900 font-mono tabular-nums">
                      8:00 AM
                    </p>
                    <p className="text-xs text-slate-500">Evening Unlock</p>
                  </div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold text-slate-900 font-mono tabular-nums">
                      36
                    </p>
                    <p className="text-xs text-slate-500">Courts &amp; Tables</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>Weekdays 5:00 AM–9:30 AM &amp; 4:00 PM–11:00 PM</span>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setIdentifier('23CS101');
                  setPassword('campus123');
                  setFormError(null);
                }}
                className="text-emerald-700 hover:text-emerald-800 font-semibold underline underline-offset-4 cursor-pointer"
              >
                Fill sample login (23CS101)
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 flex flex-col justify-center space-y-5">
            {/* Saved Accounts on This Device (1-Tap Login Without Password) */}
            {savedAccounts.length > 0 && (
              <div className="space-y-2.5 border-b border-slate-200 pb-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                    <BookmarkCheck className="w-4 h-4 text-emerald-700" />
                    Saved Accounts on This Device
                  </span>
                  <span className="text-[11px] text-slate-500">Tap to enter directly</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {savedAccounts.map((entry) => {
                    const busy = quickBusyRoll === entry.rollNo;
                    return (
                      <div
                        key={entry.rollNo}
                        className="flex items-center justify-between gap-2 p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-xl"
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleQuickTap(entry)}
                          className="flex-1 min-w-0 text-left flex items-center gap-2.5 cursor-pointer disabled:opacity-60"
                        >
                          <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
                            <UserCheck className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">
                              {busy ? 'Signing in...' : entry.name}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-800 truncate">
                              {entry.rollNo} · 1-Tap Login
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => onForgetSavedAccount(entry)}
                          className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer shrink-0"
                          title={`Remove ${entry.rollNo} from this device`}
                          aria-label={`Remove saved account ${entry.rollNo}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Segmented Tabs: Sign In (Student ID / .edu.in Email + Password) vs Sign Up */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setSignupStep('form');
                  setFormError(null);
                }}
                className={`flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setFormError(null);
                }}
                className={`flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                Sign Up (.edu.in)
              </button>
            </div>

            {mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Student ID (Roll No) or .edu.in Outlook Mail
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="23CS101 or name@college.edu.in"
                    className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveDevice}
                    onChange={(e) => setSaveDevice(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-700"
                  />
                  <span>Save account on this device for 1-tap direct login</span>
                </label>

                {displayError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {displayError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                >
                  {submitting ? 'Signing In...' : 'Sign In to Booking Portal'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : signupStep === 'form' ? (
              <form onSubmit={handleSignupSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      College Outlook Email (.edu.in)
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="yourname@college.edu.in"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Create Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 4 characters"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
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
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Riya Deshpande"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Student ID / Roll No
                    </label>
                    <input
                      type="text"
                      required
                      value={rollNo}
                      onChange={(e) => setRollNo(e.target.value.toUpperCase())}
                      placeholder="e.g. 24CS108"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Phone No
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="10-digit mobile"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      School
                    </label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                    >
                      {SCHOOL_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Year
                    </label>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
                    >
                      <option value="1st Year">1st Year</option>
                      <option value="2nd Year">2nd Year</option>
                      <option value="3rd Year">3rd Year</option>
                      <option value="4th Year">4th Year</option>
                      <option value="Postgraduate">Postgraduate</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Hostel / Additional Details
                  </label>
                  <input
                    type="text"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="e.g. Hostel H4 · Room 212 or Day Scholar"
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveDevice}
                    onChange={(e) => setSaveDevice(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-700"
                  />
                  <span>Save my account on this device for 1-tap login</span>
                </label>

                {displayError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {displayError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                >
                  {submitting
                    ? 'Requesting 6-Digit Code...'
                    : 'Send 6-Digit Verification Code & Continue'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleOtpVerifySubmit} className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSignupStep('form');
                      setFormError(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Edit Sign-Up Details
                  </button>
                  <span className="text-[11px] font-mono font-semibold text-slate-500">
                    {rollNo.trim().toUpperCase()}
                  </span>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Mail className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        Enter 6-Digit Verification Code
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Account creation requires verifying{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {email.trim().toLowerCase()}
                        </span>
                      </p>
                    </div>
                  </div>

                  {otpDeliveryStatus === 'sent' ? (
                    <div className="flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                      <span>
                        6-digit code sent from{' '}
                        <span className="font-mono font-semibold">
                          {otpSenderEmail || 'Admin Gmail'}
                        </span>
                        . Check your inbox (and Spam/Junk) and enter it below.
                      </span>
                    </div>
                  ) : otpDeliveryStatus === 'failed' ? (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                      {otpDeliveryError ||
                        'Could not send email automatically. Ask Admin to check Gmail connection and click Resend Code.'}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-700 shrink-0" />
                      <span>
                        Sending 6-digit verification code via Admin Gmail (if Gmail is not connected yet, ask Admin to connect Gmail or click Resend)...
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    6-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full min-h-[54px] px-4 py-3 text-center text-2xl font-bold font-mono tracking-[0.45em] tabular-nums bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/25 focus:border-emerald-700"
                  />
                </div>

                {displayError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {displayError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="submit"
                    disabled={submitting || otpCode.length !== 6}
                    className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                  >
                    {submitting ? 'Verifying & Creating...' : 'Verify Code & Create Account'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={resendingOtp}
                    onClick={handleResendOtp}
                    className="min-h-[48px] px-4 py-3 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {resendingOtp ? 'Resending...' : 'Resend Code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="w-full bg-white border-t border-slate-200 py-5 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center gap-6">
            <img
              src="/assets/aistudio/image_bd3a3267.png"
              alt="Woxsen Sports Academy"
              referrerPolicy="no-referrer"
              className="h-12 sm:h-14 w-auto object-contain"
            />
            <img
              src="/assets/aistudio/image_9106e6d3.png"
              alt="Woxsen University"
              referrerPolicy="no-referrer"
              className="h-10 sm:h-12 w-auto object-contain"
            />
          </div>
          <p className="text-xs text-slate-500 text-center sm:text-right">
            SportX booking · Official Campus Athletics &amp; Court Operations
          </p>
        </div>
      </footer>

      <StaffAccessModal
        isOpen={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        onUnlockedWalkIn={onUnlockedWalkIn}
        onUnlockedSecurity={onUnlockedSecurity}
        onUnlockedAdmin={onUnlockedAdmin}
      />
    </div>
  );
}

export type { Student };
