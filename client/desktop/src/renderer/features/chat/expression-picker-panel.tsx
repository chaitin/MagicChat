import { useState } from "react"

const storageKey = "jiying-desktop:expression-picker:recent"
const previousStorageKey = "jiying-desktop:expression-picker:usage"
const recentLimit = 10

const expressions = [
  ["🙂", "浅笑"],
  ["😄", "大笑"],
  ["☺️", "微笑"],
  ["😉", "眨眼"],
  ["😋", "好吃"],
  ["😛", "吐舌"],
  ["😝", "眯眼吐舌"],
  ["😏", "坏笑"],
  ["🤑", "发财"],
  ["😅", "流汗笑"],
  ["😘", "飞吻"],
  ["😍", "花痴"],
  ["🤩", "星星眼"],
  ["😂", "笑哭"],
  ["🥹", "忍住眼泪"],
  ["🥺", "可怜"],
  ["😰", "焦虑流汗"],
  ["😥", "难过"],
  ["🥲", "含泪微笑"],
  ["😭", "大哭"],
  ["😵‍💫", "晕头转向"],
  ["🙁", "不开心"],
  ["😯", "惊讶"],
  ["😌", "释然"],
  ["😮‍💨", "叹气"],
  ["😔", "沮丧"],
  ["😒", "不满"],
  ["😪", "困倦"],
  ["😓", "冷汗"],
  ["😴", "睡觉"],
  ["🤔", "思考"],
  ["🤫", "嘘"],
  ["😎", "酷"],
  ["🤮", "呕吐"],
  ["😷", "口罩"],
  ["🤧", "打喷嚏"],
  ["😡", "愤怒"],
  ["😦", "惊愕"],
  ["🥱", "打哈欠"],
  ["🥳", "庆祝"],
  ["👋", "挥手"],
  ["👌", "好的"],
  ["👏", "鼓掌"],
  ["🤝", "握手"],
  ["✌️", "胜利"],
  ["👍", "赞"],
  ["👎", "踩"],
  ["🙏", "拜托"],
  ["🫶", "爱心手势"],
  ["🫰", "比心"],
  ["👈", "向左"],
  ["👉", "向右"],
  ["👆", "向上"],
  ["👇", "向下"],
  ["🖕", "中指"],
  ["💪", "加油"],
  ["🤟", "我爱你手势"],
  ["🤙", "打电话手势"],
  ["👊", "碰拳"],
  ["🤏", "捏手指"],
  ["🙋", "举手"],
  ["🤷", "摊手"],
  ["🙅", "不行"],
  ["🤦", "捂脸"],
  ["👀", "关注"],
  ["🎉", "庆祝礼花"],
  ["🔞", "未成年禁止"],
  ["🍟", "薯条"],
  ["🚀", "火箭"],
  ["🔥", "火"],
  ["❤️", "爱心"],
  ["💔", "心碎"],
  ["💋", "亲吻"],
  ["💯", "满分"],
  ["💩", "便便"],
  ["🆗", "OK"],
  ["✔️", "对勾"],
  ["❌", "错误"],
  ["❓", "疑问"],
  ["❗", "感叹"],
] as const

const expressionValues: ReadonlySet<string> = new Set(expressions.map(([value]) => value))

export function ExpressionPickerPanel({ onSelect }: { onSelect: (value: string) => void }) {
  const [recent, setRecent] = useState<string[]>(readRecent)

  function select(value: string) {
    const nextRecent = [value, ...recent.filter((item) => item !== value)].slice(0, recentLimit)
    setRecent(nextRecent)
    writeRecent(nextRecent)
    onSelect(value)
  }

  return (
    <div className="w-max space-y-4">
      {recent.length > 0 && (
        <ExpressionSection label="最近使用" values={recent} onSelect={select} />
      )}
      <ExpressionSection
        label="所有表情"
        values={expressions.map(([value]) => value)}
        onSelect={select}
      />
    </div>
  )
}

function ExpressionSection({
  label,
  values,
  onSelect,
}: {
  label: string
  values: readonly string[]
  onSelect: (value: string) => void
}) {
  return (
    <section aria-label={label}>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="grid grid-cols-[repeat(10,1.75rem)] gap-0.5">
        {values.map((value) => {
          const label = expressions.find(([candidate]) => candidate === value)?.[1] ?? value
          return (
            <button
              key={`${label}-${value}`}
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-lg hover:bg-accent"
              aria-label={label}
              title={label}
              onClick={() => onSelect(value)}
            >
              <span className="font-emoji" aria-hidden>
                {value}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function readRecent(): string[] {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved !== null) return normalizeRecent(JSON.parse(saved))
    const previous: unknown = JSON.parse(localStorage.getItem(previousStorageKey) || "[]")
    if (!Array.isArray(previous)) return []
    return normalizeRecent(
      previous.map((item) =>
        item && typeof item === "object" && "value" in item ? item.value : null,
      ),
    )
  } catch {
    return []
  }
}

function normalizeRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && expressionValues.has(item),
      ),
    ),
  ].slice(0, recentLimit)
}

function writeRecent(recent: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(recent))
  } catch {
    // Selecting an expression should still work if storage is unavailable.
  }
}
