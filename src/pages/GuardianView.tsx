import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Phone,
  PhoneCall,
  Share2,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Navigation,
  Siren,
  Activity,
  AlertOctagon,
  Radio,
  ArrowLeft,
  Volume2,
  Lock,
  Mic,
  Loader2,
} from 'lucide-react';
import { Trip } from '../types';
import {
  subscribeGuardianTrip,
  subscribeGuardianUser,
  computeLastSeenSafe,
  getGuardianUrl,
} from '../services/guardianService';
import { AudioEvidencePlayer } from '../components/AudioEvidencePlayer';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDuration } from '../utils/formatters';

interface GuardianViewProps {
  tripId?: string | null;
  userId?: string | null;
  onNavigateHome?: () => void;
}

export const GuardianView: React.FC<GuardianViewProps> = ({
  tripId,
  userId,
  onNavigateHome,
}) => {
  const { t } = useLanguage();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [copiedLink, setCopiedLink] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [nowTime, setNowTime] = useState<Date>(new Date());

  // Keep live time ticking every 5 seconds for accurate "mins ago"
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to live trip data
  useEffect(() => {
    setLoading(true);

    let unsubscribe: () => void = () => {};

    if (tripId) {
      unsubscribe = subscribeGuardianTrip(tripId, (data, syncTime) => {
        setTrip(data);
        setLastSyncTime(syncTime);
        setLoading(false);
      });
    } else if (userId) {
      unsubscribe = subscribeGuardianUser(userId, (data, syncTime) => {
        setTrip(data);
        setLastSyncTime(syncTime);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => {
      unsubscribe();
    };
  }, [tripId, userId]);

  const handleManualRefresh = () => {
    setManualRefreshing(true);
    if (tripId) {
      subscribeGuardianTrip(tripId, (data, syncTime) => {
        setTrip(data);
        setLastSyncTime(syncTime);
        setTimeout(() => setManualRefreshing(false), 600);
      });
    } else if (userId) {
      subscribeGuardianUser(userId, (data, syncTime) => {
        setTrip(data);
        setLastSyncTime(syncTime);
        setTimeout(() => setManualRefreshing(false), 600);
      });
    }
  };

  const handleCopyLink = async () => {
    if (!trip) return;
    try {
      await navigator.clipboard.writeText(getGuardianUrl(trip.id));
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (e) {}
  };

  const handleShare = async () => {
    if (!trip) return;
    const url = getGuardianUrl(trip.id);
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SafeCheck Live Status: ${trip.userName || 'SafeCheck User'}`,
          text: `Current safety status & live location for ${trip.userName || 'SafeCheck User'}:`,
          url,
        });
      } catch (e) {}
    } else {
      handleCopyLink();
    }
  };

  const lastSeen = computeLastSeenSafe(trip);

  const isAlerted = trip?.status === 'alerted';
  const isSosAlert = isAlerted || Boolean(trip?.isSosEvent);
  const isReminded = trip?.status === 'reminded';
  const isSafe = trip?.status === 'safe';
  const isActive = trip?.status === 'active';
  const isCancelled = trip?.status === 'cancelled';

  const startTimeStr = trip
    ? new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const startDateStr = trip
    ? new Date(trip.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : '';

  const expectedArrivalStr = trip
    ? new Date(
        new Date(trip.startTime).getTime() + trip.durationMinutes * 60 * 1000
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const resolvedLat = typeof trip?.latitude === 'number'
    ? trip.latitude
    : (typeof trip?.sosLocation?.lat === 'number'
        ? trip.sosLocation.lat
        : (typeof (trip?.sosLocation as any)?.latitude === 'number' ? (trip?.sosLocation as any).latitude : null));
  const resolvedLng = typeof trip?.longitude === 'number'
    ? trip.longitude
    : (typeof trip?.sosLocation?.lng === 'number'
        ? trip.sosLocation.lng
        : (typeof (trip?.sosLocation as any)?.longitude === 'number' ? (trip?.sosLocation as any).longitude : null));

  const mapsUrl = trip?.locationUrl
    ? trip.locationUrl
    : (resolvedLat !== null && resolvedLng !== null)
    ? `https://www.google.com/maps?q=${resolvedLat},${resolvedLng}`
    : null;

  return (
    <div className="min-h-screen bg-[#FAF6F3] text-[#3A3A3A] font-sans pb-16">
      {/* Top Mobile-Optimized Status Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#EFE8E1] px-4 py-3 sm:px-6 shadow-2xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C88EA7] flex items-center justify-center text-white shadow-2xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold text-sm text-[#3A3A3A]">SafeCheck</span>
                <span className="text-[10px] font-black uppercase tracking-wider bg-[#F9EDF3] text-[#9E4D71] px-2 py-0.5 rounded-full border border-[#F0D0DF]">
                  Guardian View
                </span>
              </div>
              <p className="text-[10px] text-[#7D757A]">
                Live Public Status • No login required
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="guardian-manual-refresh-btn"
              type="button"
              onClick={handleManualRefresh}
              className="p-2 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#7D757A] hover:text-[#3A3A3A] border border-[#EFE8E1] transition-all cursor-pointer flex items-center space-x-1 text-xs"
              title="Sync latest live status"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline text-[11px] font-bold">Sync Now</span>
            </button>

            {onNavigateHome && (
              <button
                id="guardian-back-home-btn"
                type="button"
                onClick={onNavigateHome}
                className="px-3 py-1.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-2xs cursor-pointer transition-colors"
              >
                SafeCheck App
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Loading State */}
        {loading && (
          <div className="bg-white border border-[#EFE8E1] rounded-3xl p-12 text-center space-y-4 shadow-sm">
            <div className="w-10 h-10 border-3 border-[#C88EA7] border-t-transparent rounded-full animate-spin mx-auto" />
            <h2 className="text-base font-bold text-[#3A3A3A]">Connecting to Live Guardian Network...</h2>
            <p className="text-xs text-[#6B6368]">Fetching latest verified traveler status and GPS coordinates</p>
          </div>
        )}

        {/* Not Found State */}
        {!loading && !trip && (
          <div className="bg-white border border-[#EFE8E1] rounded-3xl p-10 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 bg-[#F9EDF3] text-[#9E4D71] rounded-2xl flex items-center justify-center mx-auto border border-[#F0D0DF]">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-[#3A3A3A]">Trip Record Not Found</h2>
            <p className="text-xs text-[#6B6368] max-w-md mx-auto">
              This guardian link may have expired or the traveler has not initiated a check-in trip yet.
            </p>
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="px-6 py-2.5 rounded-xl bg-[#B36D8B] text-white font-bold text-xs shadow-xs cursor-pointer"
              >
                Open SafeCheck
              </button>
            )}
          </div>
        )}

        {/* Live Trip Loaded */}
        {!loading && trip && (
          <>
            {/* Live Sync Banner Strip */}
            <div className="flex items-center justify-between bg-white border border-[#EFE8E1] px-4 py-2 rounded-2xl text-[11px] font-medium text-[#7D757A] shadow-2xs">
              <div className="flex items-center space-x-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span>Near-real-time streaming active (syncs every 15s)</span>
              </div>
              <span>Updated {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>

            {/* STATUS HERO BANNER */}
            <div
              className={`rounded-3xl p-6 sm:p-8 shadow-md border-2 transition-all relative overflow-hidden ${
                isAlerted
                  ? 'bg-rose-700 text-white border-rose-400 animate-pulse'
                  : isReminded
                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                  : isSafe
                  ? 'bg-emerald-600 text-white border-emerald-400'
                  : 'bg-white text-[#3A3A3A] border-[#C88EA7]'
              }`}
            >
              {/* Status Header & Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 pb-4">
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                      isAlerted
                        ? 'bg-rose-900 text-white animate-bounce'
                        : isReminded
                        ? 'bg-amber-700 text-white'
                        : isSafe
                        ? 'bg-emerald-800 text-white'
                        : 'bg-[#F9EDF3] text-[#9E4D71]'
                    }`}
                  >
                    {isAlerted ? (
                      <Siren className="w-7 h-7" />
                    ) : isReminded ? (
                      <AlertTriangle className="w-7 h-7" />
                    ) : isSafe ? (
                      <CheckCircle2 className="w-7 h-7" />
                    ) : (
                      <Activity className="w-7 h-7" />
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider opacity-80">
                      Current Traveler Status
                    </span>
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight">
                      {isAlerted
                        ? '🚨 SOS EMERGENCY ALERT ACTIVE'
                        : isReminded
                        ? '⚠️ Check-In Grace Period Active'
                        : isSafe
                        ? '✅ Confirmed Arrived Safely'
                        : isCancelled
                        ? 'Trip Concluded'
                        : '🛡️ Trip In Progress'}
                    </h1>
                  </div>
                </div>

                {/* "Last Seen Safe" Metric Box */}
                <div
                  className={`p-3 rounded-2xl shrink-0 text-left sm:text-right ${
                    isAlerted
                      ? 'bg-rose-900/80 border border-rose-400'
                      : isReminded
                      ? 'bg-amber-600/40 border border-amber-700/30'
                      : isSafe
                      ? 'bg-emerald-800/80 border border-emerald-400'
                      : 'bg-[#FAF6F3] border border-[#EFE8E1]'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                    {lastSeen.label}
                  </div>
                  <div className="text-sm font-black font-mono mt-0.5">
                    {lastSeen.timeAgoText}
                  </div>
                  {lastSeen.formattedTime && (
                    <div className="text-[10px] opacity-75">at {lastSeen.formattedTime}</div>
                  )}
                </div>
              </div>

              {/* Status Explanation */}
              <div className="pt-4 space-y-2">
                <p className="text-xs sm:text-sm font-medium leading-relaxed opacity-95">
                  {isAlerted &&
                    `CRITICAL: ${trip.userName || 'The traveler'} triggered an urgent emergency alert. Immediate assistance is requested.`}
                  {isReminded &&
                    `${trip.userName || 'The traveler'} reached their estimated arrival time and is currently in the ${trip.graceMinutes}-minute soft check-in grace period.`}
                  {isSafe &&
                    `${trip.userName || 'The traveler'} has confirmed safe arrival. All trip timers are safely completed.`}
                  {isActive &&
                    `${trip.userName || 'The traveler'} is actively en route to "${trip.destination}". Soft check-in reminder scheduled upon arrival.`}
                  {isCancelled &&
                    `The traveler concluded this check-in session.`}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span>Traveler:</span>
                    <span className="font-semibold underline decoration-dotted">{trip.userName || 'SafeCheck User'}</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span>Destination:</span>
                    <span className="font-semibold">{trip.destination}</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span>Started:</span>
                    <span className="font-semibold">{startDateStr} {startTimeStr}</span>
                  </div>
                  {isActive && (
                    <>
                      <span>•</span>
                      <div className="flex items-center space-x-1.5 font-bold">
                        <span>Expected ETA:</span>
                        <span className="font-semibold font-mono">~{expectedArrivalStr} ({formatDuration(trip.durationMinutes)})</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* LOCATION CARD WITH MAPS EMBED & PLAIN LINK */}
            <div className="bg-white rounded-3xl border border-[#EFE8E1] p-6 sm:p-7 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-[#EFE8E1] pb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-[#F9EDF3] text-[#9E4D71] flex items-center justify-center">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="font-extrabold text-base text-[#3A3A3A]">
                      Current / Last Known Location
                    </h2>
                    <p className="text-xs text-[#6B6368]">
                      {resolvedLat !== null && resolvedLng !== null
                        ? `GPS Coordinates: ${resolvedLat.toFixed(5)}, ${resolvedLng.toFixed(5)}`
                        : 'Coordinates recorded at trip check-in'}
                    </p>
                  </div>
                </div>

                {mapsUrl && (
                  <a
                    id="open-in-google-maps-btn"
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-2xs flex items-center space-x-1.5 transition-colors"
                  >
                    <span>Open Google Maps</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Embedded Map Display or Coordinates Box */}
              {resolvedLat !== null && resolvedLng !== null ? (
                <div className="space-y-3">
                  <div className="w-full h-64 sm:h-72 rounded-2xl overflow-hidden border border-[#EFE8E1] bg-[#FAF6F3] relative shadow-inner">
                    <iframe
                      title="Traveler Location Map"
                      src={`https://maps.google.com/maps?q=${resolvedLat},${resolvedLng}&z=15&output=embed`}
                      className="w-full h-full border-0"
                      loading="lazy"
                    />
                  </div>

                  {/* Plain Link & Quick Copy */}
                  <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-3.5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center space-x-2 truncate">
                      <MapPin className="w-4 h-4 text-[#9E4D71] shrink-0" />
                      <span className="font-mono text-[#9E4D71] truncate select-all">
                        {mapsUrl}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          if (mapsUrl) {
                            await navigator.clipboard.writeText(mapsUrl);
                            setCopiedLink(true);
                            setTimeout(() => setCopiedLink(false), 2000);
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white text-[#3A3A3A] hover:bg-[#F3ECE5] font-bold text-xs border border-[#EFE8E1] flex items-center space-x-1 cursor-pointer transition-colors shadow-2xs"
                      >
                        {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedLink ? 'Copied' : 'Copy GPS Link'}</span>
                      </button>

                      <a
                        href={`https://maps.apple.com/?ll=${resolvedLat},${resolvedLng}&q=SafeCheck+Location`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-white text-[#3A3A3A] hover:bg-[#F3ECE5] font-bold text-xs border border-[#EFE8E1] flex items-center space-x-1"
                      >
                        <span>Apple Maps</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#FAF6F3] border border-dashed border-[#EFE8E1] p-6 rounded-2xl text-center space-y-2">
                  <MapPin className="w-6 h-6 text-[#7D757A] mx-auto" />
                  <p className="text-xs font-bold text-[#3A3A3A]">GPS Coordinates Not Attached</p>
                  <p className="text-[11px] text-[#6B6368] max-w-sm mx-auto">
                    The traveler started this trip in privacy-first mode without GPS sharing. Status reminders and timers remain actively tracked.
                  </p>
                </div>
              )}
            </div>

            {/* AUDIO EVIDENCE IF ATTACHED TO SOS */}
            {trip.audioEvidence ? (
              <AudioEvidencePlayer
                evidence={trip.audioEvidence}
                title="🚨 Emergency Audio Recording Attached"
              />
            ) : isSosAlert ? (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 shadow-xs flex items-center space-x-3.5 text-amber-900">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0 text-amber-700 animate-pulse">
                  <Mic className="w-5 h-5" />
                </div>
                <div className="space-y-0.5">
                  <h3 className="font-bold text-xs flex items-center space-x-1.5">
                    <span>SOS Audio Evidence Recording in Progress</span>
                    <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                  </h3>
                  <p className="text-[11px] text-amber-700">
                    The traveler's device is capturing 30-second forensic audio evidence. This player will automatically appear once the audio is synced.
                  </p>
                </div>
              </div>
            ) : null}

            {/* ACTION & RESCUE HUB */}
            <div className="bg-white rounded-3xl border border-[#EFE8E1] p-6 sm:p-7 shadow-xs space-y-5">
              <h2 className="font-extrabold text-base text-[#3A3A3A] flex items-center space-x-2">
                <PhoneCall className="w-4 h-4 text-[#9E4D71]" />
                <span>Guardian Emergency Action Center</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Call Traveler if phone exists */}
                {trip.userEmail && (
                  <a
                    id="guardian-contact-traveler-btn"
                    href={`mailto:${trip.userEmail}`}
                    className="p-3.5 rounded-2xl bg-[#FAF6F3] hover:bg-[#F3ECE5] border border-[#EFE8E1] font-bold text-xs flex flex-col items-center justify-center space-y-1 text-center transition-all cursor-pointer shadow-2xs"
                  >
                    <span className="text-xs text-[#9E4D71]">Email Traveler</span>
                    <span className="text-[11px] text-[#6B6368] font-mono truncate max-w-full">{trip.userEmail}</span>
                  </a>
                )}

                {/* Emergency Services */}
                <a
                  id="guardian-call-helpline-btn"
                  href="tel:1091"
                  className="p-3.5 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-900 font-bold text-xs flex flex-col items-center justify-center space-y-1 text-center transition-all cursor-pointer shadow-2xs"
                >
                  <span className="font-black">Women's Safety (1091)</span>
                  <span className="text-[11px] text-rose-700">Toll-Free Emergency Line</span>
                </a>

                {/* General Police / Emergency */}
                <a
                  id="guardian-call-police-btn"
                  href="tel:112"
                  className="p-3.5 rounded-2xl bg-[#3A3A3A] hover:bg-black text-white font-bold text-xs flex flex-col items-center justify-center space-y-1 text-center transition-all cursor-pointer shadow-2xs"
                >
                  <span className="font-black">Call Police (112)</span>
                  <span className="text-[11px] text-slate-300">National Emergency Number</span>
                </a>
              </div>

              {/* Share Guardian Link with other family */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#EFE8E1] text-xs">
                <div className="space-y-0.5 text-center sm:text-left">
                  <p className="font-bold text-[#3A3A3A]">Share this Guardian Dashboard</p>
                  <p className="text-[11px] text-[#6B6368]">
                    Send this link to other family members, security, or responders
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    id="guardian-share-page-btn"
                    type="button"
                    onClick={handleShare}
                    className="px-4 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs flex items-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share Link</span>
                  </button>

                  <button
                    id="guardian-copy-page-link-btn"
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] flex items-center space-x-1.5 transition-colors cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Privacy & Trust Badge */}
            <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl flex items-center space-x-3 text-xs text-[#6B6368]">
              <div className="w-8 h-8 rounded-xl bg-white border border-[#EFE8E1] flex items-center justify-center shrink-0 text-[#9E4D71]">
                <Lock className="w-4 h-4" />
              </div>
              <p className="leading-relaxed">
                SafeCheck is encrypted and private by design. Real-time updates stop immediately once the user taps "I'm Safe".
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
