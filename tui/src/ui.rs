use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap,
};
use ratatui::Frame;

use crate::app::{App, Filter, Pane, Screen};
use crate::db::Node;
use crate::{format, theme};

const ACCENT: ratatui::style::Color = ratatui::style::Color::Rgb(0x57, 0xc7, 0xa4);

pub fn draw(frame: &mut Frame, app: &App) {
    let area = frame.area();
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(area);

    match &app.screen {
        Screen::Main => draw_main(frame, rows[0], app),
        Screen::Detail {
            node_id, link_sel, ..
        } => draw_detail(frame, rows[0], app, node_id, *link_sel),
        Screen::Confirm { todo_id } => {
            draw_main(frame, rows[0], app);
            draw_confirm(frame, area, todo_id);
        }
    }
    frame.render_widget(footer(app), rows[1]);
}

fn draw_main(frame: &mut Frame, area: Rect, app: &App) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    let todos = app.visible_todos();
    let recent = app.visible_recent();

    // A ListState per pane, never one shared: the unfocused pane's selection is
    // None, so it stays at its top instead of being dragged along by the other
    // pane's scroll. Rendered stateful rather than plain, because
    // `impl Widget for &List` builds a fresh ListState::default() every frame
    // and pins the offset at 0 — with 500 recent nodes in a ~21-row pane that
    // left every row past the fold unreachable.
    let mut todo_state =
        ListState::default().with_selected(selected_index(app, Pane::Todos, &todos));
    let mut recent_state =
        ListState::default().with_selected(selected_index(app, Pane::Recent, &recent));

    frame.render_stateful_widget(
        list(
            pane_title("TODOS", todos.len(), app.pane == Pane::Todos),
            or_empty(
                todos.iter().map(|n| todo_item(n)).collect(),
                app,
                "no open todos",
            ),
            app.pane == Pane::Todos,
        ),
        cols[0],
        &mut todo_state,
    );
    frame.render_stateful_widget(
        list(
            pane_title("RECENT", recent.len(), app.pane == Pane::Recent),
            or_empty(
                recent.iter().map(|n| recent_item(n)).collect(),
                app,
                "nothing here yet",
            ),
            app.pane == Pane::Recent,
        ),
        cols[1],
        &mut recent_state,
    );
}

/// An empty pane should say why it is empty. A filter that matches nothing
/// looks identical to an empty graph otherwise.
fn or_empty(items: Vec<Line<'static>>, app: &App, when_none: &str) -> Vec<Line<'static>> {
    if !items.is_empty() {
        return items;
    }
    let msg = match app.filter.query() {
        Some(q) if !q.is_empty() => format!("  no matches for “{q}”"),
        _ => format!("  {when_none}"),
    };
    vec![Line::from(Span::styled(
        msg,
        Style::default().add_modifier(Modifier::DIM | Modifier::ITALIC),
    ))]
}

/// Where the cursor sits in an already-computed visible list. `None` for the
/// unfocused pane — only one pane shows a cursor at a time.
fn selected_index(app: &App, pane: Pane, list: &[&Node]) -> Option<usize> {
    if app.pane != pane {
        return None;
    }
    let id = app.selected_id()?;
    list.iter().position(|n| n.id == id)
}

/// The type tag, padded to a fixed width so titles line up into a column.
/// Carried in the type's own colour; the title stays default-coloured so the
/// eye reads titles as one body of text and colour means type, nothing else.
fn tag_span(node_type: &str) -> Span<'static> {
    Span::styled(
        format!("{:<4} ", theme::type_tag(node_type)),
        Style::default().fg(theme::type_color(node_type)),
    )
}

fn todo_item(n: &Node) -> Line<'static> {
    let mut spans = vec![tag_span(&n.node_type), Span::raw(n.title.clone())];
    if let Some(c) = theme::status_color(&n.tags) {
        spans.push(Span::styled(" ●", Style::default().fg(c)));
    }
    Line::from(spans)
}

/// Time, then tag, then title. The title replaces the node id the first version
/// showed: `13:45 todo-jira-cl-2519-baseline-eval` is a slug, and a pane full of
/// slugs is unreadable at a glance.
fn recent_item(n: &Node) -> Line<'static> {
    Line::from(vec![
        Span::styled(
            format!("{} ", format::short_time(&n.created_at)),
            theme::recency_style(&n.created_at, chrono::Utc::now()),
        ),
        tag_span(&n.node_type),
        Span::raw(n.title.clone()),
    ])
}

/// A pane title as ` NAME · count `, with the count dimmed so the name reads
/// first.
fn pane_title(name: &str, count: usize, focused: bool) -> Line<'static> {
    let name_style = if focused {
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
    } else {
        Style::default().add_modifier(Modifier::DIM)
    };
    Line::from(vec![
        Span::raw(" "),
        Span::styled(name.to_string(), name_style),
        Span::styled(
            format!(" · {count} "),
            Style::default().add_modifier(Modifier::DIM),
        ),
    ])
}

fn list(title: Line<'static>, items: Vec<Line<'static>>, focused: bool) -> List<'static> {
    let border = if focused {
        Style::default().fg(ACCENT)
    } else {
        Style::default().add_modifier(Modifier::DIM)
    };
    let items: Vec<ListItem> = items.into_iter().map(ListItem::new).collect();
    // The highlight comes from the ListState's selection rather than a modifier
    // baked into one item, so the same selection that drives the scroll offset
    // also draws the cursor — they cannot disagree.
    //
    // A gutter bar rather than a reversed row: reversing repaints the whole row
    // in one block of colour, which throws away the type colour the tag column
    // exists to show. ratatui pads unselected rows to the symbol's width, so the
    // columns stay aligned.
    List::new(items)
        .highlight_symbol("┃ ")
        .highlight_style(Style::default().add_modifier(Modifier::BOLD))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(border)
                .title(title),
        )
}

fn draw_detail(frame: &mut Frame, area: Rect, app: &App, node_id: &str, link_sel: usize) {
    let node = crate::db::node(&app.conn, node_id).ok().flatten();
    let mut lines: Vec<Line> = Vec::new();
    if let Some(n) = &node {
        // detail_header gives [title, "id · type · conf · created", "tags: …"];
        // style them as a heading and two levels of supporting text rather than
        // painting all three the same colour.
        let mut header = format::detail_header(n).into_iter();
        if let Some(title) = header.next() {
            lines.push(Line::from(Span::styled(
                title,
                Style::default()
                    .fg(theme::type_color(&n.node_type))
                    .add_modifier(Modifier::BOLD),
            )));
        }
        for rest in header {
            lines.push(Line::from(Span::styled(
                rest,
                Style::default().add_modifier(Modifier::DIM),
            )));
        }
        lines.push(Line::raw(""));
        for chunk in n.body.lines() {
            lines.push(Line::raw(chunk.to_string()));
        }
        if !n.urls.is_empty() {
            lines.push(Line::raw(""));
            lines.push(section("URLS"));
            for u in &n.urls {
                lines.push(Line::from(Span::styled(
                    format!("  {}", u.url),
                    Style::default().fg(ACCENT),
                )));
            }
        }
    } else {
        lines.push(Line::raw(format!("node {node_id} not found")));
    }

    lines.push(Line::raw(""));
    lines.push(section("LINKS"));
    if app.detail_links.is_empty() {
        lines.push(Line::from(Span::styled(
            "  nothing links here yet",
            Style::default().add_modifier(Modifier::DIM | Modifier::ITALIC),
        )));
    }
    for (i, l) in app.detail_links.iter().enumerate() {
        // Same tag column as the list panes, so a link reads as the same kind of
        // row as the thing it points at.
        let cursor = if i == link_sel { "┃ " } else { "  " };
        let row = Line::from(vec![
            Span::styled(
                cursor,
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            tag_span(&l.node_type),
            Span::styled(
                format::link_row(l),
                if i == link_sel {
                    Style::default().add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
        ]);
        lines.push(row);
    }

    frame.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: false }).block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(ACCENT))
                .title(pane_title(node_id, app.detail_links.len(), true)),
        ),
        area,
    );
}

/// A section heading inside the detail view.
fn section(name: &str) -> Line<'static> {
    Line::from(Span::styled(
        name.to_string(),
        Style::default()
            .fg(ACCENT)
            .add_modifier(Modifier::BOLD | Modifier::DIM),
    ))
}

fn draw_confirm(frame: &mut Frame, area: Rect, todo_id: &str) {
    let w = area.width.clamp(1, 60);
    let h = area.height.clamp(1, 5);
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(w)) / 2,
        y: area.y + (area.height.saturating_sub(h)) / 2,
        width: w,
        height: h,
    };
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(vec![
                Span::styled("close ", Style::default().add_modifier(Modifier::DIM)),
                Span::styled(
                    todo_id.to_string(),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::styled("?", Style::default().add_modifier(Modifier::DIM)),
            ]),
            Line::raw(""),
            Line::from(vec![
                Span::styled("y/Y", Style::default().fg(ACCENT)),
                Span::styled(
                    " confirms · any other key cancels",
                    Style::default().add_modifier(Modifier::DIM),
                ),
            ]),
        ])
        .wrap(Wrap { trim: true })
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(ACCENT))
                .title(Line::from(Span::styled(
                    " confirm ",
                    Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                ))),
        ),
        popup,
    );
}

/// One `key label` pair for the hint bar: the key in the accent colour, the
/// label dim, so the bar scans as keys first.
fn hint(key: &str, label: &str) -> Vec<Span<'static>> {
    vec![
        Span::styled(key.to_string(), Style::default().fg(ACCENT)),
        Span::styled(
            format!(" {label}"),
            Style::default().add_modifier(Modifier::DIM),
        ),
    ]
}

fn hints(pairs: &[(&str, &str)]) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    for (i, (key, label)) in pairs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled(
                " · ",
                Style::default().add_modifier(Modifier::DIM),
            ));
        }
        spans.extend(hint(key, label));
    }
    Line::from(spans)
}

fn footer(app: &App) -> Paragraph<'static> {
    let line = match &app.filter {
        // Being typed: show a trailing caret so it reads as a live input.
        Filter::Editing(q) => Line::from(vec![
            Span::styled("/", Style::default().fg(ACCENT)),
            Span::raw(q.clone()),
            Span::styled("▏", Style::default().fg(ACCENT)),
        ]),
        // Committed: the query stays applied to BOTH panes; say how to clear it.
        Filter::Applied(q) => Line::from(vec![
            Span::styled("/", Style::default().fg(ACCENT)),
            Span::styled(q.clone(), Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                "  esc clears",
                Style::default().add_modifier(Modifier::DIM),
            ),
        ]),
        Filter::Off if !app.status.is_empty() => Line::from(Span::styled(
            format!(" {}", app.status),
            Style::default().fg(ACCENT),
        )),
        Filter::Off => match app.screen {
            Screen::Main => hints(&[
                ("q", "quit"),
                ("tab", "pane"),
                ("↵", "open"),
                ("/", "filter"),
                ("c", "close"),
                ("r", "refresh"),
            ]),
            Screen::Detail { .. } => hints(&[
                ("q/esc", "back"),
                ("j/k", "link"),
                ("↵", "follow"),
                ("o", "url"),
                ("r", "refresh"),
            ]),
            Screen::Confirm { .. } => hints(&[("y", "confirm"), ("any other key", "cancel")]),
        },
    };
    Paragraph::new(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::App;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../mindgap/schema.sql");

    fn app() -> App {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)
             VALUES('t1','Todo one','todo','b','[\"todo\",\"status:open\"]','[]',1.0,'t',
                    '2026-09-01T00:00:00+00:00','2026-09-01T00:00:00+00:00')", []).unwrap();
        let mut a = App::new(conn);
        a.refresh();
        a
    }

    /// Returns the painted screen as text. Not in the brief: the brief's
    /// `render_at` returned `()`, so every render test passed with an empty
    /// `draw` body — verified by stubbing one in. Handing back the buffer is
    /// what makes the assertions below able to fail.
    fn render_at(w: u16, h: u16, app: &App) -> String {
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| draw(f, app)).unwrap();
        term.backend().to_string()
    }

    /// `count` todos, ordered so that `G` lands on a row far past the bottom of
    /// any realistic pane.
    fn app_with_many_todos(count: usize) -> App {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for i in 0..count {
            let id = format!("todo-{i:02}");
            let ts = format!("2026-09-01T00:{i:02}:00+00:00");
            conn.execute(
                "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)
                 VALUES(?1,?1,'todo','','[\"todo\"]','[]',1.0,'t',?2,?2)",
                rusqlite::params![id, ts],
            )
            .unwrap();
        }
        let mut a = App::new(conn);
        a.refresh();
        a
    }

    /// Not in the brief, and the brief's `render_widget(List)` failed it: that
    /// path goes through `impl Widget for &List`, which builds a fresh
    /// `ListState::default()` every frame, pinning the scroll offset at 0. With
    /// RECENT_LIMIT at 500 feeding a ~21-row pane, `G` moved the selection to a
    /// row that simply could not be painted.
    #[test]
    fn the_list_scrolls_to_keep_the_selection_in_view() {
        let mut a = app_with_many_todos(60);
        a.on_key(crossterm::event::KeyCode::Char('G'));
        let selected = a.selected_id().unwrap();
        let mut term = Terminal::new(TestBackend::new(80, 24)).unwrap();
        term.draw(|f| draw(f, &a)).unwrap();
        let screen = term.backend().to_string();
        assert!(
            screen.contains(&selected),
            "the pane holds ~21 rows but the selection is row 59; it has to scroll \
             into view. looking for {selected:?} in\n{screen}"
        );
        // ...and it is the row under the cursor. The highlight comes from the
        // ListState's selection, so a scrolled-but-uncursored row would
        // otherwise pass silently. The cursor is a gutter bar rather than a
        // reversed row: reversing repaints the whole row in one block of colour
        // and throws away the type colour the tag column exists to show.
        let row = screen
            .lines()
            .position(|l| l.contains(&selected))
            .expect("just asserted it is on screen");
        let buf = term.backend().buffer();
        // `to_string()` emits one quoted line per buffer row, so line N of the
        // dump is buffer row N. Column 1 is the gutter, just inside the border.
        let cell = &buf[(1, row as u16)];
        assert_eq!(
            cell.symbol(),
            "┃",
            "the selected row must carry the cursor bar in its gutter; got {:?} at row {row}",
            cell.symbol()
        );
    }

    /// The other half of the same bug: scrolling the focused pane must not drag
    /// the unfocused one along. Recent is ordered by created_at DESC, so its
    /// first row is todo-59 — which must still be on screen after `G` has sent
    /// the todo pane to its own last row.
    #[test]
    fn scrolling_one_pane_leaves_the_other_at_its_top() {
        let mut a = app_with_many_todos(60);
        a.on_key(crossterm::event::KeyCode::Char('G'));
        let screen = render_at(80, 24, &a);
        assert!(
            screen.contains("todo-59"),
            "the unfocused pane has no selection and must stay at its top\n{screen}"
        );
    }

    #[test]
    fn renders_main_at_a_normal_size() {
        let screen = render_at(80, 24, &app());
        assert!(screen.contains("TODOS"), "todo pane title\n{screen}");
        assert!(screen.contains("RECENT"), "recent pane title\n{screen}");
        assert!(screen.contains("Todo one"), "the todo's title\n{screen}");
        assert!(screen.contains("q quit"), "the footer hints\n{screen}");
    }

    #[test]
    fn renders_detail() {
        let mut a = app();
        a.on_key(crossterm::event::KeyCode::Enter);
        let screen = render_at(80, 24, &a);
        assert!(screen.contains("Todo one"), "the node's title\n{screen}");
        assert!(screen.contains("status:open"), "its tags\n{screen}");
        assert!(screen.contains("LINKS"), "the links section\n{screen}");
        assert!(screen.contains("q/esc back"), "the detail footer\n{screen}");
    }

    #[test]
    fn renders_confirm() {
        let mut a = app();
        a.on_key(crossterm::event::KeyCode::Char('c'));
        let screen = render_at(80, 24, &a);
        assert!(screen.contains("confirm"), "the popup\n{screen}");
        // Both y and Y confirm (app.rs matches `Char('y') | Char('Y')`), so the
        // prompt must not imply that only lowercase writes.
        assert!(screen.contains("y/Y confirms"), "how to answer it\n{screen}");
        assert!(screen.contains("close t1?"), "which todo\n{screen}");
    }

    #[test]
    fn survives_a_tiny_terminal() {
        // Layout arithmetic must not panic when there is no room.
        render_at(20, 5, &app());
        render_at(1, 1, &app());
    }

    #[test]
    fn survives_an_empty_graph() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let mut a = App::new(conn);
        a.refresh();
        render_at(80, 24, &a);
    }
}
