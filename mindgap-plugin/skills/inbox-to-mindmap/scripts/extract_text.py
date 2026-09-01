#!/usr/bin/env python3
"""Extract plain text from the formats the Read tool cannot open directly.

  extract_text.py FILE [--max-chars N] [--json]

Handles docx / pptx / xlsx (zip + XML), html / eml, and csv / tsv. PDFs, images,
markdown and plain text are NOT handled here — read those with the Read tool,
which sees PDF pages and images natively and gives you better locators.

Output carries section markers ([slide 3], [sheet: Sales], [§ Heading]) because
every claim ingested from a document needs a locator pointing back at the spot
it came from.

Stdlib only.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import zipfile
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

READ_TOOL = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".md", ".markdown", ".txt", ".rst"}


def local(tag: str) -> str:
    """Strip the XML namespace: '{...}p' -> 'p'."""
    return tag.rsplit("}", 1)[-1]


def xml_text(elem, sep: str = "") -> str:
    return sep.join(t for t in elem.itertext() if t)


# ---------------------------------------------------------------- office

def from_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    lines = []
    for para in root.iter():
        if local(para.tag) != "p":
            continue
        text = xml_text(para).strip()
        if not text:
            continue
        style = ""
        for node in para.iter():
            if local(node.tag) == "pStyle":
                style = next((v for k, v in node.attrib.items() if local(k) == "val"), "")
                break
        lines.append(f"[§ {text}]" if style.lower().startswith("heading") else text)
    return "\n\n".join(lines)


def from_pptx(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        names = sorted(
            (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),
        )
        out = []
        for name in names:
            num = re.search(r"(\d+)", name.rsplit("/", 1)[1]).group(1)
            root = ET.fromstring(z.read(name))
            runs = [xml_text(p).strip() for p in root.iter() if local(p.tag) == "p"]
            body = "\n".join(r for r in runs if r)
            notes = f"ppt/notesSlides/notesSlide{num}.xml"
            if notes in z.namelist():
                nroot = ET.fromstring(z.read(notes))
                ntext = "\n".join(t for t in (xml_text(p).strip() for p in nroot.iter()
                                              if local(p.tag) == "p") if t)
                if ntext.strip():
                    body += f"\n(notes) {ntext}"
            out.append(f"[slide {num}]\n{body}".rstrip())
    return "\n\n".join(out)


def from_xlsx(path: Path, max_rows: int = 200) -> str:
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            sroot = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [xml_text(si) for si in sroot if local(si.tag) == "si"]
        names = {}
        if "xl/workbook.xml" in z.namelist():
            wroot = ET.fromstring(z.read("xl/workbook.xml"))
            for i, sheet in enumerate((s for s in wroot.iter() if local(s.tag) == "sheet"), 1):
                names[i] = sheet.attrib.get("name", f"Sheet{i}")
        out = []
        sheets = sorted((n for n in z.namelist()
                         if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
        for name in sheets:
            idx = int(re.search(r"(\d+)", name.rsplit("/", 1)[1]).group(1))
            root = ET.fromstring(z.read(name))
            rows = []
            for row in (r for r in root.iter() if local(r.tag) == "row"):
                cells = []
                for c in (c for c in row if local(c.tag) == "c"):
                    val = next((xml_text(v) for v in c if local(v.tag) in ("v", "is")), "")
                    if c.attrib.get("t") == "s" and val.isdigit() and int(val) < len(shared):
                        val = shared[int(val)]
                    cells.append(val)
                if any(cells):
                    rows.append("\t".join(cells))
                if len(rows) >= max_rows:
                    rows.append(f"... (truncated at {max_rows} rows)")
                    break
            out.append(f"[sheet: {names.get(idx, f'Sheet{idx}')}]\n" + "\n".join(rows))
    return "\n\n".join(out)


# ---------------------------------------------------------------- web / mail

class _Text(HTMLParser):
    SKIP = {"script", "style", "head", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth and data.strip():
            self.parts.append(data.strip() + " ")


def html_to_text(markup: str) -> str:
    p = _Text()
    p.feed(markup)
    text = "".join(p.parts)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]{2,}", " ", text)).strip()


def from_html(path: Path) -> str:
    raw = path.read_text(errors="replace")
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    body = html_to_text(raw)
    return f"[title: {title.group(1).strip()}]\n{body}" if title else body


def from_eml(path: Path) -> str:
    with path.open("rb") as fh:
        msg = BytesParser(policy=policy.default).parse(fh)
    head = "\n".join(f"{k}: {msg[k]}" for k in ("From", "To", "Cc", "Date", "Subject") if msg[k])
    body = ""
    if msg.is_multipart():
        plain = msg.get_body(preferencelist=("plain",))
        html = msg.get_body(preferencelist=("html",))
        if plain is not None:
            body = plain.get_content()
        elif html is not None:
            body = html_to_text(html.get_content())
    else:
        content = msg.get_content()
        body = content if msg.get_content_type() == "text/plain" else html_to_text(content)
    return f"[email]\n{head}\n\n{body.strip()}"


def from_csv(path: Path, max_rows: int = 100) -> str:
    raw = path.read_text(errors="replace")
    delim = "\t" if path.suffix.lower() == ".tsv" else None
    if delim is None:
        try:
            delim = csv.Sniffer().sniff(raw[:4096]).delimiter
        except csv.Error:
            delim = ","
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    head = rows[:max_rows]
    text = "\n".join("\t".join(r) for r in head)
    if len(rows) > max_rows:
        text += f"\n... ({len(rows)} rows total, showing {max_rows})"
    return f"[table: {path.name} — {len(rows)} rows × {len(rows[0]) if rows else 0} cols]\n{text}"


HANDLERS = {
    ".docx": from_docx, ".pptx": from_pptx, ".xlsx": from_xlsx,
    ".html": from_html, ".htm": from_html, ".eml": from_eml,
    ".csv": from_csv, ".tsv": from_csv,
}


def extract(path: Path, max_chars: int) -> dict:
    ext = path.suffix.lower()
    if ext in READ_TOOL:
        raise SystemExit(f"{ext} is handled by the Read tool directly — do not use this script for it.")
    handler = HANDLERS.get(ext)
    if handler is None:
        raise SystemExit(f"no extractor for {ext} (supported: {', '.join(sorted(HANDLERS))})")
    text = handler(path)
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars] + f"\n... (truncated at {max_chars} chars)"
    return {"path": str(path), "ext": ext, "chars": len(text), "truncated": truncated, "text": text}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--max-chars", type=int, default=60000)
    ap.add_argument("--json", action="store_true", help="emit JSON instead of bare text")
    args = ap.parse_args(argv)
    path = Path(args.file).expanduser()
    if not path.is_file():
        raise SystemExit(f"not a file: {path}")
    result = extract(path, args.max_chars)
    print(json.dumps(result, indent=2) if args.json else result["text"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
