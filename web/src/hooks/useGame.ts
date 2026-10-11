import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bundle, PlayInput } from '../core/types';
import { GameSession, type SessionSnapshot } from '../core/session';
import { PlaybackController } from '../core/playback';
import type { PoseSample } from '../core/camera';
import { useCamera } from './useCamera';
import type { WearableClient } from '../core/WearableClient';
import { WearableFeedback } from '../core/wearableFeedback';

export function useGame(bundle: Bundle, wearable: WearableClient, interactionBlocked = false) {
  const blocked = useRef(interactionBlocked); blocked.current = interactionBlocked;
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedback = useRef<WearableFeedback | null>(null);
  const engine = useRef<GameSession | null>(null);
  const controller = useRef<PlaybackController | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => new GameSession(bundle.chart).snapshot());
  const [error, setError] = useState('');
  const [controllerWarning, setControllerWarning] = useState('');
  const refresh = useCallback(() => { if (engine.current) { const next = engine.current.snapshot(); feedback.current?.update(next); setSnapshot(engine.current.snapshot()); } }, []);
  useEffect(() => {
    const session = new GameSession(bundle.chart); engine.current = session;
    const video = videoRef.current!;
    // Active buzzers are distracting during the dance. Keep beat/hit output an
    // explicit development opt-in; controller input and results cues still work.
    const output = new WearableFeedback(video, bundle.chart, wearable, undefined, undefined,
      import.meta.env.VITE_DANCIFY_WEARABLE_METRONOME === 'true'); feedback.current = output;
    const playback = new PlaybackController(video, session, refresh, setError, () => !blocked.current && !document.hidden, true, false); controller.current = playback;
    setSnapshot(session.snapshot()); setError('');
    const stopForBackground = () => { if (document.hidden) { output.stop(); playback.cancelCountdown(); video.pause(); } };
    document.addEventListener('visibilitychange', stopForBackground);
    const unsubscribe = wearable.subscribe(event => {
      if (event.type === 'togglePlayback' && !blocked.current) void playback.toggle().catch(e => setError(e.message));
      else if (event.type === 'connected') { setControllerWarning(''); refresh(); }
      else if (event.type === 'disconnect') {
        playback.cancelCountdown(); video.pause(); session.pause();
        setControllerWarning('Controller disconnected. Press Start to continue, or reconnect from Settings.'); refresh();
      }
    });
    return () => {
      unsubscribe(); output.dispose(); feedback.current = null; playback.dispose(); engine.current = null; controller.current = null;
      document.removeEventListener('visibilitychange', stopForBackground);
    };
  }, [bundle, refresh, wearable]);

  const capture = useCallback(() => ({ time: videoRef.current?.currentTime ?? 0, epoch: engine.current?.epoch ?? -1 }), []);
  const sample = useCallback((sample: PoseSample) => {
    const session = engine.current;
    // Demo: framing never gates playback. Missing landmarks remain unscored.
    session?.tick(videoRef.current?.currentTime ?? 0);
    session?.sample(sample.time, sample.epoch, sample.pose, { raw: sample.raw, inferenceMs: sample.inferenceMs });
    refresh();
  }, [refresh]);
  const stopForCameraChange = useCallback(() => {
    // Invalidate pending camera samples without stopping the demo video.
    engine.current?.pause();
    if (videoRef.current && !videoRef.current.paused) engine.current?.play();
    refresh();
  }, [refresh]);
  const camera = useCamera(true, capture, sample, stopForCameraChange);
  return {
    ready: !interactionBlocked,
    waitingForBody: false,
    controllerWarning,
    continueWithoutController: () => { setControllerWarning(''); refresh(); },
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
    toggle: () => { setError(''); setControllerWarning(''); if (camera.cameraState === 'off') void camera.startCamera(); return controller.current?.toggle().catch(e => setError(e.message)); },
    replay: () => { setError(''); return controller.current?.replay().catch(e => setError(e.message)); },
    pause: () => { controller.current?.cancelCountdown(); videoRef.current?.pause(); engine.current?.pause(); refresh(); },
    result: (name: string): PlayInput => { if (!engine.current) throw new Error('Session is not ready'); const result = engine.current.result(bundle.id, name); return { ...result, notes: 'Upper-body demo scoring (shoulders, elbows, wrists). ' + result.notes }; },
  };
}
