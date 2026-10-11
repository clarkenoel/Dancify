"""Full-body target comparability, matching web/src/core/pose.ts.

Kept dependency-free for both preparation and API environments. Cross-runtime
fixtures test both copies against the actual browser scorer.
"""
from __future__ import annotations

import math

JOINTS = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
ANGLES = ((11, 13, 15), (12, 14, 16), (23, 11, 13), (24, 12, 14),
          (11, 23, 25), (12, 24, 26), (23, 25, 27), (24, 26, 28))
BONES = ((11, 13), (13, 15), (12, 14), (14, 16),
         (23, 25), (25, 27), (24, 26), (26, 28))


def scorable_pose(landmarks) -> bool:
    if len(landmarks) != 33 or any(len(p) != 4 for p in landmarks):
        return False
    pose = [[float(v) for v in p] for p in landmarks]
    if any(not math.isfinite(v) for p in pose for v in p):
        return False
    if any(not 0 <= p[3] <= 1 for p in pose):
        return False
    if any(pose[i][3] < 0.35 for i in JOINTS):
        return False
    hip = [(pose[23][i] + pose[24][i]) / 2 for i in range(3)]
    shoulder = [(pose[11][i] + pose[12][i]) / 2 for i in range(3)]
    torso = math.dist(hip, shoulder)
    if not math.isfinite(torso) or torso < 1e-6:
        return False

    def vector(a, b):
        return [pose[b][i] - pose[a][i] for i in range(3)]

    def valid_pair(a, b):
        product = math.hypot(*a) * math.hypot(*b)
        dot = sum(x * y for x, y in zip(a, b))
        return math.isfinite(product) and product >= 1e-8 and math.isfinite(dot)

    return (all(valid_pair(vector(b, a), vector(b, c)) for a, b, c in ANGLES)
            and all(valid_pair(vector(a, b), vector(a, b)) for a, b in BONES))
