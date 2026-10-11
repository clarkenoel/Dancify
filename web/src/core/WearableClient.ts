/** Browser Bluetooth access lives only here. UUIDs match schema/wearable.protocol.md. */
export const WEARABLE_UUIDS = {
  service: '7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
  rx: '7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
  tx: '7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
};
export type WearableEvent = { type: 'navigate'; direction: 'up' | 'down' | 'left' | 'right' } | { type: 'activate' } | { type: 'togglePlayback' } | { type: 'disconnect' } | { type: 'connected' };
export type WearableState = { status: 'disconnected' | 'connecting' | 'connected'; error: string };
export interface BleCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
}
export interface BleDevice extends EventTarget {
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }> }>;
    disconnect(): void;
  };
}
export interface BluetoothAdapter {
  requestDevice(options: { filters: { services: string[]; namePrefix: string }[] }): Promise<BleDevice>;
}

/** Newline framing handles split/coalesced BLE notifications, with bounded input. */
export class WearableDecoder {
  private buffer = '';
  private dropping = false;
  reset() { this.buffer = ''; this.dropping = false; }
  feed(text: string): WearableEvent[] {
    const events: WearableEvent[] = [];
    for (const char of text) {
      if (char === '\n') {
        if (!this.dropping) {
          const line = this.buffer.replace(/\r$/, '');
          const direction = /^DIR:(UP|DOWN|LEFT|RIGHT)$/.exec(line);
          if (direction) events.push({ type: 'navigate', direction: direction[1].toLowerCase() as 'up' | 'down' | 'left' | 'right' });
          else if (line === 'BTN:CLICK') events.push({ type: 'activate' });
        }
        this.reset();
      } else if (!this.dropping) {
        this.buffer += char;
        if (this.buffer.length > 128) { this.buffer = ''; this.dropping = true; }
      }
    }
    return events;
  }
}

export class WearableClient {
  private listeners = new Set<(event: WearableEvent) => void>();
  private stateListeners = new Set<() => void>();
  private state: WearableState = { status: 'disconnected', error: '' };
  private generation = 0;
  private connecting = false;
  private device?: BleDevice;
  private characteristic?: BleCharacteristic;
  private decoder = new WearableDecoder();
  private bluetooth?: BluetoothAdapter;
  constructor(adapter?: BluetoothAdapter) {
    this.bluetooth = adapter ?? (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BluetoothAdapter }).bluetooth);
  }
  get supported() { return !!this.bluetooth; }
  snapshot = () => this.state;
  subscribeState = (listener: () => void) => { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; };
  private setState(status: WearableState['status'], error = '') { this.state = { status, error }; this.stateListeners.forEach(fn => fn()); }
  subscribe(listener: (event: WearableEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  simulate(event: WearableEvent) { this.listeners.forEach(fn => fn(event)); }
  private notification = (event: Event) => {
    if (event.target !== this.characteristic) return;
    const value = this.characteristic?.value;
    if (this.state.status !== 'connected' || !value || value.byteLength > 4096) return;
    // The frozen protocol is ASCII UTF-8. Split ASCII lines are buffered by the decoder.
    for (const event of this.decoder.feed(new TextDecoder().decode(value))) this.simulate(event);
  };
  private disconnected = () => {
    this.generation++; this.cleanup(); this.setState('disconnected', 'Controller disconnected. Reconnect or continue with keyboard controls.');
    this.simulate({ type: 'disconnect' });
  };
  private cleanup() {
    const characteristic = this.characteristic; this.characteristic = undefined;
    characteristic?.removeEventListener('characteristicvaluechanged', this.notification);
    if (characteristic) void characteristic.stopNotifications().catch(() => {});
    this.device?.removeEventListener('gattserverdisconnected', this.disconnected);
    this.device?.gatt?.disconnect(); this.device = undefined; this.decoder.reset();
  }
  async connect() {
    if (this.connecting || this.state.status === 'connected') return;
    if (!this.bluetooth) { this.setState('disconnected', 'Web Bluetooth is unavailable. Use desktop Chrome or Edge on localhost/HTTPS, or use keyboard controls.'); return; }
    const generation = ++this.generation; this.connecting = true; this.setState('connecting');
    let device: BleDevice | undefined;
    try {
      device = await this.bluetooth.requestDevice({ filters: [{ services: [WEARABLE_UUIDS.service], namePrefix: 'Dancify-Wearable' }] });
      if (generation !== this.generation) return;
      if (!device.gatt) throw new Error('This device has no Bluetooth GATT server.');
      const server = await device.gatt.connect();
      if (generation !== this.generation) { device.gatt.disconnect(); return; }
      const service = await server.getPrimaryService(WEARABLE_UUIDS.service);
      const characteristic = await service.getCharacteristic(WEARABLE_UUIDS.tx);
      if (generation !== this.generation) { device.gatt.disconnect(); return; }
      this.device = device; this.characteristic = characteristic;
      device.addEventListener('gattserverdisconnected', this.disconnected);
      await characteristic.startNotifications();
      if (generation !== this.generation || !device.gatt.connected) { this.cleanup(); return; }
      characteristic.addEventListener('characteristicvaluechanged', this.notification);
      this.setState('connected'); this.simulate({ type: 'connected' });
    } catch (error) {
      if (generation === this.generation) {
        this.cleanup(); device?.gatt?.disconnect();
        this.setState('disconnected', error instanceof Error ? error.message : 'Could not connect to the controller.');
      }
    } finally { if (generation !== this.generation) device?.gatt?.disconnect(); this.connecting = false; }
  }
  disconnect() { this.generation++; this.cleanup(); this.setState('disconnected'); this.simulate({ type: 'disconnect' }); }
  dispose() { this.disconnect(); this.listeners.clear(); this.stateListeners.clear(); }
}
