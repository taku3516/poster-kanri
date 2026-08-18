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

/** @type {{apiKey:string, authDomain:string, projectId:string, storageBucket:string, messagingSenderId:string, appId:string}} */
export const firebaseConfig = {
  apiKey: 'ここに貼り付ける',
  authDomain: 'ここに貼り付ける',
  projectId: 'ここに貼り付ける',
  storageBucket: 'ここに貼り付ける',
  messagingSenderId: 'ここに貼り付ける',
  appId: 'ここに貼り付ける',
};
