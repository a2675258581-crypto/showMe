import { Link } from 'react-router-dom'
import { motion } from 'motion/react'

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        className="headline text-gradient-rainbow animate-gradient-pan text-[120px]"
      >
        404
      </motion.div>
      <p className="mt-2 text-xl font-semibold text-fg">这个页面去远方了。</p>
      <p className="mt-2 text-fg-2">也许你要找的工具换了名字，试试搜索吧。</p>
      <Link
        to="/tools"
        className="mt-8 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
      >
        浏览全部工具
      </Link>
    </div>
  )
}
