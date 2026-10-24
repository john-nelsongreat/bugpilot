import type { Bug } from './types'

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

export function createSampleBugs(now: Date = new Date()): Bug[] {
  return [
    {
      id: 'sample-checkout-nan',
      title: 'Checkout total shows NaN after a promo code',
      description:
        'The cart summary turns into NaN when SAVE10 is applied to a cart that contains a bundled item. The checkout button then stays disabled.',
      projectName: 'Northstar Checkout',
      language: 'TypeScript',
      errorMessage:
        "TypeError: Cannot read properties of undefined (reading 'amount')\n    at applyDiscount (src/pricing/discounts.ts:42:18)\n    at CartSummary (src/cart/CartSummary.tsx:88:7)",
      stepsToReproduce:
        '1. Add a starter bundle and one extra item to the cart.\n2. Apply promo code SAVE10.\n3. Open the cart summary.\n\nObserved in Chrome 141 on macOS.',
      expectedBehavior: 'The discounted total is shown and checkout can continue.',
      actualBehavior: 'The total displays NaN and the checkout button is disabled.',
      severity: 'Critical',
      status: 'Open',
      notes: 'Reproduced three times. The bundle has no discount amount defined.',
      proposedFix: '',
      fixStatus: null,
      verificationNotes: '',
      createdAt: hoursBefore(now, 2),
      updatedAt: hoursBefore(now, 2),
    },
    {
      id: 'sample-export-stall',
      title: 'CSV export stalls on tables over 50,000 rows',
      description:
        'The export progress bar freezes at 62 percent for large tables. The downloaded file is incomplete and has no closing rows.',
      projectName: 'Fieldnote',
      language: 'Python',
      errorMessage:
        'WARNING: Export worker exceeded the 30s soft timeout. Partial CSV left on disk.',
      stepsToReproduce:
        '1. Open the research dataset with 50,000 or more rows.\n2. Choose Export as CSV.\n3. Wait for the progress bar to reach 62 percent.',
      expectedBehavior: 'The full table downloads as a valid CSV.',
      actualBehavior: 'The progress bar stalls and the download never completes.',
      severity: 'High',
      status: 'In Progress',
      notes: 'Only happens with the streaming export flag enabled.',
      proposedFix:
        'Stream rows in fixed-size batches and flush the response when each batch resolves instead of buffering the whole table.',
      fixStatus: 'Proposed',
      verificationNotes: '',
      createdAt: hoursBefore(now, 26),
      updatedAt: hoursBefore(now, 3),
    },
    {
      id: 'sample-invite-plus',
      title: 'Invitation email skipped for plus-addressed users',
      description:
        'Invitations are created but never delivered when the invitee address contains a plus tag. The activity log reports the invite as sent.',
      projectName: 'Lumen API',
      language: 'JavaScript',
      errorMessage:
        'ValidationError: recipient contains unsupported characters\n    at normalizeRecipient (src/mail/invite.js:71:11)',
      stepsToReproduce:
        '1. Invite a user with an address such as sam+qa@example.com.\n2. Watch the mail worker log.\n3. Check the recipient inbox.',
      expectedBehavior: 'The invitation email is delivered to the plus-addressed recipient.',
      actualBehavior: 'No email is sent, but the invitation is marked as delivered.',
      severity: 'Medium',
      status: 'Resolved',
      notes: 'Affected only addresses with a plus sign; standard addresses were fine.',
      proposedFix:
        'Strip the local recipient validation down to the RFC 5322 address grammar and add a regression case for plus tags.',
      fixStatus: 'Verified',
      verificationNotes:
        'Reproduced with sam+qa@example.com, then confirmed the invitation arrived in the staging inbox after the fix.',
      createdAt: hoursBefore(now, 74),
      updatedAt: hoursBefore(now, 12),
    },
    {
      id: 'sample-avatar-flicker',
      title: 'Avatar fallback flickers after refresh',
      description:
        'The initials fallback flashes for roughly 200ms before the profile image appears on a hard refresh.',
      projectName: 'Northstar Checkout',
      language: 'TypeScript',
      errorMessage: '',
      stepsToReproduce:
        '1. Sign in.\n2. Hard refresh the account page.\n3. Watch the avatar in the top-right corner.',
      expectedBehavior: 'The last cached avatar appears without a visible flash.',
      actualBehavior: 'Initials appear briefly on every hard refresh.',
      severity: 'Low',
      status: 'Closed',
      notes: 'Closed as cosmetic; revisit if the avatar loader is rewritten.',
      proposedFix: '',
      fixStatus: null,
      verificationNotes: '',
      createdAt: hoursBefore(now, 122),
      updatedAt: hoursBefore(now, 48),
    },
    {
      id: 'sample-search-hyphen',
      title: 'Search ignores hyphenated project names',
      description:
        'Searching for a project such as "Atlas-Notes" returns nothing unless the hyphen is removed from the query.',
      projectName: 'Atlas Notes',
      language: 'TypeScript',
      errorMessage: '',
      stepsToReproduce:
        '1. Open the command palette.\n2. Type Atlas-Notes.\n3. Compare the result count with Atlas Notes.',
      expectedBehavior: 'Hyphenated and spaced project names return the same results.',
      actualBehavior: 'The hyphenated query returns no matches.',
      severity: 'Medium',
      status: 'Open',
      notes: 'The tokenizer splits on punctuation before normalization runs.',
      proposedFix: '',
      fixStatus: null,
      verificationNotes: '',
      createdAt: hoursBefore(now, 170),
      updatedAt: hoursBefore(now, 170),
    },
  ]
}
