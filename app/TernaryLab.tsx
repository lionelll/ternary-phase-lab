"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brandLogo } from "./brandLogo";
import { HomeIcon } from "./Icons";
import {
  type ModelKey,
  type PhaseCategory,
  type PhaseResult,
  phaseAt,
  positionFromComposition,
} from "./three/phaseGeometry";
import {
  type PhaseSceneController,
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

export default function TernaryLab() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneController = useRef<PhaseSceneController | null>(null);

  const [model, setModel] = useState<ModelKey>("isomorphous");
  const [temperature, setTemperature] = useState(100);
  const [exploded, setExploded] = useState(false);
  const [filters, setFilters] = useState<Record<PhaseCategory, boolean>>(ALL_VISIBLE);
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

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    const controller = createPhaseScene({
      host,
      initialModel: "isomorphous",
      onPhaseSelect(selection) {
        setSelectedPhase(selection?.name ?? null);
      },
    });
    sceneController.current = controller;
    controller.setFilters(ALL_VISIBLE);
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

  function applyHighlight(phaseId: string | null) {
    sceneController.current?.setHighlight(phaseId);
  }

  function changeModel(nextModel: ModelKey) {
    if (nextModel === model) return;
    const controller = sceneController.current;
    controller?.rebuild(nextModel);
    controller?.setFilters(filters);
    controller?.setTemperature(temperature, false);
    controller?.setExploded(false, temperature);
    setModel(nextModel);
    setSelectedPhase(null);
    setAnalysis(null);
    setExploded(false);
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

  function resetCamera() {
    sceneController.current?.resetView();
  }

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
          <button className="top-action-button" type="button" onClick={resetCamera}>
            <HomeIcon />
            <span>重置视角</span>
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
              className={exploded ? "explode-button active" : "explode-button"}
              onClick={() => setExploded((value) => !value)}
            >
              <span className="button-icon" aria-hidden="true">↕</span>
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

          <div className="axis-label label-a">A</div>
          <div className="axis-label label-b">B</div>
          <div className="axis-label label-c">C</div>
          <div className="temperature-axis">
            <span>温度</span>
            <i />
            <b>↑</b>
          </div>

          <div className="phase-legend">
            <span><i className="legend-swatch liquid" /> 液相</span>
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
            <div className="status-card">
              <div className="status-icon" aria-hidden="true">◇</div>
              <small>当前相区判断</small>
              <strong>{selectedPhase ?? sliceStatus.title}</strong>
              <p>
                {selectedPhase
                  ? "已选中相区，点击空白处可取消高亮。"
                  : sliceStatus.detail}
              </p>
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

        </aside>
      </section>
    </main>
  );
}
