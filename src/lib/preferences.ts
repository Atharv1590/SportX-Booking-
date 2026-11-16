export interface SavedTeammatePref {
  rollNo: string;
  name: string;
}

export interface StudentBookingPreferences {
  favoriteSportId: string;
  defaultUpiId: string;
  savedTeammates: SavedTeammatePref[];
}

const DEFAULT_PREFS: StudentBookingPreferences = {
  favoriteSportId: '',
  defaultUpiId: '',
  savedTeammates: [],
};

function prefsKey(rollNo: string): string {
  return `campusarena_prefs_${rollNo.trim().toUpperCase()}`;
}

export function getStudentPreferences(rollNo: string): StudentBookingPreferences {
  if (!rollNo) return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(prefsKey(rollNo));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<StudentBookingPreferences>;
    return {
      favoriteSportId: typeof parsed.favoriteSportId === 'string' ? parsed.favoriteSportId : '',
      defaultUpiId: typeof parsed.defaultUpiId === 'string' ? parsed.defaultUpiId : '',
      savedTeammates: Array.isArray(parsed.savedTeammates)
        ? parsed.savedTeammates.filter(
            (t): t is SavedTeammatePref =>
              Boolean(t && typeof t.rollNo === 'string' && typeof t.name === 'string')
          )
        : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveStudentPreferences(
  rollNo: string,
  prefs: StudentBookingPreferences
): void {
  if (!rollNo) return;
  try {
    localStorage.setItem(prefsKey(rollNo), JSON.stringify(prefs));
  } catch {
    // ignore storage quota failures
  }
}

export interface SavedAccountEntry {
  rollNo: string;
  name: string;
  email: string;
  department: string;
  deviceKey: string;
  savedAt: string;
}

const SAVED_ACCOUNTS_KEY = 'campusarena_saved_accounts';

export function getSavedAccounts(): SavedAccountEntry[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedAccountEntry =>
        Boolean(
          item &&
            typeof item.rollNo === 'string' &&
            typeof item.name === 'string' &&
            typeof item.email === 'string' &&
            typeof item.deviceKey === 'string'
        )
    );
  } catch {
    return [];
  }
}

export function upsertSavedAccount(entry: SavedAccountEntry): SavedAccountEntry[] {
  const normRoll = entry.rollNo.trim().toUpperCase();
  const current = getSavedAccounts().filter((a) => a.rollNo !== normRoll);
  const next = [{ ...entry, rollNo: normRoll }, ...current].slice(0, 6);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function removeSavedAccount(rollNo: string): SavedAccountEntry[] {
  const normRoll = rollNo.trim().toUpperCase();
  const next = getSavedAccounts().filter((a) => a.rollNo !== normRoll);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

