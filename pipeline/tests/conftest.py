from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))


@pytest.fixture
def valid_landmarks() -> np.ndarray:
    frame = np.zeros((33, 4), dtype=np.float64)
    frame[:, 0] = np.linspace(0.2, 0.8, 33)
    frame[:, 1] = np.linspace(0.1, 0.9, 33)
    frame[:, 2] = np.linspace(-0.1, 0.1, 33)
    frame[:, 3] = 0.95
    return frame
