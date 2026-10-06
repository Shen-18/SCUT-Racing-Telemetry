const REQUIRED_DATASET_FIELDS = [
  "file_hash",
  "file_name",
  "file_type",
  "record_date",
  "start_time",
  "session",
  "vehicle",
  "racer",
  "championship",
];

const numberField = (value, fallback = 0) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("dataset 包含无效数字字段");
  return parsed;
};

export function normalizeDatasetInput(dataset) {
  // 字段必须存在且为字符串，但允许空串：桌面端可能没有车辆/车手/锦标赛信息
  if (!dataset || REQUIRED_DATASET_FIELDS.some((key) => typeof dataset[key] !== "string")) {
    throw new Error("dataset 缺少必要字段");
  }

  return {
    file_hash: dataset.file_hash.trim(),
    file_name: dataset.file_name.trim(),
    file_type: dataset.file_type.trim().toLowerCase(),
    record_date: dataset.record_date.trim(),
    start_time: dataset.start_time.trim(),
    session: dataset.session.trim(),
    vehicle: dataset.vehicle.trim(),
    racer: dataset.racer.trim(),
    championship: dataset.championship.trim(),
    duration: numberField(dataset.duration),
    sample_rate_hz: numberField(dataset.sample_rate_hz),
    file_size: Math.trunc(numberField(dataset.file_size)),
    source_mtime_unix: Math.trunc(numberField(dataset.source_mtime_unix)),
    storage_key: typeof dataset.storage_key === "string" ? dataset.storage_key.trim() : null,
    is_archived: Boolean(dataset.is_archived),
  };
}

export function normalizeDatasetInputs(list) {
  if (!Array.isArray(list)) throw new Error("datasets 必须是数组");
  if (list.length === 0) throw new Error("datasets 不能为空");
  if (list.length > 2000) throw new Error("单次同步不能超过 2000 条记录");
  return list.map((item) => normalizeDatasetInput(item));
}

export function normalizeDateNote(note) {
  const value = String(note ?? "").trim();
  if (value.length > 2000) throw new Error("日期备注不能超过 2000 个字符");
  return value;
}
