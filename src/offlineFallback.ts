export function offlineFallbackHtml(appUrl: string) {
  const escapedAppUrl = JSON.stringify(appUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Oneaction Offline</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #f6f5f3;
      --canvas-raised: #faf9f7;
      --parchment: #fff;
      --ink: #000;
      --inkwell: #111;
      --body: #1f1f1f;
      --muted: #00000080;
      --muted-soft: #0000004d;
      --rule: #00000014;
      --rule-strong: #00000024;
      --coral-pink: #fd538f;
      --coral-red: #fc4e63;
      --coral-amber: #fda72a;
      --coral-shadow: #fd528129;
      --radius: 20px;
      --shadow-soft: 0 41px 80px 0 rgba(0,0,0,.03), 0 17px 33px rgba(0,0,0,.02), 0 5px 10px rgba(0,0,0,.01);
      --shadow-float: 0 18px 48px rgba(0,0,0,.08), 0 3px 12px rgba(0,0,0,.05);
      --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    * { box-sizing: border-box; }

    html,
    body { min-height: 100%; }

    body {
      margin: 0;
      background: var(--canvas);
      color: var(--inkwell);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    button {
      font: inherit;
      letter-spacing: inherit;
    }

    .app {
      min-height: 100vh;
      position: relative;
      overflow: hidden;
      background: var(--canvas);
    }

    .app.is-dragging::after {
      content: "";
      position: fixed;
      inset: 18px;
      border: 1px dashed rgba(252, 78, 99, .44);
      border-radius: 22px;
      background: rgba(253, 83, 143, .035);
      pointer-events: none;
    }

    .center-note {
      position: absolute;
      inset: 24px;
      display: grid;
      place-items: center;
    }

    .offline-card {
      width: min(440px, 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 30px;
    }

    .hero-mark {
      width: 56px;
      height: 56px;
      margin-bottom: 18px;
      color: var(--inkwell);
    }

    .offline-card h1 {
      margin: 0;
      color: var(--inkwell);
      font-size: 28px;
      line-height: 1.05;
      letter-spacing: -.03em;
      font-weight: 800;
    }

    .offline-card p {
      margin: 10px 0 0;
      max-width: 340px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    .drop-hint {
      margin-top: 16px;
      color: var(--muted-soft);
      font-size: 12px;
      font-weight: 600;
    }

    .drop-hint.active {
      color: var(--coral-red);
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .hero-actions {
      margin-top: 22px;
      justify-content: center;
    }

    .pill {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 999px;
      padding: 0 16px;
      cursor: pointer;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      transition: transform .2s, box-shadow .25s, background .25s, color .25s;
    }

    .pill:hover {
      transform: translateY(-1px);
    }

    .pill:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(252, 78, 99, .28);
    }

    .pill-black {
      background: var(--ink);
      color: #fff;
    }

    .pill-black:hover {
      background: #1f1f1f;
    }

    .pill-coral {
      color: #fff;
      background-image: linear-gradient(49deg, var(--coral-pink) 3%, var(--coral-red) 48%, var(--coral-amber) 102%);
      text-shadow: 0 0 3px rgba(0,0,0,.16);
      box-shadow: 0 4px 12px var(--coral-shadow), inset 0 2px 1px rgba(255,255,255,.25), inset 0 4px 4px rgba(255,255,255,.25);
    }

    .pill-coral:hover {
      box-shadow: 0 8px 18px var(--coral-shadow), inset 0 2px 1px rgba(255,255,255,.3), inset 0 4px 4px rgba(255,255,255,.3);
    }

    .pill-soft {
      background: rgba(0,0,0,.045);
      color: var(--inkwell);
    }

    .pill-soft:hover {
      background: rgba(0,0,0,.075);
    }

    .pill-plain {
      background: transparent;
      color: var(--muted);
      padding-inline: 10px;
    }

    .pill-plain:hover {
      background: transparent;
      color: var(--inkwell);
      transform: none;
    }

    .pill-danger {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--rule);
    }

    .pill-danger:hover {
      color: var(--coral-red);
      background: rgba(252, 78, 99, .06);
    }

    .queue {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: none;
      place-items: center;
      padding: 24px;
      background: rgba(246, 245, 243, .72);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .queue[data-open="true"] {
      display: grid;
    }

    .panel {
      width: min(520px, 100%);
      max-height: min(560px, calc(100vh - 48px));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid var(--rule);
      border-radius: 18px;
      background: var(--parchment);
      box-shadow: 0 24px 70px rgba(0,0,0,.10), 0 4px 14px rgba(0,0,0,.06);
    }

    .panel-head {
      padding: 20px 22px 14px;
    }

    .modal-title {
      margin: 0;
      color: var(--inkwell);
      font-size: 18px;
      line-height: 1.25;
      letter-spacing: -.01em;
      font-weight: 700;
    }

    .summary {
      margin: 5px 0 0;
      max-width: 420px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .panel-body {
      min-height: 220px;
      overflow: auto;
      padding: 0 22px 18px;
    }

    .status-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 4px 0 16px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .status-item {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .status-item b {
      color: var(--inkwell);
      font-size: 13px;
      font-weight: 650;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--coral-red);
      box-shadow: 0 0 0 3px rgba(252, 78, 99, .10);
    }

    .status-dot.online {
      background: #16a34a;
      box-shadow: 0 0 0 3px rgba(22, 163, 74, .10);
    }

    .status-separator {
      color: var(--rule-strong);
    }

    .rows {
      overflow: visible;
      border: 1px solid var(--rule);
      border-radius: 12px;
      background: var(--canvas-raised);
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 13px 14px;
      border-bottom: 1px solid var(--rule);
      background: #fff;
    }

    .row:last-child {
      border-bottom: 0;
    }

    .row-main {
      min-width: 0;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-size: 14px;
      font-weight: 650;
      letter-spacing: 0;
    }

    .kind {
      flex: 0 0 auto;
      border-radius: 999px;
      background: rgba(0,0,0,.06);
      color: var(--muted);
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 12px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .empty {
      min-height: 154px;
      display: grid;
      place-items: center;
      padding: 30px 22px;
      text-align: center;
      background: transparent;
    }

    .empty strong {
      display: block;
      color: var(--inkwell);
      font-size: 15px;
      font-weight: 650;
      letter-spacing: -.01em;
    }

    .empty p {
      margin: 8px auto 0;
      max-width: 280px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .panel-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px 20px;
      border-top: 1px solid var(--rule);
      background: var(--parchment);
    }

    @media (max-width: 640px) {
      .offline-card {
        padding: 26px 22px;
      }
      .actions {
        justify-content: flex-start;
      }
      .hero-actions {
        justify-content: center;
      }
      .panel-footer,
      .row {
        flex-wrap: wrap;
        justify-content: flex-start;
      }
      .panel-head { padding: 20px 20px 12px; }
      .panel-body { padding: 0 20px 16px; }
      .panel-footer { padding: 14px 20px 18px; }
      .row { padding: 15px 20px; }
      .name {
        white-space: normal;
        overflow-wrap: anywhere;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="center-note">
      <div class="offline-card" aria-live="polite">
        <svg class="hero-mark" viewBox="0 0 40 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M20 0C31.0458 0 39.9999 8.95426 40 20C40 31.0458 31.0458 40 20 40C18.6796 40 17.3895 39.8702 16.1406 39.626V29.416C16.1492 29.4195 16.1584 29.4223 16.167 29.4258V22.6328L25.7568 14.7285V28.3896C28.4251 26.5552 30.1758 23.4826 30.1758 20C30.1757 14.3803 25.6197 9.82422 20 9.82422C14.3804 9.82435 9.82434 14.3804 9.82422 20C9.82422 23.3909 11.485 26.3921 14.0352 28.2412V39.0957C5.90279 36.558 0 28.9683 0 20C0.000119155 8.95434 8.95435 0.000129512 20 0Z"></path>
        </svg>
        <h1 id="heroTitle">Saved locally.</h1>
        <p id="heroText">Captures are saved on this device. Retry when Oneaction is back online.</p>
        <div class="drop-hint" id="dropHint">Drop a PDF/EPUB or paste a link</div>
        <div class="actions hero-actions">
          <button class="pill pill-soft" id="viewQueue">View queue</button>
          <button class="pill pill-coral" id="retryApp">Retry</button>
        </div>
      </div>
    </section>
  </main>

  <section class="queue" id="queue" aria-hidden="true">
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="queueTitle">
      <header class="panel-head">
        <div>
          <h2 class="modal-title" id="queueTitle">Offline queue</h2>
          <p class="summary" id="summary">Loading captures.</p>
        </div>
      </header>
      <div class="panel-body">
        <div class="status-line">
          <span class="status-item">
            <span class="status-dot" id="connectionDot"></span>
            <span><b id="connection">Offline</b></span>
          </span>
          <span class="status-separator">/</span>
          <span class="status-item"><b id="queuedCount">0</b> queued</span>
          <span class="status-separator">/</span>
          <span class="status-item"><b id="deliveredCount">0</b> delivered</span>
        </div>
        <div class="rows" id="rows"></div>
      </div>
      <footer class="panel-footer">
        <button class="pill pill-plain" id="refresh">Refresh</button>
        <button class="pill pill-plain" id="closeQueue">Close</button>
        <button class="pill pill-black" id="retryAppPanel">Retry app</button>
      </footer>
    </div>
  </section>

  <script>
    const appUrl = ${escapedAppUrl};
    const desktop = window.oneactionDesktop;
    let outbox = [];
    let syncStatus = null;

    const nodes = {
      heroTitle: document.getElementById("heroTitle"),
      heroText: document.getElementById("heroText"),
      app: document.querySelector(".app"),
      dropHint: document.getElementById("dropHint"),
      queue: document.getElementById("queue"),
      viewQueue: document.getElementById("viewQueue"),
      closeQueue: document.getElementById("closeQueue"),
      retryApp: document.getElementById("retryApp"),
      retryAppPanel: document.getElementById("retryAppPanel"),
      refresh: document.getElementById("refresh"),
      summary: document.getElementById("summary"),
      rows: document.getElementById("rows"),
      connection: document.getElementById("connection"),
      connectionDot: document.getElementById("connectionDot"),
      queuedCount: document.getElementById("queuedCount"),
      deliveredCount: document.getElementById("deliveredCount"),
    };

    function openQueue() {
      nodes.queue.dataset.open = "true";
      nodes.queue.setAttribute("aria-hidden", "false");
      nodes.closeQueue.focus();
    }

    function closeQueue() {
      nodes.queue.dataset.open = "false";
      nodes.queue.setAttribute("aria-hidden", "true");
      nodes.viewQueue.focus();
    }

    function retryApp() {
      if (desktop) desktop.retryAppLoad();
    }

    function normalizeUrl(text) {
      try {
        const url = new URL(text.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.toString();
      } catch {
        return null;
      }
    }

    function showHint(message, isActive = false) {
      nodes.dropHint.textContent = message;
      nodes.dropHint.classList.toggle("active", isActive);
    }

    function setDragging(isDragging) {
      nodes.app.classList.toggle("is-dragging", isDragging);
      showHint(
        isDragging
          ? "Release to save locally"
          : "Drop a PDF/EPUB or paste a link",
        isDragging,
      );
    }

    function formatDate(value) {
      if (!value) return "never";
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(value));
      } catch {
        return value;
      }
    }

    function formatSize(bytes) {
      if (!Number.isFinite(bytes)) return "";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
      return (bytes / 1024 / 1024).toFixed(1) + " MB";
    }

    function titleFor(item) {
      if (item.kind === "url") {
        try {
          const url = new URL(item.url);
          return url.hostname.replace(/^www\\./, "") + url.pathname;
        } catch {
          return item.url;
        }
      }
      return item.name;
    }

    function metaFor(item) {
      const parts = [
        "attempts " + (item.deliveryAttempts || 0),
        "created " + formatDate(item.createdAt),
      ];
      if (item.lastDeliveredAt) parts.push("last delivered " + formatDate(item.lastDeliveredAt));
      if (item.kind === "file") parts.push(formatSize(item.size));
      if (item.lastError) parts.push(item.lastError);
      return parts;
    }

    function renderStatus() {
      const queued = syncStatus ? syncStatus.queuedCount : outbox.filter((item) => item.status === "queued").length;
      const delivered = syncStatus ? syncStatus.deliveredCount : outbox.filter((item) => item.status === "delivered").length;
      const online = syncStatus ? syncStatus.online : navigator.onLine;
      const count = outbox.length;

      nodes.heroTitle.textContent = online ? "Reconnecting." : "Saved locally.";
      nodes.heroText.textContent = count === 0
        ? "Captures are saved on this device. Retry when Oneaction is back online."
        : count + " local " + (count === 1 ? "capture is" : "captures are") + " waiting.";
      nodes.connection.textContent = online ? "Online" : "Offline";
      nodes.connectionDot.classList.toggle("online", online);
      nodes.queuedCount.textContent = String(queued);
      nodes.deliveredCount.textContent = String(delivered);
      nodes.summary.textContent = count === 0
        ? "No captures are waiting. Retry opens Oneaction again."
        : count + " " + (count === 1 ? "capture is" : "captures are") + " stored on this device. Retry opens " + appUrl + ".";
    }

    function renderRows() {
      if (outbox.length === 0) {
        nodes.rows.innerHTML = '<div class="empty"><div><strong>No local captures.</strong><p>Use the shortcut or open a PDF while offline and it will appear here.</p></div></div>';
        return;
      }

      nodes.rows.replaceChildren(...outbox.map((item) => {
        const row = document.createElement("article");
        row.className = "row";

        const main = document.createElement("div");
        main.className = "row-main";

        const title = document.createElement("div");
        title.className = "title";

        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = item.kind;

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = titleFor(item);
        title.append(kind, name);

        const meta = document.createElement("div");
        meta.className = "meta";

        for (const part of metaFor(item)) {
          const span = document.createElement("span");
          span.textContent = part;
          meta.append(span);
        }

        main.append(title, meta);

        const actions = document.createElement("div");
        actions.className = "actions";

        const open = document.createElement("button");
        open.className = "pill pill-plain";
        open.textContent = item.kind === "url" ? "Open source" : "Open";
        open.addEventListener("click", async () => {
          open.disabled = true;
          await desktop.openCaptureOutboxItem(item.id);
          open.disabled = false;
        });

        const remove = document.createElement("button");
        remove.className = "pill pill-danger";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          outbox = await desktop.removeCaptureOutboxItem(item.id);
          render();
        });

        actions.append(open, remove);
        row.append(main, actions);
        return row;
      }));
    }

    function render() {
      renderStatus();
      renderRows();
    }

    async function refresh() {
      if (!desktop) return;
      const [items, status] = await Promise.all([
        desktop.getCaptureOutbox(),
        desktop.getSyncStatus(),
      ]);
      outbox = items;
      syncStatus = status;
      render();
    }

    nodes.viewQueue.addEventListener("click", openQueue);
    nodes.closeQueue.addEventListener("click", closeQueue);
    nodes.retryApp.addEventListener("click", retryApp);
    nodes.retryAppPanel.addEventListener("click", retryApp);
    nodes.refresh.addEventListener("click", refresh);
    nodes.queue.addEventListener("click", (event) => {
      if (event.target === nodes.queue) closeQueue();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nodes.queue.dataset.open === "true") {
        closeQueue();
      }
    });

    if (!desktop) {
      nodes.heroTitle.textContent = "Bridge unavailable.";
      nodes.heroText.textContent = "Restart Oneaction and try again.";
    } else {
      desktop.onCaptureOutboxChanged((items) => {
        outbox = items;
        render();
      });
      desktop.onSyncStatusChanged((status) => {
        syncStatus = status;
        render();
      });
      desktop.onRecoveryStatusChanged((status) => {
        showHint(status.message, status.checking);
      });
      desktop.onFileDragChanged((isDragging) => {
        setDragging(isDragging);
      });
      desktop.onDroppedFilesCaptured(async (items) => {
        outbox = items;
        await refresh();
        openQueue();
      });
      desktop.onOpenOfflineQueue(async () => {
        await refresh();
        openQueue();
      });
      window.addEventListener("paste", async (event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const url = normalizeUrl(text);
        if (!url) return;
        event.preventDefault();
        outbox = await desktop.captureUrl(url);
        showHint("Link saved locally", true);
        await refresh();
        openQueue();
        window.setTimeout(() => {
          showHint("Drop a PDF/EPUB or paste a link");
        }, 1600);
      });
      refresh();
    }
  </script>
</body>
</html>`;
}
