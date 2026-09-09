import { ServerIcon } from "lucide-react"

export const consolePages = [
  {
    icon: <ServerIcon />,
    label: "服务器",
    path: "/servers",
    title: "服务器",
  },
] as const

export const defaultConsolePage = consolePages[0].path

export function getConsolePage(pathname: string) {
  return consolePages.find((page) => page.path === pathname) ?? consolePages[0]
}
