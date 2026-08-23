declare module "jsdom" {
  export interface ConstructorOptions {
    url?: string;
    pretendToBeVisual?: boolean;
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
