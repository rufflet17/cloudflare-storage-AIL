import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { XMLParser } from "fast-xml-parser";

export async function onRequest(context) {
  try {
    const { request, env, params } = context;

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // URLからファイル名を取得 (例: /api/download/my-file.txt -> my-file.txt)
    const filename = params.path.join('/');
    if (!filename) {
      return new Response('Filename is required.', { status: 400 });
    }

    const xmlParser = new XMLParser();

    const R2 = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      requestHandler: new FetchHttpHandler(),
      xmlParser: {
        parse: xmlParser.parse,
      },
    });

    // 非常に短い有効期限 (30秒) で署名付きURLを生成
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME_STRING,
      Key: filename,
    });
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 30 });

    // 生成した署名付きURLにリダイレクト
    return new Response(null, {
      status: 302, // Found (Redirect)
      headers: {
        'Location': signedUrl,
      },
    });

  } catch (error) {
    console.error(error);
    // ユーザーには一般的なエラーを表示
    return new Response('Could not process the download link.', { status: 500 });
  }
}