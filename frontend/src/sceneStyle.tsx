import type { SxProps, Theme } from "@mui/material/styles";
import RecordVoiceOverRoundedIcon from "@mui/icons-material/RecordVoiceOverRounded";
import CelebrationRoundedIcon from "@mui/icons-material/CelebrationRounded";
import NightlightRoundedIcon from "@mui/icons-material/NightlightRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import TheaterComedyRoundedIcon from "@mui/icons-material/TheaterComedyRounded";
import BuildRoundedIcon from "@mui/icons-material/BuildRounded";
import GraphicEqRoundedIcon from "@mui/icons-material/GraphicEqRounded";
import type { ReactNode } from "react";

export type SceneStyleMeta = {
  color?:
    | "default"
    | "cyan"
    | "blue"
    | "teal"
    | "green"
    | "violet"
    | "amber"
    | "rose"
    | "red"
    | "rainbow";
  variant?: "default" | "solid" | "soft" | "outline";
  color_secondary?:
    | "default"
    | "cyan"
    | "blue"
    | "teal"
    | "green"
    | "violet"
    | "amber"
    | "rose"
    | "red"
    | "rainbow";
  icon?:
    | "none"
    | "speaker"
    | "party"
    | "chill"
    | "dinner"
    | "ceremony"
    | "show"
    | "technical";
  emphasis?: "normal" | "primary" | "warning";
};

export const SCENE_COLOR_OPTIONS: Array<NonNullable<SceneStyleMeta["color"]>> = [
  "default",
  "cyan",
  "blue",
  "teal",
  "green",
  "violet",
  "amber",
  "rose",
  "red",
  "rainbow",
];
export const SCENE_ICON_OPTIONS: Array<NonNullable<SceneStyleMeta["icon"]>> = [
  "none",
  "speaker",
  "party",
  "chill",
  "dinner",
  "ceremony",
  "show",
  "technical",
];

const COLOR_MAP = {
  default: "#00bcd4",
  cyan: "#00bcd4",
  blue: "#42a5f5",
  teal: "#26c6da",
  green: "#66bb6a",
  violet: "#7e57c2",
  amber: "#ffb300",
  rose: "#f06292",
  red: "#ef5350",
  rainbow: "#f06292",
} as const;

const SOFT_ALPHA = 0.16;

const COLOR_RGBA = {
  default: (a: number) => `rgba(0, 188, 212, ${a})`,
  cyan: (a: number) => `rgba(0, 188, 212, ${a})`,
  blue: (a: number) => `rgba(66, 165, 245, ${a})`,
  teal: (a: number) => `rgba(38, 198, 218, ${a})`,
  green: (a: number) => `rgba(102, 187, 106, ${a})`,
  violet: (a: number) => `rgba(126, 87, 194, ${a})`,
  amber: (a: number) => `rgba(255, 179, 0, ${a})`,
  rose: (a: number) => `rgba(240, 98, 146, ${a})`,
  red: (a: number) => `rgba(239, 83, 80, ${a})`,
  rainbow: (a: number) => `rgba(240, 98, 146, ${a})`,
} as const;

export const SCENE_STYLE_LABELS = {
  color: {
    default: "Default",
    cyan: "Cyan",
    blue: "Blue",
    teal: "Teal",
    green: "Green",
    violet: "Violet",
    amber: "Amber",
    rose: "Rose",
    red: "Red",
    rainbow: "Rainbow",
  },
  icon: {
    none: "No icon",
    speaker: "Speaker",
    party: "Party",
    chill: "Chill",
    dinner: "Dinner",
    ceremony: "Ceremony",
    show: "Show",
    technical: "Technical",
  },
} as const;

export function getSceneIcon(icon: SceneStyleMeta["icon"]): ReactNode {
  switch (icon) {
    case "none":
    case undefined:
      return null;
    case "speaker":
      return <RecordVoiceOverRoundedIcon fontSize="inherit" />;
    case "party":
      return <CelebrationRoundedIcon fontSize="inherit" />;
    case "chill":
      return <NightlightRoundedIcon fontSize="inherit" />;
    case "dinner":
      return <StarRoundedIcon fontSize="inherit" />;
    case "ceremony":
      return <FavoriteRoundedIcon fontSize="inherit" />;
    case "show":
      return <TheaterComedyRoundedIcon fontSize="inherit" />;
    case "technical":
      return <BuildRoundedIcon fontSize="inherit" />;
    default:
      return <GraphicEqRoundedIcon fontSize="inherit" />;
  }
}

export function getSceneCardSx(
  style: SceneStyleMeta | undefined,
  isActive: boolean
): SxProps<Theme> {
  const primaryColor = style?.color ?? "default";
  const secondaryColor = style?.color_secondary ?? "default";
  const hasPrimary = primaryColor !== "default";
  const hasSecondary = secondaryColor !== "default";
  const hasCustomVisualStyle = hasPrimary || hasSecondary;

  if (!hasCustomVisualStyle) {
    return {
      borderColor: isActive ? "primary.main" : "divider",
      borderWidth: isActive ? 2 : 1,
      height: "100%",
    };
  }

  const colorKey = primaryColor;
  const accent = COLOR_MAP[colorKey];
  const borderColor = isActive ? accent : "divider";
  const borderWidth = isActive ? 2 : 1;
  const glow = isActive ? `0 0 0 1px ${accent}33 inset` : "none";
  const secondaryAccent = COLOR_MAP[secondaryColor];

  return {
    borderColor,
    borderWidth,
    height: "100%",
    ...(hasPrimary && hasSecondary
      ? {
          backgroundImage:
            colorKey === "rainbow" || secondaryColor === "rainbow"
              ? `linear-gradient(135deg, ${COLOR_RGBA[colorKey](SOFT_ALPHA)} 0%, ${COLOR_RGBA[secondaryColor](SOFT_ALPHA)} 100%)`
              : `linear-gradient(135deg, ${COLOR_RGBA[colorKey](SOFT_ALPHA)} 0%, ${COLOR_RGBA[secondaryColor](SOFT_ALPHA)} 100%)`,
        }
      : colorKey === "rainbow"
      ? {
          backgroundImage:
            "linear-gradient(135deg, rgba(255, 84, 84, 0.16) 0%, rgba(255, 171, 64, 0.16) 18%, rgba(255, 238, 88, 0.16) 36%, rgba(102, 187, 106, 0.16) 54%, rgba(66, 165, 245, 0.16) 72%, rgba(171, 71, 188, 0.16) 100%)",
        }
      : {
          backgroundColor: COLOR_RGBA[colorKey](SOFT_ALPHA),
        }),
    boxShadow: glow,
    "&::after":
      hasPrimary && hasSecondary
        ? {
            content: '""',
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            border: `1px solid ${isActive ? secondaryAccent : "transparent"}`,
            pointerEvents: "none",
            opacity: isActive ? 0.35 : 0,
          }
        : undefined,
    position: "relative",
  };
}

export function normalizeSceneStyleForPayload(
  style: SceneStyleMeta | undefined
): SceneStyleMeta | null {
  if (!style) {
    return null;
  }
  const normalized: SceneStyleMeta = {};
  if (style.color && style.color !== "default") {
    normalized.color = style.color;
  }
  if (
    style.color_secondary &&
    style.color_secondary !== "default" &&
    style.color_secondary !== style.color
  ) {
    normalized.color_secondary = style.color_secondary;
  }
  normalized.variant = "soft";
  if (style.icon && style.icon !== "none") {
    normalized.icon = style.icon;
  }
  normalized.emphasis = "normal";
  return Object.keys(normalized).length > 0 ? normalized : null;
}
