import fs from 'fs';
import path from 'path';

export interface ValidationMetrics {
  charCount: number;
  lineCount: number;
  wordCount: number;
  estimatedPages: number;
  estimatedLoadTimeoutMs: number;
  estimatedRenderDelayMs: number;
  mermaidDiagramCount: number;
  imageCount: number;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  metrics: ValidationMetrics;
}

const KNOWN_MERMAID_TYPES = [
  'graph',
  'flowchart',
  'sequencediagram',
  'classdiagram',
  'statediagram',
  'statediagram-v2',
  'erdiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantchart',
  'requirementdiagram',
  'gitgraph',
  'c4context',
  'c4container',
  'c4component',
  'c4dynamic',
  'c4deployment',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'sankey',
  'xychart-beta',
  'packet-beta',
  'block-beta'
];

/**
 * Fast pre-flight validator for markdown content.
 * Runs in pure Node.js with zero browser overhead.
 */
export function validateMarkdown(markdown: string, assetsDir?: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    errors.push('Markdown content is empty.');
    return {
      valid: false,
      warnings,
      errors,
      metrics: {
        charCount: 0,
        lineCount: 0,
        wordCount: 0,
        estimatedPages: 0,
        estimatedLoadTimeoutMs: 0,
        estimatedRenderDelayMs: 0,
        mermaidDiagramCount: 0,
        imageCount: 0
      }
    };
  }

  const charCount = markdown.length;
  const lines = markdown.split('\n');
  const lineCount = lines.length;
  const wordCount = markdown.trim().split(/\s+/).filter(Boolean).length;

  // 1. Size & memory limits check
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (charCount > MAX_SIZE) {
    errors.push(
      `Markdown content exceeds 10MB limit (${(charCount / (1024 * 1024)).toFixed(2)}MB). Document must be split into smaller sections.`
    );
  } else if (charCount > 500 * 1024) {
    warnings.push(
      `Large document detected (${(charCount / 1024).toFixed(0)}KB, ${lineCount} lines). Processing may take extended time.`
    );
  }

  const baseLoadTimeout = 60000;
  const baseRenderDelay = 7000;
  const estimatedLoadTimeoutMs = Math.min(
    baseLoadTimeout + Math.floor(charCount / 10000) * 1000,
    300000
  );
  const estimatedRenderDelayMs = Math.min(
    baseRenderDelay + Math.floor(lineCount / 100) * 1000,
    30000
  );
  const estimatedPages = Math.max(1, Math.ceil(lineCount / 50));

  // 2. LaTeX Math detection
  const hasDisplayMath = /\$\$[\s\S]+?\$\$/.test(markdown);
  const hasInlineMath = /(?:^|[^\$])\$(?!\$)[^\$\n]+?\$(?!\$)/.test(markdown);
  if (hasDisplayMath || hasInlineMath) {
    warnings.push(
      'LaTeX math equations ($...$ or $$...$$) detected. Math expressions are not rendered by the PDF engine and will appear as raw text.'
    );
  }

  // 3. Raw HTML detection
  const htmlTagRegex = /<\/?(script|iframe|object|embed|form|input|button|style|div|span|p|a|h[1-6]|table|img)\b[^>]*>/i;
  if (htmlTagRegex.test(markdown)) {
    warnings.push(
      'Raw HTML tags detected in markdown. For security reasons (GHSA-r476-vv4c-fhqx), raw HTML is escaped and will not render as interactive or styled DOM elements.'
    );
  }

  // 4. Mermaid diagrams validation
  const mermaidCodeBlockRegex = /```mermaid\s*\n([\s\S]*?)```/gi;
  let mermaidMatch: RegExpExecArray | null;
  let mermaidDiagramCount = 0;

  while ((mermaidMatch = mermaidCodeBlockRegex.exec(markdown)) !== null) {
    mermaidDiagramCount++;
    const code = mermaidMatch[1].trim();

    if (!code) {
      warnings.push(`Mermaid diagram #${mermaidDiagramCount} is empty.`);
      continue;
    }

    const firstLine = code.split('\n')[0].trim().toLowerCase();
    const matchesKnownType = KNOWN_MERMAID_TYPES.some((type) =>
      firstLine.startsWith(type)
    );

    if (!matchesKnownType) {
      warnings.push(
        `Mermaid diagram #${mermaidDiagramCount} starts with unrecognized header: "${firstLine}". Expected one of: ${KNOWN_MERMAID_TYPES.slice(0, 8).join(', ')}, etc.`
      );
    }

    // Bracket & quote parity check
    let openBrackets = 0;
    let openBraces = 0;
    let openParens = 0;
    for (const char of code) {
      if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
      else if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '(') openParens++;
      else if (char === ')') openParens--;
    }

    if (openBrackets !== 0 || openBraces !== 0 || openParens !== 0) {
      warnings.push(
        `Mermaid diagram #${mermaidDiagramCount} may have unbalanced delimiters (brackets: ${openBrackets}, braces: ${openBraces}, parens: ${openParens}).`
      );
    }
  }

  // 5. Image links check
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let imageMatch: RegExpExecArray | null;
  let imageCount = 0;

  const resolvedAssetsDir = assetsDir ? path.resolve(assetsDir) : undefined;

  while ((imageMatch = markdownImageRegex.exec(markdown)) !== null) {
    imageCount++;
    const imgUrl = imageMatch[2].trim().split(/\s+/)[0]; // Remove optional title

    if (imgUrl.startsWith('data:image/')) {
      // Allowed data URI
      continue;
    }

    if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
      warnings.push(
        `Image #${imageCount} references external URL "${imgUrl}". Outbound network requests are blocked by default for security (SSRF prevention). Use base64 data URIs or local assets.`
      );
      continue;
    }

    // Local file path
    let localPath = imgUrl;
    if (localPath.startsWith('file://')) {
      localPath = localPath.replace(/^file:\/\//, '');
    }

    if (!resolvedAssetsDir) {
      warnings.push(
        `Image #${imageCount} references local file "${imgUrl}", but M2P_ASSETS_DIR is not configured. Local file loads are blocked by default for security.`
      );
    } else {
      const fullPath = path.isAbsolute(localPath)
        ? path.resolve(localPath)
        : path.resolve(resolvedAssetsDir, localPath);

      const rel = path.relative(resolvedAssetsDir, fullPath);
      const escapes = rel.startsWith('..') || path.isAbsolute(rel);

      if (escapes) {
        errors.push(
          `Image #${imageCount} ("${imgUrl}") escapes allowlisted assets directory "${resolvedAssetsDir}". Access blocked.`
        );
      } else if (!fs.existsSync(fullPath)) {
        warnings.push(
          `Image #${imageCount} ("${imgUrl}") does not exist at "${fullPath}".`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    metrics: {
      charCount,
      lineCount,
      wordCount,
      estimatedPages,
      estimatedLoadTimeoutMs,
      estimatedRenderDelayMs,
      mermaidDiagramCount,
      imageCount
    }
  };
}
