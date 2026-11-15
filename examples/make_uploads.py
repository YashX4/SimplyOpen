"""Packs every example into the zip a maker would upload on the website.

Run from anywhere:  python3 examples/make_uploads.py

For each example folder that has a simplyopen.json it writes uploads/<name>.zip
(the project's files, without the SimplyOpen files), and it writes
uploads/index.json listing, for every example, the three files the website
and the Factory work from: the zip, the Analyzer's answer and the sample answers.
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "uploads")
LEFT_OUT = {"simplyopen.json", "simplyopen.sample.json"}
RAW = "https://raw.githubusercontent.com/akondreddy/SimplyOpen/main/examples/"


def projects():
    for group in ("", "from_github"):
        folder = os.path.join(HERE, group)
        for name in sorted(os.listdir(folder)):
            if os.path.isfile(os.path.join(folder, name, "simplyopen.json")):
                yield os.path.join(group, name).replace(os.sep, "/")


def pack(project):
    """Writes the zip; the same files always give the same bytes."""
    root = os.path.join(HERE, project)
    target = os.path.join(OUT, os.path.basename(project) + ".zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for folder, dirs, files in os.walk(root):
            dirs[:] = sorted(d for d in dirs if d != "__pycache__")
            for name in sorted(files):
                path = os.path.join(folder, name)
                inside = os.path.relpath(path, root).replace(os.sep, "/")
                if inside in LEFT_OUT or name == ".DS_Store":
                    continue
                info = zipfile.ZipInfo(inside, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                with open(path, "rb") as f:
                    archive.writestr(info, f.read())
    return target


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for project in projects():
        with open(os.path.join(HERE, project, "simplyopen.json"), encoding="utf-8") as f:
            app = json.load(f)
        name = os.path.basename(project)
        pack(project)
        has_sample = os.path.isfile(os.path.join(HERE, project, "simplyopen.sample.json"))
        index.append({
            "id": name,
            "name": app["name"],
            "description": app["description"],
            "source": "github" if project.startswith("from_github/") else "simplyopen",
            "project_url": f"{RAW}uploads/{name}.zip",
            "app_url": f"{RAW}{project}/simplyopen.json",
            "sample_url": f"{RAW}{project}/simplyopen.sample.json" if has_sample else None,
        })
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Packed {len(index)} projects into {OUT}")


if __name__ == "__main__":
    main()
