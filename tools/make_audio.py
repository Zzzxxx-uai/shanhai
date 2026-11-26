# -*- coding: utf-8 -*-
"""生成绘本用的两个音频素材（纯程序合成，无版权问题）：

  assets/audio/page-flip.mp3   翻书声（纸张沙沙），约 0.6s，单声道
  assets/audio/bgm.mp3/.ogg    背景纯音乐，64s 无缝循环，单声道

做法：
  · 翻书声 = 若干短促的带通噪声颗粒（纸纤维摩擦）+ 一段更宽的"哗"声 + 极轻的低频气流，
    高频做过柔化（11kHz 以上滚降），听感轻而不刺。
  · 背景乐 = 古琴式拨弦（谐波叠加 + 指数衰减）+ 缓慢铺底和声垫 + 低音持续音，
    五声音阶（D 宫），60BPM，16 小节；末尾混响尾巴折回开头，循环处不断裂。
编码用 ffmpeg（libmp3lame / libvorbis），体积小、浏览器原生支持。

用法：python tools/make_audio.py
"""
import os
import subprocess
import wave

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'audio')
FFMPEG = r'C:\Users\zhouy\AppData\Roaming\bilibili\ffmpeg\ffmpeg.exe'

rng = np.random.default_rng(20261126)


# --------------------------------------------------------------------------- #
# 通用小工具（只依赖 numpy）
# --------------------------------------------------------------------------- #
def fft_filter(x, sr, lo=None, hi=None, order=2):
    """零相位频域滤波：Butterworth 形状的幅度响应，lo/hi 为 -3dB 截止。"""
    n = len(x)
    N = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, N)
    f = np.fft.rfftfreq(N, 1.0 / sr)
    mag = np.ones_like(f)
    if hi:
        mag /= np.sqrt(1.0 + (f / hi) ** (2 * order))
    if lo:
        mag *= 1.0 / np.sqrt(1.0 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    return np.fft.irfft(X * mag, N)[:n]


def fade(x, sr, attack=0.005, release=0.02):
    n = len(x)
    a = min(int(attack * sr), n // 2)
    r = min(int(release * sr), n // 2)
    if a:
        x[:a] *= np.linspace(0.0, 1.0, a) ** 1.5
    if r:
        x[-r:] *= np.linspace(1.0, 0.0, r) ** 1.5
    return x


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)))


def db(v):
    return 20 * np.log10(max(v, 1e-9))


def write_wav(path, x, sr):
    y = np.clip(x, -1.0, 1.0)
    pcm = (y * 32767.0).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def encode(src_wav, dst, codec_args):
    cmd = [FFMPEG, '-y', '-loglevel', 'error', '-i', src_wav] + codec_args + [dst]
    subprocess.run(cmd, check=True)
    return os.path.getsize(dst)


# --------------------------------------------------------------------------- #
# 一、翻书声
# --------------------------------------------------------------------------- #
def make_page_flip():
    sr = 44100
    dur = 0.62
    n = int(dur * sr)
    t = np.arange(n) / sr
    out = np.zeros(n)

    # 1) 纸纤维的细碎摩擦：一串短颗粒，前密后疏
    grains = 16
    for i in range(grains):
        # 起始时刻集中在 0~0.26s，越往后越稀
        p = i / (grains - 1.0)
        start = (p ** 1.6) * 0.30 + rng.uniform(-0.012, 0.012)
        start = max(0.0, start)
        glen = int(rng.uniform(0.012, 0.045) * sr)
        a = int(start * sr)
        if a + glen >= n:
            continue
        g = rng.standard_normal(glen)
        center = rng.uniform(1700, 5200)
        g = fft_filter(g, sr, lo=center * 0.6, hi=center * 1.6, order=2)
        env = np.hanning(glen) ** 1.2
        amp = rng.uniform(0.25, 0.75) * (1.0 - 0.55 * p)
        out[a:a + glen] += g * env * amp

    # 2) 整张纸离页的"哗"：一段宽带噪声，起得快、尾稍长
    sw = rng.standard_normal(n)
    sw = fft_filter(sw, sr, lo=600, hi=6500, order=2)
    env = np.exp(-t / 0.16) * (1.0 - np.exp(-t / 0.012))
    out += sw * env * 0.55

    # 3) 纸面带走的气流：低频给"厚度"，300–900Hz 一点"沙"的质感
    air = rng.standard_normal(n)
    air = fft_filter(air, sr, lo=90, hi=900, order=2)
    out += air * np.exp(-t / 0.10) * (1.0 - np.exp(-t / 0.02)) * 0.34

    # 4) 柔化：去掉齿音与次声，11kHz 以上滚降——"不刺耳"的关键
    out = fft_filter(out, sr, lo=150, hi=7800, order=3)
    out = fade(out, sr, 0.004, 0.06)

    out *= 0.72 / max(1e-9, np.max(np.abs(out)))
    return out, sr


# --------------------------------------------------------------------------- #
# 二、背景纯音乐
# --------------------------------------------------------------------------- #
SR = 32000
BEAT = 1.0                 # 60 BPM
LOOP = 64.0                # 16 小节 × 4 拍
TAIL = 3.0


def midi_hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def add(buf, x, start_s, sr=SR):
    a = int(round(start_s * sr))
    if a < 0:                     # 起点在 0 之前：把多出来的那段裁掉
        x = x[-a:]
        a = 0
    if a >= len(buf) or not len(x):
        return
    e = min(len(buf), a + len(x))
    buf[a:e] += x[:e - a]


def pluck(midi, dur=2.4, vel=0.4, bright=1.0):
    """模拟古琴/古筝的拨弦：谐波叠加 + 各自指数衰减 + 极短的起振噪声。"""
    f0 = midi_hz(midi) * rng.uniform(0.9985, 1.0015)
    n = int(dur * SR)
    t = np.arange(n) / SR
    # (倍数, 幅度, 衰减时间)：越高的谐波衰减越快，听感才像弦不像风琴
    parts = [(1.0, 1.00, 0.62), (2.0, 0.34, 0.40), (3.0, 0.16, 0.26),
             (4.01, 0.09, 0.17), (5.42, 0.05, 0.12)]
    x = np.zeros(n)
    for k, (mult, amp, tau) in enumerate(parts):
        if f0 * mult > SR * 0.45:
            break
        if k > 0:
            amp *= bright
        x += amp * np.exp(-t / tau) * np.sin(2 * np.pi * f0 * mult * t + rng.uniform(0, 6.28))
    # 拨片擦弦的瞬间（很轻，只为让音头清楚）
    an = int(0.02 * SR)
    if an < n:
        atk = rng.standard_normal(an) * np.hanning(an)
        atk = fft_filter(atk, SR, lo=1200, hi=6000)
        x[:an] += atk * 0.05
    return fade(x * vel, SR, 0.002, 0.05)


def pad(midi, start_s, dur_s, amp=0.1, attack=2.5, release=2.5):
    """和声垫：只用 1/2/3 次谐波，频率对齐到循环长度的整数分之一，
    保证整段在 64s 处相位连续（循环点听不出接缝）。
    包络用 sqrt 形，两块垫音交叠时功率大致恒定，换和弦不会"塌"下去。"""
    f = midi_hz(midi)
    f = round(f * LOOP) / LOOP           # 对齐到 1/64Hz 的栅格
    n = int(dur_s * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t)
    x += 0.22 * np.sin(2 * np.pi * 2 * f * t + 0.6)
    x += 0.07 * np.sin(2 * np.pi * 3 * f * t + 1.7)
    # 极慢的呼吸，让长音不呆板
    x *= 1.0 + 0.10 * np.sin(2 * np.pi * t / 11.0 + rng.uniform(0, 6.28))
    env = np.ones(n)
    a = min(int(attack * SR), n // 2)
    r = min(int(release * SR), n // 2)
    env[:a] = np.linspace(0, 1, a) ** 0.5
    env[-r:] = np.linspace(1, 0, r) ** 0.5
    return x * env * amp


MELODY = [
    # 引子（第 1–4 小节）只点几粒音，把空间让给和声
    (2.0, 62, 0.26), (6.0, 69, 0.22), (10.0, 66, 0.20), (13.5, 64, 0.18),
    # 第一句
    (16.0, 69, 0.46), (18.0, 66, 0.38), (19.5, 64, 0.34),
    (21.0, 62, 0.46), (22.5, 64, 0.30), (24.0, 66, 0.40),
    (26.0, 69, 0.38), (28.0, 71, 0.33), (30.0, 69, 0.28), (31.5, 66, 0.26),
    # 第二句（抬高一点）
    (32.0, 74, 0.40), (34.0, 71, 0.35), (35.5, 69, 0.30),
    (37.0, 66, 0.34), (38.5, 64, 0.28), (40.0, 62, 0.42),
    (42.0, 64, 0.30), (43.5, 66, 0.33), (45.0, 69, 0.35), (47.0, 74, 0.28),
    # 收束
    (48.0, 66, 0.34), (50.0, 64, 0.28), (51.5, 62, 0.34),
    (53.0, 50, 0.38), (56.0, 69, 0.30), (58.0, 66, 0.26),
    (60.0, 64, 0.25), (62.0, 62, 0.28), (63.0, 57, 0.24),
]

# 每 4 小节一次和弦：(起始拍, 低音 midi, 垫音 midi 列表)
CHORDS = [
    (0.0,  38, [62, 69, 74]),      # D 空五度（D4 A4 D5）
    (16.0, 47, [59, 62, 66]),      # Bm（B3 D4 F#4）
    (32.0, 43, [55, 59, 62]),      # G（G3 B3 D4）
    (48.0, 45, [57, 64, 69]),      # A5（A3 E4 A4，留出回到 D 的余地）
]


def make_bgm():
    """先铺两遍循环（第二遍才是要导出的那一段），
    这样开头不会有"从零起振"的痕迹，结尾的余音也能折回开头。
    两遍必须逐样本一致（每遍重新播种），否则循环点会错位、出现爆音。"""
    global rng
    cycles = 3
    total = LOOP * cycles + 4.0
    N = int(total * SR)
    dry = np.zeros(N)

    # 和弦垫提前 2.5s 起振、延后 2.5s 收尾，两块交叠约 5s，中间不断层
    lead, tail = 2.5, 2.5
    for cyc in range(cycles):
        rng = np.random.default_rng(20261126 + 7)      # 每遍同一套随机数
        for b0, bass, chord in CHORDS:
            start = cyc * LOOP + b0 * BEAT - lead
            dur = 16 * BEAT + lead + tail
            for j, m in enumerate(chord):
                add(dry, pad(m, start, dur, amp=0.100 if j == 0 else 0.072,
                             attack=lead, release=tail), start)
            # 低音持续音：正弦 + 一点二次谐波，很轻，只在手机外放时提供"底"
            n = int(dur * SR)
            t = np.arange(n) / SR
            fb = round(midi_hz(bass) * LOOP) / LOOP
            b = np.sin(2 * np.pi * fb * t) + 0.18 * np.sin(2 * np.pi * 2 * fb * t + 0.9)
            env = np.ones(n)
            a = min(int(lead * SR), n // 2)
            r = min(int(tail * SR), n // 2)
            env[:a] = np.linspace(0, 1, a) ** 0.5
            env[-r:] = np.linspace(1, 0, r) ** 0.5
            add(dry, b * env * 0.050, start)

        for beat, m, vel in MELODY:
            dur = 3.0 if m < 60 else 2.3
            add(dry, pluck(m, dur=dur, vel=vel * 0.80),
                cyc * LOOP + beat * BEAT + rng.uniform(-0.012, 0.012))
        # 极轻的泛音点缀（高声部，像远处风铃）
        for beat, m, vel in [(8.0, 81, 0.10), (34.0, 86, 0.07), (57.0, 81, 0.08)]:
            add(dry, pluck(m, dur=3.2, vel=vel * 0.8, bright=0.5), cyc * LOOP + beat * BEAT)

    # ---- 混响：指数衰减噪声做脉冲响应，湿声铺出空间 ----
    ir_len = 2.8
    ni = int(ir_len * SR)
    ti = np.arange(ni) / SR
    ir = rng.standard_normal(ni) * np.exp(-ti / 0.62)
    ir = fft_filter(ir, SR, lo=120, hi=4200, order=2)
    ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9

    Nfft = 1 << (len(dry) + ni - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(dry, Nfft) * np.fft.rfft(ir, Nfft), Nfft)
    wet = wet[:len(dry) + ni - 1]

    mix = np.zeros(len(wet))
    mix[:len(dry)] += dry
    mix += wet * 0.55

    # ---- 取中间那一遍循环 ----
    # 三遍逐样本一致、频率对齐到 1/64Hz 栅格，混响只回看 2.8s，
    # 所以 64–128s 这一段已经是"稳态"：开头带着前面那遍的余响，
    # 结尾的余响也已被第三遍接住。直接切片即可无缝循环，不需要再折叠尾巴
    # （折叠会把同一段混响叠两遍，循环点会突然响一截）。
    n_loop = int(LOOP * SR)
    loop = mix[n_loop:n_loop * 2].copy()

    # 收尾修形：去掉次声、整体柔化，再归一
    loop = fft_filter(loop, SR, lo=60, hi=12000, order=2)
    loop *= 0.62 / max(1e-9, np.max(np.abs(loop)))
    return loop, SR


# --------------------------------------------------------------------------- #
def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, '_tmp')

    sfx, sr1 = make_page_flip()
    write_wav(tmp + '_flip.wav', sfx, sr1)
    s1 = encode(tmp + '_flip.wav', os.path.join(OUT, 'page-flip.mp3'),
                ['-c:a', 'libmp3lame', '-b:a', '112k', '-ac', '1', '-ar', '44100'])
    print('page-flip.mp3 %.1f KB  peak %.2f  rms %.1f dBFS'
          % (s1 / 1024, np.max(np.abs(sfx)), db(rms(sfx))))

    bgm, sr2 = make_bgm()
    write_wav(tmp + '_bgm.wav', bgm, sr2)
    s2 = encode(tmp + '_bgm.wav', os.path.join(OUT, 'bgm.mp3'),
                ['-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-ar', '32000'])
    s3 = encode(tmp + '_bgm.wav', os.path.join(OUT, 'bgm.ogg'),
                ['-c:a', 'libvorbis', '-q:a', '2', '-ac', '1', '-ar', '32000'])
    # 循环点是否连续：末 5ms 与首 5ms 的跳变
    jump = float(np.max(np.abs(bgm[:220] - bgm[-220:])))
    print('bgm.mp3 %.1f KB / bgm.ogg %.1f KB  peak %.2f  rms %.1f dBFS  接缝跳变 %.3f'
          % (s2 / 1024, s3 / 1024, np.max(np.abs(bgm)), db(rms(bgm)), jump))

    for f in ('_flip.wav', '_bgm.wav'):
        p = tmp + f
        if os.path.exists(p):
            os.remove(p)


if __name__ == '__main__':
    main()
