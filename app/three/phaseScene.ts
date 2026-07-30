import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import {
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_TARGET,
  DISPLAY_TOP_Y,
  type ModelKey,
  type PhaseCategory,
  type PhaseVisual,
  createPhaseVisual,
  disposeObject,
  layersFor,
  makeReferenceFrame,
  makeSliceGeometry,
  setPhaseVisualHighlight,
} from "./phaseGeometry";

export type RenderQuality = "high" | "fallback";

export type PhaseSelection = {
  id: string;
  name: string;
};

export type PhaseSceneController = {
  rebuild: (model: ModelKey) => void;
  setTemperature: (temperature: number, exploded: boolean) => void;
  setExploded: (exploded: boolean, temperature: number) => void;
  setFilters: (filters: Record<PhaseCategory, boolean>) => void;
  setHighlight: (phaseId: string | null) => void;
  setPoint: (position: THREE.Vector3) => void;
  clearPoint: () => void;
  resetView: () => void;
  getQuality: () => RenderQuality;
  dispose: () => void;
};

type SceneOptions = {
  host: HTMLDivElement;
  initialModel: ModelKey;
  onPhaseSelect: (selection: PhaseSelection | null) => void;
};

function makeSlice() {
  const geometry = makeSliceGeometry();
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const slice = new THREE.Mesh(geometry, material);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x8ff7ff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
  edges.renderOrder = 201;
  slice.add(edges);
  slice.renderOrder = 200;
  slice.position.y = DISPLAY_TOP_Y;
  slice.visible = false;
  return slice;
}

function makeProbePoint() {
  const root = new THREE.Group();
  const pointMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe600,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const point = new THREE.Mesh(new THREE.SphereGeometry(0.44, 32, 24), pointMaterial);
  point.renderOrder = 1001;
  point.frustumCulled = false;

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffed4a,
    transparent: true,
    opacity: 0.18,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.66, 24, 16), haloMaterial);
  halo.renderOrder = 1000;
  halo.frustumCulled = false;

  root.add(halo, point);
  root.visible = false;
  root.renderOrder = 1000;
  return { root, halo };
}

export function createPhaseScene({
  host,
  initialModel,
  onPhaseSelect,
}: SceneOptions): PhaseSceneController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x05070c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.dataset.renderQuality = "high";
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  camera.position.copy(DEFAULT_CAMERA_POSITION);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.minDistance = 14;
  controls.maxDistance = 62;

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.4;
  roomEnvironment.dispose();
  pmremGenerator.dispose();

  scene.add(new THREE.AmbientLight(0x708090, 0.48));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(15, 28, 19);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -19;
  keyLight.shadow.camera.right = 19;
  keyLight.shadow.camera.top = 21;
  keyLight.shadow.camera.bottom = -17;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 70;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.028;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
  rimLight.position.set(-18, 11, -24);
  scene.add(rimLight);

  const warmFill = new THREE.DirectionalLight(0xffad70, 0.22);
  warmFill.position.set(17, 5, -13);
  scene.add(warmFill);

  const phaseGroup = new THREE.Group();
  scene.add(phaseGroup);

  const frame = makeReferenceFrame();
  scene.add(frame);

  const slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), DISPLAY_TOP_Y);
  const slice = makeSlice();
  scene.add(slice);

  const { root: probePoint, halo: probeHalo } = makeProbePoint();
  probePoint.traverse((object) => object.layers.set(1));
  camera.layers.enable(1);
  scene.add(probePoint);

  const renderPass = new RenderPass(scene, camera);
  const ssaoPass = new SSAOPass(scene, camera, 1, 1);
  ssaoPass.kernelRadius = 7;
  ssaoPass.minDistance = 0.002;
  ssaoPass.maxDistance = 0.07;
  const smaaPass = new SMAAPass();
  const outputPass = new OutputPass();
  const composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(ssaoPass);
  composer.addPass(smaaPass);
  composer.addPass(outputPass);

  let quality: RenderQuality = "high";
  let phaseVisuals: PhaseVisual[] = [];
  let currentTemperature = 100;
  let currentExploded = false;
  let disposed = false;
  const desiredTarget = DEFAULT_CAMERA_TARGET.clone();

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
  }

  function applyQuality(nextQuality: RenderQuality) {
    if (quality === nextQuality) return;
    quality = nextQuality;
    renderer.domElement.dataset.renderQuality = nextQuality;
    const highQuality = quality === "high";
    ssaoPass.enabled = highQuality;
    smaaPass.enabled = highQuality;
    setRenderSize();
  }

  function disposeVisuals() {
    phaseVisuals.forEach((visual) => {
      phaseGroup.remove(visual.root);
      disposeObject(visual.root);
    });
    phaseVisuals = [];
  }

  function setHighlight(phaseId: string | null) {
    phaseVisuals.forEach((visual) => setPhaseVisualHighlight(visual, phaseId));
  }

  function rebuild(model: ModelKey) {
    disposeVisuals();
    phaseVisuals = layersFor(model).map((spec, index) => {
      const visual = createPhaseVisual(spec, slicePlane, index + 1);
      phaseGroup.add(visual.root);
      return visual;
    });
    probePoint.visible = false;
    desiredTarget.copy(DEFAULT_CAMERA_TARGET);
    setHighlight(null);
    onPhaseSelect(null);
  }

  function setTemperature(temperature: number, exploded: boolean) {
    currentTemperature = temperature;
    currentExploded = exploded;
    const y = (temperature / 100) * DISPLAY_TOP_Y;
    slicePlane.constant = y;
    slice.position.y = y;
    slice.visible = temperature < 100 && !exploded;
  }

  function setExploded(exploded: boolean, temperature: number) {
    currentExploded = exploded;
    currentTemperature = temperature;
    renderer.localClippingEnabled = !exploded;
    frame.visible = !exploded;
    slice.visible = !exploded && temperature < 100;
    phaseVisuals.forEach((visual) => {
      visual.targetY = exploded
        ? visual.explode === "up"
          ? 2.3
          : visual.explode === "down"
            ? -2.3
            : 0
        : 0;
      visual.root.userData.targetY = visual.targetY;
    });
  }

  function setFilters(filters: Record<PhaseCategory, boolean>) {
    phaseVisuals.forEach((visual) => {
      visual.root.visible = filters[visual.category];
    });
  }

  function setPoint(position: THREE.Vector3) {
    probePoint.position.copy(position);
    probePoint.visible = true;
    desiredTarget.copy(position);
  }

  function clearPoint() {
    probePoint.visible = false;
    desiredTarget.copy(DEFAULT_CAMERA_TARGET);
  }

  function resetView() {
    camera.position.copy(DEFAULT_CAMERA_POSITION);
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    desiredTarget.copy(DEFAULT_CAMERA_TARGET);
    probePoint.visible = false;
    phaseVisuals.forEach((visual) => {
      visual.targetY = 0;
      visual.root.position.y = 0;
      visual.root.userData.targetY = 0;
    });
    renderer.localClippingEnabled = true;
    frame.visible = true;
    slice.visible = currentTemperature < 100 && !currentExploded;
    setHighlight(null);
    controls.update();
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

  function animate(time: number) {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);

    phaseVisuals.forEach((visual) => {
      visual.root.position.y += (visual.targetY - visual.root.position.y) * 0.09;
    });

    controls.target.lerp(desiredTarget, 0.085);
    if (probePoint.visible) {
      const pulse = 1 + Math.sin(time * 0.0045) * 0.07;
      probeHalo.scale.setScalar(pulse);
    }
    controls.update();
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
    setHighlight,
    setPoint,
    clearPoint,
    resetView,
    getQuality: () => quality,
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
      disposeObject(probePoint);
      composer.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
