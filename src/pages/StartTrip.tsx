import React, { useState, useEffect } from 'react';
import {
  Clock,
  Navigation,
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  MapPin,
  Footprints,
  Car,
  Bus,
  Sparkles,
  RefreshCw,
  LocateFixed,
  ArrowUpDown,
  CheckCircle2,
  WifiOff,
  Zap,
} from 'lucide-react';
import { UserProfile, EmergencyContact, Trip } from '../types';
import { createTrip } from '../services/tripService';
import {
  getCurrentLocation,
  estimateTripTravelTime,
  geocodeAddress,
  LocationResult,
  formatDuration,
} from '../services/locationService';
import { useLanguage } from '../i18n/LanguageContext';
import { LocationSearchInput } from '../components/LocationSearchInput';
import { isDeviceOnline, subscribeOnlineStatus } from '../services/offlineSyncService';

interface StartTripProps {
  user: UserProfile;
  contacts: EmergencyContact[];
  activeTrip: Trip | null;
  onTripCreated: () => void;
  onNavigate: (page: string) => void;
}

export const StartTrip: React.FC<StartTripProps> = ({
  user,
  contacts,
  activeTrip,
  onTripCreated,
  onNavigate,
}) => {
  const { t } = useLanguage();

  // Mode: 'auto' (Maps/distance auto-calculate) vs 'manual' (Set manually)
  const [durationMode, setDurationMode] = useState<'auto' | 'manual'>('auto');
  const [travelMode, setTravelMode] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [isOffline, setIsOffline] = useState<boolean>(!isDeviceOnline());

  useEffect(() => {
    const unsub = subscribeOnlineStatus((online) => {
      setIsOffline(!online);
      if (!online) {
        setDurationMode('manual');
      }
    });
    return unsub;
  }, []);

  // Starting location state
  const [startQuery, setStartQuery] = useState<string>('Acquiring current GPS...');
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  const [isCurrentGpsStart, setIsCurrentGpsStart] = useState<boolean>(true);
  const [currentGpsLocation, setCurrentGpsLocation] = useState<LocationResult | null>(null);
  const [gettingStartLocation, setGettingStartLocation] = useState<boolean>(false);
  const [startLocationError, setStartLocationError] = useState<string | null>(null);

  // Destination state
  const [destination, setDestination] = useState<string>('');
  const [destCoordinates, setDestCoordinates] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);

  // Duration calculations
  const [estimatedDuration, setEstimatedDuration] = useState<{
    minutes: number;
    distanceMeters: number;
    source: string;
  } | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [extraBufferMinutes, setExtraBufferMinutes] = useState<number>(0);

  // Manual duration state (and fallback value)
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [customDuration, setCustomDuration] = useState<string>('');

  // Grace period
  const [graceMinutes, setGraceMinutes] = useState<number>(10);
  const [customGrace, setCustomGrace] = useState<string>('');

  const [includeLocation, setIncludeLocation] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Initial capture of starting GPS on component mount
  const fetchCurrentGPS = async (forceUpdateText = false) => {
    setGettingStartLocation(true);
    setStartLocationError(null);
    if (isCurrentGpsStart || forceUpdateText) {
      setStartQuery('Locating...');
    }
    try {
      const loc = await getCurrentLocation();
      if (loc.success && loc.latitude && loc.longitude) {
        setCurrentGpsLocation(loc);
        const resolvedLabel = loc.address || `Current Location (${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)})`;

        // If user is using GPS start or explicitly asked to reset, update the input
        if (isCurrentGpsStart || forceUpdateText) {
          setStartQuery(resolvedLabel);
          setStartCoords({
            lat: loc.latitude,
            lng: loc.longitude,
            address: loc.address,
          });
          setIsCurrentGpsStart(true);
        }
      } else {
        setStartLocationError(loc.errorMessage || 'Could not acquire GPS position');
        if (isCurrentGpsStart) {
          setStartQuery('');
        }
      }
    } catch (err) {
      setStartLocationError('GPS request failed');
      if (isCurrentGpsStart) {
        setStartQuery('');
      }
    } finally {
      setGettingStartLocation(false);
    }
  };

  useEffect(() => {
    fetchCurrentGPS();
  }, []);

  // Handle reset to current GPS location
  const handleResetToCurrentGPS = () => {
    if (currentGpsLocation && currentGpsLocation.latitude && currentGpsLocation.longitude) {
      const label = currentGpsLocation.address || `Current Location (${currentGpsLocation.latitude.toFixed(4)}, ${currentGpsLocation.longitude.toFixed(4)})`;
      setStartQuery(label);
      setStartCoords({
        lat: currentGpsLocation.latitude,
        lng: currentGpsLocation.longitude,
        address: currentGpsLocation.address,
      });
      setIsCurrentGpsStart(true);
    } else {
      fetchCurrentGPS(true);
    }
  };

  // Handle manual changes to starting location input
  const handleStartQueryChange = (val: string) => {
    setStartQuery(val);
    setIsCurrentGpsStart(false);
    // Invalidate coordinates until user selects a place or geocoding resolves
    setStartCoords(null);
  };

  // Handle selection from autocomplete for Starting Point
  const handleSelectStartPlace = (place: {
    name: string;
    formattedAddress: string;
    lat: number;
    lng: number;
  }) => {
    setStartQuery(place.name);
    setStartCoords({
      lat: place.lat,
      lng: place.lng,
      address: place.formattedAddress,
    });
    setIsCurrentGpsStart(false);
  };

  // Handle changes to destination input
  const handleDestinationChange = (val: string) => {
    setDestination(val);
    // Invalidate cached coordinates when user types
    setDestCoordinates(null);
  };

  // Handle selection from autocomplete for Destination
  const handleSelectDestPlace = (place: {
    name: string;
    formattedAddress: string;
    lat: number;
    lng: number;
  }) => {
    setDestination(place.name);
    setDestCoordinates({
      lat: place.lat,
      lng: place.lng,
      address: place.formattedAddress,
    });
  };

  // Swap starting point and destination (like Google Maps)
  const handleSwapLocations = () => {
    const prevStartText = startQuery;
    const prevStartCoords = startCoords;
    const prevDestText = destination;
    const prevDestCoords = destCoordinates;

    setStartQuery(prevDestText);
    setStartCoords(prevDestCoords);
    setIsCurrentGpsStart(false);

    setDestination(prevStartText);
    setDestCoordinates(prevStartCoords);
  };

  // 2. Travel Time Calculation effect:
  // Runs whenever startCoords, destCoordinates, or travelMode changes
  useEffect(() => {
    if (durationMode !== 'auto') return;

    // Check if start coordinates need geocoding (e.g. user typed a custom start place without picking dropdown)
    if (!startCoords && startQuery.trim() && startQuery.length > 2 && !isCurrentGpsStart) {
      const geoStartTimer = setTimeout(async () => {
        try {
          const res = await geocodeAddress(startQuery);
          if (res) {
            setStartCoords({ lat: res.latitude, lng: res.longitude, address: res.formattedAddress });
          }
        } catch {}
      }, 500);
      return () => clearTimeout(geoStartTimer);
    }

    // Check if destination coordinates need geocoding (e.g. user typed custom destination without picking dropdown)
    if (!destCoordinates && destination.trim() && destination.length > 2) {
      const geoDestTimer = setTimeout(async () => {
        setIsGeocoding(true);
        try {
          const res = await geocodeAddress(destination);
          if (res) {
            setDestCoordinates({ lat: res.latitude, lng: res.longitude, address: res.formattedAddress });
          }
        } catch (e) {
          console.warn('Geocoding notice:', e);
        } finally {
          setIsGeocoding(false);
        }
      }, 500);
      return () => clearTimeout(geoDestTimer);
    }

    // If both coordinates exist, compute routing ETA
    if (startCoords?.lat && startCoords?.lng && destCoordinates?.lat && destCoordinates?.lng) {
      let isSubscribed = true;
      setIsEstimating(true);

      estimateTripTravelTime({
        startLat: startCoords.lat,
        startLng: startCoords.lng,
        destLat: destCoordinates.lat,
        destLng: destCoordinates.lng,
        travelMode,
      })
        .then((eta) => {
          if (!isSubscribed) return;
          setEstimatedDuration({
            minutes: eta.durationMinutes,
            distanceMeters: eta.distanceMeters,
            source: eta.source,
          });
          // Automatically set the trip arrival timer to estimated duration + buffer!
          const computedTotal = Math.max(3, eta.durationMinutes + extraBufferMinutes);
          setDurationMinutes(computedTotal);
        })
        .catch((err) => {
          console.warn('ETA estimation error:', err);
        })
        .finally(() => {
          if (isSubscribed) setIsEstimating(false);
        });

      return () => {
        isSubscribed = false;
      };
    } else {
      setEstimatedDuration(null);
    }
  }, [
    startCoords,
    destCoordinates,
    travelMode,
    durationMode,
    startQuery,
    destination,
    isCurrentGpsStart,
    extraBufferMinutes,
  ]);

  // Handle travel mode change
  const handleTravelModeChange = (newMode: 'walking' | 'driving' | 'transit') => {
    setTravelMode(newMode);
  };

  // Handle quick safety buffer adjustment (+0, +5, +10, +15 mins)
  const handleBufferSelect = (buffer: number) => {
    setExtraBufferMinutes(buffer);
    if (estimatedDuration) {
      setDurationMinutes(Math.max(3, estimatedDuration.minutes + buffer));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!destination.trim()) {
      setError('Please enter your destination address or name.');
      return;
    }

    let finalDuration: number;
    if (durationMode === 'auto') {
      if (estimatedDuration && estimatedDuration.minutes > 0) {
        finalDuration = Math.max(3, estimatedDuration.minutes + extraBufferMinutes);
      } else {
        // Fallback default if destination wasn't resolved yet
        finalDuration = durationMinutes || 15;
      }
    } else {
      finalDuration = durationMinutes === -1 ? parseInt(customDuration, 10) : durationMinutes;
    }

    const finalGrace = graceMinutes === -1 ? parseInt(customGrace, 10) : graceMinutes;

    if (isNaN(finalDuration) || finalDuration <= 0) {
      setError('Please provide a valid trip duration in minutes.');
      return;
    }

    if (isNaN(finalGrace) || finalGrace <= 0) {
      setError('Please provide a valid grace period in minutes.');
      return;
    }

    setLoading(true);

    // Refresh start location if using GPS and not captured yet
    let lat = startCoords?.lat ?? null;
    let lng = startCoords?.lng ?? null;
    let locUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
    let startAddress = startCoords?.address ?? (startQuery.trim() || null);

    if (includeLocation && isCurrentGpsStart && (!lat || !lng)) {
      try {
        const locRes = await getCurrentLocation();
        if (locRes.success && locRes.latitude && locRes.longitude) {
          lat = locRes.latitude;
          lng = locRes.longitude;
          locUrl = locRes.locationUrl;
          startAddress = locRes.address || null;
        }
      } catch (e) {
        console.warn('Location query error:', e);
      }
    }

    try {
      await createTrip({
        userId: user.uid,
        destination: destination.trim(),
        durationMinutes: finalDuration,
        graceMinutes: finalGrace,
        userName: user.name,
        userEmail: user.email,
        latitude: lat,
        longitude: lng,
        locationUrl: locUrl,
        // Detailed Trip Safety Check fields
        startLatitude: lat,
        startLongitude: lng,
        startLocationUrl: locUrl,
        startAddress: startAddress,
        destinationLatitude: destCoordinates?.lat || null,
        destinationLongitude: destCoordinates?.lng || null,
        destinationAddress: destCoordinates?.address || destination.trim(),
        durationMode,
        travelMode,
        estimatedDistanceMeters: estimatedDuration?.distanceMeters || undefined,
      });

      onTripCreated();
      onNavigate('active-trip');
    } catch (err: any) {
      console.error('Error starting trip:', err);
      setError('Failed to start check-in trip. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const calculatedTotalMinutes = estimatedDuration
    ? Math.max(3, estimatedDuration.minutes + extraBufferMinutes)
    : durationMinutes;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl shadow-xs text-[#3A3A3A] space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-[#9E4D71]" />
            <span>Trip Safety Check</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#3A3A3A]">{t('startTripTitle')}</h1>
          <p className="text-xs text-[#6B6368]">
            Search your destination and starting location with free autocomplete (OpenStreetMap Nominatim). Arrival duration calculates automatically using free OpenRouteService directions.
          </p>
        </div>

        {/* Existing Active Trip Alert */}
        {activeTrip && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl space-y-2 text-xs text-amber-900">
            <div className="flex items-center space-x-2 font-bold text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              <span>You already have an active trip to "{activeTrip.destination}"!</span>
            </div>
            <p className="text-amber-800">You can manage or complete your active trip before starting a new one.</p>
            <button
              id="view-active-trip-btn"
              onClick={() => onNavigate('active-trip')}
              className="inline-flex items-center space-x-1 font-bold text-[#9E4D71] underline mt-1 cursor-pointer"
            >
              <span>{t('viewTimer')} →</span>
            </button>
          </div>
        )}

        {/* 0 Contacts Warning */}
        {contacts.length === 0 && (
          <div className="bg-[#FFFDFB] border border-amber-300 p-4 rounded-2xl space-y-2 text-xs text-amber-900 shadow-xs">
            <div className="flex items-center space-x-2 font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              <span>{t('noContactsBannerTitle')}</span>
            </div>
            <p className="text-amber-800">
              {t('noContactsBannerDesc')}
            </p>
            <button
              id="add-contact-before-trip-btn"
              onClick={() => onNavigate('contacts')}
              className="px-3 py-1.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer"
            >
              {t('addContactNow')}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ========================================================================= */}
          {/* OFFLINE MODE ROUTE & DESTINATION ENTRY (SHOWN WHEN OFFLINE) */}
          {/* ========================================================================= */}
          {isOffline ? (
            <div className="bg-amber-50/90 border border-amber-300 p-4 sm:p-5 rounded-2xl space-y-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-amber-200/80">
                <div className="flex items-center space-x-2">
                  <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                    Offline Destination Entry
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-extrabold uppercase tracking-wide">
                  Offline Fallback
                </span>
              </div>

              <p className="text-xs text-amber-900 leading-relaxed">
                Device is currently offline. Online place search and routing APIs are skipped. Enter your destination manually below. <strong>Hardware GPS tracking and your local arrival timer continue operating without internet</strong>, and SMS alert fallback is primed.
              </p>

              {/* Offline Starting Point (Hardware GPS) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-amber-950 flex items-center gap-1">
                    <LocateFixed className="w-3.5 h-3.5 text-amber-700" />
                    <span>Starting Point (Device Hardware GPS)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => fetchCurrentGPS(true)}
                    disabled={gettingStartLocation}
                    className="text-[11px] font-bold text-amber-800 hover:text-amber-950 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${gettingStartLocation ? 'animate-spin' : ''}`} />
                    <span>Refresh GPS</span>
                  </button>
                </div>
                <div className="bg-white/90 border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs text-[#3A3A3A] flex items-center justify-between">
                  <span className="font-mono text-[11px] text-amber-900 truncate">
                    {currentGpsLocation?.latitude && currentGpsLocation?.longitude
                      ? `GPS: ${currentGpsLocation.latitude.toFixed(5)}, ${currentGpsLocation.longitude.toFixed(5)}`
                      : gettingStartLocation
                      ? 'Acquiring device GPS coordinates...'
                      : 'GPS location available upon departure'}
                  </span>
                  <span className="shrink-0 ml-2 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Hardware GPS Ready
                  </span>
                </div>
              </div>

              {/* Offline Destination Manual Field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="offline-destination-input"
                  className="block text-xs font-semibold text-amber-950 flex items-center gap-1"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>Destination Name / Landmark</span>
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  id="offline-destination-input"
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Enter destination (e.g., Home, Office, Hostel, Central Station)"
                  className="w-full bg-white border border-amber-300 rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:ring-2 focus:ring-[#C88EA7] focus:border-[#C88EA7]"
                  required
                />
              </div>

              {/* Offline Duration Quick Presets */}
              <div className="space-y-2 pt-2 border-t border-amber-200/80">
                <label className="block text-xs font-semibold text-amber-950 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <span>Manual Trip Duration (Presets)</span>
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {[
                    { label: '10m', val: 10 },
                    { label: '15m', val: 15 },
                    { label: '20m', val: 20 },
                    { label: '30m', val: 30 },
                    { label: '45m', val: 45 },
                    { label: '60m', val: 60 },
                    { label: 'Custom', val: -1 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      id={`offline-duration-btn-${preset.val}`}
                      onClick={() => setDurationMinutes(preset.val)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold transition-all text-center cursor-pointer border ${
                        durationMinutes === preset.val
                          ? 'bg-[#9E4D71] text-white border-[#9E4D71] shadow-2xs'
                          : 'bg-white text-amber-950 hover:bg-amber-100 border-amber-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {durationMinutes === -1 && (
                  <div className="pt-1">
                    <input
                      id="offline-custom-duration-input"
                      type="number"
                      min="1"
                      placeholder="Enter custom duration in minutes (e.g., 25)"
                      value={customDuration}
                      onChange={(e) => setCustomDuration(e.target.value)}
                      className="w-full bg-white border border-amber-300 rounded-xl px-3.5 py-2 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                      required
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ========================================================================= */
            /* GOOGLE MAPS STYLE ROUTE CARD: STARTING POINT + SWAP + DESTINATION */
            /* ========================================================================= */
            <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 sm:p-5 rounded-2xl space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#3A3A3A] uppercase tracking-wider flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>Route & Location Search</span>
                </span>

                {gettingStartLocation && (
                  <span className="text-[11px] text-[#9E4D71] flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Locating device...</span>
                  </span>
                )}
              </div>

              <div className="space-y-3 relative">
                {/* 1. Starting Point Input with Autocomplete & Current GPS Support */}
                <LocationSearchInput
                  id="trip-starting-point-input"
                  label="Starting Point"
                  value={startQuery}
                  placeholder={gettingStartLocation ? "Locating..." : "Search starting location (e.g. Current location, Thane Station)"}
                  onChange={handleStartQueryChange}
                  onSelectPlace={handleSelectStartPlace}
                  biasCoords={currentGpsLocation?.latitude && currentGpsLocation?.longitude ? { lat: currentGpsLocation.latitude, lng: currentGpsLocation.longitude } : null}
                  selectedCoords={startCoords}
                  iconType="origin"
                  isCurrentGps={isCurrentGpsStart}
                  isLoading={gettingStartLocation}
                  onResetToCurrentLocation={handleResetToCurrentGPS}
                  required
                />

                {/* Swap Origin and Destination Button (Google Maps Style) */}
                <div className="flex justify-end pr-2 -my-1">
                  <button
                    type="button"
                    id="swap-route-points-btn"
                    onClick={handleSwapLocations}
                    className="p-1.5 rounded-full bg-white hover:bg-[#F0D0DF]/30 text-[#7D757A] hover:text-[#9E4D71] border border-[#EFE8E1] shadow-2xs transition-all cursor-pointer flex items-center gap-1 text-[11px] font-medium"
                    title="Reverse starting point and destination"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5 text-[#9E4D71]" />
                    <span className="text-[10px] hidden sm:inline text-[#6B6368]">Reverse Route</span>
                  </button>
                </div>

                {/* 2. Destination Search Input with Autocomplete */}
                <LocationSearchInput
                  id="trip-destination-search-input"
                  label="Destination"
                  value={destination}
                  placeholder="Search destination or address (e.g. Thane Station, Home)"
                  onChange={handleDestinationChange}
                  onSelectPlace={handleSelectDestPlace}
                  biasCoords={startCoords || (currentGpsLocation?.latitude && currentGpsLocation?.longitude ? { lat: currentGpsLocation.latitude, lng: currentGpsLocation.longitude } : null)}
                  selectedCoords={destCoordinates}
                  iconType="destination"
                  required
                />
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* DURATION MODE TOGGLE: Auto-calculate (Google Maps) vs Set manually */}
          {/* (Hidden when offline, since manual mode is already active) */}
          {/* ========================================================================= */}
          {!isOffline && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-[#6B6368]">
                  Arrival Timer Calculation
                </label>
                <span className="text-[11px] text-[#7D757A]">
                  {durationMode === 'auto' ? 'Automated from travel route' : 'Manual duration'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 p-1 bg-[#FAF6F3] rounded-2xl border border-[#EFE8E1]">
                <button
                  type="button"
                  id="duration-mode-auto-btn"
                  onClick={() => setDurationMode('auto')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    durationMode === 'auto'
                      ? 'bg-white text-[#9E4D71] shadow-xs border border-[#EFE8E1]'
                      : 'text-[#6B6368] hover:text-[#3A3A3A]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>Auto-calculate (OpenRouteService)</span>
                </button>
                <button
                  type="button"
                  id="duration-mode-manual-btn"
                  onClick={() => setDurationMode('manual')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    durationMode === 'manual'
                      ? 'bg-white text-[#9E4D71] shadow-xs border border-[#EFE8E1]'
                      : 'text-[#6B6368] hover:text-[#3A3A3A]'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-[#7D757A]" />
                  <span>Set manually</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* AUTO-CALCULATE VIEW: TRAVEL MODES & LIVE ROUTE ESTIMATION */}
          {/* ========================================================================= */}
          {durationMode === 'auto' && (
            <div className="bg-[#FCF9F7] border border-[#EADED7] p-4 sm:p-5 rounded-2xl space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6B6368] mb-2">
                  Select Travel Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    id="travel-mode-walking"
                    onClick={() => handleTravelModeChange('walking')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5 border transition-all cursor-pointer ${
                      travelMode === 'walking'
                        ? 'bg-[#F9EDF3] border-[#C88EA7] text-[#9E4D71] font-bold shadow-xs'
                        : 'bg-white border-[#EFE8E1] text-[#6B6368] hover:bg-[#FAF6F3]'
                    }`}
                  >
                    <Footprints className="w-4 h-4" />
                    <span>Walking</span>
                  </button>

                  <button
                    type="button"
                    id="travel-mode-driving"
                    onClick={() => handleTravelModeChange('driving')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5 border transition-all cursor-pointer ${
                      travelMode === 'driving'
                        ? 'bg-[#F9EDF3] border-[#C88EA7] text-[#9E4D71] font-bold shadow-xs'
                        : 'bg-white border-[#EFE8E1] text-[#6B6368] hover:bg-[#FAF6F3]'
                    }`}
                  >
                    <Car className="w-4 h-4" />
                    <span>Driving / Cab</span>
                  </button>

                  <button
                    type="button"
                    id="travel-mode-transit"
                    onClick={() => handleTravelModeChange('transit')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5 border transition-all cursor-pointer ${
                      travelMode === 'transit'
                        ? 'bg-[#F9EDF3] border-[#C88EA7] text-[#9E4D71] font-bold shadow-xs'
                        : 'bg-white border-[#EFE8E1] text-[#6B6368] hover:bg-[#FAF6F3]'
                    }`}
                  >
                    <Bus className="w-4 h-4" />
                    <span>Public Transit</span>
                  </button>
                </div>
              </div>

              {/* Estimated Travel Time Result Card */}
              <div className="bg-white p-4 rounded-xl border border-[#EADED7] space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-[#7D757A] uppercase tracking-wider flex items-center gap-1">
                      <span>Calculated Travel Time</span>
                      {estimatedDuration && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                    </p>

                    {isEstimating || isGeocoding ? (
                      <div className="flex items-center gap-2 mt-1">
                        <RefreshCw className="w-4 h-4 text-[#9E4D71] animate-spin" />
                        <p className="text-xs text-[#9E4D71] font-medium">
                          Calculating route and distance...
                        </p>
                      </div>
                    ) : estimatedDuration ? (
                      <div className="space-y-1 mt-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-black text-[#2E282C]">
                            {formatDuration(calculatedTotalMinutes)}
                          </span>
                          <span className="text-xs font-semibold text-[#6B6368]">
                            (~{(estimatedDuration.distanceMeters / 1000).toFixed(1)} km)
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-700 font-medium">
                          ✓ Arrival timer automatically set to {formatDuration(calculatedTotalMinutes)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-[#6B6368] mt-1">
                        {destination.trim()
                          ? 'Resolving coordinates for route directions...'
                          : 'Select a destination above to automatically calculate travel time'}
                      </p>
                    )}
                  </div>

                  {estimatedDuration && (
                    <div className="text-right space-y-1">
                      <div className="px-2.5 py-1 rounded-full bg-[#F9EDF3] text-[#9E4D71] text-[11px] font-bold border border-[#F0D0DF] inline-block">
                        {travelMode === 'walking'
                          ? '🚶 Walking'
                          : travelMode === 'driving'
                          ? '🚗 Driving'
                          : '🚌 Transit'}
                      </div>
                      <p className="text-[10px] text-[#7D757A]">
                        {estimatedDuration.source === 'openrouteservice'
                          ? 'OpenRouteService live directions'
                          : estimatedDuration.source === 'osrm_open_routing'
                          ? 'OSRM road network routing'
                          : 'Open road network routing'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Quick Arrival Safety Buffer Buttons */}
                {estimatedDuration && (
                  <div className="pt-2 border-t border-[#FAF6F3] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#6B6368]">
                      Add safety buffer for traffic/delays:
                    </span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { label: '+0m', val: 0 },
                        { label: '+5m', val: 5 },
                        { label: '+10m', val: 10 },
                        { label: '+15m', val: 15 },
                      ].map((buf) => (
                        <button
                          key={buf.val}
                          type="button"
                          onClick={() => handleBufferSelect(buf.val)}
                          className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            extraBufferMinutes === buf.val
                              ? 'bg-[#9E4D71] text-white shadow-2xs'
                              : 'bg-[#FAF6F3] text-[#6B6368] hover:bg-[#F3ECE5] border border-[#EFE8E1]'
                          }`}
                        >
                          {buf.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Offline / Manual Fallback helper */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] text-amber-900">
                <span>Offline or prefer custom duration?</span>
                <button
                  type="button"
                  onClick={() => setDurationMode('manual')}
                  className="font-bold text-[#9E4D71] hover:underline cursor-pointer ml-2 shrink-0"
                >
                  Set Duration Manually →
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SET MANUALLY VIEW (FALLBACK FOR OFFLINE OR CUSTOM USAGE) */}
          {/* ========================================================================= */}
          {durationMode === 'manual' && (
            <div className="bg-[#FCF9F7] border border-[#EADED7] p-4 rounded-2xl space-y-3">
              <label className="block text-xs font-semibold text-[#6B6368]">
                {t('durationLabel')} (Manual Duration)
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-[#7D757A] absolute left-3 top-3 pointer-events-none z-10" />
                <select
                  id="trip-duration-select"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full bg-white border border-[#EFE8E1] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                >
                  <option value={10}>10 Minutes</option>
                  <option value={15}>15 Minutes</option>
                  <option value={20}>20 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={45}>45 Minutes</option>
                  <option value={60}>60 Minutes</option>
                  <option value={-1}>Custom Minutes...</option>
                </select>
              </div>

              {durationMinutes === -1 && (
                <input
                  id="trip-custom-duration-input"
                  type="number"
                  min="1"
                  placeholder="Enter minutes (e.g. 45)"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(e.target.value)}
                  className="w-full bg-white border border-[#EFE8E1] rounded-xl px-3.5 py-2 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                />
              )}
            </div>
          )}

          {/* Grace Period Dropdown (Safety Response Window) */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-[#6B6368]">
              {t('graceLabel')} (Safety Response Window)
            </label>
            <select
              id="trip-grace-select"
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
              className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
            >
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes (Recommended)</option>
              <option value={15}>15 Minutes</option>
              <option value={-1}>Custom Grace Minutes...</option>
            </select>

            {graceMinutes === -1 && (
              <input
                id="trip-custom-grace-input"
                type="number"
                min="1"
                placeholder="Enter grace minutes (e.g. 8)"
                value={customGrace}
                onChange={(e) => setCustomGrace(e.target.value)}
                className="mt-2 w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
              />
            )}
            <p className="text-[11px] text-[#7D757A] pt-0.5">
              A safety popup appears when your arrival timer ends. If unanswered within 2 minutes, emergency contacts are alerted automatically.
            </p>
          </div>

          {/* Continuous GPS Location Tracking Info */}
          <div className="bg-[#FAF6F3] p-3.5 rounded-2xl border border-[#EFE8E1] space-y-1">
            <div className="flex items-start space-x-3">
              <input
                id="trip-include-location-checkbox"
                type="checkbox"
                checked={includeLocation}
                onChange={(e) => setIncludeLocation(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] cursor-pointer"
              />
              <div>
                <label
                  htmlFor="trip-include-location-checkbox"
                  className="font-bold text-xs text-[#3A3A3A] cursor-pointer flex items-center gap-1.5"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>Continuous GPS Tracking & Trail Log</span>
                </label>
                <p className="text-[11px] text-[#6B6368] mt-0.5 leading-normal">
                  Continuously logs your GPS coordinates along the route into a secure trip trail. In the event of an overdue alert or emergency, contacts receive your live location link and route history.
                </p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            id="start-trip-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-xs transition-all flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            <span>
              {loading
                ? 'Starting Safety Check...'
                : `Start Trip Safety Check (${formatDuration(calculatedTotalMinutes)})`}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
