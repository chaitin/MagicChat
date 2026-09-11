import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"

import { createAccountStore } from "@/data/auth/account-store-core"

export * from "@/data/auth/account-store-core"

/** Creates an isolated platform-backed instance; callers may inject the pure store in tests. */
export function createDefaultAccountStore() {
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }
  return createAccountStore({
    indexStore: AsyncStorage,
    credentialStore: {
      getItem: (key) => SecureStore.getItemAsync(key, options),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
      deleteItem: (key) => SecureStore.deleteItemAsync(key, options),
    },
  })
}
