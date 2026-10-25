# 交付与验收操作

当前交付按候选版本管理，不将自动测试、合成视频或页面录制功能作为已完成真人/macOS 验收的证明。实际下载入口、发布版本和检查结果见[交付清单](release-checklist.md)。

## 运行包

`voice-snake-offline.zip` 包含源码、运行依赖、中文模型、文档和许可声明。需要已安装 Node.js 18 或更新版本；解压至普通本地目录后执行：

```sh
node tools/serve.cjs
```

打开终端打印的 localhost 地址。不需要先安装 npm 依赖或重新下载模型；不要直接双击 HTML，因为模块、Worker 和麦克风需要通过 HTTP/HTTPS 访问。Windows 已做自动检查；macOS 仍需实机验收，不能只凭跨平台源码认定通过。

`voice-snake-site.zip` 为静态部署目录，不包含凭证或服务端程序。解压后可部署到 HTTPS 静态站点根目录或项目子目录；模型路径与脚本路径相对部署目录解析。`build.json` 标明对应源码提交和已知验证边界。

## 录制真人 Demo

1. 打开游戏地址并加 `?review=1`，使用默认本地识别模式；点击“开始游戏”，授权并确认正在监听。
2. 在“验收录制”中点击圆形录制图标。只有主动点击才记录，内容包括棋盘、状态、识别反馈和当前麦克风音轨，不录制其他窗口或桌面。
3. 按[Demo 脚本](demo-script.md)说口令完成操作。录制期间仍仅用语音操控游戏；录制按钮不改变游戏状态。单段最多五分钟。
4. 点击方形停止图标，或说“结束游戏”自动结束录制。停止录制不会停止游戏麦克风；结束游戏则停止识别与录制。
5. 点击视频图标下载 WebM，点击文件图标下载事件 JSON。下载后核对有画面、有口令声音，并记录源码提交；刷新页面会丢失未下载的内存录像。录像可能包含录制期间说出的其他话，上传前需检查。

JSON 是识别回调及命令接收事件记录，不包含人工标注的口令说完时间，不能自动算作端到端延迟或口令正确率。按[实机模板](acceptance-record.md)和[口令表](acceptance-samples.csv)填写实际结果。

## 合成音频预演

`voice-snake-synthetic.webm` 为补充演示，画面固定标注“合成音频预演 · 非真人验收”。它通过真实本地模型识别已生成的音频，不请求物理麦克风；不能替代正式真人视频。配套事件 JSON 和 `preview-verification.json` 记录命令、画面尺寸与音轨检查。

复现需先按 README 生成 13 条 WAV、设置 Playwright 及浏览器路径，然后运行 `npm run demo:synthetic`。输出位于忽略目录 `test-results/demo/`，不自动上传真实录音。

## 重新打包和校验

源码提交干净后执行：

```sh
npm run setup:voice
npm run package:delivery
npm run verify:delivery
npm run test:hosting
```

后三步中的浏览器检查需 README 中的 Playwright 环境。打包输出在 `test-results/delivery-*`，入口索引为 `test-results/delivery-latest.json`。两个 ZIP 配套 SHA-256；离线包校验会实际解压并运行测试，不重新安装依赖。`--allow-dirty` 只用于开发预检，不能将此类包称为已提交版本的精确产物。

## 仍需实际执行

- 朱晶：Windows 真实口令、连续游戏和性能记录；录制并核对真人 Demo；按实际比赛入口提交并保留回执。
- 王任：macOS Chrome/Edge 实机记录和相关环境证据。
- 根据实际测试填写支持范围；暂未验证的环境明确注明，不填造结果。
