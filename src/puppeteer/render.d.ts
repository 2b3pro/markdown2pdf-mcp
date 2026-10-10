interface RenderPDFOptions {
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
  paperBorder: string;
  watermarkScope: 'all-pages' | 'first-page';
  showPageNumbers: boolean;
  renderDelay: number;
  loadTimeout: number;
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

declare const renderPDF: (options: RenderPDFOptions) => Promise<boolean>;
export default renderPDF;
