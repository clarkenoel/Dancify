# Dancify design guide

Last updated: 2026-10-11. Status: first-draft visual direction; Figma is actively changing.

**Interaction update (2026-10-11):** the user removed keyboard gameplay. Camera
tracking is required for every new round. Keyboard menu/button accessibility
remains; keyboard scoring and gameplay shortcuts do not. This supersedes the
practice screens in the older Figma handoff. This is the new product direction;
the camera-only pages remain on a feature branch pending review, and the current
main application may still expose the older practice interface.

This guide records the shared visual language and rules for editing the game UI.
It is a design reference, not a claim that the redesigned screens have shipped.

## Sources and revision policy

- [Dancify Figma file](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign)
- [Foundations](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?page-id=9-273&node-id=12-237)
- [Designer handoff snapshot](https://github.com/taliyadenis/justmakeit/blob/ea39c042507fec5a8040660a9c5393ee1c530c69/docs/design/figma-handoff.md)
- [Imported handoff on the character branch](https://github.com/clarkenoel/justmakeit/blob/803192e/docs/design/figma-handoff.md), which predates the linked snapshot.
- [Gameplay integration contract](docs/handoffs/gameplay-integration-contract.md) and [current web behavior](web/README.md).

Evidence: the linked GitHub handoff was read at commit
`ea39c042507fec5a8040660a9c5393ee1c530c69`. It documents 37 states at
1440 × 900 and 1920 × 1080, plus ten component sets and 60 variants.
Direct Figma access was blocked in this environment, so the canvas, variable
bindings, and any newer edits have not been independently inspected. Values below
are documented baseline values, not measurements taken from the latest canvas.

The user's current direction is **larger buttons and more centered text, with a
game-menu feel**. This takes precedence over older, smaller menu layouts.
Exact revised button dimensions and typography sizes remain to be read from the
updated components; do not present guessed dimensions as approved Figma values.

Before implementing a screen, inspect its current Figma frame and component
variants through Figma/MCP or a designer-provided export. Record the node link,
revision/date, and intentional differences in the implementation handoff. Pin a
design snapshot for each demo milestone while the designer continues editing.
New art does not authorize changes to scoring, privacy, or gameplay contracts.

## Visual direction

Dancify is a playful roller-rink dance game: deep navy surfaces, vivid pink/aqua
accents, expressive lettering, star artwork, and hand-drawn characters.

- Give each screen one obvious main activity and one dominant next action.
- Build a clear central composition for menu choices, readiness, countdowns,
  confirmation dialogs, and results. Leave space around the important content.
- Make menu buttons substantial and readable from the player's dance position.
  Increase the clickable surface and label together; enlarging decoration alone
  does not make a control easier to use.
- Center short headings, menu labels, countdowns, judgments, and result summaries.
  Center labels both horizontally and vertically inside buttons.
- Keep filenames, song metadata, input text, longer instructions, and diagnostic
  details aligned for scanning. A centered panel may contain left-aligned text.
- Keep game screens focused. Put developer diagnostics and detailed setup
  information behind clearly named secondary controls, preserving access for tests.
- Use the artist's buttons, stars, and characters consistently. Avoid introducing
  unrelated icon packs, generic dashboard cards, stock hero layouts, or ornamental
  gradients/glass effects without a deliberate design decision.

## Color tokens

These semantic names are proposed code-facing aliases for the documented values;
they are not verified Figma variable names. Bind shared components to tokens rather
than repeating hex values in individual screens.

| Semantic role | Baseline value | Use |
| --- | --- | --- |
| Background | `#080D2B` | Full-screen navy backdrop |
| Surface | `#141B48` | Solid reading panels |
| Raised surface | `#253168` | Elevated panels and controls |
| Pink accent | `#FF00E1` | Primary treatment and header separator |
| Aqua accent | `#00E1FF` | Button geometry and field/row focus |
| Yellow / selection | `#FFE66D` | Selected states and gold accents |
| Primary text | `#F6F3FF` | Main reading text |
| Muted text | `#B9C8EB` | Secondary information |
| Line | `#7184B0` | Structural borders |
| Error | `#FFA8AE` | Error emphasis with an explanatory label |
| Blue inset | `#0D66FF` | Revised button inset geometry |

The handoff specifies a white outer button focus outline; confirm its exact token
in Figma. Focus and selection are different: white/aqua indicates keyboard focus,
gold indicates selection. Keep both legible when a selected item also has focus.
Never communicate readiness, errors, or judgments by color alone.

Use solid surfaces behind important text. Check actual text/background pairings
for contrast rather than assuming every neon combination passes: target WCAG AA
(4.5:1 normal text, 3:1 large text) and 3:1 for essential control boundaries and
focus indicators. Document and review any needed palette adjustment.

## Typography, spacing, and shape

| Role | Family | Documented baseline size (px) |
| --- | --- | --- |
| Display / game name | Bungee Inline Regular | 56 |
| Title | Bungee Inline Regular | 36 |
| Section heading | Bungee Inline Regular | 22 |
| Body | Jersey 25 Regular | 26 |
| Label | Jersey 25 Regular | 22 |
| Caption | Jersey 25 Regular | 20 |
| Score | Jersey 25 Regular | 48 |

Use **Bungee Inline**, not Bungee. Jersey 25 is the handoff family for controls,
scores, and other writing. Both are SIL OFL 1.1 fonts: bundle fonts locally with
their copyright notices and licenses. Do not depend on a remote font request
during the demo or silently substitute another font as the final design.

Treat these sizes as a snapshot while larger menu controls are being designed.
Verify line height, wrapping, letter spacing, and label size in the current frame;
they are not all specified in the handoff. Avoid synthetic font weights and
shrinking text to make a fixed-width button fit.

- Spacing scale: `0 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`.
- Radius scale: `0 / 8 / 12 / 16 / 24 / 999`.
- Use shared semantic tokens for control height, menu width, gaps, text roles,
  and corner treatment. Revised button geometry must remain consistent across
  screens; do not assume every radius is appropriate for every component.
- Let controls grow for longer labels and text zoom. Use a 44 × 44 CSS-pixel
  minimum target as a usability recommendation, not the desired size of a main
  game button; the latter should be substantially larger and reviewed at distance.

## Component contract

The component links below identify the handoff sources. Inspect the current
variants before implementing or revising them.

| Family | States / variants | Figma node |
| --- | --- | --- |
| Button | Primary / Secondary / Quiet × Default / Hover / Focus / Selected / Disabled / Loading | [12-295](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-295) |
| Field | Empty / Filled / Focus / Error / Disabled / Loading | [12-321](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-321) |
| Song row | Ready / Needs regeneration / Selected / Focus / Preparing | [12-353](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-353) |
| Progress | Queued / Processing / Succeeded / Buffering | [12-375](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-375) |
| Judgment | PERFECT / SUPER / GOOD / MISS / LOST | [12-392](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-392) |
| Wearable status | Disconnected / Connecting / Connected / Lost | [12-406](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-406) |
| Error banner | Preparation / Connection / Tracking / Pending result | [12-420](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-420) |
| Pictogram slot | Current / Next / Empty | [12-437](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=12-437) |
| Loading stars | Four frames, repeated | [33-54](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=33-54) |
| Score stars | 0–5 / Gold 5 | [33-102](https://www.figma.com/design/73KXHiJcCoHRsR5XK54kQ7/Dancify-Roller-Rink-Redesign?node-id=33-102) |

### Buttons and navigation

- Primary uses aqua/blue outlines and a pink label from
  [planning option 1](https://www.figma.com/design/FhQ2C1hoyzCYlRbMSxfl0l/planning?node-id=47-32).
- Secondary/quiet use aqua fill, a blue inset, and navy labels from
  [planning option 2](https://www.figma.com/design/FhQ2C1hoyzCYlRbMSxfl0l/planning?node-id=47-33).
- Rebuild the decorative geometry as responsive vectors or scalable styling;
  retain real text and semantic buttons. Do not use a flattened image of the
  entire button or screen as an interactive UI.
- Increase shared menu-button dimensions once, then review all states for clipped
  outlines, spinner movement, text overflow, and uneven visual weight.
- Loading must keep the control's size stable and prevent duplicate activation.
  Explain unavailable actions nearby; disabled controls must not trap navigation.
- Keyboard and rotary focus follow the visible order, keep the active choice in
  view, and never require hover. Enter/select activates the focused menu action.
  Preserve native field editing without adding gameplay-specific key bindings.
- Dialogs need a visible title, contained focus, Escape/cancel, and focus restoration.
  Give confirmation and cancellation distinct, readable choices.

The handoff positions the Main menu control 32 px from the right edge and a 3 px
pink separator beneath the header. These are baseline desktop details, not a
reason to prevent centered main content or force overflow on smaller windows.
Review their placement against the latest larger-button revision.

### Stars and motion

- Loading: `star1.png → star2.png → star3.png → star4.png`, 300 ms each,
  repeating over 1.2 seconds. Reduced motion shows static `star1` plus a text status.
- Ratings: earned positions 1–4 use `star2`, fifth uses `star3`; unearned positions
  are dimmed. Gold 5 uses `star4` with a separate gold center overlay.
- Rating thresholds and eligibility for Gold 5 are **not specified** by this
  design. Do not invent them or display sample stars as a real earned result.
- Decorative bottom-right stars fade from 42% to 3.5% opacity outward and occupy
  less space during play. Hide decoration from assistive technology and pointer
  input; announce a real rating numerically when a rating rule exists.
- Export the original star artwork from Figma; references in a document are not
  asset files. Preserve source files and record export revision and crop bounds.
- Keep animation modest, respect reduced motion, and avoid flashing or movement
  that competes with the dancer. Decorative loading loops may use CSS animation;
  beat/gameplay animation must derive from the existing video clock.

## Characters and video composition

Use the existing articulated renderer and the artist's original Human/Lenny
parts. [Palette JSON](https://github.com/clarkenoel/justmakeit/blob/803192e/web/src/pictograms/palette.json) is the implementation source
for baked character colors; [integration notes](https://github.com/clarkenoel/justmakeit/blob/803192e/docs/handoffs/pictogram-integration.md)
describe the rig, regeneration, and fallback behavior.

| Character | Approved treatment |
| --- | --- |
| Lenny | Green `#69A958`, shade `#4E8B49`, dark outline `#1D2E27`, cream `#F5F0C5` / `#E7DBA2`, brown eyes `#704735` |
| Human | Blue `#438FDC`, shade `#3374BD`, dark outline `#182D49`; retain the gold chest star |

The Lenny palette also records stem/flower colors for future artwork. Their
presence does not mean the current rig includes those parts. Keep originals
unchanged and regenerate runtime derivatives with the documented bake workflow.
Do not recolor characters by applying the UI accent palette indiscriminately.

Keep current/next targets readable with clear labels. Preserve skeleton fallback
when art fails and the diagnostic skeleton toggle. Artwork changes must not alter
target coordinates, joint pivots, score inputs, or timing.

The handoff uses 16:9 video viewports. Contain and letterbox portrait or other
source ratios; never stretch or crop away the dancer to fill a decorative frame.
Webcam overlays must share the displayed video's scaling, offsets, and mirroring.
Keep the side-by-side reference/camera testing view available. Use layout changes
that preserve the mounted video, camera stream, and current round.

## State and behavior boundaries

- Initial camera demo and Play again wait for stable full-body tracking, then
  run the existing 3–2–1 countdown. Results never trigger an automatic replay.
- Deliberate pause, tracking/camera loss, backgrounding, and controller recovery
  retain the existing explicit readiness/recovery behavior. A visual transition
  must not silently resume playback or accept stale scoring samples.
- The reference video's `currentTime` remains the only gameplay clock. Static
  checkpoint windows are not exact-hit timestamps or hold animations.
- LOST/insufficient tracking is distinct from MISS. Never decorate missing data
  as a perfect result or change comparison semantics for a visual effect.
- Show the completed score as soon as the round ends. Saving history happens in
  the background; it never gates results, replay, another song, or main menu.
- All new rounds use camera scoring. A camera error offers retry or menu exit,
  not keyboard scoring. The controller remains optional.
- Use real preparation stages and errors; do not fabricate progress percentages,
  songs, results, ratings, or a connected-controller state for the demo.
- The handoff is older than some runtime features. Readiness and implemented BLE
  transport are governed by current web code/docs, not stale prototype copy.
- Session identity/multi-person pairing remains planned. Do not present a
  functioning player-lock confirmation until that feature exists and is tested.
- Keep all camera processing local and preserve the existing frozen interfaces.

## Responsive layout and accessibility

Treat the two supplied desktop sizes as reference compositions, not fixed-size
screenshots to scale wholesale. Use responsive layout, a bounded content width,
and consistent gutters. Stack secondary content when space is insufficient;
preserve video aspect ratios and the visibility of countdown, targets, and actions.

Check smaller laptop windows, browser zoom, long song names, and multiple lines
of error text. Allow scrolling where needed; menus and dialogs must not lose
their bottom buttons. Decorative artwork must not cover controls or body guidance.

Use semantic headings, associated input labels, real buttons, visible focus, and
meaningful accessible names. Announce significant status changes without reading
every video frame or every score tick. Test reduced motion, font-load failure,
keyboard-only navigation, and selection without a mouse.

## Editing workflow and review gate

1. Identify the screen, state, component, and Figma node being changed. Read the
   latest design and note whether the change is visual or changes behavior.
2. Update shared tokens/components first. Keep styles out of scoring, tracking,
   API, and input controllers. Preserve stable component identity during play.
3. Export required assets with predictable names, transparency, source provenance,
   and applicable licenses. Bundle only the assets/fonts actually used.
4. Check every affected variant, including hover/focus, selected, disabled,
   loading, empty, error, and long-content states. Update this guide when a shared
   choice changes; record deliberate differences from the snapshot.
5. Compare screenshots at both design sizes and a smaller laptop viewport. Review
   the real game at the distance a dancer will stand, especially button labels,
   readiness guidance, countdowns, score, and current/next targets.
6. For UI code changes, run `npm test` and `npm run build` in `web`, plus relevant
   browser tests. For screen/navigation integration, run the complete browser
   integration flow described in [web/README.md](web/README.md), including replay,
   song changes, camera loss, menu keyboard accessibility, and asset-load failure.
7. Keep changes on the feature branch and present screenshots, test outcomes,
   and unresolved design decisions for review before merging.

Open design items: final enlarged button geometry and label sizes; exact text
alignment per revised frame; current exported fonts/star assets; and a separate
product decision for star-rating thresholds. These should stay explicit while
the first-draft demo is assembled.
