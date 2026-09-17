use mindtop::db::{self, Dir};
use rusqlite::Connection;

const SCHEMA: &str = include_str!("../../mindgap/schema.sql");

fn fixture() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    let rows = [
        // id, title, type, tags, created_at, updated_at
        ("open-todo", "Open one", "todo", r#"["todo","status:open"]"#, "2026-09-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00"),
        ("odd-todo", "Odd tagged", "todo", r#"["todo","open-action"]"#, "2026-09-02T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
        ("done-todo", "Closed one", "todo", r#"["todo","status:done"]"#, "2026-09-03T00:00:00+00:00", "2026-09-03T00:00:00+00:00"),
        ("dropped-todo", "Dropped one", "todo", r#"["todo","status:dropped"]"#, "2026-09-03T00:00:00+00:00", "2026-09-03T00:00:00+00:00"),
        ("doing-todo", "In flight", "todo", r#"["todo","status:doing"]"#, "2026-09-03T00:00:00+00:00", "2026-09-03T00:00:00+00:00"),
        ("paper-a", "A paper", "paper", r#"["ml"]"#, "2026-09-05T00:00:00+00:00", "2026-09-01T00:00:00+00:00"),
        ("proj-b", "A project", "project", r#"[]"#, "2026-09-04T00:00:00+00:00", "2026-09-09T00:00:00+00:00"),
    ];
    for (id, title, ty, tags, created, updated) in rows {
        conn.execute(
            "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)
             VALUES(?1,?2,?3,'',?4,'[]',1.0,'test',?5,?6)",
            rusqlite::params![id, title, ty, tags, created, updated],
        ).unwrap();
    }
    conn.execute(
        "INSERT INTO edges(src,dst,rel,weight,created_by,created_at)
         VALUES('open-todo','proj-b','part_of',1.0,'test','2026-09-01T00:00:00+00:00')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO edges(src,dst,rel,weight,created_by,created_at)
         VALUES('paper-a','open-todo','resolved_by',1.0,'test','2026-09-01T00:00:00+00:00')",
        [],
    ).unwrap();
    conn
}

#[test]
fn todos_exclude_done_but_keep_oddly_tagged() {
    let conn = fixture();
    let ids: Vec<String> = db::todos(&conn).unwrap().into_iter().map(|n| n.id).collect();
    assert!(ids.contains(&"open-todo".to_string()));
    assert!(ids.contains(&"odd-todo".to_string()), "a todo with no status:* tag must stay visible");
    assert!(!ids.contains(&"done-todo".to_string()));
}

/// `status:dropped` is as terminal as `status:done` (todo-mindmap SKILL.md:88
/// closes a todo to either), so a dropped todo must not come back into the pane.
/// `status:doing` is in-flight work and stays open.
#[test]
fn todos_exclude_dropped_but_keep_doing() {
    let conn = fixture();
    let ids: Vec<String> = db::todos(&conn).unwrap().into_iter().map(|n| n.id).collect();
    assert!(!ids.contains(&"dropped-todo".to_string()), "a dropped todo is closed, not open");
    assert!(ids.contains(&"doing-todo".to_string()), "in-flight work must stay visible");
}

#[test]
fn recent_orders_by_created_at_not_updated_at() {
    let conn = fixture();
    let ids: Vec<String> = db::recent(&conn, 10).unwrap().into_iter().map(|n| n.id).collect();
    // paper-a is newest by created_at; proj-b is newest by updated_at and must NOT lead.
    assert_eq!(ids.first().unwrap(), "paper-a");
}

#[test]
fn recent_respects_limit() {
    let conn = fixture();
    assert_eq!(db::recent(&conn, 2).unwrap().len(), 2);
}

#[test]
fn links_resolve_in_both_directions() {
    let conn = fixture();
    let links = db::links(&conn, "open-todo").unwrap();
    let out = links.iter().find(|l| matches!(l.dir, Dir::Out)).unwrap();
    assert_eq!(out.id, "proj-b");
    assert_eq!(out.rel, "part_of");
    assert_eq!(out.title, "A project");
    let inc = links.iter().find(|l| matches!(l.dir, Dir::In)).unwrap();
    assert_eq!(inc.id, "paper-a");
    assert_eq!(inc.rel, "resolved_by");
}

#[test]
fn node_parses_tags_and_missing_id_is_none() {
    let conn = fixture();
    let n = db::node(&conn, "open-todo").unwrap().unwrap();
    assert_eq!(n.tags, vec!["todo".to_string(), "status:open".to_string()]);
    assert_eq!(n.node_type, "todo");
    assert!(db::node(&conn, "nope").unwrap().is_none());
}

#[test]
fn urls_tolerate_bare_strings_and_dicts() {
    let conn = fixture();
    conn.execute(
        r#"UPDATE nodes SET urls='["https://bare.example", {"label":"L","url":"https://d.example","kind":"web"}]' WHERE id='paper-a'"#,
        [],
    ).unwrap();
    let n = db::node(&conn, "paper-a").unwrap().unwrap();
    assert_eq!(n.urls.len(), 2);
    assert_eq!(n.urls[0].url, "https://bare.example");
    assert_eq!(n.urls[0].label, "https://bare.example");
    assert_eq!(n.urls[1].label, "L");
}

#[test]
fn open_reports_a_missing_file_as_an_error() {
    let err = db::open(std::path::Path::new("/nonexistent/dir/x.db")).unwrap_err();
    assert!(err.contains("no graph database"), "got: {err}");
}

#[test]
fn now_utc_matches_pythons_isoformat_shape() {
    let s = mindtop::db::now_utc();
    // Python: datetime.now(timezone.utc).isoformat(timespec="seconds")
    // -> 2026-09-16T13:45:47+00:00 . Not 'Z', and no fractional seconds.
    assert_eq!(s.len(), 25, "got {s}");
    assert!(s.ends_with("+00:00"), "got {s}");
    assert!(!s.contains('Z'), "got {s}");
    assert!(!s.contains('.'), "got {s}");
    assert_eq!(s.as_bytes()[10], b'T', "got {s}");
}

#[test]
fn close_todo_swaps_status_and_bumps_updated_at() {
    let conn = fixture();
    let before: String = conn
        .query_row("SELECT updated_at FROM nodes WHERE id='open-todo'", [], |r| r.get(0))
        .unwrap();

    assert!(db::close_todo(&conn, "open-todo").unwrap());

    let n = db::node(&conn, "open-todo").unwrap().unwrap();
    assert!(n.tags.contains(&"status:done".to_string()));
    assert!(!n.tags.contains(&"status:open".to_string()));
    assert!(n.tags.contains(&"todo".to_string()), "non-status tags must survive");
    assert_ne!(n.updated_at, before);
}

#[test]
fn close_todo_on_an_untagged_todo_just_adds_done() {
    let conn = fixture();
    assert!(db::close_todo(&conn, "odd-todo").unwrap());
    let n = db::node(&conn, "odd-todo").unwrap().unwrap();
    assert_eq!(n.tags, vec!["todo".to_string(), "open-action".to_string(), "status:done".to_string()]);
}

#[test]
fn close_todo_is_idempotent_and_never_double_tags() {
    let conn = fixture();
    db::close_todo(&conn, "open-todo").unwrap();
    db::close_todo(&conn, "open-todo").unwrap();
    let n = db::node(&conn, "open-todo").unwrap().unwrap();
    assert_eq!(n.tags.iter().filter(|t| *t == "status:done").count(), 1);
}

#[test]
fn close_todo_returns_false_for_unknown_id() {
    let conn = fixture();
    assert!(!db::close_todo(&conn, "nope").unwrap());
}

#[test]
fn closing_removes_it_from_the_todo_pane() {
    let conn = fixture();
    db::close_todo(&conn, "open-todo").unwrap();
    let ids: Vec<String> = db::todos(&conn).unwrap().into_iter().map(|n| n.id).collect();
    assert!(!ids.contains(&"open-todo".to_string()));
}

/// Tags that are not a JSON string array parse to an empty Vec on the read side.
/// Closing such a node must NOT rewrite the column from that empty Vec — doing so
/// would erase whatever the column actually held. Refuse the write instead.
#[test]
fn close_todo_refuses_to_rewrite_unparseable_tags() {
    for bad in [r#"["todo", 1]"#, "null", r#"{"todo": true}"#, "not json at all"] {
        let conn = fixture();
        conn.execute("UPDATE nodes SET tags=?1 WHERE id='open-todo'", rusqlite::params![bad])
            .unwrap();

        assert!(
            db::close_todo(&conn, "open-todo").is_err(),
            "close_todo must report failure for tags {bad}"
        );

        let (tags, updated): (String, String) = conn
            .query_row("SELECT tags, updated_at FROM nodes WHERE id='open-todo'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(tags, bad, "tags column must be byte-identical after a refused close");
        assert_eq!(updated, "2026-09-01T00:00:00+00:00", "updated_at must not move");
    }
}
