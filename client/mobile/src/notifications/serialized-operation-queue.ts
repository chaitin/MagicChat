export class SerializedOperationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>) {
    const result = this.tail.catch(() => undefined).then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
