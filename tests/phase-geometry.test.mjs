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
  assert.equal(phaseAt("limited", 30, 40, 15).meshId, "beta-solution");

  const solidTwoPhase = phaseAt("limited", 30, 40, 30);
  assert.equal(solidTwoPhase.title, "α + β 固态两相区 (α + β)");
  assert.equal(solidTwoPhase.meshId, "alpha-beta");
  assert.equal(solidTwoPhase.detail, "α + β");
});

test("three-phase labels name the solid pair of the composition's own sub-triangle", () => {
  // 取样温度按 TEMPERATURE_SPAN=15 的量程选取（滑块百分比，不是物理高度）。
  const alphaBeta = phaseAt("eutectic", 0, 100, 29.75);
  const betaGamma = phaseAt("eutectic", 0, 0, 29.75);
  const gammaAlpha = phaseAt("eutectic", 5, 0, 29.75);

  assert.equal(alphaBeta.detail, "Liquid + α + β");
  assert.equal(alphaBeta.meshId, "eutectic-three-alpha-beta");
  assert.equal(betaGamma.detail, "Liquid + β + γ");
  assert.equal(betaGamma.meshId, "eutectic-three-beta-gamma");
  assert.equal(gammaAlpha.detail, "Liquid + γ + α");
  assert.equal(gammaAlpha.meshId, "eutectic-three-gamma-alpha");
});

test("cooling one composition never swaps a solid component in or out", () => {
  const solids = (detail) => new Set(detail.match(/[αβγ]/g) ?? []);

  for (const model of MODELS) {
    for (let a = 0; a <= 100; a += 5) {
      for (let b = 0; b <= 100 - a; b += 5) {
        let previous = null;

        for (let temperature = 100; temperature >= 0; temperature -= 0.5) {
          const current = phaseAt(model, a, b, temperature);
          const currentSolids = solids(current.detail);

          if (previous) {
            // 降温只允许固相组元增加（析出）或减少（溶解），不允许换成另一种组元。
            const appeared = [...currentSolids].filter((s) => !previous.solids.has(s));
            const vanished = [...previous.solids].filter((s) => !currentSolids.has(s));
            assert.ok(
              appeared.length === 0 || vanished.length === 0,
              `${model} A=${a} B=${b}: ${previous.title} (${previous.detail}) → ` +
                `${current.title} (${current.detail}) 同时换掉了 ${vanished} 并引入了 ${appeared}`,
            );
          }

          previous = { solids: currentSolids, title: current.title, detail: current.detail };
        }
      }
    }
  }
});

test("eutectic and limited surfaces stay ordered, and meet exactly at the ternary eutectic point", () => {
  for (const model of ["eutectic", "limited"]) {
    const boundaries = surfacesFor(model);

    // 形心即三元共晶点 E：液相面、固相面（水平反应面）在此重合，这是不变点的定义，
    // 所以这里只能要求「不小于」，不能要求严格大于。
    const center = [1 / 3, 1 / 3, 1 / 3];
    assert.ok(
      Math.abs(boundaries.liquidus(...center) - boundaries.solidus(...center)) < 1e-9,
      `${model} 的液相面应在形心处正好落到三相水平反应面（三元共晶点 E）`,
    );

    // 离开 E 之后液相面必须严格高于反应面。
    for (const [u, v, w] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0],
      [0.8, 0.1, 0.1],
    ]) {
      const solidus = boundaries.solidus(u, v, w);
      const liquidus = boundaries.liquidus(u, v, w);
      assert.ok(liquidus > solidus, `${model} 在 ${u}/${v}/${w} 处液相面应高于反应面`);

      if (boundaries.invariantTop) {
        const invariant = boundaries.invariantTop(u, v, w);
        assert.ok(invariant > solidus && invariant < liquidus);
      }
      if (boundaries.solvus) {
        assert.ok(boundaries.solvus(u, v, w) < solidus);
      }
    }

    // 三相水平反应面必须是真正的水平面（整个三角形同一高度）。
    const levels = [
      boundaries.solidus(1, 0, 0),
      boundaries.solidus(0, 1, 0),
      boundaries.solidus(0.2, 0.5, 0.3),
      boundaries.solidus(...center),
    ];
    assert.ok(
      Math.max(...levels) - Math.min(...levels) < 1e-9,
      `${model} 的三相反应面应是水平面`,
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
