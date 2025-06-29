import { Vercel } from "@vercel/sdk";
import fs from "fs";
import path from "path";

// 1. Setup your Vercel instance with API token
const vercel = new Vercel({
  bearerToken: "DOt4KWyw0sWNrtDxVNQFWOaw", // replace with your real token
});

// 2. List of file extensions that should be treated as text
const TEXT_FILE_EXTENSIONS = [".html", ".js", ".css", ".json", ".txt", ".md"];

// 3. Check if file is text or binary
function isTextFile(filePath) {
  return TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

// 4. Recursively read all files and return array for Vercel SDK
function getFilesArray(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      files = files.concat(getFilesArray(fullPath, baseDir));
    } else {
      const fileBuffer = fs.readFileSync(fullPath);
      const data = isTextFile(fullPath)
        ? fileBuffer.toString("utf-8")
        : fileBuffer.toString("base64");

      files.push({ file: relativePath, data });
    }
  }

  return files;
}

async function run() {
  const files = getFilesArray("./cloned");

  const result = await vercel.deployments.createDeployment({
    teamId: "team_RtcpHQkXpOdUuDtn48R0I2HT", // optional, remove if not using a team
    slug: "ibrahimverceloooooo",
    requestBody: {
      name: "cloned-site-ibroo",
      project: "cloned-site-ibroo",
      target: "production",
      files: files,
      projectSettings: {
        framework: null,
        buildCommand: null,
        installCommand: null,
        outputDirectory: "public", // or "." if your site has no public folder
      },
    },
  });

  console.log("✅ Deployment complete!");
  console.log("🔗 URL:", result.url);
  console.log("🔗 Live site:", `https://${result.name}.vercel.app`);
  console.log("🔗 URL:", result);

}

run().catch(console.error);
