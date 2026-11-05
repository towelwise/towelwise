# Security policy

## Reporting a problem

Please do not open a public issue for a security problem. Email **towelwiseai@gmail.com** with what you found, how to reproduce it, and which version or commit you saw it in. You can also use GitHub's private vulnerability reporting on this repo's Security tab, if it is turned on.

You will get a reply when the maintainer sees it. Towelwise AI is maintained by one person in their spare time, so please allow some days.

## What is covered

- Code in this repo: the built-in extension in `packages/towelwise/`, the build script, and our patches to Code-OSS in `ide/patches/`.
- How Towelwise AI handles your settings and files, such as the records it keeps on disk while it saves a layout.

## What is not covered

- Problems in Code-OSS, VSCodium or Open VSX themselves. Report those upstream. If one affects Towelwise AI, tell us too, so we can take the fix.
- Agent extensions such as Claude Code and Codex, which come from their vendors.

## Supported versions

There is no public release yet. Fixes go into `main`.
