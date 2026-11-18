import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendEmpty, sendError, sendJson, type JsonBodyResult } from './http.ts';
import {
  loginForToken,
  store,
  type Issue,
  type IssueComment,
  type Label,
  type ParsedCommit,
  type PullRequest,
  type Repo,
  type User,
} from './store.ts';

const SERVER_NAME = 'github-core-clone';
const SERVER_VERSION = '1.0.0';
const SUPPORTED_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;

type JsonObject = Record<string, unknown>;

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'create_repo',
    title: 'Create repository',
    description: 'Create a repository owned by the bearer token\'s user.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name.' },
        owner: { type: 'string', description: 'Owner login (the token user owns the repository).' },
        description: { type: 'string', description: 'Repository description.' },
        private: { type: 'boolean', description: 'Whether the repository is private.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_repo',
    title: 'Get repository',
    description: 'Read one repository by owner and name.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login.' },
        repo: { type: 'string', description: 'Repository name.' },
        full_name: { type: 'string', description: 'Repository full name as owner/repo.' },
      },
    },
  },
  {
    name: 'create_issue',
    title: 'Create issue',
    description: 'Create an issue in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login.' },
        repo: { type: 'string', description: 'Repository name.' },
        full_name: { type: 'string', description: 'Repository full name as owner/repo.' },
        title: { type: 'string', description: 'Issue title.' },
        body: { type: 'string', description: 'Issue body.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_issues',
    title: 'List issues',
    description: 'List issues in a repository, optionally filtered by state.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login.' },
        repo: { type: 'string', description: 'Repository name.' },
        full_name: { type: 'string', description: 'Repository full name as owner/repo.' },
        state: { type: 'string', description: 'Issue state: open, closed, or all.' },
      },
    },
  },
  {
    name: 'create_pull_request',
    title: 'Create pull request',
    description: 'Open a pull request from a head branch into a base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login.' },
        repo: { type: 'string', description: 'Repository name.' },
        full_name: { type: 'string', description: 'Repository full name as owner/repo.' },
        title: { type: 'string', description: 'Pull request title.' },
        body: { type: 'string', description: 'Pull request body.' },
        head: { type: 'string', description: 'Source branch name.' },
        base: { type: 'string', description: 'Target branch name.' },
      },
      required: ['title', 'head', 'base'],
    },
  },
  {
    name: 'merge_pull_request',
    title: 'Merge pull request',
    description: 'Merge an open pull request into its base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login.' },
        repo: { type: 'string', description: 'Repository name.' },
        full_name: { type: 'string', description: 'Repository full name as owner/repo.' },
        pull_number: { type: 'number', description: 'Pull request number.' },
        commit_message: { type: 'string', description: 'Optional merge commit message.' },
      },
      required: ['pull_number'],
    },
  },
];

const CANONICAL_TOOLS = [
  'create_repo',
  'get_repo',
  'create_issue',
  'list_issues',
  'create_pull_request',
  'merge_pull_request',
];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lower(value: string): string {
  return value.toLowerCase();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function userJson(user: User): JsonObject {
  return {
    login: user.login,
    id: user.id,
    node_id: user.node_id,
    avatar_url: user.avatar_url,
    type: user.type,
    site_admin: false,
  };
}

function ownerOf(repo: Repo): User {
  return store.users.get(repo.owner) ?? store.viewer;
}

function repoJson(repo: Repo): JsonObject {
  const owner = ownerOf(repo);
  return {
    id: repo.id,
    node_id: repo.node_id,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: repo.private,
    owner: userJson(owner),
    html_url: `http://github.invalid/${repo.owner}/${repo.name}`,
    description: repo.description,
    fork: false,
    default_branch: repo.default_branch,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    pushed_at: repo.updated_at,
    clone_url: `http://github.invalid/${repo.owner}/${repo.name}.git`,
    ssh_url: `git@github.invalid:${repo.owner}/${repo.name}.git`,
    git_url: `git://github.invalid/${repo.owner}/${repo.name}.git`,
    open_issues_count: repo.issues.size,
  };
}

function labelJson(label: Label): JsonObject {
  return {
    id: label.id,
    node_id: label.node_id,
    name: label.name,
    color: label.color,
    default: label.default,
    description: label.description,
  };
}

function commentJson(comment: IssueComment): JsonObject {
  return {
    id: comment.id,
    node_id: comment.node_id,
    body: comment.body,
    user: userJson(comment.user),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

function issueJson(repo: Repo, issue: Issue): JsonObject {
  return {
    id: issue.id,
    node_id: issue.node_id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map(labelJson),
    user: userJson(issue.user),
    comments: issue.comments.length,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    html_url: `http://github.invalid/${repo.owner}/${repo.name}/issues/${issue.number}`,
    repository_url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}`,
  };
}

function pullRefJson(repo: Repo, ref: { ref: string; sha: string; label: string; user: User }): JsonObject {
  return {
    ref: ref.ref,
    sha: ref.sha,
    label: ref.label,
    user: userJson(ref.user),
    repo: repoJson(repo),
  };
}

function pullJson(repo: Repo, pull: PullRequest): JsonObject {
  return {
    id: pull.id,
    node_id: pull.node_id,
    number: pull.number,
    title: pull.title,
    body: pull.body,
    state: pull.state,
    merged: pull.merged,
    merged_at: pull.merged_at,
    merge_commit_sha: pull.merge_commit_sha,
    user: userJson(pull.user),
    head: pullRefJson(repo, pull.head),
    base: pullRefJson(repo, pull.base),
    created_at: pull.created_at,
    updated_at: pull.updated_at,
    html_url: `http://github.invalid/${repo.owner}/${repo.name}/pull/${pull.number}`,
    draft: false,
  };
}

function commitJson(commit: ParsedCommit): JsonObject {
  const date = new Date(commit.epochSec * 1000).toISOString();
  return {
    sha: commit.sha,
    node_id: `C_${commit.sha}`,
    commit: {
      message: commit.message,
      tree: { sha: commit.tree },
      author: { name: commit.authorName, email: commit.authorEmail, date },
      committer: { name: commit.committerName, email: commit.committerEmail, date },
    },
    author: { login: store.viewer.login, id: store.viewer.id, name: commit.authorName, email: commit.authorEmail },
    committer: { login: store.viewer.login, id: store.viewer.id, name: commit.committerName, email: commit.committerEmail },
    parents: commit.parents.map((sha) => ({ sha })),
  };
}

function arg(args: JsonObject, aliases: readonly string[]): unknown {
  const byName = new Map<string, unknown>();
  for (const [key, value] of Object.entries(args)) byName.set(normalizeName(key), value);
  for (const alias of aliases) {
    const key = normalizeName(alias);
    if (byName.has(key)) return byName.get(key);
  }
  return undefined;
}

function textArg(args: JsonObject, aliases: readonly string[]): string | null {
  const value = arg(args, aliases);
  return typeof value === 'string' ? value : null;
}

function requiredText(args: JsonObject, aliases: readonly string[]): string | null {
  const value = textArg(args, aliases);
  if (value === null) return null;
  return value.trim() === '' ? null : value;
}

function splitFullName(value: string): { owner: string; repo: string } | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const owner = trimmed.slice(0, slash).trim();
  const repo = trimmed.slice(slash + 1).trim();
  if (owner === '' || repo === '' || repo.includes('/')) return null;
  return { owner, repo };
}

function ownerRepo(args: JsonObject): { owner: string; repo: string } | null {
  const full = textArg(args, ['full_name', 'repo_full_name', 'repository_full_name', 'fullName']);
  const owner = requiredText(args, ['owner', 'owner_login', 'org', 'organization', 'organisation', 'user', 'user_login', 'login', 'account', 'namespace', 'owner_name']);
  const repo = requiredText(args, ['repo', 'repository', 'repository_name', 'repo_name', 'repo_slug', 'project', 'project_name']);
  if (owner !== null && repo !== null) return { owner, repo };
  if (full !== null) return splitFullName(full);
  return null;
}

function pullNumberArg(args: JsonObject): number | null {
  const value = arg(args, ['pull_number', 'pull_request_number', 'pr_number', 'number', 'issue_number', 'index']);
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function toolText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function toolSuccess(value: unknown): JsonObject {
  const result: JsonObject = { content: [{ type: 'text', text: toolText(value) }] };
  if (typeof value === 'object' && value !== null) result.structuredContent = value;
  return result;
}

function toolFailure(message: string): JsonObject {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function findRepo(owner: string, repo: string): Repo | null {
  return store.getRepo(owner, repo) ?? null;
}

function threeWayMerge(
  baseFiles: Map<string, Buffer>,
  headFiles: Map<string, Buffer>,
  currentFiles: Map<string, Buffer>,
): Map<string, Buffer> | null {
  const merged = new Map(currentFiles);
  const paths = new Set<string>([...baseFiles.keys(), ...headFiles.keys()]);
  for (const path of paths) {
    const base = baseFiles.get(path);
    const head = headFiles.get(path);
    const current = currentFiles.get(path);
    const headChanged = !(base === undefined ? head === undefined : head !== undefined && base.equals(head));
    if (!headChanged) continue;
    const currentChanged = !(base === undefined ? current === undefined : current !== undefined && base.equals(current));
    if (!currentChanged) {
      if (head === undefined) merged.delete(path);
      else merged.set(path, head);
      continue;
    }
    if (base === undefined ? head === undefined : head !== undefined && head.equals(current)) continue;
    return null;
  }
  return merged;
}

interface ToolOutcome {
  result?: JsonObject;
  error?: string;
}

function executeTool(canonical: string, args: JsonObject, login: string): ToolOutcome {
  if (canonical === 'create_repo') {
    let name = requiredText(args, ['name', 'repository_name', 'repo_name']);
    if (name === null) {
      const direct = ownerRepo(args);
      if (direct !== null) name = direct.repo;
    }
    if (name === null) return { error: 'create_repo requires a non-empty name' };
    const repo = store.createRepo(login, name, {
      description: textArg(args, ['description', 'about', 'summary']) ?? '',
      private: arg(args, ['private', 'is_private']) === true,
      default_branch: textArg(args, ['default_branch', 'defaultBranch']) ?? 'main',
    });
    return { result: toolSuccess(repoJson(repo)) };
  }

  if (canonical === 'get_repo') {
    const ref = ownerRepo(args);
    if (ref === null) return { error: 'get_repo requires owner and repo (or full_name)' };
    const repo = findRepo(ref.owner, ref.repo);
    if (repo === null) return { error: `repository ${ref.owner}/${ref.repo} not found` };
    return { result: toolSuccess(repoJson(repo)) };
  }

  if (canonical === 'create_issue') {
    const ref = ownerRepo(args);
    if (ref === null) return { error: 'create_issue requires owner and repo (or full_name)' };
    const title = requiredText(args, ['title', 'issue_title', 'pr_title', 'pull_request_title', 'subject']);
    if (title === null) return { error: 'create_issue requires a non-empty title' };
    const repo = findRepo(ref.owner, ref.repo);
    if (repo === null) return { error: `repository ${ref.owner}/${ref.repo} not found` };
    const body = textArg(args, ['body', 'issue_body', 'description', 'content', 'text', 'comment']) ?? '';
    const issue = store.createIssue(repo, title, body, []);
    return { result: toolSuccess(issueJson(repo, issue)) };
  }

  if (canonical === 'list_issues') {
    const ref = ownerRepo(args);
    if (ref === null) return { error: 'list_issues requires owner and repo (or full_name)' };
    const repo = findRepo(ref.owner, ref.repo);
    if (repo === null) return { error: `repository ${ref.owner}/${ref.repo} not found` };
    const state = textArg(args, ['state', 'status']) ?? 'open';
    let issues = [...repo.issues.values()];
    if (state !== 'all') issues = issues.filter((issue) => issue.state === state);
    issues.sort((a, b) => a.number - b.number);
    const payload = { [`${repo.owner}/${repo.name} issues`]: issues.map((issue) => issueJson(repo, issue)) };
    return { result: toolSuccess(payload) };
  }

  if (canonical === 'create_pull_request') {
    const ref = ownerRepo(args);
    if (ref === null) return { error: 'create_pull_request requires owner and repo (or full_name)' };
    const repo = findRepo(ref.owner, ref.repo);
    if (repo === null) return { error: `repository ${ref.owner}/${ref.repo} not found` };
    const title = requiredText(args, ['title', 'pr_title', 'pull_request_title', 'subject']);
    if (title === null) return { error: 'create_pull_request requires a non-empty title' };
    const headRaw = requiredText(args, ['head', 'head_ref', 'head_branch', 'pull_request_head', 'pr_head', 'source', 'source_ref', 'source_branch', 'from', 'from_branch', 'branch']);
    const baseRaw = requiredText(args, ['base', 'base_ref', 'base_branch', 'pull_request_base', 'pr_base', 'target', 'target_ref', 'target_branch', 'into', 'into_branch']) ?? repo.default_branch;
    if (headRaw === null) return { error: 'create_pull_request requires a non-empty head branch' };
    if (baseRaw === null) return { error: 'create_pull_request requires a non-empty base branch' };
    const head = headRaw.includes(':') ? (headRaw.split(':').pop() ?? '') : headRaw;
    const base = baseRaw.includes(':') ? (baseRaw.split(':').pop() ?? '') : baseRaw;
    if (head === '' || base === '') return { error: 'create_pull_request requires non-empty head and base branches' };
    const headSha = store.resolveRef(repo, `refs/heads/${head}`) ?? store.resolveRef(repo, head);
    const baseSha = store.resolveRef(repo, `refs/heads/${base}`) ?? store.resolveRef(repo, base);
    if (headSha === null) return { error: `head branch ${head} does not exist` };
    if (baseSha === null) return { error: `base branch ${base} does not exist` };
    const body = textArg(args, ['body', 'issue_body', 'description', 'content', 'text', 'comment']) ?? '';
    const pull = store.createPull(repo, { title, body, head, base, headSha, baseSha });
    return { result: toolSuccess(pullJson(repo, pull)) };
  }

  if (canonical === 'merge_pull_request') {
    const ref = ownerRepo(args);
    if (ref === null) return { error: 'merge_pull_request requires owner and repo (or full_name)' };
    const number = pullNumberArg(args);
    if (number === null) return { error: 'merge_pull_request requires a pull_number' };
    const repo = findRepo(ref.owner, ref.repo);
    if (repo === null) return { error: `repository ${ref.owner}/${ref.repo} not found` };
    const pull = repo.pulls.get(number);
    if (pull === undefined) return { error: `pull request #${number} not found` };
    if (pull.merged) {
      return { result: toolSuccess({ sha: pull.merge_commit_sha, merged: true, message: 'Pull Request successfully merged' }) };
    }
    const headSha = store.resolveRef(repo, `refs/heads/${pull.head.ref}`) ?? pull.head.sha;
    const baseSha = store.resolveRef(repo, `refs/heads/${pull.base.ref}`) ?? pull.base.sha;
    const baseCommit = store.getCommit(baseSha);
    const headCommit = store.getCommit(headSha);
    if (baseCommit === null || headCommit === null) return { error: 'Pull Request is not mergeable' };
    const mergeBaseSha = store.mergeBase(headSha, baseSha);
    const baseFiles = mergeBaseSha === null ? new Map<string, Buffer>() : store.readFilesAtTree(store.getCommit(mergeBaseSha)?.tree ?? '');
    const headFiles = store.readFilesAtTree(headCommit.tree);
    const currentFiles = store.readFilesAtTree(baseCommit.tree);
    const merged = threeWayMerge(baseFiles, headFiles, currentFiles);
    if (merged === null) return { error: 'Pull Request is not mergeable' };
    const message = textArg(args, ['commit_message', 'message']) || `Merge pull request #${pull.number} from ${pull.head.label}`;
    const mergeSha = store.createCommit(merged, { message, parent: baseSha });
    repo.refs.set(`refs/heads/${pull.base.ref}`, mergeSha);
    pull.state = 'closed';
    pull.merged = true;
    pull.merged_at = store.clock.iso();
    pull.merge_commit_sha = mergeSha;
    pull.updated_at = pull.merged_at;
    repo.updated_at = pull.updated_at;
    return { result: toolSuccess({ sha: mergeSha, merged: true, message: 'Pull Request successfully merged' }) };
  }

  return { error: `unknown tool ${canonical}` };
}

function canonicalFor(name: string): string | null {
  const normalized = normalizeName(name);
  for (const canonical of CANONICAL_TOOLS) {
    if (normalized === normalizeName(canonical)) return canonical;
  }
  for (const canonical of CANONICAL_TOOLS) {
    if (normalized.length > normalizeName(canonical).length && normalized.endsWith(normalizeName(canonical))) return canonical;
  }
  return null;
}

function sendRpc(
  res: ServerResponse,
  status: number,
  id: unknown,
  result?: unknown,
  error?: { code: number; message: string; data?: unknown },
): void {
  const body: JsonObject = { jsonrpc: '2.0', id: id === undefined ? null : id };
  if (error !== undefined) body.error = error as unknown as JsonObject;
  else body.result = result ?? {};
  sendJson(res, status, body);
}

function versionOf(body: JsonObject, req: IncomingMessage): string | null {
  const params = isRecord(body.params) ? body.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const fromMeta = meta['io.modelcontextprotocol/protocolVersion'];
  if (typeof fromMeta === 'string' && fromMeta !== '') return fromMeta;
  const plain = meta.protocolVersion;
  if (typeof plain === 'string' && plain !== '') return plain;
  const header = req.headers['mcp-protocol-version'];
  if (typeof header === 'string' && header !== '') return header;
  return null;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'DELETE') {
    req.resume();
    sendEmpty(res, 204);
    return;
  }
  if (method !== 'POST') {
    req.resume();
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  const login = loginForToken(bearer);
  if (login === null) {
    req.resume();
    sendError(res, 401, 'Requires authentication');
    return;
  }

  const parsed: JsonBodyResult = await readJsonBody(req);
  if (!parsed.ok) {
    sendRpc(res, 400, null, undefined, { code: JSON_RPC_PARSE_ERROR, message: 'Parse error' });
    return;
  }
  if (!isRecord(parsed.value)) {
    sendRpc(res, 200, null, undefined, { code: JSON_RPC_INVALID_REQUEST, message: 'Invalid Request' });
    return;
  }

  const body = parsed.value;
  const hasId = Object.prototype.hasOwnProperty.call(body, 'id');
  const id = body.id;
  const rpcMethod = typeof body.method === 'string' ? body.method : '';
  const params = isRecord(body.params) ? body.params : {};

  if (!hasId) {
    req.resume();
    sendEmpty(res, 202);
    return;
  }

  if (rpcMethod === '') {
    sendRpc(res, 200, id, undefined, { code: JSON_RPC_INVALID_REQUEST, message: 'Invalid Request' });
    return;
  }

  try {
    if (rpcMethod === 'initialize') {
      const offered = typeof params.protocolVersion === 'string' && params.protocolVersion !== ''
        ? params.protocolVersion
        : (versionOf(body, req) ?? '2025-11-25');
      sendRpc(res, 200, id, {
        protocolVersion: offered,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    if (rpcMethod === 'server/discover') {
      sendRpc(res, 200, id, {
        supportedVersions: [...SUPPORTED_VERSIONS],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'GitHub-compatible tools backed by the same store as the REST v3 surface.',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION } },
      });
      return;
    }

    if (rpcMethod === 'tools/list') {
      sendRpc(res, 200, id, { tools: TOOLS });
      return;
    }

    if (rpcMethod === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : '';
      if (name === '') {
        sendRpc(res, 200, id, undefined, { code: JSON_RPC_INVALID_PARAMS, message: 'tools/call requires a tool name' });
        return;
      }
      const canonical = canonicalFor(name);
      if (canonical === null) {
        sendRpc(res, 200, id, undefined, { code: JSON_RPC_INVALID_PARAMS, message: `Unknown tool: ${name}` });
        return;
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      const outcome = executeTool(canonical, args, login);
      if (outcome.result === undefined) {
        sendRpc(res, 200, id, undefined, { code: JSON_RPC_INVALID_PARAMS, message: outcome.error ?? 'Invalid arguments' });
        return;
      }
      sendRpc(res, 200, id, outcome.result);
      return;
    }

    if (rpcMethod === 'notifications/initialized') {
      sendRpc(res, 200, id, {});
      return;
    }

    if (rpcMethod === 'ping') {
      sendRpc(res, 200, id, {});
      return;
    }

    sendRpc(res, 200, id, undefined, { code: JSON_RPC_METHOD_NOT_FOUND, message: `Method not found: ${rpcMethod}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendRpc(res, 200, id, undefined, { code: JSON_RPC_INTERNAL_ERROR, message });
  }
}
