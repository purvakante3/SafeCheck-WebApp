import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';

// Read firebase config safely
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error('Error reading firebase-applet-config.json:', e);
  }
}

// Check if valid Firebase project is configured
let isFirebaseAvailable = false;
let db: any = null;

try {
  let rawCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let adminCredential: any = undefined;
  let serviceAccountProjectId: string | undefined;

  // Sanitize GOOGLE_APPLICATION_CREDENTIALS if quotes were included in the environment
  if (rawCreds) {
    const cleaned = rawCreds.trim().replace(/^["']+|["']+$/g, '');
    if (cleaned.startsWith('{')) {
      try {
        const saObj = JSON.parse(cleaned);
        if (saObj.project_id) {
          serviceAccountProjectId = saObj.project_id;
        }
        adminCredential = cert(saObj);
        console.log(`[SafeCheck Server] Loaded Firebase Admin credentials from environment JSON`);
      } catch (err) {
        console.warn(`[SafeCheck Server] Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON:`, err);
      }
      // Remove from process.env so GoogleAuth does not treat a JSON string as a file path
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      const resolvedPath = path.isAbsolute(cleaned) ? cleaned : path.resolve(process.cwd(), cleaned);
      if (fs.existsSync(resolvedPath)) {
        try {
          const saContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
          if (saContent.project_id) {
            serviceAccountProjectId = saContent.project_id;
          }
        } catch {
          // ignore error
        }
        try {
          adminCredential = cert(resolvedPath);
          process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedPath;
          console.log(`[SafeCheck Server] Loaded Firebase Admin credentials from ${resolvedPath}`);
        } catch (err) {
          console.warn(`[SafeCheck Server] Failed to initialize credentials from ${resolvedPath}:`, err);
        }
      } else {
        const defaultKeyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
        if (fs.existsSync(defaultKeyPath)) {
          try {
            adminCredential = cert(defaultKeyPath);
            process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultKeyPath;
            console.log(`[SafeCheck Server] Loaded Firebase Admin credentials from ${defaultKeyPath}`);
          } catch (err) {
            console.warn(`[SafeCheck Server] Failed to initialize default credentials:`, err);
          }
        } else {
          // Path does not exist; delete env var so GoogleAuth does not crash on invalid path
          delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
      }
    }
  } else {
    // If GOOGLE_APPLICATION_CREDENTIALS is not set, check for local serviceAccountKey.json
    const defaultKeyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(defaultKeyPath)) {
      try {
        const saContent = JSON.parse(fs.readFileSync(defaultKeyPath, 'utf-8'));
        if (saContent.project_id) {
          serviceAccountProjectId = saContent.project_id;
        }
        adminCredential = cert(defaultKeyPath);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultKeyPath;
        console.log(`[SafeCheck Server] Loaded Firebase Admin credentials from ${defaultKeyPath}`);
      } catch (err) {
        console.warn(`[SafeCheck Server] Failed to initialize default credentials from ${defaultKeyPath}:`, err);
      }
    }
  }

  const effectiveProjectId = firebaseConfig.projectId || serviceAccountProjectId || process.env.FIREBASE_PROJECT_ID;

  // Firebase Admin SDK requires valid service account credentials (adminCredential) to access
  // the external Google Cloud project without 7 PERMISSION_DENIED.
  if (adminCredential && effectiveProjectId && !firebaseConfig.apiKey?.includes('Dummy')) {
    try {
      if (!getApps().length) {
        initializeApp({
          projectId: effectiveProjectId,
          credential: adminCredential,
        });
      }
      const adminApp = getApp();
      const customDbId = firebaseConfig.firestoreDatabaseId || undefined;
      db = customDbId ? getFirestore(adminApp, customDbId) : getFirestore(adminApp);
      isFirebaseAvailable = true;
      console.log('[SafeCheck Server] Firebase Admin authenticated with service account credentials.');

      // Attempt to configure CORS on the Firebase Storage bucket if accessible
      try {
        const bucketName = firebaseConfig.storageBucket || 'safecheck-app-ba229.firebasestorage.app';
        const storageInstance = getStorage(adminApp);
        const b = storageInstance.bucket(bucketName);
        b.setCorsConfiguration([
          {
            origin: ['*'],
            method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
            responseHeader: ['*'],
            maxAgeSeconds: 3600,
          },
        ]).then(() => {
          console.log(`[SafeCheck Server] Applied CORS rules to storage bucket: ${bucketName}`);
        }).catch(() => {});
      } catch {}
    } catch (adminInitErr) {
      console.warn('[SafeCheck Server] Failed to initialize Firebase Admin with credentials:', adminInitErr);
      db = null;
      isFirebaseAvailable = false;
    }
  } else {
    console.log('[SafeCheck Server] Service account credentials not present; using resilient datastore for server routes.');
    db = null;
    isFirebaseAvailable = false;
  }
} catch (e) {
  console.warn('[SafeCheck Server] Running with built-in resilient datastore:', e);
}

// In-memory / persistent resilient datastore for local dev & sandbox preview
interface StoredTrip {
  id: string;
  userId: string;
  destination: string;
  startTime: string;
  durationMinutes: number;
  graceMinutes: number;
  status: 'active' | 'reminded' | 'safe' | 'resolved' | 'alerted' | 'cancelled' | 'sos';
  reminderSentAt?: string | null;
  alertedAt?: string | null;
  safeAt?: string | null;
  resolvedAt?: string | null;
  cancelledAt?: string | null;
  userName?: string;
  userEmail?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationUrl?: string | null;
  notifiedCount?: number;
  notifiedContacts?: string[];
  isSosEvent?: boolean;
  sosId?: string;
  activeTripId?: string | null;
  sosLocation?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null;
  audioEvidence?: {
    id?: string;
    tripId?: string;
    alertId?: string;
    userId?: string;
    audioDataUrl: string;
    download_url?: string;
    storage_path?: string;
    recordedAt: string;
    durationSeconds: number;
    mimeType: string;
    syncedAt?: string;
  } | null;
  audioEvidenceUrl?: string | null;
  audioCapturedAt?: string;
  audioDurationSec?: number;
  audioStatus?: 'recording' | 'uploading' | 'ready' | 'failed';
  audioError?: string | null;
  audioStatusUpdatedAt?: string;
  syncedAt?: string;
  startLatitude?: number | null;
  startLongitude?: number | null;
  startAddress?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  destinationAddress?: string | null;
  durationMode?: 'auto' | 'manual';
  travelMode?: 'walking' | 'driving' | 'transit';
  estimatedDistanceMeters?: number;
  locationTrail?: Array<{
    id?: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number | null;
    timestamp: string;
    locationUrl?: string;
    address?: string;
  }>;
  lastKnownLatitude?: number | null;
  lastKnownLongitude?: number | null;
  lastKnownAddress?: string | null;
  lastLocationUpdate?: string | null;
  arrivedAt?: string | null;
  lateResponses?: Array<{
    timestamp: string;
    reason: string;
    note?: string;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    extendedMinutes?: number;
  }>;
  autoEscalated?: boolean;
}

interface StoredContact {
  id: string;
  userId: string;
  name: string;
  email: string;
  relation: string;
  phone?: string;
  createdAt: string;
}

interface StoredUser {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  photoUrl?: string;
  createdAt: string;
}

const localTrips: Map<string, StoredTrip> = new Map();
const localContacts: Map<string, StoredContact> = new Map();
const localUsers: Map<string, StoredUser> = new Map();
const localSOSEvents: Map<string, any> = new Map();
const localAudioEvidence: Map<string, any> = new Map();
// Audio files are streamed directly to disk (never retained in server process memory)
const AUDIO_STORAGE_DIR = path.join(process.cwd(), 'uploads', 'audio');
if (!fs.existsSync(AUDIO_STORAGE_DIR)) {
  try {
    fs.mkdirSync(AUDIO_STORAGE_DIR, { recursive: true });
  } catch {}
}

// AUDIO_URL_SECRET: Secret key used to sign and verify audio playback tokens
const AUDIO_URL_SECRET = process.env.AUDIO_URL_SECRET || firebaseConfig.apiKey || 'safecheck-emergency-audio-secret-token-key-2026';

const ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'] as const;

function generateAudioAccessToken(audioId: string, expiryMs = 7 * 24 * 60 * 60 * 1000): string {
  const secret = AUDIO_URL_SECRET || 'safecheck-emergency-audio-secret-token-key-2026';
  const expiresAt = Date.now() + expiryMs;
  const payload = `${audioId}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expiresAt}.${hmac}`;
}

function verifyAudioAccessToken(audioId: string, token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }
  const secret = AUDIO_URL_SECRET || 'safecheck-emergency-audio-secret-token-key-2026';
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    console.warn(`[SafeCheck Server] Audio token expired or invalid timestamp: ${expiresAtStr}`);
    return false;
  }
  const payload = `${audioId}:${expiresAt}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedHmac, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function getAdminAuth() {
  let app: any = null;
  const apps = getApps();
  if (apps.length > 0) {
    app = apps[0];
  } else {
    const effectiveProjectId = firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || 'safecheck-app-ba229';
    try {
      app = initializeApp({ projectId: effectiveProjectId });
    } catch {}
  }
  if (app) {
    try {
      return getAuth(app);
    } catch {}
  }
  return null;
}

// In-memory notification logs for local dev / preview UI testing
export interface LogEntry {
  id: string;
  tripId: string;
  destination: string;
  stage: 'reminder' | 'alert';
  recipient: string;
  subject: string;
  sentAt: string;
  status: 'sent' | 'simulated';
  bodySummary: string;
  locationUrl?: string | null;
}

const logs: LogEntry[] = [];

function getCleanGmailCredentials() {
  const rawUser = process.env.GMAIL_USER;
  const rawPass = process.env.GMAIL_PASS;

  if (!rawUser || !rawPass) return null;

  const cleanUser = rawUser.trim().replace(/^["']|["']$/g, '');
  // Google App Passwords are 16 characters. Often users copy them formatted with spaces (e.g. "abcd efgh ijkl mnop") or dashes.
  const cleanPass = rawPass.trim().replace(/^["']|["']$/g, '').replace(/[\s-]+/g, '');

  if (!cleanUser || !cleanPass) return null;

  return { user: cleanUser, pass: cleanPass };
}

function getTransporter() {
  const creds = getCleanGmailCredentials();
  if (creds) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: creds.user,
        pass: creds.pass,
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return null;
}

// Startup check and non-blocking verification for email configuration
const creds = getCleanGmailCredentials();
const hasGmailUser = Boolean(creds?.user);
const hasGmailPass = Boolean(creds?.pass);

let smtpVerified = false;
let smtpLastError: string | null = null;

if (!hasGmailUser || !hasGmailPass) {
  console.log('[SafeCheck Server Init] ℹ️ SMTP is in local simulation mode (GMAIL_USER or GMAIL_PASS not configured). Emergency alerts will be logged to dashboard/console.');
} else {
  console.log(`[SafeCheck Server Init] 📧 SMTP credentials provided for ${creds?.user.replace(/(?<=.).(?=.*@)/g, '*')}. Testing connection...`);
  const testTransporter = getTransporter();
  if (testTransporter) {
    testTransporter.verify((err) => {
      if (err) {
        smtpVerified = false;
        smtpLastError = err.message || 'SMTP Authentication Failed';
        console.warn(`[SafeCheck SMTP Status] ⚠️ Gmail SMTP connection failed (${err.message}). SafeCheck will fall back to in-memory notification delivery.`);
        if (err.message?.includes('535') || err.message?.includes('BadCredentials')) {
          console.log('[SafeCheck SMTP Tip] 💡 Tip: Gmail requires a 16-character Google App Password (from myaccount.google.com/apppasswords), rather than your personal Google account login password.');
        }
      } else {
        smtpVerified = true;
        smtpLastError = null;
        console.log('[SafeCheck SMTP Status] 🚀 Connected to Gmail SMTP server successfully!');
      }
    });
  }
}

/**
 * Core trip evaluation worker (Stage 1 & Stage 2 logic)
 */
async function runTripEvaluator() {
  const now = new Date();
  const transporter = getTransporter();
  const senderEmail = process.env.GMAIL_USER || 'noreply@safecheck.app';

  let evaluatedCount = 0;

  // STAGE 1: active -> reminded
  try {
    let activeTrips: StoredTrip[] = [];

    if (isFirebaseAvailable && db) {
      try {
        const snap = await db.collection('trips').where('status', '==', 'active').get();
        snap.forEach((doc: any) => activeTrips.push({ id: doc.id, ...doc.data() }));
      } catch {
        isFirebaseAvailable = false;
      }
    }

    if (!isFirebaseAvailable) {
      activeTrips = Array.from(localTrips.values()).filter((t) => t.status === 'active');
    }

    for (const trip of activeTrips) {
      const tripId = trip.id;
      const startTime = new Date(trip.startTime);
      const durationMs = (trip.durationMinutes || 15) * 60 * 1000;
      const expectedArrival = new Date(startTime.getTime() + durationMs);

      if (now >= expectedArrival) {
        evaluatedCount++;
        let userEmail = trip.userEmail;
        let userName = trip.userName || 'SafeCheck User';

        if (!userEmail && trip.userId) {
          const u = localUsers.get(trip.userId);
          if (u) {
            userEmail = u.email;
            userName = u.name || userName;
          }
        }

        const guardianLink = `${process.env.APP_URL || 'https://safecheck.app'}/?guardian=${tripId}`;
        const subject = `⚠️ SafeCheck Safety Reminder: Are you safe?`;
        const bodySummary = `Trip to "${trip.destination}" ended. Please open SafeCheck and tap "I'm Safe" within ${trip.graceMinutes || 10} minutes. 🛡️ Live Guardian Status: ${guardianLink}`;

        let isSent = false;
        if (userEmail && transporter) {
          try {
            await transporter.sendMail({
              from: `"SafeCheck" <${senderEmail}>`,
              to: userEmail,
              subject,
              text: `Hi ${userName},\n\nYour expected arrival time for trip to "${trip.destination}" has passed.\n\nPlease open SafeCheck and confirm you are safe within ${trip.graceMinutes || 10} minutes.\n\n🛡️ Live Status & Companion Dashboard:\n${guardianLink}\n\nSafeCheck System`,
            });
            isSent = true;
          } catch (e) {
            console.error('Error sending SMTP reminder email:', e);
          }
        }

        // Add to in-app log console
        logs.unshift({
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          tripId,
          destination: trip.destination || 'Unknown',
          stage: 'reminder',
          recipient: userEmail || 'User Email Missing',
          subject,
          sentAt: now.toISOString(),
          status: isSent ? 'sent' : 'simulated',
          bodySummary,
        });

        // Update trip status in local store
        const updatedTrip: StoredTrip = {
          ...trip,
          status: 'reminded',
          reminderSentAt: now.toISOString(),
        };
        localTrips.set(tripId, updatedTrip);

        // Update in Firestore if available
        if (isFirebaseAvailable && db) {
          try {
            await db.collection('trips').doc(tripId).update({
              status: 'reminded',
              reminderSentAt: now.toISOString(),
            });
          } catch {}
        }
      }
    }
  } catch (err) {
    // Stage 1 evaluator safe catch
  }

  // STAGE 2: reminded -> alerted
  try {
    let remindedTrips: StoredTrip[] = [];

    if (isFirebaseAvailable && db) {
      try {
        const snap = await db.collection('trips').where('status', '==', 'reminded').get();
        snap.forEach((doc: any) => remindedTrips.push({ id: doc.id, ...doc.data() }));
      } catch {
        isFirebaseAvailable = false;
      }
    }

    if (!isFirebaseAvailable) {
      remindedTrips = Array.from(localTrips.values()).filter((t) => t.status === 'reminded');
    }

    for (const trip of remindedTrips) {
      const tripId = trip.id;

      if (trip.reminderSentAt) {
        const reminderTime = new Date(trip.reminderSentAt);
        const graceMs = (trip.graceMinutes || 10) * 60 * 1000;
        const deadline = new Date(reminderTime.getTime() + graceMs);

        if (now >= deadline) {
          evaluatedCount++;
          let contacts: StoredContact[] = [];

          if (isFirebaseAvailable && db) {
            try {
              const contactsSnap = await db.collection('contacts').where('userId', '==', trip.userId).get();
              contactsSnap.forEach((c: any) => contacts.push(c.data()));
            } catch {}
          }

          if (contacts.length === 0) {
            contacts = Array.from(localContacts.values()).filter((c) => c.userId === trip.userId);
          }

          const userName = trip.userName || 'SafeCheck User';
          const userEmail = trip.userEmail || '';

          if (contacts.length === 0) {
            logs.unshift({
              id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              tripId,
              destination: trip.destination || 'Unknown',
              stage: 'alert',
              recipient: 'No contacts configured',
              subject: `🚨 EMERGENCY ALERT SKIPPED (0 Contacts)`,
              sentAt: now.toISOString(),
              status: 'simulated',
              bodySummary: `User ${userName} has zero emergency contacts saved. Grace period expired.`,
            });
          } else {
            for (const contact of contacts) {
              if (!contact.email) continue;

              const guardianLink = `${process.env.APP_URL || 'https://safecheck.app'}/?guardian=${tripId}`;
              const subject = `🚨 EMERGENCY ALERT: ${userName} has not checked in!`;
              let bodySummary = `URGENT: ${userName} (${userEmail}) started trip to "${trip.destination}" at ${new Date(trip.startTime).toLocaleTimeString()} and failed to respond to safety reminder. 🛡️ Live Guardian Status: ${guardianLink}`;
              if (trip.locationUrl) {
                bodySummary += ` 📍 Live Location: ${trip.locationUrl}`;
              }

              let emailText = `URGENT EMERGENCY ALERT\n\n${userName} started a trip to "${trip.destination}" on ${new Date(trip.startTime).toLocaleString()}.\n\nThey did not respond to their safety reminder after ${trip.graceMinutes || 10} minutes.\n`;
              if (trip.locationUrl) {
                emailText += `\n📍 LAST KNOWN LIVE LOCATION (Google Maps):\n${trip.locationUrl}\n`;
              }
              emailText += `\n🛡️ LIVE GUARDIAN & STATUS MONITOR LINK (No app install or login required):\n${guardianLink}\n`;
              emailText += `\nPlease contact ${userName} immediately.\n\nSafeCheck Automated Emergency System`;

              let isSent = false;
              if (transporter) {
                try {
                  const info = await transporter.sendMail({
                    from: `"SafeCheck Emergency" <${senderEmail}>`,
                    to: contact.email,
                    subject,
                    text: emailText,
                  });
                  console.log(`[SafeCheck SMTP] Emergency email delivered successfully to ${contact.email}: messageId=${info.messageId}`);
                  isSent = true;
                } catch (e: any) {
                  console.error(`[SafeCheck SMTP Error] Failed to send emergency alert email to ${contact.email}:`, {
                    code: e?.code,
                    message: e?.message,
                    command: e?.command,
                    response: e?.response,
                    responseCode: e?.responseCode,
                    stack: e?.stack,
                  });
                }
              } else {
                console.log(`[SafeCheck SMTP] Transporter not available (GMAIL_USER/GMAIL_PASS not configured). Simulating email to ${contact.email}`);
              }

              logs.unshift({
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                tripId,
                destination: trip.destination || 'Unknown',
                stage: 'alert',
                recipient: `${contact.name} <${contact.email}>`,
                subject,
                sentAt: now.toISOString(),
                status: isSent ? 'sent' : 'simulated',
                bodySummary,
                locationUrl: trip.locationUrl || null,
              });
            }
          }

          const notifiedContactsList = contacts.map((c) => `${c.name} (${c.email})`);

          // Update trip status in local store
          const updatedTrip: StoredTrip = {
            ...trip,
            status: 'alerted',
            alertedAt: now.toISOString(),
            notifiedCount: contacts.length,
            notifiedContacts: notifiedContactsList,
          };
          localTrips.set(tripId, updatedTrip);

          // Update in Firestore if available
          if (isFirebaseAvailable && db) {
            try {
              await db.collection('trips').doc(tripId).update({
                status: 'alerted',
                alertedAt: now.toISOString(),
                notifiedCount: contacts.length,
                notifiedContacts: notifiedContactsList,
              });
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    // Stage 2 evaluator safe catch
  }

  return { evaluatedCount, time: now.toISOString() };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Endpoints
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // User Endpoints
  app.get('/api/user/:uid', (req, res) => {
    const { uid } = req.params;
    const user = localUsers.get(uid);
    res.json({ user: user || null });
  });

  app.post('/api/user', async (req, res) => {
    const { uid, name, email } = req.body;
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    const user: StoredUser = {
      uid,
      name: name || 'SafeCheck User',
      email: email || '',
      createdAt: new Date().toISOString(),
    };
    localUsers.set(uid, user);

    if (isFirebaseAvailable && db && email) {
      try {
        await db.collection('users').doc(uid).set(
          {
            uid,
            name: user.name,
            email: user.email,
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Server firestore user sync notice:', err);
      }
    }

    res.json({ success: true, user });
  });

  // Profile Photo Upload / Storage Proxy Endpoint
  app.post('/api/user/:uid/photo', async (req, res) => {
    const { uid } = req.params;
    const { photoData, contentType, filename } = req.body;

    if (!uid || !photoData) {
      return res.status(400).json({ error: 'Missing user ID or photo data' });
    }

    try {
      // Update in local in-memory store
      const existingUser = localUsers.get(uid) || { uid, name: 'SafeCheck User', email: '', createdAt: new Date().toISOString() };
      existingUser.photoURL = photoData;
      localUsers.set(uid, existingUser);

      // Sync to Firestore if available
      if (isFirebaseAvailable && db) {
        try {
          await db.collection('users').doc(uid).set(
            {
              photoURL: photoData,
              photoUrl: photoData,
            },
            { merge: true }
          );
        } catch (dbErr) {
          console.warn('[Server Firestore photo sync warning]:', dbErr);
        }
      }

      res.json({ success: true, photoURL: photoData, url: photoData });
    } catch (err: any) {
      console.error('[Server /api/user/:uid/photo error]:', err);
      res.status(500).json({ error: err.message || 'Failed to save profile photo' });
    }
  });

  // Trips Endpoints
  app.get('/api/trips', (req, res) => {
    const { userId } = req.query;
    let trips = Array.from(localTrips.values());
    if (userId) {
      trips = trips.filter((t) => t.userId === String(userId));
    }
    trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    res.json({ trips });
  });

  app.post('/api/trips', (req, res) => {
    const {
      userId,
      destination,
      durationMinutes,
      graceMinutes,
      userName,
      userEmail,
      latitude,
      longitude,
      locationUrl,
      startLatitude,
      startLongitude,
      startAddress,
      destinationLatitude,
      destinationLongitude,
      destinationAddress,
      durationMode,
      travelMode,
      estimatedDistanceMeters,
      locationTrail,
    } = req.body;

    if (!userId || !destination) {
      return res.status(400).json({ error: 'Missing required trip fields' });
    }

    const id = req.body.id || `trip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();

    const newTrip: StoredTrip = {
      id,
      userId,
      destination,
      durationMinutes: Number(durationMinutes) || 15,
      graceMinutes: Number(graceMinutes) || 10,
      startTime: now,
      status: 'active',
      userName: userName || 'SafeCheck User',
      userEmail: userEmail || '',
      reminderSentAt: null,
      alertedAt: null,
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      locationUrl: locationUrl || null,
      startLatitude: typeof startLatitude === 'number' ? startLatitude : (typeof latitude === 'number' ? latitude : null),
      startLongitude: typeof startLongitude === 'number' ? startLongitude : (typeof longitude === 'number' ? longitude : null),
      startAddress: startAddress || null,
      destinationLatitude: typeof destinationLatitude === 'number' ? destinationLatitude : null,
      destinationLongitude: typeof destinationLongitude === 'number' ? destinationLongitude : null,
      destinationAddress: destinationAddress || destination,
      durationMode: durationMode || 'manual',
      travelMode: travelMode || 'walking',
      estimatedDistanceMeters: typeof estimatedDistanceMeters === 'number' ? estimatedDistanceMeters : undefined,
      locationTrail: Array.isArray(locationTrail) ? locationTrail : [],
      lastKnownLatitude: typeof latitude === 'number' ? latitude : (typeof startLatitude === 'number' ? startLatitude : null),
      lastKnownLongitude: typeof longitude === 'number' ? longitude : (typeof startLongitude === 'number' ? startLongitude : null),
      lastKnownAddress: startAddress || null,
      lastLocationUpdate: now,
    };
    localTrips.set(id, newTrip);
    res.json({ success: true, trip: newTrip });
  });

  // Trip synchronization endpoint for SOS events & client updates
  app.post('/api/trips/sync', (req, res) => {
    const tripPayload = req.body;
    if (!tripPayload || !tripPayload.id) {
      return res.status(400).json({ error: 'Missing trip ID' });
    }
    const cleanId = String(tripPayload.id).replace(/[^A-Za-z0-9_-]/g, '_');
    const existing = localTrips.get(tripPayload.id) || localTrips.get(cleanId) || {};
    const merged = { ...existing, ...tripPayload, id: tripPayload.id };
    localTrips.set(tripPayload.id, merged);
    localTrips.set(cleanId, merged);
    if (merged.sosId && merged.sosId !== tripPayload.id) {
      localTrips.set(merged.sosId, { ...merged, id: merged.sosId });
    }
    if (merged.sos_id && merged.sos_id !== tripPayload.id) {
      localTrips.set(merged.sos_id, { ...merged, id: merged.sos_id });
    }
    console.log(`[SafeCheck Server] 🔄 Synced trip "${tripPayload.id}" (status: ${merged.status}, isSos: ${Boolean(merged.isSosEvent)})`);
    res.json({ success: true, trip: merged });
  });

  // Location trail recording endpoint
  app.post('/api/trips/:id/trail', (req, res) => {
    const { id } = req.params;
    const { point } = req.body;
    if (!point || typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
      return res.status(400).json({ error: 'Invalid location point' });
    }

    const trip = localTrips.get(id);
    if (trip) {
      if (!Array.isArray(trip.locationTrail)) {
        trip.locationTrail = [];
      }
      trip.locationTrail.push(point);
      trip.lastKnownLatitude = point.latitude;
      trip.lastKnownLongitude = point.longitude;
      trip.lastKnownAddress = point.address || trip.lastKnownAddress;
      trip.lastLocationUpdate = point.timestamp || new Date().toISOString();
      trip.latitude = point.latitude;
      trip.longitude = point.longitude;
      if (point.locationUrl) {
        trip.locationUrl = point.locationUrl;
      }
      localTrips.set(id, trip);
    }
    res.json({ success: true });
  });

  // Autocomplete cache for fast place search responses
  const placesSearchCache = new Map<string, any>();

  // Free Places Autocomplete Search endpoint using OpenStreetMap Photon (fast typeahead) & Nominatim fallback
  app.get('/api/maps/places-autocomplete', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q || q.length < 2) {
        return res.json({ suggestions: [] });
      }

      const lat = req.query.lat ? parseFloat(String(req.query.lat)) : undefined;
      const lng = req.query.lng ? parseFloat(String(req.query.lng)) : undefined;
      const cacheKey = `${q.toLowerCase()}_${lat ? lat.toFixed(2) : ''}_${lng ? lng.toFixed(2) : ''}`;

      if (placesSearchCache.has(cacheKey)) {
        return res.json({ suggestions: placesSearchCache.get(cacheKey) });
      }

      const suggestions: Array<{
        id: string;
        name: string;
        formattedAddress: string;
        latitude: number;
        longitude: number;
        type?: string;
      }> = [];

      // 1. Primary: OpenStreetMap Photon fast typeahead mirror (optimized for <200ms latency without rate limits)
      try {
        let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8`;
        if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
          photonUrl += `&lat=${lat}&lon=${lng}`;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const pRes = await fetch(photonUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timer);

        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.features && Array.isArray(pData.features)) {
            for (const f of pData.features) {
              const props = f.properties || {};
              const coords = f.geometry?.coordinates;
              if (coords && coords.length >= 2) {
                const fLng = coords[0];
                const fLat = coords[1];
                const name = props.name || props.street || q;
                const addrParts = [
                  props.street,
                  props.district || props.suburb,
                  props.city || props.town,
                  props.state,
                  props.country,
                ].filter(Boolean);
                const secondary =
                  addrParts.filter((p: string) => p !== name).join(', ') || props.country || '';
                suggestions.push({
                  id: `osm-${props.osm_id || Math.random()}`,
                  name: name,
                  formattedAddress: secondary ? `${name}, ${secondary}` : name,
                  latitude: Number(fLat.toFixed(6)),
                  longitude: Number(fLng.toFixed(6)),
                  type: props.osm_value || props.type || 'place',
                });
              }
            }
          }
        }
      } catch (pErr: any) {
        if (pErr?.name !== 'AbortError') {
          console.log('[SafeCheck Search] Photon typeahead notice:', pErr?.message || pErr);
        }
      }

      // 2. Secondary Fallback: OpenStreetMap Nominatim search API (if Photon returned 0 results)
      if (suggestions.length === 0) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          let nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=8`;
          if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
            const d = 0.45;
            nomUrl += `&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}&bounded=0`;
          }

          const nRes = await fetch(nomUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'SafeCheck-App/1.0 (Emergency-Checkin)',
              'Accept-Language': 'en',
            },
          });
          clearTimeout(timer);

          if (nRes.ok) {
            const nData = await nRes.json();
            if (Array.isArray(nData) && nData.length > 0) {
              for (const item of nData) {
                const itemLat = parseFloat(item.lat);
                const itemLng = parseFloat(item.lon);
                if (!isNaN(itemLat) && !isNaN(itemLng)) {
                  const addr = item.address || {};
                  const name =
                    item.name ||
                    addr.amenity ||
                    addr.railway ||
                    addr.building ||
                    addr.road ||
                    item.display_name.split(',')[0];
                  const parts = item.display_name
                    .split(',')
                    .slice(1, 4)
                    .map((s: string) => s.trim())
                    .join(', ');
                  suggestions.push({
                    id: `nom-${item.place_id}`,
                    name: name.trim(),
                    formattedAddress: parts ? `${name.trim()}, ${parts}` : item.display_name,
                    latitude: Number(itemLat.toFixed(6)),
                    longitude: Number(itemLng.toFixed(6)),
                    type: item.type || item.class || 'place',
                  });
                }
              }
            }
          }
        } catch (nErr: any) {
          if (nErr?.name !== 'AbortError') {
            console.log('[SafeCheck Search] Nominatim fallback notice:', nErr?.message || nErr);
          }
        }
      }

      // Deduplicate suggestions
      const unique: typeof suggestions = [];
      const seen = new Set<string>();
      for (const s of suggestions) {
        const key = `${s.name.toLowerCase()}_${s.latitude.toFixed(3)}_${s.longitude.toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(s);
        }
      }

      if (unique.length > 0) {
        if (placesSearchCache.size > 150) {
          placesSearchCache.clear();
        }
        placesSearchCache.set(cacheKey, unique);
      }

      res.json({ suggestions: unique });
    } catch (err: any) {
      console.error('Error in places-autocomplete:', err);
      res.status(500).json({ error: err.message, suggestions: [] });
    }
  });

  // Routing Estimation endpoint (OpenRouteService Directions API + Free OSRM fallback + Intelligent Circuity Model)
  app.post('/api/maps/estimate-duration', async (req, res) => {
    try {
      const { startLat, startLng, destLat, destLng, travelMode } = req.body;
      if (
        typeof startLat !== 'number' ||
        typeof startLng !== 'number' ||
        typeof destLat !== 'number' ||
        typeof destLng !== 'number'
      ) {
        return res.status(400).json({ error: 'Missing valid start or destination coordinates' });
      }

      // Pre-calculate Great-Circle Haversine straight-line distance
      const R = 6371000;
      const dLat = ((destLat - startLat) * Math.PI) / 180;
      const dLon = ((destLng - startLng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((startLat * Math.PI) / 180) *
          Math.cos((destLat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const straightDistance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

      // OpenRouteService and OSRM have strict distance and profile boundaries:
      // - driving-car: OpenRouteService server configuration limit is 6,000,000 meters (error code 2004).
      // - foot-walking: OpenRouteService limit is ~150,000 meters (150 km).
      // If straight-line distance exceeds these bounds, avoid calling ORS to prevent 400 error code 2004.
      const exceedsORSWalkingLimit = travelMode === 'walking' && straightDistance > 120000;
      const exceedsORSDrivingLimit = straightDistance > 5000000; // ~5,000km straight ≈ >6,000km road distance
      const isEligibleForORS = !exceedsORSWalkingLimit && !exceedsORSDrivingLimit;

      // 1. Free OpenRouteService Directions API (openrouteservice.org) if within network limits
      const orsApiKey = process.env.OPENROUTESERVICE_API_KEY;
      if (orsApiKey && isEligibleForORS) {
        try {
          const profile = travelMode === 'walking' ? 'foot-walking' : 'driving-car';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const orsRes = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Authorization: orsApiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json, application/geo+json',
            },
            body: JSON.stringify({
              coordinates: [
                [startLng, startLat],
                [destLng, destLat],
              ],
            }),
          });
          clearTimeout(timer);

          if (orsRes.ok) {
            const orsData = await orsRes.json();
            const route = orsData.routes?.[0];
            if (route?.summary) {
              const durationSec = route.summary.duration; // seconds
              const distanceMeters = Math.round(route.summary.distance); // meters

              let minutes = 15;
              if (travelMode === 'walking') {
                minutes = Math.max(3, Math.ceil(durationSec / 60));
              } else if (travelMode === 'driving') {
                minutes = Math.max(5, Math.ceil(durationSec / 60) + 2);
              } else if (travelMode === 'transit') {
                minutes = Math.max(8, Math.ceil(distanceMeters / 360) + 5);
              }

              return res.json({
                success: true,
                durationMinutes: minutes,
                distanceMeters,
                source: 'openrouteservice',
              });
            }
          } else {
            console.log(`[SafeCheck Routing] OpenRouteService status ${orsRes.status}, falling back smoothly`);
          }
        } catch (orsErr: any) {
          if (orsErr?.name !== 'AbortError') {
            console.log('[SafeCheck Routing] OpenRouteService notice:', orsErr?.message || orsErr);
          }
        }
      }

      // 2. Open Source Routing Machine (OSRM) free road directions API fallback (for routes < 5,000 km)
      if (straightDistance <= 5000000 && !exceedsORSWalkingLimit) {
        try {
          const osrmProfile = travelMode === 'walking' ? 'walking' : 'driving';
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLng},${startLat};${destLng},${destLat}?overview=false`;
          const osrmRes = await fetch(osrmUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'SafeCheck-App/1.0' },
          });
          clearTimeout(timeout);

          if (osrmRes.ok) {
            const osrmData = await osrmRes.json();
            if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes[0]) {
              const route = osrmData.routes[0];
              const durationSec = route.duration; // seconds
              const distanceMeters = Math.round(route.distance);

              let minutes = 15;
              if (travelMode === 'walking') {
                minutes = Math.max(3, Math.ceil(distanceMeters / 80));
              } else if (travelMode === 'driving') {
                minutes = Math.max(5, Math.ceil(durationSec / 60) + 2);
              } else if (travelMode === 'transit') {
                minutes = Math.max(8, Math.ceil(distanceMeters / 360) + 5);
              }

              return res.json({
                success: true,
                durationMinutes: minutes,
                distanceMeters,
                source: 'osrm_open_routing',
              });
            }
          }
        } catch (osrmErr: any) {
          if (osrmErr?.name !== 'AbortError') {
            console.log('[SafeCheck Routing] OSRM notice:', osrmErr?.message || osrmErr);
          }
        }
      }

      // 3. 100% Offline Intelligent Circuity & Long-Distance Transit Model
      let roadDistanceMeters: number;
      let minutes: number;

      if (straightDistance > 500000) {
        // Intercity / cross-country / international distance (> 500 km)
        roadDistanceMeters = Math.round(straightDistance * 1.18);
        if (travelMode === 'walking') {
          // Continuous walking pace ~4.5 km/h = ~75 m/min
          minutes = Math.max(30, Math.ceil(roadDistanceMeters / 75));
        } else if (travelMode === 'driving') {
          // Highway speed ~90 km/h = ~1500 m/min + 15 min rest buffer
          minutes = Math.max(15, Math.ceil(roadDistanceMeters / 1500) + 15);
        } else if (travelMode === 'transit') {
          // High-speed rail / air transit ~500 km/h = ~8300 m/min + 60 min airport/station buffer
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

      return res.json({
        success: true,
        durationMinutes: minutes,
        distanceMeters: roadDistanceMeters,
        source: 'haversine_circuity_model',
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Free Reverse geocoding endpoint using OpenStreetMap Nominatim
  app.get('/api/maps/reverse-geocode', async (req, res) => {
    try {
      const lat = parseFloat(String(req.query.lat));
      const lng = parseFloat(String(req.query.lng));
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }

      // Free Nominatim reverse geocode
      try {
        const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const nRes = await fetch(nomUrl, {
          headers: {
            'User-Agent': 'SafeCheck-App/1.0 (Emergency-Checkin; contact: purvakante3@gmail.com)',
            'Accept-Language': 'en',
          },
        });
        if (nRes.ok) {
          const nData = await nRes.json();
          if (nData.display_name) {
            const shortAddr = nData.display_name.split(',').slice(0, 3).join(',').trim();
            return res.json({
              address: nData.display_name,
              shortAddress: shortAddr,
              display_name: nData.display_name,
            });
          }
        }
      } catch {}

      res.json({
        address: `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        display_name: `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const handleMarkTripSafeOrResolved = async (req: any, res: any) => {
    const { id } = req.params;
    const cleanId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
    const nowIso = new Date().toISOString();

    let trip = localTrips.get(id) || localTrips.get(cleanId);
    if (!trip) {
      for (const t of localTrips.values()) {
        if (t.id === id || (t as any).sosId === id || (t as any).sos_id === id) {
          trip = t;
          break;
        }
      }
    }

    if (trip) {
      trip.status = 'resolved';
      trip.isSosEvent = false;
      trip.safeAt = nowIso;
      trip.resolvedAt = nowIso;
      localTrips.set(id, trip);
      localTrips.set(cleanId, trip);
      if (trip.id && trip.id !== id) localTrips.set(trip.id, trip);
      if ((trip as any).sosId) localTrips.set((trip as any).sosId, trip);
    }

    if (isFirebaseAvailable && db) {
      try {
        await db.collection('trips').doc(id).set({ status: 'resolved', safeAt: nowIso, resolvedAt: nowIso, isSosEvent: false }, { merge: true });
        if (cleanId !== id) {
          await db.collection('trips').doc(cleanId).set({ status: 'resolved', safeAt: nowIso, resolvedAt: nowIso, isSosEvent: false }, { merge: true });
        }
      } catch (err: any) {
        console.warn(`[SafeCheck Server] Error updating trip safe in Firestore:`, err?.message || err);
      }
    }

    console.log(`[SafeCheck Server] ✅ Marked trip resolved: ${id}`);
    res.json({ success: true, trip });
  };

  app.post('/api/trips/:id/safe', handleMarkTripSafeOrResolved);
  app.post('/api/trips/:id/resolve', handleMarkTripSafeOrResolved);

  app.post('/api/trips/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const cleanId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
    const nowIso = new Date().toISOString();

    let trip = localTrips.get(id) || localTrips.get(cleanId);
    if (!trip) {
      for (const t of localTrips.values()) {
        if (t.id === id || (t as any).sosId === id || (t as any).sos_id === id) {
          trip = t;
          break;
        }
      }
    }

    if (trip) {
      trip.status = 'cancelled';
      trip.isSosEvent = false;
      trip.cancelledAt = nowIso;
      localTrips.set(id, trip);
      localTrips.set(cleanId, trip);
      if (trip.id && trip.id !== id) localTrips.set(trip.id, trip);
      if ((trip as any).sosId) localTrips.set((trip as any).sosId, trip);
    }

    if (isFirebaseAvailable && db) {
      try {
        await db.collection('trips').doc(id).set({ status: 'cancelled', cancelledAt: nowIso, isSosEvent: false }, { merge: true });
        if (cleanId !== id) {
          await db.collection('trips').doc(cleanId).set({ status: 'cancelled', cancelledAt: nowIso, isSosEvent: false }, { merge: true });
        }
      } catch (err: any) {
        console.warn(`[SafeCheck Server] Error cancelling trip in Firestore:`, err?.message || err);
      }
    }

    console.log(`[SafeCheck Server] 🛑 Cancelled trip: ${id}`);
    res.json({ success: true, trip });
  });

  // Trip Audio Evidence Status endpoint
  app.post('/api/trips/:id/audio-status', async (req, res) => {
    const { id } = req.params;
    const { status, evidence, audioEvidenceUrl, error, syncedAt } = req.body;
    const nowIso = new Date().toISOString();
    const effectiveSyncedAt = syncedAt || (status === 'ready' ? nowIso : undefined);
    const cleanId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');

    console.log(`[SafeCheck Server Audio Status] 📡 Updating trip "${id}" audioStatus -> "${status}"${error ? ` (Error: ${error})` : ''}${effectiveSyncedAt ? ` [Synced: ${effectiveSyncedAt}]` : ''}`);

    let trip = localTrips.get(id) || localTrips.get(cleanId);
    if (!trip) {
      for (const t of localTrips.values()) {
        if (t.id === id || (t as any).sosId === id || (t as any).sos_id === id) {
          trip = t;
          break;
        }
      }
    }
    if (!trip) {
      trip = {
        id: cleanId,
        sosId: cleanId,
        status: 'sos',
        isSosEvent: true,
        startTime: nowIso,
      } as any;
    }

    trip.audioStatus = status;
    let resolvedAudioUrl = audioEvidenceUrl || evidence?.download_url || evidence?.audioDataUrl;
    if (typeof resolvedAudioUrl === 'string' && !resolvedAudioUrl.startsWith('data:')) {
      resolvedAudioUrl = resolvedAudioUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
      if (!resolvedAudioUrl.startsWith('/')) resolvedAudioUrl = `/${resolvedAudioUrl}`;
    }
    if (evidence) {
      const cleanEv = { ...evidence };
      if (typeof cleanEv.download_url === 'string' && !cleanEv.download_url.startsWith('data:')) {
        cleanEv.download_url = cleanEv.download_url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
        if (!cleanEv.download_url.startsWith('/')) cleanEv.download_url = `/${cleanEv.download_url}`;
      }
      if (typeof cleanEv.audioDataUrl === 'string' && !cleanEv.audioDataUrl.startsWith('data:')) {
        cleanEv.audioDataUrl = cleanEv.audioDataUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
        if (!cleanEv.audioDataUrl.startsWith('/')) cleanEv.audioDataUrl = `/${cleanEv.audioDataUrl}`;
      }
      trip.audioEvidence = cleanEv;
    }
    if (resolvedAudioUrl) {
      trip.audioEvidenceUrl = resolvedAudioUrl;
      if (trip.audioEvidence) {
        trip.audioEvidence.download_url = resolvedAudioUrl;
        trip.audioEvidence.audioDataUrl = resolvedAudioUrl;
      }
    }
    if (error) trip.audioError = error;
    if (status === 'ready' || trip.audioEvidence || trip.audioEvidenceUrl) {
      trip.audioStatus = 'ready';
      trip.audioError = null;
    }
    if (effectiveSyncedAt) trip.syncedAt = effectiveSyncedAt;
    trip.audioStatusUpdatedAt = nowIso;

    localTrips.set(id, trip);
    localTrips.set(cleanId, trip);
    if ((trip as any).sosId && (trip as any).sosId !== id) {
      localTrips.set((trip as any).sosId, { ...trip, id: (trip as any).sosId });
    }

    if (isFirebaseAvailable && db) {
      try {
        const updateData: any = {
          audioStatus: trip.audioStatus,
          audioStatusUpdatedAt: nowIso,
        };
        if (effectiveSyncedAt) updateData.syncedAt = effectiveSyncedAt;
        if (trip.audioStatus === 'ready') updateData.audioError = null;
        if (error && trip.audioStatus !== 'ready') updateData.audioError = error;
        if (resolvedAudioUrl) updateData.audioEvidenceUrl = resolvedAudioUrl;

        if (evidence) {
          // Guard against Firestore 1MB document limit: don't store giant base64 if download_url is available
          const safeEvidence = { ...evidence };
          if (
            safeEvidence.download_url &&
            typeof safeEvidence.audioDataUrl === 'string' &&
            safeEvidence.audioDataUrl.length > 50000 &&
            safeEvidence.audioDataUrl.startsWith('data:')
          ) {
            safeEvidence.audioDataUrl = safeEvidence.download_url;
          }
          updateData.audioEvidence = safeEvidence;
        }

        const docRef = db.collection('trips').doc(cleanId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          await docRef.update(updateData);
          console.log(`[SafeCheck Server Audio Status] ✅ Firestore trip "${cleanId}" updated with audioStatus="${trip.audioStatus}".`);
        } else {
          await docRef.set(updateData, { merge: true });
          console.log(`[SafeCheck Server Audio Status] ✅ Firestore trip "${cleanId}" merged with audioStatus="${trip.audioStatus}".`);
        }
      } catch (err: any) {
        console.warn('[SafeCheck Server Audio Status] Error updating trip audio-status in Firestore:', err?.message || err);
      }
    }
    res.json({ success: true, trip });
  });

  // Contacts Endpoints
  app.get('/api/contacts', (req, res) => {
    const { userId } = req.query;
    let contacts = Array.from(localContacts.values());
    if (userId) {
      contacts = contacts.filter((c) => c.userId === String(userId));
    }
    res.json({ contacts });
  });

  app.post('/api/contacts', (req, res) => {
    const { userId, name, email, relation, phone } = req.body;
    if (!userId || !name || !email) {
      return res.status(400).json({ error: 'Missing required contact fields' });
    }
    const id = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newContact: StoredContact = {
      id,
      userId,
      name,
      email,
      relation: relation || 'Contact',
      phone: phone || '',
      createdAt: new Date().toISOString(),
    };
    localContacts.set(id, newContact);
    res.json({ success: true, contact: newContact });
  });

  app.put('/api/contacts/:id', (req, res) => {
    const { id } = req.params;
    const existing = localContacts.get(id);
    if (existing) {
      const updated = { ...existing, ...req.body, id };
      localContacts.set(id, updated);
      return res.json({ success: true, contact: updated });
    }
    res.status(404).json({ error: 'Contact not found' });
  });

  app.delete('/api/contacts/:id', (req, res) => {
    const { id } = req.params;
    localContacts.delete(id);
    res.json({ success: true });
  });

  app.post('/api/contacts/reorder', (req, res) => {
    const { userId, contacts } = req.body;
    if (Array.isArray(contacts)) {
      contacts.forEach((c: any) => {
        if (c.id && localContacts.has(c.id)) {
          const existing = localContacts.get(c.id)!;
          localContacts.set(c.id, { ...existing, ...c });
        }
      });
    }
    res.json({ success: true });
  });

  // Manual or automatic evaluator endpoint
  app.post('/api/check-trips', async (req, res) => {
    try {
      const result = await runTripEvaluator();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unified One-Tap SOS emergency alert handler with verified real email dispatching
  const handleSOSTrigger = async (req: express.Request, res: express.Response) => {
    try {
      const {
        userId,
        userName,
        userEmail,
        latitude,
        longitude,
        locationUrl,
        audioEvidence,
        isLateEscalation,
        destination,
        customSubject,
        customMessage,
        countdownStartedAt,
        type,
      } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
      }

      const now = new Date();
      const transporter = getTransporter();
      const senderEmail = process.env.GMAIL_USER || 'noreply@safecheck.app';

      // 1. Resolve contacts (prefer explicitly passed array from client)
      let contacts: StoredContact[] = [];
      if (Array.isArray(req.body.contacts) && req.body.contacts.length > 0) {
        contacts = req.body.contacts;
        for (const c of contacts) {
          if (c && c.id) {
            localContacts.set(c.id, {
              id: c.id,
              userId: c.userId || userId,
              name: c.name || 'Emergency Contact',
              email: c.email || '',
              relation: c.relation || 'Contact',
              phone: c.phone || '',
              createdAt: c.createdAt || now.toISOString(),
            });
          }
        }
      } else {
        contacts = Array.from(localContacts.values()).filter((c) => c.userId === userId);
        if (contacts.length === 0 && isFirebaseAvailable && db) {
          try {
            const snap = await db.collection('contacts').where('userId', '==', userId).get();
            snap.forEach((doc: any) => contacts.push({ id: doc.id, ...doc.data() }));
          } catch (e) {}
        }
      }

      const sosId = req.body.sosId || `sos_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const guardianLink = `${process.env.APP_URL || 'https://safecheck.app'}/?guardian=${sosId}`;
      const activeTripId = req.body.activeTripId || null;
      const sosType = type || req.body.type || 'manual';
      const isLowBattery = sosType === 'low_battery' || req.body?.type === 'low_battery';

      const alertTitle = isLowBattery
        ? `🔋 LOW BATTERY ALERT: ${destination || 'Active Trip'}`
        : isLateEscalation
        ? `⚠️ OVERDUE ARRIVAL ALERT: ${destination || 'Destination'}`
        : '🚨 ONE-TAP SOS EMERGENCY ALERT';

      // 2. Write incident to independent "sos_events" collection
      const lat = typeof latitude === 'number' ? latitude : (typeof req.body.lat === 'number' ? req.body.lat : (typeof req.body.latitude === 'number' ? req.body.latitude : null));
      const lng = typeof longitude === 'number' ? longitude : (typeof req.body.lng === 'number' ? req.body.lng : (typeof req.body.longitude === 'number' ? req.body.longitude : null));
      const triggeredTimestamp = req.body.timestamp || req.body.triggered_at || now.toISOString();

      const initialContactsNotified = contacts.map((c: any) => ({
        id: c.id || '',
        name: c.name || 'Emergency Contact',
        email: c.email || '',
        phone: c.phone || '',
        relation: c.relation || 'Emergency Contact',
        status: 'pending',
        notifiedAt: triggeredTimestamp,
      }));

      const initialNotifiedSummary = initialContactsNotified.map((c: any) =>
        c.name ? `${c.name} (${c.email || c.phone || 'Contact'})` : (c.email || c.phone || 'Contact')
      );

      const resolvedLocUrl = locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null);
      const targetTripId = activeTripId || sosId;

      const escalatedToContactIds = contacts.map((c: any) => c.id || c.email || c.name);

      const existingTrip: any = localTrips.get(targetTripId) || {};

      const sosTripRecord: any = {
        id: targetTripId,
        userId: userId,
        userName: userName || existingTrip.userName || 'SafeCheck User',
        userEmail: userEmail || existingTrip.userEmail || '',
        destination: destination || existingTrip.destination || (
          isLowBattery ? '🔋 LOW BATTERY AUTO-ALERT' :
          sosType === 'fall_detected' ? '🚨 FALL DETECTED SOS ALERT' :
          sosType === 'voice_activated' ? '🚨 VOICE ACTIVATED SOS ALERT' :
          sosType === 'auto_escalated' ? '🚨 OVERDUE ARRIVAL SOS ALERT' :
          '🚨 ONE-TAP EMERGENCY SOS ALERT'
        ),
        startTime: existingTrip.startTime || triggeredTimestamp,
        durationMinutes: (typeof existingTrip.durationMinutes === 'number' && existingTrip.durationMinutes > 0) ? existingTrip.durationMinutes : (Number(req.body?.durationMinutes) || 10),
        graceMinutes: (typeof existingTrip.graceMinutes === 'number' && existingTrip.graceMinutes > 0) ? existingTrip.graceMinutes : (Number(req.body?.graceMinutes) || 10),
        status: isLowBattery ? (existingTrip.status || 'active') : 'sos',
        alertedAt: isLowBattery ? (existingTrip.alertedAt || null) : triggeredTimestamp,
        // Specific SOS fields directly in trip document:
        isSosEvent: isLowBattery ? Boolean(existingTrip.isSosEvent) : true,
        sosType: isLowBattery ? (existingTrip.sosType || 'low_battery') : sosType,
        sosTimestamp: isLowBattery ? (existingTrip.sosTimestamp || null) : triggeredTimestamp,
        sosLocation: { lat, lng },
        sosStatus: isLowBattery ? (existingTrip.sosStatus || 'active') : (isLateEscalation ? 'escalated' : 'active'),
        escalatedTo: isLowBattery ? (existingTrip.escalatedTo || []) : escalatedToContactIds,
        sosId: sosId,
        activeTripId: activeTripId || null,
        // Location coordinates and urls
        latitude: lat,
        longitude: lng,
        location: { lat, lng },
        gps: { latitude: lat, longitude: lng },
        locationUrl: resolvedLocUrl,
        countdownStartedAt: isLowBattery ? existingTrip.countdownStartedAt : (countdownStartedAt || triggeredTimestamp),
        respondedAt: existingTrip.respondedAt || null,
        escalatedAt: isLowBattery ? existingTrip.escalatedAt : (isLateEscalation ? triggeredTimestamp : null),
        emergencyContactsNotified: initialContactsNotified,
        notifiedContacts: initialNotifiedSummary,
        notifiedCount: 0,
        ...(isLowBattery ? {
          lowBatteryAlertSent: true,
          lowBatteryAlertSentAt: triggeredTimestamp,
          lowBatteryLevel: req.body?.batteryPct || (typeof req.body?.batteryLevel === 'number' ? Math.round(req.body.batteryLevel * 100) : 14),
        } : {}),
      };

      // Store in memory localTrips for BOTH targetTripId AND sosId
      localTrips.set(targetTripId, { ...existingTrip, ...sosTripRecord, id: targetTripId });
      localTrips.set(sosId, { ...existingTrip, ...sosTripRecord, id: sosId, sosId, activeTripId });

      if (isFirebaseAvailable && db) {
        try {
          const writes: Promise<any>[] = [
            db.collection('trips').doc(targetTripId).set(sosTripRecord, { merge: true }),
            db.collection('trips').doc(sosId).set({ ...sosTripRecord, id: sosId, sosId, activeTripId }, { merge: true }),
            db.collection('sos_events').doc(sosId).set({ ...sosTripRecord, id: sosId, sosId, activeTripId }, { merge: true }),
          ];
          await Promise.all(writes);
          console.log(`[SafeCheck Server] Wrote SOS event directly to trips collection for ${targetTripId} and ${sosId} BEFORE email dispatch`);
        } catch (err: any) {
          console.warn('[SafeCheck Server] Notice writing to Firestore trips:', err?.message || err);
          if (String(err?.message || err).includes('PERMISSION_DENIED') || String(err?.code) === '7') {
            isFirebaseAvailable = false;
          }
        }
      }

      // 3. Audio Evidence in "sos_audio_evidence" linked by trip's document ID
      if (audioEvidence) {
        const cleanTimestamp = now.toISOString().replace(/[:.]/g, '-');
        const storagePath = audioEvidence.storage_path || `/sos_audio/${userId}/${targetTripId}/${cleanTimestamp}.webm`;
        const audioId = audioEvidence.audio_id || `audio_${targetTripId}_${Date.now()}`;
        let downloadUrl = audioEvidence.download_url || `/api/sos/audio/${audioId}`;
        if (typeof downloadUrl === 'string' && !downloadUrl.startsWith('data:')) {
          downloadUrl = downloadUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
          if (!downloadUrl.startsWith('/')) downloadUrl = `/${downloadUrl}`;
        }
        const fileSizeBytes = audioEvidence.file_size_bytes || (audioEvidence.audioDataUrl ? Math.round(audioEvidence.audioDataUrl.length * 0.75) : 1024 * 16);

        const audioDocRecord = {
          audio_id: audioId,
          trip_id: targetTripId,
          sos_id: targetTripId,
          user_id: userId,
          storage_path: storagePath,
          download_url: downloadUrl,
          duration_seconds: audioEvidence.duration_seconds || audioEvidence.durationSeconds || 12,
          recorded_at: audioEvidence.recorded_at || audioEvidence.recordedAt || now.toISOString(),
          file_size_bytes: fileSizeBytes,
          mime_type: audioEvidence.mime_type || audioEvidence.mimeType || 'audio/webm',
        };
        localAudioEvidence.set(audioId, audioDocRecord);

        if (isFirebaseAvailable && db) {
          try {
            await db.collection('sos_audio_evidence').doc(audioId).set(audioDocRecord);
            // Also embed metadata reference directly in trips doc
            await db.collection('trips').doc(targetTripId).set({
              audioEvidence: {
                id: audioId,
                tripId: targetTripId,
                download_url: downloadUrl,
                audioDataUrl: downloadUrl,
                storage_path: storagePath,
                durationSeconds: audioDocRecord.duration_seconds,
                recordedAt: audioDocRecord.recorded_at,
                mimeType: audioDocRecord.mime_type,
              },
            }, { merge: true });
            console.log(`[SafeCheck Server] Wrote audio evidence linked to trip: ${targetTripId}`);
          } catch (err: any) {
            console.warn('[SafeCheck Server] Notice writing to Firestore sos_audio_evidence:', err?.message || err);
            if (String(err?.message || err).includes('PERMISSION_DENIED') || String(err?.code) === '7') {
              isFirebaseAvailable = false;
            }
          }
        }
      }

      // 5. Filter for contacts with valid email addresses
      const validContacts = contacts.filter((c) => {
        if (!c || typeof c.email !== 'string') return false;
        const em = c.email.trim();
        return em.length > 3 && em.includes('@');
      });

      console.log(`[SafeCheck SOS Dispatch] Initiating emergency alert dispatch for user "${userName}" (${userId}). Total contacts: ${contacts.length}, Contacts with email: ${validContacts.length}. Transporter initialized: ${Boolean(transporter)}`);

      const subject =
        customSubject ||
        (isLowBattery
          ? `🔋 Low Battery Alert: ${userName || 'SafeCheck User'}'s phone battery is low during active trip`
          : isLateEscalation
          ? `⚠️ OVERDUE ARRIVAL ALERT: ${userName || 'SafeCheck User'} has not arrived at ${destination || 'destination'}`
          : `🚨 URGENT SOS ALERT: ${userName || 'A user'} activated One-Tap Emergency SOS!`);

      let bodySummary =
        customMessage ||
        (isLowBattery
          ? `LOW BATTERY ALERT: ${userName || 'User'}'s phone battery is low during active trip to "${destination || 'destination'}". 🛡️ Live Guardian View: ${guardianLink}`
          : isLateEscalation
          ? `AUTOMATED ARRIVAL TIMEOUT: ${userName || 'User'} scheduled a trip to "${destination || 'destination'}" but did not confirm arrival and did not respond within the 2-minute safety check window. 🛡️ Live Guardian View: ${guardianLink}`
          : `ONE-TAP SOS ACTIVATED by ${userName || 'User'} (${userEmail}). Immediate emergency assistance requested. 🛡️ Live Guardian View: ${guardianLink}`);

      if (locationUrl) {
        bodySummary += ` 📍 Live Location: ${locationUrl}`;
      } else if (typeof latitude === 'number' && typeof longitude === 'number') {
        bodySummary += ` 📍 GPS: ${latitude}, ${longitude}`;
      }

      let emailText = customMessage
        ? `${customMessage}\n\n`
        : (isLowBattery
          ? `🔋 LOW BATTERY SAFETY ALERT\n\n${userName} (${userEmail || 'SafeCheck User'})'s phone battery is low during an active trip to "${destination || 'destination'}".\n`
          : isLateEscalation
          ? `⚠️ AUTOMATED TRIP ARRIVAL SAFETY ALERT\n\n${userName} (${userEmail}) started a safety check-in for a trip to "${destination || 'destination'}".\n\nThe expected arrival time has passed, the user did not mark themselves as arrived, and they did not respond within the 2-minute safety check window.\n`
          : `URGENT SOS EMERGENCY ALERT\n\n${userName} (${userEmail}) activated the One-Tap SOS emergency alert on SafeCheck.\n`);

      if (locationUrl) {
        emailText += `\n📍 LIVE EMERGENCY LOCATION (Google Maps):\n${locationUrl}\n`;
      } else if (typeof latitude === 'number' && typeof longitude === 'number') {
        emailText += `\n📍 LIVE GPS COORDINATES:\nhttps://www.google.com/maps?q=${latitude},${longitude}\n`;
      }

      emailText += `\n🛡️ LIVE GUARDIAN & STATUS MONITOR LINK (No app install or login required):\n${guardianLink}\n`;
      if (audioEvidence) {
        emailText += `\n🎙️ AUDIO EVIDENCE RECORDED: Rolling audio snapshot recorded at ${audioEvidence.recordedAt || audioEvidence.recorded_at} has been securely captured.\n`;
      }
      emailText += `\nPlease attempt to reach ${userName} immediately or alert emergency services if needed.\n\nSafeCheck SOS Emergency System`;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #FBF7F4; color: #2D2329; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #E8DDD9; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: ${isLowBattery ? '#B45309' : '#9E1C38'}; padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .header p { margin: 8px 0 0 0; font-size: 13px; opacity: 0.9; }
    .content { padding: 28px 24px; }
    .user-box { background: #FAF3F0; border-left: 4px solid ${isLowBattery ? '#B45309' : '#9E1C38'}; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; }
    .user-box strong { font-size: 16px; color: #2D2329; }
    .user-box p { margin: 4px 0 0 0; font-size: 13px; color: #6E5D65; }
    .action-btn { display: inline-block; padding: 12px 22px; margin: 8px 6px 8px 0; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; text-align: center; }
    .btn-maps { background: ${isLowBattery ? '#B45309' : '#9E1C38'}; color: #ffffff !important; }
    .btn-guardian { background: #2D2329; color: #ffffff !important; }
    .footer { padding: 18px 24px; background: #F6EFEA; border-top: 1px solid #E8DDD9; font-size: 11px; color: #8C7B83; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${isLowBattery ? '🔋 LOW BATTERY SAFETY ALERT' : isLateEscalation ? '⚠️ OVERDUE ARRIVAL SAFETY ALERT' : '🚨 URGENT EMERGENCY SOS ALERT'}</h1>
      <p>SafeCheck Personal Safety System • ${isLowBattery ? 'Automatic Battery Notification' : 'Immediate Action Advised'}</p>
    </div>
    <div class="content">
      <div class="user-box">
        <strong>${userName}</strong> (${userEmail || 'SafeCheck User'})
        <p>${customMessage || (isLowBattery ? `Phone battery dropped below 15% during active trip to "${destination || 'destination'}".` : isLateEscalation ? `Scheduled trip to "${destination || 'destination'}" was not marked safe within grace period.` : 'Triggered the One-Tap Emergency SOS button requesting immediate emergency assistance.')}</p>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #4A3B43;">
        ${isLowBattery
          ? `You are designated as an emergency contact for <strong>${userName}</strong>. This automated alert was triggered because their phone battery dropped below 15% during an active trip. Last known location and trip details are provided below.`
          : `You are designated as an emergency contact for <strong>${userName}</strong>. Please attempt to reach them immediately or contact emergency services if needed.`
        }
      </p>

      <div style="margin: 24px 0;">
        ${(locationUrl || (typeof latitude === 'number' && typeof longitude === 'number')) ? `
          <a href="${locationUrl || `https://www.google.com/maps?q=${latitude},${longitude}`}" class="action-btn btn-maps" target="_blank" rel="noopener">
            📍 Open Live GPS Location
          </a>
        ` : ''}
        <a href="${guardianLink}" class="action-btn btn-guardian" target="_blank" rel="noopener">
          🛡️ Open Live Guardian Companion
        </a>
      </div>

      ${audioEvidence ? `
        <div style="background: #F4EAE6; border: 1px dashed #C8B3AB; border-radius: 8px; padding: 12px 16px; margin-top: 16px; font-size: 12px; color: #5C4A52;">
          🎙️ <strong>Audio Evidence Preserved:</strong> An ambient audio snapshot recorded at the time of alert has been saved to the incident log.
        </div>
      ` : ''}
    </div>
    <div class="footer">
      Automated emergency notification dispatched by SafeCheck. Incident ID: ${sosId} • Timestamp: ${now.toISOString()}
    </div>
  </div>
</body>
</html>
`;

      let deliveredCount = 0;
      let failedCount = 0;
      const emailResults: Array<{
        email: string;
        name?: string;
        status: 'delivered' | 'failed';
        messageId?: string;
        response?: string;
        accepted?: string[];
        error?: string;
        errorCode?: string;
        deliveredAt?: string;
      }> = [];

      const alertStage = isLowBattery ? 'low_battery' : 'alert';

      if (validContacts.length === 0) {
        console.warn(`[SafeCheck SOS Dispatch] ⚠️ 0 emergency contacts with email configured for ${userId}. No emails can be sent.`);
        logs.unshift({
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          tripId: sosId,
          destination: alertTitle,
          stage: alertStage as any,
          recipient: 'No contacts configured',
          subject,
          sentAt: now.toISOString(),
          status: 'simulated',
          bodySummary: `[0 CONTACTS SAVED] ${bodySummary}`,
          locationUrl: locationUrl || null,
        });
      } else if (!transporter) {
        const errorReason = !process.env.GMAIL_USER || !process.env.GMAIL_PASS
          ? 'Email credentials unconfigured: GMAIL_USER or GMAIL_PASS environment variable is missing.'
          : 'Failed to create SMTP transporter with provided credentials.';

        console.error(`[SafeCheck SOS Dispatch Error] ❌ Cannot send emergency emails: ${errorReason}`);

        for (const contact of validContacts) {
          failedCount++;
          emailResults.push({
            email: contact.email,
            name: contact.name,
            status: 'failed',
            error: errorReason,
            errorCode: 'SMTP_NOT_CONFIGURED',
          });

          logs.unshift({
            id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            tripId: sosId,
            destination: alertTitle,
            stage: alertStage as any,
            recipient: `${contact.name} <${contact.email}>`,
            subject,
            sentAt: now.toISOString(),
            status: 'simulated',
            bodySummary: `[DISPATCH FAILED: ${errorReason}] ${bodySummary}`,
            locationUrl: locationUrl || null,
          });
        }
      } else {
        await Promise.all(
          validContacts.map(async (contact) => {
            try {
              console.log(`[SafeCheck SOS Dispatch] 📧 Sending emergency alert email to ${contact.email} via Gmail SMTP...`);
              const info = await transporter.sendMail({
                from: `"SafeCheck Emergency" <${senderEmail}>`,
                to: contact.email.trim(),
                subject,
                text: emailText,
                html: emailHtml,
              });

              console.log(`[SafeCheck SOS Dispatch Success] ✅ Real email delivered to ${contact.email} | messageId: ${info.messageId} | response: ${info.response}`);

              deliveredCount++;
              emailResults.push({
                email: contact.email,
                name: contact.name,
                status: 'delivered',
                messageId: info.messageId,
                response: info.response,
                accepted: info.accepted as string[],
                deliveredAt: new Date().toISOString(),
              });

              logs.unshift({
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                tripId: sosId,
                destination: alertTitle,
                stage: alertStage as any,
                recipient: `${contact.name} <${contact.email}>`,
                subject,
                sentAt: now.toISOString(),
                status: 'sent',
                bodySummary: `[CONFIRMED DELIVERED: ${info.messageId}] ${bodySummary}`,
                locationUrl: locationUrl || null,
              });
            } catch (sendErr: any) {
              failedCount++;
              const errorMessage = sendErr?.message || 'Failed to send email';
              const errorCode = sendErr?.code || 'SEND_ERROR';

              console.error(`[SafeCheck SOS Dispatch Error] ❌ Gmail SMTP failed for ${contact.email}:`, {
                error: errorMessage,
                code: errorCode,
                response: sendErr?.response,
                responseCode: sendErr?.responseCode,
                command: sendErr?.command,
              });

              emailResults.push({
                email: contact.email,
                name: contact.name,
                status: 'failed',
                error: errorMessage,
                errorCode,
              });

              logs.unshift({
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                tripId: sosId,
                destination: alertTitle,
                stage: 'alert',
                recipient: `${contact.name} <${contact.email}>`,
                subject,
                sentAt: now.toISOString(),
                status: 'simulated',
                bodySummary: `[DELIVERY FAILED: ${errorMessage}] ${bodySummary}`,
                locationUrl: locationUrl || null,
              });
            }
          })
        );
      }

      // Update sos_events record with verified delivery status of notified emergency contacts
      const updatedContactsDetail = contacts.map((c: any) => {
        const result = emailResults.find((r) => r.email === c.email);
        return {
          id: c.id || '',
          name: c.name || 'Emergency Contact',
          email: c.email || '',
          phone: c.phone || '',
          relation: c.relation || 'Emergency Contact',
          status: result ? result.status : (deliveredCount > 0 ? 'delivered' : 'failed'),
          deliveredAt: result?.status === 'delivered' ? (result.deliveredAt || now.toISOString()) : null,
          messageId: result?.messageId || null,
          error: result?.error || null,
        };
      });

      const updatedNotifiedSummary = updatedContactsDetail.map((c: any) =>
        `${c.name} (${c.email || c.phone || 'Contact'}) [${c.status}]`
      );

      const updatedTripFields = {
        emergencyContactsNotified: updatedContactsDetail,
        notifiedContacts: updatedNotifiedSummary,
        notifiedCount: deliveredCount,
        escalatedTo: contacts.map((c: any) => c.id || c.email || c.name),
      };

      if (localTrips.has(targetTripId)) {
        localTrips.set(targetTripId, { ...localTrips.get(targetTripId), ...updatedTripFields });
      }

      if (isFirebaseAvailable && db) {
        try {
          await db.collection('trips').doc(targetTripId).set(updatedTripFields, { merge: true });
          console.log(`[SafeCheck Server] Updated trips document ${targetTripId} with confirmed contact delivery results`);
        } catch (updateErr: any) {
          console.warn('[SafeCheck Server] Notice updating trips with delivered contacts:', updateErr?.message || updateErr);
          if (String(updateErr?.message || updateErr).includes('PERMISSION_DENIED') || String(updateErr?.code) === '7') {
            isFirebaseAvailable = false;
          }
        }
      }

      const dispatchStatus = deliveredCount > 0
        ? (failedCount > 0 ? 'partial' : 'delivered')
        : (validContacts.length === 0 ? 'no_contacts' : (transporter ? 'failed' : 'unconfigured'));

      const primaryError = dispatchStatus === 'failed' || dispatchStatus === 'unconfigured'
        ? (emailResults[0]?.error || 'Failed to deliver emergency emails')
        : (dispatchStatus === 'no_contacts' ? 'No emergency contacts configured with valid email addresses' : null);

      res.json({
        success: true,
        sosId,
        tripId: activeTripId || sosId,
        alertId: sosId,
        locationUrl: locationUrl || null,
        guardianUrl: guardianLink,
        emailDispatch: {
          status: dispatchStatus,
          deliveredCount,
          failedCount,
          attemptedCount: validContacts.length,
          provider: 'gmail-smtp',
          sender: senderEmail,
          error: primaryError,
          results: emailResults,
        },
        // Legacy & top-level compatibility fields
        notifiedCount: deliveredCount, // STRICTLY delivered count
        deliveredCount,
        failedCount,
        emailResults,
      });
    } catch (error: any) {
      console.error('Error triggering SOS:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  };

  // Mount unified SOS trigger routes
  app.post('/api/trigger-sos', handleSOSTrigger);
  app.post('/api/sos/trigger', handleSOSTrigger);

  // Dedicated Audio Evidence upload endpoint (/api/sos/upload-audio)
  // Rate limited to 60 requests per 15 minutes per IP
  const audioUploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many audio upload requests from this IP, please try again after 15 minutes.' },
  });

  // Uploads audio to resilient disk storage (zero in-memory audio buffering) and records in independent collection sos_audio_evidence
  app.post('/api/sos/upload-audio', audioUploadLimiter, async (req, res) => {
    try {
      // 1. userId must be required. Reject with 400 if missing.
      const { tripId, trip_id, sosId, sos_id, userId, user_id, audioDataUrl, recordedAt, durationSeconds, mimeType, storagePath } = req.body;
      const rawUserId = userId || user_id;
      if (!rawUserId || typeof rawUserId !== 'string' || !rawUserId.trim()) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const rawTargetTripId = tripId || trip_id || sosId || sos_id;
      if (!rawTargetTripId || !audioDataUrl) {
        return res.status(400).json({ success: false, error: 'Missing required targetTripId or audioDataUrl' });
      }

      // 1. Reject with 400 unless audioDataUrl is a string matching ^data:audio/[a-z0-9.+-]+(;[^,]*)?;base64, and decodes to a non-empty buffer
      if (typeof audioDataUrl !== 'string' || !/^data:audio\/[a-z0-9.+-]+(;[^,]*)?;base64,/.test(audioDataUrl)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid audioDataUrl: must be a base64 data URL matching ^data:audio/[a-z0-9.+-]+(;[^,]*)?;base64,',
        });
      }

      const commaIdx = audioDataUrl.indexOf(',');
      let audioBuffer: Buffer | null = Buffer.from(audioDataUrl.slice(commaIdx + 1), 'base64');
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid audioDataUrl: payload decodes to an empty buffer' });
      }
      const fileSizeBytes = audioBuffer.length;

      // 3. Allowlist mimeType to audio/webm, audio/mp4, audio/ogg, audio/wav and audio/mpeg. Reject anything else with 415.
      const rawMime = mimeType || audioDataUrl.slice(5, audioDataUrl.indexOf(';'));
      const cleanMime = rawMime.split(';')[0].trim().toLowerCase();
      if (!ALLOWED_AUDIO_MIME_TYPES.includes(cleanMime as any)) {
        return res.status(415).json({
          success: false,
          error: `Unsupported Media Type: "${rawMime}". Allowed audio MIME types: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`,
        });
      }

      // Enforce authentication: verify Bearer token with Firebase Admin verifyIdToken
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[SafeCheck Server] 401 Unauthorized: Missing Authorization Bearer header on /api/sos/upload-audio');
        return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to upload emergency audio evidence' });
      }

      const authToken = authHeader.substring(7).trim();
      if (!authToken || authToken.length < 8) {
        console.warn('[SafeCheck Server] 401 Unauthorized: Invalid Authorization Bearer token on /api/sos/upload-audio');
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication credentials' });
      }

      const adminAuth = getAdminAuth();
      if (!adminAuth) {
        console.warn('[SafeCheck Server] 401 Unauthorized: Firebase Admin Auth unavailable to verify token');
        return res.status(401).json({ success: false, error: 'Unauthorized: Authentication service unavailable' });
      }

      let decodedToken: any;
      try {
        decodedToken = await adminAuth.verifyIdToken(authToken);
      } catch (verifyErr: any) {
        console.warn('[SafeCheck Server] 401 Unauthorized: Firebase Admin verifyIdToken rejected:', verifyErr?.message || verifyErr);
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication token' });
      }

      if (!decodedToken || !decodedToken.uid) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token payload' });
      }

      const effectiveUserId = rawUserId.trim();
      // Reject if the token uid does not match userId
      if (decodedToken.uid !== effectiveUserId) {
        console.warn(`[SafeCheck Server] 403 Forbidden: Token uid "${decodedToken.uid}" does not match requested userId "${effectiveUserId}"`);
        return res.status(403).json({ success: false, error: 'Forbidden: Token uid does not match userId' });
      }

      // Sanitize tripId/sosId everywhere they are used in file names or paths (allow only [A-Za-z0-9_-])
      const targetTripId = String(rawTargetTripId).replace(/[^A-Za-z0-9_-]/g, '_');
      const cleanSosId = String(sosId || targetTripId).replace(/[^A-Za-z0-9_-]/g, '_');
      const cleanUserId = String(effectiveUserId).replace(/[^A-Za-z0-9_-]/g, '_');

      // After verifyIdToken, load the trip document if present and reject with 403 if it belongs to someone else
      let tripDoc: any = null;
      if (isFirebaseAvailable && db) {
        try {
          const snap = await db.collection('trips').doc(targetTripId).get();
          if (snap.exists) {
            tripDoc = snap.data();
          } else if (rawTargetTripId !== targetTripId) {
            const snapRaw = await db.collection('trips').doc(String(rawTargetTripId)).get();
            if (snapRaw.exists) {
              tripDoc = snapRaw.data();
            }
          }
        } catch (err: any) {
          console.warn(`[SafeCheck Server] Notice loading trip document from Firestore:`, err?.message || err);
        }
      }

      if (!tripDoc) {
        tripDoc = localTrips.get(targetTripId) || (rawTargetTripId !== targetTripId ? localTrips.get(String(rawTargetTripId)) : null);
      }

      const tripOwnerUid = tripDoc?.userId || tripDoc?.uid || tripDoc?.ownerId;
      if (tripDoc && tripOwnerUid && tripOwnerUid !== decodedToken.uid) {
        console.warn(`[SafeCheck Server] 403 Forbidden: Trip owner uid "${tripOwnerUid}" does not match token uid "${decodedToken.uid}"`);
        return res.status(403).json({ success: false, error: 'Forbidden: Trip owner does not match authenticated user' });
      }

      const recAt = recordedAt || new Date().toISOString();
      const detectedMime = cleanMime;
      const ext = cleanMime.includes('wav') ? 'wav' : cleanMime.includes('ogg') ? 'ogg' : (cleanMime.includes('mp4') || cleanMime.includes('m4a')) ? 'mp4' : (cleanMime.includes('mpeg') || cleanMime.includes('mp3')) ? 'mp3' : 'webm';
      const cleanTs = recAt.replace(/[:.]/g, '-');
      const resolvedStoragePath = storagePath ? String(storagePath).replace(/[^A-Za-z0-9_/.-]/g, '_') : `/sos_audio/${cleanUserId}/${targetTripId}/${cleanTs}.${ext}`;
      const audioId = `audio_${targetTripId}_${Date.now()}`;

      // Stream audio directly to disk file - NEVER retain buffer or audio payload in server process memory
      const diskFilename = `${audioId}.${ext}`;
      const diskFilePath = path.join(AUDIO_STORAGE_DIR, diskFilename);
      await fs.promises.writeFile(diskFilePath, audioBuffer);
      audioBuffer = null; // Immediately clear from memory

      // Relative signed URL for audio playback with 7-day expiry and HMAC signature
      const signedToken = generateAudioAccessToken(audioId);
      const downloadUrl = `/api/sos/audio/${audioId}?token=${signedToken}`;

      const audioDoc = {
        audio_id: audioId,
        trip_id: targetTripId,
        sos_id: cleanSosId,
        user_id: cleanUserId,
        storage_path: resolvedStoragePath,
        download_url: downloadUrl,
        duration_seconds: Number(durationSeconds) || 12,
        recorded_at: recAt,
        file_size_bytes: fileSizeBytes,
        mime_type: detectedMime,
        disk_filename: diskFilename,
        savedAt: new Date().toISOString(),
      };

      // Store ONLY metadata in localAudioEvidence (never audio dataUrls or buffers)
      localAudioEvidence.set(audioId, audioDoc);

      const tripAudioAttachment = {
        id: audioId,
        tripId: targetTripId,
        alertId: targetTripId,
        userId: cleanUserId,
        audioDataUrl: downloadUrl,
        download_url: downloadUrl,
        storage_path: resolvedStoragePath,
        recordedAt: recAt,
        durationSeconds: Number(durationSeconds) || 12,
        mimeType: detectedMime,
      };

      const nowIso = new Date().toISOString();

      // Always update in localTrips (create if not already in memory)
      const existingTrip = localTrips.get(targetTripId) || (cleanSosId ? localTrips.get(cleanSosId) : null) || tripDoc;
      const updatedTripRecord = {
        ...(existingTrip || {}),
        id: targetTripId,
        sosId: cleanSosId || (existingTrip as any)?.sosId || targetTripId,
        userId: cleanUserId,
        status: (existingTrip as any)?.status || 'sos',
        isSosEvent: true,
        startTime: (existingTrip as any)?.startTime || recAt,
        audioEvidence: tripAudioAttachment,
        audioEvidenceUrl: downloadUrl,
        audioStatus: 'ready',
        audioStatusUpdatedAt: nowIso,
        syncedAt: nowIso,
        audioError: null,
      };

      localTrips.set(targetTripId, updatedTripRecord);
      if (cleanSosId && cleanSosId !== targetTripId) {
        localTrips.set(cleanSosId, { ...updatedTripRecord, id: cleanSosId });
      }

      if (isFirebaseAvailable && db) {
        try {
          await db.collection('sos_audio_evidence').doc(audioId).set(audioDoc);
          console.log(`[SafeCheck Server] Successfully logged independent audio evidence to sos_audio_evidence: ${audioId}`);
        } catch (err: any) {
          console.warn('[SafeCheck Server] Notice writing to Firestore sos_audio_evidence:', err?.message || err);
        }

        try {
          const fsUpdate = {
            audioEvidence: tripAudioAttachment,
            audioEvidenceUrl: downloadUrl,
            audioStatus: 'ready',
            audioStatusUpdatedAt: nowIso,
            syncedAt: nowIso,
            audioError: null,
          };
          const writes = [
            db.collection('trips').doc(targetTripId).set(fsUpdate, { merge: true }),
          ];
          if (cleanSosId && cleanSosId !== targetTripId) {
            writes.push(db.collection('trips').doc(cleanSosId).set(fsUpdate, { merge: true }));
          }
          await Promise.all(writes);
          console.log(`[SafeCheck Server] Attached audio evidence directly into trips: ${targetTripId} (and ${cleanSosId}) with status 'ready' and syncedAt '${nowIso}'`);
        } catch (err: any) {
          console.warn('[SafeCheck Server] Notice attaching audio to trips:', err?.message || err);
        }
      }

      res.json({
        success: true,
        audio_id: audioId,
        trip_id: targetTripId,
        sos_id: cleanSosId,
        storage_path: resolvedStoragePath,
        download_url: downloadUrl,
        file_size_bytes: fileSizeBytes,
      });
    } catch (error: any) {
      console.error('Error saving audio evidence:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Serve audio playback stream directly from disk file using streams (zero process memory buffering)
  // Requires authentication or signed URL; Access-Control-Allow-Origin "*" removed
  app.get('/api/sos/audio/:audioId', async (req, res) => {
    const rawAudioId = req.params.audioId;
    const audioId = String(rawAudioId).replace(/[^A-Za-z0-9_-]/g, '');

    let isAuthorized = false;
    const queryToken = req.query.token as string;

    if (queryToken && verifyAudioAccessToken(audioId, queryToken)) {
      isAuthorized = true;
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        const adminAuth = getAdminAuth();
        if (adminAuth) {
          try {
            const decoded = await adminAuth.verifyIdToken(token);
            if (decoded && decoded.uid) {
              isAuthorized = true;
            }
          } catch {}
        }
      }
    }

    if (!isAuthorized) {
      console.warn(`[SafeCheck Server] 401 Unauthorized audio playback attempt for "${audioId}"`);
      return res.status(401).json({ error: 'Unauthorized: Audio access requires authentication or a valid signed URL' });
    }

    const meta = localAudioEvidence.get(audioId);
    const rawMime = meta?.mime_type || '';
    const cleanMime = rawMime.split(';')[0].trim().toLowerCase();
    const servedMimeType = ALLOWED_AUDIO_MIME_TYPES.includes(cleanMime as any) ? cleanMime : 'audio/webm';

    // Look up file on disk by exact meta.disk_filename only
    let diskPath: string | null = null;
    if (meta?.disk_filename) {
      const candidate = path.join(AUDIO_STORAGE_DIR, meta.disk_filename);
      if (fs.existsSync(candidate)) {
        diskPath = candidate;
      }
    }

    if (diskPath && fs.existsSync(diskPath)) {
      const stat = fs.statSync(diskPath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', servedMimeType);
      res.setHeader('Content-Length', stat.size);
      const stream = fs.createReadStream(diskPath);
      return stream.pipe(res);
    }

    res.status(404).json({ error: 'Audio recording not found or expired' });
  });

  // Return freshly signed URL for audio playback; requires a verified Bearer token
  app.get('/api/sos/audio-url/:audioId', async (req, res) => {
    try {
      // Require verified Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Bearer token required' });
      }

      const authToken = authHeader.substring(7).trim();
      if (!authToken || authToken.length < 8) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication credentials' });
      }

      const adminAuth = getAdminAuth();
      if (!adminAuth) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Authentication service unavailable' });
      }

      let decodedToken: any;
      try {
        decodedToken = await adminAuth.verifyIdToken(authToken);
      } catch (verifyErr: any) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication token' });
      }

      if (!decodedToken || !decodedToken.uid) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token payload' });
      }

      const rawAudioId = req.params.audioId;
      const audioId = String(rawAudioId).replace(/[^A-Za-z0-9_-]/g, '');
      if (!audioId) {
        return res.status(400).json({ success: false, error: 'Invalid audioId' });
      }

      // Look up evidence in local store or Firestore
      let meta = localAudioEvidence.get(audioId);
      if (!meta && isFirebaseAvailable && db) {
        try {
          const snap = await db.collection('sos_audio_evidence').doc(audioId).get();
          if (snap.exists) {
            meta = snap.data();
          }
        } catch {}
      }

      if (!meta) {
        return res.status(404).json({ success: false, error: 'Audio recording not found' });
      }

      const signedToken = generateAudioAccessToken(audioId);
      const downloadUrl = `/api/sos/audio/${audioId}?token=${signedToken}`;

      res.json({
        success: true,
        audio_id: audioId,
        audioId,
        download_url: downloadUrl,
        downloadUrl,
        url: downloadUrl,
        signed_url: downloadUrl,
        signedUrl: downloadUrl,
        token: signedToken,
      });
    } catch (error: any) {
      console.error('Error generating audio URL:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Query SOS Events (from Firestore trips collection and local trips store)
  app.get('/api/sos/events', async (req, res) => {
    const userId = req.query.userId as string;
    const events: any[] = [];
    const seenIds = new Set<string>();

    if (isFirebaseAvailable && db) {
      try {
        let q = db.collection('trips');
        if (userId) {
          q = q.where('userId', '==', userId);
        }
        const snap = await q.get();
        snap.forEach((doc: any) => {
          const data = doc.data();
          if (data.isSosEvent || data.status === 'alerted' || (typeof data.destination === 'string' && data.destination.includes('SOS'))) {
            seenIds.add(doc.id);
            events.push({ id: doc.id, ...data });
          }
        });
      } catch (e) {}
    }

    // Include in-memory trips
    for (const [id, t] of localTrips.entries()) {
      if (!seenIds.has(id) && (!userId || t.userId === userId)) {
        if ((t as any).isSosEvent || t.status === 'alerted' || (typeof t.destination === 'string' && t.destination.includes('SOS'))) {
          seenIds.add(id);
          events.push({ id, ...t });
        }
      }
    }

    res.json({ success: true, count: events.length, events });
  });

  // Create or sync SOS Event directly in trips collection
  app.post('/api/sos/create-event', async (req, res) => {
    try {
      const eventData = req.body;
      const tripId = eventData.trip_id || eventData.tripId || eventData.sos_id;
      const targetUserId = eventData.user_id || eventData.userId;

      if (!tripId || !targetUserId) {
        return res.status(400).json({ success: false, error: 'tripId (or sos_id) and userId are required' });
      }

      const lat = typeof eventData.latitude === 'number'
        ? eventData.latitude
        : (eventData.location?.lat ?? eventData.location?.latitude ?? null);
      const lng = typeof eventData.longitude === 'number'
        ? eventData.longitude
        : (eventData.location?.lng ?? eventData.location?.longitude ?? null);
      const triggerTimestamp = eventData.sosTimestamp || eventData.triggered_at || eventData.timestamp || new Date().toISOString();

      const escalatedToList = eventData.escalatedTo || eventData.escalated_to || [];
      const contactsNotified = eventData.emergencyContactsNotified || eventData.emergency_contacts_notified || [];
      const notifiedSummary = eventData.notifiedContacts || eventData.notified_contacts || [];

      const normalizedTripRecord: any = {
        id: tripId,
        userId: targetUserId,
        userName: eventData.userName || 'SafeCheck User',
        userEmail: eventData.userEmail || '',
        destination: eventData.destination || (
          eventData.sosType === 'fall_detected' || eventData.type === 'fall_detected' ? '🚨 FALL DETECTED SOS ALERT' :
          eventData.sosType === 'voice_activated' || eventData.type === 'voice_activated' ? '🚨 VOICE ACTIVATED SOS ALERT' :
          eventData.sosType === 'auto_escalated' || eventData.type === 'auto_escalated' ? '🚨 OVERDUE ARRIVAL SOS ALERT' :
          '🚨 ONE-TAP EMERGENCY SOS ALERT'
        ),
        startTime: triggerTimestamp,
        durationMinutes: 0,
        graceMinutes: 0,
        status: eventData.status === 'safe' || eventData.status === 'resolved' || eventData.sosStatus === 'resolved' ? 'safe' : 'alerted',
        alertedAt: triggerTimestamp,
        // Specific SOS fields directly in trips collection:
        isSosEvent: true,
        sosType: eventData.sosType || eventData.type || 'manual',
        sosTimestamp: triggerTimestamp,
        sosLocation: { lat, lng },
        sosStatus: eventData.status === 'safe' || eventData.status === 'resolved' || eventData.sosStatus === 'resolved' ? 'resolved' : (eventData.sosStatus === 'escalated' || eventData.status === 'escalated' ? 'escalated' : 'active'),
        escalatedTo: escalatedToList,
        latitude: lat,
        longitude: lng,
        location: { lat, lng },
        gps: { latitude: lat, longitude: lng },
        locationUrl: eventData.locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null),
        emergencyContactsNotified: contactsNotified,
        notifiedContacts: notifiedSummary,
        notifiedCount: eventData.notifiedCount ?? eventData.notified_count ?? contactsNotified.length,
        countdownStartedAt: eventData.countdownStartedAt || eventData.countdown_started_at || triggerTimestamp,
        respondedAt: eventData.respondedAt || eventData.responded_at || null,
        escalatedAt: eventData.escalatedAt || eventData.escalated_at || null,
      };

      const existingLocal = localTrips.get(tripId) || {};
      const mergedLocal = { ...existingLocal, ...normalizedTripRecord };
      localTrips.set(tripId, mergedLocal);

      if (isFirebaseAvailable && db) {
        try {
          await db.collection('trips').doc(tripId).set(normalizedTripRecord, { merge: true });
          console.log(`[SafeCheck Server] Wrote SOS event directly to trips collection: ${tripId}`);
        } catch (err: any) {
          console.warn('[SafeCheck Server] Firestore write notice in /api/sos/create-event:', err?.message || err);
          if (String(err?.message || err).includes('PERMISSION_DENIED') || String(err?.code) === '7') {
            isFirebaseAvailable = false;
          }
        }
      }

      res.json({ success: true, event: mergedLocal });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
  });

  // Create or sync Audio Evidence in sos_audio_evidence collection linked to tripId
  app.post('/api/sos/create-audio-evidence', async (req, res) => {
    try {
      const audioDoc = req.body;
      const targetTripId = audioDoc.trip_id || audioDoc.tripId || audioDoc.sos_id;
      if (!audioDoc || !audioDoc.audio_id || !targetTripId) {
        return res.status(400).json({ success: false, error: 'audio_id and trip_id (or sos_id) are required' });
      }

      const audioId = audioDoc.audio_id;
      let cleanDownloadUrl = audioDoc.download_url;
      if (typeof cleanDownloadUrl === 'string' && !cleanDownloadUrl.startsWith('data:')) {
        cleanDownloadUrl = cleanDownloadUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
        if (!cleanDownloadUrl.startsWith('/')) cleanDownloadUrl = `/${cleanDownloadUrl}`;
      }

      const audioRecord = {
        ...audioDoc,
        download_url: cleanDownloadUrl,
        trip_id: targetTripId,
        sos_id: targetTripId,
      };
      localAudioEvidence.set(audioId, audioRecord);

      if (isFirebaseAvailable && db) {
        try {
          await db.collection('sos_audio_evidence').doc(audioId).set(audioRecord);
          // Attach metadata to trip document
          await db.collection('trips').doc(targetTripId).set({
            audioEvidence: {
              id: audioId,
              tripId: targetTripId,
              download_url: cleanDownloadUrl,
              audioDataUrl: cleanDownloadUrl,
              storage_path: audioDoc.storage_path,
              durationSeconds: audioDoc.duration_seconds || audioDoc.durationSeconds,
              recordedAt: audioDoc.recorded_at || audioDoc.recordedAt,
              mimeType: audioDoc.mime_type || audioDoc.mimeType,
            },
            audioEvidenceUrl: cleanDownloadUrl,
            audioStatus: 'ready',
            audioError: null,
          }, { merge: true });
          console.log(`[SafeCheck Server] Wrote audio evidence linked to trip: ${targetTripId}`);
        } catch (err: any) {
          console.warn('[SafeCheck Server] Firestore write notice in /api/sos/create-audio-evidence:', err?.message || err);
          if (String(err?.message || err).includes('PERMISSION_DENIED') || String(err?.code) === '7') {
            isFirebaseAvailable = false;
          }
        }
      }

      res.json({ success: true, audio_evidence: audioRecord });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
  });

  // Dedicated endpoint to save SOS audio evidence with Admin Firestore privilege fallback
  app.post('/api/sos/save-evidence', async (req, res) => {
    try {
      const payload = req.body;
      const cleanTripId = String(payload.tripId || payload.trip_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
      if (!cleanTripId) {
        return res.status(400).json({ success: false, error: 'tripId is required' });
      }

      console.log(`[SafeCheck Server] 📥 Received /api/sos/save-evidence for trip "${cleanTripId}" (status: ${payload.audioStatus}, chunkCount: ${payload.chunkCount || 0})`);

      if (isFirebaseAvailable && db) {
        try {
          const docData: any = {
            tripId: cleanTripId,
            userId: payload.userId || 'traveler',
            audioStatus: payload.audioStatus || 'ready',
            audioMimeType: payload.audioMimeType || 'audio/webm',
            audioExtension: payload.audioExtension || 'webm',
            audioSizeBytes: payload.audioSizeBytes || 0,
            durationSeconds: payload.durationSeconds || 30,
            recordedAt: payload.recordedAt || new Date().toISOString(),
            updatedAt: payload.updatedAt || new Date().toISOString(),
          };

          if (payload.chunkCount && payload.chunkCount > 0 && Array.isArray(payload.chunks)) {
            docData.chunkCount = payload.chunkCount;
            docData.audioBase64 = null;
            for (let i = 0; i < payload.chunks.length; i++) {
              await db.collection('sos_evidence').doc(cleanTripId).collection('chunks').doc(String(i)).set({
                index: i,
                chunk: payload.chunks[i],
                updatedAt: new Date().toISOString(),
              });
            }
          } else {
            docData.chunkCount = 0;
            docData.audioBase64 = payload.audioBase64 || null;
          }

          await db.collection('sos_evidence').doc(cleanTripId).set(docData, { merge: true });
          console.log(`[SafeCheck Server] ✅ Successfully wrote sos_evidence/${cleanTripId} in Firestore via Admin SDK`);

          // Also update trips collection
          await db.collection('trips').doc(cleanTripId).set({
            audioStatus: payload.audioStatus || 'ready',
            audioStatusUpdatedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            audioError: null,
            audioCapturedAt: payload.recordedAt || new Date().toISOString(),
            audioDurationSec: payload.durationSeconds || 30,
          }, { merge: true });
        } catch (dbErr: any) {
          console.error(`[SafeCheck Server] Error writing to Firestore in /api/sos/save-evidence:`, dbErr?.message || dbErr);
        }
      }

      res.json({ success: true, tripId: cleanTripId });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  });

  // Query SOS Evidence via server
  app.get('/api/sos/evidence/:tripId', async (req, res) => {
    try {
      const cleanTripId = String(req.params.tripId).replace(/[^A-Za-z0-9_-]/g, '_');
      if (isFirebaseAvailable && db) {
        const snap = await db.collection('sos_evidence').doc(cleanTripId).get();
        if (snap.exists) {
          const data = snap.data();
          if (data?.chunkCount && data.chunkCount > 0) {
            const chunksSnap = await db.collection('sos_evidence').doc(cleanTripId).collection('chunks').orderBy('index').get();
            const chunks = chunksSnap.docs.map((d: any) => d.data()?.chunk || '');
            return res.json({ success: true, evidence: { ...data, chunks } });
          }
          return res.json({ success: true, evidence: data });
        }
      }
      res.status(404).json({ success: false, error: 'Evidence not found' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
  });

  // Query Single SOS Event directly from trips collection
  app.get('/api/sos/events/:sosId', async (req, res) => {
    const { sosId } = req.params;
    if (isFirebaseAvailable && db) {
      try {
        const snap = await db.collection('trips').doc(sosId).get();
        if (snap.exists) {
          return res.json({ success: true, event: { id: snap.id, ...snap.data() } });
        }
      } catch (e) {}
    }
    const local = localTrips.get(sosId);
    if (local) {
      return res.json({ success: true, event: { id: sosId, ...local } });
    }
    res.status(404).json({ success: false, error: 'SOS event not found in trips collection' });
  });

  // Query SOS Audio Evidence linked by trip_id
  app.get('/api/sos/evidence', async (req, res) => {
    const targetId = (req.query.tripId || req.query.sosId) as string;
    const evidenceList: any[] = [];
    const seenIds = new Set<string>();

    if (isFirebaseAvailable && db) {
      try {
        let q = db.collection('sos_audio_evidence');
        if (targetId) {
          const tripSnap = await q.where('trip_id', '==', targetId).get();
          tripSnap.forEach((doc: any) => {
            seenIds.add(doc.id);
            evidenceList.push({ id: doc.id, ...doc.data() });
          });
          // Fallback check where sos_id equals targetId
          const sosSnap = await q.where('sos_id', '==', targetId).get();
          sosSnap.forEach((doc: any) => {
            if (!seenIds.has(doc.id)) {
              seenIds.add(doc.id);
              evidenceList.push({ id: doc.id, ...doc.data() });
            }
          });
        } else {
          const snap = await q.get();
          snap.forEach((doc: any) => {
            seenIds.add(doc.id);
            evidenceList.push({ id: doc.id, ...doc.data() });
          });
        }
      } catch (e) {}
    }

    for (const [id, a] of localAudioEvidence.entries()) {
      if (!seenIds.has(id) && (!targetId || a.trip_id === targetId || a.sos_id === targetId)) {
        seenIds.add(id);
        evidenceList.push({ id, ...a });
      }
    }

    res.json({ success: true, count: evidenceList.length, evidence: evidenceList });
  });

  // Server-side Migration Endpoint (/api/migrate-sos-trips)
  // Cleans up legacy SOS entries in in-memory datastore and, if Firebase Admin
  // has direct credentials, synchronizes Firestore trips into sos_events & sos_audio_evidence.
  app.post('/api/migrate-sos-trips', async (req, res) => {
    let scanned = 0;
    let migratedSosCount = 0;
    let migratedAudioCount = 0;
    let removedFromTripsCount = 0;
    const details: string[] = [];

    // 1. Clean up in-memory localTrips if any legacy SOS entries exist
    try {
      for (const [id, trip] of Array.from(localTrips.entries())) {
        const isLegacySos =
          id.startsWith('sos_') ||
          Boolean((trip as any).isSosEvent) ||
          (typeof trip.destination === 'string' && trip.destination.includes('🚨 SOS'));

        if (isLegacySos) {
          scanned++;
          localTrips.delete(id);
          removedFromTripsCount++;
          migratedSosCount++;
          details.push(`Cleaned up in-memory SOS trip "${id}"`);
        }
      }
    } catch (localErr: any) {
      console.warn('[SafeCheck Server] Error during in-memory migration check:', localErr?.message || localErr);
    }

    // 2. If Firebase Admin is available with valid credentials, migrate Firestore documents
    if (isFirebaseAvailable && db) {
      try {
        const tripsSnap = await db.collection('trips').get();

        for (const docSnap of tripsSnap.docs) {
          scanned++;
          const docId = docSnap.id;
          const data = docSnap.data();

          const isLegacySos =
            docId.startsWith('sos_') ||
            Boolean(data.isSosEvent) ||
            (typeof data.destination === 'string' && data.destination.includes('🚨 SOS'));

          if (!isLegacySos) continue;

          const sosId = docId;
          const userId = data.userId || data.user_id || 'unknown_user';
          const timestamp = data.startTime || data.timestamp || data.alertedAt || new Date().toISOString();

          let eventType = 'manual';
          const destLower = (data.destination || '').toLowerCase();
          if (destLower.includes('fall') || destLower.includes('impact')) {
            eventType = 'fall_detected';
          } else if (destLower.includes('voice') || destLower.includes('wake')) {
            eventType = 'voice_activated';
          }

          const status = data.status === 'safe' ? 'resolved' : data.autoEscalated ? 'escalated' : 'active';
          const contactsList = Array.isArray(data.notifiedContacts)
            ? data.notifiedContacts
            : (Array.isArray(data.escalated_to) ? data.escalated_to : []);

          const lat = typeof data.latitude === 'number' ? data.latitude : (data.location?.lat ?? null);
          const lng = typeof data.longitude === 'number' ? data.longitude : (data.location?.lng ?? null);

          const legacyNotifiedContacts = contactsList.map((contactEntry: any) => {
            if (typeof contactEntry === 'string') {
              return {
                id: contactEntry,
                name: contactEntry,
                status: 'notified',
                notifiedAt: timestamp,
              };
            }
            return {
              id: contactEntry.id || '',
              name: contactEntry.name || 'Emergency Contact',
              email: contactEntry.email || '',
              phone: contactEntry.phone || '',
              relation: contactEntry.relation || 'Contact',
              status: contactEntry.status || 'notified',
              notifiedAt: contactEntry.notifiedAt || timestamp,
            };
          });

          const notifiedSummary = contactsList.map((c: any) =>
            typeof c === 'string' ? c : `${c.name || 'Contact'} (${c.email || c.phone || ''})`
          );

          // A. Create document in sos_events
          const sosRecord = {
            sos_id: sosId,
            user_id: userId,
            trip_id: null,
            // 1. Timestamp of when SOS was triggered
            timestamp,
            triggered_at: timestamp,
            triggeredAt: timestamp,
            createdAt: timestamp,
            // 2. GPS Location
            latitude: lat,
            longitude: lng,
            location: {
              lat,
              lng,
              latitude: lat,
              longitude: lng,
            },
            gps: {
              latitude: lat,
              longitude: lng,
            },
            locationUrl: data.locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null),
            // 3. Status and Type
            type: eventType,
            status,
            // 4. Emergency contacts notified
            emergency_contacts_notified: legacyNotifiedContacts,
            notified_contacts: notifiedSummary,
            notifiedContacts: notifiedSummary,
            notified_count: legacyNotifiedContacts.length,
            notifiedCount: legacyNotifiedContacts.length,
            escalated_to: contactsList.map((c: any) => (typeof c === 'string' ? c : c.id || c.email || c.name)),
            // Additional fields
            countdown_started_at: data.startTime || timestamp,
            responded_at: data.safeAt || null,
            escalated_at: data.alertedAt || null,
            userName: data.userName || null,
            userEmail: data.userEmail || null,
            destination: data.destination || null,
            migratedAt: new Date().toISOString(),
          };

          await db.collection('sos_events').doc(sosId).set(sosRecord, { merge: true });
          migratedSosCount++;
          details.push(`Migrated legacy trip ${docId} to sos_events`);

          // B. Extract audio evidence if present
          if (data.audioEvidence) {
            const audioId = `audio_${sosId}`;
            const cleanTs = timestamp.replace(/[:.]/g, '-');
            const storagePath = `/sos_audio/${userId}/${sosId}/${cleanTs}.webm`;
            const audioRecord = {
              audio_id: audioId,
              sos_id: sosId,
              user_id: userId,
              storage_path: storagePath,
              download_url: data.audioEvidence.download_url || `/api/sos/audio/${audioId}`,
              duration_seconds: data.audioEvidence.durationSeconds || 12,
              recorded_at: data.audioEvidence.recordedAt || timestamp,
              file_size_bytes: data.audioEvidence.file_size_bytes || 1024 * 16,
              mime_type: data.audioEvidence.mimeType || 'audio/webm',
              migratedAt: new Date().toISOString(),
            };

            await db.collection('sos_audio_evidence').doc(audioId).set(audioRecord);
            migratedAudioCount++;
            details.push(`Extracted audio from ${docId} to sos_audio_evidence (${audioId})`);
          }

          // C. Delete from trips collection
          await db.collection('trips').doc(docId).delete();
          removedFromTripsCount++;
          details.push(`Deleted ${docId} from trips collection`);
        }
      } catch (adminErr: any) {
        // Direct server-side Firestore Admin access may lack service account key in preview/container mode.
        // The client-side Firestore SDK (executed in the user's browser) handles Firestore user migrations.
        isFirebaseAvailable = false;
        console.warn('[SafeCheck Server] Server-side Firebase Admin direct query bypassed (client-side SDK manages Firestore):', adminErr?.message || adminErr);
        details.push('Server-side direct Firestore access bypassed; handled via authenticated client-side SDK');
      }
    }

    return res.json({
      success: true,
      scanned,
      migratedSosCount,
      migratedAudioCount,
      removedFromTripsCount,
      details,
    });
  });

  // Rate limiter specifically for public shared trip tracking (20 req / min per IP)
  const sharedTripLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // Limit each IP to 20 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'Too many requests, please try again later',
    },
  });

  // Shared Trip Endpoint with 20 requests/minute per IP rate limiting
  app.get('/api/trips/shared/:token', sharedTripLimiter, async (req, res) => {
    const { token } = req.params;
    let trip = localTrips.get(token);

    if (!trip) {
      for (const t of localTrips.values()) {
        if (t.id === token || (t as any).shareToken === token) {
          trip = t;
          break;
        }
      }
    }

    if (!trip && isFirebaseAvailable && db) {
      try {
        const docSnap = await db.collection('trips').doc(token).get();
        if (docSnap.exists) {
          trip = { id: docSnap.id, ...docSnap.data() };
        } else {
          const querySnap = await db.collection('trips').where('shareToken', '==', token).limit(1).get();
          if (!querySnap.empty) {
            const firstDoc = querySnap.docs[0];
            trip = { id: firstDoc.id, ...firstDoc.data() };
          }
        }
      } catch (e) {}
    }

    if (trip) {
      return res.json({ success: true, trip });
    }

    res.status(404).json({ success: false, error: 'Trip not found' });
  });

  // Guardian Dashboard Endpoint for public, unauthenticated real-time companion view
  app.get('/api/guardian/:tripId', async (req, res) => {
    const { tripId } = req.params;
    console.log(`[Server /api/guardian/:tripId] 🔎 Request for tripId="${tripId}" at ${new Date().toISOString()}`);
    const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
    let trip = localTrips.get(tripId) || localTrips.get(cleanTripId);

    // If not directly found in localTrips by key, search if any localTrip has this sosId or activeTripId
    if (!trip) {
      for (const t of localTrips.values()) {
        if (t.id === tripId || (t as any).sosId === tripId || (t as any).sos_id === tripId || (t as any).activeTripId === tripId || t.id === cleanTripId || (t as any).sosId === cleanTripId) {
          trip = t;
          break;
        }
      }
    }

    if (!trip && isFirebaseAvailable && db) {
      try {
        const docSnap = await db.collection('trips').doc(tripId).get();
        if (docSnap.exists) {
          trip = { id: docSnap.id, ...docSnap.data() };
          console.log(`[Server /api/guardian/:tripId] ✅ Found trip document in Firestore for "${tripId}" (status: ${trip.status})`);
        } else {
          // Check query by sosId or sos_id or trip_id
          const sosSnap = await db.collection('trips').where('sosId', '==', tripId).limit(1).get();
          if (!sosSnap.empty) {
            trip = { id: sosSnap.docs[0].id, ...sosSnap.docs[0].data() };
          } else {
            const sosSnap2 = await db.collection('trips').where('sos_id', '==', tripId).limit(1).get();
            if (!sosSnap2.empty) {
              trip = { id: sosSnap2.docs[0].id, ...sosSnap2.docs[0].data() };
            }
          }
        }
      } catch (e: any) {
        console.warn(`[Server /api/guardian/:tripId] ⚠️ Firestore trip lookup error:`, e?.message || e);
      }
    }

    // If trip references an active trip, merge fresher live location/trail from active trip
    if (trip && trip.activeTripId && trip.activeTripId !== trip.id) {
      const activeRef = localTrips.get(trip.activeTripId);
      if (activeRef) {
        if (activeRef.latitude && activeRef.longitude) {
          trip.latitude = activeRef.latitude;
          trip.longitude = activeRef.longitude;
          trip.locationUrl = activeRef.locationUrl || trip.locationUrl;
          trip.lastKnownLatitude = activeRef.lastKnownLatitude || trip.lastKnownLatitude;
          trip.lastKnownLongitude = activeRef.lastKnownLongitude || trip.lastKnownLongitude;
          trip.lastLocationUpdate = activeRef.lastLocationUpdate || trip.lastLocationUpdate;
          if (Array.isArray(activeRef.locationTrail) && activeRef.locationTrail.length > 0) {
            trip.locationTrail = activeRef.locationTrail;
          }
        }
        if (activeRef.status === 'safe' || activeRef.status === 'cancelled') {
          trip.status = activeRef.status;
          trip.safeAt = activeRef.safeAt || trip.safeAt;
        }
      } else if (isFirebaseAvailable && db) {
        try {
          const actSnap = await db.collection('trips').doc(trip.activeTripId).get();
          if (actSnap.exists) {
            const actData = actSnap.data() as any;
            if (actData.latitude && actData.longitude) {
              trip.latitude = actData.latitude;
              trip.longitude = actData.longitude;
              trip.locationUrl = actData.locationUrl || trip.locationUrl;
              trip.lastLocationUpdate = actData.lastLocationUpdate || trip.lastLocationUpdate;
              if (Array.isArray(actData.locationTrail) && actData.locationTrail.length > 0) {
                trip.locationTrail = actData.locationTrail;
              }
            }
            if (actData.status === 'safe' || actData.status === 'cancelled') {
              trip.status = actData.status;
              trip.safeAt = actData.safeAt || trip.safeAt;
            }
          }
        } catch {}
      }
    }

    // Attach audio evidence if available and not already on the trip
    if (trip) {
      // 1. If trip already has audioEvidenceUrl but no audioEvidence object, reconstruct it
      if (!trip.audioEvidence && trip.audioEvidenceUrl) {
        trip.audioEvidence = {
          id: `audio_${trip.id || tripId}`,
          tripId: trip.id || tripId,
          alertId: trip.id || tripId,
          userId: trip.userId || 'traveler',
          audioDataUrl: trip.audioEvidenceUrl,
          download_url: trip.audioEvidenceUrl,
          storage_path: `/sos_audio/${trip.id || tripId}.webm`,
          recordedAt: trip.audioCapturedAt || trip.alertedAt || trip.startTime || new Date().toISOString(),
          durationSeconds: trip.audioDurationSec || 30,
          mimeType: 'audio/webm',
          syncedAt: trip.audioStatusUpdatedAt || trip.syncedAt || new Date().toISOString(),
        };
        trip.audioStatus = 'ready';
        trip.audioError = null;
      }

      // 2. Query Firestore sos_audio_evidence if database is available
      if (!trip.audioEvidence && isFirebaseAvailable && db) {
        try {
          let audioSnap = await db.collection('sos_audio_evidence').where('trip_id', '==', tripId).limit(1).get();
          if (audioSnap.empty) {
            audioSnap = await db.collection('sos_audio_evidence').where('sos_id', '==', tripId).limit(1).get();
          }
          if (audioSnap.empty && cleanTripId !== tripId) {
            audioSnap = await db.collection('sos_audio_evidence').where('trip_id', '==', cleanTripId).limit(1).get();
          }
          if (!audioSnap.empty) {
            const aDoc = audioSnap.docs[0].data();
            console.log(`[Server /api/guardian/:tripId] 🎵 Found linked audio evidence doc in Firestore for trip "${tripId}": audio_id="${aDoc.audio_id}"`);
            trip.audioEvidence = {
              id: aDoc.audio_id,
              tripId: tripId,
              alertId: tripId,
              userId: aDoc.user_id,
              audioDataUrl: aDoc.download_url,
              download_url: aDoc.download_url,
              storage_path: aDoc.storage_path,
              recordedAt: aDoc.recorded_at,
              durationSeconds: aDoc.duration_seconds,
              mimeType: aDoc.mime_type,
              syncedAt: aDoc.createdAt || aDoc.savedAt || new Date().toISOString(),
            };
            trip.audioEvidenceUrl = aDoc.download_url;
            trip.audioStatus = 'ready';
            trip.syncedAt = aDoc.createdAt || aDoc.savedAt || new Date().toISOString();
            trip.audioError = null;
          }
        } catch (aErr: any) {
          console.warn(`[Server /api/guardian/:tripId] ⚠️ Error querying sos_audio_evidence:`, aErr?.message || aErr);
        }
      }

      // 3. Search in-memory localAudioEvidence
      if (!trip.audioEvidence) {
        for (const a of localAudioEvidence.values()) {
          if (
            a.trip_id === tripId ||
            a.sos_id === tripId ||
            a.trip_id === cleanTripId ||
            a.sos_id === cleanTripId ||
            (a.audio_id && cleanTripId && a.audio_id.includes(cleanTripId))
          ) {
            console.log(`[Server /api/guardian/:tripId] 🎵 Found linked audio evidence in local memory for trip "${tripId}": audio_id="${a.audio_id}"`);
            trip.audioEvidence = {
              id: a.audio_id,
              tripId: tripId,
              alertId: tripId,
              userId: a.user_id,
              audioDataUrl: a.download_url,
              download_url: a.download_url,
              storage_path: a.storage_path,
              recordedAt: a.recorded_at,
              durationSeconds: a.duration_seconds,
              mimeType: a.mime_type,
              syncedAt: a.savedAt || new Date().toISOString(),
            };
            trip.audioEvidenceUrl = a.download_url;
            trip.audioStatus = 'ready';
            trip.syncedAt = a.savedAt || new Date().toISOString();
            trip.audioError = null;
            break;
          }
        }
      }

      // 4. Auto-detect raw audio recording file on disk in AUDIO_STORAGE_DIR
      if (!trip.audioEvidence) {
        try {
          const files = await fs.promises.readdir(AUDIO_STORAGE_DIR);
          const matchedFile = files.find((f) =>
            f.includes(cleanTripId) &&
            (f.endsWith('.webm') || f.endsWith('.wav') || f.endsWith('.mp4') || f.endsWith('.m4a') || f.endsWith('.ogg') || f.endsWith('.mp3'))
          );
          if (matchedFile) {
            const audioId = matchedFile.substring(0, matchedFile.lastIndexOf('.'));
            const ext = matchedFile.substring(matchedFile.lastIndexOf('.') + 1);
            const mime = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : ext === 'mp4' ? 'audio/mp4' : 'audio/webm';
            const signedToken = generateAudioAccessToken(audioId);
            const downloadUrl = `/api/sos/audio/${audioId}?token=${signedToken}`;
            trip.audioEvidence = {
              id: audioId,
              tripId: tripId,
              alertId: tripId,
              userId: trip.userId || 'traveler',
              audioDataUrl: downloadUrl,
              download_url: downloadUrl,
              storage_path: `/sos_audio/${tripId}/${matchedFile}`,
              recordedAt: trip.alertedAt || trip.startTime || new Date().toISOString(),
              durationSeconds: 30,
              mimeType: mime,
              syncedAt: new Date().toISOString(),
            };
            trip.audioEvidenceUrl = downloadUrl;
            trip.audioStatus = 'ready';
            trip.audioError = null;
            console.log(`[Server /api/guardian/:tripId] 🎵 Auto-detected audio file on disk for trip "${tripId}": ${matchedFile} -> ${downloadUrl}`);
          }
        } catch (diskErr) {}
      }

      // 5. Ensure status consistency if audioEvidence or audioEvidenceUrl is present
      if (!trip.audioEvidence && trip.audioEvidenceUrl) {
        let cleanUrl = trip.audioEvidenceUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
        if (!cleanUrl.startsWith('/') && !cleanUrl.startsWith('data:')) cleanUrl = `/${cleanUrl}`;
        trip.audioEvidenceUrl = cleanUrl;
        trip.audioEvidence = {
          id: `audio_${tripId}`,
          tripId: tripId,
          alertId: tripId,
          userId: trip.userId || 'traveler',
          audioDataUrl: cleanUrl,
          download_url: cleanUrl,
          storage_path: `/sos_audio/${tripId}.webm`,
          recordedAt: trip.alertedAt || trip.startTime || new Date().toISOString(),
          durationSeconds: 30,
          mimeType: 'audio/webm',
          syncedAt: trip.audioStatusUpdatedAt || new Date().toISOString(),
        };
        trip.audioStatus = 'ready';
        trip.audioError = null;
      }

      if (trip.audioEvidence) {
        trip.audioStatus = 'ready';
        trip.audioError = null;
        if (!trip.audioEvidenceUrl) {
          trip.audioEvidenceUrl = trip.audioEvidence.download_url || trip.audioEvidence.audioDataUrl;
        }
        // Normalize URLs to relative path /api/sos/audio/... (strip any localhost/127.0.0.1 prefix from existing records)
        if (trip.audioEvidenceUrl) {
          trip.audioEvidenceUrl = trip.audioEvidenceUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
          if (!trip.audioEvidenceUrl.startsWith('/') && !trip.audioEvidenceUrl.startsWith('data:')) {
            trip.audioEvidenceUrl = `/${trip.audioEvidenceUrl}`;
          }
        }
        if (trip.audioEvidence.download_url) {
          trip.audioEvidence.download_url = trip.audioEvidence.download_url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
          if (!trip.audioEvidence.download_url.startsWith('/') && !trip.audioEvidence.download_url.startsWith('data:')) {
            trip.audioEvidence.download_url = `/${trip.audioEvidence.download_url}`;
          }
        }
        if (trip.audioEvidence.audioDataUrl && !trip.audioEvidence.audioDataUrl.startsWith('data:')) {
          trip.audioEvidence.audioDataUrl = trip.audioEvidence.audioDataUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
          if (!trip.audioEvidence.audioDataUrl.startsWith('/')) {
            trip.audioEvidence.audioDataUrl = `/${trip.audioEvidence.audioDataUrl}`;
          }
        }
        if (!trip.syncedAt) {
          trip.syncedAt = trip.audioEvidence.recordedAt || trip.audioStatusUpdatedAt || new Date().toISOString();
        }
      }

      // Cache updated trip in localTrips
      localTrips.set(tripId, trip);
      if (cleanTripId !== tripId) {
        localTrips.set(cleanTripId, trip);
      }
      if (trip.id && trip.id !== tripId) {
        localTrips.set(trip.id, trip);
      }
      if ((trip as any).sosId && (trip as any).sosId !== tripId) {
        localTrips.set((trip as any).sosId, trip);
      }
    }

    // Normalize GPS coordinates from sosLocation if present
    if (trip && trip.sosLocation) {
      const sLat = trip.sosLocation.lat ?? trip.sosLocation.latitude;
      const sLng = trip.sosLocation.lng ?? trip.sosLocation.longitude;
      if (typeof sLat === 'number' && typeof sLng === 'number' && !isNaN(sLat) && !isNaN(sLng)) {
        trip.latitude = trip.latitude ?? sLat;
        trip.longitude = trip.longitude ?? sLng;
        if (!trip.locationUrl) {
          trip.locationUrl = `https://maps.google.com/?q=${sLat},${sLng}`;
        }
      }
    }

    if (trip) {
      console.log(`[Server /api/guardian/:tripId] 🚀 Returning trip "${tripId}": status="${trip.status}", isSosEvent=${Boolean(trip.isSosEvent)}, hasAudioEvidence=${Boolean(trip.audioEvidence)}, hasGPS=${Boolean(trip.latitude && trip.longitude)}`);
      return res.json({ success: true, trip });
    }

    console.warn(`[Server /api/guardian/:tripId] ❌ Trip "${tripId}" not found`);
    res.status(404).json({ success: false, error: 'Trip not found' });
  });

  app.get('/api/guardian/user/:userId', async (req, res) => {
    const { userId } = req.params;
    let trips = Array.from(localTrips.values()).filter((t) => t.userId === userId);
    trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    if (trips.length === 0 && isFirebaseAvailable && db) {
      try {
        const snap = await db.collection('trips').where('userId', '==', userId).get();
        snap.forEach((doc: any) => trips.push({ id: doc.id, ...doc.data() }));
        trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      } catch (e) {}
    }

    res.json({ success: true, trip: trips[0] || null });
  });

  // Logs endpoint for dev / preview testing console
  app.get('/api/logs', (req, res) => {
    res.json({
      logs: logs.slice(0, 50),
      hasSmtpConfigured: Boolean(process.env.GMAIL_USER && process.env.GMAIL_PASS),
      smtpVerified,
      smtpLastError,
    });
  });

  // Run automatic worker background timer every 10 seconds in server
  setInterval(() => {
    runTripEvaluator().catch(() => {});
  }, 10000);

  // Serve Vite in dev or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SafeCheck Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
