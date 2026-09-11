import { SidebarInset } from "@/components/ui/sidebar"

export function ProjectEmptyPage() {
  return (
    <SidebarInset className="min-w-0 overflow-hidden bg-muted">
      <div className="flex flex-1 items-center justify-center self-stretch text-sm text-muted-foreground">
        选择一个项目查看详情
      </div>
    </SidebarInset>
  )
}
