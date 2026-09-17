use std::path::PathBuf;

/// Resolve the graph DB path using the same precedence as mindgap/config.py:
/// $MINDGAP_DB, else $MINDGAP_HOME/mindgap.db, else ~/.mindgap/mindgap.db
pub fn db_path() -> PathBuf {
    db_path_from(|k| std::env::var(k).ok())
}

pub fn db_path_from(get: impl Fn(&str) -> Option<String>) -> PathBuf {
    let non_empty = |k: &str| get(k).filter(|v| !v.is_empty());
    if let Some(p) = non_empty("MINDGAP_DB") {
        return PathBuf::from(p);
    }
    if let Some(h) = non_empty("MINDGAP_HOME") {
        return PathBuf::from(h).join("mindgap.db");
    }
    let home = non_empty("HOME").unwrap_or_default();
    PathBuf::from(home).join(".mindgap").join("mindgap.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn explicit_db_wins() {
        let p = db_path_from(env(&[
            ("MINDGAP_DB", "/tmp/a.db"),
            ("MINDGAP_HOME", "/tmp/home"),
            ("HOME", "/Users/x"),
        ]));
        assert_eq!(p, PathBuf::from("/tmp/a.db"));
    }

    #[test]
    fn home_var_is_next() {
        let p = db_path_from(env(&[("MINDGAP_HOME", "/tmp/h"), ("HOME", "/Users/x")]));
        assert_eq!(p, PathBuf::from("/tmp/h/mindgap.db"));
    }

    #[test]
    fn falls_back_to_dotdir() {
        let p = db_path_from(env(&[("HOME", "/Users/x")]));
        assert_eq!(p, PathBuf::from("/Users/x/.mindgap/mindgap.db"));
    }

    #[test]
    fn empty_string_is_not_a_value() {
        let p = db_path_from(env(&[("MINDGAP_DB", ""), ("HOME", "/Users/x")]));
        assert_eq!(p, PathBuf::from("/Users/x/.mindgap/mindgap.db"));
    }
}
