const {
  withEntitlementsPlist,
  withXcodeProject,
} = require("expo/config-plugins")

function withApnsEnvironments(config) {
  config = withEntitlementsPlist(config, (entitlementsConfig) => {
    entitlementsConfig.modResults["aps-environment"] = "$(APS_ENVIRONMENT)"
    return entitlementsConfig
  })

  return withXcodeProject(config, (projectConfig) => {
    const configurations =
      projectConfig.modResults.pbxXCBuildConfigurationSection()
    for (const configuration of Object.values(configurations)) {
      if (
        !configuration ||
        typeof configuration !== "object" ||
        typeof configuration.name !== "string" ||
        !configuration.buildSettings
      ) {
        continue
      }
      if (configuration.name === "Debug") {
        configuration.buildSettings.APS_ENVIRONMENT = "development"
      } else if (configuration.name === "Release") {
        configuration.buildSettings.APS_ENVIRONMENT = "production"
      }
    }
    return projectConfig
  })
}

module.exports = withApnsEnvironments
