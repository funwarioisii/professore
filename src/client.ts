export const base = `http://127.0.0.1:${process.env.PROFESSORE_PORT ?? 4318}`;
export async function api(route: string, body?: unknown, method?: string) {
  let response: Response;
  try {
    response = await fetch(base + "/api" + route, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Error(
      "ローカルサービスに接続できません。別ターミナルで npm start を実行してください",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(Error(result.error), {
      issues: result.issues,
      status: response.status,
    });
  return result;
}
