// domino 的 d.ts 是 `declare module 'domino'` 风格，包名却是 @mixmark-io/domino。
// 这里提供针对 @mixmark-io/domino 的最小类型声明（仅覆盖本项目用到的 API）。
declare module "@mixmark-io/domino" {
  export interface DominoElement {
    tagName: string;
    textContent: string | null;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    remove(): void;
    querySelector(sel: string): DominoElement | null;
    querySelectorAll(sel: string): DominoElement[];
  }

  export interface DominoDocument {
    title: string;
    textContent: string;
    querySelector(sel: string): DominoElement | null;
    querySelectorAll(sel: string): DominoElement[];
  }

  export function createDocument(html?: string, force?: boolean): DominoDocument;
}
