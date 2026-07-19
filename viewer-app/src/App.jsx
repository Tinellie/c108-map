import { useEffect, useRef, useState } from "react";
import { AppBar, Box, Button, FormControlLabel, MenuItem, MenuList, Paper, Popper, Stack, Switch, Toolbar, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CrawlRunnerPage } from "./pages/CrawlRunnerPage";
import { CirclesViewerPage } from "./pages/CirclesViewerPage";
import { ConvertDataPage } from "./pages/ConvertDataPage";
import { MapPage } from "./pages/MapPage";
import { MapEditorPage } from "./pages/MapEditorPage";
import { OsmCanvasPage } from "./pages/OsmCanvasPage";
import { OsmMapPage } from "./pages/OsmMapPage";

export default function App() {
  const location = useLocation();
  const mapEditorNavButtonRef = useRef(null);
  const [isMapEditorNavExpanded, setIsMapEditorNavExpanded] = useState(false);
  const [isMapEditorMenuOpen, setIsMapEditorMenuOpen] = useState(false);
  const [isUserMode, setIsUserMode] = useState(true);

  const isViewer = location.pathname === "/viewer" || location.pathname === "/";
  const isCrawler = location.pathname.startsWith("/crawler");
  const isMap = location.pathname === "/map";
  const isOsmCanvas = location.pathname === "/osm-canvas";
  const isOsmMap = location.pathname === "/osm-map";
  const isMapEditor = location.pathname.startsWith("/map-editor");
  const shouldCollapseNav = location.pathname === "/map-editor" || location.pathname === "/map" || location.pathname === "/osm-canvas" || location.pathname === "/osm-map";
  const showOnlyViewerAndOsmMap = isUserMode;

  useEffect(() => {
    if (!shouldCollapseNav) {
      setIsMapEditorNavExpanded(false);
    }
  }, [shouldCollapseNav]);

  function openMapEditorMenu() {
    setIsMapEditorMenuOpen(true);
    setIsMapEditorNavExpanded(true);
  }

  function closeMapEditorMenu() {
    setIsMapEditorMenuOpen(false);
    if (shouldCollapseNav) {
      setIsMapEditorNavExpanded(false);
    }
  }

  function renderNavigation() {
    return (
      <AppBar
        position={shouldCollapseNav ? "fixed" : "sticky"}
        elevation={0}
        color="inherit"
        onMouseEnter={() => setIsMapEditorNavExpanded(true)}
        onMouseLeave={() => {
          if (!isMapEditorMenuOpen) {
            setIsMapEditorNavExpanded(false);
          }
        }}
        sx={{
          borderBottom: "1px solid #eadbc7",
          transform: shouldCollapseNav ? `translateY(${isMapEditorNavExpanded ? "0" : "calc(-100% + 6px)"})` : "translateY(0)",
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
                <Button
                  component={RouterLink}
                  to="/map"
                  variant={isMap ? "contained" : "text"}
                  color="primary"
                >
                  Map Editor 2
                </Button>
                <Button
                  component={RouterLink}
                  to="/osm-canvas"
                  variant={isOsmCanvas ? "contained" : "text"}
                  color="primary"
                >
                  OSM Canvas
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
              <>
                <Button
                  ref={mapEditorNavButtonRef}
                  component={RouterLink}
                  to="/map-editor"
                  variant={isMapEditor ? "contained" : "text"}
                  color="primary"
                  aria-haspopup="menu"
                  aria-expanded={isMapEditorMenuOpen ? "true" : undefined}
                  onMouseEnter={openMapEditorMenu}
                  onFocus={openMapEditorMenu}
                >
                  Map Editor
                </Button>
                <Popper
                  open={isMapEditorMenuOpen}
                  anchorEl={mapEditorNavButtonRef.current}
                  placement="bottom-start"
                  sx={{ zIndex: (theme) => theme.zIndex.appBar + 3 }}
                >
                  <Paper
                    elevation={4}
                    onMouseEnter={openMapEditorMenu}
                    onMouseLeave={closeMapEditorMenu}
                    sx={{ mt: 0.75, minWidth: 160, border: "1px solid #eadbc7" }}
                  >
                    <MenuList dense autoFocusItem={false} onMouseLeave={closeMapEditorMenu}>
                      <MenuItem component={RouterLink} to="/map-editor/convert-data" onClick={closeMapEditorMenu}>
                        转换数据
                      </MenuItem>
                    </MenuList>
                  </Paper>
                </Popper>
              </>
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
          onMouseEnter={() => setIsMapEditorNavExpanded(true)}
          sx={{ position: "fixed", top: 0, left: 0, right: 0, height: 12, zIndex: (theme) => theme.zIndex.appBar + 2 }}
        />
      ) : null}
      {renderNavigation()}

      <Routes>
        <Route path="/" element={<Navigate to="/viewer" replace />} />
        <Route path="/viewer" element={<CirclesViewerPage />} />
        <Route path="/crawler" element={<CrawlRunnerPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/osm-canvas" element={<OsmCanvasPage />} />
        <Route path="/osm-map" element={<OsmMapPage isUserMode={isUserMode} onUserModeChange={setIsUserMode} />} />
        <Route path="/map-editor/convert-data" element={<ConvertDataPage />} />
        <Route path="/map-editor" element={<MapEditorPage />} />
      </Routes>
    </Box>
  );
}