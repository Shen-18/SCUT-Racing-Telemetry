import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export function safeUploadName(value) {
  const raw = String(value || "upload.bin");
  // 管理页上传会用 encodeURIComponent 编码文件名（空格 → %20）；必须先解码再清洗，
  // 否则 % 被当作非法字符替换成 _，留下 "SCUT_20Racing" 这类名字。
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 文件名自带未配对的 %（如 "100%off.xrk"）时按原文处理
  }
  // 保留上传时的中文、字母、数字、空格和常用文件名符号；路径分隔符必须剥离。
  const leaf = decoded.replace(/^.*[\\/]/, "");
  const name = leaf
    .replace(/[^\p{L}\p{N}._()\- ]+/gu, "_")
    .replace(/_+/g, "_")
    .trim();
  return name || "upload.bin";
}

/** 文件内车手为空时，按“车手_已知车辆_场地…”的原文件名补齐；无法匹配则留空。 */
export function resolveUploadRacer(meta, fileName) {
  const racer = String(meta.racer || "").trim();
  if (racer) return racer;
  const vehicle = String(meta.vehicle || "").trim().replace(/[\s_]+/g, "_");
  if (!vehicle) return "";
  const stem = basename(fileName, extname(fileName)).replace(/[\s_]+/g, "_");
  const marker = `_${vehicle}_`;
  const vehicleStart = stem.toLowerCase().indexOf(marker.toLowerCase());
  if (vehicleStart <= 0) return "";
  const prefix = stem.slice(0, vehicleStart);
  if (/^[0-9a-f]{64}$/i.test(prefix)) return "";
  return prefix.replace(/_/g, " ").trim();
}

export function uploadRootDir() {
  return resolve(process.env.SCUT_UPLOAD_ROOT || "server/data/uploads");
}

export async function saveUpload(request, root = uploadRootDir()) {
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
  const targetPath = resolve(root, storageKey);
  await writeFile(targetPath, data, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return {
    file_hash: fileHash,
    file_name: fileName,
    file_type: extname(fileName).replace(/^\./, "").toLowerCase() || "bin",
    file_size: size,
    storage_key: storageKey,
    path: targetPath,
  };
}
