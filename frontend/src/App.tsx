import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { LandingPage } from "@/pages/LandingPage";
import { AgentHomePage } from "@/pages/AgentHomePage";
import { RunPage } from "@/pages/RunPage";
import { ApplicationsPage } from "@/pages/ApplicationsPage";
import { ApplicationDetailPage } from "@/pages/ApplicationDetailPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <Toaster>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/app" element={<AppShell />}>
                <Route index element={<AgentHomePage />} />
                <Route path="runs/:id" element={<RunPage />} />
                <Route path="applications" element={<ApplicationsPage />} />
                <Route path="applications/:id" element={<ApplicationDetailPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="*" element={<NotFoundPage inApp />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </Toaster>
      </TooltipProvider>
    </MotionConfig>
  );
}
