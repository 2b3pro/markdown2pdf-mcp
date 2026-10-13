#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { getThemeCss, THEME_NAMES } from './themes.js';
import { validateMarkdown } from './validator.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const hljs = require('highlight.js');
const tmp = require('tmp');
const { Remarkable } = require('remarkable');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

tmp.setGracefulCleanup();

export interface MarginSettings {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface ConvertOptions {
  markdown?: string;
  inputPath?: string;
  outputFilename?: string;
  paperFormat?: string;
  paperOrientation?: string;
  paperBorder?: string;
  margin?: MarginSettings;
  watermark?: string;
  watermarkScope?: 'all-pages' | 'first-page';
  showPageNumbers?: boolean;
  theme?: string;
  customCss?: string;
  headerText?: string;
  footerText?: string;
}

export class MarkdownPdfServer {
  private server: Server;
  private transport: StdioServerTransport | null = null;
  private isRunning: boolean = false;
  private signalCleanupHandlers: Array<() => void> = [];

  constructor() {
    this.server = new Server(
      {
        name: 'markdown2pdf',
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Set up error handler
    this.server.onerror = (error: Error): never => {
      const mcpError = new McpError(
        ErrorCode.InternalError,
        `Server error: ${error.message}`,
        {
          details: {
            name: error.name,
            stack: error.stack,
          },
        }
      );
      throw mcpError;
    };
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_pdf_from_markdown',
          description:
            'Convert markdown content to PDF. Supports headers, lists, tables, code blocks with syntax highlighting, blockquotes, images, and Mermaid diagrams. Built-in themes include default, github, academic, report, and minimal. For security, rendering is self-contained: raw HTML is not executed, and images load only from base64 data URIs or relative paths inside M2P_ASSETS_DIR. External URLs are blocked by default.',
          inputSchema: {
            type: 'object',
            properties: {
              markdown: {
                type: 'string',
                description: 'Markdown content to convert to PDF',
              },
              inputPath: {
                type: 'string',
                description:
                  'Path to a local markdown file on disk to convert. Alternative to passing raw markdown string.',
              },
              outputFilename: {
                type: 'string',
                description:
                  'Filename or path for the PDF (default: "output.pdf"). Absolute paths are used as-is; relative paths are placed under M2P_OUTPUT_DIR or HOME.',
              },
              paperFormat: {
                type: 'string',
                description: 'Paper format for the PDF (default: letter)',
                enum: ['letter', 'a4', 'a3', 'a5', 'legal', 'tabloid'],
                default: 'letter',
              },
              paperOrientation: {
                type: 'string',
                description: 'Paper orientation for the PDF (default: portrait)',
                enum: ['portrait', 'landscape'],
                default: 'portrait',
              },
              paperBorder: {
                type: 'string',
                description:
                  'Uniform border margin for the PDF (default: 2cm). Use CSS units (cm, mm, in, px).',
                pattern: '^[0-9]+(\\.[0-9]+)?(cm|mm|in|px)$',
                default: '20mm',
              },
              margin: {
                type: 'object',
                description:
                  'Asymmetric margins for the PDF (top, right, bottom, left). Overrides paperBorder when provided.',
                properties: {
                  top: { type: 'string', description: 'Top margin (e.g. "25mm", "1in")' },
                  right: { type: 'string', description: 'Right margin (e.g. "20mm", "0.75in")' },
                  bottom: { type: 'string', description: 'Bottom margin (e.g. "25mm", "1in")' },
                  left: { type: 'string', description: 'Left margin (e.g. "20mm", "0.75in")' },
                },
              },
              theme: {
                type: 'string',
                description:
                  'Visual styling theme: "default" (modern clean), "github" (GitHub markdown), "academic" (formal paper), "report" (executive report), "minimal" (lightweight minimalist).',
                enum: THEME_NAMES,
                default: 'default',
              },
              customCss: {
                type: 'string',
                description: 'Optional custom CSS to inject into the document for custom styling.',
              },
              watermark: {
                type: 'string',
                description:
                  'Optional watermark text (max 15 characters, uppercase), e.g. "DRAFT", "CONFIDENTIAL".',
                maxLength: 15,
                pattern: '^[A-Z0-9\\s-]+$',
              },
              watermarkScope: {
                type: 'string',
                description:
                  'Control watermark visibility: "all-pages" repeats on every page, "first-page" displays on first page only (default: all-pages).',
                enum: ['all-pages', 'first-page'],
                default: 'all-pages',
              },
              showPageNumbers: {
                type: 'boolean',
                description: 'Include page numbers in the PDF footer (default: false)',
                default: false,
              },
              headerText: {
                type: 'string',
                description: 'Optional custom text to display in the header.',
              },
              footerText: {
                type: 'string',
                description: 'Optional custom text to display in the footer.',
              },
            },
            required: ['markdown'],
          },
        },
        {
          name: 'batch_create_pdf',
          description:
            'Batch convert multiple Markdown documents or files to PDF in a single call using a shared browser session for fast processing.',
          inputSchema: {
            type: 'object',
            properties: {
              documents: {
                type: 'array',
                description: 'List of documents to convert in this batch.',
                items: {
                  type: 'object',
                  properties: {
                    markdown: { type: 'string', description: 'Markdown content' },
                    inputPath: { type: 'string', description: 'Path to markdown file on disk' },
                    outputFilename: { type: 'string', description: 'Destination PDF filename or path' },
                    paperFormat: { type: 'string', enum: ['letter', 'a4', 'a3', 'a5', 'legal', 'tabloid'] },
                    paperOrientation: { type: 'string', enum: ['portrait', 'landscape'] },
                    paperBorder: { type: 'string' },
                    margin: {
                      type: 'object',
                      properties: {
                        top: { type: 'string' },
                        right: { type: 'string' },
                        bottom: { type: 'string' },
                        left: { type: 'string' },
                      },
                    },
                    theme: { type: 'string', enum: THEME_NAMES },
                    customCss: { type: 'string' },
                    watermark: { type: 'string' },
                    watermarkScope: { type: 'string', enum: ['all-pages', 'first-page'] },
                    showPageNumbers: { type: 'boolean' },
                    headerText: { type: 'string' },
                    footerText: { type: 'string' },
                  },
                  required: ['outputFilename'],
                },
              },
              sharedConfig: {
                type: 'object',
                description:
                  'Default configuration applied to all documents in the batch unless overridden.',
                properties: {
                  paperFormat: { type: 'string', enum: ['letter', 'a4', 'a3', 'a5', 'legal', 'tabloid'], default: 'letter' },
                  paperOrientation: { type: 'string', enum: ['portrait', 'landscape'], default: 'portrait' },
                  paperBorder: { type: 'string', default: '20mm' },
                  theme: { type: 'string', enum: THEME_NAMES, default: 'default' },
                  showPageNumbers: { type: 'boolean', default: false },
                  watermark: { type: 'string' },
                  watermarkScope: { type: 'string', enum: ['all-pages', 'first-page'], default: 'all-pages' },
                },
              },
            },
            required: ['documents'],
          },
        },
        {
          name: 'validate_markdown',
          description:
            'Pre-flight validation for markdown content before PDF conversion. Checks size limits, detects unsupported LaTeX math formulas, alerts about stripped HTML tags, validates Mermaid diagram structure, and checks image paths without launching a browser.',
          inputSchema: {
            type: 'object',
            properties: {
              markdown: {
                type: 'string',
                description: 'Markdown content to validate',
              },
              inputPath: {
                type: 'string',
                description: 'Path to markdown file on disk to validate',
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments || {};

      switch (toolName) {
        case 'create_pdf_from_markdown':
          return await this.handleCreatePdf(rawArgs as ConvertOptions);

        case 'batch_create_pdf':
          return await this.handleBatchCreatePdf(rawArgs as {
            documents: ConvertOptions[];
            sharedConfig?: Partial<ConvertOptions>;
          });

        case 'validate_markdown':
          return await this.handleValidateMarkdown(rawArgs as {
            markdown?: string;
            inputPath?: string;
          });

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${toolName}`
          );
      }
    });
  }

  private resolveMarkdownContent(args: { markdown?: string; inputPath?: string }): string {
    if (typeof args.markdown === 'string' && args.markdown.trim().length > 0) {
      return args.markdown;
    }

    if (typeof args.inputPath === 'string' && args.inputPath.trim().length > 0) {
      const fullInputPath = path.resolve(args.inputPath);
      if (!fs.existsSync(fullInputPath)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Input file not found at: ${fullInputPath}`
        );
      }
      return fs.readFileSync(fullInputPath, 'utf8');
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      'Missing required argument: markdown'
    );
  }

  private resolveOutputPath(outputFilename: string = 'output.pdf'): string {
    const baseDir = path.resolve(process.env.M2P_OUTPUT_DIR || os.homedir());
    const outputDir = path.resolve(
      baseDir,
      typeof outputFilename === 'string' ? path.dirname(outputFilename) : '.'
    );

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = outputFilename.toLowerCase().endsWith('.pdf')
      ? outputFilename
      : `${outputFilename}.pdf`;

    return path.join(outputDir, path.basename(filename));
  }

  private getIncrementalPath(basePath: string): string {
    const dir = path.dirname(basePath);
    const ext = path.extname(basePath);
    const name = path.basename(basePath, ext);
    let counter = 1;
    let newPath = basePath;

    while (fs.existsSync(newPath)) {
      newPath = path.join(dir, `${name}-${counter}${ext}`);
      counter++;
    }

    return newPath;
  }

  private buildHtmlContent({
    markdown,
    paperFormat = 'letter',
    paperOrientation = 'portrait',
    paperBorder = '2cm',
    margin,
    watermark = '',
    watermarkScope = 'all-pages',
    theme = 'default',
    customCss = '',
  }: {
    markdown: string;
    paperFormat?: string;
    paperOrientation?: string;
    paperBorder?: string;
    margin?: MarginSettings;
    watermark?: string;
    watermarkScope?: 'all-pages' | 'first-page';
    theme?: string;
    customCss?: string;
  }): string {
    const mdParser = new Remarkable({
      breaks: true,
      preset: 'default',
      html: false,
      highlight: (str: string, language: string) => {
        if (language && language === 'mermaid') {
          return `<div class="mermaid">${str}</div>`;
        }
        if (language && hljs.getLanguage(language)) {
          try {
            return hljs.highlight(str, { language }).value;
          } catch (err) {}
        }
        try {
          return hljs.highlightAuto(str).value;
        } catch (err) {}
        return '';
      },
    });

    const watermarkClassName =
      watermarkScope === 'first-page'
        ? 'watermark watermark--first-page'
        : 'watermark watermark--all-pages';

    const assetsDir = process.env.M2P_ASSETS_DIR
      ? path.resolve(process.env.M2P_ASSETS_DIR)
      : undefined;
    const assetsBaseTag = assetsDir
      ? `<base href="${pathToFileURL(assetsDir + path.sep).href}">`
      : '';

    const headerOffset = '12.5mm';
    const showWatermarkAllPages = Boolean(
      watermark && watermarkScope === 'all-pages'
    );

    const marginTop = margin?.top || paperBorder;
    const marginRight = margin?.right || paperBorder;
    const marginBottom = margin?.bottom || paperBorder;
    const marginLeft = margin?.left || paperBorder;

    const themeStyles = getThemeCss(theme, customCss);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${assetsBaseTag}
  <style>
    @page {
      margin-top: ${showWatermarkAllPages ? `calc(${marginTop} + ${headerOffset})` : marginTop};
      margin-right: ${marginRight};
      margin-bottom: ${marginBottom};
      margin-left: ${marginLeft};
      size: ${paperFormat} ${paperOrientation};
    }
    ${showWatermarkAllPages ? `@page:first { margin-top: ${marginTop}; }` : ''}
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
    }
    .page {
      position: relative;
      width: ${paperFormat === 'letter' ? '8.5in' : '210mm'};
      height: ${paperFormat === 'letter' ? '11in' : '297mm'};
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .content {
      position: relative;
      z-index: 1;
    }
    .watermark {
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: calc(${paperFormat === 'letter' ? '8.5in' : '210mm'} * 0.14);
      color: rgba(0, 0, 0, 0.15);
      font-family: Arial, sans-serif;
      white-space: nowrap;
      pointer-events: none;
      z-index: 0;
      transform: rotate(-45deg);
    }
    .watermark--all-pages { position: fixed; }
    .watermark--first-page { position: absolute; }
    ${themeStyles}
  </style>
</head>
<body>
  <div class="page">
    <div id="mermaid-error" style="display: none; color: red;"></div>
    <div class="content">
      ${mdParser.render(markdown)}
    </div>
    ${watermark ? `<div class="${watermarkClassName}" data-scope="${watermarkScope}">${watermark}</div>` : ''}
  </div>
</body>
</html>`;
  }

  private async createTempHtmlFile(html: string): Promise<string> {
    const tmpFile = await new Promise<{ path: string; fd: number }>((resolve, reject) => {
      tmp.file({ postfix: '.html' }, (err: Error | null, path: string, fd: number) => {
        if (err) reject(err);
        else resolve({ path, fd });
      });
    });
    fs.closeSync(tmpFile.fd);
    await fs.promises.writeFile(tmpFile.path, html, 'utf8');
    return tmpFile.path;
  }

  private async handleCreatePdf(args: ConvertOptions) {
    const markdown = this.resolveMarkdownContent(args);
    const contentSize = markdown.length;
    const lineCount = markdown.split('\n').length;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (contentSize > MAX_SIZE) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Markdown content too large (${Math.round(contentSize / 1024 / 1024)}MB). Maximum supported size is 10MB.`
      );
    }

    const {
      outputFilename = 'output.pdf',
      paperFormat = 'letter',
      paperOrientation = 'portrait',
      paperBorder = '2cm',
      margin,
      watermark = '',
      watermarkScope = 'all-pages',
      showPageNumbers = false,
      theme = 'default',
      customCss = '',
      headerText = '',
      footerText = '',
    } = args;

    const initialOutputPath = this.resolveOutputPath(outputFilename);
    const finalOutputPath = path.resolve(this.getIncrementalPath(initialOutputPath));

    const baseLoadTimeout = 60000;
    const baseRenderDelay = 7000;
    const loadTimeout = Math.min(
      baseLoadTimeout + Math.floor(contentSize / 10000) * 1000,
      300000
    );
    const renderDelay = Math.min(
      baseRenderDelay + Math.floor(lineCount / 100) * 1000,
      30000
    );

    let tmpHtmlPath: string | null = null;
    try {
      const html = this.buildHtmlContent({
        markdown,
        paperFormat,
        paperOrientation,
        paperBorder,
        margin,
        watermark,
        watermarkScope,
        theme,
        customCss,
      });

      tmpHtmlPath = await this.createTempHtmlFile(html);

      const assetsDir = process.env.M2P_ASSETS_DIR
        ? path.resolve(process.env.M2P_ASSETS_DIR)
        : undefined;

      const renderPDF = (await import('./puppeteer/render.js')).default;
      await renderPDF({
        htmlPath: tmpHtmlPath,
        pdfPath: finalOutputPath,
        runningsPath: path.resolve(__dirname, 'runnings.js'),
        cssPath: path.resolve(__dirname, 'css', 'pdf.css'),
        highlightCssPath: '',
        mermaidPath: path.resolve(__dirname, 'puppeteer', 'vendor', 'mermaid.min.js'),
        assetsDir,
        allowAllImages:
          process.argv.includes('--dangerously-allow-images') ||
          process.env.M2P_DANGEROUSLY_ALLOW_ALL_IMAGES === 'true',
        paperFormat,
        paperOrientation,
        paperBorder,
        margin,
        watermarkScope,
        showPageNumbers,
        headerText,
        footerText,
        renderDelay,
        loadTimeout,
      });

      if (!fs.existsSync(finalOutputPath)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `PDF generation failed: Output file was not created at ${finalOutputPath}.`,
            },
          ],
        };
      }

      const updates = [
        `Starting PDF conversion (format: ${paperFormat}, orientation: ${paperOrientation}, theme: ${theme})`,
        `Content size: ${Math.round(contentSize / 1024)}KB (${lineCount} lines)`,
        `PDF file created successfully at: ${finalOutputPath}`,
        `File exists: ${fs.existsSync(finalOutputPath)}`,
      ];

      return {
        content: [
          {
            type: 'text',
            text: updates.join('\n'),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `PDF generation failed: ${message}\nTip: Run 'validate_markdown' to check syntax, Mermaid diagrams, and image paths.`,
          },
        ],
      };
    } finally {
      if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) {
        fs.promises.unlink(tmpHtmlPath).catch(() => {});
      }
    }
  }

  private async handleBatchCreatePdf(args: {
    documents: ConvertOptions[];
    sharedConfig?: Partial<ConvertOptions>;
  }) {
    const { documents, sharedConfig = {} } = args;

    if (!Array.isArray(documents) || documents.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'batch_create_pdf requires a non-empty "documents" array'
      );
    }

    const { renderBatchPDF } = await import('./puppeteer/render.js');
    const tempHtmlFiles: string[] = [];
    const batchRenderItems: any[] = [];

    try {
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const merged: ConvertOptions = {
          ...sharedConfig,
          ...doc,
        };

        const markdown = this.resolveMarkdownContent(merged);
        const outputFilename = merged.outputFilename || `batch-output-${i + 1}.pdf`;
        const initialOutputPath = this.resolveOutputPath(outputFilename);
        const finalOutputPath = path.resolve(this.getIncrementalPath(initialOutputPath));

        const html = this.buildHtmlContent({
          markdown,
          paperFormat: merged.paperFormat || 'letter',
          paperOrientation: merged.paperOrientation || 'portrait',
          paperBorder: merged.paperBorder || '20mm',
          margin: merged.margin,
          watermark: merged.watermark || '',
          watermarkScope: merged.watermarkScope || 'all-pages',
          theme: merged.theme || 'default',
          customCss: merged.customCss || '',
        });

        const tmpHtmlPath = await this.createTempHtmlFile(html);
        tempHtmlFiles.push(tmpHtmlPath);

        const assetsDir = process.env.M2P_ASSETS_DIR
          ? path.resolve(process.env.M2P_ASSETS_DIR)
          : undefined;

        batchRenderItems.push({
          htmlPath: tmpHtmlPath,
          pdfPath: finalOutputPath,
          runningsPath: path.resolve(__dirname, 'runnings.js'),
          cssPath: path.resolve(__dirname, 'css', 'pdf.css'),
          highlightCssPath: '',
          mermaidPath: path.resolve(__dirname, 'puppeteer', 'vendor', 'mermaid.min.js'),
          assetsDir,
          allowAllImages:
            process.argv.includes('--dangerously-allow-images') ||
            process.env.M2P_DANGEROUSLY_ALLOW_ALL_IMAGES === 'true',
          paperFormat: merged.paperFormat || 'letter',
          paperOrientation: merged.paperOrientation || 'portrait',
          paperBorder: merged.paperBorder || '20mm',
          margin: merged.margin,
          watermarkScope: merged.watermarkScope || 'all-pages',
          showPageNumbers: merged.showPageNumbers || false,
          headerText: merged.headerText || '',
          footerText: merged.footerText || '',
          renderDelay: 5000,
          loadTimeout: 60000,
        });
      }

      const batchResult = await renderBatchPDF(batchRenderItems);

      const summaryLines = [
        `### Batch PDF Generation Results`,
        `- **Total Documents:** ${batchResult.total}`,
        `- **Successful:** ${batchResult.successful}`,
        `- **Failed:** ${batchResult.failed}`,
        '',
        '| Status | Output Path | Details |',
        '| --- | --- | --- |',
      ];

      for (const res of batchResult.results) {
        if (res.success) {
          summaryLines.push(`| ✅ Success | \`${res.pdfPath}\` | Generated successfully |`);
        } else {
          summaryLines.push(`| ❌ Failed | \`${res.pdfPath}\` | ${res.error || 'Unknown error'} |`);
        }
      }

      return {
        isError: batchResult.failed > 0 && batchResult.successful === 0,
        content: [
          {
            type: 'text',
            text: summaryLines.join('\n'),
          },
        ],
      };
    } finally {
      for (const tmpFile of tempHtmlFiles) {
        if (fs.existsSync(tmpFile)) {
          fs.promises.unlink(tmpFile).catch(() => {});
        }
      }
    }
  }

  private async handleValidateMarkdown(args: { markdown?: string; inputPath?: string }) {
    let content = '';
    try {
      content = this.resolveMarkdownContent(args);
    } catch (err: unknown) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Validation Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    const assetsDir = process.env.M2P_ASSETS_DIR;
    const result = validateMarkdown(content, assetsDir);

    const reportLines = [
      `### Markdown Validation Report`,
      `- **Status:** ${result.valid ? '✅ Valid' : '❌ Issues Found'}`,
      `- **Characters:** ${result.metrics.charCount}`,
      `- **Lines:** ${result.metrics.lineCount}`,
      `- **Words:** ${result.metrics.wordCount}`,
      `- **Estimated Pages:** ~${result.metrics.estimatedPages}`,
      `- **Mermaid Diagrams:** ${result.metrics.mermaidDiagramCount}`,
      `- **Images Referenced:** ${result.metrics.imageCount}`,
      `- **Estimated Load Timeout:** ${result.metrics.estimatedLoadTimeoutMs / 1000}s`,
    ];

    if (result.errors.length > 0) {
      reportLines.push('', '#### ❌ Errors:');
      for (const err of result.errors) {
        reportLines.push(`- ${err}`);
      }
    }

    if (result.warnings.length > 0) {
      reportLines.push('', '#### ⚠️ Warnings & Suggestions:');
      for (const warn of result.warnings) {
        reportLines.push(`- ${warn}`);
      }
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      reportLines.push('', 'No issues found! The document is ready for PDF conversion.');
    }

    return {
      isError: !result.valid,
      content: [
        {
          type: 'text',
          text: reportLines.join('\n'),
        },
      ],
    };
  }

  public async run(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.transport = new StdioServerTransport();

    try {
      await this.server.connect(this.transport);

      return new Promise<void>((resolve) => {
        const cleanup = async () => {
          this.isRunning = false;
          // Clean up signal handlers
          for (const remove of this.signalCleanupHandlers) {
            remove();
          }
          this.signalCleanupHandlers = [];

          if (this.transport) {
            try {
              await this.server.close();
            } catch (error) {
              console.error('Error during server shutdown:', error);
            }
            this.transport = null;
          }
          resolve();
        };

        const onSigint = () => { cleanup(); };
        const onSigterm = () => { cleanup(); };

        process.once('SIGINT', onSigint);
        process.once('SIGTERM', onSigterm);

        this.signalCleanupHandlers.push(() => process.removeListener('SIGINT', onSigint));
        this.signalCleanupHandlers.push(() => process.removeListener('SIGTERM', onSigterm));
      });
    } catch (error) {
      this.isRunning = false;
      if (this.transport) {
        try {
          await this.server.close();
        } catch (closeError) {
          console.error('Error during error cleanup:', closeError);
        }
        this.transport = null;
      }
      throw error;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = new MarkdownPdfServer();
  server.run().catch((error) => {
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Server initialization failed: ${error.message}`,
        {
          details: {
            name: error.name,
            stack: error.stack,
          },
        }
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Server initialization failed: ${String(error)}`
    );
  });
}
