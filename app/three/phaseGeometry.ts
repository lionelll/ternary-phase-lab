import * as THREE from "three";
import {
  REFERENCE_AXIS_TOP_T,
  REFERENCE_CONTROL_POINTS,
  REFERENCE_LOW_T,
  classifyReferencePoint,
  referenceLayersFor,
  referenceLiquidus,
  type RegionGeometrySpec,
} from "./eutecticModels.ts";

export type ModelKey = "isomorphous" | "eutectic" | "limited";
export type PhaseCategory = "single" | "two" | "three" | "four";
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
  geometry?: RegionGeometrySpec;
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
  targetPosition: THREE.Vector3;
  targetScale: number;
};

/**
 * 半透明相区体的绘制顺序由每帧的相机深度决定（见 phaseScene 的 sortPhaseBodies），
 * 相界线统一排在所有相区体之后，保证 PRD 要求的"内部相界线清晰可见"。
 * 这两段区间都必须低于参考框(90)、等温截面(200) 与探测点(1000)。
 */
export const PHASE_BODY_RENDER_ORDER_BASE = 0;
export const PHASE_EDGE_RENDER_ORDER_BASE = 50;

/*
 * 以下模型数据全部对齐参考实现《三元匀晶相图3D模型demo》（参考/三元匀晶相图3D模型demo.html）：
 * 尺寸 L=20、顶面 14、温度轴量程 15、三顶点熔点 3/7/11、相区配色、材质与不透明度、
 * 相机与光照。三种相图共用这一套风格。
 */
export const DEFAULT_FRONT_OPACITY = 0.65;
export const SELECTED_FRONT_OPACITY = 0.85;
export const DIMMED_FRONT_OPACITY = 0.05;
export const PATH_DIMMED_FRONT_OPACITY = DEFAULT_FRONT_OPACITY * 0.1;
export const DEFAULT_EDGE_OPACITY = 0.5;
export const SELECTED_EDGE_OPACITY = 1;
export const DIMMED_EDGE_OPACITY = 0.1;
export const PATH_DIMMED_EDGE_OPACITY = DEFAULT_EDGE_OPACITY * 0.1;

export const L = 20;
/** 仅拉伸温度轴，底面等边三角形宽度保持不变。 */
export const HEIGHT_SCALE = 1.2 * 1.3;
export const A_VERTEX = new THREE.Vector3(-L / 2, 0, (Math.sqrt(3) * L) / 6);
export const B_VERTEX = new THREE.Vector3(L / 2, 0, (Math.sqrt(3) * L) / 6);
export const C_VERTEX = new THREE.Vector3(0, 0, (-Math.sqrt(3) * L) / 3);

/** 相区实体的顶面高度（demo 的 topY）。 */
export const TOP_Y = 14 * HEIGHT_SCALE;
/** 温度轴量程：滑块 0~100% 线性映射到 0~15（demo 的 physicalVal）。略高于 TOP_Y，
 *  所以 100% 时裁剪面在模型之上，等温截面不切到任何东西。 */
export const TEMPERATURE_SPAN = 15 * HEIGHT_SCALE;

/** 将参考站的归一化温度轴映射到当前匀晶模型的 0~TOP_Y 舞台尺寸。 */
export function referenceTemperatureToWorld(value: number) {
  return (
    ((value - REFERENCE_LOW_T) /
      (REFERENCE_AXIS_TOP_T - REFERENCE_LOW_T)) *
    TOP_Y
  );
}

function worldTemperatureToReference(value: number) {
  return (
    REFERENCE_LOW_T +
    (value / TOP_Y) * (REFERENCE_AXIS_TOP_T - REFERENCE_LOW_T)
  );
}

/** A / B / C 三个纯组元的熔点（demo 的 TA / TB / TC）。 */
export const T_A = 3 * HEIGHT_SCALE;
export const T_B = 7 * HEIGHT_SCALE;
export const T_C = 11 * HEIGHT_SCALE;

export const DEFAULT_CAMERA_POSITION = new THREE.Vector3(28, 25, 32);
export const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 6.5 * HEIGHT_SCALE, 0);
export const CAMERA_FOV = 45;

/** 相区配色（demo 原值）。 */
export const PHASE_COLORS = {
  solid: 0xf59e0b,
  twoPhase: 0x06b6d4,
  liquid: 0x1d4ed8,
  fourPhase: 0xfacc15,
} as const;

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

/** 三顶点熔点的线性插值（demo 的 linearT）。 */
const linearT: SurfaceFn = (u, v, w) => u * T_A + v * T_B + w * T_C;

/** 组元交互项，越靠三角形中心越大（demo 用 u*v + v*w + w*u）。 */
const interaction = (u: number, v: number, w: number) => u * v + v * w + w * u;

export function surfacesFor(model: ModelKey) {
  if (model === "isomorphous") {
    // 与 demo 完全一致：固相线在熔点连线下凹，液相线上凸并截顶于 13.5。
    const solidus: SurfaceFn = (u, v, w) =>
      linearT(u, v, w) - 7.5 * HEIGHT_SCALE * interaction(u, v, w);
    const liquidus: SurfaceFn = (u, v, w) =>
      Math.min(
        13.5 * HEIGHT_SCALE,
        linearT(u, v, w) + 7.5 * HEIGHT_SCALE * interaction(u, v, w),
      );
    return { solidus, liquidus, invariantTop: undefined, solvus: undefined };
  }

  // 两类共晶模型的液相面直接取自显式控制网格，避免重新用高度函数拟合后
  // 丢失共晶沟的弧度、汇聚角和二元共晶点位置。
  const invariantReference = model === "eutectic" ? 0.28 : 0.32;
  const solidus: SurfaceFn = () =>
    referenceTemperatureToWorld(invariantReference);
  const liquidus: SurfaceFn = (u, v) =>
    referenceTemperatureToWorld(referenceLiquidus(model, u, v));
  return {
    solidus,
    liquidus,
    invariantTop: undefined,
    solvus: undefined,
  };

}

export function layersFor(model: ModelKey): LayerSpec[] {
  const referenceSpecs =
    model === "isomorphous" ? undefined : referenceLayersFor(model);
  const fourPhaseReferenceTemperature =
    model === "eutectic" ? 0.28 : model === "limited" ? 0.32 : 0.53;
  const fourPhasePoint = (b: readonly [number, number, number]) => ({
    b,
    t: fourPhaseReferenceTemperature,
  });
  const limitedSolidThree = referenceSpecs?.find(
    (spec) => spec.id === "limited-solid-three",
  );
  const limitedSolidTopFace = limitedSolidThree?.geometry.faces[1];
  const limitedSolidTopVertices = limitedSolidTopFace?.map(
    (index) => limitedSolidThree.geometry.vertices[index],
  );
  const fourPhaseVertices =
    model === "limited" && limitedSolidTopVertices?.length === 3
      ? limitedSolidTopVertices
      : [
          fourPhasePoint([1, 0, 0]),
          fourPhasePoint([0, 1, 0]),
          fourPhasePoint([0, 0, 1]),
        ];
  const fourPhasePlane: LayerSpec = {
    id: `${model}-four-phase-plane`,
    name: "四相平衡面 (L + α + β + γ)",
    category: "four",
    color: PHASE_COLORS.fourPhase,
    bottom: () => 0,
    top: () => 0,
    explode: "center",
    geometry: {
      vertices: fourPhaseVertices,
      faces: [[0, 1, 2]],
      edgeSegments: [[
        fourPhaseVertices[0],
        fourPhaseVertices[1],
        fourPhaseVertices[2],
        fourPhaseVertices[0],
      ]],
    },
  };
  if (referenceSpecs) {
    const emptySurface: SurfaceFn = () => 0;
    return [
      ...referenceSpecs
        .filter((spec) => spec.id !== "liquid")
        .map((spec) => ({
          ...spec,
          bottom: emptySurface,
          top: emptySurface,
        })),
      fourPhasePlane,
    ];
  }

  const { solidus, liquidus, invariantTop, solvus } = surfacesFor(model);
  const base: SurfaceFn = () => 0;
  const top: SurfaceFn = () => TOP_Y;

  if (model === "isomorphous") {
    return [
      {
        id: "alpha-solid",
        name: "α 固相区 (α)",
        category: "single",
        color: PHASE_COLORS.solid,
        bottom: base,
        top: solidus,
        explode: "down",
      },
      {
        id: "liquid-alpha",
        name: "液相 + α 两相区 (L + α)",
        category: "two",
        color: PHASE_COLORS.twoPhase,
        bottom: solidus,
        top: liquidus,
        explode: "center",
      },
    ];
  }

  if (model === "eutectic") {
    return [
      {
        id: "alpha-solid",
        name: "α 固相区 (α)",
        category: "single",
        color: PHASE_COLORS.solid,           // α 固相
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.alpha,
      },
      {
        id: "beta-solid",
        name: "β 固相区 (β)",
        category: "single",
        color: 0xf97316,                     // β 固相（solid 提亮）
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "gamma-solid",
        name: "γ 固相区 (γ)",
        category: "single",
        color: 0x84cc16,                     // γ 固相（solid 压暗）
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.gamma,
      },
      {
        id: "eutectic-three-alpha-beta",
        name: "L + α + β 三相区 (L + α + β)",
        category: "three",
        color: 0xfb7185,                     // 三相区：PRD 要求的高亮特征色
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["alpha-beta"],
      },
      {
        id: "eutectic-three-beta-gamma",
        name: "L + β + γ 三相区 (L + β + γ)",
        category: "three",
        color: 0xd946ef,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["beta-gamma"],
      },
      {
        id: "eutectic-three-gamma-alpha",
        name: "L + γ + α 三相区 (L + γ + α)",
        category: "three",
        color: 0x9333ea,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["gamma-alpha"],
      },
      {
        id: "liquid-alpha",
        name: "L + α 两相区 (L + α)",
        category: "two",
        color: PHASE_COLORS.twoPhase,        // L+α 两相
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.alpha,
      },
      {
        id: "liquid-beta",
        name: "L + β 两相区 (L + β)",
        category: "two",
        color: 0x10b981,                     // L+β 两相（twoPhase 提亮）
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "liquid-gamma",
        name: "L + γ 两相区 (L + γ)",
        category: "two",
        color: 0x2563eb,                     // L+γ 两相（twoPhase 压暗）
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.gamma,
      },
      {
        id: "liquid",
        name: "液相区 (Liquid)",
        category: "single",
        color: PHASE_COLORS.liquid,          // 液相
        bottom: liquidus,
        top,
        explode: "up",
      },
    ];
  }

  return [
    {
      id: "alpha-solution",
      name: "α 固溶体 (α)",
      category: "single",
      color: PHASE_COLORS.solid,           // α 固溶体
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.alpha,
    },
    {
      id: "beta-solution",
      name: "β 固溶体 (β)",
      category: "single",
      color: 0xf97316,                     // β 固相（solid 提亮）
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "gamma-solution",
      name: "γ 固溶体 (γ)",
      category: "single",
      color: 0x84cc16,                     // γ 固相（solid 压暗）
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.gamma,
    },
    {
      id: "alpha-beta",
      name: "α + β 固态两相区 (α + β)",
      category: "two",
      color: 0x0d9488,                     // α+β 固态两相（twoPhase 压暗）
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "beta-gamma",
      name: "β + γ 固态两相区 (β + γ)",
      category: "two",
      color: 0x65a30d,                     // β+γ 固态两相
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "gamma-alpha",
      name: "γ + α 固态两相区 (γ + α)",
      category: "two",
      color: 0x4f46e5,                     // γ+α 固态两相（twoPhase 提亮）
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["gamma-alpha"],
    },
    {
      id: "limited-three-alpha-beta",
      name: "L + α + β 三相区 (L + α + β)",
      category: "three",
      color: 0xfb7185,                     // 三相区：PRD 要求的高亮特征色
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "limited-three-beta-gamma",
      name: "L + β + γ 三相区 (L + β + γ)",
      category: "three",
      color: 0xd946ef,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "limited-three-gamma-alpha",
      name: "L + γ + α 三相区 (L + γ + α)",
      category: "three",
      color: 0x9333ea,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["gamma-alpha"],
    },
    {
      id: "liquid-alpha",
      name: "L + α 两相区 (L + α)",
      category: "two",
      color: PHASE_COLORS.twoPhase,        // L+α 两相
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.alpha,
    },
    {
      id: "liquid-beta",
      name: "L + β 两相区 (L + β)",
      category: "two",
      color: 0x10b981,                     // L+β 两相
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "liquid-gamma",
      name: "L + γ 两相区 (L + γ)",
      category: "two",
      color: 0x2563eb,                     // L+γ 两相
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.gamma,
    },
    {
      id: "liquid",
      name: "液相区 (Liquid)",
      category: "single",
      color: PHASE_COLORS.liquid,          // 液相
      bottom: liquidus,
      top,
      explode: "up",
    },
  ];
}

/**
 * 重心坐标 -> 世界坐标。
 *
 * 与参考 demo 一致：不做倒角、不做接缝内缩、不做整体纵向缩放，曲面高度就是相界面函数
 * 的原值。之前那套 bevel/seamInset/DISPLAY_Y_SCALE 会让相邻相区之间出现可见缝隙，
 * 也使模型高度与相界面函数不再对应。
 */
function sculptedVertex(
  _segments: number,
  u: number,
  v: number,
  w: number,
  bottom: number,
  top: number,
) {
  return {
    x: u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x,
    z: u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
    bottom,
    top,
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

function referencePointToWorld(point: RegionGeometrySpec["vertices"][number]) {
  const [u, v, w] = point.b;
  return new THREE.Vector3(
    u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x,
    referenceTemperatureToWorld(point.t),
    u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
  );
}

function createReferenceBodyGeometry(spec: RegionGeometrySpec) {
  const positions = spec.vertices.flatMap((point) =>
    referencePointToWorld(point).toArray(),
  );
  const indices: number[] = [];
  const worldVertices = spec.vertices.map(referencePointToWorld);

  spec.faces.forEach((face) => {
    for (let index = 1; index < face.length - 1; index += 1) {
      const triangle = [face[0], face[index], face[index + 1]] as const;
      const a = worldVertices[triangle[0]];
      const b = worldVertices[triangle[1]];
      const c = worldVertices[triangle[2]];
      if (
        a.distanceToSquared(b) < 1e-10 ||
        b.distanceToSquared(c) < 1e-10 ||
        c.distanceToSquared(a) < 1e-10 ||
        b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-10
      ) {
        continue;
      }
      indices.push(...triangle);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createReferenceBoundaryGeometry(spec: RegionGeometrySpec) {
  if (!spec.edgeSegments?.length) return undefined;
  const positions: number[] = [];
  spec.edgeSegments.forEach((segment) => {
    for (let index = 0; index < segment.length - 1; index += 1) {
      const start = referencePointToWorld(segment[index]);
      const end = referencePointToWorld(segment[index + 1]);
      if (start.distanceToSquared(end) < 1e-10) continue;
      positions.push(...start.toArray(), ...end.toArray());
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return geometry;
}

/** 曲面细分段数（demo 的 resolution）。 */
export const SURFACE_SEGMENTS = 25;

export function createPhaseVisual(
  spec: LayerSpec,
  clippingPlane: THREE.Plane,
  renderIndex: number,
): PhaseVisual {
  const geometry = spec.geometry
    ? createReferenceBodyGeometry(spec.geometry)
    : createPhaseBodyGeometry(
        SURFACE_SEGMENTS,
        spec.bottom,
        spec.top,
        spec.domain,
      );
  const baseColor = new THREE.Color(spec.color);
  const mutedColor = baseColor.clone();
  const clippingPlanes = [clippingPlane];

  // 材质参数与 demo 完全一致：MeshPhongMaterial + shininess 60 + opacity 0.65，
  // 双面、不写深度，polygonOffset 10/10 用于压住相界线的深度冲突。
  const frontMaterial = new THREE.MeshPhongMaterial({
    color: baseColor,
    shininess: 60,
    transparent: true,
    opacity: DEFAULT_FRONT_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 10,
    polygonOffsetUnits: 10,
    clippingPlanes,
  });

  const frontMesh = new THREE.Mesh(geometry, frontMaterial);
  frontMesh.name = `${spec.id}-surface`;
  frontMesh.renderOrder = PHASE_BODY_RENDER_ORDER_BASE + renderIndex;
  frontMesh.userData = { id: spec.id, name: spec.name, category: spec.category };

  // demo 用 EdgesGeometry(geo, 45) 提取折角边：既有相区外轮廓也有相界面的特征线，
  // 比只画域边界的做法更接近参考实现。
  const edgeGeometry =
    (spec.geometry && createReferenceBoundaryGeometry(spec.geometry)) ||
    new THREE.EdgesGeometry(geometry, 45);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: DEFAULT_EDGE_OPACITY,
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
    targetPosition: new THREE.Vector3(),
    targetScale: 1,
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
    targetPosition: new THREE.Vector3(),
    targetScale: 1,
  };
}

export function setPhaseVisualHighlight(visual: PhaseVisual, selectedId: string | null) {
  // 三档不透明度与 demo 一致：默认 0.65/边线 0.5，选中 0.85/边线 1.0，其余 0.05/边线 0.1。
  // 颜色本身不变，只调不透明度，避免选中前后出现色偏。
  const [front, edge] = !selectedId
    ? [DEFAULT_FRONT_OPACITY, DEFAULT_EDGE_OPACITY]
    : visual.id === selectedId
      ? [SELECTED_FRONT_OPACITY, SELECTED_EDGE_OPACITY]
      : [DIMMED_FRONT_OPACITY, DIMMED_EDGE_OPACITY];

  visual.frontMaterial.opacity = front;
  visual.edgeMaterial.opacity = edge;
}

export function setPhaseVisualPathHighlight(
  visual: PhaseVisual,
  highlightedIds: ReadonlySet<string>,
) {
  const highlighted = highlightedIds.has(visual.id);
  visual.frontMaterial.opacity = highlighted
    ? SELECTED_FRONT_OPACITY
    : PATH_DIMMED_FRONT_OPACITY;
  visual.edgeMaterial.opacity = highlighted
    ? SELECTED_EDGE_OPACITY
    : PATH_DIMMED_EDGE_OPACITY;
}

export function makeReferenceFrame() {
  // 与 demo 一致：纯白细线、opacity 0.2，只有三棱柱的 9 条棱，不加顶点节点球。
  const vertices = [A_VERTEX, B_VERTEX, C_VERTEX];
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i += 1) {
    const next = (i + 1) % 3;
    points.push(vertices[i], vertices[next]);
    points.push(
      vertices[i].clone().setY(TOP_Y),
      vertices[next].clone().setY(TOP_Y),
    );
    points.push(vertices[i], vertices[i].clone().setY(TOP_Y));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.2,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 90;

  const frame = new THREE.Group();
  frame.add(lines);
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
    (temperature / 100) * TEMPERATURE_SPAN,
    u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
  );
}

/** 两类共晶相图三条共晶沟汇聚的三元共晶点。 */
export function invariantPointPosition(model: ModelKey) {
  if (model === "isomorphous") return null;
  const point = REFERENCE_CONTROL_POINTS[model].ternary;
  const [u, v, w] = point.b;
  return new THREE.Vector3(
    u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x,
    referenceTemperatureToWorld(point.t),
    u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
  );
}

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
  // 与 demo 一致：滑块百分比按 TEMPERATURE_SPAN(15) 换算成物理高度，
  // 再与相界面函数比较。必须和 positionFromComposition / 等温截面用同一量程。
  const y = (temperature / 100) * TEMPERATURE_SPAN;
  const { solidus, liquidus } = surfacesFor(model);
  const low = solidus(u, v, w);
  const high = liquidus(u, v, w);

  if (model === "isomorphous") {
    if (y >= high) return { title: "液相区 (Liquid)", detail: "Liquid", meshId: "liquid" };
    if (y <= low) return { title: "α 固相区 (α)", detail: "α", meshId: "alpha-solid" };
    return {
      title: "液相 + α 两相区 (L + α)",
      detail: "Liquid + α",
      meshId: "liquid-alpha",
    };
  }

  const referenceLayer = classifyReferencePoint(
    model,
    u,
    v,
    worldTemperatureToReference(y),
  );
  const detailById: Record<string, string> = {
    liquid: "Liquid",
    "liquid-alpha": "Liquid + α",
    "liquid-beta": "Liquid + β",
    "liquid-gamma": "Liquid + γ",
    "alpha-solution": "α",
    "beta-solution": "β",
    "gamma-solution": "γ",
    "alpha-beta": "α + β",
    "beta-gamma": "β + γ",
    "gamma-alpha": "γ + α",
    "eutectic-solid-three": "α + β + γ",
    "limited-solid-three": "α + β + γ",
    "eutectic-three-alpha-beta": "Liquid + α + β",
    "eutectic-three-beta-gamma": "Liquid + β + γ",
    "eutectic-three-gamma-alpha": "Liquid + γ + α",
    "limited-three-alpha-beta": "Liquid + α + β",
    "limited-three-beta-gamma": "Liquid + β + γ",
    "limited-three-gamma-alpha": "Liquid + γ + α",
  };
  return {
    title: referenceLayer.name,
    detail: detailById[referenceLayer.id] ?? referenceLayer.name,
    meshId: referenceLayer.id,
  };
}

/** 固定成分从高温到低温所穿过的相区，顺序即凝固路径顺序。 */
export function phasePathAtComposition(model: ModelKey, a: number, b: number) {
  const crossed: PhaseResult[] = [];
  const seen = new Set<string>();
  for (let temperature = 100; temperature >= 0; temperature -= 1) {
    const phase = phaseAt(model, a, b, temperature);
    if (seen.has(phase.meshId)) continue;
    seen.add(phase.meshId);
    crossed.push(phase);
  }
  return crossed;
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
