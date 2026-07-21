import { useState } from "react";
import { Alert, Button, Stack } from "@mui/material";
import { withApiBaseUrl } from "../utils/apiBase.js";

const MAP_EXTRACTION_API = withApiBaseUrl("/api/map/extraction");

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

export function MapExtractionActions({ onRefresh }) {
  const [running, setRunning] = useState(false);
  const [rebuildState, setRebuildState] = useState("idle");
  const [error, setError] = useState("");

  async function regenerateExtraction() {
    setRunning(true);
    setRebuildState("running");
    setError("");

    try {
      await readJson(await fetch(MAP_EXTRACTION_API, { method: "POST" }));
      if (onRefresh) {
        await onRefresh();
      }
      setRebuildState("success");
    } catch (requestError) {
      setRebuildState("idle");
      setError(requestError.message || "重建失败");
    } finally {
      setRunning(false);
    }
  }

  const buttonLabel = running ? "重建中..." : rebuildState === "success" ? "已重建" : "重建";
  const buttonColor = rebuildState === "success" ? "success" : "primary";

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "fit-content", flexWrap: "wrap" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "fit-content", flexWrap: "wrap" }}>
        <Button variant="contained" color={buttonColor} onClick={regenerateExtraction} disabled={running}>
          {buttonLabel}
        </Button>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
}