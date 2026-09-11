import assert from "node:assert/strict"
import test from "node:test"

import {
  hasNewAppVersion,
  readPlatformRelease,
} from "../src/features/updates/app-update-model.ts"

test("reads the selected platform from the release manifest", () => {
  const release = readPlatformRelease(
    {
      android: {
        build: 2,
        url: "https://jiying.chat/releases/jiying.apk",
        version: "1.0.1",
      },
      ios: {
        build: 5,
        url: "https://jiying.chat/releases/jiying.ipa",
        version: "1.0.1",
      },
    },
    "android"
  )

  assert.deepEqual(release, {
    build: 2,
    url: "https://jiying.chat/releases/jiying.apk",
    version: "1.0.1",
  })
})

test("compares releases by their numeric build", () => {
  const release = {
    build: 2,
    url: "https://jiying.chat/releases/jiying.apk",
    version: "1.0.1",
  }

  assert.equal(hasNewAppVersion(1, release), true)
  assert.equal(hasNewAppVersion(2, release), false)
  assert.equal(hasNewAppVersion(3, release), false)
})

test("rejects malformed or insecure platform releases", () => {
  assert.throws(
    () =>
      readPlatformRelease(
        {
          android: {
            build: "2",
            url: "http://jiying.chat/releases/jiying.apk",
            version: "1.0.1",
          },
        },
        "android"
      ),
    /build/
  )
})
