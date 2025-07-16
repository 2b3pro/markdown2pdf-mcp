import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import tmp from 'tmp';

async function test() {
  const outputDir = os.tmpdir();
  const outputPath = path.join(outputDir, 'test.pdf');
  
  console.log('Creating temporary HTML file...');
  tmp.file({ postfix: '.html' }, async (err, tmpHtmlPath, tmpHtmlFd) => {
    if (err) {
      console.error('Error creating temp file:', err);
      return;
    }
    
    console.log('Temp HTML path:', tmpHtmlPath);
    fs.closeSync(tmpHtmlFd);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page {
            margin: 20px;
            size: letter portrait;
          }
          body { font-family: Arial; }
        </style>
      </head>
      <body>
        <h1>Test PDF Generation</h1>
        <p>This is a test.</p>
      </body>
      </html>
    `;
    
    try {
      console.log('Writing HTML content...');
      await fs.promises.writeFile(tmpHtmlPath, html);
      
      console.log('Launching browser...');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      try {
        console.log('Creating new page...');
        const page = await browser.newPage();
        
        console.log('Loading HTML file...');
        await page.goto(`file://${tmpHtmlPath}`, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });
        
        console.log('Generating PDF...');
        await page.pdf({
          path: outputPath,
          format: 'letter',
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
          },
          printBackground: true
        });
        
        console.log('PDF generated successfully');
        console.log('Output path:', outputPath);
        console.log('File exists:', fs.existsSync(outputPath));
      } finally {
        await browser.close();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
}

test();
