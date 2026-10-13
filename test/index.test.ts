import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import tmp from 'tmp';
import { createRequire } from 'module';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { MarkdownPdfServer as MarkdownPdfServerType } from '../src/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

let listToolsHandler: ((request: any) => Promise<any>) | undefined;
let callToolHandler: ((request: any) => Promise<any>) | undefined;
const serverMocks = {
  connect: jest.fn(async () => {}),
  close: jest.fn(async () => {}),
};
const createdPdfPaths: string[] = [];
let serverInfo: { name: string; version: string } | undefined;

const renderMock = jest.fn(
  async ({ pdfPath }: { pdfPath: string }) => {
    createdPdfPaths.push(pdfPath);
    await fs.promises.mkdir(path.dirname(pdfPath), { recursive: true });
    await fs.promises.writeFile(pdfPath, 'PDF');
  }
);

const batchRenderMock = jest.fn(
  async (items: any[]) => {
    for (const item of items) {
      createdPdfPaths.push(item.pdfPath);
      await fs.promises.mkdir(path.dirname(item.pdfPath), { recursive: true });
      await fs.promises.writeFile(item.pdfPath, 'BATCH_PDF');
    }
    return {
      total: items.length,
      successful: items.length,
      failed: 0,
      results: items.map((i) => ({ pdfPath: i.pdfPath, success: true })),
    };
  }
);

const serverConstructor = jest.fn(
  (info: any) => {
    const typedInfo = info as { name: string; version: string };
    serverInfo = typedInfo;
    let errorHandler: ((err: Error) => never) | undefined;

    return {
      info: typedInfo,
      connect: serverMocks.connect,
      close: serverMocks.close,
      setRequestHandler: (
        schema: unknown,
        handler: (request: unknown) => Promise<unknown>
      ) => {
        const methodLiteral = (() => {
          try {
            return (
              typeof (schema as any)?._def?.shape === 'function' &&
              (schema as any)._def.shape().method?._def?.value
            );
          } catch {
            return undefined;
          }
        })();

        if (
          schema === ListToolsRequestSchema ||
          methodLiteral === 'tools/list'
        ) {
          listToolsHandler = handler as (request: any) => Promise<any>;
          return;
        }

        if (
          schema === CallToolRequestSchema ||
          methodLiteral === 'tools/call'
        ) {
          callToolHandler = handler as (request: any) => Promise<any>;
          return;
        }
      },
      get onerror() {
        return errorHandler;
      },
      set onerror(handler: typeof errorHandler) {
        errorHandler = handler ?? undefined;
      },
    };
  }
);

await jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: serverConstructor,
}));

await jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    onRequest: jest.fn(),
    onNotification: jest.fn(),
    send: jest.fn(),
  })),
}));

await jest.unstable_mockModule('../src/puppeteer/render.js', () => ({
  __esModule: true,
  default: renderMock,
  renderBatchPDF: batchRenderMock,
}));

describe('MarkdownPdfServer', () => {
  let MarkdownPdfServer: typeof MarkdownPdfServerType;
  let server: MarkdownPdfServerType;

  beforeAll(async () => {
    ({ MarkdownPdfServer } = await import('../src/index.js'));
  });

  beforeEach(() => {
    serverConstructor.mockClear();
    listToolsHandler = undefined;
    callToolHandler = undefined;
    renderMock.mockClear();
    batchRenderMock.mockClear();
    serverInfo = undefined;
    server = new MarkdownPdfServer();
  });

  afterEach(() => {
    for (const pdfPath of createdPdfPaths.splice(0)) {
      if (fs.existsSync(pdfPath)) {
        fs.rmSync(pdfPath, { force: true });
      }
    }

    delete process.env.M2P_OUTPUT_DIR;
    serverMocks.connect.mockClear();
    serverMocks.close.mockClear();
  });

  const getHandler = (method: 'tools/list' | 'tools/call') => {
    const handler = method === 'tools/list' ? listToolsHandler : callToolHandler;
    if (!handler) {
      throw new Error(`Handler for ${method} not registered`);
    }

    return handler;
  };

  const invokeTool = async (
    name: string,
    argumentsObj: Record<string, unknown>,
    id = '1'
  ) => {
    const handler = getHandler('tools/call');

    return handler({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name,
        arguments: argumentsObj,
      },
      id,
    });
  };

  const callTool = async (
    argumentsObj: Record<string, unknown>,
    id = '1'
  ) => {
    return invokeTool('create_pdf_from_markdown', argumentsObj, id);
  };

  it('initializes the server with package metadata', () => {
    expect(server).toBeInstanceOf(MarkdownPdfServer);
    expect(serverConstructor).toHaveBeenCalledTimes(1);
    expect(serverInfo).toEqual({
      name: 'markdown2pdf',
      version: pkg.version,
    });
  });

  it('registers and returns the available tools', async () => {
    const handler = getHandler('tools/list');
    const response = await handler({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: '1',
    });

    expect(response.tools).toHaveLength(3);
    const names = response.tools.map((t: any) => t.name);
    expect(names).toContain('create_pdf_from_markdown');
    expect(names).toContain('batch_create_pdf');
    expect(names).toContain('validate_markdown');

    const createTool = response.tools.find((t: any) => t.name === 'create_pdf_from_markdown');
    expect(createTool.inputSchema.required).toContain('markdown');
  });

  it('converts markdown to PDF', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      const response = await callTool({
        markdown: '# Test Heading\nThis is a test.',
        outputFilename: 'test.pdf',
      });

      const message = response.content[0].text;
      expect(message).toContain('PDF file created successfully at:');
      expect(message).toContain('File exists: true');
    } finally {
      tempDir.removeCallback();
    }
  });

  it('supports optional watermark and paper settings', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({
        markdown: '# Test',
        outputFilename: 'watermark.pdf',
        watermark: 'DRAFT',
        paperFormat: 'a4',
        paperOrientation: 'landscape',
        showPageNumbers: true,
      });
    } finally {
      tempDir.removeCallback();
    }

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfPath: expect.stringContaining('watermark.pdf'),
        paperFormat: 'a4',
        paperOrientation: 'landscape',
        watermarkScope: 'all-pages',
        showPageNumbers: true,
      })
    );
  });

  it('allows restricting watermark to the first page', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({
        markdown: '# Test',
        outputFilename: 'first-page-watermark.pdf',
        watermark: 'CONFIDENTIAL',
        watermarkScope: 'first-page',
      });
    } finally {
      tempDir.removeCallback();
    }

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfPath: expect.stringContaining('first-page-watermark.pdf'),
        watermarkScope: 'first-page',
      })
    );
  });

  it('increments duplicate filenames', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({
        markdown: '# Test',
        outputFilename: 'duplicate.pdf',
      });

      await callTool(
        {
          markdown: '# Test',
          outputFilename: 'duplicate.pdf',
        },
        '2'
      );

      const secondCallArgs = renderMock.mock.calls[1]?.[0] as {
        pdfPath: string;
      };

      expect(secondCallArgs.pdfPath).toContain('duplicate-1.pdf');
      expect(
        fs.existsSync(path.join(tempDir.name, 'duplicate-1.pdf'))
      ).toBe(true);
    } finally {
      tempDir.removeCallback();
    }
  });

  it('reports the incremented path for duplicate filenames', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({ markdown: '# Test', outputFilename: 'reported.pdf' });
      const response = await callTool(
        { markdown: '# Test', outputFilename: 'reported.pdf' },
        '2'
      );

      expect(response.content[0].text).toContain(
        `PDF file created successfully at: ${path.join(tempDir.name, 'reported-1.pdf')}`
      );
    } finally {
      tempDir.removeCallback();
    }
  });

  it('uses an absolute outputFilename as-is, even when M2P_OUTPUT_DIR is set', async () => {
    const envDir = tmp.dirSync({ unsafeCleanup: true });
    const targetDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = envDir.name;

    try {
      const target = path.join(targetDir.name, 'absolute.pdf');
      await callTool({ markdown: '# Test', outputFilename: target });

      const callArgs = renderMock.mock.calls.at(-1)?.[0] as { pdfPath: string };
      expect(callArgs.pdfPath).toBe(target);
    } finally {
      envDir.removeCallback();
      targetDir.removeCallback();
    }
  });

  it('does not double the directory of an absolute outputFilename when M2P_OUTPUT_DIR is unset', async () => {
    const targetDir = tmp.dirSync({ unsafeCleanup: true });

    try {
      const target = path.join(targetDir.name, 'no-env.pdf');
      await callTool({ markdown: '# Test', outputFilename: target });

      const callArgs = renderMock.mock.calls.at(-1)?.[0] as { pdfPath: string };
      expect(callArgs.pdfPath).toBe(target);
    } finally {
      targetDir.removeCallback();
    }
  });

  it('resolves a relative outputFilename under M2P_OUTPUT_DIR without doubling the directory', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({ markdown: '# Test', outputFilename: 'sub/relative.pdf' });

      const callArgs = renderMock.mock.calls.at(-1)?.[0] as { pdfPath: string };
      expect(callArgs.pdfPath).toBe(
        path.join(tempDir.name, 'sub', 'relative.pdf')
      );
    } finally {
      tempDir.removeCallback();
    }
  });

  it('defaults output directory to HOME when none specified', async () => {
    const response = await callTool({
      markdown: '# Test',
      outputFilename: 'home-test.pdf',
    });

    const match = response.content[0].text.match(
      /PDF file created successfully at: (.+)/
    );

    expect(match?.[1]).toContain(
      path.join(os.homedir(), 'home-test.pdf')
    );
  });

  it('supports inputPath to convert local file directly', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;
    const inputMdPath = path.join(tempDir.name, 'disk-sample.md');
    fs.writeFileSync(inputMdPath, '# From File\nContent on disk.');

    try {
      const response = await callTool({
        inputPath: inputMdPath,
        outputFilename: 'from-file.pdf',
        theme: 'github',
      });

      expect(response.content[0].text).toContain('PDF file created successfully at:');
      expect(renderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pdfPath: expect.stringContaining('from-file.pdf'),
        })
      );
    } finally {
      tempDir.removeCallback();
    }
  });

  it('supports custom margin, theme, customCss, and header/footer text', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      await callTool({
        markdown: '# Styled Report',
        outputFilename: 'styled.pdf',
        theme: 'report',
        customCss: 'body { color: red; }',
        margin: { top: '30mm', right: '15mm', bottom: '30mm', left: '15mm' },
        headerText: 'Company Confidential',
        footerText: 'Internal Use Only',
      });

      expect(renderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          margin: { top: '30mm', right: '15mm', bottom: '30mm', left: '15mm' },
          headerText: 'Company Confidential',
          footerText: 'Internal Use Only',
        })
      );
    } finally {
      tempDir.removeCallback();
    }
  });

  it('processes batch conversions with shared config in batch_create_pdf', async () => {
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    process.env.M2P_OUTPUT_DIR = tempDir.name;

    try {
      const response = await invokeTool('batch_create_pdf', {
        documents: [
          { markdown: '# Doc 1', outputFilename: 'doc1.pdf' },
          { markdown: '# Doc 2', outputFilename: 'doc2.pdf', theme: 'academic' },
        ],
        sharedConfig: {
          paperFormat: 'a4',
          theme: 'github',
        },
      });

      expect(batchRenderMock).toHaveBeenCalledTimes(1);
      const batchArgs = batchRenderMock.mock.calls[0][0];
      expect(batchArgs).toHaveLength(2);
      expect(batchArgs[0].paperFormat).toBe('a4');
      expect(response.content[0].text).toContain('**Total Documents:** 2');
      expect(response.content[0].text).toContain('**Successful:** 2');
    } finally {
      tempDir.removeCallback();
    }
  });

  it('rejects empty documents array in batch_create_pdf', async () => {
    await expect(
      invokeTool('batch_create_pdf', { documents: [] })
    ).rejects.toThrow('batch_create_pdf requires a non-empty "documents" array');
  });

  it('validates markdown successfully for clean content in validate_markdown', async () => {
    const response = await invokeTool('validate_markdown', {
      markdown: '# Clean Document\nThis is a standard markdown document.',
    });

    expect(response.isError).toBe(false);
    expect(response.content[0].text).toContain('**Status:** ✅ Valid');
    expect(response.content[0].text).toContain('No issues found!');
  });

  it('detects LaTeX math and raw HTML in validate_markdown', async () => {
    const response = await invokeTool('validate_markdown', {
      markdown: '# Math Document\nFormula: $E = mc^2$ and <script>alert(1)</script>',
    });

    expect(response.content[0].text).toContain('LaTeX math equations ($...$ or $$...$$) detected');
    expect(response.content[0].text).toContain('Raw HTML tags detected in markdown');
  });

  it('detects Mermaid syntax warnings in validate_markdown', async () => {
    const response = await invokeTool('validate_markdown', {
      markdown: '# Mermaid Test\n```mermaid\ninvalidHeader\nA-->B[\n```',
    });

    expect(response.content[0].text).toContain('unrecognized header');
    expect(response.content[0].text).toContain('unbalanced delimiters');
  });

  it('throws for unknown tools', async () => {
    const handler = getHandler('tools/call');

    await expect(
      handler({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'nonexistent_tool',
          arguments: {},
        },
        id: '1',
      })
    ).rejects.toThrow(McpError);
  });

  it('validates required markdown argument', async () => {
    await expect(
      callTool({
        outputFilename: 'missing.pdf',
      })
    ).rejects.toThrow('Missing required argument: markdown');
  });
});
