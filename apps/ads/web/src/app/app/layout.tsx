import { AppShell } from "@/components/app-shell";
import { WorkspaceProvider } from "@/components/cockpit/workspace-context";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
