import fs from "node:fs";
import path from "node:path";

const artifactsDir = path.resolve(process.argv[2] ?? "release-artifacts");
const version = process.env.APP_VERSION;
const releaseTag = process.env.RELEASE_TAG;
const baseUrl = process.env.UPDATE_BASE_URL?.replace(/\/$/, "");

if (!version || !releaseTag || !baseUrl) {
  throw new Error(
    "APP_VERSION, RELEASE_TAG, and UPDATE_BASE_URL are required to create latest.json",
  );
}

const files = fs.readdirSync(artifactsDir);

function oneFile(predicate, description) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${description} in ${artifactsDir}; found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

function signatureFor(file) {
  const signatureFile = `${file}.sig`;
  if (!files.includes(signatureFile)) {
    throw new Error(`Missing updater signature: ${signatureFile}`);
  }
  return fs.readFileSync(path.join(artifactsDir, signatureFile), "utf8").trim();
}

function publicUrl(file) {
  return `${baseUrl}/releases/${releaseTag}/${encodeURIComponent(file)}`;
}

const linuxBundle = oneFile(
  (file) => file.endsWith(".AppImage"),
  "Linux AppImage updater bundle",
);
const macBundle = oneFile(
  (file) => file.endsWith(".app.tar.gz"),
  "universal macOS updater bundle",
);

const manifest = {
  version,
  notes: `PickPDF ${version} is available.`,
  pub_date: new Date().toISOString(),
  platforms: {
    "linux-x86_64": {
      url: publicUrl(linuxBundle),
      signature: signatureFor(linuxBundle),
    },
    "darwin-universal": {
      url: publicUrl(macBundle),
      signature: signatureFor(macBundle),
    },
  },
};

const outputPath = path.join(artifactsDir, "latest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
