// 摘取并适配 beUI Action Swap 的 roll 文本与图标插槽。
// https://beui.dev/components/motion/action-swap
// 保留来源与 MIT 许可，见 THIRD_PARTY_NOTICES.md。
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const rollVariants: Variants = {
  initial: { opacity: 0, y: "90%", filter: "blur(3px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 460, damping: 30, mass: 0.55 },
  },
  exit: {
    opacity: 0,
    y: "-90%",
    filter: "blur(3px)",
    transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] },
  },
}

interface ActionSwapProps {
  value: string
  children: ReactNode
  className?: string
}

export function ActionSwapText({ value, children, className }: ActionSwapProps) {
  const reduce = useReducedMotion()
  if (reduce) return <span className={className}>{children}</span>

  return (
    <span className={cn("relative inline-block overflow-hidden align-bottom py-0.5", className)}>
      <span className="invisible whitespace-nowrap" aria-hidden>
        {children}
      </span>
      <span className="sr-only">{children}</span>
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          aria-hidden
          variants={rollVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="absolute top-0.5 left-0 whitespace-nowrap"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function ActionSwapIcon({ value, children, className }: ActionSwapProps) {
  const reduce = useReducedMotion()
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid size-4 shrink-0 place-items-center overflow-hidden",
        className,
      )}
    >
      {reduce ? (
        children
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            variants={rollVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="col-start-1 row-start-1 inline-flex"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  )
}
