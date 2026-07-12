"""Generate pip_avatar.png (512x512) and social_preview.png (1280x640)
from pip_flight_loop.gif. Requires pillow (maintainer tooling, not CI).

Layout rule for the card (the old draft's bug was text/mascot overlap):
mascot occupies x < 500; text starts at x = 540; an assertion enforces
that the widest text line fits inside the canvas.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
GIF = HERE / "pip_flight_loop.gif"

INK = (34, 51, 59)        # 22333b
GRAY = (120, 126, 133)
SEAL = (230, 57, 70)      # e63946
WORDMARK = "ai-job-search"
TAGLINE = "job search that runs on your machine"

def best_frame(gif_path, frame_index=0):
    g = Image.open(gif_path)
    g.seek(frame_index)
    return g.convert("RGBA")

def find_font(size):
    candidates = [
        r"C:\Windows\Fonts\consolab.ttf",   # Consolas Bold
        r"C:\Windows\Fonts\consola.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

def make_avatar():
    frame = best_frame(GIF, 0)  # first frame: wing raised, reads best square
    bbox = frame.getbbox()
    crop = frame.crop(bbox)
    side = max(crop.size) + 60
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2), crop)
    canvas = canvas.resize((512, 512), Image.NEAREST)
    out = HERE / "pip_avatar.png"
    canvas.save(out)
    print(f"wrote {out}")

def make_card():
    W, H = 1280, 640
    card = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(card)

    frame = best_frame(GIF, 0)
    bbox = frame.getbbox()
    crop = frame.crop(bbox)
    target_h = 420
    scale = target_h / crop.height
    crop = crop.resize((int(crop.width * scale), target_h), Image.NEAREST)
    mascot_x = 90
    assert mascot_x + crop.width <= 500, "mascot must stay left of x=500"
    card.paste(crop, (mascot_x, (H - crop.height) // 2), crop)

    f_big = find_font(72)
    f_small = find_font(32)
    tx = 540
    draw.text((tx, 240), WORDMARK, font=f_big, fill=INK)
    wm_w = draw.textlength(WORDMARK, font=f_big)
    tag_w = draw.textlength(TAGLINE, font=f_small)
    assert tx + max(wm_w, tag_w) <= W - 40, "text overflows card"
    draw.text((tx, 340), TAGLINE, font=f_small, fill=GRAY)
    # seal-red accent: small dot echoing the envelope seal
    draw.ellipse((tx + 2, 402, tx + 22, 422), fill=SEAL)
    draw.text((tx + 34, 400), "free & open source", font=f_small, fill=GRAY)

    out = HERE / "social_preview.png"
    card.save(out)
    print(f"wrote {out}")

if __name__ == "__main__":
    make_avatar()
    make_card()
