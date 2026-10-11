import { useCallback, useEffect, useRef } from 'react';
import { SoundEffects, type SoundEvent } from '../audio/SoundEffects';
import menuMove from '../assets/audio/scroll.mp3';
import select from '../assets/audio/button-click.mp3';
import miss from '../assets/audio/miss1.mp3';
import loading from '../assets/audio/loading.mp3';
import win from '../assets/audio/result-win.mp3';
import lose from '../assets/audio/lose.mp3';

/** Own browser audio independently of game scoring and the reference-video clock. */
export function useSoundEffects(preparing = false) {
  const current = useRef<SoundEffects | null>(null);
  const lastEvent = useRef<SoundEvent | null>(null);
  const preparingRef = useRef(preparing); preparingRef.current = preparing;
  useEffect(() => {
    const sounds = new SoundEffects({ urls: { menuMove, select, miss, loading, win, lose }, volume: 0.5, eventVolumes: { miss: 0.5, loading: 0.35 } });
    current.current = sounds;
    const unlock = (event: Event) => { if (event.isTrusted) void sounds.unlock().then(() => { if (preparingRef.current && !document.hidden) void sounds.setLoading(true); }); };
    const hide = () => { if (document.hidden) sounds.stop(); };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', hide);
      sounds.dispose();
      lastEvent.current = null;
      if (current.current === sounds) current.current = null;
    };
  }, []);
  useEffect(() => { void current.current?.setLoading(preparing && !document.hidden); }, [preparing]);
  const play = useCallback((event: SoundEvent, id?: string) => {
    if (!document.hidden) { lastEvent.current = event; void current.current?.play(event, id); }
  }, []);
  const stopGameplay = useCallback(() => {
    // A selection already cancels older audio inside SoundEffects. Let that
    // short UI cue finish while its action changes screens or pauses the round.
    if (lastEvent.current && ['miss', 'countdown', 'milestone', 'win', 'lose'].includes(lastEvent.current)) {
      current.current?.stop(); lastEvent.current = null;
    }
  }, []);
  return { play, stopGameplay };
}
