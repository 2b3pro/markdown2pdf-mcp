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

  const callTool = async (
    argumentsObj: Record<string, unknown>,
    id = '1'
  ) => {
    const handler = getHandler('tools/call');

    return handler({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'create_pdf_from_markdown',
        arguments: argumentsObj,
      },
      id,
    });
  };

  it('initializes the server with package metadata', () => {
    expect(server).toBeInstanceOf(MarkdownPdfServer);
    expect(serverConstructor).toHaveBeenCalledTimes(1);
    expect(serverInfo).toEqual({
      name: 'markdown2pdf',
      version: pkg.version,
    });
  });

  it('registers and returns the available tool', async () => {
    const handler = getHandler('tools/list');
    const response = await handler({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: '1',
    });

    expect(response.tools).toHaveLength(1);
    expect(response.tools[0].name).toBe('create_pdf_from_markdown');
    expect(response.tools[0].inputSchema.required).toContain('markdown');
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
