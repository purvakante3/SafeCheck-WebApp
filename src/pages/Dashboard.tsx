import React, { useState } from 'react';
import {
  PlusCircle,
  ShieldCheck,
  Users,
  Clock,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Navigation,
  Siren,
  AlertOctagon,
  X,
  Check,
  MapPin,
  Share2,
  PhoneCall,
  ExternalLink,
  Phone,
  Radio,
  QrCode,
  Copy,
  MessageSquare,
  RefreshCw,
  Info,
} from 'lucide-react';
import { UserProfile, EmergencyContact, Trip, AppSettings } from '../types';
import { triggerSOSAlert, SOSEmailDispatchResult } from '../services/sosService';
import { getCurrentLocation, shareLocationUrl } from '../services/locationService';
import { formatDuration } from '../utils/formatters';
import { getGuardianUrl, getGuardianUserUrl } from '../services/guardianService';
import { buildEmergencySmsMessage, triggerNativeSms } from '../services/offlineSyncService';
import { SafetyScoreCard } from '../components/SafetyScoreCard';
import { EmergencyQRCard } from '../components/EmergencyQRCard';
import { EmergencyQRExchangeModal } from '../components/EmergencyQRExchangeModal';
import { useLanguage } from '../i18n/LanguageContext';

interface DashboardProps {
  user: UserProfile;
  contacts: EmergencyContact[];
  activeTrip: Trip | null;
  recentTrips: Trip[];
  settings?: AppSettings;
  onNavigate: (page: string) => void;
  onTriggerFakeCall?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  contacts,
  activeTrip,
  recentTrips,
  settings,
  onNavigate,
  onTriggerFakeCall,
}) => {
  const { t, language } = useLanguage();
  const [sosModalOpen, setSosModalOpen] = useState(false);
  const [sosStatus, setSosStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sosErrorMsg, setSosErrorMsg] = useState<string | null>(null);
  const [retryingEmail, setRetryingEmail] = useState(false);
  const [showEmailDetails, setShowEmailDetails] = useState(false);
  const [sosSuccess, setSosSuccess] = useState<{
    tripId?: string;
    count: number;
    deliveredCount: number;
    failedCount: number;
    attemptedCount: number;
    status: 'delivered' | 'partial' | 'failed' | 'unconfigured' | 'no_contacts' | 'offline';
    errorMessage?: string | null;
    emailResults?: Array<{
      email: string;
      name?: string;
      status: 'delivered' | 'failed';
      messageId?: string;
      response?: string;
      error?: string;
    }>;
    locationUrl?: string | null;
    guardianUrl?: string | null;
  } | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);
  const [qrModalTrip, setQrModalTrip] = useState<Trip | null>(null);

  const openSosModal = () => {
    setSosStatus('idle');
    setSosErrorMsg(null);
    setSosModalOpen(true);
  };
  const quickDialNum = settings?.quickDialNumber || '1091';
  const quickDialLbl = settings?.quickDialLabel || "Women's Safety Helpline (1091)";

  const safeTripsCount = recentTrips.filter((t) => t.status === 'safe').length;
  const alertedTripsCount = recentTrips.filter((t) => t.status === 'alerted').length;

  const handleConfirmSOS = async () => {
    setSosStatus('loading');
    setSosErrorMsg(null);

    let isFinished = false;
    // Safety watchdog: allows up to 30 seconds for complete emergency email dispatch and delivery confirmation
    const safetyTimeout = setTimeout(() => {
      if (!isFinished) {
        console.warn('[SafeCheck SOS] Safety watchdog reached, forcing button resolution');
        setSosStatus('error');
        setSosErrorMsg(
          language === 'hi'
            ? 'प्रक्रिया में अपेक्षा से अधिक समय लगा। कृपया पुनः प्रयास करें।'
            : language === 'mr'
            ? 'प्रक्रियेस अपेक्षेपेक्षा जास्त वेळ लागला. कृपया पुन्हा प्रयत्न करा.'
            : 'Dispatch took longer than expected. Tap Retry below to dispatch immediately.'
        );
      }
    }, 30000);

    let lat: number | null = null;
    let lng: number | null = null;
    let locUrl: string | null = null;

    try {
      // 1. Fetch location with strict 3.5s timeout (never blocks emergency alert)
      try {
        const locRes = await Promise.race([
          getCurrentLocation(),
          new Promise<any>((_, reject) => setTimeout(() => reject('location timeout'), 3500)),
        ]);
        if (locRes && locRes.success && locRes.latitude && locRes.longitude) {
          lat = locRes.latitude;
          lng = locRes.longitude;
          locUrl = locRes.locationUrl;
        }
      } catch (locErr) {
        console.warn('[SafeCheck SOS] Location retrieval skipped/timed out:', locErr);
      }

      // 2. Dispatch SOS alert with generous 25s timeout so SMTP email delivery confirmation finishes cleanly
      const res = await Promise.race([
        triggerSOSAlert(user.uid, user.name, user.email, lat, lng, locUrl, null, {
          type: 'manual',
          contacts,
        }),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Dispatch timeout')), 25000)),
      ]);

      const generatedTripId = res.sosId || res.tripId || `sos-${Date.now()}`;
      const guardianLink = getGuardianUrl(generatedTripId);

      isFinished = true;
      clearTimeout(safetyTimeout);

      // Verify whether emails were actually confirmed delivered
      const isConfirmedDelivered = res.deliveredCount > 0;
      const hasNoContacts = contacts.length === 0;

      if (isConfirmedDelivered) {
        setSosStatus('success');
      } else if (hasNoContacts) {
        setSosStatus('idle');
      } else {
        // Did not deliver to contacts - treat as alert logged but email delivery failure
        setSosStatus('error');
        console.warn('[SafeCheck SOS UI] Emergency alert recorded, but 0 emails delivered via SMTP:', res.emailDispatch);
      }

      // Display banner with exact delivery status
      setTimeout(() => {
        setSosSuccess({
          tripId: generatedTripId,
          count: res.notifiedCount,
          deliveredCount: res.deliveredCount,
          failedCount: res.failedCount,
          attemptedCount: res.attemptedCount,
          status: res.emailDispatch.status,
          errorMessage: res.emailDispatch.error,
          emailResults: res.emailDispatch.results,
          locationUrl: res.locationUrl || locUrl,
          guardianUrl: guardianLink,
        });
        setSosModalOpen(false);
        setSosStatus('idle');
      }, isConfirmedDelivered ? 700 : 400);
    } catch (err: any) {
      console.error('Error triggering SOS:', err);
      isFinished = true;
      clearTimeout(safetyTimeout);
      setSosStatus('error');
      setSosErrorMsg(
        err?.message ||
          (language === 'hi'
            ? 'अलर्ट भेजने में समस्या आई। पुनः प्रयास करने के लिए नीचे टैप करें।'
            : language === 'mr'
            ? 'अलर्ट पाठवण्यात अडचण आली. पुन्हा प्रयत्न करण्यासाठी खाली टॅप करा.'
            : 'Emergency dispatch encountered an issue. Tap below to retry immediately.')
      );
    }
  };

  const handleRetryEmailDispatch = async () => {
    if (!sosSuccess) return;
    setRetryingEmail(true);
    try {
      console.log('[SafeCheck SOS] Manually retrying emergency email dispatch via /api/sos/trigger...');
      const payload = {
        sosId: sosSuccess.tripId,
        userId: user.uid,
        userName: user.name,
        userEmail: user.email,
        locationUrl: sosSuccess.locationUrl,
        type: 'manual',
        contacts,
      };
      const response = await fetch('/api/sos/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      console.log('[SafeCheck SOS Retry] API response:', data);
      if (data.emailDispatch) {
        setSosSuccess((prev) => prev ? {
          ...prev,
          count: data.emailDispatch.deliveredCount,
          deliveredCount: data.emailDispatch.deliveredCount,
          failedCount: data.emailDispatch.failedCount,
          attemptedCount: data.emailDispatch.attemptedCount,
          status: data.emailDispatch.status,
          errorMessage: data.emailDispatch.error,
          emailResults: data.emailDispatch.results,
        } : null);
      }
    } catch (e: any) {
      console.error('[SafeCheck SOS Retry] Error during manual dispatch retry:', e);
    } finally {
      setRetryingEmail(false);
    }
  };

  const handleTriggerEmergencySmsFallback = () => {
    const primaryContact = contacts.find((c) => c.isPrimary && c.phone) || contacts.find((c) => c.phone);
    const smsText = buildEmergencySmsMessage({
      userName: user.name,
      destination: 'EMERGENCY SOS',
      lat: null,
      lng: null,
      isOverdue: false,
    });
    triggerNativeSms(primaryContact?.phone, smsText);
  };

  const handleShareSosLocation = async (url: string) => {
    const res = await shareLocationUrl(url, 'ONE-TAP SOS EMERGENCY');
    if (res.success) {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 3000);
    }
  };

  const getStatusBadge = (status: Trip['status']) => {
    switch (status) {
      case 'active':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF]">{t('statusActive')}</span>;
      case 'reminded':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 animate-pulse">{t('statusReminded')}</span>;
      case 'safe':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">{t('statusSafe')}</span>;
      case 'alerted':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">{t('statusAlerted')}</span>;
      case 'cancelled':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#FAF6F3] text-[#6B6368] border border-[#EFE8E1]">{t('statusCancelled')}</span>;
    }
  };

  return (
    <div className="space-y-8 relative pb-16">
      {/* SOS Triggered Banner - Verified Delivery or Delivery Warning */}
      {sosSuccess && (
        <div
          id="sos-alert-status-banner"
          className={`text-white p-5 sm:p-6 rounded-3xl shadow-xl space-y-4 border-2 transition-all ${
            sosSuccess.deliveredCount > 0
              ? 'bg-rose-700 border-rose-400'
              : 'bg-[#5C1D24] border-rose-400'
          }`}
        >
          <div className="flex items-start justify-between space-x-3">
            <div className="flex items-start space-x-3">
              {sosSuccess.deliveredCount > 0 ? (
                <Siren className="w-6 h-6 text-white shrink-0 mt-0.5 animate-bounce" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-300 shrink-0 mt-0.5 animate-pulse" />
              )}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-extrabold text-base uppercase tracking-wider">
                    {sosSuccess.deliveredCount > 0
                      ? `🚨 ${t('oneTapSosTitle')}`
                      : '🚨 EMERGENCY ALERT RECORDED — EMAIL DELIVERY FAILED'}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      sosSuccess.deliveredCount > 0
                        ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/40'
                        : 'bg-amber-400/30 text-amber-200 border border-amber-300/40'
                    }`}
                  >
                    {sosSuccess.deliveredCount > 0
                      ? 'Emails Verified Dispatched'
                      : 'Dispatch Failed (Action Required)'}
                  </span>
                </div>

                <p className="text-xs text-rose-100 leading-relaxed">
                  {sosSuccess.deliveredCount > 0 ? (
                    language === 'hi' ? (
                      `आपातकालीन ईमेल तुरंत ${sosSuccess.deliveredCount} संपर्कों को सफलतापूर्वक भेजे गए।`
                    ) : language === 'mr' ? (
                      `तातडीचे ईमेल त्वरित ${sosSuccess.deliveredCount} संपर्कांना यशस्वीरित्या पाठवले गेले.`
                    ) : (
                      `Emergency emails dispatched immediately and confirmed delivered to ${sosSuccess.deliveredCount} trusted contact${
                        sosSuccess.deliveredCount > 1 ? 's' : ''
                      }.${sosSuccess.failedCount > 0 ? ` (${sosSuccess.failedCount} failed to deliver)` : ''}`
                    )
                  ) : sosSuccess.attemptedCount > 0 ? (
                    <span className="text-amber-100 font-medium">
                      {language === 'hi'
                        ? `सावधानी: अलर्ट दर्ज किया गया है लेकिन ईमेल प्रदाता ${sosSuccess.attemptedCount} संपर्कों को संदेश नहीं भेज सका। कृपया तुरंत फोन या एसएमएस द्वारा संपर्क करें।`
                        : language === 'mr'
                        ? `सावधान: अलर्ट नोंदवला गेला आहे परंतु ईमेल प्रदाता ${sosSuccess.attemptedCount} संपर्कांना संदेश पाठवू शकला नाही. कृपया त्वरित फोन किंवा एसएमएसने संपर्क साधा.`
                        : `CRITICAL NOTICE: Emergency incident & live GPS tracking are active, but 0 of ${sosSuccess.attemptedCount} emergency emails could be delivered by the email provider. Contacts HAVE NOT been emailed.`}
                    </span>
                  ) : (
                    language === 'hi'
                      ? 'आपातकालीन अलर्ट सिस्टम में दर्ज किया गया। संपर्कों को ईमेल भेजने के लिए संपर्क जोड़ें।'
                      : language === 'mr'
                      ? 'आपत्कालीन अलर्ट सिस्टिममध्ये नोंदवला गेला. ईमेल पाठवण्यासाठी संपर्क जोडा.'
                      : 'Emergency alert logged in system console. Add saved contacts to enable direct email dispatch.'
                  )}
                </p>

                {/* Specific error details when dispatch failed */}
                {sosSuccess.deliveredCount === 0 && sosSuccess.attemptedCount > 0 && sosSuccess.errorMessage && (
                  <div className="mt-2 bg-black/40 border border-rose-400/40 rounded-xl px-3 py-2 text-[11px] font-mono text-rose-200 flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-200">Provider Failure Reason: </span>
                      <span>{sosSuccess.errorMessage}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              id="dismiss-sos-banner-btn"
              onClick={() => setSosSuccess(null)}
              className="p-1 rounded-lg hover:bg-rose-800 text-rose-200 hover:text-white transition-colors cursor-pointer"
              title="Dismiss banner"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Fallback actions if email failed */}
          {sosSuccess.deliveredCount === 0 && sosSuccess.attemptedCount > 0 && (
            <div className="bg-black/30 border border-amber-400/50 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5">
              <div className="text-xs text-amber-100 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                <span>Notify your contacts immediately via alternate channels:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  id="sos-retry-email-btn"
                  onClick={handleRetryEmailDispatch}
                  disabled={retryingEmail}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${retryingEmail ? 'animate-spin' : ''}`} />
                  <span>{retryingEmail ? 'Retrying Dispatch...' : 'Retry Email Dispatch'}</span>
                </button>

                <button
                  type="button"
                  id="sos-sms-fallback-btn"
                  onClick={handleTriggerEmergencySmsFallback}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-900 font-black text-xs shadow-xs flex items-center space-x-1.5 cursor-pointer transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-rose-700" />
                  <span>Send Emergency SMS</span>
                </button>
              </div>
            </div>
          )}

          {/* Delivery Details Toggle if results exist */}
          {sosSuccess.emailResults && sosSuccess.emailResults.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                id="toggle-sos-delivery-details-btn"
                onClick={() => setShowEmailDetails(!showEmailDetails)}
                className="text-[11px] font-bold text-rose-200 hover:text-white underline cursor-pointer flex items-center gap-1"
              >
                <span>{showEmailDetails ? 'Hide Provider Verification Details' : 'View Provider Verification Details (Message IDs / Status)'}</span>
              </button>

              {showEmailDetails && (
                <div className="mt-2 bg-black/40 border border-rose-400/30 rounded-xl p-3 space-y-1.5 text-[11px] font-mono">
                  {sosSuccess.emailResults.map((r, idx) => (
                    <div key={idx} className="flex flex-wrap items-center justify-between gap-1 border-b border-white/10 pb-1 last:border-0 last:pb-0">
                      <div>
                        <span className="font-bold text-white">{r.name ? `${r.name} ` : ''}</span>
                        <span className="text-rose-200">({r.email}):</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            r.status === 'delivered' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                          }`}
                        >
                          {r.status.toUpperCase()}
                        </span>
                        {r.messageId && (
                          <span className="text-emerald-300 text-[10px]" title="SMTP Message ID">
                            ID: {r.messageId.substring(0, 24)}...
                          </span>
                        )}
                        {r.error && (
                          <span className="text-rose-300 text-[10px]">
                            {r.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Location & Guardian links in SOS banner */}
          <div className="bg-black/30 border border-rose-400/40 rounded-2xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2 truncate">
              <MapPin className="w-4 h-4 text-rose-200 shrink-0" />
              <span className="font-mono text-rose-100 truncate select-all">
                {sosSuccess.locationUrl || (language === 'hi' ? 'जीपीएस स्थान सक्रिय' : language === 'mr' ? 'GPS स्थान सक्रिय' : 'GPS Coordinates Active')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                id="dash-sos-open-qr-btn"
                type="button"
                onClick={() => {
                  const fallbackTrip: Trip = {
                    id: sosSuccess.tripId || `sos-${Date.now()}`,
                    userId: user.uid,
                    userName: user.name,
                    destination: 'EMERGENCY SOS',
                    durationMinutes: 0,
                    graceMinutes: 0,
                    startTime: new Date().toISOString(),
                    status: 'alerted',
                    reminderSentAt: null,
                    locationUrl: sosSuccess.locationUrl || null,
                  };
                  setQrModalTrip(fallbackTrip);
                }}
                className="px-3 py-1.5 rounded-xl bg-white text-rose-800 hover:bg-rose-50 font-black text-xs shadow-xs flex items-center space-x-1 cursor-pointer transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{language === 'hi' ? 'आपातकालीन क्यूआर' : language === 'mr' ? 'आपत्कालीन क्यूआर' : 'Show Emergency QR'}</span>
              </button>

              {sosSuccess.locationUrl && (
                <>
                  <button
                    id="share-sos-location-btn"
                    type="button"
                    onClick={() => handleShareSosLocation(sosSuccess.locationUrl!)}
                    className="px-3 py-1.5 rounded-xl bg-rose-900/90 text-white hover:bg-rose-950 font-bold text-xs shadow-xs flex items-center space-x-1 cursor-pointer transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{copiedShare ? t('copied') : t('shareLocationBtn')}</span>
                  </button>
                  <a
                    href={sosSuccess.locationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-black text-white font-semibold text-xs flex items-center space-x-1"
                  >
                    <span>{language === 'hi' ? 'नक्शा' : language === 'mr' ? 'नकाशा' : 'Maps'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid Layout: Main Banner & Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Welcome Card */}
        <div className="lg:col-span-2 bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl flex flex-col justify-between shadow-xs">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-[#9E4D71]" />
              <span>{t('protectedBadge')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3A3A3A]">
              {t('welcomeBack')}, {user.name}
            </h1>
            <p className="text-xs sm:text-sm text-[#6B6368] leading-relaxed">
              {contacts.length === 0
                ? t('addContactWarning')
                : t('contactsReadyMsg', { count: contacts.length, plural: contacts.length > 1 ? 's' : '' })}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              id="dash-start-trip-btn"
              onClick={() => onNavigate('start-trip')}
              className="flex items-center justify-center space-x-2 px-6 py-3 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-xs transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t('navStartTrip')}</span>
            </button>

            <button
              id="dash-contacts-btn"
              onClick={() => onNavigate('contacts')}
              className="flex items-center justify-center space-x-2 px-4 py-3 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1] font-semibold text-sm transition-all cursor-pointer"
            >
              <Users className="w-4 h-4 text-[#9E4D71]" />
              <span>{t('navContacts')} ({contacts.length})</span>
            </button>

            <a
              id="dash-helpline-quick-dial-btn"
              href={`tel:${quickDialNum}`}
              className="flex items-center justify-center space-x-1.5 px-4 py-3 rounded-xl bg-[#F9EDF3] hover:bg-[#F3DEE8] text-[#9E4D71] border border-[#F0D0DF] font-bold text-sm transition-all cursor-pointer shadow-xs"
            >
              <Phone className="w-4 h-4 text-[#9E4D71]" />
              <span>{t('callHelpline')} ({quickDialNum})</span>
            </a>

            <button
              id="dash-all-helplines-btn"
              type="button"
              onClick={() => onNavigate('helplines')}
              className="flex items-center justify-center space-x-1.5 px-4 py-3 rounded-xl bg-white hover:bg-[#FAF6F3] text-[#3A3A3A] border border-[#EFE8E1] font-semibold text-sm transition-all cursor-pointer shadow-xs"
            >
              <PhoneCall className="w-4 h-4 text-[#9E4D71]" />
              <span>{t('navHelplines')}</span>
            </button>

            {onTriggerFakeCall && (
              <button
                id="dash-fake-call-btn"
                type="button"
                onClick={onTriggerFakeCall}
                className="flex items-center justify-center space-x-1.5 px-4 py-3 rounded-xl bg-[#3A3A3A] hover:bg-[#2A2A2A] text-white font-semibold text-sm transition-all cursor-pointer shadow-xs"
              >
                <PhoneCall className="w-4 h-4 text-emerald-400" />
                <span>{t('fakeCall')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Emergency SOS High-Contrast Action Box */}
        <div className="bg-[#3A3A3A] p-6 sm:p-8 rounded-3xl text-white shadow-xl flex flex-col justify-between space-y-6 relative overflow-hidden border border-[#4A4548]">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-rose-300 text-xs font-black uppercase tracking-wider">
              <Siren className="w-4 h-4 text-rose-400 animate-pulse" />
              <span>{language === 'hi' ? 'त्वरित सुरक्षा कार्रवाई' : language === 'mr' ? 'त्वरित सुरक्षा कृती' : 'Instant Safety Action'}</span>
            </div>
            <h3 className="font-extrabold text-xl text-white tracking-tight">{t('oneTapSosTitle')}</h3>
            <p className="text-xs text-[#E2DCD5] leading-relaxed">
              {t('oneTapSosDesc')}
            </p>
          </div>

          <div className="space-y-2">
            <button
              id="dash-sos-trigger-btn"
              type="button"
              onClick={openSosModal}
              className="w-full bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-black py-4 px-5 rounded-2xl shadow-lg shadow-rose-600/30 transition-all text-sm uppercase tracking-wider flex items-center justify-center space-x-2 active:scale-[0.98] cursor-pointer"
            >
              <Siren className="w-5 h-5 text-white" />
              <span>{t('triggerImmediateSosBtn')}</span>
            </button>

            <div className="flex items-center justify-center space-x-1.5 text-[11px] text-[#C4BCB6]">
              <Radio className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>{t('hardwareTip', { count: settings?.hardwarePressCount || 4 })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Setup Completeness Score Indicator */}
      <SafetyScoreCard
        contacts={contacts}
        settings={settings}
        onNavigate={onNavigate}
      />

      {/* Warning Alert if Contacts === 0 */}
      {contacts.length === 0 && (
        <div className="bg-[#FFFDFB] border border-amber-300 p-5 rounded-2xl flex items-start space-x-3 text-amber-900 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="font-bold text-sm text-amber-900">{t('noContactsBannerTitle')}</h4>
            <p className="text-xs text-amber-800 leading-relaxed">
              {t('noContactsBannerDesc')}
            </p>
            <button
              id="dash-add-contact-warning-btn"
              onClick={() => onNavigate('contacts')}
              className="mt-2 inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-xs shadow-xs cursor-pointer hover:bg-amber-50"
            >
              <span>{t('addContactNow')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Active Trip Card Banner if Active */}
      {activeTrip && (
        <div className="bg-white rounded-3xl border-2 border-[#C88EA7] shadow-lg p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-2 flex-1">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C88EA7] animate-ping" />
              <h2 className="text-xs font-bold text-[#9E4D71] uppercase tracking-widest">{t('activeTripProgress')}</h2>
              {getStatusBadge(activeTrip.status)}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#3A3A3A]">{activeTrip.destination}</h1>
            <p className="text-xs text-[#6B6368]">
              {t('tripStartedAt', {
                time: new Date(activeTrip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })}{' '}
              • {formatDuration(activeTrip.durationMinutes)} (+{activeTrip.graceMinutes || 10}m grace)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              id="dash-trip-qr-handoff-btn"
              type="button"
              onClick={() => setQrModalTrip(activeTrip)}
              className="px-4 py-3.5 rounded-2xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-sm border border-[#EFE8E1] flex items-center space-x-1.5 cursor-pointer transition-all shadow-2xs"
            >
              <QrCode className="w-4 h-4 text-[#9E4D71]" />
              <span>{language === 'hi' ? 'गार्डियन क्यूआर' : language === 'mr' ? 'गार्डियन क्यूआर' : 'Guardian QR'}</span>
            </button>

            <button
              id="dash-open-active-trip-btn"
              onClick={() => onNavigate('active-trip')}
              className="w-full sm:w-auto bg-[#B36D8B] hover:bg-[#9E5875] text-white text-sm sm:text-base font-bold py-3.5 px-6 rounded-2xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center space-x-2 cursor-pointer"
            >
              <span>{t('viewTimer')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stats Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EFE8E1] p-5 rounded-2xl space-y-1 shadow-xs">
          <span className="text-xs text-[#6B6368] font-semibold uppercase tracking-wider">{t('totalTrips')}</span>
          <p className="text-2xl font-black text-[#3A3A3A]">{recentTrips.length}</p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-5 rounded-2xl space-y-1 shadow-xs">
          <span className="text-xs text-[#6B6368] font-semibold uppercase tracking-wider">{t('confirmedSafe')}</span>
          <p className="text-2xl font-black text-emerald-700">{safeTripsCount}</p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-5 rounded-2xl space-y-1 shadow-xs">
          <span className="text-xs text-[#6B6368] font-semibold uppercase tracking-wider">{t('alertsTriggered')}</span>
          <p className="text-2xl font-black text-rose-700">{alertedTripsCount}</p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-5 rounded-2xl space-y-1 shadow-xs">
          <span className="text-xs text-[#6B6368] font-semibold uppercase tracking-wider">{t('savedContacts')}</span>
          <p className="text-2xl font-black text-[#9E4D71]">{contacts.length}</p>
        </div>
      </div>

      {/* Recent Trips Card */}
      <div className="bg-white border border-[#EFE8E1] rounded-3xl p-6 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-[#EFE8E1] pb-4">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-[#9E4D71]" />
            <h3 className="font-bold text-[#3A3A3A] text-base">{t('recentActivity')}</h3>
          </div>
          <button
            id="dash-view-all-history-btn"
            onClick={() => onNavigate('history')}
            className="text-xs text-[#9E4D71] hover:underline font-bold flex items-center space-x-1 cursor-pointer"
          >
            <span>{t('viewAll')} ({recentTrips.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTrips.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-3">
            <Navigation className="w-10 h-10 text-[#7D757A] mx-auto" />
            <h4 className="text-sm font-semibold text-[#3A3A3A]">{t('noTripsYet')}</h4>
            <p className="text-xs text-[#6B6368] max-w-xs mx-auto">
              {t('noTripsDesc')}
            </p>
            <button
              id="dash-first-trip-btn"
              onClick={() => onNavigate('start-trip')}
              className="px-4 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer"
            >
              {t('startFirstTrip')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#EFE8E1]">
            {recentTrips.slice(0, 5).map((trip) => (
              <div key={trip.id} className="py-3.5 flex items-center justify-between text-xs sm:text-sm">
                <div className="space-y-0.5">
                  <p className="font-bold text-[#3A3A3A]">{trip.destination}</p>
                  <p className="text-[#6B6368] text-xs">
                    {new Date(trip.startTime).toLocaleDateString()} at{' '}
                    {new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {formatDuration(trip.durationMinutes)}
                  </p>
                </div>
                <div>{getStatusBadge(trip.status)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) for One-Tap SOS */}
      <div className="fixed bottom-6 right-6 z-40 sm:bottom-8 sm:right-8">
        <button
          id="one-tap-sos-fab"
          type="button"
          onClick={openSosModal}
          className="group relative flex items-center space-x-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs sm:text-sm uppercase tracking-wider py-3.5 px-5 rounded-full shadow-2xl border-2 border-white ring-4 ring-rose-500/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span className="relative flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-white" />
          </span>
          <Siren className="w-5 h-5 text-white animate-pulse shrink-0" />
          <span>{t('oneTapSosTitle')}</span>
        </button>
      </div>

      {/* Confirmation Modal for SOS Trigger */}
      {sosModalOpen && (
        <div className="fixed inset-0 bg-[#3A3A3A]/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white border-2 border-rose-500 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6 relative text-[#3A3A3A]">
            <button
              id="close-sos-modal-btn"
              onClick={() => {
                setSosStatus('idle');
                setSosErrorMsg(null);
                setSosModalOpen(false);
              }}
              disabled={sosStatus === 'loading'}
              className="absolute top-5 right-5 p-2 rounded-full hover:bg-[#FAF6F3] text-[#7D757A] hover:text-[#3A3A3A] transition-colors cursor-pointer disabled:opacity-30"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-rose-50 border-4 border-rose-200 flex items-center justify-center">
                <AlertOctagon className="w-9 h-9 text-rose-600 animate-pulse" />
              </div>
              <h2 className="text-2xl font-black text-[#3A3A3A] uppercase tracking-tight">
                {t('oneTapSosTitle')}?
              </h2>
              <p className="text-xs sm:text-sm text-[#6B6368] leading-relaxed">
                {t('oneTapSosDesc')}
              </p>
            </div>

            {/* Contacts summary notice */}
            <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-[#3A3A3A]">
                <span>{language === 'hi' ? 'आपातकालीन संपर्क लक्ष्य' : language === 'mr' ? 'आपत्कालीन संपर्क लक्ष्य' : 'Emergency Contacts Target'}</span>
                <span className="text-rose-700">{contacts.length} {language === 'hi' ? 'संपर्क' : language === 'mr' ? 'संपर्क' : `Contact${contacts.length !== 1 ? 's' : ''}`}</span>
              </div>
              {contacts.length === 0 ? (
                <p className="text-amber-800 font-medium">
                  ⚠️ {language === 'hi' ? 'वर्तमान में 0 संपर्क जोड़े गए हैं। एसओएस रिकॉर्ड में दर्ज होगा लेकिन कोई ईमेल नहीं भेजा जा सकेगा।' : language === 'mr' ? 'सध्या 0 संपर्क जोडलेले आहेत. एसओएस रेकॉर्डमध्ये नोंदवला जाईल पण ईमेल पाठवता येणार नाही.' : 'You currently have 0 contacts configured. The SOS event will be logged in system records, but no emails can be delivered until contacts are added.'}
                </p>
              ) : (
                <ul className="text-[#6B6368] space-y-1 divide-y divide-[#EFE8E1] max-h-28 overflow-y-auto pt-1">
                  {contacts.map((c) => (
                    <li key={c.id} className="pt-1 flex items-center justify-between">
                      <span className="font-semibold text-[#3A3A3A]">{c.name}</span>
                      <span className="text-[11px] text-[#7D757A]">{c.email}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Error Message with Retry option */}
            {sosErrorMsg && (
              <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 text-xs text-rose-900 space-y-2 animate-in fade-in">
                <div className="flex items-start space-x-2.5">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <p className="font-bold text-rose-950">
                      {language === 'hi' ? 'एसओएस भेजने में त्रुटि' : language === 'mr' ? 'एसओएस पाठवण्यात त्रुटी' : 'SOS Dispatch Alert'}
                    </p>
                    <p className="text-rose-800 leading-relaxed">{sosErrorMsg}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="space-y-3">
              <button
                id="confirm-sos-btn"
                type="button"
                onClick={handleConfirmSOS}
                disabled={sosStatus === 'loading'}
                className={`w-full py-4 px-6 rounded-2xl font-extrabold text-sm uppercase tracking-wider shadow-lg transition-all flex items-center justify-center space-x-2 active:scale-[0.98] disabled:opacity-80 cursor-pointer ${
                  sosStatus === 'loading'
                    ? 'bg-rose-600 text-white shadow-rose-600/30'
                    : sosStatus === 'success'
                    ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                    : sosStatus === 'error'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30 ring-2 ring-amber-400'
                    : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-rose-600/30'
                }`}
              >
                {sosStatus === 'loading' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{language === 'hi' ? 'स्थान खोजा जा रहा है और अलर्ट भेजा जा रहा है...' : language === 'mr' ? 'स्थान शोधले जात आहे आणि अलर्ट पाठवला जात आहे...' : 'Locating & Dispatching SOS...'}</span>
                  </>
                ) : sosStatus === 'success' ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-white animate-bounce" />
                    <span>{language === 'hi' ? 'एसओएस सफलतापूर्वक भेजा गया!' : language === 'mr' ? 'एसओएस यशस्वीरित्या पाठवला गेला!' : 'SOS Dispatched Successfully!'}</span>
                  </>
                ) : sosStatus === 'error' ? (
                  <>
                    <AlertTriangle className="w-5 h-5 text-white" />
                    <span>{language === 'hi' ? 'पुनः प्रयास करें (Retry SOS)' : language === 'mr' ? 'पुन्हा प्रयत्न करा (Retry SOS)' : 'Retry Dispatch SOS'}</span>
                  </>
                ) : (
                  <>
                    <Siren className="w-5 h-5 text-white" />
                    <span>{t('triggerImmediateSosBtn')}</span>
                  </>
                )}
              </button>

              <button
                id="cancel-sos-btn"
                type="button"
                onClick={() => {
                  setSosStatus('idle');
                  setSosErrorMsg(null);
                  setSosModalOpen(false);
                }}
                disabled={sosStatus === 'loading'}
                className="w-full py-3 px-4 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] transition-colors cursor-pointer disabled:opacity-50"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency QR Exchange Modal */}
      {qrModalTrip && (
        <EmergencyQRExchangeModal
          isOpen={true}
          trip={qrModalTrip}
          isSosMode={qrModalTrip.status === 'alerted'}
          onClose={() => setQrModalTrip(null)}
        />
      )}
    </div>
  );
};
