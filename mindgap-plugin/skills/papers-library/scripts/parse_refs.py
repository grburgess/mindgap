#!/usr/bin/env python3
"""Parse a Papers (papersapp.com / ReadCube) BibTeX or RIS export into normalized JSON.

Stdlib only. Auto-detects format by content (`@type{` = BibTeX, `TY  - ` = RIS).

Usage:
  parse_refs.py <export.bib|export.ris>          # -> JSON array on stdout
  parse_refs.py <export.bib> --limit 50

Each record: {title, authors[], year, doi, arxiv, url, abstract, keywords[], type, citekey}.
Records with neither a title nor an identifier are dropped (a count is printed to stderr).
"""
import argparse, json, re, sys


def _clean(v):
    if v is None:
        return None
    v = v.replace("\n", " ").replace("\r", " ")
    v = re.sub(r"[{}]", "", v)          # strip BibTeX braces
    v = re.sub(r"\s+", " ", v).strip()
    return v or None


def _arxiv_from(fields, url):
    ep = fields.get("eprint") or ""
    ap = (fields.get("archiveprefix") or "").lower()
    if ep and ("arxiv" in ap or re.fullmatch(r"\d{4}\.\d{4,5}(v\d+)?", ep)):
        return re.sub(r"v\d+$", "", ep)
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([\d.]+\d)", url or "")
    return m.group(1) if m else None


def _doi_from(fields, url):
    d = fields.get("doi")
    if d:
        return re.sub(r"^https?://(dx\.)?doi\.org/", "", d).strip()
    m = re.search(r"doi\.org/(10\.\S+)", url or "")
    return m.group(1) if m else None


def _split_authors(s):
    if not s:
        return []
    return [a.strip() for a in re.split(r"\s+and\s+", s) if a.strip()]


def parse_bibtex(text):
    out = []
    for m in re.finditer(r"@(\w+)\s*\{", text):
        typ = m.group(1).lower()
        if typ in ("comment", "preamble", "string"):
            continue
        i, depth, start = m.end(), 1, m.end()
        while i < len(text) and depth:
            depth += (text[i] == "{") - (text[i] == "}")
            i += 1
        body = text[start:i - 1]
        citekey, _, fields_str = body.partition(",")
        out.append(_normalize(typ, citekey.strip(), _parse_bib_fields(fields_str)))
    return out


def _parse_bib_fields(s):
    fields, i, n = {}, 0, len(s)
    while i < n:
        m = re.match(r"\s*([\w\-]+)\s*=\s*", s[i:])
        if not m:
            break
        key = m.group(1).lower()
        i += m.end()
        if i >= n:
            break
        if s[i] == "{":
            depth, i, start = 1, i + 1, i + 1
            while i < n and depth:
                depth += (s[i] == "{") - (s[i] == "}")
                i += 1
            val = s[start:i - 1]
        elif s[i] == '"':
            i += 1
            start = i
            while i < n and s[i] != '"':
                i += 1
            val, i = s[start:i], i + 1
        else:
            m2 = re.match(r"[^,]*", s[i:])
            val, i = m2.group(0).strip(), i + m2.end()
        fields[key] = val
        i += re.match(r"\s*,?\s*", s[i:]).end()
    return fields


def parse_ris(text):
    out, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$", line)
        if not m:
            if cur is not None and line.strip():
                cur["_abstract"] = (cur.get("_abstract", "") + " " + line.strip())
            continue
        tag, val = m.group(1), m.group(2).strip()
        if tag == "TY":
            cur = {"type": val, "_authors": [], "_keywords": []}
            out.append(cur)
        elif cur is None:
            continue
        elif tag in ("TI", "T1"):
            cur["_title"] = val
        elif tag in ("AU", "A1"):
            cur["_authors"].append(val)
        elif tag in ("PY", "Y1", "DA"):
            cur.setdefault("_year", val[:4])
        elif tag == "DO":
            cur["_doi"] = val
        elif tag == "UR":
            cur.setdefault("_url", val)
        elif tag == "AB":
            cur["_abstract"] = (cur.get("_abstract", "") + " " + val).strip()
        elif tag == "KW":
            cur["_keywords"].append(val)
    recs = []
    for e in out:
        url = e.get("_url")
        recs.append(_finalize(
            title=e.get("_title"), authors=e.get("_authors", []), year=e.get("_year"),
            doi=re.sub(r"^https?://(dx\.)?doi\.org/", "", e["_doi"]) if e.get("_doi") else None,
            arxiv=_arxiv_from({}, url), url=url, abstract=e.get("_abstract"),
            keywords=e.get("_keywords", []), typ=e.get("type", "JOUR").lower(), citekey=None))
    return recs


def _normalize(typ, citekey, f):
    url = _clean(f.get("url"))
    kw = f.get("keywords") or ""
    keywords = [k.strip() for k in re.split(r"[;,]", _clean(kw) or "") if k.strip()]
    return _finalize(
        title=_clean(f.get("title")), authors=_split_authors(_clean(f.get("author"))),
        year=_clean(f.get("year")), doi=_doi_from(f, url), arxiv=_arxiv_from(f, url),
        url=url, abstract=_clean(f.get("abstract")), keywords=keywords, typ=typ, citekey=citekey)


def _finalize(*, title, authors, year, doi, arxiv, url, abstract, keywords, typ, citekey):
    return {
        "title": _clean(title), "authors": [_clean(a) for a in (authors or []) if _clean(a)],
        "year": _clean(year), "doi": doi, "arxiv": arxiv, "url": url,
        "abstract": _clean(abstract), "keywords": [k for k in (keywords or []) if k],
        "type": typ, "citekey": citekey,
    }


def parse(text):
    if re.search(r"^\s*@\w+\s*\{", text, re.M):
        return parse_bibtex(text)
    if re.search(r"^TY\s{1,2}-", text, re.M):
        return parse_ris(text)
    raise SystemExit("unrecognized format: expected BibTeX (@type{...}) or RIS (TY  - ...)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args(argv)
    text = open(args.path, encoding="utf-8", errors="replace").read()
    recs = parse(text)
    kept = [r for r in recs if r["title"] or r["doi"] or r["arxiv"]]
    dropped = len(recs) - len(kept)
    if args.limit:
        kept = kept[:args.limit]
    print(json.dumps(kept, indent=2))
    print(f"parsed {len(recs)} records, kept {len(kept)}, dropped {dropped} (no title/id)",
          file=sys.stderr)


if __name__ == "__main__":
    main()
