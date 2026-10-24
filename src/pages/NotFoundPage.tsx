import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="panel empty-state not-found">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The page you followed does not exist in this workspace.</p>
      <Link to="/" className="button button--primary">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to overview
      </Link>
    </div>
  )
}
