import { Suspense } from "react";
import DeviceClient from "./DeviceClient";

export const metadata = {
  title: "Pengaturan perangkat — AuralAI",
  description: "Status, pengaturan, dan kendali lokal satu perangkat AuralAI.",
};

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="app-body">Memuat…</div>}>
      <DeviceClient id={id} />
    </Suspense>
  );
}
