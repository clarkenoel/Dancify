import type { LandmarkTuple, Move } from '../core/types';

/** Explicit diagnostic fixtures, never loaded into gameplay or scored. */
export function reviewPoses(): Move[] {
  const neutral = Array.from({ length: 33 }, () => [0, 0, 0, 0] as LandmarkTuple);
  for (const [i, x, y] of [[12, -.4, -1], [14, -.5, -.4], [16, -.5, .2], [11, .4, -1], [13, .5, -.4], [15, .5, .2],
    [24, -.25, 0], [26, -.25, .8], [28, -.25, 1.6], [23, .25, 0], [25, .25, .8], [27, .25, 1.6]]) neutral[i] = [x, y, 0, 1];
  const t = structuredClone(neutral);
  t[14] = [-1, -1, 0, 1]; t[16] = [-1.6, -1, 0, 1]; t[13] = [1, -1, 0, 1]; t[15] = [1.6, -1, 0, 1];
  const raised = structuredClone(neutral);
  raised[14] = [-.6, -1.6, 0, 1]; raised[16] = [-.4, -2.2, 0, 1];
  const crossed = structuredClone(neutral);
  crossed[14] = [-.4, -.5, 0, 1]; crossed[16] = [.5, -.8, 0, 1];
  crossed[13] = [.4, -.5, 0, 1]; crossed[15] = [-.5, -.8, 0, 1];
  const bent = structuredClone(neutral);
  bent[26] = [-.9, .4, 0, 1]; bent[28] = [-.4, .9, 0, 1];
  return [neutral, t, raised, crossed, bent].map((pose, i) => ({
    id: ['neutral', 't-pose', 'anatomical-right-arm-raised', 'crossed-arms', 'bent-knee'][i],
    start: i, end: i + .5, keyframe_landmarks: pose, is_hold: false,
  }));
}
