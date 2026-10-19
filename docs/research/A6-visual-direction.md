# A6 — Visual direction for MAOS: «Конструктивный Кандинский»

> 2026-10-18. Every contrast ratio here was computed by script (OKLCH → sRGB → WCAG 2.x). CVD values are the minimum pairwise ΔE in OKLab ×100 under Machado-2009 protan/deutan/tritan simulation. All marks were rendered in headless Chrome at 16/32/64/128 px on #0d0f16 and #f8f5ef under both colour schemes.

**Direction.** Keep Blueprint's density and component semantics. Replace the flat cold grey with an **ultramarine-tinted ink ground and warm bone text**, and add a Kandinsky accent set (ultramarine / ochre / cinnabar, plus verdigris and oxblood). Atmosphere (aurora, grain, halo) stays in the chrome and on empty surfaces. One geometric vocabulary (point, line, ●, ■, ▲) is used for the logo, the status glyphs and the diagrams.

---

## 1. Kandinsky grounding → logo rules

**Point and Line to Plane (1926)**
- **The point** is "the ultimate and most singular union of silence and speech" (p. 23). It becomes a plane as it grows and is kin to the circle.
- **The line** is the trace of a moving point. Horizontal = cold; vertical = warm; diagonal = cold-warm, "the measure of tension". Free lines are unbalanced and pierce the plane.
- **Angles carry colour.** Acute (≤60°) = warm, tense → **yellow**. Right angle = cold, controlled → **red** (the square). Obtuse = passive, close to the circle → **blue**.
- **The basic plane.** Above = lightness and freedom; below = density and constraint; left = "into the distance"; right = "toward home". So the upper-left is the loosest corner and the lower-right the heaviest. The lower-left→upper-right diagonal is **harmonic** ("lyric"); the upper-left→lower-right one is **dramatic** (pp. 116–129). On a square, a small deviation from the orthogonal is "decisive".

**Concerning the Spiritual in Art (1911)**
- Two antitheses. Warm/cold: yellow advances toward the viewer, blue recedes and is "heavenly". Light/dark: white is a silence "pregnant with possibilities", black is a dead silence.
- Green is yellow and blue cancelled: still. Violet is red cooled.
- **Keen colours go in sharp forms, deep colours in round forms.** Mismatches can "open new harmonies", and that licence is what the tart variant uses.

**The Bauhaus triad** is yellow ▲ / red ■ / blue ● (1923 questionnaire). Its answers were partly primed, so treat it as a convention, not psychology.

**Compositions**
- *Composition VIII* (1923): small, intense circles and acute triangles on a lattice of thin lines.
- *Several Circles* (1926): overlapping translucent circles with halos on a deep ground; each overlap is a third colour.
- *Yellow-Red-Blue* (1925): sharp yellow on the left, red as the bridge, curved blue on the right, with black lines stitching them together.

**Logo rules**
1. Use at most 4 elements, and every element carries a meaning that holds across the product (§6).
2. ▲ is warm/ochre, ■ is red-family, ● is blue-family. Break this exactly once, on purpose.
3. Heavy elements go lower-right and light ones up. Flow runs along the harmonic diagonal; tension along the dramatic one.
4. Each mark gets one deliberate tension: a ≈12° tilt or a tangency/overlap. An overlap gets an explicit third colour (clip-path), not an opacity blend.
5. At 64 units = 16 px (4 units per pixel): strokes ≥ 4, gaps ≥ 2, the smallest shape ≥ 10.
6. A mark either carries its own ground (a disc or a tile) or swaps palette per theme.

---

## 2. Logo concepts (SVG files next to this report)

| File | Composition → meaning | Themes / contrast |
|---|---|---|
| `A6-logo-1.svg` **«Триада»** | Ultramarine ● (the plant as a system) at lower-left. Cinnabar ■ (machines, material) in the heavy corner. An upright acute ochre ▲ (41°, optimisation as the warm vertical). A line on the harmonic diagonal runs through the centre of ● and goes in under ▲ (flow from the system into optimisation). | Swaps palette through CSS variables. Dark: ● 3.9, ■ 5.7, ▲ 9.7, line 16.5. Light: 5.9 / 5.1 / 3.2 / 16. |
| `A6-logo-2.svg` **«Несколько кругов»** | A dark disc with a halo. A large ultramarine ● and a smaller ochre ● overlap in a **green lens**: blue + yellow = green = the plan meeting reality, the "running" state. Plus a cinnabar point (the order or event in focus) and a bone point ("possibility", allowed to vanish at 16 px). The nested circles map to the app's zoom levels: world → plant → shop. | Self-grounded, so it is identical in both themes. The halo ring is 5.2:1 against the dark UI. |
| `A6-logo-3.svg` **«Терпкий»** | Muted ochre tile. A deep ultramarine disc. An **oxblood ■ tilted −12°** whose corner cuts into the disc (aubergine lens). An off-black line on the **dramatic** diagonal stops at the square, and an off-centre bone point sits inside it. Dissonant palette: ochre / oxblood / ultramarine / off-black / bone. | Self-grounded tile, 8.2:1 against dark. The inner elements are 3.8–7.8:1 against the tile. It is the most legible at 16 px. |
| `A6-logo-lockup.svg` | Mark 1 plus a font-free wordmark **M Λ ● S** built from the same primitives (verticals and diagonals, an acute angle, the blue disc, two arcs). | Same variables as mark 1. |

**Recommendation.** Mark **3** as the favicon and app icon; mark **1** inline in the top bar and the lockup; mark **2** as the login hero, with the circles drifting slowly.

**Caveat (seen in the renders).** Inside an `<img>` or favicon, `prefers-color-scheme` follows the OS, not MAOS's `data-theme`, so a light app on a dark OS renders mark 1's bone line on bone. In the app, inline mark 1 as a React component bound to `[data-theme]` tokens. Marks 2 and 3 are immune.

---

## 3. Colour system (OKLCH, dark-first)

Surfaces sit at hue 268 with low chroma; text is bone at hue 85. That warm-on-cool dissonance is the "tart" base. Ratios are given against **app / panel / card / elevated**.

### Dark
| Token | OKLCH | Hex | Contrast |
|---|---|---|---|
| bg-app · panel · card · elevated | 0.170/0.200/0.235/0.275, C 0.014–0.017, h 268 | #0d0f16 · #13161d · #1b1e26 · #242730 | — |
| border (decorative) / border-strong | 0.33 / 0.42, 0.016 268 | #32353e / #494d57 | 1.4–1.6 / 1.8–2.3 |
| **border-control** (inputs, 1.4.11) | 0.56 0.020 268 | #6f7481 | 4.09 / 3.87 / 3.56 / 3.19 |
| text | 0.95 0.012 85 | #f2eee6 | 16.5 / 15.6 / 14.4 / 12.9 |
| text-secondary | 0.82 0.012 85 | #c8c4bc | 11.0 / 10.4 / 9.6 / 8.6 |
| text-muted | 0.70 0.014 268 | #9b9ea7 | 7.15 / 6.76 / 6.22 / 5.57 |
| text-disabled (exempt) | 0.52 0.014 268 | #656971 | 3.5 – 2.7 |
| **accent ultramarine** (fill) | 0.56 0.200 268 | #4366e8 | 3.92 / 3.71 / 3.42 / 3.06; **white on it 4.88** |
| accent-hover | 0.62 0.190 268 | #567bf7 | 5.08 / 4.80 / 4.42 / 3.96 |
| accent-text (links, focus) | 0.76 0.120 268 | #90aefe | 8.82 / 8.34 / 7.67 / 6.87 |
| **ochre** (highlight, critical path) | 0.79 0.140 80 | #e9af41 | 9.73 / 9.20 / 8.47 / 7.58 |
| **cinnabar** (brand red) | 0.66 0.180 33 | #eb5e43 | 5.66 / 5.36 / 4.93 / 4.41 (not for text on elevated) |
| **verdigris** (feasible, healthy) | 0.76 0.110 175 | #58c8ad | 9.37 / 8.86 / 8.16 / 7.30 |
| oxblood (brand and illustration only) | 0.42 0.130 22 | #86262b | 2.1 against the ground, so use it only under bone |

**Status.** Each status has a shape glyph, so colour is never the only signal.

| State | Glyph | OKLCH | Hex | a / p / c / e | Solid badge |
|---|---|---|---|---|---|
| running / success | ● | 0.76 0.150 152 | #5bcc80 | 9.47 / 8.96 / 8.25 / 7.38 | #10703a + white 6.18 |
| setup / warn | ▲ | 0.80 0.150 78 | #f2b036 | 10.1 / 9.51 / 8.76 / 7.84 | same fill + ink 10.1 |
| idle | ○ | 0.70 0.030 268 | #969eb2 | 7.14 / 6.75 / 6.21 / 5.56 | outline |
| down / danger | ■ | 0.68 0.190 27 | #f75e54 | 6.09 / 5.76 / 5.30 / 4.75 | #be2323 + white 6.08 |
| info | ◆ | 0.74 0.130 258 | #76acfc | 8.27 / 7.82 / 7.20 / 6.45 | accent + white 4.88 |

All status text passes AA on every surface. The minimum CVD ΔE across the four machine states is 7.3. Follow ISA-101 in the 3D scene: normal states are calm, and saturated colour is for abnormal ones.

**Categorical palette, dark** (fill slots 1–6 first):
1. ultramarine 0.62 0.17 262 #4a81eb
2. ochre 0.78 0.15 75 #efa831
3. verdigris 0.70 0.11 172 #47b497
4. cinnabar 0.62 0.18 38 #dc5426
5. sky 0.84 0.08 232 #95d4f6
6. violet 0.54 0.15 318 #924da6
7. lemon 0.91 0.16 104 #f3e657
8. grey «прочее» 0.60 0.01 85 #83807a

All eight are ≥3.0:1 against the card. The minimum ΔE across normal and all three CVD types is **8.3** (tritan, ultramarine/verdigris), against **7.5** for Okabe–Ito. Sequential scale: ultramarine→bone; diverging: cinnabar↔bone↔ultramarine, interpolated in OKLCH. Gantt bars are coloured by order; state is shown by glyph or hatching.

### Light sketch: paper at h 85, ink at h 268
| Token | OKLCH | Hex | a / p / c / e |
|---|---|---|---|
| bg app / panel / card / elevated | 0.970 0.008 85 · 0.945 0.010 85 · 0.995 0.004 85 · white | #f8f5ef · #f0ece5 · #fffdfa · #fff | — |
| text / secondary / muted | 0.22 0.020 268 · 0.38 0.018 268 · 0.49 0.016 268 | #171a24 · #3e424c · #5c606a | ≥14.7 · ≥8.5 · ≥5.35 |
| border-control | 0.62 0.016 268 | #828690 | 3.10–3.64 |
| accent (fill, link) | 0.50 0.21 268 | #3250d8 | 5.45–6.41; white on it 6.41 |
| ochre / cinnabar / verdigris (text-safe) | 0.53 0.115 70 · 0.54 0.18 32 · 0.50 0.09 175 | #955e00 · #c1351e · #107460 | 4.60–5.69 |
| running ● / idle ○ / down ■ | 0.50 0.125 152 · 0.50 0.02 268 · 0.50 0.19 27 | #12773d · #5e636f · #b7191c | 4.78–6.63 |
| setup ▲ | 0.66 0.14 70 | #c8800d | 2.95 / 2.72 / 3.16 / 3.21; needs a 1 px ink outline. Lighter than down, so deuteranopes can separate them. |

**Categorical palette, light (core 6):** ultramarine 0.48 0.20 268, ochre 0.67 0.14 68, verdigris 0.56 0.10 170, cinnabar 0.57 0.19 34, sky 0.66 0.10 232, violet 0.42 0.15 318.
- All six are ≥3:1 against white; minimum CVD ΔE 8.9.
- Slot 7, oxblood 0.36 0.09 22, keeps the minimum at 7.8.
- A grey slot collides with verdigris under protan, so draw «прочее» hatched.

**Implementation.** As in Linear's generator, derive the ladder from three inputs (base hue, accent, contrast) with relative colour, e.g. `oklch(from var(--base) calc(l + .035) c h)`.

---

## 4. Background treatment

| Surface | Aurora | Grain |
|---|---|---|
| Login / splash | animated | 6% |
| Shell chrome | static tint; a 1 px ultramarine→ochre hairline under the top bar | 3% |
| Empty states, onboarding | static, plus a Kandinsky mini-diagram (§6) | 4% |
| Modals, command palette | — (halo instead of a black drop shadow) | 4% |
| **Tables, Gantt, KPI, forms, 3D canvas, MapLibre** | **never** | **never** (noise eats hairlines and small digits; overlays on WebGL cost a composite per frame) |

**Finding.** `.modal-overlay` uses `backdrop-filter: blur(3px)` (`src/styles/global.css`), which blurs the live 3D canvas on every frame. Use a plain scrim while the canvas is mounted.

**Aurora (transform-only)**
```css
.aurora{position:fixed;inset:0;overflow:hidden;contain:strict;pointer-events:none;background:var(--bg-app)}
.aurora i{position:absolute;width:320px;height:320px;border-radius:50%;
  background:radial-gradient(closest-side,var(--c),transparent);opacity:.55;
  will-change:transform;animation:drift var(--t) ease-in-out infinite alternate}
.aurora i:nth-child(1){--c:oklch(.32 .13 268);--t:41s;left:-5%;top:-10%}
.aurora i:nth-child(2){--c:oklch(.30 .10 22); --t:53s;right:0;top:30%;animation-delay:-17s}
.aurora i:nth-child(3){--c:oklch(.36 .08 75); --t:67s;left:30%;bottom:-15%;animation-delay:-31s}
@keyframes drift{from{transform:translate3d(0,0,0) scale(4)}to{transform:translate3d(12vw,8vh,0) scale(5.2) rotate(30deg)}}
@media (prefers-reduced-motion:reduce){.aurora i{animation:none;transform:scale(4.5)}}
.aurora[data-paused] i{animation-play-state:paused}
```
- **GPU.** Each blob is a 320 px layer (≈1.6 MB at DPR 2). `will-change` freezes the raster scale, so the compositor upscales it for free and a soft blob loses nothing. There is no repaint per frame.
- **Do not** animate `background-position` or `@property` gradient stops; both repaint the whole viewport every frame.
- Set `data-paused` whenever the 3D or map view is visible.
- The co-prime periods (41/53/67 s) hide the loop.
- Text stays ≥9.5:1 over the brightest blob, but muted text drops to 4.1 over the ochre blob, so keep login copy on the card.

**Grain (`feTurbulence`, rasterised once)**
```css
.grain::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:var(--grain,.05);
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
[data-theme=light] .grain::after{--grain:.035}
```
- Skip `mix-blend-mode: overlay` on full-viewport layers.
- Animated "film" grain (`steps(6)`) is for login only and is off under reduced motion.
- **Halo focus ring:** `box-shadow:0 0 0 1px var(--accent),0 0 0 4px oklch(from var(--accent) l c h / .28)`.
- Set the three.js `scene.background` and fog to #0d0f16 so the twin sits *inside* the UI.

---

## 5. Typography

Each family was checked against the Google Fonts API on 2026-10-18; all are variable and include Cyrillic. The feature tags come from the GF builds.

| Role | Family | Notes |
|---|---|---|
| UI and body | **Onest** (wght 100–900) | Cyrillic-native, calm at 12–14 px; `tnum`, `zero`, `case` |
| Display and headings | **Unbounded** (wght 200–900) | Wide and constructivist, echoes the marks; use at ≥20 px only |
| Mono | **JetBrains Mono** (wght 100–800) | IDs, codes, logs |
| Safe alternative | Inter (opsz + wght) + JetBrains Mono | `tnum`, `ss01`, `zero` |
| Characterful alternative | Geologica + Geist Mono | both now ship Cyrillic on GF |

Self-host with `@fontsource-variable/*` so the defence works offline, use `font-display: swap`, and preload only Onest.

**Scale** (base 13):
- 11: caps labels, 600, +0.06em, `"case"`
- 12: meta
- **13: body and tables**
- 14: forms
- 16: panel titles
- 20: screen titles, Unbounded 500
- 24
- 32: KPI hero, Onest 300
- 44: login display, Unbounded 300

Line height is 1.45 for body and 1.15 for display. **Numerals:** `.num{font-variant-numeric:tabular-nums lining-nums slashed-zero}` on tables, Gantt axes and KPIs. Right-align numbers, use U+2212 for minus, keep the `ru-RU` NBSP grouping, and set units one step smaller in muted.

---

## 6. Abstract-diagram language

**Grammar**
- ● = a system or whole; ■ = a resource or entity; ▲ = an objective or decision; · = an instance or event.
- Solid line = material flow; dashed = information or feedback; line weight = magnitude.
- Ultramarine = the model; ochre = the objective; cinnabar = risk; verdigris = feasible; ink and bone = structure.
- Progress runs along the harmonic diagonal or left→right. Stochasticity is drawn as **grain or point clouds inside a shape**.
- Precision is kept: real labels, API names, axes and numbers; an 8 px grid; strokes 1.5 and 3; one accent area per diagram. Build them as React SVG components that read the theme tokens.

**D1 «Две стадии».**
- Left: a cloud of bone points, «Сценарий: распределения цен».
- Top middle: an ochre ▲ with grain inside, «Стадия 2 — устойчивый портфель (что выпускать)».
- Right: a large ultramarine ● «Стадия 1 — расписание (как выпускать)», containing a 3×4 grid of ■ machines with thin Gantt bars. A few bars trail a cinnabar "comet tail" for heavy-tailed durations.
- Lines: solid ▲→● `portfolio_items`; dashed ●→▲ «распределения себестоимости / срока / пропускной способности»; cloud→▲ «Монте-Карло».

**D2 «CVaR = среднее худших α».**
- A profit axis with N = 200 Monte-Carlo outcomes drawn as a beeswarm of points.
- An ink vertical line at VaR₀.₁₀; the plane left of it is cinnabar at 15%, labelled «худшие α = 10%».
- The tail points condense into a **cinnabar ● at their mean = CVaR**; an **ultramarine ●** marks E.
- A bracket between the two is labelled «w_risk·(E − CVaR)», matching the `score` term in `docs/SCHEDULING.md`.
- For makespan the diagram is mirrored, because the bad tail is on the right.

**D3 IDEF0 ICOM.** Kandinsky's basic plane lines up with IDEF0's own arrow sides.
- A bone-outlined ■ «A0» with its node number in mono in the lower-right.
- **Controls enter from above** ("lightness": plans, norms) as ultramarine dashed lines.
- **Inputs come from the left** ("the distance") and **Outputs leave to the right** ("toward home"), as ink solid lines with acute ▲ heads.
- **Mechanisms come from below** ("earth": machines, workers) as cinnabar ■ chips.
- The standard IDEF0 labels stay, so the diagram remains valid for the thesis.

---

## 7. References: what to take

1. **Linear** (2024 LCH redesign; "calmer interface", 2026-03-12): themes from three inputs; warmer greys, a dimmer sidebar, fewer and softer borders.
2. **Vercel / Geist**: hairline grid and crosshair motifs for empty states; monochrome chrome with one spot colour.
3. **Stripe**: a gradient mesh as atmosphere on entry surfaces only.
4. **Raycast**: near-black with one vivid accent; grain and glow on the palette and modals.
5. **Arc**: a grainy theme per space, so each MAOS project database can get its own chrome hue and favicon tint.
6. **Rerun**: 3D views plus a timeline in neutral chrome, and "blueprint" layouts as a model for the plant/plan workspace.
7. **Palantir Blueprint / AIP**: keep the density, the intents and the keyboard affordances; drop the flat grey and the blue "M" square.
8. **Teenage Engineering**: product-as-diagram, numbered callouts, mono numerals; the model for §6.
9. **Nothing**: one red accent on monochrome, display type used sparingly.
10. **Observable Plot / Framework**: charts treated as part of the design system.

**Sources:**
- Kandinsky, *Point and Line to Plane* (archive.org, 1947 Guggenheim translation, pp. 23–29, 116–129)
- Kandinsky, *Concerning the Spiritual in Art* (Gutenberg #5321)
- Centre Pompidou, the *Gelb-Rot-Blau* entry
- Guggenheim and NOMA notes on *Several Circles*
- *ZÄK* (2019), on the Bauhaus questionnaire
- linear.app/now
- Google Fonts CSS2 API
- vercel.com/font

The scripts and renders are in `scratchpad/tools/` (`oklch.py`, `final.py`, `prev-0.png`, `prev-1.png`).
