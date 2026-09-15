//! Deterministic file expansion for StartImportBatch.
use std::collections::BTreeSet;
use std::path::PathBuf;
use telemetry_ipc::CmdError;

pub fn expand(paths: Vec<PathBuf>, recursive: bool) -> Result<Vec<PathBuf>, CmdError> {
    fn error(e: impl std::fmt::Display) -> CmdError {
        CmdError {
            code: "invalid_import_path".into(),
            message: e.to_string(),
        }
    }
    fn supported(path: &std::path::Path) -> bool {
        path.extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("xrk") || ext.eq_ignore_ascii_case("agx"))
    }
    let mut files = BTreeSet::new();
    let mut folders = Vec::new();
    let mut visited = BTreeSet::new();
    for path in paths {
        let path = path.canonicalize().map_err(error)?;
        if path.is_dir() {
            folders.push(path);
        } else if path.is_file() && supported(&path) {
            files.insert(path);
        } else {
            return Err(error(format!("unsupported input: {}", path.display())));
        }
    }
    while let Some(folder) = folders.pop() {
        if !visited.insert(folder.clone()) {
            continue;
        }
        for entry in std::fs::read_dir(folder).map_err(error)? {
            let entry = entry.map_err(error)?;
            let kind = entry.file_type().map_err(error)?;
            // Do not follow links/junctions into unrelated directory trees.
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() && recursive {
                folders.push(path.canonicalize().map_err(error)?);
            } else if kind.is_file() && supported(&path) {
                files.insert(path.canonicalize().map_err(error)?);
            }
        }
    }
    Ok(files.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expands_folders_deduplicates_and_honors_recursion() {
        let root = std::env::temp_dir().join(format!("step4-batch-{}", std::process::id()));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("a.xrk"), b"fixture").unwrap();
        std::fs::write(root.join("ignore.txt"), b"ignore").unwrap();
        std::fs::write(root.join("nested/b.XRK"), b"fixture").unwrap();
        let shallow = expand(vec![root.clone(), root.join("a.xrk")], false).unwrap();
        assert_eq!(shallow, vec![root.join("a.xrk").canonicalize().unwrap()]);
        assert_eq!(expand(vec![root], true).unwrap().len(), 2);
    }
    #[test]
    fn missing_or_unsupported_explicit_files_are_errors() {
        assert!(expand(vec![PathBuf::from("does-not-exist-step4.xrk")], false).is_err());
        assert!(expand(
            vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")],
            false
        )
        .is_err());
    }
}
