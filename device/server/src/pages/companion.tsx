import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { A11yBar } from "../components/atoms/A11yBar";
import { SkipLink } from "../components/atoms/SkipLink";
import { Icon } from "../components/atoms/Icon";
import { StatusBanner } from "../components/companion/StatusBanner";
import { LiveView } from "../components/companion/LiveView";
import { ModeSwitcher, type Mode } from "../components/companion/ModeSwitcher";
import { VolumeControl } from "../components/companion/VolumeControl";
import { QuickStatus } from "../components/companion/QuickStatus";
import { ActivityFeed } from "../components/companion/ActivityFeed";
import { ReportFooter } from "../components/companion/ReportFooter";
import type { DeviceStatus, HistoryItem } from "../components/companion/types";
import { usePolling } from "../lib/polling";
import { apiPost, ensureToken } from "../lib/api";
import { t } from "../lib/i18n";
import "../styles/global.css";

function CompanionApp() {
  const { data: status, online } = usePolling<DeviceStatus>("/status", 1000);
  const { data: history } = usePolling<{ items: HistoryItem[] }>(
    "/history?date=today",
    5000,
  );

  // Optimistic mode override — clear once /status confirms.
  const [optimisticMode, setOptimisticMode] = useState<Mode | null>(null);
  useEffect(() => {
    if (status && optimisticMode && status.mode === optimisticMode) {
      setOptimisticMode(null);
    }
  }, [status, optimisticMode]);

  // Keyboard shortcuts 1/2/3 (mode), +/- (volume ±10), ? (help)
  useEffect(() => {
    const tag = (n: string) => n.toLowerCase();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField =
        target &&
        (["input", "textarea", "select"].includes(tag(target.tagName)) ||
          target.isContentEditable);
      if (inField) return;
      if (e.key === "1") {
        apiPost("/command", { cmd: "set_mode", mode: "explorer" }).catch(
          () => {},
        );
        setOptimisticMode("explorer");
      } else if (e.key === "2") {
        apiPost("/command", { cmd: "set_mode", mode: "context" }).catch(
          () => {},
        );
        setOptimisticMode("context");
      } else if (e.key === "3") {
        apiPost("/command", { cmd: "set_mode", mode: "qris" }).catch(
          () => {},
        );
        setOptimisticMode("qris");
      } else if (e.key === "+" || e.key === "=") {
        const v = Math.min(100, (status as DeviceStatus | null)
          ? // best-effort guess if no real volume in /status yet
            80
          : 80);
        apiPost("/config", { audio_volume: v + 10 }).catch(() => {});
      } else if (e.key === "-" || e.key === "_") {
        apiPost("/config", { audio_volume: 70 }).catch(() => {});
      } else if (e.key === "?") {
        alert(
          "Pintasan keyboard:\n" +
            "1 / 2 / 3 — ganti mode (Jelajah / Deskripsi / QRIS)\n" +
            "+ / − — ubah volume ±10\n" +
            "Tab — navigasi ke kontrol berikutnya",
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  const mode: Mode = optimisticMode ?? (status?.mode ?? "explorer");
  const volume = 80; // /status doesn't currently expose audio_volume; show a default. Slider state remembers user input post-edit.
  const audioMode = status?.audio_mode ?? "both";

  return (
    <div class="app-shell">
      <SkipLink />
      <A11yBar />

      <header class="app-header">
        <div class="app-header__logo">
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--accent)",
              color: "var(--ink-inverse)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="glasses" size={20} />
          </span>
          <span>
            <div style={{ fontWeight: 700 }}>AuralAI</div>
            <div style={{ fontSize: "var(--t-xs)", color: "var(--ink-3)" }}>
              {t("nav.companion")}
            </div>
          </span>
        </div>
        <span class="app-header__spacer" />
        <nav aria-label="Menu utama" style={{ display: "flex", gap: 4 }}>
          <a
            href="/setup"
            style={{
              padding: "10px 14px",
              borderRadius: "var(--r-md)",
              color: "var(--ink-3)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "var(--t-sm)",
            }}
          >
            {t("nav.setup")}
          </a>
          <a
            href="/guide"
            style={{
              padding: "10px 14px",
              borderRadius: "var(--r-md)",
              color: "var(--ink-3)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "var(--t-sm)",
            }}
          >
            {t("nav.guide")}
          </a>
        </nav>
        <span
          class={`badge badge--${online ? "ok" : "danger"}`}
          aria-live="polite"
        >
          <span class={`dot dot--${online ? "ok" : "danger"}`} />{" "}
          {online ? t("common.online") : t("common.offline")}
        </span>
      </header>

      <main
        id="main"
        style={{
          padding: "var(--s-5)",
          display: "grid",
          gap: "var(--s-5)",
          maxWidth: 1400,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <StatusBanner online={online} status={status} />

        <div
          style={{
            display: "grid",
            gap: "var(--s-5)",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
            alignItems: "start",
          }}
          class="companion-grid"
        >
          <div style={{ display: "grid", gap: "var(--s-5)" }}>
            <LiveView status={status} />
            <ActivityFeed items={history?.items ?? []} />
          </div>
          <div style={{ display: "grid", gap: "var(--s-5)" }}>
            <ModeSwitcher active={mode} onOptimistic={setOptimisticMode} />
            <VolumeControl initialVolume={volume} initialMode={audioMode} />
            <QuickStatus status={status} />
          </div>
        </div>

        <ReportFooter />

        <footer
          style={{
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: "var(--t-xs)",
            padding: "var(--s-4) 0 var(--s-6)",
          }}
        >
          AuralAI · Sesuai WCAG 2.1 AA ·{" "}
          <a href="/admin" style={{ color: "var(--ink-3)" }}>
            {t("nav.admin")}
          </a>
        </footer>
      </main>

      <style>{`
        @media (max-width: 900px) {
          .companion-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

ensureToken().finally(() => {
  render(<CompanionApp />, document.getElementById("root")!);
});
