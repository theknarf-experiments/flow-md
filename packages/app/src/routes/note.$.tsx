// `/note/$` — the active note, addressed by its vault-relative path in the
// splat so URLs read like /note/docs/tasks.md.

import { createFileRoute } from '@tanstack/react-router'
import { NotePage } from '../components/NotePage.js'

export const Route = createFileRoute('/note/$')({
  component: Note,
})

function Note() {
  const { _splat } = Route.useParams()
  return <NotePage path={_splat ?? ''} />
}
