import type { Character } from '../pictograms/rig';
import type { Move } from '../core/types';
import type { useCamera } from '../hooks/useCamera';
import { PoseTarget } from './PoseTarget';

export function CameraPanel({ camera, target, active, showTargetSkeleton = false, character = 'lenny' }: { camera: ReturnType<typeof useCamera>; target?: Move; active: boolean; showTargetSkeleton?: boolean; character?: Character }) {
  return <section className="video-panel" aria-label="Player camera" style={{ minWidth: 0 }}>
    <h3>Your camera</h3>
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative', transform: 'scaleX(-1)' }} aria-label="Mirrored camera view">
        <video ref={camera.cameraRef} muted playsInline width="480" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} aria-label="Webcam preview" />
        <canvas ref={camera.previewRef} role="img" aria-label="Tracked body skeleton" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
      </div>
    </div>
    <p>
      <button className="primary" data-controller onClick={() => void camera.startCamera()} disabled={camera.cameraState !== 'off'}>{camera.cameraState === 'starting' ? 'Starting camera…' : camera.cameraState === 'ready' ? 'Camera on' : 'Enable camera'}</button>{' '}

    </p>
    <p role="status" aria-label="Body tracking status">{camera.tracking}</p>
    {camera.feedback && <p>{camera.feedback.guidance}</p>}
    {camera.error && <p role="alert">{camera.error}</p>}
    {camera.deviceError && <p role="alert">{camera.deviceError}</p>}
    <div aria-label="Camera target pose">
      <h4>{active ? 'Match this target' : 'Next target'}</h4>
      {target ? <PoseTarget move={target} showSkeleton={showTargetSkeleton} character={character} /> : <p>No more target poses.</p>}
    </div>
    <p>Your camera frames stay in this browser. “Ready” describes visibility; it does not confirm player identity or a correct dance pose.</p>
  </section>;
}

export function CameraSettings({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const missingDevice = camera.deviceId && !camera.devices.some(d => d.deviceId === camera.deviceId);
  return <section aria-label="Camera settings">
    <label>Camera <select aria-label="Camera device" value={camera.deviceId} onChange={e => camera.selectCamera(e.target.value)}>
      <option value="">Default camera</option>
      {camera.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
      {missingDevice && <option value={camera.deviceId}>Selected camera disconnected</option>}
    </select></label>
    <p className="help">Changing cameras pauses the round. Enable the selected camera after returning.</p>
    <div className="action-row"><button data-controller onClick={() => void camera.refreshDevices()}>Refresh cameras</button>
      <button data-controller onClick={camera.stopCamera} disabled={camera.cameraState === 'off'}>Stop camera</button></div>
    <label><input type="checkbox" checked={camera.showSkeleton} onChange={e => camera.toggleSkeleton(e.target.checked)} /> Show body skeleton</label>
    {camera.deviceError && <p role="alert">{camera.deviceError}</p>}
  </section>;
}
