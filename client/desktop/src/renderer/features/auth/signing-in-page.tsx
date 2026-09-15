import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Card, CardContent } from "@/components/ui/card"
import { PoweredBy } from "@/components/powered-by"

export function SigningInPage() {
  return (
    <main className="login-page login-page--shader">
      <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-neutral-800 md:p-10">
        <div className="flex items-center justify-center">
          <Card className="w-full max-w-sm">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
              <HugeiconsIcon
                icon={Loading03Icon}
                className="size-7 animate-spin text-muted-foreground"
                aria-hidden
              />
              <h1 className="text-lg font-medium">正在登录</h1>
            </CardContent>
          </Card>
        </div>
        <PoweredBy />
      </div>
    </main>
  )
}
