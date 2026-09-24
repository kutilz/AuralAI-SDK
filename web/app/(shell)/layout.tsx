/**
 * App-shell chrome. No marketing nav or footer: once AuralAI is installed to the
 * home screen these pages ARE the app, and each screen carries its own AppBar.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Lewati ke konten utama
      </a>
      <main id="main">{children}</main>
    </div>
  );
}
