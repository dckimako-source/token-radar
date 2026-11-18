import type { IncomingMessage, ServerResponse } from 'node:http';
import { objectOf, readJsonBody, sendError, sendJson } from './http.ts';
import {
  loginForToken,
  store,
  type Issue,
  type IssueComment,
  type PullRequest,
  type Repo,
} from './store.ts';

interface Token {
  type: string;
  value?: string;
}

interface VarRef {
  kind: 'var';
  name: string;
}

type GqlValue = string | number | boolean | null | VarRef | GqlValue[] | { [key: string]: GqlValue };

interface Argument {
  name: string;
  value: GqlValue;
}

interface FieldNode {
  kind: 'field';
  alias: string | null;
  name: string;
  args: Argument[];
  selections: Selection[];
}

interface InlineFragment {
  kind: 'inline';
  typeCondition: string | null;
  selections: Selection[];
}

interface FragmentSpread {
  kind: 'spread';
  name: string;
}

type Selection = FieldNode | InlineFragment | FragmentSpread;

interface VariableDefinition {
  name: string;
  defaultValue?: GqlValue;
}

interface Operation {
  type: 'query' | 'mutation';
  name: string | null;
  variables: VariableDefinition[];
  selections: Selection[];
}

interface FragmentDefinition {
  typeCondition: string;
  selections: Selection[];
}

interface GraphQLDocument {
  operations: Operation[];
  fragments: Map<string, FragmentDefinition>;
}

interface ErrorEntry {
  message: string;
}

interface Typed {
  __type: string;
  [key: string]: unknown;
}

const PUNCTUATION = new Set(['{', '}', '(', ')', '[', ']', ':', '!', '$', '=', '@', '|', '&']);

class Lexer {
  private readonly source: string;
  private position = 0;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const token = this.next();
      tokens.push(token);
      if (token.type === 'EOF') return tokens;
    }
  }

  private next(): Token {
    this.skipIgnored();
    if (this.position >= this.source.length) return { type: 'EOF' };
    const rest = this.source.slice(this.position);
    if (rest.startsWith('...')) {
      this.position += 3;
      return { type: '...' };
    }
    const char = this.source[this.position] as string;
    if (PUNCTUATION.has(char)) {
      this.position += 1;
      return { type: char };
    }
    if (char === '"') {
      if (rest.startsWith('"""')) return { type: 'STRING', value: this.readBlockString() };
      return { type: 'STRING', value: this.readString() };
    }
    if (char === '-' || (char >= '0' && char <= '9')) return this.readNumber();
    if (char === '_' || char === '$' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) return this.readName();
    throw new Error(`unexpected character ${JSON.stringify(char)}`);
  }

  private skipIgnored(): void {
    while (this.position < this.source.length) {
      const char = this.source[this.position] as string;
      if (char === '\ufeff' || char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
        this.position += 1;
        continue;
      }
      if (char === '#') {
        while (this.position < this.source.length) {
          const current = this.source[this.position] as string;
          this.position += 1;
          if (current === '\n' || current === '\r') break;
        }
        continue;
      }
      return;
    }
  }

  private readName(): Token {
    const start = this.position;
    this.position += 1;
    while (this.position < this.source.length) {
      const char = this.source[this.position] as string;
      if (char === '_' || (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) {
        this.position += 1;
      } else {
        break;
      }
    }
    return { type: 'NAME', value: this.source.slice(start, this.position) };
  }

  private readNumber(): Token {
    const start = this.position;
    if (this.source[this.position] === '-') this.position += 1;
    while (this.position < this.source.length) {
      const char = this.source[this.position] as string;
      if (char >= '0' && char <= '9') this.position += 1;
      else break;
    }
    let float = false;
    if (this.source[this.position] === '.') {
      float = true;
      this.position += 1;
      while (this.position < this.source.length) {
        const char = this.source[this.position] as string;
        if (char >= '0' && char <= '9') this.position += 1;
        else break;
      }
    }
    const exponent = this.source[this.position];
    if (exponent === 'e' || exponent === 'E') {
      float = true;
      this.position += 1;
      const sign = this.source[this.position];
      if (sign === '+' || sign === '-') this.position += 1;
      while (this.position < this.source.length) {
        const char = this.source[this.position] as string;
        if (char >= '0' && char <= '9') this.position += 1;
        else break;
      }
    }
    return { type: float ? 'FLOAT' : 'INT', value: this.source.slice(start, this.position) };
  }

  private readString(): string {
    this.position += 1;
    let out = '';
    while (this.position < this.source.length) {
      const char = this.source[this.position] as string;
      this.position += 1;
      if (char === '"') return out;
      if (char !== '\\') {
        out += char;
        continue;
      }
      const escape = this.source[this.position] as string;
      this.position += 1;
      if (escape === '"' || escape === '\\' || escape === '/') out += escape;
      else if (escape === 'b') out += '\b';
      else if (escape === 'f') out += '\f';
      else if (escape === 'n') out += '\n';
      else if (escape === 'r') out += '\r';
      else if (escape === 't') out += '\t';
      else if (escape === 'u') {
        const code = this.source.slice(this.position, this.position + 4);
        this.position += 4;
        out += String.fromCharCode(Number.parseInt(code, 16));
      } else out += escape;
    }
    throw new Error('unterminated string');
  }

  private readBlockString(): string {
    this.position += 3;
    let out = '';
    while (this.position < this.source.length) {
      if (this.source.startsWith('"""', this.position)) {
        this.position += 3;
        return out;
      }
      const char = this.source[this.position] as string;
      this.position += 1;
      if (char === '\\' && this.source.startsWith('"""', this.position)) {
        out += '"""';
        this.position += 3;
      } else {
        out += char;
      }
    }
    throw new Error('unterminated block string');
  }
}

class Parser {
  private readonly tokens: Token[];
  private position = 0;
  private readonly fragments = new Map<string, FragmentDefinition>();

  constructor(source: string) {
    this.tokens = new Lexer(source).tokenize();
  }

  parse(): GraphQLDocument {
    const operations: Operation[] = [];
    while (this.peek().type !== 'EOF') {
      if (this.peek().type === 'NAME' && this.peek().value === 'fragment') {
        this.parseFragmentDefinition();
        continue;
      }
      operations.push(this.parseOperation());
    }
    return { operations, fragments: this.fragments };
  }

  private peek(): Token {
    return this.tokens[this.position] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private expect(type: string): Token {
    const token = this.peek();
    if (token.type !== type) throw new Error(`expected ${type}, found ${token.type}${token.value === undefined ? '' : ` ${token.value}`}`);
    return this.advance();
  }

  private expectName(value?: string): string {
    const token = this.expect('NAME');
    const name = token.value as string;
    if (value !== undefined && name !== value) throw new Error(`expected ${value}, found ${name}`);
    return name;
  }

  private parseOperation(): Operation {
    if (this.peek().type === '{') {
      return { type: 'query', name: null, variables: [], selections: this.parseSelectionSet() };
    }
    const keyword = this.expectName();
    if (keyword !== 'query' && keyword !== 'mutation') throw new Error(`unsupported operation ${keyword}`);
    const type = keyword;
    let name: string | null = null;
    if (this.peek().type === 'NAME') name = this.expectName();
    const variables: VariableDefinition[] = [];
    if (this.peek().type === '(') variables.push(...this.parseVariableDefinitions());
    this.skipDirectives();
    const selections = this.parseSelectionSet();
    return { type, name, variables, selections };
  }

  private parseVariableDefinitions(): VariableDefinition[] {
    const definitions: VariableDefinition[] = [];
    this.expect('(');
    while (this.peek().type !== ')') {
      this.expect('$');
      const name = this.expectName();
      this.expect(':');
      this.parseTypeReference();
      let defaultValue: GqlValue | undefined;
      if (this.peek().type === '=') {
        this.advance();
        defaultValue = this.parseValue();
      }
      this.skipDirectives();
      definitions.push(defaultValue === undefined ? { name } : { name, defaultValue });
    }
    this.expect(')');
    return definitions;
  }

  private parseTypeReference(): void {
    if (this.peek().type === '[') {
      this.advance();
      this.parseTypeReference();
      this.expect(']');
    } else {
      this.expectName();
    }
    if (this.peek().type === '!') this.advance();
  }

  private parseFragmentDefinition(): void {
    this.expectName('fragment');
    const name = this.expectName();
    this.expectName('on');
    const typeCondition = this.expectName();
    this.skipDirectives();
    this.fragments.set(name, { typeCondition, selections: this.parseSelectionSet() });
  }

  private parseSelectionSet(): Selection[] {
    const selections: Selection[] = [];
    this.expect('{');
    while (this.peek().type !== '}') selections.push(this.parseSelection());
    this.expect('}');
    return selections;
  }

  private parseSelection(): Selection {
    if (this.peek().type === '...') {
      this.advance();
      if (this.peek().type === 'NAME' && this.peek().value === 'on') {
        this.advance();
        const typeCondition = this.expectName();
        this.skipDirectives();
        return { kind: 'inline', typeCondition, selections: this.parseSelectionSet() };
      }
      if (this.peek().type === 'NAME') {
        const name = this.expectName();
        this.skipDirectives();
        return { kind: 'spread', name };
      }
      this.skipDirectives();
      return { kind: 'inline', typeCondition: null, selections: this.parseSelectionSet() };
    }
    return this.parseField();
  }

  private parseField(): FieldNode {
    const first = this.expectName();
    let alias: string | null = null;
    let name = first;
    if (this.peek().type === ':') {
      this.advance();
      alias = first;
      name = this.expectName();
    }
    const args: Argument[] = [];
    if (this.peek().type === '(') args.push(...this.parseArguments());
    this.skipDirectives();
    const selections = this.peek().type === '{' ? this.parseSelectionSet() : [];
    return { kind: 'field', alias, name, args, selections };
  }

  private parseArguments(): Argument[] {
    const args: Argument[] = [];
    this.expect('(');
    while (this.peek().type !== ')') {
      const name = this.expectName();
      this.expect(':');
      args.push({ name, value: this.parseValue() });
    }
    this.expect(')');
    return args;
  }

  private skipDirectives(): void {
    while (this.peek().type === '@') {
      this.advance();
      this.expectName();
      if (this.peek().type === '(') this.parseArguments();
    }
  }

  private parseValue(): GqlValue {
    const token = this.peek();
    if (token.type === '$') {
      this.advance();
      return { kind: 'var', name: this.expectName() };
    }
    if (token.type === '[') {
      this.advance();
      const list: GqlValue[] = [];
      while (this.peek().type !== ']') list.push(this.parseValue());
      this.expect(']');
      return list;
    }
    if (token.type === '{') {
      this.advance();
      const object: { [key: string]: GqlValue } = {};
      while (this.peek().type !== '}') {
        const name = this.expectName();
        this.expect(':');
        object[name] = this.parseValue();
      }
      this.expect('}');
      return object;
    }
    if (token.type === 'STRING') {
      this.advance();
      return token.value ?? '';
    }
    if (token.type === 'INT') {
      this.advance();
      return Number.parseInt(token.value ?? '0', 10);
    }
    if (token.type === 'FLOAT') {
      this.advance();
      return Number.parseFloat(token.value ?? '0');
    }
    if (token.type === 'NAME') {
      this.advance();
      const name = token.value as string;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;
      return name;
    }
    throw new Error(`unexpected value token ${token.type}`);
  }
}

const OBJECT_FIELDS: Record<string, string[]> = {
  Query: ['viewer', 'repository', 'node', '__schema', '__type'],
  Mutation: ['createIssue', 'closeIssue', 'createPullRequest', 'mergePullRequest', 'addComment'],
  Repository: [
    'id',
    'databaseId',
    'name',
    'nameWithOwner',
    'owner',
    'defaultBranchRef',
    'viewerPermission',
    'hasIssuesEnabled',
    'hasPullRequestsEnabled',
    'isPrivate',
    'visibility',
    'description',
    'createdAt',
    'updatedAt',
    'pushedAt',
    'url',
    'issue',
    'issues',
    'pullRequest',
    'pullRequests',
    'forkCount',
    'stargazerCount',
    'isFork',
  ],
  Issue: [
    'id',
    'number',
    'title',
    'state',
    'body',
    'createdAt',
    'updatedAt',
    'closedAt',
    'author',
    'comments',
    'labels',
    'repository',
    'url',
  ],
  PullRequest: [
    'id',
    'number',
    'title',
    'body',
    'state',
    'merged',
    'mergeable',
    'mergeStateStatus',
    'headRefName',
    'baseRefName',
    'headRefOid',
    'baseRefOid',
    'createdAt',
    'updatedAt',
    'closedAt',
    'mergedAt',
    'author',
    'files',
    'changedFiles',
    'additions',
    'deletions',
    'url',
    'isDraft',
  ],
  User: ['id', 'databaseId', 'login', 'name', 'email', 'avatarUrl', 'url'],
  Ref: ['name', 'prefix', 'target'],
  IssueConnection: ['nodes', 'edges', 'pageInfo', 'totalCount'],
  PullRequestConnection: ['nodes', 'edges', 'pageInfo', 'totalCount'],
  FileConnection: ['nodes', 'edges', 'pageInfo', 'totalCount'],
  IssueEdge: ['node', 'cursor'],
  PullRequestEdge: ['node', 'cursor'],
  FileEdge: ['node', 'cursor'],
  IssueCommentConnection: ['nodes', 'edges', 'pageInfo', 'totalCount'],
  IssueCommentEdge: ['node', 'cursor'],
  PullRequestChangedFile: ['path', 'additions', 'deletions', 'changeType', 'changes'],
  IssueComment: ['id', 'body', 'author', 'createdAt', 'updatedAt'],
  Label: ['id', 'name', 'color', 'description'],
  PageInfo: ['hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor'],
  CreateIssuePayload: ['issue'],
  CloseIssuePayload: ['issue'],
  CreatePullRequestPayload: ['pullRequest'],
  MergePullRequestPayload: ['pullRequest'],
  AddCommentPayload: ['commentEdge'],
  __Schema: ['queryType', 'mutationType', 'subscriptionType', 'types', 'directives'],
  __Type: ['kind', 'name', 'description', 'fields', 'enumValues', 'inputFields', 'interfaces', 'possibleTypes', 'ofType', 'specifiedByURL'],
  __Field: ['name', 'description', 'args', 'type', 'isDeprecated', 'deprecationReason'],
  __EnumValue: ['name', 'description', 'isDeprecated', 'deprecationReason'],
  __InputValue: ['name', 'description', 'type', 'defaultValue'],
  __Directive: ['name', 'description', 'locations', 'args', 'isRepeatable'],
};

const ENUM_VALUES: Record<string, string[]> = {
  SearchType: ['ISSUE', 'REPOSITORY', 'USER', 'DISCUSSION'],
  IssueState: ['OPEN', 'CLOSED'],
  PullRequestState: ['OPEN', 'CLOSED', 'MERGED'],
  MergeableState: ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'],
  RepositoryPermission: ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ'],
  IssueOrderField: ['CREATED_AT', 'UPDATED_AT', 'COMMENTS'],
  OrderDirection: ['ASC', 'DESC'],
  PullRequestMergeMethod: ['MERGE', 'SQUASH', 'REBASE'],
};

const INPUT_TYPES: Record<string, string[]> = {
  CreateIssueInput: ['repositoryId', 'title', 'body'],
  CloseIssueInput: ['issueId'],
  CreatePullRequestInput: ['repositoryId', 'baseRefName', 'headRefName', 'title', 'body'],
  MergePullRequestInput: ['pullRequestId', 'mergeMethod'],
  AddCommentInput: ['subjectId', 'body'],
};

const SCALAR_TYPES = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

const ALL_TYPE_NAMES = Array.from(
  new Set([
    ...Object.keys(OBJECT_FIELDS),
    ...Object.keys(ENUM_VALUES),
    ...Object.keys(INPUT_TYPES),
    ...SCALAR_TYPES,
  ]),
).sort();

function typed(type: string, data: Record<string, unknown>): Typed {
  return { __type: type, ...data };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function resolveValue(value: GqlValue, variables: Record<string, unknown>): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ('kind' in value && (value as VarRef).kind === 'var') return variables[(value as VarRef).name];
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, variables);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, variables));
  return value;
}

function resolveArguments(args: readonly Argument[], variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of args) out[arg.name] = resolveValue(arg.value, variables);
  return out;
}

function unknownField(errors: ErrorEntry[], typeName: string, fieldName: string): null {
  errors.push({ message: `Cannot query field "${fieldName}" on type "${typeName}".` });
  return null;
}

function cursorOf(offset: number): string {
  return Buffer.from(`cursor:${offset}`, 'utf8').toString('base64url');
}

function offsetOf(cursor: unknown): number {
  if (typeof cursor !== 'string' || cursor === '') return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const match = /^cursor:(\d+)$/.exec(decoded);
    return match === null ? 0 : Number.parseInt(match[1] as string, 10);
  } catch {
    return 0;
  }
}

function pageInfoValue(start: number, end: number, total: number): Typed {
  return typed('PageInfo', {
    hasNextPage: end < total,
    hasPreviousPage: start > 0,
    startCursor: start < total ? cursorOf(start) : null,
    endCursor: end > 0 ? cursorOf(end) : null,
  });
}

function issueConnection(repo: Repo, args: Record<string, unknown>): Typed {
  const states = Array.isArray(args.states)
    ? args.states.filter((state): state is string => typeof state === 'string').map((state) => state.toUpperCase())
    : [];
  let issues = [...repo.issues.values()];
  if (states.length > 0) issues = issues.filter((issue) => states.includes(issue.state.toUpperCase()));

  const orderBy = asRecord(args.orderBy);
  const field = stringValue(orderBy.field) || 'CREATED_AT';
  const direction = stringValue(orderBy.direction) || 'DESC';
  issues.sort((left, right) => {
    let comparison: number;
    if (field === 'UPDATED_AT') comparison = left.updated_at.localeCompare(right.updated_at);
    else if (field === 'COMMENTS') comparison = left.comments.length - right.comments.length;
    else comparison = left.created_at.localeCompare(right.created_at);
    const withTie = comparison === 0 ? left.number - right.number : comparison;
    return direction === 'ASC' ? withTie : -withTie;
  });

  const total = issues.length;
  const first = typeof args.first === 'number' && args.first > 0 ? Math.trunc(args.first) : 30;
  const start = Math.min(offsetOf(args.after), total);
  const end = Math.min(start + first, total);
  const nodes = issues.slice(start, end).map((issue) => issueValue(repo, issue));
  return typed('IssueConnection', {
    totalCount: total,
    nodes,
    edges: nodes.map((node, index) => typed('IssueEdge', { node, cursor: cursorOf(start + index) })),
    pageInfo: pageInfoValue(start, end, total),
  });
}

function pullState(pull: PullRequest): string {
  if (pull.merged) return 'MERGED';
  return pull.state === 'open' ? 'OPEN' : 'CLOSED';
}

function pullConnection(repo: Repo, args: Record<string, unknown>): Typed {
  const states = Array.isArray(args.states)
    ? args.states.filter((state): state is string => typeof state === 'string').map((state) => state.toUpperCase())
    : [];
  let pulls = [...repo.pulls.values()];
  if (states.length > 0) pulls = pulls.filter((pull) => states.includes(pullState(pull)));
  pulls.sort((left, right) => right.number - left.number);

  const total = pulls.length;
  const first = typeof args.first === 'number' && args.first > 0 ? Math.trunc(args.first) : 30;
  const start = Math.min(offsetOf(args.after), total);
  const end = Math.min(start + first, total);
  const nodes = pulls.slice(start, end).map((pull) => pullValue(repo, pull));
  return typed('PullRequestConnection', {
    totalCount: total,
    nodes,
    edges: nodes.map((node, index) => typed('PullRequestEdge', { node, cursor: cursorOf(start + index) })),
    pageInfo: pageInfoValue(start, end, total),
  });
}

function linesOf(content: Buffer | undefined): number {
  if (content === undefined || content.length === 0) return 0;
  const text = content.toString('utf8');
  return text.split('\n').length;
}

function changedFiles(repo: Repo, pull: PullRequest): Typed[] {
  const headFiles = store.readFilesAtRef(repo, pull.head.sha);
  const baseFiles = store.readFilesAtRef(repo, pull.base.sha);
  const paths = new Set<string>([...headFiles.keys(), ...baseFiles.keys()]);
  const files: Typed[] = [];
  for (const path of [...paths].sort()) {
    const before = baseFiles.get(path);
    const after = headFiles.get(path);
    if (before !== undefined && after !== undefined && before.equals(after)) continue;
    const additions = after === undefined ? 0 : linesOf(after);
    const deletions = before === undefined ? 0 : linesOf(before);
    files.push(
      typed('PullRequestChangedFile', {
        path,
        additions,
        deletions,
        changes: additions + deletions,
        changeType: before === undefined ? 'ADDED' : after === undefined ? 'DELETED' : 'MODIFIED',
      }),
    );
  }
  return files;
}

function fileConnection(repo: Repo, pull: PullRequest, args: Record<string, unknown>): Typed {
  const all = changedFiles(repo, pull);
  const total = all.length;
  const first = typeof args.first === 'number' && args.first > 0 ? Math.trunc(args.first) : total;
  const start = Math.min(offsetOf(args.after), total);
  const end = Math.min(start + first, total);
  const nodes = all.slice(start, end);
  return typed('FileConnection', {
    totalCount: total,
    nodes,
    edges: nodes.map((node, index) => typed('FileEdge', { node, cursor: cursorOf(start + index) })),
    pageInfo: pageInfoValue(start, end, total),
  });
}

function userValue(login: string): Typed {
  const user = store.users.get(login);
  return typed('User', {
    id: user?.node_id ?? `U_${login}`,
    databaseId: user?.id ?? null,
    login,
    name: user?.name ?? login,
    email: user?.email ?? null,
    avatarUrl: user?.avatar_url ?? '',
    url: `http://github.invalid/${login}`,
  });
}

function commentValue(comment: IssueComment): Typed {
  return typed('IssueComment', {
    id: comment.node_id,
    body: comment.body,
    author: userValue(comment.user.login),
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  });
}

function issueValue(repo: Repo, issue: Issue): Typed {
  const comments = issue.comments.map(commentValue);
  return typed('Issue', {
    id: issue.node_id,
    number: issue.number,
    title: issue.title,
    state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
    body: issue.body,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.state === 'closed' ? issue.updated_at : null,
    author: userValue(issue.user.login),
    comments: typed('IssueCommentConnection', {
      totalCount: comments.length,
      nodes: comments,
      edges: comments.map((node, index) => typed('IssueCommentEdge', { node, cursor: cursorOf(index) })),
      pageInfo: pageInfoValue(0, comments.length, comments.length),
    }),
    labels: issue.labels.map((label) =>
      typed('Label', {
        id: label.node_id,
        name: label.name,
        color: label.color,
        description: label.description,
      }),
    ),
    repository: typed('Repository', { _repo: repo }),
    url: `http://github.invalid/${repo.owner}/${repo.name}/issues/${issue.number}`,
  });
}

function pullValue(repo: Repo, pull: PullRequest): Typed {
  const files = changedFiles(repo, pull);
  return typed('PullRequest', {
    _repo: repo,
    _pull: pull,
    id: pull.node_id,
    number: pull.number,
    title: pull.title,
    body: pull.body,
    state: pullState(pull),
    merged: pull.merged,
    mergeable: pull.merged ? 'UNKNOWN' : 'MERGEABLE',
    mergeStateStatus: pull.merged ? 'UNKNOWN' : 'CLEAN',
    headRefName: pull.head.ref,
    baseRefName: pull.base.ref,
    headRefOid: pull.head.sha,
    baseRefOid: pull.base.sha,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    closedAt: pull.merged || pull.state === 'closed' ? pull.updated_at : null,
    mergedAt: pull.merged_at,
    author: userValue(pull.user.login),
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + (typeof file.additions === 'number' ? file.additions : 0), 0),
    deletions: files.reduce((sum, file) => sum + (typeof file.deletions === 'number' ? file.deletions : 0), 0),
    url: `http://github.invalid/${repo.owner}/${repo.name}/pull/${pull.number}`,
    isDraft: false,
  });
}

function typeKind(name: string): string {
  if (ENUM_VALUES[name] !== undefined) return 'ENUM';
  if (INPUT_TYPES[name] !== undefined) return 'INPUT_OBJECT';
  if (SCALAR_TYPES.has(name)) return 'SCALAR';
  return 'OBJECT';
}

function typeValue(name: unknown): Typed | null {
  if (typeof name !== 'string' || name === '') return null;
  if (!ALL_TYPE_NAMES.includes(name)) return null;
  const fields = OBJECT_FIELDS[name];
  const enumValues = ENUM_VALUES[name];
  const inputFields = INPUT_TYPES[name];
  return typed('__Type', {
    kind: typeKind(name),
    name,
    description: null,
    fields:
      fields === undefined
        ? null
        : fields.map((field) =>
            typed('__Field', {
              name: field,
              description: null,
              args: [],
              type: null,
              isDeprecated: false,
              deprecationReason: null,
            }),
          ),
    enumValues:
      enumValues === undefined
        ? null
        : enumValues.map((value) =>
            typed('__EnumValue', {
              name: value,
              description: null,
              isDeprecated: false,
              deprecationReason: null,
            }),
          ),
    inputFields:
      inputFields === undefined
        ? null
        : inputFields.map((field) =>
            typed('__InputValue', {
              name: field,
              description: null,
              type: null,
              defaultValue: null,
            }),
          ),
    interfaces: [],
    possibleTypes: [],
    ofType: null,
    specifiedByURL: null,
  });
}

function schemaValue(): Typed {
  return typed('__Schema', {
    queryType: typeValue('Query'),
    mutationType: typeValue('Mutation'),
    subscriptionType: null,
    types: ALL_TYPE_NAMES.map((name) => typeValue(name)),
    directives: [],
  });
}

function findRepoById(id: unknown): Repo | null {
  if (typeof id !== 'string') return null;
  for (const repo of store.repos.values()) if (repo.node_id === id) return repo;
  return null;
}

function findIssueById(id: unknown): { repo: Repo; issue: Issue } | null {
  if (typeof id !== 'string') return null;
  for (const repo of store.repos.values()) {
    for (const issue of repo.issues.values()) if (issue.node_id === id) return { repo, issue };
  }
  return null;
}

function findPullById(id: unknown): { repo: Repo; pull: PullRequest } | null {
  if (typeof id !== 'string') return null;
  for (const repo of store.repos.values()) {
    for (const pull of repo.pulls.values()) if (pull.node_id === id) return { repo, pull };
  }
  return null;
}

function nodeValue(id: unknown): Typed | null {
  if (typeof id !== 'string') return null;
  for (const repo of store.repos.values()) {
    if (repo.node_id === id) return typed('Repository', { _repo: repo });
    for (const issue of repo.issues.values()) if (issue.node_id === id) return issueValue(repo, issue);
    for (const pull of repo.pulls.values()) if (pull.node_id === id) return pullValue(repo, pull);
  }
  for (const user of store.users.values()) {
    if (user.node_id === id) return userValue(user.login);
  }
  return null;
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

function queryField(name: string, args: Record<string, unknown>, errors: ErrorEntry[]): unknown {
  if (name === 'viewer') return userValue(store.viewer.login);
  if (name === 'repository') {
    const repo = store.getRepo(stringValue(args.owner), stringValue(args.name));
    return repo === undefined ? null : typed('Repository', { _repo: repo });
  }
  if (name === 'node') return nodeValue(args.id);
  if (name === '__schema') return schemaValue();
  if (name === '__type') return typeValue(args.name);
  return unknownField(errors, 'Query', name);
}

function repositoryField(repo: Repo, name: string, args: Record<string, unknown>, errors: ErrorEntry[]): unknown {
  if (name === 'id') return repo.node_id;
  if (name === 'databaseId') return repo.id;
  if (name === 'name') return repo.name;
  if (name === 'nameWithOwner') return `${repo.owner}/${repo.name}`;
  if (name === 'owner') return userValue(repo.owner);
  if (name === 'defaultBranchRef') {
    const sha = store.resolveRef(repo, `refs/heads/${repo.default_branch}`);
    return typed('Ref', { name: repo.default_branch, prefix: 'refs/heads/', target: sha });
  }
  if (name === 'viewerPermission') return 'ADMIN';
  if (name === 'hasIssuesEnabled') return true;
  if (name === 'hasPullRequestsEnabled') return true;
  if (name === 'isPrivate') return repo.private;
  if (name === 'visibility') return repo.private ? 'PRIVATE' : 'PUBLIC';
  if (name === 'description') return repo.description;
  if (name === 'createdAt') return repo.created_at;
  if (name === 'updatedAt') return repo.updated_at;
  if (name === 'pushedAt') return repo.updated_at;
  if (name === 'url') return `http://github.invalid/${repo.owner}/${repo.name}`;
  if (name === 'forkCount' || name === 'stargazerCount') return 0;
  if (name === 'isFork') return false;
  if (name === 'issue') {
    const number = typeof args.number === 'number' ? args.number : Number(args.number);
    const issue = repo.issues.get(number);
    return issue === undefined ? null : issueValue(repo, issue);
  }
  if (name === 'issues') return issueConnection(repo, args);
  if (name === 'pullRequest') {
    const number = typeof args.number === 'number' ? args.number : Number(args.number);
    const pull = repo.pulls.get(number);
    return pull === undefined ? null : pullValue(repo, pull);
  }
  if (name === 'pullRequests') return pullConnection(repo, args);
  return unknownField(errors, 'Repository', name);
}

function pullField(value: Typed, name: string, args: Record<string, unknown>, errors: ErrorEntry[]): unknown {
  const repo = value._repo as Repo;
  const pull = value._pull as PullRequest;
  if (name === 'files') return fileConnection(repo, pull, args);
  if (Object.prototype.hasOwnProperty.call(value, name) && !name.startsWith('_')) return value[name];
  return unknownField(errors, 'PullRequest', name);
}

function mutationField(name: string, args: Record<string, unknown>, errors: ErrorEntry[]): unknown {
  const input = asRecord(args.input);
  if (name === 'createIssue') {
    const repo = findRepoById(input.repositoryId);
    if (repo === null) {
      errors.push({ message: `Could not resolve to a Repository with the global id ${JSON.stringify(input.repositoryId)}.` });
      return null;
    }
    const issue = store.createIssue(repo, stringValue(input.title), stringValue(input.body), []);
    return typed('CreateIssuePayload', { issue: issueValue(repo, issue) });
  }
  if (name === 'closeIssue') {
    const found = findIssueById(input.issueId);
    if (found === null) {
      errors.push({ message: `Could not resolve to an Issue with the global id ${JSON.stringify(input.issueId)}.` });
      return null;
    }
    found.issue.state = 'closed';
    found.issue.updated_at = store.clock.iso();
    return typed('CloseIssuePayload', { issue: issueValue(found.repo, found.issue) });
  }
  if (name === 'createPullRequest') {
    const repo = findRepoById(input.repositoryId);
    if (repo === null) {
      errors.push({ message: `Could not resolve to a Repository with the global id ${JSON.stringify(input.repositoryId)}.` });
      return null;
    }
    const head = stringValue(input.headRefName);
    const base = stringValue(input.baseRefName);
    const headSha = store.resolveRef(repo, `refs/heads/${head}`) ?? store.resolveRef(repo, head);
    if (headSha === null) {
      errors.push({ message: `Head ref ${JSON.stringify(head)} does not exist in ${repo.owner}/${repo.name}.` });
      return null;
    }
    const baseSha = store.resolveRef(repo, `refs/heads/${base}`) ?? store.resolveRef(repo, base);
    if (baseSha === null) {
      errors.push({ message: `Base ref ${JSON.stringify(base)} does not exist in ${repo.owner}/${repo.name}.` });
      return null;
    }
    const pull = store.createPull(repo, {
      title: stringValue(input.title),
      body: stringValue(input.body),
      head,
      base,
      headSha,
      baseSha,
    });
    return typed('CreatePullRequestPayload', { pullRequest: pullValue(repo, pull) });
  }
  if (name === 'mergePullRequest') {
    const found = findPullById(input.pullRequestId);
    if (found === null) {
      errors.push({ message: `Could not resolve to a PullRequest with the global id ${JSON.stringify(input.pullRequestId)}.` });
      return null;
    }
    const { repo, pull } = found;
    if (pull.merged) {
      errors.push({ message: `Pull request #${pull.number} is already merged.` });
      return null;
    }
    const headSha = store.resolveRef(repo, `refs/heads/${pull.head.ref}`) ?? pull.head.sha;
    const baseSha = store.resolveRef(repo, `refs/heads/${pull.base.ref}`) ?? pull.base.sha;
    const baseCommit = store.getCommit(baseSha);
    const headCommit = store.getCommit(headSha);
    if (baseCommit === null || headCommit === null) {
      errors.push({ message: `Pull request #${pull.number} is not mergeable.` });
      return null;
    }
    const mergeBaseSha = store.mergeBase(headSha, baseSha);
    const baseFiles = mergeBaseSha === null ? new Map<string, Buffer>() : store.readFilesAtTree(store.getCommit(mergeBaseSha)?.tree ?? '');
    const headFiles = store.readFilesAtTree(headCommit.tree);
    const currentFiles = store.readFilesAtTree(baseCommit.tree);
    const mergedFiles = threeWayMerge(baseFiles, headFiles, currentFiles);
    if (mergedFiles === null) {
      errors.push({ message: `Pull request #${pull.number} is not mergeable.` });
      return null;
    }
    const mergeSha = store.createCommit(mergedFiles, {
      message: `Merge pull request #${pull.number} from ${pull.head.label}`,
      parent: baseSha,
    });
    repo.refs.set(`refs/heads/${pull.base.ref}`, mergeSha);
    pull.state = 'closed';
    pull.merged = true;
    pull.merged_at = store.clock.iso();
    pull.merge_commit_sha = mergeSha;
    pull.updated_at = pull.merged_at;
    repo.updated_at = pull.updated_at;
    return typed('MergePullRequestPayload', { pullRequest: pullValue(repo, pull) });
  }
  if (name === 'addComment') {
    const found = findIssueById(input.subjectId);
    if (found === null) {
      errors.push({ message: `Could not resolve to an Issue with the global id ${JSON.stringify(input.subjectId)}.` });
      return null;
    }
    const comment = store.createComment(found.repo, found.issue, stringValue(input.body));
    return typed('AddCommentPayload', {
      commentEdge: typed('IssueCommentEdge', { node: commentValue(comment), cursor: null }),
    });
  }
  return unknownField(errors, 'Mutation', name);
}

function executeSelectionSet(
  value: unknown,
  selections: readonly Selection[],
  fragments: Map<string, FragmentDefinition>,
  errors: ErrorEntry[],
  variables: Record<string, unknown>,
): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => executeSelectionSet(item, selections, fragments, errors, variables));
  }
  if (typeof value !== 'object') return value;
  const object = value as Typed;
  const typeName = typeof object.__type === 'string' ? object.__type : null;
  const out: Record<string, unknown> = {};
  for (const selection of selections) {
    if (selection.kind === 'inline') {
      if (selection.typeCondition === null || selection.typeCondition === typeName) {
        const nested = executeSelectionSet(value, selection.selections, fragments, errors, variables);
        if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) Object.assign(out, nested);
      }
      continue;
    }
    if (selection.kind === 'spread') {
      const fragment = fragments.get(selection.name);
      if (fragment !== undefined && (fragment.typeCondition === typeName || typeName === null)) {
        const nested = executeSelectionSet(value, fragment.selections, fragments, errors, variables);
        if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) Object.assign(out, nested);
      }
      continue;
    }
    const key = selection.alias ?? selection.name;
    if (selection.name === '__typename') {
      out[key] = typeName;
      continue;
    }
    const args = resolveArguments(selection.args, variables);
    let result: unknown;
    if (typeName === 'Query') result = queryField(selection.name, args, errors);
    else if (typeName === 'Mutation') result = mutationField(selection.name, args, errors);
    else if (typeName === 'Repository') result = repositoryField((object._repo as Repo), selection.name, args, errors);
    else if (typeName === 'PullRequest') result = pullField(object, selection.name, args, errors);
    else if (typeName !== null && Object.prototype.hasOwnProperty.call(object, selection.name) && !selection.name.startsWith('_')) {
      result = object[selection.name];
    } else result = unknownField(errors, typeName ?? 'Object', selection.name);

    if (result === undefined) result = null;
    if (result !== null && selection.selections.length > 0) {
      out[key] = executeSelectionSet(result, selection.selections, fragments, errors, variables);
    } else {
      out[key] = result;
    }
  }
  return out;
}

function executeOperation(
  operation: Operation,
  document: GraphQLDocument,
  variables: Record<string, unknown>,
): { data: unknown; errors: ErrorEntry[] } {
  const values: Record<string, unknown> = { ...variables };
  for (const definition of operation.variables) {
    if (values[definition.name] === undefined && definition.defaultValue !== undefined) {
      values[definition.name] = resolveValue(definition.defaultValue, values);
    }
  }
  const errors: ErrorEntry[] = [];
  const root = typed(operation.type === 'mutation' ? 'Mutation' : 'Query', {});
  const data = executeSelectionSet(root, operation.selections, document.fragments, errors, values);
  return { data, errors };
}

function executeRequest(body: Record<string, unknown>): Record<string, unknown> {
  const query = stringValue(body.query);
  const variables = asRecord(body.variables);
  const operationName = typeof body.operationName === 'string' ? body.operationName : null;
  let document: GraphQLDocument;
  try {
    document = new Parser(query).parse();
  } catch (err) {
    return { data: null, errors: [{ message: err instanceof Error ? err.message : String(err) }] };
  }
  let operation: Operation | undefined;
  if (operationName !== null) operation = document.operations.find((candidate) => candidate.name === operationName);
  else operation = document.operations[0];
  if (operation === undefined) {
    return {
      data: null,
      errors: [{ message: operationName === null ? 'The document contains no operation.' : `Unknown operation named ${JSON.stringify(operationName)}.` }],
    };
  }
  const result = executeOperation(operation, document, variables);
  if (result.errors.length > 0) return { data: null, errors: result.errors };
  return { data: result.data };
}

async function handleGraphql(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  if (loginForToken(bearer) === null) {
    sendError(res, 401, 'Requires authentication');
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendError(res, 400, 'Problems parsing JSON');
    return;
  }
  if (Array.isArray(parsed.value)) {
    sendJson(
      res,
      200,
      parsed.value.map((entry) => executeRequest(objectOf(entry))),
    );
    return;
  }
  sendJson(res, 200, executeRequest(objectOf(parsed.value)));
}

export { handleGraphql };
