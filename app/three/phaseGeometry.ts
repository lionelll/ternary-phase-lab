import * as THREE from "three";

export type ModelKey = "isomorphous" | "eutectic" | "limited";
export type PhaseCategory = "single" | "two" | "three";
export type ExplodeDirection = "up" | "down" | "center";

export type SurfaceFn = (u: number, v: number, w: number) => number;
export type BarycentricPoint = readonly [u: number, v: number, w: number];

export type LayerSpec = {
  id: string;
  name: string;
  category: PhaseCategory;
  color: number;
  bottom: SurfaceFn;
  top: SurfaceFn;
  explode: ExplodeDirection;
  domain?: readonly BarycentricPoint[];
};

export type PhaseResult = {
  title: string;
  detail: string;
  meshId: string;
};

export type PhaseVisual = {
  id: string;
  name: string;
  category: PhaseCategory;
  explode: ExplodeDirection;
  root: THREE.Group;
  pickMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
  edgeMesh: THREE.LineSegments;
  frontMaterial: THREE.MeshPhongMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
  baseColor: THREE.Color;
  mutedColor: THREE.Color;
  /** 几何体包围球中心（局部坐标），用于按相机深度做半透明排序。 */
  centroid: THREE.Vector3;
  targetY: number;
};

/**
 * 半透明相区体的绘制顺序由每帧的相机深度决定（见 phaseScene 的 sortPhaseBodies），
 * 相界线统一排在所有相区体之后，保证 PRD 要求的"内部相界线清晰可见"。
 * 这两段区间都必须低于参考框(90)、等温截面(200) 与探测点(1000)。
 */
export const PHASE_BODY_RENDER_ORDER_BASE = 0;
export const PHASE_EDGE_RENDER_ORDER_BASE = 50;

export const DEFAULT_FRONT_OPACITY = 0.32;
export const SELECTED_FRONT_OPACITY = 0.85;
export const DIMMED_FRONT_OPACITY = 0.05;

export const L = 18;
export const A_VERTEX = new THREE.Vector3(-L / 2, 0, (Math.sqrt(3) * L) / 6);
export const B_VERTEX = new THREE.Vector3(L / 2, 0, (Math.sqrt(3) * L) / 6);
export const C_VERTEX = new THREE.Vector3(0, 0, (-Math.sqrt(3) * L) / 3);
export const TOP_Y = 14;
export const DISPLAY_Y_SCALE = 0.84;
export const DISPLAY_TOP_Y = TOP_Y * DISPLAY_Y_SCALE;
export const DEFAULT_CAMERA_POSITION = new THREE.Vector3(25.2, 16.8, 28.4);
export const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 4.8, 0);

const FULL_DOMAIN: readonly BarycentricPoint[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const CENTER: BarycentricPoint = [1 / 3, 1 / 3, 1 / 3];
const AB_MID: BarycentricPoint = [0.5, 0.5, 0];
const BC_MID: BarycentricPoint = [0, 0.5, 0.5];
const CA_MID: BarycentricPoint = [0.5, 0, 0.5];

const COMPONENT_DOMAINS = {
  alpha: [[1, 0, 0], AB_MID, CENTER, CA_MID],
  beta: [[0, 1, 0], BC_MID, CENTER, AB_MID],
  gamma: [[0, 0, 1], CA_MID, CENTER, BC_MID],
} satisfies Record<string, readonly BarycentricPoint[]>;

const PAIR_DOMAINS = {
  "alpha-beta": [[1, 0, 0], [0, 1, 0], CENTER],
  "beta-gamma": [[0, 1, 0], [0, 0, 1], CENTER],
  "gamma-alpha": [[0, 0, 1], [1, 0, 0], CENTER],
} satisfies Record<string, readonly BarycentricPoint[]>;

function clampHeight(value: number) {
  return Math.max(0.2, Math.min(TOP_Y - 0.2, value));
}

function radialFactor(u: number, v: number, w: number) {
  const squaredDistance =
    (u - 1 / 3) ** 2 + (v - 1 / 3) ** 2 + (w - 1 / 3) ** 2;
  return THREE.MathUtils.clamp(squaredDistance / (2 / 3), 0, 1);
}

function smoothInvariantThickness(gap: number, cap: number) {
  return cap * (1 - Math.exp(-Math.max(0, gap) / cap));
}

export function surfacesFor(model: ModelKey) {
  if (model === "isomorphous") {
    const solidus: SurfaceFn = (u, v, w) =>
      clampHeight(3.5 + 2.2 * v + 4.2 * w - 7.2 * (u * v + v * w + w * u));
    const liquidus: SurfaceFn = (u, v, w) =>
      clampHeight(solidus(u, v, w) + 2.7 + 7.4 * (u * v + v * w + w * u));
    return { solidus, liquidus, invariantTop: undefined, solvus: undefined };
  }

  if (model === "eutectic") {
    const solidus: SurfaceFn = (u, v, w) => {
      const radial = radialFactor(u, v, w);
      return clampHeight(1.82 + 0.42 * radial + 0.12 * (v - u));
    };
    const liquidus: SurfaceFn = (u, v, w) => {
      const radial = radialFactor(u, v, w);
      const vertexBias = 0.34 * u - 0.12 * v + 0.18 * w;
      return clampHeight(2.42 + 10.7 * radial ** 1.18 + vertexBias);
    };
    const invariantTop: SurfaceFn = (u, v, w) => {
      const low = solidus(u, v, w);
      const gap = liquidus(u, v, w) - low;
      return low + smoothInvariantThickness(gap, 0.62);
    };
    return { solidus, liquidus, invariantTop, solvus: undefined };
  }

  const solidus: SurfaceFn = (u, v, w) => {
    const radial = radialFactor(u, v, w);
    return clampHeight(2.52 + 2.18 * radial ** 1.2 + 0.58 * w - 0.14 * u);
  };
  const liquidus: SurfaceFn = (u, v, w) => {
    const radial = radialFactor(u, v, w);
    return clampHeight(
      solidus(u, v, w) + 1.3 + 5.9 * radial ** 1.16 + 0.22 * (v - u),
    );
  };
  const solvus: SurfaceFn = (u, v, w) => {
    const radial = radialFactor(u, v, w);
    return clampHeight(1.12 + 0.78 * (1 - radial) + 0.1 * w);
  };
  const invariantTop: SurfaceFn = (u, v, w) => {
    const low = solidus(u, v, w);
    const gap = liquidus(u, v, w) - low;
    return low + smoothInvariantThickness(gap, 0.55);
  };
  return { solidus, liquidus, invariantTop, solvus };
}

export function layersFor(model: ModelKey): LayerSpec[] {
  const { solidus, liquidus, invariantTop, solvus } = surfacesFor(model);
  const base: SurfaceFn = () => 0;
  const top: SurfaceFn = () => TOP_Y;

  if (model === "isomorphous") {
    return [
      {
        id: "alpha-solid",
        name: "α 固相区",
        category: "single",
        color: 0x8c4523,
        bottom: base,
        top: solidus,
        explode: "down",
      },
      {
        id: "liquid-alpha",
        name: "液相 + α 两相区",
        category: "two",
        color: 0x0a8793,
        bottom: solidus,
        top: liquidus,
        explode: "center",
      },
      {
        id: "liquid",
        name: "液相区",
        category: "single",
        color: 0x27437f,
        bottom: liquidus,
        top,
        explode: "up",
      },
    ];
  }

  if (model === "eutectic") {
    return [
      {
        id: "alpha-solid",
        name: "α 固相区",
        category: "single",
        color: 0x874221,
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.alpha,
      },
      {
        id: "beta-solid",
        name: "β 固相区",
        category: "single",
        color: 0x9d5128,
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "gamma-solid",
        name: "γ 固相区",
        category: "single",
        color: 0x71381f,
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.gamma,
      },
      {
        id: "eutectic-three-alpha-beta",
        name: "L + α + β 三相区",
        category: "three",
        color: 0xf43f5e,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["alpha-beta"],
      },
      {
        id: "eutectic-three-beta-gamma",
        name: "L + β + γ 三相区",
        category: "three",
        color: 0xe83f78,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["beta-gamma"],
      },
      {
        id: "eutectic-three-gamma-alpha",
        name: "L + γ + α 三相区",
        category: "three",
        color: 0xd946a8,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["gamma-alpha"],
      },
      {
        id: "liquid-alpha",
        name: "L + α 两相区",
        category: "two",
        color: 0x076a75,
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.alpha,
      },
      {
        id: "liquid-beta",
        name: "L + β 两相区",
        category: "two",
        color: 0x0a7c83,
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "liquid-gamma",
        name: "L + γ 两相区",
        category: "two",
        color: 0x095e6c,
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.gamma,
      },
      {
        id: "liquid",
        name: "液相区",
        category: "single",
        color: 0x27437f,
        bottom: liquidus,
        top,
        explode: "up",
      },
    ];
  }

  return [
    {
      id: "alpha-solution",
      name: "α 固溶体",
      category: "single",
      color: 0x8c4523,
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.alpha,
    },
    {
      id: "beta-solution",
      name: "β 固溶体",
      category: "single",
      color: 0x9d5128,
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "gamma-solution",
      name: "γ 固溶体",
      category: "single",
      color: 0x71381f,
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.gamma,
    },
    {
      id: "alpha-beta",
      name: "α + β 固态两相区",
      category: "two",
      color: 0x4da86c,
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "beta-gamma",
      name: "β + γ 固态两相区",
      category: "two",
      color: 0x3d9864,
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "gamma-alpha",
      name: "γ + α 固态两相区",
      category: "two",
      color: 0x5ab479,
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["gamma-alpha"],
    },
    {
      id: "limited-three-alpha-beta",
      name: "L + α + β 三相区",
      category: "three",
      color: 0xf43f5e,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "limited-three-beta-gamma",
      name: "L + β + γ 三相区",
      category: "three",
      color: 0xe83f78,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "limited-three-gamma-alpha",
      name: "L + γ + α 三相区",
      category: "three",
      color: 0xd946a8,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["gamma-alpha"],
    },
    {
      id: "liquid-alpha",
      name: "L + α 两相区",
      category: "two",
      color: 0x0a8793,
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.alpha,
    },
    {
      id: "liquid-beta",
      name: "L + β 两相区",
      category: "two",
      color: 0x087781,
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "liquid-gamma",
      name: "L + γ 两相区",
      category: "two",
      color: 0x0b6673,
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.gamma,
    },
    {
      id: "liquid",
      name: "液相区",
      category: "single",
      color: 0x27437f,
      bottom: liquidus,
      top,
      explode: "up",
    },
  ];
}

function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function sculptedVertex(
  segments: number,
  u: number,
  v: number,
  w: number,
  bottom: number,
  top: number,
) {
  const boundaryDistance = Math.min(u, v, w);
  const transitionWidth = 3.75 / segments;
  const interiorWeight = smoothStep(boundaryDistance / transitionWidth);
  const bevelWeight = 1 - interiorWeight;
  const thickness = Math.max(0.02, top - bottom);
  const seamInset = Math.min(0.1, thickness * 0.1);
  const verticalBevel = Math.min(0.32, thickness * 0.08) * bevelWeight;
  const horizontalScale = 1 - 0.034 * bevelWeight;
  const x = (u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x) * horizontalScale;
  const z = (u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z) * horizontalScale;
  return {
    x,
    z,
    bottom: (bottom + seamInset + verticalBevel) * DISPLAY_Y_SCALE,
    top: (top - seamInset - verticalBevel) * DISPLAY_Y_SCALE,
  };
}

export function createPhaseBodyGeometry(
  segments: number,
  bottomSurface: SurfaceFn,
  topSurface: SurfaceFn,
  domain: readonly BarycentricPoint[] = FULL_DOMAIN,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const interpolatePoint = (
    first: BarycentricPoint,
    second: BarycentricPoint,
    third: BarycentricPoint,
    firstWeight: number,
    secondWeight: number,
    thirdWeight: number,
  ): BarycentricPoint => [
    first[0] * firstWeight + second[0] * secondWeight + third[0] * thirdWeight,
    first[1] * firstWeight + second[1] * secondWeight + third[1] * thirdWeight,
    first[2] * firstWeight + second[2] * secondWeight + third[2] * thirdWeight,
  ];

  const addSurfaceTriangle = (
    first: BarycentricPoint,
    second: BarycentricPoint,
    third: BarycentricPoint,
  ) => {
    const indexMap = new Map<string, { bottom: number; top: number }>();

    for (let i = 0; i <= segments; i += 1) {
      for (let j = 0; j <= segments - i; j += 1) {
        const k = segments - i - j;
        const [u, v, w] = interpolatePoint(
          first,
          second,
          third,
          i / segments,
          j / segments,
          k / segments,
        );
        const vertex = sculptedVertex(
          segments,
          u,
          v,
          w,
          bottomSurface(u, v, w),
          topSurface(u, v, w),
        );
        vertices.push(vertex.x, vertex.bottom, vertex.z);
        const bottomIndex = vertexCount++;
        vertices.push(vertex.x, vertex.top, vertex.z);
        const topIndex = vertexCount++;
        indexMap.set(`${i}_${j}`, { bottom: bottomIndex, top: topIndex });
      }
    }

    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < segments - i; j += 1) {
        const p0 = indexMap.get(`${i}_${j}`)!;
        const p1 = indexMap.get(`${i + 1}_${j}`)!;
        const p2 = indexMap.get(`${i}_${j + 1}`)!;
        indices.push(p0.bottom, p2.bottom, p1.bottom, p0.top, p1.top, p2.top);
        if (j < segments - i - 1) {
          const p3 = indexMap.get(`${i + 1}_${j + 1}`)!;
          indices.push(p1.bottom, p2.bottom, p3.bottom, p1.top, p3.top, p2.top);
        }
      }
    }
  };

  for (let triangleIndex = 1; triangleIndex < domain.length - 1; triangleIndex += 1) {
    addSurfaceTriangle(
      domain[0],
      domain[triangleIndex],
      domain[triangleIndex + 1],
    );
  }

  const sideSteps = 8;
  domain.forEach((edgeEnd, domainIndex) => {
    const edgeStart = domain[(domainIndex + 1) % domain.length];
    const sideGrid: number[][] = [];

    for (let edgeIndex = 0; edgeIndex <= segments; edgeIndex += 1) {
      const edgeProgress = edgeIndex / segments;
      const u = THREE.MathUtils.lerp(edgeStart[0], edgeEnd[0], edgeProgress);
      const v = THREE.MathUtils.lerp(edgeStart[1], edgeEnd[1], edgeProgress);
      const w = THREE.MathUtils.lerp(edgeStart[2], edgeEnd[2], edgeProgress);
      const boundary = sculptedVertex(
        segments,
        u,
        v,
        w,
        bottomSurface(u, v, w),
        topSurface(u, v, w),
      );
      const rawX = u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x;
      const rawZ = u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z;
      const row: number[] = [];

      for (let sideIndex = 0; sideIndex <= sideSteps; sideIndex += 1) {
        const t = sideIndex / sideSteps;
        const edgeBulge = Math.pow(Math.sin(Math.PI * t), 1.35);
        const y = THREE.MathUtils.lerp(boundary.bottom, boundary.top, t);
        vertices.push(
          THREE.MathUtils.lerp(boundary.x, rawX, edgeBulge * 0.86),
          y,
          THREE.MathUtils.lerp(boundary.z, rawZ, edgeBulge * 0.86),
        );
        row.push(vertexCount++);
      }

      sideGrid.push(row);
    }

    for (let edgeIndex = 0; edgeIndex < segments; edgeIndex += 1) {
      for (let sideIndex = 0; sideIndex < sideSteps; sideIndex += 1) {
        const bottomLeft = sideGrid[edgeIndex][sideIndex];
        const topLeft = sideGrid[edgeIndex][sideIndex + 1];
        const bottomRight = sideGrid[edgeIndex + 1][sideIndex];
        const topRight = sideGrid[edgeIndex + 1][sideIndex + 1];
        indices.push(
          bottomLeft,
          topLeft,
          topRight,
          bottomLeft,
          topRight,
          bottomRight,
        );
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPhaseBoundaryGeometry(
  segments: number,
  bottomSurface: SurfaceFn,
  topSurface: SurfaceFn,
  domain: readonly BarycentricPoint[] = FULL_DOMAIN,
) {
  const positions: number[] = [];

  const sample = (u: number, v: number, w: number) =>
    sculptedVertex(
      segments,
      u,
      v,
      w,
      bottomSurface(u, v, w),
      topSurface(u, v, w),
    );

  const pushSegment = (
    start: ReturnType<typeof sculptedVertex>,
    end: ReturnType<typeof sculptedVertex>,
  ) => {
    positions.push(
      start.x,
      start.top,
      start.z,
      end.x,
      end.top,
      end.z,
    );
  };

  domain.forEach((edgeStart, domainIndex) => {
    const edgeEnd = domain[(domainIndex + 1) % domain.length];
    for (let index = 0; index < segments; index += 1) {
      const startProgress = index / segments;
      const endProgress = (index + 1) / segments;
      const start = sample(
        THREE.MathUtils.lerp(edgeStart[0], edgeEnd[0], startProgress),
        THREE.MathUtils.lerp(edgeStart[1], edgeEnd[1], startProgress),
        THREE.MathUtils.lerp(edgeStart[2], edgeEnd[2], startProgress),
      );
      const end = sample(
        THREE.MathUtils.lerp(edgeStart[0], edgeEnd[0], endProgress),
        THREE.MathUtils.lerp(edgeStart[1], edgeEnd[1], endProgress),
        THREE.MathUtils.lerp(edgeStart[2], edgeEnd[2], endProgress),
      );
      pushSegment(start, end);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function materialProfile(spec: LayerSpec) {
  if (spec.id === "liquid") {
    return { shininess: 92, specular: 0xdcefff };
  }
  if (spec.category === "three") {
    return { shininess: 76, specular: 0xffe8ec };
  }
  if (spec.category === "two") {
    return { shininess: 68, specular: 0xd8ffff };
  }
  return { shininess: 48, specular: 0xffe2c7 };
}

export function createPhaseVisual(
  spec: LayerSpec,
  clippingPlane: THREE.Plane,
  renderIndex: number,
): PhaseVisual {
  const geometry = createPhaseBodyGeometry(46, spec.bottom, spec.top, spec.domain);
  const baseColor = new THREE.Color(spec.color);
  const mutedColor = baseColor.clone().offsetHSL(0, 0.01, -0.02);
  const profile = materialProfile(spec);
  const clippingPlanes = [clippingPlane];

  const frontMaterial = new THREE.MeshPhongMaterial({
    color: mutedColor,
    emissive: baseColor.clone().multiplyScalar(0.035),
    emissiveIntensity: 0.32,
    shininess: profile.shininess,
    specular: profile.specular,
    transparent: true,
    opacity: DEFAULT_FRONT_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    clippingPlanes,
    clipShadows: true,
  });

  const frontMesh = new THREE.Mesh(geometry, frontMaterial);
  frontMesh.name = `${spec.id}-surface`;
  frontMesh.renderOrder = PHASE_BODY_RENDER_ORDER_BASE + renderIndex;
  frontMesh.userData = { id: spec.id, name: spec.name, category: spec.category };
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;

  const edgeGeometry = createPhaseBoundaryGeometry(
    46,
    spec.bottom,
    spec.top,
    spec.domain,
  );
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xc9ecff,
    transparent: true,
    opacity: 0.62,
    depthTest: true,
    depthWrite: false,
    fog: false,
    clippingPlanes,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.name = `${spec.id}-edges`;
  edges.renderOrder = PHASE_EDGE_RENDER_ORDER_BASE + renderIndex;

  const root = new THREE.Group();
  root.name = `phase-${spec.id}`;
  root.userData = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    explode: spec.explode,
    targetY: 0,
  };
  root.add(frontMesh, edges);

  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    explode: spec.explode,
    root,
    pickMesh: frontMesh,
    edgeMesh: edges,
    frontMaterial,
    edgeMaterial,
    baseColor,
    mutedColor,
    centroid: (geometry.boundingSphere?.center ?? new THREE.Vector3()).clone(),
    targetY: 0,
  };
}

export function setPhaseVisualHighlight(visual: PhaseVisual, selectedId: string | null) {
  if (!selectedId) {
    visual.frontMaterial.color.copy(visual.mutedColor);
    visual.frontMaterial.emissive.copy(visual.baseColor).multiplyScalar(0.035);
    visual.frontMaterial.transparent = true;
    visual.frontMaterial.opacity = DEFAULT_FRONT_OPACITY;
    visual.frontMaterial.depthWrite = false;
    visual.frontMaterial.needsUpdate = true;
    visual.frontMaterial.emissiveIntensity = 0.32;
    visual.edgeMaterial.opacity = 0.62;
    return;
  }

  if (visual.id === selectedId) {
    visual.frontMaterial.color.copy(visual.baseColor);
    visual.frontMaterial.emissive.copy(visual.baseColor).multiplyScalar(0.06);
    visual.frontMaterial.transparent = true;
    visual.frontMaterial.opacity = SELECTED_FRONT_OPACITY;
    visual.frontMaterial.depthWrite = true;
    visual.frontMaterial.needsUpdate = true;
    visual.frontMaterial.emissiveIntensity = 0.42;
    visual.edgeMaterial.opacity = 0.92;
    return;
  }

  visual.frontMaterial.color.copy(visual.mutedColor).multiplyScalar(0.58);
  visual.frontMaterial.emissive.copy(visual.mutedColor).multiplyScalar(0.02);
  visual.frontMaterial.transparent = true;
  visual.frontMaterial.opacity = DIMMED_FRONT_OPACITY;
  visual.frontMaterial.depthWrite = false;
  visual.frontMaterial.needsUpdate = true;
  visual.frontMaterial.emissiveIntensity = 0.05;
  visual.edgeMaterial.opacity = 0.06;
}

export function makeReferenceFrame() {
  const vertices = [A_VERTEX, B_VERTEX, C_VERTEX];
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i += 1) {
    const next = (i + 1) % 3;
    points.push(vertices[i], vertices[next]);
    points.push(
      vertices[i].clone().setY(DISPLAY_TOP_Y),
      vertices[next].clone().setY(DISPLAY_TOP_Y),
    );
    points.push(vertices[i], vertices[i].clone().setY(DISPLAY_TOP_Y));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xb8d9f7,
    transparent: true,
    opacity: 0.3,
    fog: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 90;

  const nodeGeometry = new THREE.SphereGeometry(0.105, 16, 10);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8d9f7,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    toneMapped: false,
  });
  const frame = new THREE.Group();
  frame.add(lines);
  vertices.forEach((vertex) => {
    const bottomNode = new THREE.Mesh(nodeGeometry, nodeMaterial);
    bottomNode.position.copy(vertex);
    bottomNode.renderOrder = 91;
    const topNode = bottomNode.clone();
    topNode.position.y = DISPLAY_TOP_Y;
    frame.add(bottomNode, topNode);
  });
  return frame;
}

export function makeSliceGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        A_VERTEX.x,
        0,
        A_VERTEX.z,
        B_VERTEX.x,
        0,
        B_VERTEX.z,
        C_VERTEX.x,
        0,
        C_VERTEX.z,
      ],
      3,
    ),
  );
  return geometry;
}

export function positionFromComposition(a: number, b: number, temperature: number) {
  const c = 100 - a - b;
  const u = a / 100;
  const v = b / 100;
  const w = c / 100;
  return new THREE.Vector3(
    u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x,
    (temperature / 100) * DISPLAY_TOP_Y,
    u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
  );
}

function dominantComponent(u: number, v: number, w: number) {
  if (u >= v && u >= w) return "alpha" as const;
  if (v >= u && v >= w) return "beta" as const;
  return "gamma" as const;
}

function dominantPair(u: number, v: number, w: number) {
  if (w <= u && w <= v) return "alpha-beta" as const;
  if (u <= v && u <= w) return "beta-gamma" as const;
  return "gamma-alpha" as const;
}

const PAIR_LABELS: Record<ReturnType<typeof dominantPair>, string> = {
  "alpha-beta": "α + β",
  "beta-gamma": "β + γ",
  "gamma-alpha": "γ + α",
};

export function phaseAt(
  model: ModelKey,
  a: number,
  b: number,
  temperature: number,
): PhaseResult {
  const c = 100 - a - b;
  const u = a / 100;
  const v = b / 100;
  const w = c / 100;
  const y = (temperature / 100) * TOP_Y;
  const { solidus, liquidus, invariantTop, solvus } = surfacesFor(model);
  const low = solidus(u, v, w);
  const high = liquidus(u, v, w);

  if (model === "isomorphous") {
    if (y >= high) return { title: "液相区", detail: "Liquid", meshId: "liquid" };
    if (y <= low) return { title: "α 固相区", detail: "α", meshId: "alpha-solid" };
    return {
      title: "液相 + α 两相区",
      detail: "Liquid + α",
      meshId: "liquid-alpha",
    };
  }

  if (y >= high) return { title: "液相区", detail: "Liquid", meshId: "liquid" };

  const component = dominantComponent(u, v, w);
  const componentLabel =
    component === "alpha" ? "α" : component === "beta" ? "β" : "γ";

  if (model === "limited" && solvus && y <= solvus(u, v, w)) {
    return {
      title: `${componentLabel} 固溶体`,
      detail: `${componentLabel} single-phase solid solution`,
      meshId: `${component}-solution`,
    };
  }

  // 三相区与固态两相区必须用同一套分区判据（dominantPair），否则同一成分降温时
  // 会出现"L + α + β 三相区"下方接"γ + α 固态两相区"这类组元不守恒的结果。
  const pair = dominantPair(u, v, w);
  const pairLabel = PAIR_LABELS[pair];

  if (model === "limited" && y <= low) {
    return {
      title: `${pairLabel} 固态两相区`,
      detail: pairLabel,
      meshId: pair,
    };
  }

  if (model === "eutectic" && y <= low) {
    return {
      title: `${componentLabel} 固相区`,
      detail: componentLabel,
      meshId: `${component}-solid`,
    };
  }

  const threePhaseCeiling = invariantTop?.(u, v, w) ?? low;
  if (y <= threePhaseCeiling) {
    return {
      title: `L + ${pairLabel} 三相区`,
      detail: `Liquid + ${pairLabel}`,
      meshId: `${model === "limited" ? "limited" : "eutectic"}-three-${pair}`,
    };
  }
  return {
    title: `L + ${componentLabel} 两相区`,
    detail: `Liquid + ${componentLabel}`,
    meshId: `liquid-${component}`,
  };
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Line
    ) {
      if (child.geometry) geometries.add(child.geometry);
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
      else if (material) materials.add(material);
      if (child instanceof THREE.Mesh && child.customDepthMaterial) {
        materials.add(child.customDepthMaterial);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
