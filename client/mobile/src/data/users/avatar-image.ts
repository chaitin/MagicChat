import { File } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"

import { validateAvatarSource, type AvatarSourceMetadata } from "@/domain/users/profile-edit"

export const AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024
export const AVATAR_MAX_OUTPUT_BYTES = 1024 * 1024
export const AVATAR_OUTPUT_SIZE = 256

export type AvatarSource = AvatarSourceMetadata & {
  uri: string
}

export async function prepareAvatar(source: AvatarSource) {
  const sourceFile = new File(source.uri)
  const validationError = validateAvatarSource({
    ...source,
    fileSize: source.fileSize ?? sourceFile.size,
  })
  if (validationError) throw new Error(validationError)

  const context = ImageManipulator.manipulate(source.uri)
  let imageRef: Awaited<ReturnType<typeof context.renderAsync>> | null = null
  try {
    context.resize({ height: AVATAR_OUTPUT_SIZE, width: AVATAR_OUTPUT_SIZE })
    imageRef = await context.renderAsync()
    const result = await imageRef.saveAsync({
      compress: 0.9,
      format: SaveFormat.WEBP,
    })
    const file = new File(result.uri)
    if (file.size > AVATAR_MAX_OUTPUT_BYTES) {
      deleteQuietly(file)
      throw new Error("处理后的头像不能超过 1MiB")
    }
    return { cleanup: () => deleteQuietly(file), file, uri: result.uri }
  } finally {
    imageRef?.release()
    context.release()
  }
}

function deleteQuietly(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // Cleanup failures must not mask the profile operation.
  }
}
