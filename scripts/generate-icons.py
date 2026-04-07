from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw


OUTPUT_DIR = Path("assets/icons")
SIZES = [16, 32, 48, 64, 128, 256, 512]
NAVY = "#1a1f2e"
WHITE = "#ffffff"


def build_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="DejAzmach icon">
  <circle cx="256" cy="256" r="224" fill="#1a1f2e" />
  <rect x="128" y="176" width="256" height="160" rx="24" fill="#ffffff" />
  <path d="M144 192L256 272L368 192" fill="none" stroke="#1a1f2e" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M144 320L232 248" fill="none" stroke="#1a1f2e" stroke-width="18" stroke-linecap="round" />
  <path d="M368 320L280 248" fill="none" stroke="#1a1f2e" stroke-width="18" stroke-linecap="round" />
</svg>
"""


def build_base_image() -> Image.Image:
    image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.ellipse((64, 64, 960, 960), fill=NAVY)
    draw.rounded_rectangle((256, 352, 768, 672), radius=48, fill=WHITE)

    line_width = 36
    draw.line((288, 384, 512, 544, 736, 384), fill=NAVY, width=line_width, joint="curve")
    draw.line((288, 640, 464, 496), fill=NAVY, width=line_width)
    draw.line((736, 640, 560, 496), fill=NAVY, width=line_width)
    return image


def write_icns(image: Image.Image, output_path: Path) -> None:
    png_image = image.resize((512, 512), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    png_image.save(buffer, format="PNG")
    chunk = buffer.getvalue()
    total_length = 8 + 8 + len(chunk)
    output_path.write_bytes(
        b"icns"
        + total_length.to_bytes(4, "big")
        + b"ic09"
        + (8 + len(chunk)).to_bytes(4, "big")
        + chunk
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "icon.svg").write_text(build_svg(), encoding="utf-8")

    base_image = build_base_image()
    resized_images: list[Image.Image] = []

    for size in SIZES:
        output = base_image.resize((size, size), Image.Resampling.LANCZOS)
        output.save(OUTPUT_DIR / f"{size}x{size}.png", format="PNG")
        resized_images.append(output)

    resized_images[-1].save(
        OUTPUT_DIR / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES if size <= 256],
    )
    write_icns(base_image, OUTPUT_DIR / "icon.icns")


if __name__ == "__main__":
    main()
