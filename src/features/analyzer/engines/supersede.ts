/**
 * Rule-id pairs where an AST result replaces a pattern match on the same line. It lives in
 * its own module because the session code needs it and the page must not import the whole
 * AST rule table just to know which ids overlap.
 */
export const AST_SUPERSEDES: Readonly<Record<string, string>> = {
  'bugpilot/ast/empty-catch': 'bugpilot/generic/empty-catch',
}
