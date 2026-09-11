import { Input, styled } from "tamagui"

export const AppInput = styled(Input, {
  name: "AppInput",
  cursorColor: "$color10",
  placeholderTextColor: "$color8",
  selectionColor: "$color10",
  focusStyle: {
    borderColor: "$borderColorFocus",
    outlineColor: "$outlineColor",
    outlineStyle: "solid",
    outlineWidth: 2,
  },
})
