import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AnalyzePage } from './AnalyzePage'

describe('Analyze page folder picker', () => {
  it('accepts folders again after visiting the paste tab', async () => {
    const user = userEvent.setup()
    render(<AnalyzePage analyze={vi.fn()} />)

    expect(screen.getByLabelText('Choose a folder to analyse')).toHaveAttribute('webkitdirectory')

    await user.click(screen.getByRole('tab', { name: 'Paste code' }))
    expect(screen.queryByLabelText('Choose a folder to analyse')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Upload files' }))
    expect(screen.getByLabelText('Choose a folder to analyse')).toHaveAttribute('webkitdirectory')
  })
})
