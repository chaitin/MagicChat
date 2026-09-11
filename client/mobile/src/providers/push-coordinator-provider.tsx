import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"

import {
  deactivatePushDelegation,
  flushPendingPushRevocation,
  getPushInstallationID,
  queuePushDelegationRevocation,
  synchronizePushDelegation,
} from "@/notifications/push-lifecycle"
import { PushCoordinator } from "@/notifications/push-coordinator"

const PushCoordinatorContext = createContext<PushCoordinator | null>(null)

export function PushCoordinatorProvider({
  children,
}: React.PropsWithChildren) {
  const [coordinator] = useState(
    () =>
      new PushCoordinator({
        deactivate: deactivatePushDelegation,
        flushPendingRevocation: flushPendingPushRevocation,
        getInstallationId: getPushInstallationID,
        queueRevocation: queuePushDelegationRevocation,
        synchronize: synchronizePushDelegation,
      })
  )

  useEffect(() => () => coordinator.dispose(), [coordinator])

  return (
    <PushCoordinatorContext.Provider value={coordinator}>
      {children}
    </PushCoordinatorContext.Provider>
  )
}

export function usePushCoordinator() {
  const coordinator = useContext(PushCoordinatorContext)
  if (!coordinator) {
    throw new Error("usePushCoordinator 必须在 PushCoordinatorProvider 内使用")
  }
  return coordinator
}

export function usePushSynchronizationState() {
  const coordinator = usePushCoordinator()
  const subscribe = useCallback(
    (listener: () => void) => coordinator.subscribe(listener),
    [coordinator]
  )
  const getSnapshot = useCallback(() => coordinator.getState(), [coordinator])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
