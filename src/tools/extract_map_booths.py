from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import cv2
import numpy as np


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int

    @property
    def center(self) -> Tuple[float, float]:
        return (self.x + self.w / 2.0, self.y + self.h / 2.0)


@dataclass
class BoothRecord:
    page: int
    booth_number: str
    booth_suffix: str
    bbox: Rect
    split_index: int


class MapBoothExtractor:
    def __init__(self, pdf_path: Path, output_dir: Path, render_dpi: int = 200, start_page: int = 1, end_page: int = 4) -> None:
        self.pdf_path = pdf_path
        self.output_dir = output_dir
        self.render_dpi = render_dpi
        self.start_page = start_page
        self.end_page = end_page

    def run(self) -> Dict[str, object]:
        rendered_pages = self.render_pdf()
        booths_dir = self.output_dir / "booths"
        debug_dir = self.output_dir / "debug"
        booths_dir.mkdir(parents=True, exist_ok=True)
        debug_dir.mkdir(parents=True, exist_ok=True)

        page_results = []
        total_booths = 0

        selected_pages = rendered_pages[self.start_page - 1:self.end_page]

        for page_index, image_path in enumerate(selected_pages, start=self.start_page):
            image = cv2.imread(str(image_path))
            if image is None:
                raise RuntimeError(f"Failed to read rendered page image: {image_path}")

            booth_rects = self.detect_booth_rectangles(image)
            booths = self.extract_booths_from_rectangles(page_index, image, booth_rects)
            total_booths += len(booths)

            page_payload = {
                "page": page_index,
                "image": image_path.name,
                "renderedImagePath": self.to_storage_relative_path(image_path),
                "boothRectangleCount": len(booth_rects),
                "boothCount": len(booths),
                "booths": [self.serialize_booth(booth) for booth in booths],
            }
            page_results.append(page_payload)

            with (booths_dir / f"page-{page_index}.json").open("w", encoding="utf-8") as fp:
                json.dump(page_payload, fp, ensure_ascii=False, indent=2)

            debug_image = self.draw_debug_overlay(image.copy(), booth_rects, booths)
            debug_image_path = debug_dir / f"page-{page_index}.png"
            cv2.imwrite(str(debug_image_path), debug_image)
            page_payload["debugImagePath"] = self.to_storage_relative_path(debug_image_path)

        summary = {
            "sourcePdf": str(self.pdf_path),
            "sourcePdfPath": self.to_storage_relative_path(self.pdf_path),
            "renderDpi": self.render_dpi,
            "startPage": self.start_page,
            "endPage": min(self.end_page, len(rendered_pages)),
            "pageCount": len(page_results),
            "totalBooths": total_booths,
            "outputRoot": self.to_storage_relative_path(self.output_dir),
            "pages": page_results,
        }

        with (self.output_dir / "summary.json").open("w", encoding="utf-8") as fp:
            json.dump(summary, fp, ensure_ascii=False, indent=2)

        return summary

    def to_storage_relative_path(self, path: Path) -> str:
        try:
            relative = path.resolve().relative_to(Path("storage").resolve())
            normalized = str(relative).replace("\\", "/")
            return f"storage/{normalized}"
        except Exception:
            return str(path).replace("\\", "/")

    def render_pdf(self) -> List[Path]:
        pages = sorted(self.output_dir.glob("rendered/page-*.png"))
        if pages:
            return pages

        render_dir = self.output_dir / "rendered"
        render_dir.mkdir(parents=True, exist_ok=True)
        prefix = render_dir / "page"
        subprocess.run(
            [
                "pdftoppm",
                "-png",
                "-r",
                str(self.render_dpi),
                str(self.pdf_path),
                str(prefix),
            ],
            check=True,
        )
        pages = sorted(render_dir.glob("page-*.png"))
        if not pages:
            raise RuntimeError("pdftoppm did not produce any page images")
        return pages

    def detect_booth_rectangles(self, image: np.ndarray) -> List[Rect]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        white_space_candidates = self.detect_cells_from_near_white(gray)
        grid_candidates = self.detect_cells_from_grid_lines(gray)
        candidates = white_space_candidates + grid_candidates

        candidates.sort(key=lambda rect: (rect.y, rect.x, rect.w * rect.h))
        deduped: List[Rect] = []
        for rect in candidates:
            if any(self.is_duplicate_rect(rect, existing) for existing in deduped):
                continue
            deduped.append(rect)

        return self.keep_rectangles_with_neighbors(deduped)

    def detect_cells_from_near_white(self, gray: np.ndarray) -> List[Rect]:
        # Build enclosed-space mask from obstacles instead of relying on pure white pixels.
        # This handles anti-aliased borders better than a single fixed white threshold.
        _, near_white = cv2.threshold(gray, 248, 255, cv2.THRESH_BINARY)
        obstacles = cv2.bitwise_not(near_white)
        obstacles = cv2.dilate(obstacles, np.ones((2, 2), np.uint8), iterations=1)
        flood = cv2.bitwise_not(obstacles)
        flood = cv2.morphologyEx(flood, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8), iterations=1)
        return self.collect_candidate_rectangles_from_flood(flood)

    def detect_cells_from_grid_lines(self, gray: np.ndarray) -> List[Rect]:
        # Reconstruct booth grids from horizontal/vertical line segments.
        # This pass is important for page layouts where cell interiors are not pure white.
        line_binary = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            31,
            7,
        )

        vertical = cv2.morphologyEx(line_binary, cv2.MORPH_OPEN, np.ones((11, 1), np.uint8), iterations=1)
        horizontal = cv2.morphologyEx(line_binary, cv2.MORPH_OPEN, np.ones((1, 11), np.uint8), iterations=1)
        grid = cv2.bitwise_or(vertical, horizontal)
        grid = cv2.dilate(grid, np.ones((2, 2), np.uint8), iterations=1)

        flood = cv2.bitwise_not(grid)
        flood = cv2.morphologyEx(flood, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8), iterations=1)
        return self.collect_candidate_rectangles_from_flood(flood)

    def collect_candidate_rectangles_from_flood(self, flood: np.ndarray) -> List[Rect]:
        height, width = flood.shape[:2]
        mask = np.zeros((height + 2, width + 2), np.uint8)
        cv2.floodFill(flood, mask, (0, 0), 0)

        contours, _ = cv2.findContours(flood, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates: List[Rect] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h
            aspect = h / float(w or 1)
            if area < 180 or area > 2400:
                continue
            if w < 14 or w > 62:
                continue
            if h < 12 or h > 40:
                continue
            if aspect < 0.3 or aspect > 3.2:
                continue
            if x < 20 or y < 100 or x + w > width - 20 or y + h > height - 20:
                continue
            candidates.append(Rect(x, y, w, h))
        return candidates

    def is_duplicate_rect(self, a: Rect, b: Rect) -> bool:
        return abs(a.x - b.x) <= 2 and abs(a.y - b.y) <= 2 and abs(a.w - b.w) <= 2 and abs(a.h - b.h) <= 2

    def keep_rectangles_with_neighbors(self, rects: Sequence[Rect]) -> List[Rect]:
        if not rects:
            return []

        kept: List[Rect] = []
        median_w = float(np.median([rect.w for rect in rects]))
        median_h = float(np.median([rect.h for rect in rects]))
        x_threshold = max(12.0, median_w * 1.6)
        y_threshold = max(12.0, median_h * 1.6)

        for rect in rects:
            rx, ry = rect.center
            neighbor_count = 0
            for other in rects:
                if other is rect:
                    continue
                ox, oy = other.center
                if abs(rx - ox) <= x_threshold and abs(ry - oy) <= y_threshold * 0.55:
                    neighbor_count += 1
                    break
                if abs(ry - oy) <= y_threshold and abs(rx - ox) <= x_threshold * 0.55:
                    neighbor_count += 1
                    break
            if neighbor_count > 0:
                kept.append(rect)

        return kept

    def extract_booths_from_rectangles(
        self,
        page_index: int,
        image: np.ndarray,
        rects: Sequence[Rect],
    ) -> List[BoothRecord]:
        booths: List[BoothRecord] = []
        for rect in rects:
            crop = self.crop_with_padding(image, rect, pad=2)
            if self.green_pixel_ratio(crop) > 0.02:
                continue

            booths.append(
                BoothRecord(
                    page=page_index,
                    booth_number="",
                    booth_suffix="",
                    bbox=rect,
                    split_index=0,
                )
            )
        booths.sort(key=lambda booth: (booth.bbox.y, booth.bbox.x, booth.split_index))
        return booths

    def green_pixel_ratio(self, crop: np.ndarray) -> float:
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        lower = np.array([35, 35, 35], dtype=np.uint8)
        upper = np.array([95, 255, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)
        return float(np.count_nonzero(mask)) / float(mask.size or 1)

    def crop_with_padding(self, image: np.ndarray, rect: Rect, pad: int) -> np.ndarray:
        height, width = image.shape[:2]
        x1 = max(rect.x - pad, 0)
        y1 = max(rect.y - pad, 0)
        x2 = min(rect.x + rect.w + pad, width)
        y2 = min(rect.y + rect.h + pad, height)
        return image[y1:y2, x1:x2]

    def draw_debug_overlay(
        self,
        image: np.ndarray,
        rects: Sequence[Rect],
        booths: Sequence[BoothRecord],
    ) -> np.ndarray:
        for rect in rects:
            cv2.rectangle(image, (rect.x, rect.y), (rect.x + rect.w, rect.y + rect.h), (180, 180, 180), 1)
        for booth in booths[:4000]:
            rect = booth.bbox
            booth_label = f"{booth.booth_number}{booth.booth_suffix}".strip()
            cv2.rectangle(image, (rect.x, rect.y), (rect.x + rect.w, rect.y + rect.h), (0, 0, 255), 1)
            cv2.putText(
                image,
                booth_label,
                (rect.x, rect.y + max(10, rect.h // 2)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.28,
                (255, 0, 0),
                1,
                cv2.LINE_AA,
            )
        return image

    def serialize_booth(self, booth: BoothRecord) -> Dict[str, object]:
        payload = {
            "page": booth.page,
            "booth_number": booth.booth_number,
            "booth_suffix": booth.booth_suffix,
            "bbox": asdict(booth.bbox),
            "split_index": booth.split_index,
        }
        return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract booth geometry from a static venue map PDF")
    parser.add_argument("--pdf", default="storage/map.pdf", help="Path to source PDF map")
    parser.add_argument("--output", default="storage/map_extracted", help="Output directory for extracted JSON and debug images")
    parser.add_argument("--dpi", type=int, default=200, help="PDF render DPI")
    parser.add_argument("--start-page", type=int, default=1, help="First PDF page to process (1-based)")
    parser.add_argument("--end-page", type=int, default=4, help="Last PDF page to process (1-based, inclusive)")
    args = parser.parse_args()

    extractor = MapBoothExtractor(
        Path(args.pdf),
        Path(args.output),
        render_dpi=args.dpi,
        start_page=args.start_page,
        end_page=args.end_page,
    )
    summary = extractor.run()
    print(json.dumps({
        "pageCount": summary["pageCount"],
        "totalBooths": summary["totalBooths"],
        "output": str(Path(args.output).resolve()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
