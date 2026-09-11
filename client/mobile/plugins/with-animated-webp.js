const { withGradleProperties } = require("expo/config-plugins")

const PROPERTY_NAME = "expo.webp.animated"

module.exports = function withAnimatedWebp(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const property = gradleConfig.modResults.find(
      (item) => item.type === "property" && item.key === PROPERTY_NAME
    )

    if (property) {
      property.value = "true"
    } else {
      gradleConfig.modResults.push({
        key: PROPERTY_NAME,
        type: "property",
        value: "true",
      })
    }

    return gradleConfig
  })
}
