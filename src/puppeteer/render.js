import puppeteer from 'puppeteer';
import { pathToFileURL } from 'url';
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

async function renderPDF({
  htmlPath,
  pdfPath,
  runningsPath,
  cssPath,
  highlightCssPath,
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
  
  try {
    const page = await browser.newPage();

    // Monitor browser crashes
    browser.on('disconnected', () => {
      throw new Error('Browser disconnected unexpectedly. This may indicate an out-of-memory issue or browser crash. Try reducing content size or increasing system resources.');
    });

    page.on('error', err => {
      throw new Error(`Page crashed: ${err.message}`);
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
      await browser.close();
    }
  }
}

export default renderPDF;
