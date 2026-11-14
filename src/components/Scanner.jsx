import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { Button, inputClass } from './ui.jsx';

const FEEDBACK_STYLES = {
  ok: 'bg-brand-green-tint text-brand-green-dark',
  warning: 'bg-warning/15 text-amber-800',
  error: 'bg-critical/10 text-critical',
};
const REPEAT_GAP_MS = 2500; // ignore the same tag held in front of the camera

// Full-width scanner for phones. onScan(text, { typed }) is called once per
// tag and returns { kind: 'ok' | 'warning' | 'error', message } to show.
// allowTyping adds a box for entering a code by hand when a QR will not read.
export default function Scanner({ onScan, allowTyping = true }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const lastRef = useRef({ text: '', at: 0 });
  const busyRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [typed, setTyped] = useState('');

  const handle = async (text, options) => {
    if (busyRef.current) return;
    const now = Date.now();
    if (!options.typed && text === lastRef.current.text && now - lastRef.current.at < REPEAT_GAP_MS) return;
    lastRef.current = { text, at: now };
    busyRef.current = true;
    try {
      const result = await onScanRef.current(text, options);
      if (result) setFeedback(result);
      if (result?.kind === 'ok' && navigator.vibrate) navigator.vibrate(60);
    } catch (err) {
      setFeedback({ kind: 'error', message: err.message });
    } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    if (!cameraOn) return undefined;
    let stopped = false;
    const scanner = new QrScanner(videoRef.current, (result) => handle(result.data, { typed: false }), {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      maxScansPerSecond: 8,
      returnDetailedScanResult: true,
    });
    scannerRef.current = scanner;
    scanner.start().catch(() => {
      if (stopped) return;
      setCameraOn(false);
      setCameraError('The camera could not be opened. Allow camera access for this site, or type the code instead.');
    });
    return () => {
      stopped = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  const onTypedSubmit = (e) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    handle(text, { typed: true });
  };

  return (
    <div className="space-y-3">
      <div className={`relative overflow-hidden rounded-xl bg-ink ${cameraOn ? '' : 'hidden'}`}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="aspect-square w-full object-cover sm:aspect-video" playsInline muted />
      </div>

      {cameraOn ? (
        <Button variant="secondary" className="w-full py-4 text-base" onClick={() => setCameraOn(false)}>
          <CameraOff size={20} /> Stop Camera
        </Button>
      ) : (
        <Button className="w-full py-4 text-base" onClick={() => { setCameraError(''); setCameraOn(true); }}>
          <Camera size={20} /> Scan with Camera
        </Button>
      )}
      {cameraError && <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{cameraError}</p>}

      <div aria-live="polite" className="min-h-[52px]">
        {feedback && (
          <p className={`rounded-lg px-4 py-3 text-base font-medium ${FEEDBACK_STYLES[feedback.kind]}`}>{feedback.message}</p>
        )}
      </div>

      {allowTyping && (
        <form onSubmit={onTypedSubmit} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Type a tag code</span>
            <Keyboard size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type the code, e.g. FAF-000123-K"
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              className={`${inputClass} mt-0 py-3 pl-9 uppercase placeholder:normal-case`}
            />
          </label>
          <Button type="submit" variant="secondary">Add</Button>
        </form>
      )}
    </div>
  );
}
