import { useCallback, useEffect, useRef } from 'react';
import { SoundEffects, type SoundEvent } from '../audio/SoundEffects';
import menuMove from '../assets/audio/scroll.mp3';
import select from '../assets/audio/button-click.mp3';
import miss from '../assets/audio/miss1.mp3';

/** Own browser audio independently of game scoring and the reference-video clock. */
export function useSoundEffects() {
  const current = useRef<SoundEffects | null>(null);
  const lastEvent = useRef<SoundEvent | null>(null);
  useEffect(() => {
    const sounds = new SoundEffects({ urls: { menuMove, select, miss }, volume: 0.5, eventVolumes: { miss: 0.5 } });
    current.current = sounds;
    const unlock = (event: Event) => { if (event.isTrusted) void sounds.unlock(); };
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
