import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'live_sync', 'global'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface LivePulseSnapshot {
  channelId: string;
  version: number;
  lastEventType: string;
  affectedDate?: string;
  sportId?: string;
  updatedAt: string;
}

/**
 * Subscribes to the Firestore live_sync/global document updated by the Express server
 * whenever Cloud SQL state changes (bookings, blocks, roster/bans, gate, light requests).
 * Skips the initial cached/mounted snapshot emission so components do not double-fetch on mount.
 */
export function subscribeLivePulse(
  onPulse: (pulse: LivePulseSnapshot) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  const path = 'live_sync/global';
  const pulseRef = doc(db, 'live_sync', 'global');
  let initialSeen = false;
  let lastSeenVersion = -1;

  return onSnapshot(
    pulseRef,
    (snapshot) => {
      onStatusChange?.(true);
      const data = snapshot.data() as LivePulseSnapshot | undefined;
      if (!data) {
        initialSeen = true;
        return;
      }
      if (!initialSeen) {
        initialSeen = true;
        lastSeenVersion = typeof data.version === 'number' ? data.version : -1;
        return;
      }
      if (typeof data.version === 'number' && data.version === lastSeenVersion) {
        return;
      }
      lastSeenVersion = typeof data.version === 'number' ? data.version : lastSeenVersion;
      onPulse(data);
    },
    (error) => {
      onStatusChange?.(false);
      if (error instanceof Error && error.message.includes('the client is offline')) {
        return;
      }
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (err) {
        console.warn('Firestore live_sync listener warning:', err);
      }
    }
  );
}

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'] as const;

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const gmailAuthProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailAuthProvider.addScope(scope);
}
gmailAuthProvider.setCustomParameters({ prompt: 'select_account' });

let isGmailConnecting = false;
let cachedGmailAccessToken: string | null = null;
let cachedGmailEmail: string | null = null;

export function initGmailAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthCleared?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedGmailAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedGmailAccessToken);
      } else if (!isGmailConnecting) {
        cachedGmailAccessToken = null;
        cachedGmailEmail = null;
        if (onAuthCleared) onAuthCleared();
      }
    } else {
      cachedGmailAccessToken = null;
      cachedGmailEmail = null;
      if (onAuthCleared) onAuthCleared();
    }
  });
}

export async function connectAdminGmail(): Promise<{
  user: User;
  email: string;
  accessToken: string;
}> {
  try {
    isGmailConnecting = true;
    const result = await signInWithPopup(auth, gmailAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Gmail access token from Google sign-in.');
    }
    cachedGmailAccessToken = credential.accessToken;
    cachedGmailEmail = result.user.email || '';
    return {
      user: result.user,
      email: cachedGmailEmail,
      accessToken: cachedGmailAccessToken,
    };
  } finally {
    isGmailConnecting = false;
  }
}

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function getGmailConnectedEmail(): string | null {
  return cachedGmailEmail;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
  cachedGmailEmail = null;
}

export async function disconnectAdminGmail(): Promise<void> {
  await auth.signOut();
  cachedGmailAccessToken = null;
  cachedGmailEmail = null;
}
