import { useMemo, useState } from "react"

const storageKey = "jiying-desktop:expression-picker:usage"
const frequentLimit = 8

const expressions = [
  ["😂", "笑哭"],
  ["🤣", "笑到打滚"],
  ["😄", "大笑"],
  ["😅", "流汗笑"],
  ["😆", "眯眼笑"],
  ["😀", "笑脸"],
  ["😃", "开心"],
  ["😁", "露齿笑"],
  ["😊", "微笑"],
  ["🙂", "浅笑"],
  ["😉", "眨眼"],
  ["🥰", "喜爱"],
  ["😍", "花痴"],
  ["😘", "飞吻"],
  ["🤗", "拥抱"],
  ["🤩", "星星眼"],
  ["😏", "坏笑"],
  ["🤭", "偷笑"],
  ["😜", "眨眼吐舌"],
  ["🙃", "倒脸"],
  ["😋", "好吃"],
  ["🤪", "滑稽"],
  ["😎", "酷"],
  ["🤫", "嘘"],
  ["🤔", "思考"],
  ["🙄", "翻白眼"],
  ["🤦", "捂脸"],
  ["🤷", "摊手"],
  ["😑", "面无表情"],
  ["😬", "尴尬"],
  ["🫠", "融化"],
  ["🤡", "小丑"],
  ["😭", "大哭"],
  ["🥺", "可怜"],
  ["🥹", "忍住眼泪"],
  ["😢", "哭"],
  ["😔", "沮丧"],
  ["🥲", "含泪微笑"],
  ["😮‍💨", "叹气"],
  ["😳", "脸红"],
  ["😡", "愤怒"],
  ["😤", "生气"],
  ["😱", "惊恐"],
  ["🤯", "爆炸头"],
  ["🥳", "庆祝"],
  ["😴", "睡觉"],
  ["🥱", "打哈欠"],
  ["🫡", "敬礼"],
  ["👍", "赞"],
  ["👏", "鼓掌"],
  ["🙏", "拜托"],
  ["👌", "好的"],
  ["💪", "加油"],
  ["✌️", "胜利"],
  ["🤝", "握手"],
  ["👎", "踩"],
  ["👋", "挥手"],
  ["👀", "关注"],
  ["❤️", "爱心"],
  ["🫶", "爱心手势"],
  ["🔥", "火"],
  ["🎉", "庆祝礼花"],
  ["✅", "完成"],
  ["❌", "错误"],
] as const

const defaultFrequent = ["😂", "😊", "😭", "👍", "❤️", "👏", "🙏", "🎉"]

type Usage = { value: string; count: number; lastUsedAt: number }

export function ExpressionPickerPanel({ onSelect }: { onSelect: (value: string) => void }) {
  const [usage, setUsage] = useState<Usage[]>(readUsage)
  const frequent = useMemo(() => frequentExpressions(usage), [usage])

  function select(value: string) {
    const nextUsage = updateUsage(usage, value)
    setUsage(nextUsage)
    writeUsage(nextUsage)
    onSelect(value)
  }

  return (
    <div className="w-80 space-y-4">
      <ExpressionSection label="常用" values={frequent} onSelect={select} />
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
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="grid grid-cols-8 gap-1">
        {values.map((value) => {
          const label = expressions.find(([candidate]) => candidate === value)?.[1] ?? value
          return (
            <button
              key={`${label}-${value}`}
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md text-lg hover:bg-accent"
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

function frequentExpressions(usage: Usage[]) {
  const used = usage
    .slice()
    .sort((left, right) => right.count - left.count || right.lastUsedAt - left.lastUsedAt)
    .map((item) => item.value)
    .filter((value) => expressions.some(([candidate]) => candidate === value))
  return [...new Set([...used, ...defaultFrequent, ...expressions.map(([value]) => value)])].slice(
    0,
    frequentLimit,
  )
}

function updateUsage(usage: Usage[], value: string) {
  const previous = usage.find((item) => item.value === value)
  return [
    { value, count: (previous?.count ?? 0) + 1, lastUsedAt: Date.now() },
    ...usage.filter((item) => item.value !== value),
  ].slice(0, 64)
}

function readUsage(): Usage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]")
    if (!Array.isArray(value)) return []
    return value.flatMap((item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Usage).value === "string" &&
      typeof (item as Usage).count === "number" &&
      typeof (item as Usage).lastUsedAt === "number"
        ? [item as Usage]
        : [],
    )
  } catch {
    return []
  }
}

function writeUsage(usage: Usage[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(usage))
  } catch {
    // Selecting an expression should still work if storage is unavailable.
  }
}
