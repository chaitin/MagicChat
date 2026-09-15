export async function retryNetworkAction<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < 3) await delay(attempt * 300)
    }
  }
  throw lastError
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
