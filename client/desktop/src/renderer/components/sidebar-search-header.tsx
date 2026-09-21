import {
  CirclePlusIcon,
  RefreshIcon,
  Search01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function SidebarSearchHeader({
  value,
  searchLabel,
  onValueChange,
  onCreateGroup,
  onCreateApp,
  onRefresh,
}: {
  value: string
  searchLabel: string
  onValueChange: (value: string) => void
  onCreateGroup: () => void
  onCreateApp: () => void
  onRefresh: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-xgui-background-0 pr-2 pl-3">
      <BeInput
        type="search"
        value={value}
        placeholder="搜索"
        aria-label={searchLabel}
        leftIcon={<HugeiconsIcon icon={Search01Icon} aria-hidden />}
        classNames={{
          root: "min-w-0 flex-1",
          field: "h-8 rounded-full border-transparent bg-background",
          input: "pl-9 text-sm",
        }}
        onChange={onValueChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BeButton
            type="button"
            variant="ghost"
            size="icon"
            pressScale={1}
            whileHover={{ scale: 1 }}
            className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-5"
            aria-label="更多操作"
            title="更多操作"
          >
            <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
          </BeButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onCreateGroup}>
            <HugeiconsIcon icon={UserMultiple02Icon} aria-hidden />
            创建群聊
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCreateApp}>
            <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
            创建应用
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRefresh}>
            <HugeiconsIcon icon={RefreshIcon} aria-hidden />
            刷新
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
