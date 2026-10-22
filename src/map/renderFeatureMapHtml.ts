import { createHash } from "node:crypto";
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
  url?: string;
}

export interface RenderFeatureMapAppShellOptions {
  presets?: readonly AppShellPreset[];
  initialPayload?: ViewerPayload | null;
  sessionToken?: string;
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
  // Static pages (GitHub Pages demos) have no /api/analyze backend.
  const staticDemo = options.sessionToken === undefined &&
    presets.some((preset) => preset.url !== undefined);
  const initialPayload = options.initialPayload ?? null;
  const pageTitle = initialPayload
    ? `${initialPayload.repositoryName} — Emara Feature Architecture`
    : "Emara — Commit & Codebase Feature Visualizer";

  const serializedBoot = JSON.stringify({
    presets,
    initialPayload,
    sessionToken: options.sessionToken ?? null,
  })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root {
      /* Cadastral Survey Atlas Palette (Mineral-Linen Survey Stock & Surveyor Ink) */
      --bg-vellum: #EEF2F6;
      --bg-rail: #E5EBF2;
      --bg-plate: #FFFFFF;
      --bg-plate-subtle: #F8FAFC;
      --bg-header-cell: #DCE4EE;
      --bg-ledger: #16181D;
      --bg-ledger-elevated: #262932;

      --border-hairline: #CBD5E1;
      --border-strong: #94A3B8;
      --border-row: #E2E8F0;
      --border-ledger: #B45309;

      --ink-0: #16181D;
      --ink-1: #2E323B;
      --ink-2: #4B5262;
      --ledger-ink: #F6F4EE;
      --ledger-muted: #CBD5E1;
      --ledger-gold: #FDE68A;

      /* Survey Parcel Fills & Semantic Inks (WCAG AA >= 4.5:1 verified) */
      --parcel-blue-bg: #EFF6FF;
      --parcel-blue-border: #1D4ED8;
      --parcel-blue-rule: #93C5FD;
      --parcel-blue-ink: #1E3A8A;

      --easement-ochre-bg: #FFFBEB;
      --easement-ochre-border: #B45309;
      --easement-ochre-rule: #FCD34D;
      --easement-ochre-ink: #78350F;

      --review-crimson-bg: #FEF2F2;
      --review-crimson-border: #DC2626;
      --review-crimson-rule: #FCA5A5;
      --review-crimson-ink: #991B1B;

      --verified-green-bg: #ECFDF5;
      --verified-green-border: #047857;
      --verified-green-ink: #065F46;

      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --mono: "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--bg-vellum);
      color: var(--ink-0);
      font-family: var(--sans);
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    ::selection {
      background: #DBEAFE;
      color: var(--ink-0);
    }

    .hidden { display: none !important; }

    /* ==========================================================================
       1. REPOSITORY SURVEY LAUNCHPAD (LANDING SCREEN)
       ========================================================================== */
    .landing-screen {
      min-height: 100vh;
      width: 100vw;
      display: flex;
      flex-direction: column;
      background-color: var(--bg-vellum);
      overflow-x: hidden;
      overflow-y: auto;
    }

    .landing-ledger-bar {
      background: var(--bg-ledger);
      color: var(--ledger-ink);
      border-bottom: 2px solid var(--border-ledger);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .landing-ledger-brand {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ledger-ink);
    }

    .landing-ledger-stamp {
      font-family: var(--mono);
      font-size: 12px;
      background: var(--bg-ledger-elevated);
      color: var(--ledger-gold);
      padding: 4px 10px;
      border: 1px solid #3F4452;
    }

    .landing-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }

    .landing-card {
      width: 100%;
      max-width: 960px;
      background: var(--bg-plate);
      border: 1px solid var(--border-strong);
      padding: 32px 36px;
    }

    .landing-header-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      border-bottom: 2px solid var(--ink-0);
      padding-bottom: 12px;
      margin-bottom: 14px;
    }

    .landing-title {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: var(--ink-0);
    }

    .landing-folio-tag {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--easement-ochre-ink);
      background: var(--easement-ochre-bg);
      border: 1px solid var(--easement-ochre-rule);
      padding: 3px 9px;
    }

    .landing-sub {
      margin: 0 0 22px;
      color: var(--ink-1);
      font-size: 14px;
      line-height: 1.6;
      max-width: 68ch;
    }
    .landing-sub code {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--parcel-blue-ink);
      background: var(--parcel-blue-bg);
      border: 1px solid var(--parcel-blue-rule);
      padding: 1px 6px;
    }

    .prompt-form-shell {
      margin-bottom: 10px;
    }
    .prompt-form-shell.static-mode {
      background: var(--bg-rail);
      border: 1px solid var(--border-strong);
      padding: 12px 14px;
    }
    .prompt-mode-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ink-1);
    }
    .prompt-mode-title {
      font-weight: 700;
      color: var(--ink-0);
    }
    .prompt-mode-cmd {
      background: var(--bg-plate);
      border: 1px solid var(--border-strong);
      color: var(--parcel-blue-ink);
      padding: 2px 8px;
      font-weight: 600;
    }

    .prompt-form {
      display: flex;
      align-items: stretch;
      gap: 12px;
    }

    .prompt-input-container {
      flex: 1;
      display: flex;
      align-items: center;
      background: var(--bg-plate-subtle);
      border: 1px solid var(--border-strong);
    }
    .prompt-input-container:focus-within {
      border-color: var(--parcel-blue-border);
      background: var(--bg-plate);
      outline: 2px solid var(--parcel-blue-rule);
      outline-offset: -1px;
    }

    .prompt-input {
      flex: 1;
      width: 100%;
      background: transparent;
      border: 0;
      padding: 12px 16px;
      color: var(--ink-0);
      caret-color: var(--parcel-blue-border);
      font-family: var(--mono);
      font-size: 13px;
      outline: none;
    }
    .prompt-input::placeholder {
      color: var(--ink-2);
    }
    .prompt-input:disabled {
      background: var(--bg-plate);
      color: var(--ink-1);
      cursor: default;
    }

    .prompt-submit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--ink-0);
      color: var(--ledger-ink);
      border: 1px solid var(--ink-0);
      padding: 0 22px;
      font-family: var(--sans);
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 140ms ease;
    }
    .prompt-submit:hover:not(:disabled) {
      background: var(--parcel-blue-border);
      border-color: var(--parcel-blue-border);
    }
    .prompt-submit:disabled {
      background: var(--bg-header-cell);
      color: var(--ink-1);
      border-color: var(--border-strong);
      cursor: default;
    }

    /* Browser Surface Craft: Archival Scrollbars & Focus Rings */
    .sidebar-list,
    .stage-body,
    .code-viewer {
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) var(--bg-rail);
    }
    .sidebar-list::-webkit-scrollbar,
    .stage-body::-webkit-scrollbar,
    .code-viewer::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    .sidebar-list::-webkit-scrollbar-track,
    .stage-body::-webkit-scrollbar-track,
    .code-viewer::-webkit-scrollbar-track {
      background: var(--bg-rail);
    }
    .sidebar-list::-webkit-scrollbar-thumb,
    .stage-body::-webkit-scrollbar-thumb,
    .code-viewer::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border: 1px solid var(--bg-rail);
    }
    button:focus-visible,
    input:focus-visible,
    .flow-card.clickable:focus-visible,
    .code-row:focus-visible {
      outline: 2px solid var(--parcel-blue-border);
      outline-offset: -2px;
    }

    .prompt-status {
      font-family: var(--mono);
      font-size: 13px;
      color: var(--parcel-blue-ink);
      margin: 8px 0 4px;
      min-height: 20px;
    }
    .prompt-status.error {
      color: var(--review-crimson-ink);
    }

    .presets-section {
      margin-top: 22px;
      border-top: 1px solid var(--border-hairline);
      padding-top: 20px;
    }

    .presets-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .presets-label {
      font-size: 16px;
      font-weight: 700;
      color: var(--ink-0);
      margin: 0;
    }

    .preset-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .preset-btn {
      text-align: left;
      background: var(--bg-plate-subtle);
      border: 1px solid var(--border-strong);
      padding: 16px;
      color: var(--ink-0);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      min-height: 132px;
      transition: background-color 140ms ease, border-color 140ms ease;
    }
    .preset-btn:hover {
      background: var(--parcel-blue-bg);
      border-color: var(--parcel-blue-border);
    }

    .preset-top-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
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
      font-size: 12px;
      color: var(--ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preset-repo-name {
      font-family: var(--mono);
      font-weight: 700;
      font-size: 14px;
      color: var(--ink-0);
      line-height: 1.35;
      word-break: break-word;
    }
    .preset-star-count {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--easement-ochre-ink);
      background: var(--easement-ochre-bg);
      border: 1px solid var(--easement-ochre-rule);
      padding: 2px 6px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .preset-desc {
      font-size: 13px;
      color: var(--ink-1);
      line-height: 1.45;
    }

    /* ==========================================================================
       2. CADASTRAL WORKBENCH SHELL (TOP LEDGER + 3-PANE ATLAS)
       ========================================================================== */
    .app {
      display: grid;
      grid-template-rows: 58px minmax(0, 1fr);
      height: 100vh;
      width: 100vw;
      background: var(--bg-vellum);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      background: var(--bg-ledger);
      color: var(--ledger-ink);
      border-bottom: 2px solid var(--border-ledger);
      gap: 16px;
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
      gap: 8px;
      padding: 5px 11px;
      background: var(--bg-ledger-elevated);
      border: 1px solid #3F4452;
      color: var(--ledger-gold);
      font-family: var(--mono);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .brand-mark:hover {
      border-color: var(--ledger-gold);
      color: #FFFFFF;
    }
    .repo-title {
      font-weight: 700;
      font-size: 16px;
      color: var(--ledger-ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .commit-pill {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ledger-gold);
      background: var(--bg-ledger-elevated);
      border: 1px solid #3F4452;
      padding: 3px 8px;
      font-variant-numeric: tabular-nums;
    }

    .lens-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-ledger-elevated);
      padding: 4px;
      border: 1px solid #3F4452;
    }
    .lens-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--ledger-muted);
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 600;
      padding: 5px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .lens-tab:hover {
      color: #FFFFFF;
    }
    .lens-tab.active {
      background: var(--bg-vellum);
      color: var(--ink-0);
      border-color: var(--border-strong);
    }
    .lens-count {
      font-family: var(--mono);
      font-size: 12px;
      padding: 1px 6px;
      background: rgba(255, 255, 255, 0.12);
      color: inherit;
      font-variant-numeric: tabular-nums;
    }
    .lens-tab.active .lens-count {
      background: var(--bg-header-cell);
      color: var(--ink-0);
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
      border: 1px solid #3F4452;
      background: var(--bg-ledger-elevated);
      color: var(--ledger-ink);
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .switch-btn:hover, .sim-toggle:hover {
      border-color: var(--ledger-gold);
    }
    .sim-toggle.active {
      border-color: #FCA5A5;
      background: var(--review-crimson-border);
      color: #FFFFFF;
    }

    /* 3-Pane Cadastral Workbench */
    .workspace {
      display: grid;
      grid-template-columns: 296px minmax(0, 1fr) 380px;
      height: 100%;
      overflow: hidden;
    }

    /* Left Pane: Capability Parcel Schedule */
    .sidebar {
      background: var(--bg-rail);
      border-right: 1px solid var(--border-hairline);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
    .sidebar-head {
      padding: 14px 16px 12px;
      border-bottom: 1px solid var(--border-hairline);
    }
    .sidebar-title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .sidebar-heading {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--ink-0);
      letter-spacing: -0.01em;
    }
    .sidebar-folio-note {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ink-2);
    }
    .search-input {
      width: 100%;
      background: var(--bg-plate);
      border: 1px solid var(--border-strong);
      padding: 8px 11px;
      color: var(--ink-0);
      caret-color: var(--parcel-blue-border);
      font-family: var(--mono);
      font-size: 12px;
      outline: none;
    }
    .search-input::placeholder {
      color: var(--ink-2);
    }
    .search-input:focus {
      border-color: var(--parcel-blue-border);
      outline: 2px solid var(--parcel-blue-rule);
      outline-offset: -1px;
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px 16px;
    }
    .group-header {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 700;
      color: var(--ink-1);
      padding: 12px 4px 6px;
      border-bottom: 1px solid var(--border-strong);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      font-variant-numeric: tabular-nums;
    }
    .nav-item {
      width: 100%;
      text-align: left;
      background: var(--bg-plate-subtle);
      border: 1px solid var(--border-hairline);
      padding: 10px 12px;
      margin-bottom: 6px;
      color: var(--ink-0);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .nav-item:hover {
      background: var(--bg-plate);
      border-color: var(--border-strong);
    }
    .nav-item.active {
      background: var(--parcel-blue-bg);
      border-color: var(--parcel-blue-border);
      box-shadow: inset 0 0 0 1px var(--parcel-blue-border);
    }
    .nav-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .nav-item-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--ink-0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--ink-2);
      font-family: var(--mono);
      font-variant-numeric: tabular-nums;
    }

    /* Survey Stamps / Badges (all >= 12px and WCAG AA contrast) */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--mono);
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .badge-http {
      background: var(--parcel-blue-bg);
      color: var(--parcel-blue-ink);
      border-color: var(--parcel-blue-rule);
    }
    .badge-cli {
      background: var(--easement-ochre-bg);
      color: var(--easement-ochre-ink);
      border-color: var(--easement-ochre-rule);
    }
    .badge-ui {
      background: var(--bg-header-cell);
      color: var(--ink-0);
      border-color: var(--border-strong);
    }
    .badge-ok {
      background: var(--verified-green-bg);
      color: var(--verified-green-ink);
      border-color: var(--verified-green-border);
    }
    .badge-warn {
      background: var(--easement-ochre-bg);
      color: var(--easement-ochre-ink);
      border-color: var(--easement-ochre-rule);
    }
    .badge-danger {
      background: var(--review-crimson-bg);
      color: var(--review-crimson-ink);
      border-color: var(--review-crimson-rule);
    }
    .badge-neutral {
      background: var(--bg-rail);
      color: var(--ink-1);
      border-color: var(--border-strong);
    }

    /* Center Stage: Cadastral Parcel Flow */
    .stage {
      display: flex;
      flex-direction: column;
      background: var(--bg-vellum);
      overflow: hidden;
      position: relative;
      min-width: 0;
    }
    .stage-header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-strong);
      background: var(--bg-plate);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      z-index: 3;
    }
    .stage-title-group {
      min-width: 0;
      flex: 1;
    }
    .stage-title {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: var(--ink-0);
      letter-spacing: -0.02em;
      line-height: 1.25;
    }
    .stage-subtitle {
      margin: 4px 0 0;
      color: var(--ink-2);
      font-family: var(--mono);
      font-size: 12px;
      overflow-wrap: break-word;
      word-break: normal;
    }
    .stage-legend-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      font-size: 12px;
      color: var(--ink-1);
      flex-wrap: wrap;
    }
    .legend-swatch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .swatch-box {
      width: 12px;
      height: 12px;
      border: 1px solid var(--ink-0);
      display: inline-block;
    }
    .swatch-exclusive {
      background: var(--parcel-blue-bg);
      border-color: var(--parcel-blue-border);
    }
    .swatch-shared {
      background: var(--easement-ochre-bg);
      border-color: var(--easement-ochre-border);
    }

    .stage-body {
      flex: 1;
      overflow: auto;
      padding: 20px 24px 28px;
      position: relative;
      background-color: var(--bg-vellum);
    }

    /* 3-Column Cadastral Survey Board */
    .flow-board {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.22fr) minmax(0, 1fr);
      gap: 28px;
      align-items: start;
      width: 100%;
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
    .flow-col {
      position: relative;
      z-index: 2;
      background: var(--bg-plate);
      border: 1px solid var(--border-strong);
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .col-header {
      background: var(--bg-header-cell);
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 700;
      color: var(--ink-0);
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-strong);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .col-count {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ink-1);
      font-variant-numeric: tabular-nums;
    }

    /* Cadastral Parcel Lots (Rows inside each column sheet) */
    .flow-card {
      background: var(--bg-plate);
      border-bottom: 1px solid var(--border-row);
      padding: 12px 14px;
      transition: opacity 150ms ease, background-color 150ms ease;
      min-width: 0;
    }
    .flow-card:last-child {
      border-bottom: 0;
    }
    .flow-card.clickable {
      cursor: pointer;
    }
    .flow-card.clickable:hover {
      background: var(--bg-plate-subtle);
    }
    .flow-card.primary-card {
      background: var(--bg-plate);
      padding: 0;
    }
    .flow-card.shared-card {
      background: var(--easement-ochre-bg);
    }
    .flow-card.shared-card:hover {
      background: #FEF3C7;
    }
    .flow-card.infra-card {
      background: var(--bg-plate-subtle);
    }
    .flow-card.sim-removed {
      background: var(--review-crimson-bg) !important;
      outline: 2px solid var(--review-crimson-border);
      outline-offset: -2px;
    }
    .flow-card.sim-degraded {
      background: var(--easement-ochre-bg) !important;
      outline: 2px solid var(--easement-ochre-border);
      outline-offset: -2px;
    }
    .flow-board.is-tracing .flow-card.dimmed {
      opacity: 0.42;
    }

    .parcel-summary-head {
      padding: 12px 14px;
      background: var(--parcel-blue-bg);
      border-bottom: 1px solid var(--parcel-blue-rule);
    }

    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 6px 8px;
      margin-bottom: 4px;
    }
    .card-title {
      font-weight: 700;
      font-size: 13px;
      line-height: 1.35;
      color: var(--ink-0);
      overflow-wrap: break-word;
      word-break: normal;
      min-width: 140px;
      flex: 1 1 140px;
    }
    .card-loc {
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.45;
      color: var(--parcel-blue-ink);
      overflow-wrap: break-word;
      word-break: normal;
      cursor: pointer;
    }
    .card-loc:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .section-label {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 700;
      color: var(--ink-1);
      background: var(--bg-rail);
      padding: 7px 14px;
      border-top: 1px solid var(--border-row);
      border-bottom: 1px solid var(--border-row);
    }
    .chip-list {
      display: flex;
      flex-direction: column;
    }
    .code-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 14px;
      background: var(--bg-plate);
      border-bottom: 1px solid var(--border-row);
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ink-0);
      cursor: pointer;
      min-width: 0;
    }
    .code-row:last-child {
      border-bottom: 0;
    }
    .code-row:hover {
      background: var(--parcel-blue-bg);
    }
    .code-row.owned-deed {
      background: #F5F9FF;
    }
    .code-row.owned-deed:hover {
      background: var(--parcel-blue-bg);
    }
    .code-row-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }
    .code-row.borrowed {
      background: var(--easement-ochre-bg);
      color: var(--easement-ochre-ink);
    }
    .code-row.freed-highlight {
      background: var(--review-crimson-bg);
      color: var(--review-crimson-ink);
      font-weight: 600;
    }

    .sim-banner {
      margin-bottom: 16px;
      padding: 12px 16px;
      background: var(--review-crimson-bg);
      border: 1px solid var(--review-crimson-border);
      color: var(--review-crimson-ink);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Right Pane: Deed & Source Inspector */
    .inspector {
      background: var(--bg-plate);
      border-left: 1px solid var(--border-hairline);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
    .inspector-header {
      padding: 14px 18px;
      background: var(--bg-rail);
      border-bottom: 1px solid var(--border-hairline);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .inspector-file {
      font-family: var(--mono);
      font-size: 14px;
      font-weight: 700;
      color: var(--ink-0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inspector-sub {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--ink-2);
      margin-top: 2px;
    }
    .code-viewer {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px 0;
      font-family: var(--mono);
      font-size: 12.5px;
      line-height: 1.6;
      background: var(--bg-plate);
    }
    .code-line {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      padding: 1px 14px;
    }
    .code-line.highlight {
      background: #DBEAFE;
      font-weight: 600;
    }
    .line-num {
      color: var(--ink-2);
      user-select: none;
      text-align: right;
      padding-right: 12px;
      font-variant-numeric: tabular-nums;
    }
    .line-text {
      color: var(--ink-0);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .empty-note {
      color: var(--ink-2);
      font-size: 13px;
      padding: 16px;
      text-align: center;
      background: var(--bg-plate-subtle);
    }

    /* Responsive Adaptation (Tablet & 390px Mobile) */
    @media (max-width: 1120px) {
      html, body {
        height: auto;
        min-height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .app {
        height: auto;
        min-height: 100vh;
        grid-template-rows: auto 1fr;
      }
      .topbar {
        flex-wrap: wrap;
        padding: 12px 16px;
        gap: 10px;
      }
      .workspace {
        grid-template-columns: 1fr;
        height: auto;
        overflow: visible;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--border-strong);
        max-height: 320px;
      }
      .stage-header {
        flex-direction: column;
        padding: 14px 16px;
      }
      .stage-body {
        padding: 16px;
        overflow: visible;
      }
      .flow-board {
        grid-template-columns: 1fr;
        gap: 16px;
        min-height: 0;
      }
      .flow-svg-layer {
        display: none;
      }
      .inspector {
        border-left: 0;
        border-top: 1px solid var(--border-strong);
        max-height: 420px;
      }
    }

    @media (max-width: 760px) {
      .preset-grid {
        grid-template-columns: 1fr;
      }
      .landing-card {
        padding: 22px 18px;
      }
      .landing-title {
        font-size: 22px;
      }
      .prompt-form {
        flex-direction: column;
      }
      .prompt-submit {
        height: 44px;
      }
      .lens-tabs {
        width: 100%;
        overflow-x: auto;
      }
      .topbar-right {
        width: 100%;
        justify-content: flex-start;
      }
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
    <header class="landing-ledger-bar">
      <div class="landing-ledger-brand">Emara · Cadastral Codebase Atlas</div>
      <div class="landing-ledger-stamp">LOCAL DETERMINISTIC AST AUDITOR · SHA-256 VERIFIED</div>
    </header>

    <div class="landing-main">
      <div class="landing-card" id="landing-card">
        <div class="landing-header-row">
          <h1 class="landing-title">${staticDemo ? "Static snapshot demo" : "Survey any commit into functional parcels"}</h1>
          <span class="landing-folio-tag">FOLIO SERIES · JS/TS &amp; PYTHON</span>
        </div>

        <p class="landing-sub">
          ${staticDemo
            ? "Choose a pinned repository snapshot below. Nothing is uploaded or analyzed from this page; run Emara locally to analyze your own code. Static findings require human review."
            : "Paste a commit hash or <code>owner/repo@commit</code>. Emara indexes the AST, maps external entrypoints to exclusive capability parcels, isolates shared easements, and links SHA-256-verified source deeds."}
        </p>

        <div class="prompt-form-shell${staticDemo ? " static-mode" : ""}" id="prompt-form-shell">
          ${staticDemo
            ? '<div class="prompt-mode-header">' +
                '<span class="prompt-mode-title">LOCAL CLI / SERVER MODE · LIVE COMMIT SURVEY</span>' +
                '<span class="prompt-mode-cmd">npm run serve</span>' +
              '</div>'
            : ""}
          <form class="prompt-form" id="analyze-form">
            <div class="prompt-input-container">
              <input
                class="prompt-input"
                id="analyze-input"
                ${staticDemo ? "disabled" : ""}
                type="text"
                placeholder="${staticDemo ? "Run 'npm run serve' locally to paste any commit hash or owner/repo@sha…" : "Paste commit hash (e.g. 9b40ef983d) or owner/repo@sha…"}"
                autocomplete="off"
                spellcheck="false"
              />
            </div>

            <button class="prompt-submit" id="analyze-submit" type="submit" ${staticDemo ? "disabled" : ""}>
              <span id="analyze-submit-label">${staticDemo ? "Local Mode Only" : "Analyze Commit"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <div class="prompt-status" id="analyze-status"></div>

        <div class="presets-section" id="presets-section">
          <div class="presets-header-row">
            <h2 class="presets-label">${staticDemo ? "Choose a pinned repository snapshot" : "Surveyed Repository Folios at HEAD"}</h2>
          </div>

          <div class="preset-grid" id="preset-grid"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- Main Visualizer View -->
  <div class="app hidden" id="visualizer-app">
    <header class="topbar">
      <div class="brand">
        <button type="button" class="brand-mark" id="brand-home" title="Return to repository survey index">
          <span>EMARA ATLAS</span>
        </button>
        <span class="repo-title" id="repo-title"></span>
        <span class="commit-pill" id="repo-commit"></span>
      </div>
      <nav class="lens-tabs" aria-label="Architecture survey views">
        <button type="button" class="lens-tab active" data-lens="features">
          Capability Parcels <span class="lens-count" id="count-features">0</span>
        </button>
        <button type="button" class="lens-tab" data-lens="shared">
          Shared Easements <span class="lens-count" id="count-shared">0</span>
        </button>
        <button type="button" class="lens-tab" data-lens="orphans">
          Deletion review <span class="lens-count" id="count-orphans">0</span>
        </button>
      </nav>
      <div class="topbar-right">
        <button type="button" class="switch-btn" id="new-commit-btn" title="Analyze a different commit or repository">
          <span>${staticDemo ? "Switch Snapshot…" : "Analyze Commit…"}</span>
        </button>
        <button type="button" class="sim-toggle" id="sim-toggle" title="Preview static removal impact; this does not prove that any file is safe to delete">
          <span>Simulate Removal</span>
        </button>
      </div>
    </header>

    <div class="workspace" id="workspace">
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="sidebar-title-row">
            <h2 class="sidebar-heading">Parcel Schedule</h2>
            <span class="sidebar-folio-note">INDEX</span>
          </div>
          <input class="search-input" id="search-input" type="search" placeholder="Filter parcels, routes, or files…" autocomplete="off" />
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
            <div class="inspector-file" id="inspector-file">Verified Source Deed</div>
            <div class="inspector-sub" id="inspector-sub">Select any entrypoint, parcel file, or shared easement</div>
          </div>
        </div>
        <div class="code-viewer" id="code-viewer">
          <div class="empty-note" style="margin:16px">Select any file, entrypoint, or dependency connection to inspect SHA-256 verified source lines.</div>
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
    let hoveredAnchorId = null;

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

    function escBreakable(str) {
      return esc(str)
        .replaceAll("/", "/<wbr>")
        .replaceAll(".", ".<wbr>")
        .replaceAll("-", "-<wbr>");
    }

    function renderPresets() {
      const section = document.getElementById("presets-section");
      const grid = document.getElementById("preset-grid");
      if (!presets || presets.length === 0) {
        section.classList.add("hidden");
        return;
      }
      section.classList.remove("hidden");

      grid.innerHTML = presets.map((p) => {
        const slashIdx = p.label.indexOf("/");
        const hasSlash = slashIdx !== -1;
        const owner = hasSlash ? p.label.slice(0, slashIdx + 1) : "";
        const repoName = hasSlash ? p.label.slice(slashIdx + 1) : p.label;

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
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-preset");
          const presetObj = presets.find((p) => p.id === val);
          if (presetObj && presetObj.url) {
            window.location.href = presetObj.url;
            return;
          }
          analyzeInput.value = val;
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
      if (analyzeSubmitLabel) analyzeSubmitLabel.textContent = "Surveying AST…";
      analyzeStatus.classList.remove("error");
      analyzeStatus.textContent = 'Surveying "' + trimmed + '" — indexing AST, mapping capability parcels & shared easements…';

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Emara-Token": boot.sessionToken || "" },
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
        if (analyzeSubmitLabel) analyzeSubmitLabel.textContent = "Analyze Commit";
      }
    }

    function showLandingScreen() {
      visualizerApp.classList.add("hidden");
      landingScreen.classList.remove("hidden");
      renderPresets();
      if (!analyzeInput.disabled) {
        analyzeInput.focus();
        analyzeInput.select();
      }
    }

    function summarizeConnectionLabel(label) {
      const raw = String(label || "").trim();
      if (!raw) return "";
      const parts = raw.split(";").map((s) => s.trim()).filter(Boolean);
      if (parts.length <= 1) return raw;
      return parts[0] + " (+" + (parts.length - 1) + " refs)";
    }

    function groupSortRank(groupName) {
      if (groupName.startsWith("API ·")) return 1;
      if (groupName === "Core Modules") return 2;
      if (groupName === "Frontend & UI") return 3;
      if (groupName === "CLI & Scripts") return 4;
      if (groupName === "Documented / Missing") return 5;
      return 3;
    }

    function deduplicateConnections(conns, keyProp) {
      const byTarget = new Map();
      for (const c of conns) {
        const k = c[keyProp];
        if (!byTarget.has(k)) {
          byTarget.set(k, { ...c, allLabels: [c.label] });
        } else {
          byTarget.get(k).allLabels.push(c.label);
        }
      }
      return Array.from(byTarget.values()).map((entry) => ({
        ...entry,
        label: entry.allLabels.join("; "),
      }));
    }

    function pickDefaultFeatureBlock(blocks, connections) {
      if (!blocks || blocks.length === 0) return null;
      let best = blocks[0];
      let bestScore = -1000;
      for (const b of blocks) {
        const outCount = new Set(connections.filter((c) => c.from === b.id).map((c) => c.to)).size;
        const inCount = new Set(connections.filter((c) => c.to === b.id).map((c) => c.from)).size;
        const fileCount = b.filePaths.length;
        const group = classifyFeatureGroup(b);
        const isApiOrCore = group.startsWith("API ·") || group === "Core Modules";
        const isRightSized = fileCount >= 1 && fileCount <= 10 && (b.studs.length + inCount) >= 1 && (b.studs.length + inCount) <= 8;
        const hasOut = outCount >= 1 && outCount <= 6;
        const hasRichSource = b.size.lines >= 30 && b.size.lines <= 2500;
        const freedCount = b.removalImpact?.freedFiles?.length || 0;
        const score =
          (isApiOrCore ? 50 : 0) +
          (isRightSized ? 45 : -30) +
          (hasOut ? 40 : 0) +
          (hasRichSource ? 30 : 0) +
          (freedCount >= 1 && freedCount <= 6 ? 65 : 0) +
          Math.min(outCount, 5) * 6 +
          Math.min(b.studs.length, 4) * 5;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      return best;
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
      const defaultFeature = pickDefaultFeatureBlock(featureBlocks, featureMap.connections || []);
      selectedBlockId = defaultFeature?.id || sharedBlocks[0]?.id || orphanBlocks[0]?.id || null;
      simulateRemoval = false;
      document.getElementById("sim-toggle").classList.remove("active");

      document.getElementById("repo-title").textContent = repositoryName;
      document.getElementById("repo-commit").textContent = "FOLIO " + featureMap.repositoryCommit.slice(0, 10);
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
      if (s === "IMPLEMENTED_UNDOCUMENTED") return '<span class="badge badge-http">EXCLUSIVE PARCEL</span>';
      if (s === "PARTIALLY_IMPLEMENTED") return '<span class="badge badge-warn">PARTIAL</span>';
      if (s === "DOCUMENTED_NOT_IMPLEMENTED") return '<span class="badge badge-danger">MISSING</span>';
      if (s === "VALIDATED_SAFE_TO_DELETE") return '<span class="badge badge-ok">VERIFIED UNUSED</span>';
      if (s === "VALIDATION_REQUIRED" || s === "CANDIDATE") return '<span class="badge badge-warn">REVIEW CANDIDATE</span>';
      if (s === "UNKNOWN_DYNAMIC_USAGE") return '<span class="badge badge-neutral">DYNAMIC</span>';
      if (s === "SHARED_ACTIVE") return '<span class="badge badge-cli">EASEMENT</span>';
      if (s === "BASEPLATE_ACTIVE") return '<span class="badge badge-ui">BASEPLATE</span>';
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
        ? "Line " + start + (end > start ? "–" + end : "") + " · Deed sha256:" + sourceEntry.hash.slice(0, 12)
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
        container.innerHTML = '<div class="empty-note">No matching parcels found.</div>';
        return;
      }

      const groups = new Map();
      for (const block of filtered) {
        const g = activeLens === "features"
          ? classifyFeatureGroup(block)
          : activeLens === "shared"
            ? (block.kind === "infrastructure" ? "Core Baseplate" : "Shared Easements")
            : String(block.status);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(block);
      }

      const sortedEntries = Array.from(groups.entries()).sort((a, b) => {
        const rankDiff = groupSortRank(a[0]) - groupSortRank(b[0]);
        if (rankDiff !== 0) return rankDiff;
        return a[0].localeCompare(b[0]);
      });

      let html = "";
      for (const [groupName, items] of sortedEntries) {
        html += '<div class="group-header"><span>' + esc(groupName) + '</span><span>' + items.length + '</span></div>';
        for (const item of items) {
          const isActive = item.id === selectedBlockId;
          const consumerCount = new Set(featureMap.connections.filter((c) => c.to === item.id).map((c) => c.from)).size;
          const rightMeta = activeLens === "shared"
            ? consumerCount + " parcels"
            : item.size.files + "f · " + item.size.lines + "L";
          html +=
            '<button type="button" class="nav-item' + (isActive ? ' active' : '') + '" data-select-block="' + esc(item.id) + '">' +
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

      const activeBtn = container.querySelector(".nav-item.active");
      if (activeBtn) {
        activeBtn.scrollIntoView({ block: "nearest" });
      }

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
        headerEl.innerHTML = '<div class="stage-title-group"><h1 class="stage-title">Select a parcel from the schedule</h1></div>';
        bodyEl.innerHTML = "";
        return;
      }

      const outgoing = deduplicateConnections(featureMap.connections.filter((c) => c.from === block.id), "to");
      const incoming = deduplicateConnections(featureMap.connections.filter((c) => c.to === block.id), "from");
      const previewPaths = block.filePaths.slice(0, 3).join(", ") + (block.filePaths.length > 3 ? " (+" + (block.filePaths.length - 3) + " more)" : "");

      headerEl.innerHTML =
        '<div class="stage-title-group">' +
          '<h1 class="stage-title">' + esc(block.title) + '</h1>' +
          '<p class="stage-subtitle">' +
            escBreakable(previewPaths || "No implementation files") +
            ' · ' + block.size.files + ' file(s), ' + block.size.lines + ' lines' +
          '</p>' +
          '<div class="stage-legend-bar">' +
            '<span class="legend-swatch"><span class="swatch-box swatch-exclusive"></span>Surveyor Blue: Exclusive Parcel</span>' +
            '<span class="legend-swatch"><span class="swatch-box swatch-shared"></span>Surveyor Ochre: Shared Right-of-Way</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
          statusBadge(block) +
        '</div>';

      if (block.kind === "orphan") {
        renderOrphanStage(block, bodyEl);
        return;
      }

      const seenSymbolKeys = new Set();
      const exclusiveSymbols = block.exclusiveNodeIds
        .map((id) => nodes[id])
        .filter((n) => {
          if (!n || n.type === "file" || n.type === "entrypoint" || n.type === "endpoint") return false;
          const k = n.name + ":" + n.type;
          if (seenSymbolKeys.has(k)) return false;
          seenSymbolKeys.add(k);
          return true;
        });

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
        const previewFreed = impact.freedFiles.slice(0, 4).join(", ") +
          (impact.freedFiles.length > 4 ? " (+" + (impact.freedFiles.length - 4) + " more)" : "");
        simBannerHtml =
          '<div class="sim-banner">' +
            '<div>' +
              '<strong>Simulated Removal of "' + esc(block.title) + '"</strong><br/>' +
              '<span style="font-size:13px">' +
                (impact.freedFiles.length > 0
                  ? 'Statically exclusive to this capability: <strong>' + impact.freedFiles.length + ' file(s) (' + impact.freedLines + ' lines)</strong>, not validated for deletion: ' + escBreakable(previewFreed)
                  : '0 files exclusively owned (this capability shares its files with other active capabilities).') +
                (impact.degradedToSingleConsumerBlockIds.length > 0
                  ? ' · Degrades ' + impact.degradedToSingleConsumerBlockIds.length + ' shared module(s) to a single remaining consumer.'
                  : '') +
              '</span>' +
            '</div>' +
          '</div>';
      }

      let leftColTitle = block.kind === "feature"
        ? '<span>Access &amp; Entrypoints</span><span class="col-count">' + (block.studs.length + incoming.length) + '</span>'
        : '<span>Consuming Parcels</span><span class="col-count">' + incoming.length + '</span>';

      let leftCardsHtml = "";
      const maxLeftCards = 6;
      let leftShown = 0;
      if (block.kind === "feature") {
        if (block.studs.length === 0 && incoming.length === 0) {
          leftCardsHtml = '<div class="empty-note">Internal module / no direct external route</div>';
        }
        for (const stud of block.studs) {
          if (leftShown >= maxLeftCards) break;
          leftShown++;
          leftCardsHtml +=
            '<div class="flow-card clickable" data-anchor-left="' + esc(stud.id) + '" data-open-file="' + esc(stud.evidence.file) + '" data-open-line="' + stud.evidence.line + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(stud.label) + '</span>' +
                studBadge(stud) +
              '</div>' +
              '<div class="card-loc">' + escBreakable(stud.evidence.file) + ':' + stud.evidence.line + '</div>' +
            '</div>';
        }
        for (const conn of incoming) {
          if (leftShown >= maxLeftCards) break;
          const caller = blocksById.get(conn.from);
          if (!caller) continue;
          leftShown++;
          const ev = conn.evidence[0];
          leftCardsHtml +=
            '<div class="flow-card clickable" data-anchor-left="' + esc(conn.id) + '" data-pivot-block="' + esc(caller.id) + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(caller.title) + '</span>' +
                '<span class="badge badge-neutral">CALLER</span>' +
              '</div>' +
              '<div class="card-loc">' + escBreakable(summarizeConnectionLabel(conn.label)) + (ev ? ' · ' + escBreakable(ev.file) + ':' + ev.line : '') + '</div>' +
            '</div>';
        }
        const totalLeft = block.studs.length + incoming.length;
        if (totalLeft > leftShown) {
          leftCardsHtml += '<div class="code-row" style="color:var(--ink-2)"><span>+' + (totalLeft - leftShown) + ' additional entrypoints / callers</span></div>';
        }
      } else {
        if (incoming.length === 0) {
          leftCardsHtml = '<div class="empty-note">No direct feature connections recorded</div>';
        }
        for (const conn of incoming.slice(0, maxLeftCards)) {
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
                escBreakable(summarizeConnectionLabel(conn.label)) + (ev ? ' · ' + escBreakable(ev.file) + ':' + ev.line : '') +
              '</div>' +
            '</div>';
        }
        if (incoming.length > maxLeftCards) {
          leftCardsHtml += '<div class="code-row" style="color:var(--ink-2)"><span>+' + (incoming.length - maxLeftCards) + ' additional consuming parcels</span></div>';
        }
      }

      const centerSimClass = simulateRemoval && block.kind === "feature" ? " sim-removed" : "";
      let centerFilesHtml = "";
      const maxFilesShown = 8;
      for (const filePath of block.filePaths.slice(0, maxFilesShown)) {
        const isFreed = simulateRemoval && freedFilesSet.has(filePath);
        centerFilesHtml +=
          '<div class="code-row' + (isFreed ? ' freed-highlight' : ' owned-deed') + '" data-open-file="' + esc(filePath) + '" data-open-line="1">' +
            '<span class="code-row-path" title="' + esc(filePath) + '">' + esc(filePath) + '</span>' +
            '<span class="badge ' + (isFreed ? 'badge-danger' : 'badge-http') + '">' + (isFreed ? 'EXCLUSIVE' : 'OWNED') + '</span>' +
          '</div>';
      }
      if (block.filePaths.length > maxFilesShown) {
        centerFilesHtml += '<div class="code-row" style="color:var(--ink-2)"><span>+' + (block.filePaths.length - maxFilesShown) + ' additional implementation files in parcel</span></div>';
      }
      const unownedSharedFiles = Array.from(sharedFileSet).filter((p) => !block.filePaths.includes(p));
      for (const sharedPath of unownedSharedFiles.slice(0, 4)) {
        centerFilesHtml +=
          '<div class="code-row borrowed" data-open-file="' + esc(sharedPath) + '" data-open-line="1">' +
            '<span class="code-row-path" title="' + esc(sharedPath) + '">' + esc(sharedPath) + '</span>' +
            '<span class="badge badge-cli">SHARED DEED</span>' +
          '</div>';
      }

      let centerSymbolsHtml = "";
      for (const sym of exclusiveSymbols.slice(0, 8)) {
        const suffix = (sym.type === "function" || sym.type === "method") ? "()" : "";
        centerSymbolsHtml +=
          '<div class="code-row" data-open-file="' + esc(sym.file) + '" data-open-line="' + sym.lineStart + '" data-open-end="' + sym.lineEnd + '">' +
            '<span class="code-row-path">' + esc(sym.name) + suffix + '</span>' +
            '<span style="color:var(--ink-2);font-size:12px">' + esc(sym.type) + ' · L' + sym.lineStart + '</span>' +
          '</div>';
      }

      let gapsHtml = "";
      if (block.gaps && block.gaps.length > 0) {
        gapsHtml =
          '<div class="section-label">Survey Notes &amp; Gaps</div>' +
          '<div class="chip-list">' +
            block.gaps.slice(0, 3).map((g) => '<div class="code-row borrowed" style="white-space:normal">' + esc(g) + '</div>').join("") +
          '</div>';
      }

      const centerCardHtml =
        '<div class="flow-card primary-card' + centerSimClass + '" id="center-focus-card">' +
          '<div class="parcel-summary-head">' +
            '<div class="card-title-row">' +
              '<span class="card-title" style="font-size:15px">' + esc(block.title) + '</span>' +
              '<span class="badge badge-http">' + esc(block.confidence) + '</span>' +
            '</div>' +
            '<div style="color:var(--ink-1);font-size:12px;font-family:var(--mono)">' +
              escBreakable(block.slug) + ' · ' + block.exclusiveNodeIds.length + ' exclusive nodes, ' + block.sharedNodeIds.length + ' shared' +
            '</div>' +
          '</div>' +
          '<div class="section-label">Deeded Implementation Files (' + block.filePaths.length + ')</div>' +
          '<div class="chip-list">' + (centerFilesHtml || '<div class="empty-note">No implementation files</div>') + '</div>' +
          (centerSymbolsHtml
            ? '<div class="section-label">Owned Symbols &amp; Handlers (' + exclusiveSymbols.length + ')</div><div class="chip-list">' + centerSymbolsHtml + '</div>'
            : '') +
          gapsHtml +
        '</div>';

      let rightColTitle = '<span>Shared Easements</span><span class="col-count">' + outgoing.length + '</span>';
      let rightCardsHtml = "";
      if (outgoing.length === 0) {
        rightCardsHtml = '<div class="empty-note">Self-contained parcel — no outbound shared easements</div>';
      } else {
        for (const conn of outgoing.slice(0, 6)) {
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

          const exportedStuds = target.studs.slice(0, 3).map((s) => s.label).join(", ");
          rightCardsHtml +=
            '<div class="flow-card clickable' + cardKindClass + simClass + '" data-anchor-right="' + esc(conn.id) + '" data-pivot-block="' + esc(target.id) + '">' +
              '<div class="card-title-row">' +
                '<span class="card-title">' + esc(target.title.replaceAll("/", " / ")) + '</span>' +
                '<span class="badge ' + (target.kind === "shared_subsystem" ? 'badge-cli' : target.kind === "infrastructure" ? 'badge-ui' : 'badge-http') + '">' +
                  (isOrphaned ? 'ORPHANED' : isDegraded ? '1 USER LEFT' : 'SHARED · ' + totalConsumers) +
                '</span>' +
              '</div>' +
              (exportedStuds
                ? '<div style="font-family:var(--mono);font-size:12px;color:var(--ink-1);margin-bottom:4px;overflow-wrap:break-word">Exports: ' + escBreakable(exportedStuds) + '</div>'
                : '') +
              '<div class="card-loc" data-open-file="' + esc(ev?.file || "") + '" data-open-line="' + (ev?.line || 1) + '">' +
                escBreakable(summarizeConnectionLabel(conn.label)) + (ev ? ' · ' + escBreakable(ev.file) + ':' + ev.line : '') +
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
            '<div class="col-header"><span>' + (block.kind === "feature" ? "Exclusive Parcels (Owned)" : "Shared Parcel") + '</span><span class="col-count">' + block.size.lines + ' lines</span></div>' +
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
              '<span class="card-title" style="font-family:var(--mono)">' + escBreakable(c.symbol) + '</span>' +
              '<span class="badge ' + (c.verdict === "VALIDATED_SAFE_TO_DELETE" ? 'badge-ok' : c.verdict === "UNKNOWN_DYNAMIC_USAGE" ? 'badge-neutral' : 'badge-warn') + '">' + esc(c.verdict) + '</span>' +
            '</div>' +
            '<div style="color:var(--ink-1);font-size:13px;margin-bottom:6px">' + esc(c.reason) + '</div>' +
            '<div class="card-loc">' + escBreakable(c.file) + ':' + c.line + '</div>' +
          '</div>';
      }
      bodyEl.innerHTML =
        '<div class="flow-col" style="max-width:860px;margin:0 auto">' +
          '<div class="col-header"><span>Unreachable / Unused Symbols in ' + esc(block.filePaths[0] || "") + '</span><span class="col-count">' + candidates.length + ' candidate(s)</span></div>' +
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

      const board = document.getElementById("flow-board");
      if (board) {
        const anchorCards = board.querySelectorAll("[data-anchor-left], [data-anchor-right]");
        anchorCards.forEach((card) => {
          card.addEventListener("pointerenter", () => {
            hoveredAnchorId = card.getAttribute("data-anchor-left") || card.getAttribute("data-anchor-right");
            board.classList.add("is-tracing");
            anchorCards.forEach((other) => {
              other.classList.toggle("dimmed", other !== card);
            });
            drawConnectors();
          });
          card.addEventListener("pointerleave", () => {
            hoveredAnchorId = null;
            board.classList.remove("is-tracing");
            anchorCards.forEach((other) => other.classList.remove("dimmed"));
            drawConnectors();
          });
        });
      }
    }

    function drawConnectors() {
      const board = document.getElementById("flow-board");
      const svg = document.getElementById("flow-svg");
      const centerCard = document.getElementById("center-focus-card");
      if (!board || !svg || !centerCard) return;

      const boardRect = board.getBoundingClientRect();
      if (boardRect.width < 600) {
        svg.innerHTML = "";
        return;
      }
      const centerRect = centerCard.getBoundingClientRect();
      svg.setAttribute("viewBox", "0 0 " + boardRect.width + " " + boardRect.height);

      const paths = [
        '<defs>' +
          '<pattern id="cadastral-graticule" width="24" height="24" patternUnits="userSpaceOnUse">' +
            '<path d="M 24 0 L 0 0 0 24" fill="none" stroke="#94A3B8" stroke-opacity="0.22" stroke-width="1" />' +
          '</pattern>' +
        '</defs>' +
        '<rect x="0" y="0" width="' + boardRect.width + '" height="' + boardRect.height + '" fill="url(#cadastral-graticule)" />'
      ];
      const cyLeftX = centerRect.left - boardRect.left;
      const cyRightX = centerRect.right - boardRect.left;
      const cyMidY = centerRect.top - boardRect.top + Math.min(48, centerRect.height / 2);

      // Orthogonal Cadastral Survey Callout Lines (Left -> Center in Surveyor Blue)
      board.querySelectorAll("[data-anchor-left]").forEach((card, idx) => {
        const anchorId = card.getAttribute("data-anchor-left");
        const isDimmed = hoveredAnchorId && hoveredAnchorId !== anchorId;
        const isFocused = hoveredAnchorId && hoveredAnchorId === anchorId;
        const r = card.getBoundingClientRect();
        const x1 = r.right - boardRect.left;
        const y1 = r.top - boardRect.top + r.height / 2;
        const x2 = cyLeftX;
        const y2 = cyMidY + (idx % 3 - 1) * 6;
        const midX = Math.round(x1 + (x2 - x1) * 0.5);
        const d = "M " + x1 + " " + y1 + " L " + midX + " " + y1 + " L " + midX + " " + y2 + " L " + x2 + " " + y2;
        const opacity = isDimmed ? "0.22" : isFocused ? "1" : "0.78";
        const width = isFocused ? "2.2" : "1.5";
        paths.push(
          '<path d="' + d + '" fill="none" stroke="#1D4ED8" stroke-opacity="' + opacity + '" stroke-width="' + width + '" />' +
          '<circle cx="' + x1 + '" cy="' + y1 + '" r="3.5" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="2" />' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.5" fill="#1D4ED8" />'
        );
      });

      // Orthogonal Cadastral Survey Callout Lines (Center -> Right in Surveyor Ochre / Crimson)
      board.querySelectorAll("[data-anchor-right]").forEach((card, idx) => {
        const anchorId = card.getAttribute("data-anchor-right");
        const isDimmed = hoveredAnchorId && hoveredAnchorId !== anchorId;
        const isFocused = hoveredAnchorId && hoveredAnchorId === anchorId;
        const r = card.getBoundingClientRect();
        const x1 = cyRightX;
        const y1 = cyMidY + (idx % 3 - 1) * 6;
        const x2 = r.left - boardRect.left;
        const y2 = r.top - boardRect.top + r.height / 2;
        const midX = Math.round(x1 + (x2 - x1) * 0.5);
        const isWarn = card.classList.contains("sim-degraded") || card.classList.contains("sim-removed");
        const color = isWarn ? "#DC2626" : "#B45309";
        const opacity = isDimmed ? "0.22" : isFocused ? "1" : "0.82";
        const width = isFocused ? "2.2" : "1.5";
        const d = "M " + x1 + " " + y1 + " L " + midX + " " + y1 + " L " + midX + " " + y2 + " L " + x2 + " " + y2;
        paths.push(
          '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-opacity="' + opacity + '" stroke-width="' + width + '" />' +
          '<circle cx="' + x1 + '" cy="' + y1 + '" r="3.5" fill="' + color + '" />' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.5" fill="#FFFFFF" stroke="' + color + '" stroke-width="2" />'
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
  return withContentSecurityPolicy(html);
}

/**
 * The page embeds untrusted repository source as data. Allow only the exact
 * viewer client script, no third-party hosts, and same-origin API calls.
 */
function withContentSecurityPolicy(html: string): string {
  const clientScript = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  if (clientScript === undefined) throw new Error("Viewer client script missing");
  const hash = createHash("sha256").update(clientScript).digest("base64");
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  return html.replace(
    '<meta charset="utf-8" />',
    `<meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${policy}" />
  <meta name="referrer" content="no-referrer" />`,
  );
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
