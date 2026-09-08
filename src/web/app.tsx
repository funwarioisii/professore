import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "../core/schema.ts";
import type { Job } from "../core/jobs.ts";
async function api(route: string, body?: unknown) {
  const r = await fetch("/api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok)
    throw Error(
      d.error + (d.issues ? "\n" + JSON.stringify(d.issues, null, 2) : ""),
    );
  return d;
}
function App() {
  const [projects, setProjects] = useState<any[]>([]),
    [record, setRecord] = useState<any>(null),
    [draft, setDraft] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [issues, setIssues] = useState<any[]>([]),
    [scene, setScene] = useState(0),
    [beat, setBeat] = useState(0),
    [tab, setTab] = useState("scene"),
    [home, setHome] = useState(""),
    [dirty, setDirty] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null),
    [previewLoaded, setPreviewLoaded] = useState(0);
  let p: Project | undefined;
  try {
    const parsed = Project.safeParse(JSON.parse(draft));
    if (parsed.success) p = parsed.data;
  } catch {}
  const safe = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    setProjects(await api("/projects"));
    setJobs(await api("/jobs"));
  };
  useEffect(() => {
    void safe(async () => {
      await refresh();
      setHome((await api("/health")).root);
    });
    const timer = setInterval(
      () =>
        void api("/jobs")
          .then(setJobs)
          .catch(() => {}),
      1500,
    );
    return () => clearInterval(timer);
  }, []);
  const load = async (id: string) => {
    if (dirty && !confirm("未保存の変更を破棄しますか？")) return;
    const r = await api("/projects/" + id);
    setRecord(r);
    setDraft(JSON.stringify(r.project, null, 2));
    setDirty(false);
    setScene(0);
    setBeat(0);
    setIssues([]);
    setNotice("");
  };
  const change = (next: Project) => {
    setDraft(JSON.stringify(next, null, 2));
    setDirty(true);
  };
  const save = async () => {
    const current = JSON.parse(draft);
    const r = await api("/projects", {
      project: current,
      expectedRevision: record?.revision ?? 0,
    });
    setRecord(r);
    setDraft(JSON.stringify(r.project, null, 2));
    setDirty(false);
    setNotice(`リビジョン ${r.revision} を保存しました`);
    await refresh();
    return r;
  };
  const generate = async (kind: string) => {
    const r = dirty || !record ? await save() : record;
    await api("/jobs", { projectId: r.project.id, revision: r.revision, kind });
    setNotice("生成を開始しました。この画面を閉じても継続します");
    await refresh();
  };
  useEffect(() => {
    if (!p || !previewLoaded) return;
    const s = p.scenes?.[scene];
    if (!s?.beats?.length) return;
    const beats = s.beats.map((b, i) => ({
      sceneId: s.id,
      beatId: b.id,
      startFrame: i * 150,
      endFrame: (i + 1) * 150,
      speechStartSample: i * 240000,
      speechEndSample: (i + 1) * 240000 - 4800,
    }));
    iframe.current?.contentWindow?.postMessage(
      {
        project: p,
        timeline: { beats, totalFrames: s.beats.length * 150, fps: 30 },
        frame: Math.min(beat, s.beats.length - 1) * 150 + 20,
      },
      location.origin,
    );
  }, [draft, scene, beat, previewLoaded]);
  const exportJSON = () => {
    const blob = new Blob([draft], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = (p?.id ?? "project") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const current = p?.scenes?.[scene];
  const projectJobs = jobs.filter((j) => j.projectId === p?.id);
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          p<span>professore</span>
        </a>
        <div className="side-label">ワークスペース</div>
        <h2>解説を、動画に。</h2>
        <p className="muted">原稿から声、図、ひとつのMP4へ。</p>
        <label className="import button">
          ＋ 原稿JSONを取り込む
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) =>
              void safe(async () => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (dirty && !confirm("未保存の変更を破棄しますか？")) return;
                const text = await f.text();
                const value = JSON.parse(text);
                const checked = await api("/validate", value);
                setIssues([...checked.errors, ...checked.warnings]);
                if (checked.errors.length)
                  setError(
                    checked.errors
                      .map((e: any) => `${e.path}: ${e.message}`)
                      .join("\n"),
                  );
                setDraft(JSON.stringify(value, null, 2));
                setRecord(null);
                setDirty(true);
                setScene(0);
                setBeat(0);
                setNotice(
                  "取り込みました。検証して保存してください。同じIDが既にある場合は一覧から開いて更新します",
                );
              })
            }
          />
        </label>
        <nav>
          {projects.map((pr) => (
            <button
              className={p?.id === pr.id ? "selected" : ""}
              key={pr.id}
              data-project-id={pr.id}
              onClick={() => void safe(() => load(pr.id))}
            >
              <span>▤ {pr.title}</span>
              <small>REV {pr.revision}</small>
            </button>
          ))}
        </nav>
        <div className="local">
          <i /> ローカルで動作中<small>保存先</small>
          <code>{home}</code>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>制作スタジオ</span>
          <span className="tag">日本語 · LOCAL FIRST</span>
        </header>
        {error && (
          <pre className="alert" role="alert">
            {error}
          </pre>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!p ? (
          <section className="empty">
            <div className="eyebrow">EXPLAIN SOMETHING WELL</div>
            <h1>
              難しい話に、
              <br />
              わかる順序を。
            </h1>
            <p>
              AIが作った原稿を取り込み、シーンと読み上げを確認。
              <br />
              実際の音声に合わせた解説動画を作ります。
            </p>
            <p className="muted">
              まず examples/oauth.json を取り込んでください。
            </p>
            {draft && (
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                }}
                aria-label="原稿JSON"
              />
            )}
          </section>
        ) : (
          <>
            <section className="project-head">
              <div>
                <div className="eyebrow">PROJECT / {p.id}</div>
                <h1>{p.title}</h1>
                <p className="muted">
                  {p.scenes?.length} シーン · 目標 {p.targetDuration} 秒 ·{" "}
                  {record ? "REV " + record.revision : "新規"}
                  {dirty ? " · 未保存" : ""}
                </p>
              </div>
              <div className="actions">
                <button
                  onClick={() =>
                    void safe(async () => {
                      const v = await api("/validate", JSON.parse(draft));
                      setIssues([...v.errors, ...v.warnings]);
                      setNotice(
                        v.errors.length
                          ? "構造エラーがあります"
                          : "構造検証に成功しました。意味レビューは別工程です",
                      );
                    })
                  }
                >
                  構造検証
                </button>
                <button
                  onClick={() =>
                    void safe(async () => {
                      await save();
                    })
                  }
                >
                  保存
                </button>
                <button
                  className="primary"
                  onClick={() => void safe(() => generate("render"))}
                >
                  MP4を生成 ↗
                </button>
              </div>
            </section>
            <div className="tabs">
              <button
                className={tab === "scene" ? "active" : ""}
                onClick={() => setTab("scene")}
              >
                シーン編集
              </button>
              <button
                className={tab === "json" ? "active" : ""}
                onClick={() => setTab("json")}
              >
                原稿JSON
              </button>
              <button
                className={tab === "jobs" ? "active" : ""}
                onClick={() => setTab("jobs")}
              >
                生成・成果物 <b>{projectJobs.length}</b>
              </button>
              <button onClick={exportJSON}>JSONを書き出す ↓</button>
            </div>
            {issues.length > 0 && (
              <ul className="issues">
                {issues.map((i, n) => (
                  <li key={n}>
                    <button
                      onClick={() => {
                        const m = i.path.match(
                          /^\/scenes\/(\d+)(?:\/beats\/(\d+))?/,
                        );
                        if (m) {
                          setScene(Number(m[1]));
                          setBeat(Number(m[2] ?? 0));
                          setTab("scene");
                        }
                      }}
                    >
                      {i.path}
                    </button>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            {tab === "json" ? (
              <textarea
                className="json"
                aria-label="原稿JSON"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                }}
              />
            ) : tab === "scene" && current ? (
              <div className="editor">
                <div className="scene-nav">
                  {p.scenes.map((s, i) => (
                    <button
                      key={s.id}
                      className={scene === i ? "selected" : ""}
                      onClick={() => {
                        setScene(i);
                        setBeat(0);
                      }}
                    >
                      <small>SCENE {String(i + 1).padStart(2, "0")}</small>
                      <strong>{s.title}</strong>
                    </button>
                  ))}
                </div>
                <div className="scene-work">
                  <div className="preview-box">
                    <iframe
                      ref={iframe}
                      title="シーンプレビュー"
                      src="/preview.html"
                      onLoad={() => setPreviewLoaded((n) => n + 1)}
                      style={{
                        width: p.settings.width,
                        height: p.settings.height,
                        transform: `scale(${720 / p.settings.width})`,
                      }}
                    />
                  </div>
                  <div className="preview-note">
                    レイアウトプレビュー · 実測同期は生成後の音声／動画で確認
                  </div>
                  <div className="beat-tabs">
                    {current.beats.map((b, i) => (
                      <button
                        key={b.id}
                        className={beat === i ? "active" : ""}
                        onClick={() => setBeat(i)}
                      >
                        BEAT {i + 1}
                      </button>
                    ))}
                  </div>
                  {current.beats[beat] && (
                    <div className="beat-editor">
                      <label>
                        表示用ナレーション
                        <textarea
                          value={current.beats[beat].narration}
                          onChange={(e) => {
                            const next = structuredClone(p!);
                            next.scenes[scene].beats[beat].narration =
                              e.target.value;
                            change(next);
                          }}
                        />
                      </label>
                      <label>
                        読み上げの上書き <span>任意・字幕には影響しません</span>
                        <textarea
                          rows={2}
                          value={current.beats[beat].speech ?? ""}
                          onChange={(e) => {
                            const next = structuredClone(p!);
                            if (e.target.value)
                              next.scenes[scene].beats[beat].speech =
                                e.target.value;
                            else delete next.scenes[scene].beats[beat].speech;
                            change(next);
                          }}
                        />
                      </label>
                      <div className="actions">
                        <button
                          onClick={() => void safe(() => generate("audio"))}
                        >
                          音声を生成・確認
                        </button>
                        <button
                          onClick={() => void safe(() => generate("preview"))}
                        >
                          静止画を生成
                        </button>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={p.settings.subtitles}
                            onChange={(e) => {
                              const next = structuredClone(p!);
                              next.settings.subtitles = e.target.checked;
                              change(next);
                            }}
                          />
                          日本語字幕
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            {tab === "jobs" && (
              <section className="jobs">
                {projectJobs.length === 0 ? (
                  <p>音声・静止画・MP4を生成すると、ここに表示されます。</p>
                ) : (
                  projectJobs.map((j) => (
                    <article key={j.id}>
                      <div className="job-head">
                        <div>
                          <strong>
                            {j.kind === "render"
                              ? "MP4動画"
                              : j.kind === "audio"
                                ? "日本語音声"
                                : "静止画プレビュー"}
                          </strong>
                          <small>
                            REV {j.revision} · {j.id}
                          </small>
                        </div>
                        <span className={"status " + j.status}>
                          {j.status} · {j.phase}
                        </span>
                      </div>
                      {["running", "queued"].includes(j.status) ? (
                        <>
                          <progress value={j.done} max={j.total} />
                          <button
                            onClick={() =>
                              void safe(async () => {
                                await api(`/jobs/${j.id}/cancel`, {});
                                await refresh();
                              })
                            }
                          >
                            キャンセル
                          </button>
                        </>
                      ) : j.status !== "succeeded" ? (
                        <>
                          <pre className="alert">{j.error}</pre>
                          <button
                            onClick={() =>
                              void safe(async () => {
                                await api(`/jobs/${j.id}/retry`, {});
                                await refresh();
                              })
                            }
                          >
                            再実行
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="muted">
                            保存先: {home}/outputs/{j.id}
                          </p>
                          {j.artifacts.includes("video.mp4") ? (
                            <video
                              controls
                              preload="metadata"
                              src={`/api/jobs/${j.id}/artifacts/video.mp4`}
                            />
                          ) : (
                            <audio
                              controls
                              src={`/api/jobs/${j.id}/artifacts/narration.wav`}
                            />
                          )}
                          <div className="artifact-links">
                            {j.artifacts
                              .filter((f) => !f.startsWith("frame-"))
                              .map((f) => (
                                <a
                                  key={f}
                                  href={`/api/jobs/${j.id}/artifacts/${f}?download=1`}
                                >
                                  {f} ↓
                                </a>
                              ))}
                          </div>
                          <div className="stills">
                            {j.artifacts
                              .filter((f) => f.startsWith("scene-"))
                              .map((f) => (
                                <a
                                  key={f}
                                  target="_blank"
                                  href={`/api/jobs/${j.id}/artifacts/${f}`}
                                >
                                  <img
                                    src={`/api/jobs/${j.id}/artifacts/${f}`}
                                    alt={f}
                                  />
                                </a>
                              ))}
                          </div>
                        </>
                      )}
                    </article>
                  ))
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
