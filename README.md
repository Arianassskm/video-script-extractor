<div align="center">

# Video Script Extractor

### Extract spoken transcripts from YouTube & Bilibili videos with one click.

<p>
  <a href="#features"><img src="https://img.shields.io/badge/Platform-Chrome_Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension"></a>
  <a href="#features"><img src="https://img.shields.io/badge/YouTube-Supported-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="#features"><img src="https://img.shields.io/badge/Bilibili-Supported-00A1D6?style=flat-square&logo=bilibili&logoColor=white" alt="Bilibili"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License"></a>
  <a href="#"><img src="https://img.shields.io/badge/Price-Free_Forever-brightgreen?style=flat-square" alt="Free Forever"></a>
</p>

<p>
  <b><a href="#english">English</a></b> | <b><a href="#chinese">中文</a></b>
</p>

---

</div>

<a id="english"></a>

## Why This Exists

In the age of AI, we watch countless brilliant YouTube videos — tutorials, essays, analyses — and often wish we could grab the spoken script directly. Maybe to feed it into an AI for summarization, maybe to study the phrasing, maybe just to read instead of watch.

**Video Script Extractor** does exactly that. One click, and you get the full transcript with timestamps. Copy it, export it, do whatever you want with it.

> This started as a personal tool. Now it's open source. Free forever. No ads. No tracking. No nonsense.

## Features

| Feature | Status |
|---------|--------|
| YouTube transcript extraction | Working |
| Bilibili subtitle extraction | Working |
| Copy to clipboard | Working |
| Export as `.txt` | Working |
| Export as `.md` (Markdown) | Working |
| Search within transcript | Working |
| Click timestamp to seek video | Working |
| Multi-language subtitle selection | Working |
| Local yt-dlp helper fallback | Working |
| Audio link extraction | Working |

## Install

### Method 1: Download from Release (Recommended)

1. Go to the [Releases](https://github.com/Arianassskm/video-script-extractor/releases) page
2. Download `video-script-extractor-v1.1.0.zip` from the latest release
3. Unzip the downloaded file to a folder on your computer
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable **Developer mode** (toggle in the top right corner)
6. Click **Load unpacked**
7. Select the unzipped folder
8. Done! Navigate to any YouTube or Bilibili video and click the extension icon in your toolbar

### Method 2: From Source

1. Clone this repo:
   ```bash
   git clone https://github.com/Arianassskm/video-script-extractor.git
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the cloned folder
5. Navigate to any YouTube or Bilibili video → click the extension icon

## How to Use

1. **Open a video** — Go to any YouTube or Bilibili video page
2. **Click the extension icon** — The extension popup will appear, automatically detecting the platform
3. **Select subtitle language** — Choose from the available subtitle tracks in the dropdown
4. **Click "Extract"** — The extension will fetch the full transcript
5. **Use the transcript:**
   - **Copy** — Click "Copy" to copy the full transcript to your clipboard
   - **Export TXT** — Click "TXT" to download as a plain text file
   - **Export MD** — Click "MD" to download as a Markdown file
   - **Search** — Type keywords in the search box to filter transcript lines
   - **Jump to timestamp** — Click any timestamp to seek the video to that point

### Fallback: Local yt-dlp Helper

If the built-in extraction doesn't find subtitles for a video, you can use the local helper:

1. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your computer
2. Run the local helper server (see `helper/` directory)
3. In the extension popup, use the "Fallback" section to extract subtitles or get audio links via your local yt-dlp

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

The YouTube extractor tries multiple approaches in sequence for maximum compatibility:

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

## Contributing

This project needs your help! Whether it's:

- **Bug reports** — Found a video that should work but doesn't? [Open an issue](../../issues)
- **Feature ideas** — Want something added? Let us know
- **Code contributions** — PRs are welcome
- **Platform support** — Help add more video platforms

## Tech Stack

- **Chrome Extension Manifest V3** — Modern extension architecture
- **Vanilla JavaScript** — No frameworks, no build step, no dependencies
- **YouTube InnerTube API** — Reverse-engineered internal API
- **Bilibili API** — Subtitle extraction via Bilibili's endpoint

## License

MIT License — do whatever you want with it.

**Free forever. No ads. No tracking. No premium tier.**

---

<a id="chinese"></a>

<div align="center">

## 视频文案提取器

### 一键提取 YouTube 和 Bilibili 视频的口播文案/字幕

<p>
  <b><a href="#english">English</a></b> | <b><a href="#chinese">中文</a></b>
</p>

---

</div>

## 为什么做这个

AI 时代，我们看了太多优秀的 YouTube 视频——教程、评论、分析——经常想直接拿到视频里的口播文案。也许是想丢给 AI 做总结，也许是想学习表达方式，也许只是想看文字版而不是看视频。

**视频文案提取器**就做这一件事。点一下，完整的带时间戳的文案就出来了。复制、导出、随你处理。

> 这原本是个人工具，现在开源了。永远免费。没有广告。没有追踪。没有套路。

## 功能

| 功能 | 状态 |
|------|------|
| YouTube 字幕提取 | 可用 |
| Bilibili 字幕提取 | 可用 |
| 复制到剪贴板 | 可用 |
| 导出为 `.txt` 文件 | 可用 |
| 导出为 `.md` 文件 | 可用 |
| 关键词搜索 | 可用 |
| 点击时间戳跳转 | 可用 |
| 多语言字幕选择 | 可用 |
| 本地 yt-dlp 助手兜底 | 可用 |
| 音频链接提取 | 可用 |

## 安装方法

### 方法一：从 Release 下载（推荐）

1. 前往 [Releases 页面](https://github.com/Arianassskm/video-script-extractor/releases)
2. 下载最新版本的 `video-script-extractor-v1.1.0.zip`
3. 将下载的 zip 文件解压到电脑上的任意文件夹
4. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
5. 开启右上角的 **开发者模式**
6. 点击 **加载已解压的扩展程序**
7. 选择刚才解压的文件夹
8. 完成！打开任意 YouTube 或 Bilibili 视频页面，点击浏览器工具栏中的插件图标即可使用

### 方法二：从源码安装

1. 克隆本仓库：
   ```bash
   git clone https://github.com/Arianassskm/video-script-extractor.git
   ```
2. 打开 Chrome → 地址栏输入 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序** → 选择克隆的文件夹
5. 打开任意 YouTube 或 Bilibili 视频 → 点击插件图标

## 使用方法

1. **打开视频** — 在浏览器中打开任意 YouTube 或 Bilibili 视频
2. **点击插件图标** — 插件弹窗会自动出现并检测当前平台
3. **选择字幕语言** — 从下拉菜单中选择可用的字幕语言
4. **点击「Extract」** — 插件会提取完整的字幕文本
5. **使用提取的文案：**
   - **复制** — 点击「Copy」将全部内容复制到剪贴板
   - **导出 TXT** — 点击「TXT」下载为纯文本文件
   - **导出 MD** — 点击「MD」下载为 Markdown 文件
   - **搜索** — 在搜索框输入关键词筛选字幕内容
   - **跳转** — 点击任意时间戳可让视频跳转到对应位置

### 兜底方案：本地 yt-dlp 助手

如果内置提取无法获取某个视频的字幕，可以使用本地助手：

1. 在电脑上安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp)
2. 运行本地助手服务器（参见 `helper/` 目录）
3. 在插件弹窗的「Fallback」区域使用本地 yt-dlp 提取字幕或获取音频链接

## 参与贡献

- **Bug 反馈** — 发现某个视频应该能提取但失败了？[提个 Issue](../../issues)
- **功能建议** — 想要什么新功能？告诉我们
- **代码贡献** — 欢迎 PR
- **平台支持** — 帮助添加更多视频平台

## 许可证

MIT 协议 — 随便用。

**永远免费。没有广告。没有追踪。没有付费版。**

---

<div align="center">
  <sub>Built with care for the open-source community</sub>
</div>
