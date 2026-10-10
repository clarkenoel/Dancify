import { useCallback, useEffect, useRef, useState } from 'react';
import { DancifyApi, pollPreparation } from '../core/api';
import type { Preparation } from '../core/types';

export function usePreparation(api: DancifyApi, onComplete: (songId: string) => void) {
  const [job, setJob] = useState<Preparation | null>(null);
  const [error, setError] = useState('');
  const control = useRef<AbortController | null>(null);
  const completed = useRef(onComplete); completed.current = onComplete;
  const key = `dancify-preparation:${api.base}`;
  const watch = useCallback((initial: Preparation) => {
    control.current?.abort();
    const controller = new AbortController(); control.current = controller;
    setError(''); setJob(initial);
    try { localStorage.setItem(key, JSON.stringify({ songId: initial.song_id, jobId: initial.id })); } catch { /* Storage is optional. */ }
    void pollPreparation(api, initial, setJob, controller.signal).then(finished => {
      if (!controller.signal.aborted && finished.status === 'succeeded') completed.current(finished.song_id);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
  }, [api, key]);
  useEffect(() => {
    const controller = new AbortController();
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.songId && saved?.jobId) void api.job(saved.songId, saved.jobId, controller.signal).then(j => { if (!controller.signal.aborted) watch(j); }).catch(() => {});
    } catch { /* Corrupt local preferences don't prevent starting a new job. */ }
    return () => { controller.abort(); control.current?.abort(); };
  }, [api, key, watch]);
  return { job, error, watch };
}
