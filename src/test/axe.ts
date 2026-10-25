import * as axe from 'axe-core'

export type AxeViolation = {
  id: string
  impact: string
  help: string
  selectors: string[]
}

const runOptions: axe.RunOptions = {
  resultTypes: ['violations'],
  // jsdom performs no layout and paints no pixels, so axe can never work out a
  // foreground/background ratio here and the rule only ever reports noise.
  // Contrast is covered for the palette by the theme token test and for the
  // real product by the live audit of the built site.
  rules: { 'color-contrast': { enabled: false } },
}

export async function getAxeViolations(
  scope: HTMLElement,
): Promise<AxeViolation[]> {
  const { violations } = await axe.run(scope, runOptions)

  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    selectors: violation.nodes.map((node) => node.target.join(' ')),
  }))
}
