import { useEffect } from "react"
import { Loader } from "@/components/motion/loader"
import { TextShimmer } from "@/components/motion/text-shimmer"
import { Card, CardContent } from "@/components/ui/card"
import { PoweredBy } from "@/components/powered-by"
import type { AuthProblem, AuthResult } from "../../../shared/auth"

export function SigningInPage({
  targetId,
  onComplete,
  onFailure,
  loadingOnly = false,
}: {
  targetId?: string
  onComplete?: () => void
  onFailure?: (error: AuthProblem) => void
  loadingOnly?: boolean
}) {
  useEffect(() => {
    if (loadingOnly || !targetId || !onComplete || !onFailure) return
    const initializationTarget = targetId
    const complete = onComplete
    const fail = onFailure
    let cancelled = false
    const minimumDisplay = new Promise<void>((resolve) => window.setTimeout(resolve, 3_000))

    async function initialize() {
      let result: AuthResult<null>
      try {
        result = window.desktop
          ? await window.desktop.accountData.initialize(initializationTarget)
          : { ok: false, error: { code: "bridge", message: "桌面服务暂不可用，请重试" } }
      } catch {
        result = { ok: false, error: { code: "bridge", message: "桌面服务暂不可用，请重试" } }
      }
      await minimumDisplay
      if (cancelled) return
      if (result.ok) complete()
      else fail(result.error)
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [loadingOnly, onComplete, onFailure, targetId])

  return (
    <main className="login-page login-page--shader">
      <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-foreground md:p-10">
        <div className="flex items-center justify-center">
          <Card size="sm" className="w-full max-w-sm">
            <CardContent className="flex min-h-36 flex-col items-center justify-center gap-6 text-center">
              <Loader
                variant="dither"
                size={64}
                speed={2}
                label="正在加载在线数据"
                className="text-muted-foreground"
              />
              <TextShimmer as="h1" className="text-base font-normal">
                正在加载在线数据
              </TextShimmer>
            </CardContent>
          </Card>
        </div>
        <PoweredBy />
      </div>
    </main>
  )
}
