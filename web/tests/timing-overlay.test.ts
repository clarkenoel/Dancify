import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TimingOverlay } from '../src/components/TimingOverlay';
import { GameSession } from '../src/core/session';
import { chart } from './fixtures';

it('aligns beats with NOW and respects checkpoint end, pause, seek and replay', () => {
  const dance = chart();
  const session = new GameSession(dance);
  const render = () => renderToStaticMarkup(createElement(TimingOverlay, { chart: dance, snapshot: session.snapshot() }));
  session.play(); session.tick(1);
  expect(render()).toContain('data-beat-time="1" d="M110 51');
  expect(render()).toContain('Match the target pose now');
  session.pause();
  const paused = render(); session.tick(1.3);
  expect(render()).toBe(paused);
  session.play(); session.tick(1.5);
  expect(render()).not.toContain('Match the target pose now');
  expect(render()).not.toContain('data-checkpoint="m0"');
  session.seek(2);
  expect(render()).toContain('data-beat-time="2" d="M110 51');
  session.reset();
  expect(render()).toContain('data-checkpoint="m0"');
  expect(render()).toContain('Next pose in 1.0s');
});
