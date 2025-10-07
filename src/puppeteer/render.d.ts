interface RenderPDFOptions {
  htmlPath: string;
  pdfPath: string;
  runningsPath: string;
  cssPath: string;
  highlightCssPath: string;
  paperFormat: string;
  paperOrientation: string;
  paperBorder: string;
  watermarkScope: 'all-pages' | 'first-page';
  showPageNumbers: boolean;
  renderDelay: number;
  loadTimeout: number;
}

declare const renderPDF: (options: RenderPDFOptions) => Promise<boolean>;
export default renderPDF;
