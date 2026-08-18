# Firebase 初期設定の手順

ブラウザ上での操作が必要なため、**すべてご自身で行っていただく作業**です。
上から順に進めてください。所要時間は20〜30分ほどです。

> **最重要**: 手順4で `authDomain` を書き換えます。ここを飛ばすと
> パソコンでは動くのに iPhone・iPad でログインできない状態になります。

---

## 手順1. プロジェクトを作る

1. https://console.firebase.google.com/ を開く（ログインするGoogleアカウントは、
   あなたが管理者として使うもの）
2. 「**プロジェクトを作成**」を押す
3. プロジェクト名を入れる（例: `poster-kanri`）
   - 入力すると下に「プロジェクトID」が表示される。**これを控える**
     （例: `poster-kanri-4f2a1`）。以降この文書では `<ID>` と書く
   - IDは後から変えられない
4. Google アナリティクスは「**無効**」でよい（不要なため）
5. 「プロジェクトを作成」→ 完了を待つ

---

## 手順2. ウェブアプリを登録して設定値を得る

1. 左上の歯車 → 「**プロジェクトの設定**」
2. 「全般」タブを下へスクロールし「マイアプリ」の
   ウェブアイコン（**`</>`**）を押す
3. アプリのニックネーム: `poster-app`
4. 「**このアプリのFirebase Hostingも設定します**」に**チェックを入れる**
5. 「アプリを登録」
6. 次の画面に下のような設定が出る。**この6行を控える**

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "<ID>.firebaseapp.com",
  projectId: "<ID>",
  storageBucket: "<ID>.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef..."
};
```

7. 以降の「Firebase CLI をインストール」などの画面は
   「**コンソールに進む**」で飛ばしてよい（CIが行うため）

---

## 手順3. Google ログインを有効にする

1. 左メニュー「**構築**」→「**Authentication**」
2. 「**始める**」を押す
3. 「Sign-in method」タブ →「**Google**」を選ぶ
4. 右上の「**有効にする**」をオンにする
5. 「**プロジェクトの公開名**」… ログイン画面に出る名前（例: `ポスター管理`）
6. 「**プロジェクトのサポートメール**」… 自分のアドレスを選ぶ
7. 「**保存**」

---

## 手順4. ★ 最重要 ★ 使うURLを `.firebaseapp.com` に決める

**ここを取り違えると、パソコンでは動くのに iPhone・iPad でログインできません。**

### 前提: Hosting は2つのURLで配信される

Firebase Hosting は同じサイトを2つのURLで配信します。

- `https://<ID>.web.app` ← コンソールで大きく表示される方
- `https://<ID>.firebaseapp.com`

一方、iOS の WebKit はストレージをドメインごとに分けるため、
**配信元と `authDomain` が一致していないとログインが完了しません。**

### 結論: 両方を `.firebaseapp.com` に揃える

```
アプリのURL   https://<ID>.firebaseapp.com
authDomain    <ID>.firebaseapp.com          ← 手順2の値のまま。書き換えない
```

**手順2で控えた `authDomain` をそのまま使います。**

### なぜ `.web.app` ではないのか

`.web.app` 側でも `/__/auth/handler` は配信されています（200が返る）。
しかしログインには**2つの登録**が必要で、`.web.app` は片方が足りません。

| 必要な登録 | 場所 | `.web.app` は |
|---|---|---|
| ① 承認済みドメイン | Firebase → Authentication → Settings | ✅ 入っている |
| ② 承認済みリダイレクトURI | Google Cloud → OAuthクライアント | ❌ **入っていない** |

Firebase が自動作成する Google の OAuth クライアントには
`https://<ID>.firebaseapp.com/__/auth/handler` **だけ**が登録されています。
`.web.app` を使うと Google 側で弾かれ、次のエラーになります。

```
エラー 400: redirect_uri_mismatch
アクセスをブロック: このアプリのリクエストは無効です
```

> **教訓**: 「そのURLでページが配信されているか」と
> 「Googleが戻り先として許可しているか」は**別の話**です。
> 前者だけを確認して進めると、この落とし穴にはまります。

### どうしても `.web.app` を使いたい場合（任意・必須ではない）

1. https://console.cloud.google.com/apis/credentials を開く
2. 画面上部でプロジェクト `<ID>` を選ぶ
3. 「OAuth 2.0 クライアント ID」の一覧から
   **`Web client (auto created by Google Service)`** を押す
4. 「**承認済みのリダイレクト URI**」に次を追加する

```
https://<ID>.web.app/__/auth/handler
```

5. 「保存」（反映に数分かかることがあります）
6. そのうえで `firebase-config.js` の `authDomain` を `<ID>.web.app` に変える

### 承認済みドメインの確認

1. Authentication の「**Settings**」タブ →「**承認済みドメイン**」
2. 次の3つが入っていることを確認（初期状態で入っているはずです）

```
localhost
<ID>.firebaseapp.com
<ID>.web.app
```

---

## 手順5. Firestore を作る

1. 左メニュー「構築」→「**Firestore Database**」
2. 「**データベースを作成**」
3. **ロケーション**: `asia-northeast1 (Tokyo)` を選ぶ
   - **後から変更できません。** 必ず東京を選ぶこと
4. **モード**: 「**本番環境モードで開始**」を選ぶ
   - テストモードは30日後に全拒否になるうえ、その間は誰でも読める状態になる
   - 正しいルールはこのリポジトリの `poster-app/firestore.rules` にあり、
     デプロイ時に自動で反映される
5. 「作成」

---

## 手順6. Hosting を有効にする

手順2で「Firebase Hostingも設定します」にチェックを入れていれば済んでいる。
入れ忘れた場合のみ:

1. 左メニュー「構築」→「**Hosting**」→「**始める**」
2. 表示される手順は「次へ」で進み、最後は「コンソールに進む」でよい

---

## 手順7. 手元で動作を確認する

まだ公開せず、自分のパソコンで確かめます。

1. 次のファイルを開く（無ければ `firebase-config.example.js` を複製して作る）

```
poster-app/public/js/firebase-config.js
```

2. 手順2で控えた値を**そのまま**貼り付ける（`authDomain` は書き換えない）

```js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: '<ID>.firebaseapp.com',   // ← 手順2の値のまま
  projectId: '<ID>',
  storageBucket: '<ID>.firebasestorage.app',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef...',
};
```

3. 手元でサーバを立てる

```bash
cd poster-app
python3 -m http.server 8080 --directory public
```

4. ブラウザで `http://localhost:8080` を開き、ログインを試す
5. ログインできたら、画面の「**配信元**」と「**認証ドメイン**」を見る
   - 手元では `localhost` と `<ID>.firebaseapp.com` で**一致しない**が、
     パソコンは popup 方式なので問題ない
   - ここで確認したいのは「Googleログイン自体が通ること」

> このファイルは `.gitignore` 済みで、リポジトリには入りません。

---

## 手順8. GitHub にシークレットを登録する

自動デプロイのために3つ登録します。

### 8-1. サービスアカウントの鍵を作る

1. Firebase コンソール → 歯車 →「プロジェクトの設定」
2. 「**サービス アカウント**」タブ
3. 「**新しい秘密鍵の生成**」→「キーを生成」
4. JSONファイルがダウンロードされる

> **この鍵は本物の秘密情報です。** リポジトリに置かない、メールで送らない、
> チャットに貼らない。登録が済んだらパソコンから削除してください。

### 8-2. GitHub に登録する

GitHubのリポジトリ →「Settings」→「Secrets and variables」→「Actions」
→「New repository secret」で3つ作ります。

| 名前 | 中身 |
|---|---|
| `FIREBASE_PROJECT_ID` | `<ID>` |
| `FIREBASE_WEB_CONFIG` | 下記のJSON（**authDomain は `.firebaseapp.com`**） |
| `FIREBASE_SERVICE_ACCOUNT` | 8-1でダウンロードしたJSONファイルの**中身を全部** |

`FIREBASE_WEB_CONFIG` に入れるJSON（キーを二重引用符で囲む形式）:

```json
{"apiKey":"AIza...","authDomain":"<ID>.firebaseapp.com","projectId":"<ID>","storageBucket":"<ID>.firebasestorage.app","messagingSenderId":"123456789012","appId":"1:123456789012:web:abcdef..."}
```

---

## 手順9. 公開して iPhone で確認する

1. `main` ブランチに push する
2. GitHubの「Actions」タブでデプロイの進行を見る
3. 成功したら **iPhone で `https://<ID>.firebaseapp.com` を開く**
4. ログインする
5. ログイン後の画面で次を確認する

| 表示 | 期待される値 |
|---|---|
| 配信元 | `<ID>.firebaseapp.com` |
| 認証ドメイン | `<ID>.firebaseapp.com` ← 上と**一致**していること |
| ログイン方式 | `redirect` |

**この3つが揃っていれば成功です。** 配信元と認証ドメインが違っていれば手順4に戻ります。

---

## うまくいかないときの切り分け

| 症状 | 原因と対処 |
|---|---|
| iPhoneで「この端末ではログインできません」と出る | 配信元とauthDomainが不一致。手順4をやり直す |
| `missing initial state` が出る | 同上。ドメイン不一致のまま遷移方式を使っている |
| 「このドメインはFirebaseに登録されていません」 | 手順4の承認済みドメインに追加する |
| 自分は入れるが**他の人が入れない** | Google Cloud コンソール → APIとサービス → OAuth同意画面 → 公開ステータスが「テスト」なら、その人をテストユーザーに追加するか「本番環境」に公開する |
| デプロイしたのに画面が変わらない | ブラウザのキャッシュ。`firebase.json` で no-cache を指定済みだが、以前開いた分が残っている場合は再読み込みする |
| Actions が「シークレットが設定されていません」で失敗 | 手順8を確認。名前の綴りが一致しているか |

---

## この作業で私（Claude）ができないこと

- Firebase コンソールでの操作全般（あなたのGoogleアカウントでの操作のため）
- サービスアカウント鍵の取得・GitHubシークレットへの登録
- iPhone 実機での確認

設定値さえ手順7の形で入れていただければ、以降の実装は進められます。
