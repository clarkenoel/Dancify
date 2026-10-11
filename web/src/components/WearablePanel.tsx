import { useSyncExternalStore } from 'react';
import type { WearableClient } from '../core/WearableClient';

export function WearablePanel({ wearable }: { wearable: WearableClient }) {
  const output = useSyncExternalStore(wearable.subscribeOutput, wearable.outputSnapshot);
  const state = useSyncExternalStore(wearable.subscribeState, wearable.snapshot);
  return <details><summary>Controller connection and testing</summary>
    <p role="status">Controller: {state.status}{state.simulated ? ' (simulated ESP32)' : ''}</p>
    {!wearable.supported && <p>Web Bluetooth is unavailable here. Use desktop Chrome/Edge on localhost or HTTPS. On-screen and simulated menu controls remain available. Camera tracking is required to play.</p>}
    <button disabled={!wearable.supported || state.status !== 'disconnected'} onClick={() => void wearable.connect()}>Connect ESP32</button>{' '}
    <button disabled={state.status !== 'connected'} onClick={() => wearable.disconnect()}>Disconnect ESP32</button>
    <button disabled={state.status !== 'disconnected'} onClick={() => wearable.connectSimulator()}>Connect simulated ESP32</button>
    {state.error && <p role="alert">{state.error}</p>}
    <p>Test menu controls without hardware:</p>
    <button onClick={() => wearable.simulate({ type: 'navigate', direction: 'up' })}>Previous item</button>{' '}
    <button onClick={() => wearable.simulate({ type: 'navigate', direction: 'down' })}>Next item</button>{' '}
    <button onClick={() => wearable.simulate({ type: 'activate' })}>Select item</button>
    <details><summary>Wearable command monitor ({output.length}/200)</summary>
      <p>Successful browser writes only. Simulation does not prove audible timing or award scores. HIT follows a finalized checkpoint, not an exact dance hit timestamp.</p>
      <button onClick={wearable.clearOutput}>Clear commands</button>
      <ol aria-label="Wearable commands">{output.map(entry => <li key={entry.sequence}>{entry.transport}: <code>{entry.command}</code></li>)}</ol>
    </details>
    <p>Up/Down arrows move menu focus; Enter selects. Controls never award camera scores. Device connection does not identify who is wearing it.</p>
  </details>;
}
