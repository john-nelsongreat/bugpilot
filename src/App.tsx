import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { WorkspaceProvider } from './app/WorkspaceContext'
import { AppLayout } from './components/AppLayout'
import { AssistantPage } from './pages/AssistantPage'
import { BugDetailPage } from './pages/BugDetailPage'
import { BugFormPage } from './pages/BugFormPage'
import { BugListPage } from './pages/BugListPage'
import { DashboardPage } from './pages/DashboardPage'
import { NotFoundPage } from './pages/NotFoundPage'
import './App.css'

const AnalyzePage = lazy(() =>
  import('./pages/AnalyzePage').then((module) => ({ default: module.AnalyzePage })),
)

const configuredJokeInterval = Number(
  import.meta.env.VITE_FOOTER_JOKE_INTERVAL_MS,
)
const footerJokeIntervalMs =
  Number.isFinite(configuredJokeInterval) && configuredJokeInterval > 0
    ? configuredJokeInterval
    : undefined

function App() {
  return (
    <WorkspaceProvider>
      <Routes>
        <Route
          element={<AppLayout footerJokeIntervalMs={footerJokeIntervalMs} />}
        >
          <Route index element={<DashboardPage />} />
          <Route path="bugs" element={<BugListPage />} />
          <Route path="bugs/new" element={<BugFormPage />} />
          <Route path="bugs/:bugId" element={<BugDetailPage />} />
          <Route path="bugs/:bugId/edit" element={<BugFormPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route
            path="analyze"
            element={
              <Suspense
                fallback={
                  <div className="panel empty-state">
                    <p role="status">Loading the analyzer…</p>
                  </div>
                }
              >
                <AnalyzePage />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </WorkspaceProvider>
  )
}

export default App
