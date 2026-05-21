import { render } from "preact";
import { A11yBar } from "../components/atoms/A11yBar";
import { SkipLink } from "../components/atoms/SkipLink";
import { ensureToken } from "../lib/api";
import "../styles/global.css";

// C3 stub. Real content lands in C6 — companion dashboard with status
// banner, live view, mode switcher, volume, activity feed, etc.
function CompanionApp() {
  return (
    <div class="app-shell">
      <SkipLink />
      <A11yBar />
      <main id="main" class="page" style={{ padding: "var(--s-8) var(--s-5)" }}>
        <h1 class="section-title">Beranda pendamping</h1>
        <p class="section-sub">
          Halaman ini akan menjadi dashboard pendamping. Sedang dibangun —
          sementara silakan ke{" "}
          <a href="/admin/legacy" style="color: var(--accent)">
            mode lanjutan
          </a>{" "}
          atau{" "}
          <a href="/guide" style="color: var(--accent)">
            panduan
          </a>
          .
        </p>
      </main>
    </div>
  );
}

ensureToken().finally(() => {
  render(<CompanionApp />, document.getElementById("root")!);
});
