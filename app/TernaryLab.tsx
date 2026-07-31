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
  positionFromComposition,
} from "./three/phaseGeometry";
import {
  type PhaseSceneController,
  type VertexLabelPositions,
  createPhaseScene,
} from "./three/phaseScene";

const MODEL_META: Record<
  ModelKey,
  { short: string; title: string; note: string }
> = {
  isomorphous: {
    short: "三元匀晶",
    title: "三元匀晶相图",
    note: "观察液相、L + α 两相区与 α 固相区如何随温度连续过渡。",
  },
  eutectic: {
    short: "不互溶共晶",
    title: "固态不互溶的三元共晶相图",
    note: "液相面向三元共晶点收敛，低温三相区形成清晰的水平反应层。",
  },
  limited: {
    short: "有限互溶共晶",
    title: "固态有限互溶的三元共晶相图",
    note: "在共晶骨架上加入固态溶解度边界，比较 α + β 两相区的空间变化。",
  },
};

const CATEGORY_LABELS: Record<PhaseCategory, string> = {
  single: "单相区",
  two: "两相区",
  three: "三相区",
};

const ALL_VISIBLE: Record<PhaseCategory, boolean> = {
  single: true,
  two: true,
  three: true,
};

/** 当前温度状态里相区名的取色，取自 demo 的 updatePhaseTextByTemp。 */
const STATUS_ACCENT = {
  liquid: "#93c5fd",
  twoPhase: "#5eead4",
  solid: "#fcd34d",
} as const;

const EMPTY_VERTEX_LABELS: VertexLabelPositions = {
  A: { x: 0, y: 0, visible: false },
  B: { x: 0, y: 0, visible: false },
  C: { x: 0, y: 0, visible: false },
};

function visibilityForModel(model: ModelKey) {
  return Object.fromEntries(layersFor(model).map((phase) => [phase.id, true]));
}

function categoryDescription(model: ModelKey, category: PhaseCategory) {
  const phases = layersFor(model).filter((phase) => phase.category === category);
  if (phases.length === 0) return "本模型无此类相区";
  return phases.map((phase) => phase.name.replace(/区$/, "")).join(" / ");
}

export default function TernaryLab() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneController = useRef<PhaseSceneController | null>(null);

  const [model, setModel] = useState<ModelKey>("isomorphous");
  const [temperature, setTemperature] = useState(100);
  const [exploded, setExploded] = useState(false);
  const [filters, setFilters] = useState<Record<PhaseCategory, boolean>>(ALL_VISIBLE);
  const [phaseVisibility, setPhaseVisibility] = useState<Record<string, boolean>>(
    () => visibilityForModel("isomorphous"),
  );
  const [vertexLabels, setVertexLabels] =
    useState<VertexLabelPositions>(EMPTY_VERTEX_LABELS);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [composition, setComposition] = useState({ a: 30, b: 40, t: 50 });
  const [analysis, setAnalysis] = useState<
    | { error: string }
    | { c: number; phase: PhaseResult; a: number; b: number; t: number }
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
    setModel(nextModel);
    setSelectedPhase(null);
    setAnalysis(null);
    setExploded(false);
    setPhaseVisibility(nextVisibility);
  }

  function clearAnalysis() {
    sceneController.current?.clearPoint();
    setAnalysis(null);
    setSelectedPhase(null);
    applyHighlight(null);
  }

  function plotComposition() {
    const a = Number(composition.a);
    const b = Number(composition.b);
    const t = Number(composition.t);
    const c = 100 - a - b;

    if (
      ![a, b, t].every(Number.isFinite) ||
      a < 0 ||
      b < 0 ||
      c < 0 ||
      t < 0 ||
      t > 100
    ) {
      sceneController.current?.clearPoint();
      applyHighlight(null);
      setSelectedPhase(null);
      setAnalysis({
        error:
          "输入无效：A、B 需为非负数且 A + B ≤ 100%，温度需在 0%～100% 之间。",
      });
      return;
    }

    const phase = phaseAt(model, a, b, t);
    sceneController.current?.setPoint(positionFromComposition(a, b, t));
    applyHighlight(phase.meshId);
    setSelectedPhase(phase.title);
    setAnalysis({ c, phase, a, b, t });
  }

  /** 一次性把相机、等温截面、爆炸视图、相区可见性与成分点分析全部恢复到初始状态。 */
  function resetAll() {
    const nextFilters = { ...ALL_VISIBLE };
    const nextVisibility = visibilityForModel(model);
    const controller = sceneController.current;
    controller?.resetView();
    controller?.setTemperature(100, false);
    controller?.setExploded(false, 100);
    controller?.setFilters(nextFilters);
    controller?.setPhaseVisibility(nextVisibility);
    setTemperature(100);
    setExploded(false);
    setFilters(nextFilters);
    setPhaseVisibility(nextVisibility);
    setAnalysis(null);
    setSelectedPhase(null);
  }

  const computedC = 100 - composition.a - composition.b;

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <img src={brandLogo} alt="" />
          </div>
          <div>
            <h1>材科基 · 三元相图3D可视化实验室</h1>
            <span className="brand-subtitle">Materials Fundamentals Ternary Phase Lab</span>
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
            title="恢复相机视角、等温截面、爆炸视图与相区可见性"
          >
            <HomeIcon />
            <span>重置全部</span>
          </button>
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
                  onClick={() => changeModel(key)}
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
              type="button"
              className={exploded ? "explode-button active" : "explode-button"}
              onClick={() => setExploded((value) => !value)}
              aria-pressed={exploded}
            >
              <span className="button-icon" aria-hidden="true">↕</span>
              <span>
                <strong>{exploded ? "复原视图" : "爆炸视图"}</strong>
                <small>{exploded ? "重新合并各相区" : "向四周拆分各相区"}</small>
              </span>
              <span className="button-state">{exploded ? "ON" : "OFF"}</span>
            </button>

            <div className="divider" />

            <div className="control-section">
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
                  <span aria-hidden="true">＋</span> 生成探测点
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
            <span><i className="legend-swatch two" /> 两相</span>
            <span><i className="legend-swatch solid" /> 固相</span>
            {model !== "isomorphous" && (
              <span><i className="legend-swatch three" /> 三相</span>
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
            <div className="card-title">当前温度状态</div>
            {/* 形式与 demo 的 #status-display 一致：居中卡片 + 小号大写标签 + 大号相区名，
                相区名按类别取色（液相 #93c5fd / 两相 #5eead4 / 固相 #fcd34d）。 */}
            <div className="status-card">
              <small>{selectedPhase ? "已选中相区" : "中心成分当前温度"}</small>
              <strong style={{ color: statusAccent }}>
                {selectedPhase ?? sliceStatus.title}
              </strong>
              <p>
                {selectedPhase
                  ? "点击空白处可取消高亮"
                  : `固定参考 A / B / C = 33.33%`}
              </p>
            </div>
          </section>

          <section className="panel filter-section">
            <div className="card-title">相区可见性</div>
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
                    <span>{phase.name}</span>
                  </label>
                ))}
              </div>

              {/* 次级：PRD 四.3 要求的按类别批量隐藏，demo 没有这一层，放在下面不抢主次。 */}
              <div className="phase-visibility-heading">按类别批量显示 / 隐藏</div>
              {(Object.keys(CATEGORY_LABELS) as PhaseCategory[]).map((category) => {
                const hasCategory = phaseSpecs.some((phase) => phase.category === category);
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
                    <span className={`filter-indicator ${category}`} />
                    <span>
                      <strong>{CATEGORY_LABELS[category]}</strong>
                      <small>{categoryDescription(model, category)}</small>
                    </span>
                    <b>{hasCategory ? (filters[category] ? "显示" : "隐藏") : "—"}</b>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel teaching-note">
            <div className="card-title">教学解析</div>
            <p>{meta.note}</p>
          </section>

        </aside>
      </section>
    </main>
  );
}
