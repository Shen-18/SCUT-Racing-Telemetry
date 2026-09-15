"""Validate direct dependency contracts using Python 3.11+ TOML parsing."""
import argparse
import json
from pathlib import Path
import tomllib

SECTIONS = ('dependencies', 'dev-dependencies', 'build-dependencies')

def load(path):
    with path.open('rb') as stream:
        return tomllib.load(stream)

def tables(data):
    for key in SECTIONS:
        yield from data.get(key, {}).items()
    for target in data.get('target', {}).values():
        for key in SECTIONS:
            yield from target.get(key, {}).items()

def check_manifest(root, manifest, workspace, edges, allowed):
    data = load(manifest)
    name = data['package']['name']
    errors = []
    for alias, spec in tables(data):
        declared = spec
        if isinstance(spec, dict) and spec.get('workspace'):
            if alias not in workspace:
                errors.append(f'{name}: missing workspace dependency {alias}')
                continue
            spec = workspace[alias]
        spec = {'version': spec} if isinstance(spec, str) else spec
        package = spec.get('package', alias)
        if 'path' in spec:
            if package not in edges.get(name, []):
                errors.append(f'{name}: forbidden edge -> {package}')
            target = (manifest.parent / spec['path']).resolve()
            expected = (root / 'crates' / package).resolve()
            if target != expected:
                errors.append(f'{name}: unexpected path for {package}: {target}')
        else:
            if package not in allowed:
                errors.append(f'{name}: Rust dependency not allowlisted: {package}')
            if not isinstance(declared, dict) or declared.get('workspace') is not True:
                errors.append(f'{name}: {alias} must inherit workspace version')
            if package.startswith('tauri') and name != 'scut-racing-telemetry':
                errors.append(f'{name}: desktop dependency forbidden: {package}')
            if 'git' in spec:
                errors.append(f'{name}: git dependencies forbidden')
    if data.get('patch') or data.get('replace'):
        errors.append(f'{name}: dependency overrides forbidden')
    return errors

def verify(root):
    contract = json.loads((root / 'config/contracts/dependencies.json').read_text(encoding='utf-8-sig'))
    data = load(root / 'Cargo.toml')
    workspace = data['workspace']['dependencies']
    errors = []
    if data.get('patch') or data.get('replace'):
        errors.append('root: dependency overrides forbidden')
    for name, spec in workspace.items():
        version = spec if isinstance(spec, str) else spec.get('version')
        if name not in contract['rust'] or version != contract['rust'].get(name):
            errors.append(f'workspace: dependency/version not allowlisted: {name} {version}')
        if isinstance(spec, dict) and any(k in spec for k in ('git', 'path', 'package')):
            errors.append(f'workspace: source override forbidden: {name}')
    expected_members = contract['members']
    if sorted(data['workspace']['members']) != sorted(expected_members):
        errors.append('workspace member set differs from contract')
    manifests = set(root.glob('crates/*/Cargo.toml')) | set(root.glob('src-tauri/Cargo.toml')) | set(root.glob('tests/*/Cargo.toml'))
    for manifest in manifests:
        if manifest.parent.relative_to(root).as_posix() not in expected_members:
            errors.append(f'unregistered manifest: {manifest}')
        errors.extend(check_manifest(root, manifest, workspace, contract['edges'], contract['rust']))
    pkg = json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))
    for section in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
        for name, version in pkg.get(section, {}).items():
            if contract['frontend'].get(name) != version:
                errors.append(f'frontend dependency/version not allowlisted: {name} {version}')
    # Architectural boundary: backend package imports and direct global IPC access.
    for file in (root / 'src').rglob('*'):
        if file.suffix in ('.ts', '.tsx', '.js', '.jsx') and file != root / 'src/api/client.ts':
            text = file.read_text(encoding='utf-8-sig')
            if '@tauri-apps/' in text or '__TAURI' in text:
                errors.append(f'frontend IPC outside client boundary: {file}')
    # Tauri major/minor version alignment between Rust crate and frontend package
    lock_file = root / 'Cargo.lock'
    if lock_file.exists():
        import re
        lock_text = lock_file.read_text(encoding='utf-8', errors='replace')
        m = re.search(r'\[\[package\]\]\s+name\s*=\s*"tauri"\s+version\s*=\s*"([^"]+)"', lock_text)
        if m:
            rust_tauri_v = m.group(1)
            api_v = pkg.get('dependencies', {}).get('@tauri-apps/api')
            if api_v:
                clean_api_v = re.sub(r'^[^\d]*', '', api_v)
                rust_parts = rust_tauri_v.split('.')
                api_parts = clean_api_v.split('.')
                if len(rust_parts) >= 2 and len(api_parts) >= 2:
                    if (rust_parts[0], rust_parts[1]) != (api_parts[0], api_parts[1]):
                        errors.append(
                            f'Tauri major/minor version mismatch: Rust tauri ({rust_tauri_v}) '
                            f'vs frontend @tauri-apps/api ({api_v})'
                        )
    return errors

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    failures = verify(args.root.resolve())
    print('\n'.join(failures) if failures else 'Dependency contracts: PASS')
    raise SystemExit(bool(failures))
