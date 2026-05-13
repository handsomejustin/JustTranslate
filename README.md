# 轻译 JustTranslate

极简 Chrome 网页翻译扩展。自动将外文翻译为中文，不收集数据、不弹窗、不臃肿。

无构建工具、无包管理器、纯 Vanilla JS。

## 功能

- **自动翻译** — 开启后翻译页面所有外文内容，保留原文内联格式（粗体、链接、斜体）
- **纯中文 / 双语对照** — 默认替换为纯中文，可切换原文+译文双语模式
- **双引擎降级** — Google Translate 为主，失败自动切换 Bing Translator
- **懒加载** — IntersectionObserver 只翻译视口内元素，长页面滚动到底也能翻
- **SPA 支持** — MutationObserver 检测动态内容，1 秒防抖后增量翻译
- **代码识别** — 自动跳过 JavaScript 代码块，不误翻

## 安装

1. `git clone` 本仓库
2. Chrome 地址栏输入 `chrome://extensions/`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目目录

## 使用

打开任意外文网页 → 点击工具栏「轻译」图标 → 开启翻译开关。

快捷键：`Alt+J` 切换翻译。

## 工作原理

```
页面 DOM
  └─ content.js 遍历 DOM，找到含外文的叶子容器
      └─ IntersectionObserver 懒加载，视口 ±300px 触发
          └─ chrome.runtime.sendMessage → background.js
              ├─ Google Translate（主，并发 5）
              └─ Bing Translator（备用，并发 3，token 5 分钟刷新）
```

### 翻译流程

1. 深度遍历 DOM，找无块级子元素的"叶子容器"（段落、标题、列表项等）
2. 提取容器内可翻译文本，跳过 `<svg>`、`<code>`、`<pre>` 等
3. 检测是否为外文（日文/韩文/非 CJK 文字），跳过中文和代码
4. 批量发送翻译请求（每批 10 个）
5. 深克隆原始元素，替换克隆体文本后插入 DOM
6. 多文本节点的容器在标点边界切分译文，保留粗体/链接等内联格式

### 翻译模式

| 模式 | 行为 |
|------|------|
| 纯中文 | 隐藏原文元素，显示翻译后的克隆体 |
| 双语对照 | 原文和译文同时显示 |

## 文件结构

```
manifest.json    # Manifest V3 扩展配置
background.js    # 翻译 API 调用 + Google/Bing 双引擎
content.js       # DOM 遍历、懒加载、翻译注入、SPA 检测
popup.html       # 弹窗界面
popup.js         # 开关控制逻辑
styles.css       # 双语对照样式
```

## 许可证

MIT
