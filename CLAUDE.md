# ghola-fetch

## Release

1. Bump the version in `package.json` and `package-lock.json`: `npm version X.Y.Z --no-git-tag-version`.
2. Commit both files with the message `vX.Y.Z`.
3. Run `npm run release`. It creates the `vX.Y.Z` tag and pushes `main` and the tag, which triggers the publish workflow.
