# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

轻译 (JustTranslate) — 极简 Chrome 翻译扩展，Manifest V3，纯 Vanilla JS，无构建工具/打包器/包管理器。

## Architecture

- `content.js` — DOM 遍历、翻译注入、SPA 动态内容检测。通过 `chrome.runtime.sendMessage` 发送翻译请求。
- `background.js` — 翻译 API 调用（Google 主 / Bing 备），双引擎自动降级。通过 `chrome.runtime.onMessage` 接收请求。
- `popup.js` / `popup.html` — 开关 UI，通过 `chrome.tabs.sendMessage` 控制 content script。
- `styles.css` — 双语对照样式（`.fanyi-trans`）。

## State Machine

DOM 元素通过 `data-fanyi` 属性跟踪翻译状态：`pending` → `done`。原始 HTML 保存在 `data-fanyi-original` 中用于还原。

## DOM Traversal

`collectTranslatableBlocks()` 使用 `isLeafBlock()` 识别叶子块——子元素全部为 inline 或 skip-tag（code/svg）的元素。`getTranslatableText()` 提取可翻译文本（排除 code/svg）。含块级子元素（div/ul/button）的容器会跳过并递归进入子元素。

## Translation Engine

- Google Translate (`client=gtx` free API) — 并发限制 5，返回 null 表示检测为中文
- Bing Translator — 并发限制 3，token 每 5 分钟刷新
- `ZH_LANGS` 集合用于跳过已识别为中文的内容

## Testing

无自动化测试。手动测试：Chrome `chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序。

## Commit Style

Conventional commits：`feat:`, `fix:`, `refactor:`, `chore:` 等，描述用英文。
