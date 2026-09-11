import { Extension } from "@tiptap/core"

export const documentBlockBackgroundTypes = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "table",
]

type DocumentBlockBackgroundOptions = {
  allowedColors: readonly string[]
}

export const DocumentBlockBackground =
  Extension.create<DocumentBlockBackgroundOptions>({
    name: "documentBlockBackground",

    addOptions() {
      return { allowedColors: [] }
    },

    addGlobalAttributes() {
      const normalizeColor = (value: unknown) => {
        if (typeof value !== "string") return null
        const color = value.trim()
        return this.options.allowedColors.includes(color) ? color : null
      }

      return [
        {
          attributes: {
            blockBackgroundColor: {
              default: null,
              parseHTML: (element) =>
                normalizeColor(
                  element.getAttribute("data-block-background-color") ||
                    element.style.backgroundColor
                ),
              renderHTML: (attributes) => {
                const color = normalizeColor(attributes.blockBackgroundColor)
                if (!color) return {}
                return {
                  "data-block-background-color": color,
                  style: `background-color: ${color}`,
                }
              },
            },
          },
          types: documentBlockBackgroundTypes,
        },
      ]
    },
  })
