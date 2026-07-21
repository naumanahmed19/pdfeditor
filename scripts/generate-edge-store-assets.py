from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "extension" / "store" / "edge"
SCREENSHOTS = OUTPUT / "screenshots"
FONT_REGULAR = ROOT / "public" / "fonts" / "Carlito-Regular.ttf"
FONT_SEMIBOLD = ROOT / "public" / "fonts" / "Carlito-Bold.ttf"
FONT_BOLD = ROOT / "public" / "fonts" / "Carlito-Bold.ttf"

INK = "#171717"
CORAL = "#ff5757"
PAPER = "#fbf8f8"
MUTED = "#6f6668"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def vertical_gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    width, height = size
    top_rgb = Image.new("RGB", (1, 1), top).getpixel((0, 0))
    bottom_rgb = Image.new("RGB", (1, 1), bottom).getpixel((0, 0))
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        mix = y / max(height - 1, 1)
        color = tuple(round(a + (b - a) * mix) for a, b in zip(top_rgb, bottom_rgb))
        draw.line((0, y, width, y), fill=color)
    return image.convert("RGBA")


def contain(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    result = source.copy()
    result.thumbnail(size, Image.Resampling.LANCZOS)
    return result


def draw_centered(draw: ImageDraw.ImageDraw, y: int, text: str, text_font, fill: str, width: int):
    box = draw.textbbox((0, 0), text, font=text_font)
    x = (width - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=text_font, fill=fill)


def make_logo(icon: Image.Image):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    icon.resize((300, 300), Image.Resampling.LANCZOS).save(OUTPUT / "logo-300.png", optimize=True)


def make_small_tile(icon: Image.Image):
    size = (440, 280)
    canvas = vertical_gradient(size, "#fffafa", "#f4e9eb")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((18, 18, 422, 262), radius=28, fill="#ffffffd9", outline="#eadde0")

    tile_icon = icon.resize((92, 92), Image.Resampling.LANCZOS)
    canvas.alpha_composite(tile_icon, ((size[0] - 92) // 2, 34))
    draw_centered(draw, 137, "PickPDF", font(FONT_BOLD, 42), INK, size[0])
    draw_centered(draw, 195, "Read. Edit. Organize. Sign.", font(FONT_REGULAR, 20), MUTED, size[0])
    canvas.convert("RGB").save(OUTPUT / "small-tile-440x280.png", optimize=True)


def make_large_tile(icon: Image.Image):
    size = (1400, 560)
    canvas = vertical_gradient(size, "#fffafa", "#f2e6e9")
    draw = ImageDraw.Draw(canvas)

    draw.ellipse((-140, 250, 290, 680), fill="#ff57571a")
    draw.ellipse((1190, -190, 1580, 200), fill="#7c3aed12")
    draw.rounded_rectangle((72, 62, 1328, 498), radius=48, fill="#ffffffdc", outline="#e8dadd", width=2)

    tile_icon = icon.resize((286, 286), Image.Resampling.LANCZOS)
    canvas.alpha_composite(tile_icon, (126, 137))
    draw.text((485, 126), "PickPDF", font=font(FONT_BOLD, 86), fill=INK)
    draw.text((490, 241), "Your private PDF workspace", font=font(FONT_SEMIBOLD, 47), fill=CORAL)
    draw.text((490, 320), "Read, edit, organize, fill and sign PDFs", font=font(FONT_REGULAR, 34), fill=MUTED)
    draw.text((490, 374), "from one browser tab.", font=font(FONT_REGULAR, 34), fill=MUTED)
    canvas.convert("RGB").save(OUTPUT / "large-tile-1400x560.png", optimize=True)


def make_screenshot(source_path: Path, output_name: str, background: str):
    size = (1280, 800)
    source = Image.open(source_path).convert("RGB")
    fitted = contain(source, size)
    canvas = Image.new("RGB", size, background)
    x = (size[0] - fitted.width) // 2
    y = (size[1] - fitted.height) // 2
    canvas.paste(fitted, (x, y))
    canvas.save(SCREENSHOTS / output_name, optimize=True)


def main():
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    icon = Image.open(ROOT / "app-icon.png").convert("RGBA")

    make_logo(icon)
    make_small_tile(icon)
    make_large_tile(icon)

    assets = ROOT / "public" / "download" / "assets"
    make_screenshot(assets / "app-coral.png", "01-workspace-1280x800.png", "#f8edef")
    make_screenshot(assets / "01-edit.png", "02-edit-pdf-1280x800.png", "#edf6f2")
    make_screenshot(assets / "app-slate.png", "03-dark-workspace-1280x800.png", "#171717")


if __name__ == "__main__":
    main()
