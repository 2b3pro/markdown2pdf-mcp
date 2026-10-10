import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { pathToFileURL: realPathToFileURL, fileURLToPath: realFileURLToPath } =
  await import('url');

const mockGoto = jest
  .fn<(...args: any[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockPdf = jest
  .fn<(...args: any[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockEvaluate = jest.fn<(...args: any[]) => Promise<unknown>>();

const mockMainFrame = {};
const mockPage = {
  setViewport: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  setRequestInterception: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  on: jest.fn<(...args: any[]) => unknown>(),
  mainFrame: jest.fn(() => mockMainFrame),
  goto: mockGoto,
  addStyleTag: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  addScriptTag: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  evaluate: mockEvaluate,
  pdf: mockPdf
};

const mockBrowser = {
  newPage: jest
    .fn<(...args: any[]) => Promise<typeof mockPage>>()
    .mockResolvedValue(mockPage),
  on: jest.fn<(...args: any[]) => unknown>(),
  close: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined)
};

const mockLaunch = jest
  .fn<(...args: any[]) => Promise<typeof mockBrowser>>()
  .mockResolvedValue(mockBrowser);

const mockPuppeteer = { launch: mockLaunch };

jest.unstable_mockModule('puppeteer', () => ({
  __esModule: true,
  default: mockPuppeteer
}));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown2pdf-render-'));
const runningsStubPath = path.join(tempDir, 'runnings.js');
fs.writeFileSync(
  runningsStubPath,
  [
    'module.exports = function (options = {}) {',
    '  globalThis.__renderRunningsOptions = options;',
    "  return { header: '<div>header</div>', footer: '<div>footer</div>' };",
    '};',
  ].join('\n'),
  'utf8'
);

// Assets-dir fixtures: an allowlisted `assets/` subdir with an image, plus a
// sibling secret that lives OUTSIDE it to exercise traversal and symlink escape.
const assetsBase = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown2pdf-assetsbase-'));
const assetsDir = path.join(assetsBase, 'assets');
fs.mkdirSync(assetsDir);
fs.writeFileSync(path.join(assetsDir, 'chart.png'), 'PNGDATA');
const outsideSecret = path.join(assetsBase, 'secret.txt');
fs.writeFileSync(outsideSecret, 'TOPSECRET');
const pathToFileURLReal = (p: string) => realPathToFileURL(p).href;

const windowsHtmlPath = 'C:\\\\temp\\\\test.html';
const windowsRunningsPath = 'C:\\\\temp\\\\runnings.js';

const pathToFileURLMock = jest.fn((input: string) => {
  if (input === windowsHtmlPath) {
    return { href: 'file:///C:/temp/test.html' };
  }
  if (input === windowsRunningsPath) {
    return realPathToFileURL(runningsStubPath);
  }
  return realPathToFileURL(input);
});

jest.unstable_mockModule('url', () => ({
  pathToFileURL: pathToFileURLMock,
  fileURLToPath: realFileURLToPath
}));

const { default: renderPDF, shouldAllowRequest, isAllowedFileUrl } = await import(
  '../src/puppeteer/render.js'
);

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(assetsBase, { recursive: true, force: true });
});

afterEach(() => {
  jest.clearAllMocks();
  delete (globalThis as { __renderRunningsOptions?: unknown }).__renderRunningsOptions;
});

describe('shouldAllowRequest (LFI/SSRF gate)', () => {
  it('allows the top-level document navigation', () => {
    expect(
      shouldAllowRequest({
        isMainFrameNavigation: true,
        url: 'file:///tmp/abc123.html'
      })
    ).toBe(true);
  });

  it('allows self-contained data: URIs', () => {
    expect(
      shouldAllowRequest({
        isMainFrameNavigation: false,
        url: 'data:image/png;base64,iVBORw0KGgo='
      })
    ).toBe(true);
  });

  it('blocks file:// subresource reads (local file disclosure)', () => {
    for (const url of [
      'file:///etc/passwd',
      'file:///C:/Windows/win.ini',
      'file:///root/.ssh/id_rsa'
    ]) {
      expect(
        shouldAllowRequest({ isMainFrameNavigation: false, url })
      ).toBe(false);
    }
  });

  it('blocks outbound http(s) subresources (SSRF)', () => {
    for (const url of [
      'http://127.0.0.1:9971/canary',
      'http://169.254.169.254/latest/meta-data/',
      'https://evil.example.com/collect'
    ]) {
      expect(
        shouldAllowRequest({ isMainFrameNavigation: false, url })
      ).toBe(false);
    }
  });

  it('allows file:// images inside the allowlisted assets dir', () => {
    expect(
      shouldAllowRequest({
        isMainFrameNavigation: false,
        url: pathToFileURLReal(path.join(assetsDir, 'chart.png')),
        assetsDir
      })
    ).toBe(true);
  });

  it('still blocks file:// outside the assets dir and path traversal', () => {
    const outside = pathToFileURLReal(path.join(assetsDir, '..', 'secret.txt'));
    expect(
      shouldAllowRequest({ isMainFrameNavigation: false, url: outside, assetsDir })
    ).toBe(false);
    expect(
      shouldAllowRequest({
        isMainFrameNavigation: false,
        url: 'file:///etc/passwd',
        assetsDir
      })
    ).toBe(false);
  });

  it('--dangerously-allow-images reopens file:// and http(s) loading', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://127.0.0.1:9971/canary',
      'https://cdn.example.com/logo.png'
    ]) {
      expect(
        shouldAllowRequest({ isMainFrameNavigation: false, url, allowAllImages: true })
      ).toBe(true);
    }
  });
});

describe('isAllowedFileUrl (assets-dir canonicalization)', () => {
  it('allows a real file inside the dir, blocks traversal and symlink escape', () => {
    expect(
      isAllowedFileUrl(pathToFileURLReal(path.join(assetsDir, 'chart.png')), assetsDir)
    ).toBe(true);

    // Path traversal that resolves outside the dir
    expect(
      isAllowedFileUrl(
        pathToFileURLReal(path.join(assetsDir, '..', 'secret.txt')),
        assetsDir
      )
    ).toBe(false);

    // Symlink inside the dir pointing outside must not escape
    const linkPath = path.join(assetsDir, 'escape.png');
    try {
      fs.symlinkSync(outsideSecret, linkPath);
      expect(isAllowedFileUrl(pathToFileURLReal(linkPath), assetsDir)).toBe(false);
    } finally {
      fs.rmSync(linkPath, { force: true });
    }
  });

  it('fails closed when no assets dir is configured', () => {
    expect(
      isAllowedFileUrl(pathToFileURLReal(path.join(assetsDir, 'chart.png')), undefined)
    ).toBe(false);
  });
});

describe('renderPDF Windows path handling', () => {
  it('converts Windows paths to file URLs before navigation and import', async () => {
    mockEvaluate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await renderPDF({
        htmlPath: windowsHtmlPath,
        pdfPath: 'C:\\\\temp\\\\output.pdf',
        runningsPath: windowsRunningsPath,
        cssPath: '',
        highlightCssPath: '',
        paperFormat: 'A4',
        paperOrientation: 'portrait',
        paperBorder: '0',
        watermarkScope: 'all-pages',
        showPageNumbers: false,
        renderDelay: 0,
        loadTimeout: 1000
      });
    } finally {
      errorSpy.mockRestore();
    }

    expect(pathToFileURLMock).toHaveBeenCalledWith(windowsHtmlPath);
    expect(pathToFileURLMock).toHaveBeenCalledWith(windowsRunningsPath);
    expect(mockGoto).toHaveBeenCalledWith(
      'file:///C:/temp/test.html',
      expect.objectContaining({
        waitUntil: 'networkidle0'
      })
    );
    expect(mockPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'C:\\\\temp\\\\output.pdf',
        displayHeaderFooter: false,
        headerTemplate: '',
        footerTemplate: ''
      })
    );

    const runningsOptions = (globalThis as { __renderRunningsOptions?: any })
      .__renderRunningsOptions;
    expect(runningsOptions).toEqual(
      expect.objectContaining({
        watermarkScope: 'all-pages',
        watermarkText: '',
        showPageNumbers: false
      })
    );
  });

  it('enables header/footer when page numbers are requested', async () => {
    mockEvaluate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('');

    await renderPDF({
      htmlPath: windowsHtmlPath,
      pdfPath: 'C:\\\\temp\\\\output.pdf',
      runningsPath: windowsRunningsPath,
      cssPath: '',
      highlightCssPath: '',
      paperFormat: 'letter',
      paperOrientation: 'portrait',
      paperBorder: '2cm',
      watermarkScope: 'first-page',
      showPageNumbers: true,
      renderDelay: 0,
      loadTimeout: 1000
    });

    expect(mockPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        displayHeaderFooter: true,
        headerTemplate: '<div>header</div>',
        footerTemplate: '<div>footer</div>'
      })
    );

    const runningsOptions = (globalThis as { __renderRunningsOptions?: any })
      .__renderRunningsOptions;
    expect(runningsOptions).toEqual(
      expect.objectContaining({
        watermarkScope: 'first-page',
        showPageNumbers: true
      })
    );
  });
});
