import { Navigate, Route, Routes } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"
import { ClientBrandMetadata } from "@/components/client-brand-metadata"
import { ClientDataProvider } from "@/components/client-data-provider"
import { ClientDocumentTitle } from "@/components/client-document-title"
import { ClientMessageNotificationSync } from "@/components/client-message-notification-sync"
import { ClientRealtimeProvider } from "@/components/client-realtime-provider"
import { ClientVersionUpdateDialog } from "@/components/client-version-update-dialog"
import { ClientUserDirectoryRealtimeSync } from "@/components/client-user-directory-realtime-sync"
import { GlobalBeforeUnloadGuard } from "@/components/global-before-unload-guard"
import { AppInfoProvider } from "@/components/app-info-provider"
import { ChatPage } from "@/pages/chat-page"
import { ContactsPage } from "@/pages/contacts-page"
import { DebugColorsPage } from "@/pages/debug-colors-page"
import { DocumentPage } from "@/pages/document-page"
import { LoginPage } from "@/pages/login-page"
import { ProjectDefaultRedirect } from "@/pages/projects/project-default-redirect"
import { ProjectDetailLayout } from "@/pages/projects/project-detail-layout"
import { ProjectDocumentsPage } from "@/pages/projects/project-documents-page"
import { ProjectEmptyPage } from "@/pages/projects/project-empty-page"
import { ProjectGoalsPage } from "@/pages/projects/project-goals-page"
import { ProjectsLayout } from "@/pages/projects/projects-layout"
import { ProjectMembersPage } from "@/pages/projects/project-members-page"
import { ProjectTasksPage } from "@/pages/projects/project-tasks-page"
import { TaskWorkspacePage } from "@/pages/tasks/task-workspace-page"

export function App() {
  return (
    <AppInfoProvider>
      <ClientBrandMetadata />
      <ClientVersionUpdateDialog />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={
            <>
              <ClientDocumentTitle title="登录" disableMessageAlert />
              <LoginPage />
            </>
          }
        />
        <Route
          path="/debug/colors"
          element={
            <>
              <ClientDocumentTitle title="WeUI 颜色变量" disableMessageAlert />
              <DebugColorsPage />
            </>
          }
        />
        <Route
          path="/documents/:documentType/:documentId"
          element={<DocumentWorkspaceRoute />}
        />
        <Route
          path="/tasks/:projectId/:taskId?"
          element={<TaskWorkspaceRoute />}
        />
        <Route
          element={
            <>
              <GlobalBeforeUnloadGuard />
              <ClientDataProvider>
                <ClientRealtimeProvider>
                  <ClientConversationRealtimeSync />
                  <ClientMessageNotificationSync />
                  <ClientUserDirectoryRealtimeSync />
                  <AppLayout />
                </ClientRealtimeProvider>
              </ClientDataProvider>
            </>
          }
        >
          <Route
            path="/init"
            element={
              <>
                <ClientDocumentTitle title="正在加载" disableMessageAlert />
                <InitPage />
              </>
            }
          />
          <Route
            path="/chat/:conversationId?"
            element={
              <>
                <ClientDocumentTitle title="聊天" />
                <ChatPage />
              </>
            }
          />
          <Route
            path="/contacts/:directoryType?/:directoryId?"
            element={
              <>
                <ClientDocumentTitle title="联系人" />
                <ContactsPage />
              </>
            }
          />
          <Route
            path="/projects"
            element={
              <>
                <ClientDocumentTitle title="项目" />
                <ProjectsLayout />
              </>
            }
          >
            <Route index element={<ProjectEmptyPage />} />
            <Route path=":projectId" element={<ProjectDetailLayout />}>
              <Route index element={<ProjectDefaultRedirect />} />
              <Route path="tasks" element={<ProjectTasksPage />} />
              <Route path="goals" element={<ProjectGoalsPage />} />
              <Route path="documents" element={<ProjectDocumentsPage />} />
              <Route path="members" element={<ProjectMembersPage />} />
              <Route path="*" element={<ProjectDefaultRedirect />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AppInfoProvider>
  )
}

export default App

function DocumentWorkspaceRoute() {
  return (
    <ClientDataProvider>
      <ClientRealtimeProvider>
        <ClientUserDirectoryRealtimeSync />
        <DocumentPage />
      </ClientRealtimeProvider>
    </ClientDataProvider>
  )
}

function TaskWorkspaceRoute() {
  return (
    <ClientDataProvider>
      <ClientRealtimeProvider>
        <ClientUserDirectoryRealtimeSync />
        <ClientDocumentTitle title="任务" />
        <TaskWorkspacePage />
      </ClientRealtimeProvider>
    </ClientDataProvider>
  )
}

function InitPage() {
  return <Navigate to="/chat" replace />
}
