import type { FormEvent } from "react"
import { useId, useState } from "react"
import { EyeIcon, EyeOffIcon, RadioTowerIcon } from "lucide-react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { defaultConsolePage } from "@/lib/console-pages"
import { login } from "@/lib/auth"

export default function LoginPage({
  authenticated,
  onLogin,
}: {
  authenticated: boolean
  onLogin: () => void
}) {
  const accountId = useId()
  const passwordId = useId()
  const location = useLocation()
  const navigate = useNavigate()
  const [account, setAccount] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const redirectTo = getRedirectPath(location.state)

  if (authenticated) return <Navigate replace to={redirectTo} />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)
    try {
      await login(account, password)
      onLogin()
      navigate(redirectTo, { replace: true })
    } catch (loginError) {
      const message =
        loginError instanceof Error
          ? loginError.message
          : "登录失败，请稍后重试"
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <RadioTowerIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-medium">即应推送服务</h1>
            <p className="text-sm text-muted-foreground">管理控制面板</p>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor={accountId}>账号</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      aria-invalid={Boolean(error)}
                      autoComplete="username"
                      autoFocus
                      disabled={pending}
                      id={accountId}
                      onChange={(event) => {
                        setAccount(event.target.value)
                        setError("")
                      }}
                      placeholder="请输入管理员账号"
                      value={account}
                    />
                  </InputGroup>
                </Field>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor={passwordId}>密码</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      aria-invalid={Boolean(error)}
                      autoComplete="current-password"
                      disabled={pending}
                      id={passwordId}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setError("")
                      }}
                      placeholder="请输入管理员密码"
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        aria-pressed={showPassword}
                        disabled={pending}
                        onClick={() => setShowPassword((value) => !value)}
                        size="icon-xs"
                        type="button"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button className="w-full" disabled={pending} type="submit">
                {pending ? "登录中..." : "登录"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                前端预览阶段，输入任意非空账号和密码即可登录
              </p>
            </CardFooter>
          </Card>
        </form>
      </div>
    </main>
  )
}

function getRedirectPath(state: unknown) {
  const from = (
    state as { from?: { pathname?: string; search?: string } } | null
  )?.from
  if (!from?.pathname || from.pathname === "/login") return defaultConsolePage
  return `${from.pathname}${from.search ?? ""}`
}
