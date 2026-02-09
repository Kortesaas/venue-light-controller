import type { SxProps, Theme } from "@mui/material/styles";
import RecordVoiceOverRoundedIcon from "@mui/icons-material/RecordVoiceOverRounded";
import CelebrationRoundedIcon from "@mui/icons-material/CelebrationRounded";
import NightlightRoundedIcon from "@mui/icons-material/NightlightRounded";
import RestaurantRoundedIcon from "@mui/icons-material/RestaurantRounded";
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
    | "red";
  variant?: "default" | "solid" | "soft" | "outline";
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
      return <RestaurantRoundedIcon fontSize="inherit" />;
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
  const hasCustomVisualStyle =
    style?.color && style.color !== "default";

  if (!hasCustomVisualStyle) {
    return {
      borderColor: isActive ? "primary.main" : "divider",
      borderWidth: isActive ? 2 : 1,
      height: "100%",
    };
  }

  const colorKey = style?.color ?? "default";
  const accent = COLOR_MAP[colorKey];
  const borderColor = isActive ? accent : "divider";
  const borderWidth = isActive ? 2 : 1;
  const glow = isActive ? `0 0 0 1px ${accent}33 inset` : "none";

  return {
    borderColor,
    borderWidth,
    height: "100%",
    backgroundColor: COLOR_RGBA[colorKey](SOFT_ALPHA),
    boxShadow: glow,
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
  normalized.variant = "soft";
  if (style.icon && style.icon !== "none") {
    normalized.icon = style.icon;
  }
  normalized.emphasis = "normal";
  return Object.keys(normalized).length > 0 ? normalized : null;
}
