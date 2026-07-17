export {
  ensureAttachmentResource,
  ensureAvatarResource,
  getCachedAttachmentResource,
  invalidateAttachmentResource,
  invalidateAvatarResource,
  removeServerResourceCache,
  resolveAvatarResourceUrl,
} from "@/data/resources/resource-repository"
export {
  useCachedAvatar,
  useMessageResources,
} from "@/data/resources/resource-hooks"
export { openResourceExternally } from "@/data/resources/resource-opener"
export type {
  AttachmentResourceKind,
  AttachmentResourceReference,
  AvatarResourceReference,
  ResourceLoadState,
  ResourceReference,
  ResolvedResource,
} from "@/data/resources/resource-types"
