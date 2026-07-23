# awesome-mcp submission

## Where to submit

MCP Widget Studio is a **client / dev tool**, not a server, so it belongs in
the tools/clients section of the "awesome" lists. Target repos (submit a PR to
each; check each list's contributing rules and alphabetical ordering first):

- **punkpeye/awesome-mcp-servers** — has a "Clients" / "Frameworks & Utilities"
  area; the most-watched list.
- **wong2/awesome-mcp-servers** — smaller, faster to merge.
- **appcypher/awesome-mcp-servers** — also lists tooling.
- The official **modelcontextprotocol/servers** README "community" area, if
  they accept client tooling.

## Entry text (Markdown)

Match the surrounding list's exact format; most use one of these:

```markdown
- [MCP Widget Studio](https://github.com/njha6185/mcp-widget-studio) — Web-based MCP client that renders tool UIs as live widgets (OpenAI Apps SDK & MCP-UI), with a chat simulator, multi-server support, and full inspector features. `npx mcp-widget-studio`
```

Shorter variant if the list keeps entries terse:

```markdown
- [MCP Widget Studio](https://github.com/njha6185/mcp-widget-studio) — Inspector + widget renderer + chat simulator for MCP servers.
```

## Submitting the PR (per repo)

```bash
# fork in the GitHub UI first, then:
gh repo fork punkpeye/awesome-mcp-servers --clone
cd awesome-mcp-servers
# add the line in the correct section, keeping alphabetical order
git checkout -b add-mcp-widget-studio
git commit -am "Add MCP Widget Studio"
git push -u origin add-mcp-widget-studio
gh pr create --title "Add MCP Widget Studio" \
  --body "A web-based MCP client that renders tool UIs as live widgets (OpenAI Apps SDK & MCP-UI), plus a chat simulator and full inspector features. Repo: https://github.com/njha6185/mcp-widget-studio"
```

Tip: read the list's CONTRIBUTING before pushing — several require a specific
category, a one-line description length, or an emoji legend (e.g. language/
scope tags).
