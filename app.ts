// The starter's HTTP surface: a health probe, the REST v3 surface, and a JSON 404 for everything
// else. The contest's other surfaces — git smart HTTP, GraphQL v4 and the MCP endpoint — are what
// the README names, and what later stages add.
//
// app.ts is deliberately separate from main.ts: this is the server, the file you grow; main.ts is the
// entry <-> env lifecycle and should stay as it is.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { sendError, sendJson } from './http.ts';
import { handleRest } from './rest.ts';
import { handleGit, parseGitRoute } from './git-http.ts';
import { handleGraphql } from './graphql.ts';
import { handleMcp } from './mcp.ts';

/** The path of a request URL, or '/' when it does not parse (never a throw from a request). */
function pathOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://entry').pathname;
  } catch {
    return '/';
  }
}

/** Build the server. It binds nothing until the caller listens; the entry listens on an ephemeral port. */
export function createApp(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = pathOf(req);
    const method = req.method ?? 'GET';

    // The env's boot check calls this twice: 200 {"ok":true}.
    if (method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Git smart HTTP under /<owner>/<repo>.git/.
    const gitRoute = parseGitRoute(req.url ?? '/');
    if (gitRoute !== null) {
      void handleGit(req, res, gitRoute).catch(() => {
        if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
        else res.destroy();
      });
      return;
    }

    // The GitHub API surface: REST v3 is the first stage; later stages grow the other prefixes here.
    if (path === '/api/v3' || path.startsWith('/api/v3/')) {
      void handleRest(req, res).catch(() => {
        if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
        else res.destroy();
      });
      return;
    }

    // GraphQL v4.
    if (path === '/api/graphql') {
      void handleGraphql(req, res).catch(() => {
        if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
        else res.destroy();
      });
      return;
    }

    // MCP over Streamable HTTP.
    if (path === '/mcp') {
      void handleMcp(req, res).catch(() => {
        if (!res.headersSent) sendError(res, 500, 'Internal Server Error');
        else res.destroy();
      });
      return;
    }

    // Everything else, every method: GitHub's 404 body.
    sendError(res, 404, 'Not Found');
  });
}
