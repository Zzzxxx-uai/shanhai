# -*- coding: utf-8 -*-
"""生成绘本用的背景音乐素材（纯程序合成，无版权问题）：

  assets/audio/bgm.mp3/.ogg    背景纯音乐，64s 无缝循环，单声道

风格：古风纯音乐 —— 一床古琴，一支箫，一阵空谷回响。

  · 古琴：谐波按"拨弦位置"梳状加权（越靠岳山拨越亮），
    高次谐波衰减更快，起音有极短的上滑（弦被拉紧后回落），
    句尾可带"走手"滑音；低音区用更长的余韵当散音。
  · 箫：正弦为骨，加二次谐波与气息噪声，缓起音、
    从下方约 40 音分"绰"上来，长音带轻微颤音，句尾可"注"下去。
  · 低音：极轻的 D2 持续音，只做"地"，不抢旋律。
  · 空间：3.6s 指数衰减噪声混响，压低高频，像在空堂里弹。
  · 结构：引子（散落几粒）→ 第一句 → 第二句（抬高、箫来对答）→ 收束回落，
    每句之间留白，是古琴曲的呼吸方式。

无缝循环：全曲 64s，渲染三遍取中间一遍——开头带着上一遍的余响，
结尾的余响也被第三遍接住，切片即循环，不需要折叠尾巴。
持续音（drone）频率对齐到 1/64Hz 栅格，保证跨循环点相位连续。

编码用 ffmpeg（libmp3lame / libvorbis），体积小、浏览器原生支持。

注：翻页音效（page-flip.mp3）已于 2026-11-26 按要求移除，此脚本不再生成它。

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


def env_ar(n, attack, release, sr=32000):
    """线性/S 形起落包络，两端只在需要时生效。"""
    env = np.ones(n)
    a = min(int(attack * sr), n // 2)
    r = min(int(release * sr), n // 2)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a) ** 0.55
    if r > 0:
        env[-r:] = np.linspace(1.0, 0.0, r) ** 0.8
    return env


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
# 二、背景纯音乐：古琴 + 箫
# --------------------------------------------------------------------------- #
SR = 32000
BEAT = 1.0                 # 一拍 1 秒（60 BPM）
LOOP = 64.0                # 16 小节 × 4 拍
CYCLES = 3


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


def qin(midi, vel=0.4, slide=0.0, pos=None, dur=None, bright=1.0, vib=None):
    """古琴拨弦。

    pos   拨弦点占弦长的比例：越靠近岳山（小）音色越亮、越高亢；
          0.5 处拨只有偶次谐波，正好是古琴的"泛音"。
    slide 走手滑音，正为上、负为下（约 ±0.012 即一个小二度左右）。
    vib   吟猱：长音上极轻的音高游移，是琴与电子音最大的分别。
    dur   不给就按余韵自然长度走（低音更长）。
    """
    f0 = midi_hz(midi) * rng.uniform(0.9992, 1.0009)

    # 余韵：低音区一床好琴能响七八秒，高音区短得多
    tau0 = 0.60 + 2.35 * (1.0 - min(1.0, max(0.0, (midi - 43) / 42.0)))
    if dur is None:
        dur = min(6.5, tau0 * 3.6)
    n = int(dur * SR)
    t = np.arange(n) / SR

    # 频率轨迹：起音略高（弦被拨紧），0.18s 内回落；之后是滑音
    settle = 0.0032 * np.exp(-t / 0.18)
    bend = slide * np.clip((t - 0.30) / 0.85, 0.0, 1.0) ** 1.5
    freq = f0 * (1.0 + settle + bend)
    if vib is None:
        vib = 0.0042 if midi < 68 else 0.0026
    if vib:
        # 慢起、慢慢收的游移，像指腹在弦上揉，不是机器颤音
        freq = freq * (1.0 + vib * np.sin(2 * np.pi * 4.3 * t + rng.uniform(0, 6.28))
                       * np.clip((t - 0.45) / 0.9, 0.0, 1.0) * np.exp(-t / 3.2))
    phase = 2.0 * np.pi * np.cumsum(freq) / SR
    # 第二根弦：比第一根高约 0.13%，两根一起响会有极慢的拍，
    # 这是真琴才有的"活气"，纯加法合成怎么调参数都做不出来
    phase2 = 2.0 * np.pi * np.cumsum(freq * 1.0013) / SR

    if pos is None:
        pos = 0.15 if midi < 70 else 0.21        # 高音稍稍靠里，免得发尖

    x = np.zeros(n)
    kmax = min(20, int(SR * 0.45 / f0))
    for k in range(1, kmax + 1):
        amp = abs(np.sin(np.pi * k * pos)) / k ** 1.10
        if k > 1:
            amp *= bright ** (0.55 * (k - 1) ** 0.6)
        tau = tau0 / (1.0 + 0.60 * (k - 1) ** 0.85)
        dec = amp * np.exp(-t / tau)
        x += dec * np.sin(k * phase + rng.uniform(0.0, 6.2832))
        if k <= 10:
            x += dec * 0.38 * np.sin(k * phase2 + rng.uniform(0.0, 6.2832))

    # 指甲擦弦的一瞬（很轻，只让音头立得住）
    an = int(0.025 * SR)
    if an < n:
        atk = fft_filter(rng.standard_normal(an) * np.hanning(an), SR,
                         lo=900, hi=5200)
        x[:an] += atk * (0.070 if pos < 0.4 else 0.024)

    x /= max(1e-9, np.max(np.abs(x)))
    return fade(x * vel, SR, 0.0015, 0.06)


def xiao(midi, dur=4.0, vel=0.16, bend=0.0, entry=0.022):
    """箫：气息为主。缓起音，从下方 entry 处"绰"上来，长音带极轻颤音。"""
    f0 = midi_hz(midi) * rng.uniform(0.9985, 1.0015)
    n = int(dur * SR)
    t = np.arange(n) / SR

    slide_in = -entry * np.exp(-t / 0.26)                       # 起音偏低后稳住
    vib = 1.0 + 0.0045 * np.sin(2 * np.pi * 5.1 * t + rng.uniform(0, 6.28)) \
        * np.clip((t - 0.45) / 1.1, 0.0, 1.0)                   # 颤音慢慢进来
    tail = bend * np.clip((t - dur * 0.62) / max(0.3, dur * 0.34), 0.0, 1.0) ** 1.6
    freq = f0 * vib * (1.0 + slide_in + tail)
    phase = 2.0 * np.pi * np.cumsum(freq) / SR

    x = np.sin(phase) + 0.20 * np.sin(2 * phase + 0.35) + 0.07 * np.sin(3 * phase + 1.2)
    breath = fft_filter(rng.standard_normal(n), SR, lo=1300, hi=6800)
    breath *= 0.30 + 0.70 * np.exp(-t / 0.85)                   # 气声在音头最多
    x = x + breath * 0.42

    x /= max(1e-9, np.max(np.abs(x)))
    return x * env_ar(n, 0.50, min(1.4, dur * 0.45)) * vel


def drone(midi, dur, amp, attack=2.5, release=2.5):
    """低音持续音：提供"地"。频率对齐 1/64Hz，跨循环点相位连续。"""
    f = round(midi_hz(midi) * LOOP) / LOOP
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) + 0.17 * np.sin(4 * np.pi * f * t + 0.8)
    x *= 1.0 + 0.12 * np.sin(2 * np.pi * t / 13.0 + rng.uniform(0, 6.28))   # 慢呼吸
    return x * env_ar(n, attack, release) * amp


# 五声 D 宫：D E F# A B。旋律只在五声里走，是"古"的第一层。
# (拍, 音高, 力度, 滑音)
MELODY = [
    # 引子（第 1–4 小节）—— 散落几粒，把时间留给余响
    (0.0,  50, 0.34, 0.0),      # D3 散音，一声就把场子定住
    (2.2,  74, 0.15, 0.0),      # D5 泛音（高中音区轻点）
    (5.4,  69, 0.30, 0.008),    # A4，绰上去
    (7.8,  66, 0.26, -0.007),   # F#4，注下来
    (10.4, 64, 0.24, 0.0),
    (13.2, 62, 0.28, -0.008),
    (14.6, 74, 0.12, 0.0),

    # 第一句：从 A 起，缓缓落回 D
    (16.0, 69, 0.44, 0.0),
    (17.6, 71, 0.33, 0.0),
    (18.6, 69, 0.29, 0.0),
    (20.2, 66, 0.40, -0.006),
    (22.1, 64, 0.31, 0.0),
    (23.2, 62, 0.42, 0.0),      # 落在宫音上，喘一口气
    (26.2, 64, 0.27, 0.007),
    (27.4, 66, 0.31, 0.0),
    (28.9, 69, 0.35, 0.0),
    (30.2, 71, 0.28, 0.0),
    (31.2, 69, 0.20, 0.0),      # 气口

    # 第二句：抬高一个八度把气推上去
    (32.2, 74, 0.42, 0.0),
    (34.1, 76, 0.34, 0.0),
    (35.1, 74, 0.30, 0.0),
    (36.2, 71, 0.34, 0.0),
    (37.7, 69, 0.36, -0.006),
    (39.1, 66, 0.29, 0.0),
    (40.2, 64, 0.31, 0.0),
    (41.6, 66, 0.33, 0.007),
    (43.1, 69, 0.35, 0.0),
    (44.6, 71, 0.31, 0.0),
    (45.6, 74, 0.34, 0.0),
    (47.0, 76, 0.22, 0.0),

    # 收束：一路下来，最后只剩一记低音
    (48.0, 45, 0.26, 0.0),      # A2 低音撑一下
    (49.4, 69, 0.30, 0.0),
    (50.9, 66, 0.24, -0.006),
    (52.3, 64, 0.26, 0.0),
    (53.8, 62, 0.32, 0.0),
    (56.2, 69, 0.15, 0.0),      # 泛音
    (57.8, 66, 0.19, 0.0),
    (59.4, 64, 0.17, 0.0),
    (61.2, 62, 0.20, 0.0),
    (63.0, 57, 0.14, 0.0),      # A3 泛音，接到下一圈的低音 D
]

# 箫的对答：(拍, 音高, 时长, 力度, 句尾滑音)
XIAO = [
    (24.6, 69, 3.2, 0.090, -0.008),
    (32.2, 76, 4.2, 0.080, 0.0),
    (44.8, 74, 3.6, 0.075, -0.010),
    (56.6, 69, 4.6, 0.085, 0.0),
]

# 低音持续：(拍, 音高, 振幅)。第二段从 31.5s 起，与第一段交叠 2.5s，不断层。
DRONES = [(0.0, 38, 0.052), (31.5, 38, 0.052)]


def make_bgm():
    """三遍逐样本一致地渲染整段，再取中间那遍 → 循环点天然连续。"""
    global rng
    total = LOOP * CYCLES + 6.0
    N = int(total * SR)
    dry = np.zeros(N)

    for cyc in range(CYCLES):
        rng = np.random.default_rng(20261126 + 7)      # 每遍同一套随机数
        base = cyc * LOOP

        for b0, m, amp in DRONES:
            add(dry, drone(m, 33.5, amp, 2.5, 2.5), base + b0)

        for beat, m, vel, slide in MELODY:
            dur = 4.6 if m < 56 else (3.4 if m < 68 else 2.8)
            add(dry, qin(m, vel=vel * 0.88, slide=slide, dur=dur),
                base + beat * BEAT + rng.uniform(-0.012, 0.012))

        # 泛音点缀：pos=0.5 只留偶次谐波，清亮如击玉
        for beat, m, vel in [(2.2, 74, 0.10), (56.2, 69, 0.08), (63.0, 57, 0.07)]:
            add(dry, qin(m, vel=vel * 0.85, pos=0.5, dur=4.2, bright=0.7),
                base + beat * BEAT)

        for beat, m, dur, vel, bend in XIAO:
            add(dry, xiao(m, dur=dur, vel=vel, bend=bend),
                base + beat * BEAT + rng.uniform(-0.02, 0.02))

    # ---- 混响：指数衰减噪声做脉冲响应，高频收得比低频快 ----
    ir_len = 3.6
    ni = int(ir_len * SR)
    ti = np.arange(ni) / SR
    ir = rng.standard_normal(ni) * np.exp(-ti / 0.85)
    ir = fft_filter(ir, SR, lo=130, hi=4200, order=2)
    pd = int(0.022 * SR)                              # pre-delay：让直达声先出来
    ir = np.concatenate([np.zeros(pd), ir])
    ir[:pd + int(0.014 * SR)] *= 1.0
    ir[pd:pd + int(0.014 * SR)] *= np.linspace(0, 1, int(0.014 * SR))
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9

    Nfft = 1 << (len(dry) + ni - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(dry, Nfft) * np.fft.rfft(ir, Nfft), Nfft)
    wet = wet[:len(dry) + len(ir) - 1]

    mix = np.zeros(len(wet))
    mix[:len(dry)] += dry
    mix += wet * 0.62

    # ---- 取中间那一遍循环 ----
    n_loop = int(LOOP * SR)
    loop = mix[n_loop:n_loop * 2].copy()

    # 收尾修形：去掉次声，柔化最刺的高频
    loop = fft_filter(loop, SR, lo=62, hi=11000, order=2)

    # 按整体能量定响度（古琴瞬态尖、平均值低，只按峰值归一会显得虚）
    loop *= 0.115 / max(1e-9, rms(loop))
    pk = float(np.max(np.abs(loop)))
    if pk > 0.82:
        loop *= 0.82 / pk
    return loop, SR


# --------------------------------------------------------------------------- #
def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, '_tmp')

    bgm, sr2 = make_bgm()
    write_wav(tmp + '_bgm.wav', bgm, sr2)
    s2 = encode(tmp + '_bgm.wav', os.path.join(OUT, 'bgm.mp3'),
                ['-c:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', '-ar', '32000'])
    s3 = encode(tmp + '_bgm.wav', os.path.join(OUT, 'bgm.ogg'),
                ['-c:a', 'libvorbis', '-q:a', '3', '-ac', '1', '-ar', '32000'])
    # 循环点是否连续：末 5ms 与首 5ms 的跳变
    jump = float(np.max(np.abs(bgm[:220] - bgm[-220:])))
    print('时长 %.2fs  峰值 %.2f  整体 %.1f dBFS  接缝跳变 %.3f'
          % (len(bgm) / sr2, np.max(np.abs(bgm)), db(rms(bgm)), jump))
    print('bgm.mp3 %.0f KB / bgm.ogg %.0f KB' % (s2 / 1024, s3 / 1024))

    for f in ('_bgm.wav',):
        p = tmp + f
        if os.path.exists(p):
            os.remove(p)


if __name__ == '__main__':
    main()
