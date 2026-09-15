import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  normalizeEmail,
  resolveLoginMethod,
  type AuthProblem,
  type Connection,
  type LoginMethod,
  type SignInResult,
} from "../../../shared/auth"

export type LoginFormProps = {
  connection: Connection
  isPreview: boolean
  onSignedIn: (result: SignInResult) => void
  onBusyChange: (busy: boolean) => void
}

export function useLoginForm({ connection, onSignedIn, onBusyChange }: LoginFormProps) {
  const { showToast } = useAnimatedToast()
  const [preferred, setPreferred] = useState<LoginMethod>(
    connection.savedLogin?.method ?? "email-code",
  )
  const [email, setEmail] = useState(connection.savedLogin?.email ?? "")
  const [secret, setSecret] = useState(() =>
    resolveLoginMethod(connection.info, connection.savedLogin?.method ?? "email-code") ===
    "password"
      ? (connection.savedLogin?.password ?? "")
      : "",
  )
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState<"login" | "code" | "third-party" | null>(null)
  const [pendingProvider, setPendingProvider] = useState("")
  const [problem, setProblem] = useState<AuthProblem | null>(null)
  const [retry, setRetry] = useState({ email: "", until: 0 })
  const [now, setNow] = useState(Date.now)
  const flight = useRef(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const secretInput = useRef<HTMLInputElement>(null)
  const method = resolveLoginMethod(connection.info, preferred)
  const password = method === "password"
  const remaining =
    retry.email === email.trim().toLowerCase()
      ? Math.max(0, Math.ceil((retry.until - now) / 1000))
      : 0

  useEffect(() => {
    if (retry.until <= Date.now()) return
    const timer = window.setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= retry.until) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [retry])

  function fail(error: AuthProblem) {
    setProblem(error)
    showToast({ status: "error", title: error.message })
    if (error.retryAfterSeconds) {
      const time = Date.now()
      setNow(time)
      setRetry({ email: email.trim().toLowerCase(), until: time + error.retryAfterSeconds * 1000 })
    }
  }

  async function operate(kind: "login" | "code") {
    if (flight.current || !window.desktop || !method) return
    setProblem(null)
    let account: string
    try {
      account = normalizeEmail(email)
    } catch {
      fail({ code: "email", message: "请输入有效的邮箱地址" })
      emailInput.current?.focus()
      return
    }
    if (kind === "login") {
      if (password ? !secret : !/^\d{8}$/.test(secret)) {
        fail({ code: "secret", message: password ? "请输入密码" : "请输入 8 位数字验证码" })
        secretInput.current?.focus()
        return
      }
    } else if (remaining > 0) return
    flight.current = true
    setPending(kind)
    onBusyChange(true)
    try {
      if (kind === "code") {
        const result = await window.desktop.auth.sendCode({
          targetId: connection.targetId,
          email: account,
        })
        if (!result.ok) {
          fail(result.error)
          return
        }
        const time = Date.now()
        setNow(time)
        setRetry({
          email: account.toLowerCase(),
          until: time + result.data.retryAfterSeconds * 1000,
        })
        showToast({ status: "success", title: "验证码已发送" })
      } else {
        const result = await window.desktop.auth.signIn({
          targetId: connection.targetId,
          method,
          email: account,
          secret,
        })
        if (!result.ok) {
          fail(result.error)
          return
        }
        setSecret("")
        onSignedIn(result.data)
      }
    } catch {
      fail({ code: "bridge", message: "桌面服务暂不可用，请重试" })
    } finally {
      flight.current = false
      setPending(null)
      onBusyChange(false)
    }
  }

  async function signInWithThirdParty(providerKey: string) {
    if (flight.current || !window.desktop) return
    const provider = connection.info.thirdPartyProviders.find((item) => item.key === providerKey)
    if (!provider) {
      fail({ code: "invalid_provider", message: "第三方登录方式不存在或已停用" })
      return
    }
    flight.current = true
    setPending("third-party")
    setPendingProvider(providerKey)
    setProblem(null)
    onBusyChange(true)
    try {
      const result = await window.desktop.auth.signInThirdParty({
        targetId: connection.targetId,
        providerKey,
      })
      if (!result.ok) {
        fail(result.error)
        return
      }
      onSignedIn(result.data)
    } catch {
      fail({ code: "bridge", message: "桌面服务暂不可用，请重试" })
    } finally {
      flight.current = false
      setPending(null)
      setPendingProvider("")
      onBusyChange(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void operate("login")
  }

  function changeMethod(value: LoginMethod) {
    setPreferred(value)
    setSecret("")
    setVisible(false)
    setProblem(null)
  }

  function changeEmail(value: string) {
    setEmail(value)
    setSecret("")
    setProblem(null)
  }

  function changeSecret(value: string) {
    // 先清理粘贴内容再截取 8 位，不让原生 maxLength 提前截掉有效数字。
    setSecret(password ? value : value.replace(/\D/g, "").slice(0, 8))
    setProblem(null)
  }

  return {
    email,
    secret,
    visible,
    pending,
    pendingProvider,
    problem,
    method,
    password,
    remaining,
    emailInput,
    secretInput,
    submit,
    operate,
    signInWithThirdParty,
    changeMethod,
    changeEmail,
    changeSecret,
    setVisible,
  }
}
