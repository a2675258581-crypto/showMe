import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import Home from '@/pages/Home'
import NotFound from '@/pages/NotFound'
import ToolPage from '@/pages/ToolPage'
import ToolsIndex from '@/pages/Tools'

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/tools', element: <ToolsIndex /> },
      { path: '/t/:id', element: <ToolPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
