import { Box, Chip, Container, Stack, Typography } from "@mui/material";

export function ViewerHero({ stats, usingMock }) {
  return (
    <Box
      sx={{
        background:
          "radial-gradient(1200px 420px at 10% -20%, #ffe7c7 10%, rgba(255,231,199,0) 70%), radial-gradient(900px 420px at 100% 0%, #ffd8ea 10%, rgba(255,216,234,0) 72%)",
        borderBottom: "1px solid #eadbc7"
      }}
    >
      <Container maxWidth="xl" sx={{ pt: 5, pb: 4 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, letterSpacing: -0.8 }}>
          Circle Favorites Viewer
        </Typography>
        <Typography sx={{ mt: 1, color: "#6f6457" }}>
          Browse crawled circle data with quick search, social IDs, and detail previews.
        </Typography>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} sx={{ mt: 2.5 }}>
          <Chip label={`Total ${stats.total}`} color="primary" variant="outlined" />
          <Chip label={`Pixiv ${stats.withPixiv}`} color="secondary" variant="outlined" />
          <Chip label={`Twitter ${stats.withTwitter}`} color="info" variant="outlined" />
          <Chip label={`Tagged ${stats.withTags}`} color="success" variant="outlined" />
          {usingMock ? <Chip label="Mock Mode" color="warning" variant="filled" /> : null}
        </Stack>
      </Container>
    </Box>
  );
}