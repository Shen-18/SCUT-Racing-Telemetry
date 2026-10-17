import React, { useState } from "react";
import type { RecordSummary } from "../api/client";

export const RecordNoteDialog: React.FC<{
  record: RecordSummary;
  onSave(note: string): Promise<void>;
  onClose(): void;
}> = ({ record, onSave, onClose }) => {
  const [note, setNote] = useState(record.record_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(note);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message :
        typeof failure === "object" && failure !== null && "message" in failure ? String(failure.message) : String(failure));
      setSaving(false);
    }
  };

  return (
    <div className="record-note-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-note-title"
        className="record-note-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <h2 id="record-note-title">编辑备注</h2>
        <div className="record-note-dialog__file" title={record.file_name}>{record.file_name}</div>
        <textarea
          autoFocus
          aria-label="记录备注"
          maxLength={2000}
          rows={5}
          value={note}
          disabled={saving}
          onChange={(event) => setNote(event.target.value)}
          placeholder="为这条记录添加本地备注"
        />
        {error && <div role="alert" className="record-note-dialog__error">{error}</div>}
        <div className="record-note-dialog__actions">
          <button className="ghost-button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </section>
    </div>
  );
};
