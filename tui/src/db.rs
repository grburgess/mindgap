use rusqlite::{params, Connection, Row};
use std::path::Path;

const COLS: &str = "id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at";

#[derive(Debug, Clone, PartialEq)]
pub struct Url {
    pub label: String,
    pub url: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub title: String,
    pub node_type: String,
    pub body: String,
    pub tags: Vec<String>,
    pub urls: Vec<Url>,
    pub confidence: f64,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Dir {
    Out,
    In,
}

#[derive(Debug, Clone)]
pub struct Link {
    pub rel: String,
    pub id: String,
    pub title: String,
    pub node_type: String,
    pub dir: Dir,
}

/// Open the graph read-write. A missing file is a user error, not a panic:
/// rusqlite would otherwise happily create an empty DB and show an empty UI.
pub fn open(path: &Path) -> Result<Connection, String> {
    if !path.exists() {
        return Err(format!(
            "no graph database at {} — run `mindgap install` first",
            path.display()
        ));
    }
    let conn = Connection::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn parse_tags(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

/// Mirror of mindgap/db.py::_norm_urls — entries may be bare strings or
/// dicts with any of label/url/kind missing.
fn parse_urls(raw: &str) -> Vec<Url> {
    let vals: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap_or_default();
    let mut out = Vec::new();
    for v in vals {
        match v {
            serde_json::Value::String(s) => out.push(Url {
                label: s.clone(),
                url: s,
                kind: "web".to_string(),
            }),
            serde_json::Value::Object(map) => {
                let get = |k: &str| map.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                let url = if !get("url").is_empty() { get("url") } else { get("label") };
                let label = if get("label").is_empty() { url.clone() } else { get("label") };
                let kind = if get("kind").is_empty() { "web".to_string() } else { get("kind") };
                out.push(Url { label, url, kind });
            }
            _ => {}
        }
    }
    out
}

fn row_to_node(row: &Row) -> rusqlite::Result<Node> {
    let tags: String = row.get(4)?;
    let urls: String = row.get(5)?;
    Ok(Node {
        id: row.get(0)?,
        title: row.get(1)?,
        node_type: row.get(2)?,
        body: row.get(3)?,
        tags: parse_tags(&tags),
        urls: parse_urls(&urls),
        confidence: row.get(6)?,
        created_by: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

/// Every type='todo' node that is not tagged status:done or status:dropped —
/// the two terminal statuses in the todo-mindmap vocabulary. status:doing is
/// in-flight work and stays open, as does a todo carrying no status:* tag.
/// The status filter runs here rather than as SQL `tags LIKE '%"status:done"%'`
/// because pattern-matching a JSON array as a string is fragile.
pub fn todos(conn: &Connection) -> rusqlite::Result<Vec<Node>> {
    let sql = format!("SELECT {COLS} FROM nodes WHERE type='todo' ORDER BY updated_at DESC, id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_node)?;
    let mut out = Vec::new();
    for r in rows {
        let n = r?;
        if !n.tags.iter().any(|t| t == "status:done" || t == "status:dropped") {
            out.push(n);
        }
    }
    Ok(out)
}

/// Newest-added nodes. Ordered by created_at: the pane answers "what was added".
pub fn recent(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Node>> {
    let sql = format!("SELECT {COLS} FROM nodes ORDER BY created_at DESC, id ASC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], row_to_node)?;
    rows.collect()
}

pub fn node(conn: &Connection, id: &str) -> rusqlite::Result<Option<Node>> {
    let sql = format!("SELECT {COLS} FROM nodes WHERE id=?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], row_to_node)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Links in both directions. Inbound matters as much as outbound — a todo's
/// resolved_by edge usually points at it, not from it.
pub fn links(conn: &Connection, id: &str) -> rusqlite::Result<Vec<Link>> {
    let mut stmt = conn.prepare(
        "SELECT e.rel, n.id, n.title, n.type, 'out' AS dir
           FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ?1
         UNION ALL
         SELECT e.rel, n.id, n.title, n.type, 'in'
           FROM edges e JOIN nodes n ON n.id = e.src WHERE e.dst = ?1
         ORDER BY dir, rel, id",
    )?;
    let rows = stmt.query_map(params![id], |row| {
        let dir: String = row.get(4)?;
        Ok(Link {
            rel: row.get(0)?,
            id: row.get(1)?,
            title: row.get(2)?,
            node_type: row.get(3)?,
            dir: if dir == "out" { Dir::Out } else { Dir::In },
        })
    })?;
    rows.collect()
}

/// Python writes datetime.now(timezone.utc).isoformat(timespec="seconds"),
/// which yields '+00:00'. chrono's to_rfc3339 yields 'Z', so format explicitly.
pub fn now_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
}

/// Strip any status:* tag, append status:done, bump updated_at.
/// Returns false when no todo with that id exists.
///
/// Doing this in SQL sidesteps the MCP-path trap where removing a tag needs
/// add_node(replace=true), because a bare add merges rather than replaces.
pub fn close_todo(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    let raw: String = match conn.query_row(
        "SELECT tags FROM nodes WHERE id=?1 AND type='todo'",
        params![id],
        |r| r.get(0),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
        Err(e) => return Err(e),
    };
    // Deliberately not parse_tags: its empty-Vec fallback cannot be told apart
    // from a genuinely empty list, and rewriting the column from that fallback
    // would erase every tag the node actually held. A tags value we cannot read
    // is a refusal, not a write.
    let mut tags: Vec<String> = serde_json::from_str(&raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    tags.retain(|t| !t.starts_with("status:"));
    tags.push("status:done".to_string());
    let encoded = serde_json::to_string(&tags).expect("Vec<String> always serializes");
    conn.execute(
        "UPDATE nodes SET tags=?1, updated_at=?2 WHERE id=?3",
        params![encoded, now_utc(), id],
    )?;
    Ok(true)
}
