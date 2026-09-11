import { appConfig } from "@/config/app-config"
import {
  OFFICIAL_SERVER_ID,
  type ServerConfig,
} from "@/core/server-model"

export const officialServer: ServerConfig = {
  id: OFFICIAL_SERVER_ID,
  isBuiltIn: true,
  name: "即应官方服务器",
  url: appConfig.officialServerUrl,
}
