from __future__ import annotations

import numpy as np

from dancify_pipeline.energy import motion_energy


def test_energy_excludes_invalid_frame_transitions(
    valid_landmarks: np.ndarray,
) -> None:
    frames = np.stack([valid_landmarks.copy() for _ in range(5)])
    for index in range(len(frames)):
        frames[index, 15, 0] += 0.05 * index
    times = np.arange(5) / 30.0
    valid = np.asarray([True, True, False, True, True])

    energy = motion_energy(frames, times, frame_valid=valid)

    assert np.isfinite(energy[0])
    assert np.isfinite(energy[1])
    assert np.isnan(energy[2])
    assert np.isnan(energy[3])
    assert np.isfinite(energy[4])
