import { defaultProfile } from "./defaultProfile.js";
import { circleFavoritesProfile } from "./circleFavoritesProfile.js";

export const profiles = {
  default: defaultProfile,
  "circle-favorites": circleFavoritesProfile
};

export function getProfileByName(profileName) {
  return profiles[profileName] || null;
}

export function getProfileOptions() {
  return Object.values(profiles).map((profile) => ({
    name: profile.name,
    description: profile.description || "",
    supportsPagination: Boolean(profile.pagination?.enabled),
    supportsManualLoginWait: Boolean(profile.loginWait?.enabled),
    extractorType: typeof profile.extractor === "function" ? "custom" : "default"
  }));
}