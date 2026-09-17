use crate::db::{Dir, Link, Node};

/// "2026-09-16T13:45:47+00:00" -> "13:45"; anything unparseable -> "--:--".
pub fn short_time(ts: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(ts) {
        Ok(t) => t.format("%H:%M").to_string(),
        Err(_) => "--:--".to_string(),
    }
}

pub fn detail_header(n: &Node) -> Vec<String> {
    let mut lines = vec![
        n.title.clone(),
        format!(
            "{} · {} · conf {:.1} · {}",
            n.id, n.node_type, n.confidence, n.created_at
        ),
    ];
    if !n.tags.is_empty() {
        lines.push(format!("tags: {}", n.tags.join(" ")));
    }
    lines
}

pub fn link_row(l: &Link) -> String {
    let arrow = match l.dir {
        Dir::Out => '→',
        Dir::In => '←',
    };
    format!("{arrow} {:<14} {}", l.rel, l.title)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Dir, Link, Node};

    fn node(id: &str, title: &str, ty: &str, created: &str) -> Node {
        Node {
            id: id.into(),
            title: title.into(),
            node_type: ty.into(),
            body: "body text".into(),
            tags: vec!["todo".into(), "status:open".into()],
            urls: vec![],
            confidence: 1.0,
            created_by: "test".into(),
            created_at: created.into(),
            updated_at: created.into(),
        }
    }

    #[test]
    fn short_time_renders_hh_mm() {
        assert_eq!(short_time("2026-09-16T13:45:47+00:00"), "13:45");
    }

    #[test]
    fn short_time_survives_garbage() {
        assert_eq!(short_time("nonsense"), "--:--");
    }

    #[test]
    fn detail_header_carries_id_type_and_tags() {
        let lines = detail_header(&node("t1", "T", "todo", "2026-09-16T13:45:47+00:00"));
        let joined = lines.join("\n");
        assert!(joined.contains("t1"));
        assert!(joined.contains("todo"));
        assert!(joined.contains("status:open"));
    }

    #[test]
    fn link_row_shows_direction_and_rel() {
        let out = Link {
            rel: "part_of".into(),
            id: "p".into(),
            title: "P".into(),
            node_type: "project".into(),
            dir: Dir::Out,
        };
        let inc = Link {
            rel: "resolved_by".into(),
            id: "q".into(),
            title: "Q".into(),
            node_type: "paper".into(),
            dir: Dir::In,
        };
        assert!(link_row(&out).contains('→'), "outbound needs a direction marker");
        assert!(link_row(&inc).contains('←'), "inbound needs a direction marker");
        assert!(link_row(&out).contains("part_of"));
    }
}
