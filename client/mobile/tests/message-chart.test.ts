import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { xguiColors } from "../src/xgui/theme/colors.ts"
import { normalizeClientMessage } from "../src/data/messages/message-normalizer.ts"
import {
  createLinePathSegments,
  createPieSlicePath,
  getChartDomain,
  scaleChartValue,
  truncateChartLabel,
} from "../src/domain/messages/message-chart-geometry.ts"

test("chart series colors match Desktop in both themes", async () => {
  const source = await readFile(new URL("../src/features/conversation/messages/message-chart.tsx", import.meta.url), "utf8")
  const palette = source.split("function useChartPalette()")[1]
  const keys = [...palette.matchAll(/colors\.(brand|blue|orange|purple|yellow)\b/g)].map((match) => match[1])
  assert.deepEqual(keys, ["brand", "blue", "orange", "purple", "yellow"])
  const desktop = await readFile(new URL("../../desktop/src/renderer/styles.css", import.meta.url), "utf8")
  const [light, dark] = desktop.split(".dark {")
  for (const [theme, css] of [["light", light], ["dark", dark]] as const) {
    keys.forEach((key, index) => {
      assert.match(css, new RegExp(`--chart-${index + 1}: var\\(--xgui-${key}\\);`))
      const desktopColor = css.match(new RegExp(`--xgui-${key}: (#[a-f0-9]+);`))?.[1]
      assert.equal(xguiColors[theme][key as "brand" | "blue" | "orange" | "purple" | "yellow"].toLowerCase(), desktopColor)
    })
  }
})

test("chart grid, radar fill and muted text match Desktop without changing global colors", async () => {
  const source = await readFile(new URL("../src/features/conversation/messages/message-chart.tsx", import.meta.url), "utf8")
  assert.match(source, /grid: colorScheme === "dark" \? "rgba\(255,255,255,0\.04\)" : "rgba\(0,0,0,0\.045\)"/)
  assert.match(source, /border: colorScheme === "dark" \? "rgba\(255,255,255,0\.08\)" : "rgba\(0,0,0,0\.09\)"/)
  assert.match(source, /muted: colorScheme === "dark" \? "#A3A3A3" : "#737373"/)
  assert.match(source, /fillOpacity=\{0\.18\}/)
  assert.match(source, /color: palette\.muted[^\n]*\{chart\.description\}/)
  assert.match(source, /color: palette\.muted[^\n]*\{item\.label\}/)
  assert.doesNotMatch(source, /fillOpacity=\{0\.25\}|colors\.textSecondary|grid: colors\.foreground3/)
})

const baseMessage = {
  conversation_id: "conversation",
  created_at: "2026-07-30T00:00:00Z",
  id: "message",
  sender: { id: "app", type: "app" },
  seq: 1,
}

test("normalizes all supported chart message types", () => {
  const fixtures = [
    {
      chart_type: "line",
      data: {
        labels: ["周一", "周二"],
        series: [{ name: "发送", values: [12, null] }],
      },
    },
    {
      chart_type: "bar",
      data: {
        direction: "horizontal",
        labels: ["一月", "二月"],
        mode: "stacked",
        series: [
          { name: "新增", values: [12, 18] },
          { name: "完成", values: [8, 15] },
        ],
      },
    },
    {
      chart_type: "pie",
      data: {
        items: [
          { name: "待办", value: 12 },
          { name: "完成", value: 8 },
        ],
      },
    },
    {
      chart_type: "radar",
      data: {
        axes: [
          { max: 100, name: "进度" },
          { max: 100, name: "质量" },
          { max: 100, name: "协作" },
        ],
        series: [{ name: "本周", values: [80, 92, 76] }],
      },
    },
  ] as const

  assert.deepEqual(
    fixtures.map((fixture, index) => {
      const message = normalizeClientMessage({
        ...baseMessage,
        body: {
          ...fixture,
          description: "  图表说明  ",
          title: "  示例图表  ",
          type: "chart",
        },
        id: `message-${index}`,
      })
      assert.equal(message.body.type, "chart")
      return message.body.type === "chart"
        ? {
            chartType: message.body.chartType,
            description: message.body.description,
            title: message.body.title,
          }
        : null
    }),
    ["line", "bar", "pie", "radar"].map((chartType) => ({
      chartType,
      description: "图表说明",
      title: "示例图表",
    }))
  )
})

test("turns malformed chart messages into unsupported messages", () => {
  const invalidBodies = [
    {
      chart_type: "line",
      data: {
        labels: ["只有一个"],
        series: [{ name: "数量", values: [1] }],
      },
    },
    {
      chart_type: "pie",
      data: {
        items: [
          { name: "待办", value: 0 },
          { name: "完成", value: 8 },
        ],
      },
    },
    {
      chart_type: "radar",
      data: {
        axes: [
          { max: 100, name: "进度" },
          { max: 100, name: "质量" },
          { max: 100, name: "协作" },
        ],
        series: [{ name: "本周", values: [101, 92, 76] }],
      },
    },
  ]

  invalidBodies.forEach((body, index) => {
    const message = normalizeClientMessage({
      ...baseMessage,
      body: {
        ...body,
        description: "图表说明",
        title: "示例图表",
        type: "chart",
      },
      id: `invalid-${index}`,
    })
    assert.deepEqual(message.body, { type: "unsupported" })
  })
})

test("calculates chart domains and preserves line gaps", () => {
  const domain = getChartDomain([10, 20, null], false)
  assert.ok(domain.min < 10)
  assert.ok(domain.max > 20)
  assert.equal(scaleChartValue(domain.min, domain, 100, 0), 100)
  assert.equal(scaleChartValue(domain.max, domain, 100, 0), 0)

  assert.deepEqual(
    createLinePathSegments([10, null, 20, 30], (value, index) => ({
      x: index * 10,
      y: value,
    })),
    ["M0 10", "M20 20 L30 30"]
  )
})

test("creates full pie paths and truncates long labels", () => {
  const path = createPieSlicePath(100, 100, 50, 0, 360)
  assert.match(path, /A 50 50 0 1 1/)
  assert.equal(truncateChartLabel("这是一个很长的图表标签"), "这是一个很长的图…")
})
