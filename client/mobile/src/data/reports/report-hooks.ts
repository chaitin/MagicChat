import { useMutation } from "@tanstack/react-query"

import type { AuthenticatedTarget } from "@/core/server-target"
import {
  createUserReport,
  type UserReportReason,
} from "@/data/reports/reports-api"

export function useCreateUserReport(target: AuthenticatedTarget) {
  return useMutation({
    mutationFn: (input: {
      conversationId: string
      description: string
      reason: UserReportReason
    }) => createUserReport(target, input),
  })
}
