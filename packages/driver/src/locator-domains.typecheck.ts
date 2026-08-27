/** Compile-time specification for the two disjoint public locator domains. */
import type { SemanticLocator, ScreenLocator, TerminalHarness } from './api.js';

declare const app: TerminalHarness;
declare const semantic: SemanticLocator;
declare const screen: ScreenLocator;

if (false) {
  const nested: SemanticLocator = semantic
    .getByRole('button')
    .filter({ has: app.getByText('Save') });
  const physical: ScreenLocator = screen
    .getByScreenText('Save')
    .nth(0)
    .and(app.getByScreenText('Save'));
  void nested;
  void physical;

  // @ts-expect-error semantic and terminal-grid locator algebra never mixes
  semantic.and(screen);
  // @ts-expect-error screen locators cannot acquire semantic descendants
  screen.getByRole('button');
  // @ts-expect-error semantic locators cannot silently switch to terminal-grid queries
  semantic.getByScreenText('Save');
  // @ts-expect-error screen rectangles are not semantic controls
  screen.fill('secret');
  // @ts-expect-error semantic state is unavailable in the screen domain
  screen.semanticState();
  // @ts-expect-error semantic conditions cannot be evaluated against grid text
  screen.evaluateCondition({ kind: 'checked', target: 'screen' });
  // @ts-expect-error semantic wait states cannot be requested from a screen locator
  screen.waitFor({ state: 'checked' });
  // @ts-expect-error drag source and destination must share a domain
  semantic.dragTo(screen);
}
