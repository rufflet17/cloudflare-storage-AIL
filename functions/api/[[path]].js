// functions/api/[[path]].js

import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ▼▼▼【ここから追加】▼▼▼
// Cloudflare Workers環境でAWS SDKを動作させるために必要なライブラリ
import { XMLParser } from "fast-xml-parser";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { parseUrl } from "@aws-sdk/url-parser-native";
// ▲▲▲【ここまで追加】▲▲▲


/**
 * 全てのAPIリクエストを処理するエントリーポイント
 */
export async function onRequest(context) {
  try {
    // リクエストされたパスの最後の部分（例: 'list-files'）を取得
    const action = context.params.path[context.params.path.length - 1];
    
    // リクエストボディをJSONとしてパース
    const body = await context.request.json();
    const { password } = body;

    // --- 認証 ---
    // 環境変数に設定されたパスワードと照合
    if (!password || password !== context.env.AUTH_PASSWORD) {
      return new Response('Unauthorized', { status: 403 });
    }
    
    // --- R2クライアントの初期化 ---
    // ▼▼▼【ここを修正】▼▼▼
    // Workers環境で動作するように、リクエストハンドラとXMLパーサーを明示的に指定します。
    const R2 = new S3Client({
      region: "auto",
      endpoint: `https://${context.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: context.env.R2_ACCESS_KEY_ID,
        secretAccessKey: context.env.R2_SECRET_ACCESS_KEY,
      },
      // Workers環境用の設定
      requestHandler: new FetchHttpHandler(),
      urlParser: parseUrl,
      xmlParser: new XMLParser({
        ignoreAttributes: false, // 属性を無視しない
        removeNSPrefix: true,    // XMLの名前空間プレフィックスを削除
      }),
    });
    // ▲▲▲【ここまで修正】▲▲▲

    // --- アクションに応じて処理を振り分け ---
    switch (action) {
      case 'list-files':
        return await handleListFiles(context, R2);
        
      case 'generate-upload-url':
        return await handleGenerateUploadUrl(context, R2, body);

      case 'generate-download-url':
        return await handleGenerateDownloadUrl(context, R2, body);

      default:
        return new Response('Not Found', { status: 404 });
    }

  } catch (error) {
    console.error(error);
    // エラーの詳細をレスポンスに含めるとデバッグに役立ちます
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}


/**
 * ファイル一覧を取得する
 */
async function handleListFiles(context, r2) {
  const command = new ListObjectsV2Command({
    Bucket: context.env.R2_BUCKET_NAME_STRING,
  });
  const response = await r2.send(command);
  
  const files = (response.Contents || []).map(file => ({
    key: file.Key,
    size: file.Size,
    lastModified: file.LastModified,
  }));
  
  return new Response(JSON.stringify({ files }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


/**
 * アップロード用の署名付きURLを生成する
 */
async function handleGenerateUploadUrl(context, r2, body) {
  const { filename, contentType } = body;
  if (!filename || !contentType) {
    return new Response('Bad Request: filename and contentType are required.', { status: 400 });
  }

  const command = new PutObjectCommand({
    Bucket: context.env.R2_BUCKET_NAME_STRING,
    Key: filename,
    ContentType: contentType,
  });

  const url = await getSignedUrl(r2, command, { expiresIn: 3600 }); // 1時間有効

  return new Response(JSON.stringify({ url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


/**
 * ダウンロード用の署名付きURLを生成する
 */
async function handleGenerateDownloadUrl(context, r2, body) {
  const { filename } = body;
  if (!filename) {
    return new Response('Bad Request: filename is required.', { status: 400 });
  }

  const command = new GetObjectCommand({
    Bucket: context.env.R2_BUCKET_NAME_STRING,
    Key: filename,
  });
  
  const url = await getSignedUrl(r2, command, { expiresIn: 3600 }); // 1時間有効

  return new Response(JSON.stringify({ url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}