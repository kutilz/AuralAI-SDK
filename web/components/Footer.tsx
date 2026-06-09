import { t } from "@/lib/i18n";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <p style={{ margin: 0, fontWeight: 600, color: "var(--ink-2)" }}>{t.footer.made}</p>
        <p style={{ margin: "8px 0 0" }}>{t.footer.offline}</p>
      </div>
    </footer>
  );
}
