import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import { storage, auth } from './firebase';

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  code?: 'SIZE_EXCEEDED' | 'INVALID_TYPE' | 'NO_FILE';
}

/**
 * Validates selected file for profile photo upload (max 5MB, JPG/PNG/WEBP)
 */
export function validateAvatarFile(file?: File | null): FileValidationResult {
  if (!file) {
    return {
      valid: false,
      code: 'NO_FILE',
      error: 'Please select an image file to upload.',
    };
  }

  const isTypeAllowed =
    ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase()) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!isTypeAllowed) {
    return {
      valid: false,
      code: 'INVALID_TYPE',
      error: 'Unsupported image format. Please select a JPG, PNG, or WEBP file.',
    };
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      code: 'SIZE_EXCEEDED',
      error: `File size (${sizeInMB}MB) exceeds the 5MB limit. Please choose a smaller photo.`,
    };
  }

  return { valid: true };
}

/**
 * Compresses/resizes a high-resolution user image on an in-memory HTML5 Canvas
 * into a lightweight, crisp web-optimized avatar string.
 */
export function compressAvatarImage(
  file: File,
  maxDimension = 512,
  quality = 0.88
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        // Draw image onto canvas with smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to webp or jpeg data url
        const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outputMime, quality);
        resolve(dataUrl);
      };
      img.onerror = () => {
        // Fallback to raw data url if canvas image decode fails
        resolve(e.target?.result as string);
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a profile avatar with fast progress updates and immediate multi-layer fallback.
 * First tries Firebase Storage with a 3.5s timeout; if storage bucket is uninitialized
 * or blocked by CORS, it seamlessly persists via the server endpoint to Firestore.
 */
export async function uploadProfileAvatar(
  userId: string,
  file: File,
  onProgress?: (progressPercent: number) => void
): Promise<string> {
  const validation = validateAvatarFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid image file.');
  }

  const targetUid = userId || auth.currentUser?.uid;
  if (!targetUid) {
    throw new Error('User authentication required to upload profile photo.');
  }

  if (onProgress) onProgress(20);

  // 1. Optimize image in client memory
  const compressedDataUrl = await compressAvatarImage(file, 512, 0.88);
  if (onProgress) onProgress(40);

  // 2. Derive file extension & Storage path
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const cleanExt = ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'jpg';
  const fileName = `avatar_${Date.now()}.${cleanExt}`;
  const storagePath = `users/${targetUid}/${fileName}`;

  // 3. Attempt direct Firebase Storage with a 3.5-second fail-fast timeout
  try {
    const uploadWithTimeout = new Promise<string>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Storage timeout - switching to resilient storage proxy'));
      }, 3500);

      try {
        const storageRef = ref(storage, storagePath);
        const metadata = {
          contentType: file.type || `image/${cleanExt}`,
          cacheControl: 'public, max-age=31536000',
        };

        if (onProgress) onProgress(60);
        await uploadBytes(storageRef, file, metadata);
        const downloadURL = await getDownloadURL(storageRef);
        clearTimeout(timer);
        if (onProgress) onProgress(100);
        resolve(downloadURL);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });

    return await uploadWithTimeout;
  } catch (storageErr) {
    console.warn('[SafeCheck Storage] Direct storage unavailable, syncing via resilient backend:', storageErr);
    if (onProgress) onProgress(75);

    // 4. Fallback to resilient server proxy (which saves to Firestore and in-memory store)
    try {
      const fallbackUrl = await uploadViaServerFallback(targetUid, compressedDataUrl, file);
      if (onProgress) onProgress(100);
      return fallbackUrl;
    } catch (fallbackError: any) {
      console.error('[SafeCheck Storage] Server proxy photo upload error:', fallbackError);
      // If server route also had an issue, the compressed data URL is still valid for immediate Firestore save
      if (compressedDataUrl && compressedDataUrl.startsWith('data:image/')) {
        if (onProgress) onProgress(100);
        return compressedDataUrl;
      }
      throw new Error(
        fallbackError.message ||
        'Failed to upload profile photo. Please check your network connection and try again.'
      );
    }
  }
}

/**
 * Fallback helper that uploads compressed image data to backend
 */
async function uploadViaServerFallback(
  userId: string,
  photoDataUrl: string,
  file: File
): Promise<string> {
  const res = await fetch(`/api/user/${userId}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photoData: photoDataUrl,
      contentType: file.type || 'image/jpeg',
      filename: file.name,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server photo upload failed with status ${res.status}`);
  }

  const data = await res.json();
  return data.photoURL || data.url || photoDataUrl;
}

/**
 * Helper to convert a File to data URL for immediate local preview
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file data.'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading local file.'));
    reader.readAsDataURL(file);
  });
}
