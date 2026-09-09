# Professore

https://github.com/user-attachments/assets/e96b4624-a0a0-45d1-8fcd-eb16eb0a8379

[利用ガイド](docs/guide.md)

## Codex

リポジトリのルートで実行（ユーザースコープ）。

```sh
PROFESSORE_DIR="$(pwd -P)"
PROFESSORE_MISE="$(command -v mise)"

codex mcp add professore -- "$PROFESSORE_MISE" \
  -C "$PROFESSORE_DIR" exec -- bun "$PROFESSORE_DIR/src/mcp.ts"

mkdir -p "$HOME/.agents/skills"
test -e "$HOME/.agents/skills/professore" || \
  ln -s "$PROFESSORE_DIR/skills/professore" "$HOME/.agents/skills/professore"

codex mcp get professore
```

`$professore` で制作を依頼。

## Claude Code

リポジトリのルートで実行（ユーザースコープ）。

```sh
PROFESSORE_DIR="$(pwd -P)"
PROFESSORE_MISE="$(command -v mise)"

claude mcp add --scope user --transport stdio professore -- \
  "$PROFESSORE_MISE" -C "$PROFESSORE_DIR" exec -- bun "$PROFESSORE_DIR/src/mcp.ts"

mkdir -p "$HOME/.claude/skills"
test -e "$HOME/.claude/skills/professore" || \
  ln -s "$PROFESSORE_DIR/skills/professore" "$HOME/.claude/skills/professore"

claude mcp get professore
```

`/professore` で制作を依頼。
