// Router harness for stories and portable-story tests: components using
// <Link>/<useNavigate> need a live RouterProvider. The memory router mounts
// the story at `/` and accepts /note/$ links without rendering anything for
// them.

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function withRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{children}</>,
  })
  const note = createRoute({
    getParentRoute: () => rootRoute,
    path: '/note/$',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, note]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return <RouterProvider router={router as never} />
}
