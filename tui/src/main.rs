use mindtop::{config, db};

const USAGE: &str = "\
mindtop — top-like viewer for the mindgap graph

USAGE:
    mindtop                 run the TUI
    mindtop close <id>      mark a todo status:done and exit
    mindtop --help
    mindtop --version
";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        None => run_tui(),
        Some("--help") | Some("-h") => {
            println!("{USAGE}");
            0
        }
        Some("--version") | Some("-V") => {
            println!("mindtop {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some("close") => match args.get(1) {
            Some(id) => close(id),
            None => {
                eprintln!("mindtop close: missing <id>\n\n{USAGE}");
                2
            }
        },
        Some(other) => {
            eprintln!("mindtop: unknown argument {other:?}\n\n{USAGE}");
            2
        }
    };
    std::process::exit(code);
}

fn close(id: &str) -> i32 {
    let path = config::db_path();
    let conn = match db::open(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("mindtop: {e}");
            return 1;
        }
    };
    match db::close_todo(&conn, id) {
        Ok(true) => {
            println!("closed {id}");
            0
        }
        Ok(false) => {
            eprintln!("mindtop: no todo with id {id:?}");
            1
        }
        Err(e) => {
            eprintln!("mindtop: write failed: {e}");
            1
        }
    }
}

fn run_tui() -> i32 {
    use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
    use std::time::Duration;

    let path = config::db_path();
    let conn = match db::open(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("mindtop: {e}");
            return 1;
        }
    };

    let mut app = mindtop::app::App::new(conn);
    app.refresh();

    // try_init, not init: init() is `.expect(...)`, so redirecting or piping
    // mindtop's output — `mindtop > out.txt`, `mindtop | less`, cron — panicked
    // with a raw "Device not configured". Return before `restore()`, which must
    // not run against a terminal that was never put into raw mode.
    let mut terminal = match ratatui::try_init() {
        Ok(t) => t,
        Err(e) => {
            eprintln!(
                "mindtop: needs an interactive terminal — run it directly rather than \
                 redirecting or piping its output ({e})"
            );
            return 1;
        }
    };
    let result = (|| -> std::io::Result<()> {
        loop {
            terminal.draw(|f| mindtop::ui::draw(f, &app))?;
            // Poll rather than block, so the 1s tick refreshes even while idle.
            if event::poll(Duration::from_millis(1000))? {
                if let Event::Key(k) = event::read()? {
                    // Raw mode clears ISIG, so Ctrl-C arrives as Char('c') plus a
                    // CONTROL modifier. on_key takes a bare KeyCode and would read
                    // it as the close-todo key, arming a write prompt. Caught here,
                    // where the KeyEvent is still whole, and quitting through the
                    // same return as `q` so restore() still runs.
                    let ctrl_c =
                        k.code == KeyCode::Char('c') && k.modifiers.contains(KeyModifiers::CONTROL);
                    if k.kind == KeyEventKind::Press && (ctrl_c || app.on_key(k.code)) {
                        return Ok(());
                    }
                }
            } else {
                app.refresh();
            }
        }
    })();
    ratatui::restore();

    if let Err(e) = result {
        eprintln!("mindtop: {e}");
        return 1;
    }
    0
}
