import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { pathToFileURL: realPathToFileURL } = await import('url');

const mockGoto = jest
  .fn<(...args: any[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockPdf = jest
  .fn<(...args: any[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockEvaluate = jest.fn<(...args: any[]) => Promise<unknown>>();

const mockPage = {
  setViewport: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  goto: mockGoto,
  addStyleTag: jest
    .fn<(...args: any[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  evaluate: mockEvaluate,
  pdf: mockPdf
};

const mockBrowser = {
  newPage: jest
    .fn<(...args: any[]) => Promise<typeof mockPage>>()
    .mockResolvedValue(mockPage),
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
  pathToFileURL: pathToFileURLMock
}));

const { default: renderPDF } = await import('../src/puppeteer/render.js');

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  jest.clearAllMocks();
  delete (globalThis as { __renderRunningsOptions?: unknown }).__renderRunningsOptions;
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
