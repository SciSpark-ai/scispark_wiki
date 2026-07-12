# SciSpark Visual Standard

> Extracted from the landing page (March 2026). Use this as the single source of truth for all SciSpark design work — web app, marketing, decks, docs.

---

## 1. Color Palette

### Core Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| **Page Background** | `#fefaf5` | Default page bg, light surfaces |
| **Page Warm** | `#f6f0e9` | Alternate section bg, warm panels |
| **Card Surface** | `#efe7dd` | Card backgrounds, FAQ items |
| **Light Surface** | `#faf6f2` | Badges, kicker chips, subtle fills |
| **Espresso** | `#2b180a` | Primary text, headings, logo |
| **Secondary Dark** | `#3e2407` | Secondary dark text (rare) |
| **Muted Text** | `#94877c` | Body copy, labels, descriptions |
| **Orange** | `#f97316` | Primary accent, CTAs, links, icons |
| **Orange Light** | `#fb923c` | Hover states, secondary accent |
| **Warm Tan** | `#dab697` | Star ratings, decorative accents |
| **Border Warm** | `#e8d3c0` | Borders, dividers, separators |
| **Gold** | `#fde68a` | Highlight, premium indicators |
| **White** | `#ffffff` | Cards on warm bg, inputs |

### Semantic Usage

```
Text primary     → Espresso #2b180a
Text secondary   → Muted Text #94877c
Text on accent   → White #ffffff
Background 1     → Page Background #fefaf5
Background 2     → Page Warm #f6f0e9
Background 3     → Card Surface #efe7dd
Accent           → Orange #f97316
Accent hover     → Orange/90 (90% opacity)
Accent subtle    → Orange/10 (10% opacity bg)
Border default   → Border Warm #e8d3c0
Border subtle    → Border Warm at 20-40% opacity
Selection        → Border Warm #e8d3c0 bg + Espresso text
Destructive      → oklch(0.577 0.245 27.325)
```

### Opacity Scale

Use Tailwind `/` notation for transparency:
- `/10` — subtle background tints (accent fills)
- `/20` — light borders, dividers
- `/30`–`/40` — medium borders on hover
- `/60` — disabled states
- `/80`–`/90` — text on colored surfaces, hover states

---

## 2. Typography

### Font Stack

| Role | Family | Fallback | Weight |
|------|--------|----------|--------|
| **Heading** | Halant | Georgia, serif | 400 (normal) |
| **Body** | Geist Sans | system-ui, sans-serif | 400, 500, 600 |
| **Mono** | Geist Mono | monospace | — |

### Type Scale

| Name | Mobile | Tablet (md) | Desktop (lg) | Use |
|------|--------|-------------|--------------|-----|
| **Display** | 40px | 52px | 62px | Hero headline |
| **H2** | 28px | 38px | 46px | Section headlines |
| **Stat** | 48px | 56px | — | Large numbers |
| **H3** | — | — | 24px (text-2xl) | Card titles, sub-sections |
| **Body Large** | 18px | 20px | — | Subheads, quotes |
| **Body** | 16px | — | — | Paragraphs, buttons |
| **Body Small** | 14px | — | — | Labels, captions, nav links |
| **Caption** | 12px | — | — | Badges, metadata |
| **Micro** | 10–11px | — | — | Chips, citation tags |

### Letter Spacing (Tracking)

| Token | Value | Use |
|-------|-------|-----|
| `tracking-heading-tight` | -0.07em | Hero display |
| `tracking-heading` | -0.06em | Section headings |
| `tracking-heading-card` | -0.05em | Card titles |
| `tracking-body` | -0.04em | Body text |

### Line Height

| Value | Use |
|-------|-----|
| 110% | Headlines, display text |
| 120% | Compact card text |
| 150% | Subheads, short paragraphs |
| 160% | Standard body copy |
| 170% | Long-form, blockquotes |

---

## 3. Spacing

### Container Widths

| Token | Value | Use |
|-------|-------|-----|
| `max-w-container` | 1200px | Outer page container |
| `max-w-content` | 1072px | Content area |
| `max-w-3xl` | 768px | Narrow content (quotes) |
| `max-w-2xl` | 672px | CTA groups |

### Section Padding

```
Horizontal:  px-6 (24px mobile)  →  lg:px-16 (64px desktop)
Vertical:    py-20 (80px)        →  md:py-[80px]
Hero top:    pt-[160px] mobile   →  md:pt-[180px]
```

### Component Spacing

| Context | Value |
|---------|-------|
| Card padding | 24–32px (p-6 or p-8) |
| Button padding | px-6 py-3 (24px / 12px) |
| Badge padding | px-4 py-1.5 |
| Input padding | px-4 py-3 |
| Grid gap (cards) | 24px (gap-6) |
| Grid gap (sections) | 48px (gap-12) |
| Stack gap (tight) | 4–8px (gap-1 to gap-2) |
| Stack gap (standard) | 12–16px (gap-3 to gap-4) |
| Bottom margin (heading → content) | 64px (mb-16) |

---

## 4. Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `rounded-card` | 28px | Cards, modals, large containers |
| `rounded-faq` | 16px | Accordions, medium containers |
| `rounded-btn` | 12px | Standard buttons, inputs |
| `rounded-pill` | 50px | Pill buttons, CTAs, tags |
| `rounded-badge` | 8px | Badges, small chips |
| `rounded-full` | 9999px | Avatars, dots, circles |

### Rule of thumb
- Large surfaces → 28px
- Interactive containers → 16px
- Buttons & inputs → 12px
- Pill CTAs → 50px
- Small labels → 8px

---

## 5. Texture

### Grain Overlay

A tileable 400x400px noise PNG (`/textures/grain.png`) applied as a repeating background overlay. Always rendered via the `<GrainOverlay>` component as an absolutely-positioned layer (parent needs `relative`).

| Intensity | Opacity | Use |
|-----------|---------|-----|
| `light` | 12% | Reserved for future use on large surfaces |
| `medium` | 20% | Medium surfaces (default) |
| `heavy` | 30% | Small colored surfaces (paper card header bars) |

**Current usage:** Card header bars only (heavy intensity). Section backgrounds tested but removed — looked dirty at scale.

**Rule:** Use `heavy` only on small, saturated-color elements. Never stack grain overlays.

---

## 6. Shadows

| Level | Value | Use |
|-------|-------|-----|
| **None** | — | Default cards on warm bg |
| **Small** | `shadow-sm` | Chat bubbles, reasoning panels |
| **Medium** | `shadow-lg` | Elevated cards, browser mockups |
| **Large** | `shadow-2xl` | Modals, overlays |
| **Custom hover** | `0 8px 30px rgba(0,0,0,0.08)` | Card lift on hover |

---

## 7. Motion & Animation

### Easing Curves

| Name | Value | Use |
|------|-------|-----|
| **Hero ease** | `cubic-bezier(0.55, 0, 0, 1)` | Page-load entrance |
| **Card ease** | `cubic-bezier(0.22, 1, 0.36, 1)` | Scroll reveals, card transitions, hover effects |
| **Mockup ease** | `cubic-bezier(0.68, 0, 0, 0.99)` | Large element reveals |
| **Default** | `easeOut` | Small UI transitions |

### Duration Scale

| Speed | Duration | Use |
|-------|----------|-----|
| **Instant** | 200ms | Hover color, focus ring |
| **Fast** | 300–400ms | Button effects, tooltips, small reveals |
| **Medium** | 500–700ms | Card reveals, section entrances |
| **Slow** | 800ms–1.2s | Hero elements, stagger sequences |
| **Dramatic** | 1.3–1.5s | Hero headline, display animations |

### Animation Patterns

**Scroll reveal (sections):** Fade up from y: 148px, duration 0.8s, hero ease.

**Card stagger:** Children stagger at 0.1s intervals, each fading up from y: 20px, 0.5s, card ease.

**Word reveal (headlines):** Per-word delay 0.08s, blur 6px → 0px.

**Stat counter:** Count from 0 to target value over ~2s on scroll into view.

**Hover lift (cards):** Translate y: -4px + shadow `0 8px 30px rgba(0,0,0,0.08)`.

**Button text rotate (Bind-style):** Duplicate label, both translate-y -100% on hover, 300ms, card ease.

### Viewport Trigger

All scroll animations use `viewport: { once: true, margin: "-80px" }` — trigger once, 80px before entering the viewport.

---

## 8. Layout & Grid

### Breakpoints

| Name | Width | Use |
|------|-------|-----|
| **Default** | 0px+ | Mobile-first base styles |
| **md** | 768px | Tablet — switch to multi-column |
| **lg** | 1024px | Desktop — full layout |

### Grid Patterns

```
3-column stats/cards:    grid-cols-1 md:grid-cols-3 gap-6
2-column features:       grid-cols-1 lg:grid-cols-2 gap-12
2-column equal:          grid-cols-1 md:grid-cols-2 gap-6
Single column centered:  max-w-content mx-auto text-center
```

### Fixed Dimensions

| Element | Value |
|---------|-------|
| Navigation height | 65px |
| CTA button height | 48px |
| Paper card width | 320px |
| Chat mockup height | 420px |
| Number circle | 48px (w-12 h-12) |

---

## 9. Component Styles

### Buttons

**Primary (CTA):**
```
bg-orange text-white text-base font-medium
px-6 py-3 h-[48px] rounded-pill
hover:bg-orange/90 transition
```

**Secondary (Outline):**
```
border border-espresso/20 text-espresso text-base font-medium
px-6 py-3 h-[48px] rounded-pill
hover:border-espresso/40 transition
```

**Nav CTA:**
```
bg-orange text-white text-sm font-medium
px-5 py-2.5 rounded-btn
hover:bg-orange/90 transition
```

**Ghost / Text:**
```
text-muted-text hover:text-espresso transition
(no background, no border)
```

**Disabled:**
```
disabled:opacity-60 disabled:cursor-not-allowed
```

### Cards

**Standard card:**
```
bg-white rounded-card p-6 border border-border-warm/30
```

**Stat card:**
```
bg-card-surface rounded-card p-8 text-center
```

**Elevated card (on hover):**
```
bg-white rounded-card shadow-lg
transform: translateY(-4px)
box-shadow: 0 8px 30px rgba(0,0,0,0.08)
```

### Inputs

**Email / Text:**
```
px-4 py-3 rounded-[12px] bg-white text-espresso
border border-border-warm/40
placeholder:text-muted-text/60
focus:border-orange transition
```

### Badges / Chips

**Kicker badge:**
```
px-4 py-1.5 rounded-badge bg-light-surface
text-sm font-medium text-muted-text
```

**Citation chip:**
```
px-2 py-0.5 rounded-full bg-orange/10
text-[10px] text-orange border border-orange/20
```

**Tab (active):**
```
px-4 py-1.5 rounded-pill bg-orange text-white text-sm
```

**Tab (inactive):**
```
px-4 py-1.5 rounded-pill bg-border-warm/50 text-muted-text text-sm
hover:bg-border-warm
```

### Navigation

```
Fixed top, z-50, h-[65px]
backdrop-blur-[5px] bg-[rgba(252,246,239,0.16)]
border-b border-border-warm/20
```

### Overlay / Backdrop

```
bg-espresso/30 backdrop-blur-sm
(z-[100] for mobile menu, z-50 for modals)
```

---

## 10. Icons

**Library:** Lucide React

**Sizes:**
| Context | Size |
|---------|------|
| Inline / metadata | 14–15px |
| UI controls | 16px |
| Navigation | 22–24px |
| Feature icons (in circles) | 18–20px |

**Color:** Inherit from parent text color. Accent icons use `text-orange`.

---

## 11. Specialty Colors (Evidence Feed)

Used for paper card header bars to identify medical specialties:

| Specialty | Color | Note |
|-----------|-------|------|
| Cardiology | `#ea580c` | red-orange |
| Psychiatry | `#6b7280` | gray |
| Oncology | `#d97706` | amber |
| Pediatrics | `#f59e0b` | yellow-amber |
| Neurology | `#4b5563` | dark gray |
| Internal Medicine | `#059669` | emerald |
| Other / custom | `#94877c` | fallback muted gray |

---

## 12. Design Philosophy

These principles apply to **all** SciSpark surfaces — landing page, app, marketing, docs.

**Warm, not clinical.** Dark espresso text on warm cream, not black on white. Every surface has warmth. No pure white page backgrounds. No pure black text. The product deals with clinical evidence, but it should feel approachable and human — like a trusted colleague, not a hospital terminal.

**Serif authority, sans-serif clarity.** Halant headings give scholarly weight. Geist body text keeps things clean and modern. This pairing signals "we're serious about research" without feeling stuffy.

**Orange energy.** A single accent color used consistently for CTAs, active states, icons, and highlights. No secondary accent colors. Orange is energetic and distinctive — it's the "spark" in SciSpark.

**Generous space.** Airy layouts with breathing room. Large padding, comfortable gaps, generous margins. Content should never feel cramped. Whitespace (warm-space) is a feature.

**Subtle motion.** Animations are smooth, purposeful, and never distracting. Card ease `(0.22, 1, 0.36, 1)` for most UI transitions. All scroll animations trigger once. Motion should feel like the interface is breathing, not performing.

**Organic shapes.** Large rounded corners (28px cards, 50px pills), no sharp edges. Surfaces feel soft and tactile. Grain texture adds organic depth to colored headers.

**Consistent depth.** Cards lift on hover (-4px + shadow). Modals use shadow-2xl. Sidebars use border, not shadow. Each surface has a clear layer in the depth hierarchy.

---

## Quick Reference: Do / Don't

| Do | Don't |
|----|-------|
| Use Halant for headings, Geist for body | Mix heading fonts or use system serif |
| Use orange as the single accent color | Introduce new accent colors |
| Use warm cream/tan backgrounds | Use pure white (#fff) as page background |
| Use 28px radius for cards, 50px for pills | Use sharp corners or inconsistent radii |
| Animate on scroll with `once: true` | Loop animations or animate on every scroll |
| Use card ease `(0.22, 1, 0.36, 1)` for UI | Use linear or default ease for interactions |
| Keep body text at 16px, muted color | Use body text smaller than 14px |
| Apply negative tracking on all text | Use default (0) letter-spacing |
| Use opacity scale for border/bg variants | Use separate gray colors for each opacity |
