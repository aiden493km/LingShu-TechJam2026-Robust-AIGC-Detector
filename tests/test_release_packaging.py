import json
import unittest
from pathlib import Path


class ReleasePackagingTests(unittest.TestCase):
    REPOSITORY_ROOT = Path(__file__).resolve().parents[1]

    def test_v1_2_metadata_and_license_exist(self) -> None:
        package_json = json.loads(
            (self.REPOSITORY_ROOT / "web_demo" / "package.json").read_text(
                encoding="utf-8"
            )
        )
        package_lock = json.loads(
            (self.REPOSITORY_ROOT / "web_demo" / "package-lock.json").read_text(
                encoding="utf-8"
            )
        )
        license_path = self.REPOSITORY_ROOT / "LICENSE"

        self.assertEqual(package_json["version"], "1.2.0")
        self.assertEqual(package_lock["version"], "1.2.0")
        self.assertEqual(package_lock["packages"][""]["version"], "1.2.0")
        self.assertTrue(license_path.is_file(), "Expected root LICENSE to exist")

        license_text = license_path.read_text(encoding="utf-8")
        self.assertIn("MIT License", license_text)
        self.assertIn("LingShu Intelligence contributors", license_text)

    def test_readme_keeps_evidence_and_exposes_release(self) -> None:
        readme_text = (self.REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn('<div align="center">', readme_text)
        self.assertIn("releases/tag/v1.2.0", readme_text)
        self.assertIn("0.973977", readme_text)
        self.assertIn("0.927090", readme_text)
        self.assertIn("0.993124", readme_text)
        self.assertIn("## License", readme_text)
        self.assertIn("THIRD_PARTY_NOTICES.md", readme_text)
        self.assertIn("Community-Forensics-LICENSE", readme_text)

        centered_div_index = readme_text.index('<div align="center">')
        at_a_glance_index = readme_text.index("## At a Glance")
        third_party_index = readme_text.rindex("## Third-Party Attribution")
        license_index = readme_text.rindex("## License")

        self.assertLess(centered_div_index, at_a_glance_index)
        self.assertGreater(license_index, third_party_index)


if __name__ == "__main__":
    unittest.main()
