# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定

**常に日本語でレスポンスすること。**

## Primary Project: street-speech-recorder

A React Native (TypeScript) mobile app for recording and managing street speeches. Located in `street-speech-recorder/`.

### Commands

```bash
cd street-speech-recorder

# Install dependencies
npm install

# Start Metro bundler
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android

# Run tests
npm test

# Run a single test file
npx jest src/path/to/test.test.ts

# Lint
npm run lint
```

### Architecture

State is managed with Redux (`store/index.ts`, `store/speechSlice.ts`). Navigation is handled via `react-navigation` configured in `navigation/index.ts`.

**Data flow:** UI components call hooks (`hooks/useRecorder.ts`) → hooks dispatch Redux actions or call services → `services/storage.ts` handles persistence of recording data.

**Key layers:**
- `screens/` — full-screen views (`HomeScreen`, `RecordScreen`, `DetailScreen`)
- `components/` — reusable UI pieces (`Recorder`, `SpeechList`, `SpeechItem`)
- `hooks/useRecorder.ts` — recording logic abstracted from UI
- `services/storage.ts` — read/write recorded speech data
- `store/speechSlice.ts` — Redux slice for speech list state
- `types/index.ts` — shared TypeScript type definitions

## コーディング規約
- コメントは日本語で書く
- 関数には必ず型アノテーションを付ける
- エラーハンドリングを省略しない

## 作業ルール
- ファイルを編集する前に必ず読む
- 大きな変更前にユーザーに確認する
- テストを書いてから実装する（TDD）

## Git
- コミットメッセージは日本語で書く
- コミット前に変更内容を要約して確認を取る
- 自動でpushしない

## セキュリティ
- シークレットやAPIキーをコードに直接書かない
- 破壊的な操作（rm -rf等）は必ず確認を取る

## セッションログ管理（必須）

セッションログは `/Users/apple/my-claude-project/session-logs/YYYY-MM-DD.md` に保存する。

### セッション開始時に必ずやること
1. `/Users/apple/.claude/projects/-Users-apple-my-claude-project/memory/MEMORY.md` を読む
2. 本日のログファイルが存在すれば読む（前のセッションの続きか確認）
3. 最新のログファイルを読んで前回の未完了タスクを把握する

### セッション終了時（ユーザーが会話を締めくくる or `--continue` で再開される前）
本日のログファイルを作成・更新する。記載内容：
- `## セッション HH:MM` の見出し（同日複数回は追記）
- 作業内容の要約（箇条書き）
- 変更・作成したファイル
- 未完了タスク / 次回やること
- 重要な決定事項

### ログの原則
- 簡潔に。1セッション30行以内を目安
- 技術的な決定事項は必ず残す
- ファイルパスは絶対パスで記載
