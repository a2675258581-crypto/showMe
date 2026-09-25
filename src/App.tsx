import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import Home from '@/pages/Home'
import NotFound from '@/pages/NotFound'
import ToolPage from '@/pages/ToolPage'
import ToolsIndex from '@/pages/Tools'

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
]

// 静态托管（npm run build:static）没有 SPA 回退，用 #/ 路由保证深链可直接打开
const router =
  import.meta.env.VITE_HASH_ROUTER === '1' ? createHashRouter(routes) : createBrowserRouter(routes)

export default function App() {
  return <RouterProvider router={router} />
}
