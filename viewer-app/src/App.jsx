import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppBar, Box, Button, CircularProgress, FormControlLabel, Stack, Switch, Toolbar, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { withApiBaseUrl } from "./utils/apiBase.js";

function lazyNamedPage(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const CrawlRunnerPage = lazyNamedPage(() => import("./pages/CrawlRunnerPage"), "CrawlRunnerPage");
const CirclesViewerPage = lazyNamedPage(() => import("./pages/CirclesViewerPage"), "CirclesViewerPage");
const MapEditorPage = lazyNamedPage(() => import("./pages/MapEditorPage"), "MapEditorPage");
const OsmMapPage = lazyNamedPage(() => import("./pages/OsmMapPage"), "OsmMapPage");
const LoginPage = lazyNamedPage(() => import("./pages/LoginPage"), "LoginPage");

const AUTH_ME_API = withApiBaseUrl("/api/auth/me");
const AUTH_LOGOUT_API = withApiBaseUrl("/api/auth/logout");

const NAV_ITEMS = [
  { path: "/viewer", label: "社团", isActive: (pathname) => pathname === "/viewer" || pathname === "/", userMode: true },
  { path: "/crawler", label: "更新社团", isActive: (pathname) => pathname.startsWith("/crawler"), userMode: false },
  { path: "/osm-map", label: "OSM地图", isActive: (pathname) => pathname === "/osm-map", userMode: true },
  { path: "/map-editor", label: "展位处理", isActive: (pathname) => pathname.startsWith("/map-editor"), userMode: false },
  { path: "/edit-map", label: "地图编辑", isActive: (pathname) => pathname.startsWith("/edit-map"), userMode: false }
];

function PageFallback() {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: "60vh" }} role="status">
      <CircularProgress size={28} />
      <Typography color="text.secondary">加载中...</Typography>
    </Stack>
  );
}

export default function App() {
  const location = useLocation();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [isUserMode, setIsUserMode] = useState(true);
  const [authState, setAuthState] = useState({ status: "checking" });

  const shouldCollapseNav = location.pathname === "/map-editor" || location.pathname === "/osm-map" || location.pathname === "/edit-map";
  const visibleNavItems = NAV_ITEMS.filter((item) => item.userMode || !isUserMode);

  useEffect(() => {
    if (!shouldCollapseNav) {
      setIsNavExpanded(false);
    }
  }, [shouldCollapseNav]);

  const checkCurrentUser = useCallback(async () => {
    try {
      const response = await fetch(AUTH_ME_API);
      if (!response.ok) {
        throw new Error("unauthorized");
      }

      const json = await response.json().catch(() => ({}));
      setAuthState({
        status: "authenticated",
        user: json?.data?.user || null
      });
      return true;
    } catch {
      setAuthState({ status: "unauthenticated", user: null });
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) {
        return;
      }
      await checkCurrentUser();
    })();

    return () => {
      cancelled = true;
    };
  }, [checkCurrentUser]);

  async function handleLogout() {
    try {
      await fetch(AUTH_LOGOUT_API, { method: "POST" });
    } catch {
      // keep client-side logout flow even if request fails
    }

    setAuthState({ status: "unauthenticated", user: null });
  }

  function renderNavigation() {
    return (
      <AppBar
        position={shouldCollapseNav ? "fixed" : "sticky"}
        elevation={0}
        color="inherit"
        onMouseEnter={() => setIsNavExpanded(true)}
        onMouseLeave={() => setIsNavExpanded(false)}
        sx={{
          borderBottom: "1px solid #eadbc7",
          transform: shouldCollapseNav ? `translateY(${isNavExpanded ? "0" : "calc(-100% + 6px)"})` : "translateY(0)",
          transition: "transform 180ms ease",
          zIndex: (theme) => theme.zIndex.appBar + 1
        }}
      >
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 2, color: "primary.main" }}>
            Circle Toolkit
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flex: 1, alignItems: "center" }}>
            {visibleNavItems.map((item) => (
              <Button
                key={item.path}
                component={RouterLink}
                to={item.path}
                variant={item.isActive(location.pathname) ? "contained" : "text"}
                color="primary"
              >
                {item.label}
              </Button>
            ))}
            <Box sx={{ flex: 1 }} />
            <FormControlLabel
              control={<Switch size="small" checked={isUserMode} onChange={(event) => setIsUserMode(event.target.checked)} />}
              label="浏览模式"
              sx={{ m: 0, ml: "auto", flexShrink: 0, whiteSpace: "nowrap" }}
            />
            <Button size="small" color="inherit" onClick={handleLogout}>退出</Button>
          </Stack>
        </Toolbar>
      </AppBar>
    );
  }

  if (authState.status === "checking") {
    return <PageFallback />;
  }

  if (authState.status !== "authenticated") {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage onLoginSuccess={checkCurrentUser} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {shouldCollapseNav ? (
        <Box
          onMouseEnter={() => setIsNavExpanded(true)}
          sx={{ position: "fixed", top: 0, left: 0, right: 0, height: 12, zIndex: (theme) => theme.zIndex.appBar + 2 }}
        />
      ) : null}
      {renderNavigation()}

      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/viewer" replace />} />
          <Route path="/login" element={<Navigate to="/viewer" replace />} />
          <Route path="/viewer" element={<CirclesViewerPage />} />
          <Route path="/crawler" element={<CrawlRunnerPage />} />
          <Route path="/osm-map" element={<OsmMapPage isUserMode={true} enableEditTools={false} />} />
          <Route path="/map-editor" element={<MapEditorPage />} />
          <Route path="/edit-map" element={<OsmMapPage isUserMode={isUserMode} enableEditTools={!isUserMode} />} />
        </Routes>
      </Suspense>
    </Box>
  );
}