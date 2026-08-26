/**
 * Loose declarations for DSH packages the plugin imports at runtime but that
 * are only resolvable inside a DSH profile (not during this package's own
 * build). Type safety for the chart's own data structures lives in the real
 * modules; the DSH seam is typed structurally at the call sites.
 */

declare module '@deepseek-ai/dsh-tools' {
  export function defineTool<T>(definition: T): T
}
