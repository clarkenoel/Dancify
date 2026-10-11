import type { Dance, Mode } from '../core/types';
import type { SessionSnapshot } from '../core/session';
import { PoseTarget } from './PoseTarget';

const horizon = 4;
const nowX = 110;
const pixelsPerSecond = 100;
const x = (eventTime: number, time: number) => nowX + (eventTime - time) * pixelsPerSecond;

/** All positions derive from the video-driven snapshot; no independent animation clock. */
export function TimingOverlay({ chart, snapshot: s, mode }: { chart: Dance; snapshot: SessionSnapshot; mode: Mode }) {
  const beats = chart.beat_times.filter(t => t >= s.time - 0.25 && t <= s.time + horizon);
  const windows = chart.moves.filter(m => m.end > s.time && m.start <= s.time + horizon);
  const active = chart.moves.find(m => m.id === s.activeId);
  const next = active ?? windows[0];
  const onBeat = chart.beat_times.some(t => s.time >= t && s.time - t < 0.12);
  return <div aria-label="Timing overlay" style={{ position: 'absolute', inset: '0 0 auto', pointerEvents: 'none', color: 'white', background: 'rgb(0 0 0 / 78%)' }}>
    <svg viewBox="0 0 640 144" role="img" aria-label="Beat markers and checkpoint windows moving toward the NOW line" style={{ display: 'block', width: '100%' }}>
      <defs><clipPath id="timing-lanes"><rect x="92" y="28" width="538" height="112" /></clipPath></defs>
      <text x="12" y="20" fill="currentColor" fontSize="13">{s.ended ? 'FINISHED' : s.playing ? 'PLAYING' : 'PAUSED'} · {s.time.toFixed(2)}s</text>
      <text x="625" y="20" textAnchor="end" fill="currentColor" fontSize="13">{chart.bpm.toFixed(1)} BPM · next 4 seconds</text>
      <text x="12" y="65" fill="currentColor" fontSize="13">BEATS</text>
      <text x="12" y="115" fill="currentColor" fontSize="13">POSES</text>
      <path d="M92 60H630 M92 110H630" stroke="currentColor" opacity="0.4" />
      <path d="M110 30V140" stroke="currentColor" strokeWidth="3" />
      <text x="118" y="40" fill="currentColor" fontSize="11">NOW</text>
      <circle cx={nowX} cy="60" r={onBeat ? 14 : 9} fill={onBeat ? 'white' : 'none'} stroke="currentColor" />
      <g clipPath="url(#timing-lanes)">
        {beats.map(t => <path key={t} data-beat-time={t} d={`M${x(t, s.time)} 51l9 9-9 9-9-9Z`} fill="currentColor" />)}
        {windows.map(m => {
          const start = Math.max(nowX, x(m.start, s.time));
          const end = Math.min(630, x(m.end, s.time));
          return <g key={m.id} data-checkpoint={m.id}>
            <rect x={start} y="94" width={Math.max(0, end - start)} height="32" fill={m.id === s.activeId ? 'white' : 'none'} stroke="currentColor" strokeWidth="2" />
            <text x={start + 5} y="115" fontSize="12" fill={m.id === s.activeId ? 'black' : 'white'}>{m.id === s.activeId ? (mode === 'keyboard_practice' ? 'ENTER' : 'MATCH') : '→'}</text>
          </g>;
        })}
      </g>
    </svg>
    <div style={{ padding: '0 8px 8px' }}>
      <strong>{active ? (mode === 'keyboard_practice' ? 'Press Enter now' : 'Match the target pose now') : next ? `Next pose in ${Math.max(0, next.start - s.time).toFixed(1)}s` : 'No more checkpoints'}</strong>
      {' · '}{s.results.at(-1)?.judgment ?? 'Ready'} · Score {s.score} · Combo {s.combo}
    </div>
    {next && <div style={{ position: 'absolute', top: '100%', right: 0, background: 'rgb(0 0 0 / 78%)', maxWidth: '35%' }}>
      <PoseTarget move={next} compact />
    </div>}
  </div>;
}
