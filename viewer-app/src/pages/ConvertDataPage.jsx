import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Container, Paper, Stack, TextField, Typography } from "@mui/material";

const MAP_EDITOR_SNAPSHOTS_API = import.meta.env.VITE_MAP_EDITOR_SNAPSHOTS_API_URL || "http://127.0.0.1:3000/api/map/editor-snapshots";

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

function getPageName(page) {
  return String(page?.name || page?.title || page?.image || `Page ${page?.page || ""}`).trim();
}

function createPageItems(pages) {
  return pages.map((page, index) => ({
    id: String(page?.page ?? index + 1),
    pageNumber: Number(page?.page || index + 1),
    name: getPageName(page) || `Page ${index + 1}`,
    enabled: true,
    outputNumber: String(index + 1)
  }));
}

export function ConvertDataPage() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [convertMessage, setConvertMessage] = useState("");

  const selectedCount = useMemo(() => items.filter((item) => item.enabled).length, [items]);

  useEffect(() => {
    let isMounted = true;

    async function loadLatestSnapshot() {
      setIsLoading(true);
      setLoadError("");
      setConvertMessage("");
      try {
        const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/latest`);
        const json = await readJson(response);
        const snapshot = json.data || null;
        const pages = Array.isArray(snapshot?.pages) ? snapshot.pages : [];
        if (!isMounted) {
          return;
        }
        setItems(createPageItems(pages));
        setSnapshotLabel(snapshot?.saveId ? `最新存档：${snapshot.saveId}` : "未找到最新存档");
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setItems([]);
        setSnapshotLabel("");
        setLoadError(error.message || "加载最新存档失败");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadLatestSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  function toggleItem(itemId) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, enabled: !item.enabled } : item));
    setConvertMessage("");
  }

  function updateOutputNumber(itemId, value) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, outputNumber: value } : item));
    setConvertMessage("");
  }

  function handleConvert() {
    setConvertMessage(`已选择 ${selectedCount} 页。转换功能暂未实现。`);
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: 4 }}>
      <Container maxWidth="md">
        <Stack spacing={2.5} alignItems="stretch">
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "primary.main" }}>
              转换数据
            </Typography>
            {snapshotLabel ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {snapshotLabel}
              </Typography>
            ) : null}
          </Box>

          <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden", borderColor: "#eadbc7" }}>
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                color: "rgba(160, 115, 55, 0.18)",
                fontSize: { xs: 64, md: 96 },
                fontWeight: 800,
                lineHeight: 1,
                pointerEvents: "none"
              }}
            >
              →
            </Box>

            {isLoading ? (
              <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ minHeight: 220, position: "relative" }}>
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary">正在加载最新存档...</Typography>
              </Stack>
            ) : null}

            {!isLoading && loadError ? (
              <Box sx={{ p: 2.5, position: "relative" }}>
                <Alert severity="error">{loadError}</Alert>
              </Box>
            ) : null}

            {!isLoading && !loadError && !items.length ? (
              <Box sx={{ p: 2.5, position: "relative" }}>
                <Alert severity="info">最新存档中没有可转换的页面。</Alert>
              </Box>
            ) : null}

            {!isLoading && !loadError && items.length ? (
              <Stack divider={<Box sx={{ borderTop: "1px solid #f1e3d3" }} />} sx={{ position: "relative" }}>
                {items.map((item) => (
                  <Box
                    key={item.id}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "auto minmax(0, 1fr) 88px", sm: "auto minmax(160px, 1fr) minmax(80px, 1fr) 112px" },
                      alignItems: "center",
                      gap: 1.5,
                      px: 2,
                      py: 1.25,
                      bgcolor: item.enabled ? "background.paper" : "rgba(0, 0, 0, 0.025)"
                    }}
                  >
                    <Checkbox checked={item.enabled} onChange={() => toggleItem(item.id)} inputProps={{ "aria-label": `${item.name} 转换开关` }} />
                    <Typography
                      component="button"
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      sx={{
                        appearance: "none",
                        border: 0,
                        bgcolor: "transparent",
                        color: item.enabled ? "text.primary" : "text.disabled",
                        cursor: "pointer",
                        font: "inherit",
                        fontWeight: 600,
                        minWidth: 0,
                        p: 0,
                        textAlign: "left",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {item.name}
                    </Typography>
                    <Box sx={{ display: { xs: "none", sm: "block" }, minHeight: 1 }} />
                    <TextField
                      size="small"
                      type="number"
                      value={item.outputNumber}
                      disabled={!item.enabled}
                      onChange={(event) => updateOutputNumber(item.id, event.target.value)}
                      inputProps={{ min: 1, "aria-label": `${item.name} 输出编号` }}
                    />
                  </Box>
                ))}
              </Stack>
            ) : null}
          </Paper>

          <Stack alignItems="center" spacing={2}>
            <Button variant="contained" size="large" onClick={handleConvert} disabled={!items.length || !selectedCount || isLoading}>
              转换
            </Button>
            <Box sx={{ width: "100%", minHeight: 56 }}>
              {convertMessage ? <Alert severity="info">{convertMessage}</Alert> : null}
            </Box>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}