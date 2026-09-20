import { BrowserWindow, nativeImage, type NativeImage } from "electron"
import { AuthFailure } from "../shared/auth"

const supportedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
])
const maxPixels = 25_000_000
const maxPngUrlLength = 64 * 1024 * 1024

export async function decodePreviewImage(bytes: Buffer, contentType: string): Promise<NativeImage> {
  const direct = nativeImage.createFromBuffer(bytes)
  if (!direct.isEmpty()) return direct
  if (!supportedTypes.has(contentType)) {
    throw new AuthFailure("unsupported_media_copy", "无法复制此图片格式")
  }

  const decoder = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  decoder.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  decoder.webContents.on("will-navigate", (event) => event.preventDefault())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">`
    await decoder.loadURL(`data:text/html,${encodeURIComponent(html)}`)
    const source = `data:${contentType};base64,${bytes.toString("base64")}`
    const script = `(async () => {
      const image = new Image()
      image.src = ${JSON.stringify(source)}
      await image.decode()
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) throw new Error("invalid image")
      if (width * height > ${maxPixels}) return "too_large"
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      canvas.getContext("2d").drawImage(image, 0, 0)
      const png = canvas.toDataURL("image/png")
      return png.length > ${maxPngUrlLength} ? "too_large" : png
    })()`
    const png: unknown = await Promise.race([
      decoder.webContents.executeJavaScript(script, true),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthFailure("media_copy_timeout", "图片转换超时")),
          15_000,
        )
      }),
    ])
    if (png === "too_large") throw new AuthFailure("media_too_large", "图片过大，无法复制")
    if (typeof png !== "string" || !png.startsWith("data:image/png;base64,")) {
      throw new AuthFailure("unsupported_media_copy", "无法复制此图片格式")
    }
    const image = nativeImage.createFromDataURL(png)
    if (image.isEmpty()) throw new AuthFailure("unsupported_media_copy", "无法复制此图片格式")
    return image
  } catch (error) {
    if (error instanceof AuthFailure) throw error
    throw new AuthFailure("unsupported_media_copy", "无法复制此图片格式")
  } finally {
    if (timer) clearTimeout(timer)
    decoder.destroy()
  }
}
