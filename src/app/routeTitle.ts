import type { Bug } from '../features/bugs/types'

const APP_NAME = 'BugPilot'

type TitleSource = Pick<Bug, 'id' | 'title'>

export function getRouteTitle(
  pathname: string,
  bugs: readonly TitleSource[],
): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const detail = /^\/bugs\/([^/]+)$/.exec(path)
  const edit = /^\/bugs\/([^/]+)\/edit$/.exec(path)
  let label: string

  if (path === '/') label = 'Overview'
  else if (path === '/bugs') label = 'Bug log'
  else if (path === '/bugs/new') label = 'Report a bug'
  else if (path === '/assistant') label = 'Debug assistant'
  else if (edit) label = 'Edit bug report'
  else if (detail) {
    const report = bugs.find((bug) => bug.id === detail[1])
    label = report ? report.title : 'Report not found'
  } else label = 'Page not found'

  return `${label} · ${APP_NAME}`
}
