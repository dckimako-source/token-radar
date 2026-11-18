import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  booleanOf,
  objectOf,
  readJsonBody,
  sendEmpty,
  sendError,
  sendJson,
  stringOf,
} from './http.ts';
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

const SHA40 = /^[0-9a-f]{40}$/i;

function lower(value: string): string {
  return value.toLowerCase();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function userJson(user: User): Record<string, unknown> {
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

function repoJson(repo: Repo): Record<string, unknown> {
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

function labelJson(label: Label): Record<string, unknown> {
  return {
    id: label.id,
    node_id: label.node_id,
    name: label.name,
    color: label.color,
    default: label.default,
    description: label.description,
  };
}

function commentJson(comment: IssueComment): Record<string, unknown> {
  return {
    id: comment.id,
    node_id: comment.node_id,
    body: comment.body,
    user: userJson(comment.user),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

function issueJson(repo: Repo, issue: Issue): Record<string, unknown> {
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

function pullRefJson(repo: Repo, ref: { ref: string; sha: string; label: string; user: User }): Record<string, unknown> {
  return {
    ref: ref.ref,
    sha: ref.sha,
    label: ref.label,
    user: userJson(ref.user),
    repo: repoJson(repo),
  };
}

function pullJson(repo: Repo, pull: PullRequest): Record<string, unknown> {
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

function commitJson(commit: ParsedCommit): Record<string, unknown> {
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

function pageSettings(url: URL): { page: number; perPage: number } {
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const rawPerPage = Number(url.searchParams.get('per_page') ?? '30');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1;
  const perPage = Number.isFinite(rawPerPage) && rawPerPage >= 1 ? Math.min(100, Math.trunc(rawPerPage)) : 30;
  return { page, perPage };
}

function paginate<T>(items: readonly T[], url: URL): { pageItems: T[]; link: string | null } {
  const { page, perPage } = pageSettings(url);
  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);
  if (start + perPage >= items.length) return { pageItems, link: null };
  const next = new URL(url.toString());
  next.searchParams.set('page', String(page + 1));
  next.searchParams.set('per_page', String(perPage));
  return { pageItems, link: `<${next.toString()}>; rel="next"` };
}

function notFound(res: ServerResponse): void {
  sendError(res, 404, 'Not Found');
}

function validationFailed(res: ServerResponse): void {
  sendError(res, 422, 'Validation Failed');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringsOf(value: unknown): string[] {
  return asArray(value)
    .map((item) => (typeof item === 'string' ? item : objectOf(item).name))
    .filter((item): item is string => typeof item === 'string');
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function splitLines(content: Buffer | undefined): string[] {
  if (content === undefined) return [];
  const text = content.toString('utf8');
  if (text === '') return [];
  return text.split('\n');
}

function diffStats(oldContent: Buffer | undefined, newContent: Buffer | undefined): { additions: number; deletions: number; patch: string } {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i]![j] = oldLines[i - 1] === newLines[j - 1]
        ? (table[i - 1]![j - 1] ?? 0) + 1
        : Math.max(table[i - 1]![j] ?? 0, table[i]![j - 1] ?? 0);
    }
  }
  const common = table[oldLines.length]![newLines.length] ?? 0;
  const additions = newLines.length - common;
  const deletions = oldLines.length - common;
  const patchLines: string[] = [];
  if (oldContent === undefined) {
    patchLines.push(`@@ -0,0 +1,${newLines.length} @@`);
    for (const line of newLines) patchLines.push(`+${line}`);
  } else if (newContent === undefined) {
    patchLines.push(`@@ -1,${oldLines.length} +0,0 @@`);
    for (const line of oldLines) patchLines.push(`-${line}`);
  } else {
    patchLines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
    for (const line of oldLines) patchLines.push(`-${line}`);
    for (const line of newLines) patchLines.push(`+${line}`);
  }
  return { additions, deletions, patch: patchLines.join('\n') };
}

function pullFiles(repo: Repo, pull: PullRequest): Record<string, unknown>[] {
  const headFiles = store.readFilesAtRef(repo, pull.head.sha);
  const baseFiles = store.readFilesAtRef(repo, pull.base.sha);
  const paths = new Set<string>([...headFiles.keys(), ...baseFiles.keys()]);
  const files: Record<string, unknown>[] = [];
  for (const path of [...paths].sort()) {
    const before = baseFiles.get(path);
    const after = headFiles.get(path);
    if (before !== undefined && after !== undefined && before.equals(after)) continue;
    const status = before === undefined ? 'added' : after === undefined ? 'removed' : 'modified';
    const stats = diffStats(before, after);
    files.push({
      sha: after === undefined ? (before === undefined ? '' : store.writeBlob(before)) : store.writeBlob(after),
      filename: path,
      status,
      additions: stats.additions,
      deletions: stats.deletions,
      changes: stats.additions + stats.deletions,
      patch: stats.patch,
    });
  }
  return files;
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

export async function handleRest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    sendError(res, 400, 'Bad Request');
    return;
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  const login = loginForToken(bearer);
  if (login === null) {
    sendError(res, 401, 'Requires authentication');
    return;
  }

  let body: Record<string, unknown> = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      sendError(res, 400, 'Problems parsing JSON');
      return;
    }
    body = objectOf(parsed.value);
  }

  const parts = url.pathname.split('/').filter((part) => part !== '').map(safeDecode);
  if (parts[0] !== 'api' || parts[1] !== 'v3') {
    notFound(res);
    return;
  }

  if (parts.length === 2) {
    if (method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed');
      return;
    }
    sendJson(
      res,
      200,
      {
        current_user_url: 'http://github.invalid/api/v3/user',
        current_user_authorizations_html_url: 'http://github.invalid/settings/connections/applications{/client_id}',
        authorizations_url: 'http://github.invalid/api/v3/authorizations',
        repository_url: 'http://github.invalid/api/v3/repos/{owner}/{repo}',
        user_repositories_url: 'http://github.invalid/api/v3/users/{user}/repos{?type,page,per_page,sort}',
        user_url: 'http://github.invalid/api/v3/users/{user}',
      },
      { 'x-oauth-scopes': 'repo, read:org' },
    );
    return;
  }

  if (parts.length === 3 && parts[2] === 'meta' && method === 'GET') {
    sendJson(res, 200, { installed_version: '1.0.0', verifiable_password_authentication: false });
    return;
  }

  if (parts[2] === 'user') {
    if (parts.length === 3 && method === 'GET') {
      sendJson(res, 200, userJson(store.viewer));
      return;
    }
    if (parts.length === 4 && parts[3] === 'repos') {
      if (method === 'GET') {
        const repos = store.listRepos(login);
        const { pageItems, link } = paginate(repos, url);
        sendJson(res, 200, pageItems.map(repoJson), link === null ? {} : { link });
        return;
      }
      if (method === 'POST') {
        const name = stringOf(body.name).trim();
        if (name === '') {
          validationFailed(res);
          return;
        }
        const existing = store.getRepo(login, name);
        if (existing !== undefined) {
          sendError(res, 422, 'name already exists on this account');
          return;
        }
        const repo = store.createRepo(login, name, {
          description: stringOf(body.description),
          private: booleanOf(body.private, false),
          default_branch: stringOf(body.default_branch, 'main') || 'main',
        });
        sendJson(res, 201, repoJson(repo));
        return;
      }
      sendError(res, 405, 'Method Not Allowed');
      return;
    }
    notFound(res);
    return;
  }

  if (parts[2] !== 'repos' || parts.length < 5) {
    notFound(res);
    return;
  }

  const owner = parts[3] as string;
  const name = parts[4] as string;
  if (lower(owner) !== lower(login)) {
    notFound(res);
    return;
  }
  let repo = store.getRepo(login, name);
  if (repo === undefined) {
    notFound(res);
    return;
  }
  const rest = parts.slice(5);

  if (rest.length === 0) {
    if (method === 'GET') {
      sendJson(res, 200, repoJson(repo));
      return;
    }
    if (method === 'PATCH') {
      if (typeof body.description === 'string') repo.description = body.description;
      if (typeof body.private === 'boolean') repo.private = body.private;
      if (typeof body.default_branch === 'string' && body.default_branch !== '') repo.default_branch = body.default_branch;
      repo.updated_at = store.clock.iso();
      sendJson(res, 200, repoJson(repo));
      return;
    }
    if (method === 'DELETE') {
      store.deleteRepo(login, name);
      sendEmpty(res, 204);
      return;
    }
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  if (rest[0] === 'branches' && rest.length === 1 && method === 'GET') {
    const branches = [...repo.refs.entries()]
      .filter(([ref]) => ref.startsWith('refs/heads/'))
      .map(([ref, sha]) => ({
        name: ref.slice('refs/heads/'.length),
        commit: { sha, url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/commits/${sha}` },
        protected: false,
      }));
    sendJson(res, 200, branches);
    return;
  }

  if (rest[0] === 'commits' && method === 'GET') {
    const ref = url.searchParams.get('sha') ?? url.searchParams.get('ref') ?? repo.default_branch;
    const commit = store.resolveCommit(repo, ref);
    const commits = commit === null ? [] : store.reachableCommits(commit.sha);
    sendJson(res, 200, commits.map(commitJson));
    return;
  }

  if (rest[0] === 'git' && rest[1] === 'refs') {
    if (rest.length === 2 && method === 'POST') {
      const ref = stringOf(body.ref);
      const sha = lower(stringOf(body.sha));
      if (!ref.startsWith('refs/') || !SHA40.test(sha) || store.getCommit(sha) === null) {
        validationFailed(res);
        return;
      }
      repo.refs.set(ref, sha);
      sendJson(res, 201, { ref, node_id: `REF_${ref}`, url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/git/${ref}`, object: { sha, type: 'commit', url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/git/commits/${sha}` } });
      return;
    }
    if (rest.length === 2 && method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? 'refs/';
      const refs = [...repo.refs.entries()]
        .filter(([ref]) => ref.startsWith(prefix))
        .map(([ref, sha]) => ({ ref, node_id: `REF_${ref}`, object: { sha, type: 'commit' } }));
      sendJson(res, 200, refs);
      return;
    }
    if (rest.length > 2 && method === 'GET') {
      const ref = rest.slice(2).join('/');
      const sha = repo.refs.get(ref);
      if (sha === undefined) {
        notFound(res);
        return;
      }
      sendJson(res, 200, { ref, node_id: `REF_${ref}`, object: { sha, type: 'commit' } });
      return;
    }
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  if (rest[0] === 'contents') {
    const filePath = rest.slice(1).join('/');
    if (method === 'GET') {
      const ref = url.searchParams.get('ref') ?? repo.default_branch;
      const entry = store.resolvePath(repo, ref, filePath);
      if (entry === null) {
        notFound(res);
        return;
      }
      if (entry.kind === 'dir') {
        const prefix = filePath === '' ? '' : `${filePath}/`;
        const listing = store.readTreeEntries(entry.sha).map((child) => {
          const childPath = `${prefix}${child.name}`;
          const isDir = child.mode.startsWith('4');
          if (isDir) return { type: 'dir', name: child.name, path: childPath, sha: child.sha, size: 0 };
          const object = store.readObject(child.sha);
          return {
            type: 'file',
            name: child.name,
            path: childPath,
            sha: child.sha,
            size: object?.content.length ?? 0,
            encoding: 'base64',
            content: (object?.content ?? Buffer.alloc(0)).toString('base64'),
          };
        });
        sendJson(res, 200, listing);
        return;
      }
      const fileName = filePath.split('/').filter((part) => part !== '').pop() ?? filePath;
      const content = entry.content ?? Buffer.alloc(0);
      sendJson(res, 200, {
        type: 'file',
        encoding: 'base64',
        content: content.toString('base64'),
        sha: entry.sha,
        name: fileName,
        path: filePath,
        size: content.length,
        mode: entry.mode,
        url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/contents/${filePath}`,
        git_url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/git/blobs/${entry.sha}`,
        html_url: `http://github.invalid/${repo.owner}/${repo.name}/blob/${ref}/${filePath}`,
        download_url: null,
      });
      return;
    }

    const branch = stringOf(body.branch, repo.default_branch) || repo.default_branch;
    const ref = `refs/heads/${branch}`;
    const tip = repo.refs.get(ref);
    if (branch !== repo.default_branch && tip === undefined) {
      notFound(res);
      return;
    }
    const files = tip === undefined ? new Map<string, Buffer>() : store.readFilesAtTree(store.getCommit(tip)?.tree ?? '');
    const existing = files.get(filePath);
    const expectedSha = stringOf(body.sha);
    if (expectedSha !== '') {
      if (existing === undefined) {
        sendError(res, 409, 'sha does not match');
        return;
      }
      const currentSha = store.writeBlob(existing);
      if (lower(currentSha) !== lower(expectedSha)) {
        sendError(res, 409, 'sha does not match');
        return;
      }
    }

    if (method === 'PUT') {
      if (typeof body.content !== 'string') {
        validationFailed(res);
        return;
      }
      const content = Buffer.from(body.content.replace(/[\r\n\t ]+/g, ''), 'base64');
      files.set(filePath, content);
      const message = stringOf(body.message, `Update ${filePath}`) || `Update ${filePath}`;
      const commitSha = store.createCommit(files, { message, parent: tip ?? null });
      repo.refs.set(ref, commitSha);
      const blobSha = store.writeBlob(content);
      repo.updated_at = store.clock.iso();
      const status = existing === undefined ? 201 : 200;
      sendJson(res, status, {
        content: {
          name: filePath.split('/').pop() ?? filePath,
          path: filePath,
          sha: blobSha,
          size: content.length,
          encoding: 'base64',
          content: content.toString('base64'),
        },
        commit: {
          sha: commitSha,
          node_id: `C_${commitSha}`,
          message,
          url: `http://github.invalid/api/v3/repos/${repo.owner}/${repo.name}/git/commits/${commitSha}`,
        },
      });
      return;
    }

    if (method === 'DELETE') {
      if (existing === undefined) {
        notFound(res);
        return;
      }
      files.delete(filePath);
      const message = stringOf(body.message, `Delete ${filePath}`) || `Delete ${filePath}`;
      const commitSha = store.createCommit(files, { message, parent: tip ?? null });
      repo.refs.set(ref, commitSha);
      repo.updated_at = store.clock.iso();
      sendJson(res, 200, {
        content: null,
        commit: { sha: commitSha, node_id: `C_${commitSha}`, message },
      });
      return;
    }

    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  if (rest[0] === 'labels') {
    if (rest.length === 1 && method === 'POST') {
      const labelName = stringOf(body.name).trim();
      if (labelName === '') {
        validationFailed(res);
        return;
      }
      const label = store.createLabel(repo, labelName, stringOf(body.color, 'ededed') || 'ededed', typeof body.description === 'string' ? body.description : null);
      sendJson(res, 201, labelJson(label));
      return;
    }
    if (rest.length === 1 && method === 'GET') {
      sendJson(res, 200, [...repo.labels.values()].map(labelJson));
      return;
    }
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  if (rest[0] === 'issues') {
    if (rest.length === 1) {
      if (method === 'POST') {
        const title = stringOf(body.title).trim();
        if (title === '') {
          validationFailed(res);
          return;
        }
        const names = stringsOf(body.labels);
        const labels: Label[] = [];
        for (const labelName of names) {
          const label = repo.labels.get(lower(labelName));
          if (label === undefined) {
            validationFailed(res);
            return;
          }
          labels.push(label);
        }
        const issue = store.createIssue(repo, title, stringOf(body.body), labels);
        sendJson(res, 201, issueJson(repo, issue));
        return;
      }
      if (method === 'GET') {
        const state = url.searchParams.get('state') ?? 'open';
        const sort = url.searchParams.get('sort') ?? 'created';
        const direction = url.searchParams.get('direction') ?? 'desc';
        let issues = [...repo.issues.values()];
        if (state !== 'all') issues = issues.filter((issue) => issue.state === state);
        issues.sort((a, b) => {
          const comparison = sort === 'updated'
            ? a.updated_at.localeCompare(b.updated_at)
            : sort === 'comments'
              ? a.comments.length - b.comments.length
              : a.created_at.localeCompare(b.created_at);
          const tied = comparison === 0 ? a.number - b.number : comparison;
          return direction === 'asc' ? tied : -tied;
        });
        const { pageItems, link } = paginate(issues, url);
        sendJson(res, 200, pageItems.map((issue) => issueJson(repo, issue)), link === null ? {} : { link });
        return;
      }
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    const number = parseNumber(rest[1]);
    if (number === null) {
      notFound(res);
      return;
    }
    const issue = repo.issues.get(number);
    if (issue === undefined) {
      notFound(res);
      return;
    }

    if (rest.length === 2) {
      if (method === 'GET') {
        sendJson(res, 200, issueJson(repo, issue));
        return;
      }
      if (method === 'PATCH') {
        if (typeof body.title === 'string' && body.title.trim() !== '') issue.title = body.title;
        if (typeof body.body === 'string') issue.body = body.body;
        if (body.state === 'open' || body.state === 'closed') issue.state = body.state;
        if (Array.isArray(body.labels)) {
          const labels: Label[] = [];
          for (const labelName of stringsOf(body.labels)) {
            const label = repo.labels.get(lower(labelName));
            if (label === undefined) {
              validationFailed(res);
              return;
            }
            labels.push(label);
          }
          issue.labels = labels;
        }
        issue.updated_at = store.clock.iso();
        sendJson(res, 200, issueJson(repo, issue));
        return;
      }
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    if (rest.length === 3 && rest[2] === 'comments') {
      if (method === 'POST') {
        const text = stringOf(body.body);
        const comment = store.createComment(repo, issue, text);
        sendJson(res, 201, commentJson(comment));
        return;
      }
      if (method === 'GET') {
        sendJson(res, 200, issue.comments.map(commentJson));
        return;
      }
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    notFound(res);
    return;
  }

  if (rest[0] === 'pulls') {
    if (rest.length === 1) {
      if (method === 'POST') {
        const title = stringOf(body.title).trim();
        const headRaw = stringOf(body.head);
        const baseRaw = stringOf(body.base, repo.default_branch) || repo.default_branch;
        const head = headRaw.includes(':') ? (headRaw.split(':').pop() ?? '') : headRaw;
        const base = baseRaw.includes(':') ? (baseRaw.split(':').pop() ?? '') : baseRaw;
        if (title === '' || head === '' || base === '') {
          validationFailed(res);
          return;
        }
        const headSha = store.resolveRef(repo, `refs/heads/${head}`) ?? store.resolveRef(repo, head);
        const baseSha = store.resolveRef(repo, `refs/heads/${base}`) ?? store.resolveRef(repo, base);
        if (headSha === null || baseSha === null) {
          validationFailed(res);
          return;
        }
        const pull = store.createPull(repo, {
          title,
          body: stringOf(body.body),
          head,
          base,
          headSha,
          baseSha,
        });
        sendJson(res, 201, pullJson(repo, pull));
        return;
      }
      if (method === 'GET') {
        const state = url.searchParams.get('state') ?? 'open';
        let pulls = [...repo.pulls.values()];
        if (state !== 'all') pulls = pulls.filter((pull) => pull.state === state);
        pulls.sort((a, b) => b.number - a.number);
        const { pageItems, link } = paginate(pulls, url);
        sendJson(res, 200, pageItems.map((pull) => pullJson(repo, pull)), link === null ? {} : { link });
        return;
      }
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    const number = parseNumber(rest[1]);
    if (number === null) {
      notFound(res);
      return;
    }
    const pull = repo.pulls.get(number);
    if (pull === undefined) {
      notFound(res);
      return;
    }

    if (rest.length === 2 && method === 'GET') {
      sendJson(res, 200, pullJson(repo, pull));
      return;
    }

    if (rest.length === 3 && rest[2] === 'files' && method === 'GET') {
      sendJson(res, 200, pullFiles(repo, pull));
      return;
    }

    if (rest.length === 3 && rest[2] === 'merge' && method === 'PUT') {
      if (pull.merged) {
        sendError(res, 405, 'Pull Request is already merged');
        return;
      }
      const headSha = store.resolveRef(repo, `refs/heads/${pull.head.ref}`) ?? pull.head.sha;
      const baseSha = store.resolveRef(repo, `refs/heads/${pull.base.ref}`) ?? pull.base.sha;
      const baseCommit = store.getCommit(baseSha);
      const headCommit = store.getCommit(headSha);
      if (baseCommit === null || headCommit === null) {
        sendError(res, 405, 'Pull Request is not mergeable');
        return;
      }
      const mergeBaseSha = store.mergeBase(headSha, baseSha);
      const baseFiles = mergeBaseSha === null ? new Map<string, Buffer>() : store.readFilesAtTree(store.getCommit(mergeBaseSha)?.tree ?? '');
      const headFiles = store.readFilesAtTree(headCommit.tree);
      const currentFiles = store.readFilesAtTree(baseCommit.tree);
      const merged = threeWayMerge(baseFiles, headFiles, currentFiles);
      if (merged === null) {
        sendError(res, 405, 'Pull Request is not mergeable');
        return;
      }
      const message = stringOf(body.commit_message) || `Merge pull request #${pull.number} from ${pull.head.label}`;
      const mergeSha = store.createCommit(merged, { message, parent: baseSha });
      repo.refs.set(`refs/heads/${pull.base.ref}`, mergeSha);
      pull.state = 'closed';
      pull.merged = true;
      pull.merged_at = store.clock.iso();
      pull.merge_commit_sha = mergeSha;
      pull.updated_at = pull.merged_at;
      repo.updated_at = pull.updated_at;
      sendJson(res, 200, { sha: mergeSha, merged: true, message: 'Pull Request successfully merged' });
      return;
    }

    notFound(res);
    return;
  }

  notFound(res);
}
