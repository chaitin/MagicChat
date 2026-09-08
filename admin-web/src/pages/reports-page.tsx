import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  type AdminReport,
  type AdminReportUser,
  AdminReportRequestError,
  listAdminReports,
  reportReasonLabels,
} from "@/lib/admin-reports"

const PAGE_SIZE = 20

export default function ReportsPage() {
  const [reports, setReports] = useState<AdminReport[]>([])
  const [page, setPage] = useState(1)
  const [loadedPage, setLoadedPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    let ignore = false

    async function loadReports() {
      setIsLoading(true)
      setLoadError(false)
      try {
        const result = await listAdminReports({ page, pageSize: PAGE_SIZE })
        if (ignore) return
        setReports(result.reports)
        setLoadedPage(result.page)
        setTotal(result.total)
      } catch (error) {
        if (ignore) return
        setLoadError(true)
        toast.error(
          error instanceof AdminReportRequestError
            ? error.message
            : "加载举报记录失败"
        )
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }

    void loadReports()
    return () => {
      ignore = true
    }
  }, [page, reloadKey])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">共 {total} 条举报记录</p>
        <Button
          disabled={isLoading}
          onClick={() => setReloadKey((current) => current + 1)}
          size="sm"
          variant="outline"
        >
          {isLoading ? <Spinner /> : <RefreshCwIcon />}
          刷新
        </Button>
      </div>

      <Card className="min-w-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">提交时间</TableHead>
                <TableHead className="min-w-52">被举报用户</TableHead>
                <TableHead className="min-w-52">举报人</TableHead>
                <TableHead className="min-w-36">举报原因</TableHead>
                <TableHead className="min-w-80">举报描述</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError && loadedPage !== page ? (
                <TableRow>
                  <TableCell
                    className="h-40 text-center text-muted-foreground"
                    colSpan={5}
                  >
                    加载失败，请重试
                  </TableCell>
                </TableRow>
              ) : loadedPage !== page ? (
                <TableRow>
                  <TableCell className="h-40 text-center" colSpan={5}>
                    <Spinner className="mx-auto" />
                  </TableCell>
                </TableRow>
              ) : reports.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-40 text-center text-muted-foreground"
                    colSpan={5}
                  >
                    暂无举报记录
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="align-top text-muted-foreground">
                      {formatReportTime(report.createdAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      <ReportUser user={report.reportedUser} />
                    </TableCell>
                    <TableCell className="align-top">
                      <ReportUser user={report.reporterUser} />
                    </TableCell>
                    <TableCell className="align-top font-medium">
                      {reportReasonLabels[report.reason] ?? report.reason}
                    </TableCell>
                    <TableCell className="max-w-xl whitespace-normal align-top leading-6">
                      {report.description}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground">
          第 {page} / {pageCount} 页
        </span>
        <Button
          aria-label="上一页"
          disabled={isLoading || page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          size="icon-sm"
          variant="outline"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          aria-label="下一页"
          disabled={isLoading || page >= pageCount}
          onClick={() => setPage((current) => current + 1)}
          size="icon-sm"
          variant="outline"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

function ReportUser({ user }: { user: AdminReportUser }) {
  const displayName = user.nickname.trim() || user.name.trim() || "未知用户"
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9">
        <AvatarImage alt={displayName} src={user.avatar} />
        <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {user.email || user.phone || user.id}
        </p>
      </div>
    </div>
  )
}

function formatReportTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
