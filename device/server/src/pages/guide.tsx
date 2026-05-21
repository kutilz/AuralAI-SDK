import { render } from "preact";
import { A11yBar } from "../components/atoms/A11yBar";
import { SkipLink } from "../components/atoms/SkipLink";
import "../styles/global.css";

// C3 stub. Real /guide content lands in C4 — Hero + Storyboard +
// Hardware + Audio + Preference picker.
function GuideApp() {
  return (
    <div class="app-shell">
      <SkipLink />
      <A11yBar />
      <main id="main" class="page" style={{ padding: "var(--s-8) var(--s-5)" }}>
        <h1 class="section-title">AuralAI — Panduan</h1>
        <p class="section-sub">
          Halaman panduan publik sedang dibangun.
        </p>
      </main>
    </div>
  );
}

render(<GuideApp />, document.getElementById("root")!);
