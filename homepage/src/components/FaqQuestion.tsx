import { Plus } from "lucide-react"

export function FaqQuestion({ question }: { question: string }) {
  return (
    <summary>
      <span>{question}</span><Plus size={20} aria-hidden="true" />
    </summary>
  )
}
