// Firebase の接続設定のひな形。
//
// 使い方: このファイルを firebase-config.js という名前で複製し、
// Firebase コンソール（プロジェクトの設定 > マイアプリ）の値を貼り付ける。
// firebase-config.js は .gitignore 済みでリポジトリには入らない。
//
// 補足: これらの値は「秘密」ではなくプロジェクトの識別子であり、
// 配信されたページを見れば誰でも読める。データを守っているのは
// Firestore のセキュリティルールと承認済みドメインの設定である。
// それでもリポジトリに置かないのは、プロジェクトの存在自体を伏せるため。
//
// authDomain は「Firebase コンソールに出る既定の値」とは限らない。
// このアプリは Hosting に別名のサイト（poster-kanri）を作って配信しており、
// iOS では「配信元 = authDomain」である必要があるため、
// authDomain も配信しているサイトの名前に合わせる。
//   アプリのURL : https://poster-kanri.firebaseapp.com
//   authDomain  : poster-kanri.firebaseapp.com
//   projectId   : poster-kanri-94627 ← ここは変えない。プロジェクトIDは別物
//
// 既定以外のドメインを authDomain にする場合、Google Cloud の
// OAuth クライアントに戻り先URL（.../__/auth/handler）を手で足す必要がある。
// Firebase が自動作成する登録には既定サイトの分しか入っていない。
// 詳細は ../docs/firebase-setup.md

/** @type {{apiKey:string, authDomain:string, projectId:string, storageBucket:string, messagingSenderId:string, appId:string}} */
export const firebaseConfig = {
  apiKey: 'ここに貼り付ける',
  authDomain: 'ここに貼り付ける',
  projectId: 'ここに貼り付ける',
  storageBucket: 'ここに貼り付ける',
  messagingSenderId: 'ここに貼り付ける',
  appId: 'ここに貼り付ける',
};
