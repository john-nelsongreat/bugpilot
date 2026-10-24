import type { Bug, BugDraft } from '../features/bugs/types'

let sequence = 0

export function makeBugDraft(overrides: Partial<BugDraft> = {}): BugDraft {
  return {
    title: 'Checkout total becomes NaN',
    description: 'A valid cart total turns into NaN after a promo code is applied.',
    projectName: 'Northstar Checkout',
    language: 'TypeScript',
    errorMessage: "TypeError: Cannot read properties of undefined (reading 'amount')",
    stepsToReproduce: 'Add two items, apply SAVE10, open the cart summary.',
    expectedBehavior: 'The discounted total is shown.',
    actualBehavior: 'The total displays NaN.',
    severity: 'High',
    status: 'Open',
    notes: '',
    proposedFix: '',
    fixStatus: null,
    verificationNotes: '',
    ...overrides,
  }
}

export function makeBug(overrides: Partial<Bug> = {}): Bug {
  sequence += 1
  const createdAt = new Date(Date.UTC(2026, 9, 1, 9, sequence)).toISOString()

  return {
    id: `bug-${sequence}`,
    ...makeBugDraft(),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}
