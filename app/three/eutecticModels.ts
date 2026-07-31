export type ReferenceModelKey = "eutectic" | "limited";
export type ReferencePhaseCategory = "single" | "two" | "three";
export type ReferenceExplodeDirection = "up" | "down" | "center";

export type BarycentricPoint4 = {
  b: readonly [number, number, number];
  t: number;
};

export type CurveSpec = {
  start: BarycentricPoint4;
  control: BarycentricPoint4;
  end: BarycentricPoint4;
  segments: number;
};

export type RegionGeometrySpec = {
  vertices: readonly BarycentricPoint4[];
  faces: readonly (readonly number[])[];
  edgeSegments?: readonly (readonly BarycentricPoint4[])[];
};

export type ReferenceLayerSpec = {
  id: string;
  name: string;
  category: ReferencePhaseCategory;
  color: number;
  explode: ReferenceExplodeDirection;
  geometry: RegionGeometrySpec;
};

type MutableGeometry = {
  vertices: BarycentricPoint4[];
  faces: number[][];
  edgeSegments?: BarycentricPoint4[][];
};

type SurfacePatch = {
  vertices: BarycentricPoint4[];
  faces: number[][];
  startRadial: BarycentricPoint4[];
  endRadial: BarycentricPoint4[];
};

type RuledGeometry = MutableGeometry & {
  upperPatch: SurfacePatch;
};

export const REFERENCE_LOW_T = 0.04;
export const REFERENCE_AXIS_TOP_T = 1.02;

const PHASE_COLORS = {
  liquid: 0x1e3a8a,
  solid: 0xd97706,
  solidBright: 0xea8a0a,
  solidDark: 0xb45f05,
  two: 0x14b8a6,
  twoBright: 0x2dd4bf,
  twoDark: 0x0d9488,
  three: 0xf43f5e,
  threeAlt: 0xe83f78,
  threeAlt2: 0xd946a8,
} as const;

function point(values: readonly number[], t: number): BarycentricPoint4 {
  const sum = values[0] + values[1] + values[2];
  const divisor = Math.abs(sum) < 1e-9 ? 1 : sum;
  return {
    b: [values[0] / divisor, values[1] / divisor, values[2] / divisor],
    t,
  };
}

function mixPoint(
  first: BarycentricPoint4,
  second: BarycentricPoint4,
  amount: number,
): BarycentricPoint4 {
  return point(
    first.b.map((value, index) => value + (second.b[index] - value) * amount),
    first.t + (second.t - first.t) * amount,
  );
}

export function sampleCurve(spec: CurveSpec): BarycentricPoint4[] {
  const samples: BarycentricPoint4[] = [];
  for (let index = 0; index <= spec.segments; index += 1) {
    const amount = index / spec.segments;
    const inverse = 1 - amount;
    samples.push(
      point(
        [0, 1, 2].map(
          (axis) =>
            spec.start.b[axis] * inverse * inverse +
            spec.control.b[axis] * 2 * inverse * amount +
            spec.end.b[axis] * amount * amount,
        ),
        spec.start.t * inverse * inverse +
          spec.control.t * 2 * inverse * amount +
          spec.end.t * amount * amount,
      ),
    );
  }
  return samples;
}

function joinCurves(...curves: readonly BarycentricPoint4[][]) {
  const joined: BarycentricPoint4[] = [];
  for (const curve of curves) {
    for (const current of curve) {
      const previous = joined[joined.length - 1];
      if (
        previous &&
        Math.abs(previous.t - current.t) < 1e-9 &&
        previous.b.every((value, index) => Math.abs(value - current.b[index]) < 1e-9)
      ) {
        continue;
      }
      joined.push(current);
    }
  }
  return joined;
}

function reverseCurve(curve: readonly BarycentricPoint4[]) {
  return [...curve].reverse();
}

function resampleCurve(curve: readonly BarycentricPoint4[], count: number) {
  if (curve.length === count) return [...curve];
  const sampled: BarycentricPoint4[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = (index / Math.max(1, count - 1)) * (curve.length - 1);
    const left = Math.floor(raw);
    const right = Math.min(curve.length - 1, left + 1);
    sampled.push(mixPoint(curve[left], curve[right], raw - left));
  }
  return sampled;
}

function syncCurveTemperatures(
  curve: readonly BarycentricPoint4[],
  temperatureSource: readonly BarycentricPoint4[],
) {
  const temperatures = resampleCurve(temperatureSource, curve.length);
  return curve.map((item, index) => point(item.b, temperatures[index].t));
}

function axisBary(axis: number): readonly [number, number, number] {
  return [0, 1, 2].map((index) => (index === axis ? 1 : 0)) as [
    number,
    number,
    number,
  ];
}

function radialPoint(
  apex: BarycentricPoint4,
  boundary: BarycentricPoint4,
  radius: number,
  power: number,
  bow: number,
) {
  const curvedRadius = radius ** power;
  return point(
    apex.b.map(
      (value, index) => value * (1 - radius) + boundary.b[index] * radius,
    ),
    Math.min(
      REFERENCE_AXIS_TOP_T,
      Math.max(
        REFERENCE_LOW_T,
        apex.t * (1 - curvedRadius) +
          boundary.t * curvedRadius +
          bow * Math.sin(Math.PI * radius),
      ),
    ),
  );
}

function makeRuledVolume(
  apexTop: BarycentricPoint4,
  apexBottom: BarycentricPoint4,
  upperBoundarySource: readonly BarycentricPoint4[],
  lowerBoundarySource: readonly BarycentricPoint4[],
  options: {
    radialSegments: number;
    upperPower: number;
    lowerPower: number;
    upperBow: number;
    lowerBow: number;
  },
): RuledGeometry {
  const boundaryCount = Math.max(
    upperBoundarySource.length,
    lowerBoundarySource.length,
  );
  const upperBoundary = resampleCurve(upperBoundarySource, boundaryCount);
  const lowerBoundary = resampleCurve(lowerBoundarySource, boundaryCount);
  const vertices: BarycentricPoint4[] = [];
  const faces: number[][] = [];
  const upperFaces: number[][] = [];
  const rowSize = options.radialSegments + 1;

  for (const boundary of upperBoundary) {
    for (let step = 0; step <= options.radialSegments; step += 1) {
      vertices.push(
        radialPoint(
          apexTop,
          boundary,
          step / options.radialSegments,
          options.upperPower,
          options.upperBow,
        ),
      );
    }
  }

  const lowerStart = vertices.length;
  for (const boundary of lowerBoundary) {
    for (let step = 0; step <= options.radialSegments; step += 1) {
      vertices.push(
        radialPoint(
          apexBottom,
          boundary,
          step / options.radialSegments,
          options.lowerPower,
          options.lowerBow,
        ),
      );
    }
  }

  const upperIndex = (line: number, step: number) => line * rowSize + step;
  const lowerIndex = (line: number, step: number) =>
    lowerStart + line * rowSize + step;

  for (let line = 0; line < boundaryCount - 1; line += 1) {
    for (let step = 0; step < options.radialSegments; step += 1) {
      const upper = [
        upperIndex(line, step),
        upperIndex(line + 1, step),
        upperIndex(line + 1, step + 1),
        upperIndex(line, step + 1),
      ];
      faces.push(upper);
      upperFaces.push(upper);
      faces.push([
        lowerIndex(line, step + 1),
        lowerIndex(line + 1, step + 1),
        lowerIndex(line + 1, step),
        lowerIndex(line, step),
      ]);
    }
  }

  for (let line = 0; line < boundaryCount - 1; line += 1) {
    faces.push(
      [
        upperIndex(line, options.radialSegments),
        upperIndex(line + 1, options.radialSegments),
        lowerIndex(line + 1, options.radialSegments),
        lowerIndex(line, options.radialSegments),
      ],
      [
        upperIndex(line + 1, 0),
        upperIndex(line, 0),
        lowerIndex(line, 0),
        lowerIndex(line + 1, 0),
      ],
    );
  }

  for (let step = 0; step < options.radialSegments; step += 1) {
    faces.push(
      [
        upperIndex(0, step),
        upperIndex(0, step + 1),
        lowerIndex(0, step + 1),
        lowerIndex(0, step),
      ],
      [
        upperIndex(boundaryCount - 1, step + 1),
        upperIndex(boundaryCount - 1, step),
        lowerIndex(boundaryCount - 1, step),
        lowerIndex(boundaryCount - 1, step + 1),
      ],
    );
  }

  const row = (
    indexOf: (line: number, step: number) => number,
    line: number,
  ) =>
    Array.from(
      { length: options.radialSegments + 1 },
      (_, step) => vertices[indexOf(line, step)],
    );

  const startRadial = row(upperIndex, 0);
  const endRadial = row(upperIndex, boundaryCount - 1);
  return {
    vertices,
    faces,
    edgeSegments: [
      upperBoundary,
      lowerBoundary,
      startRadial,
      endRadial,
      [upperBoundary[0], lowerBoundary[0]],
      [
        upperBoundary[Math.floor((boundaryCount - 1) / 2)],
        lowerBoundary[Math.floor((boundaryCount - 1) / 2)],
      ],
      [upperBoundary[boundaryCount - 1], lowerBoundary[boundaryCount - 1]],
    ],
    upperPatch: {
      vertices: vertices.slice(0, lowerStart),
      faces: upperFaces,
      startRadial,
      endRadial,
    },
  };
}

function prismGeometry(
  bottom: readonly BarycentricPoint4[],
  top: readonly BarycentricPoint4[],
): MutableGeometry {
  const faces: number[][] = [];
  const count = bottom.length;
  faces.push(
    [...Array(count).keys()].reverse(),
    [...Array(count).keys()].map((index) => index + count),
  );
  for (let index = 0; index < count; index += 1) {
    faces.push([
      index,
      (index + 1) % count,
      ((index + 1) % count) + count,
      index + count,
    ]);
  }
  return { vertices: [...bottom, ...top], faces };
}

function cotecticGeometry(
  liquidSource: readonly BarycentricPoint4[],
  firstSolidSource: readonly BarycentricPoint4[],
  secondSolidSource: readonly BarycentricPoint4[],
): MutableGeometry {
  const rowCount = Math.max(
    liquidSource.length,
    firstSolidSource.length,
    secondSolidSource.length,
  );
  const liquid = resampleCurve(liquidSource, rowCount);
  const firstShape = resampleCurve(firstSolidSource, rowCount);
  const secondShape = resampleCurve(secondSolidSource, rowCount);
  const first = firstShape.map((item, index) => point(item.b, liquid[index].t));
  const second = secondShape.map((item, index) => point(item.b, liquid[index].t));
  const vertices: BarycentricPoint4[] = [];
  const faces: number[][] = [];
  for (let row = 0; row < rowCount; row += 1) {
    vertices.push(first[row], liquid[row], second[row]);
  }
  const at = (row: number, offset: number) => row * 3 + offset;
  for (let row = 0; row < rowCount - 1; row += 1) {
    faces.push(
      [at(row, 0), at(row + 1, 0), at(row + 1, 1), at(row, 1)],
      [at(row, 1), at(row + 1, 1), at(row + 1, 2), at(row, 2)],
      [at(row, 2), at(row + 1, 2), at(row + 1, 0), at(row, 0)],
    );
  }
  faces.push(
    [0, 1, 2],
    [at(rowCount - 1, 0), at(rowCount - 1, 2), at(rowCount - 1, 1)],
  );
  const tieRows = [
    0,
    Math.floor((rowCount - 1) * 0.34),
    Math.floor((rowCount - 1) * 0.67),
    rowCount - 1,
  ];
  return {
    vertices,
    faces,
    edgeSegments: [
      first,
      liquid,
      second,
      ...tieRows.map((row) => [
        first[row],
        liquid[row],
        second[row],
        first[row],
      ]),
    ],
  };
}

function immiscibleCotecticGeometry(
  curveSource: readonly BarycentricPoint4[],
  firstAxis: number,
  secondAxis: number,
): MutableGeometry {
  const curve = resampleCurve(curveSource, 28);
  const vertices: BarycentricPoint4[] = [];
  const faces: number[][] = [];
  for (const curvePoint of curve) {
    vertices.push(
      point(axisBary(firstAxis), curvePoint.t),
      curvePoint,
      point(axisBary(secondAxis), curvePoint.t),
    );
  }
  const at = (row: number, offset: number) => row * 3 + offset;
  for (let row = 0; row < curve.length - 1; row += 1) {
    faces.push(
      [at(row, 0), at(row + 1, 0), at(row + 1, 1), at(row, 1)],
      [at(row, 1), at(row + 1, 1), at(row + 1, 2), at(row, 2)],
      [at(row, 2), at(row + 1, 2), at(row + 1, 0), at(row, 0)],
    );
  }
  faces.push(
    [0, 1, 2],
    [at(curve.length - 1, 0), at(curve.length - 1, 2), at(curve.length - 1, 1)],
  );
  return {
    vertices,
    faces,
    edgeSegments: [
      curve,
      curve.map((item) => point(axisBary(firstAxis), item.t)),
      curve.map((item) => point(axisBary(secondAxis), item.t)),
    ],
  };
}

function twoSolidGeometry(
  topFirstSource: readonly BarycentricPoint4[],
  topSecondSource: readonly BarycentricPoint4[],
  bottomFirstSource: readonly BarycentricPoint4[],
  bottomSecondSource: readonly BarycentricPoint4[],
): MutableGeometry {
  const rowCount = Math.max(
    topFirstSource.length,
    topSecondSource.length,
    bottomFirstSource.length,
    bottomSecondSource.length,
  );
  const topFirst = resampleCurve(topFirstSource, rowCount);
  const topSecond = resampleCurve(topSecondSource, rowCount);
  const bottomFirst = resampleCurve(bottomFirstSource, rowCount);
  const bottomSecond = resampleCurve(bottomSecondSource, rowCount);
  const vertices: BarycentricPoint4[] = [];
  const faces: number[][] = [];
  for (let row = 0; row < rowCount; row += 1) {
    vertices.push(
      topFirst[row],
      topSecond[row],
      bottomSecond[row],
      bottomFirst[row],
    );
  }
  const at = (row: number, offset: number) => row * 4 + offset;
  for (let row = 0; row < rowCount - 1; row += 1) {
    faces.push(
      [at(row, 0), at(row + 1, 0), at(row + 1, 1), at(row, 1)],
      [at(row, 3), at(row, 2), at(row + 1, 2), at(row + 1, 3)],
      [at(row, 0), at(row, 3), at(row + 1, 3), at(row + 1, 0)],
      [at(row, 1), at(row + 1, 1), at(row + 1, 2), at(row, 2)],
    );
  }
  faces.push(
    [0, 1, 2, 3],
    [
      at(rowCount - 1, 0),
      at(rowCount - 1, 3),
      at(rowCount - 1, 2),
      at(rowCount - 1, 1),
    ],
  );
  return {
    vertices,
    faces,
    edgeSegments: [topFirst, topSecond, bottomFirst, bottomSecond],
  };
}

function makeLiquidCap(
  patches: readonly SurfacePatch[],
  outerEdges: readonly (readonly BarycentricPoint4[])[],
  cotecticCurves: readonly (readonly BarycentricPoint4[])[],
): MutableGeometry {
  const vertices: BarycentricPoint4[] = [];
  const faces: number[][] = [];
  for (const patch of patches) {
    const offset = vertices.length;
    vertices.push(...patch.vertices);
    for (const face of patch.faces) {
      faces.push([...face].reverse().map((index) => index + offset));
    }
  }

  const topStart = vertices.length;
  vertices.push(
    point([1, 0, 0], REFERENCE_AXIS_TOP_T),
    point([0, 1, 0], REFERENCE_AXIS_TOP_T),
    point([0, 0, 1], REFERENCE_AXIS_TOP_T),
  );
  faces.push([topStart, topStart + 1, topStart + 2]);

  for (const edgeSource of outerEdges) {
    const edge = [...edgeSource];
    const bottomStart = vertices.length;
    vertices.push(...edge);
    const edgeTopStart = vertices.length;
    vertices.push(
      ...edge.map((item) => point(item.b, REFERENCE_AXIS_TOP_T)),
    );
    for (let index = 0; index < edge.length - 1; index += 1) {
      faces.push([
        bottomStart + index,
        bottomStart + index + 1,
        edgeTopStart + index + 1,
        edgeTopStart + index,
      ]);
    }
  }

  return {
    vertices,
    faces,
    edgeSegments: [
      [
        point([1, 0, 0], REFERENCE_AXIS_TOP_T),
        point([0, 1, 0], REFERENCE_AXIS_TOP_T),
        point([0, 0, 1], REFERENCE_AXIS_TOP_T),
        point([1, 0, 0], REFERENCE_AXIS_TOP_T),
      ],
      ...outerEdges.map((edge) => [...edge]),
      ...cotecticCurves.map((curve) => [...curve]),
    ],
  };
}

function combineRadials(
  first: readonly BarycentricPoint4[],
  second: readonly BarycentricPoint4[],
) {
  return [...first, ...[...second].reverse().slice(1)];
}

function layer(
  id: string,
  name: string,
  category: ReferencePhaseCategory,
  color: number,
  explode: ReferenceExplodeDirection,
  geometry: MutableGeometry,
): ReferenceLayerSpec {
  return { id, name, category, color, explode, geometry };
}

function makeImmiscibleModel() {
  const invariant = 0.28;
  const eAB = point([0.54, 0.46, 0], 0.42);
  const eBC = point([0, 0.54, 0.46], 0.41);
  const eCA = point([0.48, 0, 0.52], 0.43);
  const center = point([0.33, 0.34, 0.33], invariant);
  const ab = sampleCurve({
    start: eAB,
    control: point([0.46, 0.35, 0.19], 0.36),
    end: center,
    segments: 24,
  });
  const bc = sampleCurve({
    start: eBC,
    control: point([0.18, 0.48, 0.34], 0.35),
    end: center,
    segments: 24,
  });
  const ca = sampleCurve({
    start: eCA,
    control: point([0.43, 0.17, 0.4], 0.36),
    end: center,
    segments: 24,
  });
  const boundaries = {
    alpha: joinCurves(ca, reverseCurve(ab)),
    beta: joinCurves(ab, reverseCurve(bc)),
    gamma: joinCurves(bc, reverseCurve(ca)),
  };
  const pureBoundary = (axis: number) => {
    const pure = point(axisBary(axis), invariant);
    return [pure, pure, pure];
  };
  const primaryOptions = {
    radialSegments: 14,
    upperPower: 1.08,
    lowerPower: 0.92,
    upperBow: 0.018,
    lowerBow: -0.006,
  };
  const alpha = makeRuledVolume(
    point([1, 0, 0], 0.94),
    point([1, 0, 0], invariant),
    boundaries.alpha,
    pureBoundary(0),
    primaryOptions,
  );
  const beta = makeRuledVolume(
    point([0, 1, 0], 0.88),
    point([0, 1, 0], invariant),
    boundaries.beta,
    pureBoundary(1),
    primaryOptions,
  );
  const gamma = makeRuledVolume(
    point([0, 0, 1], 0.91),
    point([0, 0, 1], invariant),
    boundaries.gamma,
    pureBoundary(2),
    primaryOptions,
  );
  const outerEdges = [
    combineRadials(alpha.upperPatch.endRadial, beta.upperPatch.startRadial),
    combineRadials(beta.upperPatch.endRadial, gamma.upperPatch.startRadial),
    combineRadials(gamma.upperPatch.endRadial, alpha.upperPatch.startRadial),
  ];

  return {
    layers: [
      layer(
        "eutectic-solid-three",
        "α + β + γ 三固相区 (α + β + γ)",
        "three",
        PHASE_COLORS.three,
        "down",
        prismGeometry(
          [
            point([1, 0, 0], REFERENCE_LOW_T),
            point([0, 1, 0], REFERENCE_LOW_T),
            point([0, 0, 1], REFERENCE_LOW_T),
          ],
          [
            point([1, 0, 0], invariant),
            point([0, 1, 0], invariant),
            point([0, 0, 1], invariant),
          ],
        ),
      ),
      layer(
        "eutectic-three-alpha-beta",
        "L + α + β 三相区 (L + α + β)",
        "three",
        PHASE_COLORS.three,
        "center",
        immiscibleCotecticGeometry(ab, 0, 1),
      ),
      layer(
        "eutectic-three-beta-gamma",
        "L + β + γ 三相区 (L + β + γ)",
        "three",
        PHASE_COLORS.threeAlt,
        "center",
        immiscibleCotecticGeometry(bc, 1, 2),
      ),
      layer(
        "eutectic-three-gamma-alpha",
        "L + γ + α 三相区 (L + γ + α)",
        "three",
        PHASE_COLORS.threeAlt2,
        "center",
        immiscibleCotecticGeometry(ca, 2, 0),
      ),
      layer(
        "liquid-alpha",
        "液相 + α 两相区 (L + α)",
        "two",
        PHASE_COLORS.two,
        "center",
        alpha,
      ),
      layer(
        "liquid-beta",
        "液相 + β 两相区 (L + β)",
        "two",
        PHASE_COLORS.twoBright,
        "center",
        beta,
      ),
      layer(
        "liquid-gamma",
        "液相 + γ 两相区 (L + γ)",
        "two",
        PHASE_COLORS.twoDark,
        "center",
        gamma,
      ),
      layer(
        "liquid",
        "液相区 (Liquid)",
        "single",
        PHASE_COLORS.liquid,
        "up",
        makeLiquidCap(
          [alpha.upperPatch, beta.upperPatch, gamma.upperPatch],
          outerEdges,
          [ab, bc, ca],
        ),
      ),
    ],
    liquidPatches: [
      alpha.upperPatch,
      beta.upperPatch,
      gamma.upperPatch,
    ],
    invariant,
  };
}

function makeLimitedModel() {
  const te = 0.32;
  const points = {
    A: point([1, 0, 0], 0.94),
    B: point([0, 1, 0], 0.88),
    C: point([0, 0, 1], 0.91),
    eAB: point([0.52, 0.48, 0], 0.43),
    eBC: point([0, 0.52, 0.48], 0.42),
    eCA: point([0.49, 0, 0.51], 0.44),
    E: point([0.34, 0.33, 0.33], te),
    aTe: point([0.68, 0.16, 0.16], te),
    bTe: point([0.16, 0.68, 0.16], te),
    cTe: point([0.16, 0.16, 0.68], te),
  };
  const cotectic = {
    ab: sampleCurve({
      start: points.eAB,
      control: point([0.46, 0.33, 0.21], 0.38),
      end: points.E,
      segments: 28,
    }),
    bc: sampleCurve({
      start: points.eBC,
      control: point([0.2, 0.45, 0.35], 0.37),
      end: points.E,
      segments: 28,
    }),
    ca: sampleCurve({
      start: points.eCA,
      control: point([0.44, 0.2, 0.36], 0.39),
      end: points.E,
      segments: 28,
    }),
  };
  const solvusTop = {
    alphaCA: point([0.8, 0, 0.2], points.eCA.t),
    alphaAB: point([0.8, 0.2, 0], points.eAB.t),
    betaAB: point([0.2, 0.8, 0], points.eAB.t),
    betaBC: point([0, 0.8, 0.2], points.eBC.t),
    gammaBC: point([0, 0.2, 0.8], points.eBC.t),
    gammaCA: point([0.2, 0, 0.8], points.eCA.t),
  };
  const solidCurves = {
    abAlpha: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.alphaAB,
        control: point([0.73, 0.21, 0.06], 0),
        end: points.aTe,
        segments: 28,
      }),
      cotectic.ab,
    ),
    abBeta: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.betaAB,
        control: point([0.21, 0.73, 0.06], 0),
        end: points.bTe,
        segments: 28,
      }),
      cotectic.ab,
    ),
    bcBeta: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.betaBC,
        control: point([0.06, 0.73, 0.21], 0),
        end: points.bTe,
        segments: 28,
      }),
      cotectic.bc,
    ),
    bcGamma: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.gammaBC,
        control: point([0.06, 0.21, 0.73], 0),
        end: points.cTe,
        segments: 28,
      }),
      cotectic.bc,
    ),
    caGamma: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.gammaCA,
        control: point([0.21, 0.06, 0.73], 0),
        end: points.cTe,
        segments: 28,
      }),
      cotectic.ca,
    ),
    caAlpha: syncCurveTemperatures(
      sampleCurve({
        start: solvusTop.alphaCA,
        control: point([0.73, 0.06, 0.21], 0),
        end: points.aTe,
        segments: 28,
      }),
      cotectic.ca,
    ),
  };
  const solvus = {
    alpha: joinCurves(solidCurves.caAlpha, reverseCurve(solidCurves.abAlpha)),
    beta: joinCurves(solidCurves.abBeta, reverseCurve(solidCurves.bcBeta)),
    gamma: joinCurves(solidCurves.bcGamma, reverseCurve(solidCurves.caGamma)),
  };
  const bottom = {
    A: point([1, 0, 0], REFERENCE_LOW_T),
    B: point([0, 1, 0], REFERENCE_LOW_T),
    C: point([0, 0, 1], REFERENCE_LOW_T),
    abA: point([0.86, 0.14, 0], REFERENCE_LOW_T),
    abB: point([0.14, 0.86, 0], REFERENCE_LOW_T),
    bcB: point([0, 0.86, 0.14], REFERENCE_LOW_T),
    bcC: point([0, 0.14, 0.86], REFERENCE_LOW_T),
    caC: point([0.14, 0, 0.86], REFERENCE_LOW_T),
    caA: point([0.86, 0, 0.14], REFERENCE_LOW_T),
    a: point([0.82, 0.09, 0.09], REFERENCE_LOW_T),
    b: point([0.09, 0.82, 0.09], REFERENCE_LOW_T),
    c: point([0.09, 0.09, 0.82], REFERENCE_LOW_T),
  };
  const bottomCurves = {
    alpha: joinCurves(
      sampleCurve({
        start: bottom.caA,
        control: point([0.84, 0.04, 0.12], REFERENCE_LOW_T),
        end: bottom.a,
        segments: 16,
      }),
      sampleCurve({
        start: bottom.a,
        control: point([0.84, 0.12, 0.04], REFERENCE_LOW_T),
        end: bottom.abA,
        segments: 16,
      }),
    ),
    beta: joinCurves(
      sampleCurve({
        start: bottom.abB,
        control: point([0.12, 0.84, 0.04], REFERENCE_LOW_T),
        end: bottom.b,
        segments: 16,
      }),
      sampleCurve({
        start: bottom.b,
        control: point([0.04, 0.84, 0.12], REFERENCE_LOW_T),
        end: bottom.bcB,
        segments: 16,
      }),
    ),
    gamma: joinCurves(
      sampleCurve({
        start: bottom.bcC,
        control: point([0.04, 0.12, 0.84], REFERENCE_LOW_T),
        end: bottom.c,
        segments: 16,
      }),
      sampleCurve({
        start: bottom.c,
        control: point([0.12, 0.04, 0.84], REFERENCE_LOW_T),
        end: bottom.caC,
        segments: 16,
      }),
    ),
  };
  const twoBottom = {
    abAlpha: sampleCurve({
      start: bottom.abA,
      control: point([0.84, 0.12, 0.04], REFERENCE_LOW_T),
      end: bottom.a,
      segments: 28,
    }),
    abBeta: sampleCurve({
      start: bottom.abB,
      control: point([0.12, 0.84, 0.04], REFERENCE_LOW_T),
      end: bottom.b,
      segments: 28,
    }),
    bcBeta: sampleCurve({
      start: bottom.bcB,
      control: point([0.04, 0.84, 0.12], REFERENCE_LOW_T),
      end: bottom.b,
      segments: 28,
    }),
    bcGamma: sampleCurve({
      start: bottom.bcC,
      control: point([0.04, 0.12, 0.84], REFERENCE_LOW_T),
      end: bottom.c,
      segments: 28,
    }),
    caGamma: sampleCurve({
      start: bottom.caC,
      control: point([0.12, 0.04, 0.84], REFERENCE_LOW_T),
      end: bottom.c,
      segments: 28,
    }),
    caAlpha: sampleCurve({
      start: bottom.caA,
      control: point([0.84, 0.04, 0.12], REFERENCE_LOW_T),
      end: bottom.a,
      segments: 28,
    }),
  };
  const primaryOptions = {
    radialSegments: 16,
    upperPower: 1.38,
    lowerPower: 0.86,
    upperBow: 0.035,
    lowerBow: -0.018,
  };
  const alpha = makeRuledVolume(
    points.A,
    points.A,
    joinCurves(cotectic.ca, reverseCurve(cotectic.ab)),
    solvus.alpha,
    primaryOptions,
  );
  const beta = makeRuledVolume(
    points.B,
    points.B,
    joinCurves(cotectic.ab, reverseCurve(cotectic.bc)),
    solvus.beta,
    primaryOptions,
  );
  const gamma = makeRuledVolume(
    points.C,
    points.C,
    joinCurves(cotectic.bc, reverseCurve(cotectic.ca)),
    solvus.gamma,
    primaryOptions,
  );
  const solidOptions = {
    radialSegments: 16,
    upperPower: 0.78,
    lowerPower: 1,
    upperBow: -0.02,
    lowerBow: 0,
  };
  const alphaSolid = makeRuledVolume(
    points.A,
    bottom.A,
    solvus.alpha,
    bottomCurves.alpha,
    solidOptions,
  );
  const betaSolid = makeRuledVolume(
    points.B,
    bottom.B,
    solvus.beta,
    bottomCurves.beta,
    solidOptions,
  );
  const gammaSolid = makeRuledVolume(
    points.C,
    bottom.C,
    solvus.gamma,
    bottomCurves.gamma,
    solidOptions,
  );
  const outerEdges = [
    combineRadials(alpha.upperPatch.endRadial, beta.upperPatch.startRadial),
    combineRadials(beta.upperPatch.endRadial, gamma.upperPatch.startRadial),
    combineRadials(gamma.upperPatch.endRadial, alpha.upperPatch.startRadial),
  ];

  return {
    layers: [
      layer(
        "alpha-solution",
        "α 固溶体 (α)",
        "single",
        PHASE_COLORS.solid,
        "down",
        alphaSolid,
      ),
      layer(
        "beta-solution",
        "β 固溶体 (β)",
        "single",
        PHASE_COLORS.solidBright,
        "down",
        betaSolid,
      ),
      layer(
        "gamma-solution",
        "γ 固溶体 (γ)",
        "single",
        PHASE_COLORS.solidDark,
        "down",
        gammaSolid,
      ),
      layer(
        "alpha-beta",
        "α + β 固态两相区 (α + β)",
        "two",
        PHASE_COLORS.twoDark,
        "down",
        twoSolidGeometry(
          solidCurves.abAlpha,
          solidCurves.abBeta,
          twoBottom.abAlpha,
          twoBottom.abBeta,
        ),
      ),
      layer(
        "beta-gamma",
        "β + γ 固态两相区 (β + γ)",
        "two",
        0x0d7f75,
        "down",
        twoSolidGeometry(
          solidCurves.bcBeta,
          solidCurves.bcGamma,
          twoBottom.bcBeta,
          twoBottom.bcGamma,
        ),
      ),
      layer(
        "gamma-alpha",
        "γ + α 固态两相区 (γ + α)",
        "two",
        0x17c7b4,
        "down",
        twoSolidGeometry(
          solidCurves.caGamma,
          solidCurves.caAlpha,
          twoBottom.caGamma,
          twoBottom.caAlpha,
        ),
      ),
      layer(
        "limited-solid-three",
        "α + β + γ 三固相区 (α + β + γ)",
        "three",
        PHASE_COLORS.three,
        "down",
        prismGeometry(
          [bottom.a, bottom.b, bottom.c],
          [points.aTe, points.bTe, points.cTe],
        ),
      ),
      layer(
        "limited-three-alpha-beta",
        "L + α + β 三相区 (L + α + β)",
        "three",
        PHASE_COLORS.three,
        "center",
        cotecticGeometry(
          cotectic.ab,
          solidCurves.abAlpha,
          solidCurves.abBeta,
        ),
      ),
      layer(
        "limited-three-beta-gamma",
        "L + β + γ 三相区 (L + β + γ)",
        "three",
        PHASE_COLORS.threeAlt,
        "center",
        cotecticGeometry(
          cotectic.bc,
          solidCurves.bcBeta,
          solidCurves.bcGamma,
        ),
      ),
      layer(
        "limited-three-gamma-alpha",
        "L + γ + α 三相区 (L + γ + α)",
        "three",
        PHASE_COLORS.threeAlt2,
        "center",
        cotecticGeometry(
          cotectic.ca,
          solidCurves.caGamma,
          solidCurves.caAlpha,
        ),
      ),
      layer(
        "liquid-alpha",
        "液相 + α 两相区 (L + α)",
        "two",
        PHASE_COLORS.two,
        "center",
        alpha,
      ),
      layer(
        "liquid-beta",
        "液相 + β 两相区 (L + β)",
        "two",
        PHASE_COLORS.twoBright,
        "center",
        beta,
      ),
      layer(
        "liquid-gamma",
        "液相 + γ 两相区 (L + γ)",
        "two",
        PHASE_COLORS.twoDark,
        "center",
        gamma,
      ),
      layer(
        "liquid",
        "液相区 (Liquid)",
        "single",
        PHASE_COLORS.liquid,
        "up",
        makeLiquidCap(
          [alpha.upperPatch, beta.upperPatch, gamma.upperPatch],
          outerEdges,
          [cotectic.ab, cotectic.bc, cotectic.ca],
        ),
      ),
    ],
    liquidPatches: [
      alpha.upperPatch,
      beta.upperPatch,
      gamma.upperPatch,
    ],
    invariant: te,
  };
}

const MODELS = {
  eutectic: makeImmiscibleModel(),
  limited: makeLimitedModel(),
} as const;

export function referenceLayersFor(model: ReferenceModelKey) {
  return MODELS[model].layers;
}

function pointInTriangle(
  u: number,
  v: number,
  first: BarycentricPoint4,
  second: BarycentricPoint4,
  third: BarycentricPoint4,
) {
  const denominator =
    (second.b[1] - third.b[1]) * (first.b[0] - third.b[0]) +
    (third.b[0] - second.b[0]) * (first.b[1] - third.b[1]);
  if (Math.abs(denominator) < 1e-12) return null;
  const a =
    ((second.b[1] - third.b[1]) * (u - third.b[0]) +
      (third.b[0] - second.b[0]) * (v - third.b[1])) /
    denominator;
  const b =
    ((third.b[1] - first.b[1]) * (u - third.b[0]) +
      (first.b[0] - third.b[0]) * (v - third.b[1])) /
    denominator;
  const c = 1 - a - b;
  if (a < -1e-7 || b < -1e-7 || c < -1e-7) return null;
  return { a, b, c };
}

function triangulate(faces: readonly (readonly number[])[]) {
  const triangles: [number, number, number][] = [];
  for (const face of faces) {
    for (let index = 1; index < face.length - 1; index += 1) {
      triangles.push([face[0], face[index], face[index + 1]]);
    }
  }
  return triangles;
}

function liquidusAtReference(model: ReferenceModelKey, u: number, v: number) {
  const heights: number[] = [];
  for (const patch of MODELS[model].liquidPatches) {
    for (const [aIndex, bIndex, cIndex] of triangulate(patch.faces)) {
      const first = patch.vertices[aIndex];
      const second = patch.vertices[bIndex];
      const third = patch.vertices[cIndex];
      const weights = pointInTriangle(u, v, first, second, third);
      if (!weights) continue;
      heights.push(
        first.t * weights.a + second.t * weights.b + third.t * weights.c,
      );
    }
  }
  return heights.length ? Math.max(...heights) : MODELS[model].invariant;
}

function regionContains(
  geometry: RegionGeometrySpec,
  u: number,
  v: number,
  t: number,
) {
  const intersections: number[] = [];
  for (const [aIndex, bIndex, cIndex] of triangulate(geometry.faces)) {
    const first = geometry.vertices[aIndex];
    const second = geometry.vertices[bIndex];
    const third = geometry.vertices[cIndex];
    const weights = pointInTriangle(u, v, first, second, third);
    if (!weights) continue;
    const height =
      first.t * weights.a + second.t * weights.b + third.t * weights.c;
    if (height <= t + 1e-7) continue;
    if (!intersections.some((existing) => Math.abs(existing - height) < 1e-6)) {
      intersections.push(height);
    }
  }
  return intersections.length % 2 === 1;
}

export function referenceLiquidus(
  model: ReferenceModelKey,
  u: number,
  v: number,
) {
  return liquidusAtReference(model, u, v);
}

export function classifyReferencePoint(
  model: ReferenceModelKey,
  u: number,
  v: number,
  t: number,
) {
  if (t >= liquidusAtReference(model, u, v) - 1e-7) {
    return MODELS[model].layers.find((item) => item.id === "liquid")!;
  }

  const w = 1 - u - v;
  const dominant =
    u >= v && u >= w ? "alpha" : v >= u && v >= w ? "beta" : "gamma";
  const dominantValue = Math.max(u, v, w);
  if (dominantValue > 1 - 1e-7) {
    if (t <= MODELS[model].invariant + 1e-7) {
      return MODELS[model].layers.find((item) =>
        item.id.endsWith("solid-three"),
      )!;
    }
    const id =
      model === "limited" ? `${dominant}-solution` : `liquid-${dominant}`;
    return MODELS[model].layers.find((item) => item.id === id)!;
  }

  const priorities =
    t > MODELS[model].invariant
      ? [
          "liquid-alpha",
          "liquid-beta",
          "liquid-gamma",
          ...MODELS[model].layers
            .filter((item) => item.category === "three")
            .map((item) => item.id),
        ]
      : [
          ...MODELS[model].layers
            .filter((item) => item.category === "single")
            .map((item) => item.id),
          ...MODELS[model].layers
            .filter((item) => item.category === "two")
            .map((item) => item.id),
          ...MODELS[model].layers
            .filter((item) => item.category === "three")
            .map((item) => item.id),
        ];

  for (const id of priorities) {
    const current = MODELS[model].layers.find((item) => item.id === id);
    if (!current || current.id === "liquid") continue;
    if (regionContains(current.geometry, u, v, t)) return current;
  }

  if (model === "limited") {
    return MODELS.limited.layers.find(
      (item) => item.id === `${dominant}-solution`,
    )!;
  }
  return MODELS.eutectic.layers.find(
    (item) => item.id === "eutectic-solid-three",
  )!;
}

export const REFERENCE_CONTROL_POINTS = {
  eutectic: {
    melting: [
      point([1, 0, 0], 0.94),
      point([0, 1, 0], 0.88),
      point([0, 0, 1], 0.91),
    ],
    binary: [
      point([0.54, 0.46, 0], 0.42),
      point([0, 0.54, 0.46], 0.41),
      point([0.48, 0, 0.52], 0.43),
    ],
    ternary: point([0.33, 0.34, 0.33], 0.28),
  },
  limited: {
    melting: [
      point([1, 0, 0], 0.94),
      point([0, 1, 0], 0.88),
      point([0, 0, 1], 0.91),
    ],
    binary: [
      point([0.52, 0.48, 0], 0.43),
      point([0, 0.52, 0.48], 0.42),
      point([0.49, 0, 0.51], 0.44),
    ],
    ternary: point([0.34, 0.33, 0.33], 0.32),
  },
} as const;
