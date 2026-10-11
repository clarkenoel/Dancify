import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraTracker, type CaptureStamp, type PoseSample } from '../core/camera';
import { cameraErrorMessage, cameraFeedback, paintCameraPreview } from '../core/cameraPreview';

export function useCamera(enabled: boolean, capture: () => CaptureStamp, onPose: (sample: PoseSample) => void, onStop: () => void) {
  const cameraRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<CameraTracker | null>(null);
  const generation = useRef(0);
  const seen = useRef(false);
  const skeleton = useRef(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'ready'>('off');
  const [tracking, setTracking] = useState('Camera off');
  const [feedback, setFeedback] = useState<ReturnType<typeof cameraFeedback> | null>(null);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const clearPreview = useCallback(() => {
    const canvas = previewRef.current;
    if (canvas) { canvas.width = canvas.height = 0; }
  }, []);
  const dispose = useCallback(() => {
    generation.current++; tracker.current?.stop(); tracker.current = null; seen.current = false; clearPreview();
  }, [clearPreview]);
  const stopCamera = useCallback(() => {
    dispose(); onStop(); setCameraState('off'); setTracking('Camera off'); setFeedback(null); setInferenceMs(null);
  }, [dispose, onStop]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const version = generation.current;
    try {
      const found = await navigator.mediaDevices.enumerateDevices();
      if (version === generation.current) { setDevices(found.filter(d => d.kind === 'videoinput' && d.deviceId)); setDeviceError(''); }
    } catch { if (version === generation.current) setDeviceError('Could not list cameras. You can still try the default camera.'); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refreshDevices();
    const changed = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => { dispose(); navigator.mediaDevices?.removeEventListener('devicechange', changed); };
  }, [enabled, dispose, refreshDevices]);

  const startCamera = async () => {
    if (!enabled || !cameraRef.current || tracker.current) return;
    const version = ++generation.current;
    seen.current = false; setError(''); setFeedback(null); setInferenceMs(null); setCameraState('starting'); setTracking('Starting camera…');
    const failed = (message: string) => {
      if (version !== generation.current) return;
      dispose(); onStop(); setCameraState('off'); setTracking('Camera unavailable'); setFeedback(null); setInferenceMs(null); setError(message);
    };
    const camera = new CameraTracker(cameraRef.current, capture, sample => {
      if (version !== generation.current) return;
      if (previewRef.current) paintCameraPreview(previewRef.current, sample.frame, sample.raw, skeleton.current);
      const info = cameraFeedback(sample.raw, sample.pose !== null);
      setFeedback(info); setInferenceMs(Math.round(sample.inferenceMs));
      if (sample.pose) {
        seen.current = true;
        setTracking(info.upperBody ? 'Tracking upper body' : 'Tracking — bring your arms into view');
      } else setTracking(seen.current ? 'Tracking lost' : 'Finding your body');
      onPose(sample);
    }, failed);
    tracker.current = camera;
    try {
      await camera.start(deviceId || undefined);
      if (version !== generation.current) return;
      setCameraState('ready'); setTracking('Finding your body'); void refreshDevices();
    } catch (e) { failed(cameraErrorMessage(e)); }
  };
  return {
    cameraRef, previewRef, cameraState, tracking, feedback, inferenceMs, error, devices, deviceId, deviceError,
    startCamera, stopCamera, refreshDevices, showSkeleton,
    toggleSkeleton: (value: boolean) => { skeleton.current = value; setShowSkeleton(value); },
    selectCamera: (id: string) => { stopCamera(); setError(''); setDeviceId(id); },
  };
}
