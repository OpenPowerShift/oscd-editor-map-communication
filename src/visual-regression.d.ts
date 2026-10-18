/**
 * Type declaration for the screenshot helper. The package ships its types as
 * `index.d.ts` re-exporting `./browser/commands.mjs`; TypeScript 6 does not
 * resolve that re-export, so the one export used here is declared locally.
 */
declare module '@web/test-runner-visual-regression' {
  export function visualDiff(element: Node, name: string): Promise<void>;
}
