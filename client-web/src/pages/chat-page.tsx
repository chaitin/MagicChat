import * as React from "react"
import { Plus, Search, Send } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

type ConversationKind = "assistant" | "user"
type MessageRole = "me" | "other" | "assistant"

type Conversation = {
  id: string
  kind: ConversationKind
  name: string
  description: string
  avatar: string
  image?: string
  unread?: number
}

type ChatMessage = {
  id: string
  conversationId: string
  role: MessageRole
  author: string
  content: string
  time: string
}

const conversations: Conversation[] = [
  {
    id: "assistant",
    kind: "assistant",
    name: "AI 助手",
    description: "你的内置工作助理",
    avatar: "AI",
    unread: 1,
  },
  {
    id: "wenlei",
    kind: "user",
    name: "Wenlei Zhu",
    description: "产品负责人",
    avatar: "W",
  },
  {
    id: "yalan",
    kind: "user",
    name: "yalan Fu",
    description: "运营协作",
    avatar: "Y",
  },
]

const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    conversationId: "assistant",
    role: "assistant",
    author: "AI 助手",
    content:
      "你好，我是你的内置 AI 助手。你可以先把问题发给我，我会帮你整理思路、草拟回复或记录待办。",
    time: "09:30",
  },
  {
    id: "m2",
    conversationId: "wenlei",
    role: "other",
    author: "Wenlei Zhu",
    content: "登录页确认后，我们可以先把聊天主界面跑起来。",
    time: "10:12",
  },
  {
    id: "m3",
    conversationId: "yalan",
    role: "other",
    author: "yalan Fu",
    content: "我这边后面可以帮忙验证任务列表的交互。",
    time: "10:28",
  },
]

function getMessageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date())
}

export function ChatPage() {
  const [activeConversationId, setActiveConversationId] =
    React.useState("assistant")
  const [messages, setMessages] = React.useState(initialMessages)
  const [draft, setDraft] = React.useState("")

  const activeConversation = React.useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? conversations[0],
    [activeConversationId]
  )

  const activeMessages = React.useMemo(
    () =>
      messages.filter(
        (message) => message.conversationId === activeConversation.id
      ),
    [activeConversation.id, messages]
  )

  function sendMessage() {
    const content = draft.trim()
    if (!content) {
      return
    }

    const time = getMessageTime()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: activeConversation.id,
      role: "me",
      author: "我",
      content,
      time,
    }

    const nextMessages = [userMessage]

    if (activeConversation.kind === "assistant") {
      nextMessages.push({
        id: crypto.randomUUID(),
        conversationId: activeConversation.id,
        role: "assistant",
        author: "AI 助手",
        content:
          "收到，我会先作为你的内置助手处理这个请求。当前版本是前端原型，后续会接入真实模型、工具调用和权限策略。",
        time,
      })
    }

    setMessages((currentMessages) => [...currentMessages, ...nextMessages])
    setDraft("")
  }

  return (
    <>
      <aside className="flex w-72 shrink-0 flex-col border-r bg-background">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base font-medium">消息</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="新建 Agent"
                size="icon-sm"
                title="新建 Agent"
                type="button"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem>发起群聊</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索" type="search" />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ItemGroup className="gap-1 px-2 pb-3 has-data-[size=sm]:gap-1">
            {conversations.map((conversation) => {
              const selected = conversation.id === activeConversation.id

              return (
                <Item
                  asChild
                  key={conversation.id}
                  size="sm"
                  className={cn(
                    "min-h-16 flex-nowrap px-2 py-2",
                    selected
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <Button
                    className="h-auto justify-start whitespace-normal"
                    type="button"
                    onClick={() => setActiveConversationId(conversation.id)}
                    variant="ghost"
                  >
                    <ItemMedia>
                      <Avatar className="size-9 rounded-sm bg-muted after:rounded-sm">
                        {conversation.image && (
                          <AvatarImage
                            alt={conversation.name}
                            className="rounded-sm"
                            src={conversation.image}
                          />
                        )}
                        <AvatarFallback className="rounded-sm">
                          {conversation.avatar}
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full">
                        <span className="truncate">{conversation.name}</span>
                        {conversation.kind === "assistant" && (
                          <Badge variant="secondary" className="px-1.5">
                            AI
                          </Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="truncate text-xs">
                        {conversation.description}
                      </ItemDescription>
                    </ItemContent>
                    {conversation.unread ? (
                      <ItemActions>
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                          {conversation.unread}
                        </span>
                      </ItemActions>
                    ) : null}
                  </Button>
                </Item>
              )
            })}
          </ItemGroup>
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium">
              {activeConversation.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {activeConversation.description}
            </p>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-6">
            {activeMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                conversation={activeConversation}
              />
            ))}
          </div>
        </ScrollArea>

        <footer className="shrink-0 border-t p-4">
          <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="添加"
              className="shrink-0"
            >
              <Plus className="size-4" />
            </Button>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="输入消息，Enter 发送"
              className="max-h-40 min-h-10 resize-none"
            />
            <Button
              type="button"
              size="icon"
              aria-label="发送消息"
              className="shrink-0"
              onClick={sendMessage}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </footer>
      </main>
    </>
  )
}

function MessageBubble({
  message,
  conversation,
}: {
  message: ChatMessage
  conversation: Conversation
}) {
  const fromMe = message.role === "me"
  const assistant = message.role === "assistant"
  const fallback = fromMe ? "我" : assistant ? "AI" : conversation.avatar

  return (
    <div className={cn("flex gap-3", fromMe ? "justify-end" : "justify-start")}>
      {!fromMe && (
        <Avatar className="mt-1 size-8 rounded-sm bg-muted after:rounded-sm">
          <AvatarFallback className="rounded-sm">{fallback}</AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "flex max-w-[min(70%,42rem)] flex-col gap-1",
          fromMe && "items-end"
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{message.author}</span>
          <span>{message.time}</span>
        </div>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed shadow-xs",
            fromMe
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {message.content}
        </div>
      </div>
      {fromMe && (
        <Avatar className="mt-1 size-8 rounded-sm bg-muted after:rounded-sm">
          <AvatarFallback className="rounded-sm bg-primary text-primary-foreground">
            我
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}
