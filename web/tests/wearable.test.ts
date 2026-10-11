import { expect, it, vi } from 'vitest';
import { WearableClient, WearableDecoder, WEARABLE_UUIDS, type BleCharacteristic, type BleDevice } from '../src/core/WearableClient';

class Characteristic extends EventTarget implements BleCharacteristic {
  value?: DataView;
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
  const characteristic = vi.fn(async () => tx);
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
