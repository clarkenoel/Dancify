import type { Page, TestInfo } from '@playwright/test';

/** Test-only timing evidence: no images, landmarks, app state or deadlines change. */
export async function recordCameraDiagnostics(page: Page) {
  const messages: { type: string; text: string }[] = [];
  const addMessage = (type: string, text: string) => {
    messages.push({ type, text: text.slice(0, 1000) });
    if (messages.length > 80) messages.shift();
  };
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) addMessage(message.type(), message.text()); });
  page.on('pageerror', error => addMessage('pageerror', error.message));
  await page.addInitScript(() => {
    const events: Record<string, unknown>[] = [];
    const record = (event: Record<string, unknown>) => {
      events.push({ atMs: Math.round(performance.now()), ...event });
      if (events.length > 400) events.shift();
    };
    let patched = false, inference = 0, previousState = '';
    let observedVideo: HTMLVideoElement | null = null;
    const interval = setInterval(() => {
      const pose = (window as unknown as { Pose?: { prototype: { send: (...args: unknown[]) => Promise<unknown> } } }).Pose;
      if (!patched && pose?.prototype.send) {
        const original = pose.prototype.send;
        pose.prototype.send = function(this: unknown, ...args: unknown[]) {
          const id = ++inference, started = performance.now();
          record({ type: 'inference-start', id });
          try {
            const result = original.apply(this, args);
            void result.then(() => record({ type: 'inference-end', id, elapsedMs: Math.round(performance.now() - started) }),
              error => record({ type: 'inference-error', id, message: String(error).slice(0, 300) }));
            return result;
          } catch (error) { record({ type: 'inference-throw', id, message: String(error).slice(0, 300) }); throw error; }
        };
        patched = true; record({ type: 'pose-runtime-observed' });
      }
      const reference = document.querySelector<HTMLVideoElement>('[aria-label="Reference video"]');
      if (reference && reference !== observedVideo) {
        observedVideo = reference;
        for (const name of ['playing', 'pause', 'waiting', 'seeking', 'ended']) reference.addEventListener(name,
          () => record({ type: 'media-event', name, time: reference.currentTime, paused: reference.paused }));
      }
      const ready = [...document.querySelectorAll('button')].find(button => button.textContent === 'Ready — start / resume');
      const state = { type: 'state', time: reference?.currentTime, paused: reference?.paused, mediaReady: reference?.readyState,
        readyEnabled: ready ? !ready.disabled : null,
        tracking: document.querySelector('[aria-label="Body tracking status"]')?.textContent,
        countdown: document.querySelector('[aria-label="Replay countdown"]')?.textContent,
        alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent?.slice(0, 400)), hidden: document.hidden };
      const serialized = JSON.stringify(state);
      if (serialized !== previousState) { previousState = serialized; record(state); }
    }, 500);
    Object.assign(window, { readCameraDiagnostics: () => {
      clearInterval(interval);
      return { userAgent: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency, events };
    } });
  });
  return async (info: TestInfo) => {
    if (info.status === info.expectedStatus) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const browserState = await Promise.race([
      page.evaluate(() => (window as unknown as { readCameraDiagnostics?: () => unknown }).readCameraDiagnostics?.()).catch(error => ({ captureError: String(error) })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ captureError: 'Renderer did not answer within 5 seconds' }), 5000); }),
    ]);
    if (timer) clearTimeout(timer);
    await info.attach('camera-timing-diagnostics', { body: Buffer.from(JSON.stringify({ browserState, messages }, null, 2)), contentType: 'application/json' });
  };
}
