// utils/getFiles.js
import fs from "fs";
import path from "path";

const TEXT_FILE_EXTENSIONS = [".html", ".js", ".css", ".json", ".txt", ".md"];

function isTextFile(filePath) {
  return TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Recursively reads a directory and returns:
 * {
 *   "relative/path.ext": { data: "string" or "base64-encoded string" }
 * }
 */
export function getFilesFromDirectory(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = {};

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      files = {
        ...files,
        ...getFilesFromDirectory(fullPath, baseDir),
      };
    } else {
      const fileBuffer = fs.readFileSync(fullPath);

      files[relativePath] = {
        data: isTextFile(fullPath)
          ? fileBuffer.toString("utf-8")
          : fileBuffer.toString("base64"), // base64 for images or binary
      };
    }
  }

  return files;
}
