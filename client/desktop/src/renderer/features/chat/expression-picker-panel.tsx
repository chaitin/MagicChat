import { useState } from "react"

const storageKey = "jiying-desktop:expression-picker:recent"
const previousStorageKey = "jiying-desktop:expression-picker:usage"
const recentLimit = 10

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
  ["😌", "释然"],
  ["😇", "天使"],
  ["🤠", "牛仔"],
  ["🤓", "书呆子"],
  ["🫢", "捂嘴"],
  ["🫣", "偷看"],
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
  ["😵‍💫", "晕头转向"],
  ["🤢", "恶心"],
  ["🤒", "生病"],
  ["😷", "口罩"],
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
  ["🙌", "欢呼"],
  ["👐", "张开双手"],
  ["🤘", "摇滚"],
  ["👀", "关注"],
  ["❤️", "爱心"],
  ["🫶", "爱心手势"],
  ["💔", "心碎"],
  ["💯", "满分"],
  ["🌟", "星星"],
  ["🔥", "火"],
  ["🎉", "庆祝礼花"],
  ["✅", "完成"],
  ["❌", "错误"],
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
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="grid grid-cols-[repeat(10,1.75rem)] gap-0.5">
        {values.map((value) => {
          const label = expressions.find(([candidate]) => candidate === value)?.[1] ?? value
          return (
            <button
              key={`${label}-${value}`}
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-sm hover:bg-accent"
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
