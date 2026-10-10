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
 *
 * Opt-in relaxations:
 * - assetsDir: file:// images inside that allowlisted directory may load.
 * - allowAllImages (the --dangerously-allow-images override): any file:// or
 *   http(s) subresource may load, restoring the pre-2.2.0 behavior. Raw HTML is
 *   still disabled upstream, so this only re-enables markdown image loading.
 *
 * Exported so the policy can be unit-tested without launching a browser.
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

async function renderPDF({
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
  paperBorder,
  watermarkScope,
  showPageNumbers,
  renderDelay,
  loadTimeout
}) {
  let browser;
  const verbose = process.env.M2P_VERBOSE === 'true';

  if (verbose) {
    console.error(`[markdown2pdf] Starting PDF rendering`);
    console.error(`[markdown2pdf] Timeouts - load: ${loadTimeout}ms, render: ${renderDelay}ms`);
  }

  try {
    // Try with our specific Chrome version first
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

    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      product: 'chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Prevent shared memory issues
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--max-old-space-size=4096' // Increase memory limit to 4GB
      ]
    });
  } catch (err) {
    // Fall back to default Puppeteer-installed Chrome
    if (verbose) {
      console.error('[markdown2pdf] Falling back to default Chrome installation');
    }
    browser = await puppeteer.launch({
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
  
  // Set before the finally-block close() so the disconnected handler can tell an
  // intentional shutdown apart from a real crash and not throw a false alarm.
  let intentionalClose = false;

  try {
    const page = await browser.newPage();

    // Security: block local-file reads (LFI) and outbound requests (SSRF).
    // Must be enabled before navigation so the very first subresource is gated.
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

    // Monitor browser crashes. Throwing inside an event callback cannot be
    // caught by the caller and would crash the process, so only log here; a real
    // crash surfaces as a rejection from the awaited page operations below.
    browser.on('disconnected', () => {
      if (!intentionalClose) {
        console.error('[markdown2pdf] Browser disconnected unexpectedly. This may indicate an out-of-memory issue or browser crash. Try reducing content size or increasing system resources.');
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

    // Set viewport
    await page.setViewport({
      width: 1200,
      height: 1600
    });

    if (verbose) {
      console.error(`[markdown2pdf] Loading HTML from: ${htmlPath}`);
    }

    // Load the HTML file with timeout
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

    // Import runnings (header/footer)
    const runningsUrl = pathToFileURL(runningsPath).href;
    const runningsModule = await import(runningsUrl).catch(err => {
      throw new Error(`Failed to import runnings.js: ${err.message}`);
    });

    // Add CSS if provided
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

    // Inject Mermaid from a local vendored bundle (no CDN / no network) and
    // render any diagrams. addScriptTag with `path` reads the file in Node and
    // injects it inline, so it is not subject to request interception.
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

    // Wait for specified delay
    await new Promise(resolve => setTimeout(resolve, renderDelay));

    // Check for mermaid errors
    const mermaidError = await page.evaluate(() => {
      const errorDiv = document.getElementById('mermaid-error');
      return errorDiv ? errorDiv.innerText : null;
    });

    if (mermaidError) {
      throw new Error(`Mermaid diagram rendering failed: ${mermaidError}`);
    }

    // Force repaint to ensure proper rendering
    await page.evaluate(() => {
      document.body.style.transform = 'scale(1)';
      return document.body.offsetHeight;
    });

    // Get watermark text if present
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
      showPageNumbers
    });

    const shouldDisplayHeaderFooter = Boolean(
      showPageNumbers || (watermarkText && watermarkScope === 'all-pages')
    );

    await page.pdf({
      path: pdfPath,
      format: paperFormat,
      landscape: paperOrientation === 'landscape',
      margin: {
        top: paperBorder,
        right: paperBorder,
        bottom: paperBorder,
        left: paperBorder
      },
      printBackground: true,
      displayHeaderFooter: shouldDisplayHeaderFooter,
      headerTemplate: shouldDisplayHeaderFooter ? templates.header : '',
      footerTemplate: shouldDisplayHeaderFooter ? templates.footer : '',
      preferCSSPageSize: true
    });

    return pdfPath;
  } finally {
    if (browser) {
      intentionalClose = true;
      await browser.close();
    }
  }
}

export default renderPDF;
