import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
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
  renderDelay,
  loadTimeout
}) {
  let browser;
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
      throw new Error(`Chrome executable not found at: ${chromePath}`);
    }
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      product: 'chrome'
    });
  } catch (err) {
    // Fall back to default Puppeteer-installed Chrome
    console.error('Falling back to default Chrome installation');
    browser = await puppeteer.launch({
      headless: true,
      product: 'chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  
  try {
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({
      width: 1200,
      height: 1600
    });

    // Load the HTML file with timeout
    await page.goto(`file://${htmlPath}`, {
      waitUntil: 'networkidle0',
      timeout: loadTimeout
    }).catch(err => {
      throw new Error(`Failed to load HTML content: ${err.message}`);
    });

    // Import runnings (header/footer)
    const runnings = await import(runningsPath).catch(err => {
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

    // Generate PDF
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
      displayHeaderFooter: !!watermarkText,
      headerTemplate: watermarkText ? runnings.default.header(watermarkText) : '',
      footerTemplate: watermarkText ? runnings.default.footer(watermarkText) : '',
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
