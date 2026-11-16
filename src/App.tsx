import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Compass,
  LayoutGrid,
  Lock,
  LogOut,
  Settings,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type {
  Booking,
  BookingPolicy,
  Sport,
  Student,
  TimeSlot,
} from './types';
import { ALL_TIME_SLOTS } from './lib/schedule';
import {
  clearGmailAccessToken,
  getGmailAccessToken,
  getGmailConnectedEmail,
  initGmailAuth,
  subscribeLivePulse,
} from './lib/firebase';
import {
  getSavedAccounts,
  removeSavedAccount,
  upsertSavedAccount,
  type SavedAccountEntry,
} from './lib/preferences';
import { LoginView } from './components/LoginView';
import {
  BookingPortal,
  type BookingPrefillPayload,
} from './components/BookingPortal';
import {
  CourtBookingsView,
  type SlotBookShortcut,
} from './components/CourtBookingsView';
import { WalkInDeskView } from './components/WalkInDeskView';
import { MyBookingsView } from './components/MyBookingsView';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
import { AdminDashboard } from './components/AdminDashboard';
import { SecurityDashboard } from './components/SecurityDashboard';
import { SportXLogo } from './components/SportXLogo';

type AppTab = 'book' | 'bookings' | 'my-bookings' | 'rules' | 'settings';

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
  facilityRules: [
    {
      id: 'rule-arrival',
      title: '10-Minute Early Arrival',
      description:
        'The booking creator and listed teammates must arrive at the facility desk at least 10 minutes before slot start with college ID cards.',
    },
    {
      id: 'rule-equipment',
      title: 'Mandatory Sport Equipment & Non-Marking Shoes',
      description:
        'Players must bring personal rackets, balls, cues, and wear non-marking court shoes inside indoor arenas.',
    },
    {
      id: 'rule-cancellation',
      title: 'Finalized Bookings Policy',
      description:
        'Once booked, reservations cannot be cancelled online. Only Sports Admin or the Walk-In Desk can cancel confirmed slots.',
    },
    {
      id: 'rule-college-cancel',
      title: 'College Cancellation Authority',
      description:
        'Your booking can be cancelled by the college administration at any time with a valid reason (such as tournaments, team training, or maintenance).',
    },
  ],
};

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountEntry[]>(() =>
    getSavedAccounts()
  );

  const [student, setStudent] = useState<Student | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem('campusarena_admin_token')
  );
  const [securityMode, setSecurityMode] = useState(false);
  const [securityToken, setSecurityToken] = useState<string | null>(() =>
    sessionStorage.getItem('campusarena_security_token')
  );
  const [walkInMode, setWalkInMode] = useState(false);

  const [activeTab, setActiveTab] = useState<AppTab>('book');
  const [portalResetKey, setPortalResetKey] = useState(0);
  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null);
  const [prefillBooking, setPrefillBooking] = useState<BookingPrefillPayload | null>(null);

  const [sports, setSports] = useState<Sport[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(ALL_TIME_SLOTS);
  const [policy, setPolicy] = useState<BookingPolicy>(DEFAULT_POLICY);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const [syncConnected, setSyncConnected] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [gmailConnectedEmail, setGmailConnectedEmail] = useState<string | null>(() =>
    getGmailConnectedEmail()
  );
  const [gmailAutoSendConfirmed, setGmailAutoSendConfirmed] = useState(false);

  useEffect(() => {
    const unsub = initGmailAuth(
      (user) => {
        setGmailConnectedEmail(user.email || getGmailConnectedEmail() || null);
      },
      () => {
        setGmailConnectedEmail(null);
        setGmailAutoSendConfirmed(false);
      }
    );
    return () => unsub();
  }, []);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (sessionToken) {
        headers.set('Authorization', `Bearer ${sessionToken}`);
      }
      return fetch(input, { ...init, headers });
    },
    [sessionToken]
  );

  const fetchFacilities = useCallback(async () => {
    if (!sessionToken) return;
    setLoadingFacilities(true);
    try {
      const res = await authFetch('/api/facilities');
      if (res.ok) {
        const data = await res.json();
        setSports(data.sports || []);
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
  }, [authFetch, sessionToken]);

  const fetchMyBookings = useCallback(
    async (rollNo: string) => {
      if (!sessionToken) return;
      setLoadingBookings(true);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const res = await authFetch(
          `/api/bookings/mine?rollNo=${encodeURIComponent(rollNo)}&tzOffset=${tzOffset}`
        );
        if (res.ok) {
          const data = await res.json();
          setMyBookings(data.bookings || []);
        }
      } catch {
        // ignore
      } finally {
        setLoadingBookings(false);
      }
    },
    [authFetch, sessionToken]
  );

  // Real-time authenticated SSE sync across Admin, Security Gate, and Student devices
  useEffect(() => {
    const activeStreamUrl =
      adminToken
        ? `/api/events?adminToken=${encodeURIComponent(adminToken)}`
        : securityMode && securityToken
          ? `/api/events?securityToken=${encodeURIComponent(securityToken)}`
          : sessionToken
            ? `/api/events?token=${encodeURIComponent(sessionToken)}`
            : null;

    if (!activeStreamUrl) {
      setSyncConnected(false);
      return;
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(activeStreamUrl);
      es.onopen = () => setSyncConnected(true);
      es.addEventListener('sync', (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data);
          setSyncConnected(true);
          if (
            parsed.type === 'signup:otp_requested' &&
            parsed.otpId &&
            adminToken &&
            gmailAutoSendConfirmed
          ) {
            const accessToken = getGmailAccessToken();
            if (accessToken) {
              fetch('/api/admin/gmail/send-otp', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-admin-token': adminToken,
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  otpId: parsed.otpId,
                  senderEmail: gmailConnectedEmail || getGmailConnectedEmail() || '',
                }),
              })
                .then(async (res) => {
                  if (res.status === 401) {
                    const body = await res.json().catch(() => ({}));
                    if (body?.reconnectRequired) {
                      clearGmailAccessToken();
                      setGmailConnectedEmail(null);
                      setGmailAutoSendConfirmed(false);
                    }
                  }
                  setSyncVersion((v) => v + 1);
                })
                .catch(() => {});
            }
          }
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
  }, [
    sessionToken,
    adminToken,
    securityMode,
    securityToken,
    gmailAutoSendConfirmed,
    gmailConnectedEmail,
  ]);

  useEffect(() => {
    if (student && sessionToken) {
      fetchFacilities();
    }
  }, [student, sessionToken, fetchFacilities, syncVersion]);

  useEffect(() => {
    if (student && sessionToken) {
      fetchMyBookings(student.rollNo);
    }
  }, [student, sessionToken, fetchMyBookings, syncVersion]);

  // Keep student roster status synced in real time if Admin adds/removes/suspends them
  useEffect(() => {
    if (!sessionToken || !student || syncVersion === 0) return;
    authFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.student) {
          setStudent(data.student);
        }
      })
      .catch(() => {});
  }, [syncVersion, sessionToken, authFetch]);

  const handleEmailPasswordLogin = async (
    identifier: string,
    password: string,
    saveDevice: boolean
  ): Promise<string | null> => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, saveDevice }),
      });
      const data = await res.json();
      if (!res.ok) {
        return data.error || 'Could not sign in with that Student ID or .edu.in email.';
      }
      if (saveDevice && data.deviceKey && data.student) {
        setSavedAccounts(
          upsertSavedAccount({
            rollNo: data.student.rollNo,
            name: data.student.name,
            email: data.student.email,
            department: data.student.department,
            deviceKey: data.deviceKey,
            savedAt: new Date().toISOString(),
          })
        );
      }
      setSessionToken(data.token);
      setStudent(data.student);
      setHighlightedBookingId(null);
      setPrefillBooking(null);
      setPortalResetKey((k) => k + 1);
      setActiveTab('book');
      return null;
    } catch {
      return 'Network error signing in. Please try again.';
    }
  };

  const handleRequestSignupOtp = async (payload: {
    email: string;
    password: string;
    name: string;
    phone: string;
    rollNo: string;
  }): Promise<{
    otpId?: string;
    email?: string;
    dispatchStatus?: 'pending' | 'sending' | 'sent' | 'failed';
    sentFromEmail?: string | null;
    dispatchError?: string | null;
    error?: string;
  }> => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/register/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || 'Could not initiate verification code.' };
      }
      return {
        otpId: data.otpId,
        email: data.email,
        dispatchStatus: data.dispatchStatus || 'pending',
        sentFromEmail: data.sentFromEmail || null,
        dispatchError: data.dispatchError || null,
      };
    } catch {
      return { error: 'Network error requesting verification code. Please try again.' };
    }
  };

  const handleVerifySignupOtp = async (payload: {
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
  }): Promise<string | null> => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/register/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return data.error || 'Invalid verification code or could not create account.';
      }
      if (payload.saveDevice && data.deviceKey && data.student) {
        setSavedAccounts(
          upsertSavedAccount({
            rollNo: data.student.rollNo,
            name: data.student.name,
            email: data.student.email,
            department: data.student.department,
            deviceKey: data.deviceKey,
            savedAt: new Date().toISOString(),
          })
        );
      }
      setSessionToken(data.token);
      setStudent(data.student);
      setHighlightedBookingId(null);
      setPrefillBooking(null);
      setPortalResetKey((k) => k + 1);
      setActiveTab('book');
      return null;
    } catch {
      return 'Network error verifying code. Please try again.';
    }
  };

  const handleQuickLogin = async (entry: SavedAccountEntry): Promise<string | null> => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/quick-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNo: entry.rollNo, deviceKey: entry.deviceKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
          setSavedAccounts(removeSavedAccount(entry.rollNo));
        }
        return data.error || 'Saved quick-login failed. Sign in with password once.';
      }
      setSessionToken(data.token);
      setStudent(data.student);
      setHighlightedBookingId(null);
      setPrefillBooking(null);
      setPortalResetKey((k) => k + 1);
      setActiveTab('book');
      return null;
    } catch {
      return 'Network error during quick sign-in.';
    }
  };

  const handleForgetSavedAccount = async (entry: SavedAccountEntry) => {
    setSavedAccounts(removeSavedAccount(entry.rollNo));
    await fetch('/api/auth/forget-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNo: entry.rollNo, deviceKey: entry.deviceKey }),
    }).catch(() => {});
  };

  const handleSaveCurrentDevice = async (): Promise<boolean> => {
    if (!student) return false;
    try {
      const res = await authFetch('/api/auth/save-device', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.deviceKey) return false;
      setSavedAccounts(
        upsertSavedAccount({
          rollNo: student.rollNo,
          name: student.name,
          email: student.email,
          department: student.department,
          deviceKey: data.deviceKey,
          savedAt: new Date().toISOString(),
        })
      );
      return true;
    } catch {
      return false;
    }
  };

  const handleSignOutAll = () => {
    setSessionToken(null);
    setStudent(null);
    setMyBookings([]);
    setHighlightedBookingId(null);
    setPrefillBooking(null);
    setAuthError(null);
    setActiveTab('book');
  };

  const handleBookingCreated = (newBooking: Booking) => {
    setMyBookings((prev) => [
      newBooking,
      ...prev.filter((b) => b.id !== newBooking.id),
    ]);
    setHighlightedBookingId(newBooking.id);
    setActiveTab('my-bookings');
    if (student) {
      fetchMyBookings(student.rollNo);
    }
  };

  const handleSelectFreeSlotFromBookings = (req: SlotBookShortcut) => {
    setPrefillBooking({
      sportId: req.sportId,
      courtId: req.courtId,
      slotId: req.slotId,
    });
    setActiveTab('book');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (adminMode) {
    return (
      <AdminDashboard
        timeSlots={timeSlots}
        syncVersion={syncVersion}
        syncConnected={syncConnected}
        gmailConnectedEmail={gmailConnectedEmail}
        gmailAutoSendConfirmed={gmailAutoSendConfirmed}
        onGmailStateChange={(email, autoConfirmed) => {
          setGmailConnectedEmail(email);
          setGmailAutoSendConfirmed(autoConfirmed);
        }}
        onAdminTokenChange={setAdminToken}
        onExitAdmin={() => setAdminMode(false)}
        onOpenSecurity={() => {
          setAdminMode(false);
          setSecurityMode(true);
        }}
        onFacilitiesUpdated={fetchFacilities}
      />
    );
  }

  if (securityMode) {
    return (
      <SecurityDashboard
        syncVersion={syncVersion}
        syncConnected={syncConnected}
        onSecurityTokenChange={setSecurityToken}
        onExitSecurity={() => setSecurityMode(false)}
      />
    );
  }

  if (walkInMode) {
    return (
      <WalkInDeskView
        onBackToLogin={() => setWalkInMode(false)}
        onOpenAdmin={() => {
          setWalkInMode(false);
          setAdminMode(true);
        }}
        onOpenSecurity={() => {
          setWalkInMode(false);
          setSecurityMode(true);
        }}
        backLabel={student ? 'Back to Portal' : 'Student Login'}
      />
    );
  }

  if (!student) {
    return (
      <LoginView
        authError={authError}
        savedAccounts={savedAccounts}
        onQuickLogin={handleQuickLogin}
        onForgetSavedAccount={handleForgetSavedAccount}
        onEmailPasswordLogin={handleEmailPasswordLogin}
        onRequestSignupOtp={handleRequestSignupOtp}
        onVerifySignupOtp={handleVerifySignupOtp}
        onUnlockedWalkIn={() => setWalkInMode(true)}
        onUnlockedSecurity={(tok) => {
          setSecurityToken(tok);
          setSecurityMode(true);
        }}
        onUnlockedAdmin={(tok) => {
          setAdminToken(tok);
          setAdminMode(true);
        }}
      />
    );
  }

  const confirmedCount = myBookings.filter((b) => b.status === 'confirmed').length;
  const currentSavedEntry =
    savedAccounts.find((a) => a.rollNo === student.rollNo.toUpperCase()) || null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Desktop 3-Zone Top Bar & Compact Mobile Header */}
      <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('book')}
            className="shrink-0 cursor-pointer"
          >
            <SportXLogo size="md" />
          </button>

          {/* Desktop Center Navigation */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('book')}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'book'
                  ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Book Court
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bookings')}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'bookings'
                  ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Bookings
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('my-bookings');
                fetchMyBookings(student.rollNo);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'my-bookings'
                  ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              My Bookings ({confirmedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'rules'
                  ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Facility Rules
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'settings'
                  ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Settings
            </button>
          </nav>

          {/* Right Action Cluster */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className="md:hidden min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Facility Rules"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            </button>

            <button
              type="button"
              onClick={() => setWalkInMode(true)}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Walk-In Desk (No Login)"
            >
              <Users className="w-3.5 h-3.5 text-emerald-700" />
              <span className="hidden sm:inline">Walk-In</span>
            </button>

            <button
              type="button"
              onClick={() => setSecurityMode(true)}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Security Gate Check-In Console"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-700" />
              <span className="hidden sm:inline">Gate</span>
            </button>

            <button
              type="button"
              onClick={() => setAdminMode(true)}
              className="hidden md:inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>

            <button
              type="button"
              onClick={handleSignOutAll}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 md:hidden" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {student.status !== 'active' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5">
            <div
              className={`rounded-xl border px-4 py-3.5 flex items-start gap-3 text-xs ${
                student.status === 'suspended' || student.status === 'expired'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">
                  {student.status === 'expired'
                    ? `1-Year Roster Subscription Expired (${student.rollNo})`
                    : student.status === 'suspended'
                      ? `Account Suspended (${student.rollNo})`
                      : `ID Pending Admin Roster Activation (${student.rollNo})`}
                </p>
                <p>
                  {student.status === 'expired'
                    ? `Your 1-year Sports Roster pass expired${student.subscriptionEndDate ? ` on ${student.subscriptionEndDate}` : ''}. Court booking is locked until Sports Admin renews your subscription in the Roster.`
                    : student.status === 'suspended'
                      ? 'Your Roll No is currently suspended in the official Admin Sports Roster. Court booking is disabled until reinstated.'
                      : 'Your login account works, but your Roll No is not active in the official Admin Sports Roster yet. You can browse availability now, and court booking unlocks automatically as soon as Sports Admin imports or activates your Roll No.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {student.isBanned && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 flex items-start gap-3 text-xs text-red-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
              <div className="space-y-0.5">
                <p className="font-bold">
                  Temporary Sports Ban Active ({student.rollNo}) · Until {student.banUntil}
                </p>
                <p>
                  {student.banScope === 'all'
                    ? 'You are temporarily restricted from booking or joining teammates across all sports.'
                    : `Restricted sports: ${(student.bannedSports || [])
                        .map((id) => sports.find((s) => s.id === id)?.name || id)
                        .join(', ')}. You cannot book or be added to teammate rosters for those sports.`}
                  {student.banReason ? ` Reason: ${student.banReason}` : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {loadingFacilities && sports.length === 0 ? (
          <div className="max-w-7xl mx-auto px-6 py-16 text-center text-sm text-slate-500">
            Loading campus sports facilities...
          </div>
        ) : activeTab === 'book' ? (
          <BookingPortal
            student={student}
            sports={sports}
            timeSlots={timeSlots}
            policy={policy}
            syncConnected={syncConnected}
            syncVersion={syncVersion}
            prefillBooking={prefillBooking}
            onClearPrefill={() => setPrefillBooking(null)}
            authFetch={authFetch}
            onBookingCreated={handleBookingCreated}
            resetKey={portalResetKey}
          />
        ) : activeTab === 'bookings' ? (
          <CourtBookingsView
            student={student}
            sports={sports}
            timeSlots={timeSlots}
            policy={policy}
            syncVersion={syncVersion}
            authFetch={authFetch}
            onSelectFreeSlot={handleSelectFreeSlotFromBookings}
          />
        ) : activeTab === 'my-bookings' ? (
          <div className="pb-20 md:pb-8">
            <MyBookingsView
              student={student}
              bookings={myBookings}
              sports={sports}
              policy={policy}
              highlightedBookingId={highlightedBookingId}
              loading={loadingBookings}
              authFetch={authFetch}
              onRefresh={() => fetchMyBookings(student.rollNo)}
              onBookNew={() => setActiveTab('book')}
            />
          </div>
        ) : activeTab === 'settings' ? (
          <SettingsView
            student={student}
            sports={sports}
            myBookings={myBookings}
            isDeviceSaved={Boolean(currentSavedEntry)}
            onSaveDevice={handleSaveCurrentDevice}
            onForgetDevice={() =>
              currentSavedEntry
                ? handleForgetSavedAccount(currentSavedEntry)
                : Promise.resolve()
            }
            authFetch={authFetch}
            onStudentUpdated={(updated) => setStudent(updated)}
            onViewBookings={() => {
              setActiveTab('my-bookings');
              fetchMyBookings(student.rollNo);
            }}
            onViewRules={() => setActiveTab('rules')}
            onSignOut={handleSignOutAll}
          />
        ) : (
          <div className="pb-20 md:pb-8">
            <RulesView
              sports={sports}
              policy={policy}
              onStartBooking={() => setActiveTab('book')}
            />
          </div>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 h-16"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          onClick={() => setActiveTab('book')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeTab === 'book' ? 'text-emerald-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span>Book</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bookings')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeTab === 'bookings' ? 'text-emerald-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span>Bookings</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('my-bookings');
            fetchMyBookings(student.rollNo);
          }}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeTab === 'my-bookings' ? 'text-emerald-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <CalendarDays className="w-5 h-5" />
          <span>Passes ({confirmedCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeTab === 'settings' ? 'text-emerald-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminMode(true)}
          className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500 cursor-pointer"
        >
          <Lock className="w-5 h-5" />
          <span>Admin</span>
        </button>
      </nav>
    </div>
  );
}
