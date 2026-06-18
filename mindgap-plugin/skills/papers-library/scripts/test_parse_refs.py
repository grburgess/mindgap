import unittest
import parse_refs as P

BIB = r"""
@article{vaswani2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  year = {2017},
  eprint = {1706.03762},
  archivePrefix = {arXiv},
  url = {https://arxiv.org/abs/1706.03762},
  keywords = {transformers; nlp},
  abstract = {The dominant sequence transduction models ...}
}
@article{devlin2019,
  title = {{BERT}: Pre-training of Deep Bidirectional Transformers},
  author = "Devlin, Jacob and Chang, Ming-Wei",
  year = "2019",
  doi = {10.18653/v1/N19-1423},
  journal = {NAACL}
}
"""

RIS = """TY  - JOUR
TI  - Deep Residual Learning for Image Recognition
AU  - He, Kaiming
AU  - Zhang, Xiangyu
PY  - 2016
DO  - 10.1109/CVPR.2016.90
UR  - https://arxiv.org/abs/1512.03385
KW  - vision
AB  - Deeper neural networks are more difficult to train.
ER  -
"""


class TestBibtex(unittest.TestCase):
    def setUp(self):
        self.recs = P.parse(BIB)

    def test_two_entries(self):
        self.assertEqual(len(self.recs), 2)

    def test_arxiv_and_authors(self):
        v = self.recs[0]
        self.assertEqual(v["title"], "Attention Is All You Need")
        self.assertEqual(v["arxiv"], "1706.03762")
        self.assertEqual(v["authors"][0], "Vaswani, Ashish")
        self.assertEqual(len(v["authors"]), 3)
        self.assertIn("transformers", v["keywords"])

    def test_quoted_values_and_doi_and_brace_strip(self):
        b = self.recs[1]
        self.assertEqual(b["title"], "BERT: Pre-training of Deep Bidirectional Transformers")
        self.assertEqual(b["year"], "2019")
        self.assertEqual(b["doi"], "10.18653/v1/N19-1423")
        self.assertEqual(b["authors"], ["Devlin, Jacob", "Chang, Ming-Wei"])


class TestRis(unittest.TestCase):
    def setUp(self):
        self.recs = P.parse(RIS)

    def test_one_entry_fields(self):
        self.assertEqual(len(self.recs), 1)
        r = self.recs[0]
        self.assertEqual(r["title"], "Deep Residual Learning for Image Recognition")
        self.assertEqual(r["authors"], ["He, Kaiming", "Zhang, Xiangyu"])
        self.assertEqual(r["year"], "2016")
        self.assertEqual(r["doi"], "10.1109/CVPR.2016.90")
        self.assertEqual(r["arxiv"], "1512.03385")  # derived from the arxiv UR


class TestFormatGuard(unittest.TestCase):
    def test_unknown_format_raises(self):
        with self.assertRaises(SystemExit):
            P.parse("just some plain text, no entries")


if __name__ == "__main__":
    unittest.main()
