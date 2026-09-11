import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FaqQuestion({ question }: { question: string }) {
  return (
    <Button asChild variant="ghost" motion={false}>
      <summary><span>{question}</span><Plus aria-hidden="true" /></summary>
    </Button>
  )
}
