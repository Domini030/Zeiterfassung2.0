import { Capacitor } from '@capacitor/core';
import { Delete, Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { verifyPin } from '../utils/appLock';
import { TaktWerkNative } from '../utils/taktwerkNative';

interface AppLockScreenProps {
  companyName?: string;
  pinHash?: string;
  biometricEnabled?: boolean;
  onUnlock: () => void;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  companyName,
  pinHash,
  biometricEnabled = true,
  onUnlock,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const autoPromptedRef = useRef(false);

  const hasPin = Boolean(pinHash);

  const triggerBiometric = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || biometricBusy) return;
    setBiometricBusy(true);
    setErrorMsg('');
    try {
      const res = await TaktWerkNative.authenticateBiometric({
        title: 'TaktWerk entsperren',
        subtitle: companyName || 'Biometrische Authentifizierung',
      });
      if (res.authenticated) {
        onUnlock();
      } else if (!res.cancelled && res.error) {
        setErrorMsg(res.error);
      }
    } catch {
      setErrorMsg('Biometrische Entsperrung fehlgeschlagen. Bitte PIN eingeben.');
    } finally {
      setBiometricBusy(false);
    }
  }, [biometricBusy, companyName, onUnlock]);

  useEffect(() => {
    let active = true;
    const checkBio = async () => {
      if (!Capacitor.isNativePlatform() || !biometricEnabled) return;
      try {
        const res = await TaktWerkNative.getBiometricAvailability();
        if (!active) return;
        setBiometricAvailable(res.available);
        if (res.available && !autoPromptedRef.current) {
          autoPromptedRef.current = true;
          void triggerBiometric();
        }
      } catch {
        // Biometric unavailable
      }
    };
    void checkBio();
    return () => {
      active = false;
    };
  }, [biometricEnabled, triggerBiometric]);

  const submitPin = useCallback(
    async (candidate: string) => {
      if (!hasPin || verifying || candidate.length < 4) return;
      setVerifying(true);
      setErrorMsg('');
      try {
        const ok = await verifyPin(candidate, pinHash);
        if (ok) {
          setEnteredPin('');
          onUnlock();
        } else {
          setErrorMsg('Falsche PIN. Bitte erneut versuchen.');
          setEnteredPin('');
          if (Capacitor.isNativePlatform()) {
            TaktWerkNative.hapticFeedback({ pattern: 'error' }).catch(() => {});
          }
        }
      } finally {
        setVerifying(false);
      }
    },
    [hasPin, onUnlock, pinHash, verifying]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (verifying) return;
      setErrorMsg('');
      setEnteredPin((prev) => {
        if (prev.length >= 6) return prev;
        const next = prev + d;
        // Auto-verify smoothly on 4, 5, or 6 digits if matching hash
        if (hasPin && next.length >= 4) {
          void verifyPin(next, pinHash).then((ok) => {
            if (ok) {
              setEnteredPin('');
              onUnlock();
            } else if (next.length === 6) {
              setErrorMsg('Falsche PIN. Bitte erneut versuchen.');
              setEnteredPin('');
            }
          });
        }
        return next;
      });
    },
    [hasPin, onUnlock, pinHash, verifying]
  );

  const handleBackspace = useCallback(() => {
    setErrorMsg('');
    setEnteredPin((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter' && enteredPin.length >= 4) {
        e.preventDefault();
        void submitPin(enteredPin);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enteredPin, handleBackspace, handleDigit, submitPin]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="TaktWerk App-Sperre"
      className="fixed inset-0 z-[220] flex flex-col items-center justify-center bg-slate-950/95 px-4 py-8 text-white backdrop-blur-md"
    >
      <div className="w-full max-w-xs rounded-3xl border border-violet-500/25 bg-[#171126] p-6 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/20 text-violet-300 ring-1 ring-violet-500/30">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold tracking-tight text-white">
            TaktWerk gesperrt
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {companyName || 'Bitte entsperre die App zum Fortfahren'}
          </p>
        </div>

        {hasPin && (
          <>
            <div className="mt-6 flex items-center justify-center gap-3" aria-label="PIN Eingabe">
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const filled = idx < enteredPin.length;
                const activeSlot = idx < 4 || enteredPin.length > idx;
                return (
                  <span
                    key={idx}
                    className={`h-3.5 w-3.5 rounded-full border transition-all ${
                      filled
                        ? 'scale-110 border-violet-400 bg-violet-400'
                        : activeSlot
                          ? 'border-slate-500 bg-transparent'
                          : 'border-slate-700/60 bg-transparent opacity-40'
                    }`}
                  />
                );
              })}
            </div>

            {errorMsg ? (
              <p className="mt-3 min-h-[1.25rem] text-center text-xs font-medium text-rose-400">
                {errorMsg}
              </p>
            ) : (
              <p className="mt-3 min-h-[1.25rem] text-center text-[11px] text-slate-400">
                4–6-stellige PIN eingeben
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {DIGITS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDigit(d)}
                  className="flex h-13 items-center justify-center rounded-2xl border border-[#3b2d5e] bg-[#211936] font-mono text-xl font-semibold text-white transition-colors hover:bg-[#2a2045] active:scale-95 cursor-pointer"
                >
                  {d}
                </button>
              ))}

              {biometricAvailable ? (
                <button
                  type="button"
                  onClick={() => void triggerBiometric()}
                  disabled={biometricBusy}
                  aria-label="Mit Fingerabdruck oder Face-ID entsperren"
                  className="flex h-13 items-center justify-center rounded-2xl border border-violet-500/40 bg-violet-600/20 text-violet-300 transition-colors hover:bg-violet-600/30 active:scale-95 cursor-pointer"
                >
                  <Fingerprint className="h-6 w-6" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submitPin(enteredPin)}
                  disabled={enteredPin.length < 4 || verifying}
                  aria-label="PIN bestätigen"
                  className="flex h-13 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-600/20 text-emerald-300 transition-colors hover:bg-emerald-600/30 disabled:opacity-35 cursor-pointer"
                >
                  <ShieldCheck className="h-5 w-5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => handleDigit('0')}
                className="flex h-13 items-center justify-center rounded-2xl border border-[#3b2d5e] bg-[#211936] font-mono text-xl font-semibold text-white transition-colors hover:bg-[#2a2045] active:scale-95 cursor-pointer"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                disabled={enteredPin.length === 0}
                aria-label="Letzte Ziffer löschen"
                className="flex h-13 items-center justify-center rounded-2xl border border-[#3b2d5e] bg-[#211936] text-slate-300 transition-colors hover:bg-[#2a2045] disabled:opacity-35 active:scale-95 cursor-pointer"
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>

            {enteredPin.length >= 4 && (
              <button
                type="button"
                onClick={() => void submitPin(enteredPin)}
                disabled={verifying}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl ui-accent-btn py-2.5 text-sm font-semibold text-white cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" />
                Entsperren
              </button>
            )}
          </>
        )}

        {biometricAvailable && (
          <button
            type="button"
            onClick={() => void triggerBiometric()}
            disabled={biometricBusy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/40 bg-violet-500/15 py-2.5 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/25 cursor-pointer"
          >
            <Fingerprint className="h-4 w-4" />
            {biometricBusy ? 'Warte auf Biometrie…' : 'Mit Biometrie entsperren'}
          </button>
        )}

        {!hasPin && !biometricAvailable && (
          <div className="mt-5 space-y-3 text-center">
            <p className="text-xs text-amber-300">
              Auf diesem Gerät ist keine Biometrie verfügbar und keine PIN hinterlegt.
            </p>
            <button
              type="button"
              onClick={onUnlock}
              className="flex w-full items-center justify-center gap-2 rounded-xl ui-accent-btn py-2.5 text-sm font-semibold text-white cursor-pointer"
            >
              Entsperren
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
