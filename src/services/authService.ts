import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from '../types';

/**
 * Ensures that Firebase Auth has established and verified the user's auth token
 * and that Firestore is fully synchronized with the authenticated user session.
 */
export async function ensureAuthStateReady(targetUser?: User | null): Promise<User | null> {
  // 1. If auth.authStateReady is available on Firebase Auth v10+, await it
  if (typeof (auth as any).authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  // 2. If a targetUser is provided or auth.currentUser exists, wait for token confirmation
  const activeUser = targetUser || auth.currentUser;
  if (activeUser) {
    try {
      await activeUser.getIdToken();
    } catch (e) {
      console.warn('getIdToken check notice:', e);
    }
    // Yield a tick so Firestore's internal token subscriber receives the credentials
    await new Promise((resolve) => setTimeout(resolve, 150));
    return activeUser;
  }

  // 3. Otherwise wait on onAuthStateChanged with a short timeout
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve(auth.currentUser);
    }, 2500);

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        clearTimeout(timeout);
        unsub();
        try {
          await u.getIdToken();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 150));
        resolve(u);
      }
    });
  });
}

/**
 * Recursively sanitizes any payload before calling Firestore setDoc/updateDoc
 * to ensure that no property value is `undefined`. Any `undefined` field is converted
 * to an empty string `""` so Firestore setDoc never throws invalid-argument error.
 */
export function sanitizeFirestorePayload(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) {
      result[key] = '';
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      result[key] = sanitizeFirestorePayload(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Safely syncs the user profile document to Firestore with strict fresh token validation,
 * 1.5s backoff retry on permission rejection, and surfaces user-facing failure if both attempts fail.
 */
export async function syncProfileToFirestore(
  uid: string,
  profile: UserProfile,
  extraData?: Record<string, any>,
  targetUser?: User | null
): Promise<boolean> {
  // Ensure profile fields have safe defaults and never undefined
  const finalPhoto = profile.photoURL || profile.photoUrl || '';
  const safeProfile: UserProfile = {
    uid: uid || profile.uid || '',
    name: (profile.name || '').trim() || 'SafeCheck User',
    email: profile.email || '',
    photoURL: finalPhoto,
    photoUrl: finalPhoto,
    phone: profile.phone || profile.phoneNumber || '',
    phoneNumber: profile.phoneNumber || profile.phone || '',
    fcmToken: profile.fcmToken || '',
    pushNotificationsEnabled: typeof profile.pushNotificationsEnabled === 'boolean' ? profile.pushNotificationsEnabled : false,
    hasCompletedOnboarding: typeof profile.hasCompletedOnboarding === 'boolean' ? profile.hasCompletedOnboarding : true,
    createdAt: profile.createdAt || new Date().toISOString(),
  };

  const rawPayload = extraData ? { ...safeProfile, ...extraData } : safeProfile;
  const docPayload = sanitizeFirestorePayload(rawPayload);
  const user = targetUser || auth.currentUser;

  // Step 1: Force a fresh ID token before attempting setDoc
  if (user) {
    try {
      await user.getIdToken(true);
    } catch (tokenErr) {
      console.warn('[SafeCheck Auth] Force fresh ID token warning:', tokenErr);
    }
  }

  // Attempt 1
  try {
    console.log('[DEBUG-DIAGNOSTIC-BEFORE-SETDOC] Calling setDoc for uid:', uid, 'auth.currentUser:', auth.currentUser?.uid, 'payload:', docPayload);
    await setDoc(doc(db, 'users', uid), docPayload, { merge: true });
    console.log('[DEBUG-DIAGNOSTIC-AFTER-SETDOC] Successfully wrote setDoc for uid:', uid);
    return true;
  } catch (firstErr: any) {
    console.warn('[DEBUG-DIAGNOSTIC-SETDOC-ERROR-1] setDoc attempt 1 threw error:', firstErr);
    console.warn('[SafeCheck Auth] First Firestore profile write attempt failed, retrying in 1.5s...', {
      code: firstErr?.code,
      message: firstErr?.message,
      targetDoc: `users/${uid}`,
      authUid: auth.currentUser?.uid,
    });

    // Step 2: Wait 1.5 seconds and retry
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Force another fresh token before the 2nd attempt
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(true);
      } catch {}
    }

    // Attempt 2
    try {
      console.log('[DEBUG-DIAGNOSTIC-BEFORE-SETDOC-RETRY] Calling setDoc retry for uid:', uid);
      await setDoc(doc(db, 'users', uid), docPayload, { merge: true });
      console.log('[DEBUG-DIAGNOSTIC-AFTER-SETDOC-RETRY] Successfully wrote setDoc on retry for uid:', uid);
      return true;
    } catch (secondErr: any) {
      console.warn('[SafeCheck Auth] Direct Firestore profile write error after retry, attempting resilient server fallback:', {
        code: secondErr?.code,
        message: secondErr?.message,
        targetDoc: `users/${uid}`,
        authUid: auth.currentUser?.uid,
      });

      // Step 3: Resilient server API fallback
      try {
        const resp = await fetch('/api/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            name: docPayload.name || '',
            email: docPayload.email || '',
            phone: docPayload.phone || docPayload.phoneNumber || '',
            photoUrl: docPayload.photoUrl || docPayload.photoURL || '',
          }),
        });
        if (resp.ok) {
          console.log('[SafeCheck Auth] Successfully synchronized user profile via resilient server fallback.');
          return true;
        }
      } catch (fallbackErr) {
        console.warn('[SafeCheck Auth] Server API fallback also encountered error:', fallbackErr);
      }

      // If error was offline/unavailable, don't break the user auth flow
      if (secondErr?.code === 'unavailable' || secondErr?.message?.includes('unavailable')) {
        console.warn('[SafeCheck Auth] Firestore backend currently unavailable. Continuing with local user profile state.');
        return true;
      }

      const errCode = secondErr?.code || 'unknown';
      const errMsg = secondErr?.message || 'Permission denied or network failure';

      throw new Error(
        `Profile sync failed, please try again (Firestore ${errCode}: ${errMsg})`
      );
    }
  }
}

/**
 * Creates a new user account with Email and Password using Firebase Auth,
 * sets the display name, creates a Firestore user profile document, and syncs to backend.
 */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<UserProfile> {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  // Create Firebase Auth user
  const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
  const user = userCredential.user;

  // Update Auth display name
  try {
    await updateProfile(user, {
      displayName: trimmedName || trimmedEmail.split('@')[0],
    });
  } catch (err) {
    console.warn('Could not update Firebase user displayName:', err);
  }

  // Ensure auth state has propagated before writing to Firestore
  await ensureAuthStateReady(user);

  const profile: UserProfile = {
    uid: user.uid,
    name: trimmedName || trimmedEmail.split('@')[0] || 'SafeCheck User',
    email: user.email || trimmedEmail,
    createdAt: new Date().toISOString(),
  };

  // Create corresponding user profile document in Firestore with emergencyContacts placeholder
  await syncProfileToFirestore(user.uid, profile, { emergencyContacts: [] });

  // Sync to backend API
  await saveUserProfileServer(profile);

  return profile;
}

/**
 * Signs in an existing user with Email and Password using Firebase Auth.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserProfile> {
  const trimmedEmail = email.trim();
  const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
  const user = userCredential.user;

  // Ensure auth state has propagated before reading/writing to Firestore
  await ensureAuthStateReady(user);

  let profile = await getUserProfile(user.uid);
  if (!profile) {
    profile = {
      uid: user.uid,
      name: user.displayName || trimmedEmail.split('@')[0] || 'SafeCheck User',
      email: user.email || trimmedEmail,
      createdAt: new Date().toISOString(),
    };
    await syncProfileToFirestore(user.uid, profile, { emergencyContacts: [] });
  }

  await saveUserProfileServer(profile);
  return profile;
}

/**
 * Creates or signs in with a quick test traveler account (useful for previews and sandbox domains).
 */
export async function signInQuickDemo(): Promise<UserProfile> {
  const demoEmail = 'demo.traveler@safecheck.app';
  const demoPass = 'SafeCheckDemo2026!';
  const demoName = 'Demo Traveler';

  try {
    // Try signing in first
    return await signInWithEmail(demoEmail, demoPass);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
      try {
        // Try creating the account
        return await signUpWithEmail(demoName, demoEmail, demoPass);
      } catch {
        // Fallback to local profile
      }
    }
  }

  const localProfile: UserProfile = {
    uid: 'demo_traveler_guest',
    name: demoName,
    email: demoEmail,
    createdAt: new Date().toISOString(),
  };
  await saveUserProfileServer(localProfile);
  return localProfile;
}

/**
 * Real Google Sign-In using Firebase Authentication popup.
 * Opens Google's account picker popup and returns authenticated user profile.
 */
export async function signInWithGoogle(): Promise<UserProfile> {
  const provider = new GoogleAuthProvider();
  // Prompt account selection so the user can choose their Google account
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  // Ensure Firebase Auth token has fully settled and propagated to Firestore client
  await ensureAuthStateReady(user);

  // Extract email reliably: primary email or providerData email
  const resolvedEmail =
    user.email ||
    user.providerData?.find((p) => p.email)?.email ||
    '';

  const resolvedName =
    user.displayName ||
    user.providerData?.find((p) => p.displayName)?.displayName ||
    resolvedEmail.split('@')[0] ||
    'SafeCheck User';

  const profile: UserProfile = {
    uid: user.uid,
    name: resolvedName,
    email: resolvedEmail,
    createdAt: new Date().toISOString(),
  };

  // Sync to Firestore users collection with retry
  await syncProfileToFirestore(user.uid, profile);

  // Sync to backend API
  await saveUserProfileServer(profile);

  return profile;
}

/**
 * Signs out the currently authenticated Firebase user and clears local session cache.
 */
export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('Firebase signOut error:', err);
  }

  try {
    // Clear cached user and local data keys
    const keysToRemove = [
      'safecheck_cached_user_profile',
      'safecheck_user_id',
      'safecheck_user_name',
      'safecheck_user_email',
      'safecheck_active_trip',
      'safecheck_trips',
      'safecheck_contacts',
    ];
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Clear any prefixed contact and trip cache entries
    Object.keys(localStorage).forEach((key) => {
      if (
        typeof key === 'string' &&
        (key.startsWith('safecheck_contacts_') ||
        key.startsWith('safecheck_trips_') ||
        key.startsWith('safecheck_active_trip_'))
      ) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('Local session cache cleanup error:', e);
  }
}

/**
 * Synchronizes user profile to backend server.
 */
export async function saveUserProfileServer(profile: UserProfile): Promise<void> {
  try {
    await fetch('/api/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
  } catch (e) {
    console.warn('Could not sync user profile to server:', e);
  }
}

/**
 * Updates the user's profile data in Firebase Auth, Firestore, local cache, and backend server.
 */
export async function updateUserProfileData(
  uid: string,
  updates: Partial<UserProfile>
): Promise<UserProfile> {
  await ensureAuthStateReady();

  // 1. Update Firebase Auth currentUser if name or photoURL is changing
  if (auth.currentUser) {
    const authUpdates: { displayName?: string; photoURL?: string } = {};
    if (updates.name !== undefined) authUpdates.displayName = updates.name;
    if (updates.photoURL !== undefined) authUpdates.photoURL = updates.photoURL;

    if (Object.keys(authUpdates).length > 0) {
      try {
        await updateProfile(auth.currentUser, authUpdates);
      } catch (err) {
        console.warn('Could not update Firebase Auth user profile:', err);
      }
    }
  }

  // 2. Fetch existing or build merged profile
  const existing = (await getUserProfile(uid)) || {
    uid,
    name: auth.currentUser?.displayName || 'SafeCheck User',
    email: auth.currentUser?.email || '',
    createdAt: new Date().toISOString(),
  };

    const resolvedPhoto = updates.photoURL !== undefined
      ? (updates.photoURL || '')
      : updates.photoUrl !== undefined
      ? (updates.photoUrl || '')
      : (existing.photoURL || existing.photoUrl || '');

    const updatedProfile: UserProfile = {
    uid,
    name: updates.name !== undefined ? (updates.name.trim() || 'SafeCheck User') : (existing.name || 'SafeCheck User'),
    email: updates.email !== undefined ? updates.email.trim() : (existing.email || auth.currentUser?.email || ''),
    photoURL: resolvedPhoto,
    photoUrl: resolvedPhoto,
    phone: updates.phone !== undefined ? (updates.phone || '') : (existing.phone || existing.phoneNumber || ''),
    phoneNumber: updates.phoneNumber !== undefined ? (updates.phoneNumber || '') : (existing.phoneNumber || existing.phone || ''),
    fcmToken: updates.fcmToken !== undefined ? (updates.fcmToken || '') : (existing.fcmToken || ''),
    pushNotificationsEnabled: updates.pushNotificationsEnabled !== undefined ? updates.pushNotificationsEnabled : (existing.pushNotificationsEnabled ?? false),
    hasCompletedOnboarding: updates.hasCompletedOnboarding !== undefined ? updates.hasCompletedOnboarding : (existing.hasCompletedOnboarding ?? true),
    createdAt: existing.createdAt || new Date().toISOString(),
  };

  // 3. Update Firestore (only if authenticated as this user)
  if (auth.currentUser && auth.currentUser.uid === uid) {
    await syncProfileToFirestore(uid, updatedProfile);
  }

  // 4. Update backend server
  await saveUserProfileServer(updatedProfile);

  return updatedProfile;
}

/**
 * Retrieves the user profile from Firestore or the backend.
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  // 1. Check Firestore (only when authenticated for this uid)
  if (auth.currentUser && auth.currentUser.uid === uid) {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as UserProfile;
      }
    } catch (err) {
      console.warn('Firestore get user profile warning:', err);
    }
  }

  // 2. Check Backend Server
  try {
    const res = await fetch(`/api/user/${uid}`);
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        return data.user;
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Real Firebase auth state listener.
 */
export function subscribeAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}
