"""Optional packaging-only checks; all files are synthetic temporary copies."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import package_plugin


class PackageChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        self.original = package_plugin.ROOT
        for filename in package_plugin.FILES:
            target = self.root / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.original / filename, target)
        package_plugin.ROOT = self.root
        self.output = Path(self.temp.name) / "plugin.zip"

    def tearDown(self):
        package_plugin.ROOT = self.original
        self.temp.cleanup()

    def test_valid_allowlist_package(self):
        package_plugin.build(self.output)
        self.assertTrue(self.output.is_file())

    def test_manifest_symlink_rejected_before_reading(self):
        outside = Path(self.temp.name) / "synthetic-private.txt"
        outside.write_text("not JSON; must never be read as a manifest")
        manifest = self.root / "plugin.json"
        manifest.unlink()
        manifest.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "Only contained regular files"):
            package_plugin.build(self.output)

    def test_credential_like_extra_server_field_rejected(self):
        path = self.root / "mcp.json"
        config = json.loads(path.read_text())
        config["mcpServers"]["openrouter"]["token"] = "synthetic-placeholder"
        path.write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, "without credential headers"):
            package_plugin.build(self.output)

    def test_output_inside_source_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside the source"):
            package_plugin.build(self.root / "plugin.zip")


if __name__ == "__main__":
    unittest.main()
