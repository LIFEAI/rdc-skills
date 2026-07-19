---
doc_type: release-runbook
status: active
package: "@lifeaitools/rdc-skills"
---

# Release rdc-skills

`@lifeaitools/rdc-skills` is released to npm and then installed into the active
LifeAI skill profile. This runbook is the required release contract for every
version.

## Release checklist

1. Reconcile the release branch with its remote and confirm the intended diff.
2. Run `npm run validate`, focused deterministic tests, and an independent RDC
   review for the candidate changes.
3. Bump the package with `npm version patch --no-git-tag-version` (or the
   approved minor or major equivalent).
4. Commit the version files with the associated RDC work-item trailer and push
   the release branch.
5. Create and push `v<version>`; the publish workflow publishes the tagged
   package to npm.
6. Wait for the publish workflow to complete, then verify it with
   `npm view @lifeaitools/rdc-skills version` and
   `npm view @lifeaitools/rdc-skills@<version> version`.
7. Inspect the registry artifact with
   `npm pack @lifeaitools/rdc-skills@<version>` and verify the changed skill
   files are present in the tarball.
8. Install the published package with
   `npm install -g @lifeaitools/rdc-skills@<version>`.
9. Reinstall the active profile with `rdc-skills-install --profile core`; on a
   workstation intentionally configured for the LIFEAI project layout and
   services, use `rdc-skills-install --profile lifeai`.
10. Verify the global package version, the active profile copy, and the skill
    smoke check before closing the release work item.

## Deployment boundary

The LifeAI profile installation is the development delivery for this library.
Application production promotion remains separately approval-gated through
`rdc:deploy promote`; this package runbook never promotes an application.
