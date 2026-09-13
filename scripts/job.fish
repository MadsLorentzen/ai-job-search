#!/usr/bin/env fish
# Launch the role-bound job-search agent (see AGENTS.md)
set repo (dirname (status dirname))
set agent_dir $repo/.pi-agent
set -a skills_args
for s in $agent_dir/skills/*/
    set -a skills_args --skill $s
end
exec env PI_CODING_AGENT_DIR=$agent_dir pi --no-skills $skills_args $argv
