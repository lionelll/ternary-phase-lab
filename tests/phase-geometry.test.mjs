import assert from "node:assert/strict";
import test from "node:test";

import {
  layersFor,
  invariantPointPosition,
  phaseAt,
  positionFromComposition,
  referenceTemperatureToWorld,
  surfacesFor,
  TEMPERATURE_SPAN,
  TOP_Y,
} from "../app/three/phaseGeometry.ts";
import {
  REFERENCE_CONTROL_POINTS,
  referenceLayersFor,
} from "../app/three/eutecticModels.ts";

const MODELS = ["isomorphous", "eutectic", "limited"];

test("composition analysis returns rendered phase ids except the intentionally hidden liquid phase", () => {
  for (const model of MODELS) {
    const renderedIds = new Set(layersFor(model).map((layer) => layer.id));
    for (let a = 0; a <= 100; a += 10) {
      for (let b = 0; b <= 100 - a; b += 10) {
        for (let temperature = 0; temperature <= 100; temperature += 5) {
          const result = phaseAt(model, a, b, temperature);
          assert.ok(
            renderedIds.has(result.meshId) || result.meshId === "liquid",
            `${model} returned non-rendered phase ${result.meshId}`,
          );
        }
      }
    }
  }
});

test("pure liquid bodies are hidden in all three models", () => {
  for (const model of MODELS) {
    assert.equal(
      layersFor(model).some((layer) => layer.id === "liquid"),
      false,
    );
  }
});

test("temperature axis is stretched by twenty percent without changing composition coordinates", () => {
  assert.equal(TOP_Y, 16.8);
  assert.equal(TEMPERATURE_SPAN, 18);
});

test("both eutectic models expose a finite visible ternary invariant point", () => {
  for (const model of ["eutectic", "limited"]) {
    const point = invariantPointPosition(model);
    assert.ok(point);
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
  }
  assert.equal(invariantPointPosition("isomorphous"), null);
});

test("three-phase guide lines keep shared boundaries without closed triangular ties", () => {
  for (const layer of referenceLayersFor("limited").filter((item) =>
    item.id.startsWith("limited-three-"),
  )) {
    assert.equal(layer.geometry.edgeSegments.length, 3);
  }
  for (const layer of referenceLayersFor("eutectic").filter((item) =>
    item.id.startsWith("eutectic-three-"),
  )) {
    assert.equal(layer.geometry.edgeSegments.length, 5);
    assert.deepEqual(
      layer.geometry.edgeSegments.slice(-2).map((segment) => segment.length),
      [2, 2],
    );
  }
});

test("authorized reference control points are preserved exactly", () => {
  assert.deepEqual(
    REFERENCE_CONTROL_POINTS.eutectic.binary.map((item) => [item.b, item.t]),
    [
      [[0.54, 0.46, 0], 0.42],
      [[0, 0.54, 0.46], 0.41],
      [[0.48, 0, 0.52], 0.43],
    ],
  );
  assert.deepEqual(
    [
      REFERENCE_CONTROL_POINTS.limited.ternary.b,
      REFERENCE_CONTROL_POINTS.limited.ternary.t,
    ],
    [[0.34, 0.33, 0.33], 0.32],
  );
});

test("reference regions contain finite closed mesh data", () => {
  for (const model of ["eutectic", "limited"]) {
    for (const layer of referenceLayersFor(model)) {
      assert.ok(layer.geometry.vertices.length >= 4, `${layer.id} has too few vertices`);
      assert.ok(layer.geometry.faces.length >= 4, `${layer.id} has too few faces`);

      for (const vertex of layer.geometry.vertices) {
        assert.ok(vertex.b.every(Number.isFinite));
        assert.ok(Number.isFinite(vertex.t));
        assert.ok(Math.abs(vertex.b[0] + vertex.b[1] + vertex.b[2] - 1) < 1e-9);
      }
      for (const face of layer.geometry.faces) {
        assert.ok(face.length >= 3);
        assert.ok(
          face.every(
            (index) => index >= 0 && index < layer.geometry.vertices.length,
          ),
          `${layer.id} contains an out-of-range face index`,
        );
      }
    }
  }
});

test("binary and ternary eutectic landmarks are shared by adjoining regions", () => {
  const samePoint = (first, second) =>
    Math.abs(first.t - second.t) < 1e-9 &&
    first.b.every((value, index) => Math.abs(value - second.b[index]) < 1e-9);

  for (const model of ["eutectic", "limited"]) {
    const layers = referenceLayersFor(model);
    for (const landmark of REFERENCE_CONTROL_POINTS[model].binary) {
      const owners = layers.filter((layer) =>
        layer.geometry.vertices.some((vertex) => samePoint(vertex, landmark)),
      );
      assert.ok(owners.length >= 4, `${model} binary landmark is not shared`);
    }

    const eutectic = REFERENCE_CONTROL_POINTS[model].ternary;
    const owners = layers.filter((layer) =>
      layer.geometry.vertices.some((vertex) => samePoint(vertex, eutectic)),
    );
    assert.ok(owners.length >= 7, `${model} ternary landmark is not shared`);
  }
});

test("immiscible model follows the eutectic valley and low-temperature topology", () => {
  assert.equal(phaseAt("eutectic", 100, 0, 30).meshId, "liquid-alpha");
  assert.equal(
    phaseAt("eutectic", 50, 45, 30).meshId,
    "eutectic-three-alpha-beta",
  );
  assert.equal(
    phaseAt("eutectic", 30, 40, 15).meshId,
    "eutectic-solid-three",
  );
});

test("limited model distinguishes solid solutions, two-solid and central three-solid regions", () => {
  assert.equal(phaseAt("limited", 10, 80, 10).meshId, "beta-solution");
  assert.equal(phaseAt("limited", 45, 45, 10).meshId, "alpha-beta");
  assert.equal(phaseAt("limited", 30, 40, 15).meshId, "limited-solid-three");
  assert.equal(phaseAt("limited", 70, 20, 35).meshId, "liquid-alpha");
});

test("liquidus meets each model's exact ternary eutectic point", () => {
  for (const model of ["eutectic", "limited"]) {
    const boundaries = surfacesFor(model);
    const eutectic = REFERENCE_CONTROL_POINTS[model].ternary;
    const liquidus = boundaries.liquidus(...eutectic.b);
    const invariant = referenceTemperatureToWorld(eutectic.t);
    assert.ok(
      Math.abs(liquidus - invariant) < 1e-6,
      `${model} liquidus must meet its exact E point`,
    );
    assert.ok(
      Math.abs(boundaries.solidus(...eutectic.b) - invariant) < 1e-9,
      `${model} invariant plane must pass through E`,
    );
  }
});

test("isomorphous composition topology remains unchanged", () => {
  assert.deepEqual(
    layersFor("isomorphous").map((item) => item.id),
    ["alpha-solid", "liquid-alpha"],
  );
  assert.equal(phaseAt("isomorphous", 30, 40, 50).meshId, "liquid-alpha");

  const plotted = positionFromComposition(30, 40, 50);
  assert.ok(Number.isFinite(plotted.x));
  assert.ok(Number.isFinite(plotted.y));
  assert.ok(Number.isFinite(plotted.z));
  assert.ok(plotted.y > 0);
});
