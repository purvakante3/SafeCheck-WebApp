import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Navigation,
  Search,
  X,
  Loader2,
  LocateFixed,
  Train,
  Building2,
  Landmark,
  Compass,
} from 'lucide-react';
import { PlaceSuggestion, searchPlacesAutocomplete } from '../services/locationService';

interface LocationSearchInputProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
  onSelectPlace: (place: {
    name: string;
    formattedAddress: string;
    lat: number;
    lng: number;
  }) => void;
  biasCoords?: { lat: number; lng: number } | null;
  selectedCoords?: { lat: number; lng: number } | null;
  iconType?: 'origin' | 'destination';
  isCurrentGps?: boolean;
  isLoading?: boolean;
  onResetToCurrentLocation?: () => void;
  disabled?: boolean;
  required?: boolean;
}

export const LocationSearchInput: React.FC<LocationSearchInputProps> = ({
  id,
  label,
  value,
  placeholder,
  onChange,
  onSelectPlace,
  biasCoords,
  selectedCoords,
  iconType = 'destination',
  isCurrentGps = false,
  isLoading = false,
  onResetToCurrentLocation,
  disabled = false,
  required = false,
}) => {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search when user types
  useEffect(() => {
    if (!value || value.trim().length < 2 || value === 'Locating...' || isCurrentGps) {
      setSuggestions([]);
      setIsOpen(false);
      setLoading(false);
      return;
    }

    // Don't search if the input value matches the currently selected coordinates' formatted representation
    // only search when user is actively editing
    setLoading(true);
    setHasSearched(false);

    const timer = setTimeout(async () => {
      try {
        const results = await searchPlacesAutocomplete(
          value,
          biasCoords ? { lat: biasCoords.lat, lng: biasCoords.lng } : undefined
        );
        setSuggestions(results);
        setHasSearched(true);
        if (results.length > 0 && document.activeElement === inputRef.current) {
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('Place search notice:', err);
        setSuggestions([]);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [value, biasCoords]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (sug: PlaceSuggestion) => {
    onSelectPlace({
      name: sug.name,
      formattedAddress: sug.formattedAddress,
      lat: sug.latitude,
      lng: sug.longitude,
    });
    setIsOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const getSuggestionIcon = (type?: string, name?: string) => {
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    if (t.includes('station') || t.includes('rail') || n.includes('station') || n.includes('metro') || n.includes('terminus')) {
      return <Train className="w-4 h-4 text-[#9E4D71]" />;
    }
    if (t.includes('building') || t.includes('office') || t.includes('commercial')) {
      return <Building2 className="w-4 h-4 text-[#7D757A]" />;
    }
    if (t.includes('monument') || t.includes('museum') || t.includes('park') || t.includes('tourism')) {
      return <Landmark className="w-4 h-4 text-emerald-700" />;
    }
    return <MapPin className="w-4 h-4 text-[#C88EA7]" />;
  };

  return (
    <div ref={containerRef} className="relative w-full space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-xs font-semibold text-[#5A5558] flex items-center gap-1.5">
          {iconType === 'origin' ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 ring-2 ring-emerald-200" />
          ) : (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#9E4D71] ring-2 ring-[#F0D0DF]" />
          )}
          <span>{label}</span>
          {isCurrentGps && (
            <span className="text-[10px] font-normal text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
              Current GPS
            </span>
          )}
        </label>

        {onResetToCurrentLocation && !isCurrentGps && (
          <button
            type="button"
            onClick={onResetToCurrentLocation}
            className="text-[11px] font-medium text-[#9E4D71] hover:underline flex items-center gap-1 cursor-pointer"
            title="Reset to current device GPS location"
          >
            <LocateFixed className="w-3 h-3 text-[#9E4D71]" />
            <span>Use current location</span>
          </button>
        )}
      </div>

      <div className="relative">
        <div className="absolute left-3 top-3 pointer-events-none text-[#7D757A]">
          {iconType === 'origin' ? (
            <Compass className="w-4 h-4 text-emerald-600" />
          ) : (
            <Navigation className="w-4 h-4 text-[#9E4D71]" />
          )}
        </div>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete="off"
          className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl pl-9 pr-16 py-2.5 text-sm text-[#3A3A3A] placeholder-[#7D757A] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-all shadow-2xs"
        />

        <div className="absolute right-2.5 top-2.5 flex items-center space-x-1">
          {(loading || isLoading) && <Loader2 className="w-4 h-4 text-[#9E4D71] animate-spin" />}

          {value && !disabled && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setSuggestions([]);
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-[#7D757A] hover:text-[#3A3A3A] hover:bg-[#F3ECE5] transition-colors cursor-pointer"
              title="Clear input"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Selected Coordinates Status Pill */}
      {selectedCoords && selectedCoords.lat && selectedCoords.lng && (
        <div className="flex items-center justify-between text-[11px] text-[#6B6368] px-1">
          <span className="font-mono text-[10px] text-[#7D757A]">
            📍 {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
          </span>
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100">
            Coordinates locked
          </span>
        </div>
      )}

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[#EFE8E1] rounded-2xl shadow-lg max-h-72 overflow-y-auto divide-y divide-[#FAF6F3] animate-in fade-in duration-150">
          {suggestions.length > 0 ? (
            <div className="py-1">
              <div className="px-3 py-1 text-[10px] font-bold text-[#7D757A] uppercase tracking-wider bg-[#FAF6F3]">
                Matching Places & Landmarks
              </div>
              {suggestions.map((sug, idx) => {
                const isSelected = highlightedIndex === idx;
                return (
                  <button
                    key={sug.id || idx}
                    type="button"
                    onClick={() => handleSelect(sug)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full px-3.5 py-2.5 text-left flex items-start space-x-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#F9EDF3]' : 'hover:bg-[#FAF6F3]'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-[#FAF6F3] border border-[#EFE8E1]">
                      {getSuggestionIcon(sug.type, sug.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-[#2E282C] truncate">
                          {sug.name}
                        </p>
                        {typeof sug.distanceMeters === 'number' && (
                          <span className="text-[10px] font-medium text-[#9E4D71] shrink-0 bg-[#F9EDF3] px-1.5 py-0.5 rounded-full border border-[#F0D0DF]">
                            {sug.distanceMeters < 1000
                              ? `${sug.distanceMeters}m`
                              : `${(sug.distanceMeters / 1000).toFixed(1)} km`}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#7D757A] truncate mt-0.5">
                        {sug.formattedAddress || `${sug.latitude.toFixed(4)}, ${sug.longitude.toFixed(4)}`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : hasSearched && !loading ? (
            <div className="p-3 text-center space-y-1 text-xs text-[#7D757A]">
              <p className="font-semibold text-[#3A3A3A]">No place matches found</p>
              <p className="text-[11px]">
                You can still use "{value}" as a manual custom destination or try another search term.
              </p>
            </div>
          ) : null}

          <div className="px-3 py-1.5 bg-[#FCF9F7] text-[10px] text-[#7D757A] flex items-center justify-between border-t border-[#EFE8E1]">
            <span>OpenStreetMap Nominatim search</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
};
