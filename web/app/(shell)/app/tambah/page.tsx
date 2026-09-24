import { Suspense } from "react";
import AddClient from "./AddClient";

export const metadata = {
  title: "Tambah perangkat — AuralAI",
  description: "Hubungkan perangkat AuralAI ke aplikasi: otomatis lewat WiFi, pindai QR, atau kode suara.",
};

export default function AddDevicePage() {
  return (
    <Suspense fallback={<div className="app-body">Memuat…</div>}>
      <AddClient />
    </Suspense>
  );
}
