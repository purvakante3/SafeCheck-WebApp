import React, { useEffect, useRef, useState } from 'react';
import { Trip, UserProfile, EmergencyContact } from '../types';
import {
  isBatteryStatusSupported,
  hasLowBatteryAlertBeenSent,
  sendLowBatteryAutoAlert,
} from '../services/batteryService';
import { BatteryWarning, Check, X } from 'lucide-react';

interface LowBatteryMonitorProps {
  trip: Trip | null;
  user: UserProfile | null;
  contacts?: EmergencyContact[];
  onAlertSent?: (message: string) => void;
}

/**
 * LowBatteryMonitor
 *
 * Monitors device battery level during an active trip via the Battery Status API.
 * When battery drops below 15%, automatically sends an email alert to saved contacts.
 * Dispatched only once per trip session (reset on new trip).
 * Fails gracefully if Battery Status API is unsupported.
 */
export const LowBatteryMonitor: React.FC<LowBatteryMonitorProps> = ({
  trip,
  user,
  contacts,
  onAlertSent,
}) => {
  const [alertNotice, setAlertNotice] = useState<string | null>(null);
  const alertDispatchedRef = useRef<boolean>(false);
  const currentTripIdRef = useRef<string | null>(null);

  // Reset dispatched ref whenever active trip ID changes
  useEffect(() => {
    if (trip?.id !== currentTripIdRef.current) {
      currentTripIdRef.current = trip?.id || null;
      alertDispatchedRef.current = false;
      setAlertNotice(null);
    }
  }, [trip?.id]);

  useEffect(() => {
    if (!trip || !user) return;
    if (trip.status !== 'active' && trip.status !== 'reminded') return;

    // Check if already dispatched for this trip session
    if (hasLowBatteryAlertBeenSent(trip) || alertDispatchedRef.current) {
      return;
    }

    let batteryManager: any = null;
    let isSubscribed = true;

    const evaluateBatteryLevel = async (level: number) => {
      if (!isSubscribed) return;
      const pct = Math.round(level * 100);

      // Trigger if level is below 15% (i.e. <= 14% or level < 0.15)
      if (level < 0.15 || pct < 15) {
        if (!alertDispatchedRef.current && !hasLowBatteryAlertBeenSent(trip)) {
          alertDispatchedRef.current = true;
          console.warn(
            `[SafeCheck Low Battery] ⚠️ Battery level dropped to ${pct}% (< 15%). Triggering auto-alert to contacts...`
          );

          try {
            const res = await sendLowBatteryAutoAlert(trip, user, level, contacts);
            if (isSubscribed) {
              setAlertNotice(
                `Low battery alert (${pct}%) sent to emergency contacts with your last known location.`
              );
              if (onAlertSent) {
                onAlertSent(res.message);
              }
            }
          } catch (err) {
            console.error('[SafeCheck Low Battery] Failed to send auto-alert:', err);
          }
        }
      }
    };

    // 1. Check if Battery Status API is supported
    if (isBatteryStatusSupported()) {
      (navigator as any)
        .getBattery()
        .then((battery: any) => {
          if (!isSubscribed) return;
          batteryManager = battery;

          // Initial check immediately on trip load
          evaluateBatteryLevel(battery.level);

          // Listen for level changes
          const handleLevelChange = () => {
            if (battery && isSubscribed) {
              evaluateBatteryLevel(battery.level);
            }
          };

          battery.addEventListener('levelchange', handleLevelChange);
        })
        .catch((err: any) => {
          console.warn('[SafeCheck Low Battery] Error accessing getBattery():', err);
        });
    } else {
      // Browser does not support Battery Status API - log warning and fail gracefully
      console.warn(
        '[SafeCheck Low Battery] Battery Status API (navigator.getBattery) is not supported in this browser. Low battery monitoring is inactive.'
      );
    }

    // 2. Custom simulation listener for development/testing
    const handleSimulation = (event: Event) => {
      const customEv = event as CustomEvent<{ level?: number }>;
      const testLevel = customEv.detail?.level ?? 0.12;
      console.log(`[SafeCheck Low Battery] Simulating battery drop to ${(testLevel * 100).toFixed(0)}%`);
      evaluateBatteryLevel(testLevel);
    };

    window.addEventListener('safecheck:simulate-low-battery', handleSimulation);

    return () => {
      isSubscribed = false;
      if (batteryManager) {
        try {
          batteryManager.removeEventListener('levelchange', evaluateBatteryLevel);
        } catch {}
      }
      window.removeEventListener('safecheck:simulate-low-battery', handleSimulation);
    };
  }, [trip, user, contacts, onAlertSent]);

  if (!alertNotice) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[#FFF8F0] border border-[#F59E0B]/50 p-4 rounded-2xl shadow-xl flex items-start space-x-3 text-[#92400E]">
        <div className="w-8 h-8 rounded-xl bg-[#FEF3C7] flex items-center justify-center shrink-0 text-[#D97706] mt-0.5">
          <BatteryWarning className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-1.5 font-bold text-xs uppercase tracking-wider text-[#B45309]">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span>Low Battery Alert Dispatched</span>
          </div>
          <p className="text-xs text-[#78350F] mt-1 leading-relaxed font-medium">
            {alertNotice}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAlertNotice(null)}
          className="text-[#B45309] hover:text-[#78350F] p-1 rounded-lg transition-colors cursor-pointer shrink-0"
          title="Dismiss notification"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
