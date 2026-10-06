"""Build an unpublished portable plugin archive from an explicit safe file list."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ["plugin.json", "mcp.json", ".mcp.json", ".codex-plugin/plugin.json", "skills/openrouter/SKILL.md", "LICENSE"]


def build(output: Path) -> None:
    for filename in FILES:
        path = ROOT / filename
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError("Only contained regular files may be packaged")
    root = json.loads((ROOT / "plugin.json").read_text())
    compatibility = json.loads((ROOT / ".codex-plugin/plugin.json").read_text())
    if root["name"] != "openrouter-mcp" or root["version"] != compatibility["version"]:
        raise ValueError("Plugin identity/version mismatch")
    interface = root["extensions"]["com.openai"]["interface"]
    if interface != compatibility["interface"] or len(interface["shortDescription"]) > 30:
        raise ValueError("Plugin interface metadata mismatch")
    for filename in ["mcp.json", ".mcp.json"]:
        servers = json.loads((ROOT / filename).read_text())["mcpServers"]
        if list(servers) != ["openrouter"] or set(servers["openrouter"]) - {"type", "url", "headers"} or servers["openrouter"].get("type") != "streamable-http" or servers["openrouter"].get("url") != "https://mcp.openrouter.ai/mcp" or servers["openrouter"].get("headers", {}) != {}:
            raise ValueError("Default package must contain only the verified official MCP without credential headers")
    output = output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError("Write the archive outside the source/package directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for filename in FILES:
            archive.write(ROOT / filename, f"{root['name']}/{filename}")
    with zipfile.ZipFile(output) as archive:
        expected = [f"{root['name']}/{filename}" for filename in FILES]
        if archive.namelist() != expected or archive.testzip() is not None:
            raise ValueError("Archive verification failed")
        for filename in FILES:
            if archive.read(f"{root['name']}/{filename}") != (ROOT / filename).read_bytes():
                raise ValueError("Packaged bytes differ from source")
    print(f"Verified unpublished {root['name']} {root['version']} archive with {len(FILES)} allowlisted files: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args().output)
