#!/bin/bash

# Auto-commit and push script for TrialByFire
# Generates structured commit messages based on what actually changed.
#
# Message format: <type>(<scope>): <description>
#   type  = feat | fix | refactor | style | docs | chore | test
#   scope = engine | contracts | frontend | config | project
#
# Examples:
#   feat(engine): add adversarial debate pipeline and LLM adapters
#   fix(contracts): correct payout calculation in claimWinnings
#   style(frontend): update dashboard layout and scorecard styles

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/auto-commit.log"
INTERVAL=60  # seconds

mkdir -p "$REPO_ROOT/logs"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Determine the conventional-commit type (feat, fix, refactor, …)
# ---------------------------------------------------------------------------
detect_type() {
    local added="$1" modified="$2" deleted="$3"

    # If only deletions → chore
    if [[ -z "$added" && -z "$modified" && -n "$deleted" ]]; then
        echo "chore"; return
    fi

    # New files → feat
    if [[ -n "$added" ]]; then
        echo "feat"; return
    fi

    # Config / dependency changes → chore
    if echo "$modified" | grep -qE "(package\.json|tsconfig|hardhat\.config|vite\.config|vitest\.config|\.env|\.gitignore)"; then
        echo "chore"; return
    fi

    # CSS-only → style
    if echo "$modified" | grep -qE "\.css$" && ! echo "$modified" | grep -qvE "\.css$"; then
        echo "style"; return
    fi

    # Test files → test
    if echo "$modified" | grep -qE "(test|spec)\.(ts|tsx)$"; then
        echo "test"; return
    fi

    # Solidity test files → test
    if echo "$modified" | grep -qE "test/.*\.ts$" && echo "$modified" | grep -q "packages/contracts"; then
        echo "test"; return
    fi

    # Docs → docs
    if echo "$modified" | grep -qE "\.(md|txt)$" && ! echo "$modified" | grep -qvE "\.(md|txt)$"; then
        echo "docs"; return
    fi

    echo "feat"
}

# ---------------------------------------------------------------------------
# Determine the scope from file paths
# ---------------------------------------------------------------------------
detect_scope() {
    local all_files="$1"
    local has_engine=false has_contracts=false has_frontend=false
    local has_config=false has_scripts=false

    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        case "$f" in
            packages/engine/*)     has_engine=true ;;
            packages/contracts/*)  has_contracts=true ;;
            packages/frontend/*)   has_frontend=true ;;
            scripts/*)             has_scripts=true ;;
            *.json|*.config.*|.env*|.gitignore|tsconfig.*)
                                   has_config=true ;;
        esac
    done <<< "$all_files"

    local scopes=()
    $has_engine    && scopes+=("engine")
    $has_contracts && scopes+=("contracts")
    $has_frontend  && scopes+=("frontend")
    $has_scripts   && scopes+=("scripts")
    $has_config    && scopes+=("config")

    if [[ ${#scopes[@]} -eq 0 ]]; then
        echo "project"
    elif [[ ${#scopes[@]} -eq 1 ]]; then
        echo "${scopes[0]}"
    else
        local IFS=","
        echo "${scopes[*]}"
    fi
}

# ---------------------------------------------------------------------------
# Build a human-readable description of the changes
# ---------------------------------------------------------------------------
describe_changes() {
    local added="$1" modified="$2" deleted="$3"
    local all_files="$4"
    local desc=""

    # --- Engine: types ---
    if echo "$all_files" | grep -q "packages/engine/src/types\.ts"; then
        if echo "$added" | grep -q "types\.ts"; then
            desc="${desc:+$desc, }add domain type definitions"
        else
            desc="${desc:+$desc, }update domain types"
        fi
    fi

    # --- Engine: LLM adapters ---
    if echo "$all_files" | grep -q "packages/engine/src/llm/"; then
        local llm_files=$(echo "$all_files" | grep "packages/engine/src/llm/" | xargs -I{} basename {} .ts 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
        if echo "$added" | grep -q "packages/engine/src/llm/"; then
            desc="${desc:+$desc, }add LLM client ($llm_files)"
        else
            desc="${desc:+$desc, }update LLM client ($llm_files)"
        fi
    fi

    # --- Engine: evidence ---
    if echo "$all_files" | grep -q "packages/engine/src/evidence/"; then
        if echo "$added" | grep -q "packages/engine/src/evidence/"; then
            desc="${desc:+$desc, }add evidence gathering module"
        else
            desc="${desc:+$desc, }update evidence module"
        fi
    fi

    # --- Engine: advocates ---
    if echo "$all_files" | grep -q "packages/engine/src/advocates/"; then
        if echo "$added" | grep -q "packages/engine/src/advocates/"; then
            desc="${desc:+$desc, }add advocate debate module"
        else
            desc="${desc:+$desc, }update advocate module"
        fi
    fi

    # --- Engine: judge ---
    if echo "$all_files" | grep -q "packages/engine/src/judge/"; then
        if echo "$added" | grep -q "packages/engine/src/judge/"; then
            desc="${desc:+$desc, }add judge adjudication module"
        else
            desc="${desc:+$desc, }update judge module"
        fi
    fi

    # --- Engine: pipeline ---
    if echo "$all_files" | grep -q "packages/engine/src/pipeline/"; then
        if echo "$added" | grep -q "packages/engine/src/pipeline/"; then
            desc="${desc:+$desc, }add trial pipeline orchestrator"
        else
            desc="${desc:+$desc, }update pipeline logic"
        fi
    fi

    # --- Engine: CLI ---
    if echo "$all_files" | grep -q "packages/engine/src/cli\.ts"; then
        if echo "$added" | grep -q "cli\.ts"; then
            desc="${desc:+$desc, }add CLI runner"
        else
            desc="${desc:+$desc, }update CLI"
        fi
    fi

    # --- Contracts: Solidity ---
    if echo "$all_files" | grep -q "packages/contracts/contracts/"; then
        local sol_files=$(echo "$all_files" | grep "packages/contracts/contracts/" | xargs -I{} basename {} .sol 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
        if echo "$added" | grep -q "packages/contracts/contracts/"; then
            desc="${desc:+$desc, }add $sol_files contract"
        else
            desc="${desc:+$desc, }update $sol_files contract"
        fi
    fi

    # --- Contracts: deploy script ---
    if echo "$all_files" | grep -q "packages/contracts/scripts/deploy"; then
        desc="${desc:+$desc, }update deploy script"
    fi

    # --- Contracts: tests ---
    if echo "$all_files" | grep -q "packages/contracts/test/"; then
        desc="${desc:+$desc, }update contract tests"
    fi

    # --- Frontend: components ---
    local components=$(echo "$all_files" | grep -oE "packages/frontend/src/components/[A-Za-z]+\.tsx" | xargs -I{} basename {} .tsx 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
    if [[ -n "$components" ]]; then
        if echo "$added" | grep -q "packages/frontend/src/components/"; then
            desc="${desc:+$desc, }add $components component(s)"
        else
            desc="${desc:+$desc, }update $components component(s)"
        fi
    fi

    # --- Frontend: hooks ---
    if echo "$all_files" | grep -q "packages/frontend/src/hooks/"; then
        local hooks=$(echo "$all_files" | grep "packages/frontend/src/hooks/" | xargs -I{} basename {} .ts 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
        desc="${desc:+$desc, }update $hooks hook(s)"
    fi

    # --- Frontend: App/main ---
    if echo "$all_files" | grep -q "packages/frontend/src/App\.tsx"; then
        desc="${desc:+$desc, }update App layout"
    fi
    if echo "$all_files" | grep -q "packages/frontend/src/main\.tsx"; then
        desc="${desc:+$desc, }update app entry point"
    fi

    # --- Styling ---
    if echo "$all_files" | grep -qE "\.css$"; then
        desc="${desc:+$desc, }update styles"
    fi

    # --- Dependencies ---
    if echo "$all_files" | grep -q "package\.json"; then
        desc="${desc:+$desc, }update dependencies"
    fi

    # --- Config files ---
    if echo "$all_files" | grep -qE "(tsconfig|hardhat\.config|vite\.config|vitest\.config)"; then
        desc="${desc:+$desc, }update config"
    fi

    # --- Scripts ---
    if echo "$all_files" | grep -q "^scripts/"; then
        desc="${desc:+$desc, }update build scripts"
    fi

    # --- Engine: tests ---
    if echo "$all_files" | grep -q "packages/engine/tests/"; then
        desc="${desc:+$desc, }update engine tests"
    fi

    # --- Deletions ---
    if [[ -n "$deleted" ]]; then
        local del_count=$(echo "$deleted" | wc -l | xargs)
        desc="${desc:+$desc, }remove $del_count file(s)"
    fi

    # Fallback
    if [[ -z "$desc" ]]; then
        local file_count=$(echo "$all_files" | wc -l | xargs)
        local first_file=$(echo "$all_files" | head -1 | xargs basename 2>/dev/null || echo "files")
        if [[ $file_count -eq 1 ]]; then
            desc="update $first_file"
        else
            desc="update $file_count files"
        fi
    fi

    echo "$desc"
}

# ---------------------------------------------------------------------------
# Main: generate full commit message
# ---------------------------------------------------------------------------
generate_commit_message() {
    local added=$(git diff --cached --name-only --diff-filter=A)
    local modified=$(git diff --cached --name-only --diff-filter=M)
    local deleted=$(git diff --cached --name-only --diff-filter=D)
    local all_files=$(git diff --cached --name-only)

    local type=$(detect_type "$added" "$modified" "$deleted")
    local scope=$(detect_scope "$all_files")
    local desc=$(describe_changes "$added" "$modified" "$deleted" "$all_files")

    echo "${type}(${scope}): ${desc}"
}

# ---------------------------------------------------------------------------
# Commit + push
# ---------------------------------------------------------------------------
do_commit() {
    cd "$REPO_ROOT" || { log "Failed to navigate to repo root"; return 1; }

    if [[ -z $(git status -s) ]]; then
        return 0
    fi

    log "Changes detected:"
    git status -s >> "$LOG_FILE"

    git add .

    local commit_msg=$(generate_commit_message)
    log "Commit: $commit_msg"

    git commit -m "$commit_msg"

    log "Pushing to origin/main..."
    if git push origin main 2>&1 | tee -a "$LOG_FILE"; then
        log "Pushed successfully."
    else
        log "Push failed."
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
case "${1:-}" in
    --once)
        log "Running single commit check..."
        do_commit
        ;;
    --watch|"")
        log "Auto-commit started (interval: ${INTERVAL}s)"
        while true; do
            do_commit
            sleep $INTERVAL
        done
        ;;
    --help)
        echo "Usage: $0 [--once|--watch|--help]"
        echo "  --once   Run once and exit"
        echo "  --watch  Run continuously (default)"
        echo "  --help   Show this help"
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use --help for usage"
        exit 1
        ;;
esac
