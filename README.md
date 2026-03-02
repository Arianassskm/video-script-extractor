<div align="center">

# 📝 Video Script Extractor

### Extract spoken transcripts from YouTube & Bilibili videos with one click.

<p>
  <a href="#features"><img src="https://img.shields.io/badge/Platform-Chrome_Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension"></a>
  <a href="#features"><img src="https://img.shields.io/badge/YouTube-Supported-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="#features"><img src="https://img.shields.io/badge/Bilibili-Supported-00A1D6?style=flat-square&logo=bilibili&logoColor=white" alt="Bilibili"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License"></a>
  <a href="#"><img src="https://img.shields.io/badge/Price-Free_Forever-brightgreen?style=flat-square" alt="Free Forever"></a>
</p>

<p>
  <b><a href="#english">English</a></b> | <b><a href="#中文">中文</a></b>
</p>

---

</div>

<a id="english"></a>

## Why This Exists

In the age of AI, we watch countless brilliant YouTube videos — tutorials, essays, analyses — and often wish we could grab the spoken script directly. Maybe to feed it into an AI for summarization, maybe to study the phrasing, maybe just to read instead of watch.

**Video Script Extractor** does exactly that. One click, and you get the full transcript with timestamps. Copy it, export it, do whatever you want with it.

> 💡 This started as a personal tool. Now it's open source. Free forever. No ads. No tracking. No nonsense.

## Features

| Feature | Status |
|---------|--------|
| 🎬 YouTube transcript extraction | ✅ Working |
| 📺 Bilibili subtitle extraction | ✅ Working |
| 📋 Copy to clipboard | ✅ Working |
| 📄 Export as `.txt` | ✅ Working |
| 📝 Export as `.md` (Markdown) | ✅ Working |
| 🔍 Search within transcript | ✅ Working |
| ⏱️ Click timestamp to seek video | ✅ Working |
| 🌐 Multi-language subtitle selection | ✅ Working |
| 🔧 Local yt-dlp helper fallback | ✅ Working |
| 🎵 Audio link extraction | ✅ Working |

## How It Works

```
You open a YouTube/Bilibili video
  → Click the extension icon
  → Select subtitle language
  → Click "Extract"
  → Get full transcript with timestamps
  → Copy / Export / Search
```

The extension uses YouTube's internal InnerTube API (the same API YouTube's own transcript panel uses) with multiple fallback strategies to maximize success rate. Everything runs locally in your browser — no data is sent anywhere.

## Install

### From Source (Developer Mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/Arianassskm/video-script-extractor.git
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the cloned folder
5. Navigate to any YouTube or Bilibili video → click the extension icon

## Architecture

```
video-script-extractor/
├── manifest.json          # Chrome Extension Manifest V3
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Styles
│   └── popup.js           # Main logic & UI controller
├── extractors/
│   ├── youtube.js         # YouTube extractor (multi-strategy)
│   └── bilibili.js        # Bilibili extractor
└── icons/                 # Extension icons
```

### YouTube Extraction Strategies

The YouTube extractor tries multiple approaches in sequence:

| Order | Strategy | Method |
|-------|----------|--------|
| -1 | In-page graph scan | Parse transcript data from YouTube's in-memory DOM |
| 0 | Browser textTracks | Read subtitle tracks from the `<video>` element |
| 1 | InnerTube `get_transcript` | YouTube's internal transcript API |
| 1.5 | Player API (WEB) | Refresh caption URLs via `/youtubei/v1/player` |
| 1.7 | Player API (ANDROID) | ANDROID client fallback for videos WEB client misses |
| 2 | Direct timedtext fetch | Fetch caption URL from page context |
| 3 | Extension-context fetch | Bypass page restrictions using extension permissions |
| 4 | Canonical URL rebuild | Reconstruct timedtext URLs without volatile tokens |

## Current Status

> ⚠️ **Early Stage** — Core functionality works, but there are known issues.

- ✅ Core extraction, copy, and export features are functional
- ⚠️ Some videos may show warning logs in the console (this is expected — the multi-strategy fallback chain produces logs when earlier strategies fail before a later one succeeds)
- ⚠️ Some videos genuinely have no subtitles available (no tool can extract what doesn't exist)
- 🔧 Contributions welcome — see below

## Contributing

This project needs your help! Whether it's:

- 🐛 **Bug reports** — Found a video that should work but doesn't? [Open an issue](../../issues)
- 💡 **Feature ideas** — Want something added? Let us know
- 🔧 **Code contributions** — PRs are welcome
- 🌍 **Platform support** — Help add more video platforms
- 📖 **Documentation** — Improve guides and docs

## Tech Stack

- **Chrome Extension Manifest V3** — Modern extension architecture
- **Vanilla JavaScript** — No frameworks, no build step, no dependencies
- **YouTube InnerTube API** — Reverse-engineered internal API
- **Bilibili API** — Subtitle extraction via Bilibili's endpoint

## License

MIT License — do whatever you want with it.

**Free forever. No ads. No tracking. No premium tier.**

---

<a id="中文"></a>

<div align="center">

## 📝 视频文案提取器

### 一键提取 YouTube 和 Bilibili 视频的口播文案

<p>
  <b><a href="#english">English</a></b> | <b><a href="#中文">中文</a></b>
</p>

---

</div>

## 为什么做这个

AI 时代，我们看了太多优秀的 YouTube 视频——教程、评论、分析——经常想直接拿到视频里的口播文案。也许是想丢给 AI 做总结，也许是想学习表达方式，也许只是想看文字版而不是看视频。

**视频文案提取器**就做这一件事。点一下，完整的带时间戳的文案就出来了。复制、导出、随你处理。

> 💡 这原本是个人工具，现在开源了。永远免费。没有广告。没有追踪。没有套路。

## 功能

| 功能 | 状态 |
|------|------|
| 🎬 YouTube 字幕提取 | ✅ 可用 |
| 📺 Bilibili 字幕提取 | ✅ 可用 |
| 📋 复制到剪贴板 | ✅ 可用 |
| 📄 导出为 `.txt` 文件 | ✅ 可用 |
| 📝 导出为 `.md` 文件 | ✅ 可用 |
| 🔍 关键词搜索 | ✅ 可用 |
| ⏱️ 点击时间戳跳转 | ✅ 可用 |
| 🌐 多语言字幕选择 | ✅ 可用 |
| 🔧 本地 yt-dlp 助手兜底 | ✅ 可用 |
| 🎵 音频链接提取 | ✅ 可用 |

## 使用方法

1. 克隆本仓库：
   ```bash
   git clone https://github.com/Arianassskm/video-script-extractor.git
   ```
2. 打开 Chrome → `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序** → 选择克隆的文件夹
5. 打开任意 YouTube 或 Bilibili 视频 → 点击插件图标

## 当前状态

> ⚠️ **早期阶段** — 核心功能已实现，但仍有已知问题。

- ✅ 提取、复制、导出等核心功能正常工作
- ⚠️ 部分视频会在控制台显示警告日志（这是正常的——多策略 fallback 链在前置策略失败时会产生日志，最终会由后续策略成功提取）
- ⚠️ 少数视频本身没有任何字幕（这种情况任何工具都无法提取）
- 🔧 欢迎贡献代码——见下方

## 参与贡献

这个项目需要你的帮助！无论是：

- 🐛 **Bug 反馈** — 发现某个视频应该能提取但失败了？[提个 Issue](../../issues)
- 💡 **功能建议** — 想要什么新功能？告诉我们
- 🔧 **代码贡献** — 欢迎 PR
- 🌍 **平台支持** — 帮助添加更多视频平台
- 📖 **文档改进** — 完善使用文档

## 许可证

MIT 协议 — 随便用。

**永远免费。没有广告。没有追踪。没有付费版。**

---

<div align="center">
  <sub>Built with ❤️ for the open-source community</sub>
</div>
