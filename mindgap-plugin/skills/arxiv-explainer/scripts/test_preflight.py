import subprocess, pathlib

SCRIPT = pathlib.Path(__file__).with_name("preflight.sh")
TOOLS = ["python3", "mindgap", "ffmpeg", "manim", "pdftoppm"]
PYLIBS = ["pymupdf", "pillow"]

def run():
    return subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True)

def test_exits_zero_even_when_tools_missing():
    assert run().returncode == 0

def test_reports_every_tool_and_lib():
    out = run().stdout
    for name in TOOLS + PYLIBS:
        line = [l for l in out.splitlines() if l.startswith(f"{name}:")]
        assert line, f"missing report line for {name}"
        assert line[0].split(":", 1)[1].strip() in {"ok", "missing"}

def test_python3_is_ok():
    out = run().stdout
    assert "python3: ok" in out
