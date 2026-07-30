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

/*
 * 以下模型数据全部对齐参考实现《三元匀晶相图3D模型demo》（参考/三元匀晶相图3D模型demo.html）：
 * 尺寸 L=20、顶面 14、温度轴量程 15、三顶点熔点 3/7/11、相区配色、材质与不透明度、
 * 相机与光照。三种相图共用这一套风格。
 */
export const DEFAULT_FRONT_OPACITY = 0.65;
export const SELECTED_FRONT_OPACITY = 0.85;
export const DIMMED_FRONT_OPACITY = 0.05;
export const DEFAULT_EDGE_OPACITY = 0.5;
export const SELECTED_EDGE_OPACITY = 1;
export const DIMMED_EDGE_OPACITY = 0.1;

export const L = 20;
export const A_VERTEX = new THREE.Vector3(-L / 2, 0, (Math.sqrt(3) * L) / 6);
export const B_VERTEX = new THREE.Vector3(L / 2, 0, (Math.sqrt(3) * L) / 6);
export const C_VERTEX = new THREE.Vector3(0, 0, (-Math.sqrt(3) * L) / 3);

/** 相区实体的顶面高度（demo 的 topY）。 */
export const TOP_Y = 14;
/** 温度轴量程：滑块 0~100% 线性映射到 0~15（demo 的 physicalVal）。略高于 TOP_Y，
 *  所以 100% 时裁剪面在模型之上，等温截面不切到任何东西。 */
export const TEMPERATURE_SPAN = 15;

/** A / B / C 三个纯组元的熔点（demo 的 TA / TB / TC）。 */
export const T_A = 3;
export const T_B = 7;
export const T_C = 11;

export const DEFAULT_CAMERA_POSITION = new THREE.Vector3(28, 20, 32);
export const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 6.5, 0);
export const CAMERA_FOV = 45;

/** 相区配色（demo 原值）。 */
export const PHASE_COLORS = {
  solid: 0xd97706,
  twoPhase: 0x14b8a6,
  liquid: 0x1e3a8a,
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

/** 三顶点熔点的线性插值（demo 的 linearT）。 */
const linearT: SurfaceFn = (u, v, w) => u * T_A + v * T_B + w * T_C;

/** 组元交互项，越靠三角形中心越大（demo 用 u*v + v*w + w*u）。 */
const interaction = (u: number, v: number, w: number) => u * v + v * w + w * u;

/* ---- 两个共晶模型的实测参数（归一化高度 × TOP_Y） ---- */

/** 固态不互溶：三顶点熔点，STL 实测归一化 0.876 / 1.000 / 0.936。 */
const EUTECTIC_MELTING: readonly [number, number, number] = [
  0.876 * TOP_Y,
  1.0 * TOP_Y,
  0.936 * TOP_Y,
];
/** 固态不互溶：三相水平反应面高度，STL 实测归一化 0.301。 */
const EUTECTIC_INVARIANT = 0.301 * TOP_Y;
/** 三个二元共晶点温度，STL 侧面实测归一化 0.634 / 0.704 / 0.545（分别在 AB / BC / CA 棱上）。 */
const EUTECTIC_BINARY: readonly [number, number, number] = [
  0.634 * TOP_Y,
  0.704 * TOP_Y,
  0.545 * TOP_Y,
];
/** 三相反应层厚度：STL 连通体实测该水平薄板跨 [0.301, 0.321]，即 0.020。 */
const EUTECTIC_THREE_PHASE_THICKNESS = 0.020 * TOP_Y;

/** 固态有限互溶：三顶点熔点，STL 实测归一化 0.825 / 1.000 / 1.000。 */
const LIMITED_MELTING: readonly [number, number, number] = [
  0.825 * TOP_Y,
  1.0 * TOP_Y,
  1.0 * TOP_Y,
];
/** 固态有限互溶：三相水平反应面高度，STL 实测归一化 0.391。 */
const LIMITED_INVARIANT = 0.391 * TOP_Y;
/** 三个二元共晶点温度，STL 侧面实测归一化 0.590 / 0.636 / 0.616。 */
const LIMITED_BINARY: readonly [number, number, number] = [
  0.590 * TOP_Y,
  0.636 * TOP_Y,
  0.616 * TOP_Y,
];
/** 三相反应层厚度：STL 实测该水平薄板跨 [0.391, 0.404]，即 0.013。 */
const LIMITED_THREE_PHASE_THICKNESS = 0.013 * TOP_Y;

/**
 * 三元共晶的液相面。
 *
 * 由三片曲面组成，每片从对应纯组元的熔点下降，三片沿共晶沟谷相交并汇于三元共晶点 E。
 * 每片写成 T_E + (T_m − T_E)·s，其中 s 是该组元的归一化过量：
 *   s_i = clamp((3·x_i − 1) / 2, 0, 1)
 * 于是顶点处 x=1 → s=1 → 正好等于熔点；形心处 x=1/3 → s=0 → 正好等于 E 的温度，
 * 与 STL 实测「形心上方最低点 = 水平反应面高度」一致。
 * 取三片的最大值：冷却时最先结晶的组元决定液相面，沟谷即两片相交处。
 */
function makeEutecticLiquidus(
  melting: readonly [number, number, number],
  binary: readonly [number, number, number],
  invariant: number,
): SurfaceFn {
  // 液相面由三片组成，每片对应一个先结晶的固相；取三片最大值，
  // 相交处自然形成三条共晶沟谷 e_iE，三谷汇于形心处的三元共晶点 E。
  //
  // 每片写成：T_E + (T_m − T_E)·s，s 是该组元的归一化过量 clamp((3x−1)/2, 0, 1)。
  // 于是顶点 x=1 → s=1 → 正好是熔点，形心 x=1/3 → s=0 → 正好是 E，与实测吻合。
  //
  // 但只有这一项时，棱中点的高度完全由熔点决定，比实测的二元共晶点 e_i 偏低。
  // 因此再加一个"棱上抬升"修正项：只在某个组元趋近 0（即位于该棱所在的侧面）时生效，
  // 大小恰好把棱中点从纯插值高度抬到实测的 e_i，进入三角形内部后迅速衰减到 0。
  const sheet = (x: number, tm: number) =>
    invariant + (tm - invariant) * Math.max(0, Math.min(1, (3 * x - 1) / 2));

  // 棱 AB（w=0）中点处纯插值给出的高度，用于反推需要的凹陷量。
  const lift = (tm0: number, tm1: number, te: number) =>
    te - Math.max(sheet(0.5, tm0), sheet(0.5, tm1));

  const liftAB = lift(melting[0], melting[1], binary[0]);
  const liftBC = lift(melting[1], melting[2], binary[1]);
  const liftCA = lift(melting[2], melting[0], binary[2]);

  return (u, v, w) => {
    const raw = Math.max(
      sheet(u, melting[0]),
      sheet(v, melting[1]),
      sheet(w, melting[2]),
    );
    // 凹陷权重：在对应棱上（第三个组元为 0）且远离顶点时最大，进入内部迅速衰减。
    const weight = (opposite: number, x0: number, x1: number) =>
      Math.max(0, 1 - 3 * opposite) * 4 * Math.max(0, x0) * Math.max(0, x1);
    const bump =
      liftAB * weight(w, u, v) + liftBC * weight(u, v, w) + liftCA * weight(v, w, u);
    return Math.max(invariant, raw + bump);
  };
}

export function surfacesFor(model: ModelKey) {
  if (model === "isomorphous") {
    // 与 demo 完全一致：固相线在熔点连线下凹，液相线上凸并截顶于 13.5。
    const solidus: SurfaceFn = (u, v, w) =>
      linearT(u, v, w) - 7.5 * interaction(u, v, w);
    const liquidus: SurfaceFn = (u, v, w) =>
      Math.min(13.5, linearT(u, v, w) + 7.5 * interaction(u, v, w));
    return { solidus, liquidus, invariantTop: undefined, solvus: undefined };
  }

  if (model === "eutectic") {
    // 参数取自参考 STL《固相不互溶的三元共晶.stl》实测：
    //   底面正三角形边长 132.5（三边 132.5/132.4/132.5），温度跨度 153
    //   三顶点熔点归一化 0.876 / 1.000 / 0.936
    //   三相水平反应面（= 三元共晶点 E 温度）归一化 0.301：三条棱中点与形心的液相面
    //   最低点全部落在该高度，证实它是贯穿整个三角形的水平面。
    const solidus: SurfaceFn = () => EUTECTIC_INVARIANT;
    const liquidus = makeEutecticLiquidus(EUTECTIC_MELTING, EUTECTIC_BINARY, EUTECTIC_INVARIANT);
    // 固态完全不互溶：反应面以下即 α+β+γ，三相区就是该水平面之上到液相面之间的薄层。
    const invariantTop: SurfaceFn = (u, v, w) =>
      Math.min(liquidus(u, v, w) - 0.02, EUTECTIC_INVARIANT + EUTECTIC_THREE_PHASE_THICKNESS);
    return { solidus, liquidus, invariantTop, solvus: undefined };
  }

  // 固态有限互溶：参数取自《固相有限互溶的三元共晶.stl》实测：
  //   底面边长 151.7，温度跨度 152，顶点熔点归一化 0.825 / 1.000 / 1.000
  //   三相水平反应面（E 温度）归一化 0.391
  // 与不互溶的区别是多一层固溶度边界（solvus），反应面以下不再是纯三相机械混合。
  const solidus: SurfaceFn = () => LIMITED_INVARIANT;
  const liquidus = makeEutecticLiquidus(LIMITED_MELTING, LIMITED_BINARY, LIMITED_INVARIANT);
  const solvus: SurfaceFn = (u, v, w) =>
    LIMITED_INVARIANT * (0.42 + 0.30 * (1 - radialFactor(u, v, w)));
  const invariantTop: SurfaceFn = (u, v, w) =>
    Math.min(liquidus(u, v, w) - 0.02, LIMITED_INVARIANT + LIMITED_THREE_PHASE_THICKNESS);
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
      {
        id: "liquid",
        name: "液相区 (Liquid)",
        category: "single",
        color: PHASE_COLORS.liquid,
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
        color: 0xea8a0a,                     // β 固相（solid 提亮）
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "gamma-solid",
        name: "γ 固相区 (γ)",
        category: "single",
        color: 0xb45f05,                     // γ 固相（solid 压暗）
        bottom: base,
        top: solidus,
        explode: "down",
        domain: COMPONENT_DOMAINS.gamma,
      },
      {
        id: "eutectic-three-alpha-beta",
        name: "L + α + β 三相区 (L + α + β)",
        category: "three",
        color: 0xf43f5e,                     // 三相区：PRD 要求的高亮特征色
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["alpha-beta"],
      },
      {
        id: "eutectic-three-beta-gamma",
        name: "L + β + γ 三相区 (L + β + γ)",
        category: "three",
        color: 0xe83f78,
        bottom: solidus,
        top: invariantTop!,
        explode: "center",
        domain: PAIR_DOMAINS["beta-gamma"],
      },
      {
        id: "eutectic-three-gamma-alpha",
        name: "L + γ + α 三相区 (L + γ + α)",
        category: "three",
        color: 0xd946a8,
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
        color: 0x2dd4bf,                     // L+β 两相（twoPhase 提亮）
        bottom: invariantTop!,
        top: liquidus,
        explode: "center",
        domain: COMPONENT_DOMAINS.beta,
      },
      {
        id: "liquid-gamma",
        name: "L + γ 两相区 (L + γ)",
        category: "two",
        color: 0x0d9488,                     // L+γ 两相（twoPhase 压暗）
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
      color: 0xea8a0a,                     // β 固相（solid 提亮）
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "gamma-solution",
      name: "γ 固溶体 (γ)",
      category: "single",
      color: 0xb45f05,                     // γ 固相（solid 压暗）
      bottom: base,
      top: solvus!,
      explode: "down",
      domain: COMPONENT_DOMAINS.gamma,
    },
    {
      id: "alpha-beta",
      name: "α + β 固态两相区 (α + β)",
      category: "two",
      color: 0x0f9488,                     // α+β 固态两相（twoPhase 压暗）
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "beta-gamma",
      name: "β + γ 固态两相区 (β + γ)",
      category: "two",
      color: 0x0d7f75,                     // β+γ 固态两相
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "gamma-alpha",
      name: "γ + α 固态两相区 (γ + α)",
      category: "two",
      color: 0x17c7b4,                     // γ+α 固态两相（twoPhase 提亮）
      bottom: solvus!,
      top: solidus,
      explode: "down",
      domain: PAIR_DOMAINS["gamma-alpha"],
    },
    {
      id: "limited-three-alpha-beta",
      name: "L + α + β 三相区 (L + α + β)",
      category: "three",
      color: 0xf43f5e,                     // 三相区：PRD 要求的高亮特征色
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["alpha-beta"],
    },
    {
      id: "limited-three-beta-gamma",
      name: "L + β + γ 三相区 (L + β + γ)",
      category: "three",
      color: 0xe83f78,
      bottom: solidus,
      top: invariantTop!,
      explode: "center",
      domain: PAIR_DOMAINS["beta-gamma"],
    },
    {
      id: "limited-three-gamma-alpha",
      name: "L + γ + α 三相区 (L + γ + α)",
      category: "three",
      color: 0xd946a8,
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
      color: 0x2dd4bf,                     // L+β 两相
      bottom: invariantTop!,
      top: liquidus,
      explode: "center",
      domain: COMPONENT_DOMAINS.beta,
    },
    {
      id: "liquid-gamma",
      name: "L + γ 两相区 (L + γ)",
      category: "two",
      color: 0x0d9488,                     // L+γ 两相
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

/** 曲面细分段数（demo 的 resolution）。 */
export const SURFACE_SEGMENTS = 25;

export function createPhaseVisual(
  spec: LayerSpec,
  clippingPlane: THREE.Plane,
  renderIndex: number,
): PhaseVisual {
  const geometry = createPhaseBodyGeometry(
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
  const edgeGeometry = new THREE.EdgesGeometry(geometry, 45);
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
  // 与 demo 一致：滑块百分比按 TEMPERATURE_SPAN(15) 换算成物理高度，
  // 再与相界面函数比较。必须和 positionFromComposition / 等温截面用同一量程。
  const y = (temperature / 100) * TEMPERATURE_SPAN;
  const { solidus, liquidus, invariantTop, solvus } = surfacesFor(model);
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

  if (y >= high) return { title: "液相区 (Liquid)", detail: "Liquid", meshId: "liquid" };

  const component = dominantComponent(u, v, w);
  const componentLabel =
    component === "alpha" ? "α" : component === "beta" ? "β" : "γ";

  if (model === "limited" && solvus && y <= solvus(u, v, w)) {
    return {
      title: `${componentLabel} 固溶体 (${componentLabel})`,
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
      title: `${pairLabel} 固态两相区 (${pairLabel})`,
      detail: pairLabel,
      meshId: pair,
    };
  }

  if (model === "eutectic" && y <= low) {
    return {
      title: `${componentLabel} 固相区 (${componentLabel})`,
      detail: componentLabel,
      meshId: `${component}-solid`,
    };
  }

  const threePhaseCeiling = invariantTop?.(u, v, w) ?? low;
  if (y <= threePhaseCeiling) {
    return {
      title: `L + ${pairLabel} 三相区 (L + ${pairLabel})`,
      detail: `Liquid + ${pairLabel}`,
      meshId: `${model === "limited" ? "limited" : "eutectic"}-three-${pair}`,
    };
  }
  return {
    title: `L + ${componentLabel} 两相区 (L + ${componentLabel})`,
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
