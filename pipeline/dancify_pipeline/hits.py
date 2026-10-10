"""Find motion-energy dips, snap to beats, build move windows."""

from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks


def find_energy_dips(
    energy: np.ndarray,
    times: np.ndarray,
    min_prominence: float | None = None,
    min_distance_frames: int = 12,
) -> np.ndarray:
    """Return timestamps of local minima (held poses / hit moments)."""
    if energy.size < 3:
        return np.array([], dtype=np.float64)
    inv = -energy
    prom = min_prominence
    if prom is None:
        # Prefer clearer valleys so short clips don't become a hit every beat.
        prom = float(np.std(energy) * 0.5) if np.std(energy) > 0 else 0.01
    peaks, _ = find_peaks(inv, distance=min_distance_frames, prominence=max(prom, 1e-4))
    return times[peaks]


def snap_to_beats(
    hit_times: np.ndarray,
    beat_times: list[float],
    half_beats: bool = True,
) -> np.ndarray:
    """Snap each hit to nearest beat (or half-beat)."""
    if hit_times.size == 0:
        return hit_times
    grid = np.asarray(beat_times, dtype=np.float64)
    if half_beats and grid.size >= 2:
        halves = (grid[:-1] + grid[1:]) / 2.0
        grid = np.sort(np.concatenate([grid, halves]))
    if grid.size == 0:
        return hit_times
    snapped = []
    for t in hit_times:
        j = int(np.argmin(np.abs(grid - t)))
        snapped.append(float(grid[j]))
    # unique while preserving order
    out: list[float] = []
    for t in snapped:
        if not out or abs(out[-1] - t) > 1e-3:
            out.append(t)
    return np.asarray(out, dtype=np.float64)


def build_moves(
    hit_times: np.ndarray,
    frames: np.ndarray,
    times: np.ndarray,
    duration: float,
    window: float = 0.45,
) -> list[dict]:
    """One keyframe pose per hit (schema: single 33×4 snapshot, not a trajectory)."""
    moves: list[dict] = []
    for i, t in enumerate(hit_times):
        start = max(0.0, float(t) - window * 0.35)
        end = min(duration, float(t) + window * 0.65)
        # pick nearest frame for keyframe
        fi = int(np.argmin(np.abs(times - t)))
        key = frames[fi]
        moves.append(
            {
                "id": f"m{i}",
                "start": round(start, 4),
                "end": round(end, 4),
                "keyframe_landmarks": [
                    [round(float(x), 6) for x in row] for row in key.tolist()
                ],
                "is_hold": False,
            }
        )
    return moves
