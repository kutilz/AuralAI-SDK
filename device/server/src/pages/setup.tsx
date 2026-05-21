import { render } from "preact";
import { A11yBar } from "../components/atoms/A11yBar";
import { SkipLink } from "../components/atoms/SkipLink";
import { ensureToken } from "../lib/api";
import "../styles/global.css";

// C3 stub. Real setup wizard lands in C5.
function SetupApp() {
  return (
    <div class="app-shell">
      <SkipLink />
      <A11yBar />
      <main id="main" class="page" style={{ padding: "var(--s-8) var(--s-5)" }}>
        <h1 class="section-title">Pengaturan awal</h1>
        <p class="section-sub">Wizard sedang dibangun.</p>
      </main>
    </div>
  );
}

ensureToken().finally(() => {
  render(<SetupApp />, document.getElementById("root")!);
});
