import { readFileSync, writeFileSync } from 'node:fs';

const state = JSON.parse(readFileSync(process.env.TEST_RELEASE_STATE));
const requests = [];
const { Response, ReadableStream } = globalThis;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const method = options.method ?? 'GET';
  requests.push({ method, path: url.pathname, name: url.searchParams.get('name') });
  writeFileSync(process.env.TEST_RELEASE_REQUESTS, JSON.stringify(requests));
  const release = { id: 42, tag_name: state.scenario === 'wrong-tag' ? 'v0.0.0' : 'v1.2.3', assets: state.assets,
    upload_url: 'https://uploads.example.test/assets{?name,label}' };
  if (method === 'GET' && url.pathname.endsWith('/releases/tags/v1.2.3')) {
    return state.scenario === 'new' ? new Response('', { status: 404 }) : Response.json(release);
  }
  if (method === 'POST' && url.pathname.endsWith('/releases')) return Response.json(release, { status: 201 });
  if (method === 'POST' && (url.pathname.endsWith('/assets') || url.hostname === 'uploads.example.test')) {
    return Response.json({ id: 99, name: url.searchParams.get('name') }, { status: 201 });
  }
  const asset = state.assets.find(a => a.browser_download_url === url.href || url.pathname.endsWith('/releases/assets/' + a.id));
  if (method === 'GET' && asset) {
    if (state.scenario === 'http-failure') return new Response('', { status: 503 });
    if (state.scenario === 'read-error') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('test stream failed')); } }));
    const bytes = Buffer.from(asset.payload, 'base64');
    return new Response(bytes);
  }
  return new Response('Unexpected test request', { status: 500 });
};
