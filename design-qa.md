# Design QA — 方案 2 实体分层雕塑

## Comparison target

- Source visual truth: `/Users/lionel/.codex/generated_images/019f99d9-149a-7373-b178-46d5354ddfe0/exec-35ecf284-d72e-45e9-bf84-6bb70d04a8e9.png`
- Final implementation screenshot: `/private/tmp/ternary-style-audit/21-option2-final-design.png`
- Full-view comparison: `/private/tmp/ternary-style-audit/22-option2-final-comparison.png`
- Focused central-scene comparison: `/private/tmp/ternary-style-audit/23-option2-final-central-comparison.png`
- Viewport: `1320 x 642` CSS px, device scale factor `1`.
- Source pixels: `1798 x 875`, normalized to `1320 x 642` with aspect ratio preserved.
- Implementation pixels: `1320 x 642` at `1x`; no implementation scaling was applied.
- State: 三元匀晶相图, temperature `100%`, all phase categories visible, explosion off, no selected phase or composition point.
- Scope: only the ternary-phase repository. The crystal-structure repository remained read-only.

## Full-view comparison evidence

The normalized source and browser-rendered implementation were placed side by side in the same comparison image. The surrounding header, three-column layout, panel hierarchy, copy, selection state, dark surfaces, and spacing remain consistent because this iteration intentionally changes only the central WebGL scene.

The implementation now carries the selected direction's primary visual language while following the PRD teaching requirement: independent translucent sculptural masses, bright solid phase boundaries, rounded perimeter transitions, blue/teal/copper material hierarchy, a black stage, controlled white/cyan/warm lighting, and a thin reference cage with spatial vertex nodes.

## Focused region comparison evidence

The central `644 x 512` CSS-pixel viewport was cropped from both normalized images and placed side by side. This focused comparison verifies body scale, three-quarter camera angle, layer separation, material response, cage clarity, black negative space, axis labels, legend, and interaction hints.

The source mock exaggerates the liquidus silhouette into a deeper front-edge curve. The implementation intentionally keeps the existing textbook `LayerSpec` surface functions and phase topology, so that silhouette remains scientifically derived rather than copied from the generative mock. This is an accepted product constraint, not an outstanding fidelity defect.

## Findings

- No actionable P0/P1/P2 findings remain.
- [P3] The source mock has softer, more product-render-like continuous highlight gradients across the large blue face.
  - Location: central 3D viewport, liquid body.
  - Evidence: the source uses a broad photographic highlight; the implementation derives lighting from real-time surface normals and the unchanged scientific mesh.
  - Impact: minor polish difference; volume and material hierarchy remain clear.
  - Follow-up: if desired, add a restrained area-light pass after stakeholder review without changing geometry or topology.
- [P3] The generated source shows a more deeply curved liquidus front silhouette.
  - Location: liquid/two-phase interface.
  - Evidence: visible in the focused comparison.
  - Impact: accepted because changing it would contradict the requirement to retain the existing scientific surface formula.

## Required fidelity surfaces

- Fonts and typography: unchanged from the approved existing page. Family, Chinese fallbacks, hierarchy, weight, wrapping, and small-label density remain stable.
- Spacing and layout rhythm: header, rails, central viewport, panel gaps, radii, borders, and overlay placement are unchanged. The new camera gives the sculpture balanced negative space without colliding with the title, labels, legend, or hints.
- Colors and visual tokens: solid bodies use calibrated dark cobalt, teal, and copper; near-black stage and pale-blue cage match the selected direction. Broad neon bloom and decorative fog are absent.
- Image quality and asset fidelity: the central visual is real Three.js geometry, not a raster substitute, CSS drawing, placeholder, or custom SVG. Forty-six surface segments plus eight side-wall bevel steps keep silhouettes smooth. MeshPhong materials, SMAA/SSAO high-quality passes, adaptive shadow mapping, and polygon offset are used without visible Z-fighting in the tested state.
- Copy and content: no requested product copy was changed. The three phase-model names, teaching controls, status, visibility filters, reset action, and teaching analysis remain intact.
- Icons: existing brand asset and interface icon treatment are unchanged. Reference-cage nodes are native 3D scene geometry and support spatial reading.
- Accessibility: semantic buttons, pressed states, labelled range input, numeric inputs, checkboxes, disabled clear state, and visible focus styling remain present. No new DOM-only decoration was introduced for the 3D visual.
- Responsiveness: the existing responsive layout was not altered. A narrow browser capture from the prior baseline remains valid because this change is confined to WebGL geometry/material/camera code.

## Comparison history

### Iteration 0 — superseded by PRD P0 correction

- [P1] Default transparency made the phase bodies read as flat overlapping sheets.
- Earlier visual-only fix: changed the bodies to opaque MeshPhysical materials.
- Final PRD decision: restored `0.32` default transparency, `0.85` selected opacity and `0.05` dimming, strengthened solid phase boundaries, and switched to cheaper MeshPhong materials so internal phase interfaces remain teachable without returning to a flat-sheet appearance.

### Iteration 1 — blocked, then fixed

- [P2] The initial reframing overfilled the viewport vertically and clipped the lower prism corner.
- Fix: introduced a visual temperature-axis scale, adjusted the camera target and field of view, and retained the scientific phase calculations in their original coordinate space.
- Post-fix evidence: `/private/tmp/ternary-style-audit/13-option2-impl-proportions.png`.

### Iteration 2 — blocked, then fixed

- [P2] Large side walls still looked planar and lacked the rounded capsule character of the selected mock.
- Fix: rebuilt each triangular boundary wall with eight vertical bevel steps, a restrained outward bulge, shared smooth normals, physical seams, and soft inter-layer shadowing.
- Post-fix evidence: `/private/tmp/ternary-style-audit/18-option2-rounded-bodies.png`.

### Iteration 3 — passed

- Refined teal/copper material balance and added subtle cage vertex nodes.
- Final evidence: `/private/tmp/ternary-style-audit/21-option2-final-design.png` and `/private/tmp/ternary-style-audit/23-option2-final-central-comparison.png`.
- No actionable P0/P1/P2 differences remain after applying the scientific-formula constraint.

## Interaction verification

- Three phase-model switches: passed; both eutectic models rebuilt and updated their headings.
- Temperature slice control: native range value was exercised; the WebGL clipping/slice path remains wired to React state. Browser automation could not reliably dispatch the range input event, so the exact 50% visual state was not used as fidelity evidence.
- Explosion/recovery: passed; OFF/ON state changed and reset restored the combined model.
- Composition analysis: passed with A `25`, B `35`, temperature `60`; phase analysis appeared and clear removed it.
- Category filtering: passed; the two-phase checkbox hid and restored its category.
- Phase picking/highlight: passed; clicking the liquid body updated current status to `液相区`.
- Orbit rotation and wheel zoom: passed. Right-button pan remains the unchanged OrbitControls mapping and was not directly automatable with the available drag API.
- Reset: passed; temperature returned to `100`, explosion turned off, all filters restored, analysis cleared, and the camera returned to the default sculpture view.
- Browser console after final reload: no errors or warnings.
- Static production build: passed using the bundled Node runtime.
- Targeted ESLint for the changed Three.js files: `0` errors and `0` warnings.
- Repository-wide lint baseline: still scans generated `static-dist`/framework output and reports pre-existing generated-code findings; no new source-code error was introduced.

## Follow-up polish

- Optional P3: introduce one low-intensity rectangular key light for a broader face highlight after stakeholder review.
- Optional P3: automate native range dragging in a browser surface that exposes a reliable pointer-drag event for range inputs.

Previous final result: passed

---

# Design QA — 2026-07-30 晶体结构界面精确对齐

## Comparison target

- Primary source visual truth: `/Users/lionel/Desktop/04.项目合集/00-材料/材科基晶体结构部分/交付文档/晶体结构页面_1920x1080_100pct.png`.
- Source code truth: crystal-structure `dev@5bbf2f6`, `src/App.tsx`, `src/styles.css`, `src/components/Icons.tsx`, and `src/assets/brand-logo.png` (read-only).
- Implementation screenshot: `/private/tmp/ternary-crystal-match-1920x1080-pass1.png`.
- Viewport: `1920 x 1080` CSS px, device scale factor `1`.
- Source pixels: `1920 x 1080`; implementation pixels: `1920 x 1080`; no density normalization was required.
- State: desktop default, 三元匀晶相图, temperature `100%`, all categories visible, explosion off, no selected phase or composition point.

## Full-view comparison evidence

The crystal reference and ternary implementation were opened together at equal `1920 x 1080` dimensions. The page shell, 10px outer margin, 96px header track, 12px section gap, header border/radius/background, left and central column starts, central-title baseline, logo visual scale, type hierarchy, and panel rhythm align with the source system. App-specific content and the 3D models remain intentionally different.

## Focused region comparison evidence

Browser-computed desktop measurements were checked against the source CSS:

- Header: `1900 x 96`, `12px 24px` padding, `28px` grid gap.
- Primary logo container: `54 x 54`; rendered transform: `scale(1.55)`; visual bounds: `83.7 x 83.7`.
- Brand-to-copy layout gap: `14px`; Chinese title: `25px / 1.1`; subtitle: `13px` with `7px` top margin.
- Top reset action: `132 x 48`, `15px` horizontal padding, `10px` inner gap, `16px / 700`; icon: `28 x 28`.
- Central title: `68px` high with `0 26px` padding and `13px` gap.
- Central logo container: `34 x 34`; rendered transform: `scale(1.45)`; visual bounds: `49.3 x 49.3`.
- Central title: `18px / 800`.

These values match the crystal-structure source rules exactly. The embedded ternary logo decodes to SHA-256 `8162c77c7aa359c58270d476cfb494170ddf51fade61f27dcb267ff2484fe588`, identical to the crystal source asset.

## Implemented changes

- Replaced approximate enlarged boxes with the crystal page's exact container-plus-transform technique for both logos.
- Reproduced the crystal header grid, spacing, colors, typography, responsive rules, button dimensions, and hover state.
- Reused the crystal page's exact home icon path in a ternary-owned icon component.
- Removed all English subtitles beneath the three phase-diagram titles.
- Removed the right-rail “重置视角与状态” panel.
- Kept the top action as “重置视角”; it now resets camera plus the coupled teaching state (explosion, clipping, probe/highlight and visibility) so React and Three.js cannot diverge.

## Required fidelity surfaces

- Fonts and typography: family, fallbacks, weights, sizes, line heights, ellipsis behavior, and subtitle rhythm match the source CSS.
- Spacing and layout rhythm: header grid, logo boxes, transform overflow, gaps, title padding, section gaps, radii, and borders match the source measurements.
- Colors and visual tokens: shell gradients, header surface, line colors, text colors, and reset-action hover treatment match the crystal source.
- Image quality and asset fidelity: the same `295 x 295` RGBA PNG is used with an identical SHA-256; no replacement or approximation is present.
- Copy and content: app-specific Chinese titles remain; English model subtitles and “重置视角与状态” are absent; top “重置视角” is present.

## Verification

- Static production build: passed under Node `24.18.1`.
- Phase geometry tests: `5/5` passed, including composition-aware three-phase labels.
- Targeted source ESLint: passed with `0` errors.
- Reset action: exactly one accessible “重置视角” button; click completed successfully.
- Browser console after reload and reset click: no errors or warnings.

## Findings

- No actionable P0/P1/P2 fidelity findings remain for the requested header, logo spacing, central model title, and reset-action scope.
- [P3] The ternary header has one action while the crystal source has three, so the empty header space is intentionally larger; this reflects requested product scope rather than styling drift.

## Comparison history

- Iteration 0: approximate `64px` and `48px` logo boxes left the visible logo-to-copy spacing too large; browser comparison was unavailable.
- Iteration 1: replaced the approximations with source-exact `54px × 1.55` and `34px × 1.45` layouts, copied the source header grid/button/icon rules, captured at `1920 x 1080`, and verified computed geometry and interaction.

final result: passed
