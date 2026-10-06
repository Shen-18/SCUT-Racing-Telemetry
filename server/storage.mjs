import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export function safeUploadName(value) {
  const name = basename(String(value || "upload.bin")).replace(/[^\w.\-()]+/g, "_").replace(/_+/g, "_").trim();
  return name || "upload.bin";
}

export async function saveUpload(request, root = resolve(process.env.SCUT_UPLOAD_ROOT || "server/data/uploads")) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) throw new Error("上传文件不能超过 512 MB");
    chunks.push(Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks);
  const fileHash = createHash("sha256").update(data).digest("hex");
  const fileName = safeUploadName(request.headers["x-file-name"]);
  const storageKey = `${fileHash}${extname(fileName).toLowerCase()}`;
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, storageKey), data, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return {
    file_hash: fileHash,
    file_name: fileName,
    file_type: extname(fileName).replace(/^\./, "").toLowerCase() || "bin",
    file_size: size,
    storage_key: storageKey,
  };
}
