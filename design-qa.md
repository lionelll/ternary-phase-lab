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

The implementation now carries the selected direction's primary visual language: three independent opaque sculptural masses, dark physical separation seams, rounded perimeter transitions, blue/teal/copper material hierarchy, a black stage, controlled white/cyan/warm lighting, and a thin reference cage with spatial vertex nodes.

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
- Image quality and asset fidelity: the central visual is real Three.js geometry, not a raster substitute, CSS drawing, placeholder, or custom SVG. Forty-six surface segments plus eight side-wall bevel steps keep silhouettes smooth. SMAA, SSAO, PMREM lighting, shadow mapping, and polygon offset are used without visible Z-fighting in the tested state.
- Copy and content: no requested product copy was changed. The three phase-model names, teaching controls, status, visibility filters, reset action, and teaching analysis remain intact.
- Icons: existing brand asset and interface icon treatment are unchanged. Reference-cage nodes are native 3D scene geometry and support spatial reading.
- Accessibility: semantic buttons, pressed states, labelled range input, numeric inputs, checkboxes, disabled clear state, and visible focus styling remain present. No new DOM-only decoration was introduced for the 3D visual.
- Responsiveness: the existing responsive layout was not altered. A narrow browser capture from the prior baseline remains valid because this change is confined to WebGL geometry/material/camera code.

## Comparison history

### Iteration 0 — blocked, then fixed

- [P1] Default transparency made the phase bodies read as flat overlapping sheets.
- Fix: changed the default bodies to opaque depth-writing MeshPhysical materials, preserved transparent dimming only for selection states, and added calibrated clearcoat/specular response.
- Post-fix evidence: `/private/tmp/ternary-style-audit/11-option2-impl-desktop.png`.

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

final result: passed
