import React, { useState } from "react";
import { Link } from "react-router-dom";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Check from "@mui/icons-material/Check";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import DataObject from "@mui/icons-material/DataObject";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import Code from "@mui/icons-material/Code";
import Close from "@mui/icons-material/Close";
import Menu from "@mui/icons-material/Menu";
import Brand from "../components/Brand";
import { useAuth } from "../context/AuthContext";
import { copyToClipboard } from "../lib/format";
import useLandingMotion from "./useLandingMotion";
import "./landing-motion.css";

const example = {
  project: "Orbit",
  stack: ["React", "Django", "PostgreSQL"],
  architecture: {
    frontend: "React console → Django REST API",
    backend: "Django REST API → PostgreSQL",
    auth: "Token authentication; every query is scoped to its user",
  },
  conventions: [
    "Keep API routes under /api/",
    "Scope database queries to the authenticated user",
  ],
  task: "Add a project endpoint using the existing conventions.",
};

export function ProjectPreview({ standalone = false }) {
  const [tab, setTab] = useState("Overview");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    const ok = await copyToClipboard(JSON.stringify(example, null, 2));
    setCopied(ok);
    setCopyError(!ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div
      className={`product-preview${standalone ? " standalone-preview" : ""}`}
    >
      <div className="preview-chrome">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>contexa / workspace / orbit</span>
        <span className="demo-label">Interactive example</span>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <Brand />
          <small>WORKSPACE</small>
          <div className="preview-nav active">
            <AccountTreeOutlined /> Project overview
          </div>
          <div className="preview-nav">
            <StorageOutlined /> Sources <span>3</span>
          </div>
          <div className="preview-nav">
            <DataObject /> AI context
          </div>
          <div className="preview-project">
            <span className="project-avatar">O</span>
            <div>
              Orbit<small>Personal project</small>
            </div>
          </div>
          <div className="preview-sidebar-bottom">
            <span className="green-dot" /> All sources connected
          </div>
        </aside>
        <div className="preview-main">
          <div className="preview-heading">
            <div>
              <div className="eyebrow">YOUR PROJECT, CONNECTED</div>
              <h3>
                Orbit <span className="subtle-pill">Example project</span>
              </h3>
              <p>A clear picture of what you're building.</p>
            </div>
            <button className="preview-copy" onClick={copy}>
              {copied ? <Check /> : <ContentCopyOutlined />}
              {copied ? "Copied" : "Copy context"}
            </button>
          </div>
          {copyError && (
            <p role="alert">
              Copy unavailable. Open the AI context tab to select the example.
            </p>
          )}
          <div
            className="preview-tabs"
            role="tablist"
            aria-label="Example project views"
          >
            {["Overview", "Architecture", "AI context"].map((t) => (
              <button
                key={t}
                role="tab"
                id={`preview-${t.replace(" ", "-")}`}
                aria-selected={tab === t}
                aria-controls="preview-panel"
                tabIndex={tab === t ? 0 : -1}
                onKeyDown={(event) => {
                  const tabs = ["Overview", "Architecture", "AI context"];
                  const current = tabs.indexOf(t);
                  let next;
                  if (event.key === "ArrowRight")
                    next = (current + 1) % tabs.length;
                  if (event.key === "ArrowLeft")
                    next = (current + tabs.length - 1) % tabs.length;
                  if (event.key === "Home") next = 0;
                  if (event.key === "End") next = tabs.length - 1;
                  if (next !== undefined) {
                    event.preventDefault();
                    setTab(tabs[next]);
                    document
                      .getElementById(`preview-${tabs[next].replace(" ", "-")}`)
                      ?.focus();
                  }
                }}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div
            id="preview-panel"
            key={tab}
            role="tabpanel"
            aria-labelledby={`preview-${tab.replace(" ", "-")}`}
          >
            {tab === "Overview" && (
              <>
                <div className="preview-stats">
                  {[
                    ["128", "Files indexed"],
                    ["12", "Database tables"],
                    ["3", "Connected sources"],
                    ["~2.4k", "Context tokens"],
                  ].map(([v, l]) => (
                    <div key={l}>
                      <strong>{v}</strong>
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
                <div className="preview-columns">
                  <div className="preview-map">
                    <div className="mini-heading">
                      How it fits together <AccountTreeOutlined />
                    </div>
                    <ArchitectureMini />
                  </div>
                  <div className="preview-context">
                    <div className="mini-heading">
                      Ready for your next prompt <span className="green-dot" />
                    </div>
                    <div className="code-snippet">
                      <span>// Your project. Just the essentials.</span>
                      <br />
                      <b>project</b>: "Orbit"
                      <br />
                      <b>stack</b>: ["React", "Django"]
                      <br />
                      <b>database</b>: "PostgreSQL"
                      <br />
                      <b>auth</b>: "Token authentication"
                      <br />
                      <b>conventions</b>: [ ... ]
                    </div>
                    <div className="context-ready">
                      <Check /> Focused context, without the noise
                    </div>
                  </div>
                </div>
              </>
            )}
            {tab === "Architecture" && (
              <div className="expanded-map">
                <ArchitectureMini />
                <p>
                  Follow the connections from your frontend to your API and
                  database.
                </p>
              </div>
            )}
            {tab === "AI context" && (
              <pre className="example-json">
                {JSON.stringify(example, null, 2)}
              </pre>
            )}
          </div>
          <div className="preview-footnote">
            <span>
              <span className="green-dot" /> Snapshot ready
            </span>
            <span>Illustrative data · Results depend on your sources</span>
          </div>
        </div>
      </div>
    </div>
  );
}
function ArchitectureMini() {
  return (
    <div className="mini-architecture">
      <div className="architecture-node">
        <Code />
        <div>
          Frontend<small>React · Vite</small>
        </div>
        <span className="node-indicator" />
      </div>
      <div className="node-connector">
        <span>REST API</span>
      </div>
      <div className="architecture-node">
        <DataObject />
        <div>
          Backend<small>Django · Python</small>
        </div>
        <span className="node-indicator" />
      </div>
      <div className="node-connector" />
      <div className="architecture-node">
        <StorageOutlined />
        <div>
          Database<small>PostgreSQL · 12 tables</small>
        </div>
        <span className="node-indicator" />
      </div>
    </div>
  );
}
const faqs = [
  [
    "Who is Contexa for?",
    "Solo developers, students, indie builders, and anyone who wants to understand an existing project before changing it. It is especially useful when you want to spend fewer AI messages explaining your stack.",
  ],
  [
    "Can I use it with a free AI account?",
    "Copy your context into any AI chat or coding tool that accepts text, including the free tools you already use. Contexa does not require an AI subscription. Your AI provider’s own access and usage limits still apply.",
  ],
  [
    "What can I connect?",
    "GitHub repositories, PostgreSQL, MongoDB, and supported object storage. Start with a repository or database and add the other sources when you need a fuller picture.",
  ],
  [
    "Does it change my project?",
    "Contexa inspects your connected sources to produce a saved snapshot. It does not generate commits or edit your application. Connection credentials are encrypted in your browser and again at rest.",
  ],
  [
    "How do I keep the context useful?",
    "Build a new snapshot after meaningful changes. You can check freshness, compare snapshots, focus the context on a specific task, and set a token budget before copying it.",
  ],
];

const taskExamples = [
  { label: "Add an API endpoint", task: "Add a project endpoint using the existing conventions.", context: ["React console → Django REST API → PostgreSQL", "Keep API routes under /api/", "Use token authentication", "Scope database queries to the authenticated user"] },
  { label: "Understand the architecture", task: "Explain how a request moves through this project.", context: ["Frontend: React console", "Backend: Django REST API", "Database: PostgreSQL", "Authentication: token-based; queries are scoped to each user"] },
  { label: "Plan a database change", task: "Help me plan a database change that fits this stack.", context: ["Database: PostgreSQL", "Backend: Django REST API", "Frontend: React console", "Preserve user-scoped queries and existing /api/ conventions"] },
];

function ContextWalkthrough() {
  const [selected, setSelected] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const task = taskExamples[selected];
  const prompt = `Project: Orbit\nStack: React, Django, PostgreSQL\n\nProject context:\n${task.context.map((line) => `- ${line}`).join("\n")}\n\nTask: ${task.task}`;
  return (
    <section className="context-walkthrough landing-container" aria-labelledby="walkthrough-heading">
      <div className="section-heading">
        <div className="eyebrow">WHAT CONTEXA DOES FOR YOU</div>
        <h2 id="walkthrough-heading">From your repo to a better AI prompt.</h2>
        <p>Contexa reads your connected sources, maps how your project works, and packages the context you can give your AI. Here’s an example.</p>
      </div>
      <div className="context-journey">
        <div className="journey-input">
          <span className="feature-number">01 / YOUR SOURCES</span>
          <h3>Start with your existing project.</h3>
          <div className="source-example"><Code /><div>orbit / web-app<small>React frontend · Django API</small></div></div>
          <div className="source-example"><StorageOutlined /><div>Orbit database<small>PostgreSQL schema</small></div></div>
          <p>Connect a repository or database. Add more sources as you need them.</p>
          <div className="journey-result"><Check /> Contexa turns these into a saved project snapshot.</div>
        </div>
        <div className="journey-output">
          <span className="feature-number">02 / YOUR NEXT TASK</span>
          <h3>See what you can hand to your AI.</h3>
          <div className="task-options" role="group" aria-label="Choose an example task">
            {taskExamples.map((item, index) => <button key={item.label} aria-pressed={index === selected} onClick={() => { setSelected(index); setCopyStatus(""); }}>{item.label}</button>)}
          </div>
          <div className="prompt-example" key={selected}>
            <div className="prompt-example-heading"><DataObject /> Example context handoff</div>
            <ul>{task.context.map((line) => <li key={line}>{line}</li>)}</ul>
            <div className="prompt-task"><span>YOUR REQUEST</span>{task.task}</div>
          </div>
          <div className="journey-handoff"><span>03 / PASTE INTO YOUR AI CHAT</span><button className="preview-copy" onClick={async () => {
            const ok = await copyToClipboard(prompt);
            setCopyStatus(ok ? "Example prompt copied" : "Copy unavailable. Select the example text above.");
          }}><ContentCopyOutlined /> Copy example prompt</button></div>
          <p className="copy-status" role="status">{copyStatus || "Use with Claude, ChatGPT, Codex, or any tool that accepts text."}</p>
        </div>
      </div>
      <p className="walkthrough-note">Illustrative project data. In your workspace, choose a task and token budget to focus the context from your own snapshot.</p>
    </section>
  );
}
export default function Landing() {
  const motionRoot = useLandingMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();
  const destination = user ? "/dashboard" : "/register";
  return (
    <div className="landing" ref={motionRoot}>
      <div className="reading-progress" aria-hidden="true" />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-nav">
          <Brand />
          <nav
            className={menuOpen ? "landing-links open" : "landing-links"}
            aria-label="Main navigation"
          >
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#for-builders" onClick={() => setMenuOpen(false)}>
              For builders
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              FAQs
            </a>
          </nav>
          <div className="landing-nav-actions">
            <Link className="login-link" to={user ? "/dashboard" : "/login"}>
              {user ? "Workspace" : "Log in"}
            </Link>
            <Link className="button button-dark button-small" to={destination}>
              {user ? "Open workspace" : "Get started"}
              <ArrowForward />
            </Link>
            <button
              className="mobile-menu"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <Close /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content">
        <section className="hero landing-container">
          <div className="hero-atmosphere" aria-hidden="true">
            <span /><span /><span />
          </div>
          <a className="announcement" href="#how-it-works">
            <span className="green-dot" /> Less explaining. More building.
            <ArrowForward />
          </a>
          <h1>
            Give your AI the context
            <br />
            <span>to work on your code.</span>
          </h1>
          <p className="hero-description">
            Connect your GitHub repo, database, or storage. Contexa maps your
            architecture, schemas, and conventions into a project overview and
            task-focused context you can paste into your AI coding tool.
          </p>
          <div className="hero-actions">
            <Link className="button button-dark" to={destination}>
              Connect your project
              <ArrowForward />
            </Link>
            <a className="button button-white" href="#product">
              <span className="play-icon">▷</span> See the project overview
            </a>
          </div>
          <div className="hero-note">
            <Check /> Less time explaining your stack. More time building your next feature.
          </div>
          <div className="hero-preview" id="product">
            <div className="preview-depth"><ProjectPreview /></div>
          </div>
          <div className="works-with">
            <span>YOUR STACK, IN ONE PLACE</span>
            <div>
              <Code /> GitHub
            </div>
            <div>
              <StorageOutlined /> PostgreSQL
            </div>
            <div>
              <DataObject /> MongoDB
            </div>
            <div>
              <span className="storage-symbol">▱</span> Object storage
            </div>
          </div>
        </section>
        <ContextWalkthrough />
        <section className="problem-section" id="for-builders">
          <div className="landing-container problem-grid">
            <div>
              <div className="eyebrow">BUILT FOR THE WAY YOU BUILD</div>
              <h2>
                Your next prompt shouldn't
                <br />
                start from scratch.
              </h2>
              <p>
                Working with a limited AI plan? Every message matters. Stop
                spending them re-explaining your folders, schemas, and
                conventions.
              </p>
              <p>
                Give your AI the right context from the start. Keep the big
                picture for yourself.
              </p>
              <Link className="text-link" to={destination}>
                Make your next session count <ArrowForward />
              </Link>
            </div>
            <div className="before-after">
              <div className="before-block">
                <span className="comparison-label">THE USUAL WAY</span>
                <div className="chat-bubble">“Here's my folder structure…”</div>
                <div className="chat-bubble">“And the database schema…”</div>
                <div className="chat-bubble">
                  “Wait, let me explain how auth works.”
                </div>
                <small>More setup. Less room for the actual task.</small>
              </div>
              <div className="after-block">
                <span className="comparison-label">
                  <span className="green-dot" /> WITH CONTEXA
                </span>
                <div className="context-file">
                  <DataObject />
                  <div>
                    project-context.json
                    <small>Architecture, schema & conventions</small>
                  </div>
                  <Check />
                </div>
                <p>
                  “Here's my project context.
                  <br />
                  Let's build the next feature.”
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-container features-section">
          <div className="section-heading">
            <div className="eyebrow">CLARITY AT EVERY LEVEL</div>
            <h2>
              See the whole picture.
              <br />
              <span>Take only what you need.</span>
            </h2>
            <p>
              One place to understand your stack. One focused handoff to keep
              building.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card feature-wide">
              <div className="feature-illustration map-illustration">
                <span className="map-chip">
                  <Code /> Your code
                </span>
                <span className="map-line" />
                <span className="map-core">
                  <Brand compact />
                </span>
                <span className="map-line" />
                <div className="map-sources">
                  <span className="map-chip">
                    <StorageOutlined /> Database
                  </span>
                  <span className="map-chip">
                    <DataObject /> Storage
                  </span>
                </div>
              </div>
              <span className="feature-number">01 / UNDERSTAND</span>
              <h3>Your project, at a glance.</h3>
              <p>
                Explore code, data, and their relationships in a unified
                architecture view. Get your bearings without opening a dozen
                tabs.
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-illustration budget-illustration">
                <div>
                  <span>Context budget</span>
                  <strong>
                    4,000 <small>tokens</small>
                  </strong>
                </div>
                <div className="budget-track">
                  <i />
                </div>
                <div className="budget-tags">
                  <span>Schema</span>
                  <span>Routes</span>
                  <span>Conventions</span>
                </div>
              </div>
              <span className="feature-number">02 / FOCUS</span>
              <h3>Small context. Big understanding.</h3>
              <p>
                Choose a token budget and describe your task. Keep the relevant
                structure and leave out the bulk.
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-illustration handoff-illustration">
                <div className="handoff-file">
                  <DataObject />
                  <span>Project context</span>
                  <Check />
                </div>
                <div className="handoff-tools">
                  <span>Claude</span>
                  <span>Codex</span>
                  <span>Your AI</span>
                </div>
              </div>
              <span className="feature-number">03 / BUILD</span>
              <h3>Bring your own AI.</h3>
              <p>
                Copy a ready-to-use prompt or structured JSON into your
                preferred tool. No new AI subscription needed.
              </p>
            </article>
          </div>
        </section>
        <section className="workflow-section" id="how-it-works">
          <div className="landing-container">
            <div className="section-heading">
              <div className="eyebrow">FROM SCATTERED TO STRUCTURED</div>
              <h2>Three steps to a clearer project.</h2>
              <p>No more assembling context by hand.</p>
            </div>
            <div className="workflow-grid">
              {[
                [
                  "01",
                  "Connect your sources",
                  "Choose a GitHub repo or database. Add storage to bring more of your stack into view.",
                ],
                [
                  "02",
                  "Get the full picture",
                  "Build a snapshot of your architecture, schemas, routes, and project conventions.",
                ],
                [
                  "03",
                  "Give your AI a head start",
                  "Focus on a task, choose your context budget, and copy it into your next session.",
                ],
              ].map(([n, t, d]) => (
                <article key={n}>
                  <span className="step-number">{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </article>
              ))}
            </div>
            <div className="trust-strip">
              <span className="trust-icon">◇</span>
              <div>
                <strong>Your credentials stay protected.</strong>
                <span>
                  Encrypted in your browser and at rest. Saved credentials are
                  never displayed back.
                </span>
              </div>
              <Link to={destination}>
                Connect with confidence <ArrowForward />
              </Link>
            </div>
          </div>
        </section>
        <section className="landing-container faq-section" id="faq">
          <div>
            <div className="eyebrow">A LITTLE MORE CONTEXT</div>
            <h2>
              Good questions.
              <br />
              Clear answers.
            </h2>
            <p>Everything you need to get started.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-container">
          <div className="final-cta">
            <div className="eyebrow">
              LESS CONTEXT WRANGLING. MORE MOMENTUM.
            </div>
            <h2>
              Know your project.
              <br />
              Make your next prompt count.
            </h2>
            <Link className="button button-dark" to={destination}>
              Get started with Contexa
              <ArrowForward />
            </Link>
            <p>
              For side projects, big ideas, and everything you're building next.
            </p>
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <Brand />
        <span>Clarity for you. Context for your AI.</span>
        <small>© {new Date().getFullYear()} Contexa</small>
        <a href="#main-content">Back to top ↑</a>
      </footer>
    </div>
  );
}
