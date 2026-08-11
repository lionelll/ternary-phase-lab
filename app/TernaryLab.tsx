"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brandLogo } from "./brandLogo";
import { HomeIcon, TopViewIcon } from "./Icons";
import {
  type ModelKey,
  type PhaseCategory,
  type PhaseResult,
  layersFor,
  phaseAt,
  phasePathAtComposition,
  positionFromComposition,
} from "./three/phaseGeometry";
import {
  type PhaseSceneController,
  type VerticalSectionMode,
  type VertexLabelPositions,
  createPhaseScene,
} from "./three/phaseScene";

const MODEL_META: Record<
  ModelKey,
  { short: string; title: string }
> = {
  isomorphous: {
    short: "三元匀晶",
    title: "三元匀晶相图",
  },
  eutectic: {
    short: "不互溶共晶",
    title: "固态不互溶的三元共晶相图",
  },
  limited: {
    short: "有限互溶共晶",
    title: "固态有限互溶的三元共晶相图",
  },
};

const CATEGORY_LABELS: Record<PhaseCategory, string> = {
  single: "单相区",
  two: "两相区",
  three: "三相区",
  four: "四相区",
};

const ALL_VISIBLE: Record<PhaseCategory, boolean> = {
  single: true,
  two: true,
  three: true,
  four: true,
};

/** 当前所选相区名称的提示色。 */
const STATUS_ACCENT = {
  liquid: "#93c5fd",
  twoPhase: "#67e8f9",
  solid: "#fde68a",
  four: "#fde047",
} as const;

const EMPTY_VERTEX_LABELS: VertexLabelPositions = {
  A: { x: 0, y: 0, visible: false },
  B: { x: 0, y: 0, visible: false },
  C: { x: 0, y: 0, visible: false },
};

const DEFAULT_VERTICAL_POINTS = {
  p1: { a: 70, b: 20 },
  p2: { a: 20, b: 70 },
} as const;

function visibilityForModel(model: ModelKey) {
  return Object.fromEntries(layersFor(model).map((phase) => [phase.id, true]));
}

function displayPhaseName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** 匀晶与完全不互溶模型的组元在右侧相区列表中使用 A / B / C 表示。 */
function displayPhaseListName(name: string, model: ModelKey) {
  const displayName = displayPhaseName(name);
  if (model === "limited") return displayName;
  return displayName
    .replaceAll("α", "A")
    .replaceAll("β", "B")
    .replaceAll("γ", "C");
}

export default function TernaryLab() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneController = useRef<PhaseSceneController | null>(null);

  const [model, setModel] = useState<ModelKey>("isomorphous");
  const [temperature, setTemperature] = useState(100);
  const [exploded, setExploded] = useState(false);
  const [phaseMenuOpen, setPhaseMenuOpen] = useState(true);
  const [functionMenuOpen, setFunctionMenuOpen] = useState(true);
  const [filters, setFilters] = useState<Record<PhaseCategory, boolean>>(ALL_VISIBLE);
  const [phaseVisibility, setPhaseVisibility] = useState<Record<string, boolean>>(
    () => visibilityForModel("isomorphous"),
  );
  const [vertexLabels, setVertexLabels] =
    useState<VertexLabelPositions>(EMPTY_VERTEX_LABELS);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [composition, setComposition] = useState({ a: 30, b: 40 });
  const [analysis, setAnalysis] = useState<
    | { error: string }
    | { c: number; path: PhaseResult[]; a: number; b: number }
    | null
  >(null);
  const [verticalPoints, setVerticalPoints] = useState(() => ({
    p1: { ...DEFAULT_VERTICAL_POINTS.p1 },
    p2: { ...DEFAULT_VERTICAL_POINTS.p2 },
  }));
  const [verticalMode, setVerticalMode] =
    useState<VerticalSectionMode>("holographic");
  const [verticalSectionStatus, setVerticalSectionStatus] = useState<
    | { error: string }
    | { active: true }
    | null
  >(null);

  const meta = MODEL_META[model];
  const phaseSpecs = useMemo(() => layersFor(model), [model]);
  const sliceStatus = useMemo(
    () => phaseAt(model, 100 / 3, 100 / 3, temperature),
    [model, temperature],
  );

  /** 当前相区名的取色，取值与 demo 的 updatePhaseTextByTemp 一致。 */
  const statusAccent = useMemo(() => {
    const category = selectedPhase
      ? phaseSpecs.find((phase) => phase.name === selectedPhase)?.category
      : phaseSpecs.find((phase) => phase.id === sliceStatus.meshId)?.category;
    const id = selectedPhase
      ? phaseSpecs.find((phase) => phase.name === selectedPhase)?.id
      : sliceStatus.meshId;
    if (id === "liquid") return STATUS_ACCENT.liquid;
    if (category === "four") return STATUS_ACCENT.four;
    if (category === "two" || category === "three") return STATUS_ACCENT.twoPhase;
    return STATUS_ACCENT.solid;
  }, [phaseSpecs, selectedPhase, sliceStatus.meshId]);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    const controller = createPhaseScene({
      host,
      initialModel: "isomorphous",
      onPhaseSelect(selection) {
        setSelectedPhase(selection?.name ?? null);
      },
      onVertexLabels: setVertexLabels,
    });
    sceneController.current = controller;
    controller.setFilters(ALL_VISIBLE);
    controller.setPhaseVisibility(visibilityForModel("isomorphous"));
    controller.setTemperature(100, false);
    return () => {
      controller.dispose();
      sceneController.current = null;
    };
  }, []);

  useEffect(() => {
    sceneController.current?.setTemperature(temperature, exploded);
  }, [temperature, exploded]);

  useEffect(() => {
    sceneController.current?.setExploded(exploded, temperature);
  }, [exploded, temperature]);

  useEffect(() => {
    sceneController.current?.setFilters(filters);
  }, [filters]);

  useEffect(() => {
    sceneController.current?.setPhaseVisibility(phaseVisibility);
  }, [phaseVisibility]);

  function applyHighlight(phaseId: string | null) {
    sceneController.current?.setHighlight(phaseId);
  }

  function changeModel(nextModel: ModelKey) {
    if (nextModel === model) return;
    const controller = sceneController.current;
    controller?.rebuild(nextModel);
    controller?.setFilters(filters);
    const nextVisibility = visibilityForModel(nextModel);
    controller?.setPhaseVisibility(nextVisibility);
    controller?.setTemperature(temperature, false);
    controller?.setExploded(false, temperature);
    controller?.clearCompositionPath();
    setModel(nextModel);
    setSelectedPhase(null);
    setAnalysis(null);
    setExploded(false);
    setPhaseVisibility(nextVisibility);
  }

  function clearAnalysis() {
    sceneController.current?.clearCompositionPath();
    setAnalysis(null);
    setSelectedPhase(null);
    applyHighlight(null);
  }

  function plotComposition() {
    const a = Number(composition.a);
    const b = Number(composition.b);
    const c = 100 - a - b;

    if (
      ![a, b].every(Number.isFinite) ||
      a < 0 ||
      b < 0 ||
      c < 0
    ) {
      sceneController.current?.clearCompositionPath();
      applyHighlight(null);
      setSelectedPhase(null);
      setAnalysis({
        error:
          "输入无效：A、B 需为非负数且 A + B ≤ 100%。",
      });
      return;
    }

    const path = phasePathAtComposition(model, a, b);
    sceneController.current?.setCompositionPath(
      positionFromComposition(a, b, 0),
      [
        ...path.map((phase) => phase.meshId),
        ...(model === "isomorphous" ? [] : [`${model}-four-phase-plane`]),
      ],
    );
    setSelectedPhase(null);
    setAnalysis({ c, path, a, b });
  }

  function clearVerticalSection() {
    sceneController.current?.clearVerticalSection();
    setVerticalSectionStatus(null);
  }

  function changeVerticalMode(nextMode: VerticalSectionMode) {
    setVerticalMode(nextMode);
    sceneController.current?.setVerticalSectionMode(nextMode);
  }

  function generateVerticalSection() {
    const first = verticalPoints.p1;
    const second = verticalPoints.p2;
    const firstC = 100 - first.a - first.b;
    const secondC = 100 - second.a - second.b;
    const valid = [first.a, first.b, firstC, second.a, second.b, secondC]
      .every((value) => Number.isFinite(value) && value >= 0);

    if (!valid) {
      sceneController.current?.clearVerticalSection();
      setVerticalSectionStatus({
        error: "输入无效：两个点的 A、B 均需非负，且 A + B ≤ 100%。",
      });
      return;
    }
    if (
      Math.abs(first.a - second.a) < 1e-7 &&
      Math.abs(first.b - second.b) < 1e-7
    ) {
      sceneController.current?.clearVerticalSection();
      setVerticalSectionStatus({ error: "点 1 与点 2 不能重合。" });
      return;
    }

    const controller = sceneController.current;
    if (exploded) {
      controller?.setExploded(false, temperature);
      setExploded(false);
    }
    controller?.setVerticalSection(
      positionFromComposition(first.a, first.b, 0),
      positionFromComposition(second.a, second.b, 0),
      verticalMode,
    );
    setVerticalSectionStatus({ active: true });
  }

  /** 一次性把相机、截面、相图拆解、相区可见性与凝固路径全部恢复到初始状态。 */
  function resetAll() {
    const nextFilters = { ...ALL_VISIBLE };
    const nextVisibility = visibilityForModel(model);
    const controller = sceneController.current;
    controller?.resetView();
    controller?.setTemperature(100, false);
    controller?.setExploded(false, 100);
    controller?.setFilters(nextFilters);
    controller?.setPhaseVisibility(nextVisibility);
    controller?.clearCompositionPath();
    controller?.clearVerticalSection();
    setTemperature(100);
    setExploded(false);
    setFilters(nextFilters);
    setPhaseVisibility(nextVisibility);
    setAnalysis(null);
    setVerticalPoints({
      p1: { ...DEFAULT_VERTICAL_POINTS.p1 },
      p2: { ...DEFAULT_VERTICAL_POINTS.p2 },
    });
    setVerticalMode("holographic");
    setVerticalSectionStatus(null);
    setSelectedPhase(null);
  }

  const computedC = 100 - composition.a - composition.b;
  const verticalC1 = 100 - verticalPoints.p1.a - verticalPoints.p1.b;
  const verticalC2 = 100 - verticalPoints.p2.a - verticalPoints.p2.b;

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <img src={brandLogo} alt="" />
          </div>
          <div>
            <h1>材科基 · 三元相图3D可视化实验室</h1>
            <span className="brand-subtitle">畅研材料考研交流群：692990403</span>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="top-action-button"
            type="button"
            onClick={() => sceneController.current?.setTopView()}
            title="从正上方观察当前等温截面"
          >
            <TopViewIcon />
            <span>俯视视角</span>
          </button>
          <button
            className="top-action-button"
            type="button"
            onClick={resetAll}
            title="恢复相机视角、水平/垂直截面、相图拆解与相区可见性"
          >
            <HomeIcon />
            <span>重置全部</span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail panel-stack">
          <section className={`panel phase-selection-panel collapsible-panel ${phaseMenuOpen ? "" : "collapsed"}`}>
            <button
              type="button"
              className="panel-heading simple-heading menu-heading"
              onClick={() => setPhaseMenuOpen((open) => !open)}
              aria-expanded={phaseMenuOpen}
            >
              <h2>相图类型</h2>
              <span className="menu-chevron" aria-hidden="true">⌄</span>
            </button>
            <div className="phase-option-list collapsible-content" role="group" aria-label="相图类型">
              {(Object.keys(MODEL_META) as ModelKey[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className={model === key ? "phase-option active" : "phase-option"}
                  onClick={() => changeModel(key)}
                  aria-pressed={model === key}
                >
                  <span className="phase-option-icon" aria-hidden="true">△</span>
                  <span>{MODEL_META[key].title}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={`panel control-panel collapsible-panel ${functionMenuOpen ? "" : "collapsed"}`}>
            <button
              type="button"
              className="panel-heading simple-heading menu-heading"
              onClick={() => setFunctionMenuOpen((open) => !open)}
              aria-expanded={functionMenuOpen}
            >
              <h2>功能模块</h2>
              <span className="menu-chevron" aria-hidden="true">⌄</span>
            </button>

            <div className="collapsible-content control-content">
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

              <div className="divider" />

              <div className="control-section vertical-section-control">
                <div className="control-label">
                  <div>
                    <span className="accent-line violet" />
                    垂直截面分析
                  </div>
                  <span className="formula">P1 — P2</span>
                </div>

                <div className="vertical-point-list">
                  {(["p1", "p2"] as const).map((pointKey, pointIndex) => {
                    const point = verticalPoints[pointKey];
                    const c = pointKey === "p1" ? verticalC1 : verticalC2;
                    return (
                      <div className="vertical-point-card" key={pointKey}>
                        <div className="vertical-point-heading">
                          <strong>点 {pointIndex + 1}</strong>
                          <span className={c < 0 ? "invalid-value" : undefined}>
                            C {c < 0 ? "无效" : `${c.toFixed(1)}%`}
                          </span>
                        </div>
                        <div className="input-grid vertical-point-inputs">
                          {(["a", "b"] as const).map((field) => (
                            <label key={field}>
                              <span>{field.toUpperCase()} (%)</span>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={point[field]}
                                onChange={(event) =>
                                  setVerticalPoints((current) => ({
                                    ...current,
                                    [pointKey]: {
                                      ...current[pointKey],
                                      [field]: Number(event.target.value),
                                    },
                                  }))
                                }
                                aria-label={`点 ${pointIndex + 1} ${field.toUpperCase()} (%)`}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="vertical-mode-toggle"
                  role="group"
                  aria-label="垂直截面显示模式"
                >
                  <button
                    type="button"
                    className={verticalMode === "clip" ? "active" : undefined}
                    aria-pressed={verticalMode === "clip"}
                    onClick={() => changeVerticalMode("clip")}
                  >
                    垂直剖切模式
                  </button>
                  <button
                    type="button"
                    className={verticalMode === "holographic" ? "active" : undefined}
                    aria-pressed={verticalMode === "holographic"}
                    onClick={() => changeVerticalMode("holographic")}
                  >
                    全息透视模式
                  </button>
                </div>

                <div className="button-row vertical-section-buttons">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={generateVerticalSection}
                  >
                    <span aria-hidden="true">╱</span> 生成垂直截面
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={clearVerticalSection}
                    disabled={!verticalSectionStatus}
                  >
                    清除
                  </button>
                </div>

                {verticalSectionStatus && (
                  <div
                    className={
                      "error" in verticalSectionStatus
                        ? "analysis-card error"
                        : "vertical-section-ready"
                    }
                  >
                    {"error" in verticalSectionStatus ? (
                      <p>{verticalSectionStatus.error}</p>
                    ) : (
                      <>
                        <strong>截面已生成</strong>
                        <span>黄色高亮线为切面截出的全部相界线</span>
                      </>
                    )}
                  </div>
                )}

                <p className="helper">
                  选择两个成分点生成垂直激光切面；生成截面时会自动复原拆解状态。
                </p>
              </div>

              <div className="divider" />

              <div className="control-section decomposition-section">
                <div className="control-label">
                  <div>
                    <span className="accent-line amber" />
                    相图拆解
                  </div>
                </div>
                <button
                  type="button"
                  className={exploded ? "explode-button active" : "explode-button"}
                  onClick={() => setExploded((value) => !value)}
                  aria-pressed={exploded}
                >
                  <span className="button-icon" aria-hidden="true">✣</span>
                  <span>
                    <strong>{exploded ? "复原相图" : "开始拆解"}</strong>
                    <small>{exploded ? "重新合并各相区" : "沿三维空间拆分各相区"}</small>
                  </span>
                  <span className="button-state">{exploded ? "ON" : "OFF"}</span>
                </button>
              </div>

              <div className="divider" />

              <div className="control-section">
                <div className="control-label">
                  <div>
                    <span className="accent-line green" />
                    合金凝固过程中的相区展示
                  </div>
                  <span className="formula">A + B + C = 100%</span>
                </div>

                <div className="input-grid composition-grid">
                  {(["a", "b"] as const).map((field) => (
                  <label key={field}>
                    <span>{field.toUpperCase()} (%)</span>
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
                <strong className={computedC < 0 ? "invalid-value" : undefined}>
                  {computedC < 0 ? "无效（A + B > 100%）" : `${computedC.toFixed(1)}%`}
                </strong>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={plotComposition}
                >
                  <span aria-hidden="true">│</span> 确认
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={clearAnalysis}
                  disabled={!analysis && !selectedPhase}
                >
                  清除
                </button>
              </div>

              {analysis && (
                <div className={"error" in analysis ? "analysis-card error" : "analysis-card"}>
                  {"error" in analysis ? (
                    <p>{analysis.error}</p>
                  ) : (
                    <>
                      <div className="analysis-title">
                        <span className="probe-dot" />
                        <div>
                          <small>由高温到低温</small>
                          <strong>凝固路径穿过 {analysis.path.length} 个相区</strong>
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
                          <dt>相区路径</dt>
                          <dd>{analysis.path.map((phase) => displayPhaseName(phase.title)).join(" → ")}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                </div>
              )}
              </div>
            </div>
          </section>
        </aside>

        <section className="viewport" aria-label="三元相图三维交互视图">
          <div className="viewport-title">
            <div className="viewport-title-row">
              <img src={brandLogo} alt="" />
              <div>
                <h2>{meta.title}</h2>
              </div>
            </div>
          </div>

          <div className="view-badge">
            <span className="view-dot" />
            透视模式
          </div>

          <div ref={canvasHost} className="canvas-host" />

          {(["A", "B", "C"] as const).map((label) => (
            <div
              key={label}
              className="axis-label"
              style={{
                left: vertexLabels[label].x,
                top: vertexLabels[label].y,
                opacity: vertexLabels[label].visible ? 1 : 0,
              }}
            >
              {label}
            </div>
          ))}
          <div className="temperature-axis">
            <span>温度</span>
            <i />
            <b>↑</b>
          </div>

          <div className="phase-legend">
            <span><i className="legend-swatch liquid" /> 液相</span>
            <span><i className="legend-swatch two" /> 两相</span>
            <span><i className="legend-swatch solid" /> 固相</span>
            <span><i className="legend-swatch three" /> 三相</span>
            {model !== "isomorphous" && (
              <span><i className="legend-swatch four" /> 四相面</span>
            )}
          </div>

          <div className="interaction-hints" aria-label="视图操作说明">
            <span><kbd>左键</kbd> 旋转</span>
            <span><kbd>滚轮</kbd> 缩放</span>
            <span><kbd>右键</kbd> 平移</span>
            <span><kbd>点击相区</kbd> 高亮</span>
          </div>
        </section>

        <aside className="right-rail panel-stack info-panel">
          <section className="panel status-panel">
            <div className="card-title">当前所选相区</div>
            <div className="status-card">
              <strong style={{ color: statusAccent }}>
                {displayPhaseName(selectedPhase ?? sliceStatus.title)}
              </strong>
              <p>点击空白处可取消高亮</p>
            </div>
          </section>

          <section className="panel filter-section">
            <div className="card-title">相区</div>
            <div className="filter-list">
              {/* 主列表：与 demo 一致，按相区逐个勾选，色点用该相区的实际配色。 */}
              <div className="phase-visibility-list">
                {/* demo 的列表顺序是液相→两相→固相（高温到低温），layersFor 是自下而上，故倒序。 */}
                {[...phaseSpecs].reverse().map((phase) => (
                  <label key={phase.id} className="phase-visibility-row">
                    <input
                      type="checkbox"
                      checked={phaseVisibility[phase.id] !== false}
                      disabled={!filters[phase.category]}
                      onChange={(event) =>
                        setPhaseVisibility((current) => ({
                          ...current,
                          [phase.id]: event.target.checked,
                        }))
                      }
                    />
                    <span
                      className="phase-swatch"
                      style={{ background: `#${phase.color.toString(16).padStart(6, "0")}` }}
                    />
                    <span>{displayPhaseListName(phase.name, model)}</span>
                  </label>
                ))}
              </div>

              {/* 次级：PRD 四.3 要求的按类别批量隐藏，demo 没有这一层，放在下面不抢主次。 */}
              <div className="phase-visibility-heading">按类别批量显示 / 隐藏</div>
              {(Object.keys(CATEGORY_LABELS) as PhaseCategory[]).map((category) => {
                const hasCategory = phaseSpecs.some((phase) => phase.category === category);
                if (model === "isomorphous" && category === "four") return null;
                return (
                  <label key={category} className="filter-row">
                    <input
                      type="checkbox"
                      checked={filters[category]}
                      disabled={!hasCategory}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          [category]: event.target.checked,
                        }))
                      }
                    />
                    <strong>{CATEGORY_LABELS[category]}</strong>
                    <b>{hasCategory ? (filters[category] ? "显示" : "隐藏") : "—"}</b>
                  </label>
                );
              })}
            </div>
          </section>

        </aside>
      </section>
    </main>
  );
}
