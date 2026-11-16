import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import {
  TIME_SLOTS,
  addCourt,
  addSportAdmin,
  addStudentAdmin,
  applyTrainingHours,
  autoAdmitOverduePendingBookings,
  banStudentAdmin,
  blockOrUnblockSlot,
  buildAdminDashboard,
  bulkBlockAdvanceDates,
  bulkBlockOrUnblockSlots,
  bulkImportStudents,
  cancelAdminBooking,
  closeLightRequest,
  createAdminWalkInBooking,
  createBookingTransactional,
  createLightRequest,
  getAdminGmailSmtpCredentials,
  getAvailability,
  getEmailsForBooking,
  getPolicy,
  getRosterDirectory,
  getSecurityGateWindow,
  getSecurityLightRequests,
  getSportsWithCourts,
  getStudentBookings,
  getTodayDateString,
  getWalkInBookings,
  markBookingInCourt,
  markStudentPaid,
  purgeExpiredBookingsOlderThan30Days,
  reassignBookingCourt,
  removeStudentFromRoster,
  saveAdminGmailSmtpConfig,
  searchSecurityBookings,
  toggleStudentStatus,
  unbanStudentAdmin,
  updateCourtDetails,
  updatePolicy,
  updateSecurityGateStatus,
  updateSportConfig,
  updateStudentSubscription,
  validatePlayers,
  verifyAdminPasscode,
  verifySecurityPasscode,
  verifyTrainingOverrideCode,
  verifyWalkInCancelCode,
  verifyWalkInPasscode,
} from './src/db/repository.ts';
import {
  changeStudentPassword,
  claimAndGetOtpForGmailSend,
  createSignupOtpRequest,
  findStudentByFirebaseAuth,
  forgetSavedDeviceForStudent,
  getRecentSignupOtps,
  getSignupOtpPublicStatus,
  getStudentSecurityInfo,
  isEduInEmail,
  loginStudentWithPassword,
  markOtpSendResult,
  quickLoginWithSavedDevice,
  registerOrLinkStudentProfile,
  registerSavedDeviceForStudent,
  registerStudentWithPassword,
  updateStudentProfile,
  verifySignupOtpAndRegister,
} from './src/db/users.ts';
import {
  requireAuth,
  verifyIdTokenString,
  type AuthRequest,
} from './src/middleware/auth.ts';
import { syncLivePulseToFirestore } from './src/lib/firestoreSync.ts';
import type { Booking, BookingPolicy, SecurityCheckInStatus } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const sseClients = new Set<express.Response>();
const adminSseClients = new Set<express.Response>();
const activeAdminTokens = new Set<string>();
const activeSecurityTokens = new Set<string>();
const activeWalkInTokens = new Set<string>();

function broadcastEvent(eventType: string, payload: Record<string, unknown> = {}) {
  const data = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
    connectedClientsCount: sseClients.size,
    ...payload,
  });
  for (const client of sseClients) {
    try {
      client.write(`event: sync\ndata: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
      adminSseClients.delete(client);
    }
  }
  void syncLivePulseToFirestore(eventType, payload);
}

function broadcastAdminEvent(eventType: string, payload: Record<string, unknown> = {}) {
  const data = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
    connectedClientsCount: sseClients.size,
    ...payload,
  });
  for (const client of adminSseClients) {
    try {
      client.write(`event: sync\ndata: ${data}\n\n`);
    } catch {
      adminSseClients.delete(client);
      sseClients.delete(client);
    }
  }
}

function buildOtpRawEmail(params: {
  to: string;
  fromEmail?: string;
  studentName: string;
  rollNo: string;
  code: string;
}): string {
  const cleanTo = params.to.replace(/[\r\n]/g, '').trim();
  const cleanFrom = params.fromEmail?.replace(/[\r\n]/g, '').trim();
  const subject = `SportX Verification Code: ${params.code}`;
  const textBody = [
    `Hello ${params.studentName},`,
    '',
    `Your 6-digit SportX booking verification code for Student ID ${params.rollNo} is:`,
    '',
    `    ${params.code}`,
    '',
    'Enter this code on the Sign Up screen to finish creating your student account. This code expires in 10 minutes.',
    '',
    'If you did not request this code, you can ignore this email.',
    '',
    'SportX Campus Athletics & Court Operations',
  ].join('\r\n');
  const lines = [
    ...(cleanFrom ? [`From: SportX Athletics <${cleanFrom}>`] : []),
    `To: ${cleanTo}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    textBody,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function createGmailSmtpTransport(senderEmail: string, appPassword: string) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: {
      user: senderEmail.trim().toLowerCase(),
      pass: appPassword.replace(/\s+/g, '').trim(),
    },
  });
}

async function sendOtpEmailViaSmtp(params: {
  senderEmail: string;
  appPassword: string;
  toEmail: string;
  studentName: string;
  rollNo: string;
  code: string;
}): Promise<void> {
  const transporter = createGmailSmtpTransport(params.senderEmail, params.appPassword);
  const safeName = params.studentName.replace(/[<>]/g, '').trim() || 'Student';
  const safeRoll = params.rollNo.replace(/[<>]/g, '').trim();
  await transporter.sendMail({
    from: `SportX Athletics <${params.senderEmail}>`,
    to: params.toEmail,
    subject: `SportX Verification Code: ${params.code}`,
    text: [
      `Hello ${safeName},`,
      '',
      `Your 6-digit SportX booking verification code for Student ID ${safeRoll} is: ${params.code}`,
      '',
      'Enter this 6-digit code on the Sign Up screen to create your student account. This code expires in 10 minutes.',
      '',
      'SportX Campus Athletics & Court Operations',
    ].join('\n'),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #0f172a; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;">
        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 0.06em;">SportX Campus Athletics</p>
        <h2 style="margin: 0 0 14px; font-size: 20px; color: #0f172a;">Verify your .edu.in student account</h2>
        <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: #334155;">Hello <strong>${safeName}</strong>, use the 6-digit verification code below to finish creating your SportX booking account for Student ID <strong style="font-family: monospace;">${safeRoll}</strong>.</p>
        <div style="margin: 20px 0; padding: 18px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; text-align: center;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; font-weight: 800; letter-spacing: 0.28em; color: #0f172a;">${params.code}</span>
        </div>
        <p style="margin: 0; font-size: 12px; color: #64748b;">This verification code expires in 10 minutes. If you did not attempt to sign up on SportX, you can safely ignore this email.</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendSportXCancellationEmails(
  bookingsToNotify: Booking[],
  fallbackReason?: string
): Promise<void> {
  if (!bookingsToNotify || bookingsToNotify.length === 0) return;
  try {
    const creds = await getAdminGmailSmtpCredentials();
    if (!creds.senderEmail || !creds.appPassword) {
      return;
    }
    const transporter = createGmailSmtpTransport(creds.senderEmail, creds.appPassword);

    for (const bk of bookingsToNotify) {
      const recipients = await getEmailsForBooking(bk);
      if (recipients.length === 0) continue;

      const reasonText =
        (bk.cancelReason || fallbackReason || 'Cancelled by SportX Administration').trim();
      const codeLabel = bk.bookingCode ? `#${bk.bookingCode}` : bk.id;
      const subject = `Booking Cancelled by SportX — ${bk.sportName} (${bk.courtName}, ${bk.date})`;
      const playerSummary = (bk.players || [])
        .map((p) => `${p.name} (${p.rollNo})`)
        .join(', ');

      try {
        await transporter.sendMail({
          from: `SportX Athletics <${creds.senderEmail}>`,
          to: recipients[0],
          ...(recipients.length > 1 ? { bcc: recipients.slice(1) } : {}),
          subject,
          text: [
            `Hello ${bk.bookedByName},`,
            '',
            `Your SportX court booking (${codeLabel}) has been cancelled by SportX.`,
            '',
            `Reason: ${reasonText}`,
            `Sport: ${bk.sportName}`,
            `Court / Table: ${bk.courtName}`,
            `Date: ${bk.date}`,
            `Time Slot: ${bk.slotLabel}`,
            ...(playerSummary ? [`Players: ${playerSummary}`] : []),
            '',
            'If you have any questions, please contact the SportX Sports Office.',
            '',
            'SportX Campus Athletics & Court Operations',
          ].join('\n'),
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #dc2626; text-transform: uppercase; letter-spacing: 0.06em;">SportX Booking Notice</p>
              <h2 style="margin: 0 0 12px; font-size: 20px; color: #0f172a;">Booking Cancelled by SportX</h2>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: #334155;">
                Hello <strong>${escapeHtml(bk.bookedByName)}</strong>, your reservation (<span style="font-family: monospace; font-weight: 700;">${escapeHtml(codeLabel)}</span>) was cancelled by <strong>SportX</strong>.
              </p>
              <div style="margin: 0 0 16px; padding: 14px 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;">
                <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.05em;">Reason for Cancellation</p>
                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #7f1d1d;">${escapeHtml(reasonText)}</p>
              </div>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                <tr><td style="padding: 8px 12px; color: #64748b; width: 130px;">Sport</td><td style="padding: 8px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(bk.sportName)}</td></tr>
                <tr><td style="padding: 8px 12px; color: #64748b; border-top: 1px solid #e2e8f0;">Court / Table</td><td style="padding: 8px 12px; font-weight: 600; color: #0f172a; border-top: 1px solid #e2e8f0;">${escapeHtml(bk.courtName)}</td></tr>
                <tr><td style="padding: 8px 12px; color: #64748b; border-top: 1px solid #e2e8f0;">Date</td><td style="padding: 8px 12px; font-weight: 600; color: #0f172a; border-top: 1px solid #e2e8f0;">${escapeHtml(bk.date)}</td></tr>
                <tr><td style="padding: 8px 12px; color: #64748b; border-top: 1px solid #e2e8f0;">Time Slot</td><td style="padding: 8px 12px; font-weight: 600; color: #0f172a; border-top: 1px solid #e2e8f0;">${escapeHtml(bk.slotLabel)}</td></tr>
                ${playerSummary ? `<tr><td style="padding: 8px 12px; color: #64748b; border-top: 1px solid #e2e8f0;">Players</td><td style="padding: 8px 12px; color: #334155; border-top: 1px solid #e2e8f0;">${escapeHtml(playerSummary)}</td></tr>` : ''}
              </table>
              <p style="margin: 16px 0 0; font-size: 12px; color: #64748b;">SportX Campus Athletics &amp; Court Operations</p>
            </div>
          `,
        });
      } catch (mailErr) {
        console.warn('[SportX Mail] Cancellation email send warning:', mailErr);
      }
    }
  } catch (err) {
    console.warn('[SportX Mail] Cancellation mailer error:', err);
  }
}

async function dispatchOtpViaConfiguredSmtp(
  otpId: string,
  explicitResend = false
): Promise<{
  dispatched: boolean;
  status: 'sent' | 'failed' | 'pending';
  sentFromEmail?: string | null;
  error?: string | null;
}> {
  const creds = await getAdminGmailSmtpCredentials();
  if (!creds.senderEmail || !creds.appPassword) {
    return { dispatched: false, status: 'pending', sentFromEmail: null, error: null };
  }
  if (!explicitResend && !creds.autoSend) {
    return { dispatched: false, status: 'pending', sentFromEmail: null, error: null };
  }

  const claimed = await claimAndGetOtpForGmailSend(otpId, explicitResend);
  if (!claimed) {
    return { dispatched: false, status: 'pending', sentFromEmail: creds.senderEmail, error: null };
  }

  try {
    await sendOtpEmailViaSmtp({
      senderEmail: creds.senderEmail,
      appPassword: creds.appPassword,
      toEmail: claimed.email,
      studentName: claimed.name,
      rollNo: claimed.rollNo,
      code: claimed.code,
    });
    await markOtpSendResult(otpId, true, creds.senderEmail, null);
    broadcastAdminEvent('signup:otp_sent', {
      otpId,
      email: claimed.email,
      sentFromEmail: creds.senderEmail,
    });
    return {
      dispatched: true,
      status: 'sent',
      sentFromEmail: creds.senderEmail,
      error: null,
    };
  } catch (error) {
    const err = error as Error;
    const rawMsg = err?.message || 'Gmail SMTP send failed.';
    const friendlyMsg =
      rawMsg.includes('535') || rawMsg.toLowerCase().includes('username and password not accepted')
        ? 'Gmail rejected the App Password (535). Generate a fresh 16-character Google App Password in Admin Gmail Verification.'
        : `Gmail SMTP delivery failed: ${rawMsg.slice(0, 140)}`;
    await markOtpSendResult(otpId, false, creds.senderEmail, friendlyMsg);
    broadcastAdminEvent('signup:otp_failed', { otpId, error: friendlyMsg });
    return {
      dispatched: true,
      status: 'failed',
      sentFromEmail: creds.senderEmail,
      error: friendlyMsg,
    };
  }
}

function getReqTzOffset(req: express.Request): number {
  const raw =
    req.query.tzOffset ??
    req.header('x-tz-offset') ??
    (req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>).tzOffsetMinutes
      : undefined) ??
    0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.header('x-admin-token');
  if (!token || !activeAdminTokens.has(token)) {
    res.status(401).json({ error: 'Unauthorized admin session. Please log in.' });
    return;
  }
  next();
}

function requireSecurity(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.header('x-security-token');
  if (!token || !activeSecurityTokens.has(token)) {
    res.status(401).json({ error: 'Unauthorized gate session. Please sign in at Security Desk.' });
    return;
  }
  next();
}

function requireWalkIn(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.header('x-walkin-token');
  if (!token || !activeWalkInTokens.has(token)) {
    res.status(401).json({ error: 'Unauthorized Walk-In Desk session. Please enter Desk password.' });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Live SSE stream for multi-device synchronization
  app.get('/api/events', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const adminToken = typeof req.query.adminToken === 'string' ? req.query.adminToken : '';
    const securityToken =
      typeof req.query.securityToken === 'string' ? req.query.securityToken : '';
    const walkinToken = typeof req.query.walkinToken === 'string' ? req.query.walkinToken : '';

    const isAdmin = Boolean(adminToken && activeAdminTokens.has(adminToken));
    const isSecurity = Boolean(securityToken && activeSecurityTokens.has(securityToken));
    const isWalkIn = Boolean(walkinToken && activeWalkInTokens.has(walkinToken));

    if (!isAdmin && !isSecurity && !isWalkIn) {
      if (!token) {
        res.status(401).json({ error: 'Authentication required for live sync.' });
        return;
      }
      try {
        await verifyIdTokenString(token);
      } catch {
        res.status(401).json({ error: 'Invalid sync token.' });
        return;
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    if (isAdmin) {
      adminSseClients.add(res);
    }
    res.write(
      `event: sync\ndata: ${JSON.stringify({
        type: 'connected',
        connectedClientsCount: sseClients.size,
      })}\n\n`
    );

    const keepalive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepalive);
        sseClients.delete(res);
        adminSseClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepalive);
      sseClients.delete(res);
      adminSseClients.delete(res);
    });
  });

  // ==================== STUDENT ID / .EDU.IN AUTH & SAVED-DEVICE QUICK LOGIN ====================
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, identifier, password, saveDevice } = req.body as {
        email?: string;
        identifier?: string;
        password?: string;
        saveDevice?: boolean;
      };
      const loginId = (identifier || email || '').trim();
      if (!loginId || loginId.length < 3) {
        res.status(400).json({ error: 'Enter your Student Roll No or .edu.in college email.' });
        return;
      }
      if (!password || password.length < 4) {
        res.status(400).json({ error: 'Please enter your password (at least 4 characters).' });
        return;
      }
      const result = await loginStudentWithPassword(loginId, password, Boolean(saveDevice));
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      res.json({
        student: result.student,
        token: result.token,
        deviceKey: result.deviceKey,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Sign in failed.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, name, phone, rollNo, department, year, details, saveDevice } =
        req.body as {
          email?: string;
          password?: string;
          name?: string;
          phone?: string;
          rollNo?: string;
          department?: string;
          year?: string;
          details?: string;
          saveDevice?: boolean;
        };

      if (!email || !isEduInEmail(email)) {
        res.status(400).json({
          error: 'Please enter your official .edu.in college Outlook email (e.g. name@college.edu.in).',
        });
        return;
      }
      if (!password || password.length < 4) {
        res.status(400).json({ error: 'Create a password with at least 4 characters.' });
        return;
      }
      if (!name || name.trim().length < 2) {
        res.status(400).json({ error: 'Please enter your full name.' });
        return;
      }
      const cleanPhone = (phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        res.status(400).json({ error: 'Please enter a valid 10-digit phone number.' });
        return;
      }
      if (!rollNo || rollNo.trim().length < 4) {
        res.status(400).json({ error: 'Please enter a valid Student ID / Roll No (e.g. 24CS108).' });
        return;
      }

      const result = await registerStudentWithPassword({
        email,
        password,
        name,
        phone: cleanPhone,
        rollNo,
        department: department || 'SoT',
        year: year || '1st Year',
        details: details || 'Registered Student',
        saveDevice: Boolean(saveDevice),
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }

      broadcastEvent('roster:updated', { rollNo: result.student?.rollNo });
      res.status(201).json({
        student: result.student,
        token: result.token,
        deviceKey: result.deviceKey,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to register student account.' });
    }
  });

  app.post('/api/auth/register/request-otp', async (req, res) => {
    try {
      const { email, password, name, phone, rollNo } = req.body as {
        email?: string;
        password?: string;
        name?: string;
        phone?: string;
        rollNo?: string;
      };
      const result = await createSignupOtpRequest({
        email: email || '',
        password: password || '',
        name: name || '',
        phone: phone || '',
        rollNo: rollNo || '',
      });
      if (result.errorStatus || !result.otpId) {
        res.status(result.errorStatus || 400).json({ error: result.errorMessage });
        return;
      }

      // Automatically send via configured server-side Gmail SMTP without requiring Admin browser open
      const smtpAttempt = await dispatchOtpViaConfiguredSmtp(result.otpId, false);
      if (!smtpAttempt.dispatched) {
        broadcastAdminEvent('signup:otp_requested', {
          otpId: result.otpId,
          email: result.email,
          rollNo: result.rollNo,
          name: result.name,
        });
      }

      res.status(201).json({
        otpId: result.otpId,
        email: result.email,
        rollNo: result.rollNo,
        expiresAt: result.expiresAt,
        dispatchStatus: smtpAttempt.status,
        sentFromEmail: smtpAttempt.sentFromEmail || null,
        dispatchError: smtpAttempt.error || null,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Could not initiate verification code.' });
    }
  });

  app.get('/api/auth/register/otp-status', async (req, res) => {
    try {
      const otpId = typeof req.query.otpId === 'string' ? req.query.otpId : '';
      if (!otpId) {
        res.status(400).json({ error: 'otpId is required.' });
        return;
      }
      const status = await getSignupOtpPublicStatus(otpId);
      if (!status) {
        res.status(404).json({ error: 'Verification request not found.' });
        return;
      }
      res.json(status);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to check code delivery status.' });
    }
  });

  app.post('/api/auth/register/verify-otp', async (req, res) => {
    try {
      const {
        otpId,
        code,
        email,
        password,
        name,
        phone,
        rollNo,
        department,
        year,
        details,
        saveDevice,
      } = req.body as {
        otpId?: string;
        code?: string;
        email?: string;
        password?: string;
        name?: string;
        phone?: string;
        rollNo?: string;
        department?: string;
        year?: string;
        details?: string;
        saveDevice?: boolean;
      };
      if (!otpId || !code) {
        res.status(400).json({ error: 'Enter the 6-digit verification code sent to your email.' });
        return;
      }
      const result = await verifySignupOtpAndRegister({
        otpId,
        code,
        email: email || '',
        password: password || '',
        name: name || '',
        phone: phone || '',
        rollNo: rollNo || '',
        department: department || 'SoT',
        year: year || '1st Year',
        details: details || 'Registered Student',
        saveDevice: Boolean(saveDevice),
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo: result.student?.rollNo });
      broadcastAdminEvent('signup:otp_verified', { otpId });
      res.status(201).json({
        student: result.student,
        token: result.token,
        deviceKey: result.deviceKey,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to verify code and create account.' });
    }
  });

  app.post('/api/auth/quick-login', async (req, res) => {
    try {
      const { rollNo, deviceKey } = req.body as { rollNo?: string; deviceKey?: string };
      if (!rollNo || !deviceKey) {
        res.status(400).json({ error: 'Saved student ID and device key are required.' });
        return;
      }
      const result = await quickLoginWithSavedDevice(rollNo, deviceKey);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      res.json({ student: result.student, token: result.token });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Quick login failed.' });
    }
  });

  app.post('/api/auth/save-device', requireAuth, async (req: AuthRequest, res) => {
    try {
      const currentStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      if (!currentStudent) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }
      const deviceKey = await registerSavedDeviceForStudent(currentStudent.id);
      if (!deviceKey) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }
      res.json({ deviceKey });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Could not save quick-login on this device.' });
    }
  });

  app.post('/api/auth/forget-device', async (req, res) => {
    try {
      const { rollNo, deviceKey } = req.body as { rollNo?: string; deviceKey?: string };
      if (rollNo && deviceKey) {
        await forgetSavedDeviceForStudent(rollNo, deviceKey);
      }
      res.json({ ok: true });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Could not remove saved device.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || '';
      const rollHint = req.user?.rollNo || '';
      const student = await findStudentByFirebaseAuth(uid, email, rollHint);
      res.json({
        uid,
        email,
        displayName: req.user?.name || '',
        student,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load profile.' });
    }
  });

  app.post('/api/auth/complete-profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const authEmail = req.user?.email || '';
      const { name, phone, rollNo, department, year, details } = req.body as {
        name?: string;
        phone?: string;
        rollNo?: string;
        department?: string;
        year?: string;
        details?: string;
      };

      if (!name || name.trim().length < 2) {
        res.status(400).json({ error: 'Please enter your full name.' });
        return;
      }
      const cleanPhone = (phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        res.status(400).json({ error: 'Please enter a valid 10-digit phone number.' });
        return;
      }
      if (!rollNo || rollNo.trim().length < 4) {
        res.status(400).json({ error: 'Please enter a valid college Roll No (e.g. 23CS101).' });
        return;
      }

      const result = await registerOrLinkStudentProfile({
        uid,
        email: authEmail,
        name,
        phone: cleanPhone,
        rollNo,
        department: department || 'SoT',
        year: year || '1st Year',
        details: details || 'Registered Student',
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }

      broadcastEvent('roster:updated', { rollNo: result.student?.rollNo });
      res.status(201).json({ student: result.student });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to save student profile.' });
    }
  });

  app.get('/api/auth/security', requireAuth, async (req: AuthRequest, res) => {
    try {
      const student = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      if (!student) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }
      const info = await getStudentSecurityInfo(student.id);
      res.json(info || { hasPassword: false, googleLinked: false });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load security status.' });
    }
  });

  app.patch('/api/auth/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const currentStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      if (!currentStudent) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }

      const { name, phone, department, year, details } = req.body as {
        name?: string;
        phone?: string;
        department?: string;
        year?: string;
        details?: string;
      };

      const result = await updateStudentProfile({
        studentId: currentStudent.id,
        name: name ?? currentStudent.name,
        phone: phone ?? currentStudent.phone,
        department: department ?? currentStudent.department,
        year: year ?? currentStudent.year,
        details: details ?? currentStudent.details,
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }

      broadcastEvent('roster:updated', { rollNo: result.student?.rollNo });
      res.json({ student: result.student });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update profile.' });
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const currentStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      if (!currentStudent) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      const result = await changeStudentPassword({
        studentId: currentStudent.id,
        currentPassword,
        newPassword: newPassword || '',
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }

      res.json({ ok: true, hasPassword: true });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update password.' });
    }
  });

  // ==================== AUTHENTICATED STUDENT FEATURE ROUTES ====================
  app.get('/api/students/directory', requireAuth, async (_req, res) => {
    try {
      const directory = await getRosterDirectory();
      res.json({ students: directory });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to fetch directory.' });
    }
  });

  app.post('/api/students/validate', requireAuth, async (req, res) => {
    try {
      const { date, slotId, playerRollNos, sportId } = req.body as {
        date?: string;
        slotId?: string;
        playerRollNos?: string[];
        sportId?: string;
      };
      if (!date || !slotId || !Array.isArray(playerRollNos)) {
        res.status(400).json({ error: 'date, slotId, and playerRollNos array are required.' });
        return;
      }
      const validation = await validatePlayers(date, slotId, playerRollNos, sportId);
      res.json(validation);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Validation failed.' });
    }
  });

  app.get('/api/facilities', requireAuth, async (_req, res) => {
    try {
      const [sportsList, policy] = await Promise.all([getSportsWithCourts(), getPolicy(false)]);
      res.json({
        sports: sportsList,
        timeSlots: TIME_SLOTS,
        policy,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load facilities.' });
    }
  });

  app.get('/api/availability', requireAuth, async (req, res) => {
    try {
      const tzOffset = Number(req.query.tzOffset ?? 0);
      const date =
        typeof req.query.date === 'string' && req.query.date
          ? req.query.date
          : getTodayDateString(tzOffset);
      const availability = await getAvailability(date);
      res.json({ date, ...availability });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load availability.' });
    }
  });

  app.get('/api/bookings/mine', requireAuth, async (req: AuthRequest, res) => {
    try {
      const linkedStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      if (!linkedStudent) {
        res.json({ bookings: [] });
        return;
      }
      const mine = await getStudentBookings(linkedStudent.rollNo, getReqTzOffset(req));
      res.json({ bookings: mine });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to fetch bookings.' });
    }
  });

  app.post('/api/bookings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        date,
        tzOffsetMinutes,
        sportId,
        courtId,
        slotId,
        bookedByRollNo,
        players,
        rulesAccepted,
        payment,
      } = req.body as {
        date?: string;
        tzOffsetMinutes?: number;
        sportId?: string;
        courtId?: string;
        slotId?: string;
        bookedByRollNo?: string;
        players?: { rollNo: string; name?: string }[];
        rulesAccepted?: boolean;
        payment?: {
          method: 'upi' | 'card';
          upiId?: string;
          cardNumber?: string;
          cardExpiry?: string;
          cardCvv?: string;
          cardHolder?: string;
        } | null;
      };

      const linkedStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      const effectiveRollNo = linkedStudent?.rollNo || bookedByRollNo;

      if (!date || !sportId || !courtId || !slotId || !effectiveRollNo) {
        res.status(400).json({ error: 'Missing required booking selection fields.' });
        return;
      }

      const result = await createBookingTransactional({
        date,
        tzOffsetMinutes: tzOffsetMinutes ?? 0,
        sportId,
        courtId,
        slotId,
        bookedByUid: req.user?.uid || null,
        bookedByRollNo: effectiveRollNo,
        players: Array.isArray(players) ? players : [],
        rulesAccepted: Boolean(rulesAccepted),
        payment: payment ?? null,
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({
          error: result.errorMessage,
          validationResults: result.validationResults,
        });
        return;
      }

      broadcastEvent('booking:created', { date, sportId, courtId, slotId });
      res.status(201).json({ booking: result.booking });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to create booking.' });
    }
  });

  app.post('/api/bookings/:id/in-court', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const linkedStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      const { rollNo, tzOffsetMinutes } = req.body as {
        rollNo?: string;
        tzOffsetMinutes?: number;
      };
      const effectiveRollNo = linkedStudent?.rollNo || rollNo || '';
      if (!effectiveRollNo) {
        res.status(400).json({ error: 'Student ID required for court arrival.' });
        return;
      }
      const result = await markBookingInCourt({
        bookingId: id,
        rollNo: effectiveRollNo,
        tzOffsetMinutes: Number(tzOffsetMinutes ?? 0),
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('booking:checkin', { bookingId: id });
      res.json({ booking: result.booking });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to mark In Court.' });
    }
  });

  app.post('/api/bookings/:id/light-request', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const linkedStudent = await findStudentByFirebaseAuth(
        req.user?.uid || '',
        req.user?.email || '',
        req.user?.rollNo || ''
      );
      const { rollNo, note } = req.body as { rollNo?: string; note?: string };
      const effectiveRollNo = linkedStudent?.rollNo || rollNo || '';
      if (!effectiveRollNo) {
        res.status(400).json({ error: 'Student ID required to request court lights.' });
        return;
      }
      const result = await createLightRequest({
        bookingId: id,
        rollNo: effectiveRollNo,
        note,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('lights:updated', { bookingId: id, requestId: result.request?.id });
      res.status(201).json({ request: result.request, alreadyOpen: result.alreadyOpen });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to send lights request.' });
    }
  });

  app.post('/api/bookings/:id/cancel', requireAuth, async (_req: AuthRequest, res) => {
    res.status(403).json({
      error:
        'Bookings cannot be cancelled from student accounts. Only Sports Admin or the Walk-In Desk can cancel reservations.',
    });
  });

  // ==================== WALK-IN DESK ROUTES (PASSWORD-PROTECTED) ====================
  app.post('/api/walkin/login', async (req, res) => {
    try {
      const { password } = req.body as { password?: string };
      const valid = password ? await verifyWalkInPasscode(password) : false;
      if (!valid) {
        res.status(401).json({ error: 'Invalid Walk-In Desk password.' });
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      activeWalkInTokens.add(token);
      res.json({ token });
    } catch {
      res.status(500).json({ error: 'Unable to authenticate Walk-In Desk session.' });
    }
  });

  app.post('/api/walkin/logout', (req, res) => {
    const token = req.header('x-walkin-token');
    if (token) activeWalkInTokens.delete(token);
    res.json({ ok: true });
  });

  app.get('/api/walkin/facilities', requireWalkIn, async (_req, res) => {
    try {
      const [sportsList, policy] = await Promise.all([getSportsWithCourts(), getPolicy(false)]);
      res.json({
        sports: sportsList,
        timeSlots: TIME_SLOTS,
        policy,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load walk-in facilities.' });
    }
  });

  app.get('/api/walkin/availability', requireWalkIn, async (req, res) => {
    try {
      const tzOffset = Number(req.query.tzOffset ?? 0);
      const date =
        typeof req.query.date === 'string' && req.query.date
          ? req.query.date
          : getTodayDateString(tzOffset);
      const availability = await getAvailability(date);
      res.json({ date, ...availability });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load availability.' });
    }
  });

  app.get('/api/walkin/directory', requireWalkIn, async (_req, res) => {
    try {
      const directory = await getRosterDirectory();
      res.json({ students: directory });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to fetch directory.' });
    }
  });

  app.post('/api/walkin/validate', requireWalkIn, async (req, res) => {
    try {
      const { date, slotId, playerRollNos, sportId } = req.body as {
        date?: string;
        slotId?: string;
        playerRollNos?: string[];
        sportId?: string;
      };
      if (!date || !slotId || !Array.isArray(playerRollNos)) {
        res.status(400).json({ error: 'date, slotId, and playerRollNos array are required.' });
        return;
      }
      const validation = await validatePlayers(date, slotId, playerRollNos, sportId);
      res.json(validation);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Validation failed.' });
    }
  });

  app.post('/api/walkin/book', requireWalkIn, async (req, res) => {
    try {
      const {
        date,
        tzOffsetMinutes,
        sportId,
        courtId,
        slotId,
        bookedByRollNo,
        players,
        rulesAccepted,
        payment,
      } = req.body as {
        date?: string;
        tzOffsetMinutes?: number;
        sportId?: string;
        courtId?: string;
        slotId?: string;
        bookedByRollNo?: string;
        players?: { rollNo: string; name?: string }[];
        rulesAccepted?: boolean;
        payment?: {
          method: 'upi' | 'card';
          upiId?: string;
          cardNumber?: string;
          cardExpiry?: string;
          cardCvv?: string;
          cardHolder?: string;
        } | null;
      };

      const leadRoll = bookedByRollNo || players?.[0]?.rollNo || '';
      if (!date || !sportId || !courtId || !slotId || !leadRoll) {
        res.status(400).json({ error: 'Sport, court, slot, and your Roll No are required.' });
        return;
      }

      const result = await createBookingTransactional({
        date,
        tzOffsetMinutes: tzOffsetMinutes ?? 0,
        sportId,
        courtId,
        slotId,
        bookedByUid: 'walkin-desk',
        bookedByRollNo: leadRoll,
        players: Array.isArray(players) ? players : [],
        rulesAccepted: Boolean(rulesAccepted),
        payment: payment ?? null,
      });

      if (result.errorStatus) {
        res.status(result.errorStatus).json({
          error: result.errorMessage,
          validationResults: result.validationResults,
        });
        return;
      }

      broadcastEvent('booking:created', { date, sportId, courtId, slotId });
      res.status(201).json({ booking: result.booking });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to confirm walk-in booking.' });
    }
  });

  app.get('/api/walkin/bookings', requireWalkIn, async (req, res) => {
    try {
      const tzOffset = Number(req.query.tzOffset ?? 0);
      const date =
        typeof req.query.date === 'string' && req.query.date
          ? req.query.date
          : getTodayDateString(tzOffset);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const list = await getWalkInBookings(date, q);
      res.json({ date, bookings: list });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load walk-in bookings.' });
    }
  });

  app.post('/api/walkin/bookings/:id/cancel', requireWalkIn, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, cancelCode } = req.body as { reason?: string; cancelCode?: string };
      const validCode = cancelCode ? await verifyWalkInCancelCode(cancelCode) : false;
      if (!validCode) {
        res.status(403).json({ error: 'Invalid Walk-In cancellation authorization code.' });
        return;
      }
      const result = await cancelAdminBooking(
        id,
        reason || 'Cancelled at Walk-In Desk',
        'walkin'
      );
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('booking:cancelled', {
        date: result.booking?.date,
        bookingId: result.booking?.id,
      });
      if (result.booking) {
        void sendSportXCancellationEmails([result.booking], reason || 'Cancelled at Walk-In Desk');
      }
      res.json({ booking: result.booking });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to cancel booking.' });
    }
  });

  app.post('/api/walkin/training-hours', requireWalkIn, async (req, res) => {
    try {
      const { tzOffsetMinutes, sportId, courtIds, slotIds, reason, trainingCode } = req.body as {
        tzOffsetMinutes?: number;
        sportId?: string;
        courtIds?: string[];
        slotIds?: string[];
        reason?: string;
        trainingCode?: string;
      };
      const validCode = trainingCode ? await verifyTrainingOverrideCode(trainingCode) : false;
      if (!validCode) {
        res.status(403).json({ error: 'Invalid Training Hours authorization code.' });
        return;
      }
      const todayDate = getTodayDateString(Number(tzOffsetMinutes ?? 0));
      if (!sportId || !Array.isArray(slotIds) || slotIds.length === 0) {
        res.status(400).json({ error: 'Sport and at least one slot hour are required.' });
        return;
      }
      const result = await applyTrainingHours({
        date: todayDate,
        sportId,
        courtIds: Array.isArray(courtIds) ? courtIds : [],
        slotIds,
        reason,
        actorLabel: 'Walk-In Desk',
        actorType: 'walkin',
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('slot:updated', { date: todayDate, sportId });
      if (result.cancelledCount > 0) {
        broadcastEvent('booking:cancelled', { date: todayDate, sportId });
        void sendSportXCancellationEmails(result.cancelledBookings, reason);
      }
      res.json({
        blockedCount: result.blockedCount,
        cancelledCount: result.cancelledCount,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to block training hours.' });
    }
  });

  // ==================== SECURITY GATE DESK ROUTES ====================
  app.post('/api/security/login', async (req, res) => {
    try {
      const { password } = req.body as { password?: string };
      const valid = password ? await verifySecurityPasscode(password) : false;
      if (!valid) {
        res.status(401).json({ error: 'Invalid security gate PIN.' });
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      activeSecurityTokens.add(token);
      res.json({ token });
    } catch {
      res.status(500).json({ error: 'Unable to authenticate Security Gate session.' });
    }
  });

  app.post('/api/security/logout', (req, res) => {
    const token = req.header('x-security-token');
    if (token) activeSecurityTokens.delete(token);
    res.json({ ok: true });
  });

  app.get('/api/security/window', requireSecurity, async (req, res) => {
    try {
      const tzOffset = Number(req.query.tzOffset ?? 0);
      const baseHour =
        req.query.baseHour !== undefined && req.query.baseHour !== ''
          ? Number(req.query.baseHour)
          : undefined;
      const data = await getSecurityGateWindow(tzOffset, baseHour);
      res.json(data);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load gate check-in window.' });
    }
  });

  app.get('/api/security/lookup', requireSecurity, async (req, res) => {
    try {
      const tzOffset = Number(req.query.tzOffset ?? 0);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
      const result = await searchSecurityBookings(tzOffset, q, date);
      res.json(result);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to search bookings.' });
    }
  });

  app.post('/api/security/bookings/:id/status', requireSecurity, async (req, res) => {
    try {
      const { id } = req.params;
      const { securityStatus, notes } = req.body as {
        securityStatus?: SecurityCheckInStatus;
        notes?: string;
      };
      const status: SecurityCheckInStatus =
        securityStatus === 'admitted' || securityStatus === 'no_show'
          ? securityStatus
          : 'pending';
      const result = await updateSecurityGateStatus({
        bookingId: id,
        securityStatus: status,
        notes,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('security:updated', { bookingId: id, securityStatus: status });
      res.json({ booking: result.booking });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update gate entry.' });
    }
  });

  app.get('/api/security/light-requests', requireSecurity, async (req, res) => {
    try {
      const data = await getSecurityLightRequests(getReqTzOffset(req));
      res.json(data);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load light requests.' });
    }
  });

  app.post('/api/security/light-requests/:id/close', requireSecurity, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await closeLightRequest(id);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('lights:updated', { requestId: id, status: 'closed' });
      res.json({ request: result.request });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to close light request.' });
    }
  });

  app.post('/api/security/training-hours', requireSecurity, async (req, res) => {
    try {
      const { tzOffsetMinutes, sportId, courtIds, slotIds, reason, trainingCode } = req.body as {
        tzOffsetMinutes?: number;
        sportId?: string;
        courtIds?: string[];
        slotIds?: string[];
        reason?: string;
        trainingCode?: string;
      };
      const validCode = trainingCode ? await verifyTrainingOverrideCode(trainingCode) : false;
      if (!validCode) {
        res.status(403).json({ error: 'Invalid Training Hours authorization code.' });
        return;
      }
      const todayDate = getTodayDateString(Number(tzOffsetMinutes ?? 0));
      if (!sportId || !Array.isArray(slotIds) || slotIds.length === 0) {
        res.status(400).json({ error: 'Sport and at least one slot hour are required.' });
        return;
      }
      const result = await applyTrainingHours({
        date: todayDate,
        sportId,
        courtIds: Array.isArray(courtIds) ? courtIds : [],
        slotIds,
        reason,
        actorLabel: 'Security Gate',
        actorType: 'walkin',
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('slot:updated', { date: todayDate, sportId });
      if (result.cancelledCount > 0) {
        broadcastEvent('booking:cancelled', { date: todayDate, sportId });
        void sendSportXCancellationEmails(result.cancelledBookings, reason);
      }
      res.json({
        blockedCount: result.blockedCount,
        cancelledCount: result.cancelledCount,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to apply training hours.' });
    }
  });

  app.get('/api/security/facilities', requireSecurity, async (_req, res) => {
    try {
      const [sportsList] = await Promise.all([getSportsWithCourts()]);
      res.json({ sports: sportsList, timeSlots: TIME_SLOTS });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load facilities.' });
    }
  });

  // ==================== ADMIN OPERATIONS ROUTES ====================
  app.post('/api/admin/login', async (req, res) => {
    try {
      const { password } = req.body as { password?: string };
      const valid = password ? await verifyAdminPasscode(password) : false;
      if (!valid) {
        res.status(401).json({ error: 'Invalid administrator password.' });
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      activeAdminTokens.add(token);
      res.json({ token });
    } catch {
      res.status(500).json({ error: 'Unable to authenticate Admin session.' });
    }
  });

  app.post('/api/admin/logout', (req, res) => {
    const token = req.header('x-admin-token');
    if (token) activeAdminTokens.delete(token);
    res.json({ ok: true });
  });

  app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    try {
      const data = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json(data);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to load admin dashboard.' });
    }
  });

  app.post('/api/admin/bookings/:id/cancel', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const result = await cancelAdminBooking(id, reason);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('booking:cancelled', {
        date: result.booking?.date,
        bookingId: result.booking?.id,
      });
      if (result.booking) {
        void sendSportXCancellationEmails([result.booking], reason || 'Cancelled by SportX Administration');
      }
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to cancel booking.' });
    }
  });

  app.post('/api/admin/bookings/:id/gate-status', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { securityStatus, notes } = req.body as {
        securityStatus?: SecurityCheckInStatus;
        notes?: string;
      };
      const status: SecurityCheckInStatus =
        securityStatus === 'admitted' || securityStatus === 'no_show'
          ? securityStatus
          : 'pending';
      const result = await updateSecurityGateStatus({
        bookingId: id,
        securityStatus: status,
        notes,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('security:updated', { bookingId: id, securityStatus: status });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update admission status.' });
    }
  });

  app.post('/api/admin/slots/block', requireAdmin, async (req, res) => {
    try {
      const { date, sportId, courtId, slotId, reason, action } = req.body as {
        date?: string;
        sportId?: string;
        courtId?: string;
        slotId?: string;
        reason?: string;
        action?: 'block' | 'unblock';
      };
      if (!date || !sportId || !courtId || !slotId) {
        res.status(400).json({ error: 'date, sportId, courtId, and slotId are required.' });
        return;
      }
      const result = await blockOrUnblockSlot({
        date,
        sportId,
        courtId,
        slotId,
        reason,
        action,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('slot:updated', { date, sportId, courtId, slotId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update slot block.' });
    }
  });

  app.post('/api/admin/slots/block-bulk', requireAdmin, async (req, res) => {
    try {
      const { date, sportId, courtId, slotIds, reason, action } = req.body as {
        date?: string;
        sportId?: string;
        courtId?: string;
        slotIds?: string[];
        reason?: string;
        action?: 'block' | 'unblock';
      };
      if (!date || !sportId || !Array.isArray(slotIds)) {
        res.status(400).json({ error: 'date, sportId, and slotIds are required.' });
        return;
      }
      await bulkBlockOrUnblockSlots({ date, sportId, courtId, slotIds, reason, action });
      broadcastEvent('slot:updated', { date, sportId, courtId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed bulk slot operation.' });
    }
  });

  app.post('/api/admin/slots/block-advance', requireAdmin, async (req, res) => {
    try {
      const { dates, sportId, courtIds, slotIds, reason, cancelConflicts } = req.body as {
        dates?: string[];
        sportId?: string;
        courtIds?: string[];
        slotIds?: string[];
        reason?: string;
        cancelConflicts?: boolean;
      };
      if (!Array.isArray(dates) || !sportId || !Array.isArray(courtIds) || !Array.isArray(slotIds)) {
        res.status(400).json({ error: 'dates, sportId, courtIds, and slotIds arrays are required.' });
        return;
      }
      const result = await bulkBlockAdvanceDates({
        dates,
        sportId,
        courtIds,
        slotIds,
        reason,
        cancelConflicts: Boolean(cancelConflicts),
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('slot:updated', { sportId, dates });
      if (result.cancelledCount > 0) {
        broadcastEvent('booking:cancelled', { sportId });
        void sendSportXCancellationEmails(result.cancelledBookings, reason);
      }
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({
        blockedCount: result.blockedCount,
        cancelledCount: result.cancelledCount,
        dashboard,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed advance court blocking.' });
    }
  });

  app.post('/api/admin/sports/add', requireAdmin, async (req, res) => {
    try {
      const {
        name,
        category,
        minPlayers,
        maxPlayers,
        lateNightFee,
        location,
        equipmentRequired,
        initialCourtsCount,
        defaultSurface,
      } = req.body as {
        name?: string;
        category?: string;
        minPlayers?: number;
        maxPlayers?: number;
        lateNightFee?: number;
        location?: string;
        equipmentRequired?: string;
        initialCourtsCount?: number;
        defaultSurface?: string;
      };
      if (!name || name.trim().length < 2) {
        res.status(400).json({ error: 'Sport name (min 2 characters) is required.' });
        return;
      }
      const result = await addSportAdmin({
        name,
        category: category || 'Campus Sport',
        minPlayers: Number(minPlayers ?? 2),
        maxPlayers: Number(maxPlayers ?? 4),
        lateNightFee: Number(lateNightFee ?? 250),
        location: location || 'Main Sports Complex',
        equipmentRequired: equipmentRequired || 'Valid College ID card and standard athletic gear.',
        initialCourtsCount: Number(initialCourtsCount ?? 2),
        defaultSurface: defaultSurface || 'Standard Arena Surface',
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('facility:updated', { sportId: result.sport?.id });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.status(201).json({ sport: result.sport, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to add new sport.' });
    }
  });

  app.post('/api/admin/courts/add', requireAdmin, async (req, res) => {
    try {
      const { sportId, name, surface } = req.body as {
        sportId?: string;
        name?: string;
        surface?: string;
      };
      if (!sportId || !name || name.trim().length < 2) {
        res.status(400).json({ error: 'Sport ID and court name are required.' });
        return;
      }
      const result = await addCourt(sportId, name, surface || 'Standard Arena Surface');
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('facility:updated', { sportId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to add court.' });
    }
  });

  app.post('/api/admin/bookings/:id/reassign', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { courtId } = req.body as { courtId?: string };
      if (!courtId) {
        res.status(400).json({ error: 'Target courtId is required.' });
        return;
      }
      const result = await reassignBookingCourt(id, courtId);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('booking:updated', { bookingId: id, courtId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ booking: result.booking, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to change booking venue.' });
    }
  });

  app.post('/api/admin/bookings/create', requireAdmin, async (req, res) => {
    try {
      const { date, sportId, courtId, slotId, bookedByRollNo, playerRollNos, note } = req.body as {
        date?: string;
        sportId?: string;
        courtId?: string;
        slotId?: string;
        bookedByRollNo?: string;
        playerRollNos?: string[];
        note?: string;
      };
      if (!date || !sportId || !courtId || !slotId || !bookedByRollNo) {
        res.status(400).json({ error: 'Date, sport, venue, slot, and captain Roll No are required.' });
        return;
      }
      const result = await createAdminWalkInBooking({
        date,
        sportId,
        courtId,
        slotId,
        bookedByRollNo,
        playerRollNos: Array.isArray(playerRollNos) ? playerRollNos : [],
        note,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('booking:created', { date, sportId, courtId, slotId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.status(201).json({ booking: result.booking, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to create desk booking.' });
    }
  });

  app.patch('/api/admin/courts/:sportId/:courtId', requireAdmin, async (req, res) => {
    try {
      const { sportId, courtId } = req.params;
      const { status, name, surface } = req.body as {
        status?: 'operational' | 'maintenance';
        name?: string;
        surface?: string;
      };
      const result = await updateCourtDetails(sportId, courtId, {
        status:
          status === 'maintenance' || status === 'operational' ? status : undefined,
        name,
        surface,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('facility:updated', { sportId, courtId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update court.' });
    }
  });

  app.patch('/api/admin/sports/:sportId', requireAdmin, async (req, res) => {
    try {
      const { sportId } = req.params;
      const { lateNightFee, minPlayers, maxPlayers, equipmentRequired, location } = req.body as {
        lateNightFee?: number;
        minPlayers?: number;
        maxPlayers?: number;
        equipmentRequired?: string;
        location?: string;
      };
      const result = await updateSportConfig(sportId, {
        lateNightFee,
        minPlayers,
        maxPlayers,
        equipmentRequired,
        location,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('facility:updated', { sportId });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update sport.' });
    }
  });

  app.patch('/api/admin/policy', requireAdmin, async (req, res) => {
    try {
      const {
        openingHour,
        morningBookingOpenHour,
        eveningBookingOpenHour,
        enforceOpeningHour,
        sameDayOnly,
        weekdayMorningStart,
        weekdayMorningEnd,
        weekdayEveningStart,
        weekdayEveningEnd,
        weekendMorningStart,
        weekendMorningEnd,
        weekendEveningStart,
        weekendEveningEnd,
        announcement,
        earlyArrivalMinutes,
        inCourtWindowMinutes,
        adminPasscode,
        securityPasscode,
        walkInPasscode,
        walkInCancelCode,
        trainingOverrideCode,
        gmailSenderEmail,
        gmailAutoSend,
        facilityRules,
      } = req.body as Partial<BookingPolicy>;
      await updatePolicy({
        openingHour,
        morningBookingOpenHour,
        eveningBookingOpenHour,
        enforceOpeningHour,
        sameDayOnly,
        weekdayMorningStart,
        weekdayMorningEnd,
        weekdayEveningStart,
        weekdayEveningEnd,
        weekendMorningStart,
        weekendMorningEnd,
        weekendEveningStart,
        weekendEveningEnd,
        announcement,
        earlyArrivalMinutes,
        inCourtWindowMinutes,
        adminPasscode,
        securityPasscode,
        walkInPasscode,
        walkInCancelCode,
        trainingOverrideCode,
        gmailSenderEmail,
        gmailAutoSend,
        facilityRules,
      });
      broadcastEvent('policy:updated', {});
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update policy.' });
    }
  });

  app.post('/api/admin/gmail/config', requireAdmin, async (req, res) => {
    try {
      const { gmailSenderEmail, gmailAutoSend, gmailConnectionMode } = req.body as {
        gmailSenderEmail?: string;
        gmailAutoSend?: boolean;
        gmailConnectionMode?: 'smtp' | 'oauth';
      };
      await updatePolicy({
        gmailSenderEmail: typeof gmailSenderEmail === 'string' ? gmailSenderEmail : undefined,
        gmailAutoSend: typeof gmailAutoSend === 'boolean' ? gmailAutoSend : undefined,
        gmailConnectionMode:
          gmailConnectionMode === 'oauth' || gmailConnectionMode === 'smtp'
            ? gmailConnectionMode
            : undefined,
      });
      broadcastAdminEvent('gmail:config_updated', {});
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to save Gmail settings.' });
    }
  });

  app.post('/api/admin/gmail/smtp-connect', requireAdmin, async (req, res) => {
    try {
      const { email, appPassword, autoSend } = req.body as {
        email?: string;
        appPassword?: string;
        autoSend?: boolean;
      };
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ error: 'Enter a valid Gmail address (e.g. atharvdhan4@gmail.com).' });
        return;
      }

      const existing = await getAdminGmailSmtpCredentials();
      const rawPass = (appPassword || '').replace(/\s+/g, '').trim();
      const passwordToUse =
        rawPass || (existing.senderEmail === cleanEmail ? existing.appPassword : '');

      if (!passwordToUse || passwordToUse.length < 16) {
        res.status(400).json({
          error:
            'Enter the 16-character Google App Password (from myaccount.google.com/apppasswords with 2-Step Verification enabled).',
        });
        return;
      }

      // Verify credentials live against Gmail SMTP before saving
      try {
        const transporter = createGmailSmtpTransport(cleanEmail, passwordToUse);
        await transporter.verify();
      } catch (verifyErr) {
        const msg = (verifyErr as Error)?.message || 'Authentication failed';
        const isAuthReject =
          msg.includes('535') ||
          msg.toLowerCase().includes('username and password not accepted') ||
          msg.toLowerCase().includes('invalid login');
        res.status(400).json({
          error: isAuthReject
            ? 'Google rejected this email or App Password. Make sure 2-Step Verification is ON and use a 16-character Google App Password (not your regular Gmail login password).'
            : `Could not connect to Gmail SMTP: ${msg.slice(0, 140)}`,
        });
        return;
      }

      await saveAdminGmailSmtpConfig({
        email: cleanEmail,
        appPassword: rawPass || undefined,
        autoSend: typeof autoSend === 'boolean' ? autoSend : true,
      });

      // Automatically dispatch any pending OTP requests queued earlier
      const recentOtps = await getRecentSignupOtps(20);
      for (const otp of recentOtps.filter((o) => o.status === 'pending')) {
        await dispatchOtpViaConfiguredSmtp(otp.id, false);
      }

      broadcastAdminEvent('gmail:config_updated', {});
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ ok: true, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to connect Gmail SMTP.' });
    }
  });

  app.post('/api/admin/gmail/smtp-disconnect', requireAdmin, async (req, res) => {
    try {
      await saveAdminGmailSmtpConfig({ clear: true });
      broadcastAdminEvent('gmail:config_updated', {});
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ ok: true, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to disconnect Gmail.' });
    }
  });

  app.post('/api/admin/gmail/send-otp', requireAdmin, async (req, res) => {
    try {
      const { otpId, senderEmail, explicitResend } = req.body as {
        otpId?: string;
        senderEmail?: string;
        explicitResend?: boolean;
      };
      if (!otpId) {
        res.status(400).json({ error: 'otpId is required.' });
        return;
      }

      // Prefer server-side configured Gmail SMTP if available (works 24/7 with any Gmail)
      const smtpCreds = await getAdminGmailSmtpCredentials();
      if (smtpCreds.senderEmail && smtpCreds.appPassword) {
        const smtpResult = await dispatchOtpViaConfiguredSmtp(otpId, Boolean(explicitResend));
        const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
        if (smtpResult.status === 'failed') {
          res.status(502).json({
            error: smtpResult.error || 'Gmail SMTP delivery failed.',
            dashboard,
          });
          return;
        }
        res.json({
          ok: true,
          status: smtpResult.status,
          sentFromEmail: smtpCreds.senderEmail,
          dashboard,
        });
        return;
      }

      // Fallback: Workspace OAuth Bearer token dispatch
      const authHeader = req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error:
            'No Gmail sender connected yet. Connect your Gmail + 16-character App Password in Admin -> Gmail Verification.',
          reconnectRequired: true,
        });
        return;
      }

      const claimed = await claimAndGetOtpForGmailSend(otpId, Boolean(explicitResend));
      if (!claimed) {
        res.json({ ok: true, alreadyHandled: true });
        return;
      }

      const raw = buildOtpRawEmail({
        to: claimed.email,
        fromEmail: senderEmail,
        studentName: claimed.name,
        rollNo: claimed.rollNo,
        code: claimed.code,
      });

      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });

      if (!gmailRes.ok) {
        const errPayload = await gmailRes.text().catch(() => '');
        const tokenExpired = gmailRes.status === 401 || gmailRes.status === 403;
        const msg = tokenExpired
          ? 'Gmail authorization expired or missing send permission. Reconnect Gmail in Admin.'
          : `Gmail delivery failed (${gmailRes.status}).`;
        await markOtpSendResult(otpId, false, senderEmail || null, msg);
        broadcastAdminEvent('signup:otp_failed', { otpId, error: msg });
        res.status(tokenExpired ? 401 : 502).json({
          error: msg,
          details: errPayload.slice(0, 240),
          reconnectRequired: tokenExpired,
        });
        return;
      }

      await markOtpSendResult(otpId, true, senderEmail || 'Connected Admin Gmail', null);
      broadcastAdminEvent('signup:otp_sent', {
        otpId,
        email: claimed.email,
        sentFromEmail: senderEmail || 'Connected Admin Gmail',
      });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({
        ok: true,
        status: 'sent',
        sentFromEmail: senderEmail || 'Connected Admin Gmail',
        dashboard,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to send verification code via Gmail.' });
    }
  });

  app.patch('/api/admin/students/:rollNo/status', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const { status } = req.body as { status?: 'active' | 'suspended' };
      const nextStatus = status === 'suspended' ? 'suspended' : 'active';
      const result = await toggleStudentStatus(rollNo, nextStatus);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update student status.' });
    }
  });

  app.patch('/api/admin/students/:rollNo/subscription', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const { subscriptionStartDate, subscriptionEndDate, paymentDate } = req.body as {
        subscriptionStartDate?: string;
        subscriptionEndDate?: string;
        paymentDate?: string;
      };
      const result = await updateStudentSubscription(
        rollNo,
        subscriptionStartDate ?? paymentDate,
        subscriptionEndDate
      );
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to update subscription.' });
    }
  });

  app.post('/api/admin/students/:rollNo/paid', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const { paymentDate, idNo, name, email, phone, department, year } = req.body as {
        paymentDate?: string;
        idNo?: string;
        name?: string;
        email?: string;
        phone?: string;
        department?: string;
        year?: string;
      };
      const result = await markStudentPaid({
        rollNo,
        paymentDate,
        idNo,
        name,
        email,
        phone,
        department,
        year,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to mark student as paid.' });
    }
  });

  app.delete('/api/admin/students/:rollNo', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const result = await removeStudentFromRoster(rollNo);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to remove student from roster.' });
    }
  });

  app.post('/api/admin/students/:rollNo/ban', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const { days, scope, sportIds, reason } = req.body as {
        days?: number;
        scope?: 'all' | 'selected';
        sportIds?: string[];
        reason?: string;
      };
      const result = await banStudentAdmin({
        rollNo,
        days: Number(days ?? 1),
        scope: scope === 'selected' ? 'selected' : 'all',
        sportIds: Array.isArray(sportIds) ? sportIds : [],
        reason,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo, banned: true });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ student: result.student, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to apply student ban.' });
    }
  });

  app.post('/api/admin/students/:rollNo/unban', requireAdmin, async (req, res) => {
    try {
      const { rollNo } = req.params;
      const result = await unbanStudentAdmin(rollNo);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo, banned: false });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ student: result.student, dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to lift student ban.' });
    }
  });

  app.post('/api/admin/students/add', requireAdmin, async (req, res) => {
    try {
      const {
        rollNo,
        idNo,
        name,
        email,
        phone,
        department,
        year,
        paymentDate,
        subscriptionStartDate,
      } = req.body as {
        rollNo?: string;
        idNo?: string;
        name?: string;
        email?: string;
        phone?: string;
        department?: string;
        year?: string;
        paymentDate?: string;
        subscriptionStartDate?: string;
      };
      if (!rollNo || !name || !email) {
        res.status(400).json({ error: 'Roll No, Name, and College Email are required.' });
        return;
      }
      const result = await addStudentAdmin({
        rollNo,
        idNo,
        name,
        email,
        phone,
        department,
        year,
        paymentDate,
        subscriptionStartDate,
      });
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
      broadcastEvent('roster:updated', { rollNo });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({ dashboard });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Failed to add student.' });
    }
  });

  app.post('/api/admin/students/bulk', requireAdmin, async (req, res) => {
    try {
      const { records } = req.body as {
        records?: {
          rollNo?: string;
          idNo?: string;
          name?: string;
          email?: string;
          phone?: string;
          department?: string;
          year?: string;
          details?: string;
          status?: string;
          paymentDate?: string;
          subscriptionStartDate?: string;
        }[];
      };
      if (!Array.isArray(records) || records.length === 0) {
        res.status(400).json({ error: 'No student records provided for import.' });
        return;
      }
      const stats = await bulkImportStudents(records);
      broadcastEvent('roster:updated', { bulk: true, ...stats });
      const dashboard = await buildAdminDashboard(sseClients.size, getReqTzOffset(req));
      res.json({
        ...stats,
        dashboard,
      });
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message || 'Bulk import failed.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Background 30-min gate auto-admit sweep (15s) & 30-day permanent booking retention purge (every 60s)
  let backgroundTick = 0;
  setInterval(async () => {
    try {
      backgroundTick += 1;
      const updatedCount = await autoAdmitOverduePendingBookings();
      if (updatedCount > 0) {
        broadcastEvent('security:updated', { autoAdmitted: updatedCount });
      }
      if (backgroundTick % 4 === 0) {
        const purgedCount = await purgeExpiredBookingsOlderThan30Days(0);
        if (purgedCount > 0) {
          broadcastEvent('booking:cancelled', { purgedCount });
        }
      }
    } catch {
      // swallow transient background errors
    }
  }, 15_000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SportX booking server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
