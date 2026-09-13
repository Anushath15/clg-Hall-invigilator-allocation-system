import { useState, useRef } from "react"
import { cn } from "../lib/utils"

interface TooltipProps {
  content: string
  children: React.ReactNode
  disabled?: boolean
}

export default function Tooltip({ content, children, disabled }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  if (!content || !disabled) return <>{children}</>

  return (
    <div className="relative inline-block" ref={ref}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-1.5 whitespace-nowrap shadow-xl max-w-[200px] text-center">
            {content}
          </div>
          <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}
