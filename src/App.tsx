import { lazy, Suspense } from 'react'
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/layout/AppLayout'
import Home from '@/pages/Home'
import NotFound from '@/pages/NotFound'
import ToolPage from '@/pages/ToolPage'
import ToolsIndex from '@/pages/Tools'

// 《临江仙 · 江湖》：独立的水墨长卷页，不套工具站布局，按需加载
const Jianghu = lazy(() => import('@/pages/jianghu'))

const routes = [
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/tools', element: <ToolsIndex /> },
      { path: '/t/:id', element: <ToolPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/jianghu',
    element: (
      <ErrorBoundary>
        <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
          <Jianghu />
        </Suspense>
      </ErrorBoundary>
    ),
  },
]

// 静态托管（npm run build:static）没有 SPA 回退，用 #/ 路由保证深链可直接打开
const router =
  import.meta.env.VITE_HASH_ROUTER === '1' ? createHashRouter(routes) : createBrowserRouter(routes)

export default function App() {
  return <RouterProvider router={router} />
}
