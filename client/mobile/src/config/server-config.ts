import { appConfig } from "@/config/app-config"
import {
  OFFICIAL_SERVER_ID,
  type ServerConfig,
} from "@/core/server-model"

export const officialServer: ServerConfig = {
  id: OFFICIAL_SERVER_ID,
  isBuiltIn: true,
  name: "演示服务器",
  url: appConfig.officialServerUrl,
}
