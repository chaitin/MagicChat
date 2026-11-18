import { ChevronRight, Loader2Icon, UsersRound } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { ContactUser } from "@/lib/client-data-api"

export function OrganizationMembersPanel({
  title,
  members,
  loading,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  onSelect,
}: {
  title: string
  members: (ContactUser & { jobTitle?: string })[]
  loading: boolean
  error: string
  hasMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onSelect: (member: ContactUser) => void
}) {
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col"
      aria-label="组织成员"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
        <UsersRound className="size-5 text-muted-foreground" />
        <h2 className="min-w-0 truncate text-base font-medium">{title}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <div
            role="alert"
            className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground"
          >
            {error}
            <Button variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : loading && members.length === 0 ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
          >
            <Loader2Icon className="size-4 animate-spin" />
            加载成员…
          </div>
        ) : members.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            暂无成员
          </p>
        ) : (
          <ul className="mx-auto grid max-w-4xl gap-1">
            {members.map((member) => (
              <li key={member.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onSelect(member)}
                  type="button"
                  aria-label={`查看 ${member.name} 的资料`}
                >
                  <Avatar className="size-10 rounded-lg after:rounded-lg">
                    {member.avatar && (
                      <AvatarImage src={member.avatar} alt={member.name} />
                    )}
                    <AvatarFallback className="rounded-lg">
                      {Array.from(member.name.trim())[0] || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.name}
                    </span>
                    {member.jobTitle && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {member.jobTitle}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && !error && (
          <div className="flex justify-center py-4">
            <Button disabled={loading} variant="ghost" onClick={onLoadMore}>
              {loading ? "加载中…" : "加载更多成员"}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
