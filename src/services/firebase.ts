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

const envApiKey = extractCleanApiKey(import.meta.env.VITE_FIREBASE_API_KEY) || (typeof import.meta.env.VITE_FIREBASE_API_KEY === 'string' && import.meta.env.VITE_FIREBASE_API_KEY.trim() ? import.meta.env.VITE_FIREBASE_API_KEY.trim() : undefined);
const rawApiKey = extractCleanApiKey((firebaseConfigRaw as any).apiKey);
const apiKey = envApiKey || rawApiKey || 'AIzaSyDaedErOCDrIa6OHxLtwqR04Js2fcgb9rg';

const envAuthDomain = typeof import.meta.env.VITE_FIREBASE_AUTH_DOMAIN === 'string' ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN.trim() : undefined;
const envProjectId = typeof import.meta.env.VITE_FIREBASE_PROJECT_ID === 'string' ? import.meta.env.VITE_FIREBASE_PROJECT_ID.trim() : undefined;
const envStorageBucket = typeof import.meta.env.VITE_FIREBASE_STORAGE_BUCKET === 'string' ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET.trim() : undefined;
const envMessagingSenderId = typeof import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID === 'string' ? import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID.trim() : undefined;
const envAppId = typeof import.meta.env.VITE_FIREBASE_APP_ID === 'string' ? import.meta.env.VITE_FIREBASE_APP_ID.trim() : undefined;
const envMeasurementId = typeof import.meta.env.VITE_FIREBASE_MEASUREMENT_ID === 'string' ? import.meta.env.VITE_FIREBASE_MEASUREMENT_ID.trim() : undefined;

export const isFirebaseConfigured = Boolean(apiKey && apiKey.startsWith('AIzaSy'));

const firebaseConfig = {
  ...firebaseConfigRaw,
  apiKey,
  authDomain: envAuthDomain || (firebaseConfigRaw as any).authDomain || 'safecheck-app-ba229.firebaseapp.com',
  projectId: envProjectId || (firebaseConfigRaw as any).projectId || 'safecheck-app-ba229',
  storageBucket: envStorageBucket || (firebaseConfigRaw as any).storageBucket || 'safecheck-app-ba229.firebasestorage.app',
  messagingSenderId: envMessagingSenderId || (firebaseConfigRaw as any).messagingSenderId || '386210130558',
  appId: envAppId || (firebaseConfigRaw as any).appId || '1:386210130558:web:90af88051a5602b32a462f',
  measurementId: envMeasurementId || (firebaseConfigRaw as any).measurementId || 'G-H2F77PJR45',
};

console.log('[SafeCheck Firebase Config] Resolved settings:', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  hasApiKey: Boolean(apiKey),
  appId: firebaseConfig.appId,
  hasProjectIdEnv: Boolean(envProjectId),
  hasAuthDomainEnv: Boolean(envAuthDomain),
  hasApiKeyEnv: Boolean(envApiKey),
});

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
  // getStorage(app) natively uses firebaseConfig.storageBucket ('safecheck-app-ba229.firebasestorage.app')
  storageInstance = getStorage(app);
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

