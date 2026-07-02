import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()

  return {
    get length() {
      return items.size
    },
    clear: () => {
      items.clear()
    },
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => {
      items.delete(key)
    },
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
})

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
    writable: true,
  })
}

if (!window.ResizeObserver) {
  class ResizeObserverMock implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverMock,
  })
}

afterEach(() => {
  cleanup()
})
