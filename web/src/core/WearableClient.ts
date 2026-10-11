/** Browser Bluetooth access lives only here. UUIDs match schema/wearable.protocol.md. */
export const WEARABLE_UUIDS = {
  service: '7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
  rx: '7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
  tx: '7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c',
};
export type WearableEvent = { type: 'navigate'; direction: 'up' | 'down' | 'left' | 'right' } | { type: 'activate' } | { type: 'togglePlayback' } | { type: 'disconnect' } | { type: 'connected' };
export type WearableState = { status: 'disconnected' | 'connecting' | 'connected'; error: string; simulated?: boolean };
export interface BleCharacteristic extends EventTarget {
  value?: DataView;
  writeValueWithResponse?(value: Uint8Array<ArrayBuffer>): Promise<unknown>;
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

export interface OutputEntry { sequence: number; command: string; transport: 'simulated' | 'bluetooth' }
type OutputCommand = () => string | null;

export class WearableClient {
  private rx?: BleCharacteristic;
  private outputEpoch = 0;
  private queue: { epoch: number; command: OutputCommand }[] = [];
  private writing = false;
  private outputListeners = new Set<() => void>();
  private output: OutputEntry[] = [];
  private sequence = 0;
  outputSnapshot = () => this.output;
  subscribeOutput = (listener: () => void) => { this.outputListeners.add(listener); return () => { this.outputListeners.delete(listener); }; };
  clearOutput = () => { this.output = []; this.outputListeners.forEach(fn => fn()); };
  private record(command: string) {
    this.output = [...this.output.slice(-199), { sequence: ++this.sequence, command, transport: this.state.simulated ? 'simulated' as const : 'bluetooth' as const }];
    this.outputListeners.forEach(fn => fn());
  }
  private async write(command: string) {
    if (this.state.simulated) return;
    if (!this.rx?.writeValueWithResponse) throw new Error('Controller RX must support writes with response.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.rx.writeValueWithResponse(new TextEncoder().encode(command + '\n')),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Controller write timed out.')), 2000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  private enqueue(commands: OutputCommand[]) {
    if (this.state.status !== 'connected') return;
    if (this.queue.length + commands.length > 32) { this.outputFailed('Controller output queue overflow.'); return; }
    this.queue.push(...commands.map(command => ({ epoch: this.outputEpoch, command })));
    void this.drain();
  }
  private async drain() {
    if (this.writing) return;
    this.writing = true;
    const generation = this.generation;
    try {
      while (this.queue.length && this.state.status === 'connected' && generation === this.generation) {
        const item = this.queue.shift()!;
        if (item.epoch !== this.outputEpoch) continue;
        const command = item.command();
        if (command === null) continue;
        await this.write(command);
        if (generation === this.generation) this.record(command);
      }
    } catch (error) {
      if (generation === this.generation) this.outputFailed(error instanceof Error ? error.message : 'Controller write failed.');
    } finally {
      this.writing = false;
      if (this.queue.length) void this.drain();
    }
  }
  private outputFailed(message: string) {
    this.generation++; this.cleanup();
    this.setState('disconnected', `${message} Reconnect or continue without the controller.`);
    this.simulate({ type: 'disconnect' });
  }
  /** Cancels queued commands. An already submitted GATT write cannot be recalled. */
  stopFeedback() {
    this.outputEpoch++; this.queue = [];
    this.enqueue([() => 'RUN:0']);
  }
  startFeedback(bpm: number, secondsToBeat: () => number | null) {
    this.stopFeedback();
    if (!Number.isFinite(bpm) || bpm < 1) return;
    let configured = false;
    this.enqueue([() => `BPM:${Math.round(bpm)}`, () => {
      const delay = secondsToBeat(); configured = delay !== null && Number.isFinite(delay) && delay >= 0;
      return configured ? `BEAT:${delay!.toFixed(4)}` : null;
    }, () => configured ? 'RUN:1' : null]);
  }
  syncFeedback(secondsToBeat: () => number | null) {
    this.enqueue([() => { const delay = secondsToBeat(); return delay !== null && Number.isFinite(delay) && delay >= 0 ? `SYNC:${delay.toFixed(4)}` : null; }]);
  }
  hitFeedback() { this.enqueue([() => 'HIT:1']); }
  selectionFeedback() { this.enqueue([() => 'TONE:880']); }
  connectSimulator() {
    if (this.connecting || this.state.status !== 'disconnected') return;
    this.generation++; this.state = { status: 'connected', error: '', simulated: true };
    this.stateListeners.forEach(fn => fn()); this.stopFeedback(); this.simulate({ type: 'connected' });
  }

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
    this.generation++; this.cleanup(); this.setState('disconnected', 'Controller disconnected. Reconnect or continue without the controller.');
    this.simulate({ type: 'disconnect' });
  };
  private cleanup() {
    this.outputEpoch++; this.queue = []; this.rx = undefined;
    const characteristic = this.characteristic; this.characteristic = undefined;
    characteristic?.removeEventListener('characteristicvaluechanged', this.notification);
    if (characteristic) void characteristic.stopNotifications().catch(() => {});
    this.device?.removeEventListener('gattserverdisconnected', this.disconnected);
    this.device?.gatt?.disconnect(); this.device = undefined; this.decoder.reset();
  }
  async connect() {
    if (this.connecting || this.state.status === 'connected') return;
    if (!this.bluetooth) { this.setState('disconnected', 'Web Bluetooth is unavailable. Use desktop Chrome or Edge on localhost/HTTPS, or continue without the controller.'); return; }
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
      const rx = await service.getCharacteristic(WEARABLE_UUIDS.rx);
      if (generation !== this.generation) { device.gatt.disconnect(); return; }
      this.device = device; this.characteristic = characteristic; this.rx = rx;
      device.addEventListener('gattserverdisconnected', this.disconnected);
      await this.write('RUN:0');
      if (generation !== this.generation) { this.cleanup(); return; }
      await characteristic.startNotifications();
      if (generation !== this.generation) { this.cleanup(); return; }
      if (!device.gatt.connected) throw new Error('Controller disconnected during setup.');
      characteristic.addEventListener('characteristicvaluechanged', this.notification);
      this.setState('connected'); this.record('RUN:0'); this.simulate({ type: 'connected' });
    } catch (error) {
      if (generation === this.generation) {
        const hadConnection = this.device !== undefined;
        this.cleanup(); device?.gatt?.disconnect();
        this.setState('disconnected', error instanceof Error ? error.message : 'Could not connect to the controller.');
        if (hadConnection) this.simulate({ type: 'disconnect' });
      }
    } finally { if (generation !== this.generation) device?.gatt?.disconnect(); this.connecting = false; }
  }
  disconnect() { this.generation++; this.cleanup(); this.setState('disconnected'); this.simulate({ type: 'disconnect' }); }
  dispose() { this.disconnect(); this.listeners.clear(); this.stateListeners.clear(); this.outputListeners.clear(); }
}
