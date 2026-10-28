// Placeholder syntax lives here and only here: {{figure.name}}.
import type { Figures } from "./quote.js";

/** A fresh regex each call, so no caller inherits another's lastIndex state. */
const placeholderPattern = () => /\{\{([a-z0-9_.]+)\}\}/g;

/** The placeholder for a figure: placeholder("promo.cliff") is "{{promo.cliff}}". */
export function placeholder(name: string): string {
  return `{{${name}}}`;
}

/** Every well-formed placeholder in the text, with its figure name. */
export function placeholdersIn(text: string): { placeholder: string; name: string }[] {
  return [...text.matchAll(placeholderPattern())].map((m) => ({ placeholder: m[0], name: m[1]! }));
}

/** The text with every well-formed placeholder blanked out, leaving only what the model wrote itself. */
export function withoutPlaceholders(text: string): string {
  return text.replace(placeholderPattern(), " ");
}

/**
 * Fills each {{name}} with its figure. The guard has already rejected unknown
 * names, so a missing one here is a bug and throws rather than showing a gap.
 */
export function render(text: string, figures: Figures): string {
  return text.replace(placeholderPattern(), (_, name: string) => {
    if (!Object.hasOwn(figures, name)) throw new Error(`No figure named ${name}`);
    return figures[name]!;
  });
}
