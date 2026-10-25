import { describe, expect, it } from 'vitest'
import { getRouteTitle } from './routeTitle'

const bugs = [
  { id: 'bug-1', title: 'Export drops the status field' },
  { id: 'bug-2', title: 'Dark theme contrast on badges' },
]

describe('getRouteTitle', () => {
  it('titles each route with its own label', () => {
    expect(getRouteTitle('/', bugs)).toBe('Overview · BugPilot')
    expect(getRouteTitle('/bugs', bugs)).toBe('Bug log · BugPilot')
    expect(getRouteTitle('/bugs/new', bugs)).toBe('Report a bug · BugPilot')
    expect(getRouteTitle('/assistant', bugs)).toBe('Debug assistant · BugPilot')
  })

  it('names detail routes after the report and edit routes generically', () => {
    expect(getRouteTitle('/bugs/bug-2', bugs)).toBe(
      'Dark theme contrast on badges · BugPilot',
    )
    expect(getRouteTitle('/bugs/bug-1/edit', bugs)).toBe(
      'Edit bug report · BugPilot',
    )
  })

  it('falls back when the report is missing or the route is unknown', () => {
    expect(getRouteTitle('/bugs/nope', bugs)).toBe(
      'Report not found · BugPilot',
    )
    expect(getRouteTitle('/nowhere', bugs)).toBe('Page not found · BugPilot')
  })

  it('ignores a trailing slash', () => {
    expect(getRouteTitle('/bugs/', bugs)).toBe('Bug log · BugPilot')
  })
})
