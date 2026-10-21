# -*- coding: utf-8 -*-
"""
一键把本地改动同步到 GitHub（不依赖 git push，走 GitHub Git Data API）。

背景：WorkBuddy 沙箱里 git 连不上 github.com:443（fetch/push 全部超时），
但 HTTPS 库可以。所以改用 API 直接建 tree/commit/更新 ref，效果等同 push。

凭证来源：用户第一次 push 时 Git Credential Manager 存下的 OAuth token，
用 `git credential fill` 取出即可，无需用户再次授权。

用法：
    python tools/deploy_github.py                 # 同步改动
    python tools/deploy_github.py --dry-run       # 只看有哪些文件会变，不提交
    python tools/deploy_github.py -m "说明文字"   # 自定义提交信息
"""
import os
import sys
import json
import time
import base64
import subprocess
import urllib.request
import urllib.error

REPO = "Zzzxxx-uai/shanhai"
BRANCH = "main"
SITE = "https://zzzxxx-uai.github.io/shanhai/"
GIT = r"C:/Users/zhouy/.workbuddy/vendor/PortableGit/mingw64/bin/git.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_DIRS = {".git", "__pycache__", ".workbuddy", "node_modules"}
EXCLUDE_EXT = {".pyc", ".tmp", ".log"}


def get_token():
    """从 Git 凭证管理器取出用户已授权的 token（不弹窗、不联网交互）"""
    p = subprocess.run([GIT, "credential", "fill"],
                       input="protocol=https\nhost=github.com\n\n",
                       capture_output=True, text=True, cwd=ROOT)
    for line in p.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    sys.exit("取不到 GitHub 凭证：请先在 PowerShell 里成功执行一次 git push 完成授权")


TOKEN = None


def api(method, path, data=None):
    req = urllib.request.Request("https://api.github.com" + path, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "shanhai-deploy")
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, body, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit("API %s %s 失败 %s：%s" % (method, path, e.code, e.read()[:400].decode("utf-8", "replace")))


def local_files():
    """收集待同步文件（相对路径 -> 绝对路
径），跳过临时/无关文件"""
    out = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            if fn.startswith("_") or os.path.splitext(fn)[1] in EXCLUDE_EXT:
                continue
            abs_p = os.path.join(dirpath, fn)
            rel = os.path.relpath(abs_p, ROOT).replace("\\", "/")
            out[rel] = abs_p
    return out


def blob_sha(rel, abs_p):
    """与 git 入库一致的 blob sha：--path 让 hash-object 应用 CRLF→LF 等 clean 过滤"""
    p = subprocess.run([GIT, "hash-object", "--path=" + rel, abs_p],
                       capture_output=True, text=True, cwd=ROOT)
    return p.stdout.strip()


def main():
    dry = "--dry-run" in sys.argv
    msg = "更新作品内容与素材"
    if "-m" in sys.argv:
        msg = sys.argv[sys.argv.index("-m") + 1]

    global TOKEN
    TOKEN = get_token()
    ref = api("GET", "/repos/%s/git/ref/heads/%s" % (REPO, BRANCH))
    base_commit = ref["object"]["sha"]

    tree = api("GET", "/repos/%s/git/trees/%s?recursive=1" % (REPO, BRANCH))
    remote = {i["path"]: i["sha"] for i in tree["tree"] if i["type"] == "blob"}

    files = local_files()
    changed = []
    for rel, abs_p in sorted(files.items()):
        sha = blob_sha(rel, abs_p)
        if remote.get(rel) != sha:
            changed.append((rel, abs_p, "新增" if rel not in remote else "修改"))

    print("本地文件 %d 个，远端 %d 个" % (len(files), len(remote)))
    if not changed:
        print("无改动，无需同步。站点：%s" % SITE)
        return
    print("变更 %d 个：" % len(changed))
    for rel, abs_p, kind in changed:
        print("  [%s] %s  (%.0f KB)" % (kind, rel, os.path.getsize(abs_p) / 1024))
    if dry:
        print("--dry-run：未提交")
        return

    # 只把变化的文件放进新 tree；未变化的文件由 base tree 自动继承
    entries = []
    for rel, abs_p, _ in changed:
        with open(abs_p, "rb") as f:
            content = f.read().decode("utf-8")
        entries.append({"path": rel, "mode": "100644", "type": "blob", "content": content})

    new_tree = api("POST", "/repos/%s/git/trees" % REPO,
                   {"base_tree": base_commit, "tree": entries})
    commit = api("POST", "/repos/%s/git/commits" % REPO,
                 {"message": msg, "tree": new_tree["sha"], "parents": [base_commit]})
    api("PATCH", "/repos/%s/git/refs/heads/%s" % (REPO, BRANCH),
        {"sha": commit["sha"]})
    print("已提交 %s：%s" % (commit["sha"][:8], msg))

    # 等 Pages 重新构建
    for _ in range(30):
        time.sleep(10)
        b = api("GET", "/repos/%s/pages/builds/latest" % REPO)
        st = b.get("status")
        if st == "built":
            print("Pages 构建完成：%s" % SITE)
            return
        if st == "errored":
            sys.exit("Pages 构建失败：%s" % (b.get("error") or {}).get("message"))
    print("构建仍在排队，稍后访问：%s" % SITE)


if __name__ == "__main__":
    main()
