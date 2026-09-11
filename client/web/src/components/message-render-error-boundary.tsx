import * as React from "react"

type MessageRenderErrorBoundaryProps = {
  children: React.ReactNode
  fallback: React.ReactNode
  resetKey: unknown
}

type MessageRenderErrorBoundaryState = {
  failed: boolean
}

class MessageRenderErrorBoundary extends React.Component<
  MessageRenderErrorBoundaryProps,
  MessageRenderErrorBoundaryState
> {
  state: MessageRenderErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): MessageRenderErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: MessageRenderErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export { MessageRenderErrorBoundary }
