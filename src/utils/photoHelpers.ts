import type { WorkPhoto } from '../types';
import { apiUploadNextcloudFile } from './apiClient';
import { createId } from './format';

const MAX_PHOTO_DIMENSION = 1280;
const JPEG_QUALITY = 0.78;

export async function compressWorkPhotoFile(file: File, caption = ''): Promise<WorkPhoto> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      if (!rawUrl.startsWith('data:image/')) {
        reject(new Error('Bitte wähle eine gültige Bilddatei (JPG, PNG, WebP).'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
            const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawUrl);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          resolve(compressed);
        } catch {
          resolve(rawUrl);
        }
      };
      img.onerror = () => reject(new Error('Foto konnte nicht geladen werden.'));
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });

  return {
    id: createId('photo'),
    dataUrl,
    caption: caption.trim() || undefined,
    capturedAt: new Date().toISOString(),
  };
}

export async function uploadWorkPhotoToNextcloud(
  photo: WorkPhoto,
  taskTitle: string
): Promise<string> {
  const match = photo.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Ungültige Fotodaten für Nextcloud-Upload.');
  }
  const mime = match[1] || 'image/jpeg';
  const base64 = match[2];
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const dateObj = new Date(photo.capturedAt);
  const ym = Number.isNaN(dateObj.getTime())
    ? new Date().toISOString().slice(0, 7)
    : `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
  const dateStamp = photo.capturedAt.slice(0, 10);
  const safeTitle = (taskTitle || 'Einsatz')
    .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_')
    .slice(0, 32);
  const shortId = photo.id.slice(-6);
  const filename = `${dateStamp}_${safeTitle}_${shortId}.${ext}`;

  const res = await apiUploadNextcloudFile({
    subFolder: `Einsatzfotos/${ym}`,
    filename,
    contentOrBase64: base64,
    isBinary: true,
    contentType: mime,
  });
  return res.path;
}
