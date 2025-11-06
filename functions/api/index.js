export async function onRequest(context) {
  const { request } = context;
  const responseBody = `
    <h1>API Endpoint Reached</h1>
    <p>This is a debug response from /functions/api/index.js.</p>
    <p>Request Method: ${request.method}</p>
    <p>Request URL: ${request.url}</p>
  `;
  return new Response(responseBody, {
    headers: { 'Content-Type': 'text/html' },
  });
}