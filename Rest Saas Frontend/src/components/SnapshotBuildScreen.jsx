import React, { useEffect, useState } from "react";
import DnsOutlined from "@mui/icons-material/DnsOutlined";
import CodeOutlined from "@mui/icons-material/CodeOutlined";
import CloudQueueOutlined from "@mui/icons-material/CloudQueueOutlined";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import PauseOutlined from "@mui/icons-material/PauseOutlined";
import PlayArrowOutlined from "@mui/icons-material/PlayArrowOutlined";
import "./SnapshotBuildScreen.css";

// Source activity is illustrative until the inline HTTP response arrives.
export default function SnapshotBuildScreen({ open, projectName, database = false, mongo = false, storage = false, repository = false, rebuilding = false }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [paused, setPaused] = useState(false);
  const sources = [
    database && { id: "sql", title: "Database", icon: DnsOutlined, detail: "Tables, exact column types, enum values and relationships form the data contract for your AI.", lines: ["tables & columns", "enums & relations", "schema context"] },
    mongo && { id: "mongo", title: "MongoDB", icon: DnsOutlined, detail: "Collection structure and field information help describe how your application stores documents.", lines: ["collections", "document structure", "field metadata"] },
    storage && { id: "storage", title: "Storage", icon: CloudQueueOutlined, detail: "Storage metadata describes how files are organised, without copying the stored file contents.", lines: ["buckets & containers", "object metadata", "storage structure"] },
    repository && { id: "code", title: "Repository", icon: CodeOutlined, detail: "Source files preserve the imports, model names and conventions an AI needs to work with your project.", lines: ["source files", "imports & models", "project conventions"] },
  ].filter(Boolean);
  if (!sources.length) sources.push({ id: "project", title: "Project sources", icon: AccountTreeOutlined, detail: "Your connected sources come together in a reusable snapshot for focused AI context.", lines: ["connected sources", "project structure", "context snapshot"] });
  const messages = ["Connecting to your selected sources", ...(database ? ["Reading database tables, relationships and enums"] : []), ...(mongo ? ["Inspecting MongoDB collections and document structure"] : []), ...(storage ? ["Inspecting storage metadata"] : []), ...(repository ? ["Reading repository source files and project conventions"] : []), "Mapping source relationships and preparing project context", "Waiting for your saved snapshot"];
  useEffect(() => {
    setStep(0); setSelected(null); setPaused(false);
    if (!open) return undefined;
    const timer = setInterval(() => setStep(value => Math.min(value + 1, messages.length - 1)), 5500);
    return () => clearInterval(timer);
  }, [open, database, mongo, storage, repository]);
  if (!open) return null;
  const active = sources.find(source => source.id === selected) || sources[Math.min(step, sources.length - 1)];
  return <section className={`snapshot-studio${paused ? " snapshot-studio--paused" : ""}`} aria-labelledby="snapshot-build-title">
    <header className="snapshot-studio__header">
      <span className="snapshot-studio__eyebrow"><i /> CONTEXA / SNAPSHOT STUDIO</span>
      <button className="snapshot-studio__motion" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? <PlayArrowOutlined /> : <PauseOutlined />}{paused ? "Resume animation" : "Pause animation"}</button>
    </header>
    <div className="snapshot-studio__intro">
      <span className="snapshot-studio__eyebrow">{projectName || "YOUR CONNECTED PROJECT"}</span>
      <h1 id="snapshot-build-title">{rebuilding ? "A fresh perspective." : "Your project. Coming together."}</h1>
      <p>From scattered sources to context your AI can work with.</p>
    </div>
    <div className="snapshot-studio__workspace">
      <div className="snapshot-studio__sources" aria-label="Explore your selected sources">
        {sources.map((source, index) => <button key={source.id} className={`snapshot-studio__source${active.id === source.id ? " is-active" : ""}`} onClick={() => setSelected(source.id)} aria-pressed={active.id === source.id} style={{ "--source-delay": `${index * .35}s` }}>
          <source.icon /><span><strong>{source.title}</strong><small>Explore source context</small></span><span className="snapshot-studio__signal" aria-hidden="true" />
        </button>)}
      </div>
      <div className="snapshot-studio__flow" aria-hidden="true">
        <svg viewBox="0 0 240 240" preserveAspectRatio="none"><path d="M0 20 C130 20 90 120 240 120 M0 85 C130 85 90 120 240 120 M0 155 C130 155 90 120 240 120 M0 220 C130 220 90 120 240 120" /></svg>
        <span>CONNECT / UNDERSTAND / COMPOSE</span>
      </div>
      <div className="snapshot-studio__canvas">
        <div className="snapshot-studio__scan" aria-hidden="true" />
        <div className="snapshot-studio__document-heading"><AccountTreeOutlined /><span>project.context.json</span><span className="snapshot-studio__live">BUILDING</span></div>
        <div className="snapshot-studio__code" aria-hidden="true">
          <span>{"{"}</span><span>  "source": "{active.title}",</span><span>  "context": [</span>
          {active.lines.map((line, index) => <span className="snapshot-studio__code-line" key={`${active.id}-${line}`} style={{ animationDelay: `${index * .16}s` }}>    "{line}"{index < active.lines.length - 1 ? "," : ""}</span>)}
          <span>  ]</span><span>{"}"}<b className="snapshot-studio__cursor">_</b></span>
        </div>
        <div className="snapshot-studio__document-footer">ILLUSTRATIVE PREVIEW <span>No source content shown here</span></div>
      </div>
    </div>
    <aside className="snapshot-studio__insight"><span className="snapshot-studio__eyebrow">INSIDE YOUR CONTEXT / {active.title.toUpperCase()}</span><p>{active.detail}</p><small>Click a source above to explore what it contributes.</small></aside>
    <footer className="snapshot-studio__footer">
      <div className="snapshot-studio__activity" role="status" aria-live="polite" aria-atomic="true"><span className="snapshot-studio__pulse" aria-hidden="true" /><span key={step}>{messages[step]}</span></div>
      <div className="snapshot-studio__rail" role="progressbar" aria-label="Snapshot request in progress"><span /></div>
      <p>Keep this page open. Activity is illustrative; your snapshot opens after the server confirms it is saved.</p>
    </footer>
  </section>;
}
