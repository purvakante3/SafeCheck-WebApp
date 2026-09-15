import React, { useEffect, useState, useRef } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  BellRing,
  Navigation,
  Lock,
  MapPin,
  Share2,
  ExternalLink,
  Check,
  PhoneCall,
  RefreshCw,
  Phone,
  AlertOctagon,
  Siren,
  Play,
  Mic,
  Activity,
  Radio,
  QrCode,
  Copy,
  Footprints,
  Route,
  PlusCircle,
  Sparkles,
  WifiOff,
  MessageSquare,
  BatteryWarning,
} from 'lucide-react';
import { Trip, AppSettings, UserProfile, LocationTrailPoint, EmergencyContact } from '../types';
import {
  markTripSafe,
  cancelTrip,
  recordTripCheckInEvent,
  appendTripLocationTrail,
  recordLateTripResponse,
  triggerLateTripAutoEscalation,
} from '../services/tripService';
import { triggerSOSAlert } from '../services/sosService';
import {
  getCurrentLocation,
  shareLocationUrl,
  startLocationWatcher,
  LocationResult,
  calculateDistanceMeters,
} from '../services/locationService';
import { formatDuration } from '../utils/formatters';
import { getGuardianUrl } from '../services/guardianService';
import { AudioEvidenceRecorder } from '../components/AudioEvidenceRecorder';
import { AudioEvidencePlayer } from '../components/AudioEvidencePlayer';
import { EmergencyQRExchangeModal } from '../components/EmergencyQRExchangeModal';
import { EmergencyQRCard } from '../components/EmergencyQRCard';
import { LowBatteryMonitor } from '../components/LowBatteryMonitor';
import { useLanguage } from '../i18n/LanguageContext';
import { getCachedContacts, getUserContacts } from '../services/contactService';
import {
  isDeviceOnline,
  subscribeOnlineStatus,
  triggerNativeSms,
  buildEmergencySmsMessage,
  buildEmergencySmsUrl,
} from '../services/offlineSyncService';

interface ActiveTripProps {
  trip: Trip | null;
  settings?: AppSettings;
  user?: UserProfile | null;
  onTripUpdated: () => void;
  onNavigate: (page: string) => void;
  onTriggerFakeCall?: () => void;
}

export const ActiveTrip: React.FC<ActiveTripProps> = ({
  trip,
  settings,
  user,
  onTripUpdated,
  onNavigate,
  onTriggerFakeCall,
}) => {
  const { t } = useLanguage();
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(0);
  const [graceLeftSeconds, setGraceLeftSeconds] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(100);
  const [updating, setUpdating] = useState(false);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);
  const [locUpdating, setLocUpdating] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [copiedGuardianLink, setCopiedGuardianLink] = useState(false);

  // SOS confirmation modal
  const [sosModalOpen, setSosModalOpen] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);

  // Continuous Location Tracking state
  const [currentGPS, setCurrentGPS] = useState<LocationResult | null>(null);
  const [trailCount, setTrailCount] = useState<number>(0);
  const lastRecordedLocationRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // LATE ARRIVAL POPUP STATE & 2-MINUTE ESCALATION
  const [latePopupOpen, setLatePopupOpen] = useState(false);
  const [lateEscalationSeconds, setLateEscalationSeconds] = useState<number>(120); // 2 minutes (120s)
  const [lateActionLoading, setLateActionLoading] = useState(false);
  const lateEscalatedRef = useRef(false);

  // Scheduled Mid-Trip Check-In state
  const [checkInDue, setCheckInDue] = useState(false);
  const [checkInCountdownSeconds, setCheckInCountdownSeconds] = useState<number>(300);
  const [checkInAcknowledged, setCheckInAcknowledged] = useState(false);

  // Offline resilience & contacts
  const [isOffline, setIsOffline] = useState<boolean>(!isDeviceOnline());
  const [emergencyContactsList, setEmergencyContactsList] = useState<EmergencyContact[]>([]);

  useEffect(() => {
    const unsub = subscribeOnlineStatus((online) => {
      setIsOffline(!online);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (user?.uid) {
      const cached = getCachedContacts(user.uid);
      if (cached && cached.length > 0) {
        setEmergencyContactsList(cached);
      }
      if (isDeviceOnline()) {
        getUserContacts(user.uid)
          .then((res) => {
            if (res && res.length > 0) setEmergencyContactsList(res);
          })
          .catch(() => {});
      }
    }
  }, [user?.uid]);

  const handleManualOfflineSms = (targetPhone?: string) => {
    if (!trip) return;
    const phone =
      targetPhone ||
      emergencyContactsList.find((c) => c.isPrimary && c.phone)?.phone ||
      emergencyContactsList.find((c) => c.phone)?.phone;
    const msg = buildEmergencySmsMessage({
      userName: user?.name,
      destination: trip.destination,
      lat: currentGPS?.latitude ?? trip.latitude ?? null,
      lng: currentGPS?.longitude ?? trip.longitude ?? null,
      address: currentGPS?.address ?? trip.lastKnownAddress,
      isOverdue: trip.status === 'alerted' || latePopupOpen || trip.status === 'reminded',
    });
    triggerNativeSms(phone, msg);
  };

  // Sound chime helper
  const playAlertChime = (type: 'late' | 'chime' = 'chime') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'late') {
        // High-priority urgent double chime
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch {}
  };

  // 1. CONTINUOUS LOCATION TRACKING: Watcher while trip is active
  useEffect(() => {
    if (!trip || trip.status !== 'active') return;

    setTrailCount(trip.locationTrail?.length || 0);

    const cleanupWatcher = startLocationWatcher({
      intervalMs: 20000, // sample every 20 seconds
      onLocation: async (loc) => {
        if (!loc.success || !loc.latitude || !loc.longitude) return;
        setCurrentGPS(loc);

        const now = Date.now();
        const last = lastRecordedLocationRef.current;

        // Check if movement exceeds 15 meters OR > 45 seconds elapsed since last trail log
        let shouldRecord = false;
        if (!last) {
          shouldRecord = true;
        } else {
          const dist = calculateDistanceMeters(last.lat, last.lng, loc.latitude, loc.longitude);
          const timeElapsed = now - last.time;
          if (dist >= 15 || timeElapsed >= 45000) {
            shouldRecord = true;
          }
        }

        if (shouldRecord && user) {
          lastRecordedLocationRef.current = {
            lat: loc.latitude,
            lng: loc.longitude,
            time: now,
          };

          const trailPoint: LocationTrailPoint = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
            speed: loc.speed,
            timestamp: new Date().toISOString(),
            locationUrl: loc.locationUrl || undefined,
            address: loc.address || undefined,
          };

          try {
            await appendTripLocationTrail(trip.id, user.uid, trailPoint);
            setTrailCount((prev) => prev + 1);
          } catch (e) {
            console.warn('Trail point append notice:', e);
          }
        }
      },
      onError: (err) => {
        console.warn('Continuous location tracking notice:', err);
      },
    });

    return () => {
      cleanupWatcher();
    };
  }, [trip?.id, trip?.status, user?.uid]);

  // 2. PRIMARY TRIP COUNTDOWN & ARRIVAL TIMER
  useEffect(() => {
    if (!trip) return;

    const intervalMinutes = settings?.checkInReminderIntervalMinutes || 15;
    const timeoutMinutes = settings?.unacknowledgedTimeoutMinutes || 5;

    const updateTimer = () => {
      const now = new Date().getTime();
      const startTime = new Date(trip.startTime).getTime();
      const durationMs = trip.durationMinutes * 60 * 1000;
      const expectedArrival = startTime + durationMs;

      const remainingTripMs = expectedArrival - now;
      const remSec = Math.max(0, Math.floor(remainingTripMs / 1000));
      setTimeLeftSeconds(remSec);

      const totalSec = trip.durationMinutes * 60;
      const pct = Math.min(100, Math.max(0, Math.round((remSec / totalSec) * 100)));
      setProgressPercent(pct);

      // TRIGGER LATE ARRIVAL FLOW WHEN TIMER EXPIRES (0 seconds left)
      if (
        remSec === 0 &&
        trip.status === 'active' &&
        !latePopupOpen &&
        !lateEscalatedRef.current
      ) {
        setLatePopupOpen(true);
        setLateEscalationSeconds(120); // start 2-minute countdown
        playAlertChime('late');
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 400]);
      }

      // Check for scheduled mid-trip reminders if enabled
      if (settings?.tripCheckInRemindersEnabled && !checkInDue && !checkInAcknowledged) {
        const elapsedMinutes = (now - startTime) / (1000 * 60);
        if (elapsedMinutes >= intervalMinutes && elapsedMinutes < trip.durationMinutes) {
          setCheckInDue(true);
          setCheckInCountdownSeconds(timeoutMinutes * 60);
          playAlertChime();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      }

      if (trip.status === 'reminded' && trip.reminderSentAt) {
        const reminderTime = new Date(trip.reminderSentAt).getTime();
        const graceMs = trip.graceMinutes * 60 * 1000;
        const deadline = reminderTime + graceMs;
        const remainingGraceMs = deadline - now;
        setGraceLeftSeconds(Math.max(0, Math.floor(remainingGraceMs / 1000)));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [trip, settings, checkInDue, checkInAcknowledged, latePopupOpen]);

  // 3. 2-MINUTE AUTO-ESCALATION COUNTDOWN FOR LATE POPUP
  useEffect(() => {
    if (!latePopupOpen || lateEscalatedRef.current) return;

    const timer = setInterval(() => {
      setLateEscalationSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [latePopupOpen]);

  // Execute auto-escalation when late arrival countdown reaches 0
  useEffect(() => {
    if (latePopupOpen && lateEscalationSeconds === 0 && !lateEscalatedRef.current && trip && user) {
      lateEscalatedRef.current = true;
      triggerLateTripAutoEscalation(trip, user, {
        latitude: currentGPS?.latitude ?? null,
        longitude: currentGPS?.longitude ?? null,
        locationUrl: currentGPS?.locationUrl ?? null,
        address: currentGPS?.address ?? null,
      }).finally(() => {
        setLatePopupOpen(false);
        onTripUpdated();
      });
    }
  }, [latePopupOpen, lateEscalationSeconds, trip, user, currentGPS, onTripUpdated]);

  // 4. LATE POPUP ACTION 1: "Yes, I'm safe"
  const handleLateResponseSafe = async () => {
    if (!trip || !user) return;
    setLateActionLoading(true);
    try {
      await recordLateTripResponse(trip.id, user.uid, {
        timestamp: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        action: 'safe',
        reason: 'User confirmed arrival: I am safe',
        latitude: currentGPS?.latitude ?? null,
        longitude: currentGPS?.longitude ?? null,
      });
      await markTripSafe(trip.id, user.uid);
      setLatePopupOpen(false);
      onTripUpdated();
    } catch (e) {
      console.error('Error confirming safe arrival:', e);
    } finally {
      setLateActionLoading(false);
    }
  };

  // 4. LATE POPUP ACTION 2: "Need more time" (+5, +10, +15 mins)
  const handleLateResponseExtend = async (additionalMinutes: number) => {
    if (!trip || !user) return;
    setLateActionLoading(true);
    try {
      await recordLateTripResponse(trip.id, user.uid, {
        timestamp: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        action: 'extended',
        extendedMinutes: additionalMinutes,
        reason: `Need more time (+${additionalMinutes} mins)`,
        latitude: currentGPS?.latitude ?? null,
        longitude: currentGPS?.longitude ?? null,
      });
      setLatePopupOpen(false);
      setShareSuccess(`Trip extended by ${additionalMinutes} minutes. Location tracking continues!`);
      setTimeout(() => setShareSuccess(null), 3500);
      onTripUpdated();
    } catch (e) {
      console.error('Error extending trip duration:', e);
    } finally {
      setLateActionLoading(false);
    }
  };

  // 4. LATE POPUP ACTION 3: "I need help / SOS"
  const handleLateResponseSOS = async () => {
    if (!trip || !user) return;
    setLateActionLoading(true);
    try {
      await recordLateTripResponse(trip.id, user.uid, {
        timestamp: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        action: 'sos',
        reason: 'User pressed I need help / SOS in late arrival check-in',
        latitude: currentGPS?.latitude ?? null,
        longitude: currentGPS?.longitude ?? null,
      });
      await triggerSOSAlert(
        user.uid,
        user.name,
        user.email,
        currentGPS?.latitude ?? trip.latitude ?? null,
        currentGPS?.longitude ?? trip.longitude ?? null,
        currentGPS?.locationUrl ?? trip.locationUrl ?? null,
        null,
        {
          isLateEscalation: true,
          destination: trip.destination,
          activeTripId: trip.id,
          contacts: emergencyContactsList,
          customSubject: `🚨 EMERGENCY SOS: ${user.name || 'User'} requested emergency help during trip to "${trip.destination}"`,
        }
      );
      setLatePopupOpen(false);
      onTripUpdated();
    } catch (e) {
      console.error('Error triggering emergency SOS from late popup:', e);
    } finally {
      setLateActionLoading(false);
    }
  };

  // Scheduled check-in countdown timer when due
  useEffect(() => {
    if (!checkInDue) return;

    const countdownTimer = setInterval(() => {
      setCheckInCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownTimer);
  }, [checkInDue]);

  // Trigger alert if scheduled check-in countdown expires without acknowledgment
  useEffect(() => {
    if (checkInDue && checkInCountdownSeconds === 0 && settings?.autoAlertIfNotAcknowledged && trip && user) {
      triggerSOSAlert(
        user.uid,
        user.name,
        user.email,
        trip.latitude ?? null,
        trip.longitude ?? null,
        trip.locationUrl ?? null,
        null,
        {
          activeTripId: trip.id,
          destination: trip.destination,
          type: 'manual',
          contacts: emergencyContactsList,
          customSubject: `🚨 SCHEDULED CHECK-IN TIMEOUT: ${user.name || 'User'} missed check-in during trip to "${trip.destination}"`,
        }
      );
      recordTripCheckInEvent(trip.id, user.uid, {
        type: 'emergency_alert',
        message: 'Unresponsive to scheduled check-in. Emergency contacts automatically notified.',
      });
      onTripUpdated();
    }
  }, [checkInDue, checkInCountdownSeconds, settings?.autoAlertIfNotAcknowledged, trip, user, onTripUpdated]);

  if (!trip) {
    return (
      <div className="bg-white border border-[#EFE8E1] rounded-3xl p-10 sm:p-14 text-center max-w-lg mx-auto space-y-4 shadow-xs">
        <div className="w-14 h-14 bg-[#F9EDF3] rounded-2xl flex items-center justify-center mx-auto text-[#9E4D71] border border-[#F0D0DF]">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-[#3A3A3A]">{t('noTripsYet')}</h2>
        <p className="text-xs text-[#6B6368]">{t('noTripsDesc')}</p>
        <button
          id="no-active-trip-start-btn"
          onClick={() => onNavigate('start-trip')}
          className="px-6 py-3 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer transition-all"
        >
          {t('startCheckInBtn')}
        </button>
      </div>
    );
  }

  const isReminded = trip.status === 'reminded';
  const isArrivingSoon = timeLeftSeconds > 0 && timeLeftSeconds <= 300; // <= 5 minutes
  const quickDialNum = settings?.quickDialNumber || '1091';

  // Dynamic Status Text
  const currentStatusLabel = isReminded
    ? t('gracePeriodActive')
    : isArrivingSoon
    ? t('arrivingSoon')
    : t('tripInProgress');

  const handleMarkSafe = async () => {
    setUpdating(true);
    try {
      if (user) {
        await recordTripCheckInEvent(trip.id, user.uid, {
          type: 'manual_check_in',
          message: 'Safe arrival verified by user.',
        });
      }
      await markTripSafe(trip.id, user?.uid);
      onTripUpdated();
    } catch (err) {
      console.error('Error marking safe:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleTriggerDirectSOS = async () => {
    if (!user) return;
    setSosLoading(true);
    let isFinished = false;
    // Safety watchdog: allows up to 30 seconds for complete emergency email dispatch
    const safetyTimeout = setTimeout(() => {
      if (!isFinished) {
        console.warn('[SafeCheck SOS] Active trip safety timeout watchdog reached');
        setSosLoading(false);
        setSosModalOpen(false);
      }
    }, 30000);

    try {
      let lat = currentGPS?.latitude ?? trip.latitude ?? null;
      let lng = currentGPS?.longitude ?? trip.longitude ?? null;
      let locUrl = currentGPS?.locationUrl ?? trip.locationUrl ?? null;

      if (!lat || !lng) {
        try {
          const locRes = await Promise.race([
            getCurrentLocation(),
            new Promise<any>((_, reject) => setTimeout(() => reject('location timeout'), 3500)),
          ]);
          if (locRes && locRes.success && locRes.latitude && locRes.longitude) {
            lat = locRes.latitude;
            lng = locRes.longitude;
            locUrl = locRes.locationUrl || null;
          }
        } catch (locErr) {
          console.warn('[SafeCheck SOS] Active trip quick location notice:', locErr);
        }
      }

      if (isOffline) {
        handleManualOfflineSms();
      }

      const res = await Promise.race([
        triggerSOSAlert(user.uid, user.name, user.email, lat, lng, locUrl, null, {
          activeTripId: trip.id,
          destination: trip.destination,
          type: 'manual',
          contacts: emergencyContactsList,
        }),
        new Promise<any>((_, reject) => setTimeout(() => reject('triggerSOSAlert timeout'), 25000)),
      ]);

      isFinished = true;
      clearTimeout(safetyTimeout);
      setSosModalOpen(false);

      if (res && res.deliveredCount === 0 && emergencyContactsList.length > 0) {
        setShareSuccess(`⚠️ SOS Logged, but email dispatch failed (${res.emailDispatch?.error || 'Provider rejected'}). Please use SMS fallback!`);
        setTimeout(() => setShareSuccess(null), 6000);
      } else if (res && res.deliveredCount > 0) {
        setShareSuccess(`🚨 Emergency SOS active! Verified email dispatched to ${res.deliveredCount} contact${res.deliveredCount > 1 ? 's' : ''}.`);
        setTimeout(() => setShareSuccess(null), 4000);
      }

      onTripUpdated();
    } catch (e) {
      console.error('SOS direct trigger error:', e);
      isFinished = true;
      clearTimeout(safetyTimeout);
      setSosModalOpen(false);
    } finally {
      setSosLoading(false);
    }
  };

  const handleAcknowledgeScheduledCheckIn = async () => {
    setCheckInDue(false);
    setCheckInAcknowledged(true);
    if (user) {
      await recordTripCheckInEvent(trip.id, user.uid, {
        type: 'scheduled_check_in',
        message: 'Scheduled mid-trip check-in confirmed on time.',
      });
    }
    setShareSuccess('Check-in confirmed! Keep going safely.');
    setTimeout(() => setShareSuccess(null), 3000);
  };

  const handleSimulateCheckInDue = () => {
    setCheckInDue(true);
    setCheckInAcknowledged(false);
    setCheckInCountdownSeconds((settings?.unacknowledgedTimeoutMinutes || 5) * 60);
    playAlertChime();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };

  // Test trigger for Late Arrival Popup
  const handleSimulateLatePopup = () => {
    setLatePopupOpen(true);
    setLateEscalationSeconds(120);
    playAlertChime('late');
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 400]);
  };

  const handleCancel = async () => {
    if (window.confirm('Cancel this check-in trip? No notifications will be sent.')) {
      setUpdating(true);
      try {
        await cancelTrip(trip.id, user?.uid);
        onTripUpdated();
        onNavigate('dashboard');
      } catch (err) {
        console.error('Error cancelling trip:', err);
      } finally {
        setUpdating(false);
      }
    }
  };

  const handleShareLocation = async () => {
    let url = currentGPS?.locationUrl || trip.locationUrl;
    if (!url) {
      const locRes = await getCurrentLocation();
      if (locRes.success && locRes.locationUrl) {
        url = locRes.locationUrl;
        trip.locationUrl = url;
        trip.latitude = locRes.latitude;
        trip.longitude = locRes.longitude;
        onTripUpdated();
      }
    }

    if (url) {
      const res = await shareLocationUrl(url, trip.destination);
      if (res.success) {
        setShareSuccess(res.method === 'clipboard' ? 'Location copied to clipboard!' : 'Location shared!');
        setTimeout(() => setShareSuccess(null), 3000);
      }
    } else {
      alert('Unable to fetch GPS coordinates. Please grant location permissions in your browser.');
    }
  };

  const handleAttachLocation = async () => {
    setLocUpdating(true);
    try {
      const locRes = await getCurrentLocation();
      if (locRes.success && locRes.locationUrl) {
        setCurrentGPS(locRes);
        trip.locationUrl = locRes.locationUrl;
        trip.latitude = locRes.latitude;
        trip.longitude = locRes.longitude;
        onTripUpdated();
        setShareSuccess('Live GPS coordinates updated!');
        setTimeout(() => setShareSuccess(null), 3000);
      } else if (locRes.errorMessage) {
        alert(locRes.errorMessage);
      }
    } catch (e) {
      console.error('Failed to update location:', e);
    } finally {
      setLocUpdating(false);
    }
  };

  const formatMinSec = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const arrivalTimeStr = new Date(
    new Date(trip.startTime).getTime() + trip.durationMinutes * 60 * 1000
  ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      {/* Audio Snapshot Recorder in RAM */}
      {(trip.status === 'active' || trip.status === 'reminded') && (
        <AudioEvidenceRecorder
          tripId={trip.id}
          isEnabled={settings?.audioSnapshottingEnabled ?? true}
          onSnapshotUpdated={() => {}}
        />
      )}

      {/* Captured Audio Player if present */}
      {trip.audioEvidence && (
        <AudioEvidencePlayer
          evidence={trip.audioEvidence}
          title="🚨 Emergency Incident Audio Evidence"
        />
      )}

      {/* Low Battery Auto-Alert Monitor (triggers at <15% battery once per trip) */}
      <LowBatteryMonitor
        trip={trip}
        user={user || null}
        contacts={emergencyContactsList}
        onAlertSent={() => {
          onTripUpdated();
        }}
      />

      {/* Scheduled Check-In Prompt Banner */}
      {checkInDue && (
        <div className="bg-amber-500 text-slate-950 p-5 sm:p-6 rounded-3xl shadow-xl border-2 border-amber-300 animate-pulse space-y-3">
          <div className="flex items-center space-x-3">
            <Clock className="w-7 h-7 text-slate-950 shrink-0" />
            <div>
              <h3 className="text-base font-black uppercase tracking-tight">
                ⏰ {t('scheduledCheckInDue')}
              </h3>
              <p className="text-xs font-semibold text-slate-900 mt-0.5">
                {t('scheduledCheckInDesc')}
              </p>
            </div>
          </div>

          <div className="bg-amber-600/30 p-2.5 rounded-2xl flex items-center justify-between">
            <span className="text-xs font-bold">Time before emergency escalation:</span>
            <span className="font-mono text-lg font-black text-slate-950">
              {formatMinSec(checkInCountdownSeconds)}
            </span>
          </div>

          <button
            id="acknowledge-check-in-btn"
            type="button"
            onClick={handleAcknowledgeScheduledCheckIn}
            className="w-full bg-[#3A3A3A] hover:bg-[#2A2A2A] text-white font-black text-xs py-3 rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{t('imSafeOnTrack')}</span>
          </button>
        </div>
      )}

      {/* Offline Status & Cellular SMS Fallback Indicator */}
      {isOffline && (
        <div
          id="active-trip-offline-card"
          className="bg-amber-50/95 border-2 border-amber-300 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                <WifiOff className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-amber-950 uppercase tracking-wide">
                    Offline Protection Active
                  </h4>
                  <span className="px-2 py-0.5 rounded-full bg-amber-200/90 text-amber-900 text-[10px] font-black uppercase tracking-wider">
                    Hardware GPS & Local Storage
                  </span>
                </div>
                <p className="text-xs text-amber-900 mt-0.5">
                  Arrival timer running locally. Location breadcrumbs are saved on-device and will auto-sync when internet reconnects.
                </p>
              </div>
            </div>

            <button
              type="button"
              id="offline-quick-sms-btn"
              onClick={() => handleManualOfflineSms()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white font-bold text-xs shadow-xs transition-all cursor-pointer shrink-0"
              title="Compose pre-filled emergency SMS via cellular"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Send Pre-Filled SMS</span>
            </button>
          </div>

          <div className="pt-2 border-t border-amber-200/80 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Emergency contacts fallback to native SMS (no cellular data/WiFi required)</span>
            </span>
            <span className="font-mono text-[10px] text-amber-800">
              Cached Contacts: {emergencyContactsList.length} | Local Breadcrumbs: {trailCount}
            </span>
          </div>
        </div>
      )}

      {/* DEDICATED LIVE TRIP DASHBOARD */}
      <div
        id="live-trip-dashboard-card"
        className="bg-white rounded-3xl border-2 border-[#C88EA7] shadow-xl p-6 sm:p-8 space-y-6 relative overflow-hidden"
      >
        {/* Top Active Bar with Real-Time Indicator & Status */}
        <div className="flex items-center justify-between border-b border-[#EFE8E1] pb-4">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#9E4D71] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#9E4D71]" />
            </span>
            <span className="text-xs font-black text-[#9E4D71] uppercase tracking-wider">
              {t('liveDashboardTitle')}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {trip.lowBatteryAlertSent && (
              <div
                id="active-trip-low-battery-badge"
                className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center space-x-1 border bg-amber-50 text-amber-800 border-amber-300"
                title="Low battery alert was automatically dispatched to emergency contacts"
              >
                <BatteryWarning className="w-3.5 h-3.5 text-amber-600" />
                <span>Battery Low Alert Sent ({trip.lowBatteryLevel ?? '<15'}%)</span>
              </div>
            )}

            <div
              className={`px-3 py-1 rounded-full text-xs font-black flex items-center space-x-1.5 border shadow-2xs ${
                isReminded
                  ? 'bg-amber-50 text-amber-800 border-amber-200 animate-pulse'
                  : isArrivingSoon
                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{currentStatusLabel}</span>
            </div>
          </div>
        </div>

        {/* Destination & Meta Info */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3A3A3A] tracking-tight">
              {trip.destination}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[#6B6368]">
              <span>
                {t('tripStartedAt', {
                  time: new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                })}
              </span>
              <span>•</span>
              <span>{formatDuration(trip.durationMinutes)} scheduled</span>
              {trip.travelMode && (
                <>
                  <span>•</span>
                  <span className="capitalize font-semibold text-[#9E4D71]">
                    {trip.travelMode === 'walking' ? '🚶 Walking' : trip.travelMode === 'driving' ? '🚗 Driving' : '🚌 Transit'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="text-left sm:text-right shrink-0">
            <span className="text-xs font-semibold text-[#7D757A]">
              {t('expectedArrival')}:
            </span>
            <div className="text-sm font-bold text-[#9E4D71] font-mono">
              ~{arrivalTimeStr}
            </div>
          </div>
        </div>

        {/* Live Countdown Display + Progress Bar */}
        <div className="bg-[#FAF6F3] border border-[#EFE8E1] rounded-2xl p-5 space-y-4 text-center">
          <div className="flex flex-col items-center justify-center">
            <div
              className={`text-5xl sm:text-6xl font-black font-mono tracking-tight ${
                isReminded
                  ? 'text-amber-800 animate-pulse'
                  : isArrivingSoon
                  ? 'text-[#9E4D71]'
                  : 'text-[#3A3A3A]'
              }`}
            >
              {isReminded ? formatMinSec(graceLeftSeconds) : formatMinSec(timeLeftSeconds)}
            </div>
            <div className="text-xs font-bold text-[#7D757A] uppercase tracking-wider mt-1">
              {isReminded ? t('graceRemaining') : timeLeftSeconds >= 3600 ? 'Time Remaining' : t('minsRemaining')}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full h-3 bg-[#EFE8E1] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  isReminded ? 'bg-amber-600' : 'bg-[#B36D8B]'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-[#7D757A]">
              <span>{Math.round(progressPercent)}% Time Left</span>
              <span>ETA {arrivalTimeStr}</span>
            </div>
          </div>
        </div>

        {/* PRIMARY ACTION: I'M SAFE (Huge, Clear, Emerald) */}
        <button
          id="mark-safe-primary-btn"
          onClick={handleMarkSafe}
          disabled={updating}
          className="w-full bg-[#10B981] hover:bg-[#059669] active:bg-[#047857] text-white text-lg sm:text-xl font-black py-4 sm:py-4.5 rounded-2xl shadow-lg shadow-emerald-700/20 transition-all active:scale-[0.98] flex items-center justify-center space-x-2.5 cursor-pointer"
        >
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <span>{t('imSafeBtn')}</span>
        </button>

        {/* CONTINUOUS LOCATION TRACKING & TRAIL LOG CARD */}
        <div className="bg-[#FAF6F3] border border-[#EADED7] rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
              </span>
              <span className="text-xs font-extrabold text-[#3A3A3A] flex items-center gap-1.5">
                <Route className="w-4 h-4 text-[#9E4D71]" />
                <span>Continuous GPS Tracking Active</span>
              </span>
            </div>

            <div className="px-2.5 py-0.5 rounded-full bg-white border border-[#EFE8E1] text-[11px] font-bold text-[#9E4D71]">
              {trailCount} GPS points logged
            </div>
          </div>

          <div className="text-xs text-[#524B4F] space-y-1">
            <p className="font-medium text-[#2E282C] line-clamp-1">
              📍 Current: {currentGPS?.address || trip.lastKnownAddress || 'Acquiring GPS location...'}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#7D757A] font-mono">
              <span>
                Lat: {(currentGPS?.latitude ?? trip.latitude ?? 0).toFixed(4)}, Lng: {(currentGPS?.longitude ?? trip.longitude ?? 0).toFixed(4)}
              </span>
              {currentGPS?.accuracy && <span>±{currentGPS.accuracy}m</span>}
              {currentGPS?.speed !== null && currentGPS?.speed !== undefined && (
                <span>{(currentGPS.speed * 3.6).toFixed(1)} km/h</span>
              )}
            </div>
          </div>
        </div>

        {/* QUICK ACCESS ACTION BUTTONS: SOS, SHARE LOCATION, FAKE CALL */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Quick SOS Trigger */}
          <button
            id="active-trip-sos-btn"
            type="button"
            onClick={() => setSosModalOpen(true)}
            className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-black text-xs uppercase tracking-wider shadow-md shadow-rose-600/20 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Siren className="w-4 h-4 animate-pulse" />
            <span>{t('sosButton')}</span>
          </button>

          {/* Quick Share Location */}
          <button
            id="active-trip-share-loc-btn"
            type="button"
            onClick={handleShareLocation}
            className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] active:bg-[#EAE2DB] text-[#3A3A3A] border border-[#EFE8E1] font-bold text-xs transition-all active:scale-[0.98] cursor-pointer shadow-2xs"
          >
            <Share2 className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('shareLocationBtn')}</span>
          </button>

          {/* Quick Fake Call Trigger */}
          {onTriggerFakeCall && (
            <button
              id="active-trip-quick-fake-call-btn"
              type="button"
              onClick={onTriggerFakeCall}
              className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl bg-[#3A3A3A] hover:bg-[#2A2A2A] active:bg-black text-white font-bold text-xs transition-all active:scale-[0.98] cursor-pointer shadow-2xs"
            >
              <PhoneCall className="w-4 h-4 text-emerald-400" />
              <span>{t('fakeCallBtn')}</span>
            </button>
          )}
        </div>

        {shareSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{shareSuccess}</span>
          </div>
        )}

        {/* Live Location Status & Helper Strip */}
        <div className="bg-[#FAF6F3] border border-[#EFE8E1] rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-2 truncate">
            <MapPin className="w-4 h-4 text-[#9E4D71] shrink-0" />
            {trip.locationUrl ? (
              <span className="font-mono text-[#9E4D71] truncate max-w-xs select-all">
                {trip.locationUrl}
              </span>
            ) : (
              <span className="text-[#6B6368]">{t('noGpsAttached')}</span>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {trip.locationUrl ? (
              <button
                type="button"
                onClick={handleAttachLocation}
                disabled={locUpdating}
                className="text-[11px] font-bold text-[#9E4D71] hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${locUpdating ? 'animate-spin' : ''}`} />
                <span>{locUpdating ? 'Updating GPS...' : 'Refresh GPS'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAttachLocation}
                disabled={locUpdating}
                className="px-2.5 py-1 rounded-lg bg-[#B36D8B] text-white font-bold text-[11px] shadow-2xs cursor-pointer"
              >
                {locUpdating ? 'Locating...' : t('attachGpsNow')}
              </button>
            )}
          </div>
        </div>

        {/* Footer utilities: Test Check-In, Test Late Popup, & Cancel */}
        <div className="flex items-center justify-between pt-2 border-t border-[#EFE8E1] text-[11px]">
          <div className="flex items-center gap-3">
            <button
              id="test-late-popup-btn"
              type="button"
              onClick={handleSimulateLatePopup}
              className="font-bold text-amber-800 hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <BellRing className="w-3 h-3 text-amber-700" />
              <span>Test Late Popup</span>
            </button>

            <button
              id="test-check-in-due-btn"
              type="button"
              onClick={handleSimulateCheckInDue}
              className="font-bold text-[#9E4D71] hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <Play className="w-3 h-3" />
              <span>{t('testReminder')}</span>
            </button>

            <button
              id="test-low-battery-alert-btn"
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('safecheck:simulate-low-battery', { detail: { level: 0.12 } })
                );
              }}
              className="font-bold text-amber-800 hover:underline flex items-center space-x-1 cursor-pointer"
              title="Simulate battery level dropping to 12% to test low-battery auto-alert"
            >
              <BatteryWarning className="w-3 h-3 text-amber-600" />
              <span>Test Battery Alert (12%)</span>
            </button>
          </div>

          <button
            id="cancel-active-trip-btn"
            onClick={handleCancel}
            disabled={updating}
            className="font-semibold text-[#7D757A] hover:text-rose-700 transition-colors flex items-center space-x-1 cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>{t('cancelTrip')}</span>
          </button>
        </div>
      </div>

      {/* GUARDIAN COMPANION & EMERGENCY QR HANDOFF CARD */}
      <div className="bg-white rounded-3xl border border-[#EFE8E1] p-6 sm:p-7 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EFE8E1] pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F9EDF3] text-[#9E4D71] flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-sm sm:text-base text-[#3A3A3A]">
                {t('guardianDashboardTitle')}
              </h2>
              <p className="text-xs text-[#6B6368]">
                {t('guardianDashboardSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="open-qr-handoff-modal-btn"
              type="button"
              onClick={() => setQrModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] flex items-center space-x-1.5 cursor-pointer shadow-2xs transition-all"
            >
              <QrCode className="w-3.5 h-3.5 text-[#9E4D71]" />
              <span>{t('emergencyQrHandoffTitle')}</span>
            </button>

            <a
              id="open-guardian-external-btn"
              href={getGuardianUrl(trip.id)}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-2xs flex items-center space-x-1.5 transition-colors"
            >
              <span>View Guardian Page</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Embedded QR Code Card for fast local glance */}
        <EmergencyQRCard trip={trip} compact />
      </div>

      {/* Emergency QR Exchange Modal */}
      <EmergencyQRExchangeModal
        isOpen={qrModalOpen}
        trip={trip}
        isSosMode={trip.status === 'alerted'}
        onClose={() => setQrModalOpen(false)}
      />

      {/* ============================================================ */}
      {/* LATE ARRIVAL CHECK-IN POPUP MODAL (HIGH PRIORITY)           */}
      {/* ============================================================ */}
      {latePopupOpen && (
        <div className="fixed inset-0 bg-[#3A3A3A]/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border-2 border-amber-400 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-6 relative text-[#3A3A3A]">
            {/* Header with High-Priority Arrival Prompt */}
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-50 border-4 border-amber-200 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-700 animate-pulse" />
              </div>
              <div className="space-y-1">
                <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-black uppercase tracking-wider">
                  Arrival Time Reached
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-[#3A3A3A] tracking-tight">
                  Have you arrived safely at {trip.destination}?
                </h2>
              </div>
            </div>

            {/* 2-Minute Escalation Countdown Bar */}
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl space-y-2 text-center">
              <div className="flex items-center justify-between text-xs font-bold text-rose-900">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 animate-pulse" />
                  <span>Automatic Emergency Alert in:</span>
                </span>
                <span className="font-mono text-base font-black text-rose-700">
                  {formatMinSec(lateEscalationSeconds)}
                </span>
              </div>

              {/* Progress track */}
              <div className="w-full h-2 bg-rose-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-600 rounded-full transition-all duration-1000"
                  style={{ width: `${(lateEscalationSeconds / 120) * 100}%` }}
                />
              </div>

              <p className="text-[11px] text-rose-800 leading-tight">
                If unanswered, emergency contacts will be alerted with your GPS location, destination, and trail breadcrumbs.
              </p>
            </div>

            {/* THREE CLEAR OPTIONS */}
            <div className="space-y-3">
              {/* Option 1: "Yes, I'm safe" */}
              <button
                id="late-popup-safe-btn"
                type="button"
                onClick={handleLateResponseSafe}
                disabled={lateActionLoading}
                className="w-full py-4 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5 text-white" />
                <span>Yes, I'm Safe (Complete Trip)</span>
              </button>

              {/* Option 2: "Need more time" (+5, +10, +15 mins) */}
              <div className="space-y-1.5 pt-1">
                <span className="text-xs font-bold text-[#6B6368] block text-center">
                  Need more time? Extend arrival timer:
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[5, 10, 15].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      id={`late-popup-extend-${mins}-btn`}
                      onClick={() => handleLateResponseExtend(mins)}
                      disabled={lateActionLoading}
                      className="py-2.5 px-3 rounded-xl bg-[#FAF6F3] hover:bg-[#F0E6DE] text-[#3A3A3A] border border-[#EFE8E1] font-bold text-xs shadow-2xs transition-all active:scale-[0.98] flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5 text-[#9E4D71]" />
                      <span>+{mins} min</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Option 3: "I need help / SOS" */}
              <button
                id="late-popup-sos-btn"
                type="button"
                onClick={handleLateResponseSOS}
                disabled={lateActionLoading}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 cursor-pointer mt-2"
              >
                <Siren className="w-4 h-4 animate-pulse" />
                <span>I Need Help / SOS Alert Now</span>
              </button>

              {/* Offline Native Cellular SMS fallback trigger */}
              {isOffline && (
                <div className="pt-2 border-t border-amber-200 mt-2 space-y-2">
                  <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-start gap-2 text-[11px] text-amber-900 leading-snug">
                    <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      Device is offline. If unanswered, your emergency contacts will be alerted via native cellular SMS with your live GPS coordinates.
                    </span>
                  </div>
                  <button
                    type="button"
                    id="late-popup-sms-btn"
                    onClick={() => handleManualOfflineSms()}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Send Emergency SMS via Cellular Network</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Active Trip Direct SOS */}
      {sosModalOpen && (
        <div className="fixed inset-0 bg-[#3A3A3A]/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white border-2 border-rose-500 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6 relative text-[#3A3A3A]">
            <div className="text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 border-4 border-rose-200 flex items-center justify-center">
                <AlertOctagon className="w-8 h-8 text-rose-600 animate-pulse" />
              </div>
              <h2 className="text-xl font-black text-[#3A3A3A] uppercase tracking-tight">
                {isOffline ? 'Trigger Offline Emergency SOS?' : 'Trigger Immediate Emergency Alert?'}
              </h2>
              <p className="text-xs text-[#6B6368] leading-relaxed">
                {isOffline
                  ? 'Your device is offline. Triggering SOS will open your native SMS app with a pre-filled emergency distress message and your GPS coordinates. SMS works over cellular networks without data or Wi-Fi.'
                  : 'This will immediately dispatch urgent email alerts with your GPS location to all saved emergency contacts.'}
              </p>
            </div>

            {isOffline && emergencyContactsList.length > 0 && (
              <div className="bg-[#FAF6F3] p-3 rounded-2xl border border-[#EFE8E1] space-y-2">
                <div className="text-[11px] font-bold text-[#6B6368] uppercase tracking-wider">
                  Select Contact for Pre-Filled SMS:
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {emergencyContactsList.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleManualOfflineSms(c.phone)}
                      className="w-full text-left p-2 rounded-xl bg-white border border-[#EFE8E1] hover:border-amber-400 text-xs flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <span className="font-bold text-[#3A3A3A] truncate">
                        {c.name} {c.isPrimary && '(Primary)'}
                      </span>
                      <span className="text-[11px] text-amber-800 font-mono flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        <span>SMS</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                id="active-trip-confirm-sos-btn"
                type="button"
                onClick={handleTriggerDirectSOS}
                disabled={sosLoading}
                className="w-full py-3.5 px-5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                {sosLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Dispatching SOS Alerts...</span>
                  </>
                ) : (
                  <>
                    <Siren className="w-4 h-4 text-white" />
                    <span>
                      {isOffline
                        ? 'Open Native Emergency SMS Now'
                        : 'Yes, Alert Emergency Contacts Now'}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSosModalOpen(false)}
                disabled={sosLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#FAF6F3] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] cursor-pointer"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

