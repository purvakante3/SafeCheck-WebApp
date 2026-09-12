export interface LocationResult {
  latitude: number | null;
  longitude: number | null;
  locationUrl: string | null;
  accuracy?: number;
  speed?: number | null;
  address?: string;
  success: boolean;
  errorMessage?: string;
}

export interface PlaceSuggestion {
  id: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  type?: string;
  distanceMeters?: number;
}

export function formatGoogleMapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

import { formatDuration } from '../utils/formatters';
export { formatDuration };

// In-memory cache for reverse geocoding to avoid duplicate requests
const geocodeCache = new Map<string, string>();

/**
 * Calculates Haversine distance between two coordinates in meters
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export const calculateDistanceMeters = haversineDistanceMeters;

/**
 * Reverse geocode coordinates to a human-readable street/neighborhood address
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key)!;
  }

  // Fast offline return using raw coordinates with zero delay
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineName = `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    geocodeCache.set(key, offlineName);
    return offlineName;
  }

  // 1. Direct OpenStreetMap Nominatim reverse endpoint with User-Agent header
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(nominatimUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SafeCheck-App/1.0 (Emergency-Checkin; contact: purvakante3@gmail.com)',
        'Accept-Language': 'en',
      },
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      if (data && data.display_name) {
        geocodeCache.set(key, data.display_name);
        return data.display_name;
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.log('[SafeCheck Location] Nominatim reverse notice:', err?.message || err);
    }
  }

  // 2. Server proxy fallback (which also queries Nominatim with User-Agent)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`/api/maps/reverse-geocode?lat=${lat}&lng=${lng}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const addr = data?.display_name || data?.address;
      if (addr && !addr.startsWith('Current Location')) {
        geocodeCache.set(key, addr);
        return addr;
      }
    }
  } catch {}

  const fallback = `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  geocodeCache.set(key, fallback);
  return fallback;
}

export async function getCurrentLocation(): Promise<LocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      latitude: null,
      longitude: null,
      locationUrl: null,
      success: false,
      errorMessage: 'Geolocation is not supported by your browser.',
    };
  }

  return new Promise((resolve) => {
    let isSettled = false;

    // Hard JavaScript timeout failsafe (5 seconds max)
    // Ensures promise NEVER hangs even if browser permission prompt hangs or is ignored
    const fallbackTimer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        console.warn('[SafeCheck Location] Geolocation request timed out after 5s failsafe');
        resolve({
          latitude: null,
          longitude: null,
          locationUrl: null,
          success: false,
          errorMessage: 'Location request timed out. Proceeding with emergency dispatch.',
        });
      }
    }, 5000);

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 4500,
      maximumAge: 10000,
    };

    try {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(fallbackTimer);

          const lat = Number(position.coords.latitude.toFixed(6));
          const lng = Number(position.coords.longitude.toFixed(6));
          const locationUrl = formatGoogleMapsUrl(lat, lng);
          const accuracy = position.coords.accuracy ? Math.round(position.coords.accuracy) : undefined;
          const speed = position.coords.speed !== null && position.coords.speed !== undefined ? Number(position.coords.speed.toFixed(1)) : null;

          // Non-blocking reverse geocode
          let address: string | undefined;
          try {
            address = await Promise.race([
              reverseGeocode(lat, lng),
              new Promise<string>((_, reject) => setTimeout(() => reject('timeout'), 3500)),
            ]);
          } catch {}

          resolve({
            latitude: lat,
            longitude: lng,
            locationUrl,
            accuracy,
            speed,
            address,
            success: true,
          });
        },
        (error) => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(fallbackTimer);

          let msg = 'Unable to retrieve location coordinates.';
          if (error.code === error.PERMISSION_DENIED) {
            msg = 'Location permission was denied. You can enable location access in browser settings.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg = 'Location information is currently unavailable.';
          } else if (error.code === error.TIMEOUT) {
            msg = 'Location request timed out.';
          }
          resolve({
            latitude: null,
            longitude: null,
            locationUrl: null,
            success: false,
            errorMessage: msg,
          });
        },
        options
      );
    } catch (e: any) {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(fallbackTimer);
        resolve({
          latitude: null,
          longitude: null,
          locationUrl: null,
          success: false,
          errorMessage: e?.message || 'Error initializing geolocation.',
        });
      }
    }
  });
}

/**
 * Continuous GPS location tracking watcher
 * Streams location changes and supports periodic fallback checks
 */
export function startLocationWatcher(options: {
  onLocation: (loc: LocationResult) => void;
  onError?: (err: string) => void;
  intervalMs?: number;
}): () => void {
  if (!navigator.geolocation) {
    if (options.onError) options.onError('Geolocation is not supported by your browser.');
    return () => {};
  }

  let isWatching = true;

  const handlePosition = async (pos: GeolocationPosition) => {
    if (!isWatching) return;
    const lat = Number(pos.coords.latitude.toFixed(6));
    const lng = Number(pos.coords.longitude.toFixed(6));
    const locationUrl = formatGoogleMapsUrl(lat, lng);
    const accuracy = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : undefined;
    const speed = pos.coords.speed !== null && pos.coords.speed !== undefined ? Number(pos.coords.speed.toFixed(1)) : null;

    let address: string | undefined;
    try {
      address = await reverseGeocode(lat, lng);
    } catch {}

    options.onLocation({
      latitude: lat,
      longitude: lng,
      locationUrl,
      accuracy,
      speed,
      address,
      success: true,
    });
  };

  const handleError = (err: GeolocationPositionError) => {
    if (!isWatching) return;
    console.warn('[SafeCheck GPS Watcher notice]:', err.message);
    if (options.onError) options.onError(err.message);
  };

  const watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleError,
    {
      enableHighAccuracy: true,
      maximumAge: 4000,
      timeout: 10000,
    }
  );

  // Periodic active polling fallback every intervalMs (defaults to 20 seconds)
  const pollInterval = options.intervalMs || 20000;
  const pollTimer = setInterval(() => {
    if (!isWatching) return;
    navigator.geolocation.getCurrentPosition(handlePosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 4000,
      timeout: 8000,
    });
  }, pollInterval);

  return () => {
    isWatching = false;
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch {}
    clearInterval(pollTimer);
  };
}

/**
 * Auto-estimates travel duration and distance between starting GPS and destination
 * using free OpenRouteService Directions API and Open Source Routing Machine (OSRM).
 */
export async function estimateTripTravelTime(params: {
  startLat: number;
  startLng: number;
  destLat: number;
  destLng: number;
  travelMode: 'walking' | 'driving' | 'transit';
}): Promise<{ durationMinutes: number; distanceMeters: number; formattedDuration: string; source: string }> {
  const { startLat, startLng, destLat, destLng, travelMode } = params;

  // 1. Try server endpoint which queries OpenRouteService Directions API (or free OSRM)
  try {
    const res = await fetch('/api/maps/estimate-duration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startLat, startLng, destLat, destLng, travelMode }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.durationMinutes === 'number' && data.durationMinutes > 0) {
        return {
          durationMinutes: data.durationMinutes,
          distanceMeters: data.distanceMeters || haversineDistanceMeters(startLat, startLng, destLat, destLng),
          formattedDuration: formatDuration(data.durationMinutes),
          source: data.source || 'openrouteservice',
        };
      }
    }
  } catch {}

  // 2. Accurate offline Haversine distance model with realistic urban / intercity circuity factor
  const straightDistance = haversineDistanceMeters(startLat, startLng, destLat, destLng);
  let roadDistanceMeters: number;
  let minutes: number;

  if (straightDistance > 500000) {
    // Intercity / cross-country / international distance (> 500 km)
    roadDistanceMeters = Math.round(straightDistance * 1.18);
    if (travelMode === 'walking') {
      minutes = Math.max(30, Math.ceil(roadDistanceMeters / 75));
    } else if (travelMode === 'driving') {
      minutes = Math.max(15, Math.ceil(roadDistanceMeters / 1500) + 15);
    } else if (travelMode === 'transit') {
      minutes = Math.max(30, Math.ceil(roadDistanceMeters / 8300) + 60);
    } else {
      minutes = Math.max(15, Math.ceil(roadDistanceMeters / 1500));
    }
  } else {
    // Urban and regional scale (< 500 km)
    roadDistanceMeters = Math.round(straightDistance * 1.32);
    if (travelMode === 'walking') {
      minutes = Math.max(3, Math.ceil(roadDistanceMeters / 80)); // 4.8 km/h
    } else if (travelMode === 'driving') {
      minutes = Math.max(5, Math.ceil(roadDistanceMeters / 500) + 3); // 30 km/h + 3 min traffic buffer
    } else if (travelMode === 'transit') {
      minutes = Math.max(8, Math.ceil(roadDistanceMeters / 360) + 5); // 22 km/h + 5 min transfer
    } else {
      minutes = Math.max(5, Math.ceil(roadDistanceMeters / 500));
    }
  }

  return {
    durationMinutes: minutes,
    distanceMeters: roadDistanceMeters,
    formattedDuration: formatDuration(minutes),
    source: 'haversine_offline',
  };
}

const placeAutocompleteClientCache = new Map<string, PlaceSuggestion[]>();

/**
 * Searches places with live autocomplete suggestions like Google Maps
 */
export async function searchPlacesAutocomplete(
  query: string,
  biasCoords?: { lat: number; lng: number }
): Promise<PlaceSuggestion[]> {
  const cleanQ = query.trim();
  if (!cleanQ || cleanQ.length < 2) return [];

  const cacheKey = `${cleanQ.toLowerCase()}_${biasCoords?.lat ? biasCoords.lat.toFixed(2) : ''}_${biasCoords?.lng ? biasCoords.lng.toFixed(2) : ''}`;
  if (placeAutocompleteClientCache.has(cacheKey)) {
    return placeAutocompleteClientCache.get(cacheKey)!;
  }

  // 1. Direct coordinate match check (e.g. user pasted "19.1869, 72.9754")
  const coordsMatch = cleanQ.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
  if (coordsMatch) {
    const lat = parseFloat(coordsMatch[1]);
    const lng = parseFloat(coordsMatch[3]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const coordSuggestion: PlaceSuggestion = {
        id: `coords-${lat}-${lng}`,
        name: `Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
        type: 'coordinate',
      };
      return [coordSuggestion];
    }
  }

  // 2. Query our server proxy endpoint
  try {
    let url = `/api/maps/places-autocomplete?q=${encodeURIComponent(cleanQ)}`;
    if (biasCoords && !isNaN(biasCoords.lat) && !isNaN(biasCoords.lng)) {
      url += `&lat=${biasCoords.lat}&lng=${biasCoords.lng}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        // Calculate optional distance from biasCoords
        const formatted: PlaceSuggestion[] = data.suggestions.map((s: any) => {
          let dist: number | undefined;
          if (biasCoords && s.latitude && s.longitude) {
            dist = haversineDistanceMeters(biasCoords.lat, biasCoords.lng, s.latitude, s.longitude);
          }
          return {
            ...s,
            distanceMeters: dist,
          };
        });

        placeAutocompleteClientCache.set(cacheKey, formatted);
        return formatted;
      }
    }
  } catch (serverErr: any) {
    if (serverErr?.name !== 'AbortError') {
      console.log('[Places API Proxy notice] Falling back to client-side place search:', serverErr?.message || serverErr);
    }
  }

  // 3. Client-side fallback to Photon (CORS enabled)
  try {
    let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQ)}&limit=6`;
    if (biasCoords) {
      photonUrl += `&lat=${biasCoords.lat}&lon=${biasCoords.lng}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const pRes = await fetch(photonUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (pRes.ok) {
      const pData = await pRes.json();
      if (pData.features && Array.isArray(pData.features) && pData.features.length > 0) {
        const results: PlaceSuggestion[] = [];
        for (const f of pData.features) {
          const props = f.properties || {};
          const coords = f.geometry?.coordinates;
          if (coords && coords.length >= 2) {
            const fLng = coords[0];
            const fLat = coords[1];
            const name = props.name || props.street || cleanQ;
            const addrParts = [
              props.street,
              props.district || props.suburb,
              props.city || props.town,
              props.state,
              props.country,
            ].filter(Boolean);
            const secondary = addrParts.filter((p: string) => p !== name).join(', ') || props.country || '';
            let dist: number | undefined;
            if (biasCoords) {
              dist = haversineDistanceMeters(biasCoords.lat, biasCoords.lng, fLat, fLng);
            }
            results.push({
              id: `osm-${props.osm_id || Math.random()}`,
              name,
              formattedAddress: secondary ? `${name}, ${secondary}` : name,
              latitude: Number(fLat.toFixed(6)),
              longitude: Number(fLng.toFixed(6)),
              type: props.osm_value || props.type || 'place',
              distanceMeters: dist,
            });
          }
        }
        if (results.length > 0) {
          placeAutocompleteClientCache.set(cacheKey, results);
          return results;
        }
      }
    }
  } catch (pErr: any) {
    if (pErr?.name !== 'AbortError') {
      console.log('[Photon client search notice]:', pErr?.message || pErr);
    }
  }

  // 4. Client-side fallback to Nominatim
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQ)}&addressdetails=1&limit=5`;
    const nRes = await fetch(nomUrl, {
      signal: controller.signal,
      headers: { 'Accept-Language': 'en' },
    });
    clearTimeout(timeout);

    if (nRes.ok) {
      const nData = await nRes.json();
      if (Array.isArray(nData) && nData.length > 0) {
        const nomResults: PlaceSuggestion[] = [];
        for (const item of nData) {
          const itemLat = parseFloat(item.lat);
          const itemLng = parseFloat(item.lon);
          if (!isNaN(itemLat) && !isNaN(itemLng)) {
            const addr = item.address || {};
            const name = item.name || addr.amenity || addr.railway || addr.road || item.display_name.split(',')[0];
            const parts = item.display_name.split(',').slice(1, 4).map((s: string) => s.trim()).join(', ');
            let dist: number | undefined;
            if (biasCoords) {
              dist = haversineDistanceMeters(biasCoords.lat, biasCoords.lng, itemLat, itemLng);
            }
            nomResults.push({
              id: `nom-${item.place_id}`,
              name: name.trim(),
              formattedAddress: parts ? `${name.trim()}, ${parts}` : item.display_name,
              latitude: Number(itemLat.toFixed(6)),
              longitude: Number(itemLng.toFixed(6)),
              type: item.type || item.class || 'place',
              distanceMeters: dist,
            });
          }
        }
        if (nomResults.length > 0) {
          placeAutocompleteClientCache.set(cacheKey, nomResults);
          return nomResults;
        }
      }
    }
  } catch {}

  return [];
}

export async function geocodeAddress(
  addressQuery: string
): Promise<{ latitude: number; longitude: number; formattedAddress: string } | null> {
  if (!addressQuery || !addressQuery.trim()) return null;
  const q = addressQuery.trim();

  // Check if query is in lat, lng format
  const coordsMatch = q.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
  if (coordsMatch) {
    const lat = parseFloat(coordsMatch[1]);
    const lng = parseFloat(coordsMatch[3]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {
        latitude: lat,
        longitude: lng,
        formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      };
    }
  }

  // OpenStreetMap Nominatim forward search
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      {
        headers: { 'User-Agent': 'SafeCheck-App/1.0' },
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          return {
            latitude: lat,
            longitude: lng,
            formattedAddress: item.display_name?.split(',').slice(0, 3).join(',').trim() || q,
          };
        }
      }
    }
  } catch {}

  return null;
}

export async function shareLocationUrl(
  url: string,
  destinationTitle?: string
): Promise<{ method: 'share' | 'clipboard'; success: boolean }> {
  const text = destinationTitle
    ? `🚨 SafeCheck Live Location for "${destinationTitle}": ${url}`
    : `🚨 My SafeCheck Live Location: ${url}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'SafeCheck Live Location',
        text,
        url,
      });
      return { method: 'share', success: true };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { method: 'share', success: false };
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return { method: 'clipboard', success: true };
  } catch (err) {
    return { method: 'clipboard', success: false };
  }
}
