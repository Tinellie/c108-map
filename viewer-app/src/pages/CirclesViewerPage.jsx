import { useEffect, useMemo, useState } from "react";
import { Alert, Box, CircularProgress, Container, Paper, Stack, Typography } from "@mui/material";
import { CircleDetailDrawer } from "../components/CircleDetailDrawer";
import { CirclesTable } from "../components/CirclesTable";
import { SearchControls } from "../components/SearchControls";
import { ViewerHero } from "../components/ViewerHero";
import { mockCircles } from "../data/mockCircles";
import {
  colorPreferenceItemsToState,
  DEFAULT_COLOR_ALIASES,
  DEFAULT_COLOR_SORT_ORDER,
  fetchColorPreferences,
  fetchAllCirclesFromApi,
  filterRows,
  LOCATION_DAY_FILTER_OPTIONS,
  LOCATION_VENUE_FILTER_OPTIONS,
  normalizeCircle,
  normalizeColorAliases,
  sortRows,
  saveColorPreferences,
  statsFromRows
} from "../utils/viewerUtils";

const API_URL = import.meta.env.VITE_CIRCLES_API_URL || "/api/favorite-circles";
const IMAGE_BASE_URL = import.meta.env.VITE_IMAGE_BASE_URL || "";
const API_PAGE_SIZE = Number(import.meta.env.VITE_CIRCLES_API_PAGE_SIZE || 200);
const COLOR_PREFERENCES_API_URL = import.meta.env.VITE_COLOR_PREFERENCES_API_URL || "/api/color-preferences";
const DEFAULT_DAY_FILTERS = LOCATION_DAY_FILTER_OPTIONS.filter((item) => item.value !== "all").map((item) => item.value);
const DEFAULT_VENUE_FILTERS = LOCATION_VENUE_FILTER_OPTIONS.filter((item) => item.value !== "all").map((item) => item.value);

export function CirclesViewerPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dayFilters, setDayFilters] = useState(DEFAULT_DAY_FILTERS);
  const [venueFilters, setVenueFilters] = useState(DEFAULT_VENUE_FILTERS);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(200);
  const [selected, setSelected] = useState(null);
  const [usingMock, setUsingMock] = useState(false);
  const [sortMode, setSortMode] = useState("registration");
  const [sortDirection, setSortDirection] = useState("desc");
  const [showColorPriorityEditor, setShowColorPriorityEditor] = useState(false);
  const [colorSortOrder, setColorSortOrder] = useState(DEFAULT_COLOR_SORT_ORDER);
  const [colorAliases, setColorAliases] = useState(DEFAULT_COLOR_ALIASES);
  const [savingColorPreferences, setSavingColorPreferences] = useState(false);
  const [colorPreferenceStatusText, setColorPreferenceStatusText] = useState("");

  function reorderColorPriority(nextOrder) {
    setColorPreferenceStatusText("");
    setColorSortOrder(nextOrder);
  }

  function resetColorPriority() {
    setColorPreferenceStatusText("");
    setColorSortOrder(DEFAULT_COLOR_SORT_ORDER);
    setColorAliases(DEFAULT_COLOR_ALIASES);
  }

  function changeColorAlias(colorIndex, alias) {
    setColorPreferenceStatusText("");
    setColorAliases((current) => ({
      ...current,
      [colorIndex]: alias
    }));
  }

  async function saveCurrentColorPreferences() {
    setSavingColorPreferences(true);
    setColorPreferenceStatusText("");

    try {
      const items = colorSortOrder.map((colorIndex, index) => ({
        color_index: Number(colorIndex),
        sort_priority: index + 1,
        alias_name: String(colorAliases[colorIndex] || "")
      }));

      const updatedItems = await saveColorPreferences(COLOR_PREFERENCES_API_URL, items);
      const normalized = colorPreferenceItemsToState(updatedItems);
      setColorSortOrder(normalized.order);
      setColorAliases(normalized.aliases);
      setColorPreferenceStatusText("Saved");
    } catch (saveError) {
      setColorPreferenceStatusText(`Save failed: ${saveError.message || "unknown error"}`);
    } finally {
      setSavingColorPreferences(false);
    }
  }

  function resetAllFilters() {
    setSearch("");
    setDayFilters(DEFAULT_DAY_FILTERS);
    setVenueFilters(DEFAULT_VENUE_FILTERS);
    setPage(0);
  }

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const [rawRows, preferenceItems] = await Promise.all([
          fetchAllCirclesFromApi(API_URL, API_PAGE_SIZE),
          fetchColorPreferences(COLOR_PREFERENCES_API_URL)
        ]);
        const normalized = rawRows.map(normalizeCircle);
        const colorPreferenceState = colorPreferenceItemsToState(preferenceItems);

        if (!ignore) {
          setRows(normalized);
          setUsingMock(false);
          setColorSortOrder(colorPreferenceState.order);
          setColorAliases(colorPreferenceState.aliases);
        }
      } catch {
        if (!ignore) {
          setRows(mockCircles.map(normalizeCircle));
          setUsingMock(true);
          setError("API unavailable. Showing mock data.");
          setColorSortOrder(DEFAULT_COLOR_SORT_ORDER);
          setColorAliases(normalizeColorAliases(DEFAULT_COLOR_ALIASES));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, []);

  const filteredRows = useMemo(
    () => filterRows(rows, search, { days: dayFilters, venues: venueFilters }),
    [dayFilters, rows, search, venueFilters]
  );

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortMode, sortDirection, colorSortOrder),
    [colorSortOrder, filteredRows, sortDirection, sortMode]
  );

  function handleSortChange(nextMode) {
    if (sortMode === nextMode) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortMode(nextMode);
    setSortDirection(nextMode === "registration" ? "desc" : "asc");
    setPage(0);
  }

  const pagedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [sortedRows, page, rowsPerPage]);

  const stats = useMemo(() => statsFromRows(filteredRows), [filteredRows]);

  useEffect(() => {
    if (page * rowsPerPage >= filteredRows.length && page > 0) {
      setPage(0);
    }
  }, [filteredRows.length, page, rowsPerPage]);

  return (
    <Box sx={{ minHeight: "100vh", pb: 6 }}>
      <ViewerHero stats={stats} usingMock={usingMock} />

      <Container maxWidth="xl" sx={{ mt: 3 }}>
        {error ? (
          <Alert severity={usingMock ? "warning" : "error"} sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Paper elevation={0} sx={{ border: "1px solid #eadbc7", borderRadius: 3, overflow: "hidden" }}>
          <SearchControls
            search={search}
            onSearchChange={setSearch}
            onResetFilters={resetAllFilters}
            sortMode={sortMode}
            sortDirection={sortDirection}
            onSortModeChange={(nextMode) => {
              setSortMode(nextMode);
              setSortDirection(nextMode === "registration" ? "desc" : "asc");
              setPage(0);
            }}
            onSortDirectionChange={(nextDirection) => {
              setSortDirection(nextDirection);
              setPage(0);
            }}
            showColorPriorityEditor={showColorPriorityEditor}
            onToggleColorPriorityEditor={() => setShowColorPriorityEditor((current) => !current)}
            colorSortOrder={colorSortOrder}
            colorAliases={colorAliases}
            onColorAliasChange={changeColorAlias}
            onReorderColorPriority={reorderColorPriority}
            onResetColorPriority={resetColorPriority}
            onSaveColorPreferences={saveCurrentColorPreferences}
            savingColorPreferences={savingColorPreferences}
            colorPreferenceStatusText={colorPreferenceStatusText}
          />

          {loading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 14 }} spacing={1}>
              <CircularProgress size={30} />
              <Typography color="text.secondary">Loading circles...</Typography>
            </Stack>
          ) : (
            <CirclesTable
              rows={pagedRows}
              sortMode={sortMode}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              onRowSelect={setSelected}
              imageBaseUrl={IMAGE_BASE_URL}
              page={page}
              rowsPerPage={rowsPerPage}
              totalCount={sortedRows.length}
              onPageChange={setPage}
              onRowsPerPageChange={(nextRowsPerPage) => {
                setRowsPerPage(nextRowsPerPage);
                setPage(0);
              }}
              dayFilters={dayFilters}
              venueFilters={venueFilters}
              onDayFiltersChange={(nextValues) => {
                setDayFilters(nextValues);
                setPage(0);
              }}
              onVenueFiltersChange={(nextValues) => {
                setVenueFilters(nextValues);
                setPage(0);
              }}
            />
          )}
        </Paper>
      </Container>

      <CircleDetailDrawer
        selected={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        imageBaseUrl={IMAGE_BASE_URL}
      />
    </Box>
  );
}
