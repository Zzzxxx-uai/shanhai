# -*- coding: utf-8 -*-
"""把用户录好的音频导入绘本，自动生成录音映射表。

用法：
    python tools/import_audio.py                # 默认读 shanhai/录音/
    python tools/import_audio.py --src D:/我的录音
    python tools/import_audio.py --clear        # 清空已导入的录音

命名规则：文件名里带页码即可，如 01.mp3 / 1.mp3 / p03.m4a / 第7页.wav / 12-旋龟.mp3
文件会按页码重命名为 assets/audio/p01.mp3 …，并写入 assets/js/audio-map.js。
"""
import argparse, io, os, re, shutil, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD_DIR = os.path.join(BASE, 'assets', 'audio')
MAP_JS = os.path.join(BASE, 'assets', 'js', 'audio-map.js')
EXTS = {'.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac'}
MAX_PAGES = 60          # 绘本页数上限（当前 25 页，留余量）
MAX_SIZE = 6 * 1024 * 1024   # 单页录音超过 6MB 提醒压缩

TEMPLATE = """/* ===========================================================
 * 真人录音映射表（由 tools/import_audio.py 自动生成，请勿手改）
 * 键 = 页码（从 1 起），值 = 音频路径。
 * 为空时绘本自动退回浏览器合成语音。
 * =========================================================== */
window.AUDIO = %s;
"""


def write_map(mapping):
    body = '{\n' + ',\n'.join('  %d: %r' % (k, mapping[k]) for k in sorted(mapping)) + '\n}' if mapping else '{}'
    io.open(MAP_JS, 'w', encoding='utf-8').write(TEMPLATE % body)
    print('已写入:', MAP_JS)


def clear():
    n = 0
    if os.path.isdir(AUD_DIR):
        for f in os.listdir(AUD_DIR):
            if os.path.splitext(f)[1].lower() in EXTS:
                os.remove(os.path.join(AUD_DIR, f))
                n += 1
    write_map({})
    print('已清除 %d 个音频文件，绘本回到合成语音。' % n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(BASE, '录音'))
    ap.add_argument('--clear', action='store_true')
    args = ap.parse_args()

    if args.clear:
        clear()
        return

    src = args.src
    if not os.path.isdir(src):
        sys.exit('找不到录音目录：%s\n请把音频放进该目录，或用 --src 指定其他目录。' % src)

    os.makedirs(AUD_DIR, exist_ok=True)

    picked, bad, dup = {}, [], []
    for fn in sorted(os.listdir(src)):
        stem, ext = os.path.splitext(fn)
        if ext.lower() not in EXTS:
            continue
        m = re.search(r'(\d{1,2})', stem)
        if not m:
            bad.append(fn)
            continue
        n = int(m.group(1))
        if n < 1 or n > MAX_PAGES:
            bad.append(fn)
            continue
        if n in picked:
            dup.append((fn, picked[n][0]))
            continue
        picked[n] = (fn, os.path.join(src, fn), ext.lower())

    if not picked:
        sys.exit('该目录里没找到可识别的音频（文件名需含页码，如 01.mp3）。')

    # 清掉旧的（避免上一版残留文件被误用）
    for f in os.listdir(AUD_DIR):
        if os.path.splitext(f)[1].lower() in EXTS:
            os.remove(os.path.join(AUD_DIR, f))

    mapping, total = {}, 0
    for n in sorted(picked):
        fn, path, ext = picked[n]
        target = 'p%02d%s' % (n, ext)
        shutil.copyfile(path, os.path.join(AUD_DIR, target))
        size = os.path.getsize(path)
        total += size
        mapping[n] = 'assets/audio/' + target
        flag = '  ← 偏大，建议压到 1MB 内' if size > MAX_SIZE else ''
        print('  [%02d] %-28s -> %s  (%.0f KB)%s'
              % (n, fn, target, size / 1024, flag))

    write_map(mapping)

    missing = [i for i in range(1, max(picked) + 1) if i not in mapping]
    print('\n导入 %d 页，合计 %.1f MB' % (len(mapping), total / 1048576))
    if missing:
        print('缺页（这些页将用合成语音兜底）：%s' % ', '.join('%02d' % i for i in missing))
    if bad:
        print('未识别（文件名没有页码）：%s' % ', '.join(bad))
    if dup:
        print('重复页码（已忽略后者）：%s' % ', '.join('%s↔%s' % d for d in dup))
    print('\n下一步：python tools/build_standalone.py  重新生成单文件版与压缩包')


if __name__ == '__main__':
    main()
