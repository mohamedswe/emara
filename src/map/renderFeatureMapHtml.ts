import { basename } from "node:path";

import type { IndexedSourceFile } from "../graph/indexedSourceFile.ts";
import type { RepositoryGraph, RepositoryNode } from "../graph/types.js";
import type { FeatureMap } from "./types.js";

export interface RenderFeatureMapHtmlOptions {
  repositoryName?: string;
  graph: RepositoryGraph;
  featureMap: FeatureMap;
  sourceFiles?: readonly IndexedSourceFile[];
}

export interface EmbeddedNodeMeta {
  id: string;
  type: string;
  name: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  exported?: boolean;
}

export interface ViewerPayload {
  repositoryName: string;
  featureMap: FeatureMap;
  nodes: Record<string, EmbeddedNodeMeta>;
  sources: Record<string, { hash: string; lines: string[] }>;
}

export interface AppShellPreset {
  id: string;
  label: string;
  subtitle: string;
  path: string;
}

export interface RenderFeatureMapAppShellOptions {
  presets?: readonly AppShellPreset[];
  initialPayload?: ViewerPayload | null;
}

const MAX_EMBEDDED_FILE_LINES = 1_500;

export function buildViewerPayload(
  options: RenderFeatureMapHtmlOptions,
): ViewerPayload {
  const repositoryName =
    options.repositoryName?.trim() || "Repository Architecture";
  const nodes = buildEmbeddedNodeIndex(options.graph);
  const sources = buildEmbeddedSourceMap(
    options.graph,
    options.featureMap,
    options.sourceFiles ?? [],
  );
  return {
    repositoryName,
    featureMap: options.featureMap,
    nodes,
    sources,
  };
}

export function renderFeatureMapHtml(
  options: RenderFeatureMapHtmlOptions,
): string {
  const payload = buildViewerPayload(options);
  return renderFeatureMapAppShellHtml({
    initialPayload: payload,
  });
}

export function renderFeatureMapAppShellHtml(
  options: RenderFeatureMapAppShellOptions = {},
): string {
  const presets = options.presets ?? [];
  const initialPayload = options.initialPayload ?? null;
  const pageTitle = initialPayload
    ? `${initialPayload.repositoryName} — Emara Feature Architecture`
    : "Emara — Commit & Codebase Feature Visualizer";

  const serializedBoot = JSON.stringify({
    presets,
    initialPayload,
  }).replaceAll("</script>", "<\\/script>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      /* Obsidian & Champagne Gold Design System */
      --bg-canvas: #050505;
      --bg-surface: #0a0a0b;
      --bg-elevated: #111113;
      --bg-elevated-hover: #161618;
      --accent-gold: #d4af37;
      --accent-champagne: #f3e5ab;
      --accent-gold-text: #e5c158;
      --border-gold: rgba(212, 175, 55, 0.35);
      --border-gold-focus: rgba(212, 175, 55, 0.55);
      --halo-gold: rgba(212, 175, 55, 0.12);

      --bg-0: #050505;
      --bg-1: #0a0a0b;
      --bg-2: #111113;
      --bg-3: #161618;
      --surface-glass: rgba(10, 10, 11, 0.88);
      --surface-glass-strong: rgba(10, 10, 11, 0.96);
      --surface-card: #111113;
      --border: rgba(255, 255, 255, 0.06);
      --border-strong: rgba(255, 255, 255, 0.12);
      --border-glow: rgba(212, 175, 55, 0.35);

      --text-0: #fafafa;
      --text-1: #a1a1aa;
      --text-2: #71717a;
      --text-3: #52525b;

      --accent: #d4af37;
      --accent-bright: #f3e5ab;
      --royal: #c59b27;
      --indigo: #d4af37;
      --accent-soft: rgba(212, 175, 55, 0.12);

      --green: #10b981;
      --green-bright: #34d399;
      --green-soft: rgba(16, 185, 129, 0.14);
      --amber: #d4af37;
      --amber-soft: rgba(212, 175, 55, 0.14);
      --purple: #e5c158;
      --purple-soft: rgba(229, 193, 88, 0.12);
      --red: #f43f5e;
      --red-soft: rgba(244, 63, 94, 0.15);
      --cyan: #f3e5ab;
      --cyan-soft: rgba(243, 229, 171, 0.12);

      --mono: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
      --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --display: "Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--bg-canvas);
      color: var(--text-0);
      font-family: var(--sans);
      font-size: 13px;
      line-height: 1.5;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    ::selection {
      background: rgba(212, 175, 55, 0.22);
      color: #fafafa;
    }

    .hidden { display: none !important; }

    @keyframes cardEntrance {
      from { opacity: 0; transform: translate3d(0, 10px, 0); }
      to { opacity: 1; transform: translate3d(0, 0, 0); }
    }
    @keyframes edgeFlow {
      from { stroke-dashoffset: 28; }
      to { stroke-dashoffset: 0; }
    }

    /* ==========================================================================
       1. AMBIENT BACKGROUND & CONTAINER
       ========================================================================== */
    .landing-screen {
      position: relative;
      min-height: 100vh;
      width: 100vw;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
      overflow-x: hidden;
      overflow-y: auto;
      background-color: var(--bg-canvas);
      background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212, 175, 55, 0.07), transparent);
      background-repeat: no-repeat;
      isolation: isolate;
    }

    .ambient-graph-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      opacity: 0.32;
      filter: blur(0.4px);
    }

    /* Main Card Surface */
    .landing-card {
      position: relative;
      z-index: 2;
      width: 100%;
      max-width: 960px;
      background: var(--bg-surface);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      padding: 32px 36px 28px;
      box-shadow:
        0 32px 80px -12px rgba(0, 0, 0, 0.85),
        inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
      animation: cardEntrance 0.65s var(--ease-out-expo) both;
      overflow: visible;
      margin: auto;
    }

    /* ==========================================================================
       2. RESTRAINED BRAND BADGE & TYPOGRAPHY
       ========================================================================== */
    .kicker-row {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      margin-bottom: 14px;
    }

    .landing-kicker {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 5px 12px 5px 10px;
      border-radius: 999px;
      background: #121214;
      border: 1px solid rgba(212, 175, 55, 0.25);
      color: #e5c158;
      font-family: var(--mono);
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      transition: border-color 0.18s ease, transform 0.18s var(--ease-spring);
    }
    .landing-kicker:hover {
      border-color: rgba(212, 175, 55, 0.45);
      transform: translateY(-1px);
    }

    .status-dot-core {
      position: relative;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #d4af37;
      flex-shrink: 0;
    }

    .landing-title {
      margin: 0 0 8px;
      font-family: var(--sans);
      font-size: 26px;
      font-weight: 600;
      line-height: 1.25;
      letter-spacing: -0.03em;
      color: #fafafa;
    }

    .landing-sub {
      margin: 0 0 20px;
      color: #a1a1aa;
      font-size: 13.5px;
      line-height: 1.6;
      font-weight: 400;
    }
    .landing-sub code {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 500;
      color: #e5c158;
      background: rgba(212, 175, 55, 0.08);
      border: 1px solid rgba(212, 175, 55, 0.18);
      padding: 2px 7px;
      border-radius: 5px;
    }

    /* ==========================================================================
       3. REFINED INPUT BAR & "ANALYZE COMMIT" CTA
       ========================================================================== */
    .prompt-form-shell {
      position: relative;
      margin-bottom: 8px;
    }

    .prompt-form {
      display: flex;
      align-items: stretch;
      gap: 12px;
      position: relative;
      z-index: 2;
    }

    .prompt-input-container {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
      border-radius: 10px;
      background: #070708;
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition:
        border-color 150ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 150ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .prompt-input-container:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }
    .prompt-input-container:focus-within {
      border-color: rgba(212, 175, 55, 0.55);
      box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.12);
    }

    .prompt-input {
      flex: 1;
      width: 100%;
      background: transparent;
      border: 0;
      border-radius: 10px;
      padding: 12px 16px;
      color: #fafafa;
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 400;
      letter-spacing: 0.01em;
      outline: none;
      caret-color: #d4af37;
    }
    .prompt-input::placeholder {
      color: #52525b;
      font-weight: 400;
    }

    .prompt-submit {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: linear-gradient(180deg, #e5c158 0%, #c59b27 100%);
      color: #09090b;
      border: 1px solid rgba(229, 193, 88, 0.55);
      border-radius: 10px;
      padding: 0 20px;
      font-family: var(--sans);
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.01em;
      cursor: pointer;
      white-space: nowrap;
      box-shadow:
        0 2px 10px rgba(212, 175, 55, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.35);
      transition:
        transform 150ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 150ms cubic-bezier(0.16, 1, 0.3, 1),
        filter 150ms ease;
    }
    .prompt-submit:hover {
      box-shadow:
        0 4px 14px rgba(212, 175, 55, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.45);
      filter: brightness(1.03);
    }
    .prompt-submit:active {
      transform: translateY(1px);
    }
    .prompt-submit:disabled {
      cursor: progress;
      opacity: 0.85;
      filter: grayscale(0.2);
    }

    .btn-arrow-cue {
      display: inline-block;
      font-size: 14px;
      line-height: 1;
      transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .prompt-submit:hover .btn-arrow-cue {
      transform: translateX(2px);
    }

    .prompt-status {
      font-family: var(--mono);
      font-size: 12px;
      color: #e5c158;
      margin: 8px 0 4px;
      min-height: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .prompt-status.error {
      color: #f87171;
    }

    /* ==========================================================================
       4. CLEAN DIVISIONALS & REPOSITORY CARDS
       ========================================================================== */
    .presets-section {
      margin-top: 18px;
      position: relative;
    }

    .section-divider {
      width: 100%;
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
      margin: 18px 0 16px;
    }

    .presets-header-row {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      margin-bottom: 12px;
    }

    .presets-label {
      font-family: var(--sans);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #71717a;
      margin: 0;
    }

    .preset-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 860px) {
      .preset-grid {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
    }
    @media (max-width: 600px) {
      .preset-grid {
        grid-template-columns: 1fr;
      }
    }

    .preset-btn {
      --mouse-x: 50%;
      --mouse-y: 50%;
      position: relative;
      text-align: left;
      background: #111113;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px 16px 14px;
      color: var(--text-0);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 8px;
      min-height: 128px;
      overflow: hidden;
      transition:
        transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
        border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
        background 180ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .preset-btn::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(300px circle at var(--mouse-x) var(--mouse-y), rgba(212, 175, 55, 0.06), transparent 40%);
      opacity: 0;
      transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }
    .preset-btn:hover {
      transform: translateY(-2px);
      background: #161618;
      border-color: rgba(212, 175, 55, 0.35);
      box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.6);
    }
    .preset-btn:hover::before {
      opacity: 1;
    }
    .preset-btn:active {
      transform: translateY(0);
    }

    .preset-top-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      position: relative;
      z-index: 1;
    }
    .preset-identity {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .preset-owner {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 400;
      color: #71717a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preset-repo-name {
      font-family: var(--mono);
      font-weight: 600;
      font-size: 13px;
      color: #f4f4f5;
      letter-spacing: -0.01em;
      line-height: 1.35;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 35px;
    }
    .preset-star-count {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 500;
      color: #a1a1aa;
      white-space: nowrap;
      letter-spacing: 0.02em;
      flex-shrink: 0;
      padding-top: 1px;
    }
    .preset-desc {
      font-size: 12px;
      color: #71717a;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      position: relative;
      z-index: 1;
    }

    /* ==========================================================================
       MAIN VISUALIZER WORKSPACE (COHESIVE CYBER-GLASS UPGRADE)
       ========================================================================== */
    .app {
      display: grid;
      grid-template-rows: 56px 1fr;
      height: 100vh;
      width: 100vw;
      background: var(--bg-0);
    }

    /* Header */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      background: rgba(10, 10, 11, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      gap: 16px;
      position: relative;
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 10px;
      border-radius: 8px;
      background: #121214;
      border: 1px solid rgba(212, 175, 55, 0.25);
      color: #e5c158;
      font-family: var(--mono);
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.04em;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      transition: all 0.2s var(--ease-spring);
    }
    .brand-mark:hover {
      border-color: rgba(212, 175, 55, 0.5);
      color: #fafafa;
      transform: translateY(-1px);
    }
    .repo-title {
      font-family: var(--display);
      font-weight: 700;
      font-size: 14.5px;
      color: var(--text-0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .commit-pill {
      font-family: var(--mono);
      font-size: 11px;
      color: #e5c158;
      background: rgba(212, 175, 55, 0.08);
      border: 1px solid rgba(212, 175, 55, 0.18);
      padding: 2px 8px;
      border-radius: 6px;
    }

    .lens-tabs {
      display: flex;
      gap: 4px;
      background: #070708;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    .lens-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-2);
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 600;
      padding: 6px 13px;
      border-radius: 7px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
      transition: all 0.2s var(--ease-spring);
    }
    .lens-tab:hover { color: var(--text-0); }
    .lens-tab.active {
      background: #161618;
      border-color: rgba(212, 175, 55, 0.35);
      color: var(--text-0);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }
    .lens-count {
      font-family: var(--mono);
      font-size: 10.5px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(212, 175, 55, 0.12);
      color: #e5c158;
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .switch-btn, .sim-toggle {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #111113;
      color: var(--text-1);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s var(--ease-spring);
    }
    .switch-btn:hover, .sim-toggle:hover {
      border-color: rgba(212, 175, 55, 0.35);
      color: var(--text-0);
      transform: translateY(-1px);
    }
    .sim-toggle.active {
      border-color: var(--red);
      background: var(--red-soft);
      color: #fda4af;
      box-shadow: 0 0 18px rgba(244, 63, 94, 0.3);
    }

    /* Workspace 3-pane layout */
    .workspace {
      display: grid;
      grid-template-columns: 308px 1fr 420px;
      height: 100%;
      overflow: hidden;
    }

    /* Left Sidebar */
    .sidebar {
      background: rgba(10, 10, 11, 0.95);
      backdrop-filter: blur(14px);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-search {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    .search-input {
      width: 100%;
      background: #070708;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 11px;
      color: var(--text-0);
      font-family: var(--mono);
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .search-input:focus {
      border-color: rgba(212, 175, 55, 0.55);
      box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.12);
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .group-header {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-2);
      padding: 12px 8px 5px;
      display: flex;
      justify-content: space-between;
    }
    .nav-item {
      width: 100%;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 9px;
      padding: 9px 11px;
      margin-bottom: 4px;
      color: var(--text-1);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 5px;
      transition: all 0.18s var(--ease-spring);
    }
    .nav-item:hover {
      background: #161618;
      border-color: rgba(255, 255, 255, 0.08);
      transform: translateX(2px);
    }
    .nav-item.active {
      background: #161618;
      border-color: rgba(212, 175, 55, 0.35);
      color: var(--text-0);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }
    .nav-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .nav-item-title {
      font-weight: 600;
      font-size: 12.5px;
      color: var(--text-0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-item-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-2);
      font-family: var(--mono);
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1.5px 6.5px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 600;
      font-family: var(--mono);
      letter-spacing: 0.03em;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .badge-http { background: rgba(212, 175, 55, 0.1); color: #e5c158; border-color: rgba(212, 175, 55, 0.22); }
    .badge-cli { background: var(--purple-soft); color: #e5c158; border-color: rgba(212, 175, 55, 0.22); }
    .badge-ui { background: rgba(243, 229, 171, 0.1); color: #f3e5ab; border-color: rgba(243, 229, 171, 0.22); }
    .badge-ok { background: var(--green-soft); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.28); }
    .badge-warn { background: var(--amber-soft); color: #fcd34d; border-color: rgba(245, 158, 11, 0.28); }
    .badge-danger { background: var(--red-soft); color: #fda4af; border-color: rgba(244, 63, 94, 0.3); }
    .badge-neutral { background: rgba(255, 255, 255, 0.04); color: var(--text-1); border-color: var(--border); }

    /* Center Stage */
    .stage {
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(circle at 50% 0%, rgba(212, 175, 55, 0.04) 0%, transparent 60%),
        #050505;
      overflow: hidden;
      position: relative;
    }
    .stage-header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      background: rgba(10, 10, 11, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      position: relative;
      z-index: 3;
    }
    .stage-kicker {
      font-family: var(--mono);
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #d4af37;
      margin-bottom: 3px;
    }
    .stage-title {
      margin: 0;
      font-family: var(--display);
      font-size: 19px;
      font-weight: 700;
      color: var(--text-0);
      letter-spacing: -0.02em;
    }
    .stage-subtitle {
      margin: 4px 0 0;
      color: var(--text-2);
      font-family: var(--mono);
      font-size: 11.5px;
    }
    .stage-body {
      flex: 1;
      overflow: auto;
      padding: 26px;
      position: relative;
    }

    /* 3-Column Flow Diagram */
    .flow-board {
      position: relative;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(310px, 1.35fr) minmax(240px, 1fr);
      gap: 56px;
      align-items: start;
      max-width: 1240px;
      margin: 0 auto;
      min-height: 420px;
    }
    .flow-svg-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    .flow-edge-anim {
      stroke-dasharray: 6 8;
      animation: edgeFlow 1.2s linear infinite;
    }
    .flow-col {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .col-header {
      font-family: var(--mono);
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-2);
      padding-bottom: 7px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }

    /* Flow Cards */
    .flow-card {
      background: #0d0d0f;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 13px 15px;
      box-shadow: 0 8px 22px -6px rgba(0, 0, 0, 0.45);
      transition:
        transform 0.2s var(--ease-spring),
        border-color 0.2s ease,
        box-shadow 0.2s ease,
        opacity 0.15s ease;
    }
    .flow-card.clickable { cursor: pointer; }
    .flow-card.clickable:hover {
      border-color: rgba(212, 175, 55, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.6), 0 0 14px rgba(212, 175, 55, 0.12);
    }
    .flow-card.primary-card {
      background: #141416;
      border-color: rgba(212, 175, 55, 0.45);
      box-shadow:
        0 14px 36px -6px rgba(0, 0, 0, 0.6),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .flow-card.shared-card {
      border-left: 3px solid #d4af37;
    }
    .flow-card.infra-card {
      border-left: 3px solid #f3e5ab;
    }
    .flow-card.sim-removed {
      border-color: var(--red) !important;
      background: rgba(244, 63, 94, 0.1) !important;
    }
    .flow-card.sim-degraded {
      border-color: var(--amber) !important;
      background: rgba(245, 158, 11, 0.1) !important;
    }

    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-0);
      word-break: break-word;
    }
    .card-loc {
      font-family: var(--mono);
      font-size: 11px;
      color: #e5c158;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }
    .card-loc:hover { text-decoration: underline; color: #f3e5ab; }

    .section-label {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-2);
      margin: 13px 0 6px;
    }
    .chip-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .code-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 9px;
      border-radius: 7px;
      background: #111113;
      border: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 11.5px;
      color: var(--text-1);
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .code-row:hover {
      border-color: rgba(212, 175, 55, 0.35);
      color: var(--text-0);
      background: #161618;
      transform: translateX(2px);
    }
    .code-row.borrowed {
      background: transparent;
      border-style: dashed;
      color: var(--text-2);
    }
    .code-row.freed-highlight {
      border-color: var(--red);
      background: var(--red-soft);
      color: #fda4af;
    }

    .sim-banner {
      margin-bottom: 18px;
      padding: 12px 16px;
      border-radius: 10px;
      background: var(--red-soft);
      border: 1px solid rgba(244, 63, 94, 0.45);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      backdrop-filter: blur(8px);
    }

    /* Right Source Inspector Drawer */
    .inspector {
      background: rgba(10, 10, 11, 0.95);
      backdrop-filter: blur(14px);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .inspector-header {
      padding: 12px 15px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .inspector-file {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inspector-sub {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-2);
    }
    .code-viewer {
      flex: 1;
      overflow: auto;
      padding: 10px 0;
      font-family: var(--mono);
      font-size: 11.5px;
      line-height: 1.55;
      background: var(--bg-canvas);
    }
    .code-line {
      display: grid;
      grid-template-columns: 46px 1fr;
      padding: 0 12px;
      white-space: pre;
    }
    .code-line.highlight {
      background: rgba(212, 175, 55, 0.12);
      border-left: 3px solid #d4af37;
      padding-left: 9px;
    }
    .line-num {
      color: var(--text-2);
      user-select: none;
      text-align: right;
      padding-right: 12px;
    }
    .line-text {
      color: var(--text-1);
    }
    .empty-note {
      color: var(--text-2);
      font-size: 12px;
      padding: 16px;
      text-align: center;
      border: 1px dashed var(--border);
      border-radius: 10px;
      background: rgba(17, 17, 19, 0.45);
    }

    @media (max-width: 720px) {
      .landing-card { padding: 26px 22px 24px; }
      .landing-title { font-size: 24px; }
      .prompt-form { flex-direction: column; }
      .prompt-submit { height: 46px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <!-- Landing Screen: Paste Commit SHA / Repo to Analyze -->
  <section class="landing-screen" id="landing-screen">
    <!-- Ambient Canvas (Whisper-quiet champagne gold AST drift) -->
    <canvas class="ambient-graph-canvas" id="ambient-graph-canvas" aria-hidden="true"></canvas>

    <div class="landing-card" id="landing-card">
      <!-- 2. Brand Badge -->
      <div class="kicker-row">
        <div class="landing-kicker">
          <span class="status-dot-core" aria-hidden="true"></span>
          <span>EMARA · ARCHITECTURE VISUALIZER</span>
        </div>
      </div>

      <h1 class="landing-title">Visualize any commit into features</h1>
      <p class="landing-sub">
        Paste a commit hash or <code>owner/repo@commit</code>. Emara indexes the AST, slices external entrypoints into capabilities, isolates shared subsystems, and maps line-level source evidence.
      </p>

      <!-- 3. Refined Input Bar & "Analyze Commit" CTA -->
      <div class="prompt-form-shell" id="prompt-form-shell">
        <form class="prompt-form" id="analyze-form">
          <div class="prompt-input-container">
            <input
              class="prompt-input"
              id="analyze-input"
              type="text"
              placeholder="Paste commit hash (e.g. 9b40ef983d) or owner/repo@sha…"
              autocomplete="off"
              spellcheck="false"
            />
          </div>

          <button class="prompt-submit" id="analyze-submit" type="submit">
            <span id="analyze-submit-label">Analyze Commit</span>
            <span class="btn-arrow-cue" aria-hidden="true">→</span>
          </button>
        </form>
      </div>

      <div class="prompt-status" id="analyze-status"></div>

      <!-- 4. Clean Divisionals & Repository Cards -->
      <div class="presets-section" id="presets-section">
        <div class="section-divider" aria-hidden="true"></div>

        <div class="presets-header-row">
          <div class="presets-label">Or inspect a local repository at HEAD</div>
        </div>

        <div class="preset-grid" id="preset-grid"></div>
      </div>
    </div>
  </section>

  <!-- Main Visualizer View -->
  <div class="app hidden" id="visualizer-app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" id="brand-home" title="Analyze another commit">
          <span class="status-dot-core" style="width:6px;height:6px"></span>
          <span>EMARA</span>
        </span>
        <span class="repo-title" id="repo-title"></span>
        <span class="commit-pill" id="repo-commit"></span>
      </div>
      <nav class="lens-tabs" aria-label="Architecture views">
        <button class="lens-tab active" data-lens="features">
          Features <span class="lens-count" id="count-features">0</span>
        </button>
        <button class="lens-tab" data-lens="shared">
          Shared &amp; Core <span class="lens-count" id="count-shared">0</span>
        </button>
        <button class="lens-tab" data-lens="orphans">
          Unused / Safe Delete <span class="lens-count" id="count-orphans">0</span>
        </button>
      </nav>
      <div class="topbar-right">
        <button class="switch-btn" id="new-commit-btn" title="Analyze a different commit or repository">
          <span>Analyze Commit…</span>
        </button>
        <button class="sim-toggle" id="sim-toggle" title="Simulate removing the selected feature to see which exclusive files can be deleted">
          <span>Simulate Removal</span>
        </button>
      </div>
    </header>

    <div class="workspace" id="workspace">
      <aside class="sidebar">
        <div class="sidebar-search">
          <input class="search-input" id="search-input" type="search" placeholder="Filter features, routes, or files…" autocomplete="off" />
        </div>
        <div class="sidebar-list" id="sidebar-list"></div>
      </aside>

      <main class="stage">
        <div class="stage-header" id="stage-header"></div>
        <div class="stage-body" id="stage-body"></div>
      </main>

      <aside class="inspector" id="inspector">
        <div class="inspector-header">
          <div style="min-width:0">
            <div class="inspector-file" id="inspector-file">Source Evidence</div>
            <div class="inspector-sub" id="inspector-sub">Click any route, file, or connection</div>
          </div>
        </div>
        <div class="code-viewer" id="code-viewer">
          <div class="empty-note" style="margin:16px">Select any file, entrypoint, or dependency edge to inspect the verified source lines.</div>
        </div>
      </aside>
    </div>
  </div>

  <script id="emara-boot" type="application/json">${serializedBoot}</script>
  <script>
    const boot = JSON.parse(document.getElementById("emara-boot").textContent);
    const presets = boot.presets || [];

    let repositoryName = "";
    let featureMap = null;
    let nodes = {};
    let sources = {};
    let blocksById = new Map();
    let featureBlocks = [];
    let sharedBlocks = [];
    let orphanBlocks = [];

    let activeLens = "features";
    let selectedBlockId = null;
    let searchQuery = "";
    let simulateRemoval = false;
    let ambientBoost = 0;

    const landingScreen = document.getElementById("landing-screen");
    const visualizerApp = document.getElementById("visualizer-app");
    const analyzeForm = document.getElementById("analyze-form");
    const analyzeInput = document.getElementById("analyze-input");
    const analyzeSubmit = document.getElementById("analyze-submit");
    const analyzeSubmitLabel = document.getElementById("analyze-submit-label");
    const analyzeStatus = document.getElementById("analyze-status");

    function esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    /* ========================================================================
       AMBIENT AST NETWORK BACKGROUND ENGINE (60FPS CANVAS - CHAMPAGNE DRIFT)
       ======================================================================== */
    (function initAmbientAstCanvas() {
      const canvas = document.getElementById("ambient-graph-canvas");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let width = (canvas.width = window.innerWidth);
      let height = (canvas.height = window.innerHeight);
      let pointerX = width * 0.5;
      let pointerY = height * 0.5;

      const astLabels = [
        "AST::Program", "route:POST", "fn:slice()", "ImportDecl",
        "Reachability", "SchemaNode", "CallGraph", "0x9b40ef9",
        "ExportSpec", "Entrypoint", "SharedCore", "TreeSitter"
      ];

      const nodeCount = 32;
      const astNodes = Array.from({ length: nodeCount }, (_, idx) => {
        const depth = idx % 3; // 0: background bokeh, 1: midground, 2: foreground AST node
        const hue = idx % 3 === 0
          ? "rgba(212, 175, 55, 0.45)"
          : idx % 2 === 0
            ? "rgba(243, 229, 171, 0.35)"
            : "rgba(229, 193, 88, 0.28)";
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * (0.10 + depth * 0.06),
          vy: (Math.random() - 0.5) * (0.10 + depth * 0.06),
          radius: depth === 0 ? 3.0 : depth === 1 ? 1.8 : 2.4,
          depth,
          hue,
          label: idx < astLabels.length ? astLabels[idx] : null,
          phase: Math.random() * Math.PI * 2,
        };
      });

      const packets = Array.from({ length: 10 }, (_, idx) => ({
        fromIdx: idx % nodeCount,
        toIdx: (idx * 3 + 5) % nodeCount,
        t: Math.random(),
        speed: 0.003 + (idx % 4) * 0.0014,
      }));

      window.addEventListener("resize", () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      });

      window.addEventListener("pointermove", (e) => {
        pointerX = e.clientX;
        pointerY = e.clientY;
      }, { passive: true });

      function drawFrame(now) {
        if (!document.hidden && !landingScreen.classList.contains("hidden")) {
          ctx.clearRect(0, 0, width, height);
          const speedMult = 1 + ambientBoost * 1.5;

          for (let i = 0; i < nodeCount; i++) {
            const n = astNodes[i];
            if (!prefersReducedMotion) {
              n.x += n.vx * speedMult;
              n.y += n.vy * speedMult;
              if (n.x < -40) n.x = width + 40;
              if (n.x > width + 40) n.x = -40;
              if (n.y < -40) n.y = height + 40;
              if (n.y > height + 40) n.y = -40;
            }
          }

          // Draw AST edges between nearby nodes
          const maxDist = 200;
          for (let i = 0; i < nodeCount; i++) {
            const a = astNodes[i];
            for (let j = i + 1; j < nodeCount; j++) {
              const b = astNodes[j];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const distSq = dx * dx + dy * dy;
              if (distSq < maxDist * maxDist) {
                const dist = Math.sqrt(distSq);
                const alpha = (1 - dist / maxDist) * (0.12 + ambientBoost * 0.08);
                ctx.strokeStyle = "rgba(212, 175, 55, " + alpha.toFixed(3) + ")";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
              }
            }
          }

          // Draw subtle animated packets along edges
          for (const pkt of packets) {
            const a = astNodes[pkt.fromIdx];
            const b = astNodes[pkt.toIdx];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist < maxDist * 1.35) {
              if (!prefersReducedMotion) {
                pkt.t += pkt.speed * speedMult;
                if (pkt.t >= 1) {
                  pkt.t = 0;
                  pkt.fromIdx = pkt.toIdx;
                  pkt.toIdx = (pkt.toIdx + 1 + Math.floor(Math.random() * 5)) % nodeCount;
                }
              }
              const px = a.x + dx * pkt.t;
              const py = a.y + dy * pkt.t;
              ctx.fillStyle = "rgba(243, 229, 171, 0.55)";
              ctx.beginPath();
              ctx.arc(px, py, 1.6, 0, Math.PI * 2);
              ctx.fill();
            } else {
              pkt.toIdx = (pkt.fromIdx + 1) % nodeCount;
            }
          }

          // Draw AST nodes & subtle labels
          for (let i = 0; i < nodeCount; i++) {
            const n = astNodes[i];
            const pulse = 0.7 + 0.3 * Math.sin(now * 0.0018 + n.phase);
            const pdx = n.x - pointerX;
            const pdy = n.y - pointerY;
            const pDist = Math.hypot(pdx, pdy);
            const nearBoost = pDist < 200 ? (1 - pDist / 200) * 0.35 : 0;

            ctx.save();
            ctx.globalAlpha = (n.depth === 0 ? 0.2 : n.depth === 1 ? 0.4 : 0.65) * pulse + nearBoost;
            ctx.fillStyle = n.hue;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius + nearBoost * 1.2, 0, Math.PI * 2);
            ctx.fill();

            if (n.depth === 2) {
              ctx.strokeStyle = "rgba(212, 175, 55, 0.18)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
              ctx.stroke();
            }

            if (n.label && n.depth === 2) {
              ctx.font = '500 9px "JetBrains Mono", monospace';
              ctx.fillStyle = "rgba(161, 161, 170, 0.35)";
              ctx.fillText(n.label, n.x + 8, n.y + 3);
            }
            ctx.restore();
          }

          ambientBoost = Math.max(0, ambientBoost * 0.96);
        }
        if (!prefersReducedMotion) {
          requestAnimationFrame(drawFrame);
        }
      }

      requestAnimationFrame(drawFrame);
    })();

    /* ========================================================================
       DYNAMIC INPUT INTERACTIONS & PLACEHOLDER TYPEWRITER
       ======================================================================== */
    (function initPromptInputInteractions() {
      const examples = [
        "Paste commit hash (e.g. 9b40ef983d) or owner/repo@sha…",
        "Try louislam/uptime-kuma@HEAD or a 7–40 char SHA…",
        "Slice capabilities: owner/repo@commit or local preset…"
      ];
      let exIdx = 0;
      let charIdx = 0;
      let deleting = false;
      let timerId = null;

      function tickPlaceholder() {
        if (document.activeElement === analyzeInput || analyzeInput.value.length > 0) {
          timerId = setTimeout(tickPlaceholder, 1200);
          return;
        }
        const current = examples[exIdx];
        if (!deleting) {
          charIdx++;
          analyzeInput.setAttribute("placeholder", current.slice(0, charIdx));
          if (charIdx >= current.length) {
            deleting = true;
            timerId = setTimeout(tickPlaceholder, 2600);
            return;
          }
          timerId = setTimeout(tickPlaceholder, 38);
        } else {
          charIdx--;
          analyzeInput.setAttribute("placeholder", current.slice(0, Math.max(1, charIdx)));
          if (charIdx <= 1) {
            deleting = false;
            exIdx = (exIdx + 1) % examples.length;
            timerId = setTimeout(tickPlaceholder, 240);
            return;
          }
          timerId = setTimeout(tickPlaceholder, 18);
        }
      }
      timerId = setTimeout(tickPlaceholder, 2200);

      analyzeInput.addEventListener("focus", () => {
        ambientBoost = 0.6;
      });
      analyzeInput.addEventListener("input", () => {
        ambientBoost = Math.min(1, ambientBoost + 0.35);
      });
    })();

    /* ========================================================================
       5. REPOSITORY CARDS (OBSIDIAN & GOLD + CURSOR-TRACKING SPOTLIGHT)
       ======================================================================== */
    function renderPresets() {
      const section = document.getElementById("presets-section");
      const grid = document.getElementById("preset-grid");
      if (!presets || presets.length === 0) {
        section.classList.add("hidden");
        return;
      }
      section.classList.remove("hidden");

      grid.innerHTML = presets.map((p) => {
        // Parse owner and repo name from label if formatted as "owner/repo"
        const slashIdx = p.label.indexOf("/");
        const hasSlash = slashIdx !== -1;
        const owner = hasSlash ? p.label.slice(0, slashIdx + 1) : "";
        const repoName = hasSlash ? p.label.slice(slashIdx + 1) : p.label;

        // Parse stars from subtitle if present (e.g. "85k★ · ...")
        const starMatch = (p.subtitle || "").match(/^([0-9.]+k?)[★*]?/u);
        const rawStars = starMatch ? starMatch[1] : null;
        let cleanSub = (p.subtitle || "").trim();
        if (rawStars && cleanSub.startsWith(rawStars)) {
          cleanSub = cleanSub.slice(rawStars.length).trim();
        }
        while (cleanSub.length > 0 && " ·•:;|,★*-".includes(cleanSub[0])) {
          cleanSub = cleanSub.slice(1).trim();
        }
        const starHtml = rawStars
          ? '<span class="preset-star-count">★ ' + esc(rawStars) + '</span>'
          : "";

        return (
          '<button type="button" class="preset-btn" data-preset="' + esc(p.id) + '">' +
            '<div class="preset-top-row">' +
              '<div class="preset-identity">' +
                '<div class="preset-owner">' + esc(owner || "local repository") + '</div>' +
                '<div class="preset-repo-name" title="' + esc(p.label) + '">' + esc(repoName) + '</div>' +
              '</div>' +
              starHtml +
            '</div>' +
            '<div class="preset-desc" title="' + esc(cleanSub) + '">' + esc(cleanSub) + '</div>' +
          '</button>'
        );
      }).join("");

      grid.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.addEventListener("pointermove", (e) => {
          const rect = btn.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          btn.style.setProperty("--mouse-x", x.toFixed(1) + "px");
          btn.style.setProperty("--mouse-y", y.toFixed(1) + "px");
        });
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-preset");
          analyzeInput.value = val;
          ambientBoost = 1;
          runAnalyzeRequest(val);
        });
      });
    }

    async function runAnalyzeRequest(targetValue) {
      const trimmed = (targetValue || "").trim();
      if (!trimmed) {
        analyzeStatus.textContent = "Please enter a commit hash, owner/repo@commit, or preset.";
        analyzeStatus.classList.add("error");
        return;
      }
      analyzeSubmit.disabled = true;
      analyzeSubmit.classList.add("is-loading");
      if (analyzeSubmitLabel) analyzeSubmitLabel.textContent = "Slicing AST…";
      analyzeStatus.classList.remove("error");
      analyzeStatus.textContent = 'Analyzing "' + trimmed + '" — indexing AST, slicing entrypoints & building feature map…';
      ambientBoost = 1;

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: trimmed }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Analysis failed");
        }
        analyzeStatus.textContent = "";
        loadPayloadIntoVisualizer(data.payload);
      } catch (err) {
        analyzeStatus.textContent = err.message || String(err);
        analyzeStatus.classList.add("error");
      } finally {
        analyzeSubmit.disabled = false;
        analyzeSubmit.classList.remove("is-loading");
        if (analyzeSubmitLabel) analyzeSubmitLabel.textContent = "Analyze Commit";
      }
    }

    function showLandingScreen() {
      visualizerApp.classList.add("hidden");
      landingScreen.classList.remove("hidden");
      renderPresets();
      analyzeInput.focus();
      analyzeInput.select();
    }

    function loadPayloadIntoVisualizer(payload) {
      repositoryName = payload.repositoryName;
      featureMap = payload.featureMap;
      nodes = payload.nodes || {};
      sources = payload.sources || {};

      blocksById = new Map(featureMap.blocks.map((b) => [b.id, b]));
      featureBlocks = featureMap.blocks.filter((b) => b.kind === "feature");
      sharedBlocks = featureMap.blocks.filter((b) => b.kind === "shared_subsystem" || b.kind === "infrastructure");
      orphanBlocks = featureMap.blocks.filter((b) => b.kind === "orphan");

      activeLens = "features";
      selectedBlockId = featureBlocks[0]?.id || sharedBlocks[0]?.id || orphanBlocks[0]?.id || null;
      simulateRemoval = false;
      document.getElementById("sim-toggle").classList.remove("active");

      document.getElementById("repo-title").textContent = repositoryName;
      document.getElementById("repo-commit").textContent = featureMap.repositoryCommit.slice(0, 10);
      document.getElementById("count-features").textContent = String(featureBlocks.length);
      document.getElementById("count-shared").textContent = String(sharedBlocks.length);
      document.getElementById("count-orphans").textContent = String(orphanBlocks.length);

      landingScreen.classList.add("hidden");
      visualizerApp.classList.remove("hidden");
      syncLensTabs();
      renderAll();

      const initialBlock = blocksById.get(selectedBlockId);
      if (initialBlock) {
        const ev = initialBlock.studs[0]?.evidence || (initialBlock.filePaths[0] ? { file: initialBlock.filePaths[0], line: 1 } : null);
        if (ev) openSource(ev.file, ev.line, ev.line);
      }
    }

    function classifyFeatureGroup(block) {
      if (block.status === "DOCUMENTED_NOT_IMPLEMENTED") return "Documented / Missing";
      const firstStud = block.studs[0];
      if (firstStud) {
        if (firstStud.kind === "http" || firstStud.kind === "graphql" || firstStud.kind === "websocket") {
          const route = firstStud.route || firstStud.label;
          const seg = route.split("/").filter(Boolean)[0] || "root";
          return "API · /" + seg;
        }
        if (firstStud.kind === "cli") return "CLI & Scripts";
        if (firstStud.kind === "application" || firstStud.kind === "component" || firstStud.kind === "screen") {
          return "Frontend & UI";
        }
      }
      if (block.slug.startsWith("module-web") || block.filePaths.some((p) => p.startsWith("web/") || p.includes("frontend") || p.includes("components/"))) {
        return "Frontend & UI";
      }
      return "Core Modules";
    }

    function statusBadge(block) {
      const s = block.status;
      if (s === "IMPLEMENTED_DOCUMENTED") return '<span class="badge badge-ok">DOCUMENTED</span>';
      if (s === "IMPLEMENTED_UNDOCUMENTED") return '<span class="badge badge-http">IMPLEMENTED</span>';
      if (s === "PARTIALLY_IMPLEMENTED") return '<span class="badge badge-warn">PARTIAL</span>';
      if (s === "DOCUMENTED_NOT_IMPLEMENTED") return '<span class="badge badge-danger">MISSING</span>';
      if (s === "VALIDATED_SAFE_TO_DELETE") return '<span class="badge badge-ok">SAFE DELETE</span>';
      if (s === "VALIDATION_REQUIRED" || s === "CANDIDATE") return '<span class="badge badge-warn">UNUSED CANDIDATE</span>';
      if (s === "UNKNOWN_DYNAMIC_USAGE") return '<span class="badge badge-neutral">DYNAMIC</span>';
      if (s === "SHARED_ACTIVE") return '<span class="badge badge-cli">SHARED</span>';
      if (s === "BASEPLATE_ACTIVE") return '<span class="badge badge-ui">CORE CONFIG</span>';
      return '<span class="badge badge-neutral">' + esc(s) + '</span>';
    }

    function studBadge(stud) {
      if (stud.httpMethod) {
        return '<span class="badge badge-http">' + esc(stud.httpMethod) + '</span>';
      }
      if (stud.kind === "cli") return '<span class="badge badge-cli">CLI</span>';
      if (stud.kind === "schema") return '<span class="badge badge-warn">SCHEMA</span>';
      if (stud.kind === "config") return '<span class="badge badge-ui">CONFIG</span>';
      return '<span class="badge badge-neutral">' + esc(stud.kind.toUpperCase()) + '</span>';
    }

    function openSource(filePath, lineStart, lineEnd) {
      const fileEl = document.getElementById("inspector-file");
      const subEl = document.getElementById("inspector-sub");
      const viewer = document.getElementById("code-viewer");
      if (!filePath) return;

      const sourceEntry = sources[filePath];
      const start = Math.max(1, Number(lineStart) || 1);
      const end = Math.max(start, Number(lineEnd) || start);
      fileEl.textContent = filePath;
      subEl.textContent = sourceEntry
        ? "Line " + start + (end > start ? "–" + end : "") + " · sha256:" + sourceEntry.hash.slice(0, 12)
        : "Line " + start;

      if (!sourceEntry || !Array.isArray(sourceEntry.lines)) {
        viewer.innerHTML = '<div class="empty-note" style="margin:16px">Source text not embedded for ' + esc(filePath) + '</div>';
        return;
      }

      const html = sourceEntry.lines.map((text, idx) => {
        const ln = idx + 1;
        const isHit = ln >= start && ln <= end;
        return '<div class="code-line' + (isHit ? ' highlight' : '') + '" id="src-line-' + ln + '">' +
          '<span class="line-num">' + ln + '</span>' +
          '<span class="line-text">' + (esc(text) || ' ') + '</span>' +
        '</div>';
      }).join("");
      viewer.innerHTML = html;

      const targetLine = document.getElementById("src-line-" + start);
      if (targetLine) {
        targetLine.scrollIntoView({ block: "center" });
      }
    }

    function renderSidebar() {
      if (!featureMap) return;
      const container = document.getElementById("sidebar-list");
      const q = searchQuery.trim().toLowerCase();

      let list = [];
      if (activeLens === "features") list = featureBlocks;
      else if (activeLens === "shared") list = sharedBlocks;
      else list = orphanBlocks;

      const filtered = list.filter((b) => {
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.slug.toLowerCase().includes(q) ||
          b.filePaths.some((p) => p.toLowerCase().includes(q)) ||
          b.studs.some((s) => s.label.toLowerCase().includes(q))
        );
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-note">No matching blocks.</div>';
        return;
      }

      const groups = new Map();
      for (const block of filtered) {
        const g = activeLens === "features"
          ? classifyFeatureGroup(block)
          : activeLens === "shared"
            ? (block.kind === "infrastructure" ? "Core Baseplate" : "Shared Subsystems")
            : String(block.status);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(block);
      }

      let html = "";
      for (const [groupName, items] of groups.entries()) {
        html += '<div class="group-header"><span>' + esc(groupName) + '</span><span>' + items.length + '</span></div>';
        for (const item of items) {
          const isActive = item.id === selectedBlockId;
          const consumerCount = featureMap.connections.filter((c) => c.to === item.id).length;
          const rightMeta = activeLens === "shared"
            ? consumerCount + " consumers"
            : item.size.files + "f · " + item.size.lines + "L";
          html +=
            '<button class="nav-item' + (isActive ? ' active' : '') + '" data-select-block="' + esc(item.id) + '">' +
              '<div class="nav-item-top">' +
                '<span class="nav-item-title">' + esc(item.title) + '</span>' +
              '</div>' +
              '<div class="nav-item-meta">' +
                statusBadge(item) +
                '<span>' + esc(rightMeta) + '</span>' +
              '</div>' +
            '</button>';
        }
      }
      container.innerHTML = html;

      container.querySelectorAll("[data-select-block]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedBlockId = btn.getAttribute("data-select-block");
          renderAll();
          const b = blocksById.get(selectedBlockId);
          if (b) {
            const firstEv = b.studs[0]?.evidence || (b.filePaths[0] ? { file: b.filePaths[0], line: 1 } : null);
            if (firstEv) openSource(firstEv.file, firstEv.line, firstEv.line);
          }
        });
      });
    }

    function renderStage() {
      if (!featureMap) return;
      const headerEl = document.getElementById("stage-header");
      const bodyEl = document.getElementById("stage-body");
      const block = blocksById.get(selectedBlockId);

      if (!block) {
        headerEl.innerHTML = '<div><h1 class="stage-title">Select an item from the left rail</h1></div>';
        bodyEl.innerHTML = "";
        return;
      }

      const outgoing = featureMap.connections.filter((c) => c.from === block.id);
      const incoming = featureMap.connections.filter((c) => c.to === block.id);

      const kindLabel =
        block.kind === "feature" ? "FEATURE ARCHITECTURE FLOW" :
        block.kind === "shared_subsystem" ? "SHARED SUBSYSTEM COUPLING" :
        block.kind === "infrastructure" ? "RUNTIME & CONFIGURATION BASEPLATE" :
        "DETACHED / UNUSED CODE CANDIDATE";

      headerEl.innerHTML =
        '<div>' +
          '<div class="stage-kicker">' + esc(kindLabel) + '</div>' +
          '<h1 class="stage-title">' + esc(block.title) + '</h1>' +
          '<p class="stage-subtitle">' +
            esc(block.filePaths.join(", ") || "No implementation files") +
            ' · ' + block.size.files + ' file(s), ' + block.size.lines + ' lines' +
          '</p>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          statusBadge(block) +
        '</div>';

      if (block.kind === "orphan") {
        renderOrphanStage(block, bodyEl);
        return;
      }

      const exclusiveSymbols = block.exclusiveNodeIds
        .map((id) => nodes[id])
        .filter((n) => n && n.type !== "file" && n.type !== "entrypoint" && n.type !== "endpoint");

      const sharedFileSet = new Set(
        block.sharedNodeIds
          .map((id) => nodes[id]?.file)
          .filter(Boolean)
      );

      let simBannerHtml = "";
      const freedFilesSet = new Set(block.removalImpact?.freedFiles || []);
      const degradedSet = new Set(block.removalImpact?.degradedToSingleConsumerBlockIds || []);
      const orphanedSet = new Set(block.removalImpact?.orphanedBlockIds || []);

      if (simulateRemoval && block.kind === "feature" && block.removalImpact) {
        const impact = block.removalImpact;
        simBannerHtml =
          '<div class="sim-banner">' +
            '<div>' +
              '<strong>Simulated Removal of "' + esc(block.title) + '"</strong><br/>' +
              '<span style="color:var(--text-1);font-size:12px">' +
                (impact.freedFiles.length > 0
                  ? 'Safely deletes <strong>' + impact.freedFiles.length + ' exclusive file(s) (' + impact.freedLines + ' lines)</strong>: ' + esc(impact.freedFiles.join(", "))
                  : '0 files exclusively owned (this capability shares its files with other active capabilities).') +
                (impact.degradedToSingleConsumerBlockIds.length > 0
                  ? ' · Degrades ' + impact.degradedToSingleConsumerBlockIds.length + ' shared module(s) to a single remaining consumer.'
                  : '') +
              '</span>' +
            '</div>' +
          '</div>';
      }

      let leftColTitle = block.kind === "feature"
        ? '<span>1. Entrypoints &amp; Triggers</span><span>' + (block.studs.length + incoming.length) + '</span>'
        : '<span>1. Consuming Features</span><span>' + incoming.length + '</span>';

      let leftCardsHtml = "";
      if (block.kind === "feature") {
        if (block.studs.length === 0 && incoming.length === 0) {
          leftCardsHtml = '<div class="empty-note">Internal module / no direct external route</div>';
        }
        for (const stud of block.studs) {
          leftCardsHtml +=
            '<div class="flow-card clickable" data-anchor-left="' + esc(stud.id) + '" data-open-file="' + esc(stud.evidence.file) + '" data-open-line="' + stud.evidence.line + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(stud.label) + '</span>' +
                studBadge(stud) +
              '</div>' +
              '<div class="card-loc">' + esc(stud.evidence.file) + ':' + stud.evidence.line + '</div>' +
            '</div>';
        }
        for (const conn of incoming) {
          const caller = blocksById.get(conn.from);
          if (!caller) continue;
          const ev = conn.evidence[0];
          leftCardsHtml +=
            '<div class="flow-card clickable" data-anchor-left="' + esc(conn.id) + '" data-pivot-block="' + esc(caller.id) + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(caller.title) + '</span>' +
                '<span class="badge badge-neutral">CALLER</span>' +
              '</div>' +
              '<div class="card-loc">' + esc(conn.label) + (ev ? ' (' + esc(ev.file) + ':' + ev.line + ')' : '') + '</div>' +
            '</div>';
        }
      } else {
        if (incoming.length === 0) {
          leftCardsHtml = '<div class="empty-note">No direct feature connections recorded</div>';
        }
        for (const conn of incoming) {
          const consumer = blocksById.get(conn.from);
          if (!consumer) continue;
          const ev = conn.evidence[0];
          leftCardsHtml +=
            '<div class="flow-card clickable" data-anchor-left="' + esc(conn.id) + '" data-pivot-block="' + esc(consumer.id) + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(consumer.title) + '</span>' +
                statusBadge(consumer) +
              '</div>' +
              '<div class="card-loc" data-open-file="' + esc(ev?.file || "") + '" data-open-line="' + (ev?.line || 1) + '">' +
                esc(conn.label) + (ev ? ' · ' + esc(ev.file) + ':' + ev.line : '') +
              '</div>' +
            '</div>';
        }
      }

      const centerSimClass = simulateRemoval && block.kind === "feature" ? " sim-removed" : "";
      let centerFilesHtml = "";
      for (const filePath of block.filePaths) {
        const isFreed = simulateRemoval && freedFilesSet.has(filePath);
        centerFilesHtml +=
          '<div class="code-row' + (isFreed ? ' freed-highlight' : '') + '" data-open-file="' + esc(filePath) + '" data-open-line="1">' +
            '<span>' + esc(filePath) + '</span>' +
            '<span class="badge ' + (isFreed ? 'badge-danger' : 'badge-neutral') + '">' + (isFreed ? 'DELETE' : 'OWNED') + '</span>' +
          '</div>';
      }
      for (const sharedPath of sharedFileSet) {
        if (block.filePaths.includes(sharedPath)) continue;
        centerFilesHtml +=
          '<div class="code-row borrowed" data-open-file="' + esc(sharedPath) + '" data-open-line="1">' +
            '<span>' + esc(sharedPath) + '</span>' +
            '<span class="badge badge-neutral">SHARED FILE</span>' +
          '</div>';
      }

      let centerSymbolsHtml = "";
      for (const sym of exclusiveSymbols.slice(0, 14)) {
        centerSymbolsHtml +=
          '<div class="code-row" data-open-file="' + esc(sym.file) + '" data-open-line="' + sym.lineStart + '" data-open-end="' + sym.lineEnd + '">' +
            '<span>' + esc(sym.name) + '()</span>' +
            '<span style="color:var(--text-2);font-size:10.5px">' + esc(sym.type) + ' · L' + sym.lineStart + '</span>' +
          '</div>';
      }

      let gapsHtml = "";
      if (block.gaps && block.gaps.length > 0) {
        gapsHtml =
          '<div class="section-label" style="color:var(--amber)">Audit Gaps &amp; Warnings</div>' +
          '<div class="chip-list">' +
            block.gaps.map((g) => '<div class="code-row" style="border-color:rgba(245,158,11,0.4);color:var(--amber);white-space:normal">' + esc(g) + '</div>').join("") +
          '</div>';
      }

      const centerCardHtml =
        '<div class="flow-card primary-card' + centerSimClass + '" id="center-focus-card">' +
          '<div class="card-title-row">' +
            '<span class="card-title" style="font-size:15px">' + esc(block.title) + '</span>' +
            '<span class="badge badge-neutral">' + esc(block.confidence) + '</span>' +
          '</div>' +
          '<div style="color:var(--text-2);font-size:11.5px;font-family:var(--mono);margin-bottom:8px">' +
            esc(block.slug) + ' · ' + block.exclusiveNodeIds.length + ' exclusive nodes, ' + block.sharedNodeIds.length + ' shared' +
          '</div>' +
          '<div class="section-label">Implementation Files (' + block.filePaths.length + ')</div>' +
          '<div class="chip-list">' + (centerFilesHtml || '<div class="empty-note">No implementation files</div>') + '</div>' +
          (centerSymbolsHtml
            ? '<div class="section-label">Owned Symbols &amp; Handlers (' + exclusiveSymbols.length + ')</div><div class="chip-list">' + centerSymbolsHtml + '</div>'
            : '') +
          gapsHtml +
        '</div>';

      let rightColTitle = '<span>3. Shared Modules &amp; Dependencies</span><span>' + outgoing.length + '</span>';
      let rightCardsHtml = "";
      if (outgoing.length === 0) {
        rightCardsHtml = '<div class="empty-note">Self-contained — no outbound shared module dependencies</div>';
      } else {
        for (const conn of outgoing) {
          const target = blocksById.get(conn.to);
          if (!target) continue;
          const totalConsumers = featureMap.connections.filter((c) => c.to === target.id).length;
          const ev = conn.evidence[0];
          const isDegraded = simulateRemoval && degradedSet.has(target.id);
          const isOrphaned = simulateRemoval && orphanedSet.has(target.id);
          const cardKindClass =
            target.kind === "shared_subsystem" ? " shared-card" :
            target.kind === "infrastructure" ? " infra-card" : "";
          const simClass = isOrphaned ? " sim-removed" : isDegraded ? " sim-degraded" : "";

          const exportedStuds = target.studs.slice(0, 4).map((s) => s.label).join(", ");
          rightCardsHtml +=
            '<div class="flow-card clickable' + cardKindClass + simClass + '" data-anchor-right="' + esc(conn.id) + '" data-pivot-block="' + esc(target.id) + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(target.title) + '</span>' +
                '<span class="badge ' + (target.kind === "shared_subsystem" ? 'badge-cli' : target.kind === "infrastructure" ? 'badge-ui' : 'badge-http') + '">' +
                  (isOrphaned ? 'ORPHANED (0 left)' : isDegraded ? 'DROPS TO 1 USER' : 'USED BY ' + totalConsumers) +
                '</span>' +
              '</div>' +
              (exportedStuds
                ? '<div style="font-family:var(--mono);font-size:11px;color:var(--text-1);margin-bottom:5px">Exports: ' + esc(exportedStuds) + '</div>'
                : '') +
              '<div class="card-loc" data-open-file="' + esc(ev?.file || "") + '" data-open-line="' + (ev?.line || 1) + '">' +
                esc(conn.label) + (ev ? ' · ' + esc(ev.file) + ':' + ev.line : '') +
              '</div>' +
            '</div>';
        }
      }

      bodyEl.innerHTML =
        simBannerHtml +
        '<div class="flow-board" id="flow-board">' +
          '<svg class="flow-svg-layer" id="flow-svg"></svg>' +
          '<div class="flow-col">' +
            '<div class="col-header">' + leftColTitle + '</div>' +
            leftCardsHtml +
          '</div>' +
          '<div class="flow-col">' +
            '<div class="col-header"><span>2. ' + (block.kind === "feature" ? "Feature Implementation" : "Shared Module") + '</span><span>' + block.size.lines + ' lines</span></div>' +
            centerCardHtml +
          '</div>' +
          '<div class="flow-col">' +
            '<div class="col-header">' + rightColTitle + '</div>' +
            rightCardsHtml +
          '</div>' +
        '</div>';

      wireStageInteractions(bodyEl);
      requestAnimationFrame(drawConnectors);
    }

    function renderOrphanStage(block, bodyEl) {
      const candidates = block.deadCodeCandidates || [];
      let rowsHtml = "";
      for (const c of candidates) {
        rowsHtml +=
          '<div class="flow-card clickable" data-open-file="' + esc(c.file) + '" data-open-line="' + c.line + '">' +
            '<div class="card-title-row">' +
              '<span class="card-title" style="font-family:var(--mono)">' + esc(c.symbol) + '</span>' +
              '<span class="badge ' + (c.verdict === "VALIDATED_SAFE_TO_DELETE" ? 'badge-ok' : c.verdict === "UNKNOWN_DYNAMIC_USAGE" ? 'badge-neutral' : 'badge-warn') + '">' + esc(c.verdict) + '</span>' +
            '</div>' +
            '<div style="color:var(--text-1);font-size:12px;margin-bottom:6px">' + esc(c.reason) + '</div>' +
            '<div class="card-loc">' + esc(c.file) + ':' + c.line + '</div>' +
          '</div>';
      }
      bodyEl.innerHTML =
        '<div style="max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:12px">' +
          '<div class="col-header"><span>Unreachable / Unused Symbols in ' + esc(block.filePaths[0] || "") + '</span><span>' + candidates.length + ' candidate(s)</span></div>' +
          rowsHtml +
        '</div>';
      wireStageInteractions(bodyEl);
    }

    function wireStageInteractions(container) {
      container.querySelectorAll("[data-open-file]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const file = el.getAttribute("data-open-file");
          const line = Number(el.getAttribute("data-open-line") || "1");
          const end = Number(el.getAttribute("data-open-end") || String(line));
          if (file) openSource(file, line, end);
        });
      });

      container.querySelectorAll("[data-pivot-block]").forEach((el) => {
        el.addEventListener("click", () => {
          const targetId = el.getAttribute("data-pivot-block");
          const target = blocksById.get(targetId);
          if (!target) return;
          selectedBlockId = target.id;
          if (target.kind === "feature") activeLens = "features";
          else if (target.kind === "shared_subsystem" || target.kind === "infrastructure") activeLens = "shared";
          else activeLens = "orphans";
          syncLensTabs();
          renderAll();
          const firstFile = target.filePaths[0];
          if (firstFile) openSource(firstFile, 1, 1);
        });
      });
    }

    function drawConnectors() {
      const board = document.getElementById("flow-board");
      const svg = document.getElementById("flow-svg");
      const centerCard = document.getElementById("center-focus-card");
      if (!board || !svg || !centerCard) return;

      const boardRect = board.getBoundingClientRect();
      const centerRect = centerCard.getBoundingClientRect();
      svg.setAttribute("viewBox", "0 0 " + boardRect.width + " " + boardRect.height);

      const paths = [];
      const cyLeftX = centerRect.left - boardRect.left;
      const cyRightX = centerRect.right - boardRect.left;
      const cyMidY = centerRect.top - boardRect.top + Math.min(72, centerRect.height / 2);

      board.querySelectorAll("[data-anchor-left]").forEach((card) => {
        const r = card.getBoundingClientRect();
        const x1 = r.right - boardRect.left;
        const y1 = r.top - boardRect.top + r.height / 2;
        const x2 = cyLeftX;
        const y2 = cyMidY;
        const dx = (x2 - x1) * 0.5;
        const d = "M " + x1 + " " + y1 + " C " + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + x2 + " " + y2;
        paths.push(
          '<path d="' + d + '" fill="none" stroke="rgba(59,130,246,0.28)" stroke-width="2" />' +
          '<path class="flow-edge-anim" d="' + d + '" fill="none" stroke="rgba(56,189,248,0.72)" stroke-width="1.6" />' +
          '<circle cx="' + x1 + '" cy="' + y1 + '" r="3.5" fill="#38bdf8" />' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.5" fill="#3b82f6" />'
        );
      });

      board.querySelectorAll("[data-anchor-right]").forEach((card) => {
        const r = card.getBoundingClientRect();
        const x1 = cyRightX;
        const y1 = cyMidY;
        const x2 = r.left - boardRect.left;
        const y2 = r.top - boardRect.top + r.height / 2;
        const dx = (x2 - x1) * 0.5;
        const isWarn = card.classList.contains("sim-degraded") || card.classList.contains("sim-removed");
        const baseStroke = isWarn ? "rgba(244,63,94,0.32)" : "rgba(168,85,247,0.28)";
        const animStroke = isWarn ? "rgba(251,113,133,0.8)" : "rgba(192,132,252,0.75)";
        const dot = isWarn ? "#f43f5e" : "#a855f7";
        const d = "M " + x1 + " " + y1 + " C " + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + x2 + " " + y2;
        paths.push(
          '<path d="' + d + '" fill="none" stroke="' + baseStroke + '" stroke-width="2" />' +
          '<path class="flow-edge-anim" d="' + d + '" fill="none" stroke="' + animStroke + '" stroke-width="1.6" />' +
          '<circle cx="' + x1 + '" cy="' + y1 + '" r="3.5" fill="' + dot + '" />' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.5" fill="' + dot + '" />'
        );
      });

      svg.innerHTML = paths.join("");
    }

    function syncLensTabs() {
      document.querySelectorAll(".lens-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-lens") === activeLens);
      });
    }

    function renderAll() {
      renderSidebar();
      renderStage();
    }

    analyzeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runAnalyzeRequest(analyzeInput.value);
    });

    document.getElementById("new-commit-btn").addEventListener("click", showLandingScreen);
    document.getElementById("brand-home").addEventListener("click", showLandingScreen);

    document.querySelectorAll(".lens-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeLens = btn.getAttribute("data-lens");
        syncLensTabs();
        const pool =
          activeLens === "features" ? featureBlocks :
          activeLens === "shared" ? sharedBlocks :
          orphanBlocks;
        if (pool.length > 0 && !pool.some((b) => b.id === selectedBlockId)) {
          selectedBlockId = pool[0].id;
        }
        renderAll();
      });
    });

    document.getElementById("search-input").addEventListener("input", (e) => {
      searchQuery = e.target.value || "";
      renderSidebar();
    });

    document.getElementById("sim-toggle").addEventListener("click", (e) => {
      simulateRemoval = !simulateRemoval;
      e.currentTarget.classList.toggle("active", simulateRemoval);
      renderStage();
    });

    window.addEventListener("resize", () => requestAnimationFrame(drawConnectors));
    document.getElementById("stage-body").addEventListener("scroll", () => requestAnimationFrame(drawConnectors));

    renderPresets();
    if (boot.initialPayload) {
      loadPayloadIntoVisualizer(boot.initialPayload);
    } else {
      showLandingScreen();
    }
  </script>
</body>
</html>
`;
}

renderFeatureMapAppShellHtml.buildPayload = buildViewerPayload;

function buildEmbeddedNodeIndex(
  graph: RepositoryGraph,
): Record<string, EmbeddedNodeMeta> {
  const filesById = new Map(graph.files.map((f) => [f.id, f.path]));
  const result: Record<string, EmbeddedNodeMeta> = {};

  const all: RepositoryNode[] = [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
  for (const node of all) {
    if (node.type === "file") {
      result[node.id] = {
        id: node.id,
        type: "file",
        name: basename(node.path),
        file: node.path,
        lineStart: node.lineRange?.start ?? 1,
        lineEnd: node.lineRange?.end ?? 1,
      };
      continue;
    }
    const filePath = filesById.get(node.fileId) ?? node.fileId.replace(/^file:/u, "");
    result[node.id] = {
      id: node.id,
      type: node.type,
      name: node.name,
      file: filePath,
      lineStart: node.lineRange.start,
      lineEnd: node.lineRange.end,
      ...("exported" in node ? { exported: node.exported } : {}),
    };
  }
  return result;
}

function buildEmbeddedSourceMap(
  graph: RepositoryGraph,
  featureMap: FeatureMap,
  sourceFiles: readonly IndexedSourceFile[],
): Record<string, { hash: string; lines: string[] }> {
  const referencedPaths = new Set<string>();
  for (const block of featureMap.blocks) {
    for (const path of block.filePaths) referencedPaths.add(path);
    for (const stud of block.studs) referencedPaths.add(stud.evidence.file);
    for (const socket of block.sockets) referencedPaths.add(socket.evidence.file);
  }
  for (const conn of featureMap.connections) {
    for (const ev of conn.evidence) referencedPaths.add(ev.file);
  }

  const hashByPath = new Map(graph.files.map((f) => [f.path, f.contentHash]));
  const result: Record<string, { hash: string; lines: string[] }> = {};

  for (const entry of sourceFiles) {
    const path = entry.file.path;
    if (!referencedPaths.has(path)) continue;
    const rawLines = entry.content.replaceAll("\r\n", "\n").split("\n");
    result[path] = {
      hash: hashByPath.get(path) ?? entry.file.contentHash,
      lines: rawLines.slice(0, MAX_EMBEDDED_FILE_LINES),
    };
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
