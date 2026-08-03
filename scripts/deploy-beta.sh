#!/bin/sh
set -eu

repository="/Users/dki/Documents/Codex/Gridlock/beta-worktree"
credentials="/Users/dki/Documents/Codex/Gridlock/deploy"
runtime="/Users/dki/.cache/codex-runtimes/codex-primary-runtime/dependencies"
git_bin="$runtime/bin/fallback/git"
node_bin="$runtime/node/bin"
remote="dh_cwxxe8@pdx1-shared-a1-37.dreamhost.com"
requested_target="${2:-beta.gridlockword.com}"
remote_paths="$requested_target"
playencircle_deploy_targets="domains/playencircle.com/public playencircle.com/public domains/playencircle.com/public_html playencircle.com/public_html playencircle.com"

case "$requested_target" in
  playencircle.com)
    remote_paths="$playencircle_deploy_targets"
    ;;
  *)
    remote_paths="$requested_target"
    ;;
esac
key="$credentials/beta-dreamhost-deploy-key"
known_hosts="$credentials/known-hosts"

usage() {
  echo "Usage: $0 --verify [target-domain] | --deploy [target-domain]" >&2
  echo "  target-domain defaults to beta.gridlockword.com if omitted." >&2
  echo "  Supported custom target examples: playencircle.com (deployed to several common DreamHost paths)." >&2
  exit 2
}

mode="${1:-}"
case "$mode" in
  --verify|--deploy) ;;
  *) usage ;;
esac

test -e "$repository/.git"
test -f "$key"
test -f "$known_hosts"
cd "$repository"

branch=$("$git_bin" branch --show-current)
test "$branch" = "beta/5x6-circles"
test -z "$("$git_bin" status --porcelain)"

head_sha=$("$git_bin" rev-parse HEAD)
origin_sha=$("$git_bin" rev-parse origin/beta/5x6-circles)
test "$head_sha" = "$origin_sha"

test -f "node_modules/typescript/bin/tsc"
test -f "node_modules/vite/bin/vite.js"
PATH="$node_bin:$PATH" node node_modules/typescript/bin/tsc --noEmit
PATH="$node_bin:$PATH" node node_modules/vite/bin/vite.js build
PATH="$node_bin:$PATH" node scripts/build-server.mjs
"$git_bin" diff --check
test -z "$("$git_bin" status --porcelain)"

ssh_options="-o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts -i $key"
if [ "$requested_target" = "playencircle.com" ]; then
  for remote_path in $remote_paths; do
    ssh $ssh_options "$remote" "mkdir -p \"$remote_path\""
  done
else
  for remote_path in $remote_paths; do
    ssh $ssh_options "$remote" "test -d $remote_path && test -f $remote_path/gridlock-config.php && test -f $remote_path/gridlock-beta.sqlite" && break
  done
fi

if [ "$mode" = "--deploy" ]; then
  for remote_path in $remote_paths; do
    RSYNC_RSH="ssh $ssh_options" rsync -avz --delete --exclude '.DS_Store' "$repository/public/" "$remote:$remote_path/"
  done
fi

echo "ENCIRCLE beta $mode succeeded for $remote_path at commit $head_sha"
