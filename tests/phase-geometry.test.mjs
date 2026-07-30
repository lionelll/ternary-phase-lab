import assert from "node:assert/strict";
import test from "node:test";

import {
  layersFor,
  phaseAt,
  positionFromComposition,
  surfacesFor,
} from "../app/three/phaseGeometry.ts";

const MODELS = ["isomorphous", "eutectic", "limited"];

test("every rendered phase can also be reached by composition analysis", () => {
  for (const model of MODELS) {
    const renderedIds = new Set(layersFor(model).map((layer) => layer.id));
    const detectedIds = new Set();

    for (let a = 0; a <= 100; a += 5) {
      for (let b = 0; b <= 100 - a; b += 5) {
        for (let temperature = 0; temperature <= 100; temperature += 0.5) {
          detectedIds.add(phaseAt(model, a, b, temperature).meshId);
        }
      }
    }

    assert.deepEqual(
      [...detectedIds].filter((id) => !renderedIds.has(id)),
      [],
      `${model} analysis returned a phase that is not rendered`,
    );
    assert.deepEqual(
      [...renderedIds].filter((id) => !detectedIds.has(id)),
      [],
      `${model} contains a rendered phase that analysis can never select`,
    );
  }
});

test("limited-solubility analysis distinguishes solid solution and solid two-phase regions", () => {
  assert.equal(phaseAt("limited", 30, 40, 8).meshId, "beta-solution");

  const solidTwoPhase = phaseAt("limited", 30, 40, 17);
  assert.equal(solidTwoPhase.title, "固态两相区");
  assert.equal(solidTwoPhase.meshId, "alpha-beta");
  assert.equal(solidTwoPhase.detail, "α + β");
});

test("eutectic and limited surfaces are ordered and continuous around the center", () => {
  for (const model of ["eutectic", "limited"]) {
    const boundaries = surfacesFor(model);
    const samples = [
      [1 / 3, 1 / 3, 1 / 3],
      [0.334, 0.333, 0.333],
      [0.333, 0.334, 0.333],
      [0.333, 0.333, 0.334],
      [0.8, 0.1, 0.1],
    ];

    for (const [u, v, w] of samples) {
      const solidus = boundaries.solidus(u, v, w);
      const liquidus = boundaries.liquidus(u, v, w);
      assert.ok(solidus < liquidus, `${model} solidus must stay below liquidus`);

      if (boundaries.invariantTop) {
        const invariant = boundaries.invariantTop(u, v, w);
        assert.ok(invariant > solidus);
        assert.ok(invariant < liquidus);
      }

      if (boundaries.solvus) {
        assert.ok(boundaries.solvus(u, v, w) < solidus);
      }
    }

    const centerLiquidus = boundaries.liquidus(1 / 3, 1 / 3, 1 / 3);
    const adjacentLiquidus = boundaries.liquidus(0.334, 0.333, 0.333);
    assert.ok(
      Math.abs(centerLiquidus - adjacentLiquidus) < 0.01,
      `${model} liquidus should not form a hard crease at the center`,
    );
  }
});

test("composition plotting keeps A, B, C and temperature in the same coordinate system", () => {
  const point = positionFromComposition(30, 40, 50);
  assert.ok(Number.isFinite(point.x));
  assert.ok(Number.isFinite(point.y));
  assert.ok(Number.isFinite(point.z));
  assert.ok(point.y > 0);
});
