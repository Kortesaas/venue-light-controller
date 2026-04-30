from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict


ICON_COMPONENT_MAP: Dict[str, str] = {
    # Core deck/navigation controls
    "scenes": "ViewModuleRounded",
    "levels": "TuneRounded",
    "back": "ArrowBackIosNewRounded",
    "prev": "KeyboardArrowLeftRounded",
    "next": "KeyboardArrowRightRounded",
    "stop": "StopRounded",
    "blackout": "HighlightOffRounded",
    "active": "RadioButtonCheckedRounded",
    "mode": "ToggleOnRounded",
    "lock": "LockRounded",
    "status": "CheckCircleRounded",

    # Intensity/group controls
    "master": "LinearScaleRounded",
    "group": "GroupsRounded",
    "groups": "GroupsRounded",
    "mute": "VolumeOffRounded",
    "up": "KeyboardArrowUpRounded",
    "down": "KeyboardArrowDownRounded",
    "full": "VerticalAlignTopRounded",

    # Atmosphere controls
    "fog": "CloudRounded",
    "haze": "BlurOnRounded",

    # Scene-type fallbacks
    "scene_static": "CropSquareRounded",
    "scene_dynamic": "AutoAwesomeMotionRounded",

    "speaker": "RecordVoiceOverRounded",
    "party": "CelebrationRounded",
    "chill": "NightlightRounded",
    "dinner": "StarRounded",
    "ceremony": "FavoriteRounded",
    "show": "TheaterComedyRounded",
    "technical": "BuildRounded",
}

def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _frontend_dir(root: Path) -> Path:
    return root / "frontend"


def _streamdeck_icons_dir(root: Path) -> Path:
    return root / "backend" / "assets" / "streamdeck" / "icons"


def _render_svg_from_mui_component(frontend_dir: Path, component_name: str) -> str:
    node_script = """
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const componentName = process.argv[1];
const mod = require("@mui/icons-material/" + componentName);
const Icon = mod.default || mod;
const markup = renderToStaticMarkup(React.createElement(Icon, { htmlColor: "#ffffff" }));
const start = markup.indexOf("<svg");
const end = markup.lastIndexOf("</svg>");
if (start < 0 || end < 0) {
  throw new Error("No <svg> found in rendered icon markup.");
}
process.stdout.write(markup.slice(start, end + 6));
""".strip()
    process = subprocess.run(
        ["node", "-e", node_script, component_name],
        cwd=str(frontend_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        stderr = process.stderr.strip()
        raise RuntimeError(
            f"Failed to render MUI icon '{component_name}' via Node. "
            f"Detail: {stderr or 'unknown error'}"
        )
    svg_text = process.stdout.strip()
    if not svg_text.startswith("<svg"):
        raise RuntimeError(
            f"Unexpected SVG output for '{component_name}'."
        )
    return _normalize_svg_for_streamdeck(svg_text)


def _normalize_svg_for_streamdeck(svg_text: str) -> str:
    # Ensure icons render white regardless of how MUI encodes color inheritance.
    normalized = svg_text.replace("currentColor", "#ffffff")
    normalized = re.sub(r'(?i)\sclass="[^"]*"', "", normalized, count=1)
    normalized = re.sub(r'(?i)\scolor="[^"]*"', "", normalized, count=1)
    normalized = re.sub(r'(?i)\sdata-testid="[^"]*"', "", normalized)
    normalized = re.sub(r'(?i)\saria-hidden="[^"]*"', "", normalized)
    normalized = re.sub(r'(?i)\sfocusable="[^"]*"', "", normalized)
    normalized = re.sub(r'(?i)\sfill="none"', "", normalized)

    start, sep, rest = normalized.partition(">")
    if not sep:
        return normalized
    if "fill=" not in start:
        start += ' fill="#ffffff"'
    return start + sep + rest


def _render_png(svg_text: str, png_path: Path, size: int) -> None:
    try:
        import resvg_py  # type: ignore

        png_bytes = resvg_py.svg_to_bytes(
            svg_string=svg_text,
            width=size,
            height=size,
            background="rgba(0,0,0,0)",
        )
        png_path.write_bytes(png_bytes)
        return
    except ImportError:
        pass

    try:
        import cairosvg  # type: ignore
    except ImportError as exc:  # pragma: no cover - runtime environment dependent
        raise RuntimeError(
            "Missing dependency for SVG->PNG conversion. "
            "Install with either 'pip install resvg-py' (recommended) "
            "or 'pip install cairosvg'."
        ) from exc

    cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        write_to=str(png_path),
        output_width=size,
        output_height=size,
    )


def generate_icons(size: int, overwrite: bool, write_svg: bool, svg_only: bool) -> int:
    root = _repo_root()
    frontend_dir = _frontend_dir(root)
    out_dir = _streamdeck_icons_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not (frontend_dir / "node_modules").exists():
        print(
            f"Frontend dependencies not found in: {frontend_dir / 'node_modules'}\n"
            "Run 'npm install' in the frontend directory first.",
            file=sys.stderr,
        )
        return 2

    generated = 0
    skipped = 0

    for icon_name, component_name in ICON_COMPONENT_MAP.items():
        png_path = out_dir / f"{icon_name}.png"
        svg_path = out_dir / f"{icon_name}.svg"
        if png_path.exists() and not overwrite:
            print(f"Skip {icon_name}: {png_path.name} already exists (use --overwrite).")
            skipped += 1
            continue

        try:
            svg_text = _render_svg_from_mui_component(frontend_dir, component_name)
        except RuntimeError as exc:
            print(f"Skip {icon_name}: {exc}")
            skipped += 1
            continue
        if write_svg or svg_only:
            svg_path.write_text(svg_text, encoding="utf-8")

        if not svg_only:
            try:
                _render_png(svg_text, png_path, size=size)
            except RuntimeError as exc:
                print(f"Failed {icon_name}: {exc}", file=sys.stderr)
                return 3

        if svg_only:
            print(f"Generated {svg_path}")
        else:
            print(f"Generated {png_path}")
        generated += 1

    print(f"\nDone. Generated: {generated}, Skipped: {skipped}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Generate Stream Deck scene icon PNG assets from the frontend's installed "
            "@mui/icons-material package."
        )
    )
    parser.add_argument(
        "--size",
        type=int,
        default=144,
        help="PNG size in px (default: 144).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing PNG files.",
    )
    parser.add_argument(
        "--write-svg",
        action="store_true",
        help="Also write intermediate SVG files next to the PNG files.",
    )
    parser.add_argument(
        "--svg-only",
        action="store_true",
        help="Write SVG files only (no PNG conversion).",
    )
    args = parser.parse_args()

    if args.size < 24:
        print("--size must be >= 24", file=sys.stderr)
        return 2

    return generate_icons(
        size=args.size,
        overwrite=args.overwrite,
        write_svg=args.write_svg,
        svg_only=args.svg_only,
    )


if __name__ == "__main__":
    raise SystemExit(main())
