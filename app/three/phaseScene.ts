import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import {
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_TARGET,
  A_VERTEX,
  B_VERTEX,
  C_VERTEX,
  CAMERA_FOV,
  TEMPERATURE_SPAN,
  TOP_Y,
  PHASE_BODY_RENDER_ORDER_BASE,
  PHASE_EDGE_RENDER_ORDER_BASE,
  type ModelKey,
  type PhaseCategory,
  type PhaseVisual,
  createPhaseVisual,
  disposeObject,
  invariantPointPosition,
  layersFor,
  makeReferenceFrame,
  makeSliceGeometry,
  setPhaseVisualHighlight,
  setPhaseVisualPathHighlight,
} from "./phaseGeometry";
import {
  makePlaneIntersectionGeometry,
  makeVerticalSectionPlane,
  makeVerticalSectionWallGeometry,
} from "./verticalSection";

/**
 * 渲染质量档位。仅在场景内部使用：帧率采样低于 45fps 时自动降级。
 * 当前档位会同步写到 canvas 的 `data-render-quality` 属性上，便于排查问题。
 */
type RenderQuality = "high" | "fallback";

export type PhaseSelection = {
  id: string;
  name: string;
};

export type VerticalSectionMode = "clip" | "holographic";

export type VertexLabelPositions = Record<
  "A" | "B" | "C",
  { x: number; y: number; visible: boolean }
>;

export type PhaseSceneController = {
  rebuild: (model: ModelKey) => void;
  setTemperature: (temperature: number, exploded: boolean) => void;
  setExploded: (exploded: boolean, temperature: number) => void;
  setFilters: (filters: Record<PhaseCategory, boolean>) => void;
  setPhaseVisibility: (visibility: Record<string, boolean>) => void;
  setHighlight: (phaseId: string | null) => void;
  setCompositionPath: (position: THREE.Vector3, phaseIds: string[]) => void;
  clearCompositionPath: () => void;
  setVerticalSection: (
    first: THREE.Vector3,
    second: THREE.Vector3,
    mode: VerticalSectionMode,
  ) => void;
  setVerticalSectionMode: (mode: VerticalSectionMode) => void;
  clearVerticalSection: () => void;
  setTopView: () => void;
  resetView: () => void;
  dispose: () => void;
};

type SceneOptions = {
  host: HTMLDivElement;
  initialModel: ModelKey;
  onPhaseSelect: (selection: PhaseSelection | null) => void;
  onVertexLabels?: (positions: VertexLabelPositions) => void;
};

function makeSlice() {
  const geometry = makeSliceGeometry();
  // 与 demo 一致：青色、opacity 0.25、加色混合，边线同为纯青色。
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const slice = new THREE.Mesh(geometry, material);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
  edges.renderOrder = 201;
  slice.add(edges);
  slice.renderOrder = 200;
  slice.position.y = TEMPERATURE_SPAN;
  slice.visible = false;
  return slice;
}

function makeCompositionPath() {
  // 使用极细圆柱代替 WebGL 原生 1px Line，确保高分屏和缩放状态下仍清晰可见。
  const geometry = new THREE.CylinderGeometry(
    0.055,
    0.055,
    TEMPERATURE_SPAN,
    12,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0xff334f,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Mesh(geometry, material);
  line.position.y = TEMPERATURE_SPAN * 0.5;
  line.renderOrder = 999;
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

function makeInvariantPoint() {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
  });
  const point = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 24), material);
  point.renderOrder = 998;
  point.frustumCulled = false;
  point.visible = false;
  return point;
}

export function createPhaseScene({
  host,
  initialModel,
  onPhaseSelect,
  onVertexLabels,
}: SceneOptions): PhaseSceneController {
  const scene = new THREE.Scene();

  // 舞台底色不在 WebGL 里画，改由 CSS 的 .viewport 提供，画布保持透明。
  // 参考 demo 同样用 alpha:true，让 3D 融进页面底色。
  //
  // 这里不设 toneMapping、不开 shadowMap、也不做 SSAO —— 参考 demo 都没有，
  // 而相区体是 65% 半透明的，色调映射会把暗部压死、SSAO 会在半透明面上产生错误的接触阴影。
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.domElement.dataset.renderQuality = "high";
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 1000);
  camera.position.copy(DEFAULT_CAMERA_POSITION);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.minDistance = 24;
  controls.maxDistance = 90;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI - 0.06;
  controls.screenSpacePanning = true;

  // 允许右键平移把视点移出模型中心，但不允许把模型平移到视野之外。
  // 范围取模型自身尺寸，成分探测点（x/z 最大 ±11.5，y ∈ [0, TEMPERATURE_SPAN]）也落在其中，
  // 所以视角追踪不会被截断。
  /** 相区沿环向、径向和高度方向同时分离，确保每个相区都能独立观察。 */
  const TARGET_LIMIT_XZ = 12;
  const TARGET_LIMIT_Y_MIN = 0;
  const TARGET_LIMIT_Y_MAX = TOP_Y + 1;
  const EXPLOSION_CENTER = new THREE.Vector3(0, TOP_Y * 0.5, 0);

  function clampTarget() {
    controls.target.x = THREE.MathUtils.clamp(
      controls.target.x,
      -TARGET_LIMIT_XZ,
      TARGET_LIMIT_XZ,
    );
    controls.target.y = THREE.MathUtils.clamp(
      controls.target.y,
      TARGET_LIMIT_Y_MIN,
      TARGET_LIMIT_Y_MAX,
    );
    controls.target.z = THREE.MathUtils.clamp(
      controls.target.z,
      -TARGET_LIMIT_XZ,
      TARGET_LIMIT_XZ,
    );
  }

  // 光照与 demo 一致：白色环境光 + 两盏方向光，不投阴影。
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(20, 30, 10);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-20, 10, -20);
  scene.add(fillLight);

  const phaseGroup = new THREE.Group();
  scene.add(phaseGroup);

  const frame = makeReferenceFrame();
  scene.add(frame);

  const slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), TEMPERATURE_SPAN);
  const slice = makeSlice();
  scene.add(slice);

  const compositionPath = makeCompositionPath();
  compositionPath.traverse((object) => object.layers.set(1));
  camera.layers.enable(1);
  scene.add(compositionPath);

  const invariantPoint = makeInvariantPoint();
  invariantPoint.traverse((object) => object.layers.set(1));
  scene.add(invariantPoint);

  const verticalSectionGroup = new THREE.Group();
  verticalSectionGroup.name = "vertical-section";
  verticalSectionGroup.visible = false;
  scene.add(verticalSectionGroup);

  // 后期只保留抗锯齿：SMAA 让相界线在半透明面上依然平滑（PRD 四.2 的要求）。
  // 不加 SSAO —— 相区体是半透明的，屏幕空间环境光遮蔽会在透明面之间算出错误的暗带。
  const renderPass = new RenderPass(scene, camera);
  const smaaPass = new SMAAPass();
  const outputPass = new OutputPass();
  const composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(smaaPass);
  composer.addPass(outputPass);

  let quality: RenderQuality = "high";
  let phaseVisuals: PhaseVisual[] = [];
  let currentTemperature = 100;
  let currentExploded = false;
  let verticalSectionMode: VerticalSectionMode = "holographic";
  let verticalSectionPlane: THREE.Plane | null = null;
  let verticalSectionFirst: THREE.Vector3 | null = null;
  let verticalSectionSecond: THREE.Vector3 | null = null;
  let currentFilters: Record<PhaseCategory, boolean> = {
    single: true,
    two: true,
    three: true,
    four: true,
  };
  let currentPhaseVisibility: Record<string, boolean> = {};
  let disposed = false;
  const desiredTarget = DEFAULT_CAMERA_TARGET.clone();
  // 只有在需要把视角移到新目标时才追踪；追踪完成或用户开始操作相机后立即停止，
  // 否则每帧的 lerp 会把右键平移的结果拉回原点，等于平移失效。
  let trackingTarget = false;
  let lastLabelKey = "";

  function trackTarget(target: THREE.Vector3) {
    desiredTarget.copy(target);
    trackingTarget = true;
  }

  // 相区体是半透明且不写深度的，绘制顺序必须每帧按相机深度从远到近重排。
  // 写死的下标顺序在同一高度并排的子相区（三相区 α+β/β+γ/γ+α、L+α/L+β/L+γ）之间
  // 会产生随方位角变化的错误混合。
  const sortProbe = new THREE.Vector3();
  const sortBuffer: { visual: PhaseVisual; depth: number }[] = [];

  function sortPhaseBodies() {
    sortBuffer.length = 0;
    for (const visual of phaseVisuals) {
      if (!visual.root.visible) continue;
      sortProbe.copy(visual.centroid).add(visual.root.position);
      sortBuffer.push({ visual, depth: sortProbe.distanceToSquared(camera.position) });
    }
    sortBuffer.sort((a, b) => b.depth - a.depth);
    sortBuffer.forEach(({ visual }, index) => {
      visual.pickMesh.renderOrder = PHASE_BODY_RENDER_ORDER_BASE + index;
      visual.edgeMesh.renderOrder = PHASE_EDGE_RENDER_ORDER_BASE + index;
    });
  }

  controls.addEventListener("start", () => {
    trackingTarget = false;
  });

  function emitVertexLabels(force = false) {
    if (!onVertexLabels) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const labels = Object.fromEntries(
      ([
        ["A", A_VERTEX],
        ["B", B_VERTEX],
        ["C", C_VERTEX],
      ] as const).map(([label, vertex]) => {
        const projected = vertex.clone().project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        return [
          label,
          {
            x,
            y,
            visible:
              projected.z >= -1 &&
              projected.z <= 1 &&
              x >= 0 &&
              x <= width &&
              y >= 0 &&
              y <= height,
          },
        ];
      }),
    ) as VertexLabelPositions;
    const nextKey = Object.values(labels)
      .map(({ x, y, visible }) => `${Math.round(x * 2)}:${Math.round(y * 2)}:${visible}`)
      .join("|");
    if (!force && nextKey === lastLabelKey) return;
    lastLabelKey = nextKey;
    onVertexLabels(labels);
  }

  function setRenderSize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const pixelRatio =
      quality === "high"
        ? Math.min(window.devicePixelRatio, 2)
        : Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    emitVertexLabels(true);
  }

  function applyQuality(nextQuality: RenderQuality) {
    if (quality === nextQuality) return;
    quality = nextQuality;
    renderer.domElement.dataset.renderQuality = nextQuality;
    // 降级只关抗锯齿并降像素比；材质与光照保持不变，避免观感在运行中突变。
    smaaPass.enabled = quality === "high";
    setRenderSize();
  }

  function disposeVisuals() {
    phaseVisuals.forEach((visual) => {
      phaseGroup.remove(visual.root);
      disposeObject(visual.root);
    });
    phaseVisuals = [];
  }

  function disposeVerticalSectionVisuals() {
    disposeObject(verticalSectionGroup);
    verticalSectionGroup.clear();
  }

  function updateVerticalClippingPlanes() {
    // 材质裁剪面向保留侧内移极小距离，避免截面恰好落在三棱柱外壁时
    // 共面片元在浮点误差下产生斑驳闪烁；求交线和激光墙仍使用精确原平面。
    const materialVerticalPlane = verticalSectionPlane?.clone();
    if (materialVerticalPlane) materialVerticalPlane.constant += 0.002;
    const activePlanes =
      materialVerticalPlane && verticalSectionMode === "clip"
        ? [slicePlane, materialVerticalPlane]
        : [slicePlane];
    phaseVisuals.forEach((visual) => {
      visual.frontMaterial.clippingPlanes = activePlanes;
      visual.edgeMaterial.clippingPlanes = activePlanes;
      visual.frontMaterial.needsUpdate = true;
      visual.edgeMaterial.needsUpdate = true;
    });
  }

  function refreshVerticalSectionVisuals() {
    disposeVerticalSectionVisuals();
    if (
      !verticalSectionPlane ||
      !verticalSectionFirst ||
      !verticalSectionSecond
    ) {
      verticalSectionGroup.visible = false;
      updateVerticalClippingPlanes();
      return;
    }

    const wallGeometry = makeVerticalSectionWallGeometry(
      verticalSectionFirst,
      verticalSectionSecond,
      TOP_Y,
    );
    const wallMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.name = "vertical-section-wall";
    wall.renderOrder = 997;

    const wallEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const wallEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeometry),
      wallEdgeMaterial,
    );
    wallEdges.name = "vertical-section-wall-edges";
    wallEdges.renderOrder = 998;

    const intersectionGeometry = makePlaneIntersectionGeometry(
      phaseVisuals.map((visual) => visual.pickMesh),
      verticalSectionPlane,
      undefined,
      false,
    );
    const intersectionMaterial = new THREE.LineBasicMaterial({
      color: 0xffea00,
      linewidth: 3,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    const intersections = new THREE.LineSegments(
      intersectionGeometry,
      intersectionMaterial,
    );
    intersections.name = "vertical-section-boundaries";
    intersections.renderOrder = 999;
    intersections.frustumCulled = false;

    verticalSectionGroup.add(wall, wallEdges, intersections);
    verticalSectionGroup.visible = !currentExploded;
    updateVerticalClippingPlanes();
  }

  function setVerticalSection(
    first: THREE.Vector3,
    second: THREE.Vector3,
    mode: VerticalSectionMode,
  ) {
    verticalSectionFirst = first.clone().setY(0);
    verticalSectionSecond = second.clone().setY(0);
    verticalSectionPlane = makeVerticalSectionPlane(
      verticalSectionFirst,
      verticalSectionSecond,
    );
    verticalSectionMode = mode;
    refreshVerticalSectionVisuals();
  }

  function setVerticalSectionMode(mode: VerticalSectionMode) {
    verticalSectionMode = mode;
    updateVerticalClippingPlanes();
  }

  function clearVerticalSection() {
    verticalSectionPlane = null;
    verticalSectionFirst = null;
    verticalSectionSecond = null;
    disposeVerticalSectionVisuals();
    verticalSectionGroup.visible = false;
    updateVerticalClippingPlanes();
  }

  function setHighlight(phaseId: string | null) {
    phaseVisuals.forEach((visual) => setPhaseVisualHighlight(visual, phaseId));
  }

  function setPathHighlight(phaseIds: string[]) {
    const highlightedIds = new Set(phaseIds);
    phaseVisuals.forEach((visual) =>
      setPhaseVisualPathHighlight(visual, highlightedIds),
    );
  }

  function rebuild(model: ModelKey) {
    disposeVisuals();
    const specs = layersFor(model);
    const explodeRadius = THREE.MathUtils.clamp(specs.length * 0.95, 4, 8.5);
    const explodeScale = specs.length >= 10 ? 0.34 : specs.length >= 6 ? 0.48 : 0.65;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    phaseVisuals = specs.map((spec, index) => {
      const visual = createPhaseVisual(spec, slicePlane, index + 1);
      const fallbackY = 1 - (2 * (index + 0.5)) / Math.max(1, specs.length);
      const fallbackRadius = Math.sqrt(Math.max(0, 1 - fallbackY * fallbackY));
      const fallbackDirection = new THREE.Vector3(
        Math.cos(index * goldenAngle) * fallbackRadius,
        fallbackY,
        Math.sin(index * goldenAngle) * fallbackRadius,
      );
      const direction = visual.centroid.clone().sub(EXPLOSION_CENTER);
      if (direction.lengthSq() < 1) direction.copy(fallbackDirection);
      else direction.normalize();
      visual.targetPosition
        .copy(direction.multiplyScalar(explodeRadius))
        // root 以世界原点缩放；补偿缩放造成的整体下沉，让拆解球心保持在模型中心。
        .addScaledVector(EXPLOSION_CENTER, 1 - explodeScale);
      visual.targetScale = explodeScale;
      phaseGroup.add(visual.root);
      return visual;
    });
    currentPhaseVisibility = Object.fromEntries(
      phaseVisuals.map((visual) => [visual.id, true]),
    );
    compositionPath.visible = false;
    // 三种模型共用同一三棱柱高度，避免匀晶模型参考框额外拉高。
    frame.scale.y = 1;
    const invariantPosition = invariantPointPosition(model);
    invariantPoint.visible = invariantPosition !== null;
    if (invariantPosition) invariantPoint.position.copy(invariantPosition);
    if (verticalSectionPlane) refreshVerticalSectionVisuals();
    else updateVerticalClippingPlanes();
    trackTarget(DEFAULT_CAMERA_TARGET);
    setHighlight(null);
    onPhaseSelect(null);
  }

  function setTemperature(temperature: number, exploded: boolean) {
    currentTemperature = temperature;
    currentExploded = exploded;
    const y = (temperature / 100) * TEMPERATURE_SPAN;
    // 0% 时裁剪面仍精确落在底面；只把可视化的青色薄片抬高极小距离，
    // 避免它与底面完全共面造成 Z-fighting、模糊和杂色。
    slicePlane.constant = y;
    slice.position.y = y === 0 ? 0.08 : y;
    slice.visible = temperature < 100 && !exploded;
  }

  function setExploded(exploded: boolean, temperature: number) {
    currentExploded = exploded;
    currentTemperature = temperature;
    renderer.localClippingEnabled = !exploded;
    frame.visible = !exploded;
    slice.visible = !exploded && temperature < 100;
    verticalSectionGroup.visible = !exploded && verticalSectionPlane !== null;
    phaseVisuals.forEach((visual) => {
      visual.root.userData.targetPosition = exploded
        ? visual.targetPosition.clone()
        : new THREE.Vector3();
      visual.root.userData.targetScale = exploded ? visual.targetScale : 1;
    });
    trackTarget(exploded ? EXPLOSION_CENTER : DEFAULT_CAMERA_TARGET);
  }

  function applyVisibility() {
    phaseVisuals.forEach((visual) => {
      visual.root.visible =
        currentFilters[visual.category] && currentPhaseVisibility[visual.id] !== false;
    });
  }

  function setFilters(filters: Record<PhaseCategory, boolean>) {
    currentFilters = { ...filters };
    applyVisibility();
  }

  function setPhaseVisibility(visibility: Record<string, boolean>) {
    currentPhaseVisibility = { ...visibility };
    applyVisibility();
  }

  function setCompositionPath(position: THREE.Vector3, phaseIds: string[]) {
    compositionPath.position.set(position.x, TEMPERATURE_SPAN * 0.5, position.z);
    compositionPath.visible = true;
    setPathHighlight(phaseIds);
    trackTarget(new THREE.Vector3(position.x, TOP_Y * 0.5, position.z));
  }

  function clearCompositionPath() {
    compositionPath.visible = false;
    setHighlight(null);
    trackTarget(DEFAULT_CAMERA_TARGET);
  }

  function setTopView() {
    const target = new THREE.Vector3(0, TOP_Y * 0.5, 0);
    controls.target.copy(target);
    desiredTarget.copy(target);
    trackingTarget = false;
    camera.position.set(target.x, target.y + 45, target.z + 0.001);
    camera.up.set(0, 1, 0);
    controls.update();
    emitVertexLabels(true);
  }

  function resetView() {
    camera.position.copy(DEFAULT_CAMERA_POSITION);
    camera.up.set(0, 1, 0);
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    desiredTarget.copy(DEFAULT_CAMERA_TARGET);
    trackingTarget = false;
    currentExploded = false;
    compositionPath.visible = false;
    clearVerticalSection();
    phaseVisuals.forEach((visual) => {
      visual.root.position.set(0, 0, 0);
      visual.root.scale.setScalar(1);
      visual.root.userData.targetPosition = new THREE.Vector3();
      visual.root.userData.targetScale = 1;
    });
    renderer.localClippingEnabled = true;
    frame.visible = true;
    slice.visible = currentTemperature < 100 && !currentExploded;
    setHighlight(null);
    controls.update();
    emitVertexLabels(true);
  }

  rebuild(initialModel);
  setRenderSize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downPoint = { x: 0, y: 0 };

  function onPointerDown(event: PointerEvent) {
    downPoint = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    const travel = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y);
    if (travel > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const pickMeshes = phaseVisuals
      .filter((visual) => visual.root.visible)
      .map((visual) => visual.pickMesh);
    const hit = raycaster.intersectObjects(pickMeshes, false)[0]?.object as
      | THREE.Mesh
      | undefined;
    if (!hit) {
      setHighlight(null);
      onPhaseSelect(null);
      return;
    }
    const phaseId = String(hit.userData.id);
    const phaseName = String(hit.userData.name);
    setHighlight(phaseId);
    onPhaseSelect({ id: phaseId, name: phaseName });
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  const resizeObserver = new ResizeObserver(setRenderSize);
  resizeObserver.observe(host);

  let animationFrame = 0;
  let warmupFrames = 0;
  let sampledFrames = 0;
  let sampleStart = 0;

  function animate() {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);

    phaseVisuals.forEach((visual) => {
      const target = visual.root.userData.targetPosition as THREE.Vector3;
      visual.root.position.lerp(target, 0.09);
      const targetScale = visual.root.userData.targetScale as number;
      const scale = THREE.MathUtils.lerp(visual.root.scale.x, targetScale, 0.09);
      visual.root.scale.setScalar(scale);
    });

    if (trackingTarget) {
      controls.target.lerp(desiredTarget, 0.085);
      if (controls.target.distanceToSquared(desiredTarget) < 0.0004) {
        controls.target.copy(desiredTarget);
        trackingTarget = false;
      }
    }
    clampTarget();
    controls.update();
    emitVertexLabels();
    sortPhaseBodies();
    composer.render();

    if (quality === "high" && document.visibilityState === "visible") {
      warmupFrames += 1;
      if (warmupFrames === 90) sampleStart = performance.now();
      if (warmupFrames > 90 && sampledFrames < 120) {
        sampledFrames += 1;
        if (sampledFrames === 120) {
          const elapsed = performance.now() - sampleStart;
          const fps = (sampledFrames * 1000) / Math.max(1, elapsed);
          if (fps < 45) applyQuality("fallback");
        }
      }
    }
  }
  animationFrame = requestAnimationFrame(animate);

  return {
    rebuild,
    setTemperature,
    setExploded,
    setFilters,
    setPhaseVisibility,
    setHighlight,
    setCompositionPath,
    clearCompositionPath,
    setVerticalSection,
    setVerticalSectionMode,
    clearVerticalSection,
    setTopView,
    resetView,
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      disposeVisuals();
      disposeObject(frame);
      disposeObject(slice);
      disposeObject(compositionPath);
      disposeObject(invariantPoint);
      disposeVerticalSectionVisuals();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
