# SafeCheck — Women's Safety Check-In Application

**SafeCheck** is a full-stack privacy-first safety check-in application built with React, TypeScript, Express, Firebase Authentication, Cloud Firestore, and Firebase Cloud Functions.

## Concept & Two-Stage Escalation

Users start a check-in "trip" before walking home, taking a cab, or traveling alone. They specify a destination and expected duration. **No GPS location permissions are requested or used.**

If the user does not confirm safety after the duration ends:
1. **Stage 1 (Reminder):** The scheduled backend worker/Cloud Function sends a soft reminder email directly to the user ("Did you reach safely? Please confirm in the app.").
2. **Stage 2 (Escalation):** If the user still doesn't respond within a grace period (e.g. 10 minutes), their saved emergency contacts receive an urgent email alert.

This two-stage escalation prevents false alarms while guaranteeing escalation when needed.

---

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Backend Server:** Express.js full-stack Node server with live background trip evaluator
- **Database & Auth:** Firebase Authentication & Cloud Firestore
- **Scheduled Cloud Function:** Firebase Cloud Functions v2 + Nodemailer (Gmail App Password)

---

## Project Structure

```
├── README.md                      # Complete setup & deployment guide
├── firebase-applet-config.json     # Firebase app credentials & custom Firestore DB ID
├── firebase-blueprint.json        # Firestore entities schema representation
├── firestore.rules                # Firestore security rules
├── server.ts                      # Full-stack Express server & background worker
├── functions/
│   ├── package.json               # Cloud Function dependencies (firebase-admin, nodemailer)
│   └── index.js                   # Scheduled checkTrips Cloud Function (Stage 1 & Stage 2)
└── src/
    ├── App.tsx                    # Main App router & real-time Firebase subscriptions
    ├── types.ts                   # Global TypeScript definitions
    ├── components/
    │   ├── Navbar.tsx             # Main header with active trip indicator
    │   ├── Footer.tsx             # Footer links & privacy guarantee
    │   └── SystemLogDrawer.tsx    # Live monitor drawer for testing email alerts
    ├── services/
    │   ├── firebase.ts            # Firebase app, auth, and custom Firestore init
    │   ├── authService.ts         # User auth & profile management
    │   ├── contactService.ts      # Emergency contact CRUD operations
    │   └── tripService.ts         # Safety trip creation & status updates
    └── pages/
        ├── Home.tsx               # Explainer & landing view
        ├── Auth.tsx               # Login/Signup view with fast demo account option
        ├── Dashboard.tsx          # Start trip CTA, active trip card & trip history list
        ├── Contacts.tsx           # Emergency contact list, Add/Edit/Delete forms
        ├── StartTrip.tsx          # Destination, duration, and grace period selection
        ├── ActiveTrip.tsx         # Live countdown timer & large "I'm Safe" action button
        ├── TripHistory.tsx        # Filterable trip archive
        └── About.tsx              # Detailed how-it-works & future roadmap
```

---

## Backend Cloud Functions Setup Instructions

Follow these commands to deploy the backend Cloud Function and Firestore Security Rules:

```bash
# 1. Log in to Firebase CLI
firebase login

# 2. Initialize Firestore and Functions in your project
firebase init firestore functions

# 3. Install Nodemailer inside the functions directory
cd functions && npm install nodemailer

# 4. Set your Gmail credentials for sending emails
firebase functions:config:set gmail.user="youraddress@gmail.com" gmail.pass="your-16-char-app-password"

# 5. Deploy Cloud Functions and Firestore Security Rules
firebase deploy --only functions,firestore:rules
```

---

## Deployment Guide

### Frontend Deployment
- Build static assets:
  ```bash
  npm run build
  ```
- Deploy to Firebase Hosting:
  ```bash
  firebase deploy --only hosting
  ```
*(Alternatively, deploy the `dist/` directory to Vercel or Netlify).*

---

## Testing Notes & Demoing

1. **Fast Test Mode:** When creating a trip, choose `⚡ 1 Minute (Fast Demo Testing)` duration and `⚡ 1 Minute Grace` period to test the complete Stage 1 reminder → Stage 2 alert cycle in under 2 minutes!
2. **Live Monitor Drawer:** Click **"Live Monitor"** in the top navbar to see real-time backend trip evaluation logs, SMTP status, and captured email contents directly inside the app UI.
3. **Zero Contact Handling:** If a user has 0 contacts saved when grace period expires, the server gracefully logs a warning and skips email dispatch without crashing.
4. **Duplicate Prevention:** Trip status transitions (`active` → `reminded` → `alerted` / `safe` / `cancelled`) ensure each notification stage is executed exactly once per trip.

---

## Firestore Data Model & Security Rules

### Data Model
- `users/{uid}`: `{ name, email }`
- `contacts/{contactId}`: `{ userId, name, email, relation, phone }`
- `trips/{tripId}`: `{ userId, destination, startTime, durationMinutes, graceMinutes, status, reminderSentAt, safeAt, alertedAt, cancelledAt }`

### Security Rules Summary
- Unauthenticated access is completely denied.
- Users can read/write their own user profile, emergency contacts, and trips (`request.auth.uid == resource.data.userId`).

---

## Future Scope
- **SMS Notifications:** Twilio integration alongside email.
- **Multi-tier Escalation:** Alert primary contact first, then secondary contact after 5 minutes.
- **Privacy Auto-Pruning:** Auto-delete trip records older than 30 days.
