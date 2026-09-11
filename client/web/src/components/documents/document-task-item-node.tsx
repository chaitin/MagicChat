import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react"

import { Checkbox } from "@/components/ui/checkbox"

export function DocumentTaskItemNodeView({
  node,
  updateAttributes,
}: NodeViewProps) {
  const checked = node.attrs.checked === true

  return (
    <NodeViewWrapper
      as="li"
      className="document-task-item"
      data-checked={checked}
      data-type="taskItem"
    >
      <span className="document-task-item__checkbox" contentEditable={false}>
        <Checkbox
          aria-label={checked ? "标记为未完成" : "标记为已完成"}
          checked={checked}
          className="after:-inset-1"
          onCheckedChange={(nextChecked) =>
            updateAttributes({ checked: nextChecked === true })
          }
        />
      </span>
      <NodeViewContent as="div" className="document-task-item__content" />
    </NodeViewWrapper>
  )
}
