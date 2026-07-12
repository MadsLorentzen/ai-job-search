# Mascot & Brand Design: Pip the Courier Bird

Date: 2026-07-11
Status: Approved

## Purpose

Give the project a distinctive, ownable brand mark to replace the placeholder
`claude_animation.gif`, anchor the donation appeal, and make shared repo links
recognizable. Decisions below were made interactively with the maintainer; this
document is the single source of truth for brand assets.

## 1. The mascot

**Pip**, a pixel-art courier bird. Identity: the AI agent that works for you on
your machine - it searches job portals and delivers applications while you live
your life. Pip is the agent, not the job seeker.

Canonical style: the outlined redesign (dark outline, happy closed eye,
expressive wing), which supersedes the original flat-style sprites. Pip wears a
**small dark tie** (same `#22333b` as the outline - the palette stays at 7
colors): the agent is dressed for the interviews it books you, and the tie
sways with the wing beats. The three original flat PNGs are retired as
candidates but kept as palette reference.

**Locked palette (exactly 7 colors):**

| Role | Hex |
|---|---|
| Body teal | `#2a9d8f` |
| Wing dark teal | `#1f6f65` |
| Beak & feet coral | `#e76f51` |
| Envelope border gray | `#969ba0` |
| Envelope & belly white | `#ffffff` |
| Envelope seal red | `#e63946` |
| Outline | `#22333b` |

The **red-sealed envelope** is the signature brand detail and appears in every
pose. No text, logos, or tooling motifs are ever baked into the sprite; the
mark stays pure and brand attachment comes from the surfaces around it
(section 3).

## 2. The animated mark

`assets/mascot/pip_flight_loop.gif` - the moving brand mark.

- 6 frames, 110 ms/frame, infinite loop
- Measured flap cycle: wing high, mid, flat, swept-down, low, rising - ordered
  by per-frame wing-centroid measurement
- Beak-anchored: head fixed across frames; wing, body bob, envelope sway, and
  tie swing carry the motion
- Every pixel snapped to the 7-color palette (no cross-frame color drift)
- No per-frame rescaling (the source birds are size-consistent; rescaling by
  noisy measurements caused a visible zoom pulse in an early build)
- True transparent background (edge-connected flood fill; belly and envelope
  whites stay opaque)
- 560 px square master, displayed at 200 px; approximately 30 KB

Provenance: an initial tie-less loop was generated with Gemini from a locked
prompt (palette, choreography, loop constraints); the final tie-edition frames
were generated with ChatGPT from the same design, then sliced, palette-snapped,
beak-anchored, and assembled locally, with two targeted art repairs (one stray
outlined blob removed and the exposed underside outline repainted). The full
pipeline lives in `assets/mascot/assemble_flight_loop.py` and reproduces the
shipped GIF exactly from `assets/mascot/sources/chatgpt_tie_sheet.png`.

## 3. Brand surfaces

1. **README header** - the flight-loop GIF replaces `claude_animation.gif`, same 200 px
   centered slot. Alt text: "Pip, the courier bird".
2. **GitHub social preview card** - 1280x640 PNG uploaded in repo settings:
   Pip + `ai-job-search` wordmark + tagline "job search that runs on your
   machine". This card is the primary brand-attachment surface (shown on every
   shared link).
3. **Avatar / favicon** - a static square pose in the outlined style (the
   envelope-hugger composition reads best square). Until it is redrawn, a
   cropped flight frame is acceptable.
4. **Seal-red echo** - `#e63946` may be reused sparingly as an accent (social
   card). No other motifs enter the sprite.

## 4. Repo hygiene

- `.superpowers/` added to `.gitignore` (brainstorm mockups never ship)
- Brand assets live in `assets/mascot/`: the master GIF, the source sprite
  sheets, the assembly script, and the retired flat PNGs (palette reference)
- Forks inherit the brand by default; nothing personal is embedded

## Out of scope

- Redrawing the standing / hugger poses in the outlined style (follow-up; the
  Gemini prompt pattern from this session is reusable)
- Donation-strategy execution (separate initiative; the mascot supports it but
  this spec does not change Ko-fi copy)
- Any change to the mascot to represent the job seeker, add text to the GIF,
  or add tooling motifs - explicitly considered and rejected

## Success criteria

- README renders the transparent GIF cleanly in both GitHub light and dark
  themes, no stray artifacts in any frame
- Social preview shows the lockup on link shares
- Total added repo weight for the README-rendered asset stays under 50 KB
