#!/usr/bin/env python3
"""PostToolUse hook: nudge the paper-to-mindmap skill when a research paper is read.

Reads the PostToolUse JSON payload on stdin. If the tool was a WebFetch of a
paper host (or a .pdf) or a Read of a .pdf, prints a factual additionalContext
nudge and exits 0. On any non-match or error: prints nothing, exits 0. Never
blocks the tool (PostToolUse runs after the tool anyway).
"""
import json
import sys

PAPER_HOSTS = ("arxiv.org", "openreview.net", "aclanthology.org",
               "biorxiv.org", "semanticscholar.org")


def is_paper(tool_name, tool_input):
    if tool_name == "WebFetch":
        url = (tool_input.get("url") or "").lower()
        return url.endswith(".pdf") or any(h in url for h in PAPER_HOSTS)
    if tool_name == "Read":
        return (tool_input.get("file_path") or "").lower().endswith(".pdf")
    return False


def source(tool_name, tool_input):
    if tool_name == "WebFetch":
        return tool_input.get("url") or "a fetched URL"
    return tool_input.get("file_path") or "a local file"


def main():
    try:
        payload = json.load(sys.stdin)
        tool_name = payload.get("tool_name")
        tool_input = payload.get("tool_input") or {}
        if is_paper(tool_name, tool_input):
            note = (
                f"The item just read is a research paper ({source(tool_name, tool_input)}). "
                "The paper-to-mindmap skill captures papers read for technical learning "
                "(ML, computer vision, remote sensing, property analytics, etc.) into the "
                "mindgap knowledge graph, linking them with evidence to related existing "
                "nodes. It applies only when the paper was read to learn something in those "
                "domains."
            )
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": note,
                }
            }))
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
