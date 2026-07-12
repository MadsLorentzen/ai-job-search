# Pip Brand PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Pip mascot as the repo's brand: README header GIF, versioned brand assets, social preview card, and avatar, per `docs/superpowers/specs/2026-07-11-mascot-brand-design.md`.

**Architecture:** All brand assets live in `assets/mascot/` with their source sheets and regeneration scripts. The README references one stable filename (`pip_flight_loop.gif`) so future mascot iterations never touch the README again. A stdlib-only unit test permanently guards against broken local image references in the README.

**Tech Stack:** Python 3 (Pillow + numpy + scipy for asset generation, stdlib only for the committed test), git, gh CLI.

## Global Constraints

- Palette is exactly 7 colors: `#2a9d8f` `#1f6f65` `#e76f51` `#969ba0` `#ffffff` `#e63946` `#22333b` (tie shares `#22333b`)
- README-rendered GIF stays under 50 KB (current master: 30,138 bytes)
- Alt text for the mascot is exactly: `Pip, the courier bird`
- No text, logos, or tooling motifs inside the sprite itself
- The committed test must be stdlib-only (CI does not install Pillow)
- CI must stay green: `python -m unittest discover` and `python tools/lint_skills.py` pass after every task
- Work happens on the existing `brand/mascot-pip` branch (spec is already committed there)
- Source-of-truth files on this machine:
  - Master GIF: `C:\Users\Bruger\Desktop\mascot_candidates\courier_flight_loop_v19_tie.gif` (v19 = FINAL, user-approved: v8 white handling + blob removal with protected shell + thin outline repaint; v5-v18 and v20-v21 superseded)
  - ChatGPT tie sheet: `C:\Users\Bruger\Downloads\ChatGPT Image 12. jul. 2026, 06.30.48.png`
  - Gemini sheet: `C:\Users\Bruger\Downloads\Gemini_Generated_Image_azwqj6azwqj6azwq (1).png`
  - Retired flat sprites: `C:\Users\Bruger\Desktop\mascot_candidates\{A_standing_courier,B_flying_delivery,C_envelope_hugger}.png`
  - Assembly script: full v19 pipeline code reproduced in Task 1 Step 4

---

### Task 1: Repo hygiene and brand assets in place

**Files:**
- Modify: `.gitignore` (append one block at end)
- Create: `assets/mascot/pip_flight_loop.gif` (copy of courier_flight_loop_v19_tie.gif)
- Create: `assets/mascot/sources/chatgpt_tie_sheet.png`
- Create: `assets/mascot/sources/gemini_sheet.png`
- Create: `assets/mascot/reference/{A_standing_courier,B_flying_delivery,C_envelope_hugger}.png`
- Create: `assets/mascot/assemble_flight_loop.py`
- Create: `assets/mascot/README.md`

**Interfaces:**
- Produces: `assets/mascot/pip_flight_loop.gif` — the stable path Task 2's README edit and Task 3's generator consume.

- [ ] **Step 1: Add `.superpowers/` to .gitignore**

Append to the end of `.gitignore`:

```gitignore

# Brainstorm mockups (superpowers visual companion) - never ship
.superpowers/
```

- [ ] **Step 2: Verify the ignore rule works**

Run: `git check-ignore -v .superpowers/foo.html`
Expected: prints a line ending in `.superpowers/` — exit code 0

- [ ] **Step 3: Copy assets into place**

```bash
cd "C:/Users/Bruger/Desktop/github_local/ai-job-search"
mkdir -p assets/mascot/sources assets/mascot/reference
cp "C:/Users/Bruger/Desktop/mascot_candidates/courier_flight_loop_v19_tie.gif" assets/mascot/pip_flight_loop.gif
cp "C:/Users/Bruger/Downloads/ChatGPT Image 12. jul. 2026, 06.30.48.png" assets/mascot/sources/chatgpt_tie_sheet.png
cp "C:/Users/Bruger/Downloads/Gemini_Generated_Image_azwqj6azwqj6azwq (1).png" assets/mascot/sources/gemini_sheet.png
cp "C:/Users/Bruger/Desktop/mascot_candidates/A_standing_courier.png" assets/mascot/reference/
cp "C:/Users/Bruger/Desktop/mascot_candidates/B_flying_delivery.png" assets/mascot/reference/
cp "C:/Users/Bruger/Desktop/mascot_candidates/C_envelope_hugger.png" assets/mascot/reference/
```

- [ ] **Step 4: Create `assets/mascot/assemble_flight_loop.py`**

Full script (the session's v19 pipeline with repo-relative paths):

```python
"""Regenerate pip_flight_loop.gif from sources/chatgpt_tie_sheet.png.

Pipeline: 2D-cluster the sheet into 6 birds, snap every pixel to the 7-color
brand palette, order frames by wing centroid (no per-frame rescaling),
anchor on the beak, flood-fill edge-connected background to transparent.
Requires: pillow, numpy, scipy (maintainer tooling; not needed by CI).
"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage

HERE = Path(__file__).parent
SHEET = HERE / "sources" / "chatgpt_tie_sheet.png"
OUT_GIF = HERE / "pip_flight_loop.gif"

PAL = np.array([
    (42, 157, 143), (31, 111, 101), (231, 111, 81), (150, 155, 160),
    (255, 255, 255), (230, 57, 70), (34, 51, 59),
], dtype=int)
TRANSPARENT = 7
CANVAS = 560

im = Image.open(SHEET).convert("RGB")
a_full = np.asarray(im).astype(int)
nonwhite_full = (a_full < 245).any(axis=2)

# 2D clustering: dilate to glue beak tips, label, keep 6 largest, sort by x
dil = ndimage.binary_dilation(nonwhite_full, iterations=2)
lab2, n2 = ndimage.label(dil)
sizes = ndimage.sum(dil, lab2, range(1, n2 + 1))
keep = np.argsort(sizes)[::-1][:6] + 1
comps = []
for k in keep:
    mask = (lab2 == k) & nonwhite_full
    ys, xs = np.where(mask)
    comps.append(dict(mask=mask, x0=xs.min(), x1=xs.max(), y0=ys.min(), y1=ys.max(), cx=xs.mean()))
comps.sort(key=lambda d: d["cx"])
assert len(comps) == 6, f"expected 6 birds, found {len(comps)}"

def snap(arr):
    d = ((arr[:, :, None, :] - PAL[None, None, :, :]) ** 2).sum(-1)
    return PAL[d.argmin(-1)].astype(np.uint8)

cells = []
for comp in comps:
    pad = 8
    y0, y1 = max(0, comp["y0"] - pad), comp["y1"] + pad
    x0, x1 = max(0, comp["x0"] - pad), comp["x1"] + pad
    sub = a_full[y0:y1, x0:x1].copy()
    submask = comp["mask"][y0:y1, x0:x1]
    sub[~submask] = (255, 255, 255)
    cells.append(snap(sub))

def color_mask(arr, ci, tol=10):
    return np.abs(arr.astype(int) - PAL[ci]).sum(-1) < tol

infos = []
for i, c in enumerate(cells):
    coral = color_mask(c, 2)
    lab, n = ndimage.label(coral)
    best, besty = None, 10 ** 9
    for k in range(1, n + 1):
        ys, xs = np.where(lab == k)
        if len(ys) < 80:
            continue
        if ys.mean() < besty:
            besty, best = ys.mean(), (xs, ys)
    bx, by = best[0].mean(), best[1].mean()
    dteal = color_mask(c, 1)
    wing_c = float(np.where(dteal)[0].mean()) if dteal.sum() else by
    infos.append(dict(i=i, beak=(bx, by), area=len(best[0]), wing_c=wing_c))

for d_ in infos:
    # birds in the sheet are size-consistent (within 5%); rescaling by noisy
    # beak measurements caused a visible zoom pulse in an earlier build
    d_["scale"] = 1.0
    d_["wing_rel"] = d_["wing_c"] - d_["beak"][1]

order_sorted = sorted(infos, key=lambda d: d["wing_rel"])
seq = [order_sorted[0], order_sorted[2], order_sorted[4], order_sorted[5], order_sorted[3], order_sorted[1]]

p_frames = []
for d_ in seq:
    c = cells[d_["i"]]
    h, w = c.shape[:2]
    sc = d_["scale"]
    c2 = np.asarray(Image.fromarray(c).resize((int(w * sc), int(h * sc)), Image.NEAREST))
    beak = (d_["beak"][0] * sc, d_["beak"][1] * sc)
    canvas = np.full((CANVAS, CANVAS, 3), 255, dtype=np.uint8)
    tx, ty = int(CANVAS * 0.72), int(CANVAS * 0.38)
    px, py = int(tx - beak[0]), int(ty - beak[1])
    H2, W2 = c2.shape[:2]
    x0, y0 = max(0, px), max(0, py)
    x1, y1 = min(CANVAS, px + W2), min(CANVAS, py + H2)
    canvas[y0:y1, x0:x1] = c2[y0 - py:y0 - py + (y1 - y0), x0 - px:x0 - px + (x1 - x0)]

    nonwhite = (canvas < 250).any(axis=2)
    lab, n = ndimage.label(nonwhite)
    for k in range(1, n + 1):
        ys, xs = np.where(lab == k)
        cols = canvas[ys, xs].astype(int)
        is_gray = (np.abs(cols - PAL[3]).sum(-1) < 60).mean() > 0.6
        if len(ys) < 400 and ys.mean() < 300 and is_gray:
            canvas[ys, xs] = (255, 255, 255)
            nonwhite[ys, xs] = False

    d2 = ((canvas.astype(int)[:, :, None, :] - PAL[None, None, :, :]) ** 2).sum(-1)
    idx = d2.argmin(-1).astype(np.uint8)
    white = ~nonwhite
    wlab, wn = ndimage.label(white)
    border = set(wlab[0, :]) | set(wlab[-1, :]) | set(wlab[:, 0]) | set(wlab[:, -1])
    border.discard(0)
    idx[np.isin(wlab, list(border))] = TRANSPARENT
    # enclosed white pockets: classify by boundary composition. The chest patch
    # always borders light teal (body interior); the envelope face is >=70%
    # gray/red; true background pockets (between legs, body-envelope gap) are
    # neither. NOTE: do not use outline/dark-teal ratios here - anti-aliased
    # white-to-outline edges quantize to gray and poison those ratios.
    for wl in range(1, wn + 1):
        if wl in border:
            continue
        comp = wlab == wl
        ring = ndimage.binary_dilation(comp, iterations=2) & ~comp & nonwhite
        ridx = idx[ring]
        if len(ridx) == 0:
            continue
        teal = (ridx == 0).sum() / len(ridx)                # light teal only
        envelope = np.isin(ridx, [3, 5]).sum() / len(ridx)  # gray, red
        if teal >= 0.08:
            continue  # chest: real content
        if envelope >= 0.70:
            continue  # envelope face: real content, keep whole. (A border-clip
            # was tried here to split merged face+gap components; it misfit
            # tilted envelopes and bit into the face. The merged white reads
            # fine as-is - do not reintroduce clipping.)
        idx[comp] = TRANSPARENT
    # targeted art cleanup: the source sheet has one large outlined teal blob
    # (a vestigial appendage) drawn into the body-envelope gap of one frame.
    # Only fragments >=100px qualify - smaller teal fragments are legitimate
    # pixel-art texture, and generic cleanup rules damage the tie and feet.
    bird_mask = np.isin(idx, [0, 1])
    blab, bn = ndimage.label(bird_mask)
    if bn > 1:
        bsizes = ndimage.sum(bird_mask, blab, range(1, bn + 1))
        bmain = int(np.argmax(bsizes)) + 1
        gray_mask = idx == 3
        glab, gn = ndimage.label(gray_mask)
        a_fit, b_fit = 0.0, 10 ** 6
        if gn:
            gsizes = ndimage.sum(gray_mask, glab, range(1, gn + 1))
            env_gray = glab == (int(np.argmax(gsizes)) + 1)
            cols = np.where(env_gray.any(axis=0))[0]
            tops = env_gray.argmax(axis=0)[cols].astype(float)
            med = np.median(tops)
            good = np.abs(tops - med) <= 20
            if good.sum() >= 10:
                a_fit, b_fit = np.polyfit(cols[good], tops[good], 1)
            else:
                a_fit, b_fit = 0.0, med
        for bk in range(1, bn + 1):
            if bk == bmain or not (100 <= bsizes[bk - 1] < 600):
                continue
            ys3, xs3 = np.where(blab == bk)
            cy, cx = ys3.mean(), xs3.mean()
            border_here = a_fit * cx + b_fit
            if not (border_here - 55 <= cy < border_here):
                continue
            fmask = blab == bk
            ring = ndimage.binary_dilation(fmask, iterations=2) & ~fmask
            if not ring.any() or (idx[ring] == 6).mean() < 0.40:
                continue
            # erase the blob's own outline ring, but protect outline pixels
            # that belong to the body, chest, tie, or feet (anything near the
            # main structures) - an unprotected shell bit the body outline
            protected = ndimage.binary_dilation(
                (blab == bmain) | (idx == 4) | (idx == 2), iterations=2)
            shell = ndimage.binary_dilation(fmask, iterations=3) & (idx == 6) & ~protected
            erased = fmask | shell
            idx[fmask] = TRANSPARENT
            idx[shell] = TRANSPARENT
            # repair: the blob's boundary doubled as the local body outline, so
            # erasing it exposes bare chest white to the background. Repaint the
            # exposed content edge (white/teal within the wound area, near the
            # new transparency) as outline so the bird's underside stays closed.
            near_wound = ndimage.binary_dilation(erased, iterations=6)
            transp = idx == TRANSPARENT
            near_gap = ndimage.binary_dilation(transp, iterations=6)
            repaint = near_wound & near_gap & np.isin(idx, [0, 1, 4])
            idx[repaint] = 6
    p = Image.fromarray(idx, mode="P")
    palette = PAL.astype(np.uint8).flatten().tolist() + [255, 0, 255]
    p.putpalette(palette + [0] * (768 - len(palette)))
    p.info["transparency"] = TRANSPARENT
    p_frames.append(p)

p_frames[0].save(OUT_GIF, save_all=True, append_images=p_frames[1:],
                 duration=110, loop=0, disposal=2, transparency=TRANSPARENT, optimize=False)
print(f"wrote {OUT_GIF} ({OUT_GIF.stat().st_size} bytes)")
assert OUT_GIF.stat().st_size < 50_000, "README asset must stay under 50 KB"
```

- [ ] **Step 5: Create `assets/mascot/README.md`**

```markdown
# Pip, the courier bird

Brand assets for the project mascot. Design spec:
[`docs/superpowers/specs/2026-07-11-mascot-brand-design.md`](../../docs/superpowers/specs/2026-07-11-mascot-brand-design.md).

| File | Purpose |
|---|---|
| `pip_flight_loop.gif` | The animated brand mark (README header). 6 frames, transparent, <50 KB. |
| `pip_avatar.png` | Static square avatar (repo/social use). |
| `social_preview.png` | 1280x640 card for GitHub Settings -> Social preview. |
| `sources/` | AI-generated sprite sheets the frames were cut from. |
| `reference/` | Retired flat-style sprites, kept as palette reference. |
| `assemble_flight_loop.py` | Regenerates the GIF from the tie sheet (pillow+numpy+scipy). |
| `make_brand_assets.py` | Regenerates avatar + social card from the GIF (pillow). |

Palette (exactly 7 colors): `#2a9d8f` `#1f6f65` `#e76f51` `#969ba0` `#ffffff` `#e63946` `#22333b`.
The sprite never carries text or logos. Alt text is always "Pip, the courier bird".
```

- [ ] **Step 6: Verify the regeneration script reproduces the GIF**

Run: `cd assets/mascot && python assemble_flight_loop.py`
Expected: `wrote ...pip_flight_loop.gif (~30000 bytes)`, no assertion error. Then run `git diff --stat assets/mascot/pip_flight_loop.gif` — if the file changed byte-wise but a re-run is stable, that is fine (the copy in Step 3 and the regenerated file must simply both be valid; keep the regenerated one).

- [ ] **Step 7: Run the existing suite (nothing should break)**

Run: `python -m unittest discover && python tools/lint_skills.py`
Expected: `OK` and `lint_skills: OK`

- [ ] **Step 8: Commit**

```bash
git add .gitignore assets/
git commit -m "feat(brand): add Pip mascot assets and regeneration pipeline"
```

---

### Task 2: README header swap + permanent image-reference guard

**Files:**
- Create: `tests/test_readme_assets.py`
- Modify: `README.md:1-3`
- Delete: `claude_animation.gif`

**Interfaces:**
- Consumes: `assets/mascot/pip_flight_loop.gif` from Task 1.
- Produces: nothing downstream; the test becomes a permanent CI guard.

- [ ] **Step 1: Write the guard test**

Create `tests/test_readme_assets.py` (stdlib only — CI installs no packages):

```python
"""Every local image referenced by README.md must exist in the repo.

A broken header image on the repo landing page is a silent, high-visibility
failure; this guard turns it into a red CI run instead.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
README = REPO / "README.md"

IMG_SRC = re.compile(r'<img[^>]+src="([^"]+)"')
MD_IMG = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")


class ReadmeImageReferences(unittest.TestCase):
    def _local_refs(self):
        text = README.read_text(encoding="utf-8")
        refs = IMG_SRC.findall(text) + MD_IMG.findall(text)
        return [r for r in refs if not r.startswith(("http://", "https://"))]

    def test_readme_exists_and_references_at_least_one_local_image(self):
        refs = self._local_refs()
        self.assertGreaterEqual(len(refs), 1, "README lost its mascot header image")

    def test_all_local_image_references_resolve(self):
        for ref in self._local_refs():
            with self.subTest(ref=ref):
                self.assertTrue((REPO / ref).is_file(), f"README references missing file: {ref}")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it — it must pass against the CURRENT README (claude_animation.gif still exists)**

Run: `python -m unittest tests.test_readme_assets -v`
Expected: 2 tests PASS (this proves the test works before the swap; it will catch a bad path after the swap)

- [ ] **Step 3: Swap the README header**

In `README.md`, replace exactly:

```html
  <img src="claude_animation.gif" alt="AI Job Search Assistant" width="200">
```

with:

```html
  <img src="assets/mascot/pip_flight_loop.gif" alt="Pip, the courier bird" width="200">
```

- [ ] **Step 4: Delete the old placeholder GIF**

Run: `git rm claude_animation.gif`

- [ ] **Step 5: Confirm no stale references remain**

Run: `grep -rn "claude_animation" --include="*.md" --include="*.yml" --include="*.tex" .`
Expected: no matches (the only reference was README.md line 2)

- [ ] **Step 6: Re-run the guard test — now validating the NEW path**

Run: `python -m unittest tests.test_readme_assets -v`
Expected: 2 tests PASS. (If Step 3's path had a typo, this fails — that is the guard working.)

- [ ] **Step 7: Full suite + lint**

Run: `python -m unittest discover && python tools/lint_skills.py`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add README.md tests/test_readme_assets.py
git commit -m "feat(brand): Pip takes over the README header"
```

---

### Task 3: Avatar and social preview card generator

**Files:**
- Create: `assets/mascot/make_brand_assets.py`
- Create: `assets/mascot/pip_avatar.png` (generated)
- Create: `assets/mascot/social_preview.png` (generated)

**Interfaces:**
- Consumes: `assets/mascot/pip_flight_loop.gif` from Task 1.
- Produces: `pip_avatar.png` (512x512 RGBA) and `social_preview.png` (1280x640 RGB) for the manual upload steps in Task 4.

- [ ] **Step 1: Write the generator**

Create `assets/mascot/make_brand_assets.py`:

```python
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
```

- [ ] **Step 2: Run it**

Run: `cd assets/mascot && python make_brand_assets.py`
Expected: `wrote ...pip_avatar.png` and `wrote ...social_preview.png`, no assertion errors

- [ ] **Step 3: Visually inspect both outputs**

Read `assets/mascot/pip_avatar.png` and `assets/mascot/social_preview.png` with the Read tool.
Check: avatar is centered with clear margins, transparent corners; card has no mascot/text overlap, wordmark and tagline legible, seal-red dot present. Iterate on coordinates if anything overlaps — the assertions catch overflow, only aesthetics need eyes.

- [ ] **Step 4: Full suite + lint**

Run: `python -m unittest discover && python tools/lint_skills.py`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add assets/mascot/make_brand_assets.py assets/mascot/pip_avatar.png assets/mascot/social_preview.png
git commit -m "feat(brand): generate Pip avatar and social preview card"
```

---

### Task 4: Final verification, push, and PR

**Files:**
- No file changes; verification, push, PR creation, and documented manual steps.

**Interfaces:**
- Consumes: all commits on `brand/mascot-pip` from Tasks 1-3 plus the two spec commits already on the branch.

- [ ] **Step 1: Full local verification**

Run: `python -m unittest discover -v && python tools/lint_skills.py && python tools/security_guards.py`
Expected: all green (security guards must pass — this PR touches .gitignore, which the guard inspects)

- [ ] **Step 2: Review the full diff**

Run: `git diff master...brand/mascot-pip --stat`
Expected: spec + plan docs, .gitignore (+2 lines), assets/mascot/* added, README.md (1 line changed), claude_animation.gif deleted, tests/test_readme_assets.py added. Nothing else.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin brand/mascot-pip
gh pr create --title "brand: meet Pip, the courier bird" --body "$(cat <<'EOF'
Replaces the placeholder header animation with the project's own mascot: **Pip**, a pixel-art courier bird delivering your applications (now with a tie - dressed for the interviews it books you).

- README header: transparent 6-frame flight loop, 30 KB, renders on light and dark themes
- assets/mascot/: master GIF, source sheets, retired palette-reference sprites, and the full regeneration pipeline (palette-snap to exactly 7 brand colors, beak-anchored alignment, measured flap-cycle ordering)
- tests/test_readme_assets.py: stdlib-only CI guard - every local image the README references must exist
- .gitignore: excludes .superpowers/ brainstorm artifacts
- Design spec included: docs/superpowers/specs/2026-07-11-mascot-brand-design.md

No behavior changes to any skill, command, or CLI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Wait for CI to pass before merging.

- [ ] **Step 4: Document the two manual steps for the maintainer**

These cannot be done via git and are Mads-manual:

1. **Social preview:** GitHub repo → Settings → General → Social preview → upload `assets/mascot/social_preview.png`
2. **Avatar (optional):** use `assets/mascot/pip_avatar.png` wherever a square mark is needed (e.g. a future org account; personal GitHub avatar stays personal)

- [ ] **Step 5: After merge (separate, do not merge unilaterally)**

Merging the PR is the maintainer's call in this repo's normal flow. After merge, verify the rendered README on github.com in both light and dark themes, then delete the local `brand/mascot-pip` branch.

---

## Self-Review (completed)

- **Spec coverage:** palette lock (Task 1 script + assets README), flight-loop GIF as README header with correct alt text (Task 2), social card with wordmark + tagline (Task 3), avatar (Task 3), seal-red echo (Task 3 card dot), `.superpowers/` gitignore (Task 1), `assets/mascot/` layout with sources/reference/scripts (Task 1), <50 KB budget (Task 1 assertion), both-themes render check (Task 4 Step 5). Out-of-scope items (pose redraws, Ko-fi copy, donation execution) correctly absent.
- **Placeholder scan:** no TBDs; all code complete.
- **Type consistency:** `pip_flight_loop.gif` path is identical across Tasks 1, 2, 3; palette constants match the spec hexes.
