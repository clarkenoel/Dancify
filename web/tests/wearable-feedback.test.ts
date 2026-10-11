import { expect, it } from 'vitest';
import { WearableClient } from '../src/core/WearableClient';
import { WearableFeedback } from '../src/core/wearableFeedback';
import { GameSession } from '../src/core/session';
import { chart, target } from './fixtures';

class Video extends EventTarget {
  currentTime = 0; paused = true; seeking = false; readyState = 2; playbackRate = 1;
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
async function setup() {
  const video = new Video(); const client = new WearableClient(); client.connectSimulator(); await flush(); client.clearOutput();
  const dance = chart(); dance.duration = 20; dance.beat_times = Array.from({ length: 39 }, (_, i) => .5 + i * .5);
  const session = new GameSession(dance); let hidden = false; let now = 0;
  const feedback = new WearableFeedback(video as unknown as HTMLVideoElement, dance, client, () => hidden, () => now);
  const update = async () => { feedback.update(session.snapshot()); await flush(); };
  const advance = async (time: number) => { video.currentTime = time; session.tick(time); now += 100; await update(); };
  const start = async () => { video.paused = false; session.play(); await update(); };
  const commands = () => client.outputSnapshot().map(entry => entry.command);
  const dispose = () => { feedback.dispose(); client.dispose(); };
  return { video, client, session, feedback, update, advance, start, commands, dispose,
    hide: () => { hidden = true; }, suspend: () => { now += 10000; } };
}
it('is silent before playback, configures against video time, and syncs each five video seconds', async () => {
  const f = await setup(); await f.update(); expect(f.commands()).toEqual([]);
  await f.start(); expect(f.commands()).toEqual(['RUN:0', 'BPM:120', 'BEAT:0.5000', 'RUN:1']);
  for (let time = 1; time <= 5; time++) await f.advance(time);
  expect(f.commands().filter(c => c.startsWith('SYNC:'))).toEqual(['SYNC:0.0000']); f.dispose();
});
it('emits one hit for a real comparable camera result; duplicate updates and LOST never hit', async () => {
  const f = await setup(); await f.start(); await f.advance(1.1);
  f.session.sample(1.1, f.session.epoch, target()); await f.advance(1.5); await f.update();
  expect(f.session.snapshot().results[0].judgment).toBe('PERFECT');
  await f.advance(2.5); expect(f.session.snapshot().results[1].judgment).toBe('LOST');
  expect(f.commands().filter(c => c === 'HIT:1')).toHaveLength(1); f.dispose();
});
it('pauses silence output, resume reconfigures without old hits, replay permits new judgments', async () => {
  const f = await setup(); await f.start(); await f.advance(1.1); f.session.sample(f.video.currentTime, f.session.epoch, target()); await f.advance(1.5);
  f.video.paused = true; f.video.dispatchEvent(new Event('pause')); f.session.pause(); await f.update();
  expect(f.commands().at(-1)).toBe('RUN:0'); await f.start();
  expect(f.commands().filter(c => c === 'HIT:1')).toHaveLength(1);
  f.video.paused = true; f.session.reset(); f.video.currentTime = 0; await f.update();
  const beforeCountdown = f.commands().length; await f.update(); expect(f.commands()).toHaveLength(beforeCountdown);
  await f.start(); await f.advance(1.1); f.session.sample(f.video.currentTime, f.session.epoch, target()); await f.advance(1.5);
  expect(f.commands().filter(c => c === 'HIT:1')).toHaveLength(2); f.dispose();
});
it('seek, background, results, stalls, playback speed and teardown stop output', async () => {
  for (const reason of ['seek', 'hidden', 'ended', 'waiting', 'speed', 'dispose']) {
    const f = await setup(); await f.start();
    if (reason === 'seek') { f.video.seeking = true; f.video.dispatchEvent(new Event('seeking')); f.session.seek(2); }
    if (reason === 'hidden') f.hide();
    if (reason === 'ended') f.session.finish();
    if (reason === 'waiting') { f.video.dispatchEvent(new Event('waiting')); f.session.pause(); }
    if (reason === 'speed') f.video.playbackRate = 2;
    if (reason === 'dispose') f.feedback.dispose(); else await f.update();
    await flush(); expect(f.commands().at(-1)).toBe('RUN:0'); f.dispose();
  }
});
it('suspension drops accumulated hit feedback and reconfigures; disconnected results do not catch up', async () => {
  const f = await setup(); await f.start(); await f.advance(1.1); f.session.sample(f.video.currentTime, f.session.epoch, target());
  f.suspend(); await f.advance(1.5); expect(f.commands()).not.toContain('HIT:1');
  f.client.disconnect(); f.session.pause(); f.video.paused = true; await f.update();
  f.client.connectSimulator(); await f.update();
  expect(f.commands().at(-1)).toBe('RUN:0'); await f.start(); expect(f.commands()).not.toContain('HIT:1'); f.dispose();
});
it('unobserved camera checkpoints are LOST and never send feedback', async () => {
  const f = await setup(); await f.start(); await f.advance(1); await f.advance(1.5);
  expect(f.session.snapshot().results[0].judgment).toBe('LOST');
  expect(f.commands()).not.toContain('HIT:1'); f.dispose();
});
it('restoring normal speed and seeking to a new segment reconfigure without replaying earlier results', async () => {
  const f = await setup(); await f.start();
  f.video.playbackRate = .5; f.video.dispatchEvent(new Event('ratechange')); await f.update();
  expect(f.commands().at(-1)).toBe('RUN:0');
  f.video.playbackRate = 1; f.video.dispatchEvent(new Event('ratechange')); await f.update();
  expect(f.commands().at(-1)).toBe('RUN:1');
  f.video.currentTime = 5.25; f.session.seek(5.25); await f.update(); await f.start();
  expect(f.commands().slice(-4)).toEqual(['RUN:0', 'BPM:120', 'BEAT:0.2500', 'RUN:1']);
  expect(f.commands()).not.toContain('HIT:1'); f.dispose();
});
