import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bundle, PlayInput } from '../core/types';
import { GameSession, type SessionSnapshot } from '../core/session';
import { PlaybackController } from '../core/playback';
import type { PoseSample } from '../core/camera';
import { useCamera } from './useCamera';
import type { WearableClient } from '../core/WearableClient';
import { WearableFeedback } from '../core/wearableFeedback';
import { BodyReadiness } from '../core/readiness';
import { cameraFeedback } from '../core/cameraPreview';

export function useGame(bundle: Bundle, wearable: WearableClient, interactionBlocked = false) {
  const blocked = useRef(interactionBlocked); blocked.current = interactionBlocked;
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedback = useRef<WearableFeedback | null>(null);
  const engine = useRef<GameSession | null>(null);
  const controller = useRef<PlaybackController | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => new GameSession(bundle.chart).snapshot());
  const [error, setError] = useState('');
  const readiness = useRef(new BodyReadiness());
  const lossSince = useRef<number | null>(null);
  const controllerBlocked = useRef(false);
  const [controllerWarning, setControllerWarning] = useState('');
  const refresh = useCallback(() => { if (engine.current) { const next = engine.current.snapshot(); feedback.current?.update(next); setSnapshot(engine.current.snapshot()); } }, []);
  useEffect(() => {
    const session = new GameSession(bundle.chart); engine.current = session;
    const video = videoRef.current!;
    // Active buzzers are distracting during the dance. Keep beat/hit output an
    // explicit development opt-in; controller input and results cues still work.
    const output = new WearableFeedback(video, bundle.chart, wearable, undefined, undefined,
      import.meta.env.VITE_DANCIFY_WEARABLE_METRONOME === 'true'); feedback.current = output;
    const playback = new PlaybackController(video, session, refresh, setError, () => !blocked.current && !controllerBlocked.current && readiness.current.isReady(performance.now()), true); controller.current = playback;
    setSnapshot(session.snapshot()); setError('');
    const stopForBackground = () => { if (document.hidden) { output.stop(); readiness.current.reset(); playback.cancelCountdown(); video.pause(); } };
    document.addEventListener('visibilitychange', stopForBackground);
    const unsubscribe = wearable.subscribe(event => {
      if (event.type === 'togglePlayback' && !blocked.current) void playback.toggle().catch(e => setError(e.message));
      else if (event.type === 'connected') { controllerBlocked.current = false; setControllerWarning(''); refresh(); }
      else if (event.type === 'disconnect') {
        controllerBlocked.current = true; playback.cancelCountdown(); video.pause(); session.pause();
        setControllerWarning('Controller disconnected. Reconnect, or choose Continue without controller.'); refresh();
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
    const now = performance.now();
    const fullBody = cameraFeedback(sample.raw, sample.pose !== null).fullBody && sample.pose !== null;
    readiness.current.update(fullBody, now);
    if (!document.hidden) controller.current?.observeReadiness();
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
  const camera = useCamera(true, capture, sample, stopForCameraChange);
  return {
    ready: readiness.current.isReady(performance.now()),
    waitingForBody: controller.current?.waitingForBody ?? true,
    controllerWarning,
    continueWithoutController: () => { controllerBlocked.current = false; setControllerWarning(''); refresh(); },
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
    pause: () => { controller.current?.cancelCountdown(); videoRef.current?.pause(); engine.current?.pause(); refresh(); },
    result: (name: string): PlayInput => { if (!engine.current) throw new Error('Session is not ready'); return engine.current.result(bundle.id, name); },
  };
}
