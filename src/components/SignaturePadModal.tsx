import { CheckCircle2, Eraser, Loader2, MapPin, PenTool, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AcceptanceSignature } from '../types';
import { captureCurrentLocation, formatLocationLabel } from '../utils/geolocation';

interface SignaturePadModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  initialSignature?: AcceptanceSignature | null;
  defaultSignerName?: string;
  onClose: () => void;
  onSave: (signature: AcceptanceSignature) => void;
}

export function SignaturePadModal({
  open,
  title,
  subtitle,
  initialSignature,
  defaultSignerName = '',
  onClose,
  onSave,
}: SignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [signedBy, setSignedBy] = useState(defaultSignerName);
  const [signedRole, setSignedRole] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSignedBy(initialSignature?.signedBy || defaultSignerName || '');
    setSignedRole(initialSignature?.signedRole || '');
    setLocationAddress(initialSignature?.locationAddress || '');
    setNotes(initialSignature?.notes || '');
    setError(null);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (initialSignature?.signatureDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setHasStroke(true);
      };
      img.src = initialSignature.signatureDataUrl;
    } else {
      setHasStroke(false);
    }
  }, [open, initialSignature, defaultSignerName]);

  if (!open) return null;

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    drawingRef.current = true;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHasStroke(true);
    setError(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const handleCaptureGps = async () => {
    setLocating(true);
    try {
      const snap = await captureCurrentLocation();
      setLocationAddress(formatLocationLabel(snap));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Standort konnte nicht ermittelt werden.'
      );
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasStroke) {
      setError('Bitte direkt im Unterschriftsfeld unterzeichnen.');
      return;
    }
    if (!signedBy.trim()) {
      setError('Bitte den Namen des Unterzeichners angeben.');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL('image/png');
    onSave({
      signedBy: signedBy.trim(),
      signedRole: signedRole.trim() || undefined,
      signedAt: new Date().toISOString(),
      locationAddress: locationAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      signatureDataUrl,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-no-swipe="true"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/65 p-3 backdrop-blur-sm sm:p-4"
    >
      <div
        data-no-swipe="true"
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#342653] dark:bg-[#19122c]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2e234a]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
              <PenTool className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">
                {title}
              </h3>
              {subtitle && (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200">
              {error}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Unterschrift auf dem Display (Finger oder Stift)
              </label>
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#2a2045] cursor-pointer"
              >
                <Eraser className="h-3.5 w-3.5" />
                Leeren
              </button>
            </div>
            <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white dark:border-violet-500/40">
              <canvas
                ref={canvasRef}
                width={720}
                height={240}
                data-no-swipe="true"
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="block h-44 w-full touch-none cursor-crosshair sm:h-48"
              />
              {!hasStroke && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium text-slate-400">
                    Hier direkt unterschreiben...
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Name des Unterzeichners *
              </label>
              <input
                type="text"
                required
                value={signedBy}
                onChange={(e) => setSignedBy(e.target.value)}
                placeholder="Vor- und Nachname"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Funktion / Rolle (optional)
              </label>
              <input
                type="text"
                value={signedRole}
                onChange={(e) => setSignedRole(e.target.value)}
                placeholder="z. B. Geschäftsführung, Bauleitung"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Abnahmeort (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                placeholder="Adresse oder Standort..."
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
              />
              <button
                type="button"
                disabled={locating}
                onClick={handleCaptureGps}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MapPin className="h-3.5 w-3.5" />
                )}
                GPS
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Abnahmehinweis / Mängelfrei-Vermerk (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Anlage vollständig geprüft & übergeben"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4 dark:border-[#2e234a]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#2a2045] cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg ui-accent-btn px-4 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              Abnahme speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
