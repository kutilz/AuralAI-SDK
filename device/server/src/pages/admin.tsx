import { render } from "preact";
import { A11yBar } from "../components/atoms/A11yBar";
import { SkipLink } from "../components/atoms/SkipLink";
import { ensureToken } from "../lib/api";
import { t } from "../lib/i18n";
import "../styles/global.css";

// C3 stub. Real admin layout lands in C7 — companion-dashboard embed +
// dev sidebar + role switcher + debug overlay.
function AdminApp() {
  return (
    <div class="app-shell">
      <div class="ribbon" role="status">
        ⚠ {t("admin.ribbon")}
      </div>
      <SkipLink />
      <A11yBar />
      <main id="main" class="page" style={{ padding: "var(--s-8) var(--s-5)" }}>
        <h1 class="section-title">Mode admin</h1>
        <p class="section-sub">
          Halaman admin baru sedang dibangun. Sementara, dashboard operator lama
          tetap berfungsi di{" "}
          <a href="/admin/legacy" style="color: var(--accent)">
            /admin/legacy
          </a>
          .
        </p>
      </main>
    </div>
  );
}

ensureToken().finally(() => {
  render(<AdminApp />, document.getElementById("root")!);
});
