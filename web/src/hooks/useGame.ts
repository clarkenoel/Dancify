import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bundle, Mode, PlayInput } from '../core/types';
import { GameSession, type SessionSnapshot } from '../core/session';
import { PlaybackController } from '../core/playback';
import type { PoseSample } from '../core/camera';
import { useCamera } from './useCamera';
import type { WearableClient } from '../core/WearableClient';
import { BodyReadiness } from '../core/readiness';
import { cameraFeedback } from '../core/cameraPreview';

export function useGame(bundle: Bundle, mode: Mode, wearable: WearableClient) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engine = useRef<GameSession | null>(null);
  const controller = useRef<PlaybackController | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => new GameSession(bundle.chart, mode).snapshot());
  const [error, setError] = useState('');
  const readiness = useRef(new BodyReadiness());
  const lossSince = useRef<number | null>(null);
  const controllerBlocked = useRef(false);
  const [controllerWarning, setControllerWarning] = useState('');
  const refresh = useCallback(() => { if (engine.current) setSnapshot(engine.current.snapshot()); }, []);
  useEffect(() => {
    const session = new GameSession(bundle.chart, mode); engine.current = session;
    const video = videoRef.current!;
    const playback = new PlaybackController(video, session, refresh, setError, () => !controllerBlocked.current && (mode !== 'camera' || readiness.current.isReady(performance.now())), mode === 'camera'); controller.current = playback;
    setSnapshot(session.snapshot()); setError('');
    const stopForBackground = () => { if (document.hidden) { readiness.current.reset(); playback.cancelCountdown(); video.pause(); } };
    document.addEventListener('visibilitychange', stopForBackground);
    const unsubscribe = wearable.subscribe(event => {
      if (event.type === 'togglePlayback') void playback.toggle().catch(e => setError(e.message));
      else if (event.type === 'connected') { controllerBlocked.current = false; setControllerWarning(''); refresh(); }
      else if (event.type === 'disconnect') {
        controllerBlocked.current = true; playback.cancelCountdown(); video.pause(); session.pause();
        setControllerWarning('Controller disconnected. Reconnect, or explicitly choose keyboard controls to continue.'); refresh();
      }
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
      unsubscribe(); playback.dispose(); engine.current = null; controller.current = null;
      window.removeEventListener('keydown', keyboard); document.removeEventListener('visibilitychange', stopForBackground);
    };
  }, [bundle, mode, refresh, wearable]);

  const capture = useCallback(() => ({ time: videoRef.current?.currentTime ?? 0, epoch: engine.current?.epoch ?? -1 }), []);
  const sample = useCallback((sample: PoseSample) => {
    const session = engine.current;
    const now = performance.now();
    const fullBody = cameraFeedback(sample.raw, sample.pose !== null).fullBody && sample.pose !== null;
    readiness.current.update(fullBody, now);
    if (fullBody) lossSince.current = null;
    else {
      lossSince.current ??= now;
      if (session?.snapshot().playing && now - lossSince.current >= 750) {
        controller.current?.cancelCountdown(); videoRef.current?.pause(); session.pause();
        setError('Body tracking was lost. Step into view, then confirm Ready to resume.');
      }
    }
    session?.tick(videoRef.current?.currentTime ?? 0);
    session?.sample(sample.time, sample.epoch, sample.pose, { raw: sample.raw, inferenceMs: sample.inferenceMs });
    refresh();
  }, [refresh]);
  const stopForCameraChange = useCallback(() => {
    readiness.current.reset(); lossSince.current = null;
    controller.current?.cancelCountdown(); videoRef.current?.pause(); engine.current?.pause(); refresh();
  }, [refresh]);
  const camera = useCamera(mode === 'camera', capture, sample, stopForCameraChange);
  return {
    ready: mode !== 'camera' || readiness.current.isReady(performance.now()),
    controllerWarning,
    useKeyboardControls: () => { controllerBlocked.current = false; setControllerWarning(''); refresh(); },
    videoRef, snapshot, error, camera, wearable, countdown: controller.current?.countdown ?? null,
    movementLog: engine.current?.movementLog,
    setRecording: (enabled: boolean) => { engine.current?.movementLog.setEnabled(enabled); refresh(); },
    clearLog: () => { engine.current?.movementLog.clear(); refresh(); },
    downloadLog: () => {
      if (!engine.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(engine.current.diagnostics(bundle.id), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `dancify-movement-${engine.current.snapshot().sessionId}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    toggle: () => { setError(''); return controller.current?.toggle().catch(e => setError(e.message)); },
    replay: () => { setError(''); return controller.current?.replay().catch(e => setError(e.message)); },
    hit: () => { engine.current?.tick(videoRef.current?.currentTime ?? 0); engine.current?.keyboardHit(); refresh(); },
    result: (name: string): PlayInput => { if (!engine.current) throw new Error('Session is not ready'); return engine.current.result(bundle.id, name); },
  };
}
