use crossterm::event::KeyCode;
use rusqlite::Connection;

use crate::db::{self, Link, Node};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pane {
    Todos,
    Recent,
}

#[derive(Debug, Clone)]
pub enum Screen {
    Main,
    Detail {
        node_id: String,
        link_sel: usize,
        stack: Vec<String>,
    },
    Confirm {
        todo_id: String,
    },
}

/// A query alone cannot say whether the user is still typing it. That matters:
/// an editing filter swallows every key, an applied one must swallow none, and
/// both narrow the lists. Three states rather than a query plus a flag, so
/// "editing with no query" and "no filter" cannot be confused.
#[derive(Debug, Clone, PartialEq)]
pub enum Filter {
    Off,
    /// `/` pressed: keys go into the query.
    Editing(String),
    /// Enter pressed: the query still narrows the lists, but keys go to the app.
    Applied(String),
}

impl Filter {
    /// The query narrowing the lists — set in both the editing and applied states.
    pub fn query(&self) -> Option<&str> {
        match self {
            Filter::Off => None,
            Filter::Editing(q) | Filter::Applied(q) => Some(q),
        }
    }
}

pub struct App {
    pub conn: Connection,
    pub screen: Screen,
    pub pane: Pane,
    pub todos: Vec<Node>,
    pub recent: Vec<Node>,
    pub detail_links: Vec<Link>,
    pub filter: Filter,
    pub status: String,
    todo_sel: usize,
    recent_sel: usize,
}

const RECENT_LIMIT: i64 = 500;

impl App {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn,
            screen: Screen::Main,
            pane: Pane::Todos,
            todos: Vec::new(),
            recent: Vec::new(),
            detail_links: Vec::new(),
            filter: Filter::Off,
            status: String::new(),
            todo_sel: 0,
            recent_sel: 0,
        }
    }

    /// Re-read everything. Selection is restored by node id, never by index, so
    /// a tick that reorders rows cannot move the cursor onto a different node.
    pub fn refresh(&mut self) {
        let keep_todo = self.selected_in(Pane::Todos);
        let keep_recent = self.selected_in(Pane::Recent);
        // A failed read must not render as an empty pane: "TODOS (0)" is
        // indistinguishable from having no todos. Keep the empty list so the UI
        // still draws, and say in the status bar that the read is what failed.
        self.todos = match db::todos(&self.conn) {
            Ok(v) => v,
            Err(e) => {
                self.status = format!("could not read todos: {e}");
                Vec::new()
            }
        };
        self.recent = match db::recent(&self.conn, RECENT_LIMIT) {
            Ok(v) => v,
            Err(e) => {
                self.status = format!("could not read recent nodes: {e}");
                Vec::new()
            }
        };
        // Restored against the *visible* lists, because that is what the
        // selection indexes — under an active filter it is not the full list.
        let todo_sel = restore(&self.visible_todos(), keep_todo, self.todo_sel);
        let recent_sel = restore(&self.visible_recent(), keep_recent, self.recent_sel);
        self.todo_sel = todo_sel;
        self.recent_sel = recent_sel;
        if let Screen::Detail { node_id, .. } = self.screen.clone() {
            self.detail_links = db::links(&self.conn, &node_id).unwrap_or_default();
        }
    }

    fn selected_in(&self, pane: Pane) -> Option<String> {
        let (list, sel) = match pane {
            Pane::Todos => (self.visible_todos(), self.todo_sel),
            Pane::Recent => (self.visible_recent(), self.recent_sel),
        };
        list.get(sel).map(|n| n.id.clone())
    }

    pub fn visible_todos(&self) -> Vec<&Node> {
        filtered(&self.todos, self.filter.query())
    }

    pub fn visible_recent(&self) -> Vec<&Node> {
        filtered(&self.recent, self.filter.query())
    }

    pub fn selected_id(&self) -> Option<String> {
        self.selected_in(self.pane)
    }

    fn visible_focused(&self) -> Vec<&Node> {
        match self.pane {
            Pane::Todos => self.visible_todos(),
            Pane::Recent => self.visible_recent(),
        }
    }

    fn len_of_focused(&self) -> usize {
        self.visible_focused().len()
    }

    fn sel_mut(&mut self) -> &mut usize {
        match self.pane {
            Pane::Todos => &mut self.todo_sel,
            Pane::Recent => &mut self.recent_sel,
        }
    }

    fn move_sel(&mut self, delta: i64) {
        let len = self.len_of_focused();
        if len == 0 {
            return;
        }
        let cur = *self.sel_mut() as i64;
        *self.sel_mut() = (cur + delta).clamp(0, len as i64 - 1) as usize;
    }

    /// Change the query, keeping BOTH panes on the nodes they were on. A query
    /// change moves both lists now that the filter is global, so both selections
    /// are re-seated by id — otherwise the pane you are not looking at is left
    /// indexing past the end of its narrowed list and Tab strands you on nothing.
    fn set_filter(&mut self, next: Filter) {
        let keep_todo = self.selected_in(Pane::Todos);
        let keep_recent = self.selected_in(Pane::Recent);
        self.filter = next;
        let todo_sel = restore(&self.visible_todos(), keep_todo, self.todo_sel);
        let recent_sel = restore(&self.visible_recent(), keep_recent, self.recent_sel);
        self.todo_sel = todo_sel;
        self.recent_sel = recent_sel;
    }

    fn open_selected(&mut self) {
        if let Some(id) = self.selected_id() {
            self.detail_links = db::links(&self.conn, &id).unwrap_or_default();
            self.screen = Screen::Detail {
                node_id: id,
                link_sel: 0,
                stack: Vec::new(),
            };
        }
    }

    fn back(&mut self) {
        if let Screen::Detail { stack, .. } = &mut self.screen {
            if let Some(prev) = stack.pop() {
                let stack = stack.clone();
                self.detail_links = db::links(&self.conn, &prev).unwrap_or_default();
                self.screen = Screen::Detail {
                    node_id: prev,
                    link_sel: 0,
                    stack,
                };
                return;
            }
        }
        self.screen = Screen::Main;
    }

    /// Returns true when the app should quit.
    pub fn on_key(&mut self, key: KeyCode) -> bool {
        // Only an *editing* filter swallows keys; an applied one is inert here
        // and its query goes on narrowing the lists via visible_*().
        if let Filter::Editing(q) = &self.filter {
            let mut q = q.clone();
            let next = match key {
                KeyCode::Esc => Filter::Off,
                // Commit: stop taking keystrokes, keep narrowing. An empty query
                // is not a filter — committing one would leave Esc consuming a
                // keypress to clear nothing.
                KeyCode::Enter => {
                    if q.is_empty() {
                        Filter::Off
                    } else {
                        Filter::Applied(q)
                    }
                }
                KeyCode::Backspace => {
                    q.pop();
                    Filter::Editing(q)
                }
                KeyCode::Char(c) => {
                    q.push(c);
                    Filter::Editing(q)
                }
                _ => Filter::Editing(q),
            };
            self.set_filter(next);
            return false;
        }

        match self.screen.clone() {
            Screen::Confirm { todo_id } => {
                match key {
                    KeyCode::Char('y') | KeyCode::Char('Y') => {
                        match db::close_todo(&self.conn, &todo_id) {
                            Ok(true) => self.status = format!("closed {todo_id}"),
                            Ok(false) => self.status = format!("no todo {todo_id}"),
                            // close_todo's error is machine-flavoured ("Conversion
                            // error from type Text at index: 0"), so say which node
                            // and that nothing was written before quoting it.
                            Err(e) => {
                                self.status = format!(
                                    "could not close {todo_id}: its tags are not readable JSON, so nothing was written ({e})"
                                )
                            }
                        }
                        self.screen = Screen::Main;
                        self.refresh();
                    }
                    _ => self.screen = Screen::Main,
                }
                false
            }
            Screen::Detail {
                node_id,
                link_sel,
                stack,
            } => {
                match key {
                    KeyCode::Esc | KeyCode::Backspace | KeyCode::Char('q') => self.back(),
                    KeyCode::Char('j') | KeyCode::Down => {
                        let n = self.detail_links.len();
                        if n > 0 {
                            self.screen = Screen::Detail {
                                node_id,
                                link_sel: (link_sel + 1).min(n - 1),
                                stack,
                            };
                        }
                    }
                    KeyCode::Char('k') | KeyCode::Up => {
                        self.screen = Screen::Detail {
                            node_id,
                            link_sel: link_sel.saturating_sub(1),
                            stack,
                        };
                    }
                    KeyCode::Enter => {
                        if let Some(link) = self.detail_links.get(link_sel) {
                            let target = link.id.clone();
                            let mut stack = stack;
                            stack.push(node_id);
                            self.detail_links =
                                db::links(&self.conn, &target).unwrap_or_default();
                            self.screen = Screen::Detail {
                                node_id: target,
                                link_sel: 0,
                                stack,
                            };
                        }
                    }
                    KeyCode::Char('o') => self.open_url(&node_id),
                    KeyCode::Char('r') => self.refresh(),
                    _ => {}
                }
                false
            }
            Screen::Main => match key {
                KeyCode::Char('q') => true,
                KeyCode::Tab => {
                    self.pane = if self.pane == Pane::Todos {
                        Pane::Recent
                    } else {
                        Pane::Todos
                    };
                    false
                }
                KeyCode::Char('j') | KeyCode::Down => {
                    self.move_sel(1);
                    false
                }
                KeyCode::Char('k') | KeyCode::Up => {
                    self.move_sel(-1);
                    false
                }
                KeyCode::Char('g') => {
                    *self.sel_mut() = 0;
                    false
                }
                KeyCode::Char('G') => {
                    let len = self.len_of_focused();
                    *self.sel_mut() = len.saturating_sub(1);
                    false
                }
                KeyCode::Char('/') => {
                    self.set_filter(Filter::Editing(String::new()));
                    false
                }
                // Esc clears a committed filter, keeping both panes on the same
                // nodes as the lists widen. With no filter it does nothing.
                KeyCode::Esc => {
                    if matches!(self.filter, Filter::Applied(_)) {
                        self.set_filter(Filter::Off);
                    }
                    false
                }
                KeyCode::Enter => {
                    self.open_selected();
                    false
                }
                KeyCode::Char('r') => {
                    self.refresh();
                    false
                }
                KeyCode::Char('c') => {
                    if self.pane == Pane::Todos {
                        if let Some(id) = self.selected_id() {
                            self.screen = Screen::Confirm { todo_id: id };
                        }
                    }
                    false
                }
                _ => false,
            },
        }
    }

    fn open_url(&mut self, node_id: &str) {
        let url = db::node(&self.conn, node_id)
            .ok()
            .flatten()
            .and_then(|n| n.urls.first().map(|u| u.url.clone()));
        match url {
            Some(u) if !u.is_empty() => {
                let opener = if cfg!(target_os = "macos") {
                    "open"
                } else {
                    "xdg-open"
                };
                match std::process::Command::new(opener).arg(&u).spawn() {
                    Ok(_) => self.status = format!("opened {u}"),
                    Err(e) => self.status = format!("could not open: {e}"),
                }
            }
            _ => self.status = "no url on this node".to_string(),
        }
    }
}

/// The query is global: it narrows whichever list it is handed, so Tab is a
/// pure focus change and both panes agree on what is visible.
fn filtered<'a>(list: &'a [Node], filter: Option<&str>) -> Vec<&'a Node> {
    match filter {
        Some(f) if !f.is_empty() => {
            let f = f.to_lowercase();
            list.iter()
                .filter(|n| n.title.to_lowercase().contains(&f) || n.id.to_lowercase().contains(&f))
                .collect()
        }
        _ => list.iter().collect(),
    }
}

fn restore(list: &[&Node], keep: Option<String>, fallback: usize) -> usize {
    if let Some(id) = keep {
        if let Some(i) = list.iter().position(|n| n.id == id) {
            return i;
        }
    }
    fallback.min(list.len().saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyCode;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../mindgap/schema.sql");

    fn app() -> App {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for (id, title, ty, tags, created) in [
            ("t1", "Todo one", "todo", r#"["todo","status:open"]"#, "2026-09-01T00:00:00+00:00"),
            ("t2", "Todo two", "todo", r#"["todo","status:open"]"#, "2026-09-02T00:00:00+00:00"),
            ("p1", "Paper one", "paper", r#"[]"#, "2026-09-05T00:00:00+00:00"),
        ] {
            conn.execute(
                "INSERT INTO nodes(id,title,type,body,tags,urls,confidence,created_by,created_at,updated_at)
                 VALUES(?1,?2,?3,'',?4,'[]',1.0,'test',?5,?5)",
                rusqlite::params![id, title, ty, tags, created],
            )
            .unwrap();
        }
        let mut a = App::new(conn);
        a.refresh();
        a
    }

    #[test]
    fn starts_on_the_todo_pane_with_a_selection() {
        let a = app();
        assert_eq!(a.pane, Pane::Todos);
        assert!(a.selected_id().is_some());
    }

    #[test]
    fn tab_switches_panes() {
        let mut a = app();
        a.on_key(KeyCode::Tab);
        assert_eq!(a.pane, Pane::Recent);
        a.on_key(KeyCode::Tab);
        assert_eq!(a.pane, Pane::Todos);
    }

    #[test]
    fn j_and_k_move_the_selection() {
        let mut a = app();
        let first = a.selected_id().unwrap();
        a.on_key(KeyCode::Char('j'));
        assert_ne!(a.selected_id().unwrap(), first);
        a.on_key(KeyCode::Char('k'));
        assert_eq!(a.selected_id().unwrap(), first);
    }

    #[test]
    fn selection_does_not_run_off_the_ends() {
        let mut a = app();
        for _ in 0..50 {
            a.on_key(KeyCode::Char('j'));
        }
        assert!(a.selected_id().is_some());
        for _ in 0..50 {
            a.on_key(KeyCode::Char('k'));
        }
        assert!(a.selected_id().is_some());
    }

    #[test]
    fn enter_opens_detail_and_esc_returns() {
        let mut a = app();
        a.on_key(KeyCode::Enter);
        assert!(matches!(a.screen, Screen::Detail { .. }));
        a.on_key(KeyCode::Esc);
        assert!(matches!(a.screen, Screen::Main));
    }

    #[test]
    fn following_links_builds_a_stack_that_esc_unwinds() {
        let mut a = app();
        a.conn
            .execute(
                "INSERT INTO edges(src,dst,rel,weight,created_by,created_at)
             VALUES('t2','p1','relates_to',1.0,'t','2026-09-01T00:00:00+00:00')",
                [],
            )
            .unwrap();
        a.refresh();
        // t2 is newest by updated_at, so it leads the todo pane.
        a.on_key(KeyCode::Enter);
        a.on_key(KeyCode::Enter); // follow the first link
        match &a.screen {
            Screen::Detail { node_id, stack, .. } => {
                assert_eq!(node_id, "p1");
                assert_eq!(stack.len(), 1);
            }
            _ => panic!("expected detail"),
        }
        a.on_key(KeyCode::Esc);
        match &a.screen {
            Screen::Detail { node_id, stack, .. } => {
                assert_eq!(node_id, "t2");
                assert!(stack.is_empty());
            }
            _ => panic!("expected to pop back to the first node"),
        }
    }

    #[test]
    fn q_goes_back_in_detail_but_quits_from_main() {
        let mut a = app();
        a.on_key(KeyCode::Enter);
        assert!(!a.on_key(KeyCode::Char('q')), "q in detail must not quit");
        assert!(matches!(a.screen, Screen::Main));
        assert!(a.on_key(KeyCode::Char('q')), "q on main quits");
    }

    #[test]
    fn slash_filters_the_list() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "two".chars() {
            a.on_key(KeyCode::Char(c));
        }
        assert_eq!(a.visible_todos().len(), 1);
        assert_eq!(a.visible_todos()[0].id, "t2");
        a.on_key(KeyCode::Esc);
        assert_eq!(a.visible_todos().len(), 2);
    }

    #[test]
    fn filter_is_case_insensitive_and_matches_id_too() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "T1".chars() {
            a.on_key(KeyCode::Char(c));
        }
        assert_eq!(a.visible_todos().len(), 1);
    }

    #[test]
    fn c_asks_before_closing_and_y_performs_the_write() {
        let mut a = app();
        let id = a.selected_id().unwrap();
        a.on_key(KeyCode::Char('c'));
        assert!(matches!(a.screen, Screen::Confirm { .. }), "must confirm first");
        a.on_key(KeyCode::Char('y'));
        let ids: Vec<String> = a.todos.iter().map(|n| n.id.clone()).collect();
        assert!(!ids.contains(&id), "closed todo must leave the pane");
    }

    #[test]
    fn n_cancels_the_close() {
        let mut a = app();
        let id = a.selected_id().unwrap();
        a.on_key(KeyCode::Char('c'));
        a.on_key(KeyCode::Char('n'));
        assert!(matches!(a.screen, Screen::Main));
        assert!(a.todos.iter().any(|n| n.id == id), "cancel must not write");
    }

    #[test]
    fn refresh_keeps_the_selection_on_the_same_node_when_rows_reorder() {
        let mut a = app();
        a.on_key(KeyCode::Char('j'));
        let before = a.selected_id().unwrap();
        // Bump t1 so the todo pane reorders under the cursor.
        a.conn
            .execute("UPDATE nodes SET updated_at='2099-01-01T00:00:00+00:00' WHERE id='t1'", [])
            .unwrap();
        a.refresh();
        assert_eq!(
            a.selected_id().unwrap(),
            before,
            "selection tracks the node id, not the row index"
        );
    }

    #[test]
    fn tab_leaves_both_panes_filtered() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        a.on_key(KeyCode::Enter);
        // "Todo one" in todos; "Paper one" and "Todo one" in recent.
        assert_eq!(a.visible_todos().len(), 1);
        assert_eq!(a.visible_recent().len(), 2);
        a.on_key(KeyCode::Tab);
        assert_eq!(a.visible_todos().len(), 1, "tab must not un-filter the pane you left");
        assert_eq!(a.visible_recent().len(), 2, "nor re-filter the one you arrive at");
        assert!(matches!(a.filter, Filter::Applied(ref q) if q == "one"));
    }

    #[test]
    fn tabbing_under_a_filter_lands_on_a_real_selection() {
        let mut a = app();
        // Park the recent pane on its last row, which the filter will drop.
        a.on_key(KeyCode::Tab);
        a.on_key(KeyCode::Char('G'));
        assert_eq!(a.selected_id().unwrap(), "t1");
        a.on_key(KeyCode::Tab);
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        a.on_key(KeyCode::Enter);
        a.on_key(KeyCode::Tab);
        assert_eq!(a.pane, Pane::Recent);
        assert_eq!(
            a.selected_id(),
            Some("t1".to_string()),
            "the incoming pane must be re-seated, not left past the end"
        );
        a.on_key(KeyCode::Enter);
        assert!(
            matches!(a.screen, Screen::Detail { .. }),
            "enter must open, not silently do nothing"
        );
    }

    #[test]
    fn enter_on_an_empty_query_clears_the_filter() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        a.on_key(KeyCode::Enter);
        assert_eq!(a.filter, Filter::Off, "an empty query is not a filter");
        assert_eq!(a.visible_todos().len(), 2);
    }

    #[test]
    fn enter_commits_the_filter_and_keeps_the_selection() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        let before = a.selected_id().unwrap();
        a.on_key(KeyCode::Enter);
        // Asserting the state, not just the row count: while still editing the
        // list is filtered too, so a count alone would pass without a commit.
        assert!(
            matches!(a.filter, Filter::Applied(ref q) if q == "one"),
            "got {:?}",
            a.filter
        );
        assert_eq!(a.visible_todos().len(), 1, "the filter stays applied after commit");
        assert_eq!(
            a.selected_id().unwrap(),
            before,
            "committing must not move the cursor"
        );
    }

    #[test]
    fn enter_after_committing_opens_the_filtered_selection() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        a.on_key(KeyCode::Enter); // commit the filter
        a.on_key(KeyCode::Enter); // open what it selected
        match &a.screen {
            Screen::Detail { node_id, .. } => assert_eq!(node_id, "t1"),
            _ => panic!("a committed filter must not swallow Enter"),
        }
    }

    #[test]
    fn esc_clears_a_committed_filter() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        a.on_key(KeyCode::Enter);
        assert_eq!(a.visible_todos().len(), 1);
        a.on_key(KeyCode::Esc);
        assert_eq!(a.visible_todos().len(), 2, "the full list comes back");
        assert_eq!(
            a.selected_id().unwrap(),
            "t1",
            "widening the list must not move the cursor either"
        );
    }

    #[test]
    fn a_committed_filter_does_not_swallow_navigation_keys() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "todo".chars() {
            a.on_key(KeyCode::Char(c));
        }
        a.on_key(KeyCode::Enter);
        let first = a.selected_id().unwrap();
        a.on_key(KeyCode::Char('j'));
        assert_ne!(
            a.selected_id().unwrap(),
            first,
            "j must move the cursor, not get typed into the query"
        );
        assert_eq!(a.visible_todos().len(), 2, "the query itself is unchanged");
    }

    #[test]
    fn esc_on_main_without_a_filter_is_harmless() {
        let mut a = app();
        let before = a.selected_id().unwrap();
        assert!(!a.on_key(KeyCode::Esc), "esc must not quit");
        assert!(matches!(a.screen, Screen::Main));
        assert_eq!(a.selected_id().unwrap(), before);
        assert_eq!(a.visible_todos().len(), 2);
    }

    /// Not in the brief. Selection indexes the *filtered* list, so the kept id
    /// has to be looked up in the filtered list too. "one" matches only t1,
    /// which sits at full-list row 1 but filtered row 0 — looking it up in the
    /// unfiltered list hands back 1 and walks the cursor off the end.
    #[test]
    fn refresh_keeps_the_selection_while_a_filter_is_active() {
        let mut a = app();
        a.on_key(KeyCode::Char('/'));
        for c in "one".chars() {
            a.on_key(KeyCode::Char(c));
        }
        let before = a.selected_id().unwrap();
        assert_eq!(before, "t1", "only 'Todo one' matches");
        a.refresh();
        assert_eq!(
            a.selected_id().unwrap(),
            before,
            "a tick must not move the cursor off the filtered selection"
        );
    }
}
