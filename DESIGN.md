---
name: Emara
description: Local deterministic codebase functionality auditor and Cadastral Survey Atlas architecture visualizer.
colors:
  parcel-blue-border: "#1D4ED8"
  parcel-blue-ink: "#1E3A8A"
  parcel-blue-bg: "#EFF6FF"
  parcel-blue-rule: "#93C5FD"
  easement-ochre-border: "#B45309"
  easement-ochre-ink: "#78350F"
  easement-ochre-bg: "#FFFBEB"
  easement-ochre-rule: "#FCD34D"
  review-crimson-border: "#DC2626"
  review-crimson-ink: "#991B1B"
  review-crimson-bg: "#FEF2F2"
  review-crimson-rule: "#FCA5A5"
  verified-green-border: "#047857"
  verified-green-ink: "#065F46"
  verified-green-bg: "#ECFDF5"
  bg-vellum: "#EEF2F6"
  bg-rail: "#E5EBF2"
  bg-plate: "#FFFFFF"
  bg-plate-subtle: "#F8FAFC"
  bg-header-cell: "#DCE4EE"
  bg-ledger: "#16181D"
  bg-ledger-elevated: "#262932"
  border-hairline: "#CBD5E1"
  border-strong: "#94A3B8"
  border-row: "#E2E8F0"
  ink-0: "#16181D"
  ink-1: "#2E323B"
  ink-2: "#4B5262"
  ledger-ink: "#F6F4EE"
  ledger-muted: "#CBD5E1"
  ledger-gold: "#FDE68A"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.45
  code:
    fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "28px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-0}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.none}"
    padding: "0 22px"
  button-primary-hover:
    backgroundColor: "{colors.parcel-blue-border}"
    textColor: "{colors.ledger-ink}"
  button-ledger:
    backgroundColor: "{colors.bg-ledger-elevated}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  button-ledger-active:
    backgroundColor: "{colors.review-crimson-border}"
    textColor: "{colors.bg-plate}"
  badge-parcel:
    backgroundColor: "{colors.parcel-blue-bg}"
    textColor: "{colors.parcel-blue-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  badge-easement:
    backgroundColor: "{colors.easement-ochre-bg}"
    textColor: "{colors.easement-ochre-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  card-plate:
    backgroundColor: "{colors.bg-plate}"
    textColor: "{colors.ink-0}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  input-field:
    backgroundColor: "{colors.bg-plate}"
    textColor: "{colors.ink-0}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 11px"
---

# Design System: Emara

## Overview

**Creative North Star: "The Cadastral Survey Atlas"**

Emara treats software repositories as surveyed municipal land registries rather than glowing sci-fi telemetry dashboards. Inspired by Sanborn fire insurance atlases and ordnance survey plates, the visual system renders codebases on cool mineral-linen paper stock (`--bg-vellum`) anchored by a deep surveyor-carbon folio header (`--bg-ledger`). Every capability is plotted as a bounded parcel with explicit property lines (`1px solid`), separating modules owned exclusively by a single feature from shared right-of-way easements and unreferenced deletion-review candidates.

Density is calibrated for senior engineers auditing 80+ routes, capabilities, and source deeds in a single desktop viewport. Instead of floating cards with blurred drop shadows or decorative gradients, hierarchy is established through crisp structural rules, high-contrast semantic paper tints, orthogonal SVG survey callout lines, and SHA-256-verified source line provenance. Because the application operates under a strict zero-external-network Content-Security-Policy (`default-src 'none'`), all typography, geometry, and iconography are self-contained.

**Key Characteristics:**
- Daylight-first mineral-linen survey ground (`--bg-vellum`) paired with a dark surveyor-carbon top ledger (`--bg-ledger`) and a `2px solid` ochre bottom datum rule.
- Immediate semantic ownership coding: Surveyor Blue for exclusive capability parcels, Surveyor Ochre for shared right-of-way easements, and Deletion-Review Crimson for static removal simulation and missing implementations.
- Zero-shadow, sharp-cornered (`0px` radius) architectural drafting plates separated by exposed `1px solid` rules and a `24px` SVG cadastral graticule on the dependency stage.
- Strict tabular monospace provenance for every file path, line range, module count, and `sha256` deed hash.

## Colors

The palette pairs archival mineral-linen paper stocks and carbon ledger ink with four high-contrast cartographic fill-and-ink families, each verified above 4.5:1 WCAG AA contrast.

### Primary
- **Surveyor Parcel Blue Border** (`--parcel-blue-border`): Primary interactive focus ring, active parcel schedule selection border, primary button hover fill, and inbound orthogonal SVG callout strokes.
- **Surveyor Parcel Blue Ink** (`--parcel-blue-ink`): High-contrast semantic ink for exclusive capability badges, clickable file/line coordinates, and inline code citations.
- **Surveyor Parcel Blue Tint** (`--parcel-blue-bg`): Paper tint for exclusive capability summary headers, active sidebar parcel rows, and hover states on deeded code rows.
- **Surveyor Parcel Blue Rule** (`--parcel-blue-rule`): Hairline inner border for exclusive parcel stamps and input focus outlines.

### Secondary
- **Surveyor Easement Ochre Border** (`--easement-ochre-border`): Structural border for shared right-of-way easements, topbar ledger datum rule (`--border-ledger`), simulated single-consumer degradation outlines, and outbound SVG easement callout lines.
- **Surveyor Easement Ochre Ink** (`--easement-ochre-ink`): Semantic text ink for shared easement badges, CLI entrypoint stamps, and borrowed file rows.
- **Surveyor Easement Ochre Tint** (`--easement-ochre-bg`): Warm cartographic wash applied to shared subsystem cards, borrowed file rows, and repository folio tags.
- **Surveyor Easement Ochre Rule** (`--easement-ochre-rule`): Border rule for ochre stamps, warning badges, and folio tags.

### Tertiary
- **Deletion-Review Crimson Border** (`--review-crimson-border`): Active fill for the `Simulate Removal` toggle, structural outline for statically freed or orphaned cards, and warning SVG connector lines during removal simulation.
- **Deletion-Review Crimson Ink** (`--review-crimson-ink`): High-contrast text ink for static removal impact banners, freed file rows, and missing-implementation badges.
- **Deletion-Review Crimson Tint** (`--review-crimson-bg`): Alert paper wash for the simulated removal banner and statically exclusive file rows under deletion review.
- **Deletion-Review Crimson Rule** (`--review-crimson-rule`): Border token for crimson danger stamps.
- **Verified Deed Green Border / Ink / Tint** (`--verified-green-border`, `--verified-green-ink`, `--verified-green-bg`): Reserved for documented capability stamps (`DOCUMENTED`) and verified unused deletion candidates (`VERIFIED UNUSED`).

### Neutral
- **Mineral-Linen Vellum** (`--bg-vellum`): Primary canvas ground across the landing launchpad and the center dependency stage.
- **Schedule Rail Stock** (`--bg-rail`): Recessed cool-linen surface for the left Capability Parcel Schedule, inspector header bar, and section sub-headers.
- **Survey Sheet Plate** (`--bg-plate`): Pure white surface for cadastral column sheets, source deed inspector lines, and the landing folio card.
- **Subtle Plate Wash** (`--bg-plate-subtle`): Secondary off-white fill for resting sidebar parcel buttons, infrastructure cards, and empty-state notes.
- **Column Header Cell** (`--bg-header-cell`): Slate-tinted header band capping each of the three cadastral stage columns and UI/baseplate badges.
- **Surveyor Carbon Ledger** (`--bg-ledger`) & **Elevated Ledger** (`--bg-ledger-elevated`): Deep carbon surface and control well for the 58px top ledger bar, commit folio pills, and lens switcher tabs.
- **Surveyor Inks** (`--ink-0`, `--ink-1`, `--ink-2`): Three-tier typographic hierarchy on light paper stock, from primary carbon headings (`--ink-0`) and secondary body copy (`--ink-1`) to muted line numbers and metadata (`--ink-2`).
- **Ledger Inks** (`--ledger-ink`, `--ledger-muted`, `--ledger-gold`): Warm parchment text (`--ledger-ink`), inactive tab ink (`--ledger-muted`), and brass-gold monospace stamp ink (`--ledger-gold`) on the dark carbon topbar.
- **Drafting Rules** (`--border-strong`, `--border-hairline`, `--border-row`): Three structural rule weights separating outer plates (`--border-strong`), pane dividers (`--border-hairline`), and internal lot rows (`--border-row`).

### Named Rules
**The Parcel Ownership Polarity Rule.** Surveyor Blue (`--parcel-blue-bg` / `--parcel-blue-border`) is reserved strictly for exclusive capability ownership and primary selection focus; Surveyor Ochre (`--easement-ochre-bg` / `--easement-ochre-border`) is reserved strictly for shared right-of-way easements and multi-consumer dependencies. Never swap or mix these two semantic fills for decorative variety.

**The Epistemic Crimson Rule.** Deletion-Review Crimson (`--review-crimson-bg` / `--review-crimson-border`) appears only when previewing static removal blast radius, flagging documented-but-unimplemented gaps, or surfacing errors—always paired with explicit prose stating that static exclusivity is not automatic proof of safe deletion.

## Typography

**Display & UI Font:** System Technical Sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`)
**Label & Code Font:** Tabular Technical Monospace (`"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`)

**Character:** A zero-latency, CSP-compliant pairing that contrasts clean, tightly tracked technical sans headings against crisp, tabular monospace coordinates, file paths, and SHA-256 deed hashes.

### Hierarchy
- **Display** (`700` weight, `28px`, `1.2` line-height, `-0.02em` letter-spacing): Landing card survey headline (`Survey any commit into functional parcels`). Collapses to `22px` below `760px`.
- **Headline** (`700` weight, `24px`, `1.25` line-height, `-0.02em` letter-spacing): Active capability parcel title in the center stage header.
- **Title** (`700` weight, `18px`, `1.35` line-height, `-0.01em` letter-spacing): Topbar brand title and left sidebar schedule heading (`Parcel Schedule`), supported by `16px` (`700` weight) repository titles and `15px` (`700` weight) primary center-parcel card headers.
- **Body** (`400`–`600` weight, `13px`–`14px`, `1.45`–`1.6` line-height): Landing explanatory copy (`14px`, `max-width: 68ch`), card titles (`13px`, `700` weight), and lens switcher tabs (`13px`, `600` weight).
- **Label** (`600`–`700` weight, `12px`, `1.45` line-height, monospace): Survey stamps/badges, sidebar group headers, file/line coordinates, commit pills, and column item counts with `font-variant-numeric: tabular-nums`.
- **Code** (`400` weight, `12.5px`, `1.6` line-height, monospace): Line-numbered source code inside the Verified Source Deed Inspector (`600` weight when highlighted).

### Named Rules
**The 12px Minimum Stamp Floor Rule.** Every badge, survey stamp, line number, and metadata counter uses a minimum font size of `12px` in `var(--mono)` with `font-variant-numeric: tabular-nums`. Sub-12px micro-text and all-caps letter-spaced eyebrow kickers above headings are forbidden.

**The Zero-External-Font Rule.** Because Emara enforces `default-src 'none'` to safely inspect untrusted repository source code, typography must resolve exclusively from the local `--sans` and `--mono` stacks without network font requests.

## Layout

Emara operates in two spatial modes within a single self-contained HTML shell:

1. **Repository Survey Launchpad (`.landing-screen`):** A full-viewport vertical flex layout (`min-height: 100vh`) with a top carbon ledger bar (`14px 28px` padding) and a centered white survey folio card (`max-width: 960px`, `32px 36px` padding). Pinned repository snapshots sit in a 3-column CSS Grid (`.preset-grid`, `grid-template-columns: repeat(3, minmax(0, 1fr))`, `14px` gap).
2. **Cadastral Workbench Shell (`.app`):** A locked `100vh × 100vw` viewport grid (`grid-template-rows: 58px minmax(0, 1fr)`) with `overflow: hidden` on desktop:
   - **Top Surveyor Ledger (`.topbar`):** Fixed `58px` height, `0 20px` horizontal padding, housing brand navigation, repository commit folio pill, 3-lens view tabs (`Capability Parcels`, `Shared Easements`, `Deletion review`), and action controls (`Analyze Commit…`, `Simulate Removal`).
   - **3-Pane Cadastral Workspace (`.workspace`):** `grid-template-columns: 296px minmax(0, 1fr) 380px`:
     - **Left Pane (`.sidebar`, `296px`):** Scrollable Capability Parcel Schedule with sticky search filter and grouped parcel buttons (`10px 12px 16px` list padding).
     - **Center Pane (`.stage`, `minmax(0, 1fr)`):** Fixed stage header (`16px 24px` padding) over a scrollable stage body (`20px 24px 28px` padding) containing the 3-column Cadastral Survey Board (`.flow-board`, `grid-template-columns: minmax(0, 1fr) minmax(0, 1.22fr) minmax(0, 1fr)`, `28px` gap) and an absolute-positioned SVG connector layer (`.flow-svg-layer`).
     - **Right Pane (`.inspector`, `380px`):** Verified Source Deed Inspector with a `44px` tabular line-number gutter and scrollable source lines (`grid-template-columns: 44px minmax(0, 1fr)`).

**Responsive Breakpoints:**
- **`@media (max-width: 1120px)`:** Unlocks document vertical scrolling (`height: auto`), stacks `.workspace` and `.flow-board` into single-column (`1fr`) layouts, hides the desktop SVG connector overlay (`.flow-svg-layer { display: none }`), and caps `.sidebar` (`max-height: 320px`) and `.inspector` (`max-height: 420px`).
- **`@media (max-width: 760px)`:** Collapses `.preset-grid` to `1fr`, reduces `.landing-card` padding to `22px 18px`, stacks `.prompt-form` vertically with a `44px` submit button height, and makes `.lens-tabs` horizontally scrollable.

## Elevation & Depth

Emara is an intentionally **flat, zero-shadow architectural system**. There are no drop shadows, ambient glows, or `backdrop-filter` blurs anywhere in the interface. Depth and hierarchy are conveyed entirely through tonal paper layering and crisp drafting rules:

1. **High-Contrast Header Grounding:** The dark carbon ledger (`--bg-ledger`) and its `2px solid var(--border-ledger)` ochre datum rule anchor the top edge of the viewport against the light mineral-linen canvas (`--bg-vellum`).
2. **Tonal Paper Stock Layering:** Recessed navigation and metadata rails use cool linen (`--bg-rail`), interactive column sheets and the source inspector sit on pure white plates (`--bg-plate`), and column headers use slate-tinted bands (`--bg-header-cell`).
3. **Structural Border Hierarchy:** Outer sheets and cards are bounded by `1px solid var(--border-strong)`, pane dividers use `1px solid var(--border-hairline)`, and stacked lot rows inside a column use `1px solid var(--border-row)`.
4. **Interactive Selection & Simulation Rings:** Active sidebar parcels receive an crisp inset border ring (`box-shadow: inset 0 0 0 1px var(--parcel-blue-border)`), while simulated removal states apply `2px solid` structural outlines (`outline-offset: -2px`) in crimson or ochre.

### Named Rules
**The Zero-Shadow Drafting Rule.** Never apply blurred `box-shadow` elevations or translucent glassmorphism to cards, panels, or popovers. Separation between surfaces is achieved strictly through paper stock shifts (`--bg-vellum` → `--bg-rail` → `--bg-plate`) and `1px` or `2px` solid rules.

## Shapes

Every component in Emara uses **square `0px` corners** (`border-radius: 0`) to echo cut paper survey sheets, index cards, and inked rubber stamps.

- **Plates & Columns:** Rectangular sheets bounded by `1px solid var(--border-strong)` with internal horizontal row dividers (`1px solid var(--border-row)`), eliminating nested card-in-card border clutter.
- **Landing Folio Header Rule:** Divided by a heavy `2px solid var(--ink-0)` bottom ledger rule (`padding-bottom: 12px`).
- **Orthogonal SVG Cadastral Connectors:** Dependency edges between columns are drawn as 90-degree stepped SVG paths (`M x1 y1 L midX y1 L midX y2 L x2 y2`) at `1.5px` stroke width (`2.2px` when focused) over a `24px × 24px` SVG graticule pattern (`#94A3B8` at `0.22` opacity), terminated by `3.5px`-radius survey station circles.
- **Archival Scrollbars:** Scrollable panes use `scrollbar-width: thin` (`8px` width/height) with `--border-strong` thumbs over `--bg-rail` tracks.

## Components

Components feel like tactile, precision-drafted cartographic instruments—crisp, immediate, and free of ornamental chrome.

### Buttons
- **Shape:** Square corners (`0px` radius) with `1px solid` structural borders.
- **Primary Submit (`.prompt-submit`):** Carbon fill (`--ink-0`), warm parchment text (`--ledger-ink`), `1px solid var(--ink-0)`, `0 22px` padding, `14px` (`600` weight) sans. Transitions `background-color` (`140ms ease`) to Surveyor Blue (`--parcel-blue-border`) on hover. Disabled state uses `--bg-header-cell` fill with `--ink-1` text.
- **Topbar Ledger Controls (`.brand-mark`, `.switch-btn`, `.sim-toggle`):** Elevated carbon fill (`--bg-ledger-elevated`), `1px solid #3F4452`, `6px 12px` padding (`5px 11px` for `.brand-mark`), `13px` (`600` weight) sans with `--ledger-ink` text (`12px` `700` mono in `--ledger-gold` for `.brand-mark`). Hover shifts border to `--ledger-gold`.
- **Simulate Removal Active State (`.sim-toggle.active`):** Switches background to `--review-crimson-border` (`#DC2626`), border to `--review-crimson-rule` (`#FCA5A5`), and text to `#FFFFFF`.
- **Focus Treatment:** `2px solid var(--parcel-blue-border)` with `outline-offset: -2px`.

### Chips / Survey Stamps (`.badge`)
- **Style:** Inline-flex rectangular stamps (`1px 6px` padding, `0px` radius, `12px` `600` weight `var(--mono)`, `white-space: nowrap`) with a `1px solid` semantic border.
- **Variants:**
  - **Parcel / HTTP (`.badge-http`):** `--parcel-blue-bg` fill, `--parcel-blue-ink` text, `--parcel-blue-rule` border.
  - **Easement / CLI (`.badge-cli`, `.badge-warn`):** `--easement-ochre-bg` fill, `--easement-ochre-ink` text, `--easement-ochre-rule` border.
  - **Baseplate / UI (`.badge-ui`):** `--bg-header-cell` fill, `--ink-0` text, `--border-strong` border.
  - **Verified / Documented (`.badge-ok`):** `--verified-green-bg` fill, `--verified-green-ink` text, `--verified-green-border` border.
  - **Danger / Exclusive Freed (`.badge-danger`):** `--review-crimson-bg` fill, `--review-crimson-ink` text, `--review-crimson-rule` border.
  - **Neutral (`.badge-neutral`):** `--bg-rail` fill, `--ink-1` text, `--border-strong` border.

### Cards / Cadastral Plates & Lot Rows
- **Column Sheet (`.flow-col`):** White plate (`--bg-plate`), `1px solid var(--border-strong)`, capped by a `.col-header` (`--bg-header-cell` fill, `10px 14px` padding, `13px` `700` sans, `1px solid var(--border-strong)` bottom border).
- **Parcel Lot Row (`.flow-card`):** `12px 14px` internal padding, separated by `1px solid var(--border-row)` bottom border (`0` on `:last-child`). Hover on `.clickable` shifts fill to `--bg-plate-subtle`; shared easement cards (`.shared-card`) rest on `--easement-ochre-bg` and hover to `#FEF3C7`.
- **Primary Center Parcel Card (`.flow-card.primary-card`):** Opens with a `.parcel-summary-head` (`12px 14px` padding, `--parcel-blue-bg` fill, `1px solid var(--parcel-blue-rule)` bottom border), followed by `.section-label` bands (`7px 14px` padding, `--bg-rail` fill, `12px` `700` mono) and interactive `.code-row` items (`8px 14px` padding, `12px` mono).
- **Preset Snapshot Cards (`.preset-btn`):** `16px` padding, `min-height: 132px`, `--bg-plate-subtle` fill, `1px solid var(--border-strong)`. Hover shifts fill to `--parcel-blue-bg` and border to `--parcel-blue-border`.

### Inputs / Fields
- **Schedule Search Input (`.search-input`):** `--bg-plate` fill, `1px solid var(--border-strong)`, `8px 11px` padding, `12px` `var(--mono)`, `--ink-0` text with `--ink-2` placeholder.
- **Launchpad Commit Input (`.prompt-input-container` / `.prompt-input`):** `--bg-plate-subtle` container fill with `1px solid var(--border-strong)`, `12px 16px` input padding, `13px` `var(--mono)`.
- **Focus State:** Shifts border to `--parcel-blue-border`, background to `--bg-plate`, and adds `outline: 2px solid var(--parcel-blue-rule)` with `outline-offset: -1px`.

### Navigation
- **Lens Switcher Tabs (`.lens-tabs` / `.lens-tab`):** Housed inside an elevated carbon well (`--bg-ledger-elevated`, `4px` padding, `4px` gap, `1px solid #3F4452`). Tabs use `5px 12px` padding, `13px` (`600` weight) sans, and `--ledger-muted` text, with a tabular `.lens-count` badge (`12px` mono). Active tab (`.lens-tab.active`) flips to light mineral-linen (`--bg-vellum`) with `--ink-0` text and `1px solid var(--border-strong)`.
- **Sidebar Parcel Schedule Item (`.nav-item`):** Full-width button (`10px 12px` padding, `6px` bottom margin, `--bg-plate-subtle` fill, `1px solid var(--border-hairline)`). Hover upgrades to `--bg-plate` fill and `--border-strong` border; `.active` applies `--parcel-blue-bg` fill, `--parcel-blue-border` border, and `inset 0 0 0 1px var(--parcel-blue-border)`.

### Verified Source Deed Inspector (Signature Component)
- **Structure:** Right-hand `380px` pane (`.inspector`) pairing a recessed `.inspector-header` (`14px 18px` padding, `--bg-rail` fill) showing the active file path and `Line X–Y · Deed sha256:...` provenance subtitle with a scrollable `.code-viewer` (`12.5px` mono, `1.6` line-height).
- **Line Highlighting (`.code-line`):** Two-column grid (`44px minmax(0, 1fr)`, `1px 14px` padding) with right-aligned tabular line numbers (`--ink-2`) and pre-wrapped source text (`--ink-0`). Target evidence lines receive `.code-line.highlight` (`#DBEAFE` fill, `600` weight) and smoothly scroll to center.

## Do's and Don'ts

### Do:
- **Do** keep the workspace grounded in daylight mineral-linen (`--bg-vellum`) and pure white plates (`--bg-plate`), reserving dark carbon (`--bg-ledger`) strictly for the top ledger bar and primary action buttons.
- **Do** encode architectural ownership consistently: Surveyor Blue (`--parcel-blue-bg` / `--parcel-blue-border`) for exclusive capability parcels and Surveyor Ochre (`--easement-ochre-bg` / `--easement-ochre-border`) for shared right-of-way dependencies.
- **Do** pair every architectural claim, route card, and dependency edge with a clickable monospace file path, line number, and SHA-256 deed hash in the inspector.
- **Do** use orthogonal 90-degree stepped SVG callout lines (`#1D4ED8` inbound, `#B45309` outbound, `#DC2626` degraded/orphaned) and `1px solid` horizontal row dividers inside columns.
- **Do** frame all static removal simulations and orphan candidates with explicit epistemic caveats (`not validated for deletion`).

### Don't:
- **Don't** introduce dark-mode obsidian canvases, neon cyan/purple glow accents, blurred drop shadows, or `backdrop-filter` glassmorphism.
- **Don't** load external web fonts, icon font CDNs, or third-party scripts that violate the `default-src 'none'` Content-Security-Policy.
- **Don't** round corners on cards, badges, buttons, or inputs; maintain the `0px` cadastral sheet geometry throughout.
- **Don't** set any badge, line number, or metadata label below `12px` or omit `font-variant-numeric: tabular-nums` on numeric counters.
- **Don't** wrap individual `.code-row` or `.flow-card` items in nested rounded boxes with separate drop shadows inside a `.flow-col` sheet; let horizontal `1px solid var(--border-row)` rules divide the column cleanly.
