import { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
  IconButton,
  Popover,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography
} from "@mui/material";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import {
  badgeColor,
  getCircleDetailUrl,
  getCircleMapUrl,
  getLocationLine1,
  getLocationLine2,
  LOCATION_DAY_FILTER_OPTIONS,
  LOCATION_VENUE_FILTER_OPTIONS,
  toImageUrl
} from "../utils/viewerUtils";
import { SocialIconButtons } from "./SocialIconButtons";

export function CirclesTable({
  rows,
  sortMode,
  sortDirection,
  onSortChange,
  onRowSelect,
  imageBaseUrl,
  page,
  rowsPerPage,
  totalCount,
  onPageChange,
  onRowsPerPageChange,
  dayFilters,
  venueFilters,
  onDayFiltersChange,
  onVenueFiltersChange
}) {
  const [locationFilterAnchor, setLocationFilterAnchor] = useState(null);

  const dayOptions = useMemo(
    () => LOCATION_DAY_FILTER_OPTIONS.filter((item) => item.value !== "all"),
    []
  );
  const venueOptions = useMemo(
    () => LOCATION_VENUE_FILTER_OPTIONS.filter((item) => item.value !== "all"),
    []
  );

  const isLocationFilterOpen = Boolean(locationFilterAnchor);
  const dayFilterSet = new Set(dayFilters || []);
  const venueFilterSet = new Set(venueFilters || []);
  const isAllDaysSelected = dayOptions.every((item) => dayFilterSet.has(item.value));
  const isAllVenuesSelected = venueOptions.every((item) => venueFilterSet.has(item.value));
  const isLocationFilterModified = !isAllDaysSelected || !isAllVenuesSelected;

  function toggleValue(currentValues, nextValue, onChange) {
    const hasValue = currentValues.includes(nextValue);
    if (hasValue) {
      onChange(currentValues.filter((item) => item !== nextValue));
      return;
    }

    onChange([...currentValues, nextValue]);
  }

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="center" sortDirection={sortMode === "color" ? sortDirection : false}>
                <TableSortLabel
                  active={sortMode === "color"}
                  direction={sortMode === "color" ? sortDirection : "asc"}
                  onClick={() => onSortChange("color")}
                >
                  Color
                </TableSortLabel>
              </TableCell>
              <TableCell align="center">Image</TableCell>
              <TableCell sortDirection={sortMode === "registration" ? sortDirection : false}>
                <TableSortLabel
                  active={sortMode === "registration"}
                  direction={sortMode === "registration" ? sortDirection : "asc"}
                  onClick={() => onSortChange("registration")}
                >
                  Name / Author
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sortMode === "location" ? sortDirection : false}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <TableSortLabel
                    active={sortMode === "location"}
                    direction={sortMode === "location" ? sortDirection : "asc"}
                    onClick={() => onSortChange("location")}
                  >
                    Location
                  </TableSortLabel>
                  <IconButton
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLocationFilterAnchor(event.currentTarget);
                    }}
                    color={isLocationFilterModified ? "primary" : "default"}
                  >
                    <FilterListRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </TableCell>
              <TableCell>Genre / Tag</TableCell>
              <TableCell>Memo</TableCell>
              <TableCell>Social</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow hover key={row.circle_id} onClick={() => onRowSelect(row)} sx={{ cursor: "pointer" }}>
                <TableCell align="center">
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: badgeColor(row.color_index),
                      mx: "auto"
                    }}
                  />
                </TableCell>
                <TableCell align="center" sx={{ minWidth: 152, px: 0, py: 0.5, display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <Stack direction="row" spacing={0} justifyContent="center" alignItems="center" sx={{ width: "fit-content", mx: "auto" }}>
                    {(row.local_image_paths || []).slice(0, 2).map((imagePath) => (
                      <Box
                        key={imagePath}
                        component="img"
                        src={toImageUrl(imageBaseUrl, imagePath)}
                        alt={row.circle_name}
                        sx={{ height: 76, width: "auto", maxWidth: 120, objectFit: "contain", borderRadius: 0, display: "block", flexShrink: 0 }}
                      />
                    ))}
                    {(row.local_image_paths || []).length === 0 ? (
                      <Box sx={{ width: 76, height: 76, borderRadius: 1, border: "1px dashed #d8d2ca", backgroundColor: "#faf7f2" }} />
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell sx={{ width: 220, minWidth: 220, maxWidth: 220 }}>
                  <Box
                    component="a"
                    href={getCircleDetailUrl(row.circle_id)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    sx={{ display: "block", color: "inherit", textDecoration: "none", width: "100%" }}
                  >
                    <Typography noWrap title={row.circle_name || ""} sx={{ fontWeight: 600, fontSize: 16, width: "100%", textDecoration: "underline" }}>
                      {row.circle_name}
                    </Typography>
                  </Box>
                  <Typography
                    title={row.author_name || ""}
                    sx={{
                      fontSize: 12,
                      color: "text.secondary",
                      mt: 0.2,
                      width: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflowWrap: "anywhere",
                      lineHeight: 1.25
                    }}
                  >
                    {row.author_name || "-"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box
                    component="a"
                    href={getCircleMapUrl(row.circle_id)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    sx={{ color: "inherit", textDecoration: "none", display: "inline-block" }}
                  >
                    <Typography sx={{ fontSize: 15, textDecoration: "underline" }}>{getLocationLine1(row.booth_location)}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{getLocationLine2(row.booth_location) || "-"}</Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 15 }}>{row.genre || "-"}</Typography>
                  {row.tags_text ? (
                    <Typography noWrap title={row.tags_text} sx={{ fontSize: 12, color: "text.secondary", maxWidth: 220 }}>
                      {row.tags_text}
                    </Typography>
                  ) : null}
                  {row.supplement_text ? (
                    <Typography noWrap title={row.supplement_text} sx={{ fontSize: 12, color: "text.secondary", maxWidth: 220 }}>
                      {row.supplement_text}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell sx={{ minWidth: 280, maxWidth: 360 }}>
                  <Typography sx={{ fontSize: 15, whiteSpace: "normal", wordBreak: "break-word" }}>{row.memo || "-"}</Typography>
                </TableCell>
                <TableCell>
                  <SocialIconButtons imageBaseUrl={imageBaseUrl} pixivId={row.pixiv_id} twitterId={row.twitter_id} size={30} />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography align="center" color="text.secondary" sx={{ py: 6 }}>
                    没有匹配结果
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Popover
        open={isLocationFilterOpen}
        anchorEl={locationFilterAnchor}
        onClose={() => setLocationFilterAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, width: 460 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              位置筛选
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <FormGroup row sx={{ gap: 0.2, flexWrap: "wrap" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={isAllDaysSelected}
                      onChange={() => onDayFiltersChange(isAllDaysSelected ? [] : dayOptions.map((item) => item.value))}
                    />
                  }
                  label="全选"
                  sx={{ mr: 0.8 }}
                />
                {dayOptions.map((item) => (
                  <FormControlLabel
                    key={item.value}
                    control={
                      <Checkbox
                        size="small"
                        checked={dayFilterSet.has(item.value)}
                        onChange={() => toggleValue(dayFilters, item.value, onDayFiltersChange)}
                      />
                    }
                    label={item.label}
                    sx={{ mr: 0.8 }}
                  />
                ))}
              </FormGroup>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <FormGroup row sx={{ gap: 0.2, flexWrap: "wrap" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={isAllVenuesSelected}
                      onChange={() => onVenueFiltersChange(isAllVenuesSelected ? [] : venueOptions.map((item) => item.value))}
                    />
                  }
                  label="全选"
                  sx={{ mr: 0.8 }}
                />
                {venueOptions.map((item) => (
                  <FormControlLabel
                    key={item.value}
                    control={
                      <Checkbox
                        size="small"
                        checked={venueFilterSet.has(item.value)}
                        onChange={() => toggleValue(venueFilters, item.value, onVenueFiltersChange)}
                      />
                    }
                    label={item.label}
                    sx={{ mr: 0.8 }}
                  />
                ))}
              </FormGroup>
            </Box>
          </Stack>
        </Box>
      </Popover>

      <TablePagination
        component="div"
        count={totalCount}
        page={page}
        onPageChange={(_, nextPage) => onPageChange(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => onRowsPerPageChange(Number(event.target.value))}
        rowsPerPageOptions={[20, 50, 100, 200]}
      />
    </>
  );
}
