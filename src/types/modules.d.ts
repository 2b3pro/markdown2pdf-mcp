declare module 'remarkable' {
  export class Remarkable {
    constructor(preset: string, options?: any);
    render(markdown: string): string;
  }
}
