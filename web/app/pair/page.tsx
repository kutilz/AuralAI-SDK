import { Suspense } from "react";
import PairClient from "./PairClient";

export const metadata = {
  title: "Hubungkan perangkat — AuralAI",
  description: "Masukkan kode yang diucapkan perangkat untuk menautkannya ke akunmu.",
};

export default function PairPage() {
  return (
    <Suspense fallback={<div className="container section">Memuat…</div>}>
      <PairClient />
    </Suspense>
  );
}
