# Dance pictogram assets and joint rig

The 23 transparent source PNGs are now accompanied by an articulated Canvas renderer and calibrated rotation pivots. Source artwork and filenames remain unchanged.

## Files

- `rig.json`: per-character hierarchy, source-pixel and normalized pivots, parent attachments, runtime clip regions, and alternative sprites.
- `rig.mjs`: dependency-free renderer and forward-kinematics functions.
- `rig.test.mjs`: attachment, independent-side, alternative, normalization, and loading-error tests.
- `human/` and `lenny/`: original 3464 × 3464 RGBA PNG exports.

Each source layer is a 300 × 300 image-filled Figma rectangle backed by a 3464 × 3464 source image. Exports used PNG with `contentsOnly: true`, `useAbsoluteBounds: true`, and an output-width constraint of 3464 pixels. No collection frame or asset page was exported.

## Coordinates and calibration

The full PNG canvas has its origin at the upper left, x increasing rightward and y downward. The layer center remains **(1732, 1732)**, or **(0.5, 0.5)** normalized. The rig rotates sprites around the anatomical attachment pivots below, rather than around that geometric center.

These pivots are newly authored from the artwork. Figma did not provide existing anatomical joints. Neutral assemblies were visually inspected and the hierarchy was tested mathematically. Artist review of motion aesthetics is still recommended; the demo lets you edit and download calibrated coordinates.

Left and right are **viewer-relative** to the source image. They are not MediaPipe's anatomical left/right labels. An eventual pose-tracking adapter must map that convention explicitly, including any webcam mirroring.

## Selection links and authored sprite pivots

Pixel coordinates refer to the untrimmed 3464 × 3464 PNG. Paired drawings have one pivot per side. The renderer clips each side at runtime, preserving the originals.

| File / Figma selection | Sprite rotation pivot(s), source pixels |
|---|---|
| [`human_arms 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-2) | leftUpperArm: (1490, 790); rightUpperArm: (1970, 790) |
| [`human_body 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-3) | body: (1732, 1920) |
| [`human_face 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-4) | head: (1732, 730) |
| [`human_feet 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-5) | leftFoot: (1550, 3030); rightFoot: (1900, 3030) |
| [`human_fists 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-6) | leftHand: (1260, 1810); rightHand: (2210, 1810) |
| [`human_hands 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-7) | leftHand: (1260, 1810); rightHand: (2210, 1810) |
| [`human_knees 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-8) | leftUpperLeg: (1550, 1920); rightUpperLeg: (1900, 1920) |
| [`human_lowerarms 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-9) | leftForearm: (1260, 1440); rightForearm: (2210, 1440) |
| [`human_lowerlegs 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-10) | leftLowerLeg: (1550, 2440); rightLowerLeg: (1900, 2440) |
| [`human_pointed 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-11) | leftHand: (1260, 1810); rightHand: (2210, 1810) |
| [`lenny_arms 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-12) | leftForearm: (1160, 2160); rightForearm: (2220, 2160) |
| [`lenny_back 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-13) | body: (1680, 2780) |
| [`lenny_body 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-24) | body: (1680, 2780) |
| [`lenny_face 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-14) | head: (1680, 1830) |
| [`lenny_feet 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-15) | leftFoot: (1170, 3220); rightFoot: (2220, 3220) |
| [`lenny_fists 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-16) | leftHand: (650, 2280); rightHand: (2700, 2280) |
| [`lenny_hands 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-17) | leftHand: (650, 2280); rightHand: (2700, 2280) |
| [`lenny_knees 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-18) | leftUpperLeg: (1490, 2720); rightUpperLeg: (1870, 2720) |
| [`lenny_lowerlegs 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-19) | leftLowerLeg: (1290, 2990); rightLowerLeg: (2110, 2990) |
| [`lenny_point 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-20) | leftHand: (650, 2280); rightHand: (2700, 2280) |
| [`lenny_sideface 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-21) | head: (1680, 1620) |
| [`lenny_sideprofile 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-22) | body: (1680, 2780) |
| [`lenny_upperarm 1.png`](https://www.figma.com/design/NpYrJzwvI4CBLv3ogzDW5g/Dance-Pictogram-Assets?node-id=5-23) | leftUpperArm: (1470, 1755); rightUpperArm: (1910, 1755) |

Every table coordinate also appears as `pivotNormalized: [x / 3464, y / 3464]` in `rig.json`. `attachment` is a separate point in the **parent sprite's** coordinates: it places the child's pivot on the parent joint. Those two points may differ because the drawings were originally laid out with different offsets.

## Joint hierarchy

For each character, `body` is the root. `head` rotates at the neck. Each side has:

```text
body → UpperArm → Forearm → Hand
body → UpperLeg → LowerLeg → Foot
```

Human `human_knees` and Lenny `lenny_knees` provide the upper-leg drawings. Human `human_arms` provides upper arms and `human_lowerarms` provides forearms. Lenny `lenny_upperarm` provides upper arms and `lenny_arms` provides forearms.

Angles are local radians, with positive values clockwise in the Canvas coordinate system. Child rotations add to parent rotations. Rotating a shoulder therefore moves the elbow, wrist, and hand while preserving attachment; an elbow rotation moves its forearm and hand.

## Alternatives

| Slot | Choice | Actual filename |
|---|---|---|
| Human hand | `open` | `human_hands 1.png` |
| Human hand | `fist` | `human_fists 1.png` |
| Human hand | `point` | `human_pointed 1.png` |
| Lenny hand | `open` | `lenny_hands 1.png` |
| Lenny hand | `fist` | `lenny_fists 1.png` |
| Lenny hand | `point` | `lenny_point 1.png` |
| Lenny head | `front` / `side` | `lenny_face 1.png` / `lenny_sideface 1.png` |
| Lenny torso | `front` / `side` / `back` | `lenny_body 1.png` / `lenny_sideprofile 1.png` / `lenny_back 1.png` |

The requested `human_fist` name corresponds to the existing plural `human_fists`; `lenny_pointed` corresponds to the existing `lenny_point`. The manifest records these naming aliases; no PNG has been renamed. Call the renderer with the slot choices shown above rather than the alias names.

Each hand can choose its alternative independently. A side-profile Lenny uses both `body: 'side'` and `head: 'side'`. The renderer displays only the selected alternative in each slot. The demo pairs the two profile choices for convenience and leaves hand choices unchanged. The back choice replaces the torso only; there is no exported back-of-head asset.

## Implement the five assembly steps

1. **Assemble a neutral character.** Use `drawRig` with all local angles zero. The authored parent attachments align the full-canvas sprites without trimming transparent margins.
2. **Mark the joints.** Set `showJoints: true`. Use the gameplay demo's joint selector and source-pixel pivot editor to review each shoulder, elbow, wrist, hip, knee, ankle, and neck.
3. **Store pivots.** `rig.json` contains the calibrated source-pixel coordinates, normalized coordinates, and parent attachment points. Download edited calibration from the demo and replace the manifest after review. Changing a sprite pivot changes its registration; changing the position of a parent joint requires editing the child's `attachment` too.
4. **Build the hierarchy.** `poseRig` resolves parents before children, transforming each attachment into its world joint. Paired limbs are isolated with runtime clipping, so the two sides rotate independently.
5. **Rotate at the attachment.** `drawRig` transforms each selected sprite as `translate(worldJoint) → rotate(accumulatedAngle) → scale → translate(-spritePivot)`. Its children use the resulting transform to remain attached.

Human runtime regions exclude the distant stray mark in the knees source. The Lenny side-face region excludes a distant stray mark. This affects runtime drawing only; the source PNGs retain every original mark.

## Use from Canvas

Serve the repository over HTTP and import the module from your application:

```js
import {drawRig, loadRigImages} from './assets/pictograms/rig.mjs';

const rigURL = new URL('./assets/pictograms/rig.json', location.href);
const rig = await (await fetch(rigURL)).json();
const images = await loadRigImages(rig, new URL('./', rigURL));

drawRig(ctx, rig, images, 'lenny', {
  origin: [320, 400], // Root hip-center position on the destination canvas
  scale: 0.12,       // Source pixels to destination pixels
  angles: {leftUpperArm: Math.PI / 4, leftForearm: -Math.PI / 3},
  variants: {body: 'side', head: 'side', leftHand: 'point', rightHand: 'fist'},
  showJoints: true,
});
```

`poseRig` also returns the joint positions and sprite-to-canvas matrices without drawing. Clear or composite the destination canvas in your caller. The renderer preserves the caller's context transform and never supplies its own animation clock. Live gameplay must continue to use the reference video's `currentTime` as the master clock.

## Gameplay example and verification

See [the interactive gameplay example](../../docs/design/gameplay-example.html) and [its README](../../docs/design/README.md).

Run the invariant tests from the repository root:

```sh
node --test assets/pictograms/rig.test.mjs
```

This implementation adds a reusable asset renderer and a documentation demo. It does not yet connect the renderer to `web/src/components/GamePanel.tsx`, webcam tracking, or scoring.

## Publication

The asset branch `feat/codex-pictogram-assets` in `taliyadenis/justmakeit` is based on synced upstream `main` at `d31e9bb03649a0a53921f49e9c448daf2d51d9b2`. It contains only the PNGs, rig manifest, renderer, tests, and gameplay documentation under `assets/pictograms/` and `docs/design/`. The same files were also prepared in a local clone of `feat/codex-web-game-core`; that shared upstream branch is not modified by this publication.
