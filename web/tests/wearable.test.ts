import { expect, it, vi } from 'vitest';
import { WearableClient, WearableDecoder, WEARABLE_UUIDS, type BleCharacteristic, type BleDevice } from '../src/core/WearableClient';

class Characteristic extends EventTarget implements BleCharacteristic {
  value?: DataView;
  writeValueWithResponse = vi.fn(async (_value: Uint8Array<ArrayBuffer>) => {});
  startNotifications = vi.fn(async () => {});
  stopNotifications = vi.fn(async () => {});
  notify(text: string) {
    const bytes = new TextEncoder().encode(text);
    this.value = new DataView(bytes.buffer); this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}
function fixture() {
  const tx = new Characteristic();
  const device = new EventTarget() as BleDevice;
  const characteristic = vi.fn(async (_uuid: string) => tx);
  const service = vi.fn(async () => ({ getCharacteristic: characteristic }));
  const connect = vi.fn(async () => { device.gatt!.connected = true; return { getPrimaryService: service }; });
  const disconnect = vi.fn(() => { device.gatt!.connected = false; });
  device.gatt = { connected: false, connect, disconnect };
  const requestDevice = vi.fn(async () => device);
  return { tx, device, characteristic, service, connect, disconnect, requestDevice, client: new WearableClient({ requestDevice }) };
}
it('parses split/coalesced lines once and ignores button edges, joystick, malformed and oversized messages', () => {
  const decoder = new WearableDecoder();
  expect(decoder.feed('DIR:DO')).toEqual([]);
  expect(decoder.feed('WN\nBTN:DOWN\nBTN:CLICK\r\nBTN:UP\nJOY:0,0\nDIR:LEFT\n')).toEqual([
    { type: 'navigate', direction: 'down' }, { type: 'activate' }, { type: 'navigate', direction: 'left' },
  ]);
  expect(decoder.feed('x'.repeat(500))).toEqual([]);
  expect(decoder.feed('BTN:CLICK\nBAD\nBTN:CLICK\n')).toEqual([{ type: 'activate' }]);
  decoder.feed('BTN:'); decoder.reset(); expect(decoder.feed('CLICK\n')).toEqual([]);
});
it('connects using frozen UUIDs and tears down notifications on disconnect', async () => {
  const f = fixture(); const events = vi.fn(); f.client.subscribe(events);
  await f.client.connect();
  expect(f.service).toHaveBeenCalledWith(WEARABLE_UUIDS.service);
  expect(f.characteristic).toHaveBeenCalledWith(WEARABLE_UUIDS.tx);
  expect(f.client.snapshot().status).toBe('connected');
  f.tx.notify('DIR:UP\nBTN:CLICK\n');
  expect(events.mock.calls.map(c => c[0])).toEqual([{ type: 'connected' }, { type: 'navigate', direction: 'up' }, { type: 'activate' }]);
  f.device.dispatchEvent(new Event('gattserverdisconnected'));
  expect(f.client.snapshot().status).toBe('disconnected'); expect(events).toHaveBeenLastCalledWith({ type: 'disconnect' });
  events.mockClear(); f.tx.notify('BTN:CLICK\n'); expect(events).not.toHaveBeenCalled();
  expect(f.tx.stopNotifications).toHaveBeenCalled();
});
it('cleans a connection that completes after cancellation and permits a new connection', async () => {
  const f = fixture(); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.connect.mockImplementationOnce(async () => { await pending; f.device.gatt!.connected = true; return { getPrimaryService: f.service }; });
  const connecting = f.client.connect(); await Promise.resolve();
  f.client.disconnect(); release(); await connecting;
  expect(f.device.gatt!.connected).toBe(false); expect(f.client.snapshot().status).toBe('disconnected');
  await f.client.connect(); expect(f.client.snapshot().status).toBe('connected'); f.client.dispose();
});
it('cleans partial connections and reports notification failures', async () => {
  const f = fixture(); f.tx.startNotifications.mockRejectedValueOnce(new Error('Notifications failed'));
  await f.client.connect(); expect(f.client.snapshot()).toEqual({ status: 'disconnected', error: 'Notifications failed' });
  expect(f.disconnect).toHaveBeenCalled(); f.tx.notify('BTN:CLICK\n');
  await f.client.connect(); expect(f.client.snapshot().status).toBe('connected'); f.client.dispose();
});

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const commands = (f: ReturnType<typeof fixture>) => f.tx.writeValueWithResponse.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes));
it('discovers RX, writes newline-framed commands serially, and samples beat delay when dispatched', async () => {
  const f = fixture(); await f.client.connect();
  expect(f.characteristic).toHaveBeenCalledWith(WEARABLE_UUIDS.rx);
  let release!: () => void; let delay = .5;
  f.tx.writeValueWithResponse.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.client.startFeedback(119.8, () => delay); f.client.hitFeedback();
  expect(commands(f)).toEqual(['RUN:0\n', 'RUN:0\n']);
  delay = .125; release(); await flush();
  expect(commands(f)).toEqual(['RUN:0\n', 'RUN:0\n', 'BPM:120\n', 'BEAT:0.1250\n', 'RUN:1\n', 'HIT:1\n']);
  f.client.dispose();
});
it('pause cancels pending startup/hits and sends stop immediately after the in-flight write', async () => {
  const f = fixture(); await f.client.connect();
  let release!: () => void;
  f.tx.writeValueWithResponse.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.client.startFeedback(120, () => .5); f.client.hitFeedback(); f.client.stopFeedback();
  release(); await flush();
  expect(commands(f)).toEqual(['RUN:0\n', 'RUN:0\n', 'RUN:0\n']); f.client.dispose();
});
it('output timeout disconnects once, clears stale writes, and reconnect cannot replay them', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); await f.client.connect(); const events = vi.fn(); f.client.subscribe(events);
    let release!: () => void;
    f.tx.writeValueWithResponse.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    f.client.startFeedback(120, () => .5); f.client.hitFeedback();
    await vi.advanceTimersByTimeAsync(2001);
    expect(f.client.snapshot().error).toContain('timed out');
    expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'disconnect' });
    await f.client.connect(); release(); await flush();
    expect(commands(f)).toEqual(['RUN:0\n', 'RUN:0\n', 'RUN:0\n']);
    expect(f.client.snapshot().status).toBe('connected'); f.client.dispose();
  } finally { vi.useRealTimers(); }
});
it('write rejection and queue overflow fail closed with a visible error', async () => {
  for (const overflow of [false, true]) {
    const f = fixture(); await f.client.connect();
    let release!: () => void;
    if (overflow) f.tx.writeValueWithResponse.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    else f.tx.writeValueWithResponse.mockRejectedValueOnce(new Error('Write denied'));
    f.client.selectionFeedback();
    if (overflow) for (let i = 0; i < 33; i++) f.client.hitFeedback();
    await flush();
    expect(f.client.snapshot().status).toBe('disconnected');
    expect(f.client.snapshot().error).toContain(overflow ? 'overflow' : 'Write denied');
    release?.(); await flush(); f.client.dispose();
  }
});
it('a missing next beat cannot enable metronome output', async () => {
  const f = fixture(); await f.client.connect(); f.client.startFeedback(120, () => null); await flush();
  expect(commands(f)).not.toContain('RUN:1\n'); f.client.dispose();
});
it('simulator uses the same ordered output queue and retains only 200 commands', async () => {
  const client = new WearableClient(); client.connectSimulator(); await flush();
  for (let i = 0; i < 205; i++) { client.selectionFeedback(); await flush(); }
  expect(client.outputSnapshot()).toHaveLength(200);
  expect(client.outputSnapshot().every(entry => entry.transport === 'simulated' && entry.command === 'TONE:880')).toBe(true);
  client.clearOutput(); expect(client.outputSnapshot()).toEqual([]); client.dispose();
});
it('refuses a receive-only controller rather than claiming feedback is connected', async () => {
  const f = fixture();
  f.characteristic.mockImplementation(async uuid => uuid === WEARABLE_UUIDS.rx ? new EventTarget() as Characteristic : f.tx);
  await f.client.connect();
  expect(f.client.snapshot().status).toBe('disconnected');
  expect(f.client.snapshot().error).toContain('writes with response');
  expect(f.disconnect).toHaveBeenCalled(); f.client.dispose();
});
it('connection loss during the initial stop write cannot leave a stuck connecting state', async () => {
  const f = fixture(); const events = vi.fn(); f.client.subscribe(events);
  let release!: () => void;
  f.tx.writeValueWithResponse.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const connecting = f.client.connect(); await flush();
  f.device.gatt!.connected = false; f.device.dispatchEvent(new Event('gattserverdisconnected'));
  expect(f.client.snapshot().status).toBe('disconnected');
  release(); await connecting;
  expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'disconnect' });
  await f.client.connect(); expect(f.client.snapshot().status).toBe('connected'); f.client.dispose();
});
it('initial output failure notifies gameplay and never reports a connected controller', async () => {
  const f = fixture(); const events = vi.fn(); f.client.subscribe(events);
  f.tx.writeValueWithResponse.mockRejectedValueOnce(new Error('Initial stop failed'));
  await f.client.connect();
  expect(f.client.snapshot()).toEqual({ status: 'disconnected', error: 'Initial stop failed' });
  expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'disconnect' }); f.client.dispose();
});
