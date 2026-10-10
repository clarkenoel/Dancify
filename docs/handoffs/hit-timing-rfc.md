# RFC: Explicit Checkpoint Timing

**Status:** Proposed — integrator approval required  
**Current frozen chart version:** `1.0`  
**Implementation in this change:** none

## Problem

The shipped chart provides `start`, `end`, and one target pose. It does not
export the snapped musical hit time or the source-video time of the selected
pose. Window clipping can make `(start + end) / 2` differ from either value.

The current web contract therefore scores the best valid comparison anywhere
inside the window. It must not infer exact timing from the midpoint.

## Proposed additive fields

```json
{
  "id": "m0",
  "start": 1.0,
  "end": 1.5,
  "hit_time": 1.25,
  "source_pose_time": 1.21,
  "keyframe_landmarks": [],
  "is_hold": false
}
```

- `hit_time`: snapped beat/half-beat checkpoint time used for musical timing.
- `source_pose_time`: video timestamp whose landmarks became the static target.
- Both values use the same zero-based reference-video timeline.
- Required invariants:
  `start <= hit_time < end`,
  `0 <= source_pose_time <= duration`, finite numbers.

## Compatibility

This requires coordinated edits to `schema/dance.schema.json.json`,
`schema/type.ts`, Python/backend semantic validators, fixtures, and frontend
runtime validation. The integrator must decide whether fields are optional in
`1.0` or require chart version `1.1`.

Until approved, no producer or consumer may depend on these fields.
