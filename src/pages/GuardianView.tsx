import React, { useEffect, useState, useRef } from 'react';
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
  AlertCircle,
  Download,
  Play,
  Pause,
  ListMusic,
} from 'lucide-react';
import { doc, onSnapshot, getDoc, collection } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Trip, AudioEvidence } from '../types';
import {
  subscribeGuardianTrip,
  subscribeGuardianUser,
  fetchGuardianTrip,
  computeLastSeenSafe,
  getGuardianUrl,
} from '../services/guardianService';
import { dataUrlToBlob } from '../services/sosService';
import { getAudioExtension } from '../services/audioSnapshotService';
import { resolveAudioEvidenceUrl } from '../utils/audioUrl';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDuration } from '../utils/formatters';

interface GuardianViewProps {
  tripId?: string | null;
  userId?: string | null;
  onNavigateHome?: () => void;
}

export interface GuardianAudioChunk {
  id?: string;
  index: number;
  timestamp: string;
  base64: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  uploadedAt?: string;
}

interface SOSEvidenceDoc {
  tripId?: string;
  userId?: string;
  audioStatus?: 'syncing' | 'ready' | 'failed';
  audioBase64?: string | null;
  chunkCount?: number;
  audioMimeType?: string;
  audioExtension?: string;
  audioSizeBytes?: number;
  audioEvidenceUrl?: string | null;
  updatedAt?: string;
  recordedAt?: string;
  durationSeconds?: number;
  mimeType?: string;
  error?: string | null;
}

export const GuardianView: React.FC<GuardianViewProps> = ({
  tripId,
  userId,
  onNavigateHome,
}) => {
  const { t } = useLanguage();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [evidenceDoc, setEvidenceDoc] = useState<SOSEvidenceDoc | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [audioPlaybackError, setAudioPlaybackError] = useState<boolean>(false);
  const objectUrlRef = useRef<string | null>(null);
  const [audioChunks, setAudioChunks] = useState<GuardianAudioChunk[]>([]);
  const [activePlayingIndex, setActivePlayingIndex] = useState<number | null>(null);
  const [isPlayingSequential, setIsPlayingSequential] = useState(false);
  const [isAudioPlayerPaused, setIsAudioPlayerPaused] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [syncTimerSeconds, setSyncTimerSeconds] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [copiedLink, setCopiedLink] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [nowTime, setNowTime] = useState<Date>(new Date());

  const effectiveTripId = trip?.id || tripId || '';
  const cleanTripId = String(effectiveTripId).replace(/[^A-Za-z0-9_-]/g, '_');

  // Reassemble audio data from Firestore sos_evidence/{cleanTripId} and optional subcollection chunks
  const reconstructAudioBlob = async (data: SOSEvidenceDoc) => {
    if (data.audioStatus !== 'ready') return;
    try {
      let completeBase64 = '';
      const chunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 0;

      if (chunkCount > 0 && db) {
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Fetching ${chunkCount} chunks in numeric order for trip "${cleanTripId}"...`);
        const chunkPromises = [];
        for (let i = 0; i < chunkCount; i++) {
          chunkPromises.push(getDoc(doc(db, 'sos_evidence', cleanTripId, 'chunks', String(i))));
        }
        const chunkSnaps = await Promise.all(chunkPromises);
        const parts = chunkSnaps.map((s, idx) => {
          if (!s.exists()) {
            console.warn(`[SOS-AUDIO] [GUARDIAN VIEW] Warning: chunk ${idx} not found`);
            return '';
          }
          return s.data()?.chunk || '';
        });
        completeBase64 = parts.join('');
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Reassembled ${chunkCount} chunks. Total chars: ${completeBase64.length}`);
      } else {
        completeBase64 = data.audioBase64 || '';
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Single-doc base64 audio retrieved (${completeBase64.length} chars)`);
      }

      if (completeBase64) {
        const mime = data.audioMimeType || data.mimeType || 'audio/webm';
        let dataUrl = completeBase64;
        if (!dataUrl.startsWith('data:')) {
          dataUrl = `data:${mime};base64,${completeBase64}`;
        }

        // Convert base64 back to Blob using fetch(dataUrl).then(r => r.blob())
        let blob: Blob;
        try {
          blob = await fetch(dataUrl).then((r) => r.blob());
        } catch (fetchErr) {
          console.warn('[SOS-AUDIO] [GUARDIAN VIEW] fetch(dataUrl) fallback to dataUrlToBlob:', fetchErr);
          blob = dataUrlToBlob(dataUrl).blob;
        }

        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Converted base64 to Blob: ${blob.size} bytes, type: "${blob.type}"`);
        const newObjectUrl = URL.createObjectURL(blob);

        if (objectUrlRef.current && objectUrlRef.current !== newObjectUrl) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = newObjectUrl;
        setAudioObjectUrl(newObjectUrl);
        setAudioBlob(blob);
        setAudioPlaybackError(false);
      } else if (data.audioEvidenceUrl) {
        setAudioObjectUrl(data.audioEvidenceUrl);
      }
    } catch (err: any) {
      console.error('[SOS-AUDIO] [GUARDIAN VIEW] Error reconstructing audio evidence:', err);
    }
  };

  // Revoke the object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Keep live time ticking every 5 seconds for accurate "mins ago"
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // 1. Live onSnapshot listener on separate evidence document: sos_evidence/{cleanTripId}
  useEffect(() => {
    if (!effectiveTripId || !db) return;

    console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📡 Subscribing with onSnapshot to sos_evidence/${cleanTripId}...`);
    const unsub = onSnapshot(
      doc(db, 'sos_evidence', cleanTripId),
      async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as SOSEvidenceDoc;
          console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📥 onSnapshot received update for sos_evidence/${cleanTripId}:`, {
            audioStatus: data?.audioStatus,
            audioMimeType: data?.audioMimeType,
            chunkCount: data?.chunkCount,
            audioSizeBytes: data?.audioSizeBytes,
            hasDirectBase64: Boolean(data?.audioBase64),
          });
          setEvidenceDoc({
            tripId: data.tripId || cleanTripId,
            audioStatus: data.audioStatus || 'syncing',
            audioBase64: data.audioBase64,
            chunkCount: data.chunkCount,
            audioMimeType: data.audioMimeType,
            audioExtension: data.audioExtension,
            audioSizeBytes: data.audioSizeBytes,
            audioEvidenceUrl: data.audioEvidenceUrl || null,
            updatedAt: data.updatedAt,
            recordedAt: data.recordedAt,
            durationSeconds: data.durationSeconds,
            mimeType: data.mimeType,
            error: data.error,
          });

          if (data.audioStatus === 'ready') {
            await reconstructAudioBlob(data);
          }
        } else {
          console.log(`[SOS-AUDIO] [GUARDIAN VIEW] sos_evidence/${cleanTripId} not present in Firestore. Checking server fallback...`);
          try {
            const sResp = await fetch(`/api/sos/evidence/${cleanTripId}`);
            if (sResp.ok) {
              const sJson = await sResp.json();
              if (sJson.success && sJson.evidence) {
                const sDoc = sJson.evidence as SOSEvidenceDoc;
                setEvidenceDoc(sDoc);
                if (sDoc.audioStatus === 'ready') {
                  await reconstructAudioBlob(sDoc);
                }
              }
            }
          } catch {}
        }
      },
      (err) => {
        console.warn(`[SOS-AUDIO] [GUARDIAN VIEW] onSnapshot error on sos_evidence/${cleanTripId}:`, err);
      }
    );

    return () => unsub();
  }, [effectiveTripId, cleanTripId]);

  // Direct real-time onSnapshot listener on the trip document in Firestore
  useEffect(() => {
    if (!cleanTripId || !db) return;

    console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📡 Subscribing with onSnapshot directly to trips/${cleanTripId}...`);
    const unsubTrip = onSnapshot(
      doc(db, 'trips', cleanTripId),
      (snap) => {
        if (snap.exists()) {
          const freshTrip = { id: snap.id, ...snap.data() } as Trip;
          console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📥 onSnapshot received live update for trips/${cleanTripId}:`, {
            id: freshTrip.id,
            status: freshTrip.status,
            audioStatus: freshTrip.audioStatus,
            audioUrl: freshTrip.audioUrl,
            audioEvidenceUrl: freshTrip.audioEvidenceUrl,
          });
          setTrip(freshTrip);
          setLoading(false);
          setLastSyncTime(new Date());
        }
      },
      (err) => {
        console.warn(`[SOS-AUDIO] [GUARDIAN VIEW] onSnapshot trip listener warning:`, err);
      }
    );

    return () => unsubTrip();
  }, [cleanTripId]);

  // 3. Real-time onSnapshot listener for 10-second segmented audio chunks: trips/{cleanTripId}/audioChunks
  useEffect(() => {
    if (!cleanTripId || !db) return;
    console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📡 Subscribing with onSnapshot to collection trips/${cleanTripId}/audioChunks...`);
    const unsubChunks = onSnapshot(
      collection(db, 'trips', cleanTripId, 'audioChunks'),
      (snap) => {
        const list: GuardianAudioChunk[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            index: typeof d.index === 'number' ? d.index : parseInt(docSnap.id, 10) || 0,
            timestamp: d.timestamp || '',
            base64: d.base64 || '',
            mimeType: d.mimeType || 'audio/webm',
            durationSeconds: d.durationSeconds || 10,
            sizeBytes: d.sizeBytes || 0,
            uploadedAt: d.uploadedAt,
          });
        });
        list.sort((a, b) => a.index - b.index);
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 📥 onSnapshot audioChunks: ${list.length} clips available for trip "${cleanTripId}".`);
        setAudioChunks(list);
      },
      (err) => {
        console.warn(`[SOS-AUDIO] [GUARDIAN VIEW] audioChunks onSnapshot error:`, err);
      }
    );

    return () => unsubChunks();
  }, [cleanTripId]);

  // Active playing audio source derivation
  const activeChunk = activePlayingIndex !== null && audioChunks[activePlayingIndex] ? audioChunks[activePlayingIndex] : null;
  const activeChunkSrc = activeChunk
    ? (activeChunk.base64.startsWith('data:') ? activeChunk.base64 : `data:${activeChunk.mimeType || 'audio/webm'};base64,${activeChunk.base64}`)
    : '';

  // Trigger audio playback when activeChunkSrc or isAudioPlayerPaused changes
  useEffect(() => {
    if (activeChunkSrc && audioRef.current && !isAudioPlayerPaused) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.warn('[SOS-AUDIO] [GUARDIAN VIEW] Autoplay error/restriction:', err);
      });
    }
  }, [activeChunkSrc, isAudioPlayerPaused]);

  // Handle when current segment ends: auto-advance to next segment in sequential mode
  const handleAudioChunkEnded = () => {
    if (isPlayingSequential && activePlayingIndex !== null) {
      const nextIndex = activePlayingIndex + 1;
      if (nextIndex < audioChunks.length) {
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] ⏩ Advancing sequential playback to clip #${nextIndex + 1}...`);
        setActivePlayingIndex(nextIndex);
        setIsAudioPlayerPaused(false);
      } else {
        console.log(`[SOS-AUDIO] [GUARDIAN VIEW] ⏹️ Reached end of current playlist (${audioChunks.length} clips).`);
        if (trip?.audioStatus !== 'recording') {
          setIsPlayingSequential(false);
          setActivePlayingIndex(null);
          setIsAudioPlayerPaused(true);
        }
      }
    } else {
      setActivePlayingIndex(null);
      setIsAudioPlayerPaused(true);
    }
  };

  const handlePlayClip = (index: number) => {
    if (activePlayingIndex === index) {
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
          setIsAudioPlayerPaused(false);
        } else {
          audioRef.current.pause();
          setIsAudioPlayerPaused(true);
        }
      }
    } else {
      setActivePlayingIndex(index);
      setIsPlayingSequential(false);
      setIsAudioPlayerPaused(false);
    }
  };

  const handleTogglePlayAll = () => {
    if (audioChunks.length === 0) return;
    if (isPlayingSequential && !isAudioPlayerPaused) {
      if (audioRef.current) audioRef.current.pause();
      setIsAudioPlayerPaused(true);
    } else {
      setIsPlayingSequential(true);
      setIsAudioPlayerPaused(false);
      if (activePlayingIndex === null || activePlayingIndex >= audioChunks.length) {
        setActivePlayingIndex(0);
      } else if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const handleDownloadSingleChunk = (chunk: GuardianAudioChunk) => {
    const ext = chunk.mimeType?.includes('mp4') ? 'mp4' : 'webm';
    const filename = `sos-audio-${cleanTripId}-clip-${chunk.index + 1}.${ext}`;
    const src = chunk.base64.startsWith('data:') ? chunk.base64 : `data:${chunk.mimeType || 'audio/webm'};base64,${chunk.base64}`;
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadAllChunks = () => {
    if (audioChunks.length === 0) return;
    audioChunks.forEach((chunk, i) => {
      setTimeout(() => handleDownloadSingleChunk(chunk), i * 300);
    });
  };

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

  const handleCheckSyncStatus = async () => {
    if (!effectiveTripId) return;
    setManualRefreshing(true);
    console.log(`[SOS-AUDIO] [GUARDIAN VIEW] 🔄 Manual "Check Sync Status" triggered for sos_evidence/${cleanTripId}...`);
    try {
      if (db) {
        const snap = await getDoc(doc(db, 'sos_evidence', cleanTripId));
        if (snap.exists()) {
          const data = snap.data() as SOSEvidenceDoc;
          console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Manual re-read retrieved sos_evidence/${cleanTripId}:`, data);
          setEvidenceDoc({
            tripId: data.tripId || cleanTripId,
            audioStatus: data.audioStatus || 'syncing',
            audioBase64: data.audioBase64,
            chunkCount: data.chunkCount,
            audioMimeType: data.audioMimeType,
            audioExtension: data.audioExtension,
            audioSizeBytes: data.audioSizeBytes,
            audioEvidenceUrl: data.audioEvidenceUrl || null,
            updatedAt: data.updatedAt,
            recordedAt: data.recordedAt,
            durationSeconds: data.durationSeconds,
            mimeType: data.mimeType,
            error: data.error,
          });

          if (data.audioStatus === 'ready') {
            await reconstructAudioBlob(data);
          }
        } else {
          try {
            const sResp = await fetch(`/api/sos/evidence/${cleanTripId}`);
            if (sResp.ok) {
              const sJson = await sResp.json();
              if (sJson.success && sJson.evidence) {
                const sDoc = sJson.evidence as SOSEvidenceDoc;
                setEvidenceDoc(sDoc);
                if (sDoc.audioStatus === 'ready') {
                  await reconstructAudioBlob(sDoc);
                }
              }
            }
          } catch {}
        }
      }
      if (tripId) {
        const fresh = await fetchGuardianTrip(tripId);
        if (fresh) {
          setTrip(fresh);
          setLastSyncTime(new Date());
        }
      }
    } catch (err) {
      console.warn('[SOS-AUDIO] [GUARDIAN VIEW] Notice during manual sync check:', err);
    } finally {
      setTimeout(() => setManualRefreshing(false), 500);
    }
  };

  const handleDownloadAudio = () => {
    if (!audioBlob && !audioObjectUrl) return;
    const ext = evidenceDoc?.audioExtension || (evidenceDoc?.audioMimeType?.includes('mp4') ? 'm4a' : 'webm');
    const filename = `sos-evidence-${cleanTripId}.${ext}`;
    const url = audioObjectUrl || (audioBlob ? URL.createObjectURL(audioBlob) : '');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log(`[SOS-AUDIO] [GUARDIAN VIEW] Triggered download of evidence: "${filename}"`);
  };

  const handleManualRefresh = async () => {
    await handleCheckSyncStatus();
    if (userId) {
      subscribeGuardianUser(userId, (data, syncTime) => {
        setTrip(data);
        setLastSyncTime(syncTime);
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

  const isAlerted = trip?.status === 'alerted' || trip?.status === 'sos';
  const isSosAlert = isAlerted || Boolean(trip?.isSosEvent);
  const isReminded = trip?.status === 'reminded';
  const isResolved = trip?.status === 'resolved' || trip?.status === 'safe';
  const isSafe = isResolved;
  const isActive = trip?.status === 'active';
  const isCancelled = trip?.status === 'cancelled';

  // Calculate elapsed seconds since SOS started
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  const sosStartTimestamp =
    trip?.sosTimestamp ||
    trip?.alertedAt ||
    trip?.audioCapturedAt ||
    trip?.startTime ||
    null;
  const sosElapsedSeconds = sosStartTimestamp
    ? (nowMs - new Date(sosStartTimestamp).getTime()) / 1000
    : 999;

  // 60-second timer for syncing card
  useEffect(() => {
    const status = evidenceDoc?.audioStatus || trip?.audioStatus;
    const isActivelySyncing =
      status === 'syncing' ||
      status === 'uploading' ||
      status === 'recording' ||
      (isSosAlert && !evidenceDoc?.audioEvidenceUrl && !trip?.audioEvidenceUrl);

    if (!isActivelySyncing || evidenceDoc?.audioStatus === 'ready' || evidenceDoc?.audioStatus === 'failed') {
      return;
    }

    const interval = setInterval(() => {
      setSyncTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [evidenceDoc?.audioStatus, trip?.audioStatus, isSosAlert, evidenceDoc?.audioEvidenceUrl, trip?.audioEvidenceUrl]);

  const rawAudioUrl = trip?.audioUrl || trip?.audioEvidenceUrl || evidenceDoc?.audioEvidenceUrl || '';
  const resolvedAudioUrl = audioObjectUrl || resolveAudioEvidenceUrl(rawAudioUrl);

  const effectiveAudioStatus = trip?.audioStatus || evidenceDoc?.audioStatus;
  const isAudioReady = Boolean(resolvedAudioUrl);
  const isAudioUploading = !isAudioReady && (effectiveAudioStatus === 'uploading' || effectiveAudioStatus === 'syncing');
  const isAudioFailed = !isAudioReady && (effectiveAudioStatus === 'failed');
  const isAudioRecording = !isAudioReady && (effectiveAudioStatus === 'recording');

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

        {/* Not Found / Expired State ONLY if neither trip nor evidenceDoc exists */}
        {!loading && !trip && !evidenceDoc && (
          <div className="bg-white border border-[#EFE8E1] rounded-3xl p-10 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 bg-[#F9EDF3] text-[#9E4D71] rounded-2xl flex items-center justify-center mx-auto border border-[#F0D0DF]">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-[#3A3A3A]">
              {!tripId && !userId ? 'Invalid Guardian Link' : 'Trip Record Not Found or Link Expired'}
            </h2>
            <p className="text-xs text-[#6B6368] max-w-md mx-auto leading-relaxed">
              {!tripId && !userId
                ? 'No guardian link or traveler identifier was provided in this request.'
                : 'This emergency guardian link may have expired, or the trip session is no longer available on this device. If an emergency was recently triggered, tap "Sync Now" above to check again.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleManualRefresh}
                className="px-5 py-2.5 rounded-xl bg-[#FAF6F3] text-[#3A3A3A] hover:bg-[#F3ECE5] font-bold text-xs border border-[#EFE8E1] shadow-2xs cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
                <span>Retry Sync</span>
              </button>
              {onNavigateHome && (
                <button
                  onClick={onNavigateHome}
                  className="px-6 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer transition-colors"
                >
                  Open SafeCheck
                </button>
              )}
            </div>
          </div>
        )}

        {/* Persistent Audio Evidence Card when trip session ended or is marked safe, but evidence is preserved */}
        {!loading && !trip && evidenceDoc && (
          <div className="bg-white border border-[#EFE8E1] rounded-3xl p-6 sm:p-8 space-y-5 shadow-sm">
            <div className="flex items-center space-x-3 border-b border-[#EFE8E1] pb-4">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-[#3A3A3A]">
                  Archived Emergency SOS Evidence
                </h2>
                <p className="text-xs text-[#6B6368]">
                  Trip ID: {cleanTripId} • Forensic evidence preserved in cloud storage
                </p>
              </div>
            </div>

            {isAudioReady && resolvedAudioUrl ? (
              <div id="sos-audio-player-card" className="p-5 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-md flex flex-col space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                      <Mic className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200 tracking-wide uppercase">
                        🚨 Emergency Audio Recording
                      </h4>
                      <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                        <span>{evidenceDoc?.durationSeconds || 30}s forensic evidence</span>
                        <span>•</span>
                        <span>WebM Audio</span>
                      </div>
                    </div>
                  </div>

                  <a
                    id="download-evidence-link"
                    href={resolvedAudioUrl}
                    download={`SafeCheck_Evidence_${cleanTripId}.webm`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white border border-slate-700 text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download evidence</span>
                  </a>
                </div>

                <div className="bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/60">
                  <audio
                    id="guardian-evidence-audio-controls"
                    controls
                    src={resolvedAudioUrl}
                    className="w-full h-10 outline-none rounded-lg"
                    preload="metadata"
                  >
                    Your browser does not support HTML5 audio playback.
                  </audio>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-[#7D757A]">
                Audio evidence status: {evidenceDoc.audioStatus}
              </div>
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
                        : isResolved
                        ? 'Resolved ✅'
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
                      : isResolved
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
                  {isResolved &&
                    `${trip.userName || 'The traveler'} has confirmed safe arrival. All trip timers are safely completed. Status: Resolved ✅`}
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
                        <span className="font-semibold font-mono">{expectedArrivalStr} ({formatDuration(trip.durationMinutes)})</span>
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
            {audioChunks.length > 0 ? (
              <div id="sos-segmented-audio-container" className="space-y-4">
                {/* Real-time Status Card */}
                <div
                  id="sos-segmented-audio-status"
                  className={`rounded-3xl p-4 sm:p-5 shadow-xs flex items-start space-x-3.5 ${
                    trip?.audioStatus === 'recording'
                      ? 'bg-rose-50/95 border border-rose-200 text-rose-950'
                      : trip?.audioStatus === 'uploading'
                      ? 'bg-amber-50/95 border border-amber-200 text-amber-950'
                      : 'bg-emerald-50/90 border border-emerald-200/80 text-emerald-950'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs ${
                      trip?.audioStatus === 'recording'
                        ? 'bg-rose-100 text-rose-700'
                        : trip?.audioStatus === 'uploading'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {trip?.audioStatus === 'recording' ? (
                      <Mic className="w-5 h-5 text-rose-600 animate-pulse" />
                    ) : trip?.audioStatus === 'uploading' ? (
                      <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    )}
                  </div>

                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-xs flex items-center space-x-1.5">
                        <span>
                          {trip?.audioStatus === 'recording'
                            ? '🚨 Live Audio Streaming in 10-Second Segments'
                            : trip?.audioStatus === 'uploading'
                            ? 'Syncing Audio Segments...'
                            : 'Forensic Audio Evidence Attached'}
                        </span>
                        {trip?.audioStatus === 'recording' && (
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                        )}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          trip?.audioStatus === 'recording'
                            ? 'bg-rose-200/90 text-rose-900 border border-rose-300'
                            : trip?.audioStatus === 'uploading'
                            ? 'bg-amber-200 text-amber-900 border border-amber-300'
                            : 'bg-emerald-200/80 text-emerald-900 border border-emerald-300/50'
                        }`}
                      >
                        {trip?.audioStatus === 'recording'
                          ? 'Recording'
                          : trip?.audioStatus === 'uploading'
                          ? 'Uploading'
                          : 'All Saved'}
                      </span>
                    </div>

                    <p className="text-[11px] leading-relaxed opacity-90">
                      {trip?.audioStatus === 'recording'
                        ? `Captured in real time on traveler's device. Each 10-second segment is an independent, complete evidence clip uploaded directly to Firestore.`
                        : `${audioChunks.length} continuous 10-second clips recorded during emergency SOS alert. Stored permanently in secure forensic evidence record.`}
                    </p>

                    <div className="flex items-center space-x-3 pt-1 text-[10px] font-medium opacity-80">
                      <span>{audioChunks.length} Clips ({audioChunks.length * 10} seconds total)</span>
                      <span>•</span>
                      <span>
                        Updated {new Date(trip?.audioStatusUpdatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Master Audio Player Card */}
                <div id="sos-segmented-player-card" className="p-5 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-md flex flex-col space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                        <Volume2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 tracking-wide uppercase">
                          🚨 Sequential Audio Player
                        </h4>
                        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                          <span>
                            {activePlayingIndex !== null
                              ? `Playing Segment #${activePlayingIndex + 1} of ${audioChunks.length}`
                              : `Playlist Ready (${audioChunks.length} segments)`}
                          </span>
                          <span>•</span>
                          <span>{audioChunks.length * 10}s total runtime</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <button
                        type="button"
                        id="play-all-sequential-btn"
                        onClick={handleTogglePlayAll}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition cursor-pointer shadow-2xs"
                      >
                        {isPlayingSequential && !isAudioPlayerPaused ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause Sequence</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play All in Order</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        id="download-all-evidence-btn"
                        onClick={handleDownloadAllChunks}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white border border-slate-700 text-xs font-semibold transition cursor-pointer shadow-2xs"
                        title="Download all audio segments"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download All</span>
                      </button>
                    </div>
                  </div>

                  {/* HTML5 Audio Element */}
                  <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>
                        {activePlayingIndex !== null
                          ? `Now Playing: Clip #${activePlayingIndex + 1} (Segment ${activePlayingIndex * 10}s - ${(activePlayingIndex + 1) * 10}s)`
                          : 'Select a clip below or tap "Play All in Order" to listen'}
                      </span>
                      {activePlayingIndex !== null && !isAudioPlayerPaused && (
                        <span className="flex items-center space-x-1 text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          <span>Playing</span>
                        </span>
                      )}
                    </div>

                    <audio
                      id="guardian-evidence-segmented-audio"
                      ref={audioRef}
                      controls
                      src={activeChunkSrc || (audioChunks[0] ? (audioChunks[0].base64.startsWith('data:') ? audioChunks[0].base64 : `data:${audioChunks[0].mimeType || 'audio/webm'};base64,${audioChunks[0].base64}`) : undefined)}
                      onEnded={handleAudioChunkEnded}
                      onPlay={() => setIsAudioPlayerPaused(false)}
                      onPause={() => setIsAudioPlayerPaused(true)}
                      className="w-full h-10 outline-none rounded-lg"
                    >
                      Your browser does not support HTML5 audio playback.
                    </audio>
                  </div>

                  {/* List of 10-Second Clips */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="flex items-center space-x-1.5">
                        <ListMusic className="w-4 h-4 text-rose-400" />
                        <span>Individual Audio Clips ({audioChunks.length})</span>
                      </span>
                      <span className="text-[11px] text-slate-400 font-normal">Plays sequentially</span>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {audioChunks.map((chunk) => {
                        const isCurrent = activePlayingIndex === chunk.index;
                        const isCurrentlyPlaying = isCurrent && !isAudioPlayerPaused;
                        const startSec = chunk.index * 10;
                        const endSec = (chunk.index + 1) * 10;

                        return (
                          <div
                            key={chunk.id || chunk.index}
                            className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                              isCurrent
                                ? 'bg-rose-950/40 border-rose-500/80 shadow-xs'
                                : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <button
                                type="button"
                                onClick={() => handlePlayClip(chunk.index)}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition cursor-pointer ${
                                  isCurrentlyPlaying
                                    ? 'bg-rose-500 text-white'
                                    : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                                }`}
                                title={isCurrentlyPlaying ? 'Pause Clip' : 'Play Clip'}
                              >
                                {isCurrentlyPlaying ? (
                                  <Pause className="w-4 h-4" />
                                ) : (
                                  <Play className="w-4 h-4 fill-current ml-0.5" />
                                )}
                              </button>

                              <div className="min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs font-bold text-slate-200 truncate">
                                    Clip #{chunk.index + 1}
                                  </span>
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-slate-700/80 text-slate-300">
                                    0:{String(startSec).padStart(2, '0')} - 0:{String(endSec).padStart(2, '0')}
                                  </span>
                                  {isCurrentlyPlaying && (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                      Now Playing
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center space-x-2 mt-0.5">
                                  <span>
                                    {chunk.timestamp
                                      ? new Date(chunk.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                      : 'Captured on device'}
                                  </span>
                                  <span>•</span>
                                  <span>{(chunk.sizeBytes / 1024).toFixed(1)} KB</span>
                                  <span>•</span>
                                  <span className="uppercase">{chunk.mimeType?.includes('mp4') ? 'MP4' : 'WebM'}</span>
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDownloadSingleChunk(chunk)}
                              className="p-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer shrink-0"
                              title={`Download Clip #${chunk.index + 1}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                    <div className="flex items-center space-x-1.5 text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Permanent forensic audio evidence • {cleanTripId}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">
                      Firestore AudioChunks
                    </span>
                  </div>
                </div>
              </div>
            ) : isAudioReady && resolvedAudioUrl ? (
              <div id="sos-audio-evidence-container" className="space-y-3">
                {/* Synced Confirmation State with Timestamp */}
                <div
                  id="sos-audio-status-synced"
                  className="bg-emerald-50/90 border border-emerald-200/80 rounded-3xl p-4 sm:p-5 shadow-xs flex items-start space-x-3.5 text-emerald-950"
                >
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 shadow-2xs">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-xs text-emerald-900 flex items-center space-x-1.5">
                        <span>Forensic Audio Evidence Attached</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-200/80 text-emerald-900 border border-emerald-300/50">
                        Ready
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-relaxed">
                      Emergency live ambient audio snapshot captured on traveler's device during alert. Stored permanently in secure forensic evidence record.
                    </p>
                    <div className="flex items-center space-x-2 pt-1 text-[10px] text-emerald-700 font-medium">
                      <Clock className="w-3 h-3 text-emerald-600" />
                      <span>
                        Updated at{' '}
                        {new Date(
                          evidenceDoc?.updatedAt || trip.syncedAt || trip.audioStatusUpdatedAt || Date.now()
                        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Audio Player Card with native <audio controls> & Download audio Button */}
                <div id="sos-audio-player-card" className="p-5 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-md flex flex-col space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                        <Mic className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 tracking-wide uppercase">
                          🚨 Emergency Audio Recording
                        </h4>
                        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                          <span>
                            {audioDuration
                              ? `${Math.round(audioDuration)}s`
                              : `${evidenceDoc?.durationSeconds || trip.audioDurationSec || 30}s`}{' '}
                            forensic evidence
                          </span>
                          <span>•</span>
                          <span>
                            {evidenceDoc?.audioExtension
                              ? evidenceDoc.audioExtension.toUpperCase()
                              : evidenceDoc?.audioMimeType?.includes('mp4')
                              ? 'M4A'
                              : 'WebM'}{' '}
                            Audio
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      id="download-evidence-btn"
                      type="button"
                      onClick={handleDownloadAudio}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white border border-slate-700 text-xs font-semibold transition cursor-pointer self-start sm:self-auto shadow-2xs"
                      title={`Download sos-evidence-${cleanTripId}.${evidenceDoc?.audioExtension || 'webm'}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download audio</span>
                    </button>
                  </div>

                  {/* Standard Native Audio Controls */}
                  <div className="bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/60">
                    <audio
                      id="guardian-evidence-audio-controls"
                      controls
                      preload="metadata"
                      src={resolvedAudioUrl}
                      onError={() => {
                        console.warn('[SOS-AUDIO] HTML5 audio error event triggered');
                        setAudioPlaybackError(true);
                      }}
                      onLoadedMetadata={(e) => {
                        if (e.currentTarget.duration && !isNaN(e.currentTarget.duration)) {
                          setAudioDuration(e.currentTarget.duration);
                        }
                      }}
                      className="w-full h-10 outline-none rounded-lg"
                    >
                      Your browser does not support HTML5 audio playback.
                    </audio>
                  </div>

                  {/* Audio Playback Error Banner */}
                  {audioPlaybackError && (
                    <div
                      id="audio-playback-error-banner"
                      className="bg-amber-900/60 border border-amber-600/80 rounded-2xl p-3 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Audio can't be played in this browser, tap Download audio</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadAudio}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs shrink-0 cursor-pointer shadow-2xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download audio</span>
                      </button>
                    </div>
                  )}

                  <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                    <div className="flex items-center space-x-1.5 text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Permanent forensic evidence • {cleanTripId}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : isAudioUploading ? (
              <div id="sos-audio-status-uploading" className="bg-amber-50/90 border border-amber-200 rounded-3xl p-5 shadow-xs flex items-start space-x-3.5 text-amber-950">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0 text-amber-700">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs text-amber-900 flex items-center space-x-1.5">
                      <span>Audio is uploading...</span>
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-900 border border-amber-300">
                      Uploading...
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Emergency audio evidence was captured on the traveler's device and is uploading to cloud storage. It will appear automatically once transfer completes.
                  </p>
                </div>
              </div>
            ) : isAudioFailed ? (
              <div id="sos-audio-status-failed" className="bg-rose-50/90 border border-rose-200 text-rose-950 rounded-3xl p-5 shadow-xs flex items-start space-x-3.5">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-rose-100 text-rose-700">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs flex items-center space-x-1.5 text-rose-900">
                      <span>Audio could not be uploaded</span>
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-rose-200/90 text-rose-900 border-rose-300">
                      Upload Failed
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-rose-800">
                    {trip?.audioError || evidenceDoc?.error || 'Audio could not be uploaded from the device.'}
                  </p>
                  <div className="pt-1">
                    <button
                      id="guardian-retry-audio-check-btn"
                      onClick={handleCheckSyncStatus}
                      className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl border border-rose-300 text-rose-900 hover:text-rose-950 bg-rose-200/70 hover:bg-rose-200 transition-all cursor-pointer shadow-2xs"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
                      <span>Check Again</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : isAudioRecording ? (
              <div id="sos-audio-status-recording" className="bg-rose-50/90 border border-rose-200 text-rose-950 rounded-3xl p-5 shadow-xs flex items-start space-x-3.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center shrink-0 text-rose-700">
                  <Mic className="w-5 h-5 animate-pulse text-rose-600" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs flex items-center space-x-1.5 text-rose-900">
                      <span>Recording emergency audio evidence...</span>
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-200/90 text-rose-900 border border-rose-300">
                      Recording
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-rose-800">
                    Microphone is actively recording ambient audio evidence on the traveler's device.
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
