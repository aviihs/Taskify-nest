/**
 * Landing page served at `GET /`. Styled after Taskify-Web: same brand
 * palette (light + dark), Inter, gradient hero with a faded grid.
 * Self-contained: no build step, no external scripts.
 */

export interface LandingPageInput {
  version: string;
  environment: string;
  uptimeSeconds: number;
}

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  layers: icon(
    '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  ),
  check: icon(
    '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  ),
  chat: icon(
    '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
  ),
  bell: icon(
    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  ),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  zap: icon('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  sparkles: icon(
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 3v4M17 5h4"/>',
  ),
  shield: icon(
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  ),
  book: icon(
    '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h8"/>',
  ),
  pulse: icon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  arrow: icon('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
};

const FEATURES: Array<[keyof typeof ICONS, string, string]> = [
  [
    'layers',
    'Workspaces',
    'A personal space for everyone, plus organizations with their own role per member.',
  ],
  [
    'check',
    'Projects & tasks',
    'Subtasks, labels, priorities, due dates and dependencies with cycle checks.',
  ],
  [
    'chat',
    'Collaboration',
    'Threaded comments with @mentions, file attachments and invitations by email.',
  ],
  [
    'bell',
    'Notifications',
    'Assignments, status changes, mentions and due-soon reminders, all in one place.',
  ],
  [
    'search',
    'Search & dashboard',
    'Search and insights that never cross into a workspace you are not part of.',
  ],
  [
    'zap',
    'Realtime',
    'Socket.IO updates pushed to the projects and workspaces you have open.',
  ],
  [
    'sparkles',
    'AI planner',
    'Turn a goal into a task breakdown, then add it through the normal rules.',
  ],
  [
    'shield',
    'Secure by default',
    'Server-side access checks on every request, rate limits and validated input.',
  ],
];

const ROUTES: Array<[string, string, string]> = [
  ['POST', '/auth/login', 'Sign in and get tokens'],
  ['GET', '/workspaces', 'My workspaces and roles'],
  ['POST', '/workspaces/:id/invitations', 'Invite a teammate'],
  ['GET', '/workspaces/:id/projects', 'Projects with progress'],
  ['POST', '/projects/:id/tasks', 'Create a task'],
  ['PATCH', '/tasks/:id', 'Update status, assignee, dates'],
  ['GET', '/users/me/tasks', 'My Tasks across workspaces'],
  ['GET', '/search?q=', 'Search everything I can see'],
  ['GET', '/workspaces/:id/dashboard', 'Totals, progress, workload'],
  ['POST', '/projects/:id/ai/task-breakdown', 'AI task suggestions'],
];

/** Brand mark, served from src/assets (see configureApp). */
export const LOGO_PATH = '/assets/taskify-logo.png';
const LOGO = `<span class="logo"><img src="${LOGO_PATH}" alt="" width="40" height="40"></span>`;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        ch
      ] as string),
  );

export function renderLandingPage({
  version,
  environment,
  uptimeSeconds,
}: LandingPageInput): string {
  const features = FEATURES.map(
    ([iconName, title, text]) => `
        <article class="card feature">
          <span class="feature-icon">${ICONS[iconName]}</span>
          <h3>${title}</h3>
          <p>${text}</p>
        </article>`,
  ).join('');

  const routes = ROUTES.map(
    ([method, path, text]) => `
          <li>
            <span class="method method-${method.toLowerCase()}">${method}</span>
            <code>${path}</code>
            <span class="route-text">${text}</span>
          </li>`,
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#3e425f">
<title>Taskify API</title>
<link rel="icon" type="image/png" href="${LOGO_PATH}">
<link rel="apple-touch-icon" href="${LOGO_PATH}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #585c83;
    --primary-dark: #3e425f;
    --secondary: #686fb1;
    --accent: #8c93d9;
    --link: #585c83;
    --bg: #f6f7fb;
    --surface: #ffffff;
    --surface-variant: #e8eaf4;
    --text: #1f2435;
    --text-secondary: #5f6785;
    --text-muted: #9097b3;
    --border: #d8dceb;
    --good: #16a34a;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --link: #a5abea;
      --bg: #121522;
      --surface: #1e2235;
      --surface-variant: #2a2e45;
      --text: #e8eaf4;
      --text-secondary: #a9aec8;
      --text-muted: #7a7f9a;
      --border: #353a55;
      --good: #4ade80;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
  body {
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  ::selection { background: var(--accent); color: #fff; }
  a { color: inherit; text-decoration: none; }
  svg { width: 1.25em; height: 1.25em; flex: none; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }

  /* Header */
  .nav {
    position: absolute; inset: 0 0 auto 0; z-index: 10;
    display: flex; align-items: center; justify-content: space-between;
    max-width: 1120px; margin: 0 auto; padding: 22px 20px; color: #fff;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 18px; letter-spacing: -0.02em; }
  .logo {
    display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px;
    background: #fff; box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.5);
  }
  .logo img { width: 30px; height: 30px; }
  .nav-links { display: flex; gap: 6px; }
  .nav-links a { padding: 8px 14px; border-radius: 999px; font-size: 14px; font-weight: 500; color: rgb(255 255 255 / 0.8); transition: background-color 0.3s var(--ease), color 0.3s var(--ease); }
  .nav-links a:hover { background: rgb(255 255 255 / 0.12); color: #fff; }

  /* Hero */
  .hero {
    position: relative; isolation: isolate; overflow: hidden; color: #fff;
    background: linear-gradient(135deg, var(--primary-dark), var(--primary) 55%, var(--secondary));
  }
  .hero::before {
    content: ""; position: absolute; inset: 0; z-index: -1;
    background-image:
      linear-gradient(to right, rgb(255 255 255 / 0.07) 1px, transparent 1px),
      linear-gradient(to bottom, rgb(255 255 255 / 0.07) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 40%, transparent 100%);
    mask-image: radial-gradient(ellipse 80% 70% at 50% 0%, #000 40%, transparent 100%);
  }
  .glow { position: absolute; z-index: -1; border-radius: 50%; filter: blur(80px); pointer-events: none; }
  .glow-a { width: 512px; height: 512px; top: -160px; right: -60px; background: rgb(140 147 217 / 0.4); }
  .glow-b { width: 448px; height: 448px; bottom: -190px; left: -130px; background: rgb(255 255 255 / 0.1); }
  .hero-grid {
    display: grid; gap: 56px; align-items: center;
    max-width: 1120px; margin: 0 auto; padding: 128px 20px 112px;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 4px 16px 4px 4px; border-radius: 999px; font-size: 14px; font-weight: 500;
    background: rgb(255 255 255 / 0.1); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    backdrop-filter: blur(8px);
  }
  .badge-dot { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #fff; }
  .badge-dot span { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; position: relative; }
  .badge-dot span::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: #22c55e; animation: ping 1.8s var(--ease) infinite; }
  @keyframes ping { 0% { transform: scale(1); opacity: 0.7; } 80%, 100% { transform: scale(2.6); opacity: 0; } }
  h1 {
    margin-top: 28px; font-size: clamp(44px, 7vw, 72px); line-height: 1.02;
    font-weight: 600; letter-spacing: -0.04em; text-wrap: balance;
  }
  .highlight { background: linear-gradient(90deg, #fff, #dde1f8 50%, #b9bff0); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lead { margin-top: 24px; max-width: 34rem; font-size: 18px; line-height: 1.65; color: rgb(255 255 255 / 0.75); text-wrap: pretty; }
  .actions { margin-top: 36px; display: flex; flex-wrap: wrap; gap: 12px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px 26px; border-radius: 999px; font-weight: 600; font-size: 15px; white-space: nowrap;
    transition: translate 0.3s var(--ease), scale 0.3s var(--ease), background-color 0.3s var(--ease);
  }
  .btn:hover { translate: 0 -2px; }
  .btn:active { translate: 0 0; scale: 0.98; }
  .btn-primary { background: #fff; color: var(--primary-dark); box-shadow: 0 10px 40px -10px rgb(0 0 0 / 0.4); }
  .btn-ghost { background: rgb(255 255 255 / 0.1); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25); backdrop-filter: blur(8px); }
  .btn-ghost:hover { background: rgb(255 255 255 / 0.2); }
  .btn-ghost svg { transition: translate 0.3s var(--ease); }
  .btn-ghost:hover svg { translate: 3px 0; }

  /* Live status window */
  .window {
    border-radius: 20px; overflow: hidden;
    background: rgb(18 21 34 / 0.72); box-shadow: 0 30px 80px -24px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.12);
    backdrop-filter: blur(12px);
  }
  .window-bar { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid rgb(255 255 255 / 0.08); }
  .window-bar i { width: 11px; height: 11px; border-radius: 50%; background: rgb(255 255 255 / 0.2); }
  .window-bar code { margin-left: 8px; font-family: var(--mono); font-size: 13px; color: rgb(255 255 255 / 0.65); }
  .window-bar .live { margin-left: auto; font-size: 12px; font-weight: 600; color: #86efac; display: flex; align-items: center; gap: 6px; }
  .window-bar .live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
  pre {
    margin: 0; padding: 20px 22px 24px; font-family: var(--mono); font-size: 13.5px; line-height: 1.75;
    color: #e8eaf4; white-space: pre-wrap; word-break: break-word; min-height: 170px;
  }
  .k { color: #a5abea; } .s { color: #86efac; } .n { color: #fbbf24; }
  .float {
    position: absolute; display: flex; align-items: center; gap: 12px;
    padding: 10px 16px 10px 10px; border-radius: 16px;
    background: var(--surface); color: var(--text);
    box-shadow: 0 20px 50px -12px rgb(0 0 0 / 0.35), inset 0 0 0 1px rgb(0 0 0 / 0.05);
    animation: float 6s ease-in-out infinite;
  }
  .float b { display: block; font-size: 14px; font-weight: 600; }
  .float small { font-size: 12px; color: var(--text-muted); }
  .float-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; }
  .float-a { left: -36px; bottom: -58px; }
  .float-a .float-icon { background: rgb(34 197 94 / 0.15); color: var(--good); }
  .float-b { right: 16px; top: -64px; animation-delay: 1.2s; }
  .float-b .float-icon { background: var(--surface-variant); color: var(--link); }
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
  .preview { position: relative; }

  /* Stats */
  .stats {
    position: relative; z-index: 2; margin-top: -48px;
    display: grid; grid-template-columns: repeat(4, 1fr);
    background: var(--surface); border: 1px solid var(--border); border-radius: 22px;
    box-shadow: 0 24px 60px -32px rgb(88 92 131 / 0.45);
  }
  .stat { padding: 24px 26px; }
  .stat + .stat { border-left: 1px solid var(--border); }
  .stat dt { font-size: 13px; font-weight: 500; color: var(--text-muted); }
  .stat dd { margin-top: 6px; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }

  /* Sections */
  section.block { padding-top: 112px; }
  .eyebrow { font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--link); }
  h2 { margin-top: 12px; font-size: clamp(30px, 4vw, 42px); line-height: 1.1; font-weight: 600; letter-spacing: -0.035em; text-wrap: balance; }
  .section-lead { margin-top: 14px; max-width: 36rem; color: var(--text-secondary); font-size: 17px; }
  .features { margin-top: 44px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
    transition: translate 0.3s var(--ease), border-color 0.3s var(--ease), box-shadow 0.3s var(--ease);
  }
  @media (hover: hover) {
    .card:hover {
      translate: 0 -4px;
      border-color: color-mix(in oklab, var(--accent) 55%, transparent);
      box-shadow: 0 24px 60px -30px rgb(88 92 131 / 0.45);
    }
  }
  .feature { padding: 24px; }
  .feature-icon {
    display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px;
    background: var(--surface-variant); color: var(--link);
  }
  .feature h3 { margin-top: 18px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  .feature p { margin-top: 6px; font-size: 14px; color: var(--text-secondary); }

  .routes-card { margin-top: 44px; padding: 8px; }
  .routes { list-style: none; }
  .routes li {
    display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: 16px;
    padding: 14px 16px; border-radius: 14px; transition: background-color 0.3s var(--ease);
  }
  .routes li:hover { background: var(--surface-variant); }
  .routes li + li { border-top: 1px solid var(--border); }
  .routes li:hover + li, .routes li:hover { border-color: transparent; }
  .routes code { font-family: var(--mono); font-size: 14px; overflow-wrap: anywhere; }
  .route-text { font-size: 14px; color: var(--text-secondary); text-align: right; }
  .method { justify-self: start; font-family: var(--mono); font-size: 11.5px; font-weight: 600; padding: 4px 9px; border-radius: 8px; letter-spacing: 0.03em; }
  .method-get { background: rgb(34 197 94 / 0.14); color: var(--good); }
  .method-post { background: rgb(104 111 177 / 0.16); color: var(--link); }
  .method-patch { background: rgb(245 158 11 / 0.16); color: #b45309; }
  @media (prefers-color-scheme: dark) { .method-patch { color: #fbbf24; } }
  .routes-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; padding: 16px 18px 10px; color: var(--text-muted); font-size: 14px; }
  .routes-foot a { color: var(--link); font-weight: 600; display: inline-flex; gap: 6px; align-items: center; }

  /* CTA + footer */
  .cta {
    margin-top: 112px; position: relative; isolation: isolate; overflow: hidden;
    border-radius: 28px; padding: 56px 48px; color: #fff;
    background: linear-gradient(135deg, var(--primary-dark), var(--primary) 60%, var(--secondary));
    display: flex; align-items: center; justify-content: space-between; gap: 32px; flex-wrap: wrap;
  }
  .cta h2 { margin: 0; color: #fff; }
  .cta p { margin-top: 10px; color: rgb(255 255 255 / 0.75); max-width: 30rem; }
  footer { padding: 48px 0 56px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; color: var(--text-muted); font-size: 14px; }
  footer .brand { color: var(--text); font-size: 15px; }
  footer .logo { width: 28px; height: 28px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--border); }
  footer .logo img { width: 24px; height: 24px; }

  @media (min-width: 960px) {
    .hero-grid { grid-template-columns: 1.1fr 1fr; padding: 152px 20px 152px; }
  }
  @media (max-width: 959px) {
    .features { grid-template-columns: repeat(2, 1fr); }
    .float { display: none; }
  }
  @media (max-width: 640px) {
    .nav-links a:not(:last-child) { display: none; }
    .hero-grid { padding: 112px 20px 96px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .stat:nth-child(3) { border-left: 0; }
    .stat:nth-child(n + 3) { border-top: 1px solid var(--border); }
    .features { grid-template-columns: 1fr; }
    .routes li { grid-template-columns: 64px minmax(0, 1fr); }
    .route-text { grid-column: 2; text-align: left; margin-top: -10px; }
    .cta { padding: 40px 24px; }
    .actions { flex-direction: column; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<header class="nav">
  <a class="brand" href="/">${LOGO}Taskify API</a>
  <nav class="nav-links">
    <a href="#features">Features</a>
    <a href="#endpoints">Endpoints</a>
    <a href="/api">Docs</a>
  </nav>
</header>

<main>
  <section class="hero">
    <div class="glow glow-a"></div>
    <div class="glow glow-b"></div>
    <div class="hero-grid">
      <div>
        <span class="badge"><span class="badge-dot"><span></span></span>All systems running · v${escapeHtml(
          version,
        )}</span>
        <h1>The engine behind <span class="highlight">Taskify</span></h1>
        <p class="lead">One API for the Taskify web and mobile apps: personal and team workspaces, projects, tasks, collaboration and live updates.</p>
        <div class="actions">
          <a class="btn btn-primary" href="/api">${ICONS.book}Open API docs</a>
          <a class="btn btn-ghost" href="/health">Health check${ICONS.arrow}</a>
        </div>
      </div>

      <div class="preview">
        <div class="window">
          <div class="window-bar"><i></i><i></i><i></i><code>GET /health</code><span class="live">Live</span></div>
          <pre id="health">Checking…</pre>
        </div>
        <div class="float float-b">
          <span class="float-icon">${ICONS.layers}</span>
          <div><b>17 modules</b><small>Workspaces to AI</small></div>
        </div>
        <div class="float float-a">
          <span class="float-icon">${ICONS.shield}</span>
          <div><b>Access checked</b><small>On every request</small></div>
        </div>
      </div>
    </div>
  </section>

  <div class="wrap">
    <dl class="stats">
      <div class="stat"><dt>Status</dt><dd id="status">Online</dd></div>
      <div class="stat"><dt>Uptime</dt><dd id="uptime">–</dd></div>
      <div class="stat"><dt>Version</dt><dd>v${escapeHtml(version)}</dd></div>
      <div class="stat"><dt>Environment</dt><dd>${escapeHtml(
        environment,
      )}</dd></div>
    </dl>

    <section class="block" id="features">
      <p class="eyebrow">What it powers</p>
      <h2>Everything a team needs to plan and ship work</h2>
      <p class="section-lead">Each feature is its own module, and every request is checked against your workspace role before any data is touched.</p>
      <div class="features">${features}
      </div>
    </section>

    <section class="block" id="endpoints">
      <p class="eyebrow">Start here</p>
      <h2>Popular endpoints</h2>
      <p class="section-lead">Send <code>Authorization: Bearer &lt;accessToken&gt;</code> with every request except sign-up, sign-in and health.</p>
      <div class="card routes-card">
        <ul class="routes">${routes}
        </ul>
        <div class="routes-foot">
          <span>Realtime: Socket.IO namespace <code>/realtime</code></span>
          <a href="/api">See all endpoints${ICONS.arrow}</a>
        </div>
      </div>
    </section>

    <section class="cta">
      <div class="glow glow-a"></div>
      <div>
        <h2>Build on Taskify</h2>
        <p>Interactive documentation with every request and response, ready to try with your own token.</p>
      </div>
      <a class="btn btn-primary" href="/api">${ICONS.book}Open Swagger</a>
    </section>

    <footer>
      <span class="brand">${LOGO}Taskify API</span>
      <span>Built with NestJS · <a href="/health/detailed">System details</a></span>
    </footer>
  </div>
</main>

<script>
  (function () {
    var started = Date.now() - ${Math.floor(uptimeSeconds)} * 1000;
    var uptimeEl = document.getElementById('uptime');
    function formatUptime(total) {
      var d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600),
          m = Math.floor((total % 3600) / 60), s = total % 60;
      if (d) return d + 'd ' + h + 'h';
      if (h) return h + 'h ' + m + 'm';
      if (m) return m + 'm ' + s + 's';
      return s + 's';
    }
    function tick() { uptimeEl.textContent = formatUptime(Math.floor((Date.now() - started) / 1000)); }
    tick();
    setInterval(tick, 1000);

    function escape(v) { return String(v).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function highlight(obj) {
      return escape(JSON.stringify(obj, null, 2))
        .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
        .replace(/: (-?\\d+(\\.\\d+)?)/g, ': <span class="n">$1</span>');
    }
    var healthEl = document.getElementById('health'), statusEl = document.getElementById('status');
    function refresh() {
      fetch('/health', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (body) { healthEl.innerHTML = highlight(body); statusEl.textContent = body.status === 'ok' ? 'Online' : 'Degraded'; })
        .catch(function () { healthEl.textContent = 'Could not reach /health'; statusEl.textContent = 'Unreachable'; });
    }
    refresh();
    setInterval(refresh, 15000);
  })();
</script>
</body>
</html>`;
}
