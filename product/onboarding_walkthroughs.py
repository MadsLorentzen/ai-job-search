from __future__ import annotations

from product.onboarding import (
    WalkthroughDefinition,
    WalkthroughStep,
    register_walkthrough,
)


DASHBOARD_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="dashboard_intro",
    version=1,
    title="Your JobSearch dashboard",
    steps=(
        WalkthroughStep(
            step_id="hero",
            target='[data-onboarding-target="dashboard-hero"]',
            title="This is your pipeline.",
            body=(
                "JobSearch tracks every job you're considering, in one "
                "place, from first look to final decision."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="getting_started",
            target='[data-onboarding-target="dashboard-getting-started"]',
            title="The stages, at a glance.",
            body=(
                "Evidence Profile, then a job, then Job Fit, Intelligence, "
                "Review, Pack, Download, Apply -- each stage is explained "
                "where it happens."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="filters",
            target='[data-onboarding-target="dashboard-filters"]',
            title="Filter by where things stand.",
            body=(
                "Switch between Active, Drafted, Applied, and other "
                "stages to focus on what needs attention."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="add_job",
            target='[data-onboarding-target="add-job-button"]',
            title="Start with a job.",
            body=(
                "Add a job posting to begin -- JobSearch builds "
                "everything else, evidence-backed, from there."
            ),
            placement="bottom",
        ),
    ),
    trigger="first_visit:dashboard",
)


CANDIDATE_PROFILE_WALKTHROUGH = WalkthroughDefinition(
    walkthrough_id="candidate_profile_intro",
    version=1,
    title="Your Candidate Profile",
    steps=(
        WalkthroughStep(
            step_id="sources",
            target='[data-onboarding-target="profile-sources-panel"]',
            title="Your evidence, one source at a time.",
            body=(
                "The Candidate Profile is the one editable source. "
                "Supplemental sources like your CV add evidence too, but "
                "stay read-only here."
            ),
            placement="bottom",
        ),
        WalkthroughStep(
            step_id="entries",
            target='[data-onboarding-target="profile-entries-panel"]',
            title="Add or correct what JobSearch knows.",
            body=(
                "Every entry here is something you've confirmed "
                "yourself. JobSearch never invents a qualification, a "
                "job title, or a skill you haven't entered."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="add_details",
            target='[data-onboarding-target="profile-add-details"]',
            title="Add new evidence here.",
            body=(
                "Open this to add education, experience, skills, or "
                "certifications -- one confirmed fact per entry."
            ),
            placement="top",
        ),
        WalkthroughStep(
            step_id="claims",
            target='[data-onboarding-target="profile-claims-panel"]',
            title="This is what later stages will use.",
            body=(
                "Job Fit and document generation cite these claims "
                "directly, so what you confirm here is what shows up in "
                "your CV and cover letter."
            ),
            placement="top",
        ),
    ),
    trigger="first_visit:profile",
)


def register_default_walkthroughs() -> None:
    register_walkthrough(DASHBOARD_WALKTHROUGH)
    register_walkthrough(CANDIDATE_PROFILE_WALKTHROUGH)
