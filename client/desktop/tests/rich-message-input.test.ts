import assert from "node:assert/strict"
import test from "node:test"
import { normalizeOutgoingRichMessageBody } from "../src/main/account/rich-message-input.ts"

test("选择消息转为服务端协议", () => {
  assert.deepEqual(
    normalizeOutgoingRichMessageBody({
      type: "choice",
      content: " 请选择 ",
      contentType: "text",
      selection: "multiple",
      options: [
        { id: "option-1", label: "甲" },
        { id: "option-2", label: "乙" },
      ],
    }),
    {
      type: "choice",
      content: "请选择",
      content_type: "text",
      selection: "multiple",
      options: [
        { id: "option-1", label: "甲" },
        { id: "option-2", label: "乙" },
      ],
    },
  )
})

test("图表消息按类型转换数据", () => {
  for (const [chartType, data] of [
    ["line", { labels: ["甲", "乙"], series: [{ name: "人数", values: [1, 2] }] }],
    [
      "bar",
      {
        labels: ["甲"],
        series: [{ name: "人数", values: [1] }],
        direction: "vertical",
        mode: "stacked",
      },
    ],
    [
      "pie",
      {
        items: [
          { name: "甲", value: 1 },
          { name: "乙", value: 2 },
        ],
      },
    ],
    [
      "radar",
      {
        axes: [
          { name: "甲", max: 10 },
          { name: "乙", max: 10 },
          { name: "丙", max: 10 },
        ],
        series: [{ name: "人数", values: [1, 2, 3] }],
      },
    ],
  ] as const) {
    assert.deepEqual(
      normalizeOutgoingRichMessageBody({
        type: "chart",
        chartType,
        title: "标题",
        description: "单位：个",
        data,
      }),
      {
        type: "chart",
        chart_type: chartType,
        title: "标题",
        description: "单位：个",
        data,
      },
    )
  }
})

test("拒绝非法的富消息参数", () => {
  assert.throws(() => normalizeOutgoingRichMessageBody({ type: "file" }))
  assert.throws(() =>
    normalizeOutgoingRichMessageBody({
      type: "choice",
      content: "问题",
      contentType: "text",
      selection: "single",
      options: [
        { id: "same", label: "甲" },
        { id: "same", label: "乙" },
      ],
    }),
  )
  assert.throws(() =>
    normalizeOutgoingRichMessageBody({
      type: "chart",
      chartType: "pie",
      title: "标题",
      description: "单位：个",
      data: {
        items: [
          { name: "甲", value: -1 },
          { name: "乙", value: 2 },
        ],
      },
    }),
  )
  assert.throws(() =>
    normalizeOutgoingRichMessageBody({
      type: "chart",
      chartType: "radar",
      title: "标题",
      description: "单位：个",
      data: {
        axes: [
          { name: "甲", max: 10 },
          { name: "乙", max: 10 },
          { name: "丙", max: 10 },
        ],
        series: [{ name: "人数", values: [11, 2, 3] }],
      },
    }),
  )
})
