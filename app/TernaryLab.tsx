"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { brandLogo } from "./brandLogo";

type ModelKey = "isomorphous" | "eutectic" | "limited";
type PhaseCategory = "single" | "two" | "three";

type LayerSpec = {
  id: string;
  name: string;
  category: PhaseCategory;
  color: number;
  bottom: SurfaceFn;
  top: SurfaceFn;
  explode: "up" | "down" | "center";
};

type SurfaceFn = (u: number, v: number, w: number) => number;

type PhaseResult = {
  title: string;
  detail: string;
  meshId: string;
};

type SceneApi = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  frame: THREE.LineSegments;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  point: THREE.Mesh;
  renderer: THREE.WebGLRenderer;
  slice: THREE.Mesh;
  slicePlane: THREE.Plane;
  model: ModelKey;
};

const MODEL_META: Record<
  ModelKey,
  { short: string; title: string; subtitle: string; note: string }
> = {
  isomorphous: {
    short: "三元匀晶",
    title: "三元匀晶相图",
    subtitle: "Ternary Isomorphous Phase Diagram",
    note: "观察液相、L + α 两相区与 α 固相区如何随温度连续过渡。",
  },
  eutectic: {
    short: "不互溶共晶",
    title: "固态不互溶的三元共晶相图",
    subtitle: "No Solid Solubility",
    note: "液相面向三元共晶点收敛，低温三相区形成清晰的水平反应层。",
  },
  limited: {
    short: "有限互溶共晶",
    title: "固态有限互溶的三元共晶相图",
    subtitle: "Limited Solid Solubility",
    note: "在共晶骨架上加入固态溶解度边界，比较 α + β 两相区的空间变化。",
  },
};

const CATEGORY_LABELS: Record<PhaseCategory, string> = {
  single: "单相区",
  two: "两相区",
  three: "三相区",
};

const L = 18;
const A_VERTEX = new THREE.Vector3(-L / 2, 0, (Math.sqrt(3) * L) / 6);
const B_VERTEX = new THREE.Vector3(L / 2, 0, (Math.sqrt(3) * L) / 6);
const C_VERTEX = new THREE.Vector3(0, 0, (-Math.sqrt(3) * L) / 3);
const TOP_Y = 14;

function clampHeight(value: number) {
  return Math.max(0.2, Math.min(TOP_Y - 0.2, value));
}

function surfacesFor(model: ModelKey) {
  if (model === "isomorphous") {
    const solidus: SurfaceFn = (u, v, w) =>
      clampHeight(3.5 + 2.2 * v + 4.2 * w - 7.2 * (u * v + v * w + w * u));
    const liquidus: SurfaceFn = (u, v, w) =>
      clampHeight(solidus(u, v, w) + 2.7 + 7.4 * (u * v + v * w + w * u));
    return { solidus, liquidus };
  }

  if (model === "eutectic") {
    const solidus: SurfaceFn = (u, v, w) =>
      clampHeight(1.75 + 0.55 * Math.max(u, v, w));
    const liquidus: SurfaceFn = (u, v, w) => {
      const radial = Math.max(u, v, w) - 1 / 3;
      return clampHeight(2.45 + 17 * Math.pow(Math.max(0, radial), 1.42));
    };
    return { solidus, liquidus };
  }

  const solidus: SurfaceFn = (u, v, w) => {
    const center = 1 - 2.7 * (u * v + v * w + w * u);
    return clampHeight(2.65 + 2.5 * Math.max(0, center) + 0.7 * w);
  };
  const liquidus: SurfaceFn = (u, v, w) => {
    const radial = Math.max(u, v, w) - 1 / 3;
    return clampHeight(solidus(u, v, w) + 1.25 + 11.5 * Math.pow(Math.max(0, radial), 1.35));
  };
  return { solidus, liquidus };
}

function layersFor(model: ModelKey): LayerSpec[] {
  const { solidus, liquidus } = surfacesFor(model);
  const base: SurfaceFn = () => 0;
  const top: SurfaceFn = () => TOP_Y;

  if (model === "isomorphous") {
    return [
      {
        id: "alpha-solid",
        name: "α 固相区",
        category: "single",
        color: 0xd97706,
        bottom: base,
        top: solidus,
        explode: "down",
      },
      {
        id: "liquid-alpha",
        name: "液相 + α 两相区",
        category: "two",
        color: 0x14b8a6,
        bottom: solidus,
        top: liquidus,
        explode: "center",
      },
      {
        id: "liquid",
        name: "液相区",
        category: "single",
        color: 0x1e3a8a,
        bottom: liquidus,
        top,
        explode: "up",
      },
    ];
  }

  if (model === "eutectic") {
    const invariantTop: SurfaceFn = (u, v, w) =>
      Math.min(liquidus(u, v, w), solidus(u, v, w) + 0.62);
    return [
      {
        id: "three-solids",
        name: "α / β / γ 固相区",
        category: "single",
        color: 0xc47b24,
        bottom: base,
        top: solidus,
        explode: "down",
      },
      {
        id: "eutectic-three",
        name: "L + α + β 三相区",
        category: "three",
        color: 0xf43f5e,
        bottom: solidus,
        top: invariantTop,
        explode: "center",
      },
      {
        id: "liquid-solids",
        name: "L + α / β / γ 两相区",
        category: "two",
        color: 0x0f9f91,
        bottom: invariantTop,
        top: liquidus,
        explode: "center",
      },
      {
        id: "liquid",
        name: "液相区",
        category: "single",
        color: 0x1e3a8a,
        bottom: liquidus,
        top,
        explode: "up",
      },
    ];
  }

  const solvus: SurfaceFn = (u, v, w) =>
    clampHeight(1.4 + 1.2 * (u * v + v * w + w * u));
  const invariantTop: SurfaceFn = (u, v, w) =>
    Math.min(liquidus(u, v, w), solidus(u, v, w) + 0.55);
  return [
    {
      id: "solid-solutions",
      name: "α / β / γ 固溶体",
      category: "single",
      color: 0xd97706,
      bottom: base,
      top: solvus,
      explode: "down",
    },
    {
      id: "solid-two",
      name: "α + β 固态两相区",
      category: "two",
      color: 0x4d9f4b,
      bottom: solvus,
      top: solidus,
      explode: "down",
    },
    {
      id: "limited-three",
      name: "L + α + β 三相区",
      category: "three",
      color: 0xf43f5e,
      bottom: solidus,
      top: invariantTop,
      explode: "center",
    },
    {
      id: "liquid-two",
      name: "L + α / β 两相区",
      category: "two",
      color: 0x14b8a6,
      bottom: invariantTop,
      top: liquidus,
      explode: "center",
    },
    {
      id: "liquid",
      name: "液相区",
      category: "single",
      color: 0x1e3a8a,
      bottom: liquidus,
      top,
      explode: "up",
    },
  ];
}

function createLayerGeometry(segments: number, bottom: SurfaceFn, top: SurfaceFn) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const indexMap = new Map<string, { bottom: number; top: number }>();
  let vertexCount = 0;

  for (let i = 0; i <= segments; i += 1) {
    for (let j = 0; j <= segments - i; j += 1) {
      const k = segments - i - j;
      const u = i / segments;
      const v = j / segments;
      const w = k / segments;
      const x = u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x;
      const z = u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z;
      vertices.push(x, bottom(u, v, w), z);
      const bottomIndex = vertexCount++;
      vertices.push(x, top(u, v, w), z);
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

  const closeSide = (p1: { bottom: number; top: number }, p2: { bottom: number; top: number }) => {
    indices.push(p1.bottom, p1.top, p2.top, p1.bottom, p2.top, p2.bottom);
  };

  for (let i = 0; i < segments; i += 1) {
    closeSide(indexMap.get(`${i}_0`)!, indexMap.get(`${i + 1}_0`)!);
    closeSide(
      indexMap.get(`${i}_${segments - i}`)!,
      indexMap.get(`${i + 1}_${segments - i - 1}`)!,
    );
    closeSide(indexMap.get(`0_${i + 1}`)!, indexMap.get(`0_${i}`)!);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeLayerMesh(spec: LayerSpec, plane: THREE.Plane) {
  const geometry = createLayerGeometry(28, spec.bottom, spec.top);
  const material = new THREE.MeshPhongMaterial({
    color: spec.color,
    shininess: 70,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
    clippingPlanes: [plane],
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    explode: spec.explode,
    targetY: 0,
  };

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 42),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.48,
      clippingPlanes: [plane],
    }),
  );
  edges.renderOrder = 3;
  mesh.add(edges);
  return mesh;
}

function makeFrame() {
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
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.24,
    }),
  );
}

function positionFromComposition(a: number, b: number, temperature: number) {
  const c = 100 - a - b;
  const u = a / 100;
  const v = b / 100;
  const w = c / 100;
  return new THREE.Vector3(
    u * A_VERTEX.x + v * B_VERTEX.x + w * C_VERTEX.x,
    (temperature / 100) * TOP_Y,
    u * A_VERTEX.z + v * B_VERTEX.z + w * C_VERTEX.z,
  );
}

function phaseAt(model: ModelKey, a: number, b: number, temperature: number): PhaseResult {
  const c = 100 - a - b;
  const u = a / 100;
  const v = b / 100;
  const w = c / 100;
  const y = (temperature / 100) * TOP_Y;
  const { solidus, liquidus } = surfacesFor(model);
  const low = solidus(u, v, w);
  const high = liquidus(u, v, w);

  if (model === "isomorphous") {
    if (y >= high) return { title: "完全液相", detail: "Liquid", meshId: "liquid" };
    if (y <= low) return { title: "完全固相", detail: "α", meshId: "alpha-solid" };
    return { title: "两相共存", detail: "Liquid + α", meshId: "liquid-alpha" };
  }

  if (y >= high) return { title: "完全液相", detail: "Liquid", meshId: "liquid" };
  if (y <= low) {
    return {
      title: model === "limited" ? "固态相区" : "三组元固相区",
      detail: model === "limited" ? "α / β / γ 固溶体" : "α / β / γ",
      meshId: model === "limited" ? "solid-solutions" : "three-solids",
    };
  }
  if (y <= low + 0.65) {
    return {
      title: "三相平衡",
      detail: "Liquid + α + β",
      meshId: model === "limited" ? "limited-three" : "eutectic-three",
    };
  }
  return {
    title: "两相共存",
    detail: "Liquid + α / β",
    meshId: model === "limited" ? "liquid-two" : "liquid-solids",
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry?.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    }
  });
}

export default function TernaryLab() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  const modelRef = useRef<ModelKey>("isomorphous");
  const filterRef = useRef<Record<PhaseCategory, boolean>>({
    single: true,
    two: true,
    three: true,
  });
  const selectedIdRef = useRef<string | null>(null);

  const [model, setModel] = useState<ModelKey>("isomorphous");
  const [temperature, setTemperature] = useState(100);
  const [exploded, setExploded] = useState(false);
  const [filters, setFilters] = useState<Record<PhaseCategory, boolean>>({
    single: true,
    two: true,
    three: true,
  });
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [composition, setComposition] = useState({ a: 30, b: 40, t: 50 });
  const [analysis, setAnalysis] = useState<
    | { error: string }
    | { c: number; phase: PhaseResult; a: number; b: number; t: number }
    | null
  >(null);

  const meta = MODEL_META[model];
  const sliceStatus = useMemo(
    () => phaseAt(model, 33.33, 33.33, temperature),
    [model, temperature],
  );

  function applyHighlight(meshId: string | null) {
    const api = sceneApi.current;
    if (!api) return;
    selectedIdRef.current = meshId;
    api.meshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshPhongMaterial;
      const edge = mesh.children[0] as THREE.LineSegments;
      const edgeMaterial = edge.material as THREE.LineBasicMaterial;
      if (!meshId) {
        material.opacity = 0.38;
        edgeMaterial.opacity = 0.48;
      } else if (mesh.userData.id === meshId) {
        material.opacity = 0.88;
        edgeMaterial.opacity = 1;
      } else {
        material.opacity = 0.055;
        edgeMaterial.opacity = 0.12;
      }
    });
  }

  function clearAnalysis() {
    const api = sceneApi.current;
    if (api) {
      api.point.visible = false;
      api.controls.target.set(0, 6.2, 0);
    }
    setAnalysis(null);
    setSelectedPhase(null);
    applyHighlight(null);
  }

  function plotComposition() {
    const a = Number(composition.a);
    const b = Number(composition.b);
    const t = Math.max(0, Math.min(100, Number(composition.t)));
    const c = 100 - a - b;

    if (![a, b, t].every(Number.isFinite) || a < 0 || b < 0 || c < 0) {
      setAnalysis({ error: "成分无效：A、B 需为非负数，且 A + B 不能超过 100%。" });
      return;
    }

    const phase = phaseAt(model, a, b, t);
    const api = sceneApi.current;
    if (api) {
      const position = positionFromComposition(a, b, t);
      api.point.position.copy(position);
      api.point.visible = true;
      api.controls.target.copy(position);
    }
    applyHighlight(phase.meshId);
    setSelectedPhase(phase.title);
    setAnalysis({ c, phase, a, b, t });
  }

  function resetView() {
    const api = sceneApi.current;
    if (!api) return;
    api.camera.position.set(24, 18, 28);
    api.controls.target.set(0, 6.2, 0);
    setTemperature(100);
    setExploded(false);
    setFilters({ single: true, two: true, three: true });
    filterRef.current = { single: true, two: true, three: true };
    api.point.visible = false;
    setAnalysis(null);
    setSelectedPhase(null);
    applyHighlight(null);
  }

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0f172a, 0.018);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / host.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(24, 18, 28);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 6.2, 0);
    controls.minDistance = 15;
    controls.maxDistance = 62;

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x111827, 1.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(18, 26, 14);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    rimLight.position.set(-16, 10, -20);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(20, 64),
      new THREE.MeshBasicMaterial({
        color: 0x172033,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.16;
    scene.add(floor);

    const slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), TOP_Y);
    const group = new THREE.Group();
    scene.add(group);

    const frame = makeFrame();
    scene.add(frame);

    const sliceGeometry = new THREE.BufferGeometry();
    sliceGeometry.setAttribute(
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
    const slice = new THREE.Mesh(
      sliceGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    slice.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(sliceGeometry),
        new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.95 }),
      ),
    );
    slice.position.y = TOP_Y;
    slice.visible = false;
    scene.add(slice);

    const point = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe600, depthTest: false }),
    );
    point.visible = false;
    point.renderOrder = 999;
    scene.add(point);

    const api: SceneApi = {
      camera,
      controls,
      frame,
      group,
      meshes: [],
      point,
      renderer,
      slice,
      slicePlane,
      model: "isomorphous",
    };
    sceneApi.current = api;

    function rebuild(nextModel: ModelKey) {
      api.meshes.forEach((mesh) => {
        api.group.remove(mesh);
        disposeObject(mesh);
      });
      api.meshes = layersFor(nextModel).map((spec) => {
        const mesh = makeLayerMesh(spec, slicePlane);
        api.group.add(mesh);
        return mesh;
      });
      api.model = nextModel;
      api.point.visible = false;
      applyHighlight(null);
    }

    rebuild(modelRef.current);

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
      const visibleMeshes = api.meshes.filter((mesh) => mesh.visible);
      const hit = raycaster.intersectObjects(visibleMeshes, false)[0]?.object as
        | THREE.Mesh
        | undefined;
      if (!hit) {
        setSelectedPhase(null);
        applyHighlight(null);
        return;
      }
      setSelectedPhase(hit.userData.name);
      applyHighlight(hit.userData.id);
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(host);

    let animationFrame = 0;
    function animate() {
      animationFrame = requestAnimationFrame(animate);
      api.meshes.forEach((mesh) => {
        mesh.position.y += (Number(mesh.userData.targetY ?? 0) - mesh.position.y) * 0.09;
      });
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    (sceneApi.current as SceneApi & { rebuild?: (next: ModelKey) => void }).rebuild = rebuild;

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      scene.traverse(disposeObject);
      renderer.dispose();
      renderer.domElement.remove();
      sceneApi.current = null;
    };
  }, []);

  useEffect(() => {
    modelRef.current = model;
    const api = sceneApi.current as (SceneApi & { rebuild?: (next: ModelKey) => void }) | null;
    api?.rebuild?.(model);
    setSelectedPhase(null);
    setAnalysis(null);
    setExploded(false);
  }, [model]);

  useEffect(() => {
    const api = sceneApi.current;
    if (!api) return;
    const y = (temperature / 100) * TOP_Y;
    api.slicePlane.constant = y;
    api.slice.position.y = y;
    api.slice.visible = temperature < 100 && !exploded;
  }, [temperature, exploded]);

  useEffect(() => {
    const api = sceneApi.current;
    if (!api) return;
    api.renderer.localClippingEnabled = !exploded;
    api.frame.visible = !exploded;
    api.slice.visible = !exploded && temperature < 100;
    api.meshes.forEach((mesh) => {
      const direction = mesh.userData.explode as "up" | "down" | "center";
      mesh.userData.targetY = exploded ? (direction === "up" ? 2.8 : direction === "down" ? -2.8 : 0) : 0;
    });
  }, [exploded, temperature]);

  useEffect(() => {
    filterRef.current = filters;
    const api = sceneApi.current;
    if (!api) return;
    api.meshes.forEach((mesh) => {
      mesh.visible = filters[mesh.userData.category as PhaseCategory];
    });
  }, [filters]);

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <img src={brandLogo} alt="" />
          </div>
          <div>
            <h1>材科基 · 三元相图3D可视化实验室</h1>
            <div className="brand-subtitle">Materials Fundamentals Ternary Phase Lab</div>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail panel-stack">
          <section className="panel phase-selection-panel">
            <div className="panel-heading simple-heading">
              <h2>相图类型</h2>
            </div>
            <div className="phase-option-list" role="group" aria-label="相图类型">
              {(Object.keys(MODEL_META) as ModelKey[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className={model === key ? "phase-option active" : "phase-option"}
                  onClick={() => setModel(key)}
                  aria-pressed={model === key}
                >
                  <span className="phase-option-icon" aria-hidden="true">△</span>
                  <span>{MODEL_META[key].title}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel control-panel">
            <div className="panel-heading simple-heading">
              <h2>教学控制台</h2>
            </div>

          <div className="control-section">
            <div className="control-label">
              <div>
                <span className="accent-line cyan" />
                等温截面
              </div>
              <strong>{temperature}%</strong>
            </div>
            <input
              className="range"
              type="range"
              min="0"
              max="100"
              step="1"
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              aria-label="等温截面高度"
            />
            <div className="range-scale">
              <span>0% · 低温</span>
              <span>100% · 高温</span>
            </div>
            <p className="helper">
              拖动切开三维相区，青色激光面对应当前二维等温截面。
            </p>
          </div>

          <button
            className={exploded ? "explode-button active" : "explode-button"}
            onClick={() => setExploded((value) => !value)}
          >
            <span className="button-icon" aria-hidden="true">
              ↕
            </span>
            <span>
              <strong>{exploded ? "复原视图" : "爆炸视图"}</strong>
              <small>{exploded ? "重新合并各相区" : "拆解上下相区结构"}</small>
            </span>
            <span className="button-state">{exploded ? "ON" : "OFF"}</span>
          </button>

          <div className="divider" />

          <div className="control-section composition-section">
            <div className="control-label">
              <div>
                <span className="accent-line green" />
                成分点分析
              </div>
              <span className="formula">A + B + C = 100%</span>
            </div>

            <div className="input-grid">
              {(["a", "b", "t"] as const).map((field) => (
                <label key={field}>
                  <span>{field === "t" ? "温度" : field.toUpperCase()} (%)</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={composition[field]}
                    onChange={(event) =>
                      setComposition((current) => ({
                        ...current,
                        [field]: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <div className="computed-row">
              <span>自动计算 C</span>
              <strong>{Math.max(0, 100 - composition.a - composition.b).toFixed(1)}%</strong>
            </div>

            <div className="button-row">
              <button className="primary-button" onClick={plotComposition}>
                <span aria-hidden="true">＋</span> 生成探测点
              </button>
              <button
                className="ghost-button"
                onClick={clearAnalysis}
                disabled={!analysis}
              >
                清除
              </button>
            </div>

            {analysis && (
              <div className={analysis && "error" in analysis ? "analysis-card error" : "analysis-card"}>
                {"error" in analysis ? (
                  <p>{analysis.error}</p>
                ) : (
                  <>
                    <div className="analysis-title">
                      <span className="probe-dot" />
                      <div>
                        <small>理论区域判断</small>
                        <strong>{analysis.phase.title}</strong>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>成分坐标</dt>
                        <dd>
                          A {analysis.a}% · B {analysis.b}% · C {analysis.c.toFixed(1)}%
                        </dd>
                      </div>
                      <div>
                        <dt>相组成</dt>
                        <dd>{analysis.phase.detail}</dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>
            )}
          </div>
          </section>
        </aside>

        <section className="viewport" aria-label="三元相图三维交互视图">
          <div className="viewport-title">
            <div className="viewport-title-row">
              <img src={brandLogo} alt="" />
              <div>
                <h2>{meta.title}</h2>
                <p>{meta.subtitle}</p>
              </div>
            </div>
          </div>

          <div className="view-badge">
            <span className="view-dot" />
            透视模式
          </div>

          <div ref={canvasHost} className="canvas-host" />

          <div className="axis-label label-a">A</div>
          <div className="axis-label label-b">B</div>
          <div className="axis-label label-c">C</div>
          <div className="temperature-axis">
            <span>温度</span>
            <i />
            <b>↑</b>
          </div>

          <div className="phase-legend">
            <span>
              <i className="legend-swatch liquid" /> 液相
            </span>
            <span>
              <i className="legend-swatch two" /> 两相
            </span>
            <span>
              <i className="legend-swatch solid" /> 固相
            </span>
            {model !== "isomorphous" && (
              <span>
                <i className="legend-swatch three" /> 三相
              </span>
            )}
          </div>

          <div className="interaction-hints" aria-label="视图操作说明">
            <span>
              <kbd>左键</kbd> 旋转
            </span>
            <span>
              <kbd>滚轮</kbd> 缩放
            </span>
            <span>
              <kbd>右键</kbd> 平移
            </span>
            <span>
              <kbd>点击相区</kbd> 高亮
            </span>
          </div>
        </section>

        <aside className="right-rail panel-stack info-panel">
          <section className="panel status-panel">
            <div className="card-title">当前温度状态</div>
            <div className="status-card">
            <div className="status-icon" aria-hidden="true">
              ◇
            </div>
            <small>当前相区判断</small>
            <strong>{selectedPhase ?? sliceStatus.title}</strong>
            <p>{selectedPhase ? "已选中相区，点击空白处可取消高亮。" : sliceStatus.detail}</p>
            </div>
          </section>

          <section className="panel filter-section">
            <div className="card-title">相区可见性选择</div>
            <div className="filter-list">
              {(Object.keys(CATEGORY_LABELS) as PhaseCategory[]).map((category) => (
                <label key={category} className="filter-row">
                  <input
                    type="checkbox"
                    checked={filters[category]}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        [category]: event.target.checked,
                      }))
                    }
                  />
                  <span className={`filter-indicator ${category}`} />
                  <span>
                    <strong>{CATEGORY_LABELS[category]}</strong>
                    <small>
                      {category === "single"
                        ? "Liquid / α / β / γ"
                        : category === "two"
                          ? "L + α / α + β"
                          : "L + α + β"}
                    </small>
                  </span>
                  <b>{filters[category] ? "显示" : "隐藏"}</b>
                </label>
              ))}
            </div>
          </section>

          <section className="panel teaching-note">
            <div className="card-title">教学解析</div>
            <p>{meta.note}</p>
          </section>

          <section className="panel reset-panel">
            <button className="reset-button" onClick={resetView}>
              <span aria-hidden="true">↻</span>
              重置视角与状态
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}
