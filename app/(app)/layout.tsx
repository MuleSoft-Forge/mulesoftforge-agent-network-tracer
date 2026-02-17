import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();

  if (!session.authenticated) {
    redirect("/");
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      {children}
    </main>
  );
}
