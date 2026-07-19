import { useEffect, useState } from "react";
import { AppBar, Box, Button, FormControlLabel, Stack, Switch, Toolbar, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CrawlRunnerPage } from "./pages/CrawlRunnerPage";
import { CirclesViewerPage } from "./pages/CirclesViewerPage";
import { MapEditorPage } from "./pages/MapEditorPage";
import { OsmMapPage } from "./pages/OsmMapPage";

export default function App() {
  const location = useLocation();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [isUserMode, setIsUserMode] = useState(true);

  const isViewer = location.pathname === "/viewer" || location.pathname === "/";
  const isCrawler = location.pathname.startsWith("/crawler");
  const isOsmMap = location.pathname === "/osm-map";
  const isMapEditor = location.pathname.startsWith("/map-editor");
  const shouldCollapseNav = location.pathname === "/map-editor" || location.pathname === "/osm-map";
  const showOnlyViewerAndOsmMap = isUserMode;

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
            <Button
              component={RouterLink}
              to="/viewer"
              variant={isViewer ? "contained" : "text"}
              color="primary"
            >
              Viewer
            </Button>
            {!showOnlyViewerAndOsmMap ? (
              <>
                <Button
                  component={RouterLink}
                  to="/crawler"
                  variant={isCrawler ? "contained" : "text"}
                  color="primary"
                >
                  Crawl Runner
                </Button>
              </>
            ) : null}
            <Button
              component={RouterLink}
              to="/osm-map"
              variant={isOsmMap ? "contained" : "text"}
              color="primary"
            >
              OSM Map
            </Button>
            {!showOnlyViewerAndOsmMap ? (
              <Button
                component={RouterLink}
                to="/map-editor"
                variant={isMapEditor ? "contained" : "text"}
                color="primary"
              >
                Map Editor
              </Button>
            ) : null}
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

      <Routes>
        <Route path="/" element={<Navigate to="/viewer" replace />} />
        <Route path="/viewer" element={<CirclesViewerPage />} />
        <Route path="/crawler" element={<CrawlRunnerPage />} />
        <Route path="/osm-map" element={<OsmMapPage isUserMode={isUserMode} onUserModeChange={setIsUserMode} />} />
        <Route path="/map-editor" element={<MapEditorPage />} />
      </Routes>
    </Box>
  );
}