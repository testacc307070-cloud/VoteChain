import { redirect } from "next/navigation";
import DashboardClient from "@/components/dashboard-client";
import { getCurrentUser } from "@/lib/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/portal");

  return <DashboardClient displayName={user.name} role={user.role} />;
}