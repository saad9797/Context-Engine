import ast
import json
from pathlib import Path
import unittest

from collect_public_data import changed_lines, units
from notebook_helpers import validate_rows, split_repositories


class PublicCollectionTests(unittest.TestCase):
    def test_complete_python_units_keep_decorators_and_body(self):
        source = '# padding\n' * 100 + '@logged\ndef small():\n    return 42\n'
        selected = units(source, 'app.py')
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0][2], '@logged\ndef small():\n    return 42\n')
        ast.parse(selected[0][2])

    def test_change_anchors_include_deletions_and_insertions(self):
        patch = '@@ -10,3 +10,3 @@\n unchanged\n-old\n+new\n unchanged'
        self.assertEqual(changed_lines(patch), {11})

    def test_large_units_are_omitted_not_cut(self):
        self.assertEqual(units('def big():\n' + '    pass\n' * 100, 'app.py'), [])

    def test_bundled_data_has_provenance_and_licenses(self):
        root = Path(__file__).parent / 'public_data'
        rows = validate_rows([json.loads(line) for line in (root / 'candidates.jsonl').read_text().splitlines()])
        self.assertGreaterEqual(len({r['repo_id'] for r in rows}), 3)
        for row in rows:
            self.assertFalse(row['labels_verified'])
            self.assertEqual(row['label_source'], 'weak_patch_overlap_v1')
            self.assertIn(row['source_commit'], row['source_url'])
            self.assertTrue((root / row['license_file']).is_file())
            self.assertLessEqual(len(row['content']), 700)
        splits = split_repositories(rows)
        self.assertTrue(all(splits.values()))


if __name__ == '__main__':
    unittest.main()
