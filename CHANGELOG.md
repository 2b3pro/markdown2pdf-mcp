# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

=======
## [2.1.0] - 2025-07-16

### Added

- Mermaid diagram support, rendered as visual charts in the PDF.
- Error handling for malformed Mermaid diagrams; syntax errors are now displayed in the output PDF.

### Changed

- Updated the markdown parser to allow HTML tags, enabling Mermaid diagram rendering.

## [2.0.2] - 2024-12-23

### Fixed

- Fixed ERR_MODULE_NOT_FOUND error by updating SDK import paths to use correct module structure
- Resolved TypeScript errors related to Request type usage

## [2.0.1] - 2024-12-23

### Changed

- Pinned Chrome version to 131.0.6778.204 for consistent PDF generation; Claude requires it hardcoded.
- Updated Puppeteer configuration to use new headless mode

## [2.0.0] - 2024-12-23

### Changed

- Migrated from PhantomJS to Puppeteer for PDF generation
- Improved rendering quality and CSS support
- Enhanced header/footer handling
- Better support for modern web features and fonts
- More reliable resource loading
- Improved error handling and memory management

### Added

- TypeScript type definitions for better type safety
- Modern async/await patterns
- Better security through regular Chrome updates

### Removed

- PhantomJS dependency and related implementation

## [1.3.0] - 2024-12-23

### Added

- Optional watermark parameter with validation (max 15 characters, alphanumeric with spaces and hyphens)
- Dynamic watermark sizing based on page dimensions

### Changed

- Optimized watermark size calculation for better visual balance
- Improved watermark positioning and rotation handling in PhantomJS
- Increased timeout values for better handling of complex documents
- Enhanced error handling for external resources and complex content

### Fixed

- Watermark sizing issues with different content lengths

## [1.2.5] - 2024-12-23

### Changed

- Enhanced success message to display full absolute path of generated PDF file

## [1.2.4] - 2024-12-23

### Changed

- Renamed output parameter from `outputPath` to `outputFilename` for better clarity
- Changed environment variable from `M2P_DEFAULT_OUTPUT_PATH` to `M2P_OUTPUT_DIR` to better reflect its purpose
- Improved file extension handling by automatically appending .pdf if missing
- Enhanced parameter descriptions in the tool schema

## [1.2.3] - 2024-12-23

### Changed

- Updated documentation to correctly reflect support for external images
- Clarified markdown limitations in README.md and tool description

## [1.2.2] - 2024-12-23

### Added

- Support for decimal values in paperBorder margins (e.g., '1.5cm', '2.5mm')

## [1.2.1] - 2024-12-23

### Fixed

- Fixed "Method not found" error by properly registering the create_pdf_from_markdown tool in MCP capabilities
- Resolved path resolution issues by using absolute paths for all file references
- Improved PDF generation reliability by increasing render delay and timeout values

## [1.2.0] - 2024-12-21

### Added

- Support for default output path via MCP settings (DEFAULT_OUTPUT_PATH)
- Automatic file name incrementation to prevent overwriting existing files

### Changed

- Made output path parameter optional in the tool schema
- Default output path now reads from MCP settings or falls back to '/Volumes/RAMDisk/output.pdf'

## [1.1.0] - Initial Release

### Added

- Basic markdown to PDF conversion
- Support for syntax highlighting
- Custom CSS styling
- Configurable paper format, orientation, and borders
