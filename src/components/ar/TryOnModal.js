'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FiX, FiCamera, FiDownload, FiRotateCcw } from 'react-icons/fi';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Ear landmark indices in MediaPipe 468-point face mesh
const LEFT_EAR_IDX = 234;
const RIGHT_EAR_IDX = 454;
const LEFT_CHIN_IDX = 172;   // used to estimate face height
const RIGHT_CHIN_IDX = 397;
const TOP_IDX = 10;           // top of forehead

export default function TryOnModal({ earringImage, productName, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);
  const earringImgRef = useRef(null);
  const streamRef = useRef(null);

  const [status, setStatus] = useState('loading'); // loading | ready | detecting | no-face | error
  const [loadMsg, setLoadMsg] = useState('Loading AR model…');
  const [saved, setSaved] = useState(false);

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
    } catch (err) {
      setStatus('error');
      setLoadMsg('Camera access denied. Please allow camera permission.');
    }
  }, []);

  const initLandmarker = useCallback(async () => {
    try {
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

  // Render loop
  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    const earImg = earringImgRef.current;

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

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Mirror (selfie mode)
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    const now = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(video, now);
    } catch (e) {
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

    // Because we mirror the canvas: lm[454] (right ear in face coords) appears on LEFT of screen
    // lm[234] (left ear in face coords) appears on RIGHT of screen
    const leftScreenEar  = lm[RIGHT_EAR_IDX]; // display-left
    const rightScreenEar = lm[LEFT_EAR_IDX];  // display-right

    // Face height for scaling earring size
    const topPt    = lm[TOP_IDX];
    const chinLeft = lm[LEFT_CHIN_IDX];
    const faceH    = Math.abs(chinLeft.y - topPt.y) * H;
    const earringH = faceH * 0.38;
    const earringW = earImg.complete && earImg.naturalHeight > 0
      ? earringH * (earImg.naturalWidth / earImg.naturalHeight)
      : earringH;

    if (!earImg.complete || earImg.naturalWidth === 0) {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    // Draw earrings — mirror means we flip x coords: display_x = W - (lm.x * W)
    [leftScreenEar, rightScreenEar].forEach((ear) => {
      const ex = (1 - ear.x) * W; // mirrored x
      const ey = ear.y * H;
      ctx.drawImage(
        earImg,
        ex - earringW / 2,  // center horizontally on ear
        ey,                  // top of earring starts at ear landmark
        earringW,
        earringH,
      );
    });

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, []);

  useEffect(() => {
    initLandmarker();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (landmarkerRef.current) landmarkerRef.current.close?.();
    };
  }, [initLandmarker]);

  // Start render loop once camera is ready
  useEffect(() => {
    if (status === 'ready' || status === 'detecting' || status === 'no-face') {
      animFrameRef.current = requestAnimationFrame(renderFrame);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
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
    loading:    loadMsg,
    ready:      'Position your face in the camera…',
    'no-face':  'Face-ஐ camera-க்கு நேரா வையுங்க',
    detecting:  `Trying on: ${productName || 'Earring'}`,
    error:      loadMsg,
  }[status] || '';

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm">
        <div>
          <p className="text-white font-semibold text-sm">Virtual Try-On</p>
          <p className="text-gold-300 text-xs">{productName}</p>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition">
          <FiX size={18} />
        </button>
      </div>

      {/* Camera / Canvas area */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-0" playsInline muted />
        <canvas ref={canvasRef} className="w-full h-full object-contain" />

        {/* Loading / error overlay */}
        {(status === 'loading' || status === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            {status === 'loading' && (
              <div className="w-10 h-10 border-4 border-gold-400 border-t-transparent rounded-full animate-spin mb-4" />
            )}
            <p className="text-white text-sm text-center px-8">{loadMsg}</p>
            {status === 'error' && (
              <button onClick={() => { setStatus('loading'); setLoadMsg('Retrying…'); initLandmarker(); }}
                className="mt-4 px-4 py-2 bg-gold-500 text-black text-sm font-semibold rounded-lg flex items-center gap-2">
                <FiRotateCcw size={14} /> Retry
              </button>
            )}
          </div>
        )}

        {/* Status bar */}
        {(status === 'ready' || status === 'no-face' || status === 'detecting') && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <div className={`px-4 py-2 rounded-full text-xs font-medium backdrop-blur-sm ${
              status === 'detecting' ? 'bg-green-500/80 text-white' :
              status === 'no-face'   ? 'bg-amber-500/80 text-white' :
                                       'bg-black/60 text-white'
            }`}>
              {status === 'detecting' && <span className="inline-block w-2 h-2 bg-white rounded-full mr-2 animate-pulse" />}
              {statusMsg}
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-6 py-4 bg-black/80 backdrop-blur-sm flex items-center justify-center gap-4">
        <button
          onClick={savePhoto}
          disabled={status !== 'detecting'}
          className="flex items-center gap-2 px-6 py-3 bg-gold-500 text-black font-bold rounded-xl disabled:opacity-40 hover:bg-gold-400 transition text-sm">
          {saved ? '✓ Saved!' : <><FiDownload size={16} /> Save Photo</>}
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-6 py-3 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition text-sm">
          <FiCamera size={16} /> Close
        </button>
      </div>

      {/* Tip */}
      <div className="px-4 py-2 bg-black text-center">
        <p className="text-gray-500 text-xs">Good lighting & face centered = best results • Camera mirrored like a selfie</p>
      </div>
    </div>
  );
}
