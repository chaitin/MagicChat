import StarterKit from "@tiptap/starter-kit"

export const DocumentStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.name === "code"
        ? extension.extend({
            excludes: "bold italic link strike underline",
          })
        : extension
    )
  },
})
