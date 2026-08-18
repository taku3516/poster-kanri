# ポスター管理アプリ

政治家のポスター掲示場所を、台帳・地図・ダッシュボードの3つの視点で管理する。

要件は [`../docs/requirements.md`](../docs/requirements.md) を参照。

## 構成

ビルド不要の静的サイト。依存パッケージは無く、`node_modules` も作らない。
Firebase SDK は CDN から ES モジュールとして読み込む。

```
poster-app/
  public/            Firebase Hosting が配信する一式
    index.html
    css/style.css
    js/
      sign-in-method.js    ログイン方式の判定（純粋関数・テスト対象）
      auth.js              Firebase 認証
      main.js              画面の制御
      firebase-config.js   接続設定（.gitignore 済み。各自で作る）
  test/              node:test によるテスト
  firebase.json      Hosting の設定
  firestore.rules    セキュリティルール
```

## なぜ GitHub Pages ではないのか

iOS（iPhone / iPad）で Firebase の Google ログインを通すには、
**配信元と authDomain のドメインが一致**している必要がある。
GitHub Pages（`*.github.io`）から `*.firebaseapp.com` の認証を使うと、
WebKit のストレージ分割によりログインが完了しない。iOS 版 Chrome でも同じ。

詳細は `docs/requirements.md` 3.2。

## 手元で動かす

```bash
cd poster-app
cp public/js/firebase-config.example.js public/js/firebase-config.js
# firebase-config.js に Firebase コンソールの値を貼り付ける
python3 -m http.server 8080 --directory public
```

`http://localhost:8080` を開く。
`localhost` は Firebase の承認済みドメインに最初から入っている。

## テスト

```bash
cd poster-app
npm test
```

## 初期設定（Firebase コンソールでの操作）

**手順は [`../docs/firebase-setup.md`](../docs/firebase-setup.md) に詳細を書いた。**
必ずそちらを見ながら進めること。

特に注意する点:

- Firebase Hosting は `<ID>.web.app` と `<ID>.firebaseapp.com` の
  **2つのURLで同じサイトを配信する**
- iOS では**配信元と `authDomain` が一致**していないとログインできない
- **`.firebaseapp.com` に揃える。** Firebaseが自動作成するGoogleのOAuthクライアントには
  `.firebaseapp.com` の戻り先URLしか登録されておらず、`.web.app` を使うと
  `redirect_uri_mismatch` で弾かれる
- パソコンでは不一致でも動いてしまうため、**確認は必ず iPhone 実機で行う**

## 自動デプロイの設定

`main` へ push すると `.github/workflows/deploy.yml` が動く。
GitHub のリポジトリ設定 → Secrets and variables → Actions に以下を登録する。

| シークレット名 | 中身 |
|---|---|
| `FIREBASE_WEB_CONFIG` | 手順2で控えた設定を **JSON形式** で（例: `{"apiKey":"...","authDomain":"..."}`） |
| `FIREBASE_PROJECT_ID` | Firebase のプロジェクトID |
| `FIREBASE_SERVICE_ACCOUNT` | サービスアカウントの鍵（JSON全文） |

サービスアカウントの鍵は
Firebase コンソール → プロジェクトの設定 → サービスアカウント →
「新しい秘密鍵の生成」で取得する。

> **この鍵はリポジトリに絶対に置かないこと。** GitHub のシークレットにのみ登録する。

## 配信物のキャッシュについて

ファイル名にハッシュを付けていないため、URLが変わらない。
`firebase.json` で `/` と `html/css/js/json` に `no-cache` を指定している。
これを外すとデプロイしても最大1時間ブラウザに届かなくなる。
