#!/usr/bin/env node

// Simple script to test markdown2pdf MCP tool
// Run the server with `npm start` in one terminal
// Then run this script with `node test/test-mcp.js` in another terminal

import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sample markdown content
const markdown = `# Test Heading
This is a test markdown document.

## Subheading
- List item 1
- List item 2

### Code Example
\`\`\`javascript
console.log('Hello World');
\`\`\`
`;

// Create JSON-RPC request
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'call_tool',
  params: {
    name: 'create_pdf_from_markdown',
    arguments: {
      markdown: markdown,
      outputPath: join(__dirname, 'test-output.pdf'),
      paperFormat: 'letter',
      paperOrientation: 'portrait',
      paperBorder: '2cm'
    }
  }
};

// Send request to running MCP server on stdio
process.stdout.write(JSON.stringify(request) + '\n');

// Handle response from stdio
let responseData = '';
process.stdin.on('data', (data) => {
  responseData += data.toString();
  
  // Check if we have a complete JSON response
  try {
    const response = JSON.parse(responseData);
    console.log('Received response:', JSON.stringify(response, null, 2));
    process.exit(0);
  } catch (e) {
    // Response not complete yet, keep reading
  }
});

process.stdin.on('error', (err) => {
  console.error('Error:', err);
  process.exit(1);
});
