import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare Workers環境でAWS SDKを動作させるための必須ライブラリ
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { parseUrl } from "@aws-sdk/url-parser-native";

/**
 * 全てのAPIリクエストを処理するエントリーポイント
 */
export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    const action = params.path[params.path.length - 1];
    
    // POST以外のメソッドは許可しない
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await request.json();
    const { password } = body;

    // --- 認証 ---
    if (!password || password !== env.AUTH_PASSWORD) {
      return new Response('Unauthorized', { status: 403 });
    }
    
    // --- R2クライアントの初期化 (Cloudflare Workers環境向け) ---
    const R2 = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // 以下の2行がWorkers環境での動作に必須
      requestHandler: new FetchHttpHandler(),
      urlParser: parseUrl,
    });

    // --- アクションに応じて処理を振り分け ---
    switch (action) {
      case 'list-files':
        return await handleListFiles(env, R2);
      case 'generate-upload-url':
        return await handleGenerateUploadUrl(env, R2, body);
      case 'generate-download-url':
        return await handleGenerateDownloadUrl(env, R2, body);
      default:
        return new Response('Not Found', { status: 404 });
    }
  } catch (error) {
    console.error(error);
    return new Response(error.message, { status: 500 });
  }
}

/** ファイル一覧を取得 */
async function handleListFiles(env, r2) {
  const command = new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME });
  const response = await r2.send(command);
  const files = (response.Contents || []).map(file => ({
    key: file.Key,
    size: file.Size,
    lastModified: file.LastModified,
  }));
  return new Response(JSON.stringify({ files }), { headers: { 'Content-Type': 'application/json' } });
}

/** アップロード用の署名付きURLを生成 */
async function handleGenerateUploadUrl(env, r2, body) {
  const { filename, contentType } = body;
  if (!filename || !contentType) return new Response('Bad Request', { status: 400 });
  const command = new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: filename, ContentType: contentType });
  const url = await getSignedUrl(r2, command, { expiresIn: 3600 });
  return new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json' } });
}

/** ダウンロード用の署名付きURLを生成 */
async function handleGenerateDownloadUrl(env, r2, body) {
  const { filename } = body;
  if (!filename) return new Response('Bad Request', { status: 400 });
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: filename });
  const url = await getSignedUrl(r2, command, { expiresIn: 3600 });
  return new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json' } });
}