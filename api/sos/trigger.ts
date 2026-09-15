// Self-contained Vercel serverless request/response types
export interface VercelRequest {
  method?: string;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}

export interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
  setHeader: (name: string, value: string) => VercelResponse;
  end: () => void;
}

import nodemailer from 'nodemailer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Helper to sanitize Gmail credentials from environment variables
function getCleanGmailCredentials() {
  const rawUser = process.env.GMAIL_USER;
  const rawPass = process.env.GMAIL_PASS;

  if (!rawUser || !rawPass) return null;

  const cleanUser = rawUser.trim().replace(/^["']|["']$/g, '');
  // Google App Passwords are 16 characters, often formatted with spaces (e.g. "abcd efgh ijkl mnop")
  const cleanPass = rawPass.trim().replace(/^["']|["']$/g, '').replace(/[\s-]+/g, '');

  if (!cleanUser || !cleanPass) return null;

  return { user: cleanUser, pass: cleanPass };
}

// Helper to get nodemailer SMTP transporter
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

// Lazy initialization for Firebase Admin in serverless environment
let cachedDb: FirebaseFirestore.Firestore | null = null;
function getFirebaseDb() {
  if (cachedDb) return cachedDb;

  try {
    const rawCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (!getApps().length) {
      if (rawCreds && rawCreds.trim().startsWith('{')) {
        const saObj = JSON.parse(rawCreds.trim().replace(/^["']+|["']+$/g, ''));
        initializeApp({
          projectId: saObj.project_id || projectId,
          credential: cert(saObj),
        });
      } else if (projectId) {
        initializeApp({ projectId });
      }
    }

    if (getApps().length > 0) {
      cachedDb = getFirestore();
      return cachedDb;
    }
  } catch (e) {
    console.warn('[Vercel SOS API] Firebase Admin not initialized (optional):', e);
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Enable Cross-Origin Resource Sharing (CORS)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
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
    } = body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing required field: userId' });
    }

    const now = new Date();
    const transporter = getTransporter();
    const senderEmail = process.env.GMAIL_USER || 'noreply@safecheck.app';

    // 2. Resolve emergency contacts
    let contacts: any[] = [];
    if (Array.isArray(body.contacts) && body.contacts.length > 0) {
      contacts = body.contacts;
    } else {
      const db = getFirebaseDb();
      if (db) {
        try {
          const snap = await db.collection('contacts').where('userId', '==', userId).get();
          snap.forEach((doc) => contacts.push({ id: doc.id, ...doc.data() }));
        } catch (e) {
          console.warn('[Vercel SOS API] Firestore contacts query note:', e);
        }
      }
    }

    const sosId = body.sosId || `sos_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const appBaseUrl = process.env.APP_URL || (req.headers.host ? `https://${req.headers.host}` : 'https://safecheck.app');
    const guardianLink = `${appBaseUrl}/?guardian=${sosId}`;
    const activeTripId = body.activeTripId || null;
    const sosType = type || body.type || 'manual';

    const lat = typeof latitude === 'number' ? latitude : (typeof body.lat === 'number' ? body.lat : null);
    const lng = typeof longitude === 'number' ? longitude : (typeof body.lng === 'number' ? body.lng : null);
    const resolvedLocUrl = locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null);

    // Filter contacts with valid email addresses
    const validContacts = contacts.filter((c) => {
      if (!c || typeof c.email !== 'string') return false;
      const em = c.email.trim();
      return em.length > 3 && em.includes('@');
    });

    console.log(
      `[Vercel SOS API] Dispatching alert for user "${userName}" (${userId}). Contacts with email: ${validContacts.length}. Transporter ready: ${Boolean(transporter)}`
    );

    const isLowBattery = type === 'low_battery';

    // Construct Subject
    const subject =
      customSubject ||
      (isLowBattery
        ? `🔋 Low Battery Alert: ${userName || 'SafeCheck User'}'s phone battery is low during active trip`
        : isLateEscalation
        ? `⚠️ OVERDUE ARRIVAL ALERT: ${userName || 'SafeCheck User'} has not arrived at ${destination || 'destination'}`
        : `🚨 URGENT SOS ALERT: ${userName || 'A user'} activated One-Tap Emergency SOS!`);

    // Plain text email content
    let emailText = customMessage
      ? `${customMessage}\n\n`
      : (isLowBattery
        ? `🔋 LOW BATTERY SAFETY ALERT\n\n${userName || 'SafeCheck User'} (${userEmail || 'User'})'s phone battery is low during an active trip to "${destination || 'destination'}".\n`
        : isLateEscalation
        ? `⚠️ AUTOMATED TRIP ARRIVAL SAFETY ALERT\n\n${userName} (${userEmail || 'User'}) started a safety check-in for a trip to "${destination || 'destination'}".\n\nThe expected arrival time has passed, the user did not mark themselves as arrived, and they did not respond within the safety check grace period.\n`
        : `URGENT SOS EMERGENCY ALERT\n\n${userName} (${userEmail || 'User'}) activated the One-Tap SOS emergency alert on SafeCheck.\n`);

    if (resolvedLocUrl) {
      emailText += `\n📍 LIVE EMERGENCY LOCATION (Google Maps):\n${resolvedLocUrl}\n`;
    } else if (typeof lat === 'number' && typeof lng === 'number') {
      emailText += `\n📍 LIVE GPS COORDINATES:\nhttps://www.google.com/maps?q=${lat},${lng}\n`;
    }

    emailText += `\n🛡️ LIVE GUARDIAN & STATUS MONITOR LINK (No app install or login required):\n${guardianLink}\n`;
    if (audioEvidence) {
      emailText += `\n🎙️ AUDIO EVIDENCE RECORDED: Rolling audio snapshot recorded at ${audioEvidence.recordedAt || audioEvidence.recorded_at} has been securely captured.\n`;
    }
    emailText += `\nPlease attempt to reach ${userName} immediately or alert emergency services if needed.\n\nSafeCheck SOS Emergency System`;

    // HTML email content
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
        <strong>${userName || 'SafeCheck User'}</strong> (${userEmail || 'SafeCheck User'})
        <p>${customMessage || (isLowBattery ? `Phone battery dropped below 15% during active trip to "${destination || 'destination'}".` : isLateEscalation ? `Scheduled trip to "${destination || 'destination'}" was not marked safe within the grace period.` : 'Triggered the One-Tap Emergency SOS button requesting immediate emergency assistance.')}</p>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #4A3B43;">
        ${isLowBattery
          ? `You are designated as an emergency contact for <strong>${userName || 'this user'}</strong>. This automated alert was triggered because their phone battery dropped below 15% during an active trip. Last known location and trip details are provided below.`
          : `You are designated as an emergency contact for <strong>${userName || 'this user'}</strong>. Please attempt to reach them immediately or contact emergency services if needed.`
        }
      </p>

      <div style="margin: 24px 0;">
        ${(resolvedLocUrl || (typeof lat === 'number' && typeof lng === 'number')) ? `
          <a href="${resolvedLocUrl || `https://www.google.com/maps?q=${lat},${lng}`}" class="action-btn btn-maps" target="_blank" rel="noopener">
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
      deliveredAt?: string;
    }> = [];

    if (validContacts.length === 0) {
      console.warn(`[Vercel SOS API] ⚠️ 0 emergency contacts with email configured for ${userId}.`);
    } else if (!transporter) {
      const errorReason = !process.env.GMAIL_USER || !process.env.GMAIL_PASS
        ? 'GMAIL_USER or GMAIL_PASS environment variable is missing on Vercel.'
        : 'Failed to create SMTP transporter with provided credentials.';

      console.error(`[Vercel SOS API Error] ❌ Cannot send emergency emails: ${errorReason}`);

      for (const contact of validContacts) {
        failedCount++;
        emailResults.push({
          email: contact.email,
          name: contact.name,
          status: 'failed',
          error: errorReason,
        });
      }
    } else {
      await Promise.all(
        validContacts.map(async (contact) => {
          try {
            console.log(`[Vercel SOS API] 📧 Sending emergency alert email to ${contact.email} via Gmail SMTP...`);
            const info = await transporter.sendMail({
              from: `"SafeCheck Emergency" <${senderEmail}>`,
              to: contact.email.trim(),
              subject,
              text: emailText,
              html: emailHtml,
            });

            console.log(`[Vercel SOS API Success] ✅ Email delivered to ${contact.email} | messageId: ${info.messageId}`);
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
          } catch (sendErr: any) {
            failedCount++;
            const errorMessage = sendErr?.message || 'Failed to send email via SMTP';
            console.error(`[Vercel SOS API Error] ❌ Gmail SMTP failed for ${contact.email}:`, errorMessage);
            emailResults.push({
              email: contact.email,
              name: contact.name,
              status: 'failed',
              error: errorMessage,
            });
          }
        })
      );
    }

    // Optional: write event metadata to Firestore if accessible
    const db = getFirebaseDb();
    if (db) {
      try {
        const targetTripId = activeTripId || sosId;
        await db.collection('trips').doc(targetTripId).set(
          {
            id: targetTripId,
            userId,
            userName: userName || 'SafeCheck User',
            userEmail: userEmail || '',
            status: 'alerted',
            alertedAt: now.toISOString(),
            isSosEvent: true,
            sosType,
            sosTimestamp: now.toISOString(),
            latitude: lat,
            longitude: lng,
            locationUrl: resolvedLocUrl,
            notifiedCount: deliveredCount,
            emergencyContactsNotified: validContacts.map((c) => {
              const resObj = emailResults.find((r) => r.email === c.email);
              return {
                id: c.id || '',
                name: c.name || 'Emergency Contact',
                email: c.email || '',
                status: resObj ? resObj.status : 'failed',
                deliveredAt: resObj?.deliveredAt || null,
                messageId: resObj?.messageId || null,
              };
            }),
          },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn('[Vercel SOS API] Firestore trip record notice:', dbErr);
      }
    }

    const dispatchStatus = deliveredCount > 0
      ? (failedCount > 0 ? 'partial' : 'delivered')
      : (validContacts.length === 0 ? 'no_contacts' : (transporter ? 'failed' : 'unconfigured'));

    const primaryError = dispatchStatus === 'failed' || dispatchStatus === 'unconfigured'
      ? (emailResults[0]?.error || 'Failed to deliver emergency emails')
      : (dispatchStatus === 'no_contacts' ? 'No emergency contacts configured with valid email addresses' : null);

    return res.status(200).json({
      success: true,
      sosId,
      tripId: activeTripId || sosId,
      alertId: sosId,
      locationUrl: resolvedLocUrl,
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
      notifiedCount: deliveredCount,
      deliveredCount,
      failedCount,
      emailResults,
    });
  } catch (error: any) {
    console.error('[Vercel SOS API] Error in emergency alert handler:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal Server Error' });
  }
}
