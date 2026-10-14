import { Fragment, memo, useCallback, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"
import Svg, {
  Circle,
  Line as SvgLine,
  Path as SvgPath,
  Polygon,
  Rect,
  Text as SvgText,
} from "react-native-svg"

import type {
  ClientBarChartMessageBody,
  ClientChartMessageBody,
  ClientLineChartMessageBody,
  ClientPieChartMessageBody,
  ClientRadarChartMessageBody,
} from "@/core/models"
import {
  createLinePathSegments,
  createPieSlicePath,
  formatChartValue,
  getChartDomain,
  getChartTicks,
  polarPoint,
  scaleChartValue,
  truncateChartLabel,
  type ChartDomain,
} from "@/domain/messages/message-chart-geometry"
import { useXGUITheme } from "@/xgui"

const DEFAULT_CHART_HEIGHT = 220
const DEFAULT_CHART_WIDTH = 320
const MAX_VERTICAL_CHART_HEIGHT = 320

type ChartPalette = {
  background: string
  border: string
  colors: string[]
  grid: string
  muted: string
  text: string
}

type ChartLegendItem = {
  color: string
  key: string
  label: string
}

type ChartDetailItem = {
  color: string
  label: string
  value: string
}

export const MessageChart = memo(function MessageChart({
  chart,
  onLongPress,
}: {
  chart: ClientChartMessageBody
  onLongPress: () => void
}) {
  const palette = useChartPalette()
  const { colors } = useXGUITheme()

  return (
    <Pressable accessible={false} onLongPress={onLongPress} style={{ gap: 7, width: "100%" }}>
      <Text style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 23 }}>{chart.title}</Text>
      <View style={{ backgroundColor: palette.border, height: StyleSheet.hairlineWidth }} />
      <ChartBody chart={chart} palette={palette} />
      <View style={{ backgroundColor: palette.border, height: StyleSheet.hairlineWidth }} />
      <Text style={{ color: palette.muted, fontSize: 15, lineHeight: 23 }}>{chart.description}</Text>
    </Pressable>
  )
})

function ChartBody({
  chart,
  palette,
}: {
  chart: ClientChartMessageBody
  palette: ChartPalette
}) {
  switch (chart.chartType) {
    case "line":
      return <LineMessageChart chart={chart} palette={palette} />
    case "bar":
      return <BarMessageChart chart={chart} palette={palette} />
    case "pie":
      return <PieMessageChart chart={chart} palette={palette} />
    case "radar":
      return <RadarMessageChart chart={chart} palette={palette} />
  }
}

function LineMessageChart({
  chart,
  palette,
}: {
  chart: ClientLineChartMessageBody
  palette: ChartPalette
}) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const width = Math.max(DEFAULT_CHART_WIDTH, chart.data.labels.length * 36)
  const height = DEFAULT_CHART_HEIGHT
  const plot = { bottom: height - 14, left: 46, right: width - 14, top: 12 }
  const visibleSeries = chart.data.series.flatMap((series, index) =>
    hiddenKeys.has(seriesKey(index)) ? [] : [{ index, series }]
  )
  const domain = getChartDomain(
    visibleSeries.flatMap(({ series }) => series.values),
    false
  )
  const xStep =
    chart.data.labels.length > 1
      ? (plot.right - plot.left) / (chart.data.labels.length - 1)
      : 0
  const xAt = (index: number) => plot.left + index * xStep
  const yAt = (value: number) =>
    scaleChartValue(value, domain, plot.bottom, plot.top)

  const details =
    selectedIndex === null
      ? []
      : visibleSeries.flatMap(({ index, series }) => {
          const value = series.values[selectedIndex]
          return value === null
            ? []
            : [
                {
                  color: palette.colors[index],
                  label: series.name,
                  value: formatChartValue(value),
                },
              ]
        })

  return (
    <View style={{ gap: 7 }}>
      <ChartViewport height={height} width={width}>
        <Svg height={height} width={width}>
          <CartesianGrid
            domain={domain}
            horizontal
            palette={palette}
            plot={plot}
          />
          {visibleSeries.flatMap(({ index, series }) =>
            createLinePathSegments(series.values, (value, valueIndex) => ({
              x: xAt(valueIndex),
              y: yAt(value),
            })).map((path, pathIndex) => (
              <SvgPath
                d={path}
                fill="none"
                key={`${seriesKey(index)}:${pathIndex}`}
                stroke={palette.colors[index]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            ))
          )}
          {chart.data.labels.length <= 20
            ? visibleSeries.flatMap(({ index, series }) =>
                series.values.flatMap((value, valueIndex) =>
                  value === null
                    ? []
                    : [
                        <Circle
                          cx={xAt(valueIndex)}
                          cy={yAt(value)}
                          fill={palette.background}
                          key={`${seriesKey(index)}:dot:${valueIndex}`}
                          r={3}
                          stroke={palette.colors[index]}
                          strokeWidth={2}
                        />,
                      ]
                )
              )
            : null}
          {chart.data.labels.map((label, index) => {
            const start = index === 0 ? plot.left : xAt(index) - xStep / 2
            const end =
              index === chart.data.labels.length - 1
                ? plot.right
                : xAt(index) + xStep / 2
            return (
              <Rect
                accessibilityLabel={`${label}，点按查看数值`}
                fill="transparent"
                height={plot.bottom - plot.top}
                key={`touch:${index}`}
                onPress={() => setSelectedIndex(index)}
                width={Math.max(12, end - start)}
                x={start}
                y={plot.top}
              />
            )
          })}
        </Svg>
      </ChartViewport>
      <ChartTapResult
        details={details}
        label={
          selectedIndex === null ? null : chart.data.labels[selectedIndex]
        }
      />
      <ChartLegend
        hiddenKeys={hiddenKeys}
        items={seriesLegendItems(chart.data.series, palette)}
        onToggle={toggleKey}
      />
    </View>
  )
}

function BarMessageChart({
  chart,
  palette,
}: {
  chart: ClientBarChartMessageBody
  palette: ChartPalette
}) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const visibleSeriesIndexes = chart.data.series.flatMap((_, index) =>
    hiddenKeys.has(seriesKey(index)) ? [] : [index]
  )
  const horizontal = chart.data.direction === "horizontal"
  const height = horizontal
    ? Math.max(DEFAULT_CHART_HEIGHT, chart.data.labels.length * 30 + 28)
    : DEFAULT_CHART_HEIGHT
  const width = horizontal
    ? DEFAULT_CHART_WIDTH
    : Math.max(DEFAULT_CHART_WIDTH, chart.data.labels.length * 34)
  const details =
    selectedIndex === null
      ? []
      : visibleSeriesIndexes.flatMap((seriesIndex) => {
          const value = chart.data.series[seriesIndex].values[selectedIndex]
          return value === null
            ? []
            : [
                {
                  color: palette.colors[seriesIndex],
                  label: chart.data.series[seriesIndex].name,
                  value: formatChartValue(value),
                },
              ]
        })

  return (
    <View style={{ gap: 7 }}>
      <ChartViewport
        height={height}
        vertical={horizontal}
        width={width}
      >
        {horizontal ? (
          <HorizontalBarChartSvg
            chart={chart}
            height={height}
            onSelect={setSelectedIndex}
            palette={palette}
            visibleSeriesIndexes={visibleSeriesIndexes}
            width={width}
          />
        ) : (
          <VerticalBarChartSvg
            chart={chart}
            height={height}
            onSelect={setSelectedIndex}
            palette={palette}
            visibleSeriesIndexes={visibleSeriesIndexes}
            width={width}
          />
        )}
      </ChartViewport>
      <ChartTapResult
        details={details}
        label={
          selectedIndex === null ? null : chart.data.labels[selectedIndex]
        }
      />
      <ChartLegend
        hiddenKeys={hiddenKeys}
        items={seriesLegendItems(chart.data.series, palette)}
        onToggle={toggleKey}
      />
    </View>
  )
}

function VerticalBarChartSvg({
  chart,
  height,
  onSelect,
  palette,
  visibleSeriesIndexes,
  width,
}: {
  chart: ClientBarChartMessageBody
  height: number
  onSelect: (index: number) => void
  palette: ChartPalette
  visibleSeriesIndexes: number[]
  width: number
}) {
  const plot = { bottom: height - 14, left: 46, right: width - 14, top: 12 }
  const domain = getBarChartDomain(chart, visibleSeriesIndexes)
  const zeroY = scaleChartValue(0, domain, plot.bottom, plot.top)
  const categoryWidth = (plot.right - plot.left) / chart.data.labels.length
  const groupWidth = Math.min(26, categoryWidth * 0.72)

  return (
    <Svg height={height} width={width}>
      <CartesianGrid
        domain={domain}
        horizontal
        palette={palette}
        plot={plot}
      />
      {chart.data.labels.flatMap((_, labelIndex) => {
        const centerX = plot.left + categoryWidth * (labelIndex + 0.5)
        if (chart.data.mode === "grouped") {
          const barWidth =
            visibleSeriesIndexes.length > 0
              ? groupWidth / visibleSeriesIndexes.length
              : groupWidth
          return visibleSeriesIndexes.flatMap((seriesIndex, visibleIndex) => {
            const value = chart.data.series[seriesIndex].values[labelIndex]
            if (value === null) return []
            const valueY = scaleChartValue(value, domain, plot.bottom, plot.top)
            return [
              <Rect
                fill={palette.colors[seriesIndex]}
                height={Math.max(1, Math.abs(zeroY - valueY))}
                key={`bar:${labelIndex}:${seriesIndex}`}
                onPress={() => onSelect(labelIndex)}
                rx={2}
                width={Math.max(1, barWidth - 1)}
                x={centerX - groupWidth / 2 + visibleIndex * barWidth}
                y={Math.min(zeroY, valueY)}
              />,
            ]
          })
        }

        let positive = 0
        let negative = 0
        return visibleSeriesIndexes.flatMap((seriesIndex) => {
          const value = chart.data.series[seriesIndex].values[labelIndex]
          if (value === null) return []
          const start = value >= 0 ? positive : negative
          const end = start + value
          if (value >= 0) positive = end
          else negative = end
          const startY = scaleChartValue(start, domain, plot.bottom, plot.top)
          const endY = scaleChartValue(end, domain, plot.bottom, plot.top)
          return [
            <Rect
              fill={palette.colors[seriesIndex]}
              height={Math.max(1, Math.abs(startY - endY))}
              key={`stack:${labelIndex}:${seriesIndex}`}
              onPress={() => onSelect(labelIndex)}
              rx={2}
              width={groupWidth}
              x={centerX - groupWidth / 2}
              y={Math.min(startY, endY)}
            />,
          ]
        })
      })}
      {chart.data.labels.map((label, index) => (
        <Rect
          accessibilityLabel={`${label}，点按查看数值`}
          fill="transparent"
          height={plot.bottom - plot.top}
          key={`touch:${index}`}
          onPress={() => onSelect(index)}
          width={categoryWidth}
          x={plot.left + categoryWidth * index}
          y={plot.top}
        />
      ))}
    </Svg>
  )
}

function HorizontalBarChartSvg({
  chart,
  height,
  onSelect,
  palette,
  visibleSeriesIndexes,
  width,
}: {
  chart: ClientBarChartMessageBody
  height: number
  onSelect: (index: number) => void
  palette: ChartPalette
  visibleSeriesIndexes: number[]
  width: number
}) {
  const plot = { bottom: height - 22, left: 84, right: width - 12, top: 12 }
  const domain = getBarChartDomain(chart, visibleSeriesIndexes)
  const zeroX = scaleChartValue(0, domain, plot.left, plot.right)
  const categoryHeight = (plot.bottom - plot.top) / chart.data.labels.length
  const groupHeight = Math.min(22, categoryHeight * 0.72)

  return (
    <Svg height={height} width={width}>
      <CartesianGrid domain={domain} palette={palette} plot={plot} vertical />
      {chart.data.labels.map((label, index) => (
        <SvgText
          fill={palette.muted}
          fontSize={10}
          key={`label:${index}`}
          textAnchor="end"
          x={plot.left - 8}
          y={plot.top + categoryHeight * (index + 0.5) + 3}
        >
          {truncateChartLabel(label)}
        </SvgText>
      ))}
      {chart.data.labels.flatMap((_, labelIndex) => {
        const centerY = plot.top + categoryHeight * (labelIndex + 0.5)
        if (chart.data.mode === "grouped") {
          const barHeight =
            visibleSeriesIndexes.length > 0
              ? groupHeight / visibleSeriesIndexes.length
              : groupHeight
          return visibleSeriesIndexes.flatMap((seriesIndex, visibleIndex) => {
            const value = chart.data.series[seriesIndex].values[labelIndex]
            if (value === null) return []
            const valueX = scaleChartValue(value, domain, plot.left, plot.right)
            return [
              <Rect
                fill={palette.colors[seriesIndex]}
                height={Math.max(1, barHeight - 1)}
                key={`bar:${labelIndex}:${seriesIndex}`}
                onPress={() => onSelect(labelIndex)}
                rx={2}
                width={Math.max(1, Math.abs(zeroX - valueX))}
                x={Math.min(zeroX, valueX)}
                y={centerY - groupHeight / 2 + visibleIndex * barHeight}
              />,
            ]
          })
        }

        let positive = 0
        let negative = 0
        return visibleSeriesIndexes.flatMap((seriesIndex) => {
          const value = chart.data.series[seriesIndex].values[labelIndex]
          if (value === null) return []
          const start = value >= 0 ? positive : negative
          const end = start + value
          if (value >= 0) positive = end
          else negative = end
          const startX = scaleChartValue(start, domain, plot.left, plot.right)
          const endX = scaleChartValue(end, domain, plot.left, plot.right)
          return [
            <Rect
              fill={palette.colors[seriesIndex]}
              height={groupHeight}
              key={`stack:${labelIndex}:${seriesIndex}`}
              onPress={() => onSelect(labelIndex)}
              rx={2}
              width={Math.max(1, Math.abs(startX - endX))}
              x={Math.min(startX, endX)}
              y={centerY - groupHeight / 2}
            />,
          ]
        })
      })}
      {chart.data.labels.map((label, index) => (
        <Rect
          accessibilityLabel={`${label}，点按查看数值`}
          fill="transparent"
          height={categoryHeight}
          key={`touch:${index}`}
          onPress={() => onSelect(index)}
          width={plot.right - plot.left}
          x={plot.left}
          y={plot.top + categoryHeight * index}
        />
      ))}
    </Svg>
  )
}

function PieMessageChart({
  chart,
  palette,
}: {
  chart: ClientPieChartMessageBody
  palette: ChartPalette
}) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const width = DEFAULT_CHART_WIDTH
  const height = 210
  const centerX = width / 2
  const centerY = height / 2
  const radius = 78
  const visibleTotal = chart.data.items.reduce(
    (sum, item, index) =>
      hiddenKeys.has(itemKey(index)) ? sum : sum + item.value,
    0
  )
  let angle = 0
  const slices = chart.data.items.flatMap((item, index) => {
    if (hiddenKeys.has(itemKey(index)) || visibleTotal === 0) return []
    const startAngle = angle
    const endAngle = angle + (item.value / visibleTotal) * 360
    angle = endAngle
    return [{ endAngle, index, item, startAngle }]
  })
  const selectedItem =
    selectedIndex === null || hiddenKeys.has(itemKey(selectedIndex))
      ? null
      : chart.data.items[selectedIndex]
  const details = selectedItem
    ? [
        {
          color: palette.colors[selectedIndex!],
          label: "数值",
          value: formatChartValue(selectedItem.value),
        },
        {
          color: palette.colors[selectedIndex!],
          label: "占比",
          value: `${formatChartValue((selectedItem.value / visibleTotal) * 100)}%`,
        },
      ]
    : []

  return (
    <View style={{ gap: 7 }}>
      <ChartViewport height={height} width={width}>
        <Svg height={height} width={width}>
          {visibleTotal === 0 ? (
            <Circle
              cx={centerX}
              cy={centerY}
              fill="none"
              r={radius}
              stroke={palette.grid}
              strokeWidth={2}
            />
          ) : (
            slices.map(({ endAngle, index, item, startAngle }) => (
              <SvgPath
                accessibilityLabel={`${item.name} ${formatChartValue(item.value)}`}
                d={createPieSlicePath(
                  centerX,
                  centerY,
                  radius,
                  startAngle,
                  endAngle
                )}
                fill={palette.colors[index]}
                key={itemKey(index)}
                onPress={() => setSelectedIndex(index)}
                stroke={palette.background}
                strokeWidth={2}
              />
            ))
          )}
        </Svg>
      </ChartViewport>
      <ChartTapResult details={details} label={selectedItem?.name ?? null} />
      <ChartLegend
        always
        hiddenKeys={hiddenKeys}
        items={chart.data.items.map((item, index) => ({
          color: palette.colors[index],
          key: itemKey(index),
          label: item.name,
        }))}
        onToggle={toggleKey}
      />
    </View>
  )
}

function RadarMessageChart({
  chart,
  palette,
}: {
  chart: ClientRadarChartMessageBody
  palette: ChartPalette
}) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const width = DEFAULT_CHART_WIDTH
  const height = 250
  const centerX = width / 2
  const centerY = 122
  const radius = 78
  const angleStep = 360 / chart.data.axes.length
  const visibleSeries = chart.data.series.flatMap((series, index) =>
    hiddenKeys.has(seriesKey(index)) ? [] : [{ index, series }]
  )
  const axisPoints = chart.data.axes.map((_, index) =>
    polarPoint(centerX, centerY, radius, index * angleStep)
  )
  const details =
    selectedIndex === null
      ? []
      : visibleSeries.map(({ index, series }) => ({
          color: palette.colors[index],
          label: series.name,
          value: formatChartValue(series.values[selectedIndex]),
        }))

  return (
    <View style={{ gap: 7 }}>
      <ChartViewport height={height} width={width}>
        <Svg height={height} width={width}>
          {[0.25, 0.5, 0.75, 1].map((level) => (
            <Polygon
              fill="none"
              key={`grid:${level}`}
              points={chart.data.axes
                .map((_, index) => {
                  const point = polarPoint(
                    centerX,
                    centerY,
                    radius * level,
                    index * angleStep
                  )
                  return `${point.x},${point.y}`
                })
                .join(" ")}
              stroke={palette.grid}
              strokeWidth={1}
            />
          ))}
          {axisPoints.map((point, index) => (
            <SvgLine
              key={`axis:${index}`}
              stroke={palette.grid}
              strokeWidth={1}
              x1={centerX}
              x2={point.x}
              y1={centerY}
              y2={point.y}
            />
          ))}
          {visibleSeries.map(({ index, series }) => (
            <Polygon
              fill={palette.colors[index]}
              fillOpacity={0.18}
              key={seriesKey(index)}
              points={series.values
                .map((value, axisIndex) => {
                  const point = polarPoint(
                    centerX,
                    centerY,
                    radius * (value / chart.data.axes[axisIndex].max),
                    axisIndex * angleStep
                  )
                  return `${point.x},${point.y}`
                })
                .join(" ")}
              stroke={palette.colors[index]}
              strokeLinejoin="round"
              strokeWidth={2}
            />
          ))}
          {chart.data.axes.map((axis, index) => {
            const labelPoint = polarPoint(
              centerX,
              centerY,
              radius + 18,
              index * angleStep
            )
            return (
              <SvgText
                fill={palette.muted}
                fontSize={10}
                key={`label:${index}`}
                onPress={() => setSelectedIndex(index)}
                textAnchor="middle"
                x={labelPoint.x}
                y={labelPoint.y + 3}
              >
                {truncateChartLabel(axis.name, 6)}
              </SvgText>
            )
          })}
          {axisPoints.map((point, index) => (
            <Circle
              accessibilityLabel={`${chart.data.axes[index].name}，点按查看数值`}
              cx={point.x}
              cy={point.y}
              fill="transparent"
              key={`touch:${index}`}
              onPress={() => setSelectedIndex(index)}
              r={16}
            />
          ))}
        </Svg>
      </ChartViewport>
      <ChartTapResult
        details={details}
        label={
          selectedIndex === null ? null : chart.data.axes[selectedIndex].name
        }
      />
      <ChartLegend
        hiddenKeys={hiddenKeys}
        items={seriesLegendItems(chart.data.series, palette)}
        onToggle={toggleKey}
      />
    </View>
  )
}

function CartesianGrid({
  domain,
  horizontal = false,
  palette,
  plot,
  vertical = false,
}: {
  domain: ChartDomain
  horizontal?: boolean
  palette: ChartPalette
  plot: { bottom: number; left: number; right: number; top: number }
  vertical?: boolean
}) {
  return getChartTicks(domain).map((tick, index) => {
    if (vertical) {
      const x = scaleChartValue(tick, domain, plot.left, plot.right)
      return (
        <Fragment key={`vertical:${index}`}>
          <SvgLine
            stroke={palette.grid}
            strokeWidth={1}
            x1={x}
            x2={x}
            y1={plot.top}
            y2={plot.bottom}
          />
          <SvgText
            fill={palette.muted}
            fontSize={10}
            textAnchor="middle"
            x={x}
            y={plot.bottom + 14}
          >
            {formatAxisChartValue(tick)}
          </SvgText>
        </Fragment>
      )
    }
    if (!horizontal) return null
    const y = scaleChartValue(tick, domain, plot.bottom, plot.top)
    return (
      <Fragment key={`horizontal:${index}`}>
        <SvgLine
          stroke={palette.grid}
          strokeWidth={1}
          x1={plot.left}
          x2={plot.right}
          y1={y}
          y2={y}
        />
        <SvgText
          fill={palette.muted}
          fontSize={10}
          textAnchor="end"
          x={plot.left - 6}
          y={y + 3}
        >
          {formatAxisChartValue(tick)}
        </SvgText>
      </Fragment>
    )
  })
}

function ChartViewport({
  children,
  height,
  vertical = false,
  width,
}: {
  children: React.ReactNode
  height: number
  vertical?: boolean
  width: number
}) {
  const content = vertical ? (
    <ScrollView
      style={{ maxHeight: MAX_VERTICAL_CHART_HEIGHT }}
      nestedScrollEnabled
      showsVerticalScrollIndicator={height > MAX_VERTICAL_CHART_HEIGHT}
    >
      <View style={{ height, width }}>
        {children}
      </View>
    </ScrollView>
  ) : (
    <View style={{ height, width }}>
      {children}
    </View>
  )

  return (
    <ScrollView
      horizontal
      style={{ maxWidth: "100%" }}
      nestedScrollEnabled
      showsHorizontalScrollIndicator={width > DEFAULT_CHART_WIDTH}
    >
      {content}
    </ScrollView>
  )
}

function ChartLegend({
  always = false,
  hiddenKeys,
  items,
  onToggle,
}: {
  always?: boolean
  hiddenKeys: ReadonlySet<string>
  items: ChartLegendItem[]
  onToggle: (key: string) => void
}) {
  const palette = useChartPalette()
  if (!always && items.length <= 1) return null

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, justifyContent: "center" }}>
      {items.map((item) => {
        const hidden = hiddenKeys.has(item.key)
        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: !hidden }}
            key={item.key}
            onPress={() => onToggle(item.key)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.65 : hidden ? 0.4 : 1,
            })}
          >
            <View style={{ alignItems: "center", flexDirection: "row", gap: 4, paddingVertical: 2 }}>
              <View style={{ backgroundColor: item.color, borderRadius: 2, height: 8, width: 8 }} />
              <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21 }}>{item.label}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function ChartTapResult({
  details,
  label,
}: {
  details: ChartDetailItem[]
  label: string | null
}) {
  const { colors } = useXGUITheme()
  const palette = useChartPalette()
  if (!label || details.length === 0) return null

  return (
    <View style={{ backgroundColor: colors.background1, borderColor: palette.border, borderRadius: 7, borderWidth: 1, gap: 2, padding: 7 }}>
      <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: "600", lineHeight: 21 }}>{label}</Text>
      {details.map((detail) => (
        <View key={`${detail.label}:${detail.value}`} style={{ alignItems: "center", flexDirection: "row", gap: 7, justifyContent: "space-between" }}>
          <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 4 }}>
            <View style={{ backgroundColor: detail.color, borderRadius: 2, height: 8, width: 8 }} />
            <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 14, lineHeight: 21 }}>{detail.label}</Text>
          </View>
          <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: "600", lineHeight: 21 }}>{detail.value}</Text>
        </View>
      ))}
    </View>
  )
}

function getBarChartDomain(
  chart: ClientBarChartMessageBody,
  visibleSeriesIndexes: number[]
) {
  if (chart.data.mode === "grouped") {
    return getChartDomain(
      visibleSeriesIndexes.flatMap(
        (seriesIndex) => chart.data.series[seriesIndex].values
      ),
      true
    )
  }

  const totals: number[] = []
  chart.data.labels.forEach((_, labelIndex) => {
    let positive = 0
    let negative = 0
    visibleSeriesIndexes.forEach((seriesIndex) => {
      const value = chart.data.series[seriesIndex].values[labelIndex]
      if (value === null) return
      if (value >= 0) positive += value
      else negative += value
    })
    totals.push(positive, negative)
  })
  return getChartDomain(totals, true)
}

function seriesLegendItems(
  series: readonly { name: string }[],
  palette: ChartPalette
) {
  return series.map((item, index) => ({
    color: palette.colors[index],
    key: seriesKey(index),
    label: item.name,
  }))
}

function seriesKey(index: number) {
  return `series${index + 1}`
}

function itemKey(index: number) {
  return `item${index + 1}`
}

function formatAxisChartValue(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) {
    return `${formatChartValue(value / 1_000_000_000)}B`
  }
  if (absolute >= 1_000_000) return `${formatChartValue(value / 1_000_000)}M`
  if (absolute >= 1_000) return `${formatChartValue(value / 1_000)}K`
  return formatChartValue(value)
}

function useHiddenChartItems() {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set())
  const toggleKey = useCallback((key: string) => {
    setHiddenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  return { hiddenKeys, toggleKey }
}

function useChartPalette(): ChartPalette {
  const { colors, colorScheme } = useXGUITheme()
  return useMemo(
    () => ({
      background: colors.background2,
      border: colorScheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)",
      colors: [
        colors.brand,
        colors.blue,
        colors.orange,
        colors.purple,
        colors.yellow,
      ],
      // Match Desktop's foreground (90% black / 80% white) at 5% opacity.
      grid: colorScheme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.045)",
      muted: colorScheme === "dark" ? "#A3A3A3" : "#737373",
      text: colors.textPrimary,
    }),
    [colors, colorScheme]
  )
}
