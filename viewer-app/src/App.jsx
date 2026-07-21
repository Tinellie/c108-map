import { lazy, Suspense, useEffect, useState } from "react";
import { AppBar, Box, Button, CircularProgress, FormControlLabel, Stack, Switch, Toolbar, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from "react-router-dom";

function lazyNamedPage(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const CrawlRunnerPage = lazyNamedPage(() => import("./pages/CrawlRunnerPage"), "CrawlRunnerPage");
const CirclesViewerPage = lazyNamedPage(() => import("./pages/CirclesViewerPage"), "CirclesViewerPage");
const MapEditorPage = lazyNamedPage(() => import("./pages/MapEditorPage"), "MapEditorPage");
const OsmMapPage = lazyNamedPage(() => import("./pages/OsmMapPage"), "OsmMapPage");

const NAV_ITEMS = [
  { path: "/viewer", label: "Viewer", isActive: (pathname) => pathname === "/viewer" || pathname === "/", userMode: true },
  { path: "/crawler", label: "Update Circle", isActive: (pathname) => pathname.startsWith("/crawler"), userMode: false },
  { path: "/osm-map", label: "OSM Map", isActive: (pathname) => pathname === "/osm-map", userMode: true },
  { path: "/map-editor", label: "Processing Booth", isActive: (pathname) => pathname.startsWith("/map-editor"), userMode: false },
  { path: "/edit-map", label: "Edit Map", isActive: (pathname) => pathname.startsWith("/edit-map"), userMode: false }
];

function PageFallback() {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: "60vh" }} role="status">
      <CircularProgress size={28} />
      <Typography color="text.secondary">Loading...</Typography>
    </Stack>
  );
}

export default function App() {
  const location = useLocation();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [isUserMode, setIsUserMode] = useState(true);

  const shouldCollapseNav = location.pathname === "/map-editor" || location.pathname === "/osm-map" || location.pathname === "/edit-map";
  const visibleNavItems = NAV_ITEMS.filter((item) => item.userMode || !isUserMode);

  useEffect(() => {
    if (!shouldCollapseNav) {
      setIsNavExpanded(false);
    }
  }, [shouldCollapseNav]);

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
              label="用户模式"
              sx={{ m: 0, ml: "auto", flexShrink: 0, whiteSpace: "nowrap" }}
            />
          </Stack>
        </Toolbar>
      </AppBar>
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