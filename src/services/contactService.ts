import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { EmergencyContact } from '../types';

const CONTACTS_CACHE_KEY_PREFIX = 'safecheck_contacts_';

function sortContactsByPriority(contacts: EmergencyContact[]): EmergencyContact[] {
  return [...contacts].sort((a, b) => {
    const pA = a.priority ?? 999;
    const pB = b.priority ?? 999;
    if (pA !== pB) return pA - pB;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

export function getCachedContacts(userId: string): EmergencyContact[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${CONTACTS_CACHE_KEY_PREFIX}${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as EmergencyContact[];
      return sortContactsByPriority(parsed);
    }
  } catch (e) {
    console.error('Error reading cached contacts:', e);
  }
  return [];
}

export function setCachedContacts(userId: string, contacts: EmergencyContact[]): void {
  try {
    const sorted = sortContactsByPriority(contacts);
    localStorage.setItem(`${CONTACTS_CACHE_KEY_PREFIX}${userId}`, JSON.stringify(sorted));
  } catch (e) {
    console.error('Error setting cached contacts:', e);
  }
}

export async function getUserContacts(userId: string): Promise<EmergencyContact[]> {
  // 1. Primary: Load from Firestore
  try {
    const q = query(collection(db, 'contacts'), where('userId', '==', userId));
    const querySnapshot = await getDocs(q);
    const contacts: EmergencyContact[] = [];

    querySnapshot.forEach((d) => {
      contacts.push({ id: d.id, ...d.data() } as EmergencyContact);
    });

    if (contacts.length > 0) {
      const sorted = sortContactsByPriority(contacts);
      setCachedContacts(userId, sorted);
      return sorted;
    }
  } catch (err) {
    console.error('Error fetching contacts from Firestore in getUserContacts:', err);
  }

  // 2. Secondary: Try server API if Firestore had no contacts or encountered an error
  try {
    const res = await fetch(`/api/contacts?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.contacts) && data.contacts.length > 0) {
        const sorted = sortContactsByPriority(data.contacts);
        setCachedContacts(userId, sorted);
        return sorted;
      }
    }
  } catch (e) {
    console.error('Error fetching contacts from server API:', e);
  }

  // 3. Fallback: Return local cached contacts
  return getCachedContacts(userId);
}

export async function addContact(
  userId: string,
  name: string,
  email: string,
  relation: string,
  phone?: string,
  priority?: number
): Promise<string> {
  const currentCached = getCachedContacts(userId);
  const assignedPriority = priority !== undefined ? priority : currentCached.length + 1;
  const createdAt = new Date().toISOString();

  const newContactPayload = {
    userId,
    name,
    email,
    relation,
    phone: phone || '',
    priority: assignedPriority,
    createdAt,
  };

  let createdContactId = '';

  // 1. PRIMARY: Write directly to Firestore
  try {
    const docRef = await addDoc(collection(db, 'contacts'), newContactPayload);
    createdContactId = docRef.id;
  } catch (firestoreErr) {
    console.error('Error adding contact to Firestore:', firestoreErr);
  }

  // Fallback ID if offline / Firestore write failed
  if (!createdContactId) {
    createdContactId = `contact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  const createdContact: EmergencyContact = {
    id: createdContactId,
    ...newContactPayload,
  };

  // Update local cache immediately
  setCachedContacts(userId, [...currentCached, createdContact]);

  // 2. SECONDARY: Sync to backend server in background without blocking or returning early
  try {
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newContactPayload,
        id: createdContactId,
      }),
    });
  } catch (serverErr) {
    console.error('Error syncing added contact to backup server endpoint:', serverErr);
  }

  return createdContactId;
}

export async function updateContact(
  contactId: string,
  data: Partial<Omit<EmergencyContact, 'id' | 'userId'>>,
  userId?: string
): Promise<void> {
  // Update local cache
  if (userId) {
    const cached = getCachedContacts(userId);
    const updated = cached.map((c) => (c.id === contactId ? { ...c, ...data } : c));
    setCachedContacts(userId, updated);
  }

  // 1. PRIMARY: Update Firestore
  try {
    if (!contactId.startsWith('offline_') && !contactId.startsWith('contact_local_')) {
      const docRef = doc(db, 'contacts', contactId);
      await updateDoc(docRef, data);
    }
  } catch (firestoreErr) {
    console.error(`Error updating contact ${contactId} in Firestore:`, firestoreErr);
  }

  // 2. SECONDARY: Update backend server
  try {
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (serverErr) {
    console.error(`Error updating contact ${contactId} on backup server:`, serverErr);
  }
}

export async function reorderContacts(
  userId: string,
  reorderedContacts: EmergencyContact[]
): Promise<void> {
  // Assign sequential priorities 1, 2, 3...
  const updatedList = reorderedContacts.map((c, index) => ({
    ...c,
    priority: index + 1,
  }));

  // Update local cache immediately
  setCachedContacts(userId, updatedList);

  // 1. PRIMARY: Update Firestore in batch or sequential updates
  try {
    const batch = writeBatch(db);
    for (const c of updatedList) {
      if (!c.id.startsWith('offline_') && !c.id.startsWith('contact_local_')) {
        const contactRef = doc(db, 'contacts', c.id);
        batch.update(contactRef, { priority: c.priority });
      }
    }
    await batch.commit();
  } catch (firestoreBatchErr) {
    console.error('Error committing batch reorder in Firestore, attempting individual writes:', firestoreBatchErr);
    // Fallback single updates
    for (const c of updatedList) {
      if (!c.id.startsWith('offline_') && !c.id.startsWith('contact_local_')) {
        try {
          await updateDoc(doc(db, 'contacts', c.id), { priority: c.priority });
        } catch (individualErr) {
          console.error(`Error updating priority for contact ${c.id}:`, individualErr);
        }
      }
    }
  }

  // 2. SECONDARY: Update server in background
  try {
    await fetch('/api/contacts/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, contacts: updatedList }),
    });
  } catch (serverErr) {
    console.error('Error syncing reordered contacts to backup server:', serverErr);
  }
}

export async function deleteContact(contactId: string, userId?: string): Promise<void> {
  // Update local cache
  if (userId) {
    const cached = getCachedContacts(userId);
    const updated = cached.filter((c) => c.id !== contactId);
    // Re-index remaining priorities
    const reindexed = updated.map((c, i) => ({ ...c, priority: i + 1 }));
    setCachedContacts(userId, reindexed);
  }

  // 1. PRIMARY: Delete from Firestore
  try {
    if (!contactId.startsWith('offline_') && !contactId.startsWith('contact_local_')) {
      const docRef = doc(db, 'contacts', contactId);
      await deleteDoc(docRef);
    }
  } catch (firestoreErr) {
    console.error(`Error deleting contact ${contactId} from Firestore:`, firestoreErr);
  }

  // 2. SECONDARY: Delete from server
  try {
    await fetch(`/api/contacts/${contactId}`, {
      method: 'DELETE',
    });
  } catch (serverErr) {
    console.error(`Error deleting contact ${contactId} from backup server:`, serverErr);
  }
}

export function subscribeContacts(userId: string, callback: (contacts: EmergencyContact[]) => void) {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    callback([]);
    return () => {};
  }

  // 1. Emit cached contacts immediately for instant UI render without flicker
  const cached = getCachedContacts(userId);
  if (cached && cached.length > 0) {
    callback(cached);
  }

  // 2. Firestore snapshot listener as the PRIMARY live-update mechanism
  let unsubFirestore = () => {};
  try {
    const q = query(collection(db, 'contacts'), where('userId', '==', userId));
    unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        const contacts: EmergencyContact[] = [];
        snapshot.forEach((d) => {
          contacts.push({ id: d.id, ...d.data() } as EmergencyContact);
        });
        const sorted = sortContactsByPriority(contacts);
        setCachedContacts(userId, sorted);
        callback(sorted);
      },
      (error) => {
        console.warn('Firestore snapshot notice for contacts (using cached/server data):', error?.message || error);
        getUserContacts(userId).then((contacts) => {
          if (contacts && contacts.length > 0) callback(contacts);
        }).catch(() => {});
      }
    );
  } catch (snapshotErr) {
    console.warn('Failed to attach Firestore snapshot listener for contacts, falling back to server:', snapshotErr);
    getUserContacts(userId).then((contacts) => {
      if (contacts && contacts.length > 0) callback(contacts);
    }).catch(() => {});
  }

  return () => {
    unsubFirestore();
  };
}
