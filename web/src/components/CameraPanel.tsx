import type { Character } from '../pictograms/rig';
import type { Move } from '../core/types';
import type { useCamera } from '../hooks/useCamera';
import { PoseTarget } from './PoseTarget';

export function CameraPanel({ camera, target, active, showTargetSkeleton = false, character = 'lenny' }: { camera: ReturnType<typeof useCamera>; target?: Move; active: boolean; showTargetSkeleton?: boolean; character?: Character }) {
  const missingDevice = camera.deviceId && !camera.devices.some(d => d.deviceId === camera.deviceId);
  return <section aria-label="Player camera" style={{ minWidth: 0 }}>
    <h3>Your camera</h3>
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative', transform: 'scaleX(-1)' }} aria-label="Mirrored camera view">
        <video ref={camera.cameraRef} muted playsInline width="480" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} aria-label="Webcam preview" />
        <canvas ref={camera.previewRef} role="img" aria-label="Tracked body skeleton" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
      </div>
      <p><label><input type="checkbox" checked={camera.showSkeleton} onChange={e => camera.toggleSkeleton(e.target.checked)} /> Show body skeleton</label></p>
      <p>The preview is mirrored. The skeleton and camera image show the same captured frame.</p>
    </div>
    <p>One player in frame. Player pairing and face identification are not implemented yet.</p>
    <label>Camera <select style={{ maxWidth: '100%' }} aria-label="Camera device" value={camera.deviceId} onChange={e => camera.selectCamera(e.target.value)}>
      <option value="">Default camera</option>
      {camera.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
      {missingDevice && <option value={camera.deviceId}>Selected camera disconnected</option>}
    </select></label>{' '}
    <button onClick={() => void camera.refreshDevices()}>Refresh cameras</button>
    <p>Switching cameras pauses the dance and stops the previous camera. Enable the selected camera to continue.</p>
    <p>
      <button data-controller onClick={() => void camera.startCamera()} disabled={camera.cameraState !== 'off'}>{camera.cameraState === 'starting' ? 'Starting camera…' : camera.cameraState === 'ready' ? 'Camera on' : 'Enable camera'}</button>{' '}
      <button onClick={camera.stopCamera} disabled={camera.cameraState === 'off'}>Stop camera</button>
    </p>
    <p role="status" aria-label="Body tracking status">{camera.tracking}</p>
    {camera.feedback && <p>{camera.feedback.guidance} Visible scoring joints: {camera.feedback.visible}/12. {camera.inferenceMs} ms inference.</p>}
    {camera.error && <p role="alert">{camera.error}</p>}
    {camera.deviceError && <p role="alert">{camera.deviceError}</p>}
    <div aria-label="Camera target pose">
      <h4>{active ? 'Match this target' : 'Next target'}</h4>
      {target ? <PoseTarget move={target} showSkeleton={showTargetSkeleton} character={character} /> : <p>No more target poses.</p>}
    </div>
    <p>Your camera frames stay in this browser. “Ready” describes visibility; it does not confirm player identity or a correct dance pose.</p>
  </section>;
}
