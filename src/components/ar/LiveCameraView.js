'use client';
/* Live AR camera: the shopper's selfie video with the jewellery tracked
   to their face (MediaPipe Face Landmarker). Draws into the canvas the
   parent owns, so Save / Share work the same as in AI Model Studio. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiRotateCcw } from 'react-icons/fi';
import { anchorsFromLandmarks, placeJewellery } from '@/lib/tryOn';
import { createFaceLandmarker, makeCutout, drawJewellery } from '@/lib/tryOnClient';

export default function LiveCameraView({ productId = null, productImage, cutoutReady = false, kind, canvasRef, adjustRef, onReadyChange }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const cutoutRef = useRef(null);
  const faceSeenRef = useRef(false);
  const [status, setStatus] = useState('loading'); // loading | ready | no-face | detecting | error
  const [message, setMessage] = useState('Loading face tracking…');

  useEffect(() => {
    let live = true;
    makeCutout(productImage, { ready: cutoutReady, productId }).then((c) => { if (live) cutoutRef.current = c; }).catch(() => {});
    return () => { live = false; };
  }, [productImage, cutoutReady, productId]);

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const render = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    frameRef.current = requestAnimationFrame(render);
    if (!video || !canvas || !landmarker || video.readyState < 2 || !video.videoWidth) return;

    const W = video.videoWidth;
    const H = video.videoHeight;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    /* Mirror, like a selfie camera. */
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    let result;
    try { result = landmarker.detectForVideo(video, performance.now()); } catch { return; }
    const lm = result?.faceLandmarks?.[0];
    const seen = !!lm;
    if (seen !== faceSeenRef.current) {
      faceSeenRef.current = seen;
      setStatus(seen ? 'detecting' : 'no-face');
      onReadyChange?.(seen);
    }
    if (!lm || !cutoutRef.current) return;
    const anchors = anchorsFromLandmarks(lm.map((p) => ({ x: 1 - p.x, y: p.y })));
    if (!anchors) return;
    drawJewellery(ctx, cutoutRef.current, placeJewellery(kind, anchors, { W, H }, cutoutRef.current, adjustRef.current));
  }, [canvasRef, kind, adjustRef, onReadyChange]);

  const start = useCallback(async () => {
    stop();
    setStatus('loading');
    onReadyChange?.(false);
    try {
      setMessage('Loading face tracking…');
      landmarkerRef.current ||= await createFaceLandmarker('VIDEO');
      setMessage('Starting camera…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      faceSeenRef.current = false;
      setStatus('no-face');
      frameRef.current = requestAnimationFrame(render);
    } catch (err) {
      setStatus('error');
      setMessage(err?.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site, then tap Retry.'
        : 'Couldn’t start the camera. Tap Retry, or use AI Virtual Model.');
    }
  }, [render, stop, onReadyChange]);

  useEffect(() => {
    start();
    return () => {
      stop();
      landmarkerRef.current?.close?.();
      landmarkerRef.current = null;
    };
  }, [start, stop]);

  const hint = kind === 'earring' ? 'Face the camera — turn slightly to see each earring' : 'Show your face and neck in the frame';

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="absolute inset-0 h-full w-full opacity-0" playsInline muted />
      <canvas ref={canvasRef} className="h-full w-full object-contain" />

      {(status === 'loading' || status === 'error') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 px-10 text-center">
          {status === 'loading'
            ? <div className="mb-5 h-11 w-11 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" />
            : <div className="mb-4 text-4xl" aria-hidden>📷</div>}
          <p className="text-sm leading-relaxed text-white">{message}</p>
          {status === 'error' && (
            <button onClick={start} className="mt-5 flex items-center gap-2 rounded-xl bg-gold-500 px-5 py-2.5 text-sm font-bold text-stone-900">
              <FiRotateCcw size={14} /> Retry
            </button>
          )}
        </div>
      )}

      {(status === 'no-face' || status === 'detecting') && (
        <div className="pointer-events-none absolute left-0 right-0 top-3 flex justify-center">
          <p className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-md ${status === 'detecting' ? 'bg-green-600/80' : 'bg-amber-600/85'}`}>
            {status === 'detecting' ? 'Looking good! Adjust size below' : hint}
          </p>
        </div>
      )}
    </div>
  );
}
