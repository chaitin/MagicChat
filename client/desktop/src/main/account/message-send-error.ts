export function messageSendErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : ""

  switch (code) {
    case "timeout":
    case "http_408":
    case "http_504":
      return "发送超时，请先确认消息是否已送达，再尝试重发"
    case "network":
      return "网络连接异常，请检查网络后重试"
    case "unauthorized":
    case "not_authenticated":
    case "invalid_session":
    case "expired_session":
    case "session_expired":
    case "http_401":
      return "登录状态已失效，请重新登录后重试"
    case "forbidden":
    case "http_403":
      return "当前没有发送权限，请确认会话状态后重试"
    case "direct_friendship_required":
      return "请先添加对方为好友后再发送消息"
    case "direct_message_unavailable":
      return "对方当前无法接收消息"
    case "not_found":
    case "invalid_conversation":
    case "source_unavailable":
    case "content_unavailable":
    case "http_404":
      return "会话或消息已不可用，请刷新后重试"
    case "conflict":
    case "http_409":
      return "消息状态已变化，请刷新会话后重试"
    case "rate_limited":
    case "http_429":
      return "发送过于频繁，请稍后重试"
    case "request_too_large":
    case "http_413":
      return "消息或附件超出大小限制，请缩小后重试"
    case "invalid_request":
    case "invalid_message_content":
    case "invalid_message_type":
    case "invalid_reply_message":
    case "invalid_caption":
    case "unsupported_message":
    case "http_400":
    case "http_422":
      return "消息内容或引用不符合发送要求，请检查后重试"
    case "invalid_file":
    case "invalid_image":
    case "invalid_video":
    case "file_unavailable":
    case "media_not_found":
      return "附件无法读取或不符合发送要求，请重新选择"
    case "invalid_response":
    case "response_too_large":
      return "服务端响应异常，请刷新会话确认消息状态"
    case "account_not_ready":
      return "账号尚未就绪，请稍后重试"
    case "internal_error":
      return "服务端暂时不可用，请稍后重试"
  }

  if (/^http_5\d\d$/.test(code)) return "服务端暂时不可用，请稍后重试"
  if (/^(?:ERR_SQLITE|SQLITE_)/.test(code)) return "本地消息保存异常，请检查存储空间后重试"
  return "发生未知错误，请稍后重试"
}
