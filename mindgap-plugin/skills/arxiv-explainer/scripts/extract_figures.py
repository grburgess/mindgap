#!/usr/bin/env python3
"""Render/crop/extract figures from a PDF for arxiv-explainer.

Usage:
  extract_figures.py render <pdf> <outdir> [--dpi 150]
  extract_figures.py crop <image> <outdir> --bbox X,Y,W,H [--name NAME]
  extract_figures.py images <pdf> <outdir>
"""
import argparse, pathlib, sys


def cmd_render(args):
    import fitz
    outdir = pathlib.Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(args.pdf)
    zoom = args.dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    paths = []
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=mat)
        p = outdir / f"page-{i:03d}.png"
        pix.save(str(p)); paths.append(p)
    doc.close()
    for p in paths:
        print(p)


def _parse_bbox(s):
    x, y, w, h = (int(v) for v in s.split(","))
    return x, y, w, h


def cmd_crop(args):
    from PIL import Image
    outdir = pathlib.Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    x, y, w, h = _parse_bbox(args.bbox)
    im = Image.open(args.image).crop((x, y, x + w, y + h))
    name = args.name or f"crop-{x}-{y}-{w}-{h}"
    p = outdir / f"{name}.png"
    im.save(str(p))
    print(p)


def cmd_images(args):
    import fitz
    outdir = pathlib.Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(args.pdf)
    n = 0
    for page in doc:
        for img in page.get_images(full=True):
            xref = img[0]
            pix = fitz.Pixmap(doc, xref)
            if pix.n - pix.alpha >= 4:  # CMYK/other → RGB
                pix = fitz.Pixmap(fitz.csRGB, pix)
            n += 1
            p = outdir / f"img-{n:03d}.png"
            pix.save(str(p)); print(p)
    doc.close()


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("render"); pr.add_argument("pdf"); pr.add_argument("outdir")
    pr.add_argument("--dpi", type=int, default=150); pr.set_defaults(func=cmd_render)

    cr = sub.add_parser("crop"); cr.add_argument("image"); cr.add_argument("outdir")
    cr.add_argument("--bbox", required=True); cr.add_argument("--name", default=None)
    cr.set_defaults(func=cmd_crop)

    im = sub.add_parser("images"); im.add_argument("pdf"); im.add_argument("outdir")
    im.set_defaults(func=cmd_images)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
