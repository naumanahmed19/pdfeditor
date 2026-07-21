# Repository instructions

## Git and releases

- Every commit subject and pull request title must use Conventional Commit
  syntax: `<type>[(scope)][!]: <imperative summary>`.
- Use a lowercase type and a non-empty summary. Valid examples include
  `fix: load the local model in Chrome`, `feat(editor): add page cropping`, and
  `feat!: replace the document storage format`.
- Use `fix:` for a user-visible bug fix (patch release), `feat:` for a feature
  (minor release), and `!` for a breaking change (major release). Use an
  appropriate non-release type such as `ci:`, `docs:`, `test:`, `build:`, or
  `chore:` for changes that should not determine the next application version.
- Do not use plain sentence subjects such as `Fix model loading`. The correct
  form is `fix: load the model`.
- GitHub-generated `Merge pull request ...` commits are exempt, but the pull
  request title and every authored commit contained in the pull request must
  follow the convention.
- Before pushing or opening a pull request, inspect every new commit subject and
  make the pull request title conventional. The repository validation workflow
  is authoritative and must pass.
- Do not rewrite published `main` history to repair a release message. Add one
  accurately worded Conventional Commit through a pull request; Release Please
  consumes it after the next release tag and will not reuse it in later releases.
