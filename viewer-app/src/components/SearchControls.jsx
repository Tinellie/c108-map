import {
  Box,
  Button,
  Collapse,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField
} from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { ColorPriorityEditor } from "./ColorPriorityEditor";

export function SearchControls({
  search,
  onSearchChange,
  onResetFilters,
  sortMode,
  sortDirection,
  onSortModeChange,
  onSortDirectionChange,
  showColorPriorityEditor,
  onToggleColorPriorityEditor,
  colorSortOrder,
  colorAliases,
  onColorAliasChange,
  onReorderColorPriority,
  onResetColorPriority,
  onSaveColorPreferences,
  savingColorPreferences,
  colorPreferenceStatusText
}) {
  return (
    <Box sx={{ p: 2, borderBottom: "1px solid #f1e8de", background: "#fff" }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.2}>
        <TextField
          fullWidth
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索圈名、摊位、作者、标签、Pixiv、X"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            )
          }}
        />

        <FormControl sx={{ minWidth: { xs: "100%", md: 220 } }}>
          <InputLabel id="sort-mode-label">排序</InputLabel>
          <Select labelId="sort-mode-label" value={sortMode} label="排序" onChange={(event) => onSortModeChange(event.target.value)}>
            <MenuItem value="registration">登记顺(ID)</MenuItem>
            <MenuItem value="color">颜色顺</MenuItem>
            <MenuItem value="location">位置顺</MenuItem>
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: { xs: "100%", md: 180 } }}>
          <InputLabel id="sort-direction-label">方向</InputLabel>
          <Select
            labelId="sort-direction-label"
            value={sortDirection}
            label="方向"
            onChange={(event) => onSortDirectionChange(event.target.value)}
          >
            <MenuItem value="asc">升序</MenuItem>
            <MenuItem value="desc">降序</MenuItem>
          </Select>
        </FormControl>

        <Button variant="outlined" onClick={onToggleColorPriorityEditor} sx={{ minWidth: { xs: "100%", md: 180 } }}>
          颜色优先级
        </Button>

        <Button variant="text" onClick={onResetFilters} sx={{ minWidth: { xs: "100%", md: 120 } }}>
          重置
        </Button>
      </Stack>

      <Collapse in={showColorPriorityEditor}>
        <ColorPriorityEditor
          colorSortOrder={colorSortOrder}
          colorAliases={colorAliases}
          onAliasChange={onColorAliasChange}
          onReorder={onReorderColorPriority}
          onReset={onResetColorPriority}
          onSave={onSaveColorPreferences}
          saving={savingColorPreferences}
          saveStatusText={colorPreferenceStatusText}
        />
      </Collapse>
    </Box>
  );
}
