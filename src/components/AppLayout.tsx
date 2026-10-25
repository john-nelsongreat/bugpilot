import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  AlertTriangle,
  Bug,
  ClipboardList,
  Info,
  LayoutDashboard,
  Moon,
  Plus,
  Stethoscope,
  Sun,
} from 'lucide-react'
import { getRouteTitle } from '../app/routeTitle'
import { useWorkspace } from '../app/useWorkspace'
import { getFooterPageKey } from '../features/footer/footerJoke'
import { useTheme } from '../features/theme/useTheme'
import { FooterJoke } from './FooterJoke'
import { Toast } from './Toast'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/bugs', label: 'Bug log', icon: ClipboardList, end: false },
  { to: '/assistant', label: 'Assistant', icon: Stethoscope, end: false },
] as const

type AppLayoutProps = {
  footerJokeRandom?: () => number
  footerJokeIntervalMs?: number
}

export function AppLayout({
  footerJokeRandom,
  footerJokeIntervalMs,
}: AppLayoutProps = {}) {
  const { bugs, seeded, issue, toast, dismissToast } = useWorkspace()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const footerPageKey = getFooterPageKey(location.pathname)
  const routeTitle = getRouteTitle(location.pathname, bugs)
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const themeLabel = `Switch to ${nextTheme} theme`

  useEffect(() => {
    document.title = routeTitle
  }, [routeTitle])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="sidebar-header">
          <Link to="/" className="brand" aria-label="BugPilot home">
            <span className="brand-mark" aria-hidden="true">
              <Bug size={21} strokeWidth={2.1} />
            </span>
            <span className="brand-word">BugPilot</span>
          </Link>

          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? 'nav-link is-active' : 'nav-link'
                }
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <Link to="/bugs/new" className="button button--primary sidebar-action">
          <Plus size={17} aria-hidden="true" />
          Report a bug
        </Link>

        <div className="sidebar-footer">
          <p className="local-note">
            <span className="local-dot" aria-hidden="true" />
            Local-only workspace
          </p>
          <p className="local-copy">
            Reports stay in this browser. Nothing is uploaded.
          </p>
        </div>
      </aside>

      <div className="content-column">
        <main id="main-content" className="main-content" tabIndex={-1}>
          {issue ? (
            <div className="notice notice--alert" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>Saved data needs attention</strong>
                <p>{issue.message}</p>
              </div>
            </div>
          ) : null}

          {seeded ? (
            <div className="notice notice--sample" role="status">
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>Sample workspace loaded.</strong>
                <p>
                  These fictional reports are here so you can try the workflow.
                  Edit or delete them whenever you like.
                </p>
              </div>
            </div>
          ) : null}

          <Outlet />
        </main>

        <footer className="content-footer">
          <span>BugPilot</span>
          <span className="footer-rule" aria-hidden="true" />
          <span>Local bug log · no account, no network</span>
          <FooterJoke
            key={`${footerPageKey}:${location.key}`}
            pageKey={footerPageKey}
            random={footerJokeRandom}
            intervalMs={footerJokeIntervalMs}
          />
        </footer>
      </div>

      {toast ? <Toast toast={toast} onDismiss={dismissToast} /> : null}
    </div>
  )
}
