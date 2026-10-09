use chrono::{DateTime, Utc};
use ratatui::style::{Color, Modifier, Style};

/// Verbatim from mindgap/web/app.js TYPE_COLORS. A paper is the same
/// orange in the terminal as in the browser. tests/test_tui_palette.py
/// fails if these drift apart.
pub const TYPE_COLORS: &[(&str, u8, u8, u8)] = &[
    // 2026-09-24: muted, Obsidian-derived family palette; see app.js for the rationale.
    // Parity with app.js is enforced by tests/test_tui_palette.py.
    ("concept", 0x60, 0xa1, 0x92),
    ("definition", 0x96, 0xd0, 0xd7),
    ("software", 0x77, 0xac, 0xce),
    ("repo", 0xb3, 0x7f, 0x57),
    ("page", 0xdc, 0xb6, 0x88),
    ("paper", 0xc9, 0x85, 0x70),
    ("person", 0xde, 0xa4, 0xbc),
    ("team", 0xaf, 0x78, 0x9c),
    ("design", 0xab, 0x91, 0xc9),
    ("feature", 0x9c, 0xcc, 0xe3),
    ("learning", 0x7c, 0xbc, 0x8d),
    ("jira-ticket", 0x4a, 0x8b, 0x9a),
    ("todo", 0xda, 0x81, 0x84),
    ("stub", 0x5d, 0x65, 0x65),
    ("finding", 0x70, 0xc2, 0xbe),
    ("reference", 0xa5, 0xa1, 0x6a),
    ("verified-fact", 0xa3, 0xd9, 0xbb),
    ("project", 0x62, 0x87, 0xbf),
    ("idea", 0xc9, 0xc4, 0xf3),
    ("fact", 0x70, 0x99, 0x6b),
    ("process", 0xa1, 0xaf, 0xde),
    ("decision", 0x95, 0x70, 0xa5),
    ("gotcha", 0xd5, 0xbc, 0x70),
];

/// The graph holds ~48 distinct types; 23 are canonical. The rest get a
/// stable hue derived from the name, so the long tail stays readable instead of
/// collapsing into one gray.
pub fn type_color(node_type: &str) -> Color {
    for (name, r, g, b) in TYPE_COLORS {
        if *name == node_type {
            return Color::Rgb(*r, *g, *b);
        }
    }
    let mut h: u32 = 2166136261;
    for byte in node_type.bytes() {
        h ^= byte as u32;
        h = h.wrapping_mul(16777619);
    }
    let (r, g, b) = hsl_to_rgb((h % 360) as f64, 0.30, 0.62);
    Color::Rgb(r, g, b)
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - (((h / 60.0) % 2.0) - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match h as u32 {
        0..=59 => (c, x, 0.0),
        60..=119 => (x, c, 0.0),
        120..=179 => (0.0, c, x),
        180..=239 => (0.0, x, c),
        240..=299 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let f = |v: f64| (((v + m) * 255.0).round().clamp(0.0, 255.0)) as u8;
    (f(r), f(g), f(b))
}

/// Recency heat for the Recent pane: today bright, this week normal, older dim.
pub fn recency_style(created_at: &str, now: DateTime<Utc>) -> Style {
    let age_days = DateTime::parse_from_rfc3339(created_at)
        .map(|t| (now - t.with_timezone(&Utc)).num_days())
        .unwrap_or(i64::MAX);
    match age_days {
        d if d < 1 => Style::default().add_modifier(Modifier::BOLD),
        d if d < 7 => Style::default(),
        _ => Style::default().add_modifier(Modifier::DIM),
    }
}

/// Short labels for the type tag column. Colour alone cannot carry type: the
/// graph holds ~48 types against 14 canonical hues, so the long tail shares
/// hashed colours and two neighbouring rows can look identical. The tag is the
/// second channel that tells them apart.
const TYPE_TAGS: &[(&str, &str)] = &[
    ("concept", "conc"),
    ("definition", "defn"),
    ("software", "soft"),
    ("paper", "papr"),
    ("person", "prsn"),
    ("design", "dsgn"),
    ("feature", "feat"),
    ("learning", "lrn"),
    ("jira-ticket", "tick"),
    ("finding", "find"),
    ("verified-fact", "fact"),
    ("reference", "ref"),
    ("project", "proj"),
    ("decision", "dcsn"),
    ("gotcha", "gtch"),
    ("process", "proc"),
    ("general-rule", "rule"),
    ("constraint", "cnst"),
    ("hypothesis", "hypo"),
    ("validation", "vald"),
    ("milestone", "mile"),
    ("question", "qstn"),
    ("principle", "prin"),
    ("capability", "capa"),
    ("implementation", "impl"),
];

/// A <=4 char tag for a node type. Curated where an abbreviation reads better
/// than a truncation ("learning" -> "lrn", not "lear"), first-four-chars
/// otherwise, so an unknown type still gets something recognisable.
pub fn type_tag(node_type: &str) -> String {
    for (name, tag) in TYPE_TAGS {
        if *name == node_type {
            return (*tag).to_string();
        }
    }
    node_type.chars().take(4).collect()
}

pub fn status_color(tags: &[String]) -> Option<Color> {
    if tags.iter().any(|t| t == "status:done") {
        return Some(Color::Rgb(0x7c, 0xbc, 0x8d));
    }
    if tags.iter().any(|t| t == "status:open") {
        return Some(Color::Rgb(0xd5, 0xbc, 0x70));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_types_use_the_web_palette() {
        assert_eq!(type_color("paper"), Color::Rgb(0xc9, 0x85, 0x70));
        assert_eq!(type_color("todo"), Color::Rgb(0xda, 0x81, 0x84));
    }

    #[test]
    fn unknown_types_get_a_stable_distinct_color() {
        let a = type_color("gotcha");
        assert_eq!(a, type_color("gotcha"), "must be stable across calls");
        assert_ne!(a, type_color("verified-fact"));
        assert_ne!(a, Color::Rgb(0, 0, 0));
    }

    #[test]
    fn recency_buckets() {
        let now = DateTime::parse_from_rfc3339("2026-09-16T12:00:00+00:00")
            .unwrap().with_timezone(&Utc);
        assert!(recency_style("2026-09-16T09:00:00+00:00", now)
            .add_modifier.contains(Modifier::BOLD));
        assert!(recency_style("2026-08-01T09:00:00+00:00", now)
            .add_modifier.contains(Modifier::DIM));
    }

    #[test]
    fn unparseable_timestamp_is_treated_as_old_not_panicking() {
        let now = Utc::now();
        assert!(recency_style("not a date", now).add_modifier.contains(Modifier::DIM));
    }

    #[test]
    fn type_tags_are_curated_then_truncated() {
        assert_eq!(type_tag("learning"), "lrn");
        assert_eq!(type_tag("paper"), "papr");
        // Not in the curated table: falls back to the first four characters.
        assert_eq!(type_tag("skill"), "skil");
        assert_eq!(type_tag("todo"), "todo");
    }

    #[test]
    fn type_tags_never_exceed_the_column_width() {
        for ty in ["implementation", "jira-ticket", "x", "", "verified-fact"] {
            assert!(type_tag(ty).chars().count() <= 4, "{ty} -> {}", type_tag(ty));
        }
    }

    #[test]
    fn status_colors() {
        assert!(status_color(&["status:open".into()]).is_some());
        assert!(status_color(&["todo".into()]).is_none());
    }
}
