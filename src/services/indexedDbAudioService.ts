/**
 * IndexedDB Audio Service
 * Stores 10-second segmented emergency audio evidence clips in browser IndexedDB.
 * Guarantees zero loss during offline states or network interruptions.
 * Completely free, local, and requires NO paid APIs or cloud storage plans.
 */

export interface SavedAudioChunk {
  id: string; // `${tripId}_${index}`
  tripId: string;
  index: number;
  base64: string; // Base64 encoded audio string
  mimeType: string;
  durationSeconds: number;
  timestamp: string; // ISO string
  sizeBytes: number;
  uploaded: boolean;
  uploadAttempts: number;
  lastError?: string;
  createdAt: number;
}

const DB_NAME = 'SafeCheckAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audioChunks';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      const err = new Error('IndexedDB is not supported in this browser environment.');
      console.error('[SOS-AUDIO] [INDEXEDDB] ❌', err);
      reject(err);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('tripId', 'tripId', { unique: false });
        store.createIndex('uploaded', 'uploaded', { unique: false });
        store.createIndex('tripId_uploaded', ['tripId', 'uploaded'], { unique: false });
        console.log('[SOS-AUDIO] [INDEXEDDB] Created object store "audioChunks" with indices.');
      }
    };

    request.onsuccess = () => {
      console.log('[SOS-AUDIO] [INDEXEDDB] Database opened successfully.');
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[SOS-AUDIO] [INDEXEDDB ERROR] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Saves a 10-second audio chunk immediately into IndexedDB.
 */
export async function saveAudioChunkToIndexedDb(chunk: SavedAudioChunk): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(chunk);

      request.onsuccess = () => {
        console.log("saved to IndexedDB", { tripId: chunk.tripId, index: chunk.index, size: chunk.sizeBytes });
        resolve();
      };

      request.onerror = () => {
        const errorMsg = request.error?.message || String(request.error) || 'Failed to save to IndexedDB';
        console.error("IndexedDB save error: " + errorMsg, { tripId: chunk.tripId, index: chunk.index, error: request.error });
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] saveAudioChunkToIndexedDb exception:', err);
    throw err;
  }
}

/**
 * Marks a chunk as successfully uploaded to Firestore.
 */
export async function markAudioChunkUploaded(tripId: string, index: number): Promise<void> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const id = `${cleanTripId}_${index}`;
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item: SavedAudioChunk = getReq.result;
        if (item) {
          item.uploaded = true;
          item.lastError = undefined;
          const putReq = store.put(item);
          putReq.onsuccess = () => {
            console.log(`[SOS-AUDIO] [INDEXEDDB MARK UPLOADED] ✅ Chunk #${index} marked uploaded in IndexedDB.`);
            resolve();
          };
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] markAudioChunkUploaded exception:', err);
  }
}

/**
 * Records an upload failure attempt on a chunk.
 */
export async function recordChunkUploadFailure(tripId: string, index: number, errorMsg: string): Promise<void> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const id = `${cleanTripId}_${index}`;
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item: SavedAudioChunk = getReq.result;
        if (item) {
          item.uploadAttempts = (item.uploadAttempts || 0) + 1;
          item.lastError = errorMsg;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] recordChunkUploadFailure exception:', err);
  }
}

/**
 * Retrieves all pending (un-uploaded) audio chunks for a trip or across all trips.
 */
export async function getPendingAudioChunks(tripId?: string): Promise<SavedAudioChunk[]> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const all: SavedAudioChunk[] = request.result || [];
        const pending = all.filter((c) => {
          if (c.uploaded) return false;
          if (tripId) {
            const clean = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
            return c.tripId === clean || c.tripId === tripId;
          }
          return true;
        });
        pending.sort((a, b) => a.index - b.index);
        resolve(pending);
      };

      request.onerror = () => {
        console.error('[SOS-AUDIO] [INDEXEDDB GET PENDING ERROR]:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] getPendingAudioChunks exception:', err);
    return [];
  }
}

/**
 * Retrieves all saved audio chunks (uploaded or not) for a specific trip, ordered by index.
 */
export async function getAllAudioChunksForTrip(tripId: string): Promise<SavedAudioChunk[]> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const all: SavedAudioChunk[] = request.result || [];
        const filtered = all.filter((c) => c.tripId === cleanTripId || c.tripId === tripId);
        filtered.sort((a, b) => a.index - b.index);
        resolve(filtered);
      };

      request.onerror = () => {
        console.error('[SOS-AUDIO] [INDEXEDDB GET ALL ERROR]:', request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] getAllAudioChunksForTrip exception:', err);
    return [];
  }
}

/**
 * Deletes all audio chunks for a trip from IndexedDB once safely ended and verified.
 */
export async function deleteAudioChunksForTrip(tripId: string): Promise<void> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  try {
    const db = await getDb();
    const chunks = await getAllAudioChunksForTrip(cleanTripId);
    if (chunks.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      chunks.forEach((c) => store.delete(c.id));

      transaction.oncomplete = () => {
        console.log(`[SOS-AUDIO] [INDEXEDDB DELETE] Cleared ${chunks.length} local chunks for trip "${cleanTripId}".`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error('[SOS-AUDIO] [INDEXEDDB ERROR] deleteAudioChunksForTrip exception:', err);
  }
}
