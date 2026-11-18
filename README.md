# github-core-clone-01

[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/dckimako-source/token-radar/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/dckimako-source/token-radar/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

A standalone GitHub-compatible git forge: git smart HTTP (upload-pack protocol v2 and v0, receive-pack v0), the REST v3 API for repositories, contents, labels, issues and pull requests, GraphQL v4 at /api/graphql and an MCP endpoint at /mcp, all served from one Node 22 process on the standard library only, backed by a single in-memory content-addressed git store.

## Run it

```sh
node --experimental-strip-types main.ts
```
