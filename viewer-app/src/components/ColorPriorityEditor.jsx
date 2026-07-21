import { useState } from "react";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { badgeColor, COLOR_LABELS } from "../utils/viewerUtils";

export function ColorPriorityEditor({
  colorSortOrder,
  colorAliases,
  onAliasChange,
  onReorder,
  onReset,
  onSave,
  saving,
  saveStatusText
}) {
  const [draggingColorIndex, setDraggingColorIndex] = useState(null);
  const [dropTargetColorIndex, setDropTargetColorIndex] = useState(null);

  function reorderColorSortOrder(sourceColorIndex, targetColorIndex) {
    if (!sourceColorIndex || !targetColorIndex || sourceColorIndex === targetColorIndex) {
      return;
    }

    const sourceIndex = colorSortOrder.indexOf(sourceColorIndex);
    const targetIndex = colorSortOrder.indexOf(targetColorIndex);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextOrder = [...colorSortOrder];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    onReorder(nextOrder);
  }

  return (
    <Paper
      elevation={0}
      sx={{ mt: 1.5, p: 1.5, border: "1px solid #f1e8de", backgroundColor: "#fffaf6" }}
    >
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          拖拽调整顺序，可直接改别名。
        </Typography>
        <Stack direction="row" spacing={1}>
          {saveStatusText ? (
            <Typography sx={{ fontSize: 12, color: "text.secondary", alignSelf: "center" }}>{saveStatusText}</Typography>
          ) : null}
          <Button size="small" variant="outlined" onClick={onReset}>
            恢复默认
          </Button>
          <Button size="small" variant="contained" onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={1}>
        {colorSortOrder.map((colorIndex, index) => (
          <Stack
            key={colorIndex}
            direction="row"
            spacing={1}
            alignItems="center"
            draggable
            onDragStart={() => {
              setDraggingColorIndex(colorIndex);
              setDropTargetColorIndex(colorIndex);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (dropTargetColorIndex !== colorIndex) {
                setDropTargetColorIndex(colorIndex);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              reorderColorSortOrder(draggingColorIndex, colorIndex);
              setDraggingColorIndex(null);
              setDropTargetColorIndex(null);
            }}
            onDragEnd={() => {
              setDraggingColorIndex(null);
              setDropTargetColorIndex(null);
            }}
            sx={{
              p: 1,
              border: "1px solid #eadbc7",
              borderRadius: 1.5,
              backgroundColor: "#fff",
              cursor: "grab",
              opacity: draggingColorIndex === colorIndex ? 0.6 : 1,
              boxShadow: dropTargetColorIndex === colorIndex ? "inset 0 0 0 1px #cb4b16" : "none"
            }}
          >
            <Typography sx={{ width: 20, fontSize: 14, color: "text.secondary" }}>⋮⋮</Typography>
            <Typography sx={{ width: 24, fontSize: 13, color: "text.secondary" }}>{index + 1}</Typography>
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                backgroundColor: badgeColor(colorIndex),
                flexShrink: 0
              }}
            />
            <Typography sx={{ width: 96, fontSize: 13, color: "text.secondary" }}>{COLOR_LABELS[colorIndex] || colorIndex}</Typography>
            <TextField
              size="small"
              label="别名"
              value={String(colorAliases?.[colorIndex] || "")}
              onChange={(event) => onAliasChange(colorIndex, event.target.value)}
              sx={{ minWidth: 180, flexGrow: 1 }}
            />
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
