import { useSyncExternalStore } from 'react';
import type { WearableClient } from '../core/WearableClient';

export function WearablePanel({ wearable }: { wearable: WearableClient }) {
  const state = useSyncExternalStore(wearable.subscribeState, wearable.snapshot);
  return <details><summary>Controller connection and testing</summary>
    <p role="status">Controller: {state.status}</p>
    {!wearable.supported && <p>Web Bluetooth is unavailable here. Use desktop Chrome/Edge on localhost or HTTPS. Keyboard and simulated controls remain available.</p>}
    <button disabled={!wearable.supported || state.status !== 'disconnected'} onClick={() => void wearable.connect()}>Connect ESP32</button>{' '}
    <button disabled={state.status !== 'connected'} onClick={() => wearable.disconnect()}>Disconnect ESP32</button>
    {state.error && <p role="alert">{state.error}</p>}
    <p>Test menu controls without hardware:</p>
    <button onClick={() => wearable.simulate({ type: 'navigate', direction: 'up' })}>Previous item</button>{' '}
    <button onClick={() => wearable.simulate({ type: 'navigate', direction: 'down' })}>Next item</button>{' '}
    <button onClick={() => wearable.simulate({ type: 'activate' })}>Select item</button>
    <p>Up/Down arrows move menu focus; Enter selects. Controls never award camera scores. Device connection does not identify who is wearing it.</p>
  </details>;
}
