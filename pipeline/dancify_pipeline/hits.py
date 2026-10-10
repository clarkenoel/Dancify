"""Musically useful hit detection: score beats by energy valleys, thin to playable density."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks


def _smooth_energy(energy: np.ndarray, frames: int = 5) -> np.ndarray:
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
    min_distance_frames: int = 12,
) -> np.ndarray:
    """Local minima of smoothed energy (held / settle poses)."""
    if energy.size < 3:
        return np.array([], dtype=np.float64)
    sm = _smooth_energy(energy)
    inv = -sm
    prom = min_prominence
    if prom is None:
        prom = float(np.std(sm) * 0.55) if np.std(sm) > 0 else 0.01
    peaks, _ = find_peaks(inv, distance=min_distance_frames, prominence=max(prom, 1e-4))
    return times[peaks]


def snap_to_beats(
    hit_times: np.ndarray,
    beat_times: list[float],
    half_beats: bool = False,
) -> np.ndarray:
    """Snap each hit to nearest beat (half-beats off by default for cleaner charts)."""
    if hit_times.size == 0:
        return hit_times
    grid = np.asarray(beat_times, dtype=np.float64)
    if half_beats and grid.size >= 2:
        halves = (grid[:-1] + grid[1:]) / 2.0
        grid = np.sort(np.concatenate([grid, halves]))
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
) -> np.ndarray:
    """Pick whole-beat hit times with playable density.

    For each beat, score how much of an energy *valley* sits nearby (PRD: dips =
    held poses). Then greedily keep highest-scoring beats with ~2-beat spacing.
    """
    beats = np.asarray(
        [t for t in beat_times if 0.25 <= t <= max(duration - 0.25, 0.25)],
        dtype=np.float64,
    )
    if beats.size == 0:
        return np.array([], dtype=np.float64)

    sm = _smooth_energy(energy)
    # Local contrast: how much lower is energy at beat vs neighborhood mean
    scores = np.zeros(beats.size, dtype=np.float64)
    half_win = 0.22  # ~half beat at 136bpm
    for i, b in enumerate(beats):
        mask = (times >= b - half_win) & (times <= b + half_win)
        if not np.any(mask):
            continue
        local = float(np.min(sm[mask]))
        # neighborhood for contrast
        neigh = (times >= b - 2 * half_win) & (times <= b + 2 * half_win)
        neigh_mean = float(np.mean(sm[neigh])) if np.any(neigh) else local
        valley = max(0.0, neigh_mean - local)
        # Prefer mid-clip beats slightly
        edge = 1.0
        if b < 0.6 or b > duration - 0.6:
            edge = 0.65
        scores[i] = valley * edge

    # Also boost beats near classic dip finder’s timestamps
    dips = find_energy_dips(energy, times)
    for i, b in enumerate(beats):
        if dips.size and float(np.min(np.abs(dips - b))) < 0.12:
            scores[i] *= 1.35

    beat_period = 60.0 / bpm if bpm > 1 else 0.5
    min_gap = target_beats_per_hit * beat_period * 0.9
    # Target count for a short Just Dance–style chart
    target_n = int(round(duration / (target_beats_per_hit * beat_period)))
    target_n = int(np.clip(target_n, 4, max(4, int(duration * 1.2))))

    order = np.argsort(-scores)
    chosen: list[float] = []
    for idx in order:
        if scores[idx] <= 0 and chosen:
            continue
        t = float(beats[idx])
        if any(abs(t - c) < min_gap for c in chosen):
            continue
        chosen.append(t)
        if len(chosen) >= target_n:
            break

    # Fallback: every Nth beat if scoring failed
    if len(chosen) < 4:
        step = max(1, int(round(target_beats_per_hit)))
        chosen = beats[::step][: max(4, target_n)].tolist()

    return np.asarray(sorted(chosen), dtype=np.float64)


def build_moves(
    hit_times: np.ndarray,
    frames: np.ndarray,
    times: np.ndarray,
    duration: float,
    window: float = 0.55,
) -> list[dict]:
    """One keyframe pose per hit; non-overlapping windows."""
    moves: list[dict] = []
    hits = list(hit_times)
    for i, t in enumerate(hits):
        start = max(0.0, float(t) - window * 0.35)
        end = min(duration, float(t) + window * 0.65)
        if i + 1 < len(hits):
            next_t = float(hits[i + 1])
            end = min(end, (float(t) + next_t) / 2.0)
        if i > 0:
            prev_end = moves[-1]["end"]
            if start < prev_end:
                start = prev_end
        if end <= start + 0.12:
            end = min(duration, start + 0.25)
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
