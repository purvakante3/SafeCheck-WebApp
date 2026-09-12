import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  getAuth,
  Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
  setLogLevel,
} from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import firebaseConfigRaw from '../../firebase-applet-config.json';

// Helper to extract a valid clean Firebase API key
function extractCleanApiKey(keyInput: any): string | undefined {
  if (!keyInput || typeof keyInput !== 'string') return undefined;
  // Match standard Google API key pattern (AIzaSy...)
  const match = keyInput.match(/AIzaSy[A-Za-z0-9_\-]{33}/);
  if (match && match[0]) {
    return match[0];
  }
  const trimmed = keyInput.trim();
  if (trimmed.length > 20 && !trimmed.includes(' ') && !trimmed.includes('{')) {
    return trimmed;
  }
  return undefined;
}

const envApiKey = extractCleanApiKey((import.meta as any).env?.VITE_FIREBASE_API_KEY);
const rawApiKey = extractCleanApiKey((firebaseConfigRaw as any).apiKey);
const apiKey = envApiKey || rawApiKey || 'AIzaSyDaedErOCDrIa6OHxLtwqR04Js2fcgb9rg';

export const isFirebaseConfigured = Boolean(apiKey && apiKey.startsWith('AIzaSy'));

const firebaseConfig = {
  ...firebaseConfigRaw,
  apiKey,
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Auth instance using browserLocalPersistence to prevent iframe IndexedDB closing/hidden issues
let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;

// Silence noisy internal transport reconnection warnings
try {
  setLogLevel('silent');
} catch {}

// Firestore cache configuration: prefer IndexedDB persistent cache with multi-tab support, falling back to in-memory cache
let localCacheSetting: any;
try {
  if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
    localCacheSetting = persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    });
  } else {
    localCacheSetting = memoryLocalCache();
  }
} catch {
  localCacheSetting = memoryLocalCache();
}

const firestoreDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

const firestoreSettings = {
  localCache: localCacheSetting,
  experimentalAutoDetectLongPolling: true,
};

let firestoreInstance: Firestore;
try {
  firestoreInstance = firestoreDbId
    ? initializeFirestore(app, firestoreSettings, firestoreDbId)
    : initializeFirestore(app, firestoreSettings);
} catch {
  firestoreInstance = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);
}

export const db = firestoreInstance;

// Firebase Storage instance
let storageInstance: FirebaseStorage;
try {
  const bucketName = (firebaseConfig as { storageBucket?: string }).storageBucket;
  storageInstance = bucketName ? getStorage(app, `gs://${bucketName}`) : getStorage(app);
} catch {
  storageInstance = getStorage(app);
}

export const storage = storageInstance;

// Startup diagnostic check
try {
  const keySuffix = apiKey && apiKey.length >= 6 ? `...${apiKey.slice(-6)}` : '(none)';
  console.log(
    `[SafeCheck Firebase Init] API Key configured: ${keySuffix} | Auth: browserLocalPersistence | Firestore: Memory Cache`
  );
} catch (e) {
  console.warn('[SafeCheck Firebase Init] Diagnostic log error:', e);
}

export default app;

