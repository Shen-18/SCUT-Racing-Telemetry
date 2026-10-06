use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("用法: xrk-meta <file.xrk | file.xrz>");
        return ExitCode::from(2);
    }
    match xrk_meta::extract(Path::new(&args[1])) {
        Ok(meta) => {
            match serde_json::to_string(&meta) {
                Ok(line) => println!("{line}"),
                Err(e) => {
                    eprintln!("序列化失败: {e}");
                    return ExitCode::from(2);
                }
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}", e.0);
            ExitCode::from(2)
        }
    }
}
