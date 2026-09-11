const BOUNDARY_EPSILON = 1

export type ElasticScrollMetrics = {
  contentHeight: number
  offsetY: number
  viewportHeight: number
}

export function getElasticBoundary(metrics: ElasticScrollMetrics): "top" | "bottom" | "both" | "none" {
  "worklet"
  const shortContent = metrics.contentHeight <= metrics.viewportHeight + BOUNDARY_EPSILON
  if (shortContent) return "both"
  if (metrics.offsetY <= BOUNDARY_EPSILON) return "top"
  if (metrics.offsetY + metrics.viewportHeight >= metrics.contentHeight - BOUNDARY_EPSILON) return "bottom"
  return "none"
}

export function getElasticTranslation(
  dragY: number,
  metrics: ElasticScrollMetrics,
  damping = 0.35,
  maxTranslation = 200
): number {
  "worklet"
  const boundary = getElasticBoundary(metrics)
  if ((dragY > 0 && (boundary === "top" || boundary === "both")) ||
      (dragY < 0 && (boundary === "bottom" || boundary === "both"))) {
    return Math.max(-maxTranslation, Math.min(maxTranslation, dragY * damping))
  }
  return 0
}

export function canStartElasticOverscroll(
  dragY: number,
  metrics: ElasticScrollMetrics
): boolean {
  "worklet"
  const boundary = getElasticBoundary(metrics)
  return (
    (dragY > 0 && (boundary === "top" || boundary === "both")) ||
    (dragY < 0 && (boundary === "bottom" || boundary === "both"))
  )
}
