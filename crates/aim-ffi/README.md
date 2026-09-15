# Incremental XRK import

Use one shared `AimActor` for DLL work. The existing `open_xrk` and
`open_xrk_laps` APIs retain their full-import behavior.

```rust,ignore
let header = actor.metadata(path.clone()).await?;
// Publish header.meta, header.laps and header.channels before loading samples.
// A job can now choose/reorder channel keys between requests.
let selected = actor.read_channels(path.clone(), vec![key]).await?;
```

`metadata(PathBuf) -> Future<Output = Result<ImportMetadata, TelemetryError>>`
returns session header fields, laps and a channel catalog. It calls header and
sample-count exports only, never sample-buffer exports. `ImportMetadata` has no
series field. Neither `ImportSession` nor `ImportChannel` invents a sample rate:
the DLL provides no header-only rate export. The vendor may itself parse/map the
file inside `open_file`; this API does not promise lazy vendor internals.

`read_channels(PathBuf, Vec<String>) -> Future<Output = Result<TelemetryDataset,
TelemetryError>>` selects **keys**, not display names. It returns requested
channels only, in catalog order, with the same normalization and derivations as
full import. Duplicate keys are collapsed. Empty selection reads no samples.
Unknown keys fail with `NotFound` before any samples are read; file and vendor
failures return `Dll`. No failed read is substituted with empty or zero samples.
Channel rates are computed from the returned timestamps. The returned session
rate is the maximum among selected channels (zero for an empty selection), not
a claim about unselected channels.

Latitude/longitude/altitude read raw ECEF position X/Y/Z. Derived speed reads raw
ECEF velocity X/Y/Z. Distance additionally derives and integrates that speed.
Dependencies are loaded once per request and are not returned unless requested.
Official interpolated GPS speed remains a separate channel with its existing
time and unit conversion.

Both APIs open, read and close entirely on the existing actor thread, reopening
per request. Keep the source file unchanged between discovery and reads. No
job scheduling or preemption is added: callers should submit small selections
and reconsider priority between completed requests rather than enqueueing all
channels ahead of time.

## Verification

Run `cargo test -p aim-ffi --offline -- --test-threads=1` on Windows with the
repository's real DLL and `Data/AGX.xrk`. Do not run separate DLL test processes
against AGX concurrently: vendor temporary filenames can collide. Tests compare
every individually selected AGX channel with full import, retain the existing
golden test, and trace real forwarded DLL exports to check zero sample reads for
metadata and exact dependency-scoped reads. Fixtures are required; missing DLL
or XRK files are failures, not skipped successes.
