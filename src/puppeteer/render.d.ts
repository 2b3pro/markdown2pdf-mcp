export interface MarginOptions {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface RenderPDFOptions {
  htmlPath: string;
  pdfPath: string;
  runningsPath: string;
  cssPath: string;
  highlightCssPath: string;
  mermaidPath?: string;
  assetsDir?: string;
  allowAllImages?: boolean;
  paperFormat: string;
  paperOrientation: string;
  paperBorder?: string;
  margin?: MarginOptions;
  watermarkScope: 'all-pages' | 'first-page';
  showPageNumbers: boolean;
  headerText?: string;
  footerText?: string;
  renderDelay: number;
  loadTimeout: number;
  browser?: any;
}

export interface BatchResultItem {
  pdfPath: string;
  success: boolean;
  error?: string;
}

export interface BatchRenderResult {
  total: number;
  successful: number;
  failed: number;
  results: BatchResultItem[];
}

export declare function isAllowedFileUrl(
  url: string,
  assetsDir?: string
): boolean;

export declare function shouldAllowRequest(args: {
  isMainFrameNavigation: boolean;
  url: string;
  assetsDir?: string;
  allowAllImages?: boolean;
}): boolean;

export declare function launchBrowser(verbose?: boolean): Promise<any>;

export declare function renderBatchPDF(
  items: RenderPDFOptions[]
): Promise<BatchRenderResult>;

declare const renderPDF: (options: RenderPDFOptions) => Promise<string>;
export default renderPDF;
