// shadcn login-03：保留官方单栏 CardHeader/Field 结构；仅适配即应认证。
import type { ComponentProps, ReactNode } from "react"
import { cn } from "cn"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Login03Icon,
  Loading03Icon,
  Tick02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { ActionSwapText } from "@/components/motion/action-swap"
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs"
import { useLoginForm, type LoginFormProps } from "@/features/auth/login-form"

export function LoginFrame({
  className,
  children,
  footer,
  heading = "欢迎登录即应",
  description,
  ...props
}: ComponentProps<"div"> & { footer?: ReactNode; heading?: string; description?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} data-block="login-03" {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-lg" role="heading" aria-level={1}>
            {heading}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer}
    </div>
  )
}

export function LoginForm(props: LoginFormProps) {
  const form = useLoginForm(props)
  const { connection, isPreview } = props
  const { method, password, pending, problem } = form

  return (
    <LoginFrame heading={`登录到 ${connection.info.organizationName}`}>
      <form
        id="login-form"
        onSubmit={form.submit}
        noValidate
        aria-label={password ? "密码登录表单" : "验证码登录表单"}
        aria-busy={Boolean(pending)}
      >
        <FieldGroup>
          {method && (
            <>
              {connection.info.emailCodeLoginEnabled && connection.info.passwordLoginEnabled && (
                <>
                  <Tabs
                    value={method}
                    onValueChange={(value) => form.changeMethod(value as "email-code" | "password")}
                    className="w-full"
                  >
                    <TabsList
                      className="w-full bg-muted [&>div]:flex-1 [&_[role=tab]]:w-full"
                      aria-label="登录方式"
                    >
                      <TabsTrigger value="email-code" disabled={Boolean(pending)}>
                        验证码登录
                      </TabsTrigger>
                      <TabsTrigger value="password" disabled={Boolean(pending)}>
                        密码登录
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </>
              )}
              <Field data-invalid={problem?.code === "email" || undefined}>
                <FieldLabel htmlFor="login-email">邮箱</FieldLabel>
                <BeInput
                  ref={form.emailInput}
                  id="login-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={form.changeEmail}
                  disabled={Boolean(pending)}
                  placeholder="example@jiying.chat"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={254}
                  error={problem?.code === "email"}
                  aria-describedby={problem ? "login-problem" : undefined}
                />
              </Field>
              <Field data-invalid={problem?.code === "secret" || undefined}>
                <FieldLabel htmlFor="login-secret">{password ? "密码" : "验证码"}</FieldLabel>
                <div className="relative">
                  <BeInput
                    ref={form.secretInput}
                    id="login-secret"
                    name={password ? "password" : "code"}
                    type={password && !form.visible ? "password" : "text"}
                    value={form.secret}
                    onChange={form.changeSecret}
                    disabled={Boolean(pending)}
                    placeholder={password ? "输入密码" : "输入 8 位验证码"}
                    autoComplete={password ? "current-password" : "one-time-code"}
                    inputMode={password ? undefined : "numeric"}
                    maxLength={password ? 4096 : undefined}
                    error={problem?.code === "secret"}
                    aria-describedby={problem ? "login-problem" : undefined}
                    classNames={{ input: password ? "pr-10" : "pr-28" }}
                  />
                  {!password ? (
                    <BeButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-1/2 right-1 h-8 -translate-y-1/2 rounded-md px-2 text-primary hover:bg-transparent hover:text-primary"
                      disabled={
                        isPreview || Boolean(pending) || form.remaining > 0 || !form.email.trim()
                      }
                      onClick={() => void form.operate("code")}
                    >
                      {pending === "code" && (
                        <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
                      )}
                      {pending === "code"
                        ? "发送中"
                        : form.remaining
                          ? `${form.remaining} 秒后重发`
                          : "获取验证码"}
                    </BeButton>
                  ) : (
                    <BeButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-primary"
                      aria-label={form.visible ? "隐藏密码" : "显示密码"}
                      aria-pressed={form.visible}
                      disabled={Boolean(pending)}
                      onClick={() => form.setVisible(!form.visible)}
                    >
                      {form.visible ? (
                        <HugeiconsIcon icon={ViewOffSlashIcon} aria-hidden />
                      ) : (
                        <HugeiconsIcon icon={ViewIcon} aria-hidden />
                      )}
                    </BeButton>
                  )}
                </div>
              </Field>
              {(problem || form.notice) && (
                <div aria-live="polite" className="space-y-2">
                  {problem && <FieldError id="login-problem">{problem.message}</FieldError>}
                  {form.notice && (
                    <FieldDescription className="flex items-start gap-2">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden
                      />
                      {form.notice}
                    </FieldDescription>
                  )}
                </div>
              )}
              <Field>
                <BeButton
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full rounded-md"
                  disabled={isPreview || Boolean(pending)}
                  aria-label={pending === "login" ? "正在登录" : "登录"}
                >
                  {pending === "login" && (
                    <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
                  )}
                  <ActionSwapText value={pending === "login" ? "pending" : "ready"}>
                    {pending === "login" ? "正在登录" : "登录"}
                  </ActionSwapText>
                </BeButton>
              </Field>
            </>
          )}
          {!method && (problem || form.notice) && (
            <div aria-live="polite" className="space-y-2">
              {problem && <FieldError id="login-problem">{problem.message}</FieldError>}
              {form.notice && <FieldDescription>{form.notice}</FieldDescription>}
            </div>
          )}
          {connection.info.thirdPartyProviders.length > 0 && (
            <div className="flex flex-col gap-4">
              <Marker variant="separator" className="text-xs">
                <MarkerContent>其他登录方式</MarkerContent>
              </Marker>
              <div className="flex flex-col gap-2">
                {connection.info.thirdPartyProviders.map((provider) => {
                  const providerPending = form.pendingProvider === provider.key
                  return (
                    <BeButton
                      key={provider.key}
                      type="button"
                      variant="outline"
                      size="md"
                      className="w-full rounded-md"
                      disabled={isPreview || Boolean(pending)}
                      onClick={() => void form.signInWithThirdParty(provider.key)}
                    >
                      <HugeiconsIcon
                        icon={providerPending ? Loading03Icon : Login03Icon}
                        className={providerPending ? "animate-spin" : undefined}
                        aria-hidden
                      />
                      {providerPending ? "正在登录" : `使用 ${provider.name} 登录`}
                    </BeButton>
                  )
                })}
              </div>
            </div>
          )}
        </FieldGroup>
      </form>
    </LoginFrame>
  )
}
