import { TooltipProvider } from "../ui/tooltip";
import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useMobile } from "@/hooks/use-mobile";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { TaskHeaderContext } from "./task-header-context";
import { DashboardDraftContext } from "./dashboard-draft";

export function Dashboard() {
  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
  const mobile = useMobile();
  const matchRoute = useMatchRoute();
  const home = Boolean(matchRoute({ to: "/app", fuzzy: false }));
  const settings = Boolean(matchRoute({ to: "/app/settings", fuzzy: true }));
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [draft, setDraft] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarOpen = mobile ? mobileOpen : desktopOpen;
  const setSidebarOpen = mobile ? setMobileOpen : setDesktopOpen;

  const closeSidebar = () => setSidebarOpen(false);

  const onNavigate = () => setMobileOpen(false);

  const sidebar = settings ? (
    <SettingsSidebar onNavigate={onNavigate} />
  ) : (
    <DashboardSidebar
      onToggle={closeSidebar}
      onNavigate={onNavigate}
      onNewChat={() => {
        setDraft((value) => value + 1);
        onNavigate();
      }}
    />
  );

  return (
    <TooltipProvider delay={300}>
      <DashboardDraftContext value={draft}>
        <div
          className={`dashboard ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
          data-home={home || undefined}
        >
          <Link className="skip-link" to="." hash="dashboard-content">
            Skip to dashboard content
          </Link>
          {!mobile && desktopOpen && sidebar}
          <Dialog.Root open={mobile && mobileOpen} onOpenChange={setMobileOpen}>
            <Dialog.Portal>
              <Dialog.Backdrop className="mobile-sidebar-backdrop" />
              <Dialog.Popup className="mobile-sidebar-popup" finalFocus={toggleRef}>
                <Dialog.Title className="sr-only">
                  {settings ? "Settings navigation" : "Dashboard navigation"}
                </Dialog.Title>
                <Dialog.Close className="sr-only">Close navigation</Dialog.Close>
                {sidebar}
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <main className="dashboard-main" id="dashboard-content" tabIndex={-1}>
            <DashboardHeader
              contentRef={setHeaderElement}
              settings={settings}
              sidebarOpen={sidebarOpen}
              toggleRef={toggleRef}
              onToggle={() => setSidebarOpen(!sidebarOpen)}
            />
            <TaskHeaderContext value={headerElement}>
              <Outlet />
            </TaskHeaderContext>
          </main>
        </div>
      </DashboardDraftContext>
    </TooltipProvider>
  );
}
