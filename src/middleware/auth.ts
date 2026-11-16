import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser, verifyStudentSessionToken } from '../db/users.ts';

export interface AuthUserContext {
  uid: string;
  email?: string;
  name?: string;
  rollNo?: string;
  authType: 'firebase' | 'password';
}

export interface AuthRequest extends Request {
  user?: AuthUserContext;
}

export async function verifyIdTokenString(token: string): Promise<AuthUserContext> {
  const localSession = verifyStudentSessionToken(token);
  if (localSession) {
    return {
      uid: localSession.uid,
      email: localSession.email,
      name: localSession.name,
      rollNo: localSession.rollNo,
      authType: 'password',
    };
  }

  const decoded: DecodedIdToken = await adminAuth.verifyIdToken(token);
  if (decoded.uid) {
    await getOrCreateUser(decoded.uid, decoded.email || '');
  }
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name,
    authType: 'firebase',
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Please sign in.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const authUser = await verifyIdTokenString(token);
    req.user = authUser;
    next();
  } catch (error) {
    console.error('Error verifying student session token:', error);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
};
