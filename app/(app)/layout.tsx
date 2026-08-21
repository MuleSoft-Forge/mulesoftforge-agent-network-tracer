import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import BugReportShell from "@/components/feedback/BugReportShell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await isAuthenticated())) {
    redirect("/");
  }

  return (
    <>
      <main className="min-h-0 flex-1 overflow-auto">
        {children}
      </main>
      <BugReportShell />
    </>
  );
}
