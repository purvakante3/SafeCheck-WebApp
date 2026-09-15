import React, { useEffect, useState, useCallback, useRef } from 'react';
import { WifiOff, ShieldCheck } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { SystemLogDrawer } from './components/SystemLogDrawer';
import { FakeCallModal } from './components/FakeCallModal';
import { FakeCallTrigger } from './components/FakeCallTrigger';
import { OnboardingCarousel } from './components/OnboardingCarousel';
import { Home } from './pages/Home';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Contacts } from './pages/Contacts';
import { StartTrip } from './pages/StartTrip';
import { ActiveTrip } from './pages/ActiveTrip';
import { TripHistory } from './pages/TripHistory';
import { Profile } from './pages/Profile';
import { About } from './pages/About';
import { Settings } from './pages/Settings';
import { Helplines } from './pages/Helplines';
import { GuardianView } from './pages/GuardianView';
import { UserProfile, EmergencyContact, Trip, AppSettings, SOSEventType, SOSEvent } from './types';
import { subscribeAuth, getUserProfile, logoutUser, updateUserProfileData } from './services/authService';
import { subscribeContacts } from './services/contactService';
import { subscribeActiveTrip, subscribeUserTrips, migrateLegacySOSTrips } from './services/tripService';
import { triggerSOSAlert, subscribeUserSOSEvents, restoreSOSEventsToFirestore } from './services/sosService';
import { getAppSettings, saveAppSettings, DEFAULT_SETTINGS } from './services/settingsService';
import { getCurrentLocation } from './services/locationService';
import { notifyTripCheckInReminder, notifySosTriggered } from './services/notificationService';

import { LanguageProvider } from './i18n/LanguageContext';
import { LogoutConfirmModal } from './components/LogoutConfirmModal';
import { FallDetectionListener } from './components/FallDetectionListener';
import { isDeviceOnline, syncOfflineTripData } from './services/offlineSyncService';

function AppContent() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentPage, setCurrentPage] = useState<string>('home');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [systemLogsOpen, setSystemLogsOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Guardian View URL detection (?guardian=tripId or ?guardianUser=userId)
  const [guardianTripId, setGuardianTripId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('guardian');
    }
    return null;
  });
  const [guardianUserId, setGuardianUserId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('guardianUser');
    }
    return null;
  });

  // Safety Feature States
  const [appSettings, setAppSettings] = useState<AppSettings>(() => getAppSettings());
  const [fakeCallActive, setFakeCallActive] = useState<boolean>(false);

  // First-time Onboarding Modal state
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  // Register service worker on initial load for offline cache and push events
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('ServiceWorker registered successfully with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('ServiceWorker registration error:', err);
        });
    }
  }, []);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOffline(false);
      setSyncNotice('Internet connection restored. Synchronizing queued offline trip updates...');
      if (user?.uid) {
        try {
          const res = await syncOfflineTripData(user.uid);
          if (res.syncedCount > 0) {
            setSyncNotice(`Synced ${res.syncedCount} offline trip update${res.syncedCount > 1 ? 's' : ''} to cloud.`);
          } else {
            setSyncNotice('Connection restored. Data is synchronized.');
          }
        } catch (err) {
          console.warn('Sync on reconnect notice:', err);
        }
      }
      setTimeout(() => setSyncNotice(null), 4000);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setSyncNotice(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user?.uid]);

  // Subscribe to real Firebase auth changes
  useEffect(() => {
    const unsub = subscribeAuth(async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const resolvedEmail =
            firebaseUser.email ||
            firebaseUser.providerData?.find((p) => p.email)?.email ||
            '';
          const resolvedName =
            firebaseUser.displayName ||
            firebaseUser.providerData?.find((p) => p.displayName)?.displayName ||
            resolvedEmail.split('@')[0] ||
            'SafeCheck User';

          const profile = await getUserProfile(firebaseUser.uid);
          if (profile) {
            // If the stored profile had an empty email, update it with the verified Auth email
            if (!profile.email && resolvedEmail) {
              profile.email = resolvedEmail;
              updateUserProfileData(firebaseUser.uid, { email: resolvedEmail }).catch(() => {});
            }
            setUser(profile);
            setCurrentPage((prev) => (prev === 'auth' ? 'dashboard' : prev));
            // Check if onboarding needs to be shown for first-time login
            const cachedOnboard = localStorage.getItem(`safecheck_onboarding_completed_${profile.uid}`);
            if (!profile.hasCompletedOnboarding && !cachedOnboard) {
              setShowOnboarding(true);
            }
          } else {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              name: resolvedName,
              email: resolvedEmail,
              createdAt: new Date().toISOString(),
            };
            setUser(newProfile);
            setCurrentPage((prev) => (prev === 'auth' ? 'dashboard' : prev));
            const cachedOnboard = localStorage.getItem(`safecheck_onboarding_completed_${newProfile.uid}`);
            if (!cachedOnboard) {
              setShowOnboarding(true);
            }
          }
        } else {
          // Clear any user state and old cached tokens
          try {
            localStorage.removeItem('safecheck_cached_user_profile');
          } catch {}
          setUser(null);
          setActiveTrip(null);
          setContacts([]);
          setRecentTrips([]);
          setShowOnboarding(false);
        }
      } catch (err) {
        console.warn('Auth state resolution warning:', err);
        setUser(null);
      } finally {
        setLoadingAuth(false);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  // Debug logger for tracking currentPage transitions and redirects
  useEffect(() => {
    console.log(`[App] currentPage state updated to: "${currentPage}"`, {
      user: user?.email || 'unauthenticated',
      guardianActive: Boolean(guardianTripId || guardianUserId),
    });
  }, [currentPage, user, guardianTripId, guardianUserId]);

  // Automatically transition away from 'auth' to 'dashboard' when user logs in
  useEffect(() => {
    if (user && currentPage === 'auth') {
      console.log('[App] User is authenticated and on auth page -> redirecting to dashboard');
      setCurrentPage('dashboard');
    }
  }, [user, currentPage]);

  // Subscribe to Firestore collections when logged in
  useEffect(() => {
    if (!user) return;

    const unsubContacts = subscribeContacts(user.uid, (data) => {
      setContacts(data);
    });

    const unsubActive = subscribeActiveTrip(user.uid, (trip) => {
      setActiveTrip(trip);
      // Trigger background push notification when active trip enters reminded state
      if (trip && trip.status === 'reminded') {
        notifyTripCheckInReminder(trip.destination, trip.graceMinutes || 10).catch(() => {});
      }
    });

    // Subscription to unified trips collection (contains both regular trips and SOS events)
    const unsubTrips = subscribeUserTrips(user.uid, (trips) => {
      setRecentTrips(trips);
    });

    // Automatically ensure all SOS events are restored and synchronized to Firestore trips
    restoreSOSEventsToFirestore(user.uid).catch((err) => {
      console.warn('[SafeCheck SOS] Auto-restore notice:', err?.message || err);
    });

    return () => {
      unsubContacts();
      unsubActive();
      unsubTrips();
    };
  }, [user]);

  const handleTriggerEmergencySOS = useCallback(
    async (sourceReason: string = '1-Tap Emergency SOS', type: SOSEventType = 'manual') => {
      if (!user) {
        alert('Please log in or configure emergency contacts to trigger SOS alerts.');
        return;
      }

      try {
        const coords = await getCurrentLocation();
        const locUrl = coords
          ? `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`
          : undefined;

        await triggerSOSAlert(
          user.uid,
          user.name,
          user.email,
          coords?.latitude,
          coords?.longitude,
          locUrl,
          null,
          {
            type,
            customSubject: `🚨 EMERGENCY SOS: ${user.name || 'User'} triggered ${sourceReason}`,
          }
        );

        // Trigger push notification
        notifySosTriggered(user.name, locUrl).catch(() => {});

        setCurrentPage('dashboard');
        setSystemLogsOpen(true);
      } catch (err: any) {
        console.error('Failed to trigger emergency SOS alert:', err);
      }
    },
    [user, contacts]
  );

  const handleNavigate = (page: string) => {
    console.log(`[App] handleNavigate called with page: "${page}" | current page: "${currentPage}" | user:`, user?.email || 'unauthenticated');

    // If user is already logged in and tries to go to auth, send them to dashboard
    if (user && page === 'auth') {
      console.log('[App] handleNavigate: authenticated user requested "auth" -> redirecting to "dashboard"');
      setCurrentPage('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // If not logged in and requesting private pages, redirect to auth
    const publicPages = ['home', 'auth', 'about', 'helplines'];
    if (!user && !publicPages.includes(page)) {
      console.log(`[App] handleNavigate: unauthenticated user requested private page "${page}" -> redirecting to "auth"`);
      setCurrentPage('auth');
    } else {
      console.log(`[App] handleNavigate: setting currentPage to "${page}"`);
      setCurrentPage(page);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = () => {
    console.log('[App] handleLogout invoked -> setting showLogoutConfirm = true');
    setShowLogoutConfirm(true);
  };

  const handleConfirmLogout = async () => {
    console.log('[App] handleConfirmLogout invoked -> user confirmed logout');
    setShowLogoutConfirm(false);
    setIsLoggingOut(true);
    try {
      console.log('[App] Initiating Firebase logoutUser and showing "Logging out..." spinner');
      // Execute Firebase auth logout and ensure a brief moment for the user to see the loading spinner
      const logoutPromise = logoutUser();
      const delayPromise = new Promise((resolve) => setTimeout(resolve, 800));
      await Promise.all([logoutPromise, delayPromise]);
      console.log('[App] Logout complete -> resetting user state and navigating to auth');
      setUser(null);
      setCurrentPage('auth');
    } catch (err) {
      console.error('[App] Logout error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setAppSettings(newSettings);
    saveAppSettings(newSettings);
  };

  const handleTriggerFakeCall = () => {
    setFakeCallActive(true);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#FAF6F3] flex items-center justify-center text-[#3A3A3A]">
        <div className="flex items-center space-x-3 bg-white px-6 py-4 rounded-2xl border border-[#EFE8E1] shadow-xs">
          <div className="w-5 h-5 border-2 border-[#C88EA7] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-[#5A5558]">Loading SafeCheck...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF6F3] text-[#3A3A3A] font-sans flex flex-col selection:bg-[#C88EA7]/20 selection:text-[#9E4D71] relative">
      {/* Logging Out Overlay */}
      {isLoggingOut && (
        <div
          id="logging-out-overlay"
          className="fixed inset-0 bg-[#1A1A1A]/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white px-7 py-5 rounded-3xl border border-[#EFE8E1] shadow-2xl flex items-center space-x-3.5 animate-in zoom-in-95 duration-150">
            <div className="w-5 h-5 border-2 border-[#F0D0DF] border-t-[#9E4D71] rounded-full animate-spin shrink-0" />
            <span className="text-sm font-bold text-[#3A3A3A]">Logging out...</span>
          </div>
        </div>
      )}

      {/* Sync on Reconnect Toast */}
      {syncNotice && (
        <div className="bg-emerald-600 text-white font-bold text-xs py-2.5 px-4 text-center flex items-center justify-center space-x-2 shadow-md shrink-0 z-50 animate-in slide-in-from-top duration-200">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>{syncNotice}</span>
        </div>
      )}

      {/* Offline Status Banner */}
      {isOffline && (
        <div className="bg-amber-500 text-slate-950 font-bold text-xs py-2 px-4 text-center flex items-center justify-center space-x-2 shadow-xs shrink-0 z-50">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Offline Mode Active • Hardware GPS & Local Arrival Timer running. Destination entry enabled manually. Cellular SMS fallback ready.</span>
        </div>
      )}

      <Navbar
        user={user}
        activeTrip={activeTrip}
        currentPage={currentPage}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        onOpenSystemLogs={() => setSystemLogsOpen(true)}
        isOffline={isOffline}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(guardianTripId || guardianUserId || currentPage === 'guardian') ? (
          <GuardianView
            tripId={guardianTripId || undefined}
            userId={guardianUserId || undefined}
            onBackToApp={() => {
              setGuardianTripId(null);
              setGuardianUserId(null);
              setCurrentPage('home');
              try {
                window.history.replaceState({}, '', window.location.pathname);
              } catch (e) {}
            }}
          />
        ) : (
          <>
            {currentPage === 'home' && (
              <Home user={user} onNavigate={handleNavigate} />
            )}

            {currentPage === 'auth' && !user && (
              <Auth
                onAuthSuccess={() => handleNavigate('dashboard')}
              />
            )}

            {(currentPage === 'dashboard' || (currentPage === 'auth' && user)) && user && (
              <Dashboard
                user={user}
                contacts={contacts}
                activeTrip={activeTrip}
                recentTrips={recentTrips}
                settings={appSettings}
                onNavigate={handleNavigate}
                onTriggerFakeCall={handleTriggerFakeCall}
              />
            )}

            {currentPage === 'contacts' && user && (
              <Contacts
                user={user}
                contacts={contacts}
                onNavigate={handleNavigate}
              />
            )}

            {currentPage === 'profile' && user && (
              <Profile
                user={user}
                contacts={contacts}
                trips={recentTrips}
                onNavigate={handleNavigate}
                onReopenOnboarding={() => setShowOnboarding(true)}
                onUpdateUser={(updated) => setUser(updated)}
              />
            )}

            {currentPage === 'start-trip' && user && (
              <StartTrip
                user={user}
                contacts={contacts}
                activeTrip={activeTrip}
                onTripCreated={() => setCurrentPage('active-trip')}
                onNavigate={handleNavigate}
              />
            )}

            {currentPage === 'active-trip' && user && (
              <ActiveTrip
                trip={activeTrip}
                settings={appSettings}
                user={user}
                onTripUpdated={() => {}}
                onNavigate={handleNavigate}
                onTriggerFakeCall={handleTriggerFakeCall}
              />
            )}

            {currentPage === 'history' && user && (
              <TripHistory
                trips={recentTrips}
                onNavigate={handleNavigate}
              />
            )}

            {currentPage === 'settings' && (
              <Settings
                settings={appSettings}
                onSave={handleSaveSettings}
                onTriggerFakeCall={handleTriggerFakeCall}
              />
            )}

            {currentPage === 'about' && (
              <About />
            )}

            {currentPage === 'helplines' && (
              <Helplines onNavigate={handleNavigate} />
            )}
          </>
        )}
      </main>

      <Footer
        onNavigate={handleNavigate}
        onOpenSystemLogs={() => setSystemLogsOpen(true)}
      />

      <SystemLogDrawer
        isOpen={systemLogsOpen}
        onClose={() => setSystemLogsOpen(false)}
      />

      {/* Onboarding Safety Tour Carousel (First login or user request) */}
      {user && (
        <OnboardingCarousel
          user={user}
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
        />
      )}

      {/* Floating Fake Call Button on Dashboard / Home / Active Trip */}
      {appSettings?.floatingFakeCallButton && !fakeCallActive && (
        <FakeCallTrigger
          settings={appSettings || DEFAULT_SETTINGS}
          callerName={appSettings?.fakeCallerName || DEFAULT_SETTINGS.fakeCallerName}
          onTrigger={handleTriggerFakeCall}
          onTriggerFakeCall={handleTriggerFakeCall}
        />
      )}

      {/* Incoming Fake Call Ringing Simulation Modal */}
      {fakeCallActive && (
        <FakeCallModal
          isOpen={fakeCallActive}
          settings={appSettings || DEFAULT_SETTINGS}
          callerName={appSettings?.fakeCallerName || DEFAULT_SETTINGS.fakeCallerName}
          callerSubtitle={appSettings?.fakeCallerSubtitle || DEFAULT_SETTINGS.fakeCallerSubtitle}
          soundEnabled={appSettings?.ringtoneEnabled ?? DEFAULT_SETTINGS.ringtoneEnabled}
          onClose={() => setFakeCallActive(false)}
        />
      )}

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => {
          console.log('[App] Logout confirmation modal closed/cancelled');
          setShowLogoutConfirm(false);
        }}
        onConfirm={handleConfirmLogout}
        userName={user?.name}
      />

      {/* Background Fall Detection Listener */}
      {user && (
        <FallDetectionListener
          settings={appSettings || DEFAULT_SETTINGS}
          onTriggerSOS={() => handleTriggerEmergencySOS('Automated Fall Detection', 'fall_detected')}
          onUpdateSettings={handleSaveSettings}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}
