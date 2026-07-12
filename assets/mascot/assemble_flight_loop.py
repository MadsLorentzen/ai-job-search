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
