import { Box, ButtonBase, Stack } from "@mui/material";
import { getPixivProfileUrl, getTwitterProfileUrl, toImageUrl } from "../utils/viewerUtils";

const PIXIV_ICON_PATH = "storage/images/icons/pixiv.png";
const TWITTER_ICON_PATH = "storage/images/icons/twitter.png";

export function SocialIconButtons({ imageBaseUrl, pixivId, twitterId, size = 28 }) {
  const baseButtonSx = {
    width: size,
    height: size,
    borderRadius: 1,
    overflow: "hidden"
  };

  const iconSx = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block"
  };

  return (
    <Stack direction="row" spacing={0.8}>
      <ButtonBase
        component={pixivId ? "a" : "button"}
        href={pixivId ? getPixivProfileUrl(pixivId) : undefined}
        target={pixivId ? "_blank" : undefined}
        rel={pixivId ? "noreferrer" : undefined}
        disabled={!pixivId}
        sx={{
          ...baseButtonSx,
          opacity: pixivId ? 1 : 0.45,
          filter: pixivId ? "none" : "grayscale(100%)"
        }}
        title={pixivId ? `pixiv: ${pixivId}` : "pixiv: unavailable"}
        onClick={(event) => event.stopPropagation()}
      >
        <Box component="img" src={toImageUrl(imageBaseUrl, PIXIV_ICON_PATH)} alt="pixiv" sx={iconSx} />
      </ButtonBase>

      <ButtonBase
        component={twitterId ? "a" : "button"}
        href={twitterId ? getTwitterProfileUrl(twitterId) : undefined}
        target={twitterId ? "_blank" : undefined}
        rel={twitterId ? "noreferrer" : undefined}
        disabled={!twitterId}
        sx={{
          ...baseButtonSx,
          opacity: twitterId ? 1 : 0.45,
          filter: twitterId ? "none" : "grayscale(100%)"
        }}
        title={twitterId ? `x: ${twitterId}` : "x: unavailable"}
        onClick={(event) => event.stopPropagation()}
      >
        <Box component="img" src={toImageUrl(imageBaseUrl, TWITTER_ICON_PATH)} alt="x" sx={iconSx} />
      </ButtonBase>
    </Stack>
  );
}
