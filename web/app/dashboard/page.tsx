import DashboardClient from "./DashboardClient";

export const metadata = {
  title: "Perangkat saya — AuralAI",
  description: "Pantau dan atur perangkat AuralAI yang sudah terhubung.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
