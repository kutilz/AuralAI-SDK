import Link from "next/link";
import { getAllDocs } from "@/lib/docs";
import DocsSidebar from "@/components/DocsSidebar";

export const metadata = {
  title: "Panduan AuralAI",
  description: "Cara menyalakan, menghubungkan, dan memakai AuralAI.",
};

export default function DocsIndex() {
  const docs = getAllDocs();
  return (
    <div className="container docs-layout">
      <DocsSidebar docs={docs} />
      <div className="prose">
        <h1>Panduan AuralAI</h1>
        <p>Pilih topik untuk mulai membaca.</p>
        <div className="grid" style={{ marginTop: "var(--s-6)" }}>
          {docs.map((d) => (
            <Link key={d.slug} href={`/docs/${d.slug}`} className="card" style={{ display: "block" }}>
              <h3 style={{ margin: "0 0 6px" }}>{d.title}</h3>
              <p style={{ margin: 0, color: "var(--ink-2)" }}>{d.summary}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
