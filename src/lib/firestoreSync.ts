import fs from 'node:fs';
import path from 'node:path';
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(cfgPath, 'utf8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

let adminDb: Firestore | null = null;
let initAttempted = false;
let pulseSeq = Math.floor(Date.now() / 1000);
let warnedOnce = false;

function getAdminFirestore(): Firestore | null {
  if (adminDb) return adminDb;
  if (initAttempted) return null;
  initAttempted = true;
  try {
    const cfg = loadFirebaseConfig();
    const existingApps = getApps();
    const adminApp: App =
      existingApps.length > 0
        ? existingApps[0]
        : initializeApp({ projectId: cfg.projectId });
    adminDb = cfg.firestoreDatabaseId
      ? getFirestore(adminApp, cfg.firestoreDatabaseId)
      : getFirestore(adminApp);
    return adminDb;
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        '[FirestoreSync] Admin SDK initialization skipped:',
        err instanceof Error ? err.message : String(err)
      );
    }
    return null;
  }
}

/**
 * Publishes a lightweight non-PII live pulse to Firestore `/live_sync/global` whenever
 * Cloud SQL state mutates, adhering strictly to the `LivePulse` schema in `firestore.rules`.
 */
export async function syncLivePulseToFirestore(
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const firestore = getAdminFirestore();
  if (!firestore) return;

  pulseSeq += 1;
  const docData: Record<string, string | number> = {
    channelId: 'global',
    version: pulseSeq,
    lastEventType: String(eventType || 'sync').slice(0, 64),
    updatedAt: new Date().toISOString().slice(0, 64),
  };

  if (typeof payload.date === 'string' && payload.date.trim()) {
    docData.affectedDate = payload.date.trim().slice(0, 20);
  }
  if (typeof payload.sportId === 'string' && payload.sportId.trim()) {
    docData.sportId = payload.sportId.trim().slice(0, 64);
  }

  try {
    await firestore.collection('live_sync').doc('global').set(docData);
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        '[FirestoreSync] Could not push live_sync pulse (SQL continues normally):',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
