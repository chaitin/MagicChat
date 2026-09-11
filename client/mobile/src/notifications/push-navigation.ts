export async function navigateThenConsumePushRoute({
  consume,
  navigate,
}: {
  consume: () => Promise<void>
  navigate: () => void | Promise<void>
}) {
  await navigate()
  await consume()
}
