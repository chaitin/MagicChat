import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

type OverlayEntry = { id: number; content: ReactNode; priority: number }
type OverlayContextValue = {
  remove: (id: number) => void
  upsert: (entry: OverlayEntry) => void
}

const OverlayContext = createContext<OverlayContextValue | null>(null)
let nextOverlayId = 0

export function XGUIOverlayHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<OverlayEntry[]>([])
  const upsert = useCallback((entry: OverlayEntry) => {
    setEntries((current) => {
      const index = current.findIndex((item) => item.id === entry.id)
      if (index < 0) return [...current, entry]
      const updated = [...current]
      updated[index] = entry
      return updated
    })
  }, [])
  const remove = useCallback((id: number) => {
    setEntries((current) => current.filter((item) => item.id !== id))
  }, [])
  const value = useMemo(() => ({ remove, upsert }), [remove, upsert])
  const sortedEntries = [...entries].sort((a, b) => a.priority - b.priority)

  return (
    <OverlayContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {sortedEntries.map((entry, index) => (
          <View key={entry.id} pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: index + 1 }]}>
            {entry.content}
          </View>
        ))}
      </View>
    </OverlayContext.Provider>
  )
}

export function XGUIOverlay({ children, priority = 0 }: { children: ReactNode; priority?: number }) {
  const context = useContext(OverlayContext)
  if (!context) throw new Error("XGUIOverlay must be used within XGUIOverlayHost")
  const [id] = useState(() => ++nextOverlayId)

  useLayoutEffect(() => {
    context.upsert({ content: children, id, priority })
  }, [children, context, id, priority])
  useLayoutEffect(() => () => context.remove(id), [context, id])

  return null
}

const styles = StyleSheet.create({ root: { flex: 1 } })
