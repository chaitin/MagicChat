import HorizontalRule from "@tiptap/extension-horizontal-rule"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { DocumentHorizontalRuleNodeView } from "@/components/documents/document-horizontal-rule-node"

export const DocumentHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return {
      lineStyle: {
        default: "solid",
        parseHTML: (element) =>
          element.getAttribute("data-line-style") ?? "solid",
        renderHTML: (attributes) => ({
          "data-line-style": attributes.lineStyle,
        }),
      },
      thickness: {
        default: 1,
        parseHTML: (element) =>
          Number(element.getAttribute("data-thickness")) || 1,
        renderHTML: (attributes) => ({
          "data-thickness": attributes.thickness,
        }),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentHorizontalRuleNodeView)
  },
})
