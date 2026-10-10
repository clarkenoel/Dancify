import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bundle, Mode, PlayInput } from '../core/types';
import { GameSession, type SessionSnapshot } from '../core/session';
import { PlaybackController } from '../core/playback';
import { CameraTracker } from '../core/camera';
import { WearableClient } from '../core/WearableClient';

export function useGame(bundle: Bundle, mode: Mode) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const engine = useRef<GameSession | null>(null);
  const controller = useRef<PlaybackController | null>(null);
  const tracker = useRef<CameraTracker | null>(null);
  const lifecycle = useRef(0);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => new GameSession(bundle.chart, mode).snapshot());
  const [error, setError] = useState('');
  const [cameraState, setCameraState] = useState<'off' | 'starting' | 'ready'>('off');
  const [tracking, setTracking] = useState('Camera off');
  const [wearable] = useState(() => new WearableClient());
  const refresh = useCallback(() => { if (engine.current) setSnapshot(engine.current.snapshot()); }, []);
  useEffect(() => {
    const session = new GameSession(bundle.chart, mode); engine.current = session;
    const video = videoRef.current!;
    const playback = new PlaybackController(video, session, refresh, setError); controller.current = playback;
    setSnapshot(session.snapshot()); setError(''); setCameraState('off'); setTracking('Camera off');
    const stopForBackground = () => { if (document.hidden) video.pause(); };
    document.addEventListener('visibilitychange', stopForBackground);
    const unsubscribe = wearable.subscribe(event => {
      if (event.type === 'togglePlayback') void playback.toggle().catch(e => setError(e.message));
      else if (event.direction === 'left' || event.direction === 'right') video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (event.direction === 'left' ? -5 : 5)));
      else video.volume = Math.max(0, Math.min(1, video.volume + (event.direction === 'up' ? 0.1 : -0.1)));
    });
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if ((target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]')) || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); void playback.toggle().catch(e => setError(e.message)); }
      if (event.code === 'Enter' && mode === 'keyboard_practice') { event.preventDefault(); session.tick(video.currentTime); session.keyboardHit(); refresh(); }
      if (event.code === 'KeyR') { event.preventDefault(); void playback.replay().catch(e => setError(e.message)); }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (event.code === 'ArrowLeft' ? -5 : 5))); }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      lifecycle.current++; tracker.current?.stop(); tracker.current = null;
      unsubscribe(); playback.dispose(); engine.current = null; controller.current = null;
      window.removeEventListener('keydown', keyboard); document.removeEventListener('visibilitychange', stopForBackground);
    };
  }, [bundle, mode, refresh, wearable]);

  const startCamera = async () => {
    if (!cameraRef.current || mode !== 'camera' || tracker.current) return;
    const generation = lifecycle.current;
    setError(''); setCameraState('starting');
    const camera = new CameraTracker(cameraRef.current, () => ({ time: videoRef.current?.currentTime ?? 0, epoch: engine.current?.epoch ?? -1 }), sample => {
      if (generation !== lifecycle.current) return;
      const session = engine.current;
      session?.tick(videoRef.current?.currentTime ?? 0);
      session?.sample(sample.time, sample.epoch, sample.pose);
      setTracking(sample.pose ? `Tracking body · ${Math.round(sample.inferenceMs)} ms inference` : 'Tracking lost — step back until shoulders, hips, and limbs are visible');
    }, message => {
      if (generation !== lifecycle.current) return;
      tracker.current = null; setCameraState('off'); setTracking('Tracking lost'); setError(message); videoRef.current?.pause();
    });
    tracker.current = camera;
    try { await camera.start(); if (generation === lifecycle.current && tracker.current === camera) setCameraState('ready'); }
    catch (e) { if (generation === lifecycle.current) { tracker.current = null; setCameraState('off'); setError(e instanceof Error ? e.message : 'Camera access failed'); } }
  };
  return {
    videoRef, cameraRef, snapshot, error, cameraState, tracking, startCamera, wearable,
    toggle: () => controller.current?.toggle().catch(e => setError(e.message)),
    replay: () => controller.current?.replay().catch(e => setError(e.message)),
    hit: () => { engine.current?.tick(videoRef.current?.currentTime ?? 0); engine.current?.keyboardHit(); refresh(); },
    result: (name: string): PlayInput => { if (!engine.current) throw new Error('Session is not ready'); return engine.current.result(bundle.id, name); },
  };
}
