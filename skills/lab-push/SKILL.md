---
name: rdc:lab-push
description: >-
  Usage `rdc:lab-push <filename>` — push the artifact in this conversation to the Lab prototype viewer. Commits the file to apps/lab/docs/prototypes/ via POST https://lab.dev.place.fund/api/prototypes/push. Viewable immediately at lab.dev.place.fund/proto/<filename>.
---

# rdc:lab-push — Push Artifact to Lab

Push a JSX, TSX, HTML, or JS artifact from this conversation to the Lab prototype viewer at `lab.dev.place.fund`.

## How it works

1. POST `{ filename, content }` to `https://lab.dev.place.fund/api/prototypes/push`
2. The endpoint commits the file to `apps/lab/docs/prototypes/` on the `develop` branch via the GitHub Contents API
3. The file is immediately visible at `https://lab.dev.place.fund/proto/<filename>` — no redeploy needed

## Usage

```
rdc:lab-push <filename>
```

- `filename` must end in `.jsx`, `.tsx`, `.html`, or `.js`
- The artifact content comes from this conversation (the most recent code block, or the artifact the user is referring to)

## Steps

1. Identify the artifact content — the most recent code block in this conversation that the user wants to push, or what they explicitly point to
2. If filename not provided as an argument, derive one from the artifact (e.g. `my-component.jsx`)
3. Check if the file already exists: GET `https://lab.dev.place.fund/api/prototypes/content?filename=<filename>` — if it returns a `sha`, include it in the push body so GitHub can update rather than reject
4. POST to `https://lab.dev.place.fund/api/prototypes/push`:
   ```json
   { "filename": "<filename>", "content": "<full file content>", "sha": "<sha if updating>" }
   ```
5. On success, respond with: `Pushed → https://lab.dev.place.fund/proto/<filename>`

## Error handling

- 422 from push = filename invalid (wrong extension or path traversal attempt)
- 503 = credential service unavailable on the lab server
- 502 = GitHub API error — check if the file already exists and a `sha` is needed

## Notes

- This is the only way to get artifacts from claude.ai into the lab without copy-paste
- Git history in `apps/lab/docs/prototypes/` is the version store — every save is a commit
