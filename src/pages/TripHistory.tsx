import React, { useState } from 'react';
import { Clock, CheckCircle2, AlertTriangle, ArrowLeft, MapPin, ExternalLink, Siren, Search, Users } from 'lucide-react';
import { Trip } from '../types';
import { AudioEvidencePlayer } from '../components/AudioEvidencePlayer';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDuration } from '../utils/formatters';

interface TripHistoryProps {
  trips: Trip[];
  onNavigate: (page: string) => void;
}

export const TripHistory: React.FC<TripHistoryProps> = ({ trips, onNavigate }) => {
  const { t, language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'safe' | 'alerted' | 'sos' | 'cancelled'>('all');
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Filtered trips
  const filteredTrips = trips.filter((trip) => {
    // Search match
    const dest = (trip.destination || '').toLowerCase();
    const sTerm = (searchTerm || '').toLowerCase();
    const dateStr = trip.startTime ? new Date(trip.startTime).toLocaleDateString().toLowerCase() : '';
    const matchesSearch = dest.includes(sTerm) || dateStr.includes(sTerm);

    if (!matchesSearch) return false;

    // Status match
    if (statusFilter === 'safe') return trip.status === 'safe';
    if (statusFilter === 'alerted') return trip.status === 'alerted';
    if (statusFilter === 'sos') return trip.isSosEvent || (trip.destination || '').includes('SOS');
    if (statusFilter === 'cancelled') return trip.status === 'cancelled';
    return true;
  });

  // Calculate statistics
  const totalTrips = trips.length;
  const safeTrips = trips.filter((t) => t.status === 'safe').length;
  const alertedTrips = trips.filter((t) => t.status === 'alerted').length;
  const sosEvents = trips.filter((t) => t.isSosEvent || (t.destination || '').includes('SOS')).length;

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(id);
    setTimeout(() => setCopiedLink(null), 3000);
  };

  const getStatusBadge = (status: Trip['status'], isSos?: boolean) => {
    if (isSos) {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-600 text-white shadow-xs animate-pulse flex items-center space-x-1">
          <Siren className="w-3 h-3" />
          <span>{t('statusSos')}</span>
        </span>
      );
    }
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
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <Clock className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('historyBadge')}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#3A3A3A]">{t('historyPageTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#6B6368]">
            {t('historyPageSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            id="history-back-dashboard-btn"
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#F9EDF3] hover:bg-[#F3DEE8] text-[#9E4D71] border border-[#F0D0DF] font-bold text-xs transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('navDashboard')}</span>
          </button>
        </div>
      </div>

      {/* Summary Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EFE8E1] rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="text-xs font-semibold text-[#6B6368]">{t('statTotalTrips')}</div>
          <div className="text-2xl font-black text-[#3A3A3A] mt-1">{totalTrips}</div>
        </div>
        <div className="bg-white border border-[#EFE8E1] rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="text-xs font-semibold text-emerald-800">{t('statSafeArrivals')}</div>
          <div className="text-2xl font-black text-emerald-800 mt-1">{safeTrips}</div>
        </div>
        <div className="bg-white border border-[#EFE8E1] rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="text-xs font-semibold text-rose-800">{t('statEscalations')}</div>
          <div className="text-2xl font-black text-rose-800 mt-1">{alertedTrips}</div>
        </div>
        <div className="bg-white border border-[#EFE8E1] rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="text-xs font-semibold text-amber-800">{t('statSosEvents')}</div>
          <div className="text-2xl font-black text-amber-800 mt-1">{sosEvents}</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-[#EFE8E1] p-4 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7D757A] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="search-trip-history-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-xs sm:text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { id: 'all', label: t('filterAll') },
              { id: 'safe', label: t('filterSafe') },
              { id: 'sos', label: t('filterSos') },
              { id: 'alerted', label: t('filterAlerted') },
              { id: 'cancelled', label: t('filterCancelled') },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-[#B36D8B] text-white shadow-xs'
                  : 'bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trips List */}
      <div className="space-y-4">
        {filteredTrips.length === 0 ? (
          <div className="bg-white border border-[#EFE8E1] rounded-3xl p-12 text-center space-y-3 shadow-xs">
            <Clock className="w-12 h-12 text-[#7D757A] mx-auto" />
            <h3 className="font-bold text-[#3A3A3A] text-base">
              {trips.length === 0 ? t('noHistoryFound') : t('noHistoryFound')}
            </h3>
            <p className="text-xs text-[#6B6368] max-w-sm mx-auto">
              {trips.length === 0
                ? t('noHistoryDesc')
                : (language === 'hi' ? 'अपनी खोज क्वेरी या फ़िल्टर समायोजित करने का प्रयास करें।' : language === 'mr' ? 'आपला शोध शब्द किंवा फिल्टर बदलून पहा.' : 'Try adjusting your search query or filter criteria.')}
            </p>
            {trips.length === 0 && (
              <button
                id="empty-history-start-trip-btn"
                type="button"
                onClick={() => onNavigate('start-trip')}
                className="px-5 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer"
              >
                {t('startCheckInBtn')}
              </button>
            )}
          </div>
        ) : (
          filteredTrips.map((trip) => {
            const isExpanded = expandedTripId === trip.id;
            const isSos = Boolean(trip.isSosEvent || trip.destination.includes('SOS'));

            return (
              <div
                key={trip.id}
                className={`bg-white border rounded-3xl p-5 sm:p-6 transition-all shadow-xs space-y-4 ${
                  isSos ? 'border-rose-300 bg-rose-50/20' : 'border-[#EFE8E1] hover:border-[#C88EA7]'
                }`}
              >
                {/* Top Row: Destination + Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold text-base text-[#3A3A3A]">{trip.destination}</h3>
                      {getStatusBadge(trip.status, isSos)}
                    </div>
                    <div className="text-xs text-[#6B6368] flex items-center space-x-3">
                      <span>{t('tripCardStarted')}: {new Date(trip.startTime).toLocaleDateString()} at {new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span>{formatDuration(trip.durationMinutes)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedTripId(isExpanded ? null : trip.id)}
                    className="self-start sm:self-center text-xs font-bold text-[#9E4D71] hover:underline flex items-center space-x-1 cursor-pointer py-1"
                  >
                    <span>{isExpanded ? t('tripCardHideDetails') : t('tripCardDetails')}</span>
                  </button>
                </div>

                {/* Contacts Notified / Outcome Pill */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EFE8E1] text-xs">
                  {trip.status === 'safe' && (
                    <span className="text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl font-bold flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      <span>{language === 'hi' ? `सुरक्षित आगमन: ${trip.safeAt ? new Date(trip.safeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}` : language === 'mr' ? `सुरक्षित पोहोचले: ${trip.safeAt ? new Date(trip.safeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}` : `Arrived safely at ${trip.safeAt ? new Date(trip.safeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'destination'}`}</span>
                    </span>
                  )}

                  {trip.status === 'alerted' && (
                    <span className="text-rose-800 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-xl font-bold flex items-center space-x-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
                      <span>{language === 'hi' ? `आपातकालीन संपर्कों को सतर्क किया (${trip.notifiedCount || 1} अधिसूचित)` : language === 'mr' ? `आपत्कालीन संपर्कांना संदेश पाठवला (${trip.notifiedCount || 1} सूचित)` : `Emergency contacts alerted (${trip.notifiedCount || 1} notified)`}</span>
                    </span>
                  )}

                  {trip.locationUrl && (
                    <a
                      href={trip.locationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#9E4D71] bg-[#F9EDF3] hover:bg-[#F3DEE8] border border-[#F0D0DF] px-2.5 py-1 rounded-xl font-bold flex items-center space-x-1 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{t('tripCardViewMap')}</span>
                      <ExternalLink className="w-3 h-3 ml-0.5" />
                    </a>
                  )}
                </div>

                {/* Expanded Details Panel */}
                {isExpanded && (
                  <div className="pt-4 border-t border-[#EFE8E1] space-y-4 text-xs animate-in fade-in">
                    {/* Attached Audio Evidence if available */}
                    {trip.audioEvidence && (
                      <AudioEvidencePlayer
                        evidence={trip.audioEvidence}
                        title={t('tripCardAudioEvidence')}
                      />
                    )}

                    {/* GPS Coordinates Section */}
                    {trip.locationUrl ? (
                      <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 font-bold text-[#3A3A3A]">
                            <MapPin className="w-4 h-4 text-[#9E4D71]" />
                            <span>{language === 'hi' ? 'शुरुआत में दर्ज किया गया GPS स्थान' : language === 'mr' ? 'सुरुवातीला नोंदवलेले GPS स्थान' : 'GPS Location Recorded at Start'}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCopyLink(trip.locationUrl!, trip.id)}
                            className="text-[#9E4D71] hover:underline font-semibold flex items-center space-x-1 cursor-pointer"
                          >
                            <span>{copiedLink === trip.id ? (language === 'hi' ? 'कॉपी किया गया!' : language === 'mr' ? 'कॉपी केले!' : 'Copied!') : (language === 'hi' ? 'लिंक कॉपी करें' : language === 'mr' ? 'लिंक कॉपी करा' : 'Copy Link')}</span>
                          </button>
                        </div>

                        <div className="font-mono text-[#9E4D71] bg-white p-2 rounded-xl border border-[#EFE8E1] truncate select-all">
                          {trip.locationUrl}
                        </div>

                        {trip.latitude && trip.longitude && (
                          <div className="text-[11px] text-[#6B6368]">
                            Coordinates: <strong>{trip.latitude.toFixed(5)}° N, {trip.longitude.toFixed(5)}° W</strong>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[#7D757A] italic">{language === 'hi' ? 'इस ट्रिप के लिए कोई GPS निर्देशांक दर्ज नहीं किया गया।' : language === 'mr' ? 'या प्रवासासाठी कोणतेही GPS निर्देशांक नोंदवलेले नाहीत.' : 'No GPS coordinates recorded for this trip.'}</div>
                    )}

                    {/* Notified Contacts Breakdown */}
                    {trip.notifiedContacts && trip.notifiedContacts.length > 0 && (
                      <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl space-y-1.5">
                        <div className="font-bold text-rose-800 flex items-center space-x-1.5">
                          <Users className="w-4 h-4" />
                          <span>{language === 'hi' ? 'अधिसूचित आपातकालीन संपर्क:' : language === 'mr' ? 'सूचित केलेले आपत्कालीन संपर्क:' : 'Emergency Contacts Notified:'}</span>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-rose-900">
                          {trip.notifiedContacts.map((contact, idx) => (
                            <li key={idx} className="font-medium">
                              {contact}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Check-In Milestones Timeline */}
                    {trip.checkInEvents && trip.checkInEvents.length > 0 && (
                      <div className="bg-white border border-[#EFE8E1] p-4 rounded-2xl space-y-2">
                        <div className="font-bold text-[#3A3A3A]">{language === 'hi' ? 'चेक-इन गतिविधि समयरेखा' : language === 'mr' ? 'चेक-इन हालचालींची टाइमलाइन' : 'Check-In Activity Timeline'}</div>
                        <div className="space-y-2">
                          {trip.checkInEvents.map((evt, idx) => (
                            <div key={idx} className="flex items-start space-x-2 text-[11px]">
                              <span className="w-2 h-2 rounded-full bg-[#C88EA7] mt-1 shrink-0" />
                              <div className="flex-1">
                                <span className="font-semibold text-[#3A3A3A]">{evt.message}</span>
                                <span className="text-[#7D757A] ml-2 font-mono">
                                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
