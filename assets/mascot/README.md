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
