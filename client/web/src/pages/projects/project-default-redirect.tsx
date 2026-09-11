import { Navigate, useLocation, useParams } from "react-router"

export function ProjectDefaultRedirect() {
  const location = useLocation()
  const { projectId = "" } = useParams<{ projectId: string }>()
  return (
    <Navigate
      replace
      to={{
        pathname: `/projects/${encodeURIComponent(projectId)}/tasks`,
        search: location.search,
      }}
    />
  )
}
