import * as React from "react"
import { useNavigate } from "react-router"
import { Loader2Icon, Mail, Phone, UserPen, UserRound } from "lucide-react"
import { toast } from "sonner"

import { formatContactPhone } from "@/lib/contact-format"
import { useClientData } from "@/lib/client-data-context"
import {
  type ClientProfileContextValue,
  useClientCurrentUserId,
  useClientUserProfile,
  useClientUserRelationship,
  useOptionalClientProfileContext,
} from "@/lib/client-profile-context"
import {
  resolveClientUserRelationship,
  type ClientUserRelationship,
  type ClientUserRelationshipSource,
} from "@/lib/client-profile-store"
import { cn } from "@/lib/utils"
import { AvatarPreviewDialog } from "@/components/avatar-preview-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type UserProfilePopoverProps = {
  children: React.ReactNode
  fallbackProfile?: UserProfile | null
  triggerAriaLabel?: string
  triggerClassName?: string
  userId: string | null
}

export type UserProfile = {
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
}

type ProfileRelationshipActions = Pick<
  ClientProfileContextValue,
  "acceptFriendRequest" | "createFriendRequest"
>

type ProfileRelationshipSource = ClientUserRelationshipSource

export function UserProfilePopoverLink({
  profile,
  triggerClassName,
}: {
  profile: UserProfile
  triggerClassName?: string
}) {
  const displayName = getUserDisplayName(profile)

  return (
    <UserProfilePopover
      fallbackProfile={profile}
      triggerAriaLabel={`${displayName}资料`}
      triggerClassName={cn(
        "max-w-full truncate transition-colors hover:text-(--weui-link) focus-visible:text-(--weui-link) data-[state=open]:text-(--weui-link)",
        triggerClassName
      )}
      userId={profile.id}
    >
      <span className="truncate">{displayName}</span>
    </UserProfilePopover>
  )
}

export function UserProfilePopover(props: UserProfilePopoverProps) {
  const profileContext = useOptionalClientProfileContext()

  return profileContext ? (
    <StoredUserProfilePopover
      {...props}
      openDirectConversation={profileContext.openDirectConversation}
      profileRelationshipActions={profileContext}
    />
  ) : (
    <LegacyUserProfilePopover {...props} />
  )
}

function StoredUserProfilePopover({
  fallbackProfile = null,
  openDirectConversation,
  profileRelationshipActions,
  userId,
  ...props
}: UserProfilePopoverProps & {
  openDirectConversation: ClientProfileContextValue["openDirectConversation"]
  profileRelationshipActions: ProfileRelationshipActions
}) {
  const currentUserId = useClientCurrentUserId()
  const storedProfile = useClientUserProfile(userId)
  const relationship = useClientUserRelationship(userId)
  const profile =
    storedProfile ?? (fallbackProfile?.id === userId ? fallbackProfile : null)

  return (
    <UserProfilePopoverContent
      {...props}
      currentUserId={currentUserId}
      openDirectConversation={openDirectConversation}
      profile={profile}
      profileRelationshipActions={profileRelationshipActions}
      relationship={relationship}
    />
  )
}

function LegacyUserProfilePopover(props: UserProfilePopoverProps) {
  const {
    acceptFriendRequest,
    contactDirectoryMode,
    contacts,
    createFriendRequest,
    incomingFriendRequests,
    me,
    openDirectConversation,
    outgoingFriendRequests,
  } = useClientData()
  const profile = resolveUserProfile(
    props.userId,
    me,
    contacts,
    props.fallbackProfile ?? null
  )
  const profileRelationshipActions = {
    acceptFriendRequest,
    createFriendRequest,
  }
  const relationship = getProfileRelationship(
    {
      contactDirectoryMode,
      contacts,
      incomingFriendRequests,
      outgoingFriendRequests,
    },
    props.userId ?? "",
    me.id
  )

  return (
    <UserProfilePopoverContent
      {...props}
      currentUserId={me.id}
      openDirectConversation={openDirectConversation}
      profile={profile}
      profileRelationshipActions={profileRelationshipActions}
      relationship={relationship}
    />
  )
}

function UserProfilePopoverContent({
  children,
  currentUserId,
  openDirectConversation,
  profile,
  profileRelationshipActions,
  relationship,
  triggerAriaLabel,
  triggerClassName,
}: Omit<UserProfilePopoverProps, "fallbackProfile" | "userId"> & {
  currentUserId: string
  openDirectConversation: ClientProfileContextValue["openDirectConversation"]
  profile: UserProfile | null
  profileRelationshipActions: ProfileRelationshipActions
  relationship: ClientUserRelationship
}) {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [avatarPreviewOpen, setAvatarPreviewOpen] = React.useState(false)
  const [openingConversation, setOpeningConversation] = React.useState(false)
  const [friendRequestPending, setFriendRequestPending] = React.useState(false)

  if (!profile) {
    return <>{children}</>
  }

  const currentProfile = profile
  const displayName = getUserDisplayName(currentProfile)
  const currentRelationship = relationship
  const canStartConversation =
    currentProfile.id !== currentUserId && currentRelationship.isFriend

  async function handleStartConversation() {
    if (!canStartConversation || openingConversation) {
      return
    }

    setOpeningConversation(true)

    try {
      const conversation = await openDirectConversation(currentProfile.id)
      setOpen(false)
      navigate(`/chat/${encodeURIComponent(conversation.id)}`)
    } catch {
      toast.error("无法发起私聊")
    } finally {
      setOpeningConversation(false)
    }
  }

  async function handleAddFriend() {
    if (friendRequestPending) {
      return
    }

    setFriendRequestPending(true)
    try {
      await profileRelationshipActions.createFriendRequest(currentProfile.id)
      toast.success("好友申请已发送")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送好友申请失败")
    } finally {
      setFriendRequestPending(false)
    }
  }

  async function handleAcceptFriend() {
    const request = currentRelationship.incomingRequest
    if (!request || friendRequestPending) {
      return
    }

    setFriendRequestPending(true)
    try {
      await profileRelationshipActions.acceptFriendRequest(request.id)
      toast.success("已添加好友")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "接受好友申请失败")
    } finally {
      setFriendRequestPending(false)
    }
  }

  function handleProfileAction() {
    if (currentRelationship.incomingRequest) {
      void handleAcceptFriend()
      return
    }
    if (!currentRelationship.isFriend) {
      void handleAddFriend()
      return
    }
    void handleStartConversation()
  }

  const profileActionLabel =
    currentProfile.id === currentUserId
      ? "发消息"
      : currentRelationship.incomingRequest
        ? "接受好友申请"
        : currentRelationship.outgoingRequest
          ? "已发送好友申请"
          : currentRelationship.isFriend
            ? "发消息"
            : "加好友"
  const profileActionDisabled =
    currentProfile.id === currentUserId ||
    Boolean(currentRelationship.outgoingRequest) ||
    openingConversation ||
    friendRequestPending

  function handleAvatarPreview() {
    setOpen(false)
    setAvatarPreviewOpen(true)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={triggerAriaLabel}
          className={cn(
            "inline-flex cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            triggerClassName
          )}
          type="button"
        >
          {children}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden"
          side="right"
          sideOffset={8}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                aria-haspopup="dialog"
                aria-label={`预览${displayName}头像`}
                className="shrink-0 cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={handleAvatarPreview}
                type="button"
              >
                <Avatar className="size-14 rounded-sm bg-muted after:rounded-sm">
                  {currentProfile.avatar && (
                    <AvatarImage
                      alt={displayName}
                      className="rounded-sm"
                      src={currentProfile.avatar}
                    />
                  )}
                  <AvatarFallback className="rounded-sm text-lg">
                    {getUserInitial(displayName)}
                  </AvatarFallback>
                </Avatar>
              </button>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium"
                  title={displayName}
                >
                  {displayName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  用户资料
                </div>
              </div>
            </div>

            <div className="grid gap-1 text-sm">
              <UserProfileRow
                icon={<UserRound className="size-4 text-muted-foreground" />}
                label="姓名"
                value={currentProfile.name}
              />
              <UserProfileRow
                icon={<UserPen className="size-4 text-muted-foreground" />}
                label="昵称"
                value={currentProfile.nickname}
              />
              <UserProfileRow
                icon={<Mail className="size-4 text-muted-foreground" />}
                label="邮箱"
                value={currentProfile.email}
              />
              <UserProfileRow
                icon={<Phone className="size-4 text-muted-foreground" />}
                label="手机"
                value={
                  currentProfile.phone
                    ? formatContactPhone(currentProfile.phone)
                    : ""
                }
              />
            </div>

            <Button
              className="w-full"
              disabled={profileActionDisabled}
              onClick={handleProfileAction}
              type="button"
            >
              {(openingConversation || friendRequestPending) && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              {profileActionLabel}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AvatarPreviewDialog
        label={`${displayName}头像预览`}
        onOpenChange={setAvatarPreviewOpen}
        open={avatarPreviewOpen}
      >
        <Avatar className="size-full rounded-sm bg-muted after:rounded-sm">
          {currentProfile.avatar && (
            <AvatarImage
              alt={displayName}
              className="rounded-sm"
              src={currentProfile.avatar}
            />
          )}
          <AvatarFallback className="rounded-sm text-6xl">
            {getUserInitial(displayName)}
          </AvatarFallback>
        </Avatar>
      </AvatarPreviewDialog>
    </>
  )
}

function getProfileRelationship(
  data: ProfileRelationshipSource,
  userId: string,
  currentUserId: string
): ClientUserRelationship {
  return resolveClientUserRelationship(data, userId, currentUserId)
}

function resolveUserProfile(
  userId: string | null,
  me: UserProfile,
  contacts: UserProfile[],
  fallbackProfile: UserProfile | null
) {
  if (!userId) {
    return null
  }

  if (me.id === userId) {
    return me
  }

  return (
    contacts.find((contact) => contact.id === userId) ??
    (fallbackProfile?.id === userId ? fallbackProfile : null)
  )
}

function UserProfileRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  const hasValue = Boolean(value.trim())
  const displayValue = hasValue ? value : "未设置"

  return (
    <div className="flex min-w-0 items-start gap-3 border-b py-2 last:border-b-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 [overflow-wrap:anywhere]",
          !hasValue && "text-muted-foreground"
        )}
        title={displayValue}
      >
        {displayValue}
      </span>
    </div>
  )
}

function getUserDisplayName(user: Pick<UserProfile, "name" | "nickname">) {
  const name = user.name.trim()
  const nickname = user.nickname.trim()

  return nickname || name || "未命名用户"
}

function getUserInitial(displayName: string) {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"
}
