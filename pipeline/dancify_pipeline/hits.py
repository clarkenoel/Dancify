"""Just Dance–style hits: energy valleys snapped to beat/half-beat grid."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks


def _smooth_energy(energy: np.ndarray, frames: int = 7) -> np.ndarray:
    if energy.size < 3:
        return energy.copy()
    w = min(frames, energy.size if energy.size % 2 == 1 else energy.size - 1)
    if w < 3:
        return energy.copy()
    return uniform_filter1d(energy.astype(np.float64), size=w, mode="nearest")


def find_energy_dips(
    energy: np.ndarray,
    times: np.ndarray,
    min_prominence: float | None = None,
    min_distance_frames: int = 8,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (dip_times, dip_frame_indices) for local minima of smoothed energy."""
    if energy.size < 3:
        return np.array([], dtype=np.float64), np.array([], dtype=np.int64)
    sm = _smooth_energy(energy)
    inv = -sm
    prom = min_prominence
    if prom is None:
        prom = float(np.std(sm) * 0.4) if np.std(sm) > 0 else 0.01
    peaks, props = find_peaks(
        inv, distance=min_distance_frames, prominence=max(prom, 1e-4)
    )
    return times[peaks], peaks.astype(np.int64)


def beat_grid(beat_times: list[float], half_beats: bool = True) -> np.ndarray:
    grid = np.asarray(beat_times, dtype=np.float64)
    if half_beats and grid.size >= 2:
        halves = (grid[:-1] + grid[1:]) / 2.0
        grid = np.sort(np.concatenate([grid, halves]))
    return grid


def snap_to_beats(
    hit_times: np.ndarray,
    beat_times: list[float],
    half_beats: bool = True,
) -> np.ndarray:
    """Snap each time to nearest beat/half-beat."""
    if hit_times.size == 0:
        return hit_times
    grid = beat_grid(beat_times, half_beats=half_beats)
    if grid.size == 0:
        return hit_times
    snapped = [float(grid[int(np.argmin(np.abs(grid - t)))]) for t in hit_times]
    out: list[float] = []
    for t in snapped:
        if not out or abs(out[-1] - t) > 1e-3:
            out.append(t)
    return np.asarray(out, dtype=np.float64)


def select_musical_hits(
    energy: np.ndarray,
    times: np.ndarray,
    beat_times: list[float],
    duration: float,
    bpm: float,
    target_beats_per_hit: float = 2.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Valley-first JD calibration.

    1) Find local motion-energy valleys (held poses).
    2) Keep valleys that sit near a beat/half-beat (snap window).
    3) Hit time = snapped grid time (red marker on beat).
    4) Keyframe index = valley frame (actual held pose).
    5) Thin to ~every 1–2 beats by valley depth score.

    Returns (hit_times_on_grid, keyframe_frame_indices).
    """
    beat_period = 60.0 / bpm if bpm > 1 else 0.5
    # Allow snap within ~35% of a beat (JD pictograms land on/near the count)
    snap_win = 0.35 * beat_period
    grid = beat_grid(beat_times, half_beats=True)
    grid = grid[(grid >= 0.2) & (grid <= max(duration - 0.2, 0.2))]
    if grid.size == 0:
        return np.array([], dtype=np.float64), np.array([], dtype=np.int64)

    sm = _smooth_energy(energy)
    dip_times, dip_idxs = find_energy_dips(energy, times)
    if dip_times.size == 0:
        # Fallback: sample every Nth beat with local valley search
        step = max(1, int(round(target_beats_per_hit)))
        hits = grid[::step]
        kfi = np.array([int(np.argmin(np.abs(times - h))) for h in hits], dtype=np.int64)
        return hits.astype(np.float64), kfi

    candidates: list[tuple[float, int, float]] = []  # (grid_t, valley_frame, score)
    used_grid: set[float] = set()
    for dt, di in zip(dip_times, dip_idxs):
        j = int(np.argmin(np.abs(grid - dt)))
        g = float(grid[j])
        if abs(dt - g) > snap_win:
            continue
        # Valley depth: neighbors higher than valley
        lo = max(0, di - 4)
        hi = min(len(sm) - 1, di + 4)
        neigh = np.concatenate([sm[lo:di], sm[di + 1 : hi + 1]]) if hi > lo else sm[di : di + 1]
        depth = float(np.mean(neigh) - sm[di]) if neigh.size else 0.0
        if depth <= 0:
            continue
        # Prefer tighter snap + deeper valley; energy at grid shouldn't be a peak
        gi = int(np.argmin(np.abs(times - g)))
        at_grid = float(sm[gi])
        # Penalize if beat sits on a high-energy slope/peak vs valley
        peak_pen = max(0.0, at_grid - sm[di])
        closeness = 1.0 - (abs(dt - g) / snap_win)
        edge = 0.7 if (g < 0.5 or g > duration - 0.5) else 1.0
        score = (depth + 0.15) * (0.55 + 0.45 * closeness) * edge - 0.35 * peak_pen
        # One candidate per grid slot — keep best score
        if g in used_grid:
            # replace if better
            for k, (gg, _, sc) in enumerate(candidates):
                if abs(gg - g) < 1e-6 and score > sc:
                    candidates[k] = (g, int(di), score)
                    break
        else:
            used_grid.add(g)
            candidates.append((g, int(di), score))

    if not candidates:
        step = max(1, int(round(target_beats_per_hit)))
        hits = grid[::step][: max(4, int(duration))]
        kfi = np.array([int(np.argmin(np.abs(times - h))) for h in hits], dtype=np.int64)
        return np.asarray(hits, dtype=np.float64), kfi

    # Sort by score descending; greedy min-gap
    candidates.sort(key=lambda x: -x[2])
    min_gap = target_beats_per_hit * beat_period * 0.85
    target_n = int(round(duration / (target_beats_per_hit * beat_period)))
    target_n = int(np.clip(target_n, 4, max(4, int(duration * 1.25))))

    chosen: list[tuple[float, int]] = []
    for g, di, score in candidates:
        if score <= 0 and chosen:
            continue
        if any(abs(g - c[0]) < min_gap for c in chosen):
            continue
        chosen.append((g, di))
        if len(chosen) >= target_n:
            break

    if len(chosen) < 4:
        # Fill from remaining grid with local valley under each beat
        for g in grid:
            if any(abs(g - c[0]) < min_gap for c in chosen):
                continue
            mask = (times >= g - snap_win) & (times <= g + snap_win)
            if not np.any(mask):
                continue
            idxs = np.where(mask)[0]
            di = int(idxs[int(np.argmin(sm[idxs]))])
            chosen.append((float(g), di))
            if len(chosen) >= 4:
                break

    chosen.sort(key=lambda x: x[0])
    hit_times = np.asarray([c[0] for c in chosen], dtype=np.float64)
    key_idxs = np.asarray([c[1] for c in chosen], dtype=np.int64)
    return hit_times, key_idxs


def build_moves(
    hit_times: np.ndarray,
    frames: np.ndarray,
    times: np.ndarray,
    duration: float,
    keyframe_indices: np.ndarray | None = None,
    window: float = 0.5,
) -> list[dict]:
    """One keyframe pose per hit; windows centered on hit time (JD pictogram moment)."""
    moves: list[dict] = []
    hits = list(hit_times)
    for i, t in enumerate(hits):
        # Center the judgment window on the musical hit (red marker)
        start = max(0.0, float(t) - window * 0.5)
        end = min(duration, float(t) + window * 0.5)
        if i + 1 < len(hits):
            mid = (float(t) + float(hits[i + 1])) / 2.0
            end = min(end, mid)
        if i > 0:
            prev_end = moves[-1]["end"]
            if start < prev_end:
                start = prev_end
        if end <= start + 0.12:
            end = min(duration, float(t) + 0.2)
            start = max(0.0, float(t) - 0.2)
            if i > 0 and start < moves[-1]["end"]:
                start = moves[-1]["end"]

        if keyframe_indices is not None and i < len(keyframe_indices):
            fi = int(keyframe_indices[i])
            fi = max(0, min(fi, len(frames) - 1))
        else:
            fi = int(np.argmin(np.abs(times - t)))
        key = frames[fi]
        moves.append(
            {
                "id": f"m{i}",
                "start": round(float(start), 4),
                "end": round(float(end), 4),
                "keyframe_landmarks": [
                    [round(float(x), 6) for x in row] for row in key.tolist()
                ],
                "is_hold": False,
            }
        )
    return moves
