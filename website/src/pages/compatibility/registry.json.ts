import registry from '../../../../compatibility/registry.json';

export const prerender = true;

export function GET(): Response {
  return new Response(`${JSON.stringify(registry, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
