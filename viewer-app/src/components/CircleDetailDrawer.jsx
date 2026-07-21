import { Box, Divider, Drawer, Stack, Typography } from "@mui/material";
import { toImageUrl } from "../utils/viewerUtils";
import { SocialIconButtons } from "./SocialIconButtons";

export function CircleDetailDrawer({ selected, open, onClose, imageBaseUrl }) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: 340, sm: 480 }, p: 2.5 }}>
        {selected ? (
          <>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {selected.circle_name}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.4 }}>
              {selected.circle_id} / {selected.booth_location || "-"}
            </Typography>

            <Box sx={{ mt: 1.5 }}>
              <SocialIconButtons imageBaseUrl={imageBaseUrl} pixivId={selected.pixiv_id} twitterId={selected.twitter_id} size={36} />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>作者</Typography>
            <Typography sx={{ mb: 1.2 }}>{selected.author_name || "-"}</Typography>

            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>分类</Typography>
            <Typography sx={{ mb: 1.2 }}>{selected.genre || "-"}</Typography>

            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>标签</Typography>
            <Typography sx={{ mb: 1.2 }}>{selected.tags_text || "-"}</Typography>

            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>备注</Typography>
            <Typography sx={{ mb: 1.2 }}>{selected.memo || "-"}</Typography>

            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>补充</Typography>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>{selected.supplement_text || "-"}</Typography>

            <Divider sx={{ my: 2 }} />

            <Typography sx={{ fontSize: 13, color: "text.secondary", mb: 1 }}>图片预览</Typography>
            <Stack spacing={1}>
              {(selected.local_image_paths || []).slice(0, 5).map((imagePath) => (
                <Box
                  key={imagePath}
                  component="img"
                  src={toImageUrl(imageBaseUrl, imagePath)}
                  alt={selected.circle_name}
                  sx={{ width: "100%", borderRadius: 1.5, border: "1px solid #e8e1d8" }}
                />
              ))}
              {selected.local_image_paths?.length ? null : <Typography color="text.secondary">暂无图片</Typography>}
            </Stack>
          </>
        ) : null}
      </Box>
    </Drawer>
  );
}
