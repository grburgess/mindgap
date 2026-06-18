import subprocess, sys, pathlib
import fitz  # PyMuPDF
import pytest

SCRIPT = pathlib.Path(__file__).with_name("extract_figures.py")

def make_pdf(path, pages=2):
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=300, height=400)
        page.insert_text((50, 50), f"page {i}")
    doc.save(str(path)); doc.close()

def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)

def test_render_writes_one_png_per_page(tmp_path):
    pdf = tmp_path / "p.pdf"; make_pdf(pdf, pages=2)
    out = tmp_path / "figs"
    r = run("render", str(pdf), str(out), "--dpi", "100")
    assert r.returncode == 0, r.stderr
    pngs = sorted(out.glob("page-*.png"))
    assert len(pngs) == 2
    printed = [l for l in r.stdout.splitlines() if l.strip()]
    assert len(printed) == 2
    assert all(pathlib.Path(p).exists() for p in printed)

from PIL import Image

def test_crop_produces_exact_bbox_dims(tmp_path):
    img = tmp_path / "src.png"
    Image.new("RGB", (200, 160), "white").save(img)
    out = tmp_path / "figs"
    r = run("crop", str(img), str(out), "--bbox", "10,20,50,40", "--name", "fig1")
    assert r.returncode == 0, r.stderr
    cropped = out / "fig1.png"
    assert cropped.exists()
    assert Image.open(cropped).size == (50, 40)

def make_pdf_with_image(path):
    doc = fitz.open(); page = doc.new_page(width=300, height=400)
    # embed a small solid pixmap as an image
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 30))
    pix.set_rect(pix.irect, (10, 120, 200))
    page.insert_image(fitz.Rect(50, 50, 130, 110), pixmap=pix)
    doc.save(str(path)); doc.close()

def test_images_extracts_embedded_image(tmp_path):
    pdf = tmp_path / "img.pdf"; make_pdf_with_image(pdf)
    out = tmp_path / "imgs"
    r = run("images", str(pdf), str(out))
    assert r.returncode == 0, r.stderr
    pngs = list(out.glob("*.png"))
    assert len(pngs) >= 1
