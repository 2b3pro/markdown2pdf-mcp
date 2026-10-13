import puppeteer from 'puppeteer';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const CHROME_VERSION = '131.0.6778.204';

function getPlatformPath() {
  const platform = process.platform;
  const arch = os.arch();
  
  if (platform === 'darwin') {
    return arch === 'arm64' 
      ? `mac_arm-${CHROME_VERSION}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
      : `mac-${CHROME_VERSION}/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  }
  if (platform === 'linux') {
    return `linux-${CHROME_VERSION}/chrome-linux/chrome`;
  }
  if (platform === 'win32') {
    return `win64-${CHROME_VERSION}/chrome-win/chrome.exe`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * True only when a file:// URL points at a real file located inside assetsDir.
 * The path is canonicalized with realpath so `..` traversal and symlinks cannot
 * escape the directory. Fails closed on any error or when assetsDir is unset.
 *
 * Exported for unit testing against real temp directories.
 */
export function isAllowedFileUrl(url, assetsDir) {
  if (!assetsDir) return false;
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  try {
    const filePath = fileURLToPath(url);
    const realFile = fs.realpathSync(filePath);
    const realDir = fs.realpathSync(assetsDir);
    const rel = path.relative(realDir, realFile);
    // Inside the dir: rel is a non-empty relative path that does not climb out.
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/**
 * Security gate for every request the page tries to make.
 *
 * The document is rendered from a file:// origin, so without this gate any
 * file:// subresource would read arbitrary local files into the PDF (LFI) and
 * any http(s) subresource would be an outbound request from the server (SSRF).
 * By default we allow only the top-level navigation to our own temp HTML file
 * and self-contained data: URIs.
 */
export function shouldAllowRequest({ isMainFrameNavigation, url, assetsDir, allowAllImages }) {
  if (isMainFrameNavigation) return true;
  if (typeof url !== 'string') return false;
  if (url.startsWith('data:')) return true;
  if (allowAllImages) {
    return url.startsWith('file:') || url.startsWith('http:') || url.startsWith('https:');
  }
  if (url.startsWith('file:') && isAllowedFileUrl(url, assetsDir)) return true;
  return false;
}

/**
 * Launches a Chromium instance using the pinned Chrome version or fallback.
 */
export async function launchBrowser(verbose = false) {
  try {
    const chromePath = path.join(
      os.homedir(),
      '.cache',
      'puppeteer',
      'chrome',
      getPlatformPath()
    );

    if (!fs.existsSync(chromePath)) {
      if (verbose) {
        console.error(`[markdown2pdf] Chrome not found at: ${chromePath}, using fallback`);
      }
      throw new Error(`Chrome executable not found at: ${chromePath}`);
    }

    return await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      product: 'chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--max-old-space-size=4096'
      ]
    });
  } catch (err) {
    if (verbose) {
      console.error('[markdown2pdf] Falling back to default Chrome installation');
    }
    return await puppeteer.launch({
      headless: true,
      product: 'chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--max-old-space-size=4096'
      ]
    });
  }
}

/**
 * Renders a single PDF page using an existing browser instance.
 * Automatically closes the page upon completion.
 */
async function renderPageInBrowser(browser, {
  htmlPath,
  pdfPath,
  runningsPath,
  cssPath,
  highlightCssPath,
  mermaidPath,
  assetsDir,
  allowAllImages,
  paperFormat,
  paperOrientation,
  paperBorder = '2cm',
  margin,
  watermarkScope,
  showPageNumbers,
  headerText = '',
  footerText = '',
  renderDelay = 7000,
  loadTimeout = 60000
}) {
  const verbose = process.env.M2P_VERBOSE === 'true';
  const page = await browser.newPage();

  try {
    if (allowAllImages) {
      console.error('[markdown2pdf] WARNING: --dangerously-allow-images is enabled. Markdown can load local files and make outbound requests from this process (LFI/SSRF). Use only with fully trusted input.');
    }

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const allowed = shouldAllowRequest({
        isMainFrameNavigation:
          req.isNavigationRequest() && req.frame() === page.mainFrame(),
        url: req.url(),
        assetsDir,
        allowAllImages
      });
      if (allowed) {
        req.continue().catch(() => {});
      } else {
        if (verbose) {
          console.error(`[markdown2pdf] Blocked request to ${req.url()}`);
        }
        req.abort().catch(() => {});
      }
    });

    page.on('error', err => {
      console.error(`[markdown2pdf] Page crashed: ${err.message}`);
    });

    page.on('pageerror', err => {
      if (verbose) {
        console.error(`[markdown2pdf] Page error:`, err);
      }
    });

    await page.setViewport({
      width: 1200,
      height: 1600
    });

    if (verbose) {
      console.error(`[markdown2pdf] Loading HTML from: ${htmlPath}`);
    }

    const htmlFileUrl = pathToFileURL(htmlPath).href;
    await page.goto(htmlFileUrl, {
      waitUntil: 'networkidle0',
      timeout: loadTimeout
    }).catch(err => {
      if (err.message.includes('timeout')) {
        throw new Error(`Failed to load HTML content within ${loadTimeout/1000}s timeout. The content may be too large or complex. Error: ${err.message}`);
      }
      throw new Error(`Failed to load HTML content: ${err.message}`);
    });

    if (verbose) {
      console.error(`[markdown2pdf] HTML loaded successfully`);
    }

    const runningsUrl = pathToFileURL(runningsPath).href;
    const runningsModule = await import(runningsUrl).catch(err => {
      throw new Error(`Failed to import runnings.js: ${err.message}`);
    });

    if (cssPath && fs.existsSync(cssPath)) {
      await page.addStyleTag({ path: cssPath }).catch(err => {
        throw new Error(`Failed to add CSS: ${err.message}`);
      });
    }

    if (highlightCssPath && fs.existsSync(highlightCssPath)) {
      await page.addStyleTag({ path: highlightCssPath }).catch(err => {
        throw new Error(`Failed to add highlight CSS: ${err.message}`);
      });
    }

    if (mermaidPath && fs.existsSync(mermaidPath)) {
      await page.addScriptTag({ path: mermaidPath }).catch(err => {
        throw new Error(`Failed to add Mermaid script: ${err.message}`);
      });
      await page.evaluate(async () => {
        if (typeof window.mermaid === 'undefined') return;
        const nodes = document.querySelectorAll('.mermaid');
        if (nodes.length === 0) return;
        try {
          window.mermaid.initialize({ startOnLoad: false });
          await window.mermaid.run({ nodes });
        } catch (e) {
          const errorDiv = document.getElementById('mermaid-error');
          if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerText = e.message;
          }
        }
      });
    }

    if (renderDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, renderDelay));
    }

    const mermaidError = await page.evaluate(() => {
      const errorDiv = document.getElementById('mermaid-error');
      return errorDiv ? errorDiv.innerText : null;
    });

    if (mermaidError) {
      throw new Error(`Mermaid diagram rendering failed: ${mermaidError}`);
    }

    await page.evaluate(() => {
      document.body.style.transform = 'scale(1)';
      return document.body.offsetHeight;
    });

    const watermarkText = await page.evaluate(() => {
      const watermark = document.querySelector('.watermark');
      return watermark ? watermark.textContent : '';
    });

    const templatesFactory = runningsModule?.default;
    if (typeof templatesFactory !== 'function') {
      throw new Error('Invalid runnings export: expected default function');
    }

    const templates = templatesFactory({
      watermarkText,
      watermarkScope,
      showPageNumbers,
      headerText,
      footerText
    });

    const shouldDisplayHeaderFooter = Boolean(
      showPageNumbers || (watermarkText && watermarkScope === 'all-pages') || headerText || footerText
    );

    const pdfMargin = {
      top: margin?.top || paperBorder,
      right: margin?.right || paperBorder,
      bottom: margin?.bottom || paperBorder,
      left: margin?.left || paperBorder
    };

    await page.pdf({
      path: pdfPath,
      format: paperFormat,
      landscape: paperOrientation === 'landscape',
      margin: pdfMargin,
      printBackground: true,
      displayHeaderFooter: shouldDisplayHeaderFooter,
      headerTemplate: shouldDisplayHeaderFooter ? templates.header : '',
      footerTemplate: shouldDisplayHeaderFooter ? templates.footer : '',
      preferCSSPageSize: true
    });

    return pdfPath;
  } finally {
    if (page && typeof page.close === 'function') {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Main single-PDF renderer.
 * If options.browser is provided, it reuses it; otherwise it manages its own browser instance.
 */
async function renderPDF(options) {
  const verbose = process.env.M2P_VERBOSE === 'true';
  const providedBrowser = options.browser;
  let browser = providedBrowser;
  let intentionalClose = false;

  if (verbose) {
    console.error(`[markdown2pdf] Starting PDF rendering`);
    console.error(`[markdown2pdf] Timeouts - load: ${options.loadTimeout}ms, render: ${options.renderDelay}ms`);
  }

  try {
    if (!browser) {
      browser = await launchBrowser(verbose);
      browser.on('disconnected', () => {
        if (!intentionalClose) {
          console.error('[markdown2pdf] Browser disconnected unexpectedly. This may indicate an out-of-memory issue or browser crash.');
        }
      });
    }

    return await renderPageInBrowser(browser, options);
  } finally {
    if (!providedBrowser && browser) {
      intentionalClose = true;
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Batch PDF renderer that processes multiple items using a shared browser instance.
 */
export async function renderBatchPDF(items) {
  const verbose = process.env.M2P_VERBOSE === 'true';
  const browser = await launchBrowser(verbose);
  let intentionalClose = false;

  browser.on('disconnected', () => {
    if (!intentionalClose) {
      console.error('[markdown2pdf] Browser disconnected unexpectedly during batch execution.');
    }
  });

  const results = [];

  try {
    for (const item of items) {
      try {
        await renderPageInBrowser(browser, item);
        results.push({
          pdfPath: item.pdfPath,
          success: true
        });
      } catch (err) {
        results.push({
          pdfPath: item.pdfPath,
          success: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      total: items.length,
      successful,
      failed,
      results
    };
  } finally {
    intentionalClose = true;
    await browser.close().catch(() => {});
  }
}

export default renderPDF;
