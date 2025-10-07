const escapeHtml = (value = '') =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });

const templateStyles = `
  <style>
    .m2p-header,
    .m2p-footer {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: rgba(0, 0, 0, 0.45);
      width: 100%;
      padding: 0 24px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      height: 100%;
    }

    .m2p-header {
      justify-content: center;
    }

    .m2p-footer {
      justify-content: space-between;
    }

    .m2p-watermark {
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }

    .m2p-page-number {
      color: rgba(0, 0, 0, 0.65);
      font-weight: 500;
    }
  </style>
`;

export default function buildHeaderFooter({
  watermarkText = '',
  watermarkScope = 'all-pages',
  showPageNumbers = false
} = {}) {
  const safeWatermark = escapeHtml(watermarkText);
  const includeWatermark = safeWatermark && watermarkScope === 'all-pages';
  const watermarkSpan = includeWatermark
    ? `<span class="m2p-watermark">${safeWatermark}</span>`
    : '<span></span>';
  const pageNumberSpan = showPageNumbers
    ? `<span class="m2p-page-number">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`
    : '<span></span>';

  const header = `
    ${templateStyles}
    <div class="m2p-header">
      ${watermarkSpan}
    </div>
  `;

  const footer = `
    ${templateStyles}
    <div class="m2p-footer">
      ${watermarkSpan}
      ${pageNumberSpan}
    </div>
  `;

  return {
    header,
    footer
  };
}
