/**
 * Built-in themes and CSS styling manager for markdown2pdf.
 */

export type ThemeName = 'default' | 'github' | 'academic' | 'report' | 'minimal';

export const THEME_NAMES: ThemeName[] = ['default', 'github', 'academic', 'report', 'minimal'];

export const THEMES: Record<ThemeName, string> = {
  default: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #24292e;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-weight: 600;
      line-height: 1.25;
      color: #1f2328;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    p, ul, ol, blockquote, table, pre {
      margin-top: 0;
      margin-bottom: 16px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      padding: 0.2em 0.4em;
      font-size: 85%;
      color: #24292e;
      background-color: rgba(175, 184, 193, 0.2);
      border-radius: 4px;
    }
    pre {
      padding: 16px;
      overflow: auto;
      font-size: 85%;
      line-height: 1.45;
      background-color: #f6f8fa;
      border-radius: 6px;
      border: 1px solid #d0d7de;
    }
    pre code {
      padding: 0;
      font-size: inherit;
      color: inherit;
      background-color: transparent;
      border-radius: 0;
    }
    blockquote {
      padding: 0 1em;
      color: #57606a;
      border-left: 0.25em solid #d0d7de;
      margin-left: 0;
    }
    table {
      border-spacing: 0;
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }
    table th, table td {
      padding: 6px 13px;
      border: 1px solid #d0d7de;
    }
    table tr:nth-child(2n) {
      background-color: #f6f8fa;
    }
    img {
      max-width: 100%;
      box-sizing: border-box;
    }
  `,

  github: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1f2328;
      background-color: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      font-weight: 600;
      line-height: 1.25;
      margin-top: 24px;
      margin-bottom: 16px;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }
    hr {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      background-color: #d1d9e0;
      border: 0;
    }
    blockquote {
      padding: 0 1em;
      color: #59636e;
      border-left: 0.25em solid #d1d9e0;
      margin: 0 0 16px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
      display: block;
      overflow: auto;
    }
    table th {
      font-weight: 600;
      background-color: #f6f8fa;
    }
    table th, table td {
      padding: 6px 13px;
      border: 1px solid #d1d9e0;
    }
    table tr:nth-child(2n) {
      background-color: #f6f8fa;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 85%;
      padding: 0.2em 0.4em;
      background-color: rgba(129, 140, 153, 0.15);
      border-radius: 6px;
    }
    pre {
      background-color: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      font-size: 85%;
      line-height: 1.45;
      border: 1px solid #d1d9e0;
    }
    pre code {
      background-color: transparent;
      padding: 0;
    }
  `,

  academic: `
    body {
      font-family: "Times New Roman", Times, Georgia, "DejaVu Serif", serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #111111;
      background-color: #ffffff;
      text-align: justify;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-weight: bold;
      color: #000000;
      text-align: left;
    }
    h1 { font-size: 16pt; margin-top: 18pt; margin-bottom: 10pt; text-align: center; }
    h2 { font-size: 13pt; margin-top: 14pt; margin-bottom: 8pt; }
    h3 { font-size: 11pt; font-style: italic; margin-top: 10pt; margin-bottom: 6pt; }
    p {
      margin-top: 0;
      margin-bottom: 8pt;
      text-indent: 1.5em;
    }
    h1 + p, h2 + p, h3 + p {
      text-indent: 0;
    }
    blockquote {
      margin: 10pt 2em;
      font-size: 10pt;
      font-style: italic;
      color: #333333;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
      font-size: 10pt;
    }
    table th {
      border-top: 2px solid #000000;
      border-bottom: 1px solid #000000;
      padding: 6pt 8pt;
      font-weight: bold;
      text-align: left;
    }
    table td {
      padding: 5pt 8pt;
      border-bottom: 1px solid #dddddd;
    }
    table tr:last-child td {
      border-bottom: 2px solid #000000;
    }
    code {
      font-family: "Courier New", Courier, monospace;
      font-size: 9pt;
      background: #f4f4f4;
      padding: 1pt 3pt;
    }
    pre {
      font-family: "Courier New", Courier, monospace;
      font-size: 9pt;
      background: #f7f7f7;
      border: 1px solid #cccccc;
      padding: 8pt;
      margin: 10pt 0;
    }
  `,

  report: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #2c3e50;
      background-color: #ffffff;
    }
    h1 {
      font-size: 26px;
      color: #1a365d;
      font-weight: 700;
      border-bottom: 3px solid #2b6cb0;
      padding-bottom: 8px;
      margin-top: 28px;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }
    h2 {
      font-size: 20px;
      color: #2b6cb0;
      font-weight: 600;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 22px;
      margin-bottom: 12px;
    }
    h3 {
      font-size: 16px;
      color: #2d3748;
      font-weight: 600;
      margin-top: 18px;
      margin-bottom: 10px;
    }
    blockquote {
      border-left: 4px solid #3182ce;
      background-color: #ebf8ff;
      padding: 10px 16px;
      margin: 16px 0;
      border-radius: 0 4px 4px 0;
      color: #2c5282;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    table th {
      background-color: #2b6cb0;
      color: #ffffff;
      font-weight: 600;
      padding: 10px 12px;
      text-align: left;
    }
    table td {
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    table tr:nth-child(even) td {
      background-color: #f7fafc;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 85%;
      color: #c53030;
      background-color: #fff5f5;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #feb2b2;
    }
    pre {
      background-color: #1a202c;
      color: #edf2f7;
      padding: 14px 18px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.5;
    }
    pre code {
      color: inherit;
      background-color: transparent;
      border: none;
      padding: 0;
    }
  `,

  minimal: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.7;
      color: #333333;
      background-color: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      font-weight: 400;
      color: #111111;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    h1 { font-size: 22px; letter-spacing: -0.3px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    blockquote {
      border-left: 2px solid #888888;
      padding-left: 12px;
      margin: 16px 0;
      color: #666666;
      font-style: italic;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    table th, table td {
      padding: 8px 10px;
      border-bottom: 1px solid #eeeeee;
      text-align: left;
    }
    table th {
      border-bottom: 2px solid #333333;
      font-weight: 500;
    }
    code {
      font-family: Menlo, Monaco, monospace;
      font-size: 90%;
      background: #fafafa;
      padding: 2px 4px;
      border: 1px solid #eeeeee;
    }
    pre {
      background: #fafafa;
      border: 1px solid #eeeeee;
      padding: 12px;
      margin: 16px 0;
    }
    pre code {
      background: transparent;
      border: none;
      padding: 0;
    }
  `
};

/**
 * Returns merged CSS incorporating the chosen theme and any custom CSS overrides.
 */
export function getThemeCss(themeName: string = 'default', customCss: string = ''): string {
  const normalizedTheme = (themeName.toLowerCase() in THEMES)
    ? (themeName.toLowerCase() as ThemeName)
    : 'default';

  const themeStyles = THEMES[normalizedTheme] || THEMES.default;
  const userStyles = customCss ? `\n/* Custom User CSS */\n${customCss}` : '';

  return `${themeStyles}\n${userStyles}`;
}
