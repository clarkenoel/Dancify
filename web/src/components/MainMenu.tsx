import { useSyncExternalStore } from 'react';
import type { WearableClient } from '../core/WearableClient';

/** Approved export: Screens/Main/Menu.png and Main/Menu/Light mode.png. */
export function MainMenu({ wearable, theme, onTheme, onLibrary, onImport }: {
  wearable: WearableClient;
  theme: 'dark' | 'light';
  onTheme: (theme: 'dark' | 'light') => void;
  onLibrary: () => void;
  onImport: () => void;
}) {
  const connection = useSyncExternalStore(wearable.subscribeState, wearable.snapshot);
  return <section className="main-menu" aria-label="Main menu actions">
    <p className="menu-kicker">Choreo made easy</p>
    <h2>Find your rhythm</h2>
    <div className="menu-actions">
      <button className="primary menu-button" data-controller onClick={onLibrary}>Choose video</button>
      <button className="menu-button" data-controller onClick={onImport}>Import video</button>
    </div>
    <p className="connection-badge" role="status">Wearable · {connection.status}{connection.simulated ? ' (simulated)' : ''}</p>
    <div className="theme-actions" aria-label="Color theme">
      <button data-controller aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>Dark mode</button>
      <button data-controller aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>Light mode</button>
    </div>
  </section>;
}
