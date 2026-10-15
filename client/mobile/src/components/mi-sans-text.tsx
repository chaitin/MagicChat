import { Children, Fragment, cloneElement, forwardRef, isValidElement, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from "react"
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
} from "react-native"

import { attachInputEmojiFallback, getInputFontFamily } from "@/native/android-emoji-font-fallback"
import { splitEmojiText } from "./emoji-text-runs"

export const Text = forwardRef<NativeText, TextProps>(function Text({ children, style, ...props }, ref) {
  return (
    <NativeText ref={ref} {...props} allowFontScaling={false} style={style}>
      {renderEmojiChildren(children)}
    </NativeText>
  )
})

function renderEmojiChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return splitEmojiText(child).map((run, index) => run.emoji ? (
        <NativeText allowFontScaling={false} key={index} style={styles.emoji}>{run.text}</NativeText>
      ) : run.text)
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return cloneElement(child, undefined, renderEmojiChildren(child.props.children))
    }
    return child
  })
}

const styles = StyleSheet.create({
  emoji: { fontFamily: "JiyingEmoji", fontWeight: "normal", fontStyle: "normal" },
})

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  { style, onLayout, ...props },
  ref,
) {
  const input = useRef<NativeTextInput>(null)
  const detachEmoji = useRef<(() => void) | undefined>(undefined)
  const boundInput = useRef<NativeTextInput | null>(null)
  const flattened = StyleSheet.flatten(style)
  const family = flattened?.fontFamily ?? getInputFontFamily(flattened?.fontWeight)
  useImperativeHandle(ref, () => input.current!)
  const bindEmoji = useCallback(() => {
    if (boundInput.current !== input.current) detachEmoji.current?.()
    boundInput.current = input.current
    detachEmoji.current = attachInputEmojiFallback(input.current)
  }, [])
  useEffect(() => {
    bindEmoji()
    return () => {
      detachEmoji.current?.()
      detachEmoji.current = undefined
      boundInput.current = null
    }
  }, [bindEmoji])

  return (
    <NativeTextInput
      ref={input}
      {...props}
      allowFontScaling={false}
      onLayout={(event) => {
        bindEmoji()
        onLayout?.(event)
      }}
      style={[style, family ? { fontFamily: family } : undefined]}
    />
  )
})
