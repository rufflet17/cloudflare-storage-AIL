import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { XMLParser } from "fast-xml-parser";

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    // --- ルーティング：パスとメソッドで処理を分岐 ---
    // 1. ダウンロードリンクへのGETリクエストを処理
    if (url.pathname.startsWith('/api/download/') && request.method === 'GET') {
      return handleDownload(context);
    }

    // 2. それ以外のAPIへのPOSTリクエストを処理
    if (request.method === 'POST') {
      return handleActions(context);
    }
    
    // 上記以外は404 Not Found
    return new Response('Not Found', { status: 404 });

  } catch (error) {
    console.error(error);
    const errorMessage = error.stack || error.message;
    return new Response(errorMessage, { status: 500 });
  }
}

/**
 * ダウンロード処理 (GET /api/download/*)
 */
async function handleDownload(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // パスからファイル名を取得
  const filename = url.pathname.substring('/api/download/'.length);
  if (!filename) {
    return new Response('Filename is required.', { status: 400 });
  }

  const R2 = createR2Client(env);
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME_STRING,
    Key: decodeURIComponent(filename), // URLエンコードされたファイル名をデコード
  });
  const signedUrl = await getSignedUrl(R2, command, { expiresIn: 30 });

  return new Response(null, {
    status: 302,
    headers: {
      'Location': signedUrl,
    },
  });
}

/**
 * アクション処理 (POST /api/*)
 */
async function handleActions(context) {
    const { request, env } = context;

    if (env.CF_PAGES_BRANCH) {
      return new Response('Access from production environment is blocked.', { status: 403 });
    }

    const body = await request.json();
    const action = body.action;

    const secretPassword = env.AUTH_PASSWORD;
    if (!secretPassword) {
      return new Response('Password not configured.', { status: 500 });
    }
    if (body.password !== secretPassword) {
      return new Response('Unauthorized.', { status: 401 });
    }
    
    const R2 = createR2Client(env);

    switch (action) {
      case 'list-files':
        return await handleListFiles(env, R2);
      case 'generate-upload-url':
        return await handleGenerateUploadUrl(env, R2, body);
      default:
        // フロントエンドは/api/actionsにPOSTするので、ここは実質的に使われない
        return new Response('Action Not Found', { status: 404 });
    }
}

// --- 共通ヘルパー関数と個別のアクションハンドラ ---

/** S3クライアントを初期化する共通関数 */
function createR2Client(env) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: new FetchHttpHandler(),
    xmlParser: {
      parse: new XMLParser().parse,
    },
  });
}

/** ファイル一覧を取得 */
async function handleListFiles(env, r2) {
  const command = new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME_STRING });
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
  if (!filename || !contentType) return new Response('Bad Request: filename and contentType are required.', { status: 400 });
  const command = new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME_STRING, Key: filename, ContentType: contentType });
  const url = await getSignedUrl(r2, command, { expiresIn: 3600 });
  return new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json' } });
}