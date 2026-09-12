/**
 * SafeCheck Firebase Cloud Functions
 * Scheduled checkTrips worker running every 1 minute.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// Initialize custom firestore database ID if needed, or default
const db = admin.firestore();

// Setup Nodemailer Transporter using functions.config() or environment variables
function getTransporter() {
  const gmailUser = functions.config().gmail?.user || process.env.GMAIL_USER;
  const gmailPass = functions.config().gmail?.pass || process.env.GMAIL_PASS;

  if (gmailUser && gmailPass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });
  }
  return null;
}

/**
 * Scheduled Cloud Function running every 1 minute
 */
exports.checkTrips = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const now = new Date();
    console.log(`[SafeCheck checkTrips] Running trip monitor at ${now.toISOString()}`);

    const transporter = getTransporter();
    const gmailUser = functions.config().gmail?.user || process.env.GMAIL_USER || 'noreply@safecheck.app';

    // ---------------------------------------------------------
    // STAGE 1: REMINDER (active -> reminded)
    // ---------------------------------------------------------
    try {
      const activeTripsSnap = await db.collection('trips').where('status', '==', 'active').get();

      for (const doc of activeTripsSnap.docs) {
        const trip = doc.data();
        const tripId = doc.id;
        const startTime = new Date(trip.startTime);
        const durationMs = (trip.durationMinutes || 15) * 60 * 1000;
        const expectedArrival = new Date(startTime.getTime() + durationMs);

        if (now >= expectedArrival) {
          console.log(`[Stage 1] Trip ${tripId} elapsed. Sending reminder to user ${trip.userId}`);

          // Fetch user details
          let userEmail = trip.userEmail;
          let userName = trip.userName || 'SafeCheck User';

          if (!userEmail) {
            const userDoc = await db.collection('users').doc(trip.userId).get();
            if (userDoc.exists) {
              userEmail = userDoc.data().email;
              userName = userDoc.data().name || userName;
            }
          }

          if (userEmail) {
            const subject = `⚠️ SafeCheck Safety Reminder: Are you safe?`;
            const text = `Hi ${userName},\n\nYour expected trip duration for "${trip.destination}" has ended.\n\nPlease open the SafeCheck app immediately and tap "I'm Safe" to confirm your safety.\n\nIf you do not confirm within ${trip.graceMinutes || 10} minutes, your emergency contacts will be notified automatically.\n\nSafeCheck System`;

            if (transporter) {
              await transporter.sendMail({
                from: `"SafeCheck" <${gmailUser}>`,
                to: userEmail,
                subject,
                text,
              });
              console.log(`[Stage 1] Reminder email sent to ${userEmail}`);
            } else {
              console.log(`[Stage 1] [Simulated Email] To: ${userEmail}\nSubject: ${subject}\n${text}`);
            }
          }

          // Update trip status to "reminded" and set reminderSentAt
          await db.collection('trips').doc(tripId).update({
            status: 'reminded',
            reminderSentAt: now.toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('[Stage 1 Error]', err);
    }

    // ---------------------------------------------------------
    // STAGE 2: ESCALATION / ALERT (reminded -> alerted)
    // ---------------------------------------------------------
    try {
      const remindedTripsSnap = await db.collection('trips').where('status', '==', 'reminded').get();

      for (const doc of remindedTripsSnap.docs) {
        const trip = doc.data();
        const tripId = doc.id;

        if (trip.reminderSentAt) {
          const reminderTime = new Date(trip.reminderSentAt);
          const graceMs = (trip.graceMinutes || 10) * 60 * 1000;
          const deadline = new Date(reminderTime.getTime() + graceMs);

          if (now >= deadline) {
            console.log(`[Stage 2] Grace period expired for trip ${tripId}. Alerting contacts for user ${trip.userId}`);

            // Lookup emergency contacts for user
            const contactsSnap = await db
              .collection('contacts')
              .where('userId', '==', trip.userId)
              .get();

            const contacts = [];
            contactsSnap.forEach((c) => contacts.push(c.data()));

            let userName = trip.userName || 'a SafeCheck user';
            const userEmail = trip.userEmail || '';

            if (contacts.length === 0) {
              console.warn(`[Stage 2 Warning] User ${trip.userId} has 0 emergency contacts saved. Skipping email sending.`);
            } else {
              for (const contact of contacts) {
                if (!contact.email) continue;

                const subject = `🚨 EMERGENCY ALERT: ${userName} has not checked in!`;
                const text = `URGENT SAFETY ALERT\n\n${userName} (${userEmail}) started a safety check-in trip to "${trip.destination}" on ${new Date(trip.startTime).toLocaleString()}.\n\nThey have not confirmed their safety after their expected arrival time and grace period (${trip.graceMinutes} mins).\n\nPlease try contacting ${userName} immediately or check on their situation.\n\nSafeCheck Emergency System`;

                if (transporter) {
                  await transporter.sendMail({
                    from: `"SafeCheck Emergency" <${gmailUser}>`,
                    to: contact.email,
                    subject,
                    text,
                  });
                  console.log(`[Stage 2] Alert email sent to contact ${contact.name} <${contact.email}>`);
                } else {
                  console.log(`[Stage 2] [Simulated Email] To: ${contact.email}\nSubject: ${subject}\n${text}`);
                }
              }
            }

            // Update trip status to "alerted"
            await db.collection('trips').doc(tripId).update({
              status: 'alerted',
              alertedAt: now.toISOString(),
            });
          }
        }
      }
    } catch (err) {
      console.error('[Stage 2 Error]', err);
    }

    return null;
  });
