'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FiX, FiCamera, FiDownload, FiRotateCcw, FiPlus, FiMinus } from 'react-icons/fi';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LEFT_EAR_IDX  = 234;
const RIGHT_EAR_IDX = 454;
const LEFT_CHIN_IDX = 172;
const TOP_IDX       = 10;

export default function TryOnModal({ earringImage, productName, onClose }) {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);
  const earringImgRef = useRef(null);
  const streamRef    = useRef(null);

  // Adjustment refs — readable every frame without re-render
  const scaleRef   = useRef(1.0);   // earring size multiplier
  const offsetRef  = useRef(0);     // vertical offset as fraction of face height

  // UI state for adjustment display
  const [scale, setScale]   = useState(1.0);
  const [offset, setOffset] = useState(0);

  const [status, setStatus]   = useState('loading');
  const [loadMsg, setLoadMsg] = useState('Loading AR model…');
  const [saved, setSaved]     = useState(false);

  // Keep refs in sync with display state
  function changeScale(delta) {
    setScale((s) => {
      const next = Math.round(Math.min(2.5, Math.max(0.4, s + delta)) * 10) / 10;
      scaleRef.current = next;
      return next;
    });
  }
  function changeOffset(delta) {
    setOffset((o) => {
      const next = Math.round(Math.min(0.4, Math.max(-0.4, o + delta)) * 10) / 10;
      offsetRef.current = next;
      return next;
    });
  }

  // Pre-load earring image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = earringImage;
    earringImgRef.current = img;
  }, [earringImage]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setStatus('error');
      setLoadMsg('Camera access denied. Please allow camera permission.');
    }
  }, []);

  const initLandmarker = useCallback(async () => {
    try {
      setStatus('loading');
      setLoadMsg('Loading face detection model…');
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      landmarkerRef.current = landmarker;
      setLoadMsg('Starting camera…');
      await startCamera();
      setStatus('ready');
    } catch (err) {
      console.error('TryOn init error:', err);
      setStatus('error');
      setLoadMsg('Failed to load AR model. Please try again.');
    }
  }, [startCamera]);

  // Render loop — reads scaleRef/offsetRef each frame for instant response
  const renderFrame = useCallback(() => {
    const video     = videoRef.current;
    const canvas    = canvasRef.current;
    const landmarker = landmarkerRef.current;
    const earImg    = earringImgRef.current;

    if (!video || !canvas || !landmarker || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const W = video.videoWidth;
    const H = video.videoHeight;
    if (W === 0 || H === 0) {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Mirror (selfie mode)
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    let result;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    if (!result?.faceLandmarks?.length) {
      setStatus('no-face');
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    setStatus('detecting');
    const lm = result.faceLandmarks[0];

    // Mirror: right-ear landmark (454) → display-left, left-ear landmark (234) → display-right
    const leftScreenEar  = lm[RIGHT_EAR_IDX];
    const rightScreenEar = lm[LEFT_EAR_IDX];

    // Face height for auto-scaling
    const faceH    = Math.abs(lm[LEFT_CHIN_IDX].y - lm[TOP_IDX].y) * H;
    const baseH    = faceH * 0.38 * scaleRef.current;
    const earringH = baseH;
    const earringW = earImg.complete && earImg.naturalHeight > 0
      ? earringH * (earImg.naturalWidth / earImg.naturalHeight)
      : earringH;

    if (!earImg.complete || earImg.naturalWidth === 0) {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    // Vertical offset as fraction of face height
    const vOff = offsetRef.current * faceH;

    [leftScreenEar, rightScreenEar].forEach((ear) => {
      const ex = (1 - ear.x) * W;  // mirrored x
      const ey = ear.y * H + vOff;
      ctx.drawImage(earImg, ex - earringW / 2, ey, earringW, earringH);
    });

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, []);

  useEffect(() => {
    initLandmarker();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close?.();
    };
  }, [initLandmarker]);

  useEffect(() => {
    if (status === 'ready' || status === 'detecting' || status === 'no-face') {
      animFrameRef.current = requestAnimationFrame(renderFrame);
    }
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [status, renderFrame]);

  const savePhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${productName || 'earring'}-tryon.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const statusMsg = {
    loading:   loadMsg,
    ready:     'Position your face in the camera…',
    'no-face': 'Face-ஐ camera-க்கு நேரா வையுங்க',
    detecting: `Trying on: ${productName || 'Earring'}`,
    error:     loadMsg,
  }[status] || '';

  const isActive = status === 'ready' || status === 'no-face' || status === 'detecting';

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-900 to-indigo-900">
        <div>
          <p className="text-white font-bold text-sm tracking-wide">✨ Virtual Try-On</p>
          <p className="text-purple-200 text-xs truncate max-w-[220px]">{productName}</p>
        </div>
        <button onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/30 transition">
          <FiX size={18} />
        </button>
      </div>

      {/* ── Camera + Canvas ── */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-0" playsInline muted />
        <canvas ref={canvasRef} className="w-full h-full object-contain" />

        {/* Face guide oval when ready but no face detected */}
        {status === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-64 rounded-full border-2 border-dashed border-white/30" />
          </div>
        )}

        {/* Loading / error */}
        {(status === 'loading' || status === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85">
            {status === 'loading' && (
              <div className="w-12 h-12 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mb-5" />
            )}
            {status === 'error' && <div className="text-4xl mb-4">📷</div>}
            <p className="text-white text-sm text-center px-10 leading-relaxed">{loadMsg}</p>
            {status === 'error' && (
              <button
                onClick={() => initLandmarker()}
                className="mt-5 px-5 py-2.5 bg-purple-500 text-white text-sm font-bold rounded-xl flex items-center gap-2">
                <FiRotateCcw size={14} /> Retry
              </button>
            )}
          </div>
        )}

        {/* Status pill */}
        {isActive && (
          <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
            <div className={`px-4 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md shadow-lg ${
              status === 'detecting' ? 'bg-green-500/85 text-white' :
              status === 'no-face'  ? 'bg-amber-500/85 text-white' :
                                      'bg-black/60 text-white/80'
            }`}>
              {status === 'detecting' && <span className="inline-block w-1.5 h-1.5 bg-white rounded-full mr-1.5 animate-pulse align-middle" />}
              {statusMsg}
            </div>
          </div>
        )}

        {/* ── Adjustment panel (visible when face detected) ── */}
        {isActive && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2">

            {/* Size control */}
            <div className="bg-black/70 backdrop-blur-sm rounded-2xl p-2 flex flex-col items-center gap-1.5 shadow-lg">
              <span className="text-white/60 text-[9px] uppercase tracking-wider">Size</span>
              <button onClick={() => changeScale(0.1)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white transition">
                <FiPlus size={13} />
              </button>
              <span className="text-white text-[11px] font-bold w-8 text-center">{scale.toFixed(1)}×</span>
              <button onClick={() => changeScale(-0.1)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white transition">
                <FiMinus size={13} />
              </button>
            </div>

            {/* Vertical position control */}
            <div className="bg-black/70 backdrop-blur-sm rounded-2xl p-2 flex flex-col items-center gap-1.5 shadow-lg">
              <span className="text-white/60 text-[9px] uppercase tracking-wider">Up/Down</span>
              <button onClick={() => changeOffset(-0.05)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white transition text-base leading-none">
                ▲
              </button>
              <span className="text-white text-[9px] font-semibold">pos</span>
              <button onClick={() => changeOffset(0.05)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white transition text-base leading-none">
                ▼
              </button>
            </div>

            {/* Reset */}
            <button
              onClick={() => { changeScale(1.0 - scale); setOffset(0); offsetRef.current = 0; scaleRef.current = 1.0; }}
              className="bg-black/70 backdrop-blur-sm rounded-2xl p-2 flex flex-col items-center gap-0.5 shadow-lg hover:bg-white/20 transition">
              <FiRotateCcw size={13} className="text-white/60" />
              <span className="text-white/50 text-[9px]">Reset</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom Controls ── */}
      <div className="px-5 py-4 bg-gradient-to-r from-purple-900/95 to-indigo-900/95 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-3 mb-3">
          <button
            onClick={savePhoto}
            disabled={status !== 'detecting'}
            className="flex items-center gap-2 px-6 py-3 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-xl disabled:opacity-40 transition text-sm shadow-lg">
            {saved ? '✓ Saved!' : <><FiDownload size={15} /> Save Photo</>}
          </button>
          <button onClick={onClose}
            className="flex items-center gap-2 px-5 py-3 bg-white/15 hover:bg-white/25 text-white font-semibold rounded-xl transition text-sm">
            <FiX size={15} /> Close
          </button>
        </div>

        {/* Tips */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            ['📏 Too small?', 'Tap + on Size'],
            ['📐 Position?', 'Tap ▲▼ to adjust'],
            ['🔆 Best result', 'Face the light'],
          ].map(([title, tip]) => (
            <div key={title} className="bg-white/10 rounded-lg px-2 py-1.5">
              <p className="text-white text-[10px] font-semibold">{title}</p>
              <p className="text-white/60 text-[9px]">{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
