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
      db.js                Firestore への読み書き（ログイン時の保存先）
      local-db.js          端末内への読み書き（未ログイン時の保存先）
      idb.js               IndexedDB の薄い包み
      migrate.js           端末内 → アカウントへの取り込み
      main.js              画面の制御
      firebase-config.js   接続設定（.gitignore 済み。各自で作る）
  test/              node:test によるテスト
  firebase.json      Hosting の設定
  firestore.rules    セキュリティルール
```

## ログインしなくても使える

**ログインは「複数の端末で同じ台帳を見る」ためのもので、使用の条件ではない。**

| 状態 | 保存先 | 見え方 |
|---|---|---|
| ログインしていない | この端末の中（IndexedDB） | 全機能が使える。他の端末には表示されない |
| ログインしている | Firestore | 同じアカウントの端末すべてで自動的に同期される |

一度もログインしたことがない端末では、**Firebase SDK を読み込まない**。
`localStorage` の印を見て、必要なときだけ `auth.js` / `db.js` を動的に読み込む。
圏外でもアカウントが無くても起動できる。

`db.js`（Firestore）と `local-db.js`（端末内）は**同じ関数の並び**を持つ。
`main.js` は変数1つを差し替えるだけで保存先を切り替えており、
28箇所ある呼び出しはどちらでも同じ書き方で動く。

ログインすると、端末内にデータがある場合だけ取り込みを尋ねる。
取り込みは常に**新しい台帳を足す形**で行い、アカウント側の既存の台帳は変更しない。
取り込んだ後も端末内のデータは残る（設定画面から消せる）。

`local-db.js` は「保存の入れ物」を外から受け取る作りにしてあるため、
Node に IndexedDB が無くてもメモリ上の入れ物を差し込んでテストできる
（`test/memory-storage.js`）。

## 貼替の履歴

貼替日は `replacements[]` に全て残す。`lastReplacedOn`（最新貼替日）は
**履歴の最後として保存し続ける**（CSVの24列・絞り込み・色分け・並べ替えが
この項目を読んでいるため、残すことで読む側を変えずに済む）。
`貼替回数` は保存せず、読むたびに数える。

**操作の意味を分けている。**

| 操作 | 意味 | 履歴 |
|---|---|---|
| 「今日 貼り替えた」 | 貼り替えた | 1件増える |
| 「最新貼替日」の欄を直す | 入力の訂正 | 増えない |

CSVでは履歴を `貼替1` `貼替2` … の列に開いて往復させる。
Excel で右に1列足して日付を書けば1回分増え、打ち直せば訂正になる。
**意図が列の位置で表現される**ので、機械が推測しなくてよい。

既存データの書き換えは行わない。`replacements` を持たない行は
「`lastReplacedOn` が1件だけの履歴」として読むときに落とす。

## なぜ GitHub Pages ではないのか

iOS（iPhone / iPad）で Firebase の Google ログインを通すには、
**配信元と authDomain のドメインが一致**している必要がある。
GitHub Pages（`*.github.io`）から `*.firebaseapp.com` の認証を使うと、
WebKit のストレージ分割によりログインが完了しない。iOS 版 Chrome でも同じ。

詳細は `docs/requirements.md` 3.2。

## 手元で動かす

```bash
cd poster-app
npm start
```

`http://localhost:8080` を開く。`npm start` はキャッシュを持たせない簡易サーバ
（`tools/serve.py`）を使う。本番も no-cache なので、手元だけキャッシュが効いて
「直したのに反映されない」という現象が起きないようにしてある。

**Firebase の設定が無くても、端末内保存で全機能を試せる。**
同期まで確認したい場合だけ、接続設定を置く。

```bash
cp public/js/firebase-config.example.js public/js/firebase-config.js
# firebase-config.js に Firebase コンソールの値を貼り付ける
```

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
