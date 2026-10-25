import { describe, expect, it } from 'vitest'
import { FIELD_LIMITS } from '../bugs/validation'
import { composeReproductionDetails } from './prefill'

describe('composeReproductionDetails', () => {
  it('combines the steps and actual behavior under labelled sections', () => {
    expect(
      composeReproductionDetails(
        'Add two items and apply SAVE10.',
        'The checkout total shows NaN.',
      ),
    ).toBe(
      'Steps to reproduce:\nAdd two items and apply SAVE10.\n\nActual behavior:\nThe checkout total shows NaN.',
    )
  })

  it('keeps only the sections that have text', () => {
    expect(composeReproductionDetails('Add two items.', '')).toBe(
      'Steps to reproduce:\nAdd two items.',
    )
    expect(composeReproductionDetails('', 'The total shows NaN.')).toBe(
      'Actual behavior:\nThe total shows NaN.',
    )
  })

  it('returns an empty string when both sections are blank', () => {
    expect(composeReproductionDetails('  ', '\n')).toBe('')
  })

  it('truncates each section to its stored field limit', () => {
    const steps = 's'.repeat(FIELD_LIMITS.stepsToReproduce + 25)
    const actual = 'a'.repeat(FIELD_LIMITS.actualBehavior + 25)

    expect(composeReproductionDetails(steps, actual)).toBe(
      `Steps to reproduce:\n${'s'.repeat(
        FIELD_LIMITS.stepsToReproduce,
      )}\n\nActual behavior:\n${'a'.repeat(FIELD_LIMITS.actualBehavior)}`,
    )
  })
})
