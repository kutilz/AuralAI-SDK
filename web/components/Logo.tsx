/**
 * AuralAI sound-ripple mark — a solid core with rings radiating out, the same
 * shape the PWA icons use (scripts/gen-icons.mjs). Teal, reads on light bg.
 */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Logo AuralAI"
      style={{ flex: "none" }}
    >
      <circle cx="50" cy="50" r="40" fill="none" stroke="#00635D" strokeWidth="3" opacity="0.25" />
      <circle cx="50" cy="50" r="26" fill="none" stroke="#00635D" strokeWidth="3.4" opacity="0.55" />
      <circle cx="50" cy="50" r="13" fill="none" stroke="#00635D" strokeWidth="3.6" opacity="0.9" />
      <circle cx="50" cy="50" r="6" fill="#00635D" />
    </svg>
  );
}
