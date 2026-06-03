#!/usr/bin/env node

const credentialSets = [
  {
    name: "App Store Connect API key",
    vars: ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
  },
  {
    name: "Apple ID app-specific password",
    vars: ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  },
  {
    name: "notarytool keychain profile",
    vars: ["APPLE_KEYCHAIN_PROFILE"],
  },
];

const hasCompleteSet = credentialSets.some(({ vars }) =>
  vars.every((name) => Boolean(process.env[name])),
);

if (hasCompleteSet) {
  process.exit(0);
}

const requiredGroups = credentialSets
  .map(({ name, vars }) => `- ${name}: ${vars.join(", ")}`)
  .join("\n");

console.error(
  [
    "Missing macOS notarization credentials.",
    "",
    "Set one complete credential group before running `npm run package:mac:notarized`:",
    requiredGroups,
    "",
    "Electron Builder will silently skip notarization when none of these are present.",
  ].join("\n"),
);

process.exit(1);
